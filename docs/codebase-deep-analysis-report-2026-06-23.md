# Deep Codebase Analysis And Improvement Report

Generated: 2026-06-23

Scope: current working tree at `C:\Users\damia\Desktop\AI_Projects\Photoshop\Claude_code_Pohotoshop_continuingfromopus4.7`. Generated/runtime-heavy paths were excluded from size measurements: `.git`, `.next`, `.superpowers`, `.tocodex`, `artifacts`, `gsap-public`, `gsap-skills-main`, `node_modules`, `out`, `public/vendor`, `test-results`, and `tocodex-docs`.

## Executive Summary

This is a substantial browser-native Photoshop-style editor, not a small prototype. The repo has a mature Next.js/React/TypeScript application, a very large editor domain under `components/photoshop`, browser-aware file and format handling, plugin compatibility shims, static export support, security and architecture gates, and a broad Playwright suite.

The strongest parts of the codebase are the explicit browser-boundary documentation, typed event and storage governance, test coverage, import/file hardening, plugin manifest normalization, CI coverage, and architecture gates. The main risks are now concentration of responsibility in large orchestration files, limited headroom in architecture budgets, broad editor-context subscriptions, and local runtime drift.

The most important current operational finding: `npm run doctor` fails because this shell is using Node `25.2.1`, while the project requires Node `>=22 <23`. npm is correct at `11.5.2`. Because of that same runtime check, `npm run build` stops before running the production build locally. Lint, typecheck, architecture checks, capability checks, bundle analysis, smoke tests, static smoke tests, and focused Node Playwright slices all pass.

## Current Snapshot

Measured text inventory:

| Area | Files | Lines |
| --- | ---: | ---: |
| Total measured text scope | 627 | 223,742 |
| `components` | 397 | 177,774 |
| `tests` | 135 | 27,503 |
| `docs` | 45 | 5,542 |
| `app` | 12 | 1,528 |
| `scripts` | 10 | 1,411 |
| `lib` | 3 | 360 |

Primary extensions:

| Extension | Files | Lines |
| --- | ---: | ---: |
| `.ts` | 365 | 123,380 |
| `.tsx` | 192 | 83,177 |
| `.json` | 5 | 7,254 |
| `.md` | 48 | 5,907 |
| `.mjs` | 12 | 1,654 |
| `.css` | 2 | 1,126 |

Architecture gate snapshot:

| Signal | Current | Budget | Status |
| --- | ---: | ---: | --- |
| Import cycles in `components/photoshop` | 0 | 0 | Passing |
| Raw `new CustomEvent("ps-*")` outside `events.ts` | 0 | 0 | Passing |
| Raw `window.addEventListener("ps-*")` outside typed event helper | 0 | 0 | Passing |
| Direct client storage files outside adapter | 0 | 0 | Passing |
| Files over 1,500 lines | 25 | 25 | Passing, no headroom |
| Broad `useEditor` import files | 74 | 74 | Passing, no headroom |
| Top 10 largest Photoshop files total | 36,108 lines | 36,108 lines | Passing, no headroom |

Largest Photoshop files by architecture gate line count:

| File | Lines |
| --- | ---: |
| `components/photoshop/canvas-view.tsx` | 6,435 |
| `components/photoshop/editor-context.tsx` | 4,833 |
| `components/photoshop/menu-bar.tsx` | 4,026 |
| `components/photoshop/raster-codecs.ts` | 3,804 |
| `components/photoshop/advanced-subsystems-dialog.tsx` | 3,528 |
| `components/photoshop/document-io.ts` | 3,141 |
| `components/photoshop/tool-helpers.ts` | 2,892 |
| `components/photoshop/filters/registry-helpers.ts` | 2,613 |
| `components/photoshop/advanced-subsystems.ts` | 2,458 |
| `components/photoshop/typography-engine.ts` | 2,378 |

## Verification Results

| Command | Result | Notes |
| --- | --- | --- |
| `node -v; npm -v` | Completed | Node `25.2.1`; npm `11.5.2`. |
| `npm.cmd run doctor` | Failed | Node is outside required `>=22 <23`; npm/package manager/Playwright checks passed. |
| `npm.cmd run lint:strict` | Passed | ESLint with `--max-warnings=0`. |
| `npm.cmd run typecheck` | Passed | `tsc --noEmit`. |
| `npm.cmd run check:capabilities` | Passed | 72 capability records and 13 advanced-format entries scanned. |
| `npm.cmd run check:architecture -- --json` | Passed | Zero cycles, raw events, raw listeners, and direct storage violations. |
| `npm.cmd run build` | Failed prebuild | Stopped at `scripts/ensure-node-22.mjs` because active Node is 25.2.1. |
| `npm.cmd run analyze:bundle` | Passed | 137 client chunks, 529.5 KiB initial JS, no violations. |
| `npx.cmd playwright test --list` | Passed | 986 tests discovered in 134 files. |
| `npx.cmd playwright test tests/automation-engine.spec.ts --config=playwright.node.config.ts` | Passed | 4 tests. |
| `npx.cmd playwright test tests/server-process-utils.spec.ts --config=playwright.node.config.ts` | Passed | 3 tests. |
| `npm.cmd run test:smoke` | Passed | 9 desktop/mobile smoke tests; exited cleanly. |
| `npm.cmd run test:static-export:smoke` | Passed | 2 static export smoke tests; exited cleanly. |
| `npm.cmd audit --omit=dev --json` | Passed | 0 production vulnerabilities. |
| `npm.cmd audit --json` | Failed with audit finding | 1 low-severity transitive dev finding in `@babel/core`. |
| `npm.cmd outdated --json` | Completed with outdated packages | Normal patch/minor drift plus several major upgrades requiring deliberate migration. |

Not run: full Playwright execution. It is 986 tests and is already sharded on `main` pushes in CI.

## Architecture Assessment

### State And Rendering

The editor still centers on `components/photoshop/editor-context.tsx`, which owns the provider, dispatch surface, document lifecycle, history operations, action recording/playback, filter previews, layer/document helpers, and selector hooks. This gives the product a coherent command path, but it also makes the provider one of the highest-risk files in the repo.

The selector infrastructure is real: `useEditorSelector` is backed by `useSyncExternalStore`, and focused helper hooks exist for common reads. Adoption is still early. I found 12 selector-related files, while the architecture gate still counts 74 broad `useEditor` import files. The next performance and maintainability gains should come from selector migration and command-only APIs, not from another state-management rewrite.

Rendering and input are similarly concentrated in `canvas-view.tsx`. The file now has extracted helpers for viewport control, compositor/cache behavior, overlays, selection helpers, smart guides, rulers, filter overlays, and runtime helpers, but the remaining file still mixes pointer lifecycle, render scheduling, tool-specific interactions, transform handles, filter overlays, text editing overlays, and cursor state.

### Events And Storage

Typed event dispatch and listener registration are in good shape. The architecture gate reports zero raw `ps-*` event dispatches and zero raw `ps-*` listeners. Current helper usage is broad: 57 files reference `dispatchPhotoshopEvent`, and 27 files reference `addPhotoshopEventListener`.

Client storage governance is also in good shape. `client-storage.ts` centralizes registered keys, privacy classes, parsing, fallbacks, write results, and clearing semantics. The architecture gate reports zero direct client storage calls outside the adapter allow-list.

### File I/O, Formats, And Browser Boundaries

The file and format layer is sophisticated and unusually honest about browser limits. `BOUNDARIES.md` correctly prevents impossible or proprietary goals from becoming backlog churn: Adobe cloud services, native UXP/CEP/8BF execution, exact native algorithm parity, certified CMM behavior, and guaranteed pro codec output are explicitly out of scope.

`document-io.ts`, `raster-codecs.ts`, PSD modules, high-bit document support, capability reports, static export behavior, and import sniffers show a strong pattern: accept browser-achievable workflows, bound untrusted inputs, and report unsupported native semantics rather than silently pretending to preserve them.

The cost is complexity. `document-io.ts` and `raster-codecs.ts` are both large enough that future format work can regress edge cases unless changes are isolated by format family and backed by fixture tests.

### Plugin And Automation Boundary

The plugin system is one of the highest-risk areas by nature, but the implementation has meaningful controls: manifest schemas, import byte limits, JSON depth/key/string limits, reserved-key filtering, permission review data, sandboxed iframes, token/source/channel validation, allow-listed host methods, storage quotas, and explicit non-support for native Adobe runtime APIs.

The remaining risk is not an obvious missing check. It is accumulated complexity across `plugin-system.ts`, `plugin-host-api.ts`, `plugin-lifecycle.ts`, and `advanced-subsystems-dialog.tsx`. This boundary should keep getting adversarial tests for forged `postMessage` traffic, wrong source windows, wrong tokens, over-depth payloads, unsafe panel HTML, storage quota exhaustion, and unsupported host calls.

### Server/API And Deployment

The server routes are small and guarded. Marketing feedback/subscribe use zod schemas, origin checks, rate limits, body caps, and filesystem quotas through `lib/marketing-store.ts`. Generative fill requires explicit endpoint/key env vars, rate limits requests, caps request and upstream body sizes, and times out upstream calls.

The local `.data/*.jsonl` storage is suitable for demo/local behavior, not production durability. The repo documents that in `docs/deployment-persistence.md`. Keep that distinction explicit anywhere deployment is discussed.

Static export is handled deliberately: the Pages workflow removes `app/api`, builds with `GITHUB_PAGES=true`, then runs static export smoke tests. This is the right model, but it means API-route security headers and backend behavior do not exist on the static deployment and should never be implied by static smoke passing.

### Testing And CI

The test surface is strong. Playwright discovery found 986 tests across 134 files, covering canvas behavior, filters, PSD and file workflows, plugin systems, security regression limits, accessibility, panels, automation, performance paths, static export, and visual snapshots.

CI is also strong: strict lint, typecheck, capability reconciliation, architecture budgets, build, bundle budget, smoke tests, targeted PR tests, and full Playwright sharding on pushes to `main`. The path-aware PR test selector already exists and is wired into CI, which is a meaningful improvement over generic smoke-only PR validation.

The main local gap is runtime parity. In this shell, Node 25 prevents doctor and build from passing. That is a setup issue, but it matters because it blocks local reproduction of CI build behavior.

### Bundle And Dependency Health

Bundle budget passes. The current report shows 137 client chunks and 529.5 KiB initial JS. Largest chunks:

| Chunk | Size |
| --- | ---: |
| `raster-decoders...js` | 1,381.5 KiB |
| `2840...js` | 1,283.2 KiB |
| `document-decoders...js` | 749.3 KiB |

The decoder chunks are expected for this product domain. The unowned `2840...js` shared/dynamic chunk is the more actionable concern: bundle analysis classifies it as shared/dynamic but cannot attribute it to modules. The analyzer already records ownership limitations, but exact module ownership still needs sourcemap or webpack-stats integration.

Production dependency audit is clean. Full audit reports one low-severity transitive dev issue in `@babel/core`. `npm outdated` shows many patch/minor updates and several major upgrades (`zod`, `pdfjs-dist`, `@hookform/resolvers`, `@vercel/analytics`, `react-resizable-panels`, `sonner`, `typescript`, etc.). Treat major upgrades as compatibility projects, not routine maintenance.

## Strengths To Preserve

1. **Explicit browser reality.** `BOUNDARIES.md` is doing real product governance. Keep it central.
2. **Guardrails with teeth.** Lint, typecheck, capability checks, architecture budgets, bundle budgets, smoke tests, static smoke, targeted PR tests, and full CI sharding are all valuable.
3. **Typed event and storage boundaries.** Raw `ps-*` events/listeners and direct client storage calls are now at zero.
4. **Broad workflow tests.** The suite covers product behavior, not just isolated utilities.
5. **Security-aware import paths.** File size limits, JSON bounds, zod schemas, plugin method allow-lists, origin checks, rate limits, iframe sandboxing, and capability reports are consistent themes.
6. **Browser-performance awareness.** The codebase uses dynamic imports, workers, tiled processing, OffscreenCanvas capability checks, render buses, dirty rects, progressive rendering, and smoke/performance tests.

## Priority Recommendations

### P0: Restore Local Runtime Parity

Switch local development to Node 22 before treating build results as meaningful. The repo declares Node `>=22 <23`, CI uses Node 22, and `scripts/ensure-node-22.mjs` blocks build under Node 25.

Recommended actions:

- Install/select Node 22 via the local Node manager used on this machine.
- Re-run `npm.cmd run doctor`, `npm.cmd run build`, and `npm.cmd run verify`.
- Keep npm pinned at `11.5.2`, which already matches in this shell.
- Consider documenting the exact Windows command for switching Node versions in `README.md` if this repo is worked on primarily from PowerShell.

### P1: Ratchet Architecture Budgets Downward

The architecture gate is passing, but several budgets are exact baselines. That prevents regression but does not create pressure to improve.

Recommended actions:

- After every extraction, lower `scripts/architecture-budgets.json` in the same PR.
- Track explicit milestone targets, for example:
  - oversize files: 25 -> 20 -> 15;
  - broad `useEditor` imports: 74 -> 60 -> 45;
  - top-ten largest total: 36,108 -> 32,000 -> 28,000.
- Keep import cycles, raw events, raw listeners, and direct storage at zero.

### P1: Continue Selector Migration

Move high-fanout UI away from broad `useEditor()` reads. This is likely the best near-term performance and maintainability win because it reduces unrelated re-renders without replacing the core reducer model.

Best first targets:

- `panels/layers-panel.tsx`
- `panels/properties-panel.tsx`
- `panels/history-panel.tsx`
- `options-bar.tsx`
- `tool-palette.tsx`
- `command-palette.tsx`
- read-heavy dialogs that only need one document/layer/settings slice

Recommended pattern:

- Use `useEditorSelector` or named helper hooks for render data.
- Expose command-only dispatch helpers for components that do not need state.
- Add architecture tests for newly migrated helper hooks.

### P1: Decompose The Largest Orchestration Files

Avoid a rewrite. Continue facade-preserving extractions with characterization tests.

Recommended slices:

- `canvas-view.tsx`: split pointer lifecycle, transform handles, text overlay, active tool input handlers, blur/lighting overlays, and cursor state.
- `editor-context.tsx`: split action family handlers, document lifecycle, history compression/restore, action recording/playback, and persistence side effects.
- `menu-bar.tsx`: split menu definitions from command execution and dialog launch state.
- `raster-codecs.ts`: split by format family and keep shared binary helpers small.
- `document-io.ts`: continue separating PSD, raster import, project serialization, export metadata, and report generation.
- `advanced-subsystems-dialog.tsx`: separate plugin manager, 3D/video UI, import/export helpers, and sandbox panel runtime.

Each extraction should reduce an architecture budget and add or keep a focused test.

### P1: Improve Bundle Ownership For Shared/Dynamic Chunks

The bundle budget passes, but the 1.28 MiB unowned shared/dynamic chunk is hard to manage.

Recommended actions:

- Add sourcemap or webpack-stats based module attribution to `scripts/analyze-bundle.mjs`.
- Treat decoder chunks separately from app-owned chunks.
- Set a future budget for largest non-decoder app chunk once ownership is reliable.
- Verify that heavy format/3D/video/plugin surfaces remain lazy and do not enter initial editor JS.

### P2: Expand Adversarial Plugin Boundary Tests

The plugin boundary has good controls, but it is still the most security-sensitive browser surface in the app.

Add tests for:

- forged `postMessage` with wrong `event.source`;
- wrong plugin token;
- wrong channel or plugin id;
- over-depth and over-wide JSON;
- storage quota exhaustion;
- unsafe panel HTML attempts;
- unsupported host methods;
- replayed request ids;
- plugin UI tree limits.

Also document why sandboxed `srcdoc` communication uses `postMessage(..., "*")`, or migrate to `MessageChannel` if that can preserve the opaque-origin sandbox behavior cleanly.

### P2: Keep Format Work Fixture-Driven

Format code is high value and high risk. New work in PSD, TIFF/BigTIFF, RAW, EXR, HEIC, AVIF, PDF, JPEG 2000, ICC metadata, or animated export should be fixture-driven.

Recommended actions:

- Add small malicious/corrupt fixtures for header sniffers and allocation guards.
- Keep maximum dimension, byte, layer, channel, and JSON-depth limits close to parsing code.
- Prefer one module per format family where possible.
- Keep browser limitation reporting visible in UI and test assertions.

### P2: Maintain Dependency Hygiene Without Blind Major Upgrades

Recommended actions:

- Fix the low dev-only `@babel/core` audit finding with the smallest safe update path.
- Batch Radix patch updates together after smoke/accessibility checks.
- Keep major updates as separate migration branches:
  - `zod` 3 -> 4 affects schemas and error formatting;
  - `pdfjs-dist` 5 -> 6 affects worker/import behavior;
  - `typescript` 5.7 -> 6 may affect React/Next typings;
  - `react-resizable-panels`, `sonner`, and `@vercel/analytics` majors may have runtime/API changes.
- Re-run `lint:strict`, `typecheck`, architecture, smoke, and targeted affected tests for each batch.

### P2: Keep Deployment Persistence Explicit

Recommended actions:

- Keep `docs/deployment-persistence.md` linked from README/deployment docs.
- Add a production storage adapter before any production marketing capture.
- Keep static export docs clear that `app/api` routes and proxy/security headers do not run on GitHub Pages.
- Keep static smoke focused on static behavior, not server-route guarantees.

### P3: Burn Down Small Maintainability Exceptions

Current source hygiene is good: no `TODO`, `FIXME`, `HACK`, `XXX`, `@ts-ignore`, `@ts-expect-error`, or `dangerouslySetInnerHTML` hits in source. Remaining cleanup:

- 9 `react-hooks/exhaustive-deps` suppressions should either be removed or documented with the specific invariant.
- The isolated `new Function` interop point in `raster-codecs.ts` should stay isolated and covered.
- Keep generated artifact timestamps from creating noise unless the artifact content changes.

## Suggested Roadmap

### Immediate

- Switch local shell to Node 22 and re-run `doctor`, `build`, and `verify`.
- Fix the low dev-only audit finding.
- Pick one selector migration target and reduce the `useEditorImports` budget after it lands.
- Pick one large-file extraction and reduce the oversize/top-ten budget after it lands.

### Short Term

- Add bundle source ownership for the largest shared/dynamic chunk.
- Expand plugin boundary tests around forged messages and quotas.
- Extract one coherent slice each from `canvas-view.tsx`, `editor-context.tsx`, and `menu-bar.tsx`.
- Continue replacing broad editor reads in panels/dialogs with selectors.

### Medium Term

- Push oversize files below 20 and broad `useEditor` imports below 60.
- Split format code by family and add more corrupt fixture coverage.
- Add a production persistence adapter if marketing/API data collection is meant to survive deployment restarts.
- Keep full Playwright sharding on `main`, and continue expanding path-aware PR test groups as new subsystems appear.

## Success Metrics

- `npm.cmd run doctor` passes locally.
- `npm.cmd run build` and `npm.cmd run verify` pass under Node 22.
- Import cycles remain 0.
- Raw `ps-*` events/listeners remain 0.
- Direct client storage violations remain 0.
- Oversize files trend below 25, then below 20.
- Broad `useEditor` import files trend below 74, then below 60.
- Top-ten largest file total trends below 36,108 lines.
- Largest non-decoder app chunk has reliable source ownership and trends below an explicit budget.
- Production dependency audit remains 0 vulnerabilities.
- Full Playwright remains sharded and green on `main`.

## Final Assessment

The codebase is healthier than its size might suggest. It has strong tests, explicit product boundaries, real architecture gates, and clear security hardening around dangerous inputs. The next improvements should be disciplined and incremental: restore local Node parity, keep ratcheting budgets, migrate broad context consumers to selectors, split the largest files without changing their public behavior, and deepen adversarial tests around plugins and file imports.

