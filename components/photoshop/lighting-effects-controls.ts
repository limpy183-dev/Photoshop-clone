export type LightingEffectsParamValue = number | string | boolean
export type LightingEffectsParams = Record<string, LightingEffectsParamValue>

export const LIGHTING_EFFECTS_CONTROL_STATE_KEY = "__lightingEffectsControlState"

export interface LightingEffectsPoint {
  x: number
  y: number
}

export interface LightingEffectsLight {
  type: "spot" | "point" | "directional" | "omni"
  x: number
  y: number
  z: number
  intensity: number
  color: [number, number, number]
  radius: number
  focus: number
  angleX?: number
  angleY?: number
}

export type LightingEffectsPreviewQuality = "full" | "interactive"

export interface LightingEffectsControlState {
  selectedLightIndex: number | null
  activeControl: string | null
  previewQuality: LightingEffectsPreviewQuality
}

export type LightingEffectsDrag =
  | { kind: "light-position"; index: number }
  | { kind: "light-radius"; index: number }
  | { kind: "light-focus"; index: number }
  | { kind: "light-intensity"; index: number }

export interface LightingEffectsInteraction {
  params: LightingEffectsParams
  drag: LightingEffectsDrag | null
}

const EMPTY_CONTROL_STATE: LightingEffectsControlState = {
  selectedLightIndex: null,
  activeControl: null,
  previewQuality: "full",
}

export function normalizeLightingEffectsParams(params: LightingEffectsParams): LightingEffectsParams {
  const lights = parseLightingEffectsLights(String(params.lights ?? ""))
  const nextLights = lights.length > 0
    ? lights
    : defaultLightsForStyle(String(params.style ?? "spot"), Number(params.intensity ?? 120))
  const selected = getLightingEffectsControlState(params).selectedLightIndex ?? 0
  return withLightingEffectsControlState({
    ...params,
    lights: formatLightingEffectsLights(nextLights),
  }, {
    selectedLightIndex: Math.min(nextLights.length - 1, Math.max(0, selected)),
    activeControl: getLightingEffectsControlState(params).activeControl,
    previewQuality: getLightingEffectsControlState(params).previewQuality,
  })
}

export function parseLightingEffectsLights(raw: string): LightingEffectsLight[] {
  if (!raw.trim()) return []
  try {
    const value = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value
      .map((entry) => normalizeLight(entry))
      .filter((entry): entry is LightingEffectsLight => entry !== null)
  } catch {
    return []
  }
}

export function formatLightingEffectsLights(lights: LightingEffectsLight[]) {
  return JSON.stringify(lights.map((light) => ({
    type: light.type,
    x: round3(clamp01(light.x)),
    y: round3(clamp01(light.y)),
    z: round3(Math.max(0.05, Math.min(1, light.z))),
    intensity: round3(Math.max(0, Math.min(2.5, light.intensity))),
    color: light.color.map((channel) => clamp8(channel)) as [number, number, number],
    radius: round3(Math.max(0.05, Math.min(1.5, light.radius))),
    focus: round3(clamp01(light.focus)),
    ...(Number.isFinite(light.angleX) ? { angleX: round3(light.angleX ?? 0) } : {}),
    ...(Number.isFinite(light.angleY) ? { angleY: round3(light.angleY ?? 0) } : {}),
  })))
}

export function getLightingEffectsControlState(params: LightingEffectsParams): LightingEffectsControlState {
  const raw = params[LIGHTING_EFFECTS_CONTROL_STATE_KEY]
  if (typeof raw !== "string" || !raw.trim()) return { ...EMPTY_CONTROL_STATE }
  try {
    const parsed = JSON.parse(raw) as Partial<LightingEffectsControlState>
    return {
      selectedLightIndex: Number.isFinite(Number(parsed.selectedLightIndex)) ? Math.max(0, Math.round(Number(parsed.selectedLightIndex))) : null,
      activeControl: typeof parsed.activeControl === "string" ? parsed.activeControl : null,
      previewQuality: parsed.previewQuality === "interactive" ? "interactive" : "full",
    }
  } catch {
    return { ...EMPTY_CONTROL_STATE }
  }
}

export function finishLightingEffectsInteraction(params: LightingEffectsParams): LightingEffectsParams {
  return withLightingEffectsControlState(params, {
    ...getLightingEffectsControlState(params),
    previewQuality: "full",
  })
}

export function beginLightingEffectsInteraction(
  params: LightingEffectsParams,
  point: LightingEffectsPoint,
  width: number,
  height: number,
  tolerance = 10,
): LightingEffectsInteraction {
  const normalized = normalizeLightingEffectsParams(params)
  const hit = hitTestLightingEffectsControl(normalized, point, width, height, tolerance)
  if (hit) {
    return {
      params: withLightingEffectsControlState(normalized, {
        selectedLightIndex: hit.index,
        activeControl: `${hit.kind}:${hit.index}`,
        previewQuality: "interactive",
      }),
      drag: hit,
    }
  }

  const lights = parseLightingEffectsLights(String(normalized.lights ?? ""))
  const added: LightingEffectsLight = {
    type: "spot",
    x: round3(point.x / Math.max(1, width)),
    y: round3(point.y / Math.max(1, height)),
    z: 0.55,
    intensity: Math.max(0.1, Number(normalized.intensity ?? 120) / 100),
    color: [255, 240, 210],
    radius: 0.45,
    focus: 0.4,
  }
  const index = lights.length
  return {
    params: withLightingEffectsControlState({
      ...normalized,
      lights: formatLightingEffectsLights([...lights, added]),
    }, {
      selectedLightIndex: index,
      activeControl: `light-position:${index}`,
      previewQuality: "interactive",
    }),
    drag: { kind: "light-position", index },
  }
}

export function updateLightingEffectsInteraction(
  params: LightingEffectsParams,
  drag: LightingEffectsDrag,
  point: LightingEffectsPoint,
  width: number,
  height: number,
): LightingEffectsParams {
  const normalized = normalizeLightingEffectsParams(params)
  const lights = parseLightingEffectsLights(String(normalized.lights ?? ""))
  const light = lights[drag.index]
  if (!light) return normalized
  const next = lights.slice()
  const center = { x: light.x * width, y: light.y * height }
  const minDim = Math.max(1, Math.min(width, height))
  const radiusPx = Math.max(1, light.radius * minDim)
  const distance = Math.hypot(point.x - center.x, point.y - center.y)

  if (drag.kind === "light-position") {
    next[drag.index] = {
      ...light,
      x: round3(clamp01(point.x / Math.max(1, width))),
      y: round3(clamp01(point.y / Math.max(1, height))),
    }
  } else if (drag.kind === "light-radius") {
    next[drag.index] = {
      ...light,
      radius: round3(Math.max(0.05, Math.min(1.5, distance / minDim))),
    }
  } else if (drag.kind === "light-focus") {
    next[drag.index] = {
      ...light,
      focus: round3(clamp01(distance / Math.max(1, radiusPx * 0.5))),
    }
  } else if (drag.kind === "light-intensity") {
    next[drag.index] = {
      ...light,
      intensity: round3(Math.max(0, Math.min(2.5, Math.max(0, center.y - point.y) / Math.max(1, radiusPx * 0.5)))),
    }
  }

  return withLightingEffectsControlState({
    ...normalized,
    lights: formatLightingEffectsLights(next),
  }, {
    selectedLightIndex: drag.index,
    activeControl: `${drag.kind}:${drag.index}`,
    previewQuality: "interactive",
  })
}

export function hitTestLightingEffectsControl(
  params: LightingEffectsParams,
  point: LightingEffectsPoint,
  width: number,
  height: number,
  tolerance = 10,
): LightingEffectsDrag | null {
  const lights = parseLightingEffectsLights(String(params.lights ?? ""))
  const minDim = Math.max(1, Math.min(width, height))
  for (let index = lights.length - 1; index >= 0; index--) {
    const light = lights[index]
    const center = { x: light.x * width, y: light.y * height }
    const radiusPx = Math.max(1, light.radius * minDim)
    if (Math.hypot(point.x - center.x, point.y - center.y) <= tolerance) {
      return { kind: "light-position", index }
    }
    const amountHandle = { x: center.x, y: center.y - radiusPx * Math.max(0.2, light.intensity * 0.5) }
    if (Math.hypot(point.x - amountHandle.x, point.y - amountHandle.y) <= tolerance) {
      return { kind: "light-intensity", index }
    }
    const focusHandle = { x: center.x + radiusPx * 0.5 * light.focus, y: center.y }
    if (Math.hypot(point.x - focusHandle.x, point.y - focusHandle.y) <= tolerance) {
      return { kind: "light-focus", index }
    }
    const distance = Math.hypot(point.x - center.x, point.y - center.y)
    if (Math.abs(point.y - center.y) <= tolerance && distance >= Math.min(18, radiusPx * 0.35)) {
      return { kind: "light-radius", index }
    }
  }
  return null
}

function withLightingEffectsControlState(
  params: LightingEffectsParams,
  state: Partial<LightingEffectsControlState>,
): LightingEffectsParams {
  const next = {
    ...getLightingEffectsControlState(params),
    ...state,
  }
  return {
    ...params,
    [LIGHTING_EFFECTS_CONTROL_STATE_KEY]: JSON.stringify({
      selectedLightIndex: next.selectedLightIndex,
      activeControl: next.activeControl,
      previewQuality: next.previewQuality,
    }),
  }
}

function defaultLightsForStyle(style: string, intensityPercent: number): LightingEffectsLight[] {
  const intensity = Math.max(0, intensityPercent) / 100
  if (style === "directional") {
    return [{ type: "directional", x: 0.5, y: 0.5, z: 0.7, intensity, color: [255, 240, 215], radius: 0.8, focus: 0.5, angleX: -0.5, angleY: -0.7 }]
  }
  if (style === "omni" || style === "point") {
    return [{ type: "point", x: 0.5, y: 0.5, z: 0.45, intensity, color: [255, 245, 230], radius: 0.7, focus: 0.5 }]
  }
  if (style === "three-point") {
    return [
      { type: "spot", x: 0.32, y: 0.3, z: 0.55, intensity, color: [255, 235, 200], radius: 0.55, focus: 0.45 },
      { type: "spot", x: 0.72, y: 0.4, z: 0.4, intensity: intensity * 0.55, color: [200, 220, 255], radius: 0.5, focus: 0.35 },
      { type: "point", x: 0.5, y: 0.85, z: 0.3, intensity: intensity * 0.35, color: [255, 215, 180], radius: 0.65, focus: 0.5 },
    ]
  }
  if (style === "rgb-trio") {
    return [
      { type: "spot", x: 0.25, y: 0.35, z: 0.5, intensity, color: [255, 60, 60], radius: 0.55, focus: 0.4 },
      { type: "spot", x: 0.55, y: 0.3, z: 0.5, intensity, color: [60, 255, 80], radius: 0.55, focus: 0.4 },
      { type: "spot", x: 0.75, y: 0.5, z: 0.5, intensity, color: [60, 80, 255], radius: 0.55, focus: 0.4 },
    ]
  }
  return [{ type: "spot", x: 0.45, y: 0.35, z: 0.6, intensity, color: [255, 240, 215], radius: 0.6, focus: 0.4 }]
}

function normalizeLight(input: unknown): LightingEffectsLight | null {
  if (!input || typeof input !== "object") return null
  const value = input as Record<string, unknown>
  const rawType = value.type
  const type = rawType === "point" || rawType === "directional" || rawType === "omni" || rawType === "spot" ? rawType : "spot"
  const colorValue = Array.isArray(value.color) ? value.color : [255, 255, 255]
  return {
    type,
    x: clamp01(Number(value.x ?? 0.5)),
    y: clamp01(Number(value.y ?? 0.5)),
    z: Math.max(0.05, Math.min(1, Number(value.z ?? 0.55))),
    intensity: Math.max(0, Math.min(2.5, Number(value.intensity ?? 1))),
    color: [
      clamp8(Number(colorValue[0] ?? 255)),
      clamp8(Number(colorValue[1] ?? 255)),
      clamp8(Number(colorValue[2] ?? 255)),
    ],
    radius: Math.max(0.05, Math.min(1.5, Number(value.radius ?? 0.6))),
    focus: clamp01(Number(value.focus ?? 0.4)),
    angleX: Number.isFinite(Number(value.angleX)) ? Number(value.angleX) : undefined,
    angleY: Number.isFinite(Number(value.angleY)) ? Number(value.angleY) : undefined,
  }
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function clamp8(value: number) {
  return Math.max(0, Math.min(255, Math.round(Number.isFinite(value) ? value : 0)))
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000
}
