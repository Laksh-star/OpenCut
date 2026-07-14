import { mkdtemp, mkdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runProcess } from "../src/media.ts";
import { approveAndRenderProject } from "../src/service.ts";

const root = await mkdtemp(join(tmpdir(), "opencut-agent-approval-"));
await mkdir(join(root, "media"));
await mkdir(join(root, "renders"));
process.env.OPENCUT_AGENT_ROOT = root;

const sourcePath = join(root, "media", "source.mp4");
const fixtureResult = await runProcess("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=640x360:rate=30",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=48000",
  "-t",
  "3",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  sourcePath,
]);
if (fixtureResult.exitCode !== 0) {
  throw new Error(`Could not generate the approval fixture: ${fixtureResult.stderr}`);
}

const result = await approveAndRenderProject(
  {
    version: "1",
    project: {
      name: "Approval smoke",
      width: 640,
      height: 360,
      frameRate: 30,
      background: "#000000",
    },
    assets: [{ id: "source", path: "media/source.mp4", kind: "video" }],
    timeline: {
      clips: [
        {
          id: "clip-1",
          assetId: "source",
          sourceStart: 0.25,
          sourceEnd: 2.25,
          speed: 1,
          volume: 1,
          includeAudio: true,
        },
      ],
    },
    output: { path: "renders/approved.mp4", overwrite: true },
  },
  { renderLimitSeconds: 10, approvalSource: "web-review" }
);

const project = JSON.parse(
  await readFile(join(root, result.projectRecordPath), "utf8")
) as { status?: string };
const outputStats = await stat(join(root, result.outputPath));
if (project.status !== "rendered" || outputStats.size === 0) {
  throw new Error("Approval smoke did not persist a rendered project");
}

console.log(
  JSON.stringify(
    {
      root,
      projectRecordPath: result.projectRecordPath,
      editPlanPath: result.editPlanPath,
      outputPath: result.outputPath,
      outputBytes: outputStats.size,
      renderedSeconds: result.renderedSeconds,
    },
    null,
    2
  )
);
