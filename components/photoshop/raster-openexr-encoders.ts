import { assertCanvasSize } from "./canvas-limits"
import type { HighBitImage } from "./color-pipeline"
import { concatUint8, exactArrayBuffer, highBitSampleUnit } from "./raster-codec-utils"
import type { OpenExrArbitraryEncodeOptions, OpenExrEncodeOptions } from "./raster-codec-types"

function float32ToFloat16Bits(value: number) {
  if (!Number.isFinite(value)) return value < 0 ? 0xfc00 : 0x7c00
  const floatView = new Float32Array(1)
  const intView = new Uint32Array(floatView.buffer)
  floatView[0] = value
  const bits = intView[0]
  const sign = (bits >>> 16) & 0x8000
  const exponent = ((bits >>> 23) & 0xff) - 127 + 15
  const mantissa = bits & 0x7fffff
  if (exponent <= 0) {
    if (exponent < -10) return sign
    return sign | ((mantissa | 0x800000) >>> (1 - exponent + 13))
  }
  if (exponent >= 31) return sign | 0x7c00
  return sign | (exponent << 10) | (mantissa >>> 13)
}

function encodeOpenExrRaster(
  width: number,
  height: number,
  options: OpenExrEncodeOptions,
  sampleAt: (channelName: string, x: number, y: number, channelIndex: number) => number,
): ArrayBuffer {
  assertCanvasSize(width, height, "OpenEXR export")
  const channelNames = options.channels === "gray"
    ? ["Y"]
    : options.channels === "rgb"
      ? ["R", "G", "B"]
      : ["R", "G", "B", "A"]
  const pixelType = options.pixelType === "half" ? 1 : 2
  const sampleBytes = pixelType === 1 ? 2 : 4
  const header: number[] = []
  const pushU8 = (value: number) => header.push(value & 255)
  const pushU32 = (value: number) => {
    header.push(value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255)
  }
  const pushCString = (value: string) => {
    for (let i = 0; i < value.length; i++) pushU8(value.charCodeAt(i))
    pushU8(0)
  }
  const pushAttr = (name: string, type: string, value: number[]) => {
    pushCString(name)
    pushCString(type)
    pushU32(value.length)
    header.push(...value)
  }
  const bytesFor = (write: (push: (value: number) => void) => void) => {
    const out: number[] = []
    write((value) => out.push(value & 255))
    return out
  }
  const u32Bytes = (value: number) => bytesFor((push) => {
    push(value)
    push(value >> 8)
    push(value >> 16)
    push(value >> 24)
  })
  const f32Bytes = (value: number) => {
    const data = new Uint8Array(4)
    new DataView(data.buffer).setFloat32(0, value, true)
    return Array.from(data)
  }
  const channelList: number[] = []
  const channelPush = (value: number) => channelList.push(value & 255)
  const channelCString = (value: string) => {
    for (let i = 0; i < value.length; i++) channelPush(value.charCodeAt(i))
    channelPush(0)
  }
  for (const channel of channelNames) {
    channelCString(channel)
    channelList.push(...u32Bytes(pixelType), 0, 0, 0, 0, ...u32Bytes(1), ...u32Bytes(1))
  }
  channelList.push(0)
  pushU32(0x01312f76)
  pushU32(2)
  pushAttr("channels", "chlist", channelList)
  pushAttr("compression", "compression", [0])
  pushAttr("dataWindow", "box2i", [...u32Bytes(0), ...u32Bytes(0), ...u32Bytes(width - 1), ...u32Bytes(height - 1)])
  pushAttr("displayWindow", "box2i", [...u32Bytes(0), ...u32Bytes(0), ...u32Bytes(width - 1), ...u32Bytes(height - 1)])
  pushAttr("lineOrder", "lineOrder", [0])
  pushAttr("pixelAspectRatio", "float", f32Bytes(1))
  pushAttr("screenWindowCenter", "v2f", [...f32Bytes(0), ...f32Bytes(0)])
  pushAttr("screenWindowWidth", "float", f32Bytes(1))
  pushU8(0)

  const scanlineBytes = width * channelNames.length * sampleBytes
  const chunkBytes = 8 + scanlineBytes
  const totalBytes = header.length + height * 8 + height * chunkBytes
  const out = new Uint8Array(totalBytes)
  out.set(header, 0)
  const view = new DataView(out.buffer)
  let chunkOffset = header.length + height * 8
  for (let y = 0; y < height; y++) {
    view.setBigUint64(header.length + y * 8, BigInt(chunkOffset), true)
    chunkOffset += chunkBytes
  }
  let cursor = header.length + height * 8
  for (let y = 0; y < height; y++) {
    view.setInt32(cursor, y, true)
    view.setUint32(cursor + 4, scanlineBytes, true)
    cursor += 8
    for (let channel = 0; channel < channelNames.length; channel++) {
      for (let x = 0; x < width; x++) {
        const sample = Math.max(0, Math.min(1, sampleAt(channelNames[channel], x, y, channel)))
        if (pixelType === 1) {
          view.setUint16(cursor, float32ToFloat16Bits(sample), true)
          cursor += 2
        } else {
          view.setFloat32(cursor, sample, true)
          cursor += 4
        }
      }
    }
  }
  return out.buffer
}

export function encodeOpenExrImageData(imageData: ImageData, options: OpenExrEncodeOptions = {}): ArrayBuffer {
  return encodeOpenExrRaster(imageData.width, imageData.height, options, (channelName, x, y, channelIndex) => {
    const source = (y * imageData.width + x) * 4
    if (channelName === "Y") {
      return (0.299 * imageData.data[source] + 0.587 * imageData.data[source + 1] + 0.114 * imageData.data[source + 2]) / 255
    }
    return imageData.data[source + (channelName === "A" ? 3 : channelIndex)] / 255
  })
}

export function encodeOpenExrHighBitImage(image: HighBitImage, options: OpenExrEncodeOptions = {}): ArrayBuffer {
  return encodeOpenExrRaster(image.width, image.height, options, (channelName, x, y, channelIndex) => {
    const source = (y * image.width + x) * 4
    if (channelName === "Y") {
      return (
        0.299 * highBitSampleUnit(image, source) +
        0.587 * highBitSampleUnit(image, source + 1) +
        0.114 * highBitSampleUnit(image, source + 2)
      )
    }
    return highBitSampleUnit(image, source + (channelName === "A" ? 3 : channelIndex))
  })
}

function exrStringBytes(value: string): number[] {
  return Array.from(new TextEncoder().encode(value))
}

export function encodeOpenExrArbitraryChannels(options: OpenExrArbitraryEncodeOptions): ArrayBuffer {
  const width = Math.max(1, Math.round(options.width))
  const height = Math.max(1, Math.round(options.height))
  assertCanvasSize(width, height, "OpenEXR arbitrary-channel export")
  const channels = options.channels.length ? options.channels : [{ name: "Y", data: new Float32Array(width * height), pixelType: "float" as const }]
  const header: number[] = []
  const pushU8 = (value: number) => header.push(value & 255)
  const pushU32 = (value: number) => header.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255)
  const pushCString = (value: string) => {
    for (let i = 0; i < value.length; i++) pushU8(value.charCodeAt(i))
    pushU8(0)
  }
  const bytesFor = (write: (push: (value: number) => void) => void) => {
    const out: number[] = []
    write((value) => out.push(value & 255))
    return out
  }
  const u32Bytes = (value: number) => bytesFor((push) => {
    push(value)
    push(value >>> 8)
    push(value >>> 16)
    push(value >>> 24)
  })
  const f32Bytes = (value: number) => {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setFloat32(0, value, true)
    return Array.from(bytes)
  }
  const pushAttr = (name: string, type: string, data: number[]) => {
    pushCString(name)
    pushCString(type)
    pushU32(data.length)
    header.push(...data)
  }
  const channelList: number[] = []
  const channelPush = (value: number) => channelList.push(value & 255)
  const channelCString = (value: string) => {
    for (let i = 0; i < value.length; i++) channelPush(value.charCodeAt(i))
    channelPush(0)
  }
  for (const channel of channels) {
    channelCString(channel.name)
    const type = channel.pixelType === "half" ? 1 : channel.pixelType === "uint" ? 0 : 2
    channelList.push(...u32Bytes(type), 0, 0, 0, 0, ...u32Bytes(1), ...u32Bytes(1))
  }
  channelList.push(0)
  pushU32(0x01312f76)
  pushU32(options.tiled ? 0x00000202 : 2)
  pushAttr("channels", "chlist", channelList)
  pushAttr("compression", "compression", [0])
  pushAttr("dataWindow", "box2i", [...u32Bytes(0), ...u32Bytes(0), ...u32Bytes(width - 1), ...u32Bytes(height - 1)])
  pushAttr("displayWindow", "box2i", [...u32Bytes(0), ...u32Bytes(0), ...u32Bytes(width - 1), ...u32Bytes(height - 1)])
  pushAttr("lineOrder", "lineOrder", [0])
  pushAttr("pixelAspectRatio", "float", f32Bytes(1))
  pushAttr("screenWindowCenter", "v2f", [...f32Bytes(0), ...f32Bytes(0)])
  pushAttr("screenWindowWidth", "float", f32Bytes(1))
  if (options.partName) pushAttr("name", "string", exrStringBytes(options.partName))
  if (options.tiled) {
    pushAttr("type", "string", exrStringBytes("tiledimage"))
    pushAttr("tiles", "tiledesc", [
      ...u32Bytes(Math.max(1, Math.round(options.tiled.tileWidth))),
      ...u32Bytes(Math.max(1, Math.round(options.tiled.tileHeight))),
      options.tiled.levelMode === "mipmap" ? 1 : options.tiled.levelMode === "ripmap" ? 2 : 0,
      0,
    ])
  }
  if (options.deep) {
    pushAttr("deep-sample-counts", "string", exrStringBytes(Array.from(options.deep.sampleCounts).join(",")))
  }
  pushU8(0)

  const sampleBytes = channels.length * width * 4
  const chunkBytes = 8 + sampleBytes
  const totalBytes = header.length + height * 8 + height * chunkBytes
  const out = new Uint8Array(totalBytes)
  out.set(header, 0)
  const view = new DataView(out.buffer)
  let chunkOffset = header.length + height * 8
  for (let y = 0; y < height; y++) {
    view.setBigUint64(header.length + y * 8, BigInt(chunkOffset), true)
    chunkOffset += chunkBytes
  }
  let cursor = header.length + height * 8
  for (let y = 0; y < height; y++) {
    view.setInt32(cursor, y, true)
    view.setUint32(cursor + 4, sampleBytes, true)
    cursor += 8
    for (const channel of channels) {
      for (let x = 0; x < width; x++) {
        const value = Number(channel.data[y * width + x] ?? 0)
        view.setFloat32(cursor, Number.isFinite(value) ? value : 0, true)
        cursor += 4
      }
    }
  }
  return out.buffer
}

export function encodeOpenExrMultipart(parts: Array<{ name: string; buffer: ArrayBuffer }>): ArrayBuffer {
  const manifest = new TextEncoder().encode(`PSWEB-EXR-MULTIPART\n${JSON.stringify(parts.map((part) => ({ name: part.name, bytes: part.buffer.byteLength })))}\n`)
  return exactArrayBuffer(concatUint8([manifest, ...parts.map((part) => new Uint8Array(part.buffer))]))
}

