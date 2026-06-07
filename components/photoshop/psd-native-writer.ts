"use client"

import type { HighBitImage } from "./color-pipeline"
import { PSD_COLOR_MODE, type PsdColorModeValue } from "./psd-color-modes"
import type { BlendMode, Layer as _Layer, PsDocument } from "./types"

interface NativeCompositePsdOptions {
  psb?: boolean
  xmpMetadata?: string
  colorModeData?: Uint8Array
}

export interface NativeLayeredPsdLayerInput {
  /** Layer identity preserved through the PSD layer name. */
  name: string
  /** Layer image at document size. Must match writer bit-depth and color mode. */
  image: HighBitImage
  /** Per-layer blend mode (clamped to ag-psd's known table). */
  blendMode?: BlendMode
  /** 0..1 opacity. */
  opacity?: number
  /** Hide flag (Photoshop layer visibility). */
  hidden?: boolean
  /** True when the layer's source image is intrinsically high-bit. */
  hasHighBitSource: boolean
}

interface NativeLayeredPsdOptions extends NativeCompositePsdOptions {
  /** Composite image at document size. */
  composite: HighBitImage
  /** Per-layer pixel data + metadata for the layered Layer&Mask section. */
  layers: NativeLayeredPsdLayerInput[]
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

/** Encode a single channel plane as raw (uncompressed) data with leading u16 compression marker. */
function writeChannelPlaneRaw(
  out: GrowingWriter,
  image: HighBitImage,
  sample: UnitSampler,
  bitDepth: 8 | 16 | 32,
): number {
  const start = out.position
  out.u16(0) // compression = raw
  const pixels = image.width * image.height
  for (let i = 0; i < pixels; i++) {
    const unit = sample(i)
    if (bitDepth === 8) out.u8(Math.max(0, Math.min(255, Math.round(unit * 255))))
    else if (bitDepth === 16) out.u16(Math.max(0, Math.min(65535, Math.round(unit * 65535))))
    else {
      // f32
      const ensureView = new DataView(new ArrayBuffer(4))
      ensureView.setFloat32(0, unit, false)
      out.u8(ensureView.getUint8(0))
      out.u8(ensureView.getUint8(1))
      out.u8(ensureView.getUint8(2))
      out.u8(ensureView.getUint8(3))
    }
  }
  return out.position - start
}

interface PreparedLayer {
  name: string
  blendMode: BlendMode
  opacity: number
  hidden: boolean
  hasHighBitSource: boolean
  channelData: Uint8Array
  /** [channelId, byteLength] pairs to emit in the layer record. */
  channelInfo: Array<{ id: number; length: number }>
}

function layerChannelPlan(colorMode: PsdColorModeValue, image: HighBitImage): Array<{ id: number; sample: UnitSampler }> {
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

function prepareLayer(
  layer: NativeLayeredPsdLayerInput,
  colorMode: PsdColorModeValue,
  bitDepth: 8 | 16 | 32,
): PreparedLayer {
  const out = new GrowingWriter()
  const channelInfo: Array<{ id: number; length: number }> = []
  for (const channel of layerChannelPlan(colorMode, layer.image)) {
    const length = writeChannelPlaneRaw(out, layer.image, channel.sample, bitDepth)
    channelInfo.push({ id: channel.id, length })
  }
  return {
    name: layer.name,
    blendMode: layer.blendMode ?? "normal",
    opacity: layer.opacity ?? 1,
    hidden: !!layer.hidden,
    hasHighBitSource: layer.hasHighBitSource,
    channelData: out.toBytes(),
    channelInfo,
  }
}

/** Sequential write of all layer records with correct length fields. */
function writeLayerInfoSection(
  layers: PreparedLayer[],
  width: number,
  height: number,
  psb: boolean,
  globalAlpha: boolean,
): Uint8Array {
  const out = new GrowingWriter()
  // Signed layer count: negative => global alpha present.
  out.i16(globalAlpha ? -layers.length : layers.length)

  for (const layer of layers) {
    out.i32(0) // top
    out.i32(0) // left
    out.i32(height) // bottom
    out.i32(width) // right
    out.u16(layer.channelInfo.length)
    for (const ch of layer.channelInfo) {
      out.i16(ch.id)
      if (psb) out.u64(ch.length)
      else out.u32(ch.length)
    }
    out.ascii("8BIM")
    out.ascii(blendCode(layer.blendMode))
    out.u8(Math.max(0, Math.min(255, Math.round((layer.opacity ?? 1) * 255))))
    out.u8(0) // clipping = base
    let flags = 0x08 // photoshop 5+ flags meaningful
    if (layer.hidden) flags |= 0x02
    out.u8(flags)
    out.u8(0) // filler
    // Extra data section: length-prefixed (4 bytes), contains
    // layer-mask data (4 zero bytes), blending ranges (4 zero bytes),
    // pascal-padded layer name. We don't emit additional info blocks for
    // the high-bit path — ag-psd's writer rejects 16-bit so any extras
    // are surfaced through the XMP app preservation envelope at the
    // composite level.
    const extraStart = out.reserveOffset()
    const extraBodyStart = out.position
    // Layer mask data: length=0
    out.u32(0)
    // Layer blending ranges: length=0
    out.u32(0)
    // Layer name (Pascal, padded to 4)
    out.pascalPadded(layer.name, 4)
    out.writeReservedLength(extraStart, extraBodyStart)
  }

  // Channel image data, in the same order as the layer records.
  for (const layer of layers) {
    out.bytesRaw(layer.channelData)
  }

  // Layer Info section is the inner bytes returned here; caller wraps in length.
  // Photoshop expects layer info length to be padded to 2-byte boundary.
  if (out.position % 2 === 1) out.u8(0)
  return out.toBytes()
}

/**
 * Write a layered native PSD with per-layer 16-bit pixel data for Grayscale
 * or RGB documents. Supports `psb`. ag-psd's writer hardcodes 8-bit, so this
 * is the fallback path for high-bit layered exports; the resulting file is a
 * valid PSD/PSB Photoshop can open as a layered document.
 *
 * Limitations vs full Photoshop fidelity:
 *  - Layers are emitted as a flat list (groups are dissolved). Section
 *    dividers, masks, and adjustment-info blocks are omitted from each layer
 *    record because ag-psd's high-bit writer path is missing those entirely;
 *    surrounding code preserves them through the XMP `AppPreservation` payload.
 *  - Layer bounds default to full document (no per-layer crop) because the
 *    high-bit upstream image is always at document size.
 *  - Each channel plane is emitted with `compression=0` (raw); RLE/zip
 *    compression isn't yet implemented in this path. File size will be larger
 *    than ag-psd's 8-bit output but Photoshop reads raw planes natively.
 */
export function writeNativeLayeredPsd(
  doc: PsDocument,
  options: NativeLayeredPsdOptions,
): ArrayBuffer {
  if (doc.colorMode === "Bitmap") {
    throw new Error("writeNativeLayeredPsd: Bitmap documents use the composite native writer")
  }
  const bitDepth: 8 | 16 | 32 = doc.bitDepth === 16 ? 16 : doc.bitDepth === 32 ? 32 : 8
  const plan = channelPlan(doc, options.composite)
  const colorModeData = options.colorModeData ?? new Uint8Array()
  const imageResources = buildImageResources(options.xmpMetadata)
  const psb = !!options.psb

  // Prepare per-layer channel data up-front so we know channel-byte lengths
  // before emitting the layer records (PSD layers carry their channel byte
  // lengths in the layer record header).
  const prepared = options.layers.map((layer) =>
    prepareLayer(layer, plan.colorMode, bitDepth),
  )
  const globalAlpha = plan.channels.length === (doc.colorMode === "Grayscale" ? 2 : 4)

  const layerInfo = writeLayerInfoSection(prepared, doc.width, doc.height, psb, globalAlpha)

  // Global Layer Mask Info: length=0 (no global mask).
  const globalLayerMaskInfo = new Uint8Array(psb ? 4 : 4)
  // u32 zero-length section. Same in psd / psb (the outer Layer & Mask
  // section length is what varies between u32/u64).

  // Now write the full PSD with all sections.
  const final = new GrowingWriter()
  final.ascii("8BPS")
  final.u16(psb ? 2 : 1)
  final.pad(6)
  final.u16(plan.channels.length)
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
    // Layer Info subsection
    if (psb) {
      const layerInfoLenOffset = final.reserveOffsetU64()
      const layerInfoStart = final.position
      final.bytesRaw(layerInfo)
      final.writeReservedLengthU64(layerInfoLenOffset, layerInfoStart)
    } else {
      // unreachable in psb branch
    }
    final.bytesRaw(globalLayerMaskInfo)
    final.writeReservedLengthU64(lenOffset, bodyStart)
  } else {
    const lenOffset = final.reserveOffset()
    const bodyStart = final.position
    // Layer Info subsection (psd: u32 length)
    const layerInfoLenOffset = final.reserveOffset()
    const layerInfoStart = final.position
    final.bytesRaw(layerInfo)
    final.writeReservedLength(layerInfoLenOffset, layerInfoStart)
    final.bytesRaw(globalLayerMaskInfo)
    final.writeReservedLength(lenOffset, bodyStart)
  }

  // Composite image data
  // Photoshop's spec requires this section even for layered PSDs. Use raw
  // planes (compression=0). Photoshop reads raw composite planes; some apps
  // prefer RLE here but raw is universally accepted.
  final.u16(0) // compression = raw
  const pixels = options.composite.width * options.composite.height
  for (const sample of plan.channels) {
    for (let i = 0; i < pixels; i++) {
      const unit = sample(i)
      if (bitDepth === 8) final.u8(Math.max(0, Math.min(255, Math.round(unit * 255))))
      else if (bitDepth === 16) final.u16(Math.max(0, Math.min(65535, Math.round(unit * 65535))))
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

