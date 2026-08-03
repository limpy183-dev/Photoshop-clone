# Codebase Analysis And Improvement Report

Generated: 2026-06-22

Reviewer: Codex

Branch inspected: `refactor/decompose-god-files`

Base commit inspected: `f6c667e`

Scope: current working tree, including uncommitted and untracked files. I did not overwrite the existing `docs/codebase-analysis-report-2026-06-22.md`; this report is a fresh companion pass.

## Executive Summary

This is a large, serious browser-native Photoshop-style editor built on Next.js 16, React 19, TypeScript, Canvas, workers, browser storage, Playwright, and a broad Photoshop-inspired workflow surface. The codebase is not in prototype shape: strict lint passes with zero warnings, typecheck passes, production build passes, smoke tests pass, static export smoke passes, capability reconciliation passes, import-cycle gates pass, bundle budgets pass, and the browser limitation boundaries are clearly documented.

The main risk is still scale control. The app has about 221k measured source/docs/config lines, with about 177k under `components/` and about 170k TypeScript/TSX lines under `components/photoshop`. The largest orchestration files remain very large, and the architecture budgets now pass with no spare room:

- Raw `ps-*` CustomEvent budget: 196/196.
- Oversize Photoshop files: 26/26.
- `useEditor` imports: 85/85.
- Top-ten largest Photoshop files: 36,180/36,180 lines.

The right next phase is not a rewrite. Keep the current facades stable and continue tightening the system around them: typed event contracts, real selector-style editor subscriptions, centralized client storage governance, staged decomposition of the largest files, chunk ownership reporting, and production-grade persistence/rate limiting for server APIs.

No confirmed P0 product defect was found during this pass. The highest-priority operational issue is local environment drift: `npm run doctor` fails because the active runtime is Node 25.2.1 while the repository requires Node `>=22 <23`.

## Scope And Method

Reviewed:

- App shell and routing: `app/`, `app/editor`, `app/api`, `app/layout.tsx`.
- Editor runtime: `components/photoshop`.
- UI and marketing: `components/ui`, `components/marketing`.
- Storage and API support: `lib/marketing-store.ts`, local client storage modules, IndexedDB/localStorage paths.
- Build, CI, and test configuration: `package.json`, `next.config.mjs`, `proxy.ts`, Playwright configs, GitHub workflows, scripts.
- Existing docs and review artifacts: `README.md`, `CLAUDE.md`, `BOUNDARIES.md`, existing reports/backlog docs.

Static metrics excluded generated/vendor-heavy paths:

- `.git`, `.next`, `.superpowers`, `.tocodex`, `artifacts`, `gsap-public`, `gsap-skills-main`, `node_modules`, `out`, `public/vendor`, `test-results`, `tocodex-docs`.

## Verification Results

| Command | Result | Notes |
| --- | --- | --- |
| `npm.cmd run doctor` | Failed | Current Node is `25.2.1`; repo expects `>=22 <23`. npm, node_modules, Playwright CLI, and browser cache checks passed. |
| `npm.cmd run lint` | Passed | No warnings emitted. |
| `npm.cmd run lint:strict` | Passed | `eslint . --max-warnings=0` passed. |
| `npm.cmd run typecheck` | Passed | `tsc --noEmit` passed. |
| `npm.cmd run check:capabilities` | Passed | 72 capability records and 13 advanced-format entries scanned. |
| `npm.cmd run check:architecture -- --json` | Passed | Zero import cycles; all budgets pass. |
| `npm.cmd run build` | Passed | Next 16.2.6 webpack production build completed. |
| `npm.cmd run analyze:bundle` | Passed | 137 client chunks, 529.5 KiB initial JS, no budget violations. |
| `npx.cmd playwright test --list` | Passed | 966 tests in 132 files listed. |
| `npx.cmd playwright test --config=playwright.smoke.config.ts --list` | Passed | 9 smoke tests in 1 file listed. |
| `npm.cmd run test:smoke` | Passed | 9 tests passed in 10.8 seconds. |
| `npm.cmd run test:static-export:smoke` | Passed | 2 tests passed against existing `out/`. |
| `npm.cmd audit --audit-level=high` | Passed | One low-severity `@babel/core` advisory remains. |

Not run:

- Full Playwright execution. The suite lists 966 tests and is configured for CI sharding.
- A dedicated security scan. Security-related code was reviewed only as part of general codebase analysis.

## Current Health Snapshot

Measured source/docs/config scope:

| Area | Files | Lines |
| --- | ---: | ---: |
| Total measured scope | 616 | 221,241 |
| `components` | 392 | 177,518 |
| `components/photoshop` TS/TSX | 324 | 169,955 |
| `tests` | 133 | 27,112 |
| `docs` | 43 | 5,036 |
| `app` | 12 | 1,528 |
| `scripts` | 7 | 1,097 |
| `lib` | 3 | 360 |

By extension:

| Extension | Files | Lines |
| --- | ---: | ---: |
| `.ts` | 359 | 122,589 |
| `.tsx` | 191 | 83,321 |
| `.json` | 5 | 7,243 |
| `.md` | 47 | 5,431 |
| `.mjs` | 9 | 1,346 |
| `.css` | 2 | 1,126 |

Architecture gate snapshot:

| Signal | Current | Budget | Status |
| --- | ---: | ---: | --- |
| Import cycles in `components/photoshop` | 0 | 0 | Passing |
| Raw Photoshop `ps-*` events outside `events.ts` | 196 | 196 | Passing, no headroom |
| Files over 1,500 lines | 26 | 26 | Passing, no headroom |
| `useEditor` imports | 85 | 85 | Passing, no headroom |
| Top 10 largest Photoshop files total | 36,180 lines | 36,180 lines | Passing, no headroom |

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

Source pattern scan:

| Pattern | Count | Interpretation |
| --- | ---: | --- |
| `"use client"` | 177 | Expected for editor-heavy UI, but still worth watching on marketing/docs surfaces. |
| `localStorage` | 168 | Storage adapter exists, but migration is incomplete. |
| `sessionStorage` | 3 | Low. |
| `indexedDB` | 11 | Used for larger local artifacts. |
| `new CustomEvent` | 207 | Typed event helper exists, but raw app events remain widespread. |
| `window.dispatchEvent` | 207 | Hidden coupling remains a major architecture signal. |
| `window.addEventListener` | 176 | Listener ownership is distributed. |
| `window.removeEventListener` | 171 | Mostly paired, but still scattered. |
| `eslint-disable` | 9 | All are hook dependency suppressions in source. |
| `@ts-ignore` / `@ts-expect-error` | 0 | Strong TypeScript hygiene. |
| `TODO` / `FIXME` / `HACK` / `XXX` | 0 | Good backlog hygiene in source. |

Bundle snapshot from `artifacts/bundle-report.json` generated during this pass:

- Client chunks: 137.
- Initial JS: 542,230 bytes, reported by script as 529.5 KiB.
- Largest chunk: `raster-decoders...js`, 1,414,672 bytes.
- Largest non-decoder app chunk: `2247...js`, 1,316,597 bytes.
- `document-decoders...js`: 767,294 bytes.
- Bundle violations: none.

## Strengths To Preserve

### Explicit Browser Boundaries

`BOUNDARIES.md` is valuable. It prevents impossible or legally risky "native Photoshop parity" work from being treated as backlog. Keep routing new feature requests through that document before accepting work on Adobe cloud services, native plugin runtimes, certified color management parity, proprietary algorithm parity, or professional codec guarantees beyond browser APIs.

### Strong Quality Gates

The repo now has strict lint, TypeScript, capability reconciliation, architecture budgets, production build, bundle analysis, smoke tests, static export smoke, and CI workflows. This is the right direction for a codebase with a large product surface.

### Architecture Budgets Are Working

The project now has a concrete `scripts/check-architecture.mjs` gate that catches import cycles, raw app events, oversize files, `useEditor` fanout, and top-largest-file total growth. That is better than subjective review comments because it creates a measurable trend.

### Recent Improvement Since Older Reports

Several older concerns are now improved or resolved in this working tree:

- Import cycles in `components/photoshop` are zero.
- Lint is clean even under `--max-warnings=0`.
- Smoke coverage is now 9 tests instead of a single shell test.
- Static export smoke exists and passes.
- Worker/export cancellation primitives now include `AbortSignal` and timeout support.
- `events.ts` and `client-storage.ts` provide the right centralization points, even though migration is incomplete.

### Security And Bounds Checks Are Material

API routes have zod schemas, body limits, origin checks, rate limiting, store quotas, bounded upstream reads, and conservative error handling. CSP headers and per-request nonce handling are present. File/import paths include many limits and compatibility reports. This is a good baseline for a browser editor that processes untrusted images and project data.

### Test Surface Is Broad

The Playwright suite lists 966 tests across 132 files. Coverage includes filters, canvas behavior, panels, PSD/file workflows, history, security regression limits, static export, performance, pixel behavior, and workflow depth.

## Priority Recommendations

### P1: Run And Verify Under Node 22

`npm run doctor` fails because the active runtime is Node `25.2.1`, while `package.json`, `.nvmrc`, `.node-version`, docs, and CI require Node `>=22 <23`.

Recommended work:

- Switch local development and verification to Node 22 before treating results as CI-equivalent.
- Keep `doctor` in CI or pre-PR guidance so future agents do not silently verify under the wrong runtime.
- Consider checking the npm major against `packageManager: npm@11.5.2`, not only availability.

Why this matters:

Next, TypeScript, Playwright, and package postinstall behavior can differ across Node majors. A passing build under Node 25 is useful, but the project contract is Node 22.

### P1: Ratchet Architecture Budgets Down, Not Just Sideways

The architecture gate passes, but several budgets exactly equal current counts.

Recommended work:

- Reduce `rawPhotoshopEvents.max` after each event migration batch.
- Reduce `useEditorImports.max` after each selector/context migration.
- Reduce `oversizeFiles.max` after each extraction.
- Reduce `topLargestFiles.maxTotalLines` after meaningful decomposition.
- Add a short note in PRs when a budget is intentionally raised.

Why this matters:

High-watermark budgets prevent regression, but exact baselines create no improvement pressure. This codebase needs the trend to move down.

### P1: Complete The Typed Event Migration

`components/photoshop/events.ts` is a good central contract. It defines `PhotoshopEventMap`, `dispatchPhotoshopEvent`, and `addPhotoshopEventListener`. Migration remains incomplete.

Evidence:

- Architecture gate reports 196 raw `ps-*` events outside `events.ts`.
- Source scan found 207 `new CustomEvent` and 207 `window.dispatchEvent` hits.
- Highest raw event concentration is still in `command-palette.tsx`, `menu-bar.tsx`, `algorithmic-operations-dialog.tsx`, and `options-bar.tsx`.
- Some event names in callers are not yet represented in `PhotoshopEventMap`, for example plugin/image-assets/workspace-manager style events.

Recommended work:

- Expand `PhotoshopEventMap` until every app-level `ps-*` event is represented.
- Replace raw `window.dispatchEvent(new CustomEvent("ps-..."))` with `dispatchPhotoshopEvent`.
- Replace raw app-event listeners with `addPhotoshopEventListener`.
- Add a script or ESLint rule that rejects new raw `CustomEvent("ps-...")` outside `events.ts`.
- Standardize async event envelopes with `commandId`, `docId`, `correlationId`, and `createdAt`.

Why this matters:

The event surface connects menus, command palette, panels, shortcuts, plugin flows, dialogs, and canvas behavior. Keeping it stringly typed makes refactors risky.

### P1: Replace Broad Editor Context Reads With Real Selector Subscriptions

`editor-context.tsx` now exposes helper hooks such as `useActiveDocument`, `useActiveLayer`, `useToolState`, `useDocumentLifecycle`, and `useHistoryState`. That is a useful API direction, but the helpers still call `useEditor()`, so they still subscribe to the full context value.

Evidence:

- Architecture gate reports 85 imports of `useEditor`.
- Source scan found 132 `useEditor(` call sites.
- Most panels and dialogs consume the broad provider.

Recommended work:

- Introduce real selector-style state access using `useSyncExternalStore`, or split editor state into narrower contexts.
- Separate command-only APIs from render state so components that only dispatch do not re-render on state changes.
- Start with high-fanout panels that read a small subset of state: layers, history, properties, options, status, tool palette, and command palette.
- Add render-count regression tests for high-frequency interactions: brush size drag, zoom, history push, panel switching, and active layer changes.

Why this matters:

This is a high-frequency canvas app. Unnecessary React invalidation will become more expensive as the editor grows.

### P1: Finish Client Storage Governance

`client-storage.ts` is the right foundation: registered keys, version, privacy class, fallback values, safe reads/writes, and privacy-based clearing. Adoption is incomplete.

Evidence:

- Source scan still found 168 `localStorage` hits.
- Direct storage remains in camera raw, adjustment dialogs, automation, command ranking, command palette, editor app, panel dock, preferences, preset stores, swatches, glyphs, notes, workspace layouts, start workspace, and tests.
- Multiple storage backends are in use: `localStorage`, `sessionStorage`, IndexedDB, OPFS-like scratch paths, and `.data` JSONL API files.

Recommended work:

- Register every persisted key in `CLIENT_STORAGE_KEYS` or a family-specific registry.
- Add schema validation for all persisted payloads, not only ad hoc normalizers.
- Add explicit migration functions for renamed/legacy keys.
- Add tests for quota exceeded, disabled storage, malformed JSON, and private browsing behavior.
- Add a complete "clear local editor data" UX by privacy class:
  - preferences;
  - project data;
  - autosave/recovery;
  - presets/libraries;
  - automation/plugin data;
  - diagnostics/history.

Why this matters:

Local-first image editing can store sensitive user images and project metadata. Storage lifecycle and privacy controls need to be first-class.

### P1: Continue Decomposing The Largest Orchestration Files

The largest files are not only long; they coordinate many unrelated responsibilities.

Recommended extraction targets:

- `canvas-view.tsx`: pointer lifecycle, viewport geometry, overlay rendering, transform interactions, text overlay, tool-specific input, and render subscription handling.
- `editor-context.tsx`: action families, history compression/restore, document lifecycle, settings persistence, action recording, layer operations, transform operations, and provider side effects.
- `menu-bar.tsx`: menu definitions, command routing, file workflows, plugin workflows, advanced workflows, and dialog state.
- `raster-codecs.ts`: TIFF/BigTIFF, Netpbm/TGA, EXR, HEIF/AVIF, JPEG 2000, RAW/DNG, and metadata injection.
- `advanced-subsystems-dialog.tsx`: plugin workspace, 3D/video sections, import/export helpers, and sandbox UI.
- `document-io.ts`: keep shrinking via neutral render/serialization/export modules.

Recommended guardrail:

- Keep existing facade import paths stable until consumers are migrated.
- Add characterization tests before moving behavior that is not already covered.
- Lower the oversize-file and top-largest-file budgets after each extraction.

Why this matters:

The codebase can keep growing only if the review surface stays bounded. The current largest files are still conflict-prone and hard to reason about.

### P1: Build Source Ownership For The 1.29 MiB App Chunk

The bundle budget passes, but there is still a large non-decoder app chunk.

Evidence:

- `2247...js`: 1,316,597 bytes.
- `raster-decoders...js`: 1,414,672 bytes, close to the 1.5 MB chunk budget.
- Initial JS is acceptable at 542,230 bytes, but accidental imports can quickly change that.

Recommended work:

- Generate a chunk-to-source ownership report for the large app chunk.
- Keep heavy codecs and advanced workflows behind dynamic imports.
- Add hover/focus preloading for expensive dialogs opened from menus when it improves perceived speed.
- Reduce client components on marketing pages where interactivity is not required.
- Keep `optimizePackageImports` current for common package barrels.

Why this matters:

The editor needs many features, but first interaction should not pay for every codec, panel, and advanced subsystem.

### P1: Make Production Persistence Semantics Explicit

The marketing API storage is hardened for local/demo use. It is not a durable production backend.

Evidence:

- Records write to `.data/*.jsonl`.
- Writes are serialized only within a single Node process.
- Rate limiting is in-memory.
- Dedupe reads the local JSONL store.

Recommended work:

- Keep `docs/deployment-persistence.md` current and link it from API/README deployment sections.
- Add a production persistence adapter for subscribers and feedback if this site is deployed beyond demo/local use.
- Use a shared rate-limit backend in multi-process/serverless deployments.
- Add retention/deletion policy text for subscriber and feedback records.
- Keep static export behavior explicit: `app/api` is removed for GitHub Pages, and API-dependent UI must remain disabled or routed elsewhere.

Why this matters:

The current API code is reasonable locally. The risk is someone assuming the same semantics are durable across serverless instances or deploy restarts.

## Secondary Recommendations

### P2: Propagate Worker Cancellation To More UI Workflows

The filter and raster export worker modules now expose `AbortSignal` and timeout support. The next step is making user-facing flows consistently use it.

Recommended work:

- Pass cancellation signals from long-running dialogs and progress UIs.
- Add tests for cancel-after-dispatch, worker timeout, worker fatal error, and fallback behavior.
- Confirm pending requests are cleaned up after normal resolution, timeout, abort, and worker error.

### P2: Add More Import/Decoder Fuzz Fixtures

The codebase already has many limits and import hardening tests. Continue making every decoder path cheap to reject before allocating large buffers.

Recommended work:

- Add malformed/oversized fixtures for PSD/PSB headers, TIFF IFDs, ISO-BMFF boxes, JPEG markers, WebP chunks, EXR headers, JPEG 2000 codestreams, RAW/DNG metadata, and project JSON.
- Assert malicious tiny files cannot declare huge dimensions and trigger giant canvas/ImageData allocation.
- Prefer small parser modules with pure tests over adding more logic to `raster-codecs.ts`.

### P2: Add Path-Aware PR Test Selection

CI runs strong generic gates and smoke on PRs; full Playwright shards run on pushes to `main`.

Recommended work:

- Route risky file changes to focused test groups:
  - `document-io`, `raster-codecs`, `psd-*`: format and import/export tests.
  - `canvas-view`, `brush`, `selection`, `filters`: canvas/filter/pixel tests.
  - `editor-context`, history, lifecycle: document/history tests.
  - `app/api`, `lib/marketing-store`: security regression and route tests.
- Keep smoke under 60 seconds locally.
- Add scheduled full-suite runs if `main` pushes are not frequent enough.

### P2: Expand Accessibility And Keyboard Gates

The project has accessibility-related tests and an audit panel, but dense editor surfaces need interaction-specific coverage.

Recommended work:

- Add keyboard tests for panel browser, document tabs, layer rows, command palette, tool groups, context menu, resize handles, and dialogs.
- Standardize focus restoration for menu/command-palette launched dialogs.
- Add mobile non-overlap/touch target checks for the editor shell.
- Consider a small axe-based smoke if dependency weight is acceptable.

### P2: Keep Static Export And Server Deployment Separate

The Pages workflow removes `app/api` before static export and static smoke passes. Continue treating GitHub Pages as a separate runtime shape.

Recommended work:

- Make it obvious in docs that Next proxy/security headers do not apply to GitHub Pages static hosting.
- Keep basePath asset checks in CI.
- Keep API-dependent features disabled in static export unless an external backend is configured.

### P2: Dependency Maintenance

`npm audit --audit-level=high` passed. One low-severity `@babel/core` advisory remains.

Recommended work:

- Add Dependabot or Renovate if not already planned.
- Batch updates by risk: dev tooling, Radix/lucide UI, Next/React/compiler, image/decoder libraries.
- Treat decoder and framework updates as test-heavy changes.

### P2: shadcn/UI Consistency Sweep

The project uses shadcn-style primitives and a custom Photoshop chrome. The custom chrome is appropriate, but UI consistency can drift in a codebase this large.

Recommended work:

- Prefer existing `components/ui` primitives for new generic controls.
- Use semantic tokens and CSS variables where possible.
- Keep dialog title/description semantics consistent.
- Avoid adding more custom one-off form/control markup unless the Photoshop-style surface truly needs it.

## Suggested Roadmap

### Immediate: 1-3 Days

- Switch local runtime to Node 22 and rerun `npm run doctor`.
- Migrate the easiest raw event callers in `command-palette.tsx`, `menu-bar.tsx`, and `options-bar.tsx` to `dispatchPhotoshopEvent`.
- Lower the raw event budget after that migration.
- Add or confirm tests for filter/export worker timeout and abort behavior.
- Add a short chunk ownership report for `2247...js`.

### Short Term: 1-2 Weeks

- Expand `CLIENT_STORAGE_KEYS` coverage and migrate preferences, shortcuts, recent colors, panel layout, command usage, and small presets first.
- Introduce a real selector-backed editor store or narrower contexts for high-fanout panels.
- Split command-only editor methods away from broad render state.
- Continue facade-preserving extraction from `menu-bar.tsx`, `editor-context.tsx`, and `document-io.ts`.
- Add path-aware PR test groups for core source areas.

### Medium Term: 1-2 Months

- Continue decomposing `canvas-view.tsx`, `raster-codecs.ts`, `advanced-subsystems-dialog.tsx`, and high-line-count panels.
- Ratchet file-size, `useEditor`, raw-event, and top-largest-file budgets downward after each slice.
- Add more decoder/header fuzz fixtures.
- Add durable production persistence adapters or keep API routes explicitly documented as local/demo only.
- Add keyboard/accessibility release gates for dense editor surfaces.

### Longer Term

- Move toward a canonical render/export graph shared by editor preview, timeline, print, raster export, PSD export, tile-only mode, and WebGL paths.
- Replace broad editor-provider subscriptions with store-backed selector subscriptions.
- Keep browser limitations in `BOUNDARIES.md` current as advanced workflows evolve.
- Add scheduled full-suite and dependency-update verification.

## Success Metrics

Track these over time:

- Raw `ps-*` event dispatches outside `events.ts`: 196 -> 0.
- `useEditor` imports: 85 -> lower every migration batch.
- Files over 1,500 lines: 26 -> lower every extraction pass.
- Top 10 largest Photoshop files total: 36,180 lines -> trending down.
- Source `localStorage` hits: 168 -> mostly registry-backed wrappers/tests only.
- Lint warnings: stay at 0.
- Hook dependency suppressions: 9 -> documented and reduced.
- Import cycles: stay at 0.
- Smoke suite: 9+ tests, under 60 seconds locally, no process leaks.
- Largest non-decoder app chunk: 1,316,597 bytes -> below 1 MB.
- Storage keys: 100% registered, versioned, schema-validated.
- Full/targeted CI: risky PRs run relevant focused tests beyond smoke.

## Final Assessment

This codebase has strong foundations: honest browser boundaries, a serious test surface, real quality gates, typed TypeScript, tightened security headers, hardened API handling, and improving architecture controls. The next highest-leverage work is disciplined reduction of hidden coupling and concentration: migrate event and storage contracts fully, narrow editor subscriptions, keep decomposing giant orchestration files, and make bundle/persistence ownership explicit.

The project is in a good place to improve incrementally. Avoid broad rewrites; the current facade-first direction is the right one.
