import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inspectMedia, runProcess } from "../src/media.ts";
import { renderPlanValue } from "../src/service.ts";

const root = await mkdtemp(join(tmpdir(), "opencut-multitrack-smoke-"));
await mkdir(join(root, "media"), { recursive: true });
process.env.OPENCUT_AGENT_ROOT = root;

const generate = async (args: string[]) => {
  const result = await runProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  if (result.exitCode !== 0) throw new Error(result.stderr);
};

await generate([
  "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=4",
  "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4",
  "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
  join(root, "media", "base.mp4"),
]);
await generate([
  "-f", "lavfi", "-i", "color=c=red:size=160x90:rate=24:duration=2",
  "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=2",
  "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
  join(root, "media", "overlay.mp4"),
]);
await generate([
  "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=4.5",
  join(root, "media", "music.wav"),
]);
await writeFile(
  join(root, "captions.srt"),
  "1\n00:00:00,400 --> 00:00:01,800\nStyled captions are burned in.\n\n" +
    "2\n00:00:02,100 --> 00:00:03,600\nMusic ducks beneath the primary audio.\n",
);

const plan = {
  version: "2",
  project: { name: "Multitrack smoke", width: 640, height: 360, frameRate: 24 },
  assets: [
    { id: "base", path: "media/base.mp4", kind: "video" },
    { id: "overlay", path: "media/overlay.mp4", kind: "video" },
    { id: "music", path: "media/music.wav", kind: "audio" },
    { id: "captions", path: "captions.srt", kind: "captions" },
  ],
  timeline: {
    clips: [
      { id: "base-one", assetId: "base", sourceStart: 0, sourceEnd: 2.25 },
      { id: "base-two", assetId: "base", sourceStart: 1.75, sourceEnd: 4 },
    ],
    overlayTracks: [{
      id: "b-roll",
      zIndex: 2,
      clips: [{
        id: "overlay-clip",
        assetId: "overlay",
        timelineStart: 1,
        sourceStart: 0,
        sourceEnd: 2,
        x: 440,
        y: 20,
        width: 160,
        height: 90,
        opacity: 0.7,
        includeAudio: true,
      }],
    }],
    audioTracks: [{
      id: "music-track",
      role: "music",
      clips: [{
        id: "music-clip",
        assetId: "music",
        timelineStart: 0.5,
        sourceStart: 0,
        sourceEnd: 4,
        volume: 0.2,
      }],
    }],
    transitions: [{
      id: "main-fade",
      fromClipId: "base-one",
      toClipId: "base-two",
      type: "fade",
      duration: 0.5,
    }],
    titleCards: [
      {
        id: "intro-card",
        template: "intro",
        timelineStart: 0,
        duration: 0.8,
        title: "OpenCut Production Pass",
        subtitle: "Layered, captioned, and mixed",
      },
      {
        id: "outro-card",
        template: "outro",
        timelineStart: 3.2,
        duration: 0.8,
        title: "Ready for review",
      },
    ],
    captionsAssetId: "captions",
    captionStyle: { mode: "both", preset: "bold", marginV: 32 },
    audioMix: {
      ducking: { enabled: true, threshold: 0.03, ratio: 10, attackMs: 20, releaseMs: 250 },
    },
  },
  output: { path: "candidates/production/renders/output.mp4", overwrite: false },
};

await mkdir(join(root, "candidates", "production"), { recursive: true });
await writeFile(join(root, "candidates", "production", "edit-plan.json"), JSON.stringify(plan, null, 2));
await writeFile(join(root, "review-session.json"), JSON.stringify({
  version: "1",
  id: "production-pass",
  title: "Review the complete production pass",
  sourceAssets: [
    { id: "base", label: "Generated A-roll", path: "media/base.mp4" },
    { id: "overlay", label: "Generated B-roll", path: "media/overlay.mp4" },
    { id: "music", label: "Generated music", path: "media/music.wav" },
  ],
  candidates: [{
    id: "production",
    title: "Polished production",
    summary: "Crossfade, B-roll, ducked music, intro/outro cards, and styled captions",
    planPath: "candidates/production/edit-plan.json",
    status: "ready-for-review",
    revision: 1,
  }],
  reviewerNotes: [],
  events: [],
  updatedAt: new Date().toISOString(),
}, null, 2));

const result = await renderPlanValue(plan, "renders/production-smoke.mp4", 5, "preview");
const probe = await inspectMedia(result.outputPath);
console.log(JSON.stringify({ root, result, probe }, null, 2));
