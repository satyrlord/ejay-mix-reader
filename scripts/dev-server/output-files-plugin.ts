import { createReadStream, existsSync, lstatSync } from "fs";
import { extname, resolve, sep } from "path";

import type { Plugin } from "vite";

type OutputRootProvider = string | (() => string);

function getOutputRoot(provider: OutputRootProvider): string {
  return typeof provider === "function" ? provider() : provider;
}

function parseOutputSegments(url: string): string[] | null {
  const match = /^\/output\/([^?#]+)(?:[?#].*)?$/.exec(url);
  if (!match) return null;

  const rawPath = match[1];
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
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

export function serveOutputFiles(outputRootProvider: OutputRootProvider): Plugin {
  return {
    name: "serve-output-files",
    configureServer(server) {
      const respondNotFound = (res: NodeJS.WritableStream & { statusCode: number; end(chunk?: string): void }): void => {
        res.statusCode = 404;
        res.end("Not found");
      };

      const respondMethodNotAllowed = (res: NodeJS.WritableStream & { statusCode: number; setHeader(name: string, value: string): void; end(chunk?: string): void }): void => {
        res.statusCode = 405;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Method not allowed");
      };

      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith("/output/")) {
          next();
          return;
        }

        if (req.method !== "GET" && req.method !== "HEAD") {
          respondMethodNotAllowed(res);
          return;
        }

        const segments = parseOutputSegments(req.url);
        if (!segments) {
          respondNotFound(res);
          return;
        }

        const outputRoot = resolve(getOutputRoot(outputRootProvider));
        const absolutePath = resolve(outputRoot, ...segments);
        const outputRootPrefix = outputRoot.endsWith(sep) ? outputRoot : `${outputRoot}${sep}`;
        if (!(absolutePath === outputRoot || absolutePath.startsWith(outputRootPrefix))) {
          respondNotFound(res);
          return;
        }

        if (!existsSync(absolutePath)) {
          respondNotFound(res);
          return;
        }

        let isFile = false;
        try {
          isFile = lstatSync(absolutePath).isFile();
        } catch {
          isFile = false;
        }
        if (!isFile) {
          respondNotFound(res);
          return;
        }

        try {
          res.setHeader("Content-Type", contentTypeFor(absolutePath));
          res.setHeader("Cache-Control", "no-cache");

          if (req.method === "HEAD") {
            res.statusCode = 200;
            res.end();
            return;
          }

          const stream = createReadStream(absolutePath);
          stream.on("error", (error) => {
            server.config.logger.warn(`[serve-output-files] Failed to read ${absolutePath}: ${String(error)}`);
            if (res.writableEnded) return;
            res.statusCode = 500;
            res.end("Internal error");
          });
          stream.pipe(res);
        } catch (error) {
          server.config.logger.warn(`[serve-output-files] Failed to stream ${absolutePath}: ${String(error)}`);
          if (res.writableEnded) return;
          res.statusCode = 500;
          res.end("Internal error");
        }
      });
    },
  };
}
