import { useEffect, useRef, useState } from "react"

import { editorialSegments, mergeRanges, parseEditorialCommand, suggestFillerCues, type EditorialOperation, type EditorialProposal, type TimeRange } from "../../../agent-bridge/src/editorial.ts"
import type { CaptionCue } from "#/lib/captions.ts"
import { formatTimecode, type EditPlan } from "#/lib/edit-plan.ts"
import type { ReviewSession } from "#/lib/review-session.ts"

type Proposal = EditorialProposal & { proposalId: string; revision: number }
type SilenceResult = { ranges: TimeRange[]; warning: string; revision: number }
type Props = {
  bridgeUrl: string
  sessionId: string
  candidateId: string
  revision: number
  approvalToken: string
  plan: EditPlan
  cues: CaptionCue[]
  selectedClipId: string
  disabled: boolean
  onSeek: (seconds: number) => void
  onSaved: (session: ReviewSession) => void
  onBusyChange: (busy: boolean) => void
}

const buttonClass = "rounded-md border border-white/15 px-3 py-2 text-xs text-zinc-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"

export function TranscriptEditor(props: Props) {
  const [selection, setSelection] = useState<number[]>([])
  const [protectedCues, setProtectedCues] = useState<number[]>([])
  const [command, setCommand] = useState("")
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [silence, setSilence] = useState<SilenceResult | null>(null)
  const [selectedPauses, setSelectedPauses] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const locked = props.disabled || busy
  const duration = editorialSegments(props.plan).at(-1)?.end ?? 0
  const selectedRanges = rangesFor(selection)
  const protectedRanges = rangesFor(protectedCues)

  useEffect(() => () => controller.current?.abort(), [])

  function rangesFor(indices: number[]): TimeRange[] {
    return mergeRanges(indices.flatMap((index) => {
      const cue = props.cues[index]
      if (!cue || cue.start >= duration) return []
      return [{ start: cue.start, end: Math.min(cue.end, duration) }]
    }))
  }

  function toggleCue(index: number) {
    setSelection((selected) => selected.includes(index) ? selected.filter((entry) => entry !== index) : [...selected, index])
    setProposal(null)
  }

  async function request<T>(action: string, extra: object = {}): Promise<T> {
    controller.current?.abort()
    const nextController = new AbortController()
    controller.current = nextController
    const response = await fetch(`${props.bridgeUrl}/v1/review-sessions/${encodeURIComponent(props.sessionId)}/edits/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: nextController.signal,
      body: JSON.stringify({ candidateId: props.candidateId, expectedRevision: props.revision, approvalToken: props.approvalToken, ...extra }),
    })
    const result = await response.json() as T & { error?: string }
    if (!response.ok) throw new Error(result.error ?? `The edit request failed (${response.status})`)
    return result
  }

  async function run(action: () => Promise<void>) {
    if (locked) return
    setBusy(true)
    props.onBusyChange(true)
    setError(null)
    try { await action() }
    catch (error) {
      if (!controller.current?.signal.aborted) setError(error instanceof Error ? error.message : "Could not complete the edit")
    } finally {
      setBusy(false)
      props.onBusyChange(false)
    }
  }

  function propose(operation?: EditorialOperation) {
    void run(async () => {
      setProposal(null)
      const nextOperation = operation ?? parseEditorialCommand(command, { selection: selectedRanges, clipId: props.selectedClipId })
      setProposal(await request<Proposal>("propose", { operation: nextOperation, protectedRanges }))
    })
  }

  return (
    <details open className="border-b border-white/10 bg-[#101113] px-4 py-4">
      <summary className="cursor-pointer text-sm font-semibold text-zinc-100">Transcript & revision commands</summary>
      <p className="mt-2 text-xs leading-relaxed text-zinc-400">Click a passage to seek. Select whole caption cues to keep or remove. Changes are proposed first and saved as a new revision.</p>
      {props.disabled ? <p className="mt-2 text-xs text-amber-200">Save or reset other edits first. Editing is unavailable while a candidate is busy or already rendered.</p> : null}
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} disabled={locked || !selectedRanges.length} onClick={() => propose({ type: "keep", ranges: selectedRanges })}>Propose keeping selected</button>
            <button type="button" className={buttonClass} disabled={locked || !selectedRanges.length} onClick={() => propose({ type: "remove", ranges: selectedRanges })}>Propose removing selected</button>
            <button type="button" className={buttonClass} disabled={locked || !props.cues.length} onClick={() => {
              const fillers = suggestFillerCues(props.cues)
              setSelection(fillers); setProposal(null)
              setError(fillers.length ? null : "No standalone filler cues found. Mixed speech is left intact.")
            }}>Find filler cues</button>
          </div>
          <div className="mt-3 max-h-64 space-y-1 overflow-auto rounded-lg border border-white/10 p-2" aria-label="Transcript passages">
            {props.cues.length ? props.cues.map((cue, index) => (
              <div key={`${index}-${cue.start}`} className={`flex items-start gap-2 rounded-md p-2 ${selection.includes(index) ? "bg-amber-300/10" : "hover:bg-white/5"}`}>
                <input type="checkbox" className="mt-1 accent-amber-300" aria-label={`Select passage ${index + 1}`} checked={selection.includes(index)} disabled={locked || cue.start >= duration} onChange={() => toggleCue(index)} />
                <button type="button" className="min-w-0 flex-1 text-left text-xs text-zinc-200 disabled:opacity-40" disabled={busy || cue.start >= duration} onClick={() => props.onSeek(cue.start)}>
                  <span className="mr-2 font-mono text-[10px] text-zinc-500">{formatTimecode(cue.start)}</span>
                  {cue.text}
                  {protectedCues.includes(index) ? <span className="ml-2 text-[10px] text-emerald-300">Protected for proposal</span> : null}
                </button>
              </div>
            )) : <p className="p-3 text-xs text-zinc-500">Generate or attach captions to select transcript passages. Duration and clip-order commands also work without captions.</p>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className={buttonClass} disabled={locked || !selectedRanges.length} onClick={() => { setProtectedCues(selection); setProposal(null) }}>Protect selected for proposal</button>
            <button type="button" className={buttonClass} disabled={locked || !protectedCues.length} onClick={() => { setProtectedCues([]); setProposal(null) }}>Clear protection</button>
            <button type="button" className={buttonClass} disabled={locked || !selection.length} onClick={() => { setSelection([]); setProposal(null) }}>Clear selection</button>
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">Selections use cue timing, not estimated word timing. Protection applies to this proposal; select it again after saving a revision.</p>
        </div>
        <div>
          <label htmlFor="editorial-command" className="text-xs font-medium text-zinc-300">Describe a revision</label>
          <form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); propose() }}>
            <input id="editorial-command" className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-zinc-100" value={command} disabled={locked} maxLength={300} placeholder="Shorten this to 45 seconds" onChange={(event) => { setCommand(event.target.value); setProposal(null) }} />
            <button type="submit" className={buttonClass} disabled={locked || !command.trim()}>Propose edit</button>
          </form>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">Supported: “shorten this to 45 seconds”, “keep this passage”, “remove this passage”, and “move this clip first”. Commands run locally. Select a timeline clip for clip-order changes.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={buttonClass} disabled={locked} onClick={() => void run(async () => {
              setProposal(null); setSilence(await request<SilenceResult>("silence")); setSelectedPauses([])
            })}>Find audio pauses</button>
            <button type="button" className={buttonClass} disabled={locked || props.revision <= 1} onClick={() => void run(async () => {
              props.onSaved(await request<ReviewSession>("undo"))
            })}>Restore previous revision</button>
          </div>
          {silence ? <div className="mt-3 rounded-lg border border-white/10 p-3">
            <p className="text-[11px] text-zinc-400">{silence.warning}</p>
            <div className="mt-2 max-h-32 space-y-2 overflow-auto">
              {silence.ranges.map((range, index) => <div key={index} className="flex items-center gap-2 text-xs text-zinc-300">
                <input type="checkbox" aria-label={`Select pause ${index + 1}`} checked={selectedPauses.includes(index)} disabled={locked} onChange={() => { setSelectedPauses((selected) => selected.includes(index) ? selected.filter((entry) => entry !== index) : [...selected, index]); setProposal(null) }} />
                <button type="button" disabled={busy} className="underline underline-offset-2" onClick={() => props.onSeek(range.start)}>{formatTimecode(range.start)}–{formatTimecode(range.end)}</button>
              </div>)}
              {!silence.ranges.length ? <p className="text-xs text-zinc-500">No qualifying quiet regions detected.</p> : null}
            </div>
            <button type="button" className={`${buttonClass} mt-2`} disabled={locked || !selectedPauses.length} onClick={() => propose({ type: "remove", ranges: selectedPauses.map((index) => silence.ranges[index]!) })}>Propose selected pause cuts</button>
          </div> : null}
          {proposal ? <div className="mt-4 rounded-lg border border-amber-300/25 bg-amber-300/5 p-3" aria-label="Proposed revision">
            <p className="text-sm font-semibold text-amber-200">Review changes · {proposal.beforeSeconds.toFixed(2)}s → {proposal.afterSeconds.toFixed(2)}s</p>
            <ul className="mt-2 max-h-40 list-inside list-disc overflow-auto text-xs leading-relaxed text-zinc-300">{proposal.changes.map((change, index) => <li key={index}>{change}</li>)}</ul>
            {proposal.warnings.length ? <ul className="mt-2 space-y-1 text-xs text-amber-200">{proposal.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={`${buttonClass} border-amber-300/40 text-amber-100`} disabled={locked} onClick={() => void run(async () => {
                props.onSaved(await request<ReviewSession>("apply", { proposalId: proposal.proposalId }))
              })}>Save proposal as r{props.revision + 1}</button>
              <button type="button" className={buttonClass} disabled={busy} onClick={() => setProposal(null)}>Discard proposal</button>
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">Saving invalidates the previous preview. Rendering and final approval remain separate actions.</p>
          </div> : null}
          <p role="status" aria-live="polite" className="mt-3 text-xs text-zinc-400">{busy ? "Working locally…" : ""}</p>
          {error ? <p role="alert" className="mt-2 text-xs text-red-300">{error}</p> : null}
        </div>
      </div>
    </details>
  )
}
