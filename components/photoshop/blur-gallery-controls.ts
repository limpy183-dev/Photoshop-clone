export type BlurGalleryFilterId = "field-blur" | "iris-blur" | "tilt-shift" | "path-blur" | "spin-blur"

export type BlurGalleryParamValue = number | string | boolean
export type BlurGalleryParams = Record<string, BlurGalleryParamValue>

export interface PercentPoint {
  x: number
  y: number
}

export interface FieldBlurPin extends PercentPoint {
  blur: number
}

export type BlurGalleryDrag =
  | { kind: "field-pin"; index: number }
  | { kind: "field-amount"; index: number }
  | { kind: "iris-center" }
  | { kind: "iris-radius" }
  | { kind: "iris-feather" }
  | { kind: "tilt-center" }
  | { kind: "tilt-radius" }
  | { kind: "tilt-feather" }
  | { kind: "tilt-angle" }
  | { kind: "path-point"; index: number }
  | { kind: "spin-center" }
  | { kind: "spin-radius" }

export interface BlurGalleryInteraction {
  params: BlurGalleryParams
  drag: BlurGalleryDrag | null
}

const BLUR_GALLERY_FILTER_IDS = new Set<string>([
  "field-blur",
  "iris-blur",
  "tilt-shift",
  "path-blur",
  "spin-blur",
])

export function isBlurGalleryFilterId(filterId: string | null | undefined): filterId is BlurGalleryFilterId {
  return typeof filterId === "string" && BLUR_GALLERY_FILTER_IDS.has(filterId)
}

export function normalizeBlurGalleryParams(
  filterId: BlurGalleryFilterId,
  params: BlurGalleryParams,
): BlurGalleryParams {
  switch (filterId) {
    case "field-blur": {
      const pins = parseFieldBlurPins(String(params.pins ?? ""))
      if (pins.length > 0) return params
      const pin = {
        x: numParam(params.centerX, 50),
        y: numParam(params.centerY, 50),
        blur: numParam(params.blur, 12),
      }
      return { ...params, pins: formatFieldBlurPins([pin]) }
    }
    case "tilt-shift":
      return {
        ...params,
        centerX: numParam(params.centerX, 50),
        centerY: numParam(params.centerY, 50),
      }
    case "path-blur":
      return {
        ...params,
        path: String(params.path ?? "25,50;75,50"),
      }
    case "spin-blur":
      return {
        ...params,
        radius: numParam(params.radius, 55),
      }
    default:
      return params
  }
}

export function parseFieldBlurPins(value: string): FieldBlurPin[] {
  return value
    .split(";")
    .map((entry) => entry.split(",").map((part) => Number(part.trim())))
    .filter((parts) => parts.length >= 3 && parts.every(Number.isFinite))
    .map(([x, y, blur]) => ({
      x: clampPercent(x),
      y: clampPercent(y),
      blur: clampBlur(blur),
    }))
}

export function formatFieldBlurPins(pins: FieldBlurPin[]) {
  return pins
    .map((pin) => `${formatNumber(clampPercent(pin.x))},${formatNumber(clampPercent(pin.y))},${formatNumber(clampBlur(pin.blur))}`)
    .join(";")
}

export function parsePathBlurPoints(value: string): PercentPoint[] {
  const points = value
    .split(";")
    .map((entry) => entry.split(",").map((part) => Number(part.trim())))
    .filter((parts) => parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]))
    .map(([x, y]) => ({ x: clampPercent(x), y: clampPercent(y) }))
  return points.length >= 2 ? points : [{ x: 25, y: 50 }, { x: 75, y: 50 }]
}

export function formatPathBlurPoints(points: PercentPoint[]) {
  return points
    .map((point) => `${formatNumber(clampPercent(point.x))},${formatNumber(clampPercent(point.y))}`)
    .join(";")
}

export function beginBlurGalleryInteraction(
  filterId: BlurGalleryFilterId,
  params: BlurGalleryParams,
  point: PercentPoint,
  width: number,
  height: number,
  tolerance = 10,
): BlurGalleryInteraction {
  const normalized = filterId === "field-blur" && params.pins === undefined
    ? params
    : normalizeBlurGalleryParams(filterId, params)
  const hit = hitTestBlurGalleryControl(filterId, normalized, point, width, height, tolerance)
  if (hit) return { params: normalized, drag: hit }

  const percent = canvasPointToPercent(point, width, height)
  if (filterId === "field-blur") {
    const pins = parseFieldBlurPins(String(normalized.pins ?? ""))
    const next = [...pins, { x: percent.x, y: percent.y, blur: numParam(normalized.blur, 12) }]
    return {
      params: syncFieldPinParams({ ...normalized, pins: formatFieldBlurPins(next) }, next.length - 1),
      drag: { kind: "field-pin", index: next.length - 1 },
    }
  }

  if (filterId === "path-blur") {
    const points = parsePathBlurPoints(String(normalized.path ?? ""))
    const next = [...points, percent]
    return {
      params: syncPathParams({ ...normalized, path: formatPathBlurPoints(next) }),
      drag: { kind: "path-point", index: next.length - 1 },
    }
  }

  if (filterId === "spin-blur") {
    return {
      params: { ...normalized, centerX: round2(percent.x), centerY: round2(percent.y) },
      drag: { kind: "spin-center" },
    }
  }

  return { params: normalized, drag: null }
}

export function hitTestBlurGalleryControl(
  filterId: BlurGalleryFilterId,
  params: BlurGalleryParams,
  point: PercentPoint,
  width: number,
  height: number,
  tolerance = 10,
): BlurGalleryDrag | null {
  switch (filterId) {
    case "field-blur":
      return hitFieldBlur(params, point, width, height, tolerance)
    case "iris-blur":
      return hitIrisBlur(params, point, width, height, tolerance)
    case "tilt-shift":
      return hitTiltShift(params, point, width, height, tolerance)
    case "path-blur":
      return hitPathBlur(params, point, width, height, tolerance)
    case "spin-blur":
      return hitSpinBlur(params, point, width, height, tolerance)
    default:
      return null
  }
}

export function updateBlurGalleryInteraction(
  filterId: BlurGalleryFilterId,
  params: BlurGalleryParams,
  drag: BlurGalleryDrag,
  point: PercentPoint,
  width: number,
  height: number,
): BlurGalleryParams {
  const percent = canvasPointToPercent(point, width, height)

  if (filterId === "field-blur" && (drag.kind === "field-pin" || drag.kind === "field-amount")) {
    const pins = parseFieldBlurPins(String(params.pins ?? ""))
    const pin = pins[drag.index]
    if (!pin) return params
    const next = pins.slice()
    if (drag.kind === "field-pin") {
      next[drag.index] = { ...pin, x: round2(percent.x), y: round2(percent.y) }
    } else {
      const center = percentToCanvasPoint(pin, width, height)
      next[drag.index] = { ...pin, blur: clampBlur(Math.hypot(point.x - center.x, point.y - center.y)) }
    }
    return syncFieldPinParams({ ...params, pins: formatFieldBlurPins(next) }, drag.index)
  }

  if (filterId === "iris-blur") {
    if (drag.kind === "iris-center") {
      return { ...params, centerX: round2(percent.x), centerY: round2(percent.y) }
    }
    const center = percentToCanvasPoint({ x: numParam(params.centerX, 50), y: numParam(params.centerY, 50) }, width, height)
    const radiusPx = Math.max(1, Math.hypot(point.x - center.x, point.y - center.y))
    const radius = clampPercent((radiusPx * 2 / Math.max(1, width)) * 100)
    if (drag.kind === "iris-radius") {
      return { ...params, radius: round2(radius) }
    }
    if (drag.kind === "iris-feather") {
      const baseRadius = Math.max(1, (Math.max(1, width) * numParam(params.radius, 42) / 100) * 0.5)
      const feather = clampPercent(((radiusPx / baseRadius) - 1) * 100)
      return { ...params, feather: round2(feather) }
    }
  }

  if (filterId === "tilt-shift") {
    if (drag.kind === "tilt-center") {
      return { ...params, centerX: round2(percent.x), centerY: round2(percent.y) }
    }
    const center = percentToCanvasPoint({ x: numParam(params.centerX, 50), y: numParam(params.centerY, 50) }, width, height)
    const normal = tiltNormal(numParam(params.angle, 0))
    const distance = Math.abs((point.x - center.x) * normal.x + (point.y - center.y) * normal.y)
    const minDim = Math.max(1, Math.min(width, height))
    if (drag.kind === "tilt-radius") {
      return { ...params, radius: round2(clampPercent((distance * 2 / minDim) * 100)) }
    }
    if (drag.kind === "tilt-feather") {
      const clearBand = minDim * (numParam(params.radius, 30) / 100) * 0.5
      return { ...params, feather: round2(clampPercent(((distance - clearBand) / minDim) * 100)) }
    }
    if (drag.kind === "tilt-angle") {
      const angle = Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI
      return { ...params, angle: round2(angle) }
    }
  }

  if (filterId === "path-blur" && drag.kind === "path-point") {
    const points = parsePathBlurPoints(String(params.path ?? ""))
    if (!points[drag.index]) return params
    const next = points.slice()
    next[drag.index] = { x: round2(percent.x), y: round2(percent.y) }
    return syncPathParams({ ...params, path: formatPathBlurPoints(next) })
  }

  if (filterId === "spin-blur") {
    if (drag.kind === "spin-center") {
      return { ...params, centerX: round2(percent.x), centerY: round2(percent.y) }
    }
    if (drag.kind === "spin-radius") {
      const center = percentToCanvasPoint({ x: numParam(params.centerX, 50), y: numParam(params.centerY, 50) }, width, height)
      const minDim = Math.max(1, Math.min(width, height))
      return { ...params, radius: round2(clampPercent((Math.hypot(point.x - center.x, point.y - center.y) * 2 / minDim) * 100)) }
    }
  }

  return params
}

export function percentToCanvasPoint(point: PercentPoint, width: number, height: number): PercentPoint {
  return {
    x: (clampPercent(point.x) / 100) * Math.max(1, width),
    y: (clampPercent(point.y) / 100) * Math.max(1, height),
  }
}

export function canvasPointToPercent(point: PercentPoint, width: number, height: number): PercentPoint {
  return {
    x: round2(clampPercent((point.x / Math.max(1, width)) * 100)),
    y: round2(clampPercent((point.y / Math.max(1, height)) * 100)),
  }
}

function hitFieldBlur(
  params: BlurGalleryParams,
  point: PercentPoint,
  width: number,
  height: number,
  tolerance: number,
): BlurGalleryDrag | null {
  const pins = parseFieldBlurPins(String(params.pins ?? ""))
  for (let i = pins.length - 1; i >= 0; i--) {
    const center = percentToCanvasPoint(pins[i], width, height)
    const amount = { x: center.x + pins[i].blur, y: center.y }
    if (Math.hypot(point.x - amount.x, point.y - amount.y) <= tolerance) return { kind: "field-amount", index: i }
  }
  for (let i = pins.length - 1; i >= 0; i--) {
    const center = percentToCanvasPoint(pins[i], width, height)
    if (Math.hypot(point.x - center.x, point.y - center.y) <= tolerance) return { kind: "field-pin", index: i }
  }
  return null
}

function hitIrisBlur(
  params: BlurGalleryParams,
  point: PercentPoint,
  width: number,
  height: number,
  tolerance: number,
): BlurGalleryDrag | null {
  const center = percentToCanvasPoint({ x: numParam(params.centerX, 50), y: numParam(params.centerY, 50) }, width, height)
  const rx = Math.max(1, width * numParam(params.radius, 42) / 100 * 0.5)
  const featherRx = rx * (1 + numParam(params.feather, 30) / 100)
  if (Math.hypot(point.x - (center.x + featherRx), point.y - center.y) <= tolerance) return { kind: "iris-feather" }
  if (Math.hypot(point.x - (center.x + rx), point.y - center.y) <= tolerance) return { kind: "iris-radius" }
  if (Math.hypot(point.x - center.x, point.y - center.y) <= tolerance) return { kind: "iris-center" }
  return null
}

function hitTiltShift(
  params: BlurGalleryParams,
  point: PercentPoint,
  width: number,
  height: number,
  tolerance: number,
): BlurGalleryDrag | null {
  const center = percentToCanvasPoint({ x: numParam(params.centerX, 50), y: numParam(params.centerY, 50) }, width, height)
  if (Math.hypot(point.x - center.x, point.y - center.y) <= tolerance) return { kind: "tilt-center" }
  const normal = tiltNormal(numParam(params.angle, 0))
  const d = Math.abs((point.x - center.x) * normal.x + (point.y - center.y) * normal.y)
  const minDim = Math.max(1, Math.min(width, height))
  const radius = minDim * (numParam(params.radius, 30) / 100) * 0.5
  const feather = radius + minDim * (numParam(params.feather, 30) / 100)
  if (Math.abs(d - feather) <= tolerance) return { kind: "tilt-feather" }
  if (Math.abs(d - radius) <= tolerance) return { kind: "tilt-radius" }
  return null
}

function hitPathBlur(
  params: BlurGalleryParams,
  point: PercentPoint,
  width: number,
  height: number,
  tolerance: number,
): BlurGalleryDrag | null {
  const points = parsePathBlurPoints(String(params.path ?? ""))
  for (let i = points.length - 1; i >= 0; i--) {
    const canvasPoint = percentToCanvasPoint(points[i], width, height)
    if (Math.hypot(point.x - canvasPoint.x, point.y - canvasPoint.y) <= tolerance) return { kind: "path-point", index: i }
  }
  return null
}

function hitSpinBlur(
  params: BlurGalleryParams,
  point: PercentPoint,
  width: number,
  height: number,
  tolerance: number,
): BlurGalleryDrag | null {
  const center = percentToCanvasPoint({ x: numParam(params.centerX, 50), y: numParam(params.centerY, 50) }, width, height)
  const radius = Math.max(1, Math.min(width, height) * numParam(params.radius, 55) / 100 * 0.5)
  if (Math.hypot(point.x - (center.x + radius), point.y - center.y) <= tolerance) return { kind: "spin-radius" }
  if (Math.hypot(point.x - center.x, point.y - center.y) <= tolerance) return { kind: "spin-center" }
  return null
}

function syncFieldPinParams(params: BlurGalleryParams, index: number): BlurGalleryParams {
  const pins = parseFieldBlurPins(String(params.pins ?? ""))
  const pin = pins[index]
  if (!pin) return params
  return {
    ...params,
    centerX: pin.x,
    centerY: pin.y,
    blur: pin.blur,
  }
}

function syncPathParams(params: BlurGalleryParams): BlurGalleryParams {
  const points = parsePathBlurPoints(String(params.path ?? ""))
  const first = points[0]
  const last = points[points.length - 1]
  const angle = Math.atan2(last.y - first.y, last.x - first.x) * 180 / Math.PI
  return { ...params, angle: round2(angle) }
}

function tiltNormal(angle: number) {
  const radians = angle * Math.PI / 180
  return { x: -Math.sin(radians), y: Math.cos(radians) }
}

function numParam(value: BlurGalleryParamValue | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
}

function clampBlur(value: number) {
  return Math.max(0, Math.min(80, Math.round(Number.isFinite(value) ? value : 0)))
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}

function formatNumber(value: number) {
  return String(round2(value)).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")
}
