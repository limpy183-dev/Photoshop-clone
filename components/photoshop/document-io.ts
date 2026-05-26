"use client"

/* File System Access API type augmentation — not yet in TS standard lib */
declare global {
  interface Window {
    showSaveFilePicker?: (options?: {
      suggestedName?: string
      types?: Array<{ description?: string; accept: Record<string, string[]> }>
    }) => Promise<FileSystemFileHandle>
  }
}

import { compositeLayer } from "./blend-modes"
import { getFilter } from "./filters"
import { applyLayerStyle } from "./layer-styles"
import { applyLuminanceMaskToCanvas, normalizeAdvancedBlending } from "./layer-workflows"
import { applyModeAndColorManagement } from "./advanced-subsystems"
import { isAdjustmentNoop } from "./adjustment-layers"
import { smartFilterMaskAmountAt, smartFilterMaskToImageData } from "./smart-filter-masks"
import { capabilityWarningsForDocument } from "./capabilities"
import {
  MAX_PROJECT_CHANNELS,
  MAX_PROJECT_DATA_URL_CHARS,
  MAX_PROJECT_LAYERS,
  MAX_PSD_FILE_BYTES,
  MAX_RASTER_FILE_BYTES,
  assertCanvasSize,
  assertFileSize,
  canvasSizeError,
} from "./canvas-limits"
import type {
  AlphaChannel,
  BlendMode,
  ColorProfileName,
  DocumentMetadata,
  DocumentModeSettings,
  DocumentReport,
  Guide,
  Layer,
  PsdParsedStructureMetadata,
  PsDocument,
  Selection,
  SmartFilter,
} from "./types"
import type {
  BlendMode as PsdBlendMode,
  ImageResources,
  Layer as PsdLayer,
  LayerColor,
  PixelData,
  Psd,
} from "ag-psd"
import {
  appBitDepthToPsd,
  appColorModeToPsd,
  applyIccProfileToPsd,
  buildSyntheticIccProfile,
  COLOR_MODE_CAPABILITY,
  extractIccProfile,
  injectIccIntoJpeg,
  injectIccIntoPng,
  psdBitDepthToApp,
  psdColorModeData,
  psdColorModeToApp,
} from "./psd-color-modes"
import {
  EFFECTS_ADJUSTMENTS_CAPABILITY,
  appAdjustmentToPsdLayer,
  appAdvancedBlendingToPsd,
  appSmartFiltersToPsd,
  layerStyleToPsdEffects,
  psdEffectsToLayerStyle,
  psdLayerToAppAdjustment,
  psdToAppAdvancedBlending,
  psdToAppSmartFilters,
} from "./psd-effects-adjustments"
import {
  VECTOR_TEXT_CAPABILITY,
  appPathsToPsdResources,
  appShapeToPsd,
  appTextToPsd,
  decodeShapeMarker,
  psdResourceToAppPaths,
  psdShapeToApp,
  psdTextToApp,
  stripMarkers,
} from "./psd-vector-text"
import {
  CHANNELS_MASKS_CAPABILITY,
  appAlphaChannelsToMarkerLayers,
  appAlphaChannelsToPsd,
  appClippingToPsd,
  appLayerMaskToPsd,
  appVectorMaskOnLayerToPsd,
  isAlphaChannelMarkerLayer,
  psdAlphaChannelsToApp,
  psdLayerMaskToApp,
  psdVectorMaskOnLayerToApp,
  validateClippingGroup,
} from "./psd-channels-masks"
import {
  RESOURCES_METADATA_CAPABILITY,
  appGlobalLightToPsdResources,
  appGuidesToPsd,
  appLayerCompsToPsd,
  appMetadataToPsdResources,
  appNotesToPsd,
  appPrintSettingsToPsdResources,
  appResolutionToPsd,
  appSlicesToPsd,
  appSmartObjectToPsdLayer,
  psdGlobalLightToApp,
  psdGuidesToApp,
  psdLayerCompsToApp,
  psdMetadataToApp,
  psdNotesToApp,
  psdPrintSettingsToApp,
  psdResolutionToApp,
  psdSlicesToApp,
  psdSmartObjectToAppLayer,
} from "./psd-resources-metadata"
import { uid } from "./uid"
import { exportRasterImageDataToBlob } from "./export-worker"
import { composeDocumentTile, planTileOnlyExport } from "./tile-only-pipeline"
import { collectEmbeddedTypographyFonts } from "./typography-engine"
import { TiledBackingStore } from "./tiled-backing-store"
import { PSB_TILE_VIEW_LAYER_ID, PSB_TILE_VIEW_SOURCE_VERSION, registerPsbTileViewStore } from "./psb-tile-view"
import { blobToZipEntry, createStoredZipBlob, type StoredZipEntry } from "./zip-packaging"
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
  planPsbLargeDocumentOpen,
  type RasterExportMetadata,
  type TiffCompression,
} from "./raster-codecs"
import { planLargeDocumentOpen, type LargeDocumentOpenMode } from "./large-document"
import {
  applyPsdAppPreservationPayload,
  createPsdNativeSourceSnapshot,
  createPsdAppPreservationPayload,
  createPsdRepairPlanFromParsedPsd,
  embedPsdAppPreservationInXmp,
  extractPsdAppPreservationFromXmp,
  restorePsdNativeSourceSnapshot,
} from "./psd-compatibility"
import {
  deserializeHighBitImagePayload,
  getHighBitExportImage,
  getLayerHighBitImage,
  renderDocumentHighBitPreviewCanvas,
  serializeHighBitImagePayload,
  type HighBitDocument,
  type HighBitLayer,
} from "./high-bit-document"
import {
  canWriteNativeLayeredPsd,
  writeNativeCompositePsd,
  writeNativeLayeredPsd,
  type NativeLayeredPsdLayerInput,
} from "./psd-native-writer"
import { createHighBitImageFromImageData } from "./color-pipeline"

function loadPsdCodec() {
  return import("ag-psd")
}

export const PSD_ROUND_TRIP_CAPABILITIES = {
  colorModes: COLOR_MODE_CAPABILITY,
  effectsAdjustments: EFFECTS_ADJUSTMENTS_CAPABILITY,
  vectorText: VECTOR_TEXT_CAPABILITY,
  channelsMasks: CHANNELS_MASKS_CAPABILITY,
  resourcesMetadata: RESOURCES_METADATA_CAPABILITY,
} as const

export type BrowserRasterExportFormat = "png" | "jpeg" | "webp" | "avif" | "gif"
export type AppRasterExportFormat = BrowserRasterExportFormat | "tiff" | "tga" | "ppm" | "pgm" | "pbm"
export type AnimationExportFormat = "gif" | "apng" | "animated-webp"
export type ExportFormat = AppRasterExportFormat | "svg" | "apng" | "animated-webp" | "metadata-json"

export interface RasterExportOptions {
  format: AppRasterExportFormat
  scale: number
  quality: number
  transparent: boolean
  matte: string
  dither?: boolean
  interlaced?: boolean
  progressive?: boolean
  tiffCompression?: TiffCompression
  tgaRle?: boolean
  webpLossless?: boolean
  webpNearLossless?: number
  webpMethod?: number
  webpExactAlpha?: boolean
  webpAlphaQuality?: number
  webpAlphaFilter?: "none" | "fast" | "best"
  avifLossless?: boolean
  avifSpeed?: number
  avifBitDepth?: number
  avifChromaSubsampling?: string
  avifTileRowsLog2?: number
  avifTileColsLog2?: number
  tgaJobName?: string
  tgaSoftwareId?: string
  tgaAspectRatioNumerator?: number
  tgaAspectRatioDenominator?: number
  tgaGamma?: number
  netpbmComments?: string[]
  netpbmSourceMaxValue?: number
  includeMetadata?: boolean
  metadata?: RasterExportMetadata
}

export interface SvgExportOptions {
  scale: number
  transparent: boolean
  matte: string
  includeMetadata: boolean
  precision: number
}

type ReportStatus = DocumentReport["items"][number]["status"]

export type CompatibilityTarget = "project" | "psd" | "browser-raster"

export interface CompatibilityManifestEntry {
  label: string
  status: ReportStatus
  detail: string
}

export interface CompatibilityManifest {
  target: CompatibilityTarget
  entries: CompatibilityManifestEntry[]
  totals: Record<ReportStatus, number>
  summary: string
}

export interface ExportLimitationOptions {
  format: ExportFormat
  includeMetadata?: boolean
  interlaced?: boolean
  progressive?: boolean
  tiffCompression?: TiffCompression
  tgaRle?: boolean
  transparent?: boolean
  quality?: number
}

export interface ExportLimitationReport {
  format: ExportFormat
  items: CompatibilityManifestEntry[]
  summary: string
}

export interface ExportCompatibilityManifest {
  app: "Photoshop Web"
  format: "ps-export-manifest"
  version: 1
  generatedAt: string
  target: CompatibilityTarget
  document: {
    id: string
    name: string
    width: number
    height: number
    colorMode: PsDocument["colorMode"]
    bitDepth: PsDocument["bitDepth"]
    layerCount: number
  }
  export: ExportLimitationOptions
  entries: CompatibilityManifestEntry[]
  totals: Record<ReportStatus, number>
  warnings: string[]
  riskLevel: "low" | "medium" | "high"
  summary: string
}

const APP_BLEND_MODES = new Set<BlendMode>([
  "normal",
  "dissolve",
  "darken",
  "multiply",
  "color-burn",
  "linear-burn",
  "darker-color",
  "lighten",
  "screen",
  "color-dodge",
  "linear-dodge",
  "lighter-color",
  "overlay",
  "soft-light",
  "hard-light",
  "vivid-light",
  "linear-light",
  "pin-light",
  "hard-mix",
  "difference",
  "exclusion",
  "subtract",
  "divide",
  "hue",
  "saturation",
  "color",
  "luminosity",
])

const APP_LAYER_KINDS = new Set<Layer["kind"]>([
  "raster",
  "text",
  "shape",
  "group",
  "smart-object",
  "adjustment",
  "frame",
  "artboard",
  "3d",
  "video",
])

const SAFE_CANVAS_DATA_URL = /^data:image\/(?:png|jpeg|jpg|webp|avif);base64,/i
const PSD_HEADER_BYTES = 26
const RASTER_HEADER_BYTES = 1024 * 1024
const MAX_LAYER_NAME_LENGTH = 120

interface ImageHeaderDimensions {
  width: number
  height: number
  format: string
}

function hasAscii(bytes: Uint8Array, offset: number, text: string) {
  if (offset + text.length > bytes.length) return false
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false
  }
  return true
}

function readUint16BE(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, false)
}

function readUint16LE(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true)
}

function readUint24LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16)
}

function readUint32BE(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false)
}

function readUint32LE(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)
}

function readInt32LE(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset, true)
}

function readPsdHeaderDimensions(buffer: ArrayBuffer): (ImageHeaderDimensions & { version: 1 | 2 }) | null {
  if (buffer.byteLength < PSD_HEADER_BYTES) return null
  const bytes = new Uint8Array(buffer, 0, PSD_HEADER_BYTES)
  if (!hasAscii(bytes, 0, "8BPS")) return null
  const version = readUint16BE(bytes, 4)
  if (version !== 1 && version !== 2) return null
  const height = readUint32BE(bytes, 14)
  const width = readUint32BE(bytes, 18)
  return { width, height, format: version === 2 ? "PSB" : "PSD", version }
}

function validatePsdHeaderDimensions(buffer: ArrayBuffer, fileName = "PSD canvas") {
  const dimensions = readPsdHeaderDimensions(buffer)
  if (!dimensions) return
  const error = canvasSizeError(dimensions.width || 1, dimensions.height || 1, "PSD canvas")
  if (!error) return
  if (dimensions.version === 2) {
    throw new Error(planPsbLargeDocumentOpen({
      width: dimensions.width || 1,
      height: dimensions.height || 1,
      fileName,
    }).defaultError ?? error)
  }
  throw new Error(error)
}

export type PsbLargeDocumentMode = "full" | "downscale-50" | "reduced-scale" | "tile-view"

export interface PsdDeserializeOptions {
  psbLargeDocumentMode?: PsbLargeDocumentMode
}

export interface ImportFileDimensions extends ImageHeaderDimensions {
  kind: "raster" | "psd" | "psb"
}

export interface LoadRasterCanvasOptions {
  mode?: Extract<LargeDocumentOpenMode, "full" | "reduced-scale">
  memoryBudgetMB?: number
}

export interface LoadedRasterCanvas {
  canvas: HTMLCanvasElement
  originalWidth: number
  originalHeight: number
  scale: number
  mode: "full" | "reduced-scale"
  warnings: string[]
}

function sniffPngDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    !hasAscii(bytes, 1, "PNG\r\n\u001a\n") ||
    !hasAscii(bytes, 12, "IHDR")
  ) {
    return null
  }
  return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20), format: "PNG" }
}

function sniffGifDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  if (bytes.length < 10 || (!hasAscii(bytes, 0, "GIF87a") && !hasAscii(bytes, 0, "GIF89a"))) return null
  return { width: readUint16LE(bytes, 6), height: readUint16LE(bytes, 8), format: "GIF" }
}

function isJpegStartOfFrame(marker: number) {
  return (
    marker === 0xc0 ||
    marker === 0xc1 ||
    marker === 0xc2 ||
    marker === 0xc3 ||
    marker === 0xc5 ||
    marker === 0xc6 ||
    marker === 0xc7 ||
    marker === 0xc9 ||
    marker === 0xca ||
    marker === 0xcb ||
    marker === 0xcd ||
    marker === 0xce ||
    marker === 0xcf
  )
}

function sniffJpegDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++
      continue
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue
    if (offset + 2 > bytes.length) return null
    const length = readUint16BE(bytes, offset)
    if (length < 2 || offset + length > bytes.length) return null
    if (isJpegStartOfFrame(marker) && length >= 7) {
      return { width: readUint16BE(bytes, offset + 5), height: readUint16BE(bytes, offset + 3), format: "JPEG" }
    }
    if (marker === 0xda) return null
    offset += length
  }
  return null
}

function sniffWebpDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  if (bytes.length < 30 || !hasAscii(bytes, 0, "RIFF") || !hasAscii(bytes, 8, "WEBP")) return null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const chunkTypeOffset = offset
    const chunkSize = readUint32LE(bytes, offset + 4)
    const payload = offset + 8
    if (payload + chunkSize > bytes.length) return null
    if (hasAscii(bytes, chunkTypeOffset, "VP8X") && chunkSize >= 10) {
      return {
        width: readUint24LE(bytes, payload + 4) + 1,
        height: readUint24LE(bytes, payload + 7) + 1,
        format: "WEBP",
      }
    }
    if (hasAscii(bytes, chunkTypeOffset, "VP8 ") && chunkSize >= 10 && hasAscii(bytes, payload + 3, "\u009d\u0001*")) {
      return {
        width: readUint16LE(bytes, payload + 6) & 0x3fff,
        height: readUint16LE(bytes, payload + 8) & 0x3fff,
        format: "WEBP",
      }
    }
    if (hasAscii(bytes, chunkTypeOffset, "VP8L") && chunkSize >= 5 && bytes[payload] === 0x2f) {
      const bits =
        bytes[payload + 1] |
        (bytes[payload + 2] << 8) |
        (bytes[payload + 3] << 16) |
        (bytes[payload + 4] << 24)
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
        format: "WEBP",
      }
    }
    offset = payload + chunkSize + (chunkSize % 2)
  }
  return null
}

function sniffBmpDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  if (bytes.length < 26 || !hasAscii(bytes, 0, "BM")) return null
  const dibSize = readUint32LE(bytes, 14)
  if (dibSize === 12) {
    return { width: readUint16LE(bytes, 18), height: readUint16LE(bytes, 20), format: "BMP" }
  }
  if (dibSize >= 40 && bytes.length >= 26) {
    return {
      width: Math.abs(readInt32LE(bytes, 18)),
      height: Math.abs(readInt32LE(bytes, 22)),
      format: "BMP",
    }
  }
  return null
}

function isIsoBaseMediaFile(bytes: Uint8Array) {
  if (bytes.length < 16 || !hasAscii(bytes, 4, "ftyp")) return false
  const majorBrand = String.fromCharCode(...bytes.slice(8, 12))
  if (/^(avif|avis|heic|heix|hevc|hevx|mif1|msf1)$/.test(majorBrand)) return true
  const brandsEnd = Math.min(bytes.length, readUint32BE(bytes, 0))
  for (let offset = 16; offset + 4 <= brandsEnd; offset += 4) {
    const brand = String.fromCharCode(...bytes.slice(offset, offset + 4))
    if (/^(avif|avis|heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) return true
  }
  return false
}

function sniffIsoImageDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  if (!isIsoBaseMediaFile(bytes)) return null
  for (let offset = 4; offset + 16 <= bytes.length; offset++) {
    if (!hasAscii(bytes, offset, "ispe")) continue
    const boxStart = offset - 4
    const boxSize = readUint32BE(bytes, boxStart)
    if (boxSize >= 20 && offset + 16 <= bytes.length) {
      return { width: readUint32BE(bytes, offset + 8), height: readUint32BE(bytes, offset + 12), format: "ISO-BMFF" }
    }
  }
  return null
}

function sniffRasterDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  return (
    sniffPngDimensions(bytes) ??
    sniffGifDimensions(bytes) ??
    sniffJpegDimensions(bytes) ??
    sniffWebpDimensions(bytes) ??
    sniffBmpDimensions(bytes) ??
    sniffIsoImageDimensions(bytes)
  )
}

async function assertRasterHeaderCanvasSize(file: File) {
  const headerBytes = await file.slice(0, Math.min(file.size, RASTER_HEADER_BYTES)).arrayBuffer()
  const dimensions = sniffRasterDimensions(new Uint8Array(headerBytes))
  if (dimensions) assertCanvasSize(dimensions.width, dimensions.height, "Image canvas")
}

export async function inspectImportFileDimensions(file: File): Promise<ImportFileDimensions | null> {
  const headerBytes = await file.slice(0, Math.min(file.size, RASTER_HEADER_BYTES)).arrayBuffer()
  const psd = readPsdHeaderDimensions(headerBytes)
  if (psd) return { ...psd, kind: psd.version === 2 ? "psb" : "psd" }
  const raster = sniffRasterDimensions(new Uint8Array(headerBytes))
  if (raster) return { ...raster, kind: "raster" }
  return null
}

export interface PsdRecoveryInspection {
  kind: "psd" | "psb"
  width: number
  height: number
  parsedStructure: PsdParsedStructureMetadata
  parseError?: string
}

function psdColorModeLabel(mode: unknown): string {
  switch (mode) {
    case 0: return "Bitmap"
    case 1: return "Grayscale"
    case 2: return "Indexed"
    case 3: return "RGB"
    case 4: return "CMYK"
    case 7: return "Multichannel"
    case 8: return "Duotone"
    case 9: return "Lab"
    default: return "Unknown"
  }
}

function parsedStructureFromPsd(psd: Psd, fallbackLayerCount = 0): PsdParsedStructureMetadata {
  const repairPlan = createPsdRepairPlanFromParsedPsd(psd)
  const imageResources = psd.imageResources as Record<string, unknown> | undefined
  const resources = Object.keys(imageResources ?? {}).filter((key) => imageResources?.[key] != null)
  return {
    layerCount: countPsdLayers(psd.children) || fallbackLayerCount,
    colorMode: psdColorModeLabel(psd.colorMode),
    bitDepth: typeof psd.bitsPerChannel === "number" ? psd.bitsPerChannel : undefined,
    resources,
    repairableItems: repairPlan.actions.map((action) => `${action.label} -> ${action.localRepresentation}`),
  }
}

export async function inspectPsdRecoveryFile(file: File): Promise<PsdRecoveryInspection | null> {
  assertFileSize(file, MAX_PSD_FILE_BYTES, "PSD file")
  const buffer = await file.arrayBuffer()
  const header = readPsdHeaderDimensions(buffer)
  if (!header) return null
  try {
    const { readPsd } = await loadPsdCodec()
    const psd = readPsd(buffer, {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
      skipLinkedFilesData: true,
      useImageData: false,
    })
    return {
      kind: header.version === 2 ? "psb" : "psd",
      width: header.width,
      height: header.height,
      parsedStructure: parsedStructureFromPsd(psd),
    }
  } catch (error) {
    return {
      kind: header.version === 2 ? "psb" : "psd",
      width: header.width,
      height: header.height,
      parsedStructure: {
        colorMode: "Unknown",
        resources: [],
        repairableItems: [],
      },
      parseError: error instanceof Error ? error.message : "PSD structure could not be parsed safely.",
    }
  }
}

function cleanText(value: unknown, fallback: string, maxLength = 120) {
  if (typeof value !== "string") return fallback
  // Strip:
  //   - C0 controls and DEL                          \u0000-\u001f, \u007f
  //   - Zero-width / format characters               \u200B-\u200F
  //   - Bidirectional explicit/isolate controls      \u2028-\u202E, \u2066-\u2069
  //   - Byte-order mark / zero-width no-break space  \uFEFF
  // The bidi controls would otherwise allow filename-spoofing on download
  // (e.g. a doc named "report\u202Egnp.exe-frames.json" displays as
  // "reportnosj.semarf-exe.png" but downloads as the original .json).
  const text = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g, "")
    .trim()
    .slice(0, maxLength)
  return text || fallback
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const next = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.max(min, Math.min(max, next))
}

function cleanBlendMode(value: unknown): BlendMode {
  return typeof value === "string" && APP_BLEND_MODES.has(value as BlendMode) ? (value as BlendMode) : "normal"
}

function cleanLayerKind(value: unknown): Layer["kind"] {
  return typeof value === "string" && APP_LAYER_KINDS.has(value as Layer["kind"]) ? (value as Layer["kind"]) : "raster"
}

function psdBlendToApp(mode: PsdBlendMode | undefined): BlendMode {
  const normalized = (mode ?? "normal").replace(/\s+/g, "-") as BlendMode
  return APP_BLEND_MODES.has(normalized) ? normalized : "normal"
}

function appBlendToPsd(mode: BlendMode): PsdBlendMode {
  return mode.replace(/-/g, " ") as PsdBlendMode
}

function canvasAtDocumentSize(
  source: HTMLCanvasElement | undefined,
  docW: number,
  docH: number,
  left = 0,
  top = 0,
) {
  const canvas = makeIoCanvas(docW, docH)
  if (source && typeof source.getContext === "function") {
    const ctx = canvas.getContext("2d")!
    // Negative offsets indicate the source extends beyond the canvas's
    // top/left edge (common for PSD layer masks anchored above 0,0).
    // Plain `drawImage(source, left, top)` would silently clip those
    // pixels because Canvas 2D treats negative dx/dy as off-canvas;
    // explicitly clip the source region instead so we draw the
    // correct intersected rectangle into [0, docW) × [0, docH).
    if (left < 0 || top < 0) {
      const srcX = left < 0 ? -left : 0
      const srcY = top < 0 ? -top : 0
      const dstX = left < 0 ? 0 : left
      const dstY = top < 0 ? 0 : top
      const w = Math.max(0, Math.min(source.width - srcX, docW - dstX))
      const h = Math.max(0, Math.min(source.height - srcY, docH - dstY))
      if (w > 0 && h > 0) ctx.drawImage(source, srcX, srcY, w, h, dstX, dstY, w, h)
    } else {
      ctx.drawImage(source, left, top)
    }
  }
  return canvas
}

function cloneIoCanvas(source: HTMLCanvasElement | null | undefined) {
  if (!source || typeof source.getContext !== "function") return null
  const canvas = makeIoCanvas(source.width, source.height)
  canvas.getContext("2d")!.drawImage(source, 0, 0)
  return canvas
}

function parseHexColor(hex: string) {
  const clean = hex.replace("#", "").trim()
  const value =
    clean.length === 3
      ? clean.split("").map((ch) => ch + ch).join("")
      : clean.padEnd(6, "0").slice(0, 6)
  return {
    r: parseInt(value.slice(0, 2), 16) || 0,
    g: parseInt(value.slice(2, 4), 16) || 0,
    b: parseInt(value.slice(4, 6), 16) || 0,
  }
}

export function makeIoCanvas(w: number, h: number, fill?: string) {
  const size = assertCanvasSize(w, h)
  const c = document.createElement("canvas")
  c.width = size.width
  c.height = size.height
  if (fill) {
    const ctx = c.getContext("2d")!
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, c.width, c.height)
  }
  return c
}

function withLayerMask(source: HTMLCanvasElement, mask?: HTMLCanvasElement | null) {
  return mask ? applyLuminanceMaskToCanvas(source, mask) : source
}

function renderableLayer(layer: Layer) {
  const smartFiltered = applySmartFiltersForIo(layer.canvas, layer.smartFilters)
  const advanced = normalizeAdvancedBlending(layer.advancedBlending)
  const layerMask = layer.mask && layer.maskEnabled !== false ? layer.mask : null
  const fillContent = withLayerMask(smartFiltered, layerMask)
  const effectContent = advanced.layerMaskHidesEffects ? withLayerMask(smartFiltered, layerMask) : smartFiltered
  const renderLayer = { ...layer, canvas: fillContent }
  return layer.style
    ? applyLayerStyle(renderLayer, layer.fillOpacity ?? 1, {
        effectSourceCanvas: effectContent,
        transparencyShapesLayer: advanced.transparencyShapesLayer,
      })
    : fillContent
}

function paramsWithDefaults(filter: NonNullable<ReturnType<typeof getFilter>>, params: Record<string, number | string | boolean>) {
  const out: Record<string, number | string | boolean> = {}
  for (const param of filter.params) {
    const raw = params[param.key] ?? param.default
    if (param.type === "slider") {
      const numeric = typeof raw === "number" ? raw : Number(raw)
      out[param.key] = Math.max(param.min, Math.min(param.max, Number.isFinite(numeric) ? numeric : param.default))
    } else if (param.type === "checkbox") {
      out[param.key] = raw === true
    } else if (param.type === "select") {
      out[param.key] = param.options.some((option) => option.value === raw) ? raw : param.default
    } else {
      out[param.key] = typeof raw === "string" ? raw : param.default
    }
  }
  return out
}

function imageDataToCanvas(data: ImageData) {
  const c = makeIoCanvas(data.width, data.height)
  c.getContext("2d")!.putImageData(data, 0, 0)
  return c
}

function applySmartFiltersForIo(source: HTMLCanvasElement, smartFilters: Layer["smartFilters"]) {
  const enabled = smartFilters?.filter((sf) => sf.enabled) ?? []
  if (!enabled.length) return source
  const c = makeIoCanvas(source.width, source.height)
  const ctx = c.getContext("2d")!
  ctx.drawImage(source, 0, 0)
  let current = ctx.getImageData(0, 0, c.width, c.height)
  for (const smartFilter of enabled) {
    const filter = getFilter(smartFilter.filterId)
    if (!filter) continue
    const before = current
    const after = filter.apply(before, paramsWithDefaults(filter, smartFilter.params))
    const opacity = Math.max(0, Math.min(1, smartFilter.opacity ?? 1))
    if (opacity <= 0) {
      current = before
      continue
    }
    const mask = smartFilter.maskEnabled === false || !smartFilter.mask
      ? null
      : smartFilterMaskToImageData(smartFilter.mask, c.width, c.height, smartFilter.maskFeather ?? 0)
    if (!mask && opacity >= 1 && (smartFilter.blendMode ?? "normal") === "normal") {
      current = after
      continue
    }
    const overlay = new ImageData(new Uint8ClampedArray(after.data), c.width, c.height)
    if (mask) {
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4
          overlay.data[i + 3] = Math.round(overlay.data[i + 3] * smartFilterMaskAmountAt(mask, x, y, smartFilter.maskDensity ?? 1))
        }
      }
    }
    const baseCanvas = imageDataToCanvas(before)
    compositeLayer(baseCanvas.getContext("2d")!, imageDataToCanvas(overlay), smartFilter.blendMode ?? "normal", opacity)
    current = baseCanvas.getContext("2d")!.getImageData(0, 0, c.width, c.height)
  }
  ctx.putImageData(current, 0, 0)
  return c
}

function maskAmountAt(mask: ImageData | null, x: number, y: number) {
  if (!mask || x >= mask.width || y >= mask.height) return 1
  const i = (y * mask.width + x) * 4
  const luminance = (mask.data[i] + mask.data[i + 1] + mask.data[i + 2]) / 765
  return luminance * (mask.data[i + 3] / 255)
}

function applyAdjustmentForIo(ctx: CanvasRenderingContext2D, layer: Layer, width: number, height: number, clipMask?: HTMLCanvasElement | null) {
  if (!layer.adjustment) return
  if (layer.opacity <= 0 || isAdjustmentNoop(layer.adjustment)) return
  const filter = getFilter(layer.adjustment.type)
  if (!filter) return
  const before = ctx.getImageData(0, 0, width, height)
  const after = filter.apply(before, paramsWithDefaults(filter, layer.adjustment.params))
  const opacity = Math.max(0, Math.min(1, layer.opacity))
  const maskCtx = layer.mask?.getContext("2d") ?? null
  const mask = maskCtx ? maskCtx.getImageData(0, 0, Math.min(layer.mask!.width, width), Math.min(layer.mask!.height, height)) : null
  const clipCtx = clipMask?.getContext("2d") ?? null
  const clip = clipCtx ? clipCtx.getImageData(0, 0, Math.min(clipMask!.width, width), Math.min(clipMask!.height, height)) : null
  if (!mask && !clip && opacity >= 1) {
    ctx.putImageData(after, 0, 0)
    return
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const amount = opacity * maskAmountAt(mask, x, y) * maskAmountAt(clip, x, y)
      for (let k = 0; k < 4; k++) {
        after.data[i + k] = before.data[i + k] * (1 - amount) + after.data[i + k] * amount
      }
    }
  }
  ctx.putImageData(after, 0, 0)
}

export function renderDocumentComposite(
  doc: PsDocument,
  options: { transparent?: boolean; matte?: string; colorPurpose?: "preview" | "export" } = {},
) {
  if (doc.bitDepth > 8 || (doc as HighBitDocument).__highBitImageData || doc.layers.some((layer) => !!(layer as HighBitLayer).__highBitImageData || !!(layer as HighBitLayer).__highBitDepthData)) {
    const highBit = renderDocumentHighBitPreviewCanvas(doc, options)
    if (highBit) return applyModeAndColorManagement(highBit.canvas, doc, { purpose: options.colorPurpose ?? "preview" })
  }

  const flat = makeIoCanvas(doc.width, doc.height)
  const ctx = flat.getContext("2d")!
  const transparent = options.transparent ?? false
  if (!transparent) {
    ctx.fillStyle = options.matte ?? doc.background ?? "#ffffff"
    ctx.fillRect(0, 0, doc.width, doc.height)
  }

  for (const layer of doc.layers) {
    if (!layer.visible || layer.kind === "group") continue
    if (typeof layer.canvas?.getContext !== "function") continue
    let clipMask: HTMLCanvasElement | null = null
    if (layer.clipped) {
      const idx = doc.layers.indexOf(layer)
      for (let j = idx - 1; j >= 0; j--) {
        if (!doc.layers[j].clipped) {
          clipMask = doc.layers[j].canvas
          break
        }
      }
    }
    if (layer.kind === "adjustment" && layer.adjustment) {
      applyAdjustmentForIo(ctx, layer, doc.width, doc.height, clipMask)
      continue
    }
    const toDraw = withLayerMask(renderableLayer(layer), clipMask)
    compositeLayer(ctx, toDraw, layer.blendMode, layer.opacity, layer.style ? 1 : layer.fillOpacity ?? 1)
  }
  return applyModeAndColorManagement(flat, doc, { purpose: options.colorPurpose ?? "preview" })
}

/**
 * Generate a small thumbnail data URL for a document.
 * Used in the Open Recent list.  Returns a ~120px wide JPEG data URL.
 */
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

function dataUrlToBytes(dataUrl: string) {
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

function canvasImageData(canvas: HTMLCanvasElement) {
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
function cleanCssColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback
  return isSafeSvgColor(value) ? value : fallback
}

/**
 * Optional sibling: returns undefined when the input is not a safe color,
 * for fields where the canvas / engine treats undefined and a default
 * differently.
 */
function cleanOptionalCssColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return isSafeSvgColor(value) ? value : undefined
}

/**
 * Reject keys that JavaScript treats specially during property access /
 * assignment so a malicious JSON payload cannot pollute the prototype
 * chain when the result is later passed through Object.assign or a
 * lodash deep-merge.
 */
const PROJECT_RESERVED_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
])

/**
 * Best-effort recursive sanitiser for project-format JSON values whose
 * shape we do not strictly validate (slices, notes, asset libraries,
 * style/gradient/character/paragraph presets, etc.). The result preserves
 * the original structure within bounds:
 *   - drops `__proto__` / `constructor` / `prototype` keys and any key
 *     whose name does not match a sensible identifier pattern,
 *   - bounds string length, array length, and object size,
 *   - bounds nesting depth,
 *   - drops non-finite numbers and unsupported types (functions, symbols,
 *     bigints).
 *
 * Pure data passes through unchanged; nothing structural is rewritten.
 */
const SAFE_JSON_MAX_DEPTH = 6
const SAFE_JSON_MAX_STRING = 4000
const SAFE_JSON_MAX_ARRAY = 1024
const SAFE_JSON_MAX_OBJECT_KEYS = 256
const SAFE_JSON_KEY = /^[A-Za-z0-9_\-:.]{1,64}$/

function safeJsonValue(value: unknown, depth = 0): unknown {
  if (value === null) return null
  const type = typeof value
  if (type === "string") {
    return (value as string).slice(0, SAFE_JSON_MAX_STRING)
  }
  if (type === "boolean") return value
  if (type === "number") {
    return Number.isFinite(value as number) ? value : undefined
  }
  if (type === "function" || type === "symbol" || type === "bigint" || type === "undefined") {
    return undefined
  }
  if (depth >= SAFE_JSON_MAX_DEPTH) return undefined
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (const item of value.slice(0, SAFE_JSON_MAX_ARRAY)) {
      const next = safeJsonValue(item, depth + 1)
      if (next !== undefined) out.push(next)
    }
    return out
  }
  if (type === "object") {
    const out: Record<string, unknown> = {}
    let keysCopied = 0
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (keysCopied >= SAFE_JSON_MAX_OBJECT_KEYS) break
      if (PROJECT_RESERVED_KEYS.has(key)) continue
      if (!SAFE_JSON_KEY.test(key)) continue
      const cleaned = safeJsonValue(nested, depth + 1)
      if (cleaned === undefined) continue
      out[key] = cleaned
      keysCopied += 1
    }
    return out
  }
  return undefined
}

/**
 * Convenience wrappers around safeJsonValue for the typed PsDocument
 * fields that are pure-data passthroughs (no DOM/CSS sinks). Each helper
 * returns `undefined` when the input is not array/object as appropriate.
 */
function safeJsonArray<T>(value: unknown): T[] | undefined {
  const cleaned = safeJsonValue(value)
  return Array.isArray(cleaned) ? (cleaned as T[]) : undefined
}

function safeJsonObject<T extends object>(value: unknown): T | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  const cleaned = safeJsonValue(value)
  return cleaned && typeof cleaned === "object" && !Array.isArray(cleaned)
    ? (cleaned as T)
    : undefined
}

/** True if `set.has(value)`, narrowing `value` to the set's element type. */
function isAllowedEnum<T extends string>(value: unknown, allowed: ReadonlySet<T>): value is T {
  return typeof value === "string" && (allowed as ReadonlySet<string>).has(value)
}

const ALLOWED_COLOR_MODES = new Set<DocumentModeSettings["mode"]>([
  "RGB", "CMYK", "Grayscale", "Indexed", "Bitmap", "Multichannel", "Duotone",
])
const ALLOWED_RULER_UNITS = new Set<NonNullable<PsDocument["rulerUnits"]>>([
  "px", "in", "cm", "mm", "pt", "pc",
])


function cleanGlobalLight(value: unknown): { angle: number; altitude: number } {
  const fallback = { angle: 120, altitude: 30 }
  if (!value || typeof value !== "object") return fallback
  const v = value as Record<string, unknown>
  const angle = typeof v.angle === "number" && Number.isFinite(v.angle) ? v.angle : fallback.angle
  const altitude =
    typeof v.altitude === "number" && Number.isFinite(v.altitude) ? v.altitude : fallback.altitude
  return {
    angle: Math.max(-360, Math.min(360, angle)),
    altitude: Math.max(-90, Math.min(90, altitude)),
  }
}

function cleanMeasurement(value: unknown): PsDocument["measurement"] {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  const num = (k: string) =>
    typeof v[k] === "number" && Number.isFinite(v[k] as number) ? (v[k] as number) : null
  const x1 = num("x1"); const y1 = num("y1")
  const x2 = num("x2"); const y2 = num("y2")
  if (x1 === null || y1 === null || x2 === null || y2 === null) return null
  return { x1, y1, x2, y2 }
}

function cleanRulerOrigin(value: unknown): { x: number; y: number } | undefined {
  if (!value || typeof value !== "object") return undefined
  const v = value as Record<string, unknown>
  if (typeof v.x !== "number" || !Number.isFinite(v.x)) return undefined
  if (typeof v.y !== "number" || !Number.isFinite(v.y)) return undefined
  return { x: v.x, y: v.y }
}

function cleanGuides(value: unknown): Guide[] {
  if (!Array.isArray(value)) return []
  const out: Guide[] = []
  for (const item of value.slice(0, 1024)) {
    if (!item || typeof item !== "object") continue
    const g = item as Record<string, unknown>
    const orientation = g.orientation === "vertical" ? "vertical" : "horizontal"
    if (typeof g.position !== "number" || !Number.isFinite(g.position)) continue
    out.push({
      id: cleanText(g.id, uid("guide"), 80),
      orientation,
      position: g.position,
      color: cleanOptionalCssColor(g.color),
    })
  }
  return out
}

function cleanSmartObjectParent(value: unknown): PsDocument["smartObjectParent"] {
  if (!value || typeof value !== "object") return undefined
  const v = value as Record<string, unknown>
  const docId = cleanText(v.docId, "", 120)
  const layerId = cleanText(v.layerId, "", 120)
  if (!docId || !layerId) return undefined
  return { docId, layerId }
}

/** Escape characters that could prematurely close a CDATA section. */
function escapeForCData(value: string): string {
  return value.replace(/]]>/g, "]]]]><![CDATA[>")
}

function canvasDataUrl(canvas?: HTMLCanvasElement | null) {
  if (!canvas || typeof canvas.toDataURL !== "function") return null
  return canvas.toDataURL("image/png")
}

function serializeSelection(selection: Selection) {
  const { mask, ...rest } = selection
  return { ...rest, maskDataUrl: canvasDataUrl(mask) }
}

function serializeChannel(channel: AlphaChannel) {
  return {
    id: channel.id,
    name: channel.name,
    kind: channel.kind,
    spotColor: channel.spotColor,
    spotOpacity: channel.spotOpacity,
    canvasDataUrl: canvasDataUrl(channel.canvas),
  }
}

function serializeSmartFilter(filter: SmartFilter) {
  const { mask, ...rest } = filter
  return { ...rest, maskDataUrl: canvasDataUrl(mask) }
}

function serializeLayer(layer: Layer) {
  const { canvas, mask, frame, smartFilters, smartSource, ...rest } = layer
  const serializedSmartSource = smartSource
    ? (() => {
        const { canvas: sourceCanvas, fileHandle: _fileHandle, ...sourceRest } = smartSource
        return {
          ...sourceRest,
          canvasDataUrl: canvasDataUrl(sourceCanvas),
          canvas: undefined,
        }
      })()
    : undefined
  return {
    ...rest,
    highBitImageData: serializeHighBitImagePayload((layer as HighBitLayer).__highBitImageData),
    canvasDataUrl: canvasDataUrl(canvas),
    maskDataUrl: canvasDataUrl(mask),
    frame: frame
      ? {
          ...frame,
          imageDataUrl: canvasDataUrl(frame.imageCanvas),
          imageCanvas: undefined,
        }
      : undefined,
    smartFilters: smartFilters?.map(serializeSmartFilter),
    smartSource: serializedSmartSource,
  }
}

export function serializeProject(doc: PsDocument) {
  const { layers, channels, selection, quickMaskCanvas, ...rest } = doc
  return JSON.stringify(
    {
      app: "Photoshop Web",
      format: "psprojson",
      version: 2,
      savedAt: new Date().toISOString(),
      savedWith: {
        supports: ["adjustment-layers", "smart-filters", "asset-library", "export-presets", "layer-comps", "timeline", "video-layers", "3d-scenes", "plugins", "variable-data", "advanced-formats", "annotations", "guides", "slices", "round-trip-reports", "metadata", "color-management", "print-settings"],
      },
      document: {
        ...rest,
        highBitImageData: serializeHighBitImagePayload((doc as HighBitDocument).__highBitImageData),
        selection: serializeSelection(selection),
        quickMaskCanvasDataUrl: canvasDataUrl(quickMaskCanvas),
        layers: layers.map(serializeLayer),
        channels: (channels ?? []).map(serializeChannel),
      },
    },
    null,
    2,
  )
}

const REPORT_STATUSES: ReportStatus[] = ["preserved", "approximated", "flattened", "unsupported", "info"]

function reportTotals(entries: CompatibilityManifestEntry[]): Record<ReportStatus, number> {
  const totals = Object.fromEntries(REPORT_STATUSES.map((status) => [status, 0])) as Record<ReportStatus, number>
  for (const entry of entries) totals[entry.status] += 1
  return totals
}

function reportPlural(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function compatibilityStatus(
  target: CompatibilityTarget,
  project: ReportStatus,
  psd: ReportStatus,
  raster: ReportStatus,
) {
  return target === "project" ? project : target === "psd" ? psd : raster
}

function manifestTargetLabel(target: CompatibilityTarget) {
  if (target === "project") return "project format"
  if (target === "psd") return "PSD round trip"
  return "browser raster export"
}

function compatibilityTargetForSource(source: DocumentReport["source"]): CompatibilityTarget {
  if (source.includes("Project")) return "project"
  if (source.includes("PSD")) return "psd"
  return "browser-raster"
}

export function createCompatibilityManifest(
  doc: PsDocument,
  target: CompatibilityTarget,
): CompatibilityManifest {
  const entries: CompatibilityManifestEntry[] = []
  const layers = doc.layers
  const textLayers = layers.filter((layer) => layer.kind === "text").length
  const shapeLayers = layers.filter((layer) => layer.kind === "shape").length
  const smartObjectLayers = layers.filter((layer) => layer.kind === "smart-object" || layer.smartObject)
  const smartObjectSources = smartObjectLayers.filter((layer) => layer.smartSource).length
  const linkedSmartObjects = smartObjectLayers.filter((layer) => layer.smartSource?.linkType === "linked").length
  const smartObjectEditPackages = smartObjectLayers.filter((layer) => layer.smartSource?.editPackage).length
  const smartObjectFileHandles = smartObjectLayers.filter((layer) => layer.smartSource?.fileHandleName || layer.smartSource?.handlePermission).length
  const adjustmentLayers = layers.filter((layer) => layer.kind === "adjustment").length
  const smartFilters = layers.reduce((sum, layer) => sum + (layer.smartFilters?.length ?? 0), 0)
  const smartFilterMasks = layers.reduce((sum, layer) => sum + (layer.smartFilters?.filter((filter) => filter.mask || filter.maskEnabled === false).length ?? 0), 0)
  const maskedLayers = layers.filter((layer) => layer.mask || layer.vectorMask).length
  const layerNotes = layers.reduce((sum, layer) => sum + (layer.notes?.length ?? 0), 0)
  const layerMetadata = layers.filter((layer) => layer.metadata).length
  const styledLayers = layers.filter((layer) => layer.style).length
  const groupLayers = layers.filter((layer) => layer.kind === "group").length
  const blendModes = [...new Set(layers.map((layer) => layer.blendMode).filter((mode) => mode && mode !== "normal"))]
  const threeDLayers = layers.filter((layer) => layer.kind === "3d").length
  const videoLayers = layers.filter((layer) => layer.kind === "video").length
  const exportPresets = (doc.assetLibrary ?? []).filter((asset) => asset.kind === "export").length
  const pluginAssets = (doc.assetLibrary ?? []).filter((asset) => asset.kind === "plugin" || asset.kind === "cloud-library").length
  const profile = doc.colorManagement?.assignedProfile
  const specialMode = doc.colorMode !== "RGB" || doc.bitDepth > 8

  const add = (
    label: string,
    project: ReportStatus,
    psd: ReportStatus,
    raster: ReportStatus,
    details: Record<CompatibilityTarget, string>,
  ) => {
    entries.push({
      label,
      status: compatibilityStatus(target, project, psd, raster),
      detail: details[target],
    })
  }

  add("Canvas", "preserved", "preserved", "preserved", {
    project: `${doc.width} x ${doc.height}px canvas, background, resolution, mode, and bit-depth metadata are serialized.`,
    psd: `${doc.width} x ${doc.height}px rendered layer pixels are written with PSD-compatible canvas metadata.`,
    "browser-raster": `${doc.width} x ${doc.height}px composite pixels are exported through the browser encoder when they fit, or through the tile-sequence package path for oversized compatible documents.`,
  })
  add("Layer structure", "preserved", "approximated", "flattened", {
    project: `${reportPlural(layers.length, "layer")} retain app layer kind, visibility, opacity, locks, blend mode, and selection state.`,
    psd: `${reportPlural(layers.length, "layer")} are mapped to PSD layers where possible; app-only descriptors stay in the preservation report.`,
    "browser-raster": `${reportPlural(layers.length, "layer")} are composited into flattened export pixels; large compatible exports can be emitted as independently composed tiles.`,
  })
  if (textLayers) add("Text layers", "preserved", "preserved", "flattened", {
    project: `${reportPlural(textLayers, "editable text layer")} retain typography, OpenType, path, shape, and extrusion metadata.`,
    psd: `${reportPlural(textLayers, "editable text layer")} round-trip through native PSD text engine descriptors; extended properties (variable axes, OpenType features, on-path geometry) are mirrored into the PSD XMP app-preservation payload, with layer-name markers retained only as a legacy fallback.`,
    "browser-raster": "Text is rasterized into the flattened export surface.",
  })
  if (shapeLayers) add("Shape layers", "preserved", "preserved", "flattened", {
    project: `${reportPlural(shapeLayers, "shape layer")} retain geometry, stroke, fill, radius, and custom-shape metadata.`,
    psd: `${reportPlural(shapeLayers, "shape layer")} round-trip as vector masks with native fill/stroke descriptors; custom-shape parameters and per-subpath metadata are mirrored into the PSD XMP app-preservation payload, with name markers retained only as a fallback.`,
    "browser-raster": "Vector shape geometry is rasterized into the flattened export surface.",
  })
  if (groupLayers) add("Groups", "preserved", "approximated", "flattened", {
    project: `${reportPlural(groupLayers, "group")} retain child relationship metadata, visibility, expanded state, and group opacity.`,
    psd: "Group child relationship metadata is mapped to PSD layer folders where possible; app-only group state is approximated.",
    "browser-raster": "Groups are flattened into the composite pixel result.",
  })
  if (blendModes.length) add("Blend modes", "preserved", "approximated", "flattened", {
    project: `Non-normal blend modes retained: ${blendModes.join(", ")}.`,
    psd: `PSD blend modes are mapped by name where possible; unsupported renderer differences are approximated for: ${blendModes.join(", ")}.`,
    "browser-raster": `Blend modes (${blendModes.join(", ")}) affect the flattened composite only.`,
  })
  if (maskedLayers) add("Masks", "preserved", "approximated", "flattened", {
    project: `${reportPlural(maskedLayers, "mask")} retain raster/vector mask metadata and pixels.`,
    psd: "Layer mask pixels are exported where compatible; vector/app mask metadata is approximated.",
    "browser-raster": "Masks affect the composite only; editable masks are not exported.",
  })
  if (layerNotes || layerMetadata) add("Layer notes and metadata", "preserved", "preserved", "unsupported", {
    project: `${reportPlural(layerNotes, "layer note")} and ${reportPlural(layerMetadata, "metadata-bearing layer")} retain searchable app-only annotations, tags, and custom key/value fields.`,
    psd: "Layer-level notes, tags, and custom key/value metadata are restored by this app from the PSD XMP app-preservation payload; they are not Photoshop-native layer records.",
    "browser-raster": "Layer-level notes and metadata are editor metadata and are omitted from flattened image exports.",
  })
  if (styledLayers) add("Layer styles", "preserved", "preserved", "flattened", {
    project: `${reportPlural(styledLayers, "styled layer")} retain editable effect settings.`,
    psd: `${reportPlural(styledLayers, "styled layer")} round-trip native PSD effects (drop/inner shadow, outer/inner glow, bevel, satin, color/gradient/pattern overlay, stroke) with global-light tracking.`,
    "browser-raster": "Layer styles are baked into the exported pixels.",
  })
  if (adjustmentLayers) add("Adjustment layers", "preserved", "approximated", "flattened", {
    project: `${reportPlural(adjustmentLayers, "adjustment layer")} retain non-destructive settings.`,
    psd: `${reportPlural(adjustmentLayers, "adjustment layer")} round-trip; 16 types (brightness-contrast, levels, curves, exposure, vibrance, hue-saturation, color-balance, black-white, photo-filter, channel-mixer, color-lookup, invert, posterize, threshold, gradient-map, selective-color) use native ag-psd descriptors. 6 unsupported types (shadows-highlights, hdr-toning, desaturate, match-color, replace-color, equalize) preserve editable params in the PSD XMP app-preservation payload, with layer-name tokens retained as fallback.`,
    "browser-raster": "Adjustments are baked into the flattened export pixels.",
  })
  if (smartFilters) add("Smart filters", "preserved", "approximated", "flattened", {
    project: `${reportPlural(smartFilters, "smart filter")} retain filter id, parameters, stack order, masks, opacity, blend mode, mask density, mask feather, and mask link state${smartFilterMasks ? `, including ${reportPlural(smartFilterMasks, "filter mask state")}` : ""}.`,
    psd: `${reportPlural(smartFilters, "smart filter")} bake their visual result into layer pixels for native compatibility, emit native placed-filter descriptors and filter-effect masks where ag-psd exposes them, and restore private app control state from the PSD XMP app-preservation payload.`,
    "browser-raster": "Smart filters are baked into the flattened export pixels.",
  })
  if (smartObjectLayers.length) add("Smart objects", "preserved", "approximated", "flattened", {
    project: `${reportPlural(smartObjectLayers.length, "smart object")} retain object layer records and transform state.`,
    psd: "Smart object layers export as compatible rendered layers with source limitations reported.",
    "browser-raster": "Smart objects are flattened to their current rendered pixels.",
  })
  if (smartObjectSources) add("Smart object sources", "preserved", "approximated", "flattened", {
    project: `${reportPlural(smartObjectSources, "smart source")} retain source canvas, link status, file name, relink metadata, exported-content timestamps, and edit-package descriptors${smartObjectEditPackages ? ` for ${reportPlural(smartObjectEditPackages, "package")}` : ""}.`,
    psd: `${reportPlural(smartObjectSources, "smart source")} round-trip via the native PSD placedLayer (PlLd/SoLd) descriptor + linkedFiles array; embedded PNG bytes are capped at 30 MB per source; ids are hashed to GUIDs the writer requires.`,
    "browser-raster": "Source documents are not included in browser raster exports.",
  })
  if (smartObjectFileHandles) add("File System Access links", "preserved", "unsupported", "unsupported", {
    project: `${reportPlural(smartObjectFileHandles, "smart object file handle reference")} retain handle name, permission status, file modified time, and content hash when available; live FileSystemFileHandle objects are intentionally not serialized.`,
    psd: "Browser File System Access handles cannot be represented in native PSD bytes.",
    "browser-raster": "Linked source handles are omitted from flattened image exports.",
  })
  if (linkedSmartObjects) add("Linked smart object references", "preserved", "approximated", "flattened", {
    project: `${reportPlural(linkedSmartObjects, "linked smart object reference")} retain local path/status metadata, source hashes, permission state, and relink/update timestamps.`,
    psd: "Native placedLayer/linkedFiles records carry the linked path and source id, while live browser File System Access handles and permission grants must be restored by relinking in this app.",
    "browser-raster": "Linked source references are flattened to the current rendered pixels.",
  })
  if (doc.channels?.length) add("Alpha and saved channels", "preserved", "preserved", "unsupported", {
    project: `${reportPlural(doc.channels.length, "saved channel")} retain editable channel pixels.`,
    psd: `${reportPlural(doc.channels.length, "saved channel")} round-trip through a hidden marker group; native PSD alphaChannelNames carries the names and spot channels use a [spot:#rrggbb:opacity] naming convention.`,
    "browser-raster": "Extra channels, spot channels, and saved alpha channels are not emitted by browser raster encoders.",
  })
  if (doc.comps?.length) add("Layer comps", "preserved", "approximated", "unsupported", {
    project: `${reportPlural(doc.comps.length, "layer comp")} retain appearance snapshots.`,
    psd: `${reportPlural(doc.comps.length, "layer comp")} export as native PSD layer comps (flags + comment); per-layer state snapshots embed as base64 JSON in the comment for round-trip.`,
    "browser-raster": "Layer comps are not included in flattened image exports.",
  })
  if (doc.guides?.length) add("Guides", "preserved", "unsupported", "unsupported", {
    project: `${reportPlural(doc.guides.length, "guide")} retain orientation, position, and color.`,
    psd: `${reportPlural(doc.guides.length, "guide")} are written to gridAndGuidesInformation but Photoshop discards guides on import from non-native sources.`,
    "browser-raster": "Guides are non-printing editor metadata and are omitted.",
  })
  if (doc.slices?.length) add("Slices", "preserved", "unsupported", "unsupported", {
    project: `${reportPlural(doc.slices.length, "slice")} retain web export regions and selected slice state.`,
    psd: `${reportPlural(doc.slices.length, "slice")} are written through the PSD slices image resource but legacy slice tooling is removed from current Photoshop versions.`,
    "browser-raster": "Slices are not included in single-image browser exports.",
  })
  if (exportPresets) add("Export presets", "preserved", "unsupported", "unsupported", {
    project: `${reportPlural(exportPresets, "export preset")} retain reusable settings in the asset library.`,
    psd: "Export preset metadata is not a native PSD export payload.",
    "browser-raster": "Export presets are editor metadata and are omitted from the exported image.",
  })
  if (doc.timelineFrames?.length || videoLayers) add("Timeline and video", "preserved", "approximated", "flattened", {
    project: `${reportPlural(doc.timelineFrames?.length ?? videoLayers, "timeline entry", "timeline entries")} retain frame, video, transition, keyframe, and audio metadata.`,
    psd: "Timeline/video records are reported and represented by poster/current-frame pixels where possible.",
    "browser-raster": "Video and animation state is flattened to the current composite frame unless a dedicated animation exporter is used.",
  })
  if (threeDLayers) add("3D scenes", "preserved", "approximated", "flattened", {
    project: `${reportPlural(threeDLayers, "3D layer")} retain browser-native scene, mesh, material, camera, and print-check metadata.`,
    psd: "3D scene metadata is reported and represented by rendered layer pixels.",
    "browser-raster": "3D layers are flattened to their current rendered preview.",
  })
  if (doc.plugins?.length || pluginAssets) add("Plugin and cloud descriptors", "preserved", "unsupported", "unsupported", {
    project: `${reportPlural((doc.plugins?.length ?? 0) + pluginAssets, "plugin/library descriptor")} retain local integration metadata.`,
    psd: "Plugin, cloud-library, and extension descriptors are not authored as native PSD resources.",
    "browser-raster": "Plugin and library metadata is omitted from exported images.",
  })
  if (doc.variableDataSets?.length) add("Variable data", "preserved", "unsupported", "unsupported", {
    project: `${reportPlural(doc.variableDataSets.length, "variable data set")} retain rows, bindings, and active row state.`,
    psd: "Variable data sets are app-only metadata in this implementation.",
    "browser-raster": "Variable data is omitted from flattened image exports.",
  })
  if (doc.metadata) add("File metadata", "preserved", "preserved", "approximated", {
    project: "IPTC-style metadata and local content credentials are serialized.",
    psd: "Document metadata round-trips through the native PSD XMP image resource; IPTC/EXIF blobs are built for sidecar use but not surfaced by ag-psd's public ImageResources type.",
    "browser-raster": "Raster exports embed supported metadata when Embed Metadata is enabled: PNG/JPEG/TIFF/WebP/AVIF use XMP-style payloads, TIFF also writes IPTC/EXIF directories, and TGA/Netpbm use native comments/developer metadata.",
  })
  if (doc.printSettings) add("Print settings", "preserved", "preserved", "unsupported", {
    project: `${doc.printSettings.paperSize} print setup, marks, bleed, and color-handling metadata retained.`,
    psd: "Print settings round-trip through the native printScale + printFlags resources; paper size, orientation, and bleed are recovered via an embedded JSON extra payload.",
    "browser-raster": "Print settings are non-printing editor metadata and are omitted from raster exports.",
  })
  if (doc.notes?.length) add("Notes", "preserved", "preserved", "unsupported", {
    project: `${reportPlural(doc.notes.length, "note")} retain author, text, position, and color metadata.`,
    psd: `${reportPlural(doc.notes.length, "note")} round-trip through the native PSD annotations records.`,
    "browser-raster": "Notes are editor metadata and are omitted from raster exports.",
  })
  if (doc.dpi || doc.globalLight) add("Resolution and global light", "preserved", "preserved", "approximated", {
    project: `${doc.dpi ? `${doc.dpi} DPI` : "Default resolution"} and global light (${doc.globalLight?.angle ?? 30}°/${doc.globalLight?.altitude ?? 30}°) are retained.`,
    psd: "Resolution round-trips through resolutionInfo; global light angle/altitude round-trip through globalAngle/globalAltitude resources and inform layer effects.",
    "browser-raster": "Resolution is metadata; raster encoders may include a DPI chunk but never global-light data.",
  })
  if (doc.colorManagement || specialMode) add("Color and bit depth", "preserved", "approximated", "approximated", {
    project: `${doc.colorMode}/${doc.bitDepth}-bit intent${profile ? ` with ${profile}` : ""} is retained as document metadata.`,
    psd: `${doc.colorMode}/${doc.bitDepth}-bit metadata round-trips through colorMode/bitsPerChannel; ICC profile bytes round-trip through the iccProfile resource. High-bit side-band pixels are retained by the project format while PSD-compatible pixels are rasterized for native handoff.`,
    "browser-raster": doc.bitDepth > 8
      ? `${doc.colorMode}/${doc.bitDepth}-bit typed-array pixels are preserved by TIFF/PNM high-bit export paths where supported; browser-native formats use the 8-bit preview.`
      : `${doc.colorMode}/${doc.bitDepth}-bit intent is converted through browser RGBA export; ICC profiles are embedded for PNG/JPEG/TIFF/WebP and recorded in AVIF/TGA/Netpbm metadata where requested.`,
  })

  const totals = reportTotals(entries)
  const summary = `${manifestTargetLabel(target)}: ${totals.preserved} preserved, ${totals.approximated} approximated, ${totals.flattened} flattened, ${totals.unsupported} unsupported.`
  return { target, entries, totals, summary }
}

export function createExportLimitationReport(
  doc: PsDocument,
  options: ExportLimitationOptions,
): ExportLimitationReport {
  const items: CompatibilityManifestEntry[] = []
  const format = options.format
  const layers = doc.layers.length
  const hasEditableVectors = doc.layers.some((layer) => layer.kind === "shape" || layer.vectorMask)
  const hasEditableText = doc.layers.some((layer) => layer.kind === "text")
  const hasExtraChannels = (doc.channels?.length ?? 0) > 0 || doc.colorMode === "Multichannel"
  const highBitOrNonRgb = doc.bitDepth > 8 || doc.colorMode !== "RGB"
  const metadataRequested = !!options.includeMetadata
  const profile = doc.colorManagement?.assignedProfile
  const highBitPreservingFormat = doc.bitDepth > 8 && (
    format === "tiff" ||
    format === "ppm" ||
    format === "pgm"
  )

  const add = (label: string, status: ReportStatus, detail: string) => {
    items.push({ label, status, detail })
  }

  if (format === "metadata-json") {
    add("Metadata sidecar", "preserved", "Exports document metadata, color management, print settings, layer descriptors, channels, slices, timeline frames, and compatibility reports as structured JSON.")
    add("Layer descriptors", "preserved", `${reportPlural(layers, "layer")} are described without baking pixel data into the sidecar.`)
    if (doc.timelineFrames?.length) add("Timeline frame descriptors", "preserved", `${reportPlural(doc.timelineFrames.length, "timeline frame")} retain names, durations, and transition metadata.`)
    if (doc.slices?.length) add("Slice descriptors", "preserved", `${reportPlural(doc.slices.length, "slice")} retain web-export bounds and names.`)
    if (doc.channels?.length) add("Channel descriptors", "preserved", `${reportPlural(doc.channels.length, "channel")} retain channel names and visibility flags.`)
    const totals = reportTotals(items)
    return {
      format,
      items,
      summary: `${format.toUpperCase()} export limitations: ${totals.flattened} flattened, ${totals.approximated} approximated, ${totals.unsupported} unsupported.`,
    }
  }

  const rasterLikeFormat = format !== "svg" && format !== "apng" && format !== "animated-webp"
  if (rasterLikeFormat) {
    const tileExportPlan = planTileOnlyExport({
      documentWidth: doc.width,
      documentHeight: doc.height,
      format,
      scale: 1,
      tileSize: 1024,
      layers: doc.layers.map((layer) => ({ id: layer.id, kind: layer.kind, visible: layer.visible })),
    })
    if (tileExportPlan.mode === "tile-stream" && tileExportPlan.tileCount > 1) {
      add(
        "Tile-only export execution",
        "preserved",
        `${format.toUpperCase()} can be exported as ${tileExportPlan.tileCount} independently composited ${tileExportPlan.tileSize}px tiles with a manifest, avoiding a ${doc.width} x ${doc.height}px canvas allocation.`,
      )
    } else if (tileExportPlan.unsupportedLayerIds.length) {
      add(
        "Tile-only export execution",
        "approximated",
        `Tile-sequence export is blocked by unsupported layer payloads (${tileExportPlan.unsupportedLayerIds.join(", ")}); browser canvas export remains the fallback.`,
      )
    }
  }

  add("Layer structure", "flattened", `${reportPlural(layers, "layer")} are composited into the exported ${format.toUpperCase()} result.`)
  if (hasEditableText) add("Editable text", "flattened", "Text remains editable in the project format, but browser image exports contain rasterized glyph pixels.")
  if (hasEditableVectors || format === "svg") {
    add("Editable vector structure", format === "svg" ? "approximated" : "flattened", format === "svg"
      ? "SVG export embeds the rendered document for visual reliability and emits simple shape/text layer elements where browser-safe geometry is available."
      : "Shape and vector-mask geometry is baked into browser raster pixels.")
  }
  if (doc.bitDepth > 8 && highBitPreservingFormat) {
    add(
      "High-bit sample export",
      format === "tiff" ? "preserved" : "approximated",
      format === "tiff"
        ? `${doc.bitDepth}-bit typed-array pixels are encoded directly into TIFF sample data before any 8-bit preview fallback.`
        : `${doc.bitDepth}-bit typed-array pixels are encoded into 16-bit Netpbm samples, preserving more precision than the browser canvas preview.`,
    )
  }
  if (doc.colorMode !== "RGB" || (highBitOrNonRgb && !highBitPreservingFormat)) {
    add(
      "RGBA export conversion",
      "approximated",
      doc.bitDepth > 8 && !highBitPreservingFormat
        ? `${doc.colorMode}/${doc.bitDepth}-bit document intent is flattened through browser 8-bit RGBA canvas data.`
        : `${doc.colorMode} document intent is composited into RGB export pixels; editable source color-model channels are not embedded.`,
    )
  }
  if (hasExtraChannels) {
    add("Spot and extra channels", "unsupported", "Spot, alpha, and multichannel data are not embedded by browser raster encoders.")
  }
  if (profile || doc.colorManagement) {
    const outputProfile = rasterExportOutputProfile(doc) ?? profile ?? "sRGB IEC61966-2.1"
    add("ICC profile conversion", "preserved", `Export pixels are converted from ${profile ?? "sRGB IEC61966-2.1"} to ${outputProfile} through the browser-local ICC transform engine before encoding.`)
    add(
      "ICC profile embedding",
      format === "png" || format === "jpeg" || format === "tiff" || format === "webp" || format === "avif" || format === "tga" || format === "ppm" || format === "pgm" || format === "pbm" ? "preserved" : "unsupported",
      format === "png"
        ? `${outputProfile} is embedded in an iCCP chunk alongside the converted pixels.`
        : format === "jpeg"
          ? `${outputProfile} is embedded in JPEG APP2 ICC_PROFILE segment(s) alongside the converted pixels.`
          : format === "tiff"
            ? `${outputProfile} is embedded in TIFF tag 34675 alongside the converted pixels.`
            : format === "webp"
              ? `${outputProfile} is embedded in a WebP ICCP chunk and the VP8X ICC flag is set when available.`
              : format === "avif"
                ? `${outputProfile} is embedded in an AVIF UUID metadata box alongside the encoded payload.`
                : format === "tga"
                  ? `${outputProfile} is recorded in TGA developer metadata alongside the exported pixels.`
                  : format === "ppm" || format === "pgm" || format === "pbm"
                    ? `${outputProfile} is recorded in Netpbm comments alongside the exported samples.`
                    : `${outputProfile} conversion is applied to pixels, but this export encoder does not carry an ICC profile payload.`,
    )
  }
  if (metadataRequested) {
    add("Metadata embedding", format === "png" || format === "jpeg" || format === "tiff" || format === "webp" || format === "avif" || format === "tga" || format === "ppm" || format === "pgm" || format === "pbm" ? "preserved" : format === "svg" ? "approximated" : "unsupported", format === "png"
      ? "PNG export embeds author, copyright, description, creation date, XMP text chunks, and C2PA caBX provenance chunks."
      : format === "jpeg"
        ? "JPEG export embeds XMP APP1 metadata and C2PA APP11 provenance payloads."
        : format === "tiff"
          ? "TIFF export embeds baseline text tags, IPTC tag 33723, XMP tag 700, EXIF IFD tag 34665, ICC tag 34675, C2PA tag 52545, and local content credentials."
          : format === "webp"
            ? "WebP export injects XMP, C2PA, and ICC RIFF chunks when the browser returns a real WebP container."
            : format === "avif"
              ? "AVIF export inserts C2PA and appends XMP/ICC UUID boxes when the browser returns a real AVIF container."
              : format === "tga"
                ? "TGA export writes a TGA 2.0 extension area plus a developer metadata record."
                : format === "ppm" || format === "pgm" || format === "pbm"
                  ? "Netpbm export writes comments and source max-value metadata in the file header."
        : format === "svg"
          ? "SVG export includes a compact app metadata block, not full IPTC/XMP/content-credential payloads."
          : "This format does not carry the app's export metadata fields.")
    if (doc.metadata?.contentCredentials?.length) {
      add("Content Credentials", "preserved", `${reportPlural(doc.metadata.contentCredentials.length, "local content credential")} are embedded in C2PA carrier payloads plus app XMP/metadata records; they are unsigned local manifests, not certificate-backed C2PA signatures.`)
    }
  }

  if (format === "png") {
    if (options.interlaced) add("Interlaced PNG", "preserved", "The app writes Adam7 interlaced PNG scan passes with its typed-array PNG encoder.")
    add("PNG color chunks", profile || doc.colorManagement ? "preserved" : "unsupported", profile || doc.colorManagement
      ? "PNG export authors an iCCP profile chunk for the selected output profile."
      : "PNG export does not author gAMA/cHRM/iCCP color chunks without an assigned output profile.")
  } else if (format === "jpeg") {
    if (options.progressive) add("Progressive JPEG", "preserved", "The app routes JPEG export through the MozJPEG progressive encoder.")
    if (options.transparent !== false) add("Alpha transparency", "flattened", "JPEG has no alpha channel; transparent pixels are composited against the selected matte.")
    add("JPEG quality", "approximated", `Requested quality ${Math.round(Number(options.quality ?? 92))}% is passed to the selected JPEG encoder; exact quantization remains encoder-defined.`)
  } else if (format === "tiff") {
    add("TIFF encoder", "preserved", doc.bitDepth > 8
      ? `Exports typed-array RGBA TIFF strips at ${doc.bitDepth} bits per channel with ${(options.tiffCompression ?? "none").toUpperCase()} compression.`
      : `Exports baseline RGBA TIFF strips with ${(options.tiffCompression ?? "none").toUpperCase()} compression.`)
    add("TIFF metadata", metadataRequested ? "preserved" : "info", metadataRequested
      ? "TIFF export writes ImageDescription, DateTime, Artist, Copyright, IPTC, XMP, EXIF, ICC, and C2PA metadata tags."
      : "Enable metadata to write TIFF ImageDescription, DateTime, Artist, Copyright, IPTC, XMP, EXIF, ICC, and C2PA tags.")
  } else if (format === "webp") {
    add("WebP encoder controls", "approximated", "Browser WebP exposes quality to the encoder; lossless, near-lossless, method, and exact-alpha intent are authored into the XMP encoder-control record and preset state for downstream tools.")
    add("WebP metadata", metadataRequested ? "preserved" : "info", metadataRequested
      ? "The app post-processes browser WebP bytes to add XMP and C2PA RIFF chunks and set the VP8X metadata flag when possible."
      : "Enable metadata to post-process real browser WebP bytes with XMP and C2PA RIFF chunks.")
  } else if (format === "avif") {
    add("AVIF encoder controls", "approximated", "Browser AVIF exposes limited quality intent; lossless, speed, bit-depth, chroma, and tile intent are authored into the XMP encoder-control record and preset state for downstream tools.")
    add("AVIF metadata", metadataRequested ? "preserved" : "info", metadataRequested
      ? "The app inserts a C2PA UUID box and appends XMP UUID metadata to AVIF ISOBMFF output when the browser encoder returns AVIF bytes."
      : "Enable metadata to insert C2PA and XMP UUID metadata boxes into real browser AVIF bytes.")
  } else if (format === "gif") {
    add("GIF palette", "approximated", "GIF export quantizes to a 256-color indexed palette with limited transparency.")
    if (doc.timelineFrames?.length) add("Frame animation", "approximated", "Timeline frames can be converted to GIF frames, but advanced video/audio metadata is not retained.")
  } else if (format === "svg") {
    add("SVG image wrapper", "info", "The SVG stores the current rendered document as an embedded raster image for visual round-trip reliability.")
    add("SVG layer metadata", options.includeMetadata ? "preserved" : "info", options.includeMetadata
      ? "A compact app metadata block records document dimensions and layer descriptors."
      : "Enable metadata to include document dimensions and layer descriptors.")
  } else if (format === "tga") {
    add("TGA encoder", "preserved", options.tgaRle ? "Exports RLE-compressed 32-bit top-left TGA pixels with alpha." : "Exports uncompressed 32-bit top-left TGA pixels with alpha.")
    add("TGA metadata", metadataRequested ? "preserved" : "info", metadataRequested
      ? "TGA export writes a 2.0 extension area and a developer-directory JSON metadata record."
      : "Enable metadata to write a TGA 2.0 extension area and developer-directory metadata.")
  } else if (format === "ppm" || format === "pgm" || format === "pbm") {
    add("Portable AnyMap encoder", "preserved", doc.bitDepth > 8 && format !== "pbm"
      ? `${format.toUpperCase()} export writes binary high-bit typed-array samples in the matching Netpbm family format.`
      : `${format.toUpperCase()} export writes binary browser-generated pixels in the matching Netpbm family format.`)
    add("Portable AnyMap metadata", metadataRequested ? "preserved" : "info", metadataRequested
      ? "Netpbm export writes comments and source max-value metadata in the header."
      : "Enable metadata to write Netpbm comments and source max-value metadata.")
  } else if (format === "apng") {
    add("APNG encoder", "preserved", "Exports PNG/APNG chunks with RGBA frames and per-frame delays.")
    add("Frame animation", "preserved", doc.timelineFrames?.length
      ? `${reportPlural(doc.timelineFrames.length, "timeline frame")} are encoded as APNG frames.`
      : "Single-frame APNG export is available when no timeline frames exist.")
    add("APNG optimization", "approximated", "Frames are stored as full-frame RGBA payloads instead of delta-optimized animation rectangles.")
  } else if (format === "animated-webp") {
    add("Animated WebP encoder", "approximated", "Browser Canvas encodes still WebP frames and the app wraps them into a RIFF WebP animation with VP8X, ANIM, and ANMF chunks.")
    add("Frame animation", doc.timelineFrames?.length ? "preserved" : "info", doc.timelineFrames?.length
      ? `${reportPlural(doc.timelineFrames.length, "timeline frame")} are encoded as animated WebP frames when the browser static WebP encoder is available.`
      : "Single-frame animated WebP export is available when no timeline frames exist.")
  }

  const totals = reportTotals(items)
  return {
    format,
    items,
    summary: `${format.toUpperCase()} export limitations: ${totals.flattened} flattened, ${totals.approximated} approximated, ${totals.unsupported} unsupported.`,
  }
}

export function createExportCompatibilityManifest(
  doc: PsDocument,
  options: ExportLimitationOptions,
): ExportCompatibilityManifest {
  const limitationReport = createExportLimitationReport(doc, options)
  const compatibility = createCompatibilityManifest(doc, "browser-raster")
  const entries = [...compatibility.entries, ...limitationReport.items]
  const totals = reportTotals(entries)
  const warnings: string[] = []

  if (options.format === "jpeg" && options.transparent) {
    warnings.push("JPEG does not preserve transparency; transparent pixels are composited against the matte color.")
  }
  if ((options.quality ?? 100) < 70 && ["jpeg", "webp", "avif"].includes(options.format)) {
    warnings.push(`${options.format.toUpperCase()} quality is below 70; visible compression artifacts are likely.`)
  }
  if (
    options.includeMetadata &&
    options.format !== "svg" &&
    options.format !== "metadata-json" &&
    options.format !== "png" &&
    options.format !== "jpeg" &&
    options.format !== "tiff" &&
    options.format !== "webp" &&
    options.format !== "avif" &&
    options.format !== "tga" &&
    options.format !== "ppm" &&
    options.format !== "pgm" &&
    options.format !== "pbm"
  ) {
    warnings.push(`${options.format.toUpperCase()} export does not embed the app's metadata fields.`)
  }
  const highBitPreservingExport = doc.bitDepth > 8 && (
    options.format === "tiff" ||
    options.format === "ppm" ||
    options.format === "pgm"
  )
  if (doc.bitDepth > 8 && !highBitPreservingExport) {
    warnings.push(`${doc.colorMode}/${doc.bitDepth}-bit document intent is converted through an 8-bit browser canvas export path.`)
  } else if (doc.colorMode !== "RGB") {
    warnings.push(`${doc.colorMode} document intent is composited into RGB export pixels.`)
  }
  if (doc.layers.length > 1) {
    warnings.push(`${doc.layers.length} layers are flattened into a single exported output surface.`)
  }

  const riskLevel =
    totals.unsupported > 0 || totals.flattened > 2 || warnings.length >= 3
      ? "high"
      : totals.flattened > 0 || totals.approximated > 1 || warnings.length
        ? "medium"
        : "low"

  return {
    app: "Photoshop Web",
    format: "ps-export-manifest",
    version: 1,
    generatedAt: new Date().toISOString(),
    target: "browser-raster",
    document: {
      id: doc.id,
      name: doc.name,
      width: doc.width,
      height: doc.height,
      colorMode: doc.colorMode,
      bitDepth: doc.bitDepth,
      layerCount: doc.layers.length,
    },
    export: options,
    entries,
    totals,
    warnings,
    riskLevel,
    summary: `${options.format.toUpperCase()} compatibility manifest: ${riskLevel} risk, ${totals.flattened} flattened, ${totals.approximated} approximated, ${totals.unsupported} unsupported.`,
  }
}

function parseProjectEnvelope(text: string) {
  try {
    return JSON.parse(text)
  } catch (firstError) {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1))
      } catch {}
    }
    throw firstError
  }
}

export function createDocumentReport(
  doc: PsDocument,
  source: DocumentReport["source"],
): DocumentReport {
  const items: DocumentReport["items"] = []
  const layers = doc.layers
  const smartFilters = layers.reduce((sum, layer) => sum + (layer.smartFilters?.length ?? 0), 0)
  const adjustmentLayers = layers.filter((layer) => layer.kind === "adjustment").length
  const styledLayers = layers.filter((layer) => layer.style).length
  const maskedLayers = layers.filter((layer) => layer.mask || layer.vectorMask).length
  const textLayers = layers.filter((layer) => layer.kind === "text").length
  const shapeLayers = layers.filter((layer) => layer.kind === "shape").length
  const groupLayers = layers.filter((layer) => layer.kind === "group").length
  const blendModes = [...new Set(layers.map((layer) => layer.blendMode).filter((mode) => mode && mode !== "normal"))]
  const smartObjectLayers = layers.filter((layer) => layer.kind === "smart-object" || layer.smartObject)
  const smartObjectSources = smartObjectLayers.filter((layer) => layer.smartSource).length
  const linkedSmartObjects = smartObjectLayers.filter((layer) => layer.smartSource?.linkType === "linked").length
  const missingSmartObjects = smartObjectLayers.filter((layer) => layer.smartSource?.status === "missing").length
  const smartObjectEditPackages = smartObjectLayers.filter((layer) => layer.smartSource?.editPackage).length
  const smartObjectFileHandles = smartObjectLayers.filter((layer) => layer.smartSource?.fileHandleName || layer.smartSource?.handlePermission).length
  const smartFilterMasks = layers.reduce((sum, layer) => sum + (layer.smartFilters?.filter((filter) => filter.mask || filter.maskEnabled === false).length ?? 0), 0)
  const layerNotes = layers.reduce((sum, layer) => sum + (layer.notes?.length ?? 0), 0)
  const layerMetadata = layers.filter((layer) => layer.metadata).length
  const exportPresets = (doc.assetLibrary ?? []).filter((asset) => asset.kind === "export").length
  items.push({ label: "Canvas", status: "preserved", detail: `${doc.width} x ${doc.height}px, ${doc.colorMode}, ${doc.bitDepth}-bit metadata retained.` })
  if (doc.metadata?.largeDocumentInspection) {
    const inspection = doc.metadata.largeDocumentInspection
    items.push({
      label: "Large document inspection",
      status: "info",
      detail: `${inspection.sourceName} parsed as ${inspection.originalWidth} x ${inspection.originalHeight}px; pixels were not opened for editing. ${inspection.reason}`,
    })
  }
  if (doc.metadata?.largeDocumentTileView) {
    const tileView = doc.metadata.largeDocumentTileView
    items.push({
      label: "Large document tile view",
      status: "approximated",
      detail: `${tileView.sourceName} is represented by a ${doc.width} x ${doc.height}px overview plus ${tileView.tileColumns} x ${tileView.tileRows} full-resolution tiles.`,
    })
  }
  if (doc.metadata?.largeDocumentTileEdit) {
    const tileEdit = doc.metadata.largeDocumentTileEdit
    items.push({
      label: "Large document tile edit",
      status: "info",
      detail: `Editing tile ${tileEdit.tile.col},${tileEdit.tile.row} from ${tileEdit.sourceName}; update the source tile to write changes back to the tile cache.`,
    })
  }
  if (doc.metadata?.psdRepairPlan) {
    const repair = doc.metadata.psdRepairPlan
    items.push({
      label: "PSD repair plan",
      status: "info",
      detail: `${repair.summary} ${repair.actions.slice(0, 3).map((action) => `${action.label} -> ${action.localRepresentation}`).join("; ")}`,
    })
  }
  if (source.includes("PSD") && (doc.bitDepth === 16 || doc.bitDepth === 32)) {
    items.push({
      label: "Bit depth",
      status: "approximated",
      detail: `Document declares ${doc.bitDepth}-bit/channel but the PSD writer only emits 8-bit/channel; pixel data is written at 8-bit while the original depth is retained in project metadata.`,
    })
  }
  if (source.includes("PSD") && doc.colorMode && doc.colorMode !== "RGB" && doc.colorMode !== "Grayscale" && doc.colorMode !== "Bitmap") {
    items.push({
      label: "Color mode",
      status: "approximated",
      detail: `Document declares ${doc.colorMode} but the browser canvas renders 8-bit RGBA; PSD export converts pixels via the RGB composite while preserving the original mode flag.`,
    })
  }
  for (const capabilityWarning of capabilityWarningsForDocument(doc)) {
    const status =
      capabilityWarning.status === "unsupported"
        ? "unsupported"
        : capabilityWarning.status === "stub" || capabilityWarning.status === "approximation"
          ? "approximated"
          : "info"
    items.push({
      label: capabilityWarning.label,
      status,
      detail: capabilityWarning.recommendedAction
        ? `${capabilityWarning.detail} ${capabilityWarning.recommendedAction}`
        : capabilityWarning.detail,
    })
  }
  const manifest = createCompatibilityManifest(doc, compatibilityTargetForSource(source))
  items.push({
    label: "Compatibility manifest",
    status: manifest.totals.unsupported > 0 || manifest.totals.flattened > 0 ? "info" : "preserved",
    detail: manifest.summary,
  })
  if (doc.metadata) items.push({ label: "File info", status: "preserved", detail: "IPTC-style title, author, copyright, description, and keyword metadata retained in project format." })
  if (doc.colorManagement) items.push({ label: "Color management", status: "preserved", detail: `${doc.colorManagement.assignedProfile} profile and proofing settings retained in project format.` })
  if (doc.printSettings) items.push({ label: "Print settings", status: "preserved", detail: `${doc.printSettings.paperSize} print setup, marks, bleed, and color-handling metadata retained.` })
  items.push({ label: "Project schema", status: "info", detail: "Project saves use schema version 2 with migration-aware loading and recovery from wrapped JSON text." })
  items.push({ label: "Layers", status: "preserved", detail: `${layers.length} layer records retained with visibility, opacity, blend mode, and lock state.` })
  if (textLayers) items.push({ label: "Text layers", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${textLayers} editable text layer${textLayers === 1 ? "" : "s"} round-trip through the native PSD text engine; extended properties (variable axes, OpenType features, on-path geometry) are mirrored into the PSD XMP app-preservation payload, with layer-name markers retained only as a legacy fallback.` })
  if (shapeLayers) items.push({ label: "Shape layers", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${shapeLayers} shape layer${shapeLayers === 1 ? "" : "s"} round-trip as vector masks with native fill/stroke descriptors; custom-shape parameters and per-subpath metadata are mirrored into the PSD XMP app-preservation payload, with name markers retained only as a fallback.` })
  if (groupLayers) items.push({ label: "Groups", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${groupLayers} group layer${groupLayers === 1 ? "" : "s"} retain child relationship metadata; PSD export maps folders natively.` })
  if (blendModes.length) items.push({ label: "Blend modes", status: source.includes("PSD") ? "approximated" : "preserved", detail: `Non-normal blend modes modeled for round trip: ${blendModes.join(", ")}.` })
  const threeDLayers = layers.filter((layer) => layer.kind === "3d").length
  const videoLayers = layers.filter((layer) => layer.kind === "video").length
  if (threeDLayers) items.push({ label: "3D layers", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${threeDLayers} browser-native 3D scene layer${threeDLayers === 1 ? "" : "s"} retained with mesh, material, light, and camera metadata.` })
  if (videoLayers) items.push({ label: "Video layers", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${videoLayers} video layer${videoLayers === 1 ? "" : "s"} retained with poster frame, timing, keyframe, and audio metadata.` })
  if (maskedLayers) items.push({ label: "Masks", status: "preserved", detail: `${maskedLayers} raster/vector mask entry${maskedLayers === 1 ? "" : "ies"} serialized.` })
  if (layerNotes || layerMetadata) items.push({ label: "Layer notes and metadata", status: "preserved", detail: source.includes("PSD")
    ? `${layerNotes} layer note${layerNotes === 1 ? "" : "s"} and ${layerMetadata} metadata-bearing layer${layerMetadata === 1 ? "" : "s"} restore in this app from the PSD XMP app-preservation payload; they are not Photoshop-native layer records.`
    : `${layerNotes} layer note${layerNotes === 1 ? "" : "s"} and ${layerMetadata} metadata-bearing layer${layerMetadata === 1 ? "" : "s"} retained as app-only searchable annotations, tags, and custom key/value fields.` })
  if (styledLayers) items.push({ label: "Layer styles", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${styledLayers} styled layer${styledLayers === 1 ? "" : "s"} round-trip native PSD effects (shadow/glow/bevel/satin/overlays/stroke) with global-light tracking.` })
  if (adjustmentLayers) items.push({
    label: "Adjustment layers",
    status: source.includes("PSD") ? "approximated" : "preserved",
    detail: source.includes("PSD")
      ? `${adjustmentLayers} non-destructive adjustment layer${adjustmentLayers === 1 ? "" : "s"} round-trip the current visual result; 16 types use native ag-psd descriptors. The 6 remaining types (shadows-highlights, hdr-toning, desaturate, match-color, replace-color, equalize) preserve editable params in the PSD XMP app-preservation payload, with layer-name tokens retained as fallback.`
      : `${adjustmentLayers} non-destructive adjustment layer${adjustmentLayers === 1 ? "" : "s"} retained in project format.`,
  })
  if (smartFilters) items.push({ label: "Smart filters", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${smartFilters} smart filter${smartFilters === 1 ? "" : "s"} bake their visual result into the layer's exported pixels; supported filters emit native placed-filter descriptors and filter-effect masks${smartFilterMasks ? ` (${smartFilterMasks} mask state${smartFilterMasks === 1 ? "" : "s"})` : ""}, while private app control state restores from the PSD XMP app-preservation payload.` })
  if (smartObjectSources) items.push({ label: "Smart object sources", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${smartObjectSources} smart source${smartObjectSources === 1 ? "" : "s"} round-trip via the native PSD placedLayer + linkedFiles array (embedded PNG bytes capped at 30 MB), with app project preservation for relink metadata, export timestamps, and ${smartObjectEditPackages} edit package${smartObjectEditPackages === 1 ? "" : "s"}.` })
  if (smartObjectFileHandles) items.push({ label: "File System Access smart links", status: source.includes("PSD") ? "unsupported" : "preserved", detail: `${smartObjectFileHandles} linked smart object handle reference${smartObjectFileHandles === 1 ? "" : "s"} retain handle name, permission state, content hash, and modified time; live browser FileSystemFileHandle objects are intentionally not serialized.` })
  if (linkedSmartObjects) items.push({ label: "Linked smart objects", status: source.includes("PSD") ? "approximated" : "info", detail: `${linkedSmartObjects} linked smart object reference${linkedSmartObjects === 1 ? "" : "s"} round-trip via the linkedFiles "linked" type; the source file is referenced by path, while live browser file handles and permission grants must be restored by relinking.` })
  if (missingSmartObjects) items.push({ label: "Missing smart object links", status: "unsupported", detail: `${missingSmartObjects} smart object link${missingSmartObjects === 1 ? " is" : "s are"} marked missing and require relink before source edits are reliable.` })
  if (doc.channels?.length) items.push({ label: "Alpha channels", status: "preserved", detail: `${doc.channels.length} saved channel${doc.channels.length === 1 ? "" : "s"} retained; PSD round-trip stores pixel data in a hidden group whose layer names follow the "[spot:#rrggbb:opacity]" convention for spot channels, and the alphaChannelNames image resource carries the human-readable channel name table.` })
  if (doc.timelineFrames?.length) items.push({ label: "Timeline", status: source.includes("PSD") ? "approximated" : "preserved", detail: `${doc.timelineFrames.length} frame/video timeline entries retained in project format.` })
  if (doc.plugins?.length) items.push({ label: "Plugin descriptors", status: source.includes("PSD") ? "unsupported" : "preserved", detail: `${doc.plugins.length} CEP/UX/8BF-style local plugin descriptor${doc.plugins.length === 1 ? "" : "s"} retained.` })
  if (doc.variableDataSets?.length) items.push({ label: "Variable data", status: source.includes("PSD") ? "unsupported" : "preserved", detail: `${doc.variableDataSets.length} variable data set${doc.variableDataSets.length === 1 ? "" : "s"} retained for data-driven graphics.` })
  if (doc.comps?.length) items.push({ label: "Layer comps", status: source.includes("PSD") ? "unsupported" : "preserved", detail: `${doc.comps.length} layer comp${doc.comps.length === 1 ? "" : "s"} retained; PSD layer-comp records carry visibility/position/style flags natively, and the full per-layer state snapshot is appended to the comp's comment field as "__ps-web-comp:<base64-json>" — Photoshop displays the comment verbatim, this app strips the prefix and decodes the JSON back into a comp on import.` })
  if (exportPresets) items.push({ label: "Export presets", status: source.includes("PSD") ? "unsupported" : "preserved", detail: `${exportPresets} reusable export preset${exportPresets === 1 ? "" : "s"} retained in the asset library.` })
  if (doc.guides?.length) items.push({ label: "Guides", status: source.includes("PSD") ? "unsupported" : "preserved", detail: `${doc.guides.length} guide${doc.guides.length === 1 ? "" : "s"} round-trip through the native gridAndGuidesInformation resource.` })
  if (doc.slices?.length) items.push({ label: "Slices", status: source.includes("PSD") ? "unsupported" : "preserved", detail: `${doc.slices.length} web export slice${doc.slices.length === 1 ? "" : "s"} round-trip through the native PSD slices resource.` })
  if (doc.notes?.length) items.push({ label: "Notes", status: "preserved", detail: `${doc.notes.length} note${doc.notes.length === 1 ? "" : "s"} round-trip through the native PSD annotations records.` })
  if (source.includes("PSD")) {
    items.push({ label: "PSD interoperability boundary", status: "approximated", detail: "3D, video, plugin, cloud library, and vendor metadata are preserved in the app project format; PSD import/export keeps a raster-compatible approximation." })
    const clipWarnings = validateClippingGroup(layers).warnings
    if (clipWarnings.length) {
      items.push({
        label: "Clipping groups",
        status: "info",
        detail: `${clipWarnings.length} clipping warning${clipWarnings.length === 1 ? "" : "s"}: ${clipWarnings.slice(0, 3).join("; ")}${clipWarnings.length > 3 ? "; ..." : ""}`,
      })
    }
  }
  return {
    id: `report_${Math.random().toString(36).slice(2, 9)}`,
    title: `${source}: ${doc.name}`,
    createdAt: Date.now(),
    source,
    items,
  }
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a")
  a.href = dataUrl
  a.download = filename
  a.click()
}

export function downloadText(text: string, filename: string, type = "application/json") {
  const blob = new Blob([text], { type })
  downloadBlob(blob, filename)
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  try {
    downloadDataUrl(url, filename)
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

export function canvasFromDataUrl(dataUrl: string | null | undefined, w: number, h: number) {
  return new Promise<HTMLCanvasElement>((resolve, reject) => {
    const canvas = makeIoCanvas(w, h)
    if (!dataUrl) {
      resolve(canvas)
      return
    }
    if (typeof dataUrl !== "string" || dataUrl.length > MAX_PROJECT_DATA_URL_CHARS || !SAFE_CANVAS_DATA_URL.test(dataUrl)) {
      reject(new Error("Project contains unsupported or oversized canvas image data"))
      return
    }
    const img = new Image()
    img.onload = () => {
      try {
        const size = assertCanvasSize(img.naturalWidth || w, img.naturalHeight || h, "Project image")
        canvas.width = size.width
        canvas.height = size.height
        canvas.getContext("2d")!.drawImage(img, 0, 0)
        resolve(canvas)
      } catch (error) {
        reject(error)
      }
    }
    img.onerror = () => reject(new Error("Could not load canvas image data"))
    img.src = dataUrl
  })
}

async function deserializeLayer(serialized: Record<string, unknown>, docW: number, docH: number): Promise<Layer> {
  const { canvasDataUrl, maskDataUrl, frame, smartFilters, smartSource, highBitImageData, ...rest } = serialized
  const canvas = await canvasFromDataUrl(canvasDataUrl as string | undefined, docW, docH)
  const mask = maskDataUrl ? await canvasFromDataUrl(maskDataUrl as string, docW, docH) : null
  const restoredFrame = frame
    ? {
        ...(frame as Record<string, unknown>),
        imageCanvas: (frame as Record<string, unknown>).imageDataUrl ? await canvasFromDataUrl((frame as Record<string, unknown>).imageDataUrl as string, docW, docH) : null,
        imageDataUrl: undefined,
      }
    : undefined
  const restoredSmartFilters = smartFilters
    ? await Promise.all(
        (smartFilters as unknown[]).map(async (sf) => {
          const { maskDataUrl: smartMaskDataUrl, ...filterRest } = sf as Record<string, unknown>
          return {
            ...filterRest,
            mask: smartMaskDataUrl ? await canvasFromDataUrl(smartMaskDataUrl as string, docW, docH) : undefined,
          }
        }),
      )
    : undefined
  const restoredSmartSource = smartSource
    ? {
        ...(smartSource as Record<string, unknown>),
        width: (smartSource as Record<string, unknown>).width as number ?? docW,
        height: (smartSource as Record<string, unknown>).height as number ?? docH,
        canvas: (smartSource as Record<string, unknown>).canvasDataUrl
          ? await canvasFromDataUrl((smartSource as Record<string, unknown>).canvasDataUrl as string, (smartSource as Record<string, unknown>).width as number ?? docW, (smartSource as Record<string, unknown>).height as number ?? docH)
          : null,
        canvasDataUrl: undefined,
      }
    : undefined
  const layer = {
    ...rest,
    id: cleanText(rest.id, uid("layer"), 80),
    name: cleanText(rest.name, "Layer"),
    kind: cleanLayerKind(rest.kind),
    visible: rest.visible !== false,
    locked: rest.locked === true,
    opacity: clampNumber(rest.opacity, 0, 1, 1),
    fillOpacity: rest.fillOpacity === undefined ? undefined : clampNumber(rest.fillOpacity, 0, 1, 1),
    blendMode: cleanBlendMode(rest.blendMode),
    canvas,
    mask,
    frame: restoredFrame,
    smartFilters: restoredSmartFilters,
    smartSource: restoredSmartSource,
  } as Layer
  const highBit = deserializeHighBitImagePayload(highBitImageData)
  if (highBit && highBit.width === layer.canvas.width && highBit.height === layer.canvas.height) {
    ;(layer as HighBitLayer).__highBitImageData = highBit
  }
  return layer
}

export async function deserializeProject(text: string): Promise<PsDocument> {
  const parsed = parseProjectEnvelope(text)
  const sourceCandidate = (parsed && typeof parsed === "object" && parsed.document) ?? parsed
  if (!sourceCandidate || typeof sourceCandidate !== "object" || Array.isArray(sourceCandidate)) {
    throw new Error("Project payload is not an object")
  }
  const source = sourceCandidate as Record<string, unknown>
  const { width, height } = assertCanvasSize(
    Number(source.width) || 1200,
    Number(source.height) || 800,
    "Project canvas",
  )
  if (!Array.isArray(source.layers) || source.layers.length === 0) {
    throw new Error("Project does not contain any layers")
  }
  if (source.layers.length > MAX_PROJECT_LAYERS) {
    throw new Error(`Project contains too many layers. Maximum supported layers: ${MAX_PROJECT_LAYERS}.`)
  }

  const layers = await Promise.all(
    (source.layers as Record<string, unknown>[]).map((l) => deserializeLayer(l, width, height)),
  )
  const channelEntries = Array.isArray(source.channels) ? (source.channels as Record<string, unknown>[]) : []
  if (channelEntries.length > MAX_PROJECT_CHANNELS) {
    throw new Error(`Project contains too many alpha channels. Maximum supported channels: ${MAX_PROJECT_CHANNELS}.`)
  }
  const channels = await Promise.all(
    channelEntries.map(async (ch) => ({
      id: cleanText(ch.id, uid("channel"), 80),
      name: cleanText(ch.name, "Alpha"),
      kind: ch.kind === "spot" ? "spot" as const : "alpha" as const,
      spotColor: typeof ch.spotColor === "string" ? cleanText(ch.spotColor, "#ff00ff", 20) : undefined,
      spotOpacity: typeof ch.spotOpacity === "number" ? Math.max(0, Math.min(100, ch.spotOpacity)) : undefined,
      canvas: await canvasFromDataUrl(ch.canvasDataUrl as string | undefined, width, height),
    })),
  )

  const rawSelection =
    source.selection && typeof source.selection === "object" && !Array.isArray(source.selection)
      ? (source.selection as Record<string, unknown>)
      : { bounds: null, shape: "rect" }
  const selectionMaskRaw = (rawSelection as Record<string, unknown>).maskDataUrl
  const selectionMask =
    typeof selectionMaskRaw === "string"
      ? await canvasFromDataUrl(selectionMaskRaw, width, height)
      : null
  const quickMaskCanvas =
    typeof source.quickMaskCanvasDataUrl === "string"
      ? await canvasFromDataUrl(source.quickMaskCanvasDataUrl as string, width, height)
      : null

  const activeLayerId =
    typeof source.activeLayerId === "string" && layers.some((l) => l.id === source.activeLayerId)
      ? (source.activeLayerId as string)
      : layers[layers.length - 1].id
  const selectedLayerIds = Array.isArray(source.selectedLayerIds)
    ? (source.selectedLayerIds as unknown[]).filter(
        (id): id is string => typeof id === "string" && layers.some((l) => l.id === id),
      )
    : [activeLayerId]

  // The selection bounds shape is constrained to a small rect literal; we
  // reject anything else so a malicious project file cannot ship selection
  // coordinates with non-numeric keys that other code paths would later
  // multiply / add into Math.NaN cascades.
  const selectionBoundsRaw = (rawSelection as Record<string, unknown>).bounds
  let selectionBounds: PsDocument["selection"]["bounds"] = null
  if (selectionBoundsRaw && typeof selectionBoundsRaw === "object" && !Array.isArray(selectionBoundsRaw)) {
    const b = selectionBoundsRaw as Record<string, unknown>
    if (
      typeof b.x === "number" && Number.isFinite(b.x) &&
      typeof b.y === "number" && Number.isFinite(b.y) &&
      typeof b.w === "number" && Number.isFinite(b.w) &&
      typeof b.h === "number" && Number.isFinite(b.h)
    ) {
      selectionBounds = { x: b.x, y: b.y, w: b.w, h: b.h }
    }
  }
  const ALLOWED_SELECTION_SHAPES = new Set<Selection["shape"]>([
    "rect", "ellipse", "polygon", "freehand", "wand", "color",
  ])
  const selectionShape: Selection["shape"] = isAllowedEnum(
    (rawSelection as Record<string, unknown>).shape,
    ALLOWED_SELECTION_SHAPES,
  )
    ? ((rawSelection as Record<string, unknown>).shape as Selection["shape"])
    : "rect"
  const selectionFeatherRaw = (rawSelection as Record<string, unknown>).feather
  const selectionFeather =
    typeof selectionFeatherRaw === "number" && Number.isFinite(selectionFeatherRaw)
      ? Math.max(0, Math.min(250, selectionFeatherRaw))
      : undefined

  // Resolve the bit-depth as an 8/16/32 union, accepting both numeric and
  // string inputs because older project files serialised the depth as a
  // string. Anything else falls back to 8.
  const rawBitDepth = source.bitDepth
  let bitDepth: PsDocument["bitDepth"] = 8
  if (rawBitDepth === 16 || rawBitDepth === "16") bitDepth = 16
  else if (rawBitDepth === 32 || rawBitDepth === "32") bitDepth = 32
  const documentHighBit = deserializeHighBitImagePayload(source.highBitImageData)
  const validatedDocumentHighBit = documentHighBit && documentHighBit.width === width && documentHighBit.height === height
    ? documentHighBit
    : undefined

  // Construct the result via an explicit allow-list. Every field is either
  // typed-and-validated (the dangerous ones — colors, anything that can
  // hit a CSS sink) or shape-bounded via safeJsonValue (non-DOM metadata
  // like notes, slices, asset libraries, etc.).
  return {
    id: uid("doc"),
    name: cleanText(source.name, "Loaded Project"),
    width,
    height,
    zoom: clampNumber(source.zoom, 0.05, 64, 1),
    layers,
    activeLayerId,
    selectedLayerIds: selectedLayerIds.length ? selectedLayerIds : [activeLayerId],
    background: cleanCssColor(source.background, "#ffffff"),
    colorMode: isAllowedEnum(source.colorMode, ALLOWED_COLOR_MODES)
      ? source.colorMode
      : "RGB",
    bitDepth,
    ...(validatedDocumentHighBit ? { __highBitImageData: validatedDocumentHighBit } : {}),
    selection: {
      bounds: selectionBounds,
      shape: selectionShape,
      feather: selectionFeather,
      mask: selectionMask,
    },
    rotation: (() => {
      const r = source.rotation
      return r === 0 || r === 90 || r === 180 || r === 270 ? r : 0
    })(),
    guides: cleanGuides(source.guides),
    showGrid: source.showGrid === true,
    showSmartGuides: source.showSmartGuides !== false,
    gridSize: clampNumber(source.gridSize, 1, 10000, 50),
    gridColor: cleanCssColor(source.gridColor, "#78b4ff"),
    gridSubdivisions: clampNumber(source.gridSubdivisions, 1, 64, 1),
    gridOpacity: clampNumber(source.gridOpacity, 0, 1, 0.42),
    showPixelGrid: source.showPixelGrid === true,
    snap: source.snap !== false,
    snapToGrid: source.snapToGrid === true,
    snapToGuides: source.snapToGuides !== false,
    quickMask: source.quickMask === true,
    quickMaskCanvas,
    channels,

    // Pure-data passthroughs: these fields never reach a CSS sink directly
    // (notes/comps/counts render text content via React, which escapes;
    // asset libraries/timeline frames are normalised again at use sites).
    // safeJsonValue drops __proto__/constructor/prototype keys, bounds
    // string/array/object size, and rejects non-finite numbers.
    notes: safeJsonArray<NonNullable<PsDocument["notes"]>[number]>(source.notes),
    slices: safeJsonArray<NonNullable<PsDocument["slices"]>[number]>(source.slices) ?? [],
    selectedSliceId: typeof source.selectedSliceId === "string"
      ? cleanText(source.selectedSliceId, "", 120) || undefined
      : undefined,
    counts: safeJsonArray<NonNullable<PsDocument["counts"]>[number]>(source.counts),
    countGroup: typeof source.countGroup === "string"
      ? cleanText(source.countGroup, "", 80) || undefined
      : undefined,
    colorSamplers: safeJsonArray<NonNullable<PsDocument["colorSamplers"]>[number]>(source.colorSamplers),
    comps: safeJsonArray<NonNullable<PsDocument["comps"]>[number]>(source.comps),
    measurement: cleanMeasurement(source.measurement),
    rulerUnits: isAllowedEnum(source.rulerUnits, ALLOWED_RULER_UNITS)
      ? source.rulerUnits
      : undefined,
    rulerOrigin: cleanRulerOrigin(source.rulerOrigin),
    globalLight: cleanGlobalLight(source.globalLight),
    patternLibrary: safeJsonArray<NonNullable<PsDocument["patternLibrary"]>[number]>(source.patternLibrary),
    stylePresets: safeJsonArray<NonNullable<PsDocument["stylePresets"]>[number]>(source.stylePresets),
    gradientPresets: safeJsonArray<NonNullable<PsDocument["gradientPresets"]>[number]>(source.gradientPresets),
    characterStyles: safeJsonObject<NonNullable<PsDocument["characterStyles"]>>(source.characterStyles),
    paragraphStyles: safeJsonObject<NonNullable<PsDocument["paragraphStyles"]>>(source.paragraphStyles),
    assetLibrary: safeJsonArray<NonNullable<PsDocument["assetLibrary"]>[number]>(source.assetLibrary),
    timelineFrames: safeJsonArray<NonNullable<PsDocument["timelineFrames"]>[number]>(source.timelineFrames),
    plugins: safeJsonArray<NonNullable<PsDocument["plugins"]>[number]>(source.plugins),
    pluginStorage: safeJsonObject<NonNullable<PsDocument["pluginStorage"]>>(source.pluginStorage),
    variableDataSets: safeJsonArray<NonNullable<PsDocument["variableDataSets"]>[number]>(source.variableDataSets),
    modeSettings: safeJsonObject<DocumentModeSettings>(source.modeSettings),
    // reports are generated at runtime (createDocumentReport); we never
    // restore them from a project file, since they reference the freshly
    // loaded layer canvases and the source-of-truth lives in editor state.
    reports: undefined,
    metadata: safeJsonObject<DocumentMetadata>(source.metadata),
    colorManagement: safeJsonObject<NonNullable<PsDocument["colorManagement"]>>(source.colorManagement),
    printSettings: safeJsonObject<NonNullable<PsDocument["printSettings"]>>(source.printSettings),
    smartObjectParent: cleanSmartObjectParent(source.smartObjectParent),
    dpi: typeof source.dpi === "number" && Number.isFinite(source.dpi)
      ? Math.max(1, Math.min(9999, source.dpi))
      : undefined,
  } satisfies PsDocument
}

function psdColorToHex(color: unknown, fallback = "#ffffff") {
  if (!color || typeof color !== "object") return fallback
  const c = color as Record<string, unknown>
  const toHex = (value: unknown) => {
    const n = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round(value))) : 255
    return n.toString(16).padStart(2, "0")
  }
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`
}

function psdArtboardToApp(artboard: PsdLayer["artboard"] | undefined): NonNullable<Layer["artboard"]> | undefined {
  if (!artboard?.rect) return undefined
  const left = Math.round(Number(artboard.rect.left) || 0)
  const top = Math.round(Number(artboard.rect.top) || 0)
  const right = Math.round(Number(artboard.rect.right) || left)
  const bottom = Math.round(Number(artboard.rect.bottom) || top)
  return {
    x: left,
    y: top,
    w: Math.max(1, right - left),
    h: Math.max(1, bottom - top),
    background: psdColorToHex(artboard.color, artboard.backgroundType === 0 ? "transparent" : "#ffffff"),
  }
}

function psdPixelSourceToVideo(layer: PsdLayer): NonNullable<Layer["video"]> | undefined {
  const pixelSource = layer.pixelSource
  if (!pixelSource) return undefined
  const link = pixelSource.frameReader?.link
  const sourceName = link?.name || link?.relativePath || link?.fullPath || layer.name || "PSD video source"
  return {
    sourceName,
    durationMs: 0,
    currentTimeMs: 0,
    playbackRate: 1,
    inPointMs: 0,
    outPointMs: 0,
    keyframes: [],
  }
}

function appArtboardToPsd(layer: Layer): PsdLayer["artboard"] | undefined {
  if (!layer.artboard) return undefined
  return {
    rect: {
      top: layer.artboard.y,
      left: layer.artboard.x,
      bottom: layer.artboard.y + layer.artboard.h,
      right: layer.artboard.x + layer.artboard.w,
    },
    backgroundType: layer.artboard.background === "transparent" ? 0 : 1,
    color: parseHexColor(layer.artboard.background === "transparent" ? "#ffffff" : layer.artboard.background),
  }
}

function flattenPsdChildren(children: PsdLayer[] | undefined, docW: number, docH: number, parentId?: string) {
  const layers: Layer[] = []
  const directIds: string[] = []
  for (const child of [...(children ?? [])].reverse()) {
    if (isAlphaChannelMarkerLayer(child)) continue
    const isGroup = Array.isArray(child.children)
    if (isGroup) {
      const groupId = uid("group")
      const nested = flattenPsdChildren(child.children, docW, docH, groupId)
      layers.push(...nested.layers)
      const artboard = psdArtboardToApp(child.artboard)
      const group: Layer = {
        id: groupId,
        name: cleanText(stripMarkers(child.name ?? "") || child.name, "Group", MAX_LAYER_NAME_LENGTH),
        kind: artboard ? "artboard" : "group",
        visible: !child.hidden,
        locked: !!child.protected?.composite,
        lockTransparency: !!(child.transparencyProtected || child.protected?.transparency),
        lockDraw: !!child.protected?.composite,
        lockMove: !!child.protected?.position,
        lockAll: !!(child.protected?.composite && child.protected?.position && child.protected?.transparency),
        opacity: child.opacity ?? 1,
        blendMode: psdBlendToApp(child.blendMode),
        canvas: makeIoCanvas(docW, docH),
        childIds: nested.directIds,
        parentId,
        expanded: child.opened !== false,
        colorLabel: child.layerColor,
        artboard,
      }
      const groupAdvancedBlending = psdToAppAdvancedBlending(child)
      if (groupAdvancedBlending) group.advancedBlending = groupAdvancedBlending
      layers.push(group)
      directIds.push(groupId)
      continue
    }

    const layerId = uid("layer")
    const sourceCanvas = child.canvas
    const left = Math.round(child.left ?? 0)
    const top = Math.round(child.top ?? 0)

    const adjustment = psdLayerToAppAdjustment(child)
    const shape = adjustment ? null : psdShapeToApp(child) ?? decodeShapeMarker(child.name ?? "")
    const text = adjustment || shape ? null : (child.text ? psdTextToApp(child.text, left, top) : null)

    const maskInfo = child.mask ? psdLayerMaskToApp(child.mask, docW, docH) : null
    const vectorMaskPath = child.vectorMask ? psdVectorMaskOnLayerToApp(child.vectorMask) : null
    const artboard = psdArtboardToApp(child.artboard)
    const video = psdPixelSourceToVideo(child)
    const layerKind: Layer["kind"] = artboard
      ? "artboard"
      : video
        ? "video"
        : adjustment
          ? "adjustment"
          : shape
            ? "shape"
            : text
              ? "text"
              : vectorMaskPath
                ? "shape"
                : "raster"

    const layer: Layer = {
      id: layerId,
      name: cleanText(stripMarkers(child.name ?? "") || child.name, "Layer", MAX_LAYER_NAME_LENGTH),
      kind: layerKind,
      visible: !child.hidden,
      locked: !!child.protected?.composite,
      lockTransparency: !!(child.transparencyProtected || child.protected?.transparency),
      lockDraw: !!child.protected?.composite,
      lockMove: !!child.protected?.position,
      lockAll: !!(child.protected?.composite && child.protected?.position && child.protected?.transparency),
      opacity: child.opacity ?? 1,
      blendMode: psdBlendToApp(child.blendMode),
      linkGroupId: child.linkGroup ? String(child.linkGroup) : undefined,
      canvas: canvasAtDocumentSize(sourceCanvas, docW, docH, left, top),
      mask: maskInfo?.mask ?? null,
      clipped: child.clipping,
      parentId,
      text: text ?? undefined,
      shape: shape ?? undefined,
      vectorMask: vectorMaskPath ?? undefined,
      adjustment: adjustment ?? undefined,
      artboard,
      video,
      style: psdEffectsToLayerStyle(child.effects),
      colorLabel: child.layerColor,
    }
    if (maskInfo && !maskInfo.maskEnabled) layer.maskEnabled = false
    const advancedBlending = psdToAppAdvancedBlending(child)
    if (advancedBlending) layer.advancedBlending = advancedBlending
    const smartFilters = psdToAppSmartFilters(child)
    if (smartFilters && smartFilters.length) layer.smartFilters = smartFilters
    layers.push(layer)
    directIds.push(layerId)
  }
  return { layers, directIds }
}

export async function deserializePsdFile(file: File, options: PsdDeserializeOptions = {}): Promise<PsDocument> {
  assertFileSize(file, MAX_PSD_FILE_BYTES, "PSD file")
  const buffer = await file.arrayBuffer()
  const header = readPsdHeaderDimensions(buffer)
  if (
    header &&
    canvasSizeError(header.width || 1, header.height || 1, "PSD canvas") &&
    options.psbLargeDocumentMode &&
    options.psbLargeDocumentMode !== "full"
  ) {
    return deserializeOversizedPsb(buffer, file, options.psbLargeDocumentMode)
  }
  validatePsdHeaderDimensions(buffer, file.name)
  const { readPsd } = await loadPsdCodec()
  const metadata = readPsd(buffer, {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
    useImageData: false,
  })
  const { width, height } = assertCanvasSize(Math.round(metadata.width || 1), Math.round(metadata.height || 1), "PSD canvas")
  if (countPsdLayers(metadata.children) > MAX_PROJECT_LAYERS) {
    throw new Error(`PSD contains too many layers. Maximum supported layers: ${MAX_PROJECT_LAYERS}.`)
  }
  const psd = readPsd(buffer, {
    skipLayerImageData: false,
    skipCompositeImageData: false,
    skipThumbnail: true,
    useImageData: false,
  })
  const repairPlan = createPsdRepairPlanFromParsedPsd(psd)
  const appPreservationPayload = extractPsdAppPreservationFromXmp(psd.imageResources?.xmpMetadata)
  const flattened = flattenPsdChildren(psd.children, width, height)
  const layers = flattened.layers.length
    ? flattened.layers
    : [{
        id: uid("layer"),
        name: "Background",
        kind: "raster" as const,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal" as const,
        canvas: canvasAtDocumentSize(psd.canvas, width, height),
      }]

  // Async smart-object decoding pass — read any embedded linked-file
  // PNG bytes back into HTMLCanvasElement sources.
  const linkedFilesById = new Map<string, NonNullable<Psd["linkedFiles"]>[number]>()
  for (const linked of (psd as Psd & { linkedFiles?: NonNullable<Psd["linkedFiles"]> }).linkedFiles ?? []) {
    if (linked?.id) linkedFilesById.set(linked.id, linked)
  }
  const layerNodes = collectPsdLayerNodes(psd.children)
  for (const layer of layers) {
    if (layer.kind !== "smart-object" && layer.kind !== "raster") continue
    const node = layerNodes.shift()
    if (!node) break
    if (!(node as PsdLayer & { placedLayer?: unknown }).placedLayer) continue
    const smartSource = await psdSmartObjectToAppLayer(node, width, height, linkedFilesById)
    if (smartSource) {
      layer.smartSource = smartSource
      layer.smartObject = true
      layer.kind = "smart-object"
    }
  }

  const colorModeData = psdColorModeData(psd)
  const colorModeResult = psdColorModeToApp(psd.colorMode ?? 3, colorModeData ?? undefined)
  const bitDepth = psdBitDepthToApp(
    psd.bitsPerChannel as 1 | 8 | 16 | 32 | undefined,
    psd.colorMode ?? 3,
  )
  const iccExtraction = extractIccProfile(psd)
  const docMetadata = psdMetadataToApp(psd)
  const docGuides = psdGuidesToApp(psd.imageResources?.gridAndGuidesInformation?.guides)
  const docSlices = psdSlicesToApp(
    (psd.imageResources as ImageResources & { slices?: unknown })?.slices as
      | Parameters<typeof psdSlicesToApp>[0]
      | undefined,
  )
  const docComps = psdLayerCompsToApp(
    psd.imageResources?.layerComps as Parameters<typeof psdLayerCompsToApp>[0],
    layers,
  )
  const docNotes = psdNotesToApp(psd)
  const docPrint = psdPrintSettingsToApp(psd)
  const docGlobalLight = psdGlobalLightToApp(psd) ?? { angle: 120, altitude: 30 }
  const docDpi = psdResolutionToApp(psd.imageResources?.resolutionInfo)
  const alphaChannels = await psdAlphaChannelsToApp(psd, width, height)
  const storedPaths = psdResourceToAppPaths(psd)
  const nativeSourceSnapshot = createPsdNativeSourceSnapshot(buffer, file.name, {
    format: header?.version === 2 ? "psb" : "psd",
    width,
    height,
    colorMode: colorModeResult.colorMode,
    bitDepth,
  })
  const mergedMetadata = hasMeaningfulMetadata(docMetadata) || nativeSourceSnapshot
    ? {
        ...(hasMeaningfulMetadata(docMetadata) ? docMetadata : {}),
        ...(nativeSourceSnapshot ? { psdNativeSource: nativeSourceSnapshot } : {}),
      }
    : undefined

  const activeLayerId = [...layers].reverse().find((layer) => layer.kind !== "group")?.id ?? layers[layers.length - 1].id
  const doc: PsDocument = {
    id: uid("doc"),
    name: file.name.replace(/\.(?:psd|psb)$/i, ""),
    width,
    height,
    zoom: 1,
    layers,
    activeLayerId,
    selectedLayerIds: [activeLayerId],
    background: "#ffffff",
    colorMode: colorModeResult.colorMode,
    modeSettings: colorModeResult.modeSettings,
    bitDepth,
    selection: { bounds: null, shape: "rect" },
    rotation: 0,
    guides: docGuides,
    showGrid: false,
    showSmartGuides: true,
    gridSize: 50,
    snap: true,
    snapToGrid: false,
    snapToGuides: true,
    quickMask: false,
    quickMaskCanvas: null,
    rulerUnits: "px",
    rulerOrigin: { x: 0, y: 0 },
    gridColor: "#78b4ff",
    gridSubdivisions: 1,
    gridOpacity: 0.42,
    showPixelGrid: false,
    slices: docSlices,
    globalLight: docGlobalLight,
    notes: docNotes.length ? docNotes : undefined,
    channels: alphaChannels.length ? alphaChannels : undefined,
    comps: docComps.length ? docComps : undefined,
    metadata: mergedMetadata,
    printSettings: docPrint,
    dpi: docDpi,
  }
  if (iccExtraction) {
    const profileName = iccExtraction.profileName
    const isCmyk = doc.colorMode === "CMYK"
    const isGray = doc.colorMode === "Grayscale"
    const assignedProfile = mapIccNameToAssignedProfileLoose(profileName, doc.colorMode)
    type ColorMgmt = NonNullable<PsDocument["colorManagement"]>
    const workingSpace: ColorMgmt["workingSpace"] = isCmyk
      ? "Working CMYK"
      : assignedProfile === "Working CMYK" || assignedProfile === "Dot Gain 20%" || assignedProfile === "Gray Gamma 2.2"
        ? "sRGB IEC61966-2.1"
        : (assignedProfile as ColorMgmt["workingSpace"])
    doc.colorManagement = {
      assignedProfile,
      workingSpace,
      renderingIntent: "perceptual",
      blackPointCompensation: true,
      proofProfile: isCmyk ? "Working CMYK" : isGray ? "Dot Gain 20%" : "None",
      proofColors: false,
      gamutWarning: false,
    } satisfies ColorMgmt
  }
  if (repairPlan.actions.length) {
    doc.metadata = {
      ...(doc.metadata ?? {}),
      psdRepairPlan: {
        summary: repairPlan.summary,
        actions: repairPlan.actions.map((action) => ({
          label: action.label,
          status: action.status,
          localRepresentation: action.localRepresentation,
          detail: action.detail,
        })),
      },
    }
  }
  if (appPreservationPayload) {
    await applyPsdAppPreservationPayload(doc, appPreservationPayload)
  }
  if (storedPaths.length) {
    const pathLayers = storedPaths.map((entry) => ({
      id: uid("path"),
      name: entry.name,
      kind: "shape" as const,
      visible: false,
      locked: false,
      opacity: 1,
      blendMode: "normal" as const,
      canvas: makeIoCanvas(width, height),
      path: entry.path,
    }))
    // Stored document paths are surfaced as hidden shape layers so the
    // app's Paths panel can re-attach them; mirroring Photoshop's "Paths"
    // resource into editable surfaces.
    doc.layers = [...pathLayers, ...doc.layers]
  }
  return doc
}

function collectPsdLayerNodes(children: PsdLayer[] | undefined): PsdLayer[] {
  const out: PsdLayer[] = []
  const walk = (list: PsdLayer[] | undefined) => {
    for (const child of (list ?? [])) {
      if (Array.isArray(child.children)) walk(child.children)
      else out.push(child)
    }
  }
  walk(children)
  return out
}

function pixelDataToScaledCanvas(pixelData: PixelData | undefined, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) {
  const canvas = makeIoCanvas(targetWidth, targetHeight)
  if (!pixelData?.data) return canvas
  const target = new ImageData(targetWidth, targetHeight)
  const source = pixelData.data
  const channels = Math.max(1, Math.floor(source.length / Math.max(1, sourceWidth * sourceHeight)))
  for (let y = 0; y < targetHeight; y++) {
    const sy = Math.min(sourceHeight - 1, Math.floor((y / targetHeight) * sourceHeight))
    for (let x = 0; x < targetWidth; x++) {
      const sx = Math.min(sourceWidth - 1, Math.floor((x / targetWidth) * sourceWidth))
      const src = (sy * sourceWidth + sx) * channels
      const dst = (y * targetWidth + x) * 4
      target.data[dst] = Number(source[src] ?? 0)
      target.data[dst + 1] = Number(source[src + 1] ?? source[src] ?? 0)
      target.data[dst + 2] = Number(source[src + 2] ?? source[src] ?? 0)
      target.data[dst + 3] = channels >= 4 ? Number(source[src + 3] ?? 255) : 255
    }
  }
  canvas.getContext("2d")!.putImageData(target, 0, 0)
  return canvas
}

function pixelDataToTileCanvas(pixelData: PixelData | undefined, sourceWidth: number, sourceHeight: number, x0: number, y0: number, tileWidth: number, tileHeight: number) {
  const canvas = makeIoCanvas(tileWidth, tileHeight)
  if (!pixelData?.data) return canvas
  const tile = new ImageData(tileWidth, tileHeight)
  const source = pixelData.data
  const channels = Math.max(1, Math.floor(source.length / Math.max(1, sourceWidth * sourceHeight)))
  for (let y = 0; y < tileHeight; y++) {
    const sy = y0 + y
    for (let x = 0; x < tileWidth; x++) {
      const sx = x0 + x
      const src = (sy * sourceWidth + sx) * channels
      const dst = (y * tileWidth + x) * 4
      tile.data[dst] = Number(source[src] ?? 0)
      tile.data[dst + 1] = Number(source[src + 1] ?? source[src] ?? 0)
      tile.data[dst + 2] = Number(source[src + 2] ?? source[src] ?? 0)
      tile.data[dst + 3] = channels >= 4 ? Number(source[src + 3] ?? 255) : 255
    }
  }
  canvas.getContext("2d")!.putImageData(tile, 0, 0)
  return canvas
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error("Could not encode PSB tile"))
    }, "image/png")
  })
}

async function registerPsbCompositeTiles(docId: string, pixelData: PixelData | undefined, sourceWidth: number, sourceHeight: number, plan: ReturnType<typeof planPsbLargeDocumentOpen>) {
  if (!pixelData?.data) return
  const store = new TiledBackingStore({
    width: sourceWidth,
    height: sourceHeight,
    tileSize: plan.tileView.tileSize,
    memoryBudgetMB: 256,
  })
  for (let row = 0; row < plan.tileView.tileRows; row++) {
    for (let col = 0; col < plan.tileView.tileColumns; col++) {
      const x = col * plan.tileView.tileSize
      const y = row * plan.tileView.tileSize
      const w = Math.min(plan.tileView.tileSize, sourceWidth - x)
      const h = Math.min(plan.tileView.tileSize, sourceHeight - y)
      const tile = pixelDataToTileCanvas(pixelData, sourceWidth, sourceHeight, x, y, w, h)
      await store.writeLayerTile({
        layerId: PSB_TILE_VIEW_LAYER_ID,
        layerKind: "raster",
        sourceVersion: PSB_TILE_VIEW_SOURCE_VERSION,
        col,
        row,
      }, await canvasToPngBlob(tile))
    }
  }
  registerPsbTileViewStore(docId, store)
}

async function deserializeOversizedPsb(buffer: ArrayBuffer, file: File, mode: Exclude<PsbLargeDocumentMode, "full">): Promise<PsDocument> {
  const header = readPsdHeaderDimensions(buffer)
  if (!header) throw new Error("Photoshop document header could not be read")
  const plan = planPsbLargeDocumentOpen({ width: header.width, height: header.height, fileName: file.name })
  const reducedPlan = planLargeDocumentOpen({
    fileName: file.name,
    kind: header.version === 2 ? "psb" : "psd",
    width: header.width,
    height: header.height,
  })
  const scale = mode === "downscale-50"
    ? 0.5
    : mode === "reduced-scale"
      ? reducedPlan.reducedScale.scale
      : plan.tileView.overviewScale
  const width = mode === "downscale-50"
    ? plan.downscale50.width
    : mode === "reduced-scale"
      ? reducedPlan.reducedScale.width
      : plan.tileView.overviewWidth
  const height = mode === "downscale-50"
    ? plan.downscale50.height
    : mode === "reduced-scale"
      ? reducedPlan.reducedScale.height
      : plan.tileView.overviewHeight
  const sizeError = canvasSizeError(width, height, mode === "tile-view" ? "PSB tile overview" : "Reduced PSB canvas")
  if (sizeError) throw new Error(sizeError)
  const { readPsd } = await loadPsdCodec()
  const psd = readPsd(buffer, {
    skipLayerImageData: true,
    skipCompositeImageData: false,
    skipThumbnail: true,
    useImageData: true,
  }) as Psd
  const canvas = pixelDataToScaledCanvas(psd.imageData, header.width, header.height, width, height)
  const docId = uid("doc")
  const layer: Layer = {
    id: uid("layer"),
    name: mode === "tile-view" ? "Tile overview" : mode === "downscale-50" ? "50% composite" : "Reduced composite",
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas,
    metadata: {
      description: `Source: ${file.name}`,
      tags: [header.version === 2 ? "psb" : "psd", mode],
      custom: {
        originalWidth: header.width,
        originalHeight: header.height,
        overviewScale: scale,
        tileSize: plan.tileView.tileSize,
        tileColumns: plan.tileView.tileColumns,
        tileRows: plan.tileView.tileRows,
      },
    },
  }
  if (mode === "tile-view") await registerPsbCompositeTiles(docId, psd.imageData, header.width, header.height, plan)
  return {
    id: docId,
    name: file.name.replace(/\.(?:psd|psb)$/i, mode === "tile-view" ? " (Tile Overview)" : mode === "downscale-50" ? " (50%)" : " (Reduced)"),
    width,
    height,
    zoom: 1,
    layers: [layer],
    activeLayerId: layer.id,
    selectedLayerIds: [layer.id],
    background: "#ffffff",
    colorMode: "RGB",
    bitDepth: 8,
    selection: { bounds: null, shape: "rect" },
    metadata: {
      title: file.name,
      description: mode !== "tile-view"
        ? `Opened oversized Photoshop document at ${(scale * 100).toFixed(1)}% scale from ${header.width} x ${header.height} px.`
        : `Opened oversized Photoshop document tile overview from ${header.width} x ${header.height} px using ${plan.tileView.tileColumns} x ${plan.tileView.tileRows} tiles.`,
      source: file.name,
      createdAt: new Date().toISOString(),
      largeDocumentTileView: mode === "tile-view" ? {
        mode: "psb-tile-view",
        sourceName: file.name,
        originalWidth: header.width,
        originalHeight: header.height,
        overviewScale: plan.tileView.overviewScale,
        tileSize: plan.tileView.tileSize,
        tileColumns: plan.tileView.tileColumns,
        tileRows: plan.tileView.tileRows,
        tileCount: plan.tileView.tileCount,
        selectedTile: { col: 0, row: 0 },
      } : undefined,
    },
  }
}

type AssignedProfile = NonNullable<PsDocument["colorManagement"]>["assignedProfile"]

function mapIccNameToAssignedProfileLoose(
  raw: string | undefined,
  colorMode: PsDocument["colorMode"],
): AssignedProfile {
  if (raw) {
    const lower = raw.toLowerCase()
    if (lower.includes("display p3") || lower.includes("displayp3")) return "Display P3"
    if (lower.includes("prophoto") || lower.includes("pro photo")) return "ProPhoto RGB"
    if (lower.includes("adobe rgb") || lower.includes("adobergb")) return "Adobe RGB (1998)"
    if (lower.includes("srgb")) return "sRGB IEC61966-2.1"
    if (lower.includes("dot gain") || lower.includes("dotgain")) return "Dot Gain 20%"
    if (lower.includes("gray gamma") || lower.includes("graygamma")) return "Gray Gamma 2.2"
    if (lower.includes("cmyk") || lower.includes("swop") || lower.includes("coated")) return "Working CMYK"
  }
  if (colorMode === "CMYK") return "Working CMYK"
  if (colorMode === "Grayscale") return "Dot Gain 20%"
  return "sRGB IEC61966-2.1"
}

function hasMeaningfulMetadata(m: ReturnType<typeof psdMetadataToApp>): boolean {
  if (!m) return false
  const fields: Array<keyof typeof m> = [
    "title",
    "author",
    "description",
    "copyright",
    "credit",
    "source",
    "createdAt",
    "modifiedAt",
  ]
  if (fields.some((f) => typeof m[f] === "string" && (m[f] as string).length > 0)) return true
  if (Array.isArray(m.keywords) && m.keywords.length > 0) return true
  return false
}

function psdChildrenFromLayers(
  doc: PsDocument,
  parentId?: string,
  linkedFiles?: NonNullable<Psd["linkedFiles"]>,
): PsdLayer[] {
  const direct = doc.layers.filter((layer) => layer.parentId === parentId)
  return [...direct].reverse().map((layer): PsdLayer => {
    const protectedState = {
      transparency: !!layer.lockTransparency,
      composite: !!(layer.lockDraw || layer.lockAll || layer.locked),
      position: !!(layer.lockMove || layer.lockAll),
    }
    const adjustmentExtras = layer.kind === "adjustment" ? appAdjustmentToPsdLayer(layer) : {}
    const advancedBlendExtras = appAdvancedBlendingToPsd(layer)
    const clippingExtras = appClippingToPsd(layer)
    const smartObjectExtras = layer.kind === "smart-object" && layer.smartSource
      ? appSmartObjectToPsdLayer(layer)
      : null
    const smartFilterExtras = appSmartFiltersToPsd(
      layer,
      (source) => cloneIoCanvas(source) ?? source,
    )

    const layerName = (adjustmentExtras as { name?: string }).name ?? layer.name
    const groupLike = layer.kind === "group" || layer.kind === "artboard"
    const base: PsdLayer = {
      name: layerName,
      hidden: !layer.visible,
      opacity: layer.opacity,
      blendMode: appBlendToPsd(groupLike ? "normal" : layer.blendMode),
      layerColor: (layer.colorLabel ?? "none") as LayerColor,
      transparencyProtected: !!layer.lockTransparency,
      protected: protectedState,
      clipping: clippingExtras.clipping,
      linkGroup: layer.linkGroupId ? Number.parseInt(layer.linkGroupId, 10) || undefined : undefined,
      effects: layerStyleToPsdEffects(layer.style, doc.globalLight),
    }
    if (groupLike) {
      return {
        ...base,
        ...advancedBlendExtras,
        artboard: appArtboardToPsd(layer),
        opened: layer.expanded !== false,
        children: psdChildrenFromLayers(doc, layer.id, linkedFiles),
      }
    }

    const sourceCanvas =
      (smartFilterExtras?.rastered as HTMLCanvasElement | undefined) ?? layer.canvas
    const baseCanvas = cloneIoCanvas(sourceCanvas) ?? makeIoCanvas(doc.width, doc.height)
    const mask = appLayerMaskToPsd(layer, doc.width, doc.height)
    const vectorMask = layer.vectorMask
      ? appVectorMaskOnLayerToPsd(layer.vectorMask, doc.width, doc.height)
      : undefined
    const textPayload = layer.text ? appTextToPsd(layer.text, 0, 0) : null
    const shapePayload = layer.shape ? appShapeToPsd(layer.shape, doc.width, doc.height) : null
    const additionalLayerInfo: Record<string, unknown> = {
      ...(smartFilterExtras?.additionalInfo ?? {}),
    }
    const out: PsdLayer = {
      ...base,
      ...advancedBlendExtras,
      ...adjustmentExtras,
      ...(textPayload ?? {}),
      top: 0,
      left: 0,
      bottom: doc.height,
      right: doc.width,
      canvas: baseCanvas,
      mask,
    }
    if (vectorMask) (out as PsdLayer).vectorMask = vectorMask
    else if (shapePayload?.vectorMask) (out as PsdLayer).vectorMask = shapePayload.vectorMask
    if (shapePayload?.vectorStroke) {
      (out as PsdLayer).vectorStroke = shapePayload.vectorStroke
    }
    if (shapePayload?.vectorFill) {
      ;(out as PsdLayer & { vectorFill?: unknown }).vectorFill = shapePayload.vectorFill
    }
    if (shapePayload?.markerName) out.name = shapePayload.markerName
    if (smartObjectExtras?.placedLayer) {
      ;(out as PsdLayer & { placedLayer?: unknown }).placedLayer = smartObjectExtras.placedLayer
    }
    if (smartObjectExtras?.linkedFile) linkedFiles?.push(smartObjectExtras.linkedFile)
    if (smartFilterExtras?.nativeFilter) {
      const placed = (out as PsdLayer & { placedLayer?: { filter?: unknown } }).placedLayer
      if (placed) placed.filter = smartFilterExtras.nativeFilter
    }
    if (smartFilterExtras?.filterEffectsMasks) {
      ;(out as PsdLayer).filterEffectsMasks = smartFilterExtras.filterEffectsMasks
    }
    if (Object.keys(additionalLayerInfo).length) {
      ;(out as PsdLayer & { additionalLayerInfo?: Record<string, unknown> }).additionalLayerInfo = additionalLayerInfo
    }
    return out
  })
}

export interface PsdSerializeOptions {
  psb?: boolean
  preserveNativeSource?: boolean
}

function canvasForNativeLayer(doc: PsDocument, layer: Layer): HTMLCanvasElement {
  if (layer.canvas?.width === doc.width && layer.canvas.height === doc.height) return layer.canvas
  const canvas = makeIoCanvas(doc.width, doc.height)
  const ctx = canvas.getContext("2d")
  if (ctx && layer.canvas) {
    ctx.drawImage(layer.canvas, 0, 0)
  }
  return canvas
}

function nativeLayerImageInput(
  doc: PsDocument,
  layer: Layer,
  bitDepth: 1 | 8 | 16 | 32,
): NativeLayeredPsdLayerInput | null {
  if (layer.kind === "group") return null
  const source = getLayerHighBitImage(layer, doc)
  const image = source && source.width === doc.width && source.height === doc.height
    ? source
    : createHighBitImageFromImageData(
        canvasImageData(canvasForNativeLayer(doc, layer)),
        {
          bitDepth: bitDepth === 1 ? 8 : bitDepth,
          colorMode: doc.colorMode,
          profile: doc.colorManagement?.assignedProfile,
        },
      )
  return {
    name: layer.name.slice(0, MAX_LAYER_NAME_LENGTH),
    image,
    blendMode: layer.blendMode,
    opacity: layer.opacity,
    hidden: !layer.visible,
    hasHighBitSource: !!source,
  }
}

function nativeLayerInputsFromDocument(
  doc: PsDocument,
  bitDepth: 1 | 8 | 16 | 32,
): NativeLayeredPsdLayerInput[] {
  return [...doc.layers]
    .reverse()
    .map((layer) => nativeLayerImageInput(doc, layer, bitDepth))
    .filter((layer): layer is NativeLayeredPsdLayerInput => !!layer)
}

export async function serializePsd(doc: PsDocument, options: PsdSerializeOptions = {}): Promise<Blob> {
  if (options.preserveNativeSource) {
    const sourceBytes = restorePsdNativeSourceSnapshot(doc.metadata?.psdNativeSource)
    if (sourceBytes) return new Blob([sourceBytes], { type: "image/vnd.adobe.photoshop" })
  }

  const colorModeExport = appColorModeToPsd(doc)
  const bitsPerChannel = appBitDepthToPsd(doc)
  const linkedFiles: NonNullable<Psd["linkedFiles"]> = []
  const children = psdChildrenFromLayers(doc, undefined, linkedFiles)

  // Prepend the saved-alpha-channel marker group so per-channel pixel
  // data survives a vanilla ag-psd write/read cycle (ag-psd does not
  // expose `Psd.channels` as a pixel array).
  const alphaMarkerGroup = appAlphaChannelsToMarkerLayers(doc)
  if (alphaMarkerGroup) children.unshift(alphaMarkerGroup)

  const alphaChannelInfo = appAlphaChannelsToPsd(doc)
  const guides = appGuidesToPsd(doc.guides)
  const slices = appSlicesToPsd(doc.slices, doc.width, doc.height)
  const layerComps = appLayerCompsToPsd(doc.comps)
  const metadataResources = appMetadataToPsdResources(doc.metadata)
  const appPreservation = createPsdAppPreservationPayload(doc)
  const xmpMetadata = appPreservation.layers.length
    ? embedPsdAppPreservationInXmp(metadataResources.xmpMetadata, appPreservation)
    : metadataResources.xmpMetadata
  const printResources = appPrintSettingsToPsdResources(doc.printSettings)
  const resolutionInfo = appResolutionToPsd(doc)
  const globalLightResources = appGlobalLightToPsdResources(doc.globalLight)
  const annotations = appNotesToPsd(doc.notes)
  const documentPathResources = appPathsToPsdResources(doc.layers)

  const imageResources: ImageResources = {
    resolutionInfo,
    ...(guides && guides.length ? { gridAndGuidesInformation: { guides } } : {}),
    ...(alphaChannelInfo.channelNames?.length
      ? { alphaChannelNames: alphaChannelInfo.channelNames }
      : {}),
    ...(xmpMetadata ? { xmpMetadata } : {}),
    ...(globalLightResources ?? {}),
    ...(printResources ?? {}),
    ...(slices ? { slices } : {}),
    ...(layerComps ? { layerComps } : {}),
  }

  // Document path resources are encoded as a marker token attached to the
  // PSD's top-level name (see psdResourceToAppPaths). ag-psd doesn't expose
  // 0x07D0+ path image resources directly through `imageResources`.
  const pathMarkerName = documentPathResources?.markerName

  if (bitsPerChannel !== 8 || doc.colorMode !== "RGB") {
    const highBit = getHighBitExportImage(doc, { transparent: true })
    const composite = highBit
      ? highBit
      : createHighBitImageFromImageData(
          canvasImageData(renderDocumentComposite(doc, { transparent: true })),
          {
            bitDepth: bitsPerChannel === 1 ? 8 : bitsPerChannel,
            colorMode: doc.colorMode,
            profile: doc.colorManagement?.assignedProfile,
          },
        )
    if (canWriteNativeLayeredPsd(doc)) {
      const nativeLayers = nativeLayerInputsFromDocument(doc, bitsPerChannel)
      if (nativeLayers.length) {
        const buffer = writeNativeLayeredPsd(doc, {
          psb: options.psb,
          xmpMetadata,
          colorModeData: colorModeExport.colorModeData,
          composite,
          layers: nativeLayers,
        })
        return new Blob([buffer], { type: "image/vnd.adobe.photoshop" })
      }
    }
    const buffer = writeNativeCompositePsd(doc, composite, {
      psb: options.psb,
      xmpMetadata,
      colorModeData: colorModeExport.colorModeData,
    })
    return new Blob([buffer], { type: "image/vnd.adobe.photoshop" })
  }

  const psd: Psd = {
    width: doc.width,
    height: doc.height,
    channels: 4,
    bitsPerChannel,
    colorMode: colorModeExport.colorMode,
    canvas: renderDocumentComposite(doc, { transparent: true }),
    children,
    imageResources,
    ...(linkedFiles.length ? { linkedFiles } : {}),
    ...(annotations.length ? { annotations } : {}),
    ...(pathMarkerName ? { name: pathMarkerName } : {}),
  }

  if (colorModeExport.palette) {
    ;(psd as Psd & { palette?: unknown }).palette = colorModeExport.palette
  }

  // Apply ICC profile bytes into the imageResources (or stash as side-band
  // metadata when ag-psd's writer can't emit the iccProfile field).
  applyIccProfileToPsd(doc, psd)

  const { writePsd } = await loadPsdCodec()
  const buffer = writePsd(psd, {
    generateThumbnail: false,
    noBackground: true,
    trimImageData: true,
    psb: options.psb,
  })
  return new Blob([buffer], { type: "image/vnd.adobe.photoshop" })
}

export async function serializePsb(doc: PsDocument): Promise<Blob> {
  return serializePsd(doc, { psb: true })
}

export async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  assertFileSize(file, MAX_RASTER_FILE_BYTES, "Image file")
  await assertRasterHeaderCanvasSize(file)
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        assertCanvasSize(img.naturalWidth, img.naturalHeight, "Image canvas")
        resolve(img)
      } catch (error) {
        reject(error)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`Could not load ${file.name}`))
    }
    img.src = url
  })
}

export async function loadRasterCanvasFromFile(file: File, options: LoadRasterCanvasOptions = {}): Promise<LoadedRasterCanvas> {
  assertFileSize(file, MAX_RASTER_FILE_BYTES, "Image file")
  const mode = options.mode ?? "full"
  const header = await inspectImportFileDimensions(file)
  if (mode === "full" && header?.kind === "raster") {
    assertCanvasSize(header.width, header.height, "Image canvas")
  }

  return new Promise<LoadedRasterCanvas>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const originalWidth = Math.max(1, Math.round(img.naturalWidth || header?.width || 1))
        const originalHeight = Math.max(1, Math.round(img.naturalHeight || header?.height || 1))
        const fullError = canvasSizeError(originalWidth, originalHeight, "Image canvas")
        const plan = planLargeDocumentOpen({
          fileName: file.name,
          kind: "raster",
          width: originalWidth,
          height: originalHeight,
          memoryBudgetMB: options.memoryBudgetMB,
          tileable: false,
        })

        if (mode === "full") {
          if (fullError) throw new Error(fullError)
          const canvas = makeIoCanvas(originalWidth, originalHeight)
          canvas.getContext("2d")!.drawImage(img, 0, 0)
          resolve({
            canvas,
            originalWidth,
            originalHeight,
            scale: 1,
            mode: "full",
            warnings: [],
          })
          return
        }

        if (!fullError) {
          const canvas = makeIoCanvas(originalWidth, originalHeight)
          canvas.getContext("2d")!.drawImage(img, 0, 0)
          resolve({
            canvas,
            originalWidth,
            originalHeight,
            scale: 1,
            mode: "full",
            warnings: [],
          })
          return
        }

        if (!plan.reducedScale.editable) {
          throw new Error(plan.inspection.reason)
        }
        const canvas = makeIoCanvas(plan.reducedScale.width, plan.reducedScale.height)
        const ctx = canvas.getContext("2d")!
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = "high"
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve({
          canvas,
          originalWidth,
          originalHeight,
          scale: plan.reducedScale.scale,
          mode: "reduced-scale",
          warnings: plan.warnings,
        })
      } catch (error) {
        reject(error)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`Could not load ${file.name}`))
    }
    img.src = url
  })
}

function countPsdLayers(children: PsdLayer[] | undefined): number {
  return (children ?? []).reduce((count, child) => count + 1 + countPsdLayers(child.children), 0)
}

/* =================== File System Access API helpers =================== */

/**
 * Check if the File System Access API is available (Chrome/Edge 86+).
 * Returns false in Firefox, Safari, and non-secure contexts.
 */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showSaveFilePicker === "function"
}

/**
 * Show a "Save As" file picker and return a FileSystemFileHandle.
 * Returns null if the user cancels or the API is unsupported.
 */
export async function showSaveProjectPicker(suggestedName = "project.psproj"): Promise<FileSystemFileHandle | null> {
  if (!isFileSystemAccessSupported()) return null
  try {
    const handle = await window.showSaveFilePicker!({
      suggestedName,
      types: [
        {
          description: "Photoshop Web Project",
          accept: { "application/json": [".psproj"] },
        },
        {
          description: "PSD File",
          accept: { "image/vnd.adobe.photoshop": [".psd", ".psb"] },
        },
      ],
    })
    return handle
  } catch {
    // User cancelled or permission denied
    return null
  }
}

/**
 * Write serialized project data to an existing FileSystemFileHandle.
 * Returns true on success, false on failure.
 */
export async function saveToFileHandle(
  handle: FileSystemFileHandle,
  data: string | Blob,
): Promise<boolean> {
  try {
    const writable = await handle.createWritable()
    await writable.write(typeof data === "string" ? new Blob([data], { type: "application/json" }) : data)
    await writable.close()
    return true
  } catch {
    return false
  }
}

/**
 * Show a "Save As" picker for raster image export.
 * Returns the handle or null if cancelled.
 */
export async function showExportImagePicker(
  suggestedName: string,
  format: "png" | "jpeg" | "webp" | "avif" | "gif" = "png",
): Promise<FileSystemFileHandle | null> {
  if (!isFileSystemAccessSupported()) return null
  const mimeMap: Record<string, string> = {
    png: "image/png",
    jpeg: "image/jpeg",
    webp: "image/webp",
    avif: "image/avif",
    gif: "image/gif",
  }
  const extMap: Record<string, string> = {
    png: ".png",
    jpeg: ".jpg",
    webp: ".webp",
    avif: ".avif",
    gif: ".gif",
  }
  try {
    const handle = await window.showSaveFilePicker!({
      suggestedName,
      types: [
        {
          description: `${format.toUpperCase()} Image`,
          accept: { [mimeMap[format] ?? "image/png"]: [extMap[format] ?? ".png"] },
        },
      ],
    })
    return handle
  } catch {
    return null
  }
}
