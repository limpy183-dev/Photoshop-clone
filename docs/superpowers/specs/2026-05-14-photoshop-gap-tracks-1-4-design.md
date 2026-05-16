# Photoshop Gap Tracks 1-4 Design

Generated: 2026-05-14

## Scope

Implement the first four tracks from `PHOTOSHOP_FEATURE_GAP_REPORT.md`:

1. Foundation: machine-checkable capability registry, warnings, preflight/report integration, and tests.
2. Core editing: first-class missing tools and practical local behavior for the tools that can be implemented in-browser.
3. Pixel engine: expanded worker-backed deterministic filters and parity tests.
4. Professional interoperability: stronger round-trip/export/color/file-format reporting and tests.

External AI services, native Adobe plugin runtimes, Creative Cloud sync, Adobe Stock licensing, Adobe Fonts account sync, and true native codec parity for formats with no browser/WASM decoder in this repository are out of scope for implementation. They must be represented honestly as unsupported or integration-required capabilities.

## Goals

- Avoid adding feature labels that imply unsupported Photoshop parity.
- Make each important feature surface queryable by code.
- Add missing first-class tools where they can route to existing or new local browser behavior.
- Move more deterministic filter work off the main thread without changing visual output.
- Improve professional file/color/export reporting so users can see what is preserved, approximated, flattened, or unsupported.
- Add tests that pin capability coverage, tool reachability, filter worker parity, and interoperability warnings.

## Non-Goals

- Implement hosted generative AI or neural filters.
- Execute native 8BF, CEP, or UXP plugins.
- Add real Adobe account/cloud integrations.
- Claim full RAW/DNG/EXR/PSB support without a decoder/parser.
- Rebuild the entire canvas engine or split the largest files in this pass unless a focused extraction is needed for testability.

## Architecture

### Capability Registry

Create `components/photoshop/capabilities.ts` as the central status registry. It defines typed capability records with:

- `id`
- `label`
- `kind`
- `status`
- `summary`
- `limitations`
- `recommendedAction`
- optional `dependsOn`
- optional `testCoverage`

Statuses:

- `complete`: production-ready for this app's stated browser-local scope.
- `usable`: works for common cases but is not full Photoshop parity.
- `approximation`: intentionally local or simplified.
- `stub`: visible but not yet meaningful behavior.
- `unsupported`: not implemented or requires external/native infrastructure.

The registry covers tools, filters, panels, file formats, export formats, color modes, smart-object features, workflow engines, and external integrations. Helpers expose status lookup, filtering, summaries, and document-specific warnings.

### UI and Reporting Integration

Integrate capability data into:

- Command palette disabled/help text for unsupported or limited commands.
- Preflight check as a new capability audit section.
- Document report generation for app-only and PSD/export boundaries.
- Advanced subsystem format matrix by deriving status from the registry where applicable.

This pass should not redesign the UI. It adds accurate metadata and compact warnings to existing surfaces.

### Core Editing Tools

Add first-class tool IDs and toolbar entries:

- `quick-selection`
- `slice-select`
- `freeform-pen`
- `add-anchor-point`
- `delete-anchor-point`
- `convert-point`
- `type-vertical`
- `shape-rounded-rect`
- `shape-polygon`
- `shape-triangle`

Behavior:

- Quick Selection: use existing edge-aware local selection helper where possible, with brush-like options in the options bar.
- Slice Select: select existing slices and expose selection in the Slices panel/document state.
- Freeform Pen: record freehand points into a path layer.
- Add/Delete/Convert Anchor Point: edit the active path/shape path metadata.
- Vertical Type: create a text layer with `vertical: true`.
- Rounded Rectangle: create a shape layer with radius from existing shape options.
- Polygon/Triangle: create polygon shape layers with sides metadata.

Where full Photoshop behavior is not feasible, status remains `usable` or `approximation`, not `complete`.

### Pixel Engine

Extend `filter-worker.ts` in small TDD slices:

- Add worker implementations for deterministic filters first.
- Start with filters where parity against existing `filters.ts` is practical: box blur, sharpen, add noise with deterministic seed, threshold-like filters, and simple convolution paths.
- Keep unsupported/heavy registry filters on the scheduled main-thread fallback.
- Add worker support metadata so tests and UI can report real worker coverage.

No visual algorithm changes are intended unless tests explicitly define a corrected behavior.

### Professional Interoperability

Improve reporting without overstating codec support:

- Add capability-derived warnings for PSD/project/export reports.
- Add explicit actual pixel pipeline metadata: browser 8-bit RGBA canvas unless future pipeline says otherwise.
- Add report items for bit-depth mismatch, color-mode approximation, metadata/ICC export loss, smart filters rasterization, app-only features, and unsupported advanced formats.
- Add tests for project round-trip classification and export/color warnings.

## Data Flow

1. Static feature capability records live in `capabilities.ts`.
2. Runtime document state is inspected by helper functions.
3. Preflight, command palette, document reports, and advanced subsystem dialogs request capability summaries.
4. Tests import the helpers directly for deterministic assertions and use Playwright for UI reachability.

## Error Handling

- Unknown capability IDs return a stable `unsupported` fallback record.
- Missing document state yields no document-specific warnings rather than throwing.
- Worker filter failures fall back to existing async main-thread execution.
- File-format detection continues to report metadata-only/unsupported states rather than failing import flows unless the user asks to create a pixel layer and no decoder path exists.

## Testing

Use TDD for implementation:

- Unit-style Playwright/TypeScript tests for capability registry coverage and helper behavior.
- Existing Playwright UI tests for toolbar and command palette reachability.
- Algorithm tests for filter worker support and parity.
- Interoperability/report tests for document report classification and export/color warnings.

Verification commands:

- `npm run typecheck`
- `npm run build`
- targeted Playwright tests while iterating
- `npm run verify` before final completion claims when practical

## Implementation Phases

1. Foundation capability registry and tests.
2. Reporting and preflight integration.
3. First-class tool IDs, toolbar/shortcut/options wiring, and tests.
4. Local behavior for the missing tools in focused slices.
5. Worker filter expansion and parity tests.
6. Interoperability reporting and round-trip/export tests.

## Risks

- The editor has very large files; changes must stay narrowly scoped.
- Some features have existing UI labels but limited behavior; capability status must reflect the real implementation.
- Browser APIs vary by environment; export and worker tests must allow capability-specific fallbacks.
- Full Photoshop parity is not achievable for external/native/service-dependent features in this repository alone.
