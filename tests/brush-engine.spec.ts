import { expect, test } from "@playwright/test"

import type { BrushSettings } from "../components/photoshop/types"
import {
  normalizeBrushPointerSample,
  planBrushStroke,
  resolveBrushStamp,
} from "../components/photoshop/brush-engine"

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

function roundStamp(stamp: ReturnType<typeof planBrushStroke>[number]) {
  return {
    x: Number(stamp.x.toFixed(2)),
    y: Number(stamp.y.toFixed(2)),
    size: Number(stamp.size.toFixed(2)),
    angle: Number(stamp.angle.toFixed(4)),
    roundness: Number(stamp.roundness.toFixed(2)),
    opacity: Number(stamp.opacity.toFixed(3)),
    flow: Number(stamp.flow.toFixed(3)),
    pressure: Number(stamp.input.pressure.toFixed(3)),
  }
}

test("pressure controls brush size opacity and flow", () => {
  const brush: BrushSettings = {
    ...baseBrush,
    sizeControl: "pressure",
    minDiameter: 20,
    opacityControl: "pressure",
    flowControl: "pressure",
  }

  const light = resolveBrushStamp(brush, { pressure: 0.25, tiltX: 0, tiltY: 0, twist: 0, velocity: 0, fade: 0, strokeAngle: 0 }, { seed: 1 })
  const firm = resolveBrushStamp(brush, { pressure: 1, tiltX: 0, tiltY: 0, twist: 0, velocity: 0, fade: 0, strokeAngle: 0 }, { seed: 1 })

  expect(light.size).toBeCloseTo(16)
  expect(light.opacity).toBeCloseTo(0.2)
  expect(light.flow).toBeCloseTo(0.125)
  expect(firm.size).toBeCloseTo(40)
  expect(firm.opacity).toBeCloseTo(0.8)
  expect(firm.flow).toBeCloseTo(0.5)
})

test("tilt controls stamp angle and roundness while twist rotates the tip", () => {
  const stamp = resolveBrushStamp(
    {
      ...baseBrush,
      angleControl: "tilt",
      roundnessControl: "tilt",
    },
    { pressure: 1, tiltX: 30, tiltY: 40, twist: 15, velocity: 0, fade: 0, strokeAngle: 0 },
    { seed: 1 },
  )

  expect(stamp.angle).toBeCloseTo(Math.atan2(40, 30) + (15 * Math.PI) / 180)
  expect(stamp.roundness).toBeCloseTo(0.6)
})

test("random and fade controls are deterministic with seeded randomness", () => {
  const brush: BrushSettings = {
    ...baseBrush,
    size: 100,
    opacity: 100,
    flow: 100,
    sizeControl: "random",
    opacityControl: "random",
    flowControl: "fade",
  }

  const first = resolveBrushStamp(brush, { pressure: 1, tiltX: 0, tiltY: 0, twist: 0, velocity: 0, fade: 55, strokeAngle: 0 }, { seed: 1 })
  const second = resolveBrushStamp(brush, { pressure: 1, tiltX: 0, tiltY: 0, twist: 0, velocity: 0, fade: 55, strokeAngle: 0 }, { seed: 1 })

  expect(roundStamp({ ...first, x: 0, y: 0 })).toEqual(roundStamp({ ...second, x: 0, y: 0 }))
  expect(first.size).toBeCloseTo(5.4)
  expect(first.opacity).toBeCloseTo(0.015)
  expect(first.flow).toBeCloseTo(0.75)
})

test("golden spacing and scattering plan stamps deterministically", () => {
  const stamps = planBrushStroke(
    {
      ...baseBrush,
      size: 10,
      opacity: 100,
      flow: 100,
      spacing: 50,
      scatter: 100,
      scatterCount: 2,
    },
    [
      { x: 0, y: 0, time: 0, pressure: 1, tiltX: 0, tiltY: 0, twist: 0 },
      { x: 10, y: 0, time: 10, pressure: 1, tiltX: 0, tiltY: 0, twist: 0 },
    ],
    { seed: 1, velocityAffectsSpacing: false },
  )

  expect(stamps.map(roundStamp)).toEqual([
    { x: 0, y: -8.92, size: 10, angle: 0, roundness: 1, opacity: 1, flow: 1, pressure: 1 },
    { x: 0, y: -9.7, size: 10, angle: 0, roundness: 1, opacity: 1, flow: 1, pressure: 1 },
    { x: 5, y: 1.44, size: 10, angle: 0, roundness: 1, opacity: 1, flow: 1, pressure: 1 },
    { x: 5, y: -6.38, size: 10, angle: 0, roundness: 1, opacity: 1, flow: 1, pressure: 1 },
    { x: 10, y: 4.28, size: 10, angle: 0, roundness: 1, opacity: 1, flow: 1, pressure: 1 },
    { x: 10, y: -1.3, size: 10, angle: 0, roundness: 1, opacity: 1, flow: 1, pressure: 1 },
  ])
})

test("golden velocity spacing emits fewer stamps for fast pointer samples", () => {
  const brush = { ...baseBrush, size: 20, spacing: 50, opacity: 100, flow: 100 }
  const slow = planBrushStroke(
    brush,
    [
      { x: 0, y: 0, time: 0, pressure: 1, tiltX: 0, tiltY: 0, twist: 0 },
      { x: 40, y: 0, time: 1000, pressure: 1, tiltX: 0, tiltY: 0, twist: 0 },
    ],
    { seed: 1, velocityAffectsSpacing: true, velocitySpacingScale: 1 },
  )
  const fast = planBrushStroke(
    brush,
    [
      { x: 0, y: 0, time: 0, pressure: 1, tiltX: 0, tiltY: 0, twist: 0 },
      { x: 40, y: 0, time: 20, pressure: 1, tiltX: 0, tiltY: 0, twist: 0 },
    ],
    { seed: 1, velocityAffectsSpacing: true, velocitySpacingScale: 1 },
  )

  expect(slow.map((stamp) => Number(stamp.x.toFixed(1)))).toEqual([0, 10.4, 20.8, 31.2])
  expect(fast.map((stamp) => Number(stamp.x.toFixed(1)))).toEqual([0, 20, 40])
})

test("tablet pointer samples preserve pressure tilt twist and compute velocity", () => {
  const previous = { x: 10, y: 20, time: 100, pressure: 1, tiltX: 0, tiltY: 0, twist: 0, velocity: 0 }
  const pen = normalizeBrushPointerSample(
    { clientX: 13, clientY: 24, timeStamp: 108, pointerType: "pen", pressure: 0.37, tiltX: -12, tiltY: 33, twist: 271 },
    { x: 13, y: 24 },
    previous,
  )
  const mouse = normalizeBrushPointerSample(
    { clientX: 40, clientY: 20, timeStamp: 120, pointerType: "mouse", pressure: 0.5 },
    { x: 40, y: 20 },
    previous,
  )

  expect(pen).toMatchObject({ pressure: 0.37, tiltX: -12, tiltY: 33, twist: 271, pointerType: "pen" })
  expect(pen.velocity).toBeCloseTo(625)
  expect(mouse.pressure).toBe(1)
  expect(mouse.tiltX).toBe(0)
  expect(mouse.tiltY).toBe(0)
})
