import { z } from "zod/v4";

export const timedWordSchema = z.object({
  word: z.string().trim().min(1).max(200),
  start: z.number().min(0),
  end: z.number().positive(),
  speaker: z.string().trim().min(1).max(120).optional(),
}).refine((word) => word.end > word.start, { message: "Word end must be after start" });

export const timedTranscriptSchema = z.object({
  words: z.array(timedWordSchema).min(1),
  language: z.string().trim().min(2).max(20).optional(),
  provider: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(160).optional(),
});

export type TimedWord = z.infer<typeof timedWordSchema>;
export type CaptionCue = { start: number; end: number; text: string; speaker?: string };

export type CaptionAlignmentOptions = {
  maximumCharactersPerLine?: number;
  maximumLines?: number;
  maximumCueSeconds?: number;
  maximumGapSeconds?: number;
  includeSpeakerLabels?: boolean;
};

const normalizeWord = (value: string) => value.replace(/\s+/g, " ").trim();
const sentenceEnd = (value: string) => /[.!?][”’"']?$/.test(value);

const wrapCaption = (words: string[], lineLength: number, maximumLines: number) => {
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || (current.length + 1 + word.length > lineLength && lines.length < maximumLines)) {
      lines.push(word);
    } else {
      lines[lines.length - 1] = `${current} ${word}`;
    }
  }
  return lines.join("\n");
};

export const alignCaptionWords = (
  value: unknown,
  options: CaptionAlignmentOptions = {},
): CaptionCue[] => {
  const transcript = timedTranscriptSchema.parse(value);
  const maximumCharactersPerLine = options.maximumCharactersPerLine ?? 42;
  const maximumLines = options.maximumLines ?? 2;
  const maximumCueSeconds = options.maximumCueSeconds ?? 6;
  const maximumGapSeconds = options.maximumGapSeconds ?? 0.8;
  const maximumCharacters = maximumCharactersPerLine * maximumLines;
  const words = [...transcript.words].sort((left, right) => left.start - right.start);
  const cues: CaptionCue[] = [];
  let group: TimedWord[] = [];

  const flush = () => {
    if (group.length === 0) return;
    const speaker = group[0]?.speaker;
    const textWords = group.map((word) => normalizeWord(word.word));
    const prefix = options.includeSpeakerLabels && speaker ? `${speaker}: ` : "";
    cues.push({
      start: group[0]!.start,
      end: group.at(-1)!.end,
      text: `${prefix}${wrapCaption(textWords, maximumCharactersPerLine, maximumLines)}`,
      ...(speaker ? { speaker } : {}),
    });
    group = [];
  };

  for (const word of words) {
    const previous = group.at(-1);
    const projectedText = [...group, word].map((entry) => normalizeWord(entry.word)).join(" ");
    const speakerChanged = Boolean(previous?.speaker && word.speaker && previous.speaker !== word.speaker);
    const gapTooLarge = Boolean(previous && word.start - previous.end > maximumGapSeconds);
    const durationTooLong = Boolean(group[0] && word.end - group[0].start > maximumCueSeconds);
    const textTooLong = projectedText.length > maximumCharacters;
    if (group.length > 0 && (speakerChanged || gapTooLarge || durationTooLong || textTooLong)) flush();
    group.push(word);
    if (sentenceEnd(word.word) && group.length >= 3) flush();
  }
  flush();
  return cues;
};

const formatTimestamp = (seconds: number) => {
  const milliseconds = Math.round(Math.max(0, seconds) * 1_000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")},${millis.toString().padStart(3, "0")}`;
};

export const captionsToSrt = (cues: CaptionCue[]) => `${cues.map((cue, index) =>
  `${index + 1}\n${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}\n${cue.text}`,
).join("\n\n")}\n`;
