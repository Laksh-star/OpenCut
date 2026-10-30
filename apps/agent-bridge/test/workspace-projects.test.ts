import { describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWorkspaceProject,
  createWorkspaceClip,
  duplicateWorkspaceProject,
  listWorkspaceProjects,
  inspectProjectMedia,
  readWorkspaceProject,
} from "../src/workspace-projects.ts";
import {
  loadReviewSession,
  ReviewSessionRegistry,
} from "../src/review-session.ts";
import { runProcess } from "../src/media.ts";
import { preflightReviewSession } from "../src/preflight.ts";
import { compilePlanFile, approveAndRenderProject } from "../src/service.ts";

async function fixture(seconds = 4) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "opencut-main-project-")),
  );
  process.env.OPENCUT_AGENT_ROOT = root;
  const source = join(root, "source.mp4");
  const result = await runProcess("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=blue:s=320x240:r=1:d=${seconds}`,
    "-c:v",
    "libx264",
    source,
  ]);
  if (result.exitCode) throw new Error(result.stderr);
  return {
    root,
    source,
    project: await createWorkspaceProject({
      name: "Main video",
      sourcePath: source,
    }),
  };
}

describe("main project persistence and editing", () => {
  test("creates a full-length project, reopens metadata, and never silently clips a long final", async () => {
    const { project, source } = await fixture(301);
    const reopened = await readWorkspaceProject(project.id);
    const session = await loadReviewSession(reopened.manifestPath);
    expect(session.kind).toBe("full-project");
    expect(session.selectedCandidateId).toBe("master");
    expect(session.candidates[0]!.plan.timeline.clips[0]!.sourceEnd).toBe(301);
    expect(session.sourceAssets[0]!.path).toBe(source);
    expect((await listWorkspaceProjects())[0]!.durationSeconds).toBe(301);
    const plan = session.candidates[0]!.plan;
    await expect(
      approveAndRenderProject(plan, { renderLimitSeconds: 300 }),
    ).rejects.toThrow("full video");
    const preflight = await preflightReviewSession(
      process.env.OPENCUT_AGENT_ROOT!,
      session,
      { mode: "preview", renderLimitSeconds: 60 },
    );
    expect(
      preflight.candidates[0]!.checks.find((check) =>
        check.id.includes("render-limit"),
      )!.severity,
    ).toBe("block");
    const compiled = await compilePlanFile(
      session.candidates[0]!.planPath,
      undefined,
      301,
      "final",
    );
    expect(compiled.args.slice(-3)).toEqual(["-t", "301", plan.output.path]);
  });

  test("main saves append media and settings, invalidate previews, and reject replacement of an original source", async () => {
    const { project, root } = await fixture();
    const registry = new ReviewSessionRegistry();
    const { sessionId } = await registry.register(project.manifestPath);
    const loaded = await registry.load(sessionId);
    const plan = loaded.candidates[0]!.plan;
    await writeFile(
      join(root, "captions.srt"),
      "1\n00:00:01,000 --> 00:00:02,000\nA complete answer\n",
    );
    const media = await inspectProjectMedia(join(root, "captions.srt"));
    const next = {
      ...plan,
      project: { ...plan.project, width: 640, height: 360 },
      assets: [
        ...plan.assets,
        { id: media.id, kind: media.kind, path: media.path },
      ],
      timeline: { ...plan.timeline, captionsAssetId: media.id },
    };
    const saved = await registry.reviseCandidate(
      sessionId,
      "master",
      next,
      "Attach captions",
      { expectedRevision: 1 },
    );
    expect(saved.candidates[0]!.revision).toBe(2);
    expect(saved.candidates[0]!.previewExists).toBe(false);
    await expect(
      registry.reviseCandidate(sessionId, "master", {
        ...next,
        assets: next.assets.map((asset) => ({ ...asset, path: media.path })),
      }),
    ).rejects.toThrow("immutable");
    await expect(
      registry.reviseCandidate(sessionId, "master", next, "stale", {
        expectedRevision: 1,
      }),
    ).rejects.toThrow("changed");
    const restored = await registry.undoEdit(sessionId, "master", 2);
    expect(restored.candidates[0]!.revision).toBe(3);
    expect(restored.candidates[0]!.plan.assets).toHaveLength(1);
  });

  test("creates isolated retimed child clips without changing the main edit", async () => {
    const { project, root } = await fixture();
    const registry = new ReviewSessionRegistry();
    const { sessionId } = await registry.register(project.manifestPath);
    const plan = (await registry.load(sessionId)).candidates[0]!.plan;
    const path = join(root, "captions.srt");
    await writeFile(
      path,
      "1\n00:00:01,000 --> 00:00:02,000\nKeep this answer\n",
    );
    const saved = await registry.reviseCandidate(sessionId, "master", {
      ...plan,
      assets: [...plan.assets, { id: "captions", kind: "captions", path }],
      timeline: { ...plan.timeline, captionsAssetId: "captions" },
    });
    const before = await readFile(project.manifestPath, "utf8");
    const { project: child } = await createWorkspaceClip(project.id, {
      title: "Answer",
      start: 1,
      end: 3,
      expectedRevision: 2,
    });
    const clip = await loadReviewSession(child.manifestPath);
    expect(child.parentProjectId).toBe(project.id);
    expect(clip.kind).toBe("clip-review");
    expect(clip.selectedCandidateId).toBeUndefined();
    expect(clip.candidates[0]!.plan.timeline.clips[0]!.sourceStart).toBe(1);
    expect(clip.candidates[0]!.plan.output.path).not.toBe(
      saved.candidates[0]!.plan.output.path,
    );
    const captions = clip.candidates[0]!.plan.assets.find(
      (asset) => asset.kind === "captions",
    )!;
    expect(await readFile(captions.path, "utf8")).toContain(
      "00:00:00,000 --> 00:00:01,000",
    );
    expect(await readFile(project.manifestPath, "utf8")).toBe(before);
    await expect(
      createWorkspaceClip(project.id, {
        title: "Stale",
        start: 1,
        end: 2,
        expectedRevision: 1,
      }),
    ).rejects.toThrow("changed");
  });

  test("a rendered main project gets a separate editable copy", async () => {
    const { project } = await fixture();
    const original = await loadReviewSession(project.manifestPath);
    const output = original.candidates[0]!.plan.output.path;
    await mkdir(join(output, ".."), { recursive: true });
    await writeFile(output, "approved final");
    const duplicate = await duplicateWorkspaceProject(project.id);
    const copy = await loadReviewSession(duplicate.manifestPath);
    expect(copy.candidates[0]!.outputExists).toBe(false);
    expect(copy.candidates[0]!.plan.output.path).not.toBe(output);
    expect(await readFile(output, "utf8")).toBe("approved final");
  });

  test("local imports reject paths outside the media workspace and normalize WebVTT", async () => {
    const { root } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "opencut-outside-"));
    await writeFile(join(outside, "audio.mp3"), "external");
    await expect(
      inspectProjectMedia(join(outside, "audio.mp3")),
    ).rejects.toThrow("outside");
    const path = join(root, "captions.vtt");
    await writeFile(
      path,
      "WEBVTT\n\n00:01.000 --> 00:02.000\nA local caption\n",
    );
    const media = await inspectProjectMedia(path);
    expect(media.path.endsWith(".srt")).toBe(true);
    expect(await readFile(media.path, "utf8")).toContain("00:00:01,000");
  });
});

test("creating a project snapshot excludes concurrent saves from other registered views", async () => {
  const { project } = await fixture();
  const registry = new ReviewSessionRegistry();
  const { sessionId } = await registry.register(project.manifestPath);
  const plan = (await registry.load(sessionId)).candidates[0]!.plan;
  let release!: () => void;
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const locked = registry.withProjectSnapshot(
    project.manifestPath,
    async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    },
  );
  await began;
  try {
    await expect(
      registry.reviseCandidate(sessionId, "master", plan),
    ).rejects.toThrow("being saved");
  } finally {
    release();
    await locked;
  }
});


test("a failed final render never publishes a partial output", async () => {
  const { project } = await fixture();
  const session = await loadReviewSession(project.manifestPath);
  const plan = session.candidates[0]!.plan;
  const broken = { ...plan, timeline: { ...plan.timeline, clips: plan.timeline.clips.map((clip) => ({ ...clip, includeAudio: true })) } };
  await expect(approveAndRenderProject(broken, { renderLimitSeconds: 4 })).rejects.toThrow("ffmpeg");
  expect((await loadReviewSession(project.manifestPath)).candidates[0]!.outputExists).toBe(false);
});
