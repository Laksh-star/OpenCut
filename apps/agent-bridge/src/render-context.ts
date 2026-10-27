import { AsyncLocalStorage } from "node:async_hooks";

export type RenderPhase = "preparing" | "rendering" | "publishing";
export type RenderProgress = {
  phase: RenderPhase;
  message: string;
  renderedSeconds?: number;
  totalSeconds?: number;
  percent?: number | null;
};
type Context = {
  signal: AbortSignal;
  report: (progress: RenderProgress) => void;
};
const storage = new AsyncLocalStorage<Context>();
export class RenderCancelledError extends Error {
  constructor() {
    super("Render cancelled. Your saved edit is unchanged.");
    this.name = "RenderCancelledError";
  }
}
export const renderSignal = () => storage.getStore()?.signal;
export function checkRenderCancellation() {
  if (renderSignal()?.aborted) throw new RenderCancelledError();
}
export function reportRenderProgress(progress: RenderProgress) {
  checkRenderCancellation();
  storage.getStore()?.report(progress);
}
export const withRenderContext = <T>(
  context: Context,
  action: () => Promise<T>,
) => storage.run(context, action);

export function renderErrorMessage(error: unknown) {
  if (error instanceof RenderCancelledError) return error.message;
  const details = error instanceof Error ? error.message : String(error);
  if (/No space left|ENOSPC/i.test(details))
    return "There is not enough disk space to finish. Free space in the media folder and retry.";
  if (/ENOENT|No such file|cannot find/i.test(details))
    return "A required file or local tool is missing. Check the source paths and FFmpeg setup, then retry.";
  if (/Permission denied|EACCES/i.test(details))
    return "The renderer cannot read or write a required file. Check the media folder's permissions.";
  if (/matches no streams|does not contain any stream/i.test(details))
    return "A selected media track is unavailable. Check audio/video settings for the imported file.";
  return "This render could not finish. Your saved edit is unchanged. Check the details, adjust the edit if needed, and retry.";
}
