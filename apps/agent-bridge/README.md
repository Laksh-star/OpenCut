# OpenCut local bridge reference

Fork bridge **0.12.0** (private package) · current behavior, 27 October 2026.

The bridge backs the browser main editor and clip-review workflow with local
files, declarative v1/v2 edit plans, immutable revisions, FFmpeg rendering and
explicit human approval. It also exposes 14 MCP tools. The main-project library
and editorial proposal routes are HTTP capabilities, not extra MCP tools.

Start with the [main editor guide](MAIN_EDITOR_GUIDE.md),
[clip review guide](USER_GUIDE.md), or [feature/limit reference](../../FEATURES.md).
This adapter is separate from the future upstream native Editor API/Rust editor.

## Setup and launch

Run from the source checkout. Use independent dependencies per checkout/worktree.
Bun 1.3.11 is pinned in [the tool manifest](../../.prototools); FFmpeg and ffprobe
must be on PATH. See the [root setup](../../README.md#start-the-workspace) for installs.

| Command | Purpose |
| --- | --- |
| `opencut-studio` | Start the HTTP bridge and browser projects home |
| `opencut-review <manifest>` | Start both services and register a prepared clip review |
| `opencut-agent-http` | Run only the loopback HTTP bridge |
| `opencut-agent` | Run the stdio MCP server |
| `opencut-setup --root <folder>` | Generate local environment/configuration snippets |
| `opencut-plan` | Validate/save/compile a supplied plan; not a render approval |

These executables are under `apps/agent-bridge/bin/`. Example:

```sh
OPENCUT_AGENT_ROOT="/absolute/path/to/media-folder" \
  apps/agent-bridge/bin/opencut-studio
```

The launcher defaults to app **5173** and bridge **3210**, sets the matching browser
origin, rejects occupied ports, and stops both services together. The configured
local workspace uses app **5273** and bridge **3320**:

```sh
OPENCUT_AGENT_ROOT="$HOME/Downloads" \
OPENCUT_WEB_PORT=5273 OPENCUT_AGENT_HTTP_PORT=3320 \
  apps/agent-bridge/bin/opencut-studio
```

Do not start another launcher on an occupied pair. Keep an existing workspace open
or stop its idle launcher normally before changing configuration.

When running HTTP and Vite separately, configure `VITE_OPENCUT_BRIDGE_URL` on the
web process and `OPENCUT_WEB_ORIGINS` on the bridge. The bridge binds only to
127.0.0.1, with default allowed origins `http://localhost:5173` and
`http://127.0.0.1:5173`. `OPENCUT_WEB_ORIGINS` is a comma-separated allowlist.

## Environment and providers

| Variable | Meaning |
| --- | --- |
| `OPENCUT_AGENT_ROOT` | Existing media/output root; every resolved input/output must remain inside it |
| `OPENCUT_AGENT_HTTP_PORT` | Bridge port; default 3210 |
| `OPENCUT_WEB_PORT` | Combined launcher app port; default 5173 |
| `OPENCUT_WEB_ORIGINS` | Allowed browser origins; the combined launcher supplies its app origin |
| `VITE_OPENCUT_BRIDGE_URL` | Bridge URL for a separately started web process |
| `OPENCUT_BUN` | Explicit launcher runtime override; otherwise prefer checkout-pinned Bun |
| `OPENCUT_LOCAL_WHISPER_COMMAND` / `WHISPER_COMMAND` | Local Whisper executable override; default `whisper` on PATH |
| `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | Optional external transcription credentials |

Local Whisper remains on-device. Provided-caption confirmation reuses local
captions. OpenAI API/OpenRouter generation sends extracted candidate WAV audio
only with explicit upload approval (`externalUploadApproved=true`) and credentials.
No provider runs just because a video is imported or a provider is selected.

The setup command writes `.opencut-agent/opencut.env`, `codex-mcp.toml` and
`setup.json` in the media root. It does not edit global agent configuration.
Set/load environment values into the process that starts the bridge; generating
an environment snippet is not the same as configuring a running provider. Keep
credentials out of source control and documentation.

## MCP tools

- `opencut_capabilities`
- `opencut_inspect_media`
- `opencut_validate_edit_plan`
- `opencut_upgrade_edit_plan`
- `opencut_save_edit_plan`
- `opencut_compile_edit_plan`
- `opencut_render_preview`
- `opencut_build_word_timed_captions`
- `opencut_check_review_system`
- `opencut_generate_review_captions`
- `opencut_revise_review_captions`
- `opencut_preflight_review_session`
- `opencut_approve_and_render_project`
- `opencut_create_export_package`

Connect using a local MCP configuration such as:

```json
{
  "mcpServers": {
    "opencut": {
      "command": "/absolute/path/to/OpenCut/apps/agent-bridge/bin/opencut-agent",
      "env": { "OPENCUT_AGENT_ROOT": "/absolute/path/to/media-folder" }
    }
  }
}
```

For a Codex TOML snippet, use `opencut-setup` and review the generated file before
merging it into your configuration. A standalone stdio server uses:

```sh
OPENCUT_AGENT_ROOT="/absolute/path/to/media-folder" \
  apps/agent-bridge/bin/opencut-agent
```

`opencut_render_preview` defaults to 30 s and accepts up to 300 s. MCP final and
preflight render-limit inputs also stop at 300 s. These direct bounded tool calls
do not imply session preview/final approval. Long full-video projects use the main
editor's HTTP workflow with explicit UI preview and final actions. Check
[operating limits](../../FEATURES.md#operating-limits) before selecting an interface.

## Agent preparation workflow

1. Inspect capabilities and every source. Keep media and generated projects outside
   the code checkout and inside the chosen media root.
2. Prepare a validated v1/v2 plan or separate candidate plans. Multiple highlights
   should be distinct moments by default, with strategy/rationale and source-range
   notes rather than three nearly identical timestamp variants.
3. Prefer supplied/local transcription. Check setup before provider work and obtain
   explicit named-provider consent before external audio upload. Caption files must
   use the output timeline and need wording/timing review.
4. Save isolated plans and register/launch their manifest, or use a persistent main
   project. Keep revision, selection, caption, preview and final decisions separate.
5. For real-media review, leave preview/final/batch actions to the visible reviewer
   controls. Selecting a candidate or approving an external provider is not render
   approval. Generated-media integration smokes exercise these paths separately.
6. Verify successful outputs and package them only for an authorized handoff.
   Publishing requires a separate destination-specific workflow.

## Plans and rendering

The shared [schema](src/schema.ts) is consumed by the bridge and web app:

- V1: sequential primary clips and selectable captions;
- V2: primary timeline, z-ordered overlays, independent audio tracks, adjacent-clip
  transitions, timed title cards, subtitle-provider metadata, styled captions and
  speech-keyed music ducking.

Examples: [v1](examples/demo.edit-plan.json) and
[v2 production](examples/multitrack.edit-plan.json).

Clip duration comes from source ranges/speed; v2 also accounts for transitions and
layer/audio/title ends. Main projects can import media and create/remove production
layers. Clip reviews adjust plan-authored media/layers. Existing source identities
cannot be replaced under the same asset ID; the final output contract stays
isolated to its candidate directory.

FFmpeg runs without a shell. Preview uses ultrafast/CRF 32; final uses medium/CRF 20.
Still overlay images loop for their selected duration. Titles and caption text are
rasterized locally without requiring libass. More than 40 caption cues use one
transparent caption movie; the former 200-cue ceiling no longer applies. Graphics
are cached below `.opencut-agent/render-assets/`. Caption files and request bodies
still have size/count limits; long-caption cues must not overlap.

Successful MP4s publish atomically. A failed FFmpeg job does not publish a partial
final. Shutdown terminates media processes. Approved plans/project records contain
source/plan hashes and available reviewer/provenance information. No publishing
endpoint is implemented.

## HTTP: projects and library

All paths below are relative to the local bridge URL. `:project` is a persistent
library ID; `:session` is a process-local opaque registration; `:candidate` identifies
a candidate inside its manifest. The usual full-video candidate is `master`.

| Method and path | Request / result |
| --- | --- |
| `GET /health` | Bridge status/version and whether a render is active |
| `GET /v1/workspace-projects` | Library records, configured `mediaRoot` and `filePickerAvailable`; no unrelated disk scan |
| `POST /v1/workspace-projects/pick-media` | `{purpose: "video"\|"watermark"\|"music"\|"captions"}` → macOS chooser path or cancellation; no copy/import/upload |
| `POST /v1/workspace-projects` | `{name, sourcePath}` → full-source v2 project record |
| `POST /v1/workspace-projects/:project/open` | `{}` → project record, fresh `sessionId`, `approvalToken` |
| `POST /v1/workspace-projects/:project/media` | `{path}` → bounded local inspection/import metadata; VTT becomes a separate SRT |
| `POST /v1/workspace-projects/:project/clips` | `{title, start, end, expectedRevision}` → isolated child project and warnings |
| `POST /v1/workspace-projects/:project/duplicate` | `{}` → independent editable master/output folder |

Full projects use manifest `kind: "full-project"`; old manifests default to
`clip-review`. Main opening chooses its saved master; opening a clip project from
the library redirects to its review flow. Imported images are represented by video
assets with `stillImage` inspection metadata, not a new schema asset kind.

Child ranges use saved **output-timeline seconds**, must be in range and at most
120 s, and do not modify the parent. Snapshot locks exclude concurrent parent saves
while deriving a child/copy. Reopening an interrupted main project makes its saved
draft available for retry when no render is active.

## HTTP: review, edits and outputs

| Method and path | Purpose |
| --- | --- |
| `POST /v1/review-sessions` | `{manifestPath}` → register a saved manifest and remember it in the library |
| `GET /v1/review-sessions/:session` | Loaded plans, saved selection, revisions and output state |
| `POST /v1/review-sessions/:session/select` | `{candidateId}` → select only; no render |
| `POST /v1/review-sessions/:session/revise` | `{candidateId, plan, expectedRevision, note?}` → numbered saved revision |
| `POST /v1/review-sessions/:session/notes` | `{candidateId, text}` → reviewer note |
| `GET\|HEAD /v1/review-sessions/:session/media/:asset` | Session-authorized byte-range media stream |
| `GET /v1/review-sessions/:session/candidates/:candidate/captions` | Session-authorized caption text |
| `GET /v1/review-sessions/:session/system-check` | Read-only FFmpeg/ffprobe/provider readiness |
| `POST /v1/review-sessions/:session/generate-captions` | Token-gated provider run / supplied-caption confirmation |
| `POST /v1/review-sessions/:session/revise-captions` | Token-gated cue correction save |
| `POST /v1/review-sessions/:session/preflight` | Read-only next-action checks |
| `POST /v1/review-sessions/:session/render-preview` | Token-gated revision-specific preview; `background: true` → 202 `{job}` |
| `GET\|HEAD /v1/review-sessions/:session/candidates/:candidate/preview` | Authorized preview stream |
| `POST /v1/review-sessions/:session/approve-and-render` | Separate token-gated final; requires current preview; `background: true` → 202 `{job}` |
| `GET /v1/review-sessions/:session/render-jobs?candidateId=...` | Saved-manifest-scoped recent jobs with revision, mode, status, phase, elapsed timestamps, encoding seconds/percent and diagnostics |
| `POST /v1/review-sessions/:session/render-jobs/:job/cancel` | `{approvalToken}` → cancel active preparation/encoding in the same manifest; 403 wrong token, 409 wrong scope/completed/publishing |
| `POST /v1/review-sessions/:session/approve-batch` | Explicit sequential batch approval |
| `POST /v1/review-sessions/:session/export-package` | Token-gated package for completed candidates |
| `GET\|HEAD /v1/review-sessions/:session/candidates/:candidate/output` | Existing final stream; `?download=1` sets an attachment filename |

Use the source [HTTP schemas](src/http.ts) for exact bodies, defaults and optional
fields. Render requests identify `candidateId`, `approvalToken` and
`renderLimitSeconds`. Batch requests use distinct `candidateIds`. Caption generation
adds `externalUploadApproved` only after the user explicitly approves the named
external provider. Tokens are returned by registration/opening; never embed them
in URLs, logs or documentation.

The main UI requests the full saved duration, up to 14,400 s. Clip UI requests 60 s
for preview and 300 s for final/batch. Clip preview HTTP requests are capped at
120 s; clip single-final HTTP requests at 300 s. The raw batch schema has a 14,400 s
ceiling, distinct from its UI's 300 s request. Oversized finals are blocked rather
than truncated; export packaging itself does not render the timeline.

### Editorial proposals

All editorial routes use `/v1/review-sessions/:session/edits/`:

| Action | Body / behavior |
| --- | --- |
| `propose` | `candidateId`, `expectedRevision`, `approvalToken`, typed `operation`, optional `protectedRanges` |
| `apply` | Same identity/revision/token plus returned `proposalId`; explicit save |
| `undo` | Same identity/revision/token; restore the preceding snapshot as a new revision |
| `silence` | Same identity/revision/token; read local audio and return pause suggestions |

Operations are `keep`/`remove` with `{start,end}` range arrays, `shorten` with
`seconds` (0.1–14,400 for full projects; 0.1–300 for clips), and `move-first` with `clipId`. Ranges/protection use output-timeline
seconds. Proposals expire after 30 minutes, and applying checks both revision and
plan hash. Review edit conflicts return HTTP 409. Manifest-level locks are shared
across registered views in the process. Save/retry is required after stale work;
a client must not silently overwrite a newer saved plan.

Production layers/captions follow retained speech. Existing crossfades are flattened
to midpoint cuts with a warning. A partially cut cue is omitted and flagged for
regeneration. Protection is proposal-specific. Undo includes the earlier caption
asset and can restore a main edit before media import; it does not undo a final.
Pause analysis uses −35 dB / at least 0.6 s with source padding, up to 40 cuts / ten
source minutes and a 45 s budget. See [silence.ts](src/silence.ts).

Direct numeric inspector edits are separate from these retiming operations. A
saved plan's preview must be reviewed for layout, timing and mix before approval.

## Storage and identity

```text
media-root/
├── source-video.mp4                         # original stays in place
├── .opencut-agent/
│   ├── projects/<project-id>.json           # persistent library record
│   ├── imports/                            # normalized imported captions
│   └── render-assets/                      # generated local graphics/cache
└── opencut-projects/<project-id>/
    ├── review-session.json                  # state, notes, events, candidate refs
    ├── candidates/master/
    │   ├── edit-plan.json                   # current saved plan
    │   ├── revisions/revision-*.edit-plan.json
    │   ├── ...                              # generated caption revisions
    │   ├── approved-edit-plan.json          # after approval
    │   ├── opencut.project.json             # final render/provenance record
    │   └── renders/                         # revision previews and final MP4
    └── exports/<package-id>/                # rendered copies and handoff metadata
```

Agent-prepared review manifests may use their existing layout. Each candidate's
output must remain in its own candidate directory, normally `renders/output.mp4`.
Do not target shared output directories across candidates. Final candidates stay
immutable. New main copies/children get independent output paths.

Library IDs and manifests persist. Session/action/proposal IDs are process-local;
reopen/register after a restart rather than persisting the action token as a
credential. Back up library records, project folders and every referenced source/
logo/audio/caption file. Export packages contain outputs and available metadata,
not the original large sources.

## Background jobs and local picking

Single saved-session preview/final calls default to the existing synchronous response.
The web workspace sends `background: true`, receives 202 `{job}`, and polls the
manifest-scoped job list. Status is queued/running/cancelling/completed/failed/
cancelled/interrupted; phase is preparing/rendering/publishing. Encoding percent
is based on FFmpeg output time, not an ETA or a whole-pipeline completion estimate.
Preparation has an indeterminate indicator; successful jobs finish at 100%.

Jobs persist under `.opencut-agent/render-jobs/<manifest-sha256-prefix>/<uuid>.json`.
They contain no action tokens. Fresh opaque sessions for the same manifest can
observe/cancel an active job. Restarted in-progress checkpoints become interrupted;
normal shutdown may record failed instead. Neither restarts automatically.
Cancellation stops child media processes and removes partial output; publication
cannot be cancelled. Separate preview/final gates and immutable revisions remain.
These controls cover single saved-session previews/finals, not batches, direct MCP
renders or legacy encoded-plan links.

`pick-media` uses the native macOS chooser and validates the selected real path
against `OPENCUT_AGENT_ROOT`. It does not copy, upload or import the file. Choosing
outside that root returns 400; another open chooser returns 409. Unsupported
platforms return 501 and retain manual path entry. Cancelling the chooser returns
`{cancelled: true, path: null}`. Only one chooser opens at a time.

## Legacy encoded-plan links

`/?plan=<URL-encoded JSON>` remains supported for standalone imported plans. This
is the older direct-render approval flow without saved-session preview gates. It
is not the projects home's Create project action. Prefer persistent projects or
registered manifests for new work. The root `/` now opens the project library.

## Validation and troubleshooting

Run checks from the indicated package using its installed runtime:

```sh
(cd apps/agent-bridge && ./node_modules/.bin/bun test)
(cd apps/agent-bridge && ./node_modules/.bin/tsc --noEmit)
(cd apps/agent-bridge && ./node_modules/.bin/bun run build)
(cd apps/web && ./node_modules/.bin/vitest run)
(cd apps/web && ./node_modules/.bin/tsc --noEmit)
(cd apps/web && ../agent-bridge/node_modules/.bin/bun run build)
```

Generated-media integration checks (from `apps/agent-bridge`):

```sh
./node_modules/.bin/bun run smoke
./node_modules/.bin/bun run smoke:render
./node_modules/.bin/bun run smoke:approval
./node_modules/.bin/bun run smoke:production
./node_modules/.bin/bun run smoke:editorial
./node_modules/.bin/bun run smoke:review
./node_modules/.bin/bun run smoke:project
./node_modules/.bin/bun run smoke:jobs
```

The last implementation pass recorded 66 bridge tests, 24 web tests, both builds/
typechecks, and main/editorial/review integration smokes. `smoke:project` validates
a generated 301 s project with 201 captions, watermark/title, preview/final gate,
range download, child isolation, package, editable copy, restart and interrupted
master recovery. This is not evidence that the real podcast was rendered or that
external providers were tested. See [verification](../../verification/2026-10-26-main-editor.md).

For missing assets, path-root errors, stale sessions, provider setup, final
immutability or relative export paths, follow the troubleshooting table in the
[main editor guide](MAIN_EDITOR_GUIDE.md#reopen-and-recovery). Upstream desktop
builds and native editor integration are separate from this bridge.

### Script-to-cut benchmark preparation

`./node_modules/.bin/bun run benchmark:prepare /absolute/path/to/new/folder`
prepares a generated script/asset pack on macOS using the already-installed
Samantha voice. It writes a fixed brief, measured captions, media/hash manifest,
input-only ZIP, scoring/revision protocol and an unselected reference plan outside
the checkout. It does not render a cut, install Kino or implement agent assembly.
The output folder must not exist. See the
[dated preparation report](../../research/script-to-cut-benchmark-v1-2026-10-30.md).
