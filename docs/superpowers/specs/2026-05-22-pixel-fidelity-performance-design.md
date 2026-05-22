# Pixel Fidelity and Performance Package Design

Generated: 2026-05-22

## Context

The Photoshop Web editor already has a broad Photoshop-style surface: canvas editing, layers, layer masks, adjustment layers, a large filter registry, PSD import/export reporting, command palette access, right-dock panels, and Playwright coverage for many workflows.

The next release follows the user's requested priority order:

1. Pixel fidelity and filter depth.
2. File, color, and production pipeline support where it directly reinforces pixel work.
3. Photoshop-like workflow ergonomics where it exposes or verifies the pixel work.

The release is depth-first. It should improve real rendered output and confidence before broadening into unrelated Photoshop parity areas.

## Scope

Build a Pixel Fidelity and Performance Package with three connected tracks.

### Filter Fidelity and Worker Performance

Expand deterministic filter coverage, move more heavy filters through the worker or tiled pipeline where practical, and make worker support reportable through the capability system.

Initial candidates include filters already identified as high-impact or risky:

- Lens blur, radial blur, and surface blur metadata or worker/fallback handling.
- Existing worker-supported simple filters with stronger parity coverage.
- Filters with deterministic outputs that can be pinned by compact fixtures.
- Capability metadata that distinguishes worker-backed, tiled, main-thread fallback, approximate, and unsupported filter paths.

### Layer Effects Raster Fidelity

Add pixel regression coverage for layer styles and fix the highest-impact rendering gaps found by those tests.

The first coverage set should include:

- Drop shadow.
- Inner shadow.
- Outer glow.
- Inner glow.
- Bevel and emboss.
- Satin.
- Stroke.

Tests should validate rendered pixels or stable golden snapshots, not just serialized metadata.

### Painting, Clone, Healing, and Stamp Fidelity

Add focused tests around tools that directly alter pixels.

The first coverage set should include:

- Clone stamp.
- Pattern stamp.
- Spot healing and healing brush behavior.
- Blur, sharpen, and smudge-style stamps.
- Dodge, burn, and sponge.
- Paint bucket fill.

The goal is to test the underlying helper behavior directly, then keep a small number of full UI smoke tests for integration.

## Support Scope From Tracks B and C

File/color/production and workflow ergonomics are included only where they support this pixel package.

Included:

- Capability records and preflight/report entries for pixel pipeline limits.
- Filter worker support summaries surfaced in reporting or diagnostics.
- Menu, command palette, or panel discoverability for the new or clarified pixel capabilities.
- Tests proving these support surfaces match the actual implementation.

Excluded from this release:

- A broad color-management rewrite.
- Full native Photoshop, Camera Raw, neural, or plugin parity.
- A full panel redesign.
- A WebGL or GPU renderer migration.
- Large editor-context or type-system refactors unless a narrow extraction is required for testability.

## Architecture

The package stays inside the existing Next.js, React, TypeScript, Canvas 2D, worker, and reducer architecture.

### Shared Pixel Test Fixtures

Add compact deterministic image fixtures and helper utilities near the existing test fixture code. These fixtures should cover small synthetic patterns that make pixel assertions readable:

- Flat color blocks.
- Hard and soft edges.
- Alpha transitions.
- Small texture/noise patterns with deterministic seeds.
- Known source/target regions for clone and healing operations.

These fixtures avoid relying on arbitrary full-editor screenshots for low-level pixel behavior.

### Filter Kernel Boundary

Keep `components/photoshop/filters.ts` as the filter registry and source of filter definitions. Reduce drift between main-thread and worker implementations by adding parity tests first.

Where feasible, deterministic kernels should be shared or mirrored behind tests that prove:

- Worker output matches existing filter output within an explicit tolerance.
- Fallback output is stable when worker support is unavailable.
- Unsupported or approximate filters are reported honestly.

### Worker Support Metadata

Extend existing capability or filter metadata so the app can classify filter execution paths:

- Worker-backed.
- Worker-backed with tiling.
- Main-thread fallback.
- Approximate.
- Unsupported.

This metadata should feed capability summaries, preflight/report text, and tests. Unknown filters should default to a conservative fallback classification instead of implying full parity.

### Layer Effects Raster Verification

Treat `components/photoshop/layer-styles.ts` as the rendering source of truth for this release. Add tests that generate small layers with known style parameters and verify rendered output.

The tests should prefer stable pixel assertions for simple cases and golden snapshots for effects where local gradients or blur kernels make point checks too brittle.

### Stamp and Tool Pixel Harness

Add a narrow test harness around existing tool/pixel helpers so clone, healing, blur, sharpen, smudge, dodge, burn, sponge, and fill behavior can be tested without driving every case through pointer UI flows.

The harness should use the same canvas and ImageData paths as the editor code. It should not introduce a separate fake rendering engine that can diverge from production behavior.

### Reporting and UI Exposure

Update `components/photoshop/capabilities.ts`, preflight/document report generation, and command/menu text only where they describe these pixel features.

UI changes should be small and utilitarian:

- Label execution limits clearly.
- Expose worker/fallback status where useful.
- Keep the command palette and menus aligned with actual support.
- Avoid claiming complete Photoshop parity for browser-local approximations.

## Data Flow

Editor commands continue through the existing reducer and dispatch path.

Filter flow:

1. The active layer or composite pixel source is selected.
2. The filter registry identifies the filter and support metadata.
3. A worker or tiled worker path runs when supported.
4. Existing scheduled main-thread execution handles supported fallback cases.
5. The result dispatches through the existing document/layer update path and history handling.
6. Capability and preflight reports reflect the path used or available.

Layer effects flow:

1. A layer style configuration is created on a small deterministic layer.
2. The existing layer-style renderer produces pixels.
3. Tests compare pixels or golden output against expected results.
4. Fixes stay inside the layer-style renderer unless a narrow shared helper is justified.

Stamp/tool flow:

1. Test fixtures create source and target canvases.
2. Existing tool helpers perform a single stamp, fill, or pixel operation.
3. Tests inspect the mutated target pixels and history/update boundaries where relevant.
4. A small number of UI tests verify that representative commands still route through the editor.

## Error Handling

Worker failures must not leave a document half-edited.

- If an equivalent main-thread implementation exists, worker failure falls back to that implementation.
- If no equivalent exists, the operation should surface a limitation or unsupported state without mutating pixels.
- Large or expensive filters should be classified explicitly as worker, tiled, fallback, approximate, or unsupported.
- Unknown capabilities or filter execution paths should resolve to conservative report text.
- Pixel tests should use small fixtures, explicit tolerances, and deterministic seeds.

## Testing

Use TDD in focused slices.

1. Add failing filter parity or golden tests, then expand worker support or metadata.
2. Add failing layer-style raster tests, then fix rendering gaps or pin current behavior honestly.
3. Add failing stamp/tool pixel tests, then fix the highest-impact helper behavior.
4. Add reporting tests that prove capability and preflight output reflects the pixel pipeline.
5. Add minimal UI integration coverage for command/menu/panel exposure.

Targeted verification during implementation:

- `npm run typecheck`
- `npm run build`
- Targeted Playwright tests for the changed area.
- `npm run verify` before claiming the full package is complete when practical.

## Implementation Phases

1. Add shared deterministic pixel fixtures and comparison helpers.
2. Add filter execution metadata and failing tests for representative worker/fallback paths.
3. Expand worker/tiled support or fix metadata for the selected filter set.
4. Add layer-style raster tests for the first effect set and address high-impact failures.
5. Add stamp/tool pixel tests and address high-impact helper failures.
6. Wire capability, preflight, and document-report summaries for the pixel pipeline.
7. Add small command/menu/panel integration tests for discoverability and honest status text.
8. Run targeted verification, then broader verification as runtime allows.

## Risks

- The editor has large central files; changes must stay narrow.
- Existing main-thread and worker filter algorithms may have drifted; tests should reveal drift before refactoring.
- Pixel tests can become brittle if they assert too many exact intermediate values. Use fixture size, tolerance, and golden scope deliberately.
- Worker and browser canvas behavior can vary by environment. Tests should avoid relying on undefined browser behavior.
- The repo already has a dirty worktree. Implementation must preserve unrelated changes and commit only intentional files.

## Acceptance Criteria

- Filter execution support is testable and reportable.
- Representative worker and fallback filter paths have deterministic parity or golden coverage.
- Layer-style raster output has pixel or golden coverage for the first effect set.
- Representative painting, clone, healing, stamp, and fill operations have direct pixel tests.
- Preflight, capability, and document report surfaces describe pixel pipeline limits without overstating Photoshop parity.
- Existing editor workflows remain reachable through menus, command palette, panels, or tool UI where relevant.
