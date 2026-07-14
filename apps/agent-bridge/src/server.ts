import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";

import {
  approveAndRenderProject,
  capabilities,
  compilePlanFile,
  inspectWorkspaceMedia,
  renderPlanPreview,
  savePlan,
  validatePlan,
} from "./service.ts";
import { editPlanSchema } from "./schema.ts";

const jsonResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export const buildServer = () => {
  const server = new McpServer(
    { name: "opencut-agent-bridge", version: "0.2.0" },
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

  return server;
};
