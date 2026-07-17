import { describe, expect, test } from "vitest"

import {
  buildTimelineSegments,
  formatTimecode,
  getTimelineDuration,
  parseEditPlan,
  sampleEditPlan,
  movePlanClip,
  setPlanCaptionsEnabled,
  updatePlanClip,
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

  test("revises ranges, speed, ordering, and caption inclusion", () => {
    const revised = updatePlanClip(sampleEditPlan, "fire-analogy", {
      sourceStart: 596,
      sourceEnd: 624,
      speed: 1.25,
      volume: 0.8,
    })
    expect(revised.timeline.clips[0]).toMatchObject({ sourceStart: 596, sourceEnd: 624, speed: 1.25, volume: 0.8 })
    expect(movePlanClip(revised, "fire-analogy", 1).timeline.clips[0]?.id).toBe("human-potential")
    expect(setPlanCaptionsEnabled(revised, false).timeline.captionsAssetId).toBeUndefined()
    expect(setPlanCaptionsEnabled(setPlanCaptionsEnabled(revised, false), true).timeline.captionsAssetId).toBe("captions")
  })
})
