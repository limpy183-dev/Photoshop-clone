import type { PathPoint, PathProps, ShapeProps } from "./types"

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

export function shapeToEditablePath(shape: ShapeProps): PathProps {
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
  if (shape.type === "polygon") {
    const sides = Math.max(3, Math.round(shape.sides ?? 5))
    const cx = x + w / 2
    const cy = y + h / 2
    const rx = Math.abs(w) / 2
    const ry = Math.abs(h) / 2
    return {
      closed: true,
      points: Array.from({ length: sides }, (_, i) => {
        const angle = -Math.PI / 2 + (Math.PI * 2 * i) / sides
        return roundPoint({ x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry })
      }),
    }
  }

  const radius = Math.max(0, Math.min(Math.abs(shape.radius ?? 0), Math.abs(w) / 2, Math.abs(h) / 2))
  if (!radius) {
    return {
      closed: true,
      points: [roundPoint({ x, y }), roundPoint({ x: x + w, y }), roundPoint({ x: x + w, y: y + h }), roundPoint({ x, y: y + h })],
    }
  }
  const c = radius * kappa
  return {
    closed: true,
    points: [
      { x: x + radius, y, cp1: { x: x + radius - c, y }, cp2: { x: x + radius + c, y } },
      { x: x + w - radius, y, cp1: { x: x + w - radius - c, y }, cp2: { x: x + w - radius + c, y } },
      { x: x + w, y: y + radius, cp1: { x: x + w, y: y + radius - c }, cp2: { x: x + w, y: y + radius + c } },
      { x: x + w, y: y + h - radius, cp1: { x: x + w, y: y + h - radius - c }, cp2: { x: x + w, y: y + h - radius + c } },
      { x: x + w - radius, y: y + h, cp1: { x: x + w - radius + c, y: y + h }, cp2: { x: x + w - radius - c, y: y + h } },
      { x: x + radius, y: y + h, cp1: { x: x + radius + c, y: y + h }, cp2: { x: x + radius - c, y: y + h } },
      { x, y: y + h - radius, cp1: { x, y: y + h - radius + c }, cp2: { x, y: y + h - radius - c } },
      { x, y: y + radius, cp1: { x, y: y + radius + c }, cp2: { x, y: y + radius - c } },
    ],
  }
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
