import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";

import {
  approveAndRenderProject,
  buildWordTimedCaptions,
  capabilities,
  compilePlanFile,
  createReviewExportPackageFromManifest,
  generateReviewCaptions,
  inspectWorkspaceMedia,
  preflightReviewManifest,
  renderPlanPreview,
  savePlan,
  upgradePlan,
  validatePlan,
} from "./service.ts";
import { editPlanSchema } from "./schema.ts";
import { timedTranscriptSchema } from "./captions.ts";

const jsonResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export const buildServer = () => {
  const server = new McpServer(
    { name: "opencut-agent-bridge", version: "0.8.0" },
    {
      instructions:
        "Inspect media before creating an edit plan. Validate, save, and compile the plan before rendering. Rendering only creates a local preview; this server never publishes media.",
    }
  );

  server.registerTool(
    "opencut_capabilities",
    {
      description: "Describe the bridge's current editing and safety capabilities.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => jsonResult(capabilities)
  );

  server.registerTool(
    "opencut_inspect_media",
    {
      description:
        "Inspect a local media file with ffprobe. The path must be inside OPENCUT_AGENT_ROOT.",
      inputSchema: z.object({ path: z.string().min(1) }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ path }) => jsonResult(await inspectWorkspaceMedia(path))
  );

  server.registerTool(
    "opencut_validate_edit_plan",
    {
      description:
        "Validate an OpenCut edit plan and calculate its timeline duration without writing files.",
      inputSchema: z.object({ plan: editPlanSchema }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ plan }) => {
      const validated = validatePlan(plan);
      return jsonResult({ valid: true, durationSeconds: validated.durationSeconds });
    }
  );

  server.registerTool(
    "opencut_upgrade_edit_plan",
    {
      description:
        "Upgrade a validated v1 edit plan to the backward-compatible v2 multi-track contract without writing files.",
      inputSchema: z.object({ plan: editPlanSchema }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ plan }) => jsonResult(upgradePlan(plan))
  );

  server.registerTool(
    "opencut_save_edit_plan",
    {
      description:
        "Validate and atomically save an edit plan inside OPENCUT_AGENT_ROOT. All referenced inputs must already exist.",
      inputSchema: z.object({ path: z.string().min(1), plan: editPlanSchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ path, plan }) => jsonResult(await savePlan(path, plan))
  );

  server.registerTool(
    "opencut_compile_edit_plan",
    {
      description:
        "Compile a saved edit plan into a shell-free ffmpeg argv preview without executing it.",
      inputSchema: z.object({
        planPath: z.string().min(1),
        outputPath: z.string().min(1).optional(),
        durationSeconds: z.number().min(0.1).max(300).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ planPath, outputPath, durationSeconds }) =>
      jsonResult(await compilePlanFile(planPath, outputPath, durationSeconds))
  );

  server.registerTool(
    "opencut_render_preview",
    {
      description:
        "Render a local MP4 preview from a saved edit plan. This never publishes or uploads media.",
      inputSchema: z.object({
        planPath: z.string().min(1),
        outputPath: z.string().min(1).optional(),
        durationSeconds: z.number().min(0.1).max(300).default(30),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ planPath, outputPath, durationSeconds }) =>
      jsonResult(await renderPlanPreview(planPath, outputPath, durationSeconds))
  );

  server.registerTool(
    "opencut_build_word_timed_captions",
    {
      description:
        "Convert provider-independent word timestamps into caption-safe SRT cues inside OPENCUT_AGENT_ROOT.",
      inputSchema: z.object({
        transcript: timedTranscriptSchema,
        outputPath: z.string().min(1),
        maximumCharactersPerLine: z.number().int().min(20).max(80).default(42),
        maximumLines: z.number().int().min(1).max(3).default(2),
        maximumCueSeconds: z.number().min(1).max(10).default(6),
        includeSpeakerLabels: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ transcript, outputPath, maximumCharactersPerLine, maximumLines, maximumCueSeconds, includeSpeakerLabels }) =>
      jsonResult(await buildWordTimedCaptions(transcript, outputPath, {
        maximumCharactersPerLine, maximumLines, maximumCueSeconds, includeSpeakerLabels,
    }))
  );

  server.registerTool(
    "opencut_generate_review_captions",
    {
      description:
        "Generate or confirm captions for a saved review-session candidate. Local Whisper keeps audio on-device. OpenAI/OpenRouter modes require externalUploadApproved=true and upload only the extracted candidate WAV audio.",
      inputSchema: z.object({
        manifestPath: z.string().min(1),
        candidateId: z.string().min(1),
        externalUploadApproved: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ manifestPath, candidateId, externalUploadApproved }) =>
      jsonResult(await generateReviewCaptions(manifestPath, { candidateId, externalUploadApproved }))
  );

  server.registerTool(
    "opencut_preflight_review_session",
    {
      description:
        "Run read-only preflight checks against a saved review-session manifest before preview, final, batch, or export actions.",
      inputSchema: z.object({
        manifestPath: z.string().min(1),
        candidateIds: z.array(z.string().min(1)).min(1).max(20).optional(),
        mode: z.enum(["preview", "final", "batch", "export"]).default("final"),
        renderLimitSeconds: z.number().min(0.1).max(300).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ manifestPath, candidateIds, mode, renderLimitSeconds }) =>
      jsonResult(await preflightReviewManifest(manifestPath, {
        candidateIds,
        mode,
        renderLimitSeconds,
      }))
  );

  server.registerTool(
    "opencut_approve_and_render_project",
    {
      description:
        "Persist an approved OpenCut project record and edit plan, then render its bounded local MP4 output. This never publishes or uploads media.",
      inputSchema: z.object({
        plan: editPlanSchema,
        renderLimitSeconds: z.number().min(0.1).max(300).default(300),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ plan, renderLimitSeconds }) =>
      jsonResult(
        await approveAndRenderProject(plan, {
          renderLimitSeconds,
          approvalSource: "mcp",
        })
      )
  );

  server.registerTool(
    "opencut_create_export_package",
    {
      description:
        "Create a local handoff package for rendered review candidates, including MP4 copies, approved plans, project records, captions, contact sheets, and a manifest. This never uploads or publishes media.",
      inputSchema: z.object({
        manifestPath: z.string().min(1),
        candidateIds: z.array(z.string().min(1)).min(1).max(20).optional(),
        includeContactSheets: z.boolean().default(true),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ manifestPath, candidateIds, includeContactSheets }) =>
      jsonResult(await createReviewExportPackageFromManifest(manifestPath, {
        candidateIds,
        includeContactSheets,
      }))
  );

  return server;
};
