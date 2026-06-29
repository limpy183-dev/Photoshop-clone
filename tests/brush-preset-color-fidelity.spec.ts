import { expect, test } from "@playwright/test"

import { reducer } from "../components/photoshop/editor-context"
import type { BrushPreset, BrushSettings } from "../components/photoshop/types"

const texturedBrush: BrushSettings = {
  size: 36,
  hardness: 78,
  opacity: 88,
  flow: 72,
  smoothing: 12,
  spacing: 16,
  tipShape: "erodible",
  sizeControl: "random",
  angleControl: "tilt",
  roundnessControl: "random",
  opacityControl: "pressure",
  flowControl: "velocity",
  sizeJitter: 30,
  angleJitter: 12,
  roundnessJitter: 40,
  scatter: 160,
  scatterCount: 3,
  scatterCountJitter: 25,
  fgBgJitter: 80,
  hueJitter: 35,
  satJitter: 40,
  brightJitter: 25,
  purity: -20,
  opacityJitter: 18,
  flowJitter: 22,
  wetEdges: true,
  buildUp: true,
  noise: true,
  protectTexture: true,
  texture: { enabled: true, pattern: "paper", mode: "subtract", depth: 46, depthJitter: 28, minDepth: 8, scale: 120 },
  dualBrush: { enabled: true, size: 20, spacing: 30, scatter: 80, count: 2, mode: "multiply" },
  erodibleTip: { sharpness: 76, flatness: 48, erosionRate: 64, softness: 18, aspectRatio: 72, rotation: -8 },
  bristleTip: { length: 65, density: 55, thickness: 35, stiffness: 55, splay: 35, wetness: 25 },
}

test("solid round brush presets clear inherited texture and color dynamics", () => {
  const hardRoundPreset: BrushPreset = {
    id: "hard-round-test",
    name: "Hard Round Test",
    size: 15,
    hardness: 100,
    spacing: 18,
    settings: { tipShape: "round", smoothing: 4 },
  }

  const next = reducer(
    { brush: texturedBrush } as never,
    { type: "apply-brush-preset", preset: hardRoundPreset } as never,
  ) as unknown as { brush: BrushSettings }

  expect(next.brush).toMatchObject({
    size: 15,
    hardness: 100,
    spacing: 18,
    tipShape: "round",
    smoothing: 4,
    sizeControl: "off",
    angleControl: "off",
    roundnessControl: "off",
    opacityControl: "off",
    flowControl: "off",
    scatter: 0,
    scatterCount: 1,
    scatterCountJitter: 0,
    fgBgJitter: 0,
    hueJitter: 0,
    satJitter: 0,
    brightJitter: 0,
    purity: 0,
    opacityJitter: 0,
    flowJitter: 0,
    wetEdges: false,
    buildUp: false,
    noise: false,
    protectTexture: false,
  })
  expect(next.brush.texture).toBeUndefined()
  expect(next.brush.dualBrush).toBeUndefined()
})
