# Codebase Analysis And Improvement Report

Generated: 2026-06-23

Scope: current working tree, including existing uncommitted and untracked files. I did not revert or normalize those changes.

## Executive Summary

This is a mature browser-native Photoshop-style editor built with Next.js 16, React 19, TypeScript, Canvas, workers, local browser storage, server API routes, and a broad Playwright regression suite. The codebase is not a prototype: strict lint, typecheck, capability reconciliation, architecture budgets, production build, bundle analysis, and no-webserver Playwright execution all passed in this review.

The current top risks are operational and architectural:

- Local runtime drift: `doctor` fails because the active environment is Node 25.2.1 and npm 11.6.2, while the repo pins Node `>=22 <23` and npm 11.5.2.
- Playwright webServer shutdown hangs on Windows in this local environment: smoke and static smoke print all tests as `ok`, then never exit before timeout.
- Architecture budgets pass but have no headroom: oversize files are 26/26, `useEditor` imports are 80/80, and top-ten largest file total is 36172/36172 lines.
- Large orchestration files remain the main maintainability risk, led by `canvas-view.tsx`, `editor-context.tsx`, `menu-bar.tsx`, `raster-codecs.ts`, `advanced-subsystems-dialog.tsx`, and `document-io.ts`.
- Event dispatch is now centralized, but listener ownership is still scattered: there are 0 raw `new CustomEvent("ps-...")` sites, but 92 raw `window.addEventListener("ps-...")` sites.

The strongest recent improvements are meaningful: raw Photoshop event dispatch is at zero, selector-backed editor hooks exist through `useSyncExternalStore`, storage governance is now mostly centralized, import/API hardening is extensive, and the CI/deploy workflows are materially stronger than a typical app of this size.

## Current Size Snapshot

Measured scope excluded generated/vendor/runtime-heavy paths: `.git`, `.next`, `.superpowers`, `.tocodex`, `artifacts`, `gsap-public`, `gsap-skills-main`, `node_modules`, `out`, `public/vendor`, `test-results`, and `tocodex-docs`.

| Area | Files | Lines |
| --- | ---: | ---: |
| Total measured scope | 619 | 221,795 |
| `components` | 395 | 177,727 |
| `components/photoshop` | 326 | 170,143 |
| `tests` | 133 | 27,244 |
| `docs` | 44 | 5,363 |
| `app` | 12 | 1,528 |
| `scripts` | 7 | 1,117 |
| `lib` | 3 | 360 |

| Extension | Files | Lines |
| --- | ---: | ---: |
| `.ts` | 361 | 123,066 |
| `.tsx` | 192 | 83,233 |
| `.json` | 6 | 7,244 |
| `.md` | 49 | 5,760 |
| `.mjs` | 9 | 1,366 |
| `.css` | 2 | 1,126 |

## Verification Results

| Command | Result | Notes |
| --- | --- | --- |
| `npm.cmd run doctor` | Failed | Node is 25.2.1, expected `>=22 <23`; npm is 11.6.2, expected `npm@11.5.2`. Other doctor checks passed. |
| `npm.cmd run lint:strict` | Passed | `eslint . --max-warnings=0`. |
| `npm.cmd run typecheck` | Passed | `tsc --noEmit`. |
| `npm.cmd run check:capabilities` | Passed | 72 capability records and 13 advanced-format entries scanned. |
| `npm.cmd run check:architecture -- --json` | Passed | Zero import cycles and all budgets passed. |
| `npm.cmd run build` | Passed | Next 16.2.6 webpack production build. |
| `npm.cmd run analyze:bundle` | Passed | 137 client chunks, 529.5 KiB initial JS, no bundle violations. |
| `npx.cmd playwright test --list` | Passed | 972 tests in 132 files discovered. |
| `npx.cmd playwright test tests/automation-engine.spec.ts --config=playwright.node.config.ts` | Passed | 4 no-webserver tests passed and exited normally. |
| `npm.cmd run test:smoke` | Timed out | All 9 smoke tests printed `ok`; Playwright did not exit before 240s. |
| `npm.cmd run test:static-export:smoke` | Timed out | Both static smoke tests printed `ok`; Playwright did not exit before 120s. |

Not run: full Playwright execution and npm audit. The full suite is 972 tests and is configured for CI sharding.

## Architecture Gate Snapshot

| Signal | Current | Budget | Status |
| --- | ---: | ---: | --- |
| Import cycles in `components/photoshop` | 0 | 0 | Passing |
| Raw `new CustomEvent("ps-...")` outside `events.ts` | 0 | 0 | Passing |
| Files over 1,500 lines | 26 | 26 | Passing, no headroom |
| `useEditor` import files | 80 | 80 | Passing, no headroom |
| Top 10 largest Photoshop files total | 36,172 lines | 36,172 lines | Passing, no headroom |

Largest Photoshop files:

| File | Lines |
| --- | ---: |
| `components/photoshop/canvas-view.tsx` | 6,442 |
| `components/photoshop/editor-context.tsx` | 4,833 |
| `components/photoshop/menu-bar.tsx` | 4,081 |
| `components/photoshop/raster-codecs.ts` | 3,804 |
| `components/photoshop/advanced-subsystems-dialog.tsx` | 3,530 |
| `components/photoshop/document-io.ts` | 3,141 |
| `components/photoshop/tool-helpers.ts` | 2,892 |
| `components/photoshop/filters/registry-helpers.ts` | 2,613 |
| `components/photoshop/advanced-subsystems.ts` | 2,458 |
| `components/photoshop/typography-engine.ts` | 2,378 |

## Strengths To Preserve

### Clear Browser Boundaries

`BOUNDARIES.md` is doing valuable product governance. It prevents impossible browser-native goals, proprietary Adobe service parity, exact native Photoshop algorithm parity, native plugin execution, certified CMM behavior, and pro codec guarantees from being mislabeled as ordinary backlog.

### Strong Guardrails

The repository now has meaningful automated gates: strict lint, typecheck, capability reconciliation, import-cycle checks, raw event budgets, file-size budgets, `useEditor` budgets, top-largest-file budgets, production build, bundle budgets, smoke tests, static export smoke, and CI sharding for full Playwright runs.

### Event Dispatch Centralization

The raw `CustomEvent("ps-...")` migration is complete according to the architecture gate. `components/photoshop/events.ts` gives a typed `PhotoshopEventMap`, `dispatchPhotoshopEvent`, and `addPhotoshopEventListener`. This is a major reduction in stringly typed command dispatch risk.

### Real Selector Infrastructure

`editor-context.tsx` now exposes `useEditorSelector` backed by `useSyncExternalStore`, and `tests/architecture-gates.spec.ts` verifies that key helper hooks avoid broad `useEditor()` reads. The next challenge is adoption, not proving the pattern.

### Storage Governance

`client-storage.ts` provides a registry, privacy classes, fallbacks, parsing, write result types, and privacy-class clearing. Direct source storage calls outside the adapter are now very low: I found only three direct `sessionStorage` calls for learning-query handoff in `discover-panel.tsx` and `tool-palette.tsx`.

### Security And Import Hardening

The app has many concrete safeguards: CSP headers, proxy nonce support, zod schemas, request body caps, origin checks, rate limits, upstream generative-fill timeouts and byte caps, canvas/file size caps, PSD/raster header sniffing, plugin manifest normalization, plugin JSON bounds, iframe sandboxing, and project import limit tests.

### Broad Test Surface

The test suite lists 972 tests across 132 files. Coverage includes canvas behavior, filters, PSD/file handling, editor lifecycle, accessibility, security limits, performance paths, panels, automation, static export, and workflow depth.

## Priority Recommendations

### P1: Fix Local Runtime Drift And Smoke Command Shutdown

First switch local verification to Node 22 and npm 11.5.2. The current Node 25/npm 11.6 environment is outside the repo contract and may be contributing to the Playwright webServer hang.

Then debug the webServer lifecycle separately. Both `playwright.smoke.config.ts` and `playwright.static.config.ts` print all tests as passing, but the commands do not exit. A no-webserver Playwright slice exits normally, so the problem is likely webServer shutdown on Windows, not test assertions.

Recommended fixes:

- Reproduce under Node 22 before changing test code.
- Add a small Windows-focused check for `scripts/serve-next-smoke.mjs` and `scripts/serve-static.mjs` termination.
- Consider avoiding shell-mediated webServer teardown on Windows by starting/stopping the server in a wrapper script or by using an explicit process-tree cleanup strategy.
- Keep CI on Node 22, and treat local smoke as inconclusive until the command exits with status 0.

### P1: Ratchet Architecture Budgets Down After Every Improvement

The gate passes, but several budgets are exact baselines:

- 26 oversize files allowed, 26 present.
- 80 `useEditor` import files allowed, 80 present.
- 36,172 top-ten lines allowed, 36,172 present.

This is useful as a regression stop, but it does not create downward pressure. After each extraction or selector migration, reduce the corresponding budget in the same PR.

### P1: Continue Moving Consumers To Selector Hooks

The selector infrastructure exists, but 80 files still import `useEditor`. Focus on high-fanout UI first:

- layers, properties, history, tool palette, options bar, status bar;
- command palette and menu bar;
- dialogs that only need one document/layer/settings slice.

Separate command-only APIs from render state so components that only dispatch actions do not re-render on unrelated editor state changes.

### P1: Decompose The Largest Orchestration Files

Do not rewrite these files wholesale. Continue facade-preserving extractions with characterization tests:

- `canvas-view.tsx`: pointer lifecycle, viewport geometry, overlay state, transform handlers, text-edit overlay, tool-specific input.
- `editor-context.tsx`: action families, lifecycle side effects, persistence, history compression/restore, action playback, layer operations.
- `menu-bar.tsx`: menu definitions, command routing, file workflows, plugin workflows, dialog launch state.
- `raster-codecs.ts`: split by format family and keep shared binary helpers small.
- `advanced-subsystems-dialog.tsx`: plugin manager, 3D/video surfaces, import/export helpers, sandboxed panel UI.
- `document-io.ts`: keep shrinking into rendering, serialization, PSD, raster, and export-specific modules.

### P1: Finish Event Listener Migration

Dispatch is typed, but listener registration still has hidden coupling. I found 92 raw `window.addEventListener("ps-...")` sites versus 37 typed `addPhotoshopEventListener` hits.

Recommended work:

- Replace app-level raw listeners with `addPhotoshopEventListener`.
- Add an architecture budget for raw `window.addEventListener("ps-...")` outside `events.ts`.
- Keep native browser events such as `keydown`, `pointermove`, `resize`, and `beforeunload` out of that rule.

### P2: Improve Bundle Ownership For Large Shared Chunks

The bundle gate passes, but the largest chunks deserve clearer attribution:

- `raster-decoders...js`: 1,414,672 bytes.
- `2247...js`: 1,317,454 bytes.
- `document-decoders...js`: 767,294 bytes.
- Initial JS: 542,230 bytes.

`artifacts/bundle-report.json` cannot attribute the 1.29 MiB `2247...js` shared/dynamic chunk to source modules. Add sourcemap or webpack-stats based ownership so regressions can be assigned to real files, then aim to bring the largest non-decoder app chunk below 1 MiB.

### P2: Keep Production Persistence Explicit

`lib/marketing-store.ts` is reasonable for local/demo use: schemas, byte caps, quotas, origin checks, and rate limits are present. It is still process-local and filesystem-local. The existing `docs/deployment-persistence.md` is correct; keep linking it from deployment docs and add a real adapter before production use.

### P2: Harden Plugin Message Boundaries Further

The plugin system is carefully bounded with manifest limits, safe JSON, permissions, token/source validation, storage quotas, and sandboxed iframes. Still, this is a high-risk integration boundary.

Recommended work:

- Add more tests for forged `postMessage` payloads, wrong source windows, wrong tokens, over-depth JSON, storage quota exhaustion, and unsafe panel HTML.
- Document why `postMessage(..., "*")` is required for `srcdoc`/sandbox behavior, or replace with a `MessageChannel` if practical.
- Keep native 8BF execution firmly metadata-only unless a browser-safe kernel/WASM adapter is explicitly reviewed.

### P2: Make Static Export Runtime Differences Impossible To Miss

GitHub Pages export removes `app/api`, and proxy/security headers do not run in static hosting. The project already disables backend-dependent marketing forms in static export. Keep these differences explicit in docs and tests so static deploys do not imply server-route or CSP-proxy coverage.

### P2: Add Path-Aware PR Test Selection

CI runs strong generic gates and smoke tests on PRs, with full Playwright shards on pushes to `main`. Add path-aware targeted tests for risky areas:

- `document-io`, `raster-codecs`, `psd-*`: format/import/export tests.
- `canvas-view`, brush, selection, filters: canvas/pixel/performance tests.
- `editor-context`, history, lifecycle: document/history tests.
- `app/api`, `lib/marketing-store`, plugin system: security regression tests.

### P3: Reduce Remaining Suppressions And Interop Exceptions

There are no `TODO`, `FIXME`, `HACK`, `XXX`, `@ts-ignore`, `@ts-expect-error`, or `dangerouslySetInnerHTML` hits in source. There are 9 `react-hooks/exhaustive-deps` suppressions and one actual `new Function` interop point in `raster-codecs.ts` for Node-side dynamic import of `@jsquash/jpeg`.

Recommended work:

- Document each hook suppression with a specific invariant, or remove it.
- Keep the `new Function` site isolated and covered by tests so it does not become a general script-evaluation pattern.

## Suggested Roadmap

### Immediate

- Switch to Node 22/npm 11.5.2 and rerun `doctor`, smoke, and static smoke.
- Fix or document the Windows Playwright webServer hang.
- Add a raw `ps-*` listener budget.
- Lower any architecture budget immediately after a successful migration.

### Short Term

- Migrate the first batch of raw `ps-*` listeners to `addPhotoshopEventListener`.
- Move high-fanout panels from direct `useEditor` to selector hooks.
- Extract one coherent slice each from `menu-bar.tsx`, `editor-context.tsx`, and `canvas-view.tsx`.
- Add bundle source ownership for the 1.29 MiB shared chunk.

### Medium Term

- Continue shrinking the 26 oversize files and ratchet budgets down.
- Add path-aware PR test selection.
- Expand plugin boundary and decoder fuzz tests.
- Introduce a production persistence adapter or keep API routes explicitly local/demo only.

## Success Metrics

- `doctor` passes on local machines and CI-equivalent environments.
- `test:smoke` and `test:static-export:smoke` exit with status 0 on Windows.
- Raw `ps-*` listeners trend from 92 toward 0.
- `useEditor` import files trend from 80 downward.
- Files over 1,500 lines trend from 26 downward.
- Top-ten largest file total trends below 36,172.
- Largest non-decoder app chunk trends below 1 MiB.
- Direct source storage calls remain registry-backed, except intentional transient session keys.
- Import cycles remain 0.
- Lint warnings remain 0.

## Final Assessment

The codebase is in good shape for incremental improvement. Its main weakness is not missing feature coverage; it is concentration of responsibility in very large files and operational sharp edges around local verification. Keep the current facade-first refactor direction, keep ratcheting budgets downward, and fix the Windows smoke-test shutdown so local verification can be trusted again.
