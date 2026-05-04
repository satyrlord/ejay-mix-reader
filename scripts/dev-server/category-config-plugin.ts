/**
 * dev-server/category-config-plugin.ts — Vite plugin that watches
 * `output/categories.json` and exposes a `PUT /__category-config` endpoint
 * so the browser UI can persist editable category overrides.
 *
 * The HTTP request-handling logic lives in `createCategoryConfigMiddleware`
 * (from `index.ts`) which is unit-tested independently. This file contains
 * only the Vite plugin shell: watcher setup and HMR event emission.
 *
 * Consumers:
 *   - vite.config.ts
 *   - scripts/__tests__/vite-category-config-plugin.test.ts
 */

import { resolve } from "path";
import type { Plugin } from "vite";

import { CATEGORY_CONFIG_FILENAME, CATEGORY_CONFIG_UPDATED_EVENT } from "../../src/data.js";
import { createCategoryConfigMiddleware } from "./index.js";

type OutputRootProvider = string | (() => string);

function resolveOutputRoot(provider: OutputRootProvider): string {
  return typeof provider === "function" ? provider() : provider;
}

/**
 * Returns a Vite dev-server plugin that:
 * 1. Watches `<outputRoot>/categories.json` for external changes and pushes
 *    a `category-config-updated` HMR event to the browser.
 * 2. Mounts a `PUT /__category-config` middleware so the browser can write
 *    a new category configuration without a full page reload.
 *
 * @param outputRoot Absolute path to the `output/` directory that contains
 *   `categories.json`.
 */
export function manageCategoryConfig(outputRoot: OutputRootProvider): Plugin {
  return {
    name: "manage-category-config",
    configureServer(server) {
      let watchedConfigPath = resolve(resolveOutputRoot(outputRoot), CATEGORY_CONFIG_FILENAME);

      const ensureWatchedConfigPath = (): string => {
        const nextPath = resolve(resolveOutputRoot(outputRoot), CATEGORY_CONFIG_FILENAME);
        if (nextPath === watchedConfigPath) return watchedConfigPath;
        watchedConfigPath = nextPath;
        server.watcher.add(watchedConfigPath);
        return watchedConfigPath;
      };

      const emitCategoryConfigUpdated = (): void => {
        server.ws.send({
          type: "custom",
          event: CATEGORY_CONFIG_UPDATED_EVENT,
          data: null,
        });
      };

      const handleWatchedConfigChange = (filePath: string): void => {
        if (resolve(filePath) !== watchedConfigPath) return;
        emitCategoryConfigUpdated();
      };

      server.watcher.add(watchedConfigPath);
      server.watcher.on("add", handleWatchedConfigChange);
      server.watcher.on("change", handleWatchedConfigChange);
      server.watcher.on("unlink", handleWatchedConfigChange);

      server.middlewares.use((req, res, next) => {
        const configPath = ensureWatchedConfigPath();
        createCategoryConfigMiddleware(
          configPath,
          emitCategoryConfigUpdated,
          (msg) => server.config.logger.warn(msg),
        )(req, res, next);
      });
    },
  };
}
