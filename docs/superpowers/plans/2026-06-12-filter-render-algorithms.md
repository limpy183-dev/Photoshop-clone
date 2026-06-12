# Filter Render Algorithms Implementation Plan

**Goal:** Extract sky replacement and procedural render algorithms from `filters/registry.ts` while preserving deterministic output.

**Architecture:** Add `components/photoshop/filters/render-algorithms.ts` for sky replacement, Perlin/fBm noise, Clouds, Fibers, and Lens Flare. Export `fbmNoise` back to the registry for existing downstream effects.

### Task 1: Characterize

- [ ] Compare direct sky, cloud, fiber, and lens-flare output with registry filters.
- [ ] Verify missing-module failure and commit the red test.

### Task 2: Extract

- [ ] Move the exact block ending before Other Filters.
- [ ] Export registered algorithms and shared `fbmNoise`.
- [ ] Import all moved symbols into the registry without changing definitions.

### Task 3: Verify

- [ ] Run focused filter suites, lint, and typecheck.
- [ ] Compare moved source with its original body.
- [ ] Run capability reconciliation and production build.
- [ ] Commit independently.

