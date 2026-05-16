# Photoshop Gap Tracks 1-4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement foundation capability tracking, core missing tool parity, expanded worker filter coverage, and professional interoperability reporting from the first four report tracks.

**Architecture:** Add a typed capability registry as a small pure module, integrate it into preflight and document reports, then wire missing first-class tools through existing editor surfaces with local browser behavior. Expand filter worker coverage in parity-tested slices while keeping unsupported/native-service features honestly classified.

**Tech Stack:** Next.js 16, React 19, TypeScript, Playwright, browser Canvas/ImageData APIs, existing Photoshop editor modules.

---

### Task 1: Capability Registry

**Files:**
- Create: `components/photoshop/capabilities.ts`
- Test: `tests/capabilities.spec.ts`

- [ ] **Step 1: Write failing tests**

Add tests that import the registry and assert the required status behavior:

```ts
import { expect, test } from "@playwright/test"
import {
  CAPABILITY_STATUS_ORDER,
  capabilityWarningsForDocument,
  getCapability,
  listCapabilities,
  summarizeCapabilities,
} from "../components/photoshop/capabilities"

test("capability registry classifies required report tracks", () => {
  expect(CAPABILITY_STATUS_ORDER).toEqual(["complete", "usable", "approximation", "stub", "unsupported"])
  expect(getCapability("tool.quick-selection").status).toBe("usable")
  expect(getCapability("format.psb").status).toBe("unsupported")
  expect(getCapability("format.openexr").status).toBe("unsupported")
  expect(getCapability("color.high-bit-pipeline").status).toBe("unsupported")
  expect(getCapability("workflow.photomerge").status).toBe("approximation")
  expect(getCapability("external.generative-fill").status).toBe("unsupported")
})

test("capability registry exposes summaries by kind", () => {
  const summary = summarizeCapabilities(listCapabilities({ kind: "format" }))
  expect(summary.unsupported).toBeGreaterThan(0)
  expect(summary.usable + summary.approximation + summary.unsupported).toBeGreaterThan(5)
})

test("document capability warnings explain browser pixel and color limitations", () => {
  const warnings = capabilityWarningsForDocument({
    colorMode: "CMYK",
    bitDepth: 16,
    layers: [{ kind: "smart-object", smartFilters: [{ enabled: true }] }],
  })
  expect(warnings.some((warning) => warning.label === "Browser pixel pipeline")).toBe(true)
  expect(warnings.some((warning) => warning.label === "Color mode")).toBe(true)
  expect(warnings.some((warning) => warning.label === "Smart filters")).toBe(true)
})
```

- [ ] **Step 2: Run the tests and verify red**

Run: `npx playwright test tests/capabilities.spec.ts`

Expected: FAIL because `components/photoshop/capabilities.ts` does not exist.

- [ ] **Step 3: Implement registry**

Create a pure TypeScript module with typed statuses, records, lookup helpers, summaries, and document warning helpers.

- [ ] **Step 4: Run the tests and verify green**

Run: `npx playwright test tests/capabilities.spec.ts`

Expected: PASS.

### Task 2: Reporting Integration

**Files:**
- Modify: `components/photoshop/preflight-dialog.tsx`
- Modify: `components/photoshop/document-io.ts`
- Test: `tests/capabilities.spec.ts`
- Test: `tests/advanced-capabilities.spec.ts`

- [ ] **Step 1: Add failing report tests**

Extend capability tests to assert preflight/document helpers expose capability warnings. Use `createDocumentReport` for report assertions.

- [ ] **Step 2: Verify red**

Run: `npx playwright test tests/capabilities.spec.ts`

Expected: FAIL because document reports do not include capability-derived warnings.

- [ ] **Step 3: Integrate warnings**

Import `capabilityWarningsForDocument` into preflight and document report generation. Add compact items for browser pixel pipeline, color mode, high-bit limits, smart filters, app-only features, export metadata limits, and unsupported advanced formats.

- [ ] **Step 4: Verify green**

Run: `npx playwright test tests/capabilities.spec.ts tests/advanced-capabilities.spec.ts`

Expected: PASS.

### Task 3: First-Class Tool IDs and UI Wiring

**Files:**
- Modify: `components/photoshop/types.ts`
- Modify: `components/photoshop/tool-palette.tsx`
- Modify: `components/photoshop/shortcuts.ts`
- Modify: `components/photoshop/use-shortcuts.ts`
- Modify: `components/photoshop/command-palette.tsx`
- Modify: `components/photoshop/options-bar.tsx`
- Test: `tests/core-tool-parity.spec.ts`

- [ ] **Step 1: Write failing reachability tests**

Add a Playwright test that opens the command palette or toolbar groups and checks Quick Selection, Slice Select, Freeform Pen, Add Anchor Point, Delete Anchor Point, Convert Point, Vertical Type, Rounded Rectangle, Polygon, and Triangle are selectable first-class tools.

- [ ] **Step 2: Verify red**

Run: `npx playwright test tests/core-tool-parity.spec.ts`

Expected: FAIL because several tool IDs are missing.

- [ ] **Step 3: Add tool IDs and UI wiring**

Update `ToolId`, toolbar groups, shortcut metadata, command palette tool commands, and options bar routing.

- [ ] **Step 4: Verify green**

Run: `npx playwright test tests/core-tool-parity.spec.ts`

Expected: PASS.

### Task 4: Local Core Tool Behavior

**Files:**
- Modify: `components/photoshop/canvas-view.tsx`
- Modify: `components/photoshop/editor-context.tsx`
- Modify: `components/photoshop/types.ts`
- Test: `tests/canvas-tools.spec.ts`

- [ ] **Step 1: Add failing behavior tests**

Add tests for vertical type layer creation, rounded rectangle/polygon/triangle shape creation, freeform path creation, anchor add/delete/convert actions, quick selection selection bounds, and slice select active slice behavior.

- [ ] **Step 2: Verify red**

Run: `npx playwright test tests/canvas-tools.spec.ts`

Expected: FAIL for newly asserted behaviors.

- [ ] **Step 3: Implement local behavior**

Route tools to existing canvas gesture handling where possible and add focused handling for the new cases.

- [ ] **Step 4: Verify green**

Run: `npx playwright test tests/canvas-tools.spec.ts`

Expected: PASS.

### Task 5: Worker Filter Expansion

**Files:**
- Modify: `components/photoshop/filter-worker.ts`
- Modify: `components/photoshop/filters.ts` only if an exported deterministic helper is needed
- Test: `tests/filters-algorithms.spec.ts`

- [ ] **Step 1: Write failing worker coverage tests**

Update tests to expect worker support for deterministic filters and parity against direct `getFilter(id).apply(...)` for box blur, sharpen, and brightness/contrast-compatible filters.

- [ ] **Step 2: Verify red**

Run: `npx playwright test tests/filters-algorithms.spec.ts`

Expected: FAIL because these filters are not worker-supported yet.

- [ ] **Step 3: Implement worker algorithms**

Add worker implementations and keep fallback paths intact for unsupported filters.

- [ ] **Step 4: Verify green**

Run: `npx playwright test tests/filters-algorithms.spec.ts`

Expected: PASS.

### Task 6: Interoperability Reporting Tests

**Files:**
- Modify: `components/photoshop/document-io.ts`
- Modify: `components/photoshop/advanced-subsystems.ts`
- Test: `tests/capabilities.spec.ts`
- Test: `tests/document-lifecycle.spec.ts`
- Test: `tests/advanced-capabilities.spec.ts`

- [ ] **Step 1: Write failing assertions**

Assert reports classify PSD export approximations, metadata/ICC export loss, high-bit/color mode limits, RAW/HDR/EXR/PSB strategy, and project-preserved app-only metadata.

- [ ] **Step 2: Verify red**

Run: `npx playwright test tests/capabilities.spec.ts tests/document-lifecycle.spec.ts tests/advanced-capabilities.spec.ts`

Expected: FAIL where reporting is incomplete.

- [ ] **Step 3: Implement report classification**

Use the registry and existing advanced format matrix to add precise report items.

- [ ] **Step 4: Verify green**

Run: `npx playwright test tests/capabilities.spec.ts tests/document-lifecycle.spec.ts tests/advanced-capabilities.spec.ts`

Expected: PASS.

### Task 7: Full Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 2: Build**

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 3: Full test run**

Run: `npx playwright test`

Expected: all tests pass, or document browser/environment-specific failures with exact output.
