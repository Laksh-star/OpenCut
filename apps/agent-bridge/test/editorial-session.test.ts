import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ReviewSessionRegistry } from "../src/review-session.ts";

const roots: string[] = [];
const originalRoot = process.env.OPENCUT_AGENT_ROOT;
afterEach(async () => {
  if (originalRoot === undefined) delete process.env.OPENCUT_AGENT_ROOT;
  else process.env.OPENCUT_AGENT_ROOT = originalRoot;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "opencut-editorial-test-"));
  roots.push(root);
  process.env.OPENCUT_AGENT_ROOT = root;
  await mkdir(join(root, "candidate"));
  await writeFile(join(root, "source.mp4"), "fixture");
  await writeFile(join(root, "candidate/captions.srt"), "1\n00:00:00,000 --> 00:00:02,000\nFirst answer\n\n2\n00:00:03,000 --> 00:00:05,000\nSecond answer\n");
  const plan = { version: "2", project: { name: "Fixture", width: 320, height: 240 },
    assets: [{ id: "source", kind: "video", path: "source.mp4" }, { id: "captions", kind: "captions", path: "candidate/captions.srt" }],
    timeline: { clips: [{ id: "clip", assetId: "source", sourceStart: 10, sourceEnd: 15 }], captionsAssetId: "captions" },
    output: { path: "candidate/renders/output.mp4" } };
  await writeFile(join(root, "candidate/edit-plan.json"), JSON.stringify(plan));
  await writeFile(join(root, "review-session.json"), JSON.stringify({ version: "1", id: "fixture", title: "Fixture", updatedAt: new Date().toISOString(),
    sourceAssets: [{ id: "source", label: "Fixture", path: "source.mp4" }],
    candidates: [{ id: "candidate", title: "Fixture", planPath: "candidate/edit-plan.json", status: "preview-ready", lastPreviewRevision: 1,
      clipRationales: [{ clipId: "clip", note: "A complete answer" }] }],
  }));
  const registry = new ReviewSessionRegistry();
  const { sessionId } = await registry.register("review-session.json");
  return { root, registry, sessionId };
}

describe("saved editorial revisions", () => {
  test("proposing is read-only; saving writes retimed captions, snapshots and stale-preview invalidation", async () => {
    const { root, registry, sessionId } = await fixture();
    const before = await readFile(join(root, "candidate/edit-plan.json"), "utf8");
    const proposal = await registry.proposeEdit(sessionId, "candidate", 1, { type: "keep", ranges: [{ start: 3, end: 5 }] });
    expect(await readFile(join(root, "candidate/edit-plan.json"), "utf8")).toBe(before);
    const next = await registry.applyEdit(sessionId, "candidate", 1, proposal.proposalId);
    const candidate = next.candidates[0]!;
    expect(candidate.revision).toBe(2);
    expect(candidate.lastPreviewRevision).toBeUndefined();
    expect(candidate.plan.timeline.clips[0]).toMatchObject({ sourceStart: 13, sourceEnd: 15 });
    const caption = candidate.plan.assets.find((asset) => asset.id === "captions")!;
    expect(await readFile(join(root, caption.path), "utf8")).toContain("00:00:00,000 --> 00:00:02,000\nSecond answer");
    expect(await readFile(join(root, "candidate/captions.srt"), "utf8")).toContain("First answer");
    expect(await Bun.file(join(root, "candidate/revisions/revision-1.edit-plan.json")).exists()).toBe(true);
    expect(next.events.at(-1)?.type).toBe("plan-revised");
  });

  test("an intervening revision rejects a stale proposal", async () => {
    const { registry, sessionId } = await fixture();
    const proposal = await registry.proposeEdit(sessionId, "candidate", 1, { type: "shorten", seconds: 3 });
    const loaded = await registry.load(sessionId);
    await registry.reviseCandidate(sessionId, "candidate", loaded.candidates[0]!.plan, "Other change");
    await expect(registry.applyEdit(sessionId, "candidate", 1, proposal.proposalId)).rejects.toThrow("changed");
    expect((await registry.load(sessionId)).candidates[0]!.revision).toBe(2);
  });

  test("restoring a prior snapshot creates a new revision and restores its captions", async () => {
    const { registry, sessionId } = await fixture();
    const proposal = await registry.proposeEdit(sessionId, "candidate", 1, { type: "shorten", seconds: 2 });
    await registry.applyEdit(sessionId, "candidate", 1, proposal.proposalId);
    const restored = await registry.undoEdit(sessionId, "candidate", 2);
    expect(restored.candidates[0]!.revision).toBe(3);
    expect(restored.candidates[0]!.plan.timeline.clips[0]!.sourceEnd).toBe(15);
    expect(restored.candidates[0]!.plan.assets.find((asset) => asset.id === "captions")!.path).toBe("candidate/captions.srt");
    expect(restored.candidates[0]!.lastPreviewRevision).toBeUndefined();
  });

  test("concurrent saves of the same proposal produce only one revision", async () => {
    const { registry, sessionId } = await fixture();
    const proposal = await registry.proposeEdit(sessionId, "candidate", 1, { type: "shorten", seconds: 2 });
    const result = await Promise.allSettled([
      registry.applyEdit(sessionId, "candidate", 1, proposal.proposalId), registry.applyEdit(sessionId, "candidate", 1, proposal.proposalId),
    ]);
    expect(result.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect((await registry.load(sessionId)).candidates[0]!.revision).toBe(2);
  });

  test("two registered views of the same manifest share the save lock", async () => {
    const { registry, sessionId } = await fixture();
    const second = await registry.register("review-session.json");
    const firstProposal = await registry.proposeEdit(sessionId, "candidate", 1, { type: "shorten", seconds: 2 });
    const secondProposal = await registry.proposeEdit(second.sessionId, "candidate", 1, { type: "shorten", seconds: 3 });
    const results = await Promise.allSettled([
      registry.applyEdit(sessionId, "candidate", 1, firstProposal.proposalId),
      registry.applyEdit(second.sessionId, "candidate", 1, secondProposal.proposalId),
    ]);
    expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect((await registry.load(sessionId)).candidates[0]!.revision).toBe(2);
  });

  test("concurrent reviewer notes from two views are both preserved", async () => {
    const { registry, sessionId } = await fixture();
    const second = await registry.register("review-session.json");
    await Promise.all([
      registry.addReviewerNote(sessionId, "candidate", "Keep the context"),
      registry.addReviewerNote(second.sessionId, "candidate", "Keep the ending"),
    ]);
    const session = await registry.load(sessionId);
    expect(session.reviewerNotes.map((note) => note.text).sort()).toEqual(["Keep the context", "Keep the ending"]);
    expect(session.events.filter((event) => event.type === "reviewer-note-added")).toHaveLength(2);
  });

  test("existing final output blocks edits even when the manifest status is stale", async () => {
    const { root, registry, sessionId } = await fixture();
    const proposal = await registry.proposeEdit(sessionId, "candidate", 1, { type: "shorten", seconds: 2 });
    await mkdir(join(root, "candidate/renders"));
    await writeFile(join(root, "candidate/renders/output.mp4"), "final");
    await expect(registry.applyEdit(sessionId, "candidate", 1, proposal.proposalId)).rejects.toThrow("locked");
    await expect(registry.undoEdit(sessionId, "candidate", 1)).rejects.toThrow();
  });
});
