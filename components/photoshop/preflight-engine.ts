import { capabilityWarningsForDocument } from "./capabilities"
import { diagnoseDocumentFonts } from "./typography-engine"
import type { Layer, PsDocument, Slice } from "./types"

export type PreflightSeverity = "pass" | "info" | "warn" | "error"
export type PreflightStatus = "pass" | "info" | "warn" | "fail"
export type PreflightCategory =
  | "scope"
  | "document"
  | "layers"
  | "typography"
  | "color"
  | "separations"
  | "print"
  | "export"
  | "metadata"
  | "annotations"

export interface PreflightFixAction {
  id: string
  label: string
  kind:
    | "show-hidden-layers"
    | "name-layers"
    | "mask-adjustments"
    | "remove-empty-layers"
    | "repair-slices"
    | "set-print-defaults"
    | "assign-profile"
    | "rasterize-or-flatten"
    | "warn-only"
  autoFixable: boolean
  detail: string
}

export interface PreflightFinding {
  id: string
  category: PreflightCategory
  severity: PreflightSeverity
  status: PreflightStatus
  label: string
  detail: string
  fixAction?: PreflightFixAction
}

export interface PreflightReport {
  scope: {
    certifiedPrepressOutput: false
    summary: string
  }
  counts: Record<PreflightSeverity, number>
  findings: PreflightFinding[]
  separationModel: {
    process: "RGB" | "CMYK" | "Grayscale" | "Duotone" | "Indexed" | "Multichannel" | "Bitmap"
    processPlates: string[]
    savedAlphaChannels: string[]
    spotChannels: string[]
    overprintSimulated: boolean
  }
}

export interface PreflightFixCandidates {
  emptyLayers: Layer[]
  hiddenLayers: Layer[]
  unnamedLayers: Layer[]
  unmaskedAdjustments: Layer[]
  invalidSlices: Slice[]
}

const alphaBoundsCache = new WeakMap<HTMLCanvasElement, { x: number; y: number; w: number; h: number } | null>()

function alphaBounds(layer: Layer) {
  const canvas = layer.canvas
  const cached = alphaBoundsCache.get(canvas)
  if (cached !== undefined) return cached
  const ctx = canvas.getContext?.("2d")
  if (!ctx || canvas.width <= 0 || canvas.height <= 0) return null
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let minX = canvas.width
  let minY = canvas.height
  let maxX = 0
  let maxY = 0
  let any = false
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (img.data[(y * canvas.width + x) * 4 + 3] > 8) {
        any = true
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  const result = any ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null
  alphaBoundsCache.set(canvas, result)
  return result
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

export function normalizePreflightSlice(slice: Slice, width: number, height: number) {
  const x = clamp(slice.x, 0, Math.max(0, width - 1))
  const y = clamp(slice.y, 0, Math.max(0, height - 1))
  const w = clamp(slice.w, 1, Math.max(1, width - x))
  const h = clamp(slice.h, 1, Math.max(1, height - y))
  return { ...slice, x, y, w, h }
}

function isValidSlice(slice: Slice, width: number, height: number) {
  return (
    Number.isFinite(slice.x) &&
    Number.isFinite(slice.y) &&
    Number.isFinite(slice.w) &&
    Number.isFinite(slice.h) &&
    slice.x >= 0 &&
    slice.y >= 0 &&
    slice.w > 0 &&
    slice.h > 0 &&
    slice.x + slice.w <= width &&
    slice.y + slice.h <= height
  )
}

function contentTouchesCanvasEdge(layer: Layer) {
  const bounds = alphaBounds(layer)
  if (!bounds) return false
  return bounds.x <= 0 || bounds.y <= 0 || bounds.x + bounds.w >= layer.canvas.width || bounds.y + bounds.h >= layer.canvas.height
}

function statusForSeverity(severity: PreflightSeverity): PreflightStatus {
  return severity === "error" ? "fail" : severity
}

function finding(
  id: string,
  category: PreflightCategory,
  severity: PreflightSeverity,
  label: string,
  detail: string,
  fixAction?: PreflightFixAction,
): PreflightFinding {
  return { id, category, severity, status: statusForSeverity(severity), label, detail, fixAction }
}

function autoFix(
  id: PreflightFixAction["kind"],
  label: string,
  detail: string,
): PreflightFixAction {
  return { id, kind: id, label, detail, autoFixable: true }
}

function warnOnly(label: string, detail: string): PreflightFixAction {
  return { id: "warn-only", kind: "warn-only", label, detail, autoFixable: false }
}

function processPlatesForMode(doc: PsDocument) {
  if (doc.colorMode === "CMYK") return ["Cyan", "Magenta", "Yellow", "Black"]
  if (doc.colorMode === "Grayscale" || doc.colorMode === "Bitmap") return ["Black"]
  if (doc.colorMode === "Duotone") return ["Ink 1", "Ink 2"]
  if (doc.colorMode === "Multichannel") {
    const channels = doc.modeSettings?.multichannel?.channels
    return [
      channels?.r !== false ? "Red" : null,
      channels?.g !== false ? "Green" : null,
      channels?.b !== false ? "Blue" : null,
      channels?.c ? "Cyan" : null,
      channels?.m ? "Magenta" : null,
      channels?.y ? "Yellow" : null,
      channels?.k ? "Black" : null,
    ].filter(Boolean) as string[]
  }
  return ["Red", "Green", "Blue"]
}

function isSpotChannelName(name: string) {
  return /\b(spot|pantone|pms|varnish|foil|white ink|metallic|die cut|dieline)\b/i.test(name)
}

function isSpotChannel(channel: NonNullable<PsDocument["channels"]>[number]) {
  return channel.kind === "spot" || !!channel.spotColor || isSpotChannelName(channel.name)
}

function isOverprintLikeLayer(layer: Layer) {
  const burnOrMultiply = ["multiply", "color-burn", "linear-burn", "darken", "darker-color"].includes(layer.blendMode)
  const opacityBlend = layer.opacity < 1 || (layer.fillOpacity ?? 1) < 1
  const channelKnockout = layer.advancedBlending && Object.values(layer.advancedBlending.channels).some((enabled) => !enabled)
  return burnOrMultiply || opacityBlend || !!channelKnockout
}

export function getPreflightFixes(doc: PsDocument): PreflightFixCandidates {
  const layers = doc.layers
  const rasterish = layers.filter((layer) => layer.kind !== "group" && layer.kind !== "adjustment")
  return {
    emptyLayers: rasterish.filter((layer) => !layer.text && !layer.shape && !alphaBounds(layer)),
    hiddenLayers: layers.filter((layer) => !layer.visible),
    unnamedLayers: layers.filter((layer) => !layer.name.trim()),
    unmaskedAdjustments: layers.filter((layer) => layer.kind === "adjustment" && !layer.mask),
    invalidSlices: (doc.slices ?? []).filter((slice) => !isValidSlice(slice, doc.width, doc.height)),
  }
}

export function analyzePreflightDocument(doc: PsDocument): PreflightReport {
  const findings: PreflightFinding[] = []
  const layers = doc.layers
  const rasterish = layers.filter((layer) => layer.kind !== "group" && layer.kind !== "adjustment")
  const fixes = getPreflightFixes(doc)
  const lockedLayers = layers.filter((layer) => layer.locked || layer.lockAll || layer.lockDraw || layer.lockMove || layer.lockTransparency)
  const smartFilterCount = layers.reduce((sum, layer) => sum + (layer.smartFilters?.length ?? 0), 0)
  const disabledSmartFilters = layers.reduce((sum, layer) => sum + (layer.smartFilters?.filter((filter) => !filter.enabled).length ?? 0), 0)
  const textLayers = layers.filter((layer) => layer.text)
  const fontDiagnostics = diagnoseDocumentFonts(layers)
  const missingFonts = fontDiagnostics.missingFonts
  const edgeClippedLayers = rasterish.filter(contentTouchesCanvasEdge)
  const smartObjects = layers.filter((layer) => layer.kind === "smart-object" || layer.smartObject)
  const psdRasterizedEffects = layers.filter((layer) => layer.smartFilters?.length || layer.kind === "adjustment" || layer.frame || layer.artboard)
  const _adjustmentLayers = layers.filter((layer) => layer.kind === "adjustment")
  const clippedWithoutBase = layers.filter((layer, index) => layer.clipped && (!layers[index - 1] || layers[index - 1].kind === "group"))
  const globalLightUsers = layers.filter(
    (layer) =>
      (layer.style?.dropShadow?.useGlobalLight ?? false) ||
      (layer.style?.innerShadow?.useGlobalLight ?? false) ||
      (layer.style?.bevel?.useGlobalLight ?? false),
  )
  const slices = doc.slices ?? []
  const processPlates = processPlatesForMode(doc)
  const channels = doc.channels ?? []
  const spotChannels = channels.filter(isSpotChannel).map((channel) => channel.name)
  const savedAlphaChannels = channels.filter((channel) => !isSpotChannelName(channel.name)).map((channel) => channel.name)
  const overprintLikeLayers = rasterish.filter(isOverprintLikeLayer)
  const dpi = doc.dpi ?? 72
  const print = doc.printSettings
  const bleedMm = print?.bleedMm ?? 0
  const hasPrintMarks = !!(print?.cropMarks || print?.registrationMarks)
  const profile = doc.colorManagement?.assignedProfile
  const proofProfile = print?.printerProfile ?? doc.colorManagement?.proofProfile

  findings.push(finding(
    "audit-scope",
    "scope",
    "info",
    "Audit scope",
    "Browser document audit only; not a certified prepress or print-provider handoff check.",
    warnOnly("Use certified prepress tools", "Confirm final plates, ICC conversions, PDF/X, traps, and provider-specific requirements outside the browser."),
  ))

  for (const capabilityWarning of capabilityWarningsForDocument(doc)) {
    findings.push(finding(
      `capability-${capabilityWarning.capabilityId}`,
      "export",
      capabilityWarning.status === "unsupported" || capabilityWarning.status === "stub" ? "warn" : "info",
      capabilityWarning.label,
      capabilityWarning.recommendedAction
        ? `${capabilityWarning.detail} ${capabilityWarning.recommendedAction}`
        : capabilityWarning.detail,
      warnOnly("Review capability limitation", capabilityWarning.recommendedAction ?? "Use the browser output as an editable preview, not a production-equivalent native Photoshop feature."),
    ))
  }

  findings.push(finding(
    "canvas",
    "document",
    doc.width * doc.height > 24_000_000 ? "warn" : "pass",
    "Canvas",
    `${doc.width} x ${doc.height}px, ${doc.colorMode}, ${doc.bitDepth}-bit.`,
  ))
  if (doc.metadata?.largeDocumentInspection) {
    const inspection = doc.metadata.largeDocumentInspection
    findings.push(finding(
      "large-document-inspection",
      "document",
      "warn",
      "Large document inspection",
      `${inspection.sourceName} parsed as ${inspection.originalWidth} x ${inspection.originalHeight}px, but pixels are not editable in inspection mode. ${inspection.reason}`,
      warnOnly("Choose reduced scale or tile-only", "Use reduced-scale import when enough fidelity fits browser limits, or tile-only mode for full-resolution tile edits."),
    ))
  }
  if (doc.metadata?.largeDocumentTileView) {
    const tileView = doc.metadata.largeDocumentTileView
    findings.push(finding(
      "large-document-tile-view",
      "document",
      "info",
      "Large document tile view",
      `${tileView.sourceName} is open as an overview plus ${tileView.tileColumns} x ${tileView.tileRows} full-resolution tiles.`,
      warnOnly("Open individual tiles", "Use the PSB tile view controls to inspect or edit a full-resolution tile without allocating the whole document."),
    ))
  }
  if (doc.metadata?.largeDocumentTileEdit) {
    const tileEdit = doc.metadata.largeDocumentTileEdit
    findings.push(finding(
      "large-document-tile-edit",
      "document",
      "info",
      "Large document tile edit",
      `Editing tile ${tileEdit.tile.col},${tileEdit.tile.row} from ${tileEdit.sourceName}.`,
      warnOnly("Update source tile", "Use Update Source Tile after editing to write the changed tile back to the tile cache."),
    ))
  }
  findings.push(finding(
    "icc-profile",
    "color",
    profile ? (profile === "sRGB IEC61966-2.1" ? "info" : "warn") : "warn",
    "ICC/profile handling",
    profile
      ? `${profile}; proof ${doc.colorManagement?.proofColors ? doc.colorManagement.proofProfile : "off"}; gamut warning ${doc.colorManagement?.gamutWarning ? "on" : "off"}. Browser canvas preview is not a native ICC transform engine.`
      : "No assigned profile metadata; browser exports assume an sRGB-like canvas and cannot embed a production ICC payload here.",
    profile
      ? warnOnly("Verify profile externally", "Use a color-managed prepress workflow for final conversion and contract proofing.")
      : { id: "assign-profile", kind: "assign-profile", label: "Assign profile metadata", detail: "The app can record profile metadata, but final ICC conversion still needs external verification.", autoFixable: false },
  ))
  findings.push(finding(
    "metadata",
    "metadata",
    doc.metadata?.author || doc.metadata?.copyright ? "pass" : "warn",
    "File metadata",
    doc.metadata?.author || doc.metadata?.copyright
      ? `${doc.metadata.author || "Unknown author"}; ${doc.metadata.keywords?.length ?? 0} keyword${(doc.metadata.keywords?.length ?? 0) === 1 ? "" : "s"}.`
      : "Author/copyright fields are empty.",
  ))
  findings.push(finding(
    "print-settings",
    "print",
    print ? "info" : "warn",
    "Print settings",
    print
      ? `${print.paperSize} ${print.orientation}, ${print.scale}% scale, ${bleedMm}mm bleed, ${print.colorHandling === "app" ? "app-managed" : "printer-managed"} color.`
      : "Print settings have not been configured.",
    print ? undefined : autoFix("set-print-defaults", "Set print defaults", "Create a basic print setup before previewing or handing off output."),
  ))
  findings.push(finding(
    "print-resolution",
    "print",
    dpi < 150 ? "error" : dpi < 300 ? "warn" : "pass",
    "Resolution",
    dpi < 150
      ? `${dpi} DPI is below typical quality print thresholds; 300 DPI is the usual target for high-quality raster print.`
      : dpi < 300
        ? `${dpi} DPI may be acceptable for some output but is below the common 300 DPI target.`
        : `${dpi} DPI is suitable for high-quality raster print targets.`,
    warnOnly("Resize or rebuild artwork", "The app should not invent detail by upsampling; rebuild or source higher-resolution artwork when required."),
  ))
  findings.push(finding(
    "print-marks-bleed",
    "print",
    bleedMm >= 3 && hasPrintMarks ? "pass" : "warn",
    "Marks and bleed",
    bleedMm >= 3 && hasPrintMarks
      ? `${bleedMm}mm bleed plus crop/registration marks are configured.`
      : `${bleedMm}mm bleed, crop marks ${print?.cropMarks ? "on" : "off"}, registration marks ${print?.registrationMarks ? "on" : "off"}; many print workflows require at least 3mm bleed and visible marks.`,
    autoFix("set-print-defaults", "Set 3mm bleed and print marks", "The app can set conservative print preview defaults, but provider-specific requirements still need review."),
  ))
  findings.push(finding(
    "page-position",
    "print",
    print?.pagePosition === "top-left" || (print?.scale ?? 100) > 100 ? "warn" : "info",
    "Page position and scale",
    print
      ? `${print.pagePosition ?? "center"} placement at ${print.scale}% scale. Check that scaled artwork fits trim and bleed.`
      : "No page placement has been set.",
    warnOnly("Review page geometry", "Confirm imposition, trim, and printable area against the printer's specification."),
  ))
  findings.push(finding(
    "proof-print",
    "print",
    print?.proofPrint && (!doc.colorManagement?.proofColors || !proofProfile || proofProfile === "None") ? "warn" : "info",
    "Proof print",
    print?.proofPrint
      ? `Proof print enabled for ${proofProfile ?? "unspecified profile"}; this is a browser preview, not a contract proof.`
      : "Proof print is off.",
    warnOnly("Verify proof externally", "Browser print output is not certified contract proofing or PDF/X output."),
  ))
  findings.push(finding(
    "separation-model",
    "separations",
    doc.colorMode === "CMYK" || doc.colorMode === "Multichannel" ? "info" : "warn",
    "Process separations",
    `${doc.colorMode} model represented as ${processPlates.join(", ")} plate metadata; browser rendering remains composited RGBA.`,
    warnOnly("Verify plates externally", "Use dedicated prepress software to inspect output separations and ink limits."),
  ))
  findings.push(finding(
    "spot-channels",
    "separations",
    spotChannels.length ? "warn" : channels.length ? "info" : "pass",
    "Spot channels",
    spotChannels.length
      ? `${spotChannels.length} spot-like channel${spotChannels.length === 1 ? "" : "s"} tracked: ${spotChannels.join(", ")}. Browser raster/PDF print paths cannot preserve native spot plates.`
      : channels.length
        ? `${channels.length} saved alpha channel${channels.length === 1 ? "" : "s"} tracked; no spot plate naming detected.`
        : "No saved alpha or spot-like channels.",
    spotChannels.length ? warnOnly("Preserve spots externally", "Exported browser rasters flatten spot-channel intent; rebuild spot plates in production prepress tools.") : undefined,
  ))
  findings.push(finding(
    "overprint-transparency",
    "separations",
    overprintLikeLayers.length ? "warn" : "pass",
    "Overprint and transparency",
    overprintLikeLayers.length
      ? `${overprintLikeLayers.length} layer${overprintLikeLayers.length === 1 ? "" : "s"} use blending, opacity, or channel masking that can change when flattened; no real overprint engine is available.`
      : "No overprint-like blending or transparency risks detected.",
    overprintLikeLayers.length ? warnOnly("Flatten/proof separations", "Review knockout/overprint behavior in a production separations preview.") : undefined,
  ))
  findings.push(finding(
    "browser-raster-export",
    "export",
    doc.bitDepth > 8 || doc.colorMode !== "RGB" || spotChannels.length || !!profile ? "warn" : "info",
    "Raster/export risk",
    "Browser-native raster export uses the 8-bit composited preview; TIFF and 16-bit PNM can preserve high-bit typed-array samples where available, but native spot plates, PDF/X metadata, live type, and production traps are not emitted.",
    warnOnly("Use production export workflow", "Use this app's reports as handoff notes and verify final output in a certified prepress pipeline."),
  ))

  findings.push(finding(
    "layer-bounds",
    "layers",
    edgeClippedLayers.length ? "warn" : "pass",
    "Layer bounds",
    edgeClippedLayers.length
      ? `${edgeClippedLayers.length} layer${edgeClippedLayers.length === 1 ? "" : "s"} touch the canvas edge; check for clipped content before export.`
      : "No layer content is clipped at the canvas edge.",
  ))
  findings.push(finding(
    "fonts",
    "typography",
    missingFonts.length ? "warn" : textLayers.length ? "pass" : "info",
    "Fonts",
    missingFonts.length
      ? `Missing fonts: ${missingFonts.join(", ")}. Substitution: ${Object.entries(fontDiagnostics.substitutions).map(([font, fallback]) => `${font} -> ${fallback}`).join(", ")}.`
      : textLayers.length
        ? `${textLayers.length} editable text layer${textLayers.length === 1 ? "" : "s"} use available fonts.`
        : "No editable text layers.",
    missingFonts.length ? warnOnly("Install or rasterize fonts", "Install fonts before final output, or rasterize/type-outline externally when required by the printer.") : undefined,
  ))
  findings.push(finding("layer-stack", "layers", layers.length > 0 ? "pass" : "error", "Layer stack", `${layers.length} layer${layers.length === 1 ? "" : "s"} in the document.`))
  findings.push(finding(
    "empty-layers",
    "layers",
    fixes.emptyLayers.length ? "warn" : "pass",
    "Empty layers",
    fixes.emptyLayers.length ? `${fixes.emptyLayers.length} layer${fixes.emptyLayers.length === 1 ? "" : "s"} contain no visible pixels or editable content.` : "No empty editable layers detected.",
    fixes.emptyLayers.length ? autoFix("remove-empty-layers", "Remove empty layers", "The app can remove empty layers while keeping at least one layer in the document.") : undefined,
  ))
  findings.push(finding(
    "hidden-layers",
    "layers",
    fixes.hiddenLayers.length ? "info" : "pass",
    "Hidden layers",
    fixes.hiddenLayers.length ? `${fixes.hiddenLayers.length} hidden layer${fixes.hiddenLayers.length === 1 ? "" : "s"} will be omitted from raster exports.` : "All layers are visible.",
    fixes.hiddenLayers.length ? autoFix("show-hidden-layers", "Show hidden layers", "The app can make hidden layers visible before export.") : undefined,
  ))
  findings.push(finding(
    "locks",
    "layers",
    lockedLayers.length ? "info" : "pass",
    "Locks",
    lockedLayers.length ? `${lockedLayers.length} layer${lockedLayers.length === 1 ? "" : "s"} have one or more lock flags.` : "No layer locks are active.",
  ))
  findings.push(finding(
    "layer-names",
    "layers",
    fixes.unnamedLayers.length ? "warn" : "pass",
    "Layer names",
    fixes.unnamedLayers.length ? `${fixes.unnamedLayers.length} layer${fixes.unnamedLayers.length === 1 ? "" : "s"} need names before handoff.` : "All layers have names.",
    fixes.unnamedLayers.length ? autoFix("name-layers", "Name unnamed layers", "The app can assign generic names to unnamed layers.") : undefined,
  ))
  findings.push(finding(
    "adjustment-masks",
    "layers",
    fixes.unmaskedAdjustments.length ? "info" : "pass",
    "Adjustment masks",
    fixes.unmaskedAdjustments.length ? `${fixes.unmaskedAdjustments.length} adjustment layer${fixes.unmaskedAdjustments.length === 1 ? "" : "s"} affect the full canvas.` : "Adjustment layers are masked or not present.",
    fixes.unmaskedAdjustments.length ? autoFix("mask-adjustments", "Add white masks", "The app can add full-canvas white masks to unmasked adjustment layers.") : undefined,
  ))
  findings.push(finding("smart-filters", "layers", smartFilterCount ? "info" : "pass", "Smart filters", smartFilterCount ? `${smartFilterCount} smart filter${smartFilterCount === 1 ? "" : "s"}; ${disabledSmartFilters} disabled.` : "No smart filters are attached."))
  findings.push(finding(
    "smart-objects",
    "layers",
    smartObjects.length ? "info" : "pass",
    "Smart objects",
    smartObjects.length
      ? `${smartObjects.length} smart object layer${smartObjects.length === 1 ? "" : "s"} can be edited in-project; PSD export stores the rendered layer result.`
      : "No smart object layers.",
  ))
  findings.push(finding(
    "psd-round-trip",
    "export",
    psdRasterizedEffects.length ? "warn" : "pass",
    "PSD round trip",
    psdRasterizedEffects.length
      ? `${psdRasterizedEffects.length} layer${psdRasterizedEffects.length === 1 ? "" : "s"} use app-only metadata that may be approximated or rasterized in PSD.`
      : "No app-only layer features detected for PSD export.",
  ))
  findings.push(finding("clipping", "layers", clippedWithoutBase.length ? "warn" : "pass", "Clipping", clippedWithoutBase.length ? `${clippedWithoutBase.length} clipped layer${clippedWithoutBase.length === 1 ? "" : "s"} may not have a valid base layer.` : "No clipping-base issues found."))
  findings.push(finding(
    "global-light",
    "layers",
    globalLightUsers.length ? "pass" : "info",
    "Global light",
    globalLightUsers.length
      ? `${globalLightUsers.length} styled layer${globalLightUsers.length === 1 ? "" : "s"} follow ${doc.globalLight?.angle ?? 120} deg / ${doc.globalLight?.altitude ?? 30} deg.`
      : "No layer effects currently use global light.",
  ))
  findings.push(finding("guides", "annotations", doc.guides?.length ? "info" : "pass", "Guides", doc.guides?.length ? `${doc.guides.length} layout guide${doc.guides.length === 1 ? "" : "s"} available for alignment.` : "No document guides."))
  findings.push(finding(
    "slices",
    "export",
    fixes.invalidSlices.length ? "warn" : slices.length ? "pass" : "info",
    "Slices",
    fixes.invalidSlices.length
      ? `${fixes.invalidSlices.length} slice${fixes.invalidSlices.length === 1 ? "" : "s"} need bounds repair before export.`
      : slices.length
        ? `${slices.length} web export slice${slices.length === 1 ? "" : "s"} ready.`
        : "No web export slices.",
    fixes.invalidSlices.length ? autoFix("repair-slices", "Repair slice bounds", "The app can clamp invalid slices to the document bounds.") : undefined,
  ))
  findings.push(finding("annotations", "annotations", doc.notes?.length || doc.counts?.length || doc.measurement ? "info" : "pass", "Annotations", `${doc.notes?.length ?? 0} notes, ${doc.counts?.length ?? 0} count markers${doc.measurement ? ", 1 measurement" : ""}.`))
  findings.push(finding(
    "font-embedding",
    "typography",
    textLayers.length ? "info" : "pass",
    "Font embedding",
    textLayers.length
      ? `${textLayers.length} text layer${textLayers.length === 1 ? "" : "s"} use browser fonts; fonts are not embedded in browser raster exports. Rasterize or verify text before handoff if font fidelity is critical.`
      : "No text layers to embed.",
  ))

  const counts = findings.reduce<Record<PreflightSeverity, number>>(
    (totals, item) => {
      totals[item.severity] += 1
      return totals
    },
    { pass: 0, info: 0, warn: 0, error: 0 },
  )

  return {
    scope: {
      certifiedPrepressOutput: false,
      summary: "Browser document audit only; not a certified prepress or print-provider handoff check.",
    },
    counts,
    findings,
    separationModel: {
      process: doc.colorMode,
      processPlates,
      savedAlphaChannels,
      spotChannels,
      overprintSimulated: overprintLikeLayers.length > 0,
    },
  }
}

export function analyzePreflight(doc: PsDocument): PreflightFinding[] {
  return analyzePreflightDocument(doc).findings
}
