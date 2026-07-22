# OpenCut Agent Review User Guide

This guide is for the person reviewing clips that an AI agent prepared. The
current workflow is local-first: source media stays on the machine, and no
render, export, or publication happens unless you explicitly approve it.

## What the agent does

The agent prepares a `review-session.json` with one or more isolated candidate
edits. By default, three candidates should be meaningfully different editorial
options:

1. `hook-first` — strongest opening and fastest payoff.
2. `concise-core` — shortest self-contained explanation.
3. `context-rich` — more setup so the speaker's meaning is preserved.

If a candidate is instead one longer idea split into hook/body/close segments,
it should be marked as `narrative-segment` so the reviewer does not mistake it
for three separate clips.

## What OpenCut review does

The review UI is a human approval boundary. Work left to right:

1. **Select** — choose a candidate to inspect. This does not render.
2. **Save** — if you change timing, captions, or production settings, save a new
   revision.
3. **Preview** — render a fast preview for the exact saved revision.
4. **Approve** — approve one final render, or add preview-ready candidates to a
   batch and approve the batch.
5. **Export** — after rendering, package the local outputs and lightweight
   metadata for handoff.

The UI now shows this sequence at the top of the session so the current state is
explicit.

## How to judge candidates

For each candidate, check:

- the **strategy** label: distinct moment, narrative segment, social variant,
  archive summary, or manual candidate;
- the **rationale**: why the agent chose this candidate;
- per-clip rationale in the inspector: why a specific source range starts and
  ends where it does;
- the source range and output duration;
- caption readability and timing;
- whether title cards, transitions, overlays, and audio ducking help or distract.

If the rationale is missing or the candidates are too similar, ask the producer
agent to create a fresh session with three distinct source moments.

## Current visual controls

Version-2 plans can already edit existing overlay, audio, transition, title-card,
caption-style, and ducking fields through inspector controls.

The current UI is not yet full WYSIWYG for titles, logos, and overlays. Manual
numeric controls are available for size, position, timing, colors, opacity, and
fit. A future pass should add a drag-resize visual canvas so the preview monitor
matches the final layout controls more directly.

## Current subtitle workflow

The agent workflow can use local transcription or an external API when
authorized, but provider selection is not yet exposed as a first-class UI
control. Future work should make subtitle generation selectable between:

- local Whisper;
- OpenAI API transcription models;
- OpenRouter transcription routes;
- supplied local SRT/VTT files.

For now, check the caption preview and ask for a fresh caption pass when timing,
line breaks, spelling, or speaker context are weak.

## Hard boundaries

- Candidate selection is not render approval.
- Batch selection is not render approval.
- Final render requires a successful preview of the current revision.
- Rendered candidates are immutable; material edits require a new revision or
  candidate.
- Export packages include rendered outputs and metadata, not the original large
  source video.
- Publishing is a separate workflow and requires separate destination-specific
  approval.
