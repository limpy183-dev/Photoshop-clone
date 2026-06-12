import { expect, test } from "@playwright/test"

import {
  resolveErodibleTipSimulation,
  type BrushDynamicsInput,
} from "../components/photoshop/brush-engine"
import {
  applyCanvasBrushColorDynamics,
  applyCanvasBrushShapeDynamics,
  applyCanvasBrushTransfer,
  canvasBrushControlValue,
  canvasBrushSimulationSeed,
  hexToHsl,
  hslToHex,
} from "../components/photoshop/canvas-brush-dynamics"
import type { BrushSettings } from "../components/photoshop/types"

const baseBrush: BrushSettings = {
  size: 40,
  hardness: 80,
  opacity: 80,
  flow: 50,
  smoothing: 10,
  spacing: 25,
  tipShape: "round",
  sizeControl: "off",
  angleControl: "off",
  roundnessControl: "off",
  opacityControl: "off",
  flowControl: "off",
}

const baseInput: BrushDynamicsInput = {
  pressure: 1,
  tiltX: 0,
  tiltY: 0,
  twist: 0,
  velocity: 0,
  fade: 0,
  strokeAngle: 0,
}

function sequenceRandom(values: number[]) {
  let index = 0
  return () => values[index++] ?? values[values.length - 1] ?? 0
}

test("converts between hex and HSL with current wrapping and clamping", () => {
  const [h, s, l] = hexToHsl("#336699")

  expect(h).toBeCloseTo(210)
  expect(s).toBeCloseTo(50)
  expect(l).toBeCloseTo(40)
  expect(hslToHex(h, s, l)).toBe("#336699")
  expect(hslToHex(-120, 120, 50)).toBe("#0000ff")
})

test("applies color dynamics with current random jitter ordering", () => {
  const hueShifted = applyCanvasBrushColorDynamics(
    { ...baseBrush, hueJitter: 100 },
    "#ff0000",
    "#000000",
    sequenceRandom([0.75, 0.5, 0.5]),
  )

  expect(hueShifted).toBe("#00ffff")
  expect(applyCanvasBrushColorDynamics({ ...baseBrush, fgBgJitter: 100 }, "#336699", "#ff0000", sequenceRandom([0.1]))).toBe("#ff0000")
  expect(applyCanvasBrushColorDynamics({ ...baseBrush, purity: -50 }, "#336699", "#000000", sequenceRandom([]))).toBe("#666666")
})

test("resolves brush input controls using canvas-view velocity scaling", () => {
  const posedBrush: BrushSettings = {
    ...baseBrush,
    pose: { tiltX: 10, tiltY: -5, rotation: 0, pressure: 100, stylusAngle: 0 },
  }
  const input = { ...baseInput, pressure: 0.42, tiltX: 20, tiltY: 35, velocity: 40, fade: 55 }

  expect(canvasBrushControlValue(baseBrush, "pressure", input)).toBeCloseTo(0.42)
  expect(canvasBrushControlValue(posedBrush, "tilt", input)).toBeCloseTo(Math.hypot(30, 30) / 90)
  expect(canvasBrushControlValue(baseBrush, "velocity", input)).toBeCloseTo(0.5)
  expect(canvasBrushControlValue(baseBrush, "fade", input)).toBeCloseTo(0.75)
  expect(canvasBrushControlValue(baseBrush, "random", input, () => 0.37)).toBeCloseTo(0.37)
  expect(canvasBrushControlValue(baseBrush, "off", input)).toBe(1)
})

test("resolves shape dynamics without changing current pose math", () => {
  const brush: BrushSettings = {
    ...baseBrush,
    sizeControl: "pressure",
    minDiameter: 20,
    angleControl: "velocity",
    roundnessControl: "tilt",
    pose: { tiltX: 0, tiltY: 0, rotation: 10, pressure: 100, stylusAngle: 5 },
  }
  const input = { ...baseInput, pressure: 0.25, tiltX: 30, tiltY: 40, twist: 30, strokeAngle: 0.5 }

  const result = applyCanvasBrushShapeDynamics(brush, input, sequenceRandom([]))

  expect(result.dabSize).toBeCloseTo(16)
  expect(result.dabAngle).toBeCloseTo((45 * Math.PI) / 180 + 0.5)
  expect(result.dabRoundness).toBeCloseTo(0.6)
  expect(result.tipState).toBeUndefined()
})

test("resolves transfer dynamics with current pose pressure and velocity controls", () => {
  const brush: BrushSettings = {
    ...baseBrush,
    flowControl: "velocity",
    pose: { tiltX: 0, tiltY: 0, rotation: 0, pressure: 40, stylusAngle: 0 },
  }

  const result = applyCanvasBrushTransfer(brush, { ...baseInput, velocity: 40 }, sequenceRandom([]))

  expect(result.opaMul).toBeCloseTo(0.4)
  expect(result.flowMul).toBeCloseTo(0.5)
})

test("uses canvas-view tip simulation seeds for shape and transfer", () => {
  const brush: BrushSettings = {
    ...baseBrush,
    tipShape: "erodible",
    erodibleTip: {
      sharpness: 55,
      flatness: 25,
      erosionRate: 40,
      softness: 20,
      aspectRatio: 70,
      rotation: 15,
      wear: 10,
      shape: "chisel",
    },
  }
  const input = { ...baseInput, pressure: 0.6, tiltX: 20, tiltY: 5, fade: 4 }

  const shape = applyCanvasBrushShapeDynamics(brush, input, sequenceRandom([]))
  const shapeTip = resolveErodibleTipSimulation(brush, input, { seed: canvasBrushSimulationSeed(brush, input, 7) })
  const transfer = applyCanvasBrushTransfer(brush, input, sequenceRandom([]))
  const transferTip = resolveErodibleTipSimulation(brush, input, { seed: canvasBrushSimulationSeed(brush, input, 17) })

  expect(canvasBrushSimulationSeed(brush, input, 7)).toBe(1192)
  expect(shape.tipState).toEqual(shapeTip)
  expect(shape.dabSize).toBeCloseTo(brush.size * shapeTip.sizeScale)
  expect(transfer.opaMul).toBeCloseTo(transferTip.alphaScale)
  expect(transfer.flowMul).toBeCloseTo(1)
})
