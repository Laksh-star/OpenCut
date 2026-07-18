# OpenCut Agent Bridge

This package is the first working seam between AI agents and the OpenCut rewrite. It exposes a local MCP server that can inspect media, validate and save declarative edit plans, upgrade v1 plans to the v2 production contract, compile deterministic FFmpeg filter graphs, run review-session preflight checks, render bounded MP4 previews with layered video, speech-keyed music ducking, transitions, title cards, and styled captions, and create local handoff packages for rendered candidates.

It does **not** automate the browser, publish media, or claim to be OpenCut's future Editor API. The adapter is deliberately isolated so the FFmpeg preview backend can later be replaced by OpenCut's native API and headless renderer.

## Tools

- `opencut_capabilities`
- `opencut_inspect_media`
- `opencut_validate_edit_plan`
- `opencut_upgrade_edit_plan`
- `opencut_save_edit_plan`
- `opencut_compile_edit_plan`
- `opencut_render_preview`
- `opencut_build_word_timed_captions`
- `opencut_preflight_review_session`
- `opencut_approve_and_render_project`
- `opencut_create_export_package`

Every file operation is restricted to `OPENCUT_AGENT_ROOT`. Inputs must exist,
missing output directories are created only after their nearest existing parent
has been verified inside that root, FFmpeg is invoked without a shell, preview
duration is capped at five minutes, and no tool uploads or publishes anything.

## Run locally

From the repository root:

```sh
proto use
moon run agent-bridge:test
moon run agent-bridge:typecheck
moon run agent-bridge:smoke
```

With FFmpeg installed, run a complete generated-media render smoke test:

```sh
cd apps/agent-bridge
bun run smoke:render
bun run smoke:review
bun run smoke:production
```

Generate a ready-to-merge Codex MCP configuration and environment file with one command:

```sh
apps/agent-bridge/bin/opencut-setup \
  --root "/absolute/path/to/video-workspace"
```

The command creates `.opencut-agent/opencut.env`, `codex-mcp.toml`, and a
machine-readable `setup.json` inside the workspace. It never edits the user's
global Codex configuration or writes outside `OPENCUT_AGENT_ROOT`.

Start the stdio MCP server directly:

```sh
OPENCUT_AGENT_ROOT="$PWD" apps/agent-bridge/bin/opencut-agent
```

Start the loopback-only HTTP bridge used by the web review workspace:

```sh
OPENCUT_AGENT_ROOT="$PWD" apps/agent-bridge/bin/opencut-agent-http
```

The HTTP bridge binds to `127.0.0.1:3210`, accepts browser requests only from
the local OpenCut development origins by default, caps request bodies at 2 MB,
and permits one approval render at a time. Override the port with
`OPENCUT_AGENT_HTTP_PORT` or the comma-separated browser origin allowlist with
`OPENCUT_WEB_ORIGINS`.

FFmpeg and ffprobe must be available on `PATH` for media inspection and preview rendering.

## Connect an agent

Generic MCP client configuration:

```json
{
  "mcpServers": {
    "opencut": {
      "command": "/absolute/path/to/OpenCut/apps/agent-bridge/bin/opencut-agent",
      "env": {
        "OPENCUT_AGENT_ROOT": "/absolute/path/to/video-workspace"
      }
    }
  }
}
```

Codex `config.toml` equivalent:

```toml
[mcp_servers.opencut]
command = "/absolute/path/to/OpenCut/apps/agent-bridge/bin/opencut-agent"

[mcp_servers.opencut.env]
OPENCUT_AGENT_ROOT = "/absolute/path/to/video-workspace"
```

## Agent workflow

1. Call `opencut_capabilities`.
2. Inspect every source with `opencut_inspect_media`.
3. Create a sequential v1 plan matching [`examples/demo.edit-plan.json`](examples/demo.edit-plan.json), or a layered v2 plan matching [`examples/multitrack.edit-plan.json`](examples/multitrack.edit-plan.json).
4. Validate and save it.
5. Compile it and review the returned FFmpeg argv.
6. Render a short preview.
7. Run review-session preflight before preview, final, batch, or export actions.
8. Ask for human approval before a longer render or any publishing workflow.
9. Package rendered candidates for local delivery without copying the original source video.

Version 1 remains supported unchanged. Version 2 keeps the sequential clips as
the primary A-roll and adds z-ordered video overlay tracks, independent audio
tracks, adjacent-clip transitions, timed title cards, and styled caption
settings. Music-role tracks can be lowered automatically from the primary
speech signal with FFmpeg `sidechaincompress`. Transitions use `xfade` plus
`acrossfade`; title cards and SRT cue text are rasterized locally into
transparent PNGs and composed with `overlay`, so burned-in text does not depend
on optional FFmpeg font or libass filters. Caption mode can be `selectable`,
`burn-in`, or `both`. Generated graphics stay under
`.opencut-agent/render-assets/` inside the configured root.
Burn-in rendering is capped at 200 SRT cues per bounded render.

The full v2 example also documents reusable `intro`, `outro`, and
`lower-third` templates, five transition styles, caption presets (`clean`,
`bold`, and `minimal`), audio-track roles, and ducking controls. Keyframes and
native OpenCut project synchronization remain later adapter features.

The web app's agent review workspace consumes this same schema for visual
inspection and approval. A reviewer can revise clip ranges, ordering, speed,
volume, caption inclusion, existing v2 production controls, and reusable
production presets. Every save creates an immutable numbered plan snapshot and
invalidates any older preview. Final approval atomically saves
`approved-edit-plan.json` and `opencut.project.json` beside the project's
`renders` directory, invokes the higher-quality FFmpeg profile, and records
source/plan hashes, reviewer notes, and either the rendered or failed state.
The bridge remains local-only and never uploads or publishes media.

For v2 candidates, the review workspace identifies plan version, total layered
clip count, overlay/audio track counts, transitions, title cards, caption
treatment, ducking, and all video/audio/caption assets. The inspector can revise
the primary A-roll plus existing v2 production controls: overlay timing/source
range/canvas placement/fit/opacity/audio, audio track role/timing/source/volume,
transition type/duration, title-card text/timing/colors, caption style, and
smart ducking. Every change still flows through the immutable revision endpoint
and requires a fresh preview before final approval. The approval panel displays
backend preflight checks for the next preview or final action, and rendered
candidates can be bundled into a timestamped export package containing MP4
copies, approved plans, project records, captions, contact sheets, a manifest,
and a summary.

## Candidate review sessions

For a real agent workflow, use an opaque review session instead of embedding an
entire plan in the browser URL. The agent creates one isolated directory per
candidate and a small `review-session.json` manifest:

```text
video-workspace/
├── source.mp4
├── review-session.json
└── candidates/
    ├── concise/
    │   └── edit-plan.json       # output: candidates/concise/renders/output.mp4
    └── contextual/
        └── edit-plan.json       # output: candidates/contextual/renders/output.mp4
```

```json
{
  "version": "1",
  "id": "interview-highlights",
  "title": "Choose an interview highlight",
  "sourceAssets": [
    { "id": "source", "label": "Original interview", "path": "source.mp4" }
  ],
  "candidates": [
    {
      "id": "concise",
      "title": "Concise answer",
      "summary": "Fast opening with one core idea",
      "planPath": "candidates/concise/edit-plan.json",
      "status": "ready-for-review",
      "revision": 1
    }
  ],
  "reviewerNotes": [],
  "events": [],
  "renderBatches": [],
  "exportPackages": [],
  "updatedAt": "2026-07-16T00:00:00.000Z"
}
```

Launch both the loopback bridge and web workspace with one command:

```sh
OPENCUT_AGENT_ROOT="/absolute/path/to/video-workspace" \
  apps/agent-bridge/bin/opencut-review \
  /absolute/path/to/video-workspace/review-session.json
```

The launcher prints a short URL containing only an opaque session ID. The web
workspace then streams large local media with HTTP byte ranges, restores the
selected candidate after refresh, loads only session-authorized captions,
detects already-rendered outputs, and never asks the reviewer to select the
multi-gigabyte source file again.

Candidate selection, preview rendering, batch inclusion, and final approval are
deliberately separate actions. Selecting a card cannot start FFmpeg. The visible
**Render preview** action produces a fast revision-specific file; **Approve
final** stays locked until that exact revision has a preview. Preview-approved
candidates can also be added to a batch queue and rendered sequentially through
one explicit **Approve batch** action. Batch item state is persisted as queued,
rendering, rendered, or failed so the reviewer can poll progress and retry only
failed candidates. Backend preflight checks are enforced for preview, final,
batch, and export actions, so the UI status is not merely cosmetic. The final
renderer uses a higher-quality profile and records an append-only audit trail.
Each candidate's revision snapshots, previews, approved plan, project record,
and final render stay inside that candidate's directory. Export packages are
written under `exports/` beside the review manifest and copy only rendered
outputs plus lightweight handoff metadata, not the original large source video.

The HTTP surface for this workflow is:

- `POST /v1/review-sessions` — register a manifest and issue an opaque ID;
- `GET /v1/review-sessions/:id` — restore manifest and render state;
- `POST /v1/review-sessions/:id/select` — persist selection only;
- `POST /v1/review-sessions/:id/revise` — validate, snapshot, and save a numbered revision;
- `POST /v1/review-sessions/:id/notes` — append a revision-specific reviewer note;
- `GET|HEAD /v1/review-sessions/:id/media/:assetId` — authorized range streaming;
- `GET /v1/review-sessions/:id/candidates/:candidateId/captions` — authorized captions;
- `POST /v1/review-sessions/:id/preflight` — read-only checks before preview, final, batch, or export actions;
- `POST /v1/review-sessions/:id/render-preview` — token-gated fast preview;
- `GET|HEAD /v1/review-sessions/:id/candidates/:candidateId/preview` — stream the authorized preview;
- `POST /v1/review-sessions/:id/approve-and-render` — token-gated final render after preview;
- `POST /v1/review-sessions/:id/approve-batch` — token-gated sequential final render for preview-approved candidates;
- `POST /v1/review-sessions/:id/export-package` — token-gated local handoff package for rendered candidates.

Session IDs are process-local: restarting the bridge creates a new short URL,
while the manifest's selected, batch, and rendered state remains on disk.
