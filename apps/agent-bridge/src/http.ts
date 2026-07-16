#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname } from "node:path";

import { z } from "zod/v4";

import { getWorkspaceRoot, resolveInputPath } from "./paths.ts";
import { parseByteRange } from "./range.ts";
import { ReviewSessionRegistry } from "./review-session.ts";
import { approveAndRenderProject, capabilities } from "./service.ts";
import { editPlanSchema } from "./schema.ts";

const host = "127.0.0.1";
const port = Number(process.env.OPENCUT_AGENT_HTTP_PORT ?? 3210);
const maximumBodyBytes = 2_000_000;
const maximumTextAssetBytes = 1_000_000;
const registry = new ReviewSessionRegistry();
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
const registerSessionSchema = z.object({ manifestPath: z.string().min(1) });
const selectCandidateSchema = z.object({ candidateId: z.string().min(1) });
const approveSessionCandidateSchema = z.object({
  candidateId: z.string().min(1),
  approvalToken: z.string().uuid(),
  renderLimitSeconds: z.number().min(0.1).max(300).default(300),
});

let approvalInProgress = false;

const applyCors = (request: IncomingMessage, response: ServerResponse) => {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "content-type,range");
    response.setHeader("Access-Control-Expose-Headers", "accept-ranges,content-range,content-length");
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
    if (size > maximumBodyBytes) throw new Error("Request body exceeds the 2 MB limit");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
};

const mediaType = (path: string) => {
  switch (extname(path).toLowerCase()) {
    case ".mp4": return "video/mp4";
    case ".mov": return "video/quicktime";
    case ".webm": return "video/webm";
    case ".m4v": return "video/x-m4v";
    default: return "application/octet-stream";
  }
};

const streamMedia = async (
  request: IncomingMessage,
  response: ServerResponse,
  requestedPath: string
) => {
  const root = await getWorkspaceRoot();
  const path = await resolveInputPath(root, requestedPath);
  const file = await stat(path);
  let range;
  try {
    range = parseByteRange(request.headers.range, file.size);
  } catch (error) {
    applyCors(request, response);
    response.writeHead(416, { "Content-Range": `bytes */${file.size}` });
    response.end();
    return;
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? file.size - 1;
  const headers: Record<string, string | number> = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Length": end - start + 1,
    "Content-Type": mediaType(path),
    "X-Content-Type-Options": "nosniff",
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${file.size}`;
  applyCors(request, response);
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(path, { start, end }).pipe(response);
};

const match = (pathname: string, expression: RegExp) => pathname.match(expression)?.slice(1).map(decodeURIComponent);

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

  try {
    if (request.method === "GET" && requestUrl.pathname === "/health") {
      sendJson(request, response, 200, { ok: true, server: capabilities.server, version: capabilities.version, rendering: approvalInProgress });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/v1/assets/text") {
      const requestedPath = requestUrl.searchParams.get("path");
      if (!requestedPath) throw new Error("A caption asset path is required");
      if (!/\.(srt|vtt)$/i.test(requestedPath)) throw new Error("Only SRT and VTT caption assets can be read");
      const root = await getWorkspaceRoot();
      const path = await resolveInputPath(root, requestedPath);
      const contents = await readFile(path, "utf8");
      if (Buffer.byteLength(contents, "utf8") > maximumTextAssetBytes) {
        sendJson(request, response, 413, { error: "Caption asset exceeds the 1 MB limit" });
        return;
      }
      sendJson(request, response, 200, { path: requestedPath, contents });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/v1/review-sessions") {
      const input = registerSessionSchema.parse(await readJsonBody(request));
      const registered = await registry.register(input.manifestPath);
      sendJson(request, response, 201, registered);
      return;
    }

    const sessionRoute = match(requestUrl.pathname, /^\/v1\/review-sessions\/([^/]+)$/);
    if (request.method === "GET" && sessionRoute) {
      sendJson(request, response, 200, await registry.load(sessionRoute[0]!));
      return;
    }

    const selectRoute = match(requestUrl.pathname, /^\/v1\/review-sessions\/([^/]+)\/select$/);
    if (request.method === "POST" && selectRoute) {
      const input = selectCandidateSchema.parse(await readJsonBody(request));
      const loaded = await registry.load(selectRoute[0]!);
      if (!loaded.candidates.some((candidate) => candidate.id === input.candidateId)) throw new Error("Unknown candidate");
      const updated = await registry.update(selectRoute[0]!, (session) => ({
        ...session,
        selectedCandidateId: input.candidateId,
        updatedAt: new Date().toISOString(),
        candidates: session.candidates.map((candidate) => ({
          ...candidate,
          status: candidate.id === input.candidateId && candidate.status !== "rendered" ? "selected" : candidate.status === "selected" ? "ready-for-review" : candidate.status,
        })),
      }));
      sendJson(request, response, 200, updated);
      return;
    }

    const mediaRoute = match(requestUrl.pathname, /^\/v1\/review-sessions\/([^/]+)\/media\/([^/]+)$/);
    if ((request.method === "GET" || request.method === "HEAD") && mediaRoute) {
      const session = await registry.load(mediaRoute[0]!);
      const asset = session.sourceAssets.find((candidate) => candidate.id === mediaRoute[1]);
      if (!asset) throw new Error("Media asset is not authorized for this review session");
      await streamMedia(request, response, asset.path);
      return;
    }

    const captionsRoute = match(requestUrl.pathname, /^\/v1\/review-sessions\/([^/]+)\/candidates\/([^/]+)\/captions$/);
    if (request.method === "GET" && captionsRoute) {
      const session = await registry.load(captionsRoute[0]!);
      const candidate = session.candidates.find((entry) => entry.id === captionsRoute[1]);
      if (!candidate) throw new Error("Unknown review candidate");
      const captionsAsset = candidate.plan.assets.find(
        (asset) => asset.id === candidate.plan.timeline.captionsAssetId,
      );
      if (!captionsAsset || !/\.(srt|vtt)$/i.test(captionsAsset.path)) {
        throw new Error("This review candidate does not have an authorized caption asset");
      }
      const root = await getWorkspaceRoot();
      const path = await resolveInputPath(root, captionsAsset.path);
      const contents = await readFile(path, "utf8");
      if (Buffer.byteLength(contents, "utf8") > maximumTextAssetBytes) {
        sendJson(request, response, 413, { error: "Caption asset exceeds the 1 MB limit" });
        return;
      }
      sendJson(request, response, 200, { path: captionsAsset.path, contents });
      return;
    }

    const approveRoute = match(requestUrl.pathname, /^\/v1\/review-sessions\/([^/]+)\/approve-and-render$/);
    if (request.method === "POST" && approveRoute) {
      if (approvalInProgress) {
        sendJson(request, response, 409, { error: "Another approval render is already in progress" });
        return;
      }
      const input = approveSessionCandidateSchema.parse(await readJsonBody(request));
      const registered = registry.get(approveRoute[0]!);
      if (registered.approvalToken !== input.approvalToken) {
        sendJson(request, response, 403, { error: "Invalid review approval token" });
        return;
      }
      const loaded = await registry.load(approveRoute[0]!);
      if (loaded.selectedCandidateId !== input.candidateId) throw new Error("Candidate must be selected in the review session before approval");
      const candidate = loaded.candidates.find((entry) => entry.id === input.candidateId);
      if (!candidate) throw new Error("Unknown candidate");
      if (candidate.outputExists || candidate.status === "rendered") throw new Error("Candidate is already rendered");
      approvalInProgress = true;
      await registry.update(approveRoute[0]!, (session) => ({ ...session, updatedAt: new Date().toISOString(), candidates: session.candidates.map((entry) => entry.id === input.candidateId ? { ...entry, status: "rendering", error: undefined } : entry) }));
      try {
        const result = await approveAndRenderProject(candidate.plan, { renderLimitSeconds: input.renderLimitSeconds, approvalSource: "web-review" });
        const updated = await registry.update(approveRoute[0]!, (session) => ({ ...session, updatedAt: new Date().toISOString(), candidates: session.candidates.map((entry) => entry.id === input.candidateId ? { ...entry, status: "rendered", error: undefined } : entry) }));
        sendJson(request, response, 200, { ...result, session: updated });
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(-8_000);
        await registry.update(approveRoute[0]!, (session) => ({ ...session, updatedAt: new Date().toISOString(), candidates: session.candidates.map((entry) => entry.id === input.candidateId ? { ...entry, status: "failed", error: message } : entry) }));
        throw error;
      } finally {
        approvalInProgress = false;
      }
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/v1/projects/approve-and-render") {
      if (approvalInProgress) {
        sendJson(request, response, 409, { error: "Another approval render is already in progress" });
        return;
      }
      approvalInProgress = true;
      try {
        const input = approvalRequestSchema.parse(await readJsonBody(request));
        sendJson(request, response, 200, await approveAndRenderProject(input.plan, { renderLimitSeconds: input.renderLimitSeconds, approvalSource: "web-review" }));
      } finally {
        approvalInProgress = false;
      }
      return;
    }

    sendJson(request, response, 404, { error: "Not found" });
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(-8_000);
    const statusCode = error instanceof SyntaxError || error instanceof z.ZodError ? 400 : 500;
    sendJson(request, response, statusCode, { error: message });
  }
});

server.listen(port, host, () => {
  console.log(`OpenCut local agent bridge listening on http://${host}:${port}`);
});
