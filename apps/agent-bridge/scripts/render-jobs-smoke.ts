import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcess } from "../src/media.ts";
import type { RenderJob } from "../src/render-jobs.ts";
import type { LoadedReviewSession } from "../src/review-session.ts";
import type { WorkspaceProject } from "../src/workspace-projects.ts";

const root = await realpath(
  await mkdtemp(join(tmpdir(), "opencut-jobs-http-")),
);
const port = await new Promise<number>((resolve) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = (s.address() as { port: number }).port;
    s.close(() => resolve(p));
  });
});
const base = `http://127.0.0.1:${port}`;
let child = spawn(
  new URL("../bin/opencut-agent-http", import.meta.url).pathname,
  [],
  {
    env: {
      ...process.env,
      OPENCUT_AGENT_ROOT: root,
      OPENCUT_AGENT_HTTP_PORT: String(port),
    },
    stdio: "ignore",
  },
);
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
async function post<T>(path: string, body: object = {}): Promise<T> {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as T & { error?: string };
  assert(response.ok, `${path}: ${data.error}`);
  return data;
}
async function get<T>(path: string): Promise<T> {
  const r = await fetch(base + path);
  assert(r.ok, `GET ${path}: ${r.status}`);
  return r.json() as Promise<T>;
}
async function until<T>(
  action: () => Promise<T | undefined>,
  message: string,
): Promise<T> {
  for (let i = 0; i < 600; i++) {
    const result = await action();
    if (result !== undefined) return result;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(message);
}
async function stop() {
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once("exit", () => resolve());
  });
}
try {
  await until(async () => {
    try {
      return (await fetch(base + "/health")).ok ? true : undefined;
    } catch {
      return undefined;
    }
  }, "HTTP service unavailable");
  const sourcePath = join(root, "generated source's video.mp4");
  const generated = await runProcess("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=1920x1080:r=30:d=60",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "35",
    sourcePath,
  ]);
  assert(generated.exitCode === 0, generated.stderr);
  const project = await post<WorkspaceProject>("/v1/workspace-projects", {
    name: "Generated reliability check",
    sourcePath,
  });
  const open = () =>
    post<{ sessionId: string; approvalToken: string }>(
      `/v1/workspace-projects/${project.id}/open`,
    );
  let opened = await open();
  let url = `/v1/review-sessions/${opened.sessionId}`;
  assert(
    (await get<{ jobs: RenderJob[] }>(url + "/render-jobs")).jobs.length === 0,
    "New project has unexpected job history",
  );
  const identity = () => ({
    candidateId: "master",
    approvalToken: opened.approvalToken,
    renderLimitSeconds: 60,
    background: true,
  });
  const pending = await post<{ job: RenderJob }>(
    url + "/render-preview",
    identity(),
  );
  const running = await until(async () => {
    const job = (await get<{ jobs: RenderJob[] }>(url + "/render-jobs"))
      .jobs[0]!;
    return job.phase === "rendering" &&
      (job.percent ?? 0) > 0 &&
      job.status === "running"
      ? job
      : undefined;
  }, "No live encoding progress received");
  assert(
    running.id === pending.job.id && running.percent! < 100,
    "Invalid progress",
  );
  // Opening a fresh opaque session simulates refreshing the stable project URL.
  opened = await open();
  url = `/v1/review-sessions/${opened.sessionId}`;
  assert(
    (await get<{ jobs: RenderJob[] }>(url + "/render-jobs")).jobs[0]!.id ===
      running.id,
    "Active render was lost on reopen",
  );
  const denied = await fetch(base + url + `/render-jobs/${running.id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      approvalToken: "00000000-0000-4000-8000-000000000000",
    }),
  });
  assert(denied.status === 403, "Invalid cancellation token accepted");
  await post(url + `/render-jobs/${running.id}/cancel`, {
    approvalToken: opened.approvalToken,
  });
  await until(async () => {
    const job = (await get<{ jobs: RenderJob[] }>(url + "/render-jobs"))
      .jobs[0]!;
    return job.status === "cancelled" ? job : undefined;
  }, "Cancellation did not finish");
  const cancelled = await get<LoadedReviewSession>(url);
  assert(
    cancelled.candidates[0]!.revision === 1 &&
      !cancelled.candidates[0]!.previewExists &&
      !cancelled.candidates[0]!.outputExists,
    "Cancellation changed the revision or published a file",
  );
  assert(
    cancelled.events.some((event) => event.type === "preview-cancelled"),
    "Cancellation audit event missing",
  );
  const renders = join(
    root,
    "opencut-projects",
    project.id,
    "candidates/master/renders",
  );
  assert(
    (await readdir(renders).catch(() => [])).every(
      (name) => !name.includes(".render-"),
    ),
    "Partial encoding file left behind",
  );
  const retry = await post<{ job: RenderJob }>(
    url + "/render-preview",
    identity(),
  );
  await until(async () => {
    const job = (
      await get<{ jobs: RenderJob[] }>(url + "/render-jobs")
    ).jobs.find((j) => j.id === retry.job.id)!;
    if (job.status === "failed") throw new Error(job.details);
    return job.status === "completed" ? job : undefined;
  }, "Retry did not complete");
  const preview = await get<LoadedReviewSession>(url);
  assert(
    preview.candidates[0]!.previewExists &&
      !preview.candidates[0]!.outputExists,
    "Preview incorrectly approved a final",
  );
  const final = await post<{ job: RenderJob }>(
    url + "/approve-and-render",
    identity(),
  );
  await until(async () => {
    const job = (
      await get<{ jobs: RenderJob[] }>(url + "/render-jobs")
    ).jobs.find((j) => j.id === final.job.id)!;
    if (job.status === "failed") throw new Error(job.details);
    return job.status === "completed" && job.percent === 100 ? job : undefined;
  }, "Final did not complete");
  const done = await get<LoadedReviewSession>(url);
  assert(
    done.candidates[0]!.outputExists &&
      done.candidates[0]!.status === "rendered",
    "Final state missing",
  );
  const download = await fetch(
    base + url + "/candidates/master/output?download=1",
    { headers: { Range: "bytes=0-31" } },
  );
  assert(
    download.status === 206 && (await download.arrayBuffer()).byteLength === 32,
    "Final range download failed",
  );
  // Abruptly stop a second generated project, then exercise durable interrupted history.
  const other = await post<WorkspaceProject>("/v1/workspace-projects", {
    name: "Interrupted generated render",
    sourcePath,
  });
  const otherOpen = await post<{ sessionId: string; approvalToken: string }>(
    `/v1/workspace-projects/${other.id}/open`,
  );
  const otherUrl = `/v1/review-sessions/${otherOpen.sessionId}`;
  await post(otherUrl + "/render-preview", {
    candidateId: "master",
    approvalToken: otherOpen.approvalToken,
    background: true,
  });
  await until(
    async () =>
      (await get<{ jobs: RenderJob[] }>(otherUrl + "/render-jobs")).jobs[0]!
        .phase === "rendering"
        ? true
        : undefined,
    "Second render never started",
  );
  await stop();
  child = spawn(
    new URL("../bin/opencut-agent-http", import.meta.url).pathname,
    [],
    {
      env: {
        ...process.env,
        OPENCUT_AGENT_ROOT: root,
        OPENCUT_AGENT_HTTP_PORT: String(port),
      },
      stdio: "ignore",
    },
  );
  await until(async () => {
    try {
      return (await fetch(base + "/health")).ok ? true : undefined;
    } catch {
      return undefined;
    }
  }, "Restart failed");
  const resumed = await post<{ sessionId: string }>(
    `/v1/workspace-projects/${other.id}/open`,
  );
  const jobs = await get<{ jobs: RenderJob[] }>(
    `/v1/review-sessions/${resumed.sessionId}/render-jobs`,
  );
  assert(
    ["interrupted", "failed"].includes(jobs.jobs[0]!.status),
    "Stopped render resumed automatically",
  );
  console.log(
    JSON.stringify({
      generatedOnly: true,
      livePercent: running.percent,
      reopen: "passed",
      cancelAndCleanup: "passed",
      tokenGuard: "passed",
      retry: "passed",
      separatePreviewFinal: "passed",
      download206: "passed",
      restartRecovery: jobs.jobs[0]!.status,
    }),
  );
} finally {
  await stop();
  await rm(root, { recursive: true, force: true });
}
