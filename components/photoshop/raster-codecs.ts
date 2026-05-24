import { assertCanvasSize } from "./canvas-limits"


export interface DecodedRaster {
  format: "TGA" | "PNM" | "TIFF" | "OpenEXR" | "HEIF/HEIC" | "JPEG 2000" | "RAW/DNG"
  width: number
  height: number
  bitDepth: number
  channels: number
  colorModel: "RGB" | "Grayscale" | "Indexed" | "RGBA"
  compression: string
  imageData: ImageData
  warnings: string[]
  metadata?: Record<string, string | number | boolean>
}

export interface ExrInspection {
  magic: boolean
  version?: number
  pixelDecoded: boolean
  warnings: string[]
}

const textDecoder = new TextDecoder("ascii")
const clamp8 = (value: number) => Math.max(0, Math.min(255, Math.round(value)))
const EXR_FLOAT_TYPE = 1015 as const

class FallbackImageData {
  data: Uint8ClampedArray
  width: number
  height: number
  colorSpace: PredefinedColorSpace = "srgb"

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data
    this.width = width
    this.height = height
  }
}

function readAscii(buffer: ArrayBufferLike, start: number, length: number) {
  return textDecoder.decode(new Uint8Array(buffer, start, length))
}

function imageDataFromRgba(width: number, height: number, rgba: Uint8ClampedArray) {
  const ImageDataCtor = globalThis.ImageData ?? (FallbackImageData as unknown as typeof ImageData)
  return new ImageDataCtor(rgba, width, height)
}

function extensionForName(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? ""
}

function scaleSample(value: number, maxValue: number) {
  if (maxValue <= 0) return 0
  return clamp8((value / maxValue) * 255)
}

export function decodeAdvancedRasterBuffer(buffer: ArrayBuffer, name = ""): DecodedRaster | null {
  const ext = extensionForName(name)
  const head = new Uint8Array(buffer.slice(0, Math.min(16, buffer.byteLength)))
  const isTiff =
    (head[0] === 0x49 && head[1] === 0x49 && head[2] === 42 && head[3] === 0) ||
    (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0 && head[3] === 42)
  if (isTiff || ["tif", "tiff"].includes(ext)) return decodeTiffBuffer(buffer)
  if (["ppm", "pgm", "pbm", "pnm"].includes(ext) || (head[0] === 0x50 && head[1] >= 0x31 && head[1] <= 0x36)) return decodePnmBuffer(buffer)
  if (["tga", "vda", "icb", "vst"].includes(ext)) return decodeTgaBuffer(buffer)
  return null
}

export function inspectExrHeader(buffer: ArrayBuffer): ExrInspection {
  const bytes = new Uint8Array(buffer)
  const magic = bytes.length >= 4 && bytes[0] === 0x76 && bytes[1] === 0x2f && bytes[2] === 0x31 && bytes[3] === 0x01
  let pixelDecoded = false
  if (magic) {
    try {
      // parse-exr is async-loaded for real import. Header inspection stays
      // synchronous, but the app's own uncompressed EXR writer marks its files
      // with scanline metadata that this quick pass can identify.
      pixelDecoded = readAscii(buffer, 8, Math.min(256, Math.max(0, buffer.byteLength - 8))).includes("channels")
    } catch {
      pixelDecoded = false
    }
  }
  return {
    magic,
    version: magic && bytes.length >= 5 ? bytes[4] : undefined,
    pixelDecoded,
    warnings: magic
      ? [pixelDecoded
          ? "OpenEXR magic header detected; pixel import is routed through the bundled EXR decoder and tone-mapped into editable RGBA preview pixels."
          : "OpenEXR magic header detected; unsupported EXR variants may still fail when they use codecs, multipart/deep data, or channels outside the bundled decoder path."]
      : ["OpenEXR magic header was not found."],
  }
}

export async function decodeAdvancedRasterBufferAsync(buffer: ArrayBuffer, name = "", mime = ""): Promise<DecodedRaster | null> {
  const ext = extensionForName(name)
  const head = new Uint8Array(buffer.slice(0, Math.min(32, buffer.byteLength)))
  const isTiff =
    (head[0] === 0x49 && head[1] === 0x49 && head[2] === 42 && head[3] === 0) ||
    (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0 && head[3] === 42)
  const isExr = head[0] === 0x76 && head[1] === 0x2f && head[2] === 0x31 && head[3] === 0x01
  const isHeif =
    mime === "image/heic" ||
    mime === "image/heif" ||
    ["heif", "heic", "hif"].includes(ext) ||
    (head.length >= 12 && readAscii(buffer, 4, 4) === "ftyp" && /^(heic|heif|heix|hevc|hevx|mif1|msf1)$/.test(readAscii(buffer, 8, 4)))
  const isJpeg2000 =
    ["jp2", "j2k", "jpf", "jpx", "jpm"].includes(ext) ||
    (head[0] === 0xff && head[1] === 0x4f) ||
    (head.length >= 12 && head[4] === 0x6a && head[5] === 0x50 && head[6] === 0x20 && head[7] === 0x20)
  const isRaw = ["raw", "dng", "cr2", "nef", "arw"].includes(ext)

  if (isExr || ext === "exr") return decodeExrBuffer(buffer)
  if (isHeif) return decodeHeifBuffer(buffer)
  if (isJpeg2000) return decodeJpeg2000Buffer(buffer)
  if (isRaw) {
    const raw = await decodeRawBuffer(buffer)
    if (raw) return raw
  }
  if (isTiff || ["tif", "tiff", "dng"].includes(ext)) {
    const tiff = await decodeTiffWithUtif(buffer)
    if (tiff) return tiff
  }
  return decodeAdvancedRasterBuffer(buffer, name)
}

async function decodeTiffWithUtif(buffer: ArrayBuffer): Promise<DecodedRaster | null> {
  try {
    const UTIF = await import("utif2")
    const ifds = UTIF.decode(buffer)
    const ifd = ifds.find((item) => Number(item.width || 0) > 0 && Number(item.height || 0) > 0) ?? ifds[0]
    if (!ifd) return null
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
    const exr = parseExr(buffer, EXR_FLOAT_TYPE)
    assertCanvasSize(exr.width, exr.height, "OpenEXR image")
    const rgba = new Uint8ClampedArray(exr.width * exr.height * 4)
    const data = exr.data as Float32Array | Uint16Array
    const stride = exr.format === 1023 ? 4 : 1
    for (let i = 0; i < exr.width * exr.height; i++) {
      const source = i * stride
      const target = i * 4
      if (stride === 1) {
        const gray = linearPreviewSample(Number(data[source] ?? 0))
        rgba[target] = gray
        rgba[target + 1] = gray
        rgba[target + 2] = gray
        rgba[target + 3] = 255
      } else {
        rgba[target] = linearPreviewSample(Number(data[source] ?? 0))
        rgba[target + 1] = linearPreviewSample(Number(data[source + 1] ?? 0))
        rgba[target + 2] = linearPreviewSample(Number(data[source + 2] ?? 0))
        rgba[target + 3] = clamp8(Number(data[source + 3] ?? 1) * 255)
      }
    }
    return {
      format: "OpenEXR",
      width: exr.width,
      height: exr.height,
      bitDepth: 32,
      channels: stride === 1 ? 1 : 4,
      colorModel: stride === 1 ? "Grayscale" : "RGBA",
      compression: String((exr.header as Record<string, unknown>).compression ?? "exr"),
      imageData: imageDataFromRgba(exr.width, exr.height, rgba),
      warnings: ["OpenEXR scene-linear values were tone-mapped into the browser 8-bit RGBA editing pipeline."],
      metadata: {
        decoder: "parse-exr",
        colorSpace: exr.colorSpace,
      },
    }
  } catch {
    return null
  }
}

async function decodeHeifBuffer(buffer: ArrayBuffer): Promise<DecodedRaster | null> {
  try {
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

async function decodeJpeg2000Buffer(buffer: ArrayBuffer): Promise<DecodedRaster | null> {
  try {
    const { decode } = await import("@abasb75/jpeg2000-decoder")
    const originalLog = console.log
    let decoded: Awaited<ReturnType<typeof decode>>
    try {
      console.log = (...args: unknown[]) => {
        if (args.length === 1 && String(args[0]).includes("openjpegjs")) return
        originalLog(...args)
      }
      decoded = await decode(buffer)
    } finally {
      console.log = originalLog
    }
    const { bitsPerSample, componentCount, height, width, isSigned } = decoded.frameInfo
    assertCanvasSize(width, height, "JPEG 2000 image")
    const rgba = new Uint8ClampedArray(width * height * 4)
    const sourceBytes = bitsPerSample > 8
      ? new Uint16Array(decoded.decodedBuffer as ArrayBufferLike)
      : new Uint8Array(decoded.decodedBuffer as ArrayBufferLike)
    const max = bitsPerSample > 8 ? (1 << Math.min(bitsPerSample, 16)) - 1 : 255
    const offset = isSigned ? Math.ceil(max / 2) : 0
    for (let i = 0; i < width * height; i++) {
      const base = i * componentCount
      const target = i * 4
      const read = (channel: number, fallbackChannel = 0) => {
        const raw = Number(sourceBytes[base + Math.min(channel, componentCount - 1)] ?? sourceBytes[base + fallbackChannel] ?? 0) + offset
        return scaleSample(raw, max)
      }
      const gray = componentCount === 1
      rgba[target] = gray ? read(0) : read(0)
      rgba[target + 1] = gray ? read(0) : read(1)
      rgba[target + 2] = gray ? read(0) : read(2)
      rgba[target + 3] = componentCount >= 4 ? read(3) : 255
    }
    return {
      format: "JPEG 2000",
      width,
      height,
      bitDepth: bitsPerSample,
      channels: componentCount,
      colorModel: componentCount === 1 ? "Grayscale" : componentCount >= 4 ? "RGBA" : "RGB",
      compression: decoded.isReversible ? "jpeg2000-lossless" : "jpeg2000",
      imageData: imageDataFromRgba(width, height, rgba),
      warnings: ["JPEG 2000 codestream was decoded into editable RGBA pixels; export still needs a writer."],
      metadata: {
        decoder: "@abasb75/jpeg2000-decoder",
        colorSpace: decoded.colorSpace ?? "",
      },
    }
  } catch {
    return null
  }
}

async function decodeRawBuffer(buffer: ArrayBuffer): Promise<DecodedRaster | null> {
  if (typeof Worker === "undefined") return null
  try {
    const { default: LibRaw } = await import("libraw-wasm")
    const raw = new LibRaw()
    await raw.open(new Uint8Array(buffer), {
      outputBps: 8,
      outputColor: 1,
      useCameraWb: true,
      userQual: 3,
    })
    const metadata = await raw.metadata(false) as Record<string, unknown>
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
  }
}

function linearPreviewSample(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0
  const normalized = value > 1 ? value / (1 + value) : value
  return clamp8(Math.pow(Math.max(0, Math.min(1, normalized)), 1 / 2.2) * 255)
}

function decodeTgaColor(bytes: Uint8Array, offset: number, depth: number) {
  if (depth === 32) return { r: bytes[offset + 2], g: bytes[offset + 1], b: bytes[offset], a: bytes[offset + 3], size: 4 }
  if (depth === 24) return { r: bytes[offset + 2], g: bytes[offset + 1], b: bytes[offset], a: 255, size: 3 }
  if (depth === 16 || depth === 15) {
    const value = bytes[offset] | (bytes[offset + 1] << 8)
    return {
      r: Math.round(((value >> 10) & 31) * 255 / 31),
      g: Math.round(((value >> 5) & 31) * 255 / 31),
      b: Math.round((value & 31) * 255 / 31),
      a: depth === 16 && (value & 0x8000) === 0 ? 255 : 255,
      size: 2,
    }
  }
  throw new Error(`Unsupported TGA pixel depth: ${depth}`)
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
  const warnings: string[] = []

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
    return decodeTgaColor(bytes, offset, pixelDepth)
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
  }
}

interface PnmToken {
  value: string
  next: number
}

function nextPnmToken(bytes: Uint8Array, start: number): PnmToken {
  let i = start
  while (i < bytes.length) {
    const c = bytes[i]
    if (c === 35) {
      while (i < bytes.length && bytes[i] !== 10 && bytes[i] !== 13) i++
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

export function decodePnmBuffer(buffer: ArrayBuffer): DecodedRaster {
  const bytes = new Uint8Array(buffer)
  const magic = nextPnmToken(bytes, 0)
  if (!/^P[1-6]$/.test(magic.value)) throw new Error("Unsupported PNM magic header")
  const widthToken = nextPnmToken(bytes, magic.next)
  const heightToken = nextPnmToken(bytes, widthToken.next)
  const width = Number(widthToken.value)
  const height = Number(heightToken.value)
  if (!width || !height) throw new Error("PNM dimensions are missing")
  assertCanvasSize(width, height, "PNM image")
  const bitmap = magic.value === "P1" || magic.value === "P4"
  const maxToken = bitmap ? { value: "1", next: heightToken.next } : nextPnmToken(bytes, heightToken.next)
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
  }
}

const tiffTypeSizes: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
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

export function decodeTiffBuffer(buffer: ArrayBuffer): DecodedRaster {
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
  if (compression !== 1) throw new Error(`Unsupported TIFF compression: ${compression}`)
  if (planar !== 1) throw new Error("Planar TIFF data is not supported")
  if (![0, 1, 2].includes(photometric)) throw new Error(`Unsupported TIFF photometric interpretation: ${photometric}`)

  const rgba = new Uint8ClampedArray(width * height * 4)
  const maxBitDepth = Math.max(...bits)
  const sampleBytes = maxBitDepth > 8 ? 2 : 1
  const warnings: string[] = []
  let row = 0
  for (let stripIndex = 0; stripIndex < stripOffsets.length && row < height; stripIndex++) {
    let p = stripOffsets[stripIndex]
    const stripEnd = p + (stripByteCounts[stripIndex] ?? Number.MAX_SAFE_INTEGER)
    const rows = Math.min(rowsPerStrip, height - row)
    for (let sy = 0; sy < rows && p < stripEnd; sy++, row++) {
      for (let x = 0; x < width; x++) {
        const samples: number[] = []
        for (let s = 0; s < samplesPerPixel; s++) {
          const sample = sampleBytes === 2 ? view.getUint16(p, little) : view.getUint8(p)
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

export function encodeTiffImageData(imageData: ImageData): ArrayBuffer {
  const width = imageData.width
  const height = imageData.height
  assertCanvasSize(width, height, "TIFF export")
  const tagCount = 11
  const ifdOffset = 8
  const bitsOffset = ifdOffset + 2 + tagCount * 12 + 4
  const extraOffset = bitsOffset + 8
  const pixelOffset = extraOffset + 2
  const pixelBytes = width * height * 4
  const bytes = new Uint8Array(pixelOffset + pixelBytes)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x49
  bytes[1] = 0x49
  view.setUint16(2, 42, true)
  view.setUint32(4, ifdOffset, true)
  view.setUint16(ifdOffset, tagCount, true)
  let entry = ifdOffset + 2
  const writeEntry = (tag: number, type: number, count: number, valueOrOffset: number) => {
    view.setUint16(entry, tag, true)
    view.setUint16(entry + 2, type, true)
    view.setUint32(entry + 4, count, true)
    view.setUint32(entry + 8, valueOrOffset, true)
    entry += 12
  }
  writeEntry(256, 4, 1, width)
  writeEntry(257, 4, 1, height)
  writeEntry(258, 3, 4, bitsOffset)
  writeEntry(259, 3, 1, 1)
  writeEntry(262, 3, 1, 2)
  writeEntry(273, 4, 1, pixelOffset)
  writeEntry(277, 3, 1, 4)
  writeEntry(278, 4, 1, height)
  writeEntry(279, 4, 1, pixelBytes)
  writeEntry(284, 3, 1, 1)
  writeEntry(338, 3, 1, extraOffset)
  view.setUint32(entry, 0, true)
  for (let i = 0; i < 4; i++) view.setUint16(bitsOffset + i * 2, 8, true)
  view.setUint16(extraOffset, 2, true)
  bytes.set(new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength), pixelOffset)
  return bytes.buffer
}

export function encodeOpenExrImageData(imageData: ImageData): ArrayBuffer {
  const width = imageData.width
  const height = imageData.height
  assertCanvasSize(width, height, "OpenEXR export")
  const header: number[] = []
  const pushU8 = (value: number) => header.push(value & 255)
  const pushU32 = (value: number) => {
    header.push(value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255)
  }
  const pushI32 = (value: number) => pushU32(value >>> 0)
  const pushF32 = (value: number) => {
    const data = new Uint8Array(4)
    new DataView(data.buffer).setFloat32(0, value, true)
    header.push(...data)
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
  for (const channel of ["R", "G", "B", "A"]) {
    channelCString(channel)
    channelList.push(...u32Bytes(2), 0, 0, 0, 0, ...u32Bytes(1), ...u32Bytes(1))
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

  const scanlineBytes = width * 4 * 4
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
    for (let channel = 0; channel < 4; channel++) {
      for (let x = 0; x < width; x++) {
        const sample = imageData.data[(y * width + x) * 4 + channel] / 255
        view.setFloat32(cursor, sample, true)
        cursor += 4
      }
    }
  }
  return out.buffer
}

export function decodedRasterToCanvas(decoded: DecodedRaster): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = decoded.width
  canvas.height = decoded.height
  canvas.getContext("2d")!.putImageData(decoded.imageData, 0, 0)
  return canvas
}
