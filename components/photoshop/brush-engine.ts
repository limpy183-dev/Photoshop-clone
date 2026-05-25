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
  tipState?: BrushTipSimulation
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

export interface BrushRgba {
  r: number
  g: number
  b: number
  a?: number
}

export interface ErodibleTipSimulation {
  kind: "erodible"
  wear: number
  sizeScale: number
  roundnessScale: number
  angle: number
  softness: number
  alphaScale: number
  edge: Array<{ angle: number; radiusScale: number }>
}

export interface BristleTipSimulation {
  kind: "bristle"
  coverage: number
  wetness: number
  bristles: Array<{
    offset: number
    length: number
    thickness: number
    bend: number
    alpha: number
  }>
}

export type BrushTipSimulation = ErodibleTipSimulation | BristleTipSimulation

export interface MixerReservoirStepInput {
  reservoir: Required<BrushRgba>
  sample: Required<BrushRgba>
  settings: {
    wet: number
    load: number
    mix: number
    flow?: number
  }
  pressure?: number
}

export interface MixerReservoirStep {
  paintColor: Required<BrushRgba>
  nextReservoir: Required<BrushRgba>
  depositAlpha: number
  pickupAlpha: number
}

export interface ColorReplacementPixelInput {
  source: Required<BrushRgba>
  sample: Required<BrushRgba>
  replacement: Required<BrushRgba>
  tolerance: number
  mode: NonNullable<BrushSettings["colorReplacement"]>["mode"]
  opacity?: number
}

export interface ColorReplacementPixelResult {
  pixel: Required<BrushRgba>
  changed: boolean
  distance: number
}

export interface ArtHistoryDab {
  dx: number
  dy: number
  sourceDx: number
  sourceDy: number
  rotation: number
  scale: number
  opacity: number
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

function percent(value: unknown, fallback: number) {
  return clamp01(finiteOr(value, fallback) / 100)
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function normalizeRgba(color: BrushRgba): Required<BrushRgba> {
  return {
    r: clampByte(color.r),
    g: clampByte(color.g),
    b: clampByte(color.b),
    a: clamp01(color.a ?? 1),
  }
}

function mixByte(a: number, b: number, amount: number) {
  return clampByte(a + (b - a) * clamp01(amount))
}

function mixRgba(a: Required<BrushRgba>, b: Required<BrushRgba>, amount: number): Required<BrushRgba> {
  const t = clamp01(amount)
  return {
    r: mixByte(a.r, b.r, t),
    g: mixByte(a.g, b.g, t),
    b: mixByte(a.b, b.b, t),
    a: clamp01(a.a + (b.a - a.a) * t),
  }
}

function rgbToHsl(color: Required<BrushRgba>): [number, number, number] {
  const r = color.r / 255
  const g = color.g / 255
  const b = color.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  if (max === min) return [0, 0, lightness]
  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue = 0
  if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0)
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4
  return [hue / 6, saturation, lightness]
}

function hslToRgb(hue: number, saturation: number, lightness: number): Required<BrushRgba> {
  const h = ((hue % 1) + 1) % 1
  const s = clamp01(saturation)
  const l = clamp01(lightness)
  if (s === 0) {
    const v = clampByte(l * 255)
    return { r: v, g: v, b: v, a: 1 }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t0: number) => {
    let t = t0
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return {
    r: clampByte(channel(h + 1 / 3) * 255),
    g: clampByte(channel(h) * 255),
    b: clampByte(channel(h - 1 / 3) * 255),
    a: 1,
  }
}

export function resolveErodibleTipSimulation(
  brush: BrushSettings,
  input: BrushDynamicsInput,
  options: BrushEngineOptions = {},
): ErodibleTipSimulation {
  const tip = brush.erodibleTip
  const random = seededRandom(options.seed)
  const sharpness = percent(tip?.sharpness, 70)
  const flatness = percent(tip?.flatness, 35)
  const erosionRate = percent(tip?.erosionRate, 50)
  const softness = percent(tip?.softness, 20)
  const aspectRatio = clamp(percent(tip?.aspectRatio, 80), 0.15, 1)
  const pressure = clamp01(input.pressure)
  const tilt = tiltAmount(brush, input)
  const strokeWear = clamp01(input.fade / 160)
  const wear = clamp01(erosionRate * strokeWear * (0.55 + pressure * 0.45) * (1 + tilt * 0.35))
  const angle =
    ((tip?.rotation ?? 0) * Math.PI) / 180 +
    input.strokeAngle * (0.25 + flatness * 0.35) +
    input.twist * (Math.PI / 180) +
    (tilt > 0 ? Math.atan2(input.tiltY, input.tiltX) * tilt * 0.35 : 0)
  const sizeScale = clamp(1 - wear * (0.08 + sharpness * 0.12), 0.62, 1.08)
  const roundnessScale = clamp(aspectRatio * (1 - flatness * 0.45) * (1 - wear * 0.25), 0.08, 1)
  const alphaScale = clamp(1 - wear * (0.08 + softness * 0.2), 0.58, 1)
  const edge = Array.from({ length: 24 }, (_, index) => {
    const angleAtPoint = (index / 24) * Math.PI * 2
    const grain = random()
    const flatCut = Math.abs(Math.sin(angleAtPoint - angle)) * flatness * 0.18
    const chipped = wear * (0.08 + grain * 0.22) * (0.55 + sharpness * 0.45)
    const softened = softness * 0.04
    return {
      angle: angleAtPoint,
      radiusScale: clamp(1 - flatCut - chipped + softened, 0.42, 1.05),
    }
  })
  return {
    kind: "erodible",
    wear,
    sizeScale,
    roundnessScale,
    angle,
    softness,
    alphaScale,
    edge,
  }
}

export function resolveBristleTipSimulation(
  brush: BrushSettings,
  input: BrushDynamicsInput,
  options: BrushEngineOptions = {},
): BristleTipSimulation {
  const tip = brush.bristleTip
  const random = seededRandom(options.seed)
  const length = percent(tip?.length, 65)
  const density = percent(tip?.density, 55)
  const thickness = percent(tip?.thickness, 35)
  const stiffness = percent(tip?.stiffness, 55)
  const splay = percent(tip?.splay, 35)
  const wetness = percent(tip?.wetness, 25)
  const pressure = clamp01(input.pressure)
  const tilt = tiltAmount(brush, input)
  const count = Math.max(4, Math.round(6 + density * 54))
  const coverage = clamp((density * 0.52 + wetness * 0.24 + pressure * 0.24) * (1 - splay * 0.16), 0.08, 0.98)
  const bendBase =
    (Math.cos(input.strokeAngle) * input.tiltX + Math.sin(input.strokeAngle) * input.tiltY) / 90 +
    tilt * 0.35
  const bristles = Array.from({ length: count }, (_, index) => {
    const lateral = count === 1 ? 0 : index / (count - 1) * 2 - 1
    const split = (random() - 0.5) * splay * (0.25 + pressure * 0.75)
    const alpha = clamp(0.22 + wetness * 0.36 + random() * 0.38 + pressure * 0.16, 0.12, 1)
    return {
      offset: lateral * (0.55 + splay * 0.55) + split,
      length: clamp(0.35 + length * 0.85 + random() * 0.22 - pressure * 0.08, 0.22, 1.35),
      thickness: clamp(0.25 + thickness * 1.25 + wetness * 0.35 + random() * 0.22, 0.18, 1.8),
      bend: clamp((bendBase + split * 1.2 + (random() - 0.5) * splay) * (1 - stiffness * 0.72), -1.2, 1.2),
      alpha,
    }
  })
  return { kind: "bristle", coverage, wetness, bristles }
}

export function resolveMixerReservoirStep(input: MixerReservoirStepInput): MixerReservoirStep {
  const reservoir = normalizeRgba(input.reservoir)
  const sample = normalizeRgba(input.sample)
  const wet = percent(input.settings.wet, 50) * clamp01(input.pressure ?? 1)
  const load = percent(input.settings.load, 50)
  const mix = percent(input.settings.mix, 50)
  const flow = percent(input.settings.flow, 100)
  const pickupAlpha = clamp01(wet * (0.35 + mix * 0.65))
  const nextReservoir = mixRgba(reservoir, sample, pickupAlpha)
  const paintColor = mixRgba(sample, nextReservoir, load)
  const depositAlpha = clamp01(load * flow * (0.55 + clamp01(input.pressure ?? 1) * 0.45))
  return { paintColor, nextReservoir, depositAlpha, pickupAlpha }
}

function colorDistance(a: Required<BrushRgba>, b: Required<BrushRgba>) {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  const da = (a.a - b.a) * 255
  return Math.sqrt(dr * dr + dg * dg + db * db + da * da * 0.25)
}

export function resolveColorReplacementPixel(input: ColorReplacementPixelInput): ColorReplacementPixelResult {
  const source = normalizeRgba(input.source)
  const sourcePixel = {
    r: source.r,
    g: source.g,
    b: source.b,
    a: input.source.a,
  }
  const sample = normalizeRgba(input.sample)
  const replacement = normalizeRgba(input.replacement)
  const distance = colorDistance(source, sample)
  if (distance > Math.max(0, input.tolerance) || source.a <= 0) {
    return { pixel: sourcePixel, changed: false, distance }
  }
  const [sh, ss, sl] = rgbToHsl(source)
  const [rh, rs, rl] = rgbToHsl(replacement)
  const target = hslToRgb(
    input.mode === "hue" || input.mode === "color" ? rh : sh,
    input.mode === "saturation" || input.mode === "color" ? rs : ss,
    input.mode === "luminosity" ? rl : sl,
  )
  const opacity = clamp01(input.opacity ?? 1)
  return {
    pixel: {
      r: mixByte(source.r, target.r, opacity),
      g: mixByte(source.g, target.g, opacity),
      b: mixByte(source.b, target.b, opacity),
      a: input.source.a,
    },
    changed: true,
    distance,
  }
}

export function planArtHistoryStroke(
  point: { x: number; y: number },
  brush: BrushSettings,
  options: BrushEngineOptions = {},
): ArtHistoryDab[] {
  void point
  const random = seededRandom(options.seed)
  const settings = brush.artHistory
  const style = settings?.style ?? "tight-medium"
  const areaRadius = Math.max(1, (settings?.area ?? Math.max(12, brush.size)) / 2)
  const fidelity = percent(settings?.fidelity, 60)
  const styleWeight =
    style === "dab" ? 0.25 :
      style === "tight-short" ? 0.38 :
        style === "tight-medium" ? 0.56 :
          style === "curl" ? 0.78 :
            1
  const count = Math.max(1, Math.round(2 + styleWeight * 5 + (1 - fidelity) * 3))
  const rotationAmp = style === "loose-long" ? 1.15 : style === "curl" ? 1.75 : style === "dab" ? 0.18 : 0.55
  const sourceJitter = areaRadius * (1 - fidelity) * (style === "dab" ? 0.15 : 0.62)
  return Array.from({ length: count }, (_, index) => {
    const a = random() * Math.PI * 2
    const radial = Math.sqrt(random()) * areaRadius * (style === "dab" ? 0.25 : 1)
    const curl = style === "curl" ? index / Math.max(1, count - 1) * Math.PI * 2 : 0
    const dx = Math.cos(a + curl) * radial
    const dy = Math.sin(a + curl) * radial
    const sourceA = random() * Math.PI * 2
    const sourceR = random() * sourceJitter
    return {
      dx,
      dy,
      sourceDx: Math.cos(sourceA) * sourceR,
      sourceDy: Math.sin(sourceA) * sourceR,
      rotation: (random() - 0.5) * Math.PI * rotationAmp + curl * 0.35,
      scale: clamp(0.62 + random() * 0.58 + (1 - fidelity) * 0.22, 0.45, 1.45),
      opacity: clamp((brush.opacity / 100) * (0.42 + fidelity * 0.42 + random() * 0.2), 0.08, 1),
    }
  })
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
  const tipState =
    brush.tipShape === "erodible"
      ? resolveErodibleTipSimulation(brush, input, options)
      : brush.tipShape === "bristle"
        ? resolveBristleTipSimulation(brush, input, options)
        : undefined
  if (tipState?.kind === "erodible") {
    sizeScale *= tipState.sizeScale
    roundness *= tipState.roundnessScale
    opacityScale *= tipState.alphaScale
    angle += tipState.angle
  } else if (tipState?.kind === "bristle") {
    opacityScale *= 0.55 + tipState.coverage * 0.45
    flowScale *= 0.72 + tipState.wetness * 0.28
  }

  return {
    size: Math.max(1, brush.size * sizeScale),
    angle,
    roundness: clamp(roundness, 0.08, 1),
    opacity: clamp01((brush.opacity / 100) * opacityScale),
    flow: clamp01((brush.flow / 100) * flowScale),
    input,
    tipState,
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
