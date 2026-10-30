# Reliability and local picking — 27 October 2026

Private fork bridge 0.12.0 on `codex/agent-bridge-mvp`. Generated media only for
editing/rendering tests; the user podcast was inspected read-only.

## Implemented

- Main Shorten targets up to 14,400 seconds, with a valid 90% default. Clips retain
  their 300-second target limit. Main transcript proposals handle up to 10,000 cues.
- Single saved-session preview/final background jobs: preparation/encoding phase,
  elapsed time, FFmpeg encoding percentage, cancellation and useful errors/details.
- Manifest-scoped durable job history; reopening reconnects to an active job.
  Restart recovery requires an explicit retry. No auto-render on reopening.
- Native macOS Browse for project source and media. Picking only fills the path;
  explicit Create/Add remains necessary. Real paths remain inside the media root.

## Automated checks actually run

- 75 bridge tests, 30 web tests; both TypeScript checks and production builds pass.
- New `smoke:jobs`: generated HD video received live 18.17% encoding progress;
  fresh session observed the same job; wrong cancellation token returned 403;
  cancellation preserved revision 1, published no preview/final and removed partial
  output. Retry completed, final needed a separate action, and download returned
  HTTP 206. A normal stop/restart left the second render failed and retryable.
- Unit checkpoint recovery marked a stale in-progress job interrupted; another
  manifest could neither see nor cancel an active job. Publication blocks cancel.
  A new project with no history returns an empty list. Disk-space failure exposes
  an actionable message while retaining diagnostics.
- Long-master test: generated 1,200-second source/600 cues proposed 1,080 seconds,
  retained 540 cues, and saved a new revision only on apply. Clip targets above
  300 seconds remain blocked.
- Existing main-project smoke: full 301-second preview/final with 201 captions,
  PNG watermark and title, h264/aac/mov_text, range download, child isolation,
  package and restart/recovery passed. Existing editorial and review smokes pass.
- Picker tests: paths containing spaces/apostrophe/Unicode, cancellation, root
  rejection and one-dialog concurrency; web Browse selection with a controlled
  response, explicit create, manual fallback and error states. The native
  AppleScript compiled successfully; a real chooser opened. The user reported
  accidentally clicking that popup. No unexpected project was created. Native
  selection was not fully driven/verified by computer automation; do not count
  the controlled browser response as a completed native OS selection test.

## Browser checks

Isolated bridge/web ports 3332/5284 and generated-only media root under Downloads.

- Browse response filled the path and explicit Create opened a main project.
- Live encoding reached 13%; refreshing reconnected; visible Cancel render stopped
  the job at 35% and displayed “Your saved edit is unchanged.”
- A generated 20-minute master defaulted to 1,080 seconds. Shorten displayed the
  1,200 → 1,080 proposal, then Save changes created version 2 and an 18-minute
  timeline. No preview/final was requested for this long test project.
- Desktop and 390px mobile render-status layouts inspected; no horizontal overflow.
  Evidence screenshots are local outside the source checkout:
  `capcut/.playwright-mcp/reliability-cancel-desktop.png` and
  `capcut/.playwright-mcp/reliability-cancel-mobile.png`.
- Console contained only React development-tool information; no runtime errors.

## Limits

Encoding percent describes FFmpeg output time, not whole-pipeline ETA. Preparation
can take time before a percentage appears. Cancel is disabled during publication.
Batch rendering retains its existing queue without the new progress/cancel panel.
Direct MCP renders and legacy encoded-plan links retain their prior workflow.
Browse requires an interactive macOS session; manual path entry remains available.
A force-killed service cannot perform graceful cleanup; checkpoint recovery does
not resume/retry automatically. Tests used normal shutdown plus a stale checkpoint,
not a destructive OS crash. No external transcription upload occurred.

## Runtime delivery checkpoint

Restarted the idle normal studio on ports 3320/5273; `/health` reports 0.12.0 and
`rendering: false`. The stable podcast main-project link reopened successfully.
Before/after SHA-256 checks of the real main and clip manifests match exactly:
main is revision 1 with zero events/no requested preview/final; clip review has
15 events, concise-core selected and two existing rendered outputs. Neither
project was edited or rendered in this pass. Isolated test data remains in its
separate root; no test entries were added to the user's normal project library.
