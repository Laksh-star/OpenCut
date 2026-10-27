import { existsSync } from "node:fs";
import { getWorkspaceRoot, resolveInputPath } from "./paths.ts";
import { runProcess } from "./media.ts";

export type PickerPurpose = "video" | "watermark" | "music" | "captions";
export class FilePickerError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const nativeFilePickerAvailable = () =>
  process.platform === "darwin" && existsSync("/usr/bin/osascript");
export const pickerScript = `on run argv
  try
    set pickedFile to choose file with prompt (item 2 of argv) default location (POSIX file (item 1 of argv))
    return POSIX path of pickedFile
  on error number -128
    return ""
  end try
end run`;
async function nativeDialog(root: string, purpose: PickerPurpose) {
  if (!nativeFilePickerAvailable())
    throw new FilePickerError(
      "Native Browse is available on macOS. You can still paste a local file path on this platform.",
      501,
    );
  const prompts = {
    video: "Choose a video for OpenCut",
    watermark: "Choose a watermark image or overlay video",
    music: "Choose background audio for OpenCut",
    captions: "Choose an SRT or VTT caption file",
  };
  // Arguments carry paths; no user-provided value is interpolated as AppleScript.
  const result = await runProcess(
    "/usr/bin/osascript",
    ["-e", pickerScript, root, prompts[purpose]],
    { timeoutMs: 300_000 },
  );
  if (result.exitCode !== 0)
    throw new FilePickerError(
      "The file chooser could not open. You can paste the path instead. Check that OpenCut is running in your Mac's interactive session.",
      500,
    );
  return result.stdout.replace(/\r?\n$/, "") || null;
}
let picking = false;
export async function chooseLocalMedia(
  purpose: PickerPurpose,
  dialog: (
    root: string,
    purpose: PickerPurpose,
  ) => Promise<string | null> = nativeDialog,
) {
  if (picking)
    throw new FilePickerError(
      "A file chooser is already open. Finish or cancel it first.",
      409,
    );
  picking = true;
  try {
    const root = await getWorkspaceRoot();
    const selected = await dialog(root, purpose);
    if (!selected) return { cancelled: true, path: null };
    try {
      return { cancelled: false, path: await resolveInputPath(root, selected) };
    } catch {
      throw new FilePickerError(
        `Choose a file inside the media folder (${root}). Browse does not copy files from outside that folder.`,
      );
    }
  } finally {
    picking = false;
  }
}
