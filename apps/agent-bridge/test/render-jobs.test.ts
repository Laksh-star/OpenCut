import { expect, test } from "bun:test";
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RenderJobStore } from "../src/render-jobs.ts";
import {
  reportRenderProgress,
  RenderCancelledError,
} from "../src/render-context.ts";
import { runProcess } from "../src/media.ts";

async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "opencut-render-jobs-")),
  );
  process.env.OPENCUT_AGENT_ROOT = root;
  const manifestPath = join(root, "review.json");
  await writeFile(manifestPath, "{}");
  const store = new RenderJobStore();
  const job = await store.create({
    manifestPath,
    candidateId: "master",
    revision: 1,
    mode: "preview",
    totalSeconds: 60,
  });
  return { root, manifestPath, store, job };
}

test("progress is visible and durable; publishing ends at 100 without persisting action tokens", async () => {
  const { root, store, job, manifestPath } = await fixture();
  await store.run(job.id, async () => {
    reportRenderProgress({
      phase: "rendering",
      message: "Encoding",
      renderedSeconds: 30,
      percent: 50,
    });
    expect((await store.list(manifestPath))[0]!.percent).toBe(50);
    reportRenderProgress({
      phase: "publishing",
      message: "Finishing",
      percent: 99,
    });
    await expect(store.cancel(job.id, manifestPath)).rejects.toThrow(
      "finishing",
    );
  });
  const [saved] = await new RenderJobStore().list(manifestPath);
  expect(saved!.status).toBe("completed");
  expect(saved!.percent).toBe(100);
  const scope = (await readdir(join(root, ".opencut-agent/render-jobs")))[0]!;
  const text = await readFile(
    join(root, ".opencut-agent/render-jobs", scope, `${job.id}.json`),
    "utf8",
  );
  expect(text).not.toContain("approvalToken");
});

test("cancel aborts only the scoped active media process and preserves retryable job history", async () => {
  const { store, job, manifestPath } = await fixture();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const run = store.run(job.id, async () => {
    reportRenderProgress({
      phase: "rendering",
      message: "Encoding",
      percent: 5,
    });
    started();
    await runProcess(process.execPath, ["-e", "setTimeout(()=>{},30000)"]);
  });
  const failed = run.then(
    () => null,
    (error: unknown) => error,
  );
  await ready;
  await expect(store.cancel(job.id, manifestPath + ".other")).rejects.toThrow(
    "belongs",
  );
  await store.cancel(job.id, manifestPath);
  expect(await failed).toBeInstanceOf(RenderCancelledError);
  expect((await store.list(manifestPath))[0]!.status).toBe("cancelled");
  expect((await store.list(manifestPath))[0]!.error).toContain(
    "saved edit is unchanged",
  );
});

test("a new server marks an unfinished checkpoint interrupted; unrelated manifests see no job", async () => {
  const { manifestPath } = await fixture();
  const fresh = new RenderJobStore();
  const [job] = await fresh.list(manifestPath);
  expect(job!.status).toBe("interrupted");
  expect(await fresh.list(manifestPath + "-other")).toEqual([]);
});

test("render failures expose a useful message and retain bounded diagnostic details", async () => {
  const { store, job, manifestPath } = await fixture();
  await expect(
    store.run(job.id, async () => {
      throw new Error("ffmpeg: No space left on device");
    }),
  ).rejects.toThrow("No space");
  const [failed] = await store.list(manifestPath);
  expect(failed!.status).toBe("failed");
  expect(failed!.error).toContain("disk space");
  expect(failed!.details).toContain("ffmpeg");
});

test("a project with no render history starts with an empty list", async () => {
  const { root } = await fixture();
  expect(
    await new RenderJobStore().list(join(root, "never-rendered.json")),
  ).toEqual([]);
});
