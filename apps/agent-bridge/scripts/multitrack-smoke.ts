import { mkdtemp, mkdir } from "node:fs/promises";
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

const plan = {
  version: "2",
  project: { name: "Multitrack smoke", width: 640, height: 360, frameRate: 24 },
  assets: [
    { id: "base", path: "media/base.mp4", kind: "video" },
    { id: "overlay", path: "media/overlay.mp4", kind: "video" },
    { id: "music", path: "media/music.wav", kind: "audio" },
  ],
  timeline: {
    clips: [{ id: "base-clip", assetId: "base", sourceStart: 0, sourceEnd: 4 }],
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
      clips: [{
        id: "music-clip",
        assetId: "music",
        timelineStart: 0.5,
        sourceStart: 0,
        sourceEnd: 4,
        volume: 0.1,
      }],
    }],
  },
  output: { path: "renders/layered.mp4", overwrite: true },
};

const result = await renderPlanValue(plan, plan.output.path, 5, "preview");
const probe = await inspectMedia(result.outputPath);
console.log(JSON.stringify({ root, result, probe }, null, 2));
