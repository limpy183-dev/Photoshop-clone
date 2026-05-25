import { expect, test } from "@playwright/test"

import {
  buildEdgeAwareQuickSelectionMaskData,
  decontaminateImageDataWithMask,
  refineSelectionMaskData,
  selectionDiagnosticsOverlayData,
} from "../components/photoshop/algorithmic-operations"

class TestImageData {
  data: Uint8ClampedArray
  width: number
  height: number

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth
      this.height = widthOrHeight
      this.data = new Uint8ClampedArray(this.width * this.height * 4)
    } else {
      this.data = dataOrWidth
      this.width = widthOrHeight
      this.height = height ?? Math.floor(dataOrWidth.length / 4 / widthOrHeight)
    }
  }
}

globalThis.ImageData = TestImageData as unknown as typeof ImageData

function imageData(width: number, height: number, pixels: number[]) {
  return new ImageData(new Uint8ClampedArray(pixels), width, height)
}

function solidObjectFixture() {
  const pixels: number[] = []
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      const inside = x >= 1 && x <= 3 && y >= 1 && y <= 3
      pixels.push(inside ? 216 : 18, inside ? 34 : 42, inside ? 32 : 214, 255)
    }
  }
  return imageData(5, 5, pixels)
}

test("adaptive quick selection accepts a coherent object region while stopping at surrounding color edges", () => {
  const result = buildEdgeAwareQuickSelectionMaskData(solidObjectFixture(), {
    seed: { x: 2, y: 2 },
    tolerance: 26,
    adaptive: true,
  })

  expect(result.bounds).toEqual({ x: 1, y: 1, w: 3, h: 3 })
  expect(result.maskData.filter((value) => value === 255)).toHaveLength(9)
  expect(result.maskData[0]).toBe(0)
  expect(result.maskData[2 * 5 + 2]).toBe(255)
})

test("quick selection reports edge and color rejections when difficult boundaries stop expansion", () => {
  const pixels: number[] = []
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const inside = x >= 1 && x <= 3 && y >= 1 && y <= 5
      const weakBridge = x === 4 && y >= 2 && y <= 4
      const r = inside ? 206 : weakBridge ? 170 : 28
      const g = inside ? 56 : weakBridge ? 72 : 120
      const b = inside ? 38 : weakBridge ? 54 : 218
      pixels.push(r, g, b, 255)
    }
  }

  const result = buildEdgeAwareQuickSelectionMaskData(imageData(7, 7, pixels), {
    seed: { x: 2, y: 3 },
    tolerance: 42,
    adaptive: true,
    includeDiagonals: true,
    edgeSensitivity: 0.9,
    diagnostics: true,
  })

  expect(result.bounds).toEqual({ x: 1, y: 1, w: 3, h: 5 })
  expect(result.maskData[3 * 7 + 4]).toBe(0)
  expect(result.diagnostics.reasonCounts.edge).toBeGreaterThan(0)
  expect(result.diagnostics.reasonCounts.color).toBeGreaterThan(0)
  expect(result.diagnostics.summary).toContain("stopped at edge contrast")

  const overlay = selectionDiagnosticsOverlayData(result.diagnostics, 7, 7)
  const edgeRejectedPixel = result.diagnostics.reasonMap.findIndex((reason) => reason === 3)
  expect(edgeRejectedPixel).toBeGreaterThanOrEqual(0)
  expect(overlay.data[edgeRejectedPixel * 4 + 3]).toBeGreaterThan(0)
})

test("selection refinement smooths pinholes, feathers edges, and can shift the selection outward", () => {
  const mask = new Uint8ClampedArray(7 * 7)
  for (let y = 2; y <= 4; y++) {
    for (let x = 2; x <= 4; x++) mask[y * 7 + x] = 255
  }
  mask[3 * 7 + 3] = 0
  mask[0] = 255

  const refined = refineSelectionMaskData(mask, 7, 7, {
    smoothRadius: 1,
    featherRadius: 1,
    contrast: 20,
    shiftEdge: 1,
  })

  expect(refined.bounds).toEqual({ x: 1, y: 1, w: 5, h: 5 })
  expect(refined.maskData[3 * 7 + 3]).toBeGreaterThan(180)
  expect(refined.maskData[1 * 7 + 3]).toBeGreaterThan(0)
  expect(refined.maskData[1 * 7 + 3]).toBeLessThan(255)
  expect(refined.maskData[0]).toBe(0)
})

test("local matting preserves semi-transparent hair-like edge pixels without selecting background", () => {
  const pixels: number[] = []
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 7; x++) {
      const core = x >= 2 && x <= 4
      const hair = x === 1 || x === 5
      pixels.push(
        core ? 120 : hair ? 132 : 24,
        core ? 82 : hair ? 78 : 114,
        core ? 42 : hair ? 50 : 218,
        hair ? 132 : 255,
      )
    }
  }
  const initial = new Uint8ClampedArray(7 * 3)
  for (let y = 0; y < 3; y++) {
    for (let x = 2; x <= 4; x++) initial[y * 7 + x] = 255
  }

  const refined = refineSelectionMaskData(initial, 7, 3, {
    sourceImage: imageData(7, 3, pixels),
    smartRadius: true,
    edgeRadius: 2,
    matteRadius: 2,
    transparencyMatting: true,
  })

  expect(refined.maskData[1 * 7 + 1]).toBeGreaterThan(70)
  expect(refined.maskData[1 * 7 + 1]).toBeLessThan(230)
  expect(refined.maskData[1 * 7 + 5]).toBeGreaterThan(70)
  expect(refined.maskData[1 * 7 + 0]).toBeLessThan(32)
  expect(refined.bounds).toEqual({ x: 1, y: 0, w: 5, h: 3 })
})

test("filament-aware matting keeps thin opaque strands near the edge as partial alpha", () => {
  const pixels: number[] = []
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 9; x++) {
      const core = x >= 4 && x <= 5 && y >= 1 && y <= 3
      const strand = (x === 3 || x === 6) && y >= 1 && y <= 3
      const remoteDark = x === 0 && y === 4
      pixels.push(
        core ? 96 : strand || remoteDark ? 104 : 42,
        core ? 66 : strand || remoteDark ? 62 : 130,
        core ? 34 : strand || remoteDark ? 38 : 220,
        255,
      )
    }
  }

  const initial = new Uint8ClampedArray(9 * 5)
  for (let y = 1; y <= 3; y++) {
    for (let x = 4; x <= 5; x++) initial[y * 9 + x] = 255
  }

  const refined = refineSelectionMaskData(initial, 9, 5, {
    sourceImage: imageData(9, 5, pixels),
    smartRadius: true,
    edgeRadius: 2,
    matteRadius: 3,
    transparencyMatting: true,
    preserveEdgeFilaments: true,
    filamentRadius: 3,
  })

  expect(refined.maskData[2 * 9 + 3]).toBeGreaterThan(64)
  expect(refined.maskData[2 * 9 + 3]).toBeLessThan(255)
  expect(refined.maskData[2 * 9 + 6]).toBeGreaterThan(64)
  expect(refined.maskData[4 * 9 + 0]).toBeLessThan(32)
})

test("decontaminate colors pulls semi-transparent edge pixels toward protected interior colors", () => {
  const source = imageData(3, 1, [
    30, 80, 220, 255,
    150, 24, 136, 255,
    220, 28, 32, 255,
  ])
  const mask = new Uint8ClampedArray([0, 128, 255])

  const result = decontaminateImageDataWithMask(source, mask, 3, 1, { amount: 1, radius: 2 })

  expect(Array.from(result.data.slice(0, 4))).toEqual([30, 80, 220, 255])
  expect(result.data[4]).toBeGreaterThan(170)
  expect(result.data[5]).toBeLessThan(35)
  expect(result.data[6]).toBeLessThan(100)
  expect(Array.from(result.data.slice(8, 12))).toEqual([220, 28, 32, 255])
})
