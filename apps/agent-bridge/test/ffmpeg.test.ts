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

  test("compiles v2 overlays and independently mixed audio", () => {
    const plan = parseEditPlan({
      version: "2",
      project: { name: "Layered", width: 1_280, height: 720, frameRate: 30 },
      assets: [
        { id: "source", path: "media/source.mp4", kind: "video" },
        { id: "overlay", path: "media/overlay.mp4", kind: "video" },
        { id: "music", path: "media/music.wav", kind: "audio" },
      ],
      timeline: {
        clips: [{ id: "base", assetId: "source", sourceStart: 0, sourceEnd: 5 }],
        overlayTracks: [{
          id: "b-roll",
          zIndex: 2,
          clips: [{
            id: "overlay-clip",
            assetId: "overlay",
            timelineStart: 1,
            sourceStart: 0,
            sourceEnd: 2,
            x: 640,
            y: 0,
            width: 640,
            height: 360,
            opacity: 0.8,
            fit: "cover",
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
            sourceEnd: 6,
            volume: 0.2,
          }],
        }],
      },
      output: { path: "renders/layered.mp4", overwrite: true },
    });

    const compiled = compileEditPlan(
      plan,
      [
        { id: "source", path: "/workspace/media/source.mp4", kind: "video" },
        { id: "overlay", path: "/workspace/media/overlay.mp4", kind: "video" },
        { id: "music", path: "/workspace/media/music.wav", kind: "audio" },
      ],
      "/workspace/renders/layered.mp4",
    );
    const argv = compiled.args.join(" ");
    expect(compiled.durationSeconds).toBe(6.5);
    expect(argv).toContain("overlay=x=640:y=0");
    expect(argv).toContain("amix=inputs=3");
    expect(argv).toContain("adelay=500|500");
    expect(argv).toContain("colorchannelmixer=aa=0.8");
  });
});
