# Codebase Improvement Report

Generated: 2026-06-21

## Executive Summary

The repository is in a stronger state than many earlier review notes imply. `lint`, `typecheck`, capability reconciliation, production build, and bundle analysis all pass. The app also has serious product documentation, explicit browser limitation boundaries, a large Playwright suite, bundle budgets, CSP work, API body limits, and many focused pure-helper tests.

The main improvement theme is scale control. The Photoshop editor has grown to roughly 180,600 TypeScript/TSX lines under `components/photoshop`, and the highest-risk behavior is concentrated in a small set of very large files: `canvas-view.tsx`, `editor-context.tsx`, `menu-bar.tsx`, `raster-codecs.ts`, `advanced-subsystems-dialog.tsx`, and `document-io.ts`. The architecture is already moving toward facades and smaller helpers; the next improvements should continue that work while adding stronger typed command/event contracts, selector-style state subscriptions, import-cycle checks, storage governance, and better release smoke coverage.

No new confirmed P0 product defect was found in this pass. The highest-priority actionable item from this run is that `npm run test:smoke` executed its single smoke test successfully but did not exit before a 240 second timeout on Windows, leaving Playwright/Node child processes that had to be cleaned up manually.

## Scope And Method

Reviewed the whole workspace source tree, excluding generated/vendor-heavy folders such as `.next`, `node_modules`, `test-results`, `artifacts` logs/images, `gsap-public`, and `gsap-skills-main` for static metrics unless noted.

Inspected:

- App shell and routing: `app/`, `proxy.ts`, `next.config.mjs`.
- Editor runtime: `components/photoshop/*`.
- UI primitives and marketing surfaces: `components/ui`, `components/marketing`.
- API and storage: `app/api/*`, `lib/marketing-store.ts`.
- Test and CI setup: `tests/`, `playwright.config.ts`, `.github/workflows/*`.
- Existing architecture docs, plans, and `Findings.txt`.

Verification commands run:

- `npm.cmd run lint`: passed.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run check:capabilities`: passed, 72 capability records and 13 advanced-format entries scanned.
- `npm.cmd run build`: passed with Next.js 16.2.6 webpack build.
- `npm.cmd run analyze:bundle`: passed; regenerated `artifacts/bundle-report.json`.
- `npx.cmd playwright test --list`: 949 tests in 130 files.
- `npx.cmd playwright test --grep @matrix-smoke --list`: 1 smoke test in 1 file.
- `npm.cmd run test:smoke`: the one smoke test reported `ok`, but the command timed out after 240 seconds and left three new Node processes, which were then stopped.

Not run:

- Full Playwright suite. It contains 949 tests and is configured for sharded CI, so this pass used static analysis plus the existing smoke target.
- `npm audit` / dependency freshness checks. Network access was not relied on for this local codebase report.

## Current Health Snapshot

### Repository Size

Measured source/docs/config scope:

| Area | Files | Lines |
| --- | ---: | ---: |
| Total measured files | 601 | 236,394 |
| `components` | 389 | 188,938 |
| `components/photoshop` TS/TSX | 321 | 180,600 |
| `tests` | 131 | 30,090 |
| root config/docs files | 15 | 8,167 |
| `docs` | 39 | 5,958 |
| `app` | 12 | 1,705 |

By extension:

| Extension | Files | Lines |
| --- | ---: | ---: |
| `.ts` | 352 | 132,506 |
| `.tsx` | 191 | 87,930 |
| `.json` | 4 | 7,218 |
| `.md` | 45 | 6,516 |
| `.css` | 2 | 1,239 |
| `.mjs` | 5 | 904 |

### Largest Source Files

| File | Lines |
| --- | ---: |
| `components/photoshop/canvas-view.tsx` | 6,442 |
| `components/photoshop/editor-context.tsx` | 4,755 |
| `components/photoshop/menu-bar.tsx` | 4,089 |
| `components/photoshop/raster-codecs.ts` | 3,804 |
| `components/photoshop/advanced-subsystems-dialog.tsx` | 3,530 |
| `components/photoshop/document-io.ts` | 3,319 |
| `components/photoshop/tool-helpers.ts` | 2,892 |
| `components/photoshop/filters/registry-helpers.ts` | 2,613 |
| `components/photoshop/advanced-subsystems.ts` | 2,458 |
| `components/photoshop/typography-engine.ts` | 2,378 |
| `components/photoshop/color-pipeline.ts` | 2,334 |
| `components/photoshop/psd-effects-adjustments.ts` | 2,290 |
| `components/photoshop/types.ts` | 2,252 |
| `components/photoshop/three-d-video-engine.ts` | 2,081 |
| `components/photoshop/panels/layers-panel.tsx` | 2,027 |

There are 70-plus TypeScript/TSX files at or above 800 lines. This does not automatically mean they are wrong, but it raises the cost of review, refactoring, targeted testing, and safe parallel work.

### Static Quality Signals

| Signal | Count | Notes |
| --- | ---: | --- |
| `TODO` / `FIXME` / `HACK` / `XXX` | 0 | Good backlog hygiene in source text. |
| Explicit `any` pattern hits | 20 | Low enough to consider enabling `no-explicit-any` as warn, with focused exceptions. |
| `@ts-ignore` / `@ts-expect-error` | 0 | Strong TypeScript hygiene. |
| `eslint-disable` | 9 | Mostly in large editor/canvas/dialog files. |
| Direct `window.dispatchEvent/addEventListener/removeEventListener` pattern hits | 579 | Major hidden-coupling signal. |
| `localStorage` pattern hits | 197 | Needs central schema/version/privacy governance. |
| `setTimeout` pattern hits | 276 | Many are likely valid UI scheduling, but use as a risk index for race-prone code. |
| `"use client"` files | 176 | Expected for the editor, but worth reducing on marketing/docs surfaces. |

### Import Graph Signals

Static import graph inside `components/photoshop`:

- 321 files.
- 1,067 local edges.
- Top inbound dependency hotspots:
  - `types.ts`: 171 inbound imports.
  - `editor-context.tsx`: 86 inbound imports.
  - `document-io.ts`: 47 inbound imports.
  - `uid.ts`: 36 inbound imports.
  - `filters.ts`: 26 inbound imports.
- Top outbound hotspots:
  - `canvas-view.tsx`: 46 local imports.
  - `menus/menu-dialogs.tsx`: 46 local imports.
  - `panel-registry.tsx`: 37 local imports.
  - `document-io.ts`: 32 local imports.
  - `menu-bar.tsx`: 27 local imports.

Short cycles detected by a simple static import scan:

- `document-io.ts` -> `export-worker.ts` -> `document-io.ts`. This appears type-only on the `export-worker` side and should be easy to break by importing from `document-io-types.ts`.
- `document-io.ts` -> `animation-encoding.ts` -> `timeline-engine.ts` -> `document-io.ts`. This is a more important runtime-cycle risk because `timeline-engine.ts` imports `renderDocumentComposite` from `document-io.ts`.
- `learning-index.ts` -> `workflow-presets.ts` -> `learning-index.ts`. This can likely be fixed by moving shared learning item types to a third file.

### Bundle Snapshot

`npm.cmd run analyze:bundle` passed.

- Client chunks: 137.
- Initial JS: 529.5 KiB.
- Budget: max client chunk 1,500,000 bytes; max initial JS 5,000,000 bytes.
- Largest chunks:
  - `raster-decoders...js`: 1,414,672 bytes.
  - `2247...js`: 1,314,818 bytes.
  - `document-decoders...js`: 767,294 bytes.
- Violations: none.

The decoder splitting is working, but the 1.28 MiB app chunk should be mapped to source ownership and watched. It is close enough to the per-chunk budget that accidental imports could create a regression quickly.

## Strengths To Preserve

- **Explicit browser boundaries.** `BOUNDARIES.md` is unusually clear about what is impossible or intentionally out of scope in a browser implementation.
- **Strong static baseline.** Strict TypeScript, lint, production build, bundle budget, and capability reconciliation pass.
- **Large test surface.** 949 listed Playwright tests cover many core algorithms, file workflows, browser limitations, panels, and UI flows.
- **Capability reconciliation.** `scripts/check-capabilities.mjs` is a good example of a project-specific invariant check that prevents drift between claims and implementation.
- **Facade direction is already started.** Filters, canvas helpers, render bus, runtime helpers, panel registry, document I/O types, and several decomposed subsystems show the right direction.
- **Security posture is materially improved.** API routes use schemas, origin checks, body limits, rate limits, and bounded upstream reads for generative fill. CSP and nonce work are documented.
- **Bundle discipline exists.** Decoder chunks, dynamic editor entry loading, lazy panels/dialogs, and `optimizePackageImports` are already in place.

## Priority Recommendations

### P1: Continue Decomposing The Central Editor Hotspots

The biggest maintainability risk is still concentration of behavior in very large orchestration files.

Recommended next steps:

- Keep public compatibility facades stable:
  - `canvas-view.tsx` exports `CanvasView`.
  - `editor-context.tsx` exports `EditorProvider`, `useEditor`, current types/helpers.
  - `document-io.ts`, `filters.ts`, `menu-bar.tsx`, and `types.ts` remain stable import surfaces.
- Extract by responsibility, not by arbitrary line count:
  - `canvas-view.tsx`: pointer lifecycle, coordinate conversion, transform interactions, text editing overlay, color HUD, blur/lighting overlay subscriptions, and render orchestration.
  - `editor-context.tsx`: action families, state construction, history restore/compression, lifecycle/dirty tracking, provider side effects, and close-dialog UI.
  - `menu-bar.tsx`: file workflows, command routing, menu definitions, plugin commands, and dialog visibility state.
  - `document-io.ts`: project serialization, PSD import/export adapters, raster export, compatibility/report generation, file-system helpers.
  - `raster-codecs.ts`: TIFF, TGA, PNM, HEIF/AVIF, JPEG 2000, RAW/DNG, metadata injection.
  - `types.ts`: document/layer/tool/timeline/plugin/color/export type modules with a re-exporting facade.
- Add characterization tests before each extraction where behavior is not already covered.
- Add a CI metric budget such as "no new file above 1,500 lines unless explicitly approved" and "net line count in top 10 files must trend down".

Why this matters:

Large files are currently responsible for multiple axes of behavior at once. The app can still be correct, but every change has a larger blast radius than necessary and makes review weaker.

### P1: Make The Command And Event Surface A Typed Contract

The project already has `events.ts`, but only part of the event surface uses it. The static scan found 579 direct window event operations across editor modules. `menu-bar.tsx`, `command-palette.tsx`, `canvas-view.tsx`, and large dialogs still create raw `CustomEvent` strings directly.

Recommended next steps:

- Expand `PhotoshopEventMap` until it covers the real event surface, including save, transform, dialogs, plugin, timeline, selection, and workflow events.
- Replace direct `window.dispatchEvent(new CustomEvent(...))` with `dispatchPhotoshopEvent`.
- Replace direct app event listeners with `addPhotoshopEventListener`.
- Create a small lint or repo script that fails on raw `new CustomEvent("ps-` outside `events.ts` and narrowly approved low-level pointer/browser cases.
- For async command flows, standardize `{ commandId, docId, correlationId, createdAt }` payload fields so completion cannot apply to the wrong document or stale state.
- Consider a typed command registry shared by menu bar, command palette, contextual task bar, shortcuts, and Learn/Discover actions.

Why this matters:

Hidden string-based event contracts make regressions easy to introduce and hard to refactor. A typed command surface will also make menu and command-palette duplication easier to reduce.

### P1: Reduce Global Context Re-render Risk

`editor-context.tsx` has two contexts, including a separate render context, which is good. The main `useEditor()` value still exposes a very broad state and command object. Static imports show 86 modules depend on `editor-context.tsx`, and the context value depends on many state slices.

Recommended next steps:

- Add selector-style hooks for high-read surfaces:
  - `useActiveDocument()`
  - `useActiveLayer()`
  - `useToolState()`
  - `useDocumentLifecycle(docId)`
  - `useHistoryState(docId)`
  - `usePanelModel(panelId)`
- Use `useSyncExternalStore` or narrowly scoped contexts for document, tool, lifecycle, and panel state.
- Keep mutable canvas/render invalidation outside React state where possible, as the current render bus already does.
- Move command-only reads to callback-time refs where components do not need to render from that state.
- Split independent `useMemo` and `useEffect` computations by dependency group in large components.

Why this matters:

The editor is a high-frequency canvas app. Unnecessary React invalidation is one of the fastest ways to lose responsiveness as feature count grows.

### P1: Fix The Smoke Test Gate

The configured smoke target is too narrow and currently has a local teardown/hang problem.

Observed:

- `npx.cmd playwright test --grep @matrix-smoke --list` reports exactly one test.
- `npm.cmd run test:smoke` reported the one test as `ok`, but the command timed out after 240 seconds.
- Three Node processes created by that run remained alive and were manually stopped.

Recommended next steps:

- Investigate Playwright web server teardown on Windows. The `webServer.command` uses `npm run dev -- --webpack --hostname 127.0.0.1 --port 3000`; on Windows, prefer `npm.cmd` if necessary or wrap the command in a cross-platform script.
- Add a dedicated `test:smoke:ci` and `test:smoke:local` if local server reuse is causing hangs.
- Expand smoke coverage from 1 test to a small matrix:
  - home/start workspace renders;
  - editor route renders with nonzero canvas/stage geometry;
  - menu opens a representative dialog;
  - panel dock opens a representative panel;
  - one canvas interaction works;
  - mobile viewport has nonzero canvas area;
  - static export/basePath mode keeps core navigation usable;
  - marketing forms show the right unavailable state when APIs are absent.
- Keep full Playwright sharding in CI, but make smoke fast enough and reliable enough for every local change.

Why this matters:

The test suite is large, but the default smoke gate should catch shell, routing, layout, and teardown failures quickly. One smoke test is not enough for this product surface.

### P1: Break Import Cycles And Add An Import Graph Gate

Three short cycles were detected by a simple static scan. Even type-only cycles can hide bigger architectural drift because TypeScript and bundlers do not always fail loudly.

Recommended next steps:

- Move `RasterExportOptions` use in `export-worker.ts` from `document-io` to `document-io-types`.
- Split timeline rendering so `timeline-engine.ts` does not import `renderDocumentComposite` from `document-io.ts`. A better boundary is likely a small `document-rendering.ts` or compositor facade used by both document I/O and timeline.
- Move `LearningIndexItem` or workflow learning adapter types into a neutral module to break `learning-index.ts` <-> `workflow-presets.ts`.
- Add a lightweight import graph script to CI for `components/photoshop` with an allowlist for known temporary cycles.
- Add dependency rules to docs:
  - engines can import types and pure helpers;
  - UI can import engines;
  - document I/O should not import UI;
  - workers should not import facade modules that import workers.

Why this matters:

Cycles make dynamic imports, workers, and future code splitting more fragile.

### P2: Tighten TypeScript And ESLint Now That Debt Is Lower

Current explicit `any` usage appears low enough to revisit disabled lint rules.

Recommended next steps:

- Turn `@typescript-eslint/no-explicit-any` back on as `warn`.
- Add narrow inline exceptions only for interop boundaries that truly need them.
- Keep `@typescript-eslint/no-unused-vars`, `prefer-const`, and `react-hooks/exhaustive-deps` visible.
- Consider failing CI on new `eslint-disable` lines unless they include a reason and an issue link.
- Add a small `npm run lint:strict` target that uses `--max-warnings=0` for CI once current warnings are burned down.

Why this matters:

The codebase is now large enough that type/lint budgets need to prevent slow regression, not just catch syntax errors.

### P2: Improve Bundle Ownership And Lazy Loading

The bundle gate passes, but one app chunk is around 1.28 MiB and decoder chunks are near the configured limit.

Recommended next steps:

- Generate a source ownership view for the large `2247...js` chunk, either with Next build stats or a bundle analyzer.
- Make sure heavy dialogs and advanced workflows are loaded only when opened:
  - codec-specific export/import paths;
  - advanced subsystem tabs;
  - typography/3D/video workflows;
  - PSD/RAW/decoder-heavy modules.
- Keep `optimizePackageImports` current for frequently imported package barrels.
- Consider hover/focus preloading for large workflows that users are likely to open from menus.
- Split marketing into server/static shell plus client islands where feasible. Many marketing components are currently client components.

Why this matters:

The editor needs a lot of code, but not all features need to load for first interaction.

### P2: Centralize Client Storage Policy

The source uses `localStorage` heavily, and the editor stores state that can include sensitive image/project data. Some modules already use careful try/catch, but the policy is distributed.

Recommended next steps:

- Create a storage adapter layer with:
  - versioned keys;
  - schema validation;
  - quota handling;
  - privacy classification;
  - migration hooks;
  - centralized test fixtures.
- Add a user-facing "clear local editor data" path covering recent documents, autosave/recovery, presets, actions, plugins, and preferences.
- Document which data stays local, which data may include canvas/image content, and how users can remove it.
- In tests, assert that private/incognito/quota failures degrade gracefully.
- For deployable API storage, treat `.data` JSONL as local/dev storage only. Production marketing forms should use a durable backend or external service with retention rules.

Why this matters:

Local-first is appropriate for this app, but local-first image editing needs explicit data lifecycle controls.

### P2: Improve Static Export / Pages Confidence

The current GitHub Pages workflow removes `app/api` before static export. The app already has `NEXT_PUBLIC_STATIC_EXPORT`, but static export remains a separate deployment shape from the Next server build.

Recommended next steps:

- Add a CI job that builds with `GITHUB_PAGES=true` and runs at least static-export smoke checks against `out/`.
- Verify all links and image references respect `basePath`.
- Ensure API-dependent UI, especially marketing forms and model-backed generative fill, clearly disables or reroutes in static export.
- Document that Next middleware/security headers do not apply to GitHub Pages static hosting. If those headers are required, deploy behind a host that can set them.

Why this matters:

Server build and static export can both pass while shipping different runtime behavior.

### P2: Turn `Findings.txt` Into A Tracked Backlog

`Findings.txt` contains useful prior analysis, but it mixes resolved, stale, current, and deep defect claims. Some earlier items are already addressed: there is now a real `LICENSE`, `out/**` is ignored by ESLint, CI exists, bundle budget exists, and generative-fill route limits/origin handling exist.

Recommended next steps:

- Split `Findings.txt` into tracked issues or docs sections:
  - confirmed current defects;
  - resolved findings with commit/date;
  - needs revalidation;
  - accepted browser limitation;
  - duplicate/superseded.
- Add each confirmed defect to tests before fixing.
- Reference `BOUNDARIES.md` for items that are non-goals rather than bugs.
- Keep one current report index in `docs/` so future agents do not rely on stale review snapshots.

Why this matters:

Good findings lose value if they are not statused. Stale warnings cause reviewers to waste time or mistrust the docs.

### P2: Add Accessibility And Responsive Release Gates

The codebase has accessibility-oriented tests and a panel, but broad UI surfaces still need systematic release checks, especially on mobile and dense dialogs.

Recommended next steps:

- Add smoke assertions for nonzero canvas geometry at mobile and desktop viewports.
- Add keyboard tests for:
  - document tabs;
  - tool groups;
  - command palette;
  - panel browser;
  - custom context menu;
  - resizers/separators.
- Consider adding axe-based checks for high-value screens if dependency weight is acceptable.
- Standardize dialog focus trap, Escape behavior, focus restoration, title/description semantics, and touch target budgets.

Why this matters:

The editor is dense, which makes keyboard and responsive regressions more likely than on a simpler app.

### P2: Continue Security And Input-Bounds Hardening

This pass did not perform a full security scan, but source review shows the right direction: bounded readers, schemas, CSP, origin checks, sandboxed plugin work, and capability limitations.

Recommended next steps:

- Add fuzz-style fixtures for project import, PSD metadata, raster headers, and advanced decoder inputs.
- Preflight dimensions before expensive decoder allocation wherever a format allows it.
- Keep body, upstream response, layer count, mask count, and string-length limits explicit and tested.
- Make rate limiting deploy-aware. In-memory limits are fine locally but should use a durable/shared store when deployed across processes or serverless instances.
- Add dependency freshness automation such as Dependabot or Renovate, plus a documented update cadence.

Why this matters:

Image editors process attacker-controlled binary and JSON data. Bounds checks are product stability features as much as security features.

### P3: Developer Experience And Reproducibility

Recommended next steps:

- Add `engines` and `packageManager` to `package.json`.
- Add `.nvmrc` or `.node-version` matching CI Node 22.
- Document Windows usage of `npm.cmd` when PowerShell script execution blocks `npm.ps1`.
- Add a local `npm run doctor` that checks Node version, Playwright browsers, package manager, and common Windows execution-policy issues.
- Keep generated build artifacts out of normal diffs, except intentional artifacts such as `artifacts/bundle-report.json`.

Why this matters:

The project is big enough that environment drift costs real time.

## Suggested Roadmap

### Immediate: 1-3 Days

- Fix `npm run test:smoke` teardown/hang on Windows.
- Expand smoke tests from 1 to 5-8 high-signal checks.
- Break the easiest import cycles:
  - `export-worker.ts` should import export option types from `document-io-types.ts`.
  - move shared learning/workflow types to a neutral file.
- Add `engines` and `packageManager`.
- Turn `no-explicit-any` on as warn and record the current budget.
- Status `Findings.txt` into current/resolved/needs-revalidation sections.

### Short Term: 1-2 Weeks

- Expand `events.ts` to cover the actual event surface.
- Add a no-raw-`ps-*`-CustomEvent repo check.
- Start extracting `menu-bar.tsx` into command definitions and workflow adapters.
- Add selector hooks for the most common `useEditor()` reads.
- Add a static export Pages smoke job.
- Map the 1.28 MiB app chunk to source ownership.

### Medium Term: 1-2 Months

- Continue facade-first decomposition of `canvas-view.tsx`, `editor-context.tsx`, `document-io.ts`, and `raster-codecs.ts`.
- Introduce import graph and file-size trend budgets in CI.
- Centralize local storage schemas and migrations.
- Add accessibility and responsive geometry release gates.
- Convert confirmed data-loss/history/rendering findings from `Findings.txt` into tests and fixes.

### Longer Term

- Define a canonical render graph shared by 2D, WebGL, tile-only, timeline, export, and print paths.
- Reduce `types.ts` and `editor-context.tsx` as inbound dependency bottlenecks.
- Move production marketing/API persistence out of repo-local JSONL if this is deployed as more than a demo/local app.
- Add browser matrix coverage for WebKit/Firefox where browser APIs differ materially.

## Recommended Success Metrics

Track these over time:

- Top 10 largest files total lines: trending down.
- No new source file above 1,500 lines without an explicit exception.
- Direct raw `CustomEvent("ps-...")` calls: trending to zero outside `events.ts`.
- `useEditor()` import count: trending down as selector hooks land.
- Import cycles in `components/photoshop`: zero or explicitly allowlisted.
- Smoke tests: at least 5 high-value tests, under 60 seconds locally, no process leaks.
- Bundle: largest non-decoder app chunk under 1 MiB.
- Static export smoke: passing.
- Explicit `any`: zero or allowlisted interop-only.
- Local storage keys: versioned and schema-validated.

## Final Assessment

This is a serious, feature-rich browser image editor with good foundations and a much better quality gate than earlier reports suggest. The next phase should not be broad rewriting. It should be disciplined architecture control: keep current facades stable, move cohesive behavior out of giant files, make events and commands typed, narrow React subscriptions, and expand the smoke/release gates so the project can keep growing without review quality collapsing.
