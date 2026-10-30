import {
  getTimelineDuration,
  parseEditPlan,
  type EditPlan,
} from "./edit-plan.ts"
import type { ProjectMedia } from "./workspace-projects.ts"
export type ImportPurpose = "video" | "watermark" | "music" | "captions"
export function addProjectMedia(
  plan: EditPlan,
  media: ProjectMedia,
  purpose: ImportPurpose,
): EditPlan {
  if (plan.version !== "2")
    throw new Error("Main editing requires a version 2 plan")
  const duration = getTimelineDuration(plan)
  const assets = [
    ...plan.assets,
    { id: media.id, path: media.path, kind: media.kind },
  ]
  const timeline = { ...plan.timeline }
  if (purpose === "video") {
    if (media.kind !== "video" || media.stillImage)
      throw new Error("Choose a video for the main timeline")
    timeline.clips = [
      ...timeline.clips,
      {
        id: `clip-${crypto.randomUUID()}`,
        assetId: media.id,
        sourceStart: 0,
        sourceEnd: media.duration,
        speed: 1,
        volume: 1,
        includeAudio: media.hasAudio,
      },
    ]
    timeline.overlayTracks = timeline.overlayTracks.map((track) =>
      /watermark|caption-band/i.test(track.id)
        ? {
            ...track,
            clips: track.clips.map((clip) => {
              const asset = assets.find((asset) => asset.id === clip.assetId)
              const end =
                clip.timelineStart +
                (clip.sourceEnd - clip.sourceStart) / clip.speed
              return asset &&
                /\.(png|jpe?g|webp)$/i.test(asset.path) &&
                Math.abs(end - duration) < 0.05
                ? {
                    ...clip,
                    sourceEnd: clip.sourceEnd + media.duration * clip.speed,
                  }
                : clip
            }),
          }
        : track,
    )
    if (timeline.subtitleProvider && timeline.captionsAssetId)
      timeline.subtitleProvider = {
        ...timeline.subtitleProvider,
        mode:
          timeline.subtitleProvider.mode === "provided-captions"
            ? "local-whisper"
            : timeline.subtitleProvider.mode,
        status: "needs-generation",
        notes:
          "Added footage needs captions. Regenerate after saving or attach an SRT for the complete edit.",
      }
  } else if (purpose === "watermark") {
    if (media.kind !== "video")
      throw new Error("Choose an image or video for a watermark")
    const width = Math.max(1, Math.round(plan.project.width * 0.1))
    const height = Math.min(
      plan.project.height - 32,
      Math.max(1, Math.round((width * media.height) / media.width)),
    )
    timeline.overlayTracks = [
      ...timeline.overlayTracks,
      {
        id: `watermark-${crypto.randomUUID()}`,
        zIndex: Math.min(
          100,
          Math.max(0, ...timeline.overlayTracks.map((track) => track.zIndex)) +
            1,
        ),
        clips: [
          {
            id: `logo-${crypto.randomUUID()}`,
            assetId: media.id,
            sourceStart: 0,
            sourceEnd: media.stillImage
              ? duration
              : Math.min(duration, media.duration),
            timelineStart: 0,
            speed: 1,
            volume: 0,
            x: plan.project.width - width - 16,
            y: 16,
            width,
            height,
            opacity: 0.95,
            fit: "contain",
            includeAudio: false,
          },
        ],
      },
    ]
  } else if (purpose === "music") {
    if (media.kind !== "audio")
      throw new Error("Choose an audio file for background music")
    const id = `music-${crypto.randomUUID()}`
    timeline.audioTracks = [
      ...timeline.audioTracks,
      {
        id,
        role: "music",
        clips: [
          {
            id: `audio-${crypto.randomUUID()}`,
            assetId: media.id,
            timelineStart: 0,
            sourceStart: 0,
            sourceEnd: Math.min(media.duration, duration),
            speed: 1,
            volume: 0.2,
          },
        ],
      },
    ]
    timeline.audioMix = {
      ducking: {
        enabled: true,
        targetTrackIds: [
          ...(timeline.audioMix?.ducking?.targetTrackIds ?? []),
          id,
        ],
        threshold: 0.04,
        ratio: 8,
        attackMs: 20,
        releaseMs: 250,
      },
    }
  } else {
    if (media.kind !== "captions")
      throw new Error("Choose an SRT or VTT caption file")
    timeline.captionsAssetId = media.id
    timeline.subtitleProvider = {
      mode: "provided-captions",
      status: "provided",
      language: "en",
    }
    timeline.captionStyle = {
      ...timeline.captionStyle,
      mode: "both",
      preset: "clean",
      textColor: "#FFFFFF",
      outlineColor: "#000000",
      backgroundColor: "#000000",
      backgroundOpacity: 0.72,
      marginV: 56,
      alignment: "bottom",
    }
  }
  return parseEditPlan({ ...plan, assets, timeline })
}
export function splitProjectClip(
  plan: EditPlan,
  clipId: string,
  sourceTime: number,
): EditPlan {
  const clip = plan.timeline.clips.find((clip) => clip.id === clipId)
  if (
    !clip ||
    sourceTime <= clip.sourceStart + 0.05 ||
    sourceTime >= clip.sourceEnd - 0.05
  )
    throw new Error(
      "Move the playhead inside the selected cut before splitting",
    )
  const nextId = `split-${crypto.randomUUID()}`
  return parseEditPlan({
    ...plan,
    timeline: {
      ...plan.timeline,
      clips: plan.timeline.clips.flatMap((entry) =>
        entry.id === clipId
          ? [
              { ...entry, sourceEnd: sourceTime },
              { ...entry, id: nextId, sourceStart: sourceTime },
            ]
          : [entry],
      ),
      ...(plan.version === "2"
        ? {
            transitions: plan.timeline.transitions.map((transition) =>
              transition.fromClipId === clipId
                ? { ...transition, fromClipId: nextId }
                : transition,
            ),
          }
        : {}),
    },
  })
}
