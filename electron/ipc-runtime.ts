import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { extname, resolve, sep } from "path";

import {
  applySampleMoveToManifest,
  resolveMixUrl,
  validateSampleMovePaths,
  type SampleMetadataManifest,
  type SampleMoveRequest,
} from "../scripts/dev-server/index.js";
import {
  createPathConfigStore,
  formatPathValidationSummary,
  type PathConfigSnapshot,
  type PathConfigStore,
} from "../scripts/path-config.js";
import type { DesktopBridgeRequest, DesktopBridgeResponse } from "./preload.js";

const CATEGORY_CONFIG_FILENAME = "categories.json";

type LogLevel = "info" | "warn" | "error";

type RuntimeLogger = (level: LogLevel, message: string) => void;

interface ParsedMoveRequest {
  filename: string;
  oldCategory: string;
  oldSubcategory: string | null;
  newCategory: string;
  newSubcategory: string | null;
}

export interface DesktopBridgeContext {
  appRoot: string;
  configRoot: string;
  logger?: RuntimeLogger;
}

export interface DesktopBridgeHandler {
  handleRequest(request: DesktopBridgeRequest): Promise<DesktopBridgeResponse>;
}

function defaultLogger(level: LogLevel, message: string): void {
  if (level === "info") {
    console.info(message);
    return;
  }
  if (level === "warn") {
    console.warn(message);
    return;
  }
  console.error(message);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function readBodyText(body: ArrayBuffer | undefined): string {
  if (!body || body.byteLength === 0) return "";
  return Buffer.from(body).toString("utf-8");
}

function parsePathSegments(pathname: string, routePrefix: string): string[] | null {
  if (!pathname.startsWith(routePrefix)) return null;

  const rawPath = pathname.slice(routePrefix.length);
  const rawSegments = rawPath.split("/");
  if (rawSegments.length === 0) return null;

  const segments: string[] = [];
  for (const rawSegment of rawSegments) {
    if (rawSegment.length === 0) return null;

    let decoded: string;
    try {
      decoded = decodeURIComponent(rawSegment);
    } catch {
      return null;
    }

    if (
      decoded.length === 0 ||
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\")
    ) {
      return null;
    }

    segments.push(decoded);
  }

  return segments;
}

function contentTypeFor(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".map") return "application/json; charset=utf-8";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function ensureContainedPath(root: string, absolutePath: string): boolean {
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  return absolutePath === root || absolutePath.startsWith(rootWithSep);
}

function textResponse(status: number, text: string): DesktopBridgeResponse {
  return {
    status,
    headers: [["content-type", "text/plain; charset=utf-8"]],
    body: toArrayBuffer(Buffer.from(text, "utf-8")),
  };
}

function jsonResponse(status: number, payload: unknown): DesktopBridgeResponse {
  return {
    status,
    headers: [["content-type", "application/json; charset=utf-8"]],
    body: toArrayBuffer(Buffer.from(JSON.stringify(payload), "utf-8")),
  };
}

function emptyResponse(status: number): DesktopBridgeResponse {
  return {
    status,
    headers: [],
    body: undefined,
  };
}

function fileResponse(method: string, absolutePath: string): DesktopBridgeResponse {
  if (!existsSync(absolutePath)) {
    return textResponse(404, "Not found");
  }

  let isFile = false;
  try {
    isFile = lstatSync(absolutePath).isFile();
  } catch {
    isFile = false;
  }

  if (!isFile) {
    return textResponse(404, "Not found");
  }

  if (method === "HEAD") {
    return {
      status: 200,
      headers: [["content-type", contentTypeFor(absolutePath)]],
      body: undefined,
    };
  }

  const data = readFileSync(absolutePath);
  return {
    status: 200,
    headers: [["content-type", contentTypeFor(absolutePath)]],
    body: toArrayBuffer(data),
  };
}

function parseMoveRequest(payload: unknown): ParsedMoveRequest | null {
  if (typeof payload !== "object" || payload === null) return null;

  const parsed = payload as Record<string, unknown>;
  if (
    typeof parsed.filename !== "string" ||
    typeof parsed.oldCategory !== "string" ||
    typeof parsed.newCategory !== "string"
  ) {
    return null;
  }

  return {
    filename: parsed.filename,
    oldCategory: parsed.oldCategory,
    oldSubcategory: typeof parsed.oldSubcategory === "string" ? parsed.oldSubcategory : null,
    newCategory: parsed.newCategory,
    newSubcategory: typeof parsed.newSubcategory === "string" ? parsed.newSubcategory : null,
  };
}

function moveSample(
  parsedMove: ParsedMoveRequest,
  store: PathConfigStore,
  logger: RuntimeLogger,
): DesktopBridgeResponse {
  const activeOutputRoot = store.getSnapshot().config.outputRoot;
  const safeFilename = parsedMove.filename.trim();
  const validationError = validateSampleMovePaths(
    activeOutputRoot,
    safeFilename,
    parsedMove.oldCategory,
    parsedMove.oldSubcategory,
    parsedMove.newCategory,
    parsedMove.newSubcategory,
  );

  if (validationError !== null) {
    return textResponse(400, validationError);
  }

  const oldParts = [
    activeOutputRoot,
    parsedMove.oldCategory,
    ...(parsedMove.oldSubcategory ? [parsedMove.oldSubcategory] : []),
    safeFilename,
  ];
  const newParts = [
    activeOutputRoot,
    parsedMove.newCategory,
    ...(parsedMove.newSubcategory ? [parsedMove.newSubcategory] : []),
    safeFilename,
  ];
  const oldWav = resolve(...(oldParts as [string, ...string[]]));
  const newWav = resolve(...(newParts as [string, ...string[]]));
  const newDir = resolve(
    activeOutputRoot,
    parsedMove.newCategory,
    ...(parsedMove.newSubcategory ? [parsedMove.newSubcategory] : []),
  );
  const isSamePath = oldWav === newWav;

  const metaPath = resolve(activeOutputRoot, "metadata.json");

  let manifest: SampleMetadataManifest;
  try {
    manifest = JSON.parse(readFileSync(metaPath, "utf-8")) as SampleMetadataManifest;
  } catch (error) {
    logger("warn", `[ipc-runtime] Failed to read ${metaPath}: ${String(error)}`);
    return textResponse(500, "Internal error");
  }

  const manifestUpdated = applySampleMoveToManifest(manifest, {
    filename: safeFilename,
    oldCategory: parsedMove.oldCategory,
    oldSubcategory: parsedMove.oldSubcategory,
    newCategory: parsedMove.newCategory,
    newSubcategory: parsedMove.newSubcategory,
  } satisfies SampleMoveRequest);

  if (!manifestUpdated) {
    const sourceLabel = parsedMove.oldSubcategory
      ? `${parsedMove.oldCategory}/${parsedMove.oldSubcategory}`
      : parsedMove.oldCategory;
    return textResponse(404, `Sample not found in metadata: ${safeFilename} in ${sourceLabel}`);
  }

  if (!isSamePath && existsSync(newWav)) {
    return textResponse(409, "Destination file already exists");
  }

  let movedWav = false;
  if (!isSamePath && existsSync(oldWav)) {
    mkdirSync(newDir, { recursive: true });
    renameSync(oldWav, newWav);
    movedWav = true;
  } else if (!isSamePath) {
    logger("warn", `[ipc-runtime] WAV not found at ${oldWav}; metadata will still be updated`);
  }

  try {
    writeFileSync(metaPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  } catch (error) {
    if (movedWav) {
      try {
        renameSync(newWav, oldWav);
      } catch (rollbackError) {
        logger("warn", `[ipc-runtime] Rollback failed: ${String(rollbackError)}`);
      }
    }

    logger("warn", `[ipc-runtime] Failed to write ${metaPath}: ${String(error)}`);
    return textResponse(500, "Internal error");
  }

  return emptyResponse(204);
}

function routeRequest(
  method: string,
  requestUrl: string,
  body: ArrayBuffer | undefined,
  appRoot: string,
  store: PathConfigStore,
  logger: RuntimeLogger,
): DesktopBridgeResponse {
  const parsedUrl = new URL(requestUrl, "http://desktop.local");
  const pathname = parsedUrl.pathname;

  if (pathname === "/__path-config") {
    if (method === "GET") {
      return jsonResponse(200, store.getSnapshot());
    }

    if (method !== "PUT") {
      return textResponse(405, "Method not allowed");
    }

    let patch: unknown;
    try {
      const bodyText = readBodyText(body);
      patch = bodyText.trim().length > 0 ? JSON.parse(bodyText) : {};
    } catch {
      return textResponse(400, "Invalid JSON");
    }

    try {
      const nextSnapshot = store.update(patch);
      return jsonResponse(200, nextSnapshot);
    } catch (error) {
      if (error instanceof TypeError) {
        return textResponse(400, error.message);
      }

      logger("warn", `[ipc-runtime] Failed to update path config: ${String(error)}`);
      return textResponse(500, "Internal error");
    }
  }

  if (pathname === "/__category-config") {
    if (method !== "PUT") {
      return textResponse(405, "Method not allowed");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(readBodyText(body));
    } catch {
      return textResponse(400, "Invalid JSON");
    }

    if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { categories?: unknown }).categories)) {
      return textResponse(400, "Invalid category config payload");
    }

    const outputRoot = store.getSnapshot().config.outputRoot;
    const categoryPath = resolve(outputRoot, CATEGORY_CONFIG_FILENAME);

    try {
      writeFileSync(categoryPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
      return emptyResponse(204);
    } catch (error) {
      logger("warn", `[ipc-runtime] Failed to write ${categoryPath}: ${String(error)}`);
      return textResponse(500, "Internal error");
    }
  }

  if (pathname === "/__sample-move") {
    if (method !== "PUT") {
      return textResponse(405, "Method not allowed");
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(readBodyText(body));
    } catch {
      return textResponse(400, "Invalid request body");
    }

    const parsedMove = parseMoveRequest(parsedBody);
    if (!parsedMove) {
      return textResponse(400, "Invalid request body");
    }

    return moveSample(parsedMove, store, logger);
  }

  if (pathname.startsWith("/mix/")) {
    if (method !== "GET" && method !== "HEAD") {
      return textResponse(405, "Method not allowed");
    }

    const snapshot = store.getSnapshot();
    const resolvedMix = resolveMixUrl(`${pathname}${parsedUrl.search}`, snapshot.config.archiveRoots);
    if (!resolvedMix) {
      return textResponse(404, "Not found");
    }

    const response = fileResponse(method, resolvedMix.absolutePath);
    if (response.status === 200) {
      response.headers = [["content-type", "application/octet-stream"]];
    }
    return response;
  }

  if (pathname.startsWith("/output/")) {
    if (method !== "GET" && method !== "HEAD") {
      return textResponse(405, "Method not allowed");
    }

    const segments = parsePathSegments(pathname, "/output/");
    if (!segments) {
      return textResponse(404, "Not found");
    }

    const outputRoot = resolve(store.getSnapshot().config.outputRoot);
    const absolutePath = resolve(outputRoot, ...segments);
    if (!ensureContainedPath(outputRoot, absolutePath)) {
      return textResponse(404, "Not found");
    }

    return fileResponse(method, absolutePath);
  }

  if (pathname.startsWith("/data/")) {
    if (method !== "GET" && method !== "HEAD") {
      return textResponse(405, "Method not allowed");
    }

    const segments = parsePathSegments(pathname, "/data/");
    if (!segments) {
      return textResponse(404, "Not found");
    }

    const dataRoot = resolve(appRoot, "data");
    const absolutePath = resolve(dataRoot, ...segments);
    if (!ensureContainedPath(dataRoot, absolutePath)) {
      return textResponse(404, "Not found");
    }

    return fileResponse(method, absolutePath);
  }

  return textResponse(404, "Not found");
}

export function createDesktopBridgeHandler(context: DesktopBridgeContext): DesktopBridgeHandler {
  const appRoot = resolve(context.appRoot);
  const configRoot = resolve(context.configRoot);
  const logger = context.logger ?? defaultLogger;

  mkdirSync(configRoot, { recursive: true });
  const configPath = resolve(configRoot, "path-config.json");
  process.env.EJAY_PATH_CONFIG = configPath;

  const store = createPathConfigStore(appRoot, configPath);
  const initialSnapshot: PathConfigSnapshot = store.getSnapshot();
  if (!initialSnapshot.validation.ok || initialSnapshot.validation.warnings.length > 0 || initialSnapshot.parseError) {
    for (const line of formatPathValidationSummary(initialSnapshot)) {
      logger("warn", `[ipc-runtime] ${line}`);
    }
  }

  return {
    async handleRequest(request: DesktopBridgeRequest): Promise<DesktopBridgeResponse> {
      const method = String(request.method ?? "GET").toUpperCase();
      const url = String(request.url ?? "/");
      try {
        return routeRequest(method, url, request.body, appRoot, store, logger);
      } catch (error) {
        logger("error", `[ipc-runtime] Unhandled request failure: ${String(error)}`);
        return textResponse(500, "Internal error");
      }
    },
  };
}
