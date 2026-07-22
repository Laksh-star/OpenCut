import { describe, expect, test } from "vitest"

import {
  applyProductionPreset,
  buildTimelineSegments,
  formatTimecode,
  getTitleCardCanvasBox,
  getPlanTrackCounts,
  getTimelineDuration,
  parseEditPlan,
  sampleEditPlan,
  movePlanClip,
  setPlanCaptionsEnabled,
  updateAudioClip,
  updateAudioTrack,
  updateCaptionStyle,
  updateDucking,
  updateOverlayClip,
  updateOverlayClipCanvasBox,
  updatePlanClip,
  updateTitleCard,
  updateTitleCardCanvasBox,
  updateTransition,
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

  test("summarizes v2 overlay and audio tracks", () => {
    const layered = parseEditPlan({
      ...sampleEditPlan,
      version: "2",
      assets: [
        ...sampleEditPlan.assets,
        { id: "overlay", path: "media/overlay.mp4", kind: "video" },
        { id: "music", path: "media/music.wav", kind: "audio" },
      ],
      timeline: {
        ...sampleEditPlan.timeline,
        overlayTracks: [{ id: "b-roll", clips: [{ id: "b-roll-1", assetId: "overlay", timelineStart: 3, sourceStart: 0, sourceEnd: 2, width: 640, height: 360 }] }],
        audioTracks: [{ id: "music", role: "music", clips: [{ id: "music-1", assetId: "music", timelineStart: 0, sourceStart: 0, sourceEnd: 70 }] }],
        titleCards: [{ id: "intro", timelineStart: 0, duration: 2, title: "Opening" }],
        captionStyle: { mode: "burn-in", preset: "clean" },
        audioMix: { ducking: { enabled: true } },
      },
    })
    expect(getPlanTrackCounts(layered)).toEqual({ primaryClips: 2, overlayTracks: 1, overlayClips: 1, audioTracks: 1, audioClips: 1, transitions: 0, titleCards: 1, burnedCaptions: true, ducking: true })
    expect(getTimelineDuration(layered)).toBe(70)
  })

  test("revises v2 production controls through schema-backed helpers", () => {
    const layered = parseEditPlan({
      ...sampleEditPlan,
      version: "2",
      assets: [
        ...sampleEditPlan.assets,
        { id: "overlay", path: "media/overlay.mp4", kind: "video" },
        { id: "music", path: "media/music.wav", kind: "audio" },
      ],
      timeline: {
        ...sampleEditPlan.timeline,
        overlayTracks: [{ id: "b-roll", clips: [{ id: "b-roll-1", assetId: "overlay", timelineStart: 3, sourceStart: 0, sourceEnd: 2, width: 640, height: 360 }] }],
        audioTracks: [{ id: "music", role: "music", clips: [{ id: "music-1", assetId: "music", timelineStart: 0, sourceStart: 0, sourceEnd: 70 }] }],
        transitions: [{ id: "fade-1", fromClipId: "fire-analogy", toClipId: "human-potential", type: "fade", duration: 0.5 }],
        titleCards: [{ id: "intro", timelineStart: 0, duration: 2, title: "Opening" }],
        captionStyle: { mode: "burn-in", preset: "clean" },
        audioMix: { ducking: { enabled: true } },
      },
    })

    let revised = updateOverlayClip(layered, "b-roll-1", { x: 10, opacity: 0.5, fit: "cover" })
    revised = updateAudioTrack(revised, "music", { role: "effects" })
    revised = updateAudioClip(revised, "music-1", { volume: 0.3, timelineStart: 1 })
    revised = updateTransition(revised, "fade-1", { type: "wipeleft", duration: 0.3 })
    revised = updateTitleCard(revised, "intro", { title: "New title", accentColor: "#00ff00" })
    revised = updateCaptionStyle(revised, { preset: "bold", fontSize: 48 })
    revised = updateDucking(revised, { ratio: 6, releaseMs: 300 })

    expect(revised.version).toBe("2")
    if (revised.version !== "2") throw new Error("Expected v2 plan")
    expect(revised.timeline.overlayTracks[0]?.clips[0]).toMatchObject({ x: 10, opacity: 0.5, fit: "cover" })
    expect(revised.timeline.audioTracks[0]).toMatchObject({ role: "effects" })
    expect(revised.timeline.audioTracks[0]?.clips[0]).toMatchObject({ volume: 0.3, timelineStart: 1 })
    expect(revised.timeline.transitions[0]).toMatchObject({ type: "wipeleft", duration: 0.3 })
    expect(revised.timeline.titleCards[0]).toMatchObject({ title: "New title", accentColor: "#00ff00" })
    expect(revised.timeline.captionStyle).toMatchObject({ preset: "bold", fontSize: 48 })
    expect(revised.timeline.audioMix?.ducking).toMatchObject({ ratio: 6, releaseMs: 300, targetTrackIds: ["music"] })
  })

  test("keeps WYSIWYG overlay and title boxes inside the project canvas", () => {
    const layered = parseEditPlan({
      ...sampleEditPlan,
      version: "2",
      assets: [
        ...sampleEditPlan.assets,
        { id: "overlay", path: "media/overlay.mp4", kind: "video" },
      ],
      timeline: {
        ...sampleEditPlan.timeline,
        overlayTracks: [{ id: "b-roll", clips: [{ id: "b-roll-1", assetId: "overlay", timelineStart: 3, sourceStart: 0, sourceEnd: 2, width: 640, height: 360 }] }],
        audioTracks: [],
        transitions: [],
        titleCards: [{ id: "lower", template: "lower-third", timelineStart: 0, duration: 2, title: "Opening" }],
      },
    })

    let revised = updateOverlayClipCanvasBox(layered, "b-roll-1", {
      x: 2_000,
      y: 2_000,
      width: 2_000,
      height: 2_000,
      opacity: 1.4,
    })
    revised = updateTitleCardCanvasBox(revised, "lower", {
      x: -40,
      y: 800,
      width: 900,
      height: 260,
      opacity: -1,
      fontScale: 3,
    })

    expect(revised.version).toBe("2")
    if (revised.version !== "2") throw new Error("Expected v2 plan")
    expect(revised.timeline.overlayTracks[0]?.clips[0]).toMatchObject({
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
      opacity: 1,
    })
    expect(getTitleCardCanvasBox(revised, revised.timeline.titleCards[0]!)).toMatchObject({
      x: 0,
      y: 460,
      width: 900,
      height: 260,
      opacity: 0,
      fontScale: 2,
    })
  })

  test("applies production presets across captions, titles, transitions, and ducking", () => {
    const layered = parseEditPlan({
      ...sampleEditPlan,
      version: "2",
      assets: [
        ...sampleEditPlan.assets,
        { id: "music", path: "media/music.wav", kind: "audio" },
      ],
      timeline: {
        ...sampleEditPlan.timeline,
        overlayTracks: [],
        audioTracks: [{ id: "music", role: "music", clips: [{ id: "music-1", assetId: "music", timelineStart: 0, sourceStart: 0, sourceEnd: 70 }] }],
        transitions: [{ id: "fade-1", fromClipId: "fire-analogy", toClipId: "human-potential", type: "fade", duration: 0.5 }],
        titleCards: [{ id: "intro", timelineStart: 0, duration: 2, title: "Opening" }],
        captionStyle: { mode: "burn-in", preset: "clean" },
      },
    })
    const revised = applyProductionPreset(layered, "bold-social")
    expect(revised.version).toBe("2")
    if (revised.version !== "2") throw new Error("Expected v2 plan")
    expect(revised.timeline.captionStyle).toMatchObject({ mode: "both", preset: "bold", fontSize: 58 })
    expect(revised.timeline.transitions[0]).toMatchObject({ type: "slideleft", duration: 0.35 })
    expect(revised.timeline.titleCards[0]).toMatchObject({ background: "#020617", accentColor: "#F59E0B" })
    expect(revised.timeline.audioMix?.ducking).toMatchObject({ enabled: true, targetTrackIds: ["music"], ratio: 10 })
  })
})
