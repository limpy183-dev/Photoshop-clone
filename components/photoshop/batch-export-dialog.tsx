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
import { canvasToGifDataUrl, createDocumentReport, downloadBlob, downloadDataUrl, renderDocumentComposite, rasterMime } from "./document-io"
import { useEditor, makeCanvas } from "./editor-context"
import { canvasSizeError } from "./canvas-limits"
import type { BrowserRasterExportFormat } from "./document-io"
import type { Layer, PsDocument, Slice, TimelineFrame } from "./types"

type BatchScope = "document" | "visible-layers" | "selected-layers" | "timeline" | "slices" | "sprite-layers" | "sprite-slices" | "sprite-timeline"
type RasterFormat = BrowserRasterExportFormat

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

async function downloadCanvas(canvas: HTMLCanvasElement, name: string, format: RasterFormat, quality: number, scale: number, matte: string) {
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
    downloadDataUrl(canvasToGifDataUrl(out, true), `${name}.gif`)
    return
  }
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, rasterMime(format), quality))
  if (!blob) throw new Error(`Could not export ${name}`)
  downloadBlob(blob, `${name}.${format === "jpeg" ? "jpg" : format}`)
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
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setScope(initial?.scope ?? "document")
    setFormat(initial?.format ?? "png")
    setScale(initial?.scale ?? 1)
    setTransparent(typeof initial?.transparent === "boolean" ? initial.transparent : true)
  }, [open, initial])

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

  const exportNow = async () => {
    setBusy(true)
    try {
      const baseName = safeName(activeDoc.name)
      if (scope === "document") {
        const canvas = renderDocumentComposite(activeDoc, { transparent: transparent && format !== "jpeg", matte })
        await downloadCanvas(canvas, baseName, format, quality, scale, matte)
      } else if (scope === "timeline") {
        const frames = activeDoc.timelineFrames ?? []
        if (!frames.length) throw new Error("This document has no timeline frames")
        for (let i = 0; i < frames.length; i++) {
          const canvas = renderDocumentComposite(docWithFrame(activeDoc, frames[i]), { transparent: transparent && format !== "jpeg", matte })
          await downloadCanvas(canvas, `${baseName}-frame-${String(i + 1).padStart(2, "0")}`, format, quality, scale, matte)
        }
      } else if (scope === "slices") {
        const slices = activeDoc.slices ?? []
        if (!slices.length) throw new Error("This document has no slices")
        const composite = renderDocumentComposite(activeDoc, { transparent: transparent && format !== "jpeg", matte })
        for (const slice of slices) {
          await downloadCanvas(canvasForSlice(activeDoc, composite, slice), `${baseName}-${safeName(slice.name)}`, format, quality, scale, matte)
        }
      } else if (scope === "sprite-layers") {
        if (!candidates.length) throw new Error("No layers match the selected export scope")
        const items = candidates.map((layer) => trimCanvas(canvasForLayer(activeDoc, layer), transparent ? "transparent" : matte))
        await downloadCanvas(spriteSheet(items, spriteColumns, spritePadding, transparent ? "transparent" : matte), `${baseName}-layer-sprite-sheet`, format, quality, scale, matte)
      } else if (scope === "sprite-slices") {
        const slices = activeDoc.slices ?? []
        if (!slices.length) throw new Error("This document has no slices")
        const composite = renderDocumentComposite(activeDoc, { transparent: transparent && format !== "jpeg", matte })
        const items = slices.map((slice) => canvasForSlice(activeDoc, composite, slice))
        await downloadCanvas(spriteSheet(items, spriteColumns, spritePadding, transparent ? "transparent" : matte), `${baseName}-slice-sprite-sheet`, format, quality, scale, matte)
      } else if (scope === "sprite-timeline") {
        const frames = activeDoc.timelineFrames ?? []
        if (!frames.length) throw new Error("This document has no timeline frames")
        const items = frames.map((frame) => renderDocumentComposite(docWithFrame(activeDoc, frame), { transparent: transparent && format !== "jpeg", matte }))
        await downloadCanvas(spriteSheet(items, spriteColumns, spritePadding, transparent ? "transparent" : matte), `${baseName}-timeline-sprite-sheet`, format, quality, scale, matte)
      } else {
        if (!candidates.length) throw new Error("No layers match the selected export scope")
        for (const layer of candidates) {
          await downloadCanvas(canvasForLayer(activeDoc, layer), `${baseName}-${safeName(layer.name)}`, format, quality, scale, matte)
        }
      }
      dispatch({ type: "add-document-report", report: createDocumentReport(activeDoc, "Batch Export") })
      toast.success(`Exported ${estimatedCount} item${estimatedCount === 1 ? "" : "s"}`)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Batch export failed")
    } finally {
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
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={busy || estimatedCount === 0} onClick={exportNow}>{busy ? "Exporting..." : "Export"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
