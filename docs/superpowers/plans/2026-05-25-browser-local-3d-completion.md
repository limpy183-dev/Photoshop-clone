# Browser Local 3D Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining 3D gaps with honest browser-local equivalents instead of native Photoshop/GPU/vendor/printer-driver parity.

**Architecture:** Extend the existing `three-d-video-engine.ts` and shared 3D types. Keep imports/exports synchronous and dependency-light, with deterministic CPU rendering and browser-download/print handoff metadata.

**Tech Stack:** TypeScript, existing Playwright test harness, browser canvas/ImageData APIs, local ZIP/3DS subset encoders.

---

### Task 1: Test Browser-Local 3D Completion

**Files:**
- Modify: `tests/three-d-video-depth.spec.ts`

- [x] Write failing tests for binary 3DS subset export/import, real KMZ ZIP package round-trip, U3D multi-mesh metadata, animation stack evaluation, sampled/shadowed ray preview, and slicer/browser print handoff.
- [x] Run `npx playwright test tests/three-d-video-depth.spec.ts --grep "browser-local 3D completion"` and confirm the new tests fail because the APIs/behaviors are missing.

### Task 2: Add Shared 3D Metadata Types

**Files:**
- Modify: `components/photoshop/types.ts`

- [x] Add serializable animation stack, keyframe, print slice, print plan, and import/export metadata types.
- [x] Keep existing `ThreeDScene` fields backward compatible.

### Task 3: Implement Import/Export and Animation

**Files:**
- Modify: `components/photoshop/three-d-video-engine.ts`

- [x] Implement local ZIP store read/write for KMZ `model.dae`.
- [x] Implement binary 3DS subset export and richer 3DS material/UV parsing.
- [x] Extend U3D subset parsing/export for multiple meshes/material metadata.
- [x] Add animation stack helpers and deterministic scene evaluation.

### Task 4: Implement Rendering and Print Planning

**Files:**
- Modify: `components/photoshop/three-d-video-engine.ts`

- [x] Extend `rayTraceScene` to use samples, scene lights, specular/roughness response, opacity, and optional shadow rays.
- [x] Add slicer-style print preparation with z-layer intersections, material estimate, G-code preview text, and browser-local handoff metadata.

### Task 5: Verify

**Files:**
- Existing tests only unless typecheck exposes integration gaps.

- [x] Run focused Playwright tests for `tests/three-d-video-depth.spec.ts`.
- [x] Run `npm run typecheck`.
- [x] Update capability/report wording only if behavior labels become stale.

Typecheck note: `npm run typecheck` currently fails on pre-existing non-3D issues in export/raster/smart-object files; no errors were reported for the modified 3D files.
