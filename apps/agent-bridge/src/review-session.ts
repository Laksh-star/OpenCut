import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, posix } from "node:path";

import { z } from "zod/v4";

import { readEditPlan, writeEditPlan, writeJsonFile } from "./files.ts";
import { getWorkspaceRoot, resolveInputPath, resolveOutputPath } from "./paths.ts";
import { editPlanSchema, type EditPlan } from "./schema.ts";

const identifier = z.string().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const timestamp = z.string().datetime();

export const candidateStatusSchema = z.enum([
  "ready-for-review",
  "selected",
  "previewing",
  "preview-ready",
  "queued",
  "rendering",
  "rendered",
  "failed",
]);

export const reviewEventTypeSchema = z.enum([
  "candidate-selected",
  "plan-revised",
  "preview-requested",
  "preview-rendered",
  "preview-failed",
  "reviewer-note-added",
  "batch-approved",
  "batch-completed",
  "export-package-created",
  "final-approved",
  "final-rendered",
  "final-failed",
]);

export const reviewEventSchema = z.object({
  id: z.string().uuid(),
  type: reviewEventTypeSchema,
  at: timestamp,
  candidateId: identifier.optional(),
  revision: z.number().int().positive().optional(),
  actor: z.enum(["reviewer", "agent", "system"]).default("system"),
  detail: z.string().max(1_000).optional(),
});

export const reviewerNoteSchema = z.object({
  id: z.string().uuid(),
  candidateId: identifier,
  revision: z.number().int().positive(),
  text: z.string().trim().min(1).max(2_000),
  createdAt: timestamp,
});

export const candidateStrategySchema = z.enum([
  "unspecified",
  "distinct-moment",
  "narrative-segment",
  "social-variant",
  "archive-summary",
  "manual",
]);

export const candidateClipRationaleSchema = z.object({
  clipId: identifier,
  note: z.string().trim().min(1).max(800),
});

export const renderBatchItemSchema = z.object({
  candidateId: identifier,
  revision: z.number().int().positive(),
  status: z.enum(["queued", "rendering", "rendered", "failed"]),
  outputPath: z.string().min(1).optional(),
  error: z.string().max(8_000).optional(),
});

export const renderBatchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["queued", "rendering", "completed", "partial", "failed"]),
  requestedAt: timestamp,
  completedAt: timestamp.optional(),
  items: z.array(renderBatchItemSchema).min(1).max(20),
});

export const exportPackageCandidateSchema = z.object({
  candidateId: identifier,
  revision: z.number().int().positive(),
  title: z.string().min(1).max(160),
  durationSeconds: z.number().min(0),
  outputPath: z.string().min(1),
  packagedOutputPath: z.string().min(1),
  outputBytes: z.number().int().min(0),
  approvedEditPlanPath: z.string().min(1).optional(),
  projectRecordPath: z.string().min(1).optional(),
  captionsPath: z.string().min(1).optional(),
  contactSheetPath: z.string().min(1).optional(),
});

export const exportPackageSchema = z.object({
  version: z.literal("1"),
  id: z.string().uuid(),
  reviewSessionId: identifier,
  title: z.string().min(1).max(160),
  status: z.enum(["created", "partial"]),
  createdAt: timestamp,
  packagePath: z.string().min(1),
  manifestPath: z.string().min(1),
  summaryPath: z.string().min(1),
  candidates: z.array(exportPackageCandidateSchema).min(1).max(20),
  warnings: z.array(z.string().max(2_000)).default([]),
});

export const reviewSessionSchema = z.object({
  version: z.literal("1"),
  id: identifier,
  title: z.string().min(1).max(160),
  sourceAssets: z.array(z.object({
    id: identifier,
    label: z.string().min(1).max(120),
    path: z.string().min(1),
  })).min(1),
  candidates: z.array(z.object({
    id: identifier,
    title: z.string().min(1).max(160),
    summary: z.string().max(500).default(""),
    strategy: candidateStrategySchema.default("unspecified"),
    rationale: z.string().trim().max(1_200).default(""),
    clipRationales: z.array(candidateClipRationaleSchema).default([]),
    planPath: z.string().min(1),
    thumbnailPath: z.string().min(1).optional(),
    status: candidateStatusSchema.default("ready-for-review"),
    revision: z.number().int().positive().default(1),
    lastPreviewRevision: z.number().int().positive().optional(),
    previewOutputPath: z.string().min(1).optional(),
    error: z.string().max(8_000).optional(),
  })).min(1),
  selectedCandidateId: identifier.optional(),
  reviewerNotes: z.array(reviewerNoteSchema).default([]),
  events: z.array(reviewEventSchema).default([]),
  renderBatches: z.array(renderBatchSchema).default([]),
  exportPackages: z.array(exportPackageSchema).default([]),
  createdBy: z.object({
    agent: z.string().min(1).max(120).optional(),
    model: z.string().min(1).max(160).optional(),
  }).optional(),
  updatedAt: timestamp,
}).superRefine((session, context) => {
  const ids = new Set<string>();
  for (const [index, candidate] of session.candidates.entries()) {
    if (ids.has(candidate.id)) {
      context.addIssue({ code: "custom", message: `Duplicate candidate id: ${candidate.id}`, path: ["candidates", index, "id"] });
    }
    ids.add(candidate.id);
  }
  if (session.selectedCandidateId && !ids.has(session.selectedCandidateId)) {
    context.addIssue({ code: "custom", message: "selectedCandidateId must reference a candidate", path: ["selectedCandidateId"] });
  }
});

export type ReviewSession = z.infer<typeof reviewSessionSchema>;
export type ReviewEventType = z.infer<typeof reviewEventTypeSchema>;
export type ReviewCandidateStatus = z.infer<typeof candidateStatusSchema>;

export type LoadedReviewCandidate = ReviewSession["candidates"][number] & {
  plan: EditPlan;
  outputExists: boolean;
  previewExists: boolean;
};

export type LoadedReviewSession = Omit<ReviewSession, "candidates"> & {
  candidates: LoadedReviewCandidate[];
};

export const createReviewEvent = (
  type: ReviewEventType,
  options: Partial<Omit<z.infer<typeof reviewEventSchema>, "id" | "type" | "at">> = {},
) => reviewEventSchema.parse({ id: randomUUID(), type, at: new Date().toISOString(), ...options });

export const readReviewSession = async (path: string) =>
  reviewSessionSchema.parse(JSON.parse(await readFile(path, "utf8")));

const fileExists = async (root: string, requestedPath: string | undefined) => {
  if (!requestedPath) return false;
  try {
    const path = await resolveInputPath(root, requestedPath);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

const candidateDirectoryFor = (candidate: ReviewSession["candidates"][number]) =>
  posix.dirname(candidate.planPath);

const assertCandidateOutput = (
  candidate: ReviewSession["candidates"][number],
  outputPath: string,
) => {
  const outputDirectory = posix.dirname(outputPath);
  const projectDirectory = posix.basename(outputDirectory) === "renders"
    ? posix.dirname(outputDirectory)
    : outputDirectory;
  if (projectDirectory !== candidateDirectoryFor(candidate)) {
    throw new Error(`Candidate ${candidate.id} must render inside its own candidate directory`);
  }
};

export const loadReviewSession = async (path: string): Promise<LoadedReviewSession> => {
  const root = await getWorkspaceRoot();
  const session = await readReviewSession(path);
  const candidates = await Promise.all(session.candidates.map(async (candidate) => {
    const planPath = await resolveInputPath(root, candidate.planPath);
    const plan = await readEditPlan(planPath);
    assertCandidateOutput(candidate, plan.output.path);
    if (candidate.previewOutputPath) assertCandidateOutput(candidate, candidate.previewOutputPath);
    const planClipIds = new Set(plan.timeline.clips.map((clip) => clip.id));
    for (const clipRationale of candidate.clipRationales) {
      if (!planClipIds.has(clipRationale.clipId)) {
        throw new Error(`Candidate ${candidate.id} rationale references unknown clip ${clipRationale.clipId}`);
      }
    }
    const outputExists = await fileExists(root, plan.output.path);
    const previewExists = await fileExists(root, candidate.previewOutputPath);
    return {
      ...candidate,
      plan,
      outputExists,
      previewExists,
      status: outputExists ? "rendered" as const : candidate.status,
    };
  }));
  return { ...session, candidates };
};

const hashPath = async (path: string) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};

type RegisteredSession = { manifestPath: string; approvalToken: string };

export class ReviewSessionRegistry {
  private sessions = new Map<string, RegisteredSession>();

  async register(requestedManifestPath: string) {
    const root = await getWorkspaceRoot();
    const manifestPath = await resolveInputPath(root, requestedManifestPath);
    await loadReviewSession(manifestPath);
    const sessionId = randomUUID();
    const approvalToken = randomUUID();
    this.sessions.set(sessionId, { manifestPath, approvalToken });
    return { sessionId, approvalToken };
  }

  get(sessionId: string) {
    const registered = this.sessions.get(sessionId);
    if (!registered) throw new Error("Unknown or expired review session");
    return registered;
  }

  async load(sessionId: string) {
    const registered = this.get(sessionId);
    return { ...(await loadReviewSession(registered.manifestPath)), approvalToken: registered.approvalToken };
  }

  async update(sessionId: string, mutate: (session: ReviewSession) => ReviewSession) {
    const registered = this.get(sessionId);
    const session = await readReviewSession(registered.manifestPath);
    const next = reviewSessionSchema.parse(mutate(session));
    await writeJsonFile(registered.manifestPath, next);
    return this.load(sessionId);
  }

  async reviseCandidate(sessionId: string, candidateId: string, value: unknown, note?: string) {
    const root = await getWorkspaceRoot();
    const registered = this.get(sessionId);
    const session = await readReviewSession(registered.manifestPath);
    const candidate = session.candidates.find((entry) => entry.id === candidateId);
    if (!candidate) throw new Error("Unknown candidate");
    if (candidate.status === "queued" || candidate.status === "rendering") {
      throw new Error("Queued or rendering candidates cannot be revised");
    }
    if (candidate.status === "rendered") {
      throw new Error("Rendered candidates are immutable; create a new candidate to revise them");
    }
    const planPath = await resolveInputPath(root, candidate.planPath);
    const currentPlan = await readEditPlan(planPath);
    const nextPlan = editPlanSchema.parse(value);
    assertCandidateOutput(candidate, nextPlan.output.path);
    if (JSON.stringify(nextPlan.assets) !== JSON.stringify(currentPlan.assets)) {
      throw new Error("Review revisions cannot replace candidate assets");
    }
    if (JSON.stringify(nextPlan.project) !== JSON.stringify(currentPlan.project)) {
      throw new Error("Review revisions cannot replace project settings");
    }
    if (JSON.stringify(nextPlan.output) !== JSON.stringify(currentPlan.output)) {
      throw new Error("Review revisions cannot replace the final output contract");
    }

    const nextRevision = candidate.revision + 1;
    const revisionDirectory = posix.join(candidateDirectoryFor(candidate), "revisions");
    const currentSnapshot = posix.join(revisionDirectory, `revision-${candidate.revision}.edit-plan.json`);
    const nextSnapshot = posix.join(revisionDirectory, `revision-${nextRevision}.edit-plan.json`);
    const currentSnapshotPath = await resolveOutputPath(root, currentSnapshot);
    const nextSnapshotPath = await resolveOutputPath(root, nextSnapshot);
    await mkdir(dirname(currentSnapshotPath), { recursive: true });
    if (!(await fileExists(root, currentSnapshot))) await writeEditPlan(currentSnapshotPath, currentPlan);
    await writeEditPlan(nextSnapshotPath, nextPlan);
    await writeEditPlan(planPath, nextPlan);

    return this.update(sessionId, (current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      candidates: current.candidates.map((entry) => entry.id === candidateId ? {
        ...entry,
        revision: nextRevision,
        lastPreviewRevision: undefined,
        previewOutputPath: undefined,
        status: current.selectedCandidateId === candidateId ? "selected" : "ready-for-review",
        error: undefined,
      } : entry),
      events: [...current.events, createReviewEvent("plan-revised", {
        actor: "reviewer",
        candidateId,
        revision: nextRevision,
        detail: note?.trim() || `Saved revision ${nextRevision}`,
      })],
    }));
  }

  async addReviewerNote(sessionId: string, candidateId: string, text: string) {
    return this.update(sessionId, (session) => {
      const candidate = session.candidates.find((entry) => entry.id === candidateId);
      if (!candidate) throw new Error("Unknown candidate");
      const note = reviewerNoteSchema.parse({
        id: randomUUID(), candidateId, revision: candidate.revision, text, createdAt: new Date().toISOString(),
      });
      return {
        ...session,
        updatedAt: new Date().toISOString(),
        reviewerNotes: [...session.reviewerNotes, note],
        events: [...session.events, createReviewEvent("reviewer-note-added", {
          actor: "reviewer", candidateId, revision: candidate.revision, detail: note.text,
        })],
      };
    });
  }

  async provenance(sessionId: string, candidateId: string) {
    const root = await getWorkspaceRoot();
    const session = await this.load(sessionId);
    const candidate = session.candidates.find((entry) => entry.id === candidateId);
    if (!candidate) throw new Error("Unknown candidate");
    const planPath = await resolveInputPath(root, candidate.planPath);
    const sourceHashes = await Promise.all(session.sourceAssets.map(async (asset) => ({
      assetId: asset.id,
      path: asset.path,
      sha256: await hashPath(await resolveInputPath(root, asset.path)),
    })));
    return {
      candidateId,
      revision: candidate.revision,
      planSha256: await hashPath(planPath),
      sourceHashes,
      createdBy: session.createdBy,
    };
  }
}
