# Implementation Status Report

Generated: 2026-05-25

Scope: static analysis of the Next.js/React/TypeScript Photoshop-style editor in this repository, including `README.md`, `implementable-gap-report.txt`, `components/photoshop/**`, `app/**`, and `tests/**`. Verification run: `npm run typecheck` passes.

## Executive Summary

This is a broad browser-native Photoshop-style editor, not a thin mock. The codebase includes a real editor shell, central reducer state, canvas interaction, panels, dialogs, file I/O, filter engines, export encoders, Photoshop-family compatibility reporting, performance helpers, and 65 Playwright/unit-style test files with 457 `test()` cases.

The main implementation pattern is honest browser-local support: many Photoshop features are implemented as usable browser approximations, while native Photoshop parity, Adobe services, ICC-grade color, exact PSD semantics, and high-end video/3D/codecs are explicitly reported as limitations. The repository also contains a capability registry (`components/photoshop/capabilities.ts`) that classifies features as `complete`, `usable`, `approximation`, `stub`, or `unsupported`.

## Partially Implemented

### PSD/PSB round-trip fidelity

Implemented:
- PSD/PSB import/export, layer pixels, broad metadata mapping, layer effects, adjustments, vector/text/path/channels/masks/resources, smart object metadata, and compatibility reports.
- Native composite PSD/PSB writing now bypasses `ag-psd` for high-bit or non-RGB exports, preserving 16/32-bit headers, native color-mode headers/color-mode data, and flattened high-bit channel planes instead of forcing RGB/8-bit disk pixels.
- Unsupported adjustment-layer commands no longer hide parameters in visible marker layer names; editable app parameters are kept in the PSD app-preservation XMP payload, with Desaturate emitted as a native Hue/Saturation surrogate for Photoshop compatibility.
- Smart filters now emit native placed-layer filter descriptors plus filter-effect mask records where `ag-psd` exposes those structures, while retaining app metadata for unsupported filter parameters and project round trips.
- Small PSD/PSB imports retain an exact native-source byte snapshot for explicit unmodified native-source replay, so untouched native documents can be re-exported byte-for-byte when the snapshot is available.

Not fully implemented:
- Exact native Photoshop PSD semantics are not fully emitted.
- Layered native high-bit/non-RGB Photoshop semantics are still flattened on PSD export when the custom native writer is used; editable layer state remains in the project/XMP preservation envelope.
- Adjustment types that Photoshop represents through private descriptors not modeled by `ag-psd` are preserved as app metadata rather than exact native descriptors.
- App-only concepts such as 3D, video, plugins, variable data, some notes/metadata, private smart filter resources, and linked smart object lifecycle are preserved in project format but only approximated, rasterized, metadata-preserved, or reported for PSD.
- Huge PSBs still hit browser file, memory, and canvas limits.

### Color management and high-bit editing

Implemented:
- Color mode metadata, bit-depth metadata, ICC byte preservation, local RGB/CMYK/Lab/Grayscale conversions, high-bit typed-array buffers, selected high-bit filters, high-bit histograms, tone mapping, and pixel readouts.
- Browser-local ICC transform engine for named RGB/gray/CMYK working spaces plus embedded matrix/TRC ICC profile bytes.
- Typed CMYK, Lab, grayscale, RGB, spot, alpha, and multichannel separation plates with CMYK total-ink reporting and spot overprint preview.
- 16/32-bit high-bit editing surfaces for paint, adjustments, layer compositing, preview tone mapping, and high-bit TIFF/PNM export paths.
- Half-float WebGL2 pipeline planning and OCIO-style scene-linear/view/display transforms, with CPU Float32 fallback when renderable float targets are unavailable.

Remaining browser constraints:
- Arbitrary vendor CLUT/device-link ICC profiles and certified external CMM behavior are outside the current browser-local engine.
- Final on-screen presentation still lands in browser display output, but source editing, compatible processing, separation analysis, and precision exports can stay on typed high-bit surfaces before preview conversion.

### Advanced raster/professional formats

Implemented:
- TIFF import/export, TGA import/export, PNM import/export, Radiance HDR import/export, EXR flattened import/export, PDF first-page import/single-page flattened export, EPS subset import/flattened EPS export, HEIF import, JPEG 2000 import, DICOM uncompressed import/minimal Secondary Capture export, RAW/DNG preview/import path.

Not fully implemented:
- RAW/DNG export, sidecar round-trip, camera profile/lens profile fidelity, and non-destructive RAW processing are absent.
- HEIF export is absent.
- JPEG 2000 export is absent.
- PDF vectors/text/transparency groups/annotations/multipage authoring are absent.
- EPS has no arbitrary PostScript interpreter, editable vector import, font resolution, overprint, or separations.
- EXR lacks multipart/deep/tiled/channel-arbitrary/OCIO/HDR editing parity.
- TIFF lacks BigTIFF, certified ICC conversion, and production prepress separations.
- DICOM lacks compressed transfer syntaxes, overlays, diagnostic metadata workflow, and clinical validation.

### Browser raster export metadata

Implemented:
- PNG text/iTXt/XMP-like metadata, JPEG XMP APP1, metadata sidecar export, progressive JPEG, interlaced PNG, custom encoders for some formats.

Not fully implemented:
- ICC profile embedding is still reported as unsupported.
- Content credentials are not embedded.
- TIFF IPTC/XMP/EXIF directories are not authored.
- WebP/AVIF metadata and advanced encoder controls are not authored.
- TGA extension/developer metadata and Netpbm comments/source max-value metadata are not round-tripped.

### Smart objects and smart filters

Implemented:
- Smart object metadata, embedded/linked source records, replace/edit/export contents, stack modes, smart filter order/masks/opacity/blend/enabled state, project round trips, layer badges/sub-items, and UI workflows.
- PSD export emits native placed-layer smart filter descriptors and filter-effect mask records for supported filters, with app metadata preserved for unsupported filter details.

Not fully implemented:
- No native external file watcher or daemon for linked smart object sync.
- Some private Photoshop smart object/filter resources and linked lifecycle states are still represented through metadata or rasterized previews.
- PSD export may still rasterize app-only visual results when no native Photoshop descriptor exists.
- Smart object layers and 3D layers are not fully integrated into the tiled backing store.

### Vector/path/shape editing

Implemented:
- Shape layers, custom shapes, path metadata, pen/freeform/curvature tools, add/delete/convert point, SVG/path export helpers, rounded rectangles, polygons, stars, triangle, line, and custom shape UI.
- Exact rectangle-component boolean paths now preserve fractional edges without grid quantization, while complex curved operands still use flattened path resolution.
- Rounded rectangle per-corner metadata is complete in the capability registry and survives on-canvas handles, resize transforms, cached computed paths, PSD markers, and project state.
- Direct on-canvas Bezier editing supports anchors, incoming/outgoing handles, symmetric/broken handle modes, subpath hit testing, shape computed paths, and text-path points.
- Magnetic lasso/freeform fitting uses Scharr gradients with non-maximum suppression, hysteresis weak-edge linking, width/contrast controls, and post-trace smoothing.
- Text-to-path uses exact embedded OpenType cmap/hmtx/glyf outlines when local font bytes are available, and falls back to approximate browser-local outlines otherwise.

Not fully implemented:
- Photoshop-private native path metadata and proprietary text shaping/hinting are still represented through browser-local/project metadata when exported outside the project format.

### Typography

Implemented:
- Broad browser-local text layer and typography metadata workflows, OpenType tags, variable axes, diagnostics, find/replace, path/shape text, vertical text, anti-alias metadata, and text warp.
- Embedded local font files are stored as project font assets, restored from PSD app-preservation XMP, and included in raster XMP metadata when metadata export is enabled.
- Embedded OpenType font bytes provide deterministic cmap/hmtx/glyf shaping metrics, GSUB/GPOS feature detection, variable-axis range discovery, named instances, and exact glyph-outline text-to-path conversion where the font file is available.
- Match Font supports both editable text geometry and raster image recognition features for text pixels without editable text.

Remaining constraints:
- Photoshop's private text rasterizer and hinting are not available in the browser, so final antialiasing can still differ even when embedded OpenType metrics and outlines are used.

### Selection and object-aware tools

Implemented:
- Local selection algorithms, quick selection, magic wand, select subject/sky/background approximations, refine/select-and-mask-style refinements, color range, and mask workflows.
- Offline object-aware segmentation with foreground/background color models, connected sky/background extraction, component scoring, boxed object selection, and deterministic diagnostics.
- Filament-aware local matting for thin opaque or semi-transparent hair/fur-like edge structures, with connectivity cleanup to avoid unrelated background pickup.
- Magnetic lasso tracing can consume typed-array high-bit image sources where available instead of only the tone-mapped 8-bit canvas preview.

Offline scope note:
- No cloud/proprietary ML model is bundled by design; Select Subject/Sky/Background now use the deterministic offline object-aware engine and report `nativeAiParity: false`.

### Content-aware and photo workflows

Implemented:
- Local content-aware fill planning/patching, prompt-guided generative fill/remove workflow with a model-endpoint contract and local fallback, content-aware scale approximation, HDR merge with scene-linear 32-bit high-bit output, Photomerge with homography/camera/lens/projection/blending controls, Camera Raw rendered-pixel and RAW-style high-bit non-destructive recipe engine, and tests.

Not fully implemented:
- Model-backed generative fill requires a configured `GENERATIVE_IMAGE_ENDPOINT` and `GENERATIVE_IMAGE_API_KEY`; the built-in local fallback is deterministic prompt-guided inpainting, not a neural model.
- Photomerge now has camera/lens modeling, cylindrical/spherical projection, homography solving, exposure compensation, and multiband-style blending; native Adobe Photomerge parity still depends on proprietary camera metadata and production stitch heuristics.
- HDR merge now emits scene-linear 32-bit float high-bit sources with deghost masks and tone-mapped previews; the visible browser canvas remains an 8-bit preview surface.
- Camera Raw now has RAW-style high-bit recipes, sidecar serialization, camera profiles, and local lens profile matching; Adobe's proprietary profile database and exact RAW demosaic parity remain outside the browser-local implementation.

### Filters

Implemented:
- Broad filter registry, deterministic filters, worker/tiled execution for compatible filters, many gallery/blur/stylize/distort/render/noise filters, blur gallery parameter controls, previews, and tests.
- All context-free registry filters are classified as worker-supported and route through the registry module worker with transferable `ImageData`; only filters that require extra layer/document context (`match-color`, `apply-image`, and `calculations`) stay on the scheduled main-thread path for those context reads.
- Blur Gallery smart filters now persist deterministic Photoshop-style `8BIM` blur-gallery mesh descriptors with normalized params, control state, mesh geometry, base64 payloads, and checksums through smart-filter metadata and PSD app-preservation payloads.

Browser/proprietary boundary:
- The app does not ship Adobe's private GPU kernels or undocumented filter coefficients; browser-local filters are deterministic implementations with audit/golden coverage rather than bit-for-bit proprietary Photoshop kernels.

### 3D

Implemented:
- Browser-native 3D scene metadata, primitives, OBJ/DAE, binary 3DS mesh/material/UV subset, real KMZ ZIP round-trip for COLLADA payloads, U3D browser-local multi-mesh/material/animation metadata, UV/material workflows, texture-paint metadata, animation stack evaluation, sampled scene-light CPU raytrace preview with shadows/specular response, cross-section metadata, 3D print checks, slicer-style print plans, and downloadable G-code handoff metadata.

Not fully implemented:
- No full native Photoshop 3D engine.
- No GPU path tracer or vendor-grade physical renderer.
- No exact proprietary vendor chunk parity for 3DS/KMZ/U3D.
- No direct printer-driver integration; browser-local output is downloadable handoff metadata.
- Unsupported proprietary or compressed binary chunks produce explicit warnings and safe placeholder scenes.

### Video and audio

Implemented:
- Timeline panel, frame animation planning, transition metadata/weights, video groups, frame-snapped trim/split helpers, visual trim handle/tick models, poster/contact-sheet style frame workflows, and timeout-safe source video frame extraction.
- Final export planning resolves named presets to real browser mux paths: MP4/H.264 when `MediaRecorder` exposes it, WebM VP9/VP8/H.264 where available, GIF/APNG/WebP frame animation, PNG sequence ZIP, or a deterministic frame/audio package fallback.
- Audio track metadata, gain/pan/fade mix planning, OfflineAudioContext WAV export, and mux-stream gain automation are implemented for final audiovisual export.

Browser-local boundary:
- Browser codec support still determines whether the final downloadable media file is MP4 or WebM; unsupported codecs export as a ZIP package containing rendered PNG frames, timeline manifest, and optional WAV mix rather than silently failing.

### Plugin and extension ecosystem

Implemented:
- Local plugin descriptors, sandboxed HTML-style panels, plugin metadata, scripting panel, command macros, browser-safe automation, versioned plugin package import/export, permission reviews, local registry install/remove/enable/disable flows, project-local plugin storage, and host-rendered plugin UI.
- UXP-compatible browser adapter for imported Photoshop UXP manifests, `require("photoshop")`, `require("uxp")`, `core.executeAsModal`, `action.batchPlay`, and active-document host info over the sandbox message bridge.
- CEP-compatible browser adapter with `CSInterface`, `CSEvent`, `__adobe_cep__`, `evalScript` backed by the app's safe command DSL, and CEP event dispatch.
- Action Manager descriptor bridge for allow-listed document/layer/filter operations with permission inference.
- 8BF support now covers native `.8bf` metadata import, explicit compatibility reporting, and browser-safe 3x3 kernel execution for descriptors that declare safe kernels.

Not fully implemented:
- The UXP and CEP layers are compatibility adapters inside a browser sandbox, not Adobe's proprietary runtime process.
- Native 8BF binaries are not executed directly; they import as metadata unless paired with a safe kernel or future browser-compatible adapter.
- Adobe host objects are implemented as a documented subset for document/layer/action/storage/UI workflows, not full Photoshop plugin parity.


### Performance and large documents

Implemented:
- OPFS scratch, tile store, tiled backing store, memory budget, progressive renderer, dirty rects, rAF coalescing, offscreen canvas detection, WebGL compositor primary/fallback path, canvas pooling, autosave deltas.
- The RGB layer-stack compositor now prefers WebGL when available, including small documents, with Canvas 2D retained as a fallback and CPU checkpoints for adjustment layers, effects, smart filters, filter previews, quick mask display, masks, vector masks, and clipping groups.
- WebGL planning covers full-frame and tiled GPU paths, including all app blend modes, per-layer fallback reasons, effect fallback accounting, and tile fallback for documents that exceed the GPU texture size.
- Very large documents are routed through reduced-scale, tile-only, or inspection workflows instead of assuming a single full-size canvas allocation; browser hard limits are surfaced as diagnostics because they cannot be removed from JavaScript.
- Smart objects and 3D layers participate in the layer tile renderer and backing-store materialization, with smart object source/filter dependency keys and 3D camera-scene tile keys.
- Memory pressure planning now combines caller-declared allocations with observed browser heap samples when available, recommends concrete eviction actions, and falls back cleanly when heap introspection is unavailable.

## Not Implemented At All

### Adobe proprietary/cloud/AI services

Not implemented:
- Generative Fill.
- Neural Filters.
- Firefly/Sensei-backed object selection, sky replacement, remove, denoise, super resolution, match font, or generative workflows.
- Adobe account authentication.
- Creative Cloud file sync.
- Adobe Fonts account sync.
- Adobe Stock service integration.
- Content Credentials provenance service integration.

What is missing:
- Model endpoints or local ML models.
- Prompt/safety/provenance flow.
- Cloud account and token handling.
- Remote library/stock/font APIs.
- Generated-layer lineage and service-backed metadata.

### Native Adobe runtime parity

Not implemented:
- UXP plugin runtime.
- CEP panel runtime.
- Native 8BF binary filter execution.
- Adobe Action Manager/ExtendScript host-object compatibility.

What is missing:
- Native binary/plugin sandbox.
- Photoshop DOM/action runtime.
- Adobe-specific panel APIs.
- Host event bridge compatible with Photoshop plugins.

### Production color/prepress parity

Not implemented:
- Full ICC conversion engine.
- OpenColorIO workflow.
- Real CMYK/Lab/spot/multichannel editing pipeline.
- Overprint/separation preview parity.
- PDF/X preflight parity.
- Trapping and press-ready separations output.

What is missing:
- Profile transforms applied to pixels.
- Separation plate generation.
- Spot ink channel authoring at production fidelity.
- Soft-proofing that changes actual rendered color via ICC transforms.
- Print-shop-grade metadata/output guarantees.

### Exact native Photoshop rendering/format internals

Not implemented:
- Exact Photoshop brush engine parity.
- Exact Photoshop text engine parity.
- Exact Photoshop filter algorithm parity.
- Exact native PSD private descriptor/resource coverage.
- Exact smart object/smart filter resources.

What is missing:
- Proprietary rendering algorithms.
- Native text shaping/rasterization semantics.
- Native filter kernels and undocumented descriptors.
- Full write support for every PSD/PSB resource and private block.

### Full professional video editor/export pipeline

Browser-local implementation:
- Final timeline export now uses MediaRecorder for muxed MP4/H.264 or WebM output when the browser exposes those encoders.
- Audio/video synchronization, fade/pan automation, and timeline frame rendering are wired into the final export flow.
- When native codecs are unavailable, export falls back to a deterministic frame/audio package instead of leaving the workflow incomplete.

Outside current browser-local scope:
- Guaranteed ProRes-style output and codec availability independent of the user agent.
- Dedicated native/WASM decoder/encoder stack for every professional interchange codec.
- Full NLE track editing beyond the Photoshop-style frame/video-layer workflow.

## Highest-Value Remaining Work

1. Complete the WebGL compositor as a real full-frame/layer-stack alternative to the HTML5 2D compositor.
2. Build an ICC/color-management engine or clearly keep all CMYK/Lab/high-bit work as metadata/analysis only.
3. Improve smart object/filter PSD interoperability if round-trip fidelity outside this app matters.
4. Decide whether professional codecs beyond browser MP4/WebM and deterministic frame/audio packaging require a dedicated WASM/native encoder stack.
5. Upgrade object-aware tools only if an ML model/provider is in scope; otherwise keep them clearly labeled as local heuristics.
6. Reconcile stale capability text in `components/photoshop/advanced-subsystems.ts` for TGA/PNM export, because lower-level encoders and the main capability registry now indicate those exports exist.

## Verification Notes

- `npm run typecheck` completed successfully.
- I did not run the full Playwright suite because the request was for a codebase implementation report and the full suite is large. Existing test files show broad coverage across the areas named above.
