# Windows Desktop Release Checklist

This checklist covers unsigned Windows tag releases for the Electron desktop build.

## Preconditions

1. Working tree is clean and tests pass locally.
2. `main` contains the intended release commits.
3. Version and release notes are updated.
4. No signing secrets are required for the current workflow.
5. Packaging is intentionally unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`).

## Tag Release Flow

1. Create and push a version tag (`v<major>.<minor>.<patch>`).
2. Wait for `.github/workflows/windows-electron-build.yml` to complete.
3. Confirm these release job stages succeeded:
   - Typecheck
   - Lint
   - Unit tests
   - Unsigned package build
   - SHA256 checksum generation
   - GitHub Release publish
4. Download release artifacts and verify checksums in `SHA256SUMS.txt`.
5. Smoke test installer and portable build on Windows 11.

## Manual Verification

1. App launches and loads library data.
2. Mix browser opens a `.mix` file.
3. Timeline playback starts/stops.
4. Path config read/write works.
5. Sample move persists metadata updates.
6. Installer/portable binaries show `Unknown Publisher` on Windows (expected for unsigned builds).

## Rollback Guidance

1. If a release job fails before publish:
   - Fix the issue on `main`.
   - Create a new tag (do not reuse the failed tag).
2. If a broken release is already published:
   - Mark release as pre-release or draft.
   - Publish a follow-up patch tag with fixes.
   - Add a release-note warning on the broken version.
3. If signing is enabled in the future and certificate material is compromised:
   - Revoke certificate.
   - Rotate signing secrets.
   - Rebuild and republish from a new tag.
