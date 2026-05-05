# Electron + React Migration Backlog

This backlog is tailored to the current module layout and is intended to be
executed in small, reversible slices.

## Progress Snapshot

As of 2026-05-04:

1. Slice 1 through Slice 6 are complete.
2. Stage 2 React shell entrypoint is implemented and validated.
3. Stage 3 typed desktop IPC bridge is implemented for local runtime routes.
4. Stage 4 release hardening is in place (tag publish, unsigned packaging
  defaults, checksum artifacts).

## Slice 0: Planning Baseline

1. Confirm endpoint/runtime dependencies used by src modules.
2. Record migration decision in ADR.
3. Define release and validation criteria for Stage 1.

## Slice 1: Stage 1 Electron Shell (Keep Current UI)

1. Add Electron entry modules.

- Add electron/main.ts
- Add electron/preload.ts

2. Add Electron runtime HTTP bridge preserving existing contract.

- Add electron/runtime-server.ts
- Keep these routes compatible with existing UI calls:

  - /mix/* for src/mix-player.ts
  - /output/* for src/library.ts and audio URLs
  - /__path-config for src/library.ts
  - /__category-config for src/library.ts
  - /__sample-move for src/library.ts
  - /data/* for index + metadata payloads

3. Keep dev flow unchanged for renderer.

- Electron dev mode points to existing npm run serve output.
- Production mode serves built dist + data from internal runtime server.

4. Preserve path configurability.

- Reuse scripts/path-config.ts semantics.
- Store writable config in a user-scoped location in Electron mode.

## Slice 2: Build and Packaging Wiring

1. Add tsconfig.electron.json for Electron code.
2. Add npm scripts:

- build:electron
- electron
- electron:dev
- build:desktop
- dist:win

3. Add package metadata for Electron build targets.

- Windows targets: NSIS installer + portable exe
- Artifact output directory for CI uploads/releases

4. Add GitHub Actions workflow.

- windows-latest build runner
- install, typecheck, lint, unit tests
- build renderer + electron
- package Windows artifacts
- upload artifacts
- optional tagged release publishing

## Slice 3: Stage 1 Validation

1. Type-check all modified TS files.
2. Lint source.
3. Run unit tests.
4. Run markdown lint on edited docs.
5. Run Electron smoke test manually:

- app launch
- load sample grid
- open and play one mix
- move sample category and verify metadata update
- read/write path config

Note: Playwright and coverage commands require explicit user approval per repo policy.

## Slice 4: Stage 2 React Introduction (Incremental)

1. Introduce React renderer entrypoint while keeping current app alive behind a feature flag.
2. Migrate module boundaries in order:

- app shell and navigation from src/app-controller.ts
- category/subcategory panels from src/category-config-controller.ts and related UI logic
- mix archive tree from src/mix-file-browser.ts
- sequencer and playback controls from src/mix-player.ts integration points

3. Keep parser/runtime modules non-React and reusable.

- src/mix-buffer.ts
- src/mix-parser.ts
- src/mix-player.ts core playback planning/runtime helpers

## Slice 5: Stage 3 IPC Migration

1. Define typed IPC API surface matching current route semantics.
2. Move endpoint implementations from HTTP bridge to IPC handlers.
3. Provide compatibility adapter during migration.
4. Remove HTTP bridge only after parity checks pass.

## Slice 6: Stage 4 Release Hardening

1. Keep unsigned packaging defaults in CI (`CSC_IDENTITY_AUTO_DISCOVERY=false`).
2. Document optional future code-signing enablement.
3. Add update channel strategy (if desired).
4. Add release checklist and rollback guidance.

## Task Mapping to Current Modules

- Existing route behavior source: scripts/dev-server/*.ts and scripts/dev-server/index.ts
- Path model source: scripts/path-config.ts
- UI consumers: src/library.ts, src/mix-player.ts, src/app-controller.ts
- Build root: package.json, vite.config.ts, tsconfig*.json
- Existing docs context: docs/architecture-notes.md and docs/brainstorming.md
