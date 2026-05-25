# Browser-Implementable Gaps Report

Generated: 2026-05-24

Scope: this report only includes partially implemented or not implemented work that is feasible inside this project as a browser-based Next.js/React/TypeScript/Canvas application. It excludes Adobe account/cloud integrations, Adobe proprietary APIs, native Photoshop plugin runtimes, native binary plugins, service-backed AI features, and capabilities that cannot realistically run inside a browser page.

## Partially Implemented

### Full WebGL compositor path

Partially implemented:
- `webgl-compositor.ts` exists and can attempt compatible layer/blend rendering with fallback reasons.
- The project already has tile stores, dirty rect tracking, memory budget tracking, and progressive preview infrastructure.

Not implemented:
- A complete WebGL layer-stack compositor for every layer kind.
- GPU support for the full blend-mode set.
- GPU-compatible rendering of layer masks, vector masks, clipping, adjustment layers, layer effects, and smart filters.
- Tile-aware WebGL rendering for huge documents.
- Per-layer or per-effect fallback from WebGL to 2D without losing compositing correctness.

### Tiled rendering beyond raster layers

Partially implemented:
- Tiled backing store, tile cache, OPFS spill, and memory budget tracking exist for raster-heavy workflows.

Not implemented:
- Smart object tile rendering.
- Smart object tile invalidation when source content changes.
- 3D layer tile previews.
- Tile-level cached rendering for text, shape, and vector layers.
- Layer-isolated tile recomposition for masks, effects, adjustment layers, and clipping groups.

### Large-document handling

Partially implemented:
- Canvas size checks, preflight warnings, memory budget tracking, progressive previews, tile storage, and PSB large-document mode exist.

Not implemented:
- A consistent "open at reduced scale" UX for every oversized import path.
- Full tile-only viewing/editing for documents exceeding browser canvas limits.
- Clear per-browser canvas/GPU/memory diagnostics in the UI.
- Inspection mode for files that can be parsed but cannot safely be fully edited.
- User-facing recovery options when a document exceeds memory or canvas limits mid-operation.

### High-bit typed-array editing

Partially implemented:
- Local 16/32-bit typed-array image buffers exist.
- High-bit histogram, tone mapping, pixel readout, and selected high-bit filters exist.
- Color and bit-depth honesty reports exist.

Not implemented:
- Routing most filters through high-bit buffers.
- Adjustment layers operating directly on high-bit buffers before tone mapping.
- High-bit-aware brush and paint operations.
- UI comparing source high-bit pixel values against 8-bit canvas preview values.
- Export paths preserving more typed-array precision where target formats allow it.

### Browser color management

Partially implemented:
- RGB/CMYK/Lab/Grayscale conversion helpers exist.
- Color-mode metadata and proofing/gamut-warning style reporting exist.

Not implemented:
- A JavaScript or WASM ICC transform engine.
- Profile assignment/conversion UI backed by real transforms.
- Accurate soft-proof preview transforms.
- Gamut-warning overlays based on actual profile conversion math.
- Profile-aware export conversions.

### Shape and path editing

Implemented:
- Shape/path metadata, pen/path tools, anchor add/delete/convert operations, custom shapes, stars/polygons, exact embedded-font text-to-path conversion when font bytes are available, and vector export helpers exist.
- Direct on-canvas Bezier handle dragging has robust anchor/handle/segment hit testing, symmetric and broken handle modes, subpath-aware edits, and shape computed-path support.
- Rectangle-component path booleans preserve exact fractional edges; complex curved operands resolve through flattened editable paths.
- Per-corner rounded rectangle editing covers handles, transforms, serialization, PSD markers, and computed path operations.
- Freeform pen and magnetic lasso fitting use Scharr gradients, non-maximum suppression, hysteresis weak-edge linking, and smoothing controls.

### Selection quality

Partially implemented:
- Local edge/color-based selection algorithms and refinement workflows exist.
- Offline object-aware subject/sky/background/object segmentation, hysteresis magnetic lasso linking, visual quick-selection diagnostics, filament-aware matting, and high-bit-aware magnetic trace inputs are implemented.

Not implemented:
- More consistent behavior across zoom levels and transformed layers.

### Blur Gallery interaction

Implemented:
- Local blur gallery algorithms, parameter-control helpers, on-canvas control state, multi-pin selection/deletion/duplication/keyboard edits, and serialized control params exist for Field Blur, Iris Blur, Tilt-Shift, Path Blur, and Spin Blur.
- Blur Gallery smart filters persist deterministic Photoshop-style `8BIM` mesh-resource descriptors with normalized params, control state, mesh geometry, payload checksums, and PSD metadata round trips.

Still browser-local:
- Preview quality and performance depend on the local browser worker/tile pipeline rather than Adobe's private Blur Gallery GPU engine.

### Smart filter editing

Implemented:
- Smart filter metadata, order, masks, opacity, blend modes, enabled states, and local project preservation exist.
- On-canvas smart filter mask painting uses Photoshop-style mask semantics: white reveals the selected filter, black hides it, and gray partially reveals it.
- Mask density and feather controls are exposed in the Properties panel and clamped in reducer updates.
- Drag-and-drop filter reordering works in Filter Gallery, Properties, and Layers panel smart-filter sub-item surfaces.
- Stacked smart filter preview reuses the downsampled source and cached intermediate stack outputs for faster live updates.
- The main canvas shows a per-filter smart mask edit banner with layer/filter context and an exit control.
- PSD export emits native placed-layer smart filter descriptors plus filter-effect mask records for supported filters, while preserving unsupported filter details in app metadata.
- Blur Gallery smart filters include deterministic `8BIM` mesh-resource descriptors in the preserved PSD smart-filter payload.

Not fully implemented:
- Photoshop-private smart filter resources beyond the implemented placed-filter, mask, and Blur Gallery mesh descriptors are still metadata-preserved or rasterized rather than emitted as exact private descriptors.

### Contact sheet and picture package depth

Implemented:
- Contact sheet and picture package import, layout, labels, preview, export, and open-as-document behavior exist.
- Contact sheets automatically paginate when the selected grid cannot hold all images.
- Multi-page contact sheet batches can be previewed page-by-page, exported as flattened PDF, or packaged as page images in a ZIP.

Not implemented:
- More print/photo package presets.

### Export workflow depth

Partially implemented:
- Many export encoders, metadata paths, and compatibility reports exist.

Not implemented:
- More metadata embedding for TIFF, WebP, and AVIF where feasible.
- More complete export preset management UI.
- Shared ZIP packaging for multi-file outputs.
- Better diagnostics for AVIF/WebP encoder support in the current browser.
- Better progress, cancellation, and error recovery for large export batches.

### Advanced raster format depth

Partially implemented:
- Browser-local import/export or preview paths exist for many advanced formats.

Not implemented:
- HEIF export through a browser-compatible encoder.
- JPEG 2000 export through a browser-compatible encoder.
- More complete TIFF metadata/directory authoring.
- More complete EXR support for channel/depth variants that JavaScript libraries can handle.
- Multi-page PDF import/export as flattened pages.
- A larger EPS vector subset, still without arbitrary PostScript execution.
- Better import reports for partially decoded advanced files.

### Timeline, frame animation, and audio

Implemented:
- Timeline panel, frame animation planning, transition metadata, poster/contact-sheet workflows, export presets, audio metadata, and mix planning exist.
- Frame-snapped visual trim handle models include in/out/playhead handles, ticks, thumbnail positions, split availability, and keyboard nudge metadata.
- Split-at-playhead UI is tied to timeline state.
- Thumbnail strip generation and frame extraction from browser-readable source videos are wired with timeout-safe metadata/seek helpers.
- PNG sequence ZIP packaging, animated GIF/APNG/WebP export, and OfflineAudioContext WAV rendering are available from the timeline panel.
- Browser-side final video export resolves MP4/H.264 or WebM MediaRecorder paths when exposed, and otherwise exports a deterministic frame/audio package.

### 3D browser-local workflows

Implemented:
- Primitive scenes, mesh metadata, OBJ/DAE import/export, binary 3DS mesh/material/UV subset, KMZ ZIP round-trip for COLLADA payloads, U3D browser-local multi-mesh/material/animation metadata, material workflows, sampled scene-light CPU raytrace preview with shadows/specular response, cross-section metadata, animation stack evaluation, print checks, slicer-style print plans, and downloadable G-code handoff metadata exist.

Still outside browser-local scope:
- Better mesh editing UI.
- More complete material painting.
- UV painting and texture baking workflows.
- Exact proprietary 3DS/KMZ/U3D vendor chunks and compressed binary package parity.
- GPU path tracing, WebGL renderer parity, native Photoshop 3D, and printer-driver integration.

### Local browser plugin system

Implemented:
- Stable browser plugin manifest schema and package format.
- Sandboxed iframe runtime with lifecycle management, per-load tokens, reloads, and postMessage validation.
- Explicit message API for document/layer reads, layer create/update, storage, host-rendered UI, commands, UXP modal scope, Action Manager batchPlay descriptors, CEP evalScript/event dispatch, and 8BF compatibility/run requests.
- Permission prompts, capability manifests, import review, and per-command permission checks.
- Plugin package/import/export UI, install/remove/enable/disable flows, and local registry entries.
- UXP manifest adaptation, CEP manifest adaptation, CSInterface shims, Action Manager descriptor normalization, and native `.8bf` metadata import with safe kernel execution where declared.

Not fully implemented:
- Native Adobe runtime processes are not embedded in the browser.
- Native 8BF binaries remain metadata-only unless a browser-safe kernel or future adapter is supplied.

### Lightweight collaboration and local library panels

Implemented:
- Notes, threaded comments, annotations, local asset/library records, Learn, and Discover panels exist as local browser features.
- Comment threads support replies plus open/resolved state, and those records round-trip through project files.
- Annotation records support pin, rectangle, ellipse, arrow, and freehand geometry metadata.
- Asset records support tags, tag filters, and search across names, groups, tags, descriptions, and payload text.
- Local library bundles import/export project-local asset records as `.pslibrary.json` files.
- Learn and Discover index commands, docs, filters, panels, and workflows through a shared searchable index.
- Comments and annotations can export a Markdown review report with summary counts, replies, tags, and geometry descriptions.

### Browser-safe PSD/PSB compatibility

Partially implemented:
- PSD/PSB import/export, compatibility reports, and marker/metadata preservation exist through browser-compatible code.
- High-bit and non-RGB PSD/PSB exports now use a browser-local native composite writer for true 16/32-bit and color-mode headers/planes instead of forcing all disk pixels through `ag-psd` RGB/8-bit output.
- Unsupported adjustment params are preserved through XMP app-preservation rather than visible marker-name fallbacks, with legacy marker imports still supported.
- Small imported PSD/PSB files can retain native source bytes for explicit unmodified native-source replay.

Not implemented:
- Fully layered native high-bit/non-RGB Photoshop semantics.
- Better UI showing exactly which PSD elements will be rasterized, approximated, or project-only before export.
- Safer recovery tools for PSD files that parse but exceed browser limits.
- More focused repair flows for unsupported PSD layer/resource structures that could still be represented locally.

### Browser-local typography depth

Implemented:
- Text layers, OpenType metadata, variable-font metadata, diagnostics, find/replace, vertical text, path/shape text, anti-alias metadata, and text warp exist.
- Embedded local font files are stored with project font assets, preserved in PSD app XMP, and included in raster XMP metadata when metadata export is enabled.
- Embedded OpenType font bytes now drive deterministic feature detection, variable-axis ranges, glyph advances, and exact glyf-outline text-to-path conversion where the font is available.
- Match Font now supports raster image-recognition metrics in addition to editable text geometry.

Implemented in this pass:
- Variable font axis discovery now exposes discovered/stored/default/custom axes, local-font inspection status, named instances, reset/default actions, and manual custom axis tags in the type panels.
- Fallback font comparison now shows side-by-side visual previews with browser-local width/x-height geometry deltas and selectable specimen previews.
- Match Font now ranks and exposes browser-local measured/stored geometry candidates instead of only applying the top result blindly.
- Find/replace previews now highlight all matches grouped by text layer across the document.
- Vertical type now has explicit column gap, glyph spacing, glyph scale, proportional metrics, writing mode, orientation, alignment, mojikumi, and Tate Chu Yoko controls.
- Text-on-path now has editable path point controls in the properties panel and direct-select canvas handles for text path anchors.

### Browser-local content-aware/photo workflows

Partially implemented:
- Local content-aware fill/scale, prompt-guided generative fill fallback plus model-endpoint contract, HDR merge with scene-linear high-bit output, Photomerge homography/projection/lens/blend controls, and Camera Raw-style rendered/high-bit recipe engines exist.

Not implemented:
- Hosted model quality for generative fill/remove still requires configuring a provider endpoint and credentials.
- Adobe-native Photomerge, HDR Pro, and Camera Raw proprietary profile parity remains outside the browser-local implementation.

## Not Implemented

### Multi-page contact sheets and package export

Implemented:
- Automatic pagination for contact sheets.
- Layout paginator.
- Multi-page preview.
- Export of multiple pages as page images inside a ZIP batch.
- Export of multiple pages as a flattened PDF using `pdf-lib`.
- Browser-side stored ZIP writer for page batches.

### General browser-side ZIP packaging

Not implemented:
- ZIP packaging for slices.
- ZIP packaging for PNG sequences.
- ZIP packaging for contact-sheet pages.
- ZIP packaging for asset/library bundles.
- ZIP packaging for project sidecars and reports.

What needs to be added:
- Typed-array ZIP writer module.
- Shared packaging API.
- Shared packaging UI.
- Progress, cancellation, and file-size safeguards for large packages.

### Dedicated browser diagnostics panel

Not implemented as a dedicated panel:
- Canvas max-size diagnostics.
- WebGL caps diagnostics.
- OffscreenCanvas support diagnostics.
- Worker transfer support diagnostics.
- Browser encoder support diagnostics.
- OPFS/quota diagnostics.
- Heap estimate display where available.
- Active fallback display.
- Copy/export diagnostics report.

What needs to be added:
- Diagnostics engine collecting browser capability probes.
- Panel registration.
- UI grouped by rendering, storage, encoders, workers, memory, and fallbacks.
- Exportable diagnostic JSON/text report.

### End-to-end timeline frame export workflow

Implemented as a user-facing workflow:
- Timeline-to-PNG-sequence export.
- Timeline-to-animated-GIF export.
- Timeline-to-APNG export.
- Timeline-to-animated-WebP export.
- Frame renderer that composites each timeline frame.
- Encoder integration from the timeline UI.
- PNG sequence generation and ZIP packaging.
- Export limitation report per animation format.

### Exportable local audio mix

Implemented:
- Rendering timeline audio tracks into a downloadable WAV file.
- OfflineAudioContext render pipeline wired to timeline audio tracks.
- WAV encoder and download flow.
- Mux-stream gain/fade/pan automation for final audiovisual export.
- Graceful fallback through the frame/audio package when browser muxing is unavailable.

### Complete browser-safe plugin API

Implemented:
- Versioned manifest schema.
- Sandboxed iframe execution.
- Permission model.
- Message bridge.
- Command registry integration.
- Plugin install/remove/enable/disable UI.
- Plugin import/export packaging.
- UXP/CEP compatibility shims and browser-safe Action Manager bridge.

Remaining boundary:
- Adobe-native runtime parity and native binary plugin execution still require Photoshop or another native host process.

### Real browser ICC transform pipeline

Not implemented:
- ICC-profile-based pixel conversion in the browser.

What needs to be added:
- JS/WASM ICC parser and transform implementation.
- Profile loading and validation.
- Assign Profile and Convert To Profile commands.
- Soft proof preview using real transforms.
- Export conversion pipeline.
- Regression tests against known color transforms.

### More complete on-canvas Bezier/path editor

Implemented:
- Direct Photoshop-like manipulation of anchors, handles, and subpaths on canvas for app paths and shape computed paths.

Remaining enhancements:
- Modifier-key parity for every native Photoshop path shortcut.
- Multi-anchor group movement and richer subpath selection affordances.

### Tile-only huge document inspection/editing

Not implemented:
- Full tile-only mode for documents larger than browser canvas limits.

What needs to be added:
- Import path that avoids creating a single full-size canvas.
- Tiled viewport renderer.
- Tile-level edit routing.
- Tile-level export/reassembly strategy.
- Clear limitations UI for operations that still require full-frame access.

### HEIF export

Not implemented:
- Writing HEIF/HEIC files from browser pixels.

What needs to be added:
- Browser-compatible HEIF encoder or WASM dependency.
- Export dialog integration.
- Metadata/quality controls where supported.
- Compatibility report and tests.

### JPEG 2000 export

Not implemented:
- Writing JP2/J2K/JPEG 2000 codestreams from browser pixels.

What needs to be added:
- Browser-compatible JPEG 2000 encoder or WASM dependency.
- Export dialog integration.
- Quality/compression controls.
- Compatibility report and tests.

### Multi-page PDF flattened workflows

Not implemented:
- Importing multiple PDF pages as multiple layers/documents/pages.
- Exporting multiple flattened pages from browser-managed layouts.

What needs to be added:
- Multi-page PDF import UI.
- Page selection and page-to-layer/document mapping.
- Flattened multi-page PDF export builder.
- Export report explaining rasterized output.

## Recommended Priority

1. Dedicated browser diagnostics panel.
2. Shared ZIP packaging infrastructure.
3. Expand multi-anchor and modifier-key path editing parity.
4. Large-document reduced-scale and tile-only workflows.
5. Expanded high-bit typed-array filter/adjustment paths.
6. Smart filter mask painting and stacked-filter preview improvements.
7. Multi-page contact sheets and package export.
8. Formal browser-safe plugin API.
9. Additional diagnostics for codec-specific video export decisions.
10. Optional dedicated encoder stack if browser-native MP4/WebM is insufficient.
