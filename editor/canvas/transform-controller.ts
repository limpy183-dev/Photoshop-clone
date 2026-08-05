/**
 * The Free Transform session and the layer transforms driven from the menu.
 *
 * A session snapshots the layer's pixels once, then every handle drag and every
 * numeric edit from the options bar re-renders that snapshot through the same
 * matrix — so the layer never accumulates resampling error while the box is
 * open. Committing bakes the current matrix; cancelling restores the snapshot.
 *
 * The matrix maths itself lives in `transform-geometry.ts` and the drawing in
 * `transform-preview.ts`; this owns the session and the event wiring.
 */

import * as React from "react"

import { addPhotoshopEventListener } from "@/editor/events"
import type { ChangedLayerIds } from "@/editor/history-geometry"
import type { RenderChange } from "@/editor/render-bus"
import { drawTransformHandles as drawTransformHandlesOverlay } from "@/editor/canvas/overlay-previews"
import { alphaBounds } from "@/editor/canvas/selection-helpers"
import { drawTransformSourcePreview } from "@/editor/canvas/transform-preview"
import {
  applyTransformHandleDrag,
  clampTransformSkew,
  finiteOr,
  type TransformDragState,
  type TransformHandleId,
  type TransformOptionsEvent,
} from "@/editor/canvas/transform-geometry"
import type { CanvasDragRef } from "@/editor/canvas/drag-state"
import { makeCanvas } from "@/editor/canvas/utils"
import { layerAllowsDrawing, layerAllowsMoving } from "@/editor/canvas/view-runtime"
import type { Layer, PsDocument } from "@/editor/types"

export interface TransformControllerOptions {
  activeDoc: PsDocument | null | undefined
  activeLayer: Layer | null | undefined
  overlayRef: React.RefObject<HTMLCanvasElement | null>
  drawingRef: CanvasDragRef
  commit: (label: string, changedLayerIds?: ChangedLayerIds) => void
  requestRender: (change?: RenderChange) => void
}

export function useCanvasTransform(options: TransformControllerOptions) {
  const { activeDoc, activeLayer, overlayRef, drawingRef, commit, requestRender } = options

  const transformRef = React.useRef<TransformDragState | null>(null)

  function clearOverlay() {
    const ov = overlayRef.current
    if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
  }

  function drawTransformHandles() {
    const ov = overlayRef.current
    if (!ov || !activeDoc || !transformRef.current) return
    drawTransformHandlesOverlay(ov, transformRef.current)
  }

  function beginTransform(layer: Layer) {
    if (!activeDoc) return
    const snapshot = makeCanvas(activeDoc.width, activeDoc.height)
    snapshot.getContext("2d")!.drawImage(layer.canvas, 0, 0)
    // Compute layer bounds from alpha
    const bounds = alphaBounds(layer.canvas) ?? { x: 0, y: 0, w: layer.canvas.width, h: layer.canvas.height }
    transformRef.current = {
      layerId: layer.id,
      source: snapshot,
      bounds,
      tx: 0,
      ty: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      skewX: 0,
      skewY: 0,
      referencePoint: "mc",
      constrainProportions: true,
      interpolation: "bicubic",
    }
    drawTransformHandles()
  }

  function commitTransform() {
    if (!activeDoc || !transformRef.current) return
    const t = transformRef.current
    const layer = activeDoc.layers.find((l) => l.id === t.layerId)
    if (!layer) {
      transformRef.current = null
      return
    }
    const ctx = layer.canvas.getContext("2d")!
    ctx.clearRect(0, 0, activeDoc.width, activeDoc.height)
    if (t.source) {
      ctx.save()
      drawTransformSourcePreview(ctx, t)
      ctx.restore()
    }
    transformRef.current = null
    clearOverlay()
    requestRender()
    commit("Free Transform", [layer.id])
  }

  function renderTransformPreview() {
    if (!activeDoc || !transformRef.current) return
    const t = transformRef.current
    const layer = activeDoc.layers.find((l) => l.id === t.layerId)
    if (!layer || !t.source) return
    const ctx = layer.canvas.getContext("2d")!
    ctx.clearRect(0, 0, activeDoc.width, activeDoc.height)
    ctx.save()
    drawTransformSourcePreview(ctx, t)
    ctx.restore()
    requestRender()
  }

  function handleTransformDrag(p: { x: number; y: number }, handle: TransformHandleId, shift: boolean, perspectiveDrag = false) {
    const t = transformRef.current
    if (!t) return
    applyTransformHandleDrag(t, drawingRef.current, p, handle, shift, perspectiveDrag)
  }

  /** Drop the session without baking it, leaving the layer as the preview left it. */
  function discardTransform() {
    transformRef.current = null
    clearOverlay()
    requestRender()
  }

  /* ---- Free Transform / flip / rotate triggers from menu ---- */

  React.useEffect(() => {
    function ftHandler() {
      if (layerAllowsMoving(activeLayer)) beginTransform(activeLayer)
    }
    function flipHandler(e: Event) {
      if (!activeDoc || !layerAllowsDrawing(activeLayer)) return
      if (typeof activeLayer.canvas.getContext !== "function") return
      const tmp = makeCanvas(activeLayer.canvas.width, activeLayer.canvas.height)
      const ctx = tmp.getContext("2d")!
      if ((e as CustomEvent<string>).detail === "horizontal") {
        ctx.translate(activeLayer.canvas.width, 0)
        ctx.scale(-1, 1)
      } else {
        ctx.translate(0, activeLayer.canvas.height)
        ctx.scale(1, -1)
      }
      ctx.drawImage(activeLayer.canvas, 0, 0)
      const lc = activeLayer.canvas.getContext("2d")!
      lc.clearRect(0, 0, activeLayer.canvas.width, activeLayer.canvas.height)
      lc.drawImage(tmp, 0, 0)
      requestRender()
      commit(`Flip Layer ${(e as CustomEvent<string>).detail}`, [activeLayer.id])
    }
    function rotateHandler(e: Event) {
      if (!activeDoc || !layerAllowsDrawing(activeLayer)) return
      const deg = Number((e as CustomEvent<number>).detail) || 0
      const w = activeLayer.canvas.width
      const h = activeLayer.canvas.height
      const tmp = makeCanvas(w, h)
      const ctx = tmp.getContext("2d")!
      ctx.translate(w / 2, h / 2)
      ctx.rotate((deg * Math.PI) / 180)
      ctx.drawImage(activeLayer.canvas, -w / 2, -h / 2)
      const lc = activeLayer.canvas.getContext("2d")!
      lc.clearRect(0, 0, w, h)
      lc.drawImage(tmp, 0, 0)
      requestRender()
      commit(`Rotate Layer ${deg}°`, [activeLayer.id])
    }
    function setTransformHandler(e: Event) {
      if (!activeDoc || !layerAllowsMoving(activeLayer)) return
      const detail = (e as CustomEvent<Partial<TransformOptionsEvent>>).detail
      if (!detail) return
      if (!transformRef.current || transformRef.current.layerId !== activeLayer.id) {
        beginTransform(activeLayer)
      }
      const t = transformRef.current
      if (!t) return
      t.tx = finiteOr(detail.tx, t.tx)
      t.ty = finiteOr(detail.ty, t.ty)
      t.scaleX = finiteOr(detail.widthPct, t.scaleX * 100) / 100
      t.scaleY = finiteOr(detail.heightPct, t.scaleY * 100) / 100
      t.rotation = finiteOr(detail.rotation, t.rotation)
      t.skewX = clampTransformSkew(finiteOr(detail.skewX, t.skewX))
      t.skewY = clampTransformSkew(finiteOr(detail.skewY, t.skewY))
      t.referencePoint = detail.referencePoint ?? t.referencePoint ?? "mc"
      t.constrainProportions = detail.constrainProportions ?? t.constrainProportions ?? true
      t.interpolation = detail.interpolation ?? t.interpolation ?? "bicubic"
      renderTransformPreview()
      drawTransformHandles()
    }
    function commitTransformHandler() {
      commitTransform()
    }
    function cancelTransformHandler() {
      const t = transformRef.current
      if (activeDoc && t?.source) {
        const layer = activeDoc.layers.find((l) => l.id === t.layerId)
        if (layer) {
          const ctx = layer.canvas.getContext("2d")!
          ctx.clearRect(0, 0, activeDoc.width, activeDoc.height)
          ctx.drawImage(t.source, 0, 0)
        }
      }
      discardTransform()
    }
    const removers = [
      addPhotoshopEventListener("ps-free-transform", ftHandler),
      addPhotoshopEventListener("ps-transform-flip", (_detail, event) => flipHandler(event)),
      addPhotoshopEventListener("ps-transform-rotate", (_detail, event) => rotateHandler(event)),
      addPhotoshopEventListener("ps-transform-set", (_detail, event) => setTransformHandler(event)),
      addPhotoshopEventListener("ps-transform-commit", commitTransformHandler),
      addPhotoshopEventListener("ps-transform-cancel", cancelTransformHandler),
    ]
    return () => {
      removers.forEach((remove) => remove())
    }
    // Transform handlers are event entrypoints that read mutable refs; helper dependencies would churn global listeners per drag frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDoc, activeLayer, commit, requestRender])

  return {
    transformRef,
    beginTransform,
    commitTransform,
    renderTransformPreview,
    handleTransformDrag,
    drawTransformHandles,
    discardTransform,
  }
}

export type CanvasTransformController = ReturnType<typeof useCanvasTransform>
