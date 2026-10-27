# Main video editor guide

Bridge 0.12.0 · current behavior, 27 October 2026.

Use this workflow for a complete video. For agent-prepared short clips, use the
[clip review guide](USER_GUIDE.md). [Features and limits](../../FEATURES.md) covers
both workflows and the remaining work.

## Open the workspace

If the app is already running, open its projects home. The current local instance
is **http://127.0.0.1:5273/**. A default launcher uses port **5173** instead.

To start from the source checkout when no workspace is running:

```sh
OPENCUT_AGENT_ROOT="/absolute/path/to/media-folder" \
  apps/agent-bridge/bin/opencut-studio
```

The media folder must already exist and contain the files you want to use. Sources
stay in place. The launcher starts both local services, prints the app URL, and
rejects occupied ports. `OPENCUT_WEB_PORT` and `OPENCUT_AGENT_HTTP_PORT` change the
ports; [README setup](../../README.md#start-the-workspace) includes the configured
5273/3320 example. Leave the launcher open while editing or rendering.

## Create a project

1. In **Your projects**, enter **Project name** and **Video file path**.
2. Use **Browse…** on macOS to choose a video, or paste its absolute path. The file
   must be inside the configured media folder. Choosing it only fills the field;
   it does not upload, copy or import it until you continue.
3. Press **Create project**. The editor starts with the complete source on one
   main timeline; video creation does not automatically transcribe or render.
4. Return through **← Projects** and use **Main projects → Open project** to resume.

The project has a stable `/editor?project=<id>` link. A clip review has a different
workflow and appears in **Clip reviews**. Library entries represent explicitly
created/opened projects; the app does not scan your disk for unrelated videos.

## Watch and edit

**Source** shows the selected original cut, including any captions or logos already
baked into it. Click a transcript passage to seek, or use the source player's
play/seek controls. Source playback is not a live view of your edits or mix.

Use the visible **Main timeline**:

- Select a cut to watch its source.
- Move the playhead inside that cut and press **Split at playhead**. Press
  **Save changes** to persist the split.
- Select a cut and choose **Move cut first** or **Remove cut**. These produce a
  proposal; review it and press **Save timeline changes**, or cancel it.
- Expand **Trim to a timeline range**, enter the timeline seconds to retain, and
  press **Review trim**. Review the proposal before saving.

The transcript offers **Keep selected**, **Remove selected**, and a target length
with **Shorten edit**. Proposals show duration, retained ranges, caption effects and
production-layer warnings before a separate **Save changes** action. More editing
tools contains local text commands, filler suggestions, passage protection,
**Find audio pauses**, and **Restore previous revision**. Pause analysis is limited
to ten source minutes/40 cuts; it is not a whole-recording analysis for a longer
master. Nothing is removed automatically.

**Shorten edit** accepts main-project targets up to **14,400 seconds** (four hours),
shorter than the current edit. The default is 90% of its saved duration, within
that bound. For example, a 20-minute master starts at 1,080 seconds (18 minutes).
Review the proposed cuts before saving; no render starts from Shorten.

Editorial proposals retime captions, overlays, audio and titles with the retained
speech. Existing crossfades are flattened with a warning. Cuts through part of a
caption omit that cue and flag it for regeneration; no word timings are invented.
Use these proposals for automatic retiming. Numeric in/out/speed fields in Advanced
edit plan fields directly, so review and correct timing after changing them.

Unsaved edits can be saved or discarded. Saving creates a version, preserving
snapshots and invalidating the previous preview. Restore creates another version;
it does not delete later history or overwrite an original media file.

## Media and production

Expand **Media & production**. Choose **Add**, use **Browse…** on macOS or enter
**Local file path**, then
press **Add media**. Save the resulting changes.

| Add choice | Result |
| --- | --- |
| Timeline video | Appends a complete video cut; select its timeline cut to watch that source after saving |
| Watermark / overlay | Adds a local PNG/JPEG/WebP or video overlay; images span the current edit, videos are bounded by their available duration |
| Music | Adds quiet background audio with speech ducking; trims to available length rather than looping |
| Captions (SRT/VTT) | Attaches supplied captions for the edited timeline; VTT is normalized to a separate local SRT |

Enter **Opening title** and press **Add title** for a short title card. Layer buttons
with × remove a production layer from the edit, retaining its file. Static full-edit
watermarks extend when video is appended. Detailed position, sizing, timing,
opacity, fit, title text, audio volume and ducking are in **Advanced**.

Keep all referenced files available, including logos or captions stored in another
project's folder. Sources are referenced rather than silently copied into a bundle.

## Captions

Supplied captions must use the **edited output timeline**, not absolute timestamps
from a longer source after cuts/reordering. The transcript loads once the caption
asset is saved. **Correct caption text & timing → Save caption changes** writes a
new caption file and version. **Discard changes** abandons unsaved corrections.

For transcription, open **Advanced** and select a subtitle provider. **Save changes**
after changing provider settings, then press **Check setup**. **Generate captions**
runs the chosen provider; provided-caption
mode instead shows **Confirm caption asset**. Local Whisper needs a local command.
OpenAI API/OpenRouter need credentials and explicit approval before extracted
audio is uploaded. Adding a video does not start transcription.

Adding footage to a captioned project marks its captions as needing an update.
Attach a complete SRT or regenerate before rendering. Check ASR wording, names,
timing and readability before final approval. Caption correction and provider
runs create versions and require a fresh preview.

## Review and export

1. Choose **Continue to review** or **Review & export**.
2. Resolve any **Readiness check** blockers. Use **Retry checks** after a temporary
   check failure. Save pending edits first.
3. Press **Render edited preview**. For a main project this renders the complete
   saved timeline, not just a one-minute excerpt. Keep the workspace running.
4. Watch **Edited preview** in the player: check cut boundaries, captions, watermark,
   titles, levels, framing and the ending.
5. Press **Approve & render final** separately when satisfied.
6. Use **Watch final video** or **Download MP4**. **Create export package** bundles
   rendered videos, captions and available handoff metadata.

A preview does not approve a final. The final must correspond to the current saved
version. Successful outputs publish atomically; failed jobs do not publish partial
finals. Completed masters are read-only. **Make an editable copy** creates a new
project/output folder for further work while retaining the approved original.

Main timelines support up to four hours. Single preview/final renders show the
current preparation/encoding phase, elapsed time and encoding percentage.
**Cancel render** stops preparation or encoding, discards partial output and keeps
the saved revision for an explicit retry. Cancellation is disabled while the
completed file is being published. Refreshing/reopening the project reconnects
to its active job. A stopped/restarted service reports an interrupted or failed
job and requires a new render action; it does not retry automatically. Friendly
errors offer **Technical details** when available. See [operating limits](../../FEATURES.md#operating-limits)
for caption file/body limits and distinctions from clip and MCP requests.

## Create clips within a main project

1. Save the main edit.
2. Open **Media & production → Create a short clip from this edit**.
3. Enter **Clip title**, **Start (timeline seconds)** and **End** within the saved
   timeline, up to 120 seconds long.
4. Press **Create clip**, read any retiming warnings, and open the new clip link.
5. Follow its **Choose clips → Edit → Review & export** workflow, with separate
   preview/final approval.

The child gets its own plan, captions, outputs and review state. The saved master
is unchanged. A main project can link existing clip reviews too; linked reviews
remain separate projects. Clip creation does not automatically choose highlights.

## Reopen and recovery

Use the stable project link or **Main projects → Open project** after restarting.
Opening registers a new opaque session and reloads saved plans, captions, revisions
and completed outputs. An interrupted master is made available for retry; inspect
its saved state before starting another preview/final. Unsaved browser changes
are not a saved version and should not be expected to survive closing the page.

| Symptom | Action |
| --- | --- |
| Port already in use | Use the existing app or stop its launcher before starting another; do not kill an active render |
| Path outside media folder | Use an appropriate existing media root containing all inputs and outputs, then reopen with that launcher |
| Missing video/logo/music | Restore the referenced file/path; moving just the project JSON does not copy sources |
| Captions need updating | Attach a timeline-matching SRT or run the selected provider, then save/preview again |
| Edited preview unavailable | Save pending changes and render a preview of the new version |
| Final edit is read-only | Use Make an editable copy |
| Export path is relative | Resolve it inside the launcher's media folder; the current configured root is Downloads |

Project data lives under `opencut-projects/<id>/`; library records live under
`.opencut-agent/projects/`. Back up both along with original/referenced media.
Export packages contain rendered outputs and handoff metadata, not a source-media
backup. For implementation details, use the [bridge reference](README.md).

The current editor uses buttons/ranges/proposals. Native timeline dragging,
waveforms, keyframes, automatic caption repair and generative media
remain unimplemented; [FEATURES.md](../../FEATURES.md#remaining-work) is the current list.
