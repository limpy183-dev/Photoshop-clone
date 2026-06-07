"use client"

import * as React from "react"
import type { Guide, Layer } from "./types"

export type SelectionTransformInterpolation = "nearest" | "bilinear" | "bicubic"

export interface SelectionTransformState {
  scaleX: number
  scaleY: number
  rotationDeg: number
  translateX: number
  translateY: number
  interpolation: SelectionTransformInterpolation
}

type SelectionTransformHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate" | "move"
type Bounds = { x: number; y: number; w: number; h: number }

const DEFAULT_SELECTION_TRANSFORM: SelectionTransformState = {
  scaleX: 1,
  scaleY: 1,
  rotationDeg: 0,
  translateX: 0,
  translateY: 0,
  interpolation: "bicubic",
}

function clampScale(value: number) {
  if (!Number.isFinite(value)) return 1
  if (Math.abs(value) < 0.01) return 0.01 * Math.sign(value || 1)
  return Math.max(-20, Math.min(20, value))
}

function round(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.round(value)
}

function parseNumber(value: string, fallback: number) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function alphaBoundsForLayer(layer: Layer): Bounds | null {
  if (layer.kind === "group" || typeof layer.canvas?.getContext !== "function") return null
  const ctx = layer.canvas.getContext("2d")
  if (!ctx || layer.canvas.width <= 0 || layer.canvas.height <= 0) return null
  const img = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
  let minX = layer.canvas.width
  let minY = layer.canvas.height
  let maxX = 0
  let maxY = 0
  let found = false
  for (let y = 0; y < layer.canvas.height; y += 1) {
    for (let x = 0; x < layer.canvas.width; x += 1) {
      if (img.data[(y * layer.canvas.width + x) * 4 + 3] <= 8) continue
      found = true
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return found ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null
}

function rectValues(bounds: Bounds) {
  return {
    x: [bounds.x, bounds.x + bounds.w / 2, bounds.x + bounds.w],
    y: [bounds.y, bounds.y + bounds.h / 2, bounds.y + bounds.h],
  }
}

function buildSnapTargets(input: {
  bounds: Bounds
  docW: number
  docH: number
  guides?: Guide[]
  layers?: Layer[]
}) {
  const x: Array<{ value: number; label: string }> = [
    { value: 0, label: "document edge" },
    { value: input.docW / 2, label: "document center" },
    { value: input.docW, label: "document edge" },
  ]
  const y: Array<{ value: number; label: string }> = [
    { value: 0, label: "document edge" },
    { value: input.docH / 2, label: "document center" },
    { value: input.docH, label: "document edge" },
  ]
  const selection = rectValues(input.bounds)
  for (const value of selection.x) x.push({ value, label: "selection bounds" })
  for (const value of selection.y) y.push({ value, label: "selection bounds" })
  for (const guide of input.guides ?? []) {
    if (guide.visible === false) continue
    if (guide.orientation === "vertical") x.push({ value: guide.position, label: "guide" })
    else y.push({ value: guide.position, label: "guide" })
  }
  for (const layer of input.layers ?? []) {
    const layerBounds = alphaBoundsForLayer(layer)
    if (!layerBounds) continue
    const values = rectValues(layerBounds)
    for (const value of values.x) x.push({ value, label: "layer bounds" })
    for (const value of values.y) y.push({ value, label: "layer bounds" })
  }
  return { x, y }
}

function snapTranslation(input: {
  bounds: Bounds
  next: SelectionTransformState
  targets: ReturnType<typeof buildSnapTargets>
}) {
  const threshold = 6
  const moving = {
    x: [
      input.bounds.x + input.next.translateX,
      input.bounds.x + input.bounds.w / 2 + input.next.translateX,
      input.bounds.x + input.bounds.w + input.next.translateX,
    ],
    y: [
      input.bounds.y + input.next.translateY,
      input.bounds.y + input.bounds.h / 2 + input.next.translateY,
      input.bounds.y + input.bounds.h + input.next.translateY,
    ],
  }
  let dx = 0
  let dy = 0
  let xLabel: string | null = null
  let yLabel: string | null = null
  let bestX = threshold + 1
  let bestY = threshold + 1
  for (const value of moving.x) {
    for (const target of input.targets.x) {
      const delta = target.value - value
      const score = Math.abs(delta)
      if (score <= threshold && score < bestX) {
        bestX = score
        dx = delta
        xLabel = target.label
      }
    }
  }
  for (const value of moving.y) {
    for (const target of input.targets.y) {
      const delta = target.value - value
      const score = Math.abs(delta)
      if (score <= threshold && score < bestY) {
        bestY = score
        dy = delta
        yLabel = target.label
      }
    }
  }
  return {
    state: { ...input.next, translateX: input.next.translateX + dx, translateY: input.next.translateY + dy },
    label: xLabel || yLabel ? `Snapped to ${[xLabel, yLabel].filter(Boolean).join(" and ")}` : "Snap ready: document edges, selection bounds, guides, layer bounds",
  }
}

export function SelectionTransformOverlay({
  bounds,
  docW,
  docH,
  zoom,
  guides,
  layers,
  onCommit,
  onCancel,
  onOpenPrecision,
}: {
  bounds: Bounds
  docW: number
  docH: number
  zoom: number
  guides?: Guide[]
  layers?: Layer[]
  onCommit: (t: SelectionTransformState) => void
  onCancel: () => void
  onOpenPrecision?: () => void
}) {
  const [state, setState] = React.useState<SelectionTransformState>(DEFAULT_SELECTION_TRANSFORM)
  const [snapFeedback, setSnapFeedback] = React.useState("Snap ready: document edges, selection bounds, guides, layer bounds")
  const stateRef = React.useRef(state)
  React.useEffect(() => {
    stateRef.current = state
  }, [state])
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<{
    handle: SelectionTransformHandle
    startPointer: { x: number; y: number }
    startState: SelectionTransformState
  } | null>(null)
  const snapTargets = React.useMemo(
    () => buildSnapTargets({ bounds, docW, docH, guides, layers }),
    [bounds, docH, docW, guides, layers],
  )

  const cx = bounds.x + bounds.w / 2
  const cy = bounds.y + bounds.h / 2
  const docToOverlay = React.useCallback((p: { x: number; y: number }) => ({
    x: (p.x / docW) * 100,
    y: (p.y / docH) * 100,
  }), [docW, docH])

  const transformCorner = React.useCallback((px: number, py: number, t: SelectionTransformState) => {
    const sx = (px - cx) * t.scaleX
    const sy = (py - cy) * t.scaleY
    const rad = (t.rotationDeg * Math.PI) / 180
    return {
      x: cx + t.translateX + sx * Math.cos(rad) - sy * Math.sin(rad),
      y: cy + t.translateY + sx * Math.sin(rad) + sy * Math.cos(rad),
    }
  }, [cx, cy])

  const corners = React.useMemo(() => ({
    nw: transformCorner(bounds.x, bounds.y, state),
    ne: transformCorner(bounds.x + bounds.w, bounds.y, state),
    se: transformCorner(bounds.x + bounds.w, bounds.y + bounds.h, state),
    sw: transformCorner(bounds.x, bounds.y + bounds.h, state),
  }), [bounds, state, transformCorner])

  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const top = mid(corners.nw, corners.ne)
  const right = mid(corners.ne, corners.se)
  const bottom = mid(corners.se, corners.sw)
  const left = mid(corners.sw, corners.nw)
  const rotRad = (state.rotationDeg * Math.PI) / 180
  const rotateHandle = {
    x: top.x + 0 * Math.cos(rotRad) - (-24 / Math.max(0.01, zoom)) * Math.sin(rotRad),
    y: top.y + 0 * Math.sin(rotRad) + (-24 / Math.max(0.01, zoom)) * Math.cos(rotRad),
  }

  const overlayPoints = {
    nw: docToOverlay(corners.nw),
    n: docToOverlay(top),
    ne: docToOverlay(corners.ne),
    e: docToOverlay(right),
    se: docToOverlay(corners.se),
    s: docToOverlay(bottom),
    sw: docToOverlay(corners.sw),
    w: docToOverlay(left),
    rotate: docToOverlay(rotateHandle),
    c: docToOverlay({ x: cx + state.translateX, y: cy + state.translateY }),
  }

  function localToDoc(e: PointerEvent | React.PointerEvent): { x: number; y: number } | null {
    const root = rootRef.current
    if (!root) return null
    const rect = root.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * docW,
      y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * docH,
    }
  }

  const updateState = React.useCallback((next: SelectionTransformState, snapMove = false) => {
    if (snapMove) {
      const snapped = snapTranslation({ bounds, next, targets: snapTargets })
      setState(snapped.state)
      setSnapFeedback(snapped.label)
      return
    }
    setState(next)
  }, [bounds, snapTargets])

  function onPointerDownHandle(e: React.PointerEvent, handle: SelectionTransformHandle) {
    e.stopPropagation()
    e.preventDefault()
    const p = localToDoc(e)
    if (!p) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    dragRef.current = {
      handle,
      startPointer: p,
      startState: { ...stateRef.current },
    }
  }

  function onPointerMoveHandle(e: React.PointerEvent) {
    const drag = dragRef.current
    if (!drag) return
    const p = localToDoc(e)
    if (!p) return
    const dx = p.x - drag.startPointer.x
    const dy = p.y - drag.startPointer.y
    const start = drag.startState
    if (drag.handle === "move") {
      updateState({ ...start, translateX: start.translateX + dx, translateY: start.translateY + dy }, true)
      return
    }
    if (drag.handle === "rotate") {
      const a0 = Math.atan2(drag.startPointer.y - (cy + start.translateY), drag.startPointer.x - (cx + start.translateX))
      const a1 = Math.atan2(p.y - (cy + start.translateY), p.x - (cx + start.translateX))
      let deg = ((a1 - a0) * 180) / Math.PI + start.rotationDeg
      if (e.shiftKey) deg = Math.round(deg / 15) * 15
      updateState({ ...start, rotationDeg: deg })
      return
    }
    const rad = (start.rotationDeg * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const localDx = dx * cos + dy * sin
    const localDy = -dx * sin + dy * cos
    const halfW = bounds.w / 2 || 1
    const halfH = bounds.h / 2 || 1
    let scaleX = start.scaleX
    let scaleY = start.scaleY
    let signX = 1
    let signY = 1
    if (drag.handle.includes("w")) signX = -1
    if (drag.handle.includes("n")) signY = -1
    if (drag.handle.includes("e") || drag.handle.includes("w")) scaleX = start.scaleX + (signX * localDx) / halfW
    if (drag.handle.includes("n") || drag.handle.includes("s")) scaleY = start.scaleY + (signY * localDy) / halfH
    if (drag.handle === "e" || drag.handle === "w") scaleY = start.scaleY
    if (drag.handle === "n" || drag.handle === "s") scaleX = start.scaleX
    if (e.shiftKey && ["nw", "ne", "se", "sw"].includes(drag.handle)) {
      const ratio = Math.max(Math.abs(scaleX), Math.abs(scaleY))
      scaleX = Math.sign(scaleX || 1) * ratio
      scaleY = Math.sign(scaleY || 1) * ratio
    }
    updateState({ ...start, scaleX: clampScale(scaleX), scaleY: clampScale(scaleY) })
  }

  function onPointerUpHandle(e: React.PointerEvent) {
    if (!dragRef.current) return
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    dragRef.current = null
  }

  React.useEffect(() => {
    function keyHandler(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault()
        onCommit(stateRef.current)
      } else if (e.key === "Escape") {
        e.preventDefault()
        onCancel()
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0
        updateState({ ...stateRef.current, translateX: stateRef.current.translateX + dx, translateY: stateRef.current.translateY + dy })
      }
    }
    window.addEventListener("keydown", keyHandler)
    return () => window.removeEventListener("keydown", keyHandler)
  }, [onCommit, onCancel, updateState])

  const handleStyle = (p: { x: number; y: number }, cursor: string): React.CSSProperties => ({
    position: "absolute",
    left: `${p.x}%`,
    top: `${p.y}%`,
    width: 10,
    height: 10,
    transform: "translate(-50%, -50%)",
    background: "white",
    border: "1px solid #0a84ff",
    boxShadow: "0 0 0 1px rgba(0,0,0,0.55)",
    cursor,
    pointerEvents: "auto",
  })

  const setPercent = (axis: "scaleX" | "scaleY", value: string) => {
    updateState({ ...stateRef.current, [axis]: clampScale(parseNumber(value, stateRef.current[axis] * 100) / 100) })
  }
  const polyPoints = `${overlayPoints.nw.x},${overlayPoints.nw.y} ${overlayPoints.ne.x},${overlayPoints.ne.y} ${overlayPoints.se.x},${overlayPoints.se.y} ${overlayPoints.sw.x},${overlayPoints.sw.y}`

  return (
    <div
      ref={rootRef}
      className="absolute inset-0"
      style={{ pointerEvents: "none", zIndex: 20 }}
      data-testid="selection-transform-overlay"
    >
      <svg
        className="absolute inset-0"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}
      >
        <polygon
          points={polyPoints}
          fill="rgba(10,132,255,0.08)"
          stroke="#0a84ff"
          strokeWidth={0.18}
          vectorEffect="non-scaling-stroke"
          strokeDasharray="2 2"
        />
        <line
          x1={overlayPoints.n.x}
          y1={overlayPoints.n.y}
          x2={overlayPoints.rotate.x}
          y2={overlayPoints.rotate.y}
          stroke="#0a84ff"
          strokeWidth={0.18}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div
        style={{ ...handleStyle(overlayPoints.c, "move"), width: 18, height: 18, borderRadius: 999, background: "rgba(10,132,255,0.9)" }}
        onPointerDown={(e) => onPointerDownHandle(e, "move")}
        onPointerMove={onPointerMoveHandle}
        onPointerUp={onPointerUpHandle}
        data-testid="selection-transform-handle-move"
        aria-label="Move transformed selection"
      />
      {([
        ["nw", "nwse-resize"],
        ["n", "ns-resize"],
        ["ne", "nesw-resize"],
        ["e", "ew-resize"],
        ["se", "nwse-resize"],
        ["s", "ns-resize"],
        ["sw", "nesw-resize"],
        ["w", "ew-resize"],
      ] as const).map(([handle, cursor]) => (
        <div
          key={handle}
          style={handleStyle(overlayPoints[handle], cursor)}
          onPointerDown={(e) => onPointerDownHandle(e, handle)}
          onPointerMove={onPointerMoveHandle}
          onPointerUp={onPointerUpHandle}
          data-testid={`selection-transform-handle-${handle}`}
        />
      ))}
      <div
        style={{ ...handleStyle(overlayPoints.rotate, "grab"), borderRadius: "50%" }}
        onPointerDown={(e) => onPointerDownHandle(e, "rotate")}
        onPointerMove={onPointerMoveHandle}
        onPointerUp={onPointerUpHandle}
        data-testid="selection-transform-handle-rotate"
      />
      <div
        data-testid="selection-transform-rotation-readout"
        className="absolute rounded-sm border border-[rgba(255,255,255,0.25)] bg-[rgba(0,0,0,0.78)] px-2 py-1 text-[10px] text-white"
        style={{
          left: `${overlayPoints.rotate.x}%`,
          top: `${overlayPoints.rotate.y}%`,
          transform: "translate(10px, -50%)",
          pointerEvents: "none",
        }}
      >
        {round(state.rotationDeg)} deg
      </div>
      <div
        data-testid="selection-transform-mini-options"
        className="absolute grid grid-cols-[repeat(6,auto)] items-end gap-2 rounded-sm border border-[rgba(255,255,255,0.18)] bg-[rgba(12,15,20,0.92)] p-2 text-[10px] text-white shadow-[0_12px_30px_rgba(0,0,0,0.45)]"
        style={{
          left: `${overlayPoints.s.x}%`,
          top: `${overlayPoints.s.y}%`,
          transform: "translate(-50%, 18px)",
          pointerEvents: "auto",
          zIndex: 21,
        }}
      >
        <label className="grid gap-1">
          X
          <input aria-label="Transform X" type="number" value={round(state.translateX)} onChange={(e) => updateState({ ...stateRef.current, translateX: parseNumber(e.target.value, 0) }, true)} className="h-6 w-14 rounded-sm border border-white/20 bg-black/45 px-1" />
        </label>
        <label className="grid gap-1">
          Y
          <input aria-label="Transform Y" type="number" value={round(state.translateY)} onChange={(e) => updateState({ ...stateRef.current, translateY: parseNumber(e.target.value, 0) }, true)} className="h-6 w-14 rounded-sm border border-white/20 bg-black/45 px-1" />
        </label>
        <label className="grid gap-1">
          W
          <input aria-label="Transform width percent" type="number" value={round(state.scaleX * 100)} onChange={(e) => setPercent("scaleX", e.target.value)} className="h-6 w-14 rounded-sm border border-white/20 bg-black/45 px-1" />
        </label>
        <label className="grid gap-1">
          H
          <input aria-label="Transform height percent" type="number" value={round(state.scaleY * 100)} onChange={(e) => setPercent("scaleY", e.target.value)} className="h-6 w-14 rounded-sm border border-white/20 bg-black/45 px-1" />
        </label>
        <label className="grid gap-1">
          Rotate
          <input aria-label="Transform rotation degrees" type="number" value={round(state.rotationDeg)} onChange={(e) => updateState({ ...stateRef.current, rotationDeg: parseNumber(e.target.value, 0) })} className="h-6 w-16 rounded-sm border border-white/20 bg-black/45 px-1" />
        </label>
        <label className="grid gap-1">
          Interpolation
          <select aria-label="Transform interpolation" value={state.interpolation} onChange={(e) => updateState({ ...stateRef.current, interpolation: e.target.value as SelectionTransformInterpolation })} className="h-6 rounded-sm border border-white/20 bg-black/45 px-1">
            <option value="nearest">Nearest</option>
            <option value="bilinear">Bilinear</option>
            <option value="bicubic">Bicubic</option>
          </select>
        </label>
        <div className="col-span-6 flex items-center gap-2">
          <span data-testid="selection-transform-snap-feedback" className="min-w-0 flex-1 truncate text-[9px] uppercase tracking-wide text-cyan-100">
            {snapFeedback}
          </span>
          {onOpenPrecision ? (
            <button type="button" onClick={(e) => { e.stopPropagation(); onOpenPrecision() }} className="rounded-sm border border-white/20 px-2 py-1 hover:bg-white/10">
              Precision...
            </button>
          ) : null}
          <button type="button" onClick={(e) => { e.stopPropagation(); onCancel() }} data-testid="selection-transform-cancel" className="rounded-sm border border-white/25 px-2 py-1 hover:bg-white/10">
            Cancel
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onCommit(stateRef.current) }} data-testid="selection-transform-commit" className="rounded-sm bg-[#0a84ff] px-2 py-1 text-white hover:bg-[#2f96ff]">
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
