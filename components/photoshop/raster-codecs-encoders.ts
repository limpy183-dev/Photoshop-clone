import { assertCanvasSize } from "./canvas-limits"
import type { HighBitImage } from "./color-pipeline"
import {
  asciiBytes,
  cleanMetadataText,
  concatUint8,
  deflateZlib,
  exactArrayBuffer,
  highBitSampleUnit,
  latin1Bytes,
  pngChunk,
  u32BE,
} from "./raster-codec-utils"
import {
  buildXmpPacket,
  bytesFromInput,
  c2paJsonLdBytesFromRasterMetadata,
  c2paManifestStoreFromRasterMetadata,
  ICC_UUID,
  injectAvifIccProfile,
  injectAvifXmpMetadata,
  insertJpegC2paManifest,
  insertJpegXmp,
  mp4Box,
  XMP_UUID,
  xmpPacketFromRasterMetadata,
} from "./raster-metadata-embeds"
import { TGA_DEVELOPER_PREFIX, TGA_DEVELOPER_TAG_METADATA, TGA_SIGNATURE } from "./raster-codecs-internal"
import type {
  HeicEncodeOptions,
  HeifEncodeOptions,
  JpegEncodeOptions,
  PngEncodeOptions,
  PnmEncodeOptions,
  PnmExportFormat,
  RasterExportMetadata,
  TgaEncodeOptions,
} from "./raster-codecs-types"

function sameRgba(data: Uint8ClampedArray, a: number, b: number) {
  return data[a] === data[b] && data[a + 1] === data[b + 1] && data[a + 2] === data[b + 2] && data[a + 3] === data[b + 3]
}

function pushTgaPixel(out: number[], data: Uint8ClampedArray, offset: number) {
  out.push(data[offset + 2], data[offset + 1], data[offset], data[offset + 3])
}

function fixedLatin1(value: string | undefined, length: number) {
  const out = new Uint8Array(length)
  const clean = cleanMetadataText(value, length - 1)
  for (let i = 0; i < clean.length && i < length - 1; i++) out[i] = clean.charCodeAt(i) & 255
  return out
}

function tgaDateParts(value: string | undefined) {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return null
  return [
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCFullYear(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ]
}

function writeTgaRational(view: DataView, offset: number, numerator: number | undefined, denominator: number | undefined) {
  if (
    typeof numerator !== "number" ||
    typeof denominator !== "number" ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    numerator <= 0 ||
    denominator <= 0
  ) {
    view.setUint16(offset, 0, true)
    view.setUint16(offset + 2, 0, true)
    return
  }
  view.setUint16(offset, Math.max(1, Math.min(0xffff, Math.round(numerator))), true)
  view.setUint16(offset + 2, Math.max(1, Math.min(0xffff, Math.round(denominator))), true)
}

function buildTgaMetadataBlocks(metadata: RasterExportMetadata | undefined) {
  if (!metadata) return null
  const extension = new Uint8Array(495)
  const view = new DataView(extension.buffer)
  view.setUint16(0, 495, true)
  extension.set(fixedLatin1(metadata.author, 41), 2)
  const comment = cleanMetadataText(metadata.description, 320)
  for (let line = 0; line < 4; line++) {
    extension.set(fixedLatin1(comment.slice(line * 80, line * 80 + 80), 81), 43 + line * 81)
  }
  const dateParts = tgaDateParts(metadata.creationDate)
  if (dateParts) dateParts.forEach((part, index) => view.setUint16(367 + index * 2, part, true))
  extension.set(fixedLatin1(metadata.tga?.jobName ?? metadata.title ?? metadata.source, 41), 379)
  extension.set(fixedLatin1(metadata.tga?.softwareId ?? "Photoshop Web", 41), 426)
  view.setUint16(467, 1, true)
  extension[469] = " ".charCodeAt(0)
  writeTgaRational(view, 474, metadata.tga?.aspectRatioNumerator, metadata.tga?.aspectRatioDenominator)
  if (typeof metadata.tga?.gamma === "number" && Number.isFinite(metadata.tga.gamma) && metadata.tga.gamma > 0) {
    writeTgaRational(view, 478, Math.round(metadata.tga.gamma * 1000), 1000)
  } else {
    writeTgaRational(view, 478, undefined, undefined)
  }
  extension[494] = 4

  const developerPayload = new TextEncoder().encode(`${TGA_DEVELOPER_PREFIX}${JSON.stringify({
    title: metadata.title,
    author: metadata.author,
    description: metadata.description,
    copyright: metadata.copyright,
    creationDate: metadata.creationDate,
    source: metadata.source,
    keywords: metadata.keywords,
    credit: metadata.credit,
    contentCredentials: metadata.contentCredentials,
    iccProfileName: metadata.iccProfileName,
    tga: metadata.tga,
  })}`)
  const developer = new Uint8Array(2 + 10 + developerPayload.byteLength)
  const devView = new DataView(developer.buffer)
  devView.setUint16(0, 1, true)
  devView.setUint16(2, TGA_DEVELOPER_TAG_METADATA, true)
  devView.setUint32(4, 0, true)
  devView.setUint32(8, developerPayload.byteLength, true)
  developer.set(developerPayload, 12)

  return { extension, developer }
}

function appendTgaMetadata(bytes: Uint8Array, metadata: RasterExportMetadata | undefined) {
  const blocks = buildTgaMetadataBlocks(metadata)
  if (!blocks) return bytes
  const extensionOffset = bytes.byteLength
  const developerOffset = extensionOffset + blocks.extension.byteLength
  new DataView(blocks.developer.buffer).setUint32(4, developerOffset + 12, true)
  const footer = new Uint8Array(26)
  const footerView = new DataView(footer.buffer)
  footerView.setUint32(0, extensionOffset, true)
  footerView.setUint32(4, developerOffset, true)
  footer.set(asciiBytes(TGA_SIGNATURE), 8)
  return concatUint8([bytes, blocks.extension, blocks.developer, footer])
}

export function encodeTgaImageData(imageData: ImageData, options: TgaEncodeOptions = {}): ArrayBuffer {
  const width = imageData.width
  const height = imageData.height
  assertCanvasSize(width, height, "TGA export")
  if (width > 0xffff || height > 0xffff) throw new Error("TGA export is limited to 65535 px per side.")
  const header = new Uint8Array(18)
  header[2] = options.rle ? 10 : 2
  header[12] = width & 255
  header[13] = (width >>> 8) & 255
  header[14] = height & 255
  header[15] = (height >>> 8) & 255
  header[16] = 32
  header[17] = 0x28
  const data = imageData.data
  if (!options.rle) {
    const body = new Uint8Array(width * height * 4)
    let out = 0
    for (let i = 0; i < data.length; i += 4) {
      body[out++] = data[i + 2]
      body[out++] = data[i + 1]
      body[out++] = data[i]
      body[out++] = data[i + 3]
    }
    return exactArrayBuffer(appendTgaMetadata(concatUint8([header, body]), options.metadata))
  }

  const body: number[] = []
  const total = width * height
  let pixel = 0
  while (pixel < total) {
    const offset = pixel * 4
    let run = 1
    while (pixel + run < total && run < 128 && sameRgba(data, offset, (pixel + run) * 4)) run++
    if (run >= 2) {
      body.push(0x80 | (run - 1))
      pushTgaPixel(body, data, offset)
      pixel += run
      continue
    }

    const rawStart = pixel
    pixel++
    while (pixel < total && pixel - rawStart < 128) {
      const current = pixel * 4
      const repeated = pixel + 1 < total && sameRgba(data, current, (pixel + 1) * 4)
      if (repeated) break
      pixel++
    }
    body.push(pixel - rawStart - 1)
    for (let p = rawStart; p < pixel; p++) pushTgaPixel(body, data, p * 4)
  }
  return exactArrayBuffer(appendTgaMetadata(concatUint8([header, new Uint8Array(body)]), options.metadata))
}

function pnmCommentLines(metadata: RasterExportMetadata | undefined, sourceMaxValue: number | undefined) {
  if (!metadata && !sourceMaxValue) return []
  const lines: string[] = []
  const push = (value: string | undefined) => {
    const clean = value?.replace(/[\r\n]+/g, " ").trim()
    if (clean) lines.push(clean.slice(0, 240))
  }
  push(metadata?.title ? `Title: ${metadata.title}` : undefined)
  push(metadata?.author ? `Author: ${metadata.author}` : undefined)
  push(metadata?.description)
  push(metadata?.copyright ? `Copyright: ${metadata.copyright}` : undefined)
  push(metadata?.source ? `Source: ${metadata.source}` : undefined)
  for (const comment of metadata?.netpbm?.comments ?? []) push(comment)
  if (sourceMaxValue) push(`Source-MaxValue: ${sourceMaxValue}`)
  return lines
}

function pnmSourceMaxValue(metadata: RasterExportMetadata | undefined, fallback: number, explicit?: number) {
  const value = explicit ?? metadata?.netpbm?.sourceMaxValue
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(65535, Math.round(value)))
}

export function encodePnmImageData(imageData: ImageData, format: PnmExportFormat, options: PnmEncodeOptions = {}): ArrayBuffer {
  const width = imageData.width
  const height = imageData.height
  assertCanvasSize(width, height, `${format.toUpperCase()} export`)
  const maxValue = format === "pbm" ? 1 : pnmSourceMaxValue(options.metadata, 255, options.sourceMaxValue)
  const comments = pnmCommentLines(options.metadata, format === "pbm" ? options.metadata?.netpbm?.sourceMaxValue : maxValue)
  const commentBlock = comments.map((line) => `# ${line}\n`).join("")
  const header =
    format === "ppm"
      ? `P6\n${commentBlock}${width} ${height}\n${maxValue}\n`
      : format === "pgm"
        ? `P5\n${commentBlock}${width} ${height}\n${maxValue}\n`
        : `P4\n${commentBlock}${width} ${height}\n`
  const headerBytes = asciiBytes(header)
  const bytesPerSample = maxValue > 255 ? 2 : 1
  const body =
    format === "ppm"
      ? new Uint8Array(width * height * 3 * bytesPerSample)
      : format === "pgm"
        ? new Uint8Array(width * height * bytesPerSample)
        : new Uint8Array(Math.ceil(width / 8) * height)

  const writeSample = (value: number, out: number) => {
    const sample = Math.max(0, Math.min(maxValue, Math.round((value / 255) * maxValue)))
    if (bytesPerSample === 2) {
      body[out++] = (sample >>> 8) & 255
      body[out++] = sample & 255
      return out
    }
    body[out++] = sample
    return out
  }

  if (format === "ppm") {
    for (let p = 0, i = 0, o = 0; p < width * height; p++, i += 4) {
      o = writeSample(imageData.data[i], o)
      o = writeSample(imageData.data[i + 1], o)
      o = writeSample(imageData.data[i + 2], o)
    }
  } else if (format === "pgm") {
    for (let p = 0, i = 0, o = 0; p < width * height; p++, i += 4) {
      o = writeSample(Math.round(0.299 * imageData.data[i] + 0.587 * imageData.data[i + 1] + 0.114 * imageData.data[i + 2]), o)
    }
  } else {
    const stride = Math.ceil(width / 8)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const gray = 0.299 * imageData.data[i] + 0.587 * imageData.data[i + 1] + 0.114 * imageData.data[i + 2]
        if (gray < 128) body[y * stride + (x >> 3)] |= 0x80 >> (x & 7)
      }
    }
  }

  return exactArrayBuffer(concatUint8([headerBytes, body]))
}

export function encodePnmHighBitImage(image: HighBitImage, format: PnmExportFormat, options: PnmEncodeOptions = {}): ArrayBuffer {
  const width = image.width
  const height = image.height
  assertCanvasSize(width, height, `${format.toUpperCase()} export`)
  if (format === "pbm") {
    return encodePnmImageData(new ImageData(new Uint8ClampedArray(toneMapHighBitTo8BitBytes(image)), width, height), "pbm", options)
  }
  const defaultMaxValue = image.bitDepth === 16 || image.storage === "uint16" || image.storage === "float32" ? 65535 : 255
  const maxValue = pnmSourceMaxValue(options.metadata, defaultMaxValue, options.sourceMaxValue)
  const commentBlock = pnmCommentLines(options.metadata, maxValue).map((line) => `# ${line}\n`).join("")
  const header = format === "ppm"
    ? `P6\n${commentBlock}${width} ${height}\n${maxValue}\n`
    : `P5\n${commentBlock}${width} ${height}\n${maxValue}\n`
  const headerBytes = asciiBytes(header)
  const samples = format === "ppm" ? 3 : 1
  const bytesPerSample = maxValue > 255 ? 2 : 1
  const body = new Uint8Array(width * height * samples * bytesPerSample)
  let out = 0
  for (let p = 0, i = 0; p < width * height; p++, i += 4) {
    const values = format === "ppm"
      ? [highBitSampleUnit(image, i), highBitSampleUnit(image, i + 1), highBitSampleUnit(image, i + 2)]
      : [0.299 * highBitSampleUnit(image, i) + 0.587 * highBitSampleUnit(image, i + 1) + 0.114 * highBitSampleUnit(image, i + 2)]
    for (const value of values) {
      const sample = Math.max(0, Math.min(maxValue, Math.round(value * maxValue)))
      if (bytesPerSample === 2) {
        body[out++] = (sample >>> 8) & 255
        body[out++] = sample & 255
      } else {
        body[out++] = sample
      }
    }
  }
  return exactArrayBuffer(concatUint8([headerBytes, body]))
}

function toneMapHighBitTo8BitBytes(image: HighBitImage) {
  const bytes = new Uint8ClampedArray(image.width * image.height * 4)
  for (let i = 0; i < bytes.length; i += 4) {
    bytes[i] = Math.round(highBitSampleUnit(image, i) * 255)
    bytes[i + 1] = Math.round(highBitSampleUnit(image, i + 1) * 255)
    bytes[i + 2] = Math.round(highBitSampleUnit(image, i + 2) * 255)
    bytes[i + 3] = Math.round(highBitSampleUnit(image, i + 3) * 255)
  }
  return bytes
}

function textMetadataChunks(metadata: RasterExportMetadata | undefined): Uint8Array[] {
  if (!metadata) return []
  const pairs: Array<[string, string | undefined]> = [
    ["Author", metadata.author],
    ["Copyright", metadata.copyright],
    ["Description", metadata.description],
    ["Creation Time", metadata.creationDate],
  ]
  const chunks: Uint8Array[] = []
  for (const [keyword, value] of pairs) {
    if (!value) continue
    chunks.push(pngChunk("tEXt", concatUint8([latin1Bytes(keyword), new Uint8Array([0]), latin1Bytes(value.slice(0, 2048))])))
  }
  const xmp = metadata.xmp ?? buildXmpPacket(metadata)
  if (xmp) {
    const keyword = asciiBytes("XML:com.adobe.xmp")
    const separators = new Uint8Array([0, 0, 0, 0, 0])
    chunks.push(pngChunk("iTXt", concatUint8([keyword, separators, new TextEncoder().encode(xmp)])))
  }
  return chunks
}

function pngScanlines(imageData: ImageData, interlaced: boolean): Uint8Array {
  const width = imageData.width
  const height = imageData.height
  const data = imageData.data
  if (!interlaced) {
    const stride = width * 4
    const out = new Uint8Array((stride + 1) * height)
    for (let y = 0; y < height; y++) {
      out[y * (stride + 1)] = 0
      out.set(data.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1)
    }
    return out
  }

  const passes = [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2],
  ] as const
  const parts: Uint8Array[] = []
  for (const [x0, y0, dx, dy] of passes) {
    if (x0 >= width || y0 >= height) continue
    const passWidth = Math.floor((width - 1 - x0) / dx) + 1
    const passHeight = Math.floor((height - 1 - y0) / dy) + 1
    const rowBytes = passWidth * 4
    const pass = new Uint8Array((rowBytes + 1) * passHeight)
    let out = 0
    for (let py = 0; py < passHeight; py++) {
      pass[out++] = 0
      const y = y0 + py * dy
      for (let px = 0; px < passWidth; px++) {
        const x = x0 + px * dx
        const src = (y * width + x) * 4
        pass[out++] = data[src]
        pass[out++] = data[src + 1]
        pass[out++] = data[src + 2]
        pass[out++] = data[src + 3]
      }
    }
    parts.push(pass)
  }
  return concatUint8(parts)
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function buildC2paItxtChunk(metadata: RasterExportMetadata | undefined): Uint8Array | undefined {
  const json = c2paJsonLdBytesFromRasterMetadata(metadata)
  if (!json) return undefined
  // iTXt: keyword \0 compressionFlag(0) compressionMethod(0) languageTag \0 translatedKeyword \0 text
  const keyword = asciiBytes("c2pa")
  const separators = new Uint8Array([0, 0, 0, 0, 0])
  return pngChunk("iTXt", concatUint8([keyword, separators, json]))
}

export async function encodePngImageData(imageData: ImageData, options: PngEncodeOptions = {}): Promise<ArrayBuffer> {
  const width = imageData.width
  const height = imageData.height
  assertCanvasSize(width, height, "PNG export")
  const ihdr = new Uint8Array(13)
  ihdr.set(u32BE(width), 0)
  ihdr.set(u32BE(height), 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = options.interlaced ? 1 : 0
  const compressed = await deflateZlib(pngScanlines(imageData, !!options.interlaced))
  const c2pa = c2paManifestStoreFromRasterMetadata(options.metadata)
  const c2paItxt = buildC2paItxtChunk(options.metadata)
  return exactArrayBuffer(concatUint8([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    ...textMetadataChunks(options.metadata),
    ...(c2paItxt ? [c2paItxt] : []),
    ...(c2pa ? [pngChunk("caBX", c2pa)] : []),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array(0)),
  ]))
}

async function loadMozJpegEncoder() {
  if (typeof window !== "undefined") {
    const mod = await import("@jsquash/jpeg/encode.js")
    return { default: mod.default as (data: ImageData, options?: Record<string, unknown>) => Promise<ArrayBuffer> }
  }
  const nodeAdapter = await import(/* webpackIgnore: true */ "./raster-codecs.node")
  return nodeAdapter.loadNodeMozJpegEncoder()
}

export async function encodeJpegImageData(imageData: ImageData, options: JpegEncodeOptions = {}): Promise<ArrayBuffer> {
  assertCanvasSize(imageData.width, imageData.height, "JPEG export")
  const quality = Math.max(1, Math.min(100, Math.round((options.quality ?? 0.92) <= 1 ? (options.quality ?? 0.92) * 100 : options.quality ?? 92)))
  const { default: encode } = await loadMozJpegEncoder()
  const encoded = await encode(imageData, {
    quality,
    progressive: options.progressive !== false,
    baseline: options.progressive === false,
  })
  const withXmp = insertJpegXmp(new Uint8Array(encoded), options.metadata)
  return exactArrayBuffer(insertJpegC2paManifest(withXmp, options.metadata))
}

function imageDataToCanvas(imageData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = imageData.width
  canvas.height = imageData.height
  canvas.getContext("2d")!.putImageData(imageData, 0, 0)
  return canvas
}

function canvasToBlobPromise(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") {
      reject(new Error(`${mime} export requires a browser canvas encoder.`))
      return
    }
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error(`${mime} export is not supported by this browser.`))
    }, mime, quality)
  })
}

export async function encodeHeifImageData(imageData: ImageData, options: HeifEncodeOptions = {}): Promise<ArrayBuffer> {
  assertCanvasSize(imageData.width, imageData.height, "HEIF export")
  const quality = Math.max(0.01, Math.min(1, options.quality ?? 0.92))
  const metadata: RasterExportMetadata | undefined = options.metadata
    ? {
        ...options.metadata,
        avif: {
          quality,
          lossless: options.lossless ?? options.metadata.avif?.lossless,
          speed: options.speed ?? options.metadata.avif?.speed,
          bitDepth: options.bitDepth ?? options.metadata.avif?.bitDepth,
          chromaSubsampling: options.chromaSubsampling ?? options.metadata.avif?.chromaSubsampling,
          tileRowsLog2: options.tileRowsLog2 ?? options.metadata.avif?.tileRowsLog2,
          tileColsLog2: options.tileColsLog2 ?? options.metadata.avif?.tileColsLog2,
        },
      }
    : undefined
  const encodeOptions = {
    quality,
    lossless: options.lossless,
    speed: options.speed,
    bitDepth: options.bitDepth,
    chromaSubsampling: options.chromaSubsampling,
    tileRowsLog2: options.tileRowsLog2,
    tileColsLog2: options.tileColsLog2,
  }
  if (options.encodeAvif) {
    const encodedBytes = bytesFromInput(await options.encodeAvif(imageData, encodeOptions))
    const xmpBytes = injectAvifXmpMetadata(encodedBytes, metadata)
    return exactArrayBuffer(injectAvifIccProfile(xmpBytes, metadata?.iccProfile, metadata?.iccProfileName))
  }
  const blob = await canvasToBlobPromise(imageDataToCanvas(imageData), "image/avif", quality)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const xmpBytes = injectAvifXmpMetadata(bytes, metadata)
  return exactArrayBuffer(injectAvifIccProfile(xmpBytes, metadata?.iccProfile, metadata?.iccProfileName))
}

function injectHeifUuidMetadata(input: Uint8Array, metadata: RasterExportMetadata | undefined): Uint8Array {
  const chunks: Uint8Array[] = [input]
  const xmp = xmpPacketFromRasterMetadata(metadata)
  if (xmp) chunks.push(mp4Box("uuid", concatUint8([XMP_UUID, new TextEncoder().encode(xmp)])))
  if (metadata?.iccProfile?.byteLength) {
    const header = new TextEncoder().encode(`Photoshop Web ICC\0${metadata.iccProfileName ?? "ICC profile"}\0`)
    chunks.push(mp4Box("uuid", concatUint8([ICC_UUID, header, metadata.iccProfile])))
  }
  return chunks.length === 1 ? input : concatUint8(chunks)
}

export async function encodeHeicImageData(imageData: ImageData, options: HeicEncodeOptions = {}): Promise<ArrayBuffer> {
  assertCanvasSize(imageData.width, imageData.height, "HEIC export")
  if (!options.encodeHevc) {
    throw new Error("HEIC export requires an HEVC encoder callback; use encodeHeifImageData for AVIF-backed HEIF output.")
  }
  const quality = Math.max(0.01, Math.min(1, options.quality ?? 0.92))
  const encoded = await options.encodeHevc(imageData, {
    quality,
    lossless: options.lossless,
    speed: options.speed,
    bitDepth: options.bitDepth,
    chromaSubsampling: options.chromaSubsampling,
  })
  const bitstream = bytesFromInput(encoded instanceof Uint8Array || encoded instanceof ArrayBuffer ? encoded : encoded.bitstream)
  const decoderConfig = encoded instanceof Uint8Array || encoded instanceof ArrayBuffer
    ? new Uint8Array([1, 1, 0x60, 0, 0, 0])
    : bytesFromInput(encoded.decoderConfig ?? new Uint8Array([1, 1, 0x60, 0, 0, 0]))
  const metadata: RasterExportMetadata | undefined = options.metadata
    ? {
      ...options.metadata,
      avif: undefined,
    }
    : undefined
  const ftyp = mp4Box("ftyp", concatUint8([
    asciiBytes("heic"),
    new Uint8Array([0, 0, 0, 0]),
    asciiBytes("heic"),
    asciiBytes("mif1"),
    asciiBytes("hevc"),
  ]))
  const imageProperties = mp4Box("iprp", concatUint8([
    mp4Box("ipco", concatUint8([
      mp4Box("ispe", concatUint8([new Uint8Array([0, 0, 0, 0]), u32BE(imageData.width), u32BE(imageData.height)])),
      mp4Box("hvcC", decoderConfig),
      mp4Box("pixi", new Uint8Array([0, 0, 0, 0, 3, options.bitDepth ?? 8, options.bitDepth ?? 8, options.bitDepth ?? 8])),
    ])),
    mp4Box("ipma", concatUint8([new Uint8Array([0, 0, 0, 0, 1, 0, 1, 3, 0x81, 0x82, 0x83])])),
  ]))
  const meta = mp4Box("meta", concatUint8([
    new Uint8Array([0, 0, 0, 0]),
    mp4Box("hdlr", concatUint8([new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]), asciiBytes("pict"), new Uint8Array(12), asciiBytes("Photoshop Web HEIC\0")])),
    mp4Box("pitm", new Uint8Array([0, 0, 0, 0, 0, 1])),
    mp4Box("iinf", concatUint8([new Uint8Array([0, 0, 0, 0, 0, 1]), mp4Box("infe", concatUint8([new Uint8Array([2, 0, 0, 0, 0, 1, 0, 0]), asciiBytes("hvc1"), asciiBytes("HEVC primary image\0")]))])),
    imageProperties,
    mp4Box("iloc", new Uint8Array([0, 0, 0, 0, 0x44, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0])),
  ]))
  const mdat = mp4Box("mdat", bitstream)
  return exactArrayBuffer(injectHeifUuidMetadata(concatUint8([ftyp, meta, mdat]), metadata))
}
