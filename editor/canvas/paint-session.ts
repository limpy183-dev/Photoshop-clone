/**
 * The lifetime of a paint stroke, from the first dab to the history commit.
 *
 * Everything a raster-painting tool needs that outlives a single dab lives in
 * here: which canvas is being painted (layer, layer mask, quick mask, smart
 * filter mask), the frozen sources that keep a stroke from sampling its own
 * output, the stroke buffer that makes opacity behave per-stroke rather than
 * per-dab, the mixer reservoir, and the dirty-rect bookkeeping that decides how
 * much of the document has to re-composite each frame.
 *
 * `stamp`-level pixel work lives in `brush-stamping.ts` and
 * `replacement-stamps.ts`; this file walks the stroke and calls into them.
 */

import * as React from "react"

import { compositeLayer } from "@/editor/blend-modes"
import {
  normalizeBrushPointerSample,
  planArtHistoryStroke,
  resolveMixerReservoirStep,
  type BrushDynamicsInput,
  type BrushPointerSample,
  type BrushRgba,
} from "@/editor/brush-engine"
import { syncHighBitLayerFromCanvasChange } from "@/editor/high-bit-document"
import type { ChangedLayerIds } from "@/editor/history-geometry"
import type { RenderChange } from "@/editor/render-bus"
import { createSelectionHitTester, type SelectionHitTester } from "@/editor/selection-hit-testing"
import { planTileOnlyInteractiveTool } from "@/editor/tile-only-pipeline"
import {
  SmudgeBuffer,
  blurStamp,
  dodgeBurnStamp,
  healStamp,
  pickHealSource,
  sharpenStamp,
  spongeStamp,
  transformedCloneStamp,
} from "@/editor/tool/helpers"
import {
  effectiveBrushSpacing,
  isEraserPaintTool,
  quickMaskPaintsSubtract,
  stampWithScatter,
  strokeDirtyPadding,
  type BrushStampContext,
  type DabShapeCache,
  type StampOptions,
} from "@/editor/canvas/brush-stamping"
import {
  selectiveEraserStamp,
  type SampledRgba,
} from "@/editor/canvas/replacement-stamps"
import type { CanvasDragRef } from "@/editor/canvas/drag-state"
import {
  applySelectionClip,
  captureSelectionClip,
  dabTouchesSelection,
  type SelectionClip,
} from "@/editor/canvas/selection-helpers"
import { makeCanvas } from "@/editor/canvas/utils"
import {
  clamp01,
  cloneCanvasForTool,
  historySourceCanvas,
  mergeDirtyRect,
  requiredRgbaFromCss,
  rgbaToCss,
  sampleCanvasColor,
  type CanvasDirtyRect,
} from "@/editor/canvas/view-helpers"
import {
  getDodgeBurnRuntimeOptions,
  getEyedropperSampleSize,
  getSpongeRuntimeOptions,
  layerAllowsDrawing,
} from "@/editor/canvas/view-runtime"
import { labelForTool } from "@/editor/canvas/shape-helpers"
import type {
  BrushSettings,
  CloneSourceSettings,
  EraserSettings,
  HistoryEntry,
  Layer,
  PsDocument,
  SymmetrySettings,
  ToolId,
} from "@/editor/types"

const STROKE_TILE_SIZE = 512

/** Tools that read the layer while painting into it, so they need a frozen copy. */
const SAMPLING_RETOUCH_TOOLS = new Set<ToolId>([
  "clone-stamp",
  "healing-brush",
  "spot-healing",
])

/** Tools that paint by walking a stroke rather than acting on a single click. */
export const PAINTING_TOOLS = new Set<ToolId>([
  "brush",
  "mixer-brush",
  "pencil",
  "eraser",
  "color-replace",
  "background-eraser",
  "pattern-stamp",
  "blur",
  "sharpen",
  "smudge",
  "dodge",
  "burn",
  "sponge",
  "clone-stamp",
  "history-brush",
  "art-history-brush",
  "spot-healing",
  "healing-brush",
])

interface StrokeCompositeState {
  target: HTMLCanvasElement
  source: HTMLCanvasElement
  stroke: HTMLCanvasElement
  erasing: boolean
  targetKind?: "smart-filter-mask"
  opacity: number
  flow: number
}

interface CloneAnchorState {
  sourceX: number
  sourceY: number
  destX?: number
  destY?: number
  layerId: string
}

/** The canvas a paint tool writes to, which is not always the active layer. */
export interface PaintTarget {
  ctx: CanvasRenderingContext2D
  canvas: HTMLCanvasElement
  targetKind?: "smart-filter-mask"
}

export interface PaintSessionOptions {
  activeDoc: PsDocument | null | undefined
  activeLayer: Layer | null | undefined
  tool: ToolId
  brush: BrushSettings
  foreground: string
  background: string
  eraser: EraserSettings
  cloneSource: CloneSourceSettings
  symmetry: SymmetrySettings
  activeSmartFilterMaskTarget: { layerId: string; filterId: string } | null | undefined
  compositeRef: React.RefObject<HTMLCanvasElement | null>
  drawingRef: CanvasDragRef
  requestRender: (change?: RenderChange) => void
  commit: (label: string, changedLayerIds?: ChangedLayerIds) => void
  historyEntries: () => HistoryEntry[]
}

export function useCanvasPaintSession(options: PaintSessionOptions) {
  const {
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
    historyEntries,
  } = options

  const cloneSourceRef = React.useRef<CloneAnchorState | null>(null)
  const eraserSampleRef = React.useRef<SampledRgba | null>(null)
  const colorReplacementSampleRef = React.useRef<SampledRgba | null>(null)
  const smudgeBufferRef = React.useRef<SmudgeBuffer>(new SmudgeBuffer())
  const strokeDabRef = React.useRef(0)
  const strokeDistRef = React.useRef(0)
  const strokeCompositeRef = React.useRef<StrokeCompositeState | null>(null)
  const lastBrushPointerSampleRef = React.useRef<BrushPointerSample | null>(null)
  const selectionHitTesterRef = React.useRef<SelectionHitTester | null>(null)
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
  const dabShapeCacheRef = React.useRef<DabShapeCache | null>(null)

  /* ---- paint target resolution ---- */

  function activeSmartFilterMaskCanvas(): HTMLCanvasElement | null {
    if (!activeDoc || !activeSmartFilterMaskTarget) return null
    if (activeLayer?.id !== activeSmartFilterMaskTarget.layerId) return null
    if (!layerAllowsDrawing(activeLayer)) return null
    const filter = activeLayer.smartFilters?.find((candidate) => candidate.id === activeSmartFilterMaskTarget.filterId)
    if (!filter || filter.maskEnabled === false || !filter.mask) return null
    return filter.mask
  }

  function getActiveCtx(): PaintTarget | null {
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

  /* ---- transparency lock ---- */

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

  /* ---- high-bit companion image ---- */

  function captureHighBitPaintSource() {
    highBitStrokeSourceRef.current = null
    if (!activeDoc || activeDoc.bitDepth <= 8 || activeDoc.quickMask || !activeLayer) return
    if (activeLayer.kind === "adjustment" || activeSmartFilterMaskCanvas()) return
    if (!layerAllowsDrawing(activeLayer) || typeof activeLayer.canvas.getContext !== "function") return
    highBitStrokeSourceRef.current = cloneCanvasForTool(activeLayer.canvas)
  }

  function syncActiveLayerHighBitFromCanvas(dirty?: CanvasDirtyRect) {
    if (!activeDoc || activeDoc.bitDepth <= 8 || !activeLayer || activeDoc.quickMask) return
    const before = highBitStrokeSourceRef.current
    if (!before || typeof activeLayer.canvas.getContext !== "function") return
    syncHighBitLayerFromCanvasChange(activeLayer, activeDoc, before, activeLayer.canvas, dirty)
    highBitStrokeSourceRef.current = null
  }

  /* ---- stroke buffer ----
   *
   * Brush and eraser accumulate the whole stroke into an offscreen canvas and
   * flatten it once per frame, so overlapping dabs do not compound opacity.
   */

  function isStrokeBufferedPaintTool() {
    return tool === "brush" || tool === "eraser"
  }

  function beginBufferedStroke(target: HTMLCanvasElement, targetKind?: "smart-filter-mask") {
    if (!isStrokeBufferedPaintTool()) return
    const source = makeCanvas(target.width, target.height)
    source.getContext("2d")!.drawImage(target, 0, 0)
    strokeCompositeRef.current = {
      target,
      source,
      stroke: makeCanvas(target.width, target.height),
      erasing: activeDoc?.quickMask
        ? quickMaskPaintsSubtract(activeDoc, tool)
        : targetKind === "smart-filter-mask"
          ? false
          : isEraserPaintTool(tool),
      targetKind,
      opacity: clamp01(brush.opacity / 100),
      flow: clamp01(brush.flow / 100),
    }
  }

  function restoreBufferedStrokeSource(state: StrokeCompositeState, rect?: CanvasDirtyRect) {
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

  /* ---- dirty-rect bookkeeping ---- */

  function clampDirtyRect(rect: CanvasDirtyRect): CanvasDirtyRect | null {
    if (!activeDoc) return null
    const x1 = Math.max(0, Math.floor(rect.x))
    const y1 = Math.max(0, Math.floor(rect.y))
    const x2 = Math.min(activeDoc.width, Math.ceil(rect.x + rect.w))
    const y2 = Math.min(activeDoc.height, Math.ceil(rect.y + rect.h))
    if (x2 <= x1 || y2 <= y1) return null
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
  }

  function markStrokeDirty(from: { x: number; y: number } | null, to: { x: number; y: number }) {
    const drag = drawingRef.current
    if (drag.type !== "stroke" || !activeDoc) return
    if (symmetry.enabled) {
      drag.dirty = { x: 0, y: 0, w: activeDoc.width, h: activeDoc.height }
      drag.frameDirty = drag.dirty
      return
    }
    const pad = strokeDirtyPadding(brush)
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
      tileSize: STROKE_TILE_SIZE,
      tool,
      layerId: activeLayer.id,
      bounds: dirty,
      radius: strokeDirtyPadding(brush),
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

  /* ---- clone / history sources ---- */

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
    return historySourceCanvas(historyEntries(), activeLayer.id)
  }

  /* ---- mixer brush reservoir ---- */

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

  function resolveMixerDab(ctx: CanvasRenderingContext2D, x: number, y: number, input: BrushDynamicsInput) {
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

  /* ---- pointer input ---- */

  function pointerBrushInput(
    event: { timeStamp?: number; pointerType?: string; pressure?: number; tiltX?: number; tiltY?: number; twist?: number },
    point: { x: number; y: number },
  ) {
    const sample = normalizeBrushPointerSample(event, point, lastBrushPointerSampleRef.current)
    lastBrushPointerSampleRef.current = sample
    return {
      pressure: sample.pressure,
      tiltX: sample.tiltX,
      tiltY: sample.tiltY,
      twist: sample.twist,
      velocity: sample.velocity ?? 0,
    }
  }

  function brushInputFromPointer(
    pointerInput: Partial<BrushDynamicsInput> | undefined,
    velocity: number,
    fade: number,
    strokeAngle: number,
  ): BrushDynamicsInput {
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

  function stampContext(): BrushStampContext {
    return {
      tool,
      brush,
      foreground,
      background,
      symmetry,
      document: activeDoc,
      hasActiveLayer: !!activeLayer,
      dabShapeCache: dabShapeCacheRef,
      colorReplacementSource: colorReplacementSourceRef.current,
      colorReplacementSample: colorReplacementSampleRef,
      enforceTransparencyLock,
    }
  }

  /* ---- the stroke itself ---- */

  const drawSegment = (
    from: { x: number; y: number } | null,
    to: { x: number; y: number },
    pointerInput?: Partial<BrushDynamicsInput>,
  ) => {
    const bufferedStroke = strokeCompositeRef.current
    const target = bufferedStroke && isStrokeBufferedPaintTool()
      ? { ctx: bufferedStroke.stroke.getContext("2d")!, canvas: bufferedStroke.stroke }
      : getActiveCtx()
    if (!target || !activeDoc) return
    const { ctx, canvas } = target
    const stamps = stampContext()
    const stampOptions: StampOptions | undefined = bufferedStroke
      ? { includeBrushOpacity: false, enforceTransparencyLock: false, drawEraserMask: true }
      : undefined
    markStrokeDirty(from, to)
    const w = canvas.width
    const h = canvas.height
    const dist = from ? Math.hypot(to.x - from.x, to.y - from.y) : 0
    const spacing = effectiveBrushSpacing(tool, brush)
    const strokeAngle = from ? Math.atan2(to.y - from.y, to.x - from.x) : (pointerInput?.strokeAngle ?? 0)
    const velocity = pointerInput?.velocity ?? dist
    /** Point at parameter `t` along this segment; `t = 1` when there is no origin. */
    const at = (t: number) => ({
      x: from ? from.x + (to.x - from.x) * t : to.x,
      y: from ? from.y + (to.y - from.y) * t : to.y,
    })
    const uniformSteps = () => Math.max(1, Math.floor(dist / spacing))

    if (tool === "background-eraser" || tool === "magic-eraser") {
      const steps = uniformSteps()
      for (let i = 0; i <= steps; i++) {
        const p = at(steps === 0 ? 1 : i / steps)
        const input = brushInputFromPointer(pointerInput, velocity, strokeDabRef.current++, strokeAngle)
        selectiveEraserStamp(
          {
            document: activeDoc,
            layerCanvas: activeLayer?.canvas ?? null,
            brush,
            eraser,
            foreground,
            background,
            sourceCanvas: eraserSourceRef.current,
            sample: eraserSampleRef,
            enforceTransparencyLock,
          },
          ctx,
          p.x,
          p.y,
          input,
        )
      }
    } else if (tool === "brush" || tool === "pencil" || tool === "mixer-brush" || tool === "pattern-stamp" || tool === "eraser" || tool === "color-replace") {
      const scatterAmt = brush.scatter ?? 0
      const scatterCnt = brush.scatterCount ?? 1
      const scatterCntJ = brush.scatterCountJitter ?? 0
      /** One spaced dab, mixing the reservoir first when the mixer brush is active. */
      const paintDab = (x: number, y: number) => {
        const input = brushInputFromPointer(pointerInput, velocity, strokeDabRef.current++, strokeAngle)
        const mixerDab = tool === "mixer-brush" ? resolveMixerDab(ctx, x, y, input) : null
        stampWithScatter(
          stamps,
          ctx,
          x,
          y,
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
      }

      // If this is the first dab of a stroke (no previous point), stamp once and reset distance
      if (!from) {
        strokeDistRef.current = 0
        paintDab(to.x, to.y)
      } else {
        // Accumulate distance and place dabs at exact spacing intervals.
        // Start position: offset by how much distance was already accumulated
        let walked = spacing - strokeDistRef.current
        while (walked <= dist) {
          const p = at(walked / dist)
          paintDab(p.x, p.y)
          walked += spacing
        }
        // Store leftover distance for next segment
        strokeDistRef.current = dist - (walked - spacing)
      }
    } else {
      // For non-brush tools, use simple uniform stepping
      const steps = uniformSteps()
      /** Walk the segment, skipping dabs whose footprint misses the selection. */
      const walk = (paint: (x: number, y: number, index: number) => void, radius = brush.size / 2) => {
        for (let i = 0; i <= steps; i++) {
          const p = at(steps === 0 ? 1 : i / steps)
          if (!dabTouchesSelection(activeDoc, p.x, p.y, radius)) continue
          paint(p.x, p.y, i)
        }
      }
      if (tool === "blur") {
        // `flow` is the options-bar Strength for blur / sharpen / smudge.
        walk((x, y) => blurStamp(ctx, x, y, brush.size / 2, brush.flow / 100))
      } else if (tool === "sharpen") {
        walk((x, y) => sharpenStamp(ctx, x, y, brush.size / 2, brush.flow / 100))
      } else if (tool === "smudge") {
        walk((x, y) => smudgeBufferRef.current.step(ctx, x, y, brush.size / 2, brush.flow / 100))
      } else if (tool === "dodge" || tool === "burn") {
        const dodgeOptions = getDodgeBurnRuntimeOptions()
        // 0.12 peak per dab at 100% exposure: dabs land every `spacing` px, so
        // the stroke builds up gradually instead of clipping on contact.
        const strength = (dodgeOptions.exposure / 100) * 0.12
        walk((x, y) => {
          dodgeBurnStamp(ctx, x, y, brush.size / 2, tool, strength, {
            range: dodgeOptions.range,
            protectTones: dodgeOptions.protectTones,
            hardness: brush.hardness,
          })
        })
      } else if (tool === "sponge") {
        const spongeOptions = getSpongeRuntimeOptions()
        const strength = (spongeOptions.flow / 100) * 0.15
        walk((x, y) => spongeStamp(ctx, x, y, brush.size / 2, strength, spongeOptions.mode))
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
        walk((dx, dy, i) => {
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
        })
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
        walk((dx, dy) => {
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
        })
      } else if (tool === "spot-healing") {
        // Heal from surrounding pixels. The source is the stroke-start freeze,
        // not the live canvas, and the donor patch is chosen per dab instead of
        // always being "2r to the right" — a fixed offset walked off-canvas at
        // the edges and, mid-drag, sampled pixels this same stroke had already
        // repaired.
        const source = retouchSourceRef.current ?? canvas
        walk((x, y) => {
          const r = brush.size / 2
          const donor = pickHealSource(source, x, y, r)
          healStamp(ctx, source, donor.x, donor.y, x, y, r)
        })
      }
    }
    applySelectionClip(ctx, selectionClipRef.current, { buffered: !!bufferedStroke })
    if (!renderBufferedStroke()) requestTileAwareStrokeRender()
  }

  /* ---- stroke lifecycle ---- */

  /** Freeze every source a stroke reads from, then place the first dab. */
  function beginStroke(point: { x: number; y: number }, pointerInput: Partial<BrushDynamicsInput>) {
    if (!activeDoc) return
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
    drawingRef.current = { type: "stroke", last: point, smooth: point }
    drawSegment(null, point, pointerInput)
  }

  /** Drop every per-stroke source and sample. Safe to call when idle. */
  function resetStrokeState() {
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
  }

  /**
   * Commit an in-progress paint stroke and reset stroke-transient refs.
   * Shared by pointer-up and pointer-cancel: it never reads event coordinates,
   * so the pixels already painted are preserved even when the cancel event
   * carries no usable position. No-op unless a stroke drag is active, which
   * keeps repeated calls safe.
   */
  function commitActiveStroke() {
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
    resetStrokeState()
    if (tool === "mixer-brush" && brush.mixer?.cleanAfterStroke) mixerReservoirRef.current = null
    commit(label, changedLayerIds)
  }

  /** Escape during a stroke: roll the buffer back and drop the gesture. */
  function abortStroke() {
    cancelBufferedStroke()
    drawingRef.current = { type: null }
    smudgeBufferRef.current.reset()
    transparencyLockMaskRef.current = null
    selectionClipRef.current = null
  }

  return {
    cloneSourceRef,
    selectionHitTesterRef,
    activeSmartFilterMaskCanvas,
    getActiveCtx,
    enforceTransparencyLock,
    captureHighBitPaintSource,
    syncActiveLayerHighBitFromCanvas,
    requestTileAwareStrokeRender,
    resolveCloneState,
    pointerBrushInput,
    drawSegment,
    beginStroke,
    commitActiveStroke,
    abortStroke,
    resetStrokeState,
    resetSmudgeBuffer: () => smudgeBufferRef.current.reset(),
  }
}

export type CanvasPaintSession = ReturnType<typeof useCanvasPaintSession>

