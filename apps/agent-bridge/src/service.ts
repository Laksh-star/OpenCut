import { access } from "node:fs/promises";

import { compileEditPlan } from "./ffmpeg.ts";
import { readEditPlan, writeEditPlan } from "./files.ts";
import { inspectMedia, runProcess } from "./media.ts";
import { getWorkspaceRoot, resolveInputPath, resolveOutputPath } from "./paths.ts";
import { parseEditPlan, type EditPlan } from "./schema.ts";

const MAX_PREVIEW_SECONDS = 300;

export const capabilities = {
  server: "opencut-agent-bridge",
  version: "0.1.0",
  adapter: "ffmpeg-preview",
  editorApiConnected: false,
  operations: [
    "inspect_media",
    "validate_edit_plan",
    "save_edit_plan",
    "compile_edit_plan",
    "render_preview",
  ],
  constraints: {
    outputFormat: "mp4",
    maximumPreviewSeconds: MAX_PREVIEW_SECONDS,
    publishing: false,
    workspaceRestricted: true,
  },
} as const;

const resolvePlanAssets = async (root: string, plan: EditPlan) =>
  Promise.all(
    plan.assets.map(async (asset) => ({
      ...asset,
      path: await resolveInputPath(root, asset.path),
    }))
  );

export const validatePlan = (value: unknown) => {
  const plan = parseEditPlan(value);
  const durationSeconds = plan.timeline.clips.reduce(
    (total, clip) => total + (clip.sourceEnd - clip.sourceStart) / clip.speed,
    0
  );
  return { plan, durationSeconds };
};

export const savePlan = async (requestedPath: string, value: unknown) => {
  const root = await getWorkspaceRoot();
  const path = await resolveOutputPath(root, requestedPath);
  const { plan, durationSeconds } = validatePlan(value);
  await resolvePlanAssets(root, plan);
  await writeEditPlan(path, plan);
  return { path, durationSeconds };
};

export const inspectWorkspaceMedia = async (requestedPath: string) => {
  const root = await getWorkspaceRoot();
  const path = await resolveInputPath(root, requestedPath);
  return { path, probe: await inspectMedia(path) };
};

export const compilePlanFile = async (
  requestedPlanPath: string,
  outputOverride?: string,
  durationLimitSeconds?: number
) => {
  const root = await getWorkspaceRoot();
  const planPath = await resolveInputPath(root, requestedPlanPath);
  const plan = await readEditPlan(planPath);
  const assets = await resolvePlanAssets(root, plan);
  const outputPath = await resolveOutputPath(root, outputOverride ?? plan.output.path);
  const safeDurationLimit =
    durationLimitSeconds === undefined
      ? undefined
      : Math.min(MAX_PREVIEW_SECONDS, Math.max(0.1, durationLimitSeconds));
  return compileEditPlan(plan, assets, outputPath, safeDurationLimit);
};

export const renderPlanPreview = async (
  requestedPlanPath: string,
  outputOverride?: string,
  durationSeconds = 30
) => {
  const compiled = await compilePlanFile(
    requestedPlanPath,
    outputOverride,
    durationSeconds
  );
  const result = await runProcess(compiled.command, compiled.args, {
    maxOutputBytes: 4_000_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`ffmpeg failed with exit code ${result.exitCode}: ${result.stderr.trim()}`);
  }
  await access(compiled.outputPath);
  return {
    outputPath: compiled.outputPath,
    renderedSeconds: Math.min(compiled.durationSeconds, durationSeconds, MAX_PREVIEW_SECONDS),
    ffmpegExitCode: result.exitCode,
  };
};
