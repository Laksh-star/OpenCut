import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadReviewSession, ReviewSessionRegistry } from "../src/review-session.ts";

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "opencut-review-session-"));
  await mkdir(join(root, "candidate", "renders"), { recursive: true });
  await writeFile(join(root, "source.mp4"), "video");
  await writeFile(join(root, "candidate", "captions.srt"), "1\n00:00:00,000 --> 00:00:01,000\nHello\n");
  await writeFile(join(root, "candidate", "edit-plan.json"), JSON.stringify({
    version: "1",
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
});
