# Photoshop Web Feature Gap and Improvement Report

Generated: 2026-05-14

## Executive Summary

This project is already a broad Photoshop-inspired browser editor. It includes a full workspace shell, document tabs, menus, command palette, canvas editing, a sizeable tool palette, layer stack, panels, filters, adjustment-style operations, PSD/project import/export, autosave/recovery, local automation, scripting, metadata, and advanced subsystem dialogs.

The most important remaining work is not adding more menu labels. The largest gaps are depth, fidelity, and interoperability:

1. **Native-format parity is limited.** PSD is supported through `ag-psd`, but PSB, RAW/DNG, EXR, high-bit workflows, full metadata preservation, ICC conversion, and professional export formats remain partial or unsupported.
2. **Many advanced Photoshop features are represented as local approximations.** Examples include Camera Raw, Photomerge/HDR/focus-stack workflows, 3D/video, color management, neural/AI features, legacy filter gallery effects, and plugin workflows.
3. **Core browser constraints are openly documented in the app.** Export cannot embed metadata/ICC/progressive/interlaced encoder details; Camera Raw operates on rendered 8-bit pixels; advanced imports usually produce 8-bit previews.
4. **Several toolbar features from the reference list are missing or incomplete.** Quick Selection, Slice Select, Freeform Pen, anchor-point editing tools, Vertical Type, rounded rectangle, polygon/triangle as first-class tools, and some screen mode/document-bound snapping behavior are not visible as first-class toolbar tools.
5. **Testing covers reachability and selected behavior, but not Photoshop-grade algorithm correctness.** The suite is strong for smoke, panels, dialogs, and some pixel logic; it does not yet establish parity for filters, blend modes, PSD round trips, large documents, pressure input, typography, or performance.

## Evidence Reviewed

- `context.txt`: architecture summary and known limitations.
- `Every_photoshop_feature.txt`: benchmark feature list.
- `components/photoshop/types.ts`: typed document, layer, tool, adjustment, 3D, video, plugin, metadata, color, print, and brush models.
- `components/photoshop/tool-palette.tsx`: exposed toolbar groups.
- `components/photoshop/menu-bar.tsx`: file/edit/image/filter/view/window/advanced menu surface.
- `components/photoshop/panel-dock.tsx`: panel coverage.
- `components/photoshop/filters.ts` and `filter-worker.ts`: filter implementation and worker coverage.
- `components/photoshop/advanced-subsystems.ts[x]`: RAW/DNG/DICOM/EXR/HDR/PSB, plugins, libraries, color, credentials, video, 3D.
- `components/photoshop/document-io.ts`: project and PSD import/export preservation reports.
- `tests/*.spec.ts`: Playwright and algorithm regression coverage.

## Current Feature Coverage

### Strongly Represented Areas

- **Workspace shell:** menu bar, options bar, tool palette, canvas view, document tabs, right panel dock, status bar.
- **Document lifecycle:** new document, duplicate, close/reopen, autosave recovery, recent documents, dirty document warning.
- **Layers:** raster, text, shape, group, smart object, adjustment, frame, artboard, 3D, video layer types; opacity, fill opacity, blending, masks, vector masks, clipping, locks, color labels, smart filters.
- **Panels:** Layers, Channels, Paths, History, Actions, Layer Comps, Clone Source, Timeline, Animation, Comments, Annotations, Notes, Measurement Log, Slices, Scripting, Color, Swatches, Gradients, Patterns, Brush, Glyphs, Styles, Shapes, Tool Presets, Character, Paragraph, Navigator, Histogram, Info, Properties, Selection, Guides, Adjustments, Assets, Libraries, Learn, Discover.
- **Tools:** many Photoshop toolbar categories are present: Move, Artboard, marquee, lasso, object/magic selection, crop, perspective crop, slice, frame, eyedropper/sampler/ruler/note/count, healing/retouching, brush/pencil/mixer/color replacement, clone/pattern stamp, history brushes, erasers, gradient/paint bucket, blur/sharpen/smudge, dodge/burn/sponge, pen/curvature pen, type mask, path/direct select, shape/custom shape, hand, rotate, zoom, transform.
- **Filters and adjustments:** broad coverage across blur, sharpen, stylize, noise, adjustments, color, render, distort, legacy gallery approximations, and Camera Raw-style UI.
- **Workflow dialogs:** Export As, Batch Export, Image Processor, Contact Sheet, gap workflows, preflight, document reports, color labels, layer comps, shortcuts, preferences, image/canvas size, liquify, puppet warp, select and mask, refine edge, gradient editor, layer styles.
- **Automation and scripting:** Actions panel, local automation descriptors, droplets/script-event-style records, command-limited scripting console, batch processing workflows.
- **Advanced local subsystems:** local content credential manifests, project-local libraries/stock/font records, sandboxed plugin descriptors, limited 3D/video workflows, advanced import matrix.

## Missing or Incomplete Features

### 1. File Format and Interoperability Gaps

These are the highest-value gaps because they define whether the editor can exchange real production assets.

- **PSB full decode/export:** currently marked unsupported for full decode; large canvas/layer/resource support needs a PSB parser and memory strategy.
- **RAW/DNG full processing:** current support searches for embedded previews only. Missing demosaic, camera profiles, lens corrections, high-bit data, sidecar/non-destructive raw settings, and RAW masking.
- **OpenEXR pixel decode:** currently metadata-only. Missing half-float channels, multipart data, compression support, scene-linear color management, and HDR display/export path.
- **Radiance HDR depth:** tone-mapped preview exists, but scene-linear editing and true HDR output are missing.
- **DICOM production workflows:** limited uncompressed preview only. Missing compressed transfer syntaxes, modality LUT/windowing, overlays, color modalities, and patient metadata workflow.
- **Photoshop PDF/EPS/TIFF/HEIF/TGA/JPEG 2000/PBM/PCX/Pixar/IFF/DCS/Cineon/Scitex CT:** listed in the benchmark, but not clearly implemented as full import/export pipelines.
- **Export metadata and profiles:** browser raster encoders cannot embed metadata, ICC profiles, progressive JPEG scan settings, or interlaced PNG chunks.
- **PSD round-trip fidelity:** app-only metadata such as smart filters, 3D/video/plugin/library/variable data, guides, slices, comps, and some layer styles are preserved in project format but unsupported, approximated, or rasterized through PSD workflows.

### 2. Color Management and High-Bit Pipeline

- **ICC-accurate conversion:** current proofing is simulated RGB canvas transforms, not real ICC conversion.
- **16-bit and 32-bit editing:** document metadata has bit depth, but the browser canvas editing path is effectively 8-bit RGBA.
- **CMYK/Lab/spot/multichannel fidelity:** modes exist in state, but channel math and display/export behavior are not equivalent to Photoshop production modes.
- **Soft proofing depth:** missing complete proof setup profiles, color-blindness proofs, preserve numbers, production gamut warnings, and print-provider handoff accuracy.
- **Color management policies:** preserve/convert embedded profiles and missing-profile prompts are not fully represented.

### 3. AI and Neural Features

The benchmark includes many Adobe Sensei/AI features that are absent or approximated locally:

- Generative Fill.
- Generative Expand.
- Neural Filters such as Skin Smoothing, Smart Portrait, Makeup Transfer, Depth Blur, Colorize, Harmonization, Landscape Mixer, Scene Mixer, Super Zoom, Photo Restoration.
- Match Font.
- Face-Aware Liquify.
- Enhance Details/Super Resolution.
- Production-grade Select Subject, Select Sky, Select Background, Object Selection, and Remove Tool.

The app can expose local heuristics and UI affordances, but true parity would require model-backed segmentation, inpainting, depth estimation, face landmarking, and font recognition.

### 4. Toolbar and Selection Gaps

Visible toolbar coverage is broad but not complete against `Every_photoshop_feature.txt`.

Missing or not first-class in the toolbar:

- Quick Selection Tool.
- Slice Select Tool.
- Freeform Pen Tool and Magnetic Freeform Pen.
- Add Anchor Point, Delete Anchor Point, Convert Point tools.
- Vertical Type Tool as a normal text creation tool.
- Rounded Rectangle Tool as a first-class tool.
- Polygon Tool and Triangle Tool as first-class selectable shape tools.
- Default Colors, Switch Colors, and Screen Mode toggle need clearer toolbar parity if not already reachable elsewhere.

Selection features needing improvement:

- Focus Area selection should become a real edge/depth/contrast workflow, not just a heuristic.
- Select and Mask needs stronger local refinement parity: view modes, smart radius, decontaminate colors, output targets, and brush-specific interactions.
- Transform Selection, Save/Load Selection, Grow/Similar, and channel selection workflows need broader behavioral tests.

### 5. Vector, Path, and Shape Depth

The state model supports paths and shape boolean metadata, but Photoshop parity needs deeper vector editing:

- Anchor add/delete/convert workflows with direct manipulation.
- Freeform and magnetic path drawing.
- Work Path lifecycle, clipping paths, saved paths, path export to Illustrator.
- Fill Path and Stroke Path with tool-specific options.
- Shape stroke alignment, dashed lines, caps, joins, path component alignment/distribution.
- Convert text to shape/path and define custom shape from path.
- Robust boolean path editing with editable components, not only raster/mask operations.

### 6. Smart Object Depth

Smart-object metadata exists, but the following are still important gaps:

- Linked Smart Objects with file relink/update/missing-file states.
- Edit Contents as separate document lifecycle with save-back behavior.
- Replace Contents with scaling preservation.
- Export Contents.
- Convert to Layers.
- Stack modes for smart object image stacks.
- Non-destructive transforms that remain editable across save/load and PSD round trips.
- Full Smart Filter masks and reorder/edit semantics across sessions.

### 7. Filter Fidelity and Performance

The filter catalog is broad, but several filters are explicitly approximate or local-only.

Needs improvement:

- Replace legacy gallery approximation wrappers with feature-specific algorithms for Artistic, Brush Strokes, Sketch, and Texture filters.
- Implement missing Blur Gallery filters: Field Blur, Iris Blur, Tilt-Shift, Path Blur, Spin Blur.
- Add Lens Correction and Lighting Effects depth.
- Expand worker/off-main-thread coverage beyond lightweight per-pixel filters. Current worker-supported set is limited to simple filters such as invert, grayscale, desaturate, sepia, threshold, posterize, exposure, and brightness/contrast.
- Add tiling/streaming for large images to avoid main-thread stalls and memory spikes.
- Add pixel-correct regression fixtures for core filters instead of only dialog reachability and selected algorithm tests.

### 8. Camera Raw and Photo Workflows

Camera Raw currently acts on rendered 8-bit RGB layer pixels.

Missing:

- RAW demosaic.
- Camera profiles.
- Lens profiles and automatic correction.
- High-bit non-destructive settings.
- HSL/Grayscale, optics, geometry, masking, snapshots, presets, calibration with RAW-backed data.
- Super Resolution/Enhance Details.
- Batch Camera Raw behavior.

### 9. Compositing and Content-Aware Workflows

The project includes content-aware scale analysis, patch/extend-style operations, and local alignment/merge workflows, but gaps remain:

- Content-Aware Fill should support patch search, sampling area controls, output settings, rotation/scale adaptation, and preview.
- Content-Aware Scale currently falls back for large reductions; improve seam-carving quality and protected areas.
- Auto-Align Layers needs feature matching and lens-aware transforms.
- Auto-Blend Layers needs robust panorama/focus-stack blending.
- Photomerge, HDR Merge, and Focus Stack are local approximations, not Photoshop-grade engines.
- Content-Aware Crop/Extend should be made explicit and tested.

### 10. Typography Gaps

Text support is substantial in state and panels, but production typography still needs work:

- Variable font axes.
- Font preview and font fallback diagnostics.
- Match Font.
- Find/replace text across layers with UI parity.
- Spell check/language dictionaries beyond simple local reports.
- Vertical type creation and editing.
- Text inside shape.
- Convert text to shape/path.
- Full OpenType features such as swash, ordinals, alternate glyph sets.
- Anti-aliasing modes equivalent to Photoshop's None/Sharp/Crisp/Strong/Smooth.
- 3D text extrusion.

### 11. 3D and Video Gaps

The app has browser-native 3D/video metadata and previews, but it is not Photoshop Extended parity.

3D missing/improvable:

- Import/export real 3D formats such as OBJ/DAE/3DS/KMZ/U3D.
- Mesh editing, UV/material texture editing, image-based lighting, ray-traced rendering, ground plane, shadow catcher, cross sections, 3D print checks.
- Paint directly on 3D surfaces.

Video missing/improvable:

- Native clip trimming and split clips.
- Transitions and video groups.
- Real audio mixing/playback behavior.
- Frame rate settings and loop options.
- Export presets for H.264/QuickTime/DPX/GIF/image sequence with reliable browser support.
- Convert frame animation to timeline and reverse.

### 12. Plugins, Libraries, and Ecosystem

Current implementation correctly labels plugins and libraries as local/project-only.

Missing:

- Native 8BF filter execution.
- UXP and CEP API runtimes.
- Creative Cloud Libraries sync.
- Adobe Stock licensing/search/download workflow.
- Adobe Fonts account sync.
- Bridge integration.
- External script file browsing and ExtendScript compatibility.
- Platform automation: AppleScript, VBScript, ExtendScript Toolkit equivalents.

### 13. Printing and Prepress

The app includes print settings and preflight, but production print workflows remain limited.

Missing or incomplete:

- Certified prepress checks.
- Real printer profile handling.
- Print selected area.
- Full marks: registration, corner crop, center crop, labels, descriptions.
- Border/background controls.
- True proof print pipeline.
- Trap behavior beyond metadata/settings.
- Separations/spot colors/overprint preview.

### 14. Preferences and Performance Settings

Current preferences cover practical UI/editor settings, but Photoshop's system-level preferences are much deeper.

Missing:

- RAM usage and cache level controls.
- Scratch disk configuration.
- GPU acceleration settings.
- File handling policies.
- History log.
- Cursor/tool behavior preferences.
- Transparency/grid preferences beyond existing basics.
- Units/rulers deeper parity.
- Reset/export/import full preference sets.

## Improvement Opportunities by Priority

### P0: Make Claims and Limits Machine-Checkable

Add a capability registry that marks each menu command, tool, filter, panel, file format, and export format as:

- `complete`
- `usable`
- `approximation`
- `stub`
- `unsupported`

Then drive UI labels, preflight, command palette, tests, and this report from that registry. This prevents accidental over-claiming as the surface area grows.

### P0: Strengthen File I/O and Round-Trip Reporting

- Add fixture-based PSD import/export tests with text, groups, masks, adjustment layers, smart filters, layer styles, guides, slices, and comps.
- Expand document reports to show exactly what is preserved, flattened, rasterized, approximated, or lost.
- Add project-format migration/version tests.
- Add export tests for PNG/JPEG/WebP/SVG behavior and metadata-loss warnings.

### P0: Improve Performance Architecture

- Move heavy filters and image operations into workers or WASM-backed tiled processing.
- Add large-document benchmarks for pan/zoom, brush strokes, layer blending, filter preview, and history snapshots.
- Make memory budgets explicit for canvas pools, history patches, autosave, and PSD import.

### P1: Complete Core Toolbar Parity

Add first-class tools for Quick Selection, Slice Select, Freeform Pen, Add/Delete/Convert Anchor Point, Vertical Type, Rounded Rectangle, Polygon, and Triangle. Even if some route to existing internals, they should have their own tool IDs, toolbar affordances, options bar controls, shortcuts, and tests.

### P1: Upgrade Selection and Masking

- Improve Quick Selection and Object Selection algorithms with edge-aware region growing and configurable sampling.
- Expand Select and Mask view modes and output targets.
- Implement Decontaminate Colors more realistically.
- Add selection transform tests and mask compositing tests.

### P1: Expand Worker Filter Coverage

- Port Gaussian/box/motion blur, sharpen/unsharp, noise, median, distort, and render filters to workers.
- Use tile-based processing for large canvases.
- Add golden pixel fixtures for deterministic filters.

### P1: Raise Color/Bit-Depth Honesty

- Separate document metadata mode from actual pixel processing mode in the UI.
- Show warnings when 16/32-bit, CMYK, Lab, Multichannel, or spot-channel workflows are display-only or destructive.
- Consider a float/half-float internal image pipeline for HDR/EXR/RAW work if production fidelity is a goal.

### P2: Deepen Smart Objects

- Implement edit contents, replace contents, export contents, linked-file status, and relink.
- Persist smart-object source documents.
- Add non-destructive transform re-editing.

### P2: Deepen Typography

- Add vertical text, text-in-shape, variable fonts, font preview, missing font resolution, text-to-shape/path, and OpenType feature controls.
- Add typography rendering regression screenshots.

### P2: Improve Workflow Engines

- Upgrade Photomerge, HDR Merge, Focus Stack, Content-Aware Fill, and Auto-Blend from local approximations to dedicated algorithms.
- Add measurable output-quality tests and fixture sets.

### P3: Ecosystem Integrations

Only pursue these if the product goal is closer to Photoshop compatibility than standalone browser editor:

- Native plugin execution or a plugin API.
- Cloud library/stock/font sync.
- Bridge-like file browsing.
- Platform scripting compatibility.

## Suggested Roadmap

### Phase 1: Accuracy and Transparency

- Add capability registry and visible completeness states.
- Expand round-trip reports.
- Add PSD fixture tests.
- Add file/export limitation tests.
- Add performance baseline tests.

### Phase 2: Core Editing Depth

- Complete missing toolbar tools.
- Upgrade selection/masking.
- Improve path/vector editing.
- Expand smart object workflows.
- Move heavy filters into workers.

### Phase 3: Professional Production Workflows

- Improve color management and bit-depth architecture.
- Add stronger RAW/HDR/EXR strategy.
- Upgrade print/prepress.
- Add robust content-aware and merge workflows.

### Phase 4: Advanced and Ecosystem Features

- Add AI-backed features if model infrastructure is available.
- Add plugin/runtime integrations if needed.
- Add cloud/library/stock/font workflows.
- Deepen 3D/video only if those remain product priorities.

## Testing Gaps

Recommended additions:

- PSD round-trip fixture suite.
- Project format compatibility suite.
- Filter golden-image suite.
- Blend mode golden pixel matrix.
- Brush engine pressure/tilt/spacing/dynamics tests.
- Selection/mask raster fixture tests.
- Text rendering and font fallback screenshot tests.
- Large-document performance and memory tests.
- Worker fallback/worker failure tests.
- Export compatibility tests per format and browser capability.
- Accessibility tests for all menus, dialogs, panels, and toolbar flyouts.

## Top 20 Actionable Backlog Items

1. Create a centralized capability registry.
2. Add PSD import/export fixture tests.
3. Add round-trip reports for every app-only feature.
4. Add first-class Quick Selection Tool.
5. Add first-class Slice Select Tool.
6. Add Freeform Pen and anchor-point editing tools.
7. Add Vertical Type Tool and vertical text editing workflow.
8. Add Rounded Rectangle, Polygon, and Triangle tools.
9. Expand worker coverage for Gaussian blur, sharpen, noise, and distort filters.
10. Add golden-image tests for deterministic filters.
11. Add large-canvas performance benchmarks.
12. Implement linked smart object lifecycle.
13. Implement Edit Contents / Replace Contents for smart objects.
14. Improve Select and Mask view modes and output targets.
15. Add Content-Aware Fill preview and sampling controls.
16. Make color/bit-depth limitations explicit in document status and export dialogs.
17. Add RAW/HDR/EXR strategy decision: preview-only, WASM decoder, or server-assisted processing.
18. Expand typography: variable fonts, font preview, text-to-shape/path.
19. Strengthen preflight for print/export risk with severity levels and fix actions.
20. Add accessibility and keyboard navigation coverage for all major dialogs and panels.

## Conclusion

The project is feature-rich as a browser Photoshop-style editor, but its remaining gaps cluster around production fidelity rather than UI breadth. The fastest path to a stronger product is to make capability status explicit, harden file round-tripping, move expensive pixel work off the main thread, complete a handful of missing first-class tools, and add fixture-based regression tests for the algorithms that matter most.
