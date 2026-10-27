import { useEffect, useState } from "react"
import { Button } from "./ui/button.tsx"
import { formatTimecode } from "#/lib/edit-plan.ts"
import { renderJobActive, type RenderJob } from "#/lib/render-jobs.ts"
export function RenderProgressPanel({
  job,
  cancelling,
  onCancel,
}: {
  job: RenderJob
  cancelling: boolean
  onCancel: () => void
}) {
  const [now, setNow] = useState(Date.now())
  const active = renderJobActive(job)
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [active])
  const elapsed = Math.max(
    0,
    Math.floor(
      ((job.finishedAt ? Date.parse(job.finishedAt) : now) -
        Date.parse(job.createdAt)) /
        1_000,
    ),
  )
  const percent = job.percent == null ? null : Math.floor(job.percent)
  return (
    <section
      aria-label="Render progress"
      className="space-y-3 rounded-xl border border-white/15 bg-[#111214] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {active
              ? `${job.mode === "preview" ? "Preview" : "Final video"} · ${job.message}`
              : job.message}
          </h3>
          <p className="mt-1 text-xs text-zinc-400">
            {Math.floor(elapsed / 60)}m {String(elapsed % 60).padStart(2, "0")}s
            elapsed
            {percent != null ? ` · ${percent}%` : active ? " · Preparing" : ""}
          </p>
        </div>
        {active ? (
          <Button
            variant="outline"
            disabled={
              cancelling ||
              job.status === "cancelling" ||
              job.phase === "publishing"
            }
            onClick={onCancel}
          >
            {cancelling || job.status === "cancelling"
              ? "Cancelling…"
              : job.phase === "publishing"
                ? "Finishing export…"
                : "Cancel render"}
          </Button>
        ) : null}
      </div>
      <div
        role="progressbar"
        aria-label={`${job.mode} render progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={percent == null ? job.message : `${percent}%`}
        className="h-2 overflow-hidden rounded-full bg-white/10"
      >
        <div
          className={`h-full rounded-full bg-amber-300 ${percent == null && active ? "w-1/4 animate-pulse" : ""}`}
          style={percent == null ? undefined : { width: `${percent}%` }}
        />
      </div>
      {job.phase !== "preparing" ? (
        <p className="text-xs text-zinc-400">
          {formatTimecode(job.renderedSeconds)} /{" "}
          {formatTimecode(job.totalSeconds)} encoded
        </p>
      ) : null}
      {job.error ? (
        <p role="status" className="text-sm text-amber-100">
          {job.error}
        </p>
      ) : null}
      {job.details ? (
        <details>
          <summary className="cursor-pointer text-xs text-zinc-400">
            Technical details
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs text-zinc-400">
            {job.details}
          </pre>
        </details>
      ) : null}
    </section>
  )
}
