/**
 * Ending a canvas gesture: commit on pointer-up, abandon on pointer-cancel,
 * and the double-click shortcuts that re-enter editing on what was clicked.
 *
 * Pointer-cancel fires when the browser takes the gesture away, so it must not
 * read event coordinates — it commits an in-flight stroke (which never needs
 * them) and drops every other drag.
 */

import * as React from "react"
import { dispatchPhotoshopEvent } from "@/editor/events"
import {
  getEyedropperSampleSize,
  getFrameRuntimeOptions,
  getShapeRuntimeOptions,
  layerAllowsMoving,
} from "@/editor/canvas/view-runtime"
import {
  normalizeViewRotation,
  shapePropsForTool,
} from "@/editor/canvas/shape-helpers"
import {
  autoPickLayer,
  createRemoveMask,
  pickTextLayerAt,
  translateSelection,
} from "@/editor/canvas/selection-helpers"
import {
  drawArtboardPreview,
  drawFramePlaceholder,
} from "@/editor/canvas/preview-drawing"
import {
  editablePathForDirectSelection,
  translateVectorLayerGeometry,
} from "@/editor/canvas/vector-editing"
import {
  TEXT_BOX_DRAG_THRESHOLD,
} from "@/editor/canvas/overlay-previews"
import {
  alphaMaskFromCanvas,
  sampleCanvasColor,
} from "@/editor/canvas/view-helpers"
import {
  polygonToMask,
  polygonBounds,
  rasterizeShape,
  strokePath,
  makeCanvas,
  contentAwareFill,
  patchSelectionFromSource,
  objectSelectionMask,
  refineEdgeBrushMask,
  selectionFromMask,
  selectionToMaskCanvas,
} from "@/editor/tool/helpers"
import { hexToRgba } from "@/editor/color/utils"
import type { Layer } from "@/editor/types"
import type { CanvasPointerContext } from "@/editor/canvas/pointer-context"

export function handleCanvasPointerUp(ctx: CanvasPointerContext, e: React.PointerEvent<HTMLDivElement>) {
  const {
    activeDoc,
    activeLayer,
    tool,
    foreground,
    background,
    brush,
    selectionOptions,
    dispatch,
    commit,
    requestRender,
    compositeRef,
    overlayRef,
    drawingRef,
    removeRef,
    patchRef,
    brushResizeRef,
    moveFloatRef,
    paint,
    vectors,
    xform,
    selections,
    docOps,
    previews,
    handleBlurGalleryPointerUp,
    handleLightingEffectsPointerUp,
    beginTextEdit,
    getCanvasPoint,
    activeTextDefaults,
  } = ctx
  // Ensure pointer capture is released even if React's synthetic
  // pointer handling is interrupted (touch/pen handoff, devtools,
  // dragging across iframes). setPointerCapture was set in
  // onPointerDown; releasing here mirrors it.
  try {
    const target = e.target as Element | null
    if (target?.hasPointerCapture?.(e.pointerId)) {
      target.releasePointerCapture(e.pointerId)
    }
  } catch {
    /* no-op: some browsers throw if the capture was already released */
  }
  dispatchPhotoshopEvent("ps-tool-info", { kind: "clear" })
  const drag = drawingRef.current
  const pt = getCanvasPoint(e.clientX, e.clientY)

  if (handleBlurGalleryPointerUp()) {
    e.preventDefault()
    return
  }

  if (handleLightingEffectsPointerUp()) {
    e.preventDefault()
    return
  }

  if (tool === "slice" && drag.type === null && activeDoc) {
    const w = Math.max(1, Math.round(activeDoc.width * 0.12))
    const h = Math.max(1, Math.round(activeDoc.height * 0.09))
    const slice = {
      id: `slice_${Math.random().toString(36).slice(2, 9)}`,
      name: `Slice ${(activeDoc.slices ?? []).length + 1}`,
      x: Math.max(0, Math.min(activeDoc.width - w, Math.round(pt.x - w / 2))),
      y: Math.max(0, Math.min(activeDoc.height - h, Math.round(pt.y - h / 2))),
      w,
      h,
    }
    dispatch({ type: "add-slice", slice })
    setTimeout(() => commit("Create Slice", []), 0)
    return
  }

  // Alt+drag brush resize: if no drag happened, do eyedropper pick instead
  if (drag.type === "brush-resize") {
    const moved = brushResizeRef.current ? Math.abs(e.clientX - brushResizeRef.current.startClientX) > 3 : false
    if (!moved && drag.start) {
      const cv = compositeRef.current!
      const px = sampleCanvasColor(cv, drag.start, getEyedropperSampleSize())
      const hex = "#" + [px.r, px.g, px.b].map((c) => c.toString(16).padStart(2, "0")).join("")
      dispatch({ type: "set-foreground", color: hex })
    }
    brushResizeRef.current = null
    drawingRef.current = { type: null }
    return
  }

  if (drag.type === "text-box" && drag.start && activeDoc) {
    const start = drag.start
    drawingRef.current = { type: null }
    const ov = overlayRef.current
    if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
    const w = Math.abs(pt.x - start.x)
    const h = Math.abs(pt.y - start.y)
    const paragraph = w >= TEXT_BOX_DRAG_THRESHOLD && h >= TEXT_BOX_DRAG_THRESHOLD
    const vertical = tool === "type-vertical"
    const id = `text_${Math.random().toString(36).slice(2, 9)}`
    const layer: Layer = {
      id,
      name: vertical ? "Vertical Text" : "Text",
      kind: "text",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      canvas: makeCanvas(activeDoc.width, activeDoc.height),
      text: {
        ...activeTextDefaults(),
        x: paragraph ? Math.min(start.x, pt.x) : start.x,
        y: paragraph ? Math.min(start.y, pt.y) : start.y,
        vertical,
        ...(paragraph ? { boxWidth: w, boxHeight: h } : {}),
      },
    }
    dispatch({ type: "add-layer", layer })
    beginTextEdit(layer, true)
    return
  }

  if (drag.type === "stroke") {
    paint.commitActiveStroke()
    return
  }

  if (drag.type === "remove") {
    if (!activeLayer || !removeRef.current) {
      drawingRef.current = { type: null }
      removeRef.current = null
      return
    }

    const points = removeRef.current.points
    if (points.length < 1) {
      drawingRef.current = { type: null }
      removeRef.current = null
      return
    }

    // Create a mask from the stroked points
    const mask = createRemoveMask(points, brush.size, activeDoc!.width, activeDoc!.height)

    // Apply content-aware fill to remove the selected content
    contentAwareFill(activeLayer.canvas, { x: 0, y: 0, w: activeLayer.canvas.width, h: activeLayer.canvas.height }, mask)
    paint.syncActiveLayerHighBitFromCanvas()
    requestRender()

    // Clean up
    drawingRef.current = { type: null }
    removeRef.current = null
    commit("Remove Tool", [activeLayer.id])
    return
  }

  if (drag.type === "patch-lasso" && drag.points && activeDoc) {
    const points = drag.points
    drawingRef.current = { type: null }
    const ov = overlayRef.current
    if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
    if (points.length > 2) {
      const mask = polygonToMask(activeDoc.width, activeDoc.height, points)
      const selection = selectionFromMask(mask, "freehand")
      if (selection.bounds) {
        patchRef.current = { mask, bounds: selection.bounds }
        dispatch({ type: "set-selection", selection })
        previews.drawPatchPreview()
      }
    }
    return
  }

  if (drag.type === "patch-drag" && drag.start && activeLayer && patchRef.current) {
    const patch = patchRef.current
    const dx = pt.x - drag.start.x
    const dy = pt.y - drag.start.y
    drawingRef.current = { type: null }
    const ov = overlayRef.current
    if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
    if (Math.hypot(dx, dy) > 1) {
      patchSelectionFromSource(activeLayer.canvas, patch.mask, dx, dy, Math.max(3, brush.size * 0.2))
      paint.syncActiveLayerHighBitFromCanvas()
      requestRender()
      commit("Patch Tool", [activeLayer.id])
    } else {
      previews.drawPatchPreview()
    }
    patchRef.current = null
    return
  }

  if (drag.type === "move" && drag.moveLayerId && activeDoc) {
    const layer = activeDoc.layers.find((l) => l.id === drag.moveLayerId)
    const changedLayerIds = layer
      ? [
        layer.id,
        ...(layer.linkGroupId
          ? activeDoc.layers
            .filter((o) => o.id !== layer.id && o.linkGroupId === layer.linkGroupId && layerAllowsMoving(o))
            .map((o) => o.id)
          : []),
      ]
      : [drag.moveLayerId]
    const floatCanvas = layer?.canvas.__moveFloat
    const baseCanvas = layer?.canvas.__moveSnapshot
    const floated = !!floatCanvas
    // Path Selection drags a vector layer, so the geometry has to travel with
    // the pixels — otherwise the next re-rasterize snapped the shape back to
    // where it was authored and the move looked like it never happened.
    if (tool === "path-select" && layer && drag.moveDelta) {
      const { x: dx, y: dy } = drag.moveDelta
      if (translateVectorLayerGeometry(layer, dx, dy)) {
        vectors.rerenderVectorLayer(layer)
        if (layer.path) dispatch({ type: "set-layer-path", id: layer.id, path: layer.path })
        if (layer.shape) dispatch({ type: "set-layer-shape", id: layer.id, shape: layer.shape })
        if (layer.text) dispatch({ type: "set-layer-text", id: layer.id, text: layer.text })
        vectors.drawPathSelectionPreview(layer)
      }
    }
    if (layer) {
      if (tool === "content-aware-move") {
        const snapshot: HTMLCanvasElement | undefined = layer.canvas.__moveSnapshot
        if (snapshot) {
          const { mask, bounds } = alphaMaskFromCanvas(snapshot)
          if (bounds) contentAwareFill(layer.canvas, bounds, mask)
        }
      }
      delete layer.canvas.__moveSnapshot
      delete layer.canvas.__moveFloat
      if (layer.linkGroupId) {
        for (const o of activeDoc.layers) if (o.linkGroupId === layer.linkGroupId) delete o.canvas.__moveSnapshot
      }
    }
    // The marching ants travel with the pixels they lifted, so a second drag
    // picks up the same content rather than re-cutting the original hole.
    const moved = drag.moveDelta
    if (floated && moved && (moved.x || moved.y) && activeDoc.selection.bounds) {
      const selection = translateSelection(activeDoc, moved.x, moved.y)
      dispatch({ type: "set-selection", selection })
      const origin = drag.moveOrigin ?? { x: 0, y: 0 }
      // Keep the float alive against the selection we just published, so the
      // next drag moves these same pixels. Content-Aware Move heals the hole
      // into the layer itself, which leaves the base stale — it always re-lifts.
      moveFloatRef.current = layer && floatCanvas && baseCanvas && tool === "move"
        ? {
          layerId: layer.id,
          selection,
          base: baseCanvas,
          float: floatCanvas,
          x: origin.x + moved.x,
          y: origin.y + moved.y,
        }
        : null
    }
    drawingRef.current = { type: null }
    commit(tool === "content-aware-move" ? "Content-Aware Move" : "Move", changedLayerIds)
    return
  }

  if (drag.type === "eyedropper" || drag.type === "pen-handle") {
    drawingRef.current = { type: null }
    return
  }

  if (drag.type === "rotate-view" && activeDoc) {
    const moved = drag.start ? Math.hypot(pt.x - drag.start.x, pt.y - drag.start.y) > 3 : false
    if (!moved) {
      const values = [0, 90, 180, 270]
      const current = normalizeViewRotation(activeDoc.rotation ?? 0)
      const nearest = values.reduce((best, candidate) => Math.abs(candidate - current) < Math.abs(best - current) ? candidate : best, 0)
      const index = values.indexOf(nearest)
      const next = values[(index + 1) % values.length]
      dispatch({ type: "set-rotation", rotation: next as 0 | 90 | 180 | 270 })
    }
    drawingRef.current = { type: null }
    return
  }

  if (drag.type === "marquee" && drag.start && drag.last) {
    if (!activeDoc) return
    const x = Math.min(drag.start.x, drag.last.x)
    const y = Math.min(drag.start.y, drag.last.y)
    const w = Math.abs(drag.last.x - drag.start.x)
    const h = Math.abs(drag.last.y - drag.start.y)
    drawingRef.current = { type: null }
    const ov = overlayRef.current
    if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
    if (tool === "marquee-row") {
      const y1 = Math.max(0, Math.min(activeDoc.height - 1, Math.round(drag.start.y)))
      selections.commitSelection({
        bounds: { x: 0, y: y1, w: activeDoc.width, h: 1 },
        shape: "rect",
      })
    } else if (tool === "marquee-col") {
      const x1 = Math.max(0, Math.min(activeDoc.width - 1, Math.round(drag.start.x)))
      selections.commitSelection({
        bounds: { x: x1, y: 0, w: 1, h: activeDoc.height },
        shape: "rect",
      })
    } else if (w > 0 && h > 0) {
      selections.commitSelection({
        bounds: { x, y, w, h },
        shape: tool === "marquee-ellipse" ? "ellipse" : "rect",
      })
    }
    return
  }

  if (drag.type === "path-marquee" && drag.start && drag.last && activeDoc) {
    const layer = activeDoc.layers.find((candidate) => candidate.id === drag.directLayerId)
    const editablePath = layer ? editablePathForDirectSelection(layer) : null
    const x = Math.min(drag.start.x, drag.last.x)
    const y = Math.min(drag.start.y, drag.last.y)
    const w = Math.abs(drag.last.x - drag.start.x)
    const h = Math.abs(drag.last.y - drag.start.y)
    drawingRef.current = { type: null }
    const ov = overlayRef.current
    if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
    if (layer && editablePath && w > 2 && h > 2) {
      vectors.selectAnchorsInRect(layer, { x, y, w, h })
    }
    return
  }

  if (drag.type === "object-select" && drag.start && drag.last && activeDoc) {
    const x = Math.min(drag.start.x, drag.last.x)
    const y = Math.min(drag.start.y, drag.last.y)
    const w = Math.abs(drag.last.x - drag.start.x)
    const h = Math.abs(drag.last.y - drag.start.y)
    drawingRef.current = { type: null }
    const ov = overlayRef.current
    if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
    if (w > 3 && h > 3 && activeLayer && typeof activeLayer.canvas.getContext === "function") {
      const srcCanvas = selectionOptions.sampleAllLayers ? compositeRef.current : activeLayer.canvas
      if (srcCanvas) {
        const mask = objectSelectionMask(srcCanvas, { x, y, w, h }, selectionOptions.tolerance)
        selections.commitSelection(selectionFromMask(mask, "freehand"))
        commit("Object Selection", [])
      }
    }
    return
  }

  if (drag.type === "refine-edge" && drag.points && activeDoc && activeLayer) {
    drawingRef.current = { type: null }
    const ov = overlayRef.current
    if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
    const baseMask = selectionToMaskCanvas(activeDoc.width, activeDoc.height, activeDoc.selection)
    const srcCanvas = selectionOptions.sampleAllLayers ? compositeRef.current : activeLayer.canvas
    if (baseMask && srcCanvas && typeof srcCanvas.getContext === "function") {
      const refined = refineEdgeBrushMask(srcCanvas, baseMask, drag.points, brush.size, drag.refineMode ?? "expand")
      dispatch({ type: "set-selection", selection: selectionFromMask(refined, "freehand", activeDoc.selection.feather) })
      commit("Refine Edge Brush", [])
    }
    return
  }

  if (drag.type === "path-direct" && drag.directLayerId && activeDoc) {
    const layer = activeDoc.layers.find((candidate) => candidate.id === drag.directLayerId)
    drawingRef.current = { type: null }
    if (layer) {
      vectors.drawPathSelectionPreview(layer)
      if (layer.path) dispatch({ type: "set-layer-path", id: layer.id, path: layer.path })
      if (layer.text?.textPath) dispatch({ type: "set-layer-text", id: layer.id, text: layer.text })
      if (layer.shape) dispatch({ type: "set-layer-shape", id: layer.id, shape: layer.shape })
      commit("Direct Selection", [layer.id])
    }
    return
  }

  if (drag.type === "crop" && drag.start && drag.last) {
    const x = Math.min(drag.start.x, drag.last.x)
    const y = Math.min(drag.start.y, drag.last.y)
    const w = Math.abs(drag.last.x - drag.start.x)
    const h = Math.abs(drag.last.y - drag.start.y)
    drawingRef.current = { type: null }
    const ov = overlayRef.current
    if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
    if (w > 4 && h > 4 && activeDoc) docOps.applyCrop({ x, y, w, h })
    return
  }

  if (drag.type === "ruler" && drag.start && drag.last) {
    drawingRef.current = { type: null }
    dispatch({ type: "set-measurement", m: { x1: drag.start.x, y1: drag.start.y, x2: drag.last.x, y2: drag.last.y } })
    return
  }

  if (drag.type === "lasso" && drag.points && activeDoc) {
    const points = drag.points
    drawingRef.current = { type: null }
    const ov = overlayRef.current
    if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
    if (points.length > 2) {
      const mask = polygonToMask(activeDoc.width, activeDoc.height, points)
      const b = polygonBounds(points)
      selections.commitSelection({ bounds: b, shape: "freehand", mask })
    }
    return
  }

  if (drag.type === "freeform-path" && drag.points && activeDoc) {
    const points = vectors.simplifyFreeformPath(drag.points)
    drawingRef.current = { type: null }
    const ov = overlayRef.current
    if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
    if (points.length > 1) {
      const cv = makeCanvas(activeDoc.width, activeDoc.height)
      const path = { points, closed: false }
      strokePath(cv.getContext("2d")!, path, foreground, Math.max(1, brush.size / 4), false, hexToRgba(foreground, 0.3))
      const layer: Layer = {
        id: `path_${Math.random().toString(36).slice(2, 9)}`,
        name: "Freeform Path",
        kind: "shape",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        canvas: cv,
        path,
      }
      dispatch({ type: "add-layer", layer })
      setTimeout(() => commit("Freeform Pen Path", [layer.id]), 0)
    }
    return
  }

  if (drag.type === "shape" && drag.start && drag.last && activeDoc) {
    const startPt = drag.start
    const endPt = drag.last
    drawingRef.current = { type: null }
    const ov = overlayRef.current
    if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
    const x = Math.min(startPt.x, endPt.x)
    const y = Math.min(startPt.y, endPt.y)
    const w = Math.abs(endPt.x - startPt.x)
    const h = Math.abs(endPt.y - startPt.y)
    if (w < 2 && h < 2) return
    if (tool === "slice") {
      if (drag.sliceDraftId) {
        dispatch({
          type: "update-slice",
          id: drag.sliceDraftId,
          patch: {
            x: Math.round(x),
            y: Math.round(y),
            w: Math.max(1, Math.round(w)),
            h: Math.max(1, Math.round(h)),
          },
        })
        setTimeout(() => commit("Create Slice", []), 0)
        return
      }
      const slice = {
        id: `slice_${Math.random().toString(36).slice(2, 9)}`,
        name: `Slice ${(activeDoc.slices ?? []).length + 1}`,
        x: Math.round(x),
        y: Math.round(y),
        w: Math.max(1, Math.round(w)),
        h: Math.max(1, Math.round(h)),
      }
      dispatch({ type: "add-slice", slice })
      setTimeout(() => commit("Create Slice", []), 0)
      return
    }
    // Create a vector shape layer
    const cv = makeCanvas(activeDoc.width, activeDoc.height)
    const id = `${tool === "frame" ? "frame" : tool === "artboard" ? "artboard" : "shape"}_${Math.random().toString(36).slice(2, 9)}`
    if (tool === "frame") {
      const frame = { shape: getFrameRuntimeOptions().shape, x, y, w, h }
      drawFramePlaceholder(cv.getContext("2d")!, frame)
      const layer: Layer = {
        id,
        name: "Frame",
        kind: "frame",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        canvas: cv,
        frame,
      }
      dispatch({ type: "add-layer", layer })
      setTimeout(() => commit("Frame", [id]), 0)
      return
    }
    if (tool === "artboard") {
      drawArtboardPreview(cv.getContext("2d")!, x, y, w, h, background)
      const layer: Layer = {
        id,
        name: "Artboard",
        kind: "artboard",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        canvas: cv,
        artboard: { x, y, w, h, background },
      }
      dispatch({ type: "add-layer", layer })
      setTimeout(() => commit("Artboard", [id]), 0)
      return
    }
    if (tool === "shape-line") {
      const ctx = cv.getContext("2d")!
      ctx.strokeStyle = foreground
      ctx.lineWidth = Math.max(1, getShapeRuntimeOptions().strokeWidth || brush.size / 4)
      ctx.beginPath()
      ctx.moveTo(startPt.x, startPt.y)
      ctx.lineTo(endPt.x, endPt.y)
      ctx.stroke()
      const strokeWidth = Math.max(1, getShapeRuntimeOptions().strokeWidth || brush.size / 4)
      const layer: Layer = {
        id,
        name: "Line",
        kind: "shape",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        canvas: cv,
        shape: { type: "rect", x: startPt.x, y: startPt.y, w: endPt.x - startPt.x, h: endPt.y - startPt.y, fill: foreground, stroke: { color: foreground, width: strokeWidth } },
      }
      dispatch({ type: "add-layer", layer })
    } else {
      const shape = shapePropsForTool(tool, x, y, w, h, startPt, endPt, foreground, background)
      rasterizeShape(cv, shape)
      const name =
        tool === "custom-shape"
          ? "Custom Shape"
          : tool === "shape-ellipse"
            ? "Ellipse"
            : tool === "shape-rounded-rect"
              ? "Rounded Rectangle"
              : tool === "shape-polygon"
                ? shape.type === "star" ? "Star" : "Polygon"
                : tool === "shape-star"
                  ? "Star"
                  : tool === "shape-triangle"
                    ? "Triangle"
                    : "Rectangle"
      const layer: Layer = {
        id,
        name,
        kind: "shape",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        canvas: cv,
        shape,
      }
      dispatch({ type: "add-layer", layer })
    }
    setTimeout(() => commit("Shape", [id]), 0)
    return
  }

  if (drag.type === "gradient") {
    drawingRef.current = { type: null }
    docOps.commitGradient()
    paint.syncActiveLayerHighBitFromCanvas()
    commit("Gradient", activeLayer ? [activeLayer.id] : undefined)
    return
  }

  if (drag.type === "transform") {
    drawingRef.current = { type: null }
    xform.drawTransformHandles()
    return
  }

  if (drag.type === "pan") {
    drawingRef.current = { type: null }
    return
  }
}

export function handleCanvasPointerCancel(ctx: CanvasPointerContext, e: React.PointerEvent<HTMLDivElement>) {
  const {
    requestRender,
    overlayRef,
    drawingRef,
    removeRef,
    brushResizeRef,
    paint,
    xform,
  } = ctx
  // pointercancel fires when the browser takes over the gesture
  // (touch scroll/zoom interception, pen handoff, window loss). Its
  // coordinates are unreliable, so it must not be routed through
  // onPointerUp (the slice/marquee branches read event positions).
  // Instead commit an active stroke — commitActiveStroke never reads
  // the event — and abort every other drag without committing.
  try {
    const target = e.target as Element | null
    if (target?.hasPointerCapture?.(e.pointerId)) {
      target.releasePointerCapture(e.pointerId)
    }
  } catch {
    /* no-op: some browsers throw if the capture was already released */
  }
  dispatchPhotoshopEvent("ps-tool-info", { kind: "clear" })
  const drag = drawingRef.current
  if (drag.type === null) return
  if (drag.type === "stroke") {
    paint.commitActiveStroke()
    return
  }
  if (drag.type === "transform") {
    // Same as onPointerUp: the drag's effect is already in
    // xform.transformRef; ending the drag keeps the session alive.
    drawingRef.current = { type: null }
    xform.drawTransformHandles()
    return
  }
  drawingRef.current = { type: null }
  brushResizeRef.current = null
  removeRef.current = null
  paint.resetStrokeState()
  const ov = overlayRef.current
  if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
  requestRender()
}

export function handleCanvasDoubleClick(ctx: CanvasPointerContext, e: React.MouseEvent) {
  const {
    activeDoc,
    tool,
    dispatch,
    requestRender,
    editSmartObject,
    overlayRef,
    drawingRef,
    vectors,
    xform,
    selections,
    beginTextEdit,
    getCanvasPoint,
  } = ctx
  if (!activeDoc) return
  const pt = getCanvasPoint(e.clientX, e.clientY)
  // commit pen path
  if ((tool === "pen" || tool === "curvature-pen") && vectors.pathDraftRef.current && vectors.pathDraftRef.current.points.length >= 2) {
    vectors.commitPath(false)
    return
  }
  // commit polygon lasso
  const drag = drawingRef.current
  if (drag.type === "polylasso" && drag.points && drag.points.length > 2 && activeDoc) {
    selections.finalizePolyLasso(drag.points)
    drawingRef.current = { type: null }
    return
  }
  // Edit text on double click. Text is matched by its box rather than by
  // glyph coverage so clicking the gap between letters still enters editing.
  const textHit = pickTextLayerAt(activeDoc, pt)
  if (textHit) {
    if (xform.transformRef.current) {
      xform.transformRef.current = null
      const ov = overlayRef.current
      if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
    }
    drawingRef.current = { type: null }
    dispatch({ type: "set-active-layer", id: textHit.id })
    beginTextEdit(textHit, false)
    requestRender()
    return
  }
  const hit = autoPickLayer(activeDoc, pt)
  if (hit && (hit.smartObject || hit.kind === "smart-object")) {
    editSmartObject(hit)
    return
  }
  // begin Free Transform on doc by double-click on layer when move tool
  if (tool === "move" && layerAllowsMoving(hit)) {
    xform.beginTransform(hit)
  }
}
