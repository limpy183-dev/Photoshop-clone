# Timeline Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build browser-local frame animation, onion skin, tween, timeline keyframe, GIF/APNG/WebP export, and video poster metadata workflows.

**Architecture:** Extend the existing document timeline model rather than adding a parallel animation state. Put deterministic frame/tween/render logic in `timeline-engine.ts`, animated container encoding in `animation-encoding.ts`, and keep UI orchestration in `panels/timeline-panel.tsx`.

**Tech Stack:** Next.js, React, TypeScript, Canvas 2D, Playwright tests, browser `CompressionStream`/`toBlob` fallbacks.

---

### Task 1: Timeline Engine Tests

**Files:**
- Test: `tests/timeline-animation.spec.ts`
- Modify: `components/photoshop/timeline-engine.ts`

- [ ] Write failing tests for frame capture, projected frame application, tween interpolation, and onion-skin canvas creation.
- [ ] Run `npx playwright test tests/timeline-animation.spec.ts --grep "timeline engine"`.
- [ ] Fix `timeline-engine.ts` until the tests pass.

### Task 2: Animation Encoder Tests

**Files:**
- Test: `tests/timeline-animation.spec.ts`
- Modify: `components/photoshop/animation-encoding.ts`

- [ ] Write failing tests for animated GIF, APNG, and animated WebP signatures/chunks.
- [ ] Run `npx playwright test tests/timeline-animation.spec.ts --grep "animation export"`.
- [ ] Fix encoders until the tests pass without external dependencies.

### Task 3: Editor State And I/O

**Files:**
- Modify: `components/photoshop/types.ts`
- Modify: `components/photoshop/editor-context.tsx`
- Modify: `components/photoshop/document-io.ts`

- [ ] Add tests for export reports and project preservation if coverage is missing.
- [ ] Ensure `timelineSettings`, video poster metadata, and animation export helpers typecheck and serialize.
- [ ] Run `npx tsc --noEmit`.

### Task 4: Timeline UI Integration

**Files:**
- Modify: `components/photoshop/panels/timeline-panel.tsx`
- Modify: `components/photoshop/panels/gap-panels.tsx`

- [ ] Wire frame editor controls to timeline engine helpers.
- [ ] Add onion skin controls, export buttons, transform keyframe editor, tween dialog, and video poster action.
- [ ] Keep controls compact and consistent with existing panel styling.

### Task 5: Verification

**Files:**
- All touched files.

- [ ] Run `npx playwright test tests/timeline-animation.spec.ts`.
- [ ] Run `npx tsc --noEmit`.
- [ ] Run `npm run build`.
- [ ] Report any unrelated pre-existing failures separately.
