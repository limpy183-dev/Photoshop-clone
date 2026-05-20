"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { makeDocument, useEditor } from "./editor-context"
import { decontaminateImageDataWithMask, edgeAwareQuickSelectionMask, refineSelectionMaskData } from "./algorithmic-operations"
import {
  SELECT_AND_MASK_OUTPUT_TARGETS,
  SELECT_AND_MASK_VIEW_MODES,
  type SelectAndMaskOutputTarget,
  type SelectAndMaskViewMode,
} from "./photo-workflow-engine"
import { Paintbrush, Hand, ZoomIn, Lasso, Scissors, CircleDot } from "lucide-react"
import type { Layer } from "./types"

type ViewMode = SelectAndMaskViewMode
type OutputTo = SelectAndMaskOutputTarget
type SMTool = "refine-edge" | "brush" | "lasso" | "quick-select" | "hand" | "zoom"

const VIEW_MODES = SELECT_AND_MASK_VIEW_MODES
const OUTPUT_TARGETS = SELECT_AND_MASK_OUTPUT_TARGETS

const TOOLS: { id: SMTool; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "quick-select", label: "Quick Selection", icon: Scissors },
  { id: "refine-edge", label: "Refine Edge Brush", icon: CircleDot },
  { id: "brush", label: "Brush", icon: Paintbrush },
  { id: "lasso", label: "Lasso", icon: Lasso },
  { id: "hand", label: "Hand", icon: Hand },
  { id: "zoom", label: "Zoom", icon: ZoomIn },
]

export function SelectAndMaskDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeDoc, activeLayer, dispatch, commit, createDocument } = useEditor()

  const [viewMode, setViewMode] = React.useState<ViewMode>("overlay")
  const [activeTool, setActiveTool] = React.useState<SMTool>("refine-edge")
  const [opacity, setOpacity] = React.useState(50)
  const [outputTo, setOutputTo] = React.useState<OutputTo>("selection")
  const [decontaminate, setDecontaminate] = React.useState(false)

  // Global Refinements
  const [smooth, setSmooth] = React.useState(0)
  const [feather, setFeather] = React.useState(0)
  const [contrast, setContrast] = React.useState(0)
  const [shiftEdge, setShiftEdge] = React.useState(0)

  // Edge Detection
  const [smartRadius, setSmartRadius] = React.useState(true)
  const [edgeRadius, setEdgeRadius] = React.useState(3)

  // Brush
  const [brushSize, setBrushSize] = React.useState(20)

  const previewRef = React.useRef<HTMLCanvasElement>(null)
  const maskRef = React.useRef<HTMLCanvasElement | null>(null)

  const renderPreview = React.useCallback(() => {
    const cv = previewRef.current
    const mask = maskRef.current
    if (!cv || !mask || !activeDoc || !activeLayer) return

    const maxW = 600
    const scale = Math.min(maxW / activeDoc.width, 450 / activeDoc.height, 1)
    const pw = Math.round(activeDoc.width * scale)
    const ph = Math.round(activeDoc.height * scale)
    cv.width = pw
    cv.height = ph
    const ctx = cv.getContext("2d")!
    ctx.clearRect(0, 0, pw, ph)

    // Draw based on view mode
    if (viewMode === "on-black") {
      ctx.fillStyle = "#000"
      ctx.fillRect(0, 0, pw, ph)
    } else if (viewMode === "on-white") {
      ctx.fillStyle = "#fff"
      ctx.fillRect(0, 0, pw, ph)
    } else if (viewMode === "on-blue") {
      ctx.fillStyle = "#2563eb"
      ctx.fillRect(0, 0, pw, ph)
    } else if (viewMode === "on-layers" || viewMode === "onion" || viewMode === "marching") {
      // Draw composite
      ctx.fillStyle = activeDoc.background
      ctx.fillRect(0, 0, pw, ph)
      ctx.save()
      ctx.scale(scale, scale)
      for (const l of activeDoc.layers) {
        if (!l.visible || l.kind === "group") continue
        if (typeof l.canvas.getContext !== "function") continue
        ctx.globalAlpha = l.opacity
        ctx.drawImage(l.canvas, 0, 0)
      }
      ctx.restore()
    }

    if (viewMode === "bw") {
      // Show mask as black and white
      ctx.drawImage(mask, 0, 0, pw, ph)
      return
    }

    // Apply mask to the active layer
    if (viewMode !== "on-layers" && viewMode !== "marching" && viewMode !== "onion") {
      const tmp = document.createElement("canvas")
      tmp.width = activeDoc.width
      tmp.height = activeDoc.height
      const tctx = tmp.getContext("2d")!
      tctx.drawImage(activeLayer.canvas, 0, 0)
      tctx.globalCompositeOperation = "destination-in"
      tctx.drawImage(mask, 0, 0)
      ctx.drawImage(tmp, 0, 0, pw, ph)
    }

    // Overlay mode: red overlay on non-selected areas
    if (viewMode === "overlay") {
      const ov = document.createElement("canvas")
      ov.width = pw
      ov.height = ph
      const octx = ov.getContext("2d")!
      octx.fillStyle = `rgba(255, 0, 0, ${opacity / 100})`
      octx.fillRect(0, 0, pw, ph)
      octx.globalCompositeOperation = "destination-out"
      octx.drawImage(mask, 0, 0, pw, ph)
      ctx.drawImage(ov, 0, 0)
    }

    // Marching ants border
    if (viewMode === "marching" || viewMode === "onion") {
      ctx.save()
      ctx.strokeStyle = "#fff"
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      const mImg = mask.getContext("2d")!.getImageData(0, 0, mask.width, mask.height)
      // Draw simplified edge outline
      for (let y = 0; y < mask.height; y += 2) {
        for (let x = 0; x < mask.width; x += 2) {
          const a = mImg.data[(y * mask.width + x) * 4 + 3]
          if (a > 127) {
            const hasEdge =
              (x > 0 && mImg.data[(y * mask.width + x - 1) * 4 + 3] <= 127) ||
              (x < mask.width - 1 && mImg.data[(y * mask.width + x + 1) * 4 + 3] <= 127) ||
              (y > 0 && mImg.data[((y - 1) * mask.width + x) * 4 + 3] <= 127) ||
              (y < mask.height - 1 && mImg.data[((y + 1) * mask.width + x) * 4 + 3] <= 127)
            if (hasEdge) {
              ctx.fillStyle = "#fff"
              ctx.fillRect(x * scale, y * scale, 1, 1)
            }
          }
        }
      }
      ctx.restore()
    }
  }, [activeDoc, activeLayer, viewMode, opacity])

  // Initialize mask from current selection
  React.useEffect(() => {
    if (!open || !activeDoc) return
    const w = activeDoc.width
    const h = activeDoc.height
    const mask = document.createElement("canvas")
    mask.width = w
    mask.height = h
    const mctx = mask.getContext("2d")!

    // Initialize from selection
    const sel = activeDoc.selection
    if (sel.mask) {
      mctx.drawImage(sel.mask, 0, 0)
    } else if (sel.bounds) {
      mctx.fillStyle = "#fff"
      if (sel.shape === "ellipse") {
        mctx.beginPath()
        mctx.ellipse(
          sel.bounds.x + sel.bounds.w / 2,
          sel.bounds.y + sel.bounds.h / 2,
          sel.bounds.w / 2,
          sel.bounds.h / 2,
          0, 0, Math.PI * 2,
        )
        mctx.fill()
      } else {
        mctx.fillRect(sel.bounds.x, sel.bounds.y, sel.bounds.w, sel.bounds.h)
      }
    }

    maskRef.current = mask
    renderPreview()
  }, [open, activeDoc, renderPreview])

  React.useEffect(() => {
    renderPreview()
  }, [renderPreview, smooth, feather, contrast, shiftEdge])

  // Paint on the mask
  const paintingRef = React.useRef(false)
  const lastPtRef = React.useRef<{ x: number; y: number } | null>(null)

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = previewRef.current!
    const rect = cv.getBoundingClientRect()
    const scale = Math.min(600 / activeDoc!.width, 450 / activeDoc!.height, 1)
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    }
  }

  const onPreviewPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!maskRef.current || activeTool === "hand" || activeTool === "zoom") return
    e.currentTarget.setPointerCapture(e.pointerId)
    paintingRef.current = true
    const pt = getPoint(e)
    lastPtRef.current = pt
    paintMaskAt(pt, e.shiftKey || activeTool === "lasso")
    renderPreview()
  }

  const onPreviewPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!paintingRef.current || !maskRef.current) return
    const pt = getPoint(e)
    paintMaskAt(pt, e.shiftKey || activeTool === "lasso")
    lastPtRef.current = pt
    renderPreview()
  }

  const onPreviewPointerUp = () => {
    paintingRef.current = false
    lastPtRef.current = null
  }

  const paintMaskAt = (pt: { x: number; y: number }, erase: boolean) => {
    const mask = maskRef.current
    if (!mask) return
    const mctx = mask.getContext("2d")!
    if (activeTool === "quick-select" && !erase && activeLayer) {
      const grown = edgeAwareQuickSelectionMask(activeLayer.canvas, {
        seed: pt,
        tolerance: 52 + Math.round(edgeRadius / 6),
        adaptive: smartRadius,
        includeDiagonals: true,
        maxPixels: Math.max(64, Math.round(Math.PI * brushSize * brushSize * 2)),
      })
      mctx.drawImage(grown, 0, 0)
      return
    }
    mctx.globalCompositeOperation = erase ? "destination-out" : "source-over"
    mctx.fillStyle = "#fff"
    mctx.beginPath()
    mctx.arc(pt.x, pt.y, brushSize / 2, 0, Math.PI * 2)
    mctx.fill()
    mctx.globalCompositeOperation = "source-over"
  }

  const applyRefinements = () => {
    const mask = maskRef.current
    if (!mask || !activeDoc) return mask

    const w = mask.width
    const h = mask.height
    const ctx = mask.getContext("2d")!
    const img = ctx.getImageData(0, 0, w, h)
    const alpha = new Uint8ClampedArray(w * h)
    for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3]
    const refined = refineSelectionMaskData(alpha, w, h, {
      smoothRadius: smooth,
      featherRadius: feather,
      contrast,
      shiftEdge,
      smartRadius,
      edgeRadius,
      sourceImage: activeLayer ? activeLayer.canvas.getContext("2d")!.getImageData(0, 0, w, h) : undefined,
    })
    const out = new ImageData(w, h)
    for (let i = 0; i < refined.maskData.length; i++) {
      const idx = i * 4
      out.data[idx] = 255
      out.data[idx + 1] = 255
      out.data[idx + 2] = 255
      out.data[idx + 3] = refined.maskData[i]
    }

    const result = document.createElement("canvas")
    result.width = w
    result.height = h
    result.getContext("2d")!.putImageData(out, 0, 0)
    return result
  }

  const handleApply = () => {
    if (!activeDoc || !activeLayer || !maskRef.current) return
    const refinedMask = applyRefinements()
    if (!refinedMask) return

    const w = activeDoc.width
    const h = activeDoc.height
    const maskedCanvasFromLayer = (applyMask = true) => {
      const newCanvas = document.createElement("canvas")
      newCanvas.width = w
      newCanvas.height = h
      const nctx = newCanvas.getContext("2d")!
      nctx.drawImage(activeLayer.canvas, 0, 0)
      if (decontaminate) {
        const sourceImage = nctx.getImageData(0, 0, w, h)
        const maskImage = refinedMask.getContext("2d")!.getImageData(0, 0, w, h)
        const alpha = new Uint8ClampedArray(w * h)
        for (let i = 0; i < alpha.length; i++) alpha[i] = maskImage.data[i * 4 + 3]
        nctx.putImageData(decontaminateImageDataWithMask(sourceImage, alpha, w, h, { amount: 0.9, radius: Math.max(2, edgeRadius) }), 0, 0)
      }
      if (applyMask) {
        nctx.globalCompositeOperation = "destination-in"
        nctx.drawImage(refinedMask, 0, 0)
        nctx.globalCompositeOperation = "source-over"
      }
      return newCanvas
    }

    // Find mask bounds
    const mctx = refinedMask.getContext("2d")!
    const mimg = mctx.getImageData(0, 0, w, h)
    let minX = w, minY = h, maxX = 0, maxY = 0
    let any = false
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mimg.data[(y * w + x) * 4 + 3] > 0) {
          any = true
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
    }

    if (outputTo === "selection") {
      if (any) {
        dispatch({
          type: "set-selection",
          selection: {
            bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
            shape: "freehand",
            mask: refinedMask,
            feather: feather > 0 ? feather : undefined,
          },
        })
      } else {
        dispatch({ type: "set-selection", selection: { bounds: null, shape: "rect" } })
      }
    } else if (outputTo === "layer-mask") {
      dispatch({ type: "set-layer-mask", id: activeLayer.id, mask: refinedMask })
      setTimeout(() => commit("Select and Mask - Layer Mask", [activeLayer.id]), 0)
    } else if (outputTo === "new-layer") {
      const newCanvas = maskedCanvasFromLayer()
      const maskedLayer: Layer = {
        id: `layer_${Math.random().toString(36).slice(2, 9)}`,
        name: `${activeLayer.name} (Masked)`,
        kind: "raster",
        visible: true,
        locked: false,
        opacity: activeLayer.opacity,
        fillOpacity: activeLayer.fillOpacity,
        blendMode: activeLayer.blendMode,
        canvas: newCanvas,
      }
      dispatch({ type: "add-layer", layer: maskedLayer })
      setTimeout(() => commit("Select and Mask - New Layer", [maskedLayer.id]), 0)
    } else if (outputTo === "new-layer-mask") {
      const newCanvas = decontaminate ? maskedCanvasFromLayer(false) : document.createElement("canvas")
      if (!decontaminate) {
        newCanvas.width = w
        newCanvas.height = h
        newCanvas.getContext("2d")!.drawImage(activeLayer.canvas, 0, 0)
      }

      const maskCopy = document.createElement("canvas")
      maskCopy.width = w
      maskCopy.height = h
      maskCopy.getContext("2d")!.drawImage(refinedMask, 0, 0)

      const maskedDuplicate: Layer = {
        ...activeLayer,
        id: `layer_${Math.random().toString(36).slice(2, 9)}`,
        name: `${activeLayer.name} copy (Mask)`,
        locked: false,
        canvas: newCanvas,
        mask: maskCopy,
        maskEnabled: true,
        linkGroupId: undefined,
      }
      dispatch({ type: "add-layer", layer: maskedDuplicate })
      setTimeout(() => commit("Select and Mask - New Layer with Mask", [maskedDuplicate.id]), 0)
    } else if (outputTo === "alpha-channel") {
      const maskCopy = document.createElement("canvas")
      maskCopy.width = w
      maskCopy.height = h
      maskCopy.getContext("2d")!.drawImage(refinedMask, 0, 0)
      dispatch({
        type: "save-selection",
        channel: {
          id: `channel_${Math.random().toString(36).slice(2, 9)}`,
          name: `${activeLayer.name} Mask`,
          canvas: maskCopy,
        },
      })
      setTimeout(() => commit("Select and Mask - Alpha Channel", []), 0)
    } else if (outputTo === "new-document") {
      const newCanvas = maskedCanvasFromLayer()
      const maskedLayer: Layer = {
        id: `layer_${Math.random().toString(36).slice(2, 9)}`,
        name: `${activeLayer.name} (Masked)`,
        kind: "raster",
        visible: true,
        locked: false,
        opacity: activeLayer.opacity,
        fillOpacity: activeLayer.fillOpacity,
        blendMode: activeLayer.blendMode,
        canvas: newCanvas,
      }
      const doc = makeDocument(`${activeLayer.name} selection`, w, h, "transparent")
      doc.layers = [maskedLayer]
      doc.activeLayerId = maskedLayer.id
      doc.selectedLayerIds = [maskedLayer.id]
      doc.background = "transparent"
      createDocument(doc, "Select and Mask - New Document")
    }

    onOpenChange(false)
  }

  if (!activeDoc || !activeLayer) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[950px] max-h-[90vh] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 py-2 border-b border-[var(--ps-divider)]">
          <DialogTitle className="text-sm">Select and Mask</DialogTitle>
          <DialogDescription className="sr-only">Refine selection edges with advanced masking tools.</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0" style={{ height: "68vh" }}>
          {/* Left: tool strip */}
          <div className="w-10 bg-[var(--ps-chrome)] border-r border-[var(--ps-divider)] flex flex-col items-center py-2 gap-1 shrink-0">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTool(t.id)}
                className={`w-7 h-7 rounded-sm flex items-center justify-center ${
                  activeTool === t.id
                    ? "bg-[var(--ps-tool-active)] text-white"
                    : "hover:bg-[var(--ps-tool-hover)] text-[var(--ps-text-dim)]"
                }`}
                title={t.label}
              >
                <t.icon className="w-3.5 h-3.5" />
              </button>
            ))}
            <div className="mt-2 text-[9px] text-[var(--ps-text-dim)] text-center">
              {activeTool === "brush" && "LMB: Add\nShift: Sub"}
            </div>
          </div>

          {/* Center: preview */}
          <div className="flex-1 bg-[#1a1a1a] flex items-center justify-center p-4 overflow-hidden">
            <div className={viewMode === "on-black" || viewMode === "on-white" || viewMode === "on-blue" ? "" : "ps-checker rounded"}>
              <canvas
                ref={previewRef}
                className="block cursor-crosshair max-w-full max-h-full"
                onPointerDown={onPreviewPointerDown}
                onPointerMove={onPreviewPointerMove}
                onPointerUp={onPreviewPointerUp}
                style={{ touchAction: "none" }}
              />
            </div>
          </div>

          {/* Right: properties */}
          <div className="w-[260px] overflow-y-auto border-l border-[var(--ps-divider)] shrink-0">
            {/* View Mode */}
            <PropSection title="View Mode">
              <select
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value as ViewMode)}
                className="w-full h-6 bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] rounded-sm px-1 text-[11px]"
              >
                {VIEW_MODES.map((v) => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
              </select>
              {viewMode === "overlay" && (
                <div className="mt-2">
                  <PropSlider label="Opacity" value={opacity} min={0} max={100} suffix="%" onChange={setOpacity} />
                </div>
              )}
            </PropSection>

            {/* Edge Detection */}
            <PropSection title="Edge Detection">
              <label className="flex items-center gap-2 text-[11px] mb-2">
                <Checkbox
                  checked={smartRadius}
                  onCheckedChange={(v) => setSmartRadius(v === true)}
                  className="border-[var(--ps-divider)]"
                />
                Smart Radius
              </label>
              <PropSlider label="Radius" value={edgeRadius} min={0} max={250} suffix="px" onChange={setEdgeRadius} />
            </PropSection>

            {/* Brush Size */}
            {(activeTool === "brush" || activeTool === "refine-edge") && (
              <PropSection title="Brush">
                <PropSlider label="Size" value={brushSize} min={1} max={250} suffix="px" onChange={setBrushSize} />
              </PropSection>
            )}

            {/* Global Refinements */}
            <PropSection title="Global Refinements">
              <PropSlider label="Smooth" value={smooth} min={0} max={20} onChange={setSmooth} />
              <PropSlider label="Feather" value={feather} min={0} max={50} suffix="px" onChange={setFeather} />
              <PropSlider label="Contrast" value={contrast} min={0} max={100} suffix="%" onChange={setContrast} />
              <PropSlider label="Shift Edge" value={shiftEdge} min={-100} max={100} suffix="%" onChange={setShiftEdge} />
            </PropSection>

            {/* Output Settings */}
            <PropSection title="Output Settings">
              <label className="flex items-center gap-2 text-[11px] mb-2">
                <Checkbox
                  checked={decontaminate}
                  onCheckedChange={(v) => setDecontaminate(v === true)}
                  className="border-[var(--ps-divider)]"
                />
                Decontaminate Colors
              </label>
              <div className="space-y-1">
                <Label className="text-[10px] text-[var(--ps-text-dim)]">Output To</Label>
                <select
                  value={outputTo}
                  onChange={(e) => setOutputTo(e.target.value as OutputTo)}
                  className="w-full h-6 bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] rounded-sm px-1 text-[11px]"
                >
                  {OUTPUT_TARGETS.map((target) => (
                    <option key={target.id} value={target.id}>{target.label}</option>
                  ))}
                </select>
              </div>
            </PropSection>
          </div>
        </div>

        <DialogFooter className="px-4 py-2 border-t border-[var(--ps-divider)]">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleApply}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---- Reusable components ---- */
function PropSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--ps-divider)]">
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)] bg-[var(--ps-panel-2)]">
        {title}
      </div>
      <div className="px-3 py-2 space-y-2">{children}</div>
    </div>
  )
}

function PropSlider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[var(--ps-text-dim)]">{label}</span>
        <span className="tabular-nums">{value}{suffix ?? ""}</span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step ?? 1}
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  )
}
