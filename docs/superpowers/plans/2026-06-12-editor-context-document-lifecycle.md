# Editor Context Document Lifecycle Extraction Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move document dirty/saved lifecycle bookkeeping out of `editor-context.tsx` while preserving current document status, close prompts, save index tracking, and automatic dirty marking.

**Architecture:** Create `editor-document-lifecycle.ts` with structural state/action inputs so it can be tested independently and imported by `editor-context.tsx` without a circular dependency. Keep public `DocumentLifecycleState` types exported from `editor-context.tsx` for existing callers.

**Tech Stack:** TypeScript, React reducer state, Playwright node tests.

---

### Task 1: Extract Document Lifecycle Helpers

**Files:**
- Create: `components/photoshop/editor-document-lifecycle.ts`
- Create: `tests/editor-document-lifecycle.spec.ts`
- Modify: `components/photoshop/editor-context.tsx`

- [ ] **Step 1: Add characterization tests**

Cover default lifecycle creation, history-index fallback, dirty-state derivation, lifecycle patching for existing/missing docs, and special/action-set dirty document routing.

- [ ] **Step 2: Move lifecycle logic**

Move `DOCUMENT_DIRTY_ACTIONS`, `makeDocumentLifecycle`, `currentHistoryIndexFromHistories`, `currentHistoryIndex`, `documentLifecycleForSlices`, `documentLifecycleFor`, `isDocumentDirtyInState`, `withDocumentLifecyclePatch`, and `dirtyDocIdsForAction` to the new module.

- [ ] **Step 3: Wire editor context**

Import the extracted helpers in `editor-context.tsx` and delete the local implementations. Do not change reducer action semantics or exported lifecycle types.

- [ ] **Step 4: Verify**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/editor-document-lifecycle.spec.ts tests/brush-stroke-undo.spec.ts --workers=1
npm run typecheck
npx eslint components/photoshop/editor-document-lifecycle.ts components/photoshop/editor-context.tsx tests/editor-document-lifecycle.spec.ts
```

- [ ] **Step 5: Commit**

```powershell
git add -- components/photoshop/editor-document-lifecycle.ts components/photoshop/editor-context.tsx tests/editor-document-lifecycle.spec.ts
git commit -m "refactor: extract editor document lifecycle"
```
