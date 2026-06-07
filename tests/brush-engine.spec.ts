import { expect, test } from "@playwright/test"

import type { BrushSettings } from "../components/photoshop/types"
import {
  normalizeBrushPointerSample,
  planBrushStroke,
  planArtHistoryStroke,
  resolveBristleTipSimulation,
  resolveBrushStamp,
  resolveColorReplacementPixel,
  resolveErodibleTipSimulation,
  resolveMixerReservoirStep,
} from "../components/photoshop/brush-engine"
import { buildRetouchingFeedbackModel } from "../components/photoshop/retouch-feedback"

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

test("erodible tips wear into flatter deterministic footprints over a stroke", () => {
  const brush: BrushSettings = {
    ...baseBrush,
    tipShape: "erodible",
    erodibleTip: {
      sharpness: 82,
      flatness: 44,
      erosionRate: 72,
      softness: 18,
      aspectRatio: 68,
      rotation: 22,
    },
  }

  const worn = resolveErodibleTipSimulation(
    brush,
    { pressure: 0.82, tiltX: 24, tiltY: -18, twist: 9, velocity: 180, fade: 140, strokeAngle: Math.PI / 5 },
    { seed: 17 },
  )
  const repeated = resolveErodibleTipSimulation(
    brush,
    { pressure: 0.82, tiltX: 24, tiltY: -18, twist: 9, velocity: 180, fade: 140, strokeAngle: Math.PI / 5 },
    { seed: 17 },
  )

  expect(worn.kind).toBe("erodible")
  expect(worn.wear).toBeGreaterThan(0.35)
  expect(worn.sizeScale).toBeLessThan(0.96)
  expect(worn.roundnessScale).toBeLessThan(0.72)
  expect(worn.edge.length).toBe(24)
  expect(worn.edge.some((point) => Math.abs(point.radiusScale - worn.edge[0].radiusScale) > 0.05)).toBe(true)
  expect(worn).toEqual(repeated)
})

test("bristle tips resolve individual bristles with pressure tilt splay and wetness", () => {
  const brush: BrushSettings = {
    ...baseBrush,
    tipShape: "bristle",
    bristleTip: {
      length: 74,
      density: 83,
      thickness: 42,
      stiffness: 28,
      splay: 58,
      wetness: 46,
    },
  }

  const tip = resolveBristleTipSimulation(
    brush,
    { pressure: 0.7, tiltX: 30, tiltY: 12, twist: 4, velocity: 240, fade: 18, strokeAngle: Math.PI / 3 },
    { seed: 23 },
  )

  expect(tip.kind).toBe("bristle")
  expect(tip.bristles.length).toBeGreaterThan(40)
  expect(tip.coverage).toBeGreaterThan(0.35)
  expect(tip.coverage).toBeLessThan(0.95)
  expect(tip.bristles.some((bristle) => Math.abs(bristle.bend) > 0.1)).toBe(true)
  expect(tip.bristles.some((bristle) => bristle.alpha < 0.8)).toBe(true)
})

test("mixer reservoir picks up canvas color and deposits loaded paint", () => {
  const first = resolveMixerReservoirStep({
    reservoir: { r: 24, g: 72, b: 150, a: 1 },
    sample: { r: 220, g: 160, b: 48, a: 1 },
    settings: { wet: 78, load: 62, mix: 66, flow: 70 },
    pressure: 0.75,
  })
  const second = resolveMixerReservoirStep({
    reservoir: first.nextReservoir,
    sample: { r: 210, g: 150, b: 54, a: 1 },
    settings: { wet: 78, load: 62, mix: 66, flow: 70 },
    pressure: 0.75,
  })

  expect(first.depositAlpha).toBeGreaterThan(0.25)
  expect(first.pickupAlpha).toBeGreaterThan(0.4)
  expect(first.paintColor.r).toBeGreaterThan(80)
  expect(first.paintColor.b).toBeGreaterThan(80)
  expect(second.nextReservoir.r).toBeGreaterThan(first.nextReservoir.r)
  expect(second.nextReservoir.b).toBeLessThan(first.nextReservoir.b)
})

test("color replacement supports sampling tolerance and replace modes", () => {
  const replaced = resolveColorReplacementPixel({
    source: { r: 128, g: 42, b: 24, a: 255 },
    sample: { r: 130, g: 40, b: 22, a: 255 },
    replacement: { r: 36, g: 96, b: 224, a: 255 },
    tolerance: 30,
    mode: "color",
    opacity: 0.85,
  })
  const rejected = resolveColorReplacementPixel({
    source: { r: 40, g: 180, b: 40, a: 255 },
    sample: { r: 130, g: 40, b: 22, a: 255 },
    replacement: { r: 36, g: 96, b: 224, a: 255 },
    tolerance: 30,
    mode: "color",
    opacity: 1,
  })

  expect(replaced.changed).toBe(true)
  expect(replaced.pixel.b).toBeGreaterThan(replaced.pixel.r)
  expect(replaced.pixel.a).toBe(255)
  expect(rejected.changed).toBe(false)
  expect(rejected.pixel).toEqual({ r: 40, g: 180, b: 40, a: 255 })
})

test("retouching feedback model explains brush edge clone source and healing preview state", () => {
  const clone = buildRetouchingFeedbackModel({
    tool: "clone-stamp",
    brush: {
      ...baseBrush,
      size: 64,
      hardness: 35,
      spacing: 18,
      scatter: 120,
      tipShape: "bristle",
      bristleTip: { length: 64, density: 70, thickness: 38, stiffness: 40, splay: 45, wetness: 52 },
    },
    cloneSource: {
      activePresetId: "clone_1",
      aligned: false,
      sample: "all-layers",
      scale: 125,
      rotation: -12,
      offsetX: 18,
      offsetY: -9,
      showOverlay: true,
      presets: [{
        id: "clone_1",
        name: "Skin texture",
        layerId: "layer_1",
        sourceX: 120,
        sourceY: 80,
        scale: 125,
        rotation: -12,
        offsetX: 18,
        offsetY: -9,
      }],
    },
    cursor: { x: 220, y: 160 },
  })
  const healing = buildRetouchingFeedbackModel({
    tool: "healing-brush",
    brush: baseBrush,
    cloneSource: {
      activePresetId: null,
      aligned: true,
      sample: "current-layer",
      scale: 100,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
      showOverlay: true,
      presets: [],
    },
    cursor: { x: 40, y: 30 },
  })

  expect(clone.primaryStatus).toBe("Clone source ready")
  expect(clone.previewGhost).toMatchObject({
    visible: true,
    sourcePoint: { x: 138, y: 71 },
    destinationPoint: { x: 220, y: 160 },
    scale: 125,
    rotation: -12,
  })
  expect(clone.brushEdge).toMatchObject({
    radius: 32,
    hardnessRadius: 11.2,
    scatterRadius: 76.8,
    tipKind: "bristle",
  })
  expect(clone.hudChips.map((chip) => chip.label)).toContain("Non-aligned")
  expect(healing.primaryStatus).toBe("Set a sample point")
  expect(healing.healingPreview).toMatchObject({ mode: "sample-required", visible: false })
})

test("art history plans style dabs with bounded area and fidelity", () => {
  const plan = planArtHistoryStroke(
    { x: 32, y: 28 },
    {
      ...baseBrush,
      size: 24,
      artHistory: {
        style: "loose-long",
        area: 36,
        fidelity: 38,
      },
    },
    { seed: 31 },
  )
  const repeated = planArtHistoryStroke(
    { x: 32, y: 28 },
    {
      ...baseBrush,
      size: 24,
      artHistory: {
        style: "loose-long",
        area: 36,
        fidelity: 38,
      },
    },
    { seed: 31 },
  )

  expect(plan.length).toBeGreaterThan(3)
  expect(Math.max(...plan.map((dab) => Math.hypot(dab.dx, dab.dy)))).toBeLessThanOrEqual(18)
  expect(plan.some((dab) => Math.abs(dab.rotation) > 0.2)).toBe(true)
  expect(plan.some((dab) => dab.sourceDx !== 0 || dab.sourceDy !== 0)).toBe(true)
  expect(plan).toEqual(repeated)
})
