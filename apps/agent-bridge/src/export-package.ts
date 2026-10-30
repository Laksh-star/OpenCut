import { randomUUID } from "node:crypto";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix, relative, sep } from "node:path";

import { writeJsonFile } from "./files.ts";
import { runProcess } from "./media.ts";
import { resolveInputPath } from "./paths.ts";
import { getPlanDuration } from "./schema.ts";
import type { LoadedReviewCandidate, LoadedReviewSession } from "./review-session.ts";
import { assertPreflightEligible, preflightReviewSession } from "./preflight.ts";

export type ExportPackageCandidate = {
  candidateId: string;
  title: string;
  revision: number;
  durationSeconds: number;
  outputPath: string;
  packagedOutputPath: string;
  outputBytes: number;
  approvedEditPlanPath?: string;
  projectRecordPath?: string;
  captionsPath?: string;
  contactSheetPath?: string;
};

export type ReviewExportPackage = {
  version: "1";
  id: string;
  reviewSessionId: string;
  title: string;
  status: "created" | "partial";
  createdAt: string;
  packagePath: string;
  manifestPath: string;
  summaryPath: string;
  candidates: ExportPackageCandidate[];
  warnings: string[];
};

const toWorkspacePath = (root: string, path: string) =>
  relative(root, path).split(sep).join("/");

const timestampSlug = (value: string) => value.replace(/[:.]/g, "-");

const derivedProjectPaths = (candidate: LoadedReviewCandidate) => {
  const outputDirectory = posix.dirname(candidate.plan.output.path);
  const projectDirectory = posix.basename(outputDirectory) === "renders"
    ? posix.dirname(outputDirectory)
    : outputDirectory;
  return {
    editPlanPath: `${projectDirectory}/approved-edit-plan.json`,
    projectRecordPath: `${projectDirectory}/opencut.project.json`,
  };
};

const copyWorkspaceFile = async (
  root: string,
  packageDirectory: string,
  requestedPath: string,
  destinationRelativePath: string,
) => {
  const sourcePath = await resolveInputPath(root, requestedPath);
  const destinationPath = join(packageDirectory, destinationRelativePath);
  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
  return {
    workspacePath: toWorkspacePath(root, destinationPath),
    absolutePath: destinationPath,
    bytes: (await stat(destinationPath)).size,
  };
};

const tryCopyWorkspaceFile = async (
  root: string,
  packageDirectory: string,
  requestedPath: string,
  destinationRelativePath: string,
  warnings: string[],
) => {
  try {
    return await copyWorkspaceFile(root, packageDirectory, requestedPath, destinationRelativePath);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : `Could not copy ${requestedPath}`);
    return undefined;
  }
};

const buildContactSheet = async (
  sourcePath: string,
  destinationPath: string,
  warnings: string[],
) => {
  await mkdir(dirname(destinationPath), { recursive: true });
  const result = await runProcess("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    sourcePath,
    "-vf",
    "fps=1/2,scale=320:-1,tile=3x1:padding=8:margin=8:color=black",
    "-frames:v",
    "1",
    destinationPath,
  ]);
  if (result.exitCode !== 0) {
    warnings.push(`Could not create contact sheet for ${basename(sourcePath)}: ${result.stderr.trim()}`);
    return undefined;
  }
  return destinationPath;
};

const renderedCandidatesFor = (
  session: LoadedReviewSession,
  candidateIds: string[] | undefined,
) => {
  const ids = candidateIds ?? session.candidates
    .filter((candidate) => candidate.outputExists || candidate.status === "rendered")
    .map((candidate) => candidate.id);
  const candidates = ids.map((candidateId) => {
    const candidate = session.candidates.find((entry) => entry.id === candidateId);
    if (!candidate) throw new Error(`Unknown candidate: ${candidateId}`);
    return candidate;
  });
  if (candidates.length === 0) {
    throw new Error("No rendered candidates are available for export packaging");
  }
  return candidates;
};

export const createReviewExportPackage = async (
  root: string,
  manifestPath: string,
  session: LoadedReviewSession,
  options: {
    candidateIds?: string[];
    includeContactSheets?: boolean;
  } = {},
) => {
  const candidates = renderedCandidatesFor(session, options.candidateIds);
  const preflight = await preflightReviewSession(root, session, {
    candidateIds: candidates.map((candidate) => candidate.id),
    mode: "export",
  });
  assertPreflightEligible(preflight);

  const createdAt = new Date().toISOString();
  const packageId = randomUUID();
  const packageDirectory = join(
    dirname(manifestPath),
    "exports",
    `${timestampSlug(createdAt)}-${packageId.slice(0, 8)}`,
  );
  await mkdir(packageDirectory, { recursive: true });
  const warnings: string[] = [];
  const packagedCandidates: ExportPackageCandidate[] = [];

  for (const candidate of candidates) {
    const output = await copyWorkspaceFile(
      root,
      packageDirectory,
      candidate.plan.output.path,
      `media/${candidate.id}-${basename(candidate.plan.output.path)}`,
    );
    const projectPaths = derivedProjectPaths(candidate);
    const approvedPlan = await tryCopyWorkspaceFile(
      root,
      packageDirectory,
      projectPaths.editPlanPath,
      `records/${candidate.id}-approved-edit-plan.json`,
      warnings,
    );
    const projectRecord = await tryCopyWorkspaceFile(
      root,
      packageDirectory,
      projectPaths.projectRecordPath,
      `records/${candidate.id}-opencut.project.json`,
      warnings,
    );
    const captionsAsset = candidate.plan.assets.find(
      (asset) => asset.id === candidate.plan.timeline.captionsAssetId && asset.kind === "captions",
    );
    const captions = captionsAsset
      ? await tryCopyWorkspaceFile(
        root,
        packageDirectory,
        captionsAsset.path,
        `captions/${candidate.id}-${basename(captionsAsset.path)}`,
        warnings,
      )
      : undefined;
    const contactSheetPath = join(packageDirectory, "contact-sheets", `${candidate.id}.jpg`);
    const contactSheet = options.includeContactSheets === false
      ? undefined
      : await buildContactSheet(output.absolutePath, contactSheetPath, warnings);
    packagedCandidates.push({
      candidateId: candidate.id,
      title: candidate.title,
      revision: candidate.revision,
      durationSeconds: getPlanDuration(candidate.plan),
      outputPath: candidate.plan.output.path,
      packagedOutputPath: output.workspacePath,
      outputBytes: output.bytes,
      approvedEditPlanPath: approvedPlan?.workspacePath,
      projectRecordPath: projectRecord?.workspacePath,
      captionsPath: captions?.workspacePath,
      contactSheetPath: contactSheet ? toWorkspacePath(root, contactSheet) : undefined,
    });
  }

  const packagePath = toWorkspacePath(root, packageDirectory);
  const manifestWorkspacePath = `${packagePath}/manifest.json`;
  const summaryWorkspacePath = `${packagePath}/summary.md`;
  const exportPackage: ReviewExportPackage = {
    version: "1",
    id: packageId,
    reviewSessionId: session.id,
    title: session.title,
    status: warnings.length > 0 ? "partial" : "created",
    createdAt,
    packagePath,
    manifestPath: manifestWorkspacePath,
    summaryPath: summaryWorkspacePath,
    candidates: packagedCandidates,
    warnings,
  };
  await writeJsonFile(join(packageDirectory, "manifest.json"), exportPackage);
  await writeFile(join(packageDirectory, "summary.md"), [
    `# ${session.title} export package`,
    "",
    `Created: ${createdAt}`,
    `Review session: ${session.id}`,
    `Status: ${exportPackage.status}`,
    "",
    "## Candidates",
    "",
    ...packagedCandidates.flatMap((candidate) => [
      `- ${candidate.title} (${candidate.candidateId}, r${candidate.revision})`,
      `  - Output: ${candidate.packagedOutputPath}`,
      `  - Duration: ${candidate.durationSeconds.toFixed(1)}s`,
      `  - Size: ${candidate.outputBytes} bytes`,
    ]),
    ...(warnings.length > 0 ? ["", "## Warnings", "", ...warnings.map((warning) => `- ${warning}`)] : []),
    "",
  ].join("\n"), { encoding: "utf8", flag: "wx" });

  return exportPackage;
};
