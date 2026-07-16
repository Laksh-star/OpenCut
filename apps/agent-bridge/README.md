# OpenCut Agent Bridge

This package is the first working seam between AI agents and the OpenCut rewrite. It exposes a local MCP server that can inspect media, validate and save declarative edit plans, compile those plans to FFmpeg arguments, and render bounded MP4 previews.

It does **not** automate the browser, publish media, or claim to be OpenCut's future Editor API. The adapter is deliberately isolated so the FFmpeg preview backend can later be replaced by OpenCut's native API and headless renderer.

## Tools

- `opencut_capabilities`
- `opencut_inspect_media`
- `opencut_validate_edit_plan`
- `opencut_save_edit_plan`
- `opencut_compile_edit_plan`
- `opencut_render_preview`
- `opencut_approve_and_render_project`

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
```

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
3. Create an edit plan matching [`examples/demo.edit-plan.json`](examples/demo.edit-plan.json).
4. Validate and save it.
5. Compile it and review the returned FFmpeg argv.
6. Render a short preview.
7. Ask for human approval before a longer render or any publishing workflow.

The MVP timeline is intentionally narrow: sequential video clips, optional per-clip audio control, reframing by fit-and-pad, and optional SRT/VTT captions muxed into MP4. Text, overlays, transitions, keyframes, music mixing, and native OpenCut project synchronization belong in the next adapter version.

The web app's agent review workspace consumes this same schema for visual
inspection and approval. Approval atomically saves `approved-edit-plan.json`
and `opencut.project.json` beside the project's `renders` directory, invokes
the bounded FFmpeg backend, and records either the rendered or failed state.
The bridge remains local-only and never uploads or publishes media.

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
      "status": "ready-for-review"
    }
  ],
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

Candidate selection and render approval are deliberately separate actions.
Selecting a card persists the comparison choice but cannot start FFmpeg;
rendering starts only from the visible **Approve & render** button. Each
candidate's approved plan, project record, and render stay inside that
candidate's directory.

The HTTP surface for this workflow is:

- `POST /v1/review-sessions` — register a manifest and issue an opaque ID;
- `GET /v1/review-sessions/:id` — restore manifest and render state;
- `POST /v1/review-sessions/:id/select` — persist selection only;
- `GET|HEAD /v1/review-sessions/:id/media/:assetId` — authorized range streaming;
- `GET /v1/review-sessions/:id/candidates/:candidateId/captions` — authorized captions;
- `POST /v1/review-sessions/:id/approve-and-render` — token-gated local render.

Session IDs are process-local: restarting the bridge creates a new short URL,
while the manifest's selected/rendered state remains on disk.
