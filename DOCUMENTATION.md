# Documentation map

Current behavior is documented for the local fork's bridge **0.12.0** as of
27 October 2026. Start with the guide for your task; dated evidence/history is
separate from current operating instructions.

| Document | Purpose |
| --- | --- |
| [README](README.md) | Current scope, dependency setup, launcher, default/local ports and workflow choices |
| [Main editor guide](apps/agent-bridge/MAIN_EDITOR_GUIDE.md) | Full-video project creation, editing, media, child clips, export and reopening |
| [Clip review guide](apps/agent-bridge/USER_GUIDE.md) | Three-stage review, proposals, captions, batches, output and recovery |
| [Features and limits](FEATURES.md) | Main versus clip behavior, retiming semantics, request limits and remaining work |
| [Bridge reference](apps/agent-bridge/README.md) | MCP/HTTP API, storage, setup, privacy, contracts and developer checks |
| [Project report](project-report.md) | Current architecture overview plus explicitly dated July report |
| [Shiplog](shiplog.md) | Maintained record of implementation, validation and delivery |
| [Desktop README](apps/desktop/README.md) | Separate upstream Rust desktop scaffold; not the browser studio launcher |

## Proposed development

- [Agentic script-to-cut plan](plans/script-to-cut.md): agent-led inspection, scene
  planning, draft assembly, conversational revision and acceptance checks. Proposed,
  not implemented.

## Product comparisons

- [Script-to-cut benchmark preparation — 30 October 2026](research/script-to-cut-benchmark-v1-2026-10-30.md):
  generated input pack, fixed brief, revision challenges and scoring. Product runs
  remain unscored; Kino was not installed or connected.
- [Kino.ai comparison — 30 October 2026](research/kino-comparison-2026-10-30.md):
  official documented features versus our implemented 0.12.0 fork and separately
  identified plans. Research only; no Kino runtime trial.

## Evidence and milestones

- [0.12.0 local fork milestone](changelog/0.12.0.md): render reliability, long
  Shorten targets and local media selection.

- [Reliability and local picking verification](verification/2026-10-27-reliability.md):
  long-master shortening, background jobs, progress/cancellation, recovery and picker checks.

- [0.11.0 local fork milestone](changelog/0.11.0.md): delivered main-editor and
  review-workspace changes; this is not a public upstream release announcement.
- [Main editor verification](verification/2026-10-26-main-editor.md): 66 bridge and
  24 web tests, full-project render/download/restart checks and browser evidence.
- [Review UI verification](verification/2026-10-26-review-ux.md): three-stage flow,
  desktop/mobile behavior and separate preview/final approval.
- [Transcript/integration verification](verification/2026-10-26.md): upstream
  integration, revision/provenance tests and preservation of previous work.

Earlier changelog entries and the July report are historical records. Their UI
labels, test totals and limits are not current instructions. Each dated verification
record states the checks actually performed in that pass.

## Keeping this accurate

When behavior changes, update the relevant guide, feature/limit reference and API
contract together. Record actual validation and limitations in the shiplog. Keep
past verification results dated; add new evidence instead of rewriting history.
