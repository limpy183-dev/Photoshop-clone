"use client"

import * as React from "react"
import type { Layer, PsDocument } from "./types"

export function SmartGuidesOverlay({
  layers,
  activeLayerId,
  docW,
  docH,
}: {
  layers: Layer[]
  activeLayerId: string
  docW: number
  docH: number
}) {
  const activeLayer = layers.find((l) => l.id === activeLayerId)
  if (!activeLayer || !activeLayer.visible || activeLayer.kind === "group") return null

  // Get bounding box of active layer from alpha
  const aBounds = React.useMemo(() => alphaBoundsForLayer(activeLayer), [activeLayer])
  if (!aBounds) return null
  const { horizontal: uniqueH, vertical: uniqueV } = smartGuideLinesForBounds({
    layers,
    activeLayerId,
    docW,
    docH,
    activeBounds: aBounds,
  })

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

export function smartGuideLinesForBounds({
  layers,
  activeLayerId,
  docW,
  docH,
  activeBounds: aBounds,
}: {
  layers: Layer[]
  activeLayerId: string
  docW: number
  docH: number
  activeBounds: { x: number; y: number; w: number; h: number }
}) {
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
  return { horizontal: uniqueH, vertical: uniqueV }
}

export function alphaBoundsForLayer(layer: Layer): { x: number; y: number; w: number; h: number } | null {
  return alphaBoundsForCanvas(layer.canvas)
}

export function alphaBoundsForCanvas(canvas: HTMLCanvasElement | null | undefined): { x: number; y: number; w: number; h: number } | null {
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

export function smartSnapLayerDelta(
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
