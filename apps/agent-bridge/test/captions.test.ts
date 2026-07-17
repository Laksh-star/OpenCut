import { describe, expect, test } from "bun:test";

import { alignCaptionWords, captionsToSrt } from "../src/captions.ts";

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
});
