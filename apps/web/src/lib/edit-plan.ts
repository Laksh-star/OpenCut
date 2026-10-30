import {
  editPlanSchema,
  type EditPlan,
} from "../../../agent-bridge/src/schema.ts"

export type { EditPlan }
export type EditPlanV2 = Extract<EditPlan, { version: "2" }>
export type OverlayClip = EditPlanV2["timeline"]["overlayTracks"][number]["clips"][number]
export type AudioTrack = EditPlanV2["timeline"]["audioTracks"][number]
export type AudioClip = AudioTrack["clips"][number]
export type Transition = EditPlanV2["timeline"]["transitions"][number]
export type TitleCard = EditPlanV2["timeline"]["titleCards"][number]
export type CaptionStyle = NonNullable<EditPlanV2["timeline"]["captionStyle"]>
export type SubtitleProvider = NonNullable<EditPlanV2["timeline"]["subtitleProvider"]>
export type SubtitleProviderMode = SubtitleProvider["mode"]
export type DuckingSettings = NonNullable<NonNullable<EditPlanV2["timeline"]["audioMix"]>["ducking"]>
export type ProductionPresetId = "clean-interview" | "bold-social" | "minimal-archive"
export type CanvasBox = {
  x: number
  y: number
  width: number
  height: number
}
export type TitleCardCanvasBox = CanvasBox & {
  opacity: number
  fontScale: number
}

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
  const sequentialDuration = buildTimelineSegments(plan).at(-1)?.timelineEnd ?? 0
  if (plan.version === "1") return sequentialDuration
  const primaryDuration = sequentialDuration - plan.timeline.transitions.reduce((total, transition) => total + transition.duration, 0)
  const overlayEnds = plan.timeline.overlayTracks.flatMap((track) =>
    track.clips.map((clip) => clip.timelineStart + (clip.sourceEnd - clip.sourceStart) / clip.speed),
  )
  const audioEnds = plan.timeline.audioTracks.flatMap((track) =>
    track.clips.map((clip) => clip.timelineStart + (clip.sourceEnd - clip.sourceStart) / clip.speed),
  )
  const titleEnds = plan.timeline.titleCards.map((card) => card.timelineStart + card.duration)
  return Math.max(primaryDuration, ...overlayEnds, ...audioEnds, ...titleEnds)
}

export function getPlanTrackCounts(plan: EditPlan) {
  if (plan.version === "1") {
    return { primaryClips: plan.timeline.clips.length, overlayTracks: 0, overlayClips: 0, audioTracks: 0, audioClips: 0, transitions: 0, titleCards: 0, burnedCaptions: false, ducking: false }
  }
  return {
    primaryClips: plan.timeline.clips.length,
    overlayTracks: plan.timeline.overlayTracks.length,
    overlayClips: plan.timeline.overlayTracks.reduce((total, track) => total + track.clips.length, 0),
    audioTracks: plan.timeline.audioTracks.length,
    audioClips: plan.timeline.audioTracks.reduce((total, track) => total + track.clips.length, 0),
    transitions: plan.timeline.transitions.length,
    titleCards: plan.timeline.titleCards.length,
    burnedCaptions: Boolean(plan.timeline.captionStyle && plan.timeline.captionStyle.mode !== "selectable"),
    ducking: Boolean(plan.timeline.audioMix?.ducking?.enabled),
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

export function updateOverlayClip(
  plan: EditPlan,
  clipId: string,
  patch: Partial<OverlayClip>,
): EditPlan {
  if (plan.version !== "2") return plan
  return parseEditPlan({
    ...plan,
    timeline: {
      ...plan.timeline,
      overlayTracks: plan.timeline.overlayTracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => clip.id === clipId ? { ...clip, ...patch } : clip),
      })),
    },
  })
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const constrainCanvasBox = (
  box: CanvasBox,
  canvas: { width: number; height: number },
  minimumSize = 24,
): CanvasBox => {
  const width = Math.round(clamp(box.width, minimumSize, canvas.width))
  const height = Math.round(clamp(box.height, minimumSize, canvas.height))
  return {
    x: Math.round(clamp(box.x, 0, canvas.width - width)),
    y: Math.round(clamp(box.y, 0, canvas.height - height)),
    width,
    height,
  }
}

export function updateOverlayClipCanvasBox(
  plan: EditPlan,
  clipId: string,
  patch: Partial<CanvasBox & Pick<OverlayClip, "opacity">>,
): EditPlan {
  if (plan.version !== "2") return plan
  const clip = plan.timeline.overlayTracks.flatMap((track) => track.clips).find((entry) => entry.id === clipId)
  if (!clip) return plan
  const box = constrainCanvasBox({
    x: patch.x ?? clip.x,
    y: patch.y ?? clip.y,
    width: patch.width ?? clip.width,
    height: patch.height ?? clip.height,
  }, plan.project)
  return updateOverlayClip(plan, clipId, {
    ...box,
    opacity: patch.opacity === undefined ? clip.opacity : clamp(patch.opacity, 0, 1),
  })
}

export function updateAudioTrack(
  plan: EditPlan,
  trackId: string,
  patch: Partial<Pick<AudioTrack, "role">>,
): EditPlan {
  if (plan.version !== "2") return plan
  const next = {
    ...plan,
    timeline: {
      ...plan.timeline,
      audioTracks: plan.timeline.audioTracks.map((track) => track.id === trackId ? { ...track, ...patch } : track),
    },
  }
  const ducking = next.timeline.audioMix?.ducking
  if (ducking?.enabled && ducking.targetTrackIds.length === 0 && !next.timeline.audioTracks.some((track) => track.role === "music")) {
    ducking.targetTrackIds = [trackId]
  }
  return parseEditPlan(next)
}

export function updateAudioClip(
  plan: EditPlan,
  clipId: string,
  patch: Partial<AudioClip>,
): EditPlan {
  if (plan.version !== "2") return plan
  return parseEditPlan({
    ...plan,
    timeline: {
      ...plan.timeline,
      audioTracks: plan.timeline.audioTracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => clip.id === clipId ? { ...clip, ...patch } : clip),
      })),
    },
  })
}

export function updateTransition(
  plan: EditPlan,
  transitionId: string,
  patch: Partial<Transition>,
): EditPlan {
  if (plan.version !== "2") return plan
  return parseEditPlan({
    ...plan,
    timeline: {
      ...plan.timeline,
      transitions: plan.timeline.transitions.map((transition) =>
        transition.id === transitionId ? { ...transition, ...patch } : transition,
      ),
    },
  })
}

export function updateTitleCard(
  plan: EditPlan,
  titleId: string,
  patch: Partial<TitleCard>,
): EditPlan {
  if (plan.version !== "2") return plan
  return parseEditPlan({
    ...plan,
    timeline: {
      ...plan.timeline,
      titleCards: plan.timeline.titleCards.map((title) =>
        title.id === titleId ? { ...title, ...patch } : title,
      ),
    },
  })
}

export function getTitleCardCanvasBox(
  plan: EditPlan,
  title: TitleCard,
): TitleCardCanvasBox {
  const project = plan.project
  const defaultBox = title.template === "lower-third"
    ? {
        x: Math.round(project.width * 0.06),
        y: Math.round(project.height * 0.68),
        width: Math.round(project.width * 0.78),
        height: Math.round(project.height * 0.22),
      }
    : {
        x: Math.round(project.width * 0.12),
        y: Math.round(project.height * 0.35),
        width: Math.round(project.width * 0.76),
        height: Math.round(project.height * 0.28),
      }
  const box = constrainCanvasBox({
    x: title.x ?? defaultBox.x,
    y: title.y ?? defaultBox.y,
    width: title.width ?? defaultBox.width,
    height: title.height ?? defaultBox.height,
  }, project, 48)
  return {
    ...box,
    opacity: title.opacity ?? 1,
    fontScale: title.fontScale ?? 1,
  }
}

export function updateTitleCardCanvasBox(
  plan: EditPlan,
  titleId: string,
  patch: Partial<TitleCardCanvasBox>,
): EditPlan {
  if (plan.version !== "2") return plan
  const title = plan.timeline.titleCards.find((entry) => entry.id === titleId)
  if (!title) return plan
  const current = getTitleCardCanvasBox(plan, title)
  const box = constrainCanvasBox({
    x: patch.x ?? current.x,
    y: patch.y ?? current.y,
    width: patch.width ?? current.width,
    height: patch.height ?? current.height,
  }, plan.project, 48)
  return updateTitleCard(plan, titleId, {
    ...box,
    opacity: patch.opacity === undefined ? current.opacity : clamp(patch.opacity, 0, 1),
    fontScale: patch.fontScale === undefined ? current.fontScale : clamp(patch.fontScale, 0.5, 2),
  })
}

export function updateCaptionStyle(
  plan: EditPlan,
  patch: Partial<CaptionStyle>,
): EditPlan {
  if (plan.version !== "2") return plan
  const current = plan.timeline.captionStyle ?? { mode: "burn-in" as const, preset: "clean" as const }
  return parseEditPlan({
    ...plan,
    timeline: {
      ...plan.timeline,
      captionStyle: { ...current, ...patch },
    },
  })
}

export const subtitleProviderOptions: Array<{
  id: SubtitleProviderMode
  label: string
  description: string
  privacy: "local-only" | "external-api" | "provided"
  cost: string
  requiresCaptionsAsset?: boolean
}> = [
  {
    id: "local-whisper",
    label: "Local Whisper",
    description: "Run transcription locally when Whisper is installed. Best privacy, slower on long files, no API media upload.",
    privacy: "local-only",
    cost: "No API cost",
  },
  {
    id: "openai-api",
    label: "OpenAI API",
    description: "Use OpenAI transcription models when explicitly authorized. Sends extracted audio chunks to OpenAI.",
    privacy: "external-api",
    cost: "API usage cost",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "Use an OpenRouter transcription route when explicitly authorized. Sends extracted audio chunks through OpenRouter.",
    privacy: "external-api",
    cost: "Provider usage cost",
  },
  {
    id: "provided-captions",
    label: "Provided SRT/VTT",
    description: "Skip transcription and use an existing trusted caption file attached to this plan.",
    privacy: "provided",
    cost: "No transcription cost",
    requiresCaptionsAsset: true,
  },
]

const defaultSubtitleProvider = (
  mode: SubtitleProviderMode,
  hasCaptionsAsset: boolean,
): SubtitleProvider => {
  if (mode === "openai-api") {
    return {
      mode,
      status: "selected",
      model: "gpt-4o-mini-transcribe",
      notes: "Requires explicit approval before extracted audio is sent to OpenAI.",
    }
  }
  if (mode === "openrouter") {
    return {
      mode,
      status: "selected",
      model: "openai/whisper-large-v3",
      notes: "Requires explicit approval before extracted audio is sent through OpenRouter.",
    }
  }
  if (mode === "provided-captions") {
    return {
      mode,
      status: hasCaptionsAsset ? "provided" : "needs-generation",
      notes: "Uses the attached caption asset; no transcription provider will be called.",
    }
  }
  return {
    mode: "local-whisper",
    status: "selected",
    model: "whisper-local",
    notes: "Preferred default when available because source audio stays local.",
  }
}

export function getSubtitleProvider(plan: EditPlan): SubtitleProvider | null {
  if (plan.version !== "2") return null
  if (plan.timeline.subtitleProvider) return plan.timeline.subtitleProvider
  return defaultSubtitleProvider(
    plan.timeline.captionsAssetId ? "provided-captions" : "local-whisper",
    Boolean(plan.timeline.captionsAssetId),
  )
}

export function setSubtitleProviderMode(
  plan: EditPlan,
  mode: SubtitleProviderMode,
): EditPlan {
  if (plan.version !== "2") return plan
  const hasCaptionsAsset = Boolean(plan.timeline.captionsAssetId)
  if (mode === "provided-captions" && !hasCaptionsAsset) return plan
  return parseEditPlan({
    ...plan,
    timeline: {
      ...plan.timeline,
      subtitleProvider: defaultSubtitleProvider(mode, hasCaptionsAsset),
    },
  })
}

export function updateSubtitleProvider(
  plan: EditPlan,
  patch: Partial<SubtitleProvider>,
): EditPlan {
  if (plan.version !== "2") return plan
  const current = getSubtitleProvider(plan) ?? defaultSubtitleProvider("local-whisper", Boolean(plan.timeline.captionsAssetId))
  const next = {
    ...current,
    ...patch,
    estimatedCostUsd: patch.estimatedCostUsd === undefined
      ? current.estimatedCostUsd
      : clamp(patch.estimatedCostUsd, 0, 10_000),
  }
  if (next.mode === "provided-captions" && !plan.timeline.captionsAssetId) {
    return setSubtitleProviderMode(plan, "local-whisper")
  }
  return parseEditPlan({
    ...plan,
    timeline: {
      ...plan.timeline,
      subtitleProvider: next,
    },
  })
}

export function updateDucking(
  plan: EditPlan,
  patch: Partial<DuckingSettings>,
): EditPlan {
  if (plan.version !== "2") return plan
  const targetTrackIds = plan.timeline.audioMix?.ducking?.targetTrackIds
    ?? plan.timeline.audioTracks.filter((track) => track.role === "music").map((track) => track.id)
    ?? []
  const current = plan.timeline.audioMix?.ducking ?? {
    enabled: false,
    targetTrackIds: targetTrackIds.length > 0 ? targetTrackIds : plan.timeline.audioTracks.slice(0, 1).map((track) => track.id),
    threshold: 0.04,
    ratio: 8,
    attackMs: 20,
    releaseMs: 250,
  }
  const nextDucking = { ...current, ...patch }
  if (nextDucking.enabled && nextDucking.targetTrackIds.length === 0) {
    nextDucking.targetTrackIds = plan.timeline.audioTracks.filter((track) => track.role === "music").map((track) => track.id)
    if (nextDucking.targetTrackIds.length === 0) nextDucking.targetTrackIds = plan.timeline.audioTracks.slice(0, 1).map((track) => track.id)
  }
  return parseEditPlan({
    ...plan,
    timeline: {
      ...plan.timeline,
      audioMix: {
        ...(plan.timeline.audioMix ?? {}),
        ducking: nextDucking,
      },
    },
  })
}

export const productionPresetOptions: Array<{ id: ProductionPresetId; label: string; description: string }> = [
  { id: "clean-interview", label: "Clean interview", description: "Readable captions, gentle fades, restrained title colors, and transparent music ducking." },
  { id: "bold-social", label: "Bold social", description: "Large high-contrast captions, quicker motion, stronger title accents, and deeper music ducking." },
  { id: "minimal-archive", label: "Minimal archive", description: "Low-touch captions, subtle titles, soft fades, and conservative audio treatment." },
]

export function applyProductionPreset(plan: EditPlan, presetId: ProductionPresetId): EditPlan {
  if (plan.version !== "2") return plan
  const musicTrackIds = plan.timeline.audioTracks.filter((track) => track.role === "music").map((track) => track.id)
  const targetTrackIds = musicTrackIds.length > 0
    ? musicTrackIds
    : plan.timeline.audioTracks.slice(0, 1).map((track) => track.id)
  const preset = {
    "clean-interview": {
      captionStyle: {
        mode: "both" as const,
        preset: "clean" as const,
        fontSize: 42,
        textColor: "#FFFFFF",
        outlineColor: "#000000",
        backgroundColor: "#000000",
        backgroundOpacity: 0.68,
        marginV: 56,
        alignment: "bottom" as const,
      },
      transition: { type: "fade" as const, duration: 0.45 },
      title: { background: "#111827", textColor: "#FFFFFF", accentColor: "#FBBF24" },
      ducking: { enabled: targetTrackIds.length > 0, targetTrackIds, threshold: 0.04, ratio: 8, attackMs: 20, releaseMs: 250 },
    },
    "bold-social": {
      captionStyle: {
        mode: "both" as const,
        preset: "bold" as const,
        fontSize: 58,
        textColor: "#FFFFFF",
        outlineColor: "#020617",
        backgroundColor: "#F59E0B",
        backgroundOpacity: 0.84,
        marginV: 44,
        alignment: "bottom" as const,
      },
      transition: { type: "slideleft" as const, duration: 0.35 },
      title: { background: "#020617", textColor: "#FFFFFF", accentColor: "#F59E0B" },
      ducking: { enabled: targetTrackIds.length > 0, targetTrackIds, threshold: 0.035, ratio: 10, attackMs: 12, releaseMs: 320 },
    },
    "minimal-archive": {
      captionStyle: {
        mode: "both" as const,
        preset: "minimal" as const,
        fontSize: 36,
        textColor: "#F4F4F5",
        outlineColor: "#18181B",
        backgroundColor: "#000000",
        backgroundOpacity: 0.42,
        marginV: 72,
        alignment: "bottom" as const,
      },
      transition: { type: "fade" as const, duration: 0.3 },
      title: { background: "#18181B", textColor: "#F4F4F5", accentColor: "#A1A1AA" },
      ducking: { enabled: targetTrackIds.length > 0, targetTrackIds, threshold: 0.05, ratio: 6, attackMs: 30, releaseMs: 420 },
    },
  }[presetId]

  return parseEditPlan({
    ...plan,
    timeline: {
      ...plan.timeline,
      captionStyle: plan.timeline.captionsAssetId ? preset.captionStyle : plan.timeline.captionStyle,
      transitions: plan.timeline.transitions.map((transition) => ({ ...transition, ...preset.transition })),
      titleCards: plan.timeline.titleCards.map((title) => ({ ...title, ...preset.title })),
      audioMix: plan.timeline.audioTracks.length > 0
        ? { ...(plan.timeline.audioMix ?? {}), ducking: preset.ducking }
        : plan.timeline.audioMix,
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
  if (plan.version === "2") {
    const captionsAssetId = enabled ? captionAsset?.id : undefined
    const currentProvider = plan.timeline.subtitleProvider
    const subtitleProvider = !captionsAssetId && currentProvider?.mode === "provided-captions"
      ? defaultSubtitleProvider("local-whisper", false)
      : currentProvider ?? (captionsAssetId ? defaultSubtitleProvider("provided-captions", true) : undefined)
    return parseEditPlan({
      ...plan,
      timeline: {
        ...plan.timeline,
        captionsAssetId,
        ...(subtitleProvider ? { subtitleProvider } : {}),
      },
    })
  }
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
