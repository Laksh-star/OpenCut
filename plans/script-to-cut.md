# Agentic script-to-cut workflow plan

27 October 2026 · Revised for agent-led operation · Proposed, not implemented
Baseline: private fork 0.12.0.

## Recommendation

Build this capability. It complements the existing recording-to-clips workflow:
the script supplies the story, while supplied images, narration, music and video
supply the production material. It is useful for explainers, training, product
demos and narrated presentations. Most rendering and review infrastructure exists;
the new work is scene planning, asset assignment, timing and an understandable UI.

The agent must own the first pass: understand the brief, inspect assets, break the
script into scenes, choose media and timings, compile a draft, check it and revise
it. An editable storyboard is the agent's visible working artifact and correction
surface. The user should not have to assign every asset or build the sequence
before the agent can help. Semantic planning and tool use belong in the first
usable milestone; deterministic validation and compilation constrain execution.

Success means a useful editable draft with explained choices and visible gaps.
The agent should act autonomously on reversible draft work within the supplied
brief, respect locked decisions, and ask concise questions when a consequential
choice cannot be resolved from the supplied material.

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

## Intended agent-led experience

The user supplies a script and an explicit local asset pack, then gives a brief:

> Make a 90-second explainer from this script and these assets. Use my recorded
> narration, keep the product names unchanged, use the demo for the walkthrough,
> add the supplied logo and clean captions, and keep the music quiet.

The flow is **Brief → Agent prepares draft → Review and direct revisions →
Preview → Final approval**. It uses the current external-agent/MCP integration
first, with progress and scene review in the existing workspace. An embedded chat
entry can use the same tool contract later; it does not require a separate editor.

The agent:

1. Reads the script and constraints, inventories only explicitly supplied assets,
   probes streams/duration/dimensions, and identifies narration, music, dialogue,
   images and video. It resolves obvious choices without a questionnaire.
2. Builds an evidence-backed understanding of assets using available local
   transcripts, thumbnails/content inspection and user descriptions. It records
   what was actually inspected; a filename alone does not prove visual relevance.
3. Splits the script into scenes, chooses media and source ranges, proposes timing
   against actual narration, and identifies any script/audio or coverage mismatch.
4. Produces and saves a versioned draft storyboard and compiled edit plan, with
   scene-to-script links, reasons for asset choices, locks and unresolved gaps.
5. Runs preflight and plan-quality checks. It repairs recoverable draft errors
   within a bounded loop, or asks one focused question with concrete alternatives.
6. Presents the proposed cut with short reasons and warnings. The user can say
   “replace scene 3 with the factory footage,” “make the opening faster,” or
   “keep the narration and closing exactly as they are.” Scene-card controls are
   an optional way to give the same directions, not a prerequisite for assembly.
7. Applies the requested change through validated scene operations, preserving
   locks and unaffected scenes. It saves a new revision and describes the diff.
8. Waits for the existing explicit preview action. After the user starts it, the
   agent can observe progress and inspect the resulting preview for timing,
   silence, missing visuals and caption/audio issues, then report or propose fixes.
   A changed draft needs a fresh preview. Final rendering and publishing retain
   their separate human actions.

Progress is concrete: “Inspected 12 assets,” “Mapped 8 scenes,” “Two passages need
visuals,” or “Draft saved; ready for preview.” Do not expose hidden reasoning.
Show asset/time references and short editorial reasons instead.

Example:

| Scene | Script passage | Supplied visual | Sound | Timing |
| --- | --- | --- | --- | --- |
| Opening | “Here is how our service works.” | `intro.png` | Provided narration | Narration 0–6 s |
| Demonstration | “First, submit your request.” | `demo.mp4`, source 12–20 s | Narration; demo audio muted by choice | Narration 6–14 s |
| Close | “Contact our team to get started.” | `team.jpg` plus logo | Narration and quiet music | Narration 14–21 s |

These times illustrate the planned storyboard, not measured alignment.

## Timing and editorial rules

- **Narration-led:** supplied narration determines duration. The agent uses supplied
  timed markers/SRT/VTT or available local speech timing, then maps script passages
  to it. Without reliable alignment it proposes estimated boundaries, labels their
  uncertainty and asks for correction only where needed. Do not call normalized
  caption timestamps forced alignment or invent word-level certainty.
- **Scene-led:** the agent proposes scene durations and source ranges from the
  brief and content, with user overrides. Without narration, script passages become
  on-screen text/editorial instructions; they do not become spoken audio automatically.
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

## Agent architecture and execution contract

Extend the established local bridge and external-agent integration. Do not scaffold
an unrelated agent framework or require a cloud migration for this existing stack.
Keep planning/model access separate from the deterministic media executor. The
initial host is the existing agent client; an app-hosted conversation can be added
behind the same operations after selecting an explicit model/privacy arrangement.

Proposed typed operations (new work, not existing tool claims):

| Operation | Contract |
| --- | --- |
| Inspect asset pack | Allowed paths only; return IDs, hashes, stream metadata, selected thumbnails and available transcripts |
| Read/create assembly run | Persist brief, constraints, asset index and progress/checkpoint state |
| Propose storyboard | Structured scenes with script spans, selected asset/time ranges, rationale, confidence and gaps |
| Compile/validate draft | Deterministically validate scene schema and locks, media coverage, timing, audio and captions; produce v2 plan/preflight findings |
| Save/apply scene patch | Expected revision/hash required; replace, trim, reorder or lock through typed operations; persist storyboard and plan together |
| Read job/preview evidence | Observe approved render jobs and inspect an existing preview without starting a new render |
| Resume/cancel assembly | Resume from the last durable checkpoint or stop planning/media-analysis work without discarding saved revisions |

The model proposes structured operations rather than arbitrary FFmpeg or shell
commands. The trusted executor validates paths, ranges, locks and expected
revisions before acting. Tool results and script/media text are data, not authority
to change the brief, expand the asset scope, upload or approve renders.

Persist `assembly-run.json` alongside versioned project artifacts. It records
run ID, brief/constraint versions, asset references/hashes, completed stages,
proposal/plan revision, concise observations, pending questions and recoverable
errors. Do not store credentials or hidden chain-of-thought. Runs may be
inspecting, planning, validating, awaiting-input, ready-for-review, failed or
cancelled. Rendering remains a separate existing job with a separate approval.

On resume, revalidate asset hashes and the current project revision. Do not repeat
completed expensive analysis unnecessarily, replay saves/renders, or overwrite a
newer manual revision. Cache inspection by content hash and tool/version. Bound
analysis time, model/tool calls and draft-repair attempts; a failed bound surfaces
an actionable checkpoint instead of an endless loop. Start with one orchestrating
agent; specialist subagents are not required for the first implementation.

Autonomy boundaries:

- Automatically inspect authorized inputs, propose editorial choices, compile,
  validate and save unapproved draft revisions within the brief.
- Ask when required material is missing, narration and script conflict, a lock
  prevents the requested duration, or an external provider/data upload is needed.
  Bundle related questions and offer concrete alternatives; do not ask per file.
- Keep script wording by default. If a requested target is shorter than the supplied
  narration, propose passages to omit and show that effect; do not silently speed
  up or rewrite speech to claim the target was satisfied.
- Respect source files, explicit locks, revision conflicts and the existing visible
  preview/final approval flow. A general “assemble a cut” instruction does not
  silently approve external uploads or publication.

## Delivery sequence

### 1. Prove the composition executor

Use generated fixtures: two images, one video, separate narration, background music
and a logo. Confirm image-led creation, video trims, voiceover offsets, narration
ducking, scene boundaries, captions and output duration through the existing
preview/final path. Fix only proven compiler/project gaps.

**Exit:** a mixed 60–90 second composition and an images-plus-narration composition
work without a starting user video; a video-led project still works unchanged.
This is an internal dependency, not a manual storyboard product release.

### 2. Deliver an agent-led first-cut vertical slice

Implement script/asset ingestion, local inspection tools, durable assembly runs,
model-proposed scene/asset/timing choices, schema validation, bounded draft repair,
deterministic compilation and revisioned save. Expose the path through the current
agent/MCP workflow with scene review in the existing workspace. Start with
TXT/Markdown, PNG/JPEG/WebP and already-supported audio/video formats. Keep
PDF/DOCX ingestion for a later adapter.

**Exit:** given a script, asset pack and brief, the agent produces the first
reviewable draft without the user constructing its scene mapping. Missing material
or weak timing evidence produces labelled gaps or a focused question. The project
opens, saves and reopens; existing preview/final controls remain usable.

### 3. Deliver conversational revision and quality checks

Support instructions such as “replace scene 3,” “make the first ten seconds more
visual,” and “keep narration unchanged.” Show affected scenes and duration changes,
preserve locked/manual work, and reject stale patches. Add rendered-preview checks
after explicit preview initiation and evidence-backed retry suggestions. Improve
local alignment/asset understanding based on measured failures, not filename guesses.

**Exit:** the agent changes only the requested scope, explains its diff, resumes
after interruption, and does not auto-render or re-approve a revised cut. Manual
scene controls remain available as precise overrides.

### 4. Evaluate on a real production

Use an explicitly supplied script and asset pack after fixture checks. Compare the
result with the script and audio, record first-draft coverage, correction effort,
poor matches and timing failures, inspect caption/crop/audio quality, and close the
production only after the user performs the separate preview/final actions.

**Exit:** no missing scenes or accidental narration truncation; every script passage
has a scene association or a clearly accepted exclusion; result reopens and exports.

The recommended first implementation pass is steps 1–3 as one small end-to-end
agent workflow. Asset matching and conversation are core behavior from the start;
advanced multimodal ranking and alignment quality can improve in later passes.

## Verification required during implementation

- Unit checks for compilation, locked timing, invalid ranges, stale mappings and
  revision/provenance associations; source script/assets remain unchanged.
- Generated-media checks for image-only visuals, video-only visuals, mixed scenes,
  silent source video, long narration, short visuals, missing assets and failed
  renders. Measure scene/output timing and inspect representative boundary frames.
- Audio checks demonstrate that music attenuates during separate narration and
  recovers during pauses, and original dialogue is retained when selected.
- Agent evaluations: first draft from an unmapped asset pack; truthful asset/time
  references; focused missing-asset questions; narration mismatch; lock-preserving
  instructions; stale-patch rejection; bounded repair; checkpoint resume without
  duplicate saves; no render/upload action without its required authorization.
- Browser/agent flow from brief/assets to generated storyboard/save/reopen, explicit preview,
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
simple media addition and feature documentation on 27 October. This pass added/revised a
plan only; no application tests were rerun and no composition was rendered. The
agent-led revision supersedes the original manual-first delivery sequence.
