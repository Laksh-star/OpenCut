import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runProcess } from "../src/media.ts";

const root = await mkdtemp(join(tmpdir(), "opencut-review-http-"));
const candidateDirectory = join(root, "candidates", "one");
await mkdir(join(candidateDirectory, "renders"), { recursive: true });
const sourcePath = join(root, "source.mp4");
await writeFile(join(root, "captions.srt"), "1\n00:00:00,000 --> 00:00:01,500\nGenerated review caption\n");
const generated = await runProcess("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=24:duration=2",
  "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", sourcePath,
]);
if (generated.exitCode !== 0) throw new Error(generated.stderr);

const plan = {
  version: "1",
  project: { name: "Review session smoke", width: 320, height: 240, frameRate: 24, background: "#000000" },
  assets: [
    { id: "source", path: "source.mp4", kind: "video" },
    { id: "captions", path: "captions.srt", kind: "captions" },
  ],
  timeline: {
    clips: [{ id: "opening", assetId: "source", sourceStart: 0, sourceEnd: 2, speed: 1, volume: 1, includeAudio: true }],
    captionsAssetId: "captions",
  },
  output: { path: "candidates/one/renders/output.mp4", overwrite: false },
};
await writeFile(join(candidateDirectory, "edit-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
await writeFile(join(root, "review-session.json"), `${JSON.stringify({
  version: "1", id: "smoke", title: "Smoke candidates", updatedAt: new Date().toISOString(),
  sourceAssets: [{ id: "source", label: "Generated source", path: "source.mp4" }],
  candidates: [{ id: "one", title: "Opening", summary: "Generated fixture", planPath: "candidates/one/edit-plan.json", status: "ready-for-review" }],
}, null, 2)}\n`);

const port = 33210 + Math.floor(Math.random() * 1000);
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
  const selectedResponse = await fetch(`${base}/v1/review-sessions/${registration.sessionId}/select`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateId: "one" }),
  });
  if (!selectedResponse.ok) throw new Error(await selectedResponse.text());
  const previewResponse = await fetch(`${base}/v1/review-sessions/${registration.sessionId}/render-preview`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidateId: "one", approvalToken: registration.approvalToken, renderLimitSeconds: 2 }),
  });
  if (!previewResponse.ok) throw new Error(await previewResponse.text());
  const previewMedia = await fetch(`${base}/v1/review-sessions/${registration.sessionId}/candidates/one/preview`, {
    headers: { Range: "bytes=0-99" },
  });
  if (previewMedia.status !== 206 || (await previewMedia.arrayBuffer()).byteLength !== 100) {
    throw new Error("Rendered preview range response failed");
  }
  const approvedResponse = await fetch(`${base}/v1/review-sessions/${registration.sessionId}/approve-and-render`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidateId: "one", approvalToken: registration.approvalToken, renderLimitSeconds: 2 }),
  });
  if (!approvedResponse.ok) throw new Error(await approvedResponse.text());
  const approved = await approvedResponse.json() as { session: { candidates: Array<{ status: string }>; events: Array<{ type: string }> } };
  const outputBytes = (await stat(join(candidateDirectory, "renders", "output.mp4"))).size;
  const record = JSON.parse(await readFile(join(candidateDirectory, "opencut.project.json"), "utf8"));
  if (approved.session.candidates[0]?.status !== "rendered" || record.status !== "rendered") throw new Error("Session did not persist rendered state");
  if (!record.provenance?.planSha256 || record.render?.mode !== "final") throw new Error("Final render provenance was not persisted");
  console.log(JSON.stringify({
    root,
    mediaRangeBytes: 100,
    captions: "authorized",
    preview: "rendered-and-streamed",
    outputBytes,
    status: record.status,
    provenance: "sha256",
    events: approved.session.events.map((event) => event.type),
  }, null, 2));
} finally {
  child.kill("SIGTERM");
}
