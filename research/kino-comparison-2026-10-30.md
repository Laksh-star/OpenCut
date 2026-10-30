# Kino.ai and our OpenCut fork — feature comparison

Reviewed 30 October 2026. Our baseline is private fork bridge 0.12.0 at
`b13b314a`; the agentic script-to-cut plan is proposed work, not an implemented
capability. No new feature development or change to that plan occurred here.

## Assessment

Kino's documented product is substantially broader than our current local studio.
It overlaps with our intended agent-led editing direction. Our working strengths
are a customizable local media workflow, structured edit plans, explicit render
approvals and recorded provenance. MCP access or revision history alone does not
differentiate us: Kino documents both external-agent integration and checkpoints.

This is an assessment of official public documentation against our checked-in
implementation, not a head-to-head runtime test. Documented Kino capabilities
are vendor claims; availability, quality, speed and exact script fidelity have
not been independently exercised. Similar names on other domains were excluded:
this comparison is specifically about `kino.ai`.

## Feature matrix

| Area | Kino: documented capability | Our fork: implemented today | Assessment |
| --- | --- | --- | --- |
| Agent integration | External agents edit/search through desktop MCP [1] | 14 MCP tools plus local HTTP; agent-authored plans and saved review sessions | Both agent-accessible; our tools do not yet form the planned complete assembly loop |
| Agent-directed first cuts | Agent builds a first cut, followed by manual refinement [2] | External agent can prepare plans; local keep/remove/shorten/reorder commands | Kino is further along as an integrated product |
| Supplied script and asset pack | Broad agent editing of supplied media is documented [2]; exact script/asset-pack acceptance case not tested | Renderer has composition primitives; no integrated script-to-storyboard assembly | Our new workflow remains planned; cannot claim parity or unique capability |
| Media understanding/search | Transcript, visual and person search with timecoded hits and bins [3] | Project library, attached transcripts and local cue editing; no persistent semantic footage index | Major gap |
| Timeline editing | Ripple/slip/razor, waveforms and keyframes [4] | Cut selection/split; proposed remove/reorder/range trim; numeric controls and visual layer geometry | Kino has substantially richer editing controls |
| Transcript/captions | Word timing, editable captions and silence editing [4] | Local/provided captions or approved API transcription; manual caption QA, whole-cue edits, filler/pause suggestions | Overlap; our whole-cue editing is not word-accurate transcript editing |
| Graphics/templates | Remotion-based motion graphics and 100+ templates [5] | Titles, overlays, simple transitions, caption styling and production presets | Static finishing exists; motion graphics/catalog gap |
| Brand reuse | Website-derived reusable brand kits [6] | Supplied logo/watermark and per-plan styling | No saved reusable brand-kit workflow |
| Audio | Agent-assisted level matching and mic-bleed correction [7] | Audio tracks/mixing and music ducking; music key currently primary-video speech | Separate-narration ducking needs work; advanced audio cleanup absent |
| Format variants | Agent reframing and graphics repositioning [7] | Different plan canvases possible; mainly fit-and-pad | No coordinated speaker-aware variant workflow |
| Team review | Shared editing and frame-specific review notes [7] | One local workspace, reviewer notes and local package export | No multiplayer or hosted client review |
| Versions/approvals | Saved and agent-created checkpoints with restoration [7] | Immutable revisions, plan/source hashes, audit events and separate current-revision preview/final gates | Both have version recovery; our exact gate/provenance contract is documented locally, equivalent Kino enforcement not established |
| Local/cloud handling | Original files stay local; cloud 720p proxies by default [3] | Local paths/renders; no automatic proxy upload; external transcription requires approval | Different default media handling; do not assume every Kino mode requires upload |
| Codecs/export | Pro camera formats and multiple export codecs [8] | FFmpeg-backed inputs; MP4 H.264/AAC plus optional subtitles | No verified R3D/BRAW or pro finishing parity in our fork |
| Editor interchange | Imports projects from major editors, including CapCut [9] | Our JSON plans and export metadata; native OpenCut adapter disconnected | No general NLE timeline interchange |
| Generated media | Images/video/music/voice via fal [4] | No built-in generation | Deferred in our roadmap |
| Pricing | Free local editor/MCP; upgraded sharing, indexing and AI [10] | No app subscription enforced; compute, optional providers and development still cost | Do not justify building on an assumed Kino editor subscription cost |

Our implementation evidence:
[features](../FEATURES.md),
[bridge capabilities](../apps/agent-bridge/src/service.ts),
[MCP tools](../apps/agent-bridge/src/server.ts),
[mixing/compiler](../apps/agent-bridge/src/ffmpeg.ts),
[project/import](../apps/agent-bridge/src/workspace-projects.ts), and
[planned agent workflow](../plans/script-to-cut.md).

## Implications for our proposed agent workflow

The independent requirement already recorded in our plan remains coherent: accept
an explicit script/asset pack, create a reviewable draft, preserve narration and
locked decisions, make conversational revisions, and retain local execution and
approval records. This comparison does not establish that building it is preferable
to using an existing editor. It shows that agent-driven assembly itself is not a
new differentiator.

Reasons to continue building would be workflow ownership, specific editorial
constraints, local-media defaults and integration with our existing project/audit
contracts. General timeline breadth, a template marketplace and team collaboration
would be separate, much larger product efforts. We should not quietly expand the
current plan into those efforts.

Before substantial implementation, a practical evaluation could use one owned
script and asset pack in both workflows. Measure scene relevance, narration
preservation, caption timing, correction effort, export quality and data handling.
That would be a separate authorized trial: nothing was installed, signed into,
uploaded or rendered during this comparison.

## Important evidence limits

- Kino's exact behavior for script preservation, scene locks, failed-job recovery,
  mandatory final approval and immutable source/plan provenance was not tested.
  Missing detail in this review is not proof of a missing product feature.
- A local desktop editor can still use cloud analysis/storage. Its storage docs
  describe proxy uploads; the pricing FAQ separates free editing from paid cloud/
  AI services. Specific local-only settings and permissions need a product trial.
- No exact paid monthly price is asserted. The fetched pricing text did not expose
  complete tier amounts, and editor-seat conditions should be checked before buying.
- Our latest recorded 75 bridge/30 web test results are prior implementation
  evidence, not tests rerun for this research pass. Version stays 0.12.0.

## Official sources

[1] [Working with agents](https://kino.ai/docs/working-with-agents)

[2] [Kino's external-agent workflow comparison](https://kino.ai/comparison/claude-code)

[3] [Footage and storage](https://kino.ai/docs/storage)

[4] [July–October 2026 changelog](https://kino.ai/changelog)

[5] [Product overview](https://kino.ai/)

[6] [Brand matching](https://kino.ai/docs/brand-matching)

[7] [Kino for editors](https://kino.ai/docs/kino-for-editors)

[8] [Pro media formats](https://kino.ai/docs/pro-media-formats)

[9] [Import from other editors](https://kino.ai/docs/import-from-other-editors)

[10] [Pricing FAQ](https://kino.ai/pricing)
