# Codebase Analysis And Improvement Report

Generated: 2026-06-22

Branch inspected: `refactor/decompose-god-files`

Base commit inspected: `f6c667e`

## Executive Summary

This repository is a substantial browser-native Photoshop-style editor built on Next.js 16, React 19, TypeScript, Canvas, workers, browser storage, and a large Photoshop-inspired feature surface. The current codebase is in a much stronger state than an ordinary prototype: strict TypeScript passes, lint has warnings but no errors, capability reconciliation passes, architecture gates pass, smoke tests now run quickly, static export smoke is wired into the Pages deployment workflow, and the project has explicit browser-boundary documentation.

The main risk is scale control. The app has about 220k measured lines in source/docs/config, with about 177k under `components/` and most of that in `components/photoshop`. The architecture is improving, but several quality gates are currently permissive baselines rather than targets: raw Photoshop event dispatches are exactly at their budget, `useEditor` imports are close to their budget, and 26 Photoshop source files still exceed 1,500 lines.

The right next phase is disciplined consolidation rather than a rewrite:

- Keep the existing editor facades stable.
- Continue shrinking the largest orchestration files by responsibility.
- Replace broad context subscriptions with real selector-style state access.
- Finish migrating raw `ps-*` events and storage keys into typed, governed contracts.
- Tighten architecture budgets as each area improves.
- Add timeout/abort cleanup to long-running worker and decoder flows.
- Make production deployment assumptions explicit for API persistence and rate limiting.

No confirmed P0 product defect was found during this pass. The highest-priority engineering issue is that the local environment does not match the repository contract: `npm run doctor` reports Node `25.2.1`, while the project requires Node `>=22 <23`.

## Scope And Method

This report reviewed the current working tree, not only committed code. The working tree was already dirty before this report was created, with modified CI, docs, editor, events, storage, smoke-test, and architecture-gate files plus several new untracked files. I did not revert or overwrite those changes.

Reviewed areas:

- App shell and routing: `app/`, `next.config.mjs`, `proxy.ts`.
- Editor runtime: `components/photoshop`.
- UI primitives and marketing surface: `components/ui`, `components/marketing`.
- API and persistence helpers: `app/api`, `lib/marketing-store.ts`.
- Tests and quality gates: `tests`, Playwright configs, GitHub workflows, scripts.
- Existing documentation: `README.md`, `BOUNDARIES.md`, `CLAUDE.md`, `docs/codebase-improvement-report-2026-06-21.md`, `docs/findings-backlog-2026-06-21.md`.

Excluded from static metrics:

- `.git`, `.next`, `node_modules`, `out`, `test-results`, generated artifacts, `gsap-public`, `gsap-skills-main`, vendor files.

## Verification Results

Commands run:

| Command | Result | Notes |
| --- | --- | --- |
| `npm.cmd run doctor` | Failed | Node is `25.2.1`, expected `>=22 <23`; doctor also reported npm unavailable and local Playwright browser cache missing. |
| `npm.cmd run lint` | Passed with warnings | 22 warnings, all `@typescript-eslint/no-explicit-any`. |
| `npm.cmd run typecheck` | Passed | `tsc --noEmit` completed successfully. |
| `npm.cmd run check:capabilities` | Passed | 72 capability records and 13 advanced-format entries scanned. |
| `npm.cmd run check:architecture -- --json` | Passed | Zero import cycles; budgets pass. |
| `npx.cmd playwright test --list` | Passed | 960 tests in 132 files. |
| `npx.cmd playwright test --config=playwright.smoke.config.ts --list` | Passed | 9 smoke tests in 1 file. |
| `npm.cmd run test:smoke` | Passed | 9 tests passed in 7.9 seconds. |
| `npm.cmd audit --audit-level=high` | Passed | No high/critical issues; one low-severity Babel advisory. |

Not run:

- Full Playwright suite. It lists 960 tests and is configured for sharded CI.
- Production build in this pass. The latest local bundle report is from 2026-06-21 and is treated as a local snapshot, not as freshly regenerated today.

## Current Health Snapshot

Measured source/docs/config scope:

| Area | Files | Lines |
| --- | ---: | ---: |
| Total measured files | 615 | 220,084 |
| `components` | 392 | 177,155 |
| `tests` | 133 | 26,957 |
| root files | 17 | 8,055 |
| `docs` | 41 | 4,647 |
| `app` | 12 | 1,528 |
| `scripts` | 7 | 944 |
| `lib` | 3 | 360 |

By extension:

| Extension | Files | Lines |
| --- | ---: | ---: |
| `.ts` | 359 | 122,072 |
| `.tsx` | 191 | 83,320 |
| `.json` | 5 | 7,239 |
| `.md` | 47 | 5,051 |
| `.mjs` | 9 | 1,197 |
| `.css` | 2 | 1,126 |

Architecture gate snapshot:

| Signal | Current | Budget | Status |
| --- | ---: | ---: | --- |
| Import cycles in `components/photoshop` | 0 | 0 | Passing |
| Raw Photoshop `ps-*` events outside `events.ts` | 217 | 217 | Passing, no headroom |
| Files over 1,500 lines | 26 | 80 | Passing, loose baseline |
| `useEditor` imports | 85 | 90 | Passing, narrow headroom |

Largest Photoshop files from the architecture gate:

| File | Lines |
| --- | ---: |
| `components/photoshop/canvas-view.tsx` | 6,442 |
| `components/photoshop/editor-context.tsx` | 4,833 |
| `components/photoshop/menu-bar.tsx` | 4,089 |
| `components/photoshop/raster-codecs.ts` | 3,804 |
| `components/photoshop/advanced-subsystems-dialog.tsx` | 3,530 |
| `components/photoshop/document-io.ts` | 3,141 |
| `components/photoshop/tool-helpers.ts` | 2,892 |
| `components/photoshop/filters/registry-helpers.ts` | 2,613 |
| `components/photoshop/advanced-subsystems.ts` | 2,458 |
| `components/photoshop/typography-engine.ts` | 2,378 |

Pattern scan highlights:

| Pattern | Hits | Interpretation |
| --- | ---: | --- |
| `"use client"` | 177 | Expected for editor-heavy app, but marketing has many client components. |
| `localStorage` | 171 | Storage adapter exists but migration is incomplete. |
| `sessionStorage` | 3 | Low. |
| `indexedDB` | 9 | Used for larger local artifacts. |
| `new CustomEvent` | 229 | Event typing is incomplete. |
| `window.dispatchEvent` | 229 | Hidden coupling remains high. |
| `window.addEventListener` | 176 | Global listener ownership needs consolidation. |
| `window.removeEventListener` | 171 | Mostly paired, but still distributed. |
| `setTimeout` | 274 | Many valid scheduling uses; still a race-risk index. |
| `eslint-disable` | 9 | All are hook dependency suppressions. |
| `@ts-ignore` / `@ts-expect-error` | 0 | Good TypeScript hygiene. |

Latest local bundle snapshot, from `artifacts/bundle-report.json` generated 2026-06-21:

- Client chunks: 137.
- Initial JS: 542,230 bytes.
- Largest chunk: `raster-decoders...js`, 1,414,672 bytes.
- Largest non-decoder app chunk: `2247...js`, 1,314,961 bytes.
- Decoder chunk budget: 1,500,000 bytes.
- Bundle violations: none.

## Strengths To Preserve

### Product Boundaries Are Clear

`BOUNDARIES.md` is valuable. It separates browser-achievable work from intentional non-goals such as native Adobe services, native plugin runtimes, certified CMM behavior, exact proprietary algorithm parity, and professional codec output beyond browser APIs. This prevents wasted refactors and unrealistic roadmap items.

### Static Gates Exist And Pass

Strict TypeScript, lint, capability reconciliation, architecture budgets, bundle budgets, smoke tests, and static export smoke are all present. The app has a project-specific quality culture instead of relying only on generic framework defaults.

### Architecture Is Moving In The Right Direction

The previous short import cycles have been removed. New neutral modules such as `document-rendering.ts`, `document-io-types.ts`, `client-storage.ts`, and `learning-types.ts` show the right pattern: keep public facades stable while moving cohesive responsibilities out of central files.

### The Test Surface Is Broad

The suite lists 960 tests across 132 files, including editor workflows, pixel regressions, filters, PSD/file workflows, security regression limits, performance, static export, accessibility-adjacent checks, and smoke coverage. The smoke suite now covers home, editor geometry, command palette, menu dialog, panel dock, canvas interaction, and mobile geometry.

### Security And Bounds Checks Are Not Afterthoughts

The codebase has explicit canvas limits, file-size limits, project-layer limits, PSD/raster import sniffers, API body limits, upstream response limits, origin checks, CSP headers, plugin sandboxing, and rate limiting. This is the right posture for an image editor that processes user-provided binary data.

### Bundle Splitting Has Started

The editor entry, panels, dialogs, codecs, and some advanced modules use dynamic imports. `next.config.mjs` also uses package import optimization and custom chunk groups for heavy decoder libraries.

## Priority Recommendations

### P1: Fix Local Environment Drift

`npm run doctor` failed because the active runtime is Node `25.2.1`, while `package.json`, `.nvmrc`, `.node-version`, CI, and docs expect Node `>=22 <23`.

Recommended work:

- Use Node 22 locally before treating verification as release-grade.
- Improve `scripts/doctor.mjs` so the npm check is robust when the script itself was invoked through `npm.cmd`.
- Adjust the Playwright browser check. Smoke tests passed, but doctor reported the local browser cache missing, so the current check may be too narrow for this install layout.
- Add a preflight note to PR/agent workflows: do not run full verification under Node 25 and call it equivalent to CI.

Why this matters:

Node and Next compiler/runtime behavior can differ across majors. A clean smoke run under Node 25 is useful, but CI truth is Node 22.

### P1: Turn Architecture Budgets From Baselines Into Reduction Targets

The architecture gate passes, but two budgets have little or no headroom:

- Raw Photoshop events: 217/217.
- `useEditor` imports: 85/90.

Recommended work:

- Ratchet `rawPhotoshopEvents.max` down after every migration batch.
- Ratchet `useEditorImports.max` down after each selector/context migration.
- Replace the loose oversize-file budget of 80 with staged targets, for example 26 current, then 24, 22, 20.
- Add a "top 10 largest files total lines" metric so refactors cannot merely move code around while the worst concentration stays flat.
- Keep an escape hatch for intentional large generated/static data files, but require comments for exceptions.

Why this matters:

Passing a high-watermark budget prevents regression, but it does not force improvement. This codebase needs trend pressure.

### P1: Reduce Broad React Context Subscriptions

`editor-context.tsx` has good work already: a separate render bus, stable fallbacks, narrow memo dependencies in some places, `startTransition` for high-frequency actions, and helper hooks such as `useActiveDocument`, `useToolState`, and `useHistoryState`.

The remaining issue is that these hooks still call `useEditor()`, so they still subscribe to the full `EditorContextValue`. With 85 imports and many panels/dialogs, a state change in one slice can still invalidate consumers that only need a small slice.

Recommended work:

- Introduce true selector-style access using `useSyncExternalStore`, or split the editor state into narrower contexts:
  - document list and active document;
  - active tool/settings;
  - document lifecycle/dirty state;
  - history state;
  - action recording state;
  - command methods;
  - render bus.
- Move command-only consumers to a command context or stable refs when they do not render from editor state.
- Start with high-fanout panels and dialogs that only need a few fields.
- Add a regression test or profiling harness that counts renders for common interactions such as brush-size slider drag, zoom, history push, and panel switching.

Why this matters:

This is a high-frequency canvas app. Avoiding unnecessary React invalidation will matter more as the UI surface grows.

### P1: Finish The Typed Event Contract

`components/photoshop/events.ts` is a good direction: it defines `PhotoshopEventMap`, `dispatchPhotoshopEvent`, and `addPhotoshopEventListener`. The migration is incomplete.

Evidence:

- Architecture gate reports 217 raw `ps-*` event dispatches outside `events.ts`.
- Pattern scan found 229 `new CustomEvent` and 229 `window.dispatchEvent` hits.
- Highest event/listener concentration is in `menu-bar.tsx`, `command-palette.tsx`, `canvas-view.tsx`, `algorithmic-operations-dialog.tsx`, `options-bar.tsx`, and `editor-app.tsx`.
- Some adjacent event systems, such as plugin lifecycle events, still use raw window events outside the typed map.

Recommended work:

- Expand `PhotoshopEventMap` until all app-level `ps-*` events are represented.
- Replace raw dispatches with `dispatchPhotoshopEvent`.
- Replace raw listeners with `addPhotoshopEventListener` where the event is an app event rather than a browser event.
- Add a script or ESLint rule that rejects new `CustomEvent("ps-...")` outside `events.ts`.
- Standardize command envelope fields: `commandId`, `docId`, `correlationId`, `createdAt`.
- Add stale-document tests for async save/close, transform, plugin, and workflow events.

Why this matters:

Stringly typed event flows are hard to refactor and easy to make stale. A typed event bus also gives future command palette, menu, shortcuts, and automation work a common contract.

### P1: Consolidate Client Storage Governance

`client-storage.ts` introduces descriptors with version, privacy class, fallback, and safe read/write helpers. That is good, but adoption is incomplete.

Evidence:

- 171 `localStorage` hits remain in `components`, `app`, `lib`, and `tests`.
- Direct storage usage remains in recent documents, automation, presets, panel dock, editor app, adjustments, tech previews, menu customization, swatches, shortcuts, glyphs, notes, measurement log, and workspace layouts.
- There are multiple storage backends: `localStorage`, `sessionStorage`, IndexedDB, OPFS-style scratch, and `.data` JSONL for marketing APIs.

Recommended work:

- Create a central storage key registry using `ClientStorageKey` descriptors.
- Add Zod or equivalent schema validation per persisted payload.
- Add migrations for old keys, including a migration test matrix.
- Add privacy classifications and user-facing "clear local editor data" controls:
  - preferences;
  - recent documents;
  - autosave/recovery;
  - presets and libraries;
  - automation/actions;
  - plugin metadata;
  - diagnostic/history logs.
- Add storage failure tests for quota exceeded, disabled storage, malformed JSON, and private browsing behavior.
- Keep large image/project content in IndexedDB/OPFS rather than synchronous `localStorage`.

Why this matters:

This is a local-first image editor. Browser storage can hold user images, project metadata, plugin data, and recovery content. It needs explicit lifecycle and privacy controls.

### P1: Keep Decomposing Large Orchestration Files

There are 26 Photoshop source files above 1,500 lines. The biggest files are not merely long; they coordinate many unrelated responsibilities.

Recommended extraction targets:

- `canvas-view.tsx`: split pointer routing, viewport math, transform overlays, brush/eraser input, text editing overlay, blur/lighting overlays, vector/path interactions, and render subscription logic.
- `editor-context.tsx`: split action families, provider side effects, history/snapshot operations, document lifecycle, action recording, layer operations, and transform operations.
- `menu-bar.tsx`: split menu definitions, command routing, file workflows, plugin/advanced workflows, and dialog state.
- `raster-codecs.ts`: split format families: TIFF/BigTIFF, Netpbm/TGA, EXR, HEIF/AVIF, JPEG 2000, RAW/DNG, metadata injection.
- `advanced-subsystems-dialog.tsx`: split plugin workspace, 3D/video sections, import/export helpers, and sandbox UI.
- `document-io.ts`: continue separating project serialization, PSD import/export, raster export, compatibility reports, and file-system operations.

Recommended guardrail:

- Each extraction should preserve the existing facade import path until consumers are migrated.
- Add characterization tests before moving behavior that is not already covered.
- Lower the oversize-file budget only after each successful extraction.

Why this matters:

Large orchestration files reduce review quality, make conflicts more likely, and slow down safe parallel work.

### P1: Add Worker Timeout And Abort Cleanup

Workers and async filters are already used well, but some flows can keep pending work alive longer than necessary.

Observed examples:

- `applyFilterAsync` and `applyFilterBatch` attach abort listeners but do not remove them after a normal worker response.
- Raster export worker requests have no explicit timeout or abort option.
- Worker error handling rejects pending requests, but silent worker stalls can leave promises pending.

Recommended work:

- Remove abort listeners on resolve/reject/fallback.
- Add optional timeout support to filter and export worker requests.
- Add `AbortSignal` support to raster export worker execution.
- Consider terminating and recreating workers after fatal errors or repeated timeouts.
- Add tests for abort after dispatch, worker error, worker timeout, and fallback behavior.

Why this matters:

Image operations can be large and user-cancelled. Cleanup is part of performance and reliability, not only correctness.

### P2: Tighten Decoder And Import Hardening Coverage

The codebase already has explicit canvas and file limits, header sniffers, large-document planning, and format-specific safety checks. The remaining work is consistency across all decoder paths.

Recommended work:

- Ensure every format path performs cheap header/dimension preflight before full decode when the format allows it.
- Add fuzz-style fixtures for PSD/PSB headers, TIFF IFD tags, ISO-BMFF boxes, JPEG markers, WebP chunks, EXR headers, JPEG 2000 codestreams, and RAW/DNG metadata.
- Add allocation tests that assert malicious tiny files cannot declare huge dimensions and trigger giant canvas/ImageData allocation.
- Prefer small parser modules with pure tests over adding more logic to `raster-codecs.ts`.
- Document which formats are "inspection only", "reduced-scale editable", "tile-only", or "full editable".

Why this matters:

Image editors process attacker-controlled binary files. Bounds checks are both security and product-stability features.

### P2: Improve Bundle Ownership

The latest local bundle report has no violations, but it also shows little room for careless imports:

- `raster-decoders...js`: 1,414,672 bytes against a 1,500,000 byte chunk cap.
- `2247...js`: 1,314,961 bytes.
- `document-decoders...js`: 767,294 bytes.

Recommended work:

- Generate a source ownership report for chunk `2247...js`.
- Add a route/chunk analyzer artifact that maps large chunks back to source modules.
- Keep decoder imports conditional and feature-triggered.
- Add hover/focus preloading for heavy dialogs that users are likely to open from menus.
- Continue using `next/dynamic` and `React.lazy` for panels/dialogs, but verify that shared imports do not pull heavy codec modules into initial editor chunks.
- Reduce client components on the marketing route where interactivity is not required.

Why this matters:

The editor needs a large feature surface, but first interaction should not pay for every format, panel, codec, and advanced subsystem.

### P2: Separate Local Demo Persistence From Production Persistence

The marketing API routes are substantially hardened for a local JSONL store: body limits, schemas, origin checks, rate limits, record quotas, and serialized writes. That is appropriate for local/demo use.

For production, the assumptions change:

- `.data/*.jsonl` is not durable in serverless or multi-instance deployments.
- In-memory rate limiting is per process and can reset on deploy/restart.
- Dedupe by reading the JSONL file is acceptable at this size but not a production database pattern.

Recommended work:

- Document `.data` as local/demo storage.
- Add production adapters for a durable database, queue, or external email/feedback service.
- Use a shared rate-limit backend when deployed across multiple processes or serverless instances.
- Add retention/deletion policy documentation for subscriber and feedback records.
- Keep static export behavior explicit: Pages removes `app/api`, and UI should remain disabled or routed elsewhere.

Why this matters:

The same code can be correct locally and misleading in production if persistence semantics are not explicit.

### P2: Burn Down Lint Warnings And Hook Suppressions

Lint passes, but there are 22 `no-explicit-any` warnings:

- `components/photoshop/vector-path-operations.ts`: most warnings.
- `components/photoshop/menu-bar.tsx`: several menu payload warnings.
- `components/photoshop/layer-style-dialog.tsx`: one warning.

There are also 9 `eslint-disable-next-line react-hooks/exhaustive-deps` comments.

Recommended work:

- Replace vector path `any` usage with Paper.js-facing local interfaces or narrow adapter types.
- Replace menu payload `any` usage with typed command payload unions.
- Add a reason comment to each hook dependency suppression.
- Turn `reportUnusedDisableDirectives` back on once current suppressions are documented.
- Add `lint:strict` to CI once warnings reach zero.

Why this matters:

Warnings are useful only if they trend down. Otherwise they become background noise and real regressions hide inside them.

### P2: Expand Test Selection Strategy For PRs

CI currently runs lint, typecheck, capability check, architecture check, build, bundle analysis, and smoke tests on PRs. Full Playwright shards run only on pushes to `main`.

Recommended work:

- Add path-aware focused test selection for PRs:
  - `raster-codecs`, `document-io`, `psd-*` changes run file/format tests.
  - `canvas-view`, `brush`, `selection`, `filters` changes run canvas/filter/pixel subsets.
  - `editor-context`, history, lifecycle changes run document/history tests.
  - API/lib changes run security regression limits and route tests.
- Add a nightly or scheduled full Playwright run if pushes to `main` are not frequent enough.
- Keep the smoke suite under 60 seconds and no process leaks.
- Consider adding a smaller pure unit runner for algorithm modules if Playwright startup becomes a bottleneck.

Why this matters:

960 tests are too many for every local change, but smoke alone is too little for risky PRs.

### P2: Improve Accessibility And Keyboard Regression Gates

There are accessibility-related tests and an accessibility audit panel. The editor surface is dense enough that release gates should be more systematic.

Recommended work:

- Add keyboard tests for:
  - panel browser;
  - document tabs;
  - layer rows;
  - tool groups;
  - command palette;
  - custom context menu;
  - resize handles/separators;
  - dialogs with async submit/save states.
- Standardize focus restoration for every dialog opened from menu/command palette.
- Add touch target and non-overlap checks for the mobile editor shell.
- Add a small axe-based smoke on the home/editor surfaces if dependency weight is acceptable.

Why this matters:

Photoshop-like UIs are dense. Accessibility regressions will tend to be interaction-specific, not just missing labels.

### P3: Dependency Maintenance

`npm audit --audit-level=high` passed. The only reported issue was a low-severity `@babel/core` advisory with `npm audit fix` available.

Recommended work:

- Add Dependabot or Renovate for npm dependencies and GitHub Actions.
- Keep dependency updates batched by risk:
  - low-risk dev tooling;
  - Radix/lucide UI packages;
  - Next/React/compiler packages;
  - image/decoder packages.
- Run codec/file-format and smoke tests for decoder updates.
- Treat Next/React major upgrades as separate projects with bundle and hydration verification.

Why this matters:

Decoder and framework dependencies are high-impact. Update automation helps, but grouped verification is what makes it safe.

## Suggested Roadmap

### Immediate: 1-3 Days

- Switch local runtime to Node 22 and rerun `npm run doctor`.
- Fix `doctor` npm/Playwright checks so they reflect this Windows setup accurately.
- Migrate the easiest raw `ps-*` dispatches in command palette/menu/options to `dispatchPhotoshopEvent`.
- Lower raw event budget after the migration.
- Add timeout/abort cleanup tests for filter worker requests.
- Type the 22 current `any` warnings or document temporary exceptions.

### Short Term: 1-2 Weeks

- Build the storage key registry on top of `client-storage.ts`.
- Migrate preferences, shortcuts, recent colors, panel/workspace layout, and small presets first.
- Split command-only editor methods into a stable command context.
- Convert a small set of high-fanout panels from broad `useEditor()` to real selector/state-store access.
- Generate bundle source ownership for the 1.31 MB app chunk.
- Add path-aware PR test groups for core source areas.

### Medium Term: 1-2 Months

- Continue facade-first decomposition of `canvas-view.tsx`, `editor-context.tsx`, `menu-bar.tsx`, `document-io.ts`, and `raster-codecs.ts`.
- Ratchet oversize-file and `useEditor` budgets downward every time a slice lands.
- Add fuzz fixtures for import sniffers and decoder preflight.
- Add durable production persistence adapters for marketing APIs, or document that the API routes are local/demo only.
- Add accessibility keyboard release gates for panels, dialogs, tabs, and context menus.

### Longer Term

- Move toward a canonical render/export graph shared by editor preview, timeline, print, raster export, PSD export, tile-only mode, and WebGL paths.
- Replace the broad editor provider with smaller store-backed subscriptions.
- Keep browser limitations in `BOUNDARIES.md` current as advanced workflows evolve.
- Add scheduled full-suite and dependency-update verification.

## Success Metrics

Track these over time:

- Raw `ps-*` event dispatches outside `events.ts`: 217 -> 0.
- `useEditor` imports: 85 -> lower each sprint.
- Files over 1,500 lines: 26 -> lower each extraction pass.
- Top 10 largest files total line count: trending down.
- Lint warnings: 22 -> 0.
- Hook dependency suppressions: 9 -> documented and reduced.
- Smoke suite: 9+ tests, under 60 seconds locally, no leaked processes.
- Import cycles: 0.
- Largest non-decoder app chunk: under 1 MB.
- Storage keys: 100% registered, versioned, schema-validated.
- Full/targeted CI: risky PRs run relevant focused tests beyond smoke.

## Final Assessment

This codebase is not in a fragile prototype state. It has serious product depth, tests, browser-limit honesty, security hardening, and active architecture controls. The highest leverage work now is not feature expansion or broad rewriting. It is making the existing architecture controls stricter, finishing the typed-event and storage migrations, shrinking the largest orchestration files in small safe steps, and narrowing React subscriptions so the editor remains responsive as the feature surface keeps growing.
