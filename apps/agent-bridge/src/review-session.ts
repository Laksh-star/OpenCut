import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { posix } from "node:path";

import { z } from "zod/v4";

import { readEditPlan, writeJsonFile } from "./files.ts";
import { getWorkspaceRoot, resolveInputPath } from "./paths.ts";
import type { EditPlan } from "./schema.ts";

const identifier = z.string().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
export const candidateStatusSchema = z.enum([
  "ready-for-review",
  "selected",
  "rendering",
  "rendered",
  "failed",
]);

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
    planPath: z.string().min(1),
    thumbnailPath: z.string().min(1).optional(),
    status: candidateStatusSchema.default("ready-for-review"),
    error: z.string().max(8_000).optional(),
  })).min(1),
  selectedCandidateId: identifier.optional(),
  updatedAt: z.string().datetime(),
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
export type ReviewCandidateStatus = z.infer<typeof candidateStatusSchema>;

export type LoadedReviewCandidate = ReviewSession["candidates"][number] & {
  plan: EditPlan;
  outputExists: boolean;
};

export type LoadedReviewSession = Omit<ReviewSession, "candidates"> & {
  candidates: LoadedReviewCandidate[];
};

export const readReviewSession = async (path: string) =>
  reviewSessionSchema.parse(JSON.parse(await readFile(path, "utf8")));

export const loadReviewSession = async (path: string): Promise<LoadedReviewSession> => {
  const root = await getWorkspaceRoot();
  const session = await readReviewSession(path);
  const candidates = await Promise.all(session.candidates.map(async (candidate) => {
    const planPath = await resolveInputPath(root, candidate.planPath);
    const plan = await readEditPlan(planPath);
    const outputDirectory = posix.dirname(plan.output.path);
    const projectDirectory = posix.basename(outputDirectory) === "renders" ? posix.dirname(outputDirectory) : outputDirectory;
    if (projectDirectory !== posix.dirname(candidate.planPath)) {
      throw new Error(`Candidate ${candidate.id} must render inside its own candidate directory`);
    }
    let outputExists = false;
    try {
      const outputPath = await resolveInputPath(root, plan.output.path);
      outputExists = (await stat(outputPath)).isFile();
    } catch {
      outputExists = false;
    }
    return { ...candidate, plan, outputExists, status: outputExists ? "rendered" as const : candidate.status };
  }));
  return { ...session, candidates };
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
}
