"use client"

import type {
AnimationExportFormat,
AppRasterExportFormat,
BrowserRasterExportFormat,
RasterExportOptions,
SvgExportOptions,
} from "./document-io-types"
import { makeIoCanvas,renderDocumentComposite } from "./document-rendering"
import { exportRasterImageDataToBlob } from "./export-worker"
import {
getHighBitExportImage
} from "./high-bit-document"
import {
buildSyntheticIccProfile,
injectIccIntoJpeg,
injectIccIntoPng
} from "./psd-color-modes"
import {
encodeJpegImageData,
encodePngImageData,
encodePnmHighBitImage,
encodePnmImageData,
encodeTgaImageData,
encodeTiffHighBitImageData,
encodeTiffHighBitImageDataAsync,
encodeTiffImageData,
encodeTiffImageDataAsync,
injectAvifIccProfile,
injectAvifXmpMetadata,
injectWebpIccProfile,
injectWebpXmpMetadata,
type RasterExportMetadata,
type TiffCompression
} from "./raster-codecs"
import { planTileOnlyExport } from "./tile-only-export-planning"
import { composeDocumentTile } from "./tile-only-pipeline"
import type {
ColorProfileName,
DocumentReport,
PsDocument
} from "./types"
import { collectEmbeddedTypographyFonts } from "./typography-engine"
import { blobToZipEntry,createStoredZipBlob,type StoredZipEntry } from "./zip-packaging"

import { escapeForCData } from "./document-io-shared"
export function generateDocumentThumbnail(doc: PsDocument, maxWidth = 120): string {
  const composite = renderDocumentComposite(doc, { matte: doc.background ?? "#ffffff" })
  const aspect = doc.height / doc.width
  const thumbW = Math.min(maxWidth, doc.width)
  const thumbH = Math.max(1, Math.round(thumbW * aspect))
  const thumb = makeIoCanvas(thumbW, thumbH)
  const ctx = thumb.getContext("2d")!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "medium"
  ctx.drawImage(composite, 0, 0, thumbW, thumbH)
  return thumb.toDataURL("image/jpeg", 0.6)
}

function scaledCopy(src: HTMLCanvasElement, scale: number, matte?: string) {
  const out = makeIoCanvas(src.width * scale, src.height * scale, matte)
  const ctx = out.getContext("2d")!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(src, 0, 0, out.width, out.height)
  return out
}

export function buildRasterExportCanvas(doc: PsDocument, options: RasterExportOptions) {
  const needsMatte = options.format === "jpeg" || !options.transparent
  const base = renderDocumentComposite(doc, {
    transparent: !needsMatte,
    matte: options.matte,
    colorPurpose: "export",
  })
  const scaled = options.scale === 1 ? base : scaledCopy(base, options.scale, needsMatte ? options.matte : undefined)
  if (!options.dither || options.format === "jpeg") return scaled

  const ctx = scaled.getContext("2d")!
  const img = ctx.getImageData(0, 0, scaled.width, scaled.height)
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue
    const n = (Math.random() - 0.5) * 1.6
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n))
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n))
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n))
  }
  ctx.putImageData(img, 0, 0)
  return scaled
}

export type TileSequenceRasterExportOptions = Omit<RasterExportOptions, "format"> & {
  format: Exclude<BrowserRasterExportFormat, "gif">
  tileSize?: number
}

function tileSequenceExtension(format: TileSequenceRasterExportOptions["format"]) {
  return format === "jpeg" ? "jpg" : format
}

function scaleTileForExport(tile: HTMLCanvasElement, width: number, height: number, matte?: string) {
  if (tile.width === width && tile.height === height) return tile
  const out = makeIoCanvas(width, height, matte)
  const ctx = out.getContext("2d")!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(tile, 0, 0, width, height)
  return out
}

function ditherCanvasInPlace(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue
    const n = (Math.random() - 0.5) * 1.6
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n))
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n))
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n))
  }
  ctx.putImageData(img, 0, 0)
}

async function tileCanvasToBlob(canvas: HTMLCanvasElement, format: TileSequenceRasterExportOptions["format"], quality: number) {
  if (typeof canvas.toBlob === "function") return canvasToBlobAsync(canvas, format, quality)
  return dataUrlToBlob(canvas.toDataURL(rasterMime(format), quality))
}

export async function exportRasterTileSequenceBlob(
  doc: PsDocument,
  options: TileSequenceRasterExportOptions,
): Promise<Blob> {
  const plan = planTileOnlyExport({
    documentWidth: doc.width,
    documentHeight: doc.height,
    tileSize: options.tileSize,
    format: options.format,
    scale: options.scale,
    layers: doc.layers.map((layer) => ({ id: layer.id, kind: layer.kind, visible: layer.visible })),
  })
  if (plan.mode !== "tile-stream") {
    throw new Error(`Tile-only export is unavailable: ${plan.unsupportedLayerIds.join(", ") || "unsupported document"}`)
  }

  const scale = Math.max(0.001, options.scale)
  const needsMatte = options.format === "jpeg" || !options.transparent
  const extension = tileSequenceExtension(options.format)
  const tileEntries: StoredZipEntry[] = []
  const manifestTiles: Array<{ key: string; col: number; row: number; x: number; y: number; w: number; h: number; file: string }> = []

  for (const tile of plan.tiles) {
    const sourceRect = {
      x: tile.rect.x / scale,
      y: tile.rect.y / scale,
      w: tile.rect.w / scale,
      h: tile.rect.h / scale,
    }
    const sourceTile = composeDocumentTile(doc, {
      ...sourceRect,
      transparent: !needsMatte,
      matte: options.matte,
    })
    const outputTile = scaleTileForExport(sourceTile, tile.rect.w, tile.rect.h, needsMatte ? options.matte : undefined)
    if (options.dither && options.format !== "jpeg") ditherCanvasInPlace(outputTile)
    const file = `tiles/${tile.col}_${tile.row}.${extension}`
    tileEntries.push(await blobToZipEntry(file, await tileCanvasToBlob(outputTile, options.format, options.quality)))
    manifestTiles.push({
      key: tile.key,
      col: tile.col,
      row: tile.row,
      x: tile.rect.x,
      y: tile.rect.y,
      w: tile.rect.w,
      h: tile.rect.h,
      file,
    })
  }

  const manifest = {
    version: 1,
    document: {
      id: doc.id,
      name: doc.name,
      width: doc.width,
      height: doc.height,
      outputWidth: plan.outputWidth,
      outputHeight: plan.outputHeight,
      scale,
    },
    format: options.format,
    tileSize: plan.tileSize,
    tileColumns: plan.tileColumns,
    tileRows: plan.tileRows,
    tileCount: plan.tileCount,
    materializesFullDocument: false,
    tiles: manifestTiles,
  }
  const manifestEntry: StoredZipEntry = {
    name: "manifest.json",
    data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  }
  return createStoredZipBlob([manifestEntry, ...tileEntries])
}

export function rasterMime(format: BrowserRasterExportFormat) {
  if (format === "jpeg") return "image/jpeg"
  if (format === "webp") return "image/webp"
  if (format === "avif") return "image/avif"
  if (format === "gif") return "image/gif"
  return "image/png"
}

export interface BrowserRasterEncoderDiagnostic {
  format: BrowserRasterExportFormat
  requestedMime: string
  returnedMime: string
  byteLength: number
  supported: boolean
  message: string
}

export interface BrowserRasterEncoderDiagnosticOptions {
  createCanvas?: () => HTMLCanvasElement
}

export async function diagnoseBrowserRasterEncoderSupport(
  format: BrowserRasterExportFormat,
  options: BrowserRasterEncoderDiagnosticOptions = {},
): Promise<BrowserRasterEncoderDiagnostic> {
  const requestedMime = rasterMime(format)
  const makeCanvas = options.createCanvas ?? (() => document.createElement("canvas"))
  let canvas: HTMLCanvasElement
  try {
    canvas = makeCanvas()
    canvas.width = canvas.width || 1
    canvas.height = canvas.height || 1
  } catch (error) {
    return {
      format,
      requestedMime,
      returnedMime: "",
      byteLength: 0,
      supported: false,
      message: `Could not create a diagnostic canvas: ${(error as Error).message}`,
    }
  }
  if (typeof canvas.toBlob !== "function") {
    return {
      format,
      requestedMime,
      returnedMime: "",
      byteLength: 0,
      supported: false,
      message: "Canvas.toBlob is unavailable in this browser context.",
    }
  }
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, requestedMime, 0.82)
  })
  if (!blob) {
    return {
      format,
      requestedMime,
      returnedMime: "",
      byteLength: 0,
      supported: false,
      message: `${format.toUpperCase()} encoder returned no blob for ${requestedMime}.`,
    }
  }
  const returnedMime = (blob.type || "").toLowerCase()
  const supported = returnedMime === requestedMime || (!returnedMime && blob.size > 0 && format !== "webp" && format !== "avif")
  return {
    format,
    requestedMime,
    returnedMime,
    byteLength: blob.size,
    supported,
    message: supported
      ? `${format.toUpperCase()} encoder returned ${returnedMime || "an untyped blob"} (${formatBytes(blob.size)}).`
      : `${format.toUpperCase()} encoder requested ${requestedMime} but returned ${returnedMime || "an untyped blob"}.`,
  }
}

export function diagnoseBrowserRasterEncoders(
  formats: readonly BrowserRasterExportFormat[] = ["webp", "avif"],
  options: BrowserRasterEncoderDiagnosticOptions = {},
) {
  return Promise.all(formats.map((format) => diagnoseBrowserRasterEncoderSupport(format, options)))
}

export function dataUrlBytes(dataUrl: string) {
  const body = dataUrl.split(",")[1] ?? ""
  return Math.round((body.length * 3) / 4)
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function u16(value: number) {
  return String.fromCharCode(value & 0xff, (value >> 8) & 0xff)
}

function bytesToBinary(bytes: number[]) {
  let out = ""
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.slice(i, i + 8192))
  }
  return out
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)))
  }
  return btoa(binary)
}

function dataUrlFromBytes(mime: string, bytes: Uint8Array) {
  return `data:${mime};base64,${bytesToBase64(bytes)}`
}

export function dataUrlToBytes(dataUrl: string) {
  const body = dataUrl.split(",")[1] ?? ""
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function dataUrlMime(dataUrl: string) {
  return /^data:([^;]+)/i.exec(dataUrl)?.[1]?.toLowerCase() ?? ""
}

function rasterExportOutputProfile(doc: PsDocument): ColorProfileName | null {
  const color = doc.colorManagement
  if (!color) return null
  if (color.proofColors && color.proofProfile !== "None") return color.proofProfile
  return color.workingSpace ?? color.assignedProfile ?? "sRGB IEC61966-2.1"
}

function injectIccIntoRasterBytes(bytes: Uint8Array, format: AppRasterExportFormat, profile: ColorProfileName | null) {
  if (!profile) return bytes
  const icc = buildSyntheticIccProfile(profile)
  if (format === "png") return injectIccIntoPng(bytes, icc, profile)
  if (format === "jpeg") return injectIccIntoJpeg(bytes, icc)
  if (format === "webp") return injectWebpIccProfile(bytes, icc, profile)
  if (format === "avif") return injectAvifIccProfile(bytes, icc, profile)
  return bytes
}

function injectIccIntoRasterDataUrl(dataUrl: string, format: AppRasterExportFormat, profile: ColorProfileName | null) {
  if (!profile || (format !== "png" && format !== "jpeg" && format !== "webp" && format !== "avif")) return dataUrl
  return dataUrlFromBytes(rasterMime(format), injectIccIntoRasterBytes(dataUrlToBytes(dataUrl), format, profile))
}

function textDataUrl(mime: string, text: string) {
  return dataUrlFromBytes(mime, new TextEncoder().encode(text))
}

export function canvasImageData(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

function canvasToTgaDataUrl(canvas: HTMLCanvasElement, rle = false, metadata?: RasterExportMetadata) {
  return dataUrlFromBytes("image/x-tga", new Uint8Array(encodeTgaImageData(canvasImageData(canvas), { rle, metadata })))
}

function canvasToPnmDataUrl(canvas: HTMLCanvasElement, format: "ppm" | "pgm" | "pbm", metadata?: RasterExportMetadata) {
  const mime = format === "ppm" ? "image/x-portable-pixmap" : format === "pgm" ? "image/x-portable-graymap" : "image/x-portable-bitmap"
  return dataUrlFromBytes(mime, new Uint8Array(encodePnmImageData(canvasImageData(canvas), format, { metadata })))
}

function canvasToTiffDataUrl(
  canvas: HTMLCanvasElement,
  compression: Exclude<TiffCompression, "deflate"> = "none",
  metadata?: RasterExportMetadata,
) {
  return dataUrlFromBytes("image/tiff", new Uint8Array(encodeTiffImageData(canvasImageData(canvas), { compression, metadata })))
}

function highBitToTiffDataUrl(image: NonNullable<ReturnType<typeof getHighBitExportImage>>, compression: Exclude<TiffCompression, "deflate"> = "none", metadata?: RasterExportMetadata) {
  return dataUrlFromBytes("image/tiff", new Uint8Array(encodeTiffHighBitImageData(image, { compression, metadata })))
}

function gifPaletteColor(index: number) {
  const r = Math.round((((index >> 5) & 7) / 7) * 255)
  const g = Math.round((((index >> 2) & 7) / 7) * 255)
  const b = Math.round(((index & 3) / 3) * 255)
  return [r, g, b]
}

function encodeGifLzw(indexes: Uint8Array) {
  const minCodeSize = 8
  const clear = 1 << minCodeSize
  const end = clear + 1
  let codeSize = minCodeSize + 1
  let nextCode = end + 1
  let prev: number | null = null
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
  const reset = () => {
    codeSize = minCodeSize + 1
    nextCode = end + 1
    prev = null
  }

  emit(clear)
  for (const index of indexes) {
    emit(index)
    if (prev !== null) {
      nextCode++
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize++
      if (nextCode >= 4095) {
        emit(clear)
        reset()
        continue
      }
    }
    prev = index
  }
  emit(end)
  if (bitCount > 0) bytes.push(bitBuffer & 0xff)
  return bytes
}

export function canvasToGifDataUrl(canvas: HTMLCanvasElement, transparent: boolean) {
  const ctx = canvas.getContext("2d")!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const indexes = new Uint8Array(canvas.width * canvas.height)
  for (let p = 0, i = 0; p < indexes.length; p++, i += 4) {
    if (transparent && img.data[i + 3] < 128) {
      indexes[p] = 0
      continue
    }
    let index = ((img.data[i] >> 5) << 5) | ((img.data[i + 1] >> 5) << 2) | (img.data[i + 2] >> 6)
    if (transparent && index === 0) index = 1
    indexes[p] = index
  }

  const palette: number[] = []
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = i === 0 && transparent ? [0, 0, 0] : gifPaletteColor(i)
    palette.push(r, g, b)
  }
  const lzw = encodeGifLzw(indexes)
  let data = "GIF89a"
  data += u16(canvas.width) + u16(canvas.height)
  data += String.fromCharCode(0xf7, 0, 0)
  data += bytesToBinary(palette)
  data += "!\xf9\x04" + String.fromCharCode(transparent ? 0x01 : 0x00, 0, 0, 0) + "\x00"
  data += "," + u16(0) + u16(0) + u16(canvas.width) + u16(canvas.height) + "\x00"
  data += String.fromCharCode(8)
  for (let i = 0; i < lzw.length; i += 255) {
    const block = lzw.slice(i, i + 255)
    data += String.fromCharCode(block.length) + bytesToBinary(block)
  }
  data += "\x00;"
  return `data:image/gif;base64,${btoa(data)}`
}

export function exportRasterDataUrl(doc: PsDocument, options: RasterExportOptions) {
  const metadata = rasterExportMetadata(doc, options)
  const highBit = getHighBitExportImage(doc, {
    transparent: options.transparent,
    matte: options.matte,
  })
  if (highBit && options.format === "tiff" && options.tiffCompression !== "deflate") {
    return highBitToTiffDataUrl(highBit, options.tiffCompression === "lzw" ? "lzw" : "none", metadata)
  }
  if (highBit && (options.format === "ppm" || options.format === "pgm" || options.format === "pbm")) {
    const mime = options.format === "ppm" ? "image/x-portable-pixmap" : options.format === "pgm" ? "image/x-portable-graymap" : "image/x-portable-bitmap"
    return dataUrlFromBytes(mime, new Uint8Array(encodePnmHighBitImage(highBit, options.format, { metadata })))
  }
  const canvas = buildRasterExportCanvas(doc, options)
  if (options.format === "gif") return canvasToGifDataUrl(canvas, options.transparent)
  if (options.format === "tiff") return canvasToTiffDataUrl(canvas, options.tiffCompression === "lzw" ? "lzw" : "none", metadata)
  if (options.format === "tga") return canvasToTgaDataUrl(canvas, !!options.tgaRle, metadata)
  if (options.format === "ppm" || options.format === "pgm" || options.format === "pbm") {
    return canvasToPnmDataUrl(canvas, options.format, metadata)
  }
  const outputProfile = rasterExportOutputProfile(doc)
  if (options.format === "png" && (options.interlaced || options.includeMetadata)) {
    return injectIccIntoRasterDataUrl(canvas.toDataURL(rasterMime(options.format), options.quality), options.format, outputProfile)
  }
  if (options.format === "jpeg" && (options.progressive || options.includeMetadata)) {
    return injectIccIntoRasterDataUrl(canvas.toDataURL(rasterMime(options.format), options.quality), options.format, outputProfile)
  }
  let dataUrl = canvas.toDataURL(rasterMime(options.format), options.quality)
  // Inject EXIF metadata into JPEG exports
  if (options.format === "jpeg" && options.includeMetadata && doc.metadata) {
    dataUrl = injectJpegExif(dataUrl, doc)
  }
  if (metadata && (options.format === "webp" || options.format === "avif") && dataUrlMime(dataUrl) === rasterMime(options.format)) {
    const bytes = dataUrlToBytes(dataUrl)
    const injected = options.format === "webp"
      ? injectWebpIccProfile(injectWebpXmpMetadata(bytes, metadata), metadata.iccProfile, metadata.iccProfileName)
      : injectAvifIccProfile(injectAvifXmpMetadata(bytes, metadata), metadata.iccProfile, metadata.iccProfileName)
    dataUrl = dataUrlFromBytes(rasterMime(options.format), injected)
  }
  if (metadata?.iccProfile && (options.format === "webp" || options.format === "avif")) return dataUrl
  return injectIccIntoRasterDataUrl(dataUrl, options.format, outputProfile)
}

function dataUrlToBlob(dataUrl: string) {
  const [header, body = ""] = dataUrl.split(",", 2)
  const mime = /^data:([^;]+)/i.exec(header)?.[1] ?? "application/octet-stream"
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function canvasToBlobAsync(canvas: HTMLCanvasElement, format: BrowserRasterExportFormat, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Canvas export returned no blob"))
        return
      }
      try {
        assertBrowserRasterBlob(blob, format)
        resolve(blob)
      } catch (error) {
        reject(error)
      }
    }, rasterMime(format), quality)
  })
}

function assertBrowserRasterBlob(blob: Blob, format: BrowserRasterExportFormat) {
  if (format !== "webp" && format !== "avif") return
  const expected = rasterMime(format)
  const returned = blob.type.toLowerCase()
  if (returned && returned !== expected) {
    throw new Error(`${format.toUpperCase()} encoder is not available in this browser; requested ${expected} but received ${returned}.`)
  }
}

async function postProcessBrowserRasterBlob(
  blob: Blob,
  doc: PsDocument,
  options: RasterExportOptions,
): Promise<Blob> {
  if (options.format !== "webp" && options.format !== "avif") {
    assertBrowserRasterBlob(blob, options.format as BrowserRasterExportFormat)
    return blob
  }
  assertBrowserRasterBlob(blob, options.format)
  const metadata = rasterExportMetadata(doc, options)
  if (!metadata) return blob
  let injected: Uint8Array<ArrayBufferLike> = new Uint8Array(await blob.arrayBuffer())
  injected = options.format === "webp"
    ? injectWebpXmpMetadata(injected, metadata)
    : injectAvifXmpMetadata(injected, metadata)
  injected = options.format === "webp"
    ? injectWebpIccProfile(injected, metadata.iccProfile, metadata.iccProfileName)
    : injectAvifIccProfile(injected, metadata.iccProfile, metadata.iccProfileName)
  return new Blob([injected], { type: rasterMime(options.format) })
}

export function buildRasterExportMetadata(doc: PsDocument, options: RasterExportOptions): RasterExportMetadata | undefined {
  const outputProfile = rasterExportOutputProfile(doc)
  if (!options.includeMetadata && !outputProfile) return undefined
  const metadata = options.metadata ?? {}
  const docMetadata = doc.metadata ?? {}
  const includeMetadata = !!options.includeMetadata
  const fonts = includeMetadata ? collectEmbeddedTypographyFonts(doc) : []
  return {
    title: includeMetadata ? metadata.title ?? docMetadata.title ?? doc.name : undefined,
    author: includeMetadata ? metadata.author ?? docMetadata.author : undefined,
    copyright: includeMetadata ? metadata.copyright ?? docMetadata.copyright : undefined,
    description: includeMetadata ? metadata.description ?? docMetadata.description : undefined,
    creationDate: includeMetadata ? metadata.creationDate ?? docMetadata.createdAt ?? new Date().toISOString() : undefined,
    keywords: includeMetadata ? metadata.keywords ?? docMetadata.keywords : undefined,
    credit: includeMetadata ? metadata.credit ?? docMetadata.credit : undefined,
    source: includeMetadata ? metadata.source ?? docMetadata.source : undefined,
    contentCredentials: includeMetadata ? metadata.contentCredentials ?? docMetadata.contentCredentials : undefined,
    fonts: includeMetadata ? (fonts.length ? fonts : metadata.fonts) : undefined,
    iccProfileName: outputProfile ?? metadata.iccProfileName,
    iccProfile: outputProfile ? buildSyntheticIccProfile(outputProfile) : metadata.iccProfile,
    webp: options.format === "webp"
      ? {
          quality: options.quality,
          lossless: options.webpLossless,
          nearLossless: options.webpNearLossless,
          method: options.webpMethod,
          exactAlpha: options.webpExactAlpha,
          alphaQuality: options.webpAlphaQuality,
          alphaFilter: options.webpAlphaFilter,
          ...metadata.webp,
        }
      : metadata.webp,
    avif: options.format === "avif"
      ? {
          quality: options.quality,
          lossless: options.avifLossless,
          speed: options.avifSpeed,
          bitDepth: options.avifBitDepth,
          chromaSubsampling: options.avifChromaSubsampling,
          tileRowsLog2: options.avifTileRowsLog2,
          tileColsLog2: options.avifTileColsLog2,
          ...metadata.avif,
        }
      : metadata.avif,
    tga: includeMetadata
      ? options.format === "tga"
        ? {
            jobName: options.tgaJobName,
            softwareId: options.tgaSoftwareId,
            aspectRatioNumerator: options.tgaAspectRatioNumerator,
            aspectRatioDenominator: options.tgaAspectRatioDenominator,
            gamma: options.tgaGamma,
            ...metadata.tga,
          }
        : metadata.tga
      : undefined,
    netpbm: includeMetadata
      ? options.format === "ppm" || options.format === "pgm" || options.format === "pbm"
        ? {
            comments: options.netpbmComments,
            sourceMaxValue: options.netpbmSourceMaxValue,
            ...metadata.netpbm,
          }
        : metadata.netpbm
      : undefined,
    xmp: includeMetadata ? metadata.xmp : undefined,
  }
}

function rasterExportMetadata(doc: PsDocument, options: RasterExportOptions): RasterExportMetadata | undefined {
  return buildRasterExportMetadata(doc, options)
}

export async function exportRasterBlob(doc: PsDocument, options: RasterExportOptions): Promise<Blob> {
  const metadata = rasterExportMetadata(doc, options)
  const highBit = getHighBitExportImage(doc, {
    transparent: options.transparent,
    matte: options.matte,
  })
  if (highBit && options.format === "tiff") {
    const buffer = await encodeTiffHighBitImageDataAsync(highBit, { compression: options.tiffCompression ?? "none", metadata })
    return new Blob([buffer], { type: "image/tiff" })
  }
  if (highBit && (options.format === "ppm" || options.format === "pgm" || options.format === "pbm")) {
    const mime = options.format === "ppm" ? "image/x-portable-pixmap" : options.format === "pgm" ? "image/x-portable-graymap" : "image/x-portable-bitmap"
    return new Blob([encodePnmHighBitImage(highBit, options.format, { metadata })], { type: mime })
  }

  const specialCanvasFormats = new Set<AppRasterExportFormat>(["tiff", "tga", "ppm", "pgm", "pbm"])
  const outputProfile = rasterExportOutputProfile(doc)
  if (
    specialCanvasFormats.has(options.format) ||
    (options.format === "png" && (options.interlaced || options.includeMetadata)) ||
    (options.format === "jpeg" && (options.progressive || options.includeMetadata)) ||
    (!!outputProfile && (options.format === "png" || options.format === "jpeg"))
  ) {
    const canvas = buildRasterExportCanvas(doc, options)
    const image = canvasImageData(canvas)
    if (options.format === "tiff") {
      const buffer = await encodeTiffImageDataAsync(image, { compression: options.tiffCompression ?? "none", metadata })
      return new Blob([buffer], { type: "image/tiff" })
    }
    if (options.format === "tga") {
      return new Blob([encodeTgaImageData(image, { rle: !!options.tgaRle, metadata })], { type: "image/x-tga" })
    }
    if (options.format === "ppm" || options.format === "pgm" || options.format === "pbm") {
      const mime = options.format === "ppm" ? "image/x-portable-pixmap" : options.format === "pgm" ? "image/x-portable-graymap" : "image/x-portable-bitmap"
      return new Blob([encodePnmImageData(image, options.format, { metadata })], { type: mime })
    }
    if (options.format === "png") {
      const buffer = await encodePngImageData(image, { interlaced: !!options.interlaced, metadata })
      return new Blob([injectIccIntoRasterBytes(new Uint8Array(buffer), options.format, outputProfile)], { type: "image/png" })
    }
    if (options.format === "jpeg") {
      const buffer = await encodeJpegImageData(image, {
        quality: options.quality,
        progressive: !!options.progressive,
        metadata,
      })
      return new Blob([injectIccIntoRasterBytes(new Uint8Array(buffer), options.format, outputProfile)], { type: "image/jpeg" })
    }
  }

  if (
    options.format === "gif" ||
    (options.format === "jpeg" && options.includeMetadata && doc.metadata)
  ) {
    return dataUrlToBlob(exportRasterDataUrl(doc, options))
  }

  const needsMatte = options.format === "jpeg" || !options.transparent
  const base = renderDocumentComposite(doc, {
    transparent: !needsMatte,
    matte: options.matte,
    colorPurpose: "export",
  })
  const ctx = base.getContext("2d")
  if (ctx) {
    try {
      const image = ctx.getImageData(0, 0, base.width, base.height)
      return await postProcessBrowserRasterBlob(await exportRasterImageDataToBlob(image, options), doc, options)
    } catch {
      // Fall back to the existing synchronous canvas pipeline below.
    }
  }

  const canvas = buildRasterExportCanvas(doc, options)
  if (options.format === "png" || options.format === "jpeg" || options.format === "webp" || options.format === "avif") {
    return postProcessBrowserRasterBlob(await canvasToBlobAsync(canvas, options.format, options.quality), doc, options)
  }
  return dataUrlToBlob(exportRasterDataUrl(doc, options))
}

function documentWithTimelineFrame(doc: PsDocument, frameIndex: number): PsDocument {
  const frame = doc.timelineFrames?.[frameIndex]
  if (!frame) return doc
  return {
    ...doc,
    layers: doc.layers.map((layer) => ({
      ...layer,
      visible: frame.layerVisibility[layer.id] ?? layer.visible,
      opacity: frame.layerOpacity?.[layer.id] ?? layer.opacity,
      fillOpacity: frame.layerFillOpacity?.[layer.id] ?? layer.fillOpacity,
      blendMode: frame.layerBlend?.[layer.id] ?? layer.blendMode,
      style: frame.layerStyle?.[layer.id] === null
        ? undefined
        : frame.layerStyle?.[layer.id] ?? layer.style,
    })),
  }
}

function animationFrameCanvases(
  doc: PsDocument,
  options: Pick<RasterExportOptions, "transparent" | "matte" | "scale">,
) {
  const frames = doc.timelineFrames?.length ? doc.timelineFrames : null
  const count = Math.max(1, frames?.length ?? 1)
  const canvases: Array<{ name: string; durationMs: number; dataUrl: string }> = []
  for (let i = 0; i < count; i++) {
    const frameDoc = documentWithTimelineFrame(doc, i)
    const canvas = buildRasterExportCanvas(frameDoc, {
      format: "png",
      scale: options.scale,
      quality: 1,
      transparent: options.transparent,
      matte: options.matte,
    })
    canvases.push({
      name: frames?.[i]?.name ?? `Frame ${i + 1}`,
      durationMs: frames?.[i]?.durationMs ?? 100,
      dataUrl: canvas.toDataURL("image/png"),
    })
  }
  return canvases
}

/** Exported PNG dataURL sequence helper, used by sidecar/batch tooling. */
export function timelineFrameSequenceDataUrls(
  doc: PsDocument,
  options: Pick<RasterExportOptions, "transparent" | "matte" | "scale">,
) {
  return animationFrameCanvases(doc, options)
}

export async function exportAnimationDataUrl(
  doc: PsDocument,
  format: AnimationExportFormat,
  options: Pick<RasterExportOptions, "transparent" | "matte" | "scale">,
): Promise<string> {
  const { collectAnimationFrames, encodeAnimatedGif, encodeApngFromFrames, encodeAnimatedWebP, bytesToDataUrl } = await import("./animation-encoding")
  const animFrames = collectAnimationFrames(doc, {
    transparent: options.transparent,
    matte: options.matte,
    scale: options.scale,
  })
  const loopCount = doc.timelineSettings?.loopCount ?? 0
  if (format === "gif") {
    const bytes = encodeAnimatedGif(animFrames, { transparent: options.transparent, loopCount })
    return bytesToDataUrl(bytes, "image/gif")
  }
  if (format === "apng") {
    const bytes = await encodeApngFromFrames(animFrames, { loopCount })
    return bytesToDataUrl(bytes, "image/apng")
  }
  if (format === "animated-webp") {
    const bytes = await encodeAnimatedWebP(animFrames, { transparent: options.transparent, loopCount, quality: 0.9 })
    return bytesToDataUrl(bytes, "image/webp")
  }
  // Should not reach here, but as a fallback expose a JSON manifest.
  const payload = {
    app: "Photoshop Web",
    format: "animation-frames",
    document: { name: doc.name, width: doc.width, height: doc.height },
    frames: animFrames.map((frame, index) => ({
      index,
      durationMs: frame.durationMs,
      dataUrl: frame.canvas.toDataURL("image/png"),
    })),
  }
  return textDataUrl("application/json", JSON.stringify(payload, null, 2))
}

export function exportMetadataSidecarDataUrl(doc: PsDocument, report: DocumentReport) {
  const payload = {
    app: "Photoshop Web",
    format: "metadata-sidecar",
    version: 1,
    exportedAt: new Date().toISOString(),
    document: {
      id: doc.id,
      name: doc.name,
      width: doc.width,
      height: doc.height,
      colorMode: doc.colorMode,
      bitDepth: doc.bitDepth,
      dpi: doc.dpi,
      metadata: doc.metadata,
      colorManagement: doc.colorManagement,
      printSettings: doc.printSettings,
      globalLight: doc.globalLight,
      channels: (doc.channels ?? []).map((channel) => ({
        id: channel.id,
        name: channel.name,
        kind: channel.kind ?? "alpha",
        spotColor: channel.spotColor,
        spotOpacity: channel.spotOpacity,
      })),
      layers: doc.layers.map((layer) => {
        const smartSource = layer.smartSource
          ? (() => {
              const { canvas: _canvas, fileHandle: _fileHandle, ...rest } = layer.smartSource!
              return rest
            })()
          : undefined
        return {
          id: layer.id,
          name: layer.name,
          kind: layer.kind,
          visible: layer.visible,
          opacity: layer.opacity,
          fillOpacity: layer.fillOpacity,
          blendMode: layer.blendMode,
          locked: layer.locked,
          colorLabel: layer.colorLabel,
          notes: layer.notes,
          metadata: layer.metadata,
          smartSource,
          smartFilters: layer.smartFilters?.map((filter) => {
            const { mask: _mask, ...rest } = filter
            return { ...rest, hasMask: !!filter.mask }
          }),
        }
      }),
      slices: doc.slices,
      guides: doc.guides,
      timelineFrames: doc.timelineFrames,
      variableDataSets: doc.variableDataSets,
    },
    report,
  }
  return textDataUrl("application/json", JSON.stringify(payload, null, 2))
}

/* ---- EXIF metadata injection for JPEG ---- */

function encodeUtf8(str: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) { bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)) }
    else { bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)) }
  }
  bytes.push(0) // null terminator
  return bytes
}

function writeU16BE(arr: number[], offset: number, value: number) {
  arr[offset] = (value >> 8) & 0xff
  arr[offset + 1] = value & 0xff
}

function writeU32BE(arr: number[], offset: number, value: number) {
  arr[offset] = (value >> 24) & 0xff
  arr[offset + 1] = (value >> 16) & 0xff
  arr[offset + 2] = (value >> 8) & 0xff
  arr[offset + 3] = value & 0xff
}

function buildExifSegment(doc: PsDocument): Uint8Array | null {
  const meta = doc.metadata
  if (!meta) return null
  const entries: Array<{ tag: number; value: string }> = []
  // 0x010E = ImageDescription, 0x013B = Artist, 0x0131 = Software, 0x8298 = Copyright, 0x010D = DocumentName
  if (meta.description) entries.push({ tag: 0x010e, value: meta.description.slice(0, 200) })
  if (meta.author) entries.push({ tag: 0x013b, value: meta.author.slice(0, 100) })
  if (meta.copyright) entries.push({ tag: 0x8298, value: meta.copyright.slice(0, 200) })
  entries.push({ tag: 0x0131, value: "Photoshop Web" })
  if (doc.name) entries.push({ tag: 0x010d, value: doc.name.slice(0, 120) })
  if (!entries.length) return null

  // Build IFD with ASCII string entries
  const ifdEntryCount = entries.length
  const ifdSize = 2 + ifdEntryCount * 12 + 4 // count + entries + next IFD offset
  // Encode all string values
  const encodedValues = entries.map((e) => encodeUtf8(e.value))
  // Calculate total data area size for strings > 4 bytes
  let dataAreaSize = 0
  for (const v of encodedValues) {
    if (v.length > 4) dataAreaSize += v.length
  }

  const _tiffHeaderOffset = 0
  const ifdOffset = 8 // IFD starts right after TIFF header
  const dataAreaOffset = ifdOffset + ifdSize
  const totalTiffSize = dataAreaOffset + dataAreaSize

  // TIFF header + IFD + data
  const tiff = new Array(totalTiffSize).fill(0)
  // TIFF header: "II" (little-endian), 42, offset to IFD (8)
  tiff[0] = 0x4d; tiff[1] = 0x4d // "MM" big-endian
  writeU16BE(tiff, 2, 42)
  writeU32BE(tiff, 4, ifdOffset)

  // IFD
  writeU16BE(tiff, ifdOffset, ifdEntryCount)
  let currentDataOffset = dataAreaOffset
  for (let i = 0; i < entries.length; i++) {
    const entryOffset = ifdOffset + 2 + i * 12
    const val = encodedValues[i]
    writeU16BE(tiff, entryOffset, entries[i].tag) // tag
    writeU16BE(tiff, entryOffset + 2, 2) // type = ASCII
    writeU32BE(tiff, entryOffset + 4, val.length) // count
    if (val.length <= 4) {
      // Store inline
      for (let j = 0; j < val.length; j++) tiff[entryOffset + 8 + j] = val[j]
    } else {
      // Store offset
      writeU32BE(tiff, entryOffset + 8, currentDataOffset)
      for (let j = 0; j < val.length; j++) tiff[currentDataOffset + j] = val[j]
      currentDataOffset += val.length
    }
  }
  // Next IFD offset = 0 (no more IFDs)
  writeU32BE(tiff, ifdOffset + 2 + ifdEntryCount * 12, 0)

  // Build APP1 segment: FF E1 [length] "Exif\0\0" [TIFF data]
  const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] // "Exif\0\0"
  const app1DataLength = 2 + exifHeader.length + totalTiffSize // length field includes itself
  const segment = new Uint8Array(2 + app1DataLength)
  segment[0] = 0xff
  segment[1] = 0xe1
  segment[2] = (app1DataLength >> 8) & 0xff
  segment[3] = app1DataLength & 0xff
  segment.set(exifHeader, 4)
  segment.set(tiff, 4 + exifHeader.length)

  return segment
}

function injectJpegExif(dataUrl: string, doc: PsDocument): string {
  const exifSegment = buildExifSegment(doc)
  if (!exifSegment) return dataUrl

  // Decode base64 JPEG data
  const base64 = dataUrl.split(",")[1]
  if (!base64) return dataUrl
  const binary = atob(base64)
  const jpegBytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) jpegBytes[i] = binary.charCodeAt(i)

  // Verify SOI marker (FF D8)
  if (jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) return dataUrl

  // Insert EXIF APP1 right after SOI (before byte 2)
  const result = new Uint8Array(2 + exifSegment.length + jpegBytes.length - 2)
  result[0] = 0xff
  result[1] = 0xd8
  result.set(exifSegment, 2)
  result.set(jpegBytes.subarray(2), 2 + exifSegment.length)

  // Re-encode as base64 data URL
  let encoded = ""
  for (let i = 0; i < result.length; i += 8192) {
    encoded += String.fromCharCode(...result.subarray(i, Math.min(i + 8192, result.length)))
  }
  return `data:image/jpeg;base64,${btoa(encoded)}`
}

export function exportSvgDataUrl(doc: PsDocument, options: SvgExportOptions) {
  const raster = buildRasterExportCanvas(doc, {
    format: "png",
    scale: options.scale,
    quality: 1,
    transparent: options.transparent,
    matte: options.matte,
  })
  const href = raster.toDataURL("image/png")
  const w = Number((doc.width * options.scale).toFixed(options.precision))
  const h = Number((doc.height * options.scale).toFixed(options.precision))
  // Validate matte is a real CSS color before injecting into markup.
  // Without this an attacker-controlled matte string like
  // `red"><script>...</script><rect fill="` would break out of the
  // attribute and inject arbitrary nodes once the SVG is rendered.
  const safeMatte = isSafeSvgColor(options.matte) ? options.matte : "#ffffff"
  const background = options.transparent
    ? ""
    : `<rect width="100%" height="100%" fill="${safeMatte}"/>`
  // Escape XML-significant characters in the document name; the JSON
  // payload itself is safe inside a CDATA section.
  const metadata = options.includeMetadata
    ? `<metadata><![CDATA[{"name":${JSON.stringify(escapeForCData(doc.name))},"width":${doc.width},"height":${doc.height}}]]></metadata>`
    : ""
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${metadata}${background}<image width="${w}" height="${h}" href="${href}"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/**
 * Accept only obviously-safe CSS color tokens that cannot break out of an
 * SVG attribute context. Hex, rgb()/rgba()/hsl()/hsla() with numeric args,
 * and a small allowlist of named colors.
 */
function isSafeSvgColor(value: string | undefined): value is string {
  if (typeof value !== "string") return false
  const v = value.trim()
  if (!v) return false
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return true
  if (/^(rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/]+\)$/i.test(v)) return true
  if (/^[a-zA-Z]{3,32}$/.test(v)) return true // named colors like "red", "transparent"
  return false
}

/**
 * Project files come from disk and from autosave; their fields land in
 * style={{ background: doc.background }} and similar CSS sinks. Anything
 * that fails the same allow-list as our SVG matte is replaced by the
 * caller-supplied fallback so a malicious project file cannot inject
 * `url(http://attacker/leak)` style tracking pixels.
 */
export function cleanCssColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback
  return isSafeSvgColor(value) ? value : fallback
}

/**
 * Optional sibling: returns undefined when the input is not a safe color,
 * for fields where the canvas / engine treats undefined and a default
 * differently.
 */
export function cleanOptionalCssColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return isSafeSvgColor(value) ? value : undefined
}

/** True if `set.has(value)`, narrowing `value` to the set's element type. */
export function isAllowedEnum<T extends string>(value: unknown, allowed: ReadonlySet<T>): value is T {
  return typeof value === "string" && (allowed as ReadonlySet<string>).has(value)
}
