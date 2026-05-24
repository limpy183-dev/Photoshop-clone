/**
 * Dirty-rectangle tracking utilities.
 *
 * The renderer schedules redraws through {@link RenderBus}; until now,
 * an invalidation pointed only at *which layers* needed to recomposite,
 * which still forced a full-frame draw. These helpers let callers pass
 * bounding boxes per layer so the renderer can scissor its draws and
 * skip pixels that are known to be clean.
 */

const COALESCE_AREA_RATIO = 0.6

export interface DirtyRect {
  x: number
  y: number
  w: number
  h: number
}

export interface CanvasBounds {
  width: number
  height: number
}

const ZERO_RECT: DirtyRect = { x: 0, y: 0, w: 0, h: 0 }

export function emptyDirtyRect(): DirtyRect {
  return { ...ZERO_RECT }
}

export function isEmptyDirtyRect(rect: DirtyRect | null | undefined): boolean {
  if (!rect) return true
  return rect.w <= 0 || rect.h <= 0
}

export function normalizeDirtyRect(rect: DirtyRect, bounds?: CanvasBounds): DirtyRect {
  if (!rect || isEmptyDirtyRect(rect)) return emptyDirtyRect()
  const xMin = Math.floor(rect.x)
  const yMin = Math.floor(rect.y)
  const xMax = Math.ceil(rect.x + rect.w)
  const yMax = Math.ceil(rect.y + rect.h)
  let x = xMin
  let y = yMin
  let w = xMax - xMin
  let h = yMax - yMin
  if (bounds) {
    const right = Math.min(xMax, Math.max(0, bounds.width))
    const bottom = Math.min(yMax, Math.max(0, bounds.height))
    x = Math.max(0, x)
    y = Math.max(0, y)
    w = Math.max(0, right - x)
    h = Math.max(0, bottom - y)
  } else {
    x = Math.max(0, x)
    y = Math.max(0, y)
    w = Math.max(0, w)
    h = Math.max(0, h)
  }
  return { x, y, w, h }
}

export function unionDirtyRect(a: DirtyRect | null | undefined, b: DirtyRect | null | undefined): DirtyRect {
  if (isEmptyDirtyRect(a)) return b ? { ...b } : emptyDirtyRect()
  if (isEmptyDirtyRect(b)) return a ? { ...a } : emptyDirtyRect()
  const aRect = a as DirtyRect
  const bRect = b as DirtyRect
  const x = Math.min(aRect.x, bRect.x)
  const y = Math.min(aRect.y, bRect.y)
  const right = Math.max(aRect.x + aRect.w, bRect.x + bRect.w)
  const bottom = Math.max(aRect.y + aRect.h, bRect.y + bRect.h)
  return { x, y, w: right - x, h: bottom - y }
}

export function intersectDirtyRect(a: DirtyRect, b: DirtyRect): DirtyRect {
  if (isEmptyDirtyRect(a) || isEmptyDirtyRect(b)) return emptyDirtyRect()
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.w, b.x + b.w)
  const bottom = Math.min(a.y + a.h, b.y + b.h)
  const w = right - x
  const h = bottom - y
  if (w <= 0 || h <= 0) return emptyDirtyRect()
  return { x, y, w, h }
}

export function rectArea(rect: DirtyRect): number {
  if (isEmptyDirtyRect(rect)) return 0
  return rect.w * rect.h
}

export function rectsIntersect(a: DirtyRect, b: DirtyRect): boolean {
  return rectArea(intersectDirtyRect(a, b)) > 0
}

export function expandDirtyRect(rect: DirtyRect, padding: number, bounds?: CanvasBounds): DirtyRect {
  if (padding <= 0 || isEmptyDirtyRect(rect)) {
    return bounds ? normalizeDirtyRect(rect, bounds) : { ...rect }
  }
  return normalizeDirtyRect(
    {
      x: rect.x - padding,
      y: rect.y - padding,
      w: rect.w + padding * 2,
      h: rect.h + padding * 2,
    },
    bounds,
  )
}

/**
 * Add a rect to a dirty list, merging into an existing rect whenever the
 * union covers more than {@link COALESCE_AREA_RATIO} of the combined
 * area. Prevents the list from growing without bound for fast strokes
 * while still keeping disjoint regions separate.
 */
export function addDirtyRect(rects: DirtyRect[], rect: DirtyRect, bounds?: CanvasBounds): DirtyRect[] {
  const normalized = normalizeDirtyRect(rect, bounds)
  if (isEmptyDirtyRect(normalized)) return rects
  for (let i = 0; i < rects.length; i++) {
    const existing = rects[i]
    const merged = unionDirtyRect(existing, normalized)
    const combinedArea = rectArea(existing) + rectArea(normalized) - rectArea(intersectDirtyRect(existing, normalized))
    if (combinedArea === 0) continue
    if (combinedArea / rectArea(merged) >= COALESCE_AREA_RATIO || rectsIntersect(existing, normalized)) {
      rects[i] = merged
      return rects
    }
  }
  rects.push(normalized)
  return rects
}

export function unionDirtyRects(rects: readonly DirtyRect[]): DirtyRect {
  return rects.reduce((acc, rect) => unionDirtyRect(acc, rect), emptyDirtyRect())
}

export function dirtyCoverageRatio(rect: DirtyRect, bounds: CanvasBounds): number {
  const area = rectArea(rect)
  if (area <= 0) return 0
  const totalArea = Math.max(1, bounds.width * bounds.height)
  return Math.min(1, area / totalArea)
}

/**
 * Decide whether a partial redraw is worth the bookkeeping. Below the
 * threshold, callers should scissor; above it, the full frame is
 * cheaper than tracking dozens of small rects.
 */
export function shouldUsePartialRedraw(rect: DirtyRect, bounds: CanvasBounds, threshold = 0.6): boolean {
  return dirtyCoverageRatio(rect, bounds) < threshold
}

export function adaptiveDirtyRedrawThreshold(bounds: CanvasBounds): number {
  const pixels = Math.max(1, Math.round(bounds.width) * Math.round(bounds.height))
  if (pixels >= 64_000_000) return 0.42
  if (pixels >= 24_000_000) return 0.5
  if (pixels >= 8_000_000) return 0.56
  if (pixels <= 1_500_000) return 0.72
  return COALESCE_AREA_RATIO
}

export interface LayerDirtyRectPlanInput {
  dirtyByLayer: Readonly<Record<string, readonly DirtyRect[]>>
  bounds: CanvasBounds
  fullRedrawThreshold?: number
}

export interface LayerDirtyRectEntry {
  rects: DirtyRect[]
  unionRect: DirtyRect
  coverage: number
  partial: boolean
}

export interface LayerDirtyRectPlan {
  layers: Record<string, LayerDirtyRectEntry>
  compositeRect: DirtyRect
  coverage: number
  threshold: number
  fullFrame: boolean
  strategy: "none" | "layer-isolated" | "full-frame"
}

export function planLayerDirtyRects(input: LayerDirtyRectPlanInput): LayerDirtyRectPlan {
  const threshold = input.fullRedrawThreshold ?? adaptiveDirtyRedrawThreshold(input.bounds)
  const layers: Record<string, LayerDirtyRectEntry> = {}
  const compositeRects: DirtyRect[] = []

  for (const [layerId, rects] of Object.entries(input.dirtyByLayer)) {
    const merged: DirtyRect[] = []
    for (const rect of rects) addDirtyRect(merged, rect, input.bounds)
    if (!merged.length) continue
    const unionRect = unionDirtyRects(merged)
    const coverage = dirtyCoverageRatio(unionRect, input.bounds)
    layers[layerId] = {
      rects: merged,
      unionRect,
      coverage,
      partial: coverage < threshold,
    }
    addDirtyRect(compositeRects, unionRect, input.bounds)
  }

  if (!Object.keys(layers).length) {
    return {
      layers: {},
      compositeRect: emptyDirtyRect(),
      coverage: 0,
      threshold,
      fullFrame: false,
      strategy: "none",
    }
  }

  const compositeRect = unionDirtyRects(compositeRects)
  const coverage = dirtyCoverageRatio(compositeRect, input.bounds)
  const fullFrame = coverage >= threshold || Object.values(layers).some((layer) => !layer.partial)
  return {
    layers,
    compositeRect,
    coverage,
    threshold,
    fullFrame,
    strategy: fullFrame ? "full-frame" : "layer-isolated",
  }
}

export interface DirtyRectPlanInput {
  rects: readonly DirtyRect[]
  bounds: CanvasBounds
  fullRedrawThreshold?: number
}

export interface DirtyRectPlan {
  rects: DirtyRect[]
  fullFrame: boolean
  unionRect: DirtyRect
  coverage: number
}

export function planDirtyRects(input: DirtyRectPlanInput): DirtyRectPlan {
  if (!input.rects.length) {
    return { rects: [], fullFrame: false, unionRect: emptyDirtyRect(), coverage: 0 }
  }
  const merged: DirtyRect[] = []
  for (const rect of input.rects) addDirtyRect(merged, rect, input.bounds)
  const unionRect = unionDirtyRects(merged)
  const coverage = dirtyCoverageRatio(unionRect, input.bounds)
  const threshold = input.fullRedrawThreshold ?? COALESCE_AREA_RATIO
  if (coverage >= threshold) {
    return { rects: [unionRect], fullFrame: true, unionRect, coverage }
  }
  return { rects: merged, fullFrame: false, unionRect, coverage }
}

export function rectFromPolygonBounds(points: ReadonlyArray<{ x: number; y: number }>, bounds?: CanvasBounds): DirtyRect {
  if (!points.length) return emptyDirtyRect()
  let minX = points[0].x
  let minY = points[0].y
  let maxX = points[0].x
  let maxY = points[0].y
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.x > maxX) maxX = point.x
    if (point.y < minY) minY = point.y
    if (point.y > maxY) maxY = point.y
  }
  return normalizeDirtyRect({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, bounds)
}
