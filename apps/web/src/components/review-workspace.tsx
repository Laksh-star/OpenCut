import {
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Captions,
  Check,
  CircleAlert,
  Clock3,
  Download,
  Film,
  FolderOpen,
  Gauge,
  Eye,
  LoaderCircle,
  Layers3,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Save,
  SkipBack,
  SkipForward,
  Sparkles,
  MessageSquareText,
  WandSparkles,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { MainProjectTools, MainTimeline } from "./main-project-tools.tsx"
import { projectRequest, type WorkspaceProject, type ProjectMedia } from "#/lib/workspace-projects.ts"
import { addProjectMedia, splitProjectClip, type ImportPurpose } from "#/lib/project-editing.ts"
import { type EditorialOperation, type EditorialProposal } from "../../../agent-bridge/src/editorial.ts"
import { Button } from "#/components/ui/button.tsx"
import { ReviewSteps, CandidateChoices, type ReviewStage } from "#/components/review-workflow.tsx"
import { TranscriptEditor } from "#/components/transcript-editor.tsx"
import { editorialSegments } from "../../../agent-bridge/src/editorial.ts"
import { parseCaptionFile, type CaptionCue } from "#/lib/captions.ts"
import {
  buildTimelineSegments,
  applyProductionPreset,
  formatTimecode,
  getSubtitleProvider,
  getTitleCardCanvasBox,
  getPlanTrackCounts,
  getTimelineDuration,
  movePlanClip,
  parseEditPlan,
  productionPresetOptions,
  sampleEditPlan,
  setPlanCaptionsEnabled,
  updateAudioClip,
  updateAudioTrack,
  updateCaptionStyle,
  updateDucking,
  updateOverlayClip,
  updateOverlayClipCanvasBox,
  updatePlanClip,
  setSubtitleProviderMode,
  subtitleProviderOptions,
  updateTitleCard,
  updateTitleCardCanvasBox,
  updateSubtitleProvider,
  updateTransition,
  type CaptionStyle,
  type EditPlan,
  type OverlayClip,
  type ProductionPresetId,
  type SubtitleProviderMode,
  type TitleCard,
  type TimelineSegment,
} from "#/lib/edit-plan.ts"
import {
  candidateHasCurrentPreview,
  candidateForSelection,
  mediaAssetForPlan,
  type ReviewSessionPreflight,
  type ReviewExportPackage,
  type RenderBatch,
  type ReviewCandidate,
  type ReviewSession,
} from "#/lib/review-session.ts"


type ReviewState = "review" | "saving" | "previewing" | "preview-ready" | "rendering" | "rendered" | "failed"

type ApprovalResult = {
  projectRecordPath: string
  editPlanPath: string
  outputPath: string
  durationSeconds: number
  renderedSeconds: number
}

type BatchApprovalResult = {
  batchId: string
  status: RenderBatch["status"]
  results: Array<{ candidateId: string; status: "rendered" | "failed"; outputPath?: string; error?: string }>
  session: ReviewSession
}

type ExportPackageResult = {
  exportPackage: ReviewExportPackage
  session: ReviewSession
}

type CaptionGenerationResult = {
  mode: SubtitleProviderMode
  status: "generated" | "provided"
  captionsPath: string
  cues: number
  audioPath?: string
  uploadedAudioBytes?: number
  estimatedCostUsd?: number
  session: ReviewSession
}

type ReadinessStatus = "ready" | "missing" | "not-required"

type ReadinessCheck = {
  id: string
  label: string
  status: ReadinessStatus
  detail: string
  command?: string
  requiredEnv?: string
}

type SubtitleProviderReadiness = {
  mode: SubtitleProviderMode
  status: ReadinessStatus
  label: string
  detail: string
  requiresExternalUploadApproval: boolean
  command?: string
  requiredEnv?: string
  model?: string
  captionsPath?: string
  cues?: number
}

type ReviewSystemCheck = {
  bridge: ReadinessCheck
  ffmpeg: ReadinessCheck
  ffprobe: ReadinessCheck
  subtitleProvider: SubtitleProviderReadiness
  candidate?: {
    id: string
    title: string
    revision: number
    status: string
    planPath: string
    outputExists: boolean
    previewExists: boolean
  }
}

type CaptionRevisionResult = {
  captionsPath: string
  cues: number
  session: ReviewSession
}

const bridgeUrl = (
  import.meta.env.VITE_OPENCUT_BRIDGE_URL ?? "http://127.0.0.1:3210"
).replace(/\/$/, "")

export function AgentReviewWorkspace({ project }: { project?: WorkspaceProject }) {
  const [hasImportedPlan, setHasImportedPlan] = useState(false)
  const [clientReady, setClientReady] = useState(false)
  const [stage, setStage] = useState<ReviewStage>(project ? "edit" : "choose")
  const [projectBusy, setProjectBusy] = useState(false)
  const [timelineProposal, setTimelineProposal] = useState<(EditorialProposal & { proposalId: string }) | null>(null)
  const [previewMode, setPreviewMode] = useState<"source" | "edited">("source")
  const [showLayout, setShowLayout] = useState(false)
  const [selectingCandidate, setSelectingCandidate] = useState(false)
  const [plan, setPlan] = useState<EditPlan>(sampleEditPlan)
  const [selectedClipId, setSelectedClipId] = useState(
    sampleEditPlan.timeline.clips[0]?.id ?? "",
  )
  const [selectedOverlayClipId, setSelectedOverlayClipId] = useState("")
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState("")
  const [selectedAudioClipId, setSelectedAudioClipId] = useState("")
  const [selectedTransitionId, setSelectedTransitionId] = useState("")
  const [selectedTitleCardId, setSelectedTitleCardId] = useState("")
  const [reviewState, setReviewState] = useState<ReviewState>("review")
  const [approvalResult, setApprovalResult] = useState<ApprovalResult | null>(null)
  const [approvalError, setApprovalError] = useState<string | null>(null)
  const [batchCandidateIds, setBatchCandidateIds] = useState<string[]>([])
  const [batchRendering, setBatchRendering] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)
  const [preflightAttempt, setPreflightAttempt] = useState(0)
  const [preflight, setPreflight] = useState<ReviewSessionPreflight | null>(null)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [preflightError, setPreflightError] = useState<string | null>(null)
  const [exportPackaging, setExportPackaging] = useState(false)
  const [exportPackage, setExportPackage] = useState<ReviewExportPackage | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [bridgeOnline, setBridgeOnline] = useState<boolean | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoName, setVideoName] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentSourceTime, setCurrentSourceTime] = useState(
    sampleEditPlan.timeline.clips[0]?.sourceStart ?? 0,
  )
  const [captionCues, setCaptionCues] = useState<CaptionCue[]>([])
  const [captionDraftCues, setCaptionDraftCues] = useState<CaptionCue[]>([])
  const [captionsEnabled, setCaptionsEnabled] = useState(false)
  const [captionsLoading, setCaptionsLoading] = useState(false)
  const [captionsError, setCaptionsError] = useState<string | null>(null)
  const [captionGenerationLoading, setCaptionGenerationLoading] = useState(false)
  const [captionGenerationError, setCaptionGenerationError] = useState<string | null>(null)
  const [captionGenerationResult, setCaptionGenerationResult] = useState<CaptionGenerationResult | null>(null)
  const [captionRevisionLoading, setCaptionRevisionLoading] = useState(false)
  const [captionRevisionError, setCaptionRevisionError] = useState<string | null>(null)
  const [captionRevisionResult, setCaptionRevisionResult] = useState<CaptionRevisionResult | null>(null)
  const [systemCheck, setSystemCheck] = useState<ReviewSystemCheck | null>(null)
  const [systemCheckLoading, setSystemCheckLoading] = useState(false)
  const [systemCheckError, setSystemCheckError] = useState<string | null>(null)
  const [reviewSession, setReviewSession] = useState<ReviewSession | null>(null)
  const [activeReviewCandidateId, setActiveReviewCandidateId] = useState<string | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [revisionNote, setRevisionNote] = useState("")
  const [reviewerNote, setReviewerNote] = useState("")
  const [editorialBusy, setEditorialBusy] = useState(false)
  const planInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => { setClientReady(true) }, [])

  useEffect(() => {
    videoRef.current?.pause()
    setIsPlaying(false)
  }, [stage, previewMode])

  const segments = useMemo(() => buildTimelineSegments(plan), [plan])
  const totalDuration = useMemo(() => getTimelineDuration(plan), [plan])
  const trackCounts = useMemo(() => getPlanTrackCounts(plan), [plan])
  const selectedSegment =
    segments.find(({ clip }) => clip.id === selectedClipId) ?? segments[0]
  const selectedAsset = plan.assets.find(
    (asset) => asset.id === selectedSegment?.clip.assetId,
  )
  const captionsAsset = plan.assets.find(
    (asset) => asset.id === plan.timeline.captionsAssetId,
  )
  const captionsPath = captionsAsset?.path ?? null
  const selectionProgressSeconds = selectedSegment
    ? Math.min(
        selectedSegment.durationSeconds,
        Math.max(
          0,
          (currentSourceTime - selectedSegment.clip.sourceStart) /
            selectedSegment.clip.speed,
        ),
      )
    : 0
  const currentTimelineTime = selectedSegment
    ? selectedSegment.timelineStart + selectionProgressSeconds
    : 0
  const activeCaption = captionsEnabled
    ? captionCues.find(
        (cue) => currentTimelineTime >= cue.start && currentTimelineTime <= cue.end,
      )
    : undefined
  const activeCandidate = reviewSession?.candidates.find(
    (candidate) => candidate.id === activeReviewCandidateId,
  )
  const activeClipRationale = activeCandidate?.clipRationales.find(
    (entry) => entry.clipId === selectedSegment?.clip.id,
  )
  const planIsDirty = Boolean(activeCandidate && JSON.stringify(activeCandidate.plan) !== JSON.stringify(plan))
  const captionDraftDirty = Boolean(captionsPath && JSON.stringify(captionDraftCues) !== JSON.stringify(captionCues))
  const hasCurrentPreview = candidateHasCurrentPreview(activeCandidate)
  const sessionId = typeof window === "undefined"
    ? null
    : new URLSearchParams(window.location.search).get("session")
  const previewUrl = reviewSession && sessionId && activeCandidate && hasCurrentPreview
    ? `${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId)}/candidates/${encodeURIComponent(activeCandidate.id)}/preview`
    : null
  const renderLimit = project ? Math.min(14_400, Math.ceil(totalDuration)) : 300
  const previewLimit = project ? renderLimit : 60
  const latestBatch = reviewSession?.renderBatches.at(-1)
  const latestExportPackage = exportPackage ?? reviewSession?.exportPackages.at(-1) ?? null
  const activePreflight = activeCandidate
    ? preflight?.candidates.find((candidate) => candidate.candidateId === activeCandidate.id)
    : undefined
  const activePreflightBlocks = activePreflight?.summary.block ?? 0
  const renderedCandidateIds = reviewSession?.candidates
    .filter((candidate) => candidate.outputExists || candidate.status === "rendered")
    .map((candidate) => candidate.id) ?? []
  const latestBatchActive = latestBatch?.status === "queued" || latestBatch?.status === "rendering"
  const interactionLocked = projectBusy || editorialBusy || reviewState === "saving" || reviewState === "previewing" || reviewState === "rendering" || batchRendering || latestBatchActive || captionGenerationLoading || captionRevisionLoading
  const canEditPlan = Boolean(
    reviewSession &&
    activeCandidate &&
    !interactionLocked &&
    reviewState !== "rendered" &&
    activeCandidate.status !== "queued" &&
    activeCandidate.status !== "rendering" &&
    !activeCandidate.outputExists,
  )

  useEffect(() => {
    if (!reviewSession) return
    setBatchCandidateIds((ids) => ids.filter((id) => {
      const candidate = reviewSession.candidates.find((entry) => entry.id === id)
      return candidate ? canBatchRenderCandidate(candidate) : false
    }))
  }, [reviewSession])

  useEffect(() => {
    if (!reviewSession || !activeCandidate || !sessionId || planIsDirty || captionDraftDirty) {
      setPreflight(null)
      setPreflightError(null)
      setPreflightLoading(false)
      return
    }
    const controller = new AbortController()
    const mode = hasCurrentPreview ? "final" : "preview"
    setPreflightLoading(true)
    setPreflightError(null)
    void fetch(`${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId)}/preflight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateIds: [activeCandidate.id],
        mode,
        renderLimitSeconds: mode === "preview" ? previewLimit : renderLimit,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as ReviewSessionPreflight & { error?: string }
        if (!response.ok) throw new Error(payload.error ?? `Local bridge returned ${response.status}`)
        setPreflight(payload)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setPreflightError(error instanceof Error ? error.message : "Could not run preflight checks")
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreflightLoading(false)
      })
    return () => controller.abort()
  }, [activeCandidate?.id, activeCandidate?.revision, captionDraftDirty, hasCurrentPreview, planIsDirty, reviewSession, sessionId, preflightAttempt, previewLimit, renderLimit])

  useEffect(() => {
    return () => {
      if (videoUrl?.startsWith("blob:")) URL.revokeObjectURL(videoUrl)
    }
  }, [videoUrl])

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 2_500)
    void fetch(`${bridgeUrl}/health`, { signal: controller.signal })
      .then((response) => setBridgeOnline(response.ok))
      .catch(() => setBridgeOnline(false))
      .finally(() => window.clearTimeout(timeout))
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [])

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search)
    const sessionId = parameters.get("session")
    if (sessionId) {
      const controller = new AbortController()
      void fetch(`${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId)}`, { signal: controller.signal })
        .then(async (response) => {
          const payload = (await response.json()) as ReviewSession & { error?: string }
          if (!response.ok) throw new Error(payload.error ?? `Local bridge returned ${response.status}`)
          setReviewSession(payload)
          const candidate = candidateForSelection(payload) ?? payload.candidates[0]
          if (candidate) applyReviewCandidate(payload, candidate)
        })
        .catch((error) => {
          if (!controller.signal.aborted) setSessionError(error instanceof Error ? error.message : "Could not load review session")
        })
      return () => controller.abort()
    }

    const encodedPlan = parameters.get("plan")
    if (!encodedPlan) return

    try {
      const importedPlan = parseEditPlan(JSON.parse(encodedPlan))
      setPlan(importedPlan)
      setHasImportedPlan(true)
      setStage("edit")
      setSelectedClipId(importedPlan.timeline.clips[0]?.id ?? "")
      setCurrentSourceTime(importedPlan.timeline.clips[0]?.sourceStart ?? 0)
      setReviewState("review")
      setApprovalResult(null)
      setApprovalError(null)
      setPlanError(null)
    } catch (error) {
      setPlanError(
        error instanceof Error ? error.message : "Could not read the review plan from the URL",
      )
    }
  }, [])

  function applyReviewCandidate(
    session: ReviewSession,
    candidate: ReviewCandidate,
  ) {
    setPreviewMode("source")
    setTimelineProposal(null)
    setActiveReviewCandidateId(candidate.id)
    setPlan(candidate.plan)
    setSelectedClipId(candidate.plan.timeline.clips[0]?.id ?? "")
    resetProductionSelections(candidate.plan)
    setCurrentSourceTime(candidate.plan.timeline.clips[0]?.sourceStart ?? 0)
    setReviewState(
      candidate.status === "rendered" || candidate.outputExists
        ? "rendered"
        : candidate.status === "failed"
          ? "failed"
          : candidate.status === "queued" || candidate.status === "rendering"
            ? "rendering"
            : candidate.status === "previewing"
              ? "previewing"
              : candidateHasCurrentPreview(candidate)
                ? "preview-ready"
                : "review",
    )
    setApprovalResult(null)
    setApprovalError(candidate.error ?? null)
    setCaptionGenerationError(null)
    setCaptionGenerationResult(null)
    setCaptionRevisionError(null)
    setCaptionRevisionResult(null)
    setSystemCheckError(null)
    setSystemCheck(null)
    setPlanError(null)
    setRevisionNote("")
    const asset = mediaAssetForPlan(session, candidate.plan)
    const sessionId = new URLSearchParams(window.location.search).get(
      "session",
    )
    if (asset && sessionId) {
      setVideoUrl(
        `${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId)}/media/${encodeURIComponent(asset.id)}`,
      )
      setVideoName(asset.label)
    }
  }

  async function selectReviewCandidate(candidateId: string) {
    if (
      !reviewSession ||
      interactionLocked ||
      selectingCandidate ||
      planIsDirty ||
      captionDraftDirty
    )
      return
    setSelectingCandidate(true)
    setSessionError(null)
    try {
      const sessionId = new URLSearchParams(window.location.search).get(
        "session",
      )
      const response = await fetch(
        `${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId ?? "")}/select`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId }),
        },
      )
      const payload = (await response.json()) as ReviewSession & {
        error?: string
      }
      if (!response.ok)
        throw new Error(
          payload.error ?? `Local bridge returned ${response.status}`,
        )
      setReviewSession(payload)
      const candidate = candidateForSelection(payload)
      if (candidate) {
        applyReviewCandidate(payload, candidate)
        const finalReady =
          candidate.outputExists || candidate.status === "rendered"
        setStage(finalReady ? "review" : "edit")
        if (finalReady && candidateHasCurrentPreview(candidate))
          setPreviewMode("edited")
      }
    } catch (error) {
      setSessionError(
        error instanceof Error ? error.message : "Could not select candidate",
      )
    } finally {
      setSelectingCandidate(false)
    }
  }

  function reviseSelectedClip(patch: Partial<EditPlan["timeline"]["clips"][number]>) {
    if (!selectedSegment || !canEditPlan) return
    if (captionDraftDirty) {
      setPlanError("Save or reset caption QA edits before changing timeline controls")
      return
    }
    try {
      setPlan(updatePlanClip(plan, selectedSegment.clip.id, patch))
      setPlanError(null)
    } catch (error) {
      setPlanError(error instanceof Error ? error.message : "Invalid clip revision")
    }
  }

  async function saveRevision() {
    if (!reviewSession || !activeCandidate || !planIsDirty || interactionLocked) return
    if (captionDraftDirty) {
      setSessionError("Save or reset caption QA edits before saving timeline/style changes")
      return
    }
    setReviewState("saving")
    setSessionError(null)
    try {
      const response = await fetch(`${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId ?? "")}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId: activeCandidate.id, expectedRevision: activeCandidate.revision, plan, note: revisionNote || undefined }),
      })
      const payload = (await response.json()) as ReviewSession & { error?: string }
      if (!response.ok) throw new Error(payload.error ?? `Local bridge returned ${response.status}`)
      setReviewSession(payload)
      const candidate = candidateForSelection(payload)
      if (candidate) applyReviewCandidate(payload, candidate)
    } catch (error) {
      setReviewState("failed")
      setSessionError(error instanceof Error ? error.message : "Could not save this revision")
    }
  }

  async function renderPreview() {
    if (
      !reviewSession ||
      !activeCandidate ||
      planIsDirty ||
      captionDraftDirty ||
      interactionLocked
    )
      return
    setReviewState("previewing")
    setApprovalError(null)
    try {
      const response = await fetch(
        `${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId ?? "")}/render-preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidateId: activeCandidate.id,
            approvalToken: reviewSession.approvalToken,
            renderLimitSeconds: previewLimit,
          }),
        },
      )
      const payload = (await response.json()) as ApprovalResult & {
        error?: string
        session?: ReviewSession
      }
      if (!response.ok || !payload.session)
        throw new Error(
          payload.error ?? `Local bridge returned ${response.status}`,
        )
      setReviewSession(payload.session)
      const candidate = candidateForSelection(payload.session)
      if (candidate) applyReviewCandidate(payload.session, candidate)
      setReviewState("preview-ready")
      setPreviewMode("edited")
      setApprovalResult(payload)
    } catch (error) {
      setReviewState("failed")
      setApprovalError(
        error instanceof Error ? error.message : "Could not render the preview",
      )
    }
  }

  async function generateCaptions() {
    if (!reviewSession || !activeCandidate || planIsDirty || interactionLocked) return
    const subtitleProvider = getSubtitleProvider(plan)
    if (!subtitleProvider) return
    const usesExternalApi = subtitleProvider.mode === "openai-api" || subtitleProvider.mode === "openrouter"
    if (usesExternalApi) {
      const approved = window.confirm(
        `Generate captions with ${subtitleProvider.mode}? This extracts only this candidate's dialogue audio and uploads that WAV audio to the selected API provider. Continue?`,
      )
      if (!approved) return
    }

    setCaptionGenerationLoading(true)
    setCaptionGenerationError(null)
    setCaptionGenerationResult(null)
    try {
      const response = await fetch(`${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId ?? "")}/generate-captions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: activeCandidate.id,
          approvalToken: reviewSession.approvalToken,
          externalUploadApproved: usesExternalApi,
        }),
      })
      const payload = (await response.json()) as CaptionGenerationResult & { error?: string }
      if (!response.ok || !payload.session) throw new Error(payload.error ?? `Local bridge returned ${response.status}`)
      setReviewSession(payload.session)
      const candidate = candidateForSelection(payload.session)
      if (candidate) applyReviewCandidate(payload.session, candidate)
      setCaptionsEnabled(true)
      setCaptionGenerationResult(payload)
    } catch (error) {
      setCaptionGenerationError(error instanceof Error ? error.message : "Could not generate captions")
    } finally {
      setCaptionGenerationLoading(false)
    }
  }

  async function runSystemCheck() {
    if (!reviewSession || !activeCandidate || !sessionId || planIsDirty || systemCheckLoading) return
    setSystemCheckLoading(true)
    setSystemCheckError(null)
    try {
      const response = await fetch(
        `${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId)}/system-check?candidateId=${encodeURIComponent(activeCandidate.id)}`,
      )
      const payload = (await response.json()) as ReviewSystemCheck & { error?: string }
      if (!response.ok) throw new Error(payload.error ?? `Local bridge returned ${response.status}`)
      setSystemCheck(payload)
    } catch (error) {
      setSystemCheckError(error instanceof Error ? error.message : "Could not run the system check")
    } finally {
      setSystemCheckLoading(false)
    }
  }

  async function saveCaptionRevision() {
    if (!reviewSession || !activeCandidate || !captionDraftDirty || planIsDirty || interactionLocked) return
    setCaptionRevisionLoading(true)
    setCaptionRevisionError(null)
    setCaptionRevisionResult(null)
    try {
      const response = await fetch(`${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId ?? "")}/revise-captions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: activeCandidate.id,
          approvalToken: reviewSession.approvalToken,
          cues: captionDraftCues,
          note: "Caption QA edits from review UI",
        }),
      })
      const payload = (await response.json()) as CaptionRevisionResult & { error?: string }
      if (!response.ok || !payload.session) throw new Error(payload.error ?? `Local bridge returned ${response.status}`)
      setReviewSession(payload.session)
      const candidate = candidateForSelection(payload.session)
      if (candidate) applyReviewCandidate(payload.session, candidate)
      setCaptionsEnabled(true)
      setCaptionRevisionResult(payload)
    } catch (error) {
      setCaptionRevisionError(error instanceof Error ? error.message : "Could not save caption QA edits")
    } finally {
      setCaptionRevisionLoading(false)
    }
  }

  async function addReviewerNote() {
    if (!reviewSession || !activeCandidate || !reviewerNote.trim()) return
    setSessionError(null)
    try {
      const response = await fetch(`${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId ?? "")}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId: activeCandidate.id, text: reviewerNote.trim() }),
      })
      const payload = (await response.json()) as ReviewSession & { error?: string }
      if (!response.ok) throw new Error(payload.error ?? `Local bridge returned ${response.status}`)
      setReviewSession(payload)
      setReviewerNote("")
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Could not save reviewer note")
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    setCaptionCues([])
    setCaptionDraftCues([])
    setCaptionsEnabled(false)
    setCaptionsError(null)
    if ((!hasImportedPlan && !reviewSession) || !captionsPath || (sessionId && !activeReviewCandidateId) || (planIsDirty && activeCandidate?.plan.timeline.captionsAssetId !== plan.timeline.captionsAssetId)) {
      setCaptionsLoading(false)
      return () => controller.abort()
    }

    setCaptionsLoading(true)
    const captionsUrl = sessionId && activeReviewCandidateId
      ? `${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId)}/candidates/${encodeURIComponent(activeReviewCandidateId)}/captions`
      : `${bridgeUrl}/v1/assets/text?path=${encodeURIComponent(captionsPath)}`
    void fetch(
      captionsUrl,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const payload = (await response.json()) as { contents?: string; error?: string }
        if (!response.ok || payload.contents === undefined) {
          throw new Error(payload.error ?? `Local bridge returned ${response.status}`)
        }
        const cues = parseCaptionFile(payload.contents)
        if (cues.length === 0) throw new Error("No caption cues were found")
        setCaptionCues(cues)
        setCaptionDraftCues(cues)
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setCaptionsError(
          error instanceof Error ? error.message : "Could not load the caption track",
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setCaptionsLoading(false)
      })
    return () => controller.abort()
  }, [activeReviewCandidateId, activeCandidate?.revision, captionsPath, sessionId, hasImportedPlan, planIsDirty])

  async function handlePlanFile(file: File | undefined) {
    if (!file) return

    try {
      const importedPlan = parseEditPlan(JSON.parse(await file.text()))
      setPlan(importedPlan)
      setHasImportedPlan(true)
      setStage("edit")
      setSelectedClipId(importedPlan.timeline.clips[0]?.id ?? "")
      resetProductionSelections(importedPlan)
      setCurrentSourceTime(importedPlan.timeline.clips[0]?.sourceStart ?? 0)
      setReviewState("review")
      setApprovalResult(null)
      setApprovalError(null)
      setPlanError(null)
    } catch (error) {
      setPlanError(error instanceof Error ? error.message : "Could not read this edit plan")
    }
  }

  function handleVideoFile(file: File | undefined) {
    if (!file) return
    if (videoUrl?.startsWith("blob:")) URL.revokeObjectURL(videoUrl)
    setVideoUrl(URL.createObjectURL(file))
    setVideoName(file.name)
    setCurrentSourceTime(selectedSegment?.clip.sourceStart ?? 0)
    setIsPlaying(false)
  }

  function resetProductionSelections(nextPlan: EditPlan) {
    if (nextPlan.version !== "2") {
      setSelectedOverlayClipId("")
      setSelectedAudioTrackId("")
      setSelectedAudioClipId("")
      setSelectedTransitionId("")
      setSelectedTitleCardId("")
      return
    }
    setSelectedOverlayClipId(nextPlan.timeline.overlayTracks[0]?.clips[0]?.id ?? "")
    setSelectedAudioTrackId(nextPlan.timeline.audioTracks[0]?.id ?? "")
    setSelectedAudioClipId(nextPlan.timeline.audioTracks[0]?.clips[0]?.id ?? "")
    setSelectedTransitionId(nextPlan.timeline.transitions[0]?.id ?? "")
    setSelectedTitleCardId(nextPlan.timeline.titleCards[0]?.id ?? "")
  }

  function reviseProductionPlan(edit: (current: EditPlan) => EditPlan) {
    if (!canEditPlan) return
    if (captionDraftDirty) {
      setPlanError("Save or reset caption QA edits before changing production controls")
      return
    }
    try {
      setPlan(parseEditPlan(edit(plan)))
      setPlanError(null)
    } catch (error) {
      setPlanError(error instanceof Error ? error.message : "Invalid production revision")
    }
  }

  function toggleBatchCandidate(candidateId: string) {
    const candidate = reviewSession?.candidates.find((entry) => entry.id === candidateId)
    if (!candidate || !canBatchRenderCandidate(candidate) || interactionLocked || planIsDirty || captionDraftDirty) return
    setBatchCandidateIds((ids) => ids.includes(candidateId)
      ? ids.filter((id) => id !== candidateId)
      : [...ids, candidateId])
    setBatchError(null)
  }

  function selectFailedBatchCandidates() {
    if (!reviewSession || !latestBatch || (latestBatch.status !== "failed" && latestBatch.status !== "partial")) return
    const failedIds = latestBatch.items
      .filter((item) => item.status === "failed")
      .map((item) => item.candidateId)
      .filter((candidateId) => {
        const candidate = reviewSession.candidates.find((entry) => entry.id === candidateId)
        return candidate ? canBatchRenderCandidate(candidate) : false
      })
    setBatchCandidateIds(failedIds)
    setBatchError(null)
  }

  async function pollReviewSession(currentSessionId: string) {
    const response = await fetch(`${bridgeUrl}/v1/review-sessions/${encodeURIComponent(currentSessionId)}`)
    const payload = (await response.json()) as ReviewSession & { error?: string }
    if (!response.ok) throw new Error(payload.error ?? `Local bridge returned ${response.status}`)
    setReviewSession(payload)
    const candidate = activeReviewCandidateId
      ? payload.candidates.find((entry) => entry.id === activeReviewCandidateId)
      : candidateForSelection(payload)
    if (candidate && !planIsDirty) applyReviewCandidate(payload, candidate)
  }

  async function approveBatch() {
    if (!reviewSession || batchCandidateIds.length === 0 || interactionLocked || planIsDirty || captionDraftDirty) return
    setBatchRendering(true)
    setBatchError(null)
    setApprovalResult(null)
    const currentSessionId = new URLSearchParams(window.location.search).get("session") ?? ""
    let pollTimer: number | null = window.setInterval(() => {
      void pollReviewSession(currentSessionId).catch(() => undefined)
    }, 800)
    try {
      const response = await fetch(`${bridgeUrl}/v1/review-sessions/${encodeURIComponent(currentSessionId)}/approve-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateIds: batchCandidateIds,
          approvalToken: reviewSession.approvalToken,
          renderLimitSeconds: renderLimit,
        }),
      })
      const payload = (await response.json()) as BatchApprovalResult & { error?: string }
      if (!response.ok || !payload.session) throw new Error(payload.error ?? `Local bridge returned ${response.status}`)
      setReviewSession(payload.session)
      setBatchCandidateIds((ids) => ids.filter((id) => !payload.results.some((result) => result.candidateId === id && result.status === "rendered")))
      const candidate = activeReviewCandidateId
        ? payload.session.candidates.find((entry) => entry.id === activeReviewCandidateId)
        : candidateForSelection(payload.session)
      if (candidate) applyReviewCandidate(payload.session, candidate)
      if (payload.status === "failed" || payload.status === "partial") {
        const failed = payload.results.filter((result) => result.status === "failed").map((result) => result.candidateId).join(", ")
        setBatchError(`Batch ${payload.status}. Failed candidates: ${failed || "none"}`)
      }
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : "Could not approve this batch")
    } finally {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer)
        pollTimer = null
      }
      setBatchRendering(false)
    }
  }

  async function createExportPackage() {
    if (!reviewSession || renderedCandidateIds.length === 0 || exportPackaging || !sessionId) return
    setExportPackaging(true)
    setExportError(null)
    try {
      const response = await fetch(`${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId)}/export-package`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateIds: renderedCandidateIds,
          approvalToken: reviewSession.approvalToken,
          includeContactSheets: true,
        }),
      })
      const payload = (await response.json()) as ExportPackageResult & { error?: string }
      if (!response.ok || !payload.session || !payload.exportPackage) throw new Error(payload.error ?? `Local bridge returned ${response.status}`)
      setReviewSession(payload.session)
      setExportPackage(payload.exportPackage)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Could not create the export package")
    } finally {
      setExportPackaging(false)
    }
  }

  function selectSegment(segment: TimelineSegment) {
    seekToTranscriptTime(segment.timelineStart)
  }

  function seekToTranscriptTime(seconds: number) {
    setPreviewMode("source")
    const segment = editorialSegments(plan).find(
      (segment) => seconds >= segment.start && seconds < segment.end,
    )
    if (!segment) return
    const sourceTime =
      segment.clip.sourceStart + (seconds - segment.start) * segment.clip.speed
    setSelectedClipId(segment.clip.id)
    setCurrentSourceTime(sourceTime)
    const asset = plan.assets.find(
      (asset) => asset.id === segment.clip.assetId,
    )
    const source = reviewSession?.sourceAssets.find(
      (source) => source.id === asset?.id || source.path === asset?.path,
    )
    if (!source && project) { setVideoUrl(null); setVideoName(null) }
    if (source && sessionId) {
      setVideoUrl(
        `${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId)}/media/${encodeURIComponent(source.id)}`,
      )
      setVideoName(source.label)
    }
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = sourceTime
    }
    setIsPlaying(false)
  }

  async function toggleSelectionPlayback() {
    const video = videoRef.current
    if (!video || !selectedSegment) return

    if (!video.paused) {
      video.pause()
      setIsPlaying(false)
      return
    }

    if (
      video.currentTime < selectedSegment.clip.sourceStart ||
      video.currentTime >= selectedSegment.clip.sourceEnd
    ) {
      video.currentTime = selectedSegment.clip.sourceStart
      setCurrentSourceTime(selectedSegment.clip.sourceStart)
    }
    await video.play()
    setIsPlaying(true)
  }

  function handleSelectionTimeUpdate() {
    const video = videoRef.current
    if (!video || !selectedSegment) return
    setCurrentSourceTime(video.currentTime)
    if (video.currentTime >= selectedSegment.clip.sourceEnd) {
      video.pause()
      video.currentTime = selectedSegment.clip.sourceStart
      setCurrentSourceTime(selectedSegment.clip.sourceStart)
      setIsPlaying(false)
    }
  }

  function seekToSelectionTime(timelineSeconds: number) {
    const video = videoRef.current
    if (!video || !selectedSegment) return
    const safeTimelineSeconds = Math.min(
      selectedSegment.durationSeconds,
      Math.max(0, timelineSeconds),
    )
    const requestedSourceTime =
      selectedSegment.clip.sourceStart +
      safeTimelineSeconds * selectedSegment.clip.speed
    const maximumSourceTime = Math.max(
      selectedSegment.clip.sourceStart,
      selectedSegment.clip.sourceEnd - 0.01,
    )
    const nextSourceTime = Math.min(maximumSourceTime, requestedSourceTime)
    video.currentTime = nextSourceTime
    setCurrentSourceTime(nextSourceTime)
  }

  function seekBy(timelineSeconds: number) {
    seekToSelectionTime(selectionProgressSeconds + timelineSeconds)
  }

  async function approveAndRender() {
    if (reviewState === "rendering" || reviewState === "rendered" || batchRendering || latestBatchActive) return

    let bridgeResponded = false
    setReviewState("rendering")
    setApprovalError(null)
    setApprovalResult(null)
    try {
      const sessionId = new URLSearchParams(window.location.search).get("session")
      const selectedCandidate = reviewSession ? candidateForSelection(reviewSession) : null
      if (reviewSession && !selectedCandidate) throw new Error("Select a candidate before approval")
      if (reviewSession && planIsDirty) throw new Error("Save the current revision before final approval")
      if (reviewSession && captionDraftDirty) throw new Error("Save caption QA edits before final approval")
      if (reviewSession && !candidateHasCurrentPreview(selectedCandidate ?? undefined)) {
        throw new Error("Render and review a preview of this revision before final approval")
      }
      const response = await fetch(reviewSession
        ? `${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId ?? "")}/approve-and-render`
        : `${bridgeUrl}/v1/projects/approve-and-render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reviewSession
          ? { candidateId: selectedCandidate?.id, approvalToken: reviewSession.approvalToken, renderLimitSeconds: renderLimit }
          : { plan, renderLimitSeconds: renderLimit }),
      })
      bridgeResponded = true
      const payload = (await response.json()) as ApprovalResult & { error?: string; session?: ReviewSession }
      if (!response.ok) {
        throw new Error(payload.error ?? `Local bridge returned ${response.status}`)
      }
      setApprovalResult(payload)
      setBridgeOnline(true)
      setReviewState("rendered")
      if (payload.session) setReviewSession(payload.session)
    } catch (error) {
      setBridgeOnline(bridgeResponded)
      setApprovalError(
        error instanceof Error
          ? error.message
          : "The local bridge could not render this project",
      )
      setReviewState("failed")
    }
  }

  async function importMainMedia(path: string, purpose: ImportPurpose) {
    if (!project || !canEditPlan || captionDraftDirty || timelineProposal) throw new Error("Finish the current edit before adding media")
    setProjectBusy(true)
    try {
      const media = await projectRequest<ProjectMedia>(`/${project.id}/media`, { path })
      setPlan(addProjectMedia(plan, media, purpose))
      setPlanError(null)
    } finally { setProjectBusy(false) }
  }
  async function createMainClip(title: string, start: number, end: number) {
    if (!project || !activeCandidate || interactionLocked || planIsDirty || captionDraftDirty || timelineProposal) throw new Error("Save the main edit before creating a clip")
    setProjectBusy(true)
    try {
      const result = await projectRequest<{ project: WorkspaceProject; warnings: string[] }>(`/${project.id}/clips`, { title, start, end, expectedRevision: activeCandidate.revision })
      if (result.warnings.length) setSessionError(result.warnings.join(" "))
      return result.project
    } finally { setProjectBusy(false) }
  }
  async function proposeTimelineEdit(operation: EditorialOperation) {
    if (!canEditPlan || !activeCandidate || !reviewSession || planIsDirty || captionDraftDirty) return
    setProjectBusy(true); setSessionError(null); setTimelineProposal(null)
    try {
      const response = await fetch(`${bridgeUrl}/v1/review-sessions/${sessionId}/edits/propose`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateId: activeCandidate.id, expectedRevision: activeCandidate.revision, approvalToken: reviewSession.approvalToken, operation }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setTimelineProposal(result)
    } catch (error) { setSessionError(error instanceof Error ? error.message : "Could not propose the edit") }
    finally { setProjectBusy(false) }
  }
  async function saveTimelineProposal() {
    if (!timelineProposal || !activeCandidate || !reviewSession || interactionLocked || planIsDirty || captionDraftDirty) return
    setProjectBusy(true)
    try {
      const response = await fetch(`${bridgeUrl}/v1/review-sessions/${sessionId}/edits/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateId: activeCandidate.id, expectedRevision: activeCandidate.revision, approvalToken: reviewSession.approvalToken, proposalId: timelineProposal.proposalId }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setReviewSession(result)
      const candidate = candidateForSelection(result)
      if (candidate) applyReviewCandidate(result, candidate)
      setTimelineProposal(null)
    } catch (error) { setSessionError(error instanceof Error ? error.message : "Could not save the edit") }
    finally { setProjectBusy(false) }
  }
  async function duplicateMainProject() {
    if (!project || interactionLocked) return
    setProjectBusy(true)
    try { const result = await projectRequest<WorkspaceProject>(`/${project.id}/duplicate`, {}); window.location.assign(`/editor?project=${result.id}`) }
    catch (error) { setSessionError(error instanceof Error ? error.message : "Could not duplicate the project"); setProjectBusy(false) }
  }

  function downloadPlan() {
    const blob = new Blob([`${JSON.stringify(plan, null, 2)}\n`], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${plan.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.edit-plan.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (project && !reviewSession) return <main className="min-h-screen bg-[#0c0d0f] p-8 text-zinc-200"><a href="/" className="text-amber-200">← Projects</a><p className="mt-8" role={sessionError ? "alert" : "status"}>{sessionError ?? "Loading the full-video editor…"}</p></main>

  return (
    <main className="dark min-h-screen bg-[#0c0d0f] text-zinc-100 selection:bg-amber-300/30 [&_h1]:font-sans [&_h2]:font-sans [&_h3]:font-sans">
      <input
        ref={planInputRef}
        className="hidden"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          void handlePlanFile(file)
        }}
      />
      <input
        ref={videoInputRef}
        className="hidden"
        type="file"
        accept="video/*"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          handleVideoFile(file)
        }}
      />

      <header className="border-b border-white/10 bg-[#111214] px-5 py-4 sm:px-8">
        <div className="mx-auto mb-3 max-w-7xl"><a href="/" className="text-xs text-amber-200">← Projects</a></div>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-300 text-zinc-950">
              <Film className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-zinc-400">OpenCut · {project ? "Main editor" : "Clip review"}</p>
              <h1 className="truncate text-base font-semibold sm:text-lg">
                {reviewSession?.title ?? (hasImportedPlan ? plan.project.name : "Review workspace")}
              </h1>
            </div>
          </div>
          <span
            role="status"
            className={`shrink-0 text-xs ${bridgeOnline === false ? "text-red-300" : "text-zinc-400"}`}
          >
            {bridgeOnline === true
              ? "Local workspace"
              : bridgeOnline === false
                ? "Local service offline"
                : "Connecting…"}
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-8">
        {project ? <nav aria-label="Main project steps" className="flex flex-wrap items-center gap-3"><Button variant={stage === "edit" ? "default" : "outline"} disabled={interactionLocked} onClick={() => { setStage("edit"); setPreviewMode("source") }}>Edit video</Button><Button variant={stage === "review" ? "default" : "outline"} disabled={interactionLocked || Boolean(timelineProposal)} onClick={() => { setStage("review"); setPreviewMode(hasCurrentPreview && !planIsDirty && !captionDraftDirty ? "edited" : "source") }}>Review & export</Button><span className="ml-auto text-xs text-zinc-400">Full video · {formatTimecode(totalDuration)}</span></nav> : (<>
        <ReviewSteps
          stage={stage}
          onChange={(next) => {
            setStage(next)
            setPreviewMode(
              next === "review" &&
                hasCurrentPreview &&
                !planIsDirty &&
                !captionDraftDirty
                ? "edited"
                : "source",
            )
          }}
          hasSelection={reviewSession ? Boolean(reviewSession.selectedCandidateId) : hasImportedPlan}
          locked={interactionLocked || selectingCandidate}
          dirty={planIsDirty || captionDraftDirty}
        />
        </>)}
        {sessionError || approvalError || planError ? (
          <p
            role="alert"
            className="rounded-lg border border-red-300/25 bg-red-300/10 p-4 text-sm text-red-200"
          >
            {sessionError || approvalError || planError}
          </p>
        ) : null}
        {stage === "choose" ? (
          <section aria-label="Choose clips" className="space-y-5">
            <div>
              <h2 className="text-2xl font-semibold">Find your next clip</h2>
              <p className="mt-2 text-sm text-zinc-400">
                Choose one to watch and edit. Each clip keeps its own changes
                and exports.
              </p>
            </div>
            {reviewSession ? (
              <CandidateChoices
                candidates={reviewSession.candidates}
                selectedId={reviewSession.selectedCandidateId}
                disabled={
                  interactionLocked ||
                  selectingCandidate ||
                  planIsDirty ||
                  captionDraftDirty
                }
                onSelect={(id) => void selectReviewCandidate(id)}
              />
            ) : (
              <div className="rounded-xl border border-white/10 p-6 text-sm text-zinc-400">
                <p>
                  {sessionError
                    ? "Reopen this project using its local review launcher."
                    : !clientReady || sessionId
                    ? "Loading your review project…"
                    : "Open a review project link, or import an edit plan to get started."}
                </p>
                {clientReady && !sessionId ? (
                  <Button
                    className="mt-4"
                    variant="outline"
                    onClick={() => {
                      planInputRef.current?.click()
                    }}
                  >
                    Import edit plan
                  </Button>
                ) : null}
              </div>
            )}
            {selectingCandidate ? (
              <p role="status" className="text-sm text-amber-200">
                Opening clip…
              </p>
            ) : null}
          </section>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs text-amber-200">
                  {stage === "edit" ? project ? "Main edit" : "Edit clip" : "Review & export"}
                </p>
                <h2 className="mt-1 text-xl font-semibold sm:text-2xl">
                  {activeCandidate?.title ?? plan.project.name}
                </h2>
                <p className="mt-2 text-sm text-zinc-400">
                  {stage === "edit"
                    ? project ? "Arrange the full timeline, edit with the transcript, and add your production layers." : "Watch the source. Select transcript passages to keep or remove."
                    : "Watch the edited preview, then approve the final video."}
                </p>
              </div>
              {stage === "edit" ? (
                <Button
                  className="min-h-11 bg-amber-300 text-zinc-950 hover:bg-amber-200"
                  disabled={interactionLocked || Boolean(timelineProposal)}
                  onClick={() => {
                    setStage("review")
                    setPreviewMode(
                      hasCurrentPreview && !planIsDirty && !captionDraftDirty
                        ? "edited"
                        : "source",
                    )
                  }}
                >
                  Continue to review <ArrowRight />
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={interactionLocked}
                  onClick={() => {
                    setStage("edit")
                    setPreviewMode("source")
                  }}
                >
                  Back to editing
                </Button>
              )}
            </div>
            {planIsDirty || captionDraftDirty ? (
              <div
                role="status"
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/30 bg-amber-300/5 p-4"
              >
                <p className="text-sm text-amber-100">
                  Unsaved {captionDraftDirty ? "caption" : "clip"} changes. Save
                  them before previewing or switching clips.
                </p>
                {planIsDirty ? (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={interactionLocked}
                      onClick={() => {
                        if (activeCandidate && reviewSession)
                          applyReviewCandidate(reviewSession, activeCandidate)
                      }}
                    >
                      Discard changes
                    </Button>
                    <Button
                      disabled={interactionLocked}
                      onClick={() => void saveRevision()}
                    >
                      {reviewState === "saving" ? "Saving…" : "Save changes"}
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" onClick={() => setStage("edit")}>
                    Open caption corrections
                  </Button>
                )}
              </div>
            ) : null}
            {project && stage === "edit" ? <details className="rounded-xl border border-white/10 bg-[#111214]"><summary className="cursor-pointer p-4 text-sm font-medium">Media & production <span className="ml-2 font-normal text-zinc-500">Add video, watermark, music, captions or titles</span></summary><MainProjectTools project={project} plan={plan} disabled={!canEditPlan || captionDraftDirty || Boolean(timelineProposal)} canCreateClip={!interactionLocked && !planIsDirty && !captionDraftDirty && !timelineProposal && Boolean(activeCandidate)} onImport={importMainMedia} onApply={reviseProductionPlan} onCreateClip={createMainClip} /></details> : null}
            {project && timelineProposal ? <section aria-label="Proposed timeline edit" className="space-y-3 rounded-xl border border-amber-300/25 bg-amber-300/5 p-4"><h3 className="text-sm font-semibold">Review timeline changes · {timelineProposal.beforeSeconds.toFixed(1)}s → {timelineProposal.afterSeconds.toFixed(1)}s</h3><ul className="text-sm text-zinc-300">{timelineProposal.changes.map((change, index) => <li key={index}>{change}</li>)}</ul>{timelineProposal.warnings.map((warning, index) => <p key={index} className="text-xs text-amber-200">{warning}</p>)}<div className="flex gap-2"><Button disabled={interactionLocked || planIsDirty || captionDraftDirty} onClick={() => void saveTimelineProposal()}>Save timeline changes</Button><Button variant="outline" disabled={interactionLocked} onClick={() => setTimelineProposal(null)}>Cancel timeline changes</Button></div></section> : null}
            <div
              className={`grid items-start gap-5 ${stage === "edit" ? "lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,1fr)]" : "lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]"}`}
            >
              <div className="min-w-0">
              <section
                aria-label="Video monitor"
                className="min-w-0 overflow-hidden rounded-xl border border-white/10 bg-[#08090a]"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-3">
                  <div
                    className="flex gap-1 rounded-lg bg-white/5 p-1"
                    aria-label="Video view"
                  >
                    <button
                      className={`rounded-md px-3 py-2 text-sm ${previewMode === "source" ? "bg-white/15 text-white" : "text-zinc-400"}`}
                      aria-pressed={previewMode === "source"}
                      onClick={() => setPreviewMode("source")}
                    >
                      Source
                    </button>
                    <button
                      className={`rounded-md px-3 py-2 text-sm disabled:opacity-35 ${previewMode === "edited" ? "bg-white/15 text-white" : "text-zinc-400"}`}
                      aria-pressed={previewMode === "edited"}
                      disabled={!previewUrl || planIsDirty || captionDraftDirty}
                      onClick={() => setPreviewMode("edited")}
                    >
                      Edited preview
                    </button>
                  </div>
                  <span className="text-xs text-zinc-400">
                    {plan.project.width} × {plan.project.height} ·{" "}
                    {totalDuration.toFixed(1)}s
                  </span>
                </div>
                <div
                  className="relative w-full bg-black"
                  style={{
                    aspectRatio: `${plan.project.width} / ${plan.project.height}`,
                  }}
                >
                  {previewMode === "edited" &&
                  previewUrl &&
                  !planIsDirty &&
                  !captionDraftDirty ? (
                    <video
                      key={previewUrl}
                      controls
                      className="size-full object-contain"
                      src={previewUrl}
                      aria-label="Edited preview video"
                    />
                  ) : videoUrl ? (
                    <video
                      ref={videoRef}
                      className="size-full object-contain"
                      src={videoUrl}
                      aria-label="Source video"
                      onLoadedMetadata={() =>
                        seekToSelectionTime(selectionProgressSeconds)
                      }
                      onTimeUpdate={handleSelectionTimeUpdate}
                      onPause={() => setIsPlaying(false)}
                      onPlay={() => setIsPlaying(true)}
                    />
                  ) : (
                    <div className="grid h-full place-content-center gap-3 p-6 text-center text-sm text-zinc-400">
                      <p>
                        {project && planIsDirty ? "Save changes to watch newly imported media." : "Attach the original video to watch the proposed cuts."}
                      </p>
                      <Button
                        disabled={Boolean(project && planIsDirty)}
                        variant="outline"
                        onClick={() => videoInputRef.current?.click()}
                      >
                        Attach source video
                      </Button>
                    </div>
                  )}
                  {previewMode === "source" && showLayout ? (
                    <>
                      <VisualDesignCanvas
                        plan={plan}
                        currentTimelineTime={currentTimelineTime}
                        activeCaption={activeCaption}
                        captionsEnabled={captionsEnabled}
                        selectedSegment={selectedSegment}
                        selectedOverlayClipId={selectedOverlayClipId}
                        selectedTitleCardId={selectedTitleCardId}
                        disabled={!canEditPlan}
                        onSelectOverlayClip={setSelectedOverlayClipId}
                        onSelectTitleCard={setSelectedTitleCardId}
                        onApply={reviseProductionPlan}
                      />
                    </>
                  ) : null}
                </div>
                {previewMode === "source" ? (
                  <>
                    <div className="flex min-h-16 flex-wrap items-center justify-center gap-3 border-t border-white/10 bg-[#0e0f11] px-4 py-3 sm:flex-nowrap">
                      <button
                        className="grid size-7 place-items-center rounded-full border border-white/10 text-zinc-300 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
                        disabled={!videoUrl}
                        onClick={() => seekBy(-5)}
                        aria-label="Seek backward 5 seconds"
                      >
                        <SkipBack className="size-3.5" />
                      </button>
                      <button
                        className="grid size-7 place-items-center rounded-full bg-zinc-100 text-zinc-950 disabled:cursor-not-allowed disabled:opacity-30"
                        disabled={!videoUrl}
                        onClick={() => void toggleSelectionPlayback()}
                        aria-label={
                          isPlaying ? "Pause selection" : "Play selection"
                        }
                      >
                        {isPlaying ? (
                          <Pause className="size-3.5 fill-current" />
                        ) : (
                          <Play className="ml-0.5 size-3.5 fill-current" />
                        )}
                      </button>
                      <button
                        className="grid size-7 place-items-center rounded-full border border-white/10 text-zinc-300 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
                        disabled={!videoUrl}
                        onClick={() => seekBy(5)}
                        aria-label="Seek forward 5 seconds"
                      >
                        <SkipForward className="size-3.5" />
                      </button>
                      <input
                        className="order-last h-1.5 min-w-16 basis-full cursor-pointer accent-amber-300 disabled:cursor-not-allowed disabled:opacity-30 sm:order-none sm:flex-1 sm:basis-auto md:max-w-md"
                        type="range"
                        min={0}
                        max={selectedSegment?.durationSeconds ?? 0}
                        step={0.1}
                        value={selectionProgressSeconds}
                        disabled={!videoUrl || !selectedSegment}
                        onChange={(event) =>
                          seekToSelectionTime(Number(event.target.value))
                        }
                        aria-label="Selection position"
                      />
                      <span className="min-w-28 text-right font-mono text-[11px] text-zinc-400">
                        {formatTimecode(currentTimelineTime)}
                        <span className="text-zinc-700"> / </span>
                        {formatTimecode(totalDuration)}
                      </span>
                    </div>
                  </>
                ) : null}
                <p className="border-t border-white/10 px-4 py-3 text-xs leading-relaxed text-zinc-400">
                  {previewMode === "edited"
                    ? "Rendered preview: check the cuts, watermark, titles, captions, and sound before approving the final video."
                    : "Original source footage. Render an edited preview to check your cuts, watermark, titles, and captions."}
                </p>
                {!project && segments.length > 1 && previewMode === "source" ? (
                  <div
                    className="flex flex-wrap gap-2 border-t border-white/10 p-3"
                    aria-label="Source cuts"
                  >
                    {segments.map((segment, index) => (
                      <button
                        key={segment.clip.id}
                        className={`rounded-md border px-3 py-2 text-xs ${selectedSegment?.clip.id === segment.clip.id ? "border-amber-300/50 text-amber-200" : "border-white/10 text-zinc-400"}`}
                        aria-pressed={
                          selectedSegment?.clip.id === segment.clip.id
                        }
                        onClick={() => selectSegment(segment)}
                      >
                        Cut {index + 1} · {segment.durationSeconds.toFixed(1)}s
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>
              {project && stage === "edit" ? <MainTimeline key={`${activeCandidate?.revision}-${segments.length}`} segments={segments} selectedId={selectedClipId} currentSourceTime={currentSourceTime} disabled={!canEditPlan || captionDraftDirty || Boolean(timelineProposal)} canPropose={canEditPlan && !planIsDirty && !captionDraftDirty && !timelineProposal} onSelect={selectSegment} onSplit={() => reviseProductionPlan((current) => splitProjectClip(current, selectedClipId, currentSourceTime))} onPropose={(operation) => void proposeTimelineEdit(operation)} /> : null}
              </div>

              {stage === "edit" ? (
                <div className="min-w-0 space-y-4">
                  {activeCandidate && reviewSession && sessionId ? (
                    <TranscriptEditor
                      key={`${activeCandidate.id}-${activeCandidate.revision}`}
                      subject={project ? "edit" : "clip"}
                      bridgeUrl={bridgeUrl}
                      sessionId={sessionId}
                      candidateId={activeCandidate.id}
                      revision={activeCandidate.revision}
                      approvalToken={reviewSession.approvalToken}
                      plan={activeCandidate.plan}
                      cues={captionCues}
                      selectedClipId={selectedClipId}
                      disabled={
                        !canEditPlan || Boolean(timelineProposal) ||
                        planIsDirty ||
                        captionDraftDirty ||
                        captionsLoading
                      }
                      disabledReason={
                        reviewState === "rendered"
                          ? "This final clip is read-only. You can still watch and seek through its transcript."
                          : captionsLoading
                            ? "Loading the transcript…"
                            : undefined
                      }
                      onSeek={seekToTranscriptTime}
                      onBusyChange={setEditorialBusy}
                      onSaved={(session) => {
                        setReviewSession(session)
                        const candidate = session.candidates.find(
                          (candidate) => candidate.id === activeCandidate.id,
                        )
                        if (candidate) applyReviewCandidate(session, candidate)
                      }}
                    />
                  ) : null}

                  {captionsLoading ? (
                    <p role="status" className="text-sm text-zinc-400">
                      Loading transcript…
                    </p>
                  ) : null}
                  {captionsError ? (
                    <p role="alert" className="text-sm text-red-300">
                      {captionsError}
                    </p>
                  ) : null}
                  <details
                    open={captionDraftDirty || undefined}
                    className="rounded-xl border border-white/10 bg-[#111214]"
                  >
                    <summary className="cursor-pointer p-4 text-sm font-medium">
                      Correct caption text & timing
                      {captionDraftDirty ? " · Unsaved" : ""}
                    </summary>
                    <CaptionQaPanel
                      captionsPath={captionsPath}
                      cues={captionDraftCues}
                      sourceCues={captionCues}
                      loading={captionsLoading}
                      error={captionsError}
                      disabled={
                        !canEditPlan || planIsDirty || interactionLocked
                      }
                      dirty={captionDraftDirty}
                      saving={captionRevisionLoading}
                      saveError={captionRevisionError}
                      saveResult={captionRevisionResult}
                      planIsDirty={planIsDirty}
                      onChangeCue={(index, patch) => {
                        setCaptionRevisionResult(null)
                        setCaptionRevisionError(null)
                        setCaptionDraftCues((cues) =>
                          cues.map((cue, cueIndex) =>
                            cueIndex === index ? { ...cue, ...patch } : cue,
                          ),
                        )
                      }}
                      onReset={() => {
                        setCaptionRevisionError(null)
                        setCaptionRevisionResult(null)
                        setCaptionDraftCues(captionCues)
                      }}
                      onSave={() => void saveCaptionRevision()}
                    />
                  </details>
                </div>
              ) : !reviewSession ? (
                <section aria-label="Imported plan review" className="space-y-4 rounded-xl border border-white/10 bg-[#111214] p-5">
                  <h3 className="text-lg font-semibold">{reviewState === "rendered" ? "Your video is ready" : "Review imported plan"}</h3>
                  <p className="text-sm leading-relaxed text-zinc-400">Imported plans keep the original direct-render workflow. Check the source and the plan in Advanced, then approve the local render.</p>
                  <Button className="min-h-11 w-full" disabled={!hasImportedPlan || interactionLocked || reviewState === "rendered"} onClick={() => void approveAndRender()}>{reviewState === "rendering" ? "Rendering…" : reviewState === "rendered" ? "Render complete" : "Approve & render imported plan"}</Button>
                  {approvalResult ? <p className="break-all text-xs text-emerald-200">{approvalResult.outputPath}</p> : null}
                </section>
              ) : (
                <section
                  aria-label="Review actions"
                  className="space-y-4 rounded-xl border border-white/10 bg-[#111214] p-5"
                >
                  <h3 className="text-lg font-semibold">
                    {reviewState === "rendered"
                      ? "Your final video is ready"
                      : planIsDirty || captionDraftDirty
                        ? "Save your changes first"
                        : !hasCurrentPreview
                          ? "Create an edited preview"
                          : "Ready for your final check"}
                  </h3>
                  <p className="text-sm leading-relaxed text-zinc-400">
                    {reviewState === "rendered"
                      ? "Create a local export package with the rendered videos, captions, and handoff notes."
                      : !hasCurrentPreview
                        ? "Render a quick local preview to see the actual cuts, watermark, titles, and captions together."
                        : "Watch Edited preview in the player. If everything looks right, approve the full-quality render."}
                  </p>
                  {reviewState === "rendered" ? (
                    <div className="rounded-lg bg-emerald-300/10 p-3 text-sm text-emerald-200">
                      <Check className="mr-2 inline size-4" />
                      Final render complete
                      {sessionId && activeCandidate ? <div className="mt-3 flex flex-wrap gap-3 text-xs"><a className="underline" href={`${bridgeUrl}/v1/review-sessions/${sessionId}/candidates/${activeCandidate.id}/output`} target="_blank" rel="noreferrer">Watch final video</a><a className="underline" href={`${bridgeUrl}/v1/review-sessions/${sessionId}/candidates/${activeCandidate.id}/output?download=1`}>Download MP4</a></div> : null}
                      {project ? <Button variant="outline" className="mt-3" disabled={interactionLocked} onClick={() => void duplicateMainProject()}>Make an editable copy</Button> : null}
                      <p className="mt-2 break-all text-xs text-zinc-400">
                        {approvalResult?.outputPath ?? plan.output.path}
                      </p>
                    </div>
                  ) : (
                    <>
                      <Button
                        className="min-h-11 w-full bg-amber-300 text-zinc-950 hover:bg-amber-200"
                        disabled={
                          !reviewSession?.selectedCandidateId ||
                          planIsDirty ||
                          captionDraftDirty ||
                          interactionLocked ||
                          preflightLoading ||
                          Boolean(preflightError) ||
                          activePreflightBlocks > 0
                        }
                        onClick={() =>
                          void (hasCurrentPreview
                            ? approveAndRender()
                            : renderPreview())
                        }
                      >
                        {interactionLocked ? (
                          <LoaderCircle className="animate-spin" />
                        ) : hasCurrentPreview ? (
                          <Check />
                        ) : (
                          <Eye />
                        )}
                        {reviewState === "previewing"
                          ? "Rendering preview…"
                          : reviewState === "rendering"
                            ? "Rendering final…"
                            : hasCurrentPreview
                              ? "Approve & render final"
                              : "Render edited preview"}
                      </Button>
                      {hasCurrentPreview ? (
                        <Button
                          variant="ghost"
                          className="w-full"
                          disabled={
                            interactionLocked ||
                            planIsDirty ||
                            captionDraftDirty
                          }
                          onClick={() => {
                            setPreviewMode("edited")
                          }}
                        >
                          Watch edited preview
                        </Button>
                      ) : null}
                      <p className="text-xs text-zinc-500">
                        {hasCurrentPreview
                          ? "Final rendering starts only when you approve above."
                          : "Preview rendering does not approve the final export."}
                      </p>
                    </>
                  )}
                  <PreflightPanel
                    preflight={activePreflight}
                    loading={preflightLoading}
                    error={preflightError}
                    dirty={planIsDirty || captionDraftDirty}
                  />
                  {preflightError ? <Button variant="outline" disabled={interactionLocked || planIsDirty || captionDraftDirty} onClick={() => setPreflightAttempt((attempt) => attempt + 1)}>Retry checks</Button> : null}
                  {renderedCandidateIds.length > 0 ? (
                    <div className="space-y-3 border-t border-white/10 pt-4">
                      <p className="text-sm text-zinc-300">
                        {renderedCandidateIds.length} final video
                        {renderedCandidateIds.length === 1 ? "" : "s"} ready
                      </p>
                      <Button
                        className="w-full"
                        disabled={exportPackaging || interactionLocked}
                        onClick={() => void createExportPackage()}
                      >
                        <Download />
                        {exportPackaging
                          ? "Creating package…"
                          : "Create export package"}
                      </Button>
                      {latestExportPackage ? (
                        <div className="rounded-lg border border-emerald-300/20 p-3">
                          <p className="text-sm text-emerald-200">
                            Export package{" "}
                            {latestExportPackage.status === "partial"
                              ? "created with warnings"
                              : "ready"}
                          </p>
                          <p className="mt-2 text-xs text-zinc-400">
                            {latestExportPackage.packagePath.startsWith("/") ? "Open this folder in Finder:" : "Saved folder, inside your local media folder:"}
                          </p>
                          <p className="mt-1 break-all select-all text-xs text-zinc-300">
                            {latestExportPackage.packagePath}
                          </p>
                          {latestExportPackage.warnings.map((warning, i) => (
                            <p key={i} className="mt-2 text-xs text-amber-200">
                              {warning}
                            </p>
                          ))}
                        </div>
                      ) : null}
                      {exportError ? (
                        <p role="alert" className="text-sm text-red-300">
                          {exportError}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              )}
            </div>
            {stage === "review" && reviewSession && !project ? (
              <details className="rounded-xl border border-white/10 bg-[#111214]">
                <summary className="cursor-pointer p-4 text-sm font-medium">
                  Render several clips together
                </summary>
                <div className="space-y-4 px-4 pb-4">
                  <p className="text-sm text-zinc-400">
                    Select clips whose current edited previews you have
                    reviewed, then approve their final renders together.
                  </p>
                  {reviewSession.candidates.map((candidate) => (
                    <label
                      key={candidate.id}
                      className="flex items-center gap-3 text-sm text-zinc-300"
                    >
                      <input
                        type="checkbox"
                        checked={batchCandidateIds.includes(candidate.id)}
                        disabled={
                          !canBatchRenderCandidate(candidate) ||
                          interactionLocked || planIsDirty || captionDraftDirty
                        }
                        onChange={() => toggleBatchCandidate(candidate.id)}
                      />
                      <span>
                        {candidate.title}
                        <span className="ml-2 text-xs text-zinc-500">
                          {candidate.outputExists
                            ? "Final ready"
                            : candidateHasCurrentPreview(candidate)
                              ? "Preview ready"
                              : "Preview needed"}
                        </span>
                      </span>
                    </label>
                  ))}
                  <Button
                    disabled={!batchCandidateIds.length || interactionLocked || planIsDirty || captionDraftDirty}
                    onClick={() => void approveBatch()}
                  >
                    {batchRendering || latestBatchActive
                      ? "Rendering…"
                      : `Approve & render ${batchCandidateIds.length} clips`}
                  </Button>
                  {latestBatch ? (
                    <p className="text-sm text-zinc-400">
                      Latest batch: {latestBatch.status} ·{" "}
                      {
                        latestBatch.items.filter(
                          (item) => item.status === "rendered",
                        ).length
                      }
                      /{latestBatch.items.length} complete
                    </p>
                  ) : null}
                  {latestBatch &&
                  (latestBatch.status === "failed" ||
                    latestBatch.status === "partial") ? (
                    <Button
                      variant="outline"
                      disabled={interactionLocked}
                      onClick={selectFailedBatchCandidates}
                    >
                      Select failed clips to retry
                    </Button>
                  ) : null}
                  {batchError ? (
                    <p role="alert" className="text-sm text-red-300">
                      {batchError}
                    </p>
                  ) : null}
                </div>
              </details>
            ) : null}
            <details className="rounded-xl border border-white/10 bg-[#111214]">
              <summary className="cursor-pointer p-4 text-sm font-medium">
                Advanced{" "}
                <span className="ml-2 font-normal text-zinc-500">
                  Layers, audio, providers & history
                </span>
              </summary>
              <div className="grid min-w-0 gap-4 p-4 lg:grid-cols-2">
                <div className="min-w-0 space-y-4">
                  <p className="text-sm font-medium">Production controls</p>
                  <label className="flex items-center gap-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={showLayout}
                      onChange={(event) => {
                        setShowLayout(event.target.checked)
                        setPreviewMode("source")
                      }}
                    />
                    Show layout guides on source video
                  </label>
                  <p className="text-xs text-zinc-500">
                    Guides let you move design elements. Check the rendered
                    preview for the final appearance.
                  </p>
                  {selectedSegment ? (
                    <div className="divide-y divide-white/8">
                      <InspectorSection title="Selection">
                        <InspectorValue
                          label="Clip"
                          value={humanizeId(selectedSegment.clip.id)}
                        />
                        <InspectorValue
                          label="Asset"
                          value={
                            selectedAsset?.id ?? selectedSegment.clip.assetId
                          }
                        />
                        {activeCandidate ? (
                          <div className="rounded-lg border border-violet-300/15 bg-violet-400/[0.06] p-3">
                            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-violet-200">
                              Why this clip
                            </p>
                            <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
                              {activeClipRationale?.note ||
                                activeCandidate.rationale ||
                                "No clip-level rationale recorded. Ask the producer agent to create distinct candidate rationales on the next run."}
                            </p>
                          </div>
                        ) : null}
                        {reviewSession ? (
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={
                                plan.timeline.clips[0]?.id ===
                                  selectedSegment.clip.id ||
                                !canEditPlan ||
                                captionDraftDirty
                              }
                              onClick={() =>
                                setPlan(
                                  movePlanClip(
                                    plan,
                                    selectedSegment.clip.id,
                                    -1,
                                  ),
                                )
                              }
                            >
                              <ArrowUp /> Earlier
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={
                                plan.timeline.clips.at(-1)?.id ===
                                  selectedSegment.clip.id ||
                                !canEditPlan ||
                                captionDraftDirty
                              }
                              onClick={() =>
                                setPlan(
                                  movePlanClip(
                                    plan,
                                    selectedSegment.clip.id,
                                    1,
                                  ),
                                )
                              }
                            >
                              <ArrowDown /> Later
                            </Button>
                          </div>
                        ) : null}
                      </InspectorSection>
                      <InspectorSection title="Source range">
                        <div className="grid grid-cols-2 gap-2">
                          <NumberEditor
                            label="In (seconds)"
                            value={selectedSegment.clip.sourceStart}
                            min={0}
                            max={selectedSegment.clip.sourceEnd - 0.01}
                            step={0.1}
                            disabled={!canEditPlan}
                            onChange={(value) =>
                              reviseSelectedClip({ sourceStart: value })
                            }
                          />
                          <NumberEditor
                            label="Out (seconds)"
                            value={selectedSegment.clip.sourceEnd}
                            min={selectedSegment.clip.sourceStart + 0.01}
                            step={0.1}
                            disabled={!canEditPlan}
                            onChange={(value) =>
                              reviseSelectedClip({ sourceEnd: value })
                            }
                          />
                        </div>
                        <InspectorValue
                          label="Source length"
                          value={`${(selectedSegment.clip.sourceEnd - selectedSegment.clip.sourceStart).toFixed(1)}s`}
                        />
                      </InspectorSection>
                      <InspectorSection title="Playback">
                        <NumberEditor
                          label="Speed"
                          value={selectedSegment.clip.speed}
                          min={0.25}
                          max={4}
                          step={0.05}
                          suffix="×"
                          disabled={!canEditPlan}
                          onChange={(value) =>
                            reviseSelectedClip({ speed: value })
                          }
                        />
                        <NumberEditor
                          label="Volume"
                          value={selectedSegment.clip.volume}
                          min={0}
                          max={2}
                          step={0.05}
                          suffix="×"
                          disabled={!canEditPlan}
                          onChange={(value) =>
                            reviseSelectedClip({ volume: value })
                          }
                        />
                        <InspectorValue
                          icon={<Clock3 />}
                          label="Timeline length"
                          value={`${selectedSegment.durationSeconds.toFixed(1)}s`}
                        />
                        {reviewSession ? (
                          <button
                            className={`flex w-full items-center justify-between rounded-md border px-2.5 py-2 text-[10px] transition ${plan.timeline.captionsAssetId ? "border-violet-300/30 bg-violet-400/10 text-violet-200" : "border-white/10 text-zinc-500"}`}
                            onClick={() =>
                              setPlan(
                                setPlanCaptionsEnabled(
                                  plan,
                                  !plan.timeline.captionsAssetId,
                                ),
                              )
                            }
                            disabled={
                              !plan.assets.some(
                                (asset) => asset.kind === "captions",
                              ) ||
                              !canEditPlan ||
                              captionDraftDirty
                            }
                            aria-pressed={Boolean(
                              plan.timeline.captionsAssetId,
                            )}
                          >
                            <span className="flex items-center gap-1.5">
                              <Captions className="size-3" /> Include captions
                            </span>
                            <span>
                              {plan.timeline.captionsAssetId ? "On" : "Off"}
                            </span>
                          </button>
                        ) : null}
                      </InspectorSection>
                      <ProductionInspector
                        plan={plan}
                        disabled={!canEditPlan || captionDraftDirty}
                        planIsDirty={planIsDirty}
                        captionGenerationLoading={captionGenerationLoading}
                        captionGenerationError={captionGenerationError}
                        captionGenerationResult={captionGenerationResult}
                        systemCheck={systemCheck}
                        systemCheckLoading={systemCheckLoading}
                        systemCheckError={systemCheckError}
                        selectedOverlayClipId={selectedOverlayClipId}
                        selectedAudioTrackId={selectedAudioTrackId}
                        selectedAudioClipId={selectedAudioClipId}
                        selectedTransitionId={selectedTransitionId}
                        selectedTitleCardId={selectedTitleCardId}
                        onSelectOverlayClip={setSelectedOverlayClipId}
                        onSelectAudioTrack={(trackId) => {
                          setSelectedAudioTrackId(trackId)
                          const track =
                            plan.version === "2"
                              ? plan.timeline.audioTracks.find(
                                  (entry) => entry.id === trackId,
                                )
                              : undefined
                          setSelectedAudioClipId(track?.clips[0]?.id ?? "")
                        }}
                        onSelectAudioClip={setSelectedAudioClipId}
                        onSelectTransition={setSelectedTransitionId}
                        onSelectTitleCard={setSelectedTitleCardId}
                        onRunSystemCheck={() => void runSystemCheck()}
                        onGenerateCaptions={() => void generateCaptions()}
                        onApply={reviseProductionPlan}
                      />
                      <PreflightPanel
                        preflight={activePreflight}
                        loading={preflightLoading}
                        error={preflightError}
                        dirty={planIsDirty || captionDraftDirty}
                      />
                      {reviewSession && activeCandidate ? (
                        <InspectorSection title="Reviewer notes & audit">
                          <textarea
                            className="min-h-16 w-full resize-y rounded-md border border-white/10 bg-black/30 p-2 text-[10px] text-zinc-200 outline-none focus:border-amber-300/50"
                            value={reviewerNote}
                            onChange={(event) =>
                              setReviewerNote(event.target.value)
                            }
                            placeholder="Add a decision note for this revision"
                            maxLength={2_000}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            disabled={!reviewerNote.trim()}
                            onClick={() => void addReviewerNote()}
                          >
                            <MessageSquareText /> Save note
                          </Button>
                          <p className="text-[9px] leading-relaxed text-zinc-600">
                            {
                              reviewSession.reviewerNotes.filter(
                                (note) =>
                                  note.candidateId === activeCandidate.id,
                              ).length
                            }{" "}
                            notes ·{" "}
                            {
                              reviewSession.events.filter(
                                (event) =>
                                  event.candidateId === activeCandidate.id,
                              ).length
                            }{" "}
                            audit events
                          </p>
                          {reviewSession.events
                            .filter(
                              (event) =>
                                event.candidateId === activeCandidate.id,
                            )
                            .slice(-3)
                            .reverse()
                            .map((event) => (
                              <div
                                key={event.id}
                                className="border-l border-white/10 pl-2 text-[9px] text-zinc-500"
                              >
                                <p className="font-medium text-zinc-400">
                                  {event.type.replaceAll("-", " ")} · r
                                  {event.revision ?? activeCandidate.revision}
                                </p>
                                <p>{new Date(event.at).toLocaleString()}</p>
                              </div>
                            ))}
                        </InspectorSection>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="min-w-0 space-y-4">
                  <h3 className="text-sm font-medium">Project files</h3>
                  <div className="space-y-2 p-3">
                    {plan.assets.map((asset) => (
                      <div
                        key={asset.id}
                        className="group rounded-lg border border-white/8 bg-white/[0.025] p-2.5 hover:border-white/15 hover:bg-white/[0.04]"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="grid size-9 shrink-0 place-items-center rounded-md bg-gradient-to-br from-zinc-700 to-zinc-900 text-zinc-300">
                            {asset.kind === "video" ? (
                              <Film className="size-4" />
                            ) : asset.kind === "audio" ? (
                              <Music2 className="size-4" />
                            ) : (
                              <Captions className="size-4" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium">
                              {asset.id}
                            </p>
                            <p className="mt-0.5 truncate text-[10px] uppercase tracking-wider text-zinc-600">
                              {asset.kind}
                            </p>
                          </div>
                        </div>
                        <p
                          className="mt-2 truncate text-[10px] text-zinc-600"
                          title={asset.path}
                        >
                          {asset.path}
                        </p>
                      </div>
                    ))}

                    {!reviewSession ? (
                      <button
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 py-3 text-[11px] text-zinc-500 transition hover:border-amber-300/40 hover:text-amber-200"
                        onClick={() => videoInputRef.current?.click()}
                      >
                        <FolderOpen className="size-3.5" />
                        {videoName
                          ? "Replace source video"
                          : "Attach source video"}
                      </button>
                    ) : null}
                  </div>

                  {activeCandidate ? (
                    <div className="space-y-2 rounded-lg border border-white/10 p-3">
                      <p className="text-sm text-zinc-400">
                        Saved version {activeCandidate.revision}
                      </p>
                      <label
                        htmlFor="revision-note"
                        className="text-xs text-zinc-400"
                      >
                        Change note (optional)
                      </label>
                      <input
                        id="revision-note"
                        className="w-full rounded border border-white/15 p-2 text-sm"
                        value={revisionNote}
                        onChange={(event) =>
                          setRevisionNote(event.target.value)
                        }
                        maxLength={1000}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
              {!project ? (<>              <section
                className={`${plan.version === "2" ? "h-60" : "h-44"} bg-[#111214]`}
              >
                <div className="flex h-10 items-center justify-between border-b border-white/10 px-3">
                  <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                    <span className="font-medium uppercase tracking-[0.16em] text-zinc-300">
                      Timeline
                    </span>
                    <span>{segments.length} clips</span>
                    {plan.version === "2" ? (
                      <span>
                        {trackCounts.overlayTracks} overlay ·{" "}
                        {trackCounts.audioTracks} audio ·{" "}
                        {trackCounts.transitions} transitions
                      </span>
                    ) : null}
                    <span>{formatTimecode(totalDuration)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!reviewSession ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setPlan(sampleEditPlan)
                          setSelectedClipId(
                            sampleEditPlan.timeline.clips[0]?.id ?? "",
                          )
                          resetProductionSelections(sampleEditPlan)
                          setCurrentSourceTime(
                            sampleEditPlan.timeline.clips[0]?.sourceStart ?? 0,
                          )
                          setReviewState("review")
                          setApprovalResult(null)
                          setApprovalError(null)
                          setPlanError(null)
                        }}
                      >
                        <RotateCcw /> Reset sample
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={downloadPlan}>
                      <Download /> Download plan
                    </Button>
                  </div>
                </div>

                <div className="grid h-[calc(100%-2.5rem)] grid-cols-[84px_minmax(0,1fr)] overflow-hidden">
                  <div className="border-r border-white/10 pt-7 text-[10px] text-zinc-600">
                    <div className="flex h-11 items-center gap-2 border-y border-white/5 px-3">
                      <Film className="size-3" /> Video 1
                    </div>
                    {plan.version === "2" ? (
                      <div className="flex h-7 items-center gap-2 border-b border-white/5 px-3">
                        <Layers3 className="size-3" /> Layers
                      </div>
                    ) : null}
                    {plan.version === "2" ? (
                      <div className="flex h-7 items-center gap-2 border-b border-white/5 px-3">
                        <Sparkles className="size-3" /> Finish
                      </div>
                    ) : null}
                    <div className="flex h-7 items-center gap-2 border-b border-white/5 px-3">
                      <Captions className="size-3" /> Captions
                    </div>
                  </div>

                  <div className="min-w-0 overflow-x-auto">
                    <div className="relative min-w-[720px] px-2 pt-7">
                      <TimelineRuler duration={totalDuration} />
                      <div className="relative flex h-11 overflow-hidden rounded-md border border-white/10 bg-black/40">
                        {segments.map((segment, index) => (
                          <button
                            key={segment.clip.id}
                            className={`relative min-w-28 overflow-hidden border-r border-black/35 px-3 text-left transition ${
                              segment.clip.id === selectedSegment?.clip.id
                                ? "bg-amber-300 text-zinc-950 shadow-[inset_0_0_0_2px_rgba(255,255,255,0.55)]"
                                : index % 2 === 0
                                  ? "bg-amber-300/55 text-amber-50 hover:bg-amber-300/70"
                                  : "bg-orange-300/45 text-orange-50 hover:bg-orange-300/60"
                            }`}
                            style={{
                              width: `${(segment.durationSeconds / totalDuration) * 100}%`,
                            }}
                            onClick={() => selectSegment(segment)}
                          >
                            <span className="block truncate text-[10px] font-semibold">
                              {humanizeId(segment.clip.id)}
                            </span>
                            <span
                              className={`mt-0.5 block font-mono text-[9px] ${segment.clip.id === selectedSegment?.clip.id ? "text-zinc-700" : "text-white/55"}`}
                            >
                              {segment.durationSeconds.toFixed(1)}s ·{" "}
                              {segment.clip.speed.toFixed(2)}×
                            </span>
                          </button>
                        ))}
                      </div>
                      {plan.version === "2" ? (
                        <div className="mt-1 flex h-7 items-center rounded border border-sky-300/15 bg-sky-400/10 px-3 text-[9px] text-sky-200/80">
                          <Layers3 className="mr-2 size-3" />
                          <span>
                            {trackCounts.overlayClips} overlay clips across{" "}
                            {trackCounts.overlayTracks} tracks
                          </span>
                          <span className="ml-auto">
                            <Music2 className="mr-1 inline size-3" />
                            {trackCounts.audioClips} mixed-audio clips
                          </span>
                        </div>
                      ) : null}
                      {plan.version === "2" ? (
                        <div className="mt-1 flex h-7 items-center rounded border border-amber-300/15 bg-amber-300/10 px-3 text-[9px] text-amber-100/80">
                          <Sparkles className="mr-2 size-3" />
                          <span>
                            {trackCounts.transitions} transitions ·{" "}
                            {trackCounts.titleCards} title cards
                          </span>
                          <span className="ml-auto">
                            {trackCounts.burnedCaptions
                              ? "Styled burn-in captions"
                              : "Selectable captions"}
                            {trackCounts.ducking ? " · Smart ducking" : ""}
                          </span>
                        </div>
                      ) : null}
                      <button
                        className={`mt-1 flex h-7 w-full items-center rounded border px-3 text-left text-[9px] transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          captionsEnabled
                            ? "border-violet-200/50 bg-violet-400/35 text-violet-100"
                            : "border-violet-300/15 bg-violet-400/15 text-violet-200/75 hover:bg-violet-400/25"
                        }`}
                        disabled={
                          !captionsAsset ||
                          captionsLoading ||
                          Boolean(captionsError) ||
                          captionCues.length === 0
                        }
                        onClick={() =>
                          setCaptionsEnabled((enabled) => !enabled)
                        }
                        aria-label={
                          captionsEnabled
                            ? "Hide caption preview"
                            : "Show caption preview"
                        }
                        aria-pressed={captionsEnabled}
                      >
                        <Captions className="mr-2 size-3" />
                        <span className="truncate">
                          {captionsAsset
                            ? captionsAsset.path.split("/").at(-1)
                            : "No captions attached"}
                        </span>
                        <span className="ml-auto pl-3 font-semibold uppercase tracking-wider">
                          {captionsLoading
                            ? "Loading"
                            : captionsError
                              ? "Unavailable"
                              : captionsEnabled
                                ? "Preview on"
                                : `${captionCues.length} cues · Preview off`}
                        </span>
                      </button>
                      <div className="pointer-events-none absolute bottom-0 left-2 top-5 w-px bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]" />
                    </div>
                  </div>
                </div>
              </section></>) : null}
            </details>
          </>
        )}
      </div>
    </main>
  )
}

function InspectorSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="space-y-2.5 p-4">
      <h2 className="font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">{title}</h2>
      {children}
    </section>
  )
}

function InspectorValue({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <span className="flex items-center gap-1.5 text-zinc-500 [&_svg]:size-3">{icon}{label}</span>
      <span className="max-w-36 truncate font-medium text-zinc-300" title={value}>{value}</span>
    </div>
  )
}

function ReadinessRow({ label, status, detail }: { label: string; status: ReadinessStatus; detail: string }) {
  const tone = status === "ready"
    ? "border-emerald-300/15 bg-emerald-300/[0.06] text-emerald-200"
    : status === "missing"
      ? "border-red-300/20 bg-red-400/10 text-red-200"
      : "border-white/10 bg-white/[0.035] text-zinc-300"
  return (
    <div className={`rounded-md border p-2 ${tone}`}>
      <p className="flex items-center justify-between gap-2 text-[9px] font-semibold uppercase tracking-[0.14em]">
        <span>{label}</span>
        <span>{status}</span>
      </p>
      <p className="mt-1 text-[9px] leading-relaxed text-zinc-500">{detail}</p>
    </div>
  )
}

type CanvasBox = { x: number; y: number; width: number; height: number }

function VisualDesignCanvas({
  plan,
  currentTimelineTime,
  activeCaption,
  captionsEnabled,
  selectedSegment,
  selectedOverlayClipId,
  selectedTitleCardId,
  disabled,
  onSelectOverlayClip,
  onSelectTitleCard,
  onApply,
}: {
  plan: EditPlan
  currentTimelineTime: number
  activeCaption: CaptionCue | undefined
  captionsEnabled: boolean
  selectedSegment: TimelineSegment | undefined
  selectedOverlayClipId: string
  selectedTitleCardId: string
  disabled: boolean
  onSelectOverlayClip: (value: string) => void
  onSelectTitleCard: (value: string) => void
  onApply: (edit: (current: EditPlan) => EditPlan) => void
}) {
  const canvas = { x: 0, y: 0, width: plan.project.width, height: plan.project.height }
  const overlayEntries = plan.version === "2"
    ? plan.timeline.overlayTracks.flatMap((track) => track.clips.map((clip) => ({ track, clip })))
    : []
  const activeOverlayEntries = overlayEntries.filter(({ clip }) =>
    isTimelineVisible(currentTimelineTime, clip.timelineStart, (clip.sourceEnd - clip.sourceStart) / clip.speed),
  )
  const selectedOverlayEntry = overlayEntries.find(({ clip }) => clip.id === selectedOverlayClipId)
  const displayOverlayEntries = uniqueById([
    ...activeOverlayEntries,
    ...(selectedOverlayEntry ? [selectedOverlayEntry] : []),
  ], (entry) => entry.clip.id)
  const titleCards = plan.version === "2" ? plan.timeline.titleCards : []
  const activeTitleCards = titleCards.filter((card) =>
    isTimelineVisible(currentTimelineTime, card.timelineStart, card.duration),
  )
  const selectedTitleCard = titleCards.find((card) => card.id === selectedTitleCardId)
  const displayTitleCards = uniqueById([
    ...activeTitleCards,
    ...(selectedTitleCard ? [selectedTitleCard] : []),
  ], (card) => card.id)
  const captionStyle = plan.version === "2" ? plan.timeline.captionStyle : undefined
  const showCaption = Boolean(activeCaption && captionsEnabled)
  const canEditCaption = plan.version === "2" && Boolean(plan.timeline.captionsAssetId) && !disabled

  return (
    <div className="absolute inset-0">
      {plan.version === "2" ? (
        <div className="pointer-events-none absolute left-3 top-3 z-30 rounded-full border border-white/10 bg-black/60 px-2.5 py-1 text-[9px] font-medium text-zinc-300 shadow-lg">
          WYSIWYG layer edit · drag boxes, resize corners
        </div>
      ) : null}

      {displayTitleCards.map((card) => {
        const box = getTitleCardCanvasBox(plan, card)
        const active = isTimelineVisible(currentTimelineTime, card.timelineStart, card.duration)
        return (
          <TitleCardCanvasControl
            key={card.id}
            card={card}
            box={box}
            canvas={canvas}
            selected={card.id === selectedTitleCardId}
            inactive={!active}
            disabled={disabled}
            onSelect={() => onSelectTitleCard(card.id)}
            onChange={(nextBox) => onApply((current) => updateTitleCardCanvasBox(current, card.id, nextBox))}
          />
        )
      })}

      {displayOverlayEntries.map(({ track, clip }) => {
        const active = isTimelineVisible(currentTimelineTime, clip.timelineStart, (clip.sourceEnd - clip.sourceStart) / clip.speed)
        return (
          <OverlayCanvasControl
            key={clip.id}
            clip={clip}
            trackId={track.id}
            canvas={canvas}
            selected={clip.id === selectedOverlayClipId}
            inactive={!active}
            disabled={disabled}
            onSelect={() => onSelectOverlayClip(clip.id)}
            onChange={(nextBox) => onApply((current) => updateOverlayClipCanvasBox(current, clip.id, nextBox))}
          />
        )
      })}

      {showCaption && activeCaption ? (
        <CaptionCanvasControl
          text={activeCaption.text}
          style={captionStyle}
          canvas={canvas}
          disabled={!canEditCaption}
          onChange={(patch) => onApply((current) => updateCaptionStyle(current, patch))}
        />
      ) : null}

      {selectedSegment ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 to-transparent px-4 pb-4 pt-12">
          <p className="text-xs font-medium">{humanizeId(selectedSegment.clip.id)}</p>
          <p className="mt-1 text-[10px] text-zinc-400">
            Source {formatTimecode(selectedSegment.clip.sourceStart)}–{formatTimecode(selectedSegment.clip.sourceEnd)}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function OverlayCanvasControl({
  clip,
  trackId,
  canvas,
  selected,
  inactive,
  disabled,
  onSelect,
  onChange,
}: {
  clip: OverlayClip
  trackId: string
  canvas: CanvasBox
  selected: boolean
  inactive: boolean
  disabled: boolean
  onSelect: () => void
  onChange: (box: Partial<CanvasBox & Pick<OverlayClip, "opacity">>) => void
}) {
  return (
    <CanvasBoxControl
      box={clip}
      canvas={canvas}
      selected={selected}
      inactive={inactive}
      disabled={disabled}
      label={`${clip.id} · ${trackId}`}
      tone="cyan"
      onSelect={onSelect}
      onChange={onChange}
    >
      <div className="flex h-full flex-col justify-between rounded-md bg-cyan-300/[0.09] p-2 text-cyan-50">
        <span className="truncate text-[10px] font-semibold">{humanizeId(clip.id)}</span>
        <span className="text-[9px] text-cyan-100/70">{Math.round(clip.width)}×{Math.round(clip.height)} · {Math.round(clip.opacity * 100)}%</span>
      </div>
    </CanvasBoxControl>
  )
}

function TitleCardCanvasControl({
  card,
  box,
  canvas,
  selected,
  inactive,
  disabled,
  onSelect,
  onChange,
}: {
  card: TitleCard
  box: CanvasBox & { opacity: number; fontScale: number }
  canvas: CanvasBox
  selected: boolean
  inactive: boolean
  disabled: boolean
  onSelect: () => void
  onChange: (box: Partial<CanvasBox>) => void
}) {
  return (
    <>
      {card.template !== "lower-third" ? (
        <div
          className="pointer-events-none absolute inset-0 z-10"
          style={{ backgroundColor: card.background, opacity: inactive ? Math.min(0.28, box.opacity * 0.35) : box.opacity * 0.78 }}
        />
      ) : null}
      <CanvasBoxControl
        box={box}
        canvas={canvas}
        selected={selected}
        inactive={inactive}
        disabled={disabled}
        label={`${card.id} · ${card.template}`}
        tone="amber"
        onSelect={onSelect}
        onChange={onChange}
      >
        <div
          className="flex h-full flex-col justify-center rounded-md px-3 py-2 shadow-lg"
          style={{ backgroundColor: card.background, color: card.textColor, opacity: inactive ? Math.min(0.7, box.opacity) : box.opacity }}
        >
          <span
            className="truncate font-bold leading-tight"
            style={{ fontSize: `clamp(10px, ${box.fontScale * 1.1}vw, 28px)` }}
          >
            {card.title}
          </span>
          {card.subtitle ? (
            <span className="mt-1 truncate text-[10px] opacity-75">{card.subtitle}</span>
          ) : null}
          <span className="mt-1 h-1 w-1/3 rounded-full" style={{ backgroundColor: card.accentColor }} />
        </div>
      </CanvasBoxControl>
    </>
  )
}

function CaptionCanvasControl({
  text,
  style,
  canvas,
  disabled,
  onChange,
}: {
  text: string
  style: CaptionStyle | undefined
  canvas: CanvasBox
  disabled: boolean
  onChange: (patch: Partial<CaptionStyle>) => void
}) {
  const captionStyle = style ?? {
    mode: "burn-in" as const,
    preset: "clean" as const,
    fontSize: 42,
    textColor: "#FFFFFF",
    outlineColor: "#000000",
    backgroundColor: "#000000",
    backgroundOpacity: 0.72,
    marginV: 56,
    alignment: "bottom" as const,
  }
  const fontSize = captionStyle.fontSize ?? 42
  const boxWidth = Math.round(canvas.width * 0.78)
  const boxHeight = Math.round(Math.min(canvas.height * 0.2, Math.max(72, fontSize * 2.5)))
  const boxX = Math.round((canvas.width - boxWidth) / 2)
  const boxY = captionStyle.alignment === "top"
    ? captionStyle.marginV
    : captionStyle.alignment === "middle"
      ? Math.round((canvas.height - boxHeight) / 2)
      : canvas.height - captionStyle.marginV - boxHeight
  const box = { x: boxX, y: boxY, width: boxWidth, height: boxHeight }

  return (
    <CanvasBoxControl
      box={box}
      canvas={canvas}
      selected={false}
      inactive={false}
      disabled={disabled}
      label="Caption position"
      tone="violet"
      resize={false}
      onSelect={() => undefined}
      onChange={(nextBox) => {
        const nextY = nextBox.y ?? box.y
        const midpoint = nextY + box.height / 2
        if (midpoint < canvas.height / 3) {
          onChange({ alignment: "top", marginV: Math.round(Math.max(12, nextY)) })
        } else if (midpoint > canvas.height * 2 / 3) {
          onChange({ alignment: "bottom", marginV: Math.round(Math.max(12, canvas.height - nextY - box.height)) })
        } else {
          onChange({ alignment: "middle" })
        }
      }}
    >
      <div
        className="flex h-full items-center justify-center rounded-lg px-4 py-2 text-center font-bold leading-tight shadow-lg"
        style={{
          color: captionStyle.textColor,
          backgroundColor: captionStyle.backgroundColor,
          opacity: captionStyle.preset === "minimal" ? 0.92 : Math.max(0.2, captionStyle.backgroundOpacity),
          textShadow: `0 0 2px ${captionStyle.outlineColor}, 0 1px 4px ${captionStyle.outlineColor}`,
          fontSize: `clamp(11px, ${(fontSize / canvas.height) * 80}vw, 24px)`,
        }}
      >
        {text}
      </div>
    </CanvasBoxControl>
  )
}

function CanvasBoxControl({
  box,
  canvas,
  selected,
  inactive,
  disabled,
  label,
  tone,
  resize = true,
  children,
  onSelect,
  onChange,
}: {
  box: CanvasBox
  canvas: CanvasBox
  selected: boolean
  inactive: boolean
  disabled: boolean
  label: string
  tone: "amber" | "cyan" | "violet"
  resize?: boolean
  children: React.ReactNode
  onSelect: () => void
  onChange: (box: Partial<CanvasBox>) => void
}) {
  const dragState = useRef<{
    mode: "move" | "resize"
    pointerId: number
    startX: number
    startY: number
    box: CanvasBox
  } | null>(null)
  const borderClass = tone === "amber"
    ? selected ? "border-amber-200" : "border-amber-300/55"
    : tone === "cyan"
      ? selected ? "border-cyan-100" : "border-cyan-300/55"
      : selected ? "border-violet-100" : "border-violet-300/55"
  const ringClass = selected ? "ring-2 ring-white/45" : ""

  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    onSelect()
    if (disabled) return
    event.preventDefault()
    const target = event.target as HTMLElement
    dragState.current = {
      mode: target.dataset.resizeHandle === "true" ? "resize" : "move",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      box,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current
    const parentRect = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!state || !parentRect) return
    const dx = ((event.clientX - state.startX) / parentRect.width) * canvas.width
    const dy = ((event.clientY - state.startY) / parentRect.height) * canvas.height
    if (state.mode === "resize") {
      onChange({ width: state.box.width + dx, height: state.box.height + dy })
    } else {
      onChange({ x: state.box.x + dx, y: state.box.y + dy })
    }
  }
  const pointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current
    if (!state) return
    dragState.current = null
    if (event.currentTarget.hasPointerCapture(state.pointerId)) {
      event.currentTarget.releasePointerCapture(state.pointerId)
    }
  }
  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const delta = event.shiftKey ? 10 : 1
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      onChange({ x: box.x - delta })
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      onChange({ x: box.x + delta })
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      onChange({ y: box.y - delta })
    } else if (event.key === "ArrowDown") {
      event.preventDefault()
      onChange({ y: box.y + delta })
    }
  }

  return (
    <div
      className={`pointer-events-auto absolute z-20 overflow-hidden rounded-md border border-dashed ${borderClass} ${ringClass} ${disabled ? "cursor-default" : "cursor-move"} ${inactive ? "opacity-60" : ""}`}
      style={{
        left: `${(box.x / canvas.width) * 100}%`,
        top: `${(box.y / canvas.height) * 100}%`,
        width: `${(box.width / canvas.width) * 100}%`,
        height: `${(box.height / canvas.height) * 100}%`,
      }}
      role="button"
      tabIndex={0}
      aria-label={label}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onKeyDown={keyDown}
    >
      {children}
      {inactive ? (
        <span className="absolute right-1 top-1 rounded bg-black/65 px-1.5 py-0.5 text-[8px] uppercase tracking-wide text-zinc-300">
          off playhead
        </span>
      ) : null}
      {resize && !disabled ? (
        <span
          data-resize-handle="true"
          className="absolute bottom-0 right-0 size-4 cursor-nwse-resize rounded-tl-md border-l border-t border-white/45 bg-white/25"
          aria-hidden="true"
        />
      ) : null}
    </div>
  )
}

function isTimelineVisible(currentTime: number, timelineStart: number, duration: number) {
  return currentTime >= timelineStart && currentTime <= timelineStart + duration
}

function uniqueById<T>(items: T[], getId: (item: T) => string) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const id = getId(item)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function CaptionQaPanel({
  captionsPath,
  cues,
  sourceCues,
  loading,
  error,
  disabled,
  dirty,
  saving,
  saveError,
  saveResult,
  planIsDirty,
  onChangeCue,
  onReset,
  onSave,
}: {
  captionsPath: string | null
  cues: CaptionCue[]
  sourceCues: CaptionCue[]
  loading: boolean
  error: string | null
  disabled: boolean
  dirty: boolean
  saving: boolean
  saveError: string | null
  saveResult: CaptionRevisionResult | null
  planIsDirty: boolean
  onChangeCue: (index: number, patch: Partial<CaptionCue>) => void
  onReset: () => void
  onSave: () => void
}) {
  const invalidCue = cues.find(
    (cue) =>
      !Number.isFinite(cue.start) ||
      !Number.isFinite(cue.end) ||
      cue.end <= cue.start ||
      !cue.text.trim(),
  )
  const canSave = Boolean(
    captionsPath && dirty && !disabled && !saving && !invalidCue,
  )

  return (
    <InspectorSection title="Caption corrections">
      {!captionsPath ? (
        <div className="rounded-lg border border-white/10 bg-black/25 p-3 text-xs leading-relaxed text-zinc-500">
          Generate or attach captions first, then use this panel to correct
          subtitle text and timing before preview/final render.
        </div>
      ) : loading ? (
        <div className="rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-zinc-500">
          Loading caption cues…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-xs leading-relaxed text-red-200">
          {error}
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="rounded-lg border border-violet-300/15 bg-violet-400/[0.06] p-3">
            <p className="text-xs font-semibold text-violet-100">
              {captionsPath.split("/").at(-1)}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              {sourceCues.length} cue{sourceCues.length === 1 ? "" : "s"}{" "}
              loaded. Saving creates a new candidate revision and clears stale
              previews.
            </p>
          </div>
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {cues.map((cue, index) => (
              <div
                key={`${cue.start}-${cue.end}-${index}`}
                className="rounded-lg border border-white/10 bg-black/25 p-2"
              >
                <div className="mb-2 flex items-center justify-between text-xs text-zinc-600">
                  <span>cue {index + 1}</span>
                  <span>
                    {formatTimecode(cue.start)} → {formatTimecode(cue.end)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumberEditor
                    label="Start"
                    value={cue.start}
                    min={0}
                    step={0.05}
                    disabled={disabled || saving}
                    onChange={(value) => onChangeCue(index, { start: value })}
                  />
                  <NumberEditor
                    label="End"
                    value={cue.end}
                    min={cue.start + 0.01}
                    step={0.05}
                    disabled={disabled || saving}
                    onChange={(value) => onChangeCue(index, { end: value })}
                  />
                </div>
                <textarea
                  aria-label={`Caption ${index + 1} text`}
                  className="mt-2 min-h-16 w-full resize-y rounded-md border border-white/10 bg-black/30 p-2 text-sm leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-700 disabled:text-zinc-500"
                  value={cue.text}
                  disabled={disabled || saving}
                  onChange={(event) =>
                    onChangeCue(index, { text: event.target.value })
                  }
                />
              </div>
            ))}
          </div>
          {planIsDirty ? (
            <p className="rounded border border-amber-300/20 bg-amber-300/10 p-2 text-xs leading-relaxed text-amber-100/80">
              Save timeline/style changes before saving caption QA edits.
            </p>
          ) : invalidCue ? (
            <p className="rounded border border-red-400/20 bg-red-400/10 p-2 text-xs leading-relaxed text-red-200">
              Each cue needs non-empty text and an end time after the start
              time.
            </p>
          ) : null}
          {saveError ? (
            <p className="rounded border border-red-400/20 bg-red-400/10 p-2 text-xs leading-relaxed text-red-200">
              {saveError}
            </p>
          ) : null}
          {saveResult ? (
            <p className="rounded border border-emerald-300/15 bg-emerald-300/[0.06] p-2 text-xs leading-relaxed text-emerald-100/85">
              Saved {saveResult.cues} cue{saveResult.cues === 1 ? "" : "s"} to{" "}
              {saveResult.captionsPath}. Render a fresh preview before final
              approval.
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button
              className="rounded-md border border-white/10 bg-black/25 px-3 py-2 text-xs font-medium text-zinc-400 transition hover:border-white/25 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!dirty || saving}
              onClick={onReset}
            >
              Discard changes
            </button>
            <button
              className="inline-flex items-center justify-center gap-2 rounded-md border border-violet-300/25 bg-violet-400/12 px-3 py-2 text-xs font-semibold text-violet-100 transition hover:border-violet-200/45 hover:bg-violet-400/20 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!canSave}
              onClick={onSave}
            >
              {saving ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : (
                <Save className="size-3" />
              )}
              {saving ? "Saving…" : "Save caption changes"}
            </button>
          </div>
        </div>
      )}
    </InspectorSection>
  )
}

function PreflightPanel({
  preflight,
  loading,
  error,
  dirty,
}: {
  preflight: ReviewSessionPreflight["candidates"][number] | undefined
  loading: boolean
  error: string | null
  dirty: boolean
}) {
  const checks = preflight?.checks ?? []
  const visibleChecks = checks
    .filter((check) => check.severity !== "pass")
    .slice(0, 4)
  const blocked = (preflight?.summary.block ?? 0) > 0
  const warned = (preflight?.summary.warn ?? 0) > 0
  return (
    <InspectorSection title="Readiness check">
      <div
        className={`rounded-lg border p-3 ${
          dirty
            ? "border-amber-300/20 bg-amber-300/[0.06]"
            : blocked || error
              ? "border-red-400/25 bg-red-400/8"
              : warned
                ? "border-amber-300/20 bg-amber-300/[0.06]"
                : "border-emerald-400/20 bg-emerald-400/8"
        }`}
      >
        <p
          className={`flex items-center gap-2 text-xs font-medium ${
            dirty
              ? "text-amber-200"
              : blocked || error
                ? "text-red-300"
                : warned
                  ? "text-amber-200"
                  : "text-emerald-300"
          }`}
        >
          {loading ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : dirty || blocked || error ? (
            <CircleAlert className="size-3.5" />
          ) : (
            <Check className="size-3.5" />
          )}
          {dirty
            ? "Save changes first"
            : loading
              ? "Checking"
              : error
                ? "Check failed"
                : blocked
                  ? `${preflight?.summary.block ?? 0} blocker${preflight?.summary.block === 1 ? "" : "s"}`
                  : warned
                    ? `${preflight?.summary.warn ?? 0} warning${preflight?.summary.warn === 1 ? "" : "s"}`
                    : "Ready"}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
          {dirty
            ? "Save your changes before rendering a new preview."
            : error
              ? error
              : preflight
                ? "Source files, captions, and output settings checked."
                : "Choose and save a clip to check it."}
        </p>
        {visibleChecks.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            {visibleChecks.map((check) => (
              <div
                key={check.id}
                className="rounded border border-white/8 bg-black/25 p-2"
              >
                <p
                  className={`text-xs font-semibold uppercase tracking-[0.14em] ${
                    check.severity === "block"
                      ? "text-red-300"
                      : "text-amber-200"
                  }`}
                >
                  {check.label}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                  {check.detail}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </InspectorSection>
  )
}

function ProductionInspector({
  plan,
  disabled,
  planIsDirty,
  captionGenerationLoading,
  captionGenerationError,
  captionGenerationResult,
  systemCheck,
  systemCheckLoading,
  systemCheckError,
  selectedOverlayClipId,
  selectedAudioTrackId,
  selectedAudioClipId,
  selectedTransitionId,
  selectedTitleCardId,
  onSelectOverlayClip,
  onSelectAudioTrack,
  onSelectAudioClip,
  onSelectTransition,
  onSelectTitleCard,
  onRunSystemCheck,
  onGenerateCaptions,
  onApply,
}: {
  plan: EditPlan
  disabled: boolean
  planIsDirty: boolean
  captionGenerationLoading: boolean
  captionGenerationError: string | null
  captionGenerationResult: CaptionGenerationResult | null
  systemCheck: ReviewSystemCheck | null
  systemCheckLoading: boolean
  systemCheckError: string | null
  selectedOverlayClipId: string
  selectedAudioTrackId: string
  selectedAudioClipId: string
  selectedTransitionId: string
  selectedTitleCardId: string
  onSelectOverlayClip: (value: string) => void
  onSelectAudioTrack: (value: string) => void
  onSelectAudioClip: (value: string) => void
  onSelectTransition: (value: string) => void
  onSelectTitleCard: (value: string) => void
  onRunSystemCheck: () => void
  onGenerateCaptions: () => void
  onApply: (edit: (current: EditPlan) => EditPlan) => void
}) {
  if (plan.version !== "2") return null

  const overlayEntries = plan.timeline.overlayTracks.flatMap((track) =>
    track.clips.map((clip) => ({ track, clip })),
  )
  const overlayEntry = overlayEntries.find((entry) => entry.clip.id === selectedOverlayClipId) ?? overlayEntries[0]
  const audioTrack = plan.timeline.audioTracks.find((track) => track.id === selectedAudioTrackId) ?? plan.timeline.audioTracks[0]
  const audioClip = audioTrack?.clips.find((clip) => clip.id === selectedAudioClipId) ?? audioTrack?.clips[0]
  const transition = plan.timeline.transitions.find((entry) => entry.id === selectedTransitionId) ?? plan.timeline.transitions[0]
  const titleCard = plan.timeline.titleCards.find((entry) => entry.id === selectedTitleCardId) ?? plan.timeline.titleCards[0]
  const titleCardBox = titleCard ? getTitleCardCanvasBox(plan, titleCard) : null
  const subtitleProvider = getSubtitleProvider(plan)
  const subtitleProviderOption = subtitleProviderOptions.find((option) => option.id === subtitleProvider?.mode) ?? subtitleProviderOptions[0]!
  const availableSubtitleProviderOptions = subtitleProviderOptions.filter((option) =>
    !option.requiresCaptionsAsset || Boolean(plan.timeline.captionsAssetId),
  )
  const captionGenerationActionLabel = subtitleProvider?.mode === "provided-captions"
    ? "Confirm caption asset"
    : "Generate captions"
  const captionGenerationDisabled = disabled || planIsDirty || captionGenerationLoading
  const providerReadiness = systemCheck?.subtitleProvider
  const captionStyle = plan.timeline.captionStyle ?? {
    mode: "burn-in" as const,
    preset: "clean" as const,
    fontSize: 42,
    textColor: "#FFFFFF",
    outlineColor: "#000000",
    backgroundColor: "#000000",
    backgroundOpacity: 0.72,
    marginV: 56,
    alignment: "bottom" as const,
  }
  const ducking = plan.timeline.audioMix?.ducking ?? {
    enabled: false,
    targetTrackIds: plan.timeline.audioTracks.filter((track) => track.role === "music").map((track) => track.id),
    threshold: 0.04,
    ratio: 8,
    attackMs: 20,
    releaseMs: 250,
  }

  return (
    <>
      <InspectorSection title="Production presets">
        <div className="space-y-2">
          {productionPresetOptions.map((preset) => (
            <button
              key={preset.id}
              className="w-full rounded-md border border-white/10 bg-black/30 p-2 text-left transition hover:border-amber-300/35 hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={disabled}
              onClick={() => onApply((current) => applyProductionPreset(current, preset.id as ProductionPresetId))}
            >
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-200">
                <WandSparkles className="size-3 text-amber-200" />
                {preset.label}
              </span>
              <span className="mt-1 block text-[9px] leading-relaxed text-zinc-600">{preset.description}</span>
            </button>
          ))}
        </div>
      </InspectorSection>

      {overlayEntry ? (
        <InspectorSection title="Overlay">
          <SelectEditor
            label="Clip"
            value={overlayEntry.clip.id}
            options={overlayEntries.map((entry) => ({ value: entry.clip.id, label: `${entry.clip.id} (${entry.track.id})` }))}
            disabled={disabled}
            onChange={onSelectOverlayClip}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberEditor label="Timeline" value={overlayEntry.clip.timelineStart} min={0} step={0.1} disabled={disabled} onChange={(value) => onApply((current) => updateOverlayClip(current, overlayEntry.clip.id, { timelineStart: value }))} />
            <NumberEditor label="Opacity" value={overlayEntry.clip.opacity} min={0} max={1} step={0.05} disabled={disabled} onChange={(value) => onApply((current) => updateOverlayClipCanvasBox(current, overlayEntry.clip.id, { opacity: value }))} />
            <NumberEditor label="In" value={overlayEntry.clip.sourceStart} min={0} max={overlayEntry.clip.sourceEnd - 0.01} step={0.1} disabled={disabled} onChange={(value) => onApply((current) => updateOverlayClip(current, overlayEntry.clip.id, { sourceStart: value }))} />
            <NumberEditor label="Out" value={overlayEntry.clip.sourceEnd} min={overlayEntry.clip.sourceStart + 0.01} step={0.1} disabled={disabled} onChange={(value) => onApply((current) => updateOverlayClip(current, overlayEntry.clip.id, { sourceEnd: value }))} />
            <NumberEditor label="X" value={overlayEntry.clip.x} min={0} max={plan.project.width - overlayEntry.clip.width} step={1} disabled={disabled} onChange={(value) => onApply((current) => updateOverlayClipCanvasBox(current, overlayEntry.clip.id, { x: Math.round(value) }))} />
            <NumberEditor label="Y" value={overlayEntry.clip.y} min={0} max={plan.project.height - overlayEntry.clip.height} step={1} disabled={disabled} onChange={(value) => onApply((current) => updateOverlayClipCanvasBox(current, overlayEntry.clip.id, { y: Math.round(value) }))} />
            <NumberEditor label="Width" value={overlayEntry.clip.width} min={24} max={plan.project.width} step={1} disabled={disabled} onChange={(value) => onApply((current) => updateOverlayClipCanvasBox(current, overlayEntry.clip.id, { width: Math.round(value) }))} />
            <NumberEditor label="Height" value={overlayEntry.clip.height} min={24} max={plan.project.height} step={1} disabled={disabled} onChange={(value) => onApply((current) => updateOverlayClipCanvasBox(current, overlayEntry.clip.id, { height: Math.round(value) }))} />
          </div>
          <SelectEditor
            label="Fit"
            value={overlayEntry.clip.fit}
            options={["contain", "cover", "stretch"].map((value) => ({ value, label: value }))}
            disabled={disabled}
            onChange={(value) => onApply((current) => updateOverlayClip(current, overlayEntry.clip.id, { fit: value as "contain" | "cover" | "stretch" }))}
          />
          <ToggleEditor
            label="Include overlay audio"
            checked={overlayEntry.clip.includeAudio}
            disabled={disabled}
            onChange={(checked) => onApply((current) => updateOverlayClip(current, overlayEntry.clip.id, { includeAudio: checked }))}
          />
        </InspectorSection>
      ) : null}

      {audioTrack && audioClip ? (
        <InspectorSection title="Audio mix">
          <SelectEditor
            label="Track"
            value={audioTrack.id}
            options={plan.timeline.audioTracks.map((track) => ({ value: track.id, label: `${track.id} (${track.role})` }))}
            disabled={disabled}
            onChange={onSelectAudioTrack}
          />
          <SelectEditor
            label="Role"
            value={audioTrack.role}
            options={["music", "effects", "voiceover"].map((value) => ({ value, label: value }))}
            disabled={disabled}
            onChange={(value) => onApply((current) => updateAudioTrack(current, audioTrack.id, { role: value as "music" | "effects" | "voiceover" }))}
          />
          <SelectEditor
            label="Clip"
            value={audioClip.id}
            options={audioTrack.clips.map((clip) => ({ value: clip.id, label: clip.id }))}
            disabled={disabled}
            onChange={onSelectAudioClip}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberEditor label="Timeline" value={audioClip.timelineStart} min={0} step={0.1} disabled={disabled} onChange={(value) => onApply((current) => updateAudioClip(current, audioClip.id, { timelineStart: value }))} />
            <NumberEditor label="Volume" value={audioClip.volume} min={0} max={2} step={0.05} suffix="x" disabled={disabled} onChange={(value) => onApply((current) => updateAudioClip(current, audioClip.id, { volume: value }))} />
            <NumberEditor label="In" value={audioClip.sourceStart} min={0} max={audioClip.sourceEnd - 0.01} step={0.1} disabled={disabled} onChange={(value) => onApply((current) => updateAudioClip(current, audioClip.id, { sourceStart: value }))} />
            <NumberEditor label="Out" value={audioClip.sourceEnd} min={audioClip.sourceStart + 0.01} step={0.1} disabled={disabled} onChange={(value) => onApply((current) => updateAudioClip(current, audioClip.id, { sourceEnd: value }))} />
          </div>
        </InspectorSection>
      ) : null}

      {transition ? (
        <InspectorSection title="Transition">
          <SelectEditor
            label="Boundary"
            value={transition.id}
            options={plan.timeline.transitions.map((entry) => ({ value: entry.id, label: `${entry.fromClipId} -> ${entry.toClipId}` }))}
            disabled={disabled}
            onChange={onSelectTransition}
          />
          <SelectEditor
            label="Type"
            value={transition.type}
            options={["fade", "wipeleft", "wiperight", "slideleft", "slideright"].map((value) => ({ value, label: value }))}
            disabled={disabled}
            onChange={(value) => onApply((current) => updateTransition(current, transition.id, { type: value as "fade" | "wipeleft" | "wiperight" | "slideleft" | "slideright" }))}
          />
          <NumberEditor label="Duration" value={transition.duration} min={0.1} max={3} step={0.1} suffix="s" disabled={disabled} onChange={(value) => onApply((current) => updateTransition(current, transition.id, { duration: value }))} />
        </InspectorSection>
      ) : null}

      {titleCard ? (
        <InspectorSection title="Title card">
          <SelectEditor
            label="Card"
            value={titleCard.id}
            options={plan.timeline.titleCards.map((entry) => ({ value: entry.id, label: entry.id }))}
            disabled={disabled}
            onChange={onSelectTitleCard}
          />
          <SelectEditor
            label="Template"
            value={titleCard.template}
            options={["intro", "outro", "lower-third"].map((value) => ({ value, label: value }))}
            disabled={disabled}
            onChange={(value) => onApply((current) => updateTitleCard(current, titleCard.id, { template: value as "intro" | "outro" | "lower-third" }))}
          />
          <TextEditor label="Title" value={titleCard.title} disabled={disabled} onChange={(value) => onApply((current) => updateTitleCard(current, titleCard.id, { title: value }))} />
          <TextEditor label="Subtitle" value={titleCard.subtitle ?? ""} disabled={disabled} onChange={(value) => onApply((current) => updateTitleCard(current, titleCard.id, { subtitle: value || undefined }))} />
          <div className="grid grid-cols-2 gap-2">
            <NumberEditor label="Timeline" value={titleCard.timelineStart} min={0} step={0.1} disabled={disabled} onChange={(value) => onApply((current) => updateTitleCard(current, titleCard.id, { timelineStart: value }))} />
            <NumberEditor label="Duration" value={titleCard.duration} min={0.5} max={30} step={0.1} disabled={disabled} onChange={(value) => onApply((current) => updateTitleCard(current, titleCard.id, { duration: value }))} />
          </div>
          {titleCardBox ? (
            <div className="grid grid-cols-3 gap-2">
              <NumberEditor label="X" value={titleCardBox.x} min={0} max={plan.project.width - titleCardBox.width} step={1} disabled={disabled} onChange={(value) => onApply((current) => updateTitleCardCanvasBox(current, titleCard.id, { x: Math.round(value) }))} />
              <NumberEditor label="Y" value={titleCardBox.y} min={0} max={plan.project.height - titleCardBox.height} step={1} disabled={disabled} onChange={(value) => onApply((current) => updateTitleCardCanvasBox(current, titleCard.id, { y: Math.round(value) }))} />
              <NumberEditor label="Width" value={titleCardBox.width} min={48} max={plan.project.width} step={1} disabled={disabled} onChange={(value) => onApply((current) => updateTitleCardCanvasBox(current, titleCard.id, { width: Math.round(value) }))} />
              <NumberEditor label="Height" value={titleCardBox.height} min={48} max={plan.project.height} step={1} disabled={disabled} onChange={(value) => onApply((current) => updateTitleCardCanvasBox(current, titleCard.id, { height: Math.round(value) }))} />
              <NumberEditor label="Opacity" value={titleCardBox.opacity} min={0} max={1} step={0.05} disabled={disabled} onChange={(value) => onApply((current) => updateTitleCardCanvasBox(current, titleCard.id, { opacity: value }))} />
              <NumberEditor label="Font scale" value={titleCardBox.fontScale} min={0.5} max={2} step={0.05} suffix="x" disabled={disabled} onChange={(value) => onApply((current) => updateTitleCardCanvasBox(current, titleCard.id, { fontScale: value }))} />
            </div>
          ) : null}
          <div className="grid grid-cols-3 gap-2">
            <ColorEditor label="Bg" value={titleCard.background} disabled={disabled} onChange={(value) => onApply((current) => updateTitleCard(current, titleCard.id, { background: value }))} />
            <ColorEditor label="Text" value={titleCard.textColor} disabled={disabled} onChange={(value) => onApply((current) => updateTitleCard(current, titleCard.id, { textColor: value }))} />
            <ColorEditor label="Accent" value={titleCard.accentColor} disabled={disabled} onChange={(value) => onApply((current) => updateTitleCard(current, titleCard.id, { accentColor: value }))} />
          </div>
        </InspectorSection>
      ) : null}

      {subtitleProvider ? (
        <InspectorSection title="Subtitle provider">
          <SelectEditor
            label="Provider"
            value={subtitleProvider.mode}
            options={availableSubtitleProviderOptions.map((option) => ({ value: option.id, label: option.label }))}
            disabled={disabled}
            onChange={(value) => onApply((current) => setSubtitleProviderMode(current, value as SubtitleProviderMode))}
          />
          <div className={`rounded-md border p-2 text-[9px] leading-relaxed ${
            subtitleProviderOption.privacy === "external-api"
              ? "border-amber-300/20 bg-amber-300/[0.06] text-amber-100/80"
              : "border-emerald-300/15 bg-emerald-300/[0.06] text-emerald-100/80"
          }`}>
            <p className="font-semibold text-zinc-200">{subtitleProviderOption.cost} · {subtitleProviderOption.privacy.replace("-", " ")}</p>
            <p className="mt-1 text-zinc-500">{subtitleProviderOption.description}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/25 p-2">
            <button
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-sky-300/25 bg-sky-400/10 px-3 py-2 text-[10px] font-semibold text-sky-100 transition hover:border-sky-200/45 hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={disabled || planIsDirty || systemCheckLoading}
              onClick={onRunSystemCheck}
            >
              {systemCheckLoading ? <LoaderCircle className="size-3 animate-spin" /> : <Gauge className="size-3" />}
              {systemCheckLoading ? "Checking setup…" : "Check setup"}
            </button>
            {planIsDirty ? (
              <p className="mt-2 text-[9px] leading-relaxed text-amber-200/80">Save this revision before checking provider readiness.</p>
            ) : null}
            {systemCheckError ? (
              <p className="mt-2 rounded border border-red-400/20 bg-red-400/10 p-2 text-[9px] leading-relaxed text-red-200">
                {systemCheckError}
              </p>
            ) : null}
            {systemCheck ? (
              <div className="mt-2 space-y-1.5">
                {[systemCheck.bridge, systemCheck.ffmpeg, systemCheck.ffprobe].map((check) => (
                  <ReadinessRow key={check.id} label={check.label} status={check.status} detail={check.detail} />
                ))}
                {providerReadiness ? (
                  <ReadinessRow
                    label={providerReadiness.label}
                    status={providerReadiness.status}
                    detail={providerReadiness.requiredEnv ? `${providerReadiness.detail} Required env: ${providerReadiness.requiredEnv}.` : providerReadiness.detail}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SelectEditor
              label="Status"
              value={subtitleProvider.status}
              options={["selected", "needs-generation", "generated", "provided", "failed"].map((value) => ({ value, label: value }))}
              disabled={disabled}
              onChange={(value) => onApply((current) => updateSubtitleProvider(current, { status: value as "selected" | "needs-generation" | "generated" | "provided" | "failed" }))}
            />
            <NumberEditor
              label="Est. cost"
              value={subtitleProvider.estimatedCostUsd ?? 0}
              min={0}
              max={10_000}
              step={0.001}
              suffix="$"
              disabled={disabled}
              onChange={(value) => onApply((current) => updateSubtitleProvider(current, { estimatedCostUsd: value }))}
            />
          </div>
          <TextEditor
            label="Model"
            value={subtitleProvider.model ?? ""}
            disabled={disabled}
            onChange={(value) => onApply((current) => updateSubtitleProvider(current, { model: value.trim() || undefined }))}
          />
          <TextEditor
            label="Language"
            value={subtitleProvider.language ?? ""}
            disabled={disabled}
            onChange={(value) => onApply((current) => updateSubtitleProvider(current, { language: value.trim() || undefined }))}
          />
          <TextEditor
            label="Notes"
            value={subtitleProvider.notes ?? ""}
            disabled={disabled}
            onChange={(value) => onApply((current) => updateSubtitleProvider(current, { notes: value.trim() || undefined }))}
          />
          <div className="rounded-lg border border-white/10 bg-black/25 p-2">
            <button
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-violet-300/25 bg-violet-400/12 px-3 py-2 text-[10px] font-semibold text-violet-100 transition hover:border-violet-200/45 hover:bg-violet-400/20 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={captionGenerationDisabled}
              onClick={onGenerateCaptions}
            >
              {captionGenerationLoading ? <LoaderCircle className="size-3 animate-spin" /> : <Captions className="size-3" />}
              {captionGenerationLoading ? "Generating captions…" : captionGenerationActionLabel}
            </button>
            {planIsDirty ? (
              <p className="mt-2 text-[9px] leading-relaxed text-amber-200/80">
                Save this revision before generating captions so the provider runs against the exact approved plan.
              </p>
            ) : (
              <p className="mt-2 text-[9px] leading-relaxed text-zinc-600">
                Local Whisper runs on this device. OpenAI/OpenRouter ask for upload confirmation and require the bridge process to have the matching API key.
              </p>
            )}
            {captionGenerationError ? (
              <p className="mt-2 rounded border border-red-400/20 bg-red-400/10 p-2 text-[9px] leading-relaxed text-red-200">
                {captionGenerationError}
              </p>
            ) : null}
            {captionGenerationResult ? (
              <p className="mt-2 rounded border border-emerald-300/15 bg-emerald-300/[0.06] p-2 text-[9px] leading-relaxed text-emerald-100/85">
                {captionGenerationResult.status === "provided" ? "Confirmed" : "Generated"} {captionGenerationResult.cues} cues with {captionGenerationResult.mode}; saved to {captionGenerationResult.captionsPath}. Render a fresh preview before final approval.
              </p>
            ) : null}
          </div>
        </InspectorSection>
      ) : null}

      {plan.timeline.captionsAssetId ? (
        <InspectorSection title="Caption style">
          <div className="grid grid-cols-2 gap-2">
            <SelectEditor
              label="Mode"
              value={captionStyle.mode}
              options={["selectable", "burn-in", "both"].map((value) => ({ value, label: value }))}
              disabled={disabled}
              onChange={(value) => onApply((current) => updateCaptionStyle(current, { mode: value as "selectable" | "burn-in" | "both" }))}
            />
            <SelectEditor
              label="Preset"
              value={captionStyle.preset}
              options={["clean", "bold", "minimal"].map((value) => ({ value, label: value }))}
              disabled={disabled}
              onChange={(value) => onApply((current) => updateCaptionStyle(current, { preset: value as "clean" | "bold" | "minimal" }))}
            />
          </div>
          <SelectEditor
            label="Alignment"
            value={captionStyle.alignment}
            options={["bottom", "middle", "top"].map((value) => ({ value, label: value }))}
            disabled={disabled}
            onChange={(value) => onApply((current) => updateCaptionStyle(current, { alignment: value as "bottom" | "middle" | "top" }))}
          />
          <div className="grid grid-cols-3 gap-2">
            <NumberEditor label="Size" value={captionStyle.fontSize ?? 42} min={20} max={120} step={1} disabled={disabled} onChange={(value) => onApply((current) => updateCaptionStyle(current, { fontSize: Math.round(value) }))} />
            <NumberEditor label="Margin" value={captionStyle.marginV} min={12} max={480} step={1} disabled={disabled} onChange={(value) => onApply((current) => updateCaptionStyle(current, { marginV: Math.round(value) }))} />
            <NumberEditor label="Bg alpha" value={captionStyle.backgroundOpacity} min={0} max={1} step={0.05} disabled={disabled} onChange={(value) => onApply((current) => updateCaptionStyle(current, { backgroundOpacity: value }))} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <ColorEditor label="Text" value={captionStyle.textColor} disabled={disabled} onChange={(value) => onApply((current) => updateCaptionStyle(current, { textColor: value }))} />
            <ColorEditor label="Outline" value={captionStyle.outlineColor} disabled={disabled} onChange={(value) => onApply((current) => updateCaptionStyle(current, { outlineColor: value }))} />
            <ColorEditor label="Bg" value={captionStyle.backgroundColor} disabled={disabled} onChange={(value) => onApply((current) => updateCaptionStyle(current, { backgroundColor: value }))} />
          </div>
        </InspectorSection>
      ) : null}

      {plan.timeline.audioTracks.length > 0 ? (
        <InspectorSection title="Ducking">
          <ToggleEditor
            label="Smart ducking"
            checked={ducking.enabled}
            disabled={disabled}
            onChange={(checked) => onApply((current) => updateDucking(current, { enabled: checked }))}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberEditor label="Threshold" value={ducking.threshold} min={0.001} max={1} step={0.001} disabled={disabled || !ducking.enabled} onChange={(value) => onApply((current) => updateDucking(current, { threshold: value }))} />
            <NumberEditor label="Ratio" value={ducking.ratio} min={1} max={20} step={0.5} disabled={disabled || !ducking.enabled} onChange={(value) => onApply((current) => updateDucking(current, { ratio: value }))} />
            <NumberEditor label="Attack" value={ducking.attackMs} min={0.01} max={2000} step={1} suffix="ms" disabled={disabled || !ducking.enabled} onChange={(value) => onApply((current) => updateDucking(current, { attackMs: value }))} />
            <NumberEditor label="Release" value={ducking.releaseMs} min={0.01} max={9000} step={1} suffix="ms" disabled={disabled || !ducking.enabled} onChange={(value) => onApply((current) => updateDucking(current, { releaseMs: value }))} />
          </div>
        </InspectorSection>
      ) : null}
    </>
  )
}

function NumberEditor({
  label,
  value,
  min,
  max,
  step,
  suffix,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step: number
  suffix?: string
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <label className="block rounded-md border border-white/10 bg-black/30 p-2">
      <span className="block text-[9px] uppercase tracking-wider text-zinc-600">{label}</span>
      <span className="mt-1 flex items-center gap-1">
        <input
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-zinc-200 outline-none disabled:text-zinc-500"
          type="number"
          value={Number(value.toFixed(3))}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (Number.isFinite(next)) onChange(next)
          }}
        />
        {suffix ? <span className="text-[10px] text-zinc-600">{suffix}</span> : null}
      </span>
    </label>
  )
}

function TextEditor({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="block rounded-md border border-white/10 bg-black/30 p-2">
      <span className="block text-[9px] uppercase tracking-wider text-zinc-600">{label}</span>
      <input
        className="mt-1 w-full bg-transparent text-[11px] text-zinc-200 outline-none disabled:text-zinc-500"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function SelectEditor({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="block rounded-md border border-white/10 bg-black/30 p-2">
      <span className="block text-[9px] uppercase tracking-wider text-zinc-600">{label}</span>
      <select
        className="mt-1 w-full bg-transparent text-[11px] text-zinc-200 outline-none disabled:text-zinc-500"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

function ToggleEditor({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between rounded-md border border-white/10 bg-black/30 p-2 text-[11px] text-zinc-400">
      <span>{label}</span>
      <input
        className="accent-amber-300"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}

function ColorEditor({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="block rounded-md border border-white/10 bg-black/30 p-2">
      <span className="block text-[9px] uppercase tracking-wider text-zinc-600">{label}</span>
      <span className="mt-1 flex items-center gap-1.5">
        <input
          className="h-6 w-7 rounded border-0 bg-transparent p-0 disabled:opacity-50"
          type="color"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
        />
        <input
          className="min-w-0 flex-1 bg-transparent font-mono text-[10px] text-zinc-200 outline-none disabled:text-zinc-500"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </label>
  )
}

function TimelineRuler({ duration }: { duration: number }) {
  const marks = Array.from({ length: 5 }, (_, index) => (duration / 4) * index)
  return (
    <div className="absolute inset-x-2 top-1 flex justify-between font-mono text-[9px] text-zinc-700">
      {marks.map((mark) => <span key={mark}>{formatTimecode(mark)}</span>)}
    </div>
  )
}

function canBatchRenderCandidate(candidate: ReviewCandidate) {
  return candidateHasCurrentPreview(candidate) &&
    !candidate.outputExists &&
    candidate.status !== "rendered" &&
    candidate.status !== "queued" &&
    candidate.status !== "rendering"
}

function humanizeId(value: string) {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}
