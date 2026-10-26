import { ArrowRight, Check, Clock3 } from "lucide-react"
import { getTimelineDuration } from "#/lib/edit-plan.ts"
import {
  candidateHasCurrentPreview,
  type ReviewCandidate,
} from "#/lib/review-session.ts"

export type ReviewStage = "choose" | "edit" | "review"
const stages = [
  { id: "choose", label: "Choose clips" },
  { id: "edit", label: "Edit" },
  { id: "review", label: "Review & export" },
] as const

export function ReviewSteps({
  stage,
  onChange,
  hasSelection,
  locked,
  dirty,
}: {
  stage: ReviewStage
  onChange: (stage: ReviewStage) => void
  hasSelection: boolean
  locked: boolean
  dirty: boolean
}) {
  return (
    <nav aria-label="Review steps" className="grid grid-cols-3 gap-2">
      {stages.map((step, index) => (
        <button
          key={step.id}
          type="button"
          aria-label={`${index + 1} ${step.label}`}
          aria-current={step.id === stage ? "step" : undefined}
          disabled={
            locked ||
            (step.id !== "choose" && !hasSelection) ||
            (step.id === "choose" && dirty)
          }
          onClick={() => onChange(step.id)}
          className={`flex items-center gap-2 rounded-lg border px-3 py-3 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-40 sm:gap-3 sm:px-4 sm:text-sm ${stage === step.id ? "border-amber-300/50 bg-amber-300/10 text-amber-100" : "border-white/10 text-zinc-400 hover:bg-white/5"}`}
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-full border border-current/25 text-xs">
            {index + 1}
          </span>
          {step.label}
        </button>
      ))}
    </nav>
  )
}

function aspectRatio(width: number, height: number) {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const divisor = gcd(width, height)
  return `${width / divisor}:${height / divisor}`
}

export function CandidateChoices({
  candidates,
  selectedId,
  disabled,
  onSelect,
}: {
  candidates: ReviewCandidate[]
  selectedId?: string
  disabled: boolean
  onSelect: (id: string) => void
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {candidates.map((candidate, index) => {
        const final = candidate.outputExists || candidate.status === "rendered"
        const selected = candidate.id === selectedId
        const busy =
          candidate.status === "queued" ||
          candidate.status === "rendering" ||
          candidate.status === "previewing"
        return (
          <article
            key={candidate.id}
            className={`overflow-hidden rounded-xl border bg-[#111214] ${selected ? "border-amber-300/50" : "border-white/10"}`}
          >
            <div className="flex h-full flex-col gap-4 p-5">
              <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
                <span>Clip {index + 1}</span>
                <span
                  className={
                    final
                      ? "text-emerald-300"
                      : candidate.status === "failed"
                        ? "text-red-300"
                        : "text-amber-200"
                  }
                >
                  {final
                    ? "Final ready"
                    : busy
                      ? "Rendering…"
                      : candidate.status === "failed"
                        ? "Needs attention"
                        : candidateHasCurrentPreview(candidate)
                          ? "Preview ready"
                          : selected
                            ? "Selected"
                            : "Ready to edit"}
                </span>
              </div>
              <h3 className="text-lg font-semibold leading-snug">
                {candidate.title}
              </h3>
              <p className="line-clamp-3 text-sm leading-relaxed text-zinc-400">
                {candidate.summary ||
                  candidate.rationale ||
                  "Open this clip to review the proposed edit."}
              </p>
              <p className="mt-auto flex items-center gap-2 text-sm text-zinc-300">
                <Clock3 className="size-4 text-zinc-500" />
                {getTimelineDuration(candidate.plan).toFixed(1)} seconds ·{" "}
                {aspectRatio(
                  candidate.plan.project.width,
                  candidate.plan.project.height,
                )}
              </p>
              <button
                type="button"
                disabled={disabled || busy}
                onClick={() => onSelect(candidate.id)}
                className="flex w-full items-center justify-between gap-2 rounded-lg bg-amber-300 px-4 py-3 text-sm font-semibold text-zinc-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {final ? "Review final clip" : "Open clip"}
                {selected ? (
                  <Check className="size-4" />
                ) : (
                  <ArrowRight className="size-4" />
                )}
              </button>
              {candidate.rationale ? (
                <details className="text-sm">
                  <summary className="cursor-pointer text-zinc-400">
                    Why this clip?
                  </summary>
                  <p className="mt-2 leading-relaxed text-zinc-400">
                    {candidate.rationale}
                  </p>
                </details>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}
