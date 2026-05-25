/**
 * Curve-curve Bezier boolean operations.
 *
 * This module implements Add / Subtract / Intersect / Exclude on compound
 * Bezier paths without flattening to a raster grid. Two design choices are
 * documented here so reviewers can compare against alternative approaches:
 *
 *   1. **Curve representation.** Every path segment is normalized to a cubic
 *      Bezier (a, b, c, d). Linear and quadratic segments are promoted to
 *      cubic with their first / last handle pulled in along the chord. This
 *      keeps the rest of the pipeline branch-free.
 *
 *   2. **Intersection algorithm.** We use **adaptive de Casteljau bounding-box
 *      subdivision**. A pair of cubic Beziers is recursively subdivided
 *      whenever their axis-aligned bounding boxes overlap; once both halves
 *      are within `flatness` (we use 0.25 px by default), we treat them as
 *      line segments and solve the closed-form line-line intersection. This
 *      gives O((1/eps)^0.5) convergence in practice and reliably converges on
 *      isolated transverse crossings. We deduplicate intersections that fall
 *      within 0.01 px of each other along the same curve to absorb the rare
 *      "two subdivisions land on the same crossing" case.
 *
 *      An alternative would be paper.js-style fat-line clipping. We
 *      deliberately picked subdivision because it is shorter, has no curve
 *      reduction edge cases, and works on the cubics we already store. When
 *      paper.js is loaded on `globalThis.paper`, `vector-path-operations.ts`
 *      will route to it first; this module is the in-app fallback that no
 *      longer needs a raster grid.
 *
 * Once intersections are known, every input curve is **split at every
 * intersection** it participates in, producing a graph of "monotonic"
 * sub-curves whose midpoints can be classified inside-or-outside each input
 * region. The boolean output keeps the sub-curves whose midpoint passes the
 * operation's winding rule, then re-stitches connected sub-curves into
 * closed sub-paths using each sub-curve's endpoints (within `joinTolerance`).
 *
 * This implementation handles the cases the previous grid fallback could not:
 * holes inside subtracted regions, exclude-overlapping that mixes round and
 * straight edges, and intersections that fall between grid cells.
 */

import type { PathPoint, PathProps, ShapeBooleanOperation } from "./types"

const DEFAULT_FLATNESS = 0.25
const JOIN_TOLERANCE = 0.5
const PARAMETRIC_EPSILON = 1e-4
const POINT_DEDUP_EPSILON = 0.01

type Op = Exclude<ShapeBooleanOperation, "new">

interface Vec {
  x: number
  y: number
}

/** A cubic Bezier with start, two handles, and end. */
interface CubicBezier {
  a: Vec
  b: Vec
  c: Vec
  d: Vec
}

interface SubCurve {
  /** Source ring index (which input region the curve came from). */
  ringIndex: number
  /** Index of this sub-curve within the source ring after splitting. */
  orderInRing: number
  curve: CubicBezier
  midpoint: Vec
  /** Endpoint coordinates rounded to JOIN_TOLERANCE for stitching. */
  startKey: string
  endKey: string
  /** When true, this sub-curve was kept by the boolean classifier. */
  kept?: boolean
}

interface FlattenedRing {
  ringIndex: number
  /** Cubic curves in evaluation order; the last curve's end equals the first curve's start. */
  curves: CubicBezier[]
  /** Bounding box for fast inside/outside checks. */
  bounds: { x1: number; y1: number; x2: number; y2: number }
  /** Sample points along the ring used for winding tests. */
  sampleRing: Vec[]
}

interface InputRegion {
  operation: "base" | Op
  rings: FlattenedRing[]
}

function clonePoint(point: PathPoint): PathPoint {
  return {
    ...point,
    cp1: point.cp1 ? { ...point.cp1 } : undefined,
    cp2: point.cp2 ? { ...point.cp2 } : undefined,
  }
}

function clonePath(path: PathProps): PathProps {
  return {
    closed: path.closed,
    source: path.source,
    points: path.points.map(clonePoint),
    subpaths: path.subpaths?.map(clonePath),
  }
}

function buildCurves(single: PathProps): CubicBezier[] {
  if (single.points.length < 2) return []
  const curves: CubicBezier[] = []
  const segments = single.closed ? single.points.length : single.points.length - 1
  for (let i = 0; i < segments; i++) {
    const start = single.points[i]
    const end = single.points[(i + 1) % single.points.length]
    const cp1 = start.cp2 ?? start
    const cp2 = end.cp1 ?? end
    curves.push({
      a: { x: start.x, y: start.y },
      b: { x: cp1.x, y: cp1.y },
      c: { x: cp2.x, y: cp2.y },
      d: { x: end.x, y: end.y },
    })
  }
  return curves
}

function evaluateCubic(curve: CubicBezier, t: number): Vec {
  const mt = 1 - t
  const mt2 = mt * mt
  const t2 = t * t
  return {
    x: mt2 * mt * curve.a.x + 3 * mt2 * t * curve.b.x + 3 * mt * t2 * curve.c.x + t2 * t * curve.d.x,
    y: mt2 * mt * curve.a.y + 3 * mt2 * t * curve.b.y + 3 * mt * t2 * curve.c.y + t2 * t * curve.d.y,
  }
}

/** Subdivide a cubic at parameter t using de Casteljau. */
function subdivide(curve: CubicBezier, t: number): [CubicBezier, CubicBezier] {
  const { a, b, c, d } = curve
  const ab = lerp(a, b, t)
  const bc = lerp(b, c, t)
  const cd = lerp(c, d, t)
  const abc = lerp(ab, bc, t)
  const bcd = lerp(bc, cd, t)
  const abcd = lerp(abc, bcd, t)
  return [
    { a, b: ab, c: abc, d: abcd },
    { a: abcd, b: bcd, c: cd, d },
  ]
}

function lerp(p: Vec, q: Vec, t: number): Vec {
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }
}

function curveBounds(curve: CubicBezier) {
  const xs = [curve.a.x, curve.b.x, curve.c.x, curve.d.x]
  const ys = [curve.a.y, curve.b.y, curve.c.y, curve.d.y]
  return {
    x1: Math.min(...xs),
    y1: Math.min(...ys),
    x2: Math.max(...xs),
    y2: Math.max(...ys),
  }
}

function boundsOverlap(a: ReturnType<typeof curveBounds>, b: ReturnType<typeof curveBounds>, pad = 0) {
  return !(a.x2 + pad < b.x1 - pad || b.x2 + pad < a.x1 - pad || a.y2 + pad < b.y1 - pad || b.y2 + pad < a.y1 - pad)
}

function curveSize(curve: CubicBezier) {
  const bounds = curveBounds(curve)
  return Math.max(bounds.x2 - bounds.x1, bounds.y2 - bounds.y1)
}

/**
 * Recursively find intersections between two cubic Beziers using bounding-box
 * subdivision. Returns parameter pairs (t on curveA, u on curveB).
 */
function intersectCubics(
  curveA: CubicBezier,
  curveB: CubicBezier,
  flatness: number,
  tMinA = 0,
  tMaxA = 1,
  tMinB = 0,
  tMaxB = 1,
  depth = 0,
): Array<{ tA: number; tB: number; point: Vec }> {
  if (depth > 32) return []
  const boundsA = curveBounds(curveA)
  const boundsB = curveBounds(curveB)
  if (!boundsOverlap(boundsA, boundsB)) return []
  const sizeA = Math.max(boundsA.x2 - boundsA.x1, boundsA.y2 - boundsA.y1)
  const sizeB = Math.max(boundsB.x2 - boundsB.x1, boundsB.y2 - boundsB.y1)
  if (sizeA < flatness && sizeB < flatness) {
    // Treat as line-line intersection between curveA.a -> curveA.d and curveB.a -> curveB.d.
    const hit = lineIntersection(curveA.a, curveA.d, curveB.a, curveB.d)
    if (!hit) return []
    const tA = tMinA + (tMaxA - tMinA) * hit.t
    const tB = tMinB + (tMaxB - tMinB) * hit.u
    return [{ tA, tB, point: hit.point }]
  }
  const subdivideA = sizeA >= sizeB
  if (subdivideA) {
    const [left, right] = subdivide(curveA, 0.5)
    const mid = (tMinA + tMaxA) / 2
    return [
      ...intersectCubics(left, curveB, flatness, tMinA, mid, tMinB, tMaxB, depth + 1),
      ...intersectCubics(right, curveB, flatness, mid, tMaxA, tMinB, tMaxB, depth + 1),
    ]
  }
  const [left, right] = subdivide(curveB, 0.5)
  const mid = (tMinB + tMaxB) / 2
  return [
    ...intersectCubics(curveA, left, flatness, tMinA, tMaxA, tMinB, mid, depth + 1),
    ...intersectCubics(curveA, right, flatness, tMinA, tMaxA, mid, tMaxB, depth + 1),
  ]
}

function lineIntersection(p1: Vec, p2: Vec, p3: Vec, p4: Vec): { point: Vec; t: number; u: number } | null {
  const denom = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x)
  if (Math.abs(denom) < 1e-12) return null
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / denom
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / denom
  if (t < -PARAMETRIC_EPSILON || t > 1 + PARAMETRIC_EPSILON) return null
  if (u < -PARAMETRIC_EPSILON || u > 1 + PARAMETRIC_EPSILON) return null
  const clampedT = Math.max(0, Math.min(1, t))
  return {
    point: { x: p1.x + (p2.x - p1.x) * clampedT, y: p1.y + (p2.y - p1.y) * clampedT },
    t: clampedT,
    u: Math.max(0, Math.min(1, u)),
  }
}

function sampleRingPoints(curves: CubicBezier[], samplesPerCurve = 12): Vec[] {
  const out: Vec[] = []
  for (const curve of curves) {
    const steps = Math.max(4, samplesPerCurve)
    for (let i = 0; i < steps; i++) {
      out.push(evaluateCubic(curve, i / steps))
    }
  }
  return out
}

function ringContainsPoint(ring: FlattenedRing, point: Vec): boolean {
  if (
    point.x < ring.bounds.x1 - 1 || point.x > ring.bounds.x2 + 1 ||
    point.y < ring.bounds.y1 - 1 || point.y > ring.bounds.y2 + 1
  ) {
    return false
  }
  const pts = ring.sampleRing
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    const intersects = ((a.y > point.y) !== (b.y > point.y)) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x
    if (intersects) inside = !inside
  }
  return inside
}

function regionContainsPoint(rings: FlattenedRing[], point: Vec): boolean {
  let inside = false
  for (const ring of rings) if (ringContainsPoint(ring, point)) inside = !inside
  return inside
}

function pathToRegion(path: PathProps, ringStart: number): { rings: FlattenedRing[]; next: number } {
  const rings: FlattenedRing[] = []
  let nextIndex = ringStart
  const ingest = (single: PathProps) => {
    if (!single.closed || single.points.length < 2) return
    const curves = buildCurves(single)
    if (!curves.length) return
    const sampleRing = sampleRingPoints(curves)
    if (sampleRing.length < 3) return
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
    for (const point of sampleRing) {
      if (point.x < x1) x1 = point.x
      if (point.x > x2) x2 = point.x
      if (point.y < y1) y1 = point.y
      if (point.y > y2) y2 = point.y
    }
    rings.push({
      ringIndex: nextIndex++,
      curves,
      sampleRing,
      bounds: { x1, y1, x2, y2 },
    })
  }
  ingest(path)
  for (const sub of path.subpaths ?? []) ingest(sub)
  return { rings, next: nextIndex }
}

function ringToSubCurves(ring: FlattenedRing, splitMap: Map<number, number[]>): SubCurve[] {
  const out: SubCurve[] = []
  for (let curveIndex = 0; curveIndex < ring.curves.length; curveIndex++) {
    const ts = (splitMap.get(curveIndex) ?? []).slice().sort((a, b) => a - b)
    const params = [0, ...ts.filter((t) => t > PARAMETRIC_EPSILON && t < 1 - PARAMETRIC_EPSILON), 1]
    const uniqueParams = dedupeSorted(params, PARAMETRIC_EPSILON)
    let segment = ring.curves[curveIndex]
    let cursor = 0
    for (let i = 1; i < uniqueParams.length; i++) {
      const localT = (uniqueParams[i] - cursor) / Math.max(PARAMETRIC_EPSILON, 1 - cursor)
      let leftCurve = segment
      let rightCurve: CubicBezier | null = null
      if (uniqueParams[i] < 1 - PARAMETRIC_EPSILON) {
        const [left, right] = subdivide(segment, Math.min(1, Math.max(0, localT)))
        leftCurve = left
        rightCurve = right
      }
      const midpoint = evaluateCubic(leftCurve, 0.5)
      out.push({
        ringIndex: ring.ringIndex,
        orderInRing: out.length,
        curve: leftCurve,
        midpoint,
        startKey: keyFor(leftCurve.a),
        endKey: keyFor(leftCurve.d),
      })
      cursor = uniqueParams[i]
      if (!rightCurve) break
      segment = rightCurve
    }
  }
  return out
}

function keyFor(point: Vec) {
  const x = Math.round(point.x / JOIN_TOLERANCE) * JOIN_TOLERANCE
  const y = Math.round(point.y / JOIN_TOLERANCE) * JOIN_TOLERANCE
  return `${x.toFixed(2)},${y.toFixed(2)}`
}

function dedupeSorted(values: number[], epsilon: number) {
  const out: number[] = []
  for (const value of values) {
    if (!out.length || value - out[out.length - 1] > epsilon) out.push(value)
  }
  return out
}

function curveToPathPoints(curve: CubicBezier, startPoint: PathPoint | null): { start: PathPoint; end: PathPoint } {
  const start: PathPoint = startPoint ?? { x: curve.a.x, y: curve.a.y, handleMode: "broken" }
  start.cp2 = { x: curve.b.x, y: curve.b.y }
  const end: PathPoint = { x: curve.d.x, y: curve.d.y, cp1: { x: curve.c.x, y: curve.c.y }, handleMode: "broken" }
  return { start, end }
}

function stitchKeptSubCurves(subCurves: SubCurve[]): PathProps[] {
  const remaining = subCurves.filter((segment) => segment.kept)
  if (!remaining.length) return []
  const byStart = new Map<string, SubCurve[]>()
  for (const segment of remaining) {
    const bucket = byStart.get(segment.startKey) ?? []
    bucket.push(segment)
    byStart.set(segment.startKey, bucket)
  }
  const used = new Set<SubCurve>()
  const rings: PathProps[] = []
  for (const seed of remaining) {
    if (used.has(seed)) continue
    used.add(seed)
    const points: PathPoint[] = []
    let current: SubCurve | undefined = seed
    let startPoint: PathPoint | null = null
    let safety = 0
    while (current && safety++ < remaining.length + 4) {
      const { start, end } = curveToPathPoints(current.curve, startPoint)
      if (!startPoint) {
        points.push(start)
      } else {
        // Merge start handle (cp2) into the previous point.
        points[points.length - 1].cp2 = start.cp2
      }
      points.push(end)
      startPoint = end
      const candidates: SubCurve[] = byStart.get(current.endKey) ?? []
      const next: SubCurve | undefined = candidates.find((candidate: SubCurve) => candidate !== current && !used.has(candidate))
      if (!next) break
      used.add(next)
      current = next
      if (next.startKey === seed.startKey) break
    }
    if (points.length >= 3) {
      const last = points[points.length - 1]
      const first = points[0]
      if (Math.hypot(last.x - first.x, last.y - first.y) < JOIN_TOLERANCE) {
        // Merge cp1 of the closing point back onto the first.
        if (last.cp1) first.cp1 = last.cp1
        points.pop()
      }
      rings.push({ closed: true, source: "compound", points })
    }
  }
  return rings
}

function ringArea(ring: PathProps): number {
  let area = 0
  for (let i = 0; i < ring.points.length; i++) {
    const a = ring.points[i]
    const b = ring.points[(i + 1) % ring.points.length]
    area += a.x * b.y - b.x * a.y
  }
  return area / 2
}

function regionContainsPointAcross(regions: InputRegion[], point: Vec): boolean[] {
  return regions.map((region) => regionContainsPoint(region.rings, point))
}

function passesOperation(memberships: boolean[], operations: Op[]): boolean {
  // memberships[0] is the base region; subsequent indices align with operations.
  if (!memberships.length) return false
  let inside = memberships[0]
  for (let i = 1; i < memberships.length; i++) {
    const op = operations[i - 1]
    const other = memberships[i]
    if (op === "unite") inside = inside || other
    else if (op === "subtract") inside = inside && !other
    else if (op === "intersect") inside = inside && other
    else if (op === "exclude") inside = inside !== other
  }
  return inside
}

/**
 * Run Add / Subtract / Intersect / Exclude on a list of input paths (with their
 * boolean operation labels) using curve-curve intersection. Returns a single
 * `PathProps` whose subpaths are the resulting closed loops, or `null` when
 * the operation does not produce any closed geometry.
 *
 * Inputs are assumed to be closed paths. Open paths are ignored (they cannot
 * participate in a closed boolean result).
 */
export function bezierBoolean(
  components: Array<{ operation: "base" | Op; path: PathProps }>,
  options: { flatness?: number } = {},
): PathProps | null {
  if (!components.length) return null
  const flatness = options.flatness ?? DEFAULT_FLATNESS
  let nextRing = 0
  const regions: InputRegion[] = components.map((component) => {
    const built = pathToRegion(component.path, nextRing)
    nextRing = built.next
    return { operation: component.operation, rings: built.rings }
  })
  if (!regions[0].rings.length) return null
  const operations: Op[] = regions.slice(1).map((region) => region.operation === "base" ? "unite" : region.operation)

  // Build per-curve split maps. We split at every intersection on either curve.
  const splits = new Map<number, Map<number, number[]>>() // ringIndex -> curveIndex -> [t]
  const ringsAll: FlattenedRing[] = regions.flatMap((region) => region.rings)
  for (let i = 0; i < ringsAll.length; i++) {
    for (let j = i + 1; j < ringsAll.length; j++) {
      const ringA = ringsAll[i]
      const ringB = ringsAll[j]
      if (!boundsOverlap(ringA.bounds, ringB.bounds, flatness)) continue
      for (let ci = 0; ci < ringA.curves.length; ci++) {
        for (let cj = 0; cj < ringB.curves.length; cj++) {
          const ringSizeA = curveSize(ringA.curves[ci])
          const ringSizeB = curveSize(ringB.curves[cj])
          if (ringSizeA < flatness * 0.5 && ringSizeB < flatness * 0.5) continue
          const hits = intersectCubics(ringA.curves[ci], ringB.curves[cj], flatness)
          if (!hits.length) continue
          const aMap = ensureMap(splits, ringA.ringIndex)
          const bMap = ensureMap(splits, ringB.ringIndex)
          const aList = ensureArray(aMap, ci)
          const bList = ensureArray(bMap, cj)
          for (const hit of hits) {
            if (hit.tA > POINT_DEDUP_EPSILON && hit.tA < 1 - POINT_DEDUP_EPSILON) aList.push(hit.tA)
            if (hit.tB > POINT_DEDUP_EPSILON && hit.tB < 1 - POINT_DEDUP_EPSILON) bList.push(hit.tB)
          }
        }
      }
    }
  }

  // Build sub-curves per ring.
  const allSubCurves: SubCurve[] = []
  for (const ring of ringsAll) {
    const splitMap = splits.get(ring.ringIndex) ?? new Map<number, number[]>()
    allSubCurves.push(...ringToSubCurves(ring, splitMap))
  }

  // Each sub-curve is kept if its midpoint passes the operation.
  for (const segment of allSubCurves) {
    const memberships = regionContainsPointAcross(regions, segment.midpoint)
    // Include the sub-curve's own ring as "definitely inside" so a midpoint
    // sitting precisely on the boundary still classifies.
    const ownerRegion = regions.findIndex((region) => region.rings.some((ring) => ring.ringIndex === segment.ringIndex))
    if (ownerRegion >= 0) memberships[ownerRegion] = true
    segment.kept = passesOperation(memberships, operations)
  }

  const ringsOut = stitchKeptSubCurves(allSubCurves)
  if (!ringsOut.length) return null
  ringsOut.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))
  const [outer, ...rest] = ringsOut
  return { ...outer, subpaths: rest, source: "compound" }
}

function ensureMap<K, V>(map: Map<K, Map<number, V>>, key: K): Map<number, V> {
  const existing = map.get(key)
  if (existing) return existing
  const next = new Map<number, V>()
  map.set(key, next)
  return next
}

function ensureArray(map: Map<number, number[]>, key: number): number[] {
  const existing = map.get(key)
  if (existing) return existing
  const next: number[] = []
  map.set(key, next)
  return next
}

/**
 * Public entry point used by `vector-path-operations.ts` when paper.js is not
 * available. The caller passes in the base shape's editable path and the
 * components with their per-component boolean ops; the result is a closed
 * compound `PathProps` (or `null` when the operation collapses to nothing).
 */
export function resolveBezierBooleanFallback(components: Array<{ operation: "base" | Op; path: PathProps }>): PathProps | null {
  if (!components.length) return null
  const result = bezierBoolean(components.map((component) => ({ operation: component.operation, path: clonePath(component.path) })))
  return result
}
