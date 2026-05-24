"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { downloadText } from "./document-io"
import { useEditor, makeCanvas } from "./editor-context"
import { capabilityWarningsForDocument } from "./capabilities"
import { diagnoseDocumentFonts } from "./typography-engine"
import {
  analyzePreflightDocument,
  getPreflightFixes as getStructuredPreflightFixes,
  normalizePreflightSlice,
  type PreflightCategory,
  type PreflightFinding,
  type PreflightStatus,
} from "./preflight-engine"
import type { Layer, PrintSettings, PsDocument, Slice } from "./types"

const STATUS_CLASS: Record<PreflightStatus, string> = {
  pass: "text-emerald-300",
  warn: "text-amber-300",
  fail: "text-red-300",
  info: "text-[var(--ps-text-dim)]",
}

interface LegacyPreflightItem {
  status: PreflightStatus
  label: string
  detail: string
}

const legacyAlphaBoundsCache = new WeakMap<HTMLCanvasElement, { x: number; y: number; w: number; h: number } | null>()

function alphaBounds(layer: Layer) {
  const canvas = layer.canvas
  const cached = legacyAlphaBoundsCache.get(canvas)
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
  legacyAlphaBoundsCache.set(canvas, result)
  return result
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function _normalizeSlice(slice: Slice, width: number, height: number) {
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

function _getPreflightFixes(doc: PsDocument) {
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

function _analyzePreflight(doc: PsDocument): LegacyPreflightItem[] {
  const items: LegacyPreflightItem[] = []
  const layers = doc.layers
  const rasterish = layers.filter((layer) => layer.kind !== "group" && layer.kind !== "adjustment")
  const emptyLayers = rasterish.filter((layer) => !layer.text && !layer.shape && !alphaBounds(layer))
  const hiddenLayers = layers.filter((layer) => !layer.visible)
  const lockedLayers = layers.filter((layer) => layer.locked || layer.lockAll || layer.lockDraw || layer.lockMove || layer.lockTransparency)
  const unnamedLayers = layers.filter((layer) => !layer.name.trim())
  const smartFilterCount = layers.reduce((sum, layer) => sum + (layer.smartFilters?.length ?? 0), 0)
  const disabledSmartFilters = layers.reduce((sum, layer) => sum + (layer.smartFilters?.filter((filter) => !filter.enabled).length ?? 0), 0)
  const textLayers = layers.filter((layer) => layer.text)
  const fontDiagnostics = diagnoseDocumentFonts(layers)
  const missingFonts = fontDiagnostics.missingFonts
  const edgeClippedLayers = rasterish.filter(contentTouchesCanvasEdge)
  const smartObjects = layers.filter((layer) => layer.kind === "smart-object" || layer.smartObject)
  const psdRasterizedEffects = layers.filter((layer) => layer.smartFilters?.length || layer.kind === "adjustment" || layer.frame || layer.artboard)
  const adjustmentLayers = layers.filter((layer) => layer.kind === "adjustment")
  const unmaskedAdjustments = adjustmentLayers.filter((layer) => !layer.mask)
  const clippedWithoutBase = layers.filter((layer, index) => layer.clipped && (!layers[index - 1] || layers[index - 1].kind === "group"))
  const globalLightUsers = layers.filter(
    (layer) =>
      (layer.style?.dropShadow?.useGlobalLight ?? false) ||
      (layer.style?.innerShadow?.useGlobalLight ?? false) ||
      (layer.style?.bevel?.useGlobalLight ?? false),
  )
  const slices = doc.slices ?? []
  const invalidSlices = slices.filter((slice) => !isValidSlice(slice, doc.width, doc.height))

  items.push({
    status: "info",
    label: "Audit scope",
    detail: "Browser document audit only; not a certified prepress or print-provider handoff check.",
  })
  for (const capabilityWarning of capabilityWarningsForDocument(doc)) {
    items.push({
      status: capabilityWarning.status === "unsupported" || capabilityWarning.status === "stub" ? "warn" : "info",
      label: capabilityWarning.label,
      detail: capabilityWarning.recommendedAction
        ? `${capabilityWarning.detail} ${capabilityWarning.recommendedAction}`
        : capabilityWarning.detail,
    })
  }
  items.push({
    status: doc.width * doc.height > 24_000_000 ? "warn" : "pass",
    label: "Canvas",
    detail: `${doc.width} x ${doc.height}px, ${doc.colorMode}, ${doc.bitDepth}-bit.`,
  })
  items.push({
    status: doc.colorManagement ? "pass" : "info",
    label: "Color management",
    detail: doc.colorManagement
      ? `${doc.colorManagement.assignedProfile}; proof ${doc.colorManagement.proofColors ? doc.colorManagement.proofProfile : "off"}; gamut warning ${doc.colorManagement.gamutWarning ? "on" : "off"}.`
      : "No assigned profile metadata; exports assume sRGB.",
  })
  items.push({
    status: doc.metadata?.author || doc.metadata?.copyright ? "pass" : "warn",
    label: "File metadata",
    detail: doc.metadata?.author || doc.metadata?.copyright
      ? `${doc.metadata.author || "Unknown author"}; ${doc.metadata.keywords?.length ?? 0} keyword${(doc.metadata.keywords?.length ?? 0) === 1 ? "" : "s"}.`
      : "Author/copyright fields are empty.",
  })
  items.push({
    status: doc.printSettings?.cropMarks || doc.printSettings?.registrationMarks || (doc.printSettings?.bleedMm ?? 0) > 0 ? "pass" : "info",
    label: "Print marks",
    detail: doc.printSettings
      ? `${doc.printSettings.paperSize} ${doc.printSettings.orientation}, ${doc.printSettings.scale}% scale, ${doc.printSettings.bleedMm}mm bleed, ${doc.printSettings.colorHandling === "app" ? "app-managed" : "printer-managed"} color.`
      : "Print settings have not been configured.",
  })
  items.push({
    status: edgeClippedLayers.length ? "warn" : "pass",
    label: "Layer bounds",
    detail: edgeClippedLayers.length
      ? `${edgeClippedLayers.length} layer${edgeClippedLayers.length === 1 ? "" : "s"} touch the canvas edge; check for clipped content before export.`
      : "No layer content is clipped at the canvas edge.",
  })
  items.push({
    status: missingFonts.length ? "warn" : textLayers.length ? "pass" : "info",
    label: "Fonts",
    detail: missingFonts.length
      ? `Missing fonts: ${missingFonts.join(", ")}. Substitution: ${Object.entries(fontDiagnostics.substitutions).map(([font, fallback]) => `${font} -> ${fallback}`).join(", ")}.`
      : textLayers.length
        ? `${textLayers.length} editable text layer${textLayers.length === 1 ? "" : "s"} use available fonts.`
        : "No editable text layers.",
  })
  items.push({
    status: layers.length > 0 ? "pass" : "fail",
    label: "Layer stack",
    detail: `${layers.length} layer${layers.length === 1 ? "" : "s"} in the document.`,
  })
  items.push({
    status: emptyLayers.length ? "warn" : "pass",
    label: "Empty layers",
    detail: emptyLayers.length ? `${emptyLayers.length} layer${emptyLayers.length === 1 ? "" : "s"} contain no visible pixels or editable content.` : "No empty editable layers detected.",
  })
  items.push({
    status: hiddenLayers.length ? "info" : "pass",
    label: "Hidden layers",
    detail: hiddenLayers.length ? `${hiddenLayers.length} hidden layer${hiddenLayers.length === 1 ? "" : "s"} will be omitted from raster exports.` : "All layers are visible.",
  })
  items.push({
    status: lockedLayers.length ? "info" : "pass",
    label: "Locks",
    detail: lockedLayers.length ? `${lockedLayers.length} layer${lockedLayers.length === 1 ? "" : "s"} have one or more lock flags.` : "No layer locks are active.",
  })
  items.push({
    status: unnamedLayers.length ? "warn" : "pass",
    label: "Layer names",
    detail: unnamedLayers.length ? `${unnamedLayers.length} layer${unnamedLayers.length === 1 ? "" : "s"} need names before handoff.` : "All layers have names.",
  })
  items.push({
    status: unmaskedAdjustments.length ? "info" : "pass",
    label: "Adjustment masks",
    detail: unmaskedAdjustments.length ? `${unmaskedAdjustments.length} adjustment layer${unmaskedAdjustments.length === 1 ? "" : "s"} affect the full canvas.` : "Adjustment layers are masked or not present.",
  })
  items.push({
    status: smartFilterCount ? "info" : "pass",
    label: "Smart filters",
    detail: smartFilterCount ? `${smartFilterCount} smart filter${smartFilterCount === 1 ? "" : "s"}; ${disabledSmartFilters} disabled.` : "No smart filters are attached.",
  })
  items.push({
    status: smartObjects.length ? "info" : "pass",
    label: "Smart objects",
    detail: smartObjects.length
      ? `${smartObjects.length} smart object layer${smartObjects.length === 1 ? "" : "s"} can be edited in-project; PSD export stores the rendered layer result.`
      : "No smart object layers.",
  })
  items.push({
    status: psdRasterizedEffects.length ? "warn" : "pass",
    label: "PSD round trip",
    detail: psdRasterizedEffects.length
      ? `${psdRasterizedEffects.length} layer${psdRasterizedEffects.length === 1 ? "" : "s"} use app-only metadata that may be approximated or rasterized in PSD.`
      : "No app-only layer features detected for PSD export.",
  })
  items.push({
    status: clippedWithoutBase.length ? "warn" : "pass",
    label: "Clipping",
    detail: clippedWithoutBase.length ? `${clippedWithoutBase.length} clipped layer${clippedWithoutBase.length === 1 ? "" : "s"} may not have a valid base layer.` : "No clipping-base issues found.",
  })
  items.push({
    status: globalLightUsers.length ? "pass" : "info",
    label: "Global light",
    detail: globalLightUsers.length
      ? `${globalLightUsers.length} styled layer${globalLightUsers.length === 1 ? "" : "s"} follow ${doc.globalLight?.angle ?? 120} deg / ${doc.globalLight?.altitude ?? 30} deg.`
      : "No layer effects currently use global light.",
  })
  items.push({
    status: doc.guides?.length ? "info" : "pass",
    label: "Guides",
    detail: doc.guides?.length ? `${doc.guides.length} layout guide${doc.guides.length === 1 ? "" : "s"} available for alignment.` : "No document guides.",
  })
  items.push({
    status: invalidSlices.length ? "warn" : slices.length ? "pass" : "info",
    label: "Slices",
    detail: invalidSlices.length
      ? `${invalidSlices.length} slice${invalidSlices.length === 1 ? "" : "s"} need bounds repair before export.`
      : slices.length
        ? `${slices.length} web export slice${slices.length === 1 ? "" : "s"} ready.`
        : "No web export slices.",
  })
  items.push({
    status: doc.channels?.length ? "pass" : "info",
    label: "Alpha channels",
    detail: doc.channels?.length ? `${doc.channels.length} saved alpha channel${doc.channels.length === 1 ? "" : "s"}.` : "No saved alpha channels.",
  })
  items.push({
    status: doc.notes?.length || doc.counts?.length || doc.measurement ? "info" : "pass",
    label: "Annotations",
    detail: `${doc.notes?.length ?? 0} notes, ${doc.counts?.length ?? 0} count markers${doc.measurement ? ", 1 measurement" : ""}.`,
  })

  /* ---- expanded preflight checks ---- */

  // Low DPI for print
  const dpi = doc.dpi ?? 72
  items.push({
    status: dpi < 150 ? "warn" : dpi < 300 ? "info" : "pass",
    label: "Resolution (DPI)",
    detail: dpi < 150
      ? `${dpi} DPI is too low for quality print output; 300 DPI recommended.`
      : dpi < 300
        ? `${dpi} DPI is acceptable for web but may be insufficient for print.`
        : `${dpi} DPI is suitable for high-quality print output.`,
  })

  // Bleed margin check
  const bleedMm = doc.printSettings?.bleedMm ?? 0
  items.push({
    status: bleedMm >= 3 ? "pass" : bleedMm > 0 ? "warn" : "info",
    label: "Bleed margin",
    detail: bleedMm >= 3
      ? `${bleedMm}mm bleed meets standard print requirements.`
      : bleedMm > 0
        ? `${bleedMm}mm bleed may be insufficient; 3mm minimum recommended for print.`
        : "No bleed margin set; add 3mm bleed for professional print output.",
  })

  // Transparency flattening for print
  const hasTransparentLayers = rasterish.some((layer) => layer.opacity < 1 || layer.blendMode !== "normal")
  items.push({
    status: hasTransparentLayers ? "warn" : "pass",
    label: "Transparency",
    detail: hasTransparentLayers
      ? `${rasterish.filter((l) => l.opacity < 1 || l.blendMode !== "normal").length} layer${rasterish.filter((l) => l.opacity < 1 || l.blendMode !== "normal").length === 1 ? "" : "s"} use transparency/blending; may need flattening for print.`
      : "No transparency issues for print output.",
  })

  // Font embedding advisory
  items.push({
    status: textLayers.length ? "info" : "pass",
    label: "Font embedding",
    detail: textLayers.length
      ? `${textLayers.length} text layer${textLayers.length === 1 ? "" : "s"} use browser fonts; fonts are not embedded in exports. Rasterize text layers before handoff if font fidelity is critical.`
      : "No text layers to embed.",
  })

  // Color mode advisory
  items.push({
    status: doc.colorMode === "CMYK" ? "pass" : doc.colorMode === "RGB" ? "info" : "warn",
    label: "Color mode",
    detail: doc.colorMode === "CMYK"
      ? "CMYK mode is suitable for print output."
      : doc.colorMode === "RGB"
        ? "RGB mode is standard for web; convert to CMYK for professional print."
        : `${doc.colorMode ?? "Unknown"} mode; verify compatibility with your output workflow.`,
  })

  return items
}

export function PreflightDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { activeDoc, dispatch, commit, requestRender } = useEditor()
  const [categoryFilter, setCategoryFilter] = React.useState<PreflightCategory | "All">("All")
  const [statusFilter, setStatusFilter] = React.useState<PreflightStatus | "All">("All")
  const report = React.useMemo(() => (activeDoc ? analyzePreflightDocument(activeDoc) : null), [activeDoc])
  const items = React.useMemo<PreflightFinding[]>(() => report?.findings ?? [], [report])
  const fixes = React.useMemo(() => (activeDoc ? getStructuredPreflightFixes(activeDoc) : null), [activeDoc])
  if (!activeDoc) return null
  const fixCandidates = fixes ?? getStructuredPreflightFixes(activeDoc)
  const counts = report?.counts ?? { pass: 0, warn: 0, error: 0, info: 0 }
  const printDefaultCount = items.some((item) => item.fixAction?.kind === "set-print-defaults") ? 1 : 0
  const categories = ["All", ...Array.from(new Set(items.map((item) => item.category))).sort()] as Array<PreflightCategory | "All">
  const filteredItems = items.filter((item) => {
    if (categoryFilter !== "All" && item.category !== categoryFilter) return false
    if (statusFilter !== "All" && item.status !== statusFilter) return false
    return true
  })

  const exportJson = () => {
    downloadText(
      JSON.stringify(
        {
          app: "Photoshop Web",
          document: activeDoc.name,
          createdAt: new Date().toISOString(),
          scope: report?.scope,
          counts,
          separationModel: report?.separationModel,
          findings: items,
        },
        null,
        2,
      ),
      `${activeDoc.name}-preflight.json`,
    )
  }

  const exportCsv = () => {
    const rows = [
      ["status", "category", "label", "detail", "fix"],
      ...filteredItems.map((item) => [
        item.status,
        item.category,
        item.label,
        item.detail,
        item.fixAction ? `${item.fixAction.autoFixable ? "Auto" : "Warn"}: ${item.fixAction.label}` : "",
      ]),
    ]
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n")
    downloadText(csv, `${activeDoc.name}-preflight.csv`)
  }

  const finishFix = (label: string) => {
    requestRender()
    window.setTimeout(() => commit(label, "all"), 0)
    toast.success(label)
  }

  const showHiddenLayers = () => {
    for (const layer of fixCandidates.hiddenLayers) {
      dispatch({ type: "set-layer-visibility", id: layer.id, visible: true })
    }
    finishFix("Preflight Fix: Show Hidden Layers")
  }

  const nameUnnamedLayers = () => {
    for (const [index, layer] of fixCandidates.unnamedLayers.entries()) {
      dispatch({ type: "rename-layer", id: layer.id, name: `${layer.kind === "group" ? "Group" : "Layer"} ${index + 1}` })
    }
    finishFix("Preflight Fix: Name Layers")
  }

  const maskAdjustmentLayers = () => {
    for (const layer of fixCandidates.unmaskedAdjustments) {
      dispatch({ type: "set-layer-mask", id: layer.id, mask: makeCanvas(activeDoc.width, activeDoc.height, "#ffffff") })
    }
    finishFix("Preflight Fix: Mask Adjustments")
  }

  const removeEmptyLayers = () => {
    let remaining = activeDoc.layers.length
    let removed = 0
    for (const layer of fixCandidates.emptyLayers) {
      if (remaining <= 1) break
      dispatch({ type: "remove-layer", id: layer.id })
      remaining--
      removed++
    }
    if (removed) finishFix("Preflight Fix: Remove Empty Layers")
  }

  const repairSlices = () => {
    for (const slice of fixCandidates.invalidSlices) {
      dispatch({ type: "update-slice", id: slice.id, patch: normalizePreflightSlice(slice, activeDoc.width, activeDoc.height) })
    }
    finishFix("Preflight Fix: Repair Slices")
  }

  const setPrintDefaults = () => {
    const current = activeDoc.printSettings
    const settings: PrintSettings = {
      paperSize: current?.paperSize ?? "A4",
      orientation: current?.orientation ?? "portrait",
      scale: current?.scale ?? 100,
      bleedMm: Math.max(3, current?.bleedMm ?? 0),
      cropMarks: true,
      registrationMarks: true,
      colorHandling: current?.colorHandling ?? "app",
      proofPrint: current?.proofPrint ?? true,
      printerProfile: current?.printerProfile ?? activeDoc.colorManagement?.proofProfile ?? "Working CMYK",
      paperColor: current?.paperColor ?? "#ffffff",
      marksOffsetMm: current?.marksOffsetMm ?? 4,
      pagePosition: current?.pagePosition ?? "center",
    }
    dispatch({ type: "set-print-settings", settings })
    finishFix("Preflight Fix: Set Print Defaults")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[760px] border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Preflight Check</DialogTitle>
          <DialogDescription className="sr-only">Inspect the active document for handoff, export, and layer-structure issues.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-4 gap-2 text-[11px]">
          <Summary label="Pass" value={counts.pass} className="text-emerald-300" />
          <Summary label="Warn" value={counts.warn} className="text-amber-300" />
          <Summary label="Error" value={counts.error} className="text-red-300" />
          <Summary label="Info" value={counts.info} className="text-[var(--ps-text-dim)]" />
        </div>
        <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[11px] leading-5 text-[var(--ps-text-dim)]">
          Browser document audit only. Not a certified prepress or print-provider handoff check.
        </div>
        {report?.separationModel ? (
          <div className="grid grid-cols-4 gap-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[11px]">
            <Info label="Process" value={report.separationModel.process} />
            <Info label="Plates" value={report.separationModel.processPlates.join(", ") || "None"} />
            <Info label="Spot" value={`${report.separationModel.spotChannels.length}`} />
            <Info label="Alpha" value={`${report.separationModel.savedAlphaChannels.length}`} />
          </div>
        ) : null}
        <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">Quick fixes</div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            <QuickFixButton label="Show Hidden" count={fixCandidates.hiddenLayers.length} onClick={showHiddenLayers} />
            <QuickFixButton label="Name Layers" count={fixCandidates.unnamedLayers.length} onClick={nameUnnamedLayers} />
            <QuickFixButton label="Mask Adjust" count={fixCandidates.unmaskedAdjustments.length} onClick={maskAdjustmentLayers} />
            <QuickFixButton label="Remove Empty" count={Math.min(fixCandidates.emptyLayers.length, Math.max(0, activeDoc.layers.length - 1))} onClick={removeEmptyLayers} />
            <QuickFixButton label="Repair Slices" count={fixCandidates.invalidSlices.length} onClick={repairSlices} />
            <QuickFixButton label="Print Defaults" count={printDefaultCount} onClick={setPrintDefaults} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value as typeof categoryFilter)}
            className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]"
            aria-label="Preflight category filter"
          >
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]"
            aria-label="Preflight status filter"
          >
            <option value="All">All statuses</option>
            <option value="pass">Pass</option>
            <option value="warn">Warn</option>
            <option value="fail">Fail</option>
            <option value="info">Info</option>
          </select>
        </div>
        <div className="max-h-[56vh] overflow-y-auto rounded-sm border border-[var(--ps-divider)] text-[11px]">
          {filteredItems.length ? filteredItems.map((item) => (
            <div key={item.id} className="grid grid-cols-[72px_96px_140px_1fr_150px] gap-2 border-b border-[var(--ps-divider)] px-3 py-2 last:border-b-0">
              <span className={STATUS_CLASS[item.status]}>{item.status}</span>
              <span className="text-[var(--ps-text-dim)]">{item.category}</span>
              <span>{item.label}</span>
              <span className="text-[var(--ps-text-dim)]">{item.detail}</span>
              <span className="text-[var(--ps-text-dim)]">
                {item.fixAction
                  ? `${item.fixAction.autoFixable ? "Auto" : "Warn"}: ${item.fixAction.label}`
                : ""}
              </span>
            </div>
          )) : (
            <div className="p-8 text-center text-[var(--ps-text-dim)]">No preflight findings match the active filters.</div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => window.dispatchEvent(new CustomEvent("ps-open-document-report"))}>
            Round-Trip Inspector
          </Button>
          <Button variant="outline" size="sm" onClick={exportJson}>
            Export JSON
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            Export CSV
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`
}

function Summary({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">{label}</div>
      <div className={`text-lg tabular-nums ${className}`}>{value}</div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">{label}</div>
      <div className="truncate text-[var(--ps-text)]" title={value}>{value}</div>
    </div>
  )
}

function QuickFixButton({ label, count, onClick }: { label: string; count: number; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={count === 0}
      onClick={onClick}
      className="h-8 justify-center px-2 text-[10px]"
    >
      {label}{count ? ` (${count})` : ""}
    </Button>
  )
}
