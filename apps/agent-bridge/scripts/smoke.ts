import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: new URL("../bin/opencut-agent", import.meta.url).pathname,
  args: [],
  env: {
    ...process.env,
    OPENCUT_AGENT_ROOT: process.env.OPENCUT_AGENT_ROOT ?? process.cwd(),
  },
});

const client = new Client({ name: "opencut-agent-smoke", version: "0.1.0" });
await client.connect(transport);
const tools = await client.listTools();
const capabilityResult = await client.callTool({
  name: "opencut_capabilities",
  arguments: {},
});

if (tools.tools.length !== 6) {
  throw new Error(`Expected 6 tools, received ${tools.tools.length}`);
}

console.log(
  JSON.stringify(
    {
      toolNames: tools.tools.map((tool) => tool.name),
      capabilityResult,
    },
    null,
    2
  )
);
await client.close();
