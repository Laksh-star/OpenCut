# Clip review user guide

Bridge 0.12.0 · current behavior, 27 October 2026.

Use this workflow to compare and finish short clips prepared by an agent or
created from a saved main edit. For a complete video, start with the
[main editor guide](MAIN_EDITOR_GUIDE.md). The app home lists **Main projects**
and **Clip reviews** separately.

## Open a review

From **Your projects**, choose **Clip reviews → Open clip review**. For an
agent-prepared `review-session.json`, the producer can launch it directly:

```sh
OPENCUT_AGENT_ROOT="/absolute/path/to/media-folder" \
  apps/agent-bridge/bin/opencut-review \
  /absolute/path/to/media-folder/review-session.json
```

The launcher starts both local services and prints an opaque `?session=<id>` URL.
Defaults are app port 5173 and bridge port 3210. The configured local instance
uses **http://127.0.0.1:5273/** with bridge port 3320; see
[launcher setup](../../README.md#start-the-workspace) for overrides.

Large sources stream directly from their local paths; you should not need to
select or upload the video again. A session URL expires when its bridge restarts.
Reopen through the library or run the launcher again to get a new session. Saved
selection, versions, notes and completed outputs remain on disk.

## 1. Choose clips

Read the title, summary, duration, aspect ratio and current state. Expand
**Why this clip?** to read the editorial rationale. Press **Open clip**, or
**Review final clip** for an already-rendered candidate. Selection does not render.

Three options should represent distinct moments by default. A longer narrative
split across options should be described as such. A useful review checks whether
each option stands alone, preserves the speaker's meaning, and differs from the
other choices. Ask the producer for a new option if the candidates are too similar.

## 2. Edit

**Source** shows the original selected source cut, including any baked-in text.
Click a transcript passage to seek. Tick whole passages and choose **Keep selected**
or **Remove selected**. You can enter a target length (up to 300 seconds and shorter
than the current edit) and choose **Shorten clip**.

Read the proposed changes and warnings before **Save changes**. **Cancel changes**
discards the proposal. Proposing does not save or render. Saving creates a version
and invalidates the previous preview. Unsaved plan/caption changes prevent switching
clips and approving final/batch renders.

**More editing tools** contains the local revision-command field, filler suggestions,
**Find audio pauses**, passage protection and **Restore previous revision**.
Supported commands are “shorten this to 45 seconds”, “keep this passage”, “remove
this passage” and “move this clip first”. They run locally without a remote model.
Suggestions do not automatically remove speech or pauses. Protection belongs to
the current proposal and must be selected again after saving.

Whole-cue timing is used. Cuts through part of a cue omit it and warn about
regeneration. Editorial keep/remove/reorder retimes the retained captions and
production layers; crossfades become midpoint hard cuts with a warning. Numeric
in/out/speed controls in Advanced directly edit plan fields and require timing
review; they do not provide the proposal engine's automatic retiming.

## Caption checks

Open **Correct caption text & timing**, correct the wording/timing and press
**Save caption changes**. This creates a separate local SRT and version. Use
**Discard changes** to abandon unsaved corrections. Review names, sentence starts/
ends and readability; automatic ASR wording repair is not implemented.

Provider settings are in **Advanced**. Choose local Whisper, supplied captions,
OpenAI API or OpenRouter. **Save changes** after changing provider settings, then
press **Check setup**. This readiness check does not
transcribe or upload. Use **Generate captions**, or **Confirm caption asset** in
provided-caption mode, when needed. A successful run creates a new version.

Local Whisper stays on the machine and needs an available command. External
providers require credentials and explicit approval before extracted audio is
uploaded. Merely opening a clip or choosing a provider does not upload anything.

## Production settings

Clip review adjusts an existing plan's layers. **Advanced** contains source range,
speed, volume, caption inclusion, production presets, overlay/title layout, audio,
ducking, existing transitions, provider settings, notes/history and plan download.
New media/layer creation belongs to the main editor or producer-authored plans.

Enable **Show layout guides on source video** in Advanced to select, drag, resize
and keyboard-nudge existing overlay/title boxes. Caption guides adjust safe-zone
placement. These guides are editing aids, not a live rendered composition. Use
**Edited preview** for actual appearance and sound.

## 3. Review and export

1. Choose **Continue to review** or **Review & export**.
2. Resolve **Readiness check** blockers; use **Retry checks** after a temporary
   check failure. Save changes first.
3. Press **Render edited preview** and watch **Edited preview** in the player.
4. Check cuts, caption timing, logo/titles, audio, framing and ending. Then press
   **Approve & render final** as a separate action.
5. Use **Watch final video**, **Download MP4**, or **Create export package** when
   the final is ready.

The clip UI requests a 60-second preview. If a candidate is longer, that preview
covers only its first minute. Final requests use a 300-second limit; an oversized
final is blocked rather than silently truncated. Full-length video belongs in the
[main editor](MAIN_EDITOR_GUIDE.md), which previews the whole saved timeline.

A final requires a preview of the exact saved version. Rendered candidates stay
read-only. For a materially different rendered clip, request a new candidate or
create a fresh child from its master. A main project has **Make an editable copy**;
that action is not part of this clip-review screen.

## Render several clips together

On the review screen, expand **Render several clips together**. Select only clips
whose current previews you have checked, then use **Approve & render N clips**.
Adding to the selection is not approval. Rendering is sequential and records each
item's state. If a batch partially fails, use **Select failed clips to retry** and
approve the retry separately. Finished outputs are preserved.

## Output, storage and recovery

**Create export package** bundles rendered MP4s, available captions, approved plans,
project records, contact sheets and handoff notes. It does not copy the original
large source video and does not publish anything. A relative package path is
inside the launcher's media folder; the current local root is Downloads.

Keep source and referenced production assets available. Reopen a review after a
restart through the projects library or launcher. Version snapshots and audit
history live beside each candidate; closing the browser does not save unsaved edits.

Older encoded-plan links remain a legacy direct-render workflow without saved
session preview gates. They are not the projects home's new-project flow; see the
[bridge reference](README.md#legacy-encoded-plan-links).

## End-to-end check

For a disposable test project, verify: open a clip → seek through its transcript →
propose a change → inspect it before saving → save → render preview → watch it →
separately approve final → download or package. A new caption or plan save must
make the previous preview unavailable for final approval. Do not use an immutable
approved clip as the scratch edit.

[Features and operating limits](../../FEATURES.md) lists pause-analysis, caption,
batch and other bounds. Native timeline gestures, keyframes, automatic highlight
ranking/reframing/dubbing and publishing are not implemented here.

## Render progress and cancellation

Single preview/final actions show preparation or encoding, elapsed time and an
encoding percentage. **Cancel render** stops preparation/encoding and discards
partial output while preserving the saved edit. Cancellation is disabled during
publication. Reopening the saved project reconnects to an active job. After a
service restart, interrupted/failed jobs need an explicit retry. Preview and final
approval remain separate. Batch approval retains its existing per-item queue;
it does not yet have these progress/cancel controls.
