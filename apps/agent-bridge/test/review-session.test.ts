import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createReviewExportPackage } from "../src/export-package.ts";
import { preflightReviewSession } from "../src/preflight.ts";
import { loadReviewSession, ReviewSessionRegistry } from "../src/review-session.ts";

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "opencut-review-session-"));
  await mkdir(join(root, "candidate", "renders"), { recursive: true });
  await writeFile(join(root, "source.mp4"), "video");
  await writeFile(join(root, "candidate", "captions.srt"), "1\n00:00:00,000 --> 00:00:01,000\nHello\n");
  await writeFile(join(root, "candidate", "edit-plan.json"), JSON.stringify({
    version: "2",
    project: { name: "Candidate", width: 1280, height: 720 },
    assets: [
      { id: "source", path: "source.mp4", kind: "video" },
      { id: "captions", path: "candidate/captions.srt", kind: "captions" },
    ],
    timeline: { clips: [{ id: "clip", assetId: "source", sourceStart: 0, sourceEnd: 1 }], captionsAssetId: "captions" },
    output: { path: "candidate/renders/output.mp4" },
  }));
  await writeFile(join(root, "review-session.json"), JSON.stringify({
    version: "1", id: "demo", title: "Demo", updatedAt: new Date().toISOString(),
    sourceAssets: [{ id: "source", label: "Source", path: "source.mp4" }],
    candidates: [{ id: "candidate", title: "Candidate", planPath: "candidate/edit-plan.json", status: "ready-for-review" }],
  }));
  return root;
};

describe("review sessions", () => {
  test("loads isolated candidate plans and persists selection", async () => {
    const root = await fixture();
    process.env.OPENCUT_AGENT_ROOT = root;
    const loaded = await loadReviewSession(join(root, "review-session.json"));
    expect(loaded.candidates[0]?.outputExists).toBe(false);
    expect(loaded.candidates[0]?.strategy).toBe("unspecified");
    expect(loaded.candidates[0]?.rationale).toBe("");
    expect(loaded.candidates[0]?.clipRationales).toEqual([]);
    expect(loaded.renderBatches).toEqual([]);
    expect(loaded.exportPackages).toEqual([]);
    const registry = new ReviewSessionRegistry();
    const registered = await registry.register("review-session.json");
    const selected = await registry.update(registered.sessionId, (session) => ({
      ...session,
      selectedCandidateId: "candidate",
      updatedAt: new Date().toISOString(),
      candidates: session.candidates.map((candidate) => ({ ...candidate, status: "selected" })),
    }));
    expect(selected.selectedCandidateId).toBe("candidate");
  });

  test("persists batch render queue metadata", async () => {
    const root = await fixture();
    process.env.OPENCUT_AGENT_ROOT = root;
    const registry = new ReviewSessionRegistry();
    const registered = await registry.register("review-session.json");
    const queued = await registry.update(registered.sessionId, (session) => ({
      ...session,
      renderBatches: [{
        id: "00000000-0000-4000-8000-000000000000",
        status: "queued",
        requestedAt: new Date().toISOString(),
        items: [{ candidateId: "candidate", revision: 1, status: "queued" }],
      }],
    }));
    expect(queued.renderBatches[0]?.items[0]).toMatchObject({ candidateId: "candidate", status: "queued" });
  });

  test("rejects candidates that render into a shared project directory", async () => {
    const root = await fixture();
    process.env.OPENCUT_AGENT_ROOT = root;
    const planPath = join(root, "candidate", "edit-plan.json");
    const plan = JSON.parse(await Bun.file(planPath).text());
    plan.output.path = "shared/renders/output.mp4";
    await writeFile(planPath, JSON.stringify(plan));
    await expect(loadReviewSession(join(root, "review-session.json"))).rejects.toThrow(
      "must render inside its own candidate directory"
    );
  });

  test("preserves candidate rationale and validates clip rationale references", async () => {
    const root = await fixture();
    process.env.OPENCUT_AGENT_ROOT = root;
    const manifestPath = join(root, "review-session.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.candidates[0].strategy = "distinct-moment";
    manifest.candidates[0].rationale = "This candidate isolates the cleanest explanation.";
    manifest.candidates[0].clipRationales = [{ clipId: "clip", note: "Starts after the speaker's setup and ends before the tangent." }];
    await writeFile(manifestPath, JSON.stringify(manifest));

    const loaded = await loadReviewSession(manifestPath);
    expect(loaded.candidates[0]).toMatchObject({
      strategy: "distinct-moment",
      rationale: "This candidate isolates the cleanest explanation.",
      clipRationales: [{ clipId: "clip", note: "Starts after the speaker's setup and ends before the tangent." }],
    });

    manifest.candidates[0].clipRationales = [{ clipId: "missing", note: "Bad reference." }];
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(loadReviewSession(manifestPath)).rejects.toThrow("rationale references unknown clip missing");
  });

  test("snapshots immutable plan revisions and records reviewer audit events", async () => {
    const root = await fixture();
    process.env.OPENCUT_AGENT_ROOT = root;
    const registry = new ReviewSessionRegistry();
    const registered = await registry.register("review-session.json");
    await registry.update(registered.sessionId, (session) => ({
      ...session,
      selectedCandidateId: "candidate",
      candidates: session.candidates.map((candidate) => ({ ...candidate, status: "selected" })),
    }));
    const currentPlan = JSON.parse(await readFile(join(root, "candidate", "edit-plan.json"), "utf8"));
    currentPlan.timeline.clips[0].sourceEnd = 0.8;
    const revised = await registry.reviseCandidate(
      registered.sessionId,
      "candidate",
      currentPlan,
      "Tighten the ending",
    );
    await registry.addReviewerNote(registered.sessionId, "candidate", "The new ending is cleaner.");

    expect(revised.candidates[0]?.revision).toBe(2);
    expect(revised.candidates[0]?.lastPreviewRevision).toBeUndefined();
    expect(await Bun.file(join(root, "candidate", "revisions", "revision-1.edit-plan.json")).exists()).toBe(true);
    expect(await Bun.file(join(root, "candidate", "revisions", "revision-2.edit-plan.json")).exists()).toBe(true);
    const withNote = await registry.load(registered.sessionId);
    expect(withNote.events.map((event) => event.type)).toContain("plan-revised");
    expect(withNote.reviewerNotes[0]?.text).toBe("The new ending is cleaner.");
  });

  test("generates caption revisions from an approved provider path", async () => {
    const root = await fixture();
    process.env.OPENCUT_AGENT_ROOT = root;
    const registry = new ReviewSessionRegistry();
    const registered = await registry.register("review-session.json");
    await registry.update(registered.sessionId, (session) => ({
      ...session,
      selectedCandidateId: "candidate",
      candidates: session.candidates.map((candidate) => ({
        ...candidate,
        status: "preview-ready",
        lastPreviewRevision: 1,
        previewOutputPath: "candidate/renders/preview-r1.mp4",
      })),
    }));

    const { result, session } = await registry.generateCaptions(registered.sessionId, "candidate");

    expect(result).toMatchObject({
      mode: "provided-captions",
      status: "provided",
      captionsPath: "candidate/captions.srt",
      cues: 1,
    });
    expect(session.candidates[0]?.revision).toBe(2);
    expect(session.candidates[0]?.lastPreviewRevision).toBeUndefined();
    expect(session.candidates[0]?.previewOutputPath).toBeUndefined();
    expect(await Bun.file(join(root, "candidate", "revisions", "revision-1.edit-plan.json")).exists()).toBe(true);
    expect(await Bun.file(join(root, "candidate", "revisions", "revision-2.edit-plan.json")).exists()).toBe(true);
    const revisedPlan = JSON.parse(await readFile(join(root, "candidate", "edit-plan.json"), "utf8"));
    expect(revisedPlan.timeline.subtitleProvider).toMatchObject({
      mode: "provided-captions",
      status: "provided",
    });
    expect(session.events.map((event) => event.type)).toEqual([
      "captions-generation-requested",
      "captions-generated",
    ]);
  });

  test("saves caption QA edits as a new revision and clears stale previews", async () => {
    const root = await fixture();
    process.env.OPENCUT_AGENT_ROOT = root;
    const registry = new ReviewSessionRegistry();
    const registered = await registry.register("review-session.json");
    await registry.update(registered.sessionId, (session) => ({
      ...session,
      selectedCandidateId: "candidate",
      candidates: session.candidates.map((candidate) => ({
        ...candidate,
        status: "preview-ready",
        lastPreviewRevision: 1,
        previewOutputPath: "candidate/renders/preview-r1.mp4",
      })),
    }));

    const { captionsPath, cues, session } = await registry.reviseCaptions(
      registered.sessionId,
      "candidate",
      [{ start: 0, end: 1.25, text: "Corrected caption text" }],
      "Fix caption wording",
    );

    expect(captionsPath).toBe("candidate/captions/candidate-qa-r2.srt");
    expect(cues).toEqual([{ start: 0, end: 1.25, text: "Corrected caption text" }]);
    expect(session.candidates[0]?.revision).toBe(2);
    expect(session.candidates[0]?.lastPreviewRevision).toBeUndefined();
    expect(session.candidates[0]?.previewOutputPath).toBeUndefined();
    expect(await readFile(join(root, captionsPath), "utf8")).toContain("Corrected caption text");
    const revisedPlan = JSON.parse(await readFile(join(root, "candidate", "edit-plan.json"), "utf8"));
    expect(revisedPlan.assets.find((asset: { id: string }) => asset.id === "captions")?.path).toBe(captionsPath);
    expect(revisedPlan.timeline.subtitleProvider).toMatchObject({
      mode: "provided-captions",
      status: "provided",
    });
    expect(session.events.map((event) => event.type)).toContain("captions-revised");
  });

  test("blocks final preflight until the current revision has a preview", async () => {
    const root = await fixture();
    process.env.OPENCUT_AGENT_ROOT = root;
    const registry = new ReviewSessionRegistry();
    const registered = await registry.register("review-session.json");
    const selected = await registry.update(registered.sessionId, (session) => ({
      ...session,
      selectedCandidateId: "candidate",
      candidates: session.candidates.map((candidate) => ({ ...candidate, status: "selected" })),
    }));
    const preflight = await preflightReviewSession(root, selected, {
      candidateIds: ["candidate"],
      mode: "final",
    });
    expect(preflight.summary.block).toBeGreaterThan(0);
    expect(preflight.candidates[0]?.checks.some((check) => check.id === "preview:fresh" && check.severity === "block")).toBe(true);
  });

  test("does not generate captions for candidates with an existing final output", async () => {
    const root = await fixture();
    process.env.OPENCUT_AGENT_ROOT = root;
    await writeFile(join(root, "candidate", "renders", "output.mp4"), "rendered");
    const registry = new ReviewSessionRegistry();
    const registered = await registry.register("review-session.json");

    await expect(registry.generateCaptions(registered.sessionId, "candidate")).rejects.toThrow(
      "Rendered candidates are immutable",
    );
  });

  test("creates an export package for rendered candidates", async () => {
    const root = await fixture();
    process.env.OPENCUT_AGENT_ROOT = root;
    await writeFile(join(root, "candidate", "renders", "output.mp4"), "rendered");
    const workspaceRoot = await realpath(root);
    const loaded = await loadReviewSession(join(root, "review-session.json"));
    const exportPackage = await createReviewExportPackage(workspaceRoot, join(root, "review-session.json"), loaded, {
      candidateIds: ["candidate"],
      includeContactSheets: false,
    });
    expect(exportPackage.candidates[0]?.packagedOutputPath).toMatch(/exports\/.+\/media\/candidate-output\.mp4/);
    expect(await Bun.file(join(root, exportPackage.manifestPath)).exists()).toBe(true);
    expect(await Bun.file(join(root, exportPackage.summaryPath)).exists()).toBe(true);
  });
});
