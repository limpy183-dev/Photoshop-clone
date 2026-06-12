import {
  resolveBristleTipSimulation,
  resolveErodibleTipSimulation,
  type BrushDynamicsInput,
  type BrushInputControl,
  type BrushTipSimulation,
} from "./brush-engine"
import type { BrushSettings } from "./types"

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export interface CanvasBrushShapeDynamics {
  dabSize: number
  dabAngle: number
  dabRoundness: number
  tipState?: BrushTipSimulation
}

export interface CanvasBrushTransferDynamics {
  opaMul: number
  flowMul: number
}

/** Convert hex to HSL (0-360, 0-100, 0-100). */
export function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h * 360, s * 100, l * 100]
}

/** Convert HSL to hex. */
export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360
  const s1 = Math.max(0, Math.min(100, s)) / 100
  const l1 = Math.max(0, Math.min(100, l)) / 100
  const a = s1 * Math.min(l1, 1 - l1)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l1 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(color * 255).toString(16).padStart(2, "0")
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** Apply color dynamics to get the per-dab color. */
export function applyCanvasBrushColorDynamics(
  brush: BrushSettings,
  fg: string,
  bg: string,
  random = Math.random,
): string {
  let color = fg
  // FG/BG jitter: randomly swap to background color.
  if (brush.fgBgJitter && brush.fgBgJitter > 0) {
    if (random() * 100 < brush.fgBgJitter) color = bg
  }
  // HSL jitter.
  const hj = brush.hueJitter ?? 0
  const sj = brush.satJitter ?? 0
  const bj = brush.brightJitter ?? 0
  if (hj > 0 || sj > 0 || bj > 0) {
    const [h, s, l] = hexToHsl(color)
    const nh = h + (random() - 0.5) * 2 * (hj / 100) * 360
    const ns = s + (random() - 0.5) * 2 * (sj / 100) * 100
    const nl = l + (random() - 0.5) * 2 * (bj / 100) * 100
    color = hslToHex(nh, ns, nl)
  }
  if (brush.purity) {
    const [h, s, l] = hexToHsl(color)
    color = hslToHex(h, Math.max(0, Math.min(100, s + brush.purity)), l)
  }
  return color
}

export function canvasBrushControlValue(
  brush: BrushSettings,
  control: BrushInputControl | undefined,
  input: BrushDynamicsInput,
  random = Math.random,
) {
  switch (control) {
    case "pressure":
      return clamp01(input.pressure)
    case "tilt":
      return clamp01(Math.hypot(input.tiltX + (brush.pose?.tiltX ?? 0), input.tiltY + (brush.pose?.tiltY ?? 0)) / 90)
    case "velocity":
      return clamp01(input.velocity / 80)
    case "fade":
      return clamp01(1 - input.fade / 220)
    case "random":
      return random()
    default:
      return 1
  }
}

export function canvasBrushSimulationSeed(brush: BrushSettings, input: BrushDynamicsInput, salt = 0) {
  return Math.max(1, Math.round((input.fade + 1) * 101 + brush.size * 17 + salt))
}

export function applyCanvasBrushShapeDynamics(
  brush: BrushSettings,
  input: BrushDynamicsInput,
  random = Math.random,
): CanvasBrushShapeDynamics {
  const minDiam = (brush.minDiameter ?? 0) / 100
  let sizeScale = 1
  if (brush.sizeControl && brush.sizeControl !== "off") {
    const v = canvasBrushControlValue(brush, brush.sizeControl, input, random)
    sizeScale = minDiam + (1 - minDiam) * v
  }
  if (brush.sizeJitter && brush.sizeJitter > 0) {
    const jitter = (random() * brush.sizeJitter) / 100
    sizeScale *= 1 - jitter * (1 - minDiam)
  }
  let dabSize = Math.max(1, brush.size * sizeScale)

  const poseRotation = ((brush.pose?.rotation ?? 0) + (brush.pose?.stylusAngle ?? 0) + input.twist) * (Math.PI / 180)
  let dabAngle = poseRotation
  if (brush.angleControl === "tilt") {
    dabAngle += Math.atan2(input.tiltY + (brush.pose?.tiltY ?? 0), input.tiltX + (brush.pose?.tiltX ?? 0))
  } else if (brush.angleControl === "velocity") {
    dabAngle += input.strokeAngle
  } else if (brush.angleControl && brush.angleControl !== "off") {
    dabAngle += (canvasBrushControlValue(brush, brush.angleControl, input, random) - 0.5) * 2 * ((brush.angleJitter ?? 0) * Math.PI / 180)
  }
  if (brush.angleJitter && brush.angleJitter > 0) {
    dabAngle += (random() - 0.5) * 2 * brush.angleJitter * (Math.PI / 180)
  }

  let dabRoundness = 1
  if (brush.roundnessControl && brush.roundnessControl !== "off") {
    dabRoundness = 0.1 + canvasBrushControlValue(brush, brush.roundnessControl, input, random) * 0.9
  }
  if (brush.roundnessJitter && brush.roundnessJitter > 0) {
    dabRoundness *= 1 - (random() * brush.roundnessJitter) / 100
  }
  dabRoundness = Math.max(0.08, Math.min(1, dabRoundness))

  if (brush.flipX && random() > 0.5) dabAngle += Math.PI
  if (brush.flipY && random() > 0.5) dabSize *= 0.96

  const tipState =
    brush.tipShape === "erodible"
      ? resolveErodibleTipSimulation(brush, input, { seed: canvasBrushSimulationSeed(brush, input, 7) })
      : brush.tipShape === "bristle"
        ? resolveBristleTipSimulation(brush, input, { seed: canvasBrushSimulationSeed(brush, input, 13) })
        : undefined
  if (tipState?.kind === "erodible") {
    dabSize *= tipState.sizeScale
    dabAngle += tipState.angle
    dabRoundness *= tipState.roundnessScale
  } else if (tipState?.kind === "bristle") {
    dabRoundness *= 0.72 + tipState.coverage * 0.2
  }
  dabRoundness = Math.max(0.08, Math.min(1, dabRoundness))

  return { dabSize, dabAngle, dabRoundness, tipState }
}

export function applyCanvasBrushTransfer(
  brush: BrushSettings,
  input: BrushDynamicsInput,
  random = Math.random,
): CanvasBrushTransferDynamics {
  let opaMul = brush.opacityControl && brush.opacityControl !== "off"
    ? canvasBrushControlValue(brush, brush.opacityControl, input, random)
    : 1
  let flowMul = brush.flowControl && brush.flowControl !== "off"
    ? canvasBrushControlValue(brush, brush.flowControl, input, random)
    : 1
  if (brush.opacityJitter && brush.opacityJitter > 0) {
    opaMul *= 1 - (random() * brush.opacityJitter) / 100
  }
  if (brush.flowJitter && brush.flowJitter > 0) {
    flowMul *= 1 - (random() * brush.flowJitter) / 100
  }
  const posePressure = brush.pose?.pressure
  if (posePressure !== undefined && (!brush.opacityControl || brush.opacityControl === "off")) {
    opaMul *= Math.max(0.05, posePressure / 100)
  }
  if (brush.tipShape === "erodible") {
    const tip = resolveErodibleTipSimulation(brush, input, { seed: canvasBrushSimulationSeed(brush, input, 17) })
    opaMul *= tip.alphaScale
  } else if (brush.tipShape === "bristle") {
    const tip = resolveBristleTipSimulation(brush, input, { seed: canvasBrushSimulationSeed(brush, input, 19) })
    opaMul *= 0.55 + tip.coverage * 0.45
    flowMul *= 0.72 + tip.wetness * 0.28
  }
  return { opaMul: clamp01(opaMul), flowMul: clamp01(flowMul) }
}
