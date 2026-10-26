# OpenCut Agent Review User Guide

This guide is for the person reviewing clips that an AI agent prepared. The
current workflow is local-first: source media stays on the machine, and no
render, export, or publication happens unless you explicitly approve it.

For the complete-video workflow, see [Main video workspace](MAIN_EDITOR_GUIDE.md).
The app home lists main projects and saved clip reviews.

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

The review UI has three stages:

1. **Choose clips** — read each clip's topic and duration, expand **Why this
   clip?**, then press **Open clip**. Opening a clip does not render it.
2. **Edit** — watch **Source** beside the transcript. Click a passage to seek;
   tick whole passages and choose **Keep selected** or **Remove selected**.
   You can also enter a target duration and press **Shorten clip**. Review the
   proposed changes, then press **Save changes**. Open **Correct caption text
   & timing** for subtitle corrections. Saved changes create a new version and
   invalidate the old preview. Unsaved changes prevent switching clips.
3. **Review & export** — press **Render edited preview**, then watch **Edited
   preview** in the same player. This shows the rendered cuts, titles,
   watermark, captions, and audio. Press **Approve & render final** only when
   satisfied. Once a final video exists, **Create export package** bundles the
   rendered videos, captions, and handoff notes in a local folder.

The Source view shows original footage, including any captions already burned
into the original. Use Edited preview to judge the actual produced clip.

**Advanced** contains layers, exact timing, audio, providers, project files,
revision history, and plan download. **More editing tools** in the transcript
contains local text commands, filler suggestions, pause analysis, passage
protection, and restore. **Render several clips together** on the review screen
contains batch selection and a separate batch approval button.

Existing rendered clips open at Review & export and remain read-only. Layouts
stack on narrow screens; the same controls remain available. Export folder paths
may be relative to the media root chosen by the launcher; resolve those inside
that local folder (for the current podcast project, this is Downloads).

The standalone **Import edit plan** flow remains available without a saved review
session. It retains its original direct render approval; the staged preview/final
gates above apply to saved review projects.

## How to judge candidates

For each candidate, check:

- whether the clip is a distinct moment or part of a longer narrative;
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

In **Advanced**, enable **Show layout guides on source video** to edit the
existing visual layers:

- drag existing overlay/title boxes to change position;
- drag the bottom-right handle to resize overlay/title boxes;
- use arrow keys for one-pixel nudges, or Shift+arrow for ten-pixel nudges;
- drag the burned-in caption preview vertically to choose top, middle, or bottom
  safe placement;
- use the inspector for exact numbers, colors, opacity, font scale, timing, and
  fit.

These guides edit existing agent-authored layers. They do not yet create
new overlay/title tracks, add masks, animate keyframes, or replace the required
rendered preview as the final approval artifact.

## Current subtitle workflow

**Advanced** includes a subtitle-provider selector for each v2
candidate. It records the approved caption source as part of the edit plan and
can run the selected provider:

- local Whisper;
- OpenAI API transcription models;
- OpenRouter transcription routes;
- supplied local SRT/VTT files.

The selector includes local/external privacy and cost notes. Press **Generate
captions** after selecting the provider. Use **Check setup** first if you are
not sure the bridge can see FFmpeg, ffprobe, the local Whisper command, the
OpenAI/OpenRouter API key, or the supplied caption file. This check is
read-only: it does not transcribe, render, upload, or change files.

Local Whisper stays on this machine and requires a local Whisper command
available to the bridge process. OpenAI API and OpenRouter modes ask for upload
confirmation before sending the extracted candidate WAV audio, and require the
matching API key in the bridge process environment. A successful provider pass
saves an SRT asset into the candidate directory, attaches it to the edit plan,
creates a new numbered revision, and invalidates any older preview.

After captions are loaded, open **Correct caption text & timing** to fix obvious
spelling, wording, and timing errors. Editing a cue does not change the render until you press
**Save caption changes**. That save writes a new local SRT file inside the
candidate directory, creates a new numbered revision, and locks preview/final
approval until a fresh preview is rendered. If you change your mind, press
**Discard changes** before previewing.

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
