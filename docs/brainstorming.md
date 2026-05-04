# Brainstorming

This document is a safe place to capture ideas, epics, user stories, and feature
breakdowns for planning sessions.

## Active Migration References

1. ADR: [docs/decisions/ADR-001-electron-react-migration.md](decisions/ADR-001-electron-react-migration.md)
2. Backlog: [docs/electron-react-migration-backlog.md](electron-react-migration-backlog.md)

## Chronological Action Plan

Execution order is intentional and should be followed top to bottom.

1. Complete Epic 1 core path foundation (E1-US1, E1-US2, E1-US3, E1-US5,
   E1-US6, E1-US7).
   Deliverable: one shared path/config model used by runtime, scripts, and UI.
2. Complete Epic 1 portability and manual-testing support (E1-US4, E1-US8).
   Deliverable: tests and localhost workflows run with repo, archive, and output
   on different drives.
3. Build System Integrity baseline capabilities (E4-US2, E4-US3, E4-US4).
   Deliverable: readiness state, prerequisite checklist, and launch gating API.
4. Build System Integrity recovery and diagnostics (E4-US5, E4-US6, E4-US1).
   Deliverable: guided recovery and diagnostic exports with privacy/redaction
   controls.
5. Deliver MixJam OS shell and launcher integration (E2-US1, E2-US6).
   Deliverable: desktop shell and module launcher driven by System Integrity
   readiness.
6. Deliver MixJam OS setup operations (E2-US2, E2-US3, E2-US4, E2-US5).
   Deliverable: product/path selection, script execution, and custom sample
   onboarding wired to shared config.
7. Deliver Onboarding Wizard app (E5-US1, E5-US2, E5-US3).
   Deliverable: Windows 9X-style first-run wizard with checkpoints and resume.
8. Deliver Backup and Restore app (E3-US1, E3-US2, E3-US3).
   Deliverable: run history, backup snapshots, and restore flow aligned with
   diagnostic schemas.
9. Run end-to-end integration verification across all epics.
   Deliverable: all modules work with configurable paths and no hardcoded
   `archive/` or `output/` assumptions.

## Tonight's Session Scope

1. Epic 1: Decouple hardcoded `archive` and `output` folders from the app and,
   especially, from tests.
2. Epic 2: Build a new landing page called **MixJam OS** that acts as a fake,
   generic desktop-style home page and prerequisite gate before launching the
   eJay Sound Browser and eJay Mix Reader pages.
3. Epic 3: Create the **Backup and Restore** app with Run History, Library
   Backup, and System Restore modules.
4. Epic 4: Create the **System Integrity** app for readiness validation,
   launch gating, guided recovery, and diagnostics.
5. Epic 5: Create the **Onboarding Wizard** app for first-run setup,
   checkpointing, and resume workflows.

## Epic 1: Decouple Hardcoded Archive and Output Paths

### Epic 1 Summary

Completely remove hardcoded assumptions that `archive/` and `output/` live at
fixed repository-relative locations. This must apply to runtime behavior,
scripts, and especially tests.

Why this is required:

- A user may clone this repo on one drive/disk/partition.
- The eJay installations (archive source) may be on another drive/disk/partition.
- The sample library folder (equivalent to `output`) may be on a third
  drive/disk/partition.

### Epic 1 Goal Outcomes

1. The app can resolve archive and sample-library roots from configurable paths,
   not hardcoded folder names.
2. Tests do not rely on local machine-specific `archive/` or `output/`
   assumptions.
3. New contributors can clone and run the project without reorganizing their
   disks to match this repository's local structure.

### Epic 1 User Stories

#### E1-US1: Multi-drive contributor setup

As a contributor who cloned the repo on drive A, keeps eJay installations on
drive B, and stores sample output on drive C, I want to configure all three
paths independently so the app and tooling work without moving files.

#### E1-US2: Configurable archive source

As a user with eJay product data outside the repository, I want to point the app
to one or more archive roots so product and mix workflows do not depend on a
hardcoded `archive/` directory.

#### E1-US3: Configurable sample library output

As a user with a custom sample-library location, I want to set the equivalent of
`output/` to any folder so browser and mix modules can load samples from my
chosen location.

#### E1-US4: Test path isolation

As a maintainer, I want tests to run against injected paths, fixtures, or mocks
instead of hardcoded workspace folders so test outcomes are stable across
different local drive layouts.

#### E1-US5: First-run validation for paths

As a user, I want immediate validation feedback when configured paths are missing
or invalid so I can fix setup errors before running extraction or playback tasks.

#### E1-US6: Backward-compatible defaults

As an existing contributor, I want sensible defaults that continue to work when
`archive/` and `output/` exist in the repo so migration is gradual and non-
breaking.

#### E1-US7: Portable workspace configuration

As a user switching machines, I want path configuration that can be re-entered
or re-mapped quickly so I can keep working even when absolute paths differ.

#### E1-US8: Profile presets for machines/drives (High Priority)

As a developer running manual localhost tests, I want reusable profile presets
for different machine and drive layouts so I can restart the HTTP browser and
resume quickly without selecting every path manually and re-running all
validations each time.

### Epic 1 Feature Ideas

1. Introduce a path-configuration model that separates:
   - repository root
   - archive roots
   - sample-library root (output equivalent)
2. Add a path resolver service used by runtime modules, scripts, and tests.
3. Add a validation layer that checks existence, readability, and expected
   product structure.
4. Replace direct filesystem assumptions in tests with configurable fixture roots.
5. Add fallback behavior and clear errors when required roots are not configured.

### Epic 1 Definition of Done (Planning Draft)

1. No critical runtime flow depends on hardcoded `archive/` or `output/`.
2. Test suites pass with custom path configuration on arbitrary drives.
3. Setup documentation explains how to map repo/install/sample paths on separate
   disks/partitions.

## Epic 2: MixJam OS Landing Page and Prerequisite-Gated Launch

### Epic 2 Summary

Create a new landing page called **MixJam OS** as the app home page. It should
emulate the look and feel of a fake, generic OS desktop and serve as the user
dashboard for setup and operations.

This page should allow users to:

- select their eJay products and view integrity validation results
- choose an output folder for scripts
- trigger scripts directly from the UI
- add custom sample folders
- view setup readiness and remediation guidance provided by System Integrity

The current eJay Sound Browser and eJay Mix Reader UI should move behind this
desktop shell as a separate page/app surface that launches from MixJam OS.

Hard requirement:

- eJay Sound Browser and eJay Mix Reader must not start until System Integrity
   confirms prerequisites are valid and MixJam OS reflects ready status.

Why this is required:

- users dislike CLI workflows and manual script execution

### Epic 2 Goal Outcomes

1. A user can fully prepare their environment through UI only.
2. Setup and integrity state from System Integrity is visible and actionable
   before module launch.
3. Script-driven prerequisites can be executed from the dashboard without
   terminal usage.
4. Browser/Reader modules launch only when the environment is ready according
   to System Integrity.

### Epic 2 User Stories

#### E2-US1: OS-style home experience

As a user, I want to land on MixJam OS instead of the current module page so I
get a clear desktop-like control center for setup and launching tools.

#### E2-US2: Product selection and validation

As a user, I want to select which eJay products I have installed and view
System Integrity validation for their locations so the app knows which assets
and mixes are available.

#### E2-US3: Output folder selection

As a user, I want to choose the output folder used by scripts so extracted and
normalized assets go to a location I control.

#### E2-US4: Script execution from UI

As a non-CLI user, I want to trigger required scripts from MixJam OS with status
feedback so I never need to run commands manually.

#### E2-US5: Custom sample-folder onboarding

As a user with external or custom libraries, I want to register additional sample
folders so Sound Browser and Mix Reader can include them in resolution/playback.

Integrity-centric validation, launch gating, failure recovery, and diagnostics
are tracked in Epic 4: System Integrity App.

#### E2-US6: Module launch from desktop

As a user, I want to launch the existing eJay Sound Browser and eJay Mix Reader
from MixJam OS desktop shortcuts/windows so the transition feels integrated.

Onboarding workflow stories are tracked in Epic 5: Onboarding Wizard App.

### Epic 2 Feature Ideas

1. MixJam OS desktop shell:
   - wallpaper/theme area
   - icon grid for modules and setup tools
   - status panel for readiness
2. Setup and integrity status center:
   - product detector/selector
   - archive and output path selection
   - custom sample-folder management
   - integrity status and remediation cards sourced from System Integrity
3. Script runner panel:
   - run required scripts
   - stream logs/progress states
   - show success/failure outcomes
4. Module launcher:
   - opens Sound Browser/Mix Reader from the desktop shell
   - consumes System Integrity readiness status and blocked reasons

### Epic 2 Definition of Done (Planning Draft)

1. MixJam OS is the default home page.
2. Browser/Reader launch controls integrate with System Integrity readiness.
3. Users can complete required setup without CLI usage.
4. Setup failures are visible and recoverable from UI using System Integrity
   guidance.

## Epic 3: Backup and Restore App

### Epic 3 Summary

Create a new app called **Backup and Restore** to improve operational safety,
debugging speed, and recovery confidence for MixJam workflows.

For the current scope, this app is split into three modules represented as user
stories:

1. Run History
2. Library Backup
3. System Restore

### Epic 3 Goal Outcomes

1. Users can inspect script execution history and understand what changed.
2. Users can create reliable backups of library-critical data before risky
   operations.
3. Users can restore to a known-good state quickly when setup or script runs go
   wrong.

### Epic 3 User Stories

#### E3-US1: Run History module

As a user, I want a Run History module that records script runs with timestamps,
inputs, outcomes, and key logs so I can audit what happened and troubleshoot
failures without guessing.

#### E3-US2: Library Backup module

As a user, I want a Library Backup module that can create named backup snapshots
of important library state before script operations so I can safely experiment
and recover from mistakes.

#### E3-US3: System Restore module

As a user, I want a System Restore module that restores my environment from a
selected backup/snapshot so I can quickly return to a working state after a bad
change or failed run.

### Epic 3 Feature Ideas

1. Run timeline view with status, duration, and quick log access.
2. Snapshot manager with create, verify, label, and retention metadata.
3. Guided restore flow with pre-checks, confirmation, and post-restore
   validation.

### Epic 3 Definition of Done (Planning Draft)

1. Backup and Restore appears as a dedicated app/module in the MixJam desktop.
2. All three modules are available: Run History, Library Backup, and System
   Restore.
3. Users can complete backup and restore actions without CLI usage.
4. Restore workflows include clear warnings, confirmations, and success/failure
   reporting.

## Epic 4: System Integrity App

### Epic 4 Summary

Create a new app called **System Integrity** that centralizes environment
health, prerequisite validation state, launch gating, and diagnostic support for
MixJam.

This epic starts by transforming two former parking-lot ideas into core scope:

1. Diagnostic export privacy modes and redaction presets.
2. Background re-validation when watched folders change.

It also absorbs integrity-related stories moved from Epic 2 so all validation
and diagnostics workflows are managed in one place.

### Epic 4 Goal Outcomes

1. Users can continuously monitor setup integrity and detect drift quickly.
2. Launch-readiness decisions are driven by a single, auditable integrity state.
3. Diagnostic exports are safe to share and useful for support and LLM-based
   troubleshooting.

### Epic 4 User Stories

Scope boundary for diagnostic stories:

1. E4-US6 defines diagnostic export payload content and output format.
2. E4-US1 defines privacy modes and redaction controls applied to those
   exports.

#### E4-US1: Diagnostic export privacy modes and redaction presets

As a user, I want diagnostic exports to support privacy modes and reusable
redaction presets so I can share troubleshooting bundles without exposing
sensitive local information.

#### E4-US2: Background re-validation when watched folders change

As a user, I want System Integrity to re-validate in the background when watched
folders change so stale or broken setup state is detected automatically.

#### E4-US3: Prerequisite checklist visibility

As a user, I want a checklist of required prerequisites with pass/fail state so
I can fix missing inputs before attempting to use core modules.

#### E4-US4: Launch gating

As a user, I want the launch controls for eJay Sound Browser and eJay Mix Reader
disabled until validation passes so I do not enter broken flows.

#### E4-US5: Guided failure recovery

As a user, I want actionable error messages and suggested next steps when a
prerequisite check fails so I can recover without technical support.

#### E4-US6: One-click diagnostic export for setup support

As a user troubleshooting setup, validation, or launch issues, I want a one-
click diagnostic export that captures the current setup state so I can share a
complete debugging snapshot instead of collecting details manually.

Privacy modes and redaction behavior for this export are defined in E4-US1.

The export should include configured paths, product detection state,
prerequisite validation outcomes, relevant script run results/log snippets, and
runtime version/context metadata needed for support.

The exported file must be thorough and LLM-friendly (structured, machine-
readable, and complete, with a short human-readable summary) so I can feed it
back to GitHub Copilot when something goes wrong.

### Epic 4 Feature Ideas

1. Integrity dashboard with current status, drift alerts, and blocked launch
   reasons.
2. Watcher pipeline for configured roots with debounce and targeted re-checks.
3. Diagnostic export composer with selectable privacy presets and redaction
   preview.
4. Remediation panel with fix actions, links, and verification reruns.

### Epic 4 Definition of Done (Planning Draft)

1. System Integrity appears as a dedicated app/module in the MixJam desktop.
2. Background re-validation works for configured watched folders.
3. Launch gating, checklist status, and guided recovery are powered by System
   Integrity state.
4. Diagnostic export supports privacy modes and redaction presets while
   remaining LLM-friendly for troubleshooting.

## Epic 5: Onboarding Wizard App

### Epic 5 Summary

Create a new app called **Onboarding Wizard** dedicated to first-run setup for
MixJam users.

This epic spins the former E2-US7 into its own product surface and adds explicit
checkpoint and resume capabilities for interrupted setup sessions.

### Epic 5 Goal Outcomes

1. First-time users can complete setup through a guided, low-friction flow.
2. Users can save progress through checkpointing and avoid repeating completed
   steps.
3. Users can restart the app and resume onboarding from the correct point.

### Epic 5 User Stories

#### E5-US1 (moved from E2-US7): Optional first-time onboarding wizard (High Priority)

As a first-time user, I want an optional onboarding wizard that guides setup in
clear steps so I can configure paths, validate prerequisites, and reach a ready
state without confusion.

The wizard should be styled as a fake retro setup flow inspired by Windows 9X
to reinforce the MixJam app aesthetic while still providing modern validation
feedback and safe recovery actions.

#### E5-US2: Onboarding wizard checkpoints

As a user, I want onboarding wizard checkpoints at key milestones so I can
return to a known step without redoing already completed configuration.

#### E5-US3: Resume flow

As a user, I want to resume onboarding after restarting the browser/app so I can
continue from my latest checkpoint with prior inputs preserved.

### Epic 5 Feature Ideas

1. Step-by-step retro setup windows with progress indicators.
2. Automatic checkpoint saves at milestone completion plus optional manual save.
3. Startup resume prompt that offers continue, restart, or skip onboarding.
4. Re-validation hook with System Integrity when resuming older checkpoints.

### Epic 5 Definition of Done (Planning Draft)

1. Onboarding Wizard appears as a dedicated app/module in the MixJam desktop.
2. E5-US1, E5-US2, and E5-US3 are implemented end to end.
3. Checkpoints persist across browser restarts and local manual testing cycles.
4. Resume flow restores previous state and re-checks prerequisite integrity.
