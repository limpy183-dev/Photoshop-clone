# Bug Report Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement every actionable defect in `docs/codebase-bug-and-error-report-2026-06-29-codex.md`.

**Architecture:** Keep the minute abuse limiter ahead of parsing, but charge the daily paid quota only after valid input and concurrency admission. Preserve remote rate-limit denial reasons, route Blob-backed downloads through the existing revoking helper, and align the exported project picker with the active `.psprojson` format.

**Tech Stack:** Next.js 16 route handlers, TypeScript, Playwright node tests, browser File System Access helpers.

---

### Task 1: Generative-fill quota timing

**Files:**
- Modify: `app/api/photoshop/generative-fill/route.ts`
- Modify: `tests/marketing-security.spec.ts`

- [ ] **Step 1: Write failing test**

Add a route-level test that configures local rate limiting and `GENERATIVE_FILL_DAILY_REQUEST_LIMIT=1`, sends one valid authenticated schema-invalid request, then sends one valid authenticated request and asserts the second request reaches the upstream fetch instead of returning `Daily generative fill quota exceeded.`

- [ ] **Step 2: Verify red**

Run: `npx.cmd playwright test tests/marketing-security.spec.ts --config=playwright.node.config.ts --grep "invalid generative fill payloads do not consume daily quota"`

Expected: FAIL with a daily quota response on the second request.

- [ ] **Step 3: Implement minimal fix**

Move the daily `checkServerRateLimit("genfill:day:...")` block to after `readJsonWithLimit`, `GenerativeFillSchema.safeParse`, and `acquireConcurrencySlot` succeed, just before the upstream `fetch`.

- [ ] **Step 4: Verify green**

Run the same focused test and expect PASS.

### Task 2: Remote rate-limit reason preservation

**Files:**
- Modify: `lib/rate-limit-store.ts`
- Modify: `tests/marketing-security.spec.ts`

- [ ] **Step 1: Write failing test**

Add a test that stubs `globalThis.fetch` for `RATE_LIMIT_SERVICE_URL` to return `200` JSON `{ allowed: false, reason: "unavailable", retryAfterSeconds: 7 }`, then asserts `checkServerRateLimit` returns `{ allowed: false, reason: "unavailable", retryAfterSeconds: 7 }`.

- [ ] **Step 2: Verify red**

Run: `npx.cmd playwright test tests/marketing-security.spec.ts --config=playwright.node.config.ts --grep "preserves remote rate-limit outage reasons"`

Expected: FAIL because `reason` is missing.

- [ ] **Step 3: Implement minimal fix**

Validate successful JSON responses and copy `capacity`, `unavailable`, or `unconfigured` reason values onto denied decisions; malformed successful JSON responses should fail closed as unavailable.

- [ ] **Step 4: Verify green**

Run the same focused test and expect PASS.

### Task 3: Blob-backed video render download

**Files:**
- Modify: `components/photoshop/advanced-subsystems-dialog.tsx`
- Modify: `tests/export-workflow-depth.spec.ts`

- [ ] **Step 1: Write failing test**

Add a static regression test that reads `components/photoshop/advanced-subsystems-dialog.tsx` and asserts it does not contain `downloadDataUrl(URL.createObjectURL(`.

- [ ] **Step 2: Verify red**

Run: `npx.cmd playwright test tests/export-workflow-depth.spec.ts --config=playwright.node.config.ts --grep "advanced subsystem video export uses revoking Blob downloads"`

Expected: FAIL while the direct object URL call remains.

- [ ] **Step 3: Implement minimal fix**

Replace the direct object URL download with `downloadBlob(blob, filename)`.

- [ ] **Step 4: Verify green**

Run the same focused test and expect PASS.

### Task 4: Project picker extension

**Files:**
- Modify: `components/photoshop/document-file-system.ts`
- Modify: `tests/export-workflow-depth.spec.ts`

- [ ] **Step 1: Write failing test**

Add a DOM-backed test that stubs `window.showSaveFilePicker`, calls `showSaveProjectPicker()`, and asserts `suggestedName` is `project.psprojson` and the project MIME accepts `.psprojson`.

- [ ] **Step 2: Verify red**

Run: `npx.cmd playwright test tests/export-workflow-depth.spec.ts --config=playwright.node.config.ts --grep "project picker defaults to psprojson"`

Expected: FAIL with the stale `.psproj` values.

- [ ] **Step 3: Implement minimal fix**

Update `showSaveProjectPicker` to default to `project.psprojson` and advertise `.psprojson` for the project save type.

- [ ] **Step 4: Verify green**

Run the same focused test and expect PASS.

### Task 5: Final verification

**Files:**
- Inspect: `app/api/photoshop/generative-fill/route.ts`
- Inspect: `lib/rate-limit-store.ts`
- Inspect: `components/photoshop/advanced-subsystems-dialog.tsx`
- Inspect: `components/photoshop/document-file-system.ts`

- [ ] Run focused modified tests:
  `npx.cmd playwright test tests/marketing-security.spec.ts tests/export-workflow-depth.spec.ts --config=playwright.node.config.ts`
- [ ] Run static checks:
  `npm.cmd run lint:strict`
  `npm.cmd run typecheck`
- [ ] Review `git diff -- app/api/photoshop/generative-fill/route.ts lib/rate-limit-store.ts components/photoshop/advanced-subsystems-dialog.tsx components/photoshop/document-file-system.ts tests/marketing-security.spec.ts tests/export-workflow-depth.spec.ts docs/superpowers/plans/2026-06-29-bug-report-remediation.md`
