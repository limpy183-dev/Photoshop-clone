import type { DocumentReport, PsDocument } from "./types"
import type { RasterExportMetadata, TiffCompression } from "./raster-codecs"

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

export type ReportStatus = DocumentReport["items"][number]["status"]

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

export type ExportCompatibilityScoreCategoryId =
  | "layers"
  | "masks"
  | "text"
  | "effects"
  | "color"
  | "metadata"
  | "smart-objects"

export interface ExportCompatibilityScoreCategory {
  id: ExportCompatibilityScoreCategoryId
  label: string
  score: number
  status: "strong" | "mixed" | "risky"
  detail: string
}

export interface ExportCompatibilityFixAction {
  id: string
  label: string
  detail: string
  primaryFormat?: ExportFormat
}

export interface ExportCompatibilityPreservationSummary {
  preserved: CompatibilityManifestEntry[]
  changed: CompatibilityManifestEntry[]
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
  score: {
    overall: number
    categories: ExportCompatibilityScoreCategory[]
  }
  preservationSummary: ExportCompatibilityPreservationSummary
  fixActions: ExportCompatibilityFixAction[]
  summary: string
}
