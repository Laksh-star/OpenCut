# Features and operating limits

Current local fork: bridge **0.11.0**, 26 October 2026. This describes implemented
behavior. Historical reports and verification logs retain their original dates.

## Workspace capabilities

| Capability | Main projects | Clip reviews |
| --- | --- | --- |
| Entry point | Projects home → Create/Open project | Clip reviews or prepared manifest launcher |
| Reopen | Stable `/editor?project=<id>`; fresh session on opening | Saved library record/manifest; opaque session URL expires on restart |
| Editing flow | Edit video → Review & export | Choose clips → Edit → Review & export |
| Timeline | Select cuts, split at source playhead; propose move-first/remove/range trim | Revise existing cut ranges/order, transcript operations |
| Transcript | Seek, select whole cues, propose keep/remove/shorten, protect passages, restore | Same saved-session editing engine |
| Media creation | Append video; add image/video overlay, music, opening title, supplied captions | Adjust existing plan assets/layers; agents prepare new candidate assets |
| Production controls | Simple additions in Media & production; detailed fields in Advanced | Existing v2 layer, audio, title, transition and caption fields in Advanced |
| Captions | Local Whisper, provided SRT/VTT, or explicitly approved external provider; manual correction | Same provider/correction workflow |
| Audio | Original speech; added music starts quietly with speech ducking | Original dialogue and plan-authored audio; adjustable mix/ducking |
| Revisions | Saved snapshots, caption revisions, notes, stale-preview invalidation | Same, plus independent candidate selection |
| Clip creation | Saved timeline range becomes an independent child review | Independent candidates prepared by an agent or a main project |
| Final outputs | Watch/download MP4, export package, editable copy | Watch/download MP4, export package, separate batch approval |

The v1 contract supports sequential edits and selectable captions. V2 adds
layered video, independent audio, existing adjacent-clip transitions, titles,
styled burn-in/selectable captions and ducking. Existing v1 plans remain readable.

## Editing semantics

Source playback shows the original selected source cut, not a live rendered
composition. Optional layout guides can move/resize existing visual boxes; use
Edited preview to judge actual output.

Transcript operations and proposed timeline trim/remove/reorder retime captions,
video overlays, titles and audio with the retained speech. Split preserves elapsed
time. Exact in/out, speed and other numeric inspector controls change plan fields
directly; inspect and resynchronize caption/layer timing as needed after those
changes. They do not perform the same automatic retiming as an editorial proposal.

Selections use complete caption passages, not inferred word timing. Cuts through
part of a cue omit that cue and warn about regeneration. Existing crossfades are
flattened to midpoint hard cuts by editorial operations, with a warning. Protection
applies to the current proposal and must be selected again after saving.

Adding video to a captioned master marks captions as needing an update. Attach a
complete SRT for the edited timeline or regenerate captions before preview/final.
Full-edit static watermark tracks extend over newly appended video. Music is
trimmed to its available length; it does not loop automatically. Removing a
production layer keeps the referenced file on disk.

## Operating limits

| Surface | Current behavior |
| --- | --- |
| Main editor preview/final | Whole saved timeline, up to 14,400 s (four hours); UI requests its duration rounded up |
| Clip review UI preview | Requests 60 s; HTTP preview permits up to 120 s for clip sessions; a longer candidate gets a partial preview |
| Clip review UI final/batch | Requests up to 300 s; a final exceeding the requested limit is blocked |
| MCP `opencut_render_preview` | Defaults to 30 s, accepts up to 300 s; direct bounded renderer, separate from session approval |
| MCP final/preflight | Render-limit input up to 300 s; use the main-editor HTTP workflow for long projects |
| Shorten command target | 0.1–300 s on both workspaces; a long master's prefilled value can exceed that bound and must be changed; use range trim to retain a longer edit |
| Child clip range | Up to 120 timeline seconds, within the saved parent edit |
| Caption cues | Up to 10,000; text endpoints/imports also have a 1,000,000-byte file limit and HTTP bodies a 2,000,000-byte limit |
| Caption graphics | Above 40 cues, one cached transparent movie replaces many simultaneous image inputs; long-track cues must not overlap |
| Pause analysis | At most 40 primary cuts and 600 source seconds, with a 45 s analysis budget |
| Editorial proposal | Expires after 30 minutes; requires the same saved revision/plan; up to 500 range entries per request |
| Batch | Up to 20 distinct candidates; sequential rendering with per-item status |
| Rendering | One approval/render action at a time per bridge process; successful outputs publish atomically |
| Local access | Loopback HTTP and files inside `OPENCUT_AGENT_ROOT`; keep all referenced assets available |

The raw HTTP batch schema accepts render-limit values up to 14,400 s; that does
not change the clip UI's 300 s request or the MCP input limits. Always distinguish
a schema ceiling from the request a particular workflow makes.

## Persisted state and approvals

A save creates a revision and invalidates the previous preview. Transcript/timeline
proposals require a separate save. Final rendering needs an existing preview for
the exact saved revision. Batch selection is separate from batch approval. Caption
generation and correction create their own revisions.

Finished candidates remain immutable. Main-project copies receive new manifests
and output folders. Parent snapshot locks prevent concurrent saves during child
creation/copying. Failed FFmpeg jobs do not publish a partial final. Normal shutdown
terminates media processes; reopening an interrupted master makes its saved draft
available for retry. These guarantees apply to files managed by this adapter;
external edits to source files still require care.

Project and output data stay outside the code checkout. Export packages copy
rendered outputs and metadata, not the original large source. External provider
transcription requires explicit upload approval. No publishing destination is
implemented.

## Remaining work

The upstream native Editor API/Rust editor integration, draggable NLE timeline,
waveforms, keyframes, native file picker and detailed long-render progress are not
implemented here. Neither are automatic semantic caption repair, diarization,
automatic highlight ranking, reframing, dubbing or generative media. These are
remaining capabilities, not claims about the current implementation.

Recorded validation and what was actually exercised are linked in
[DOCUMENTATION.md](DOCUMENTATION.md). Refer to [shiplog.md](shiplog.md) for chronology.
