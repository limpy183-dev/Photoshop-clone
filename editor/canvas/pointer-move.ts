/**
 * Pointer-move on the canvas: advance whatever gesture pointer-down opened.
 *
 * Every branch narrows on `drawingRef.current.type`, updates that state, and
 * repaints only the overlay — never the document — except for the tools that
 * are inherently destructive while dragging (stroke, move, transform).
 */

import * as React from "react"
import { constrainPointTo45 } from "@/editor/path-modifier-keys"
import { dispatchPhotoshopEvent } from "@/editor/events"
import {
  getFrameRuntimeOptions,
  getShapeRuntimeOptions,
  layerAllowsDrawing,
  layerAllowsMoving,
} from "@/editor/canvas/view-runtime"
import {
  shapePropsForTool,
  snapViewRotation,
} from "@/editor/canvas/shape-helpers"
import { smartSnapLayerDelta } from "@/components/photoshop/canvas/smart-guides"
import {
  drawArtboardPreview,
  drawFramePlaceholder,
  drawSlicePreview,
} from "@/editor/canvas/preview-drawing"
import {
  rasterizeShape,
  makeCanvas,
} from "@/editor/tool/helpers"
import type { CanvasPointerContext } from "@/editor/canvas/pointer-context"

export function handleCanvasPointerMove(ctx: CanvasPointerContext, e: React.PointerEvent<HTMLDivElement>) {
  const {
    activeDoc,
    tool,
    foreground,
    background,
    brush,
    dispatch,
    requestRender,
    overlayRef,
    cursorRef,
    drawingRef,
    removeRef,
    brushResizeRef,
    mouseMoveCoalescerRef,
    paint,
    vectors,
    xform,
    selections,
    docOps,
    previews,
    panRef,
    applyStageTransform,
    handleBlurGalleryPointerMove,
    handleLightingEffectsPointerMove,
    getCanvasPoint,
    sampleEyedropperAt,
  } = ctx
  const pt = getCanvasPoint(e.clientX, e.clientY)

  // brush/cursor follow
  const cur = cursorRef.current
  if (cur) {
    cur.style.left = `${e.clientX}px`
    cur.style.top = `${e.clientY}px`
    if (cur.firstElementChild) cur.style.opacity = "1"
  }

  // status bar
  const mouseDetail = {
    x: pt.x,
    y: pt.y,
    inside: pt.x >= 0 && pt.y >= 0 && pt.x <= (activeDoc?.width ?? 0) && pt.y <= (activeDoc?.height ?? 0),
  }
  const coalescer = mouseMoveCoalescerRef.current
  if (coalescer) coalescer.push(mouseDetail)
  else dispatchPhotoshopEvent("ps-mousemove", mouseDetail)

  if (handleBlurGalleryPointerMove(pt)) {
    e.preventDefault()
    return
  }

  if (handleLightingEffectsPointerMove(pt)) {
    e.preventDefault()
    return
  }

  const drag = drawingRef.current
  if (drag.type === null) {
    // Pen rubber-band: with a path in progress, trail the pending segment
    // from the last anchor to the cursor between clicks.
    if ((tool === "pen" || tool === "curvature-pen") && vectors.pathDraftRef.current) {
      vectors.drawPathPreview(pt)
    }
    return
  }

  if (drag.type === "pan" && drag.panStart) {
    panRef.current = { x: e.clientX - drag.panStart.x, y: e.clientY - drag.panStart.y }
    applyStageTransform()
    return
  }

  if (drag.type === "text-box" && drag.start) {
    previews.drawTextBoxPreview(drag.start, pt)
    drag.last = pt
    return
  }

  if (drag.type === "eyedropper") {
    sampleEyedropperAt(pt, drag.sampleToBackground ?? false)
    drag.last = pt
    return
  }

  if (drag.type === "pen-handle" && drag.start && vectors.pathDraftRef.current) {
    const draft = vectors.pathDraftRef.current
    const anchor = draft.points[draft.points.length - 1]
    if (anchor) {
      const end = e.shiftKey ? constrainPointTo45(drag.start, pt) : pt
      // Symmetric handles: the outgoing one follows the cursor, the incoming
      // one mirrors it through the anchor, giving a smooth point.
      anchor.cp2 = { x: end.x, y: end.y }
      anchor.cp1 = { x: anchor.x - (end.x - anchor.x), y: anchor.y - (end.y - anchor.y) }
      drag.last = end
      vectors.drawPathPreview()
    }
    return
  }

  if (drag.type === "rotate-view" && activeDoc && drag.rotateStartAngle !== undefined && drag.rotateStartValue !== undefined) {
    const center = { x: activeDoc.width / 2, y: activeDoc.height / 2 }
    const angle = Math.atan2(pt.y - center.y, pt.x - center.x)
    const delta = ((angle - drag.rotateStartAngle) * 180) / Math.PI
    const next = snapViewRotation(drag.rotateStartValue + delta, e.shiftKey)
    dispatch({ type: "set-rotation", rotation: next as 0 | 90 | 180 | 270 })
    drag.last = pt
    return
  }

  if (drag.type === "stroke") {
    const last = drag.last ?? pt
    // Smoothing: 0 -> no smoothing (k=1), 100 -> heavy smoothing (~0.09).
    // Clamp to [0,1] so a stale prefs value > 110 cannot produce a
    // negative `k`, which would extrapolate past the cursor and make
    // the smoothed point oscillate violently.
    const k = Math.max(0, Math.min(1, 1 - brush.smoothing / 110))
    const sx = (drag.smooth?.x ?? pt.x) + (pt.x - (drag.smooth?.x ?? pt.x)) * k
    const sy = (drag.smooth?.y ?? pt.y) + (pt.y - (drag.smooth?.y ?? pt.y)) * k
    const cur = { x: sx, y: sy }
    paint.drawSegment(last, cur, paint.pointerBrushInput(e, cur))
    drag.last = cur
    drag.smooth = cur
    return
  }

  if (drag.type === "marquee" && drag.start) {
    previews.drawMarqueePreview(drag.start, pt)
    drag.last = pt
    dispatchPhotoshopEvent("ps-tool-info", {
      kind: "marquee",
      width: Math.abs(pt.x - drag.start.x),
      height: Math.abs(pt.y - drag.start.y),
      x: Math.min(drag.start.x, pt.x),
      y: Math.min(drag.start.y, pt.y),
    })
    return
  }

  if (drag.type === "object-select" && drag.start) {
    previews.drawMarqueePreview(drag.start, pt)
    drag.last = pt
    dispatchPhotoshopEvent("ps-tool-info", {
      kind: "marquee",
      width: Math.abs(pt.x - drag.start.x),
      height: Math.abs(pt.y - drag.start.y),
      x: Math.min(drag.start.x, pt.x),
      y: Math.min(drag.start.y, pt.y),
    })
    return
  }

  if (drag.type === "refine-edge" && drag.points) {
    drag.points.push(pt)
    drag.last = pt
    previews.drawBrushPreview(pt, brush.size / 2)
    return
  }

  if (drag.type === "remove" && drag.points) {
    drag.points.push(pt)
    removeRef.current?.points.push(pt)
    drag.last = pt
    previews.drawBrushPreview(pt, brush.size / 2)
    return
  }

  if (drag.type === "crop" && drag.start) {
    previews.drawMarqueePreview(drag.start, pt)
    drag.last = pt
    dispatchPhotoshopEvent("ps-tool-info", {
      kind: "marquee",
      width: Math.abs(pt.x - drag.start.x),
      height: Math.abs(pt.y - drag.start.y),
      x: Math.min(drag.start.x, pt.x),
      y: Math.min(drag.start.y, pt.y),
    })
    return
  }

  if (drag.type === "ruler" && drag.start) {
    previews.drawRulerPreview(drag.start, pt)
    drag.last = pt
    dispatch({ type: "set-measurement", m: { x1: drag.start.x, y1: drag.start.y, x2: pt.x, y2: pt.y } })
    const dx = pt.x - drag.start.x
    const dy = pt.y - drag.start.y
    dispatchPhotoshopEvent("ps-tool-info", {
      kind: "line",
      length: Math.hypot(dx, dy),
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      dx,
      dy,
    })
    return
  }

  if (drag.type === "lasso" && drag.points) {
    drag.points.push(pt)
    drag.last = pt
    previews.drawLassoPreview(drag.points)
    return
  }

  if (drag.type === "freeform-path" && drag.points) {
    drag.points.push(pt)
    drag.last = pt
    previews.drawLassoPreview(drag.points)
    return
  }

  if (drag.type === "patch-lasso" && drag.points) {
    drag.points.push(pt)
    drag.last = pt
    previews.drawLassoPreview(drag.points)
    return
  }

  if (drag.type === "patch-drag" && drag.start) {
    drag.last = pt
    previews.drawPatchPreview({ x: pt.x - drag.start.x, y: pt.y - drag.start.y })
    return
  }

  if (drag.type === "polylasso" && drag.points) {
    const hover = tool === "lasso-magnetic" ? selections.snapMagneticPoint(pt) : pt
    if (tool === "lasso-magnetic" && drag.points.length > 0) {
      const lastAnchor = drag.points[drag.points.length - 1]
      if (Math.hypot(hover.x - lastAnchor.x, hover.y - lastAnchor.y) >= selections.magneticAnchorInterval()) {
        drag.points = [...drag.points, hover]
        drag.last = hover
        previews.drawLassoPreview(drag.points)
        return
      }
    }
    drag.last = hover
    previews.drawLassoPreview(drag.points, hover)
    return
  }

  if (drag.type === "shape" && drag.start) {
    const ov = overlayRef.current
    if (!ov || !activeDoc) return
    const ctx = ov.getContext("2d")!
    ctx.clearRect(0, 0, ov.width, ov.height)
    const x = Math.min(drag.start.x, pt.x)
    const y = Math.min(drag.start.y, pt.y)
    const w = Math.abs(pt.x - drag.start.x)
    const h = Math.abs(pt.y - drag.start.y)
    ctx.save()
    if (tool === "slice") {
      drawSlicePreview(ctx, x, y, w, h)
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
      }
    } else if (tool === "frame") {
      drawFramePlaceholder(ctx, { shape: getFrameRuntimeOptions().shape, x, y, w, h })
    } else if (tool === "artboard") {
      drawArtboardPreview(ctx, x, y, w, h, background)
    } else if (tool === "shape-line") {
      ctx.strokeStyle = foreground
      ctx.lineWidth = Math.max(1, getShapeRuntimeOptions().strokeWidth || brush.size / 4)
      ctx.beginPath()
      ctx.moveTo(drag.start.x, drag.start.y)
      ctx.lineTo(pt.x, pt.y)
      ctx.stroke()
      const dx = pt.x - drag.start.x
      const dy = pt.y - drag.start.y
      dispatchPhotoshopEvent("ps-tool-info", {
        kind: "line",
        length: Math.hypot(dx, dy),
        angle: (Math.atan2(dy, dx) * 180) / Math.PI,
        dx,
        dy,
      })
    } else {
      // Every shape tool previews through the same props builder the commit
      // uses, so corner radii, stroke and rotation can't differ between the
      // drag and what lands on release.
      rasterizeShape(ov, shapePropsForTool(tool, x, y, w, h, drag.start, pt, foreground, background))
    }
    ctx.restore()
    drag.last = pt
    return
  }

  if (drag.type === "path-marquee" && drag.start) {
    previews.drawMarqueePreview(drag.start, pt)
    drag.last = pt
    return
  }

  if (drag.type === "path-direct" && drag.directLayerId && activeDoc) {
    const layer = activeDoc.layers.find((candidate) => candidate.id === drag.directLayerId)
    if (!layerAllowsDrawing(layer)) return
    vectors.updateDirectSelectionDrag(layer, pt, drag, !e.altKey, e.shiftKey)
    requestRender()
    vectors.drawPathSelectionPreview(layer)
    drag.last = pt
    return
  }

  if (drag.type === "gradient" && drag.start) {
    // Shift constrains the ramp axis to 45° steps, as in Photoshop.
    const end = e.shiftKey ? constrainPointTo45(drag.start, pt) : pt
    docOps.drawGradientPreview(drag.start, end)
    drag.last = end
    return
  }

  if (drag.type === "brush-resize" && brushResizeRef.current) {
    const deltaX = e.clientX - brushResizeRef.current.startClientX
    const newSize = Math.max(1, Math.min(2000, Math.round(brushResizeRef.current.startSize + deltaX)))
    dispatch({ type: "set-brush", brush: { size: newSize } })
    return
  }

  if (drag.type === "move" && drag.moveLayerId && drag.moveStart && activeDoc) {
    const layer = activeDoc.layers.find((l) => l.id === drag.moveLayerId)
    if (!layer) return
    const rawDx = pt.x - drag.moveStart.x
    const rawDy = pt.y - drag.moveStart.y
    const constrainedDx = e.shiftKey ? (Math.abs(rawDx) > Math.abs(rawDy) ? rawDx : 0) : rawDx
    const constrainedDy = e.shiftKey ? (Math.abs(rawDy) >= Math.abs(rawDx) ? rawDy : 0) : rawDy
    const snapshot: HTMLCanvasElement | undefined = layer.canvas.__moveSnapshot
    if (!snapshot) return
    const snapped = smartSnapLayerDelta(activeDoc, layer, snapshot, constrainedDx, constrainedDy)
    const dx = snapped.dx
    const dy = snapped.dy
    drag.moveDelta = { x: dx, y: dy }
    const ctx = layer.canvas.getContext("2d")!
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
    const float = layer.canvas.__moveFloat
    if (float) {
      // Floating selection: the un-selected remainder stays put, the lifted
      // pixels ride the cursor from wherever an earlier drag parked them.
      const origin = drag.moveOrigin ?? { x: 0, y: 0 }
      ctx.drawImage(snapshot, 0, 0)
      ctx.drawImage(float, origin.x + dx, origin.y + dy)
    } else {
      ctx.drawImage(snapshot, dx, dy)
    }
    // also move linked layers
    if (layer.linkGroupId) {
      for (const other of activeDoc.layers) {
        if (other.id === layer.id) continue
        if (other.linkGroupId === layer.linkGroupId && layerAllowsMoving(other)) {
          const snap2: HTMLCanvasElement | undefined = other.canvas.__moveSnapshot
          if (!snap2) {
            const tmp = makeCanvas(activeDoc.width, activeDoc.height)
            tmp.getContext("2d")!.drawImage(other.canvas, 0, 0)
              ; other.canvas.__moveSnapshot = tmp
            continue
          }
          const oc = other.canvas.getContext("2d")!
          oc.clearRect(0, 0, other.canvas.width, other.canvas.height)
          oc.drawImage(snap2, dx, dy)
        }
      }
    }
    requestRender()
    return
  }

  if (drag.type === "transform" && drag.handle && xform.transformRef.current) {
    xform.handleTransformDrag(pt, drag.handle, e.shiftKey, e.altKey)
    xform.drawTransformHandles()
    xform.renderTransformPreview()
    return
  }
}
