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
export function manageCategoryConfig(outputRoot: string): Plugin {
  return {
    name: "manage-category-config",
    configureServer(server) {
      const configPath = resolve(outputRoot, CATEGORY_CONFIG_FILENAME);

      const emitCategoryConfigUpdated = (): void => {
        server.ws.send({
          type: "custom",
          event: CATEGORY_CONFIG_UPDATED_EVENT,
          data: null,
        });
      };

      const handleWatchedConfigChange = (filePath: string): void => {
        if (resolve(filePath) !== configPath) return;
        emitCategoryConfigUpdated();
      };

      server.watcher.add(configPath);
      server.watcher.on("add", handleWatchedConfigChange);
      server.watcher.on("change", handleWatchedConfigChange);
      server.watcher.on("unlink", handleWatchedConfigChange);

      server.middlewares.use(
        createCategoryConfigMiddleware(
          configPath,
          emitCategoryConfigUpdated,
          (msg) => server.config.logger.warn(msg),
        ),
      );
    },
  };
}
