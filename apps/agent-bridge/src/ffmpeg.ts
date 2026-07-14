import type { EditPlan } from "./schema.ts";

export type ResolvedAsset = {
  id: string;
  path: string;
  kind: "video" | "captions";
};

export type CompiledEdit = {
  command: "ffmpeg";
  args: string[];
  durationSeconds: number;
  outputPath: string;
};

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

export const compileEditPlan = (
  plan: EditPlan,
  assets: ResolvedAsset[],
  outputPath: string,
  durationLimitSeconds?: number
): CompiledEdit => {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const args = ["-hide_banner", "-loglevel", "error", plan.output.overwrite ? "-y" : "-n"];
  const filterParts: string[] = [];
  let durationSeconds = 0;

  for (const [index, clip] of plan.timeline.clips.entries()) {
    const asset = assetsById.get(clip.assetId);
    if (!asset) {
      throw new Error(`Resolved asset missing: ${clip.assetId}`);
    }

    const sourceDuration = clip.sourceEnd - clip.sourceStart;
    const outputDuration = sourceDuration / clip.speed;
    durationSeconds += outputDuration;
    args.push(
      "-ss",
      formatNumber(clip.sourceStart),
      "-t",
      formatNumber(sourceDuration),
      "-i",
      asset.path
    );

    const background = `0x${plan.project.background.slice(1)}`;
    filterParts.push(
      `[${index}:v:0]setpts=(PTS-STARTPTS)/${formatNumber(clip.speed)},` +
        `scale=${plan.project.width}:${plan.project.height}:force_original_aspect_ratio=decrease,` +
        `pad=${plan.project.width}:${plan.project.height}:(ow-iw)/2:(oh-ih)/2:color=${background},` +
        `fps=${formatNumber(plan.project.frameRate)},format=yuv420p[v${index}]`
    );

    if (clip.includeAudio) {
      const audioFilters = [
        "asetpts=PTS-STARTPTS",
        ...buildAtempoFilters(clip.speed),
        `volume=${formatNumber(clip.volume)}`,
        "aresample=48000",
      ];
      filterParts.push(`[${index}:a:0]${audioFilters.join(",")}[a${index}]`);
    } else {
      filterParts.push(
        `anullsrc=r=48000:cl=stereo,atrim=duration=${formatNumber(outputDuration)},` +
          `asetpts=PTS-STARTPTS[a${index}]`
      );
    }
  }

  const concatInputs = plan.timeline.clips
    .map((_, index) => `[v${index}][a${index}]`)
    .join("");
  filterParts.push(
    `${concatInputs}concat=n=${plan.timeline.clips.length}:v=1:a=1[vout][aout]`
  );

  let captionsInputIndex: number | undefined;
  if (plan.timeline.captionsAssetId) {
    const captions = assetsById.get(plan.timeline.captionsAssetId);
    if (!captions) {
      throw new Error(`Resolved captions asset missing: ${plan.timeline.captionsAssetId}`);
    }
    captionsInputIndex = plan.timeline.clips.length;
    args.push("-i", captions.path);
  }

  args.push("-filter_complex", filterParts.join(";"), "-map", "[vout]", "-map", "[aout]");
  if (captionsInputIndex !== undefined) {
    args.push("-map", `${captionsInputIndex}:s:0`, "-c:s", "mov_text");
  }
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart"
  );

  if (durationLimitSeconds !== undefined) {
    args.push("-t", formatNumber(Math.min(durationSeconds, durationLimitSeconds)));
  }
  args.push(outputPath);

  return { command: "ffmpeg", args, durationSeconds, outputPath };
};
