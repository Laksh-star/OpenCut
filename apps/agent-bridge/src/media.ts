import { renderSignal, RenderCancelledError } from "./render-context.ts";
import { spawn, type ChildProcess } from "node:child_process";

const activeProcesses = new Set<ChildProcess>();
export const stopMediaProcesses = () => { for (const child of activeProcesses) child.kill("SIGTERM"); };

export type ProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export const runProcess = (
  command: string,
  args: string[],
  options: { maxOutputBytes?: number; timeoutMs?: number; signal?: AbortSignal; onStdout?: (chunk: string) => void } = {}
) =>
  new Promise<ProcessResult>((resolvePromise, rejectPromise) => {
    const signal = options.signal ?? renderSignal();
    if (signal?.aborted) { rejectPromise(new RenderCancelledError()); return; }
    const maxOutputBytes = options.maxOutputBytes ?? 2_000_000;
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    activeProcesses.add(child);
    child.once("close", () => activeProcesses.delete(child));
    child.once("error", () => activeProcesses.delete(child));
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => { child.kill("SIGTERM"); killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000); killTimer.unref(); };
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const cleanup = () => { signal?.removeEventListener("abort", cancel); clearTimeout(killTimer); };
    const timeout = options.timeoutMs ? setTimeout(() => {
      child.kill("SIGKILL");
      rejectPromise(new Error(`${command} exceeded the analysis time limit`));
    }, options.timeoutMs) : undefined;
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-maxOutputBytes);
      if (!signal?.aborted) {
        try { options.onStdout?.(chunk); } catch (error) { child.kill("SIGTERM"); rejectPromise(error); }
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-maxOutputBytes);
    });
    child.on("error", (error) => { clearTimeout(timeout); cleanup(); rejectPromise(error); });
    child.on("close", (code) => {
      clearTimeout(timeout); cleanup();
      if (signal?.aborted) { rejectPromise(new RenderCancelledError()); return; }
      resolvePromise({ exitCode: code ?? -1, stdout, stderr });
    });
  });

export const inspectMedia = async (path: string) => {
  const result = await runProcess("ffprobe", [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    path,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`ffprobe failed: ${result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout) as unknown;
};
