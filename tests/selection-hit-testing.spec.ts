import { expect, test } from "@playwright/test"

import { createSelectionHitTester } from "../components/photoshop/selection-hit-testing"
import type { Selection } from "../components/photoshop/types"

class CountingMaskCanvas {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
  reads: Array<{ x: number; y: number; w: number; h: number }> = []

  constructor(width: number, height: number, alphaPixels: Array<{ x: number; y: number; alpha: number }>) {
    this.width = width
    this.height = height
    this.data = new Uint8ClampedArray(width * height * 4)
    for (const pixel of alphaPixels) {
      const i = (pixel.y * width + pixel.x) * 4
      this.data[i] = 255
      this.data[i + 1] = 255
      this.data[i + 2] = 255
      this.data[i + 3] = pixel.alpha
    }
  }

  getContext() {
    return {
      getImageData: (x: number, y: number, w: number, h: number) => {
        this.reads.push({ x, y, w, h })
        if (x === 0 && y === 0 && w === this.width && h === this.height) {
          return { data: this.data, width: this.width, height: this.height } as ImageData
        }
        const out = new Uint8ClampedArray(w * h * 4)
        for (let py = 0; py < h; py++) {
          for (let px = 0; px < w; px++) {
            const sx = x + px
            const sy = y + py
            const src = (sy * this.width + sx) * 4
            const dst = (py * w + px) * 4
            out[dst] = this.data[src]
            out[dst + 1] = this.data[src + 1]
            out[dst + 2] = this.data[src + 2]
            out[dst + 3] = this.data[src + 3]
          }
        }
        return { data: out, width: w, height: h } as ImageData
      },
    }
  }
}

test("selection hit tester reads a mask once and reuses it for repeated dab checks", () => {
  const mask = new CountingMaskCanvas(4, 4, [
    { x: 1, y: 1, alpha: 255 },
    { x: 2, y: 2, alpha: 7 },
  ])
  const selection: Selection = {
    bounds: { x: 0, y: 0, w: 4, h: 4 },
    shape: "freehand",
    mask: mask as unknown as HTMLCanvasElement,
  }

  const tester = createSelectionHitTester(4, 4, selection)

  expect(tester.contains({ x: 1, y: 1 })).toBe(true)
  expect(tester.contains({ x: 2, y: 2 })).toBe(false)
  expect(tester.contains({ x: 4, y: 1 })).toBe(false)
  expect(mask.reads).toEqual([{ x: 0, y: 0, w: 4, h: 4 }])
})

test("selection hit tester handles rectangular and elliptical selections without mask reads", () => {
  const rectTester = createSelectionHitTester(20, 20, {
    bounds: { x: 2, y: 3, w: 5, h: 6 },
    shape: "rect",
  })
  expect(rectTester.contains({ x: 2, y: 3 })).toBe(true)
  expect(rectTester.contains({ x: 8, y: 3 })).toBe(false)

  const ellipseTester = createSelectionHitTester(20, 20, {
    bounds: { x: 4, y: 4, w: 8, h: 6 },
    shape: "ellipse",
  })
  expect(ellipseTester.contains({ x: 8, y: 7 })).toBe(true)
  expect(ellipseTester.contains({ x: 4, y: 4 })).toBe(false)
})
