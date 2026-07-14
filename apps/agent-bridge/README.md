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

Every file operation is restricted to `OPENCUT_AGENT_ROOT`. Inputs must exist, output directories must already exist, FFmpeg is invoked without a shell, preview duration is capped at five minutes, and no tool uploads or publishes anything.

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
