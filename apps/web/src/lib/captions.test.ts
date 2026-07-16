import { describe, expect, test } from "vitest"

import { parseCaptionFile } from "./captions.ts"

describe("caption preview parser", () => {
  test("parses SRT cues with multiline text", () => {
    expect(
      parseCaptionFile(`1
00:00:00,000 --> 00:00:02,040
AI will not replace people.

2
00:00:02,960 --> 00:00:06,240
People who use AI
will replace people who don't.
`),
    ).toEqual([
      { start: 0, end: 2.04, text: "AI will not replace people." },
      {
        start: 2.96,
        end: 6.24,
        text: "People who use AI\nwill replace people who don't.",
      },
    ])
  })

  test("parses VTT timestamps and ignores the header", () => {
    expect(
      parseCaptionFile(`WEBVTT

00:01.000 --> 00:03.500 align:middle
Review this clip.
`),
    ).toEqual([{ start: 1, end: 3.5, text: "Review this clip." }])
  })
})
