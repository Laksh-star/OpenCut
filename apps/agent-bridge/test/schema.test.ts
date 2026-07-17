import { describe, expect, test } from "bun:test";

import { getPlanDuration, parseEditPlan, upgradeEditPlanToV2 } from "../src/schema.ts";

const validPlan = {
  version: "1",
  project: {
    name: "Demo reel",
    width: 1_080,
    height: 1_920,
  },
  assets: [{ id: "source", path: "media/source.mp4", kind: "video" }],
  timeline: {
    clips: [
      {
        id: "opening",
        assetId: "source",
        sourceStart: 2,
        sourceEnd: 7,
      },
    ],
  },
  output: { path: "renders/preview.mp4" },
};

describe("editPlanSchema", () => {
  test("applies safe defaults", () => {
    const plan = parseEditPlan(validPlan);
    expect(plan.project.frameRate).toBe(30);
    expect(plan.timeline.clips[0]?.speed).toBe(1);
    expect(plan.output.overwrite).toBe(false);
  });

  test("rejects unknown clip assets", () => {
    const plan = structuredClone(validPlan);
    plan.timeline.clips[0]!.assetId = "missing";
    expect(() => parseEditPlan(plan)).toThrow("Unknown asset id");
  });

  test("rejects non-MP4 output", () => {
    const plan = structuredClone(validPlan);
    plan.output.path = "renders/preview.webm";
    expect(() => parseEditPlan(plan)).toThrow(".mp4");
  });

  test("upgrades v1 plans to a backward-compatible v2 primary track", () => {
    const plan = upgradeEditPlanToV2(validPlan);
    expect(plan.version).toBe("2");
    expect(plan.timeline.clips).toHaveLength(1);
    expect(plan.timeline.overlayTracks).toEqual([]);
    expect(plan.timeline.audioTracks).toEqual([]);
  });

  test("validates multi-track overlays and audio and includes them in duration", () => {
    const plan = parseEditPlan({
      ...validPlan,
      version: "2",
      assets: [
        ...validPlan.assets,
        { id: "b-roll", path: "media/b-roll.mp4", kind: "video" },
        { id: "music", path: "media/music.wav", kind: "audio" },
      ],
      timeline: {
        ...validPlan.timeline,
        overlayTracks: [{
          id: "b-roll-track",
          zIndex: 2,
          clips: [{
            id: "b-roll-clip",
            assetId: "b-roll",
            timelineStart: 1,
            sourceStart: 0,
            sourceEnd: 3,
            width: 540,
            height: 960,
          }],
        }],
        audioTracks: [{
          id: "music-track",
          clips: [{
            id: "music-clip",
            assetId: "music",
            timelineStart: 0,
            sourceStart: 0,
            sourceEnd: 8,
            volume: 0.25,
          }],
        }],
      },
    });
    expect(plan.version).toBe("2");
    expect(getPlanDuration(plan)).toBe(8);
  });

  test("rejects overlays outside the project canvas", () => {
    expect(() => parseEditPlan({
      ...validPlan,
      version: "2",
      assets: [...validPlan.assets, { id: "b-roll", path: "media/b-roll.mp4", kind: "video" }],
      timeline: {
        ...validPlan.timeline,
        overlayTracks: [{
          id: "overlay",
          clips: [{
            id: "outside",
            assetId: "b-roll",
            timelineStart: 0,
            sourceStart: 0,
            sourceEnd: 2,
            x: 800,
            width: 400,
            height: 400,
          }],
        }],
      },
    })).toThrow("project canvas");
  });
});
