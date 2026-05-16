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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { makeCanvas, makeDocument, useEditor } from "./editor-context"
import { canvasToGifDataUrl, downloadBlob, downloadDataUrl, loadImageFromFile, rasterMime } from "./document-io"
import { FILTERS } from "./filters"
import type { ExportFormat, RasterExportOptions } from "./document-io"

type RasterFormat = Exclude<ExportFormat, "svg">
type BatchOperation = "none" | "auto-tone" | "auto-contrast" | "auto-color" | "equalize" | "hdr-toning"

const RASTER_FORMATS: RasterFormat[] = ["jpeg", "png", "webp", "gif", "avif"]
const FORMAT_LABELS: Record<RasterFormat, string> = {
  jpeg: "JPEG",
  png: "PNG",
  webp: "WebP",
  gif: "GIF",
  avif: "AVIF",
}

type RasterFormatCapability = {
  supported: boolean
  summary: string
}

function canEncodeMime(mime: string) {
  if (typeof document === "undefined") return true
  const canvas = document.createElement("canvas")
  canvas.width = 1
  canvas.height = 1
  try {
    return canvas.toDataURL(mime).startsWith(`data:${mime}`)
  } catch {
    return false
  }
}

function getRasterFormatCapability(format: RasterFormat): RasterFormatCapability {
  if (format === "jpeg" || format === "png") return { supported: true, summary: "Browser canvas encoder" }
  if (format === "gif") return { supported: true, summary: "App single-frame indexed encoder; no animation timeline" }
  const mime = rasterMime(format)
  const supported = canEncodeMime(mime)
  return {
    supported,
    summary: supported ? "Browser canvas encoder available" : `This browser cannot encode ${FORMAT_LABELS[format]} from canvas`,
  }
}

function getRasterFormatCapabilities() {
  return Object.fromEntries(RASTER_FORMATS.map((format) => [format, getRasterFormatCapability(format)])) as Record<RasterFormat, RasterFormatCapability>
}

function safeName(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-") || "image"
}

function imageToCanvas(img: HTMLImageElement, maxWidth: number, maxHeight: number, resize: boolean) {
  let width = img.naturalWidth
  let height = img.naturalHeight
  if (resize && maxWidth > 0 && maxHeight > 0) {
    const ratio = Math.min(maxWidth / width, maxHeight / height, 1)
    width = Math.max(1, Math.round(width * ratio))
    height = Math.max(1, Math.round(height * ratio))
  }
  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext("2d")!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(img, 0, 0, width, height)
  return canvas
}

function autoTone(canvas: HTMLCanvasElement, perChannel: boolean) {
  const ctx = canvas.getContext("2d")!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const mins = [255, 255, 255]
  const maxs = [0, 0, 0]
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue
    if (perChannel) {
      for (let c = 0; c < 3; c++) {
        mins[c] = Math.min(mins[c], img.data[i + c])
        maxs[c] = Math.max(maxs[c], img.data[i + c])
      }
    } else {
      const v = Math.round(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2])
      mins[0] = Math.min(mins[0], v)
      maxs[0] = Math.max(maxs[0], v)
    }
  }
  for (let i = 0; i < img.data.length; i += 4) {
    if (perChannel) {
      for (let c = 0; c < 3; c++) {
        const range = Math.max(1, maxs[c] - mins[c])
        img.data[i + c] = Math.max(0, Math.min(255, ((img.data[i + c] - mins[c]) * 255) / range))
      }
    } else {
      const range = Math.max(1, maxs[0] - mins[0])
      for (let c = 0; c < 3; c++) {
        img.data[i + c] = Math.max(0, Math.min(255, ((img.data[i + c] - mins[0]) * 255) / range))
      }
    }
  }
  ctx.putImageData(img, 0, 0)
}

function autoColor(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let count = 0
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue
    sumR += img.data[i]
    sumG += img.data[i + 1]
    sumB += img.data[i + 2]
    count++
  }
  if (!count) return
  const gray = (sumR + sumG + sumB) / (3 * count)
  const gains = [gray / Math.max(1, sumR / count), gray / Math.max(1, sumG / count), gray / Math.max(1, sumB / count)]
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = Math.max(0, Math.min(255, img.data[i] * gains[0]))
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] * gains[1]))
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] * gains[2]))
  }
  ctx.putImageData(img, 0, 0)
}

function applyOperation(canvas: HTMLCanvasElement, operation: BatchOperation) {
  if (operation === "auto-tone") autoTone(canvas, false)
  if (operation === "auto-contrast") autoTone(canvas, true)
  if (operation === "auto-color") autoColor(canvas)
  if (operation === "equalize" || operation === "hdr-toning") {
    const ctx = canvas.getContext("2d")!
    const src = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const filter = FILTERS[operation]
    const params: Record<string, number | string | boolean> = {}
    for (const param of filter.params) params[param.key] = param.default
    ctx.putImageData(filter.apply(src, params), 0, 0)
  }
}

async function exportCanvas(canvas: HTMLCanvasElement, filename: string, options: Pick<RasterExportOptions, "format" | "quality" | "transparent" | "matte">) {
  const capability = getRasterFormatCapability(options.format)
  if (!capability.supported) {
    throw new Error(`${FORMAT_LABELS[options.format]} export is unavailable: ${capability.summary}`)
  }
  const needsMatte = options.format === "jpeg" || !options.transparent
  const out = needsMatte ? makeCanvas(canvas.width, canvas.height, options.matte) : makeCanvas(canvas.width, canvas.height)
  out.getContext("2d")!.drawImage(canvas, 0, 0)
  if (options.format === "gif") {
    downloadDataUrl(canvasToGifDataUrl(out, options.transparent), `${filename}.gif`)
    return
  }
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, rasterMime(options.format), options.quality))
  if (!blob) throw new Error(`Could not export ${filename} as ${FORMAT_LABELS[options.format]}`)
  if ((options.format === "webp" || options.format === "avif") && blob.type && blob.type !== rasterMime(options.format)) {
    throw new Error(`${FORMAT_LABELS[options.format]} export returned ${blob.type}; this browser does not support the requested encoder`)
  }
  downloadBlob(blob, `${filename}.${options.format === "jpeg" ? "jpg" : options.format}`)
}

export function BatchProcessingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [files, setFiles] = React.useState<File[]>([])
  const [operation, setOperation] = React.useState<BatchOperation>("auto-tone")
  const [format, setFormat] = React.useState<RasterFormat>("jpeg")
  const [quality, setQuality] = React.useState(0.9)
  const [resize, setResize] = React.useState(false)
  const [maxWidth, setMaxWidth] = React.useState(1920)
  const [maxHeight, setMaxHeight] = React.useState(1080)
  const [transparent, setTransparent] = React.useState(true)
  const [matte, setMatte] = React.useState("#ffffff")
  const [busy, setBusy] = React.useState(false)

  const process = async () => {
    if (!files.length) return
    setBusy(true)
    try {
      for (const file of files) {
        try {
          const img = await loadImageFromFile(file)
          const canvas = imageToCanvas(img, maxWidth, maxHeight, resize)
          applyOperation(canvas, operation)
          await exportCanvas(canvas, `${safeName(file.name)}-${operation}`, { format, quality, transparent, matte })
        } catch (error) {
          throw new Error(`${file.name}: ${error instanceof Error ? error.message : "Processing failed"}`)
        }
      }
      toast.success(`Processed ${files.length} file${files.length === 1 ? "" : "s"}`)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Batch processing failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <ProcessingShell title="Batch Processing" description="Process multiple image files with a selected operation and export settings." open={open} onOpenChange={onOpenChange}>
      <FilePicker files={files} setFiles={setFiles} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Operation">
          <select value={operation} onChange={(event) => setOperation(event.target.value as BatchOperation)} className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]">
            <option value="auto-tone">Auto Tone</option>
            <option value="auto-contrast">Auto Contrast</option>
            <option value="auto-color">Auto Color</option>
            <option value="equalize">Equalize</option>
            <option value="hdr-toning">HDR Toning</option>
          </select>
        </Field>
        <ExportControls format={format} setFormat={setFormat} quality={quality} setQuality={setQuality} transparent={transparent} setTransparent={setTransparent} matte={matte} setMatte={setMatte} />
      </div>
      <ResizeControls resize={resize} setResize={setResize} maxWidth={maxWidth} setMaxWidth={setMaxWidth} maxHeight={maxHeight} setMaxHeight={setMaxHeight} />
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button disabled={!files.length || busy} onClick={process}>{busy ? "Processing..." : "Run Batch"}</Button>
      </DialogFooter>
    </ProcessingShell>
  )
}

export function ImageProcessorDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { createDocument } = useEditor()
  const [files, setFiles] = React.useState<File[]>([])
  const [format, setFormat] = React.useState<RasterFormat>("jpeg")
  const [quality, setQuality] = React.useState(0.92)
  const [resize, setResize] = React.useState(true)
  const [maxWidth, setMaxWidth] = React.useState(2048)
  const [maxHeight, setMaxHeight] = React.useState(2048)
  const [transparent, setTransparent] = React.useState(true)
  const [matte, setMatte] = React.useState("#ffffff")
  const [openFirst, setOpenFirst] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const process = async () => {
    if (!files.length) return
    setBusy(true)
    try {
      let firstCanvas: HTMLCanvasElement | null = null
      for (const file of files) {
        try {
          const img = await loadImageFromFile(file)
          const canvas = imageToCanvas(img, maxWidth, maxHeight, resize)
          if (!firstCanvas) firstCanvas = canvas
          await exportCanvas(canvas, `${safeName(file.name)}-processed`, { format, quality, transparent, matte })
        } catch (error) {
          throw new Error(`${file.name}: ${error instanceof Error ? error.message : "Processing failed"}`)
        }
      }
      if (openFirst && firstCanvas) {
        const doc = makeDocument("Image Processor Result", firstCanvas.width, firstCanvas.height, "transparent")
        const layer = doc.layers.find((candidate) => candidate.id === doc.activeLayerId)
        if (layer) layer.canvas.getContext("2d")!.drawImage(firstCanvas, 0, 0)
        createDocument(doc, "Image Processor")
      }
      toast.success(`Processed ${files.length} image${files.length === 1 ? "" : "s"}`)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Image Processor failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <ProcessingShell title="Image Processor" description="Resize and convert image files while preserving transparency where supported." open={open} onOpenChange={onOpenChange}>
      <FilePicker files={files} setFiles={setFiles} />
      <ExportControls format={format} setFormat={setFormat} quality={quality} setQuality={setQuality} transparent={transparent} setTransparent={setTransparent} matte={matte} setMatte={setMatte} />
      <ResizeControls resize={resize} setResize={setResize} maxWidth={maxWidth} setMaxWidth={setMaxWidth} maxHeight={maxHeight} setMaxHeight={setMaxHeight} />
      <label className="flex items-center gap-2 text-[11px]">
        <Checkbox checked={openFirst} onCheckedChange={(value) => setOpenFirst(value === true)} />
        Open first processed file as a document
      </label>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button disabled={!files.length || busy} onClick={process}>{busy ? "Processing..." : "Process Images"}</Button>
      </DialogFooter>
    </ProcessingShell>
  )
}

function ProcessingShell({
  title,
  description,
  open,
  onOpenChange,
  children,
}: {
  title: string
  description: string
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[620px] border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-[11px] text-[var(--ps-text-dim)]">{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-[11px]">{children}</div>
      </DialogContent>
    </Dialog>
  )
}

function FilePicker({ files, setFiles }: { files: File[]; setFiles: (files: File[]) => void }) {
  return (
    <label className="flex h-20 cursor-pointer flex-col items-center justify-center rounded-sm border border-dashed border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[11px] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)]">
      {files.length ? `${files.length} image files selected` : "Choose image files"}
      <input type="file" multiple accept="image/*" className="hidden" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
    </label>
  )
}

function ExportControls({
  format,
  setFormat,
  quality,
  setQuality,
  transparent,
  setTransparent,
  matte,
  setMatte,
}: {
  format: RasterFormat
  setFormat: (format: RasterFormat) => void
  quality: number
  setQuality: (quality: number) => void
  transparent: boolean
  setTransparent: (transparent: boolean) => void
  matte: string
  setMatte: (matte: string) => void
}) {
  const [capabilities, setCapabilities] = React.useState<Record<RasterFormat, RasterFormatCapability>>(() => getRasterFormatCapabilities())
  React.useEffect(() => {
    setCapabilities(getRasterFormatCapabilities())
  }, [])
  React.useEffect(() => {
    if (!capabilities[format]?.supported) setFormat("png")
  }, [capabilities, format, setFormat])
  const activeCapability = capabilities[format]
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Format">
        <select value={format} onChange={(event) => setFormat(event.target.value as RasterFormat)} className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]">
          {RASTER_FORMATS.map((item) => (
            <option key={item} value={item} disabled={!capabilities[item]?.supported}>
              {FORMAT_LABELS[item]}{capabilities[item]?.supported === false ? " (unsupported)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Quality">
        <Input type="number" min={0.1} max={1} step={0.01} value={quality} onChange={(event) => setQuality(Math.max(0.1, Math.min(1, Number(event.target.value) || 0.9)))} className="h-8 bg-[var(--ps-panel-2)] text-[11px]" />
      </Field>
      <label className="flex items-center gap-2 pt-5 text-[11px]">
        <Checkbox checked={transparent} disabled={format === "jpeg"} onCheckedChange={(value) => setTransparent(value === true)} />
        Transparency
      </label>
      <Field label="Matte">
        <Input type="color" value={matte} onChange={(event) => setMatte(event.target.value)} className="h-8 w-20 p-1" />
      </Field>
      <p className="col-span-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-2 text-[11px] text-[var(--ps-text-dim)]">
        {FORMAT_LABELS[format]}: {activeCapability?.summary ?? "Checking browser encoder support"}. WebP and AVIF depend on the current browser canvas encoder; GIF output is a static indexed image.
      </p>
    </div>
  )
}

function ResizeControls({
  resize,
  setResize,
  maxWidth,
  setMaxWidth,
  maxHeight,
  setMaxHeight,
}: {
  resize: boolean
  setResize: (resize: boolean) => void
  maxWidth: number
  setMaxWidth: (value: number) => void
  maxHeight: number
  setMaxHeight: (value: number) => void
}) {
  return (
    <div className="grid grid-cols-[auto_1fr_1fr] items-end gap-3">
      <label className="flex items-center gap-2 pb-2 text-[11px]">
        <Checkbox checked={resize} onCheckedChange={(value) => setResize(value === true)} />
        Resize to fit
      </label>
      <Field label="Max width">
        <Input type="number" min={1} value={maxWidth} onChange={(event) => setMaxWidth(Math.max(1, Number(event.target.value) || 1))} className="h-8 bg-[var(--ps-panel-2)] text-[11px]" />
      </Field>
      <Field label="Max height">
        <Input type="number" min={1} value={maxHeight} onChange={(event) => setMaxHeight(Math.max(1, Number(event.target.value) || 1))} className="h-8 bg-[var(--ps-panel-2)] text-[11px]" />
      </Field>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <Label className="text-[11px] text-[var(--ps-text-dim)]">{label}</Label>
      {children}
    </div>
  )
}
