import { describe, expect, test } from "bun:test";
import { parseByteRange } from "../src/range.ts";

describe("parseByteRange", () => {
  test("parses bounded, open-ended, and suffix ranges", () => {
    expect(parseByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });
  test("rejects out-of-bounds ranges", () => {
    expect(() => parseByteRange("bytes=100-101", 100)).toThrow("outside");
  });
});
