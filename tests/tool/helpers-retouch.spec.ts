import { expect, test } from "@playwright/test"

import { blurStamp, dodgeBurnStamp, healStamp, spongeStamp } from "@/editor/tool/helpers"

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

test("blur stamp scales with the brush and honours Strength", () => {
  // A hard black/white split down the middle of a 40px image. The old fixed
  // 3x3 kernel left every pixel more than one column from the seam untouched
  // however big the brush was, and ignored Strength entirely.
  const edged = () => {
    const img = makeImage(40, 40, [0, 0, 0, 255])
    for (let y = 0; y < 40; y++) {
      for (let x = 20; x < 40; x++) setPixel(img.data, img.width, x, y, [255, 255, 255, 255])
    }
    return img
  }

  const full = fakeContext(edged())
  blurStamp(full, 20, 20, 16, 1)
  const blurred = (full as unknown as { __image: () => ImageData }).__image()
  // Two pixels from the seam is outside a 3x3 kernel's reach, so this stayed
  // at 0 no matter the brush size before.
  const [near] = getPixel(blurred.data, blurred.width, 18, 20)
  expect(near).toBeGreaterThan(10)
  // ...and stay inside the dab: the far corner is untouched.
  expect(getPixel(blurred.data, blurred.width, 0, 0)).toEqual([0, 0, 0, 255])

  // Half strength moves the same pixel about half as far.
  const half = fakeContext(edged())
  blurStamp(half, 20, 20, 16, 0.5)
  const softer = (half as unknown as { __image: () => ImageData }).__image()
  expect(Math.abs(getPixel(softer.data, softer.width, 18, 20)[0] - near / 2)).toBeLessThanOrEqual(1)

  // Strength 0 is a no-op.
  const none = fakeContext(edged())
  blurStamp(none, 20, 20, 16, 0)
  const same = (none as unknown as { __image: () => ImageData }).__image()
  expect(getPixel(same.data, same.width, 18, 20)).toEqual([0, 0, 0, 255])
})

test("blur stamp softens the alpha edge of a cutout", () => {
  const img = makeImage(40, 40, [255, 0, 0, 0])
  for (let y = 0; y < 40; y++) {
    for (let x = 20; x < 40; x++) setPixel(img.data, img.width, x, y, [255, 0, 0, 255])
  }
  const ctx = fakeContext(img)
  blurStamp(ctx, 20, 20, 16, 1)
  const result = (ctx as unknown as { __image: () => ImageData }).__image()

  const alpha = getPixel(result.data, result.width, 18, 20)[3]
  expect(alpha).toBeGreaterThan(0)
  expect(alpha).toBeLessThan(255)
})

/* ---- spot healing over low-opacity pixels ---- */

function fakeCanvas(image: ImageData): HTMLCanvasElement {
  const ctx = fakeContext(image)
  return {
    width: image.width,
    height: image.height,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement
}

test("heal stamp carries alpha across, so it fills a near-transparent blemish", () => {
  // A barely-visible patch with a dark blemish in the middle, healed from an
  // opaque donor. Blending only RGB left the result stuck at the original
  // alpha, so the spot-healing brush appeared to do nothing on low-opacity
  // colour while the meaningless channels of those pixels fought the donor.
  const dest = makeImage(8, 8, [200, 200, 200, 40])
  setPixel(dest.data, dest.width, 4, 4, [10, 10, 10, 40])
  const donor = makeImage(8, 8, [100, 100, 100, 255])

  const ctx = fakeContext(dest)
  healStamp(ctx, fakeCanvas(donor), 4, 4, 4, 4, 3)
  const result = (ctx as unknown as { __image: () => ImageData }).__image()

  const [r, g, b, a] = getPixel(result.data, result.width, 4, 4)
  expect(a, "the healed centre takes the donor's opacity").toBeGreaterThan(240)
  // Donor + the border offset lands back on the surrounding tone, not the blemish.
  for (const channel of [r, g, b]) expect(Math.abs(channel - 200)).toBeLessThan(12)
})

test("heal stamp ignores fully transparent border pixels when colour-matching", () => {
  // Canvas stores RGBA un-premultiplied, so transparent pixels can hold any
  // colour at all. Letting them into the border average dragged the whole
  // patch toward that colour — the glitch this guards against.
  // healStamp samples the r*2 box around the dab, so ring 1..6 is the border of
  // the patch it colour-matches on. Fill that ring with transparent magenta.
  const dest = makeImage(8, 8, [200, 200, 200, 255])
  for (let i = 1; i <= 6; i++) {
    setPixel(dest.data, dest.width, i, 1, [255, 0, 255, 0])
    setPixel(dest.data, dest.width, i, 6, [255, 0, 255, 0])
    setPixel(dest.data, dest.width, 1, i, [255, 0, 255, 0])
    setPixel(dest.data, dest.width, 6, i, [255, 0, 255, 0])
  }
  setPixel(dest.data, dest.width, 4, 4, [10, 10, 10, 255])
  const donor = makeImage(8, 8, [100, 100, 100, 255])

  const ctx = fakeContext(dest)
  healStamp(ctx, fakeCanvas(donor), 4, 4, 4, 4, 3)
  const result = (ctx as unknown as { __image: () => ImageData }).__image()

  const [r, g, b] = getPixel(result.data, result.width, 4, 4)
  // Neutral, from the donor — not dragged to magenta by pixels that have no
  // visible colour at all.
  expect(Math.abs(r - g), "no colour cast from the transparent border").toBeLessThan(12)
  expect(Math.abs(b - g), "no colour cast from the transparent border").toBeLessThan(12)
})

/* ---- dodge / burn ---- */

test("dodge lifts a near-black pixel instead of pinning it to black", () => {
  // Protect Tones scales the channels by a luminance ratio, which multiplies
  // through zero: dodging shadows did nothing and drove near-blacks to flat
  // black. Below the floor there is no hue to protect, so it goes additive.
  const image = makeImage(8, 8, [0, 0, 0, 255])
  const ctx = fakeContext(image)
  dodgeBurnStamp(ctx, 4, 4, 3, "dodge", 0.5, { range: "shadows", protectTones: true })
  const result = (ctx as unknown as { __image: () => ImageData }).__image()

  expect(getPixel(result.data, result.width, 4, 4)[0]).toBeGreaterThan(0)
})

test("dodge hardness controls how far the dab fades toward its rim", () => {
  const near = (hardness: number) => {
    const image = makeImage(16, 16, [128, 128, 128, 255])
    const ctx = fakeContext(image)
    dodgeBurnStamp(ctx, 8, 8, 6, "dodge", 0.5, { range: "midtones", protectTones: false, hardness })
    const result = (ctx as unknown as { __image: () => ImageData }).__image()
    // A pixel most of the way out to the rim.
    return getPixel(result.data, result.width, 12, 8)[0]
  }
  // A hard brush carries full strength almost to the rim; a soft one has
  // faded away by the same distance.
  expect(near(100)).toBeGreaterThan(near(0))
})
