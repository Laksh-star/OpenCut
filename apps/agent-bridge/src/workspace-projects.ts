import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod/v4";
import {
  getWorkspaceRoot,
  resolveInputPath,
  resolveOutputPath,
} from "./paths.ts";
import { inspectMedia } from "./media.ts";
import { writeEditPlan, writeJsonFile } from "./files.ts";
import { editPlanSchema, getPlanDuration, type EditPlan } from "./schema.ts";
import { loadReviewSession, reviewSessionSchema } from "./review-session.ts";
import { parseCaptionFile } from "./caption-file.ts";
import { captionsToSrt } from "./captions.ts";
import { proposeEditorialEdit } from "./editorial.ts";

export const MAX_PROJECT_SECONDS = 14_400;
const recordSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  name: z.string().min(1).max(120),
  kind: z.enum(["full-project", "clip-review"]),
  manifestPath: z.string(),
  createdAt: z.string(),
  parentProjectId: z.string().optional(),
});
export type WorkspaceProject = z.infer<typeof recordSchema>;
export const newProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sourcePath: z.string().min(1),
});
export const newClipSchema = z.object({
  title: z.string().trim().min(1).max(120),
  start: z.number().min(0),
  end: z.number().positive(),
  expectedRevision: z.number().int().positive(),
});

const recordPath = async (id: string) => {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error("Invalid project id");
  return resolveOutputPath(
    await getWorkspaceRoot(),
    `.opencut-agent/projects/${id}.json`,
  );
};
export const listWorkspaceProjects = async () => {
  const directory = dirname(await recordPath("index"));
  const records = await Promise.all(
    (await readdir(directory))
      .filter((name) => /^[a-zA-Z0-9_-]+\.json$/.test(name))
      .map(async (name) => {
        const path = await resolveInputPath(
          await getWorkspaceRoot(),
          join(directory, name),
        );
        const record = recordSchema.parse(
          JSON.parse(await readFile(path, "utf8")),
        );
        try {
          const session = await loadReviewSession(record.manifestPath);
          return {
            ...record,
            updatedAt: session.updatedAt,
            durationSeconds: getPlanDuration(session.candidates[0]!.plan),
            rendered: session.candidates[0]!.outputExists,
            available: true,
          };
        } catch {
          return {
            ...record,
            updatedAt: record.createdAt,
            durationSeconds: 0,
            rendered: false,
            available: false,
          };
        }
      }),
  );
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};
export const readWorkspaceProject = async (id: string) =>
  recordSchema.parse(
    JSON.parse(
      await readFile(
        await resolveInputPath(await getWorkspaceRoot(), await recordPath(id)),
        "utf8",
      ),
    ),
  );
const remember = async (record: WorkspaceProject) => {
  await writeJsonFile(await recordPath(record.id), record);
  return record;
};
export const rememberReviewProject = async (
  manifest: string,
  parentProjectId?: string,
) => {
  const root = await getWorkspaceRoot();
  const manifestPath = await resolveInputPath(root, manifest);
  const existing = (await listWorkspaceProjects()).find(
    (entry) => entry.manifestPath === manifestPath,
  );
  if (existing)
    return parentProjectId
      ? remember(recordSchema.parse({ ...existing, parentProjectId }))
      : existing;
  const session = await loadReviewSession(manifestPath);
  return remember({
    id: createHash("sha256").update(manifestPath).digest("hex").slice(0, 24),
    name: session.title.slice(0, 120),
    kind: session.kind,
    manifestPath,
    createdAt: new Date().toISOString(),
    parentProjectId,
  });
};

export const inspectProjectMedia = async (requestedPath: string) => {
  const path = await resolveInputPath(await getWorkspaceRoot(), requestedPath);
  if (/\.(srt|vtt)$/i.test(path)) {
    const contents = await readFile(path, "utf8");
    if (Buffer.byteLength(contents) > 1_000_000)
      throw new Error("Caption file exceeds 1 MB");
    const cues = parseCaptionFile(contents);
    if (!cues.length) throw new Error("No valid caption passages found");
    let captionPath = path;
    if (/\.vtt$/i.test(path)) {
      const normalized = captionsToSrt(cues);
      captionPath = await resolveOutputPath(
        await getWorkspaceRoot(),
        `.opencut-agent/imports/${createHash("sha256").update(normalized).digest("hex")}.srt`,
      );
      try {
        await writeFile(captionPath, normalized, { flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    return {
      id: `asset-${randomUUID()}`,
      path: captionPath,
      kind: "captions" as const,
      duration: cues.at(-1)!.end,
      width: 0,
      height: 0,
      frameRate: 30,
      hasAudio: false,
      stillImage: false,
    };
  }
  const probe = (await inspectMedia(path)) as {
    format: { duration?: string };
    streams: Array<{
      codec_type: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
    }>;
  };
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const hasAudio = probe.streams.some(
    (stream) => stream.codec_type === "audio",
  );
  if (!video && !hasAudio)
    throw new Error("This file has no usable video or audio");
  const stillImage = /\.(png|jpe?g|webp)$/i.test(path);
  const duration = stillImage ? 0 : Number(probe.format.duration);
  if (!stillImage && (!Number.isFinite(duration) || duration <= 0))
    throw new Error("Media duration could not be read");
  const [n, d] = (video?.avg_frame_rate ?? "30/1").split("/").map(Number);
  return {
    id: `asset-${randomUUID()}`,
    path,
    kind: video ? ("video" as const) : ("audio" as const),
    duration,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    frameRate: n && d ? n / d : 30,
    hasAudio,
    stillImage,
  };
};

async function persistNewProject(
  name: string,
  value: EditPlan,
  kind: WorkspaceProject["kind"],
  parentProjectId?: string,
  captionContents?: string,
) {
  const root = await getWorkspaceRoot();
  const id = randomUUID();
  const directory = await resolveOutputPath(
    root,
    `opencut-projects/${id}/candidates/master/edit-plan.json`,
  );
  const planPath = directory;
  const projectDirectory = dirname(dirname(dirname(planPath)));
  let plan = editPlanSchema.parse({
    ...value,
    project: { ...value.project, name },
    output: {
      path: join(dirname(planPath), "renders/output.mp4"),
      overwrite: false,
    },
  });
  if (captionContents !== undefined) {
    const path = join(dirname(planPath), "captions.srt");
    await writeFile(path, captionContents, { flag: "wx" });
    const captionId = plan.timeline.captionsAssetId ?? "project-captions";
    plan = editPlanSchema.parse({
      ...plan,
      assets: [
        ...plan.assets.filter((asset) => asset.id !== captionId),
        { id: captionId, path, kind: "captions" },
      ],
      timeline: { ...plan.timeline, captionsAssetId: captionId },
    });
  }
  await writeEditPlan(planPath, plan);
  const now = new Date().toISOString();
  const manifestPath = join(projectDirectory, "review-session.json");
  await writeJsonFile(
    manifestPath,
    reviewSessionSchema.parse({
      version: "1",
      id,
      kind,
      title: name,
      updatedAt: now,
      sourceAssets: plan.assets
        .filter((asset) => asset.kind !== "captions")
        .map((asset) => ({
          id: asset.id,
          path: asset.path,
          label: basename(asset.path).slice(0, 120),
        })),
      candidates: [
        {
          id: "master",
          title: name,
          strategy: "manual",
          summary:
            kind === "full-project"
              ? "Full-video project"
              : "Clip created from the main edit",
          planPath,
          status: kind === "full-project" ? "selected" : "ready-for-review",
          revision: 1,
        },
      ],
      selectedCandidateId: kind === "full-project" ? "master" : undefined,
    }),
  );
  return remember({
    id,
    name,
    kind,
    manifestPath,
    createdAt: now,
    parentProjectId,
  });
}
export const createWorkspaceProject = async (value: unknown) => {
  const input = newProjectSchema.parse(value);
  const media = await inspectProjectMedia(input.sourcePath);
  if (media.kind !== "video" || media.stillImage)
    throw new Error("Start a project with a video file");
  if (media.duration > MAX_PROJECT_SECONDS)
    throw new Error("Projects currently support up to four hours");
  const plan = editPlanSchema.parse({
    version: "2",
    project: {
      name: input.name,
      width: media.width,
      height: media.height,
      frameRate: media.frameRate,
    },
    assets: [{ id: "source", kind: "video", path: media.path }],
    timeline: {
      clips: [
        {
          id: "main",
          assetId: "source",
          sourceStart: 0,
          sourceEnd: media.duration,
          includeAudio: media.hasAudio,
        },
      ],
      subtitleProvider: {
        mode: "local-whisper",
        status: "selected",
        language: "en",
      },
    },
    output: { path: "placeholder.mp4" },
  });
  return persistNewProject(input.name, plan, "full-project");
};
export const duplicateWorkspaceProject = async (id: string) => {
  const record = await readWorkspaceProject(id);
  const session = await loadReviewSession(record.manifestPath);
  return persistNewProject(
    `${record.name.slice(0, 109)} (copy)`,
    session.candidates[0]!.plan,
    "full-project",
  );
};
export const createWorkspaceClip = async (id: string, value: unknown) => {
  const input = newClipSchema.parse(value);
  if (input.end <= input.start || input.end - input.start > 120)
    throw new Error("Choose a clip range between 0 and 120 seconds long");
  const record = await readWorkspaceProject(id);
  const session = await loadReviewSession(record.manifestPath);
  const master = session.candidates[0]!;
  if (master.revision !== input.expectedRevision)
    throw new Error("The main edit changed. Refresh before creating a clip");
  const asset = master.plan.assets.find(
    (asset) => asset.id === master.plan.timeline.captionsAssetId,
  );
  const cues = asset
    ? parseCaptionFile(
        await readFile(
          await resolveInputPath(await getWorkspaceRoot(), asset.path),
          "utf8",
        ),
      )
    : [];
  const proposal =
    input.start === 0 &&
    Math.abs(input.end - getPlanDuration(master.plan)) < 0.001
      ? { plan: master.plan, captions: cues, warnings: [] as string[] }
      : proposeEditorialEdit(
          master.plan,
          { type: "keep", ranges: [{ start: input.start, end: input.end }] },
          cues,
        );
  const project = await persistNewProject(
    input.title,
    proposal.plan,
    "clip-review",
    id,
    asset ? captionsToSrt(proposal.captions) : undefined,
  );
  return { project, warnings: proposal.warnings };
};
