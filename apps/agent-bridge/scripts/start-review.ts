import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";

const studio = process.argv[2] === "--studio";
const manifestArgument = studio ? undefined : process.argv[2];
if (!studio && !manifestArgument) throw new Error("Usage: opencut-review <review-session.json>");
const root = resolve(process.env.OPENCUT_AGENT_ROOT ?? process.cwd());
const manifestPath = manifestArgument ? relative(root, resolve(manifestArgument)) : undefined;
if (manifestPath && (manifestPath === ".." || manifestPath.startsWith(`..${sep}`) || isAbsolute(manifestPath))) {
  throw new Error("Review manifest must be inside OPENCUT_AGENT_ROOT");
}
const bridgePort = Number(process.env.OPENCUT_AGENT_HTTP_PORT ?? 3210);
const webPort = Number(process.env.OPENCUT_WEB_PORT ?? 5173);
const bridgeUrl = `http://127.0.0.1:${bridgePort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;
const packageRoot = new URL("..", import.meta.url).pathname;
const repositoryRoot = resolve(packageRoot, "../..");

const assertPortAvailable = (port: number) => new Promise<void>((resolve, reject) => {
  const probe = createServer();
  probe.once("error", () => reject(new Error(`Port ${port} is already in use. Use the open workspace or stop it before launching another.`)));
  probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()));
});
await assertPortAvailable(bridgePort);
await assertPortAvailable(webPort);

const bridge = spawn(new URL("../bin/opencut-agent-http", import.meta.url).pathname, [], {
  env: {
    ...process.env,
    OPENCUT_AGENT_ROOT: root,
    OPENCUT_AGENT_HTTP_PORT: String(bridgePort),
    OPENCUT_WEB_ORIGINS: process.env.OPENCUT_WEB_ORIGINS ?? `${webOrigin},http://localhost:${webPort}`,
  },
  stdio: "inherit",
});
const web = spawn(resolve(repositoryRoot, "apps/web/node_modules/.bin/vite"), ["dev", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], {
  cwd: resolve(repositoryRoot, "apps/web"),
  env: { ...process.env, VITE_OPENCUT_BRIDGE_URL: bridgeUrl, WRANGLER_LOG_PATH: ".wrangler/wrangler.log" }, stdio: "inherit",
});
let stopping = false;
const stop = () => { stopping = true; bridge.kill("SIGTERM"); web.kill("SIGTERM"); };
for (const child of [bridge, web]) child.once("exit", () => { if (!stopping) { console.error("A local service stopped; shutting down the workspace."); stop(); process.exit(1); } });
process.on("SIGINT", () => { stop(); process.exit(0); });
process.on("SIGTERM", () => { stop(); process.exit(0); });

const waitForUrl = async (url: string, label: string) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    if (bridge.exitCode !== null || web.exitCode !== null) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  stop();
  throw new Error(`${label} did not become ready`);
};
await waitForUrl(`${bridgeUrl}/health`, "OpenCut bridge");
await waitForUrl(`${webOrigin}/`, "OpenCut web app");
let url = webOrigin;
if (!studio) {
const response = await fetch(`${bridgeUrl}/v1/review-sessions`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ manifestPath }),
});
if (!response.ok) { stop(); throw new Error(await response.text()); }
const registration = await response.json() as { sessionId: string };
url = `${webOrigin}/?session=${encodeURIComponent(registration.sessionId)}`;
}
console.log(`\nOpenCut ${studio ? "workspace" : "review session"}: ${url}\nPress Ctrl+C to stop both local services.\n`);
if (process.env.OPENCUT_REVIEW_OPEN === "1" && process.platform === "darwin") spawn("open", [url], { stdio: "ignore" });
await new Promise(() => {});
