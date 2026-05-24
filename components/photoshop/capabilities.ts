export type CapabilityStatus = "complete" | "usable" | "approximation" | "stub" | "unsupported"

export type CapabilityKind =
  | "tool"
  | "filter"
  | "panel"
  | "format"
  | "export"
  | "color"
  | "smart-object"
  | "typography"
  | "3d"
  | "video"
  | "workflow"
  | "external"
  | "performance"
  | "preferences"

export interface CapabilityRecord {
  id: string
  label: string
  kind: CapabilityKind
  status: CapabilityStatus
  summary: string
  limitations?: string[]
  recommendedAction?: string
  dependsOn?: string[]
  testCoverage?: "none" | "reachability" | "unit" | "e2e" | "golden"
}

export interface CapabilityWarning {
  label: string
  capabilityId: string
  status: CapabilityStatus
  detail: string
  recommendedAction?: string
}

export interface CapabilityDocumentSnapshot {
  colorMode?: string
  bitDepth?: number
  layers?: Array<{
    kind?: string
    smartObject?: boolean
    smartFilters?: Array<{ enabled?: boolean }>
    adjustment?: unknown
    frame?: unknown
    artboard?: unknown
    threeD?: unknown
    video?: unknown
    plugins?: unknown
  }>
  plugins?: unknown[]
  variableDataSets?: unknown[]
  comps?: unknown[]
  slices?: unknown[]
  guides?: unknown[]
  metadata?: unknown
  colorManagement?: unknown
}

export const CAPABILITY_STATUS_ORDER: CapabilityStatus[] = [
  "complete",
  "usable",
  "approximation",
  "stub",
  "unsupported",
]

const records = [
  {
    id: "tool.quick-selection",
    label: "Quick Selection Tool",
    kind: "tool",
    status: "usable",
    summary: "Local edge-aware region growing selection from a seed point.",
    limitations: ["No model-backed semantic object recognition.", "Selection quality depends on color edges in rendered 8-bit pixels."],
    recommendedAction: "Use for local edge-bounded selections; use Select and Mask for refinement.",
    testCoverage: "unit",
  },
  {
    id: "tool.slice-select",
    label: "Slice Select Tool",
    kind: "tool",
    status: "usable",
    summary: "Selects and edits existing browser export slices.",
    limitations: ["No ImageReady-era slice optimization metadata.", "Slice export remains browser raster based."],
    testCoverage: "reachability",
  },
  {
    id: "tool.freeform-pen",
    label: "Freeform Pen Tool",
    kind: "tool",
    status: "usable",
    summary: "Creates editable path metadata from freehand pointer input.",
    limitations: ["Magnetic path fitting is local and heuristic when enabled.", "Advanced anchor smoothing parity is not guaranteed."],
    testCoverage: "reachability",
  },
  {
    id: "tool.anchor-editing",
    label: "Anchor Point Editing Tools",
    kind: "tool",
    status: "usable",
    summary: "Adds anchors on the nearest path segment, removes nearby anchors, converts corner/smooth handles, and exports app paths as SVG path data.",
    limitations: ["Bezier handle editing is limited to the app path model."],
    testCoverage: "unit",
  },
  {
    id: "tool.vertical-type",
    label: "Vertical Type Tool",
    kind: "tool",
    status: "usable",
    summary: "Creates editable text layers with vertical glyph rendering metadata.",
    limitations: ["Browser font shaping and vertical metrics can differ from Photoshop."],
    testCoverage: "reachability",
  },
  {
    id: "typography.variable-fonts",
    label: "Variable Font Axes",
    kind: "typography",
    status: "usable",
    summary: "Text layers store variable axis metadata and apply CSS canvas font-variation settings where the browser supports them.",
    limitations: ["Actual shaping depends on the browser font engine and installed variable fonts."],
    testCoverage: "unit",
  },
  {
    id: "typography.font-diagnostics",
    label: "Font Preview and Missing-Font Diagnostics",
    kind: "typography",
    status: "usable",
    summary: "Font preview specs, browser availability checks, per-layer missing font reports, and fallback substitutions are available.",
    limitations: ["Fonts are not embedded in raster exports or PSD output."],
    testCoverage: "unit",
  },
  {
    id: "typography.match-font",
    label: "Match Font",
    kind: "typography",
    status: "approximation",
    summary: "Ranks local/browser font candidates by deterministic text geometry heuristics instead of random substitution.",
    limitations: ["No OCR or Adobe Sensei-style image font recognition."],
    testCoverage: "unit",
  },
  {
    id: "typography.text-editing",
    label: "Find/Replace Text Across Layers",
    kind: "typography",
    status: "usable",
    summary: "Searches editable text layers, applies case/word-aware replacement, and reports changed layers and match positions.",
    limitations: ["Raster-only text pixels cannot be edited as text."],
    testCoverage: "unit",
  },
  {
    id: "typography.shape-path-text",
    label: "Text Inside Shape and Text to Path",
    kind: "typography",
    status: "approximation",
    summary: "Text layers can use shape area containers and can be converted to editable approximate path outlines.",
    limitations: ["Path conversion uses browser-native approximate glyph contours, not exact proprietary font outlines."],
    testCoverage: "unit",
  },
  {
    id: "typography.opentype-aa",
    label: "OpenType Controls and Anti-Alias Modes",
    kind: "typography",
    status: "usable",
    summary: "Text rendering stores and applies ligature, alternates, figures, fraction, small-caps, and Photoshop-style anti-alias metadata.",
    limitations: ["Browser canvas support for some OpenType tags varies by engine and font."],
    testCoverage: "unit",
  },
  {
    id: "typography.3d-text",
    label: "3D Text Extrusion",
    kind: "typography",
    status: "approximation",
    summary: "Creates browser-native 3D scene layers with per-glyph extrusion geometry, material, lights, and rendered previews.",
    limitations: ["Glyph meshes are editable approximations, not exact font outline triangulations."],
    testCoverage: "unit",
  },
  {
    id: "3d.advanced-import-export",
    label: "Advanced 3D Import / Export",
    kind: "3d",
    status: "approximation",
    summary: "Imports browser-readable 3DS/KMZ/U3D subsets and exports documented local interchange payloads alongside OBJ/DAE.",
    limitations: ["Binary vendor feature parity, animation stacks, compressed KMZ packaging, and proprietary U3D blocks are approximated."],
    testCoverage: "unit",
  },
  {
    id: "3d.material-uv-paint",
    label: "UV, Material, and 3D Surface Painting",
    kind: "3d",
    status: "usable",
    summary: "Scene metadata supports planar UV assignment, material UV scale/offset, texture paint strokes, and editable material parameters.",
    limitations: ["Texture strokes are stored as editable browser metadata rather than baked GPU texture atlases."],
    testCoverage: "unit",
  },
  {
    id: "3d.raytrace-cross-section-print",
    label: "Ray Trace, Cross Section, and 3D Print Checks",
    kind: "3d",
    status: "approximation",
    summary: "CPU ray-traced previews, cross-section cap metadata, and non-manifold/build-volume/thin-wall print checks run locally.",
    limitations: ["No GPU path tracer, physical material renderer, slicer, or printer-driver integration."],
    testCoverage: "unit",
  },
  {
    id: "video.timeline-editing",
    label: "Video Trim, Split, Transitions, and Groups",
    kind: "video",
    status: "usable",
    summary: "Video layer metadata supports trim ranges, split clip creation, cross-dissolve/fade/wipe transitions, and video group records.",
    limitations: ["Browser decoding and MediaRecorder support determine which source media can be previewed and exported."],
    testCoverage: "unit",
  },
  {
    id: "video.audio-mixing",
    label: "Audio Mixing and Playback Model",
    kind: "video",
    status: "usable",
    summary: "Audio tracks store pan, fades, mute state, volume, and active mix gain calculations for timeline playback/export planning.",
    limitations: ["The app stores and plans mix behavior; actual final muxing depends on browser encoder capabilities."],
    testCoverage: "unit",
  },
  {
    id: "video.export-presets-frame-animation",
    label: "Video Export Presets and Frame Animation Conversion",
    kind: "video",
    status: "usable",
    summary: "Named export presets cover draft WebM, social H.264, archive VP9, GIF/frame animation, and PNG-sequence workflows.",
    limitations: ["Unsupported codecs fall back to browser MediaRecorder formats."],
    testCoverage: "unit",
  },
  {
    id: "preferences.performance-settings",
    label: "RAM, Cache, Scratch Disk, and GPU Preferences",
    kind: "preferences",
    status: "usable",
    summary: "Preferences store RAM allocation, cache levels, tile size, history state limits, scratch storage quotas, WebGL/worker preferences, and browser fallback policy summaries.",
    limitations: ["Browser preferences cannot reserve operating-system RAM, select physical disks directly, or force native GPU driver behavior."],
    testCoverage: "unit",
  },
  {
    id: "preferences.file-handling-history",
    label: "File Handling Policies and History Log",
    kind: "preferences",
    status: "usable",
    summary: "File handling policies cover autosave intervals, close prompts, project-format preference, metadata preservation, compatibility warnings, missing-font handling, large-file handling, and bounded history logs.",
    limitations: ["History text-file output is exported by the browser on demand rather than continuously appended to an arbitrary local path."],
    testCoverage: "unit",
  },
  {
    id: "preferences.cursor-tool-units",
    label: "Cursor, Tool Behavior, Units, Rulers, and Grid Preferences",
    kind: "preferences",
    status: "usable",
    summary: "Tool cursor style, brush-preview crosshairs, tooltip behavior, brush smoothing, shift-cycling, auto-select behavior, ruler units, type units, print resolution, calibrated screen DPI, grid subdivision/color/opacity, pixel grid, snap, smart guides, and ruler origin are persisted and applied to active documents.",
    limitations: ["Some tool behavior settings remain local editor preferences rather than operating-system level cursor settings."],
    testCoverage: "unit",
  },
  {
    id: "preferences.import-export-reset",
    label: "Preference Set Import, Export, and Reset",
    kind: "preferences",
    status: "usable",
    summary: "Preference sets normalize old localStorage values, import/export versioned JSON, validate malformed imports with section-specific errors, support drag-and-drop JSON imports, and can import only selected preference sections.",
    limitations: ["Preference sync is local to the browser profile; no cloud account sync is provided."],
    testCoverage: "unit",
  },
  {
    id: "tool.shape-rounded-rect",
    label: "Rounded Rectangle Tool",
    kind: "tool",
    status: "usable",
    summary: "Creates shape layers with live radius metadata.",
    limitations: ["Per-corner radius editing is not complete."],
    testCoverage: "reachability",
  },
  {
    id: "tool.shape-polygon",
    label: "Polygon and Triangle Tools",
    kind: "tool",
    status: "usable",
    summary: "Creates polygon shape layers with side-count metadata.",
    limitations: ["Advanced star/path component options are limited to app presets."],
    testCoverage: "reachability",
  },
  {
    id: "format.psd",
    label: "PSD",
    kind: "format",
    status: "approximation",
    summary: "PSD import/export uses ag-psd with broad round-trip coverage: layer effects, adjustments, advanced blending, smart filters/objects, vector masks, shapes, text, paths, alpha/spot channels, guides, slices, comps, metadata, resolution, global light, and notes. App-only fields use marker-name encoding to survive vanilla ag-psd writes.",
    limitations: [
      "Pixel rendering and brush surfaces remain browser 8-bit RGBA even when bitDepth/colorMode metadata indicates 16/32-bit or CMYK.",
      "ag-psd's writer hardcodes RGB color mode and 8 bpc on disk; high-bit/CMYK/Lab data is preserved as side-band metadata and rasterized for display.",
      "Some adjustments (shadows-highlights, hdr-toning, desaturate, match-color, replace-color, equalize) round-trip through marker-name encoding.",
    ],
    recommendedAction: "Use the project format for maximum app metadata preservation when round-trip fidelity outside this app matters.",
    testCoverage: "e2e",
  },
  {
    id: "psd.color-modes",
    label: "PSD Color Modes and Bit Depth",
    kind: "format",
    status: "approximation",
    summary: "PSD color mode (Bitmap/Grayscale/Indexed/RGB/CMYK/Lab/Multichannel/Duotone) and bit depth (1/8/16/32) are detected on import; ICC profile bytes are preserved through the document and re-attached on export.",
    limitations: [
      "ag-psd's writer can only encode RGB at 8 bpc; non-RGB modes are stored as document metadata and exports remain RGB on disk.",
      "ICC color transforms are not applied to pixel data; profiles are passed through for color-managed downstream tools.",
    ],
    dependsOn: ["color.high-bit-pipeline", "color.icc-conversion"],
    testCoverage: "unit",
  },
  {
    id: "psd.effects-adjustments",
    label: "PSD Layer Effects and Adjustment Layers",
    kind: "format",
    status: "approximation",
    summary: "Layer effects (drop/inner shadow, outer/inner glow, bevel, satin, color/gradient/pattern overlay, stroke) and 22 adjustment layer types round-trip; 16 use native ag-psd descriptors and 6 use marker-name encoding.",
    limitations: [
      "Adjustment descriptors lacking native ag-psd support are recovered via marker layers; opening in older Photoshop builds may show generic adjustment labels.",
      "Layer style global-light tracking follows the document's globalLight resource.",
    ],
    testCoverage: "unit",
  },
  {
    id: "psd.vector-text",
    label: "PSD Vector, Shapes, Text, and Paths",
    kind: "format",
    status: "approximation",
    summary: "Text layers (font/size/styles/color), shape layers (rect/ellipse/polygon/custom), per-layer vector masks, and document-level paths round-trip. Custom shape and extended text properties use marker-name encoding.",
    limitations: [
      "Browser font shaping does not perfectly match Photoshop's text engine.",
      "ag-psd's 0x07D0+ path image resources are surfaced via a marker token attached to the PSD's top-level name.",
    ],
    testCoverage: "unit",
  },
  {
    id: "psd.channels-masks",
    label: "PSD Channels and Masks",
    kind: "format",
    status: "approximation",
    summary: "Raster layer masks (defaultColor/disabled/position), vector layer masks, saved alpha channels with pixel data, spot channels (via naming), and clipping-mask groups all round-trip.",
    limitations: [
      "Saved alpha channel pixels travel through a hidden marker group (__app_saved_channels__) because ag-psd does not surface saved-channel pixel records on its public Psd shape.",
      "Spot channels are encoded via the channel name '[spot:#rrggbb:opacity]name'.",
    ],
    testCoverage: "unit",
  },
  {
    id: "psd.resources-metadata",
    label: "PSD Image Resources and Metadata",
    kind: "format",
    status: "approximation",
    summary: "Guides, slices, layer comps, smart objects, document metadata (XMP), print settings, resolution/DPI, global light, and annotations round-trip through native ag-psd structures with marker-encoded payloads for full-fidelity recovery.",
    limitations: [
      "IPTC and EXIF blobs are not surfaced by ag-psd's public ImageResources, only XMP; IPTC/EXIF bytes are built internally for sidecar use.",
      "Smart object embedded bytes are capped at 30 MB.",
      "Print settings have lossy paper-size mapping; bleed and orientation use embedded extras.",
    ],
    testCoverage: "unit",
  },
  {
    id: "format.psb",
    label: "PSB",
    kind: "format",
    status: "usable",
    summary: "PSB import/export uses ag-psd Large Document mode for layered documents that fit browser canvas, file, and memory limits.",
    limitations: [
      "Photoshop-scale PSBs can still exceed browser memory/canvas limits even with the tiled backing store; the compositor still draws through a single HTML5 2D context.",
      "Rendered editing remains browser 8-bit RGBA even when PSB metadata indicates higher bit depth or non-RGB color intent.",
    ],
    recommendedAction: "Use Save As PSB for large documents that fit local limits; keep huge production PSBs in tiled native tooling.",
    testCoverage: "unit",
  },
  {
    id: "format.raw-dng",
    label: "RAW/DNG",
    kind: "format",
    status: "approximation",
    summary: "Uses LibRaw WASM for browser-side RAW/DNG demosaic where available and falls back to embedded JPEG preview extraction.",
    limitations: ["No native RAW export, camera/lens profile parity, sidecar round trip, or non-destructive RAW settings."],
    recommendedAction: "Use RAW/DNG import for editable previews and keep original RAW files for production-grade raw processing.",
    testCoverage: "reachability",
  },
  {
    id: "format.openexr",
    label: "OpenEXR",
    kind: "format",
    status: "approximation",
    summary: "OpenEXR import uses parse-exr to decode supported pixel channels into tone-mapped editable RGBA previews and exports flattened uncompressed 32-bit float RGBA scanline EXR.",
    limitations: ["Multipart/deep/tiled EXR, arbitrary channel sets, production OCIO transforms, and true HDR editing are not implemented."],
    recommendedAction: "Use EXR import/export for local flattened interchange; verify scene-linear production files in dedicated EXR tooling.",
    testCoverage: "unit",
  },
  {
    id: "format.baseline-tiff",
    label: "Baseline TIFF",
    kind: "format",
    status: "usable",
    summary: "Decodes TIFF through UTIF2 with a local baseline fallback and exports flattened RGBA TIFF data.",
    limitations: ["No BigTIFF, certified ICC conversion, or production prepress CMYK separation fidelity."],
    recommendedAction: "Use for local preview/import of simple TIFF assets; keep production TIFF handoff in dedicated prepress tools.",
    testCoverage: "unit",
  },
  {
    id: "format.pdf",
    label: "PDF",
    kind: "format",
    status: "approximation",
    summary: "PDF import renders the first page to an editable raster layer through PDF.js, and export writes a single-page flattened PDF containing the canvas composite.",
    limitations: ["No editable vectors, embedded font editing, transparency group preservation, annotations, or multipage authoring."],
    recommendedAction: "Use PDF import/export for flattened page handoff; keep editable PDF/prepress work in dedicated layout tools.",
    testCoverage: "unit",
  },
  {
    id: "format.eps",
    label: "EPS / PostScript",
    kind: "format",
    status: "approximation",
    summary: "EPS import renders a safe subset of EPS vector operators, and export writes flattened Level 2 raster EPS data.",
    limitations: ["No arbitrary PostScript execution, font resolution, separations, overprint handling, or full editable vector import."],
    recommendedAction: "Use EPS for flattened handoff only; use SVG/project format for editable local vector content.",
    testCoverage: "unit",
  },
  {
    id: "format.heif",
    label: "HEIF / HEIC",
    kind: "format",
    status: "approximation",
    summary: "HEIF/HEIC import uses the bundled decoder for primary-image RGBA previews.",
    limitations: ["No HEIF export, auxiliary/depth image handling, live-photo pairing, full ICC conversion, or metadata embedding."],
    recommendedAction: "Use HEIF/HEIC import for flattened editing and export through AVIF/WebP/JPEG/PNG or project format.",
    testCoverage: "unit",
  },
  {
    id: "format.jpeg2000",
    label: "JPEG 2000",
    kind: "format",
    status: "approximation",
    summary: "JPEG 2000 import decodes supported JP2/J2K codestreams into editable RGBA previews.",
    limitations: ["No JPEG 2000 export, advanced color-box authoring, or multi-resolution codestream writing."],
    recommendedAction: "Use JPEG 2000 import for flattened editing and export through TIFF/PNG/EXR/project format.",
    testCoverage: "unit",
  },
  {
    id: "format.tga-pnm",
    label: "TGA and Portable AnyMap",
    kind: "format",
    status: "usable",
    summary: "Decodes TGA true-color/grayscale/indexed RLE data plus PBM/PGM/PPM/PNM ASCII and binary rasters; exports TGA RLE and PBM/PGM/PPM from canvas pixels.",
    limitations: ["Imports resolve to browser 8-bit RGBA layers; source comments and format-specific export metadata are not round-tripped."],
    testCoverage: "unit",
  },
  {
    id: "format.radiance-hdr",
    label: "Radiance HDR",
    kind: "format",
    status: "usable",
    summary: "Imports flat and RLE Radiance RGBE files into tone-mapped editable previews and exports flattened RGBE HDR files.",
    limitations: ["Canvas editing remains 8-bit RGBA; no scene-linear high dynamic range working space is provided."],
    testCoverage: "unit",
  },
  {
    id: "format.dicom",
    label: "DICOM",
    kind: "format",
    status: "approximation",
    summary: "Imports uncompressed MONOCHROME/RGB DICOM pixels through dicom-parser and exports minimal Secondary Capture DICOM from flattened RGB pixels.",
    limitations: ["No compressed transfer syntaxes, overlays, diagnostic metadata workflow, or clinical validation."],
    testCoverage: "unit",
  },
  {
    id: "export.browser-raster",
    label: "Browser Raster Export",
    kind: "export",
    status: "usable",
    summary: "Exports browser canvas encodings plus app-authored TIFF, TGA, PNM, interlaced PNG, progressive JPEG, and PNG/JPEG metadata paths.",
    limitations: ["ICC profiles and content credentials are still reported rather than embedded in browser raster outputs."],
    recommendedAction: "Use exported report/preflight notes for handoff limitations.",
    testCoverage: "e2e",
  },
  {
    id: "color.browser-rgba",
    label: "Browser 8-bit RGBA Pixel Pipeline",
    kind: "color",
    status: "usable",
    summary: "Rendered pixels are edited through browser canvas ImageData.",
    limitations: ["Actual editing is 8-bit RGBA even when document metadata says 16-bit or 32-bit."],
    recommendedAction: "Keep high-bit source files outside this editor when high-bit fidelity is required.",
    testCoverage: "unit",
  },
  {
    id: "color.icc-conversion",
    label: "ICC-Accurate Conversion",
    kind: "color",
    status: "unsupported",
    summary: "Color profile assignment and proofing are visual guidance, not ICC conversion.",
    limitations: ["No full ICC transform engine or production separations."],
    recommendedAction: "Use professional color-managed software for final print proofing.",
    testCoverage: "reachability",
  },
  {
    id: "color.high-bit-pipeline",
    label: "16/32-bit Editing Pipeline",
    kind: "color",
    status: "approximation",
    summary: "A typed-array high-bit image model exists for local algorithms and tone-mapped previews; canvas display still resolves through 8-bit RGBA.",
    limitations: ["Brush/canvas display/export paths are still browser 8-bit RGBA.", "No ICC/WASM transform engine or half-float GPU pipeline."],
    recommendedAction: "Use the typed pipeline for import analysis and algorithmic operations; add a dedicated engine before claiming production high-bit editing parity.",
    testCoverage: "unit",
  },
  {
    id: "smart-object.linked",
    label: "Linked Smart Objects",
    kind: "smart-object",
    status: "approximation",
    summary: "Smart object sources track embedded/linked metadata, missing/modified/current states, edit-contents save-back, replace contents, export contents, convert-to-layers, and local stack modes.",
    limitations: ["No native file watcher or external linked-document sync daemon."],
    recommendedAction: "Use project format for preserving local smart object source metadata.",
    testCoverage: "unit",
  },
  {
    id: "smart-object.filters",
    label: "Smart Filters",
    kind: "smart-object",
    status: "usable",
    summary: "Smart filter metadata, order, masks, opacity, blend mode, enable state, and project round trips are editable locally.",
    limitations: ["PSD export rasterizes visual results; native Photoshop smart filter resources are not emitted."],
    testCoverage: "e2e",
  },
  {
    id: "filter.blur-gallery",
    label: "Blur Gallery",
    kind: "filter",
    status: "usable",
    summary: "Field Blur, Iris Blur, Tilt-Shift, Path Blur, and Spin Blur have named local algorithms with spatially varying previews.",
    limitations: ["No GPU blur pins or Photoshop-native blur-gallery mesh serialization."],
    testCoverage: "unit",
  },
  {
    id: "workflow.camera-raw",
    label: "Camera Raw Filter",
    kind: "workflow",
    status: "approximation",
    summary: "Local rendered-pixel Camera Raw engine supports tone, presence, HSL, optics, calibration, masks, presets, snapshots, and batch application.",
    limitations: ["No RAW demosaic, camera/lens profile database, or scene-linear RAW-backed processing."],
    recommendedAction: "Add a dedicated RAW decoder/profile engine before claiming native Camera Raw parity.",
    testCoverage: "unit",
  },
  {
    id: "workflow.photomerge",
    label: "Photomerge",
    kind: "workflow",
    status: "approximation",
    summary: "Local browser decoded panorama merge uses contrast feature detection, descriptor matching, translation RANSAC/fallback search, expanded canvas bounds, and feathered overlap blending.",
    limitations: ["Translation-only alignment; no camera model, cylindrical/spherical projection, lens-profile database, or native Photoshop Photomerge parity."],
    recommendedAction: "Use for simple local stack workflows only.",
    testCoverage: "unit",
  },
  {
    id: "workflow.hdr-merge",
    label: "HDR Merge",
    kind: "workflow",
    status: "approximation",
    summary: "Local approximation aligns 8-bit exposure brackets, estimates scene-linear radiance with exposure weighting, and tone maps back into editable RGBA pixels.",
    limitations: ["No RAW exposure stack, deghosting UI, 32-bit document mode, or true scene-linear HDR editing pipeline."],
    testCoverage: "unit",
  },
  {
    id: "workflow.content-aware-scale",
    label: "Content-Aware Scale",
    kind: "workflow",
    status: "approximation",
    summary: "Uses local seam carving with gradient energy, protected-mask support in the core engine, and explicit fallback for large reductions.",
    limitations: ["Large changes can still fall back to resampling.", "No Photoshop protected skin-tone/object models."],
    testCoverage: "unit",
  },
  {
    id: "filter.worker-expanded",
    label: "Worker Filter Coverage",
    kind: "filter",
    status: "usable",
    summary: "Deterministic supported filters run off-main-thread when worker APIs are available.",
    limitations: ["Registry-heavy and complex filters use scheduled main-thread fallback."],
    testCoverage: "unit",
  },
  {
    id: "performance.large-documents",
    label: "Large Document Performance",
    kind: "performance",
    status: "usable",
    summary: "Canvas pooling, history patches, pixel batch reads, worker filters, tiled filter execution, and a tiled backing store with OPFS spill reduce large-image stalls.",
    limitations: ["Compositor still renders through HTML5 2D, so very-large frames hit canvas-area limits before the tile store does."],
    testCoverage: "unit",
  },
  {
    id: "performance.opfs-scratch",
    label: "OPFS Scratch Storage",
    kind: "performance",
    status: "usable",
    summary: "Origin Private File System scratch directory holds tile spill-over and incremental autosave deltas; in-memory fallback when OPFS is unavailable.",
    limitations: ["Quota varies across browsers; the planner reserves headroom to avoid eviction at the OS layer."],
    testCoverage: "unit",
  },
  {
    id: "performance.tiled-backing-store",
    label: "Tiled Document Backing Store",
    kind: "performance",
    status: "usable",
    summary: "Document pixels are paged through fixed-size tiles with LRU eviction, OPFS spill, and a memory-budget tracker.",
    limitations: ["Smart objects and 3D layers still render full-frame; tiling targets raster layers."],
    testCoverage: "unit",
  },
  {
    id: "performance.progressive-preview",
    label: "Progressive Preview Rendering",
    kind: "performance",
    status: "usable",
    summary: "Large documents and zoom transitions render a low-resolution draft first, then refine through cancellable stages to full quality.",
    limitations: ["Coarse stages use nearest-neighbor downsampling — the final pass replaces them within a few hundred milliseconds."],
    testCoverage: "unit",
  },
  {
    id: "performance.dirty-rect-invalidation",
    label: "Dirty-Rect Render Invalidation",
    kind: "performance",
    status: "usable",
    summary: "Render bus tracks dirty rectangles per layer and merges them across same-frame invalidations so the compositor can scissor its redraw.",
    limitations: ["Coverage above 60% promotes to a full-frame redraw to amortize bookkeeping cost."],
    testCoverage: "unit",
  },
  {
    id: "performance.memory-budget",
    label: "Memory Budget Enforcement",
    kind: "performance",
    status: "usable",
    summary: "A central tracker bounds history, tile cache, composite cache, and filter buffers; subscribers receive soft and hard pressure events.",
    limitations: ["Allocation sizes are declared by callers; the tracker does not introspect raw heap usage."],
    testCoverage: "unit",
  },
  {
    id: "performance.incremental-autosave",
    label: "Incremental Autosave",
    kind: "performance",
    status: "usable",
    summary: "Per-layer fingerprints drive a delta autosave chain backed by OPFS; full snapshots rebase the chain at a bounded interval.",
    limitations: ["Delta chain capped at ~8 entries and ~12 MB before a forced rebase."],
    testCoverage: "unit",
  },
  {
    id: "performance.offscreen-canvas",
    label: "OffscreenCanvas Adoption",
    kind: "performance",
    status: "usable",
    summary: "Capability detection picks OffscreenCanvas for intermediate composites, filter buffers, and worker transfers; falls back to HTMLCanvasElement when unsupported.",
    limitations: ["Some browsers expose OffscreenCanvas only on the main thread; worker transfer paths advertise their requirements explicitly."],
    testCoverage: "unit",
  },
  {
    id: "external.generative-fill",
    label: "Generative Fill",
    kind: "external",
    status: "unsupported",
    summary: "Requires model-backed inpainting infrastructure that is not present in this repo.",
    limitations: ["No hosted model endpoint, prompt safety flow, or generated layer provenance pipeline."],
    recommendedAction: "Choose an AI provider and service architecture before implementation.",
    testCoverage: "none",
  },
  {
    id: "external.native-plugins",
    label: "Native 8BF/UXP/CEP Execution",
    kind: "external",
    status: "unsupported",
    summary: "Local plugin descriptors and sandboxed HTML panels exist, but native Adobe plugin runtimes do not.",
    limitations: ["No native binary execution and no Adobe UXP/CEP API runtime."],
    recommendedAction: "Define a browser-safe plugin API instead of claiming Adobe plugin compatibility.",
    testCoverage: "reachability",
  },
  {
    id: "external.cloud-libraries",
    label: "Creative Cloud Libraries",
    kind: "external",
    status: "unsupported",
    summary: "Project-local asset records exist; Adobe cloud sync does not.",
    limitations: ["No Adobe account, licensing, or sync integration."],
    testCoverage: "reachability",
  },
] as const satisfies readonly CapabilityRecord[]

const CAPABILITY_BY_ID = new Map<string, CapabilityRecord>(records.map((record) => [record.id, record]))

const UNKNOWN_CAPABILITY: CapabilityRecord = {
  id: "unknown",
  label: "Unknown capability",
  kind: "external",
  status: "unsupported",
  summary: "No capability record is registered for this feature.",
  limitations: ["The feature cannot be classified until it is added to the registry."],
  recommendedAction: "Add a capability record before exposing this as supported.",
  testCoverage: "none",
}

export function listCapabilities(filter?: { kind?: CapabilityKind; status?: CapabilityStatus }) {
  return records.filter((record) => {
    if (filter?.kind && record.kind !== filter.kind) return false
    if (filter?.status && record.status !== filter.status) return false
    return true
  })
}

export function getCapability(id: string): CapabilityRecord {
  return CAPABILITY_BY_ID.get(id) ?? { ...UNKNOWN_CAPABILITY, id }
}

export function capabilityStatusRank(status: CapabilityStatus) {
  return CAPABILITY_STATUS_ORDER.indexOf(status)
}

export function isCapabilityUsable(id: string) {
  return ["complete", "usable", "approximation"].includes(getCapability(id).status)
}

export function summarizeCapabilities(items: readonly CapabilityRecord[]) {
  const summary: Record<CapabilityStatus, number> = {
    complete: 0,
    usable: 0,
    approximation: 0,
    stub: 0,
    unsupported: 0,
  }
  for (const item of items) summary[item.status] += 1
  return summary
}

function warning(record: CapabilityRecord, label: string, detail?: string): CapabilityWarning {
  return {
    label,
    capabilityId: record.id,
    status: record.status,
    detail: detail ?? record.summary,
    recommendedAction: record.recommendedAction,
  }
}

export function capabilityWarningsForDocument(doc: CapabilityDocumentSnapshot | null | undefined): CapabilityWarning[] {
  if (!doc) return []
  const warnings: CapabilityWarning[] = []
  const layers = doc.layers ?? []
  const bitDepth = Number(doc.bitDepth ?? 8)
  const colorMode = String(doc.colorMode ?? "RGB")
  const smartFilterCount = layers.reduce((sum, layer) => sum + (layer.smartFilters?.length ?? 0), 0)
  const smartObjectCount = layers.filter((layer) => layer.kind === "smart-object" || layer.smartObject).length
  const appOnlyLayerCount = layers.filter((layer) =>
    layer.kind === "3d" ||
    layer.kind === "video" ||
    layer.kind === "adjustment" ||
    Boolean(layer.frame) ||
    Boolean(layer.artboard) ||
    Boolean(layer.threeD) ||
    Boolean(layer.video) ||
    Boolean(layer.smartFilters?.length),
  ).length

  warnings.push(warning(
    getCapability("color.browser-rgba"),
    "Browser pixel pipeline",
    bitDepth > 8
      ? `${bitDepth}-bit document metadata is retained, but rendered editing uses browser 8-bit RGBA canvas pixels.`
      : "Rendered editing uses browser 8-bit RGBA canvas pixels.",
  ))

  if (bitDepth > 8) {
    warnings.push(warning(
      getCapability("color.high-bit-pipeline"),
      "High-bit editing",
      "The document can use local typed-array high-bit math for algorithms and previews, but canvas painting, display, and export still resolve through browser 8-bit RGBA pixels.",
    ))
  }

  if (!["RGB", "Grayscale"].includes(colorMode)) {
    warnings.push(warning(
      getCapability("color.icc-conversion"),
      "Color mode",
      `${colorMode} mode is stored as document intent; display, filters, and export operate through browser RGB canvas data.`,
    ))
  }

  if (smartFilterCount) {
    warnings.push(warning(
      getCapability("smart-object.filters"),
      "Smart filters",
      `${smartFilterCount} smart filter${smartFilterCount === 1 ? "" : "s"} remain editable in-project; PSD/export workflows may rasterize the visual result.`,
    ))
  }

  if (smartObjectCount) {
    warnings.push(warning(
      getCapability("smart-object.linked"),
      "Smart object lifecycle",
      `${smartObjectCount} smart object layer${smartObjectCount === 1 ? "" : "s"} exist, but linked-file relink/update parity is incomplete.`,
    ))
  }

  if (appOnlyLayerCount || doc.plugins?.length || doc.variableDataSets?.length || doc.comps?.length || doc.slices?.length || doc.guides?.length) {
    warnings.push(warning(
      getCapability("format.psd"),
      "PSD round trip",
      "Project format preserves more app metadata than PSD import/export; PSD workflows keep a raster-compatible subset.",
    ))
  }

  warnings.push(warning(
    getCapability("export.browser-raster"),
    "Raster export",
    "Raster export embeds PNG/JPEG metadata and supports progressive/interlaced controls, but ICC profiles and content credentials remain handoff limitations.",
  ))

  return warnings
}

export function capabilitiesForIds(ids: readonly string[]) {
  return ids.map(getCapability).sort((a, b) => capabilityStatusRank(a.status) - capabilityStatusRank(b.status))
}
