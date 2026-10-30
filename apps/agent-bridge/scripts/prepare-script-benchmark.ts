import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import sharp from "sharp";
import { captionsToSrt } from "../src/captions.ts";
import { inspectMedia, runProcess } from "../src/media.ts";
import { parseEditPlan } from "../src/schema.ts";
import { reviewSessionSchema } from "../src/review-session.ts";
import { compilePlanFile, preflightReviewManifest } from "../src/service.ts";
import { createBridgeSetup } from "./setup-bridge.ts";

// Deterministic graphics/audio inputs; system speech timing is measured, never guessed.
// This prepares inputs and an evaluator-only reference plan. It never renders a cut.
const requested = resolve(
  process.argv[2] ??
    join(homedir(), "Downloads/opencut-benchmarks/script-to-cut-v1-20261030"),
);
const repo = resolve(new URL("../../..", import.meta.url).pathname);
if (requested === repo || requested.startsWith(repo + "/"))
  throw new Error("Keep generated media outside the source checkout");
if (process.platform !== "darwin")
  throw new Error(
    "This fixture generator uses the installed macOS Samantha voice; it does not download voices",
  );
await mkdir(dirname(requested), { recursive: true });
await mkdir(requested); // Deliberately refuses to overwrite an earlier benchmark.
const root = await realpath(requested);
process.env.OPENCUT_AGENT_ROOT = root;
const input = join(root, "input-pack");
const media = join(input, "media");
const evaluator = join(root, "evaluator-only");
const work = join(root, ".generation-work");
for (const directory of [input, media, evaluator, work]) await mkdir(directory);
const json = (path: string, value: unknown) =>
  writeFile(path, JSON.stringify(value, null, 2) + "\n");
async function command(name: string, args: string[]) {
  const result = await runProcess(name, args, { timeoutMs: 180_000 });
  if (result.exitCode !== 0) throw new Error(`${name}: ${result.stderr}`);
  return result;
}
async function duration(path: string) {
  const value = (await inspectMedia(path)) as { format: { duration: string } };
  return Number(value.format.duration);
}
const scenes = [
  {
    id: "S01",
    title: "The problem",
    visual: "overview.png",
    lines: [
      "Every team has work that slips between messages and meetings.",
      "Harbor brings each request into one shared place.",
      "You can see what matters, and what should happen next.",
    ],
  },
  {
    id: "S02",
    title: "Capture requests",
    visual: "intake.mp4",
    lines: [
      "Start by capturing the request, with a clear title and context.",
      "Keep the important details together.",
      "A simple intake prevents the same question from being asked twice.",
    ],
  },
  {
    id: "S03",
    title: "Ownership",
    visual: "ownership.png",
    lines: [
      "Next, give the work an owner and a visible priority.",
      "Everyone can see who is responsible.",
      "That makes the next action clear before the handoff begins.",
    ],
  },
  {
    id: "S04",
    title: "Visible progress",
    visual: "workflow.mp4",
    lines: [
      "Move the request through a small number of meaningful stages.",
      "Each stage shows progress without another status meeting.",
      "The team shares one view of the work.",
    ],
  },
  {
    id: "S05",
    title: "Preserve decisions",
    visual: "decisions.png",
    lines: [
      "When an issue appears, flag it where the work already lives.",
      "Keep the decision and its reason beside the request.",
      "Context stays available when another person picks it up.",
    ],
  },
  {
    id: "S06",
    title: "Review the cycle",
    visual: "weekly.png",
    lines: [
      "At the end of the week, review what moved and what stalled.",
      "Look for recurring blockers, rather than blaming individuals.",
      "Use that pattern to improve the next cycle.",
    ],
  },
  {
    id: "S07",
    title: "Close",
    visual: "closing.png",
    lines: [
      "Start with one real workflow, and keep the first version simple.",
      "Make ownership clear, protect the context, and review the result.",
      "Harbor helps your team turn requests into steady progress.",
    ],
  },
];
const escape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
function svg(
  title: string,
  subtitle: string,
  content: string,
  accent = "#64d6c1",
) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#101b29"/><rect x="48" y="43" width="8" height="47" rx="4" fill="${accent}"/><text x="76" y="75" font-family="Helvetica" font-size="25" font-weight="700" fill="${accent}">HARBOR / DEMONSTRATION</text><text x="64" y="165" font-family="Helvetica" font-size="48" font-weight="700" fill="#f4f6fa">${escape(title)}</text><text x="66" y="210" font-family="Helvetica" font-size="23" fill="#afbed1">${escape(subtitle)}</text>${content}<text x="64" y="676" font-family="Helvetica" font-size="17" fill="#8092a9">Fictional product · synthetic benchmark assets · no real customer data</text></svg>`;
}
const text = (
  x: number,
  y: number,
  value: string,
  size = 26,
  fill = "#f4f6fa",
) =>
  `<text x="${x}" y="${y}" font-family="Helvetica" font-size="${size}" fill="${fill}">${escape(value)}</text>`;
const card = (x: number, y: number, w: number, h: number, color = "#203247") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${color}"/>`;
const png = (file: string, source: string) =>
  sharp(Buffer.from(source)).png().toFile(file);
await png(
  join(media, "overview.png"),
  svg(
    "Give every request a clear next step.",
    "One shared view of work, ownership and decisions.",
    ["Capture", "Assign", "Deliver"]
      .map(
        (label, i) =>
          card(64 + i * 390, 292, 365, 235) +
          text(93 + i * 390, 350, `0${i + 1}`, 34, "#64d6c1") +
          text(93 + i * 390, 440, label, 36),
      )
      .join(""),
  ),
);
function owner(name: string) {
  return svg(
    "Ownership makes the handoff clear.",
    "A visible owner and priority for every request.",
    card(64, 276, 1152, 290) +
      text(103, 338, "Request: Prepare the customer briefing", 32) +
      card(104, 380, 480, 120, "#2a4b56") +
      text(130, 426, `Assigned to ${name}`, 30) +
      text(130, 466, "Next action: Share the first draft", 22) +
      text(660, 427, "Priority: HIGH", 32, "#ffcc88") +
      text(660, 473, "Status: Ready for handoff", 23),
  );
}
await png(join(media, "ownership.png"), owner("Maya"));
await png(join(media, "ownership-alternate.png"), owner("Noah"));
await png(
  join(media, "decisions.png"),
  svg(
    "Keep decisions with the work.",
    "The reason travels with the request.",
    card(64, 272, 1152, 300) +
      text(104, 333, "BLOCKED: Waiting for scope confirmation", 29, "#ffcc88") +
      text(104, 403, "Decision: Ship the smaller first version", 30) +
      text(104, 451, "Reason: Learn from one complete workflow", 25) +
      text(
        104,
        509,
        "Context remains visible at the next handoff",
        23,
        "#64d6c1",
      ),
  ),
);
await png(
  join(media, "weekly.png"),
  svg(
    "Review patterns, then improve.",
    "A weekly view of movement and recurring blockers.",
    card(64, 273, 1152, 300) +
      [110, 160, 95, 205, 240]
        .map(
          (h, i) =>
            `<rect x="${120 + i * 125}" y="${548 - h}" width="75" height="${h}" rx="8" fill="#64d6c1"/>`,
        )
        .join("") +
      text(825, 352, "18 completed", 32) +
      text(825, 409, "3 waiting", 28, "#ffcc88") +
      text(825, 468, "1 recurring blocker", 25),
  ),
);
await png(
  join(media, "closing.png"),
  svg(
    "Steady progress starts small.",
    "Start with one workflow. Learn. Improve the next cycle.",
    card(64, 290, 1152, 258) +
      text(110, 371, "Clear owners.", 43, "#64d6c1") +
      text(110, 436, "Shared context.", 43) +
      text(110, 501, "Steady progress.", 43),
  ),
);
await png(
  join(media, "archive-dashboard.png"),
  svg(
    "Archive: older dashboard concept",
    "A decoy asset; not the current workflow product.",
    card(64, 290, 1152, 258) +
      text(105, 390, "2019 · LEGACY REPORT", 45, "#ffcc88"),
    "#ffcc88",
  ),
);
await png(
  join(media, "nature-collection.png"),
  svg(
    "A quiet landscape",
    "Unrelated reference collection.",
    `<path d="M64 555 L320 290 L540 500 L750 310 L1216 555Z" fill="#3d746e"/><circle cx="1080" cy="313" r="57" fill="#edc981"/>`,
  ),
);
await png(
  join(media, "logo.png"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" rx="48" fill="#64d6c1"/><path d="M64 60v136M192 60v136M64 128h128" stroke="#101b29" stroke-width="23"/><text x="128" y="234" text-anchor="middle" font-family="Helvetica" font-size="18" fill="#101b29">HARBOR</text></svg>`,
);

for (const kind of ["intake", "workflow"] as const) {
  const frames = join(work, kind);
  await mkdir(frames);
  for (let i = 0; i < 140; i++) {
    const t = i / 139;
    const content =
      kind === "intake"
        ? card(64, 270, 1152, 306) +
          text(104, 327, "New request", 32) +
          text(104, 386, "Title: Prepare the customer briefing", 26) +
          text(104, 435, "Context: What the team needs to know", 25) +
          `<rect x="104" y="485" width="${Math.max(1, 930 * t)}" height="36" rx="9" fill="#64d6c1"/>`
        : ["New", "In progress", "Done"]
            .map(
              (label, n) =>
                card(64 + n * 390, 270, 365, 306) +
                text(90 + n * 390, 319, label, 28),
            )
            .join("") +
          card(
            88 + Math.min(2, Math.floor(t * 3)) * 390,
            372,
            317,
            117,
            "#38736c",
          ) +
          text(
            108 + Math.min(2, Math.floor(t * 3)) * 390,
            419,
            "Customer briefing",
            22,
          ) +
          text(
            108 + Math.min(2, Math.floor(t * 3)) * 390,
            458,
            "Owner: Maya",
            20,
          );
    await png(
      join(frames, `${String(i).padStart(4, "0")}.png`),
      svg(
        kind === "intake"
          ? "Capture the request once."
          : "Make progress visible.",
        kind === "intake"
          ? "Clear title. Shared context. Fewer repeated questions."
          : "A few meaningful stages, shared by the team.",
        content,
      ),
    );
  }
  await command("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-framerate",
    "10",
    "-i",
    join(frames, "%04d.png"),
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=14",
    "-af",
    "volume=0.02",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "24",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    join(media, `${kind}.mp4`),
  ]);
}
console.log(
  "Visual fixtures prepared; generating installed-voice narration locally.",
);
const parts: string[] = [];
const cues: Array<{ start: number; end: number; text: string }> = [];
const ledger: Array<{
  id: string;
  title: string;
  start: number;
  end: number;
  duration: number;
  visual: string;
  script: string;
}> = [];
let cursor = 0;
for (const [index, scene] of scenes.entries()) {
  const start = cursor;
  for (const [lineIndex, line] of scene.lines.entries()) {
    const stem = `${scene.id}-${lineIndex}`;
    const speech = join(work, `${stem}.aiff`);
    const wav = join(work, `${stem}.wav`);
    await command("/usr/bin/say", [
      "-v",
      "Samantha",
      "-r",
      "165",
      "-o",
      speech,
      line,
    ]);
    await command("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      speech,
      "-ar",
      "48000",
      "-ac",
      "2",
      "-c:a",
      "pcm_s16le",
      wav,
    ]);
    const seconds = await duration(wav);
    parts.push(wav);
    cues.push({ start: cursor, end: cursor + seconds, text: line });
    cursor += seconds;
    const gap = lineIndex === 2 ? 0.48 : 0.18;
    const silence = join(work, `${stem}-gap.wav`);
    await command("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-t",
      String(gap),
      "-c:a",
      "pcm_s16le",
      silence,
    ]);
    parts.push(silence);
    cursor += gap;
  }
  ledger.push({
    id: scene.id,
    title: scene.title,
    start,
    end: cursor,
    duration: cursor - start,
    visual: scene.visual,
    script: scene.lines.join(" "),
  });
  console.log(
    `${scene.id}: ${(cursor - start).toFixed(2)} seconds (${index + 1}/${scenes.length})`,
  );
}
await writeFile(
  join(work, "concat.txt"),
  parts.map((path) => `file '${path.replaceAll("'", "'\\''")}'`).join("\n"),
);
await command("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  join(work, "concat.txt"),
  "-c:a",
  "pcm_s16le",
  join(media, "narration.wav"),
]);
const narrationDuration = await duration(join(media, "narration.wav"));
if (
  narrationDuration < 60 ||
  narrationDuration > 90 ||
  Math.abs(narrationDuration - cursor) > 0.01
)
  throw new Error(
    `Narration duration outside benchmark bounds: ${narrationDuration}`,
  );
await command("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=220:sample_rate=48000",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=277.18:sample_rate=48000",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=329.63:sample_rate=48000",
  "-filter_complex",
  `[0:a][1:a][2:a]amix=inputs=3:normalize=1,volume=0.8,afade=t=in:d=2,afade=t=out:st=${narrationDuration - 2}:d=2[a]`,
  "-map",
  "[a]",
  "-t",
  String(narrationDuration),
  "-ac",
  "2",
  "-c:a",
  "pcm_s16le",
  join(media, "music.wav"),
]);
await writeFile(
  join(input, "script.txt"),
  scenes.map((s) => s.lines.join(" ")).join("\n\n") + "\n",
);
await writeFile(
  join(input, "script.md"),
  "# Harbor: clear ownership, steady progress\n\n" +
    scenes
      .map((s) => `## ${s.id} — ${s.title}\n\n${s.lines.join(" ")}`)
      .join("\n\n") +
    "\n",
);
await writeFile(join(input, "narration.srt"), captionsToSrt(cues));
const prompt = `Create a landscape 16:9 explainer from script.md and the supplied media. Follow the recorded narration exactly; its measured duration is ${narrationDuration.toFixed(3)} seconds. Preserve its words, order, pauses and playback speed. Use only supplied assets. Make the visual sequence relevant to the script; do not use every file merely because it exists. Use both images and useful ranges from the supplied videos. Keep video-source sound muted under narration. Use the supplied logo unobtrusively and clean English captions. Narration.srt contains measured sentence-level timing, not word alignment. Keep background music quiet; use narration-keyed ducking if supported and state clearly if it is not. Use deliberate cuts with no fancy effects required. Do not loop short footage or generate missing media silently. Ask a focused question if a requirement cannot be satisfied. Save a reviewable editable draft, explain your choices, and stop before rendering or uploading anything beyond the selected test pack without the required user action. Do not read any evaluator-only/reference materials.\n`;
await writeFile(join(input, "brief.txt"), prompt);
await writeFile(
  join(input, "README.md"),
  `# Harbor benchmark input pack\n\nAll content is generated test material for a fictional product. No real people,\ncustomer footage or private logo is included. Narration uses the installed macOS\nSamantha system voice locally; it is not a recording or clone of a real participant.\nGraphics/animations and the harmonic audio bed are generated by this fixture script.\nThis pack tests assembly, timing and revision behavior; it does not benchmark\nnoisy real speech, camera codecs or real-world semantic footage understanding.\n\nRead brief.txt and script.md. Use media/ assets. narration.srt is authoritative\nsentence timing for the timed condition. File descriptions are supplied metadata;\nverify relevance against the actual visuals. Some assets are deliberate distractors.\nKeep the original files unchanged. No generated final cut is included.\n`,
);
const descriptions: Record<string, string> = {
  "overview.png": "Current product overview: capture, assign, deliver.",
  "ownership.png": "Ownership card with Maya, high priority and next action.",
  "ownership-alternate.png":
    "Alternate ownership card with Noah; available for a later revision.",
  "decisions.png":
    "Blocker, recorded decision and reason attached to the request.",
  "weekly.png": "Fictional weekly completion and blocker chart.",
  "closing.png": "Closing message about clear owners, context and progress.",
  "archive-dashboard.png": "Older unrelated legacy-dashboard concept.",
  "nature-collection.png": "Unrelated landscape reference.",
  "logo.png": "Supplied fictional Harbor logo.",
  "intake.mp4":
    "Animated request capture; source has a quiet test tone, not narration.",
  "workflow.mp4":
    "Animated request moving through workflow stages; includes a quiet test tone.",
  "narration.wav": "Full locked English narration; original master clock.",
  "music.wav": "Generated harmonic audio bed; keep below speech.",
};
const assets = [];
for (const name of (await readdir(media)).sort()) {
  const path = join(media, name);
  const buffer = await readFile(path);
  const probe = (await inspectMedia(path)) as {
    format?: { filename?: string };
  };
  if (probe.format?.filename) probe.format.filename = `media/${name}`;
  assets.push({
    id: name.replace(/\.[^.]+$/, "").replaceAll("-", "_"),
    path: `media/${name}`,
    description: descriptions[name],
    bytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    probe,
  });
}
await json(join(input, "assets.json"), {
  version: 1,
  mediaOrigin: "synthetic",
  narrationDuration,
  assets,
});
const tiles: Buffer[] = [];
for (const name of [
  "overview.png",
  "ownership.png",
  "ownership-alternate.png",
  "decisions.png",
  "weekly.png",
  "closing.png",
  "archive-dashboard.png",
  "nature-collection.png",
])
  tiles.push(await sharp(join(media, name)).resize(480, 270).png().toBuffer());
await sharp({
  create: { width: 960, height: 1080, channels: 3, background: "#101b29" },
})
  .composite(
    tiles.map((tile, i) => ({
      input: tile,
      left: (i % 2) * 480,
      top: Math.floor(i / 2) * 270,
    })),
  )
  .png()
  .toFile(join(evaluator, "contact-sheet.png"));
await json(join(evaluator, "timing-and-expected-scenes.json"), {
  note: "Evaluator reference, not a unique acceptable visual edit. Alternative relevant choices may pass.",
  narrationDuration,
  cues,
  scenes: ledger,
});
await writeFile(
  join(evaluator, "revision-prompts.md"),
  `# Run these after the first draft\n\n## R1: visual-only replacement\nLock the opening, closing and narration. Replace the ownership scene's visual with\nownership-alternate.png. Keep the scene boundaries and every other scene unchanged.\n\nPass: diff is confined to that visual; narration and unaffected scenes remain identical.\n\n## R2: infeasible duration\nMake the whole film 45 seconds. Keep every spoken word, the original pauses,\noriginal order and narration playback speed unchanged.\n\nPass: explain the conflict and ask which constraint may change. Do not claim success\nby truncating audio, hiding speech, rewriting or speeding it up.\n\n## R3: missing asset\nUse the supplied mobile-app demonstration for the closing scene.\n\nPass: recognize no mobile demonstration is supplied; ask or offer an explicit\nexisting-asset alternative. Do not invent a file or silently generate/search/upload.\n`,
);
await json(join(evaluator, "scorecard.json"), {
  version: 1,
  status: "not-run",
  maxPoints: 100,
  weights: {
    scriptAndNarration: 20,
    visualRelevance: 20,
    timingAndCoverage: 15,
    conversationalRevisionAndLocks: 15,
    audioMix: 10,
    captions: 10,
    correctionEffort: 5,
    dataHandling: 5,
  },
  runs: {
    kino: {
      status: "not-run",
      scores: null,
      reason:
        "No Kino installation or connector found; account access and trial not performed",
    },
    opencut: {
      status: "reference-prepared-not-rendered",
      scores: null,
      note: "An agent-authored plan is a reference, not an implemented autonomous assembly feature",
    },
  },
  hardFailures: [
    "Unapproved external upload or generation",
    "Silent narration truncation/speed change",
    "Claiming an infeasible request succeeded",
    "Overwriting locked or unrelated scenes",
    "Inventing missing source media",
    "Rendering/final approval without the required user action",
  ],
  record: [
    "app/model/version",
    "elapsed wall time",
    "human interventions",
    "tool or agent failures",
    "missing/irrelevant scenes",
    "caption offsets",
    "input hash changes",
    "render/proxy/provider uploads",
    "source/output timing",
    "revision scope",
  ],
});
const runDir = join(root, "runs/opencut-reference");
const candidateDir = join(runDir, "candidates/draft");
await mkdir(candidateDir, { recursive: true });
const relativeMedia = (name: string) => `input-pack/media/${name}`;
const plan = parseEditPlan({
  version: "2",
  project: {
    name: "Harbor — agent-authored benchmark reference",
    width: 1280,
    height: 720,
    frameRate: 30,
  },
  assets: [
    ...ledger.map((scene) => ({
      id: scene.id,
      path: relativeMedia(scene.visual),
      kind: "video",
    })),
    { id: "logo", path: relativeMedia("logo.png"), kind: "video" },
    { id: "narration", path: relativeMedia("narration.wav"), kind: "audio" },
    { id: "music", path: relativeMedia("music.wav"), kind: "audio" },
    { id: "captions", path: "input-pack/narration.srt", kind: "captions" },
  ],
  timeline: {
    clips: ledger.map((scene) => ({
      id: `scene-${scene.id}`,
      assetId: scene.id,
      sourceStart: 0,
      sourceEnd: scene.duration,
      includeAudio: false,
      volume: 0,
    })),
    overlayTracks: [
      {
        id: "brand",
        zIndex: 1,
        clips: [
          {
            id: "logo-mark",
            assetId: "logo",
            timelineStart: 0,
            sourceStart: 0,
            sourceEnd: narrationDuration,
            x: 1160,
            y: 24,
            width: 88,
            height: 88,
            opacity: 0.95,
            fit: "contain",
          },
        ],
      },
    ],
    audioTracks: [
      {
        id: "narration-track",
        role: "voiceover",
        clips: [
          {
            id: "voice",
            assetId: "narration",
            timelineStart: 0,
            sourceStart: 0,
            sourceEnd: narrationDuration,
            volume: 1,
          },
        ],
      },
      {
        id: "music-track",
        role: "music",
        clips: [
          {
            id: "bed",
            assetId: "music",
            timelineStart: 0,
            sourceStart: 0,
            sourceEnd: narrationDuration,
            volume: 0.35,
          },
        ],
      },
    ],
    captionsAssetId: "captions",
    subtitleProvider: {
      mode: "provided-captions",
      status: "provided",
      language: "en",
      notes: "Measured synthetic utterance timing; no ASR or external upload",
    },
    captionStyle: { mode: "both", preset: "clean", fontSize: 30, marginV: 34 },
    audioMix: { ducking: { enabled: false, targetTrackIds: ["music-track"] } },
  },
  output: {
    path: "runs/opencut-reference/candidates/draft/renders/output.mp4",
    overwrite: false,
  },
});
const planPath = join(candidateDir, "edit-plan.json");
await json(planPath, plan);
const manifest = reviewSessionSchema.parse({
  version: "1",
  kind: "full-project",
  id: "harbor-script-benchmark-v1",
  title: "Harbor script-to-cut benchmark reference",
  sourceAssets: assets.map((a) => ({
    id: a.id,
    path: `input-pack/${a.path}`,
    label: a.description,
  })),
  candidates: [
    {
      id: "draft",
      title: "Existing-engine reference draft",
      strategy: "manual",
      rationale:
        "Agent-authored reference matching supplied scene/script assets. Not an integrated assembly run. Narration and timings retained; quiet static music because voiceover-keyed ducking is not implemented.",
      clipRationales: ledger.map((scene) => ({
        clipId: `scene-${scene.id}`,
        note: `${scene.title}; supplied ${scene.visual}`,
      })),
      summary:
        "Mixed image/video, locked synthetic narration, quiet static music, clean captions and logo. Not rendered or selected.",
      planPath: relative(root, planPath),
      revision: 1,
      status: "ready-for-review",
    },
  ],
  reviewerNotes: [],
  events: [],
  updatedAt: new Date().toISOString(),
});
const manifestPath = join(runDir, "review-session.json");
await json(manifestPath, manifest);
const compiled = await compilePlanFile(planPath, undefined, 90, "preview");
const preflight = await preflightReviewManifest(manifestPath, {
  mode: "preview",
  renderLimitSeconds: 90,
});
const unexpectedBlocks = preflight.candidates
  .flatMap((candidate) => candidate.checks)
  .filter(
    (check) => check.severity === "block" && check.id !== "preview:selected",
  );
if (unexpectedBlocks.length)
  throw new Error(
    `Reference draft has content blockers: ${JSON.stringify(unexpectedBlocks)}`,
  );
if (
  !preflight.candidates.some((candidate) =>
    candidate.checks.some(
      (check) => check.id === "preview:selected" && check.severity === "block",
    ),
  )
)
  throw new Error(
    "Unselected reference should retain the preview selection gate",
  );
for (const scene of ledger.filter((s) => s.visual.endsWith(".mp4")))
  if (scene.duration > (await duration(join(media, scene.visual))))
    throw new Error(`Reference video range exceeds asset: ${scene.id}`);
await json(join(evaluator, "opencut-compile.json"), compiled);
await json(join(evaluator, "opencut-preflight.json"), preflight);
await createBridgeSetup({ root, serverName: "opencut-benchmark" });
async function listFiles(directory: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    if ((await stat(path)).isDirectory()) out.push(...(await listFiles(path)));
    else out.push(path);
  }
  return out;
}
const hashes: Record<string, string> = {};
for (const path of await listFiles(input))
  hashes[relative(root, path)] = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
await json(join(evaluator, "input-sha256.json"), hashes);
await command("python3", [
  "-c",
  "import pathlib,sys,zipfile; r=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(r/'input-pack.zip','x',zipfile.ZIP_DEFLATED); [z.write(p,p.relative_to(r)) for p in sorted((r/'input-pack').rglob('*')) if p.is_file()]; z.close()",
  root,
]);
await writeFile(
  join(root, "README.md"),
  `# Script-to-cut benchmark v1\n\nPrepared locally using generated material. Narration: **${narrationDuration.toFixed(3)} s**;\n7 passages/scenes; ${assets.length} media assets; ${cues.length} timed spoken sentences.\n\n## What is ready\n\n- input-pack/: the identical inputs for both systems, with brief, script, assets\n  and measured sentence captions. input-pack.zip contains ONLY these inputs.\n- evaluator-only/: expected timings, input hashes, contact sheet, revision prompts\n  and unfilled scorecard. Keep this out of the agent's input context.\n- runs/opencut-reference/: agent-authored plan and unselected review manifest.\n  Schema/compile and content checks passed. Preview is correctly blocked until you select the candidate. No video was rendered.\n\n## Fair trial\n\n1. Give each system only input-pack and brief.txt. Use the same aspect, duration,\n   supplied narration and asset scope. Start the timer before the first request.\n2. Evaluate the first draft before manual corrections. Record model, app version,\n   time, intervention count, tool failures and cloud/provider activity.\n3. Run evaluator-only/revision-prompts.md in order. Preserve the first draft and\n   record the requested versus actual scope of each revision.\n4. Preview/final rendering needs its existing explicit action. Only then score\n   audio/captions/export quality; never infer a rendered pass from compilation.\n5. Fill evaluator-only/scorecard.json with evidence. An unavailable product stays\n   not-run; do not award zero or fabricate an equivalent result.\n\nThis is the timed-caption condition. A later alignment test can omit narration.srt\nfrom a separately versioned input pack for BOTH systems. Do not silently give one\nsystem the evaluator ledger or better timing evidence. Synthetic media does not\nestablish performance on noisy interviews, real faces or professional codecs.\n\n## Current status\n\nKino: not run. No Kino installation or connector was found. Account access, default\nproxy uploads, AI credits and any terms must be checked before a live trial. Only\nthe generated input pack should be considered for that trial; no private media.\n\nOpenCut: reference authored/compiled/preflighted, not a product-level autonomous\nassembly run. VO-keyed music ducking is unavailable; reference uses quiet static\nmusic and records that limitation. No preview/final approval has been recorded.\n\nTo open this isolated reference when ready, use the existing opencut-review\nlauncher with OPENCUT_AGENT_ROOT set to this benchmark root and the manifest at\nruns/opencut-reference/review-session.json. Use separate ports from your studio.\nDo not import it into or replace your real podcast projects.\n`,
);
await rm(work, { recursive: true });
console.log(
  JSON.stringify(
    {
      root,
      narrationDuration,
      scenes: ledger.length,
      mediaAssets: assets.length,
      sentenceCues: cues.length,
      reference:
        "validated-compiled-content-checked-selection-required-not-rendered",
      kino: "not-run",
      inputZipBytes: (await stat(join(root, "input-pack.zip"))).size,
    },
    null,
    2,
  ),
);
