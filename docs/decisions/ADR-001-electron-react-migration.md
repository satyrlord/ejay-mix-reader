# ADR-001: Migrate Desktop Runtime to Electron and UI to React (Incremental)

## Status

Accepted (Completed)

## Date

2026-05-04

## Execution Snapshot

As of 2026-05-04:

- Stage 1: Completed.
  Electron shell, preload, packaged runtime HTTP bridge, and Windows packaging
  workflow are implemented and validated.
- Stage 2: Completed.
  A React renderer shell is in place and can host the existing UI controller
  lifecycle while preserving current behavior.
- Stage 3: Completed.
  Desktop local-route requests are bridged through a typed Electron IPC
  contract (`window.ejayDesktop.request`) with compatibility routing retained
  for browser/dev workflows.
- Stage 4: Completed.
  Windows CI/release flow includes tagged release publishing for unsigned
  artifacts, SHA256 checksum artifact generation, and an optional future path
  for code signing.

## Context

The project currently ships a Vite + TypeScript browser application with a local
runtime contract that depends on HTTP endpoints provided by the Vite dev server:

- /mix/{product}/{file}
- /output/{path}
- /__path-config
- /__category-config
- /__sample-move
- /data/index.json and /data/mix-metadata.json

Those endpoints are currently implemented through Vite plugin shells in
scripts/dev-server and shared helpers in scripts/dev-server/index.ts, with path
resolution backed by scripts/path-config.ts.

The target outcome is a Windows desktop app (.exe) with the same behavior,
followed by a React migration for the renderer UI. A big-bang rewrite would
create unnecessary risk for mix parsing/playback parity and path-config behavior.

## Decision

Adopt a staged migration with strict compatibility gates:

1. Stage 1 (completed): Electronize first, keep current UI.

- Add an Electron main process and preload.
- Run existing Vite UI unchanged in development.
- In packaged/runtime mode, host an internal local HTTP server in Electron that
  preserves the existing endpoint contract used by src/*.ts.
- Keep path configuration writable via user-scoped config file.

2. Stage 2 (completed): Introduce React renderer incrementally.

- Start with shell and non-critical views.
- Preserve existing parser/player modules and endpoint contract.
- Migrate feature areas by slice, not by full rewrite.

3. Stage 3 (completed): Replace fetch-based local endpoints with typed IPC contracts.

- Keep compatibility shims while React migration is in progress.
- Remove HTTP shim only after full parity tests pass.

4. Stage 4 (completed): Harden packaging and release automation (unsigned by default).

## Alternatives Considered

### Full rewrite to Electron + React in one pass

- Pros: single migration event
- Cons: high regression risk in mix playback, sample resolution, and path logic
- Rejected: too risky for current parity requirements

### Keep browser-only app and distribute as web bundle

- Pros: no desktop packaging complexity
- Cons: does not satisfy Windows desktop executable requirement
- Rejected: does not meet product goal

### Electron with immediate IPC rewrite (no HTTP compatibility)

- Pros: cleaner long-term architecture
- Cons: forces simultaneous runtime and UI migration
- Rejected: violates low-risk incremental strategy

## Consequences

### Positive

- Desktop executable path can be delivered quickly without UI rewrite.
- Current UI behavior remains stable while migration proceeds.
- Existing path-config and sample/mix routing semantics are preserved.

### Negative

- Temporary duplication of some server-side helper behavior in Stage 1.
- Additional runtime component (Electron local server) must be maintained until
  IPC migration is complete.

### Operational

- CI/CD must build both renderer and Electron main/preload outputs.
- Windows release assets and checksum verification become part of normal delivery flow.
- Code signing remains optional and can be enabled later without changing the
  Electron runtime architecture.

## Compatibility Rules

- Stage 1 must preserve current endpoint paths and payload shapes.
- Stage 1 must not regress MIX loading/parsing/playback behavior.
- Stage 1 must not require archive/output folders to exist under repo root.

## Exit Criteria for Stage 1

- Electron app launches with current UI unchanged.
- Local endpoint contract remains functional in Electron runtime mode.
- Type check, lint, and unit tests pass.
- Windows packaging command is wired and produces build artifacts.
