import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveInputPath, resolveOutputPath } from "../src/paths.ts";

const createFixture = async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "opencut-paths-root-")));
  const outside = await realpath(
    await mkdtemp(join(tmpdir(), "opencut-paths-outside-"))
  );
  await mkdir(join(root, "renders"));
  await writeFile(join(root, "source.mp4"), "source");
  await writeFile(join(outside, "outside.mp4"), "outside");
  return { root, outside };
};

describe("workspace paths", () => {
  test("allows inputs and outputs under the configured root", async () => {
    const { root } = await createFixture();
    expect(await resolveInputPath(root, "source.mp4")).toBe(join(root, "source.mp4"));
    expect(await resolveOutputPath(root, "renders/preview.mp4")).toBe(
      join(root, "renders", "preview.mp4")
    );
  });

  test("creates missing nested output directories inside the root", async () => {
    const { root } = await createFixture();
    expect(await resolveOutputPath(root, "candidates/one/renders/output.mp4")).toBe(
      join(root, "candidates", "one", "renders", "output.mp4")
    );
    expect(await realpath(join(root, "candidates", "one", "renders"))).toBe(
      join(root, "candidates", "one", "renders")
    );
  });

  test("rejects parent traversal", async () => {
    const { root } = await createFixture();
    await expect(resolveOutputPath(root, "../preview.mp4")).rejects.toThrow(
      "outside OPENCUT_AGENT_ROOT"
    );
  });

  test("rejects existing output symlinks that escape the root", async () => {
    const { root, outside } = await createFixture();
    await symlink(join(outside, "outside.mp4"), join(root, "renders", "preview.mp4"));
    await expect(resolveOutputPath(root, "renders/preview.mp4")).rejects.toThrow(
      "resolves outside OPENCUT_AGENT_ROOT"
    );
  });
});
