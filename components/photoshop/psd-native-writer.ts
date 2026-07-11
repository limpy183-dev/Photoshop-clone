"use client"

import type { HighBitImage } from "./color-pipeline"
import { rgbToCmyk as pipelineRgbToCmyk } from "./color-pipeline"
import { PSD_COLOR_MODE, type PsdColorModeValue } from "./psd-color-modes"
import type { BlendMode, PsDocument } from "./types"

interface NativeCompositePsdOptions {
  psb?: boolean
  xmpMetadata?: string
  colorModeData?: Uint8Array
}

export interface NativeLayeredPsdLayerMaskInput {
  /** Mask rectangle in absolute document coordinates. Zero-size rect means "uniform mask" carried by defaultColor. */
  top: number
  left: number
  bottom: number
  right: number
  /** 0 (black) or 255 (white); fills the area outside the stored rect. */
  defaultColor: number
  disabled: boolean
  /** 8-bit luminance plane covering the rect, row-major. Empty for uniform masks. */
  data: Uint8Array
}

export interface NativeLayeredPsdLayerInput {
  /** Layer identity preserved through the PSD layer name. */
  name: string
  /** Layer image at document size. Absent for group folder/divider entries. */
  image?: HighBitImage
  /** Per-layer blend mode (clamped to ag-psd's known table). */
  blendMode?: BlendMode
  /** 0..1 opacity. */
  opacity?: number
  /** Hide flag (Photoshop layer visibility). */
  hidden?: boolean
  /** True when the layer's source image is intrinsically high-bit. */
  hasHighBitSource?: boolean
  /**
   * Group structure marker. "open"/"closed" mark a folder header record,
   * "divider" marks the hidden bounding record below the group's children.
   */
  section?: "open" | "closed" | "divider"
  /** Native raster layer mask (channel id -2). */
  mask?: NativeLayeredPsdLayerMaskInput
  /** Clipping-mask flag (clips to the layer below). */
  clipping?: boolean
  /** Lock-transparency flag (layer record flag bit 0). */
  transparencyProtected?: boolean
}

export interface NativeExtraChannelInput {
  name: string
  kind: "alpha" | "spot"
  /** Display color for the channel overlay (spot ink color for spot channels). */
  color: { r: number; g: number; b: number }
  /** 0..100 solidity/opacity. */
  opacity: number
  /** 8-bit luminance plane at document size, row-major (width*height). */
  data: Uint8Array
}

interface NativeLayeredPsdOptions extends NativeCompositePsdOptions {
  /** Composite image at document size. */
  composite: HighBitImage
  /** Per-layer pixel data + metadata for the layered Layer&Mask section, bottom-most first. */
  layers: NativeLayeredPsdLayerInput[]
  /**
   * Saved alpha / spot channels appended as native extra channels in the
   * composite image data, with 1006/1045 name and 1077 DisplayInfo resources.
   */
  extraChannels?: NativeExtraChannelInput[]
}

type UnitSampler = (pixelIndex: number) => number

interface ChannelPlan {
  colorMode: PsdColorModeValue
  channels: UnitSampler[]
}

interface Region {
  top: number
  left: number
  bottom: number
  right: number
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

  i16(value: number) {
    this.view.setInt16(this.offset, value, false)
    this.offset += 2
  }

  u32(value: number) {
    this.view.setUint32(this.offset, value >>> 0, false)
    this.offset += 4
  }

  i32(value: number) {
    this.view.setInt32(this.offset, value | 0, false)
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

/** Resizable big-endian byte buffer that grows automatically. */
class GrowingWriter {
  private buffer = new Uint8Array(64 * 1024)
  private length = 0

  private ensure(extra: number) {
    if (this.length + extra <= this.buffer.length) return
    let nextSize = this.buffer.length
    while (nextSize < this.length + extra) nextSize *= 2
    const next = new Uint8Array(nextSize)
    next.set(this.buffer.subarray(0, this.length))
    this.buffer = next
  }

  get position() {
    return this.length
  }

  reserveOffset(): number {
    this.ensure(4)
    const offset = this.length
    this.length += 4
    return offset
  }

  reserveOffsetU64(): number {
    this.ensure(8)
    const offset = this.length
    this.length += 8
    return offset
  }

  writeReservedLength(offset: number, valueLengthFrom: number) {
    const length = this.length - valueLengthFrom
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength)
    view.setUint32(offset, length >>> 0, false)
  }

  writeReservedLengthU64(offset: number, valueLengthFrom: number) {
    const length = this.length - valueLengthFrom
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength)
    const high = Math.floor(length / 0x100000000)
    const low = length >>> 0
    view.setUint32(offset, high >>> 0, false)
    view.setUint32(offset + 4, low >>> 0, false)
  }

  ascii(value: string) {
    this.ensure(value.length)
    for (let i = 0; i < value.length; i++) this.buffer[this.length++] = value.charCodeAt(i) & 0xff
  }

  pascalPadded(value: string, padTo: number) {
    const ascii = value.slice(0, 255)
    const len = ascii.length
    const stored = 1 + len
    const padded = Math.ceil(stored / padTo) * padTo
    this.ensure(padded)
    this.buffer[this.length++] = len
    for (let i = 0; i < len; i++) this.buffer[this.length++] = ascii.charCodeAt(i) & 0xff
    for (let i = stored; i < padded; i++) this.buffer[this.length++] = 0
  }

  u8(value: number) {
    this.ensure(1)
    this.buffer[this.length++] = value & 0xff
  }

  u16(value: number) {
    this.ensure(2)
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength)
    view.setUint16(this.length, value & 0xffff, false)
    this.length += 2
  }

  i16(value: number) {
    this.ensure(2)
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength)
    view.setInt16(this.length, value | 0, false)
    this.length += 2
  }

  u32(value: number) {
    this.ensure(4)
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength)
    view.setUint32(this.length, value >>> 0, false)
    this.length += 4
  }

  i32(value: number) {
    this.ensure(4)
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength)
    view.setInt32(this.length, value | 0, false)
    this.length += 4
  }

  u64(value: number) {
    this.ensure(8)
    const high = Math.floor(value / 0x100000000)
    const low = value >>> 0
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength)
    view.setUint32(this.length, high >>> 0, false)
    view.setUint32(this.length + 4, low >>> 0, false)
    this.length += 8
  }

  bytesRaw(value: Uint8Array) {
    this.ensure(value.length)
    this.buffer.set(value, this.length)
    this.length += value.length
  }

  bytesAt(value: Uint8Array, at: number) {
    this.buffer.set(value, at)
  }

  pad(count: number) {
    this.ensure(count)
    for (let i = 0; i < count; i++) this.buffer[this.length++] = 0
  }

  toBytes(): Uint8Array {
    return this.buffer.subarray(0, this.length)
  }
}

function sampleUnit(image: HighBitImage, pixelIndex: number, channel: number) {
  const value = image.data[pixelIndex * 4 + channel] ?? (channel === 3 ? 1 : 0)
  if (image.storage === "uint16") return Math.max(0, Math.min(1, Number(value) / 65535))
  if (image.storage === "uint8") return Math.max(0, Math.min(1, Number(value) / 255))
  return Math.max(0, Math.min(1, Number(value)))
}

/**
 * CMYK separation aligned with the app's plate/separation engine
 * (medium black generation, 320% total ink limit) so native CMYK PSD
 * output matches what the separation preview shows.
 */
function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const cmyk = pipelineRgbToCmyk(
    { r: r * 255, g: g * 255, b: b * 255 },
    { blackGeneration: "medium", totalInkLimit: 320 },
  )
  return [cmyk.c, cmyk.m, cmyk.y, cmyk.k]
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

function hasAlpha(image: HighBitImage) {
  for (let i = 0; i < image.width * image.height; i++) {
    if (sampleUnit(image, i, 3) < 0.999) return true
  }
  return false
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

/** Append one 8BIM image resource block (with even-length padding). */
function writeResourceBlock(out: GrowingWriter, id: number, data: Uint8Array) {
  out.ascii("8BIM")
  out.u16(id)
  out.u16(0) // empty pascal name
  out.u32(data.length)
  out.bytesRaw(data)
  if (data.length % 2) out.u8(0)
}

function buildImageResources(
  xmpMetadata: string | undefined,
  extraChannels: NativeExtraChannelInput[] = [],
) {
  if (!xmpMetadata && !extraChannels.length) return new Uint8Array()
  const out = new GrowingWriter()

  if (extraChannels.length) {
    // 1006: channel names as a series of Pascal strings.
    const names = new GrowingWriter()
    for (const channel of extraChannels) {
      const ascii = channel.name.slice(0, 255)
      names.u8(ascii.length)
      names.ascii(ascii)
    }
    writeResourceBlock(out, 1006, names.toBytes())

    // 1045: unicode channel names (u32 length + UTF-16BE per name).
    const unicode = new GrowingWriter()
    for (const channel of extraChannels) {
      unicode.u32(channel.name.length)
      for (let i = 0; i < channel.name.length; i++) unicode.u16(channel.name.charCodeAt(i))
    }
    writeResourceBlock(out, 1045, unicode.toBytes())

    // 1077: DisplayInfo — version + 13 bytes per channel
    // (colorSpace, 4x u16 color, opacity 0..100, mode).
    const displayInfo = new GrowingWriter()
    displayInfo.u32(1)
    for (const channel of extraChannels) {
      displayInfo.i16(0) // RGB color space
      displayInfo.u16(Math.max(0, Math.min(255, Math.round(channel.color.r))) * 257)
      displayInfo.u16(Math.max(0, Math.min(255, Math.round(channel.color.g))) * 257)
      displayInfo.u16(Math.max(0, Math.min(255, Math.round(channel.color.b))) * 257)
      displayInfo.u16(0)
      displayInfo.u16(Math.max(0, Math.min(100, Math.round(channel.opacity))))
      displayInfo.u8(channel.kind === "spot" ? 2 : 0)
    }
    writeResourceBlock(out, 1077, displayInfo.toBytes())
  }

  if (xmpMetadata) {
    writeResourceBlock(out, 1060, new TextEncoder().encode(xmpMetadata))
  }
  return out.toBytes()
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

/* -------------------------------------------------------------------------- */
/* Layered native PSD writer (high-bit and non-RGB color modes)               */
/* -------------------------------------------------------------------------- */

// ag-psd's blendMode strings as recorded by Photoshop. Mirrored locally so we
// can encode our app's hyphenated names without pulling in ag-psd's reader.
const BLEND_MODE_CODES: Record<string, string> = {
  normal: "norm",
  dissolve: "diss",
  darken: "dark",
  multiply: "mul ",
  "color-burn": "idiv",
  "linear-burn": "lbrn",
  "darker-color": "dkCl",
  lighten: "lite",
  screen: "scrn",
  "color-dodge": "div ",
  "linear-dodge": "lddg",
  "lighter-color": "lgCl",
  overlay: "over",
  "soft-light": "sLit",
  "hard-light": "hLit",
  "vivid-light": "vLit",
  "linear-light": "lLit",
  "pin-light": "pLit",
  "hard-mix": "hMix",
  difference: "diff",
  exclusion: "smud",
  subtract: "fsub",
  divide: "fdiv",
  hue: "hue ",
  saturation: "sat ",
  color: "colr",
  luminosity: "lum ",
}

function blendCode(mode: BlendMode | undefined): string {
  if (!mode) return "norm"
  return BLEND_MODE_CODES[mode] ?? "norm"
}

/* ---------- Channel plane compression ---------- */

/**
 * Deflate (zlib format) via the platform CompressionStream. Returns null
 * when the platform doesn't expose CompressionStream so callers can fall
 * back to raw planes.
 */
async function deflateBytes(bytes: Uint8Array): Promise<Uint8Array | null> {
  const CS = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream
  if (typeof CS !== "function") return null
  try {
    const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new CS("deflate"))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

type RegionSampler = (x: number, y: number) => number

/** PackBits-encode one row into `out`. Matches Photoshop/TIFF RLE. */
function packBitsRow(row: Uint8Array, out: GrowingWriter): number {
  const start = out.position
  const n = row.length
  let i = 0
  while (i < n) {
    let runLength = 1
    while (i + runLength < n && row[i + runLength] === row[i] && runLength < 128) runLength++
    if (runLength >= 2) {
      out.u8(257 - runLength)
      out.u8(row[i])
      i += runLength
    } else {
      let j = i + 1
      while (j < n && j - i < 128) {
        // Stop the literal when a run of 3+ starts (worth switching to a repeat).
        if (j + 2 < n && row[j] === row[j + 1] && row[j] === row[j + 2]) break
        j++
      }
      out.u8(j - i - 1)
      for (let k = i; k < j; k++) out.u8(row[k])
      i = j
    }
  }
  return out.position - start
}

/** Channel plane, RLE compressed (compression = 1) for 8-bit data. */
function planeBytesRle8(sample: RegionSampler, region: Region, large: boolean): Uint8Array {
  const width = region.right - region.left
  const height = region.bottom - region.top
  const out = new GrowingWriter()
  out.u16(1) // compression = RLE
  // Row byte-count table placeholder: u16 per row (u32 in PSB files).
  const tableStart = out.position
  out.pad(height * (large ? 4 : 2))
  const row = new Uint8Array(Math.max(1, width))
  const lengths = new Uint32Array(height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const unit = sample(region.left + x, region.top + y)
      row[x] = Math.max(0, Math.min(255, Math.round(unit * 255)))
    }
    lengths[y] = packBitsRow(row.subarray(0, width), out)
  }
  const bytes = out.toBytes()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let y = 0; y < height; y++) {
    if (large) view.setUint32(tableStart + y * 4, lengths[y], false)
    else view.setUint16(tableStart + y * 2, Math.min(0xffff, lengths[y]), false)
  }
  return bytes
}

/** Channel plane, raw (compression = 0), at any bit depth. */
function planeBytesRaw(sample: RegionSampler, region: Region, bitDepth: 8 | 16 | 32): Uint8Array {
  const width = region.right - region.left
  const height = region.bottom - region.top
  const out = new GrowingWriter()
  out.u16(0)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const unit = sample(region.left + x, region.top + y)
      if (bitDepth === 8) out.u8(Math.max(0, Math.min(255, Math.round(unit * 255))))
      else if (bitDepth === 16) out.u16(Math.max(0, Math.min(65535, Math.round(unit * 65535))))
      else {
        const view = new DataView(new ArrayBuffer(4))
        view.setFloat32(0, unit, false)
        out.u8(view.getUint8(0))
        out.u8(view.getUint8(1))
        out.u8(view.getUint8(2))
        out.u8(view.getUint8(3))
      }
    }
  }
  return out.toBytes()
}

/**
 * 16-bit plane with Photoshop's zip prediction: per row, the first sample is
 * absolute and each following sample is a left-neighbor delta (mod 2^16),
 * stored big-endian.
 */
function predicted16(sample: RegionSampler, region: Region): Uint8Array {
  const width = region.right - region.left
  const height = region.bottom - region.top
  const out = new Uint8Array(width * height * 2)
  const row = new Uint16Array(Math.max(1, width))
  let o = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const unit = sample(region.left + x, region.top + y)
      row[x] = Math.max(0, Math.min(65535, Math.round(unit * 65535)))
    }
    for (let x = width - 1; x >= 1; x--) row[x] = (row[x] - row[x - 1] + 0x10000) & 0xffff
    for (let x = 0; x < width; x++) {
      out[o++] = row[x] >> 8
      out[o++] = row[x] & 0xff
    }
  }
  return out
}

/**
 * 32-bit float plane with Photoshop's zip prediction: per row the big-endian
 * float bytes are planarized (all byte 0s, then byte 1s, ...) and then
 * delta-encoded across the whole (width*4)-byte row.
 */
function predicted32(sample: RegionSampler, region: Region): Uint8Array {
  const width = region.right - region.left
  const height = region.bottom - region.top
  const out = new Uint8Array(width * height * 4)
  const rowBytes = new Uint8Array(Math.max(4, width * 4))
  const view = new DataView(new ArrayBuffer(4))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      view.setFloat32(0, sample(region.left + x, region.top + y), false)
      rowBytes[x] = view.getUint8(0)
      rowBytes[width + x] = view.getUint8(1)
      rowBytes[width * 2 + x] = view.getUint8(2)
      rowBytes[width * 3 + x] = view.getUint8(3)
    }
    for (let i = width * 4 - 1; i >= 1; i--) rowBytes[i] = (rowBytes[i] - rowBytes[i - 1]) & 0xff
    out.set(rowBytes.subarray(0, width * 4), y * width * 4)
  }
  return out
}

/** Channel plane, zip-with-prediction (compression = 3), for 16/32-bit data. */
async function planeBytesZipPredicted(
  sample: RegionSampler,
  region: Region,
  bitDepth: 16 | 32,
): Promise<Uint8Array | null> {
  const predicted = bitDepth === 16 ? predicted16(sample, region) : predicted32(sample, region)
  const deflated = await deflateBytes(predicted)
  if (!deflated) return null
  const out = new Uint8Array(2 + deflated.length)
  const view = new DataView(out.buffer)
  view.setUint16(0, 3, false)
  out.set(deflated, 2)
  return out
}

/** Empty channel plane: raw compression marker with no pixel payload. */
function planeBytesEmpty(): Uint8Array {
  return new Uint8Array([0, 0])
}

/** Encode one channel plane using the best compression for the bit depth. */
async function encodePlane(
  sample: RegionSampler,
  region: Region,
  bitDepth: 8 | 16 | 32,
  large: boolean,
): Promise<Uint8Array> {
  const width = region.right - region.left
  const height = region.bottom - region.top
  if (width <= 0 || height <= 0) return planeBytesEmpty()
  if (bitDepth === 8) return planeBytesRle8(sample, region, large)
  const zipped = await planeBytesZipPredicted(sample, region, bitDepth)
  return zipped ?? planeBytesRaw(sample, region, bitDepth)
}

/* ---------- Layer preparation ---------- */

interface PreparedChannel {
  id: number
  bytes: Uint8Array
}

interface PreparedMask {
  rect: Region
  defaultColor: number
  disabled: boolean
}

interface PreparedLayer {
  name: string
  blendMode: BlendMode
  opacity: number
  hidden: boolean
  clipping: boolean
  transparencyProtected: boolean
  section?: "open" | "closed" | "divider"
  rect: Region
  mask?: PreparedMask
  channels: PreparedChannel[]
}

interface LayerChannelSpec {
  id: number
  sample: UnitSampler
}

function layerChannelPlan(colorMode: PsdColorModeValue, image: HighBitImage): LayerChannelSpec[] {
  const r = (i: number) => sampleUnit(image, i, 0)
  const g = (i: number) => sampleUnit(image, i, 1)
  const b = (i: number) => sampleUnit(image, i, 2)
  const a = (i: number) => sampleUnit(image, i, 3)
  const gray = (i: number) => r(i) * 0.2126 + g(i) * 0.7152 + b(i) * 0.0722

  switch (colorMode) {
    case PSD_COLOR_MODE.CMYK:
      return [
        { id: 0, sample: (i) => rgbToCmyk(r(i), g(i), b(i))[0] },
        { id: 1, sample: (i) => rgbToCmyk(r(i), g(i), b(i))[1] },
        { id: 2, sample: (i) => rgbToCmyk(r(i), g(i), b(i))[2] },
        { id: 3, sample: (i) => rgbToCmyk(r(i), g(i), b(i))[3] },
        { id: -1, sample: a },
      ]
    case PSD_COLOR_MODE.Lab:
      return [
        { id: 0, sample: (i) => rgbToLabUnits(r(i), g(i), b(i))[0] },
        { id: 1, sample: (i) => rgbToLabUnits(r(i), g(i), b(i))[1] },
        { id: 2, sample: (i) => rgbToLabUnits(r(i), g(i), b(i))[2] },
        { id: -1, sample: a },
      ]
    case PSD_COLOR_MODE.Multichannel:
      return [
        { id: 0, sample: r },
        { id: 1, sample: g },
        { id: 2, sample: b },
        { id: -1, sample: a },
      ]
    case PSD_COLOR_MODE.Grayscale:
    case PSD_COLOR_MODE.Indexed:
    case PSD_COLOR_MODE.Duotone:
      return [
        { id: 0, sample: gray },
        { id: -1, sample: a },
      ]
    case PSD_COLOR_MODE.RGB:
    default:
      return [
        { id: 0, sample: r },
        { id: 1, sample: g },
        { id: 2, sample: b },
        { id: -1, sample: a },
      ]
  }
}

/** Channel id list for section (folder/divider) records with no pixels. */
function sectionChannelIds(colorMode: PsdColorModeValue): number[] {
  switch (colorMode) {
    case PSD_COLOR_MODE.CMYK:
      return [0, 1, 2, 3, -1]
    case PSD_COLOR_MODE.Lab:
    case PSD_COLOR_MODE.Multichannel:
      return [0, 1, 2, -1]
    case PSD_COLOR_MODE.Grayscale:
    case PSD_COLOR_MODE.Indexed:
    case PSD_COLOR_MODE.Duotone:
      return [0, -1]
    case PSD_COLOR_MODE.RGB:
    default:
      return [0, 1, 2, -1]
  }
}

const EMPTY_RECT: Region = { top: 0, left: 0, bottom: 0, right: 0 }

/**
 * Tightest bounding box of pixels with non-zero alpha. Returns null when the
 * layer is fully transparent (the layer record then carries an empty rect).
 */
function computeAlphaBounds(image: HighBitImage): Region | null {
  const w = image.width
  const h = image.height
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (sampleUnit(image, y * w + x, 3) > 0.001) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { top: minY, left: minX, bottom: maxY + 1, right: maxX + 1 }
}

function emptySectionChannels(colorMode: PsdColorModeValue): PreparedChannel[] {
  return sectionChannelIds(colorMode).map((id) => ({ id, bytes: planeBytesEmpty() }))
}

async function prepareMask(
  mask: NativeLayeredPsdLayerMaskInput,
  bitDepth: 8 | 16 | 32,
  large: boolean,
): Promise<{ prepared: PreparedMask; channel: PreparedChannel }> {
  const rect: Region = { top: mask.top, left: mask.left, bottom: mask.bottom, right: mask.right }
  const width = rect.right - rect.left
  const height = rect.bottom - rect.top
  const prepared: PreparedMask = { rect, defaultColor: mask.defaultColor, disabled: mask.disabled }
  if (width <= 0 || height <= 0 || mask.data.length < width * height) {
    return { prepared: { ...prepared, rect: EMPTY_RECT }, channel: { id: -2, bytes: planeBytesEmpty() } }
  }
  // The mask plane is stored in mask-rect-local coordinates.
  const sample: RegionSampler = (x, y) => (mask.data[(y - rect.top) * width + (x - rect.left)] ?? 0) / 255
  const bytes = await encodePlane(sample, rect, bitDepth, large)
  return { prepared, channel: { id: -2, bytes } }
}

async function prepareLayer(
  layer: NativeLayeredPsdLayerInput,
  colorMode: PsdColorModeValue,
  bitDepth: 8 | 16 | 32,
  large: boolean,
): Promise<PreparedLayer> {
  const base: Omit<PreparedLayer, "rect" | "channels"> = {
    name: layer.name,
    blendMode: layer.blendMode ?? "normal",
    opacity: layer.opacity ?? 1,
    hidden: !!layer.hidden,
    clipping: !!layer.clipping,
    transparencyProtected: !!layer.transparencyProtected,
    section: layer.section,
  }

  const channels: PreparedChannel[] = []
  let rect: Region = EMPTY_RECT
  let mask: PreparedMask | undefined

  if (layer.section || !layer.image) {
    channels.push(...emptySectionChannels(colorMode))
  } else {
    const image = layer.image
    const bounds = computeAlphaBounds(image)
    if (!bounds) {
      channels.push(...emptySectionChannels(colorMode))
    } else {
      rect = bounds
      const width = image.width
      for (const spec of layerChannelPlan(colorMode, image)) {
        const sample: RegionSampler = (x, y) => spec.sample(y * width + x)
        const bytes = await encodePlane(sample, rect, bitDepth, large)
        channels.push({ id: spec.id, bytes })
      }
    }
  }

  if (layer.mask) {
    const result = await prepareMask(layer.mask, bitDepth, large)
    mask = result.prepared
    channels.push(result.channel)
  }

  return { ...base, rect, mask, channels }
}

/* ---------- Layer record serialization ---------- */

function writeUnicodeNameBlock(out: GrowingWriter, name: string) {
  out.ascii("8BIM")
  out.ascii("luni")
  out.u32(4 + name.length * 2)
  out.u32(name.length)
  for (let i = 0; i < name.length; i++) out.u16(name.charCodeAt(i))
}

function writeSectionBlock(out: GrowingWriter, section: "open" | "closed" | "divider", blendMode: BlendMode) {
  out.ascii("8BIM")
  out.ascii("lsct")
  if (section === "divider") {
    out.u32(4)
    out.u32(3)
    return
  }
  out.u32(12)
  out.u32(section === "open" ? 1 : 2)
  out.ascii("8BIM")
  out.ascii(blendCode(blendMode))
}

/** Sequential write of all layer records with correct length fields. */
function writeLayerInfoSection(
  layers: PreparedLayer[],
  psb: boolean,
  globalAlpha: boolean,
): Uint8Array {
  const out = new GrowingWriter()
  // Signed layer count: negative => global alpha present.
  out.i16(globalAlpha ? -layers.length : layers.length)

  for (const layer of layers) {
    out.i32(layer.rect.top)
    out.i32(layer.rect.left)
    out.i32(layer.rect.bottom)
    out.i32(layer.rect.right)
    out.u16(layer.channels.length)
    for (const ch of layer.channels) {
      out.i16(ch.id)
      if (psb) out.u64(ch.bytes.length)
      else out.u32(ch.bytes.length)
    }
    out.ascii("8BIM")
    out.ascii(blendCode(layer.blendMode))
    out.u8(Math.max(0, Math.min(255, Math.round((layer.opacity ?? 1) * 255))))
    out.u8(layer.clipping ? 1 : 0)
    let flags = 0x08 // photoshop 5+ flags meaningful
    if (layer.transparencyProtected) flags |= 0x01
    if (layer.hidden) flags |= 0x02
    out.u8(flags)
    out.u8(0) // filler
    // Extra data section: length-prefixed (4 bytes) — mask record,
    // blending ranges, pascal-padded name, then additional info blocks
    // (unicode name, group section markers).
    const extraStart = out.reserveOffset()
    const extraBodyStart = out.position
    if (layer.mask) {
      out.u32(20)
      out.i32(layer.mask.rect.top)
      out.i32(layer.mask.rect.left)
      out.i32(layer.mask.rect.bottom)
      out.i32(layer.mask.rect.right)
      out.u8(Math.max(0, Math.min(255, layer.mask.defaultColor)))
      out.u8(layer.mask.disabled ? 0x02 : 0x00)
      out.u16(0) // padding
    } else {
      out.u32(0)
    }
    // Layer blending ranges: length=0
    out.u32(0)
    // Layer name (Pascal, padded to 4)
    out.pascalPadded(layer.name, 4)
    // Unicode layer name (Photoshop prefers this over the Pascal name).
    writeUnicodeNameBlock(out, layer.name)
    // Group structure marker.
    if (layer.section) writeSectionBlock(out, layer.section, layer.blendMode)
    out.writeReservedLength(extraStart, extraBodyStart)
  }

  // Channel image data, in the same order as the layer records.
  for (const layer of layers) {
    for (const ch of layer.channels) out.bytesRaw(ch.bytes)
  }

  // Layer Info section is the inner bytes returned here; caller wraps in length.
  // Photoshop expects layer info length to be padded to 2-byte boundary.
  if (out.position % 2 === 1) out.u8(0)
  return out.toBytes()
}

/**
 * Write a layered native PSD/PSB for high-bit (16/32) and non-RGB color
 * modes. ag-psd's writer hardcodes 8-bit RGB, so this path keeps layers
 * editable in Photoshop instead of collapsing to a single composite.
 *
 * Native features covered by this writer:
 *  - Per-layer trimmed bounds (channels store only the alpha bounding box).
 *  - Group hierarchy via `lsct` section divider records.
 *  - Raster layer masks (channel id -2 with mask rect + default color).
 *  - Unicode layer names (`luni`) alongside Pascal names.
 *  - Compression: PackBits RLE for 8-bit planes, ZIP-with-prediction for
 *    16/32-bit planes (raw fallback when CompressionStream is unavailable).
 *  - CMYK separation matching the app's plate engine (medium GCR, 320% TIL).
 *
 * Remaining limitations vs full Photoshop fidelity:
 *  - Adjustment/text/vector metadata is not embedded in this path; the
 *    surrounding code preserves it through the XMP `AppPreservation` payload.
 *  - Blending ranges default to none.
 */
export async function writeNativeLayeredPsd(
  doc: PsDocument,
  options: NativeLayeredPsdOptions,
): Promise<ArrayBuffer> {
  if (doc.colorMode === "Bitmap") {
    throw new Error("writeNativeLayeredPsd: Bitmap documents use the composite native writer")
  }
  const bitDepth: 8 | 16 | 32 = doc.bitDepth === 16 ? 16 : doc.bitDepth === 32 ? 32 : 8
  const plan = channelPlan(doc, options.composite)
  const colorModeData = options.colorModeData ?? new Uint8Array()
  const pixelCount = options.composite.width * options.composite.height
  const extraChannels = (options.extraChannels ?? []).filter(
    (channel) => channel.data.length >= pixelCount,
  )
  const imageResources = buildImageResources(options.xmpMetadata, extraChannels)
  const psb = !!options.psb

  // Prepare per-layer channel data up-front so we know channel-byte lengths
  // before emitting the layer records (PSD layers carry their channel byte
  // lengths in the layer record header).
  const prepared: PreparedLayer[] = []
  for (const layer of options.layers) {
    prepared.push(await prepareLayer(layer, plan.colorMode, bitDepth, psb))
  }
  const globalAlpha = plan.channels.length === (doc.colorMode === "Grayscale" ? 2 : 4)

  const layerInfo = writeLayerInfoSection(prepared, psb, globalAlpha)

  // Global Layer Mask Info: length=0 (no global mask).
  const globalLayerMaskInfo = new Uint8Array(4)

  // Now write the full PSD with all sections.
  // Saved alpha / spot channels ride as extra composite planes; readers use
  // the 1006/1045/1077 resources to name and colorize them.
  const extraSamplers: UnitSampler[] = extraChannels.map(
    (channel) => (i: number) => (channel.data[i] ?? 0) / 255,
  )
  const compositeChannels = [...plan.channels, ...extraSamplers]

  const final = new GrowingWriter()
  final.ascii("8BPS")
  final.u16(psb ? 2 : 1)
  final.pad(6)
  final.u16(compositeChannels.length)
  final.u32(doc.height)
  final.u32(doc.width)
  final.u16(bitDepth)
  final.u16(plan.colorMode)

  // Color mode data section
  final.u32(colorModeData.length)
  if (colorModeData.length) final.bytesRaw(colorModeData)

  // Image resources section
  final.u32(imageResources.length)
  if (imageResources.length) final.bytesRaw(imageResources)

  // Layer and Mask Info section (length is u32 for PSD, u64 for PSB)
  if (psb) {
    const lenOffset = final.reserveOffsetU64()
    const bodyStart = final.position
    const layerInfoLenOffset = final.reserveOffsetU64()
    const layerInfoStart = final.position
    final.bytesRaw(layerInfo)
    final.writeReservedLengthU64(layerInfoLenOffset, layerInfoStart)
    final.bytesRaw(globalLayerMaskInfo)
    final.writeReservedLengthU64(lenOffset, bodyStart)
  } else {
    const lenOffset = final.reserveOffset()
    const bodyStart = final.position
    const layerInfoLenOffset = final.reserveOffset()
    const layerInfoStart = final.position
    final.bytesRaw(layerInfo)
    final.writeReservedLength(layerInfoLenOffset, layerInfoStart)
    final.bytesRaw(globalLayerMaskInfo)
    final.writeReservedLength(lenOffset, bodyStart)
  }

  // Composite image data.
  // Photoshop's spec requires this section even for layered PSDs. 8-bit
  // documents use RLE (compression=1, shared row table across channels);
  // high-bit documents use raw planes which Photoshop reads natively.
  if (bitDepth === 8) {
    final.u16(1)
    const width = options.composite.width
    const height = options.composite.height
    const tableStart = final.position
    final.pad(compositeChannels.length * height * (psb ? 4 : 2))
    const row = new Uint8Array(Math.max(1, width))
    const lengths = new Uint32Array(compositeChannels.length * height)
    let rowIndex = 0
    for (const sample of compositeChannels) {
      for (let y = 0; y < height; y++, rowIndex++) {
        for (let x = 0; x < width; x++) {
          row[x] = Math.max(0, Math.min(255, Math.round(sample(y * width + x) * 255)))
        }
        lengths[rowIndex] = packBitsRow(row.subarray(0, width), final)
      }
    }
    const bytes = final.toBytes()
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let i = 0; i < lengths.length; i++) {
      if (psb) view.setUint32(tableStart + i * 4, lengths[i], false)
      else view.setUint16(tableStart + i * 2, Math.min(0xffff, lengths[i]), false)
    }
  } else {
    final.u16(0) // compression = raw
    const pixels = options.composite.width * options.composite.height
    for (const sample of compositeChannels) {
      for (let i = 0; i < pixels; i++) {
        const unit = sample(i)
        if (bitDepth === 16) final.u16(Math.max(0, Math.min(65535, Math.round(unit * 65535))))
        else {
          const view = new DataView(new ArrayBuffer(4))
          view.setFloat32(0, unit, false)
          final.u8(view.getUint8(0))
          final.u8(view.getUint8(1))
          final.u8(view.getUint8(2))
          final.u8(view.getUint8(3))
        }
      }
    }
  }

  const bytes = final.toBytes()
  const buffer = new ArrayBuffer(bytes.length)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

/**
 * Returns true if the native writer should handle layered output for `doc`.
 * RGB/8-bit stays on ag-psd because it can already emit rich native layer
 * metadata. Non-RGB and high-bit documents use this writer so layers remain
 * editable instead of collapsing to a single native composite.
 */
export function canWriteNativeLayeredPsd(doc: PsDocument): boolean {
  if (doc.colorMode === "Bitmap") return false
  if (doc.colorMode === "RGB" && doc.bitDepth === 8) return false
  return doc.bitDepth === 16 || doc.bitDepth === 32 || doc.colorMode !== "RGB"
}
