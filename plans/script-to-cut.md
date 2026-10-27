# Script-to-cut assembly plan

27 October 2026 · Proposed, not implemented · Baseline: private fork 0.12.0.

## Recommendation

Build this capability. It complements the existing recording-to-clips workflow:
the script supplies the story, while supplied images, narration, music and video
supply the production material. It is useful for explainers, training, product
demos and narrated presentations. Most rendering and review infrastructure exists;
the new work is scene planning, asset assignment, timing and an understandable UI.

Start with an explicit, editable storyboard and deterministic assembly. Automatic
asset matching and speech alignment can improve that foundation afterward. Success
means a useful editable rough cut with visible unresolved decisions, not an
unreviewed promise of a finished film.

This is a planning deliverable. No application changes, media processing, uploads
or renders are authorized by this document alone.

## What exists today

Inspected the current owning implementation, rather than relying on roadmap labels:

| Capability | Current state and implication |
| --- | --- |
| Video assembly | V2 plans sequence clips with source ranges, speed and original audio controls. Reuse the compiler. |
| Still images | FFmpeg input handling loops PNG/JPEG/WebP for a specified duration; overlays already accept images. Primary image scenes need integration/render coverage and project/UI support. |
| Independent audio | V2 audio tracks support voiceover, music and effects roles with timeline offsets. The simple UI currently exposes added audio as music. |
| Speech ducking | Music ducking uses primary-video audio as its speech key. A separate voiceover needs to participate in the speech bus. |
| Finishing | Titles, captions, transitions, overlays, brand watermark, render progress, revisions and export are reusable. |
| Starting a project | `createWorkspaceProject` requires a moving video. A script/images/audio project has no first-class entry point. |
| Script/storyboard | No script ingestion, scene model, script/audio matching or script-to-asset assignment workflow exists. |
| Agent preparation | An agent can author a structured plan for supplied assets today, but this is custom preparation rather than an integrated script-to-cut product flow. |

Owning sources:

- [Timeline schema](../apps/agent-bridge/src/schema.ts)
- [FFmpeg composition and audio mixing](../apps/agent-bridge/src/ffmpeg.ts)
- [Project creation/import](../apps/agent-bridge/src/workspace-projects.ts)
- [Simple media additions](../apps/web/src/lib/project-editing.ts)
- [Existing review workspace](../apps/web/src/components/review-workspace.tsx)

## Intended experience

Projects home gains **Create from script & assets**, alongside the current video
entry point. The existing editor gains a scene/storyboard view for these projects;
review and export stay in the existing workspace.

1. Paste a script or import UTF-8 TXT/Markdown. Preserve the supplied wording.
2. Select local images, video, narration and optional music; assign descriptive
   labels and roles. Inspect only explicitly selected assets, not a disk scan.
3. Choose aspect ratio and timing mode, then generate an editable storyboard.
4. Review scene cards: script passage, visual, source in/out, timing, audio role,
   caption/title treatment and any unresolved issue.
5. Replace, trim, reorder or lock a scene; review the proposed changes and save a
   new revision. Apply a restrained brand/caption preset if desired.
6. Explicitly render an edited preview, inspect it, then separately approve final.

Example:

| Scene | Script passage | Supplied visual | Sound | Timing |
| --- | --- | --- | --- | --- |
| Opening | “Here is how our service works.” | `intro.png` | Provided narration | Narration 0–6 s |
| Demonstration | “First, submit your request.” | `demo.mp4`, source 12–20 s | Narration; demo audio muted by choice | Narration 6–14 s |
| Close | “Contact our team to get started.” | `team.jpg` plus logo | Narration and quiet music | Narration 14–21 s |

These times illustrate the planned storyboard, not measured alignment.

## Timing and editorial rules

- **Narration-led:** supplied narration determines duration. First support timed
  scene markers/SRT/VTT or manually confirmed scene boundaries. Untimed script
  allocation may be suggested but must be labelled estimated until reviewed.
- **Scene-led:** user sets scene durations or selected video ranges. Without
  narration, script passages become on-screen text/editorial instructions; they
  do not become spoken audio automatically.
- **Mixed audio:** per-scene control chooses original video speech, voiceover,
  music or a deliberate mix. Default narration-led visual clips to muted audio,
  with the choice visible. Do not mute dialogue globally in mixed projects.
- Do not stretch speech, loop video, freeze a final frame, crop important content,
  shorten supplied wording or invent missing assets silently. Offer explicit
  alternatives when a visual is too short or narration differs from the script.
- Captions reflect actual speech and its timings. On-screen script text is a
  separate layer; the script alone is not proof of what was recorded.
- Replacing a visual preserves locked scene/narration boundaries. Reordering or
  trimming speech requires a timing/caption proposal and a fresh preview.
- Unassigned assets, unknown source ranges and unresolved narration gaps remain
  visible. An optional placeholder preview must be labelled; unresolved gaps block
  final approval until resolved or explicitly accepted as a deliberate title/blank
  scene. No unrelated file or generated asset is substituted automatically.

## Technical design

Store a versioned storyboard alongside the existing project, with stable scene and
asset IDs. Each scene records script text, visual references/source ranges,
timeline placement, audio selections, caption/title choices, timing confidence,
locks and warnings. Store script and storyboard snapshots with the corresponding
plan revision; identify the compiled plan hash so mappings cannot silently drift.

Use a deterministic storyboard-to-v2-plan compiler, retaining the current FFmpeg
adapter, path restrictions and preview/final contracts. Add composition creation
that does not require the user to supply a dummy video. Validate primary image
scenes first; prefer additive metadata/project changes over a schema rewrite.
If a neutral canvas asset is required internally, manage it explicitly inside the
project and record its provenance rather than requiring a fake source file.

Build a speech bus from enabled original dialogue and selected voiceover tracks;
duck music against that bus while keeping effects and dialogue independently
controllable. Avoid counting narration twice in the final mix.

Compilation validates actual asset duration/streams, scene coverage, subtitle
timing and total duration. Store relative associations through stable IDs and
retain the current workspace-root checks. Editing a compiled timeline through
existing low-level controls must either update its scene mapping or mark the
storyboard out of sync and require reconciliation before regeneration. Never
overwrite subsequent manual edits on regeneration.

Metadata inspection and assembly are local. Local transcription is preferred when
available. External transcription, visual analysis or generation needs an explicit
provider/data upload decision. Missing local alignment is a supported manual path,
not a reason to upload automatically.

## Delivery sequence

### 1. Prove composition support

Use generated fixtures: two images, one video, separate narration, background music
and a logo. Confirm image-led creation, video trims, voiceover offsets, narration
ducking, scene boundaries, captions and output duration through the existing
preview/final path. Fix only proven compiler/project gaps.

**Exit:** a mixed 60–90 second composition and an images-plus-narration composition
work without a starting user video; a video-led project still works unchanged.

### 2. Deliver the controlled first-cut workflow

Implement project creation from script/assets, explicit scene splitting, asset-role
assignment, timed/manual narration mapping, deterministic compilation, scene cards,
replacement/reorder/trim/locks, and revisioned save. Start with TXT/Markdown and
PNG/JPEG/WebP plus already-supported audio/video formats; keep PDF/DOCX ingestion
for a later adapter. Reuse the current main review/export controls.

**Exit:** a user can create a cut from the supplied script and mixed assets, replace
one visual without changing narration, save, reopen, preview and export without
editing JSON. No semantic model is required to complete this path.

### 3. Add assisted matching and alignment

Offer scene suggestions from headings/paragraphs, asset descriptions/labels and
local media transcripts. Evaluate local speech alignment against the actual
narration and flag omitted/extra wording and uncertain boundaries. Keep the manual
path. Asset filename matches alone are suggestions, never confident scene matches.
Visual-content analysis is optional and separately configured.

**Exit:** suggestions explain the asset and time range selected, uncertain choices
are easy to correct, and regeneration preserves locked scenes/manual edits.

### 4. Evaluate on a real production

Use an explicitly supplied script and asset pack after fixture checks. Compare the
result with the script and audio, record correction effort and timing failures,
inspect caption/crop/audio quality, and close the first production only after the
user performs the separate preview/final review actions.

**Exit:** no missing scenes or accidental narration truncation; every script passage
has a scene association or a clearly accepted exclusion; result reopens and exports.

The recommended first implementation pass is steps 1–2. Step 3 is a separate quality
milestone; do not hide its uncertainty inside the initial assembly feature.

## Verification required during implementation

- Unit checks for compilation, locked timing, invalid ranges, stale mappings and
  revision/provenance associations; source script/assets remain unchanged.
- Generated-media checks for image-only visuals, video-only visuals, mixed scenes,
  silent source video, long narration, short visuals, missing assets and failed
  renders. Measure scene/output timing and inspect representative boundary frames.
- Audio checks demonstrate that music attenuates during separate narration and
  recovers during pauses, and original dialogue is retained when selected.
- Browser flow from script/assets to storyboard/save/reopen, explicit preview,
  separate final approval, cancellation and export; check desktop/mobile layout.
- Regression checks for existing v1/v2 clip reviews and main projects. No migration
  or render of existing user projects as part of fixture testing.

Update FEATURES, relevant user/API guides and shiplog when each stage is actually
implemented and verified. Do not change current capability/version claims merely
because this plan has been saved.

## Deferred

Voice generation/cloning, stock-media search, generative B-roll, complex motion
graphics, automatic smart reframing and native-editor integration. Simple static
images, deliberate cuts/transitions and clear voiceover are sufficient for the MVP.

## Planning verification

Inspected current schema, FFmpeg input/mixing logic, project creation, preflight,
simple media addition and feature documentation on 27 October. This pass added a
plan only; no application tests were rerun and no composition was rendered.
