<table width="100%">
  <tr>
    <td align="left" width="120">
      <img src="https://assets.opencut.app/branding/symbol.svg" alt="OpenCut Logo" width="100" />
    </td>
    <td align="right">
      <h1>OpenCut</h1>
      <h3 style="margin-top: -10px;">A free and open source video editor for web, desktop, and mobile.</h3>
    </td>
  </tr>
</table>

[![Discord](https://img.shields.io/discord/1386309140057690133?label=Discord&logo=discord&logoColor=fff&color=5865F2&style=flat)](https://discord.gg/zmR9N35cjK)
[![X](https://img.shields.io/badge/follow-%40opencutapp-000?logo=x&logoColor=fff&style=flat)](https://x.com/opencutapp)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat)](LICENSE)

## Current fork status

This fork provides a working **local video workspace** alongside the upstream
OpenCut rewrite foundations. Bridge version **0.12.0**, documented 27 October 2026:

- **Projects home** creates and reopens full-video projects and saved clip reviews.
- **Main editor** edits a complete video with a visible timeline, transcript,
  media imports, watermarks, music, titles and captions.
- **Clip review** uses **Choose clips → Edit → Review & export**. Main projects can
  create independent clip reviews without changing the master edit.
- **Local exports** require separate preview and final actions, preserve saved
  revisions, and provide final playback, MP4 download and export packages.
- **Render controls** show live encoding progress and elapsed time, reconnect after
  reopening a project, and cancel preparation/encoding without changing saved edits.
- **Local media** can be chosen with macOS **Browse…** or pasted paths. Main-project
  **Shorten edit** supports targets up to four hours, with a valid default.

The current renderer is an FFmpeg-backed adapter. The native upstream Editor API,
Rust desktop editor and a native draggable timeline are separate work. See the
[feature and limits reference](FEATURES.md) for the supported scope.

## Start the workspace

Run commands from this checkout, the directory containing `apps/`. In the local
wrapper workspace, first enter `.opencut-runtime`. Keep source videos and generated
projects outside the code checkout.

Prerequisites: Bun **1.3.11**, FFmpeg and ffprobe on PATH. Tool pins are in
[.prototools](.prototools); `proto use` can install the repository's pinned tools.
Install dependencies independently in each checkout:

```sh
(cd apps/agent-bridge && bun install --frozen-lockfile)
(cd apps/web && ../agent-bridge/node_modules/.bin/bun install --frozen-lockfile)
```

Start the projects home with an existing folder containing your media:

```sh
OPENCUT_AGENT_ROOT="/absolute/path/to/media-folder" \
  apps/agent-bridge/bin/opencut-studio
```

The default app URL is **http://127.0.0.1:5173/**; its bridge uses port **3210**.
The currently configured local workspace uses **http://127.0.0.1:5273/** and bridge
port **3320**. To use that pair when no workspace is already running:

```sh
OPENCUT_AGENT_ROOT="$HOME/Downloads" \
OPENCUT_AGENT_HTTP_PORT=3320 OPENCUT_WEB_PORT=5273 \
  apps/agent-bridge/bin/opencut-studio
```

Use the open workspace if it is already running. The launcher rejects occupied
ports, configures the browser origin, and stops both services together. Leave the
launcher running during work; Ctrl+C stops it. Launchers prefer the checkout's
pinned Bun; `OPENCUT_BUN` supplies an explicit override.

## Choose a workflow

| Task | Where to start | Guide |
| --- | --- | --- |
| Edit a complete video | Projects home → name project and Browse/paste video path → Create project | [Main editor guide](apps/agent-bridge/MAIN_EDITOR_GUIDE.md) |
| Resume a saved main edit | Main projects → Open project | [Reopen and recovery](apps/agent-bridge/MAIN_EDITOR_GUIDE.md#reopen-and-recovery) |
| Make a short clip from a master | Media & production → Create a short clip from this edit | [Child clips](apps/agent-bridge/MAIN_EDITOR_GUIDE.md#create-clips-within-a-main-project) |
| Review agent-prepared clips | Clip reviews → Open clip review, or launch its manifest | [Clip review guide](apps/agent-bridge/USER_GUIDE.md) |
| Configure an agent or integrate the API | Local MCP/HTTP bridge | [Bridge reference](apps/agent-bridge/README.md) |

Prepared review manifests can still launch directly:

```sh
OPENCUT_AGENT_ROOT="/absolute/path/to/media-folder" \
  apps/agent-bridge/bin/opencut-review \
  /absolute/path/to/media-folder/review-session.json
```

Main-project links use `/editor?project=<id>` and reopen a fresh session after a
restart. Clip `?session=<id>` links are process-local: reopen through the library
or launcher after restarting the bridge. Saved plans, selection, revisions and
completed outputs remain on disk.

## Editing and exports

**Source** plays original footage for the selected cut. **Edited preview** plays
the rendered composition with cuts, captions, titles, watermark and sound. Source
footage and optional layout guides are editing aids; they do not show the final
composite.

Main projects support full-timeline preview/final actions up to **four hours**.
Clip review uses a **60-second preview request** and **300-second final request**;
a clip preview may cover only the start of a longer candidate. Oversized finals
are blocked instead of silently truncated. The MCP render tools retain their
separate bounded limits. See [limits](FEATURES.md#operating-limits).

Save changes, render an edited preview, inspect it, then separately approve the
final. Each save invalidates the previous preview. Finished masters stay
immutable; **Make an editable copy** gives further work its own output folder.
Exports offer **Watch final video**, **Download MP4**, and **Create export package**.

Local Whisper stays on the machine. Supplied captions can be reused without new
transcription. OpenAI API/OpenRouter transcription needs explicit audio-upload
approval and provider credentials. Editing commands run locally. Publishing is
outside this workflow.

## Agent bridge and development

The [bridge reference](apps/agent-bridge/README.md) documents the 14 MCP tools,
HTTP routes, schema, storage, privacy and validation commands. Generate a local
MCP configuration snippet when needed:

```sh
apps/agent-bridge/bin/opencut-setup --root "/absolute/path/to/media-folder"
```

This writes setup files inside the media root; it does not edit global agent
configuration. `OPENCUT_AGENT_ROOT` is the media folder, not the source checkout.
Do not symlink dependency directories across worktrees.

Recorded implementation validation: **66 bridge tests + 24 web tests**, both
TypeScript checks and production builds, the 301-second/201-caption full-project
smoke, and existing editorial/review smokes. These are recorded results, not a
claim that every platform or external transcription provider was exercised.

- [Main editor verification](verification/2026-10-26-main-editor.md)
- [Review UI verification](verification/2026-10-26-review-ux.md)
- [Transcript/upstream integration verification](verification/2026-10-26.md)
- [Development shiplog](shiplog.md)
- [Current architecture and historical report](project-report.md)
- [Documentation index](DOCUMENTATION.md)

Upstream web/API/desktop development tasks remain separate from the local studio
launcher. The Rust desktop app is still a scaffold; see its
[own README](apps/desktop/README.md). Earlier upstream editor code is available in
[OpenCut Classic](https://github.com/opencut-app/opencut-classic).

## Contributing to this fork

The working development branch is `codex/agent-bridge-mvp`. Preserve the local
bridge, immutable revisions, source-file boundaries and separate preview/final
approval when integrating upstream changes. Update the relevant guides and
[shiplog](shiplog.md) with each user-visible development pass.

## Upstream sponsorship attribution

The upstream README credits the following sponsorship; this is retained project
attribution, not a list of services implemented in this fork.

- [**fal.ai**](https://fal.ai?utm_source=github-opencut&utm_campaign=oss): Generative image, video, and audio models all in one place.

Want your logo here? Reach out at [sponsor@opencut.app](mailto:sponsor@opencut.app).

## License

[MIT](LICENSE)
