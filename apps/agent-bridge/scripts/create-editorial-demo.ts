import { mkdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { runProcess } from "../src/media.ts";
import { editPlanSchema } from "../src/schema.ts";

const requestedRoot = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (!requestedRoot) throw new Error("Usage: bun run scripts/create-editorial-demo.ts <new-directory-outside-repository>");
const root = join(await realpath(dirname(requestedRoot)), basename(requestedRoot));
const repositoryRoot = await realpath(fileURLToPath(new URL("../../..", import.meta.url)));
const within = relative(repositoryRoot, root);
if (!within || within !== ".." && !within.startsWith(`..${sep}`) && !isAbsolute(within)) throw new Error("Generated demo media must remain outside the source repository.");
await mkdir(root); // Refuse to overwrite an existing demo or user project.
const result = await runProcess("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-nostdin",
  "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=8",
  "-f", "lavfi", "-i", "aevalsrc=if(between(t\\,2.4\\,3.8)\\,0\\,0.1*sin(2*PI*440*t)):s=48000:d=8",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", `${root}/source.mp4`,
]);
if (result.exitCode !== 0) throw new Error(result.stderr);
const captions = "1\n00:00:00,200 --> 00:00:01,800\nFirst answer: keep the context.\n\n2\n00:00:02,600 --> 00:00:03,000\nUm...\n\n3\n00:00:04,400 --> 00:00:06,000\nSecond answer: the core idea.\n\n4\n00:00:06,200 --> 00:00:07,800\nThe ending stays under your control.\n";
const legacyCaptions = "1\n00:00:00,600 --> 00:00:01,000\nUm...\n\n2\n00:00:02,400 --> 00:00:04,000\nSecond answer: the core idea.\n\n3\n00:00:04,200 --> 00:00:05,800\nThe ending stays under your control.\n";
for (const id of ["transcript-demo", "legacy-demo"]) {
  await mkdir(`${root}/candidates/${id}`, { recursive: true });
  await writeFile(`${root}/candidates/${id}/captions.srt`, id === "legacy-demo" ? legacyCaptions : captions);
  const plan = editPlanSchema.parse({
    version: id === "legacy-demo" ? "1" : "2",
    project: { name: "Transcript editing verification", width: 640, height: 360, frameRate: 24 },
    assets: [{ id: "source", kind: "video", path: "source.mp4" }, { id: "captions", kind: "captions", path: `candidates/${id}/captions.srt` }],
    timeline: {
      clips: id === "legacy-demo" ? [{ id: "legacy", assetId: "source", sourceStart: 2, sourceEnd: 8 }]
        : [{ id: "opening", assetId: "source", sourceStart: 0, sourceEnd: 4 }, { id: "answer", assetId: "source", sourceStart: 4, sourceEnd: 8 }],
      captionsAssetId: "captions",
      subtitleProvider: { mode: "provided-captions", status: "provided" },
      captionStyle: { mode: "both", preset: "clean", fontSize: 24, marginV: 24 },
      titleCards: [{ id: "intro", template: "lower-third", title: "Generated test media", timelineStart: 0, duration: 2 }],
      overlayTracks: [{ id: "picture", clips: [{ id: "overlay", assetId: "source", sourceStart: 0, sourceEnd: 2, timelineStart: 4, x: 450, y: 20, width: 160, height: 90 }] }],
    }, output: { path: `candidates/${id}/renders/output.mp4`, overwrite: false },
  });
  await writeFile(`${root}/candidates/${id}/edit-plan.json`, `${JSON.stringify(plan, null, 2)}\n`);
}
await writeFile(`${root}/review-session.json`, `${JSON.stringify({
  version: "1", id: "transcript-editing-demo", title: "Transcript editing · generated test media", updatedAt: new Date().toISOString(),
  sourceAssets: [{ id: "source", label: "Generated color pattern and test tone", path: "source.mp4" }],
  candidates: ["transcript-demo", "legacy-demo"].map((id) => ({
    id, title: id === "transcript-demo" ? "Transcript demo · v2 production plan" : "Legacy demo · v1 plan", revision: 1, status: "ready-for-review",
    strategy: "manual", summary: "Synthetic footage and illustrative captions for testing edits, revisions, approval and export.",
    rationale: "Verification fixture only. These captions do not describe spoken content; the audio is a generated tone with a quiet interval.",
    planPath: `candidates/${id}/edit-plan.json`,
  })),
}, null, 2)}\n`);
console.log(JSON.stringify({ root, manifestPath: `${root}/review-session.json`, syntheticMedia: true }, null, 2));
