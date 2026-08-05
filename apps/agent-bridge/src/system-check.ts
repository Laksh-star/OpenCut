import { commandReadiness, type ReadinessCheck } from "./readiness.ts";
import type { LoadedReviewSession } from "./review-session.ts";
import { checkSubtitleProviderReadiness, type SubtitleProviderReadiness } from "./subtitle-providers.ts";

export type ReviewSystemCheck = {
  bridge: ReadinessCheck;
  ffmpeg: ReadinessCheck;
  ffprobe: ReadinessCheck;
  subtitleProvider: SubtitleProviderReadiness;
  candidate?: {
    id: string;
    title: string;
    revision: number;
    status: string;
    planPath: string;
    outputExists: boolean;
    previewExists: boolean;
  };
};

export const createReviewSystemCheck = async (
  root: string,
  session: LoadedReviewSession,
  candidateId?: string,
): Promise<ReviewSystemCheck> => {
  const candidate = candidateId
    ? session.candidates.find((entry) => entry.id === candidateId)
    : session.candidates.find((entry) => entry.id === session.selectedCandidateId) ?? session.candidates[0];
  if (candidateId && !candidate) throw new Error("Unknown candidate");

  const [ffmpeg, ffprobe, subtitleProvider] = await Promise.all([
    commandReadiness("ffmpeg", "FFmpeg renderer", "ffmpeg", ["-version"]),
    commandReadiness("ffprobe", "FFprobe media inspector", "ffprobe", ["-version"]),
    candidate
      ? checkSubtitleProviderReadiness(root, candidate.plan)
      : Promise.resolve({
          mode: "local-whisper" as const,
          status: "not-required" as const,
          label: "Subtitle provider",
          detail: "No candidate is selected.",
          requiresExternalUploadApproval: false,
        }),
  ]);

  return {
    bridge: {
      id: "bridge",
      label: "OpenCut agent bridge",
      status: "ready",
      detail: "HTTP/MCP bridge is running and can read this review session.",
    },
    ffmpeg,
    ffprobe,
    subtitleProvider,
    ...(candidate
      ? {
          candidate: {
            id: candidate.id,
            title: candidate.title,
            revision: candidate.revision,
            status: candidate.status,
            planPath: candidate.planPath,
            outputExists: candidate.outputExists,
            previewExists: candidate.previewExists,
          },
        }
      : {}),
  };
};
