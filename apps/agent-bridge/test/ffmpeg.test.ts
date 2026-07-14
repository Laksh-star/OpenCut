import { describe, expect, test } from "bun:test";

import { compileEditPlan } from "../src/ffmpeg.ts";
import { parseEditPlan } from "../src/schema.ts";

describe("compileEditPlan", () => {
  test("compiles clips without invoking a shell", () => {
    const plan = parseEditPlan({
      version: "1",
      project: {
        name: "Demo",
        width: 1_080,
        height: 1_920,
        frameRate: 30,
        background: "#000000",
      },
      assets: [{ id: "source", path: "media/source.mp4", kind: "video" }],
      timeline: {
        clips: [
          {
            id: "clip-1",
            assetId: "source",
            sourceStart: 10,
            sourceEnd: 14,
            speed: 2,
            volume: 0.75,
            includeAudio: true,
          },
        ],
      },
      output: { path: "renders/preview.mp4", overwrite: false },
    });

    const compiled = compileEditPlan(
      plan,
      [{ id: "source", path: "/workspace/media/source.mp4", kind: "video" }],
      "/workspace/renders/preview.mp4",
      30
    );

    expect(compiled.command).toBe("ffmpeg");
    expect(compiled.durationSeconds).toBe(2);
    expect(compiled.args).toContain("/workspace/media/source.mp4");
    expect(compiled.args.join(" ")).toContain("concat=n=1:v=1:a=1");
    expect(compiled.args).not.toContain("sh");
  });

  test("uses generated silence when clip audio is disabled", () => {
    const plan = parseEditPlan({
      version: "1",
      project: { name: "Silent", width: 1_280, height: 720 },
      assets: [{ id: "source", path: "media/source.mp4", kind: "video" }],
      timeline: {
        clips: [
          {
            id: "clip-1",
            assetId: "source",
            sourceStart: 0,
            sourceEnd: 3,
            includeAudio: false,
          },
        ],
      },
      output: { path: "renders/silent.mp4" },
    });

    const compiled = compileEditPlan(
      plan,
      [{ id: "source", path: "/workspace/media/source.mp4", kind: "video" }],
      "/workspace/renders/silent.mp4"
    );
    expect(compiled.args.join(" ")).toContain("anullsrc");
  });
});
