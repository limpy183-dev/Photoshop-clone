# Missing Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add direct regression coverage for important production helpers and compatibility contracts that are currently exercised only indirectly or not at all.

**Architecture:** Keep the existing Playwright test runner and add deterministic module-level specs that run under `playwright.node.config.ts`. Reuse the repository's canvas fixture for image and vector tests, and use small in-memory browser API stubs for storage, events, fullscreen, plugin host, and clipboard behavior.

**Tech Stack:** TypeScript 5.7, Playwright Test 1.59, Next.js 16 repository modules.

---

### Task 1: Presets, Storage, and Metadata

**Files:**
- Create: `tests/editor-helper-coverage.spec.ts`
- Test: `components/photoshop/new-document-presets.ts`
- Test: `components/photoshop/startup-documents.ts`
- Test: `components/photoshop/recent-colors.ts`
- Test: `components/photoshop/menu-customization.ts`
- Test: `components/photoshop/preset-stores.ts`
- Test: `components/photoshop/filters-meta.ts`
- Test: `components/photoshop/tool-tooltip-content.ts`

- [ ] **Step 1: Add direct behavior tests**

Cover unit conversion round trips, mode-specific defaults, memory estimates, preset document creation, recent-color normalization and persistence, menu input sanitization and ordering, gradient/pattern normalization, filter metadata registry consistency, and tooltip entry completeness.

- [ ] **Step 2: Run the focused spec**

Run: `npx playwright test --config=playwright.node.config.ts tests/editor-helper-coverage.spec.ts`

Expected: all tests pass with no browser server.

### Task 2: Automation Commands

**Files:**
- Create: `tests/automation-commands.spec.ts`
- Test: `components/photoshop/automation-commands.ts`

- [ ] **Step 1: Add algorithm and serialization tests**

Cover proportional and unconstrained fitting, no-enlarge behavior, pixel interpolation, conditional mode changes, purge estimates, transparency flattening, CSS generation, SVG path generation, and SVG document generation.

- [ ] **Step 2: Run the focused spec**

Run: `npx playwright test --config=playwright.node.config.ts tests/automation-commands.spec.ts`

Expected: all tests pass.

### Task 3: Action Manager Descriptors

**Files:**
- Create: `tests/action-manager-descriptors.spec.ts`
- Test: `components/photoshop/action-manager-descriptors.ts`

- [ ] **Step 1: Add descriptor contract tests**

Cover coercion bounds, target resolution, filter parameter normalization, record-to-descriptor round trips, unknown descriptor rejection, read/select replay, mutating replay dispatches, touched-layer commits, and unsupported operations.

- [ ] **Step 2: Run the focused spec**

Run: `npx playwright test --config=playwright.node.config.ts tests/action-manager-descriptors.spec.ts`

Expected: all tests pass and the source module's documented missing test file now exists.

### Task 4: Plugin Host and Lifecycle Contracts

**Files:**
- Create: `tests/plugin-host-contract.spec.ts`
- Test: `components/photoshop/plugin-host-api.ts`
- Test: `components/photoshop/plugin-lifecycle.ts`

- [ ] **Step 1: Add host dispatch and harness tests**

Cover method allow-list completeness, metadata and document queries, layer dispatch validation, plugin-scoped storage, Action Manager and command forwarding, structured error responses, lifecycle suite continuation after errors, smoke templates, input validation, and bounded summaries.

- [ ] **Step 2: Run the focused spec**

Run: `npx playwright test --config=playwright.node.config.ts tests/plugin-host-contract.spec.ts`

Expected: all tests pass.

### Task 5: Screen Modes and Zoom Events

**Files:**
- Create: `tests/screen-modes.spec.ts`
- Test: `components/photoshop/screen-modes.ts`
- Test: `components/photoshop/zoom-events.ts`

- [ ] **Step 1: Add pure state and browser API fallback tests**

Cover all resolved visibility states, cycle order, labels, standard and prefixed fullscreen APIs, denied requests, apply-mode transitions, and typed zoom event payloads.

- [ ] **Step 2: Run the focused spec**

Run: `npx playwright test --config=playwright.node.config.ts tests/screen-modes.spec.ts`

Expected: all tests pass.

### Task 6: Vector Clipboard Formatters

**Files:**
- Create: `tests/vector-clipboard-formatters.spec.ts`
- Test: `components/photoshop/vector-clipboard-formatters.ts`

- [ ] **Step 1: Add CSS, SVG, capability, and clipboard tests**

Cover shape CSS with non-uniform corners and effects, normalized SVG bounds and XML escaping, path/vector-mask eligibility, secure Clipboard API success, legacy textarea fallback, and failure behavior.

- [ ] **Step 2: Run the focused spec**

Run: `npx playwright test --config=playwright.node.config.ts tests/vector-clipboard-formatters.spec.ts`

Expected: all tests pass.

### Task 7: Integrated Verification

**Files:**
- Modify only tests or production code required by a failing regression.

- [ ] **Step 1: Run all new node-level specs together**

Run: `npx playwright test --config=playwright.node.config.ts tests/editor-helper-coverage.spec.ts tests/automation-commands.spec.ts tests/action-manager-descriptors.spec.ts tests/plugin-host-contract.spec.ts tests/screen-modes.spec.ts tests/vector-clipboard-formatters.spec.ts`

Expected: all new tests pass.

- [ ] **Step 2: Run static validation**

Run: `npm run typecheck`

Expected: exit code 0.

- [ ] **Step 3: Run the full Playwright suite**

Run: `npx playwright test`

Expected: compare against the recorded baseline of 720 passed and 34 pre-existing UI failures; no new failures may be introduced.

- [ ] **Step 4: Review the diff**

Run: `git diff --check` and inspect `git diff --stat`.

Expected: no whitespace errors and only the plan plus focused test files unless a test exposed a production defect.
