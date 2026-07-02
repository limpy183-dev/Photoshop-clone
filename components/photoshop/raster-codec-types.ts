import type { planTiledBackingStore } from "./tile-store"
import type { ContentCredential, TypographyEmbeddedFont } from "./types"

export interface RasterExportEditEntry {
  id?: string
  label: string
  at?: string
  tool?: string
  parameters?: Record<string, unknown>
}

export interface RasterExportProvenance {
  creator?: string
  software?: string
  softwareVersion?: string
  createdAt?: string
  editList?: RasterExportEditEntry[]
  title?: string
  assertion?: string
}

export interface RasterExportMetadata {
  title?: string
  author?: string
  copyright?: string
  description?: string
  creationDate?: string
  keywords?: string[]
  credit?: string
  source?: string
  gps?: {
    latitude?: number
    longitude?: number
    altitude?: number
    capturedAt?: string
  }
  contentCredentials?: ContentCredential[]
  provenance?: RasterExportProvenance
  fonts?: TypographyEmbeddedFont[]
  iccProfileName?: string
  iccProfile?: Uint8Array
  webp?: {
    lossless?: boolean
    nearLossless?: number
    method?: number
    exactAlpha?: boolean
    quality?: number
    alphaQuality?: number
    alphaFilter?: "none" | "fast" | "best"
  }
  avif?: {
    lossless?: boolean
    speed?: number
    chromaSubsampling?: string
    tileRowsLog2?: number
    tileColsLog2?: number
    bitDepth?: number
    quality?: number
  }
  tga?: {
    jobName?: string
    softwareId?: string
    aspectRatioNumerator?: number
    aspectRatioDenominator?: number
    gamma?: number
  }
  netpbm?: {
    comments?: string[]
    sourceMaxValue?: number
  }
  xmp?: string
}

export interface TiffEncodeOptions {
  compression?: "none" | "lzw" | "deflate"
  metadata?: RasterExportMetadata
  customFields?: TiffCustomField[]
}

export interface TiffCustomField {
  tag: number
  type: number
  count?: number
  value?: number
  data?: Uint8Array
}

export interface BigTiffDirectorySpec {
  name?: string
  width?: number
  height?: number
  fields?: TiffCustomField[]
}

export interface BigTiffEncodeOptions extends TiffEncodeOptions {
  directories?: BigTiffDirectorySpec[]
}

export interface OpenExrEncodeOptions {
  channels?: "rgba" | "rgb" | "gray"
  pixelType?: "float" | "half"
}

export interface OpenExrArbitraryChannel {
  name: string
  data: Float32Array | Uint16Array | Uint8Array
  pixelType?: "float" | "half" | "uint"
}

export interface OpenExrArbitraryEncodeOptions {
  width: number
  height: number
  channels: OpenExrArbitraryChannel[]
  tiled?: { tileWidth: number; tileHeight: number; levelMode?: "one-level" | "mipmap" | "ripmap" }
  deep?: { sampleCounts: Uint32Array }
  partName?: string
}

export interface PsbLargeDocumentOpenPlan {
  width: number
  height: number
  fileName: string
  fitsBrowserCanvas: boolean
  defaultError: string | null
  downscale50: {
    scale: 0.5
    width: number
    height: number
    fits: boolean
    error: string | null
  }
  tileView: {
    tileSize: number
    tileColumns: number
    tileRows: number
    tileCount: number
    overviewScale: number
    overviewWidth: number
    overviewHeight: number
    recommendation: ReturnType<typeof planTiledBackingStore>["recommendation"]
  }
}
