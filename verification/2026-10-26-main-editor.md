# Main-project workflow verification — 26 October 2026

The app home is now a persistent library and `/editor?project=<id>` opens a real
full-video workspace. The existing clip review component was moved to a shared
workspace, preserving its previous URLs and workflow.

## Implemented

- Full-source v2 projects, stable project IDs, metadata-only local library, reopen
  after restart, and separate main/clip lists. Source files stay in place.
- Visible main timeline with selected-cut playback, split at playhead, proposed
  move-first/remove/range trim, transcript editing, separate saves and revisions.
- Video append, local image watermark/overlay, music with ducking, supplied SRT/VTT
  captions, opening titles and layer removal. Existing precise controls remain in
  Advanced. Source playback switches to the correct asset on multi-source edits.
- Full-length preview/final limits up to four hours. Finals over the approved
  duration limit fail rather than silently truncate. Final download streams only
  the saved candidate output and supports ranges/attachment filenames.
- Caption sets above 40 cues compile into one transparent movie; the old 200-cue
  burn-in ceiling is removed. Source PNG images can loop for overlay duration.
- Saved parent edits create independent child clip reviews with retimed captions
  and layers. Snapshot locks exclude simultaneous parent saves during derivation.
- Finished masters remain immutable. An editable copy gets separate project,
  manifest, plan, revisions and final-output paths. Undo can restore a pre-import
  project revision while source identities cannot be replaced under the same ID.
- Render output publishes atomically after FFmpeg succeeds; failed renders leave
  no final file. Shutdown terminates media processes; opening an interrupted main
  project makes its saved draft available for retry.
- `opencut-studio` starts the projects home without requiring a clip manifest. Strict
  port checks prevent accidentally launching against an older service.

## Automated validation

- 66 bridge tests and 24 web tests pass (90 total).
- Both TypeScript checks and bridge/web production builds pass.
- New `smoke:project` uses only generated media and verifies a full 301.000 s output
  containing H.264, AAC and mov_text. It includes 201 burned/selectable captions,
  a PNG watermark and title, blocks final before preview, streams preview/final
  ranges (206), exports a package, derives an isolated child, duplicates the master,
  and reopens saved state after restarting its isolated HTTP server. It also
  recovers a simulated interrupted preview as an editable failed draft.
- Existing editorial and review/batch/export smoke tests pass.
- A failed-FFmpeg unit test confirms no partial final becomes visible. Snapshot
  concurrency and restoring a pre-import revision are covered.

## Browser flow using generated footage

Created an 8 s project through the projects home, attached captions, watermark,
opening title and ducked music through the visible forms, and saved revision 3.
Split at 4 s and saved; moved the second cut first through a visible proposal and
separate save (revision 5). Derived a four-second child without changing the master.
Appended a second 320×240 video to the 640×360 project and confirmed source playback
switched assets. Attached complete captions for the longer edit and saved revision 7.
Rendered a preview, separately approved the 10 s final, and verified final download
and editable-copy actions. An editable copy accepted a saved music-layer removal.
A frame at 9 s had watermark RGB [207,16,26] over the added blue footage, confirming
that a full-edit static watermark extended over the appended source.

Desktop (1440×1000) and mobile (390×844) were inspected. Mobile with media/clip
forms expanded had no horizontal page overflow. Main timeline and production
controls remained accessible. Fresh loads had no console errors. The generic
sample project is no longer shown while the real main project loads.

## Existing recording prepared for review

Created a separate full-video project from the existing podcast: 1189.458333 s,
1920×1080, original speech, the existing DB PNG logo and a static caption band.
Recomputed its source SHA-256 and matched the previously verified local transcript;
357 English cues reuse existing local MLX Whisper word timing. No new transcription,
external upload, podcast preview, or podcast final was requested. Read-only preflight
reported eight passes, zero warnings and zero blockers. Browser loaded all 357 cues,
showed the full duration and enabled only the explicit preview action.

The existing three-clip review remains linked as a separate project. Its prior
selection, 15 events, revision-1 candidates and two final outputs are preserved.
Source and generated project files remain outside the source-code repository.

## Limits

This is the FFmpeg-backed browser workspace, not the native upstream NLE. Timeline
editing uses buttons/ranges/proposals; there are no native timeline drag gestures,
waveforms, keyframes or generative media. File import currently uses a local path.
Long previews have a busy status without a detailed percentage. The real 19m49s
podcast render is intentionally pending the user's preview/final clicks. Local
ASR captions still need wording review. External providers were not exercised.

## Normal runtime promotion

The idle previous launcher was stopped, and `opencut-studio` started the normal
workspace on ports 3320/5273 with version 0.11.0. Fresh browser checks loaded the
project library, reopened the original three-clip review (two existing finals),
and opened the separate complete-video project with its 357 caption passages.
Verification-only library cards were archived with their local test artifacts;
the real main project and linked original clip review remain in the library.
