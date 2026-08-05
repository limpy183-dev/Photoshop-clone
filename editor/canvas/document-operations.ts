/**
 * Canvas gestures that rewrite pixels in one shot rather than over a stroke:
 * the two crops, the gradient commit, red-eye, and the magic eraser.
 *
 * The crops resize every layer canvas in the document, so they are the only
 * operations here that change the document's own dimensions — which is why they
 * clear the selection and commit with "all" rather than a layer list.
 */

import * as React from "react"

import { getNativeComposite } from "@/editor/blend-modes"
import type { ChangedLayerIds } from "@/editor/history-geometry"
import type { RenderChange } from "@/editor/render-bus"
import { perspectiveCropImageData } from "@/editor/photo-workflow-engine"
import { floodFillMask, hexToRgb } from "@/editor/tool/helpers"
import { colorDistance } from "@/editor/canvas/eraser-helpers"
import { drawGradientPreview as drawGradientPreviewOverlay } from "@/editor/canvas/overlay-previews"
import { applySelectionMaskToCanvas } from "@/editor/canvas/selection-helpers"
import { makeCanvas } from "@/editor/canvas/utils"
import { clamp01, sortCorners } from "@/editor/canvas/view-helpers"
import { layerAllowsDrawing } from "@/editor/canvas/view-runtime"
import type { Action } from "@/editor/reducer"
import type { BrushSettings, EraserSettings, GradientSettings, Layer, PsDocument } from "@/editor/types"

export interface DocumentOpsOptions {
  activeDoc: PsDocument | null | undefined
  activeLayer: Layer | null | undefined
  brush: BrushSettings
  eraser: EraserSettings
  gradient: GradientSettings
  foreground: string
  background: string
  overlayRef: React.RefObject<HTMLCanvasElement | null>
  /** Selection membership test, live-aware during a stroke. */
  withinSelection: (p: { x: number; y: number }) => boolean
  captureHighBitPaintSource: () => void
  syncActiveLayerHighBitFromCanvas: () => void
  dispatch: React.Dispatch<Action>
  commit: (label: string, changedLayerIds?: ChangedLayerIds) => void
  requestRender: (change?: RenderChange) => void
}

export function useCanvasDocumentOps(options: DocumentOpsOptions) {
  const {
    activeDoc,
    activeLayer,
    brush,
    eraser,
    gradient,
    foreground,
    background,
    overlayRef,
    withinSelection,
    captureHighBitPaintSource,
    syncActiveLayerHighBitFromCanvas,
    dispatch,
    commit,
    requestRender,
  } = options

  /* ---- gradient ---- */

  function drawGradientPreview(start: { x: number; y: number }, end: { x: number; y: number }) {
    const ov = overlayRef.current
    if (!ov || !activeDoc || !activeLayer) return
    drawGradientPreviewOverlay(ov, activeDoc, gradient, foreground, background, start, end)
  }

  function commitGradient() {
    if (!activeDoc || !layerAllowsDrawing(activeLayer)) return
    const ov = overlayRef.current
    if (!ov) return
    const ctx = activeLayer.canvas.getContext("2d")!
    // The overlay already carries the ramp at the configured opacity, so only
    // the blend mode and the two masks (selection, transparency) apply here.
    let source: HTMLCanvasElement = ov
    if (activeDoc.selection.bounds?.w && activeDoc.selection.bounds.h) {
      const clipped = makeCanvas(activeDoc.width, activeDoc.height)
      clipped.getContext("2d")!.drawImage(ov, 0, 0)
      applySelectionMaskToCanvas(clipped, activeDoc)
      source = clipped
    }
    if (gradient.preserveTransparency) {
      const masked = source === ov ? makeCanvas(activeDoc.width, activeDoc.height) : source
      const mctx = masked.getContext("2d")!
      if (masked !== source) mctx.drawImage(ov, 0, 0)
      mctx.globalCompositeOperation = "destination-in"
      mctx.drawImage(activeLayer.canvas, 0, 0)
      mctx.globalCompositeOperation = "source-over"
      source = masked
    }
    ctx.save()
    ctx.globalCompositeOperation = getNativeComposite(gradient.blendMode ?? "normal") ?? "source-over"
    ctx.drawImage(source, 0, 0)
    ctx.restore()
    ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
    requestRender()
  }

  /* ---- crops ---- */

  function applyCrop(b: { x: number; y: number; w: number; h: number }) {
    if (!activeDoc) return
    const newW = Math.max(1, Math.round(b.w))
    const newH = Math.max(1, Math.round(b.h))
    // Resize a canvas in place to the crop, keeping the pixels under the box.
    const cropCanvas = (canvas: HTMLCanvasElement) => {
      const tmp = makeCanvas(newW, newH)
      tmp.getContext("2d")!.drawImage(canvas, -b.x, -b.y)
      canvas.width = newW
      canvas.height = newH
      const ctx = canvas.getContext("2d")!
      ctx.clearRect(0, 0, newW, newH)
      ctx.drawImage(tmp, 0, 0)
    }
    for (const layer of activeDoc.layers) {
      if (typeof layer.canvas.getContext !== "function") continue
      cropCanvas(layer.canvas)
      // Masks are document-sized too; leaving them at the old size made every
      // masked layer read its mask against mismatched coordinates after a crop.
      if (layer.mask && typeof layer.mask.getContext === "function") cropCanvas(layer.mask)
    }
    activeDoc.width = newW
    activeDoc.height = newH
    dispatch({ type: "set-selection", selection: { bounds: null, shape: "rect" } })
    requestRender()
    commit("Crop", "all")
  }

  function applyPerspectiveCrop(corners: { x: number; y: number }[]) {
    if (!activeDoc || corners.length < 4) return
    // Sort corners: TL, TR, BR, BL
    const sorted = sortCorners(corners)
    const [tl, tr, br, bl] = sorted

    // Determine output size from the bounding box
    const topW = Math.hypot(tr.x - tl.x, tr.y - tl.y)
    const bottomW = Math.hypot(br.x - bl.x, br.y - bl.y)
    const leftH = Math.hypot(bl.x - tl.x, bl.y - tl.y)
    const rightH = Math.hypot(br.x - tr.x, br.y - tr.y)
    const outW = Math.round(Math.max(topW, bottomW))
    const outH = Math.round(Math.max(leftH, rightH))

    if (outW < 4 || outH < 4) return

    for (const layer of activeDoc.layers) {
      if (typeof layer.canvas.getContext !== "function") continue
      const srcCtx = layer.canvas.getContext("2d")!
      const srcData = srcCtx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
      const dst = perspectiveCropImageData(srcData, [tl, tr, br, bl]).image

      layer.canvas.width = outW
      layer.canvas.height = outH
      layer.canvas.getContext("2d")!.putImageData(dst, 0, 0)
    }

    activeDoc.width = outW
    activeDoc.height = outH
    dispatch({ type: "set-selection", selection: { bounds: null, shape: "rect" } })
    requestRender()
    commit("Perspective Crop", "all")
  }

  /* ---- one-shot retouch ---- */

  /** Desaturate the red channel inside the brush footprint where it dominates. */
  function applyRedEyeCorrection(pt: { x: number; y: number }) {
    if (!activeDoc || !layerAllowsDrawing(activeLayer) || typeof activeLayer.canvas.getContext !== "function") return
    const ctx = activeLayer.canvas.getContext("2d")!
    const radius = Math.max(4, brush.size / 2)
    const sx = Math.max(0, Math.floor(pt.x - radius))
    const sy = Math.max(0, Math.floor(pt.y - radius))
    const ex = Math.min(activeDoc.width, Math.ceil(pt.x + radius))
    const ey = Math.min(activeDoc.height, Math.ceil(pt.y + radius))
    const w = ex - sx
    const h = ey - sy
    if (w <= 0 || h <= 0) return
    const img = ctx.getImageData(sx, sy, w, h)
    let changed = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ax = sx + x
        const ay = sy + y
        const dist = Math.hypot(ax - pt.x, ay - pt.y)
        if (dist > radius || !withinSelection({ x: ax, y: ay })) continue
        const i = (y * w + x) * 4
        const r = img.data[i]
        const g = img.data[i + 1]
        const b = img.data[i + 2]
        const a = img.data[i + 3]
        if (a < 12) continue
        const redDominance = r - Math.max(g, b)
        const redRatio = r / Math.max(1, (g + b) / 2)
        if (redDominance < 32 || redRatio < 1.28 || r < 80) continue
        const falloff = Math.max(0, Math.min(1, 1 - dist / radius))
        const correction = falloff * 0.9
        const neutral = Math.round((g + b) / 2)
        img.data[i] = Math.round(r * (1 - correction) + neutral * correction * 0.55)
        img.data[i + 1] = Math.round(g * (1 - correction * 0.35) + neutral * correction * 0.35)
        img.data[i + 2] = Math.round(b * (1 - correction * 0.35) + neutral * correction * 0.35)
        changed++
      }
    }
    if (!changed) return
    ctx.putImageData(img, sx, sy)
    requestRender()
    commit("Red Eye Correction", { ids: [activeLayer.id], bounds: { [activeLayer.id]: { x: sx, y: sy, w, h } } })
  }

  /** Magic eraser: one click erases the whole matched region, not a dab. */
  function magicEraseAt(point: { x: number; y: number }) {
    if (!activeDoc || !layerAllowsDrawing(activeLayer) || typeof activeLayer.canvas.getContext !== "function") return
    captureHighBitPaintSource()
    const ctx = activeLayer.canvas.getContext("2d")!
    const src = ctx.getImageData(0, 0, activeDoc.width, activeDoc.height)
    const mask = floodFillMask(src, point.x, point.y, eraser.tolerance, eraser.limits !== "discontiguous")
    const fg = hexToRgb(foreground)
    const amount = clamp01((brush.opacity / 100) * (brush.flow / 100))
    for (let i = 0; i < src.data.length; i += 4) {
      if (mask.data[i + 3] <= 0) continue
      if (eraser.protectForeground) {
        const d = colorDistance({ r: src.data[i], g: src.data[i + 1], b: src.data[i + 2], a: src.data[i + 3] }, fg)
        if (d <= Math.max(12, eraser.tolerance * 0.85)) continue
      }
      src.data[i + 3] = Math.round(src.data[i + 3] * (1 - amount))
    }
    ctx.putImageData(src, 0, 0)
    syncActiveLayerHighBitFromCanvas()
    requestRender()
    commit("Magic Eraser", [activeLayer.id])
  }

  return {
    drawGradientPreview,
    commitGradient,
    applyCrop,
    applyPerspectiveCrop,
    applyRedEyeCorrection,
    magicEraseAt,
  }
}

export type CanvasDocumentOps = ReturnType<typeof useCanvasDocumentOps>
