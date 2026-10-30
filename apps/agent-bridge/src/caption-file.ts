import type { CaptionCue } from "./captions.ts";

function parseTimestamp(value: string) {
  const match = value.trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) return null;
  const [, hours = "0", minutes, seconds, milliseconds] = match;
  if (Number(seconds) >= 60 || Number(minutes) >= 60) return null;
  return Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds) + Number(milliseconds) / 1_000;
}

export function parseCaptionFile(contents: string): CaptionCue[] {
  return contents.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/).flatMap((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const index = lines.findIndex((line) => line.includes("-->"));
    if (index < 0) return [];
    const [rawStart, rawEnd] = lines[index]!.split("-->");
    const start = parseTimestamp(rawStart ?? "");
    const end = parseTimestamp(rawEnd?.trim().split(/\s+/)[0] ?? "");
    const text = lines.slice(index + 1).join("\n").replace(/<[^>]+>/g, "");
    if (start === null || end === null || end <= start || !text) return [];
    return [{ start, end, text }];
  }).sort((a, b) => a.start - b.start);
}
