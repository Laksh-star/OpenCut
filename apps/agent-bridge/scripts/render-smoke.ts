import { mkdtemp, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { runProcess } from "../src/media.ts";

const root = await mkdtemp(join(tmpdir(), "opencut-agent-render-"));
await mkdir(join(root, "media"));
await mkdir(join(root, "renders"));

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
  throw new Error(`Could not generate the smoke fixture: ${fixtureResult.stderr}`);
}

const transport = new StdioClientTransport({
  command: new URL("../bin/opencut-agent", import.meta.url).pathname,
  args: [],
  env: { ...process.env, OPENCUT_AGENT_ROOT: root },
});
const client = new Client({ name: "opencut-render-smoke", version: "0.1.0" });
await client.connect(transport);

const plan = {
  version: "1",
  project: {
    name: "Render smoke",
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
  output: { path: "renders/preview.mp4", overwrite: false },
};

await client.callTool({
  name: "opencut_inspect_media",
  arguments: { path: "media/source.mp4" },
});
await client.callTool({
  name: "opencut_save_edit_plan",
  arguments: { path: "plan.json", plan },
});
const renderResult = await client.callTool({
  name: "opencut_render_preview",
  arguments: { planPath: "plan.json", durationSeconds: 2 },
});
await client.close();

const outputPath = join(root, "renders", "preview.mp4");
const outputStats = await stat(outputPath);
if (outputStats.size === 0) {
  throw new Error("Rendered preview is empty");
}

console.log(
  JSON.stringify(
    {
      root,
      outputPath,
      outputBytes: outputStats.size,
      renderResult,
    },
    null,
    2
  )
);
