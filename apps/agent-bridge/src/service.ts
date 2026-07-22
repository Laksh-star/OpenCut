import { access, writeFile } from "node:fs/promises";
import { posix } from "node:path";

import { compileEditPlan, type RenderProfile } from "./ffmpeg.ts";
import { preparePlanGraphics } from "./graphics.ts";
import { alignCaptionWords, captionsToSrt, type CaptionAlignmentOptions } from "./captions.ts";
import { readEditPlan, writeEditPlan, writeJsonFile } from "./files.ts";
import { inspectMedia, runProcess } from "./media.ts";
import { getWorkspaceRoot, resolveInputPath, resolveOutputPath } from "./paths.ts";
import { createReviewExportPackage } from "./export-package.ts";
import { preflightReviewSession, type PreflightMode } from "./preflight.ts";
import { loadReviewSession } from "./review-session.ts";
import { getPlanDuration, parseEditPlan, upgradeEditPlanToV2, type EditPlan } from "./schema.ts";

const MAX_PREVIEW_SECONDS = 300;

export const capabilities = {
  server: "opencut-agent-bridge",
  version: "0.6.0",
  adapter: "ffmpeg-production-graph",
  editorApiConnected: false,
  operations: [
    "inspect_media",
    "validate_edit_plan",
    "upgrade_edit_plan",
    "save_edit_plan",
    "compile_edit_plan",
    "render_preview",
    "build_word_timed_captions",
    "preflight_review_session",
    "approve_and_render_project",
    "approve_review_batch",
    "create_export_package",
  ],
  constraints: {
    schemaVersions: ["1", "2"],
    outputFormat: "mp4",
    maximumPreviewSeconds: MAX_PREVIEW_SECONDS,
    videoOverlays: true,
    audioMixing: true,
    smartAudioDucking: true,
    burnedInCaptions: true,
    transitions: true,
    titleCards: true,
    batchRendering: true,
    productionLayerEditing: true,
    wysiwygVisualControls: true,
    titleCardLayout: true,
    preflightChecks: true,
    exportPackages: true,
    publishing: false,
    workspaceRestricted: true,
  },
} as const;

export type ProjectRecord = {
  version: "1";
  id: string;
  name: string;
  status: "rendering" | "rendered" | "failed";
  editPlanPath: string;
  outputPath: string;
  approval: {
    source: "web-review" | "mcp";
    approvedAt: string;
  };
  render: {
    mode: "final";
    requestedLimitSeconds: number;
    renderedSeconds?: number;
    completedAt?: string;
    error?: string;
  };
  provenance?: {
    candidateId: string;
    revision: number;
    planSha256: string;
    sourceHashes: Array<{ assetId: string; path: string; sha256: string }>;
    createdBy?: { agent?: string; model?: string };
  };
  reviewerNote?: string;
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "opencut-project";

export const deriveProjectPaths = (plan: EditPlan) => {
  const outputDirectory = posix.dirname(plan.output.path);
  const projectDirectory =
    posix.basename(outputDirectory) === "renders"
      ? posix.dirname(outputDirectory)
      : outputDirectory;
  return {
    editPlanPath: posix.join(projectDirectory, "approved-edit-plan.json"),
    projectRecordPath: posix.join(projectDirectory, "opencut.project.json"),
  };
};

const resolvePlanAssets = async (root: string, plan: EditPlan) =>
  Promise.all(
    plan.assets.map(async (asset) => ({
      ...asset,
      path: await resolveInputPath(root, asset.path),
    }))
  );

export const validatePlan = (value: unknown) => {
  const plan = parseEditPlan(value);
  const durationSeconds = getPlanDuration(plan);
  return { plan, durationSeconds };
};

export const upgradePlan = (value: unknown) => {
  const plan = upgradeEditPlanToV2(value);
  return { plan, durationSeconds: getPlanDuration(plan) };
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

export const preflightReviewManifest = async (
  requestedManifestPath: string,
  options: {
    candidateIds?: string[];
    mode?: PreflightMode;
    renderLimitSeconds?: number;
  } = {},
) => {
  const root = await getWorkspaceRoot();
  const manifestPath = await resolveInputPath(root, requestedManifestPath);
  const session = await loadReviewSession(manifestPath);
  return preflightReviewSession(root, session, options);
};

export const createReviewExportPackageFromManifest = async (
  requestedManifestPath: string,
  options: {
    candidateIds?: string[];
    includeContactSheets?: boolean;
  } = {},
) => {
  const root = await getWorkspaceRoot();
  const manifestPath = await resolveInputPath(root, requestedManifestPath);
  const session = await loadReviewSession(manifestPath);
  return createReviewExportPackage(root, manifestPath, session, options);
};

export const buildWordTimedCaptions = async (
  transcript: unknown,
  requestedOutputPath: string,
  options: CaptionAlignmentOptions = {},
) => {
  if (!/\.srt$/i.test(requestedOutputPath)) throw new Error("Caption output must use the .srt extension");
  const cues = alignCaptionWords(transcript, options);
  const root = await getWorkspaceRoot();
  const outputPath = await resolveOutputPath(root, requestedOutputPath);
  await writeFile(outputPath, captionsToSrt(cues), { encoding: "utf8", flag: "wx" });
  return { outputPath: requestedOutputPath, cues: cues.length, durationSeconds: cues.at(-1)?.end ?? 0 };
};

export const compilePlanFile = async (
  requestedPlanPath: string,
  outputOverride?: string,
  durationLimitSeconds?: number,
  profile: RenderProfile = "preview",
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
  const graphics = plan.version === "2" ? await preparePlanGraphics(root, plan, assets) : [];
  return compileEditPlan(plan, assets, outputPath, safeDurationLimit, profile, graphics);
};

const executeCompiledPlan = async (compiled: ReturnType<typeof compileEditPlan>, renderedSeconds: number) => {
  const result = await runProcess(compiled.command, compiled.args, { maxOutputBytes: 4_000_000 });
  if (result.exitCode !== 0) {
    throw new Error(`ffmpeg failed with exit code ${result.exitCode}: ${result.stderr.trim()}`);
  }
  await access(compiled.outputPath);
  return { outputPath: compiled.outputPath, renderedSeconds, ffmpegExitCode: result.exitCode };
};

export const renderPlanValue = async (
  value: unknown,
  requestedOutputPath: string,
  durationSeconds = 30,
  profile: RenderProfile = "preview",
) => {
  const root = await getWorkspaceRoot();
  const { plan, durationSeconds: timelineDuration } = validatePlan(value);
  const assets = await resolvePlanAssets(root, plan);
  const outputPath = await resolveOutputPath(root, requestedOutputPath);
  const safeLimit = Math.min(MAX_PREVIEW_SECONDS, Math.max(0.1, durationSeconds));
  const renderPlan = { ...plan, output: { path: requestedOutputPath, overwrite: true } } as EditPlan;
  const graphics = renderPlan.version === "2" ? await preparePlanGraphics(root, renderPlan, assets) : [];
  const compiled = compileEditPlan(
    renderPlan,
    assets,
    outputPath,
    safeLimit,
    profile,
    graphics,
  );
  return executeCompiledPlan(compiled, Math.min(timelineDuration, safeLimit));
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
  return executeCompiledPlan(
    compiled,
    Math.min(compiled.durationSeconds, durationSeconds, MAX_PREVIEW_SECONDS),
  );
};

export const approveAndRenderProject = async (
  value: unknown,
  options: {
    renderLimitSeconds?: number;
    approvalSource?: ProjectRecord["approval"]["source"];
    provenance?: ProjectRecord["provenance"];
    reviewerNote?: string;
  } = {}
) => {
  const root = await getWorkspaceRoot();
  const { plan, durationSeconds } = validatePlan(value);
  await resolvePlanAssets(root, plan);

  const requestedLimitSeconds = Math.min(
    MAX_PREVIEW_SECONDS,
    Math.max(0.1, options.renderLimitSeconds ?? MAX_PREVIEW_SECONDS)
  );
  const requestedPaths = deriveProjectPaths(plan);
  const editPlanPath = await resolveOutputPath(root, requestedPaths.editPlanPath);
  const projectRecordPath = await resolveOutputPath(
    root,
    requestedPaths.projectRecordPath
  );
  const approvedAt = new Date().toISOString();
  const baseRecord: ProjectRecord = {
    version: "1",
    id: slugify(plan.project.name),
    name: plan.project.name,
    status: "rendering",
    editPlanPath: requestedPaths.editPlanPath,
    outputPath: plan.output.path,
    approval: {
      source: options.approvalSource ?? "web-review",
      approvedAt,
    },
    render: { mode: "final", requestedLimitSeconds },
    provenance: options.provenance,
    reviewerNote: options.reviewerNote,
  };

  await writeEditPlan(editPlanPath, plan);
  await writeJsonFile(projectRecordPath, baseRecord);

  try {
    const compiled = await compilePlanFile(editPlanPath, undefined, requestedLimitSeconds, "final");
    const result = await executeCompiledPlan(
      compiled,
      Math.min(durationSeconds, requestedLimitSeconds),
    );
    const completedAt = new Date().toISOString();
    const project: ProjectRecord = {
      ...baseRecord,
      status: "rendered",
      render: {
        ...baseRecord.render,
        renderedSeconds: result.renderedSeconds,
        completedAt,
      },
    };
    await writeJsonFile(projectRecordPath, project);
    return {
      project,
      projectRecordPath: requestedPaths.projectRecordPath,
      editPlanPath: requestedPaths.editPlanPath,
      outputPath: plan.output.path,
      durationSeconds,
      renderedSeconds: result.renderedSeconds,
    };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(
      -8_000
    );
    const project: ProjectRecord = {
      ...baseRecord,
      status: "failed",
      render: { ...baseRecord.render, error: message },
    };
    await writeJsonFile(projectRecordPath, project);
    throw error;
  }
};
