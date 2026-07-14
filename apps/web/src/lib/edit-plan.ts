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
  return buildTimelineSegments(plan).at(-1)?.timelineEnd ?? 0
}

export function formatTimecode(seconds: number): string {
  const totalTenths = Math.round(Math.max(0, seconds) * 10)
  const minutes = Math.floor(totalTenths / 600)
  const remainder = Math.floor(totalTenths / 10) % 60
  const tenths = totalTenths % 10
  return `${minutes}:${remainder.toString().padStart(2, "0")}.${tenths}`
}
