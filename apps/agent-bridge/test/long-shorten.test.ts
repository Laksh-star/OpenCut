import { expect, test } from "bun:test";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviewSessionRegistry } from "../src/review-session.ts";
import { createWorkspaceProject } from "../src/workspace-projects.ts";
import { runProcess } from "../src/media.ts";
import { getPlanDuration } from "../src/schema.ts";
import { captionsToSrt } from "../src/captions.ts";

test("a long master shortens to 18 minutes with more than 500 cues; clip limits stay at five minutes", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "opencut-long-shorten-")),
  );
  process.env.OPENCUT_AGENT_ROOT = root;
  const source = join(root, "long.mp4");
  const result = await runProcess("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x240:r=1:d=1200",
    "-c:v",
    "libx264",
    source,
  ]);
  if (result.exitCode) throw new Error(result.stderr);
  const project = await createWorkspaceProject({
    name: "Long master",
    sourcePath: source,
  });
  const registry = new ReviewSessionRegistry();
  const { sessionId } = await registry.register(project.manifestPath);
  const original = (await registry.load(sessionId)).candidates[0]!.plan;
  const path = join(root, "full.srt");
  await writeFile(
    path,
    captionsToSrt(
      Array.from({ length: 600 }, (_, i) => ({
        start: i * 2,
        end: i * 2 + 1.8,
        text: `Passage ${i + 1}`,
      })),
    ),
  );
  await registry.reviseCandidate(sessionId, "master", {
    ...original,
    assets: [...original.assets, { id: "captions", kind: "captions", path }],
    timeline: { ...original.timeline, captionsAssetId: "captions" },
  });
  const proposal = await registry.proposeEdit(sessionId, "master", 2, {
    type: "shorten",
    seconds: 1080,
  });
  expect(proposal.afterSeconds).toBe(1080);
  expect(proposal.captions).toHaveLength(540);
  expect(
    getPlanDuration((await registry.load(sessionId)).candidates[0]!.plan),
  ).toBe(1200);
  const saved = await registry.applyEdit(
    sessionId,
    "master",
    2,
    proposal.proposalId,
  );
  expect(saved.candidates[0]!.revision).toBe(3);
  expect(getPlanDuration(saved.candidates[0]!.plan)).toBe(1080);
  expect(saved.candidates[0]!.previewExists).toBe(false);
  expect(saved.candidates[0]!.outputExists).toBe(false);
  await registry.update(sessionId, (session) => ({
    ...session,
    kind: "clip-review",
  }));
  await expect(
    registry.proposeEdit(sessionId, "master", 3, {
      type: "shorten",
      seconds: 600,
    }),
  ).rejects.toThrow("300");
});
