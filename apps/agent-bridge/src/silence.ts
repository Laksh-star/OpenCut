import { editorialSegments, mergeRanges, type TimeRange } from "./editorial.ts";
import { inspectMedia, runProcess } from "./media.ts";
import { resolveInputPath } from "./paths.ts";
import type { EditPlan } from "./schema.ts";

export function parseSilenceLog(log: string, duration: number): TimeRange[] {
  const ranges: TimeRange[] = [];
  let start: number | undefined;
  for (const match of log.matchAll(/silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g)) {
    const time = Math.max(0, Math.min(duration, Number(match[2])));
    if (match[1] === "start") start = time;
    else if (start !== undefined && time > start) { ranges.push({ start, end: time }); start = undefined; }
  }
  if (start !== undefined && duration > start) ranges.push({ start, end: duration });
  return ranges;
}

export async function detectCandidateSilence(root: string, plan: EditPlan) {
  const startedAt = Date.now();
  const segments = editorialSegments(plan);
  const sourceSeconds = segments.reduce((total, segment) => total + segment.clip.sourceEnd - segment.clip.sourceStart, 0);
  if (segments.length > 40 || sourceSeconds > 600) throw new Error("Pause analysis supports up to 40 clips and 10 minutes of source audio per candidate. Shorten the candidate first.");
  const ranges: TimeRange[] = [];
  const sources = new Map<string, { path: string; hasAudio: boolean }>();
  for (const segment of segments) {
    if (Date.now() - startedAt >= 45_000) throw new Error("Pause analysis reached its 45-second limit. Shorten the candidate and try again.");
    const clip = segment.clip;
    if (!clip.includeAudio || clip.volume === 0) continue;
    let source = sources.get(clip.assetId);
    if (!source) {
      const asset = plan.assets.find((asset) => asset.id === clip.assetId)!;
      const path = await resolveInputPath(root, asset.path);
      const probe = await inspectMedia(path) as { streams?: Array<{ codec_type?: string }> };
      source = { path, hasAudio: Boolean(probe.streams?.some((stream) => stream.codec_type === "audio")) };
      sources.set(clip.assetId, source);
    }
    if (!source.hasAudio) continue;
    const duration = clip.sourceEnd - clip.sourceStart;
    const result = await runProcess("ffmpeg", [
      "-hide_banner", "-nostdin", "-ss", String(clip.sourceStart), "-t", String(duration),
      "-i", source.path, "-map", "0:a:0", "-vn", "-sn", "-dn",
      "-af", "silencedetect=noise=-35dB:d=0.6", "-f", "null", "-",
    ], { timeoutMs: Math.min(30_000, Math.max(1, 45_000 - (Date.now() - startedAt))) });
    if (result.exitCode !== 0) throw new Error(`Pause analysis failed: ${result.stderr.slice(-1_000)}`);
    for (const range of parseSilenceLog(result.stderr, duration)) {
      const start = range.start + 0.12;
      const end = range.end - 0.12;
      if (end > start) ranges.push({ start: segment.start + start / clip.speed, end: segment.start + end / clip.speed });
    }
  }
  return { ranges: mergeRanges(ranges), thresholdDb: -35, minimumSourceSeconds: 0.6, paddingSourceSeconds: 0.12,
    warning: "Quiet audio may contain speech. Listen to each suggestion before proposing a cut; nothing has been removed." };
}
