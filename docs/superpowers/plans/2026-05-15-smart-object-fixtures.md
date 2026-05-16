# Smart Object Fixtures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add repo-local PSD/project fixture coverage and a practical smart-object lifecycle for linked metadata, status, replacement, export, and honest round-trip reporting.

**Architecture:** Keep pixel data in the existing canvas-backed `Layer.smartSource`, add typed lifecycle metadata and pure helpers in a focused module, then wire reducer actions and reports around those helpers. Tests build deterministic local fixture documents and assert project preservation plus PSD/report classification.

**Tech Stack:** Next.js 16, React 19, TypeScript, Playwright component/module tests, Canvas APIs, existing `document-io` and editor context.

---

### Task 1: Fixture Builders and Project Round Trip

**Files:**
- Create: `tests/photoshop-fixtures.ts`
- Create: `tests/project-roundtrip-fixtures.spec.ts`

- [ ] Write fixture builders for canvases, rich documents, and smart-object layers.
- [ ] Add failing tests proving text, shape, masks, guides, slices, layer comps, smart filters, channels, and smart-source metadata survive project serialization.
- [ ] Run `npx playwright test tests/project-roundtrip-fixtures.spec.ts` and verify red.

### Task 2: Smart Object Lifecycle Module

**Files:**
- Modify: `components/photoshop/types.ts`
- Create: `components/photoshop/smart-objects.ts`
- Modify: `components/photoshop/document-io.ts`
- Test: `tests/project-roundtrip-fixtures.spec.ts`

- [ ] Add smart-object metadata types to `Layer.smartSource`.
- [ ] Implement helpers for creating metadata, resolving status, replacing contents, and exporting contents.
- [ ] Preserve metadata through project serialization/deserialization.
- [ ] Run `npx playwright test tests/project-roundtrip-fixtures.spec.ts` and verify green.

### Task 3: Editor State Actions

**Files:**
- Modify: `components/photoshop/editor-context.tsx`
- Modify: `components/photoshop/menu-bar.tsx`
- Test: `tests/smart-object-lifecycle.spec.ts`

- [ ] Add failing reducer-level tests for convert, replace contents, relink status, and export payload.
- [ ] Add reducer actions for smart metadata, replace contents, and relink/missing state.
- [ ] Keep edit-contents save-back compatible with existing `updateSmartObjectParent`.
- [ ] Run `npx playwright test tests/smart-object-lifecycle.spec.ts` and verify green.

### Task 4: PSD and Report Fixtures

**Files:**
- Modify: `components/photoshop/document-io.ts`
- Test: `tests/psd-roundtrip-fixtures.spec.ts`

- [ ] Add failing tests for PSD export/report classification using rich app-only fixtures.
- [ ] Expand reports to classify smart object sources, linked status, edit contents, replace/export contents, PSD rasterization, and unsupported linked file lifecycle.
- [ ] Run `npx playwright test tests/psd-roundtrip-fixtures.spec.ts tests/capabilities.spec.ts` and verify green.

### Task 5: Verification

**Files:**
- No source changes expected.

- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run test:smoke`.
