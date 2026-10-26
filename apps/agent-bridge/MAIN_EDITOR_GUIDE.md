# Main video workspace

Open the projects home at the local app's `/` URL. Main projects and clip reviews
have separate lists. Existing `?session=...` review links keep the clip workflow.

## Start and reopen

```sh
OPENCUT_AGENT_ROOT="/absolute/path/to/media-folder" \
  apps/agent-bridge/bin/opencut-studio
```

Use `OPENCUT_AGENT_HTTP_PORT` and `OPENCUT_WEB_PORT` to choose ports. The launcher
uses strict ports and stops both services if either fails. An already-running
workspace should be used instead of launching another on the same ports.

Enter a project name and the local video path. The original video stays in place;
no browser upload or large duplicate is needed. The path must be inside the media
folder chosen for the launcher. Projects are stored beneath `opencut-projects/`;
small library records live in `.opencut-agent/projects/`. Sources and outputs stay
outside the source-code checkout.

Main projects have stable `/editor?project=<id>` links. Opening or refreshing one
registers a fresh local session and reloads its saved plan, captions, and render
state. If a prior render was interrupted, reopen the project and review the saved
edit before retrying. Final files are published only after successful rendering;
a failed job does not leave a partial MP4 masquerading as a final.

## Edit the full video

- **Source** plays the selected source cut. **Edited preview** plays the complete
  rendered edit, with production layers and mixed sound.
- The **Main timeline** selects cuts. Move the source playhead, then **Split at
  playhead**. Save the resulting changes.
- **Move cut first**, **Remove cut**, and **Trim to a timeline range** propose a
  revision. Review retained ranges and caption/layer warnings, then explicitly
  **Save timeline changes**. These operations retime captions, titles, overlays,
  and audio using the existing editorial engine.
- The transcript seeks, keeps/removes whole passages, proposes a shorter edit,
  and provides cleanup/protection/restore under More editing tools.
- **Media & production** adds timeline video, PNG/JPEG/WebP or video overlays,
  music, SRT/VTT captions, and opening titles. Caption imports stay local; VTT is
  normalized to a separate SRT. Music starts at a quiet level and ducks under
  speech. Added video requires updated captions when a caption track exists.
- Removing a production layer removes it from the edit while preserving the
  media file. **Advanced** adjusts exact layout, speed, volume, caption style,
  title/layer timing, provider setup, and notes/history.

Save changes before previewing or creating clips. Provider generation and caption
corrections still create new saved revisions. External transcription still asks
before sending extracted audio outside the machine. No transcription starts
merely by adding a video.

## Review and export

1. Continue to **Review & export**.
2. Press **Render edited preview**. For main projects this previews the whole
   saved timeline; keep the local workspace running while it works.
3. Watch the preview, then separately **Approve & render final**.
4. **Watch final video** or **Download MP4**. Optionally create the local export
   package with rendered files, captions and handoff metadata.
5. Final edits remain immutable. **Make an editable copy** creates a new project
   and output folder while retaining the previous final.

Main-project previews/finals support timelines up to four hours. Oversized finals
are blocked rather than silently exported as a five-minute excerpt. Large caption
sets use a single transparent caption movie instead of hundreds of simultaneous
image inputs. Caption QA accepts up to 10,000 cues, subject to the existing HTTP
body/text-size limits; long-caption passages must not overlap.

## Create clips within a main project

Open **Media & production → Create a short clip from this edit**. Enter a title
and timeline start/end (up to 120 seconds). The saved main edit produces an
independent clip review with retimed captions and layers. The main plan stays
unchanged. Open the new clip review and use its separate preview/final approvals.
Related existing clip reviews can also be linked in the local project library.

## Current boundaries

This is a functional browser editor backed by the local FFmpeg bridge. Timeline
editing currently uses selection, split/range controls and explicit proposals;
it does not provide a native draggable NLE timeline, waveforms, keyframes, or
newly generated media. Import currently uses local paths rather than a native
file picker. Source footage is not a live composite: use Edited preview to judge
production appearance. Long previews can take time and do not yet show a detailed
progress percentage. Music is trimmed to its available length, not looped.
