import type { BrushSettings } from "./types"

export type BrushInputControl = "off" | "pressure" | "tilt" | "velocity" | "fade" | "random"

export interface BrushDynamicsInput {
  pressure: number
  tiltX: number
  tiltY: number
  twist: number
  velocity: number
  fade: number
  strokeAngle: number
}

export interface BrushPointerSample {
  x: number
  y: number
  time: number
  pressure: number
  tiltX: number
  tiltY: number
  twist: number
  velocity?: number
  pointerType?: string
}

export interface BrushStamp {
  x: number
  y: number
  size: number
  angle: number
  roundness: number
  opacity: number
  flow: number
  input: BrushDynamicsInput
}

export interface BrushEngineOptions {
  seed?: number
  velocityAffectsSpacing?: boolean
  velocityReference?: number
  velocitySpacingScale?: number
}

interface PointerLike {
  clientX?: number
  clientY?: number
  timeStamp?: number
  pointerType?: string
  pressure?: number
  tiltX?: number
  tiltY?: number
  twist?: number
  tangentialPressure?: number
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const clamp01 = (value: number) => clamp(value, 0, 1)

function finiteOr(value: unknown, fallback: number) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function seededRandom(seed = 1) {
  let state = Math.abs(Math.floor(seed)) % 1000
  return () => {
    state = (state * 37 + 17) % 1000
    return state / 1000
  }
}

function normalizeTwist(value: unknown) {
  const twist = finiteOr(value, 0)
  return ((twist % 360) + 360) % 360
}

function pointerPressure(pointerType: string | undefined, pressure: unknown) {
  if (pointerType === "mouse") return 1
  const n = finiteOr(pressure, 1)
  return n > 0 ? clamp01(n) : 1
}

export function normalizeBrushPointerSample(
  event: PointerLike,
  point: { x: number; y: number },
  previous?: Pick<BrushPointerSample, "x" | "y" | "time"> | null,
): BrushPointerSample {
  const time = finiteOr(event.timeStamp, previous ? previous.time : 0)
  const dt = previous ? Math.max(0, time - previous.time) : 0
  const dist = previous ? Math.hypot(point.x - previous.x, point.y - previous.y) : 0
  const velocity = dt > 0 ? (dist / dt) * 1000 : 0
  const pointerType = event.pointerType ?? "mouse"
  return {
    x: point.x,
    y: point.y,
    time,
    pressure: pointerPressure(pointerType, event.pressure),
    tiltX: clamp(finiteOr(event.tiltX, 0), -90, 90),
    tiltY: clamp(finiteOr(event.tiltY, 0), -90, 90),
    twist: normalizeTwist(event.twist),
    velocity,
    pointerType,
  }
}

function tiltAmount(brush: BrushSettings, input: BrushDynamicsInput) {
  return clamp01(
    Math.hypot(
      input.tiltX + (brush.pose?.tiltX ?? 0),
      input.tiltY + (brush.pose?.tiltY ?? 0),
    ) / 90,
  )
}

function controlValue(
  brush: BrushSettings,
  control: BrushInputControl | undefined,
  input: BrushDynamicsInput,
  random: () => number,
  velocityReference: number,
) {
  switch (control) {
    case "pressure":
      return clamp01(input.pressure)
    case "tilt":
      return tiltAmount(brush, input)
    case "velocity":
      return clamp01(input.velocity / velocityReference)
    case "fade":
      return clamp01(1 - input.fade / 220)
    case "random":
      return random()
    default:
      return 1
  }
}

function resolveWithRandom(
  brush: BrushSettings,
  input: BrushDynamicsInput,
  random: () => number,
  options: BrushEngineOptions,
): Omit<BrushStamp, "x" | "y"> {
  const velocityReference = Math.max(1, options.velocityReference ?? 1000)
  const minDiameter = clamp01((brush.minDiameter ?? 0) / 100)
  let sizeScale = 1
  if ((brush.sizeControl ?? "off") !== "off") {
    const v = controlValue(brush, brush.sizeControl, input, random, velocityReference)
    sizeScale = minDiameter + (1 - minDiameter) * v
  }
  if ((brush.sizeJitter ?? 0) > 0) {
    sizeScale *= 1 - random() * clamp01((brush.sizeJitter ?? 0) / 100) * (1 - minDiameter)
  }

  const poseRotation = ((brush.pose?.rotation ?? 0) + (brush.pose?.stylusAngle ?? 0) + input.twist) * (Math.PI / 180)
  let angle = poseRotation
  if (brush.angleControl === "tilt") {
    angle += Math.atan2(input.tiltY + (brush.pose?.tiltY ?? 0), input.tiltX + (brush.pose?.tiltX ?? 0))
  } else if (brush.angleControl === "velocity") {
    angle += input.strokeAngle
  } else if ((brush.angleControl ?? "off") !== "off") {
    const v = controlValue(brush, brush.angleControl, input, random, velocityReference)
    angle += (v - 0.5) * 2 * ((brush.angleJitter ?? 0) * Math.PI / 180)
  }
  if ((brush.angleJitter ?? 0) > 0) {
    angle += (random() - 0.5) * 2 * (brush.angleJitter ?? 0) * (Math.PI / 180)
  }

  let roundness = 1
  if ((brush.roundnessControl ?? "off") !== "off") {
    roundness = 0.1 + controlValue(brush, brush.roundnessControl, input, random, velocityReference) * 0.9
  }
  if ((brush.roundnessJitter ?? 0) > 0) {
    roundness *= 1 - random() * clamp01((brush.roundnessJitter ?? 0) / 100)
  }

  let opacityScale = (brush.opacityControl ?? "off") !== "off"
    ? controlValue(brush, brush.opacityControl, input, random, velocityReference)
    : 1
  let flowScale = (brush.flowControl ?? "off") !== "off"
    ? controlValue(brush, brush.flowControl, input, random, velocityReference)
    : 1
  if ((brush.opacityJitter ?? 0) > 0) opacityScale *= 1 - random() * clamp01((brush.opacityJitter ?? 0) / 100)
  if ((brush.flowJitter ?? 0) > 0) flowScale *= 1 - random() * clamp01((brush.flowJitter ?? 0) / 100)
  if (brush.pose?.pressure !== undefined && (brush.opacityControl ?? "off") === "off") {
    opacityScale *= Math.max(0.05, brush.pose.pressure / 100)
  }

  return {
    size: Math.max(1, brush.size * sizeScale),
    angle,
    roundness: clamp(roundness, 0.08, 1),
    opacity: clamp01((brush.opacity / 100) * opacityScale),
    flow: clamp01((brush.flow / 100) * flowScale),
    input,
  }
}

export function resolveBrushStamp(
  brush: BrushSettings,
  input: BrushDynamicsInput,
  options: BrushEngineOptions = {},
): Omit<BrushStamp, "x" | "y"> {
  return resolveWithRandom(brush, input, seededRandom(options.seed), options)
}

function normalizeSamples(samples: readonly BrushPointerSample[]) {
  return samples.map((sample, index) => {
    const previous = samples[index - 1]
    const dt = previous ? Math.max(0, sample.time - previous.time) : 0
    const dist = previous ? Math.hypot(sample.x - previous.x, sample.y - previous.y) : 0
    return {
      ...sample,
      pressure: clamp01(finiteOr(sample.pressure, 1)),
      tiltX: clamp(finiteOr(sample.tiltX, 0), -90, 90),
      tiltY: clamp(finiteOr(sample.tiltY, 0), -90, 90),
      twist: normalizeTwist(sample.twist),
      velocity: sample.velocity ?? (dt > 0 ? (dist / dt) * 1000 : 0),
    }
  })
}

function inputAt(
  from: BrushPointerSample,
  to: BrushPointerSample,
  t: number,
  fade: number,
  strokeAngle: number,
): BrushDynamicsInput {
  const mix = (a: number, b: number) => a + (b - a) * t
  return {
    pressure: clamp01(mix(from.pressure, to.pressure)),
    tiltX: mix(from.tiltX, to.tiltX),
    tiltY: mix(from.tiltY, to.tiltY),
    twist: mix(from.twist, to.twist),
    velocity: mix(from.velocity ?? 0, to.velocity ?? 0),
    fade,
    strokeAngle,
  }
}

function spacingFor(brush: BrushSettings, velocity: number, options: BrushEngineOptions) {
  const base = Math.max(1, brush.size * ((brush.spacing ?? 25) / 100))
  if (!options.velocityAffectsSpacing) return base
  const velocityReference = Math.max(1, options.velocityReference ?? 1000)
  const scale = options.velocitySpacingScale ?? 0.75
  return base * (1 + clamp01(velocity / velocityReference) * scale)
}

function appendScatteredStamps(
  stamps: BrushStamp[],
  brush: BrushSettings,
  x: number,
  y: number,
  input: BrushDynamicsInput,
  random: () => number,
  options: BrushEngineOptions,
) {
  const scatter = Math.max(0, brush.scatter ?? 0)
  let count = Math.max(1, Math.round(brush.scatterCount ?? 1))
  const countJitter = clamp01((brush.scatterCountJitter ?? 0) / 100)
  if (countJitter > 0) count = Math.max(1, Math.round(count * (1 - random() * countJitter)))
  for (let i = 0; i < count; i++) {
    let sx = x
    let sy = y
    if (scatter > 0) {
      const offset = (random() - 0.5) * 2 * (scatter / 100) * brush.size
      sx += -Math.sin(input.strokeAngle) * offset
      sy += Math.cos(input.strokeAngle) * offset
    }
    stamps.push({ x: sx, y: sy, ...resolveWithRandom(brush, input, random, options) })
  }
}

export function planBrushStroke(
  brush: BrushSettings,
  rawSamples: readonly BrushPointerSample[],
  options: BrushEngineOptions = {},
): BrushStamp[] {
  const samples = normalizeSamples(rawSamples)
  if (samples.length === 0) return []
  const random = seededRandom(options.seed)
  const stamps: BrushStamp[] = []
  let fade = 0
  const first = samples[0]
  appendScatteredStamps(
    stamps,
    brush,
    first.x,
    first.y,
    inputAt(first, first, 1, fade++, 0),
    random,
    options,
  )

  for (let i = 1; i < samples.length; i++) {
    const from = samples[i - 1]
    const to = samples[i]
    const dx = to.x - from.x
    const dy = to.y - from.y
    const dist = Math.hypot(dx, dy)
    if (dist <= 0) continue
    const strokeAngle = Math.atan2(dy, dx)
    const spacing = spacingFor(brush, to.velocity ?? 0, options)
    for (let walked = spacing; walked <= dist + 1e-9; walked += spacing) {
      const t = walked / dist
      appendScatteredStamps(
        stamps,
        brush,
        from.x + dx * t,
        from.y + dy * t,
        inputAt(from, to, t, fade++, strokeAngle),
        random,
        options,
      )
    }
  }
  return stamps
}
