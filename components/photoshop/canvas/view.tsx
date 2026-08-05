"use client"

import * as React from "react"
import {
  shallowEqualEditorSelection,
  useEditorSelector,
  useEditorStoreApi,
} from "@/components/photoshop/editor/context"
import { createRafCoalescer, type RafCoalescer } from "@/editor/raf-coalescer"
import { useColorPickerHud } from "@/editor/canvas/color-hud-controller"
import { useCanvasPaintSession } from "@/editor/canvas/paint-session"
import type { CanvasPointerContext } from "@/editor/canvas/pointer-context"
import { handleCanvasPointerDown } from "@/editor/canvas/pointer-down"
import { handleCanvasPointerMove } from "@/editor/canvas/pointer-move"
import { handleCanvasDoubleClick, handleCanvasPointerCancel, handleCanvasPointerUp } from "@/editor/canvas/pointer-up"
import { useCanvasPathEditing } from "@/editor/canvas/path-editing-controller"
import { useCanvasTransform } from "@/editor/canvas/transform-controller"
import { useCanvasSelectionOps } from "@/editor/canvas/selection-commit"
import { useCanvasDocumentOps } from "@/editor/canvas/document-operations"
import { useOverlayPreviews } from "@/editor/canvas/overlay-preview-bindings"
import type { CanvasDragState } from "@/editor/canvas/drag-state"
import {
  cancelProgressiveRender,
  computeVisibleDocumentViewport,
  drawDocumentComposite,
  emptyCompositeCache,
  type CompositeCacheState,
  type CompositeChange,
} from "@/editor/canvas/composite-renderer"
import { addPhotoshopEventListener, dispatchPhotoshopEvent } from "@/editor/events"
import { useFilterOverlayController } from "@/editor/canvas/filter-overlay-controller"
import { useTextEditController } from "@/editor/canvas/text-edit-controller"
import { DEFAULT_PREFERENCES } from "@/editor/preferences-engine"
import { paintCanvasCursorOverlay, resolveCanvasCursorState } from "@/editor/cursor-overlay"
import {
  defaultCanvasRuntimePreferences,
  getEyedropperSampleSize,
  getMoveRuntimeOptions,
  layerAllowsMoving,
  isBrushCursorTool,
  readCanvasRuntimePreferences,
  type CanvasRuntimePreferences,
} from "@/editor/canvas/view-runtime"
import { useCanvasViewportController } from "@/editor/canvas/viewport-controller"
import {
  cursorForTool,
} from "@/editor/canvas/shape-helpers"
import { Rulers } from "@/components/photoshop/canvas/rulers"
import { CanvasStageOverlays, SmartFilterMaskBanner } from "@/components/photoshop/canvas/view-overlays"
import {
  type MoveFloat,
} from "@/editor/canvas/selection-helpers"
import {
  editablePathForDirectSelection,
  isVectorEditableLayer,
} from "@/editor/canvas/vector-editing"

import {
  sampleCanvasColor,
} from "@/editor/canvas/view-helpers"
import { cn } from "@/lib/utils"
import { ColorPickerHud } from "@/components/photoshop/color/picker-hud"

interface MouseMoveDetail {
  x: number
  y: number
  inside: boolean
}

export function CanvasView() {
  const editorStore = useEditorStoreApi()
  const ed = useEditorSelector((editor) => ({
    activeDoc: editor.activeDoc,
    activeLayer: editor.activeLayer,
    tool: editor.tool,
    foreground: editor.foreground,
    background: editor.background,
    brush: editor.brush,
    gradient: editor.gradient,
    paintBucket: editor.paintBucket,
    eraser: editor.eraser,
    cloneSource: editor.cloneSource,
    selectionOptions: editor.selectionOptions,
    symmetry: editor.symmetry,
    commit: editor.commit,
    editSmartObject: editor.editSmartObject,
    dispatch: editor.dispatch,
    requestRender: editor.requestRender,
    subscribeRender: editor.subscribeRender,
    toggleQuickMask: editor.toggleQuickMask,
    filterPreviews: editor.filterPreviews,
    activeSmartFilterMaskTarget: editor.activeSmartFilterMaskTarget,
  }), shallowEqualEditorSelection)
  const {
    activeDoc,
    activeLayer,
    tool,
    foreground,
    background,
    brush,
    gradient,
    paintBucket,
    eraser,
    cloneSource,
    selectionOptions,
    symmetry,
    commit,
    editSmartObject,
    dispatch,
    requestRender,
    subscribeRender,
    toggleQuickMask,
    filterPreviews,
    activeSmartFilterMaskTarget,
  } = ed

  const compositeRef = React.useRef<HTMLCanvasElement>(null)
  const overlayRef = React.useRef<HTMLCanvasElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const cursorRef = React.useRef<HTMLDivElement>(null)
  const cursorCanvasRef = React.useRef<HTMLCanvasElement>(null)
  const stageRef = React.useRef<HTMLDivElement>(null)

  /* ---- canvas runtime preferences ---- */
  const [canvasPrefs, setCanvasPrefs] = React.useState<CanvasRuntimePreferences>(() => defaultCanvasRuntimePreferences())
  const [canvasPrefsReady, setCanvasPrefsReady] = React.useState(false)
  const [customCursorReady, setCustomCursorReady] = React.useState(false)
  React.useEffect(() => {
    const read = () => {
      try {
        setCanvasPrefs(readCanvasRuntimePreferences())
        setCanvasPrefsReady(true)
      } catch {}
    }
    read()
    const removePreferences = addPhotoshopEventListener("ps-preferences-changed", read)
    window.addEventListener("storage", read)
    return () => {
      removePreferences()
      window.removeEventListener("storage", read)
    }
  }, [])
  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => setCustomCursorReady(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const commitViewportZoom = React.useCallback((zoom: number) => {
    dispatch({ type: "set-zoom", zoom })
  }, [dispatch])
  const {
    panRef,
    viewZoom,
    visualZoomRef,
    applyStageTransform,
    applyViewZoom,
    docPointFromClient,
    onWheel,
  } = useCanvasViewportController({
    activeDoc,
    canvasPrefs,
    compositeRef,
    overlayRef,
    stageRef,
    onCommitZoom: commitViewportZoom,
  })

  const {
    handleBlurGalleryPointerDown,
    handleBlurGalleryPointerMove,
    handleBlurGalleryPointerUp,
    handleBlurGalleryKeyDown,
    handleLightingEffectsPointerDown,
    handleLightingEffectsPointerMove,
    handleLightingEffectsPointerUp,
  } = useFilterOverlayController({ activeDoc, overlayRef, visualZoomRef })

  const {
    editingText,
    setEditingText,
    editingTextRef,
    activeTextDefaults,
    beginTextEdit,
    commitTextEdit,
    cancelTextEdit,
  } = useTextEditController({ activeDoc, tool, foreground, dispatch, requestRender, commit })

  const removeRef = React.useRef<{ points: { x: number; y: number }[] } | null>(null)
  const patchRef = React.useRef<{ mask: HTMLCanvasElement; bounds: { x: number; y: number; w: number; h: number } } | null>(null)
  const brushResizeRef = React.useRef<{ startClientX: number; startSize: number } | null>(null)
  /** The live floating selection, carried between move-tool drags. */
  const moveFloatRef = React.useRef<MoveFloat | null>(null)
  const mouseMoveCoalescerRef = React.useRef<RafCoalescer<MouseMoveDetail> | null>(null)
  /** The one in-progress pointer gesture; a ref so dragging never re-renders. */
  const drawingRef = React.useRef<CanvasDragState>({ type: null })

  const paint = useCanvasPaintSession({
    activeDoc,
    activeLayer,
    tool,
    brush,
    foreground,
    background,
    eraser,
    cloneSource,
    symmetry,
    activeSmartFilterMaskTarget,
    compositeRef,
    drawingRef,
    requestRender,
    commit,
    historyEntries: () => {
      const current = editorStore.getSnapshot()
      const docId = current.activeDocId
      return docId ? current.histories[docId]?.entries ?? [] : []
    },
  })

  const xform = useCanvasTransform({ activeDoc, activeLayer, overlayRef, drawingRef, commit, requestRender })

  const vectors = useCanvasPathEditing({
    activeDoc,
    activeLayer,
    tool,
    brush,
    foreground,
    overlayRef,
    drawingRef,
    dispatch,
    commit,
    requestRender,
  })

  const selections = useCanvasSelectionOps({
    activeDoc,
    activeLayer,
    tool,
    selectionOptions,
    compositeRef,
    overlayRef,
    selectionHitTesterRef: paint.selectionHitTesterRef,
    dispatch,
  })

  const docOps = useCanvasDocumentOps({
    activeDoc,
    activeLayer,
    brush,
    eraser,
    gradient,
    foreground,
    background,
    overlayRef,
    withinSelection: selections.withinSelection,
    captureHighBitPaintSource: paint.captureHighBitPaintSource,
    syncActiveLayerHighBitFromCanvas: paint.syncActiveLayerHighBitFromCanvas,
    dispatch,
    commit,
    requestRender,
  })

  const previews = useOverlayPreviews({
    activeDoc,
    tool,
    brush,
    cloneSource,
    selectionOptions,
    overlayRef,
    compositeRef,
    patchRef,
    activeLayerCanvas: activeLayer?.canvas ?? null,
    visualZoomRef,
    textDefaultSize: () => activeTextDefaults().size,
    selectionTraceSourceForLayer: selections.selectionTraceSourceForLayer,
  })

  /**
   * The keyboard listener's dependency list is deliberately narrow, so it reads
   * the path controller through a ref every render refreshes rather than
   * capturing a closure that goes stale after the first anchor edit.
   */
  const vectorsRef = React.useRef(vectors)
  vectorsRef.current = vectors

  React.useEffect(() => {
    const coalescer = createRafCoalescer<MouseMoveDetail>((detail) => {
      dispatchPhotoshopEvent("ps-mousemove", detail)
    })
    mouseMoveCoalescerRef.current = coalescer
    return () => {
      coalescer.cancel()
      if (mouseMoveCoalescerRef.current === coalescer) mouseMoveCoalescerRef.current = null
    }
  }, [])

  /* ---- composite render ---- */

  // Composite cache: skip full re-composite when layer state hasn't changed
  const compositeCacheRef = React.useRef<CompositeCacheState>(emptyCompositeCache())
  const progressiveFrameRef = React.useRef<number | null>(null)
  const progressiveFullPassRef = React.useRef(false)

  const visibleDocumentViewport = React.useCallback(
    () => computeVisibleDocumentViewport(activeDoc, containerRef.current, stageRef.current),
    [activeDoc],
  )

  const drawComposite = React.useCallback((force = false, change?: CompositeChange) => {
    const cv = compositeRef.current
    if (!cv || !activeDoc) return
    drawDocumentComposite(
      {
        canvas: cv,
        document: activeDoc,
        filterPreviews,
        viewZoom,
        cache: compositeCacheRef,
        progressiveFrame: progressiveFrameRef,
        progressiveFullPass: progressiveFullPassRef,
        viewport: visibleDocumentViewport,
      },
      force,
      change,
    )
  }, [activeDoc, filterPreviews, viewZoom, visibleDocumentViewport])

  /**
   * Draw, then latch the readiness flag the E2E runtime guard waits on.
   *
   * This used to be a separate rAF loop that sampled the centre pixel with
   * getImageData. That forces a GPU->CPU readback of the *on-screen* canvas,
   * and after a few of those Chrome demotes it to a software backing store —
   * which makes every later drawImage into it slow, for every tool. The loop
   * also re-armed on each commit (compose changes identity with activeDoc) and
   * never terminated at all when the centre pixel happened to be transparent,
   * so it could read back once per frame indefinitely. compose() already knows
   * it has drawn; no readback needed.
   */
  const compose = React.useCallback((force = false, change?: Parameters<typeof drawComposite>[1]) => {
    drawComposite(force, change)
    const stage = stageRef.current
    if (stage && compositeRef.current && activeDoc) stage.dataset.editorReady = "true"
  }, [activeDoc, drawComposite])

  React.useEffect(() => {
    const stage = stageRef.current
    if (stage) delete stage.dataset.editorReady
    compose()
    return subscribeRender((change) => compose(true, change))
  }, [compose, subscribeRender])

  React.useEffect(() => () => cancelProgressiveRender(progressiveFrameRef), [])

  // Native listener: React attaches wheel passively, so preventDefault() on
  // ctrl+wheel zoom would be ignored (and the page would zoom instead).
  React.useEffect(() => {
    const root = containerRef.current
    if (!root) return
    root.addEventListener("wheel", onWheel, { passive: false, capture: true })
    return () => root.removeEventListener("wheel", onWheel, { capture: true })
  }, [onWheel, activeDoc?.id])

  // The zoom tool owns the right button (zoom out), so the app-level context
  // menu must not also open. It listens on `window` during bubble, so a capture
  // listener here stops the event before it ever gets there.
  React.useEffect(() => {
    const root = containerRef.current
    if (!root || tool !== "zoom") return
    const suppress = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
    }
    root.addEventListener("contextmenu", suppress, { capture: true })
    return () => root.removeEventListener("contextmenu", suppress, { capture: true })
  }, [tool])

  /* ---- coords ---- */

  const getCanvasPoint = React.useCallback(
    (clientX: number, clientY: number) => {
      const cv = compositeRef.current
      if (!cv || !activeDoc) return { x: 0, y: 0 }
      const rect = cv.getBoundingClientRect()
      let x = ((clientX - rect.left) / rect.width) * activeDoc.width
      let y = ((clientY - rect.top) / rect.height) * activeDoc.height
      // snap to grid
      if (activeDoc.snap && activeDoc.snapToGrid && activeDoc.gridSize) {
        const g = activeDoc.gridSize
        x = Math.round(x / g) * g
        y = Math.round(y / g) * g
      }
      return { x, y }
    },
    [activeDoc],
  )
  /** One zoom-tool click: steps by 1.5× toward or away from the cursor. */
  function applyZoomToolStep(clientX: number, clientY: number, out: boolean) {
    applyViewZoom(
      visualZoomRef.current * (out ? 1 / 1.5 : 1.5),
      docPointFromClient(clientX, clientY),
    )
  }

  /** Read the composited colour under `pt` into the fore/background swatch. */
  function sampleEyedropperAt(pt: { x: number; y: number }, toBackground: boolean) {
    const cv = compositeRef.current
    if (!cv || !activeDoc) return
    const clamped = {
      x: Math.max(0, Math.min(activeDoc.width - 1, pt.x)),
      y: Math.max(0, Math.min(activeDoc.height - 1, pt.y)),
    }
    const px = sampleCanvasColor(cv, clamped, getEyedropperSampleSize())
    if (px.a === 0) return
    const hex = "#" + [px.r, px.g, px.b].map((c) => c.toString(16).padStart(2, "0")).join("")
    dispatch(toBackground ? { type: "set-background", color: hex } : { type: "set-foreground", color: hex })
  }

  /**
   * Timeline transition overlay: during playback the timeline panel emits a
   * baked transition canvas via "ps-timeline-transition-overlay". We draw it
   * onto the existing overlay canvas so the user sees the live dissolve/fade/
   * wipe compositing without mutating layer state.
   */
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ canvas?: HTMLCanvasElement | null; docId?: string } | null>).detail
      const ov = overlayRef.current
      if (!ov) return
      const ctx = ov.getContext("2d")
      if (!ctx) return
      if (!detail || !detail.canvas) {
        ctx.clearRect(0, 0, ov.width, ov.height)
        return
      }
      if (detail.docId && activeDoc?.id && detail.docId !== activeDoc.id) {
        ctx.clearRect(0, 0, ov.width, ov.height)
        return
      }
      ctx.clearRect(0, 0, ov.width, ov.height)
      try {
        ctx.drawImage(detail.canvas, 0, 0, ov.width, ov.height)
      } catch {
        // canvas may have been disposed by the panel; ignore
      }
    }
    return addPhotoshopEventListener("ps-timeline-transition-overlay", (_detail, event) => handler(event))
  }, [activeDoc?.id])

  /* ---- pointer state ---- */
  const { colorHud, setColorHud } = useColorPickerHud(foreground, dispatch)
  const showBrushCursor = isBrushCursorTool(tool)

  /**
   * One bag of everything the pointer handlers may touch, rebuilt each render
   * so they always see current state. Assembling it here keeps the gesture
   * dispatch itself out of this file.
   */
  const pointerContext: CanvasPointerContext = {
    activeDoc,
    activeLayer,
    tool,
    foreground,
    background,
    brush,
    gradient,
    paintBucket,
    eraser,
    cloneSource,
    selectionOptions,
    dispatch,
    commit,
    requestRender,
    editSmartObject,
    compositeRef,
    overlayRef,
    cursorRef,
    drawingRef,
    removeRef,
    patchRef,
    brushResizeRef,
    moveFloatRef,
    mouseMoveCoalescerRef,
    paint,
    vectors,
    xform,
    selections,
    docOps,
    previews,
    panRef,
    visualZoomRef,
    applyStageTransform,
    applyZoomToolStep,
    handleBlurGalleryPointerDown,
    handleBlurGalleryPointerMove,
    handleBlurGalleryPointerUp,
    handleLightingEffectsPointerDown,
    handleLightingEffectsPointerMove,
    handleLightingEffectsPointerUp,
    editingTextRef,
    beginTextEdit,
    commitTextEdit,
    activeTextDefaults,
    getCanvasPoint,
    sampleEyedropperAt,
    showBrushCursor,
    setColorHud,
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => handleCanvasPointerDown(pointerContext, e)
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => handleCanvasPointerMove(pointerContext, e)
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => handleCanvasPointerUp(pointerContext, e)
  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => handleCanvasPointerCancel(pointerContext, e)
  const onDoubleClick = (e: React.MouseEvent) => handleCanvasDoubleClick(pointerContext, e)





  /* ---- key handlers (escape, enter for transform, delete pen point) ---- */

  const transformRef = xform.transformRef
  const pathDraftRef = vectors.pathDraftRef
  const abortStrokeRef = React.useRef(paint.abortStroke)
  const beginTransformRef = React.useRef(xform.beginTransform)
  const commitTransformRef = React.useRef(xform.commitTransform)
  const commitPathRef = React.useRef(vectors.commitPath)
  abortStrokeRef.current = paint.abortStroke
  beginTransformRef.current = xform.beginTransform
  commitTransformRef.current = xform.commitTransform
  commitPathRef.current = vectors.commitPath

  React.useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
      if (handleBlurGalleryKeyDown(e)) return
      if (e.key === "Escape") {
        if (drawingRef.current.type === "stroke") abortStrokeRef.current()
        if (transformRef.current) {
          // discard
          transformRef.current = null
          const ov = overlayRef.current
          if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
          requestRender()
        }
        if (pathDraftRef.current) {
          pathDraftRef.current = null
          const ov = overlayRef.current
          if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
        }
        if (patchRef.current || drawingRef.current.type === "patch-lasso" || drawingRef.current.type === "patch-drag") {
          patchRef.current = null
          drawingRef.current = { type: null }
          const ov = overlayRef.current
          if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
        }
        if (drawingRef.current.type === "polylasso") {
          drawingRef.current = { type: null }
          const ov = overlayRef.current
          if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
        }
      }
      if (e.key === "Enter" && transformRef.current) {
        commitTransformRef.current()
      }
      // Enter finishes an open pen path — otherwise the only ways out were
      // double-clicking or closing back onto the first anchor, so a simple
      // open path could not be completed at all.
      if (e.key === "Enter" && !transformRef.current && pathDraftRef.current) {
        e.preventDefault()
        if (pathDraftRef.current.points.length >= 2) commitPathRef.current(false)
        else pathDraftRef.current = null
        const ov = overlayRef.current
        if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "q") {
        e.preventDefault()
        toggleQuickMask()
      }
      if (tool === "direct-select" && activeLayer && isVectorEditableLayer(activeLayer)) {
        const paths = vectorsRef.current
        const selected = paths.directSelectionAnchorsFor(activeLayer.id)
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
          if (editablePathForDirectSelection(activeLayer)) {
            e.preventDefault()
            paths.selectAllAnchors(activeLayer)
          }
        } else if ((e.key === "Delete" || e.key === "Backspace") && selected.length) {
          e.preventDefault()
          paths.deleteSelectedAnchors(activeLayer, selected)
        } else if (e.key === "Escape" && selected.length) {
          paths.setDirectAnchorSelection(null)
          paths.drawPathSelectionPreview(activeLayer)
        }
      }
      // Free Transform
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "t" && !e.shiftKey) {
        if (layerAllowsMoving(activeLayer)) {
          e.preventDefault()
          beginTransformRef.current(activeLayer)
        }
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [activeLayer, requestRender, toggleQuickMask, activeDoc, handleBlurGalleryKeyDown, tool, transformRef, pathDraftRef])

  // A floating selection only survives inside the move tool. Any other tool
  // could have repainted the layer, which would make the float's base stale.
  React.useEffect(() => {
    if (tool !== "move") moveFloatRef.current = null
  }, [tool])

  React.useEffect(() => {
    function moveOptionsHandler() {
      if (tool !== "move" && tool !== "content-aware-move") return
      const options = getMoveRuntimeOptions()
      if (options.showTransformControls && layerAllowsMoving(activeLayer)) {
        xform.beginTransform(activeLayer)
      } else if (!options.showTransformControls && xform.transformRef.current) {
        xform.discardTransform()
      }
    }
    const removeMoveOptions = addPhotoshopEventListener("ps-move-options-changed", moveOptionsHandler)
    moveOptionsHandler()
    return removeMoveOptions
    // Transform setup reads current refs and runtime options; adding xform.beginTransform would resubscribe on every preview render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayer, tool, requestRender])

  /* ---- on-canvas selection-transform overlay ---- */

  const [selectionTransformActive, setSelectionTransformActive] = React.useState(false)
  React.useEffect(() => {
    function begin() {
      if (!activeDoc?.selection.bounds) return
      setSelectionTransformActive(true)
    }
    function cancel() {
      setSelectionTransformActive(false)
    }
    const removeBegin = addPhotoshopEventListener("ps-transform-selection-begin", begin)
    const removeCancel = addPhotoshopEventListener("ps-transform-selection-cancel", cancel)
    return () => {
      removeBegin()
      removeCancel()
    }
  }, [activeDoc])
  React.useEffect(() => {
    if (selectionTransformActive && !activeDoc?.selection.bounds) {
      setSelectionTransformActive(false)
    }
  }, [activeDoc, selectionTransformActive])

  React.useEffect(() => {
    function navigatorPanHandler(e: Event) {
      if (!activeDoc) return
      const detail = (e as CustomEvent<{ x: number; y: number }>).detail
      if (!detail) return
      const zoom = visualZoomRef.current
      panRef.current = {
        x: (activeDoc.width / 2 - detail.x) * zoom,
        y: (activeDoc.height / 2 - detail.y) * zoom,
      }
      applyStageTransform()
    }
    return addPhotoshopEventListener("ps-navigator-pan", (_detail, event) => navigatorPanHandler(event))
  }, [activeDoc, applyStageTransform, panRef, visualZoomRef])



  const onPointerEnter = () => {
    const cur = cursorRef.current
    if (cur) cur.style.opacity = cur.firstElementChild ? "1" : "0"
  }
  const onPointerLeave = () => {
    const cur = cursorRef.current
    if (cur) cur.style.opacity = "0"
    // Keep strokes in progress on leave; captured pointerup still commits.
  }

  const standardCssCursor = (() => {
    const value = cursorForTool(tool, false)
    return showBrushCursor && value === "default" ? "crosshair" : value
  })()
  const customCanvasCursorEnabled = customCursorReady && canvasPrefsReady
  const canvasCursorState = React.useMemo(
    () =>
      resolveCanvasCursorState({
        standardCssCursor,
        cursorStyle: customCanvasCursorEnabled
          ? canvasPrefs.cursorStyle
          : DEFAULT_PREFERENCES.toolBehavior.cursorStyle,
        tool,
        isBrushTool: showBrushCursor,
        brushSize: brush.size,
        zoom: viewZoom,
        showBrushPreview: customCanvasCursorEnabled
          ? canvasPrefs.showBrushPreview
          : DEFAULT_PREFERENCES.toolBehavior.showBrushPreview,
        showBrushSizeCrosshair: customCanvasCursorEnabled
          ? canvasPrefs.showBrushSizeCrosshair
          : DEFAULT_PREFERENCES.toolBehavior.showBrushSizeCrosshair,
      }),
    [
      brush.size,
      canvasPrefs.cursorStyle,
      canvasPrefs.showBrushPreview,
      canvasPrefs.showBrushSizeCrosshair,
      customCanvasCursorEnabled,
      showBrushCursor,
      standardCssCursor,
      tool,
      viewZoom,
    ],
  )

  const activeSmartFilterMaskInfo = React.useMemo(() => {
    if (!activeDoc || !activeSmartFilterMaskTarget) return null
    const layer = activeDoc.layers.find((candidate) => candidate.id === activeSmartFilterMaskTarget.layerId)
    const filter = layer?.smartFilters?.find((candidate) => candidate.id === activeSmartFilterMaskTarget.filterId)
    if (!layer || !filter) return null
    return {
      layerName: layer.name,
      filterName: filter.name,
      density: Math.round((filter.maskDensity ?? 1) * 100),
      feather: Math.round(filter.maskFeather ?? 0),
    }
  }, [activeDoc, activeSmartFilterMaskTarget])

  React.useLayoutEffect(() => {
    const canvas = cursorCanvasRef.current
    const cursorEl = cursorRef.current
    if (!customCanvasCursorEnabled || !canvas || !canvasCursorState.overlay) {
      if (cursorEl) cursorEl.style.opacity = "0"
      return
    }
    paintCanvasCursorOverlay(canvas, canvasCursorState.overlay, window.devicePixelRatio)
  }, [canvasCursorState, customCanvasCursorEnabled])

  if (!activeDoc) {
    return (
      <div className="flex-1 bg-[var(--ps-canvas-bg)] flex items-center justify-center text-[var(--ps-text-dim)]">
        No document open. Use File ▸ New… to start.
      </div>
    )
  }

  const displayW = activeDoc.width * viewZoom
  const displayH = activeDoc.height * viewZoom
  const tileOnlyDefaultCanvas = !!activeDoc.metadata?.largeDocumentTileView || activeDoc.width * activeDoc.height > 10000 * 10000

  return (
    <div
      ref={containerRef}
      data-canvas-root
      className="flex-1 relative overflow-hidden bg-[var(--ps-canvas-bg)]"
      role="region"
      aria-label="Image editor canvas"
    >
      {activeDoc && <Rulers
        width={activeDoc.width}
        height={activeDoc.height}
        zoom={viewZoom}
        unit={activeDoc.rulerUnits ?? canvasPrefs.rulerUnits}
        documentDpi={activeDoc.dpi ?? canvasPrefs.printResolution}
        onCreateGuide={(orient, pos) => {
        const id = `g_${Math.random().toString(36).slice(2, 8)}`
        dispatch({ type: "add-guide", guide: { id, orientation: orient, position: Math.round(pos) } })
      }} />}
      {activeSmartFilterMaskInfo ? (
        <SmartFilterMaskBanner
          info={activeSmartFilterMaskInfo}
          onExit={() => {
            dispatch({ type: "set-active-smart-filter-mask", target: null })
            requestRender()
          }}
        />
      ) : null}
      <div
        className="absolute inset-0 pt-[18px] pl-[18px] flex items-center justify-center overflow-auto"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        style={{ cursor: customCanvasCursorEnabled ? canvasCursorState.cssCursor : standardCssCursor }}
      >
        <div
          ref={stageRef}
          data-canvas-stage
          className="relative shadow-[0_0_0_1px_rgba(0,0,0,0.6),0_8px_30px_rgba(0,0,0,0.55)] flex-shrink-0"
          style={{
            width: displayW,
            height: displayH,
            minWidth: displayW,
            minHeight: displayH,
            transform: `translate(${panRef.current.x}px, ${panRef.current.y}px) rotate(${activeDoc.rotation ?? 0}deg)`,
            willChange: "transform",
          }}
        >
          <div className="absolute inset-0 ps-checker" />
          <canvas
            ref={compositeRef}
            width={tileOnlyDefaultCanvas ? 1 : activeDoc.width}
            height={tileOnlyDefaultCanvas ? 1 : activeDoc.height}
            className={cn("absolute inset-0 w-full h-full")}
            style={{ imageRendering: viewZoom >= 4 ? "pixelated" : "auto" }}
            role="img"
            aria-label={`Document canvas: ${activeDoc.name}, ${activeDoc.width} by ${activeDoc.height} pixels`}
            tabIndex={0}
          />
          <canvas
            ref={overlayRef}
            width={activeDoc.width}
            height={activeDoc.height}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ imageRendering: viewZoom >= 4 ? "pixelated" : "auto" }}
          />
          <CanvasStageOverlays
            activeDoc={activeDoc}
            tool={tool}
            brush={brush}
            cloneSource={cloneSource}
            selectionOptions={selectionOptions}
            viewZoom={viewZoom}
            showToolStatusHud={canvasPrefs.showToolStatusHud}
            selectionTransformActive={selectionTransformActive}
            setSelectionTransformActive={setSelectionTransformActive}
            editingText={editingText}
            setEditingText={setEditingText}
            commitTextEdit={commitTextEdit}
            cancelTextEdit={cancelTextEdit}
            dispatch={dispatch}
          />
        </div>
      </div>
      <div
        ref={cursorRef}
        className="pointer-events-none fixed -translate-x-1/2 -translate-y-1/2 transition-opacity z-50"
        style={{ opacity: 0, willChange: "transform, left, top" }}
      >
        {customCanvasCursorEnabled && canvasCursorState.overlay ? (
          <canvas
            ref={cursorCanvasRef}
            data-testid="custom-canvas-cursor"
            data-cursor-kind={canvasCursorState.overlay.kind}
            className="block mix-blend-difference"
            aria-hidden="true"
            suppressHydrationWarning
          />
        ) : null}
      </div>
      {colorHud ? (
        <ColorPickerHud
          screenX={colorHud.screenX}
          screenY={colorHud.screenY}
          hsv={colorHud.hsv}
        />
      ) : null}
    </div>
  )
}
