# Filter Adjustment Engine Implementation Plan

**Goal:** Extract the basic adjustment, HDR toning, and Auto adjustment engine from `filters/registry.ts` without changing filter definitions, public imports, or pixel output.

**Architecture:** Add `components/photoshop/filters/adjustment-algorithms.ts` for the contiguous adjustment block that currently precedes LUT processing. The registry will import callable algorithms and shared hue-range helpers, then re-export the public presets, types, and parsers so `components/photoshop/filters.ts` remains the stable facade.

**Tech Stack:** TypeScript 5.7, Playwright Test 1.59 node project.

---

### Task 1: Characterize Adjustment Boundaries

**Files:**
- Modify: `tests/filter-module-boundaries.spec.ts`

- [ ] Import the planned adjustment module exports.
- [ ] Assert facade exports are identity-equal to module exports for HDR presets, Auto defaults, Auto application, and Replace Color serialization.
- [ ] Compare direct algorithm output with registry filter output for representative deterministic basic, selection-aware, HDR, and color adjustment cases.
- [ ] Run the boundary test and verify it fails because the module does not exist.
- [ ] Commit the red characterization test.

### Task 2: Extract the Adjustment Engine

**Files:**
- Create: `components/photoshop/filters/adjustment-algorithms.ts`
- Modify: `components/photoshop/filters/registry.ts`

- [ ] Move the exact contiguous adjustment block through `snapMidtonesInPlace`.
- [ ] Import existing channel-mixer, basic-algorithm, curve-helper, and pixel-helper dependencies in the new module.
- [ ] Export algorithms called by registry definitions and hue-range helpers used by advanced adjustments.
- [ ] Import those symbols into the registry and re-export the existing public types and values.
- [ ] Leave registry definitions and their parameter coercion unchanged.

### Task 3: Verify

- [ ] Run focused filter and adjustment suites.
- [ ] Run lint and typecheck.
- [ ] Run capability reconciliation and production build.
- [ ] Inspect diff boundaries and whitespace.
- [ ] Commit the extraction independently.

