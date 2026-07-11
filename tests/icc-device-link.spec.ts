import { expect, test } from "@playwright/test"

import {
  applyDeviceLinkToImageData,
  isExecutableDeviceLinkProfile,
  parseIccProfile,
  transformRgbColor,
} from "../components/photoshop/icc-transform"

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

/* ---------- Synthetic ICC device-link builder ---------- */

interface SyntheticLinkOptions {
  inputSpace: string
  outputSpace: string
  inputChannels: number
  outputChannels: number
  gridPoints: number
  /** Maps grid coordinates (each 0..1) to output channel values (0..1). */
  map: (coords: number[]) => number[]
}

/**
 * Build a minimal ICC device-link profile with a single mft2 A2B0 tag.
 * Field layout mirrors readLut8Or16Tag: 8-byte type header, channel counts
 * at +8/+9, grid points at +10, 9 s15Fixed16 matrix values at +12, entry
 * counts at +48/+50, then input tables / CLUT / output tables as u16.
 */
function buildDeviceLinkProfile(options: SyntheticLinkOptions): Uint8Array {
  const { inputChannels, outputChannels, gridPoints } = options
  const inputEntries = 2
  const outputEntries = 2
  let clutSize = outputChannels
  for (let i = 0; i < inputChannels; i++) clutSize *= gridPoints

  const tagDataSize =
    52 +
    inputChannels * inputEntries * 2 +
    clutSize * 2 +
    outputChannels * outputEntries * 2
  const headerSize = 128
  const tagTableSize = 4 + 12
  const tagOffset = headerSize + tagTableSize
  const total = tagOffset + tagDataSize
  const bytes = new Uint8Array(total)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i)
  }

  // Header
  view.setUint32(0, total, false)
  ascii(4, "test")
  view.setUint32(8, 0x02200000, false) // version 2.2
  ascii(12, "link")
  ascii(16, options.inputSpace)
  ascii(20, options.outputSpace)
  ascii(36, "acsp")

  // Tag table: one entry (A2B0)
  view.setUint32(headerSize, 1, false)
  ascii(headerSize + 4, "A2B0")
  view.setUint32(headerSize + 8, tagOffset, false)
  view.setUint32(headerSize + 12, tagDataSize, false)

  // mft2 tag
  ascii(tagOffset, "mft2")
  bytes[tagOffset + 8] = inputChannels
  bytes[tagOffset + 9] = outputChannels
  bytes[tagOffset + 10] = gridPoints
  // Identity matrix (s15Fixed16): 1.0 = 0x00010000
  for (let i = 0; i < 9; i++) {
    view.setUint32(tagOffset + 12 + i * 4, i % 4 === 0 ? 0x00010000 : 0, false)
  }
  view.setUint16(tagOffset + 48, inputEntries, false)
  view.setUint16(tagOffset + 50, outputEntries, false)
  let cursor = tagOffset + 52
  // Identity input tables
  for (let c = 0; c < inputChannels; c++) {
    view.setUint16(cursor, 0, false)
    view.setUint16(cursor + 2, 65535, false)
    cursor += 4
  }
  // CLUT: iterate grid in row-major order (first channel slowest)
  const coords = new Array(inputChannels).fill(0)
  const totalNodes = clutSize / outputChannels
  for (let node = 0; node < totalNodes; node++) {
    let rest = node
    for (let c = inputChannels - 1; c >= 0; c--) {
      coords[c] = rest % gridPoints
      rest = Math.floor(rest / gridPoints)
    }
    const unitCoords = coords.map((v) => v / (gridPoints - 1))
    const outputs = options.map(unitCoords)
    for (let o = 0; o < outputChannels; o++) {
      view.setUint16(cursor, Math.round(Math.max(0, Math.min(1, outputs[o] ?? 0)) * 65535), false)
      cursor += 2
    }
  }
  // Identity output tables
  for (let c = 0; c < outputChannels; c++) {
    view.setUint16(cursor, 0, false)
    view.setUint16(cursor + 2, 65535, false)
    cursor += 4
  }
  return bytes
}

/* ---------- Tests ---------- */

test("device-link profiles parse with executable diagnostics", () => {
  const profile = buildDeviceLinkProfile({
    inputSpace: "RGB ",
    outputSpace: "RGB ",
    inputChannels: 3,
    outputChannels: 3,
    gridPoints: 2,
    map: ([r, g, b]) => [b, g, r],
  })
  const parsed = parseIccProfile(profile)
  expect(parsed).not.toBeNull()
  expect(parsed!.deviceLink).toBe(true)
  expect(parsed!.profileClass).toBe("link")
  expect(parsed!.hasClut).toBe(true)
  expect(parsed!.diagnostics.join(" ")).toContain("executes browser-locally")
  expect(isExecutableDeviceLinkProfile(profile)).toBe(true)
})

test("RGB->RGB device-link executes its CLUT chain (channel swap)", () => {
  const profile = buildDeviceLinkProfile({
    inputSpace: "RGB ",
    outputSpace: "RGB ",
    inputChannels: 3,
    outputChannels: 3,
    gridPoints: 2,
    map: ([r, g, b]) => [b, g, r],
  })
  const result = transformRgbColor({ r: 255, g: 64, b: 0 }, { sourceProfileData: profile })
  expect(result.rgb.r).toBe(0)
  expect(result.rgb.g).toBe(64)
  expect(result.rgb.b).toBe(255)
})

test("device-link wins over the PCS pipeline when set as target", () => {
  const profile = buildDeviceLinkProfile({
    inputSpace: "RGB ",
    outputSpace: "RGB ",
    inputChannels: 3,
    outputChannels: 3,
    gridPoints: 2,
    map: ([r, g, b]) => [1 - r, 1 - g, 1 - b],
  })
  const result = transformRgbColor(
    { r: 200, g: 100, b: 50 },
    { sourceProfile: "sRGB IEC61966-2.1", targetProfileData: profile },
  )
  expect(Math.abs(result.rgb.r - 55)).toBeLessThanOrEqual(1)
  expect(Math.abs(result.rgb.g - 155)).toBeLessThanOrEqual(1)
  expect(Math.abs(result.rgb.b - 205)).toBeLessThanOrEqual(1)
})

test("RGB->CMYK device-link maps output through ink preview", () => {
  // Pure cyan ink for any input: c=1, m=y=k=0.
  const profile = buildDeviceLinkProfile({
    inputSpace: "RGB ",
    outputSpace: "CMYK",
    inputChannels: 3,
    outputChannels: 4,
    gridPoints: 2,
    map: () => [1, 0, 0, 0],
  })
  const result = transformRgbColor({ r: 128, g: 128, b: 128 }, { sourceProfileData: profile })
  expect(result.rgb.r).toBe(0)
  expect(result.rgb.g).toBe(255)
  expect(result.rgb.b).toBe(255)
})

test("applyDeviceLinkToImageData converts pixels and preserves alpha", () => {
  const profile = buildDeviceLinkProfile({
    inputSpace: "RGB ",
    outputSpace: "RGB ",
    inputChannels: 3,
    outputChannels: 3,
    gridPoints: 2,
    map: ([r, g, b]) => [g, r, b],
  })
  const source = new ImageData(new Uint8ClampedArray([
    255, 0, 0, 255,
    0, 200, 0, 128,
    10, 20, 30, 0,
  ]), 3, 1)
  const out = applyDeviceLinkToImageData(source, profile)
  expect(out).not.toBeNull()
  expect([out!.data[0], out!.data[1], out!.data[2], out!.data[3]]).toEqual([0, 255, 0, 255])
  expect([out!.data[4], out!.data[5], out!.data[6], out!.data[7]]).toEqual([200, 0, 0, 128])
  // Fully transparent pixels are left untouched.
  expect([out!.data[8], out!.data[9], out!.data[10]]).toEqual([10, 20, 30])
})

test("non-link profiles are rejected by the device-link API", () => {
  expect(isExecutableDeviceLinkProfile(new Uint8Array(64))).toBe(false)
  const source = new ImageData(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1)
  expect(applyDeviceLinkToImageData(source, new Uint8Array(64))).toBeNull()
})

test("multi-node grid interpolates between CLUT nodes", () => {
  // 3-point grid mapping value -> value^1 on R only, halved on G.
  const profile = buildDeviceLinkProfile({
    inputSpace: "RGB ",
    outputSpace: "RGB ",
    inputChannels: 3,
    outputChannels: 3,
    gridPoints: 3,
    map: ([r, g, b]) => [r, g * 0.5, b],
  })
  const result = transformRgbColor({ r: 128, g: 128, b: 128 }, { sourceProfileData: profile })
  expect(Math.abs(result.rgb.r - 128)).toBeLessThanOrEqual(1)
  expect(Math.abs(result.rgb.g - 64)).toBeLessThanOrEqual(1)
  expect(Math.abs(result.rgb.b - 128)).toBeLessThanOrEqual(1)
})
