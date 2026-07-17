import { getPlanDuration, type EditPlan, type EditPlanV1, type EditPlanV2 } from "./schema.ts";

export type ResolvedAsset = {
  id: string;
  path: string;
  kind: "video" | "audio" | "captions";
};

export type CompiledEdit = {
  command: "ffmpeg";
  args: string[];
  durationSeconds: number;
  outputPath: string;
};

export type RenderProfile = "preview" | "final";

const formatNumber = (value: number) => Number(value.toFixed(6)).toString();

const buildAtempoFilters = (speed: number) => {
  const filters: string[] = [];
  let remainingSpeed = speed;
  while (remainingSpeed < 0.5) {
    filters.push("atempo=0.5");
    remainingSpeed /= 0.5;
  }
  while (remainingSpeed > 2) {
    filters.push("atempo=2");
    remainingSpeed /= 2;
  }
  filters.push(`atempo=${formatNumber(remainingSpeed)}`);
  return filters;
};

const inputDuration = (clip: { sourceStart: number; sourceEnd: number }) =>
  clip.sourceEnd - clip.sourceStart;

const outputDuration = (clip: { sourceStart: number; sourceEnd: number; speed: number }) =>
  inputDuration(clip) / clip.speed;

const pushTrimmedInput = (
  args: string[],
  clip: { sourceStart: number; sourceEnd: number },
  path: string,
) => {
  args.push(
    "-ss",
    formatNumber(clip.sourceStart),
    "-t",
    formatNumber(inputDuration(clip)),
    "-i",
    path,
  );
};

const baseVideoFilters = (plan: EditPlan, inputIndex: number, speed: number, label: string) => {
  const background = `0x${plan.project.background.slice(1)}`;
  return (
    `[${inputIndex}:v:0]setpts=(PTS-STARTPTS)/${formatNumber(speed)},` +
    `scale=${plan.project.width}:${plan.project.height}:force_original_aspect_ratio=decrease,` +
    `pad=${plan.project.width}:${plan.project.height}:(ow-iw)/2:(oh-ih)/2:color=${background},` +
    `fps=${formatNumber(plan.project.frameRate)},format=yuv420p[${label}]`
  );
};

const clipAudioFilters = (
  inputIndex: number,
  speed: number,
  volume: number,
  label: string,
  timelineStart?: number,
) => {
  const filters = [
    "asetpts=PTS-STARTPTS",
    ...buildAtempoFilters(speed),
    `volume=${formatNumber(volume)}`,
    "aresample=48000",
  ];
  if (timelineStart !== undefined && timelineStart > 0) {
    const delay = Math.round(timelineStart * 1_000);
    filters.push(`adelay=${delay}|${delay}`);
  }
  return `[${inputIndex}:a:0]${filters.join(",")}[${label}]`;
};

const appendCaptionsAndEncoding = (
  args: string[],
  plan: EditPlan,
  assetsById: Map<string, ResolvedAsset>,
  captionsInputIndex: number,
  profile: RenderProfile,
  durationSeconds: number,
  durationLimitSeconds: number | undefined,
  outputPath: string,
) => {
  if (plan.timeline.captionsAssetId) {
    const captions = assetsById.get(plan.timeline.captionsAssetId);
    if (!captions) {
      throw new Error(`Resolved captions asset missing: ${plan.timeline.captionsAssetId}`);
    }
    args.push("-i", captions.path);
  }

  args.push("-map", "[vout]", "-map", "[aout]");
  if (plan.timeline.captionsAssetId) {
    args.push("-map", `${captionsInputIndex}:s:0`, "-c:s", "mov_text");
  }
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    profile === "final" ? "medium" : "ultrafast",
    "-crf",
    profile === "final" ? "20" : "32",
    "-c:a",
    "aac",
    "-b:a",
    profile === "final" ? "192k" : "96k",
    "-movflags",
    "+faststart",
  );
  if (durationLimitSeconds !== undefined) {
    args.push("-t", formatNumber(Math.min(durationSeconds, durationLimitSeconds)));
  }
  args.push(outputPath);
};

const compileV1 = (
  plan: EditPlanV1,
  assetsById: Map<string, ResolvedAsset>,
  outputPath: string,
  durationLimitSeconds: number | undefined,
  profile: RenderProfile,
): CompiledEdit => {
  const args = ["-hide_banner", "-loglevel", "error", plan.output.overwrite ? "-y" : "-n"];
  const filterParts: string[] = [];
  let durationSeconds = 0;

  for (const [index, clip] of plan.timeline.clips.entries()) {
    const asset = assetsById.get(clip.assetId);
    if (!asset) throw new Error(`Resolved asset missing: ${clip.assetId}`);
    const clipDuration = outputDuration(clip);
    durationSeconds += clipDuration;
    pushTrimmedInput(args, clip, asset.path);
    filterParts.push(baseVideoFilters(plan, index, clip.speed, `v${index}`));
    if (clip.includeAudio) {
      filterParts.push(clipAudioFilters(index, clip.speed, clip.volume, `a${index}`));
    } else {
      filterParts.push(
        `anullsrc=r=48000:cl=stereo,atrim=duration=${formatNumber(clipDuration)},` +
          `asetpts=PTS-STARTPTS[a${index}]`,
      );
    }
  }

  const concatInputs = plan.timeline.clips.map((_, index) => `[v${index}][a${index}]`).join("");
  filterParts.push(`${concatInputs}concat=n=${plan.timeline.clips.length}:v=1:a=1[vout][aout]`);
  args.push("-filter_complex", filterParts.join(";"));
  appendCaptionsAndEncoding(
    args,
    plan,
    assetsById,
    plan.timeline.clips.length,
    profile,
    durationSeconds,
    durationLimitSeconds,
    outputPath,
  );
  return { command: "ffmpeg", args, durationSeconds, outputPath };
};

const overlayScaleFilters = (clip: EditPlanV2["timeline"]["overlayTracks"][number]["clips"][number]) => {
  if (clip.fit === "stretch") return `scale=${clip.width}:${clip.height}`;
  if (clip.fit === "cover") {
    return (
      `scale=${clip.width}:${clip.height}:force_original_aspect_ratio=increase,` +
      `crop=${clip.width}:${clip.height}`
    );
  }
  return (
    `scale=${clip.width}:${clip.height}:force_original_aspect_ratio=decrease,` +
    `pad=${clip.width}:${clip.height}:(ow-iw)/2:(oh-ih)/2:color=black@0`
  );
};

const compileV2 = (
  plan: EditPlanV2,
  assetsById: Map<string, ResolvedAsset>,
  outputPath: string,
  durationLimitSeconds: number | undefined,
  profile: RenderProfile,
): CompiledEdit => {
  const args = ["-hide_banner", "-loglevel", "error", plan.output.overwrite ? "-y" : "-n"];
  const filterParts: string[] = [];
  let inputIndex = 0;
  let primaryDuration = 0;

  for (const [index, clip] of plan.timeline.clips.entries()) {
    const asset = assetsById.get(clip.assetId);
    if (!asset) throw new Error(`Resolved asset missing: ${clip.assetId}`);
    const clipDuration = outputDuration(clip);
    primaryDuration += clipDuration;
    pushTrimmedInput(args, clip, asset.path);
    filterParts.push(baseVideoFilters(plan, inputIndex, clip.speed, `pv${index}`));
    if (clip.includeAudio) {
      filterParts.push(clipAudioFilters(inputIndex, clip.speed, clip.volume, `pa${index}`));
    } else {
      filterParts.push(
        `anullsrc=r=48000:cl=stereo,atrim=duration=${formatNumber(clipDuration)},` +
          `asetpts=PTS-STARTPTS[pa${index}]`,
      );
    }
    inputIndex += 1;
  }

  const primaryInputs = plan.timeline.clips.map((_, index) => `[pv${index}][pa${index}]`).join("");
  filterParts.push(
    `${primaryInputs}concat=n=${plan.timeline.clips.length}:v=1:a=1[primaryv][primarya0]`,
  );

  const durationSeconds = getPlanDuration(plan);
  const extension = Math.max(0, durationSeconds - primaryDuration);
  if (extension > 0) {
    filterParts.push(
      `[primaryv]tpad=stop_mode=clone:stop_duration=${formatNumber(extension)}[canvas0]`,
      `[primarya0]apad=pad_dur=${formatNumber(extension)}[primarya]`,
    );
  } else {
    filterParts.push("[primaryv]null[canvas0]", "[primarya0]anull[primarya]");
  }

  const additionalAudioLabels: string[] = [];
  let overlayNumber = 0;
  let canvasLabel = "canvas0";
  const overlayTracks = [...plan.timeline.overlayTracks].sort((a, b) => a.zIndex - b.zIndex);
  for (const track of overlayTracks) {
    const clips = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart);
    for (const clip of clips) {
      const asset = assetsById.get(clip.assetId);
      if (!asset) throw new Error(`Resolved overlay asset missing: ${clip.assetId}`);
      pushTrimmedInput(args, clip, asset.path);
      const clipDuration = outputDuration(clip);
      const overlayLabel = `overlay${overlayNumber}`;
      const nextCanvasLabel = `canvas${overlayNumber + 1}`;
      filterParts.push(
        `[${inputIndex}:v:0]setpts=(PTS-STARTPTS)/${formatNumber(clip.speed)}+${formatNumber(clip.timelineStart)}/TB,` +
          `${overlayScaleFilters(clip)},fps=${formatNumber(plan.project.frameRate)},` +
          `format=yuva420p,colorchannelmixer=aa=${formatNumber(clip.opacity)}[${overlayLabel}]`,
        `[${canvasLabel}][${overlayLabel}]overlay=x=${clip.x}:y=${clip.y}:eof_action=pass:` +
          `enable='between(t,${formatNumber(clip.timelineStart)},${formatNumber(clip.timelineStart + clipDuration)})'` +
          `[${nextCanvasLabel}]`,
      );
      if (clip.includeAudio) {
        const audioLabel = `overlaya${overlayNumber}`;
        filterParts.push(
          clipAudioFilters(inputIndex, clip.speed, clip.volume, audioLabel, clip.timelineStart),
        );
        additionalAudioLabels.push(audioLabel);
      }
      canvasLabel = nextCanvasLabel;
      overlayNumber += 1;
      inputIndex += 1;
    }
  }

  let audioNumber = 0;
  for (const track of plan.timeline.audioTracks) {
    for (const clip of track.clips) {
      const asset = assetsById.get(clip.assetId);
      if (!asset) throw new Error(`Resolved audio asset missing: ${clip.assetId}`);
      pushTrimmedInput(args, clip, asset.path);
      const audioLabel = `mixa${audioNumber}`;
      filterParts.push(
        clipAudioFilters(inputIndex, clip.speed, clip.volume, audioLabel, clip.timelineStart),
      );
      additionalAudioLabels.push(audioLabel);
      audioNumber += 1;
      inputIndex += 1;
    }
  }

  filterParts.push(
    `[${canvasLabel}]trim=duration=${formatNumber(durationSeconds)},setpts=PTS-STARTPTS[vout]`,
  );
  if (additionalAudioLabels.length > 0) {
    const mixInputs = ["primarya", ...additionalAudioLabels].map((label) => `[${label}]`).join("");
    filterParts.push(
      `${mixInputs}amix=inputs=${additionalAudioLabels.length + 1}:duration=longest:` +
        `dropout_transition=0:normalize=0,atrim=duration=${formatNumber(durationSeconds)}[aout]`,
    );
  } else {
    filterParts.push(
      `[primarya]atrim=duration=${formatNumber(durationSeconds)},asetpts=PTS-STARTPTS[aout]`,
    );
  }

  args.push("-filter_complex", filterParts.join(";"));
  appendCaptionsAndEncoding(
    args,
    plan,
    assetsById,
    inputIndex,
    profile,
    durationSeconds,
    durationLimitSeconds,
    outputPath,
  );
  return { command: "ffmpeg", args, durationSeconds, outputPath };
};

export const compileEditPlan = (
  plan: EditPlan,
  assets: ResolvedAsset[],
  outputPath: string,
  durationLimitSeconds?: number,
  profile: RenderProfile = "preview",
): CompiledEdit => {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  return plan.version === "1"
    ? compileV1(plan, assetsById, outputPath, durationLimitSeconds, profile)
    : compileV2(plan, assetsById, outputPath, durationLimitSeconds, profile);
};
