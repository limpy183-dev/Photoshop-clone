/**
 * Document composition for the canvas view.
 *
 * `drawDocumentComposite` is the whole render decision tree in one place:
 * fingerprint the layer stack, then pick the cheapest path that can produce the
 * frame — cache reuse, tile-local recomposition, the high-bit preview, WebGL,
 * or the Canvas 2D layer loop. The view owns the refs; this owns the choice.
 */

import { applyModeAndColorManagement } from "@/editor/document/color-management"
import { isEmptyDirtyRect } from "@/editor/dirty-rect"
import { normalizeAdvancedBlending } from "@/editor/layer-workflows"
import { planMemoryBudget } from "@/editor/memory-budget"
import { planCompositeCache } from "@/editor/performance-engine"
import { planProgressiveRender } from "@/editor/progressive-renderer"
import { planDocumentTileRecomposition } from "@/editor/document/tile-recomposition"
import { renderDocumentHighBitPreviewCanvas } from "@/editor/high-bit-document"
import {
  composeDocumentTile,
  planTileOnlyDefaultCompositor,
  renderTileOnlyViewportComposite,
  supportsTileOnlyLayer,
} from "@/editor/tile-only-pipeline"
import {
  compositeDocumentWithWebGL,
  prepareLayerInputForWebGL,
  planWebGLCompositor,
  sharedCompositeTarget,
} from "@/editor/webgl-compositor"
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
import { makeCanvas } from "@/editor/canvas/utils"
import type { CanvasDirtyRect } from "@/editor/canvas/view-helpers"
import type { PsDocument } from "@/editor/types"

const COMPOSITE_TILE_SIZE = 512

export interface CompositeCacheState {
  fingerprint: string
  drawnFingerprint: string
  width: number
  height: number
  canvas: HTMLCanvasElement | null
}

export function emptyCompositeCache(): CompositeCacheState {
  return { fingerprint: "", drawnFingerprint: "", width: 0, height: 0, canvas: null }
}

export interface CompositeChange {
  layerIds: "all" | string[]
  reasons: string[]
  dirtyByLayer?: Record<string, CanvasDirtyRect[]>
  fullFrame?: boolean
}

export interface CompositeRenderContext {
  canvas: HTMLCanvasElement
  document: PsDocument
  filterPreviews: Record<string, HTMLCanvasElement>
  viewZoom: number
  cache: { current: CompositeCacheState }
  progressiveFrame: { current: number | null }
  progressiveFullPass: { current: boolean }
  /** Document-space rect currently on screen, used by the tile-only planner. */
  viewport: () => CanvasDirtyRect
}

/**
 * One shared probe context for capability detection. Creating a fresh WebGL
 * context per compose() blows past the browser's context limit and evicts the
 * compositor's own contexts.
 */
let sharedGLProbe: WebGLRenderingContext | WebGL2RenderingContext | null | undefined
export function getSharedGLProbe() {
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

/** Document-space rect of the stage that is inside the scroll container. */
export function computeVisibleDocumentViewport(
  document: PsDocument | null | undefined,
  container: HTMLElement | null,
  stage: HTMLElement | null,
): CanvasDirtyRect {
  if (!document) return { x: 0, y: 0, w: 1, h: 1 }
  if (!container || !stage) return { x: 0, y: 0, w: document.width, h: document.height }
  const containerRect = container.getBoundingClientRect()
  const stageRect = stage.getBoundingClientRect()
  if (stageRect.width <= 0 || stageRect.height <= 0) return { x: 0, y: 0, w: document.width, h: document.height }
  const x0 = ((containerRect.left - stageRect.left) / stageRect.width) * document.width
  const y0 = ((containerRect.top - stageRect.top) / stageRect.height) * document.height
  const x1 = ((containerRect.right - stageRect.left) / stageRect.width) * document.width
  const y1 = ((containerRect.bottom - stageRect.top) / stageRect.height) * document.height
  return {
    x: Math.max(0, Math.floor(Math.min(x0, x1))),
    y: Math.max(0, Math.floor(Math.min(y0, y1))),
    w: Math.max(1, Math.min(document.width, Math.ceil(Math.max(x0, x1))) - Math.max(0, Math.floor(Math.min(x0, x1)))),
    h: Math.max(1, Math.min(document.height, Math.ceil(Math.max(y0, y1))) - Math.max(0, Math.floor(Math.min(y0, y1)))),
  }
}

/**
 * Cancel a progressive second pass that has been scheduled but not yet run.
 * Lives here rather than in the view because this module is what schedules it.
 */
export function cancelProgressiveRender(progressiveFrame: { current: number | null }) {
  if (progressiveFrame.current !== null) cancelAnimationFrame(progressiveFrame.current)
}

/**
 * Publish the freshly drawn composite as the cache. The canvas does double
 * duty: identity-reuse, and the previous frame that `canUseLayerPartial`
 * paints tiles over. Forced renders (every brush frame) have to keep it for
 * the second job or painting re-composites the whole document every frame —
 * they just publish an empty `fingerprint` so identity-reuse stays off for
 * pixels that mutated without a fingerprint change.
 */
function storeCompositeCache(
  cache: { current: CompositeCacheState },
  cv: HTMLCanvasElement,
  fp: string,
  force: boolean,
  allowed = true,
) {
  const { width, height } = cv
  if (!allowed || !planCompositeCache({ width, height }).storeCache) {
    cache.current = { fingerprint: "", drawnFingerprint: fp, width, height, canvas: null }
    return
  }
  const previous = cache.current.canvas
  const cached = previous?.width === width && previous.height === height ? previous : makeCanvas(width, height)
  const cachedCtx = cached.getContext("2d")!
  cachedCtx.clearRect(0, 0, width, height)
  cachedCtx.drawImage(cv, 0, 0)
  cache.current = { fingerprint: force ? "" : fp, drawnFingerprint: fp, width, height, canvas: cached }
}

function resetCompositeCanvasPlacement(cv: HTMLCanvasElement) {
  cv.style.left = "0px"
  cv.style.top = "0px"
  cv.style.right = "0px"
  cv.style.bottom = "0px"
  cv.style.width = "100%"
  cv.style.height = "100%"
}

/** Overlay the quick-mask rubylith at 50% over whatever is already composited. */
function drawQuickMaskOverlay(ctx: CanvasRenderingContext2D, document: PsDocument) {
  if (!document.quickMask || !document.quickMaskCanvas) return
  ctx.save()
  const tmp = makeCanvas(document.width, document.height)
  const tctx = tmp.getContext("2d")!
  tctx.fillStyle = "rgba(255,0,0,0.5)"
  tctx.fillRect(0, 0, document.width, document.height)
  tctx.globalCompositeOperation = "destination-in"
  tctx.drawImage(document.quickMaskCanvas, 0, 0)
  ctx.drawImage(tmp, 0, 0)
  ctx.restore()
}

function applyColorManagementInPlace(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  document: PsDocument,
) {
  const colorManaged = applyModeAndColorManagement(cv, document)
  if (colorManaged === cv) return
  ctx.clearRect(0, 0, cv.width, cv.height)
  ctx.drawImage(colorManaged, 0, 0)
}

/**
 * Lightweight fingerprint of the composite inputs. Mutable pixel edits are
 * rendered through requestRender(), which passes force=true and bypasses this
 * identity cache.
 */
function compositeFingerprint(document: PsDocument, filterPreviews: Record<string, HTMLCanvasElement>) {
  let fp = `x||`
  for (const layer of document.layers) {
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
  return fp
}

/** The Canvas 2D layer loop: the fallback every other path falls back to. */
function compositeLayersWithCanvas2D(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  document: PsDocument,
  filterPreviews: Record<string, HTMLCanvasElement>,
) {
  ctx.clearRect(0, 0, cv.width, cv.height)
  // Running fingerprint of all layers composited so far. Adjustment layers use
  // this to decide whether they can reuse a cached filter output.
  let prefixFp = ""
  const shallowKnockoutBackdrops = new Map<string, HTMLCanvasElement>()
  // Both backdrops are document-sized snapshots — an allocation plus a full
  // copy per frame. Skip them entirely unless a layer will actually read one.
  const knockoutModes = new Set(
    document.layers.map((l) => normalizeAdvancedBlending(l.advancedBlending).knockout),
  )
  const usesShallowKnockout = knockoutModes.has("shallow")
  // Deep knockout punches all the way through to the document base layer (the
  // locked "Background" layer if present, otherwise transparency). Compute it
  // up-front so every deep-knockout layer reveals the same backdrop regardless
  // of its parent group.
  let deepKnockoutBackdrop: HTMLCanvasElement | null = null
  const baseLayer = !knockoutModes.has("deep") ? undefined : document.layers.find(
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
  for (const layer of document.layers) {
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
      const idx = document.layers.indexOf(layer)
      for (let j = idx - 1; j >= 0; j--) {
        if (!document.layers[j].clipped) {
          clipMask = document.layers[j].canvas
          break
        }
      }
    }
    if (layer.kind === "adjustment" && layer.adjustment) {
      applyAdjustmentLayer(ctx, layer, document.width, document.height, clipMask, prefixFp)
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
}

export function drawDocumentComposite(
  render: CompositeRenderContext,
  force = false,
  change?: CompositeChange,
): void {
  const { canvas: cv, document: doc, filterPreviews, viewZoom, cache } = render

  // Forced renders happen when underlying pixels mutated without a fingerprint
  // change (brush strokes on canvases or masks). Drop the mask alpha cache so
  // freshly-painted mask pixels propagate through adjustment compositing.
  if (force) invalidateMaskAlphaCache()

  const fp = compositeFingerprint(doc, filterPreviews)

  const dirtyRects = change?.dirtyByLayer ? Object.values(change.dirtyByLayer).flatMap((rects) => rects) : undefined
  const defaultTilePlan = planTileOnlyDefaultCompositor({
    documentWidth: doc.width,
    documentHeight: doc.height,
    tileSize: COMPOSITE_TILE_SIZE,
    viewport: render.viewport(),
    prefetchPadding: 0,
    dirtyRects,
    layers: doc.layers,
    explicitTileOnly: !!doc.metadata?.largeDocumentTileView,
    colorMode: doc.colorMode,
    bitDepth: doc.bitDepth,
    quickMask: doc.quickMask,
    filterPreviewCount: Object.keys(filterPreviews).length,
  })
  if (defaultTilePlan.strategy === "tile-local") {
    const rendered = renderTileOnlyViewportComposite(doc, defaultTilePlan, {
      transparent: false,
      matte: doc.background,
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
    cache.current = { fingerprint: "", drawnFingerprint: fp, width: cv.width, height: cv.height, canvas: null }
    return
  }

  resetCompositeCanvasPlacement(cv)
  if (cv.width !== doc.width) cv.width = doc.width
  if (cv.height !== doc.height) cv.height = doc.height

  const cached = cache.current
  if (!force && cached.drawnFingerprint === fp && cached.width === cv.width && cached.height === cv.height) {
    return
  }
  if (!force && cached.fingerprint === fp && cached.canvas) {
    const ctx = cv.getContext("2d")!
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.drawImage(cached.canvas, 0, 0)
    cached.drawnFingerprint = fp
    cached.width = cv.width
    cached.height = cv.height
    return
  }

  const ctx = cv.getContext("2d")!

  if (
    doc.bitDepth > 8 &&
    !doc.quickMask &&
    Object.keys(filterPreviews).length === 0
  ) {
    const highBit = renderDocumentHighBitPreviewCanvas(doc)
    if (highBit) {
      ctx.clearRect(0, 0, cv.width, cv.height)
      ctx.drawImage(highBit.canvas, 0, 0)
      applyColorManagementInPlace(ctx, cv, doc)
      storeCompositeCache(cache, cv, fp, force)
      return
    }
  }

  const canUseLayerPartial =
    force &&
    change &&
    !change.fullFrame &&
    change.dirtyByLayer &&
    Object.keys(change.dirtyByLayer).length > 0 &&
    cached.canvas &&
    doc.colorMode === "RGB" &&
    !doc.quickMask &&
    Object.keys(filterPreviews).length === 0

  if (canUseLayerPartial) {
    const dirtyPlan = planDocumentTileRecomposition(doc, {
      dirtyByLayer: change.dirtyByLayer!,
      tileSize: COMPOSITE_TILE_SIZE,
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
      doc.layers.every((layer) => !layer.visible || layer.kind === "group" || supportsTileOnlyLayer(layer)) &&
      !isEmptyDirtyRect(dirtyPlan.compositeRect)
    ) {
      const rect = dirtyPlan.compositeRect
      for (const tile of dirtyPlan.tiles) {
        const tileCanvas = composeDocumentTile(doc, {
          ...tile.rect,
          transparent: true,
        })
        ctx.clearRect(tile.rect.x, tile.rect.y, tile.rect.w, tile.rect.h)
        ctx.drawImage(tileCanvas, tile.rect.x, tile.rect.y)
      }
      cached.canvas!.getContext("2d")!.drawImage(cv, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h)
      cached.drawnFingerprint = fp
      cached.width = cv.width
      cached.height = cv.height
      return
    }
  }

  const progressivePlan = planProgressiveRender({
    width: cv.width,
    height: cv.height,
    tileSize: COMPOSITE_TILE_SIZE,
  })
  if (
    force &&
    cached.canvas &&
    progressivePlan.mode === "preview-then-full" &&
    !render.progressiveFullPass.current
  ) {
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "low"
    ctx.drawImage(cached.canvas, 0, 0)
    if (render.progressiveFrame.current !== null) cancelAnimationFrame(render.progressiveFrame.current)
    render.progressiveFrame.current = requestAnimationFrame(() => {
      render.progressiveFrame.current = null
      render.progressiveFullPass.current = true
      drawDocumentComposite(render, true, change)
      render.progressiveFullPass.current = false
    })
    return
  }

  const glProbe = getSharedGLProbe()
  const webglPlan = planWebGLCompositor({
    width: cv.width,
    height: cv.height,
    layerCount: doc.layers.length,
    preferWebGL: true,
    webglAvailable: !!glProbe,
    maxTextureSize: glProbe ? Number(glProbe.getParameter(glProbe.MAX_TEXTURE_SIZE)) || undefined : undefined,
  })
  if (
    webglPlan.path !== "canvas-2d" &&
    doc.colorMode === "RGB"
  ) {
    const glCanvas = sharedCompositeTarget()
    const result = compositeDocumentWithWebGL(glCanvas, doc.layers, {
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
      applyColorManagementInPlace(ctx, cv, doc)
      drawQuickMaskOverlay(ctx, doc)
      storeCompositeCache(cache, cv, fp, force)
      return
    }
  }

  compositeLayersWithCanvas2D(ctx, cv, doc, filterPreviews)
  applyColorManagementInPlace(ctx, cv, doc)
  drawQuickMaskOverlay(ctx, doc)

  const memoryPlan = planMemoryBudget({
    width: cv.width,
    height: cv.height,
    layerCount: doc.layers.length,
    historyStates: 12,
    memoryBudgetMB: 1024,
  })
  storeCompositeCache(cache, cv, fp, force, !memoryPlan.actions.includes("disable-composite-cache"))
}
