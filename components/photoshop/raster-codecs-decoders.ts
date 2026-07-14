import { assertCanvasSize } from "./canvas-limits"
import { sniffRasterDimensions } from "./document-import-sniffers"
import { imageDataFromRgba, readAscii } from "./raster-codec-utils"
import { clamp8, scaleSample, TGA_DEVELOPER_PREFIX, TGA_DEVELOPER_TAG_METADATA, TGA_SIGNATURE } from "./raster-codecs-internal"
import { readExrChannelInfo, readExrDataWindow } from "./raster-codecs-exr-inspect"
import { decodeJpeg2000Buffer } from "./raster-codecs-jpeg2000"
import type { DecodedRaster } from "./raster-codecs-types"

type LibRawDecodeSettings = Record<string, unknown>

interface LibRawDecoderInstance {
  open(data: Uint8Array, settings?: LibRawDecodeSettings): unknown
  metadata(full?: boolean): Record<string, unknown>
  imageData(): Record<string, unknown>
  delete?: () => void
}

interface LibRawRuntimeModule {
  LibRaw: new () => LibRawDecoderInstance
}

const EXR_FLOAT_TYPE = 1015 as const
const TIFF_EXTENSIONS = new Set(["tif", "tiff"])
const TIFF_COMPATIBLE_EXTENSIONS = new Set(["tif", "tiff", "dng"])
const PNM_EXTENSIONS = new Set(["ppm", "pgm", "pbm", "pnm"])
const TGA_EXTENSIONS = new Set(["tga", "vda", "icb", "vst"])
const HEIF_EXTENSIONS = new Set(["heif", "heic", "hif"])
const HEIF_BRANDS = new Set(["heic", "heif", "heix", "hevc", "hevx", "mif1", "msf1"])
const JPEG2000_EXTENSIONS = new Set(["jp2", "j2k", "jpf", "jpx", "jpm"])
const RAW_EXTENSIONS = new Set(["raw", "dng", "cr2", "nef", "arw"])

interface AdvancedRasterSignature {
  isTiff: boolean
  isTiffCompatible: boolean
  isPnm: boolean
  isTga: boolean
  isExr: boolean
  isHeif: boolean
  isJpeg2000: boolean
  isRaw: boolean
}

function extensionForName(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? ""
}

function bufferHead(buffer: ArrayBuffer, length: number) {
  return new Uint8Array(buffer, 0, Math.min(length, buffer.byteLength))
}

function hasTiffHeader(head: Uint8Array) {
  return (
    (head[0] === 0x49 && head[1] === 0x49 && head[2] === 42 && head[3] === 0) ||
    (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0 && head[3] === 42)
  )
}

function hasPnmHeader(head: Uint8Array) {
  return head[0] === 0x50 && head[1] >= 0x31 && head[1] <= 0x36
}

function hasExrHeader(head: Uint8Array) {
  return head[0] === 0x76 && head[1] === 0x2f && head[2] === 0x31 && head[3] === 0x01
}

function hasHeifBrand(buffer: ArrayBuffer, head: Uint8Array) {
  return head.length >= 12 && readAscii(buffer, 4, 4) === "ftyp" && HEIF_BRANDS.has(readAscii(buffer, 8, 4))
}

function hasJpeg2000Signature(head: Uint8Array) {
  return (
    (head[0] === 0xff && head[1] === 0x4f) ||
    (head.length >= 12 && head[4] === 0x6a && head[5] === 0x50 && head[6] === 0x20 && head[7] === 0x20)
  )
}

function sniffAdvancedRaster(buffer: ArrayBuffer, name = "", mime = ""): AdvancedRasterSignature {
  const ext = extensionForName(name)
  const head = bufferHead(buffer, 32)
  const isTiff = hasTiffHeader(head) || TIFF_EXTENSIONS.has(ext)
  const isPnm = PNM_EXTENSIONS.has(ext) || hasPnmHeader(head)
  const isHeif = mime === "image/heic" || mime === "image/heif" || HEIF_EXTENSIONS.has(ext) || hasHeifBrand(buffer, head)
  return {
    isTiff,
    isTiffCompatible: isTiff || TIFF_COMPATIBLE_EXTENSIONS.has(ext),
    isPnm,
    isTga: TGA_EXTENSIONS.has(ext),
    isExr: ext === "exr" || hasExrHeader(head),
    isHeif,
    isJpeg2000: JPEG2000_EXTENSIONS.has(ext) || hasJpeg2000Signature(head),
    isRaw: RAW_EXTENSIONS.has(ext),
  }
}

function decodeSyncAdvancedRaster(buffer: ArrayBuffer, signature: AdvancedRasterSignature): DecodedRaster | null {
  if (signature.isTiff) return decodeTiffBuffer(buffer)
  if (signature.isPnm) return decodePnmBuffer(buffer)
  if (signature.isTga) return decodeTgaBuffer(buffer)
  return null
}

export function decodeAdvancedRasterBuffer(buffer: ArrayBuffer, name = ""): DecodedRaster | null {
  return decodeSyncAdvancedRaster(buffer, sniffAdvancedRaster(buffer, name))
}

export async function decodeAdvancedRasterBufferAsync(buffer: ArrayBuffer, name = "", mime = ""): Promise<DecodedRaster | null> {
  const signature = sniffAdvancedRaster(buffer, name, mime)

  if (signature.isExr) return decodeExrBuffer(buffer)
  if (signature.isHeif) return decodeHeifBuffer(buffer)
  if (signature.isJpeg2000) return decodeJpeg2000Buffer(buffer)
  if (signature.isRaw) {
    const raw = await decodeRawBuffer(buffer)
    if (raw) return raw
  }
  if (signature.isTiffCompatible) {
    const tiff = await decodeTiffWithUtif(buffer)
    if (tiff) return tiff
    const fallback = await decodeTiffBufferAsyncFallback(buffer).catch(() => null)
    if (fallback) return fallback
  }
  return decodeSyncAdvancedRaster(buffer, signature)
}

let libRawRuntimeReady: Promise<LibRawRuntimeModule> | null = null
const LIBRAW_RUNTIME_URL = "/vendor/libraw-wasm/libraw.js"

type LibRawRuntimeFactory = (options?: Record<string, unknown>) => Promise<LibRawRuntimeModule>

async function loadLibRawRuntime(): Promise<LibRawRuntimeModule> {
  libRawRuntimeReady ??= import(/* webpackIgnore: true */ LIBRAW_RUNTIME_URL).then(async (module) => {
    const createLibRawRuntime = (module as { default: LibRawRuntimeFactory }).default
    return createLibRawRuntime({
      print: () => undefined,
      printErr: () => undefined,
    })
  })
  return libRawRuntimeReady
}

function normalizeLibRawMetadata(metadata: Record<string, unknown>) {
  if (Object.prototype.hasOwnProperty.call(metadata, "thumb_format")) {
    const formats = ["unknown", "jpeg", "bitmap", "bitmap16", "layer", "rollei", "h265"]
    metadata.thumb_format = formats[Number(metadata.thumb_format)] ?? "unknown"
  }
  if (Object.prototype.hasOwnProperty.call(metadata, "desc")) metadata.desc = String(metadata.desc).trim()
  if (Object.prototype.hasOwnProperty.call(metadata, "timestamp")) metadata.timestamp = new Date(Number(metadata.timestamp))
  return metadata
}

async function decodeTiffWithUtif(buffer: ArrayBuffer): Promise<DecodedRaster | null> {
  try {
    const UTIF = await import("utif2")
    const ifds = UTIF.decode(buffer)
    const ifd = ifds.find((item) => Number(item.width || 0) > 0 && Number(item.height || 0) > 0) ?? ifds[0]
    if (!ifd) return null
    // Preflight the IFD dimension tags so a tiny file declaring huge
    // dimensions cannot trigger a multi-gigabyte decode allocation.
    const tagWidth = Number(ifd.width || (Array.isArray(ifd.t256) ? ifd.t256[0] : ifd.t256) || 0)
    const tagHeight = Number(ifd.height || (Array.isArray(ifd.t257) ? ifd.t257[0] : ifd.t257) || 0)
    if (tagWidth > 0 && tagHeight > 0) assertCanvasSize(tagWidth, tagHeight, "TIFF image")
    UTIF.decodeImage(buffer, ifd)
    const width = Number(ifd.width || 0)
    const height = Number(ifd.height || 0)
    if (!width || !height) return null
    assertCanvasSize(width, height, "TIFF image")
    const rgba = UTIF.toRGBA8(ifd)
    const bitsTag = Array.isArray(ifd.t258) ? ifd.t258 : [8]
    const samples = Array.isArray(ifd.t277) ? Number(ifd.t277[0] ?? 4) : 4
    const compression = Array.isArray(ifd.t259) ? Number(ifd.t259[0] ?? 1) : 1
    const photometric = Array.isArray(ifd.t262) ? Number(ifd.t262[0] ?? 2) : 2
    return {
      format: "TIFF",
      width,
      height,
      bitDepth: Math.max(...bitsTag.map(Number).filter(Number.isFinite), 8),
      channels: samples || 4,
      colorModel: photometric === 1 || photometric === 0 ? "Grayscale" : "RGBA",
      compression: compression === 1 ? "none" : `tiff-${compression}`,
      imageData: imageDataFromRgba(width, height, new Uint8ClampedArray(rgba)),
      warnings: compression === 1 ? [] : [`TIFF compression tag ${compression} decoded through UTIF2 into an editable preview.`],
      metadata: {
        decoder: "UTIF2",
        compression,
        photometric,
      },
    }
  } catch {
    return null
  }
}

async function decodeExrBuffer(buffer: ArrayBuffer): Promise<DecodedRaster | null> {
  try {
    const { default: parseExr } = await import("parse-exr")
    const channelInfo = readExrChannelInfo(buffer)
    // Preflight the header dataWindow so parseExr cannot allocate
    // multi-gigabyte float buffers from a tiny crafted file.
    const dataWindow = readExrDataWindow(buffer)
    if (dataWindow && dataWindow.width > 0 && dataWindow.height > 0) assertCanvasSize(dataWindow.width, dataWindow.height, "OpenEXR image")
    const exr = parseExr(buffer, EXR_FLOAT_TYPE)
    assertCanvasSize(exr.width, exr.height, "OpenEXR image")
    const rgba = new Uint8ClampedArray(exr.width * exr.height * 4)
    const data = exr.data as Float32Array | Uint16Array
    const decodedStride = Math.max(1, Math.round(data.length / Math.max(1, exr.width * exr.height)))
    const sourceChannelCount = channelInfo?.names.length && ["Y", "R,G,B", "R,G,B,A"].includes(channelInfo.names.join(","))
      ? channelInfo.names.length
      : exr.format === 1023
        ? (channelInfo?.names.includes("A") ? 4 : Math.min(decodedStride, 3))
        : 1
    for (let i = 0; i < exr.width * exr.height; i++) {
      const source = i * decodedStride
      const target = i * 4
      if (sourceChannelCount === 1) {
        const gray = linearPreviewSample(Number(data[source] ?? 0))
        rgba[target] = gray
        rgba[target + 1] = gray
        rgba[target + 2] = gray
        rgba[target + 3] = 255
      } else {
        rgba[target] = linearPreviewSample(Number(data[source] ?? 0))
        rgba[target + 1] = linearPreviewSample(Number(data[source + 1] ?? 0))
        rgba[target + 2] = linearPreviewSample(Number(data[source + 2] ?? 0))
        rgba[target + 3] = sourceChannelCount >= 4 ? clamp8(Number(data[source + 3] ?? 1) * 255) : 255
      }
    }
    const bitDepth = channelInfo?.bitDepth ?? 32
    const sourceChannels = channelInfo?.names.join(",") ?? (sourceChannelCount === 1 ? "Y" : sourceChannelCount === 3 ? "R,G,B" : "R,G,B,A")
    return {
      format: "OpenEXR",
      width: exr.width,
      height: exr.height,
      bitDepth,
      channels: sourceChannelCount,
      colorModel: sourceChannelCount === 1 ? "Grayscale" : sourceChannelCount >= 4 ? "RGBA" : "RGB",
      compression: String((exr.header as Record<string, unknown>).compression ?? "exr"),
      imageData: imageDataFromRgba(exr.width, exr.height, rgba),
      warnings: [`OpenEXR ${sourceChannels} ${bitDepth}-bit scene-linear values were tone-mapped into the browser 8-bit RGBA editing pipeline.`],
      metadata: {
        decoder: "parse-exr",
        colorSpace: exr.colorSpace,
        sourceChannels,
      },
    }
  } catch {
    return null
  }
}

async function decodeHeifBuffer(buffer: ArrayBuffer): Promise<DecodedRaster | null> {
  try {
    const headerBytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1024 * 1024))
    const dimensions = sniffRasterDimensions(headerBytes)
    if (dimensions?.format === "ISO-BMFF") {
      assertCanvasSize(dimensions.width, dimensions.height, "HEIF/HEIC image")
    }
    const { decode } = await import("@discourse/heic")
    const image = await decode(buffer)
    assertCanvasSize(image.width, image.height, "HEIF/HEIC image")
    return {
      format: "HEIF/HEIC",
      width: image.width,
      height: image.height,
      bitDepth: 8,
      channels: 4,
      colorModel: "RGBA",
      compression: "hevc",
      imageData: image,
      warnings: ["HEIF/HEIC was decoded into editable RGBA pixels; auxiliary images, depth maps, and writer support are not emitted."],
      metadata: { decoder: "@discourse/heic" },
    }
  } catch {
    return null
  }
}


async function decodeRawBuffer(buffer: ArrayBuffer): Promise<DecodedRaster | null> {
  if (typeof Worker === "undefined") return null
  let raw: LibRawDecoderInstance | null = null
  try {
    const runtime = await loadLibRawRuntime()
    raw = new runtime.LibRaw()
    await raw.open(new Uint8Array(buffer), {
      outputBps: 8,
      outputColor: 1,
      useCameraWb: true,
      userQual: 3,
    })
    const metadata = normalizeLibRawMetadata(await raw.metadata(false))
    // Preflight metadata dimensions before imageData() materialises the
    // full demosaiced pixel buffer.
    const metaWidth = Number(metadata.width ?? metadata.iwidth ?? (metadata.sizes as Record<string, unknown> | undefined)?.width ?? 0)
    const metaHeight = Number(metadata.height ?? metadata.iheight ?? (metadata.sizes as Record<string, unknown> | undefined)?.height ?? 0)
    if (metaWidth > 0 && metaHeight > 0) assertCanvasSize(metaWidth, metaHeight, "RAW/DNG image")
    const image = await raw.imageData() as Record<string, unknown>
    const width = Number(image.width ?? image.output_width ?? metadata.width ?? metadata.iwidth ?? (metadata.sizes as Record<string, unknown> | undefined)?.width ?? 0)
    const height = Number(image.height ?? image.output_height ?? metadata.height ?? metadata.iheight ?? (metadata.sizes as Record<string, unknown> | undefined)?.height ?? 0)
    const data = image.data ?? image.pixels ?? image.image
    if (!width || !height || !(data instanceof Uint8Array || data instanceof Uint16Array || data instanceof Uint8ClampedArray)) return null
    assertCanvasSize(width, height, "RAW/DNG image")
    const source = data as Uint8Array | Uint16Array | Uint8ClampedArray
    const componentCount = Math.max(1, Math.round(source.length / Math.max(1, width * height)))
    const max = source instanceof Uint16Array ? 65535 : 255
    const rgba = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      const base = i * componentCount
      const target = i * 4
      const r = scaleSample(Number(source[base] ?? 0), max)
      const g = scaleSample(Number(source[base + 1] ?? source[base] ?? 0), max)
      const b = scaleSample(Number(source[base + 2] ?? source[base] ?? 0), max)
      rgba[target] = r
      rgba[target + 1] = g
      rgba[target + 2] = b
      rgba[target + 3] = componentCount >= 4 ? scaleSample(Number(source[base + 3] ?? max), max) : 255
    }
    return {
      format: "RAW/DNG",
      width,
      height,
      bitDepth: max === 65535 ? 16 : 8,
      channels: Math.min(componentCount, 4),
      colorModel: componentCount === 1 ? "Grayscale" : "RGB",
      compression: "raw-demosaic",
      imageData: imageDataFromRgba(width, height, rgba),
      warnings: ["RAW/DNG data was demosaiced through LibRaw WASM into editable RGBA pixels; non-destructive RAW settings are not round-tripped."],
      metadata: { decoder: "libraw-wasm" },
    }
  } catch {
    return null
  } finally {
    raw?.delete?.()
  }
}

function linearPreviewSample(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0
  const normalized = value > 1 ? value / (1 + value) : value
  return clamp8(Math.pow(Math.max(0, Math.min(1, normalized)), 1 / 2.2) * 255)
}

function decodeTgaColor(bytes: Uint8Array, offset: number, depth: number, alphaBits = 0) {
  if (depth === 32) return { r: bytes[offset + 2], g: bytes[offset + 1], b: bytes[offset], a: bytes[offset + 3], size: 4 }
  if (depth === 24) return { r: bytes[offset + 2], g: bytes[offset + 1], b: bytes[offset], a: 255, size: 3 }
  if (depth === 16 || depth === 15) {
    const value = bytes[offset] | (bytes[offset + 1] << 8)
    return {
      r: Math.round(((value >> 10) & 31) * 255 / 31),
      g: Math.round(((value >> 5) & 31) * 255 / 31),
      b: Math.round((value & 31) * 255 / 31),
      // ARGB1555: the high bit is alpha, but only when the image descriptor
      // declares an attribute bit — many opaque files leave bit 15 zeroed.
      a: depth === 16 && alphaBits > 0 ? ((value & 0x8000) !== 0 ? 255 : 0) : 255,
      size: 2,
    }
  }
  throw new Error(`Unsupported TGA pixel depth: ${depth}`)
}

function readTgaFixed(bytes: Uint8Array, offset: number, length: number) {
  let end = offset
  const max = Math.min(bytes.length, offset + length)
  while (end < max && bytes[end] !== 0) end++
  return new TextDecoder("latin1").decode(bytes.subarray(offset, end)).trim()
}

function readTgaMetadata(bytes: Uint8Array, idLength: number): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {}
  if (idLength > 0) {
    const id = readTgaFixed(bytes, 18, idLength)
    if (id) metadata.title = id
  }
  if (bytes.byteLength < 26) return Object.keys(metadata).length ? metadata : undefined
  const footerOffset = bytes.byteLength - 26
  if (readTgaFixed(bytes, footerOffset + 8, 18) !== TGA_SIGNATURE.replace(/\0$/, "")) {
    return Object.keys(metadata).length ? metadata : undefined
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const extensionOffset = view.getUint32(footerOffset, true)
  const developerOffset = view.getUint32(footerOffset + 4, true)
  if (extensionOffset > 0 && extensionOffset + 495 <= bytes.byteLength) {
    const author = readTgaFixed(bytes, extensionOffset + 2, 41)
    const comments = [0, 1, 2, 3]
      .map((line) => readTgaFixed(bytes, extensionOffset + 43 + line * 81, 81))
      .filter(Boolean)
    const title = readTgaFixed(bytes, extensionOffset + 379, 41)
    const software = readTgaFixed(bytes, extensionOffset + 426, 41)
    const month = view.getUint16(extensionOffset + 367, true)
    const day = view.getUint16(extensionOffset + 369, true)
    const year = view.getUint16(extensionOffset + 371, true)
    const hour = view.getUint16(extensionOffset + 373, true)
    const minute = view.getUint16(extensionOffset + 375, true)
    const second = view.getUint16(extensionOffset + 377, true)
    if (author) metadata.author = author
    if (comments.length) {
      metadata.comments = comments
      metadata.description = comments.join(" ").trim()
    }
    if (title) metadata.title = title
    if (software) metadata.software = software
    if (year && month && day) metadata.creationDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString()
  }
  if (developerOffset > 0 && developerOffset + 2 <= bytes.byteLength) {
    const count = view.getUint16(developerOffset, true)
    for (let i = 0; i < count; i++) {
      const entry = developerOffset + 2 + i * 10
      if (entry + 10 > bytes.byteLength) break
      const tag = view.getUint16(entry, true)
      const offset = view.getUint32(entry + 2, true)
      const size = view.getUint32(entry + 6, true)
      if (tag !== TGA_DEVELOPER_TAG_METADATA || offset + size > bytes.byteLength) continue
      const text = new TextDecoder().decode(bytes.subarray(offset, offset + size))
      if (!text.startsWith(TGA_DEVELOPER_PREFIX)) continue
      try {
        const parsed = JSON.parse(text.slice(TGA_DEVELOPER_PREFIX.length)) as Record<string, unknown>
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "string" && value) metadata[key] = value
          else if (typeof value === "number" || typeof value === "boolean") metadata[key] = value
          else if (Array.isArray(value) && value.every((item) => typeof item === "string")) metadata[key] = value
          else if (key === "tga" && value && typeof value === "object" && !Array.isArray(value)) metadata[key] = value
          else if (key === "contentCredentials" && Array.isArray(value) && value.every((item) => item && typeof item === "object" && !Array.isArray(item))) metadata[key] = value
        }
      } catch {
        metadata.developerMetadata = text.slice(0, 120)
      }
    }
  }
  return Object.keys(metadata).length ? metadata : undefined
}

export function decodeTgaBuffer(buffer: ArrayBuffer): DecodedRaster {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 18) throw new Error("TGA file is too small")
  const idLength = bytes[0]
  const colorMapType = bytes[1]
  const imageType = bytes[2]
  const colorMapStart = bytes[3] | (bytes[4] << 8)
  const colorMapLength = bytes[5] | (bytes[6] << 8)
  const colorMapDepth = bytes[7]
  const width = bytes[12] | (bytes[13] << 8)
  const height = bytes[14] | (bytes[15] << 8)
  const pixelDepth = bytes[16]
  const descriptor = bytes[17]
  if (!width || !height) throw new Error("TGA dimensions are missing")
  // Reject decoders that would allocate gigabytes of pixel buffer for an
  // attacker-controlled or malformed header before any actual pixels are
  // read. assertCanvasSize throws a friendly error with the configured
  // limits, matching the document import path's behaviour.
  assertCanvasSize(width, height, "TGA image")

  const isRle = imageType === 9 || imageType === 10 || imageType === 11
  const isColorMapped = imageType === 1 || imageType === 9
  const isTrueColor = imageType === 2 || imageType === 10
  const isGray = imageType === 3 || imageType === 11
  if (!isColorMapped && !isTrueColor && !isGray) throw new Error(`Unsupported TGA image type: ${imageType}`)

  const paletteEntryBytes = colorMapType ? Math.ceil(colorMapDepth / 8) : 0
  const paletteOffset = 18 + idLength
  const pixelOffset = paletteOffset + colorMapLength * paletteEntryBytes
  const rgba = new Uint8ClampedArray(width * height * 4)
  const topOrigin = (descriptor & 0x20) !== 0
  const rightOrigin = (descriptor & 0x10) !== 0
  const attributeBits = descriptor & 0x0f
  const warnings: string[] = []
  const metadata = readTgaMetadata(bytes, idLength)

  const writePixel = (streamIndex: number, r: number, g: number, b: number, a: number) => {
    let x = streamIndex % width
    let y = Math.floor(streamIndex / width)
    if (!topOrigin) y = height - 1 - y
    if (rightOrigin) x = width - 1 - x
    const i = (y * width + x) * 4
    rgba[i] = r
    rgba[i + 1] = g
    rgba[i + 2] = b
    rgba[i + 3] = a
  }

  const readPixel = (offset: number) => {
    if (isGray) {
      const gray = bytes[offset]
      return { r: gray, g: gray, b: gray, a: pixelDepth >= 16 ? bytes[offset + 1] : 255, size: Math.max(1, Math.ceil(pixelDepth / 8)) }
    }
    if (isColorMapped) {
      const index = pixelDepth <= 8 ? bytes[offset] : bytes[offset] | (bytes[offset + 1] << 8)
      const paletteIndex = index - colorMapStart
      if (paletteIndex < 0 || paletteIndex >= colorMapLength) return { r: 0, g: 0, b: 0, a: 0, size: Math.max(1, Math.ceil(pixelDepth / 8)) }
      const color = decodeTgaColor(bytes, paletteOffset + paletteIndex * paletteEntryBytes, colorMapDepth)
      return { ...color, size: Math.max(1, Math.ceil(pixelDepth / 8)) }
    }
    return decodeTgaColor(bytes, offset, pixelDepth, attributeBits)
  }

  let p = pixelOffset
  let written = 0
  const total = width * height
  if (isRle) {
    while (written < total && p < bytes.length) {
      const packet = bytes[p++]
      const count = (packet & 0x7f) + 1
      if (packet & 0x80) {
        const pixel = readPixel(p)
        p += pixel.size
        for (let i = 0; i < count && written < total; i++) writePixel(written++, pixel.r, pixel.g, pixel.b, pixel.a)
      } else {
        for (let i = 0; i < count && written < total; i++) {
          const pixel = readPixel(p)
          p += pixel.size
          writePixel(written++, pixel.r, pixel.g, pixel.b, pixel.a)
        }
      }
    }
  } else {
    while (written < total && p < bytes.length) {
      const pixel = readPixel(p)
      p += pixel.size
      writePixel(written++, pixel.r, pixel.g, pixel.b, pixel.a)
    }
  }
  if (written < total) warnings.push(`TGA pixel data ended after ${written} of ${total} pixels.`)

  return {
    format: "TGA",
    width,
    height,
    bitDepth: Math.min(8, pixelDepth),
    channels: isGray ? 1 : pixelDepth === 32 ? 4 : 3,
    colorModel: isGray ? "Grayscale" : isColorMapped ? "Indexed" : "RGB",
    compression: isRle ? "rle" : "none",
    imageData: imageDataFromRgba(width, height, rgba),
    warnings,
    metadata,
  }
}

interface PnmToken {
  value: string
  next: number
}

function nextPnmToken(bytes: Uint8Array, start: number, comments?: string[]): PnmToken {
  let i = start
  while (i < bytes.length) {
    const c = bytes[i]
    if (c === 35) {
      const commentStart = i + 1
      while (i < bytes.length && bytes[i] !== 10 && bytes[i] !== 13) i++
      const comment = new TextDecoder("latin1").decode(bytes.subarray(commentStart, i)).trim()
      if (comment) comments?.push(comment)
    } else if (c <= 32) {
      i++
    } else {
      break
    }
  }
  const tokenStart = i
  while (i < bytes.length && bytes[i] > 32 && bytes[i] !== 35) i++
  return { value: readAscii(bytes.buffer, tokenStart, i - tokenStart), next: i }
}

function skipPnmWhitespace(bytes: Uint8Array, start: number) {
  let i = start
  while (i < bytes.length && bytes[i] <= 32) i++
  return i
}

function pnmStructuredMetadata(comments: readonly string[]) {
  const metadata: Record<string, unknown> = {}
  let description: string | undefined
  for (const comment of comments) {
    const match = /^([A-Za-z][A-Za-z -]*):\s*(.*)$/.exec(comment)
    const key = match?.[1]?.toLowerCase().replace(/\s+/g, "-")
    const value = match?.[2]?.trim()
    if (key === "title" && value) metadata.title = value
    else if (key === "author" && value) metadata.author = value
    else if (key === "copyright" && value) metadata.copyright = value
    else if (key === "source" && value) metadata.source = value
    else if (key === "source-maxvalue" && value) metadata.sourceMaxValue = Number(value)
    else if (!match && !description) description = comment
  }
  if (description) metadata.description = description
  return metadata
}

export function decodePnmBuffer(buffer: ArrayBuffer): DecodedRaster {
  const bytes = new Uint8Array(buffer)
  const comments: string[] = []
  const magic = nextPnmToken(bytes, 0, comments)
  if (!/^P[1-6]$/.test(magic.value)) throw new Error("Unsupported PNM magic header")
  const widthToken = nextPnmToken(bytes, magic.next, comments)
  const heightToken = nextPnmToken(bytes, widthToken.next, comments)
  const width = Number(widthToken.value)
  const height = Number(heightToken.value)
  if (!width || !height) throw new Error("PNM dimensions are missing")
  assertCanvasSize(width, height, "PNM image")
  const bitmap = magic.value === "P1" || magic.value === "P4"
  const maxToken = bitmap ? { value: "1", next: heightToken.next } : nextPnmToken(bytes, heightToken.next, comments)
  const maxValue = Number(maxToken.value)
  const bitDepth = maxValue > 255 ? 16 : 8
  const channels = magic.value === "P3" || magic.value === "P6" ? 3 : 1
  const rgba = new Uint8ClampedArray(width * height * 4)
  const ascii = magic.value === "P1" || magic.value === "P2" || magic.value === "P3"
  let cursor = ascii ? skipPnmWhitespace(bytes, maxToken.next) : maxToken.next
  if (!ascii && bytes[cursor] <= 32) cursor++

  const write = (pixel: number, r: number, g: number, b: number) => {
    const i = pixel * 4
    rgba[i] = r
    rgba[i + 1] = g
    rgba[i + 2] = b
    rgba[i + 3] = 255
  }

  if (ascii) {
    for (let p = 0; p < width * height; p++) {
      if (channels === 3) {
        const r = nextPnmToken(bytes, cursor)
        const g = nextPnmToken(bytes, r.next)
        const b = nextPnmToken(bytes, g.next)
        cursor = b.next
        write(p, scaleSample(Number(r.value), maxValue), scaleSample(Number(g.value), maxValue), scaleSample(Number(b.value), maxValue))
      } else {
        const v = nextPnmToken(bytes, cursor)
        cursor = v.next
        const gray = bitmap ? (v.value === "1" ? 0 : 255) : scaleSample(Number(v.value), maxValue)
        write(p, gray, gray, gray)
      }
    }
  } else if (magic.value === "P4") {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = bytes[cursor + Math.floor(x / 8)]
        const black = (byte & (0x80 >> (x % 8))) !== 0
        const gray = black ? 0 : 255
        write(y * width + x, gray, gray, gray)
      }
      cursor += Math.ceil(width / 8)
    }
  } else {
    const sampleBytes = bitDepth === 16 ? 2 : 1
    for (let p = 0; p < width * height; p++) {
      const readSample = () => {
        const value = sampleBytes === 2 ? (bytes[cursor++] << 8) | bytes[cursor++] : bytes[cursor++]
        return scaleSample(value, maxValue)
      }
      if (channels === 3) write(p, readSample(), readSample(), readSample())
      else {
        const gray = readSample()
        write(p, gray, gray, gray)
      }
    }
  }

  const structuredMetadata = pnmStructuredMetadata(comments)
  const parsedSourceMax = typeof structuredMetadata.sourceMaxValue === "number" && Number.isFinite(structuredMetadata.sourceMaxValue)
    ? structuredMetadata.sourceMaxValue
    : Number(comments.find((comment) => /^Source-MaxValue:/i.test(comment))?.split(":").slice(1).join(":").trim()) || maxValue

  return {
    format: "PNM",
    width,
    height,
    bitDepth,
    channels,
    colorModel: channels === 3 ? "RGB" : "Grayscale",
    compression: "none",
    imageData: imageDataFromRgba(width, height, rgba),
    warnings: [],
    metadata: {
      maxValue,
      sourceMaxValue: parsedSourceMax,
      ...structuredMetadata,
      ...(comments.length ? { comments } : {}),
    },
  }
}

const tiffTypeSizes: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  7: 1,
}

function inlineTiffValue(entryOffset: number, view: DataView, little: boolean) {
  return little
    ? view.getUint32(entryOffset + 8, little)
    : view.getUint32(entryOffset + 8, little)
}

function readTiffValues(view: DataView, entryOffset: number, little: boolean): number[] {
  const type = view.getUint16(entryOffset + 2, little)
  const count = view.getUint32(entryOffset + 4, little)
  const typeSize = tiffTypeSizes[type]
  if (!typeSize) return []
  const byteCount = typeSize * count
  const valueOffset = byteCount <= 4 ? entryOffset + 8 : inlineTiffValue(entryOffset, view, little)
  const values: number[] = []
  for (let i = 0; i < count; i++) {
    const pos = valueOffset + i * typeSize
    if (type === 1 || type === 2) values.push(view.getUint8(pos))
    else if (type === 3) values.push(view.getUint16(pos, little))
    else if (type === 4) values.push(view.getUint32(pos, little))
    else if (type === 5) values.push(view.getUint32(pos, little) / Math.max(1, view.getUint32(pos + 4, little)))
  }
  return values
}

function decodeTiffLzw(data: Uint8Array, expectedLength: number): Uint8Array {
  const out = new Uint8Array(expectedLength)
  let outOffset = 0
  let bitOffset = 0
  let codeSize = 9
  let nextCode = 258
  let previous: number[] | null = null
  const dict: number[][] = []

  const reset = () => {
    dict.length = 0
    for (let i = 0; i < 256; i++) dict[i] = [i]
    codeSize = 9
    nextCode = 258
    previous = null
  }
  const readCode = () => {
    if (bitOffset + codeSize > data.length * 8) return null
    const byte = bitOffset >>> 3
    const bit = bitOffset & 7
    const window = ((data[byte] ?? 0) << 16) | ((data[byte + 1] ?? 0) << 8) | (data[byte + 2] ?? 0)
    const code = (window >>> (24 - bit - codeSize)) & ((1 << codeSize) - 1)
    bitOffset += codeSize
    return code
  }
  const add = (entry: number[]) => {
    if (nextCode > 4095) return
    dict[nextCode++] = entry
    if (nextCode + 1 === 1 << codeSize && codeSize < 12) codeSize++
  }
  const write = (entry: number[]) => {
    for (const value of entry) {
      if (outOffset >= out.length) return
      out[outOffset++] = value
    }
  }

  reset()
  while (outOffset < out.length) {
    const code = readCode()
    if (code === null || code === 257) break
    if (code === 256) {
      reset()
      continue
    }
    const entry: number[] | null = dict[code] ?? (code === nextCode && previous ? [...previous, previous[0]] : null)
    if (!entry) break
    write(entry)
    if (previous) add([...previous, entry[0]])
    previous = entry
  }
  return out
}

export function decodeTiffBuffer(buffer: ArrayBuffer): DecodedRaster {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const byteOrder = readAscii(buffer, 0, 2)
  const little = byteOrder === "II"
  if (!little && byteOrder !== "MM") throw new Error("TIFF byte order is missing")
  if (view.getUint16(2, little) !== 42) throw new Error("Unsupported TIFF header")
  const ifdOffset = view.getUint32(4, little)
  const tagCount = view.getUint16(ifdOffset, little)
  const tags = new Map<number, number[]>()
  for (let i = 0; i < tagCount; i++) {
    const entry = ifdOffset + 2 + i * 12
    tags.set(view.getUint16(entry, little), readTiffValues(view, entry, little))
  }

  const width = tags.get(256)?.[0] ?? 0
  const height = tags.get(257)?.[0] ?? 0
  const bits = tags.get(258) ?? [1]
  const compression = tags.get(259)?.[0] ?? 1
  const photometric = tags.get(262)?.[0] ?? 2
  const stripOffsets = tags.get(273) ?? []
  const samplesPerPixel = tags.get(277)?.[0] ?? (photometric === 2 ? 3 : 1)
  const rowsPerStrip = tags.get(278)?.[0] ?? height
  const stripByteCounts = tags.get(279) ?? []
  const planar = tags.get(284)?.[0] ?? 1
  if (!width || !height) throw new Error("TIFF dimensions are missing")
  assertCanvasSize(width, height, "TIFF image")
  if (compression !== 1 && compression !== 5) throw new Error(`Unsupported TIFF compression: ${compression}`)
  if (planar !== 1) throw new Error("Planar TIFF data is not supported")
  if (![0, 1, 2].includes(photometric)) throw new Error(`Unsupported TIFF photometric interpretation: ${photometric}`)

  const rgba = new Uint8ClampedArray(width * height * 4)
  const maxBitDepth = Math.max(...bits)
  const sampleBytes = maxBitDepth > 8 ? 2 : 1
  const warnings: string[] = []
  let row = 0
  for (let stripIndex = 0; stripIndex < stripOffsets.length && row < height; stripIndex++) {
    const rows = Math.min(rowsPerStrip, height - row)
    const stripOffset = stripOffsets[stripIndex]
    const stripByteCount = stripByteCounts[stripIndex] ?? Math.max(0, bytes.length - stripOffset)
    const expectedStripBytes = rows * width * samplesPerPixel * sampleBytes
    const stripData = compression === 5
      ? decodeTiffLzw(bytes.subarray(stripOffset, stripOffset + stripByteCount), expectedStripBytes)
      : bytes.subarray(stripOffset, stripOffset + stripByteCount)
    const stripView = new DataView(stripData.buffer, stripData.byteOffset, stripData.byteLength)
    let p = 0
    for (let sy = 0; sy < rows && p < stripData.byteLength; sy++, row++) {
      for (let x = 0; x < width; x++) {
        const samples: number[] = []
        for (let s = 0; s < samplesPerPixel; s++) {
          const sample = sampleBytes === 2 ? stripView.getUint16(p, little) : stripView.getUint8(p)
          p += sampleBytes
          samples.push(scaleSample(sample, (1 << Math.min(16, bits[Math.min(s, bits.length - 1)] ?? maxBitDepth)) - 1))
        }
        const i = (row * width + x) * 4
        if (photometric === 2) {
          rgba[i] = samples[0] ?? 0
          rgba[i + 1] = samples[1] ?? samples[0] ?? 0
          rgba[i + 2] = samples[2] ?? samples[0] ?? 0
          rgba[i + 3] = samples[3] ?? 255
        } else {
          const gray = photometric === 0 ? 255 - (samples[0] ?? 0) : samples[0] ?? 0
          rgba[i] = gray
          rgba[i + 1] = gray
          rgba[i + 2] = gray
          rgba[i + 3] = samples[1] ?? 255
        }
      }
    }
  }
  if (row < height) warnings.push(`TIFF decoder filled ${row} of ${height} rows from available strip data.`)

  return {
    format: "TIFF",
    width,
    height,
    bitDepth: maxBitDepth,
    channels: samplesPerPixel,
    colorModel: photometric === 2 ? "RGB" : "Grayscale",
    compression: "none",
    imageData: imageDataFromRgba(width, height, rgba),
    warnings,
    metadata: {
      strips: stripOffsets.length,
      rowsPerStrip,
      byteOrder,
    },
  }
}

async function inflateRawAsync(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") throw new Error("Deflate TIFF decoding requires DecompressionStream support")
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function decodeTiffBufferAsyncFallback(buffer: ArrayBuffer): Promise<DecodedRaster> {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const byteOrder = readAscii(buffer, 0, 2)
  const little = byteOrder === "II"
  if (!little && byteOrder !== "MM") throw new Error("TIFF byte order is missing")
  if (view.getUint16(2, little) !== 42) throw new Error("Unsupported TIFF header")
  const ifdOffset = view.getUint32(4, little)
  const tagCount = view.getUint16(ifdOffset, little)
  const tags = new Map<number, number[]>()
  for (let i = 0; i < tagCount; i++) {
    const entry = ifdOffset + 2 + i * 12
    tags.set(view.getUint16(entry, little), readTiffValues(view, entry, little))
  }

  const width = tags.get(256)?.[0] ?? 0
  const height = tags.get(257)?.[0] ?? 0
  const bits = tags.get(258) ?? [1]
  const compression = tags.get(259)?.[0] ?? 1
  const photometric = tags.get(262)?.[0] ?? 2
  const stripOffsets = tags.get(273) ?? []
  const samplesPerPixel = tags.get(277)?.[0] ?? (photometric === 2 ? 3 : 1)
  const rowsPerStrip = tags.get(278)?.[0] ?? height
  const stripByteCounts = tags.get(279) ?? []
  const planar = tags.get(284)?.[0] ?? 1
  if (!width || !height) throw new Error("TIFF dimensions are missing")
  assertCanvasSize(width, height, "TIFF image")
  if (compression !== 8 && compression !== 32946) return decodeTiffBuffer(buffer)
  if (planar !== 1) throw new Error("Planar TIFF data is not supported")
  if (![0, 1, 2].includes(photometric)) throw new Error(`Unsupported TIFF photometric interpretation: ${photometric}`)

  const rgba = new Uint8ClampedArray(width * height * 4)
  const maxBitDepth = Math.max(...bits)
  const sampleBytes = maxBitDepth > 8 ? 2 : 1
  const warnings: string[] = []
  let row = 0
  for (let stripIndex = 0; stripIndex < stripOffsets.length && row < height; stripIndex++) {
    const rows = Math.min(rowsPerStrip, height - row)
    const stripOffset = stripOffsets[stripIndex]
    const stripByteCount = stripByteCounts[stripIndex] ?? Math.max(0, bytes.length - stripOffset)
    const stripData = await inflateRawAsync(bytes.subarray(stripOffset, stripOffset + stripByteCount))
    const stripView = new DataView(stripData.buffer, stripData.byteOffset, stripData.byteLength)
    let p = 0
    for (let sy = 0; sy < rows && p < stripData.byteLength; sy++, row++) {
      for (let x = 0; x < width; x++) {
        const samples: number[] = []
        for (let s = 0; s < samplesPerPixel; s++) {
          const sample = sampleBytes === 2 ? stripView.getUint16(p, little) : stripView.getUint8(p)
          p += sampleBytes
          samples.push(scaleSample(sample, (1 << Math.min(16, bits[Math.min(s, bits.length - 1)] ?? maxBitDepth)) - 1))
        }
        const i = (row * width + x) * 4
        if (photometric === 2) {
          rgba[i] = samples[0] ?? 0
          rgba[i + 1] = samples[1] ?? samples[0] ?? 0
          rgba[i + 2] = samples[2] ?? samples[0] ?? 0
          rgba[i + 3] = samples[3] ?? 255
        } else {
          const gray = photometric === 0 ? 255 - (samples[0] ?? 0) : samples[0] ?? 0
          rgba[i] = gray
          rgba[i + 1] = gray
          rgba[i + 2] = gray
          rgba[i + 3] = samples[1] ?? 255
        }
      }
    }
  }
  if (row < height) warnings.push(`TIFF decoder filled ${row} of ${height} rows from available strip data.`)

  return {
    format: "TIFF",
    width,
    height,
    bitDepth: maxBitDepth,
    channels: samplesPerPixel,
    colorModel: photometric === 2 ? "RGB" : "Grayscale",
    compression: "deflate",
    imageData: imageDataFromRgba(width, height, rgba),
    warnings,
    metadata: {
      strips: stripOffsets.length,
      rowsPerStrip,
      byteOrder,
    },
  }
}

export function decodedRasterToCanvas(decoded: DecodedRaster): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = decoded.width
  canvas.height = decoded.height
  canvas.getContext("2d")!.putImageData(decoded.imageData, 0, 0)
  return canvas
}
