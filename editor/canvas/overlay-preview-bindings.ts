/**
 * Binds the pure painters in `overlay-previews.ts` to the live overlay canvas
 * and the current tool state, so callers only supply the gesture geometry.
 *
 * Each binding is the same three steps — resolve the overlay canvas, bail if it
 * or the document is missing, forward the tool state — which is exactly the
 * boilerplate that does not belong inline in the pointer handlers.
 */

import * as React from "react"

import {
  drawBrushPreview as drawBrushPreviewOverlay,
  drawLassoPreview as drawLassoPreviewOverlay,
  drawMarqueePreview as drawMarqueePreviewOverlay,
  drawPatchPreview as drawPatchPreviewOverlay,
  drawPerspectiveCropPreview as drawPerspectiveCropPreviewOverlay,
  drawRulerPreview as drawRulerPreviewOverlay,
  drawSliceSelectionPreview as drawSliceSelectionPreviewOverlay,
  drawTextBoxPreview as drawTextBoxPreviewOverlay,
} from "@/editor/canvas/overlay-previews"
import type { SelectionImageSource } from "@/editor/selection-algorithms"
import type { BrushSettings, CloneSourceSettings, PsDocument, SelectionOptions, ToolId } from "@/editor/types"

export interface PatchDraft {
  mask: HTMLCanvasElement
  bounds: { x: number; y: number; w: number; h: number }
}

export interface OverlayPreviewOptions {
  activeDoc: PsDocument | null | undefined
  tool: ToolId
  brush: BrushSettings
  cloneSource: CloneSourceSettings
  selectionOptions: SelectionOptions
  overlayRef: React.RefObject<HTMLCanvasElement | null>
  compositeRef: React.RefObject<HTMLCanvasElement | null>
  patchRef: React.RefObject<PatchDraft | null>
  activeLayerCanvas: HTMLCanvasElement | null
  visualZoomRef: React.RefObject<number>
  textDefaultSize: () => number
  selectionTraceSourceForLayer: (fallback: HTMLCanvasElement) => HTMLCanvasElement | SelectionImageSource
}

export function useOverlayPreviews(options: OverlayPreviewOptions) {
  const {
    activeDoc,
    tool,
    brush,
    cloneSource,
    selectionOptions,
    overlayRef,
    compositeRef,
    patchRef,
    activeLayerCanvas,
    visualZoomRef,
    textDefaultSize,
    selectionTraceSourceForLayer,
  } = options

  /** The overlay canvas, or null when it or the document is not ready. */
  function surface() {
    const ov = overlayRef.current
    return ov && activeDoc ? ov : null
  }

  function clearOverlay() {
    const ov = overlayRef.current
    if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
  }

  function drawMarqueePreview(start: { x: number; y: number }, end: { x: number; y: number }) {
    const ov = surface()
    if (ov) drawMarqueePreviewOverlay(ov, activeDoc!, tool, start, end)
  }

  function drawTextBoxPreview(start: { x: number; y: number }, end: { x: number; y: number }) {
    const ov = surface()
    if (ov) drawTextBoxPreviewOverlay(ov, textDefaultSize(), visualZoomRef.current, start, end)
  }

  function drawRulerPreview(start: { x: number; y: number }, end: { x: number; y: number }) {
    const ov = surface()
    if (ov) drawRulerPreviewOverlay(ov, start, end)
  }

  function drawBrushPreview(center: { x: number; y: number }, radius: number) {
    const ov = surface()
    if (ov) drawBrushPreviewOverlay(ov, tool, brush, cloneSource, center, radius)
  }

  function drawLassoPreview(points: { x: number; y: number }[], hover?: { x: number; y: number }) {
    const ov = surface()
    if (!ov) return
    drawLassoPreviewOverlay(ov, points, hover, tool === "lasso-magnetic" ? {
      selectionOptions,
      resolveTraceSource: () => {
        const sourceCanvas = selectionOptions.sampleAllLayers ? compositeRef.current : activeLayerCanvas
        if (!sourceCanvas || typeof sourceCanvas.getContext !== "function") return null
        return selectionTraceSourceForLayer(sourceCanvas)
      },
    } : null)
  }

  function drawPatchPreview(offset?: { x: number; y: number }) {
    const ov = surface()
    const patch = patchRef.current
    if (ov && patch) drawPatchPreviewOverlay(ov, patch, offset)
  }

  function drawPerspectiveCropPreview(pts: { x: number; y: number }[]) {
    const ov = surface()
    if (ov) drawPerspectiveCropPreviewOverlay(ov, pts)
  }

  function drawSliceSelectionPreview(slice: { x: number; y: number; w: number; h: number; name: string }) {
    const ov = overlayRef.current
    if (ov) drawSliceSelectionPreviewOverlay(ov, slice)
  }

  return {
    clearOverlay,
    drawMarqueePreview,
    drawTextBoxPreview,
    drawRulerPreview,
    drawBrushPreview,
    drawLassoPreview,
    drawPatchPreview,
    drawPerspectiveCropPreview,
    drawSliceSelectionPreview,
  }
}

export type CanvasOverlayPreviews = ReturnType<typeof useOverlayPreviews>
