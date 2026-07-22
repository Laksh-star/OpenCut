import { describe, expect, test } from "bun:test";

import { alignCaptionWords, captionsToSrt, normalizeCaptionCues } from "../src/captions.ts";
import { parseEditPlan } from "../src/schema.ts";
import { checkSubtitleProviderReadiness, generateCandidateCaptions, transcriptionToCaptions } from "../src/subtitle-providers.ts";

describe("word-timed caption alignment", () => {
  test("creates readable cues at sentence and speaker boundaries", () => {
    const cues = alignCaptionWords({ words: [
      { word: "Human", start: 0, end: 0.3, speaker: "Swami" },
      { word: "potential", start: 0.31, end: 0.8, speaker: "Swami" },
      { word: "is", start: 0.81, end: 1, speaker: "Swami" },
      { word: "infinite.", start: 1.01, end: 1.5, speaker: "Swami" },
      { word: "Why?", start: 2.5, end: 2.9, speaker: "Host" },
    ] }, { includeSpeakerLabels: true });

    expect(cues).toEqual([
      { start: 0, end: 1.5, text: "Swami: Human potential is infinite.", speaker: "Swami" },
      { start: 2.5, end: 2.9, text: "Host: Why?", speaker: "Host" },
    ]);
  });

  test("emits standard SRT timestamps", () => {
    expect(captionsToSrt([{ start: 1.2, end: 3.45, text: "A clean caption" }])).toContain(
      "00:00:01,200 --> 00:00:03,450",
    );
  });

  test("normalizes human-edited caption cues before saving", () => {
    expect(normalizeCaptionCues([
      { start: 2.2222, end: 3.3333, text: " second   cue " },
      { start: 0, end: 1.1111, text: "first cue" },
    ])).toEqual([
      { start: 0, end: 1.111, text: "first cue" },
      { start: 2.222, end: 3.333, text: "second cue" },
    ]);

    expect(() => normalizeCaptionCues([{ start: 1, end: 1, text: "bad" }])).toThrow(
      "Caption cue end must be after start",
    );
  });

  test("converts provider word timestamps into caption cues", () => {
    const cues = transcriptionToCaptions({
      words: [
        { word: "OpenCut", start: 0, end: 0.4 },
        { word: "keeps", start: 0.41, end: 0.7 },
        { word: "reviews", start: 0.71, end: 1.1 },
        { word: "editable.", start: 1.11, end: 1.6 },
      ],
    }, 1.6);

    expect(cues).toEqual([
      { start: 0, end: 1.6, text: "OpenCut keeps reviews editable." },
    ]);
  });

  test("falls back to segment or plain text transcriptions", () => {
    expect(transcriptionToCaptions({
      segments: [{ start: 0, end: 2, text: "Use the clearest moment." }],
    }, 2)).toEqual([{ start: 0, end: 2, text: "Use the clearest moment." }]);

    const approximate = transcriptionToCaptions({ text: "A generated transcript without timestamps" }, 4);
    expect(approximate).toHaveLength(1);
    expect(approximate[0]?.text).toBe("A generated transcript without timestamps");
    expect(approximate[0]?.end).toBe(4);
  });

  test("requires explicit approval before API transcription uploads extracted audio", async () => {
    const plan = parseEditPlan({
      version: "2",
      project: { name: "Needs captions", width: 1280, height: 720 },
      assets: [{ id: "source", path: "missing-source.mp4", kind: "video" }],
      timeline: {
        clips: [{ id: "clip", assetId: "source", sourceStart: 0, sourceEnd: 3 }],
        subtitleProvider: { mode: "openrouter", status: "selected" },
      },
      output: { path: "candidate/renders/output.mp4" },
    });

    await expect(generateCandidateCaptions("/tmp/opencut-caption-gate", {
      id: "candidate",
      revision: 1,
      planPath: "candidate/edit-plan.json",
      plan,
    })).rejects.toThrow("requires explicit approval");
  });

  test("reports missing API keys before external caption generation", async () => {
    const original = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const plan = parseEditPlan({
      version: "2",
      project: { name: "Needs captions", width: 1280, height: 720 },
      assets: [{ id: "source", path: "missing-source.mp4", kind: "video" }],
      timeline: {
        clips: [{ id: "clip", assetId: "source", sourceStart: 0, sourceEnd: 3 }],
        subtitleProvider: { mode: "openrouter", status: "selected" },
      },
      output: { path: "candidate/renders/output.mp4" },
    });

    const readiness = await checkSubtitleProviderReadiness("/tmp/opencut-caption-gate", plan);

    expect(readiness).toMatchObject({
      mode: "openrouter",
      status: "missing",
      requiredEnv: "OPENROUTER_API_KEY",
      requiresExternalUploadApproval: true,
    });
    if (original) process.env.OPENROUTER_API_KEY = original;
  });
});
