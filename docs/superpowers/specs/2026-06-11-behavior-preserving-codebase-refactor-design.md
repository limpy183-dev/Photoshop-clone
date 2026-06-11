# Behavior-Preserving Codebase Refactor Design

Generated: 2026-06-11

## Goal

Refactor the repository into smaller, responsibility-focused modules without changing current application behavior.

The refactor must preserve the observable behavior of the editor, marketing site, API routes, persistence formats, events, exports, rendering paths, and tests. Verified product defects remain unchanged unless a mechanical extraction cannot preserve existing behavior without an explicit compatibility adapter.

## Baseline

The repository contains approximately 166,000 source lines across 256 TypeScript and TSX files, plus approximately 23,000 test lines across 103 test files. The current baseline passes:

- `npm run lint`
- `npm run typecheck`

The main maintainability hotspots include:

- `components/photoshop/canvas-view.tsx`
- `components/photoshop/filters.ts`
- `components/photoshop/editor-context.tsx`
- `components/photoshop/document-io.ts`
- `components/photoshop/menu-bar.tsx`
- `components/photoshop/webgl-compositor.ts`
- `components/photoshop/advanced-subsystems-dialog.tsx`
- `components/photoshop/raster-codecs.ts`
- `components/photoshop/tool-helpers.ts`
- `components/photoshop/types.ts`

The working tree already contains unrelated modifications and deletions. The refactor must preserve and work around those changes.

## Constraints

### Required

- Preserve current runtime behavior, including known defects.
- Preserve public and cross-module exports unless the original module re-exports the same symbol.
- Preserve editor action names, action payloads, reducer semantics, and dispatch ordering.
- Preserve custom event names, payloads, timing, and propagation behavior.
- Preserve serialized project, autosave, preference, and local-storage formats.
- Preserve DOM structure, selectors, accessible names, keyboard behavior, and styling unless module extraction alone changes source ownership.
- Preserve rendering order, canvas allocation behavior, pixel algorithms, filter coefficients, worker messages, and fallback paths.
- Preserve route paths, request and response contracts, environment variables, and deployment behavior.
- Keep the repository buildable after every committed phase.
- Avoid broad import churn outside the subsystem currently being refactored.

### Excluded

- Product features or UI redesign.
- Correctness fixes, including issues recorded in `Findings.txt`.
- Performance optimization.
- Dependency upgrades or framework migrations.
- State-management replacement.
- Storage-format migrations.
- Test rewrites that weaken assertions or merely accommodate regressions.
- Renaming externally observable identifiers for stylistic consistency.
- Reformatting unrelated files.

## Approach

Use incremental mechanical decomposition. Existing entry modules remain compatibility facades while implementation details move into focused files. Each extraction begins with characterization coverage where current tests do not adequately pin the behavior, then moves code with the smallest possible semantic change.

The refactor proceeds subsystem by subsystem. A phase does not begin until the previous phase passes its verification gates. Large files are reduced through cohesive extractions rather than arbitrary line-count splits.

## Target Architecture

### Editor State

Keep `editor-context.tsx` as the public React integration point and preserve `EditorProvider`, `useEditor`, `useRenderSubscription`, the `Action` union, and current exports.

Extract internal responsibilities into an `editor/` directory:

- state and action type definitions
- initial state and document construction
- reducer action families
- history snapshot and restore helpers
- persistence hydration filtering
- provider-side effects and event adapters
- context value assembly

Reducer action families may be composed behind one exported reducer, but action evaluation order and side effects must remain identical. This phase explicitly does not make the reducer pure or change dirty tracking.

### Canvas Runtime

Keep `canvas-view.tsx` as the `CanvasView` entry component.

Extract cohesive units into a `canvas/` directory:

- render orchestration and backend selection
- pointer lifecycle and coordinate conversion
- stroke lifecycle and tool routing
- selection and transform interactions
- vector and path interactions
- crop, slice, frame, and measurement interactions
- overlay composition and transient HUD state
- document composite preparation
- canvas event subscriptions

Existing refs and mutable runtime state must remain owned at the same effective lifecycle level. Extraction may use parameter objects or hooks, but must not reorder effects, callbacks, pointer handling, or render invalidation.

### Filters

Keep `filters.ts` as the stable filter registry facade.

Extract into a `filters/` directory:

- shared filter contracts and parameter helpers
- color and tonal filters
- blur and sharpen filters
- noise, pixelate, and stylize filters
- distort filters
- render filters
- correction and replacement helpers
- auto-adjustment and HDR helpers
- registry assembly

Pixel loops, rounding, clamping, alpha handling, defaults, filter IDs, labels, categories, and registry insertion order must remain unchanged. Characterization tests should compare representative input and output buffers before and after extraction.

### Document I/O

Keep `document-io.ts` as the stable import surface.

Extract into a `document-io/` directory:

- raster export and browser encoder diagnostics
- SVG and animation export
- project serialization and deserialization
- compatibility manifests and reports
- PSD inspection, import, and export adapters
- file download and File System Access helpers
- raster file loading

The facade re-exports the current symbols. Serialization key order, validation limits, async sequencing, warnings, fallback behavior, MIME types, and filenames remain unchanged.

### Commands And Menus

Keep `menu-bar.tsx` as the rendered menu entry component.

Extract into a `menus/` directory:

- static menu definitions
- command dispatch adapters
- file/open/save/export workflows
- edit and document commands
- image and layer commands
- selection and filter commands
- view, window, help, 3D, video, and plugin commands
- dialog visibility state

Menu labels, separators, nesting, disabled state, shortcut text, event dispatch, async command ordering, and dialog mounting behavior remain unchanged.

### Rendering, Codecs, Tools, Types, And Large Dialogs

Apply the same facade-first pattern to the remaining hotspots:

- split `webgl-compositor.ts` by capabilities, shader/program management, pass execution, and composition planning
- split `raster-codecs.ts` by format family while retaining one codec facade
- split `tool-helpers.ts` by tool family without changing algorithms
- split `types.ts` into domain type modules and re-export every existing type from `types.ts`
- split `advanced-subsystems-dialog.tsx` into tab and workflow components while preserving mounting and local state behavior
- split oversized panel components into private subcomponents and hooks without changing their public component exports

## Dependency Rules

- Compatibility facades may import implementation modules; implementation modules must not import their facade.
- Domain helpers must not depend on React unless they directly implement React behavior.
- Pure algorithm modules must not import editor context or UI modules.
- UI modules may depend on domain types and services through existing public contracts.
- New barrel files are allowed only at stable subsystem boundaries. Avoid barrels inside algorithm-heavy directories where they could introduce cycles.
- Any circular dependency introduced by extraction blocks that phase.

## Data Flow

The refactor preserves existing data flow:

1. UI surfaces invoke existing callbacks, dispatch actions, or emit custom events.
2. `EditorProvider` and the reducer process actions using the current ordering and semantics.
3. Render invalidations continue through the current render bus and subscriptions.
4. Canvas and panel consumers read the same context value shape.
5. File workflows call the same serialization and export contracts.
6. Worker and codec boundaries retain their current message and data structures.

Internal modules may receive explicit dependency objects to replace closure capture, but those objects must expose the same values and functions at the same point in the lifecycle.

## Error Handling

Current error behavior is part of the compatibility contract. Extracted code must preserve:

- thrown error types and messages where tests or UI consume them
- fallback behavior after worker, codec, browser API, and storage failures
- console logging and user-facing toast/dialog behavior
- synchronous versus asynchronous failure timing
- cleanup behavior in success, failure, abort, and unmount paths

The refactor must not add broad catch blocks, suppress failures, or normalize errors across subsystems.

## Testing Strategy

### Characterization

Before moving behavior that lacks direct coverage, add focused characterization tests for:

- exported filter outputs and registry metadata
- reducer action sequences and context value contracts
- project serialization output and import round trips
- menu command routing and event payloads
- canvas helper behavior that can be tested without pixel-level browser interaction
- worker message contracts

Characterization tests record current behavior, including behavior that appears incorrect.

### Phase Verification

Each phase must run:

- `npm run lint`
- `npm run typecheck`
- the focused Playwright specs for the changed subsystem

Each major subsystem milestone must also run:

- `npm run check:capabilities`
- `npm run build`

Before completion, run:

- `npm run verify`

If the full Playwright suite has a pre-existing concurrency failure, verify the failure against the pre-refactor baseline and rerun the affected spec in isolation. New failures or changed output block completion.

### Behavioral Comparison

Where deterministic outputs exist, compare before and after extraction:

- serialized project strings or normalized parsed structures
- filter `ImageData` byte arrays
- compatibility manifests and reports
- menu item trees and command IDs
- reducer state after fixed action sequences
- built route and export surfaces

## Implementation Phases

1. Establish baseline artifacts and characterization tests.
2. Extract shared types and low-risk pure utilities.
3. Decompose filter registry and algorithms.
4. Decompose document I/O and raster codecs.
5. Decompose editor state internals behind `editor-context.tsx`.
6. Decompose menus and command workflows.
7. Decompose canvas rendering and interaction runtime.
8. Decompose WebGL, large dialogs, and oversized panels.
9. Consolidate dependency rules, remove transitional duplication, and update architecture documentation.
10. Run full verification and compare public exports and deterministic outputs against the baseline.

Each phase should use several small commits. A commit should move one cohesive responsibility and keep the repository passing its focused checks.

## Completion Criteria

The refactor is complete when:

- all production TypeScript and TSX modules have a clear single responsibility
- the named hotspot files are reduced to orchestration or compatibility facades, with no arbitrary requirement that every file meet a fixed line limit
- all existing public exports remain available from their original import paths
- baseline lint, typecheck, capability, build, and test behavior is preserved
- no storage, event, worker, route, or UI contract changes
- no known defect is intentionally corrected as part of the refactor
- no unrelated working-tree changes are reverted or included in refactor commits
- architecture documentation describes the new module boundaries and compatibility facades

## Rollback Strategy

Every extraction commit must be independently revertible. If a phase creates a regression that cannot be isolated quickly, revert only that phase's commits and retain earlier verified phases. Transitional facades remain until all known consumers use stable subsystem exports.
