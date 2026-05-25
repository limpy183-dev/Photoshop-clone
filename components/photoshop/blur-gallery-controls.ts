import type { BlurGalleryMeshResource } from "./types"

export type BlurGalleryFilterId = "field-blur" | "iris-blur" | "tilt-shift" | "path-blur" | "spin-blur"

export type BlurGalleryParamValue = number | string | boolean
export type BlurGalleryParams = Record<string, BlurGalleryParamValue>

export const BLUR_GALLERY_CONTROL_STATE_KEY = "__blurGalleryControlState"

export interface PercentPoint {
  x: number
  y: number
}

export interface FieldBlurPin extends PercentPoint {
  blur: number
}

export type BlurGalleryPreviewQuality = "full" | "interactive"

export interface BlurGalleryControlState {
  selectedFieldPinIndexes: number[]
  selectedPathPointIndexes: number[]
  activeControl: string | null
  previewQuality: BlurGalleryPreviewQuality
}

export type BlurGalleryControlStatePatch = Partial<BlurGalleryControlState>

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

export interface BlurGalleryInteractionOptions {
  multiSelect?: boolean
}

export type BlurGalleryKeyboardCommand =
  | { kind: "delete"; selection?: BlurGalleryControlStatePatch }
  | { kind: "duplicate"; offset?: number; selection?: BlurGalleryControlStatePatch }
  | { kind: "nudge"; dx: number; dy: number; selection?: BlurGalleryControlStatePatch }
  | { kind: "select-next"; direction?: 1 | -1; selection?: BlurGalleryControlStatePatch }
  | { kind: "clear-selection"; selection?: BlurGalleryControlStatePatch }

const BLUR_GALLERY_FILTER_IDS = new Set<string>([
  "field-blur",
  "iris-blur",
  "tilt-shift",
  "path-blur",
  "spin-blur",
])

const EMPTY_CONTROL_STATE: BlurGalleryControlState = {
  selectedFieldPinIndexes: [],
  selectedPathPointIndexes: [],
  activeControl: null,
  previewQuality: "full",
}

export function isBlurGalleryFilterId(filterId: string | null | undefined): filterId is BlurGalleryFilterId {
  return typeof filterId === "string" && BLUR_GALLERY_FILTER_IDS.has(filterId)
}

export function normalizeBlurGalleryParams(
  filterId: BlurGalleryFilterId,
  params: BlurGalleryParams,
): BlurGalleryParams {
  const hasState = hasControlState(params)
  let normalized: BlurGalleryParams

  switch (filterId) {
    case "field-blur": {
      const pins = parseFieldBlurPins(String(params.pins ?? ""))
      if (pins.length > 0) {
        normalized = params
        break
      }
      const pin = {
        x: numParam(params.centerX, 50),
        y: numParam(params.centerY, 50),
        blur: numParam(params.blur, 12),
      }
      normalized = { ...params, pins: formatFieldBlurPins([pin]) }
      break
    }
    case "tilt-shift":
      normalized = {
        ...params,
        centerX: numParam(params.centerX, 50),
        centerY: numParam(params.centerY, 50),
      }
      break
    case "path-blur":
      normalized = {
        ...params,
        path: String(params.path ?? "25,50;75,50"),
      }
      break
    case "spin-blur":
      normalized = {
        ...params,
        radius: numParam(params.radius, 55),
      }
      break
    default:
      normalized = params
  }

  return hasState ? withBlurGalleryControlState(filterId, normalized, getBlurGalleryControlState(normalized)) : normalized
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

export function createBlurGalleryMeshResource(
  filterId: BlurGalleryFilterId,
  params: BlurGalleryParams,
): BlurGalleryMeshResource {
  const normalized = normalizeBlurGalleryParams(filterId, params)
  const descriptor: BlurGalleryMeshResource["descriptor"] = {
    filterId,
    params: sanitizeResourceParams(normalized),
    controlState: getBlurGalleryControlState(normalized),
    mesh: buildBlurGalleryMeshDescriptor(filterId, normalized),
  }
  const payload = stableStringify(descriptor)
  const bytes = new TextEncoder().encode(payload)
  return {
    signature: "8BIM",
    resourceKey: "blurGalleryMesh",
    version: 1,
    descriptor,
    payloadBase64: base64Encode(bytes),
    checksum: checksumHex(bytes),
  }
}

export function paramsFromBlurGalleryMeshResource(resource: BlurGalleryMeshResource): {
  filterId: BlurGalleryFilterId
  params: BlurGalleryParams
} {
  if (resource.signature !== "8BIM" || resource.resourceKey !== "blurGalleryMesh" || resource.version !== 1) {
    throw new Error("Unsupported Blur Gallery mesh resource")
  }
  const bytes = base64Decode(resource.payloadBase64)
  if (checksumHex(bytes) !== resource.checksum) {
    throw new Error("Blur Gallery mesh resource checksum mismatch")
  }
  const descriptor = JSON.parse(new TextDecoder().decode(bytes)) as BlurGalleryMeshResource["descriptor"]
  if (!isBlurGalleryFilterId(descriptor.filterId)) {
    throw new Error("Blur Gallery mesh resource has an unsupported filter id")
  }
  const params = sanitizeResourceParams(descriptor.params ?? {})
  if (!params[BLUR_GALLERY_CONTROL_STATE_KEY]) {
    params[BLUR_GALLERY_CONTROL_STATE_KEY] = formatBlurGalleryControlState(descriptor.controlState)
  }
  return {
    filterId: descriptor.filterId,
    params: normalizeBlurGalleryParams(descriptor.filterId, params),
  }
}

export function getBlurGalleryControlState(params: BlurGalleryParams): BlurGalleryControlState {
  const raw = params[BLUR_GALLERY_CONTROL_STATE_KEY]
  if (typeof raw !== "string" || raw.trim() === "") return { ...EMPTY_CONTROL_STATE }
  try {
    const parsed = JSON.parse(raw) as Partial<BlurGalleryControlState>
    return normalizeControlState(parsed)
  } catch {
    return { ...EMPTY_CONTROL_STATE }
  }
}

export function setBlurGalleryControlState(params: BlurGalleryParams, state: BlurGalleryControlStatePatch): BlurGalleryParams {
  const next = normalizeControlState({ ...getBlurGalleryControlState(params), ...state })
  return {
    ...params,
    [BLUR_GALLERY_CONTROL_STATE_KEY]: formatBlurGalleryControlState(next),
  }
}

export function finishBlurGalleryInteraction(filterId: BlurGalleryFilterId, params: BlurGalleryParams): BlurGalleryParams {
  return withBlurGalleryControlState(filterId, params, {
    ...getBlurGalleryControlState(params),
    previewQuality: "full",
  })
}

export function beginBlurGalleryInteraction(
  filterId: BlurGalleryFilterId,
  params: BlurGalleryParams,
  point: PercentPoint,
  width: number,
  height: number,
  tolerance = 10,
  options: BlurGalleryInteractionOptions = {},
): BlurGalleryInteraction {
  const normalized = filterId === "field-blur" && params.pins === undefined
    ? params
    : normalizeBlurGalleryParams(filterId, params)
  const hit = hitTestBlurGalleryControl(filterId, normalized, point, width, height, tolerance)
  if (hit) {
    return {
      params: selectBlurGalleryControl(filterId, normalized, hit, options.multiSelect),
      drag: hit,
    }
  }

  const percent = canvasPointToPercent(point, width, height)
  if (filterId === "field-blur") {
    const pins = parseFieldBlurPins(String(normalized.pins ?? ""))
    const next = [...pins, { x: percent.x, y: percent.y, blur: numParam(normalized.blur, 12) }]
    return {
      params: withBlurGalleryControlState(
        filterId,
        syncFieldPinParams({ ...normalized, pins: formatFieldBlurPins(next) }, next.length - 1),
        {
          selectedFieldPinIndexes: [next.length - 1],
          selectedPathPointIndexes: [],
          activeControl: `field-pin:${next.length - 1}`,
          previewQuality: "interactive",
        },
      ),
      drag: { kind: "field-pin", index: next.length - 1 },
    }
  }

  if (filterId === "path-blur") {
    const points = parsePathBlurPoints(String(normalized.path ?? ""))
    const next = [...points, percent]
    return {
      params: withBlurGalleryControlState(
        filterId,
        syncPathParams({ ...normalized, path: formatPathBlurPoints(next) }),
        {
          selectedFieldPinIndexes: [],
          selectedPathPointIndexes: [next.length - 1],
          activeControl: `path-point:${next.length - 1}`,
          previewQuality: "interactive",
        },
      ),
      drag: { kind: "path-point", index: next.length - 1 },
    }
  }

  if (filterId === "spin-blur") {
    return {
      params: withBlurGalleryControlState(filterId, {
        ...normalized,
        centerX: round2(percent.x),
        centerY: round2(percent.y),
      }, {
        selectedFieldPinIndexes: [],
        selectedPathPointIndexes: [],
        activeControl: "spin-center",
        previewQuality: "interactive",
      }),
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
  const state = getSanitizedControlState(filterId, params)

  if (filterId === "field-blur" && (drag.kind === "field-pin" || drag.kind === "field-amount")) {
    const pins = parseFieldBlurPins(String(params.pins ?? ""))
    const pin = pins[drag.index]
    if (!pin) return params
    const next = pins.slice()
    if (drag.kind === "field-pin") {
      const selected = state.selectedFieldPinIndexes.includes(drag.index)
        ? state.selectedFieldPinIndexes
        : [drag.index]
      const dx = percent.x - pin.x
      const dy = percent.y - pin.y
      for (const index of selected) {
        const selectedPin = next[index]
        if (!selectedPin) continue
        next[index] = {
          ...selectedPin,
          x: round2(clampPercent(selectedPin.x + dx)),
          y: round2(clampPercent(selectedPin.y + dy)),
        }
      }
    } else {
      const center = percentToCanvasPoint(pin, width, height)
      next[drag.index] = { ...pin, blur: clampBlur(Math.hypot(point.x - center.x, point.y - center.y)) }
    }
    return withBlurGalleryControlState(
      filterId,
      syncFieldPinParams({ ...params, pins: formatFieldBlurPins(next) }, drag.index),
      { ...state, previewQuality: "interactive" },
    )
  }

  if (filterId === "iris-blur") {
    let next: BlurGalleryParams | null = null
    if (drag.kind === "iris-center") {
      next = { ...params, centerX: round2(percent.x), centerY: round2(percent.y) }
    } else {
      const center = percentToCanvasPoint({ x: numParam(params.centerX, 50), y: numParam(params.centerY, 50) }, width, height)
      const radiusPx = Math.max(1, Math.hypot(point.x - center.x, point.y - center.y))
      const radius = clampPercent((radiusPx * 2 / Math.max(1, width)) * 100)
      if (drag.kind === "iris-radius") {
        next = { ...params, radius: round2(radius) }
      }
      if (drag.kind === "iris-feather") {
        const baseRadius = Math.max(1, (Math.max(1, width) * numParam(params.radius, 42) / 100) * 0.5)
        const feather = clampPercent(((radiusPx / baseRadius) - 1) * 100)
        next = { ...params, feather: round2(feather) }
      }
    }
    if (next) {
      return withBlurGalleryControlState(filterId, next, {
        ...state,
        activeControl: drag.kind,
        previewQuality: "interactive",
      })
    }
  }

  if (filterId === "tilt-shift") {
    let next: BlurGalleryParams | null = null
    if (drag.kind === "tilt-center") {
      next = { ...params, centerX: round2(percent.x), centerY: round2(percent.y) }
    } else {
      const center = percentToCanvasPoint({ x: numParam(params.centerX, 50), y: numParam(params.centerY, 50) }, width, height)
      const normal = tiltNormal(numParam(params.angle, 0))
      const distance = Math.abs((point.x - center.x) * normal.x + (point.y - center.y) * normal.y)
      const minDim = Math.max(1, Math.min(width, height))
      if (drag.kind === "tilt-radius") {
        next = { ...params, radius: round2(clampPercent((distance * 2 / minDim) * 100)) }
      }
      if (drag.kind === "tilt-feather") {
        const clearBand = minDim * (numParam(params.radius, 30) / 100) * 0.5
        next = { ...params, feather: round2(clampPercent(((distance - clearBand) / minDim) * 100)) }
      }
      if (drag.kind === "tilt-angle") {
        const angle = Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI
        next = { ...params, angle: round2(angle) }
      }
    }
    if (next) {
      return withBlurGalleryControlState(filterId, next, {
        ...state,
        activeControl: drag.kind,
        previewQuality: "interactive",
      })
    }
  }

  if (filterId === "path-blur" && drag.kind === "path-point") {
    const points = parsePathBlurPoints(String(params.path ?? ""))
    const target = points[drag.index]
    if (!target) return params
    const selected = state.selectedPathPointIndexes.includes(drag.index)
      ? state.selectedPathPointIndexes
      : [drag.index]
    const dx = percent.x - target.x
    const dy = percent.y - target.y
    const next = points.slice()
    for (const index of selected) {
      const selectedPoint = next[index]
      if (!selectedPoint) continue
      next[index] = {
        x: round2(clampPercent(selectedPoint.x + dx)),
        y: round2(clampPercent(selectedPoint.y + dy)),
      }
    }
    return withBlurGalleryControlState(
      filterId,
      syncPathParams({ ...params, path: formatPathBlurPoints(next) }),
      { ...state, previewQuality: "interactive" },
    )
  }

  if (filterId === "spin-blur") {
    let next: BlurGalleryParams | null = null
    if (drag.kind === "spin-center") {
      next = { ...params, centerX: round2(percent.x), centerY: round2(percent.y) }
    }
    if (drag.kind === "spin-radius") {
      const center = percentToCanvasPoint({ x: numParam(params.centerX, 50), y: numParam(params.centerY, 50) }, width, height)
      const minDim = Math.max(1, Math.min(width, height))
      next = { ...params, radius: round2(clampPercent((Math.hypot(point.x - center.x, point.y - center.y) * 2 / minDim) * 100)) }
    }
    if (next) {
      return withBlurGalleryControlState(filterId, next, {
        ...state,
        activeControl: drag.kind,
        previewQuality: "interactive",
      })
    }
  }

  return params
}

export function applyBlurGalleryKeyboardCommand(
  filterId: BlurGalleryFilterId,
  params: BlurGalleryParams,
  command: BlurGalleryKeyboardCommand,
): BlurGalleryParams {
  const normalized = normalizeBlurGalleryParams(filterId, params)
  const state = getSanitizedControlState(filterId, setBlurGalleryControlState(normalized, command.selection ?? {}))

  if (command.kind === "clear-selection") {
    return withBlurGalleryControlState(filterId, normalized, {
      selectedFieldPinIndexes: [],
      selectedPathPointIndexes: [],
      activeControl: null,
      previewQuality: "full",
    })
  }

  if (command.kind === "select-next") {
    return selectNextControl(filterId, normalized, state, command.direction ?? 1)
  }

  if (filterId === "field-blur") {
    return applyFieldKeyboardCommand(normalized, state, command)
  }

  if (filterId === "path-blur") {
    return applyPathKeyboardCommand(normalized, state, command)
  }

  if (command.kind === "nudge" && (filterId === "iris-blur" || filterId === "tilt-shift" || filterId === "spin-blur")) {
    return withBlurGalleryControlState(filterId, {
      ...normalized,
      centerX: round2(clampPercent(numParam(normalized.centerX, 50) + command.dx)),
      centerY: round2(clampPercent(numParam(normalized.centerY, 50) + command.dy)),
    }, {
      ...state,
      activeControl: state.activeControl ?? `${filterId}:center`,
      previewQuality: "interactive",
    })
  }

  return withBlurGalleryControlState(filterId, normalized, state)
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

function selectBlurGalleryControl(
  filterId: BlurGalleryFilterId,
  params: BlurGalleryParams,
  hit: BlurGalleryDrag,
  multiSelect = false,
) {
  const state = getSanitizedControlState(filterId, params)
  let nextState: BlurGalleryControlState = {
    ...state,
    previewQuality: "interactive",
  }

  if (hit.kind === "field-pin" || hit.kind === "field-amount") {
    const selected = multiSelect
      ? uniqueSorted([...state.selectedFieldPinIndexes, hit.index])
      : [hit.index]
    nextState = {
      ...nextState,
      selectedFieldPinIndexes: selected,
      selectedPathPointIndexes: [],
      activeControl: `${hit.kind}:${hit.index}`,
    }
  } else if (hit.kind === "path-point") {
    const selected = multiSelect
      ? uniqueSorted([...state.selectedPathPointIndexes, hit.index])
      : [hit.index]
    nextState = {
      ...nextState,
      selectedFieldPinIndexes: [],
      selectedPathPointIndexes: selected,
      activeControl: `${hit.kind}:${hit.index}`,
    }
  } else {
    nextState = {
      ...nextState,
      selectedFieldPinIndexes: [],
      selectedPathPointIndexes: [],
      activeControl: hit.kind,
    }
  }

  return withBlurGalleryControlState(filterId, params, nextState)
}

function applyFieldKeyboardCommand(
  params: BlurGalleryParams,
  state: BlurGalleryControlState,
  command: BlurGalleryKeyboardCommand,
) {
  const pins = parseFieldBlurPins(String(params.pins ?? ""))
  const selected = state.selectedFieldPinIndexes.length > 0 ? state.selectedFieldPinIndexes : []
  if (pins.length === 0 || selected.length === 0) return withBlurGalleryControlState("field-blur", params, state)

  if (command.kind === "delete") {
    const selectedSet = new Set(selected)
    const next = pins.filter((_, index) => !selectedSet.has(index))
    if (next.length < 1) return withBlurGalleryControlState("field-blur", params, state)
    return withBlurGalleryControlState(
      "field-blur",
      syncFieldPinParams({ ...params, pins: formatFieldBlurPins(next) }, 0),
      { ...state, selectedFieldPinIndexes: [], activeControl: null, previewQuality: "interactive" },
    )
  }

  if (command.kind === "duplicate") {
    const offset = command.offset ?? 5
    const duplicates = selected
      .map((index) => pins[index])
      .filter((pin): pin is FieldBlurPin => !!pin)
      .map((pin) => ({
        ...pin,
        x: round2(clampPercent(pin.x + offset)),
        y: round2(clampPercent(pin.y + offset)),
      }))
    const next = [...pins, ...duplicates]
    const selectedFieldPinIndexes = duplicates.map((_, index) => pins.length + index)
    return withBlurGalleryControlState(
      "field-blur",
      syncFieldPinParams({ ...params, pins: formatFieldBlurPins(next) }, selectedFieldPinIndexes[0] ?? 0),
      {
        ...state,
        selectedFieldPinIndexes,
        activeControl: selectedFieldPinIndexes.length ? `field-pin:${selectedFieldPinIndexes[0]}` : null,
        previewQuality: "interactive",
      },
    )
  }

  if (command.kind === "nudge") {
    const selectedSet = new Set(selected)
    const next = pins.map((pin, index) => selectedSet.has(index)
      ? {
          ...pin,
          x: round2(clampPercent(pin.x + command.dx)),
          y: round2(clampPercent(pin.y + command.dy)),
        }
      : pin)
    return withBlurGalleryControlState(
      "field-blur",
      syncFieldPinParams({ ...params, pins: formatFieldBlurPins(next) }, selected[0] ?? 0),
      { ...state, previewQuality: "interactive" },
    )
  }

  return withBlurGalleryControlState("field-blur", params, state)
}

function applyPathKeyboardCommand(
  params: BlurGalleryParams,
  state: BlurGalleryControlState,
  command: BlurGalleryKeyboardCommand,
) {
  const points = parsePathBlurPoints(String(params.path ?? ""))
  const selected = state.selectedPathPointIndexes.length > 0 ? state.selectedPathPointIndexes : []
  if (points.length < 2 || selected.length === 0) return withBlurGalleryControlState("path-blur", params, state)

  if (command.kind === "delete") {
    const selectedSet = new Set(selected)
    const next = points.filter((_, index) => !selectedSet.has(index))
    if (next.length < 2) return withBlurGalleryControlState("path-blur", params, state)
    return withBlurGalleryControlState(
      "path-blur",
      syncPathParams({ ...params, path: formatPathBlurPoints(next) }),
      { ...state, selectedPathPointIndexes: [], activeControl: null, previewQuality: "interactive" },
    )
  }

  if (command.kind === "duplicate") {
    const offset = command.offset ?? 5
    const duplicates = selected
      .map((index) => points[index])
      .filter((point): point is PercentPoint => !!point)
      .map((point) => ({
        x: round2(clampPercent(point.x + offset)),
        y: round2(clampPercent(point.y + offset)),
      }))
    const next = [...points, ...duplicates]
    const selectedPathPointIndexes = duplicates.map((_, index) => points.length + index)
    return withBlurGalleryControlState(
      "path-blur",
      syncPathParams({ ...params, path: formatPathBlurPoints(next) }),
      {
        ...state,
        selectedPathPointIndexes,
        activeControl: selectedPathPointIndexes.length ? `path-point:${selectedPathPointIndexes[0]}` : null,
        previewQuality: "interactive",
      },
    )
  }

  if (command.kind === "nudge") {
    const selectedSet = new Set(selected)
    const next = points.map((pathPoint, index) => selectedSet.has(index)
      ? {
          x: round2(clampPercent(pathPoint.x + command.dx)),
          y: round2(clampPercent(pathPoint.y + command.dy)),
        }
      : pathPoint)
    return withBlurGalleryControlState(
      "path-blur",
      syncPathParams({ ...params, path: formatPathBlurPoints(next) }),
      { ...state, previewQuality: "interactive" },
    )
  }

  return withBlurGalleryControlState("path-blur", params, state)
}

function selectNextControl(
  filterId: BlurGalleryFilterId,
  params: BlurGalleryParams,
  state: BlurGalleryControlState,
  direction: 1 | -1,
) {
  if (filterId === "field-blur") {
    const pins = parseFieldBlurPins(String(params.pins ?? ""))
    if (pins.length === 0) return withBlurGalleryControlState(filterId, params, state)
    const current = state.selectedFieldPinIndexes[0] ?? (direction > 0 ? -1 : 0)
    const index = (current + direction + pins.length) % pins.length
    return withBlurGalleryControlState(filterId, params, {
      ...state,
      selectedFieldPinIndexes: [index],
      selectedPathPointIndexes: [],
      activeControl: `field-pin:${index}`,
      previewQuality: "full",
    })
  }

  if (filterId === "path-blur") {
    const points = parsePathBlurPoints(String(params.path ?? ""))
    const current = state.selectedPathPointIndexes[0] ?? (direction > 0 ? -1 : 0)
    const index = (current + direction + points.length) % points.length
    return withBlurGalleryControlState(filterId, params, {
      ...state,
      selectedFieldPinIndexes: [],
      selectedPathPointIndexes: [index],
      activeControl: `path-point:${index}`,
      previewQuality: "full",
    })
  }

  return withBlurGalleryControlState(filterId, params, {
    ...state,
    activeControl: state.activeControl ?? `${filterId}:center`,
    previewQuality: "full",
  })
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
  const angle = numParam(params.angle, 0)
  const normal = tiltNormal(angle)
  const tangent = tiltTangent(angle)
  const minDim = Math.max(1, Math.min(width, height))
  const angleHandle = {
    x: center.x + tangent.x * minDim * 0.24,
    y: center.y + tangent.y * minDim * 0.24,
  }
  if (Math.hypot(point.x - angleHandle.x, point.y - angleHandle.y) <= tolerance) return { kind: "tilt-angle" }
  const d = Math.abs((point.x - center.x) * normal.x + (point.y - center.y) * normal.y)
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

function withBlurGalleryControlState(
  filterId: BlurGalleryFilterId,
  params: BlurGalleryParams,
  state: BlurGalleryControlStatePatch,
): BlurGalleryParams {
  const next = sanitizeControlStateForParams(filterId, params, normalizeControlState({
    ...getBlurGalleryControlState(params),
    ...state,
  }))
  return {
    ...params,
    [BLUR_GALLERY_CONTROL_STATE_KEY]: formatBlurGalleryControlState(next),
  }
}

function getSanitizedControlState(filterId: BlurGalleryFilterId, params: BlurGalleryParams) {
  return sanitizeControlStateForParams(filterId, params, getBlurGalleryControlState(params))
}

function sanitizeControlStateForParams(
  filterId: BlurGalleryFilterId,
  params: BlurGalleryParams,
  state: BlurGalleryControlState,
): BlurGalleryControlState {
  if (filterId === "field-blur") {
    return {
      ...state,
      selectedFieldPinIndexes: normalizeIndexes(state.selectedFieldPinIndexes, parseFieldBlurPins(String(params.pins ?? "")).length),
      selectedPathPointIndexes: [],
    }
  }

  if (filterId === "path-blur") {
    return {
      ...state,
      selectedFieldPinIndexes: [],
      selectedPathPointIndexes: normalizeIndexes(state.selectedPathPointIndexes, parsePathBlurPoints(String(params.path ?? "")).length),
    }
  }

  return {
    ...state,
    selectedFieldPinIndexes: [],
    selectedPathPointIndexes: [],
  }
}

function normalizeControlState(value: Partial<BlurGalleryControlState> | null | undefined): BlurGalleryControlState {
  return {
    selectedFieldPinIndexes: normalizeIndexes(value?.selectedFieldPinIndexes, Number.POSITIVE_INFINITY),
    selectedPathPointIndexes: normalizeIndexes(value?.selectedPathPointIndexes, Number.POSITIVE_INFINITY),
    activeControl: typeof value?.activeControl === "string" ? value.activeControl : null,
    previewQuality: value?.previewQuality === "interactive" ? "interactive" : "full",
  }
}

function formatBlurGalleryControlState(state: BlurGalleryControlState) {
  return JSON.stringify({
    selectedFieldPinIndexes: state.selectedFieldPinIndexes,
    selectedPathPointIndexes: state.selectedPathPointIndexes,
    activeControl: state.activeControl,
    previewQuality: state.previewQuality,
  })
}

function normalizeIndexes(value: unknown, count: number) {
  if (!Array.isArray(value)) return []
  return uniqueSorted(value
    .map((index) => Math.round(Number(index)))
    .filter((index) => Number.isFinite(index) && index >= 0 && index < count))
}

function uniqueSorted(values: number[]) {
  return [...new Set(values)].sort((a, b) => a - b)
}

function hasControlState(params: BlurGalleryParams) {
  return Object.prototype.hasOwnProperty.call(params, BLUR_GALLERY_CONTROL_STATE_KEY)
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

function tiltTangent(angle: number) {
  const radians = angle * Math.PI / 180
  return { x: Math.cos(radians), y: Math.sin(radians) }
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

function sanitizeResourceParams(params: BlurGalleryParams): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {}
  for (const key of Object.keys(params).sort()) {
    const value = params[key]
    if (typeof value === "number" && Number.isFinite(value)) out[key] = round2(value)
    else if (typeof value === "string" || typeof value === "boolean") out[key] = value
  }
  return out
}

function buildBlurGalleryMeshDescriptor(
  filterId: BlurGalleryFilterId,
  params: BlurGalleryParams,
): BlurGalleryMeshResource["descriptor"]["mesh"] {
  switch (filterId) {
    case "field-blur": {
      const pins = parseFieldBlurPins(String(params.pins ?? ""))
      return {
        kind: "field",
        pins,
        falloff: round2(numParam(params.falloff, 45)),
        blur: round2(numParam(params.blur, pins[0]?.blur ?? 12)),
      }
    }
    case "iris-blur":
      return {
        kind: "iris",
        center: { x: round2(numParam(params.centerX, 50)), y: round2(numParam(params.centerY, 50)) },
        radius: round2(numParam(params.radius, 42)),
        feather: round2(numParam(params.feather, 30)),
        blur: round2(numParam(params.blur, 14)),
      }
    case "tilt-shift":
      return {
        kind: "tilt",
        center: { x: round2(numParam(params.centerX, 50)), y: round2(numParam(params.centerY, 50)) },
        angle: round2(numParam(params.angle, 0)),
        radius: round2(numParam(params.radius, 30)),
        feather: round2(numParam(params.feather, 30)),
        blur: round2(numParam(params.blur, 16)),
      }
    case "path-blur": {
      const points = parsePathBlurPoints(String(params.path ?? ""))
      return {
        kind: "path",
        points,
        distance: round2(numParam(params.distance, 24)),
        taper: round2(numParam(params.taper, 18)),
        angle: round2(numParam(syncPathParams({ ...params, path: formatPathBlurPoints(points) }).angle, 0)),
      }
    }
    case "spin-blur":
      return {
        kind: "spin",
        center: { x: round2(numParam(params.centerX, 50)), y: round2(numParam(params.centerY, 50)) },
        radius: round2(numParam(params.radius, 55)),
        amount: round2(numParam(params.amount, 28)),
      }
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`
}

function base64Encode(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)))
  }
  if (typeof btoa === "function") return btoa(binary)
  return Buffer.from(binary, "binary").toString("base64")
}

function base64Decode(value: string): Uint8Array {
  const binary = typeof atob === "function" ? atob(value) : Buffer.from(value, "base64").toString("binary")
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function checksumHex(bytes: Uint8Array): string {
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}
