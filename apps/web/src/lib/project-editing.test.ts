import { expect, test } from "vitest"
import { getTimelineDuration, parseEditPlan } from "./edit-plan.ts"
import { addProjectMedia, splitProjectClip } from "./project-editing.ts"
const plan = () =>
  parseEditPlan({
    version: "2",
    project: { name: "Main", width: 1920, height: 1080 },
    assets: [{ id: "source", kind: "video", path: "/media/source.mp4" }],
    timeline: {
      clips: [
        {
          id: "first",
          assetId: "source",
          sourceStart: 10,
          sourceEnd: 30,
          speed: 2,
        },
        { id: "second", assetId: "source", sourceStart: 40, sourceEnd: 60 },
      ],
      transitions: [
        { id: "fade", fromClipId: "first", toClipId: "second", duration: 0.5 },
      ],
    },
    output: { path: "/project/master/renders/output.mp4" },
  })
test("splitting preserves source continuity, speed, duration and the outgoing transition", () => {
  const original = plan()
  const result = splitProjectClip(original, "first", 20)
  expect(getTimelineDuration(result)).toBe(getTimelineDuration(original))
  expect(
    result.timeline.clips
      .slice(0, 2)
      .map((clip) => [clip.sourceStart, clip.sourceEnd, clip.speed]),
  ).toEqual([
    [10, 20, 2],
    [20, 30, 2],
  ])
  if (result.version !== "2") throw new Error("Expected v2")
  expect(result.timeline.transitions[0]!.fromClipId).toBe(
    result.timeline.clips[1]!.id,
  )
  expect(original.timeline.clips).toHaveLength(2)
  expect(() => splitProjectClip(original, "first", 10)).toThrow("inside")
})
test("a static watermark spans the full edit and music ducks under speech without replacing sources", () => {
  const original = plan()
  const withLogo = addProjectMedia(
    original,
    {
      id: "logo",
      kind: "video",
      path: "/media/logo.png",
      duration: 0,
      width: 400,
      height: 400,
      hasAudio: false,
      stillImage: true,
    },
    "watermark",
  )
  const result = addProjectMedia(
    withLogo,
    {
      id: "music",
      kind: "audio",
      path: "/media/music.wav",
      duration: 5,
      width: 0,
      height: 0,
      hasAudio: true,
      stillImage: false,
    },
    "music",
  )
  if (result.version !== "2") throw new Error("Expected v2")
  expect(result.assets[0]).toEqual(original.assets[0])
  expect(result.timeline.overlayTracks[0]!.clips[0]!.sourceEnd).toBe(
    getTimelineDuration(original),
  )
  expect(result.timeline.overlayTracks[0]!.clips[0]!.includeAudio).toBe(false)
  expect(result.timeline.audioTracks[0]!.clips[0]!.sourceEnd).toBe(5)
  expect(result.timeline.audioMix!.ducking!.targetTrackIds).toContain(
    result.timeline.audioTracks[0]!.id,
  )
  expect(result.timeline.clips).toEqual(original.timeline.clips)
})
test("caption attachment enables supplied clean captions; invalid media purposes do not mutate the plan", () => {
  const original = plan()
  const captions = {
    id: "captions",
    kind: "captions" as const,
    path: "/media/full.srt",
    duration: 30,
    width: 0,
    height: 0,
    hasAudio: false,
    stillImage: false,
  }
  const result = addProjectMedia(original, captions, "captions")
  if (result.version !== "2") throw new Error("Expected v2")
  expect(result.timeline.subtitleProvider).toMatchObject({
    mode: "provided-captions",
    status: "provided",
  })
  expect(result.timeline.captionStyle).toMatchObject({
    mode: "both",
    preset: "clean",
  })
  expect(() => addProjectMedia(original, captions, "video")).toThrow("video")
  expect(original.assets).toHaveLength(1)
})
