import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBridgeSetup } from "../scripts/setup-bridge.ts";

describe("OpenCut bridge setup", () => {
  test("generates a private environment file and Codex MCP configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencut-setup-"));
    const result = await createBridgeSetup({ root, serverName: "opencut-test" });
    const [environment, config, manifest] = await Promise.all([
      readFile(result.envPath, "utf8"),
      readFile(result.mcpConfigPath, "utf8"),
      readFile(result.manifestPath, "utf8"),
    ]);

    expect(environment).toContain("OPENCUT_AGENT_ROOT=");
    expect(config).toContain("[mcp_servers.opencut-test]");
    expect(config).toContain(result.bridgeCommand);
    expect(config).toContain(result.workspaceRoot);
    expect(JSON.parse(manifest).mcpConfigPath).toBe(result.mcpConfigPath);
  });

  test("rejects setup output outside the workspace root", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencut-setup-root-"));
    const outside = await mkdtemp(join(tmpdir(), "opencut-setup-outside-"));
    await expect(createBridgeSetup({ root, outputDirectory: outside })).rejects.toThrow(
      "inside OPENCUT_AGENT_ROOT",
    );
  });
});
