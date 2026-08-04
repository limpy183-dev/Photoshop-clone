/**
 * Vector layer editing: hit-testing a click against a layer's anchors, handles
 * and transform grips, and applying a direct-selection drag to the layer.
 *
 * These operate on the live layer objects the canvas view mutates in place —
 * the reducer sees the result when the view commits, same as before.
 */
import { getPathRuntimeOptions } from "@/editor/canvas/view-runtime"
import { alphaBounds } from "@/editor/canvas/selection-helpers"
import {
  drawArtboardPreview,
  drawFramePlaceholder,
} from "@/editor/canvas/preview-drawing"
import {
  resizePlainRect,
  resizeShapeRect,
  shapeHandles,
  shapeRect,
  type DirectShapeHandleId,
} from "@/editor/canvas/shape-helpers"
import { constrainTo45Degrees } from "@/editor/path-modifier-keys"
import { hexToRgba } from "@/editor/color/utils"
import { rasterizeShape, rasterizeText, strokePath } from "@/editor/tool/helpers"
import {
  getRoundedRectCornerRadiusHandles,
  hitTestPathControls,
  movePathAnchor,
  movePathHandle,
  moveSelectedPathAnchors,
  shapeToEditablePath,
  updateRoundedRectCornerRadius,
  type PathAnchorRef,
  type RoundedRectCorner,
} from "@/editor/vector-path-operations"
import type { Layer, PathProps, PsDocument } from "@/editor/types"

interface Point {
  x: number
  y: number
}

/** The subset of the canvas drag state a direct-selection drag reads. */
export interface DirectSelectionDrag {
  last?: Point
  directSubpathIndex?: number
  directPointIndex?: number
  directPathHandle?: "in" | "out"
  directShapeHandle?: DirectShapeHandleId
  directSelectedAnchors?: PathAnchorRef[]
}

/** Type layers carry their path on `text.textPath`; normalise it to a PathProps. */
export function textLayerPath(layer: Layer | null | undefined): PathProps | null {
  const points = layer?.text?.textPath
  if (!points?.length) return null
  return {
    points: points.map((point) => ({ x: point.x, y: point.y })),
    closed: layer?.text?.textPathClosed === true,
  }
}

export function isVectorEditableLayer(layer: Layer | null | undefined) {
  return Boolean(layer && layer.kind !== "group" && (layer.path || textLayerPath(layer) || layer.shape || layer.frame || layer.artboard || layer.kind === "shape" || layer.kind === "frame" || layer.kind === "artboard"))
}

export function vectorLayerBounds(layer: Layer) {
  if (layer.shape) return shapeRect(layer.shape)
  if (layer.frame) return { x: layer.frame.x, y: layer.frame.y, w: layer.frame.w, h: layer.frame.h }
  if (layer.artboard) return { x: layer.artboard.x, y: layer.artboard.y, w: layer.artboard.w, h: layer.artboard.h }
  const editableTextPath = textLayerPath(layer)
  const layerPath = layer.path ?? editableTextPath
  if (layerPath?.points.length) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const point of layerPath.points) {
      minX = Math.min(minX, point.x, point.cp1?.x ?? point.x, point.cp2?.x ?? point.x)
      minY = Math.min(minY, point.y, point.cp1?.y ?? point.y, point.cp2?.y ?? point.y)
      maxX = Math.max(maxX, point.x, point.cp1?.x ?? point.x, point.cp2?.x ?? point.x)
      maxY = Math.max(maxY, point.y, point.cp1?.y ?? point.y, point.cp2?.y ?? point.y)
    }
    return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null
  }
  return alphaBounds(layer.canvas)
}

/** Topmost visible vector layer whose bounds (padded) contain the point. */
export function pickVectorLayer(doc: PsDocument, pt: Point) {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const layer = doc.layers[i]
    if (!layer.visible || !isVectorEditableLayer(layer)) continue
    const bounds = vectorLayerBounds(layer)
    if (!bounds) continue
    const pad = 6
    if (pt.x < bounds.x - pad || pt.x > bounds.x + bounds.w + pad || pt.y < bounds.y - pad || pt.y > bounds.y + bounds.h + pad) continue
    const ctx = layer.canvas.getContext("2d")
    if (!ctx) return layer
    const x = Math.max(0, Math.min(layer.canvas.width - 1, Math.floor(pt.x)))
    const y = Math.max(0, Math.min(layer.canvas.height - 1, Math.floor(pt.y)))
    const alpha = ctx.getImageData(x, y, 1, 1).data[3]
    if (alpha > 0 || layer.path || textLayerPath(layer) || layer.shape || layer.frame || layer.artboard) return layer
  }
  return null
}

export function editablePathForDirectSelection(layer: Layer): PathProps | null {
  if (layer.path) return layer.path
  if (layer.shape) return layer.shape.computedPath ?? shapeToEditablePath(layer.shape)
  return textLayerPath(layer)
}

/**
 * What a direct-selection click landed on, in priority order: path anchor,
 * bezier handle, path segment, rounded-rect radius grip, transform handle.
 * Falls back to "center" so a click inside the layer starts a move.
 */
export function directSelectionTarget(layer: Layer, pt: Point) {
  const editablePath = editablePathForDirectSelection(layer)
  if (editablePath?.points.length) {
    const hit = hitTestPathControls(editablePath, pt, {
      maxAnchorDistance: 12,
      maxHandleDistance: 14,
      maxSegmentDistance: 7,
      segmentSamples: 32,
    })
    if (hit?.kind === "anchor") {
      return { subpathIndex: hit.subpathIndex, pointIndex: hit.pointIndex, pathHandle: undefined, shapeHandle: undefined }
    }
    if (hit?.kind === "handle") {
      return { subpathIndex: hit.subpathIndex, pointIndex: hit.pointIndex, pathHandle: hit.handle, shapeHandle: undefined }
    }
    if (hit?.kind === "segment") {
      return { subpathIndex: hit.subpathIndex, segmentIndex: hit.segmentIndex, pointIndex: undefined, pathHandle: undefined, shapeHandle: undefined }
    }
  }
  if (layer.shape?.type === "rect") {
    for (const handle of getRoundedRectCornerRadiusHandles(layer.shape)) {
      if (Math.hypot(handle.x - pt.x, handle.y - pt.y) <= 14) {
        return { subpathIndex: undefined, pointIndex: undefined, pathHandle: undefined, shapeHandle: `radius-${handle.corner}` as DirectShapeHandleId }
      }
    }
  }
  const bounds = vectorLayerBounds(layer)
  if (!bounds) return null
  const handles = shapeHandles(bounds)
  let best: { shapeHandle: DirectShapeHandleId; distance: number } | null = null
  for (const handle of handles) {
    const distance = Math.hypot(handle.x - pt.x, handle.y - pt.y)
    if (distance <= 16 && (!best || distance < best.distance)) best = { shapeHandle: handle.id, distance }
  }
  return best
    ? { subpathIndex: undefined, pointIndex: undefined, pathHandle: undefined, shapeHandle: best.shapeHandle }
    : { subpathIndex: undefined, pointIndex: undefined, pathHandle: undefined, shapeHandle: "center" as const }
}

export function pathForDirectEdit(path: PathProps, subpathIndex: number | undefined) {
  if (subpathIndex === undefined || subpathIndex < 0) return path
  return path.subpaths?.[subpathIndex] ?? path
}

export function replaceDirectEditPath(path: PathProps, subpathIndex: number | undefined, edited: PathProps): PathProps {
  if (subpathIndex === undefined || subpathIndex < 0) return edited
  const subpaths = path.subpaths?.slice() ?? []
  subpaths[subpathIndex] = edited
  return { ...path, subpaths }
}

function constrainedDelta(dx: number, dy: number, constrain: boolean) {
  if (!constrain) return { dx, dy }
  return constrainTo45Degrees(dx, dy)
}

/** Repaint a vector layer's raster surface from its shape/text/path model. */
export function rerenderVectorLayer(layer: Layer, foreground: string, strokeWidth: number) {
  const ctx = layer.canvas.getContext("2d")
  if (!ctx) return
  ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
  if (layer.shape) rasterizeShape(layer.canvas, layer.shape)
  else if (layer.text) rasterizeText(layer.canvas, layer.text)
  else if (layer.frame) drawFramePlaceholder(ctx, layer.frame)
  else if (layer.artboard) drawArtboardPreview(ctx, layer.artboard.x, layer.artboard.y, layer.artboard.w, layer.artboard.h, layer.artboard.background)
  else if (layer.path) strokePath(ctx, layer.path, foreground, strokeWidth, layer.path.closed, hexToRgba(foreground, 0.3))
}

/**
 * Shift a vector layer's geometry by (dx, dy).
 *
 * The path-selection tool drags the layer's *pixels*, which looks right until
 * anything re-rasterizes from the geometry (an options change, an undo, a
 * direct-selection edit) and the shape jumps back to where it was authored.
 * Moving the geometry to match keeps the two in step. Returns false when the
 * layer carries nothing vector-shaped to move.
 */
export function translateVectorLayerGeometry(layer: Layer, dx: number, dy: number): boolean {
  if (!dx && !dy) return false
  let moved = false
  const shiftPath = (path: PathProps): PathProps => ({
    ...path,
    points: path.points.map((point) => ({
      ...point,
      x: point.x + dx,
      y: point.y + dy,
      cp1: point.cp1 ? { x: point.cp1.x + dx, y: point.cp1.y + dy } : undefined,
      cp2: point.cp2 ? { x: point.cp2.x + dx, y: point.cp2.y + dy } : undefined,
    })),
    subpaths: path.subpaths?.map(shiftPath),
  })

  if (layer.path) {
    layer.path = shiftPath(layer.path)
    moved = true
  }
  if (layer.shape) {
    layer.shape = {
      ...layer.shape,
      x: layer.shape.x + dx,
      y: layer.shape.y + dy,
      computedPath: layer.shape.computedPath ? shiftPath(layer.shape.computedPath) : undefined,
      components: layer.shape.components?.map((component) => ({
        ...component,
        shape: { ...component.shape, x: component.shape.x + dx, y: component.shape.y + dy },
      })),
    }
    moved = true
  }
  if (layer.text) {
    layer.text = { ...layer.text, x: layer.text.x + dx, y: layer.text.y + dy }
    moved = true
  }
  if (layer.frame) {
    layer.frame = { ...layer.frame, x: layer.frame.x + dx, y: layer.frame.y + dy }
    moved = true
  }
  if (layer.artboard) {
    layer.artboard = { ...layer.artboard, x: layer.artboard.x + dx, y: layer.artboard.y + dy }
    moved = true
  }
  return moved
}

export interface DirectSelectionDragOptions {
  /** Foreground + stroke width for the path re-render after each edit. */
  foreground: string
  strokeWidth: number
  mirrorPathHandles?: boolean
  constrainMove?: boolean
}

/**
 * Apply one pointer-move of a direct-selection drag. Mutates `layer` in place
 * and repaints it; returns nothing because the caller owns the render request.
 */
export function updateDirectSelectionDrag(
  layer: Layer,
  pt: Point,
  drag: DirectSelectionDrag,
  options: DirectSelectionDragOptions,
) {
  const { foreground, strokeWidth, mirrorPathHandles = true, constrainMove = false } = options
  const rerender = () => rerenderVectorLayer(layer, foreground, strokeWidth)
  if (layer.path && drag.directSelectedAnchors?.length && drag.last && drag.directPointIndex === undefined && !drag.directPathHandle) {
    layer.path = moveSelectedPathAnchors(layer.path, drag.directSelectedAnchors, constrainedDelta(pt.x - drag.last.x, pt.y - drag.last.y, constrainMove))
    rerender()
    return
  }
  if (layer.path && drag.directPointIndex !== undefined && drag.directPointIndex >= 0) {
    const editablePath = pathForDirectEdit(layer.path, drag.directSubpathIndex)
    if (drag.directPathHandle) {
      const handleMode = mirrorPathHandles ? getPathRuntimeOptions().handleMode : "broken"
      layer.path = replaceDirectEditPath(
        layer.path,
        drag.directSubpathIndex,
        movePathHandle(editablePath, drag.directPointIndex, drag.directPathHandle, pt, { mode: handleMode }),
      )
      rerender()
      return
    }
    if (drag.directSelectedAnchors?.length && drag.last) {
      const delta = constrainedDelta(pt.x - drag.last.x, pt.y - drag.last.y, constrainMove)
      layer.path = moveSelectedPathAnchors(layer.path, drag.directSelectedAnchors, delta)
      rerender()
      return
    }
    layer.path = replaceDirectEditPath(layer.path, drag.directSubpathIndex, movePathAnchor(editablePath, drag.directPointIndex, pt))
    rerender()
    return
  }
  if (layer.shape && drag.directSelectedAnchors?.length && drag.last && drag.directPointIndex === undefined && !drag.directPathHandle) {
    const basePath = layer.shape.computedPath ?? shapeToEditablePath(layer.shape)
    layer.shape = {
      ...layer.shape,
      computedPath: moveSelectedPathAnchors(basePath, drag.directSelectedAnchors, constrainedDelta(pt.x - drag.last.x, pt.y - drag.last.y, constrainMove)),
    }
    rerender()
    return
  }
  if (layer.shape && drag.directPointIndex !== undefined && drag.directPointIndex >= 0) {
    const basePath = layer.shape.computedPath ?? shapeToEditablePath(layer.shape)
    const editablePath = pathForDirectEdit(basePath, drag.directSubpathIndex)
    const nextPath = drag.directPathHandle
      ? movePathHandle(editablePath, drag.directPointIndex, drag.directPathHandle, pt, {
          mode: mirrorPathHandles ? getPathRuntimeOptions().handleMode : "broken",
        })
      : drag.directSelectedAnchors?.length && drag.last
        ? moveSelectedPathAnchors(basePath, drag.directSelectedAnchors, constrainedDelta(pt.x - drag.last.x, pt.y - drag.last.y, constrainMove))
        : movePathAnchor(editablePath, drag.directPointIndex, pt)
    layer.shape = {
      ...layer.shape,
      computedPath: drag.directSelectedAnchors?.length && !drag.directPathHandle
        ? nextPath
        : replaceDirectEditPath(basePath, drag.directSubpathIndex, nextPath),
    }
    rerender()
    return
  }
  if (layer.text?.textPath && drag.directPointIndex !== undefined && drag.directPointIndex >= 0) {
    const points = layer.text.textPath.map((point, index) =>
      index === drag.directPointIndex ? { x: pt.x, y: pt.y } : point,
    )
    layer.text = { ...layer.text, textPath: points }
    rerender()
    return
  }
  if (!drag.directShapeHandle || !drag.last) return
  const dx = pt.x - drag.last.x
  const dy = pt.y - drag.last.y
  if (layer.shape) {
    if (drag.directShapeHandle.startsWith("radius-") && layer.shape.type === "rect") {
      layer.shape = updateRoundedRectCornerRadius(layer.shape, drag.directShapeHandle.slice("radius-".length) as RoundedRectCorner, pt)
    } else {
      layer.shape = resizeShapeRect(layer.shape, drag.directShapeHandle as Exclude<DirectShapeHandleId, `radius-${RoundedRectCorner}`>, pt, dx, dy)
    }
  } else if (layer.frame) {
    if (drag.directShapeHandle.startsWith("radius-")) return
    const next = resizePlainRect(layer.frame, drag.directShapeHandle as Exclude<DirectShapeHandleId, `radius-${RoundedRectCorner}`>, pt, dx, dy)
    layer.frame = { ...layer.frame, ...next }
  } else if (layer.artboard) {
    if (drag.directShapeHandle.startsWith("radius-")) return
    const next = resizePlainRect(layer.artboard, drag.directShapeHandle as Exclude<DirectShapeHandleId, `radius-${RoundedRectCorner}`>, pt, dx, dy)
    layer.artboard = { ...layer.artboard, ...next }
  }
  rerender()
}
