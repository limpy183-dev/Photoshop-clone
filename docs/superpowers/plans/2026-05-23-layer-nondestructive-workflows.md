# Layer Non-Destructive Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete layer/non-destructive editing workflows across data model, reducer actions, panels, project/PSD reports, and tests.

**Architecture:** Keep the existing reducer and panel architecture. Add focused workflow helpers in `components/photoshop/layer-workflows.ts`, extend existing types, and wire UI panels to those helpers.

**Tech Stack:** Next.js 16, React 19, TypeScript, Canvas 2D, Playwright tests, existing Photoshop Web modules.

---

### Task 1: Model And Helper Coverage

**Files:**
- Create: `components/photoshop/layer-workflows.ts`
- Modify: `components/photoshop/types.ts`
- Test: `tests/layer-nondestructive-workflows.spec.ts`

- [ ] Add tests for richer layer comp capture, tokenized layer search, guide/slice normalization, smart-filter reordering, and layer metadata defaults.
- [ ] Implement helper functions and type extensions.
- [ ] Run `npx playwright test tests/layer-nondestructive-workflows.spec.ts`.

### Task 2: Reducer Actions

**Files:**
- Modify: `components/photoshop/editor-context.tsx`
- Test: `tests/layer-nondestructive-workflows.spec.ts`

- [ ] Add tests for layer notes/metadata, guide patches, slice duplication, smart-filter stack actions, adjustment mask commands, and smart-object edit packages.
- [ ] Implement typed reducer actions.
- [ ] Run `npx playwright test tests/layer-nondestructive-workflows.spec.ts`.

### Task 3: Panels And Dialogs

**Files:**
- Modify: `components/photoshop/panels/layers-panel.tsx`
- Modify: `components/photoshop/panels/layer-comps-panel.tsx`
- Modify: `components/photoshop/layer-comps-dialog.tsx`
- Modify: `components/photoshop/panels/guides-panel.tsx`
- Modify: `components/photoshop/panels/slices-panel.tsx`
- Modify: `components/photoshop/menu-bar.tsx`
- Test: `tests/layer-nondestructive-ui.spec.ts`

- [ ] Add failing workflow tests for token search, layer comp capture/apply, guide/slice actions, smart-object menu actions, and smart-filter controls.
- [ ] Wire compact UI controls to the reducer helpers.
- [ ] Run `npx playwright test tests/layer-nondestructive-ui.spec.ts`.

### Task 4: Project, PSD, And Reports

**Files:**
- Modify: `components/photoshop/document-io.ts`
- Modify: `components/photoshop/psd-resources-metadata.ts`
- Test: `tests/project-roundtrip-fixtures.spec.ts`
- Test: `tests/psd-resources-metadata.spec.ts`
- Test: `tests/psd-roundtrip-fixtures.spec.ts`

- [ ] Extend round-trip tests for new app-only metadata.
- [ ] Preserve project metadata and improve PSD/report classification.
- [ ] Run the focused I/O tests.

### Task 5: Verification

**Files:**
- No source edits expected.

- [ ] Run `npm run typecheck`.
- [ ] Run focused Playwright tests for the changed workflows.
- [ ] Run broader smoke tests if time allows.
