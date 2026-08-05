import { runProcess } from "./media.ts";

export type ReadinessStatus = "ready" | "missing" | "not-required";

export type ReadinessCheck = {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
  command?: string;
  requiredEnv?: string;
};

export const commandReadiness = async (
  id: string,
  label: string,
  command: string,
  args: string[] = ["-version"],
): Promise<ReadinessCheck> => {
  try {
    const result = await runProcess(command, args, { maxOutputBytes: 120_000 });
    if (result.exitCode === 0) {
      return {
        id,
        label,
        status: "ready",
        command,
        detail: `${command} is available to the bridge process.`,
      };
    }
    const detail = (result.stderr || result.stdout).trim();
    return {
      id,
      label,
      status: "missing",
      command,
      detail: detail ? `${command} probe failed: ${detail.slice(0, 500)}` : `${command} probe exited with ${result.exitCode}.`,
    };
  } catch (error) {
    return {
      id,
      label,
      status: "missing",
      command,
      detail: error instanceof Error ? error.message : `${command} could not be started.`,
    };
  }
};

export const envReadiness = (
  id: string,
  label: string,
  envName: string,
): ReadinessCheck => ({
  id,
  label,
  status: process.env[envName] ? "ready" : "missing",
  requiredEnv: envName,
  detail: process.env[envName]
    ? `${envName} is configured for the bridge process.`
    : `${envName} is not set in the bridge process.`,
});
