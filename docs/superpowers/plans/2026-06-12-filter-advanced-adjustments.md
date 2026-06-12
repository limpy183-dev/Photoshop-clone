# Filter Advanced Adjustments Implementation Plan

**Goal:** Extract advanced color adjustments from `filters/registry.ts` while preserving registry definitions, context handling, and pixel output.

**Architecture:** Add `components/photoshop/filters/advanced-adjustment-algorithms.ts` containing LUT processing, advanced Black & White, Curves, Color Balance, Vibrance, Gradient Map, and Match Color. The extraction ends before shared bilinear geometry sampling.

### Task 1: Characterize the Boundary

- [ ] Add direct-module versus registry tests for LUT, advanced tonal/color, gradient, and context-backed Match Color behavior.
- [ ] Verify the test fails because the module is absent.
- [ ] Commit the red test.

### Task 2: Extract Advanced Adjustments

- [ ] Move the exact block from `CubeLut` through LAB conversion helpers.
- [ ] Import color parsing, core adjustment hue helpers, curve helpers, and pixel helpers.
- [ ] Export only algorithms called by registry definitions.
- [ ] Rewire registry imports without changing definitions or coercion.

### Task 3: Verify

- [ ] Run focused adjustment/filter tests.
- [ ] Run lint, typecheck, capability reconciliation, and production build.
- [ ] Compare the moved source with the pre-extraction block after export normalization.
- [ ] Commit the extraction independently.

