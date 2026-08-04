"use client"

import * as React from "react"
import {
  shallowEqualEditorSelection,
  useEditorSelector,
  useEditorStoreApi,
} from "@/components/photoshop/editor/context"
import { compositeLayer, getNativeComposite } from "@/editor/blend-modes"
import { applyModeAndColorManagement } from "@/editor/document/color-management"
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
import { constrainPointTo45, isTempDirectSelectModifier } from "@/editor/path-modifier-keys"
import {
  normalizeBrushPointerSample,
  planArtHistoryStroke,
  resolveBristleTipSimulation,
  resolveColorReplacementPixel,
  resolveErodibleTipSimulation,
  resolveMixerReservoirStep,
  type BrushDynamicsInput,
  type BrushPointerSample,
  type BrushRgba,
  type BrushTipSimulation,
} from "@/editor/brush-engine"
import { planCompositeCache } from "@/editor/performance-engine"
import { planMemoryBudget } from "@/editor/memory-budget"
import { planProgressiveRender } from "@/editor/progressive-renderer"
import { createRafCoalescer, type RafCoalescer } from "@/editor/raf-coalescer"
import { isEmptyDirtyRect } from "@/editor/dirty-rect"
import { planDocumentTileRecomposition } from "@/editor/document/tile-recomposition"
import {
  composeDocumentTile,
  planTileOnlyDefaultCompositor,
  planTileOnlyInteractiveTool,
  renderTileOnlyViewportComposite,
  supportsTileOnlyLayer,
} from "@/editor/tile-only-pipeline"
import {
  compositeDocumentWithWebGL,
  prepareLayerInputForWebGL,
  planWebGLCompositor,
} from "@/editor/webgl-compositor"
import { containsSelectionPoint, createSelectionHitTester, type SelectionHitTester } from "@/editor/selection-hit-testing"
import { addPhotoshopEventListener, dispatchPhotoshopEvent } from "@/editor/events"
import { useFilterOverlayController } from "@/editor/canvas/filter-overlay-controller"
import { useTextEditController } from "@/editor/canvas/text-edit-controller"
import { normalizeAdvancedBlending } from "@/editor/layer-workflows"
import { DEFAULT_PREFERENCES } from "@/editor/preferences-engine"
import { paintCanvasCursorOverlay, resolveCanvasCursorState } from "@/editor/cursor-overlay"
import { buildRetouchingFeedbackModel } from "@/editor/retouch-feedback"
import { emitRuntimeEvent } from "@/editor/runtime-telemetry"
import { getLayerHighBitImage, highBitImageToSelectionSource, renderDocumentHighBitPreviewCanvas, syncHighBitLayerFromCanvasChange } from "@/editor/high-bit-document"
import {
  defaultCanvasRuntimePreferences,
  getDodgeBurnRuntimeOptions,
  getEyedropperSampleSize,
  getFrameRuntimeOptions,
  getMoveRuntimeOptions,
  getShapeRuntimeOptions,
  getSpongeRuntimeOptions,
  layerAllowsDrawing,
  layerAllowsMoving,
  readCanvasRuntimePreferences,
  type CanvasRuntimePreferences,
} from "@/editor/canvas/view-runtime"
import { useCanvasViewportController } from "@/editor/canvas/viewport-controller"
import {
  applyTransformHandleDrag,
  clampTransformSkew,
  finiteOr,
  pickTransformHandle,
  pointInTransformBox,
  type TransformDragState,
  type TransformHandleId,
  type TransformOptionsEvent,
} from "@/editor/canvas/transform-geometry"
import { drawTransformSourcePreview } from "@/editor/canvas/transform-preview"
import {
  cursorForTool,
  labelForTool,
  normalizeViewRotation,
  shapePropsForTool,
  snapViewRotation,
  type DirectShapeHandleId,
} from "@/editor/canvas/shape-helpers"
import { SmartGuidesOverlay, smartSnapLayerDelta } from "@/components/photoshop/canvas/smart-guides"
import { MaskSelectionOverlay, SelectionOverlay, TextEditOverlay } from "@/components/photoshop/canvas/selection-overlays"
import { Rulers } from "@/components/photoshop/canvas/rulers"
import {
  adjustmentParamsFingerprint,
  advancedBlendingFingerprint,
  canvasIdFor,
  invalidateMaskAlphaCache,
  layerStyleCacheKey,
  pathFingerprint,
  smartFilterCacheKey,
} from "@/editor/canvas/compositor-cache"
import {
  applyAdjustmentForCompositorContext,
  applyAdjustmentLayer,
  drawLayer,
  drawLayerForCompositorContext,
  renderLayerSourceForCompositor,
} from "@/editor/canvas/compositor"
import {
  alphaBounds,
  applySelectionClip,
  applySelectionMaskToCanvas,
  autoPickLayer,
  captureSelectionClip,
  createRemoveMask,
  dabTouchesSelection,
  liftSelectionFloat,
  pickTextLayerAt,
  selectBackgroundMaskFromImage,
  translateSelection,
  type SelectionClip,
} from "@/editor/canvas/selection-helpers"
import {
  drawArtboardPreview,
  drawFramePlaceholder,
  drawSlicePreview,
} from "@/editor/canvas/preview-drawing"
import {
  directSelectionTarget,
  editablePathForDirectSelection,
  isVectorEditableLayer,
  pathForDirectEdit,
  pickVectorLayer,
  rerenderVectorLayer as rerenderVectorLayerGeometry,
  replaceDirectEditPath,
  translateVectorLayerGeometry,
  updateDirectSelectionDrag as applyDirectSelectionDrag,
  vectorLayerBounds,
} from "@/editor/canvas/vector-editing"
import {
  TEXT_BOX_DRAG_THRESHOLD,
  drawBrushPreview as drawBrushPreviewOverlay,
  drawGradientPreview as drawGradientPreviewOverlay,
  drawLassoPreview as drawLassoPreviewOverlay,
  drawMarqueePreview as drawMarqueePreviewOverlay,
  drawPatchPreview as drawPatchPreviewOverlay,
  drawPathPreview as drawPathPreviewOverlay,
  drawPathSelectionPreview as drawPathSelectionPreviewOverlay,
  drawPerspectiveCropPreview as drawPerspectiveCropPreviewOverlay,
  drawRulerPreview as drawRulerPreviewOverlay,
  drawSliceSelectionPreview as drawSliceSelectionPreviewOverlay,
  drawTextBoxPreview as drawTextBoxPreviewOverlay,
  drawTransformHandles as drawTransformHandlesOverlay,
} from "@/editor/canvas/overlay-previews"
import {
  applyCanvasBrushColorDynamics,
  applyCanvasBrushShapeDynamics,
  applyCanvasBrushTransfer,
} from "@/editor/canvas/brush-dynamics"
import {
  colorDistance,
  connectedEraserMask,
  localPatchGradient,
} from "@/editor/canvas/eraser-helpers"

import {
  alphaMaskFromCanvas,
  clamp01,
  cloneCanvasForTool,
  hashNoise,
  historySourceCanvas,
  makeCurvaturePath,
  maskBounds,
  mergeDirtyRect,
  pointInMask,
  requiredRgbaFromCss,
  rgbaToCss,
  sampleCanvasColor,
  sortCorners,
} from "@/editor/canvas/view-helpers"
import { cn } from "@/lib/utils"
import {
  healStamp,
  pickHealSource,
  blurStamp,
  sharpenStamp,
  dodgeBurnStamp,
  spongeStamp,
  SmudgeBuffer,
  paintBucketFill,
  polygonToMask,
  polygonBounds,
  rasterizeText,
  rasterizeShape,
  strokePath,
  hexToRgb,
  makeCanvas,
  contentAwareFill,
  patchSelectionFromSource,
  floodFillMask,
  featherMask,
  magneticLassoSnap,
  magneticLassoTrace,
  selectSubjectMask,
  selectSkyMask,
  objectSelectionMask,
  refineEdgeBrushMask,
  selectionFromMask,
  selectionToMaskCanvas,
  transformedCloneStamp,
} from "@/editor/tool/helpers"
import { perspectiveCropImageData } from "@/editor/photo-workflow-engine"
import { hexToRgba } from "@/editor/color/utils"
import { ColorPickerHud, hexToHsv, hsvToHex, pickFromHud, type ColorPickerHudHsv } from "@/components/photoshop/color/picker-hud"
import { MagneticLassoIndicator, GridOverlay, PixelGridOverlay, GuidesOverlay, RetouchFeedbackOverlay } from "@/components/photoshop/canvas/overlays"
import { SelectionTransformOverlay } from "@/components/photoshop/selection-transform-overlay"
import { applyThreeDMaterialDrop } from "@/editor/three-d-video-engine"
import type { Layer, PathPoint, Selection, ToolId } from "@/editor/types"

type BrushInput = BrushDynamicsInput

/** Tools that read the layer while painting into it, so they need a frozen copy. */
const SAMPLING_RETOUCH_TOOLS = new Set<ToolId>([
  "clone-stamp",
  "healing-brush",
  "spot-healing",
])

interface DirtyRect {
  x: number
  y: number
  w: number
  h: number
}

interface MouseMoveDetail {
  x: number
  y: number
  inside: boolean
}

const RETOUCH_FEEDBACK_TOOLS = new Set([
  "brush",
  "pencil",
  "mixer-brush",
  "clone-stamp",
  "healing-brush",
  "spot-healing",
  "patch-tool",
  "smudge",
  "blur",
  "sharpen",
  "dodge",
  "burn",
  "sponge",
  "history-brush",
  "art-history-brush",
])

interface StampOptions {
  includeBrushOpacity?: boolean
  enforceTransparencyLock?: boolean
  drawEraserMask?: boolean
  opacityMultiplier?: number
}

interface StrokeCompositeState {
  target: HTMLCanvasElement
  source: HTMLCanvasElement
  stroke: HTMLCanvasElement
  erasing: boolean
  targetKind?: "smart-filter-mask"
  opacity: number
  flow: number
}

/**
 * One shared probe context for capability detection. Creating a fresh WebGL
 * context per compose() blows past the browser's context limit and evicts the
 * compositor's own contexts.
 */
let sharedGLProbe: WebGLRenderingContext | WebGL2RenderingContext | null | undefined
function getSharedGLProbe() {
  if (sharedGLProbe !== undefined) return sharedGLProbe
  try {
    if (typeof document === "undefined") return (sharedGLProbe = null)
    const probe = document.createElement("canvas")
    sharedGLProbe = probe.getContext("webgl2") || probe.getContext("webgl")
  } catch {
    sharedGLProbe = null
  }
  return sharedGLProbe
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
  const rerenderVectorLayerRef = React.useRef<(layer: Layer) => void>(() => {})
  const drawPathSelectionPreviewRef = React.useRef<(layer: Layer) => void>(() => {})
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

  const cloneSourceRef = React.useRef<{ sourceX: number; sourceY: number; destX?: number; destY?: number; layerId: string } | null>(null)
  const eraserSampleRef = React.useRef<{ r: number; g: number; b: number; a: number } | null>(null)
  const colorReplacementSampleRef = React.useRef<{ r: number; g: number; b: number; a: number } | null>(null)
  const smudgeBufferRef = React.useRef<SmudgeBuffer>(new SmudgeBuffer())
  const transformRef = React.useRef<TransformDragState | null>(null)
  const pathDraftRef = React.useRef<{ points: PathPoint[]; closed: boolean; curvature?: boolean } | null>(null)
  const removeRef = React.useRef<{ points: { x: number; y: number }[] } | null>(null)
  const patchRef = React.useRef<{ mask: HTMLCanvasElement; bounds: { x: number; y: number; w: number; h: number } } | null>(null)
  const strokeDabRef = React.useRef(0)
  const strokeDistRef = React.useRef(0)
  const strokeCompositeRef = React.useRef<StrokeCompositeState | null>(null)
  const lastBrushPointerSampleRef = React.useRef<BrushPointerSample | null>(null)
  const selectionHitTesterRef = React.useRef<SelectionHitTester | null>(null)
  const mouseMoveCoalescerRef = React.useRef<RafCoalescer<MouseMoveDetail> | null>(null)
  const transparencyLockMaskRef = React.useRef<HTMLCanvasElement | null>(null)
  const selectionClipRef = React.useRef<SelectionClip | null>(null)
  const eraserSourceRef = React.useRef<HTMLCanvasElement | null>(null)
  const colorReplacementSourceRef = React.useRef<HTMLCanvasElement | null>(null)
  /**
   * Layer pixels frozen at stroke start for the sampling retouch tools. Cloning
   * and healing read from this rather than the live canvas — reading the canvas
   * they are also writing to made each dab sample the previous dab, so dragging
   * smeared the repair across the stroke instead of repeating the source.
   */
  const retouchSourceRef = React.useRef<HTMLCanvasElement | null>(null)
  const mixerReservoirRef = React.useRef<Required<BrushRgba> | null>(null)
  const highBitStrokeSourceRef = React.useRef<HTMLCanvasElement | null>(null)

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

  const schedulePaintCommit = React.useCallback(
    (label: string, changedLayerIds?: Parameters<typeof commit>[1]) => {
      // commit() now internally defers the expensive snapshot for brush-tool
      // labels via setTimeout(0), so we can call it directly without extra
      // deferral. This keeps the pointer-up handler fast.
      commit(label, changedLayerIds)
    },
    [commit],
  )

  /* ---- composite render ---- */

  // Composite cache: skip full re-composite when layer state hasn't changed
  const compositeCacheRef = React.useRef<{
    fingerprint: string
    drawnFingerprint: string
    width: number
    height: number
    canvas: HTMLCanvasElement | null
  }>({ fingerprint: "", drawnFingerprint: "", width: 0, height: 0, canvas: null })
  const progressiveFrameRef = React.useRef<number | null>(null)
  const progressiveFullPassRef = React.useRef(false)

  const visibleDocumentViewport = React.useCallback((): DirtyRect => {
    if (!activeDoc) return { x: 0, y: 0, w: 1, h: 1 }
    const container = containerRef.current
    const stage = stageRef.current
    if (!container || !stage) return { x: 0, y: 0, w: activeDoc.width, h: activeDoc.height }
    const containerRect = container.getBoundingClientRect()
    const stageRect = stage.getBoundingClientRect()
    if (stageRect.width <= 0 || stageRect.height <= 0) return { x: 0, y: 0, w: activeDoc.width, h: activeDoc.height }
    const x0 = ((containerRect.left - stageRect.left) / stageRect.width) * activeDoc.width
    const y0 = ((containerRect.top - stageRect.top) / stageRect.height) * activeDoc.height
    const x1 = ((containerRect.right - stageRect.left) / stageRect.width) * activeDoc.width
    const y1 = ((containerRect.bottom - stageRect.top) / stageRect.height) * activeDoc.height
    return {
      x: Math.max(0, Math.floor(Math.min(x0, x1))),
      y: Math.max(0, Math.floor(Math.min(y0, y1))),
      w: Math.max(1, Math.min(activeDoc.width, Math.ceil(Math.max(x0, x1))) - Math.max(0, Math.floor(Math.min(x0, x1)))),
      h: Math.max(1, Math.min(activeDoc.height, Math.ceil(Math.max(y0, y1))) - Math.max(0, Math.floor(Math.min(y0, y1)))),
    }
  }, [activeDoc])

  /**
   * Publish the freshly drawn composite as the cache. The canvas does double
   * duty: identity-reuse, and the previous frame that `canUseLayerPartial`
   * paints tiles over. Forced renders (every brush frame) have to keep it for
   * the second job or painting re-composites the whole document every frame —
   * they just publish an empty `fingerprint` so identity-reuse stays off for
   * pixels that mutated without a fingerprint change.
   */
  const storeCompositeCache = React.useCallback(
    (cv: HTMLCanvasElement, fp: string, force: boolean, allowed = true) => {
      const { width, height } = cv
      if (!allowed || !planCompositeCache({ width, height }).storeCache) {
        compositeCacheRef.current = { fingerprint: "", drawnFingerprint: fp, width, height, canvas: null }
        return
      }
      const previous = compositeCacheRef.current.canvas
      const cached = previous?.width === width && previous.height === height ? previous : makeCanvas(width, height)
      const cachedCtx = cached.getContext("2d")!
      cachedCtx.clearRect(0, 0, width, height)
      cachedCtx.drawImage(cv, 0, 0)
      compositeCacheRef.current = { fingerprint: force ? "" : fp, drawnFingerprint: fp, width, height, canvas: cached }
    },
    [],
  )

  const resetCompositeCanvasPlacement = React.useCallback((cv: HTMLCanvasElement) => {
    cv.style.left = "0px"
    cv.style.top = "0px"
    cv.style.right = "0px"
    cv.style.bottom = "0px"
    cv.style.width = "100%"
    cv.style.height = "100%"
  }, [])

  const drawComposite = React.useCallback((force = false, change?: {
    layerIds: "all" | string[]
    reasons: string[]
    dirtyByLayer?: Record<string, DirtyRect[]>
    fullFrame?: boolean
  }) => {
    const cv = compositeRef.current
    if (!cv || !activeDoc) return

    // Forced renders happen when underlying pixels mutated without a fingerprint
    // change (brush strokes on canvases or masks). Drop the mask alpha cache so
    // freshly-painted mask pixels propagate through adjustment compositing.
    if (force) invalidateMaskAlphaCache()

    // Build a lightweight fingerprint of the composite inputs.
    // Mutable pixel edits are rendered through requestRender(), which passes
    // force=true and bypasses this identity cache.
    let fp = `x||`
    for (const layer of activeDoc.layers) {
      if (!layer.visible) { fp += `H|`; continue }
      if (layer.kind === "group") continue
      const canvasId = canvasIdFor(layer.canvas)
      const maskId = layer.mask ? canvasIdFor(layer.mask) : ""
      const vectorMaskFp = pathFingerprint(layer.vectorMask)
      const adjFp = layer.adjustment ? `${layer.adjustment.type}:${adjustmentParamsFingerprint(layer.adjustment.params)}` : ""
      const styleFp = layer.style ? layerStyleCacheKey(layer.style) : ""
      const smartFilterFp = layer.smartFilters ? smartFilterCacheKey(layer.smartFilters) : ""
      const advancedFp = advancedBlendingFingerprint(layer.advancedBlending)
      const previewCanvas = filterPreviews[layer.id]
      const previewId = previewCanvas ? canvasIdFor(previewCanvas) : ""
      fp +=
        `${layer.id}:${layer.kind ?? "raster"}:${canvasId}:${maskId}:${vectorMaskFp}:` +
        `${layer.maskEnabled === false ? 0 : 1}:${layer.opacity}:${layer.fillOpacity ?? 1}:` +
        `${layer.blendMode}:${layer.clipped ? 1 : 0}:${advancedFp}:${adjFp}:${styleFp}:${smartFilterFp}:${previewId}|`
    }

    const dirtyRects = change?.dirtyByLayer ? Object.values(change.dirtyByLayer).flatMap((rects) => rects) : undefined
    const defaultTilePlan = planTileOnlyDefaultCompositor({
      documentWidth: activeDoc.width,
      documentHeight: activeDoc.height,
      tileSize: 512,
      viewport: visibleDocumentViewport(),
      prefetchPadding: 0,
      dirtyRects,
      layers: activeDoc.layers,
      explicitTileOnly: !!activeDoc.metadata?.largeDocumentTileView,
      colorMode: activeDoc.colorMode,
      bitDepth: activeDoc.bitDepth,
      quickMask: activeDoc.quickMask,
      filterPreviewCount: Object.keys(filterPreviews).length,
    })
    if (defaultTilePlan.strategy === "tile-local") {
      const rendered = renderTileOnlyViewportComposite(activeDoc, defaultTilePlan, {
        transparent: false,
        matte: activeDoc.background,
      })
      const rect = rendered.viewportUnion.w > 0 && rendered.viewportUnion.h > 0
        ? rendered.viewportUnion
        : defaultTilePlan.viewportPlan.viewport
      if (cv.width !== rect.w) cv.width = rect.w
      if (cv.height !== rect.h) cv.height = rect.h
      cv.style.left = `${rect.x * viewZoom}px`
      cv.style.top = `${rect.y * viewZoom}px`
      cv.style.right = "auto"
      cv.style.bottom = "auto"
      cv.style.width = `${rect.w * viewZoom}px`
      cv.style.height = `${rect.h * viewZoom}px`
      const ctx = cv.getContext("2d")!
      ctx.clearRect(0, 0, cv.width, cv.height)
      for (const tile of rendered.tiles) {
        ctx.drawImage(tile.canvas, tile.rect.x - rect.x, tile.rect.y - rect.y)
      }
      compositeCacheRef.current = { fingerprint: "", drawnFingerprint: fp, width: cv.width, height: cv.height, canvas: null }
      return
    }

    resetCompositeCanvasPlacement(cv)
    if (cv.width !== activeDoc.width) cv.width = activeDoc.width
    if (cv.height !== activeDoc.height) cv.height = activeDoc.height

    const cache = compositeCacheRef.current
    if (!force && cache.drawnFingerprint === fp && cache.width === cv.width && cache.height === cv.height) {
      return
    }
    if (!force && cache.fingerprint === fp && cache.canvas) {
      const ctx = cv.getContext("2d")!
      ctx.clearRect(0, 0, cv.width, cv.height)
      ctx.drawImage(cache.canvas, 0, 0)
      cache.drawnFingerprint = fp
      cache.width = cv.width
      cache.height = cv.height
      return
    }

    const ctx = cv.getContext("2d")!

    if (
      activeDoc.bitDepth > 8 &&
      !activeDoc.quickMask &&
      Object.keys(filterPreviews).length === 0
    ) {
      const highBit = renderDocumentHighBitPreviewCanvas(activeDoc)
      if (highBit) {
        ctx.clearRect(0, 0, cv.width, cv.height)
        ctx.drawImage(highBit.canvas, 0, 0)
        const colorManaged = applyModeAndColorManagement(cv, activeDoc)
        if (colorManaged !== cv) {
          ctx.clearRect(0, 0, cv.width, cv.height)
          ctx.drawImage(colorManaged, 0, 0)
        }
        storeCompositeCache(cv, fp, force)
        return
      }
    }

    const canUseLayerPartial =
      force &&
      change &&
      !change.fullFrame &&
      change.dirtyByLayer &&
      Object.keys(change.dirtyByLayer).length > 0 &&
      cache.canvas &&
      activeDoc.colorMode === "RGB" &&
      !activeDoc.quickMask &&
      Object.keys(filterPreviews).length === 0

    if (canUseLayerPartial) {
      const dirtyPlan = planDocumentTileRecomposition(activeDoc, {
        dirtyByLayer: change.dirtyByLayer!,
        tileSize: 512,
      })
      // Trust the planner's own verdict rather than demanding zero reasons.
      // It already returns "full-frame" for the three things composeDocumentTile
      // cannot express (effects, knockout, colour management); the reasons it
      // still lets through — masks, adjustments, clipping, smart objects, text,
      // vector — all have tile paths. Requiring reasons.length === 0 put every
      // document carrying an adjustment layer back on the full-composite path
      // for every painted frame. The remaining guard is that no visible layer
      // is of a kind composeDocumentTile would silently skip.
      if (
        dirtyPlan.strategy === "tile-isolated" &&
        activeDoc.layers.every((layer) => !layer.visible || layer.kind === "group" || supportsTileOnlyLayer(layer)) &&
        !isEmptyDirtyRect(dirtyPlan.compositeRect)
      ) {
        const rect = dirtyPlan.compositeRect
        for (const tile of dirtyPlan.tiles) {
          const tileCanvas = composeDocumentTile(activeDoc, {
            ...tile.rect,
            transparent: true,
          })
          ctx.clearRect(tile.rect.x, tile.rect.y, tile.rect.w, tile.rect.h)
          ctx.drawImage(tileCanvas, tile.rect.x, tile.rect.y)
        }
        cache.canvas!.getContext("2d")!.drawImage(cv, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h)
        cache.drawnFingerprint = fp
        cache.width = cv.width
        cache.height = cv.height
        return
      }
    }

    const progressivePlan = planProgressiveRender({
      width: cv.width,
      height: cv.height,
      tileSize: 512,
    })
    if (
      force &&
      cache.canvas &&
      progressivePlan.mode === "preview-then-full" &&
      !progressiveFullPassRef.current
    ) {
      ctx.clearRect(0, 0, cv.width, cv.height)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "low"
      ctx.drawImage(cache.canvas, 0, 0)
      if (progressiveFrameRef.current !== null) cancelAnimationFrame(progressiveFrameRef.current)
      progressiveFrameRef.current = requestAnimationFrame(() => {
        progressiveFrameRef.current = null
        progressiveFullPassRef.current = true
        drawComposite(true, change)
        progressiveFullPassRef.current = false
      })
      return
    }

    const glProbe = getSharedGLProbe()
    const webglPlan = planWebGLCompositor({
      width: cv.width,
      height: cv.height,
      layerCount: activeDoc.layers.length,
      preferWebGL: true,
      webglAvailable: !!glProbe,
      maxTextureSize: glProbe ? Number(glProbe.getParameter(glProbe.MAX_TEXTURE_SIZE)) || undefined : undefined,
    })
    if (
      webglPlan.path !== "canvas-2d" &&
      activeDoc.colorMode === "RGB"
    ) {
      const glCanvas = document.createElement("canvas")
      glCanvas.addEventListener("webglcontextlost", () => {
        emitRuntimeEvent("webgl-context-loss", {
          component: "canvas-compositor",
          fallback: "canvas-2d",
          recoverable: true,
        })
      }, { once: true })
      glCanvas.width = cv.width
      glCanvas.height = cv.height
      const result = compositeDocumentWithWebGL(glCanvas, activeDoc.layers, {
        width: cv.width,
        height: cv.height,
        webglAvailable: true,
        maxTextureSize: webglPlan.maxTextureSize,
        tileSize: webglPlan.tileSize,
        filterPreviews,
        prepareLayer: (layer, webglContext) => {
          const rendered = renderLayerSourceForCompositor(layer, webglContext.filterPreviewCanvas)
          return prepareLayerInputForWebGL(layer, webglContext, {
            source: rendered.canvas,
            fillOpacity: rendered.fillOpacity,
          })
        },
        drawCpuLayer: (cpuCtx, layer, webglContext) => {
          drawLayerForCompositorContext(cpuCtx, layer, webglContext)
        },
        applyCpuAdjustment: (cpuCtx, layer, webglContext) => {
          applyAdjustmentForCompositorContext(cpuCtx, layer, webglContext)
        },
      })
      if (result.completed) {
        ctx.clearRect(0, 0, cv.width, cv.height)
        ctx.drawImage(glCanvas, 0, 0)
        const colorManaged = applyModeAndColorManagement(cv, activeDoc)
        if (colorManaged !== cv) {
          ctx.clearRect(0, 0, cv.width, cv.height)
          ctx.drawImage(colorManaged, 0, 0)
        }
        if (activeDoc.quickMask && activeDoc.quickMaskCanvas) {
          ctx.save()
          const tmp = makeCanvas(activeDoc.width, activeDoc.height)
          const tctx = tmp.getContext("2d")!
          tctx.fillStyle = "rgba(255,0,0,0.5)"
          tctx.fillRect(0, 0, activeDoc.width, activeDoc.height)
          tctx.globalCompositeOperation = "destination-in"
          tctx.drawImage(activeDoc.quickMaskCanvas, 0, 0)
          ctx.drawImage(tmp, 0, 0)
          ctx.restore()
        }
        storeCompositeCache(cv, fp, force)
        return
      }
    }

    ctx.clearRect(0, 0, cv.width, cv.height)
    // Running fingerprint of all layers composited so far. Adjustment layers use
    // this to decide whether they can reuse a cached filter output.
    let prefixFp = ""
    const shallowKnockoutBackdrops = new Map<string, HTMLCanvasElement>()
    // Both backdrops are document-sized snapshots — an allocation plus a full
    // copy per frame. Skip them entirely unless a layer will actually read one.
    const knockoutModes = new Set(
      activeDoc.layers.map((l) => normalizeAdvancedBlending(l.advancedBlending).knockout),
    )
    const usesShallowKnockout = knockoutModes.has("shallow")
    // Deep knockout punches all the way through to the document base layer (the
    // locked "Background" layer if present, otherwise transparency). Compute it
    // up-front so every deep-knockout layer reveals the same backdrop regardless
    // of its parent group.
    let deepKnockoutBackdrop: HTMLCanvasElement | null = null
    const baseLayer = !knockoutModes.has("deep") ? undefined : activeDoc.layers.find(
      (l) =>
        l.visible &&
        l.kind !== "group" &&
        l.kind !== "adjustment" &&
        (l.locked || l.lockAll) &&
        typeof l.canvas.getContext === "function" &&
        /^background$/i.test(l.name ?? ""),
    )
    if (baseLayer) {
      const baseSnapshot = makeCanvas(cv.width, cv.height)
      baseSnapshot.getContext("2d")!.drawImage(baseLayer.canvas, 0, 0)
      deepKnockoutBackdrop = baseSnapshot
    }
    for (const layer of activeDoc.layers) {
      if (!layer.visible) continue
      if (layer.kind === "group") continue
      if (typeof layer.canvas.getContext !== "function") continue
      const groupKey = layer.parentId ?? "__root__"
      if (usesShallowKnockout && !shallowKnockoutBackdrops.has(groupKey)) {
        const snapshot = makeCanvas(cv.width, cv.height)
        snapshot.getContext("2d")!.drawImage(cv, 0, 0)
        shallowKnockoutBackdrops.set(groupKey, snapshot)
      }
      let clipMask: HTMLCanvasElement | null = null
      if (layer.clipped) {
        const idx = activeDoc.layers.indexOf(layer)
        for (let j = idx - 1; j >= 0; j--) {
          if (!activeDoc.layers[j].clipped) {
            clipMask = activeDoc.layers[j].canvas
            break
          }
        }
      }
      if (layer.kind === "adjustment" && layer.adjustment) {
        applyAdjustmentLayer(ctx, layer, activeDoc.width, activeDoc.height, clipMask, prefixFp)
      } else {
        const advanced = normalizeAdvancedBlending(layer.advancedBlending)
        const knockoutBackdrop =
          advanced.knockout === "shallow"
            ? shallowKnockoutBackdrops.get(groupKey) ?? null
            : advanced.knockout === "deep"
              ? deepKnockoutBackdrop
              : null
        drawLayer(ctx, layer, clipMask, filterPreviews[layer.id], knockoutBackdrop)
      }
      // Extend prefix fingerprint with this layer's contribution so the next
      // adjustment can key its cache on what came before it.
      const canvasId = canvasIdFor(layer.canvas)
      const maskId = layer.mask ? canvasIdFor(layer.mask) : ""
      const vectorMaskFp = pathFingerprint(layer.vectorMask)
      const clipId = clipMask ? canvasIdFor(clipMask) : ""
      const adjFpPrefix = layer.adjustment ? `${layer.adjustment.type}:${adjustmentParamsFingerprint(layer.adjustment.params)}` : ""
      const smartFilterFp = layer.smartFilters ? smartFilterCacheKey(layer.smartFilters) : ""
      const advancedFpPrefix = advancedBlendingFingerprint(layer.advancedBlending)
      const previewCanvasPrefix = filterPreviews[layer.id]
      const previewIdPrefix = previewCanvasPrefix ? canvasIdFor(previewCanvasPrefix) : ""
      prefixFp +=
        `${layer.id}:${layer.kind ?? "raster"}:${canvasId}:${maskId}:${vectorMaskFp}:${clipId}:` +
        `${layer.maskEnabled === false ? 0 : 1}:${layer.opacity}:${layer.fillOpacity ?? 1}:` +
        `${layer.blendMode}:${layer.clipped ? 1 : 0}:${advancedFpPrefix}:${adjFpPrefix}:${layer.style ? "S" : ""}:${smartFilterFp}:${previewIdPrefix}|`
    }

    const colorManaged = applyModeAndColorManagement(cv, activeDoc)
    if (colorManaged !== cv) {
      ctx.clearRect(0, 0, cv.width, cv.height)
      ctx.drawImage(colorManaged, 0, 0)
    }

    if (activeDoc.quickMask && activeDoc.quickMaskCanvas) {
      ctx.save()
      const tmp = makeCanvas(activeDoc.width, activeDoc.height)
      const tctx = tmp.getContext("2d")!
      tctx.fillStyle = "rgba(255,0,0,0.5)"
      tctx.fillRect(0, 0, activeDoc.width, activeDoc.height)
      tctx.globalCompositeOperation = "destination-in"
      tctx.drawImage(activeDoc.quickMaskCanvas, 0, 0)
      ctx.drawImage(tmp, 0, 0)
      ctx.restore()
    }

    const memoryPlan = planMemoryBudget({
      width: cv.width,
      height: cv.height,
      layerCount: activeDoc.layers.length,
      historyStates: 12,
      memoryBudgetMB: 1024,
    })
    storeCompositeCache(cv, fp, force, !memoryPlan.actions.includes("disable-composite-cache"))
  }, [activeDoc, filterPreviews, resetCompositeCanvasPlacement, storeCompositeCache, viewZoom, visibleDocumentViewport])

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

  React.useEffect(() => {
    return () => {
      if (progressiveFrameRef.current !== null) cancelAnimationFrame(progressiveFrameRef.current)
    }
  }, [])

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

  const pointerBrushInput = React.useCallback((e: React.PointerEvent<HTMLDivElement>, point: { x: number; y: number }) => {
    const sample = normalizeBrushPointerSample(e, point, lastBrushPointerSampleRef.current)
    lastBrushPointerSampleRef.current = sample
    return {
      pressure: sample.pressure,
      tiltX: sample.tiltX,
      tiltY: sample.tiltY,
      twist: sample.twist,
      velocity: sample.velocity ?? 0,
    }
  }, [])

  /* ---- selection mask helper ---- */
  function withinSelection(p: { x: number; y: number }): boolean {
    if (!activeDoc) return true
    return selectionHitTesterRef.current?.contains(p) ?? containsSelectionPoint(activeDoc.width, activeDoc.height, activeDoc.selection, p)
  }

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

  function snapMagneticPoint(pt: { x: number; y: number }) {
    if (!activeLayer || typeof activeLayer.canvas.getContext !== "function") return pt
    return magneticLassoSnap(activeLayer.canvas, pt.x, pt.y, {
      searchWidth: Math.max(4, Math.min(64, (selectionOptions.magneticWidth ?? Math.round(selectionOptions.tolerance / 3)) || 12)),
      contrastThreshold: Math.max(0.01, Math.min(512, selectionOptions.magneticContrast ?? selectionOptions.tolerance ?? 24)),
      hysteresisRatio: Math.max(0.1, Math.min(0.95, (selectionOptions.magneticHysteresis ?? 45) / 100)),
    })
  }

  function magneticAnchorInterval() {
    const frequency = Math.max(0, Math.min(100, selectionOptions.magneticFrequency ?? 57))
    if (frequency <= 0) return Number.POSITIVE_INFINITY
    return Math.max(6, Math.round(104 - frequency * 0.88))
  }

  function selectionTraceSourceForLayer(fallback: HTMLCanvasElement) {
    if (!activeDoc || selectionOptions.sampleAllLayers || !activeLayer) return fallback
    const highBit = getLayerHighBitImage(activeLayer, activeDoc)
    return highBit ? highBitImageToSelectionSource(highBit) : fallback
  }

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

  /* ---- brush stroke (raster-painting tools) ---- */

  function activeSmartFilterMaskCanvas(): HTMLCanvasElement | null {
    if (!activeDoc || !activeSmartFilterMaskTarget) return null
    if (activeLayer?.id !== activeSmartFilterMaskTarget.layerId) return null
    if (!layerAllowsDrawing(activeLayer)) return null
    const filter = activeLayer.smartFilters?.find((candidate) => candidate.id === activeSmartFilterMaskTarget.filterId)
    if (!filter || filter.maskEnabled === false || !filter.mask) return null
    return filter.mask
  }

  function getActiveCtx(): { ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement; targetKind?: "smart-filter-mask" } | null {
    if (activeDoc?.quickMask && activeDoc.quickMaskCanvas) {
      const cv = activeDoc.quickMaskCanvas
      return { ctx: cv.getContext("2d")!, canvas: cv }
    }
    const smartFilterMask = activeSmartFilterMaskCanvas()
    if (smartFilterMask) {
      const ctx = smartFilterMask.getContext("2d")
      return ctx ? { ctx, canvas: smartFilterMask, targetKind: "smart-filter-mask" } : null
    }
    if (!layerAllowsDrawing(activeLayer)) return null
    if (activeLayer.kind === "adjustment") {
      if (activeLayer.maskEnabled === false || !activeLayer.mask) return null
      const ctx = activeLayer.mask.getContext("2d")
      return ctx ? { ctx, canvas: activeLayer.mask } : null
    }
    if (typeof activeLayer.canvas.getContext !== "function") return null
    return { ctx: activeLayer.canvas.getContext("2d")!, canvas: activeLayer.canvas }
  }

  function prepareTransparencyLockMask() {
    transparencyLockMaskRef.current = null
    if (!activeDoc || activeDoc.quickMask || activeSmartFilterMaskCanvas() || !activeLayer?.lockTransparency) return
    if (typeof activeLayer.canvas.getContext !== "function") return
    const mask = makeCanvas(activeLayer.canvas.width, activeLayer.canvas.height)
    mask.getContext("2d")!.drawImage(activeLayer.canvas, 0, 0)
    transparencyLockMaskRef.current = mask
  }

  function enforceTransparencyLock(ctx: CanvasRenderingContext2D) {
    const mask = transparencyLockMaskRef.current
    if (!mask || activeDoc?.quickMask) return
    ctx.save()
    ctx.globalCompositeOperation = "destination-in"
    ctx.drawImage(mask, 0, 0)
    ctx.restore()
  }

  function isStrokeBufferedPaintTool() {
    return (
      tool === "brush" ||
      tool === "eraser"
    )
  }

  function isEraserPaintTool() {
    return tool === "eraser" || tool === "background-eraser" || tool === "magic-eraser"
  }

  function quickMaskPaintsSubtract() {
    if (!activeDoc?.quickMask) return false
    const mode = activeDoc.quickMaskPaintMode ?? "auto"
    if (mode === "subtract") return true
    if (mode === "add") return false
    return isEraserPaintTool()
  }

  function beginBufferedStroke(target: HTMLCanvasElement, targetKind?: "smart-filter-mask") {
    if (!isStrokeBufferedPaintTool()) return
    const source = makeCanvas(target.width, target.height)
    source.getContext("2d")!.drawImage(target, 0, 0)
    strokeCompositeRef.current = {
      target,
      source,
      stroke: makeCanvas(target.width, target.height),
      erasing: activeDoc?.quickMask ? quickMaskPaintsSubtract() : targetKind === "smart-filter-mask" ? false : isEraserPaintTool(),
      targetKind,
      opacity: clamp01(brush.opacity / 100),
      flow: clamp01(brush.flow / 100),
    }
  }

  function restoreBufferedStrokeSource(state: StrokeCompositeState, rect?: DirtyRect) {
    const ctx = state.target.getContext("2d")!
    if (rect) {
      ctx.clearRect(rect.x, rect.y, rect.w, rect.h)
      ctx.drawImage(state.source, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h)
      return ctx
    }
    ctx.clearRect(0, 0, state.target.width, state.target.height)
    ctx.drawImage(state.source, 0, 0)
    return ctx
  }

  function renderBufferedStroke() {
    const state = strokeCompositeRef.current
    if (!state) return false
    // Only the area painted since the last frame: re-flattening the whole
    // stroke every frame is what made long strokes crawl.
    const dirty = drawingRef.current.type === "stroke" ? drawingRef.current.frameDirty : undefined
    const ctx = restoreBufferedStrokeSource(state, dirty)
    ctx.save()
    ctx.globalAlpha = clamp01(state.opacity * state.flow)
    ctx.globalCompositeOperation = state.erasing ? "destination-out" : "source-over"
    if (dirty) {
      ctx.drawImage(state.stroke, dirty.x, dirty.y, dirty.w, dirty.h, dirty.x, dirty.y, dirty.w, dirty.h)
    } else {
      ctx.drawImage(state.stroke, 0, 0)
    }
    ctx.restore()
    enforceTransparencyLock(ctx)
    requestTileAwareStrokeRender()
    return true
  }

  function cancelBufferedStroke() {
    const state = strokeCompositeRef.current
    if (!state) return
    restoreBufferedStrokeSource(state)
    strokeCompositeRef.current = null
    requestRender()
  }

  function finishBufferedStroke() {
    renderBufferedStroke()
    strokeCompositeRef.current = null
  }

  function stamp(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    input: BrushInput,
    options: StampOptions = {},
  ) {
    if (!dabTouchesSelection(activeDoc, x, y, brush.size)) return
    const { dabSize, dabAngle, dabRoundness, tipState } = applyCanvasBrushShapeDynamics(brush, input)
    const { opaMul, flowMul } = applyCanvasBrushTransfer(brush, input)
    const isBuffered = options.includeBrushOpacity === false
    // When painting to the stroke buffer, stamp at full alpha so overlapping
    // dabs don't accumulate and show individual circles.  The combined
    // opacity × flow is applied once in renderBufferedStroke() instead.
    const opacity = isBuffered ? 1 : clamp01((brush.opacity / 100) * (brush.flow / 100) * opaMul * flowMul * (options.opacityMultiplier ?? 1))
    const isErase = tool === "eraser" || tool === "background-eraser" || tool === "magic-eraser"
    const compositeAsErase = activeDoc?.quickMask ? quickMaskPaintsSubtract() : isErase && !options.drawEraserMask
    const dabColor = isErase && options.drawEraserMask ? "#000000" : activeDoc?.quickMask ? "#ffffff" : applyCanvasBrushColorDynamics(brush, color, background)
    if (tool === "pattern-stamp") {
      drawPatternStampDab(ctx, x, y, dabSize, dabAngle, dabRoundness, opacity)
      if (options.enforceTransparencyLock !== false) enforceTransparencyLock(ctx)
      return
    }
    if (tool === "color-replace") {
      colorReplacementStamp(ctx, x, y, dabSize, input, opacity)
      if (options.enforceTransparencyLock !== false) enforceTransparencyLock(ctx)
      return
    }
    if (canUseFastBrushDab()) {
      drawFastBrushDab(ctx, x, y, dabSize, dabAngle, dabRoundness, dabColor, opacity, compositeAsErase)
      if (options.enforceTransparencyLock !== false) enforceTransparencyLock(ctx)
      return
    }
    const dab = createBrushDab(dabSize, dabRoundness, dabColor, opacity, x, y, tipState)
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(dabAngle)
    ctx.globalCompositeOperation = compositeAsErase ? "destination-out" : "source-over"
    if (tool === "pencil") ctx.imageSmoothingEnabled = false
    ctx.drawImage(dab, -dab.width / 2, -dab.height / 2)
    ctx.restore()
    if (options.enforceTransparencyLock !== false) enforceTransparencyLock(ctx)
  }

  function canUseFastBrushDab() {
    const tip = brush.tipShape ?? "round"
    return (
      (tip === "round" || tip === "square") &&
      !brush.texture?.enabled &&
      !brush.dualBrush?.enabled &&
      !brush.wetEdges &&
      !brush.noise
    )
  }

  function drawPatternStampDab(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    dabSize: number,
    dabAngle: number,
    dabRoundness: number,
    opacity: number,
  ) {
    const r = dabSize / 2
    const pattern = activeDoc?.patternLibrary?.[0]?.type ?? brush.texture?.pattern ?? "checker"
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(dabAngle)
    ctx.scale(1, dabRoundness)
    ctx.beginPath()
    if ((brush.tipShape ?? "round") === "square") ctx.rect(-r, -r, r * 2, r * 2)
    else ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.clip()
    ctx.globalAlpha = opacity
    const tile = makeCanvas(32, 32)
    const tctx = tile.getContext("2d")!
    tctx.fillStyle = foreground
    tctx.fillRect(0, 0, 32, 32)
    tctx.fillStyle = background
    if (pattern === "dots" || pattern === "paper") {
      for (let py = 4; py < 32; py += 8) {
        for (let px = 4; px < 32; px += 8) {
          tctx.beginPath()
          tctx.arc(px, py, 2.2, 0, Math.PI * 2)
          tctx.fill()
        }
      }
    } else if (pattern === "lines" || pattern === "linen") {
      tctx.lineWidth = 3
      tctx.strokeStyle = background
      for (let offset = -32; offset < 64; offset += 10) {
        tctx.beginPath()
        tctx.moveTo(offset, 32)
        tctx.lineTo(offset + 32, 0)
        tctx.stroke()
      }
    } else if (pattern === "noise") {
      const img = tctx.getImageData(0, 0, 32, 32)
      for (let i = 0; i < img.data.length; i += 4) {
        const n = hashNoise(i, x + y, 17) > 0.5
        const c = n ? hexToRgb(foreground) : hexToRgb(background)
        img.data[i] = c.r
        img.data[i + 1] = c.g
        img.data[i + 2] = c.b
      }
      tctx.putImageData(img, 0, 0)
    } else {
      tctx.fillRect(0, 0, 16, 16)
      tctx.fillRect(16, 16, 16, 16)
    }
    const fill = ctx.createPattern(tile, "repeat")
    if (fill) {
      ctx.fillStyle = fill
      ctx.translate(-x, -y)
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    ctx.restore()
  }

  function isPlainContinuousPaintStroke() {
    const tip = brush.tipShape ?? "round"
    const paintTool =
      tool === "brush" ||
      tool === "mixer-brush" ||
      tool === "pattern-stamp" ||
      tool === "eraser" ||
      tool === "color-replace" ||
      tool === "background-eraser" ||
      tool === "magic-eraser"
    return (
      paintTool &&
      (tip === "round" || tip === "square") &&
      (brush.scatter ?? 0) <= 0 &&
      (brush.scatterCount ?? 1) <= 1 &&
      (brush.scatterCountJitter ?? 0) <= 0 &&
      !brush.texture?.enabled &&
      !brush.dualBrush?.enabled &&
      !brush.wetEdges &&
      !brush.noise &&
      (brush.sizeControl ?? "off") === "off" &&
      (brush.angleControl ?? "off") === "off" &&
      (brush.roundnessControl ?? "off") === "off" &&
      (brush.sizeJitter ?? 0) <= 0 &&
      (brush.angleJitter ?? 0) <= 0 &&
      (brush.roundnessJitter ?? 0) <= 0
    )
  }

  function effectiveBrushSpacing() {
    const configured = Math.max(1, brush.size * (brush.spacing ?? 25) / 100)
    if (!isPlainContinuousPaintStroke()) return configured
    return Math.max(1, Math.min(configured, brush.size * 0.035))
  }

  function drawFastBrushDab(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    dabSize: number,
    dabAngle: number,
    dabRoundness: number,
    color: string,
    opacity: number,
    isErase: boolean,
  ) {
    const r = dabSize / 2
    const tip = brush.tipShape ?? "round"
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(dabAngle)
    ctx.scale(1, dabRoundness)
    ctx.globalCompositeOperation = isErase ? "destination-out" : "source-over"
    ctx.globalAlpha = tool === "pencil" ? 1 : opacity
    if (tip === "square") {
      ctx.fillStyle = color
      ctx.fillRect(-r, -r, r * 2, r * 2)
    } else if (tool === "pencil") {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.fill()
    } else {
      const hardness = clamp01(brush.hardness / 100)
      if (hardness >= 0.99) {
        // Solid circle at full hardness — no gradient needed
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, Math.PI * 2)
        ctx.fill()
      } else {
        const hardR = r * hardness
        const grad = ctx.createRadialGradient(0, 0, hardR, 0, 0, r)
        grad.addColorStop(0, color)
        grad.addColorStop(1, hexToRgba(color, 0))
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  const stampSymmetric = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    w: number,
    h: number,
    input: BrushInput,
    options?: StampOptions,
  ) => {
    stamp(ctx, x, y, color, input, options)
    if (!symmetry.enabled) return
    const cx = w / 2, cy = h / 2
    if (symmetry.axis === "vertical" || symmetry.axis === "both") {
      stamp(ctx, w - x, y, color, input, options)
    }
    if (symmetry.axis === "horizontal" || symmetry.axis === "both") {
      stamp(ctx, x, h - y, color, input, options)
    }
    if (symmetry.axis === "both") {
      stamp(ctx, w - x, h - y, color, input, options)
    }
    if (symmetry.axis === "diagonal") {
      // Reflect across both diagonals
      const dx = x - cx, dy = y - cy
      stamp(ctx, cx + dy, cy + dx, color, input, options)
      stamp(ctx, cx - dy, cy - dx, color, input, options)
      stamp(ctx, cx - dx, cy - dy, color, input, options)
    }
    if (symmetry.axis === "radial" || symmetry.axis === "mandala") {
      const n = symmetry.segments ?? 6
      const dx = x - cx, dy = y - cy
      for (let i = 1; i < n; i++) {
        const angle = (2 * Math.PI * i) / n
        const cos = Math.cos(angle), sin = Math.sin(angle)
        stamp(ctx, cx + dx * cos - dy * sin, cy + dx * sin + dy * cos, color, input, options)
      }
      if (symmetry.axis === "mandala") {
        // Mirror each rotated point across the vertical axis
        for (let i = 0; i < n; i++) {
          const angle = (2 * Math.PI * i) / n
          const cos = Math.cos(angle), sin = Math.sin(angle)
          const rx = cx + dx * cos - dy * sin
          stamp(ctx, w - rx, cy + dx * sin + dy * cos, color, input, options)
        }
      }
    }
    if (symmetry.axis === "spiral") {
      const n = symmetry.segments ?? 4
      const dx = x - cx, dy = y - cy
      for (let i = 1; i < n; i++) {
        const angle = (2 * Math.PI * i) / n
        const scale = 1 - (i * 0.15) // shrink each subsequent copy slightly
        const cos = Math.cos(angle), sin = Math.sin(angle)
        stamp(ctx, cx + (dx * cos - dy * sin) * scale, cy + (dx * sin + dy * cos) * scale, color, input, options)
      }
    }
    if (symmetry.axis === "parallel") {
      const n = symmetry.segments ?? 5
      const spacing = symmetry.parallelSpacing ?? Math.max(12, brush.size * 2)
      const normal = input.strokeAngle + Math.PI / 2
      const half = Math.floor(n / 2)
      for (let i = -half; i <= half; i++) {
        if (i === 0) continue
        stamp(ctx, x + Math.cos(normal) * spacing * i, y + Math.sin(normal) * spacing * i, color, input, options)
      }
    }
    if (symmetry.axis === "wavy") {
      const n = symmetry.segments ?? 5
      const amp = symmetry.waveAmplitude ?? Math.max(10, brush.size)
      const freq = symmetry.waveFrequency ?? 3
      const phase = (x / Math.max(1, w)) * Math.PI * 2 * freq
      for (let i = 1; i < n; i++) {
        const offset = Math.sin(phase + (i * Math.PI * 2) / n) * amp
        const spread = (i - (n - 1) / 2) * amp * 0.45
        stamp(ctx, x + spread, y + offset, color, input, options)
      }
    }
    if (symmetry.axis === "circle") {
      const n = symmetry.segments ?? 8
      const dx = x - cx, dy = y - cy
      const radius = Math.hypot(dx, dy)
      const base = Math.atan2(dy, dx)
      for (let i = 1; i < n; i++) {
        const a = base + (Math.PI * 2 * i) / n
        stamp(ctx, cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, color, input, options)
      }
    }
  }

  /* ----------- brush dab base shape cache ----------- */
  const _dabShapeCacheRef = React.useRef<{
    key: string
    canvas: HTMLCanvasElement
    side: number
  } | null>(null)

  function dabShapeCacheKey(dabSize: number, roundness: number, color: string) {
    const hardness = tool === "pencil" ? 1 : clamp01(brush.hardness / 100)
    const shape = brush.tipShape ?? "round"
    return `${Math.round(dabSize * 10)}:${Math.round(roundness * 100)}:${Math.round(hardness * 100)}:${shape}:${color}`
  }

  function createBrushDab(
    dabSize: number,
    roundness: number,
    color: string,
    opacity: number,
    docX: number,
    docY: number,
    tipState?: BrushTipSimulation,
  ) {
    const pad = 6
    const side = Math.max(4, Math.ceil(dabSize + pad * 2))
    const c = makeCanvas(side, side)
    const dctx = c.getContext("2d")!
    const cx = side / 2
    const cy = side / 2
    const r = dabSize / 2
    const hardness = tool === "pencil" ? 1 : clamp01(brush.hardness / 100)
    const shape = brush.tipShape ?? "round"

    // For round/square shapes (position-independent), use cached base shape
    const isCacheable = shape === "round" || shape === "square"
    const shapeKey = isCacheable ? dabShapeCacheKey(dabSize, roundness, color) : ""
    const cachedShape = isCacheable ? _dabShapeCacheRef.current : null

    if (isCacheable && cachedShape && cachedShape.key === shapeKey && cachedShape.side === side) {
      // Clone from cache — much faster than redrawing gradients/arcs
      dctx.drawImage(cachedShape.canvas, 0, 0)
    } else {
      dctx.save()
      dctx.translate(cx, cy)
      dctx.scale(1, roundness)
      if (shape === "square") {
        if (hardness < 1 && tool !== "pencil") {
          dctx.shadowColor = color
          dctx.shadowBlur = Math.max(1, r * (1 - hardness))
        }
        dctx.fillStyle = color
        dctx.fillRect(-r, -r, r * 2, r * 2)
      } else if (shape === "bristle") {
        dctx.strokeStyle = color
        dctx.lineCap = "round"
        const resolved = tipState?.kind === "bristle"
          ? tipState
          : resolveBristleTipSimulation(
            brush,
            { pressure: 1, tiltX: 0, tiltY: 0, twist: 0, velocity: 0, fade: 0, strokeAngle: 0 },
            { seed: Math.max(1, Math.round(docX * 17 + docY * 29)) },
          )
        for (let i = 0; i < resolved.bristles.length; i++) {
          const bristle = resolved.bristles[i]
          const y = bristle.offset * r
          const wobble = bristle.bend * r
          dctx.globalAlpha = bristle.alpha
          dctx.lineWidth = Math.max(0.45, bristle.thickness * Math.max(0.7, r / 11))
          dctx.beginPath()
          dctx.moveTo(-r * 0.92, y)
          dctx.quadraticCurveTo(wobble, y * 0.35, r * bristle.length, y + wobble * 0.18)
          dctx.stroke()
        }
        dctx.globalAlpha = 1
      } else if (shape === "erodible") {
        dctx.fillStyle = color
        dctx.beginPath()
        const resolved = tipState?.kind === "erodible"
          ? tipState
          : resolveErodibleTipSimulation(
            brush,
            { pressure: 1, tiltX: 0, tiltY: 0, twist: 0, velocity: 0, fade: 0, strokeAngle: 0 },
            { seed: Math.max(1, Math.round(docX * 19 + docY * 31)) },
          )
        for (let i = 0; i < resolved.edge.length; i++) {
          const point = resolved.edge[i]
          const px = Math.cos(point.angle) * r * point.radiusScale
          const py = Math.sin(point.angle) * r * point.radiusScale
          if (i === 0) dctx.moveTo(px, py)
          else dctx.lineTo(px, py)
        }
        dctx.closePath()
        if (resolved.softness > 0.01) {
          dctx.shadowColor = color
          dctx.shadowBlur = Math.max(1, r * resolved.softness * 0.55)
        }
        dctx.fill()
      } else {
        if (hardness >= 0.99) {
          // Solid circle at full hardness
          dctx.fillStyle = color
          dctx.beginPath()
          dctx.arc(0, 0, r, 0, Math.PI * 2)
          dctx.fill()
        } else {
          const grad = dctx.createRadialGradient(0, 0, r * hardness, 0, 0, r)
          grad.addColorStop(0, color)
          grad.addColorStop(1, hexToRgba(color, 0))
          dctx.fillStyle = grad
          dctx.beginPath()
          dctx.arc(0, 0, r, 0, Math.PI * 2)
          dctx.fill()
        }
      }
      dctx.restore()

      // Cache the base shape for round/square tips
      if (isCacheable) {
        const cacheCanvas = makeCanvas(side, side)
        cacheCanvas.getContext("2d")!.drawImage(c, 0, 0)
        _dabShapeCacheRef.current = { key: shapeKey, canvas: cacheCanvas, side }
      }
    }

    const img = dctx.getImageData(0, 0, side, side)
    const data = img.data
    const texture = brush.texture
    const dual = brush.dualBrush
    for (let py = 0; py < side; py++) {
      for (let px = 0; px < side; px++) {
        const idx = (py * side + px) * 4
        if (data[idx + 3] === 0) continue
        const lx = px - cx
        const ly = (py - cy) / Math.max(0.08, roundness)
        const dist = Math.hypot(lx, ly)
        const edge = clamp01((dist - r * hardness) / Math.max(1, r * (1 - hardness)))
        let alpha = (data[idx + 3] / 255) * opacity

        if (brush.wetEdges) alpha *= 0.48 + edge * 0.74
        if (shape === "erodible") alpha *= hashNoise(docX + px, docY + py, 47) > 0.18 ? 1 : 0.22
        if (brush.noise) alpha *= 0.78 + hashNoise(docX + px, docY + py, 13) * 0.44

        if (texture?.enabled) {
          const depthJitter = texture.depthJitter ? hashNoise(docX + px, docY + py, 31) * texture.depthJitter : 0
          const depth = Math.max(texture.minDepth, texture.depth - depthJitter) / 100
          const tex = sampleBrushTexture(texture.pattern, docX + px - cx, docY + py - cy, texture.scale, brush.protectTexture)
          const amount =
            texture.mode === "subtract"
              ? 1 - depth * (1 - tex)
              : texture.mode === "burn"
                ? Math.max(0, 1 - depth * Math.pow(1 - tex, 0.55) * 1.35)
                : 1 - depth + tex * depth
          alpha *= amount
        }

        if (dual?.enabled) {
          const dualMask = sampleDualBrushMask(px, py, side, docX, docY)
          if (dual.mode === "screen") alpha *= 0.35 + dualMask * 0.65
          else if (dual.mode === "subtract") alpha *= 1 - dualMask * 0.75
          else alpha *= dualMask
        }

        data[idx + 3] = Math.max(0, Math.min(255, alpha * 255))
      }
    }
    dctx.putImageData(img, 0, 0)
    return c
  }

  function sampleDualBrushMask(px: number, py: number, side: number, docX: number, docY: number) {
    const dual = brush.dualBrush
    if (!dual?.enabled) return 1
    const count = Math.max(1, Math.round(dual.count))
    const r = Math.max(1, dual.size / 2)
    let mask = 0
    for (let i = 0; i < count; i++) {
      const seed = i * 29
      const scatter = (dual.scatter / 100) * brush.size
      const ox = (hashNoise(docX, docY, seed) - 0.5) * scatter
      const oy = (hashNoise(docY, docX, seed + 11) - 0.5) * scatter
      const spacingShift = (i - (count - 1) / 2) * (dual.spacing / 100) * r
      const dx = px - side / 2 - ox - spacingShift
      const dy = py - side / 2 - oy
      mask = Math.max(mask, clamp01(1 - Math.hypot(dx, dy) / r))
    }
    return mask
  }

  function sampleBrushTexture(
    pattern: NonNullable<typeof brush.texture>["pattern"],
    x: number,
    y: number,
    scale = 100,
    protect = false,
  ) {
    const s = Math.max(8, scale)
    const tx = protect ? Math.floor(x / s) * s : x
    const ty = protect ? Math.floor(y / s) * s : y
    if (pattern === "noise") return hashNoise(tx, ty, 3)
    if (pattern === "linen") {
      const warp = 0.5 + 0.5 * Math.sin(tx / s * Math.PI * 18)
      const weft = 0.5 + 0.5 * Math.sin(ty / s * Math.PI * 18)
      return 0.25 + (warp * 0.35 + weft * 0.4)
    }
    if (pattern === "paper") {
      const n1 = hashNoise(Math.floor(tx / (s * 0.05)), Math.floor(ty / (s * 0.05)), 5)
      const n2 = hashNoise(Math.floor(tx / (s * 0.17)), Math.floor(ty / (s * 0.17)), 9)
      return 0.2 + n1 * 0.45 + n2 * 0.35
    }
    const weave = Math.abs(Math.sin(tx / s * Math.PI * 10) * Math.cos(ty / s * Math.PI * 10))
    return 0.3 + weave * 0.7
  }

  function stampWithScatter(
    ctx: CanvasRenderingContext2D, baseX: number, baseY: number, color: string, w: number, h: number,
    input: BrushInput, scatterAmt: number, scatterCnt: number, scatterCntJ: number, strokeAngle: number,
    options?: StampOptions,
  ) {
    let dabCount = scatterCnt
    if (scatterCntJ > 0) {
      dabCount = Math.max(1, Math.round(scatterCnt * (1 - Math.random() * scatterCntJ / 100)))
    }
    for (let d = 0; d < dabCount; d++) {
      let sx = baseX, sy = baseY
      if (scatterAmt > 0) {
        const offset = (Math.random() - 0.5) * 2 * (scatterAmt / 100) * brush.size
        const perpX = -Math.sin(strokeAngle) * offset
        const perpY = Math.cos(strokeAngle) * offset
        sx += perpX
        sy += perpY
      }
      stampSymmetric(ctx, sx, sy, color, w, h, input, options)
    }
  }

  function captureHighBitPaintSource() {
    highBitStrokeSourceRef.current = null
    if (!activeDoc || activeDoc.bitDepth <= 8 || activeDoc.quickMask || !activeLayer) return
    if (activeLayer.kind === "adjustment" || activeSmartFilterMaskCanvas()) return
    if (!layerAllowsDrawing(activeLayer) || typeof activeLayer.canvas.getContext !== "function") return
    highBitStrokeSourceRef.current = cloneCanvasForTool(activeLayer.canvas)
  }

  function syncActiveLayerHighBitFromCanvas(dirty?: DirtyRect) {
    if (!activeDoc || activeDoc.bitDepth <= 8 || !activeLayer || activeDoc.quickMask) return
    const before = highBitStrokeSourceRef.current
    if (!before || typeof activeLayer.canvas.getContext !== "function") return
    syncHighBitLayerFromCanvasChange(activeLayer, activeDoc, before, activeLayer.canvas, dirty)
    highBitStrokeSourceRef.current = null
  }


  function selectiveEraserStamp(ctx: CanvasRenderingContext2D, x: number, y: number, input: BrushInput) {
    if (!activeLayer || !activeDoc || activeDoc.quickMask) return
    const sourceCanvas = eraserSourceRef.current ?? activeLayer.canvas
    const { dabSize } = applyCanvasBrushShapeDynamics(brush, input)
    const { opaMul, flowMul } = applyCanvasBrushTransfer(brush, input)
    const r = Math.max(1, Math.floor(dabSize / 2))
    const x0 = Math.max(0, Math.floor(x - r))
    const y0 = Math.max(0, Math.floor(y - r))
    const x1 = Math.min(ctx.canvas.width, Math.ceil(x + r))
    const y1 = Math.min(ctx.canvas.height, Math.ceil(y + r))
    const w = x1 - x0
    const h = y1 - y0
    if (w <= 0 || h <= 0) return

    const srcCtx = sourceCanvas.getContext("2d")!
    const src = srcCtx.getImageData(x0, y0, w, h)
    // Reuse the region read for the centre sample instead of a separate
    // getImageData(1,1) per dab — same source canvas, same pixel data.
    const centerSx = Math.max(0, Math.min(w - 1, Math.floor(x) - x0))
    const centerSy = Math.max(0, Math.min(h - 1, Math.floor(y) - y0))
    const sIdx = (centerSy * w + centerSx) * 4
    const sample =
      eraser.sampling === "background-swatch"
        ? { ...hexToRgb(background), a: 255 }
        : eraser.sampling === "once" && eraserSampleRef.current
          ? eraserSampleRef.current
          : { r: src.data[sIdx], g: src.data[sIdx + 1], b: src.data[sIdx + 2], a: src.data[sIdx + 3] }
    if (eraser.sampling === "once" && !eraserSampleRef.current) eraserSampleRef.current = sample
    const fg = hexToRgb(foreground)

    const dest = ctx.getImageData(x0, y0, w, h)
    const matched = new Uint8Array(w * h)
    const hard = clamp01(brush.hardness / 100)
    const tolerance = Math.max(0, eraser.tolerance)
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const docX = x0 + px
        const docY = y0 + py
        const dist = Math.hypot(docX - x, docY - y)
        if (dist > r) continue
        const i = (py * w + px) * 4
        const color = { r: src.data[i], g: src.data[i + 1], b: src.data[i + 2], a: src.data[i + 3] }
        if (color.a <= 0) continue
        if (eraser.protectForeground && colorDistance(color, fg) <= Math.max(12, tolerance * 0.85)) continue
        if (colorDistance(color, sample) <= tolerance) matched[py * w + px] = 1
      }
    }

    const allowed =
      eraser.limits === "discontiguous"
        ? matched
        : connectedEraserMask(matched, w, h, Math.max(0, Math.min(w - 1, Math.floor(x - x0))), Math.max(0, Math.min(h - 1, Math.floor(y - y0))))

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const p = py * w + px
        if (!allowed[p]) continue
        const docX = x0 + px
        const docY = y0 + py
        const dist = Math.hypot(docX - x, docY - y)
        const brushAlpha =
          hard >= 1 || dist <= r * hard
            ? 1
            : Math.max(0, 1 - (dist - r * hard) / Math.max(1, r * (1 - hard)))
        const i = p * 4
        let edgeFactor = 1
        if (eraser.limits === "find-edges") {
          const edge = localPatchGradient(src, px, py, w, h)
          edgeFactor = edge > tolerance * 1.65 ? 0.25 : 1
        }
        const amount = clamp01((brush.opacity / 100) * (brush.flow / 100) * opaMul * flowMul * brushAlpha * edgeFactor)
        dest.data[i + 3] = Math.round(dest.data[i + 3] * (1 - amount))
      }
    }
    ctx.putImageData(dest, x0, y0)
    enforceTransparencyLock(ctx)
  }

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

  function activeClonePreset() {
    return cloneSource.activePresetId
      ? cloneSource.presets.find((preset) => preset.id === cloneSource.activePresetId) ?? null
      : null
  }

  function resolveCloneState(firstDest?: { x: number; y: number }) {
    let state = cloneSourceRef.current
    const preset = activeClonePreset()
    if (!state && preset) {
      state = {
        layerId: preset.layerId,
        sourceX: preset.sourceX,
        sourceY: preset.sourceY,
        destX: firstDest?.x,
        destY: firstDest?.y,
      }
      cloneSourceRef.current = state
    }
    if (state && firstDest && (!cloneSource.aligned || state.destX === undefined || state.destY === undefined)) {
      state.destX = firstDest.x
      state.destY = firstDest.y
    }
    return state
  }

  function cloneSamplingCanvas(sourceLayer: Layer) {
    if (!activeDoc) return sourceLayer.canvas
    if (cloneSource.sample === "current-layer") {
      // Prefer the stroke-start freeze so a stroke never samples its own output.
      const frozen = retouchSourceRef.current
      return frozen && sourceLayer.id === activeLayer?.id ? frozen : sourceLayer.canvas
    }
    const out = makeCanvas(activeDoc.width, activeDoc.height)
    const octx = out.getContext("2d")!
    const activeIndex = activeDoc.layers.findIndex((layer) => layer.id === activeLayer?.id)
    for (let i = 0; i < activeDoc.layers.length; i++) {
      const layer = activeDoc.layers[i]
      if (cloneSource.sample === "current-below" && activeIndex >= 0 && i > activeIndex) continue
      if (!layer.visible || layer.kind === "group" || typeof layer.canvas.getContext !== "function") continue
      compositeLayer(octx, layer.canvas, layer.blendMode, layer.opacity, layer.fillOpacity ?? 1)
    }
    return out
  }

  function historySourceCanvasForActiveLayer() {
    if (!activeLayer) return null
    const current = editorStore.getSnapshot()
    const docId = current.activeDocId
    return historySourceCanvas(docId ? current.histories[docId]?.entries ?? [] : [], activeLayer.id)
  }

  function brushInputFromPointer(
    pointerInput: Partial<BrushInput> | undefined,
    velocity: number,
    fade: number,
    strokeAngle: number,
  ): BrushInput {
    return {
      pressure: pointerInput?.pressure ?? 1,
      tiltX: pointerInput?.tiltX ?? 0,
      tiltY: pointerInput?.tiltY ?? 0,
      twist: pointerInput?.twist ?? 0,
      velocity,
      fade,
      strokeAngle,
    }
  }

  const drawSegment = (
    from: { x: number; y: number } | null,
    to: { x: number; y: number },
    pointerInput?: Partial<BrushInput>,
  ) => {
    const bufferedStroke = strokeCompositeRef.current
    const target = bufferedStroke && isStrokeBufferedPaintTool()
      ? { ctx: bufferedStroke.stroke.getContext("2d")!, canvas: bufferedStroke.stroke }
      : getActiveCtx()
    if (!target || !activeDoc) return
    const { ctx, canvas } = target
    const stampOptions: StampOptions | undefined = bufferedStroke
      ? { includeBrushOpacity: false, enforceTransparencyLock: false, drawEraserMask: true }
      : undefined
    markStrokeDirty(from, to)
    const w = canvas.width
    const h = canvas.height
    const dist = from ? Math.hypot(to.x - from.x, to.y - from.y) : 0
    const spacing = effectiveBrushSpacing()
    const strokeAngle = from ? Math.atan2(to.y - from.y, to.x - from.x) : (pointerInput?.strokeAngle ?? 0)
    const velocity = pointerInput?.velocity ?? dist

    if (tool === "background-eraser" || tool === "magic-eraser") {
      const steps = Math.max(1, Math.floor(dist / spacing))
      for (let i = 0; i <= steps; i++) {
        const t = steps === 0 ? 1 : i / steps
        const x = from ? from.x + (to.x - from.x) * t : to.x
        const y = from ? from.y + (to.y - from.y) * t : to.y
        const input = brushInputFromPointer(pointerInput, velocity, strokeDabRef.current++, strokeAngle)
        selectiveEraserStamp(ctx, x, y, input)
      }
    } else if (tool === "brush" || tool === "pencil" || tool === "mixer-brush" || tool === "pattern-stamp" || tool === "eraser" || tool === "color-replace") {
      const scatterAmt = brush.scatter ?? 0
      const scatterCnt = brush.scatterCount ?? 1
      const scatterCntJ = brush.scatterCountJitter ?? 0

      // If this is the first dab of a stroke (no previous point), stamp once and reset distance
      if (!from) {
        strokeDistRef.current = 0
        const input = brushInputFromPointer(pointerInput, velocity, strokeDabRef.current++, strokeAngle)
        const mixerDab = tool === "mixer-brush" ? resolveMixerDab(ctx, to.x, to.y, input) : null
        stampWithScatter(
          ctx,
          to.x,
          to.y,
          mixerDab?.color ?? foreground,
          w,
          h,
          input,
          scatterAmt,
          scatterCnt,
          scatterCntJ,
          strokeAngle,
          mixerDab ? { ...(stampOptions ?? {}), opacityMultiplier: mixerDab.opacityMultiplier } : stampOptions,
        )
      } else {
        // Accumulate distance and place dabs at exact spacing intervals
        const _remaining = strokeDistRef.current + dist
        const _dx = dist > 0 ? (to.x - from.x) / dist : 0
        const _dy = dist > 0 ? (to.y - from.y) / dist : 0
        // Start position: offset by how much distance was already accumulated
        let walked = spacing - strokeDistRef.current
        while (walked <= dist) {
          const t = walked / dist
          const baseX = from.x + (to.x - from.x) * t
          const baseY = from.y + (to.y - from.y) * t
          const input = brushInputFromPointer(pointerInput, velocity, strokeDabRef.current++, strokeAngle)
          const mixerDab = tool === "mixer-brush" ? resolveMixerDab(ctx, baseX, baseY, input) : null
          stampWithScatter(
            ctx,
            baseX,
            baseY,
            mixerDab?.color ?? foreground,
            w,
            h,
            input,
            scatterAmt,
            scatterCnt,
            scatterCntJ,
            strokeAngle,
            mixerDab ? { ...(stampOptions ?? {}), opacityMultiplier: mixerDab.opacityMultiplier } : stampOptions,
          )
          walked += spacing
        }
        // Store leftover distance for next segment
        strokeDistRef.current = dist - (walked - spacing)
      }
    } else {
      // For non-brush tools, use simple uniform stepping
      const steps = Math.max(1, Math.floor(dist / spacing))
      if (tool === "blur") {
        for (let i = 0; i <= steps; i++) {
          const t = steps === 0 ? 1 : i / steps
          const x = from ? from.x + (to.x - from.x) * t : to.x
          const y = from ? from.y + (to.y - from.y) * t : to.y
          if (dabTouchesSelection(activeDoc, x, y, brush.size / 2)) blurStamp(ctx, x, y, brush.size / 2)
        }
      } else if (tool === "sharpen") {
        for (let i = 0; i <= steps; i++) {
          const t = steps === 0 ? 1 : i / steps
          const x = from ? from.x + (to.x - from.x) * t : to.x
          const y = from ? from.y + (to.y - from.y) * t : to.y
          if (dabTouchesSelection(activeDoc, x, y, brush.size / 2)) sharpenStamp(ctx, x, y, brush.size / 2)
        }
      } else if (tool === "smudge") {
        for (let i = 0; i <= steps; i++) {
          const t = steps === 0 ? 1 : i / steps
          const x = from ? from.x + (to.x - from.x) * t : to.x
          const y = from ? from.y + (to.y - from.y) * t : to.y
          if (dabTouchesSelection(activeDoc, x, y, brush.size / 2)) smudgeBufferRef.current.step(ctx, x, y, brush.size / 2, brush.flow / 100)
        }
      } else if (tool === "dodge" || tool === "burn") {
        const dodgeOptions = getDodgeBurnRuntimeOptions()
        // 0.12 peak per dab at 100% exposure: dabs land every `spacing` px, so
        // the stroke builds up gradually instead of clipping on contact.
        const strength = (dodgeOptions.exposure / 100) * 0.12
        for (let i = 0; i <= steps; i++) {
          const t = steps === 0 ? 1 : i / steps
          const x = from ? from.x + (to.x - from.x) * t : to.x
          const y = from ? from.y + (to.y - from.y) * t : to.y
          if (dabTouchesSelection(activeDoc, x, y, brush.size / 2)) {
            dodgeBurnStamp(ctx, x, y, brush.size / 2, tool, strength, {
              range: dodgeOptions.range,
              protectTones: dodgeOptions.protectTones,
              hardness: brush.hardness,
            })
          }
        }
      } else if (tool === "sponge") {
        const spongeOptions = getSpongeRuntimeOptions()
        const strength = (spongeOptions.flow / 100) * 0.15
        for (let i = 0; i <= steps; i++) {
          const t = steps === 0 ? 1 : i / steps
          const x = from ? from.x + (to.x - from.x) * t : to.x
          const y = from ? from.y + (to.y - from.y) * t : to.y
          if (dabTouchesSelection(activeDoc, x, y, brush.size / 2)) {
            spongeStamp(ctx, x, y, brush.size / 2, strength, spongeOptions.mode)
          }
        }
      } else if (tool === "clone-stamp" || tool === "history-brush" || tool === "art-history-brush") {
        const historySource = tool === "history-brush" || tool === "art-history-brush" ? historySourceCanvasForActiveLayer() : null
        const src = historySource ? null : resolveCloneState(from ?? to)
        if (!historySource && !src) return
        const sourceLayer = src ? activeDoc.layers.find((l) => l.id === src.layerId) ?? activeLayer! : activeLayer!
        const sourceCanvas = historySource ?? cloneSamplingCanvas(sourceLayer)
        const destAnchor = src ? { x: src.destX ?? to.x, y: src.destY ?? to.y } : { x: 0, y: 0 }
        const sourceAnchor = src
          ? {
            x: src.sourceX + cloneSource.offsetX,
            y: src.sourceY + cloneSource.offsetY,
          }
          : { x: cloneSource.offsetX, y: cloneSource.offsetY }
        for (let i = 0; i <= steps; i++) {
          const t = steps === 0 ? 1 : i / steps
          const dx = from ? from.x + (to.x - from.x) * t : to.x
          const dy = from ? from.y + (to.y - from.y) * t : to.y
          if (!dabTouchesSelection(activeDoc, dx, dy, brush.size / 2)) continue
          const artDabs = tool === "art-history-brush"
            ? planArtHistoryStroke({ x: dx, y: dy }, brush, { seed: strokeDabRef.current++ + i * 17 })
            : [{ dx: 0, dy: 0, sourceDx: 0, sourceDy: 0, rotation: 0, scale: 1, opacity: 1 }]
          for (const dab of artDabs) {
            transformedCloneStamp(
              ctx,
              sourceCanvas,
              { x: sourceAnchor.x + dab.sourceDx, y: sourceAnchor.y + dab.sourceDy },
              destAnchor,
              dx + dab.dx,
              dy + dab.dy,
              (brush.size / 2) * dab.scale,
              brush.hardness,
              (brush.opacity / 100) * (brush.flow / 100) * dab.opacity,
              cloneSource.scale,
              cloneSource.rotation + dab.rotation,
              false,
            )
          }
        }
      } else if (tool === "healing-brush") {
        const src = resolveCloneState(from ?? to)
        if (!src) return
        const sourceLayer = activeDoc.layers.find((l) => l.id === src.layerId) ?? activeLayer!
        const sourceCanvas = cloneSamplingCanvas(sourceLayer)
        const destAnchor = { x: src.destX ?? to.x, y: src.destY ?? to.y }
        const sourceAnchor = {
          x: src.sourceX + cloneSource.offsetX,
          y: src.sourceY + cloneSource.offsetY,
        }
        for (let i = 0; i <= steps; i++) {
          const t = steps === 0 ? 1 : i / steps
          const dx = from ? from.x + (to.x - from.x) * t : to.x
          const dy = from ? from.y + (to.y - from.y) * t : to.y
          if (!dabTouchesSelection(activeDoc, dx, dy, brush.size / 2)) continue
          transformedCloneStamp(
            ctx,
            sourceCanvas,
            sourceAnchor,
            destAnchor,
            dx,
            dy,
            brush.size / 2,
            brush.hardness,
            (brush.opacity / 100) * (brush.flow / 100),
            cloneSource.scale,
            cloneSource.rotation,
            true,
          )
        }
      } else if (tool === "spot-healing") {
        // Heal from surrounding pixels. The source is the stroke-start freeze,
        // not the live canvas, and the donor patch is chosen per dab instead of
        // always being "2r to the right" — a fixed offset walked off-canvas at
        // the edges and, mid-drag, sampled pixels this same stroke had already
        // repaired.
        const source = retouchSourceRef.current ?? canvas
        for (let i = 0; i <= steps; i++) {
          const t = steps === 0 ? 1 : i / steps
          const x = from ? from.x + (to.x - from.x) * t : to.x
          const y = from ? from.y + (to.y - from.y) * t : to.y
          if (!dabTouchesSelection(activeDoc, x, y, brush.size / 2)) continue
          const r = brush.size / 2
          const donor = pickHealSource(source, x, y, r)
          healStamp(ctx, source, donor.x, donor.y, x, y, r)
        }
      }
    }
    applySelectionClip(ctx, selectionClipRef.current, { buffered: !!bufferedStroke })
    if (!renderBufferedStroke()) requestTileAwareStrokeRender()
  }

  /* ---- gradient preview & commit ---- */





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
      const paint = makeCanvas(activeDoc.width, activeDoc.height)
      paint.getContext("2d")!.drawImage(ov, 0, 0)
      applySelectionMaskToCanvas(paint, activeDoc)
      source = paint
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

  /* ---- marquee preview ---- */

  function drawMarqueePreview(start: { x: number; y: number }, end: { x: number; y: number }) {
    const ov = overlayRef.current
    if (!ov || !activeDoc) return
    drawMarqueePreviewOverlay(ov, activeDoc, tool, start, end)
  }

  function drawTextBoxPreview(start: { x: number; y: number }, end: { x: number; y: number }) {
    const ov = overlayRef.current
    if (!ov || !activeDoc) return
    drawTextBoxPreviewOverlay(ov, activeTextDefaults().size, visualZoomRef.current, start, end)
  }

  function drawRulerPreview(start: { x: number; y: number }, end: { x: number; y: number }) {
    const ov = overlayRef.current
    if (!ov || !activeDoc) return
    drawRulerPreviewOverlay(ov, start, end)
  }

  function drawBrushPreview(center: { x: number; y: number }, radius: number) {
    const ov = overlayRef.current
    if (!ov || !activeDoc) return
    drawBrushPreviewOverlay(ov, tool, brush, cloneSource, center, radius)
  }

  function drawLassoPreview(points: { x: number; y: number }[], hover?: { x: number; y: number }) {
    const ov = overlayRef.current
    if (!ov || !activeDoc) return
    drawLassoPreviewOverlay(ov, points, hover, tool === "lasso-magnetic" ? {
      selectionOptions,
      resolveTraceSource: () => {
        const sourceCanvas = selectionOptions.sampleAllLayers ? compositeRef.current : activeLayer?.canvas
        if (!sourceCanvas || typeof sourceCanvas.getContext !== "function") return null
        return selectionTraceSourceForLayer(sourceCanvas)
      },
    } : null)
  }

  function drawPatchPreview(offset?: { x: number; y: number }) {
    const ov = overlayRef.current
    const patch = patchRef.current
    if (!ov || !activeDoc || !patch) return
    drawPatchPreviewOverlay(ov, patch, offset)
  }

  function drawPathPreview(hover?: { x: number; y: number } | null) {
    const ov = overlayRef.current
    if (!ov || !pathDraftRef.current) return
    drawPathPreviewOverlay(ov, pathDraftRef.current, hover)
  }

  /* ---- transform handles ---- */

  function drawTransformHandles() {
    const ov = overlayRef.current
    if (!ov || !activeDoc || !transformRef.current) return
    drawTransformHandlesOverlay(ov, transformRef.current)
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

  function replacementSettings() {
    return brush.colorReplacement ?? {
      sampling: "continuous" as const,
      limits: "contiguous" as const,
      mode: "color" as const,
      tolerance: 32,
      antiAlias: true,
    }
  }

  function colorReplacementStamp(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    dabSize: number,
    input: BrushInput,
    opacity: number,
  ) {
    if (!activeLayer || !dabTouchesSelection(activeDoc, x, y, dabSize)) return
    const settings = replacementSettings()
    const r = Math.max(1, Math.floor(dabSize / 2))
    const x0 = Math.max(0, Math.floor(x - r))
    const y0 = Math.max(0, Math.floor(y - r))
    const x1 = Math.min(ctx.canvas.width, Math.ceil(x + r))
    const y1 = Math.min(ctx.canvas.height, Math.ceil(y + r))
    const w = x1 - x0
    const h = y1 - y0
    if (w <= 0 || h <= 0) return

    const sourceCanvas = colorReplacementSourceRef.current ?? ctx.canvas
    const source = sourceCanvas.getContext("2d")!.getImageData(x0, y0, w, h)
    const dest = ctx.getImageData(x0, y0, w, h)
    const centerSx = Math.max(0, Math.min(w - 1, Math.floor(x) - x0))
    const centerSy = Math.max(0, Math.min(h - 1, Math.floor(y) - y0))
    const centerIdx = (centerSy * w + centerSx) * 4
    const sample =
      settings.sampling === "background-swatch"
        ? { ...hexToRgb(background), a: 255 }
        : settings.sampling === "once" && colorReplacementSampleRef.current
          ? colorReplacementSampleRef.current
          : {
            r: source.data[centerIdx],
            g: source.data[centerIdx + 1],
            b: source.data[centerIdx + 2],
            a: source.data[centerIdx + 3],
          }
    if (settings.sampling === "once" && !colorReplacementSampleRef.current) {
      colorReplacementSampleRef.current = sample
    }
    const replacement = { ...hexToRgb(foreground), a: 255 }
    const matched = new Uint8Array(w * h)
    const hard = clamp01(brush.hardness / 100)
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const p = py * w + px
        const docX = x0 + px
        const docY = y0 + py
        if (Math.hypot(docX - x, docY - y) > r) continue
        const i = p * 4
        const candidate = { r: source.data[i], g: source.data[i + 1], b: source.data[i + 2], a: source.data[i + 3] }
        if (candidate.a <= 0) continue
        if (colorDistance(candidate, sample) <= settings.tolerance) matched[p] = 1
      }
    }
    const allowed =
      settings.limits === "discontiguous"
        ? matched
        : connectedEraserMask(matched, w, h, centerSx, centerSy)
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const p = py * w + px
        if (!allowed[p]) continue
        const docX = x0 + px
        const docY = y0 + py
        const dist = Math.hypot(docX - x, docY - y)
        const brushAlpha =
          hard >= 1 || dist <= r * hard
            ? 1
            : Math.max(0, 1 - (dist - r * hard) / Math.max(1, r * (1 - hard)))
        if (!settings.antiAlias && brushAlpha < 0.5) continue
        let edgeFactor = 1
        if (settings.limits === "find-edges") {
          const edge = localPatchGradient(source, px, py, w, h)
          edgeFactor = edge > settings.tolerance * 1.65 ? 0.28 : 1
        }
        const i = p * 4
        const replaced = resolveColorReplacementPixel({
          source: { r: dest.data[i], g: dest.data[i + 1], b: dest.data[i + 2], a: dest.data[i + 3] },
          sample,
          replacement,
          tolerance: settings.tolerance,
          mode: settings.mode,
          opacity: opacity * brushAlpha * edgeFactor * (input.pressure || 1),
        })
        if (!replaced.changed) continue
        dest.data[i] = replaced.pixel.r
        dest.data[i + 1] = replaced.pixel.g
        dest.data[i + 2] = replaced.pixel.b
        dest.data[i + 3] = replaced.pixel.a
      }
    }
    ctx.putImageData(dest, x0, y0)
  }



  function mixerSettings() {
    return brush.mixer ?? {
      wet: 55,
      load: 60,
      mix: 50,
      flow: brush.flow,
      sampleAllLayers: false,
      cleanAfterStroke: false,
    }
  }

  function resetMixerReservoir() {
    const settings = mixerSettings()
    mixerReservoirRef.current = requiredRgbaFromCss(settings.reservoirColor ?? foreground)
  }

  function resolveMixerDab(ctx: CanvasRenderingContext2D, x: number, y: number, input: BrushInput) {
    const settings = mixerSettings()
    if (!mixerReservoirRef.current) resetMixerReservoir()
    const sampleSource = settings.sampleAllLayers && compositeRef.current ? compositeRef.current : ctx.canvas
    const sample = sampleCanvasColor(sampleSource, { x, y }, getEyedropperSampleSize())
    const step = resolveMixerReservoirStep({
      reservoir: mixerReservoirRef.current ?? requiredRgbaFromCss(foreground),
      sample: { r: sample.r, g: sample.g, b: sample.b, a: sample.a / 255 },
      settings: { wet: settings.wet, load: settings.load, mix: settings.mix, flow: settings.flow },
      pressure: input.pressure,
    })
    mixerReservoirRef.current = step.nextReservoir
    if (step.pickupAlpha > 0.01) {
      smudgeBufferRef.current.step(ctx, x, y, brush.size / 2, step.pickupAlpha * 0.8)
    }
    return {
      color: rgbaToCss(step.paintColor),
      opacityMultiplier: step.depositAlpha,
    }
  }

  /* ---- pointer state ---- */

  const drawingRef = React.useRef<{
    type:
    | "stroke"
    | "marquee"
    | "lasso"
    | "polylasso"
    | "shape"
    | "gradient"
    | "pan"
    | "move"
    | "crop"
    | "pcrop"
    | "object-select"
    | "refine-edge"
    | "transform"
    | "rotate-view"
    | "path-direct"
    | "path-marquee"
    | "freeform-path"
    | "guide"
    | "ruler"
    | "remove"
    | "patch-lasso"
    | "patch-drag"
    | "brush-resize"
    | "text-box"
    | "eyedropper"
    | "pen-handle"
    | null
    last?: { x: number; y: number }
    start?: { x: number; y: number }
    smooth?: { x: number; y: number }
    points?: { x: number; y: number }[]
    panStart?: { x: number; y: number }
    moveLayerId?: string
    moveStart?: { x: number; y: number }
    moveOrigin?: { x: number; y: number }
    /** Snapped delta actually applied by the last move frame, read on commit. */
    moveDelta?: { x: number; y: number }
    handle?: TransformHandleId
    guideOrient?: "horizontal" | "vertical"
    refineMode?: "expand" | "subtract"
    /** Whole-stroke bounds, accumulated to pointer-up for the history commit. */
    dirty?: DirtyRect
    /** Bounds touched since the last render, cleared each frame. Repainting
     *  `dirty` instead makes a long stroke quadratic in its own length. */
    frameDirty?: DirtyRect
    rotateStartAngle?: number
    rotateStartValue?: number
    directLayerId?: string
    directSubpathIndex?: number
    directPointIndex?: number
    directPathHandle?: "in" | "out"
    directShapeHandle?: DirectShapeHandleId
    directSelectedAnchors?: PathAnchorRef[]
    sliceDraftId?: string
    /** Eyedropper started with Alt: samples the background swatch. */
    sampleToBackground?: boolean
  }>({ type: null })
  const brushResizeRef = React.useRef<{ startClientX: number; startSize: number } | null>(null)
  const [, setDirectAnchorSelectionState] = React.useState<{ layerId: string; anchors: PathAnchorRef[] } | null>(null)
  const directAnchorSelectionRef = React.useRef<{ layerId: string; anchors: PathAnchorRef[] } | null>(null)

  const setDirectAnchorSelection = React.useCallback((selection: { layerId: string; anchors: PathAnchorRef[] } | null) => {
    directAnchorSelectionRef.current = selection
    setDirectAnchorSelectionState(selection)
  }, [])

  /* ---- direct-selection anchor set (ref-backed so drags don't re-render) ---- */

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

  function clampDirtyRect(rect: DirtyRect): DirtyRect | null {
    if (!activeDoc) return null
    const x1 = Math.max(0, Math.floor(rect.x))
    const y1 = Math.max(0, Math.floor(rect.y))
    const x2 = Math.min(activeDoc.width, Math.ceil(rect.x + rect.w))
    const y2 = Math.min(activeDoc.height, Math.ceil(rect.y + rect.h))
    if (x2 <= x1 || y2 <= y1) return null
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
  }


  function strokeDirtyPadding() {
    const scatter = ((brush.scatter ?? 0) / 100) * brush.size
    const dualBrush = brush.dualBrush?.enabled
      ? brush.dualBrush.size + ((brush.dualBrush.scatter ?? 0) / 100) * brush.size
      : 0
    return Math.ceil(Math.max(brush.size, dualBrush) + scatter + 24)
  }

  function markStrokeDirty(from: { x: number; y: number } | null, to: { x: number; y: number }) {
    const drag = drawingRef.current
    if (drag.type !== "stroke" || !activeDoc) return
    if (symmetry.enabled) {
      drag.dirty = { x: 0, y: 0, w: activeDoc.width, h: activeDoc.height }
      drag.frameDirty = drag.dirty
      return
    }
    const pad = strokeDirtyPadding()
    const start = from ?? to
    const dirty = clampDirtyRect({
      x: Math.min(start.x, to.x) - pad,
      y: Math.min(start.y, to.y) - pad,
      w: Math.abs(to.x - start.x) + pad * 2,
      h: Math.abs(to.y - start.y) + pad * 2,
    })
    if (dirty) {
      drag.dirty = mergeDirtyRect(drag.dirty, dirty)
      drag.frameDirty = mergeDirtyRect(drag.frameDirty, dirty)
    }
  }

  function requestTileAwareStrokeRender(reason = "tile-only-tool") {
    const drag = drawingRef.current
    // frameDirty, not dirty: the whole-stroke bounds cross the planner's
    // full-frame coverage threshold within a few hundred pixels of travel,
    // which drops every later frame of the stroke onto the slow path.
    const dirty = drag.type === "stroke" ? drag.frameDirty : undefined
    drag.frameDirty = undefined
    if (!activeDoc || !activeLayer || !dirty || activeDoc.quickMask || activeSmartFilterMaskCanvas()) {
      requestRender()
      return
    }
    const plan = planTileOnlyInteractiveTool({
      documentWidth: activeDoc.width,
      documentHeight: activeDoc.height,
      tileSize: 512,
      tool,
      layerId: activeLayer.id,
      bounds: dirty,
      radius: strokeDirtyPadding(),
    })
    if (plan.strategy !== "tile-local") {
      requestRender()
      return
    }
    requestRender({
      layerIds: [activeLayer.id],
      reason,
      dirtyByLayer: { [activeLayer.id]: [plan.writeRect] },
    })
  }

  /* ---- pointer down ---- */

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
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
    if (tool === "transform" && transformRef.current?.layerId !== activeLayer?.id) {
      if (!layerAllowsMoving(activeLayer)) return
      beginTransform(activeLayer)
      return
    }

    // Free Transform: handle hit
    if (transformRef.current) {
      const handle = pickTransformHandle(pt, transformRef.current)
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
      const inside = pointInTransformBox(pt, transformRef.current)
      if (inside) {
        drawingRef.current = { type: "transform", start: pt, handle: "move", last: pt }
      } else {
        commitTransform()
      }
      return
    }

    // Set clone source on Alt+click
    if ((tool === "clone-stamp" || tool === "healing-brush") && e.altKey) {
      if (activeLayer) {
        cloneSourceRef.current = {
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
      drawingRef.current = {
        type: "move",
        moveLayerId: layer.id,
        moveStart: pt,
        moveOrigin: { x: 0, y: 0 },
        last: pt,
      }
      // Save layer pixels into a temporary buffer keyed via dataset on canvas
      const cv = makeCanvas(activeDoc.width, activeDoc.height)
      cv.getContext("2d")!.drawImage(layer.canvas, 0, 0); layer.canvas.__moveSnapshot = cv
      // With an active selection, Photoshop moves only the selected pixels.
      // Lift them into a float buffer and (unless Alt is held, which copies)
      // punch the hole in the snapshot that stays behind.
      const float = liftSelectionFloat(activeDoc, cv, e.altKey)
      if (float) layer.canvas.__moveFloat = float
      if (moveOptions.showTransformControls) beginTransform(layer)
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
      if (hasPixels) commitSelection({ bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, shape: "freehand", mask: cv })
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
      drawTextBoxPreview(pt, pt)
      return
    }

    if (
      (tool === "pen" || tool === "curvature-pen" || tool === "freeform-pen" || tool === "path-select") &&
      isTempDirectSelectModifier(e)
    ) {
      beginDirectSelectionAtPoint(e, pt)
      return
    }

    // Pen tools
    if (tool === "freeform-pen") {
      drawingRef.current = { type: "freeform-path", start: pt, last: pt, points: [pt] }
      drawLassoPreview([pt])
      return
    }

    if (tool === "pen" || tool === "curvature-pen") {
      if (e.altKey && convertAnchorAtPoint(pt)) return
      const curvature = tool === "curvature-pen"
      if (!pathDraftRef.current || !!pathDraftRef.current.curvature !== curvature) {
        pathDraftRef.current = { points: [{ x: pt.x, y: pt.y }], closed: false, curvature }
      } else {
        const draft = pathDraftRef.current
        // close on near-first
        if (draft.points.length > 1) {
          const f = draft.points[0]
          if (Math.hypot(f.x - pt.x, f.y - pt.y) < 6) {
            draft.closed = true
            commitPath(true)
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
      drawPathPreview()
      return
    }

    if (tool === "path-select") {
      const hit = pickVectorLayer(activeDoc, pt)
      if (!hit) return
      dispatch({ type: "set-active-layer", id: hit.id })
      drawPathSelectionPreview(hit)
      if (!layerAllowsMoving(hit)) return
      if (e.altKey && duplicateSubpathForPathSelection(hit, pt)) return
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
      beginDirectSelectionAtPoint(e, pt)
      return
    }

    if (tool === "add-anchor-point" || tool === "delete-anchor-point" || tool === "convert-point") {
      editAnchorPoint(tool, pt)
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
      if (hit) drawSliceSelectionPreview(hit)
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
      drawBrushPreview(pt, brush.size / 2)
      return
    }

    if (tool === "object-select") {
      if (!activeLayer) return
      drawingRef.current = { type: "object-select", start: pt, last: pt }
      drawMarqueePreview(pt, pt)
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
          commitSelection({
            bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
            shape: "wand",
            mask: maskCv,
            diagnostics,
          })
          if (quick) commit("Quick Selection", [])
        } else if (quick) {
          const radius = Math.max(8, Math.min(48, Math.round(selectionOptions.tolerance / 2)))
          commitSelection({
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
      commitSelection(selectionFromMask(maskCv, "freehand"))
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
      commitSelection(selectionFromMask(maskCv, "freehand"))
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
      commitSelection(selectionFromMask(maskCv, "freehand"))
      commit("Select Background", [])
      return
    }

    if (tool === "red-eye") {
      applyRedEyeCorrection(pt)
      return
    }

    // Remove Tool
    if (tool === "remove-tool") {
      if (!layerAllowsDrawing(activeLayer)) return
      if (typeof activeLayer.canvas.getContext !== "function") return
      captureHighBitPaintSource()
      // Initialize points for remove stroke
      removeRef.current = { points: [pt] }
      drawingRef.current = { type: "remove", last: pt, points: [pt] }
      return
    }

    if (tool === "patch-tool") {
      if (!layerAllowsDrawing(activeLayer) || typeof activeLayer.canvas.getContext !== "function") return
      const existingPatch = patchRef.current
      if (existingPatch && pointInMask(existingPatch.mask, pt)) {
        captureHighBitPaintSource()
        drawingRef.current = { type: "patch-drag", start: pt, last: pt }
        drawPatchPreview({ x: 0, y: 0 })
        return
      }
      if (!existingPatch && activeDoc.selection.bounds) {
        const mask = selectionToMaskCanvas(activeDoc.width, activeDoc.height, activeDoc.selection)
        if (mask && pointInMask(mask, pt)) {
          patchRef.current = { mask, bounds: activeDoc.selection.bounds }
          captureHighBitPaintSource()
          drawingRef.current = { type: "patch-drag", start: pt, last: pt }
          drawPatchPreview({ x: 0, y: 0 })
          return
        }
      }
      patchRef.current = null
      drawingRef.current = { type: "patch-lasso", start: pt, last: pt, points: [pt] }
      drawLassoPreview([pt])
      return
    }

    if (tool === "paint-bucket") {
      if (!layerAllowsDrawing(activeLayer)) return
      captureHighBitPaintSource()
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
      syncActiveLayerHighBitFromCanvas()
      requestRender()
      commit("Paint Bucket", [activeLayer.id])
      return
    }

    if (tool === "magic-eraser") {
      magicEraseAt(pt)
      return
    }

    if (tool === "zoom") {
      applyZoomToolStep(e.clientX, e.clientY, e.altKey)
      return
    }

    if (tool === "ruler") {
      drawingRef.current = { type: "ruler", start: pt, last: pt }
      drawRulerPreview(pt, pt)
      dispatch({ type: "set-measurement", m: { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y } })
      return
    }

    if (tool === "marquee-rect" || tool === "marquee-ellipse") {
      drawingRef.current = { type: "marquee", start: pt, last: pt }
      drawMarqueePreview(pt, pt)
      return
    }

    if (tool === "crop") {
      drawingRef.current = { type: "crop", start: pt, last: pt }
      drawMarqueePreview(pt, pt)
      return
    }

    if (tool === "perspective-crop") {
      const existing = drawingRef.current
      if (existing.type === "pcrop" && existing.points) {
        const pts = [...existing.points, pt]
        if (pts.length >= 4) {
          // Apply perspective crop
          applyPerspectiveCrop(pts.slice(0, 4))
          drawingRef.current = { type: null }
          const ov = overlayRef.current
          if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
        } else {
          drawingRef.current = { type: "pcrop", points: pts, last: pt }
          drawPerspectiveCropPreview(pts)
        }
      } else {
        drawingRef.current = { type: "pcrop", points: [pt], last: pt }
        drawPerspectiveCropPreview([pt])
      }
      return
    }

    if (tool === "lasso") {
      drawingRef.current = { type: "lasso", start: pt, last: pt, points: [pt] }
      return
    }

    if (tool === "lasso-polygon" || tool === "lasso-magnetic") {
      // Click to add a point. Double-click finishes.
      const lassoPt = tool === "lasso-magnetic" ? snapMagneticPoint(pt) : pt
      const existing = drawingRef.current.type === "polylasso" ? drawingRef.current.points ?? [] : []
      const updated = [...existing, lassoPt]
      // close on near-first
      if (updated.length > 2) {
        const f = updated[0]
        const closeDistance = Math.max(3, 8 / Math.max(0.1, visualZoomRef.current))
        if (Math.hypot(f.x - lassoPt.x, f.y - lassoPt.y) < closeDistance) {
          finalizePolyLasso(updated)
          drawingRef.current = { type: null }
          return
        }
      }
      drawingRef.current = { type: "polylasso", points: updated, last: lassoPt }
      drawLassoPreview(updated, lassoPt)
      return
    }

    if (tool === "gradient") {
      captureHighBitPaintSource()
      drawingRef.current = { type: "gradient", start: pt, last: pt }
      drawGradientPreview(pt, pt)
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
      if ((tool === "clone-stamp" || tool === "healing-brush") && !resolveCloneState(pt)) return
      retouchSourceRef.current =
        activeLayer && SAMPLING_RETOUCH_TOOLS.has(tool) ? cloneCanvasForTool(activeLayer.canvas) : null
      captureHighBitPaintSource()
      prepareTransparencyLockMask()
      eraserSampleRef.current = null
      colorReplacementSampleRef.current = null
      eraserSourceRef.current =
        tool === "background-eraser" && activeLayer
          ? cloneCanvasForTool(activeLayer.canvas)
          : null
      colorReplacementSourceRef.current =
        tool === "color-replace" && activeLayer
          ? cloneCanvasForTool(activeLayer.canvas)
          : null
      if (tool === "mixer-brush") resetMixerReservoir()
      selectionClipRef.current = captureSelectionClip(activeDoc, getActiveCtx()?.canvas ?? null)
      if (isStrokeBufferedPaintTool()) {
        const target = getActiveCtx()
        if (!target) return
        beginBufferedStroke(target.canvas, target.targetKind)
      }
      smudgeBufferRef.current.reset()
      strokeDabRef.current = 0
      strokeDistRef.current = 0
      lastBrushPointerSampleRef.current = null
      selectionHitTesterRef.current = createSelectionHitTester(activeDoc.width, activeDoc.height, activeDoc.selection)
      drawingRef.current = { type: "stroke", last: pt, smooth: pt }
      drawSegment(null, pt, pointerBrushInput(e, pt))
    }
  }

  /* ---- pointer move ---- */

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
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
      if ((tool === "pen" || tool === "curvature-pen") && pathDraftRef.current) {
        drawPathPreview(pt)
      }
      return
    }

    if (drag.type === "pan" && drag.panStart) {
      panRef.current = { x: e.clientX - drag.panStart.x, y: e.clientY - drag.panStart.y }
      applyStageTransform()
      return
    }

    if (drag.type === "text-box" && drag.start) {
      drawTextBoxPreview(drag.start, pt)
      drag.last = pt
      return
    }

    if (drag.type === "eyedropper") {
      sampleEyedropperAt(pt, drag.sampleToBackground ?? false)
      drag.last = pt
      return
    }

    if (drag.type === "pen-handle" && drag.start && pathDraftRef.current) {
      const draft = pathDraftRef.current
      const anchor = draft.points[draft.points.length - 1]
      if (anchor) {
        const end = e.shiftKey ? constrainPointTo45(drag.start, pt) : pt
        // Symmetric handles: the outgoing one follows the cursor, the incoming
        // one mirrors it through the anchor, giving a smooth point.
        anchor.cp2 = { x: end.x, y: end.y }
        anchor.cp1 = { x: anchor.x - (end.x - anchor.x), y: anchor.y - (end.y - anchor.y) }
        drag.last = end
        drawPathPreview()
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
      drawSegment(last, cur, pointerBrushInput(e, cur))
      drag.last = cur
      drag.smooth = cur
      return
    }

    if (drag.type === "marquee" && drag.start) {
      drawMarqueePreview(drag.start, pt)
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
      drawMarqueePreview(drag.start, pt)
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
      drawBrushPreview(pt, brush.size / 2)
      return
    }

    if (drag.type === "remove" && drag.points) {
      drag.points.push(pt)
      removeRef.current?.points.push(pt)
      drag.last = pt
      drawBrushPreview(pt, brush.size / 2)
      return
    }

    if (drag.type === "crop" && drag.start) {
      drawMarqueePreview(drag.start, pt)
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
      drawRulerPreview(drag.start, pt)
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
      drawLassoPreview(drag.points)
      return
    }

    if (drag.type === "freeform-path" && drag.points) {
      drag.points.push(pt)
      drag.last = pt
      drawLassoPreview(drag.points)
      return
    }

    if (drag.type === "patch-lasso" && drag.points) {
      drag.points.push(pt)
      drag.last = pt
      drawLassoPreview(drag.points)
      return
    }

    if (drag.type === "patch-drag" && drag.start) {
      drag.last = pt
      drawPatchPreview({ x: pt.x - drag.start.x, y: pt.y - drag.start.y })
      return
    }

    if (drag.type === "polylasso" && drag.points) {
      const hover = tool === "lasso-magnetic" ? snapMagneticPoint(pt) : pt
      if (tool === "lasso-magnetic" && drag.points.length > 0) {
        const lastAnchor = drag.points[drag.points.length - 1]
        if (Math.hypot(hover.x - lastAnchor.x, hover.y - lastAnchor.y) >= magneticAnchorInterval()) {
          drag.points = [...drag.points, hover]
          drag.last = hover
          drawLassoPreview(drag.points)
          return
        }
      }
      drag.last = hover
      drawLassoPreview(drag.points, hover)
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
      drawMarqueePreview(drag.start, pt)
      drag.last = pt
      return
    }

    if (drag.type === "path-direct" && drag.directLayerId && activeDoc) {
      const layer = activeDoc.layers.find((candidate) => candidate.id === drag.directLayerId)
      if (!layerAllowsDrawing(layer)) return
      updateDirectSelectionDrag(layer, pt, drag, !e.altKey, e.shiftKey)
      requestRender()
      drawPathSelectionPreview(layer)
      drag.last = pt
      return
    }

    if (drag.type === "gradient" && drag.start) {
      // Shift constrains the ramp axis to 45° steps, as in Photoshop.
      const end = e.shiftKey ? constrainPointTo45(drag.start, pt) : pt
      drawGradientPreview(drag.start, end)
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
        // pixels ride the cursor.
        ctx.drawImage(snapshot, 0, 0)
        ctx.drawImage(float, dx, dy)
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

    if (drag.type === "transform" && drag.handle && transformRef.current) {
      handleTransformDrag(pt, drag.handle, e.shiftKey, e.altKey)
      drawTransformHandles()
      renderTransformPreview()
      return
    }
  }

  /* ---- pointer up ---- */

  // Commits an in-progress paint stroke and resets stroke-transient refs.
  // Shared by onPointerUp and onPointerCancel: it never reads event
  // coordinates, so the pixels already painted are preserved even when
  // the cancel event carries no usable position. No-op unless a stroke
  // drag is active, which keeps repeated calls safe.
  const commitActiveStroke = () => {
    const drag = drawingRef.current
    if (drag.type !== "stroke") return
    const smartFilterMaskLayerId = activeSmartFilterMaskCanvas() ? activeSmartFilterMaskTarget?.layerId : null
    const label = smartFilterMaskLayerId ? "Smart Filter Mask" : labelForTool(tool)
    const changedLayerIds =
      activeLayer && drag.dirty && !activeDoc?.quickMask
        ? { ids: [smartFilterMaskLayerId ?? activeLayer.id], bounds: { [smartFilterMaskLayerId ?? activeLayer.id]: drag.dirty } }
        : activeLayer
          ? [smartFilterMaskLayerId ?? activeLayer.id]
          : undefined
    finishBufferedStroke()
    syncActiveLayerHighBitFromCanvas(drag.dirty)
    drawingRef.current = { type: null }
    smudgeBufferRef.current.reset()
    transparencyLockMaskRef.current = null
    selectionClipRef.current = null
    eraserSourceRef.current = null
    eraserSampleRef.current = null
    colorReplacementSourceRef.current = null
    colorReplacementSampleRef.current = null
    if (tool === "mixer-brush" && brush.mixer?.cleanAfterStroke) mixerReservoirRef.current = null
    lastBrushPointerSampleRef.current = null
    selectionHitTesterRef.current = null
    highBitStrokeSourceRef.current = null
    schedulePaintCommit(label, changedLayerIds)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
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
      commitActiveStroke()
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
      syncActiveLayerHighBitFromCanvas()
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
          drawPatchPreview()
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
        syncActiveLayerHighBitFromCanvas()
        requestRender()
        commit("Patch Tool", [activeLayer.id])
      } else {
        drawPatchPreview()
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
      const floated = !!layer?.canvas.__moveFloat
      // Path Selection drags a vector layer, so the geometry has to travel with
      // the pixels — otherwise the next re-rasterize snapped the shape back to
      // where it was authored and the move looked like it never happened.
      if (tool === "path-select" && layer && drag.moveDelta) {
        const { x: dx, y: dy } = drag.moveDelta
        if (translateVectorLayerGeometry(layer, dx, dy)) {
          rerenderVectorLayer(layer)
          if (layer.path) dispatch({ type: "set-layer-path", id: layer.id, path: layer.path })
          if (layer.shape) dispatch({ type: "set-layer-shape", id: layer.id, shape: layer.shape })
          if (layer.text) dispatch({ type: "set-layer-text", id: layer.id, text: layer.text })
          drawPathSelectionPreview(layer)
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
        dispatch({ type: "set-selection", selection: translateSelection(activeDoc, moved.x, moved.y) })
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
        commitSelection({
          bounds: { x: 0, y: y1, w: activeDoc.width, h: 1 },
          shape: "rect",
        })
      } else if (tool === "marquee-col") {
        const x1 = Math.max(0, Math.min(activeDoc.width - 1, Math.round(drag.start.x)))
        commitSelection({
          bounds: { x: x1, y: 0, w: 1, h: activeDoc.height },
          shape: "rect",
        })
      } else if (w > 0 && h > 0) {
        commitSelection({
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
        const anchors = selectPathAnchorsInRect(editablePath, { x, y, w, h })
        setDirectAnchorSelection(anchors.length ? { layerId: layer.id, anchors } : null)
        drawPathSelectionPreview(layer)
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
          commitSelection(selectionFromMask(mask, "freehand"))
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
        drawPathSelectionPreview(layer)
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
      if (w > 4 && h > 4 && activeDoc) applyCrop({ x, y, w, h })
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
        commitSelection({ bounds: b, shape: "freehand", mask })
      }
      return
    }

    if (drag.type === "freeform-path" && drag.points && activeDoc) {
      const points = simplifyFreeformPath(drag.points)
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
      commitGradient()
      syncActiveLayerHighBitFromCanvas()
      commit("Gradient", activeLayer ? [activeLayer.id] : undefined)
      return
    }

    if (drag.type === "transform") {
      drawingRef.current = { type: null }
      drawTransformHandles()
      return
    }

    if (drag.type === "pan") {
      drawingRef.current = { type: null }
      return
    }
  }

  /* ---- pointer cancel ---- */

  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
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
      commitActiveStroke()
      return
    }
    if (drag.type === "transform") {
      // Same as onPointerUp: the drag's effect is already in
      // transformRef; ending the drag keeps the session alive.
      drawingRef.current = { type: null }
      drawTransformHandles()
      return
    }
    drawingRef.current = { type: null }
    brushResizeRef.current = null
    removeRef.current = null
    smudgeBufferRef.current.reset()
    transparencyLockMaskRef.current = null
    selectionClipRef.current = null
    eraserSourceRef.current = null
    eraserSampleRef.current = null
    colorReplacementSourceRef.current = null
    colorReplacementSampleRef.current = null
    lastBrushPointerSampleRef.current = null
    selectionHitTesterRef.current = null
    highBitStrokeSourceRef.current = null
    const ov = overlayRef.current
    if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
    requestRender()
  }

  /* ---- double-click handlers ---- */

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!activeDoc) return
    const pt = getCanvasPoint(e.clientX, e.clientY)
    // commit pen path
    if ((tool === "pen" || tool === "curvature-pen") && pathDraftRef.current && pathDraftRef.current.points.length >= 2) {
      commitPath(false)
      return
    }
    // commit polygon lasso
    const drag = drawingRef.current
    if (drag.type === "polylasso" && drag.points && drag.points.length > 2 && activeDoc) {
      finalizePolyLasso(drag.points)
      drawingRef.current = { type: null }
      return
    }
    // Edit text on double click. Text is matched by its box rather than by
    // glyph coverage so clicking the gap between letters still enters editing.
    const textHit = pickTextLayerAt(activeDoc, pt)
    if (textHit) {
      if (transformRef.current) {
        transformRef.current = null
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
      beginTransform(hit)
    }
  }

  /* ---- key handlers (escape, enter for transform, delete pen point) ---- */

  const cancelBufferedStrokeRef = React.useRef(cancelBufferedStroke)
  const beginTransformRef = React.useRef(beginTransform)
  const commitTransformRef = React.useRef(commitTransform)
  const commitPathRef = React.useRef(commitPath)
  cancelBufferedStrokeRef.current = cancelBufferedStroke
  beginTransformRef.current = beginTransform
  commitTransformRef.current = commitTransform
  commitPathRef.current = commitPath

  React.useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
      if (handleBlurGalleryKeyDown(e)) return
      if (e.key === "Escape") {
        if (drawingRef.current.type === "stroke") {
          cancelBufferedStrokeRef.current()
          drawingRef.current = { type: null }
          smudgeBufferRef.current.reset()
          transparencyLockMaskRef.current = null
          selectionClipRef.current = null
        }
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
        const selected = directSelectionAnchorsFor(activeLayer.id)
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
          const path = editablePathForDirectSelection(activeLayer)
          if (path) {
            e.preventDefault()
            const anchors = selectAllPathAnchors(path)
            setDirectAnchorSelection(anchors.length ? { layerId: activeLayer.id, anchors } : null)
            drawPathSelectionPreviewRef.current(activeLayer)
          }
        } else if ((e.key === "Delete" || e.key === "Backspace") && selected.length) {
          e.preventDefault()
          if (activeLayer.path) {
            const path = deleteSelectedPathAnchors(activeLayer.path, selected)
            dispatch({ type: "set-layer-path", id: activeLayer.id, path })
            activeLayer.path = path
          } else if (activeLayer.shape) {
            const basePath = activeLayer.shape.computedPath ?? shapeToEditablePath(activeLayer.shape)
            const computedPath = deleteSelectedPathAnchors(basePath, selected)
            activeLayer.shape = { ...activeLayer.shape, computedPath }
            dispatch({ type: "set-layer-shape", id: activeLayer.id, shape: activeLayer.shape })
          }
          setDirectAnchorSelection(null)
          rerenderVectorLayerRef.current(activeLayer)
          drawPathSelectionPreviewRef.current(activeLayer)
          requestRender()
          commit("Delete Path Anchors", [activeLayer.id])
        } else if (e.key === "Escape" && selected.length) {
          setDirectAnchorSelection(null)
          drawPathSelectionPreviewRef.current(activeLayer)
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
  }, [activeLayer, requestRender, toggleQuickMask, activeDoc, handleBlurGalleryKeyDown, tool, dispatch, commit, setDirectAnchorSelection])

  React.useEffect(() => {
    function moveOptionsHandler() {
      if (tool !== "move" && tool !== "content-aware-move") return
      const options = getMoveRuntimeOptions()
      if (options.showTransformControls && layerAllowsMoving(activeLayer)) {
        beginTransform(activeLayer)
      } else if (!options.showTransformControls && transformRef.current) {
        transformRef.current = null
        const ov = overlayRef.current
        if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
        requestRender()
      }
    }
    const removeMoveOptions = addPhotoshopEventListener("ps-move-options-changed", moveOptionsHandler)
    moveOptionsHandler()
    return removeMoveOptions
    // Transform setup reads current refs and runtime options; adding beginTransform would resubscribe on every preview render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayer, tool, requestRender])

  /* ---- color picker HUD (Alt+Shift+RightClick) ---- */

  const [colorHud, setColorHud] = React.useState<{
    screenX: number
    screenY: number
    hsv: ColorPickerHudHsv
    pointerId: number
  } | null>(null)
  const colorHudRef = React.useRef<typeof colorHud>(null)
  React.useEffect(() => {
    colorHudRef.current = colorHud
  }, [colorHud])
  // External activation: a CustomEvent path so touch UI, the command palette,
  // or scripts can open the HUD at an arbitrary screen position. Pointer
  // capture is skipped — the HUD then commits on the next pointer up anywhere.
  React.useEffect(() => {
    function open(e: Event) {
      const detail = (e as CustomEvent<{ screenX?: number; screenY?: number }>).detail ?? {}
      const cx = typeof detail.screenX === "number"
        ? detail.screenX
        : Math.round(window.innerWidth / 2)
      const cy = typeof detail.screenY === "number"
        ? detail.screenY
        : Math.round(window.innerHeight / 2)
      setColorHud({
        screenX: cx,
        screenY: cy,
        hsv: hexToHsv(foreground),
        pointerId: -1,
      })
    }
    return addPhotoshopEventListener("ps-open-color-picker-hud", (_detail, event) => open(event))
  }, [foreground])
  React.useEffect(() => {
    if (!colorHud) return
    function move(e: PointerEvent) {
      const hud = colorHudRef.current
      if (!hud) return
      // pointerId -1 means the HUD was opened programmatically (no pointer
      // capture). Any pointer movement updates it; a click commits.
      if (hud.pointerId !== -1 && e.pointerId !== hud.pointerId) return
      const result = pickFromHud(hud, e.clientX, e.clientY)
      if (result.changed) {
        setColorHud((prev) => (prev ? { ...prev, hsv: result.hsv } : prev))
      }
    }
    function commitColor(e: PointerEvent) {
      const hud = colorHudRef.current
      if (!hud) return
      if (hud.pointerId !== -1 && e.pointerId !== hud.pointerId) return
      const hex = hsvToHex(hud.hsv.h, hud.hsv.s, hud.hsv.v)
      dispatch({ type: "set-foreground", color: hex })
      setColorHud(null)
    }
    function cancelOnEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setColorHud(null)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", commitColor)
    window.addEventListener("pointercancel", commitColor)
    window.addEventListener("keydown", cancelOnEsc)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", commitColor)
      window.removeEventListener("pointercancel", commitColor)
      window.removeEventListener("keydown", cancelOnEsc)
    }
  }, [colorHud, dispatch])

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

  // Free Transform / flip / rotate triggers from menu
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
      transformRef.current = null
      const ov = overlayRef.current
      if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
      requestRender()
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

  /* ---- Crop logic ---- */

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

  function drawPerspectiveCropPreview(pts: { x: number; y: number }[]) {
    const ov = overlayRef.current
    if (!ov || !activeDoc) return
    drawPerspectiveCropPreviewOverlay(ov, pts)
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


  /* ---- Polygon lasso finalize ---- */

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

  /* ---- Pen path commit ---- */

  function commitPath(closed: boolean) {
    if (!activeDoc || !pathDraftRef.current) return
    const draft = pathDraftRef.current
    pathDraftRef.current = null
    const ov = overlayRef.current
    if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
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

  function beginDirectSelectionAtPoint(e: Pick<React.PointerEvent<HTMLDivElement>, "shiftKey" | "altKey" | "ctrlKey" | "metaKey">, pt: { x: number; y: number }) {
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
      drawMarqueePreview(pt, pt)
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

  /** Stroke width the path preview renders at, derived from the brush size. */
  function vectorStrokeWidth() {
    return Math.max(1, brush.size / 4)
  }

  function rerenderVectorLayer(layer: Layer) {
    rerenderVectorLayerGeometry(layer, foreground, vectorStrokeWidth())
  }

  function updateDirectSelectionDrag(layer: Layer, pt: { x: number; y: number }, drag: typeof drawingRef.current, mirrorPathHandles = true, constrainMove = false) {
    applyDirectSelectionDrag(layer, pt, drag, {
      foreground,
      strokeWidth: vectorStrokeWidth(),
      mirrorPathHandles,
      constrainMove,
    })
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

  rerenderVectorLayerRef.current = rerenderVectorLayer
  drawPathSelectionPreviewRef.current = drawPathSelectionPreview

  function drawSliceSelectionPreview(slice: { x: number; y: number; w: number; h: number; name: string }) {
    const ov = overlayRef.current
    if (!ov) return
    drawSliceSelectionPreviewOverlay(ov, slice)
  }

  /* ---- Free Transform ---- */

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
    const ov = overlayRef.current
    if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
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

  const onPointerEnter = () => {
    const cur = cursorRef.current
    if (cur) cur.style.opacity = cur.firstElementChild ? "1" : "0"
  }
  const onPointerLeave = () => {
    const cur = cursorRef.current
    if (cur) cur.style.opacity = "0"
    // Keep strokes in progress on leave; captured pointerup still commits.
  }

  const showBrushCursor =
    tool === "brush" ||
    tool === "eraser" ||
    tool === "pencil" ||
    tool === "mixer-brush" ||
    tool === "color-replace" ||
    tool === "background-eraser" ||
    tool === "magic-eraser" ||
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
    tool === "red-eye" ||
    tool === "spot-healing" ||
    tool === "healing-brush" ||
    tool === "remove-tool" ||
    tool === "refine-edge-brush"

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
        <div
          data-testid="smart-filter-mask-edit-banner"
          className="absolute left-1/2 top-7 z-40 flex max-w-[min(520px,calc(100%-32px))] -translate-x-1/2 items-center gap-2 rounded-sm border border-cyan-300/40 bg-[rgba(12,18,24,0.94)] px-2.5 py-1.5 text-[11px] text-[var(--ps-text)] shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_0_2px_rgba(103,232,249,0.18)]" />
          <span className="min-w-0 truncate">
            Editing {activeSmartFilterMaskInfo.filterName} mask on {activeSmartFilterMaskInfo.layerName}
          </span>
          <span className="shrink-0 text-[var(--ps-text-dim)]">
            Density {activeSmartFilterMaskInfo.density}%
          </span>
          <span className="shrink-0 text-[var(--ps-text-dim)]">
            Feather {activeSmartFilterMaskInfo.feather} px
          </span>
          <button
            type="button"
            aria-label="Exit smart filter mask edit mode"
            className="ml-1 shrink-0 rounded-sm border border-[var(--ps-divider)] px-1.5 py-0.5 text-[10px] text-[var(--ps-text)] hover:bg-[var(--ps-tool-hover)]"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              dispatch({ type: "set-active-smart-filter-mask", target: null })
              requestRender()
            }}
          >
            Exit
          </button>
        </div>
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
          {tool === "lasso-magnetic" ? (
            <MagneticLassoIndicator
              width={selectionOptions.magneticWidth ?? 12}
              frequency={selectionOptions.magneticFrequency ?? 57}
            />
          ) : null}
          {canvasPrefs.showToolStatusHud && RETOUCH_FEEDBACK_TOOLS.has(tool) ? (
            <RetouchFeedbackOverlay
              tool={tool}
              model={buildRetouchingFeedbackModel({ tool, brush, cloneSource })}
              brushSize={brush.size}
              opacity={brush.opacity}
              flow={brush.flow}
            />
          ) : null}
          {activeDoc.selection.bounds && activeDoc.selection.mask ? (
            <MaskSelectionOverlay
              mask={activeDoc.selection.mask}
              docW={activeDoc.width}
              docH={activeDoc.height}
            />
          ) : activeDoc.selection.bounds ? (
            <SelectionOverlay
              bounds={activeDoc.selection.bounds}
              shape={activeDoc.selection.shape === "ellipse" ? "ellipse" : "rect"}
              docW={activeDoc.width}
              docH={activeDoc.height}
            />
          ) : null}
          {selectionTransformActive && activeDoc.selection.bounds ? (
            <SelectionTransformOverlay
              bounds={activeDoc.selection.bounds}
              docW={activeDoc.width}
              docH={activeDoc.height}
              zoom={viewZoom}
              onCommit={(t) => {
                dispatch({
                  type: "transform-selection",
                  scale: 1,
                  scaleX: t.scaleX,
                  scaleY: t.scaleY,
                  rotationDeg: t.rotationDeg,
                  translateX: t.translateX,
                  translateY: t.translateY,
                  smoothing: true,
                })
                setSelectionTransformActive(false)
              }}
              onCancel={() => setSelectionTransformActive(false)}
            />
          ) : null}
          {activeDoc.guides && activeDoc.guides.length ? (
            <GuidesOverlay
              guides={activeDoc.guides}
              docW={activeDoc.width}
              docH={activeDoc.height}
              onMove={(id, pos) => dispatch({ type: "move-guide", id, position: pos })}
              onRemove={(id) => dispatch({ type: "remove-guide", id })}
            />
          ) : null}
          {activeDoc.showSmartGuides !== false && tool === "move" && (
            <SmartGuidesOverlay
              layers={activeDoc.layers}
              activeLayerId={activeDoc.activeLayerId}
              docW={activeDoc.width}
              docH={activeDoc.height}
            />
          )}
          {activeDoc.showGrid && activeDoc.gridSize ? (
            <GridOverlay
              docW={activeDoc.width}
              docH={activeDoc.height}
              size={activeDoc.gridSize}
              color={activeDoc.gridColor ?? "#78b4ff"}
              subdivisions={activeDoc.gridSubdivisions ?? 1}
              opacity={activeDoc.gridOpacity ?? 0.42}
            />
          ) : null}
          {activeDoc.showPixelGrid && viewZoom >= 6 ? (
            <PixelGridOverlay zoom={viewZoom} />
          ) : null}
          {editingText && activeDoc ? (
            <TextEditOverlay
              doc={activeDoc}
              zoom={viewZoom}
              state={editingText}
              setState={setEditingText}
              commit={commitTextEdit}
              cancel={cancelTextEdit}
            />
          ) : null}
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
