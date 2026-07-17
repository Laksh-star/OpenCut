import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";

import type { ResolvedAsset } from "./ffmpeg.ts";
import type { EditPlanV2 } from "./schema.ts";

export type PreparedGraphic = {
  id: string;
  kind: "title" | "caption";
  path: string;
  timelineStart: number;
  duration: number;
};

type CaptionCue = { start: number; end: number; text: string };
const MAX_BURNED_CAPTION_CUES = 200;

const escapeXml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const parseTimestamp = (value: string) => {
  const match = value.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) throw new Error(`Invalid SRT timestamp: ${value}`);
  return Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1_000;
};

export const parseSrtCues = (value: string): CaptionCue[] => value
  .replaceAll("\r\n", "\n")
  .trim()
  .split(/\n{2,}/)
  .map((block) => {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) return null;
    const [startValue, endValue] = lines[timingIndex]!.split("-->").map((part) => part.trim());
    if (!startValue || !endValue) throw new Error(`Invalid SRT timing line: ${lines[timingIndex]}`);
    const start = parseTimestamp(startValue);
    const end = parseTimestamp(endValue);
    if (end <= start) throw new Error(`SRT cue end must be after start: ${lines[timingIndex]}`);
    const text = lines.slice(timingIndex + 1).join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 500);
    return text ? { start, end, text } : null;
  })
  .filter((cue): cue is CaptionCue => cue !== null);

const wrapText = (value: string, maximumCharacters: number) => {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current) {
      lines.push(word);
    } else if (current.length + word.length + 1 > maximumCharacters) {
      if (lines.length < 2) lines.push(word);
      else {
        lines[1] = `${lines[1]!.slice(0, Math.max(1, maximumCharacters - 1))}…`;
        break;
      }
    } else {
      lines[lines.length - 1] = `${current} ${word}`;
    }
  }
  return lines.slice(0, 2);
};

const titleCardSvg = (plan: EditPlanV2, card: EditPlanV2["timeline"]["titleCards"][number]) => {
  const { width, height } = plan.project;
  const titleSize = Math.round(Math.max(36, Math.min(96, width * 0.055)));
  const subtitleSize = Math.round(titleSize * 0.42);
  const accentHeight = Math.max(6, Math.round(height * 0.012));
  const title = escapeXml(card.title);
  const subtitle = card.subtitle ? escapeXml(card.subtitle) : undefined;

  if (card.template === "lower-third") {
    const boxX = Math.round(width * 0.06);
    const boxY = Math.round(height * 0.68);
    const boxWidth = Math.round(width * 0.78);
    const boxHeight = Math.round(height * 0.22);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" rx="18" fill="${card.background}" fill-opacity="0.9"/>
      <rect x="${boxX}" y="${boxY}" width="${accentHeight}" height="${boxHeight}" rx="3" fill="${card.accentColor}"/>
      <text x="${boxX + Math.round(width * 0.035)}" y="${boxY + Math.round(boxHeight * 0.48)}" fill="${card.textColor}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(titleSize * 0.7)}" font-weight="700">${title}</text>
      ${subtitle ? `<text x="${boxX + Math.round(width * 0.035)}" y="${boxY + Math.round(boxHeight * 0.75)}" fill="${card.textColor}" fill-opacity="0.78" font-family="Arial, Helvetica, sans-serif" font-size="${subtitleSize}">${subtitle}</text>` : ""}
    </svg>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="${card.background}"/>
    <rect x="${Math.round(width * 0.38)}" y="${Math.round(height * 0.35)}" width="${Math.round(width * 0.24)}" height="${accentHeight}" rx="${Math.round(accentHeight / 2)}" fill="${card.accentColor}"/>
    <text x="50%" y="${Math.round(height * 0.5)}" text-anchor="middle" fill="${card.textColor}" font-family="Arial, Helvetica, sans-serif" font-size="${titleSize}" font-weight="700">${title}</text>
    ${subtitle ? `<text x="50%" y="${Math.round(height * 0.59)}" text-anchor="middle" fill="${card.textColor}" fill-opacity="0.8" font-family="Arial, Helvetica, sans-serif" font-size="${subtitleSize}">${subtitle}</text>` : ""}
  </svg>`;
};

const captionSvg = (
  plan: EditPlanV2,
  cue: CaptionCue,
) => {
  const style = plan.timeline.captionStyle!;
  const { width, height } = plan.project;
  const defaultSize = style.preset === "bold" ? width * 0.05 : width * 0.041;
  const fontSize = style.fontSize ?? Math.round(Math.max(24, Math.min(88, defaultSize)));
  const lines = wrapText(cue.text, style.preset === "bold" ? 30 : 40);
  const lineHeight = Math.round(fontSize * 1.22);
  const paddingX = Math.round(fontSize * 0.72);
  const paddingY = Math.round(fontSize * 0.4);
  const longest = Math.max(...lines.map((line) => line.length));
  const boxWidth = Math.min(Math.round(width * 0.92), Math.round(longest * fontSize * 0.58 + paddingX * 2));
  const boxHeight = lines.length * lineHeight + paddingY * 2;
  const boxX = Math.round((width - boxWidth) / 2);
  const boxY = style.alignment === "top"
    ? style.marginV
    : style.alignment === "middle"
      ? Math.round((height - boxHeight) / 2)
      : height - style.marginV - boxHeight;
  const firstBaseline = boxY + paddingY + fontSize;
  const strokeWidth = style.preset === "minimal" ? Math.max(2, Math.round(fontSize * 0.08)) : Math.max(1, Math.round(fontSize * 0.045));
  const backgroundOpacity = style.preset === "minimal" ? 0 : style.backgroundOpacity;
  const weight = style.preset === "bold" ? 800 : 700;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" rx="${Math.round(fontSize * 0.28)}" fill="${style.backgroundColor}" fill-opacity="${backgroundOpacity}"/>
    <text x="50%" y="${firstBaseline}" text-anchor="middle" fill="${style.textColor}" stroke="${style.outlineColor}" stroke-width="${strokeWidth}" paint-order="stroke fill" stroke-linejoin="round" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="${weight}">
      ${lines.map((line, index) => `<tspan x="50%" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`).join("")}
    </text>
  </svg>`;
};

const renderSvg = async (svg: string, path: string) => {
  await sharp(Buffer.from(svg)).png().toFile(path);
};

export const preparePlanGraphics = async (
  root: string,
  plan: EditPlanV2,
  assets: ResolvedAsset[],
): Promise<PreparedGraphic[]> => {
  const captionsAsset = plan.timeline.captionsAssetId
    ? assets.find((asset) => asset.id === plan.timeline.captionsAssetId)
    : undefined;
  const shouldBurnCaptions = Boolean(
    captionsAsset && plan.timeline.captionStyle && plan.timeline.captionStyle.mode !== "selectable",
  );
  const captionsText = shouldBurnCaptions ? await readFile(captionsAsset!.path, "utf8") : "";
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ project: plan.project, timeline: plan.timeline }))
    .update(captionsText)
    .digest("hex")
    .slice(0, 20);
  const directory = join(root, ".opencut-agent", "render-assets", fingerprint);
  await mkdir(directory, { recursive: true });
  const graphics: PreparedGraphic[] = [];

  for (const [index, card] of plan.timeline.titleCards.entries()) {
    const path = join(directory, `title-${index + 1}-${card.id}.png`);
    await renderSvg(titleCardSvg(plan, card), path);
    graphics.push({ id: card.id, kind: "title", path, timelineStart: card.timelineStart, duration: card.duration });
  }

  if (shouldBurnCaptions) {
    const cues = parseSrtCues(captionsText);
    if (cues.length === 0) throw new Error("Burn-in captions require at least one valid SRT cue");
    if (cues.length > MAX_BURNED_CAPTION_CUES) {
      throw new Error(`Burn-in captions support at most ${MAX_BURNED_CAPTION_CUES} cues per render`);
    }
    for (const [index, cue] of cues.entries()) {
      const path = join(directory, `caption-${String(index + 1).padStart(4, "0")}.png`);
      await renderSvg(captionSvg(plan, cue), path);
      graphics.push({ id: `caption-${index + 1}`, kind: "caption", path, timelineStart: cue.start, duration: cue.end - cue.start });
    }
  }

  return graphics;
};
