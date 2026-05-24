"use client"

import * as React from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  applyImageData,
  calculateChannelImageData,
  type ApplyImageTargetChannel,
  type PixelChannel,
} from "./color-channel-ops"
import { makeCanvas, makeDocument, useEditor } from "./editor-context"
import { downloadText, loadImageFromFile } from "./document-io"
import { focusStackImageData, mergeHdrImageStack, photomergeImageStack } from "./photo-workflow-engine"
import type { AlphaChannel, BlendMode, Layer } from "./types"
import { uid } from "./uid"

export type GapWorkflowKind =
  | "apply-image"
  | "calculations"
  | "load-stack"
  | "photomerge"
  | "hdr-merge"
  | "focus-stack"
  | "stack-statistics"
  | "pdf-presentation"
  | "scripted-pattern"
  | "image-assets"

const blendModes: BlendMode[] = ["normal", "multiply", "screen", "overlay", "soft-light", "difference", "darken", "lighten"]
const sourceChannels: PixelChannel[] = ["rgb", "gray", "red", "green", "blue", "alpha"]
const targetChannels: ApplyImageTargetChannel[] = ["rgb", "red", "green", "blue", "alpha"]


export function GapWorkflowDialog({
  workflow,
  onOpenChange,
}: {
  workflow: GapWorkflowKind | null
  onOpenChange: (open: boolean) => void
}) {
  const { activeDoc, activeLayer, dispatch, commit, createDocument } = useEditor()
  const [sourceId, setSourceId] = React.useState("")
  const [sourceId2, setSourceId2] = React.useState("")
  const [sourceChannel, setSourceChannel] = React.useState<PixelChannel>("rgb")
  const [sourceChannel2, setSourceChannel2] = React.useState<PixelChannel>("gray")
  const [targetChannel, setTargetChannel] = React.useState<ApplyImageTargetChannel>("rgb")
  const [invertSource, setInvertSource] = React.useState(false)
  const [invertSource2, setInvertSource2] = React.useState(false)
  const [blend, setBlend] = React.useState<BlendMode>("normal")
  const [opacity, setOpacity] = React.useState(100)
  const [files, setFiles] = React.useState<File[]>([])
  const [stat, setStat] = React.useState<"mean" | "median" | "min" | "max">("median")
  const [pattern, setPattern] = React.useState<"brick" | "cross-weave" | "random-fill">("brick")
  const [busy, setBusy] = React.useState(false)
  const open = workflow !== null

  React.useEffect(() => {
    if (!activeDoc) return
    setSourceId((activeDoc.layers.find((layer) => layer.id !== activeDoc.activeLayerId && layer.kind !== "group") ?? activeLayer ?? activeDoc.layers[0])?.id ?? "")
    setSourceId2((activeDoc.layers.find((layer) => layer.id !== activeDoc.activeLayerId && layer.kind !== "group") ?? activeDoc.layers[0])?.id ?? "")
  }, [activeDoc, activeLayer, workflow])

  const close = () => onOpenChange(false)

  const runApplyImage = () => {
    if (!activeLayer || !activeDoc || activeLayer.locked) return
    const src = activeDoc.layers.find((layer) => layer.id === sourceId)
    if (!src || typeof src.canvas.getContext !== "function") return
    const targetCtx = activeLayer.canvas.getContext("2d")!
    const srcCtx = src.canvas.getContext("2d")!
    const target = targetCtx.getImageData(0, 0, activeDoc.width, activeDoc.height)
    const source = srcCtx.getImageData(0, 0, activeDoc.width, activeDoc.height)
    targetCtx.putImageData(applyImageData(target, source, {
      sourceChannel,
      targetChannel,
      blendMode: blend,
      opacity: opacity / 100,
      invertSource,
    }), 0, 0)
    commit("Apply Image", [activeLayer.id])
    close()
  }

  const runCalculations = () => {
    if (!activeDoc) return
    const a = activeDoc.layers.find((layer) => layer.id === sourceId)
    const b = activeDoc.layers.find((layer) => layer.id === sourceId2)
    if (!a || !b) return
    const imgA = a.canvas.getContext("2d")!.getImageData(0, 0, activeDoc.width, activeDoc.height)
    const imgB = b.canvas.getContext("2d")!.getImageData(0, 0, activeDoc.width, activeDoc.height)
    const mask = makeCanvas(activeDoc.width, activeDoc.height)
    const out = calculateChannelImageData(imgA, imgB, {
      sourceChannelA: sourceChannel === "rgb" ? "gray" : sourceChannel,
      sourceChannelB: sourceChannel2 === "rgb" ? "gray" : sourceChannel2,
      blendMode: blend,
      opacity: opacity / 100,
      invertA: invertSource,
      invertB: invertSource2,
    })
    for (let i = 0; i < out.data.length; i += 4) {
      const value = out.data[i]
      out.data[i] = out.data[i + 1] = out.data[i + 2] = 255
      out.data[i + 3] = value
    }
    mask.getContext("2d")!.putImageData(out, 0, 0)
    const channel: AlphaChannel = { id: uid("alpha"), name: `Calculation ${(activeDoc.channels?.length ?? 0) + 1}`, canvas: mask }
    dispatch({ type: "save-selection", channel })
    commit("Calculations Alpha Channel", [])
    close()
  }

  const loadCanvases = async () => {
    const loaded = []
    for (const file of files) {
      const img = await loadImageFromFile(file)
      const canvas = makeCanvas(img.naturalWidth, img.naturalHeight)
      canvas.getContext("2d")!.drawImage(img, 0, 0)
      loaded.push({ name: file.name, canvas })
    }
    return loaded
  }

  const runFileWorkflow = async () => {
    if (!workflow || !files.length) return
    setBusy(true)
    try {
      const loaded = await loadCanvases()
      if (workflow === "pdf-presentation") {
        const pages = loaded.map((item) => `<section><img src="${item.canvas.toDataURL("image/png")}" alt="${escapeHtml(item.name)}"><p>${escapeHtml(item.name)}</p></section>`).join("\n")
        downloadText(`<!doctype html><html><head><meta charset="utf-8"><title>PDF Presentation</title><style>body{margin:0;font-family:sans-serif}section{height:100vh;page-break-after:always;display:grid;place-items:center;background:#111;color:#fff}img{max-width:95vw;max-height:88vh}p{margin:0 0 24px}</style></head><body>${pages}</body></html>`, "pdf-presentation.html", "text/html")
        close()
        return
      }
      const result = workflow === "photomerge"
        ? photomerge(loaded)
        : workflow === "hdr-merge"
          ? mergeHdr(loaded)
          : workflow === "focus-stack"
            ? focusStack(loaded)
            : workflow === "stack-statistics"
              ? mergeStack(loaded, stat)
              : null
      if (result) {
        const doc = makeDocument(titleForWorkflow(workflow), result.width, result.height, "transparent")
        const layer = doc.layers.find((candidate) => candidate.id === doc.activeLayerId)
        if (layer) layer.canvas.getContext("2d")!.drawImage(result, 0, 0)
        createDocument(doc, titleForWorkflow(workflow))
      } else {
        const width = Math.max(...loaded.map((item) => item.canvas.width))
        const height = Math.max(...loaded.map((item) => item.canvas.height))
        const doc = makeDocument("Loaded Stack", width, height, "transparent")
        doc.layers = loaded.map((item) => {
          const canvas = makeCanvas(width, height)
          canvas.getContext("2d")!.drawImage(item.canvas, (width - item.canvas.width) / 2, (height - item.canvas.height) / 2)
          return { id: uid("layer"), name: item.name, kind: "raster", visible: true, locked: false, opacity: 1, blendMode: "normal", canvas } satisfies Layer
        })
        doc.activeLayerId = doc.layers[0]?.id ?? doc.activeLayerId
        doc.selectedLayerIds = doc.activeLayerId ? [doc.activeLayerId] : []
        createDocument(doc, "Load Files into Stack")
      }
      close()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Workflow failed")
    } finally {
      setBusy(false)
    }
  }

  const runPattern = () => {
    if (!activeDoc) return
    const canvas = makeCanvas(activeDoc.width, activeDoc.height)
    drawScriptedPattern(canvas, pattern)
    const layer: Layer = { id: uid("layer"), name: `Pattern ${pattern}`, kind: "raster", visible: true, locked: false, opacity: 1, blendMode: "normal", canvas }
    dispatch({ type: "add-layer", layer })
    window.setTimeout(() => commit("Scripted Pattern", [layer.id]), 0)
    close()
  }

  const layers = activeDoc?.layers.filter((layer) => layer.kind !== "group") ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[680px] border-[var(--ps-divider)] bg-[var(--ps-panel)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>{workflow ? titleForWorkflow(workflow) : "Workflow"}</DialogTitle>
        </DialogHeader>
        {workflow === "apply-image" || workflow === "calculations" ? (
          <div className="grid gap-3 text-[11px]">
            <Field label="Source Layer">
              <select value={sourceId} onChange={(event) => setSourceId(event.target.value)} className={selectClass}>{layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select>
            </Field>
            <Field label="Source Channel">
              <select value={sourceChannel} onChange={(event) => setSourceChannel(event.target.value as PixelChannel)} className={selectClass}>
                {sourceChannels.map((channel) => <option key={channel} value={channel}>{channelLabel(channel)}</option>)}
              </select>
            </Field>
            {workflow === "calculations" ? (
              <>
                <Field label="Second Source">
                  <select value={sourceId2} onChange={(event) => setSourceId2(event.target.value)} className={selectClass}>{layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select>
                </Field>
                <Field label="Second Channel">
                  <select value={sourceChannel2} onChange={(event) => setSourceChannel2(event.target.value as PixelChannel)} className={selectClass}>
                    {sourceChannels.filter((channel) => channel !== "rgb").map((channel) => <option key={channel} value={channel}>{channelLabel(channel)}</option>)}
                  </select>
                </Field>
              </>
            ) : null}
            {workflow === "apply-image" ? (
              <Field label="Target Channel">
                <select value={targetChannel} onChange={(event) => setTargetChannel(event.target.value as ApplyImageTargetChannel)} className={selectClass}>
                  {targetChannels.map((channel) => <option key={channel} value={channel}>{channelLabel(channel)}</option>)}
                </select>
              </Field>
            ) : null}
            <Field label="Blend">
              <select value={blend} onChange={(event) => setBlend(event.target.value as BlendMode)} className={selectClass}>{blendModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select>
            </Field>
            <Field label="Opacity"><input type="number" min={0} max={100} value={opacity} onChange={(event) => setOpacity(Number(event.target.value) || 0)} className={inputClass} /></Field>
            <label className="flex items-center gap-2 text-[11px] text-[var(--ps-text-dim)]">
              <input type="checkbox" checked={invertSource} onChange={(event) => setInvertSource(event.target.checked)} />
              Invert source channel
            </label>
            {workflow === "calculations" ? (
              <label className="flex items-center gap-2 text-[11px] text-[var(--ps-text-dim)]">
                <input type="checkbox" checked={invertSource2} onChange={(event) => setInvertSource2(event.target.checked)} />
                Invert second channel
              </label>
            ) : null}
          </div>
        ) : workflow === "scripted-pattern" ? (
          <Field label="Pattern">
            <select value={pattern} onChange={(event) => setPattern(event.target.value as typeof pattern)} className={selectClass}>
              <option value="brick">Brick Fill</option>
              <option value="cross-weave">Cross Weave</option>
              <option value="random-fill">Random Fill</option>
            </select>
          </Field>
        ) : workflow === "image-assets" ? (
          <div className="text-[11px] text-[var(--ps-text-dim)]">This opens the local visible-layer export workflow. It is not Photoshop Generator or a folder watcher.</div>
        ) : (
          <div className="grid gap-3 text-[11px]">
            <input type="file" multiple accept="image/*" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} className={inputClass} />
            <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2 text-[var(--ps-text-dim)]">
              File workflows use browser-decoded 8-bit image pixels. Photomerge, HDR merge, focus stack, and stack statistics are local approximations, not Photoshop camera RAW, HDR Pro, or lens-aware merge engines.
            </div>
            {workflow === "stack-statistics" ? (
              <Field label="Statistic">
                <select value={stat} onChange={(event) => setStat(event.target.value as typeof stat)} className={selectClass}>
                  <option value="mean">Mean</option>
                  <option value="median">Median</option>
                  <option value="min">Minimum</option>
                  <option value="max">Maximum</option>
                </select>
              </Field>
            ) : null}
            <div className="text-[var(--ps-text-dim)]">{files.length} file{files.length === 1 ? "" : "s"} selected</div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button
            disabled={busy || (isFileWorkflow(workflow) && !files.length)}
            onClick={() => {
              if (workflow === "apply-image") runApplyImage()
              else if (workflow === "calculations") runCalculations()
              else if (workflow === "scripted-pattern") runPattern()
              else if (workflow === "image-assets") {
                window.dispatchEvent(new CustomEvent("ps-open-batch-export", { detail: { scope: "visible-layers" } }))
                close()
              } else void runFileWorkflow()
            }}
          >
            {busy ? "Running..." : "Run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function isFileWorkflow(workflow: GapWorkflowKind | null) {
  return workflow === "load-stack" || workflow === "photomerge" || workflow === "hdr-merge" || workflow === "focus-stack" || workflow === "stack-statistics" || workflow === "pdf-presentation"
}

function titleForWorkflow(workflow: GapWorkflowKind) {
  const labels: Record<GapWorkflowKind, string> = {
    "apply-image": "Apply Image",
    calculations: "Calculations",
    "load-stack": "Load Files into Stack",
    photomerge: "Photomerge",
    "hdr-merge": "Merge to HDR",
    "focus-stack": "Focus Stack",
    "stack-statistics": "Stack Statistics",
    "pdf-presentation": "PDF Presentation",
    "scripted-pattern": "Scripted Patterns",
    "image-assets": "Image Assets Generator",
  }
  return labels[workflow]
}

function channelLabel(channel: PixelChannel | ApplyImageTargetChannel) {
  if (channel === "rgb") return "RGB composite"
  if (channel === "gray") return "Gray/luminance"
  if (channel === "alpha") return "Alpha"
  return `${channel[0].toUpperCase()}${channel.slice(1)}`
}

function photomerge(items: { name: string; canvas: HTMLCanvasElement }[]) {
  const images = items.map((item) => canvasImageData(item.canvas))
  const radius = workflowSearchRadius(items)
  const result = photomergeImageStack(images, { searchRadius: radius, maxFeatures: 120 })
  return imageDataCanvas(result.image)
}

function mergeStack(items: { canvas: HTMLCanvasElement }[], mode: "mean" | "median" | "min" | "max") {
  const width = Math.max(...items.map((item) => item.canvas.width))
  const height = Math.max(...items.map((item) => item.canvas.height))
  const data = items.map((item) => imageDataCentered(item.canvas, width, height))
  const out = makeCanvas(width, height)
  const img = out.getContext("2d")!.createImageData(width, height)
  for (let i = 0; i < img.data.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      const values = data.map((source) => source.data[i + c]).sort((a, b) => a - b)
      img.data[i + c] =
        mode === "min" ? values[0] :
        mode === "max" ? values[values.length - 1] :
        mode === "median" ? values[Math.floor(values.length / 2)] :
        values.reduce((sum, value) => sum + value, 0) / values.length
    }
  }
  out.getContext("2d")!.putImageData(img, 0, 0)
  return out
}

function focusStack(items: { canvas: HTMLCanvasElement }[]) {
  const width = Math.max(...items.map((item) => item.canvas.width))
  const height = Math.max(...items.map((item) => item.canvas.height))
  const data = items.map((item) => imageDataCentered(item.canvas, width, height))
  return imageDataCanvas(focusStackImageData(data).image)
}

function imageDataCentered(canvas: HTMLCanvasElement, width: number, height: number) {
  const tmp = makeCanvas(width, height)
  tmp.getContext("2d")!.drawImage(canvas, (width - canvas.width) / 2, (height - canvas.height) / 2)
  return tmp.getContext("2d")!.getImageData(0, 0, width, height)
}

function mergeHdr(items: { canvas: HTMLCanvasElement }[]) {
  const width = Math.max(...items.map((item) => item.canvas.width))
  const height = Math.max(...items.map((item) => item.canvas.height))
  const data = items.map((item) => imageDataCentered(item.canvas, width, height))
  const midpoint = (items.length - 1) / 2
  const exposures = items.map((_, index) => ({ ev: index - midpoint }))
  const radius = workflowSearchRadius(items)
  return imageDataCanvas(mergeHdrImageStack(data, exposures, { align: true, searchRadius: radius, maxFeatures: 120 }).image)
}

function canvasImageData(canvas: HTMLCanvasElement) {
  return canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height)
}

function imageDataCanvas(image: ImageData) {
  const canvas = makeCanvas(image.width, image.height)
  canvas.getContext("2d")!.putImageData(image, 0, 0)
  return canvas
}

function workflowSearchRadius(items: { canvas: HTMLCanvasElement }[]) {
  const longest = Math.max(...items.map((item) => Math.max(item.canvas.width, item.canvas.height)), 1)
  return Math.max(8, Math.min(96, Math.round(longest * 0.12)))
}

function drawScriptedPattern(canvas: HTMLCanvasElement, pattern: "brick" | "cross-weave" | "random-fill") {
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#f8fafc"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  if (pattern === "brick") {
    const w = 96, h = 42
    for (let y = 0; y < canvas.height; y += h) {
      for (let x = (Math.floor(y / h) % 2) * -w / 2; x < canvas.width; x += w) {
        ctx.fillStyle = `hsl(${18 + ((x + y) % 18)}, 58%, ${46 + ((x + y) % 9)}%)`
        ctx.fillRect(x + 2, y + 2, w - 4, h - 4)
      }
    }
  } else if (pattern === "cross-weave") {
    ctx.strokeStyle = "#334155"
    for (let i = -canvas.height; i < canvas.width; i += 14) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + canvas.height, canvas.height); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(i, canvas.height); ctx.lineTo(i + canvas.height, 0); ctx.stroke()
    }
  } else {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    for (let i = 0; i < img.data.length; i += 4) {
      const n = Math.sin(i * 12.9898) * 43758.5453
      const v = Math.floor((n - Math.floor(n)) * 255)
      img.data[i] = v
      img.data[i + 1] = 90 + v * 0.45
      img.data[i + 2] = 255 - v * 0.35
      img.data[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[ch] ?? ch)
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-[11px] text-[var(--ps-text-dim)]">{label}{children}</label>
}

const inputClass = "h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] text-[var(--ps-text)] outline-none"
const selectClass = inputClass
