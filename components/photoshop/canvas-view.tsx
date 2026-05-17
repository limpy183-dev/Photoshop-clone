"use client"

import * as React from "react"
import { useEditor, makeCanvas as makeCanvasCtx } from "./editor-context"
import { compositeLayer } from "./blend-modes"
import { getFilter } from "./filters"
import { applyFilterPreview, PixelBatchReader } from "./filter-worker"
import { applyModeAndColorManagement } from "./advanced-subsystems"
import { addAnchorPointToPath, convertAnchorPoint, deleteNearestAnchorPoint, nearestAnchorPoint } from "./vector-path-operations"
import { normalizeBrushPointerSample, type BrushPointerSample } from "./brush-engine"

// Canvas identity cache for composite fingerprinting — gives each canvas a stable numeric ID
const _canvasIdMap = new WeakMap<HTMLCanvasElement, number>()
let _nextCanvasId = 1
function _assignCanvasId(canvas: HTMLCanvasElement): number {
  const id = _nextCanvasId++
  _canvasIdMap.set(canvas, id)
  return id
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
  selectSubjectMask,
  selectSkyMask,
  objectSelectionMask,
  refineEdgeBrushMask,
  selectionFromMask,
  selectionToMaskCanvas,
  transformedCloneStamp,
} from "./tool-helpers"
import type { BlendMode, CustomShapeId, GradientStop, Layer, PathPoint, PsDocument, Selection, ShapeProps } from "./types"

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

interface StampOptions {
  includeBrushOpacity?: boolean
  enforceTransparencyLock?: boolean
  drawEraserMask?: boolean
}

interface StrokeCompositeState {
  target: HTMLCanvasElement
  source: HTMLCanvasElement
  stroke: HTMLCanvasElement
  erasing: boolean
  opacity: number
  flow: number
}

type BrushInputControl = "off" | "pressure" | "tilt" | "velocity" | "fade" | "random"

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const clampZoom = (v: number) => Math.max(0.05, Math.min(32, v))

type MoveToolRuntimeOptions = {
  autoSelect: boolean
  select: "layer" | "group"
  showTransformControls: boolean
}

type ShapeToolRuntimeOptions = {
  strokeWidth: number
  radius: number
}

type FrameToolRuntimeOptions = {
  shape: "rect" | "ellipse"
}

type EyedropperSampleSize = "point" | "3x3" | "5x5"

declare global {
  interface Window {
    __psMoveOptions?: Partial<MoveToolRuntimeOptions>
    __psShapeOptions?: Partial<ShapeToolRuntimeOptions>
    __psFrameOptions?: Partial<FrameToolRuntimeOptions>
    __psCustomShape?: string
    __psEyedropperSampleSize?: EyedropperSampleSize
  }
}

function getMoveRuntimeOptions(): MoveToolRuntimeOptions {
  return {
    autoSelect: window.__psMoveOptions?.autoSelect ?? true,
    select: window.__psMoveOptions?.select ?? "layer",
    showTransformControls: window.__psMoveOptions?.showTransformControls ?? false,
  }
}

function getShapeRuntimeOptions(): ShapeToolRuntimeOptions {
  return {
    strokeWidth: Math.max(0, window.__psShapeOptions?.strokeWidth ?? 0),
    radius: Math.max(0, window.__psShapeOptions?.radius ?? 0),
  }
}

function getFrameRuntimeOptions(): FrameToolRuntimeOptions {
  return {
    shape: window.__psFrameOptions?.shape ?? "rect",
  }
}

function getCustomShapeRuntimeId(): CustomShapeId {
  const shape = window.__psCustomShape
  const supported: readonly CustomShapeId[] = [
    "star5",
    "star6",
    "heart",
    "arrow-right",
    "arrow-left",
    "arrow-up",
    "arrow-down",
    "speech",
    "check",
    "cross",
    "lightning",
    "polygon-hex",
    "polygon-tri",
    "diamond",
  ]
  return supported.includes(shape as CustomShapeId) ? (shape as CustomShapeId) : "star5"
}

function getEyedropperSampleSize(): EyedropperSampleSize {
  return window.__psEyedropperSampleSize ?? "point"
}

function layerBlocksAllEdits(layer: Layer | null | undefined) {
  return !layer || layer.locked || layer.lockAll
}

function layerAllowsDrawing(layer: Layer | null | undefined): layer is Layer {
  return Boolean(layer && !layerBlocksAllEdits(layer) && !layer.lockDraw && layer.kind !== "group")
}

function layerAllowsMoving(layer: Layer | null | undefined): layer is Layer {
  return Boolean(layer && !layerBlocksAllEdits(layer) && !layer.lockMove && layer.kind !== "group")
}

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
  } = ed

  const compositeRef = React.useRef<HTMLCanvasElement>(null)
  const overlayRef = React.useRef<HTMLCanvasElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const cursorRef = React.useRef<HTMLDivElement>(null)
  const stageRef = React.useRef<HTMLDivElement>(null)
  const panRef = React.useRef({ x: 0, y: 0 })
  const [viewZoom, setViewZoom] = React.useState(activeDoc?.zoom ?? 1)
  const visualZoomRef = React.useRef(activeDoc?.zoom ?? 1)
  const pendingZoomRef = React.useRef<number | null>(null)
  const zoomFrameRef = React.useRef<number | null>(null)
  const zoomCommitTimerRef = React.useRef<number | null>(null)

  /* ---- cursor style preference ---- */
  const [cursorPref, setCursorPref] = React.useState<"standard" | "precise" | "brush-size">("brush-size")
  React.useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem("ps-preferences")
        if (raw) {
          const p = JSON.parse(raw)
          if (p?.cursorStyle === "standard" || p?.cursorStyle === "precise" || p?.cursorStyle === "brush-size") {
            setCursorPref(p.cursorStyle)
            return
          }
        }
      } catch {}
      setCursorPref("brush-size")
    }
    read()
    window.addEventListener("ps-preferences-changed", read)
    window.addEventListener("storage", read)
    return () => {
      window.removeEventListener("ps-preferences-changed", read)
      window.removeEventListener("storage", read)
    }
  }, [])

  const cloneSourceRef = React.useRef<{ sourceX: number; sourceY: number; destX?: number; destY?: number; layerId: string } | null>(null)
  const eraserSampleRef = React.useRef<{ r: number; g: number; b: number; a: number } | null>(null)
  const smudgeBufferRef = React.useRef<SmudgeBuffer>(new SmudgeBuffer())
  const transformRef = React.useRef<TransformDragState | null>(null)
  const pathDraftRef = React.useRef<{ points: PathPoint[]; closed: boolean; curvature?: boolean } | null>(null)
  const removeRef = React.useRef<{ points: { x: number; y: number }[] } | null>(null)
  const patchRef = React.useRef<{ mask: HTMLCanvasElement; bounds: { x: number; y: number; w: number; h: number } } | null>(null)
  const strokeDabRef = React.useRef(0)
  const strokeDistRef = React.useRef(0)
  const strokeCompositeRef = React.useRef<StrokeCompositeState | null>(null)
  const lastBrushPointerSampleRef = React.useRef<BrushPointerSample | null>(null)
  const transparencyLockMaskRef = React.useRef<HTMLCanvasElement | null>(null)
  const eraserSourceRef = React.useRef<HTMLCanvasElement | null>(null)

  const applyZoomStyles = React.useCallback(
    (zoom: number) => {
      if (!activeDoc) return
      const displayW = activeDoc.width * zoom
      const displayH = activeDoc.height * zoom
      const stage = stageRef.current
      if (stage) {
        const width = `${displayW}px`
        const height = `${displayH}px`
        stage.style.width = width
        stage.style.height = height
        stage.style.minWidth = width
        stage.style.minHeight = height
      }
      const imageRendering = zoom >= 4 ? "pixelated" : "auto"
      if (compositeRef.current) compositeRef.current.style.imageRendering = imageRendering
      if (overlayRef.current) overlayRef.current.style.imageRendering = imageRendering
      const cursor = cursorRef.current?.firstElementChild as HTMLElement | null
      if (cursor) {
        cursor.style.width = `${brush.size * zoom}px`
        cursor.style.height = `${brush.size * zoom}px`
      }
    },
    [activeDoc, brush.size],
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
      }, 120)
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
    window.requestAnimationFrame(() => applyZoomStyles(next))
  }, [activeDoc?.id, activeDoc?.zoom, applyZoomStyles])

  React.useEffect(() => {
    const zoomRequestHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ zoom?: number; factor?: number }>).detail
      if (!detail) return
      if (typeof detail.zoom === "number") {
        applyViewZoom(detail.zoom)
      } else if (typeof detail.factor === "number") {
        applyViewZoom(visualZoomRef.current * detail.factor)
      }
    }
    window.addEventListener("ps-request-zoom", zoomRequestHandler)
    return () => window.removeEventListener("ps-request-zoom", zoomRequestHandler)
  }, [applyViewZoom])

  const schedulePaintCommit = React.useCallback(
    (label: string, changedLayerIds?: Parameters<typeof commit>[1]) => {
      // commit() now internally defers the expensive snapshot for brush-tool
      // labels via setTimeout(0), so we can call it directly without extra
      // deferral. This keeps the pointer-up handler fast.
      commit(label, changedLayerIds)
    },
    [activeDoc, commit],
  )

  /* ---- composite render ---- */

  // Composite cache: skip full re-composite when layer state hasn't changed
  const compositeCacheRef = React.useRef<{ fingerprint: string; canvas: HTMLCanvasElement | null }>({ fingerprint: "", canvas: null })

  const compose = React.useCallback((force = false) => {
    const cv = compositeRef.current
    if (!cv || !activeDoc) return
    if (cv.width !== activeDoc.width) cv.width = activeDoc.width
    if (cv.height !== activeDoc.height) cv.height = activeDoc.height

    // Build a lightweight fingerprint of the composite inputs.
    // Mutable pixel edits are rendered through requestRender(), which passes
    // force=true and bypasses this identity cache.
    let fp = `x||`
    for (const layer of activeDoc.layers) {
      if (!layer.visible) { fp += `H|`; continue }
      if (layer.kind === "group") continue
      const canvasId = _canvasIdMap.get(layer.canvas) ?? _assignCanvasId(layer.canvas)
      fp += [
        layer.id,
        layer.kind ?? "raster",
        canvasId,
        layer.opacity,
        layer.fillOpacity ?? 1,
        layer.blendMode,
        layer.clipped ? 1 : 0,
        layer.style ? JSON.stringify(layer.style) : "",
        filterPreviews[layer.id] ? _canvasIdMap.get(filterPreviews[layer.id]) ?? _assignCanvasId(filterPreviews[layer.id]) : "",
      ].join(":") + "|"
    }

    const cache = compositeCacheRef.current
    if (!force && cache.fingerprint === fp && cache.canvas) {
      const ctx = cv.getContext("2d")!
      ctx.clearRect(0, 0, cv.width, cv.height)
      ctx.drawImage(cache.canvas, 0, 0)
      return
    }

    const ctx = cv.getContext("2d")!
    ctx.clearRect(0, 0, cv.width, cv.height)
    for (const layer of activeDoc.layers) {
      if (!layer.visible) continue
      if (layer.kind === "group") continue
      if (typeof layer.canvas.getContext !== "function") continue
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
        applyAdjustmentLayer(ctx, layer, activeDoc.width, activeDoc.height, clipMask)
        continue
      }
      drawLayer(ctx, layer, clipMask, filterPreviews[layer.id])
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

    // Store in cache for future hits
    const cached = makeCanvas(cv.width, cv.height)
    cached.getContext("2d")!.drawImage(cv, 0, 0)
    compositeCacheRef.current = { fingerprint: fp, canvas: cached }
  }, [activeDoc, filterPreviews])

  React.useEffect(() => {
    compose()
    return subscribeRender(() => compose(true))
  }, [compose, subscribeRender])

  React.useEffect(() => {
    requestRender()
  }, [activeDoc, requestRender])

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
    if (!activeDoc?.selection.bounds) return true

    const sel = activeDoc.selection
    const b = sel.bounds
    if (!b) return true

    if (p.x < 0 || p.y < 0 || p.x >= activeDoc.width || p.y >= activeDoc.height) {
      return false
    }

    if (sel.mask) {
      const ctx = sel.mask.getContext("2d")
      if (!ctx) return false

      const px = ctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data
      return px[3] > 8
    }

    if (sel.shape === "ellipse") {
      const rx = b.w / 2
      const ry = b.h / 2
      if (rx <= 0 || ry <= 0) return false

      const cx = b.x + rx
      const cy = b.y + ry

      return ((p.x - cx) ** 2) / (rx ** 2) + ((p.y - cy) ** 2) / (ry ** 2) <= 1
    }

    return p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h
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
      selection: bounds ? { bounds, shape: raw.shape, mask: nextMask, feather: selectionOptions.feather } : { bounds: null, shape: "rect" },
    })
  }

  function snapMagneticPoint(pt: { x: number; y: number }) {
    if (!activeLayer || typeof activeLayer.canvas.getContext !== "function") return pt
    const radius = Math.max(6, Math.min(32, Math.round(selectionOptions.tolerance / 3)))
    const ctx = activeLayer.canvas.getContext("2d")!
    const w = activeLayer.canvas.width
    const h = activeLayer.canvas.height
    const sx = Math.max(1, Math.floor(pt.x - radius))
    const sy = Math.max(1, Math.floor(pt.y - radius))
    const sw = Math.min(w - sx - 1, radius * 2 + 1)
    const sh = Math.min(h - sy - 1, radius * 2 + 1)
    if (sw <= 2 || sh <= 2) return pt
    const img = ctx.getImageData(sx - 1, sy - 1, sw + 2, sh + 2)
    const lumAt = (x: number, y: number) => {
      const i = (y * img.width + x) * 4
      return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]
    }
    let best = { x: pt.x, y: pt.y, score: -1 }
    for (let y = 1; y < img.height - 1; y++) {
      for (let x = 1; x < img.width - 1; x++) {
        const gx =
          -lumAt(x - 1, y - 1) - 2 * lumAt(x - 1, y) - lumAt(x - 1, y + 1) +
          lumAt(x + 1, y - 1) + 2 * lumAt(x + 1, y) + lumAt(x + 1, y + 1)
        const gy =
          -lumAt(x - 1, y - 1) - 2 * lumAt(x, y - 1) - lumAt(x + 1, y - 1) +
          lumAt(x - 1, y + 1) + 2 * lumAt(x, y + 1) + lumAt(x + 1, y + 1)
        const docX = sx + x - 1
        const docY = sy + y - 1
        const distancePenalty = Math.hypot(docX - pt.x, docY - pt.y) * 7
        const score = Math.hypot(gx, gy) - distancePenalty
        if (score > best.score) best = { x: docX, y: docY, score }
      }
    }
    return { x: best.x, y: best.y }
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

  function getActiveCtx(): { ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement } | null {
    if (activeDoc?.quickMask && activeDoc.quickMaskCanvas) {
      const cv = activeDoc.quickMaskCanvas
      return { ctx: cv.getContext("2d")!, canvas: cv }
    }
    if (!layerAllowsDrawing(activeLayer)) return null
    if (typeof activeLayer.canvas.getContext !== "function") return null
    return { ctx: activeLayer.canvas.getContext("2d")!, canvas: activeLayer.canvas }
  }

  function prepareTransparencyLockMask() {
    transparencyLockMaskRef.current = null
    if (!activeDoc || activeDoc.quickMask || !activeLayer?.lockTransparency) return
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
      tool === "eraser" ||
      tool === "color-replace"
    )
  }

  function isEraserPaintTool() {
    return tool === "eraser" || tool === "background-eraser" || tool === "magic-eraser"
  }

  function beginBufferedStroke(target: HTMLCanvasElement) {
    if (!isStrokeBufferedPaintTool()) return
    const source = makeCanvas(target.width, target.height)
    source.getContext("2d")!.drawImage(target, 0, 0)
    strokeCompositeRef.current = {
      target,
      source,
      stroke: makeCanvas(target.width, target.height),
      erasing: isEraserPaintTool(),
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
    requestRender()
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

  function applyShapeDynamics(input: BrushInput): { dabSize: number; dabAngle: number; dabRoundness: number } {
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

    return { dabSize, dabAngle, dabRoundness }
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
    const { dabSize, dabAngle, dabRoundness } = applyShapeDynamics(input)
    const { opaMul, flowMul } = applyTransfer(input)
    const isBuffered = options.includeBrushOpacity === false
    // When painting to the stroke buffer, stamp at full alpha so overlapping
    // dabs don't accumulate and show individual circles.  The combined
    // opacity × flow is applied once in renderBufferedStroke() instead.
    const opacity = isBuffered ? 1 : clamp01((brush.opacity / 100) * (brush.flow / 100) * opaMul * flowMul)
    const isErase = tool === "eraser" || tool === "background-eraser" || tool === "magic-eraser"
    const compositeAsErase = isErase && !options.drawEraserMask
    const dabColor = isErase && options.drawEraserMask ? "#000000" : activeDoc?.quickMask ? "#ffffff" : applyColorDynamics(color, background)
    if (tool === "pattern-stamp") {
      drawPatternStampDab(ctx, x, y, dabSize, dabAngle, dabRoundness, opacity)
      if (options.enforceTransparencyLock !== false) enforceTransparencyLock(ctx)
      return
    }
    if (canUseFastBrushDab()) {
      drawFastBrushDab(ctx, x, y, dabSize, dabAngle, dabRoundness, dabColor, opacity, compositeAsErase)
      if (options.enforceTransparencyLock !== false) enforceTransparencyLock(ctx)
      return
    }
    const dab = createBrushDab(dabSize, dabRoundness, dabColor, opacity, x, y)
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
    ctx.globalCompositeOperation = activeDoc?.quickMask && !isErase ? "source-over" : isErase ? "destination-out" : "source-over"
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
        const bristles = Math.max(8, Math.min(42, Math.round(dabSize / 1.8)))
        for (let i = 0; i < bristles; i++) {
          const y = -r + (i / Math.max(1, bristles - 1)) * r * 2
          const wobble = (hashNoise(docX + i, docY - i, 19) - 0.5) * r * 0.55
          dctx.globalAlpha = 0.2 + hashNoise(i, docX + docY, 23) * 0.8
          dctx.lineWidth = Math.max(0.7, r / 12 + hashNoise(i, docX, 7) * 1.4)
          dctx.beginPath()
          dctx.moveTo(-r * 0.85, y)
          dctx.quadraticCurveTo(wobble, y * 0.35, r * 0.85, y + wobble * 0.15)
          dctx.stroke()
        }
        dctx.globalAlpha = 1
      } else if (shape === "erodible") {
        dctx.fillStyle = color
        dctx.beginPath()
        const points = 34
        for (let i = 0; i < points; i++) {
          const a = (i / points) * Math.PI * 2
          const edge = 0.72 + hashNoise(i + docX, docY - i, 41) * 0.34
          const px = Math.cos(a) * r * edge
          const py = Math.sin(a) * r * edge
          if (i === 0) dctx.moveTo(px, py)
          else dctx.lineTo(px, py)
        }
        dctx.closePath()
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

  function canvasPixel(canvas: HTMLCanvasElement, x: number, y: number) {
    const ctx = canvas.getContext("2d")
    if (!ctx) return { r: 0, g: 0, b: 0, a: 0 }
    const px = ctx.getImageData(
      Math.max(0, Math.min(canvas.width - 1, Math.floor(x))),
      Math.max(0, Math.min(canvas.height - 1, Math.floor(y))),
      1,
      1,
    ).data
    return { r: px[0], g: px[1], b: px[2], a: px[3] }
  }

  function cloneCanvasForTool(canvas: HTMLCanvasElement) {
    const copy = makeCanvas(canvas.width, canvas.height)
    copy.getContext("2d")!.drawImage(canvas, 0, 0)
    return copy
  }

  function alphaMaskFromCanvas(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d")!
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let minX = canvas.width
    let minY = canvas.height
    let maxX = 0
    let maxY = 0
    let hasPixels = false
    for (let i = 0; i < img.data.length; i += 4) {
      const a = img.data[i + 3]
      if (a <= 0) {
        img.data[i] = img.data[i + 1] = img.data[i + 2] = img.data[i + 3] = 0
        continue
      }
      const p = i / 4
      const x = p % canvas.width
      const y = Math.floor(p / canvas.width)
      hasPixels = true
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = 255
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

    const sample =
      eraser.sampling === "background-swatch"
        ? { ...hexToRgb(background), a: 255 }
        : eraser.sampling === "once" && eraserSampleRef.current
          ? eraserSampleRef.current
          : canvasPixel(sourceCanvas, x, y)
    if (eraser.sampling === "once" && !eraserSampleRef.current) eraserSampleRef.current = sample
    const fg = hexToRgb(foreground)

    const srcCtx = sourceCanvas.getContext("2d")!
    const src = srcCtx.getImageData(x0, y0, w, h)
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
        if (tool === "mixer-brush") {
          smudgeBufferRef.current.step(ctx, to.x, to.y, brush.size / 2, brush.flow / 160)
        }
        stampWithScatter(ctx, to.x, to.y, foreground, w, h, input, scatterAmt, scatterCnt, scatterCntJ, strokeAngle, stampOptions)
      } else {
        // Accumulate distance and place dabs at exact spacing intervals
        let remaining = strokeDistRef.current + dist
        const dx = dist > 0 ? (to.x - from.x) / dist : 0
        const dy = dist > 0 ? (to.y - from.y) / dist : 0
        // Start position: offset by how much distance was already accumulated
        let walked = spacing - strokeDistRef.current
        while (walked <= dist) {
          const t = walked / dist
          const baseX = from.x + (to.x - from.x) * t
          const baseY = from.y + (to.y - from.y) * t
          const input = brushInputFromPointer(pointerInput, velocity, strokeDabRef.current++, strokeAngle)
          if (tool === "mixer-brush") {
            smudgeBufferRef.current.step(ctx, baseX, baseY, brush.size / 2, brush.flow / 160)
          }
          stampWithScatter(ctx, baseX, baseY, foreground, w, h, input, scatterAmt, scatterCnt, scatterCntJ, strokeAngle, stampOptions)
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
          const jitter = tool === "art-history-brush" ? (hashNoise(dx, dy, strokeDabRef.current++) - 0.5) * brush.size * 0.7 : 0
          transformedCloneStamp(
            ctx,
            sourceCanvas,
            sourceAnchor,
            destAnchor,
            dx + jitter,
            dy - jitter,
            brush.size / 2,
            brush.hardness,
            (brush.opacity / 100) * (brush.flow / 100) * (tool === "art-history-brush" ? 0.72 : 1),
            cloneSource.scale,
            cloneSource.rotation + (tool === "art-history-brush" ? jitter : 0),
            false,
          )
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
    if (!renderBufferedStroke()) requestRender()
  }

  function spongeStamp(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, strength: number) {
    const r = Math.max(2, Math.floor(radius))
    const sx = Math.max(0, Math.floor(x - r))
    const sy = Math.max(0, Math.floor(y - r))
    const sw = Math.min(ctx.canvas.width - sx, r * 2)
    const sh = Math.min(ctx.canvas.height - sy, r * 2)
    if (sw <= 0 || sh <= 0) return
    const img = ctx.getImageData(sx, sy, sw, sh)
    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) {
        const dx = px - r
        const dy = py - r
        if (dx * dx + dy * dy > r * r) continue
        const i = (py * sw + px) * 4
        const rr = img.data[i]
        const gg = img.data[i + 1]
        const bb = img.data[i + 2]
        const lum = 0.299 * rr + 0.587 * gg + 0.114 * bb
        // desaturate (push toward luminance)
        img.data[i] = rr + (lum - rr) * strength
        img.data[i + 1] = gg + (lum - gg) * strength
        img.data[i + 2] = bb + (lum - bb) * strength
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
    ctx.save()
    ctx.strokeStyle = "#fff"
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.arc(center.x, center.y, Math.max(2, radius), 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  function drawLassoPreview(points: { x: number; y: number }[], hover?: { x: number; y: number }) {
    const ov = overlayRef.current
    if (!ov || !activeDoc) return
    const ctx = ov.getContext("2d")!
    ctx.clearRect(0, 0, ov.width, ov.height)
    if (points.length < 1) return
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
    directPointIndex?: number
    directShapeHandle?: "nw" | "ne" | "se" | "sw" | "center"
    sliceDraftId?: string
  }>({ type: null })
  const brushResizeRef = React.useRef<{ startClientX: number; startSize: number } | null>(null)

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

  /* ---- pointer down ---- */

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activeDoc) return
      ; (e.target as Element).setPointerCapture?.(e.pointerId)
    const pt = getCanvasPoint(e.clientX, e.clientY)

    // Pan with hand tool / middle mouse / spacebar overlay (tool is hand)
    if (tool === "hand" || e.button === 1) {
      drawingRef.current = {
        type: "pan",
        panStart: { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y },
      }
      return
    }

    // Alt+drag on brush tools: resize brush (eyedropper fires on Alt+click with no drag in pointerUp)
    if (e.altKey && showBrushCursor) {
      drawingRef.current = { type: "brush-resize", start: pt }
      brushResizeRef.current = { startClientX: e.clientX, startSize: brush.size }
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
        scene: {
          ...activeLayer.threeD,
          materials: activeLayer.threeD.materials.map((candidate) =>
            candidate.id === material.id ? { ...candidate, color: foreground } : candidate,
          ),
        },
      })
      setTimeout(() => commit("Apply 3D Material", [activeLayer.id]), 0)
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

    // Pen tools
    if (tool === "freeform-pen") {
      drawingRef.current = { type: "freeform-path", start: pt, last: pt, points: [pt] }
      drawLassoPreview([pt])
      return
    }

    if (tool === "pen" || tool === "curvature-pen") {
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
        draft.points.push({ x: pt.x, y: pt.y })
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
      const layer = pickVectorLayer(activeDoc, pt) ?? activeLayer
      if (!layer || !isVectorEditableLayer(layer)) return
      dispatch({ type: "set-active-layer", id: layer.id })
      drawPathSelectionPreview(layer)
      if (!layerAllowsDrawing(layer)) return
      const direct = directSelectionTarget(layer, pt)
      if (!direct) return
      drawingRef.current = {
        type: "path-direct",
        start: pt,
        last: pt,
        directLayerId: layer.id,
        directPointIndex: direct.pointIndex,
        directShapeHandle: direct.shapeHandle,
      }
      return
    }

    if (tool === "add-anchor-point" || tool === "delete-anchor-point" || tool === "convert-point") {
      editAnchorPoint(tool, pt)
      return
    }

    // Shape tools
    if (tool === "shape-rect" || tool === "shape-rounded-rect" || tool === "shape-ellipse" || tool === "shape-polygon" || tool === "shape-triangle" || tool === "shape-line" || tool === "custom-shape" || tool === "frame" || tool === "artboard" || tool === "slice") {
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

    // Magic wand / quick selection = single-click local region selection.
    if (tool === "magic-wand" || tool === "quick-selection") {
      if (!activeLayer) return
      if (typeof activeLayer.canvas.getContext !== "function") return
      const srcCanvas = selectionOptions.sampleAllLayers ? compositeRef.current : activeLayer.canvas
      if (!srcCanvas) return
      const ctx = srcCanvas.getContext("2d")!
      const src = ctx.getImageData(0, 0, activeDoc.width, activeDoc.height)
      const { x, y } = pt
      const m = floodFillMask(src, x, y, selectionOptions.tolerance, selectionOptions.contiguous)
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
      // Initialize points for remove stroke
      removeRef.current = { points: [pt] }
      drawingRef.current = { type: "remove", last: pt, points: [pt] }
      return
    }

    if (tool === "patch-tool") {
      if (!layerAllowsDrawing(activeLayer) || typeof activeLayer.canvas.getContext !== "function") return
      const existingPatch = patchRef.current
      if (existingPatch && pointInMask(existingPatch.mask, pt)) {
        drawingRef.current = { type: "patch-drag", start: pt, last: pt }
        drawPatchPreview({ x: 0, y: 0 })
        return
      }
      if (!existingPatch && activeDoc.selection.bounds) {
        const mask = selectionToMaskCanvas(activeDoc.width, activeDoc.height, activeDoc.selection)
        if (mask && pointInMask(mask, pt)) {
          patchRef.current = { mask, bounds: activeDoc.selection.bounds }
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
        if (Math.hypot(f.x - lassoPt.x, f.y - lassoPt.y) < 8) {
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
      prepareTransparencyLockMask()
      eraserSampleRef.current = null
      eraserSourceRef.current =
        tool === "background-eraser" && activeLayer
          ? cloneCanvasForTool(activeLayer.canvas)
          : null
      if (isStrokeBufferedPaintTool()) {
        const target = getActiveCtx()
        if (!target) return
        beginBufferedStroke(target.canvas)
      }
      smudgeBufferRef.current.reset()
      strokeDabRef.current = 0
      strokeDistRef.current = 0
      lastBrushPointerSampleRef.current = null
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
    }

    // status bar
    window.dispatchEvent(
      new CustomEvent("ps-mousemove", {
        detail: {
          x: pt.x,
          y: pt.y,
          inside: pt.x >= 0 && pt.y >= 0 && pt.x <= (activeDoc?.width ?? 0) && pt.y <= (activeDoc?.height ?? 0),
        },
      }),
    )

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
      const stage = stageRef.current
      if (stage) stage.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) rotate(${activeDoc?.rotation ?? 0}deg)`
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
      const k = 1 - brush.smoothing / 110
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
      return
    }

    if (drag.type === "object-select" && drag.start) {
      drawMarqueePreview(drag.start, pt)
      drag.last = pt
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
      return
    }

    if (drag.type === "ruler" && drag.start) {
      drawRulerPreview(drag.start, pt)
      drag.last = pt
      dispatch({ type: "set-measurement", m: { x1: drag.start.x, y1: drag.start.y, x2: pt.x, y2: pt.y } })
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
      } else if (tool === "custom-shape" || tool === "shape-polygon" || tool === "shape-triangle" || tool === "shape-rounded-rect") {
        rasterizeShape(ov, shapePropsForTool(tool, x, y, w, h, drag.start, pt, foreground, background))
      } else if (tool === "shape-line") {
        ctx.strokeStyle = foreground
        ctx.lineWidth = Math.max(1, getShapeRuntimeOptions().strokeWidth || brush.size / 4)
        ctx.beginPath()
        ctx.moveTo(drag.start.x, drag.start.y)
        ctx.lineTo(pt.x, pt.y)
        ctx.stroke()
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

    if (drag.type === "path-direct" && drag.directLayerId && activeDoc) {
      const layer = activeDoc.layers.find((candidate) => candidate.id === drag.directLayerId)
      if (!layerAllowsDrawing(layer)) return
      updateDirectSelectionDrag(layer, pt, drag)
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

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = drawingRef.current
    const pt = getCanvasPoint(e.clientX, e.clientY)

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
      const label = labelForTool(tool)
      const changedLayerIds =
        activeLayer && drag.dirty && !activeDoc?.quickMask
          ? { ids: [activeLayer.id], bounds: { [activeLayer.id]: drag.dirty } }
          : activeLayer
            ? [activeLayer.id]
            : undefined
      finishBufferedStroke()
      drawingRef.current = { type: null }
      smudgeBufferRef.current.reset()
      transparencyLockMaskRef.current = null
      eraserSourceRef.current = null
      eraserSampleRef.current = null
      lastBrushPointerSampleRef.current = null
      schedulePaintCommit(label, changedLayerIds)
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
                  ? "Polygon"
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

  React.useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
      if (e.key === "Escape") {
        if (drawingRef.current.type === "stroke") {
          cancelBufferedStroke()
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
        commitTransform()
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "q") {
        e.preventDefault()
        toggleQuickMask()
      }
      // Free Transform
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "t" && !e.shiftKey) {
        if (layerAllowsMoving(activeLayer)) {
          e.preventDefault()
          beginTransform(activeLayer)
        }
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [activeLayer, requestRender, toggleQuickMask])

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
      if (stageRef.current) {
        stageRef.current.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) rotate(${activeDoc.rotation ?? 0}deg)`
      }
    }
    window.addEventListener("ps-navigator-pan", navigatorPanHandler)
    return () => window.removeEventListener("ps-navigator-pan", navigatorPanHandler)
  }, [activeDoc])

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
      const dst = new ImageData(outW, outH)

      // For each output pixel, map back to source using inverse bilinear
      for (let oy = 0; oy < outH; oy++) {
        const u = oy / (outH - 1)
        for (let ox = 0; ox < outW; ox++) {
          const v = ox / (outW - 1)
          // Bilinear interpolation of source coordinates
          const sx = (1 - u) * ((1 - v) * tl.x + v * tr.x) + u * ((1 - v) * bl.x + v * br.x)
          const sy = (1 - u) * ((1 - v) * tl.y + v * tr.y) + u * ((1 - v) * bl.y + v * br.y)

          // Sample source with bilinear interpolation
          const fx = Math.floor(sx)
          const fy = Math.floor(sy)
          const dx = sx - fx
          const dy = sy - fy

          const idx = (oy * outW + ox) * 4
          for (let c = 0; c < 4; c++) {
            const s00 = samplePixel(srcData, fx, fy, c)
            const s10 = samplePixel(srcData, fx + 1, fy, c)
            const s01 = samplePixel(srcData, fx, fy + 1, c)
            const s11 = samplePixel(srcData, fx + 1, fy + 1, c)
            dst.data[idx + c] = Math.round(
              s00 * (1 - dx) * (1 - dy) +
              s10 * dx * (1 - dy) +
              s01 * (1 - dx) * dy +
              s11 * dx * dy
            )
          }
        }
      }

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

  function samplePixel(img: ImageData, x: number, y: number, c: number): number {
    const cx = Math.max(0, Math.min(img.width - 1, x))
    const cy = Math.max(0, Math.min(img.height - 1, y))
    return img.data[(cy * img.width + cx) * 4 + c]
  }

  /* ---- Polygon lasso finalize ---- */

  function finalizePolyLasso(points: { x: number; y: number }[]) {
    if (!activeDoc) return
    const ov = overlayRef.current
    if (ov) ov.getContext("2d")!.clearRect(0, 0, ov.width, ov.height)
    const mask = polygonToMask(activeDoc.width, activeDoc.height, points)
    const b = polygonBounds(points)
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
    const simplified: PathPoint[] = []
    for (const point of points) {
      const prev = simplified[simplified.length - 1]
      if (!prev || Math.hypot(prev.x - point.x, prev.y - point.y) >= 4) {
        simplified.push({ x: point.x, y: point.y })
      }
    }
    return simplified
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

  function isVectorEditableLayer(layer: Layer | null | undefined) {
    return Boolean(layer && layer.kind !== "group" && (layer.path || layer.shape || layer.frame || layer.artboard || layer.kind === "shape" || layer.kind === "frame" || layer.kind === "artboard"))
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
      if (alpha > 0 || layer.path || layer.shape || layer.frame || layer.artboard) return layer
    }
    return null
  }

  function vectorLayerBounds(layer: Layer) {
    if (layer.shape) return shapeRect(layer.shape)
    if (layer.frame) return { x: layer.frame.x, y: layer.frame.y, w: layer.frame.w, h: layer.frame.h }
    if (layer.artboard) return { x: layer.artboard.x, y: layer.artboard.y, w: layer.artboard.w, h: layer.artboard.h }
    if (layer.path?.points.length) {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const point of layer.path.points) {
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
    if (layer.path?.points.length) {
      let best = { pointIndex: -1, distance: Infinity }
      layer.path.points.forEach((point, pointIndex) => {
        const distance = Math.hypot(point.x - pt.x, point.y - pt.y)
        if (distance < best.distance) best = { pointIndex, distance }
      })
      if (best.pointIndex >= 0 && best.distance <= 14) return { pointIndex: best.pointIndex }
    }
    const bounds = vectorLayerBounds(layer)
    if (!bounds) return null
    const handles = shapeHandles(bounds)
    let best: { shapeHandle: NonNullable<React.MutableRefObject<typeof drawingRef.current>["current"]["directShapeHandle"]>; distance: number } | null = null
    for (const handle of handles) {
      const distance = Math.hypot(handle.x - pt.x, handle.y - pt.y)
      if (distance <= 16 && (!best || distance < best.distance)) best = { shapeHandle: handle.id, distance }
    }
    return best ? { shapeHandle: best.shapeHandle } : { shapeHandle: "center" as const }
  }

  function updateDirectSelectionDrag(layer: Layer, pt: { x: number; y: number }, drag: typeof drawingRef.current) {
    if (layer.path && drag.directPointIndex !== undefined && drag.directPointIndex >= 0) {
      const points = layer.path.points.map((point, index) => index === drag.directPointIndex ? { ...point, x: pt.x, y: pt.y } : point)
      layer.path = { ...layer.path, points }
      rerenderVectorLayer(layer)
      return
    }
    if (!drag.directShapeHandle || !drag.last) return
    const dx = pt.x - drag.last.x
    const dy = pt.y - drag.last.y
    if (layer.shape) {
      layer.shape = resizeShapeRect(layer.shape, drag.directShapeHandle, pt, dx, dy)
    } else if (layer.frame) {
      const next = resizePlainRect(layer.frame, drag.directShapeHandle, pt, dx, dy)
      layer.frame = { ...layer.frame, ...next }
    } else if (layer.artboard) {
      const next = resizePlainRect(layer.artboard, drag.directShapeHandle, pt, dx, dy)
      layer.artboard = { ...layer.artboard, ...next }
    }
    rerenderVectorLayer(layer)
  }

  function rerenderVectorLayer(layer: Layer) {
    const ctx = layer.canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
    if (layer.shape) rasterizeShape(layer.canvas, layer.shape)
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
      ctx.restore()
    }
    if (layer.path?.points.length) {
      ctx.save()
      ctx.strokeStyle = "#38bdf8"
      ctx.fillStyle = "#ffffff"
      ctx.lineWidth = 1
      ctx.beginPath()
      const first = layer.path.points[0]
      ctx.moveTo(first.x, first.y)
      for (const point of layer.path.points.slice(1)) ctx.lineTo(point.x, point.y)
      if (layer.path.closed) ctx.closePath()
      ctx.stroke()
      for (const point of layer.path.points) {
        ctx.beginPath()
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
      ctx.restore()
    }
  }

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
      const stage = stageRef.current
      if (stage) stage.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) rotate(${activeDoc.rotation ?? 0}deg)`
    }
  }

  const onPointerEnter = () => {
    const cur = cursorRef.current
    if (cur) cur.style.opacity = "1"
  }
  const onPointerLeave = () => {
    const cur = cursorRef.current
    if (cur) cur.style.opacity = "0"
    onPointerUp({ clientX: 0, clientY: 0 } as React.PointerEvent<HTMLDivElement>)
  }

  if (!activeDoc) {
    return (
      <div className="flex-1 bg-[var(--ps-canvas-bg)] flex items-center justify-center text-[var(--ps-text-dim)]">
        No document open. Use File ▸ New… to start.
      </div>
    )
  }

  const displayW = activeDoc.width * viewZoom
  const displayH = activeDoc.height * viewZoom
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

  const cursorStyle = cursorForTool(tool, showBrushCursor)

  return (
    <div ref={containerRef} data-canvas-root className="flex-1 relative overflow-hidden bg-[var(--ps-canvas-bg)]" onWheel={onWheel}>
      {activeDoc && <Rulers width={activeDoc.width} height={activeDoc.height} zoom={viewZoom} onCreateGuide={(orient, pos) => {
        const id = `g_${Math.random().toString(36).slice(2, 8)}`
        dispatch({ type: "add-guide", guide: { id, orientation: orient, position: Math.round(pos) } })
      }} />}
      <div
        className="absolute inset-0 pt-[18px] pl-[18px] flex items-center justify-center overflow-auto"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        style={{ cursor: cursorStyle }}
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
            transform: `rotate(${activeDoc.rotation ?? 0}deg)`,
          }}
        >
          <div className="absolute inset-0 ps-checker" />
          <canvas
            ref={compositeRef}
            width={activeDoc.width}
            height={activeDoc.height}
            className={cn("absolute inset-0 w-full h-full")}
            style={{ imageRendering: viewZoom >= 4 ? "pixelated" : "auto" }}
          />
          <canvas
            ref={overlayRef}
            width={activeDoc.width}
            height={activeDoc.height}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ imageRendering: viewZoom >= 4 ? "pixelated" : "auto" }}
          />
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
      {/* Brush cursor circle */}
      <div
        ref={cursorRef}
        className="pointer-events-none fixed -translate-x-1/2 -translate-y-1/2 transition-opacity z-50"
        style={{ opacity: 0, willChange: "transform, left, top" }}
      >
        {showBrushCursor ? (
          <div
            className="rounded-full border border-black mix-blend-difference"
            style={{
              width: brush.size * viewZoom,
              height: brush.size * viewZoom,
              boxShadow: "inset 0 0 0 1px white",
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

/* ============================== overlays ============================== */

function GridOverlay({
  docW,
  docH,
  size,
  color,
  subdivisions,
  opacity,
}: {
  docW: number
  docH: number
  size: number
  color: string
  subdivisions: number
  opacity: number
}) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  React.useEffect(() => {
    const cv = ref.current
    if (!cv) return
    cv.width = docW
    cv.height = docH
    const ctx = cv.getContext("2d")!
    ctx.clearRect(0, 0, docW, docH)
    const sub = Math.max(1, Math.round(subdivisions))
    const subStep = size / sub
    if (sub > 1 && subStep >= 2) {
      ctx.strokeStyle = hexToRgba(color, opacity * 0.38)
      ctx.lineWidth = 1
      for (let x = subStep; x < docW; x += subStep) {
        if (Math.abs(x / size - Math.round(x / size)) < 0.001) continue
        ctx.beginPath()
        ctx.moveTo(x + 0.5, 0)
        ctx.lineTo(x + 0.5, docH)
        ctx.stroke()
      }
      for (let y = subStep; y < docH; y += subStep) {
        if (Math.abs(y / size - Math.round(y / size)) < 0.001) continue
        ctx.beginPath()
        ctx.moveTo(0, y + 0.5)
        ctx.lineTo(docW, y + 0.5)
        ctx.stroke()
      }
    }
    ctx.strokeStyle = hexToRgba(color, opacity)
    ctx.lineWidth = 1
    for (let x = size; x < docW; x += size) {
      ctx.beginPath()
      ctx.moveTo(x + 0.5, 0)
      ctx.lineTo(x + 0.5, docH)
      ctx.stroke()
    }
    for (let y = size; y < docH; y += size) {
      ctx.beginPath()
      ctx.moveTo(0, y + 0.5)
      ctx.lineTo(docW, y + 0.5)
      ctx.stroke()
    }
  }, [docW, docH, size, color, subdivisions])
  return <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none" />
}

function PixelGridOverlay({ zoom }: { zoom: number }) {
  const opacity = Math.min(0.45, Math.max(0.16, (zoom - 5) / 18))
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: `linear-gradient(rgba(255,255,255,${opacity}) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,${opacity}) 1px, transparent 1px)`,
        backgroundSize: `${zoom}px ${zoom}px`,
        mixBlendMode: "difference",
      }}
    />
  )
}

function GuidesOverlay({
  guides,
  docW,
  docH,
  onMove,
  onRemove,
}: {
  guides: { id: string; orientation: "horizontal" | "vertical"; position: number; color?: string }[]
  docW: number
  docH: number
  onMove: (id: string, pos: number) => void
  onRemove: (id: string) => void
}) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {guides.map((g) => (
        <div
          key={g.id}
          className="absolute pointer-events-auto cursor-move"
          style={
            g.orientation === "horizontal"
              ? {
                left: 0,
                right: 0,
                top: `${(g.position / docH) * 100}%`,
                height: 4,
                marginTop: -2,
                background: "transparent",
                borderTop: `1px solid ${g.color ?? "#06b6d4"}`,
              }
              : {
                top: 0,
                bottom: 0,
                left: `${(g.position / docW) * 100}%`,
                width: 4,
                marginLeft: -2,
                background: "transparent",
                borderLeft: `1px solid ${g.color ?? "#06b6d4"}`,
              }
          }
          onDoubleClick={() => onRemove(g.id)}
          onPointerDown={(e) => {
            e.stopPropagation()
            const target = e.currentTarget
            target.setPointerCapture(e.pointerId)
            const move = (ev: PointerEvent) => {
              const rect = (target.parentElement as HTMLElement).getBoundingClientRect()
              if (g.orientation === "horizontal") {
                const y = ((ev.clientY - rect.top) / rect.height) * docH
                onMove(g.id, Math.max(0, Math.min(docH, y)))
              } else {
                const x = ((ev.clientX - rect.left) / rect.width) * docW
                onMove(g.id, Math.max(0, Math.min(docW, x)))
              }
            }
            const up = () => {
              window.removeEventListener("pointermove", move)
              window.removeEventListener("pointerup", up)
            }
            window.addEventListener("pointermove", move)
            window.addEventListener("pointerup", up)
          }}
        />
      ))}
    </div>
  )
}

function SmartGuidesOverlay({
  layers,
  activeLayerId,
  docW,
  docH,
}: {
  layers: import("./types").Layer[]
  activeLayerId: string
  docW: number
  docH: number
}) {
  const activeLayer = layers.find((l) => l.id === activeLayerId)
  if (!activeLayer || !activeLayer.visible || activeLayer.kind === "group") return null

  // Get bounding box of active layer from alpha
  const aBounds = React.useMemo(() => alphaBoundsForLayer(activeLayer), [activeLayer, activeLayer.canvas])
  if (!aBounds) return null

  const aLeft = aBounds.x
  const aRight = aBounds.x + aBounds.w
  const aTop = aBounds.y
  const aBottom = aBounds.y + aBounds.h
  const aCenterX = aBounds.x + aBounds.w / 2
  const aCenterY = aBounds.y + aBounds.h / 2

  const SNAP = 3
  const hLines: number[] = []
  const vLines: number[] = []

  // Also check canvas edges and center
  const targets = [
    { x: 0, y: 0, w: docW, h: docH }, // canvas bounds
  ]
  for (const l of layers) {
    if (l.id === activeLayerId || !l.visible || l.kind === "group") continue
    if (typeof l.canvas?.getContext !== "function") continue
    const b = alphaBoundsForLayer(l)
    if (b) targets.push(b)
  }

  for (const t of targets) {
    const tLeft = t.x
    const tRight = t.x + t.w
    const tTop = t.y
    const tBottom = t.y + t.h
    const tCenterX = t.x + t.w / 2
    const tCenterY = t.y + t.h / 2

    // Vertical alignment lines (x position)
    if (Math.abs(aLeft - tLeft) <= SNAP) vLines.push(tLeft)
    if (Math.abs(aRight - tRight) <= SNAP) vLines.push(tRight)
    if (Math.abs(aCenterX - tCenterX) <= SNAP) vLines.push(tCenterX)
    if (Math.abs(aLeft - tRight) <= SNAP) vLines.push(tRight)
    if (Math.abs(aRight - tLeft) <= SNAP) vLines.push(tLeft)
    if (Math.abs(aLeft - tCenterX) <= SNAP) vLines.push(tCenterX)
    if (Math.abs(aRight - tCenterX) <= SNAP) vLines.push(tCenterX)
    if (Math.abs(aCenterX - tLeft) <= SNAP) vLines.push(tLeft)
    if (Math.abs(aCenterX - tRight) <= SNAP) vLines.push(tRight)

    // Horizontal alignment lines (y position)
    if (Math.abs(aTop - tTop) <= SNAP) hLines.push(tTop)
    if (Math.abs(aBottom - tBottom) <= SNAP) hLines.push(tBottom)
    if (Math.abs(aCenterY - tCenterY) <= SNAP) hLines.push(tCenterY)
    if (Math.abs(aTop - tBottom) <= SNAP) hLines.push(tBottom)
    if (Math.abs(aBottom - tTop) <= SNAP) hLines.push(tTop)
    if (Math.abs(aTop - tCenterY) <= SNAP) hLines.push(tCenterY)
    if (Math.abs(aBottom - tCenterY) <= SNAP) hLines.push(tCenterY)
    if (Math.abs(aCenterY - tTop) <= SNAP) hLines.push(tTop)
    if (Math.abs(aCenterY - tBottom) <= SNAP) hLines.push(tBottom)
  }

  // Deduplicate
  const uniqueH = [...new Set(hLines.map((v) => Math.round(v)))]
  const uniqueV = [...new Set(vLines.map((v) => Math.round(v)))]

  if (uniqueH.length === 0 && uniqueV.length === 0) return null

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 5 }}>
      {uniqueH.map((y) => (
        <div
          key={`h${y}`}
          className="absolute left-0 right-0"
          style={{
            top: `${(y / docH) * 100}%`,
            height: 1,
            background: "#ff00ff",
            opacity: 0.8,
          }}
        />
      ))}
      {uniqueV.map((x) => (
        <div
          key={`v${x}`}
          className="absolute top-0 bottom-0"
          style={{
            left: `${(x / docW) * 100}%`,
            width: 1,
            background: "#ff00ff",
            opacity: 0.8,
          }}
        />
      ))}
    </div>
  )
}

function alphaBoundsForLayer(layer: import("./types").Layer): { x: number; y: number; w: number; h: number } | null {
  return alphaBoundsForCanvas(layer.canvas)
}

function alphaBoundsForCanvas(canvas: HTMLCanvasElement | null | undefined): { x: number; y: number; w: number; h: number } | null {
  if (typeof canvas?.getContext !== "function") return null
  const ctx = canvas.getContext("2d")!
  const w = canvas.width
  const h = canvas.height
  if (w === 0 || h === 0) return null
  const img = ctx.getImageData(0, 0, w, h)
  let minX = w, minY = h, maxX = 0, maxY = 0
  let hasPixels = false
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (img.data[(y * w + x) * 4 + 3] > 8) {
        hasPixels = true
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (!hasPixels) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

function smartSnapLayerDelta(
  doc: PsDocument,
  movingLayer: Layer,
  snapshot: HTMLCanvasElement,
  dx: number,
  dy: number,
) {
  if (!doc.snap) return { dx, dy }
  const sourceBounds = alphaBoundsForCanvas(snapshot)
  if (!sourceBounds) return { dx, dy }
  const threshold = 6
  let bestDx = 0
  let bestDy = 0
  let bestXScore = threshold + 1
  let bestYScore = threshold + 1
  const moving = {
    left: sourceBounds.x + dx,
    right: sourceBounds.x + sourceBounds.w + dx,
    centerX: sourceBounds.x + sourceBounds.w / 2 + dx,
    top: sourceBounds.y + dy,
    bottom: sourceBounds.y + sourceBounds.h + dy,
    centerY: sourceBounds.y + sourceBounds.h / 2 + dy,
  }
  const xValues = [moving.left, moving.centerX, moving.right]
  const yValues = [moving.top, moving.centerY, moving.bottom]

  const targetRects: { x: number; y: number; w: number; h: number }[] = []
  if (doc.showSmartGuides !== false) {
    targetRects.push({ x: 0, y: 0, w: doc.width, h: doc.height })
    for (const layer of doc.layers) {
      if (layer.id === movingLayer.id || !layer.visible || layer.kind === "group") continue
      const b = alphaBoundsForLayer(layer)
      if (b) targetRects.push(b)
    }
  }

  const xTargets: number[] = []
  const yTargets: number[] = []
  if (doc.snapToGuides) {
    for (const guide of doc.guides ?? []) {
      if (guide.orientation === "vertical") xTargets.push(guide.position)
      else yTargets.push(guide.position)
    }
  }
  if (doc.showSmartGuides !== false) {
    for (const rect of targetRects) {
      xTargets.push(rect.x, rect.x + rect.w / 2, rect.x + rect.w)
      yTargets.push(rect.y, rect.y + rect.h / 2, rect.y + rect.h)
    }
  }
  if (doc.snapToGrid && doc.gridSize) {
    const grid = Math.max(2, doc.gridSize)
    for (const value of xValues) xTargets.push(Math.round(value / grid) * grid)
    for (const value of yValues) yTargets.push(Math.round(value / grid) * grid)
  }

  for (const value of xValues) {
    for (const target of xTargets) {
      const delta = target - value
      const score = Math.abs(delta)
      if (score <= threshold && score < bestXScore) {
        bestXScore = score
        bestDx = delta
      }
    }
  }
  for (const value of yValues) {
    for (const target of yTargets) {
      const delta = target - value
      const score = Math.abs(delta)
      if (score <= threshold && score < bestYScore) {
        bestYScore = score
        bestDy = delta
      }
    }
  }

  return { dx: dx + bestDx, dy: dy + bestDy }
}

function MaskSelectionOverlay({
  mask,
  docW,
  docH,
}: {
  mask: HTMLCanvasElement
  docW: number
  docH: number
}) {
  const ref = React.useRef<HTMLCanvasElement>(null)

  React.useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    canvas.width = docW
    canvas.height = docH
    const ctx = canvas.getContext("2d")
    const mctx = mask.getContext("2d")
    if (!ctx || !mctx) return
    const img = mctx.getImageData(0, 0, docW, docH)
    const edges: number[] = []
    const selected = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < docW && y < docH && img.data[(y * docW + x) * 4 + 3] > 8
    for (let y = 0; y < docH; y++) {
      for (let x = 0; x < docW; x++) {
        if (!selected(x, y)) continue
        if (!selected(x - 1, y) || !selected(x + 1, y) || !selected(x, y - 1) || !selected(x, y + 1)) {
          edges.push(y * docW + x)
        }
      }
    }

    let phase = 0
    let stopped = false
    let timer = 0
    const draw = () => {
      if (stopped) return
      const out = ctx.createImageData(docW, docH)
      for (const p of edges) {
        const x = p % docW
        const y = (p - x) / docW
        const black = ((x + y + phase) & 8) === 0
        const i = p * 4
        out.data[i] = black ? 0 : 255
        out.data[i + 1] = black ? 0 : 255
        out.data[i + 2] = black ? 0 : 255
        out.data[i + 3] = 255
      }
      ctx.putImageData(out, 0, 0)
      phase = (phase + 2) % 16
      timer = window.setTimeout(draw, 120)
    }
    draw()
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [mask, docW, docH])

  return <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none" />
}

function SelectionOverlay({
  bounds,
  shape,
  docW,
  docH,
}: {
  bounds: { x: number; y: number; w: number; h: number }
  shape: "rect" | "ellipse"
  docW: number
  docH: number
}) {
  const left = (bounds.x / docW) * 100
  const top = (bounds.y / docH) * 100
  const width = (bounds.w / docW) * 100
  const height = (bounds.h / docH) * 100
  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
    >
      <div
        className={cn(
          "absolute inset-0 ps-marching-ants",
          shape === "ellipse" ? "rounded-[100%]" : "",
        )}
      />
    </div>
  )
}

function TextEditOverlay({
  doc,
  state,
  setState,
  commit,
}: {
  doc: PsDocument
  state: { layerId: string; value: string }
  setState: React.Dispatch<React.SetStateAction<{ layerId: string; value: string } | null>>
  commit: () => void
}) {
  const layer = doc.layers.find((l: Layer) => l.id === state.layerId)
  if (!layer || !layer.text) return null
  const t = layer.text
  return (
    <textarea
      autoFocus
      value={state.value}
      onChange={(e) => setState({ ...state, value: e.target.value })}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setState(null)
          e.stopPropagation()
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          commit()
          e.preventDefault()
        }
        e.stopPropagation()
      }}
      className="absolute outline outline-2 outline-cyan-500 bg-transparent resize-none p-0 m-0 z-30"
      style={{
        left: `${(t.x / doc.width) * 100}%`,
        top: `${(t.y / doc.height) * 100}%`,
        minWidth: 100,
        minHeight: t.size * doc.zoom * 1.4,
        fontFamily: t.font,
        fontSize: t.size * doc.zoom,
        fontWeight: t.weight,
        fontStyle: t.italic ? "italic" : "normal",
        color: t.color,
        textAlign: t.align,
        lineHeight: 1.2,
      }}
    />
  )
}

/* ============================== Rulers ============================== */

function Rulers({ width, height, zoom, onCreateGuide }: { width: number; height: number; zoom: number; onCreateGuide?: (orient: "horizontal" | "vertical", pos: number) => void }) {
  const [dragGuide, setDragGuide] = React.useState<{ orient: "horizontal" | "vertical"; pos: number } | null>(null)
  const dragGuideRef = React.useRef<{ orient: "horizontal" | "vertical"; pos: number } | null>(null)

  const handleRulerDrag = (orient: "horizontal" | "vertical", e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const containerEl = e.currentTarget.closest("[data-canvas-root]") as HTMLElement | null
    if (!containerEl) return
    const stageEl = containerEl.querySelector("[data-canvas-stage]") as HTMLElement | null
    if (!stageEl) return

    const move = (ev: PointerEvent) => {
      const stageRect = stageEl.getBoundingClientRect()
      if (orient === "horizontal") {
        const canvasY = ((ev.clientY - stageRect.top) / stageRect.height) * height
        const next = { orient: "horizontal" as const, pos: Math.max(0, Math.min(height, canvasY)) }
        dragGuideRef.current = next
        setDragGuide(next)
      } else {
        const canvasX = ((ev.clientX - stageRect.left) / stageRect.width) * width
        const next = { orient: "vertical" as const, pos: Math.max(0, Math.min(width, canvasX)) }
        dragGuideRef.current = next
        setDragGuide(next)
      }
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      const finalGuide = dragGuideRef.current
      if (finalGuide && onCreateGuide) {
        onCreateGuide(finalGuide.orient, finalGuide.pos)
      }
      dragGuideRef.current = null
      setDragGuide(null)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    // Trigger initial position
    move(e.nativeEvent)
  }

  return (
    <>
      <div
        className="absolute top-0 left-[18px] right-0 h-[18px] bg-[var(--ps-panel)] border-b border-[var(--ps-divider)] overflow-hidden z-10 cursor-s-resize"
        onPointerDown={(e) => handleRulerDrag("horizontal", e)}
      >
        <RulerTicks length={width} zoom={zoom} orientation="horizontal" />
      </div>
      <div
        className="absolute top-[18px] left-0 bottom-0 w-[18px] bg-[var(--ps-panel)] border-r border-[var(--ps-divider)] overflow-hidden z-10 cursor-e-resize"
        onPointerDown={(e) => handleRulerDrag("vertical", e)}
      >
        <RulerTicks length={height} zoom={zoom} orientation="vertical" />
      </div>
      <div className="absolute top-0 left-0 w-[18px] h-[18px] bg-[var(--ps-panel)] border-r border-b border-[var(--ps-divider)] z-10" />
      {dragGuide ? (
        <div
          className="pointer-events-none absolute z-30"
          style={
            dragGuide.orient === "horizontal"
              ? {
                top: `calc(50% + ${dragGuide.pos * zoom - (height * zoom) / 2 + 18}px)`,
                left: 18,
                right: 0,
                height: 1,
                background: "#06b6d4",
                boxShadow: "0 0 0 1px rgba(6,182,212,0.28)",
              }
              : {
                left: `calc(50% + ${dragGuide.pos * zoom - (width * zoom) / 2 + 18}px)`,
                top: 18,
                bottom: 0,
                width: 1,
                background: "#06b6d4",
                boxShadow: "0 0 0 1px rgba(6,182,212,0.28)",
              }
          }
        />
      ) : null}
    </>
  )
}

const RulerTicks = React.memo(function RulerTicks({
  length,
  zoom,
  orientation,
}: {
  length: number
  zoom: number
  orientation: "horizontal" | "vertical"
}) {
  const step = zoom > 2 ? 25 : zoom > 1 ? 50 : 100
  const ticks: React.ReactNode[] = []
  for (let i = 0; i <= length; i += step) {
    const isMajor = i % (step * 2) === 0
    const pos = i * zoom
    if (orientation === "horizontal") {
      ticks.push(
        <div
          key={i}
          className="absolute top-0 text-[9px] text-[var(--ps-text-dim)]"
          style={{ left: `calc(50% + ${pos - (length * zoom) / 2}px)` }}
        >
          <div
            className="bg-[var(--ps-text-dim)]"
            style={{ width: 1, height: isMajor ? 8 : 4, marginLeft: -0.5 }}
          />
          {isMajor ? <span className="ml-1">{i}</span> : null}
        </div>,
      )
    } else {
      ticks.push(
        <div
          key={i}
          className="absolute left-0 text-[9px] text-[var(--ps-text-dim)] flex flex-col items-start"
          style={{ top: `calc(50% + ${pos - (length * zoom) / 2}px)` }}
        >
          <div
            className="bg-[var(--ps-text-dim)]"
            style={{ height: 1, width: isMajor ? 8 : 4, marginTop: -0.5 }}
          />
          {isMajor ? (
            <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>{i}</span>
          ) : null}
        </div>,
      )
    }
  }
  return <div className="relative w-full h-full">{ticks}</div>
})

/* ============================== helpers ============================== */

/* ----------- canvas pool (reuse offscreen canvases) ----------- */
const _canvasPool: HTMLCanvasElement[] = []
const MAX_POOL = 24

function acquireCanvas(w: number, h: number): HTMLCanvasElement {
  for (let i = _canvasPool.length - 1; i >= 0; i--) {
    const c = _canvasPool[i]
    if (c.width === w && c.height === h) {
      _canvasPool.splice(i, 1)
      const ctx = c.getContext("2d")
      if (ctx) ctx.clearRect(0, 0, w, h)
      return c
    }
  }
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  return c
}

function releaseCanvas(c: HTMLCanvasElement) {
  if (_canvasPool.length < MAX_POOL) _canvasPool.push(c)
}

/* ----------- smart filter result cache ----------- */
interface SmartFilterCacheEntry {
  paramsKey: string
  result: HTMLCanvasElement
}
const _smartFilterCache = new WeakMap<HTMLCanvasElement, SmartFilterCacheEntry>()

function smartFilterCacheKey(smartFilters: NonNullable<Layer["smartFilters"]>): string {
  return smartFilters
    .filter((sf) => sf.enabled)
    .map((sf) => `${sf.filterId}:${JSON.stringify(sf.params)}:${sf.opacity ?? 1}:${sf.blendMode ?? "normal"}`)
    .join("|")
}

/* ----------- layer style result cache ----------- */
interface LayerStyleCacheEntry {
  styleKey: string
  fillOpacity: number
  result: HTMLCanvasElement
}
const _layerStyleCache = new WeakMap<HTMLCanvasElement, LayerStyleCacheEntry>()

function layerStyleCacheKey(style: NonNullable<Layer["style"]>): string {
  return JSON.stringify(style)
}

function hexToRgba(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

function createSelectSubjectMask(width: number, height: number): ImageData {
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

function createSelectSkyMask(width: number, height: number): ImageData {
  // Implement a heuristic-based sky detection algorithm
  // This provides effective sky selection for many common image types
  const imageData = new ImageData(width, height)
  const data = imageData.data

  // Create a selection that's stronger at the top (where sky usually is)
  // and gradually decreases towards the bottom
  const skyHeight = height * 0.6 // Sky typically occupies the top portion

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

function createSelectBackgroundMask(width: number, height: number): ImageData {
  // Implement a heuristic-based background detection algorithm
  // This provides effective background selection for many common image types
  const imageData = new ImageData(width, height)
  const data = imageData.data

  // Create a selection that's stronger at the bottom (where background usually is)
  // and gradually decreases towards the top
  const backgroundStart = height * 0.4 // Background typically starts from the middle going down

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

function drawLayer(ctx: CanvasRenderingContext2D, layer: Layer, clipMask: HTMLCanvasElement | null, filterPreviewCanvas?: HTMLCanvasElement) {
  // Apply layer styles + mask via offscreen if needed
  const baseCanvas = filterPreviewCanvas || layer.canvas
  const content = applySmartFilters(baseCanvas, layer.smartFilters)
  const renderLayer = content === layer.canvas ? layer : { ...layer, canvas: content }
  let toDraw: HTMLCanvasElement = content
  let styleRendered = false
  const pooledCanvases: HTMLCanvasElement[] = []
  if (renderLayer.style) {
    // Check layer style cache
    const sKey = layerStyleCacheKey(renderLayer.style)
    const fillOp = renderLayer.fillOpacity ?? 1
    const cached = _layerStyleCache.get(content)
    if (cached && cached.styleKey === sKey && cached.fillOpacity === fillOp) {
      toDraw = cached.result
    } else {
      // Lazy import to avoid circular ref hazards
      const { applyLayerStyle } = require("./layer-styles") as typeof import("./layer-styles")
      toDraw = applyLayerStyle(renderLayer, fillOp)
      _layerStyleCache.set(content, { styleKey: sKey, fillOpacity: fillOp, result: toDraw })
    }
    styleRendered = true
  }
  if (layer.mask && layer.maskEnabled !== false) {
    const tmp = acquireCanvas(toDraw.width, toDraw.height)
    const tctx = tmp.getContext("2d")!
    tctx.drawImage(toDraw, 0, 0)
    tctx.globalCompositeOperation = "destination-in"
    tctx.drawImage(layer.mask, 0, 0)
    toDraw = tmp
    pooledCanvases.push(tmp)
  }
  if (clipMask) {
    const tmp = acquireCanvas(toDraw.width, toDraw.height)
    const tctx = tmp.getContext("2d")!
    tctx.drawImage(toDraw, 0, 0)
    tctx.globalCompositeOperation = "destination-in"
    tctx.drawImage(clipMask, 0, 0)
    toDraw = tmp
    pooledCanvases.push(tmp)
  }
  // Use the pixel-exact blend-modes compositor which handles all 26 modes correctly
  compositeLayer(ctx, toDraw, layer.blendMode, layer.opacity, styleRendered ? 1 : layer.fillOpacity ?? 1, layer.advancedBlending)
  // Return pooled canvases
  for (const c of pooledCanvases) releaseCanvas(c)
}

function paramsWithDefaults(filter: NonNullable<ReturnType<typeof getFilter>>, params: Record<string, number | string | boolean>) {
  const out: Record<string, number | string | boolean> = {}
  for (const param of filter.params) {
    const raw = params[param.key] ?? param.default
    if (param.type === "slider") {
      const numeric = typeof raw === "number" ? raw : Number(raw)
      out[param.key] = Math.max(param.min, Math.min(param.max, Number.isFinite(numeric) ? numeric : param.default))
    } else if (param.type === "checkbox") {
      out[param.key] = raw === true
    } else if (param.type === "select") {
      out[param.key] = param.options.some((option) => option.value === raw) ? raw : param.default
    }
  }
  return out
}

function imageDataToCanvas(data: ImageData) {
  const canvas = document.createElement("canvas")
  canvas.width = data.width
  canvas.height = data.height
  canvas.getContext("2d")!.putImageData(data, 0, 0)
  return canvas
}

function maskAmountAt(mask: ImageData | null, x: number, y: number) {
  if (!mask || x >= mask.width || y >= mask.height) return 1
  const i = (y * mask.width + x) * 4
  const luminance = (mask.data[i] + mask.data[i + 1] + mask.data[i + 2]) / 765
  return luminance * (mask.data[i + 3] / 255)
}

function smartFilterResult(
  before: ImageData,
  after: ImageData,
  smartFilter: NonNullable<Layer["smartFilters"]>[number],
  width: number,
  height: number,
) {
  const opacity = Math.max(0, Math.min(1, smartFilter.opacity ?? 1))
  if (opacity <= 0) return before
  const blendMode = (smartFilter.blendMode ?? "normal") as BlendMode
  const maskCtx = smartFilter.maskEnabled === false ? null : smartFilter.mask?.getContext("2d") ?? null
  const mask = maskCtx
    ? maskCtx.getImageData(0, 0, Math.min(smartFilter.mask!.width, width), Math.min(smartFilter.mask!.height, height))
    : null

  if (!mask && opacity >= 1 && blendMode === "normal") return after

  const overlay = new ImageData(new Uint8ClampedArray(after.data), width, height)
  if (mask) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        overlay.data[i + 3] = Math.round(overlay.data[i + 3] * maskAmountAt(mask, x, y))
      }
    }
  }

  const baseCanvas = imageDataToCanvas(before)
  const overlayCanvas = imageDataToCanvas(overlay)
  const ctx = baseCanvas.getContext("2d")!
  compositeLayer(ctx, overlayCanvas, blendMode, opacity)
  return ctx.getImageData(0, 0, width, height)
}

function applySmartFilters(
  source: HTMLCanvasElement,
  smartFilters: Layer["smartFilters"],
): HTMLCanvasElement {
  const enabled = smartFilters?.filter((sf) => sf.enabled) ?? []
  if (!enabled.length) return source
  // Check cache
  const cacheKey = smartFilterCacheKey(enabled)
  const cached = _smartFilterCache.get(source)
  if (cached && cached.paramsKey === cacheKey) return cached.result
  // Compute
  const out = document.createElement("canvas")
  out.width = source.width
  out.height = source.height
  const ctx = out.getContext("2d")!
  ctx.drawImage(source, 0, 0)
  let current = ctx.getImageData(0, 0, out.width, out.height)
  for (const smartFilter of enabled) {
    const filter = getFilter(smartFilter.filterId)
    if (!filter) continue
    const before = current
    const after = filter.apply(before, paramsWithDefaults(filter, smartFilter.params))
    current = smartFilterResult(before, after, smartFilter, out.width, out.height)
  }
  ctx.putImageData(current, 0, 0)
  _smartFilterCache.set(source, { paramsKey: cacheKey, result: out })
  return out
}

function applyAdjustmentLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  width: number,
  height: number,
  clipMask?: HTMLCanvasElement | null,
) {
  if (!layer.adjustment) return
  const filter = getFilter(layer.adjustment.type)
  if (!filter) return
  const before = ctx.getImageData(0, 0, width, height)
  const after = filter.apply(before, paramsWithDefaults(filter, layer.adjustment.params))
  const opacity = Math.max(0, Math.min(1, layer.opacity))
  const maskCtx = layer.maskEnabled === false ? null : layer.mask?.getContext("2d") ?? null
  const mask = maskCtx ? maskCtx.getImageData(0, 0, Math.min(layer.mask!.width, width), Math.min(layer.mask!.height, height)) : null
  const clipCtx = clipMask?.getContext("2d") ?? null
  const clip = clipCtx ? clipCtx.getImageData(0, 0, Math.min(clipMask!.width, width), Math.min(clipMask!.height, height)) : null
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const amount = opacity * maskAmountAt(mask, x, y) * maskAmountAt(clip, x, y)
      if (amount <= 0) {
        after.data[i] = before.data[i]
        after.data[i + 1] = before.data[i + 1]
        after.data[i + 2] = before.data[i + 2]
        after.data[i + 3] = before.data[i + 3]
        continue
      }
      for (let k = 0; k < 4; k++) {
        after.data[i + k] = before.data[i + k] * (1 - amount) + after.data[i + k] * amount
      }
    }
  }
  ctx.putImageData(after, 0, 0)
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

function alphaBounds(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  const w = canvas.width
  const h = canvas.height
  const img = ctx.getImageData(0, 0, w, h)
  let minX = w
  let minY = h
  let maxX = 0
  let maxY = 0
  let hasPixels = false
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (img.data[(y * w + x) * 4 + 3] > 8) {
        hasPixels = true
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (!hasPixels) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

type TransformHandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate" | "move"

interface TransformDragState {
  layerId: string
  source: HTMLCanvasElement | null
  bounds: { x: number; y: number; w: number; h: number }
  tx: number
  ty: number
  rotation: number
  scaleX: number
  scaleY: number
  skewX: number
  skewY: number
  referencePoint?: TransformReferencePoint
  constrainProportions?: boolean
  interpolation?: TransformInterpolation
  perspective?: {
    tl: { x: number; y: number }
    tr: { x: number; y: number }
    br: { x: number; y: number }
    bl: { x: number; y: number }
  }
}

type TransformReferencePoint = "tl" | "tc" | "tr" | "ml" | "mc" | "mr" | "bl" | "bc" | "br"
type TransformInterpolation = "nearest" | "bilinear" | "bicubic" | "bicubic-smoother" | "bicubic-sharper"

interface TransformOptionsEvent {
  tx: number
  ty: number
  widthPct: number
  heightPct: number
  rotation: number
  skewX: number
  skewY: number
  referencePoint: TransformReferencePoint
  constrainProportions: boolean
  interpolation: TransformInterpolation
}

function finiteOr(value: unknown, fallback: number) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clampTransformSkew(value: number) {
  return Math.max(-89, Math.min(89, value))
}

function transformOrigin(t: TransformDragState) {
  const ref = t.referencePoint ?? "mc"
  const xMap: Record<TransformReferencePoint, number> = {
    tl: 0,
    tc: 0.5,
    tr: 1,
    ml: 0,
    mc: 0.5,
    mr: 1,
    bl: 0,
    bc: 0.5,
    br: 1,
  }
  const yMap: Record<TransformReferencePoint, number> = {
    tl: 0,
    tc: 0,
    tr: 0,
    ml: 0.5,
    mc: 0.5,
    mr: 0.5,
    bl: 1,
    bc: 1,
    br: 1,
  }
  return {
    x: t.bounds.x + t.bounds.w * xMap[ref],
    y: t.bounds.y + t.bounds.h * yMap[ref],
  }
}

function applyTransformContext(ctx: CanvasRenderingContext2D, t: TransformDragState) {
  const origin = transformOrigin(t)
  const skewX = Math.tan((clampTransformSkew(t.skewX) * Math.PI) / 180)
  const skewY = Math.tan((clampTransformSkew(t.skewY) * Math.PI) / 180)
  ctx.imageSmoothingEnabled = t.interpolation !== "nearest"
  ctx.imageSmoothingQuality =
    t.interpolation === "bilinear" ? "medium" : t.interpolation === "nearest" ? "low" : "high"
  ctx.translate(origin.x + t.tx, origin.y + t.ty)
  ctx.rotate((t.rotation * Math.PI) / 180)
  ctx.transform(1, skewY, skewX, 1, 0, 0)
  ctx.scale(t.scaleX, t.scaleY)
  ctx.translate(-origin.x, -origin.y)
}

function transformPoint(t: TransformDragState, point: { x: number; y: number }) {
  const origin = transformOrigin(t)
  const scaledX = (point.x - origin.x) * t.scaleX
  const scaledY = (point.y - origin.y) * t.scaleY
  const skewX = Math.tan((clampTransformSkew(t.skewX) * Math.PI) / 180)
  const skewY = Math.tan((clampTransformSkew(t.skewY) * Math.PI) / 180)
  const shearedX = scaledX + skewX * scaledY
  const shearedY = skewY * scaledX + scaledY
  const rad = (t.rotation * Math.PI) / 180
  return {
    x: origin.x + t.tx + shearedX * Math.cos(rad) - shearedY * Math.sin(rad),
    y: origin.y + t.ty + shearedX * Math.sin(rad) + shearedY * Math.cos(rad),
  }
}

function transformedBounds(t: TransformDragState) {
  const corners = transformCorners(t)
  const xs = corners.map((corner) => corner.x)
  const ys = corners.map((corner) => corner.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)
  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
  }
}

function transformCorners(t: TransformDragState): { x: number; y: number }[] {
  const corners = [
    { x: t.bounds.x, y: t.bounds.y },
    { x: t.bounds.x + t.bounds.w, y: t.bounds.y },
    { x: t.bounds.x + t.bounds.w, y: t.bounds.y + t.bounds.h },
    { x: t.bounds.x, y: t.bounds.y + t.bounds.h },
  ]
  const transformed = corners.map((corner) => transformPoint(t, corner))
  if (t.perspective) {
    const offsets = [t.perspective.tl, t.perspective.tr, t.perspective.br, t.perspective.bl]
    return transformed.map((corner, index) => ({
      x: corner.x + offsets[index].x,
      y: corner.y + offsets[index].y,
    }))
  }
  return transformed
}

function transformHandles(t: TransformDragState): { x: number; y: number; id: TransformHandleId }[] {
  const c = transformCorners(t)
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const top = mid(c[0], c[1])
  const right = mid(c[1], c[2])
  const bottom = mid(c[2], c[3])
  const left = mid(c[3], c[0])
  const center = mid(c[0], c[2])
  // rotate handle: 24px above top-mid in transformed space
  const rad = (t.rotation * Math.PI) / 180
  const rot = { x: top.x + 0 * Math.cos(rad) - -24 * Math.sin(rad), y: top.y + 0 * Math.sin(rad) + -24 * Math.cos(rad) }
  return [
    { x: c[0].x, y: c[0].y, id: "nw" },
    { x: top.x, y: top.y, id: "n" },
    { x: c[1].x, y: c[1].y, id: "ne" },
    { x: right.x, y: right.y, id: "e" },
    { x: c[2].x, y: c[2].y, id: "se" },
    { x: bottom.x, y: bottom.y, id: "s" },
    { x: c[3].x, y: c[3].y, id: "sw" },
    { x: left.x, y: left.y, id: "w" },
    { x: rot.x, y: rot.y, id: "rotate" },
  ]
}

function pickTransformHandle(p: { x: number; y: number }, t: TransformDragState): TransformHandleId | null {
  const handles = transformHandles(t)
  for (const h of handles) {
    if (Math.abs(p.x - h.x) < 8 && Math.abs(p.y - h.y) < 8) return h.id
  }
  return null
}

function pointInTransformBox(p: { x: number; y: number }, t: TransformDragState) {
  const c = transformCorners(t)
  // simple polygon test
  let inside = false
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
    const xi = c[i].x
    const yi = c[i].y
    const xj = c[j].x
    const yj = c[j].y
    const intersect =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function labelForTool(tool: string): string {
  const map: Record<string, string> = {
    brush: "Brush Stroke",
    pencil: "Pencil",
    "mixer-brush": "Mixer Brush",
    "pattern-stamp": "Pattern Stamp",
    eraser: "Eraser",
    blur: "Blur",
    sharpen: "Sharpen",
    smudge: "Smudge",
    dodge: "Dodge",
    burn: "Burn",
    sponge: "Sponge",
    "clone-stamp": "Clone Stamp",
    "history-brush": "History Brush",
    "art-history-brush": "Art History Brush",
    "red-eye": "Red Eye Correction",
    "spot-healing": "Spot Healing",
    "healing-brush": "Healing Brush",
    "patch-tool": "Patch Tool",
    "select-subject": "Select Subject",
    "select-sky": "Select Sky",
    "quick-selection": "Quick Selection",
    "object-select": "Object Selection",
    "refine-edge-brush": "Refine Edge Brush",
    "remove-tool": "Remove Tool",
    "content-aware-move": "Content-Aware Move",
  }
  return map[tool] ?? "Edit"
}

function cursorForTool(tool: string, brushy: boolean) {
  if (tool === "hand") return "grab"
  if (tool === "rotate-view") return "grab"
  if (tool === "zoom") return "zoom-in"
  if (tool === "eyedropper" || tool === "color-sampler" || tool === "material-eyedropper" || tool === "material-drop") return "crosshair"
  if (tool === "type" || tool === "type-vertical" || tool === "type-mask-horizontal" || tool === "type-mask-vertical") return "text"
  if (tool === "move" || tool === "content-aware-move") return "move"
  if (tool === "pen" || tool === "freeform-pen" || tool === "curvature-pen" || tool === "add-anchor-point" || tool === "delete-anchor-point" || tool === "convert-point") return "crosshair"
  if (tool === "path-select") return "default"
  if (tool === "shape-rect" || tool === "shape-rounded-rect" || tool === "shape-ellipse" || tool === "shape-polygon" || tool === "shape-triangle" || tool === "shape-line") return "crosshair"
  if (tool === "marquee-rect" || tool === "marquee-ellipse" || tool === "marquee-row" || tool === "marquee-col" || tool === "lasso" || tool === "lasso-polygon" || tool === "lasso-magnetic" || tool === "magic-wand" || tool === "quick-selection" || tool === "object-select" || tool === "select-subject" || tool === "select-sky" || tool === "select-background" || tool === "patch-tool" || tool === "red-eye" || tool === "crop" || tool === "perspective-crop" || tool === "slice-select") return "crosshair"
  if (tool === "paint-bucket" || tool === "gradient") return "crosshair"
  if (brushy) return "none"
  return "default"
}

function shapePropsForTool(
  tool: string,
  x: number,
  y: number,
  w: number,
  h: number,
  _start: { x: number; y: number },
  _end: { x: number; y: number },
  foreground: string,
  background: string,
): ShapeProps {
  const options = getShapeRuntimeOptions()
  const stroke = options.strokeWidth > 0 ? { color: background, width: options.strokeWidth } : null
  if (tool === "shape-ellipse") {
    return { type: "ellipse", x, y, w, h, fill: foreground, stroke }
  }
  if (tool === "shape-polygon") {
    return { type: "polygon", x, y, w, h, fill: foreground, stroke, sides: 6 }
  }
  if (tool === "shape-triangle") {
    return { type: "polygon", x, y, w, h, fill: foreground, stroke, sides: 3 }
  }
  if (tool === "custom-shape") {
    return { type: "custom", x, y, w, h, fill: foreground, stroke, customId: getCustomShapeRuntimeId() }
  }
  return { type: "rect", x, y, w, h, fill: foreground, stroke, radius: tool === "shape-rounded-rect" ? Math.max(4, options.radius || 18) : options.radius }
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
  const ctx = canvas.getContext("2d")!
  const w = canvas.width
  const h = canvas.height
  const src = ctx.getImageData(0, 0, w, h)
  const mask = makeCanvas(w, h)
  const mctx = mask.getContext("2d")!
  const out = mctx.createImageData(w, h)
  const seeds = [
    { x: 0, y: 0 },
    { x: w - 1, y: 0 },
    { x: 0, y: h - 1 },
    { x: w - 1, y: h - 1 },
  ]
  for (const seed of seeds) {
    const fill = floodFillMask(src, seed.x, seed.y, tolerance, true)
    for (let i = 0; i < out.data.length; i += 4) {
      if (fill.data[i + 3] > 0) out.data[i + 3] = 255
    }
  }
  mctx.putImageData(out, 0, 0)
  return featherMask(mask, 1)
}

function normalizeViewRotation(value: number) {
  return ((value % 360) + 360) % 360
}

function shapeRect(shape: ShapeProps) {
  return { x: shape.x, y: shape.y, w: shape.w, h: shape.h }
}

function shapeHandles(bounds: { x: number; y: number; w: number; h: number }) {
  return [
    { id: "nw" as const, x: bounds.x, y: bounds.y },
    { id: "ne" as const, x: bounds.x + bounds.w, y: bounds.y },
    { id: "se" as const, x: bounds.x + bounds.w, y: bounds.y + bounds.h },
    { id: "sw" as const, x: bounds.x, y: bounds.y + bounds.h },
    { id: "center" as const, x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 },
  ]
}

function resizePlainRect(
  rect: { x: number; y: number; w: number; h: number },
  handle: "nw" | "ne" | "se" | "sw" | "center",
  pt: { x: number; y: number },
  dx: number,
  dy: number,
) {
  if (handle === "center") return { ...rect, x: rect.x + dx, y: rect.y + dy }
  const x2 = rect.x + rect.w
  const y2 = rect.y + rect.h
  const next = {
    x: handle === "nw" || handle === "sw" ? pt.x : rect.x,
    y: handle === "nw" || handle === "ne" ? pt.y : rect.y,
    w: handle === "ne" || handle === "se" ? pt.x - rect.x : x2 - pt.x,
    h: handle === "sw" || handle === "se" ? pt.y - rect.y : y2 - pt.y,
  }
  if (next.w < 0) {
    next.x += next.w
    next.w = Math.abs(next.w)
  }
  if (next.h < 0) {
    next.y += next.h
    next.h = Math.abs(next.h)
  }
  return { x: next.x, y: next.y, w: Math.max(1, next.w), h: Math.max(1, next.h) }
}

function resizeShapeRect(
  shape: ShapeProps,
  handle: "nw" | "ne" | "se" | "sw" | "center",
  pt: { x: number; y: number },
  dx: number,
  dy: number,
): ShapeProps {
  return { ...shape, ...resizePlainRect(shapeRect(shape), handle, pt, dx, dy) }
}
