export type TransformHandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate" | "move"

export interface TransformDragState {
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

export type TransformReferencePoint = "tl" | "tc" | "tr" | "ml" | "mc" | "mr" | "bl" | "bc" | "br"
export type TransformInterpolation = "nearest" | "bilinear" | "bicubic" | "bicubic-smoother" | "bicubic-sharper"

export interface TransformOptionsEvent {
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

export function finiteOr(value: unknown, fallback: number) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function clampTransformSkew(value: number) {
  return Math.max(-89, Math.min(89, value))
}

export function transformOrigin(t: TransformDragState) {
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

export function applyTransformContext(ctx: CanvasRenderingContext2D, t: TransformDragState) {
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

export function transformPoint(t: TransformDragState, point: { x: number; y: number }) {
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

export function transformedBounds(t: TransformDragState) {
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

export function transformCorners(t: TransformDragState): { x: number; y: number }[] {
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

export function transformHandles(t: TransformDragState): { x: number; y: number; id: TransformHandleId }[] {
  const c = transformCorners(t)
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const top = mid(c[0], c[1])
  const right = mid(c[1], c[2])
  const bottom = mid(c[2], c[3])
  const left = mid(c[3], c[0])
  const _center = mid(c[0], c[2])
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

export function pickTransformHandle(p: { x: number; y: number }, t: TransformDragState): TransformHandleId | null {
  const handles = transformHandles(t)
  for (const h of handles) {
    if (Math.abs(p.x - h.x) < 8 && Math.abs(p.y - h.y) < 8) return h.id
  }
  return null
}

export function pointInTransformBox(p: { x: number; y: number }, t: TransformDragState) {
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
