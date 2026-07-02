# Deep Analysis Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the actionable recommendations from `docs/codebase-deep-analysis-report-2026-07-01-codex.md` and finish with an audit of features still incomplete.

**Architecture:** Add low-risk guardrails first, then production adapter observability, then scoped editor architecture headroom. Keep existing public APIs stable and avoid reverting the pre-existing dirty working tree.

**Tech Stack:** Next.js 16, React 19, TypeScript, Playwright node tests, custom architecture and bundle scripts.

---

### Task 1: Source Hygiene And Mojibake Fixes

**Files:**
- Create: `scripts/check-source-hygiene.mjs`
- Modify: `package.json`
- Modify: `components/photoshop/menu-bar.tsx`
- Modify: `components/photoshop/filters/registry-definitions/adjustments.ts`
- Test: `tests/source-hygiene.spec.ts`

- [ ] **Step 1: Write the failing source-hygiene test**

```ts
import { execFileSync } from "node:child_process"
import { expect, test } from "@playwright/test"

test("source hygiene rejects common mojibake in visible source", () => {
  expect(() => execFileSync(process.execPath, ["scripts/check-source-hygiene.mjs"], {
    encoding: "utf8",
    stdio: "pipe",
  })).not.toThrow()
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx playwright test tests/source-hygiene.spec.ts --config=playwright.node.config.ts`
Expected: FAIL because existing files contain `Â°` and `â...` mojibake sequences.

- [ ] **Step 3: Implement the hygiene script and label fixes**

Create `scripts/check-source-hygiene.mjs` to scan `app`, `components`, `hooks`, `lib`, `scripts`, `tests`, and `docs` for corrupted sequences matching `/\u00c2|\u00c3|\u00e2[\u0080-\u00bf]?|\ufffd/`.
Replace corrupted menu checkmarks with `"✓ "` and corrupted degree suffixes/arrows in `adjustments.ts` with valid `°` and `←`.
Add `check:source-hygiene` to `package.json` and include it in `verify`.

- [ ] **Step 4: Verify the test passes**

Run: `npx playwright test tests/source-hygiene.spec.ts --config=playwright.node.config.ts`
Expected: PASS.

### Task 2: PR Test Selection Coverage

**Files:**
- Modify: `scripts/select-pr-tests.mjs`
- Modify: `tests/pr-test-selection.spec.ts`

- [ ] **Step 1: Write failing selector tests**

Add cases proving:
- `components/photoshop/filter-worker-source.ts` maps to canvas/filter tests.
- `components/photoshop/raster-codec-utils.ts`, `raster-openexr-encoders.ts`, `raster-tiff-encoders.ts`, and `raster-metadata-embeds.ts` map to format import/export tests.
- `components/photoshop/tile-only-export-planning.ts` maps to large-document/tile tests.

- [ ] **Step 2: Run the selector tests and verify failure**

Run: `npx playwright test tests/pr-test-selection.spec.ts --config=playwright.node.config.ts`
Expected: FAIL for at least one new extracted module currently falling back too broadly or missing the focused suite.

- [ ] **Step 3: Add explicit patterns and suites**

Update `GROUPS` in `scripts/select-pr-tests.mjs` with explicit `filter-worker`, `raster-codec-*`, `raster-*-encoders`, `raster-metadata-*`, and `tile-only-*` patterns.

- [ ] **Step 4: Verify selector tests pass**

Run: `npx playwright test tests/pr-test-selection.spec.ts --config=playwright.node.config.ts`
Expected: PASS.

### Task 3: Filter Worker Drift Protection

**Files:**
- Modify: `components/photoshop/filter-worker.ts`
- Modify: `tests/filters-algorithms.spec.ts`

- [ ] **Step 1: Write failing drift tests**

Add tests that compare inline fallback support with the registry worker support and assert every inline fallback filter has a representative parity fixture.

- [ ] **Step 2: Run the focused filter tests and verify failure**

Run: `npx playwright test tests/filters-algorithms.spec.ts --config=playwright.node.config.ts`
Expected: FAIL because inline fallback coverage is not exported or parity is incomplete.

- [ ] **Step 3: Export inline worker support metadata and expand parity fixtures**

Export `getInlineFilterWorkerSupport()` from `components/photoshop/filter-worker.ts`.
Add parity cases for all inline fallback filters that are deterministic with the current harness, using zero-noise or fixed-seed params where randomness would otherwise make output unstable.

- [ ] **Step 4: Verify filter tests pass**

Run: `npx playwright test tests/filters-algorithms.spec.ts --config=playwright.node.config.ts`
Expected: PASS.

### Task 4: Durable Production Adapter Observability

**Files:**
- Modify: `lib/marketing-store.ts`
- Modify: `lib/rate-limit-store.ts`
- Modify: `app/api/feedback/route.ts`
- Modify: `app/api/subscribe/route.ts`
- Modify: `app/api/photoshop/generative-fill/route.ts`
- Modify: `docs/deployment-persistence.md`
- Modify: `tests/marketing-security.spec.ts`

- [ ] **Step 1: Write failing adapter telemetry tests**

Add tests for:
- remote marketing store responses with `reason: "quota-exceeded"` become `MarketingStoreQuotaError`;
- remote marketing store outages preserve an unavailable reason for route logs;
- rate-limit remote decisions preserve `capacity`, `unavailable`, and `unconfigured` reasons;
- marketing routes log unavailable/quota outcomes without exposing details in responses.

- [ ] **Step 2: Run the marketing tests and verify failure**

Run: `npx playwright test tests/marketing-security.spec.ts --config=playwright.node.config.ts`
Expected: FAIL where reason/telemetry is not surfaced yet.

- [ ] **Step 3: Implement reason-bearing adapter errors and route telemetry**

Add reason fields to marketing store errors, normalize remote marketing store JSON, log route outcomes with concise event names, and document the adapter contracts for `MARKETING_RECORD_STORE_URL` and `RATE_LIMIT_SERVICE_URL`.

- [ ] **Step 4: Verify marketing tests pass**

Run: `npx playwright test tests/marketing-security.spec.ts --config=playwright.node.config.ts`
Expected: PASS.

### Task 5: Reducer Determinism Fixture

**Files:**
- Modify: `components/photoshop/editor-context.tsx`
- Modify: `tests/editor-transition-effects.spec.ts`

- [ ] **Step 1: Write failing deterministic replay test**

Add a test that runs the same transition twice with fixed IDs and time and expects identical state/effects.

- [ ] **Step 2: Run the transition tests and verify failure**

Run: `npx playwright test tests/editor-transition-effects.spec.ts --config=playwright.node.config.ts`
Expected: FAIL if transition code still calls ambient `Date.now()` or `uid()` for the covered path.

- [ ] **Step 3: Inject deterministic transition services for the covered lifecycle path**

Add `now` and `makeId` service inputs to transition helpers for the tested close/history path and move the ambient values to caller-provided services.

- [ ] **Step 4: Verify transition tests pass**

Run: `npx playwright test tests/editor-transition-effects.spec.ts --config=playwright.node.config.ts`
Expected: PASS.

### Task 6: Architecture Headroom

**Files:**
- Modify: `components/photoshop/panels/tool-presets-panel.tsx`
- Modify: `components/photoshop/panels/timeline-panel.tsx`
- Modify: `components/photoshop/tool-palette.tsx`
- Modify: `components/photoshop/use-shortcuts.ts`
- Modify: `components/photoshop/canvas-view.tsx`
- Modify: `components/photoshop/editor-context.tsx`
- Modify: `scripts/architecture-budgets.json`

- [ ] **Step 1: Run current architecture check**

Run: `npm run check:architecture -- --json`
Expected: PASS at current caps.

- [ ] **Step 2: Convert small read-heavy consumers to selectors**

Replace broad `useEditor()` usage in the listed small components with `useEditorSelector` calls while preserving current dispatch/command behavior.

- [ ] **Step 3: Remove hook dependency suppressions where stable callback/ref patterns are already available**

Replace suppressions in `canvas-view.tsx` and `editor-context.tsx` only when dependencies can be represented without behavior changes.

- [ ] **Step 4: Tighten earned budgets**

Lower `useEditorImports.max` and `hookDependencySuppressions.max` only to values proven by `check-architecture`.

- [ ] **Step 5: Verify architecture remains passing**

Run: `npm run check:architecture -- --json`
Expected: PASS with tighter budgets.

### Task 7: Bundle Ownership Reporting

**Files:**
- Modify: `scripts/analyze-bundle.mjs`
- Modify: `artifacts/bundle-report.json`
- Test: `tests/architecture-gates.spec.ts`

- [ ] **Step 1: Write failing bundle ownership test**

Add a node test that asserts bundle reports include an `appOwnedStartupChunkReasons` section with route, file, decoded size, owner samples, and review guidance.

- [ ] **Step 2: Run architecture gate tests and verify failure**

Run: `npx playwright test tests/architecture-gates.spec.ts --config=playwright.node.config.ts`
Expected: FAIL until the report shape exists.

- [ ] **Step 3: Add ownership reason report section**

Extend `scripts/analyze-bundle.mjs` to emit `appOwnedStartupChunkReasons` and make `generatedAt` deterministic unless overridden.

- [ ] **Step 4: Verify architecture gates pass**

Run: `npx playwright test tests/architecture-gates.spec.ts --config=playwright.node.config.ts`
Expected: PASS.

### Task 8: Final Verification And Unfinished Feature Audit

**Files:**
- Modify: `docs/codebase-deep-analysis-report-2026-07-01-codex.md` only if the report needs implementation-status notes.

- [ ] **Step 1: Run targeted checks**

Run:
`npx playwright test tests/source-hygiene.spec.ts tests/pr-test-selection.spec.ts tests/filters-algorithms.spec.ts tests/marketing-security.spec.ts tests/editor-transition-effects.spec.ts tests/architecture-gates.spec.ts --config=playwright.node.config.ts`

- [ ] **Step 2: Run project verification**

Run: `npm run lint`, `npm run typecheck`, `npm run check:architecture`, and `npm run check:source-hygiene`.

- [ ] **Step 3: Audit unfinished features**

Use `rg -n "TODO|FIXME|not implemented|placeholder|stub|coming soon|unsupported|unavailable|future"` against `app`, `components`, `lib`, `scripts`, and `tests`; compare hits against feature code and tests.

- [ ] **Step 4: Report exact residual work**

Return a concise list of implemented items, verification evidence, and remaining incomplete features with file references.
