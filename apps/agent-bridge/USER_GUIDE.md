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
3. **Generate captions** — when needed, run the selected subtitle provider or
   confirm an attached SRT/VTT file. This creates a new revision.
4. **Preview** — render a fast preview for the exact saved revision.
5. **Approve** — approve one final render, or add preview-ready candidates to a
   batch and approve the batch.
6. **Export** — after rendering, package the local outputs and lightweight
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

Version-2 plans can edit existing overlay, audio, transition, title-card,
caption-style, and ducking fields through inspector controls.

The preview monitor also has a WYSIWYG visual layer surface:

- drag existing overlay/title boxes to change position;
- drag the bottom-right handle to resize overlay/title boxes;
- use arrow keys for one-pixel nudges, or Shift+arrow for ten-pixel nudges;
- drag the burned-in caption preview vertically to choose top, middle, or bottom
  safe placement;
- use the inspector for exact numbers, colors, opacity, font scale, timing, and
  fit.

The WYSIWYG surface edits existing agent-authored layers. It does not yet create
new overlay/title tracks, add masks, animate keyframes, or replace the required
rendered preview as the final approval artifact.

## Current subtitle workflow

The review UI exposes a first-class subtitle-provider selector for each v2
candidate. It records the approved caption source as part of the edit plan and
can run the selected provider:

- local Whisper;
- OpenAI API transcription models;
- OpenRouter transcription routes;
- supplied local SRT/VTT files.

The selector includes local/external privacy and cost notes. Press **Generate
captions** after selecting the provider. Local Whisper stays on this machine and
requires a local Whisper command available to the bridge process. OpenAI API and
OpenRouter modes ask for upload confirmation before sending the extracted
candidate WAV audio, and require the matching API key in the bridge process
environment. A successful provider pass saves an SRT asset into the candidate
directory, attaches it to the edit plan, creates a new numbered revision, and
invalidates any older preview. Check the caption preview and ask for a fresh
caption pass when timing, line breaks, spelling, or speaker context are weak.

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
