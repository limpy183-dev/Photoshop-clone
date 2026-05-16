import { expect, test } from "@playwright/test"

import {
  CAMERA_RAW_PRESETS,
  applyCameraRawBatch,
  applyCameraRawImageData,
  createCameraRawSnapshot,
} from "../components/photoshop/camera-raw-engine"
import { getFilter } from "../components/photoshop/filters"
import { applyFilterTiled } from "../components/photoshop/filter-worker"

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

function gradientFixture(width = 5, height = 5) {
  const pixels: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixels.push(x * 40 + y * 5, y * 42, 180 - x * 20, 255)
    }
  }
  return imageData(width, height, pixels)
}

test("Blur Gallery filters exist as named algorithms with spatially varying output", () => {
  const src = gradientFixture()
  const ids = ["field-blur", "iris-blur", "tilt-shift", "path-blur", "spin-blur"]

  for (const id of ids) {
    const filter = getFilter(id)
    expect(filter, id).toBeTruthy()
    const out = filter!.apply(src, {
      blur: 8,
      radius: 35,
      feather: 25,
      angle: 0,
      distance: 8,
      centerX: 50,
      centerY: 50,
    })
    expect(out.width).toBe(src.width)
    expect(Array.from(out.data)).not.toEqual(Array.from(src.data))
  }
})

test("tiled filter execution reproduces full-frame output for local per-pixel filters", async () => {
  const src = gradientFixture(6, 4)
  const filter = getFilter("brightness-contrast")!
  const params = { brightness: 18, contrast: 22, useLegacy: false }

  const expected = filter.apply(src, params)
  const tiled = await applyFilterTiled("brightness-contrast", src, params, { tileSize: 2, overlap: 0 })

  expect(Array.from(tiled.data)).toEqual(Array.from(expected.data))
})

test("Camera Raw engine applies HSL, optics, masks, snapshots, presets, and batch settings", () => {
  const src = gradientFixture(3, 2)
  const mask = new Uint8ClampedArray([255, 0, 0, 255, 0, 0])
  const settings = {
    ...CAMERA_RAW_PRESETS.landscape.settings,
    exposure: 0.35,
    hsl: { blues: { hue: -10, saturation: 30, luminance: -5 } },
    optics: { distortion: 12, vignette: -20, chromaticAberration: 8 },
    calibration: { redHue: 4, greenHue: -3, blueHue: 2, saturation: 12 },
  }

  const snapshot = createCameraRawSnapshot("Landscape masked", settings)
  const masked = applyCameraRawImageData(src, settings, { maskData: mask, maskWidth: 3, maskHeight: 2 })
  const batch = applyCameraRawBatch([src, src], snapshot.settings)

  expect(snapshot.name).toBe("Landscape masked")
  expect(masked.data[0]).not.toBe(src.data[0])
  expect(Array.from(masked.data.slice(4, 8))).toEqual(Array.from(src.data.slice(4, 8)))
  expect(batch).toHaveLength(2)
  expect(Array.from(batch[0].data)).toEqual(Array.from(applyCameraRawImageData(src, snapshot.settings).data))
})
