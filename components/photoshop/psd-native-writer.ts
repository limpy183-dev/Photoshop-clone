"use client"

import type { HighBitImage } from "./color-pipeline"
import { PSD_COLOR_MODE, type PsdColorModeValue } from "./psd-color-modes"
import type { PsDocument } from "./types"

interface NativeCompositePsdOptions {
  psb?: boolean
  xmpMetadata?: string
  colorModeData?: Uint8Array
}

type UnitSampler = (pixelIndex: number) => number

interface ChannelPlan {
  colorMode: PsdColorModeValue
  channels: UnitSampler[]
}

class BinaryWriter {
  private offset = 0
  private view: DataView

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  get position() {
    return this.offset
  }

  ascii(value: string) {
    for (let i = 0; i < value.length; i++) this.bytes[this.offset++] = value.charCodeAt(i) & 0xff
  }

  bytesRaw(value: Uint8Array) {
    this.bytes.set(value, this.offset)
    this.offset += value.length
  }

  u16(value: number) {
    this.view.setUint16(this.offset, value, false)
    this.offset += 2
  }

  u32(value: number) {
    this.view.setUint32(this.offset, value >>> 0, false)
    this.offset += 4
  }

  u64(value: number) {
    const high = Math.floor(value / 0x100000000)
    const low = value >>> 0
    this.u32(high)
    this.u32(low)
  }

  f32(value: number) {
    this.view.setFloat32(this.offset, value, false)
    this.offset += 4
  }
}

function sampleUnit(image: HighBitImage, pixelIndex: number, channel: number) {
  const value = image.data[pixelIndex * 4 + channel] ?? (channel === 3 ? 1 : 0)
  if (image.storage === "uint16") return Math.max(0, Math.min(1, Number(value) / 65535))
  if (image.storage === "uint8") return Math.max(0, Math.min(1, Number(value) / 255))
  return Math.max(0, Math.min(1, Number(value)))
}

function hasAlpha(image: HighBitImage) {
  for (let i = 0; i < image.width * image.height; i++) {
    if (sampleUnit(image, i, 3) < 0.999) return true
  }
  return false
}

function rgbToCmyk(r: number, g: number, b: number) {
  const k = 1 - Math.max(r, g, b)
  if (k >= 0.999) return [0, 0, 0, 1]
  return [
    (1 - r - k) / (1 - k),
    (1 - g - k) / (1 - k),
    (1 - b - k) / (1 - k),
    k,
  ]
}

function rgbToLabUnits(r: number, g: number, b: number) {
  const pivotRgb = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  const rr = pivotRgb(r)
  const gg = pivotRgb(g)
  const bb = pivotRgb(b)
  const x = (rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375) / 0.95047
  const y = rr * 0.2126729 + gg * 0.7151522 + bb * 0.072175
  const z = (rr * 0.0193339 + gg * 0.119192 + bb * 0.9503041) / 1.08883
  const pivotXyz = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116)
  const fx = pivotXyz(x)
  const fy = pivotXyz(y)
  const fz = pivotXyz(z)
  const l = Math.max(0, Math.min(100, 116 * fy - 16))
  const a = Math.max(-128, Math.min(127, 500 * (fx - fy)))
  const labB = Math.max(-128, Math.min(127, 200 * (fy - fz)))
  return [l / 100, (a + 128) / 255, (labB + 128) / 255]
}

function channelPlan(doc: PsDocument, image: HighBitImage): ChannelPlan {
  const r = (i: number) => sampleUnit(image, i, 0)
  const g = (i: number) => sampleUnit(image, i, 1)
  const b = (i: number) => sampleUnit(image, i, 2)
  const a = (i: number) => sampleUnit(image, i, 3)
  const gray = (i: number) => r(i) * 0.2126 + g(i) * 0.7152 + b(i) * 0.0722
  const alpha = hasAlpha(image)
  const mode = doc.colorMode as string

  switch (mode) {
    case "Bitmap":
      return { colorMode: PSD_COLOR_MODE.Bitmap, channels: [gray] }
    case "Grayscale":
      return { colorMode: PSD_COLOR_MODE.Grayscale, channels: alpha ? [gray, a] : [gray] }
    case "Indexed":
      return { colorMode: PSD_COLOR_MODE.Indexed, channels: [gray] }
    case "Duotone":
      return { colorMode: PSD_COLOR_MODE.Duotone, channels: [gray] }
    case "CMYK":
      return {
        colorMode: PSD_COLOR_MODE.CMYK,
        channels: [
          (i) => rgbToCmyk(r(i), g(i), b(i))[0],
          (i) => rgbToCmyk(r(i), g(i), b(i))[1],
          (i) => rgbToCmyk(r(i), g(i), b(i))[2],
          (i) => rgbToCmyk(r(i), g(i), b(i))[3],
        ],
      }
    case "Lab":
      return {
        colorMode: PSD_COLOR_MODE.Lab,
        channels: [
          (i) => rgbToLabUnits(r(i), g(i), b(i))[0],
          (i) => rgbToLabUnits(r(i), g(i), b(i))[1],
          (i) => rgbToLabUnits(r(i), g(i), b(i))[2],
        ],
      }
    case "Multichannel":
      return { colorMode: PSD_COLOR_MODE.Multichannel, channels: [r, g, b] }
    case "RGB":
    default:
      return { colorMode: PSD_COLOR_MODE.RGB, channels: alpha ? [r, g, b, a] : [r, g, b] }
  }
}

function buildImageResources(xmpMetadata: string | undefined) {
  if (!xmpMetadata) return new Uint8Array()
  const data = new TextEncoder().encode(xmpMetadata)
  const pad = data.length % 2
  const out = new Uint8Array(4 + 2 + 2 + 4 + data.length + pad)
  const writer = new BinaryWriter(out)
  writer.ascii("8BIM")
  writer.u16(1060)
  writer.bytesRaw(new Uint8Array([0, 0]))
  writer.u32(data.length)
  writer.bytesRaw(data)
  if (pad) writer.bytesRaw(new Uint8Array([0]))
  return out
}

function rawPlaneBytes(width: number, height: number, channels: number, bitDepth: 1 | 8 | 16 | 32) {
  if (bitDepth === 1) return channels * height * Math.ceil(width / 8)
  return channels * width * height * (bitDepth / 8)
}

function writeImageData(writer: BinaryWriter, image: HighBitImage, channels: UnitSampler[], bitDepth: 1 | 8 | 16 | 32) {
  writer.u16(0)
  const pixels = image.width * image.height
  for (const sample of channels) {
    if (bitDepth === 1) {
      for (let y = 0; y < image.height; y++) {
        let current = 0
        let used = 0
        for (let x = 0; x < image.width; x++) {
          current = (current << 1) | (sample(y * image.width + x) >= 0.5 ? 1 : 0)
          used++
          if (used === 8) {
            writer.bytesRaw(new Uint8Array([current]))
            current = 0
            used = 0
          }
        }
        if (used) writer.bytesRaw(new Uint8Array([current << (8 - used)]))
      }
      continue
    }
    for (let i = 0; i < pixels; i++) {
      const unit = sample(i)
      if (bitDepth === 8) writer.bytesRaw(new Uint8Array([Math.max(0, Math.min(255, Math.round(unit * 255)))]))
      else if (bitDepth === 16) writer.u16(Math.max(0, Math.min(65535, Math.round(unit * 65535))))
      else writer.f32(unit)
    }
  }
}

export function writeNativeCompositePsd(
  doc: PsDocument,
  image: HighBitImage,
  options: NativeCompositePsdOptions = {},
): ArrayBuffer {
  const bitDepth: 1 | 8 | 16 | 32 = doc.colorMode === "Bitmap" ? 1 : doc.bitDepth
  const plan = channelPlan(doc, image)
  const colorModeData = options.colorModeData ?? new Uint8Array()
  const imageResources = buildImageResources(options.xmpMetadata)
  const layerMaskLengthSize = options.psb ? 8 : 4
  const imageDataLength = 2 + rawPlaneBytes(image.width, image.height, plan.channels.length, bitDepth)
  const totalLength =
    26 +
    4 + colorModeData.length +
    4 + imageResources.length +
    layerMaskLengthSize +
    imageDataLength
  const bytes = new Uint8Array(totalLength)
  const writer = new BinaryWriter(bytes)

  writer.ascii("8BPS")
  writer.u16(options.psb ? 2 : 1)
  writer.bytesRaw(new Uint8Array(6))
  writer.u16(plan.channels.length)
  writer.u32(image.height)
  writer.u32(image.width)
  writer.u16(bitDepth)
  writer.u16(plan.colorMode)

  writer.u32(colorModeData.length)
  writer.bytesRaw(colorModeData)

  writer.u32(imageResources.length)
  writer.bytesRaw(imageResources)

  if (options.psb) writer.u64(0)
  else writer.u32(0)

  writeImageData(writer, image, plan.channels, bitDepth)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + writer.position)
}
