# Deep Analysis Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement every actionable recommendation and acceptance criterion in `docs/codebase-deep-analysis-report-2026-07-03-codex.md`.

**Architecture:** Keep the reducer-backed `EditorStore<EditorState>` as the only mutable editor snapshot, expose state through equality-aware selectors, and expose commands/rendering through stable contexts. Move optional diagnostics and workflow code behind intent-loaded boundaries, enforce storage and operational policies at real call sites, and make quality gates prove bundle, coverage, security, resilience, and architectural headroom.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Playwright, IndexedDB, OPFS, Node.js 22.

---

### Task 1: Release-contract bundle gate

**Files:**
- Modify: `components/photoshop/status-bar.tsx`
- Modify: `components/photoshop/panels/browser-diagnostics-panel.tsx`
- Create: `tests/unit/bundle-report.test.ts`
- Modify: `vitest.config.ts`

- [ ] Write a Vitest test that reads a fixture-shaped bundle report and rejects every non-empty `violations` array.
- [ ] Run `npm.cmd run test:unit -- tests/unit/bundle-report.test.ts` and verify the missing checker fails.
- [ ] Add a pure bundle-report assertion helper and use it from the test.
- [ ] Remove codec, compatibility, large-document, tile, filter-preview, and memory-planning imports from the always-mounted status bar; keep those diagnostics in the lazy browser diagnostics panel.
- [ ] Replace diagnostics-panel imports from the `document-io` facade with leaf download and diagnostics-export imports.
- [ ] Build and run `npm.cmd run analyze:bundle`; require `/editor` below 1,572,864 decoded bytes and 24 requests.

### Task 2: Canonical state and scheduling

**Files:**
- Modify: `components/photoshop/editor-store.ts`
- Modify: `components/photoshop/editor-context.tsx`
- Modify: `components/photoshop/editor-context-contract.ts`
- Delete: `components/photoshop/editor-selector-store.ts`
- Modify: persistent editor consumers under `components/photoshop/`
- Create: `tests/unit/editor-store-selector.test.ts`
- Create: `tests/editor-interaction-profiler.spec.ts`

- [ ] Add failing store tests for equality-aware selection and one coalesced notification per animation frame.
- [ ] Add `subscribeSelector(selector, equality, listener)` over the canonical store and a `scheduleNotify` method that never claims `startTransition` semantics.
- [ ] Replace the computed-context mirror with state selectors and stable command/render contexts.
- [ ] Migrate CanvasView, MenuBar, OptionsBar, LayersPanel, PropertiesPanel, EditorApp, command palette, and shortcut handling off broad `useEditor()`.
- [ ] Add a repeatable browser benchmark for brush completion, undo, and zoom that records React commit counts and timing.
- [ ] Lower the broad-context architecture budget to eight or fewer.

### Task 3: Coordinator decomposition and architecture headroom

**Files:**
- Modify: `components/photoshop/canvas-view.tsx`
- Create: `components/photoshop/canvas/controllers/*`
- Modify: `components/photoshop/menu-bar.tsx`
- Create: `components/photoshop/menus/menu-dialog-reducer.ts`
- Create/modify: domain hooks under `components/photoshop/menus/`
- Modify: `components/photoshop/events.ts`
- Create: domain event contracts under `components/photoshop/events/`
- Modify: `scripts/architecture-budgets.json`

- [ ] Extract canvas composition/cache, pointer/stroke, selection/transform, filter/lighting, text/path overlay, and typed event-subscription controllers with existing behavior tests kept green.
- [ ] Replace menu dialog booleans with a discriminated reducer and move file/image/layer/selection/filter/workspace orchestration into domain services.
- [ ] Split event payload contracts by domain and replace public `unknown` payloads with bounded domain types.
- [ ] Verify CanvasView is below 3,500 lines, MenuBar below 1,500 lines, oversized files at most ten, and top-ten files below 24,000 lines.
- [ ] Lower import, line, and broad-context budgets in the same change.

### Task 4: Fast tests and changed coverage

**Files:**
- Modify: `vitest.config.ts`
- Modify: `scripts/check-changed-coverage.mjs`
- Create: `scripts/critical-coverage-modules.json`
- Move/port: pure module specs from `tests/*.spec.ts` to `tests/unit/*.test.ts`
- Modify: `scripts/select-pr-tests.mjs`

- [ ] Add a failing unit test proving a changed critical file absent from `coverage-final.json` is rejected.
- [ ] Make the checker enumerate changed critical files first, fail missing coverage entries, and enforce changed statement and branch coverage.
- [ ] Maintain explicit critical-module patterns covering reducers, serializers, sanitizers, filters, and algorithms.
- [ ] Port pure Node-compatible specs in subsystem batches and run the full Vitest lane without starting Next.
- [ ] Make PR selection always run the complete unit lane and select only browser-dependent Playwright specs.

### Task 5: Storage governance enforcement

**Files:**
- Modify: `components/photoshop/storage-registry.ts`
- Modify: `components/photoshop/recent-documents.ts`
- Modify: `components/photoshop/libraries-storage.ts`
- Modify: `components/photoshop/startup-file-handoff.ts`
- Modify: `components/photoshop/image-assets-generator-storage.ts`
- Modify: `components/photoshop/opfs-scratch.ts`
- Modify: `tests/storage-governance.spec.ts`
- Modify: `scripts/check-unused-scaffolds.mjs`

- [ ] Add resource-specific migration functions for the current and prior two descriptor versions.
- [ ] Route quota-sensitive writes through registered recovery behavior and real IndexedDB writes through registered atomic transactions.
- [ ] Make scratch/OPFS writes recover from quota by evicting scratch artifacts before one retry.
- [ ] Add real upgrade, interruption, and partial-write tests for each registered resource.
- [ ] Add a static gate requiring production call sites for every governance policy a descriptor claims.

### Task 6: Cost controls and operations

**Files:**
- Modify: `app/api/photoshop/generative-fill/route.ts`
- Modify: `lib/rate-limit-store.ts`
- Create: `lib/operational-metrics.ts`
- Modify: `tests/marketing-security.spec.ts`
- Create: `app/api/health/live/route.ts`
- Create: `tests/health-routes.spec.ts`

- [ ] Add a failing test proving mutable request headers do not change a subject's minute bucket.
- [ ] Key paid minute quota only by authenticated subject.
- [ ] Add a shared lease/semaphore operation to the durable rate-limit adapter and fail closed in production when distributed concurrency is unavailable.
- [ ] Emit structured adapter/quota metrics containing no prompts or pixels.
- [ ] Split unconditional liveness from adapter readiness and test both routes.

### Task 7: Diagnostics and error isolation

**Files:**
- Modify: `components/photoshop/panels/browser-diagnostics-panel.tsx`
- Modify: `components/photoshop/diagnostics-export.ts`
- Modify: `components/photoshop/runtime-telemetry.ts`
- Modify: `components/photoshop/editor-error-boundary.tsx`
- Create: `components/photoshop/feature-error-boundary.tsx`
- Modify: panel and dialog host components
- Modify: `tests/runtime-resilience.spec.ts`

- [ ] Add a diagnostics JSON download action including runtime events, capabilities, last autosave, and recovery availability.
- [ ] Remove the unconfigured telemetry sink abstraction or configure it only through explicit opt-in.
- [ ] Wrap panel stacks and high-risk dialogs in resettable feature boundaries that preserve the canvas.
- [ ] Make fatal recovery copy depend on actual autosave availability and include the last successful autosave time.
- [ ] Add browser tests that throw inside a panel and dialog and verify canvas/editor usability remains.

### Task 8: Incremental maintenance and final verification

**Files:**
- Create: `components/photoshop/checked-canvas-context.ts`
- Modify: risky Canvas 2D callers as identified by typecheck/search
- Modify: `tsconfig.json` only for scoped strict projects where supported
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `artifacts/bundle-baseline.json`

- [ ] Add tests for checked Canvas 2D acquisition and migrate touched non-null assertions.
- [ ] Enable `noUncheckedIndexedAccess` in scoped subsystem typechecks without breaking the full project.
- [ ] Update `ag-psd` to the latest compatible patch and run PSD fixture/round-trip tests.
- [ ] Trial TypeScript 5.9 through lint, typecheck, unit tests, and build; retain it only if all pass.
- [ ] Run `npm.cmd run verify`, the full non-visual Playwright suite, changed coverage, audit, and architecture JSON.
- [ ] Update the bundle baseline only after all route budgets pass and record the measured editor startup delta.
