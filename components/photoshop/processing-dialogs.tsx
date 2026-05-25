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
  options: { format: RasterFormat; quality: number; transparent: boolean; matte: string },
) {
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
          const raster = await loadRasterCanvasFromFile(file, { mode: "reduced-scale" })
          const canvas = sourceToCanvas(raster.canvas, raster.canvas.width, raster.canvas.height, maxWidth, maxHeight, resize)
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
