# July 2 Deep Analysis Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement every repository-local recommendation and success criterion in `docs/codebase-deep-analysis-report-2026-07-02-codex.md`, while providing deployable reference contracts for infrastructure that cannot be provisioned from this repository.

**Architecture:** Stabilize the production test host and CI contract first, then move editor subscriptions onto a synchronous external store and extract the three largest UI coordination modules. Add accessibility, storage, runtime-error, telemetry, adapter, static-export, dependency, and bundle guardrails as independently testable modules. Preserve existing public editor commands and the current dirty working tree.

**Tech Stack:** Next.js 16, React 19, TypeScript, Playwright, Vitest, Axe, GitHub Actions, browser storage APIs, Node HTTP adapters.

---

### Task 1: Deterministic production browser host

**Files:**
- Modify: `playwright.config.ts`
- Create: `playwright.dev.config.ts`
- Create: `playwright.repeat.config.ts`
- Create: `tests/support/runtime-guard.ts`
- Modify: `tests/photoshop-paint-history.spec.ts`
- Modify: `package.json`

- [ ] Add a failing configuration test in `tests/browser-test-contract.spec.ts` that imports the three configs and asserts the main suite uses `scripts/serve-next-smoke.mjs`, the dev suite uses `next dev`, and the repeat suite has `retries: 0`.
- [ ] Run `npx playwright test tests/browser-test-contract.spec.ts --config=playwright.node.config.ts` and confirm it fails because the main suite still uses `next dev`.
- [ ] Switch the main suite to the built production server, add the dedicated dev and repeat configs, and add `test:dev`, `test:repeat:critical`, and `test:full` scripts with explicit configurations.
- [ ] Add a reusable runtime guard that fails on uncaught page errors, error-level console messages, Next error overlays, off-viewport canvas stages, or empty composited canvases. Install it in the paint-history suite before gestures.
- [ ] Run the contract test and the critical paint-history repeat lane with retries disabled.

### Task 2: Stable editor shell and readiness boundary

**Files:**
- Modify: `components/photoshop/editor-app.tsx`
- Create: `components/photoshop/editor-shell.tsx`
- Create: `components/photoshop/dialog-preload.ts`
- Modify: `tests/browser-test-contract.spec.ts`

- [ ] Add a failing source-level test that rejects separate `next/dynamic` boundaries for the persistent Menu Bar, Options Bar, Document Tabs, Tool Palette, Panel Dock, Status Bar, and Canvas View.
- [ ] Replace the seven asynchronous persistent-chrome imports with one statically imported `EditorShell`; retain lazy loading for cold dialogs, workspaces, and codecs.
- [ ] Add intent preload functions for the command palette, new-document, export, and image/canvas-size workflows and call them from hover/focus/command entry points.
- [ ] Mark the shell ready only after the stage has valid viewport geometry and composited pixels, then make the runtime guard wait on that marker.
- [ ] Re-run the contract and smoke tests.

### Task 3: Canonical editor selector store

**Files:**
- Create: `components/photoshop/editor-store.ts`
- Create: `components/photoshop/editor-selectors.ts`
- Modify: `components/photoshop/editor-context.tsx`
- Create: `tests/editor-store.spec.ts`
- Create: `tests/editor-render-isolation.spec.tsx`

- [ ] Write failing tests proving store transitions publish the new snapshot synchronously, command-only subscriptions do not change on state updates, and memoized domain selectors preserve object identity for unrelated changes.
- [ ] Implement a versioned external store with `getSnapshot`, `subscribe`, `transition`, and stable command access. Make it the canonical owner used by the provider rather than updating a mirror in `useLayoutEffect`.
- [ ] Add document, history, tool, panel, rendering, and persistence selectors. Return primitives or memoized references only.
- [ ] Change `useEditorSelector` to `useSyncExternalStore` directly against the canonical store and add `useEditorCommands`.
- [ ] Add render-count tests showing unrelated panel subscribers do not rerender for brush movement, zoom, or pointer-state changes.
- [ ] Run store, render isolation, type, and existing transition tests.

### Task 4: Extract canvas, editor-state, menu, and type domains

**Files:**
- Modify: `components/photoshop/canvas-view.tsx`
- Create: `components/photoshop/canvas-pointer-runtime.ts`
- Create: `components/photoshop/canvas-paint-runtime.ts`
- Create: `components/photoshop/canvas-selection-runtime.ts`
- Create: `components/photoshop/canvas-overlay-runtime.tsx`
- Modify: `components/photoshop/editor-context.tsx`
- Create: `components/photoshop/editor-reducer.ts`
- Create: `components/photoshop/editor-history-state.ts`
- Create: `components/photoshop/editor-persistence.ts`
- Modify: `components/photoshop/menu-bar.tsx`
- Create: `components/photoshop/menu-definitions.ts`
- Create: `components/photoshop/menu-workflows.ts`
- Modify: `components/photoshop/types.ts`
- Create: `components/photoshop/types/document.ts`
- Create: `components/photoshop/types/tools.ts`
- Create: `components/photoshop/types/rendering.ts`
- Create: `components/photoshop/types/persistence.ts`
- Modify: `scripts/check-architecture.mjs`
- Modify: `scripts/architecture-budgets.json`
- Modify: `tests/architecture-gates.spec.ts`

- [ ] Add failing architecture tests for per-file line/fan-in limits and targets: no React component above 3,000 lines, at most 14 files above 1,500 lines, at most 20 broad `useEditor` imports, and top-ten total below 29,000.
- [ ] Move pure pointer, paint, selection, overlay, reducer, history, persistence, menu-definition, workflow, and domain-type logic into focused modules while preserving exported contracts.
- [ ] Convert dispatch-only and small read-heavy consumers to `useEditorCommands` or domain selectors until broad imports are at or below 20.
- [ ] Add fan-in/import-count output and budget enforcement for `canvas-view.tsx`, `editor-context.tsx`, and `menu-bar.tsx`.
- [ ] Tighten only earned budgets and run architecture, transition, canvas, menu, and type checks.

### Task 5: Bundle budgets, deltas, and artifact policy

**Files:**
- Modify: `scripts/measure-route-bundles.mjs`
- Modify: `scripts/analyze-bundle.mjs`
- Modify: `scripts/architecture-budgets.json`
- Create: `artifacts/bundle-baseline.json`
- Modify: `.gitignore`
- Modify: `tests/architecture-gates.spec.ts`

- [ ] Add failing tests for decoded route-size, request-count, largest-owned-chunk, owner-module, and baseline-delta fields.
- [ ] Emit compact deterministic `bundle-baseline.json`; treat the full bundle report as a generated CI artifact.
- [ ] Enforce `/editor` decoded startup below 1.5 MiB, largest app-owned startup chunk below 800 KiB, and route request-count budgets.
- [ ] Print per-route byte/request deltas and newly introduced owner modules in CI-readable output.
- [ ] Run production build and bundle analysis; if limits fail, move newly identified cold workflow modules behind intent-preloaded imports without splitting persistent chrome.

### Task 6: Rendered accessibility and keyboard coverage

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tests/accessibility-rendered.spec.ts`
- Modify: `components/photoshop/accessibility-audit.ts`
- Modify: `components/photoshop/panels/accessibility-audit-panel.tsx`

- [ ] Install `@axe-core/playwright` and write failing serious/critical violation checks for `/`, `/editor`, `/marketing`, and `/documentation`.
- [ ] Exercise command palette, new-document, menu, panel browser, export dialog, and context-menu states with focus-trap and focus-return assertions.
- [ ] Add keyboard-only primary workflow, 200% zoom, reduced-motion, forced-colors, mobile touch-target coverage.
- [ ] Rename the existing product report to “Editor accessibility metadata audit” in code and rendered labels.
- [ ] Fix discovered serious/critical violations and run the accessibility suite in production mode.

### Task 7: One local/CI verification contract

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/select-pr-tests.mjs`
- Create: `scripts/run-selected-tests.mjs`
- Modify: `package.json`
- Modify: `tests/pr-test-selection.spec.ts`

- [ ] Add failing tests that require JSON argument output from PR selection and reject shell `eval`.
- [ ] Make the quality job run `npm run verify:quality`, including strict lint, typecheck, source hygiene, capabilities, architecture, unused scaffolds, build, bundle, and smoke.
- [ ] Invoke selected tests through a Node runner using argument arrays.
- [ ] Run a deterministic critical production browser lane on every PR and production interaction shards for editor runtime/state/rendering/CSS changes.
- [ ] Add least-privilege workflow permissions and make the weekly schedule run audit, quality, full browser, accessibility, and visual checks while surfacing retries as flakiness.

### Task 8: Unit runner and changed-line coverage

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.ts`
- Create: `scripts/check-changed-coverage.mjs`
- Move: pure-module specs from `tests/*.spec.ts` to `tests/unit/*.test.ts`
- Modify: `playwright.node.config.ts`

- [ ] Install Vitest and V8 coverage, add a failing sample coverage contract, and ensure pure tests run without Playwright/browser startup.
- [ ] Move pure reducer, serializer, sanitizer, filter-kernel, and storage tests to Vitest; split the two mixed specs into browser and unit files.
- [ ] Add changed-line branch coverage for pure source touched by a PR and a guard preventing browser-only tests from matching the node/unit config.
- [ ] Add `test:unit` and `test:coverage:changed` to local and CI verification and run both suites.

### Task 9: Runtime error containment, recovery, and privacy-safe diagnostics

**Files:**
- Create: `app/error.tsx`
- Create: `app/global-error.tsx`
- Create: `components/photoshop/editor-error-boundary.tsx`
- Create: `components/photoshop/runtime-telemetry.ts`
- Create: `components/photoshop/diagnostics-export.ts`
- Modify: `components/photoshop/editor-app.tsx`
- Modify: worker, codec, WebGL, storage, and hydration call sites
- Create: `tests/runtime-resilience.spec.ts`

- [ ] Write failing tests for route/editor containment, recovery metadata capture, telemetry redaction, and diagnostics export.
- [ ] Add route and editor boundaries that preserve autosave/recovery metadata before displaying a recover/reload screen.
- [ ] Implement an opt-in provider-neutral event sink for worker fallback, codec failure, WebGL context loss, storage quota/migration failure, adapter outage, and hydration/runtime errors.
- [ ] Explicitly reject blobs, pixel buffers, document content, file names, and free-form user text from telemetry.
- [ ] Add downloadable diagnostics containing versions, capabilities, fallback events, and sanitized stack summaries.
- [ ] Run resilience, security, and production smoke tests.

### Task 10: Central storage governance

**Files:**
- Create: `components/photoshop/storage-registry.ts`
- Modify: `components/photoshop/client-storage.ts`
- Modify: `components/photoshop/tool-palette.tsx`
- Modify: `components/photoshop/panels/discover-panel.tsx`
- Modify: IndexedDB and OPFS entrypoint modules
- Modify: `scripts/check-architecture.mjs`
- Modify: `scripts/architecture-budgets.json`
- Create: `tests/storage-governance.spec.ts`

- [ ] Write failing tests requiring owner, schema version, migration, quota/eviction, sensitivity, reset, and export metadata for every localStorage, sessionStorage, IndexedDB, and OPFS entrypoint.
- [ ] Implement the registry and route session keys, databases, and OPFS roots through typed registered adapters.
- [ ] Expand architecture scanning to reject direct browser storage entrypoints outside registered adapters.
- [ ] Add upgrade fixtures for the previous two schema versions plus quota-exceeded and interrupted-transaction tests.
- [ ] Ensure interaction/render paths use cached asynchronous storage rather than synchronous reads and run storage/architecture tests.

### Task 11: Production adapters, identity, CSP, and Node-only codecs

**Files:**
- Create: `app/api/health/route.ts`
- Create: `docs/reference-adapters/marketing-record-store.ts`
- Create: `docs/reference-adapters/rate-limit-service.ts`
- Create: `lib/client-identity.ts`
- Create: `lib/security-policy.ts`
- Modify: `lib/marketing-store.ts`
- Modify: `lib/rate-limit-store.ts`
- Modify: `next.config.mjs`
- Modify: `proxy.ts`
- Create: `components/photoshop/raster-codecs.node.ts`
- Modify: `components/photoshop/raster-codecs.ts`
- Modify: `tests/marketing-security.spec.ts`
- Create: `tests/security-policy.spec.ts`

- [ ] Add failing tests for reference adapter contracts, trusted deployment identity, weak-fallback labeling, health reasons, one CSP source, and absence of `new Function`.
- [ ] Ship runnable reference HTTP adapters with durable interface contracts and health responses.
- [ ] Require trusted proxy/provider identity in production, combine it with authenticated subject/provider proof when supplied, and expose the header fingerprint only as an explicitly weak development fallback.
- [ ] Add privacy-safe adapter reason metrics and a health endpoint that never exposes secrets.
- [ ] Generate static and nonce CSP variants from one shared policy definition.
- [ ] Move JPEG/WASM Node loading into a server-only adapter using ordinary dynamic imports.
- [ ] Run security, CSP, codec, audit, type, and production build tests.

### Task 12: Non-destructive static export

**Files:**
- Create: `scripts/build-static-export.mjs`
- Modify: `.github/workflows/deploy-pages.yml`
- Modify: `package.json`
- Create: `tests/static-export-contract.spec.ts`

- [ ] Add a failing test that rejects `rm -rf app/api`, runs the local export command, and verifies tracked/untracked status is unchanged.
- [ ] Build a temporary generated app tree or temporary worktree, omit server routes there, and copy only the resulting `out` artifact back.
- [ ] Use `npm run build:static` locally and in Pages CI; run capability, architecture, and static smoke checks against the variant.
- [ ] Verify the active checkout remains byte-for-byte unchanged outside `out`.

### Task 13: Risk-batched dependency upgrades

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: affected codec, UI, validation, and test files

- [ ] Apply patch-compatible Next.js, Radix, and TypeScript-ESLint updates and record bundle deltas.
- [ ] Upgrade codec/import packages as one batch and run fixture/pixel tests.
- [ ] Upgrade UI majors as one batch and run rendered accessibility/visual tests.
- [ ] Upgrade Zod and TypeScript majors as one batch, adapting schemas and compiler settings.
- [ ] Run `npm audit --audit-level=low`, full quality verification, production browser tests, and bundle analysis after each batch. Keep upgrades only when all required checks pass.

### Task 14: Final verification and report status

**Files:**
- Modify: `docs/codebase-deep-analysis-report-2026-07-02-codex.md`

- [ ] Run focused unit, architecture, security, storage, accessibility, and critical-repeat tests.
- [ ] Run `npm run verify`, the full production Playwright suite, the dedicated dev suite, and `npm audit --audit-level=low`.
- [ ] Run the paint-history scenario twenty times with retries disabled.
- [ ] Record before/after architecture and bundle metrics plus exact infrastructure deployment requirements.
- [ ] Mark each report recommendation implemented, externally deployable, or blocked by a specific failed verification; do not claim completion for unexecuted checks.
