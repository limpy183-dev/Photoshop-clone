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
    summary: "Tool cursor style, tooltip behavior, brush smoothing, shift-cycling, auto-select behavior, ruler units, type units, print resolution, grid subdivision/color/opacity, pixel grid, snap, smart guides, and ruler origin are persisted and applied to active documents.",
    limitations: ["Some tool behavior settings remain local editor preferences rather than operating-system level cursor settings."],
    testCoverage: "unit",
  },
  {
    id: "preferences.import-export-reset",
    label: "Preference Set Import, Export, and Reset",
    kind: "preferences",
    status: "usable",
    summary: "Preference sets normalize old localStorage values, import/export versioned JSON, and reset either all settings or a single preference section.",
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
    status: "usable",
    summary: "PSD import/export uses ag-psd and preserves a raster-compatible subset.",
    limitations: ["Some app-only metadata is approximated or rasterized.", "Vendor-specific resources are not full Photoshop round-trip parity."],
    recommendedAction: "Use the project format for maximum app metadata preservation.",
    testCoverage: "e2e",
  },
  {
    id: "format.psb",
    label: "PSB",
    kind: "format",
    status: "unsupported",
    summary: "Large Document Format is detected but not decoded as layered pixels.",
    limitations: ["No PSB parser is implemented.", "Large-canvas layer/resource streaming is not available."],
    recommendedAction: "Add a PSB parser and tiled memory model before presenting PSB as importable.",
    testCoverage: "reachability",
  },
  {
    id: "format.raw-dng",
    label: "RAW/DNG",
    kind: "format",
    status: "approximation",
    summary: "Imports embedded previews when present; does not demosaic raw sensor data.",
    limitations: ["No demosaic, camera profile, lens correction, high-bit pipeline, or sidecar settings."],
    recommendedAction: "Use preview import locally or add a dedicated RAW decoder/service.",
    testCoverage: "reachability",
  },
  {
    id: "format.openexr",
    label: "OpenEXR",
    kind: "format",
    status: "unsupported",
    summary: "EXR headers can be identified, but pixel channels are not decoded.",
    limitations: ["No half-float channel, compression, multipart, or scene-linear pipeline support."],
    recommendedAction: "Add a WASM/native EXR decoder and color pipeline before enabling pixel import.",
    testCoverage: "reachability",
  },
  {
    id: "format.baseline-tiff",
    label: "Baseline TIFF",
    kind: "format",
    status: "approximation",
    summary: "Decodes uncompressed baseline grayscale/RGB/RGBA TIFF strips, including 16-bit sources tone-mapped into preview layers.",
    limitations: ["No LZW/ZIP/JPEG compression, tiled TIFF, BigTIFF, true CMYK separations, or ICC conversion."],
    recommendedAction: "Use for local preview/import of simple TIFF assets; keep production TIFF handoff in dedicated prepress tools.",
    testCoverage: "unit",
  },
  {
    id: "format.pdf",
    label: "PDF",
    kind: "format",
    status: "approximation",
    summary: "PDF files are modeled as metadata/preflight handoff targets; browser export can describe a flattened composite preview but does not author native PDF structures.",
    limitations: ["No PDF page renderer, editable vectors, embedded fonts, transparency groups, annotations, or multipage export."],
    recommendedAction: "Use the report for handoff limitations or add a dedicated PDF renderer/writer before exposing PDF as native import/export.",
    testCoverage: "unit",
  },
  {
    id: "format.eps",
    label: "EPS / PostScript",
    kind: "format",
    status: "unsupported",
    summary: "EPS/PostScript headers can be identified for reporting, but no PostScript interpreter or native EPS writer is present.",
    limitations: ["No PostScript execution, editable vector import, separations, overprint handling, or EPS export."],
    recommendedAction: "Use SVG/project/browser raster export unless a sandboxed PostScript renderer is added.",
    testCoverage: "unit",
  },
  {
    id: "format.heif",
    label: "HEIF / HEIC",
    kind: "format",
    status: "unsupported",
    summary: "HEIF/HEIC is metadata-only in the advanced format model; browser image MIME hints are not treated as reliable Photoshop import support.",
    limitations: ["No HEVC image decoder, auxiliary/depth image handling, ICC conversion, or HEIF writer."],
    recommendedAction: "Convert to browser-supported raster formats before import or add a dedicated HEIF codec.",
    testCoverage: "unit",
  },
  {
    id: "format.jpeg2000",
    label: "JPEG 2000",
    kind: "format",
    status: "unsupported",
    summary: "JP2/J2K signatures can be identified for reporting, but JPEG 2000 wavelet decoding/export is not implemented.",
    limitations: ["No codestream decoder, alpha/channel box handling, color box conversion, or JPEG 2000 writer."],
    recommendedAction: "Convert JPEG 2000 assets before import or add a dedicated codec.",
    testCoverage: "unit",
  },
  {
    id: "format.tga-pnm",
    label: "TGA and Portable AnyMap",
    kind: "format",
    status: "usable",
    summary: "Decodes TGA true-color/grayscale/indexed RLE data plus PBM/PGM/PPM/PNM ASCII and binary rasters.",
    limitations: ["Imports resolve to browser 8-bit RGBA layers; source comments and format-specific export metadata are not round-tripped."],
    testCoverage: "unit",
  },
  {
    id: "format.radiance-hdr",
    label: "Radiance HDR",
    kind: "format",
    status: "approximation",
    summary: "Creates tone-mapped 8-bit previews for supported RGBE data.",
    limitations: ["No scene-linear editing or true HDR output."],
    testCoverage: "reachability",
  },
  {
    id: "format.dicom",
    label: "DICOM",
    kind: "format",
    status: "approximation",
    summary: "Creates limited 8-bit previews for simple uncompressed pixel data.",
    limitations: ["No compressed transfer syntaxes, windowing presets, overlays, or patient workflow support."],
    testCoverage: "reachability",
  },
  {
    id: "export.browser-raster",
    label: "Browser Raster Export",
    kind: "export",
    status: "usable",
    summary: "Exports browser canvas encodings for supported MIME types.",
    limitations: ["Cannot embed metadata, ICC profiles, progressive JPEG settings, or interlaced PNG chunks."],
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
    summary: "Local browser decoded layer merge workflow, not a lens-aware panorama engine.",
    limitations: ["No camera model, lens correction, or robust feature matching parity."],
    recommendedAction: "Use for simple local stack workflows only.",
    testCoverage: "reachability",
  },
  {
    id: "workflow.hdr-merge",
    label: "HDR Merge",
    kind: "workflow",
    status: "approximation",
    summary: "Local approximation over 8-bit decoded images.",
    limitations: ["No RAW exposure stack or scene-linear HDR merge engine."],
    testCoverage: "reachability",
  },
  {
    id: "workflow.content-aware-scale",
    label: "Content-Aware Scale",
    kind: "workflow",
    status: "approximation",
    summary: "Uses local seam carving with explicit fallback for large reductions.",
    limitations: ["Large changes can fall back to resampling.", "No Photoshop protected skin-tone/object models."],
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
    status: "approximation",
    summary: "Canvas pooling, history patches, pixel batch reads, worker filters, and tiled filter execution reduce large-image stalls.",
    limitations: ["No PSB-scale persistent tiled backing store."],
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
    "Browser encoders cannot embed metadata, ICC profiles, progressive JPEG scan settings, or interlaced PNG chunks.",
  ))

  return warnings
}

export function capabilitiesForIds(ids: readonly string[]) {
  return ids.map(getCapability).sort((a, b) => capabilityStatusRank(a.status) - capabilityStatusRank(b.status))
}
