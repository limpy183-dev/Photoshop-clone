import { capabilityWarningsForDocument } from "./capabilities"
import { validateClippingGroup } from "./psd-channels-masks"
import { planTileOnlyExport } from "./tile-only-pipeline"
import type { ColorProfileName, DocumentReport, PsDocument } from "./types"
import type {
  CompatibilityManifest,
  CompatibilityManifestEntry,
  CompatibilityTarget,
  ExportCompatibilityFixAction,
  ExportCompatibilityManifest,
  ExportCompatibilityPreservationSummary,
  ExportCompatibilityScoreCategory,
  ExportCompatibilityScoreCategoryId,
  ExportLimitationOptions,
  ExportLimitationReport,
  ReportStatus,
} from "./document-io-types"

function rasterExportOutputProfile(doc: PsDocument): ColorProfileName | null {
  const color = doc.colorManagement
  if (!color) return null
  if (color.proofColors && color.proofProfile !== "None") return color.proofProfile
  return color.workingSpace ?? color.assignedProfile ?? "sRGB IEC61966-2.1"
}

const REPORT_STATUSES: ReportStatus[] = ["preserved", "approximated", "flattened", "unsupported", "info"]

function reportTotals(entries: CompatibilityManifestEntry[]): Record<ReportStatus, number> {
  const totals = Object.fromEntries(REPORT_STATUSES.map((status) => [status, 0])) as Record<ReportStatus, number>
  for (const entry of entries) totals[entry.status] += 1
  return totals
}

function reportPlural(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function compatibilityStatus(
  target: CompatibilityTarget,
  project: ReportStatus,
  psd: ReportStatus,
  raster: ReportStatus,
) {
  return target === "project" ? project : target === "psd" ? psd : raster
}

function manifestTargetLabel(target: CompatibilityTarget) {
  if (target === "project") return "project format"
  if (target === "psd") return "PSD round trip"
  return "browser raster export"
}

function compatibilityTargetForSource(source: DocumentReport["source"]): CompatibilityTarget {
  if (source.includes("Project")) return "project"
  if (source.includes("PSD")) return "psd"
  return "browser-raster"
}

export function createCompatibilityManifest(
  doc: PsDocument,
  target: CompatibilityTarget,
): CompatibilityManifest {
  const entries: CompatibilityManifestEntry[] = []
  const layers = doc.layers
  const textLayers = layers.filter((layer) => layer.kind === "text").length
  const shapeLayers = layers.filter((layer) => layer.kind === "shape").length
  const smartObjectLayers = layers.filter((layer) => layer.kind === "smart-object" || layer.smartObject)
  const smartObjectSources = smartObjectLayers.filter((layer) => layer.smartSource).length
  const linkedSmartObjects = smartObjectLayers.filter((layer) => layer.smartSource?.linkType === "linked").length
  const smartObjectEditPackages = smartObjectLayers.filter((layer) => layer.smartSource?.editPackage).length
  const smartObjectFileHandles = smartObjectLayers.filter((layer) => layer.smartSource?.fileHandleName || layer.smartSource?.handlePermission).length
  const adjustmentLayers = layers.filter((layer) => layer.kind === "adjustment").length
  const smartFilters = layers.reduce((sum, layer) => sum + (layer.smartFilters?.length ?? 0), 0)
  const smartFilterMasks = layers.reduce((sum, layer) => sum + (layer.smartFilters?.filter((filter) => filter.mask || filter.maskEnabled === false).length ?? 0), 0)
  const maskedLayers = layers.filter((layer) => layer.mask || layer.vectorMask).length
  const layerNotes = layers.reduce((sum, layer) => sum + (layer.notes?.length ?? 0), 0)
  const layerMetadata = layers.filter((layer) => layer.metadata).length
  const styledLayers = layers.filter((layer) => layer.style).length
  const groupLayers = layers.filter((layer) => layer.kind === "group").length
  const blendModes = [...new Set(layers.map((layer) => layer.blendMode).filter((mode) => mode && mode !== "normal"))]
  const threeDLayers = layers.filter((layer) => layer.kind === "3d").length
  const videoLayers = layers.filter((layer) => layer.kind === "video").length
  const exportPresets = (doc.assetLibrary ?? []).filter((asset) => asset.kind === "export").length
  const pluginAssets = (doc.assetLibrary ?? []).filter((asset) => asset.kind === "plugin" || asset.kind === "cloud-library").length
  const profile = doc.colorManagement?.assignedProfile
  const specialMode = doc.colorMode !== "RGB" || doc.bitDepth > 8

  const add = (
    label: string,
    project: ReportStatus,
    psd: ReportStatus,
    raster: ReportStatus,
    details: Record<CompatibilityTarget, string>,
  ) => {
    entries.push({
      label,
      status: compatibilityStatus(target, project, psd, raster),
      detail: details[target],
    })
  }

  add("Canvas", "preserved", "preserved", "preserved", {
    project: `${doc.width} x ${doc.height}px canvas, background, resolution, mode, and bit-depth metadata are serialized.`,
    psd: `${doc.width} x ${doc.height}px rendered layer pixels are written with PSD-compatible canvas metadata.`,
    "browser-raster": `${doc.width} x ${doc.height}px composite pixels are exported through the browser encoder when they fit, or through the tile-sequence package path for oversized compatible documents.`,
  })
  add("Layer structure", "preserved", "approximated", "flattened", {
    project: `${reportPlural(layers.length, "layer")} retain app layer kind, visibility, opacity, locks, blend mode, and selection state.`,
    psd: `${reportPlural(layers.length, "layer")} are mapped to PSD layers where possible; app-only descriptors stay in the preservation report.`,
    "browser-raster": `${reportPlural(layers.length, "layer")} are composited into flattened export pixels; large compatible exports can be emitted as independently composed tiles.`,
  })
  if (textLayers) add("Text layers", "preserved", "preserved", "flattened", {
    project: `${reportPlural(textLayers, "editable text layer")} retain typography, OpenType, path, shape, and extrusion metadata.`,
    psd: `${reportPlural(textLayers, "editable text layer")} round-trip through native PSD text engine descriptors; extended properties (variable axes, OpenType features, on-path geometry) are mirrored into the PSD XMP app-preservation payload, with layer-name markers retained only as a legacy fallback.`,
    "browser-raster": "Text is rasterized into the flattened export surface.",
  })
  if (shapeLayers) add("Shape layers", "preserved", "preserved", "flattened", {
    project: `${reportPlural(shapeLayers, "shape layer")} retain geometry, stroke, fill, radius, and custom-shape metadata.`,
    psd: `${reportPlural(shapeLayers, "shape layer")} round-trip as vector masks with native fill/stroke descriptors; custom-shape parameters and per-subpath metadata are mirrored into the PSD XMP app-preservation payload, with name markers retained only as a fallback.`,
    "browser-raster": "Vector shape geometry is rasterized into the flattened export surface.",
  })
  if (groupLayers) add("Groups", "preserved", "approximated", "flattened", {
    project: `${reportPlural(groupLayers, "group")} retain child relationship metadata, visibility, expanded state, and group opacity.`,
    psd: "Group child relationship metadata is mapped to PSD layer folders where possible; app-only group state is approximated.",
    "browser-raster": "Groups are flattened into the composite pixel result.",
  })
  if (blendModes.length) add("Blend modes", "preserved", "approximated", "flattened", {
    project: `Non-normal blend modes retained: ${blendModes.join(", ")}.`,
    psd: `PSD blend modes are mapped by name where possible; unsupported renderer differences are approximated for: ${blendModes.join(", ")}.`,
    "browser-raster": `Blend modes (${blendModes.join(", ")}) affect the flattened composite only.`,
  })
  if (maskedLayers) add("Masks", "preserved", "approximated", "flattened", {
    project: `${reportPlural(maskedLayers, "mask")} retain raster/vector mask metadata and pixels.`,
    psd: "Layer mask pixels are exported where compatible; vector/app mask metadata is approximated.",
    "browser-raster": "Masks affect the composite only; editable masks are not exported.",
  })
  if (layerNotes || layerMetadata) add("Layer notes and metadata", "preserved", "preserved", "unsupported", {
    project: `${reportPlural(layerNotes, "layer note")} and ${reportPlural(layerMetadata, "metadata-bearing layer")} retain searchable app-only annotations, tags, and custom key/value fields.`,
    psd: "Layer-level notes, tags, and custom key/value metadata are restored by this app from the PSD XMP app-preservation payload; they are not Photoshop-native layer records.",
    "browser-raster": "Layer-level notes and metadata are editor metadata and are omitted from flattened image exports.",
  })
  if (styledLayers) add("Layer styles", "preserved", "preserved", "flattened", {
    project: `${reportPlural(styledLayers, "styled layer")} retain editable effect settings.`,
    psd: `${reportPlural(styledLayers, "styled layer")} round-trip native PSD effects (drop/inner shadow, outer/inner glow, bevel, satin, color/gradient/pattern overlay, stroke) with global-light tracking.`,
    "browser-raster": "Layer styles are baked into the exported pixels.",
  })
  if (adjustmentLayers) add("Adjustment layers", "preserved", "approximated", "flattened", {
    project: `${reportPlural(adjustmentLayers, "adjustment layer")} retain non-destructive settings.`,
    psd: `${reportPlural(adjustmentLayers, "adjustment layer")} round-trip; 16 types (brightness-contrast, levels, curves, exposure, vibrance, hue-saturation, color-balance, black-white, photo-filter, channel-mixer, color-lookup, invert, posterize, threshold, gradient-map, selective-color) use native ag-psd descriptors. 6 unsupported types (shadows-highlights, hdr-toning, desaturate, match-color, replace-color, equalize) preserve editable params in the PSD XMP app-preservation payload, with layer-name tokens retained as fallback.`,
    "browser-raster": "Adjustments are baked into the flattened export pixels.",
  })
  if (smartFilters) add("Smart filters", "preserved", "approximated", "flattened", {
    project: `${reportPlural(smartFilters, "smart filter")} retain filter id, parameters, stack order, masks, opacity, blend mode, mask density, mask feather, and mask link state${smartFilterMasks ? `, including ${reportPlural(smartFilterMasks, "filter mask state")}` : ""}.`,
    psd: `${reportPlural(smartFilters, "smart filter")} bake their visual result into layer pixels for native compatibility, emit native placed-filter descriptors and filter-effect masks where ag-psd exposes them, and restore private app control state from the PSD XMP app-preservation payload.`,
    "browser-raster": "Smart filters are baked into the flattened export pixels.",
  })
  if (smartObjectLayers.length) add("Smart objects", "preserved", "approximated", "flattened", {
    project: `${reportPlural(smartObjectLayers.length, "smart object")} retain object layer records and transform state.`,
    psd: "Smart object layers export as compatible rendered layers with source limitations reported.",
    "browser-raster": "Smart objects are flattened to their current rendered pixels.",
  })
  if (smartObjectSources) add("Smart object sources", "preserved", "approximated", "flattened", {
    project: `${reportPlural(smartObjectSources, "smart source")} retain source canvas, link status, file name, relink metadata, exported-content timestamps, and edit-package descriptors${smartObjectEditPackages ? ` for ${reportPlural(smartObjectEditPackages, "package")}` : ""}.`,
    psd: `${reportPlural(smartObjectSources, "smart source")} round-trip via the native PSD placedLayer (PlLd/SoLd) descriptor + linkedFiles array; embedded PNG bytes are capped at 30 MB per source; ids are hashed to GUIDs the writer requires.`,
    "browser-raster": "Source documents are not included in browser raster exports.",
  })
  if (smartObjectFileHandles) add("File System Access links", "preserved", "unsupported", "unsupported", {
    project: `${reportPlural(smartObjectFileHandles, "smart object file handle reference")} retain handle name, permission status, file modified time, and content hash when available; live FileSystemFileHandle objects are intentionally not serialized.`,
    psd: "Browser File System Access handles cannot be represented in native PSD bytes.",
    "browser-raster": "Linked source handles are omitted from flattened image exports.",
  })
  if (linkedSmartObjects) add("Linked smart object references", "preserved", "approximated", "flattened", {
    project: `${reportPlural(linkedSmartObjects, "linked smart object reference")} retain local path/status metadata, source hashes, permission state, and relink/update timestamps.`,
    psd: "Native placedLayer/linkedFiles records carry the linked path and source id, while live browser File System Access handles and permission grants must be restored by relinking in this app.",
    "browser-raster": "Linked source references are flattened to the current rendered pixels.",
  })
  if (doc.channels?.length) add("Alpha and saved channels", "preserved", "preserved", "unsupported", {
    project: `${reportPlural(doc.channels.length, "saved channel")} retain editable channel pixels.`,
    psd: `${reportPlural(doc.channels.length, "saved channel")} round-trip through a hidden marker group; native PSD alphaChannelNames carries the names and spot channels use a [spot:#rrggbb:opacity] naming convention.`,
    "browser-raster": "Extra channels, spot channels, and saved alpha channels are not emitted by browser raster encoders.",
  })
  if (doc.comps?.length) add("Layer comps", "preserved", "approximated", "unsupported", {
    project: `${reportPlural(doc.comps.length, "layer comp")} retain appearance snapshots.`,
    psd: `${reportPlural(doc.comps.length, "layer comp")} export as native PSD layer comps (flags + comment); per-layer state snapshots embed as base64 JSON in the comment for round-trip.`,
    "browser-raster": "Layer comps are not included in flattened image exports.",
  })
  if (doc.guides?.length) add("Guides", "preserved", "unsupported", "unsupported", {
    project: `${reportPlural(doc.guides.length, "guide")} retain orientation, position, and color.`,
    psd: `${reportPlural(doc.guides.length, "guide")} are written to gridAndGuidesInformation but Photoshop discards guides on import from non-native sources.`,
    "browser-raster": "Guides are non-printing editor metadata and are omitted.",
  })
  if (doc.slices?.length) add("Slices", "preserved", "unsupported", "unsupported", {
    project: `${reportPlural(doc.slices.length, "slice")} retain web export regions and selected slice state.`,
    psd: `${reportPlural(doc.slices.length, "slice")} are written through the PSD slices image resource but legacy slice tooling is removed from current Photoshop versions.`,
    "browser-raster": "Slices are not included in single-image browser exports.",
  })
  if (exportPresets) add("Export presets", "preserved", "unsupported", "unsupported", {
    project: `${reportPlural(exportPresets, "export preset")} retain reusable settings in the asset library.`,
    psd: "Export preset metadata is not a native PSD export payload.",
    "browser-raster": "Export presets are editor metadata and are omitted from the exported image.",
  })
  if (doc.timelineFrames?.length || videoLayers) add("Timeline and video", "preserved", "approximated", "flattened", {
    project: `${reportPlural(doc.timelineFrames?.length ?? videoLayers, "timeline entry", "timeline entries")} retain frame, video, transition, keyframe, and audio metadata.`,
    psd: "Timeline/video records are reported and represented by poster/current-frame pixels where possible.",
    "browser-raster": "Video and animation state is flattened to the current composite frame unless a dedicated animation exporter is used.",
  })
  if (threeDLayers) add("3D scenes", "preserved", "approximated", "flattened", {
    project: `${reportPlural(threeDLayers, "3D layer")} retain browser-native scene, mesh, material, camera, and print-check metadata.`,
    psd: "3D scene metadata is reported and represented by rendered layer pixels.",
    "browser-raster": "3D layers are flattened to their current rendered preview.",
  })
  if (doc.plugins?.length || pluginAssets) add("Plugin and cloud descriptors", "preserved", "unsupported", "unsupported", {
    project: `${reportPlural((doc.plugins?.length ?? 0) + pluginAssets, "plugin/library descriptor")} retain local integration metadata.`,
    psd: "Plugin, cloud-library, and extension descriptors are not authored as native PSD resources.",
    "browser-raster": "Plugin and library metadata is omitted from exported images.",
  })
  if (doc.variableDataSets?.length) add("Variable data", "preserved", "unsupported", "unsupported", {
    project: `${reportPlural(doc.variableDataSets.length, "variable data set")} retain rows, bindings, and active row state.`,
    psd: "Variable data sets are app-only metadata in this implementation.",
    "browser-raster": "Variable data is omitted from flattened image exports.",
  })
  if (doc.metadata) add("File metadata", "preserved", "preserved", "approximated", {
    project: "IPTC-style metadata and local content credentials are serialized.",
    psd: "Document metadata round-trips through the native PSD XMP image resource; IPTC/EXIF blobs are built for sidecar use but not surfaced by ag-psd's public ImageResources type.",
    "browser-raster": "Raster exports embed supported metadata when Embed Metadata is enabled: PNG/JPEG/TIFF/WebP/AVIF use XMP-style payloads, TIFF also writes IPTC/EXIF directories, and TGA/Netpbm use native comments/developer metadata.",
  })
  if (doc.printSettings) add("Print settings", "preserved", "preserved", "unsupported", {
    project: `${doc.printSettings.paperSize} print setup, marks, bleed, and color-handling metadata retained.`,
    psd: "Print settings round-trip through the native printScale + printFlags resources; paper size, orientation, and bleed are recovered via an embedded JSON extra payload.",
    "browser-raster": "Print settings are non-printing editor metadata and are omitted from raster exports.",
  })
  if (doc.notes?.length) add("Notes", "preserved", "preserved", "unsupported", {
    project: `${reportPlural(doc.notes.length, "note")} retain author, text, position, and color metadata.`,
    psd: `${reportPlural(doc.notes.length, "note")} round-trip through the native PSD annotations records.`,
    "browser-raster": "Notes are editor metadata and are omitted from raster exports.",
  })
  if (doc.dpi || doc.globalLight) add("Resolution and global light", "preserved", "preserved", "approximated", {
    project: `${doc.dpi ? `${doc.dpi} DPI` : "Default resolution"} and global light (${doc.globalLight?.angle ?? 30}°/${doc.globalLight?.altitude ?? 30}°) are retained.`,
    psd: "Resolution round-trips through resolutionInfo; global light angle/altitude round-trip through globalAngle/globalAltitude resources and inform layer effects.",
    "browser-raster": "Resolution is metadata; raster encoders may include a DPI chunk but never global-light data.",
  })
  if (doc.colorManagement || specialMode) add("Color and bit depth", "preserved", "approximated", "approximated", {
    project: `${doc.colorMode}/${doc.bitDepth}-bit intent${profile ? ` with ${profile}` : ""} is retained as document metadata.`,
    psd: `${doc.colorMode}/${doc.bitDepth}-bit metadata round-trips through colorMode/bitsPerChannel; ICC profile bytes round-trip through the iccProfile resource. High-bit side-band pixels are retained by the project format while PSD-compatible pixels are rasterized for native handoff.`,
    "browser-raster": doc.bitDepth > 8
      ? `${doc.colorMode}/${doc.bitDepth}-bit typed-array pixels are preserved by TIFF/PNM high-bit export paths where supported; browser-native formats use the 8-bit preview.`
      : `${doc.colorMode}/${doc.bitDepth}-bit intent is converted through browser RGBA export; ICC profiles are embedded for PNG/JPEG/TIFF/WebP and recorded in AVIF/TGA/Netpbm metadata where requested.`,
  })

  const totals = reportTotals(entries)
  const summary = `${manifestTargetLabel(target)}: ${totals.preserved} preserved, ${totals.approximated} approximated, ${totals.flattened} flattened, ${totals.unsupported} unsupported.`
  return { target, entries, totals, summary }
}

export function createExportLimitationReport(
  doc: PsDocument,
  options: ExportLimitationOptions,
): ExportLimitationReport {
  const items: CompatibilityManifestEntry[] = []
  const format = options.format
  const layers = doc.layers.length
  const hasEditableVectors = doc.layers.some((layer) => layer.kind === "shape" || layer.vectorMask)
  const hasEditableText = doc.layers.some((layer) => layer.kind === "text")
  const hasExtraChannels = (doc.channels?.length ?? 0) > 0 || doc.colorMode === "Multichannel"
  const highBitOrNonRgb = doc.bitDepth > 8 || doc.colorMode !== "RGB"
  const metadataRequested = !!options.includeMetadata
  const profile = doc.colorManagement?.assignedProfile
  const highBitPreservingFormat = doc.bitDepth > 8 && (
    format === "tiff" ||
    format === "ppm" ||
    format === "pgm"
  )

  const add = (label: string, status: ReportStatus, detail: string) => {
    items.push({ label, status, detail })
  }

  if (format === "metadata-json") {
    add("Metadata sidecar", "preserved", "Exports document metadata, color management, print settings, layer descriptors, channels, slices, timeline frames, and compatibility reports as structured JSON.")
    add("Layer descriptors", "preserved", `${reportPlural(layers, "layer")} are described without baking pixel data into the sidecar.`)
    if (doc.timelineFrames?.length) add("Timeline frame descriptors", "preserved", `${reportPlural(doc.timelineFrames.length, "timeline frame")} retain names, durations, and transition metadata.`)
    if (doc.slices?.length) add("Slice descriptors", "preserved", `${reportPlural(doc.slices.length, "slice")} retain web-export bounds and names.`)
    if (doc.channels?.length) add("Channel descriptors", "preserved", `${reportPlural(doc.channels.length, "channel")} retain channel names and visibility flags.`)
    const totals = reportTotals(items)
    return {
      format,
      items,
      summary: `${format.toUpperCase()} export limitations: ${totals.flattened} flattened, ${totals.approximated} approximated, ${totals.unsupported} unsupported.`,
    }
  }

  const rasterLikeFormat = format !== "svg" && format !== "apng" && format !== "animated-webp"
  if (rasterLikeFormat) {
    const tileExportPlan = planTileOnlyExport({
      documentWidth: doc.width,
      documentHeight: doc.height,
      format,
      scale: 1,
      tileSize: 1024,
      layers: doc.layers.map((layer) => ({ id: layer.id, kind: layer.kind, visible: layer.visible })),
    })
    if (tileExportPlan.mode === "tile-stream" && tileExportPlan.tileCount > 1) {
      add(
        "Tile-only export execution",
        "preserved",
        `${format.toUpperCase()} can be exported as ${tileExportPlan.tileCount} independently composited ${tileExportPlan.tileSize}px tiles with a manifest, avoiding a ${doc.width} x ${doc.height}px canvas allocation.`,
      )
    } else if (tileExportPlan.unsupportedLayerIds.length) {
      add(
        "Tile-only export execution",
        "approximated",
        `Tile-sequence export is blocked by unsupported layer payloads (${tileExportPlan.unsupportedLayerIds.join(", ")}); browser canvas export remains the fallback.`,
      )
    }
  }

  add("Layer structure", "flattened", `${reportPlural(layers, "layer")} are composited into the exported ${format.toUpperCase()} result.`)
  if (hasEditableText) add("Editable text", "flattened", "Text remains editable in the project format, but browser image exports contain rasterized glyph pixels.")
  if (hasEditableVectors || format === "svg") {
    add("Editable vector structure", format === "svg" ? "approximated" : "flattened", format === "svg"
      ? "SVG export embeds the rendered document for visual reliability and emits simple shape/text layer elements where browser-safe geometry is available."
      : "Shape and vector-mask geometry is baked into browser raster pixels.")
  }
  if (doc.bitDepth > 8 && highBitPreservingFormat) {
    add(
      "High-bit sample export",
      format === "tiff" ? "preserved" : "approximated",
      format === "tiff"
        ? `${doc.bitDepth}-bit typed-array pixels are encoded directly into TIFF sample data before any 8-bit preview fallback.`
        : `${doc.bitDepth}-bit typed-array pixels are encoded into 16-bit Netpbm samples, preserving more precision than the browser canvas preview.`,
    )
  }
  if (doc.colorMode !== "RGB" || (highBitOrNonRgb && !highBitPreservingFormat)) {
    add(
      "RGBA export conversion",
      "approximated",
      doc.bitDepth > 8 && !highBitPreservingFormat
        ? `${doc.colorMode}/${doc.bitDepth}-bit document intent is flattened through browser 8-bit RGBA canvas data.`
        : `${doc.colorMode} document intent is composited into RGB export pixels; editable source color-model channels are not embedded.`,
    )
  }
  if (hasExtraChannels) {
    add("Spot and extra channels", "unsupported", "Spot, alpha, and multichannel data are not embedded by browser raster encoders.")
  }
  if (profile || doc.colorManagement) {
    const outputProfile = rasterExportOutputProfile(doc) ?? profile ?? "sRGB IEC61966-2.1"
    add("ICC profile conversion", "preserved", `Export pixels are converted from ${profile ?? "sRGB IEC61966-2.1"} to ${outputProfile} through the browser-local ICC transform engine before encoding.`)
    add(
      "ICC profile embedding",
      format === "png" || format === "jpeg" || format === "tiff" || format === "webp" || format === "avif" || format === "tga" || format === "ppm" || format === "pgm" || format === "pbm" ? "preserved" : "unsupported",
      format === "png"
        ? `${outputProfile} is embedded in an iCCP chunk alongside the converted pixels.`
        : format === "jpeg"
          ? `${outputProfile} is embedded in JPEG APP2 ICC_PROFILE segment(s) alongside the converted pixels.`
          : format === "tiff"
            ? `${outputProfile} is embedded in TIFF tag 34675 alongside the converted pixels.`
            : format === "webp"
              ? `${outputProfile} is embedded in a WebP ICCP chunk and the VP8X ICC flag is set when available.`
              : format === "avif"
                ? `${outputProfile} is embedded in an AVIF UUID metadata box alongside the encoded payload.`
                : format === "tga"
                  ? `${outputProfile} is recorded in TGA developer metadata alongside the exported pixels.`
                  : format === "ppm" || format === "pgm" || format === "pbm"
                    ? `${outputProfile} is recorded in Netpbm comments alongside the exported samples.`
                    : `${outputProfile} conversion is applied to pixels, but this export encoder does not carry an ICC profile payload.`,
    )
  }
  if (metadataRequested) {
    add("Metadata embedding", format === "png" || format === "jpeg" || format === "tiff" || format === "webp" || format === "avif" || format === "tga" || format === "ppm" || format === "pgm" || format === "pbm" ? "preserved" : format === "svg" ? "approximated" : "unsupported", format === "png"
      ? "PNG export embeds author, copyright, description, creation date, XMP text chunks, and C2PA caBX provenance chunks."
      : format === "jpeg"
        ? "JPEG export embeds XMP APP1 metadata and C2PA APP11 provenance payloads."
        : format === "tiff"
          ? "TIFF export embeds baseline text tags, IPTC tag 33723, XMP tag 700, EXIF IFD tag 34665, ICC tag 34675, C2PA tag 52545, and local content credentials."
          : format === "webp"
            ? "WebP export injects XMP, C2PA, and ICC RIFF chunks when the browser returns a real WebP container."
            : format === "avif"
              ? "AVIF export inserts C2PA and appends XMP/ICC UUID boxes when the browser returns a real AVIF container."
              : format === "tga"
                ? "TGA export writes a TGA 2.0 extension area plus a developer metadata record."
                : format === "ppm" || format === "pgm" || format === "pbm"
                  ? "Netpbm export writes comments and source max-value metadata in the file header."
        : format === "svg"
          ? "SVG export includes a compact app metadata block, not full IPTC/XMP/content-credential payloads."
          : "This format does not carry the app's export metadata fields.")
    if (doc.metadata?.contentCredentials?.length) {
      add("Content Credentials", "preserved", `${reportPlural(doc.metadata.contentCredentials.length, "local content credential")} are embedded in C2PA carrier payloads plus app XMP/metadata records; they are unsigned local manifests, not certificate-backed C2PA signatures.`)
    }
  }

  if (format === "png") {
    if (options.interlaced) add("Interlaced PNG", "preserved", "The app writes Adam7 interlaced PNG scan passes with its typed-array PNG encoder.")
    add("PNG color chunks", profile || doc.colorManagement ? "preserved" : "unsupported", profile || doc.colorManagement
      ? "PNG export authors an iCCP profile chunk for the selected output profile."
      : "PNG export does not author gAMA/cHRM/iCCP color chunks without an assigned output profile.")
  } else if (format === "jpeg") {
    if (options.progressive) add("Progressive JPEG", "preserved", "The app routes JPEG export through the MozJPEG progressive encoder.")
    if (options.transparent !== false) add("Alpha transparency", "flattened", "JPEG has no alpha channel; transparent pixels are composited against the selected matte.")
    add("JPEG quality", "approximated", `Requested quality ${Math.round(Number(options.quality ?? 92))}% is passed to the selected JPEG encoder; exact quantization remains encoder-defined.`)
  } else if (format === "tiff") {
    add("TIFF encoder", "preserved", doc.bitDepth > 8
      ? `Exports typed-array RGBA TIFF strips at ${doc.bitDepth} bits per channel with ${(options.tiffCompression ?? "none").toUpperCase()} compression.`
      : `Exports baseline RGBA TIFF strips with ${(options.tiffCompression ?? "none").toUpperCase()} compression.`)
    add("TIFF metadata", metadataRequested ? "preserved" : "info", metadataRequested
      ? "TIFF export writes ImageDescription, DateTime, Artist, Copyright, IPTC, XMP, EXIF, ICC, and C2PA metadata tags."
      : "Enable metadata to write TIFF ImageDescription, DateTime, Artist, Copyright, IPTC, XMP, EXIF, ICC, and C2PA tags.")
  } else if (format === "webp") {
    add("WebP encoder controls", "approximated", "Browser WebP exposes quality to the encoder; lossless, near-lossless, method, and exact-alpha intent are authored into the XMP encoder-control record and preset state for downstream tools.")
    add("WebP metadata", metadataRequested ? "preserved" : "info", metadataRequested
      ? "The app post-processes browser WebP bytes to add XMP and C2PA RIFF chunks and set the VP8X metadata flag when possible."
      : "Enable metadata to post-process real browser WebP bytes with XMP and C2PA RIFF chunks.")
  } else if (format === "avif") {
    add("AVIF encoder controls", "approximated", "Browser AVIF exposes limited quality intent; lossless, speed, bit-depth, chroma, and tile intent are authored into the XMP encoder-control record and preset state for downstream tools.")
    add("AVIF metadata", metadataRequested ? "preserved" : "info", metadataRequested
      ? "The app inserts a C2PA UUID box and appends XMP UUID metadata to AVIF ISOBMFF output when the browser encoder returns AVIF bytes."
      : "Enable metadata to insert C2PA and XMP UUID metadata boxes into real browser AVIF bytes.")
  } else if (format === "gif") {
    add("GIF palette", "approximated", "GIF export quantizes to a 256-color indexed palette with limited transparency.")
    if (doc.timelineFrames?.length) add("Frame animation", "approximated", "Timeline frames can be converted to GIF frames, but advanced video/audio metadata is not retained.")
  } else if (format === "svg") {
    add("SVG image wrapper", "info", "The SVG stores the current rendered document as an embedded raster image for visual round-trip reliability.")
    add("SVG layer metadata", options.includeMetadata ? "preserved" : "info", options.includeMetadata
      ? "A compact app metadata block records document dimensions and layer descriptors."
      : "Enable metadata to include document dimensions and layer descriptors.")
  } else if (format === "tga") {
    add("TGA encoder", "preserved", options.tgaRle ? "Exports RLE-compressed 32-bit top-left TGA pixels with alpha." : "Exports uncompressed 32-bit top-left TGA pixels with alpha.")
    add("TGA metadata", metadataRequested ? "preserved" : "info", metadataRequested
      ? "TGA export writes a 2.0 extension area and a developer-directory JSON metadata record."
      : "Enable metadata to write a TGA 2.0 extension area and developer-directory metadata.")
  } else if (format === "ppm" || format === "pgm" || format === "pbm") {
    add("Portable AnyMap encoder", "preserved", doc.bitDepth > 8 && format !== "pbm"
      ? `${format.toUpperCase()} export writes binary high-bit typed-array samples in the matching Netpbm family format.`
      : `${format.toUpperCase()} export writes binary browser-generated pixels in the matching Netpbm family format.`)
    add("Portable AnyMap metadata", metadataRequested ? "preserved" : "info", metadataRequested
      ? "Netpbm export writes comments and source max-value metadata in the header."
      : "Enable metadata to write Netpbm comments and source max-value metadata.")
  } else if (format === "apng") {
    add("APNG encoder", "preserved", "Exports PNG/APNG chunks with RGBA frames and per-frame delays.")
    add("Frame animation", "preserved", doc.timelineFrames?.length
      ? `${reportPlural(doc.timelineFrames.length, "timeline frame")} are encoded as APNG frames.`
      : "Single-frame APNG export is available when no timeline frames exist.")
    add("APNG optimization", "approximated", "Frames are stored as full-frame RGBA payloads instead of delta-optimized animation rectangles.")
  } else if (format === "animated-webp") {
    add("Animated WebP encoder", "approximated", "Browser Canvas encodes still WebP frames and the app wraps them into a RIFF WebP animation with VP8X, ANIM, and ANMF chunks.")
    add("Frame animation", doc.timelineFrames?.length ? "preserved" : "info", doc.timelineFrames?.length
      ? `${reportPlural(doc.timelineFrames.length, "timeline frame")} are encoded as animated WebP frames when the browser static WebP encoder is available.`
      : "Single-frame animated WebP export is available when no timeline frames exist.")
  }

  const totals = reportTotals(items)
  return {
    format,
    items,
    summary: `${format.toUpperCase()} export limitations: ${totals.flattened} flattened, ${totals.approximated} approximated, ${totals.unsupported} unsupported.`,
  }
}

const EXPORT_SCORE_CATEGORIES: Array<{
  id: ExportCompatibilityScoreCategoryId
  label: string
  matches: RegExp
}> = [
  { id: "layers", label: "Layers", matches: /layer structure|groups|layer comps/i },
  { id: "masks", label: "Masks", matches: /masks|alpha and saved channels|spot and extra channels|alpha transparency/i },
  { id: "text", label: "Text", matches: /text|editable text/i },
  { id: "effects", label: "Effects", matches: /layer styles|adjustment layers|smart filters|blend modes|3d scenes|timeline and video/i },
  { id: "color", label: "Color", matches: /color|bit depth|high-bit|rgba export conversion|icc|gif palette|jpeg quality|webp encoder|avif encoder|portable anymap/i },
  { id: "metadata", label: "Metadata", matches: /metadata|content credentials|print settings|notes|guides|slices|export presets|plugin and cloud|variable data|resolution/i },
  { id: "smart-objects", label: "Smart Objects", matches: /smart object|linked smart|file system access/i },
]

function entryScore(status: ReportStatus) {
  switch (status) {
    case "preserved":
      return 100
    case "info":
      return 92
    case "approximated":
      return 68
    case "flattened":
      return 45
    case "unsupported":
      return 20
  }
}

function scoreStatus(score: number): ExportCompatibilityScoreCategory["status"] {
  if (score >= 85) return "strong"
  if (score >= 60) return "mixed"
  return "risky"
}

function buildExportCompatibilityScore(entries: CompatibilityManifestEntry[]) {
  const categories = EXPORT_SCORE_CATEGORIES.map((category): ExportCompatibilityScoreCategory => {
    const categoryEntries = entries.filter((entry) => category.matches.test(entry.label))
    const score = categoryEntries.length
      ? Math.round(categoryEntries.reduce((sum, entry) => sum + entryScore(entry.status), 0) / categoryEntries.length)
      : 100
    const risky = categoryEntries.filter((entry) => entry.status === "flattened" || entry.status === "unsupported" || entry.status === "approximated")
    return {
      id: category.id,
      label: category.label,
      score,
      status: scoreStatus(score),
      detail: risky.length
        ? `${risky.slice(0, 3).map((entry) => `${entry.label} ${entry.status}`).join("; ")}${risky.length > 3 ? "; ..." : ""}`
        : "Preserved for this export target.",
    }
  })
  const overall = Math.round(categories.reduce((sum, category) => sum + category.score, 0) / categories.length)
  return { overall, categories }
}

function buildExportPreservationSummary(
  entries: CompatibilityManifestEntry[],
  options: ExportLimitationOptions,
): ExportCompatibilityPreservationSummary {
  const changedStatuses = new Set<ReportStatus>(["approximated", "flattened", "unsupported"])
  const metadataEmbeddingPreserved = entries.some((entry) => entry.label === "Metadata embedding" && entry.status === "preserved")
  const preserved = entries.filter((entry) =>
    entry.status === "preserved" ||
    entry.status === "info" ||
    (entry.label === "File metadata" && metadataEmbeddingPreserved && options.includeMetadata),
  )
  const changed = entries.filter((entry) => changedStatuses.has(entry.status))
  return {
    preserved: dedupeManifestEntries(preserved),
    changed: dedupeManifestEntries(changed),
  }
}

function dedupeManifestEntries(entries: CompatibilityManifestEntry[]) {
  const seen = new Set<string>()
  const out: CompatibilityManifestEntry[] = []
  for (const entry of entries) {
    const key = `${entry.label}:${entry.status}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}

function hasEntry(entries: CompatibilityManifestEntry[], pattern: RegExp, statuses?: ReportStatus[]) {
  return entries.some((entry) =>
    pattern.test(`${entry.label} ${entry.detail}`) &&
    (!statuses || statuses.includes(entry.status)),
  )
}

function buildExportFixActions(
  doc: PsDocument,
  options: ExportLimitationOptions,
  entries: CompatibilityManifestEntry[],
  warnings: string[],
): ExportCompatibilityFixAction[] {
  const actions: ExportCompatibilityFixAction[] = []
  const add = (action: ExportCompatibilityFixAction) => {
    if (!actions.some((item) => item.id === action.id)) actions.push(action)
  }

  if (hasEntry(entries, /alpha transparency|no alpha channel|transparency/i, ["flattened"]) || warnings.some((warning) => /transparency/i.test(warning))) {
    add({
      id: "switch-alpha-format",
      label: "Use an alpha-safe format",
      detail: "Switch to PNG or WebP before export to preserve transparent pixels instead of compositing them against the matte.",
      primaryFormat: "png",
    })
  }
  if (doc.bitDepth > 8 && !(options.format === "tiff" || options.format === "ppm" || options.format === "pgm")) {
    add({
      id: "use-high-bit-format",
      label: "Use a high-bit export",
      detail: "Switch to TIFF or PPM/PGM when sample precision matters; browser-native image encoders use the 8-bit preview path.",
      primaryFormat: "tiff",
    })
  }
  if (hasEntry(entries, /editable text|text layers|text is rasterized/i, ["flattened", "approximated"])) {
    add({
      id: "rasterize-text",
      label: "Rasterize or sidecar text",
      detail: "Rasterize text intentionally for image export, or use a project/metadata sidecar when editable typography must be handed off.",
      primaryFormat: "metadata-json",
    })
  }
  if (doc.layers.length > 1 || hasEntry(entries, /layer structure|layers are composited/i, ["flattened"])) {
    add({
      id: "flatten-layer-structure",
      label: "Review flattened layers",
      detail: "Exported pixels will be a single flattened surface; save a project copy or sidecar before flattening a layered handoff.",
      primaryFormat: "metadata-json",
    })
  }
  if (doc.colorMode !== "RGB" || hasEntry(entries, /rgba export conversion|icc profile/i, ["approximated", "unsupported"])) {
    add({
      id: "convert-color-intent",
      label: "Check color conversion",
      detail: "Verify RGB conversion, proof profile, and ICC embedding before committing a color-critical export.",
      primaryFormat: options.format === "metadata-json" ? "tiff" : options.format,
    })
  }
  if (options.includeMetadata && hasEntry(entries, /metadata embedding/i, ["approximated", "unsupported"])) {
    add({
      id: "add-metadata-sidecar",
      label: "Add metadata sidecar",
      detail: "Use the sidecar export when the chosen image container cannot carry the full app metadata payload.",
      primaryFormat: "metadata-json",
    })
  }

  return actions.slice(0, 6)
}

export function createExportCompatibilityManifest(
  doc: PsDocument,
  options: ExportLimitationOptions,
): ExportCompatibilityManifest {
  const limitationReport = createExportLimitationReport(doc, options)
  const compatibility = createCompatibilityManifest(doc, "browser-raster")
  const entries = [...compatibility.entries, ...limitationReport.items]
  const totals = reportTotals(entries)
  const warnings: string[] = []

  if (options.format === "jpeg" && options.transparent) {
    warnings.push("JPEG does not preserve transparency; transparent pixels are composited against the matte color.")
  }
  if ((options.quality ?? 100) < 70 && ["jpeg", "webp", "avif"].includes(options.format)) {
    warnings.push(`${options.format.toUpperCase()} quality is below 70; visible compression artifacts are likely.`)
  }
  if (
    options.includeMetadata &&
    options.format !== "svg" &&
    options.format !== "metadata-json" &&
    options.format !== "png" &&
    options.format !== "jpeg" &&
    options.format !== "tiff" &&
    options.format !== "webp" &&
    options.format !== "avif" &&
    options.format !== "tga" &&
    options.format !== "ppm" &&
    options.format !== "pgm" &&
    options.format !== "pbm"
  ) {
    warnings.push(`${options.format.toUpperCase()} export does not embed the app's metadata fields.`)
  }
  const highBitPreservingExport = doc.bitDepth > 8 && (
    options.format === "tiff" ||
    options.format === "ppm" ||
    options.format === "pgm"
  )
  if (doc.bitDepth > 8 && !highBitPreservingExport) {
    warnings.push(`${doc.colorMode}/${doc.bitDepth}-bit document intent is converted through an 8-bit browser canvas export path.`)
  } else if (doc.colorMode !== "RGB") {
    warnings.push(`${doc.colorMode} document intent is composited into RGB export pixels.`)
  }
  if (doc.layers.length > 1) {
    warnings.push(`${doc.layers.length} layers are flattened into a single exported output surface.`)
  }
  const score = buildExportCompatibilityScore(entries)
  const preservationSummary = buildExportPreservationSummary(entries, options)
  const fixActions = buildExportFixActions(doc, options, entries, warnings)

  const riskLevel =
    totals.unsupported > 0 || totals.flattened > 2 || warnings.length >= 3
      ? "high"
      : totals.flattened > 0 || totals.approximated > 1 || warnings.length
        ? "medium"
        : "low"

  return {
    app: "Photoshop Web",
    format: "ps-export-manifest",
    version: 1,
    generatedAt: new Date().toISOString(),
    target: "browser-raster",
    document: {
      id: doc.id,
      name: doc.name,
      width: doc.width,
      height: doc.height,
      colorMode: doc.colorMode,
      bitDepth: doc.bitDepth,
      layerCount: doc.layers.length,
    },
    export: options,
    entries,
    totals,
    warnings,
    riskLevel,
    score,
    preservationSummary,
    fixActions,
    summary: `${options.format.toUpperCase()} compatibility manifest: ${riskLevel} risk, ${totals.flattened} flattened, ${totals.approximated} approximated, ${totals.unsupported} unsupported.`,
  }
}

export function createDocumentReport(
  doc: PsDocument,
  source: DocumentReport["source"],
): DocumentReport {
  const items: DocumentReport["items"] = []
  const layers = doc.layers
  const smartFilters = layers.reduce((sum, layer) => sum + (layer.smartFilters?.length ?? 0), 0)
  const adjustmentLayers = layers.filter((layer) => layer.kind === "adjustment").length
  const styledLayers = layers.filter((layer) => layer.style).length
  const maskedLayers = layers.filter((layer) => layer.mask || layer.vectorMask).length
  const textLayers = layers.filter((layer) => layer.kind === "text").length
  const shapeLayers = layers.filter((layer) => layer.kind === "shape").length
  const groupLayers = layers.filter((layer) => layer.kind === "group").length
  const blendModes = [...new Set(layers.map((layer) => layer.blendMode).filter((mode) => mode && mode !== "normal"))]
  const smartObjectLayers = layers.filter((layer) => layer.kind === "smart-object" || layer.smartObject)
  const smartObjectSources = smartObjectLayers.filter((layer) => layer.smartSource).length
  const linkedSmartObjects = smartObjectLayers.filter((layer) => layer.smartSource?.linkType === "linked").length
  const missingSmartObjects = smartObjectLayers.filter((layer) => layer.smartSource?.status === "missing").length
  const smartObjectEditPackages = smartObjectLayers.filter((layer) => layer.smartSource?.editPackage).length
  const smartObjectFileHandles = smartObjectLayers.filter((layer) => layer.smartSource?.fileHandleName || layer.smartSource?.handlePermission).length
  const smartFilterMasks = layers.reduce((sum, layer) => sum + (layer.smartFilters?.filter((filter) => filter.mask || filter.maskEnabled === false).length ?? 0), 0)
  const layerNotes = layers.reduce((sum, layer) => sum + (layer.notes?.length ?? 0), 0)
  const layerMetadata = layers.filter((layer) => layer.metadata).length
  const exportPresets = (doc.assetLibrary ?? []).filter((asset) => asset.kind === "export").length
  items.push({ label: "Canvas", status: "preserved", detail: `${doc.width} x ${doc.height}px, ${doc.colorMode}, ${doc.bitDepth}-bit metadata retained.` })
  if (doc.metadata?.largeDocumentInspection) {
    const inspection = doc.metadata.largeDocumentInspection
    items.push({
      label: "Large document inspection",
      status: "info",
      detail: `${inspection.sourceName} parsed as ${inspection.originalWidth} x ${inspection.originalHeight}px; pixels were not opened for editing. ${inspection.reason}`,
    })
  }
  if (doc.metadata?.largeDocumentTileView) {
    const tileView = doc.metadata.largeDocumentTileView
    items.push({
      label: "Large document tile view",
      status: "approximated",
      detail: `${tileView.sourceName} is represented by a ${doc.width} x ${doc.height}px overview plus ${tileView.tileColumns} x ${tileView.tileRows} full-resolution tiles.`,
    })
  }
  if (doc.metadata?.largeDocumentTileEdit) {
    const tileEdit = doc.metadata.largeDocumentTileEdit
    items.push({
      label: "Large document tile edit",
      status: "info",
      detail: `Editing tile ${tileEdit.tile.col},${tileEdit.tile.row} from ${tileEdit.sourceName}; update the source tile to write changes back to the tile cache.`,
    })
  }
  if (doc.metadata?.psdRepairPlan) {
    const repair = doc.metadata.psdRepairPlan
    items.push({
      label: "PSD repair plan",
      status: "info",
      detail: `${repair.summary} ${repair.actions.slice(0, 3).map((action) => `${action.label} -> ${action.localRepresentation}`).join("; ")}`,
    })
  }
  if (source.includes("PSD") && (doc.bitDepth === 16 || doc.bitDepth === 32)) {
    items.push({
      label: "Bit depth",
      status: "approximated",
      detail: `Document declares ${doc.bitDepth}-bit/channel but the PSD writer only emits 8-bit/channel; pixel data is written at 8-bit while the original depth is retained in project metadata.`,
    })
  }
  if (source.includes("PSD") && doc.colorMode && doc.colorMode !== "RGB" && doc.colorMode !== "Grayscale" && doc.colorMode !== "Bitmap") {
    items.push({
      label: "Color mode",
      status: "approximated",
      detail: `Document declares ${doc.colorMode} but the browser canvas renders 8-bit RGBA; PSD export converts pixels via the RGB composite while preserving the original mode flag.`,
    })
  }
  for (const capabilityWarning of capabilityWarningsForDocument(doc)) {
    const status =
      capabilityWarning.status === "unsupported"
        ? "unsupported"
        : capabilityWarning.status === "stub" || capabilityWarning.status === "approximation"
          ? "approximated"
          : "info"
    items.push({
      label: capabilityWarning.label,
      status,
      detail: capabilityWarning.recommendedAction
        ? `${capabilityWarning.detail} ${capabilityWarning.recommendedAction}`
        : capabilityWarning.detail,
    })
  }
  const manifest = createCompatibilityManifest(doc, compatibilityTargetForSource(source))
  items.push({
    label: "Compatibility manifest",
    status: manifest.totals.unsupported > 0 || manifest.totals.flattened > 0 ? "info" : "preserved",
    detail: manifest.summary,
  })
  if (doc.metadata) items.push({ label: "File info", status: "preserved", detail: "IPTC-style title, author, copyright, description, and keyword metadata retained in project format." })
  if (doc.colorManagement) items.push({ label: "Color management", status: "preserved", detail: `${doc.colorManagement.assignedProfile} profile and proofing settings retained in project format.` })
  if (doc.printSettings) items.push({ label: "Print settings", status: "preserved", detail: `${doc.printSettings.paperSize} print setup, marks, bleed, and color-handling metadata retained.` })
  items.push({ label: "Project schema", status: "info", detail: "Project saves use schema version 2 with migration-aware loading and recovery from wrapped JSON text." })
  items.push({ label: "Layers", status: "preserved", detail: `${layers.length} layer records retained with visibility, opacity, blend mode, and lock state.` })
  if (textLayers) items.push({ label: "Text layers", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${textLayers} editable text layer${textLayers === 1 ? "" : "s"} round-trip through the native PSD text engine; extended properties (variable axes, OpenType features, on-path geometry) are mirrored into the PSD XMP app-preservation payload, with layer-name markers retained only as a legacy fallback.` })
  if (shapeLayers) items.push({ label: "Shape layers", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${shapeLayers} shape layer${shapeLayers === 1 ? "" : "s"} round-trip as vector masks with native fill/stroke descriptors; custom-shape parameters and per-subpath metadata are mirrored into the PSD XMP app-preservation payload, with name markers retained only as a fallback.` })
  if (groupLayers) items.push({ label: "Groups", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${groupLayers} group layer${groupLayers === 1 ? "" : "s"} retain child relationship metadata; PSD export maps folders natively.` })
  if (blendModes.length) items.push({ label: "Blend modes", status: source.includes("PSD") ? "approximated" : "preserved", detail: `Non-normal blend modes modeled for round trip: ${blendModes.join(", ")}.` })
  const threeDLayers = layers.filter((layer) => layer.kind === "3d").length
  const videoLayers = layers.filter((layer) => layer.kind === "video").length
  if (threeDLayers) items.push({ label: "3D layers", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${threeDLayers} browser-native 3D scene layer${threeDLayers === 1 ? "" : "s"} retained with mesh, material, light, and camera metadata.` })
  if (videoLayers) items.push({ label: "Video layers", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${videoLayers} video layer${videoLayers === 1 ? "" : "s"} retained with poster frame, timing, keyframe, and audio metadata.` })
  if (maskedLayers) items.push({ label: "Masks", status: "preserved", detail: `${maskedLayers} raster/vector mask entry${maskedLayers === 1 ? "" : "ies"} serialized.` })
  if (layerNotes || layerMetadata) items.push({ label: "Layer notes and metadata", status: "preserved", detail: source.includes("PSD")
    ? `${layerNotes} layer note${layerNotes === 1 ? "" : "s"} and ${layerMetadata} metadata-bearing layer${layerMetadata === 1 ? "" : "s"} restore in this app from the PSD XMP app-preservation payload; they are not Photoshop-native layer records.`
    : `${layerNotes} layer note${layerNotes === 1 ? "" : "s"} and ${layerMetadata} metadata-bearing layer${layerMetadata === 1 ? "" : "s"} retained as app-only searchable annotations, tags, and custom key/value fields.` })
  if (styledLayers) items.push({ label: "Layer styles", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${styledLayers} styled layer${styledLayers === 1 ? "" : "s"} round-trip native PSD effects (shadow/glow/bevel/satin/overlays/stroke) with global-light tracking.` })
  if (adjustmentLayers) items.push({
    label: "Adjustment layers",
    status: source.includes("PSD") ? "approximated" : "preserved",
    detail: source.includes("PSD")
      ? `${adjustmentLayers} non-destructive adjustment layer${adjustmentLayers === 1 ? "" : "s"} round-trip the current visual result; 16 types use native ag-psd descriptors. The 6 remaining types (shadows-highlights, hdr-toning, desaturate, match-color, replace-color, equalize) preserve editable params in the PSD XMP app-preservation payload, with layer-name tokens retained as fallback.`
      : `${adjustmentLayers} non-destructive adjustment layer${adjustmentLayers === 1 ? "" : "s"} retained in project format.`,
  })
  if (smartFilters) items.push({ label: "Smart filters", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${smartFilters} smart filter${smartFilters === 1 ? "" : "s"} bake their visual result into the layer's exported pixels; supported filters emit native placed-filter descriptors and filter-effect masks${smartFilterMasks ? ` (${smartFilterMasks} mask state${smartFilterMasks === 1 ? "" : "s"})` : ""}, while private app control state restores from the PSD XMP app-preservation payload.` })
  if (smartObjectSources) items.push({ label: "Smart object sources", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${smartObjectSources} smart source${smartObjectSources === 1 ? "" : "s"} round-trip via the native PSD placedLayer + linkedFiles array (embedded PNG bytes capped at 30 MB), with app project preservation for relink metadata, export timestamps, and ${smartObjectEditPackages} edit package${smartObjectEditPackages === 1 ? "" : "s"}.` })
  if (smartObjectFileHandles) items.push({ label: "File System Access smart links", status: source.includes("PSD") ? "unsupported" : "preserved", detail: `${smartObjectFileHandles} linked smart object handle reference${smartObjectFileHandles === 1 ? "" : "s"} retain handle name, permission state, content hash, and modified time; live browser FileSystemFileHandle objects are intentionally not serialized.` })
  if (linkedSmartObjects) items.push({ label: "Linked smart objects", status: source.includes("PSD") ? "approximated" : "info", detail: `${linkedSmartObjects} linked smart object reference${linkedSmartObjects === 1 ? "" : "s"} round-trip via the linkedFiles "linked" type; the source file is referenced by path, while live browser file handles and permission grants must be restored by relinking.` })
  if (missingSmartObjects) items.push({ label: "Missing smart object links", status: "unsupported", detail: `${missingSmartObjects} smart object link${missingSmartObjects === 1 ? " is" : "s are"} marked missing and require relink before source edits are reliable.` })
  if (doc.channels?.length) items.push({ label: "Alpha channels", status: "preserved", detail: `${doc.channels.length} saved channel${doc.channels.length === 1 ? "" : "s"} retained; PSD round-trip stores pixel data in a hidden group whose layer names follow the "[spot:#rrggbb:opacity]" convention for spot channels, and the alphaChannelNames image resource carries the human-readable channel name table.` })
  if (doc.timelineFrames?.length) items.push({ label: "Timeline", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${doc.timelineFrames.length} frame/video timeline entries retained in project format.` })
  if (doc.plugins?.length) items.push({ label: "Plugin descriptors", status: source.includes("PSD") ? "unsupported" : "preserved", detail: `${doc.plugins.length} CEP/UX/8BF-style local plugin descriptor${doc.plugins.length === 1 ? "" : "s"} retained.` })
  if (doc.variableDataSets?.length) items.push({ label: "Variable data", status: source.includes("PSD") ? "unsupported" : "preserved", detail: `${doc.variableDataSets.length} variable data set${doc.variableDataSets.length === 1 ? "" : "s"} retained for data-driven graphics.` })
  if (doc.comps?.length) items.push({ label: "Layer comps", status: source.includes("PSD") ? "unsupported" : "preserved", detail: `${doc.comps.length} layer comp${doc.comps.length === 1 ? "" : "s"} retained; PSD layer-comp records carry visibility/position/style flags natively, and the full per-layer state snapshot is appended to the comp's comment field as "__ps-web-comp:<base64-json>" — Photoshop displays the comment verbatim, this app strips the prefix and decodes the JSON back into a comp on import.` })
  if (exportPresets) items.push({ label: "Export presets", status: source.includes("PSD") ? "unsupported" : "preserved", detail: `${exportPresets} reusable export preset${exportPresets === 1 ? "" : "s"} retained in the asset library.` })
  if (doc.guides?.length) items.push({ label: "Guides", status: source.includes("PSD") ? "unsupported" : "preserved", detail: `${doc.guides.length} guide${doc.guides.length === 1 ? "" : "s"} round-trip through the native gridAndGuidesInformation resource.` })
  if (doc.slices?.length) items.push({ label: "Slices", status: source.includes("PSD") ? "unsupported" : "preserved", detail: `${doc.slices.length} web export slice${doc.slices.length === 1 ? "" : "s"} round-trip through the native PSD slices resource.` })
  if (doc.notes?.length) items.push({ label: "Notes", status: "preserved", detail: `${doc.notes.length} note${doc.notes.length === 1 ? "" : "s"} round-trip through the native PSD annotations records.` })
  if (source.includes("PSD")) {
    items.push({ label: "PSD interoperability boundary", status: "approximated", detail: "3D, video, plugin, cloud library, and vendor metadata are preserved in the app project format; PSD import/export keeps a raster-compatible approximation." })
    const clipWarnings = validateClippingGroup(layers).warnings
    if (clipWarnings.length) {
      items.push({
        label: "Clipping groups",
        status: "info",
        detail: `${clipWarnings.length} clipping warning${clipWarnings.length === 1 ? "" : "s"}: ${clipWarnings.slice(0, 3).join("; ")}${clipWarnings.length > 3 ? "; ..." : ""}`,
      })
    }
  }
  return {
    id: `report_${Math.random().toString(36).slice(2, 9)}`,
    title: `${source}: ${doc.name}`,
    createdAt: Date.now(),
    source,
    items,
  }
}
