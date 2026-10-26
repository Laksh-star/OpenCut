import { z } from "zod/v4";

import type { CaptionCue } from "./captions.ts";
import { editPlanSchema, type EditPlan } from "./schema.ts";

export const timeRangeSchema = z.object({
  start: z.number().finite().min(0),
  end: z.number().finite().positive(),
}).refine((range) => range.end > range.start, "Range end must be after start");
export type TimeRange = z.infer<typeof timeRangeSchema>;
export const editorialOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("keep"), ranges: z.array(timeRangeSchema).min(1).max(500) }),
  z.object({ type: z.literal("remove"), ranges: z.array(timeRangeSchema).min(1).max(500) }),
  z.object({ type: z.literal("shorten"), seconds: z.number().finite().min(0.1).max(300) }),
  z.object({ type: z.literal("move-first"), clipId: z.string().min(1).max(80) }),
]);
export type EditorialOperation = z.infer<typeof editorialOperationSchema>;
export type EditorialProposal = {
  operation: EditorialOperation;
  beforeSeconds: number;
  afterSeconds: number;
  spans: TimeRange[];
  changes: string[];
  warnings: string[];
  plan: EditPlan;
  captions: CaptionCue[];
};

const EPSILON = 0.00001;
const rounded = (value: number) => Number(value.toFixed(6));
const seconds = (value: number) => `${value.toFixed(2)}s`;
export const rangeDuration = (ranges: TimeRange[]) => ranges.reduce((total, range) => total + range.end - range.start, 0);

export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const result: TimeRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const previous = result.at(-1);
    if (previous && range.start <= previous.end + EPSILON) previous.end = Math.max(previous.end, range.end);
    else result.push({ ...range });
  }
  return result;
}

export function subtractRanges(ranges: TimeRange[], cuts: TimeRange[]): TimeRange[] {
  let remaining = ranges.map((range) => ({ ...range }));
  for (const cut of mergeRanges(cuts)) {
    remaining = remaining.flatMap((range) => {
      if (cut.end <= range.start || cut.start >= range.end) return [range];
      return [
        ...(cut.start > range.start + EPSILON ? [{ start: range.start, end: cut.start }] : []),
        ...(cut.end < range.end - EPSILON ? [{ start: cut.end, end: range.end }] : []),
      ];
    });
  }
  return remaining;
}

// A crossfade becomes a hard cut at its midpoint. This preserves elapsed time
// and caption alignment while making transcript ranges unambiguous.
export function editorialSegments(plan: EditPlan) {
  let cursor = 0;
  return plan.timeline.clips.map((original, index) => {
    const incoming = plan.version === "2"
      ? plan.timeline.transitions.find((transition) => transition.toClipId === original.id)?.duration ?? 0 : 0;
    const outgoing = plan.version === "2"
      ? plan.timeline.transitions.find((transition) => transition.fromClipId === original.id)?.duration ?? 0 : 0;
    const clip = {
      ...original,
      sourceStart: rounded(original.sourceStart + incoming * original.speed / 2),
      sourceEnd: rounded(original.sourceEnd - outgoing * original.speed / 2),
    };
    const duration = (clip.sourceEnd - clip.sourceStart) / clip.speed;
    const segment = { clip, start: rounded(cursor), end: rounded(cursor + duration), index };
    cursor += duration;
    return segment;
  });
}

export function parseEditorialCommand(
  text: string,
  context: { selection?: TimeRange[]; clipId?: string } = {},
): EditorialOperation {
  const command = text.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
  const shorten = command.match(/^(?:shorten(?: this)?(?: to)?|make (?:this|it)) (\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)(?: long)?$/);
  if (shorten) return editorialOperationSchema.parse({ type: "shorten", seconds: Number(shorten[1]) });
  if (/^(?:shorten|shorten this|make this shorter)$/.test(command)) {
    throw new Error('Include a target duration, for example “shorten this to 45 seconds”.');
  }
  if (/^(?:keep|remove|cut)(?: only)? (?:this|the selected|selected)(?: passage| passages| selection| text)?$/.test(command)) {
    if (!context.selection?.length) throw new Error("Select transcript passages first.");
    return editorialOperationSchema.parse({ type: command.startsWith("keep") ? "keep" : "remove", ranges: context.selection });
  }
  if (/^move (?:this|the selected|selected) clip (?:first|to (?:the )?(?:start|beginning))$/.test(command)) {
    if (!context.clipId) throw new Error("Select a timeline clip first.");
    return editorialOperationSchema.parse({ type: "move-first", clipId: context.clipId });
  }
  throw new Error('Try “shorten this to 45 seconds”, “keep this passage”, “remove this passage”, or “move this clip first”.');
}

export function suggestFillerCues(cues: CaptionCue[]): number[] {
  // Whole-cue suggestions only. Do not pretend SRT has word timestamps, or
  // classify meaningful phrases such as “you know” as disposable speech.
  return cues.flatMap((cue, index) =>
    /^(?:(?:u+m+|u+h+|e+r+m*|h+m+)[\s,.!?…-]*)+$/i.test(cue.text.trim()) ? [index] : []);
}

export function proposeEditorialEdit(
  value: unknown,
  operationValue: unknown,
  cues: CaptionCue[] = [],
  protectedValue: TimeRange[] = [],
): EditorialProposal {
  const plan = editPlanSchema.parse(value);
  const operation = editorialOperationSchema.parse(operationValue);
  const segments = editorialSegments(plan);
  const duration = segments.at(-1)!.end;
  const validateRanges = (ranges: TimeRange[]) => mergeRanges(ranges.map((value) => {
    const range = timeRangeSchema.parse(value);
    if (range.end > duration + EPSILON) throw new Error("Selected range extends beyond the primary footage. Select an in-range passage.");
    return { start: range.start, end: Math.min(duration, range.end) };
  }));
  const protectedRanges = validateRanges(protectedValue);
  const whole = [{ start: 0, end: duration }];
  let spans: TimeRange[];
  if (operation.type === "keep") spans = mergeRanges([...validateRanges(operation.ranges), ...protectedRanges]);
  else if (operation.type === "remove") spans = subtractRanges(whole, subtractRanges(validateRanges(operation.ranges), protectedRanges));
  else if (operation.type === "shorten") {
    if (operation.seconds >= duration - EPSILON) throw new Error("The target must be shorter than the current cut.");
    let remaining = operation.seconds - rangeDuration(protectedRanges);
    if (remaining < -EPSILON) throw new Error("Protected passages are longer than the target. Increase the duration or unprotect a passage.");
    const prefix: TimeRange[] = [];
    for (const available of subtractRanges(whole, protectedRanges)) {
      if (remaining <= EPSILON) break;
      const end = Math.min(available.end, available.start + remaining);
      prefix.push({ start: available.start, end });
      remaining -= end - available.start;
    }
    spans = mergeRanges([...prefix, ...protectedRanges]);
  } else {
    const segment = segments.find((entry) => entry.clip.id === operation.clipId);
    if (!segment) throw new Error("Unknown clip. Select a clip in this candidate.");
    if (segment.start === 0) throw new Error("The selected clip is already first.");
    spans = [{ start: segment.start, end: segment.end }, ...subtractRanges(whole, [segment])];
  }
  if (rangeDuration(spans) < 0.1) throw new Error("An edit must retain at least 0.1 seconds of footage.");

  const warnings: string[] = [];
  if (plan.version === "2" && plan.timeline.transitions.length) {
    warnings.push(`${plan.timeline.transitions.length} transition(s) will become hard cuts at their midpoint to keep transcript timing aligned.`);
  }
  if (protectedRanges.length) warnings.push("Protected passages are retained in this proposal.");

  const reservedIds = new Set(plan.timeline.clips.map((clip) => clip.id));
  if (plan.version === "2") {
    for (const track of [...plan.timeline.overlayTracks, ...plan.timeline.audioTracks]) {
      for (const clip of track.clips) reservedIds.add(clip.id);
    }
    for (const card of plan.timeline.titleCards) reservedIds.add(card.id);
  }
  const usedIds = new Set<string>();
  const nextId = (base: string) => {
    if (!usedIds.has(base)) { usedIds.add(base); return base; }
    let index = 2;
    let id: string;
    do { id = `${base.slice(0, 60)}-cut-${index++}`; } while (reservedIds.has(id) || usedIds.has(id));
    usedIds.add(id);
    return id;
  };
  const clips = spans.flatMap((span) => segments.flatMap((segment) => {
    const start = Math.max(span.start, segment.start);
    const end = Math.min(span.end, segment.end);
    if (end - start <= EPSILON) return [];
    return [{
      ...segment.clip,
      id: nextId(segment.clip.id),
      sourceStart: rounded(segment.clip.sourceStart + (start - segment.start) * segment.clip.speed),
      sourceEnd: rounded(segment.clip.sourceStart + (end - segment.start) * segment.clip.speed),
    }];
  }));

  // Map timed production layers through the same keep/reorder spans as speech.
  const mapLayer = <T extends { id: string; timelineStart: number; sourceStart: number; sourceEnd: number; speed: number }>(layer: T): T[] => {
    let cursor = 0;
    return spans.flatMap((span) => {
      const start = Math.max(span.start, layer.timelineStart);
      const end = Math.min(span.end, layer.timelineStart + (layer.sourceEnd - layer.sourceStart) / layer.speed);
      const offset = cursor;
      cursor += span.end - span.start;
      if (end - start <= EPSILON) return [];
      return [{ ...layer, id: nextId(layer.id), timelineStart: rounded(offset + start - span.start),
        sourceStart: rounded(layer.sourceStart + (start - layer.timelineStart) * layer.speed),
        sourceEnd: rounded(layer.sourceStart + (end - layer.timelineStart) * layer.speed) }];
    });
  };
  let nextPlan: EditPlan;
  if (plan.version === "1") nextPlan = { ...plan, timeline: { ...plan.timeline, clips } };
  else {
    let droppedTitles = 0;
    const titleCards = plan.timeline.titleCards.flatMap((card) => {
      const mapped = mapLayer({ ...card, sourceStart: 0, sourceEnd: card.duration, speed: 1 });
      return mapped.flatMap(({ sourceStart, sourceEnd, speed: _speed, ...mappedCard }) => {
        const duration = rounded(sourceEnd - sourceStart);
        if (duration < 0.5) { droppedTitles++; return []; }
        return [{ ...mappedCard, duration }];
      });
    });
    if (droppedTitles) warnings.push(`${droppedTitles} title fragment(s) shorter than 0.5 seconds will be removed.`);
    const overlayTracks = plan.timeline.overlayTracks.map((track) => ({ ...track, clips: track.clips.flatMap(mapLayer) })).filter((track) => track.clips.length);
    const audioTracks = plan.timeline.audioTracks.map((track) => ({ ...track, clips: track.clips.flatMap(mapLayer) })).filter((track) => track.clips.length);
    const audioIds = new Set(audioTracks.map((track) => track.id));
    nextPlan = { ...plan, timeline: { ...plan.timeline, clips, overlayTracks, audioTracks, titleCards, transitions: [],
      audioMix: plan.timeline.audioMix?.ducking ? { ducking: { ...plan.timeline.audioMix.ducking,
        targetTrackIds: plan.timeline.audioMix.ducking.targetTrackIds.filter((id) => audioIds.has(id)),
      } } : plan.timeline.audioMix,
    } };
    if (plan.timeline.overlayTracks.length || plan.timeline.audioTracks.length || plan.timeline.titleCards.length) {
      warnings.push("Overlays, audio, and titles follow the retained footage; content outside it is trimmed.");
    }
  }

  let cursor = 0;
  const partialCues = new Set<number>();
  const captions = spans.flatMap((span) => {
    const offset = cursor;
    cursor += span.end - span.start;
    return cues.flatMap((cue, index) => {
      if (cue.end <= span.start + EPSILON || cue.start >= span.end - EPSILON) return [];
      if (cue.start < span.start - EPSILON || cue.end > span.end + EPSILON) { partialCues.add(index); return []; }
      return [{ ...cue, start: rounded(offset + cue.start - span.start), end: rounded(offset + cue.end - span.start) }];
    });
  });
  if (partialCues.size || cues.length && !captions.length) {
    if (partialCues.size) warnings.push(`${partialCues.size} caption cue(s) cross a cut and cannot be word-aligned from cue timing. They will be omitted; regenerate captions after saving.`);
    if (cues.length && !captions.length) warnings.push("No complete caption cues remain. Generate or attach captions after saving.");
    if (nextPlan.version === "2") {
      const provider = nextPlan.timeline.subtitleProvider;
      const mode = provider?.mode === "provided-captions" ? "local-whisper" : provider?.mode ?? "local-whisper";
      nextPlan = { ...nextPlan, timeline: { ...nextPlan.timeline, subtitleProvider: { ...provider, mode, status: "needs-generation" } } };
      if (provider?.mode === "provided-captions") warnings.push("Caption regeneration will use local Whisper; no transcription starts when you save this edit.");
    }
  }
  const beforeClips = plan.timeline.clips.map((clip) => `${clip.id}:${clip.sourceStart}:${clip.sourceEnd}`).join("|");
  const afterClips = clips.map((clip) => `${clip.id}:${clip.sourceStart}:${clip.sourceEnd}`).join("|");
  if (beforeClips === afterClips && !(plan.version === "2" && plan.timeline.transitions.length)) {
    throw new Error("This proposal would not change the cut.");
  }
  return {
    operation, beforeSeconds: duration, afterSeconds: rounded(rangeDuration(spans)), spans,
    changes: [
      `${seconds(duration)} → ${seconds(rangeDuration(spans))}; ${plan.timeline.clips.length} → ${clips.length} primary clip(s).`,
      ...spans.map((span, index) => `Keep ${seconds(span.start)}–${seconds(span.end)}${operation.type === "move-first" ? ` in position ${index + 1}` : ""}.`),
      `${captions.length} complete caption cue(s) retained and retimed.`,
    ],
    warnings, plan: editPlanSchema.parse(nextPlan), captions,
  };
}
