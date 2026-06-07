# Comprehensive Improvement Report

Generated: 2026-06-01

Scope: current working tree of the browser-based Photoshop editor. This report reflects the uncommitted workspace state, not only `main`.

## Executive Summary

The project has a very broad browser-native Photoshop-style surface: 238 Photoshop source files, 94 Playwright/TypeScript spec files, 71 registered capability records, and substantial coverage across canvas editing, PSD/raster I/O, filters, panels, automation, print/preflight, variables, 3D/video metadata, and performance paths.

The main finding is not that the app is missing whole Photoshop categories. Most visible categories are present. The immediate problem is release readiness: the current tree does not typecheck because `components/photoshop/canvas-view.tsx` imports overlay components that are still declared locally in the same file. That blocks `npm run verify`, production builds, and reliable smoke-test execution.

The previous `REMAINING_GAPS_REPORT.txt` is now stale. Several items it listed as missing are implemented in the current tree, including Photomerge boundary warp, Image Processor watermark/copyright metadata, full print mark flags/reporting, Color Picker HUD, and variable data-set preview thumbnails. The report should be replaced or updated after the compile blocker is fixed.

## Verification Performed

Commands run:

- `npm run typecheck` - failed.
- `npm run lint` - passed with 7 React hook dependency warnings.
- `npm run check:capabilities` - passed; 71 capability records and 13 advanced-format entries reconciled.
- `npx playwright test tests/color-picker-hud.spec.ts tests/print-marks-report.spec.ts tests/photomerge-workspace.spec.ts tests/plugin-automation-compatibility.spec.ts --reporter=line` - 13 passed, 1 failed because the local Playwright Chromium executable is missing.

Capability status snapshot from `components/photoshop/capabilities.ts`:

- Complete: 1
- Usable: 50
- Approximation: 18
- Stub: 0
- Unsupported: 2, including intentional Adobe cloud/library boundaries

## P0: Must Fix Before Further Feature Work

### 1. TypeScript compile blocker in `canvas-view.tsx`

Evidence:

- `npm run typecheck` fails with `TS2440` import/local declaration conflicts.
- The conflicting import is in `components/photoshop/canvas-view.tsx`:
  - `MagneticLassoIndicator`
  - `GridOverlay`
  - `PixelGridOverlay`
  - `GuidesOverlay`
- The same components are exported from `components/photoshop/canvas-overlays.tsx` and still declared locally near the bottom of `canvas-view.tsx`.

Impact:

- Blocks `npm run verify`.
- Blocks confidence in production builds.
- Indicates an incomplete extraction/refactor.

Recommended fix:

- Keep the extracted `components/photoshop/canvas-overlays.tsx` implementations.
- Remove the duplicate local component declarations from `canvas-view.tsx`.
- Re-run `npm run typecheck`, `npm run build`, and relevant canvas overlay tests.

### 2. Playwright browser installation is incomplete

Evidence:

- Targeted tests reported 13 passing and 1 failing.
- The failing test was a browser-backed Photomerge UI test.
- Failure reason: missing executable at `C:\Users\damia\AppData\Local\ms-playwright\chromium_headless_shell-1217\chrome-headless-shell-win64\chrome-headless-shell.exe`.

Impact:

- Browser UI regression tests cannot fully run on this machine.
- Current E2E confidence is lower than the test count suggests.

Recommended fix:

- Run `npx playwright install chromium`.
- Then run `npm run test:smoke` after typecheck passes.

## P1: High-Value Improvements

### 3. Replace or update the stale gap report

`REMAINING_GAPS_REPORT.txt` says these are missing, but current code shows they are implemented:

- Photomerge Boundary Warp: `photomerge-dialog.tsx` exposes a `Boundary warp` slider and calls `applyPhotomergeBoundaryWarp`.
- Image Processor watermark and copyright metadata: `processing-dialogs.tsx` includes watermark controls plus copyright/author/title metadata.
- Print mark controls: `advanced-subsystems-dialog.tsx` exposes crop, center-crop, registration, color bars, description, and labels.
- Color Picker HUD: `canvas-view.tsx` wires Alt+Shift+RightClick and `color-picker-hud.tsx` has tested HSV math.
- Variables preview thumbnails: `advanced-subsystems-dialog.tsx` has `Generate` row previews and a `variable-preview-grid`.

Recommended fix:

- Replace `REMAINING_GAPS_REPORT.txt` with a current report, or move it to an archive folder.
- Add the current compile/test blockers to the top of the live backlog.

### 4. Add E2E coverage for newly implemented UI flows

Several newly completed features have unit-level or helper-level coverage, but need user-flow coverage:

- Color Picker HUD: current tests cover HSV math, but should also verify Alt+Shift+RightClick opens the HUD and updates foreground color.
- Print marks: current tests cover report generation, but should verify the advanced subsystem UI exposes every mark checkbox and preview summary.
- Image Processor: add a UI-level test that enables watermark and metadata and verifies export path options are passed.
- Variables: add a UI-level test that imports rows, generates thumbnails, selects a thumbnail, and applies a row.
- Photomerge: after Playwright browser install, keep the existing UI test running in CI.

### 5. Resolve React hook dependency warnings

`npm run lint` reports 7 warnings:

- `components/photoshop/canvas-view.tsx`
- `components/photoshop/editor-context.tsx`
- `components/photoshop/liquify-dialog.tsx`

Impact:

- These are not build failures, but they are risky in a long-lived editor where stale closures can silently break overlays, preview rendering, action playback, or document state derivation.

Recommended fix:

- Audit each warning instead of blindly adding dependencies.
- For intentionally stable callbacks, move mutable values to refs or document why the dependency is intentionally excluded.

### 6. Silence the Next.js workspace-root warning

The Playwright web server emitted a Next.js warning:

- Next inferred `C:\Users\damia\package-lock.json` as the workspace root.
- It also detected this repo's `package-lock.json`.

Impact:

- File tracing can include the wrong root in production builds.
- Build output may be noisier or less deterministic.

Recommended fix:

- Set `outputFileTracingRoot` in `next.config.mjs` to this repository root, or remove the higher-level lockfile if it is accidental.

## P2: Product and Architecture Improvements

### 7. Continue shrinking `canvas-view.tsx`

`canvas-view.tsx` remains a very large file handling rendering, pointer routing, overlays, transform controls, custom cursors, color HUD wiring, selection transform state, blur/lighting overlays, and vector/path interactions.

The current duplicate overlay definitions show that extraction is already underway but incomplete.

Recommended next extractions:

- Canvas overlays and guide/grid rendering.
- Selection transform overlay state and hit testing.
- Color HUD pointer lifecycle.
- Blur Gallery and Lighting Effects overlay event adapters.
- Vector/path direct-selection overlay code.

Goal:

- Keep `canvas-view.tsx` as the orchestration layer.
- Move pure rendering and interaction widgets into focused modules with unit tests.

### 8. Keep capability labels honest and actionable

The capability registry is already useful and passes reconciliation. The remaining improvement is product clarity:

- Only 1 record is `complete`.
- 50 records are `usable`.
- 18 records are `approximation`.
- 2 are `unsupported`.

Recommended improvement:

- Surface this distinction more clearly in the UI and docs.
- For `approximation` items, include "best used for" and "do not use for" guidance.
- Avoid marketing copy implying native Photoshop parity for PSD internals, color management, 3D, RAW, PDF/EPS, and plugin runtime behavior.

### 9. Strengthen format fidelity test tiers

The project has broad tests for PSD, metadata, raster codecs, high-bit surfaces, and export reports. The next useful layer is fixture tiering:

- Small deterministic fixtures for every codec path.
- Round-trip fixtures for app-owned metadata.
- "Known-loss" fixtures that assert warnings are emitted rather than silently pretending full parity.
- Large-document stress fixtures for tile-only paths.

This aligns well with the project's browser-limitation philosophy.

### 10. Improve CI/release gating

Recommended minimum release gate:

1. `npm run typecheck`
2. `npm run lint`
3. `npm run check:capabilities`
4. `npm run build`
5. Targeted unit/helper specs for changed modules
6. Full `npm run test:smoke` on a machine with Playwright Chromium installed

Current state fails at step 1.

## Suggested Implementation Order

1. Fix the `canvas-view.tsx` duplicate overlay declarations.
2. Re-run `npm run typecheck`.
3. Install Playwright Chromium and re-run the targeted tests that were blocked.
4. Run `npm run build`.
5. Update `REMAINING_GAPS_REPORT.txt` so it no longer lists completed work as missing.
6. Add E2E coverage for Color Picker HUD, Image Processor watermark/metadata, Variables thumbnails, and Print Workspace controls.
7. Address hook dependency warnings.
8. Continue modularizing `canvas-view.tsx`.

## Current Bottom Line

The app is feature-rich and most of the previous visible gaps have been closed. The next best work is stabilization, not another broad feature wave. Restore typecheck/build first, fix the local Playwright runtime, replace the stale gap report, and add E2E coverage around the recently completed workflows so regressions do not re-open the same gaps.
