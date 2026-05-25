import { planBrushStroke, type BrushPointerSample, type BrushStamp } from "./brush-engine"
import type { BrushSettings, PathPoint, PathProps } from "./types"

export type StrokePathPressureProfile = "constant" | "taper-start" | "taper-end" | "taper-both"

export interface StrokePathBrushOptions {
  pressureProfile?: StrokePathPressureProfile
  samplesPerSegment?: number
  seed?: number
  velocityAffectsSpacing?: boolean
}

export function planStrokePathBrushSamples(
  path: PathProps,
  brush: BrushSettings,
  options: StrokePathBrushOptions = {},
): BrushStamp[] {
  const allPaths = [path, ...(path.subpaths ?? [])]
  const stamps: BrushStamp[] = []
  let seed = options.seed ?? 1
  for (const single of allPaths) {
    const samples = samplePath(single, options)
    if (samples.length < 1) continue
    stamps.push(...planBrushStroke(brush, samples, {
      seed: seed++,
      velocityAffectsSpacing: options.velocityAffectsSpacing ?? true,
      velocityReference: 900,
      velocitySpacingScale: 0.45,
    }))
  }
  return stamps
}

export function strokePathWithBrushDynamics(
  ctx: CanvasRenderingContext2D,
  path: PathProps,
  brush: BrushSettings,
  color: string,
  options: StrokePathBrushOptions = {},
) {
  const stamps = planStrokePathBrushSamples(path, brush, options)
  if (!stamps.length) return
  ctx.save()
  ctx.fillStyle = color
  for (const stamp of stamps) {
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, stamp.opacity * Math.max(0.05, stamp.flow)))
    ctx.translate(stamp.x, stamp.y)
    ctx.rotate(stamp.angle)
    const rx = stamp.size / 2
    const ry = Math.max(0.5, rx * stamp.roundness)
    if (brush.tipShape === "square") {
      ctx.fillRect(-rx, -ry, rx * 2, ry * 2)
    } else {
      ctx.beginPath()
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
  ctx.restore()
}

function samplePath(path: PathProps, options: StrokePathBrushOptions): BrushPointerSample[] {
  if (path.points.length < 2) return []
  const segments = path.closed ? path.points.length : path.points.length - 1
  const samplesPerSegment = Math.max(2, Math.min(96, Math.round(options.samplesPerSegment ?? 16)))
  const raw: Array<{ x: number; y: number }> = []
  for (let segment = 0; segment < segments; segment++) {
    for (let sample = segment === 0 ? 0 : 1; sample <= samplesPerSegment; sample++) {
      raw.push(segmentPoint(path, segment, sample / samplesPerSegment))
    }
  }
  const total = Math.max(1, raw.length - 1)
  return raw.map((point, index) => {
    const previous = raw[index - 1] ?? point
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y)
    return {
      x: point.x,
      y: point.y,
      time: index * 16,
      pressure: pressureAt(index / total, options.pressureProfile ?? "constant"),
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      velocity: distance > 0 ? (distance / 16) * 1000 : 0,
      pointerType: "pen",
    }
  })
}

function pressureAt(t: number, profile: StrokePathPressureProfile) {
  if (profile === "taper-start") return Math.max(0.05, t)
  if (profile === "taper-end") return Math.max(0.05, 1 - t)
  if (profile === "taper-both") return Math.max(0.05, Math.sin(Math.PI * t))
  return 1
}

function cubicPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
) {
  const mt = 1 - t
  const mt2 = mt * mt
  const t2 = t * t
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
  }
}

function segmentPoint(path: PathProps, segmentIndex: number, t: number) {
  const current = path.points[segmentIndex] as PathPoint
  const next = path.points[(segmentIndex + 1) % path.points.length] as PathPoint
  const c1 = current.cp2 ?? current
  const c2 = next.cp1 ?? next
  if (current.cp2 || next.cp1) return cubicPoint(current, c1, c2, next, t)
  return {
    x: current.x + (next.x - current.x) * t,
    y: current.y + (next.y - current.y) * t,
  }
}
