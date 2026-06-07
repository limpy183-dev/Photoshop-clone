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
import { Textarea } from "@/components/ui/textarea"
import { makeCanvas, makeDocument, useEditor } from "./editor-context"
import { canvasToGifDataUrl, downloadBlob, downloadDataUrl, loadRasterCanvasFromFile, rasterMime, renderDocumentComposite } from "./document-io"
import type { BrowserRasterExportFormat } from "./document-io"
import {
  encodeJpegImageData,
  encodePngImageData,
  injectAvifXmpMetadata,
  injectWebpXmpMetadata,
  type RasterExportMetadata,
} from "./raster-codecs"

type WatermarkPosition = "top-left" | "top-center" | "top-right" | "middle-left" | "center" | "middle-right" | "bottom-left" | "bottom-center" | "bottom-right"

interface WatermarkOptions {
  enabled: boolean
  text: string
  position: WatermarkPosition
  opacity: number
  fontSize: number
  color: string
  shadow: boolean
}

interface MetadataOptions {
  copyright: string
  author: string
  title: string
}

const WATERMARK_POSITIONS: { id: WatermarkPosition; label: string }[] = [
  { id: "top-left", label: "Top Left" },
  { id: "top-center", label: "Top Center" },
  { id: "top-right", label: "Top Right" },
  { id: "middle-left", label: "Middle Left" },
  { id: "center", label: "Center" },
  { id: "middle-right", label: "Middle Right" },
  { id: "bottom-left", label: "Bottom Left" },
  { id: "bottom-center", label: "Bottom Center" },
  { id: "bottom-right", label: "Bottom Right" },
]

function drawWatermark(canvas: HTMLCanvasElement, options: WatermarkOptions) {
  if (!options.enabled || !options.text.trim()) return
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  const fontSize = Math.max(8, Math.round(options.fontSize))
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, options.opacity))
  ctx.font = `${fontSize}px sans-serif`
  ctx.fillStyle = options.color
  const padding = Math.round(fontSize * 0.6)
  const metrics = ctx.measureText(options.text)
  const textWidth = metrics.width
  const textHeight = fontSize
  let x = padding
  let y = padding + textHeight
  ctx.textAlign = "left"
  ctx.textBaseline = "alphabetic"
  if (options.position.includes("right")) x = canvas.width - padding - textWidth
  else if (options.position.includes("center")) x = (canvas.width - textWidth) / 2
  if (options.position.startsWith("middle")) y = (canvas.height + textHeight) / 2
  else if (options.position.startsWith("bottom")) y = canvas.height - padding
  if (options.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.55)"
    ctx.shadowBlur = Math.max(2, Math.round(fontSize * 0.18))
    ctx.shadowOffsetX = 1
    ctx.shadowOffsetY = 1
  }
  ctx.fillText(options.text, x, y)
  ctx.restore()
}

function metadataFromOptions(options: MetadataOptions): RasterExportMetadata | undefined {
  const copyright = options.copyright.trim()
  const author = options.author.trim()
  const title = options.title.trim()
  if (!copyright && !author && !title) return undefined
  return {
    ...(title ? { title } : {}),
    ...(author ? { author } : {}),
    ...(copyright ? { copyright } : {}),
  }
}

async function blobFromArrayBuffer(buffer: ArrayBuffer, mime: string) {
  return new Blob([buffer], { type: mime })
}

async function encodeWithMetadata(
  canvas: HTMLCanvasElement,
  format: RasterFormat,
  quality: number,
  metadata: RasterExportMetadata,
): Promise<Blob | null> {
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  if (format === "jpeg") {
    const buffer = await encodeJpegImageData(imageData, { quality, progressive: true, metadata })
    return blobFromArrayBuffer(buffer, "image/jpeg")
  }
  if (format === "png") {
    const buffer = await encodePngImageData(imageData, { metadata })
    return blobFromArrayBuffer(buffer, "image/png")
  }
  if (format === "webp" || format === "avif") {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, rasterMime(format), quality))
    if (!blob) return null
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const injected = format === "webp" ? injectWebpXmpMetadata(bytes, metadata) : injectAvifXmpMetadata(bytes, metadata)
    return new Blob([injected], { type: blob.type })
  }
  return null
}
import {
  DEFAULT_AUTOMATION_OUTPUT,
  createAutomationWorkflow,
  executeCanvasWorkflow,
  loadAutomationWorkflows,
  loadCommandMacros,
  macroToWorkflow,
  parseSafeDslCommands,
  renderTemplateName,
  type AutomationOperation,
  type AutomationWorkflow,
  type CommandMacro,
} from "./automation-engine"
import type { ImageProcessorWorkflowPreset } from "./workflow-presets"

type RasterFormat = BrowserRasterExportFormat
type BatchOperation = AutomationOperation

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

function sourceToCanvas(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, maxWidth: number, maxHeight: number, resize: boolean) {
  let width = sourceWidth
  let height = sourceHeight
  if (resize && maxWidth > 0 && maxHeight > 0) {
    const ratio = Math.min(maxWidth / width, maxHeight / height, 1)
    width = Math.max(1, Math.round(width * ratio))
    height = Math.max(1, Math.round(height * ratio))
  }
  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext("2d")!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(source, 0, 0, width, height)
  return canvas
}

async function exportCanvas(
  canvas: HTMLCanvasElement,
  filename: string,
  options: { format: RasterFormat; quality: number; transparent: boolean; matte: string; watermark?: WatermarkOptions; metadata?: RasterExportMetadata },
) {
  const capability = getRasterFormatCapability(options.format)
  if (!capability.supported) {
    throw new Error(`${FORMAT_LABELS[options.format]} export is unavailable: ${capability.summary}`)
  }
  const needsMatte = options.format === "jpeg" || !options.transparent
  const out = needsMatte ? makeCanvas(canvas.width, canvas.height, options.matte) : makeCanvas(canvas.width, canvas.height)
  out.getContext("2d")!.drawImage(canvas, 0, 0)
  if (options.watermark) drawWatermark(out, options.watermark)
  if (options.format === "gif") {
    downloadDataUrl(canvasToGifDataUrl(out, options.transparent), `${filename}.gif`)
    return
  }
  if (options.metadata && (options.format === "jpeg" || options.format === "png" || options.format === "webp" || options.format === "avif")) {
    const metaBlob = await encodeWithMetadata(out, options.format, options.quality, options.metadata)
    if (metaBlob) {
      downloadBlob(metaBlob, `${filename}.${options.format === "jpeg" ? "jpg" : options.format}`)
      return
    }
  }
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, rasterMime(options.format), options.quality))
  if (!blob) throw new Error(`Could not export ${filename} as ${FORMAT_LABELS[options.format]}`)
  if ((options.format === "webp" || options.format === "avif") && blob.type && blob.type !== rasterMime(options.format)) {
    throw new Error(`${FORMAT_LABELS[options.format]} export returned ${blob.type}; this browser does not support the requested encoder`)
  }
  downloadBlob(blob, `${filename}.${options.format === "jpeg" ? "jpg" : options.format}`)
}

export function BatchProcessingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { documents } = useEditor()
  const [files, setFiles] = React.useState<File[]>([])
  const [operation, setOperation] = React.useState<BatchOperation>("auto-tone")
  const [workflowMode, setWorkflowMode] = React.useState<"operation" | "macro" | "script" | "workflow">("operation")
  const [macros, setMacros] = React.useState<CommandMacro[]>([])
  const [workflows, setWorkflows] = React.useState<AutomationWorkflow[]>([])
  const [macroId, setMacroId] = React.useState("")
  const [workflowId, setWorkflowId] = React.useState("")
  const [scriptSource, setScriptSource] = React.useState('report("Batch script")\nautoTone()')
  const [format, setFormat] = React.useState<RasterFormat>("jpeg")
  const [quality, setQuality] = React.useState(0.9)
  const [resize, setResize] = React.useState(false)
  const [maxWidth, setMaxWidth] = React.useState(1920)
  const [maxHeight, setMaxHeight] = React.useState(1080)
  const [transparent, setTransparent] = React.useState(true)
  const [matte, setMatte] = React.useState("#ffffff")
  const [filenameTemplate, setFilenameTemplate] = React.useState(DEFAULT_AUTOMATION_OUTPUT.filenameTemplate)
  const [includeOpenDocuments, setIncludeOpenDocuments] = React.useState(false)
  const [log, setLog] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    const nextMacros = loadCommandMacros()
    const nextWorkflows = loadAutomationWorkflows()
    setMacros(nextMacros)
    setWorkflows(nextWorkflows)
    setMacroId((current) => current || nextMacros[0]?.id || "")
    setWorkflowId((current) => current || nextWorkflows[0]?.id || "")
  }, [open])

  const appendLog = (line: string) => setLog((prev) => [...prev.slice(-80), line])

  const buildWorkflow = () => {
    const output = { format, quality, transparent, matte, filenameTemplate }
    if (workflowMode === "macro") {
      const macro = macros.find((item) => item.id === macroId)
      if (!macro) throw new Error("Choose a command macro before running the batch.")
      return macroToWorkflow(macro, output)
    }
    if (workflowMode === "script") {
      parseSafeDslCommands(scriptSource)
      return createAutomationWorkflow("Ad Hoc Script", [{ id: "script-step", type: "script", source: scriptSource }], output)
    }
    if (workflowMode === "workflow") {
      const workflow = workflows.find((item) => item.id === workflowId)
      if (!workflow) throw new Error("Choose a saved workflow before running the batch.")
      return { ...workflow, output: { ...workflow.output, ...output } }
    }
    const steps = [
      { id: "operation-step", type: "operation" as const, operation },
      ...(resize ? [{ id: "resize-step", type: "resize" as const, maxWidth, maxHeight }] : []),
    ]
    return createAutomationWorkflow(operation, steps, output)
  }

  const process = async () => {
    if (!files.length && !includeOpenDocuments) return
    setBusy(true)
    setLog([])
    try {
      const workflow = buildWorkflow()
      let processed = 0
      for (const file of files) {
        try {
          const raster = await loadRasterCanvasFromFile(file, { mode: "reduced-scale" })
          const canvas = sourceToCanvas(raster.canvas, raster.canvas.width, raster.canvas.height, maxWidth, maxHeight, resize)
          const output = await executeCanvasWorkflow(canvas, workflow, { makeCanvas, log: appendLog })
          const filename = renderTemplateName(workflow.output.filenameTemplate, { name: safeName(file.name), workflow: workflow.name }, processed)
          await exportCanvas(output, filename, workflow.output)
          processed++
          appendLog(`${file.name}: exported ${filename}`)
        } catch (error) {
          throw new Error(`${file.name}: ${error instanceof Error ? error.message : "Processing failed"}`)
        }
      }
      if (includeOpenDocuments) {
        for (const doc of documents) {
          const source = renderDocumentComposite(doc, { transparent: true })
          const output = await executeCanvasWorkflow(source, workflow, { makeCanvas, log: appendLog })
          const filename = renderTemplateName(workflow.output.filenameTemplate, { name: safeName(doc.name), workflow: workflow.name }, processed)
          await exportCanvas(output, filename, workflow.output)
          processed++
          appendLog(`${doc.name}: exported ${filename}`)
        }
      }
      toast.success(`Processed ${processed} item${processed === 1 ? "" : "s"}`)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Batch processing failed")
      appendLog(err instanceof Error ? err.message : "Batch processing failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <ProcessingShell title="Batch Processing" description="Process multiple image files with a selected operation and export settings." open={open} onOpenChange={onOpenChange}>
      <FilePicker files={files} setFiles={setFiles} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Workflow source">
          <select value={workflowMode} onChange={(event) => setWorkflowMode(event.target.value as typeof workflowMode)} className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]">
            <option value="operation">Built-in operation</option>
            <option value="macro">Command macro</option>
            <option value="script">Safe script</option>
            <option value="workflow">Saved workflow / droplet</option>
          </select>
        </Field>
        {workflowMode === "operation" && (
          <Field label="Operation">
            <select value={operation} onChange={(event) => setOperation(event.target.value as BatchOperation)} className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]">
              <option value="auto-tone">Auto Tone</option>
              <option value="auto-contrast">Auto Contrast</option>
              <option value="auto-color">Auto Color</option>
              <option value="equalize">Equalize</option>
              <option value="hdr-toning">HDR Toning</option>
              <option value="invert">Invert</option>
              <option value="grayscale">Grayscale</option>
              <option value="desaturate">Desaturate</option>
            </select>
          </Field>
        )}
        {workflowMode === "macro" && (
          <Field label="Macro">
            <select value={macroId} onChange={(event) => setMacroId(event.target.value)} className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]">
              {macros.length ? macros.map((macro) => <option key={macro.id} value={macro.id}>{macro.name}</option>) : <option value="">No macros saved</option>}
            </select>
          </Field>
        )}
        {workflowMode === "workflow" && (
          <Field label="Saved workflow">
            <select value={workflowId} onChange={(event) => setWorkflowId(event.target.value)} className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px]">
              {workflows.length ? workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>) : <option value="">No workflows saved</option>}
            </select>
          </Field>
        )}
      </div>
      {workflowMode === "script" && (
        <Textarea value={scriptSource} onChange={(event) => setScriptSource(event.target.value)} className="h-24 resize-none font-mono text-[11px]" spellCheck={false} />
      )}
      <ExportControls format={format} setFormat={setFormat} quality={quality} setQuality={setQuality} transparent={transparent} setTransparent={setTransparent} matte={matte} setMatte={setMatte} />
      <Field label="Filename template">
        <Input value={filenameTemplate} onChange={(event) => setFilenameTemplate(event.target.value)} className="h-8 bg-[var(--ps-panel-2)] text-[11px]" />
      </Field>
      <ResizeControls resize={resize} setResize={setResize} maxWidth={maxWidth} setMaxWidth={setMaxWidth} maxHeight={maxHeight} setMaxHeight={setMaxHeight} />
      <label className="flex items-center gap-2 text-[11px]">
        <Checkbox checked={includeOpenDocuments} onCheckedChange={(value) => setIncludeOpenDocuments(value === true)} />
        Include open documents ({documents.length})
      </label>
      {log.length ? (
        <div className="max-h-28 overflow-y-auto rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 font-mono text-[10px] text-[var(--ps-text-dim)]">
          {log.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}
        </div>
      ) : null}
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button disabled={(!files.length && !includeOpenDocuments) || busy} onClick={process}>{busy ? "Processing..." : "Run Batch"}</Button>
      </DialogFooter>
    </ProcessingShell>
  )
}

export function ImageProcessorDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: ImageProcessorWorkflowPreset
}) {
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
  const [watermark, setWatermark] = React.useState<WatermarkOptions>({
    enabled: false,
    text: "© Copyright",
    position: "bottom-right",
    opacity: 0.6,
    fontSize: 24,
    color: "#ffffff",
    shadow: true,
  })
  const [metadata, setMetadata] = React.useState<MetadataOptions>({
    copyright: "",
    author: "",
    title: "",
  })

  React.useEffect(() => {
    if (!open || !initial) return
    if (initial.format && RASTER_FORMATS.includes(initial.format)) setFormat(initial.format)
    if (typeof initial.quality === "number" && Number.isFinite(initial.quality)) {
      setQuality(Math.max(0.1, Math.min(1, initial.quality > 1 ? initial.quality / 100 : initial.quality)))
    }
    if (typeof initial.resize === "boolean") setResize(initial.resize)
    if (typeof initial.maxWidth === "number" && Number.isFinite(initial.maxWidth)) setMaxWidth(Math.max(1, Math.round(initial.maxWidth)))
    if (typeof initial.maxHeight === "number" && Number.isFinite(initial.maxHeight)) setMaxHeight(Math.max(1, Math.round(initial.maxHeight)))
    if (typeof initial.transparent === "boolean") setTransparent(initial.transparent)
    if (typeof initial.matte === "string") setMatte(initial.matte)
    if (typeof initial.openFirst === "boolean") setOpenFirst(initial.openFirst)
    if (initial.watermark) {
      setWatermark((current) => ({ ...current, ...initial.watermark }))
    }
    if (initial.metadata) {
      setMetadata((current) => ({ ...current, ...initial.metadata }))
    }
  }, [initial, open])

  const process = async () => {
    if (!files.length) return
    setBusy(true)
    try {
      let firstCanvas: HTMLCanvasElement | null = null
      const meta = metadataFromOptions(metadata)
      for (const file of files) {
        try {
          const raster = await loadRasterCanvasFromFile(file, { mode: "reduced-scale" })
          const canvas = sourceToCanvas(raster.canvas, raster.canvas.width, raster.canvas.height, maxWidth, maxHeight, resize)
          if (!firstCanvas) firstCanvas = canvas
          await exportCanvas(canvas, `${safeName(file.name)}-processed`, {
            format,
            quality,
            transparent,
            matte,
            watermark: watermark.enabled ? watermark : undefined,
            metadata: meta,
          })
        } catch (error) {
          throw new Error(`${file.name}: ${error instanceof Error ? error.message : "Processing failed"}`)
        }
      }
      if (openFirst && firstCanvas) {
        const doc = makeDocument("Image Processor Result", firstCanvas.width, firstCanvas.height, "transparent")
        const layer = doc.layers.find((candidate) => candidate.id === doc.activeLayerId)
        if (layer) {
          layer.canvas.getContext("2d")!.drawImage(firstCanvas, 0, 0)
          if (watermark.enabled) drawWatermark(layer.canvas, watermark)
        }
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
      <WatermarkControls watermark={watermark} setWatermark={setWatermark} />
      <MetadataControls metadata={metadata} setMetadata={setMetadata} />
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

function WatermarkControls({
  watermark,
  setWatermark,
}: {
  watermark: WatermarkOptions
  setWatermark: React.Dispatch<React.SetStateAction<WatermarkOptions>>
}) {
  const update = <K extends keyof WatermarkOptions>(key: K, value: WatermarkOptions[K]) =>
    setWatermark((current) => ({ ...current, [key]: value }))
  return (
    <div className="space-y-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-3" data-testid="image-processor-watermark">
      <label className="flex items-center gap-2 text-[11px] font-semibold">
        <Checkbox checked={watermark.enabled} onCheckedChange={(value) => update("enabled", value === true)} />
        Watermark
      </label>
      {watermark.enabled ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Text">
            <Input value={watermark.text} onChange={(event) => update("text", event.target.value)} className="h-8 bg-[var(--ps-panel)] text-[11px]" />
          </Field>
          <Field label="Position">
            <select value={watermark.position} onChange={(event) => update("position", event.target.value as WatermarkPosition)} className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-2 text-[11px]">
              {WATERMARK_POSITIONS.map((position) => (
                <option key={position.id} value={position.id}>{position.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Font size (px)">
            <Input type="number" min={8} max={400} value={watermark.fontSize} onChange={(event) => update("fontSize", Math.max(8, Math.min(400, Math.round(Number(event.target.value) || 24))))} className="h-8 bg-[var(--ps-panel)] text-[11px]" />
          </Field>
          <Field label="Color">
            <Input type="color" value={watermark.color} onChange={(event) => update("color", event.target.value)} className="h-8 w-20 p-1" />
          </Field>
          <Field label={`Opacity: ${Math.round(watermark.opacity * 100)}%`}>
            <input type="range" min={0.05} max={1} step={0.01} value={watermark.opacity} onChange={(event) => update("opacity", Math.max(0.05, Math.min(1, Number(event.target.value) || 0.6)))} className="h-2 w-full accent-[var(--ps-accent)]" aria-label="Watermark opacity" />
          </Field>
          <label className="flex items-center gap-2 pt-5 text-[11px]">
            <Checkbox checked={watermark.shadow} onCheckedChange={(value) => update("shadow", value === true)} />
            Drop shadow
          </label>
        </div>
      ) : null}
    </div>
  )
}

function MetadataControls({
  metadata,
  setMetadata,
}: {
  metadata: MetadataOptions
  setMetadata: React.Dispatch<React.SetStateAction<MetadataOptions>>
}) {
  return (
    <div className="space-y-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-3" data-testid="image-processor-metadata">
      <div className="text-[11px] font-semibold">Copyright &amp; Metadata</div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Copyright">
          <Input value={metadata.copyright} onChange={(event) => setMetadata((current) => ({ ...current, copyright: event.target.value }))} className="h-8 bg-[var(--ps-panel)] text-[11px]" placeholder="© 2026 Owner" />
        </Field>
        <Field label="Author">
          <Input value={metadata.author} onChange={(event) => setMetadata((current) => ({ ...current, author: event.target.value }))} className="h-8 bg-[var(--ps-panel)] text-[11px]" />
        </Field>
        <Field label="Title">
          <Input value={metadata.title} onChange={(event) => setMetadata((current) => ({ ...current, title: event.target.value }))} className="h-8 bg-[var(--ps-panel)] text-[11px]" />
        </Field>
      </div>
      <p className="text-[10px] text-[var(--ps-text-dim)]">Embedded as XMP for JPEG, PNG, WebP, and AVIF outputs.</p>
    </div>
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

export function CropAndStraightenDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { createDocument } = useEditor()
  const [files, setFiles] = React.useState<File[]>([])
  const [minSize, setMinSize] = React.useState(120)
  const [edgeThreshold, setEdgeThreshold] = React.useState(30)
  const [outputAs, setOutputAs] = React.useState<"documents" | "layers">("documents")
  const [busy, setBusy] = React.useState(false)
  const [results, setResults] = React.useState<string>("")

  const process = async () => {
    if (!files.length) return
    setBusy(true)
    try {
      const { cropAndStraightenPhotos } = await import("./automation-commands")
      let totalCrops = 0
      for (const file of files) {
        try {
          const raster = await loadRasterCanvasFromFile(file, { mode: "reduced-scale" })
          const ctx = raster.canvas.getContext("2d")
          if (!ctx) continue
          const imgData = ctx.getImageData(0, 0, raster.canvas.width, raster.canvas.height)
          const result = cropAndStraightenPhotos(imgData, {
            minPhotoSize: minSize,
            edgeThreshold,
          })
          totalCrops += result.crops.length

          if (outputAs === "documents") {
            for (let i = 0; i < result.crops.length; i++) {
              const crop = result.crops[i]
              const doc = makeDocument(
                `${safeName(file.name)} (${i + 1})`,
                crop.imageData.width,
                crop.imageData.height,
                "transparent",
              )
              const layer = doc.layers.find((l) => l.id === doc.activeLayerId)
              if (layer) {
                const layerCtx = layer.canvas.getContext("2d")
                if (layerCtx) layerCtx.putImageData(crop.imageData, 0, 0)
              }
              createDocument(doc, "Crop and Straighten")
            }
          } else {
            // Output as layers in a single document
            const maxW = Math.max(...result.crops.map((c) => c.imageData.width))
            const maxH = Math.max(...result.crops.map((c) => c.imageData.height))
            const doc = makeDocument(`${safeName(file.name)} (split)`, maxW, maxH, "transparent")
            for (let i = 0; i < result.crops.length; i++) {
              const crop = result.crops[i]
              const c = makeCanvas(maxW, maxH)
              const cctx = c.getContext("2d")
              if (cctx) cctx.putImageData(crop.imageData, 0, 0)
              if (i === 0) {
                const layer = doc.layers.find((l) => l.id === doc.activeLayerId)
                if (layer) {
                  const lctx = layer.canvas.getContext("2d")
                  if (lctx) lctx.drawImage(c, 0, 0)
                  layer.name = `Crop ${i + 1}`
                }
              }
            }
            createDocument(doc, "Crop and Straighten")
          }
        } catch (error) {
          throw new Error(`${file.name}: ${error instanceof Error ? error.message : "Detection failed"}`)
        }
      }
      setResults(`Detected ${totalCrops} photo${totalCrops === 1 ? "" : "s"} across ${files.length} image${files.length === 1 ? "" : "s"}`)
      toast.success(`Detected ${totalCrops} photo${totalCrops === 1 ? "" : "s"}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Crop and Straighten failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-[var(--ps-panel)] text-[var(--ps-text)] border-[var(--ps-divider)]">
        <DialogHeader>
          <DialogTitle className="text-sm">Crop and Straighten Photos</DialogTitle>
          <DialogDescription className="text-[11px] text-[var(--ps-text-dim)]">
            Detects individual photos in a scanned image, auto-crops and straightens each one.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Field label="Source images (one or more scans)">
            <Input
              type="file"
              multiple
              accept="image/*"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
              className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
            />
          </Field>
          {files.length > 0 ? (
            <div className="text-[11px] text-[var(--ps-text-dim)]">
              {files.length} file{files.length === 1 ? "" : "s"} selected
            </div>
          ) : null}
          <Field label="Minimum photo size (px)">
            <Input
              type="number"
              min={20}
              max={4000}
              value={minSize}
              onChange={(e) => setMinSize(Math.max(20, Number(e.target.value) || 120))}
              className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
            />
          </Field>
          <Field label="Edge threshold (0–255)">
            <Input
              type="number"
              min={1}
              max={255}
              value={edgeThreshold}
              onChange={(e) => setEdgeThreshold(Math.max(1, Math.min(255, Number(e.target.value) || 30)))}
              className="h-8 bg-[var(--ps-panel-2)] text-[11px]"
            />
          </Field>
          <Field label="Output">
            <select
              value={outputAs}
              onChange={(e) => setOutputAs(e.target.value as "documents" | "layers")}
              className="h-8 bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] text-[11px] px-2"
            >
              <option value="documents">Each photo as a new document</option>
              <option value="layers">First photo as a new document</option>
            </select>
          </Field>
          {results ? (
            <div className="rounded border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-3 py-2 text-[11px]">
              {results}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="text-[11px]">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={process}
            disabled={!files.length || busy}
            className="text-[11px] bg-[var(--ps-accent)] hover:bg-[var(--ps-accent)]/90"
          >
            {busy ? "Detecting..." : "Detect Photos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
