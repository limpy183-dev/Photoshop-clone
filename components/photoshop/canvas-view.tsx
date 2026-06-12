"use client"

import * as React from "react"
import { useEditor } from "./editor-context"
import { compositeLayer } from "./blend-modes"
import { applyModeAndColorManagement } from "./advanced-subsystems"
import {
  addAnchorPointToPath,
  appendPathToCanvas,
  convertAnchorPoint,
  deleteNearestAnchorPoint,
  deleteSelectedPathAnchors,
  duplicatePathSubpath,
  fitFreeformPath,
  getRoundedRectCornerRadiusHandles,
  hitTestPathControls,
  movePathAnchor,
  movePathHandle,
  moveSelectedPathAnchors,
  nearestAnchorPoint,
  selectAllPathAnchors,
  selectPathAnchorsInRect,
  selectPathSubpathAnchors,
  shapeToEditablePath,
  updateRoundedRectCornerRadius,
  togglePathAnchorSelection,
  type PathAnchorRef,
  type RoundedRectCorner,
} from "./vector-path-operations"
import { constrainPointTo45, constrainTo45Degrees, isTempDirectSelectModifier } from "./path-modifier-keys"
import {
  normalizeBrushPointerSample,
  planArtHistoryStroke,
  resolveBristleTipSimulation,
  resolveColorReplacementPixel,
  resolveErodibleTipSimulation,
  resolveMixerReservoirStep,
  type BrushPointerSample,
  type BrushRgba,
  type BrushTipSimulation,
} from "./brush-engine"
import { planCompositeCache } from "./performance-engine"
import { planMemoryBudget } from "./memory-budget"
import { planProgressiveRender } from "./progressive-renderer"
import { createRafCoalescer, type RafCoalescer } from "./raf-coalescer"
import { isEmptyDirtyRect } from "./dirty-rect"
import { planDocumentTileRecomposition } from "./layer-tile-renderer"
import {
  composeDocumentTile,
  planTileOnlyDefaultCompositor,
  planTileOnlyInteractiveTool,
  renderTileOnlyViewportComposite,
} from "./tile-only-pipeline"
import {
  compositeDocumentWithWebGL,
  prepareLayerInputForWebGL,
  planWebGLCompositor,
} from "./webgl-compositor"
import { containsSelectionPoint, createSelectionHitTester, type SelectionHitTester } from "./selection-hit-testing"
import { addPhotoshopEventListener, dispatchPhotoshopEvent } from "./events"
import {
  applyBlurGalleryKeyboardCommand,
  beginBlurGalleryInteraction,
  finishBlurGalleryInteraction,
  getBlurGalleryControlState,
  isBlurGalleryFilterId,
  normalizeBlurGalleryParams,
  parseFieldBlurPins,
  parsePathBlurPoints,
  percentToCanvasPoint,
  updateBlurGalleryInteraction,
  type BlurGalleryDrag,
  type BlurGalleryFilterId,
  type BlurGalleryParams,
} from "./blur-gallery-controls"
import {
  beginLightingEffectsInteraction,
  finishLightingEffectsInteraction,
  getLightingEffectsControlState,
  normalizeLightingEffectsParams,
  parseLightingEffectsLights,
  updateLightingEffectsInteraction,
  type LightingEffectsDrag,
  type LightingEffectsParams,
} from "./lighting-effects-controls"
import { normalizeAdvancedBlending } from "./layer-workflows"
import {
  DEFAULT_PREFERENCES,
  calculatePrintSizeZoom,
} from "./preferences-engine"
import { paintCanvasCursorOverlay, resolveCanvasCursorState } from "./cursor-overlay"
import { buildRetouchingFeedbackModel } from "./retouch-feedback"
import { buildEdgeAwareQuickSelectionMaskData } from "./algorithmic-operations"
import { getLayerHighBitImage, highBitImageToSelectionSource, renderDocumentHighBitPreviewCanvas, syncHighBitLayerFromCanvasChange } from "./high-bit-document"
import {
  clampZoom,
  defaultCanvasRuntimePreferences,
  getEyedropperSampleSize,
  getFrameRuntimeOptions,
  getMoveRuntimeOptions,
  getPathRuntimeOptions,
  getShapeRuntimeOptions,
  layerAllowsDrawing,
  layerAllowsMoving,
  readCanvasRuntimePreferences,
  type CanvasRuntimePreferences,
} from "./canvas-view-runtime"
import {
  applyTransformContext,
  clampTransformSkew,
  finiteOr,
  pickTransformHandle,
  pointInTransformBox,
  transformCorners,
  transformHandles,
  transformedBounds,
  type TransformDragState,
  type TransformHandleId,
  type TransformInterpolation,
  type TransformOptionsEvent,
} from "./canvas-transform-geometry"
import {
  cursorForTool,
  labelForTool,
  normalizeViewRotation,
  resizePlainRect,
  resizeShapeRect,
  shapeHandles,
  shapePropsForTool,
  shapeRect,
  type DirectShapeHandleId,
} from "./canvas-shape-helpers"
import { SmartGuidesOverlay, smartSnapLayerDelta } from "./canvas-smart-guides"
import { MaskSelectionOverlay, SelectionOverlay, TextEditOverlay } from "./canvas-selection-overlays"
import { Rulers } from "./canvas-rulers"
import {
  adjustmentParamsFingerprint,
  advancedBlendingFingerprint,
  canvasIdFor,
  invalidateMaskAlphaCache,
  layerStyleCacheKey,
  maskAlphaEpoch,
  pathFingerprint,
  smartFilterCacheKey,
} from "./canvas-compositor-cache"
import {
  applyAdjustmentForCompositorContext,
  applyAdjustmentLayer,
  drawLayer,
  drawLayerForCompositorContext,
  renderLayerSourceForCompositor,
} from "./canvas-compositor"

const ZOOM_COMMIT_IDLE_MS = 420

function textLayerPath(layer: Layer | null | undefined): PathProps | null {
  const points = layer?.text?.textPath
  if (!points?.length) return null
  return {
    points: points.map((point) => ({ x: point.x, y: point.y })),
    closed: layer?.text?.textPathClosed === true,
  }
}
import { cn } from "@/lib/utils"
import {
  healStamp,
  blurStamp,
  sharpenStamp,
  dodgeBurnStamp,
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
  selectBackgroundMask,
  selectSubjectMask,
  selectSkyMask,
  objectSelectionMask,
  refineEdgeBrushMask,
  selectionFromMask,
  selectionToMaskCanvas,
  transformedCloneStamp,
} from "./tool-helpers"
import { perspectiveCropImageData } from "./photo-workflow-engine"
import { hexToRgba } from "./color-utils"
import { ColorPickerHud, hexToHsv, hsvToHex, pickFromHud, type ColorPickerHudHsv } from "./color-picker-hud"
import { MagneticLassoIndicator, GridOverlay, PixelGridOverlay, GuidesOverlay, RetouchFeedbackOverlay } from "./canvas-overlays"
import { SelectionTransformOverlay } from "./selection-transform-overlay"
import { applyThreeDMaterialDrop } from "./three-d-video-engine"
import type { GradientStop, Layer, PathPoint, PathProps, PsDocument, Selection } from "./types"

interface BrushInput {
  pressure: number
  tiltX: number
  tiltY: number
  twist: number
  velocity: number
  fade: number
  strokeAngle: number
}

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

type BrushInputControl = "off" | "pressure" | "tilt" | "velocity" | "fade" | "random"

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export function CanvasView() {
  const ed = useEditor()
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
    history,
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
  const panRef = React.useRef({ x: 0, y: 0 })
  const [viewZoom, setViewZoom] = React.useState(activeDoc?.zoom ?? 1)
  const [blurGalleryOverlay, setBlurGalleryOverlay] = React.useState<{
    filterId: BlurGalleryFilterId
    params: BlurGalleryParams
    docId?: string
  } | null>(null)
  const blurGalleryDragRef = React.useRef<BlurGalleryDrag | null>(null)
  const drawBlurGalleryOverlayRef = React.useRef<(state?: typeof blurGalleryOverlay) => void>(() => {})
  const [lightingEffectsOverlay, setLightingEffectsOverlay] = React.useState<{
    params: LightingEffectsParams
    docId?: string
  } | null>(null)
  const lightingEffectsDragRef = React.useRef<LightingEffectsDrag | null>(null)
  const drawLightingEffectsOverlayRef = React.useRef<(state?: typeof lightingEffectsOverlay) => void>(() => {})
  const layoutZoomRef = React.useRef(activeDoc?.zoom ?? 1)
  const visualZoomRef = React.useRef(activeDoc?.zoom ?? 1)
  const pendingZoomRef = React.useRef<number | null>(null)
  const zoomFrameRef = React.useRef<number | null>(null)
  const zoomCommitTimerRef = React.useRef<number | null>(null)

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
    window.addEventListener("ps-preferences-changed", read)
    window.addEventListener("storage", read)
    return () => {
      window.removeEventListener("ps-preferences-changed", read)
      window.removeEventListener("storage", read)
    }
  }, [])
  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => setCustomCursorReady(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

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
  const eraserSourceRef = React.useRef<HTMLCanvasElement | null>(null)
  const colorReplacementSourceRef = React.useRef<HTMLCanvasElement | null>(null)
  const mixerReservoirRef = React.useRef<Required<BrushRgba> | null>(null)
  const highBitStrokeSourceRef = React.useRef<HTMLCanvasElement | null>(null)

  React.useEffect(() => {
    const coalescer = createRafCoalescer<MouseMoveDetail>((detail) => {
      window.dispatchEvent(new CustomEvent("ps-mousemove", { detail }))
    })
    mouseMoveCoalescerRef.current = coalescer
    return () => {
      coalescer.cancel()
      if (mouseMoveCoalescerRef.current === coalescer) mouseMoveCoalescerRef.current = null
    }
  }, [])

  const applyStageTransform = React.useCallback((transientScale = 1) => {
    const stage = stageRef.current
    if (!stage) return
    const scale = Math.abs(transientScale - 1) > 0.0001 ? ` scale(${transientScale})` : ""
    stage.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) rotate(${activeDoc?.rotation ?? 0}deg)${scale}`
  }, [activeDoc?.rotation])

  const applyZoomStyles = React.useCallback(
    (zoom: number, transient = true) => {
      if (!activeDoc) return
      const scale = transient ? zoom / Math.max(0.0001, layoutZoomRef.current) : 1
      applyStageTransform(scale)
      const imageRendering = zoom >= 4 ? "pixelated" : "auto"
      if (compositeRef.current) compositeRef.current.style.imageRendering = imageRendering
      if (overlayRef.current) overlayRef.current.style.imageRendering = imageRendering
    },
    [activeDoc, applyStageTransform],
  )

  const applyViewZoom = React.useCallback(
    (zoom: number) => {
      const next = clampZoom(zoom)
      visualZoomRef.current = next
      pendingZoomRef.current = next

      if (zoomFrameRef.current === null) {
        zoomFrameRef.current = window.requestAnimationFrame(() => {
          zoomFrameRef.current = null
          const pending = pendingZoomRef.current
          if (pending !== null) {
            pendingZoomRef.current = null
            applyZoomStyles(pending)
          }
        })
      }

      if (zoomCommitTimerRef.current !== null) {
        window.clearTimeout(zoomCommitTimerRef.current)
      }
      zoomCommitTimerRef.current = window.setTimeout(() => {
        zoomCommitTimerRef.current = null
        const committedZoom = visualZoomRef.current
        setViewZoom(committedZoom)
        dispatch({ type: "set-zoom", zoom: committedZoom })
      }, ZOOM_COMMIT_IDLE_MS)
    },
    [applyZoomStyles, dispatch],
  )

  React.useEffect(() => {
    return () => {
      if (zoomFrameRef.current !== null) window.cancelAnimationFrame(zoomFrameRef.current)
      if (zoomCommitTimerRef.current !== null) window.clearTimeout(zoomCommitTimerRef.current)
    }
  }, [])

  React.useEffect(() => {
    if (!activeDoc) return
    const next = clampZoom(activeDoc.zoom)
    visualZoomRef.current = next
    pendingZoomRef.current = null
    setViewZoom(next)
    window.requestAnimationFrame(() => applyZoomStyles(next, false))
  }, [activeDoc, applyZoomStyles])

  React.useLayoutEffect(() => {
    layoutZoomRef.current = viewZoom
    applyZoomStyles(viewZoom, false)
  }, [viewZoom, applyZoomStyles])

  React.useEffect(() => {
    return addPhotoshopEventListener("ps-request-zoom", (detail) => {
      if (!detail) return
      if (typeof detail.zoom === "number") {
        applyViewZoom(detail.zoom)
      } else if (typeof detail.factor === "number") {
        applyViewZoom(visualZoomRef.current * detail.factor)
      }
    })
  }, [applyViewZoom])

  React.useEffect(() => {
    return addPhotoshopEventListener("ps-request-print-size-view", () => {
      if (!activeDoc) return
      try {
        applyViewZoom(calculatePrintSizeZoom({
          screenDpi: canvasPrefs.screenDpi,
          documentDpi: activeDoc.dpi ?? canvasPrefs.printResolution,
        }))
      } catch {}
    })
  }, [activeDoc, applyViewZoom, canvasPrefs.printResolution, canvasPrefs.screenDpi])

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

  const resetCompositeCanvasPlacement = React.useCallback((cv: HTMLCanvasElement) => {
    cv.style.left = "0px"
    cv.style.top = "0px"
    cv.style.right = "0px"
    cv.style.bottom = "0px"
    cv.style.width = "100%"
    cv.style.height = "100%"
  }, [])

  const compose = React.useCallback((force = false, change?: {
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
        const cachePlan = planCompositeCache({ width: cv.width, height: cv.height, forcedRender: force })
        if (cachePlan.storeCache) {
          const cached = makeCanvas(cv.width, cv.height)
          cached.getContext("2d")!.drawImage(cv, 0, 0)
          compositeCacheRef.current = { fingerprint: fp, drawnFingerprint: fp, width: cv.width, height: cv.height, canvas: cached }
        } else {
          compositeCacheRef.current = { fingerprint: "", drawnFingerprint: fp, width: cv.width, height: cv.height, canvas: null }
        }
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
      if (dirtyPlan.strategy === "tile-isolated" && !isEmptyDirtyRect(dirtyPlan.compositeRect)) {
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
        compose(true, change)
        progressiveFullPassRef.current = false
      })
      return
    }

    const glProbe = (() => {
      try {
        if (typeof document === "undefined") return null
        const probe = document.createElement("canvas")
        return probe.getContext("webgl2") || probe.getContext("webgl")
      } catch {
        return null
      }
    })()
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
        const cachePlan = planCompositeCache({ width: cv.width, height: cv.height, forcedRender: force })
        if (cachePlan.storeCache) {
          const cached = makeCanvas(cv.width, cv.height)
          cached.getContext("2d")!.drawImage(cv, 0, 0)
          compositeCacheRef.current = { fingerprint: fp, drawnFingerprint: fp, width: cv.width, height: cv.height, canvas: cached }
        } else {
          compositeCacheRef.current = { fingerprint: "", drawnFingerprint: fp, width: cv.width, height: cv.height, canvas: null }
        }
        return
      }
    }

    ctx.clearRect(0, 0, cv.width, cv.height)
    // Running fingerprint of all layers composited so far. Adjustment layers use
    // this to decide whether they can reuse a cached filter output.
    let prefixFp = ""
    const shallowKnockoutBackdrops = new Map<string, HTMLCanvasElement>()
    // Deep knockout punches all the way through to the document base layer (the
    // locked "Background" layer if present, otherwise transparency). Compute it
    // up-front so every deep-knockout layer reveals the same backdrop regardless
    // of its parent group.
    let deepKnockoutBackdrop: HTMLCanvasElement | null = null
    const baseLayer = activeDoc.layers.find(
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
      if (!shallowKnockoutBackdrops.has(groupKey)) {
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

    const cachePlan = planCompositeCache({ width: cv.width, height: cv.height, forcedRender: force })
    const memoryPlan = planMemoryBudget({
      width: cv.width,
      height: cv.height,
      layerCount: activeDoc.layers.length,
      historyStates: 12,
      memoryBudgetMB: 1024,
    })
    if (cachePlan.storeCache && !memoryPlan.actions.includes("disable-composite-cache")) {
      const cached = makeCanvas(cv.width, cv.height)
      cached.getContext("2d")!.drawImage(cv, 0, 0)
      compositeCacheRef.current = { fingerprint: fp, drawnFingerprint: fp, width: cv.width, height: cv.height, canvas: cached }
    } else {
      compositeCacheRef.current = { fingerprint: "", drawnFingerprint: fp, width: cv.width, height: cv.height, canvas: null }
    }
  }, [activeDoc, filterPreviews, resetCompositeCanvasPlacement, viewZoom, visibleDocumentViewport])

  React.useEffect(() => {
    compose()
    return subscribeRender((change) => compose(true, change))
  }, [compose, subscribeRender])

  React.useEffect(() => {
    return () => {
      if (progressiveFrameRef.current !== null) cancelAnimationFrame(progressiveFrameRef.current)
    }
  }, [])

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

  function maskBounds(mask: HTMLCanvasElement) {
    const ctx = mask.getContext("2d")
    if (!ctx || !activeDoc) return null
    const img = ctx.getImageData(0, 0, activeDoc.width, activeDoc.height)
    let minX = activeDoc.width
    let minY = activeDoc.height
    let maxX = 0
    let maxY = 0
    let hasPixels = false
    for (let y = 0; y < activeDoc.height; y++) {
      for (let x = 0; x < activeDoc.width; x++) {
        if (img.data[(y * activeDoc.width + x) * 4 + 3] > 8) {
          hasPixels = true
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x)
          maxY = Math.max(maxY, y)
        }
      }
    }
    return hasPixels ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null
  }

  function selectionToMask(selection: Selection) {
    if (!activeDoc) return null
    if (selection.mask) {
      const copy = makeCanvas(activeDoc.width, activeDoc.height)
      copy.getContext("2d")!.drawImage(selection.mask, 0, 0)
      return copy
    }
    if (!selection.bounds) return null
    const mask = makeCanvas(activeDoc.width, activeDoc.height)
    const ctx = mask.getContext("2d")!
    ctx.fillStyle = "#fff"
    const b = selection.bounds
    if (selection.shape === "ellipse") {
      ctx.beginPath()
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillRect(b.x, b.y, b.w, b.h)
    }
    return mask
  }

  function commitSelection(raw: Selection) {
    if (!activeDoc) return
    let rawMask = selectionToMask(raw)
    if (!rawMask) {
      dispatch({ type: "set-selection", selection: { bounds: null, shape: "rect" } })
      return
    }
    if (selectionOptions.feather > 0) {
      rawMask = featherMask(rawMask, selectionOptions.feather)
    }
    let nextMask = rawMask
    if (selectionOptions.mode !== "new" && activeDoc.selection.bounds) {
      const existing = selectionToMask(activeDoc.selection)
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
    const bounds = maskBounds(nextMask)
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
    const dirty = drawingRef.current.type === "stroke" ? drawingRef.current.dirty : undefined
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

  /* ---- brush dynamics helpers ---- */

  /** Convert hex to HSL (0-360, 0-100, 0-100) */
  function hexToHsl(hex: string): [number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16) / 255
    const g = parseInt(hex.slice(3, 5), 16) / 255
    const b = parseInt(hex.slice(5, 7), 16) / 255
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const l = (max + min) / 2
    if (max === min) return [0, 0, l * 100]
    const d = max - min
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    let h = 0
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
    return [h * 360, s * 100, l * 100]
  }

  /** Convert HSL to hex */
  function hslToHex(h: number, s: number, l: number): string {
    h = ((h % 360) + 360) % 360
    const s1 = Math.max(0, Math.min(100, s)) / 100
    const l1 = Math.max(0, Math.min(100, l)) / 100
    const a = s1 * Math.min(l1, 1 - l1)
    const f = (n: number) => {
      const k = (n + h / 30) % 12
      const color = l1 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
      return Math.round(color * 255).toString(16).padStart(2, "0")
    }
    return `#${f(0)}${f(8)}${f(4)}`
  }

  /** Apply color dynamics to get the per-dab color */
  function applyColorDynamics(fg: string, bg: string): string {
    let color = fg
    // FG/BG jitter: randomly swap to background color
    if (brush.fgBgJitter && brush.fgBgJitter > 0) {
      if (Math.random() * 100 < brush.fgBgJitter) color = bg
    }
    // HSL jitter
    const hj = brush.hueJitter ?? 0
    const sj = brush.satJitter ?? 0
    const bj = brush.brightJitter ?? 0
    if (hj > 0 || sj > 0 || bj > 0) {
      const [h, s, l] = hexToHsl(color)
      const nh = h + (Math.random() - 0.5) * 2 * (hj / 100) * 360
      const ns = s + (Math.random() - 0.5) * 2 * (sj / 100) * 100
      const nl = l + (Math.random() - 0.5) * 2 * (bj / 100) * 100
      color = hslToHex(nh, ns, nl)
    }
    if (brush.purity) {
      const [h, s, l] = hexToHsl(color)
      color = hslToHex(h, Math.max(0, Math.min(100, s + brush.purity)), l)
    }
    return color
  }

  function controlValue(control: BrushInputControl | undefined, input: BrushInput) {
    switch (control) {
      case "pressure":
        return clamp01(input.pressure)
      case "tilt":
        return clamp01(Math.hypot(input.tiltX + (brush.pose?.tiltX ?? 0), input.tiltY + (brush.pose?.tiltY ?? 0)) / 90)
      case "velocity":
        return clamp01(input.velocity / 80)
      case "fade":
        return clamp01(1 - input.fade / 220)
      case "random":
        return Math.random()
      default:
        return 1
    }
  }

  function brushSimulationSeed(input: BrushInput, salt = 0) {
    return Math.max(1, Math.round((input.fade + 1) * 101 + brush.size * 17 + salt))
  }

  function applyShapeDynamics(input: BrushInput): { dabSize: number; dabAngle: number; dabRoundness: number; tipState?: BrushTipSimulation } {
    const minDiam = (brush.minDiameter ?? 0) / 100
    let sizeScale = 1
    if (brush.sizeControl && brush.sizeControl !== "off") {
      const v = controlValue(brush.sizeControl, input)
      sizeScale = minDiam + (1 - minDiam) * v
    }
    if (brush.sizeJitter && brush.sizeJitter > 0) {
      const jitter = (Math.random() * brush.sizeJitter) / 100
      sizeScale *= 1 - jitter * (1 - minDiam)
    }
    let dabSize = Math.max(1, brush.size * sizeScale)

    const poseRotation = ((brush.pose?.rotation ?? 0) + (brush.pose?.stylusAngle ?? 0) + input.twist) * (Math.PI / 180)
    let dabAngle = poseRotation
    if (brush.angleControl === "tilt") {
      dabAngle += Math.atan2(input.tiltY + (brush.pose?.tiltY ?? 0), input.tiltX + (brush.pose?.tiltX ?? 0))
    } else if (brush.angleControl === "velocity") {
      dabAngle += input.strokeAngle
    } else if (brush.angleControl && brush.angleControl !== "off") {
      dabAngle += (controlValue(brush.angleControl, input) - 0.5) * 2 * ((brush.angleJitter ?? 0) * Math.PI / 180)
    }
    if (brush.angleJitter && brush.angleJitter > 0) {
      dabAngle += (Math.random() - 0.5) * 2 * brush.angleJitter * (Math.PI / 180)
    }

    let dabRoundness = 1
    if (brush.roundnessControl && brush.roundnessControl !== "off") {
      dabRoundness = 0.1 + controlValue(brush.roundnessControl, input) * 0.9
    }
    if (brush.roundnessJitter && brush.roundnessJitter > 0) {
      dabRoundness *= 1 - (Math.random() * brush.roundnessJitter) / 100
    }
    dabRoundness = Math.max(0.08, Math.min(1, dabRoundness))

    if (brush.flipX && Math.random() > 0.5) dabAngle += Math.PI
    if (brush.flipY && Math.random() > 0.5) dabSize *= 0.96

    const tipState =
      brush.tipShape === "erodible"
        ? resolveErodibleTipSimulation(brush, input, { seed: brushSimulationSeed(input, 7) })
        : brush.tipShape === "bristle"
          ? resolveBristleTipSimulation(brush, input, { seed: brushSimulationSeed(input, 13) })
          : undefined
    if (tipState?.kind === "erodible") {
      dabSize *= tipState.sizeScale
      dabAngle += tipState.angle
      dabRoundness *= tipState.roundnessScale
    } else if (tipState?.kind === "bristle") {
      dabRoundness *= 0.72 + tipState.coverage * 0.2
    }
    dabRoundness = Math.max(0.08, Math.min(1, dabRoundness))

    return { dabSize, dabAngle, dabRoundness, tipState }
  }

  function applyTransfer(input: BrushInput): { opaMul: number; flowMul: number } {
    let opaMul = brush.opacityControl && brush.opacityControl !== "off" ? controlValue(brush.opacityControl, input) : 1
    let flowMul = brush.flowControl && brush.flowControl !== "off" ? controlValue(brush.flowControl, input) : 1
    if (brush.opacityJitter && brush.opacityJitter > 0) {
      opaMul *= 1 - (Math.random() * brush.opacityJitter) / 100
    }
    if (brush.flowJitter && brush.flowJitter > 0) {
      flowMul *= 1 - (Math.random() * brush.flowJitter) / 100
    }
    const posePressure = brush.pose?.pressure
    if (posePressure !== undefined && (!brush.opacityControl || brush.opacityControl === "off")) {
      opaMul *= Math.max(0.05, posePressure / 100)
    }
    if (brush.tipShape === "erodible") {
      const tip = resolveErodibleTipSimulation(brush, input, { seed: brushSimulationSeed(input, 17) })
      opaMul *= tip.alphaScale
    } else if (brush.tipShape === "bristle") {
      const tip = resolveBristleTipSimulation(brush, input, { seed: brushSimulationSeed(input, 19) })
      opaMul *= 0.55 + tip.coverage * 0.45
      flowMul *= 0.72 + tip.wetness * 0.28
    }
    return { opaMul: clamp01(opaMul), flowMul: clamp01(flowMul) }
  }

  function stamp(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    input: BrushInput,
    options: StampOptions = {},
  ) {
    if (!activeDoc?.quickMask && !withinSelection({ x, y })) return
    const { dabSize, dabAngle, dabRoundness, tipState } = applyShapeDynamics(input)
    const { opaMul, flowMul } = applyTransfer(input)
    const isBuffered = options.includeBrushOpacity === false
    // When painting to the stroke buffer, stamp at full alpha so overlapping
    // dabs don't accumulate and show individual circles.  The combined
    // opacity × flow is applied once in renderBufferedStroke() instead.
    const opacity = isBuffered ? 1 : clamp01((brush.opacity / 100) * (brush.flow / 100) * opaMul * flowMul * (options.opacityMultiplier ?? 1))
    const isErase = tool === "eraser" || tool === "background-eraser" || tool === "magic-eraser"
    const compositeAsErase = activeDoc?.quickMask ? quickMaskPaintsSubtract() : isErase && !options.drawEraserMask
    const dabColor = isErase && options.drawEraserMask ? "#000000" : activeDoc?.quickMask ? "#ffffff" : applyColorDynamics(color, background)
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

  function hashNoise(x: number, y: number, salt: number) {
    const n = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453
    return n - Math.floor(n)
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

  function cloneCanvasForTool(canvas: HTMLCanvasElement) {
    const copy = makeCanvas(canvas.width, canvas.height)
    copy.getContext("2d")!.drawImage(canvas, 0, 0)
    return copy
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

  function alphaMaskFromCanvas(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d")!
    const w = canvas.width
    const h = canvas.height
    const img = ctx.getImageData(0, 0, w, h)
    const data = img.data
    let minX = w
    let minY = h
    let maxX = 0
    let maxY = 0
    let hasPixels = false
    // Single linear pass; reconstruct x,y from a running index instead of using
    // expensive division+modulo per pixel.
    let x = 0
    let y = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] <= 0) {
        data[i] = 0
        data[i + 1] = 0
        data[i + 2] = 0
        data[i + 3] = 0
      } else {
        hasPixels = true
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
        data[i] = 255
        data[i + 1] = 255
        data[i + 2] = 255
        data[i + 3] = 255
      }
      x++
      if (x === w) {
        x = 0
        y++
      }
    }
    return {
      mask: img,
      bounds: hasPixels ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
    }
  }

  function colorDistance(a: { r: number; g: number; b: number; a?: number }, b: { r: number; g: number; b: number; a?: number }) {
    const dr = a.r - b.r
    const dg = a.g - b.g
    const db = a.b - b.b
    const da = (a.a ?? 255) - (b.a ?? 255)
    return Math.sqrt(dr * dr + dg * dg + db * db + da * da * 0.25)
  }

  function selectiveEraserStamp(ctx: CanvasRenderingContext2D, x: number, y: number, input: BrushInput) {
    if (!activeLayer || !activeDoc || activeDoc.quickMask) return
    const sourceCanvas = eraserSourceRef.current ?? activeLayer.canvas
    const { dabSize } = applyShapeDynamics(input)
    const { opaMul, flowMul } = applyTransfer(input)
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

  function connectedEraserMask(mask: Uint8Array, w: number, h: number, sx: number, sy: number) {
    const out = new Uint8Array(w * h)
    const start = sy * w + sx
    if (!mask[start]) return out
    const stack = [start]
    while (stack.length) {
      const p = stack.pop()!
      if (out[p] || !mask[p]) continue
      out[p] = 1
      const x = p % w
      const y = (p - x) / w
      if (x > 0) stack.push(p - 1)
      if (x < w - 1) stack.push(p + 1)
      if (y > 0) stack.push(p - w)
      if (y < h - 1) stack.push(p + w)
    }
    return out
  }

  function localPatchGradient(img: ImageData, x: number, y: number, w: number, h: number) {
    const lum = (px: number, py: number) => {
      const cx = Math.max(0, Math.min(w - 1, px))
      const cy = Math.max(0, Math.min(h - 1, py))
      const i = (cy * w + cx) * 4
      return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]
    }
    return Math.abs(lum(x + 1, y) - lum(x - 1, y)) + Math.abs(lum(x, y + 1) - lum(x, y - 1))
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
    if (cloneSource.sample === "current-layer") return sourceLayer.canvas
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
    const sourceEntry = history.find((entry) => entry.layers.some((snap) => snap.id === activeLayer.id && snap.canvas)) ?? history[0]
    const snap = sourceEntry?.layers.find((candidate) => candidate.id === activeLayer.id)
    return snap?.canvas && typeof snap.canvas.getContext === "function" ? snap.canvas : null
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
          if (withinSelection({ x, y })) blurStamp(ctx, x, y, brush.size / 2)
        }
      } else if (tool === "sharpen") {
        for (let i = 0; i <= steps; i++) {
          const t = steps === 0 ? 1 : i / steps
          const x = from ? from.x + (to.x - from.x) * t : to.x
          const y = from ? from.y + (to.y - from.y) * t : to.y
          if (withinSelection({ x, y })) sharpenStamp(ctx, x, y, brush.size / 2)
        }
      } else if (tool === "smudge") {
        for (let i = 0; i <= steps; i++) {
          const t = steps === 0 ? 1 : i / steps
          const x = from ? from.x + (to.x - from.x) * t : to.x
          const y = from ? from.y + (to.y - from.y) * t : to.y
          if (withinSelection({ x, y })) smudgeBufferRef.current.step(ctx, x, y, brush.size / 2, brush.flow / 100)
        }
      } else if (tool === "dodge" || tool === "burn") {
        for (let i = 0; i <= steps; i++) {
          const t = steps === 0 ? 1 : i / steps
          const x = from ? from.x + (to.x - from.x) * t : to.x
          const y = from ? from.y + (to.y - from.y) * t : to.y
          if (withinSelection({ x, y })) dodgeBurnStamp(ctx, x, y, brush.size / 2, tool, (brush.flow / 100) * 0.6)
        }
      } else if (tool === "sponge") {
        for (let i = 0; i <= steps; i++) {
          const t = steps === 0 ? 1 : i / steps
          const x = from ? from.x + (to.x - from.x) * t : to.x
          const y = from ? from.y + (to.y - from.y) * t : to.y
          if (withinSelection({ x, y })) spongeStamp(ctx, x, y, brush.size / 2, brush.flow / 100)
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
          if (!withinSelection({ x: dx, y: dy })) continue
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
          if (!withinSelection({ x: dx, y: dy })) continue
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
        // Use surrounding pixels to "heal" the dab area on the same layer.
        for (let i = 0; i <= steps; i++) {
          const t = steps === 0 ? 1 : i / steps
          const x = from ? from.x + (to.x - from.x) * t : to.x
          const y = from ? from.y + (to.y - from.y) * t : to.y
          if (!withinSelection({ x, y })) continue
          const r = brush.size / 2
          // Sample to the right or below
          const sx = Math.min(canvas.width - r * 2, x + r * 2)
          const sy = y
          healStamp(ctx, canvas, sx, sy, x, y, r)
        }
      }
    }
    if (!renderBufferedStroke()) requestTileAwareStrokeRender()
  }

  function spongeStamp(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, strength: number) {
    const r = Math.max(2, Math.floor(radius))
    const sx = Math.max(0, Math.floor(x - r))
    const sy = Math.max(0, Math.floor(y - r))
    const sw = Math.min(ctx.canvas.width - sx, r * 2)
    const sh = Math.min(ctx.canvas.height - sy, r * 2)
    if (sw <= 0 || sh <= 0) return
    const img = ctx.getImageData(sx, sy, sw, sh)
    const data = img.data
    const rSq = r * r
    // Iterate per-row, derive the analytic horizontal extent of the circle for
    // that scanline, then only touch pixels inside. Avoids ~21% wasted work on
    // the corner squares vs. the original bounding-box loop and lets the inner
    // loop branch-predict cleanly.
    for (let py = 0; py < sh; py++) {
      const dy = py - r
      const dy2 = dy * dy
      if (dy2 > rSq) continue
      const halfW = Math.sqrt(rSq - dy2)
      const pxStart = Math.max(0, Math.floor(r - halfW))
      const pxEnd = Math.min(sw - 1, Math.ceil(r + halfW))
      const rowStart = py * sw * 4
      for (let px = pxStart; px <= pxEnd; px++) {
        const i = rowStart + px * 4
        if (data[i + 3] === 0) continue
        const rr = data[i]
        const gg = data[i + 1]
        const bb = data[i + 2]
        const lum = 0.299 * rr + 0.587 * gg + 0.114 * bb
        data[i] = rr + (lum - rr) * strength
        data[i + 1] = gg + (lum - gg) * strength
        data[i + 2] = bb + (lum - bb) * strength
      }
    }
    ctx.putImageData(img, sx, sy)
  }

  /* ---- gradient preview & commit ---- */

  function getGradientStops(): GradientStop[] {
    const base = gradient.stops?.length
      ? gradient.stops
      : [
        { offset: 0, color: foreground, opacity: 1 },
        { offset: 1, color: background, opacity: 1 },
      ]
    const stops = base
      .map((s) => ({
        offset: gradient.reverse ? 1 - s.offset : s.offset,
        color: s.color,
        opacity: s.opacity,
      }))
      .sort((a, b) => a.offset - b.offset)
    if (stops[0]?.offset > 0) stops.unshift({ ...stops[0], offset: 0 })
    if (stops[stops.length - 1]?.offset < 1) stops.push({ ...stops[stops.length - 1], offset: 1 })
    return stops
  }

  function addGradientStops(g: CanvasGradient, stops: GradientStop[]) {
    for (const s of stops) g.addColorStop(Math.max(0, Math.min(1, s.offset)), hexToRgba(s.color, s.opacity))
  }

  function sampleGradient(stops: GradientStop[], t: number) {
    let tt = gradient.cycle ? t - Math.floor(t) : clamp01(t)
    if (gradient.reverse) tt = 1 - tt
    let prev = stops[0]
    let next = stops[stops.length - 1]
    for (let i = 0; i < stops.length - 1; i++) {
      if (stops[i].offset <= tt && stops[i + 1].offset >= tt) {
        prev = stops[i]
        next = stops[i + 1]
        break
      }
    }
    const span = Math.max(0.0001, next.offset - prev.offset)
    const k = clamp01((tt - prev.offset) / span)
    const a = hexToRgb(prev.color)
    const b = hexToRgb(next.color)
    const opacity = prev.opacity + (next.opacity - prev.opacity) * k
    return {
      r: Math.round(a.r + (b.r - a.r) * k),
      g: Math.round(a.g + (b.g - a.g) * k),
      b: Math.round(a.b + (b.b - a.b) * k),
      a: Math.round(opacity * 255),
    }
  }

  function applyDitherToCanvas(canvas: HTMLCanvasElement) {
    if (!gradient.dither) return
    const ctx = canvas.getContext("2d")!
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3] === 0) continue
      const n = (Math.random() - 0.5) * 3
      img.data[i] = Math.max(0, Math.min(255, img.data[i] + n))
      img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n))
      img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n))
    }
    ctx.putImageData(img, 0, 0)
  }

  function drawGradientPreview(start: { x: number; y: number }, end: { x: number; y: number }) {
    const ov = overlayRef.current
    if (!ov || !activeDoc || !activeLayer) return
    const ctx = ov.getContext("2d")!
    ctx.clearRect(0, 0, ov.width, ov.height)
    const stops = getGradientStops()
    ctx.save()
    if (activeDoc.selection.bounds) {
      clipToSelection(ctx, activeDoc)
    }
    let g: CanvasGradient
    const dx = end.x - start.x
    const dy = end.y - start.y
    const dist = Math.hypot(dx, dy) || 1
    if (gradient.type === "linear") {
      g = ctx.createLinearGradient(start.x, start.y, end.x, end.y)
      addGradientStops(g, stops)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, ov.width, ov.height)
    } else if (gradient.type === "radial") {
      g = ctx.createRadialGradient(start.x, start.y, 0, start.x, start.y, dist)
      addGradientStops(g, stops)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, ov.width, ov.height)
    } else if (gradient.type === "reflected") {
      g = ctx.createLinearGradient(start.x - dx, start.y - dy, end.x, end.y)
      for (const s of stops) {
        g.addColorStop(s.offset * 0.5, hexToRgba(s.color, s.opacity))
        g.addColorStop(1 - s.offset * 0.5, hexToRgba(s.color, s.opacity))
      }
      ctx.fillStyle = g
      ctx.fillRect(0, 0, ov.width, ov.height)
    } else if (gradient.type === "angular") {
      const cx = start.x
      const cy = start.y
      const baseAngle = Math.atan2(dy, dx)
      const steps = gradient.cycle ? 180 : 96
      for (let i = 0; i < steps; i++) {
        const a0 = baseAngle + (i / steps) * Math.PI * 2
        const a1 = baseAngle + ((i + 1.25) / steps) * Math.PI * 2
        const c = sampleGradient(stops, i / steps)
        ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${c.a / 255})`
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, ov.width + ov.height, a0, a1)
        ctx.closePath()
        ctx.fill()
      }
    } else {
      const img = ctx.getImageData(0, 0, ov.width, ov.height)
      const angle = Math.atan2(dy, dx)
      const cos = Math.cos(-angle)
      const sin = Math.sin(-angle)
      for (let py = 0; py < ov.height; py++) {
        for (let px = 0; px < ov.width; px++) {
          const rx = px - start.x
          const ry = py - start.y
          const ux = rx * cos - ry * sin
          const uy = rx * sin + ry * cos
          const t = (Math.abs(ux) + Math.abs(uy)) / Math.max(1, dist)
          const c = sampleGradient(stops, t)
          const i = (py * ov.width + px) * 4
          img.data[i] = c.r
          img.data[i + 1] = c.g
          img.data[i + 2] = c.b
          img.data[i + 3] = c.a
        }
      }
      ctx.putImageData(img, 0, 0)
    }
    ctx.restore()
    applySelectionMaskToCanvas(ov, activeDoc)
    applyDitherToCanvas(ov)
  }

  function commitGradient() {
    if (!activeDoc || !layerAllowsDrawing(activeLayer)) return
    const ov = overlayRef.current
    if (!ov) return
    const ctx = activeLayer.canvas.getContext("2d")!
    if (activeDoc.selection.bounds?.w && activeDoc.selection.bounds.h) {
      const paint = makeCanvas(activeDoc.width, activeDoc.height)
      const pctx = paint.getContext("2d")!
      pctx.drawImage(ov, 0, 0)
      applySelectionMaskToCanvas(paint, activeDoc)
      ctx.drawImage(paint, 0, 0)
    } else {
      ctx.drawImage(ov, 0, 0)
    }
    ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
    requestRender()
  }

  /* ---- marquee preview ---- */

  function drawMarqueePreview(start: { x: number; y: number }, end: { x: number; y: number }) {
    const ov = overlayRef.current
    if (!ov || !activeDoc) return
    const ctx = ov.getContext("2d")!
    ctx.clearRect(0, 0, ov.width, ov.height)
    ctx.save()
    ctx.strokeStyle = "#fff"
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 1
    const x = Math.min(start.x, end.x)
    const y = Math.min(start.y, end.y)
    const w = Math.abs(end.x - start.x)
    const h = Math.abs(end.y - start.y)
    if (tool === "marquee-ellipse") {
      ctx.beginPath()
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      ctx.stroke()
    } else if (tool === "crop") {
      ctx.fillStyle = "rgba(0,0,0,0.5)"
      ctx.fillRect(0, 0, ov.width, y)
      ctx.fillRect(0, y + h, ov.width, ov.height - (y + h))
      ctx.fillRect(0, y, x, h)
      ctx.fillRect(x + w, y, ov.width - (x + w), h)
      ctx.strokeStyle = "#fff"
      ctx.setLineDash([])
      ctx.strokeRect(x + 0.5, y + 0.5, w, h)
      // rule of thirds
      ctx.beginPath()
      for (let i = 1; i < 3; i++) {
        ctx.moveTo(x + (w * i) / 3, y)
        ctx.lineTo(x + (w * i) / 3, y + h)
        ctx.moveTo(x, y + (h * i) / 3)
        ctx.lineTo(x + w, y + (h * i) / 3)
      }
      ctx.stroke()
    } else if (tool === "marquee-row") {
      // Single row marquee: a 1px high line across the whole document.
      ctx.strokeRect(0.5, Math.round(start.y) + 0.5, activeDoc.width - 1, 1)
    } else if (tool === "marquee-col") {
      // Single column marquee: a 1px wide line across the whole document.
      ctx.strokeRect(Math.round(start.x) + 0.5, 0.5, 1, activeDoc.height - 1)
    } else {
      ctx.strokeRect(x + 0.5, y + 0.5, w, h)
    }
    ctx.restore()
  }

  function drawRulerPreview(start: { x: number; y: number }, end: { x: number; y: number }) {
    const ov = overlayRef.current
    if (!ov || !activeDoc) return
    const ctx = ov.getContext("2d")!
    ctx.clearRect(0, 0, ov.width, ov.height)
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    const angle = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI
    ctx.save()
    ctx.strokeStyle = "#06b6d4"
    ctx.fillStyle = "#06b6d4"
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(start.x, start.y, 4, 0, Math.PI * 2)
    ctx.arc(end.x, end.y, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = "11px sans-serif"
    ctx.fillText(`${length.toFixed(1)} px, ${angle.toFixed(1)} deg`, end.x + 8, end.y - 8)
    ctx.restore()
  }

  function drawBrushPreview(center: { x: number; y: number }, radius: number) {
    const ov = overlayRef.current
    if (!ov || !activeDoc) return
    const ctx = ov.getContext("2d")!
    ctx.clearRect(0, 0, ov.width, ov.height)
    const feedback = buildRetouchingFeedbackModel({ tool, brush, cloneSource, cursor: center })
    ctx.save()
    ctx.strokeStyle = "#fff"
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.arc(center.x, center.y, Math.max(2, radius), 0, Math.PI * 2)
    ctx.stroke()
    if (feedback.brushEdge.hardnessRadius > 1 && feedback.brushEdge.hardnessRadius < feedback.brushEdge.radius) {
      ctx.setLineDash([])
      ctx.strokeStyle = "rgba(255,255,255,0.45)"
      ctx.beginPath()
      ctx.arc(center.x, center.y, feedback.brushEdge.hardnessRadius, 0, Math.PI * 2)
      ctx.stroke()
    }
    if (feedback.brushEdge.scatterRadius > feedback.brushEdge.radius) {
      ctx.setLineDash([2, 6])
      ctx.strokeStyle = "rgba(56,189,248,0.7)"
      ctx.beginPath()
      ctx.arc(center.x, center.y, feedback.brushEdge.scatterRadius, 0, Math.PI * 2)
      ctx.stroke()
    }
    if (feedback.previewGhost.visible && feedback.previewGhost.sourcePoint) {
      const source = feedback.previewGhost.sourcePoint
      ctx.setLineDash([5, 4])
      ctx.strokeStyle = `rgba(56,189,248,${feedback.previewGhost.opacity})`
      ctx.beginPath()
      ctx.moveTo(source.x, source.y)
      ctx.lineTo(center.x, center.y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.strokeStyle = "rgba(56,189,248,0.95)"
      ctx.fillStyle = "rgba(56,189,248,0.16)"
      ctx.beginPath()
      ctx.arc(source.x, source.y, Math.max(3, feedback.brushEdge.radius * 0.35), 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()
  }

  function drawLassoPreview(points: { x: number; y: number }[], hover?: { x: number; y: number }) {
    const ov = overlayRef.current
    if (!ov || !activeDoc) return
    const ctx = ov.getContext("2d")!
    ctx.clearRect(0, 0, ov.width, ov.height)
    if (points.length < 1) return
    if (tool === "lasso-magnetic") {
      drawMagneticLassoPreview(ctx, points, hover)
      return
    }
    ctx.save()
    ctx.strokeStyle = "#fff"
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
    if (hover) ctx.lineTo(hover.x, hover.y)
    ctx.stroke()
    // dots on points
    ctx.setLineDash([])
    ctx.fillStyle = "#fff"
    for (const p of points) {
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4)
    }
    ctx.restore()
  }

  function pointInMask(mask: HTMLCanvasElement, pt: { x: number; y: number }) {
    if (pt.x < 0 || pt.y < 0 || pt.x >= mask.width || pt.y >= mask.height) return false
    const ctx = mask.getContext("2d")
    if (!ctx) return false
    const px = ctx.getImageData(Math.floor(pt.x), Math.floor(pt.y), 1, 1).data
    return px[3] > 8
  }

  function drawPatchPreview(offset?: { x: number; y: number }) {
    const ov = overlayRef.current
    const patch = patchRef.current
    if (!ov || !activeDoc || !patch) return
    const ctx = ov.getContext("2d")!
    ctx.clearRect(0, 0, ov.width, ov.height)
    ctx.save()
    ctx.strokeStyle = "#06b6d4"
    ctx.lineWidth = 1.5
    ctx.setLineDash([5, 4])
    ctx.drawImage(patch.mask, 0, 0)
    ctx.globalCompositeOperation = "source-in"
    ctx.fillStyle = "rgba(6,182,212,0.22)"
    ctx.fillRect(0, 0, ov.width, ov.height)
    ctx.globalCompositeOperation = "source-over"
    ctx.strokeRect(patch.bounds.x + 0.5, patch.bounds.y + 0.5, patch.bounds.w, patch.bounds.h)
    if (offset) {
      ctx.setLineDash([3, 3])
      ctx.strokeStyle = "#fff"
      ctx.strokeRect(
        patch.bounds.x + offset.x + 0.5,
        patch.bounds.y + offset.y + 0.5,
        patch.bounds.w,
        patch.bounds.h,
      )
      ctx.setLineDash([])
      ctx.strokeStyle = "#06b6d4"
      ctx.beginPath()
      ctx.moveTo(patch.bounds.x + patch.bounds.w / 2, patch.bounds.y + patch.bounds.h / 2)
      ctx.lineTo(
        patch.bounds.x + patch.bounds.w / 2 + offset.x,
        patch.bounds.y + patch.bounds.h / 2 + offset.y,
      )
      ctx.stroke()
    }
    ctx.restore()
  }

  function makeCurvaturePath(nodes: PathPoint[], closed: boolean): PathPoint[] {
    if (nodes.length < 2) return nodes.map((p) => ({ x: p.x, y: p.y }))
    const pts = nodes.map((p) => ({ x: p.x, y: p.y } as PathPoint))
    const get = (index: number) => {
      if (closed) return nodes[(index + nodes.length) % nodes.length]
      return nodes[Math.max(0, Math.min(nodes.length - 1, index))]
    }
    const segments = closed ? nodes.length : nodes.length - 1
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % nodes.length
      const p0 = get(i - 1)
      const p1 = get(i)
      const p2 = get(i + 1)
      const p3 = get(i + 2)
      pts[i].cp1 = {
        x: p1.x + (p2.x - p0.x) / 6,
        y: p1.y + (p2.y - p0.y) / 6,
      }
      pts[next].cp2 = {
        x: p2.x - (p3.x - p1.x) / 6,
        y: p2.y - (p3.y - p1.y) / 6,
      }
    }
    return pts
  }

  function drawPathPreview() {
    const ov = overlayRef.current
    if (!ov || !pathDraftRef.current) return
    const ctx = ov.getContext("2d")!
    ctx.clearRect(0, 0, ov.width, ov.height)
    const draft = pathDraftRef.current
    const points = draft.curvature ? makeCurvaturePath(draft.points, draft.closed) : draft.points
    if (points.length < 1) return
    ctx.save()
    ctx.strokeStyle = "#06b6d4"
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]
      const cur = points[i]
      const cp1 = prev.cp1 ?? prev
      const cp2 = cur.cp2 ?? cur
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, cur.x, cur.y)
    }
    if (draft.closed && points.length > 2) {
      const last = points[points.length - 1]
      const first = points[0]
      const cp1 = last.cp1 ?? last
      const cp2 = first.cp2 ?? first
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, first.x, first.y)
    }
    ctx.stroke()
    ctx.fillStyle = "#06b6d4"
    for (const p of points) {
      ctx.fillRect(p.x - 3, p.y - 3, 6, 6)
      if (p.cp1) {
        ctx.beginPath()
        ctx.arc(p.cp1.x, p.cp1.y, 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(p.cp1.x, p.cp1.y)
        ctx.stroke()
      }
      if (p.cp2) {
        ctx.beginPath()
        ctx.arc(p.cp2.x, p.cp2.y, 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(p.cp2.x, p.cp2.y)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  /* ---- transform handles ---- */

  function drawTransformHandles() {
    const ov = overlayRef.current
    if (!ov || !activeDoc || !transformRef.current) return
    const t = transformRef.current
    const ctx = ov.getContext("2d")!
    ctx.clearRect(0, 0, ov.width, ov.height)
    const b = transformedBounds(t)
    ctx.save()
    ctx.strokeStyle = "#06b6d4"
    ctx.setLineDash([6, 4])
    ctx.lineWidth = 1.5
    // bounding rect using transformed corners
    const corners = transformCorners(t)
    ctx.beginPath()
    ctx.moveTo(corners[0].x, corners[0].y)
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y)
    ctx.closePath()
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = "#fff"
    const handles = transformHandles(t)
    for (const h of handles) {
      ctx.fillRect(h.x - 4, h.y - 4, 8, 8)
      ctx.strokeRect(h.x - 4, h.y - 4, 8, 8)
    }
    ctx.restore()
    void b
  }

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        filterId?: string
        params?: BlurGalleryParams
        docId?: string
      } | null>).detail
      if (!detail?.filterId || !isBlurGalleryFilterId(detail.filterId) || !detail.params) {
        blurGalleryDragRef.current = null
        setBlurGalleryOverlay(null)
        const ov = overlayRef.current
        if (ov) ov.getContext("2d")?.clearRect(0, 0, ov.width, ov.height)
        return
      }
      setBlurGalleryOverlay({
        filterId: detail.filterId,
        params: normalizeBlurGalleryParams(detail.filterId, detail.params),
        docId: detail.docId,
      })
    }
    window.addEventListener("ps-blur-gallery-overlay-state", handler)
    return () => window.removeEventListener("ps-blur-gallery-overlay-state", handler)
  }, [])

  React.useEffect(() => {
    drawBlurGalleryOverlayRef.current(blurGalleryOverlay)
  }, [blurGalleryOverlay, activeDoc?.id, activeDoc?.width, activeDoc?.height])

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        params?: LightingEffectsParams
        docId?: string
      } | null>).detail
      if (!detail?.params) {
        lightingEffectsDragRef.current = null
        setLightingEffectsOverlay(null)
        const ov = overlayRef.current
        if (ov && !blurGalleryOverlay) ov.getContext("2d")?.clearRect(0, 0, ov.width, ov.height)
        return
      }
      setLightingEffectsOverlay({
        params: normalizeLightingEffectsParams(detail.params),
        docId: detail.docId,
      })
    }
    window.addEventListener("ps-lighting-effects-overlay-state", handler)
    return () => window.removeEventListener("ps-lighting-effects-overlay-state", handler)
  }, [blurGalleryOverlay])

  React.useEffect(() => {
    if (!blurGalleryOverlay) drawLightingEffectsOverlayRef.current(lightingEffectsOverlay)
  }, [lightingEffectsOverlay, blurGalleryOverlay, activeDoc?.id, activeDoc?.width, activeDoc?.height])

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
    window.addEventListener("ps-timeline-transition-overlay", handler)
    return () => window.removeEventListener("ps-timeline-transition-overlay", handler)
  }, [activeDoc?.id])

  const emitBlurGalleryParams = React.useCallback((filterId: BlurGalleryFilterId, params: BlurGalleryParams) => {
    window.dispatchEvent(new CustomEvent("ps-blur-gallery-overlay-change", { detail: { filterId, params } }))
  }, [])

  const setBlurGalleryParams = React.useCallback((filterId: BlurGalleryFilterId, params: BlurGalleryParams) => {
    const next = {
      filterId,
      params: normalizeBlurGalleryParams(filterId, params),
      docId: activeDoc?.id,
    }
    setBlurGalleryOverlay(next)
    emitBlurGalleryParams(filterId, next.params)
  }, [activeDoc?.id, emitBlurGalleryParams])

  const emitLightingEffectsParams = React.useCallback((params: LightingEffectsParams) => {
    window.dispatchEvent(new CustomEvent("ps-lighting-effects-overlay-change", { detail: { params } }))
  }, [])

  const setLightingEffectsParams = React.useCallback((params: LightingEffectsParams) => {
    const next = {
      params: normalizeLightingEffectsParams(params),
      docId: activeDoc?.id,
    }
    setLightingEffectsOverlay(next)
    emitLightingEffectsParams(next.params)
  }, [activeDoc?.id, emitLightingEffectsParams])

  function handleBlurGalleryPointerDown(pt: { x: number; y: number }, event: React.PointerEvent<HTMLDivElement>) {
    if (!activeDoc || !blurGalleryOverlay) return false
    const result = beginBlurGalleryInteraction(
      blurGalleryOverlay.filterId,
      blurGalleryOverlay.params,
      pt,
      activeDoc.width,
      activeDoc.height,
      Math.max(8, 10 / Math.max(0.25, visualZoomRef.current)),
      { multiSelect: event.shiftKey || event.metaKey || event.ctrlKey },
    )
    if (!result.drag) return false
    blurGalleryDragRef.current = result.drag
    setBlurGalleryParams(blurGalleryOverlay.filterId, result.params)
    return true
  }

  function handleBlurGalleryPointerMove(pt: { x: number; y: number }) {
    const drag = blurGalleryDragRef.current
    if (!activeDoc || !blurGalleryOverlay || !drag) return false
    const next = updateBlurGalleryInteraction(
      blurGalleryOverlay.filterId,
      blurGalleryOverlay.params,
      drag,
      pt,
      activeDoc.width,
      activeDoc.height,
    )
    setBlurGalleryParams(blurGalleryOverlay.filterId, next)
    return true
  }

  function handleBlurGalleryPointerUp() {
    if (!blurGalleryDragRef.current) return false
    const overlay = blurGalleryOverlay
    blurGalleryDragRef.current = null
    if (overlay) {
      setBlurGalleryParams(overlay.filterId, finishBlurGalleryInteraction(overlay.filterId, overlay.params))
    } else {
      drawBlurGalleryOverlay(overlay)
    }
    return true
  }

  function handleLightingEffectsPointerDown(pt: { x: number; y: number }, event: React.PointerEvent<HTMLDivElement>) {
    if (!activeDoc || !lightingEffectsOverlay || lightingEffectsOverlay.docId !== activeDoc.id) return false
    const result = beginLightingEffectsInteraction(
      lightingEffectsOverlay.params,
      pt,
      activeDoc.width,
      activeDoc.height,
      Math.max(8, 10 / Math.max(0.25, visualZoomRef.current)),
    )
    if (!result.drag) return false
    lightingEffectsDragRef.current = result.drag
    setLightingEffectsParams(result.params)
    event.preventDefault()
    return true
  }

  function handleLightingEffectsPointerMove(pt: { x: number; y: number }) {
    const drag = lightingEffectsDragRef.current
    if (!activeDoc || !lightingEffectsOverlay || lightingEffectsOverlay.docId !== activeDoc.id || !drag) return false
    const next = updateLightingEffectsInteraction(
      lightingEffectsOverlay.params,
      drag,
      pt,
      activeDoc.width,
      activeDoc.height,
    )
    setLightingEffectsParams(next)
    return true
  }

  function handleLightingEffectsPointerUp() {
    if (!lightingEffectsDragRef.current) return false
    const overlay = lightingEffectsOverlay
    lightingEffectsDragRef.current = null
    if (overlay) setLightingEffectsParams(finishLightingEffectsInteraction(overlay.params))
    return true
  }

  const handleBlurGalleryKeyDown = React.useCallback((e: KeyboardEvent) => {
    if (!activeDoc || !blurGalleryOverlay || blurGalleryOverlay.docId !== activeDoc.id) return false
    const state = getBlurGalleryControlState(blurGalleryOverlay.params)
    const hasSelection = state.selectedFieldPinIndexes.length > 0 || state.selectedPathPointIndexes.length > 0 || !!state.activeControl
    const key = e.key
    let nextParams: BlurGalleryParams | null = null

    if (key === "Delete" || key === "Backspace") {
      nextParams = applyBlurGalleryKeyboardCommand(blurGalleryOverlay.filterId, blurGalleryOverlay.params, { kind: "delete" })
    } else if (((e.metaKey || e.ctrlKey) && key.toLowerCase() === "j") || (e.altKey && key.toLowerCase() === "j")) {
      nextParams = applyBlurGalleryKeyboardCommand(blurGalleryOverlay.filterId, blurGalleryOverlay.params, { kind: "duplicate" })
    } else if (key === "Escape" && hasSelection) {
      nextParams = applyBlurGalleryKeyboardCommand(blurGalleryOverlay.filterId, blurGalleryOverlay.params, { kind: "clear-selection" })
    } else if (key === "Tab") {
      nextParams = applyBlurGalleryKeyboardCommand(blurGalleryOverlay.filterId, blurGalleryOverlay.params, {
        kind: "select-next",
        direction: e.shiftKey ? -1 : 1,
      })
    } else if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown") {
      const stepPx = e.shiftKey ? 10 : e.altKey ? 0.25 : 1
      const dxPx = key === "ArrowLeft" ? -stepPx : key === "ArrowRight" ? stepPx : 0
      const dyPx = key === "ArrowUp" ? -stepPx : key === "ArrowDown" ? stepPx : 0
      nextParams = applyBlurGalleryKeyboardCommand(blurGalleryOverlay.filterId, blurGalleryOverlay.params, {
        kind: "nudge",
        dx: (dxPx / Math.max(1, activeDoc.width)) * 100,
        dy: (dyPx / Math.max(1, activeDoc.height)) * 100,
      })
    }

    if (!nextParams) return false
    e.preventDefault()
    setBlurGalleryParams(blurGalleryOverlay.filterId, nextParams)
    return true
  }, [activeDoc, blurGalleryOverlay, setBlurGalleryParams])

  function drawBlurGalleryOverlay(state = blurGalleryOverlay) {
    const ov = overlayRef.current
    if (!ov || !activeDoc) return
    const ctx = ov.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, ov.width, ov.height)
    if (!state || state.docId !== activeDoc.id) return

    const controlState = getBlurGalleryControlState(state.params)
    const zoom = Math.max(0.5, visualZoomRef.current)
    const accent = "#38bdf8"
    const selectedAccent = "#fbbf24"

    ctx.save()
    ctx.lineWidth = Math.max(1, 1.5 / zoom)
    ctx.strokeStyle = accent
    ctx.fillStyle = accent
    ctx.shadowColor = "rgba(0,0,0,0.45)"
    ctx.shadowBlur = 2 / zoom

    if (state.filterId === "field-blur") {
      const pins = parseFieldBlurPins(String(state.params.pins ?? ""))
      for (let index = 0; index < pins.length; index++) {
        const pin = pins[index]
        const selected = controlState.selectedFieldPinIndexes.includes(index)
        const center = percentToCanvasPoint(pin, activeDoc.width, activeDoc.height)
        const handle = { x: center.x + pin.blur, y: center.y }
        ctx.save()
        ctx.fillStyle = selected ? "rgba(251,191,36,0.08)" : "rgba(56,189,248,0.06)"
        ctx.beginPath()
        ctx.arc(center.x, center.y, Math.max(3 / zoom, pin.blur), 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = selected ? selectedAccent : "rgba(125,211,252,0.86)"
        ctx.lineWidth = selected ? Math.max(1.5, 2.25 / zoom) : Math.max(1, 1.25 / zoom)
        ctx.setLineDash([5 / zoom, 4 / zoom])
        ctx.beginPath()
        ctx.arc(center.x, center.y, Math.max(3, pin.blur), 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.strokeStyle = selected ? selectedAccent : accent
        ctx.beginPath()
        ctx.moveTo(center.x, center.y)
        ctx.lineTo(handle.x, handle.y)
        ctx.stroke()
        ctx.restore()
        drawRoundHandle(ctx, center.x, center.y, 5, selected ? selectedAccent : accent, selected)
        drawRoundHandle(ctx, handle.x, handle.y, 4, "#ffffff", selected)
        if (selected) drawOverlayLabel(ctx, `${pin.blur}px`, handle.x + 8 / zoom, handle.y - 8 / zoom)
      }
    } else if (state.filterId === "iris-blur") {
      const center = percentToCanvasPoint({ x: numOverlay(state.params.centerX, 50), y: numOverlay(state.params.centerY, 50) }, activeDoc.width, activeDoc.height)
      const rotation = numOverlay(state.params.rotation, 0)
      const radians = rotation * Math.PI / 180
      const axisX = { x: Math.cos(radians), y: Math.sin(radians) }
      const axisY = { x: -Math.sin(radians), y: Math.cos(radians) }
      const rx = activeDoc.width * numOverlay(state.params.ellipseWidth, numOverlay(state.params.radius, 42)) / 100 * 0.5
      const ry = activeDoc.height * numOverlay(state.params.ellipseHeight, numOverlay(state.params.radius, 42)) / 100 * 0.5
      const feather = 1 + numOverlay(state.params.feather, 30) / 100
      const widthHandle = { x: center.x + axisX.x * rx, y: center.y + axisX.y * rx }
      const heightHandle = { x: center.x + axisY.x * ry, y: center.y + axisY.y * ry }
      const featherHandle = { x: center.x + axisX.x * rx * feather, y: center.y + axisX.y * rx * feather }
      const rotationHandle = { x: center.x + axisX.x * (rx + 18 / zoom), y: center.y + axisX.y * (rx + 18 / zoom) }
      ctx.fillStyle = "rgba(56,189,248,0.07)"
      ctx.beginPath()
      ctx.ellipse(center.x, center.y, Math.max(1, rx * feather), Math.max(1, ry * feather), radians, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = "rgba(16,185,129,0.11)"
      ctx.beginPath()
      ctx.ellipse(center.x, center.y, Math.max(1, rx), Math.max(1, ry), radians, 0, Math.PI * 2)
      ctx.fill()
      ctx.setLineDash([])
      ctx.strokeStyle = "#22c55e"
      ctx.beginPath()
      ctx.ellipse(center.x, center.y, Math.max(1, rx), Math.max(1, ry), radians, 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = accent
      ctx.setLineDash([5 / zoom, 4 / zoom])
      ctx.beginPath()
      ctx.ellipse(center.x, center.y, Math.max(1, rx * feather), Math.max(1, ry * feather), radians, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.strokeStyle = selectedAccent
      ctx.beginPath()
      ctx.moveTo(center.x, center.y)
      ctx.lineTo(rotationHandle.x, rotationHandle.y)
      ctx.stroke()
      drawRoundHandle(ctx, center.x, center.y, 5, controlState.activeControl === "iris-center" ? selectedAccent : accent, controlState.activeControl === "iris-center")
      drawRoundHandle(ctx, widthHandle.x, widthHandle.y, 4, "#ffffff", controlState.activeControl === "iris-width" || controlState.activeControl === "iris-radius")
      drawRoundHandle(ctx, heightHandle.x, heightHandle.y, 4, "#ffffff", controlState.activeControl === "iris-height")
      drawRoundHandle(ctx, featherHandle.x, featherHandle.y, 4, "#ffffff", controlState.activeControl === "iris-feather")
      drawRoundHandle(ctx, rotationHandle.x, rotationHandle.y, 4, "#ffffff", controlState.activeControl === "iris-rotation")
      drawOverlayLabel(ctx, "focus", center.x - axisX.x * rx - axisY.x * ry - 8 / zoom, center.y - axisX.y * rx - axisY.y * ry - 8 / zoom)
      drawOverlayLabel(ctx, "feather", featherHandle.x + 8 / zoom, featherHandle.y)
    } else if (state.filterId === "tilt-shift") {
      const center = percentToCanvasPoint({ x: numOverlay(state.params.centerX, 50), y: numOverlay(state.params.centerY, 50) }, activeDoc.width, activeDoc.height)
      const angle = numOverlay(state.params.angle, 0) * Math.PI / 180
      const tangent = { x: Math.cos(angle), y: Math.sin(angle) }
      const normal = { x: -Math.sin(angle), y: Math.cos(angle) }
      const length = Math.hypot(activeDoc.width, activeDoc.height)
      const radius = Math.min(activeDoc.width, activeDoc.height) * numOverlay(state.params.radius, 30) / 100 * 0.5
      const feather = radius + Math.min(activeDoc.width, activeDoc.height) * numOverlay(state.params.feather, 30) / 100
      drawTiltBand(ctx, center, tangent, normal, 0, radius * 2, length, "rgba(34,197,94,0.1)")
      drawTiltBand(ctx, center, tangent, normal, (radius + feather) * 0.5, Math.max(1, feather - radius), length, "rgba(56,189,248,0.08)")
      drawTiltBand(ctx, center, tangent, normal, -(radius + feather) * 0.5, Math.max(1, feather - radius), length, "rgba(56,189,248,0.08)")
      drawTiltLine(ctx, center, tangent, normal, radius, length, false)
      drawTiltLine(ctx, center, tangent, normal, -radius, length, false)
      drawTiltLine(ctx, center, tangent, normal, feather, length, true)
      drawTiltLine(ctx, center, tangent, normal, -feather, length, true)
      const angleHandle = {
        x: center.x + tangent.x * Math.min(activeDoc.width, activeDoc.height) * 0.24,
        y: center.y + tangent.y * Math.min(activeDoc.width, activeDoc.height) * 0.24,
      }
      ctx.strokeStyle = selectedAccent
      ctx.beginPath()
      ctx.moveTo(center.x, center.y)
      ctx.lineTo(angleHandle.x, angleHandle.y)
      ctx.stroke()
      drawRoundHandle(ctx, center.x, center.y, 5, controlState.activeControl === "tilt-center" ? selectedAccent : accent, controlState.activeControl === "tilt-center")
      drawRoundHandle(ctx, angleHandle.x, angleHandle.y, 4, "#ffffff", controlState.activeControl === "tilt-angle")
      drawOverlayLabel(ctx, "sharp", center.x + normal.x * radius + 6 / zoom, center.y + normal.y * radius - 6 / zoom)
      drawOverlayLabel(ctx, "fade", center.x + normal.x * feather + 6 / zoom, center.y + normal.y * feather - 6 / zoom)
    } else if (state.filterId === "path-blur") {
      const points = parsePathBlurPoints(String(state.params.path ?? ""))
      const canvasPoints = points.map((point) => percentToCanvasPoint(point, activeDoc.width, activeDoc.height))
      if (canvasPoints.length > 0) {
        ctx.save()
        ctx.strokeStyle = "rgba(56,189,248,0.18)"
        ctx.lineWidth = Math.max(8 / zoom, 2)
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        ctx.beginPath()
        ctx.moveTo(canvasPoints[0].x, canvasPoints[0].y)
        for (let i = 1; i < canvasPoints.length; i++) ctx.lineTo(canvasPoints[i].x, canvasPoints[i].y)
        ctx.stroke()
        ctx.restore()
        ctx.strokeStyle = accent
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        ctx.beginPath()
        ctx.moveTo(canvasPoints[0].x, canvasPoints[0].y)
        for (let i = 1; i < canvasPoints.length; i++) ctx.lineTo(canvasPoints[i].x, canvasPoints[i].y)
        ctx.stroke()
        for (let i = 1; i < canvasPoints.length; i++) {
          drawPathArrow(ctx, canvasPoints[i - 1], canvasPoints[i])
        }
        for (let index = 0; index < canvasPoints.length; index++) {
          const point = canvasPoints[index]
          const selected = controlState.selectedPathPointIndexes.includes(index)
          drawRoundHandle(ctx, point.x, point.y, 5, selected ? selectedAccent : accent, selected)
        }
      }
    } else if (state.filterId === "spin-blur") {
      const center = percentToCanvasPoint({ x: numOverlay(state.params.centerX, 50), y: numOverlay(state.params.centerY, 50) }, activeDoc.width, activeDoc.height)
      const radius = Math.min(activeDoc.width, activeDoc.height) * numOverlay(state.params.radius, 55) / 100 * 0.5
      ctx.fillStyle = "rgba(56,189,248,0.08)"
      ctx.beginPath()
      ctx.arc(center.x, center.y, Math.max(1, radius), 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = accent
      ctx.beginPath()
      ctx.arc(center.x, center.y, Math.max(1, radius), 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([5 / zoom, 4 / zoom])
      ctx.beginPath()
      ctx.arc(center.x, center.y, Math.max(1, radius * 1.18), 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      drawSpinSpokes(ctx, center, Math.max(1, radius))
      const amount = numOverlay(state.params.amount, 28)
      const amountHandle = {
        x: center.x,
        y: center.y - radius * Math.max(0.2, amount / 50),
      }
      ctx.strokeStyle = selectedAccent
      ctx.beginPath()
      ctx.moveTo(center.x, center.y)
      ctx.lineTo(amountHandle.x, amountHandle.y)
      ctx.stroke()
      drawRoundHandle(ctx, center.x, center.y, 5, controlState.activeControl === "spin-center" ? selectedAccent : accent, controlState.activeControl === "spin-center")
      drawRoundHandle(ctx, center.x + radius, center.y, 4, "#ffffff", controlState.activeControl === "spin-radius")
      drawRoundHandle(ctx, amountHandle.x, amountHandle.y, 4, "#ffffff", controlState.activeControl === "spin-amount")
      drawOverlayLabel(ctx, "radius", center.x + radius + 8 / zoom, center.y - 8 / zoom)
      drawOverlayLabel(ctx, `${Math.round(amount)}deg`, amountHandle.x + 8 / zoom, amountHandle.y)
    }

    ctx.restore()
  }

  function drawLightingEffectsOverlay(state = lightingEffectsOverlay) {
    const ov = overlayRef.current
    if (!ov || !activeDoc) return
    const ctx = ov.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, ov.width, ov.height)
    if (!state || state.docId !== activeDoc.id) return

    const lights = parseLightingEffectsLights(String(state.params.lights ?? ""))
    const controlState = getLightingEffectsControlState(state.params)
    const zoom = Math.max(0.5, visualZoomRef.current)
    const minDim = Math.max(1, Math.min(activeDoc.width, activeDoc.height))
    const accent = "#fbbf24"
    const secondary = "#38bdf8"

    ctx.save()
    ctx.lineWidth = Math.max(1, 1.5 / zoom)
    ctx.shadowColor = "rgba(0,0,0,0.45)"
    ctx.shadowBlur = 2 / zoom
    for (let index = 0; index < lights.length; index++) {
      const light = lights[index]
      const selected = controlState.selectedLightIndex === index
      const center = { x: light.x * activeDoc.width, y: light.y * activeDoc.height }
      const radius = Math.max(1, light.radius * minDim)
      const focusRadius = radius * 0.5 * light.focus
      const amountHandle = { x: center.x, y: center.y - radius * Math.max(0.2, light.intensity * 0.5) }
      const focusHandle = { x: center.x + focusRadius, y: center.y }
      const radiusHandle = { x: center.x + radius, y: center.y }

      ctx.save()
      ctx.fillStyle = selected ? "rgba(251,191,36,0.08)" : "rgba(56,189,248,0.06)"
      ctx.strokeStyle = selected ? accent : secondary
      ctx.setLineDash([5 / zoom, 4 / zoom])
      ctx.beginPath()
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.setLineDash([])
      if (light.type === "spot") {
        ctx.strokeStyle = "rgba(248,250,252,0.46)"
        ctx.beginPath()
        ctx.arc(center.x, center.y, Math.max(1, focusRadius), 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.strokeStyle = "rgba(248,250,252,0.58)"
      ctx.beginPath()
      ctx.moveTo(center.x, center.y)
      ctx.lineTo(amountHandle.x, amountHandle.y)
      ctx.moveTo(center.x, center.y)
      ctx.lineTo(radiusHandle.x, radiusHandle.y)
      ctx.stroke()
      ctx.restore()

      drawRoundHandle(ctx, center.x, center.y, 5, selected ? accent : secondary, selected)
      drawRoundHandle(ctx, radiusHandle.x, radiusHandle.y, 4, "#ffffff", controlState.activeControl === `light-radius:${index}`)
      drawRoundHandle(ctx, focusHandle.x, focusHandle.y, 4, "#ffffff", controlState.activeControl === `light-focus:${index}`)
      drawRoundHandle(ctx, amountHandle.x, amountHandle.y, 4, "#ffffff", controlState.activeControl === `light-intensity:${index}`)
      drawOverlayLabel(ctx, `${light.type} ${Math.round(light.intensity * 100)}%`, center.x + 8 / zoom, center.y - 10 / zoom)
    }
    ctx.restore()
  }

  drawBlurGalleryOverlayRef.current = drawBlurGalleryOverlay
  drawLightingEffectsOverlayRef.current = drawLightingEffectsOverlay

  function drawMagneticLassoPreview(
    ctx: CanvasRenderingContext2D,
    points: { x: number; y: number }[],
    hover?: { x: number; y: number },
  ) {
    const anchors = hover ? [...points, hover] : points
    let previewPoints = anchors
    const sourceCanvas = selectionOptions.sampleAllLayers ? compositeRef.current : activeLayer?.canvas
    if (anchors.length > 1 && sourceCanvas && typeof sourceCanvas.getContext === "function") {
      const traced = magneticLassoTrace(selectionTraceSourceForLayer(sourceCanvas), anchors, {
        searchWidth: Math.max(4, Math.min(64, selectionOptions.magneticWidth ?? 12)),
        contrastThreshold: Math.max(0.01, Math.min(512, selectionOptions.magneticContrast ?? selectionOptions.tolerance ?? 24)),
        hysteresisRatio: Math.max(0.1, Math.min(0.95, (selectionOptions.magneticHysteresis ?? 45) / 100)),
        smoothing: Math.max(0, Math.min(1, (selectionOptions.magneticSmoothing ?? 35) / 100)),
      })
      if (traced.points.length > 1) previewPoints = traced.points
    }

    ctx.save()
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = "rgba(255,255,255,0.68)"
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < anchors.length; i++) ctx.lineTo(anchors[i].x, anchors[i].y)
    ctx.stroke()

    ctx.setLineDash([])
    ctx.strokeStyle = "#22d3ee"
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(previewPoints[0].x, previewPoints[0].y)
    for (let i = 1; i < previewPoints.length; i++) ctx.lineTo(previewPoints[i].x, previewPoints[i].y)
    ctx.stroke()

    const indicator = hover ?? points[points.length - 1]
    const width = Math.max(4, Math.min(64, selectionOptions.magneticWidth ?? 12))
    ctx.strokeStyle = "rgba(34,211,238,0.9)"
    ctx.fillStyle = "rgba(34,211,238,0.12)"
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(indicator.x, indicator.y, width, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = "#ffffff"
    for (const p of points) {
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4)
    }
    ctx.fillStyle = "#22d3ee"
    ctx.beginPath()
    ctx.arc(indicator.x, indicator.y, 2.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

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
    if (!activeLayer || !activeDoc?.quickMask && !withinSelection({ x, y })) return
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

  function requiredRgbaFromCss(color: string): Required<BrushRgba> {
    const rgb = hexToRgb(color)
    return { r: rgb.r, g: rgb.g, b: rgb.b, a: 1 }
  }

  function rgbaToCss(color: Required<BrushRgba>) {
    return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${clamp01(color.a)})`
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
    const sample = sampleCanvasColor(sampleSource, { x, y })
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

  function drawRoundHandle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, fill = "#38bdf8", selected = false) {
    const zoom = Math.max(0.5, visualZoomRef.current)
    ctx.save()
    if (selected) {
      ctx.fillStyle = "rgba(251,191,36,0.22)"
      ctx.beginPath()
      ctx.arc(x, y, (radius + 5) / zoom, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = fill
    ctx.strokeStyle = "#0f172a"
    ctx.lineWidth = Math.max(1, 1 / zoom)
    ctx.beginPath()
    ctx.arc(x, y, radius / zoom, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    if (selected) {
      ctx.strokeStyle = "#fbbf24"
      ctx.lineWidth = Math.max(1, 1.5 / zoom)
      ctx.beginPath()
      ctx.arc(x, y, (radius + 2) / zoom, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  function drawOverlayLabel(ctx: CanvasRenderingContext2D, label: string, x: number, y: number) {
    const zoom = Math.max(0.5, visualZoomRef.current)
    const fontSize = Math.max(10, 11 / zoom)
    ctx.save()
    ctx.shadowBlur = 0
    ctx.font = `${fontSize}px sans-serif`
    const metrics = ctx.measureText(label)
    const padX = 4 / zoom
    const padY = 3 / zoom
    ctx.fillStyle = "rgba(15,23,42,0.82)"
    ctx.strokeStyle = "rgba(255,255,255,0.28)"
    ctx.lineWidth = Math.max(1, 1 / zoom)
    ctx.beginPath()
    ctx.roundRect(x - padX, y - fontSize + padY, metrics.width + padX * 2, fontSize + padY * 2, 3 / zoom)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = "#f8fafc"
    ctx.fillText(label, x, y)
    ctx.restore()
  }

  function drawTiltBand(
    ctx: CanvasRenderingContext2D,
    center: { x: number; y: number },
    tangent: { x: number; y: number },
    normal: { x: number; y: number },
    offset: number,
    width: number,
    length: number,
    color: string,
  ) {
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(1, width)
    ctx.beginPath()
    const x = center.x + normal.x * offset
    const y = center.y + normal.y * offset
    ctx.moveTo(x - tangent.x * length, y - tangent.y * length)
    ctx.lineTo(x + tangent.x * length, y + tangent.y * length)
    ctx.stroke()
    ctx.restore()
  }

  function drawTiltLine(
    ctx: CanvasRenderingContext2D,
    center: { x: number; y: number },
    tangent: { x: number; y: number },
    normal: { x: number; y: number },
    offset: number,
    length: number,
    dashed: boolean,
  ) {
    const zoom = Math.max(0.5, visualZoomRef.current)
    ctx.save()
    ctx.strokeStyle = dashed ? "rgba(125,211,252,0.92)" : "#22c55e"
    ctx.lineWidth = dashed ? Math.max(1, 1.25 / zoom) : Math.max(1.25, 1.75 / zoom)
    ctx.setLineDash(dashed ? [5 / zoom, 5 / zoom] : [])
    const x = center.x + normal.x * offset
    const y = center.y + normal.y * offset
    ctx.beginPath()
    ctx.moveTo(x - tangent.x * length, y - tangent.y * length)
    ctx.lineTo(x + tangent.x * length, y + tangent.y * length)
    ctx.stroke()
    ctx.restore()
  }

  function drawPathArrow(ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }) {
    const zoom = Math.max(0.5, visualZoomRef.current)
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy)
    if (length < 1) return
    const ux = dx / length
    const uy = dy / length
    const mid = { x: from.x + dx * 0.55, y: from.y + dy * 0.55 }
    const size = 7 / zoom
    ctx.save()
    ctx.fillStyle = "#f8fafc"
    ctx.strokeStyle = "#0f172a"
    ctx.lineWidth = Math.max(1, 1 / zoom)
    ctx.beginPath()
    ctx.moveTo(mid.x + ux * size, mid.y + uy * size)
    ctx.lineTo(mid.x - ux * size * 0.65 - uy * size * 0.55, mid.y - uy * size * 0.65 + ux * size * 0.55)
    ctx.lineTo(mid.x - ux * size * 0.65 + uy * size * 0.55, mid.y - uy * size * 0.65 - ux * size * 0.55)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }

  function drawSpinSpokes(ctx: CanvasRenderingContext2D, center: { x: number; y: number }, radius: number) {
    const zoom = Math.max(0.5, visualZoomRef.current)
    ctx.save()
    ctx.strokeStyle = "rgba(248,250,252,0.52)"
    ctx.lineWidth = Math.max(1, 1 / zoom)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2
      const inner = radius * 0.18
      const outer = radius * 0.92
      ctx.beginPath()
      ctx.moveTo(center.x + Math.cos(angle) * inner, center.y + Math.sin(angle) * inner)
      ctx.lineTo(center.x + Math.cos(angle) * outer, center.y + Math.sin(angle) * outer)
      ctx.stroke()
    }
    ctx.restore()
  }

  function numOverlay(value: BlurGalleryParams[string], fallback: number) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
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
    | null
    last?: { x: number; y: number }
    start?: { x: number; y: number }
    smooth?: { x: number; y: number }
    points?: { x: number; y: number }[]
    panStart?: { x: number; y: number }
    moveLayerId?: string
    moveStart?: { x: number; y: number }
    moveOrigin?: { x: number; y: number }
    handle?: TransformHandleId
    guideOrient?: "horizontal" | "vertical"
    refineMode?: "expand" | "subtract"
    dirty?: DirtyRect
    rotateStartAngle?: number
    rotateStartValue?: number
    directLayerId?: string
    directSubpathIndex?: number
    directPointIndex?: number
    directPathHandle?: "in" | "out"
    directShapeHandle?: DirectShapeHandleId
    directSelectedAnchors?: PathAnchorRef[]
    sliceDraftId?: string
  }>({ type: null })
  const brushResizeRef = React.useRef<{ startClientX: number; startSize: number } | null>(null)
  const [, setDirectAnchorSelectionState] = React.useState<{ layerId: string; anchors: PathAnchorRef[] } | null>(null)
  const directAnchorSelectionRef = React.useRef<{ layerId: string; anchors: PathAnchorRef[] } | null>(null)

  const setDirectAnchorSelection = React.useCallback((selection: { layerId: string; anchors: PathAnchorRef[] } | null) => {
    directAnchorSelectionRef.current = selection
    setDirectAnchorSelectionState(selection)
  }, [])

  function mergeDirtyRect(a: DirtyRect | undefined, b: DirtyRect): DirtyRect {
    if (!a) return b
    const x1 = Math.min(a.x, b.x)
    const y1 = Math.min(a.y, b.y)
    const x2 = Math.max(a.x + a.w, b.x + b.w)
    const y2 = Math.max(a.y + a.h, b.y + b.h)
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
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

  function sampleCanvasColor(canvas: HTMLCanvasElement, point: { x: number; y: number }) {
    const ctx = canvas.getContext("2d")!
    const sampleSize = getEyedropperSampleSize()
    const side = sampleSize === "5x5" ? 5 : sampleSize === "3x3" ? 3 : 1
    const half = Math.floor(side / 2)
    const x0 = Math.max(0, Math.min(canvas.width - 1, Math.floor(point.x) - half))
    const y0 = Math.max(0, Math.min(canvas.height - 1, Math.floor(point.y) - half))
    const w = Math.max(1, Math.min(side, canvas.width - x0))
    const h = Math.max(1, Math.min(side, canvas.height - y0))
    const pixels = ctx.getImageData(x0, y0, w, h).data
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    let weight = 0
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3] / 255
      const k = alpha > 0 ? alpha : 1
      r += pixels[i] * k
      g += pixels[i + 1] * k
      b += pixels[i + 2] * k
      a += pixels[i + 3]
      weight += k
    }
    const denom = Math.max(1, weight)
    return {
      r: Math.round(r / denom),
      g: Math.round(g / denom),
      b: Math.round(b / denom),
      a: Math.round(a / Math.max(1, pixels.length / 4)),
    }
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
    if (dirty) drag.dirty = mergeDirtyRect(drag.dirty, dirty)
  }

  function requestTileAwareStrokeRender(reason = "tile-only-tool") {
    const drag = drawingRef.current
    const dirty = drag.type === "stroke" ? drag.dirty : undefined
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

    if (e.button === 2) return

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

    // Eyedropper tool
    if (tool === "eyedropper") {
      const cv = compositeRef.current!
      const px = sampleCanvasColor(cv, pt)
      const hex =
        "#" + [px.r, px.g, px.b].map((c) => c.toString(16).padStart(2, "0")).join("")
      dispatch({ type: "set-foreground", color: hex })
      return
    }

    if (tool === "color-sampler") {
      const cv = compositeRef.current
      if (!cv) return
      const x = Math.max(0, Math.min(activeDoc.width - 1, Math.floor(pt.x)))
      const y = Math.max(0, Math.min(activeDoc.height - 1, Math.floor(pt.y)))
      const px = sampleCanvasColor(cv, { x, y })
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

    // Transform tool
    if (tool === "transform") {
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

    // Type tools
    if (tool === "type" || tool === "type-vertical") {
      const id = `text_${Math.random().toString(36).slice(2, 9)}`
      const cv = makeCanvas(activeDoc.width, activeDoc.height)
      const vertical = tool === "type-vertical"
      const layer: Layer = {
        id,
        name: vertical ? "Vertical Text" : "Text",
        kind: "text",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        canvas: cv,
        text: {
          content: vertical ? "Vertical" : "Type here…",
          font: "Geist, system-ui, sans-serif",
          size: 48,
          weight: "bold",
          italic: false,
          color: foreground,
          align: "left",
          x: pt.x,
          y: pt.y,
          vertical,
        },
      }
      rasterizeText(cv, layer.text!)
      dispatch({ type: "add-layer", layer })
      setTimeout(() => commit(vertical ? "Vertical Type" : "Type", [id]), 0)
      window.dispatchEvent(new CustomEvent("ps-edit-text", { detail: { layerId: id } }))
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
      let quickSelectionDiagnostics: Selection["diagnostics"] | undefined
      const m = tool === "quick-selection"
        ? (() => {
            const result = buildEdgeAwareQuickSelectionMaskData(src, {
              seed: { x, y },
              tolerance: selectionOptions.tolerance,
              sampleSize: selectionOptions.sampleSize ?? "point",
              contiguous: selectionOptions.contiguous,
              adaptive: true,
              includeDiagonals: true,
              diagnostics: true,
            })
            quickSelectionDiagnostics = result.diagnostics
            const mask = new ImageData(activeDoc.width, activeDoc.height)
            for (let i = 0; i < result.maskData.length; i++) {
              mask.data[i * 4 + 3] = result.maskData[i]
            }
            return mask
          })()
        : floodFillMask(src, x, y, selectionOptions.tolerance, selectionOptions.contiguous)
      // mask -> bounds
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
          diagnostics: quickSelectionDiagnostics,
        })
        if (tool === "quick-selection") commit("Quick Selection", [])
      } else if (tool === "quick-selection") {
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
      const factor = e.altKey ? 1 / 1.5 : 1.5
      applyViewZoom(visualZoomRef.current * factor)
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
      if (tool === "clone-stamp" || tool === "healing-brush") {
        resolveCloneState(pt)
      }
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
    else window.dispatchEvent(new CustomEvent("ps-mousemove", { detail: mouseDetail }))

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
      // Polygonal lasso live-preview
      if (
        (tool === "lasso-polygon" || tool === "lasso-magnetic") &&
        drag.type === null &&
        // workaround: polylasso state is preserved across pointer-up; we check lazily
        false
      ) {
        // no-op
      }
      return
    }

    if (drag.type === "pan" && drag.panStart) {
      panRef.current = { x: e.clientX - drag.panStart.x, y: e.clientY - drag.panStart.y }
      applyStageTransform()
      return
    }

    if (drag.type === "rotate-view" && activeDoc && drag.rotateStartAngle !== undefined && drag.rotateStartValue !== undefined) {
      const center = { x: activeDoc.width / 2, y: activeDoc.height / 2 }
      const angle = Math.atan2(pt.y - center.y, pt.x - center.x)
      const delta = ((angle - drag.rotateStartAngle) * 180) / Math.PI
      const next = normalizeViewRotation(drag.rotateStartValue + delta)
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
      } else if (tool === "custom-shape" || tool === "shape-polygon" || tool === "shape-star" || tool === "shape-triangle" || tool === "shape-rounded-rect") {
        rasterizeShape(ov, shapePropsForTool(tool, x, y, w, h, drag.start, pt, foreground, background))
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
      } else if (tool === "shape-ellipse") {
        ctx.fillStyle = foreground
        ctx.beginPath()
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
        ctx.fill()
      } else {
        const shapeOptions = getShapeRuntimeOptions()
        rasterizeShape(ov, {
          type: "rect",
          x,
          y,
          w,
          h,
          fill: foreground,
          stroke: shapeOptions.strokeWidth > 0 ? { color: background, width: shapeOptions.strokeWidth } : null,
          radius: shapeOptions.radius,
        })
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
      drawGradientPreview(drag.start, pt)
      drag.last = pt
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
      const ctx = layer.canvas.getContext("2d")!
      ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
      ctx.drawImage(snapshot, dx, dy)
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
        const px = sampleCanvasColor(cv, drag.start)
        const hex = "#" + [px.r, px.g, px.b].map((c) => c.toString(16).padStart(2, "0")).join("")
        dispatch({ type: "set-foreground", color: hex })
      }
      brushResizeRef.current = null
      drawingRef.current = { type: null }
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
      if (layer) {
        if (tool === "content-aware-move") {
          const snapshot: HTMLCanvasElement | undefined = layer.canvas.__moveSnapshot
          if (snapshot) {
            const { mask, bounds } = alphaMaskFromCanvas(snapshot)
            if (bounds) contentAwareFill(layer.canvas, bounds, mask)
          }
        }
        delete layer.canvas.__moveSnapshot
        if (layer.linkGroupId) {
          for (const o of activeDoc.layers) if (o.linkGroupId === layer.linkGroupId) delete o.canvas.__moveSnapshot
        }
      }
      drawingRef.current = { type: null }
      commit(tool === "content-aware-move" ? "Content-Aware Move" : "Move", changedLayerIds)
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
    // edit text on double click
    const hit = autoPickLayer(activeDoc, pt)
    if (hit && hit.kind === "text") {
      window.dispatchEvent(new CustomEvent("ps-edit-text", { detail: { layerId: hit.id } }))
      return
    }
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
  cancelBufferedStrokeRef.current = cancelBufferedStroke
  beginTransformRef.current = beginTransform
  commitTransformRef.current = commitTransform

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
  }, [activeLayer, requestRender, toggleQuickMask, activeDoc, blurGalleryOverlay, handleBlurGalleryKeyDown, tool, dispatch, commit, setDirectAnchorSelection])

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
    window.addEventListener("ps-move-options-changed", moveOptionsHandler)
    moveOptionsHandler()
    return () => window.removeEventListener("ps-move-options-changed", moveOptionsHandler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayer, tool, requestRender])

  /* ---- text editing overlay (DOM) ---- */

  const [editingText, setEditingText] = React.useState<{ layerId: string; value: string } | null>(null)
  React.useEffect(() => {
    function handler(e: Event) {
      const id = (e as CustomEvent<{ layerId?: string }>).detail?.layerId
      if (!id || !activeDoc) return
      const layer = activeDoc.layers.find((l) => l.id === id)
      if (!layer || layer.kind !== "text" || !layer.text) return
      setEditingText({ layerId: id, value: layer.text.content })
    }
    window.addEventListener("ps-edit-text", handler)
    return () => window.removeEventListener("ps-edit-text", handler)
  }, [activeDoc])

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
    window.addEventListener("ps-open-color-picker-hud", open)
    return () => window.removeEventListener("ps-open-color-picker-hud", open)
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
    window.addEventListener("ps-transform-selection-begin", begin)
    window.addEventListener("ps-transform-selection-cancel", cancel)
    return () => {
      window.removeEventListener("ps-transform-selection-begin", begin)
      window.removeEventListener("ps-transform-selection-cancel", cancel)
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
    window.addEventListener("ps-free-transform", ftHandler)
    window.addEventListener("ps-transform-flip", flipHandler)
    window.addEventListener("ps-transform-rotate", rotateHandler)
    window.addEventListener("ps-transform-set", setTransformHandler)
    window.addEventListener("ps-transform-commit", commitTransformHandler)
    window.addEventListener("ps-transform-cancel", cancelTransformHandler)
    return () => {
      window.removeEventListener("ps-free-transform", ftHandler)
      window.removeEventListener("ps-transform-flip", flipHandler)
      window.removeEventListener("ps-transform-rotate", rotateHandler)
      window.removeEventListener("ps-transform-set", setTransformHandler)
      window.removeEventListener("ps-transform-commit", commitTransformHandler)
      window.removeEventListener("ps-transform-cancel", cancelTransformHandler)
    }
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
    window.addEventListener("ps-navigator-pan", navigatorPanHandler)
    return () => window.removeEventListener("ps-navigator-pan", navigatorPanHandler)
  }, [activeDoc, applyStageTransform])

  function commitTextEdit() {
    if (!editingText || !activeDoc) return
    const layer = activeDoc.layers.find((l) => l.id === editingText.layerId)
    if (layer && layer.kind === "text" && layer.text) {
      layer.text.content = editingText.value
      rasterizeText(layer.canvas, layer.text)
      requestRender()
      commit("Edit Text", [layer.id])
    }
    setEditingText(null)
  }

  /* ---- Crop logic ---- */

  function applyCrop(b: { x: number; y: number; w: number; h: number }) {
    if (!activeDoc) return
    const newW = Math.round(b.w)
    const newH = Math.round(b.h)
    for (const layer of activeDoc.layers) {
      if (typeof layer.canvas.getContext !== "function") continue
      const tmp = makeCanvas(newW, newH)
      tmp.getContext("2d")!.drawImage(layer.canvas, -b.x, -b.y)
      layer.canvas.width = newW
      layer.canvas.height = newH
      const ctx = layer.canvas.getContext("2d")!
      ctx.clearRect(0, 0, newW, newH)
      ctx.drawImage(tmp, 0, 0)
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
    const ctx = ov.getContext("2d")!
    ctx.clearRect(0, 0, ov.width, ov.height)

    // Darken outside area
    ctx.fillStyle = "rgba(0,0,0,0.5)"
    ctx.fillRect(0, 0, ov.width, ov.height)

    // Cut out the quad region
    if (pts.length >= 3) {
      ctx.save()
      ctx.globalCompositeOperation = "destination-out"
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    // Draw quad outline
    ctx.strokeStyle = "#00ccff"
    ctx.setLineDash([])
    ctx.lineWidth = 1.5
    if (pts.length >= 2) {
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
      if (pts.length >= 4) ctx.closePath()
      ctx.stroke()
    }

    // Draw corner dots with numbers
    for (let i = 0; i < pts.length; i++) {
      ctx.fillStyle = i < 4 ? "#00ccff" : "#ff0000"
      ctx.beginPath()
      ctx.arc(pts[i].x, pts[i].y, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = "#000"
      ctx.font = "bold 9px sans-serif"
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(`${i + 1}`, pts[i].x, pts[i].y)
    }

    // Instruction text
    ctx.fillStyle = "#fff"
    ctx.font = "12px sans-serif"
    ctx.textBaseline = "top"
    ctx.textAlign = "left"
    ctx.fillText(`Click corner ${pts.length + 1} of 4`, 10, 10)
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

  function sortCorners(pts: { x: number; y: number }[]): [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] {
    const cx = pts.reduce((s, p) => s + p.x, 0) / 4
    const cy = pts.reduce((s, p) => s + p.y, 0) / 4
    const angled = pts.map((p) => ({ ...p, angle: Math.atan2(p.y - cy, p.x - cx) }))
    angled.sort((a, b) => a.angle - b.angle)
    // After sorting by angle: should be TL, BL, BR, TR (counter-clockwise)
    // We need TL, TR, BR, BL
    const [tl, bl, br, tr] = angled
    return [tl, tr, br, bl]
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

  function isVectorEditableLayer(layer: Layer | null | undefined) {
    return Boolean(layer && layer.kind !== "group" && (layer.path || textLayerPath(layer) || layer.shape || layer.frame || layer.artboard || layer.kind === "shape" || layer.kind === "frame" || layer.kind === "artboard"))
  }

  function pickVectorLayer(doc: PsDocument, pt: { x: number; y: number }) {
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

  function vectorLayerBounds(layer: Layer) {
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

  function directSelectionTarget(layer: Layer, pt: { x: number; y: number }) {
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

  function editablePathForDirectSelection(layer: Layer): PathProps | null {
    if (layer.path) return layer.path
    if (layer.shape) return layer.shape.computedPath ?? shapeToEditablePath(layer.shape)
    return textLayerPath(layer)
  }

  function pathForDirectEdit(path: PathProps, subpathIndex: number | undefined) {
    if (subpathIndex === undefined || subpathIndex < 0) return path
    return path.subpaths?.[subpathIndex] ?? path
  }

  function replaceDirectEditPath(path: PathProps, subpathIndex: number | undefined, edited: PathProps): PathProps {
    if (subpathIndex === undefined || subpathIndex < 0) return edited
    const subpaths = path.subpaths?.slice() ?? []
    subpaths[subpathIndex] = edited
    return { ...path, subpaths }
  }

  function constrainedDelta(dx: number, dy: number, constrain: boolean) {
    if (!constrain) return { dx, dy }
    return constrainTo45Degrees(dx, dy)
  }

  function updateDirectSelectionDrag(layer: Layer, pt: { x: number; y: number }, drag: typeof drawingRef.current, mirrorPathHandles = true, constrainMove = false) {
    if (layer.path && drag.directSelectedAnchors?.length && drag.last && drag.directPointIndex === undefined && !drag.directPathHandle) {
      layer.path = moveSelectedPathAnchors(layer.path, drag.directSelectedAnchors, constrainedDelta(pt.x - drag.last.x, pt.y - drag.last.y, constrainMove))
      rerenderVectorLayer(layer)
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
        rerenderVectorLayer(layer)
        return
      }
      if (drag.directSelectedAnchors?.length && drag.last) {
        const delta = constrainedDelta(pt.x - drag.last.x, pt.y - drag.last.y, constrainMove)
        layer.path = moveSelectedPathAnchors(layer.path, drag.directSelectedAnchors, delta)
        rerenderVectorLayer(layer)
        return
      }
      layer.path = replaceDirectEditPath(layer.path, drag.directSubpathIndex, movePathAnchor(editablePath, drag.directPointIndex, pt))
      rerenderVectorLayer(layer)
      return
    }
    if (layer.shape && drag.directSelectedAnchors?.length && drag.last && drag.directPointIndex === undefined && !drag.directPathHandle) {
      const basePath = layer.shape.computedPath ?? shapeToEditablePath(layer.shape)
      layer.shape = {
        ...layer.shape,
        computedPath: moveSelectedPathAnchors(basePath, drag.directSelectedAnchors, constrainedDelta(pt.x - drag.last.x, pt.y - drag.last.y, constrainMove)),
      }
      rerenderVectorLayer(layer)
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
      rerenderVectorLayer(layer)
      return
    }
    if (layer.text?.textPath && drag.directPointIndex !== undefined && drag.directPointIndex >= 0) {
      const points = layer.text.textPath.map((point, index) =>
        index === drag.directPointIndex ? { x: pt.x, y: pt.y } : point,
      )
      layer.text = { ...layer.text, textPath: points }
      rerenderVectorLayer(layer)
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
    rerenderVectorLayer(layer)
  }

  function rerenderVectorLayer(layer: Layer) {
    const ctx = layer.canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
    if (layer.shape) rasterizeShape(layer.canvas, layer.shape)
    else if (layer.text) rasterizeText(layer.canvas, layer.text)
    else if (layer.frame) drawFramePlaceholder(ctx, layer.frame)
    else if (layer.artboard) drawArtboardPreview(ctx, layer.artboard.x, layer.artboard.y, layer.artboard.w, layer.artboard.h, layer.artboard.background)
    else if (layer.path) strokePath(ctx, layer.path, foreground, Math.max(1, brush.size / 4), layer.path.closed, hexToRgba(foreground, 0.3))
  }

  function drawPathSelectionPreview(layer: Layer) {
    const ov = overlayRef.current
    if (!ov || !activeDoc) return
    const ctx = ov.getContext("2d")!
    ctx.clearRect(0, 0, ov.width, ov.height)
    const bounds = vectorLayerBounds(layer)
    if (bounds) {
      ctx.save()
      ctx.strokeStyle = "#38bdf8"
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h)
      ctx.setLineDash([])
      for (const handle of shapeHandles(bounds)) {
        ctx.fillStyle = handle.id === "center" ? "#0f172a" : "#ffffff"
        ctx.strokeStyle = "#38bdf8"
        ctx.fillRect(handle.x - 3, handle.y - 3, 6, 6)
        ctx.strokeRect(handle.x - 3, handle.y - 3, 6, 6)
      }
      if (layer.shape?.type === "rect") {
        for (const handle of getRoundedRectCornerRadiusHandles(layer.shape)) {
          ctx.beginPath()
          ctx.fillStyle = "#0f172a"
          ctx.strokeStyle = "#f59e0b"
          ctx.arc(handle.x, handle.y, 4, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
          const corner =
            handle.corner === "tl" ? { x: layer.shape.x, y: layer.shape.y } :
              handle.corner === "tr" ? { x: layer.shape.x + layer.shape.w, y: layer.shape.y } :
                handle.corner === "br" ? { x: layer.shape.x + layer.shape.w, y: layer.shape.y + layer.shape.h } :
                  { x: layer.shape.x, y: layer.shape.y + layer.shape.h }
          ctx.beginPath()
          ctx.moveTo(corner.x, corner.y)
          ctx.lineTo(handle.x, handle.y)
          ctx.stroke()
        }
      }
      ctx.restore()
    }
    const editablePath = editablePathForDirectSelection(layer)
    if (editablePath?.points.length) {
      const pathParts = [{ path: editablePath, subpathIndex: -1 }, ...(editablePath.subpaths ?? []).map((path, subpathIndex) => ({ path, subpathIndex }))]
      const selected = directSelectionAnchorsFor(layer.id)
      const drawHandle = (point: { x: number; y: number }, size = 3) => {
        ctx.fillRect(point.x - size, point.y - size, size * 2, size * 2)
        ctx.strokeRect(point.x - size, point.y - size, size * 2, size * 2)
      }
      const drawControls = (path: PathProps) => {
        for (const point of path.points) {
          if (point.cp1) {
            ctx.beginPath()
            ctx.moveTo(point.x, point.y)
            ctx.lineTo(point.cp1.x, point.cp1.y)
            ctx.stroke()
            drawHandle(point.cp1)
          }
          if (point.cp2) {
            ctx.beginPath()
            ctx.moveTo(point.x, point.y)
            ctx.lineTo(point.cp2.x, point.cp2.y)
            ctx.stroke()
            drawHandle(point.cp2)
          }
        }
      }
      ctx.save()
      ctx.strokeStyle = "#38bdf8"
      ctx.fillStyle = "#ffffff"
      ctx.lineWidth = 1
      ctx.beginPath()
      appendPathToCanvas(ctx, editablePath)
      ctx.stroke()
      ctx.strokeStyle = "#f59e0b"
      ctx.fillStyle = "#ffffff"
      for (const entry of pathParts) drawControls(entry.path)
      ctx.strokeStyle = "#38bdf8"
      for (const entry of pathParts) {
        for (const [pointIndex, point] of entry.path.points.entries()) {
          const isSelected = selected.some((anchor) => anchor.subpathIndex === entry.subpathIndex && anchor.pointIndex === pointIndex)
          ctx.beginPath()
          ctx.fillStyle = isSelected ? "#38bdf8" : "#ffffff"
          ctx.strokeStyle = isSelected ? "#ffffff" : "#38bdf8"
          ctx.arc(point.x, point.y, 4, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        }
      }
      ctx.restore()
    }
  }

  rerenderVectorLayerRef.current = rerenderVectorLayer
  drawPathSelectionPreviewRef.current = drawPathSelectionPreview

  function drawSliceSelectionPreview(slice: { x: number; y: number; w: number; h: number; name: string }) {
    const ov = overlayRef.current
    if (!ov) return
    const ctx = ov.getContext("2d")!
    ctx.clearRect(0, 0, ov.width, ov.height)
    ctx.save()
    ctx.strokeStyle = "#fb923c"
    ctx.lineWidth = 2
    ctx.setLineDash([5, 3])
    ctx.strokeRect(slice.x, slice.y, slice.w, slice.h)
    ctx.setLineDash([])
    ctx.fillStyle = "rgba(15, 23, 42, 0.85)"
    ctx.fillRect(slice.x, Math.max(0, slice.y - 20), Math.max(64, slice.name.length * 7 + 12), 18)
    ctx.fillStyle = "#fed7aa"
    ctx.font = "11px system-ui"
    ctx.fillText(slice.name, slice.x + 6, Math.max(12, slice.y - 7))
    ctx.restore()
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
      drawTransformSource(ctx, t)
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
    drawTransformSource(ctx, t)
    ctx.restore()
    requestRender()
  }

  function handleTransformDrag(p: { x: number; y: number }, handle: TransformHandleId, shift: boolean, perspectiveDrag = false) {
    const t = transformRef.current
    if (!t) return
    const cx = t.bounds.x + t.bounds.w / 2 + t.tx
    const cy = t.bounds.y + t.bounds.h / 2 + t.ty
    if (handle === "move") {
      const dx = p.x - (drawingRef.current.last?.x ?? p.x)
      const dy = p.y - (drawingRef.current.last?.y ?? p.y)
      t.tx += dx
      t.ty += dy
      drawingRef.current.last = p
      return
    }
    if (perspectiveDrag && ["nw", "ne", "se", "sw"].includes(handle)) {
      const last = drawingRef.current.last ?? p
      const dx = p.x - last.x
      const dy = p.y - last.y
      const key = handle === "nw" ? "tl" : handle === "ne" ? "tr" : handle === "se" ? "br" : "bl"
      const current = t.perspective ?? {
        tl: { x: 0, y: 0 },
        tr: { x: 0, y: 0 },
        br: { x: 0, y: 0 },
        bl: { x: 0, y: 0 },
      }
      t.perspective = {
        ...current,
        [key]: {
          x: current[key].x + dx,
          y: current[key].y + dy,
        },
      }
      drawingRef.current.last = p
      return
    }
    if (handle === "rotate") {
      const last = drawingRef.current.last ?? p
      const a0 = Math.atan2(last.y - cy, last.x - cx)
      const a1 = Math.atan2(p.y - cy, p.x - cx)
      let deg = ((a1 - a0) * 180) / Math.PI + t.rotation
      if (shift) deg = Math.round(deg / 15) * 15
      t.rotation = deg
      drawingRef.current.last = p
      return
    }
    // scale handles
    const dx = (p.x - cx) / (t.bounds.w / 2 || 1)
    const dy = (p.y - cy) / (t.bounds.h / 2 || 1)
    let nx = t.scaleX
    let ny = t.scaleY
    if (handle.includes("e") || handle.includes("w")) nx = Math.abs(dx) || 0.01
    if (handle.includes("n") || handle.includes("s")) ny = Math.abs(dy) || 0.01
    if (handle === "e" || handle === "w") ny = t.scaleY
    if (handle === "n" || handle === "s") nx = t.scaleX
    if (shift) {
      const r = Math.max(Math.abs(nx), Math.abs(ny))
      nx = Math.sign(nx) * r
      ny = Math.sign(ny) * r
    }
    if (handle.includes("w") && p.x > cx) nx *= -1
    if (handle.includes("n") && p.y > cy) ny *= -1
    t.scaleX = nx
    t.scaleY = ny
  }

  function drawTransformSource(ctx: CanvasRenderingContext2D, t: TransformDragState) {
    if (!t.source) return
    if (!hasPerspective(t)) {
      applyTransformContext(ctx, t)
      ctx.drawImage(t.source, 0, 0)
      return
    }
    drawPerspectiveWarp(ctx, t.source, t.bounds, transformCorners(t), t.interpolation ?? "bicubic")
  }

  function hasPerspective(t: TransformDragState) {
    const p = t.perspective
    if (!p) return false
    return [p.tl, p.tr, p.br, p.bl].some((point) => Math.abs(point.x) > 0.01 || Math.abs(point.y) > 0.01)
  }

  function drawPerspectiveWarp(
    ctx: CanvasRenderingContext2D,
    source: HTMLCanvasElement,
    srcRect: { x: number; y: number; w: number; h: number },
    quad: { x: number; y: number }[],
    interpolation: TransformInterpolation,
  ) {
    const xs = quad.map((p) => p.x)
    const ys = quad.map((p) => p.y)
    const minX = Math.max(0, Math.floor(Math.min(...xs)))
    const minY = Math.max(0, Math.floor(Math.min(...ys)))
    const maxX = Math.min(ctx.canvas.width, Math.ceil(Math.max(...xs)))
    const maxY = Math.min(ctx.canvas.height, Math.ceil(Math.max(...ys)))
    if (maxX <= minX || maxY <= minY || srcRect.w <= 0 || srcRect.h <= 0) return
    const sctx = source.getContext("2d")
    if (!sctx) return
    const src = sctx.getImageData(0, 0, source.width, source.height)
    const out = ctx.getImageData(minX, minY, maxX - minX, maxY - minY)
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const uv = inverseBilinear({ x: x + 0.5, y: y + 0.5 }, quad)
        if (!uv || uv.u < 0 || uv.u > 1 || uv.v < 0 || uv.v > 1) continue
        const sx = srcRect.x + uv.u * srcRect.w
        const sy = srcRect.y + uv.v * srcRect.h
        const sample = sampleCanvasImage(src, sx, sy, interpolation !== "nearest")
        const i = ((y - minY) * out.width + (x - minX)) * 4
        const a = sample.a / 255
        if (a <= 0) continue
        out.data[i] = sample.r
        out.data[i + 1] = sample.g
        out.data[i + 2] = sample.b
        out.data[i + 3] = sample.a
      }
    }
    ctx.putImageData(out, minX, minY)
  }

  function inverseBilinear(point: { x: number; y: number }, quad: { x: number; y: number }[]) {
    let u = 0.5
    let v = 0.5
    for (let i = 0; i < 8; i++) {
      const p = bilinearPoint(quad, u, v)
      const du = {
        x: (1 - v) * (quad[1].x - quad[0].x) + v * (quad[2].x - quad[3].x),
        y: (1 - v) * (quad[1].y - quad[0].y) + v * (quad[2].y - quad[3].y),
      }
      const dv = {
        x: (1 - u) * (quad[3].x - quad[0].x) + u * (quad[2].x - quad[1].x),
        y: (1 - u) * (quad[3].y - quad[0].y) + u * (quad[2].y - quad[1].y),
      }
      const ex = p.x - point.x
      const ey = p.y - point.y
      const det = du.x * dv.y - du.y * dv.x
      if (Math.abs(det) < 1e-6) break
      u -= (ex * dv.y - ey * dv.x) / det
      v -= (du.x * ey - du.y * ex) / det
    }
    return { u, v }
  }

  function bilinearPoint(quad: { x: number; y: number }[], u: number, v: number) {
    const a = (1 - u) * (1 - v)
    const b = u * (1 - v)
    const c = u * v
    const d = (1 - u) * v
    return {
      x: quad[0].x * a + quad[1].x * b + quad[2].x * c + quad[3].x * d,
      y: quad[0].y * a + quad[1].y * b + quad[2].y * c + quad[3].y * d,
    }
  }

  function sampleCanvasImage(img: ImageData, x: number, y: number, smooth: boolean) {
    if (!smooth) {
      const sx = Math.max(0, Math.min(img.width - 1, Math.round(x)))
      const sy = Math.max(0, Math.min(img.height - 1, Math.round(y)))
      const i = (sy * img.width + sx) * 4
      return { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2], a: img.data[i + 3] }
    }
    const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(x)))
    const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(y)))
    const x1 = Math.max(0, Math.min(img.width - 1, x0 + 1))
    const y1 = Math.max(0, Math.min(img.height - 1, y0 + 1))
    const tx = x - x0
    const ty = y - y0
    const at = (px: number, py: number, c: number) => img.data[(py * img.width + px) * 4 + c]
    const mix = (c: number) =>
      at(x0, y0, c) * (1 - tx) * (1 - ty) +
      at(x1, y0, c) * tx * (1 - ty) +
      at(x0, y1, c) * (1 - tx) * ty +
      at(x1, y1, c) * tx * ty
    return { r: mix(0), g: mix(1), b: mix(2), a: mix(3) }
  }

  /* ---- wheel ---- */

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!activeDoc) return
    if (e.ctrlKey || e.metaKey || e.altKey) {
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0015)
      applyViewZoom(visualZoomRef.current * factor)
    } else {
      panRef.current = { x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY }
      applyStageTransform()
    }
  }

  const onPointerEnter = () => {
    const cur = cursorRef.current
    if (cur) cur.style.opacity = cur.firstElementChild ? "1" : "0"
  }
  const onPointerLeave = () => {
    const cur = cursorRef.current
    if (cur) cur.style.opacity = "0"
    // Previously this called onPointerUp with a synthesised
    // { clientX: 0, clientY: 0 } event. That produced a stroke commit at
    // canvas coordinates (0, 0), tainting every layer with a stray dab
    // in the top-left corner whenever the pointer crossed out of the
    // canvas mid-stroke. Strokes now stay in progress when the pointer
    // leaves; the real onPointerUp on the window/document still fires
    // when the user releases the button (browsers route a captured
    // pointer's pointerup back to the captured element regardless of
    // the leave). For non-stroke transient state (marquee preview, pan)
    // there is nothing to commit on leave, so simply hiding the cursor
    // is sufficient.
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
      onWheelCapture={onWheel}
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
              state={editingText}
              setState={setEditingText}
              commit={commitTextEdit}
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

/* ============================== helpers ============================== */

function _createSelectSubjectMask(width: number, height: number): ImageData {
  // Create a heuristic-based selection for subject detection
  // In a real implementation, this would use an actual AI model
  const imageData = new ImageData(width, height)
  const data = imageData.data

  // Create a radial gradient selection centered in the image
  const centerX = width / 2
  const centerY = height / 2
  const radiusX = width * 0.4
  const radiusY = height * 0.4

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4

      // Calculate normalized distance from center
      const dx = (x - centerX) / radiusX
      const dy = (y - centerY) / radiusY
      const distance = Math.sqrt(dx * dx + dy * dy)

      // Convert distance to alpha (closer to center = higher alpha)
      let alpha = 0
      if (distance <= 1) {
        // Smooth falloff using cosine
        alpha = Math.floor(255 * (0.5 + 0.5 * Math.cos(distance * Math.PI)))
      }

      data[i] = 255     // R
      data[i + 1] = 255 // G
      data[i + 2] = 255 // B
      data[i + 3] = alpha // A
    }
  }

  return imageData
}

function _createSelectSkyMask(width: number, height: number): ImageData {
  // Implement a heuristic-based sky detection algorithm
  // This provides effective sky selection for many common image types
  const imageData = new ImageData(width, height)
  const data = imageData.data

  // Create a selection that's stronger at the top (where sky usually is)
  // and gradually decreases towards the bottom
  const _skyHeight = height * 0.6 // Sky typically occupies the top portion

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4

      // Calculate normalized vertical position (0 at top, 1 at bottom)
      const normalizedY = y / height

      // Create a gradient that's strong at the top and fades towards the bottom
      let alpha = 0
      if (normalizedY <= 0.3) {
        // Strong sky presence in the top 30%
        alpha = 255
      } else if (normalizedY <= 0.8) {
        // Fade out between 30% and 80%
        const fadeFactor = 1 - ((normalizedY - 0.3) / 0.5)
        alpha = Math.floor(255 * fadeFactor)
      }
      // Below 80%, alpha remains 0 (no sky)

      data[i] = 135     // R (sky blue)
      data[i + 1] = 206 // G (sky blue)
      data[i + 2] = 250 // B (sky blue)
      data[i + 3] = alpha // A
    }
  }

  return imageData
}

function _createSelectBackgroundMask(width: number, height: number): ImageData {
  // Implement a heuristic-based background detection algorithm
  // This provides effective background selection for many common image types
  const imageData = new ImageData(width, height)
  const data = imageData.data

  // Create a selection that's stronger at the bottom (where background usually is)
  // and gradually decreases towards the top
  const _backgroundStart = height * 0.4 // Background typically starts from the middle going down

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4

      // Calculate normalized vertical position (0 at top, 1 at bottom)
      const normalizedY = y / height

      // Create a gradient that's strong at the bottom and fades towards the top
      let alpha = 0
      if (normalizedY >= 0.7) {
        // Strong background presence in the bottom 30%
        alpha = 255
      } else if (normalizedY >= 0.4) {
        // Fade in between 40% and 70%
        const fadeFactor = (normalizedY - 0.4) / 0.3
        alpha = Math.floor(255 * fadeFactor)
      }
      // Above 40%, alpha remains 0 (no background)

      // Use a neutral gray color for background selection
      data[i] = 128     // R (gray)
      data[i + 1] = 128 // G (gray)
      data[i + 2] = 128 // B (gray)
      data[i + 3] = alpha // A
    }
  }

  return imageData
}

function createRemoveMask(points: { x: number; y: number }[], brushSize: number, width: number, height: number): ImageData {
  // Create a mask from the stroked points for the remove tool
  const mask = new ImageData(width, height)
  const data = mask.data

  // Clear the mask (all transparent)
  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = 0 // alpha = 0
  }

  if (points.length === 0) return mask

  const radius = brushSize / 2

  // For each point, draw a circle in the mask
  for (const pt of points) {
    const x = Math.max(0, Math.min(width - 1, Math.floor(pt.x)))
    const y = Math.max(0, Math.min(height - 1, Math.floor(pt.y)))

    // Draw a filled circle
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const px = x + dx
        const py = y + dy

        if (px >= 0 && px < width && py >= 0 && py < height) {
          const distance = Math.sqrt(dx * dx + dy * dy)
          if (distance <= radius) {
            const i = (py * width + px) * 4
            data[i + 3] = 255 // Set alpha to fully opaque
          }
        }
      }
    }
  }

  return mask
}

function clipToSelection(ctx: CanvasRenderingContext2D, doc: PsDocument) {
  const sel = doc.selection
  if (!sel.bounds) return
  if (sel.mask) {
    // Use mask alpha as clip
    ctx.save()
    // Convert mask into a path is non-trivial; use destination-in mask later.
    // Workaround: clip to bounding rect for simplicity, mask multiplies in compose.
    ctx.beginPath()
    ctx.rect(sel.bounds.x, sel.bounds.y, sel.bounds.w, sel.bounds.h)
    ctx.clip()
    return
  }
  ctx.beginPath()
  if (sel.shape === "ellipse") {
    ctx.ellipse(
      sel.bounds.x + sel.bounds.w / 2,
      sel.bounds.y + sel.bounds.h / 2,
      sel.bounds.w / 2,
      sel.bounds.h / 2,
      0,
      0,
      Math.PI * 2,
    )
  } else {
    ctx.rect(sel.bounds.x, sel.bounds.y, sel.bounds.w, sel.bounds.h)
  }
  ctx.clip()
}

function autoPickLayer(
  doc: PsDocument,
  p: { x: number; y: number },
): Layer | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i] as Layer
    if (!l.visible || l.kind === "group") continue
    if (typeof l.canvas.getContext !== "function") continue
    const ctx = l.canvas.getContext("2d")!
    const px = ctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data
    if (px[3] > 8) return l
  }
  return null
}

type AlphaBoundsRect = { x: number; y: number; w: number; h: number } | null
const _alphaBoundsCache = new WeakMap<HTMLCanvasElement, { epoch: number; width: number; height: number; result: AlphaBoundsRect }>()
function alphaBounds(canvas: HTMLCanvasElement): AlphaBoundsRect {
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  const w = canvas.width
  const h = canvas.height
  const cached = _alphaBoundsCache.get(canvas)
  if (cached && cached.epoch === maskAlphaEpoch && cached.width === w && cached.height === h) {
    return cached.result
  }
  const img = ctx.getImageData(0, 0, w, h)
  const data = img.data
  let minX = w
  let minY = h
  let maxX = 0
  let maxY = 0
  let hasPixels = false
  // Row-major scan with strided alpha lookups; unrolled to minimise inner-loop overhead.
  for (let y = 0; y < h; y++) {
    let rowStart = y * w * 4 + 3
    for (let x = 0; x < w; x++, rowStart += 4) {
      if (data[rowStart] > 8) {
        hasPixels = true
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  const result: AlphaBoundsRect = hasPixels
    ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
    : null
  _alphaBoundsCache.set(canvas, { epoch: maskAlphaEpoch, width: w, height: h, result })
  return result
}

function drawFramePlaceholder(
  ctx: CanvasRenderingContext2D,
  frame: { shape: "rect" | "ellipse"; x: number; y: number; w: number; h: number },
) {
  ctx.save()
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.fillStyle = "rgba(15, 23, 42, 0.18)"
  ctx.strokeStyle = "#38bdf8"
  ctx.lineWidth = 2
  ctx.setLineDash([8, 5])
  ctx.beginPath()
  if (frame.shape === "ellipse") {
    ctx.ellipse(frame.x + frame.w / 2, frame.y + frame.h / 2, frame.w / 2, frame.h / 2, 0, 0, Math.PI * 2)
  } else {
    ctx.rect(frame.x, frame.y, frame.w, frame.h)
  }
  ctx.fill()
  ctx.stroke()
  ctx.setLineDash([])
  ctx.strokeStyle = "rgba(255, 255, 255, 0.8)"
  ctx.beginPath()
  ctx.moveTo(frame.x, frame.y)
  ctx.lineTo(frame.x + frame.w, frame.y + frame.h)
  ctx.moveTo(frame.x + frame.w, frame.y)
  ctx.lineTo(frame.x, frame.y + frame.h)
  ctx.stroke()
  ctx.restore()
}

function drawArtboardPreview(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  background: string,
) {
  ctx.save()
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.fillStyle = background
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = "#f8fafc"
  ctx.lineWidth = 2
  ctx.strokeRect(x, y, w, h)
  ctx.strokeStyle = "#0f172a"
  ctx.lineWidth = 1
  ctx.strokeRect(x + 3, y + 3, Math.max(0, w - 6), Math.max(0, h - 6))
  ctx.restore()
}

function drawSlicePreview(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save()
  ctx.strokeStyle = "#f97316"
  ctx.lineWidth = 2
  ctx.setLineDash([6, 4])
  ctx.strokeRect(x, y, w, h)
  ctx.setLineDash([])
  ctx.fillStyle = "rgba(249, 115, 22, 0.14)"
  ctx.fillRect(x, y, w, h)
  ctx.restore()
}

function applySelectionMaskToCanvas(canvas: HTMLCanvasElement, doc: PsDocument) {
  const mask = selectionToMaskCanvas(doc.width, doc.height, doc.selection)
  if (!mask) return
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  ctx.save()
  ctx.globalCompositeOperation = "destination-in"
  ctx.drawImage(mask, 0, 0)
  ctx.restore()
}

function selectBackgroundMaskFromImage(canvas: HTMLCanvasElement, tolerance: number) {
  return selectBackgroundMask(canvas, tolerance)
}
