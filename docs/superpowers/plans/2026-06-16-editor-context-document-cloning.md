# Editor Context Document Cloning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract document and layer cloning helpers from `editor-context.tsx` into a focused module without changing reducer or provider behavior.

**Architecture:** Keep `editor-context.tsx` responsible for state transitions, React provider setup, history wiring, and dispatch actions. Move canvas cloning, deep plain cloning, alpha bounds, path translation, smart filter/source cloning, cross-document layer cloning, and whole-document duplication into `components/photoshop/editor-document-cloning.ts`.

**Tech Stack:** React 19, Next.js 16, TypeScript, Canvas 2D APIs, Playwright module tests.

---

### Task 1: Characterize Document Cloning

**Files:**
- Create: `tests/editor-document-cloning.spec.ts`

- [x] **Step 1: Add module tests**

Cover:
- `cloneCanvas` copies pixel data into a different canvas instance.
- `alphaBounds` returns the current alpha bounding box and `null` for empty canvases.
- `cloneLayerIntoDocument` centers copied layers into a differently sized target and removes document-local parent/link identity.
- `duplicateDocumentDeep` rekeys document/layer/channel identifiers, preserves selection mapping, clears `smartObjectParent`, and deep-clones metadata.

- [x] **Step 2: Run red test**

Run: `npx playwright test --config=playwright.node.config.ts tests/editor-document-cloning.spec.ts --workers=1`

Expected: fail because `components/photoshop/editor-document-cloning.ts` does not exist yet.

### Task 2: Extract Cloning Helpers

**Files:**
- Create: `components/photoshop/editor-document-cloning.ts`
- Modify: `components/photoshop/editor-context.tsx`

- [x] **Step 1: Create helper module**

Move these helpers from `editor-context.tsx`:
- `deepClonePlain`
- `cloneCanvas`
- `alphaBounds`
- `translatePath`
- `cloneSmartFilters`
- `cloneTranslatedSmartFilters`
- `cloneSmartSource`
- `cloneLayerIntoDocument`
- `cloneLayerExact`
- `duplicateDocumentDeep`

- [x] **Step 2: Wire `editor-context.tsx`**

Import:

```ts
import {
  alphaBounds,
  cloneCanvas,
  cloneLayerIntoDocument,
  cloneSmartFilters,
  deepClonePlain,
  duplicateDocumentDeep,
} from "./editor-document-cloning"
```

Delete the moved local helper implementations. Keep `export { makeCanvas, cloneCanvas, makeHistoryEntry }` working from `editor-context.tsx`.

- [x] **Step 3: Run focused tests**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/editor-document-cloning.spec.ts tests/editor-document-lifecycle.spec.ts tests/editor-global-light.spec.ts tests/editor-persisted-settings.spec.ts --workers=1
npx playwright test --config=playwright.node.config.ts tests/layer-nondestructive-workflows.spec.ts tests/flatten-transparency.spec.ts --workers=1
```

Expected: all selected tests pass.

### Task 3: Verify And Commit

**Files:**
- Commit: `components/photoshop/editor-context.tsx`
- Commit: `components/photoshop/editor-document-cloning.ts`
- Commit: `tests/editor-document-cloning.spec.ts`
- Commit: `tests/photoshop-smoke.spec.ts`
- Commit: `docs/superpowers/plans/2026-06-16-editor-context-document-cloning.md`

- [x] **Step 1: Run static checks**

Run:

```powershell
npm run typecheck
npx eslint components/photoshop/editor-context.tsx components/photoshop/editor-document-cloning.ts tests/editor-document-cloning.spec.ts
```

Expected: both commands pass.

- [x] **Step 2: Run broader verification**

Run:

```powershell
npm run lint
npm run build
npm run test:smoke -- --workers=2
```

Expected: all commands pass. The existing webpack circular dependency warning may still appear during build/browser tests.

During smoke verification, stabilize `tests/photoshop-smoke.spec.ts` to wait for the document canvas role and backing-store dimensions instead of racing on the first visible canvas.

- [ ] **Step 3: Commit**

Run:

```powershell
git add components/photoshop/editor-context.tsx components/photoshop/editor-document-cloning.ts tests/editor-document-cloning.spec.ts tests/photoshop-smoke.spec.ts docs/superpowers/plans/2026-06-16-editor-context-document-cloning.md
git commit -m "refactor: extract editor document cloning"
```
