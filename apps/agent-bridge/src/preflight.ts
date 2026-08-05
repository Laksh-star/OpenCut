import { stat } from "node:fs/promises";

import { getPlanDuration } from "./schema.ts";
import { resolveInputPath } from "./paths.ts";
import type { LoadedReviewCandidate, LoadedReviewSession } from "./review-session.ts";

export type PreflightMode = "preview" | "final" | "batch" | "export";
export type PreflightSeverity = "pass" | "warn" | "block";

export type PreflightCheck = {
  id: string;
  severity: PreflightSeverity;
  label: string;
  detail: string;
  candidateId?: string;
  revision?: number;
};

export type CandidatePreflight = {
  candidateId: string;
  revision: number;
  mode: PreflightMode;
  eligible: boolean;
  checks: PreflightCheck[];
  summary: Record<PreflightSeverity, number>;
};

export type ReviewSessionPreflight = {
  checkedAt: string;
  mode: PreflightMode;
  renderLimitSeconds: number;
  candidates: CandidatePreflight[];
  summary: Record<PreflightSeverity, number>;
};

export const DEFAULT_RENDER_LIMIT_SECONDS = 300;

const summarize = (checks: PreflightCheck[]): Record<PreflightSeverity, number> => ({
  pass: checks.filter((check) => check.severity === "pass").length,
  warn: checks.filter((check) => check.severity === "warn").length,
  block: checks.filter((check) => check.severity === "block").length,
});

const check = (
  candidate: LoadedReviewCandidate,
  id: string,
  severity: PreflightSeverity,
  label: string,
  detail: string,
): PreflightCheck => ({
  id,
  severity,
  label,
  detail,
  candidateId: candidate.id,
  revision: candidate.revision,
});

const candidateHasCurrentPreview = (candidate: LoadedReviewCandidate) =>
  candidate.previewExists && candidate.lastPreviewRevision === candidate.revision;

const timelineLayerWarnings = (candidate: LoadedReviewCandidate) => {
  const plan = candidate.plan;
  if (plan.version !== "2") return [];
  const timelineDuration = getPlanDuration(plan);
  const checks: PreflightCheck[] = [];
  for (const track of plan.timeline.overlayTracks) {
    for (const clip of track.clips) {
      const end = clip.timelineStart + (clip.sourceEnd - clip.sourceStart) / clip.speed;
      if (end > timelineDuration + 0.05) {
        checks.push(check(
          candidate,
          `overlay:${track.id}:${clip.id}:extends-timeline`,
          "warn",
          "Overlay timing",
          `Overlay clip ${clip.id} ends after the calculated timeline duration.`,
        ));
      }
    }
  }
  for (const track of plan.timeline.audioTracks) {
    for (const clip of track.clips) {
      const end = clip.timelineStart + (clip.sourceEnd - clip.sourceStart) / clip.speed;
      if (end > timelineDuration + 0.05) {
        checks.push(check(
          candidate,
          `audio:${track.id}:${clip.id}:extends-timeline`,
          "warn",
          "Audio timing",
          `Audio clip ${clip.id} ends after the calculated timeline duration.`,
        ));
      }
    }
  }
  return checks;
};

const readableAssetChecks = async (
  root: string,
  candidate: LoadedReviewCandidate,
) => {
  const checks: PreflightCheck[] = [];
  for (const asset of candidate.plan.assets) {
    try {
      const path = await resolveInputPath(root, asset.path);
      const stats = await stat(path);
      checks.push(check(
        candidate,
        `asset:${asset.id}:readable`,
        "pass",
        "Asset readable",
        `${asset.id} (${asset.kind}) is available inside the workspace (${stats.size} bytes).`,
      ));
    } catch (error) {
      checks.push(check(
        candidate,
        `asset:${asset.id}:readable`,
        "block",
        "Missing asset",
        error instanceof Error ? error.message : `Could not read asset ${asset.id}.`,
      ));
    }
  }
  return checks;
};

const buildCandidatePreflight = async (
  root: string,
  session: LoadedReviewSession,
  candidate: LoadedReviewCandidate,
  mode: PreflightMode,
  renderLimitSeconds: number,
  duplicateOutputPaths: Set<string>,
) => {
  const checks: PreflightCheck[] = [
    check(candidate, "plan:valid", "pass", "Plan schema", `Edit-plan v${candidate.plan.version} parsed successfully.`),
  ];
  checks.push(...await readableAssetChecks(root, candidate));

  if (candidate.status === "queued" || candidate.status === "rendering") {
    checks.push(check(candidate, "candidate:busy", "block", "Candidate state", "This candidate is already queued or rendering."));
  } else if (candidate.status === "failed") {
    checks.push(check(candidate, "candidate:failed", "warn", "Candidate state", "The latest render action failed. Review the error before trying again."));
  } else {
    checks.push(check(candidate, "candidate:available", "pass", "Candidate state", "Candidate is available for review actions."));
  }

  const durationSeconds = getPlanDuration(candidate.plan);
  if (durationSeconds > renderLimitSeconds) {
    checks.push(check(
      candidate,
      "timeline:render-limit",
      "warn",
      "Render limit",
      `Timeline is ${durationSeconds.toFixed(1)}s; this action is limited to ${renderLimitSeconds.toFixed(1)}s.`,
    ));
  } else {
    checks.push(check(
      candidate,
      "timeline:duration",
      "pass",
      "Timeline duration",
      `Timeline is ${durationSeconds.toFixed(1)}s, within the render limit.`,
    ));
  }

  if (duplicateOutputPaths.has(candidate.plan.output.path)) {
    checks.push(check(
      candidate,
      "output:duplicate",
      "block",
      "Output path",
      "Another candidate targets the same final output path.",
    ));
  }

  if (mode === "preview") {
    if (session.selectedCandidateId !== candidate.id) {
      checks.push(check(candidate, "preview:selected", "block", "Preview gate", "Select this candidate before rendering its preview."));
    } else {
      checks.push(check(candidate, "preview:selected", "pass", "Preview gate", "Candidate is selected for preview rendering."));
    }
    if (candidate.outputExists || candidate.status === "rendered") {
      checks.push(check(candidate, "preview:not-rendered", "block", "Preview gate", "Rendered candidates are immutable."));
    }
  }

  if (mode === "final") {
    if (session.selectedCandidateId !== candidate.id) {
      checks.push(check(candidate, "final:selected", "block", "Final gate", "Select this candidate before final approval."));
    }
  }

  if (mode === "final" || mode === "batch") {
    if (candidate.outputExists || candidate.status === "rendered") {
      checks.push(check(candidate, "final:not-rendered", "block", "Final gate", "Candidate is already rendered."));
    }
    if (candidateHasCurrentPreview(candidate)) {
      checks.push(check(candidate, "preview:fresh", "pass", "Preview freshness", `Revision ${candidate.revision} has a current rendered preview.`));
    } else {
      checks.push(check(candidate, "preview:fresh", "block", "Preview freshness", `Render a preview of revision ${candidate.revision} before final approval.`));
    }
  }

  if (mode === "export") {
    if (candidate.outputExists || candidate.status === "rendered") {
      checks.push(check(candidate, "export:rendered", "pass", "Export gate", "Rendered MP4 is available for packaging."));
    } else {
      checks.push(check(candidate, "export:rendered", "block", "Export gate", "Only rendered candidates can be packaged."));
    }
  }

  checks.push(...timelineLayerWarnings(candidate));
  const summary = summarize(checks);
  return {
    candidateId: candidate.id,
    revision: candidate.revision,
    mode,
    eligible: summary.block === 0,
    checks,
    summary,
  };
};

export const preflightReviewSession = async (
  root: string,
  session: LoadedReviewSession,
  options: {
    candidateIds?: string[];
    mode?: PreflightMode;
    renderLimitSeconds?: number;
  } = {},
): Promise<ReviewSessionPreflight> => {
  const mode = options.mode ?? "final";
  const renderLimitSeconds = options.renderLimitSeconds ?? DEFAULT_RENDER_LIMIT_SECONDS;
  const requestedIds = options.candidateIds ?? session.candidates.map((candidate) => candidate.id);
  const candidates = requestedIds.map((candidateId) => {
    const candidate = session.candidates.find((entry) => entry.id === candidateId);
    if (!candidate) throw new Error(`Unknown candidate: ${candidateId}`);
    return candidate;
  });
  const outputPathCounts = new Map<string, number>();
  for (const candidate of session.candidates) {
    outputPathCounts.set(candidate.plan.output.path, (outputPathCounts.get(candidate.plan.output.path) ?? 0) + 1);
  }
  const duplicateOutputPaths = new Set(
    Array.from(outputPathCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([path]) => path),
  );
  const candidatePreflights = await Promise.all(
    candidates.map((candidate) => buildCandidatePreflight(
      root,
      session,
      candidate,
      mode,
      renderLimitSeconds,
      duplicateOutputPaths,
    )),
  );
  const checks = candidatePreflights.flatMap((candidate) => candidate.checks);
  return {
    checkedAt: new Date().toISOString(),
    mode,
    renderLimitSeconds,
    candidates: candidatePreflights,
    summary: summarize(checks),
  };
};

export const assertPreflightEligible = (preflight: ReviewSessionPreflight) => {
  const blockers = preflight.candidates.flatMap((candidate) =>
    candidate.checks.filter((candidateCheck) => candidateCheck.severity === "block"),
  );
  if (blockers.length === 0) return;
  throw new Error(`Preflight blocked render: ${blockers.map((blocker) =>
    `${blocker.candidateId ?? "session"} ${blocker.label}: ${blocker.detail}`
  ).join("; ")}`);
};
