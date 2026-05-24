import type {
  PathPoint,
  PathProps,
  ShapeAppearance,
  ShapeBooleanOperation,
  ShapeProps,
} from "./types"

export interface AnchorEditResult {
  path: PathProps
  index: number
  distance: number
}

const kappa = 0.5522847498

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function roundPoint(point: { x: number; y: number }): PathPoint {
  return { x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 }
}

function roundCoord(value: number) {
  return Math.round(value * 100) / 100
}

function roundedControl(point: { x: number; y: number }) {
  return { x: roundCoord(point.x), y: roundCoord(point.y) }
}

function cloneShapeForComponent(shape: ShapeProps): ShapeProps {
  const { components: _components, booleanOperation: _booleanOperation, ...rest } = shape
  return {
    ...rest,
    stroke: rest.stroke ? { ...rest.stroke } : null,
    cornerRadii: rest.cornerRadii ? [...rest.cornerRadii] as [number, number, number, number] : undefined,
    appearance: rest.appearance
      ? {
          fills: rest.appearance.fills.map((fill) => ({ ...fill })),
          strokes: rest.appearance.strokes.map((stroke) => ({ ...stroke, dash: stroke.dash ? [...stroke.dash] : undefined })),
        }
      : undefined,
  }
}

function projectPointToSegment(point: { x: number; y: number }, a: PathPoint, b: PathPoint) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq))
  const projected = { x: a.x + dx * t, y: a.y + dy * t }
  return { projected, t, distance: distance(point, projected) }
}

export function nearestAnchorPoint(path: PathProps, point: { x: number; y: number }) {
  let best = { index: -1, distance: Infinity }
  path.points.forEach((candidate, index) => {
    const d = distance(candidate, point)
    if (d < best.distance) best = { index, distance: d }
  })
  return best
}

export function addAnchorPointToPath(path: PathProps, point: { x: number; y: number }): AnchorEditResult {
  if (path.points.length < 2) {
    return { path: { ...path, points: [...path.points, roundPoint(point)] }, index: path.points.length, distance: 0 }
  }

  let best = { segmentIndex: 0, distance: Infinity, projected: roundPoint(point) }
  const segmentCount = path.closed ? path.points.length : path.points.length - 1
  for (let i = 0; i < segmentCount; i++) {
    const a = path.points[i]
    const b = path.points[(i + 1) % path.points.length]
    const projected = projectPointToSegment(point, a, b)
    if (projected.distance < best.distance) {
      best = { segmentIndex: i, distance: projected.distance, projected: roundPoint(projected.projected) }
    }
  }

  const insertIndex = best.segmentIndex + 1
  const points = [...path.points]
  points.splice(insertIndex, 0, best.projected)
  return { path: { ...path, points }, index: insertIndex, distance: best.distance }
}

export function deleteNearestAnchorPoint(path: PathProps, point: { x: number; y: number }, maxDistance = 24) {
  const nearest = nearestAnchorPoint(path, point)
  if (nearest.index < 0 || nearest.distance > maxDistance || path.points.length <= 2) {
    return { path, removedIndex: -1, distance: nearest.distance }
  }
  return {
    path: { ...path, points: path.points.filter((_, index) => index !== nearest.index) },
    removedIndex: nearest.index,
    distance: nearest.distance,
  }
}

export function convertAnchorPoint(path: PathProps, index: number): AnchorEditResult {
  if (index < 0 || index >= path.points.length) return { path, index: -1, distance: Infinity }
  const point = path.points[index]
  const points = path.points.slice()
  if (point.cp1 || point.cp2) {
    points[index] = { x: point.x, y: point.y }
    return { path: { ...path, points }, index, distance: 0 }
  }

  const prev = path.points[index - 1] ?? (path.closed ? path.points[path.points.length - 1] : point)
  const next = path.points[index + 1] ?? (path.closed ? path.points[0] : point)
  const vx = next.x - prev.x
  const vy = next.y - prev.y
  const len = Math.hypot(vx, vy) || 1
  const handle = Math.min(40, Math.max(12, len / 4))
  points[index] = {
    ...point,
    cp1: { x: Math.round((point.x - (vx / len) * handle) * 100) / 100, y: Math.round((point.y - (vy / len) * handle) * 100) / 100 },
    cp2: { x: Math.round((point.x + (vx / len) * handle) * 100) / 100, y: Math.round((point.y + (vy / len) * handle) * 100) / 100 },
  }
  return { path: { ...path, points }, index, distance: 0 }
}

export function normalizeCornerRadii(shape: ShapeProps): [number, number, number, number] {
  const maxRadius = Math.max(0, Math.min(Math.abs(shape.w) / 2, Math.abs(shape.h) / 2))
  const source = shape.cornerRadii ?? [shape.radius ?? 0, shape.radius ?? 0, shape.radius ?? 0, shape.radius ?? 0]
  return source.map((value) => roundCoord(Math.max(0, Math.min(maxRadius, Number(value) || 0)))) as [number, number, number, number]
}

export function movePathHandle(
  path: PathProps,
  index: number,
  handle: "in" | "out",
  point: { x: number; y: number },
  options: { mirror?: boolean } = {},
): PathProps {
  if (index < 0 || index >= path.points.length) return path
  const points = path.points.map((candidate) => ({
    ...candidate,
    cp1: candidate.cp1 ? { ...candidate.cp1 } : undefined,
    cp2: candidate.cp2 ? { ...candidate.cp2 } : undefined,
  }))
  const anchor = points[index]
  const rounded = roundedControl(point)
  if (handle === "in") {
    anchor.cp1 = rounded
    if (options.mirror) {
      anchor.cp2 = roundedControl({ x: anchor.x * 2 - rounded.x, y: anchor.y * 2 - rounded.y })
    }
  } else {
    anchor.cp2 = rounded
    if (options.mirror) {
      anchor.cp1 = roundedControl({ x: anchor.x * 2 - rounded.x, y: anchor.y * 2 - rounded.y })
    }
  }
  return { ...path, points }
}

export function nearestPathHandle(path: PathProps, point: { x: number; y: number }, maxDistance = 18) {
  let best: { index: number; handle: "anchor" | "in" | "out"; distance: number } = {
    index: -1,
    handle: "anchor",
    distance: Infinity,
  }
  path.points.forEach((candidate, index) => {
    const anchorDistance = distance(candidate, point)
    if (anchorDistance < best.distance) best = { index, handle: "anchor", distance: anchorDistance }
    if (candidate.cp1) {
      const cpDistance = distance(candidate.cp1, point)
      if (cpDistance < best.distance) best = { index, handle: "in", distance: cpDistance }
    }
    if (candidate.cp2) {
      const cpDistance = distance(candidate.cp2, point)
      if (cpDistance < best.distance) best = { index, handle: "out", distance: cpDistance }
    }
  })
  return best.distance <= maxDistance ? best : { index: -1, handle: "anchor" as const, distance: best.distance }
}

export function createDefaultShapeAppearance(shape: ShapeProps): ShapeAppearance {
  if (shape.appearance) {
    return {
      fills: shape.appearance.fills.map((fill) => ({ ...fill })),
      strokes: shape.appearance.strokes.map((stroke) => ({ ...stroke, dash: stroke.dash ? [...stroke.dash] : undefined })),
    }
  }
  return {
    fills: shape.fill
      ? [{ id: "fill-main", enabled: true, color: shape.fill, opacity: 1 }]
      : [],
    strokes: shape.stroke && shape.stroke.width > 0
      ? [{ id: "stroke-main", enabled: true, color: shape.stroke.color, width: shape.stroke.width, opacity: 1, alignment: "center" }]
      : [],
  }
}

export function applyShapeBooleanOperation(
  base: ShapeProps,
  operand: ShapeProps,
  operation: Exclude<ShapeBooleanOperation, "new">,
): ShapeProps {
  const components = base.components?.length
    ? base.components.map((component) => ({ id: component.id, operation: component.operation, shape: cloneShapeForComponent(component.shape) }))
    : [{ id: "component-base", operation: "unite" as const, shape: cloneShapeForComponent(base) }]
  components.push({
    id: `component-${operation}-${components.length + 1}`,
    operation,
    shape: cloneShapeForComponent(operand),
  })
  return {
    ...cloneShapeForComponent(base),
    components,
    booleanOperation: operation,
    appearance: createDefaultShapeAppearance(base),
  }
}

function applyVertexRoundness(points: PathPoint[], amount: number): PathPoint[] {
  const roundness = Math.max(0, Math.min(1, amount))
  if (roundness <= 0 || points.length < 3) return points
  return points.map((point, index) => {
    const prev = points[(index - 1 + points.length) % points.length]
    const next = points[(index + 1) % points.length]
    const vx = next.x - prev.x
    const vy = next.y - prev.y
    const len = Math.hypot(vx, vy) || 1
    const prevLen = distance(point, prev)
    const nextLen = distance(point, next)
    const handle = Math.min(prevLen, nextLen) * roundness * 0.22
    const ux = vx / len
    const uy = vy / len
    return {
      ...point,
      cp1: roundedControl({ x: point.x - ux * handle, y: point.y - uy * handle }),
      cp2: roundedControl({ x: point.x + ux * handle, y: point.y + uy * handle }),
    }
  })
}

function polygonLikePath(shape: ShapeProps): PathProps {
  const isStar = shape.type === "star"
  const count = Math.max(3, Math.round(shape.starPoints ?? shape.sides ?? (isStar ? 5 : 6)))
  const pointCount = isStar ? count * 2 : count
  const cx = shape.x + shape.w / 2
  const cy = shape.y + shape.h / 2
  const rx = Math.abs(shape.w) / 2
  const ry = Math.abs(shape.h) / 2
  const inner = Math.max(0.05, Math.min(0.95, shape.innerRadiusRatio ?? 0.5))
  const rotation = ((shape.rotation ?? 0) * Math.PI) / 180
  const points = Array.from({ length: pointCount }, (_, i) => {
    const ratio = isStar && i % 2 === 1 ? inner : 1
    const angle = -Math.PI / 2 + rotation + (Math.PI * 2 * i) / pointCount
    return roundPoint({ x: cx + Math.cos(angle) * rx * ratio, y: cy + Math.sin(angle) * ry * ratio })
  })
  return { closed: true, points: applyVertexRoundness(points, shape.vertexRoundness ?? 0) }
}

function roundedRectPath(shape: ShapeProps): PathProps {
  const x = shape.x
  const y = shape.y
  const w = shape.w
  const h = shape.h
  const [tl, tr, br, bl] = normalizeCornerRadii(shape)
  if (tl + tr + br + bl <= 0) {
    return {
      closed: true,
      points: [roundPoint({ x, y }), roundPoint({ x: x + w, y }), roundPoint({ x: x + w, y: y + h }), roundPoint({ x, y: y + h })],
    }
  }
  const ctl = tl * kappa
  const ctr = tr * kappa
  const cbr = br * kappa
  const cbl = bl * kappa
  const points: PathPoint[] = [
    { x: roundCoord(x + tl), y: roundCoord(y), ...(tl ? { cp1: roundedControl({ x: x + tl - ctl, y }) } : {}) },
    { x: roundCoord(x + w - tr), y: roundCoord(y), ...(tr ? { cp2: roundedControl({ x: x + w - tr + ctr, y }) } : {}) },
    { x: roundCoord(x + w), y: roundCoord(y + tr), ...(tr ? { cp1: roundedControl({ x: x + w, y: y + tr - ctr }) } : {}) },
    { x: roundCoord(x + w), y: roundCoord(y + h - br), ...(br ? { cp2: roundedControl({ x: x + w, y: y + h - br + cbr }) } : {}) },
    { x: roundCoord(x + w - br), y: roundCoord(y + h), ...(br ? { cp1: roundedControl({ x: x + w - br + cbr, y: y + h }) } : {}) },
    { x: roundCoord(x + bl), y: roundCoord(y + h), ...(bl ? { cp2: roundedControl({ x: x + bl - cbl, y: y + h }) } : {}) },
    { x: roundCoord(x), y: roundCoord(y + h - bl), ...(bl ? { cp1: roundedControl({ x, y: y + h - bl + cbl }) } : {}) },
    { x: roundCoord(x), y: roundCoord(y + tl), ...(tl ? { cp2: roundedControl({ x, y: y + tl - ctl }) } : {}) },
  ]
  return { closed: true, points }
}

export function shapeToEditablePath(shape: ShapeProps): PathProps {
  if (shape.components?.length) {
    const subpaths = shape.components.map((component) => shapeToEditablePath(component.shape))
    return { ...subpaths[0], subpaths }
  }
  const x = shape.x
  const y = shape.y
  const w = shape.w
  const h = shape.h
  if (shape.type === "ellipse") {
    const cx = x + w / 2
    const cy = y + h / 2
    const rx = Math.abs(w) / 2
    const ry = Math.abs(h) / 2
    return {
      closed: true,
      points: [
        { x: cx, y: cy - ry, cp1: { x: cx - rx * kappa, y: cy - ry }, cp2: { x: cx + rx * kappa, y: cy - ry } },
        { x: cx + rx, y: cy, cp1: { x: cx + rx, y: cy - ry * kappa }, cp2: { x: cx + rx, y: cy + ry * kappa } },
        { x: cx, y: cy + ry, cp1: { x: cx + rx * kappa, y: cy + ry }, cp2: { x: cx - rx * kappa, y: cy + ry } },
        { x: cx - rx, y: cy, cp1: { x: cx - rx, y: cy + ry * kappa }, cp2: { x: cx - rx, y: cy - ry * kappa } },
      ],
    }
  }
  if (shape.type === "polygon" || shape.type === "star") {
    return polygonLikePath(shape)
  }

  return roundedRectPath(shape)
}

export function appendPathToCanvas(ctx: CanvasRenderingContext2D, path: PathProps) {
  const drawSingle = (single: PathProps) => {
    if (!single.points.length) return
    const p0 = single.points[0]
    ctx.moveTo(p0.x, p0.y)
    for (let i = 1; i < single.points.length; i++) {
      const prev = single.points[i - 1]
      const current = single.points[i]
      if (prev.cp2 || current.cp1) {
        const c1 = prev.cp2 ?? prev
        const c2 = current.cp1 ?? current
        ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, current.x, current.y)
      } else {
        ctx.lineTo(current.x, current.y)
      }
    }
    if (single.closed) {
      const last = single.points[single.points.length - 1]
      const first = single.points[0]
      if (last.cp2 || first.cp1) {
        const c1 = last.cp2 ?? last
        const c2 = first.cp1 ?? first
        ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, first.x, first.y)
      }
      ctx.closePath()
    }
  }
  drawSingle(path)
  for (const subpath of path.subpaths ?? []) drawSingle(subpath)
}

export function exportPathToSvgPath(path: PathProps) {
  if (!path.points.length) return ""
  const commands: string[] = [`M ${path.points[0].x} ${path.points[0].y}`]
  for (let i = 1; i < path.points.length; i++) {
    const prev = path.points[i - 1]
    const current = path.points[i]
    if (prev.cp2 || current.cp1) {
      const c1 = prev.cp2 ?? prev
      const c2 = current.cp1 ?? current
      commands.push(`C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${current.x} ${current.y}`)
    } else {
      commands.push(`L ${current.x} ${current.y}`)
    }
  }
  if (path.closed) {
    const last = path.points[path.points.length - 1]
    const first = path.points[0]
    if (last.cp2 || first.cp1) {
      const c1 = last.cp2 ?? last
      const c2 = first.cp1 ?? first
      commands.push(`C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${first.x} ${first.y}`)
    }
    commands.push("Z")
  }
  return commands.join(" ")
}
