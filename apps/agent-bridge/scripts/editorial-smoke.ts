import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inspectMedia, runProcess } from "../src/media.ts";

const temporary = await mkdtemp(join(tmpdir(), "opencut-editorial-http-"));
const root = join(temporary, "fixture");
const fixture = await runProcess(process.execPath, [new URL("./create-editorial-demo.ts", import.meta.url).pathname, root]);
if (fixture.exitCode !== 0) throw new Error(fixture.stderr);
const port = await new Promise<number>((resolve, reject) => {
  const server = createServer();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return server.close(() => reject(new Error("No test port")));
    server.close(() => resolve(address.port));
  });
});
const child = spawn(new URL("../bin/opencut-agent-http", import.meta.url).pathname, [], {
  env: { ...process.env, OPENCUT_AGENT_ROOT: root, OPENCUT_AGENT_HTTP_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout?.on("data", (chunk) => { logs += chunk; });
child.stderr?.on("data", (chunk) => { logs += chunk; });
const base = `http://127.0.0.1:${port}`;
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${base}/health`)).ok) { ready = true; break; } } catch { /* booting */ }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, `The fixture bridge did not start: ${logs}`);
  const registration = await fetch(`${base}/v1/review-sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ manifestPath: "review-session.json" }) });
  assert(registration.ok, "Registration failed");
  const { sessionId, approvalToken } = await registration.json() as { sessionId: string; approvalToken: string };
  const sessionUrl = `${base}/v1/review-sessions/${sessionId}`;
  const post = (action: string, body: object) => fetch(`${sessionUrl}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const identity = { candidateId: "transcript-demo", approvalToken };
  assert((await post("select", identity)).ok, "Selection failed");
  const denied = await post("edits/propose", { ...identity, approvalToken: "00000000-0000-4000-8000-000000000000", expectedRevision: 1, operation: { type: "shorten", seconds: 4 } });
  assert(denied.status === 403, "An invalid edit token was accepted");
  const originalPlan = await readFile(join(root, "candidates/transcript-demo/edit-plan.json"), "utf8");
  const originalCaptions = await readFile(join(root, "candidates/transcript-demo/captions.srt"), "utf8");
  const propose = await post("edits/propose", { ...identity, expectedRevision: 1, operation: { type: "keep", ranges: [{ start: 4, end: 8 }] } });
  assert(propose.ok, `Proposal failed: ${await propose.clone().text()}`);
  const { proposalId } = await propose.json() as { proposalId: string };
  assert(await readFile(join(root, "candidates/transcript-demo/edit-plan.json"), "utf8") === originalPlan, "Proposing changed the plan");
  const saved = await post("edits/apply", { ...identity, expectedRevision: 1, proposalId });
  assert(saved.ok, `Save failed: ${await saved.clone().text()}`);
  assert((await post("edits/propose", { ...identity, expectedRevision: 1, operation: { type: "shorten", seconds: 2 } })).status === 409, "A stale revision was accepted");
  assert((await post("edits/undo", { ...identity, expectedRevision: 2 })).ok, "Undo failed");
  const quietResponse = await post("edits/silence", { ...identity, expectedRevision: 3 });
  assert(quietResponse.ok, `Pause analysis failed: ${await quietResponse.clone().text()}`);
  const quiet = await quietResponse.json() as { ranges: Array<{ start: number; end: number }> };
  assert(quiet.ranges.length === 1 && quiet.ranges[0]!.start > 2.4 && quiet.ranges[0]!.end < 3.8, "Pause analysis did not find the bounded quiet interval");
  const shortened = await post("edits/propose", { ...identity, expectedRevision: 3, operation: { type: "shorten", seconds: 4 }, protectedRanges: [{ start: 6.2, end: 7.8 }] });
  assert(shortened.ok, "Protected shorten proposal failed");
  const secondProposal = await shortened.json() as { proposalId: string };
  const shortenedSave = await post("edits/apply", { ...identity, expectedRevision: 3, proposalId: secondProposal.proposalId });
  assert(shortenedSave.ok, `Protected save failed: ${await shortenedSave.clone().text()}`);
  const beforePreview = await post("approve-and-render", { ...identity, renderLimitSeconds: 8 });
  assert(!beforePreview.ok && (await beforePreview.text()).includes("preview"), "Final rendering did not require a current preview");
  const preview = await post("render-preview", { ...identity, renderLimitSeconds: 8 });
  assert(preview.ok, `Preview failed: ${await preview.clone().text()}`);
  const rendered = await post("approve-and-render", { ...identity, renderLimitSeconds: 8 });
  assert(rendered.ok, `Final fixture render failed: ${await rendered.clone().text()}`);
  const session = await rendered.json() as { session: { candidates: Array<{ id: string; revision: number; status: string }>; events: Array<{ type: string; revision?: number }> } };
  assert(session.session.candidates.find((candidate) => candidate.id === identity.candidateId)?.revision === 4, "Unexpected final revision");
  assert(session.session.events.some((event) => event.type === "preview-rendered" && event.revision === 4), "No revision-specific preview event");
  assert(session.session.events.some((event) => event.type === "final-rendered" && event.revision === 4), "No revision-specific final event");
  const exported = await post("export-package", { ...identity, candidateIds: [identity.candidateId], includeContactSheets: true });
  assert(exported.ok, `Export failed: ${await exported.clone().text()}`);
  const probe = await inspectMedia(join(root, "candidates/transcript-demo/renders/output.mp4")) as { format: { duration: string }; streams: Array<{ codec_name: string }> };
  assert(Math.abs(Number(probe.format.duration) - 4) < 0.05, "The edited fixture rendered at the wrong duration");
  assert(probe.streams.some((stream) => stream.codec_name === "mov_text"), "The edited fixture lost its subtitle track");
  assert(await readFile(join(root, "candidates/transcript-demo/captions.srt"), "utf8") === originalCaptions, "Original captions were overwritten");
  console.log(JSON.stringify({ syntheticMediaOnly: true, invalidToken: denied.status, staleRevision: 409, pauseSuggestions: quiet.ranges,
    revision: 4, durationSeconds: Number(probe.format.duration), codecs: probe.streams.map((stream) => stream.codec_name),
    previewFinalAndExport: "passed", originalCaptions: "preserved" }, null, 2));
} finally {
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => { if (child.exitCode !== null) resolve(); else child.once("exit", () => resolve()); });
  await rm(temporary, { recursive: true, force: true });
}
