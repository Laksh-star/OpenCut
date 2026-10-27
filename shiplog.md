# Shiplog

Development record for the local-first OpenCut agent workflow. Dates use Asia/Kolkata.
The July entries were reconstructed on 26 October 2026 from the feature branch's Git
history and `project-report.md`. Commit dates establish implementation history;
historical runtime validation is only reported where separately recorded.

## 2026-07-14 — Agent bridge and first review workspace

- Added the workspace-restricted MCP bridge, declarative edit plans, media inspection,
  and FFmpeg adapter (`1862367c`).
- Added the visual agent-plan review workspace (`4689a2ed`).

## 2026-07-15 — Approval to local rendering

- Connected explicit plan approval to local rendering and project records (`8d781ed0`).

## 2026-07-16 — Playback and candidate sessions

- Added interactive source playback and clip navigation (`1344a508`).
- Added isolated candidate plans, selection, and saved review sessions (`b8198fce`).

## 2026-07-17 — Revision and production foundation

- Added immutable revisions and separate preview/final approval gates (`e637970f`).
- Added backward-compatible multitrack v2 plans and workspace setup packaging
  (`35d65275`).
- Added overlays, audio mixing/ducking, transitions, styled captions, title cards,
  batch review, and production controls (`c5e7fac9`, `d2ca729e`).

## 2026-07-18 — Preflight and export handoff

- Added eligibility checks and local export packages (`ad2f3319`).

## 2026-07-19 — Upstream maintenance record

- Updated the project report after the upstream rebase (`9cbf5193`). The subsequent
  feature branch shares upstream base `5e0696bc` from 17 July.

## 2026-07-22 — Review clarity, visual controls, and caption workflow

- Added candidate strategies/rationales and visible workflow guidance (`a8a25e70`).
- Added direct manipulation of existing visual layers (`e7c01e53`).
- Added subtitle-provider selection and execution (`b32ce2db`, `6599e6b4`).
- Added provider readiness and revisioned caption QA (`4cb4df6a`).
- The project report records test, render, and browser checks for this stage. These
  are historical records, not a fresh verification of external providers.

## 2026-08-31 — Upstream RFC revision

- Refined the separate agent-bridge RFC after review feedback (`e50aee0c`, on
  `codex/upstream-agent-bridge-rfc`). This did not update the runtime implementation.

## 2026-10-26 — Maintenance and transcript editing (bridge 0.10.0)

- Compared CapCut announcements with upstream and the fork. Before this pass,
  refreshed upstream was 15 commits ahead of our shared base; the fork had 16
  implementation commits. Baseline: 41 bridge tests, 13 web tests, and bridge
  typechecking passed.
- Merged upstream `e6680107` into the isolated integration branch. Preserved the full
  review home route while adopting desktop/tooling/media-build foundations. Kept
  our FFmpeg CLI renderer; upstream shared libraries are not a CLI replacement.
- Added this retrospective shiplog and repository instructions requiring updates
  during future development passes.
- Added transcript seeking and whole-cue keep/remove proposals, standalone filler
  suggestions, local audio pause analysis, and protected passages for each proposal.
- Added local commands for shortening to a duration, keeping/removing selected text,
  and moving the selected clip first. Each proposal shows retained ranges and
  production/caption effects before a separate save action.
- Retimed captions, overlays, audio and titles with edited footage. Crossfades become
  midpoint hard cuts with a warning; partially cut cues are omitted and flagged for
  regeneration. Original caption assets remain unchanged.
- Added restoration of the previous saved plan/caption snapshot as a new revision.
  All saved changes invalidate stale previews. Added revision/hash checks,
  manifest-level edit locks, serialized metadata writes, and render reservation
  checks so competing browser views cannot silently overwrite or approve stale work.
- Made dependency directories independent per checkout, pinned the tested web
  versions and Bun lockfile, and made launchers prefer local Bun 1.3.11. Added a
  maintained plan-validation runner. Repaired the workspace wrapper's stale checkout
  lookup; it now supports `OPENCUT_REPO_ROOT` separately from the media workspace.
- Fixed the initial sample-caption request that ran before a saved session loaded.
- Validation: 59 bridge tests and 17 web tests; both TypeScript checks and both
  production builds. Passed MCP, render, approval, multitrack production, review/
  batch/export, and new edited-plan HTTP smoke checks using generated media.
- Browser checks covered seeking, filler suggestions, keep/remove, protected
  shortening, clip reordering, save/restore, local pause detection, and the separate
  preview/final gate. A four-second edited preview contained H.264, AAC and a
  selectable subtitle stream; frames confirmed caption retiming.
- Both existing July review manifests passed read-only validation against their
  original `/Users/ln-mini` workspace root (three v1 and three v2 candidates).
  Existing project media and rendered deliverables were not modified.
- Delivery branch: `codex/agent-bridge-mvp`, on the user fork. This is a local feature
  version, not a public GitHub release or native Editor API integration. External
  transcription providers and the upstream native desktop shell were not exercised.
- Promoted implementation `5c8d8178` into the normal `.opencut-runtime` checkout
  and pushed it to `origin/codex/agent-bridge-mvp`. Fresh runtime startup and browser
  loading passed with no console errors or failed local requests. The workspace-root
  `shiplog.md` points to this versioned record.
- Preserved rollback reference `codex/agent-bridge-before-2026-10-26` at `4cb4df6a`.
  The former dependency links are saved under `.opencut-local`; active dependencies
  are independent directories. The disposable integration checkout was removed
  after promotion; its branch and commits remain available in Git.
- Full evidence and remaining limits: [verification/2026-10-26.md](verification/2026-10-26.md).

## 2026-10-26 — Review workflow usability

- Implemented Choose clips → Edit → Review & export with concise clip cards,
  duration/aspect ratio, expandable rationale, and one primary next action.
- Put video and transcript together on desktop, with explicit Source and Edited
  preview modes. Added a visible target-duration control and plain Save changes
  labels. Caption corrections remain separately saved.
- Moved layers, audio, providers, timing, project files and history under Advanced;
  moved cleanup/commands/protection/restore under More editing tools. Batch render
  is a secondary review task; packaging appears after final renders exist.
- Preserved preview/final approval separation, immutable revisions, local media,
  existing production controls and standalone plan import. Unsaved edits block
  switching clips and batch/final approval. Added readiness retry and fixed the
  loading-view hydration mismatch and empty-workspace sample-caption request.
- Tested: 21 web tests and 59 bridge tests; web TypeScript and client/SSR builds.
  Browser checks exercised proposal → save → preview → caption correction → new
  preview → separate final approval → export on generated footage. FFprobe verified
  the 6 s final output with H.264, AAC and selectable subtitles. Desktop/mobile
  layouts were inspected; mobile Advanced remained accessible without page overflow.
  A simulated readiness failure recovered through Retry checks; unsaved timing
  blocked both final and batch actions.
- Existing podcast project preserved: two existing finals, third unrendered clip,
  all revision 1, selected concise-core, and its 15 events unchanged. No podcast
  render or external transcription requested during this pass.
- Updated the user guide. Evidence and limits:
  [verification/2026-10-26-review-ux.md](verification/2026-10-26-review-ux.md).
- Delivered on the existing fork branch `codex/agent-bridge-mvp`; this is a local
  UI update, not a public release or new native-editor feature set.

## 2026-10-26 — Main video projects and editor

- Replaced the empty home with a persistent local project library and implemented
  `/editor?project=<id>` for full-length projects. Existing clip review URLs remain
  supported through the shared review workspace.
- Added a visible main timeline, split at playhead, proposed trim/remove/reorder,
  full transcript editing, media append, image watermarks, ducked music, titles,
  supplied SRT/VTT captions and production-layer removal. Main projects can create
  independent child clip reviews from saved timeline ranges.
- Reused immutable revisions and separate preview/final approval. Added final
  playback/download, editable copies of rendered masters, parent snapshot locks,
  restore across media imports, and stable reopening after a service restart.
- Added full-project rendering up to four hours; oversized finals are blocked
  instead of silently capped at five minutes. Caption sets above 40 cues use a
  single transparent track; removed the old 200-cue burn-in ceiling. Finals publish
  atomically after successful FFmpeg completion; failed jobs do not appear complete.
- Added `opencut-studio`, strict port checks and coupled service shutdown. Updated
  the main editor guide and API/user docs; private bridge version is 0.11.0.
- Validation: 66 bridge + 24 web tests, both typechecks/builds, generated 301 s HTTP
  preview/final/export/download/restart smoke with 201 captions and a PNG watermark,
  and existing editorial/review smokes. Browser exercised import/save/split/reorder,
  child creation, multi-source playback, rich 10 s export and an editable copy.
  Desktop/mobile layouts were inspected; expanded mobile controls had no overflow.
- Prepared a separate 19m49s podcast master with 357 reused local English cues and
  the DB watermark. Rechecked the source hash; preflight passed with zero blockers.
  No external transcription or podcast preview/final render occurred. Existing
  clip selection, revisions, audit events and rendered outputs remain unchanged.
- This is the local FFmpeg-backed main editor. Native timeline gestures, waveforms,
  keyframes, native file picking and detailed long-render progress remain future
  work. See [verification/2026-10-26-main-editor.md](verification/2026-10-26-main-editor.md).

## 2026-10-26 — Documentation alignment for the main workspace

- Reorganized the root README around the delivered project library, main editor,
  clip review, setup/ports, saved-version approvals and current output actions.
- Updated both user guides and the bridge/API reference to the actual 0.11.0 UI,
  data layout, restart behavior, provider consent, import/caption semantics and
  interface-specific render limits. Removed stale current claims about six UI
  steps, a blanket five-minute cap, and the old 200-cue caption ceiling.
- Added a documentation map, current feature/limit matrix and dated local fork
  milestone. Updated the project report with current architecture/evidence and
  explicitly separated its July baseline; historical results were preserved.
- Documented the existing 300 s Shorten target limit and long-master prefill issue,
  with range trimming as the longer-edit path; no runtime fix is claimed here.
- Clarified the separate Rust desktop scaffold and added repository guidance for
  keeping the relevant documents current with future user-visible work.
- Validation for this pass: checked local documentation links/anchors, documented
  command paths, current UI labels and implementation limits against owning source;
  `git diff --check`. No application/media changes or renders; the 90-test and build
  results linked in the documents are the earlier recorded implementation checks,
  not newly rerun tests in this documentation-only pass.


## 2026-10-27 — Long-project and render reliability

- Fixed main Shorten targets above five minutes; main projects now accept up to
  four hours with a valid 90% default. Kept clip targets bounded at 300 seconds.
  Main transcript proposals now support up to 10,000 cues.
- Added durable, manifest-scoped background jobs for single preview/final renders,
  visible encoding progress/elapsed time, phase messages, friendly failure details,
  and Cancel render before publication. Reopening reconnects to active work;
  restarted/interrupted work needs an explicit retry. Revisions and separate
  preview/final approvals remain intact; cancelled encodes remove partial output.
- Added macOS Browse to project/media fields with manual path fallback, root
  validation and one-dialog concurrency. Choosing only fills the path; Create/Add
  is still explicit. No file copy or upload occurs. A real native popup opened
  during testing; the user clicked it accidentally, and no unintended project was
  created. Further OS popup testing was stopped; native selection automation remains
  a verification limitation.
- Validation: 75 bridge + 30 web tests, both typechecks/builds, new background-job
  HTTP smoke and existing main/editorial/review smokes. Browser exercised live
  render → reload → cancel, mobile status layout without overflow, controlled
  Browse → Create, and generated 20-minute → 18-minute proposal/save. The test
  harness's eager rejection assertion was corrected; cancellation itself passed.
- Updated README, current feature matrix, main/clip guides, API reference,
  documentation map and project report. Private bridge version is 0.12.0.
- Batch progress/cancellation, native timeline dragging/waveforms/keyframes and
  semantic caption repair remain outstanding. Dated evidence:
  [reliability verification](verification/2026-10-27-reliability.md).
- Runtime delivery: restarted the idle normal studio on 3320/5273; health reports
  0.12.0 and the actual podcast main link reopens. Main/clip manifest hashes match
  the pre-restart values exactly (master r1/events 0; clip events 15 and original
  rendered selections). No podcast edit, render or external upload occurred.

## 2026-10-27 — Script-to-cut feasibility and plan

- Assessed assembling supplied scripts with images, narration/audio and video.
  The current v2 renderer supplies most composition primitives, but project creation
  requires a video and there is no script/storyboard-to-asset/timing workflow.
- Identified a specific audio gap: music ducking currently keys off primary video
  speech; separate narration needs inclusion in the speech bus.
- Added the proposed [script-to-cut plan](plans/script-to-cut.md), covering
  image-led composition, scene/asset mapping, supplied-narration timing, manual
  corrections/locks, revision preservation, local processing and separate render
  approvals. Linked it as proposed work in the documentation map.
- Recommended controlled storyboard assembly first, then assisted matching and
  alignment. Voice generation, stock search, generative assets and complex motion
  graphics are deferred.
- Verification: inspected owning schema, compiler, project/import, preflight and
  UI media helpers; checked documentation links and whitespace. Planning only:
  no application implementation, dependency changes, uploads or media renders;
  application tests were not rerun. Version remains 0.12.0.
