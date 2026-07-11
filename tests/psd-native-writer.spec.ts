import { inflateSync } from "node:zlib"

import { expect, test } from "@playwright/test"
import { readPsd } from "ag-psd"

import type { HighBitImage } from "../components/photoshop/color-pipeline"
import { rgbToCmyk as pipelineRgbToCmyk } from "../components/photoshop/color-pipeline"
import {
  canWriteNativeLayeredPsd,
  writeNativeLayeredPsd,
  type NativeLayeredPsdLayerInput,
} from "../components/photoshop/psd-native-writer"
import type { PsDocument } from "../components/photoshop/types"

/* ---------- Fixtures ---------- */

function fakeDoc(overrides: Partial<PsDocument>): PsDocument {
  return {
    id: "doc",
    name: "test",
    width: 8,
    height: 8,
    zoom: 1,
    layers: [],
    activeLayerId: "",
    selectedLayerIds: [],
    background: "#ffffff",
    colorMode: "RGB",
    bitDepth: 16,
    selection: { bounds: null, shape: "rect" },
    ...overrides,
  }
}

function highBitImage16(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number],
): HighBitImage {
  const data = new Uint16Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y)
      const o = (y * width + x) * 4
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] = a
    }
  }
  return {
    width,
    height,
    channels: 4,
    bitDepth: 16,
    colorMode: "RGB",
    storage: "uint16",
    data,
    warnings: [],
  }
}

function uint8Image(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number],
): HighBitImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y)
      const o = (y * width + x) * 4
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] = a
    }
  }
  return {
    width,
    height,
    channels: 4,
    bitDepth: 8,
    colorMode: "RGB",
    storage: "uint8",
    data,
    warnings: [],
  }
}

/* ---------- Minimal native-PSD parser (test-side verification) ---------- */

interface ParsedChannel {
  id: number
  length: number
  data: Uint8Array
}

interface ParsedLayer {
  rect: { top: number; left: number; bottom: number; right: number }
  channels: ParsedChannel[]
  blendKey: string
  opacity: number
  clipping: number
  flags: number
  mask?: {
    top: number
    left: number
    bottom: number
    right: number
    defaultColor: number
    maskFlags: number
  }
  name: string
  unicodeName?: string
  sectionType?: number
}

interface ParsedNativePsd {
  version: number
  channels: number
  height: number
  width: number
  bitDepth: number
  colorMode: number
  layers: ParsedLayer[]
}

function parseNativePsd(bytes: Uint8Array): ParsedNativePsd {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let o = 0
  const ascii = (n: number) => {
    let s = ""
    for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[o + i])
    o += n
    return s
  }
  const u16 = () => {
    const v = view.getUint16(o, false)
    o += 2
    return v
  }
  const i16 = () => {
    const v = view.getInt16(o, false)
    o += 2
    return v
  }
  const u32 = () => {
    const v = view.getUint32(o, false)
    o += 4
    return v
  }
  const i32 = () => {
    const v = view.getInt32(o, false)
    o += 4
    return v
  }
  const u64 = () => {
    const high = view.getUint32(o, false)
    const low = view.getUint32(o + 4, false)
    o += 8
    return high * 0x100000000 + low
  }

  expect(ascii(4)).toBe("8BPS")
  const version = u16()
  const large = version === 2
  o += 6
  const channels = u16()
  const height = u32()
  const width = u32()
  const bitDepth = u16()
  const colorMode = u16()

  const colorModeDataLength = u32()
  o += colorModeDataLength
  const imageResourcesLength = u32()
  o += imageResourcesLength

  // Layer & mask section
  if (large) u64()
  else u32()
  const layerInfoLength = large ? u64() : u32()
  const layerInfoEnd = o + layerInfoLength
  const layerCount = Math.abs(i16())

  const layers: ParsedLayer[] = []
  for (let li = 0; li < layerCount; li++) {
    const rect = { top: i32(), left: i32(), bottom: i32(), right: i32() }
    const channelCount = u16()
    const chans: ParsedChannel[] = []
    for (let c = 0; c < channelCount; c++) {
      const id = i16()
      const length = large ? u64() : u32()
      chans.push({ id, length, data: new Uint8Array() })
    }
    expect(ascii(4)).toBe("8BIM")
    const blendKey = ascii(4)
    const opacity = bytes[o++]
    const clipping = bytes[o++]
    const flags = bytes[o++]
    o++ // filler
    const extraLength = u32()
    const extraEnd = o + extraLength

    const layer: ParsedLayer = {
      rect,
      channels: chans,
      blendKey,
      opacity,
      clipping,
      flags,
      name: "",
    }

    const maskLength = u32()
    if (maskLength >= 20) {
      layer.mask = {
        top: i32(),
        left: i32(),
        bottom: i32(),
        right: i32(),
        defaultColor: bytes[o],
        maskFlags: bytes[o + 1],
      }
      o += maskLength - 16
    } else {
      o += maskLength
    }
    const blendingRangesLength = u32()
    o += blendingRangesLength
    // Pascal name padded to 4
    const nameLength = bytes[o]
    layer.name = ""
    for (let i = 0; i < nameLength; i++) layer.name += String.fromCharCode(bytes[o + 1 + i])
    o += Math.ceil((1 + nameLength) / 4) * 4

    // Additional info blocks
    while (o + 12 <= extraEnd) {
      const sig = ascii(4)
      expect(sig).toBe("8BIM")
      const key = ascii(4)
      const length = u32()
      const dataStart = o
      if (key === "luni") {
        const count = u32()
        let name = ""
        for (let i = 0; i < count; i++) name += String.fromCharCode(u16())
        layer.unicodeName = name
      } else if (key === "lsct") {
        layer.sectionType = u32()
      }
      o = dataStart + length
    }
    o = extraEnd
    layers.push(layer)
  }

  // Channel data planes, in layer/record order.
  for (const layer of layers) {
    for (const ch of layer.channels) {
      ch.data = bytes.subarray(o, o + ch.length)
      o += ch.length
    }
  }
  expect(o).toBeLessThanOrEqual(layerInfoEnd)

  return { version, channels, height, width, bitDepth, colorMode, layers }
}

/** Decode a zip-with-prediction 16-bit plane back to u16 samples. */
function decodeZipPredicted16(channel: ParsedChannel, width: number, height: number): Uint16Array {
  const view = new DataView(channel.data.buffer, channel.data.byteOffset, channel.data.byteLength)
  expect(view.getUint16(0, false)).toBe(3)
  const inflated = inflateSync(channel.data.subarray(2))
  const out = new Uint16Array(width * height)
  for (let i = 0; i < out.length; i++) out[i] = (inflated[i * 2] << 8) | inflated[i * 2 + 1]
  for (let y = 0; y < height; y++) {
    for (let x = 1; x < width; x++) {
      out[y * width + x] = (out[y * width + x] + out[y * width + x - 1]) & 0xffff
    }
  }
  return out
}

/** Decode an RLE (PackBits) 8-bit plane back to bytes. */
function decodeRle8(channel: ParsedChannel, width: number, height: number, large = false): Uint8Array {
  const view = new DataView(channel.data.buffer, channel.data.byteOffset, channel.data.byteLength)
  expect(view.getUint16(0, false)).toBe(1)
  const lengths: number[] = []
  let o = 2
  for (let y = 0; y < height; y++) {
    lengths.push(large ? view.getUint32(o, false) : view.getUint16(o, false))
    o += large ? 4 : 2
  }
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const end = o + lengths[y]
    let x = 0
    while (o < end) {
      const header = channel.data[o++]
      if (header > 128) {
        const value = channel.data[o++]
        const count = 256 - header + 1
        for (let i = 0; i < count && x < width; i++) out[y * width + x++] = value
      } else if (header < 128) {
        for (let i = 0; i <= header && x < width; i++) out[y * width + x++] = channel.data[o++]
      }
    }
    o = end
  }
  return out
}

/* ---------- Tests ---------- */

test("canWriteNativeLayeredPsd routes high-bit and non-RGB documents", () => {
  expect(canWriteNativeLayeredPsd(fakeDoc({ colorMode: "RGB", bitDepth: 8 }))).toBe(false)
  expect(canWriteNativeLayeredPsd(fakeDoc({ colorMode: "RGB", bitDepth: 16 }))).toBe(true)
  expect(canWriteNativeLayeredPsd(fakeDoc({ colorMode: "RGB", bitDepth: 32 }))).toBe(true)
  expect(canWriteNativeLayeredPsd(fakeDoc({ colorMode: "CMYK", bitDepth: 8 }))).toBe(true)
  expect(canWriteNativeLayeredPsd(fakeDoc({ colorMode: "Bitmap", bitDepth: 8 }))).toBe(false)
})

test("16-bit layered PSD stores zip-predicted planes that decode exactly", async () => {
  const doc = fakeDoc({ width: 6, height: 4, colorMode: "RGB", bitDepth: 16 })
  const gradient = (x: number, y: number): [number, number, number, number] => [
    (x * 9000 + y * 700) & 0xffff,
    (x * 123 + y * 4567) & 0xffff,
    (x * 40000 + y) & 0xffff,
    65535,
  ]
  const image = highBitImage16(6, 4, gradient)
  const buffer = await writeNativeLayeredPsd(doc, {
    composite: image,
    layers: [{ name: "Layer 1", image, hasHighBitSource: true }],
  })
  const parsed = parseNativePsd(new Uint8Array(buffer))

  expect(parsed.version).toBe(1)
  expect(parsed.bitDepth).toBe(16)
  expect(parsed.colorMode).toBe(3)
  expect(parsed.layers).toHaveLength(1)

  const layer = parsed.layers[0]
  expect(layer.name).toBe("Layer 1")
  expect(layer.unicodeName).toBe("Layer 1")
  // Fully opaque layer trims to the full canvas.
  expect(layer.rect).toEqual({ top: 0, left: 0, bottom: 4, right: 6 })

  const red = layer.channels.find((c) => c.id === 0)!
  const width = layer.rect.right - layer.rect.left
  const height = layer.rect.bottom - layer.rect.top
  const decoded = decodeZipPredicted16(red, width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      expect(decoded[y * width + x]).toBe(gradient(x, y)[0])
    }
  }
})

test("layer bounds trim to the alpha bounding box", async () => {
  const doc = fakeDoc({ width: 8, height: 8, colorMode: "RGB", bitDepth: 16 })
  const image = highBitImage16(8, 8, (x, y) =>
    x >= 2 && x < 5 && y >= 3 && y < 6 ? [30000, 20000, 10000, 65535] : [0, 0, 0, 0],
  )
  const buffer = await writeNativeLayeredPsd(doc, {
    composite: image,
    layers: [{ name: "Trimmed", image, hasHighBitSource: true }],
  })
  const parsed = parseNativePsd(new Uint8Array(buffer))
  expect(parsed.layers[0].rect).toEqual({ top: 3, left: 2, bottom: 6, right: 5 })
})

test("group hierarchy round-trips through ag-psd section markers", async () => {
  const doc = fakeDoc({ width: 4, height: 4, colorMode: "RGB", bitDepth: 16 })
  const image = highBitImage16(4, 4, () => [10000, 20000, 30000, 65535])
  const layers: NativeLayeredPsdLayerInput[] = [
    { name: "</Layer group>", section: "divider", hidden: true },
    { name: "Inside", image, hasHighBitSource: true },
    { name: "My Group", section: "open", opacity: 0.5 },
    { name: "Above", image, hasHighBitSource: true },
  ]
  const buffer = await writeNativeLayeredPsd(doc, { composite: image, layers })
  const parsed = parseNativePsd(new Uint8Array(buffer))

  expect(parsed.layers).toHaveLength(4)
  expect(parsed.layers[0].sectionType).toBe(3)
  expect(parsed.layers[2].sectionType).toBe(1)
  expect(parsed.layers[2].name).toBe("My Group")

  // Strong validity check: a real PSD reader reconstructs the nesting.
  const psd = readPsd(buffer, {
    skipCompositeImageData: true,
    skipLayerImageData: true,
    skipThumbnail: true,
  })
  expect(psd.children).toHaveLength(2)
  const group = psd.children![0]
  expect(group.name).toBe("My Group")
  expect(group.opened).toBe(true)
  expect(group.children).toHaveLength(1)
  expect(group.children![0].name).toBe("Inside")
  expect(psd.children![1].name).toBe("Above")
})

test("raster layer masks emit native mask records and -2 channels", async () => {
  const doc = fakeDoc({ width: 8, height: 8, colorMode: "RGB", bitDepth: 16 })
  const image = highBitImage16(8, 8, () => [40000, 30000, 20000, 65535])
  const maskData = new Uint8Array(16)
  for (let i = 0; i < 16; i++) maskData[i] = i * 16
  const buffer = await writeNativeLayeredPsd(doc, {
    composite: image,
    layers: [
      {
        name: "Masked",
        image,
        hasHighBitSource: true,
        mask: { top: 2, left: 2, bottom: 6, right: 6, defaultColor: 255, disabled: false, data: maskData },
      },
    ],
  })
  const parsed = parseNativePsd(new Uint8Array(buffer))
  const layer = parsed.layers[0]
  expect(layer.mask).toBeDefined()
  expect(layer.mask!.top).toBe(2)
  expect(layer.mask!.right).toBe(6)
  expect(layer.mask!.defaultColor).toBe(255)
  const maskChannel = layer.channels.find((c) => c.id === -2)
  expect(maskChannel).toBeDefined()
  expect(maskChannel!.length).toBeGreaterThan(2)

  const psd = readPsd(buffer, {
    skipCompositeImageData: true,
    skipLayerImageData: true,
    skipThumbnail: true,
  })
  const readerLayer = psd.children![0]
  expect(readerLayer.mask).toBeDefined()
  expect(readerLayer.mask!.top).toBe(2)
  expect(readerLayer.mask!.left).toBe(2)
})

test("8-bit CMYK layers use RLE planes matching the app separation engine", async () => {
  const doc = fakeDoc({ width: 4, height: 2, colorMode: "CMYK", bitDepth: 8 })
  const fill = (x: number, y: number): [number, number, number, number] => [
    40 + x * 50,
    90 + y * 60,
    200 - x * 30,
    255,
  ]
  const image = uint8Image(4, 2, fill)
  const buffer = await writeNativeLayeredPsd(doc, {
    composite: image,
    layers: [{ name: "Ink", image, hasHighBitSource: false }],
  })
  const parsed = parseNativePsd(new Uint8Array(buffer))
  expect(parsed.colorMode).toBe(4)
  expect(parsed.bitDepth).toBe(8)

  const layer = parsed.layers[0]
  const cyan = layer.channels.find((c) => c.id === 0)!
  const width = layer.rect.right - layer.rect.left
  const height = layer.rect.bottom - layer.rect.top
  const decoded = decodeRle8(cyan, width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fill(x, y)
      const expected = Math.round(
        pipelineRgbToCmyk({ r, g, b }, { blackGeneration: "medium", totalInkLimit: 320 }).c * 255,
      )
      expect(Math.abs(decoded[y * width + x] - expected)).toBeLessThanOrEqual(1)
    }
  }
})

test("PSB (large document) output parses with u64 lengths", async () => {
  const doc = fakeDoc({ width: 4, height: 4, colorMode: "RGB", bitDepth: 16 })
  const image = highBitImage16(4, 4, (x, y) => [x * 1000, y * 1000, 500, 65535])
  const buffer = await writeNativeLayeredPsd(doc, {
    psb: true,
    composite: image,
    layers: [{ name: "Big", image, hasHighBitSource: true }],
  })
  const parsed = parseNativePsd(new Uint8Array(buffer))
  expect(parsed.version).toBe(2)
  expect(parsed.layers[0].name).toBe("Big")

  const psd = readPsd(buffer, {
    skipCompositeImageData: true,
    skipLayerImageData: true,
    skipThumbnail: true,
  })
  expect(psd.children).toHaveLength(1)
  expect(psd.children![0].name).toBe("Big")
})

test("32-bit float planes decode through a real PSD reader", async () => {
  const doc = fakeDoc({ width: 4, height: 2, colorMode: "RGB", bitDepth: 32 })
  const data = new Float32Array(4 * 2 * 4)
  for (let i = 0; i < 4 * 2; i++) {
    data[i * 4] = (i + 1) / 10
    data[i * 4 + 1] = 0.5
    data[i * 4 + 2] = 0.25
    data[i * 4 + 3] = 1
  }
  const image: HighBitImage = {
    width: 4,
    height: 2,
    channels: 4,
    bitDepth: 32,
    colorMode: "RGB",
    storage: "float32",
    data,
    warnings: [],
  }
  const buffer = await writeNativeLayeredPsd(doc, {
    composite: image,
    layers: [{ name: "HDR", image, hasHighBitSource: true }],
  })
  const parsed = parseNativePsd(new Uint8Array(buffer))
  expect(parsed.bitDepth).toBe(32)

  const layer = parsed.layers[0]
  const red = layer.channels.find((c) => c.id === 0)!
  const view = new DataView(red.data.buffer, red.data.byteOffset, red.data.byteLength)
  expect(view.getUint16(0, false)).toBe(3)

  // Undo prediction manually: inflate, cumulative-sum bytes per row, then
  // de-planarize big-endian float bytes.
  const width = layer.rect.right - layer.rect.left
  const height = layer.rect.bottom - layer.rect.top
  const inflated = inflateSync(red.data.subarray(2))
  for (let y = 0; y < height; y++) {
    const row = inflated.subarray(y * width * 4, (y + 1) * width * 4)
    for (let i = 1; i < row.length; i++) row[i] = (row[i] + row[i - 1]) & 0xff
  }
  const floatView = new DataView(new ArrayBuffer(4))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rowStart = y * width * 4
      floatView.setUint8(0, inflated[rowStart + x])
      floatView.setUint8(1, inflated[rowStart + width + x])
      floatView.setUint8(2, inflated[rowStart + width * 2 + x])
      floatView.setUint8(3, inflated[rowStart + width * 3 + x])
      const value = floatView.getFloat32(0, false)
      expect(Math.abs(value - (y * width + x + 1) / 10)).toBeLessThanOrEqual(1e-6)
    }
  }
})

test("saved alpha and spot channels emit native extra channels with resources", async () => {
  const doc = fakeDoc({ width: 4, height: 2, colorMode: "RGB", bitDepth: 16 })
  const image = highBitImage16(4, 2, () => [1000, 2000, 3000, 65535])
  const alphaPlane = new Uint8Array([0, 32, 64, 96, 128, 160, 192, 255])
  const spotPlane = new Uint8Array([255, 224, 192, 160, 128, 96, 64, 0])
  const buffer = await writeNativeLayeredPsd(doc, {
    composite: image,
    layers: [{ name: "Base", image, hasHighBitSource: true }],
    extraChannels: [
      { name: "Saved Mask", kind: "alpha", color: { r: 255, g: 0, b: 0 }, opacity: 50, data: alphaPlane },
      { name: "PANTONE 300", kind: "spot", color: { r: 0, g: 92, b: 185 }, opacity: 100, data: spotPlane },
    ],
  })
  const bytes = new Uint8Array(buffer)
  const parsed = parseNativePsd(bytes)
  // 3 color channels (opaque composite, no merged alpha) + 2 extra channels.
  expect(parsed.channels).toBe(5)

  // A real PSD reader must surface both channel names from 1006/1045.
  const psd = readPsd(buffer, {
    skipCompositeImageData: true,
    skipLayerImageData: true,
    skipThumbnail: true,
  })
  expect(psd.imageResources?.alphaChannelNames).toEqual(["Saved Mask", "PANTONE 300"])

  // The composite section must carry the extra planes: raw 16-bit planes,
  // channel order [R, G, B, extra0, extra1].
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const colorModeDataLength = view.getUint32(26, false)
  const resourcesOffset = 30 + colorModeDataLength
  const resourcesLength = view.getUint32(resourcesOffset, false)
  const layerMaskOffset = resourcesOffset + 4 + resourcesLength
  const layerMaskLength = view.getUint32(layerMaskOffset, false)
  const compositeOffset = layerMaskOffset + 4 + layerMaskLength
  expect(view.getUint16(compositeOffset, false)).toBe(0) // raw
  const planeBytes = 4 * 2 * 2
  const alphaPlaneOffset = compositeOffset + 2 + planeBytes * 3
  for (let i = 0; i < alphaPlane.length; i++) {
    const value = view.getUint16(alphaPlaneOffset + i * 2, false)
    // v/255 -> 16-bit is exactly v*257.
    expect(value).toBe(alphaPlane[i] * 257)
  }

  // 1077 DisplayInfo must mark the second channel as spot with its color.
  let cursor = resourcesOffset + 4
  let displayInfo: { colorSpace: number; color: number[]; opacity: number; mode: number }[] | null = null
  while (cursor < resourcesOffset + 4 + resourcesLength) {
    const id = view.getUint16(cursor + 4, false)
    const nameLength = bytes[cursor + 6]
    const nameBytes = 1 + nameLength + ((1 + nameLength) % 2 ? 1 : 0)
    const dataLength = view.getUint32(cursor + 6 + nameBytes, false)
    const dataStart = cursor + 6 + nameBytes + 4
    if (id === 1077) {
      expect(view.getUint32(dataStart, false)).toBe(1)
      displayInfo = []
      let offset = dataStart + 4
      for (let c = 0; c < 2; c++) {
        displayInfo.push({
          colorSpace: view.getInt16(offset, false),
          color: [
            view.getUint16(offset + 2, false),
            view.getUint16(offset + 4, false),
            view.getUint16(offset + 6, false),
            view.getUint16(offset + 8, false),
          ],
          opacity: view.getUint16(offset + 10, false),
          mode: bytes[offset + 12],
        })
        offset += 13
      }
    }
    cursor = dataStart + dataLength + (dataLength % 2)
  }
  expect(displayInfo).not.toBeNull()
  expect(displayInfo![0].mode).toBe(0)
  expect(displayInfo![0].opacity).toBe(50)
  expect(displayInfo![1].mode).toBe(2)
  expect(displayInfo![1].color[0]).toBe(0)
  expect(displayInfo![1].color[2]).toBe(185 * 257)
})

test("fully transparent layers collapse to empty records", async () => {
  const doc = fakeDoc({ width: 4, height: 4, colorMode: "RGB", bitDepth: 16 })
  const opaque = highBitImage16(4, 4, () => [100, 200, 300, 65535])
  const transparent = highBitImage16(4, 4, () => [0, 0, 0, 0])
  const buffer = await writeNativeLayeredPsd(doc, {
    composite: opaque,
    layers: [
      { name: "Empty", image: transparent, hasHighBitSource: true },
      { name: "Full", image: opaque, hasHighBitSource: true },
    ],
  })
  const parsed = parseNativePsd(new Uint8Array(buffer))
  expect(parsed.layers[0].rect).toEqual({ top: 0, left: 0, bottom: 0, right: 0 })
  for (const ch of parsed.layers[0].channels) expect(ch.length).toBe(2)
  expect(parsed.layers[1].rect).toEqual({ top: 0, left: 0, bottom: 4, right: 4 })
})
