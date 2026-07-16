#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { z } from "zod/v4";

import { approveAndRenderProject, capabilities } from "./service.ts";
import { getWorkspaceRoot, resolveInputPath } from "./paths.ts";
import { editPlanSchema } from "./schema.ts";

const host = "127.0.0.1";
const port = Number(process.env.OPENCUT_AGENT_HTTP_PORT ?? 3210);
const maximumBodyBytes = 2_000_000;
const maximumTextAssetBytes = 1_000_000;
const allowedOrigins = new Set(
  (process.env.OPENCUT_WEB_ORIGINS ??
    "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const approvalRequestSchema = z.object({
  plan: editPlanSchema,
  renderLimitSeconds: z.number().min(0.1).max(300).default(300),
});

let approvalInProgress = false;

const applyCors = (request: IncomingMessage, response: ServerResponse) => {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "content-type");
    response.setHeader("Access-Control-Allow-Private-Network", "true");
  }
};

const sendJson = (
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  value: unknown
) => {
  applyCors(request, response);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(`${JSON.stringify(value)}\n`);
};

const readJsonBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBodyBytes) {
      throw new Error("Request body exceeds the 2 MB limit");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
};

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
  if (origin && !allowedOrigins.has(origin)) {
    sendJson(request, response, 403, { error: "Origin is not allowed" });
    return;
  }

  if (request.method === "OPTIONS") {
    applyCors(request, response);
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/health") {
    sendJson(request, response, 200, {
      ok: true,
      server: capabilities.server,
      version: capabilities.version,
      rendering: approvalInProgress,
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/v1/assets/text") {
    try {
      const requestedPath = requestUrl.searchParams.get("path");
      if (!requestedPath) {
        sendJson(request, response, 400, { error: "A caption asset path is required" });
        return;
      }
      if (!/\.(srt|vtt)$/i.test(requestedPath)) {
        sendJson(request, response, 400, {
          error: "Only SRT and VTT caption assets can be read",
        });
        return;
      }

      const root = await getWorkspaceRoot();
      const path = await resolveInputPath(root, requestedPath);
      const contents = await readFile(path, "utf8");
      if (Buffer.byteLength(contents, "utf8") > maximumTextAssetBytes) {
        sendJson(request, response, 413, { error: "Caption asset exceeds the 1 MB limit" });
        return;
      }
      sendJson(request, response, 200, { path: requestedPath, contents });
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(
        -8_000
      );
      sendJson(request, response, 400, { error: message });
    }
    return;
  }

  if (
    request.method === "POST" &&
    requestUrl.pathname === "/v1/projects/approve-and-render"
  ) {
    if (approvalInProgress) {
      sendJson(request, response, 409, {
        error: "Another approval render is already in progress",
      });
      return;
    }

    approvalInProgress = true;
    try {
      const input = approvalRequestSchema.parse(await readJsonBody(request));
      const result = await approveAndRenderProject(input.plan, {
        renderLimitSeconds: input.renderLimitSeconds,
        approvalSource: "web-review",
      });
      sendJson(request, response, 200, result);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(
        -8_000
      );
      const statusCode = error instanceof SyntaxError || error instanceof z.ZodError ? 400 : 500;
      sendJson(request, response, statusCode, { error: message });
    } finally {
      approvalInProgress = false;
    }
    return;
  }

  sendJson(request, response, 404, { error: "Not found" });
});

server.listen(port, host, () => {
  console.log(`OpenCut local agent bridge listening on http://${host}:${port}`);
});
