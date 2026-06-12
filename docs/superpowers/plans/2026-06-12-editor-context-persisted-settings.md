# Editor Context Persisted Settings Extraction Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move persisted editor settings sanitization, hydration filtering, load, and save helpers out of `editor-context.tsx` while preserving the existing exported `filterPersistedSettingsForHydration` API.

**Architecture:** Create a focused `editor-persisted-settings.ts` module that owns localStorage keying, untrusted-setting sanitization, allow-listed field selection, serialization, and guarded localStorage access. `editor-context.tsx` keeps a thin compatibility wrapper that supplies the current initial brush/gradient/symmetry defaults.

**Tech Stack:** TypeScript, React context state, browser `localStorage`, Playwright node/browser tests.

---

### Task 1: Extract Persisted Settings Helpers

**Files:**
- Create: `components/photoshop/editor-persisted-settings.ts`
- Create: `tests/editor-persisted-settings.spec.ts`
- Modify: `components/photoshop/editor-context.tsx`

- [ ] **Step 1: Add characterization tests**

Test sanitization keeps safe foreground colors, rejects CSS `url(...)`, strips prototype-pollution keys and unknown fields, truncates oversized strings/arrays, serializes only persisted settings, and round-trips load/save through a mocked storage object.

- [ ] **Step 2: Move implementation**

Move `SETTINGS_KEY`, persisted-setting sanitizer constants, `sanitizePersistedSetting`, `sanitizeColorString`, persisted field allow-lists, `pickPersistedFields`, `loadPersistedSettings`, and `savePersistedSettings` to `editor-persisted-settings.ts`.

- [ ] **Step 3: Preserve editor-context API**

Keep `filterPersistedSettingsForHydration(value)` exported from `editor-context.tsx`, implemented as a wrapper around `filterPersistedEditorSettingsForHydration(value, defaults)` using `initialState.brush`, `initialState.gradient`, and `initialState.symmetry`.

- [ ] **Step 4: Verify**

Run:

```powershell
npx playwright test --config=playwright.node.config.ts tests/editor-persisted-settings.spec.ts tests/security-regression-limits.spec.ts --workers=1
npm run typecheck
npx eslint components/photoshop/editor-persisted-settings.ts components/photoshop/editor-context.tsx tests/editor-persisted-settings.spec.ts
```

- [ ] **Step 5: Commit**

```powershell
git add -- components/photoshop/editor-persisted-settings.ts components/photoshop/editor-context.tsx tests/editor-persisted-settings.spec.ts
git commit -m "refactor: extract editor persisted settings"
```
