# Canvas View Behavior-Preserving Refactor Design

## Goal

Decompose `components/photoshop/canvas-view.tsx` into focused modules while preserving all current behavior, including UI structure, interaction timing, rendering order, browser fallbacks, event names, known quirks, and test IDs.

## Constraints

- `CanvasView` remains the sole public component and keeps its current import path.
- No feature work, bug fixes, visual changes, or interaction redesign is included.
- Existing React state, refs, effects, and event routing remain in `CanvasView` until an extraction can preserve their exact lifecycle and closure behavior.
- Extracted code receives explicit inputs instead of reading editor context.
- Existing unrelated working-tree changes remain untouched.

## Approaches Considered

### Incremental Extraction

Move pure helpers and self-contained subsystems behind compatibility imports, one verified slice at a time.

This is the selected approach because it minimizes behavioral risk, permits direct source comparison, and keeps every commit independently reversible.

### Custom-Hook Decomposition

Move brush, transform, zoom, and selection state into React hooks. This would produce a smaller component sooner, but would alter effect dependencies, closure timing, and state ownership.

This approach is deferred because strict behavior preservation has priority over architectural neatness.

### Controller Rewrite

Replace the component with an explicit interaction state machine. This could eventually improve maintainability, but it would change the execution model and carries unacceptable regression risk for this refactor.

## Target Architecture

`CanvasView` remains the orchestration layer. It continues to:

- read editor context;
- own React state and mutable interaction refs;
- subscribe to render and Photoshop events;
- route pointer, wheel, keyboard, and drag events;
- coordinate extracted modules.

Focused sibling modules will own:

1. **Runtime helpers**
   - tool option readers;
   - canvas preference conversion;
   - edit-permission predicates;
   - fingerprints and path translation.

2. **Geometry and transform helpers**
   - transform points, bounds, handles, hit testing, and context setup;
   - shape construction and resizing;
   - snapping and alpha-bound calculations where dependency direction permits.

3. **Overlays and rulers**
   - smart guides;
   - selection and mask overlays;
   - text editing overlay;
   - ruler rendering and guide drag behavior.

4. **Compositor and cache engine**
   - layer source preparation;
   - smart-filter and adjustment application;
   - mask alpha and filter caches;
   - compositor callbacks and canvas pooling.

5. **Brush and stroke helpers**
   - deterministic brush-control math;
   - color dynamics;
   - dirty-rectangle math;
   - reusable pixel and dab calculations that do not own React state.

6. **Interactive filter overlays**
   - Blur Gallery drawing primitives;
   - Lighting Effects drawing primitives;
   - explicit state and canvas inputs.

7. **Selection and vector helpers**
   - pure path, shape, crop, and selection calculations;
   - vector edit lookup and replacement helpers where they do not mutate editor state.

Pointer routing and high-frequency mutable interaction state remain in `CanvasView` for the initial decomposition. They may move only after the extracted dependency surface is small enough to prove equivalent lifecycle behavior.

## Data Flow

Extracted modules use explicit arguments and return values:

```text
editor context/state
        |
        v
CanvasView orchestration
        |
        +--> pure helpers --> values
        +--> compositor --> canvas/image output
        +--> overlays --> React elements or canvas drawing
        +--> interaction helpers --> calculated updates
```

Extracted modules must not import `useEditor` or create a second source of editor state.

## Compatibility

The refactor preserves:

- the `CanvasView` named export;
- DOM hierarchy and CSS classes unless moving identical JSX;
- all `data-testid` values;
- Photoshop custom-event names and payload shapes;
- pointer capture and cancellation semantics;
- render subscriptions and scheduling;
- zoom commit delay and requestAnimationFrame behavior;
- canvas allocation, cache identity, and invalidation behavior;
- editor dispatch and history commit ordering.

Private helpers may become module exports only to support direct characterization tests and internal imports. They are not part of the application's public API.

## Error Handling

Existing behavior remains authoritative:

- browser API probes retain their current `try`/`catch` fallbacks;
- missing canvas contexts retain current no-op or null behavior;
- malformed runtime globals retain current defaults;
- caches retain current identity and invalidation semantics;
- no new errors are surfaced to users.

## Testing Strategy

Every extraction follows red-green-refactor:

1. Add characterization tests that import the planned module and compare direct output with current behavior.
2. Run the tests and verify the expected missing-module or missing-export failure.
3. Move exact implementations and add only required exports/imports.
4. Run focused node and browser tests for the affected subsystem.
5. Run lint and typecheck.
6. Compare moved source with its pre-extraction body where practical.
7. Run capability reconciliation and production build.
8. Periodically run the complete 828-test smoke suite, and always run it before declaring the canvas-view refactor complete.

## Implementation Order

1. Runtime and geometry helpers.
2. Remaining overlays and rulers.
3. Compositor and cache engine.
4. Brush and stroke math.
5. Blur Gallery and Lighting Effects overlay drawing.
6. Selection and vector helpers.
7. Reassess pointer-routing extraction based on the remaining dependency graph.

Each slice is committed independently. If a boundary requires widespread lifecycle changes, it remains in `CanvasView` rather than forcing an unsafe abstraction.

## Completion Criteria

- `CanvasView` is materially smaller and primarily coordinates state, refs, and events.
- Extracted modules have clear responsibilities and no editor-context ownership.
- Existing focused tests pass.
- Lint, typecheck, capability checks, and production build pass.
- The complete smoke suite passes.
- No unrelated working-tree changes are included in refactor commits.
