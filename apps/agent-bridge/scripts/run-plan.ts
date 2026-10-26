import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [draftPath, savedPlanPath, limit = "60"] = process.argv.slice(2);
if (!draftPath || !savedPlanPath || draftPath === "--help") {
  console.log("Usage: opencut-plan <draft-plan.json> <workspace-relative-plan.json> [compile-seconds]\nValidates, saves, and compiles a plan. Rendering remains a separate visible review action.");
  process.exit(draftPath === "--help" ? 0 : 1);
}
const durationSeconds = Number(limit);
if (!Number.isFinite(durationSeconds) || durationSeconds < 0.1 || durationSeconds > 300) throw new Error("Compile duration must be between 0.1 and 300 seconds.");
const plan = JSON.parse(await readFile(draftPath, "utf8"));
const transport = new StdioClientTransport({
  command: new URL("../bin/opencut-agent", import.meta.url).pathname,
  env: { ...process.env, OPENCUT_AGENT_ROOT: process.env.OPENCUT_AGENT_ROOT ?? process.cwd() },
});
const client = new Client({ name: "opencut-plan-runner", version: "0.10.0" });
await client.connect(transport);
try {
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(JSON.stringify(result.content));
    if (!Array.isArray(result.content)) throw new Error("The bridge returned an invalid tool response.");
    const block = result.content.find((item: { type?: string; text?: string }) => item.type === "text");
    return typeof block?.text === "string" ? JSON.parse(block.text) : result;
  };
  const validation = await call("opencut_validate_edit_plan", { plan });
  const saved = await call("opencut_save_edit_plan", { path: savedPlanPath, plan });
  const compiled = await call("opencut_compile_edit_plan", { planPath: savedPlanPath, durationSeconds });
  console.log(JSON.stringify({ validation, saved, compiled, next: "Open the saved review session and use Render preview after inspecting the plan." }, null, 2));
} finally { await client.close(); }
