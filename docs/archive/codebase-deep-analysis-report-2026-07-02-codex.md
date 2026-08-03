# Deep Codebase Analysis and Improvement Report

Generated: 2026-07-02

Scope: the current working tree on branch `codex/analysis-report-implementation` at commit `093182e`.

The tree already contained 66 modified and 23 untracked files before this report was written. This review therefore treats the working tree, not `HEAD`, as the source of truth. No implementation changes were made as part of this analysis. Production build and bundle analysis refreshed the already-modified generated bundle report.

## Executive Summary

This is a substantial, technically ambitious browser image editor: 362 Photoshop-domain TypeScript/TSX modules, approximately 183,000 lines in `components/photoshop`, 1,050 enumerated tests, worker-backed pixel processing, explicit browser capability reporting, a PSD/raster I/O layer, and meaningful security controls around its server routes.

The current tree is broadly healthy:

- Strict lint, type checking, source hygiene, capability reconciliation, architecture checks, production build, bundle checks, and the smoke suite pass.
- `npm audit` reports no known vulnerabilities.
- The sensitive API routes use bounded body reads, schema validation, CSP nonces, scoped capabilities, fail-closed production adapters, and rate/concurrency limits.
- Recent extractions reduced `/editor` startup transfer and the largest application-owned startup chunk.

The main risk is not a lack of features or tests. It is concentration and delivery fragility:

- Architecture budgets are passing at or near their exact caps.
- `canvas-view.tsx`, `editor-context.tsx`, and `menu-bar.tsx` remain very large coordination points.
- The editor context exposes 71 values/commands and its reducer handles roughly 188 action variants.
- The largest application-owned startup chunk has only about 21 KiB of headroom.
- A representative browser run found one repeatable flaky/failing paint-history scenario and two retry-only pointer scenarios. Trace evidence points to Next development/HMR layout instability rather than the undo implementation itself.
- Accessibility testing validates metadata models, not the rendered DOM.
- CI does not run every guardrail declared by `npm run verify`, and the full browser suite runs against `next dev`.

The best next step is a stabilization and architecture pass, not more feature breadth.

## Implementation Status

Updated after implementation on 2026-07-02.

Implemented:

- The main Playwright suite now runs against the production build. A one-test development/HMR suite and a retries-disabled critical repeat lane are separate.
- Runtime guards fail on page/console errors, Next overlays, invalid stage geometry, or an unpainted canvas. The canvas publishes a measured readiness marker.
- Persistent editor chrome is loaded through one shell boundary. Command palette, new-document, image-size, canvas-size, and export workflows preload on intent.
- A synchronous versioned editor state store is canonical for state selectors. A stable command-only context isolates dispatch/commit/render subscribers. Broad `useEditor` consumers fell from 29 to 15.
- Type contracts were split into core, typography, rendering, and tool domains. Editor reducer/history/initial-state concerns, document I/O format domains, and File-menu rendering/workflow helpers are also isolated. Coordination-file import and fan-in budgets are enforced.
- Bundle analysis enforces a largest-owned startup chunk below 800 KiB and `/editor` decoded startup below 1.5 MiB, records a compact baseline, and prints route/request/module deltas.
- Rendered Axe coverage now covers all four routes plus menus, dialogs, panel browser, export, context menu, keyboard focus return, 200% zoom, reduced motion, forced colors, and mobile touch targets.
- CI calls the shared verification contract, uses structured targeted-test arguments without shell evaluation, runs changed-line coverage, critical production interactions, weekly quality/full-browser/accessibility/audit lanes, and least-privilege permissions.
- Vitest and V8 coverage now own the first pure-module suites; Playwright explicitly ignores `tests/unit`.
- Route/editor error boundaries, opt-in structured telemetry, recovery metadata, and sanitized diagnostics export are implemented. Worker, codec, WebGL, storage, adapter, hydration, and boundary event categories contain no pixels, filenames, or free-form content.
- Browser persistence entrypoints are registered across local/session storage, IndexedDB, and OPFS. Previous-two-version migration, quota eviction/retry, and interrupted-transaction behavior have executable tests.
- Runnable durable marketing and rate-limit reference services, strong deployment identity, adapter health, shared CSP generation, and a Node-only JPEG/WASM adapter are included.
- Static export builds in a temporary workspace and uses the same local/Pages command without deleting API routes from the active checkout.
- Compatible dependency batches were applied and verified, including Next 16.2.10, current codec packages, Zod 4, current Radix packages, React Resizable Panels 4, Sonner 2, Lucide 1, and current tooling. TypeScript 6 was evaluated and rolled back because its `ArrayBufferLike` DOM definitions fail the existing typed pixel/Blob interfaces; TypeScript 5.7.3 remains the verified compiler.

Verified outcome:

| Metric | Before | Implemented result |
| --- | ---: | ---: |
| Broad `useEditor` files | 29 | 15 |
| Oversized files (>1,500 lines) | 17 | 14 |
| Top-ten largest files | 32,172 lines | 28,599 lines |
| Largest app-owned startup chunk | 928.7 KiB | 473.7 KiB |
| `/editor` decoded startup | 1.67 MiB | 1.22 MiB |
| Critical paint-history repeat | Mixed | 20/20, retries disabled |
| Rendered serious/critical Axe violations | Not measured | 0 in covered states |
| Full production Playwright suite | Not run | 1,077 passed, 3 intentionally skipped |
| Direct unregistered storage entrypoints | Not measured | 0 |
| Known dependency vulnerabilities | 0 | 0 |

Externally deployable requirements:

- Set `MARKETING_RECORD_STORE_URL`, `MARKETING_RECORD_STORE_TOKEN`, `RATE_LIMIT_SERVICE_URL`, and `RATE_LIMIT_SERVICE_TOKEN` to the deployed reference-compatible services.
- Set `MARKETING_TRUSTED_PROXY=true` only behind a proxy that strips and rewrites identity headers. Set `TRUSTED_CLIENT_IDENTITY_HEADER` when the platform provides a stronger anonymous subject.
- Keep local marketing/rate-limit fallbacks disabled in production. `/api/health` remains `503` until all required adapters and trusted identity are configured.

Remaining architecture target:

- The report's enforceable architecture outcomes are now met at 14 oversized files, 15 broad `useEditor` imports, and 28,599 lines across the ten largest files. `editor-context.tsx` is 1,440 lines and `menu-bar.tsx` is 2,995 lines after domain extraction. `canvas-view.tsx` remains the sole historical React coordination component above 3,000 lines; extracting its pointer, paint, selection, and overlay runtimes remains a behavior-sensitive follow-up, so this report does not mark that extraction complete.

## Verification Results

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run doctor` | Pass | Node 22.23.1, npm 11.5.2, Playwright and Chromium available. |
| `npm run lint:strict` | Pass | Zero warnings. |
| `npm run typecheck` | Pass | Strict TypeScript check completed. |
| `npm run check:source-hygiene` | Pass | No common mojibake sequences. |
| `npm run check:capabilities` | Pass | 72 capability records and 13 advanced-format entries reconciled. |
| `npm run check:architecture -- --json` | Pass, low headroom | Details below. |
| `npm run check:unused-scaffolds` | Pass | Three retired paths remain absent. |
| Targeted node-style Playwright tests | Pass | 59 passed; 4 browser-only cases skipped under the node config. |
| `npm audit --audit-level=low` | Pass | Zero known vulnerabilities. |
| `npm run build` | Pass | Next.js 16.2.9 production build, 18 generated pages. |
| `npm run analyze:bundle` | Pass, low headroom | `/editor` 512.2 KiB encoded / 1.67 MiB decoded. |
| `npm run test:smoke` | Pass | 9 desktop/mobile production smoke tests. |
| Representative browser suites | Mixed | 36 passed, 1 failed, 2 flaky. |
| Focused failed-test repetition | Mixed | Across three repetitions: one pass, one retry-only pass, one failure after retry. |
| Full Playwright suite | Not run | 1,050 tests enumerated across 142 spec files. |

The report does not claim the entire 1,050-test suite passes.

## Repository Snapshot

| Area | Files | Lines |
| --- | ---: | ---: |
| `app` | 12 | 1,792 |
| `components` | 428 | 191,184 |
| `components/photoshop` | 362 | 183,060 |
| `components/ui` | 50 | 5,298 |
| `components/marketing` | 15 | 2,814 |
| `hooks` | 2 | 218 |
| `lib` | 5 | 765 |
| `scripts` | 14 | 2,212 |
| `tests` | 143 | 33,089 |
| `types` | 3 | 57 |

The codebase has roughly one test line for every six production/support source lines. That is useful scale, but line ratio is not coverage; no executable coverage measurement currently exists.

Largest source files from the architecture check:

| File | Lines |
| --- | ---: |
| `components/photoshop/canvas-view.tsx` | 6,315 |
| `components/photoshop/editor-context.tsx` | 4,582 |
| `components/photoshop/menu-bar.tsx` | 3,365 |
| `components/photoshop/document-io.ts` | 3,050 |
| `components/photoshop/tool-helpers.ts` | 2,892 |
| `components/photoshop/filters/registry-helpers.ts` | 2,613 |
| `components/photoshop/typography-engine.ts` | 2,378 |
| `components/photoshop/color-pipeline.ts` | 2,334 |
| `components/photoshop/advanced-subsystems-dialog.tsx` | 2,330 |
| `components/photoshop/raster-codecs.ts` | 2,313 |

## Architecture Assessment

### Application shell

The App Router shell is intentionally thin. `/editor` loads a client-only editor entry, and cold dialogs/panels are generally lazy-loaded. This is the correct direction for a browser editor with expensive codec and workflow modules.

The latest tree also dynamically imports always-visible shell components such as Menu Bar, Options Bar, Document Tabs, Tool Palette, Panel Dock, Status Bar, and Canvas View in `components/photoshop/editor-app.tsx:68-147`. This improved chunk ownership, but it creates more asynchronous startup boundaries and development-time chunk compilation. The browser failure described below is correlated with this shape.

### State and commands

The editor has a strong invariant: menus, shortcuts, panels, and tools route through typed actions. That is preferable to scattered state mutations.

The scale of the state surface is now the concern:

- The `Action` union begins at `components/photoshop/editor-context.tsx:454` and has approximately 188 variants.
- `EditorContextValue` begins at `components/photoshop/editor-context.tsx:3076` and exposes approximately 71 properties/commands.
- The reducer has approximately 189 `case` branches.
- Twenty-nine files still import broad `useEditor`, exactly matching the current budget.

Selector infrastructure exists, but it is layered on top of the broad context. The provider commits React state, then publishes the selector snapshot from a layout effect at `components/photoshop/editor-context.tsx:4448-4449`. That design can require an extra commit for selector consumers and makes the selector store a delayed mirror rather than the canonical state source.

### Canvas and rendering

The rendering system has credible engineering:

- Canvas 2D and WebGL paths.
- Dirty rectangles and compositor caching.
- Worker and tiled filter execution.
- Explicit browser/GPU/memory capability reporting.
- History compression and cancellable restoration.

The main weakness is coordination density. `canvas-view.tsx` is both a React component and a large interaction runtime with 49 imports, about 20 effects, 13 callbacks, pointer routing, tool dispatch, overlays, viewport behavior, and render orchestration. This makes it difficult to prove that a change is isolated.

### File I/O and codecs

The project is unusually honest about browser format limits, and recent extractions from raster codecs, selection algorithms, and tile-only processing are good improvements.

Remaining concerns:

- `document-io.ts` and `raster-codecs.ts` remain broad facades with many format-specific responsibilities.
- Browser and Node behavior coexist in the codec layer.
- `components/photoshop/raster-codecs.ts:1932` uses `new Function` to hide Node dynamic imports from the bundler. It is confined to the Node branch, but it is an avoidable exception in a codebase with a deliberately strict CSP.

### Server/API boundary

The security posture is one of the stronger parts of the repository:

- Per-request CSP nonce and restrictive response headers.
- Bounded request and upstream response reads.
- Zod validation and field allow-listing.
- Scoped, short-lived server capabilities.
- Fail-closed production storage and rate-limit configuration.
- Explicit concurrency and daily quota paths.

The remaining work is operational rather than basic validation: durable adapters, trustworthy client identity, health reporting, and reducing duplicated CSP configuration.

## Strengths to Preserve

1. **Explicit browser boundaries**

   `BOUNDARIES.md` prevents impossible Adobe/native parity work from being mistaken for normal backlog. Keep it authoritative.

2. **Architecture guardrails**

   Import-cycle checks, direct-storage checks, broad-context budgets, source hygiene, capability reconciliation, and bundle ownership reports are valuable. Tighten them as improvements land; do not remove them to make feature work easier.

3. **Fail-closed production APIs**

   Production refuses silent local fallback unless explicitly configured. This is the correct default.

4. **Deterministic worker/filter testing**

   The new worker-source parity checks materially reduce drift between main-thread and worker implementations.

5. **Production smoke path**

   `playwright.smoke.config.ts` uses `scripts/serve-next-smoke.mjs`, which serves the production build. That is a sound foundation for broader runtime testing.

6. **Capability and limitation reporting**

   Unsupported fidelity is reported rather than silently presented as native Photoshop parity.

## Prioritized Findings and Recommendations

### P1 — Stabilize browser interaction tests and separate production behavior from development HMR

Evidence:

- The representative browser run produced 36 passes, 1 failure, and 2 retry-only passes.
- Repeating the failing undo/redo paint-history test three times produced one pass, one flaky pass, and one failure after retry.
- The failure happens while drawing the second stroke, before undo or redo is invoked.
- The Playwright trace shows the first stroke using screen coordinates around y=263–333. Before the next stroke, the canvas stage moves to roughly y=1,843, causing pointer input around y=2,123–2,193.
- The same run logs `Internal Next.js error: Router action dispatched before initialization`.
- The full Playwright config serves `next dev` at `playwright.config.ts:14-15`; the smoke config serves the production build at `playwright.smoke.config.ts:13-14`.

Assessment:

This is not evidence that undo is broken. It is evidence that the development/HMR test host can temporarily lose valid layout while tests continue issuing pointer input. Retries hide part of the problem but do not make CI deterministic.

Recommendations:

1. Run the main interaction suite against `next build` + `next start`.
2. Retain a much smaller dedicated `next dev` suite for hydration, HMR, and development-only behavior.
3. Fail tests immediately on uncaught page errors and console errors instead of allowing gestures to continue.
4. Add a shared editor-ready assertion that checks:
   - stage visibility;
   - computed `position` for the stage container;
   - bounding box within the viewport;
   - non-zero composited pixels;
   - absence of a Next compilation/error overlay.
5. Add a repeat lane for the highest-value gesture/history tests with retries disabled.
6. Reassess dynamic imports for always-visible shell components. Keep cold dialogs and codecs lazy, but consider one stable editor-shell chunk rather than separate asynchronous boundaries for every persistent chrome component.

Success criteria:

- Twenty repeated runs of the paint-history test pass with retries disabled.
- No full-suite browser test depends on a dev compilation finishing after interaction begins.
- Page/runtime errors fail the responsible test at the point they occur.

### P1 — Create real architecture headroom

Current budgets:

| Budget | Current | Maximum | Headroom |
| --- | ---: | ---: | ---: |
| Files above 1,500 lines | 17 | 17 | 0 |
| Broad `useEditor` import files | 29 | 29 | 0 |
| Top-ten largest files | 32,172 lines | 32,500 | 328 lines |
| Hook dependency suppressions | 3 | 6 | 3 |

Passing at the cap is not a stable architecture state. Normal feature work will require either another refactor or a budget increase.

Recommendations:

1. Set a rule that budget increases require an explicit architecture decision, not a routine feature PR.
2. Split the three central modules by behavior:
   - `canvas-view.tsx`: pointer state machine, paint runtime, selection runtime, viewport/gesture controller, overlay composition, React shell.
   - `editor-context.tsx`: document store, history store, tool settings, persistence/effects, command dispatch.
   - `menu-bar.tsx`: menu definitions, command bindings, workflow-specific dialog orchestration, rendering.
3. Split `types.ts` by domain and re-export only stable public contracts.
4. Add per-file import/fan-in budgets for the highest-risk coordination modules.
5. Lower limits after each extraction:
   - oversized files: 17 → 14;
   - broad `useEditor`: 29 → 20;
   - top ten: 32,172 → below 29,000.

Success criteria:

- No React component file exceeds 3,000 lines.
- New feature work does not raise architecture caps.
- Canvas and editor state changes can be reviewed in domain-sized modules.

### P1 — Make selector-based state canonical instead of mirroring broad context

Evidence:

- `EditorContextValue` has approximately 71 members.
- The selector store is updated from `useLayoutEffect` after provider value creation.
- Broad `useEditor` and selector consumers coexist.

Recommendations:

1. Make an external editor store the canonical state/command source.
2. Have `useEditorSelector` subscribe directly to versioned store snapshots.
3. Expose command-only hooks for components that dispatch but do not read state.
4. Divide selectors by domain: document, history, tools, panels, rendering, persistence.
5. Enforce stable selector outputs; selectors should return primitives or cached references, not fresh objects.
6. Add render-count tests for high-frequency brush, zoom, and pointer changes.

Success criteria:

- Selector consumers do not require a second post-commit notification.
- Unrelated panels do not rerender during brush movement or zoom.
- Broad context usage becomes exceptional.

### P1 — Increase bundle headroom without creating startup waterfalls

Current production measurements:

| Route | Encoded startup | Decoded startup | Requests |
| --- | ---: | ---: | ---: |
| `/` | 165.6 KiB | 550.9 KiB | 11 |
| `/editor` | 512.2 KiB | 1.67 MiB | 14 |
| `/marketing` | 208.2 KiB | 658.0 KiB | 15 |
| `/documentation` | 140.4 KiB | 467.1 KiB | 10 |

The largest application-owned startup chunk is 950,992 bytes (928.7 KiB) against a 972,800-byte (950 KiB) cap: roughly 21 KiB of headroom.

Large decoder chunks are acceptable when cold:

- raster decoders: about 1.35 MiB decoded;
- document decoders: about 749 KiB decoded.

Recommendations:

1. Target at least 150 KiB of headroom for the largest app-owned startup chunk.
2. Lazy-load workflows, not every visible shell fragment.
3. Keep raster/document decoders out of startup and verify with route-level tests.
4. Add bundle deltas to PR output: route bytes, request count, largest owned chunk, and newly introduced owner modules.
5. Add route-level decoded and request-count budgets, not only a single-chunk cap.
6. Preload likely dialogs on intent (hover/focus/command search) instead of loading all cold code at startup.

Success criteria:

- Largest app-owned startup chunk below 800 KiB.
- `/editor` startup remains below 1.5 MiB decoded.
- Persistent shell renders as one stable readiness boundary.

### P1 — Add real rendered accessibility testing

Evidence:

- `tests/accessibility-audit.spec.ts` tests `createAccessibilityAuditReport` with synthetic input.
- The report model checks declared labels, dimensions, shortcuts, and panel metadata.
- No Axe/ARIA DOM audit dependency or rendered-page violation check was found.

The current “Accessibility Audit” is useful product metadata, but it is not an accessibility conformance test.

Recommendations:

1. Add `@axe-core/playwright` coverage for `/`, `/editor`, `/marketing`, and `/documentation`.
2. Test representative states: command palette, new-document dialog, menus, panel browser, export dialog, and context menu.
3. Add keyboard-only workflows for:
   - opening and closing dialogs;
   - focus return;
   - menu navigation;
   - panel switching;
   - canvas alternative commands.
4. Test zoom at 200%, reduced motion, high contrast, and mobile touch targets.
5. Keep the existing metadata audit, but label it “editor accessibility metadata audit” to avoid implying DOM conformance.

Success criteria:

- Zero serious/critical Axe violations in representative states.
- Focus does not escape dialogs or disappear after close.
- Every primary workflow is reachable without pointer input.

### P2 — Align CI with the repository’s declared verification contract

Evidence:

- `package.json` includes `check:source-hygiene` in `verify`.
- `.github/workflows/ci.yml` manually lists checks but omits source hygiene.
- Full Playwright shards run only on pushes to `main`, not on pull requests.
- The scheduled workflow skips the quality job and runs only visual regression.
- No Dependabot, CodeQL, scheduled `npm audit`, or license check configuration is present.

Recommendations:

1. Make CI call `npm run verify` or share one script/manifest so local and CI verification cannot drift.
2. Run source hygiene on every PR.
3. Run production-mode interaction tests on PRs that touch editor runtime, state, rendering, or CSS.
4. Keep targeted PR selection, but run a small deterministic critical path on every PR.
5. Make the weekly schedule run dependency audit, full type/lint/architecture checks, and the full browser suite.
6. Add explicit least-privilege workflow permissions.
7. Remove shell `eval` from targeted-test execution; emit structured command arguments or invoke a Node runner directly.

Success criteria:

- `npm run verify` and CI execute the same quality gates.
- Scheduled runs exercise more than visual snapshots.
- Retried tests are reported as flakiness debt, not silently accepted.

### P2 — Separate pure module tests from browser E2E tests and measure coverage

Evidence:

- Rough static classification found about 106 node-like spec files, 34 browser-like files, and 2 mixed files.
- Node-style tests currently use Playwright as a general test runner.
- The largest test files exceed 1,000–1,500 lines.
- There is no executable source coverage gate.

Recommendations:

1. Introduce a fast unit runner such as Vitest for pure TypeScript modules.
2. Keep Playwright for browser, canvas, worker, layout, accessibility, and end-to-end behavior.
3. Split mixed files so node config does not silently skip browser cases.
4. Add changed-line coverage for pure algorithms rather than chasing a misleading global percentage.
5. Split the largest specs by subsystem and fixture ownership.

Success criteria:

- Pure tests finish in seconds without starting browser infrastructure.
- Browser-only tests cannot be accidentally skipped by the node config.
- Critical reducers, serializers, sanitizers, and filter kernels have measured branch coverage.

### P2 — Add editor-level error containment and operational telemetry

Evidence:

- No App Router `error.tsx` or `global-error.tsx` file was found.
- Worker modules report local errors, but there is no central runtime-error boundary or telemetry adapter.
- The representative browser run emitted an uncaught Next router error.

Recommendations:

1. Add route-level and editor-level error boundaries.
2. Preserve unsaved-document recovery metadata before presenting a fatal error screen.
3. Add structured error events for:
   - worker fallback;
   - codec failure;
   - WebGL context loss;
   - storage quota/migration failure;
   - API adapter outage;
   - hydration/runtime errors.
4. Keep telemetry provider-agnostic and opt-in, with no document pixels or user content.
5. Add a diagnostics export users can attach to bug reports.

Success criteria:

- A panel or workflow crash does not destroy the entire editor shell.
- Operators can distinguish product errors from browser capability failures.

### P2 — Expand storage governance beyond direct `localStorage`

Evidence:

- The architecture check at `scripts/check-architecture.mjs:195` only detects direct `localStorage`.
- Direct `sessionStorage` remains in `tool-palette.tsx:540` and `panels/discover-panel.tsx:30-39`.
- IndexedDB is opened independently in recent documents, libraries, startup handoff, and other modules.
- `client-storage.ts` already provides useful version descriptors for many localStorage keys.

Recommendations:

1. Expand the storage architecture check to cover localStorage, sessionStorage, IndexedDB, and OPFS entrypoints.
2. Define a central registry with:
   - owner;
   - schema version;
   - migration;
   - quota/eviction policy;
   - sensitivity;
   - reset/export behavior.
3. Add upgrade tests across the last two persisted schema versions.
4. Add quota-exceeded and partial-transaction tests.
5. Avoid synchronous storage reads on interaction/render paths.

Success criteria:

- Every persisted key/database has an owner and migration policy.
- Storage failures degrade predictably without losing the active document.

### P2 — Finish production adapter and abuse-control hardening

Evidence:

- Production correctly fails closed without durable marketing and rate-limit adapters.
- When trusted proxy mode is disabled, `getClientIp` falls back to a hash of user-controlled request headers at `lib/marketing-store.ts:142-149`.
- That fingerprint can be changed by an attacker and can also group unrelated users with identical headers.
- CSP policy text is duplicated in `next.config.mjs:41-56` and `proxy.ts:40-53`.

Recommendations:

1. Ship reference implementations for `MARKETING_RECORD_STORE_URL` and `RATE_LIMIT_SERVICE_URL`.
2. Require a trusted deployment-provided client identity for anonymous abuse controls; treat the header fingerprint only as a weak fallback.
3. Combine identity with authenticated subject, proof-of-work/CAPTCHA, or provider abuse controls for public endpoints where appropriate.
4. Add adapter health checks and structured reason metrics.
5. Generate static and nonce-bearing CSP variants from one shared policy definition.
6. Move Node-only JPEG/WASM loading into a Node-only adapter module and remove `new Function`.

Success criteria:

- Production endpoints are usable without enabling local escape hatches.
- Abuse controls cannot be bypassed by changing common request headers alone.
- CSP changes have one source of truth.

### P2 — Make static export non-destructive and reproducible

Evidence:

- The GitHub Pages workflow runs `rm -rf app/api` before static export at `.github/workflows/deploy-pages.yml:60-61`.
- This is safe only because the CI checkout is disposable.
- Local reproduction requires manually mutating the source tree.

Recommendations:

1. Build the static variant from a separate temporary workspace, generated app tree, or dedicated static entrypoint.
2. Provide one local command that exactly reproduces Pages CI.
3. Verify the build leaves `git status` unchanged.
4. Run capability and architecture checks for the static variant, not only lint/typecheck.

Success criteria:

- Static export never deletes tracked source in the active checkout.
- Local and CI export use the same command.

### P3 — Upgrade dependencies in risk-based batches

`npm audit` currently reports zero vulnerabilities. `npm outdated` shows:

- patch-level Next.js and Radix updates;
- minor `libraw-wasm` and tooling updates;
- major updates for `ag-psd`, `pdfjs-dist`, `react-resizable-panels`, `sonner`, `zod`, TypeScript, Lucide, and other UI packages.

Recommended sequence:

1. Patch-compatible Next.js, Radix, and TypeScript-ESLint updates.
2. Codec/import batch: `ag-psd`, `libraw-wasm`, `pdfjs-dist`, validated with fixture and pixel tests.
3. UI batch: Radix majors, `react-resizable-panels`, Sonner, Lucide.
4. Validation/toolchain batch: Zod and TypeScript major versions.

Every batch should capture bundle deltas and run format-specific fixtures.

### P3 — Reduce review risk from oversized working sets

The current tree contains 89 changed/untracked files, with the tracked diff alone covering 66 files, 2,262 insertions, and 4,882 deletions.

Recommendations:

1. Split mechanical extractions from behavior changes.
2. Commit guardrails before lowering their budgets.
3. Keep security adapter changes separate from editor runtime refactors.
4. Land bundle changes with before/after reports.
5. Avoid combining generated artifact rewrites with source changes.

This is not only repository hygiene. Smaller changes make pixel, persistence, and security regressions easier to isolate.

### P3 — Decide the role of generated bundle artifacts

`npm run analyze:bundle` rewrites `artifacts/bundle-report.json`. The deterministic timestamp is good, but the full report is large and chunk hashes change.

Choose one model:

- Track a small deterministic baseline summary and publish the full report as a CI artifact; or
- Keep the full report tracked and require intentional baseline-update commits.

Routine verification should not create unexplained working-tree noise.

## Recommended Delivery Plan

### Phase 1: Reliability and CI contract

1. Move the main browser suite to production serving.
2. Add runtime-error failure hooks and editor-ready assertions.
3. Fix or isolate the dev/HMR layout failure.
4. Add source hygiene and weekly dependency/quality checks to CI.
5. Add rendered accessibility smoke coverage.

### Phase 2: State and architecture

1. Make the selector store canonical.
2. Extract canvas interaction state machines.
3. Split editor state by domain.
4. Split menu definitions from command/workflow orchestration.
5. Lower architecture budgets after each landed reduction.

### Phase 3: Performance and persistence

1. Consolidate always-visible shell loading.
2. Increase startup-chunk headroom.
3. Add route-level bundle budgets and intent preloading.
4. Centralize storage registry, migrations, and quota handling.

### Phase 4: Production operations

1. Deploy durable marketing/rate-limit adapters.
2. Add trustworthy abuse identity and adapter health metrics.
3. Add error boundaries and privacy-safe diagnostics.
4. Make static export non-destructive.
5. Upgrade dependencies in isolated batches.

## Suggested Outcome Metrics

| Metric | Current | Target |
| --- | ---: | ---: |
| Oversized files (>1,500 lines) | 17 | ≤ 12 |
| Broad `useEditor` import files | 29 | ≤ 15 |
| Top-ten largest files | 32,172 lines | < 27,000 |
| Largest React component file | 6,315 lines | < 3,000 |
| Largest app-owned startup chunk | 928.7 KiB | < 800 KiB |
| `/editor` decoded startup | 1.67 MiB | < 1.5 MiB |
| Critical interaction repeat pass rate | Mixed | 20/20, retries disabled |
| Serious/critical rendered Axe violations | Not measured | 0 |
| Known dependency vulnerabilities | 0 | 0 |
| Direct unregistered storage entrypoints | Not measured | 0 |

## Final Assessment

The project has a strong technical base and has improved materially through recent decomposition, security hardening, and bundle ownership work. The next quality threshold is to make those improvements durable.

Do not expand the feature surface until:

1. browser interaction tests are deterministic outside `next dev`;
2. architecture budgets have meaningful headroom;
3. the editor store is no longer a broad context plus delayed selector mirror;
4. accessibility is tested against rendered UI;
5. production persistence, abuse control, and error containment have deployable implementations.

The existing `BOUNDARIES.md` should continue to define intentional non-goals. The recommendations above focus on browser-achievable reliability, maintainability, performance, accessibility, and operational readiness.
