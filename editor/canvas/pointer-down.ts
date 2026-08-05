/**
 * Pointer-down on the canvas: pick the gesture the active tool starts.
 *
 * This is one long dispatch on purpose. The order of the branches is the tool
 * precedence — modifier gestures first (colour HUD, brush resize, zoom-out),
 * then the tools that act on a single click, then the ones that open a drag.
 * Each branch either finishes its work or writes `drawingRef.current` and
 * returns, which is what pointer-move and pointer-up then read.
 */

import * as React from "react"
import { constrainPointTo45, isTempDirectSelectModifier } from "@/editor/path-modifier-keys"
import { emitRuntimeEvent } from "@/editor/runtime-telemetry"
import {
  getEyedropperSampleSize,
  getMoveRuntimeOptions,
  layerAllowsDrawing,
  layerAllowsMoving,
} from "@/editor/canvas/view-runtime"
import {
  pickTransformHandle,
  pointInTransformBox,
} from "@/editor/canvas/transform-geometry"
import {
  autoPickLayer,
  liftSelectionFloat,
  pickTextLayerAt,
  reusableMoveFloat,
  selectBackgroundMaskFromImage,
} from "@/editor/canvas/selection-helpers"
import {
  pickVectorLayer,
} from "@/editor/canvas/vector-editing"
import {
  pointInMask,
  sampleCanvasColor,
} from "@/editor/canvas/view-helpers"
import {
  paintBucketFill,
  rasterizeText,
  makeCanvas,
  floodFillMask,
  selectSubjectMask,
  selectSkyMask,
  selectionFromMask,
  selectionToMaskCanvas,
} from "@/editor/tool/helpers"
import { hexToHsv } from "@/components/photoshop/color/picker-hud"
import { applyThreeDMaterialDrop } from "@/editor/three-d-video-engine"
import type { Selection } from "@/editor/types"
import type { CanvasPointerContext } from "@/editor/canvas/pointer-context"

export function handleCanvasPointerDown(ctx: CanvasPointerContext, e: React.PointerEvent<HTMLDivElement>) {
  const {
    activeDoc,
    activeLayer,
    tool,
    foreground,
    brush,
    paintBucket,
    cloneSource,
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
    panRef,
    visualZoomRef,
    handleBlurGalleryPointerDown,
    handleLightingEffectsPointerDown,
    editingTextRef,
    beginTextEdit,
    commitTextEdit,
    getCanvasPoint,
    showBrushCursor,
    setColorHud,
    applyZoomToolStep,
    sampleEyedropperAt,
  } = ctx
  if (!activeDoc) return
    ; (e.target as Element).setPointerCapture?.(e.pointerId)
  const pt = getCanvasPoint(e.clientX, e.clientY)

  // Alt+Shift+RightClick: open the floating color picker HUD at the cursor.
  // Drag selects a color; release applies it to the foreground swatch.
  if (e.button === 2 && e.altKey && e.shiftKey) {
    e.preventDefault()
    e.stopPropagation()
    setColorHud({
      screenX: e.clientX,
      screenY: e.clientY,
      hsv: hexToHsv(foreground),
      pointerId: e.pointerId,
    })
    return
  }

  // Alt+right-drag is a brush-size gesture, not a context-menu gesture.
  // Plain right-click still falls through to the global custom context menu.
  if (e.altKey && showBrushCursor && (e.button === 0 || e.button === 2)) {
    e.preventDefault()
    drawingRef.current = { type: "brush-resize", start: pt }
    brushResizeRef.current = { startClientX: e.clientX, startSize: brush.size }
    return
  }

  // Zoom tool: right-click (or Alt+click) zooms out, both anchored at the
  // cursor. Taken before the generic right-button bail-out below; the
  // matching contextmenu suppression lives with the wheel listener.
  if (tool === "zoom" && e.button === 2) {
    e.preventDefault()
    applyZoomToolStep(e.clientX, e.clientY, true)
    return
  }

  if (e.button === 2) return

  // A click on the canvas while the type editor is open commits that edit
  // (Photoshop behaviour) and is consumed, so it cannot start a second box.
  if (editingTextRef.current) {
    commitTextEdit()
    return
  }

  if (handleBlurGalleryPointerDown(pt, e)) {
    e.preventDefault()
    return
  }

  if (handleLightingEffectsPointerDown(pt, e)) {
    e.preventDefault()
    return
  }

  // Pan with hand tool / middle mouse / spacebar overlay (tool is hand)
  if (tool === "hand" || e.button === 1) {
    drawingRef.current = {
      type: "pan",
      panStart: { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y },
    }
    return
  }

  // Eyedropper tool. Alt samples into the background swatch, as in Photoshop.
  // The drag state keeps sampling on pointer-move so the swatch tracks the
  // cursor live instead of only updating on the initial click.
  if (tool === "eyedropper") {
    drawingRef.current = { type: "eyedropper", start: pt, last: pt, sampleToBackground: e.altKey }
    sampleEyedropperAt(pt, e.altKey)
    return
  }

  if (tool === "color-sampler") {
    const cv = compositeRef.current
    if (!cv) return
    const x = Math.max(0, Math.min(activeDoc.width - 1, Math.floor(pt.x)))
    const y = Math.max(0, Math.min(activeDoc.height - 1, Math.floor(pt.y)))
    const px = sampleCanvasColor(cv, { x, y }, getEyedropperSampleSize())
    const sampler = {
      id: `sampler_${Math.random().toString(36).slice(2, 9)}`,
      x,
      y,
      label: `#${Math.min(4, (activeDoc.colorSamplers?.length ?? 0) + 1)}`,
      rgba: [px.r, px.g, px.b, px.a] as [number, number, number, number],
    }
    dispatch({ type: "add-color-sampler", sampler })
    setTimeout(() => commit("Add Color Sampler", []), 0)
    return
  }

  if (tool === "material-eyedropper" || tool === "material-drop") {
    if (!activeLayer?.threeD) return
    const selectedObject = activeLayer.threeD.objects.find((object) => object.id === activeLayer.threeD?.selectedObjectId) ?? activeLayer.threeD.objects[0]
    const materialId = selectedObject?.materialId ?? activeLayer.threeD.materials[0]?.id
    const material = activeLayer.threeD.materials.find((candidate) => candidate.id === materialId) ?? activeLayer.threeD.materials[0]
    if (!material) return
    if (tool === "material-eyedropper") {
      dispatch({ type: "set-foreground", color: material.color })
      return
    }
    dispatch({
      type: "set-layer-3d",
      id: activeLayer.id,
      scene: applyThreeDMaterialDrop(activeLayer.threeD, selectedObject?.id, foreground, {
        u: activeDoc.width ? pt.x / activeDoc.width : 0.5,
        v: activeDoc.height ? pt.y / activeDoc.height : 0.5,
        radius: Math.max(0.02, Math.min(0.18, brush.size / Math.max(activeDoc.width, activeDoc.height, 1))),
      }),
    })
    setTimeout(() => commit("Paint 3D Texture", [activeLayer.id]), 0)
    return
  }

  if (tool === "note") {
    const existing = (activeDoc.notes ?? []).find((note) => Math.hypot(note.x - pt.x, note.y - pt.y) <= 12)
    if (existing) {
      const next = window.prompt("Edit note", existing.text)
      if (next !== null) {
        dispatch({ type: "update-note", id: existing.id, patch: { text: next.trim() || "Canvas note" } })
        setTimeout(() => commit("Edit Note", []), 0)
      }
      return
    }
    dispatch({
      type: "add-note",
      note: {
        id: `note_${Math.random().toString(36).slice(2, 9)}`,
        x: Math.round(pt.x),
        y: Math.round(pt.y),
        author: "Canvas",
        text: "Canvas note",
        color: "#facc15",
      },
    })
    setTimeout(() => commit("Add Note", []), 0)
    return
  }

  if (tool === "count") {
    const group = activeDoc.countGroup ?? "Group 1"
    const number = (activeDoc.counts ?? []).filter((count) => count.group === group).length + 1
    dispatch({
      type: "add-count",
      count: {
        id: `count_${Math.random().toString(36).slice(2, 9)}`,
        x: Math.round(pt.x),
        y: Math.round(pt.y),
        group,
        number,
      },
    })
    setTimeout(() => commit("Add Count", []), 0)
    return
  }

  if (tool === "rotate-view") {
    if (e.altKey) {
      dispatch({ type: "set-rotation", rotation: 0 })
      return
    }
    const center = { x: activeDoc.width / 2, y: activeDoc.height / 2 }
    drawingRef.current = {
      type: "rotate-view",
      start: pt,
      last: pt,
      rotateStartAngle: Math.atan2(pt.y - center.y, pt.x - center.x),
      rotateStartValue: activeDoc.rotation ?? 0,
    }
    return
  }

  // Transform tool: the first click on a layer puts the box up. Later clicks
  // must fall through to the handle hit-test below — restarting the session
  // on every press reset the box to identity and swallowed the press, so a
  // handle could never actually be grabbed and the tool did nothing.
  if (tool === "transform" && xform.transformRef.current?.layerId !== activeLayer?.id) {
    if (!layerAllowsMoving(activeLayer)) return
    xform.beginTransform(activeLayer)
    return
  }

  // Free Transform: handle hit
  if (xform.transformRef.current) {
    const handle = pickTransformHandle(pt, xform.transformRef.current)
    if (handle) {
      drawingRef.current = {
        type: "transform",
        start: pt,
        handle,
        last: pt,
      }
      return
    }
    // Click outside handles inside box = move; outside box = commit
    const inside = pointInTransformBox(pt, xform.transformRef.current)
    if (inside) {
      drawingRef.current = { type: "transform", start: pt, handle: "move", last: pt }
    } else {
      xform.commitTransform()
    }
    return
  }

  // Set clone source on Alt+click
  if ((tool === "clone-stamp" || tool === "healing-brush") && e.altKey) {
    if (activeLayer) {
      paint.cloneSourceRef.current = {
        sourceX: pt.x,
        sourceY: pt.y,
        layerId: activeLayer.id,
      }
      const preset = {
        id: `clone_${Math.random().toString(36).slice(2, 9)}`,
        name: `${activeLayer.name} @ ${Math.round(pt.x)},${Math.round(pt.y)}`,
        layerId: activeLayer.id,
        sourceX: pt.x,
        sourceY: pt.y,
        scale: cloneSource.scale,
        rotation: cloneSource.rotation,
        offsetX: cloneSource.offsetX,
        offsetY: cloneSource.offsetY,
      }
      dispatch({
        type: "set-clone-source",
        cloneSource: {
          activePresetId: preset.id,
          presets: [preset, ...cloneSource.presets].slice(0, 5),
        },
      })
    }
    return
  }

  // Move tools
  if (tool === "move" || tool === "content-aware-move") {
    let layer = activeLayer
    if (!layer) return
    const moveOptions = getMoveRuntimeOptions()
    if (moveOptions.autoSelect) {
      const auto = autoPickLayer(activeDoc, pt)
      if (auto && auto.id !== layer.id) {
        dispatch({ type: "set-active-layer", id: auto.id })
        layer = auto
      }
    }
    if (!layerAllowsMoving(layer)) return
    // A float already lifted from this same selection keeps moving; only a
    // fresh selection (or an Alt-copy) cuts a new hole.
    const reuseFloat = reusableMoveFloat(moveFloatRef.current, layer.id, activeDoc.selection, e.altKey)
    if (!reuseFloat) moveFloatRef.current = null
    drawingRef.current = {
      type: "move",
      moveLayerId: layer.id,
      moveStart: pt,
      moveOrigin: reuseFloat ? { x: reuseFloat.x, y: reuseFloat.y } : { x: 0, y: 0 },
      last: pt,
    }
    if (reuseFloat) {
      layer.canvas.__moveSnapshot = reuseFloat.base
      layer.canvas.__moveFloat = reuseFloat.float
    } else {
      // Save layer pixels into a temporary buffer keyed via dataset on canvas
      const cv = makeCanvas(activeDoc.width, activeDoc.height)
      cv.getContext("2d")!.drawImage(layer.canvas, 0, 0); layer.canvas.__moveSnapshot = cv
      // With an active selection, Photoshop moves only the selected pixels.
      // Lift them into a float buffer and (unless Alt is held, which copies)
      // punch the hole in the snapshot that stays behind.
      const float = liftSelectionFloat(activeDoc, cv, e.altKey)
      if (float) layer.canvas.__moveFloat = float
    }
    if (moveOptions.showTransformControls) xform.beginTransform(layer)
    return
  }

  // Type mask tools create a text-shaped selection instead of a layer.
  if (tool === "type-mask-horizontal" || tool === "type-mask-vertical") {
    const raw = window.prompt("Type mask text", "Type") ?? "Type"
    const content = tool === "type-mask-vertical" ? raw.split("").join("\n") : raw
    const cv = makeCanvas(activeDoc.width, activeDoc.height)
    rasterizeText(cv, {
      content,
      font: "Geist, system-ui, sans-serif",
      size: 64,
      weight: "bold",
      italic: false,
      color: "#ffffff",
      align: "left",
      x: pt.x,
      y: pt.y,
      antiAlias: true,
    })
    const mask = cv.getContext("2d")!.getImageData(0, 0, activeDoc.width, activeDoc.height)
    let minX = activeDoc.width
    let minY = activeDoc.height
    let maxX = 0
    let maxY = 0
    let hasPixels = false
    for (let y = 0; y < activeDoc.height; y++) {
      for (let x = 0; x < activeDoc.width; x++) {
        if (mask.data[(y * activeDoc.width + x) * 4 + 3] > 0) {
          hasPixels = true
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
    }
    if (hasPixels) selections.commitSelection({ bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, shape: "freehand", mask: cv })
    return
  }

  // Type tools: click places a caret box, drag defines a paragraph box.
  // Clicking existing type re-enters editing on that layer instead.
  if (tool === "type" || tool === "type-vertical") {
    const existing = pickTextLayerAt(activeDoc, pt)
    if (existing) {
      dispatch({ type: "set-active-layer", id: existing.id })
      beginTextEdit(existing, false)
      return
    }
    drawingRef.current = { type: "text-box", start: pt, last: pt }
    previews.drawTextBoxPreview(pt, pt)
    return
  }

  if (
    (tool === "pen" || tool === "curvature-pen" || tool === "freeform-pen" || tool === "path-select") &&
    isTempDirectSelectModifier(e)
  ) {
    vectors.beginDirectSelectionAtPoint(e, pt)
    return
  }

  // Pen tools
  if (tool === "freeform-pen") {
    drawingRef.current = { type: "freeform-path", start: pt, last: pt, points: [pt] }
    previews.drawLassoPreview([pt])
    return
  }

  if (tool === "pen" || tool === "curvature-pen") {
    if (e.altKey && vectors.convertAnchorAtPoint(pt)) return
    const curvature = tool === "curvature-pen"
    if (!vectors.pathDraftRef.current || !!vectors.pathDraftRef.current.curvature !== curvature) {
      vectors.pathDraftRef.current = { points: [{ x: pt.x, y: pt.y }], closed: false, curvature }
    } else {
      const draft = vectors.pathDraftRef.current
      // close on near-first
      if (draft.points.length > 1) {
        const f = draft.points[0]
        if (Math.hypot(f.x - pt.x, f.y - pt.y) < 6) {
          draft.closed = true
          vectors.commitPath(true)
          return
        }
      }
      const nextPoint = e.shiftKey ? constrainPointTo45(draft.points[draft.points.length - 1], pt) : pt
      draft.points.push({ x: nextPoint.x, y: nextPoint.y })
    }
    // Dragging off the anchor pulls out symmetric bezier handles, which is
    // how the pen makes curves; a plain click leaves it a corner point. The
    // curvature pen derives its own handles, so it stays click-only.
    if (!curvature) drawingRef.current = { type: "pen-handle", start: pt, last: pt }
    vectors.drawPathPreview()
    return
  }

  if (tool === "path-select") {
    const hit = pickVectorLayer(activeDoc, pt)
    if (!hit) return
    dispatch({ type: "set-active-layer", id: hit.id })
    vectors.drawPathSelectionPreview(hit)
    if (!layerAllowsMoving(hit)) return
    if (e.altKey && vectors.duplicateSubpathForPathSelection(hit, pt)) return
    drawingRef.current = {
      type: "move",
      moveLayerId: hit.id,
      moveStart: pt,
      moveOrigin: { x: 0, y: 0 },
      last: pt,
    }
    const cv = makeCanvas(activeDoc.width, activeDoc.height)
    cv.getContext("2d")!.drawImage(hit.canvas, 0, 0)
    hit.canvas.__moveSnapshot = cv
    return
  }

  if (tool === "direct-select") {
    vectors.beginDirectSelectionAtPoint(e, pt)
    return
  }

  if (tool === "add-anchor-point" || tool === "delete-anchor-point" || tool === "convert-point") {
    vectors.editAnchorPoint(tool, pt)
    return
  }

  // Shape tools
  if (tool === "shape-rect" || tool === "shape-rounded-rect" || tool === "shape-ellipse" || tool === "shape-polygon" || tool === "shape-star" || tool === "shape-triangle" || tool === "shape-line" || tool === "custom-shape" || tool === "frame" || tool === "artboard" || tool === "slice") {
    if (tool === "slice") {
      const slice = {
        id: `slice_${Math.random().toString(36).slice(2, 9)}`,
        name: `Slice ${(activeDoc.slices ?? []).length + 1}`,
        x: Math.round(pt.x),
        y: Math.round(pt.y),
        w: 1,
        h: 1,
      }
      dispatch({ type: "add-slice", slice })
      drawingRef.current = { type: "shape", start: pt, last: pt, sliceDraftId: slice.id }
      return
    }
    drawingRef.current = { type: "shape", start: pt, last: pt }
    return
  }

  if (tool === "slice-select") {
    const hit = [...(activeDoc.slices ?? [])].reverse().find((slice) =>
      pt.x >= slice.x && pt.x <= slice.x + slice.w && pt.y >= slice.y && pt.y <= slice.y + slice.h,
    )
    dispatch({ type: "set-active-slice", id: hit?.id ?? null })
    if (hit) previews.drawSliceSelectionPreview(hit)
    return
  }

  if (tool === "refine-edge-brush") {
    if (!activeLayer || !activeDoc.selection.bounds) return
    if (typeof activeLayer.canvas.getContext !== "function") return
    drawingRef.current = {
      type: "refine-edge",
      last: pt,
      points: [pt],
      refineMode: e.altKey ? "subtract" : "expand",
    }
    previews.drawBrushPreview(pt, brush.size / 2)
    return
  }

  if (tool === "object-select") {
    if (!activeLayer) return
    drawingRef.current = { type: "object-select", start: pt, last: pt }
    previews.drawMarqueePreview(pt, pt)
    return
  }

  // Magic wand / quick selection = single-click region selection.
  if (tool === "magic-wand" || tool === "quick-selection") {
    if (!activeLayer) return
    if (typeof activeLayer.canvas.getContext !== "function") return
    const srcCanvas = selectionOptions.sampleAllLayers ? compositeRef.current : activeLayer.canvas
    if (!srcCanvas) return
    const ctx = srcCanvas.getContext("2d")!
    const src = ctx.getImageData(0, 0, activeDoc.width, activeDoc.height)
    const { x, y } = pt
    const finishRegionSelection = (
      m: ImageData,
      diagnostics?: Selection["diagnostics"],
      quick = false,
    ) => {
      let minX = activeDoc.width
      let minY = activeDoc.height
      let maxX = 0
      let maxY = 0
      let hasPixels = false
      const data = m.data
      for (let yi = 0; yi < activeDoc.height; yi++) {
        for (let xi = 0; xi < activeDoc.width; xi++) {
          if (data[(yi * activeDoc.width + xi) * 4 + 3] > 0) {
            hasPixels = true
            if (xi < minX) minX = xi
            if (yi < minY) minY = yi
            if (xi > maxX) maxX = xi
            if (yi > maxY) maxY = yi
          }
        }
      }
      if (hasPixels) {
        const maskCv = makeCanvas(activeDoc.width, activeDoc.height)
        maskCv.getContext("2d")!.putImageData(m, 0, 0)
        selections.commitSelection({
          bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
          shape: "wand",
          mask: maskCv,
          diagnostics,
        })
        if (quick) commit("Quick Selection", [])
      } else if (quick) {
        const radius = Math.max(8, Math.min(48, Math.round(selectionOptions.tolerance / 2)))
        selections.commitSelection({
          bounds: {
            x: Math.max(0, x - radius),
            y: Math.max(0, y - radius),
            w: Math.min(activeDoc.width - Math.max(0, x - radius), radius * 2),
            h: Math.min(activeDoc.height - Math.max(0, y - radius), radius * 2),
          },
          shape: "ellipse",
        })
        commit("Quick Selection", [])
      }
    }
    if (tool === "quick-selection") {
      void import("@/editor/algorithmic-operations")
        .then(({ buildEdgeAwareQuickSelectionMaskData }) => {
          const result = buildEdgeAwareQuickSelectionMaskData(src, {
            seed: { x, y },
            tolerance: selectionOptions.tolerance,
            sampleSize: selectionOptions.sampleSize ?? "point",
            contiguous: selectionOptions.contiguous,
            adaptive: true,
            includeDiagonals: true,
            diagnostics: true,
          })
          const mask = new ImageData(activeDoc.width, activeDoc.height)
          for (let i = 0; i < result.maskData.length; i++) {
            mask.data[i * 4 + 3] = result.maskData[i]
          }
          finishRegionSelection(mask, result.diagnostics, true)
        })
        .catch(() => {
          emitRuntimeEvent("worker-fallback", {
            component: "quick-selection",
            reason: "module-load-failed",
            fallback: "magic-wand",
          })
          finishRegionSelection(
            floodFillMask(src, x, y, selectionOptions.tolerance, selectionOptions.contiguous),
            undefined,
            true,
          )
        })
    } else {
      finishRegionSelection(
        floodFillMask(src, x, y, selectionOptions.tolerance, selectionOptions.contiguous),
        undefined,
        false,
      )
    }
    return
  }

  // Select Subject
  if (tool === "select-subject") {
    if (!activeLayer) return
    if (typeof activeLayer.canvas.getContext !== "function") return
    const srcCanvas = selectionOptions.sampleAllLayers ? compositeRef.current : activeLayer.canvas
    if (!srcCanvas) return
    const maskCv = selectSubjectMask(srcCanvas)
    selections.commitSelection(selectionFromMask(maskCv, "freehand"))
    commit("Select Subject", [])
    return
  }

  // Select Sky
  if (tool === "select-sky") {
    if (!activeLayer) return
    if (typeof activeLayer.canvas.getContext !== "function") return
    const srcCanvas = selectionOptions.sampleAllLayers ? compositeRef.current : activeLayer.canvas
    if (!srcCanvas) return
    const maskCv = selectSkyMask(srcCanvas)
    selections.commitSelection(selectionFromMask(maskCv, "freehand"))
    commit("Select Sky", [])
    return
  }

  // Select Background
  if (tool === "select-background") {
    if (!activeLayer) return
    if (typeof activeLayer.canvas.getContext !== "function") return
    const srcCanvas = selectionOptions.sampleAllLayers ? compositeRef.current : activeLayer.canvas
    if (!srcCanvas) return
    const maskCv = selectBackgroundMaskFromImage(srcCanvas, selectionOptions.tolerance)
    selections.commitSelection(selectionFromMask(maskCv, "freehand"))
    commit("Select Background", [])
    return
  }

  if (tool === "red-eye") {
    docOps.applyRedEyeCorrection(pt)
    return
  }

  // Remove Tool
  if (tool === "remove-tool") {
    if (!layerAllowsDrawing(activeLayer)) return
    if (typeof activeLayer.canvas.getContext !== "function") return
    paint.captureHighBitPaintSource()
    // Initialize points for remove stroke
    removeRef.current = { points: [pt] }
    drawingRef.current = { type: "remove", last: pt, points: [pt] }
    return
  }

  if (tool === "patch-tool") {
    if (!layerAllowsDrawing(activeLayer) || typeof activeLayer.canvas.getContext !== "function") return
    const existingPatch = patchRef.current
    if (existingPatch && pointInMask(existingPatch.mask, pt)) {
      paint.captureHighBitPaintSource()
      drawingRef.current = { type: "patch-drag", start: pt, last: pt }
      previews.drawPatchPreview({ x: 0, y: 0 })
      return
    }
    if (!existingPatch && activeDoc.selection.bounds) {
      const mask = selectionToMaskCanvas(activeDoc.width, activeDoc.height, activeDoc.selection)
      if (mask && pointInMask(mask, pt)) {
        patchRef.current = { mask, bounds: activeDoc.selection.bounds }
        paint.captureHighBitPaintSource()
        drawingRef.current = { type: "patch-drag", start: pt, last: pt }
        previews.drawPatchPreview({ x: 0, y: 0 })
        return
      }
    }
    patchRef.current = null
    drawingRef.current = { type: "patch-lasso", start: pt, last: pt, points: [pt] }
    previews.drawLassoPreview([pt])
    return
  }

  if (tool === "paint-bucket") {
    if (!layerAllowsDrawing(activeLayer)) return
    paint.captureHighBitPaintSource()
    const selectionMask = selectionToMaskCanvas(activeDoc.width, activeDoc.height, activeDoc.selection)
    paintBucketFill(
      activeLayer.canvas,
      pt.x,
      pt.y,
      foreground,
      paintBucket.tolerance,
      paintBucket.contiguous,
      selectionMask,
    )
    paint.syncActiveLayerHighBitFromCanvas()
    requestRender()
    commit("Paint Bucket", [activeLayer.id])
    return
  }

  if (tool === "magic-eraser") {
    docOps.magicEraseAt(pt)
    return
  }

  if (tool === "zoom") {
    applyZoomToolStep(e.clientX, e.clientY, e.altKey)
    return
  }

  if (tool === "ruler") {
    drawingRef.current = { type: "ruler", start: pt, last: pt }
    previews.drawRulerPreview(pt, pt)
    dispatch({ type: "set-measurement", m: { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y } })
    return
  }

  if (tool === "marquee-rect" || tool === "marquee-ellipse") {
    drawingRef.current = { type: "marquee", start: pt, last: pt }
    previews.drawMarqueePreview(pt, pt)
    return
  }

  if (tool === "crop") {
    drawingRef.current = { type: "crop", start: pt, last: pt }
    previews.drawMarqueePreview(pt, pt)
    return
  }

  if (tool === "perspective-crop") {
    const existing = drawingRef.current
    if (existing.type === "pcrop" && existing.points) {
      const pts = [...existing.points, pt]
      if (pts.length >= 4) {
        // Apply perspective crop
        docOps.applyPerspectiveCrop(pts.slice(0, 4))
        drawingRef.current = { type: null }
        const ov = overlayRef.current
        if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
      } else {
        drawingRef.current = { type: "pcrop", points: pts, last: pt }
        previews.drawPerspectiveCropPreview(pts)
      }
    } else {
      drawingRef.current = { type: "pcrop", points: [pt], last: pt }
      previews.drawPerspectiveCropPreview([pt])
    }
    return
  }

  if (tool === "lasso") {
    drawingRef.current = { type: "lasso", start: pt, last: pt, points: [pt] }
    return
  }

  if (tool === "lasso-polygon" || tool === "lasso-magnetic") {
    // Click to add a point. Double-click finishes.
    const lassoPt = tool === "lasso-magnetic" ? selections.snapMagneticPoint(pt) : pt
    const existing = drawingRef.current.type === "polylasso" ? drawingRef.current.points ?? [] : []
    const updated = [...existing, lassoPt]
    // close on near-first
    if (updated.length > 2) {
      const f = updated[0]
      const closeDistance = Math.max(3, 8 / Math.max(0.1, visualZoomRef.current))
      if (Math.hypot(f.x - lassoPt.x, f.y - lassoPt.y) < closeDistance) {
        selections.finalizePolyLasso(updated)
        drawingRef.current = { type: null }
        return
      }
    }
    drawingRef.current = { type: "polylasso", points: updated, last: lassoPt }
    previews.drawLassoPreview(updated, lassoPt)
    return
  }

  if (tool === "gradient") {
    paint.captureHighBitPaintSource()
    drawingRef.current = { type: "gradient", start: pt, last: pt }
    docOps.drawGradientPreview(pt, pt)
    return
  }

  // Painting tools
  if (
    tool === "brush" ||
    tool === "mixer-brush" ||
    tool === "pencil" ||
    tool === "eraser" ||
    tool === "color-replace" ||
    tool === "background-eraser" ||
    tool === "pattern-stamp" ||
    tool === "blur" ||
    tool === "sharpen" ||
    tool === "smudge" ||
    tool === "dodge" ||
    tool === "burn" ||
    tool === "sponge" ||
    tool === "clone-stamp" ||
    tool === "history-brush" ||
    tool === "art-history-brush" ||
    tool === "spot-healing" ||
    tool === "healing-brush"
  ) {
    // No source point means nothing to clone from. Bail before starting a
    // stroke; the options bar shows the "Alt-click to set source" hint.
    if ((tool === "clone-stamp" || tool === "healing-brush") && !paint.resolveCloneState(pt)) return
    paint.beginStroke(pt, paint.pointerBrushInput(e, pt))
  }
}
