import { spawn } from "node:child_process";

export type ProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export const runProcess = (
  command: string,
  args: string[],
  options: { maxOutputBytes?: number } = {}
) =>
  new Promise<ProcessResult>((resolvePromise, rejectPromise) => {
    const maxOutputBytes = options.maxOutputBytes ?? 2_000_000;
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-maxOutputBytes);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-maxOutputBytes);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
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
