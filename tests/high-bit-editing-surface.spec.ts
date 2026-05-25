import { expect, test } from "@playwright/test"

import {
  applyHighBitSurfaceAdjustment,
  compositeHighBitEditingSurface,
  createHighBitEditingSurface,
  paintHighBitEditingSurface,
} from "../components/photoshop/high-bit-document"

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

test("high-bit editing surface paints, adjusts, and composites without canvas quantization", () => {
  const surface = createHighBitEditingSurface({
    width: 2,
    height: 1,
    bitDepth: 16,
    colorMode: "RGB",
    profile: "ProPhoto RGB",
    layers: [{
      id: "paint",
      name: "Paint",
      visible: true,
      opacity: 1,
      blendMode: "normal",
      image: {
        width: 2,
        height: 1,
        channels: 4,
        bitDepth: 16,
        colorMode: "RGB",
        profile: "ProPhoto RGB",
        storage: "uint16",
        data: new Uint16Array([
          32768, 32769, 12000, 65535,
          32769, 32770, 12001, 65535,
        ]),
        warnings: [],
      },
    }],
  })

  const painted = paintHighBitEditingSurface(surface, "paint", {
    x: 1,
    y: 0,
    radius: 0.75,
    color: { r: 129, g: 130, b: 47, a: 255 },
    opacity: 0.5,
  })
  const adjusted = applyHighBitSurfaceAdjustment(painted, "paint", {
    type: "exposure",
    params: { ev: 0.125 },
  })
  const composite = compositeHighBitEditingSurface(adjusted, { transparent: true })

  expect(composite.image.storage).toBe("uint16")
  expect(composite.image.data).toBeInstanceOf(Uint16Array)
  expect(composite.image.data[0]).toBeGreaterThan(32768)
  expect(composite.image.data[1] - composite.image.data[0]).toBeGreaterThanOrEqual(1)
  expect(composite.image.profile).toBe("ProPhoto RGB")
  expect(composite.toneMapped.data[0]).toBeGreaterThan(128)
})

test("high-bit editing surface supports color replacement and dirty eraser dabs", () => {
  const surface = createHighBitEditingSurface({
    width: 2,
    height: 1,
    bitDepth: 16,
    colorMode: "RGB",
    profile: "ProPhoto RGB",
    layers: [{
      id: "paint",
      visible: true,
      opacity: 1,
      blendMode: "normal",
      image: {
        width: 2,
        height: 1,
        channels: 4,
        bitDepth: 16,
        colorMode: "RGB",
        profile: "ProPhoto RGB",
        storage: "uint16",
        data: new Uint16Array([
          32768, 12000, 9000, 65535,
          9000, 32768, 9000, 65535,
        ]),
        warnings: [],
      },
    }],
  })

  const recolored = paintHighBitEditingSurface(surface, "paint", {
    x: 0,
    y: 0,
    radius: 1.25,
    color: { r: 40, g: 100, b: 230, a: 255 },
    opacity: 1,
    mode: "color-replace",
    replacementMode: "color",
    sampleColor: { r: 128, g: 47, b: 35, a: 255 },
    tolerance: 42,
  })
  const erased = paintHighBitEditingSurface(recolored, "paint", {
    x: 1,
    y: 0,
    radius: 0.75,
    color: { r: 0, g: 0, b: 0, a: 255 },
    opacity: 0.5,
    mode: "destination-out",
    dirtyRect: { x: 1, y: 0, w: 1, h: 1 },
  })
  const image = erased.layers[0].image

  expect(image.storage).toBe("uint16")
  expect(image.data[2]).toBeGreaterThan(image.data[0])
  expect(image.data[3]).toBe(65535)
  expect(image.data[7]).toBeLessThan(65535)
  expect(image.data[4]).toBe(9000)
  expect(image.data[5]).toBe(32768)
  expect(image.data[6]).toBe(9000)
})
