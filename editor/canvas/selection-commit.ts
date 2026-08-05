/**
 * Turning a gesture into the document's selection.
 *
 * Every selection tool ends up in `commitSelection`, which rasterises the raw
 * shape, feathers it, combines it with the existing selection per the options
 * bar mode, and publishes the resulting bounds + mask. The magnetic-lasso
 * helpers live here too because they only exist to feed that same path.
 */

import * as React from "react"

import { getLayerHighBitImage, highBitImageToSelectionSource } from "@/editor/high-bit-document"
import { containsSelectionPoint, type SelectionHitTester } from "@/editor/selection-hit-testing"
import type { SelectionHitTester as _SelectionHitTester } from "@/editor/selection-hit-testing"
import {
  featherMask,
  magneticLassoSnap,
  magneticLassoTrace,
  polygonBounds,
  polygonToMask,
  selectionToMaskCanvas,
} from "@/editor/tool/helpers"
import { makeCanvas } from "@/editor/canvas/utils"
import { maskBounds } from "@/editor/canvas/view-helpers"
import type { Action } from "@/editor/reducer"
import type { Layer, PsDocument, Selection, SelectionOptions, ToolId } from "@/editor/types"

export interface SelectionOpsOptions {
  activeDoc: PsDocument | null | undefined
  activeLayer: Layer | null | undefined
  tool: ToolId
  selectionOptions: SelectionOptions
  compositeRef: React.RefObject<HTMLCanvasElement | null>
  overlayRef: React.RefObject<HTMLCanvasElement | null>
  /** Live during a paint stroke; falls back to a per-call point test when null. */
  selectionHitTesterRef: React.RefObject<SelectionHitTester | null>
  dispatch: React.Dispatch<Action>
}

export function useCanvasSelectionOps(options: SelectionOpsOptions) {
  const { activeDoc, activeLayer, tool, selectionOptions, compositeRef, overlayRef, selectionHitTesterRef, dispatch } = options

  function withinSelection(p: { x: number; y: number }): boolean {
    if (!activeDoc) return true
    return selectionHitTesterRef.current?.contains(p) ?? containsSelectionPoint(activeDoc.width, activeDoc.height, activeDoc.selection, p)
  }

  /**
   * Rasterise `raw`, feather it, combine with the current selection per the
   * options-bar mode, and publish. An empty result clears the selection.
   */
  function commitSelection(raw: Selection) {
    if (!activeDoc) return
    let rawMask = selectionToMaskCanvas(activeDoc.width, activeDoc.height, raw)
    if (!rawMask) {
      dispatch({ type: "set-selection", selection: { bounds: null, shape: "rect" } })
      return
    }
    if (selectionOptions.feather > 0) {
      rawMask = featherMask(rawMask, selectionOptions.feather)
    }
    let nextMask = rawMask
    if (selectionOptions.mode !== "new" && activeDoc.selection.bounds) {
      const existing = selectionToMaskCanvas(activeDoc.width, activeDoc.height, activeDoc.selection)
      if (existing) {
        nextMask = makeCanvas(activeDoc.width, activeDoc.height)
        const nctx = nextMask.getContext("2d")!
        nctx.drawImage(existing, 0, 0)
        if (selectionOptions.mode === "add") {
          nctx.globalCompositeOperation = "source-over"
          nctx.drawImage(rawMask, 0, 0)
        } else if (selectionOptions.mode === "subtract") {
          nctx.globalCompositeOperation = "destination-out"
          nctx.drawImage(rawMask, 0, 0)
        } else {
          nctx.globalCompositeOperation = "destination-in"
          nctx.drawImage(rawMask, 0, 0)
        }
        nctx.globalCompositeOperation = "source-over"
      }
    }
    const bounds = maskBounds(nextMask, activeDoc.width, activeDoc.height)
    dispatch({
      type: "set-selection",
      selection: bounds
        ? {
            bounds,
            shape: raw.shape,
            mask: nextMask,
            feather: selectionOptions.feather,
            diagnostics: raw.diagnostics,
          }
        : { bounds: null, shape: "rect" },
    })
  }

  /* ---- magnetic lasso ---- */

  function snapMagneticPoint(pt: { x: number; y: number }) {
    if (!activeLayer || typeof activeLayer.canvas.getContext !== "function") return pt
    return magneticLassoSnap(activeLayer.canvas, pt.x, pt.y, {
      searchWidth: Math.max(4, Math.min(64, (selectionOptions.magneticWidth ?? Math.round(selectionOptions.tolerance / 3)) || 12)),
      contrastThreshold: Math.max(0.01, Math.min(512, selectionOptions.magneticContrast ?? selectionOptions.tolerance ?? 24)),
      hysteresisRatio: Math.max(0.1, Math.min(0.95, (selectionOptions.magneticHysteresis ?? 45) / 100)),
    })
  }

  /** Distance between dropped anchors, derived from the frequency setting. */
  function magneticAnchorInterval() {
    const frequency = Math.max(0, Math.min(100, selectionOptions.magneticFrequency ?? 57))
    if (frequency <= 0) return Number.POSITIVE_INFINITY
    return Math.max(6, Math.round(104 - frequency * 0.88))
  }

  /** Trace against the layer's high-bit companion when one exists. */
  function selectionTraceSourceForLayer(fallback: HTMLCanvasElement) {
    if (!activeDoc || selectionOptions.sampleAllLayers || !activeLayer) return fallback
    const highBit = getLayerHighBitImage(activeLayer, activeDoc)
    return highBit ? highBitImageToSelectionSource(highBit) : fallback
  }

  /** Close a polygon/magnetic lasso, snapping the outline to edges if magnetic. */
  function finalizePolyLasso(points: { x: number; y: number }[]) {
    if (!activeDoc) return
    const ov = overlayRef.current
    if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
    let finalPoints = points
    if (tool === "lasso-magnetic" && activeLayer && typeof activeLayer.canvas.getContext === "function") {
      const sourceCanvas = selectionOptions.sampleAllLayers ? compositeRef.current : activeLayer.canvas
      if (sourceCanvas) {
        const first = points[0]
        const last = points[points.length - 1]
        const anchors = first && last && Math.hypot(first.x - last.x, first.y - last.y) > 0.001
          ? [...points, first]
          : points
        const traced = magneticLassoTrace(selectionTraceSourceForLayer(sourceCanvas), anchors, {
          searchWidth: Math.max(4, Math.min(64, selectionOptions.magneticWidth ?? 12)),
          contrastThreshold: Math.max(0.01, Math.min(512, selectionOptions.magneticContrast ?? selectionOptions.tolerance ?? 24)),
          hysteresisRatio: Math.max(0.1, Math.min(0.95, (selectionOptions.magneticHysteresis ?? 45) / 100)),
          smoothing: Math.max(0, Math.min(1, (selectionOptions.magneticSmoothing ?? 35) / 100)),
        })
        if (traced.points.length >= 3) finalPoints = traced.points
      }
    }
    const mask = polygonToMask(activeDoc.width, activeDoc.height, finalPoints)
    const b = polygonBounds(finalPoints)
    commitSelection({ bounds: b, shape: "polygon", mask })
  }

  /** The canvas selection tools sample from: the composite, or the active layer. */
  function selectionSourceCanvas() {
    return selectionOptions.sampleAllLayers ? compositeRef.current : activeLayer?.canvas ?? null
  }

  return {
    withinSelection,
    commitSelection,
    snapMagneticPoint,
    magneticAnchorInterval,
    selectionTraceSourceForLayer,
    finalizePolyLasso,
    selectionSourceCanvas,
  }
}

export type CanvasSelectionOps = ReturnType<typeof useCanvasSelectionOps>
