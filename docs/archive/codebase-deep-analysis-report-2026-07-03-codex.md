# Deep Codebase Analysis and Improvement Report

**Date:** 2026-07-03
**Scope:** Entire repository at commit `6c9970e` on branch `codex/analysis-report-implementation`
**Method:** Static architecture review, dependency and import inspection, configuration review, test-shape analysis, production build, bundle analysis, security-boundary review, and execution of the repository's quality checks.

## Executive Summary

This is a technically ambitious and unusually well-tested browser image editor. Its strongest qualities are explicit browser capability boundaries, extensive pixel and workflow tests, strict TypeScript and linting, layered format compatibility reporting, production-backed browser testing, and a serious approach to payload limits and browser storage.

The current branch is functionally healthy but not release-ready under its own declared quality contract:

- Production build succeeds.
- Strict lint and typecheck succeed.
- The full non-visual Playwright suite reports **1,077 passed and 3 skipped**.
- Smoke, architecture, capability, source-hygiene, and unused-scaffold checks pass.
- `npm audit` reports **zero known vulnerabilities**.
- `npm run analyze:bundle` fails with two `/editor` startup violations.

The immediate issue is a startup regression: `/editor` now transfers 715.6 KiB encoded / 2.37 MiB decoded JavaScript in 32 requests. The configured budgets are 1.50 MiB decoded and 24 requests. Because bundle analysis is part of `npm run verify`, the repository's primary verification command cannot currently complete successfully.

After that release blocker, the highest-value work is architectural:

1. Make one selector-driven editor store canonical and remove the mirrored full-context selector store.
2. Decompose the 6,373-line canvas coordinator and 2,995-line menu coordinator.
3. Move the large body of pure tests to Vitest and make changed-line coverage fail when a changed critical file is not instrumented.
4. Harden generative-fill cost controls for untrusted-proxy and multi-instance deployments.
5. Wire storage governance and runtime diagnostics helpers into real production workflows rather than testing them only in isolation.

## Verification Snapshot

| Check | Result |
| --- | --- |
| `npm run lint:strict` | Pass |
| `npm run typecheck` | Pass |
| `npm run test:unit` | Pass: 6 tests in 2 files |
| `npm run test:unit:coverage` | Pass: 43.5% statements / 32.89% branches across 5 files |
| `npm run check:architecture -- --json` | Pass |
| `npm run check:source-hygiene` | Pass |
| `npm run check:capabilities` | Pass: 72 capability records and 13 advanced-format entries |
| `npm run check:unused-scaffolds` | Pass |
| `npm run build` | Pass |
| `npm run test:smoke` | Pass: 9 tests |
| `npm run test:full` | Pass: 1,077 passed / 3 skipped |
| `npm audit --json` | Pass: 0 vulnerabilities |
| `npm run analyze:bundle` | **Fail: 2 `/editor` violations** |

The worktree remained clean after verification.

## Repository Profile

- Next.js 16, React 19, TypeScript, Tailwind, Radix UI.
- Approximately 476 application source files and 181,795 source lines.
- 154 test files and approximately 30,105 test lines.
- Central browser-local editor with Canvas 2D, optional WebGL, Web Workers, IndexedDB, OPFS, PSD/raster codecs, and static-export support.
- 150 Playwright spec files contain roughly 1,108 declared `test(...)` calls.
- Static analysis found about 89 spec files that appear to be pure module tests rather than browser tests.

## Architecture Assessment

### Application shell

The App Router structure is clear:

- `/` provides the start workspace.
- `/editor` loads a client-only editor entry.
- `/marketing` and `/documentation` are separate product surfaces.
- API routes handle feedback, subscriptions, health, and model-backed generative fill.

The editor shell correctly groups persistent chrome into one boundary, while panels and dialogs are generally lazy-loaded. This avoids the earlier problem of independently resolving shell fragments shifting the canvas during interaction.

The remaining issue is import ownership. A component being wrapped in `dynamic()` does not reduce `/editor` startup cost when it is required immediately. The persistent shell still pulls large coordination and diagnostic graphs into the first editor load.

### State and rendering

The recent extraction of reducer, initial-state, history, selector, and store modules is a meaningful improvement. State transitions are explicit and tested.

However, three overlapping state access paths remain:

1. Full `EditorContext` through `useEditor()`.
2. A canonical external state store through `useEditorStateSelector()`.
3. A second external selector store containing the full computed context value through `useEditorSelector()`.

The second selector store is updated in a layout effect after the provider renders. That makes it a mirror of the broad context rather than the canonical source and can add a second notification/render after commits.

High-frequency dispatch currently wraps external-store notification in `React.startTransition`. React documents that external-store mutations used by `useSyncExternalStore` cannot be marked as non-blocking transition updates; React can restart them as blocking work to preserve consistency. The current comments therefore promise scheduling behavior the underlying API does not guarantee. See the [React `useSyncExternalStore` caveats](https://react.dev/reference/react/useSyncExternalStore#caveats).

### Canvas and interaction

The rendering pipeline has strong focused helpers for composition, caching, viewport control, brush dynamics, overlays, geometry, and workers. The core coordinator remains too large:

- `canvas-view.tsx`: 6,373 lines by the architecture checker.
- 42 `useRef` calls.
- 21 effects plus one layout effect.
- 17 typed Photoshop event-listener registrations.
- Composition, pointer routing, tool state machines, selection transforms, text editing, filter overlays, color HUD behavior, and rendering invalidation still share one component.

This concentration raises change risk even though many algorithms have already been extracted.

### Menus and workflows

`menu-bar.tsx` is still a second application coordinator:

- 2,995 lines.
- 32 imports, exactly the configured limit.
- Approximately 65 local state atoms.
- Dozens of event registrations and dialog/workflow routing paths.

Dialog components are lazy, but their open state and workflow orchestration remain centralized. A reducer-backed dialog router and domain menu controllers would substantially reduce fan-out and render churn.

### Persistence

The storage registry is a useful direction. Direct storage access is now gated and IndexedDB/OPFS entrypoints use registered descriptors.

The governance implementation is incomplete:

- `migrateRegisteredPayload`
- `writeWithRegisteredQuotaRecovery`
- `runRegisteredAtomicTransaction`

are exercised only by `tests/storage-governance.spec.ts`; no production module calls them. The registry currently documents policy and centralizes opening, but it does not yet enforce migration, quota recovery, or transaction behavior across storage owners.

### Server and security boundary

Strong existing controls include:

- Central CSP generation with per-request nonces.
- Same-origin request checks.
- Bounded request and upstream response bodies.
- HMAC-scoped capability tokens for generative fill.
- Fail-closed production rate-limit and persistence adapters.
- No dependency vulnerabilities in the current audit.

The main remaining risk is cost-control identity. Generative fill uses:

```text
genfill:minute:<authenticated subject>:<client identity>
```

When trusted-proxy mode is disabled, the client identity is a hash of mutable request headers. A caller with a valid capability can vary those headers to obtain multiple per-minute buckets. The subject-only daily limit and per-process concurrency limit reduce impact, but the advertised 10/minute subject limit is not dependable in that deployment mode.

Concurrency is also stored in a process-local `Map`, so a horizontally scaled deployment can exceed the configured per-subject concurrency limit.

## Strengths to Preserve

1. **Capability honesty.** `BOUNDARIES.md` and the capability catalog clearly separate browser-achievable behavior from Adobe-native or cloud-only parity.
2. **Functional test depth.** The 1,080-test production-backed suite covers pixels, formats, storage, security, accessibility, workflows, and UI.
3. **Format safety.** Size limits, sanitizers, compatibility manifests, and explicit flatten/approximation reporting are consistently designed.
4. **Security defaults.** Production adapters fail closed, CSP is centralized, and public payloads are bounded.
5. **Progressive browser fallbacks.** Canvas/WebGL, worker/main-thread, OPFS/memory, and codec fallback paths are explicit.
6. **Architecture guardrails.** Import-cycle, broad-context, event, storage, and file-size checks provide a base for ratcheting.
7. **Static export discipline.** The static build no longer mutates the active checkout.
8. **Rendered accessibility coverage.** Axe, focus restoration, keyboard navigation, forced-colors, zoom, and touch targets are tested.

## Prioritized Findings

### P0 — Restore the bundle and verification contract

**Evidence**

- `package.json` includes bundle analysis in `verify:quality`.
- `artifacts/bundle-report.json` records:
  - `/editor` decoded startup: 2,422,853 bytes vs 1,572,864 budget.
  - `/editor` startup requests: 32 vs 24 budget.
- The committed baseline was 1,709,568 decoded bytes and 14 requests, so the current route regressed by 713,285 decoded bytes and 18 requests.
- `npm run analyze:bundle` exits with two violations after a fresh successful production build.

**Likely contributors**

- The always-visible status bar imports the broad `document-io` facade plus color, large-document, offscreen, filter-preview, and tile-planning modules.
- The `document-io.ts` facade re-exports project, PSD, raster, and shared I/O modules.
- The persistent shell eagerly owns CanvasView, MenuBar, OptionsBar, PanelDock, ToolPalette, and StatusBar.
- Extracted modules improved source organization but remained reachable from startup entrypoints, increasing request fragmentation without delaying capability-specific work.

**Recommendations**

1. Treat current bundle violations as a release blocker; do not raise budgets to absorb them.
2. Replace startup imports from `document-io.ts` with direct leaf imports.
3. Split StatusBar into a lightweight core and an intent-loaded diagnostics surface.
4. Delay format, codec, and compatibility modules until file open/export or diagnostics expansion.
5. Keep the core editor in a small number of stable chunks; avoid converting every helper into a separate startup request.
6. Add a test that fails if a committed bundle report contains violations.
7. Update the baseline only after budgets pass and the change is intentionally reviewed.

**Acceptance criteria**

- `npm run verify` passes from a clean checkout.
- `/editor` is below 1.50 MiB decoded and 24 startup requests.
- No regression in editor-ready time or first interaction.

### P1 — Make the selector store canonical

**Evidence**

- `editor-context.tsx` mutates `stateStore` synchronously.
- A second selector store is updated later in `useLayoutEffect`.
- Fifteen files still import broad `useEditor()`, exactly the architecture cap.
- Critical components including CanvasView, MenuBar, OptionsBar, LayersPanel, and PropertiesPanel remain broad consumers.

**Recommendations**

1. Keep one immutable state store as the source of truth.
2. Keep commands/render bus in stable, separate contexts.
3. Replace full-value `useEditorSelector` with selectors over the canonical state store plus focused command hooks.
4. Support equality functions for object/array selectors.
5. Remove the layout-effect mirror.
6. Migrate CanvasView and persistent chrome first because they determine interaction cost.
7. Ratchet `useEditorImports.max` below 10 after migration.

**Acceptance criteria**

- No second store mirrors a computed full context value.
- A history update does not re-render unrelated menus, panels, and tool controls.
- React Profiler traces demonstrate reduced commits during painting and undo.

### P1 — Correct the high-frequency scheduling model

**Evidence**

- `dispatch` computes and publishes an external-store snapshot synchronously.
- High-frequency actions call `React.startTransition(() => stateStore.notify())`.
- React's documented external-store semantics do not guarantee non-blocking transition behavior for these mutations.

**Recommendations**

1. Add a repeatable profiler benchmark for brush pointer-up, history push, undo, and zoom.
2. Separate immediately consistent document state from lower-priority UI projections.
3. Coalesce nonessential UI notifications with `requestAnimationFrame` where correctness allows.
4. Keep canvas painting and render-bus invalidation outside broad React rerenders.
5. Remove or rewrite comments that claim transition behavior not provided by React.

**Acceptance criteria**

- Pointer latency and React commit counts are measured in CI or a reproducible benchmark.
- High-frequency actions do not trigger full editor-context rerenders.

### P1 — Decompose the remaining coordinators and create budget headroom

**Evidence**

- Oversized-file budget: 14/14.
- Broad `useEditor` imports: 15/15.
- Top-ten largest files: 28,599/29,000 lines.
- MenuBar imports: 32/32.
- CanvasView imports: 48/49.

Passing at the ceiling prevents regressions but provides almost no room for routine work.

**Recommendations**

1. Extract CanvasView controllers:
   - composition and cache lifecycle;
   - pointer/stroke state machine;
   - selection and transform state machine;
   - filter/lighting overlays;
   - text/path editing overlays;
   - typed event subscriptions.
2. Replace MenuBar's local state collection with a discriminated dialog/workflow reducer.
3. Move file, image, layer, selection, filter, and workspace orchestration behind domain hooks/services.
4. Split large engine files by algorithm family only where tests can own stable contracts.
5. Lower budgets in the same commits that earn the reductions.

**Targets**

| Metric | Current | Near-term target |
| --- | ---: | ---: |
| Files over 1,500 lines | 14 | <= 10 |
| CanvasView lines | 6,373 | < 3,500 |
| MenuBar lines | 2,995 | < 1,500 |
| Broad `useEditor` import files | 15 | <= 8 |
| Top-ten total lines | 28,599 | < 24,000 |

### P1 — Make coverage enforcement match the test suite's claims

**Evidence**

- Vitest runs only 6 tests in 2 files.
- Coverage includes only five modules.
- Current measured coverage is 43.5% statements and 32.89% branches over those five modules.
- `check-changed-coverage.mjs` iterates only files present in `coverage-final.json`.
- A changed critical reducer, serializer, sanitizer, or algorithm absent from the coverage report is silently ignored.
- Roughly 89 Playwright spec files appear to be pure module tests.

**Recommendations**

1. Port pure TypeScript tests to Vitest in subsystem batches.
2. Run the entire fast unit suite on every pull request.
3. Make changed-line coverage fail when a changed critical file has no coverage entry.
4. Generate the critical-module include list from changed files or a maintained manifest.
5. Keep Playwright for DOM, Canvas browser APIs, workers, accessibility, layout, and end-to-end behavior.
6. Add minimum changed branch/statement thresholds; avoid a misleading global target for browser-only paths.

**Acceptance criteria**

- A changed uncovered reducer or algorithm causes CI to fail.
- Pure tests complete without starting the Next server.
- PR selection targets browser tests only; the fast unit suite always runs in full.

### P1 — Harden generative-fill cost controls

**Evidence**

- The minute key combines authenticated subject with `getClientIp()`.
- Without trusted-proxy mode, `getClientIp()` returns a fingerprint of user-controlled headers.
- Concurrency uses a process-local `Map`.

**Recommendations**

1. Rate-limit the paid minute quota by authenticated subject alone, or combine it only with a verified deployment identity.
2. Never increase quota cardinality using the weak header fingerprint.
3. Move concurrency accounting to the durable rate-limit service or a queue/semaphore shared by all instances.
4. Record structured adapter and quota metrics without logging prompts or pixels.
5. Add tests proving header changes cannot create new minute buckets for one subject.

**Acceptance criteria**

- A subject receives the same minute bucket regardless of mutable browser headers.
- Multi-instance deployments enforce the configured concurrency limit globally.

### P2 — Turn storage governance from metadata into enforcement

**Evidence**

- Registered wrappers are used to open IndexedDB/OPFS.
- Migration, quota-recovery, and atomic-transaction helpers have no production callers.
- The governance test validates generic helpers, not real stores upgrading or recovering.

**Recommendations**

1. Define resource-specific migration functions beside each descriptor.
2. Exercise actual previous-version databases for recents, libraries, startup handoff, and asset directories.
3. Route quota-sensitive writes through the registered recovery policy.
4. Test interrupted real IndexedDB transactions and OPFS partial writes.
5. Add a static check that governance helpers have production call sites for resources claiming those policies.

**Acceptance criteria**

- Every descriptor's migration and quota policy maps to executable production code.
- Upgrade tests cover the previous two real schema versions.

### P2 — Productize runtime diagnostics and error isolation

**Evidence**

- Runtime events, sanitization, an opt-in sink, and diagnostics JSON generation exist.
- No production code configures the telemetry sink.
- No production UI calls `downloadDiagnosticsExport`.
- The editor has one boundary around the entire provider/workspace.

**Recommendations**

1. Add “Download diagnostics” to the browser diagnostics panel.
2. Configure a documented, explicit opt-in telemetry adapter or remove the unused sink abstraction.
3. Add boundaries around panel stacks and high-risk dialogs so a panel failure does not replace the canvas.
4. Include last successful autosave time and recovery availability in fatal UI rather than asserting recovery unconditionally.
5. Add tests that throw inside a panel/dialog and verify the editor remains usable.

### P2 — Reduce facade and event-contract coupling

**Evidence**

- Many components import helpers through the broad `document-io` facade.
- The central Photoshop event map is large and contains 26 `unknown` payload mentions.
- Events provide decoupling but obscure ownership and make cross-domain workflow tracing difficult.

**Recommendations**

1. Import leaf modules from persistent startup code.
2. Split events by domain while retaining one typed dispatch implementation.
3. Replace `unknown` payloads with bounded domain types at public event boundaries.
4. Add ownership metadata or naming conventions for request/result event pairs.
5. Prefer direct command services when sender and receiver share the editor domain.

### P3 — Incremental type and dependency maintenance

**Evidence**

- No explicit `any` remains in production TypeScript.
- There are only three hook dependency suppressions.
- There are roughly 358 non-null assertions, many around Canvas 2D contexts.
- `npm outdated` currently reports a patch for `ag-psd`, TypeScript 5.9 as the wanted compatible update, and newer Node types outside the Node 22 engine target.

**Recommendations**

1. Introduce a shared checked Canvas 2D context helper and migrate risky paths incrementally.
2. Enable `noUncheckedIndexedAccess` by subsystem rather than repository-wide in one change.
3. Update `ag-psd` patch versions with PSD fixture and round-trip tests.
4. Trial TypeScript 5.9 separately; defer TypeScript 6 and Node 26 types until the runtime/toolchain target changes.

## Recommended Delivery Plan

### Phase 1 — Restore the release contract

1. Fix `/editor` startup module ownership and request count.
2. Add a committed-report violation test.
3. Run `npm run verify` from a clean checkout.
4. Capture editor-ready and first-interaction timing before and after.

### Phase 2 — State and interaction architecture

1. Make the canonical state store selector-driven.
2. Remove the mirrored selector store.
3. Migrate CanvasView and persistent chrome off broad `useEditor`.
4. Replace the external-store `startTransition` assumption with measured scheduling.
5. Extract canvas and menu state machines.

### Phase 3 — Test and persistence enforcement

1. Move pure specs to Vitest.
2. Make missing coverage entries fail for changed critical modules.
3. Wire real storage migrations, quota recovery, and transaction policies.
4. Keep the full Playwright suite as a browser integration lane.

### Phase 4 — Production operations

1. Enforce subject-stable and distributed generative-fill limits.
2. Wire diagnostics export and optional telemetry.
3. Add panel/dialog error isolation.
4. Split liveness from dependency readiness if `/api/health` is used by deployment orchestration.

## Final Assessment

The codebase has a strong functional base. The successful 1,077-test browser suite, clean build, strict type/lint checks, explicit browser boundaries, and security hardening are substantial strengths.

The next step should not be more feature breadth. The current branch needs its bundle contract restored first. Then effort should focus on making the state model, coordinator boundaries, coverage enforcement, storage policies, and production cost controls match the guarantees already described by comments, tests, and architecture documents.

The central principle for the next cycle is: **convert green-but-saturated guardrails and tested scaffolding into measurable headroom and production enforcement.**
