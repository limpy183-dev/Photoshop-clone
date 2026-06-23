import type {
  PathHandleMode,
  PathPoint,
  PathProps,
  ShapeAppearance,
  ShapeBooleanOperation,
  ShapeProps,
} from "./types"
import { resolveBezierBooleanFallback } from "./vector-bezier-boolean"

export interface AnchorEditResult {
  path: PathProps
  index: number
  distance: number
}

export type RoundedRectCorner = "tl" | "tr" | "br" | "bl"

export interface RoundedRectCornerRadiusHandle {
  corner: RoundedRectCorner
  x: number
  y: number
  radius: number
}

export type PathControlHit =
  | { kind: "anchor"; subpathIndex: number; pointIndex: number; distance: number }
  | { kind: "handle"; subpathIndex: number; pointIndex: number; handle: "in" | "out"; distance: number }
  | { kind: "segment"; subpathIndex: number; segmentIndex: number; distance: number; t: number; point: { x: number; y: number } }

export interface PathHitTestOptions {
  maxAnchorDistance?: number
  maxHandleDistance?: number
  maxSegmentDistance?: number
  segmentSamples?: number
}

export interface BooleanResolveOptions {
  tolerance?: number
  maxGridCells?: number
}

export interface FreeformFitOptions {
  tolerance?: number
  smoothness?: number
  closed?: boolean
}

export interface PathAffineTransform {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export interface PathAnchorRef {
  subpathIndex: number
  pointIndex: number
}

const kappa = 0.5522847498

interface PaperPointLike {
  x: number
  y: number
}

interface PaperSegmentLike {
  point: PaperPointLike
  handleIn: PaperPointLike
  handleOut: PaperPointLike
}

interface PaperBooleanItemLike {
  unite(operand: PaperBooleanItemLike, options: { insert: boolean }): PaperBooleanItemLike
  subtract(operand: PaperBooleanItemLike, options: { insert: boolean }): PaperBooleanItemLike
  intersect(operand: PaperBooleanItemLike, options: { insert: boolean }): PaperBooleanItemLike
  exclude(operand: PaperBooleanItemLike, options: { insert: boolean }): PaperBooleanItemLike
}

interface PaperPathLike extends PaperBooleanItemLike {
  className?: string
  closed: boolean
  segments: PaperSegmentLike[]
  add(segment: unknown): void
}

interface PaperCompoundPathLike extends PaperBooleanItemLike {
  className?: string
  children: unknown[]
  addChild(child: PaperPathLike): void
}

interface PaperScopeLike {
  Point: new (x: number, y: number) => PaperPointLike
  Segment: new (point: PaperPointLike, handleIn: PaperPointLike, handleOut: PaperPointLike) => unknown
  Size: new (width: number, height: number) => unknown
  Path: new (options: { insert: boolean }) => PaperPathLike
  CompoundPath: new (options: { insert: boolean }) => PaperCompoundPathLike
  project: { remove(): void }
  setup(size: unknown): void
}

type PaperModule = {
  PaperScope: new () => PaperScopeLike
  Path: new (...args: unknown[]) => PaperPathLike
  CompoundPath: new (...args: unknown[]) => PaperCompoundPathLike
}

function getPaperModule(): PaperModule | null {
  const candidate = (globalThis as { paper?: PaperModule }).paper
  return candidate?.PaperScope && candidate?.Path && candidate?.CompoundPath ? candidate : null
}

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

function clonePath(path: PathProps): PathProps {
  return {
    closed: path.closed,
    points: path.points.map((point) => ({
      ...point,
      cp1: point.cp1 ? { ...point.cp1 } : undefined,
      cp2: point.cp2 ? { ...point.cp2 } : undefined,
    })),
    subpaths: path.subpaths?.map(clonePath),
  }
}

function transformPoint(point: { x: number; y: number }, matrix: PathAffineTransform) {
  return roundedControl({
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  })
}

export function transformPath(path: PathProps, matrix: PathAffineTransform): PathProps {
  return {
    ...path,
    points: path.points.map((point) => ({
      ...point,
      ...transformPoint(point, matrix),
      cp1: point.cp1 ? transformPoint(point.cp1, matrix) : undefined,
      cp2: point.cp2 ? transformPoint(point.cp2, matrix) : undefined,
    })),
    subpaths: path.subpaths?.map((subpath) => transformPath(subpath, matrix)),
  }
}

function transformPathBetweenRects(
  path: PathProps,
  from: { x: number; y: number; w: number; h: number },
  to: { x: number; y: number; w: number; h: number },
) {
  const scaleX = Math.abs(from.w) > 0 ? to.w / from.w : 1
  const scaleY = Math.abs(from.h) > 0 ? to.h / from.h : 1
  return transformPath(path, {
    a: scaleX,
    b: 0,
    c: 0,
    d: scaleY,
    e: to.x - from.x * scaleX,
    f: to.y - from.y * scaleY,
  })
}

function cloneShapeForComponent(shape: ShapeProps): ShapeProps {
  const { components: _components, booleanOperation: _booleanOperation, ...rest } = shape
  return {
    ...rest,
    stroke: rest.stroke ? { ...rest.stroke } : null,
    cornerRadii: rest.cornerRadii ? [...rest.cornerRadii] as [number, number, number, number] : undefined,
    computedPath: rest.computedPath ? clonePath(rest.computedPath) : undefined,
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
    handleMode: "symmetric",
  }
  return { path: { ...path, points }, index, distance: 0 }
}

export function normalizeCornerRadii(shape: ShapeProps): [number, number, number, number] {
  const maxRadius = Math.max(0, Math.min(Math.abs(shape.w) / 2, Math.abs(shape.h) / 2))
  const source = shape.cornerRadii ?? [shape.radius ?? 0, shape.radius ?? 0, shape.radius ?? 0, shape.radius ?? 0]
  return source.map((value) => roundCoord(Math.max(0, Math.min(maxRadius, Number(value) || 0)))) as [number, number, number, number]
}

export function getRoundedRectCornerRadiusHandles(shape: ShapeProps): RoundedRectCornerRadiusHandle[] {
  const [tl, tr, br, bl] = normalizeCornerRadii(shape)
  const x1 = shape.x
  const y1 = shape.y
  const x2 = shape.x + shape.w
  const y2 = shape.y + shape.h
  return [
    { corner: "tl", x: roundCoord(x1 + tl), y: roundCoord(y1 + tl), radius: tl },
    { corner: "tr", x: roundCoord(x2 - tr), y: roundCoord(y1 + tr), radius: tr },
    { corner: "br", x: roundCoord(x2 - br), y: roundCoord(y2 - br), radius: br },
    { corner: "bl", x: roundCoord(x1 + bl), y: roundCoord(y2 - bl), radius: bl },
  ]
}

export function updateRoundedRectCornerRadius(
  shape: ShapeProps,
  corner: RoundedRectCorner,
  point: { x: number; y: number },
): ShapeProps {
  const maxRadius = Math.max(0, Math.min(Math.abs(shape.w) / 2, Math.abs(shape.h) / 2))
  const x1 = shape.x
  const y1 = shape.y
  const x2 = shape.x + shape.w
  const y2 = shape.y + shape.h
  const cornerPoint =
    corner === "tl" ? { x: x1, y: y1 } :
      corner === "tr" ? { x: x2, y: y1 } :
        corner === "br" ? { x: x2, y: y2 } :
          { x: x1, y: y2 }
  const radius = roundCoord(Math.max(0, Math.min(maxRadius, Math.min(Math.abs(point.x - cornerPoint.x), Math.abs(point.y - cornerPoint.y)))))
  const next = normalizeCornerRadii(shape)
  const index = corner === "tl" ? 0 : corner === "tr" ? 1 : corner === "br" ? 2 : 3
  next[index] = radius
  return { ...shape, radius, cornerRadii: next }
}

export function resizeShapeWithCornerRadii(
  shape: ShapeProps,
  rect: { x: number; y: number; w: number; h: number },
): ShapeProps {
  if (shape.type !== "rect") {
    return {
      ...shape,
      ...rect,
      computedPath: shape.computedPath ? transformPathBetweenRects(shape.computedPath, shape, rect) : undefined,
      components: shape.components?.map((component) => ({
        ...component,
        shape: resizeShapeWithCornerRadii(component.shape, transformShapeRect(component.shape, shape, rect)),
      })),
    }
  }
  const widthScale = Math.abs(shape.w) > 0 ? Math.abs(rect.w) / Math.abs(shape.w) : 1
  const radii = normalizeCornerRadii(shape).map((radius) => roundCoord(radius * widthScale)) as [number, number, number, number]
  const maxRadius = Math.max(0, Math.min(Math.abs(rect.w) / 2, Math.abs(rect.h) / 2))
  const cornerRadii = radii.map((radius) => roundCoord(Math.max(0, Math.min(maxRadius, radius)))) as [number, number, number, number]
  return {
    ...shape,
    ...rect,
    radius: cornerRadii[0],
    cornerRadii,
    computedPath: shape.computedPath ? transformPathBetweenRects(shape.computedPath, shape, rect) : undefined,
    components: shape.components?.map((component) => ({
      ...component,
      shape: resizeShapeWithCornerRadii(component.shape, transformShapeRect(component.shape, shape, rect)),
    })),
  }
}

function transformShapeRect(
  target: ShapeProps,
  from: { x: number; y: number; w: number; h: number },
  to: { x: number; y: number; w: number; h: number },
) {
  const scaleX = Math.abs(from.w) > 0 ? to.w / from.w : 1
  const scaleY = Math.abs(from.h) > 0 ? to.h / from.h : 1
  return {
    x: roundCoord(to.x + (target.x - from.x) * scaleX),
    y: roundCoord(to.y + (target.y - from.y) * scaleY),
    w: roundCoord(target.w * scaleX),
    h: roundCoord(target.h * scaleY),
  }
}

export function movePathAnchor(path: PathProps, index: number, point: { x: number; y: number }): PathProps {
  if (index < 0 || index >= path.points.length) return path
  const points = path.points.map((candidate, pointIndex) => {
    if (pointIndex !== index) {
      return {
        ...candidate,
        cp1: candidate.cp1 ? { ...candidate.cp1 } : undefined,
        cp2: candidate.cp2 ? { ...candidate.cp2 } : undefined,
      }
    }
    const dx = point.x - candidate.x
    const dy = point.y - candidate.y
    return {
      ...candidate,
      x: roundCoord(point.x),
      y: roundCoord(point.y),
      cp1: candidate.cp1 ? roundedControl({ x: candidate.cp1.x + dx, y: candidate.cp1.y + dy }) : undefined,
      cp2: candidate.cp2 ? roundedControl({ x: candidate.cp2.x + dx, y: candidate.cp2.y + dy }) : undefined,
    }
  })
  return { ...path, points }
}

function pathAnchorKey(anchor: PathAnchorRef) {
  return `${anchor.subpathIndex}:${anchor.pointIndex}`
}

function normalizePathAnchorSelection(selection: readonly PathAnchorRef[]): PathAnchorRef[] {
  const seen = new Set<string>()
  const out: PathAnchorRef[] = []
  for (const anchor of selection) {
    if (!Number.isInteger(anchor.subpathIndex) || !Number.isInteger(anchor.pointIndex) || anchor.pointIndex < 0) continue
    const key = pathAnchorKey(anchor)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ subpathIndex: anchor.subpathIndex, pointIndex: anchor.pointIndex })
  }
  return out.sort((a, b) => a.subpathIndex - b.subpathIndex || a.pointIndex - b.pointIndex)
}

function rectBounds(rect: { x: number; y: number; w: number; h: number }) {
  const x1 = Math.min(rect.x, rect.x + rect.w)
  const x2 = Math.max(rect.x, rect.x + rect.w)
  const y1 = Math.min(rect.y, rect.y + rect.h)
  const y2 = Math.max(rect.y, rect.y + rect.h)
  return { x1, y1, x2, y2 }
}

export function selectPathAnchorsInRect(path: PathProps, rect: { x: number; y: number; w: number; h: number }): PathAnchorRef[] {
  const bounds = rectBounds(rect)
  const selected: PathAnchorRef[] = []
  for (const entry of pathEntries(path)) {
    entry.path.points.forEach((point, pointIndex) => {
      if (point.x >= bounds.x1 && point.x <= bounds.x2 && point.y >= bounds.y1 && point.y <= bounds.y2) {
        selected.push({ subpathIndex: entry.subpathIndex, pointIndex })
      }
    })
  }
  return normalizePathAnchorSelection(selected)
}

export function selectAllPathAnchors(path: PathProps): PathAnchorRef[] {
  return normalizePathAnchorSelection(pathEntries(path).flatMap((entry) =>
    entry.path.points.map((_, pointIndex) => ({ subpathIndex: entry.subpathIndex, pointIndex })),
  ))
}

export function selectPathSubpathAnchors(path: PathProps, subpathIndex: number): PathAnchorRef[] {
  const entry = pathEntries(path).find((candidate) => candidate.subpathIndex === subpathIndex)
  if (!entry) return []
  return normalizePathAnchorSelection(entry.path.points.map((_, pointIndex) => ({ subpathIndex, pointIndex })))
}

export function togglePathAnchorSelection(selection: readonly PathAnchorRef[], anchor: PathAnchorRef): PathAnchorRef[] {
  const normalized = normalizePathAnchorSelection(selection)
  const key = pathAnchorKey(anchor)
  if (normalized.some((candidate) => pathAnchorKey(candidate) === key)) {
    return normalized.filter((candidate) => pathAnchorKey(candidate) !== key)
  }
  return normalizePathAnchorSelection([...normalized, anchor])
}

function selectedPointSet(selection: readonly PathAnchorRef[]) {
  return new Set(normalizePathAnchorSelection(selection).map(pathAnchorKey))
}

function translatePathPoint(point: PathPoint, dx: number, dy: number): PathPoint {
  return {
    ...point,
    x: roundCoord(point.x + dx),
    y: roundCoord(point.y + dy),
    cp1: point.cp1 ? roundedControl({ x: point.cp1.x + dx, y: point.cp1.y + dy }) : undefined,
    cp2: point.cp2 ? roundedControl({ x: point.cp2.x + dx, y: point.cp2.y + dy }) : undefined,
  }
}

export function moveSelectedPathAnchors(
  path: PathProps,
  selection: readonly PathAnchorRef[],
  delta: { dx: number; dy: number },
): PathProps {
  const selected = selectedPointSet(selection)
  const moveSingle = (single: PathProps, subpathIndex: number): PathProps => ({
    ...single,
    points: single.points.map((point, pointIndex) =>
      selected.has(pathAnchorKey({ subpathIndex, pointIndex }))
        ? translatePathPoint(point, delta.dx, delta.dy)
        : {
            ...point,
            cp1: point.cp1 ? { ...point.cp1 } : undefined,
            cp2: point.cp2 ? { ...point.cp2 } : undefined,
          },
    ),
  })
  return {
    ...moveSingle(path, -1),
    subpaths: path.subpaths?.map((subpath, index) => moveSingle(subpath, index)),
  }
}

export function deleteSelectedPathAnchors(path: PathProps, selection: readonly PathAnchorRef[]): PathProps {
  const selected = selectedPointSet(selection)
  const deleteSingle = (single: PathProps, subpathIndex: number): PathProps => {
    const minPoints = single.closed ? 3 : 2
    const next = single.points.filter((_, pointIndex) => !selected.has(pathAnchorKey({ subpathIndex, pointIndex })))
    return next.length >= minPoints ? { ...single, points: next } : clonePath(single)
  }
  return {
    ...deleteSingle(path, -1),
    subpaths: path.subpaths?.map((subpath, index) => deleteSingle(subpath, index)),
  }
}

export function duplicatePathSubpath(
  path: PathProps,
  subpathIndex: number,
  offset: { dx: number; dy: number } = { dx: 0, dy: 0 },
): { path: PathProps; insertedSubpathIndex: number; selection: PathAnchorRef[] } {
  const sourceEntry = pathEntries(path).find((entry) => entry.subpathIndex === subpathIndex)
  if (!sourceEntry?.path.points.length) {
    return { path: clonePath(path), insertedSubpathIndex: -1, selection: [] }
  }
  const duplicate: PathProps = {
    ...sourceEntry.path,
    points: sourceEntry.path.points.map((point) => translatePathPoint(point, offset.dx, offset.dy)),
    subpaths: undefined,
  }
  const subpaths = [...(path.subpaths?.map(clonePath) ?? []), duplicate]
  const nextPath = {
    ...path,
    points: path.points.map((point) => ({
      ...point,
      cp1: point.cp1 ? { ...point.cp1 } : undefined,
      cp2: point.cp2 ? { ...point.cp2 } : undefined,
    })),
    subpaths,
  }
  const insertedSubpathIndex = subpaths.length - 1
  return {
    path: nextPath,
    insertedSubpathIndex,
    selection: selectPathSubpathAnchors(nextPath, insertedSubpathIndex),
  }
}

export function movePathHandle(
  path: PathProps,
  index: number,
  handle: "in" | "out",
  point: { x: number; y: number },
  options: { mirror?: boolean; mode?: PathHandleMode } = {},
): PathProps {
  if (index < 0 || index >= path.points.length) return path
  const points = path.points.map((candidate) => ({
    ...candidate,
    cp1: candidate.cp1 ? { ...candidate.cp1 } : undefined,
    cp2: candidate.cp2 ? { ...candidate.cp2 } : undefined,
  }))
  const anchor = points[index]
  const rounded = roundedControl(point)
  const mode: PathHandleMode = options.mode ?? (options.mirror ? "symmetric" : (anchor.handleMode ?? "broken"))
  const opposite = roundedControl({ x: anchor.x * 2 - rounded.x, y: anchor.y * 2 - rounded.y })
  if (handle === "in") {
    anchor.cp1 = rounded
    if (mode === "symmetric") anchor.cp2 = opposite
  } else {
    anchor.cp2 = rounded
    if (mode === "symmetric") anchor.cp1 = opposite
  }
  anchor.handleMode = mode
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

function pathEntries(path: PathProps): Array<{ path: PathProps; subpathIndex: number }> {
  return [{ path, subpathIndex: -1 }, ...(path.subpaths ?? []).map((subpath, index) => ({ path: subpath, subpathIndex: index }))]
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
  const current = path.points[segmentIndex]
  const next = path.points[(segmentIndex + 1) % path.points.length]
  const c1 = current.cp2 ?? current
  const c2 = next.cp1 ?? next
  if (current.cp2 || next.cp1) return cubicPoint(current, c1, c2, next, t)
  return {
    x: current.x + (next.x - current.x) * t,
    y: current.y + (next.y - current.y) * t,
  }
}

function nearestPointOnPathSegment(path: PathProps, segmentIndex: number, point: { x: number; y: number }, samples: number) {
  let best = { point: segmentPoint(path, segmentIndex, 0), distance: Infinity, t: 0 }
  let prev = best.point
  for (let sample = 1; sample <= samples; sample++) {
    const t = sample / samples
    const current = segmentPoint(path, segmentIndex, t)
    const projected = projectPointToSegment(point, prev, current)
    const localT = (sample - 1 + projected.t) / samples
    if (projected.distance < best.distance) {
      best = { point: roundedControl(projected.projected), distance: projected.distance, t: roundCoord(localT) }
    }
    prev = current
  }
  return best
}

export function hitTestPathControls(
  path: PathProps,
  point: { x: number; y: number },
  options: PathHitTestOptions = {},
): PathControlHit | null {
  const maxAnchorDistance = options.maxAnchorDistance ?? 12
  const maxHandleDistance = options.maxHandleDistance ?? 12
  const maxSegmentDistance = options.maxSegmentDistance ?? 8
  const segmentSamples = Math.max(4, Math.round(options.segmentSamples ?? 24))
  let bestHandle: Extract<PathControlHit, { kind: "handle" }> | null = null
  let bestAnchor: Extract<PathControlHit, { kind: "anchor" }> | null = null
  let bestSegment: Extract<PathControlHit, { kind: "segment" }> | null = null

  for (const entry of pathEntries(path)) {
    entry.path.points.forEach((candidate, pointIndex) => {
      const anchorDistance = distance(candidate, point)
      if (anchorDistance <= maxAnchorDistance && (!bestAnchor || anchorDistance < bestAnchor.distance)) {
        bestAnchor = { kind: "anchor", subpathIndex: entry.subpathIndex, pointIndex, distance: roundCoord(anchorDistance) }
      }
      if (candidate.cp1) {
        const handleDistance = distance(candidate.cp1, point)
        if (handleDistance <= maxHandleDistance && (!bestHandle || handleDistance < bestHandle.distance)) {
          bestHandle = { kind: "handle", subpathIndex: entry.subpathIndex, pointIndex, handle: "in", distance: roundCoord(handleDistance) }
        }
      }
      if (candidate.cp2) {
        const handleDistance = distance(candidate.cp2, point)
        if (handleDistance <= maxHandleDistance && (!bestHandle || handleDistance < bestHandle.distance)) {
          bestHandle = { kind: "handle", subpathIndex: entry.subpathIndex, pointIndex, handle: "out", distance: roundCoord(handleDistance) }
        }
      }
    })

    const segments = entry.path.closed ? entry.path.points.length : Math.max(0, entry.path.points.length - 1)
    for (let segmentIndex = 0; segmentIndex < segments; segmentIndex++) {
      const nearest = nearestPointOnPathSegment(entry.path, segmentIndex, point, segmentSamples)
      if (nearest.distance <= maxSegmentDistance && (!bestSegment || nearest.distance < bestSegment.distance)) {
        bestSegment = {
          kind: "segment",
          subpathIndex: entry.subpathIndex,
          segmentIndex,
          distance: roundCoord(nearest.distance),
          t: nearest.t,
          point: nearest.point,
        }
      }
    }
  }

  return bestHandle ?? bestAnchor ?? bestSegment
}

function perpendicularDistance(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }) {
  return projectPointToSegment(point, start, end).distance
}

function simplifyPolyline(points: { x: number; y: number }[], tolerance: number): { x: number; y: number }[] {
  if (points.length <= 2) return points.map(roundPoint)
  let index = -1
  let maxDistance = -1
  const first = points[0]
  const last = points[points.length - 1]
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last)
    if (d > maxDistance) {
      index = i
      maxDistance = d
    }
  }
  if (maxDistance > tolerance && index > 0) {
    const left = simplifyPolyline(points.slice(0, index + 1), tolerance)
    const right = simplifyPolyline(points.slice(index), tolerance)
    return [...left.slice(0, -1), ...right]
  }
  return [roundPoint(first), roundPoint(last)]
}

export function fitFreeformPath(points: { x: number; y: number }[], options: FreeformFitOptions = {}): PathPoint[] {
  if (points.length <= 1) return points.map(roundPoint)
  const minSpacing = Math.max(1, (options.tolerance ?? 2) * 0.45)
  const deduped: { x: number; y: number }[] = []
  for (const point of points) {
    const prev = deduped[deduped.length - 1]
    if (!prev || distance(prev, point) >= minSpacing) deduped.push(point)
  }
  const simplified = simplifyPolyline(deduped, Math.max(0.5, options.tolerance ?? 2))
  if (simplified.length <= 2) return simplified.map(roundPoint)

  const smoothness = Math.max(0, Math.min(1, options.smoothness ?? 0.65))
  const closed = options.closed === true
  const get = (index: number) => {
    if (closed) return simplified[(index + simplified.length) % simplified.length]
    return simplified[Math.max(0, Math.min(simplified.length - 1, index))]
  }
  return simplified.map((point, index) => {
    const prev = get(index - 1)
    const next = get(index + 1)
    const vx = next.x - prev.x
    const vy = next.y - prev.y
    const handleScale = smoothness / 6
    const fitted: PathPoint = {
      x: roundCoord(point.x),
      y: roundCoord(point.y),
      handleMode: "broken",
    }
    if (closed || index > 0) {
      fitted.cp1 = roundedControl({ x: point.x - vx * handleScale, y: point.y - vy * handleScale })
    }
    if (closed || index < simplified.length - 1) {
      fitted.cp2 = roundedControl({ x: point.x + vx * handleScale, y: point.y + vy * handleScale })
    }
    return fitted
  })
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
  const combined = {
    ...cloneShapeForComponent(base),
    components,
    booleanOperation: operation,
    appearance: createDefaultShapeAppearance(base),
  }
  return {
    ...combined,
    computedPath: resolveShapeBooleanPath(combined),
  }
}

function applyVertexRoundness(points: PathPoint[], amount: number, shouldRound: (index: number) => boolean = () => true): PathPoint[] {
  const roundness = Math.max(0, Math.min(1, amount))
  if (roundness <= 0 || points.length < 3) return points
  return points.map((point, index) => {
    if (!shouldRound(index)) return point
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
  const hasExplicitStarSmoothing = isStar && (shape.smoothCorners !== undefined || shape.smoothIndent !== undefined)
  const shouldRound = (index: number) => {
    if (!isStar) return shape.smoothCorners !== false
    if (!hasExplicitStarSmoothing) return true
    return index % 2 === 0 ? shape.smoothCorners === true : shape.smoothIndent === true
  }
  return { closed: true, points: applyVertexRoundness(points, shape.vertexRoundness ?? 0, shouldRound) }
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

function primitiveShapeToEditablePath(shape: ShapeProps): PathProps {
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

type FlattenedRing = Array<{ x: number; y: number }>

function flattenPath(path: PathProps, tolerance: number): FlattenedRing[] {
  const rings: FlattenedRing[] = []
  const flattenSingle = (single: PathProps) => {
    if (!single.closed || single.points.length < 3) return
    const ring: FlattenedRing = [roundPoint(single.points[0])]
    const segments = single.points.length
    for (let i = 0; i < segments; i++) {
      const from = single.points[i]
      const to = single.points[(i + 1) % single.points.length]
      const chord = distance(from, to)
      const curveBoost = from.cp2 || to.cp1 ? 2 : 1
      const samples = Math.max(1, Math.min(96, Math.ceil((chord * curveBoost) / Math.max(0.5, tolerance))))
      for (let sample = 1; sample <= samples; sample++) {
        const p = segmentPoint(single, i, sample / samples)
        const prev = ring[ring.length - 1]
        if (!prev || distance(prev, p) > 0.01) ring.push(roundPoint(p))
      }
    }
    if (ring.length > 2) {
      const last = ring[ring.length - 1]
      const first = ring[0]
      if (distance(last, first) < 0.01) ring.pop()
      rings.push(ring)
    }
  }
  flattenSingle(path)
  for (const subpath of path.subpaths ?? []) flattenSingle(subpath)
  return rings
}

function pointInRing(ring: FlattenedRing, point: { x: number; y: number }) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    const intersects = ((a.y > point.y) !== (b.y > point.y)) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x
    if (intersects) inside = !inside
  }
  return inside
}

function ringsContainPoint(rings: FlattenedRing[], point: { x: number; y: number }) {
  let inside = false
  for (const ring of rings) if (pointInRing(ring, point)) inside = !inside
  return inside
}

export function pathContainsPoint(path: PathProps, point: { x: number; y: number }, tolerance = 1) {
  return ringsContainPoint(flattenPath(path, tolerance), point)
}

function ringsBounds(rings: FlattenedRing[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const ring of rings) {
    for (const point of ring) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

function simplifyGridLoop(loop: Array<{ x: number; y: number }>) {
  if (loop.length <= 3) return loop
  const out: Array<{ x: number; y: number }> = []
  for (let i = 0; i < loop.length; i++) {
    const prev = loop[(i - 1 + loop.length) % loop.length]
    const current = loop[i]
    const next = loop[(i + 1) % loop.length]
    const dx1 = current.x - prev.x
    const dy1 = current.y - prev.y
    const dx2 = next.x - current.x
    const dy2 = next.y - current.y
    if (dx1 * dy2 !== dy1 * dx2) out.push(current)
  }
  return out.length >= 3 ? out : loop
}

function gridToPath(filled: Uint8Array, cols: number, rows: number, origin: { x: number; y: number }, step: number): PathProps {
  type GridPoint = { x: number; y: number }
  type Edge = { a: GridPoint; b: GridPoint; used: boolean }
  const edges: Edge[] = []
  const isFilled = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && filled[y * cols + x] === 1
  const addEdge = (a: GridPoint, b: GridPoint) => edges.push({ a, b, used: false })

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!isFilled(x, y)) continue
      if (!isFilled(x, y - 1)) addEdge({ x, y }, { x: x + 1, y })
      if (!isFilled(x + 1, y)) addEdge({ x: x + 1, y }, { x: x + 1, y: y + 1 })
      if (!isFilled(x, y + 1)) addEdge({ x: x + 1, y: y + 1 }, { x, y: y + 1 })
      if (!isFilled(x - 1, y)) addEdge({ x, y: y + 1 }, { x, y })
    }
  }

  const key = (point: GridPoint) => `${point.x},${point.y}`
  const starts = new Map<string, number[]>()
  edges.forEach((edge, index) => {
    const k = key(edge.a)
    const bucket = starts.get(k) ?? []
    bucket.push(index)
    starts.set(k, bucket)
  })

  const loops: GridPoint[][] = []
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].used) continue
    const start = edges[i].a
    let current = edges[i].b
    edges[i].used = true
    const loop: GridPoint[] = [start, current]
    let guard = 0
    while (key(current) !== key(start) && guard++ < edges.length + 4) {
      const bucket = starts.get(key(current)) ?? []
      while (bucket.length && edges[bucket[0]].used) bucket.shift()
      const nextIndex = bucket.shift()
      if (nextIndex === undefined) break
      const edge = edges[nextIndex]
      edge.used = true
      current = edge.b
      loop.push(current)
    }
    if (loop.length >= 4 && key(loop[0]) === key(loop[loop.length - 1])) {
      loop.pop()
      loops.push(simplifyGridLoop(loop))
    }
  }

  const toPoint = (point: GridPoint): PathPoint => roundPoint({ x: origin.x + point.x * step, y: origin.y + point.y * step })
  const paths = loops
    .filter((loop) => loop.length >= 3)
    .map((loop) => ({ closed: true, points: loop.map(toPoint) }))
    .sort((a, b) => Math.abs(pathArea(b.points)) - Math.abs(pathArea(a.points)))

  if (!paths.length) return { closed: true, points: [] }
  return { ...paths[0], subpaths: paths.slice(1) }
}

interface AxisAlignedRect {
  x1: number
  y1: number
  x2: number
  y2: number
}

function uniqueSorted(values: number[]) {
  return [...new Set(values.map(roundCoord))].sort((a, b) => a - b)
}

function simpleAxisAlignedRect(shape: ShapeProps): AxisAlignedRect | null {
  if (
    shape.type !== "rect" ||
    shape.rotation ||
    shape.computedPath ||
    shape.components?.length ||
    normalizeCornerRadii(shape).some((radius) => radius > 0)
  ) {
    return null
  }
  const x1 = Math.min(shape.x, shape.x + shape.w)
  const x2 = Math.max(shape.x, shape.x + shape.w)
  const y1 = Math.min(shape.y, shape.y + shape.h)
  const y2 = Math.max(shape.y, shape.y + shape.h)
  if (x2 <= x1 || y2 <= y1) return null
  return { x1: roundCoord(x1), y1: roundCoord(y1), x2: roundCoord(x2), y2: roundCoord(y2) }
}

function pointInRect(rect: AxisAlignedRect, point: { x: number; y: number }) {
  return point.x >= rect.x1 && point.x <= rect.x2 && point.y >= rect.y1 && point.y <= rect.y2
}

function edgePathFromCells(filled: Uint8Array, cols: number, rows: number, xs: number[], ys: number[]): PathProps {
  type EdgePoint = { x: number; y: number }
  type Edge = { a: EdgePoint; b: EdgePoint; used: boolean }
  const edges: Edge[] = []
  const isFilled = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && filled[y * cols + x] === 1
  const addEdge = (a: EdgePoint, b: EdgePoint) => edges.push({ a, b, used: false })

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!isFilled(x, y)) continue
      if (!isFilled(x, y - 1)) addEdge({ x: xs[x], y: ys[y] }, { x: xs[x + 1], y: ys[y] })
      if (!isFilled(x + 1, y)) addEdge({ x: xs[x + 1], y: ys[y] }, { x: xs[x + 1], y: ys[y + 1] })
      if (!isFilled(x, y + 1)) addEdge({ x: xs[x + 1], y: ys[y + 1] }, { x: xs[x], y: ys[y + 1] })
      if (!isFilled(x - 1, y)) addEdge({ x: xs[x], y: ys[y + 1] }, { x: xs[x], y: ys[y] })
    }
  }

  const key = (point: EdgePoint) => `${roundCoord(point.x)},${roundCoord(point.y)}`
  const starts = new Map<string, number[]>()
  edges.forEach((edge, index) => {
    const bucket = starts.get(key(edge.a)) ?? []
    bucket.push(index)
    starts.set(key(edge.a), bucket)
  })

  const loops: EdgePoint[][] = []
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].used) continue
    const start = edges[i].a
    let current = edges[i].b
    edges[i].used = true
    const loop: EdgePoint[] = [start, current]
    let guard = 0
    while (key(current) !== key(start) && guard++ < edges.length + 4) {
      const bucket = starts.get(key(current)) ?? []
      while (bucket.length && edges[bucket[0]].used) bucket.shift()
      const nextIndex = bucket.shift()
      if (nextIndex === undefined) break
      const edge = edges[nextIndex]
      edge.used = true
      current = edge.b
      loop.push(current)
    }
    if (loop.length >= 4 && key(loop[0]) === key(loop[loop.length - 1])) {
      loop.pop()
      loops.push(simplifyGridLoop(loop))
    }
  }

  const paths = loops
    .filter((loop) => loop.length >= 3)
    .map((loop) => ({ closed: true, source: "compound" as const, points: loop.map(roundPoint) }))
    .sort((a, b) => Math.abs(pathArea(b.points)) - Math.abs(pathArea(a.points)))

  if (!paths.length) return { closed: true, source: "compound", points: [] }
  return { ...paths[0], subpaths: paths.slice(1) }
}

function resolveAxisAlignedRectBooleanPath(shape: ShapeProps): PathProps | null {
  if (!shape.components?.length) return null
  const components = shape.components.map((component) => ({
    operation: component.operation,
    rect: simpleAxisAlignedRect(component.shape),
  }))
  if (components.some((component) => !component.rect)) return null
  const rects = components.map((component) => component.rect!)
  const xs = uniqueSorted(rects.flatMap((rect) => [rect.x1, rect.x2]))
  const ys = uniqueSorted(rects.flatMap((rect) => [rect.y1, rect.y2]))
  if (xs.length < 2 || ys.length < 2) return { closed: true, source: "compound", points: [] }
  const cols = xs.length - 1
  const rows = ys.length - 1
  const filled = new Uint8Array(cols * rows)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const sample = { x: (xs[x] + xs[x + 1]) / 2, y: (ys[y] + ys[y + 1]) / 2 }
      let value = false
      components.forEach((component, index) => {
        const inside = pointInRect(component.rect!, sample)
        if (index === 0 || component.operation === "unite") value = value || inside
        else if (component.operation === "subtract") value = value && !inside
        else if (component.operation === "intersect") value = value && inside
        else if (component.operation === "exclude") value = value !== inside
      })
      if (value) filled[y * cols + x] = 1
    }
  }
  return edgePathFromCells(filled, cols, rows, xs, ys)
}

function paperPoint(scope: PaperScopeLike, point: { x: number; y: number }) {
  return new scope.Point(point.x, point.y)
}

function paperHandle(scope: PaperScopeLike, anchor: { x: number; y: number }, handle: { x: number; y: number } | undefined) {
  return handle ? new scope.Point(handle.x - anchor.x, handle.y - anchor.y) : new scope.Point(0, 0)
}

function pathToPaperItem(scope: PaperScopeLike, path: PathProps): PaperPathLike | PaperCompoundPathLike | null {
  const makePath = (single: PathProps) => {
    if (single.points.length < (single.closed ? 3 : 2)) return null
    const next = new scope.Path({ insert: false })
    for (const point of single.points) {
      next.add(new scope.Segment(
        paperPoint(scope, point),
        paperHandle(scope, point, point.cp1),
        paperHandle(scope, point, point.cp2),
      ))
    }
    next.closed = single.closed
    return next
  }

  const children = [path, ...(path.subpaths ?? [])]
    .map(makePath)
    .filter((child): child is PaperPathLike => !!child)
  if (!children.length) return null
  if (children.length === 1) return children[0]
  const compound = new scope.CompoundPath({ insert: false })
  for (const child of children) compound.addChild(child)
  return compound
}

function nonZeroHandle(handle: PaperPointLike) {
  return Math.abs(handle.x) > 0.001 || Math.abs(handle.y) > 0.001
}

function paperPathToPathProps(path: PaperPathLike): PathProps | null {
  if (path.segments.length < (path.closed ? 3 : 2)) return null
  return {
    closed: path.closed,
    source: "compound",
    points: path.segments.map((segment) => {
      const point: PathPoint = roundPoint({ x: segment.point.x, y: segment.point.y })
      if (nonZeroHandle(segment.handleIn)) {
        point.cp1 = roundedControl({
          x: segment.point.x + segment.handleIn.x,
          y: segment.point.y + segment.handleIn.y,
        })
      }
      if (nonZeroHandle(segment.handleOut)) {
        point.cp2 = roundedControl({
          x: segment.point.x + segment.handleOut.x,
          y: segment.point.y + segment.handleOut.y,
        })
      }
      if (point.cp1 || point.cp2) point.handleMode = "broken"
      return point
    }),
  }
}

function paperItemToPathProps(paperModule: PaperModule, item: unknown): PathProps | null {
  const isPaperPath = (candidate: unknown): candidate is PaperPathLike =>
    candidate instanceof paperModule.Path ||
    (typeof candidate === "object" && candidate !== null && "className" in candidate && candidate.className === "Path")
  const isCompoundPath = (candidate: unknown): candidate is PaperCompoundPathLike =>
    candidate instanceof paperModule.CompoundPath ||
    (typeof candidate === "object" && candidate !== null && "className" in candidate && candidate.className === "CompoundPath")
  if (isPaperPath(item)) return paperPathToPathProps(item)
  if (isCompoundPath(item)) {
    const children = item.children
      .filter((child): child is PaperPathLike => isPaperPath(child))
      .map(paperPathToPathProps)
      .filter((path: PathProps | null): path is PathProps => !!path)
      .sort((a: PathProps, b: PathProps) => Math.abs(pathArea(b.points)) - Math.abs(pathArea(a.points)))
    if (!children.length) return null
    return { ...children[0], subpaths: children.slice(1) }
  }
  return null
}

function resolveBezierBooleanPath(shape: ShapeProps): PathProps | null {
  if (!shape.components?.length) return null
  const paperModule = getPaperModule()
  if (!paperModule) return null
  try {
    const scope = new paperModule.PaperScope()
    scope.setup(new scope.Size(1, 1))
    const components = shape.components.map((component) => ({
      operation: component.operation,
      item: pathToPaperItem(scope, shapeToEditablePath(component.shape)),
    }))
    if (components.some((component) => !component.item)) {
      scope.project.remove()
      return null
    }
    let result: PaperBooleanItemLike = components[0].item!
    for (let i = 1; i < components.length; i++) {
      const operand = components[i].item!
      const operation = components[i].operation
      if (operation === "unite") result = result.unite(operand, { insert: false })
      else if (operation === "subtract") result = result.subtract(operand, { insert: false })
      else if (operation === "intersect") result = result.intersect(operand, { insert: false })
      else result = result.exclude(operand, { insert: false })
    }
    const converted = paperItemToPathProps(paperModule, result)
    scope.project.remove()
    return converted && converted.points.length ? converted : null
  } catch {
    return null
  }
}

function pathArea(points: Array<{ x: number; y: number }>) {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    area += a.x * b.y - b.x * a.y
  }
  return area / 2
}

export function resolveShapeBooleanPath(shape: ShapeProps, options: BooleanResolveOptions = {}): PathProps {
  if (!shape.components?.length) return shape.computedPath ? clonePath(shape.computedPath) : primitiveShapeToEditablePath(shape)

  const exactRectPath = resolveAxisAlignedRectBooleanPath(shape)
  if (exactRectPath) return exactRectPath

  const bezierPath = resolveBezierBooleanPath(shape)
  if (bezierPath) return bezierPath

  const builtInBezierPath = resolveBezierBooleanFallback(shape.components.map((component) => ({
    operation: component.operation,
    path: shapeToEditablePath(component.shape),
  })))
  if (builtInBezierPath) return builtInBezierPath

  const tolerance = Math.max(1, options.tolerance ?? 2)
  const maxGridCells = Math.max(1024, options.maxGridCells ?? 36000)
  const components = shape.components.map((component) => ({
    operation: component.operation,
    rings: flattenPath(shapeToEditablePath(component.shape), tolerance),
  }))
  const allRings = components.flatMap((component) => component.rings)
  const bounds = ringsBounds(allRings)
  if (!bounds) return { closed: true, points: [] }

  const pad = tolerance
  const origin = { x: Math.floor((bounds.minX - pad) / tolerance) * tolerance, y: Math.floor((bounds.minY - pad) / tolerance) * tolerance }
  const width = Math.max(tolerance, bounds.maxX - origin.x + pad)
  const height = Math.max(tolerance, bounds.maxY - origin.y + pad)
  let step = tolerance
  let cols = Math.ceil(width / step)
  let rows = Math.ceil(height / step)
  const cells = cols * rows
  if (cells > maxGridCells) {
    step *= Math.sqrt(cells / maxGridCells)
    cols = Math.ceil(width / step)
    rows = Math.ceil(height / step)
  }

  const filled = new Uint8Array(cols * rows)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const sample = { x: origin.x + (x + 0.5) * step, y: origin.y + (y + 0.5) * step }
      let value = false
      components.forEach((component, index) => {
        const inside = ringsContainPoint(component.rings, sample)
        if (index === 0 || component.operation === "unite") value = value || inside
        else if (component.operation === "subtract") value = value && !inside
        else if (component.operation === "intersect") value = value && inside
        else if (component.operation === "exclude") value = value !== inside
      })
      if (value) filled[y * cols + x] = 1
    }
  }

  return gridToPath(filled, cols, rows, origin, step)
}

export function shapeToEditablePath(shape: ShapeProps): PathProps {
  if (shape.components?.length) return resolveShapeBooleanPath(shape)
  if (shape.computedPath) return clonePath(shape.computedPath)
  return primitiveShapeToEditablePath(shape)
}

export function drawSmoothPolygon(ctx: CanvasRenderingContext2D, shape: ShapeProps) {
  appendPathToCanvas(ctx, shapeToEditablePath({ ...shape, type: "polygon" }))
}

export function drawStar(ctx: CanvasRenderingContext2D, shape: ShapeProps) {
  appendPathToCanvas(ctx, shapeToEditablePath({ ...shape, type: "star" }))
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
  const commands: string[] = []
  const appendSingle = (single: PathProps) => {
    if (!single.points.length) return
    commands.push(`M ${single.points[0].x} ${single.points[0].y}`)
    for (let i = 1; i < single.points.length; i++) {
      const prev = single.points[i - 1]
      const current = single.points[i]
      if (prev.cp2 || current.cp1) {
        const c1 = prev.cp2 ?? prev
        const c2 = current.cp1 ?? current
        commands.push(`C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${current.x} ${current.y}`)
      } else {
        commands.push(`L ${current.x} ${current.y}`)
      }
    }
    if (single.closed) {
      const last = single.points[single.points.length - 1]
      const first = single.points[0]
      if (last.cp2 || first.cp1) {
        const c1 = last.cp2 ?? last
        const c2 = first.cp1 ?? first
        commands.push(`C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${first.x} ${first.y}`)
      }
      commands.push("Z")
    }
  }
  appendSingle(path)
  for (const subpath of path.subpaths ?? []) appendSingle(subpath)
  return commands.join(" ")
}
