import { useEffect, useState } from "react"
import { Button } from "./ui/button.tsx"
import {
  getTimelineDuration,
  type EditPlan,
  type TimelineSegment,
} from "#/lib/edit-plan.ts"
import {
  projectRequest,
  type WorkspaceProject,
} from "#/lib/workspace-projects.ts"
import type { ImportPurpose } from "#/lib/project-editing.ts"
import type { EditorialOperation } from "../../../agent-bridge/src/editorial.ts"

const field =
  "mt-1 min-h-10 w-full rounded-md border border-white/15 bg-black/30 px-3 text-sm text-white"
export function MainProjectTools({
  project,
  plan,
  disabled,
  canCreateClip,
  onImport,
  onApply,
  onCreateClip,
}: {
  project: WorkspaceProject
  plan: EditPlan
  disabled: boolean
  canCreateClip: boolean
  onImport: (path: string, purpose: ImportPurpose) => Promise<void>
  onApply: (updater: (plan: EditPlan) => EditPlan) => void
  onCreateClip: (
    title: string,
    start: number,
    end: number,
  ) => Promise<WorkspaceProject | null>
}) {
  const [purpose, setPurpose] = useState<ImportPurpose>("video")
  const [path, setPath] = useState("")
  const [title, setTitle] = useState("")
  const [clipTitle, setClipTitle] = useState("")
  const [start, setStart] = useState("0")
  const [end, setEnd] = useState(
    String(Math.min(60, getTimelineDuration(plan))),
  )
  const [clips, setClips] = useState<WorkspaceProject[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    projectRequest<{ projects: WorkspaceProject[] }>(
      "",
      undefined,
      controller.signal,
    )
      .then((result) =>
        setClips(
          result.projects.filter((item) => item.parentProjectId === project.id),
        ),
      )
      .catch(() => {})
    return () => controller.abort()
  }, [project.id])
  return (
    <section
      className="space-y-4 rounded-xl border border-white/10 bg-[#111214] p-4"
      aria-label="Project media and tools"
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">Media library</h3>
          <div className="mt-2 flex max-h-28 flex-wrap gap-2 overflow-auto">
            {plan.assets.map((asset) => (
              <span
                key={asset.id}
                title={asset.path}
                className="max-w-64 truncate rounded border border-white/10 px-2 py-1 text-xs text-zinc-400"
              >
                {asset.kind} · {asset.path.split("/").at(-1)}
              </span>
            ))}
          </div>
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setError(null)
              void onImport(path, purpose)
                .then(() => setPath(""))
                .catch((error) => setError(error.message))
            }}
          >
            <label className="text-xs text-zinc-400">
              Add
              <select
                value={purpose}
                disabled={disabled}
                onChange={(event) =>
                  setPurpose(event.target.value as ImportPurpose)
                }
                className={field}
              >
                <option value="video">Timeline video</option>
                <option value="watermark">Watermark / overlay</option>
                <option value="music">Music</option>
                <option value="captions">Captions (SRT/VTT)</option>
              </select>
            </label>
            <label className="min-w-40 flex-1 text-xs text-zinc-400">
              Local file path
              <input
                className={field}
                value={path}
                required
                disabled={disabled}
                onChange={(event) => setPath(event.target.value)}
                placeholder="/path/to/media"
              />
            </label>
            <Button
              type="submit"
              className="min-h-10"
              disabled={disabled || !path.trim()}
            >
              Add media
            </Button>
          </form>
          <p className="mt-2 text-xs text-zinc-500">
            Videos stay in place. Added footage needs its own captions. Use
            Advanced for layer position, volume, styling, and local
            transcription.
          </p>
        </div>
        <div className="min-w-0 space-y-3">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              const value = title.trim()
              onApply((current) => {
                if (current.version !== "2") return current
                return {
                  ...current,
                  timeline: {
                    ...current.timeline,
                    titleCards: [
                      ...current.timeline.titleCards,
                      {
                        id: `title-${crypto.randomUUID()}`,
                        template: "lower-third",
                        title: value,
                        timelineStart: 0,
                        duration: Math.max(
                          0.5,
                          Math.min(3, getTimelineDuration(current)),
                        ),
                        background: "#111827",
                        textColor: "#FFFFFF",
                        accentColor: "#FBBF24",
                        opacity: 1,
                        fontScale: 1,
                      },
                    ],
                  },
                }
              })
              setTitle("")
            }}
          >
            <label className="min-w-24 flex-1 text-xs text-zinc-400">
              Opening title
              <input
                value={title}
                maxLength={160}
                required
                className={field}
                disabled={disabled}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Give your video a title"
              />
            </label>
            <Button
              type="submit"
              className="min-h-10"
              disabled={disabled || !title.trim()}
            >
              Add title
            </Button>
          </form>
          {plan.version === "2" ? (
            <div className="flex flex-wrap gap-2">
              {[
                ...plan.timeline.overlayTracks.map((track) => ({
                  id: track.id,
                  label: "Overlay",
                  type: "overlayTracks" as const,
                })),
                ...plan.timeline.audioTracks.map((track) => ({
                  id: track.id,
                  label: "Music / audio",
                  type: "audioTracks" as const,
                })),
                ...plan.timeline.titleCards.map((card) => ({
                  id: card.id,
                  label: card.title,
                  type: "titleCards" as const,
                })),
              ].map((item) => (
                <button
                  key={item.id}
                  title={`Remove ${item.label}`}
                  disabled={disabled}
                  className="max-w-60 truncate rounded border border-white/15 px-2 py-1 text-xs text-zinc-400 disabled:opacity-40"
                  onClick={() =>
                    onApply((current) =>
                      current.version === "2"
                        ? {
                            ...current,
                            timeline: {
                              ...current.timeline,
                              [item.type]: current.timeline[item.type].filter(
                                (entry) => entry.id !== item.id,
                              ),
                              ...(item.type === "audioTracks"
                                ? {
                                    audioMix: {
                                      ducking: {
                                        enabled: false,
                                        targetTrackIds: [],
                                        threshold: 0.04,
                                        ratio: 8,
                                        attackMs: 20,
                                        releaseMs: 250,
                                      },
                                    },
                                  }
                                : {}),
                            },
                          }
                        : current,
                    )
                  }
                >
                  {item.label} ×
                </button>
              ))}
            </div>
          ) : null}
          <details>
            <summary className="cursor-pointer text-sm font-medium text-amber-200">
              Create a short clip from this edit
            </summary>
            <form
              className="mt-3 space-y-2"
              onSubmit={(event) => {
                event.preventDefault()
                setError(null)
                void onCreateClip(clipTitle, Number(start), Number(end))
                  .then((clip) => {
                    if (clip) setClips((clips) => [...clips, clip])
                  })
                  .catch((error) => setError(error.message))
              }}
            >
              <label className="block text-xs text-zinc-400">
                Clip title
                <input
                  required
                  maxLength={120}
                  className={field}
                  value={clipTitle}
                  disabled={!canCreateClip}
                  onChange={(event) => setClipTitle(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-24 flex-1 text-xs text-zinc-400">
                  Start (timeline seconds)
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    required
                    className={field}
                    value={start}
                    disabled={!canCreateClip}
                    onChange={(event) => setStart(event.target.value)}
                  />
                </label>
                <label className="min-w-24 flex-1 text-xs text-zinc-400">
                  End
                  <input
                    type="number"
                    min={0}
                    max={getTimelineDuration(plan)}
                    step={0.1}
                    required
                    className={field}
                    value={end}
                    disabled={!canCreateClip}
                    onChange={(event) => setEnd(event.target.value)}
                  />
                </label>
                <Button
                  type="submit"
                  className="min-h-10"
                  disabled={!canCreateClip}
                >
                  Create clip
                </Button>
              </div>
              <p className="text-xs text-zinc-500">
                Up to 120 seconds. Save the main edit first. Creates an
                independent clip review with retimed captions and layers.
              </p>
            </form>
          </details>
          {clips.length ? (
            <div className="flex flex-wrap gap-2" aria-label="Project clips">
              {clips.map((clip) => (
                <a
                  key={clip.id}
                  href={`/editor?project=${encodeURIComponent(clip.id)}`}
                  className="rounded border border-amber-300/25 px-3 py-2 text-xs text-amber-200"
                >
                  Open {clip.name} ↗
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}
    </section>
  )
}

export function MainTimeline({
  segments,
  selectedId,
  currentSourceTime,
  disabled,
  canPropose,
  onSelect,
  onSplit,
  onPropose,
}: {
  segments: TimelineSegment[]
  selectedId: string
  currentSourceTime: number
  disabled: boolean
  canPropose: boolean
  onSelect: (segment: TimelineSegment) => void
  onSplit: () => void
  onPropose: (operation: EditorialOperation) => void
}) {
  const duration = segments.at(-1)?.timelineEnd ?? 0
  const [start, setStart] = useState("0")
  const [end, setEnd] = useState(String(duration))
  const selected = segments.find((segment) => segment.clip.id === selectedId)
  return (
    <section
      aria-label="Main timeline"
      className="mt-4 space-y-3 rounded-xl border border-white/10 bg-[#111214] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Main timeline</h3>
        <span className="text-xs text-zinc-400">
          {duration.toFixed(1)}s · {segments.length} cuts
        </span>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-2">
        {segments.map((segment, index) => (
          <button
            key={segment.clip.id}
            onClick={() => onSelect(segment)}
            aria-pressed={segment.clip.id === selectedId}
            className={`min-w-24 flex-1 rounded-md border px-3 py-3 text-left text-xs ${segment.clip.id === selectedId ? "border-amber-300/50 bg-amber-300/10 text-amber-100" : "border-white/10 text-zinc-400"}`}
          >
            <span className="block">Cut {index + 1}</span>
            <span className="mt-1 block">
              {segment.durationSeconds.toFixed(1)}s
            </span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={
            disabled ||
            !selected ||
            currentSourceTime <= selected.clip.sourceStart + 0.05 ||
            currentSourceTime >= selected.clip.sourceEnd - 0.05
          }
          onClick={onSplit}
        >
          Split at playhead
        </Button>
        <Button
          variant="outline"
          disabled={
            !canPropose ||
            segments.length < 2 ||
            selectedId === segments[0]?.clip.id
          }
          onClick={() => onPropose({ type: "move-first", clipId: selectedId })}
        >
          Move cut first
        </Button>
        <Button
          variant="outline"
          disabled={!canPropose || segments.length < 2 || !selected}
          onClick={() => {
            if (selected)
              onPropose({
                type: "remove",
                ranges: [
                  { start: selected.timelineStart, end: selected.timelineEnd },
                ],
              })
          }}
        >
          Remove cut
        </Button>
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-zinc-400">
          Trim to a timeline range
        </summary>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            onPropose({
              type: "keep",
              ranges: [{ start: Number(start), end: Number(end) }],
            })
          }}
        >
          <label className="text-xs text-zinc-400">
            Keep from (seconds)
            <input
              className={field}
              type="number"
              min={0}
              step={0.1}
              required
              value={start}
              disabled={!canPropose}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label className="text-xs text-zinc-400">
            Keep to (seconds)
            <input
              className={field}
              type="number"
              min={0}
              max={duration}
              step={0.1}
              required
              value={end}
              disabled={!canPropose}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={!canPropose}>
            Review trim
          </Button>
        </form>
      </details>
    </section>
  )
}
