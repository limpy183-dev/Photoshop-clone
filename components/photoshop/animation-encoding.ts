"use client"

/**
 * Animated GIF / APNG / animated WebP encoders.
 *
 * These run entirely in the browser without external dependencies. PNG/APNG
 * uses CompressionStream for DEFLATE, WebP wraps the browser's static WebP
 * encoder into an extended VP8X container with ANMF chunks.
 */

import type { PsDocument, TimelineFrame, TimelineSettings } from "./types"
import { easingProgress, renderTimelineFrameComposite, DEFAULT_TIMELINE_SETTINGS } from "./timeline-engine"

export interface AnimatedExportFrame {
  durationMs: number
  canvas: HTMLCanvasElement
  sourceFrameId?: string
  timeMs?: number
  sampleIndex?: number
}

export interface AnimatedExportOptions {
  transparent?: boolean
  matte?: string
  /** Scale applied to the document dimensions per frame. Defaults to 1. */
  scale?: number
  /** Loop count. 0 = infinite. */
  loopCount?: number
  /** Quality (0..1) for WebP frames. */
  quality?: number
  /** Timeline sampling rate for frame animation export. Defaults to document timeline FPS. */
  fps?: number
}

/* -------------------------------- helpers -------------------------------- */

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function concatUint8(arrays: Uint8Array[]): Uint8Array {
  let total = 0
  for (const a of arrays) total += a.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)))
  }
  return btoa(binary)
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`
}

async function deflateZlib(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === "function") {
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"))
    const buffer = await new Response(stream).arrayBuffer()
    return new Uint8Array(buffer)
  }
  return zlibStore(data)
}

/** Fallback: produce a valid zlib stream with stored (uncompressed) DEFLATE blocks. */
function zlibStore(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = []
  const maxBlock = 0xffff
  let offset = 0
  do {
    const end = Math.min(offset + maxBlock, data.length)
    const len = end - offset
    const nlen = 0xffff - len
    const block = new Uint8Array(5 + len)
    block[0] = end === data.length ? 1 : 0
    block[1] = len & 0xff
    block[2] = (len >> 8) & 0xff
    block[3] = nlen & 0xff
    block[4] = (nlen >> 8) & 0xff
    block.set(data.subarray(offset, end), 5)
    blocks.push(block)
    offset = end
  } while (offset < data.length)
  const compressed = concatUint8(blocks)
  const a32 = adler32(data)
  const header = new Uint8Array([0x78, 0x01])
  const footer = new Uint8Array([(a32 >>> 24) & 0xff, (a32 >>> 16) & 0xff, (a32 >>> 8) & 0xff, a32 & 0xff])
  return concatUint8([header, compressed, footer])
}

function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  const MOD = 65521
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % MOD
    b = (b + a) % MOD
  }
  return ((b << 16) | a) >>> 0
}

/* CRC-32 used by PNG */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function u32BE(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff])
}

function u16BE(value: number): Uint8Array {
  return new Uint8Array([(value >>> 8) & 0xff, value & 0xff])
}

function u16LE(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff])
}

function u32LE(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff])
}

function u24LE(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff])
}

function imageDataFromCanvas(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("2D context unavailable")
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

function ensureSize(canvas: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  if (canvas.width === width && canvas.height === height) return canvas
  const out = document.createElement("canvas")
  out.width = width
  out.height = height
  const ctx = out.getContext("2d")!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(canvas, 0, 0, width, height)
  return out
}

/* --------------------------- Frame collection --------------------------- */

export function collectAnimationFrames(
  doc: PsDocument,
  options: AnimatedExportOptions = {},
): AnimatedExportFrame[] {
  const scale = options.scale ?? 1
  const transparent = options.transparent ?? true
  const matte = options.matte ?? doc.background ?? "#ffffff"
  const frames = doc.timelineFrames ?? []
  if (!frames.length) {
    const canvas = renderTimelineFrameComposite(
      doc,
      {
        id: "_default",
        name: "frame",
        durationMs: 1000,
        layerVisibility: Object.fromEntries(doc.layers.map((l) => [l.id, l.visible])),
        layerOpacity: Object.fromEntries(doc.layers.map((l) => [l.id, l.opacity])),
      },
      { transparent, matte },
    )
    const target = ensureSize(canvas, Math.max(1, Math.round(doc.width * scale)), Math.max(1, Math.round(doc.height * scale)))
    return [{ durationMs: 1000, canvas: target }]
  }
  return frames.map((frame) => {
    const composite = renderTimelineFrameComposite(doc, frame, { transparent, matte })
    const target = ensureSize(
      composite,
      Math.max(1, Math.round(doc.width * scale)),
      Math.max(1, Math.round(doc.height * scale)),
    )
    return { durationMs: Math.max(20, frame.durationMs), canvas: target }
  })
}

function drawTimelineTransitionSample(
  from: HTMLCanvasElement,
  to: HTMLCanvasElement | null,
  transition: TimelineFrame["transition"],
  progress: number,
  matte: string,
): HTMLCanvasElement {
  if (!transition || transition === "hold" || !to) return from
  const out = document.createElement("canvas")
  out.width = from.width
  out.height = from.height
  const ctx = out.getContext("2d")
  if (!ctx) return from
  ctx.clearRect(0, 0, out.width, out.height)
  const t = clamp(progress, 0, 1)

  if (transition === "fade-black" || transition === "fade-white") {
    ctx.drawImage(from, 0, 0)
    ctx.save()
    ctx.globalAlpha = t
    ctx.fillStyle = transition === "fade-white" ? "#ffffff" : "#000000"
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.restore()
    return out
  }
  if (transition === "wipe-left" || transition === "wipe-right") {
    ctx.drawImage(from, 0, 0)
    const w = out.width * t
    const x = transition === "wipe-right" ? 0 : out.width - w
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, 0, w, out.height)
    ctx.clip()
    ctx.drawImage(to, 0, 0)
    ctx.restore()
    return out
  }

  ctx.save()
  ctx.globalAlpha = 1 - t
  ctx.drawImage(from, 0, 0)
  ctx.restore()
  ctx.save()
  ctx.globalAlpha = t
  ctx.drawImage(to, 0, 0)
  ctx.restore()
  ctx.save()
  ctx.globalCompositeOperation = "destination-over"
  ctx.fillStyle = matte
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.restore()
  return out
}

export function collectAnimationFramesAtFps(
  doc: PsDocument,
  options: AnimatedExportOptions = {},
): AnimatedExportFrame[] {
  const transparent = options.transparent ?? true
  const matte = options.matte ?? doc.background ?? "#ffffff"
  const scale = options.scale ?? 1
  const frames = doc.timelineFrames ?? []
  const fps = Math.max(1, Math.round(options.fps ?? doc.timelineSettings?.fps ?? DEFAULT_TIMELINE_SETTINGS.fps))
  const frameDuration = Math.max(1, Math.round(1000 / fps))
  if (!frames.length) {
    const canvas = renderTimelineFrameComposite(
      doc,
      {
        id: "_default",
        name: "frame",
        durationMs: frameDuration,
        layerVisibility: Object.fromEntries(doc.layers.map((l) => [l.id, l.visible])),
        layerOpacity: Object.fromEntries(doc.layers.map((l) => [l.id, l.opacity])),
      },
      { transparent, matte },
    )
    const target = ensureSize(canvas, Math.max(1, Math.round(doc.width * scale)), Math.max(1, Math.round(doc.height * scale)))
    return [{ durationMs: frameDuration, canvas: target, sourceFrameId: "_default", timeMs: 0, sampleIndex: 0 }]
  }

  const rendered = frames.map((frame) => renderTimelineFrameComposite(doc, frame, { transparent, matte }))
  const out: AnimatedExportFrame[] = []
  let timeMs = 0
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
    const frame = frames[frameIndex]
    const sampleCount = Math.max(1, Math.round(frame.durationMs / frameDuration))
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
      const linear = sampleCount <= 1 ? 0 : sampleIndex / (sampleCount - 1)
      const progress = frame.transition && frame.transition !== "hold"
        ? easingProgress(linear, frame.easing ?? "linear")
        : 0
      const transitioned = drawTimelineTransitionSample(
        rendered[frameIndex],
        rendered[frameIndex + 1] ?? null,
        frame.transition,
        progress,
        matte,
      )
      const target = ensureSize(
        transitioned,
        Math.max(1, Math.round(doc.width * scale)),
        Math.max(1, Math.round(doc.height * scale)),
      )
      out.push({
        durationMs: frameDuration,
        canvas: target,
        sourceFrameId: frame.id,
        timeMs,
        sampleIndex,
      })
      timeMs += frameDuration
    }
  }
  return out
}

export function resolveTimelineSettings(doc: PsDocument): TimelineSettings {
  return { ...DEFAULT_TIMELINE_SETTINGS, ...(doc.timelineSettings ?? {}) }
}

/* ------------------------------- GIF encoder ----------------------------- */

/**
 * Build a 6-bit (RGB-332-ish) palette index from RGBA. Bit 0 of `transparent`
 * reserves palette index 0 for fully-transparent pixels.
 */
function quantize332(image: ImageData, transparent: boolean): { indexes: Uint8Array; palette: Uint8Array; transparentIndex: number } {
  const indexes = new Uint8Array(image.width * image.height)
  for (let p = 0, i = 0; p < indexes.length; p++, i += 4) {
    if (transparent && image.data[i + 3] < 128) {
      indexes[p] = 0
      continue
    }
    let index = ((image.data[i] >> 5) << 5) | ((image.data[i + 1] >> 5) << 2) | (image.data[i + 2] >> 6)
    if (transparent && index === 0) index = 1
    indexes[p] = index
  }
  const palette = new Uint8Array(256 * 3)
  for (let i = 0; i < 256; i++) {
    if (i === 0 && transparent) {
      palette[i * 3 + 0] = 0
      palette[i * 3 + 1] = 0
      palette[i * 3 + 2] = 0
    } else {
      palette[i * 3 + 0] = Math.round((((i >> 5) & 7) / 7) * 255)
      palette[i * 3 + 1] = Math.round((((i >> 2) & 7) / 7) * 255)
      palette[i * 3 + 2] = Math.round(((i & 3) / 3) * 255)
    }
  }
  return { indexes, palette, transparentIndex: transparent ? 0 : -1 }
}

function gifLzw(indexes: Uint8Array): Uint8Array {
  const minCodeSize = 8
  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1
  let codeSize = minCodeSize + 1
  let nextCode = endCode + 1
  let bitBuffer = 0
  let bitCount = 0
  const bytes: number[] = []

  const emit = (code: number) => {
    bitBuffer |= code << bitCount
    bitCount += codeSize
    while (bitCount >= 8) {
      bytes.push(bitBuffer & 0xff)
      bitBuffer >>= 8
      bitCount -= 8
    }
  }

  emit(clearCode)
  let prev: number | null = null
  for (let i = 0; i < indexes.length; i++) {
    const value = indexes[i]
    emit(value)
    if (prev !== null) {
      nextCode++
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize++
      if (nextCode >= 4095) {
        emit(clearCode)
        codeSize = minCodeSize + 1
        nextCode = endCode + 1
        prev = null
        continue
      }
    }
    prev = value
  }
  emit(endCode)
  if (bitCount > 0) bytes.push(bitBuffer & 0xff)
  return new Uint8Array(bytes)
}

function gifSubBlocks(data: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < data.length; offset += 255) {
    const length = Math.min(255, data.length - offset)
    const block = new Uint8Array(length + 1)
    block[0] = length
    block.set(data.subarray(offset, offset + length), 1)
    chunks.push(block)
  }
  chunks.push(new Uint8Array([0]))
  return concatUint8(chunks)
}

export function encodeAnimatedGif(frames: AnimatedExportFrame[], options: AnimatedExportOptions = {}): Uint8Array {
  if (!frames.length) throw new Error("No frames to encode")
  const transparent = options.transparent ?? true
  const loopCount = options.loopCount ?? 0
  const width = frames[0].canvas.width
  const height = frames[0].canvas.height
  const parts: Uint8Array[] = []
  parts.push(asciiBytes("GIF89a"))
  parts.push(u16LE(width))
  parts.push(u16LE(height))
  // global color table flag 1, 8-bit color resolution, sort flag 0, GCT size 7 (=256)
  parts.push(new Uint8Array([0xf7, 0, 0]))
  // global palette built per first frame for consistency
  const firstImage = imageDataFromCanvas(frames[0].canvas)
  const firstQuantized = quantize332(firstImage, transparent)
  parts.push(firstQuantized.palette)
  // NETSCAPE2.0 application extension for looping
  parts.push(new Uint8Array([0x21, 0xff, 11]))
  parts.push(asciiBytes("NETSCAPE2.0"))
  parts.push(new Uint8Array([3, 1]))
  parts.push(u16LE(loopCount))
  parts.push(new Uint8Array([0]))

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    const sized = ensureSize(frame.canvas, width, height)
    const image = imageDataFromCanvas(sized)
    const quantized = quantize332(image, transparent)
    // Graphics control extension
    const delayCs = Math.max(2, Math.round(frame.durationMs / 10))
    const transparentFlag = transparent ? 0x01 : 0x00
    const disposal = 2 // restore to background
    const packed = (disposal << 2) | transparentFlag
    parts.push(new Uint8Array([0x21, 0xf9, 0x04, packed]))
    parts.push(u16LE(delayCs))
    parts.push(new Uint8Array([transparent ? quantized.transparentIndex : 0, 0]))
    // image descriptor
    parts.push(new Uint8Array([0x2c]))
    parts.push(u16LE(0)) // left
    parts.push(u16LE(0)) // top
    parts.push(u16LE(width))
    parts.push(u16LE(height))
    parts.push(new Uint8Array([0])) // no local color table
    // LZW minimum code size
    parts.push(new Uint8Array([8]))
    parts.push(gifSubBlocks(gifLzw(quantized.indexes)))
  }
  parts.push(new Uint8Array([0x3b]))
  return concatUint8(parts)
}

/* ------------------------------ APNG encoder ----------------------------- */

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = asciiBytes(type)
  const length = u32BE(data.length)
  const crcInput = concatUint8([typeBytes, data])
  const crc = u32BE(crc32(crcInput))
  return concatUint8([length, typeBytes, data, crc])
}

function rgbaScanlines(image: ImageData): Uint8Array {
  const width = image.width
  const height = image.height
  const stride = width * 4
  const out = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    out[y * (stride + 1)] = 0
    out.set(image.data.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1)
  }
  return out
}

export async function encodeApngFromFrames(
  frames: AnimatedExportFrame[],
  options: AnimatedExportOptions = {},
): Promise<Uint8Array> {
  if (!frames.length) throw new Error("No frames to encode")
  const loopCount = options.loopCount ?? 0
  const width = frames[0].canvas.width
  const height = frames[0].canvas.height
  const parts: Uint8Array[] = [PNG_SIGNATURE]

  // IHDR
  const ihdr = new Uint8Array(13)
  ihdr.set(u32BE(width), 0)
  ihdr.set(u32BE(height), 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  parts.push(pngChunk("IHDR", ihdr))

  // acTL: num_frames (4), num_plays (4)
  const actl = new Uint8Array(8)
  actl.set(u32BE(frames.length), 0)
  actl.set(u32BE(loopCount), 4)
  parts.push(pngChunk("acTL", actl))

  let sequence = 0
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    const sized = ensureSize(frame.canvas, width, height)
    const image = imageDataFromCanvas(sized)
    const compressed = await deflateZlib(rgbaScanlines(image))
    const delayNumerator = Math.max(1, Math.round(frame.durationMs))
    const delayDenominator = 1000
    const fctl = new Uint8Array(26)
    fctl.set(u32BE(sequence++), 0)
    fctl.set(u32BE(width), 4)
    fctl.set(u32BE(height), 8)
    fctl.set(u32BE(0), 12) // x offset
    fctl.set(u32BE(0), 16) // y offset
    fctl.set(u16BE(delayNumerator), 20)
    fctl.set(u16BE(delayDenominator), 22)
    fctl[24] = 1 // dispose: background
    fctl[25] = 0 // blend: source
    parts.push(pngChunk("fcTL", fctl))
    if (i === 0) {
      parts.push(pngChunk("IDAT", compressed))
    } else {
      const fdat = concatUint8([u32BE(sequence++), compressed])
      parts.push(pngChunk("fdAT", fdat))
    }
  }
  parts.push(pngChunk("IEND", new Uint8Array(0)))
  return concatUint8(parts)
}

/* --------------------------- Animated WebP encoder ----------------------- */

async function canvasToWebPBytes(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result)
        else reject(new Error("WebP encoding failed"))
      },
      "image/webp",
      quality,
    )
  })
  return new Uint8Array(await blob.arrayBuffer())
}

interface ParsedWebP {
  width: number
  height: number
  hasAlpha: boolean
  alphaChunk: Uint8Array | null
  bitstream: Uint8Array
  bitstreamType: "VP8 " | "VP8L"
}

function readChunkHeader(data: Uint8Array, offset: number) {
  const fourcc = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])
  const size = data[offset + 4] | (data[offset + 5] << 8) | (data[offset + 6] << 16) | (data[offset + 7] << 24)
  return { fourcc, size }
}

function parseStaticWebP(bytes: Uint8Array): ParsedWebP {
  if (bytes.length < 12) throw new Error("WebP bytes too short")
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
  if (riff !== "RIFF" || webp !== "WEBP") throw new Error("Not a WebP")
  let offset = 12
  let width = 0
  let height = 0
  let hasAlpha = false
  let alphaChunk: Uint8Array | null = null
  let bitstream: Uint8Array | null = null
  let bitstreamType: "VP8 " | "VP8L" | null = null
  while (offset + 8 <= bytes.length) {
    const { fourcc, size } = readChunkHeader(bytes, offset)
    const dataStart = offset + 8
    const dataEnd = dataStart + size
    if (dataEnd > bytes.length) break
    if (fourcc === "VP8X") {
      // already extended — read dims from VP8X
      width = 1 + (bytes[dataStart + 4] | (bytes[dataStart + 5] << 8) | (bytes[dataStart + 6] << 16))
      height = 1 + (bytes[dataStart + 7] | (bytes[dataStart + 8] << 8) | (bytes[dataStart + 9] << 16))
      hasAlpha = (bytes[dataStart] & 0x10) !== 0
    } else if (fourcc === "ALPH") {
      hasAlpha = true
      alphaChunk = bytes.subarray(dataStart, dataEnd)
    } else if (fourcc === "VP8 ") {
      bitstream = bytes.subarray(dataStart, dataEnd)
      bitstreamType = "VP8 "
      if (!width) {
        // parse VP8 width/height from bitstream
        const tag0 = bitstream[0]
        const tag1 = bitstream[1]
        const tag2 = bitstream[2]
        const frameTag = tag0 | (tag1 << 8) | (tag2 << 16)
        const keyframe = (frameTag & 1) === 0
        if (keyframe) {
          // skip start code 9d 01 2a (3 bytes at offset 3..5)
          const w = bitstream[6] | (bitstream[7] << 8)
          const h = bitstream[8] | (bitstream[9] << 8)
          width = w & 0x3fff
          height = h & 0x3fff
        }
      }
    } else if (fourcc === "VP8L") {
      bitstream = bytes.subarray(dataStart, dataEnd)
      bitstreamType = "VP8L"
      const b1 = bitstream[1]
      const b2 = bitstream[2]
      const b3 = bitstream[3]
      const b4 = bitstream[4]
      width = 1 + (((b2 & 0x3f) << 8) | b1)
      height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6))
      hasAlpha = (b4 & 0x10) !== 0
    }
    offset = dataEnd + (size & 1)
  }
  if (!bitstream || !bitstreamType) throw new Error("WebP missing bitstream")
  if (!width || !height) throw new Error("WebP missing dimensions")
  return { width, height, hasAlpha, alphaChunk, bitstream, bitstreamType }
}

function makeChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const padding = data.length & 1 ? 1 : 0
  const header = new Uint8Array(8)
  header.set(asciiBytes(fourcc), 0)
  header.set(u32LE(data.length), 4)
  const padded = padding ? new Uint8Array(data.length + 1) : data
  if (padding) padded.set(data, 0)
  return concatUint8([header, padded])
}

export async function encodeAnimatedWebP(
  frames: AnimatedExportFrame[],
  options: AnimatedExportOptions = {},
): Promise<Uint8Array> {
  if (!frames.length) throw new Error("No frames to encode")
  const quality = clamp(options.quality ?? 0.9, 0, 1)
  const loopCount = options.loopCount ?? 0
  const transparent = options.transparent ?? true
  const width = frames[0].canvas.width
  const height = frames[0].canvas.height

  const parsedFrames: ParsedWebP[] = []
  for (const frame of frames) {
    const sized = ensureSize(frame.canvas, width, height)
    const bytes = await canvasToWebPBytes(sized, quality)
    parsedFrames.push(parseStaticWebP(bytes))
  }
  const anyAlpha = transparent && parsedFrames.some((f) => f.hasAlpha)

  // VP8X chunk: flags (1) + reserved (3) + width-1 (3) + height-1 (3)
  const vp8x = new Uint8Array(10)
  let flags = 0
  // bit 1 = animation
  flags |= 0x02
  if (anyAlpha) flags |= 0x10
  vp8x[0] = flags
  vp8x.set(u24LE(width - 1), 4)
  vp8x.set(u24LE(height - 1), 7)

  // ANIM chunk: background (4) + loop count (2)
  const anim = new Uint8Array(6)
  anim[0] = 0
  anim[1] = 0
  anim[2] = 0
  anim[3] = 0
  anim.set(u16LE(loopCount), 4)

  const parts: Uint8Array[] = []
  parts.push(makeChunk("VP8X", vp8x))
  parts.push(makeChunk("ANIM", anim))

  for (let i = 0; i < parsedFrames.length; i++) {
    const parsed = parsedFrames[i]
    const duration = clamp(Math.round(frames[i].durationMs), 1, 0xffffff)
    // ANMF body: frame X (3) + Y (3) + width-1 (3) + height-1 (3) + duration (3) + flags (1) + frame data
    const subParts: Uint8Array[] = []
    subParts.push(u24LE(0))
    subParts.push(u24LE(0))
    subParts.push(u24LE(width - 1))
    subParts.push(u24LE(height - 1))
    subParts.push(u24LE(duration))
    const blending = 0x00 // use alpha blending
    const disposal = 0x01 // dispose to background
    subParts.push(new Uint8Array([blending | disposal]))
    if (parsed.alphaChunk) subParts.push(makeChunk("ALPH", parsed.alphaChunk))
    subParts.push(makeChunk(parsed.bitstreamType, parsed.bitstream))
    parts.push(makeChunk("ANMF", concatUint8(subParts)))
  }

  const body = concatUint8(parts)
  const riff = concatUint8([asciiBytes("RIFF"), u32LE(body.length + 4), asciiBytes("WEBP"), body])
  return riff
}

/* ----------------------------- Convenience ------------------------------- */

export async function exportTimelineAsGifBytes(doc: PsDocument, options: AnimatedExportOptions = {}): Promise<Uint8Array> {
  const settings = resolveTimelineSettings(doc)
  const frames = collectAnimationFramesAtFps(doc, { ...options, fps: options.fps ?? settings.fps })
  return encodeAnimatedGif(frames, { ...options, loopCount: options.loopCount ?? settings.loopCount })
}

export async function exportTimelineAsApngBytes(doc: PsDocument, options: AnimatedExportOptions = {}): Promise<Uint8Array> {
  const settings = resolveTimelineSettings(doc)
  const frames = collectAnimationFramesAtFps(doc, { ...options, fps: options.fps ?? settings.fps })
  return encodeApngFromFrames(frames, { ...options, loopCount: options.loopCount ?? settings.loopCount })
}

export async function exportTimelineAsWebPBytes(doc: PsDocument, options: AnimatedExportOptions = {}): Promise<Uint8Array> {
  const settings = resolveTimelineSettings(doc)
  const frames = collectAnimationFramesAtFps(doc, { ...options, fps: options.fps ?? settings.fps })
  return encodeAnimatedWebP(frames, { ...options, loopCount: options.loopCount ?? settings.loopCount })
}

export async function exportTimelineFrameAsPngBlob(frame: TimelineFrame, doc: PsDocument): Promise<Blob> {
  const canvas = renderTimelineFrameComposite(doc, frame, { transparent: true })
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encode failed"))), "image/png")
  })
}
