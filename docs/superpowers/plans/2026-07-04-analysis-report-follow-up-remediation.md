# Analysis Report Follow-up Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every correctness regression and verification-gate failure identified in the reviewed dirty worktree report.

**Architecture:** Keep autosave planning authoritative, make partial recomposition explicitly conservative, and preserve known-good recovery data ahead of failed persistent writes. Centralize boolean deployment configuration, make selector caches sensitive to selector/equality changes, and test the production tile planner directly.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Playwright, IndexedDB, OPFS.

---

### Task 1: Autosave recovery behavior

**Files:**
- Modify: `components/photoshop/autosave-recovery.tsx`
- Modify: `tests/document-lifecycle.spec.ts`
- Modify: `tests/photoshop-pixel-regression.spec.ts`

- [ ] Run the two failing autosave browser tests and confirm clean unsaved documents are skipped.
- [ ] Extend the browser assertions to require recovery entries for every newly created or duplicated document and for preference-enabled autosave.
- [ ] Remove the dirty-only eager scheduling guard; let `planAutosaveDocuments` decide whether serialization is required.
- [ ] Re-run both autosave tests with retries disabled.

### Task 2: Conservative partial recomposition and canonical planner tests

**Files:**
- Modify: `components/photoshop/document-tile-recomposition.ts`
- Modify: `components/photoshop/canvas-view.tsx`
- Modify: `components/photoshop/layer-tile-renderer.ts`
- Modify: `tests/performance-2-9.spec.ts`

- [ ] Change the test import to the production planner and remove the duplicate planner implementation.
- [ ] Add failing planner assertions that effects, knockout, color management, and effect halos require a full frame.
- [ ] Extend the planner input with document rendering semantics and return `full-frame` for any unsupported partial-composition feature.
- [ ] Require a planner result with no semantic fallback reasons before CanvasView uses `composeDocumentTile`.
- [ ] Re-run planner, compositor, and canvas regression tests.

### Task 3: Storage correctness

**Files:**
- Modify: `components/photoshop/libraries-store.ts`
- Modify: `components/photoshop/opfs-scratch.ts`
- Modify: `components/photoshop/recent-documents.ts`
- Modify: `tests/storage-governance.spec.ts`
- Modify: `tests/collaboration-libraries.spec.ts`

- [ ] Add a failing library import test whose bitmap reports zero dimensions after close.
- [ ] Capture bitmap dimensions before rendering/closing it.
- [ ] Add a failing OPFS test where file creation succeeds, writing fails, and a stale persistent file remains.
- [ ] Make an in-memory fallback authoritative until a later persistent write succeeds, and clear it after successful persistence.
- [ ] Add a failing quota-recovery test that ranks retained autosaves by active-document priority and recency.
- [ ] Replace insertion-order `slice(0, 1)` recovery with deterministic priority/recency retention and retry the largest useful subset.
- [ ] Re-run storage and library tests.

### Task 4: Health readiness and selector freshness

**Files:**
- Modify: `app/api/health/route.ts`
- Modify: `lib/adapter-health.ts`
- Modify: `tests/unit/health-routes.test.ts`
- Modify: `components/photoshop/editor-context.tsx`
- Modify: `tests/unit/editor-store.test.ts`

- [ ] Add failing health tests for `readiness: false` on HTTP 503 and `MARKETING_TRUSTED_PROXY=false`.
- [ ] Use the runtime’s accepted `true`/`1` boolean contract for trusted-proxy health.
- [ ] Set readiness equal to actual adapter health.
- [ ] Add a pure selector-cache regression test for a selector capturing a changed document id at the same store version.
- [ ] Include selector and equality identities in cache validity for both editor selector hooks.
- [ ] Re-run health, editor-store, and document lifecycle tests.

### Task 5: Diagnostics and repository gates

**Files:**
- Modify: `components/photoshop/status-bar.tsx`
- Modify: `tests/io-color-filter-hardening.spec.ts`
- Modify: `tests/right-panel-status-context.spec.ts`
- Modify: `scripts/architecture-budgets.json`
- Modify: `components/photoshop/menu-bar.tsx`
- Modify: `vitest.config.ts`
- Modify: `scripts/critical-coverage-modules.json`

- [ ] Keep detailed browser diagnostics in the lower panel and restore a lightweight always-visible high-bit/non-RGB precision warning in the status bar.
- [ ] Update rendered tests to assert the split contract.
- [ ] Reduce MenuBar imports to the configured budget by importing cohesive dialog/workflow modules through existing focused boundaries.
- [ ] Refine critical-coverage matching so UI coordinator names are not classified as algorithm modules, and include/test the changed reducer model.
- [ ] Run architecture and changed-coverage gates and fix all reported violations without raising budgets.

### Task 6: Final verification

**Files:**
- Modify only files required by failures discovered above.

- [ ] Run strict lint, TypeScript, unit tests, architecture, changed coverage, production build, bundle policy, smoke tests, dependency audit, and targeted browser regressions.
- [ ] Run the full non-visual Playwright suite.
- [ ] Review the final diff against every report finding and preserve unrelated dirty-worktree changes.
