import { expect, test } from "@playwright/test"

import {
  hexToHsv,
  hsvToHex,
  pickFromHud,
  rgbToHsv,
  hsvToRgb,
} from "../components/photoshop/color-picker-hud"

test.describe("color-picker-hud math", () => {
  test("rgbToHsv handles primary colors", () => {
    const red = rgbToHsv(255, 0, 0)
    expect(red.h).toBeCloseTo(0, 1)
    expect(red.s).toBeCloseTo(1, 5)
    expect(red.v).toBeCloseTo(1, 5)

    const green = rgbToHsv(0, 255, 0)
    expect(green.h).toBeCloseTo(120, 1)
    expect(green.s).toBeCloseTo(1, 5)
    expect(green.v).toBeCloseTo(1, 5)

    const blue = rgbToHsv(0, 0, 255)
    expect(blue.h).toBeCloseTo(240, 1)
    expect(blue.s).toBeCloseTo(1, 5)
    expect(blue.v).toBeCloseTo(1, 5)

    const black = rgbToHsv(0, 0, 0)
    expect(black.s).toBeCloseTo(0, 5)
    expect(black.v).toBeCloseTo(0, 5)

    const white = rgbToHsv(255, 255, 255)
    expect(white.s).toBeCloseTo(0, 5)
    expect(white.v).toBeCloseTo(1, 5)
  })

  test("hsvToRgb is the inverse of rgbToHsv for many samples", () => {
    const samples: Array<[number, number, number]> = [
      [255, 0, 0], [0, 255, 0], [0, 0, 255],
      [255, 255, 0], [0, 255, 255], [255, 0, 255],
      [128, 64, 32], [200, 150, 90], [12, 200, 240],
      [255, 255, 255], [0, 0, 0], [127, 127, 127],
    ]
    for (const [r, g, b] of samples) {
      const hsv = rgbToHsv(r, g, b)
      const back = hsvToRgb(hsv.h, hsv.s, hsv.v)
      expect(Math.round(back.r)).toBe(r)
      expect(Math.round(back.g)).toBe(g)
      expect(Math.round(back.b)).toBe(b)
    }
  })

  test("hexToHsv and hsvToHex round-trip", () => {
    const inputs = ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#80a040", "#3344aa"]
    for (const hex of inputs) {
      const hsv = hexToHsv(hex)
      const back = hsvToHex(hsv.h, hsv.s, hsv.v)
      expect(back.toLowerCase()).toBe(hex.toLowerCase())
    }
  })

  test("pickFromHud picks saturation/brightness inside the square", () => {
    // HUD anchor: cursor at (200, 200), starting from a mid-grey color.
    const hud = {
      screenX: 200,
      screenY: 200,
      hsv: { h: 120, s: 0.5, v: 0.5 },
    }
    // Pointer at the same screen position is the indicator point — same HSV.
    const sameSpot = pickFromHud(hud, 200, 200)
    expect(sameSpot.hsv.s).toBeCloseTo(0.5, 2)
    expect(sameSpot.hsv.v).toBeCloseTo(0.5, 2)
    expect(sameSpot.hsv.h).toBeCloseTo(120, 2)

    // Move pointer ~30 px right/up — saturation goes up, value goes up.
    const upRight = pickFromHud(hud, 230, 170)
    expect(upRight.hsv.s).toBeGreaterThan(0.5)
    expect(upRight.hsv.v).toBeGreaterThan(0.5)
    // Hue stays put when the pointer is over the square area.
    expect(upRight.hsv.h).toBeCloseTo(120, 2)
    expect(upRight.changed).toBe(true)
  })

  test("pickFromHud clamps to [0,1] outside the S/V square", () => {
    const hud = {
      screenX: 200,
      screenY: 200,
      hsv: { h: 30, s: 0.5, v: 0.5 },
    }
    // Way past the bottom-left corner — should clamp to s=0, v=0.
    const oob = pickFromHud(hud, -1000, 5000)
    expect(oob.hsv.s).toBeCloseTo(0, 2)
    expect(oob.hsv.v).toBeCloseTo(0, 2)
  })

  test("pickFromHud routes pointer over hue strip to hue change", () => {
    const hud = {
      screenX: 200,
      screenY: 200,
      hsv: { h: 30, s: 0.5, v: 0.5 },
    }
    // The hue strip lives to the right of the square (square 132 wide,
    // 6px gap, then strip 18 wide). The square left-edge is screenX-66-6
    // = 128 in screen space, so the hue strip starts around screen x=266.
    const result = pickFromHud(hud, 280, 200)
    // S/V should be unchanged; only H changes.
    expect(result.hsv.s).toBeCloseTo(0.5, 2)
    expect(result.hsv.v).toBeCloseTo(0.5, 2)
    // Hue should move because the pointer is in the strip area.
    expect(result.hsv.h).not.toBeCloseTo(30, 1)
  })
})
