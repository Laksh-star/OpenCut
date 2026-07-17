import { createFileRoute } from "@tanstack/react-router"
import {
  ArrowDown,
  ArrowUp,
  Captions,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Download,
  Film,
  FolderOpen,
  Gauge,
  Eye,
  LoaderCircle,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Save,
  SkipBack,
  SkipForward,
  Sparkles,
  MessageSquareText,
  Upload,
  WandSparkles,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "#/components/ui/button.tsx"
import { parseCaptionFile, type CaptionCue } from "#/lib/captions.ts"
import {
  buildTimelineSegments,
  formatTimecode,
  getTimelineDuration,
  movePlanClip,
  parseEditPlan,
  sampleEditPlan,
  setPlanCaptionsEnabled,
  updatePlanClip,
  type EditPlan,
  type TimelineSegment,
} from "#/lib/edit-plan.ts"
import {
  candidateHasCurrentPreview,
  candidateForSelection,
  mediaAssetForPlan,
  type ReviewCandidate,
  type ReviewSession,
} from "#/lib/review-session.ts"

export const Route = createFileRoute("/")({ component: AgentReviewWorkspace })

type ReviewState = "review" | "saving" | "previewing" | "preview-ready" | "rendering" | "rendered" | "failed"

type ApprovalResult = {
  projectRecordPath: string
  editPlanPath: string
  outputPath: string
  durationSeconds: number
  renderedSeconds: number
}

const bridgeUrl = (
  import.meta.env.VITE_OPENCUT_BRIDGE_URL ?? "http://127.0.0.1:3210"
).replace(/\/$/, "")

function AgentReviewWorkspace() {
  const [plan, setPlan] = useState<EditPlan>(sampleEditPlan)
  const [selectedClipId, setSelectedClipId] = useState(
    sampleEditPlan.timeline.clips[0]?.id ?? "",
  )
  const [reviewState, setReviewState] = useState<ReviewState>("review")
  const [approvalResult, setApprovalResult] = useState<ApprovalResult | null>(null)
  const [approvalError, setApprovalError] = useState<string | null>(null)
  const [bridgeOnline, setBridgeOnline] = useState<boolean | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoName, setVideoName] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentSourceTime, setCurrentSourceTime] = useState(
    sampleEditPlan.timeline.clips[0]?.sourceStart ?? 0,
  )
  const [captionCues, setCaptionCues] = useState<CaptionCue[]>([])
  const [captionsEnabled, setCaptionsEnabled] = useState(false)
  const [captionsLoading, setCaptionsLoading] = useState(false)
  const [captionsError, setCaptionsError] = useState<string | null>(null)
  const [reviewSession, setReviewSession] = useState<ReviewSession | null>(null)
  const [activeReviewCandidateId, setActiveReviewCandidateId] = useState<string | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [revisionNote, setRevisionNote] = useState("")
  const [reviewerNote, setReviewerNote] = useState("")
  const planInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const segments = useMemo(() => buildTimelineSegments(plan), [plan])
  const totalDuration = useMemo(() => getTimelineDuration(plan), [plan])
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
  const planIsDirty = Boolean(activeCandidate && JSON.stringify(activeCandidate.plan) !== JSON.stringify(plan))
  const hasCurrentPreview = candidateHasCurrentPreview(activeCandidate)
  const sessionId = typeof window === "undefined"
    ? null
    : new URLSearchParams(window.location.search).get("session")
  const previewUrl = reviewSession && sessionId && activeCandidate && hasCurrentPreview
    ? `${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId)}/candidates/${encodeURIComponent(activeCandidate.id)}/preview`
    : null

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

  function applyReviewCandidate(session: ReviewSession, candidate: ReviewCandidate) {
    setActiveReviewCandidateId(candidate.id)
    setPlan(candidate.plan)
    setSelectedClipId(candidate.plan.timeline.clips[0]?.id ?? "")
    setCurrentSourceTime(candidate.plan.timeline.clips[0]?.sourceStart ?? 0)
    setReviewState(
      candidate.status === "rendered" || candidate.outputExists
        ? "rendered"
        : candidate.status === "failed"
          ? "failed"
          : candidate.status === "rendering"
            ? "rendering"
            : candidate.status === "previewing"
              ? "previewing"
              : candidateHasCurrentPreview(candidate)
                ? "preview-ready"
                : "review",
    )
    setApprovalResult(null)
    setApprovalError(candidate.error ?? null)
    setPlanError(null)
    setRevisionNote("")
    const asset = mediaAssetForPlan(session, candidate.plan)
    const sessionId = new URLSearchParams(window.location.search).get("session")
    if (asset && sessionId) {
      setVideoUrl(`${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId)}/media/${encodeURIComponent(asset.id)}`)
      setVideoName(asset.label)
    }
  }

  async function selectReviewCandidate(candidateId: string) {
    if (!reviewSession) return
    setSessionError(null)
    try {
      const sessionId = new URLSearchParams(window.location.search).get("session")
      const response = await fetch(`${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId ?? "")}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      })
      const payload = (await response.json()) as ReviewSession & { error?: string }
      if (!response.ok) throw new Error(payload.error ?? `Local bridge returned ${response.status}`)
      setReviewSession(payload)
      const candidate = candidateForSelection(payload)
      if (candidate) applyReviewCandidate(payload, candidate)
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "Could not select candidate")
    }
  }

  function reviseSelectedClip(patch: Partial<EditPlan["timeline"]["clips"][number]>) {
    if (!selectedSegment || reviewState === "rendered" || reviewState === "rendering") return
    try {
      setPlan(updatePlanClip(plan, selectedSegment.clip.id, patch))
      setPlanError(null)
    } catch (error) {
      setPlanError(error instanceof Error ? error.message : "Invalid clip revision")
    }
  }

  async function saveRevision() {
    if (!reviewSession || !activeCandidate || !planIsDirty) return
    setReviewState("saving")
    setSessionError(null)
    try {
      const response = await fetch(`${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId ?? "")}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId: activeCandidate.id, plan, note: revisionNote || undefined }),
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
    if (!reviewSession || !activeCandidate || planIsDirty || reviewState === "previewing") return
    setReviewState("previewing")
    setApprovalError(null)
    try {
      const response = await fetch(`${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId ?? "")}/render-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: activeCandidate.id,
          approvalToken: reviewSession.approvalToken,
          renderLimitSeconds: 60,
        }),
      })
      const payload = (await response.json()) as ApprovalResult & { error?: string; session?: ReviewSession }
      if (!response.ok || !payload.session) throw new Error(payload.error ?? `Local bridge returned ${response.status}`)
      setReviewSession(payload.session)
      const candidate = candidateForSelection(payload.session)
      if (candidate) applyReviewCandidate(payload.session, candidate)
      setReviewState("preview-ready")
      setApprovalResult(payload)
    } catch (error) {
      setReviewState("failed")
      setApprovalError(error instanceof Error ? error.message : "Could not render the preview")
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
    setCaptionsEnabled(false)
    setCaptionsError(null)
    if (!captionsPath) {
      setCaptionsLoading(false)
      return () => controller.abort()
    }

    setCaptionsLoading(true)
    const sessionId = new URLSearchParams(window.location.search).get("session")
    const captionsUrl = reviewSession && sessionId && activeReviewCandidateId
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
  }, [activeReviewCandidateId, captionsPath, reviewSession])

  async function handlePlanFile(file: File | undefined) {
    if (!file) return

    try {
      const importedPlan = parseEditPlan(JSON.parse(await file.text()))
      setPlan(importedPlan)
      setSelectedClipId(importedPlan.timeline.clips[0]?.id ?? "")
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

  function selectSegment(segment: TimelineSegment) {
    setSelectedClipId(segment.clip.id)
    setCurrentSourceTime(segment.clip.sourceStart)
    if (videoRef.current) {
      videoRef.current.currentTime = segment.clip.sourceStart
      videoRef.current.pause()
      setIsPlaying(false)
    }
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
    if (reviewState === "rendering" || reviewState === "rendered") return

    let bridgeResponded = false
    setReviewState("rendering")
    setApprovalError(null)
    setApprovalResult(null)
    try {
      const sessionId = new URLSearchParams(window.location.search).get("session")
      const selectedCandidate = reviewSession ? candidateForSelection(reviewSession) : null
      if (reviewSession && !selectedCandidate) throw new Error("Select a candidate before approval")
      if (reviewSession && planIsDirty) throw new Error("Save the current revision before final approval")
      if (reviewSession && !candidateHasCurrentPreview(selectedCandidate ?? undefined)) {
        throw new Error("Render and review a preview of this revision before final approval")
      }
      const response = await fetch(reviewSession
        ? `${bridgeUrl}/v1/review-sessions/${encodeURIComponent(sessionId ?? "")}/approve-and-render`
        : `${bridgeUrl}/v1/projects/approve-and-render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reviewSession
          ? { candidateId: selectedCandidate?.id, approvalToken: reviewSession.approvalToken, renderLimitSeconds: 300 }
          : { plan, renderLimitSeconds: 300 }),
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

  return (
    <main className="dark min-h-screen bg-[#0c0d0f] text-zinc-100 selection:bg-amber-300/30">
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

      <header className="flex h-14 items-center justify-between border-b border-white/10 bg-[#111214] px-4">
        <div className="flex items-center gap-3">
          <div className="grid size-8 place-items-center rounded-lg bg-amber-300 text-zinc-950 shadow-[0_0_24px_rgba(252,211,77,0.16)]">
            <Film className="size-4" strokeWidth={2.4} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-tight">OpenCut</span>
              <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-amber-200">
                Agent review
              </span>
            </div>
            <p className="mt-0.5 text-[10px] text-zinc-500">Native edit-plan workspace · local first</p>
          </div>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <button className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-white/5 hover:text-zinc-200">
            {plan.project.name}
            <ChevronDown className="size-3" />
          </button>
          <span className="h-5 w-px bg-white/10" />
          <span
            className={`flex items-center gap-1.5 text-[11px] ${
              bridgeOnline === true
                ? "text-emerald-300"
                : bridgeOnline === false
                  ? "text-red-300"
                  : "text-amber-200"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                bridgeOnline === true
                  ? "bg-emerald-400"
                  : bridgeOnline === false
                    ? "bg-red-400"
                    : "animate-pulse bg-amber-300"
              }`}
            />
            {bridgeOnline === true
              ? "Bridge online"
              : bridgeOnline === false
                ? "Bridge offline"
                : "Checking bridge"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {!reviewSession ? (
            <Button variant="ghost" size="lg" onClick={() => planInputRef.current?.click()}>
              <Upload data-icon="inline-start" />
              Import plan
            </Button>
          ) : null}
          {reviewSession ? (
            <Button
              variant="outline"
              size="lg"
              disabled={
                !reviewSession.selectedCandidateId ||
                planIsDirty ||
                reviewState === "saving" ||
                reviewState === "previewing" ||
                reviewState === "rendering" ||
                reviewState === "rendered"
              }
              onClick={() => void renderPreview()}
              title={planIsDirty ? "Save the revision before rendering its preview" : "Render a fast local preview"}
            >
              {reviewState === "previewing" ? <LoaderCircle className="animate-spin" /> : <Eye />}
              {reviewState === "previewing" ? "Previewing…" : hasCurrentPreview ? "Refresh preview" : "Render preview"}
            </Button>
          ) : null}
          <Button
            size="lg"
            className={reviewState === "rendered"
              ? "bg-emerald-400 text-emerald-950 hover:bg-emerald-300"
              : reviewState === "failed"
                ? "bg-red-300 text-red-950 hover:bg-red-200"
                : "bg-amber-300 text-zinc-950 hover:bg-amber-200"}
            disabled={
              reviewState === "saving" ||
              reviewState === "previewing" ||
              reviewState === "rendering" ||
              reviewState === "rendered" ||
              Boolean(reviewSession && (!reviewSession.selectedCandidateId || planIsDirty || !hasCurrentPreview))
            }
            onClick={() => void approveAndRender()}
          >
            {reviewState === "rendering" ? (
              <LoaderCircle className="animate-spin" />
            ) : reviewState === "rendered" ? (
              <Check />
            ) : reviewState === "failed" ? (
              <RotateCcw />
            ) : (
              <Sparkles />
            )}
            {reviewState === "rendering"
              ? "Rendering…"
              : reviewState === "rendered"
                ? "Rendered"
                : reviewState === "failed"
                  ? "Retry render"
                  : "Approve final"}
          </Button>
        </div>
      </header>

      {reviewSession ? (
        <section className="border-b border-white/10 bg-[#111214] px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-zinc-200">{reviewSession.title}</p>
              <p className="mt-0.5 text-[10px] text-zinc-500">Select a candidate for review. Selection never authorizes rendering.</p>
            </div>
            <span className="text-[10px] text-zinc-500">{reviewSession.candidates.length} candidates</span>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {reviewSession.candidates.map((candidate) => {
              const selected = candidate.id === reviewSession.selectedCandidateId
              const rendered = candidate.status === "rendered" || candidate.outputExists
              const previewReady = candidateHasCurrentPreview(candidate)
              return (
                <button
                  key={candidate.id}
                  className={`rounded-lg border p-3 text-left transition ${selected ? "border-amber-300/70 bg-amber-300/10" : "border-white/10 bg-white/[0.025] hover:border-white/25"}`}
                  onClick={() => void selectReviewCandidate(candidate.id)}
                  aria-pressed={selected}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-zinc-100">{candidate.title}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] ${rendered ? "bg-emerald-400/15 text-emerald-300" : previewReady ? "bg-sky-400/15 text-sky-300" : selected ? "bg-amber-300/15 text-amber-200" : "bg-white/5 text-zinc-500"}`}>
                      {rendered ? "Final" : previewReady ? "Preview ready" : selected ? "Selected" : "Ready"}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-zinc-500">{candidate.summary || "Agent-proposed edit"}</p>
                  <p className="mt-2 font-mono text-[9px] text-zinc-600">r{candidate.revision} · {formatTimecode(getTimelineDuration(candidate.plan))} · {candidate.plan.timeline.clips.length} clips</p>
                </button>
              )
            })}
          </div>
          {activeCandidate ? (
            <div className="mt-3 grid gap-2 rounded-lg border border-white/10 bg-black/20 p-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600" htmlFor="revision-note">
                  Revision note
                </label>
                <input
                  id="revision-note"
                  className="mt-1 h-8 w-full rounded-md border border-white/10 bg-black/30 px-2 text-xs text-zinc-200 outline-none focus:border-amber-300/50"
                  value={revisionNote}
                  onChange={(event) => setRevisionNote(event.target.value)}
                  placeholder="What changed in this revision?"
                  maxLength={1_000}
                />
              </div>
              <Button
                className="self-end bg-zinc-100 text-zinc-950 hover:bg-white"
                disabled={!planIsDirty || reviewState === "saving" || reviewState === "rendering" || reviewState === "rendered"}
                onClick={() => void saveRevision()}
              >
                {reviewState === "saving" ? <LoaderCircle className="animate-spin" /> : <Save />}
                {reviewState === "saving" ? "Saving…" : `Save as r${activeCandidate.revision + 1}`}
              </Button>
              <p className="text-[10px] text-zinc-500 md:col-span-2">
                {planIsDirty
                  ? "Unsaved edits invalidate the previous preview. Save before rendering again."
                  : hasCurrentPreview
                    ? `Revision ${activeCandidate.revision} has a verified preview and can be approved for final render.`
                    : `Revision ${activeCandidate.revision} is saved. Render its preview before final approval.`}
              </p>
            </div>
          ) : null}
          {sessionError ? <p className="mt-2 text-xs text-red-300">{sessionError}</p> : null}
        </section>
      ) : sessionError ? (
        <div className="border-b border-red-400/20 bg-red-400/10 px-4 py-3 text-xs text-red-200">{sessionError}</div>
      ) : null}

      {planError ? (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-xs text-red-100">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">This plan could not be imported</p>
            <p className="mt-1 max-h-16 overflow-auto whitespace-pre-wrap text-red-200/70">{planError}</p>
          </div>
        </div>
      ) : null}

      <section className="grid min-h-[calc(100vh-14rem)] grid-cols-1 border-b border-white/10 lg:grid-cols-[250px_minmax(0,1fr)_280px]">
        <aside className="hidden border-r border-white/10 bg-[#101113] lg:block">
          <PanelHeading icon={<FolderOpen />} label="Project media" />
          <div className="space-y-2 p-3">
            {plan.assets.map((asset) => (
              <div
                key={asset.id}
                className="group rounded-lg border border-white/8 bg-white/[0.025] p-2.5 hover:border-white/15 hover:bg-white/[0.04]"
              >
                <div className="flex items-center gap-2.5">
                  <div className="grid size-9 shrink-0 place-items-center rounded-md bg-gradient-to-br from-zinc-700 to-zinc-900 text-zinc-300">
                    {asset.kind === "video" ? <Film className="size-4" /> : <Captions className="size-4" />}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{asset.id}</p>
                    <p className="mt-0.5 truncate text-[10px] uppercase tracking-wider text-zinc-600">{asset.kind}</p>
                  </div>
                </div>
                <p className="mt-2 truncate text-[10px] text-zinc-600" title={asset.path}>{asset.path}</p>
              </div>
            ))}

            {!reviewSession ? <button
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 py-3 text-[11px] text-zinc-500 transition hover:border-amber-300/40 hover:text-amber-200"
              onClick={() => videoInputRef.current?.click()}
            >
              <FolderOpen className="size-3.5" />
              {videoName ? "Replace source video" : "Attach source video"}
            </button> : null}
          </div>

          <div className="mt-3 border-t border-white/10">
            <PanelHeading icon={<WandSparkles />} label="Agent handoff" />
            <div className="m-3 rounded-lg border border-violet-400/20 bg-violet-400/[0.06] p-3">
              <p className="text-[11px] font-medium text-violet-200">Plan validated by MCP bridge</p>
              <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
                Cuts, speed, audio, captions, and output settings are ready for human review.
              </p>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col bg-[#08090a]">
          <div className="flex h-10 items-center justify-between border-b border-white/10 px-3 text-[10px] text-zinc-500">
            <span className="flex items-center gap-2"><Maximize2 className="size-3" /> Preview monitor</span>
            <span>{plan.project.width} × {plan.project.height} · {plan.project.frameRate} fps</span>
          </div>

          <div className="flex flex-1 items-center justify-center p-5 md:p-8">
            <div
              className="relative w-full max-w-4xl overflow-hidden rounded-md border border-white/10 bg-black shadow-2xl shadow-black/60"
              style={{ aspectRatio: `${plan.project.width} / ${plan.project.height}` }}
            >
              {videoUrl ? (
                <video
                  ref={videoRef}
                  className="size-full object-contain"
                  src={videoUrl}
                  onLoadedMetadata={() =>
                    seekToSelectionTime(selectionProgressSeconds)
                  }
                  onTimeUpdate={handleSelectionTimeUpdate}
                  onPause={() => setIsPlaying(false)}
                  onPlay={() => setIsPlaying(true)}
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_40%,rgba(63,63,70,0.3),transparent_55%)]">
                  <div className="max-w-sm px-6 text-center">
                    <div className="mx-auto grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-400">
                      <Film className="size-5" />
                    </div>
                    <p className="mt-4 text-sm font-medium">Attach the original interview</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
                      The plan is loaded. Attach the source video to preview each proposed cut at its exact source time.
                    </p>
                    <Button className="mt-4 bg-white text-zinc-950 hover:bg-zinc-200" onClick={() => videoInputRef.current?.click()}>
                      <FolderOpen /> Attach source
                    </Button>
                  </div>
                </div>
              )}

              {videoUrl && activeCaption ? (
                <div className="pointer-events-none absolute inset-x-4 bottom-16 flex justify-center">
                  <p className="max-w-[85%] whitespace-pre-line rounded-lg bg-black/80 px-4 py-2 text-center text-base font-semibold leading-snug text-white shadow-lg md:text-xl">
                    {activeCaption.text}
                  </p>
                </div>
              ) : null}

              {videoUrl && selectedSegment ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-4 pb-4 pt-12">
                  <p className="text-xs font-medium">{humanizeId(selectedSegment.clip.id)}</p>
                  <p className="mt-1 text-[10px] text-zinc-400">
                    Source {formatTimecode(selectedSegment.clip.sourceStart)}–{formatTimecode(selectedSegment.clip.sourceEnd)}
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex h-16 items-center justify-center gap-3 border-t border-white/10 bg-[#0e0f11] px-4">
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
              aria-label={isPlaying ? "Pause selection" : "Play selection"}
            >
              {isPlaying ? <Pause className="size-3.5 fill-current" /> : <Play className="ml-0.5 size-3.5 fill-current" />}
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
              className="h-1.5 min-w-32 flex-1 cursor-pointer accent-amber-300 disabled:cursor-not-allowed disabled:opacity-30 md:max-w-md"
              type="range"
              min={0}
              max={selectedSegment?.durationSeconds ?? 0}
              step={0.1}
              value={selectionProgressSeconds}
              disabled={!videoUrl || !selectedSegment}
              onChange={(event) => seekToSelectionTime(Number(event.target.value))}
              aria-label="Selection position"
            />
            <span className="min-w-28 text-right font-mono text-[11px] text-zinc-400">
              {formatTimecode(currentTimelineTime)}
              <span className="text-zinc-700"> / </span>
              {formatTimecode(totalDuration)}
            </span>
          </div>
        </div>

        <aside className="hidden border-l border-white/10 bg-[#101113] lg:block">
          <PanelHeading icon={<Gauge />} label="Clip inspector" />
          {selectedSegment ? (
            <div className="divide-y divide-white/8">
              <InspectorSection title="Selection">
                <InspectorValue label="Clip" value={humanizeId(selectedSegment.clip.id)} />
                <InspectorValue label="Asset" value={selectedAsset?.id ?? selectedSegment.clip.assetId} />
                {reviewSession ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={plan.timeline.clips[0]?.id === selectedSegment.clip.id || reviewState === "rendered"}
                      onClick={() => setPlan(movePlanClip(plan, selectedSegment.clip.id, -1))}
                    >
                      <ArrowUp /> Earlier
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={plan.timeline.clips.at(-1)?.id === selectedSegment.clip.id || reviewState === "rendered"}
                      onClick={() => setPlan(movePlanClip(plan, selectedSegment.clip.id, 1))}
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
                    disabled={!reviewSession || reviewState === "rendered"}
                    onChange={(value) => reviseSelectedClip({ sourceStart: value })}
                  />
                  <NumberEditor
                    label="Out (seconds)"
                    value={selectedSegment.clip.sourceEnd}
                    min={selectedSegment.clip.sourceStart + 0.01}
                    step={0.1}
                    disabled={!reviewSession || reviewState === "rendered"}
                    onChange={(value) => reviseSelectedClip({ sourceEnd: value })}
                  />
                </div>
                <InspectorValue label="Source length" value={`${(selectedSegment.clip.sourceEnd - selectedSegment.clip.sourceStart).toFixed(1)}s`} />
              </InspectorSection>
              <InspectorSection title="Playback">
                <NumberEditor
                  label="Speed"
                  value={selectedSegment.clip.speed}
                  min={0.25}
                  max={4}
                  step={0.05}
                  suffix="×"
                  disabled={!reviewSession || reviewState === "rendered"}
                  onChange={(value) => reviseSelectedClip({ speed: value })}
                />
                <NumberEditor
                  label="Volume"
                  value={selectedSegment.clip.volume}
                  min={0}
                  max={2}
                  step={0.05}
                  suffix="×"
                  disabled={!reviewSession || reviewState === "rendered"}
                  onChange={(value) => reviseSelectedClip({ volume: value })}
                />
                <InspectorValue icon={<Clock3 />} label="Timeline length" value={`${selectedSegment.durationSeconds.toFixed(1)}s`} />
                {reviewSession ? (
                  <button
                    className={`flex w-full items-center justify-between rounded-md border px-2.5 py-2 text-[10px] transition ${plan.timeline.captionsAssetId ? "border-violet-300/30 bg-violet-400/10 text-violet-200" : "border-white/10 text-zinc-500"}`}
                    onClick={() => setPlan(setPlanCaptionsEnabled(plan, !plan.timeline.captionsAssetId))}
                    disabled={!plan.assets.some((asset) => asset.kind === "captions") || reviewState === "rendered"}
                    aria-pressed={Boolean(plan.timeline.captionsAssetId)}
                  >
                    <span className="flex items-center gap-1.5"><Captions className="size-3" /> Include captions</span>
                    <span>{plan.timeline.captionsAssetId ? "On" : "Off"}</span>
                  </button>
                ) : null}
              </InspectorSection>
              <InspectorSection title="Review state">
                <div className={`rounded-lg border p-3 ${
                  reviewState === "rendered"
                    ? "border-emerald-400/25 bg-emerald-400/8"
                    : reviewState === "failed"
                      ? "border-red-400/25 bg-red-400/8"
                      : "border-amber-300/20 bg-amber-300/[0.06]"
                }`}>
                  <p className={`flex items-center gap-2 text-xs font-medium ${
                    reviewState === "rendered"
                      ? "text-emerald-300"
                      : reviewState === "failed"
                        ? "text-red-300"
                        : "text-amber-200"
                  }`}>
                    {reviewState === "rendering" || reviewState === "previewing" || reviewState === "saving" ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : reviewState === "rendered" ? (
                      <Check className="size-3.5" />
                    ) : reviewState === "failed" ? (
                      <CircleAlert className="size-3.5" />
                    ) : (
                      <Sparkles className="size-3.5" />
                    )}
                    {reviewState === "saving"
                      ? "Saving revision"
                      : reviewState === "previewing"
                        ? "Rendering preview"
                        : reviewState === "preview-ready"
                          ? "Preview ready"
                          : reviewState === "rendering"
                      ? "Rendering locally"
                      : reviewState === "rendered"
                        ? "Project rendered"
                        : reviewState === "failed"
                          ? "Render failed"
                          : "Awaiting approval"}
                  </p>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
                    {reviewState === "saving"
                      ? "The revised plan is being validated, snapshotted, and saved."
                      : reviewState === "previewing"
                        ? "A fast local preview is being rendered for this exact revision."
                        : reviewState === "preview-ready"
                          ? "Review the rendered preview, then use Approve final for the high-quality output."
                          : reviewState === "rendering"
                      ? "The local bridge saved the approved plan and is rendering its MP4 output."
                      : reviewState === "rendered"
                        ? `Saved ${approvalResult?.outputPath ?? plan.output.path}`
                        : reviewState === "failed"
                          ? approvalError ?? "Start the local bridge and retry the render."
                          : "Review both clips, captions, and output settings before handing the plan to the renderer."}
                  </p>
                  {previewUrl && reviewState !== "rendered" ? (
                    <a
                      className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-medium text-sky-300 hover:text-sky-200"
                      href={previewUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Play className="size-3" /> Open rendered preview
                    </a>
                  ) : null}
                  {reviewState === "rendered" && approvalResult ? (
                    <p className="mt-2 border-t border-emerald-300/10 pt-2 font-mono text-[9px] text-emerald-200/65">
                      Project: {approvalResult.projectRecordPath}
                    </p>
                  ) : null}
                </div>
              </InspectorSection>
              {reviewSession && activeCandidate ? (
                <InspectorSection title="Reviewer notes & audit">
                  <textarea
                    className="min-h-16 w-full resize-y rounded-md border border-white/10 bg-black/30 p-2 text-[10px] text-zinc-200 outline-none focus:border-amber-300/50"
                    value={reviewerNote}
                    onChange={(event) => setReviewerNote(event.target.value)}
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
                    {reviewSession.reviewerNotes.filter((note) => note.candidateId === activeCandidate.id).length} notes · {reviewSession.events.filter((event) => event.candidateId === activeCandidate.id).length} audit events
                  </p>
                  {reviewSession.events.filter((event) => event.candidateId === activeCandidate.id).slice(-3).reverse().map((event) => (
                    <div key={event.id} className="border-l border-white/10 pl-2 text-[9px] text-zinc-500">
                      <p className="font-medium text-zinc-400">{event.type.replaceAll("-", " ")} · r{event.revision ?? activeCandidate.revision}</p>
                      <p>{new Date(event.at).toLocaleString()}</p>
                    </div>
                  ))}
                </InspectorSection>
              ) : null}
            </div>
          ) : null}
        </aside>
      </section>

      <section className="h-44 bg-[#111214]">
        <div className="flex h-10 items-center justify-between border-b border-white/10 px-3">
          <div className="flex items-center gap-3 text-[10px] text-zinc-500">
            <span className="font-medium uppercase tracking-[0.16em] text-zinc-300">Timeline</span>
            <span>{segments.length} clips</span>
            <span>{formatTimecode(totalDuration)}</span>
          </div>
          <div className="flex items-center gap-2">
            {!reviewSession ? <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPlan(sampleEditPlan)
                setSelectedClipId(sampleEditPlan.timeline.clips[0]?.id ?? "")
                setCurrentSourceTime(sampleEditPlan.timeline.clips[0]?.sourceStart ?? 0)
                setReviewState("review")
                setApprovalResult(null)
                setApprovalError(null)
                setPlanError(null)
              }}
            >
              <RotateCcw /> Reset sample
            </Button> : null}
            <Button variant="ghost" size="sm" onClick={downloadPlan}>
              <Download /> Download plan
            </Button>
          </div>
        </div>

        <div className="grid h-[calc(100%-2.5rem)] grid-cols-[84px_minmax(0,1fr)] overflow-hidden">
          <div className="border-r border-white/10 pt-7 text-[10px] text-zinc-600">
            <div className="flex h-11 items-center gap-2 border-y border-white/5 px-3"><Film className="size-3" /> Video 1</div>
            <div className="flex h-7 items-center gap-2 border-b border-white/5 px-3"><Captions className="size-3" /> Captions</div>
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
                    style={{ width: `${(segment.durationSeconds / totalDuration) * 100}%` }}
                    onClick={() => selectSegment(segment)}
                  >
                    <span className="block truncate text-[10px] font-semibold">{humanizeId(segment.clip.id)}</span>
                    <span className={`mt-0.5 block font-mono text-[9px] ${segment.clip.id === selectedSegment?.clip.id ? "text-zinc-700" : "text-white/55"}`}>
                      {segment.durationSeconds.toFixed(1)}s · {segment.clip.speed.toFixed(2)}×
                    </span>
                  </button>
                ))}
              </div>
              <button
                className={`mt-1 flex h-7 w-full items-center rounded border px-3 text-left text-[9px] transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  captionsEnabled
                    ? "border-violet-200/50 bg-violet-400/35 text-violet-100"
                    : "border-violet-300/15 bg-violet-400/15 text-violet-200/75 hover:bg-violet-400/25"
                }`}
                disabled={!captionsAsset || captionsLoading || Boolean(captionsError) || captionCues.length === 0}
                onClick={() => setCaptionsEnabled((enabled) => !enabled)}
                aria-label={captionsEnabled ? "Hide caption preview" : "Show caption preview"}
                aria-pressed={captionsEnabled}
              >
                <Captions className="mr-2 size-3" />
                <span className="truncate">
                  {captionsAsset ? captionsAsset.path.split("/").at(-1) : "No captions attached"}
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
      </section>
    </main>
  )
}

function PanelHeading({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex h-10 items-center gap-2 border-b border-white/10 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [&_svg]:size-3.5">
      {icon}
      {label}
    </div>
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

function TimelineRuler({ duration }: { duration: number }) {
  const marks = Array.from({ length: 5 }, (_, index) => (duration / 4) * index)
  return (
    <div className="absolute inset-x-2 top-1 flex justify-between font-mono text-[9px] text-zinc-700">
      {marks.map((mark) => <span key={mark}>{formatTimecode(mark)}</span>)}
    </div>
  )
}

function humanizeId(value: string) {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}
