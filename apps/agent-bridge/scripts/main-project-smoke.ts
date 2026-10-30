import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { captionsToSrt } from "../src/captions.ts";
import { inspectMedia, runProcess } from "../src/media.ts";
import type { LoadedReviewSession } from "../src/review-session.ts";
import type { WorkspaceProject } from "../src/workspace-projects.ts";

const root = await realpath(
  await mkdtemp(join(tmpdir(), "opencut-main-http-")),
);
const port = await new Promise<number>((resolve) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const address = server.address() as { port: number };
    server.close(() => resolve(address.port));
  });
});
const base = `http://127.0.0.1:${port}`;
const startServer = () =>
  spawn(new URL("../bin/opencut-agent-http", import.meta.url).pathname, [], {
    env: {
      ...process.env,
      OPENCUT_AGENT_ROOT: root,
      OPENCUT_AGENT_HTTP_PORT: String(port),
    },
    stdio: "ignore",
  });
let child = startServer();
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
async function ready() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server did not start");
}
async function post<T>(path: string, body: object = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(`${path}: ${result.error}`);
  return result;
}
async function stop() {
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once("exit", () => resolve());
  });
}
try {
  const source = join(root, "long-source.mp4");
  const generated = await runProcess("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x240:r=1:d=301",
    "-c:v",
    "libx264",
    source,
  ]);
  assert(generated.exitCode === 0, generated.stderr);
  const captionsPath = join(root, "captions.srt");
  await writeFile(
    captionsPath,
    captionsToSrt(
      Array.from({ length: 201 }, (_, i) => ({
        start: i,
        end: i + 0.9,
        text: `Caption ${i + 1}`,
      })),
    ),
  );
  const logoPath = join(root, "logo.png");
  await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 250, g: 0, b: 0, alpha: 0.8 },
    },
  })
    .png()
    .toFile(logoPath);
  await ready();
  const project = await post<WorkspaceProject>("/v1/workspace-projects", {
    name: "301 second synthetic project",
    sourcePath: source,
  });
  const opened = await post<{ sessionId: string; approvalToken: string }>(
    `/v1/workspace-projects/${project.id}/open`,
  );
  const url = `/v1/review-sessions/${opened.sessionId}`;
  const initial = (await (
    await fetch(`${base}${url}`)
  ).json()) as LoadedReviewSession;
  const plan = initial.candidates[0]!.plan;
  assert(plan.version === "2", "Not a v2 main project");
  const saved = await post<LoadedReviewSession>(`${url}/revise`, {
    candidateId: "master",
    expectedRevision: 1,
    plan: {
      ...plan,
      assets: [
        ...plan.assets,
        { id: "captions", path: captionsPath, kind: "captions" },
        { id: "logo", path: logoPath, kind: "video" },
      ],
      timeline: {
        ...plan.timeline,
        captionsAssetId: "captions",
        subtitleProvider: { mode: "provided-captions", status: "provided" },
        captionStyle: {
          mode: "both",
          preset: "clean",
          fontSize: 20,
          marginV: 12,
        },
        overlayTracks: [
          {
            id: "logo-track",
            clips: [
              {
                id: "logo",
                assetId: "logo",
                sourceStart: 0,
                sourceEnd: 301,
                timelineStart: 0,
                x: 272,
                y: 16,
                width: 32,
                height: 32,
                includeAudio: false,
              },
            ],
          },
        ],
        titleCards: [
          {
            id: "intro",
            timelineStart: 0,
            duration: 3,
            template: "lower-third",
            title: "Full project",
          },
        ],
      },
    },
  });
  assert(
    saved.candidates[0]!.revision === 2 && !saved.candidates[0]!.previewExists,
    "Save did not create a clean revision",
  );
  const identity = {
    candidateId: "master",
    approvalToken: opened.approvalToken,
    renderLimitSeconds: 301,
  };
  const denied = await fetch(`${base}${url}/approve-and-render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(identity),
  });
  assert(
    !denied.ok && (await denied.text()).includes("preview"),
    "Final approval bypassed preview",
  );
  await post(`${url}/render-preview`, identity);
  const preview = await fetch(`${base}${url}/candidates/master/preview`, {
    headers: { Range: "bytes=0-1023" },
  });
  assert(preview.status === 206, "Preview streaming failed");
  await preview.arrayBuffer();
  await post(`${url}/approve-and-render`, identity);
  const probe = (await inspectMedia(saved.candidates[0]!.plan.output.path)) as {
    format: { duration: string };
    streams: Array<{ codec_name: string }>;
  };
  assert(
    Math.abs(Number(probe.format.duration) - 301) < 0.1,
    "The final was truncated at five minutes",
  );
  assert(
    probe.streams.some((stream) => stream.codec_name === "mov_text"),
    "The selectable caption track was lost",
  );
  const download = await fetch(
    `${base}${url}/candidates/master/output?download=1`,
    { headers: { Range: "bytes=0-255" } },
  );
  assert(
    download.status === 206 &&
      download.headers.get("content-disposition")?.includes("attachment"),
    "Final download failed",
  );
  await download.arrayBuffer();
  const before = await readFile(project.manifestPath, "utf8");
  const clip = await post<{ project: WorkspaceProject }>(
    `/v1/workspace-projects/${project.id}/clips`,
    { title: "Derived clip", start: 120, end: 150, expectedRevision: 2 },
  );
  assert(
    clip.project.parentProjectId === project.id &&
      before === (await readFile(project.manifestPath, "utf8")),
    "Creating a clip changed its main edit",
  );
  await post(`${url}/export-package`, {
    approvalToken: opened.approvalToken,
    includeContactSheets: false,
  });
  const copy = await post<WorkspaceProject>(
    `/v1/workspace-projects/${project.id}/duplicate`,
  );
  assert(copy.id !== project.id, "Editable copy reused the original project");
  const interruptedManifest = JSON.parse(await readFile(copy.manifestPath, "utf8"));
  interruptedManifest.candidates[0].status = "previewing";
  await writeFile(copy.manifestPath, JSON.stringify(interruptedManifest));
  await stop();
  child = startServer();
  await ready();
  const reopened = await post<{ sessionId: string }>(
    `/v1/workspace-projects/${project.id}/open`,
  );
  const resumed = (await (
    await fetch(`${base}/v1/review-sessions/${reopened.sessionId}`)
  ).json()) as LoadedReviewSession;
  assert(
    resumed.candidates[0]!.revision === 2 &&
      resumed.candidates[0]!.outputExists,
    "Restart lost saved edits or export",
  );
  const interruptedOpen = await post<{ sessionId: string }>(`/v1/workspace-projects/${copy.id}/open`);
  const recovered = await (await fetch(`${base}/v1/review-sessions/${interruptedOpen.sessionId}`)).json() as LoadedReviewSession;
  assert(recovered.candidates[0]!.status === "failed" && !recovered.candidates[0]!.outputExists, "Interrupted draft was not recovered for retry");
  console.log(
    JSON.stringify(
      {
        syntheticMediaOnly: true,
        durationSeconds: Number(probe.format.duration),
        burnedAndSelectableCaptions: 201,
        codecs: probe.streams.map((stream) => stream.codec_name),
        previewFinalExport: "passed",
        finalDownload: download.status,
        clipIsolation: "passed",
        restartResume: "passed",
      interruptedDraftRecovery: "passed",
      },
      null,
      2,
    ),
  );
} finally {
  await stop();
  await rm(root, { recursive: true, force: true });
}
