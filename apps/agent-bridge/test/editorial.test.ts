import { describe, expect, test } from "bun:test";

import { editorialSegments, parseEditorialCommand, proposeEditorialEdit, suggestFillerCues } from "../src/editorial.ts";
import { editPlanSchema, getPlanDuration } from "../src/schema.ts";
import { parseSilenceLog } from "../src/silence.ts";

const plan = () => editPlanSchema.parse({
  version: "2", project: { name: "Interview", width: 1280, height: 720 },
  assets: [{ id: "source", kind: "video", path: "source.mp4" }, { id: "music", kind: "audio", path: "music.wav" }],
  timeline: {
    clips: [
      { id: "a", assetId: "source", sourceStart: 10, sourceEnd: 20, speed: 2 },
      { id: "b", assetId: "source", sourceStart: 40, sourceEnd: 45 },
    ],
    overlayTracks: [{ id: "overlay", clips: [{ id: "picture", assetId: "source", timelineStart: 2, sourceStart: 50, sourceEnd: 56, width: 320, height: 240 }] }],
    audioTracks: [{ id: "music-track", role: "music", clips: [{ id: "bed", assetId: "music", timelineStart: 0, sourceStart: 0, sourceEnd: 10 }] }],
    audioMix: { ducking: { enabled: true, targetTrackIds: ["music-track"] } },
    titleCards: [{ id: "title", title: "Speaker", timelineStart: 3, duration: 4 }],
  }, output: { path: "candidate/renders/output.mp4" },
});
const cues = [
  { start: 0, end: 2, text: "Opening" },
  { start: 2, end: 4, text: "Core statement" },
  { start: 5, end: 7, text: "Second answer" },
  { start: 8, end: 10, text: "Conclusion" },
];

describe("transcript edit proposals", () => {
  test("cuts source ranges at playback speed and retimes captions and layers", () => {
    const result = proposeEditorialEdit(plan(), { type: "remove", ranges: [{ start: 2, end: 4 }] }, cues);
    expect(result.afterSeconds).toBe(8);
    expect(result.plan.timeline.clips.map((clip) => [clip.sourceStart, clip.sourceEnd])).toEqual([[10, 14], [18, 20], [40, 45]]);
    expect(result.captions.map((cue) => [cue.start, cue.end, cue.text])).toEqual([[0, 2, "Opening"], [3, 5, "Second answer"], [6, 8, "Conclusion"]]);
    if (result.plan.version !== "2") throw new Error("Expected v2");
    expect(result.plan.timeline.overlayTracks[0]?.clips[0]).toMatchObject({ timelineStart: 2, sourceStart: 52, sourceEnd: 56 });
    expect(result.plan.timeline.audioTracks[0]?.clips.map((clip) => [clip.timelineStart, clip.sourceStart, clip.sourceEnd])).toEqual([[0, 0, 2], [2, 4, 10]]);
    expect(result.plan.timeline.titleCards[0]).toMatchObject({ timelineStart: 2, duration: 3 });
    expect(getPlanDuration(result.plan)).toBe(8);
  });

  test("keeps disjoint selections and retains protected passages", () => {
    const result = proposeEditorialEdit(plan(), { type: "keep", ranges: [{ start: 0, end: 2 }] }, cues, [{ start: 8, end: 10 }]);
    expect(result.afterSeconds).toBe(4);
    expect(result.captions.map((cue) => cue.text)).toEqual(["Opening", "Conclusion"]);
    expect(result.plan.timeline.clips.at(-1)).toMatchObject({ sourceStart: 43, sourceEnd: 45 });
  });

  test("shortens while preserving a late must-keep passage", () => {
    const result = proposeEditorialEdit(plan(), { type: "shorten", seconds: 4 }, cues, [{ start: 8, end: 10 }]);
    expect(result.spans).toEqual([{ start: 0, end: 2 }, { start: 8, end: 10 }]);
    expect(() => proposeEditorialEdit(plan(), { type: "shorten", seconds: 1 }, cues, [{ start: 8, end: 10 }])).toThrow("Protected passages");
  });

  test("does not invent word alignment when a cut bisects a cue", () => {
    const result = proposeEditorialEdit(plan(), { type: "shorten", seconds: 3 }, cues);
    expect(result.captions).toEqual([cues[0]!]);
    expect(result.warnings.some((warning) => warning.includes("regenerate captions"))).toBe(true);
    if (result.plan.version === "2") expect(result.plan.timeline.subtitleProvider?.status).toBe("needs-generation");
  });

  test("reorders clips and maps captions and production media into the same order", () => {
    const result = proposeEditorialEdit(plan(), { type: "move-first", clipId: "b" }, cues);
    expect(result.plan.timeline.clips.map((clip) => clip.id)).toEqual(["b", "a"]);
    expect(result.captions.map((cue) => [cue.start, cue.text])).toEqual([[0, "Second answer"], [3, "Conclusion"], [5, "Opening"], [7, "Core statement"]]);
    expect(result.afterSeconds).toBe(10);
  });

  test("flattens crossfades at their midpoints without changing elapsed time", () => {
    const value = plan();
    if (value.version !== "2") throw new Error("Expected v2");
    value.timeline.transitions = [{ id: "fade", fromClipId: "a", toClipId: "b", type: "fade", duration: 1 }];
    expect(editorialSegments(value).map((segment) => [segment.start, segment.end])).toEqual([[0, 4.5], [4.5, 9]]);
    const result = proposeEditorialEdit(value, { type: "shorten", seconds: 8 }, []);
    expect(result.beforeSeconds).toBe(9);
    expect(result.afterSeconds).toBe(8);
    if (result.plan.version === "2") expect(result.plan.timeline.transitions).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("hard cuts"))).toBe(true);
  });

  test("retains v1 support and does not mutate the original plan", () => {
    const value = editPlanSchema.parse({ ...plan(), version: "1" });
    const before = JSON.stringify(value);
    const result = proposeEditorialEdit(value, { type: "keep", ranges: [{ start: 2, end: 4 }] });
    expect(result.plan.version).toBe("1");
    expect(result.afterSeconds).toBe(2);
    expect(JSON.stringify(value)).toBe(before);
  });

  test("rejects removing everything, out-of-range selections and unsupported requests", () => {
    expect(() => proposeEditorialEdit(plan(), { type: "remove", ranges: [{ start: 0, end: 10 }] })).toThrow("retain");
    expect(() => proposeEditorialEdit(plan(), { type: "keep", ranges: [{ start: 9, end: 11 }] })).toThrow("beyond");
    expect(() => proposeEditorialEdit(plan(), { type: "move-first", clipId: "missing" })).toThrow("Unknown clip");
    expect(() => parseEditorialCommand("make it viral")).toThrow("Try");
    expect(() => parseEditorialCommand("shorten this")).toThrow("target duration");
  });

  test("parses the supported local commands with explicit selection context", () => {
    expect(parseEditorialCommand("Make this 4 seconds.")).toEqual({ type: "shorten", seconds: 4 });
    expect(parseEditorialCommand("Shorten this to 4.5 sec")).toEqual({ type: "shorten", seconds: 4.5 });
    expect(parseEditorialCommand("keep this passage", { selection: [{ start: 0, end: 2 }] })).toEqual({ type: "keep", ranges: [{ start: 0, end: 2 }] });
    expect(parseEditorialCommand("move this clip first", { clipId: "b" })).toEqual({ type: "move-first", clipId: "b" });
    expect(() => parseEditorialCommand("remove this passage")).toThrow("Select transcript");
  });

  test("filler suggestions leave meaningful speech and mixed cues alone", () => {
    const texts = ["Um...", "Uh, hmm.", "You know the answer", "um I disagree", "No", "well"];
    expect(suggestFillerCues(texts.map((text, index) => ({ start: index, end: index + 0.5, text })))).toEqual([0, 1]);
  });

  test("silence parsing bounds trailing silence to the analyzed source range", () => {
    expect(parseSilenceLog("silence_start: -0.1\nsilence_end: 0.9 | silence_duration: 0.9\nsilence_start: 3.5", 4)).toEqual([{ start: 0, end: 0.9 }, { start: 3.5, end: 4 }]);
  });
});
