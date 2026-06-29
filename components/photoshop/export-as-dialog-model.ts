import type { BrowserRasterExportFormat, ExportFormat } from "./document-io"
import type { RasterExportMetadata } from "./raster-codecs"
import type { ColorManagementSettings } from "./types"
export const EXPORT_FORMATS: Array<{ format: ExportFormat; label: string }> = [
  { format: "png", label: "PNG" },
  { format: "tiff", label: "TIFF" },
  { format: "jpeg", label: "JPG" },
  { format: "webp", label: "WebP" },
  { format: "gif", label: "GIF" },
  { format: "avif", label: "AVIF" },
  { format: "svg", label: "SVG" },
  { format: "tga", label: "TGA" },
  { format: "ppm", label: "PPM" },
  { format: "pgm", label: "PGM" },
  { format: "pbm", label: "PBM" },
  { format: "apng", label: "APNG" },
  { format: "animated-webp", label: "Anim WebP" },
  { format: "metadata-json", label: "Sidecar" },
]

export type ExportDecisionId = "web" | "app" | "photoshop" | "print"

// Task-based export decision cards: pick the goal, get a recommended format plus
// an honest "what's preserved vs. flattened" breakdown before committing.
export const EXPORT_DECISIONS: Array<{
  id: ExportDecisionId
  label: string
  format: ExportFormat
  blurb: string
  preserved: string[]
  flattened: string[]
}> = [
  {
    id: "web",
    label: "Best for web",
    format: "webp",
    blurb: "Small, sRGB, broadly supported.",
    preserved: ["Flattened composite appearance", "sRGB color for browsers", "Smallest practical file size"],
    flattened: ["Layers flattened to a single raster image", "Browser-encoded 8-bit color only"],
  },
  {
    id: "app",
    label: "Best for this app",
    format: "metadata-json",
    blurb: "Re-open here with the most fidelity.",
    preserved: ["Document and layer metadata", "Layer names, blend, and opacity"],
    flattened: ["Pixel data exported as a raster sidecar", "Browser 8-bit RGBA working space"],
  },
  {
    id: "photoshop",
    label: "Best for Photoshop handoff",
    format: "metadata-json",
    blurb: "Carry structure and metadata downstream.",
    preserved: ["Layer names and metadata", "Document metadata and intent"],
    flattened: ["Effects and smart filters rasterized", "Browser cannot write native PSD private data"],
  },
  {
    id: "print",
    label: "Best for print preview",
    format: "png",
    blurb: "Full-resolution, lossless raster.",
    preserved: ["Full resolution", "Embedded export metadata"],
    flattened: ["Flattened raster output", "Browser color management approximation only"],
  },
]

export const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  png: "png",
  tiff: "tiff",
  jpeg: "jpg",
  webp: "webp",
  avif: "avif",
  gif: "gif",
  svg: "svg",
  tga: "tga",
  ppm: "ppm",
  pgm: "pgm",
  pbm: "pbm",
  apng: "png",
  "animated-webp": "webp",
  "metadata-json": "metadata.json",
}

export const DEFAULT_COLOR_MANAGEMENT: ColorManagementSettings = {
  assignedProfile: "sRGB IEC61966-2.1",
  workingSpace: "sRGB IEC61966-2.1",
  renderingIntent: "relative-colorimetric",
  blackPointCompensation: true,
  proofProfile: "None",
  proofColors: false,
  gamutWarning: false,
  proofChannels: [],
  proofPlateView: "composite",
}

export function previewRasterFormat(format: ExportFormat): BrowserRasterExportFormat {
  if (
    format === "svg" ||
    format === "metadata-json" ||
    format === "apng" ||
    format === "animated-webp" ||
    format === "tiff" ||
    format === "tga" ||
    format === "ppm" ||
    format === "pgm" ||
    format === "pbm"
  ) {
    return "png"
  }
  return format
}

export function presetScaleToPercent(scale: number | undefined) {
  if (!Number.isFinite(scale)) return undefined
  const value = Number(scale)
  return value <= 8 ? Math.round(value * 100) : Math.round(value)
}

export type WebpAlphaFilter = NonNullable<RasterExportMetadata["webp"]>["alphaFilter"]

export function splitMetadataCommentLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
}

export function cleanOptionalText(value: string) {
  const clean = value.trim()
  return clean || undefined
}

