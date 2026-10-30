import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod/v4";
import { writeJsonFile } from "./files.ts";
import {
  getWorkspaceRoot,
  resolveInputPath,
  resolveOutputPath,
} from "./paths.ts";
import {
  RenderCancelledError,
  renderErrorMessage,
  withRenderContext,
  type RenderProgress,
} from "./render-context.ts";

export const renderJobSchema = z.object({
  id: z.string().uuid(),
  manifestPath: z.string(),
  candidateId: z.string(),
  revision: z.number().int(),
  mode: z.enum(["preview", "final"]),
  status: z.enum([
    "queued",
    "running",
    "cancelling",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ]),
  phase: z.enum(["preparing", "rendering", "publishing"]),
  message: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().optional(),
  percent: z.number().nullable(),
  renderedSeconds: z.number(),
  totalSeconds: z.number(),
  error: z.string().optional(),
  details: z.string().optional(),
});
export type RenderJob = z.infer<typeof renderJobSchema>;
export const jobIsActive = (job: RenderJob) =>
  ["queued", "running", "cancelling"].includes(job.status);
type Entry = {
  job: RenderJob;
  controller: AbortController;
  writes: Promise<void>;
  lastPersisted: number;
  persistenceError?: unknown;
};

export class RenderJobStore {
  private entries = new Map<string, Entry>();
  private async path(id: string, manifestPath: string) {
    z.string().uuid().parse(id);
    const scope = createHash("sha256")
      .update(manifestPath)
      .digest("hex")
      .slice(0, 24);
    return resolveOutputPath(
      await getWorkspaceRoot(),
      `.opencut-agent/render-jobs/${scope}/${id}.json`,
    );
  }
  private persist(entry: Entry) {
    const snapshot = structuredClone(entry.job);
    entry.lastPersisted = Date.now();
    entry.writes = entry.writes
      .catch(() => undefined)
      .then(async () =>
        writeJsonFile(
          await this.path(snapshot.id, snapshot.manifestPath),
          snapshot,
        ),
      );
    // Retain the failure for completion without an unhandled rejection during progress callbacks.
    void entry.writes.catch((error) => {
      entry.persistenceError = error;
    });
  }
  async create(
    input: Pick<
      RenderJob,
      "manifestPath" | "candidateId" | "revision" | "mode" | "totalSeconds"
    >,
  ) {
    const now = new Date().toISOString();
    const job: RenderJob = {
      ...input,
      id: randomUUID(),
      status: "queued",
      phase: "preparing",
      message: "Preparing your saved edit…",
      percent: null,
      renderedSeconds: 0,
      createdAt: now,
      updatedAt: now,
    };
    const entry: Entry = {
      job,
      controller: new AbortController(),
      writes: Promise.resolve(),
      lastPersisted: 0,
    };
    this.entries.set(job.id, entry);
    this.persist(entry);
    await entry.writes;
    return structuredClone(job);
  }
  async run<T>(id: string, action: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(id)!;
    entry.job.status = "running";
    const report = (progress: RenderProgress) => {
      if (entry.controller.signal.aborted) throw new RenderCancelledError();
      Object.assign(entry.job, progress, {
        updatedAt: new Date().toISOString(),
      });
      if (
        Date.now() - entry.lastPersisted > 750 ||
        progress.phase === "publishing"
      )
        this.persist(entry);
    };
    try {
      const result = await withRenderContext(
        { signal: entry.controller.signal, report },
        action,
      );
      Object.assign(entry.job, {
        status: "completed",
        percent: 100,
        renderedSeconds: entry.job.totalSeconds,
        message:
          entry.job.mode === "preview"
            ? "Edited preview ready"
            : "Final video ready",
      });
      return result;
    } catch (error) {
      const cancelled = error instanceof RenderCancelledError;
      Object.assign(entry.job, {
        status: cancelled ? "cancelled" : "failed",
        message: cancelled ? "Render cancelled" : "Render failed",
        error: renderErrorMessage(error),
        details: cancelled
          ? undefined
          : (error instanceof Error ? error.message : String(error)).slice(
              -6_000,
            ),
      });
      throw error;
    } finally {
      entry.job.updatedAt = entry.job.finishedAt = new Date().toISOString();
      this.persist(entry);
      await entry.writes;
      // Bound memory; persisted history remains available after a reload/restart.
      if (this.entries.size > 100)
        for (const [key, value] of this.entries) {
          if (!jobIsActive(value.job) && key !== id) {
            this.entries.delete(key);
            break;
          }
        }
    }
  }
  async list(manifestPath: string, candidateId?: string) {
    const folder = dirname(
      await this.path("00000000-0000-4000-8000-000000000000", manifestPath),
    );
    const result: RenderJob[] = [];
    const names = await readdir(folder).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const name of names) {
      if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
      const entry = this.entries.get(name.slice(0, -5));
      const job = entry
        ? structuredClone(entry.job)
        : renderJobSchema.parse(
            JSON.parse(
              await readFile(
                await resolveInputPath(
                  await getWorkspaceRoot(),
                  join(folder, name),
                ),
                "utf8",
              ),
            ),
          );
      if (
        job.manifestPath !== manifestPath ||
        (candidateId && job.candidateId !== candidateId)
      )
        continue;
      if (!entry && jobIsActive(job)) {
        Object.assign(job, {
          status: "interrupted",
          message: "Render interrupted",
          error:
            "The local service restarted before this render finished. Review the saved edit and retry.",
          updatedAt: new Date().toISOString(),
          finishedAt: job.updatedAt,
        });
        await writeJsonFile(await this.path(job.id, manifestPath), job);
      }
      result.push(job);
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async cancel(id: string, manifestPath: string) {
    const entry = this.entries.get(id);
    if (!entry || entry.job.manifestPath !== manifestPath)
      throw new Error("No active render belongs to this review session");
    if (!jobIsActive(entry.job) || entry.job.phase === "publishing")
      throw new Error("This render is already finishing or complete");
    entry.job.status = "cancelling";
    entry.job.message = "Cancelling render…";
    entry.job.updatedAt = new Date().toISOString();
    entry.controller.abort();
    this.persist(entry);
    await entry.writes;
    return structuredClone(entry.job);
  }
}
