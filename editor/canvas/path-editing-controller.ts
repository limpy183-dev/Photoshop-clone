/**
 * Vector editing on the canvas: the pen draft, the direct-selection anchor set,
 * and the anchor-level edits the pen sub-tools perform.
 *
 * The selected-anchor set is ref-backed with a shadow state value: drags read
 * the ref every pointer-move without re-rendering, while the state write keeps
 * React aware that a selection exists. Hit-testing and the geometry maths live
 * in `vector-editing.ts` and `vector-path-operations.ts`; this only sequences
 * them and publishes the results.
 */

import * as React from "react"

import type { ChangedLayerIds } from "@/editor/history-geometry"
import type { RenderChange } from "@/editor/render-bus"
import { hexToRgba } from "@/editor/color/utils"
import { makeCanvas } from "@/editor/canvas/utils"
import { strokePath } from "@/editor/tool/helpers"
import {
  addAnchorPointToPath,
  convertAnchorPoint,
  deleteNearestAnchorPoint,
  deleteSelectedPathAnchors,
  duplicatePathSubpath,
  fitFreeformPath,
  hitTestPathControls,
  nearestAnchorPoint,
  selectAllPathAnchors,
  selectPathAnchorsInRect,
  selectPathSubpathAnchors,
  shapeToEditablePath,
  togglePathAnchorSelection,
  type PathAnchorRef,
} from "@/editor/vector-path-operations"
import {
  directSelectionTarget,
  editablePathForDirectSelection,
  isVectorEditableLayer,
  pathForDirectEdit,
  pickVectorLayer,
  rerenderVectorLayer as rerenderVectorLayerGeometry,
  replaceDirectEditPath,
  updateDirectSelectionDrag as applyDirectSelectionDrag,
  vectorLayerBounds,
} from "@/editor/canvas/vector-editing"
import {
  drawMarqueePreview as drawMarqueePreviewOverlay,
  drawPathPreview as drawPathPreviewOverlay,
  drawPathSelectionPreview as drawPathSelectionPreviewOverlay,
} from "@/editor/canvas/overlay-previews"
import type { CanvasDragRef } from "@/editor/canvas/drag-state"
import { layerAllowsDrawing } from "@/editor/canvas/view-runtime"
import { makeCurvaturePath } from "@/editor/canvas/view-helpers"
import type { Action } from "@/editor/reducer"
import type { BrushSettings, Layer, PathPoint, PsDocument, ToolId } from "@/editor/types"

export interface PathDraft {
  points: PathPoint[]
  closed: boolean
  curvature?: boolean
}

export interface PathEditingOptions {
  activeDoc: PsDocument | null | undefined
  activeLayer: Layer | null | undefined
  tool: ToolId
  brush: BrushSettings
  foreground: string
  overlayRef: React.RefObject<HTMLCanvasElement | null>
  drawingRef: CanvasDragRef
  dispatch: React.Dispatch<Action>
  commit: (label: string, changedLayerIds?: ChangedLayerIds) => void
  requestRender: (change?: RenderChange) => void
}

export function useCanvasPathEditing(options: PathEditingOptions) {
  const { activeDoc, activeLayer, tool, brush, foreground, overlayRef, drawingRef, dispatch, commit, requestRender } = options

  const pathDraftRef = React.useRef<PathDraft | null>(null)
  const [, setDirectAnchorSelectionState] = React.useState<{ layerId: string; anchors: PathAnchorRef[] } | null>(null)
  const directAnchorSelectionRef = React.useRef<{ layerId: string; anchors: PathAnchorRef[] } | null>(null)

  const setDirectAnchorSelection = React.useCallback((selection: { layerId: string; anchors: PathAnchorRef[] } | null) => {
    directAnchorSelectionRef.current = selection
    setDirectAnchorSelectionState(selection)
  }, [])

  function clearOverlay() {
    const ov = overlayRef.current
    if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
  }

  /* ---- direct-selection anchor set ---- */

  function directSelectionAnchorsFor(layerId: string) {
    return directAnchorSelectionRef.current?.layerId === layerId ? directAnchorSelectionRef.current.anchors : []
  }

  function isDirectAnchorSelected(layerId: string, anchor: PathAnchorRef) {
    return directSelectionAnchorsFor(layerId).some((selected) =>
      selected.subpathIndex === anchor.subpathIndex && selected.pointIndex === anchor.pointIndex,
    )
  }

  function setSingleDirectAnchor(layerId: string, anchor: PathAnchorRef) {
    setDirectAnchorSelection({ layerId, anchors: [anchor] })
    return [anchor]
  }

  function toggleDirectAnchor(layerId: string, anchor: PathAnchorRef) {
    const anchors = togglePathAnchorSelection(directSelectionAnchorsFor(layerId), anchor)
    setDirectAnchorSelection(anchors.length ? { layerId, anchors } : null)
    return anchors
  }

  /* ---- rendering ---- */

  /** Stroke width the path preview renders at, derived from the brush size. */
  function vectorStrokeWidth() {
    return Math.max(1, brush.size / 4)
  }

  function rerenderVectorLayer(layer: Layer) {
    rerenderVectorLayerGeometry(layer, foreground, vectorStrokeWidth())
  }

  function drawPathSelectionPreview(layer: Layer) {
    const ov = overlayRef.current
    if (!ov || !activeDoc) return
    drawPathSelectionPreviewOverlay(ov, layer, {
      bounds: vectorLayerBounds(layer),
      editablePath: editablePathForDirectSelection(layer),
      selectedAnchors: directSelectionAnchorsFor(layer.id),
    })
  }

  function drawPathPreview(hover?: { x: number; y: number } | null) {
    const ov = overlayRef.current
    if (!ov || !pathDraftRef.current) return
    drawPathPreviewOverlay(ov, pathDraftRef.current, hover)
  }

  function updateDirectSelectionDrag(
    layer: Layer,
    pt: { x: number; y: number },
    drag: CanvasDragRef["current"],
    mirrorPathHandles = true,
    constrainMove = false,
  ) {
    applyDirectSelectionDrag(layer, pt, drag, {
      foreground,
      strokeWidth: vectorStrokeWidth(),
      mirrorPathHandles,
      constrainMove,
    })
  }

  /* ---- pen path commit ---- */

  function commitPath(closed: boolean) {
    if (!activeDoc || !pathDraftRef.current) return
    const draft = pathDraftRef.current
    pathDraftRef.current = null
    clearOverlay()
    const points = draft.curvature ? makeCurvaturePath(draft.points, closed) : draft.points
    const cv = makeCanvas(activeDoc.width, activeDoc.height)
    const ctx = cv.getContext("2d")!
    strokePath(ctx, { points, closed }, foreground, Math.max(1, brush.size / 4), closed, hexToRgba(foreground, 0.3))
    const layer: Layer = {
      id: `path_${Math.random().toString(36).slice(2, 9)}`,
      name: draft.curvature ? "Curvature Path" : "Path",
      kind: "shape",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      canvas: cv,
      path: { points, closed },
    }
    dispatch({ type: "add-layer", layer })
    setTimeout(() => commit(draft.curvature ? "Curvature Pen Path" : "Pen Path", [layer.id]), 0)
  }

  function simplifyFreeformPath(points: { x: number; y: number }[]): PathPoint[] {
    return fitFreeformPath(points, {
      tolerance: Math.max(1.5, Math.min(8, brush.smoothing > 0 ? brush.smoothing / 16 : 3)),
      smoothness: Math.max(0.45, Math.min(0.9, 0.55 + brush.smoothing / 220)),
    })
  }

  /* ---- anchor-level edits ---- */

  function editAnchorPoint(mode: "add-anchor-point" | "delete-anchor-point" | "convert-point", pt: { x: number; y: number }) {
    const layer = activeLayer?.path ? activeLayer : activeDoc ? pickVectorLayer(activeDoc, pt) : null
    if (!layer?.path || !layerAllowsDrawing(layer)) return
    const path = layer.path
    let nextPath = path
    if (mode === "add-anchor-point") {
      nextPath = addAnchorPointToPath(path, pt).path
    } else {
      const nearest = nearestAnchorPoint(path, pt)
      if (nearest.index < 0 || nearest.distance > 24) return
      if (mode === "delete-anchor-point") {
        const result = deleteNearestAnchorPoint(path, pt, 24)
        if (result.removedIndex < 0) return
        nextPath = result.path
      } else {
        nextPath = convertAnchorPoint(path, nearest.index).path
      }
    }
    layer.path = nextPath
    rerenderVectorLayer(layer)
    dispatch({ type: "set-active-layer", id: layer.id })
    dispatch({ type: "set-layer-path", id: layer.id, path: layer.path })
    drawPathSelectionPreview(layer)
    setTimeout(() => commit(mode === "add-anchor-point" ? "Add Anchor Point" : mode === "delete-anchor-point" ? "Delete Anchor Point" : "Convert Point", [layer.id]), 0)
  }

  /** Alt+click with a pen tool: toggle the anchor under the cursor corner/smooth. */
  function convertAnchorAtPoint(pt: { x: number; y: number }) {
    const layer = activeLayer && isVectorEditableLayer(activeLayer) ? activeLayer : activeDoc ? pickVectorLayer(activeDoc, pt) : null
    if (!layer || !layerAllowsDrawing(layer)) return false
    const direct = directSelectionTarget(layer, pt)
    if (!direct || direct.pointIndex === undefined || direct.pathHandle) return false
    if (layer.path) {
      const editablePath = pathForDirectEdit(layer.path, direct.subpathIndex)
      layer.path = replaceDirectEditPath(layer.path, direct.subpathIndex, convertAnchorPoint(editablePath, direct.pointIndex).path)
      dispatch({ type: "set-layer-path", id: layer.id, path: layer.path })
    } else if (layer.shape) {
      const basePath = layer.shape.computedPath ?? shapeToEditablePath(layer.shape)
      const editablePath = pathForDirectEdit(basePath, direct.subpathIndex)
      layer.shape = {
        ...layer.shape,
        computedPath: replaceDirectEditPath(basePath, direct.subpathIndex, convertAnchorPoint(editablePath, direct.pointIndex).path),
      }
      dispatch({ type: "set-layer-shape", id: layer.id, shape: layer.shape })
    } else {
      return false
    }
    setSingleDirectAnchor(layer.id, { subpathIndex: direct.subpathIndex ?? -1, pointIndex: direct.pointIndex })
    rerenderVectorLayer(layer)
    drawPathSelectionPreview(layer)
    setTimeout(() => commit("Convert Point", [layer.id]), 0)
    return true
  }

  /** Pointer-down for direct selection: pick a target and open the matching drag. */
  function beginDirectSelectionAtPoint(
    e: Pick<React.PointerEvent<HTMLDivElement>, "shiftKey" | "altKey" | "ctrlKey" | "metaKey">,
    pt: { x: number; y: number },
  ) {
    if (!activeDoc) return false
    const layer = pickVectorLayer(activeDoc, pt) ?? activeLayer
    if (!layer || !isVectorEditableLayer(layer)) return false
    dispatch({ type: "set-active-layer", id: layer.id })
    drawPathSelectionPreview(layer)
    if (!layerAllowsDrawing(layer)) return true
    const direct = directSelectionTarget(layer, pt)
    if (!direct) return true
    if (e.altKey && direct.segmentIndex !== undefined) {
      const editablePath = editablePathForDirectSelection(layer)
      const directSelectedAnchors = editablePath ? selectPathSubpathAnchors(editablePath, direct.subpathIndex ?? -1) : []
      setDirectAnchorSelection(directSelectedAnchors.length ? { layerId: layer.id, anchors: directSelectedAnchors } : null)
      drawingRef.current = {
        type: "path-direct",
        start: pt,
        last: pt,
        directLayerId: layer.id,
        directSubpathIndex: direct.subpathIndex,
        directSelectedAnchors,
      }
      drawPathSelectionPreview(layer)
      return true
    }
    if (direct.shapeHandle === "center" && direct.pointIndex === undefined && direct.segmentIndex === undefined && !e.altKey) {
      drawingRef.current = {
        type: "path-marquee",
        start: pt,
        last: pt,
        directLayerId: layer.id,
      }
      const ov = overlayRef.current
      if (ov) drawMarqueePreviewOverlay(ov, activeDoc, tool, pt, pt)
      return true
    }
    let directSelectedAnchors: PathAnchorRef[] | undefined
    if (direct.pointIndex !== undefined) {
      const anchor = { subpathIndex: direct.subpathIndex ?? -1, pointIndex: direct.pointIndex }
      if (direct.pathHandle) {
        directSelectedAnchors = isDirectAnchorSelected(layer.id, anchor)
          ? directSelectionAnchorsFor(layer.id)
          : setSingleDirectAnchor(layer.id, anchor)
      } else if (e.shiftKey) {
        directSelectedAnchors = toggleDirectAnchor(layer.id, anchor)
        if (!directSelectedAnchors.some((selected) => selected.subpathIndex === anchor.subpathIndex && selected.pointIndex === anchor.pointIndex)) {
          drawPathSelectionPreview(layer)
          return true
        }
      } else {
        directSelectedAnchors = isDirectAnchorSelected(layer.id, anchor)
          ? directSelectionAnchorsFor(layer.id)
          : setSingleDirectAnchor(layer.id, anchor)
      }
    } else if (!e.shiftKey) {
      setDirectAnchorSelection(null)
    }
    drawingRef.current = {
      type: "path-direct",
      start: pt,
      last: pt,
      directLayerId: layer.id,
      directSubpathIndex: direct.subpathIndex,
      directPointIndex: direct.pointIndex,
      directPathHandle: direct.pathHandle,
      directShapeHandle: direct.shapeHandle,
      directSelectedAnchors,
    }
    return true
  }

  /** Alt+drag with the path-select tool: clone the subpath under the cursor. */
  function duplicateSubpathForPathSelection(layer: Layer, pt: { x: number; y: number }) {
    if (!layerAllowsDrawing(layer)) return false
    const editablePath = editablePathForDirectSelection(layer)
    if (!editablePath?.points.length) return false
    const hit = hitTestPathControls(editablePath, pt, {
      maxAnchorDistance: 14,
      maxHandleDistance: 14,
      maxSegmentDistance: 9,
      segmentSamples: 32,
    })
    const sourceSubpathIndex = hit?.subpathIndex ?? -1
    const duplicated = duplicatePathSubpath(editablePath, sourceSubpathIndex)
    if (duplicated.insertedSubpathIndex < 0) return false
    if (layer.path) {
      layer.path = duplicated.path
      dispatch({ type: "set-layer-path", id: layer.id, path: layer.path })
    } else if (layer.shape) {
      layer.shape = { ...layer.shape, computedPath: duplicated.path }
      dispatch({ type: "set-layer-shape", id: layer.id, shape: layer.shape })
    } else {
      return false
    }
    setDirectAnchorSelection({ layerId: layer.id, anchors: duplicated.selection })
    drawingRef.current = {
      type: "path-direct",
      start: pt,
      last: pt,
      directLayerId: layer.id,
      directSubpathIndex: duplicated.insertedSubpathIndex,
      directSelectedAnchors: duplicated.selection,
    }
    rerenderVectorLayer(layer)
    requestRender()
    drawPathSelectionPreview(layer)
    return true
  }

  /** Ctrl/Cmd+A with the direct-selection tool: select every anchor on the layer. */
  function selectAllAnchors(layer: Layer) {
    const path = editablePathForDirectSelection(layer)
    if (!path) return false
    const anchors = selectAllPathAnchors(path)
    setDirectAnchorSelection(anchors.length ? { layerId: layer.id, anchors } : null)
    drawPathSelectionPreview(layer)
    return true
  }

  /** Delete/Backspace with anchors selected: drop them from the path or shape. */
  function deleteSelectedAnchors(layer: Layer, selected: PathAnchorRef[]) {
    if (layer.path) {
      const path = deleteSelectedPathAnchors(layer.path, selected)
      dispatch({ type: "set-layer-path", id: layer.id, path })
      layer.path = path
    } else if (layer.shape) {
      const basePath = layer.shape.computedPath ?? shapeToEditablePath(layer.shape)
      const computedPath = deleteSelectedPathAnchors(basePath, selected)
      layer.shape = { ...layer.shape, computedPath }
      dispatch({ type: "set-layer-shape", id: layer.id, shape: layer.shape })
    }
    setDirectAnchorSelection(null)
    rerenderVectorLayer(layer)
    drawPathSelectionPreview(layer)
    requestRender()
    commit("Delete Path Anchors", [layer.id])
  }

  /** Marquee release with the direct-selection tool: select anchors inside the box. */
  function selectAnchorsInRect(layer: Layer, rect: { x: number; y: number; w: number; h: number }) {
    const editablePath = editablePathForDirectSelection(layer)
    if (!editablePath) return
    const anchors = selectPathAnchorsInRect(editablePath, rect)
    setDirectAnchorSelection(anchors.length ? { layerId: layer.id, anchors } : null)
    drawPathSelectionPreview(layer)
  }

  return {
    pathDraftRef,
    setDirectAnchorSelection,
    directSelectionAnchorsFor,
    vectorStrokeWidth,
    rerenderVectorLayer,
    drawPathSelectionPreview,
    drawPathPreview,
    updateDirectSelectionDrag,
    commitPath,
    simplifyFreeformPath,
    editAnchorPoint,
    convertAnchorAtPoint,
    beginDirectSelectionAtPoint,
    duplicateSubpathForPathSelection,
    selectAllAnchors,
    deleteSelectedAnchors,
    selectAnchorsInRect,
  }
}

export type CanvasPathEditing = ReturnType<typeof useCanvasPathEditing>
