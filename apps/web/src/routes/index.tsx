import { createFileRoute } from "@tanstack/react-router"
import {
  Captions,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Download,
  Film,
  FolderOpen,
  Gauge,
  LoaderCircle,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Upload,
  Volume2,
  WandSparkles,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "#/components/ui/button.tsx"
import {
  buildTimelineSegments,
  formatTimecode,
  getTimelineDuration,
  parseEditPlan,
  sampleEditPlan,
  type EditPlan,
  type TimelineSegment,
} from "#/lib/edit-plan.ts"

export const Route = createFileRoute("/")({ component: AgentReviewWorkspace })

type ReviewState = "review" | "rendering" | "rendered" | "failed"

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

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl)
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

  async function handlePlanFile(file: File | undefined) {
    if (!file) return

    try {
      const importedPlan = parseEditPlan(JSON.parse(await file.text()))
      setPlan(importedPlan)
      setSelectedClipId(importedPlan.timeline.clips[0]?.id ?? "")
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
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setVideoUrl(URL.createObjectURL(file))
    setVideoName(file.name)
    setIsPlaying(false)
  }

  function selectSegment(segment: TimelineSegment) {
    setSelectedClipId(segment.clip.id)
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
    }
    await video.play()
    setIsPlaying(true)
  }

  function enforceSelectionEnd() {
    const video = videoRef.current
    if (!video || !selectedSegment) return
    if (video.currentTime >= selectedSegment.clip.sourceEnd) {
      video.pause()
      video.currentTime = selectedSegment.clip.sourceStart
      setIsPlaying(false)
    }
  }

  async function approveAndRender() {
    if (reviewState === "rendering" || reviewState === "rendered") return

    let bridgeResponded = false
    setReviewState("rendering")
    setApprovalError(null)
    setApprovalResult(null)
    try {
      const response = await fetch(`${bridgeUrl}/v1/projects/approve-and-render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, renderLimitSeconds: 300 }),
      })
      bridgeResponded = true
      const payload = (await response.json()) as ApprovalResult & { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? `Local bridge returned ${response.status}`)
      }
      setApprovalResult(payload)
      setBridgeOnline(true)
      setReviewState("rendered")
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
          <Button variant="ghost" size="lg" onClick={() => planInputRef.current?.click()}>
            <Upload data-icon="inline-start" />
            Import plan
          </Button>
          <Button
            size="lg"
            className={reviewState === "rendered"
              ? "bg-emerald-400 text-emerald-950 hover:bg-emerald-300"
              : reviewState === "failed"
                ? "bg-red-300 text-red-950 hover:bg-red-200"
                : "bg-amber-300 text-zinc-950 hover:bg-amber-200"}
            disabled={reviewState === "rendering" || reviewState === "rendered"}
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
                  : "Approve & render"}
          </Button>
        </div>
      </header>

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

            <button
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 py-3 text-[11px] text-zinc-500 transition hover:border-amber-300/40 hover:text-amber-200"
              onClick={() => videoInputRef.current?.click()}
            >
              <FolderOpen className="size-3.5" />
              {videoName ? "Replace source video" : "Attach source video"}
            </button>
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
                  onTimeUpdate={enforceSelectionEnd}
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

          <div className="flex h-12 items-center justify-center gap-4 border-t border-white/10 bg-[#0e0f11]">
            <button
              className="grid size-7 place-items-center rounded-full bg-zinc-100 text-zinc-950 disabled:cursor-not-allowed disabled:opacity-30"
              disabled={!videoUrl}
              onClick={() => void toggleSelectionPlayback()}
              aria-label={isPlaying ? "Pause selection" : "Play selection"}
            >
              {isPlaying ? <Pause className="size-3.5 fill-current" /> : <Play className="ml-0.5 size-3.5 fill-current" />}
            </button>
            <span className="min-w-28 font-mono text-[11px] text-zinc-400">
              {selectedSegment ? formatTimecode(selectedSegment.timelineStart) : "0:00.0"}
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
              </InspectorSection>
              <InspectorSection title="Source range">
                <div className="grid grid-cols-2 gap-2">
                  <TimeBox label="In" value={formatTimecode(selectedSegment.clip.sourceStart)} />
                  <TimeBox label="Out" value={formatTimecode(selectedSegment.clip.sourceEnd)} />
                </div>
                <InspectorValue label="Source length" value={`${(selectedSegment.clip.sourceEnd - selectedSegment.clip.sourceStart).toFixed(1)}s`} />
              </InspectorSection>
              <InspectorSection title="Playback">
                <InspectorValue icon={<Gauge />} label="Speed" value={`${selectedSegment.clip.speed.toFixed(2)}×`} />
                <InspectorValue icon={<Volume2 />} label="Volume" value={`${Math.round(selectedSegment.clip.volume * 100)}%`} />
                <InspectorValue icon={<Clock3 />} label="Timeline length" value={`${selectedSegment.durationSeconds.toFixed(1)}s`} />
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
                    {reviewState === "rendering" ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : reviewState === "rendered" ? (
                      <Check className="size-3.5" />
                    ) : reviewState === "failed" ? (
                      <CircleAlert className="size-3.5" />
                    ) : (
                      <Sparkles className="size-3.5" />
                    )}
                    {reviewState === "rendering"
                      ? "Rendering locally"
                      : reviewState === "rendered"
                        ? "Project rendered"
                        : reviewState === "failed"
                          ? "Render failed"
                          : "Awaiting approval"}
                  </p>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
                    {reviewState === "rendering"
                      ? "The local bridge saved the approved plan and is rendering its MP4 output."
                      : reviewState === "rendered"
                        ? `Saved ${approvalResult?.outputPath ?? plan.output.path}`
                        : reviewState === "failed"
                          ? approvalError ?? "Start the local bridge and retry the render."
                          : "Review both clips, captions, and output settings before handing the plan to the renderer."}
                  </p>
                  {reviewState === "rendered" && approvalResult ? (
                    <p className="mt-2 border-t border-emerald-300/10 pt-2 font-mono text-[9px] text-emerald-200/65">
                      Project: {approvalResult.projectRecordPath}
                    </p>
                  ) : null}
                </div>
              </InspectorSection>
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPlan(sampleEditPlan)
                setSelectedClipId(sampleEditPlan.timeline.clips[0]?.id ?? "")
                setReviewState("review")
                setApprovalResult(null)
                setApprovalError(null)
                setPlanError(null)
              }}
            >
              <RotateCcw /> Reset sample
            </Button>
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
              <div className="mt-1 flex h-7 items-center rounded border border-violet-300/15 bg-violet-400/15 px-3 text-[9px] text-violet-200/75">
                <Captions className="mr-2 size-3" />
                {captionsAsset ? captionsAsset.path.split("/").at(-1) : "No captions attached"}
              </div>
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

function TimeBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/30 p-2">
      <p className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</p>
      <p className="mt-1 font-mono text-[11px] text-zinc-300">{value}</p>
    </div>
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
