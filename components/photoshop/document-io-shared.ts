"use client"

import type {
Psd,
BlendMode as PsdBlendMode,
Layer as PsdLayer
} from "ag-psd"
import {
MAX_PSD_FILE_BYTES,
assertCanvasSize,
assertFileSize,
canvasSizeError
} from "./canvas-limits"
import type { ImageHeaderDimensions } from "./document-import-sniffers"
import {
readPsdHeaderDimensions,
sniffRasterDimensions,
} from "./document-import-sniffers"
import { makeIoCanvas } from "./document-rendering"
import { type LargeDocumentOpenMode } from "./large-document"
import {
CHANNELS_MASKS_CAPABILITY
} from "./psd-channels-masks"
import {
COLOR_MODE_CAPABILITY
} from "./psd-color-modes"
import {
createPsdRepairPlanFromParsedPsd
} from "./psd-compatibility"
import {
EFFECTS_ADJUSTMENTS_CAPABILITY
} from "./psd-effects-adjustments"
import {
RESOURCES_METADATA_CAPABILITY
} from "./psd-resources-metadata"
import {
VECTOR_TEXT_CAPABILITY
} from "./psd-vector-text"
import {
planPsbLargeDocumentOpen
} from "./raster-codecs"
import type {
BlendMode,
Layer,
PsdParsedStructureMetadata
} from "./types"

export {
createCompatibilityManifest,
createDocumentReport,
createExportCompatibilityManifest,
createExportLimitationReport
} from "./document-compatibility"
export {
downloadBlob,
downloadDataUrl,
downloadText,
isFileSystemAccessSupported,
saveToFileHandle,
showExportImagePicker,
showSaveProjectPicker
} from "./document-file-system"
export type {
AnimationExportFormat,
AppRasterExportFormat,
BrowserRasterExportFormat,
CompatibilityManifest,
CompatibilityManifestEntry,
CompatibilityTarget,
ExportCompatibilityFixAction,
ExportCompatibilityManifest,
ExportCompatibilityPreservationSummary,
ExportCompatibilityScoreCategory,
ExportCompatibilityScoreCategoryId,
ExportFormat,
ExportLimitationOptions,
ExportLimitationReport,
RasterExportOptions,
SvgExportOptions
} from "./document-io-types"
export { renderDocumentComposite } from "./document-rendering"

export function loadPsdCodec() {
  return import("ag-psd")
}

export const PSD_ROUND_TRIP_CAPABILITIES = {
  colorModes: COLOR_MODE_CAPABILITY,
  effectsAdjustments: EFFECTS_ADJUSTMENTS_CAPABILITY,
  vectorText: VECTOR_TEXT_CAPABILITY,
  channelsMasks: CHANNELS_MASKS_CAPABILITY,
  resourcesMetadata: RESOURCES_METADATA_CAPABILITY,
} as const

export const APP_BLEND_MODES = new Set<BlendMode>([
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

export const APP_LAYER_KINDS = new Set<Layer["kind"]>([
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

export const SAFE_CANVAS_DATA_URL = /^data:image\/(?:png|jpeg|jpg|webp|avif);base64,/i
export const RASTER_HEADER_BYTES = 1024 * 1024
export const MAX_LAYER_NAME_LENGTH = 120

export function validatePsdHeaderDimensions(buffer: ArrayBuffer, fileName = "PSD canvas") {
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

export async function assertRasterHeaderCanvasSize(file: File) {
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

export function psdColorModeLabel(mode: unknown): string {
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

export function parsedStructureFromPsd(psd: Psd, fallbackLayerCount = 0): PsdParsedStructureMetadata {
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

export function countPsdLayers(children: PsdLayer[] | undefined): number {
  return (children ?? []).reduce((count, child) => count + 1 + countPsdLayers(child.children), 0)
}

/** Escape characters that could prematurely close a CDATA section. */
export function escapeForCData(value: string): string {
  return value.replace(/]]>/g, "]]]]><![CDATA[>")
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

export function cleanText(value: unknown, fallback: string, maxLength = 120) {
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

export function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const next = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.max(min, Math.min(max, next))
}

export function cleanBlendMode(value: unknown): BlendMode {
  return typeof value === "string" && APP_BLEND_MODES.has(value as BlendMode) ? (value as BlendMode) : "normal"
}

export function cleanLayerKind(value: unknown): Layer["kind"] {
  return typeof value === "string" && APP_LAYER_KINDS.has(value as Layer["kind"]) ? (value as Layer["kind"]) : "raster"
}

export function psdBlendToApp(mode: PsdBlendMode | undefined): BlendMode {
  const normalized = (mode ?? "normal").replace(/\s+/g, "-") as BlendMode
  return APP_BLEND_MODES.has(normalized) ? normalized : "normal"
}

export function appBlendToPsd(mode: BlendMode): PsdBlendMode {
  return mode.replace(/-/g, " ") as PsdBlendMode
}

export function canvasAtDocumentSize(
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

export function cloneIoCanvas(source: HTMLCanvasElement | null | undefined) {
  if (!source || typeof source.getContext !== "function") return null
  const canvas = makeIoCanvas(source.width, source.height)
  canvas.getContext("2d")!.drawImage(source, 0, 0)
  return canvas
}

export function parseHexColor(hex: string) {
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

/**
 * Generate a small thumbnail data URL for a document.
 * Used in the Open Recent list.  Returns a ~120px wide JPEG data URL.
 */
