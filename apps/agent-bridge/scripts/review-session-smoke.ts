import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runProcess } from "../src/media.ts";

const allocatePort = async () => new Promise<number>((resolve, reject) => {
  const server = createNetServer();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close(() => reject(new Error("Could not allocate a local TCP port")));
      return;
    }
    const { port } = address;
    server.close(() => resolve(port));
  });
});

const root = await mkdtemp(join(tmpdir(), "opencut-review-http-"));
const candidateOneDirectory = join(root, "candidates", "one");
const candidateTwoDirectory = join(root, "candidates", "two");
await mkdir(join(candidateOneDirectory, "renders"), { recursive: true });
await mkdir(join(candidateTwoDirectory, "renders"), { recursive: true });
const sourcePath = join(root, "source.mp4");
await writeFile(join(root, "captions.srt"), "1\n00:00:00,000 --> 00:00:01,500\nGenerated review caption\n");
const generated = await runProcess("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=24:duration=2",
  "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", sourcePath,
]);
if (generated.exitCode !== 0) throw new Error(generated.stderr);

const planFor = (candidateId: "one" | "two", clipId: string, sourceStart: number, sourceEnd: number) => ({
  version: "1",
  project: { name: "Review session smoke", width: 320, height: 240, frameRate: 24, background: "#000000" },
  assets: [
    { id: "source", path: "source.mp4", kind: "video" },
    { id: "captions", path: "captions.srt", kind: "captions" },
  ],
  timeline: {
    clips: [{ id: clipId, assetId: "source", sourceStart, sourceEnd, speed: 1, volume: 1, includeAudio: true }],
    captionsAssetId: "captions",
  },
  output: { path: `candidates/${candidateId}/renders/output.mp4`, overwrite: false },
});
await writeFile(join(candidateOneDirectory, "edit-plan.json"), `${JSON.stringify(planFor("one", "opening", 0, 2), null, 2)}\n`);
await writeFile(join(candidateTwoDirectory, "edit-plan.json"), `${JSON.stringify(planFor("two", "alternate", 0.2, 1.8), null, 2)}\n`);
await writeFile(join(root, "review-session.json"), `${JSON.stringify({
  version: "1", id: "smoke", title: "Smoke candidates", updatedAt: new Date().toISOString(),
  sourceAssets: [{ id: "source", label: "Generated source", path: "source.mp4" }],
  candidates: [
    { id: "one", title: "Opening", summary: "Generated fixture", planPath: "candidates/one/edit-plan.json", status: "ready-for-review" },
    { id: "two", title: "Alternate", summary: "Second generated fixture", planPath: "candidates/two/edit-plan.json", status: "ready-for-review" },
  ],
}, null, 2)}\n`);

const port = await allocatePort();
const child = spawn(new URL("../bin/opencut-agent-http", import.meta.url).pathname, [], {
  env: { ...process.env, OPENCUT_AGENT_ROOT: root, OPENCUT_AGENT_HTTP_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let childOutput = "";
let childError = "";
child.stdout?.on("data", (chunk) => { childOutput += chunk.toString(); });
child.stderr?.on("data", (chunk) => { childError += chunk.toString(); });
const base = `http://127.0.0.1:${port}`;
try {
  let bridgeReady = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${base}/health`)).ok) {
        bridgeReady = true;
        break;
      }
    } catch {}
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!bridgeReady) {
    throw new Error(`Bridge did not start (exit ${child.exitCode ?? "running"}).\nstdout: ${childOutput}\nstderr: ${childError}`);
  }
  const registrationResponse = await fetch(`${base}/v1/review-sessions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ manifestPath: "review-session.json" }),
  });
  if (!registrationResponse.ok) throw new Error(await registrationResponse.text());
  const registration = await registrationResponse.json() as { sessionId: string; approvalToken: string };
  const media = await fetch(`${base}/v1/review-sessions/${registration.sessionId}/media/source`, { headers: { Range: "bytes=0-99" } });
  if (media.status !== 206 || (await media.arrayBuffer()).byteLength !== 100) throw new Error("Media range response failed");
  const captions = await fetch(`${base}/v1/review-sessions/${registration.sessionId}/candidates/one/captions`);
  const captionsPayload = await captions.json() as { contents?: string };
  if (!captions.ok || !captionsPayload.contents?.includes("Generated review caption")) throw new Error("Session caption response failed");
  for (const candidateId of ["one", "two"] as const) {
    const selectedResponse = await fetch(`${base}/v1/review-sessions/${registration.sessionId}/select`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateId }),
    });
    if (!selectedResponse.ok) throw new Error(await selectedResponse.text());
    const previewResponse = await fetch(`${base}/v1/review-sessions/${registration.sessionId}/render-preview`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId, approvalToken: registration.approvalToken, renderLimitSeconds: 2 }),
    });
    if (!previewResponse.ok) throw new Error(await previewResponse.text());
  }
  const previewMedia = await fetch(`${base}/v1/review-sessions/${registration.sessionId}/candidates/one/preview`, {
    headers: { Range: "bytes=0-99" },
  });
  if (previewMedia.status !== 206 || (await previewMedia.arrayBuffer()).byteLength !== 100) {
    throw new Error("Rendered preview range response failed");
  }
  const preflightResponse = await fetch(`${base}/v1/review-sessions/${registration.sessionId}/preflight`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidateIds: ["one", "two"], mode: "batch", renderLimitSeconds: 2 }),
  });
  if (!preflightResponse.ok) throw new Error(await preflightResponse.text());
  const preflight = await preflightResponse.json() as { summary: { block: number } };
  if (preflight.summary.block !== 0) throw new Error("Batch preflight unexpectedly blocked");
  const approvedResponse = await fetch(`${base}/v1/review-sessions/${registration.sessionId}/approve-batch`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidateIds: ["one", "two"], approvalToken: registration.approvalToken, renderLimitSeconds: 2 }),
  });
  if (!approvedResponse.ok) throw new Error(await approvedResponse.text());
  const approved = await approvedResponse.json() as {
    status: string;
    results: Array<{ candidateId: string; status: string }>;
    session: { candidates: Array<{ id: string; status: string }>; renderBatches: Array<{ status: string; items: Array<{ status: string }> }>; events: Array<{ type: string }> };
  };
  const outputOneBytes = (await stat(join(candidateOneDirectory, "renders", "output.mp4"))).size;
  const outputTwoBytes = (await stat(join(candidateTwoDirectory, "renders", "output.mp4"))).size;
  const recordOne = JSON.parse(await readFile(join(candidateOneDirectory, "opencut.project.json"), "utf8"));
  const recordTwo = JSON.parse(await readFile(join(candidateTwoDirectory, "opencut.project.json"), "utf8"));
  if (approved.status !== "completed" || approved.results.some((result) => result.status !== "rendered")) throw new Error("Batch did not complete");
  if (approved.session.candidates.some((candidate) => candidate.status !== "rendered") || recordOne.status !== "rendered" || recordTwo.status !== "rendered") throw new Error("Session did not persist rendered state");
  if (approved.session.renderBatches.at(-1)?.status !== "completed") throw new Error("Batch status was not persisted");
  if (!recordOne.provenance?.planSha256 || !recordTwo.provenance?.planSha256 || recordOne.render?.mode !== "final" || recordTwo.render?.mode !== "final") throw new Error("Final render provenance was not persisted");
  const exportResponse = await fetch(`${base}/v1/review-sessions/${registration.sessionId}/export-package`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approvalToken: registration.approvalToken, includeContactSheets: true }),
  });
  if (!exportResponse.ok) throw new Error(await exportResponse.text());
  const exported = await exportResponse.json() as {
    exportPackage: { manifestPath: string; summaryPath: string; candidates: Array<{ packagedOutputPath: string; contactSheetPath?: string }> };
    session: { exportPackages: Array<{ id: string }> };
  };
  if (exported.exportPackage.candidates.length !== 2 || exported.session.exportPackages.length !== 1) throw new Error("Export package was not persisted");
  if (!(await Bun.file(join(root, exported.exportPackage.manifestPath)).exists()) || !(await Bun.file(join(root, exported.exportPackage.summaryPath)).exists())) {
    throw new Error("Export package manifest or summary was not written");
  }
  console.log(JSON.stringify({
    root,
    mediaRangeBytes: 100,
    captions: "authorized",
    preflight: "passed",
    preview: "rendered-and-streamed",
    outputBytes: [outputOneBytes, outputTwoBytes],
    status: approved.status,
    exportPackage: exported.exportPackage.manifestPath,
    provenance: "sha256",
    events: exported.session.exportPackages.length,
  }, null, 2));
} finally {
  child.kill("SIGTERM");
}
