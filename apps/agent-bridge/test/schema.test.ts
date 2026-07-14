import { describe, expect, test } from "bun:test";

import { parseEditPlan } from "../src/schema.ts";

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
});
