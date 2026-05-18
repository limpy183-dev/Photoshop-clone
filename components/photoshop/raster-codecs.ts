import { assertCanvasSize } from "./canvas-limits"


export interface DecodedRaster {
  format: "TGA" | "PNM" | "TIFF"
  width: number
  height: number
  bitDepth: number
  channels: number
  colorModel: "RGB" | "Grayscale" | "Indexed"
  compression: "none" | "rle"
  imageData: ImageData
  warnings: string[]
  metadata?: Record<string, string | number | boolean>
}

export interface ExrInspection {
  magic: boolean
  version?: number
  pixelDecoded: false
  warnings: string[]
}

const textDecoder = new TextDecoder("ascii")
const clamp8 = (value: number) => Math.max(0, Math.min(255, Math.round(value)))

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

function scaleSample(value: number, maxValue: number) {
  if (maxValue <= 0) return 0
  return clamp8((value / maxValue) * 255)
}

export function decodeAdvancedRasterBuffer(buffer: ArrayBuffer, name = ""): DecodedRaster | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
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
  return {
    magic,
    version: magic && bytes.length >= 5 ? bytes[4] : undefined,
    pixelDecoded: false,
    warnings: magic
      ? ["OpenEXR magic header detected, but pixel import still requires a dedicated OpenEXR codec for half-float channels, compression, multipart data, and scene-linear color."]
      : ["OpenEXR magic header was not found."],
  }
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

export function decodedRasterToCanvas(decoded: DecodedRaster): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = decoded.width
  canvas.height = decoded.height
  canvas.getContext("2d")!.putImageData(decoded.imageData, 0, 0)
  return canvas
}
