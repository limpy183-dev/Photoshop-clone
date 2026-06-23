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
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import { Archive, Download, XCircle } from "lucide-react"
import {
  canvasToGifDataUrl,
  createDocumentReport,
  createExportLimitationReport,
  diagnoseBrowserRasterEncoders,
  downloadBlob,
  renderDocumentComposite,
  rasterMime,
  type BrowserRasterEncoderDiagnostic,
  type CompatibilityManifestEntry,
} from "./document-io"
import { useEditor, makeCanvas } from "./editor-context"
import { dispatchPhotoshopEvent } from "./events"
import { canvasSizeError } from "./canvas-limits"
import type { BrowserRasterExportFormat } from "./document-io"
import type { Layer, PsDocument, Slice, TimelineFrame } from "./types"
import { runBatchExportItems, type BatchExportFailure, type BatchExportProgressEvent } from "./batch-export-engine"
import { createStoredZipBlob, type StoredZipEntry } from "./zip-packaging"
import { batchAlternativesForLimitation, type ExportAlternative } from "./export-alternatives"

type BatchScope = "document" | "visible-layers" | "selected-layers" | "timeline" | "slices" | "sprite-layers" | "sprite-slices" | "sprite-timeline"
type RasterFormat = BrowserRasterExportFormat
const BATCH_RASTER_FORMATS = new Set<string>(["png", "jpeg", "webp", "avif", "gif"])

function isBatchRasterFormat(format: string): format is RasterFormat {
  return BATCH_RASTER_FORMATS.has(format)
}

function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").replace(/^-+|-+$/g, "") || "export"
}

function canvasForLayer(doc: PsDocument, layer: Layer) {
  const canvas = makeCanvas(doc.width, doc.height)
  const ctx = canvas.getContext("2d")!
  if (typeof layer.canvas?.getContext === "function") {
    ctx.drawImage(layer.canvas, 0, 0)
  }
  return canvas
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function normalizeSlice(slice: Slice, width: number, height: number) {
  const x = clamp(slice.x, 0, Math.max(0, width - 1))
  const y = clamp(slice.y, 0, Math.max(0, height - 1))
  const w = clamp(slice.w, 1, Math.max(1, width - x))
  const h = clamp(slice.h, 1, Math.max(1, height - y))
  return { ...slice, x, y, w, h }
}

function canvasForSlice(doc: PsDocument, source: HTMLCanvasElement, slice: Slice) {
  const normalized = normalizeSlice(slice, doc.width, doc.height)
  const canvas = makeCanvas(normalized.w, normalized.h)
  canvas
    .getContext("2d")!
    .drawImage(source, normalized.x, normalized.y, normalized.w, normalized.h, 0, 0, normalized.w, normalized.h)
  return canvas
}

function docWithFrame(doc: PsDocument, frame: TimelineFrame): PsDocument {
  return {
    ...doc,
    layers: doc.layers.map((layer) => ({
      ...layer,
      visible: frame.layerVisibility[layer.id] ?? layer.visible,
    })),
  }
}

function dataUrlToBlob(dataUrl: string) {
  const [header, body = ""] = dataUrl.split(",", 2)
  const mime = /^data:([^;]+)/i.exec(header)?.[1] ?? "application/octet-stream"
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function extensionForFormat(format: RasterFormat) {
  return format === "jpeg" ? "jpg" : format
}

async function encodeCanvas(canvas: HTMLCanvasElement, format: RasterFormat, quality: number, scale: number, matte: string) {
  const sizeError = canvasSizeError(canvas.width * scale, canvas.height * scale, "Export")
  if (sizeError) throw new Error(sizeError)
  const out = scale === 1 ? canvas : makeCanvas(canvas.width * scale, canvas.height * scale, format === "jpeg" ? matte : undefined)
  if (scale !== 1) {
    const ctx = out.getContext("2d")!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(canvas, 0, 0, out.width, out.height)
  }
  if (format === "gif") {
    return dataUrlToBlob(canvasToGifDataUrl(out, true))
  }
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, rasterMime(format), quality))
  if (!blob) throw new Error("Canvas encoder returned no blob")
  if ((format === "webp" || format === "avif") && blob.type && blob.type.toLowerCase() !== rasterMime(format)) {
    throw new Error(`${format.toUpperCase()} encoder returned ${blob.type}; this browser does not support ${rasterMime(format)} export.`)
  }
  return blob
}

async function downloadCanvas(canvas: HTMLCanvasElement, name: string, format: RasterFormat, quality: number, scale: number, matte: string) {
  downloadBlob(await encodeCanvas(canvas, format, quality, scale, matte), `${name}.${extensionForFormat(format)}`)
}

function alphaBounds(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
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
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }
  return any ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null
}

function trimCanvas(source: HTMLCanvasElement, matte: string) {
  const bounds = alphaBounds(source) ?? { x: 0, y: 0, w: source.width, h: source.height }
  const out = makeCanvas(bounds.w, bounds.h, matte)
  out.getContext("2d")!.drawImage(source, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h)
  return out
}

function spriteSheet(items: HTMLCanvasElement[], columns: number, padding: number, matte: string) {
  const cols = Math.max(1, columns)
  const rows = Math.max(1, Math.ceil(items.length / cols))
  const cellW = Math.max(1, ...items.map((item) => item.width))
  const cellH = Math.max(1, ...items.map((item) => item.height))
  const out = makeCanvas(cols * cellW + (cols + 1) * padding, rows * cellH + (rows + 1) * padding, matte)
  const ctx = out.getContext("2d")!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  items.forEach((item, index) => {
    const col = index % cols
    const row = Math.floor(index / cols)
    const x = padding + col * (cellW + padding) + (cellW - item.width) / 2
    const y = padding + row * (cellH + padding) + (cellH - item.height) / 2
    ctx.drawImage(item, x, y)
  })
  return out
}

interface BatchCanvasItem {
  name: string
  canvas: HTMLCanvasElement
}

function failureReportEntry(input: {
  scope: BatchScope
  exportFormat: RasterFormat
  completed: number
  total: number
  failed: BatchExportFailure[]
  canceled: boolean
}): StoredZipEntry {
  return {
    name: "_export-report.json",
    data: new TextEncoder().encode(JSON.stringify({
      app: "Photoshop Web",
      format: "batch-export-report",
      version: 1,
      generatedAt: new Date().toISOString(),
      ...input,
    }, null, 2)),
  }
}

export function BatchExportDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: Partial<{ scope: BatchScope; format: RasterFormat; scale: number; transparent: boolean }>
}) {
  const { activeDoc, selectedLayers, dispatch } = useEditor()
  const [scope, setScope] = React.useState<BatchScope>("document")
  const [format, setFormat] = React.useState<RasterFormat>("png")
  const [scale, setScale] = React.useState(1)
  const [quality, setQuality] = React.useState(0.92)
  const [transparent, setTransparent] = React.useState(true)
  const [matte, setMatte] = React.useState("#ffffff")
  const [spriteColumns, setSpriteColumns] = React.useState(4)
  const [spritePadding, setSpritePadding] = React.useState(8)
  const [packageZip, setPackageZip] = React.useState(true)
  const [continueOnError, setContinueOnError] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState<BatchExportProgressEvent | null>(null)
  const [failures, setFailures] = React.useState<BatchExportFailure[]>([])
  const [encoderDiagnostics, setEncoderDiagnostics] = React.useState<BrowserRasterEncoderDiagnostic[]>([])
  const abortRef = React.useRef<AbortController | null>(null)

  React.useEffect(() => {
    if (!open) return
    setScope(initial?.scope ?? "document")
    setFormat(initial?.format ?? "png")
    setScale(initial?.scale ?? 1)
    setTransparent(typeof initial?.transparent === "boolean" ? initial.transparent : true)
    setProgress(null)
    setFailures([])
  }, [open, initial])

  React.useEffect(() => {
    if (!open) return
    let disposed = false
    void diagnoseBrowserRasterEncoders(["webp", "avif"]).then((diagnostics) => {
      if (!disposed) setEncoderDiagnostics(diagnostics)
    })
    return () => {
      disposed = true
    }
  }, [open])

  // Broadcast active export target so StatusBar can surface format compat
  // warnings reactively. Clears when the dialog closes.
  React.useEffect(() => {
    if (!open) return
    dispatchPhotoshopEvent("ps-active-export-format", { format, source: "batch-export" })
  }, [format, open])
  React.useEffect(() => {
    if (open) return
    dispatchPhotoshopEvent("ps-active-export-format", { format: null, source: "batch-export" })
  }, [open])

  const applyAlternative = React.useCallback((alternative: ExportAlternative) => {
    if (isBatchRasterFormat(alternative.format)) {
      setFormat(alternative.format)
      return
    }
    dispatchPhotoshopEvent("ps-open-export-as", {
      dialog: "export-as",
      format: alternative.format,
      scale: Math.round(scale * 100),
      quality: Math.round(quality * 100),
      transparent,
      matte,
      includeMetadata: alternative.format === "metadata-json" ? true : undefined,
    })
    onOpenChange(false)
  }, [matte, onOpenChange, quality, scale, transparent])

  if (!activeDoc) return null

  const candidates =
    scope === "selected-layers"
      ? selectedLayers.filter((layer) => layer.kind !== "group")
      : activeDoc.layers.filter((layer) => layer.visible && layer.kind !== "group")

  const estimatedCount =
    scope === "document"
      ? 1
      : scope === "timeline" || scope === "sprite-timeline"
        ? activeDoc.timelineFrames?.length ?? 0
        : scope === "slices" || scope === "sprite-slices"
          ? activeDoc.slices?.length ?? 0
          : candidates.length

  const browserEncoderDiagnostic = encoderDiagnostics.find((item) => item.format === format)
  const progressPercent = progress?.total ? Math.round(((progress.completed + progress.failed) / progress.total) * 100) : 0
  const limitationReport = createExportLimitationReport(activeDoc, {
    format,
    transparent,
    quality: Math.round(quality * 100),
  })
  const visibleLimitations = limitationReport.items.filter((item) =>
    item.status === "flattened" || item.status === "approximated" || item.status === "unsupported",
  )

  const batchItems = (): BatchCanvasItem[] => {
    const baseName = safeName(activeDoc.name)
    const ext = extensionForFormat(format)
    if (scope === "document") {
      return [{
        name: `${baseName}.${ext}`,
        canvas: renderDocumentComposite(activeDoc, { transparent: transparent && format !== "jpeg", matte }),
      }]
    }
    if (scope === "timeline") {
      const frames = activeDoc.timelineFrames ?? []
      if (!frames.length) throw new Error("This document has no timeline frames")
      return frames.map((frame, index) => ({
        name: `${baseName}-frame-${String(index + 1).padStart(2, "0")}.${ext}`,
        canvas: renderDocumentComposite(docWithFrame(activeDoc, frame), { transparent: transparent && format !== "jpeg", matte }),
      }))
    }
    if (scope === "slices") {
      const slices = activeDoc.slices ?? []
      if (!slices.length) throw new Error("This document has no slices")
      const composite = renderDocumentComposite(activeDoc, { transparent: transparent && format !== "jpeg", matte })
      return slices.map((slice) => ({
        name: `${baseName}-${safeName(slice.name)}.${ext}`,
        canvas: canvasForSlice(activeDoc, composite, slice),
      }))
    }
    if (scope === "sprite-layers") {
      if (!candidates.length) throw new Error("No layers match the selected export scope")
      const items = candidates.map((layer) => trimCanvas(canvasForLayer(activeDoc, layer), transparent ? "transparent" : matte))
      return [{ name: `${baseName}-layer-sprite-sheet.${ext}`, canvas: spriteSheet(items, spriteColumns, spritePadding, transparent ? "transparent" : matte) }]
    }
    if (scope === "sprite-slices") {
      const slices = activeDoc.slices ?? []
      if (!slices.length) throw new Error("This document has no slices")
      const composite = renderDocumentComposite(activeDoc, { transparent: transparent && format !== "jpeg", matte })
      const items = slices.map((slice) => canvasForSlice(activeDoc, composite, slice))
      return [{ name: `${baseName}-slice-sprite-sheet.${ext}`, canvas: spriteSheet(items, spriteColumns, spritePadding, transparent ? "transparent" : matte) }]
    }
    if (scope === "sprite-timeline") {
      const frames = activeDoc.timelineFrames ?? []
      if (!frames.length) throw new Error("This document has no timeline frames")
      const items = frames.map((frame) => renderDocumentComposite(docWithFrame(activeDoc, frame), { transparent: transparent && format !== "jpeg", matte }))
      return [{ name: `${baseName}-timeline-sprite-sheet.${ext}`, canvas: spriteSheet(items, spriteColumns, spritePadding, transparent ? "transparent" : matte) }]
    }
    if (!candidates.length) throw new Error("No layers match the selected export scope")
    return candidates.map((layer) => ({
      name: `${baseName}-${safeName(layer.name)}.${ext}`,
      canvas: canvasForLayer(activeDoc, layer),
    }))
  }

  const exportNow = async () => {
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setProgress(null)
    setFailures([])
    try {
      const baseName = safeName(activeDoc.name)
      const items = batchItems()
      const shouldZip = packageZip && items.length > 1
      let finalFailureCount = 0
      if (items.length === 1 && !shouldZip) {
        const item = items[0]
        await downloadCanvas(item.canvas, item.name.replace(/\.[^.]+$/, ""), format, quality, scale, matte)
        setProgress({ total: 1, completed: 1, failed: 0, currentName: item.name, canceled: false })
      } else {
        const result = await runBatchExportItems(items, {
          signal: controller.signal,
          continueOnError,
          encode: async (item) => encodeCanvas(item.canvas, format, quality, scale, matte),
          onProgress: setProgress,
        })
        setFailures(result.failed)
        finalFailureCount = result.failed.length
        if (!result.entries.length && result.failed.length) {
          throw new Error(`All ${result.total} export item${result.total === 1 ? "" : "s"} failed`)
        }
        if (shouldZip) {
          const entries = result.failed.length || result.canceled
            ? [...result.entries, failureReportEntry({
                scope,
                exportFormat: format,
                completed: result.completed,
                total: result.total,
                failed: result.failed,
                canceled: result.canceled,
              })]
            : result.entries
          downloadBlob(createStoredZipBlob(entries), `${baseName}-${scope}.zip`)
        } else {
          for (const entry of result.entries) {
            downloadBlob(new Blob([entry.data], { type: rasterMime(format) }), entry.name)
          }
        }
        if (result.canceled) {
          toast.info(`Export canceled after ${result.completed} item${result.completed === 1 ? "" : "s"}`)
          return
        }
      }
      dispatch({ type: "add-document-report", report: createDocumentReport(activeDoc, "Batch Export") })
      const failedCount = finalFailureCount
      toast.success(failedCount ? `Exported with ${failedCount} failure${failedCount === 1 ? "" : "s"}` : `Exported ${estimatedCount} item${estimatedCount === 1 ? "" : "s"}`)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Batch export failed")
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px] border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Batch Export</DialogTitle>
          <DialogDescription className="sr-only">Export documents, layers, selected layers, timeline frames, or slices.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-[11px]">
          <label className="grid gap-1">
            <span className="text-[var(--ps-text-dim)]">Scope</span>
            <select value={scope} onChange={(e) => setScope(e.target.value as BatchScope)} className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2">
              <option value="document">Whole document</option>
              <option value="visible-layers">Visible layers</option>
              <option value="selected-layers">Selected layers</option>
              <option value="timeline">Timeline frames</option>
              <option value="slices">Slices</option>
              <option value="sprite-layers">Sprite sheet: visible layers</option>
              <option value="sprite-slices">Sprite sheet: slices</option>
              <option value="sprite-timeline">Sprite sheet: timeline frames</option>
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="grid gap-1">
              <span className="text-[var(--ps-text-dim)]">Format</span>
              <select value={format} onChange={(e) => setFormat(e.target.value as RasterFormat)} className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2">
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="webp">WebP</option>
                <option value="gif">GIF</option>
                <option value="avif">AVIF</option>
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-[var(--ps-text-dim)]">Scale</span>
              <select value={scale} onChange={(e) => setScale(Number(e.target.value))} className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2">
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={3}>3x</option>
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-[var(--ps-text-dim)]">Quality</span>
              <input type="number" min={0.1} max={1} step={0.01} value={quality} onChange={(e) => setQuality(Math.max(0.1, Math.min(1, Number(e.target.value) || 0.92)))} className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2">
              <Checkbox checked={transparent} disabled={format === "jpeg"} onCheckedChange={(v) => setTransparent(v === true)} />
              Transparent background
            </label>
            <label className="flex items-center gap-2">
              <span className="text-[var(--ps-text-dim)]">Matte</span>
              <input type="color" value={matte} onChange={(e) => setMatte(e.target.value)} className="h-7 w-10" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2">
              <Checkbox checked={packageZip} disabled={estimatedCount <= 1} onCheckedChange={(v) => setPackageZip(v === true)} />
              ZIP multi-file outputs
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={continueOnError} onCheckedChange={(v) => setContinueOnError(v === true)} />
              Continue after errors
            </label>
          </div>
          {scope.startsWith("sprite-") ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">
                <span className="text-[var(--ps-text-dim)]">Sprite columns</span>
                <input type="number" min={1} max={24} value={spriteColumns} onChange={(e) => setSpriteColumns(Math.max(1, Math.min(24, Number(e.target.value) || 4)))} className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2" />
              </label>
              <label className="grid gap-1">
                <span className="text-[var(--ps-text-dim)]">Sprite padding</span>
                <input type="number" min={0} max={256} value={spritePadding} onChange={(e) => setSpritePadding(Math.max(0, Math.min(256, Number(e.target.value) || 0)))} className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2" />
              </label>
            </div>
          ) : null}
          <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1.5 text-[10px] text-[var(--ps-text-dim)]">
            Ready to export {estimatedCount} item{estimatedCount === 1 ? "" : "s"}.
          </div>
          <BatchLimitationsBlock
            summary={limitationReport.summary}
            items={visibleLimitations}
            currentFormat={format}
            onPick={applyAlternative}
          />
          {(format === "webp" || format === "avif") && browserEncoderDiagnostic ? (
            <div className={`rounded-sm border px-2 py-1.5 text-[10px] ${browserEncoderDiagnostic.supported ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-100" : "border-red-500/35 bg-red-500/10 text-red-100"}`}>
              <div className="font-medium">{format.toUpperCase()} browser encoder</div>
              <div>{browserEncoderDiagnostic.message}</div>
              {!browserEncoderDiagnostic.supported ? (
                <BatchAlternativesRow
                  alternatives={[
                    { format: "png", label: "Use PNG", reason: "PNG is universally supported by the browser canvas encoder." },
                    { format: "jpeg", label: "Use JPEG", reason: "JPEG is universally supported (no alpha)." },
                  ]}
                  onPick={applyAlternative}
                  testId="batch-export-encoder-alt"
                />
              ) : null}
            </div>
          ) : null}
          {format === "jpeg" && transparent ? (
            <div className="rounded-sm border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-100">
              <div>JPEG cannot store alpha — transparent pixels will be flattened against the matte color.</div>
              <BatchAlternativesRow
                alternatives={batchAlternativesForLimitation("jpeg", {
                  label: "Alpha transparency",
                  detail: "JPEG has no alpha channel; transparent pixels are composited against the selected matte.",
                  status: "flattened",
                })}
                onPick={applyAlternative}
                testId="batch-export-jpeg-alpha-alt"
              />
            </div>
          ) : null}
          {format === "gif" ? (
            <div className="rounded-sm border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-100">
              <div>GIF is limited to a 256-color indexed palette with 1-bit transparency.</div>
              <BatchAlternativesRow
                alternatives={batchAlternativesForLimitation("gif", {
                  label: "GIF palette",
                  detail: "GIF export quantizes to a 256-color indexed palette with limited transparency.",
                  status: "approximated",
                })}
                onPick={applyAlternative}
                testId="batch-export-gif-alt"
              />
            </div>
          ) : null}
          {progress ? (
            <div className="space-y-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-2 text-[10px]">
              <div className="flex items-center justify-between">
                <span className="text-[var(--ps-text-dim)]">{progress.currentName ?? "Preparing export"}</span>
                <span className="tabular-nums">{progress.completed + progress.failed}/{progress.total}</span>
              </div>
              <Progress value={progressPercent} className="h-1.5" />
              {progress.failed ? (
                <div className="text-amber-200">{progress.failed} item{progress.failed === 1 ? "" : "s"} failed and {continueOnError ? "will be reported" : "stopped the batch"}.</div>
              ) : null}
            </div>
          ) : null}
          {failures.length ? (
            <div className="max-h-20 overflow-auto rounded-sm border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-100">
              {failures.slice(0, 4).map((failure) => (
                <div key={failure.name} className="truncate">{failure.name}: {failure.error}</div>
              ))}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (busy) abortRef.current?.abort()
              else onOpenChange(false)
            }}
          >
            {busy ? <XCircle className="h-4 w-4" /> : null}
            {busy ? "Cancel Batch" : "Cancel"}
          </Button>
          <Button size="sm" disabled={busy || estimatedCount === 0} onClick={exportNow}>
            {packageZip && estimatedCount > 1 ? <Archive className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            {busy ? "Exporting..." : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BatchAlternativesRow({
  alternatives,
  onPick,
  testId,
}: {
  alternatives: ExportAlternative[]
  onPick: (alternative: ExportAlternative) => void
  testId?: string
}) {
  if (!alternatives.length) return null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1" data-testid={testId}>
      <span className="text-[9px] uppercase tracking-wide text-[var(--ps-text-dim)]">Try:</span>
      {alternatives.map((alt) => (
        <button
          key={alt.format}
          type="button"
          title={alt.reason}
          onClick={() => onPick(alt)}
          className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-1.5 py-0.5 text-[10px] text-[var(--ps-text)] hover:border-amber-400/60 hover:bg-amber-400/10 hover:text-amber-100"
        >
          {alt.label}
        </button>
      ))}
    </div>
  )
}

function BatchLimitationsBlock({
  summary,
  items,
  currentFormat,
  onPick,
}: {
  summary: string
  items: CompatibilityManifestEntry[]
  currentFormat: RasterFormat
  onPick: (alternative: ExportAlternative) => void
}) {
  return (
    <div
      className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1.5 text-[10px] text-[var(--ps-text-dim)]"
      data-testid="batch-export-limitations"
    >
      <div className="mb-1 font-medium text-[var(--ps-text)]">{summary}</div>
      {items.length ? (
        <div className="grid gap-1.5">
          {items.map((item) => (
            <div key={`${item.label}-${item.status}`} className="grid grid-cols-[82px_1fr] gap-2">
              <span className="uppercase tracking-wide text-amber-300">{item.status}</span>
              <div>
                <div>{item.label}: {item.detail}</div>
                <BatchAlternativesRow
                  alternatives={batchAlternativesForLimitation(currentFormat, item)}
                  onPick={onPick}
                  testId={`batch-export-limitation-alt-${item.label.replace(/\s+/g, "-").toLowerCase()}`}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div>No destructive browser-raster limitations detected for this format.</div>
      )}
    </div>
  )
}
