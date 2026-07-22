import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, posix, relative, sep } from "node:path";

import { alignCaptionWords, captionsToSrt, type CaptionCue, type TimedWord } from "./captions.ts";
import { runProcess } from "./media.ts";
import { resolveInputPath, resolveOutputPath } from "./paths.ts";
import { parseEditPlan, type EditPlan, type EditPlanV2 } from "./schema.ts";

type SubtitleProvider = NonNullable<EditPlanV2["timeline"]["subtitleProvider"]>;
type SubtitleProviderMode = SubtitleProvider["mode"];

type CaptionCandidate = {
  id: string;
  revision: number;
  planPath: string;
  plan: EditPlan;
};

export type CaptionGenerationOptions = {
  externalUploadApproved?: boolean;
};

export type CaptionGenerationResult = {
  mode: SubtitleProviderMode;
  status: "generated" | "provided";
  captionsPath: string;
  cues: number;
  audioPath?: string;
  uploadedAudioBytes?: number;
  estimatedCostUsd?: number;
  providerText?: string;
  nextPlan: EditPlanV2;
};

const providerForPlan = (plan: EditPlanV2): SubtitleProvider => {
  if (plan.timeline.subtitleProvider) return plan.timeline.subtitleProvider;
  return plan.timeline.captionsAssetId
    ? { mode: "provided-captions", status: "provided", notes: "Using the attached caption asset." }
    : { mode: "local-whisper", status: "selected", model: "whisper-local", notes: "Local transcription keeps audio on this device." };
};

const workspaceRelativePath = (root: string, path: string) =>
  relative(root, path).split(sep).join(posix.sep);

const atempoChain = (speed: number) => {
  const filters: number[] = [];
  let remaining = speed;
  while (remaining > 2) {
    filters.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push(0.5);
    remaining /= 0.5;
  }
  filters.push(remaining);
  return filters
    .filter((value) => Math.abs(value - 1) > 0.001)
    .map((value) => `atempo=${Number(value.toFixed(3))}`)
    .join(",");
};

const timedClipDuration = (clip: EditPlan["timeline"]["clips"][number]) =>
  (clip.sourceEnd - clip.sourceStart) / clip.speed;

const extractPrimaryAudio = async (
  root: string,
  plan: EditPlanV2,
  requestedOutputPath: string,
) => {
  const outputPath = await resolveOutputPath(root, requestedOutputPath);
  const inputs = await Promise.all(plan.timeline.clips.map(async (clip) => {
    const asset = plan.assets.find((entry) => entry.id === clip.assetId && entry.kind === "video");
    if (!asset) throw new Error(`Missing video asset for clip ${clip.id}`);
    return resolveInputPath(root, asset.path);
  }));
  const filters = plan.timeline.clips.map((clip, index) => {
    const speedFilter = atempoChain(clip.speed);
    const filter = [
      `atrim=start=${Number(clip.sourceStart.toFixed(3))}:end=${Number(clip.sourceEnd.toFixed(3))}`,
      "asetpts=PTS-STARTPTS",
      ...(speedFilter ? [speedFilter] : []),
    ].join(",");
    return `[${index}:a]${filter}[a${index}]`;
  });
  const concatInputs = plan.timeline.clips.map((_, index) => `[a${index}]`).join("");
  const filterComplex = `${filters.join(";")};${concatInputs}concat=n=${plan.timeline.clips.length}:v=0:a=1[outa]`;
  const args = [
    "-y",
    ...inputs.flatMap((inputPath) => ["-i", inputPath]),
    "-filter_complex",
    filterComplex,
    "-map",
    "[outa]",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-vn",
    outputPath,
  ];
  const result = await runProcess("ffmpeg", args, { maxOutputBytes: 1_000_000 });
  if (result.exitCode !== 0) {
    throw new Error(`Could not extract candidate dialogue audio: ${result.stderr.trim()}`);
  }
  return {
    outputPath,
    requestedOutputPath,
    durationSeconds: plan.timeline.clips.reduce((total, clip) => total + timedClipDuration(clip), 0),
    bytes: (await readFile(outputPath)).byteLength,
  };
};

const valueAsRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const collectWords = (value: unknown): TimedWord[] => {
  const record = valueAsRecord(value);
  const directWords = Array.isArray(record.words) ? record.words : [];
  const segmentWords = Array.isArray(record.segments)
    ? record.segments.flatMap((segment) => {
        const segmentRecord = valueAsRecord(segment);
        return Array.isArray(segmentRecord.words) ? segmentRecord.words : [];
      })
    : [];
  return [...directWords, ...segmentWords].flatMap((entry) => {
    const word = valueAsRecord(entry);
    const text = word.word ?? word.text;
    if (typeof text !== "string" || !text.trim()) return [];
    if (typeof word.start !== "number" || typeof word.end !== "number" || word.end <= word.start) return [];
    return [{ word: text.trim(), start: word.start, end: word.end }];
  });
};

const collectSegmentCues = (value: unknown): CaptionCue[] => {
  const segments = valueAsRecord(value).segments;
  if (!Array.isArray(segments)) return [];
  return segments.flatMap((entry) => {
    const segment = valueAsRecord(entry);
    if (typeof segment.text !== "string" || !segment.text.trim()) return [];
    if (typeof segment.start !== "number" || typeof segment.end !== "number" || segment.end <= segment.start) return [];
    return [{ start: segment.start, end: segment.end, text: segment.text.trim() }];
  });
};

const transcriptionText = (value: unknown) => {
  const record = valueAsRecord(value);
  return typeof record.text === "string" ? record.text.trim() : "";
};

const approximateCuesFromText = (text: string, durationSeconds: number): CaptionCue[] => {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const chunks: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && `${current} ${word}`.length > 72) {
      chunks.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) chunks.push(current);
  const safeDuration = Math.max(durationSeconds, chunks.length * 1.5);
  return chunks.map((chunk, index) => ({
    start: Number(((safeDuration * index) / chunks.length).toFixed(3)),
    end: Number(((safeDuration * (index + 1)) / chunks.length).toFixed(3)),
    text: chunk,
  }));
};

export const transcriptionToCaptions = (
  transcription: unknown,
  durationSeconds: number,
) => {
  const words = collectWords(transcription);
  if (words.length > 0) return alignCaptionWords({ words });
  const segmentCues = collectSegmentCues(transcription);
  if (segmentCues.length > 0) return segmentCues;
  return approximateCuesFromText(transcriptionText(transcription), durationSeconds);
};

const transcribeWithLocalWhisper = async (
  audioPath: string,
  provider: SubtitleProvider,
) => {
  const command = process.env.OPENCUT_LOCAL_WHISPER_COMMAND ?? process.env.WHISPER_COMMAND ?? "whisper";
  const outputDirectory = dirname(audioPath);
  const args = [audioPath, "--output_format", "json", "--output_dir", outputDirectory];
  if (provider.language) args.push("--language", provider.language);
  if (provider.model && provider.model !== "whisper-local") args.push("--model", provider.model);
  const result = await runProcess(command, args, { maxOutputBytes: 2_000_000 });
  if (result.exitCode !== 0) {
    throw new Error(`Local Whisper transcription failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  const outputJson = posix.join(outputDirectory.split(sep).join(posix.sep), `${basename(audioPath, extname(audioPath))}.json`);
  const nativeOutputJson = outputJson.split(posix.sep).join(sep);
  return JSON.parse(await readFile(nativeOutputJson, "utf8")) as unknown;
};

const transcribeWithOpenAI = async (
  audioPath: string,
  provider: SubtitleProvider,
) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for OpenAI API transcription");
  const model = provider.model ?? "whisper-1";
  const audio = await readFile(audioPath);
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), basename(audioPath));
  form.set("model", model);
  if (provider.language) form.set("language", provider.language);
  if (model === "whisper-1") {
    form.set("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
  }
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const payload = await response.json() as unknown;
  if (!response.ok) {
    throw new Error(`OpenAI transcription failed: ${JSON.stringify(payload).slice(0, 1_000)}`);
  }
  return payload;
};

const transcribeWithOpenRouter = async (
  audioPath: string,
  provider: SubtitleProvider,
) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for OpenRouter transcription");
  const audio = await readFile(audioPath);
  const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model ?? "openai/whisper-large-v3",
      input_audio: {
        data: audio.toString("base64"),
        format: "wav",
      },
      ...(provider.language ? { language: provider.language } : {}),
    }),
  });
  const payload = await response.json() as unknown;
  if (!response.ok) {
    throw new Error(`OpenRouter transcription failed: ${JSON.stringify(payload).slice(0, 1_000)}`);
  }
  return payload;
};

const transcribeAudio = async (
  audioPath: string,
  provider: SubtitleProvider,
) => {
  if (provider.mode === "local-whisper") return transcribeWithLocalWhisper(audioPath, provider);
  if (provider.mode === "openai-api") return transcribeWithOpenAI(audioPath, provider);
  if (provider.mode === "openrouter") return transcribeWithOpenRouter(audioPath, provider);
  throw new Error(`Provider ${provider.mode} does not transcribe audio`);
};

const providerCost = (value: unknown) => {
  const usage = valueAsRecord(valueAsRecord(value).usage);
  return typeof usage.cost === "number" ? usage.cost : undefined;
};

const withGeneratedCaptionAsset = (
  plan: EditPlanV2,
  provider: SubtitleProvider,
  captionsPath: string,
  result: { status: "generated" | "provided"; estimatedCostUsd?: number; notes: string },
) => {
  const preferredId = plan.timeline.captionsAssetId ?? "captions";
  const existingPreferred = plan.assets.find((asset) => asset.id === preferredId);
  const captionAssetId = existingPreferred && existingPreferred.kind !== "captions"
    ? `captions-r${Date.now()}`
    : preferredId;
  const captionAsset = { id: captionAssetId, path: captionsPath, kind: "captions" as const };
  const assets = plan.assets.some((asset) => asset.id === captionAssetId)
    ? plan.assets.map((asset) => asset.id === captionAssetId ? captionAsset : asset)
    : [...plan.assets, captionAsset];
  return parseEditPlan({
    ...plan,
    assets,
    timeline: {
      ...plan.timeline,
      captionsAssetId: captionAssetId,
      captionStyle: plan.timeline.captionStyle ?? { mode: "both", preset: "clean" },
      subtitleProvider: {
        ...provider,
        status: result.status,
        ...(result.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: result.estimatedCostUsd }),
        notes: result.notes,
      },
    },
  }) as EditPlanV2;
};

export const generateCandidateCaptions = async (
  root: string,
  candidate: CaptionCandidate,
  options: CaptionGenerationOptions = {},
): Promise<CaptionGenerationResult> => {
  if (candidate.plan.version !== "2") {
    throw new Error("Caption provider execution requires a v2 edit plan");
  }
  const provider = providerForPlan(candidate.plan);
  if ((provider.mode === "openai-api" || provider.mode === "openrouter") && !options.externalUploadApproved) {
    throw new Error(`${provider.mode} transcription requires explicit approval to upload extracted audio`);
  }
  if (provider.mode === "provided-captions") {
    const captionsAsset = candidate.plan.assets.find((asset) => asset.id === candidate.plan.timeline.captionsAssetId && asset.kind === "captions");
    if (!captionsAsset) throw new Error("provided-captions requires an attached captions asset");
    const resolvedCaptionsPath = await resolveInputPath(root, captionsAsset.path);
    const contents = await readFile(resolvedCaptionsPath, "utf8");
    const cueCount = contents.split(/\r?\n\r?\n/).filter((block) => block.includes("-->")).length;
    return {
      mode: provider.mode,
      status: "provided",
      captionsPath: captionsAsset.path,
      cues: cueCount,
      nextPlan: withGeneratedCaptionAsset(candidate.plan, provider, captionsAsset.path, {
        status: "provided",
        notes: "Using attached SRT/VTT captions; no transcription provider was called.",
      }),
    };
  }

  const candidateDirectory = posix.dirname(candidate.planPath);
  const audioRelativePath = posix.join(candidateDirectory, ".caption-work", `${candidate.id}-r${candidate.revision}.wav`);
  const captionsRelativePath = posix.join(candidateDirectory, "captions", `${candidate.id}-r${candidate.revision}.srt`);
  const extracted = await extractPrimaryAudio(root, candidate.plan, audioRelativePath);
  const transcription = await transcribeAudio(extracted.outputPath, provider);
  const cues = transcriptionToCaptions(transcription, extracted.durationSeconds);
  if (cues.length === 0) throw new Error("Transcription did not produce usable caption text");
  const captionsOutputPath = await resolveOutputPath(root, captionsRelativePath);
  await writeFile(captionsOutputPath, captionsToSrt(cues), "utf8");
  const estimatedCostUsd = providerCost(transcription) ?? provider.estimatedCostUsd;
  const uploadedAudioBytes = provider.mode === "openai-api" || provider.mode === "openrouter" ? extracted.bytes : undefined;
  const providerText = transcriptionText(transcription);
  return {
    mode: provider.mode,
    status: "generated",
    captionsPath: workspaceRelativePath(root, captionsOutputPath),
    cues: cues.length,
    audioPath: extracted.requestedOutputPath,
    uploadedAudioBytes,
    estimatedCostUsd,
    providerText,
    nextPlan: withGeneratedCaptionAsset(candidate.plan, provider, workspaceRelativePath(root, captionsOutputPath), {
      status: "generated",
      estimatedCostUsd,
      notes: provider.mode === "local-whisper"
        ? "Generated with local Whisper; no transcription API upload."
        : `Generated with ${provider.mode}; uploaded extracted mono WAV audio only.`,
    }),
  };
};
