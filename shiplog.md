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
