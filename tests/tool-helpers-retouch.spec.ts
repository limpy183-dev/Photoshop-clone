import { expect, test } from "@playwright/test"

import { spongeStamp } from "../components/photoshop/tool-helpers"

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

function setPixel(data: Uint8ClampedArray, width: number, x: number, y: number, rgba: [number, number, number, number]) {
  const i = (y * width + x) * 4
  data[i] = rgba[0]
  data[i + 1] = rgba[1]
  data[i + 2] = rgba[2]
  data[i + 3] = rgba[3]
}

function getPixel(data: Uint8ClampedArray, width: number, x: number, y: number): [number, number, number, number] {
  const i = (y * width + x) * 4
  return [data[i], data[i + 1], data[i + 2], data[i + 3]]
}

function makeImage(width: number, height: number, fill: [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) setPixel(data, width, x, y, fill)
  }
  return new ImageData(data, width, height)
}

function fakeContext(image: ImageData): CanvasRenderingContext2D {
  let current = image
  return {
    canvas: { width: image.width, height: image.height },
    getImageData: (sx: number, sy: number, sw: number, sh: number) => {
      const data = new Uint8ClampedArray(sw * sh * 4)
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const src = ((sy + y) * image.width + sx + x) * 4
          const dst = (y * sw + x) * 4
          data[dst] = current.data[src]
          data[dst + 1] = current.data[src + 1]
          data[dst + 2] = current.data[src + 2]
          data[dst + 3] = current.data[src + 3]
        }
      }
      return new ImageData(data, sw, sh)
    },
    putImageData: (next: ImageData, dx: number, dy: number) => {
      const data = new Uint8ClampedArray(current.data)
      for (let y = 0; y < next.height; y++) {
        for (let x = 0; x < next.width; x++) {
          const src = (y * next.width + x) * 4
          const dst = ((dy + y) * image.width + dx + x) * 4
          data[dst] = next.data[src]
          data[dst + 1] = next.data[src + 1]
          data[dst + 2] = next.data[src + 2]
          data[dst + 3] = next.data[src + 3]
        }
      }
      current = new ImageData(data, image.width, image.height)
    },
    __image: () => current,
  } as unknown as CanvasRenderingContext2D
}

test("sponge stamp desaturates opaque pixels inside the circular brush only", () => {
  const source = makeImage(6, 6, [20, 40, 80, 255])
  setPixel(source.data, source.width, 3, 3, [200, 50, 50, 255])
  setPixel(source.data, source.width, 2, 3, [10, 220, 30, 0])
  setPixel(source.data, source.width, 0, 0, [240, 10, 180, 255])

  const ctx = fakeContext(source)
  spongeStamp(ctx, 3, 3, 2, 0.5)
  const result = (ctx as unknown as { __image: () => ImageData }).__image()

  expect(getPixel(result.data, result.width, 3, 3)).toEqual([147, 72, 72, 255])
  expect(getPixel(result.data, result.width, 2, 3)).toEqual([10, 220, 30, 0])
  expect(getPixel(result.data, result.width, 0, 0)).toEqual([240, 10, 180, 255])
})
