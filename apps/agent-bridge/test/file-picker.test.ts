import { expect, test } from "bun:test";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseLocalMedia, FilePickerError } from "../src/file-picker.ts";

test("Browse returns an existing local path unchanged, without copying the video", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "opencut-picker-")));
  process.env.OPENCUT_AGENT_ROOT = root;
  const path = join(root, "Speaker's AI video ü.mp4");
  await writeFile(path, "fixture");
  const result = await chooseLocalMedia("video", async (directory, purpose) => {
    expect(directory).toBe(root);
    expect(purpose).toBe("video");
    return path;
  });
  expect(result).toEqual({ cancelled: false, path });
});

test("closing the chooser is a cancellation, and out-of-root files are rejected", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "opencut-picker-")));
  process.env.OPENCUT_AGENT_ROOT = root;
  expect(await chooseLocalMedia("music", async () => null)).toEqual({
    cancelled: true,
    path: null,
  });
  const external = await mkdtemp(join(tmpdir(), "opencut-outside-picker-"));
  const path = join(external, "logo.png");
  await writeFile(path, "fixture");
  await expect(
    chooseLocalMedia("watermark", async () => path),
  ).rejects.toBeInstanceOf(FilePickerError);
});

test("only one native chooser opens at once", async () => {
  let release!: (path: null) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = chooseLocalMedia("video", async () => {
    started();
    return new Promise<null>((resolve) => {
      release = resolve;
    });
  });
  await ready;
  try {
    await expect(
      chooseLocalMedia("captions", async () => null),
    ).rejects.toThrow("already open");
  } finally {
    release(null);
    await pending;
  }
});
