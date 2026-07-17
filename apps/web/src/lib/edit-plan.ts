import {
  editPlanSchema,
  type EditPlan,
} from "../../../agent-bridge/src/schema.ts"

export type { EditPlan }

export type TimelineSegment = {
  clip: EditPlan["timeline"]["clips"][number]
  durationSeconds: number
  timelineStart: number
  timelineEnd: number
}

export const sampleEditPlan: EditPlan = editPlanSchema.parse({
  version: "1",
  project: {
    name: "The Matchstick Within",
    width: 1280,
    height: 720,
    frameRate: 25,
    background: "#000000",
  },
  assets: [
    {
      id: "interview",
      path: "projects/ranganathananda-highlight/source/original.mp4",
      kind: "video",
    },
    {
      id: "captions",
      path: "projects/ranganathananda-highlight/captions.srt",
      kind: "captions",
    },
  ],
  timeline: {
    clips: [
      {
        id: "fire-analogy",
        assetId: "interview",
        sourceStart: 595,
        sourceEnd: 625,
        speed: 1.15,
        volume: 1,
        includeAudio: true,
      },
      {
        id: "human-potential",
        assetId: "interview",
        sourceStart: 628,
        sourceEnd: 668,
        speed: 1.15,
        volume: 1,
        includeAudio: true,
      },
    ],
    captionsAssetId: "captions",
  },
  output: {
    path: "projects/ranganathananda-highlight/renders/matchstick-highlight.mp4",
    overwrite: true,
  },
})

export function parseEditPlan(value: unknown): EditPlan {
  return editPlanSchema.parse(value)
}

export function buildTimelineSegments(plan: EditPlan): TimelineSegment[] {
  let cursor = 0

  return plan.timeline.clips.map((clip) => {
    const durationSeconds = (clip.sourceEnd - clip.sourceStart) / clip.speed
    const segment = {
      clip,
      durationSeconds,
      timelineStart: cursor,
      timelineEnd: cursor + durationSeconds,
    }
    cursor = segment.timelineEnd
    return segment
  })
}

export function getTimelineDuration(plan: EditPlan): number {
  const primaryDuration = buildTimelineSegments(plan).at(-1)?.timelineEnd ?? 0
  if (plan.version === "1") return primaryDuration
  const overlayEnds = plan.timeline.overlayTracks.flatMap((track) =>
    track.clips.map((clip) => clip.timelineStart + (clip.sourceEnd - clip.sourceStart) / clip.speed),
  )
  const audioEnds = plan.timeline.audioTracks.flatMap((track) =>
    track.clips.map((clip) => clip.timelineStart + (clip.sourceEnd - clip.sourceStart) / clip.speed),
  )
  return Math.max(primaryDuration, ...overlayEnds, ...audioEnds)
}

export function getPlanTrackCounts(plan: EditPlan) {
  if (plan.version === "1") {
    return { primaryClips: plan.timeline.clips.length, overlayTracks: 0, overlayClips: 0, audioTracks: 0, audioClips: 0 }
  }
  return {
    primaryClips: plan.timeline.clips.length,
    overlayTracks: plan.timeline.overlayTracks.length,
    overlayClips: plan.timeline.overlayTracks.reduce((total, track) => total + track.clips.length, 0),
    audioTracks: plan.timeline.audioTracks.length,
    audioClips: plan.timeline.audioTracks.reduce((total, track) => total + track.clips.length, 0),
  }
}

export function updatePlanClip(
  plan: EditPlan,
  clipId: string,
  patch: Partial<EditPlan["timeline"]["clips"][number]>,
): EditPlan {
  return parseEditPlan({
    ...plan,
    timeline: {
      ...plan.timeline,
      clips: plan.timeline.clips.map((clip) => clip.id === clipId ? { ...clip, ...patch } : clip),
    },
  })
}

export function movePlanClip(plan: EditPlan, clipId: string, direction: -1 | 1): EditPlan {
  const clips = [...plan.timeline.clips]
  const index = clips.findIndex((clip) => clip.id === clipId)
  const nextIndex = index + direction
  if (index < 0 || nextIndex < 0 || nextIndex >= clips.length) return plan
  const [clip] = clips.splice(index, 1)
  clips.splice(nextIndex, 0, clip!)
  return parseEditPlan({ ...plan, timeline: { ...plan.timeline, clips } })
}

export function setPlanCaptionsEnabled(plan: EditPlan, enabled: boolean): EditPlan {
  const captionAsset = plan.assets.find((asset) => asset.kind === "captions")
  return parseEditPlan({
    ...plan,
    timeline: {
      ...plan.timeline,
      captionsAssetId: enabled ? captionAsset?.id : undefined,
    },
  })
}

export function formatTimecode(seconds: number): string {
  const totalTenths = Math.round(Math.max(0, seconds) * 10)
  const minutes = Math.floor(totalTenths / 600)
  const remainder = Math.floor(totalTenths / 10) % 60
  const tenths = totalTenths % 10
  return `${minutes}:${remainder.toString().padStart(2, "0")}.${tenths}`
}
