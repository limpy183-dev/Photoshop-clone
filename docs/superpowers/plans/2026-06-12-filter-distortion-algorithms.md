# Filter Distortion Algorithms Implementation Plan

**Goal:** Extract shared geometry sampling and distortion algorithms from `filters/registry.ts` without changing registered filter behavior.

**Architecture:** Add `components/photoshop/filters/distortion-algorithms.ts` for bilinear sampling, classic distortions, Adaptive Wide Angle, perspective-plane warping, and Vanishing Point. Move the later shared `distanceToSegment` helper into the same module and import it back for blur-path callers.

### Task 1: Characterize Geometry and Distortions

- [ ] Add direct bilinear-sampling coverage.
- [ ] Compare direct classic, adaptive, and perspective distortion output with registry filters.
- [ ] Verify missing-module failure and commit the red test.

### Task 2: Extract

- [ ] Move the contiguous geometry/distortion block ending before sky replacement.
- [ ] Move `distanceToSegment` and import it back into the registry.
- [ ] Export registry-called algorithms and shared helpers.
- [ ] Keep registry definitions and parameter coercion unchanged.

### Task 3: Verify

- [ ] Run focused filter and requested-adjustment suites.
- [ ] Run lint, typecheck, capability reconciliation, and production build.
- [ ] Compare both moved source regions with their pre-extraction bodies.
- [ ] Commit the extraction independently.

