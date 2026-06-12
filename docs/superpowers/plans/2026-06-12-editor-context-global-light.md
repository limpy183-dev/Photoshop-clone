# Editor Context Global Light Extraction Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move global-light normalization and layer-style application out of `editor-context.tsx` while preserving shadow offset geometry, bevel angle/altitude updates, and immutable style updates.

**Architecture:** Create `editor-global-light.ts` as a pure helper module imported by the `set-global-light` reducer branch. Keep `GlobalLight` as the existing editor-context alias for action typing.

**Tech Stack:** TypeScript reducer helpers, Photoshop layer-style types, Playwright node tests.

---

### Task 1: Extract Global Light Helpers

**Files:**
- Create: `components/photoshop/editor-global-light.ts`
- Create: `tests/editor-global-light.spec.ts`
- Modify: `components/photoshop/editor-context.tsx`

- [ ] **Step 1: Add tests**

Cover finite/default normalization, angle-to-offset conversion, useGlobalLight false opt-out, drop/inner shadow updates, bevel angle/altitude updates, and no mutation of the original style.

- [ ] **Step 2: Move helpers**

Move `normalizeGlobalLight`, `offsetFromGlobalLight`, and `applyGlobalLightToStyle` to the new module.

- [ ] **Step 3: Wire reducer**

Import `normalizeGlobalLight` and `applyGlobalLightToStyle` in `editor-context.tsx`. Leave the `set-global-light` reducer branch behavior unchanged.

- [ ] **Step 4: Verify**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/editor-global-light.spec.ts --workers=1
npm run typecheck
npx eslint components/photoshop/editor-global-light.ts components/photoshop/editor-context.tsx tests/editor-global-light.spec.ts
```

- [ ] **Step 5: Commit**

```powershell
git add -- components/photoshop/editor-global-light.ts components/photoshop/editor-context.tsx tests/editor-global-light.spec.ts
git commit -m "refactor: extract editor global light helpers"
```
