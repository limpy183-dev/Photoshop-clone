# Layer Non-Destructive Workflows Design

## Goal

Complete the existing layer and non-destructive editing workflows without replacing the current editor architecture. The app project format remains the source of truth. PSD export/import preserves what browser APIs and `ag-psd` can represent, and reports app-only or baked behavior explicitly.

## Scope

This feature covers layer comps, guides, grids, slices, layer search/filtering, layer notes/metadata, linked and embedded smart-object workflows, smart-object replace/export contents, smart-filter masks/opacity/blend/reorder controls, adjustment-layer mask commands, and PSD/project reporting for app-only metadata.

## Architecture

Add small workflow helpers beside the existing Photoshop modules:

- `layer-workflows.ts` owns layer-comp capture/summaries, layer search predicates, metadata defaults, guide/slice normalization, and smart-filter stack edits.
- `smart-objects.ts` remains the smart-object source helper module and gains file-handle/relink/edit-package helpers.
- `types.ts` gains narrowly scoped optional metadata fields on existing interfaces.
- Panels and dialogs call these helpers instead of duplicating capture/filter logic.
- `document-io.ts` serializes the new metadata into project files and improves report wording for app-only, PSD-native, marker-fallback, baked, and unsupported data.

## UI

The existing dense, utilitarian editor style stays intact. Panels get compact controls, icon buttons, and token-based search rather than large new surfaces. The first screen remains the editor workspace.

Layer search accepts plain text and tokens such as `kind:`, `label:`, `note:`, `meta:`, `smart:linked`, `filter:`, `mask:disabled`, `visible:true`, and `locked:true`.

Layer comps capture richer appearance state and show diagnostics for missing, locked, or matched layers.

Guides and slices gain practical panel workflows: named guide presets, lock/visibility toggles, grid/snap controls, selected slice editing, slice duplication, and JSON import/export helpers.

Smart objects gain actions for relink/update from browser file handles, replace contents, export contents, and embedded edit packages. Unsupported browser-local handles are preserved as metadata where possible but reported honestly for PSD/raster export.

Smart filters gain stack edit helpers and panel-visible controls for reordering, toggling, opacity, blend mode, mask enable/invert/clear/fill.

Adjustment layers gain mask invert/clear/fill/disable/refine commands aligned with the existing adjustment thumbnail and mask painting workflow.

## Data Flow

Reducer actions remain the mutation boundary. Panels dispatch typed actions, request render, and commit history entries. Project serialization stores all app metadata. PSD conversion uses native resources when available and marker/comment fallback only for fields `ag-psd` cannot natively model.

## Testing

Add focused module tests first for helper behavior and reducer actions, then Playwright workflow coverage for panels/actions. Extend existing project round-trip and PSD/report tests to cover the new metadata.
