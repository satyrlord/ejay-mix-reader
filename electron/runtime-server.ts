import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { extname, resolve, sep } from "path";

import {
  applySampleMoveToManifest,
  createCategoryConfigMiddleware,
  resolveMixUrl,
  validateSampleMovePaths,
  type SampleMetadataManifest,
  type SampleMoveRequest,
} from "../scripts/dev-server/index.js";
import {
  createPathConfigStore,
  formatPathValidationSummary,
  type PathConfigStore,
  type PathConfigSnapshot,
} from "../scripts/path-config.js";

const MAX_BODY_BYTES = 1_048_576;
const CATEGORY_CONFIG_FILENAME = "categories.json";

type LogLevel = "info" | "warn" | "error";

type RuntimeLogger = (level: LogLevel, message: string) => void;

export interface RuntimeServerOptions {
  appRoot: string;
  configRoot: string;
  host?: string;
  port?: number;
  logger?: RuntimeLogger;
}

export interface RuntimeServerHandle {
  url: string;
  close(): Promise<void>;
}

interface ParsedMoveRequest {
  filename: string;
  oldCategory: string;
  oldSubcategory: string | null;
  newCategory: string;
  newSubcategory: string | null;
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

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function sendText(res: ServerResponse, statusCode: number, body: string): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(body);
}

function readRequestBody(
  req: IncomingMessage,
  res: ServerResponse,
  onBody: (body: string) => void,
): void {
  let body = "";
  let bodyTooLarge = false;

  req.setEncoding("utf8");
  req.on("data", (chunk: string) => {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) {
      bodyTooLarge = true;
      sendText(res, 413, "Request entity too large");
      req.destroy();
    }
  });

  req.on("end", () => {
    if (bodyTooLarge) return;
    onBody(body);
  });
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

function streamFile(req: IncomingMessage, res: ServerResponse, absolutePath: string): void {
  if (!existsSync(absolutePath)) {
    sendText(res, 404, "Not found");
    return;
  }

  let isFile = false;
  try {
    isFile = lstatSync(absolutePath).isFile();
  } catch {
    isFile = false;
  }

  if (!isFile) {
    sendText(res, 404, "Not found");
    return;
  }

  res.setHeader("Content-Type", contentTypeFor(absolutePath));
  res.setHeader("Cache-Control", "no-cache");

  if (req.method === "HEAD") {
    res.statusCode = 200;
    res.end();
    return;
  }

  const stream = createReadStream(absolutePath);
  stream.on("error", () => {
    if (!res.writableEnded) sendText(res, 500, "Internal error");
  });
  stream.pipe(res);
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

function handlePathConfigRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: PathConfigStore,
  logger: RuntimeLogger,
): void {
  if (req.method === "GET") {
    sendJson(res, 200, store.getSnapshot());
    return;
  }

  if (req.method !== "PUT") {
    sendText(res, 405, "Method not allowed");
    return;
  }

  readRequestBody(req, res, (body) => {
    let parsed: unknown;
    try {
      parsed = body.trim().length > 0 ? JSON.parse(body) : {};
    } catch {
      sendText(res, 400, "Invalid JSON");
      return;
    }

    try {
      const nextSnapshot = store.update(parsed);
      sendJson(res, 200, nextSnapshot);
    } catch (error) {
      if (error instanceof TypeError) {
        sendText(res, 400, error.message);
        return;
      }

      logger("warn", `[runtime-server] Failed to update path config: ${String(error)}`);
      sendText(res, 500, "Internal error");
    }
  });
}

function handleCategoryConfigRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: PathConfigStore,
  logger: RuntimeLogger,
): void {
  const outputRoot = store.getSnapshot().config.outputRoot;
  const configPath = resolve(outputRoot, CATEGORY_CONFIG_FILENAME);

  createCategoryConfigMiddleware(
    configPath,
    () => {
      logger("info", `[runtime-server] Updated ${configPath}`);
    },
    (message) => {
      logger("warn", message);
    },
  )(req, res, () => {
    sendText(res, 404, "Not found");
  });
}

function handleSampleMoveRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: PathConfigStore,
  logger: RuntimeLogger,
): void {
  if (req.method !== "PUT") {
    sendText(res, 405, "Method not allowed");
    return;
  }

  readRequestBody(req, res, (body) => {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      sendText(res, 400, "Invalid request body");
      return;
    }

    const parsedMove = parseMoveRequest(parsedBody);
    if (!parsedMove) {
      sendText(res, 400, "Invalid request body");
      return;
    }

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
      sendText(res, 400, validationError);
      return;
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
      logger("warn", `[runtime-server] Failed to read ${metaPath}: ${String(error)}`);
      sendText(res, 500, "Internal error");
      return;
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
      sendText(res, 404, `Sample not found in metadata: ${safeFilename} in ${sourceLabel}`);
      return;
    }

    if (!isSamePath && existsSync(newWav)) {
      sendText(res, 409, "Destination file already exists");
      return;
    }

    let movedWav = false;
    if (!isSamePath && existsSync(oldWav)) {
      mkdirSync(newDir, { recursive: true });
      renameSync(oldWav, newWav);
      movedWav = true;
    } else if (!isSamePath) {
      logger("warn", `[runtime-server] WAV not found at ${oldWav}; metadata will still be updated`);
    }

    try {
      writeFileSync(metaPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
    } catch (error) {
      if (movedWav) {
        try {
          renameSync(newWav, oldWav);
        } catch (rollbackError) {
          logger("warn", `[runtime-server] Rollback failed: ${String(rollbackError)}`);
        }
      }

      logger("warn", `[runtime-server] Failed to write ${metaPath}: ${String(error)}`);
      sendText(res, 500, "Internal error");
      return;
    }

    res.statusCode = 204;
    res.end();
  });
}

function handleMixRequest(
  req: IncomingMessage,
  res: ServerResponse,
  snapshot: PathConfigSnapshot,
): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method not allowed");
    return;
  }

  const resolvedMix = resolveMixUrl(req.url ?? "", snapshot.config.archiveRoots);
  if (!resolvedMix) {
    sendText(res, 404, "Not found");
    return;
  }

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", "no-cache");

  if (req.method === "HEAD") {
    res.statusCode = 200;
    res.end();
    return;
  }

  const stream = createReadStream(resolvedMix.absolutePath);
  stream.on("error", () => {
    if (!res.writableEnded) sendText(res, 500, "Internal error");
  });
  stream.pipe(res);
}

function handleOutputRequest(
  req: IncomingMessage,
  res: ServerResponse,
  snapshot: PathConfigSnapshot,
  pathname: string,
): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method not allowed");
    return;
  }

  const segments = parsePathSegments(pathname, "/output/");
  if (!segments) {
    sendText(res, 404, "Not found");
    return;
  }

  const outputRoot = resolve(snapshot.config.outputRoot);
  const absolutePath = resolve(outputRoot, ...segments);
  if (!ensureContainedPath(outputRoot, absolutePath)) {
    sendText(res, 404, "Not found");
    return;
  }

  streamFile(req, res, absolutePath);
}

function handleDataRequest(req: IncomingMessage, res: ServerResponse, dataRoot: string, pathname: string): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method not allowed");
    return;
  }

  const segments = parsePathSegments(pathname, "/data/");
  if (!segments) {
    sendText(res, 404, "Not found");
    return;
  }

  const absolutePath = resolve(dataRoot, ...segments);
  if (!ensureContainedPath(dataRoot, absolutePath)) {
    sendText(res, 404, "Not found");
    return;
  }

  streamFile(req, res, absolutePath);
}

function handleStaticRequest(req: IncomingMessage, res: ServerResponse, distRoot: string, pathname: string): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method not allowed");
    return;
  }

  const isRootRequest = pathname === "/";
  const routePath = isRootRequest ? "/index.html" : pathname;
  const segments = parsePathSegments(routePath, "/");

  if (!segments) {
    sendText(res, 404, "Not found");
    return;
  }

  const absolutePath = resolve(distRoot, ...segments);
  if (!ensureContainedPath(distRoot, absolutePath)) {
    sendText(res, 404, "Not found");
    return;
  }

  if (existsSync(absolutePath)) {
    streamFile(req, res, absolutePath);
    return;
  }

  const hasExtension = extname(pathname).length > 0;
  if (!hasExtension) {
    streamFile(req, res, resolve(distRoot, "index.html"));
    return;
  }

  sendText(res, 404, "Not found");
}

async function listen(server: Server, host: string, port: number): Promise<AddressInfo> {
  return await new Promise<AddressInfo>((resolveAddress, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve runtime server address"));
        return;
      }
      resolveAddress(address);
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolveClose();
    });
  });
}

export async function startRuntimeServer(options: RuntimeServerOptions): Promise<RuntimeServerHandle> {
  const appRoot = resolve(options.appRoot);
  const configRoot = resolve(options.configRoot);
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const logger = options.logger ?? defaultLogger;

  mkdirSync(configRoot, { recursive: true });
  process.env.EJAY_PATH_CONFIG = resolve(configRoot, "path-config.json");

  const store = createPathConfigStore(appRoot);
  const initialSnapshot = store.getSnapshot();
  if (!initialSnapshot.validation.ok || initialSnapshot.validation.warnings.length > 0 || initialSnapshot.parseError) {
    for (const line of formatPathValidationSummary(initialSnapshot)) {
      logger("warn", `[runtime-server] ${line}`);
    }
  }

  const distRoot = resolve(appRoot, "dist");
  const dataRoot = resolve(appRoot, "data");

  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", `http://${host}`);
    const pathname = requestUrl.pathname;

    if (pathname === "/__path-config") {
      handlePathConfigRequest(req, res, store, logger);
      return;
    }

    if (pathname === "/__category-config") {
      handleCategoryConfigRequest(req, res, store, logger);
      return;
    }

    if (pathname === "/__sample-move") {
      handleSampleMoveRequest(req, res, store, logger);
      return;
    }

    const snapshot = store.getSnapshot();

    if (pathname.startsWith("/mix/")) {
      handleMixRequest(req, res, snapshot);
      return;
    }

    if (pathname.startsWith("/output/")) {
      handleOutputRequest(req, res, snapshot, pathname);
      return;
    }

    if (pathname.startsWith("/data/")) {
      handleDataRequest(req, res, dataRoot, pathname);
      return;
    }

    handleStaticRequest(req, res, distRoot, pathname);
  });

  const address = await listen(server, host, port);
  const url = `http://${host}:${address.port}`;
  logger("info", `[runtime-server] Listening on ${url}`);

  return {
    url,
    async close() {
      await closeServer(server);
      logger("info", "[runtime-server] Closed");
    },
  };
}
