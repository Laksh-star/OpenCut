import { describe, expect, test } from "vitest"

import {
  buildTimelineSegments,
  formatTimecode,
  getTimelineDuration,
  parseEditPlan,
  sampleEditPlan,
} from "./edit-plan.ts"

describe("edit plan review model", () => {
  test("uses the agent bridge schema for imported plans", () => {
    const plan = parseEditPlan(sampleEditPlan)

    expect(plan.project.name).toBe("The Matchstick Within")
    expect(plan.timeline.clips).toHaveLength(2)
  })

  test("maps sequential clips onto output timeline positions", () => {
    const segments = buildTimelineSegments(sampleEditPlan)

    expect(segments[0]?.timelineStart).toBe(0)
    expect(segments[0]?.durationSeconds).toBeCloseTo(30 / 1.15)
    expect(segments[1]?.timelineStart).toBeCloseTo(30 / 1.15)
    expect(getTimelineDuration(sampleEditPlan)).toBeCloseTo(70 / 1.15)
  })

  test("rejects plans that reference missing assets", () => {
    expect(() =>
      parseEditPlan({
        ...sampleEditPlan,
        timeline: {
          clips: [{ ...sampleEditPlan.timeline.clips[0], assetId: "missing" }],
        },
      }),
    ).toThrow("Unknown asset id")
  })

  test("formats editor timecodes", () => {
    expect(formatTimecode(65.8)).toBe("1:05.8")
  })
})

