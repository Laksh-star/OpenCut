import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";

import { parseSrtCues, preparePlanGraphics } from "../src/graphics.ts";
import { parseEditPlan } from "../src/schema.ts";

describe("production graphics", () => {
  test("parses SRT and rasterizes title and styled caption overlays", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencut-graphics-"));
    const captionsPath = join(root, "captions.srt");
    const srt = "1\n00:00:00,500 --> 00:00:02,000\nA clear caption line.\n";
    await writeFile(captionsPath, srt);
    expect(parseSrtCues(srt)).toEqual([{ start: 0.5, end: 2, text: "A clear caption line." }]);

    const plan = parseEditPlan({
      version: "2",
      project: { name: "Graphics", width: 640, height: 360, frameRate: 24 },
      assets: [
        { id: "source", path: "source.mp4", kind: "video" },
        { id: "captions", path: "captions.srt", kind: "captions" },
      ],
      timeline: {
        clips: [{ id: "base", assetId: "source", sourceStart: 0, sourceEnd: 3 }],
        titleCards: [{ id: "intro", timelineStart: 0, duration: 1, title: "OpenCut", subtitle: "Production pass" }],
        captionsAssetId: "captions",
        captionStyle: { mode: "burn-in", preset: "bold" },
      },
      output: { path: "renders/output.mp4" },
    });
    if (plan.version !== "2") throw new Error("Expected v2 plan");
    const graphics = await preparePlanGraphics(root, plan, [
      { id: "source", path: join(root, "source.mp4"), kind: "video" },
      { id: "captions", path: captionsPath, kind: "captions" },
    ]);
    expect(graphics.map((graphic) => graphic.kind)).toEqual(["title", "caption"]);
    const metadata = await sharp(graphics[0]!.path).metadata();
    expect(metadata.width).toBe(640);
    expect(metadata.height).toBe(360);
  });
});
