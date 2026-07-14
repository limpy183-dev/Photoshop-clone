import type { planTiledBackingStore } from "./tile-store"
import type { ContentCredential, TypographyEmbeddedFont } from "./types"

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
  metadata?: Record<string, unknown>
}

export type TiffCompression = "none" | "lzw" | "deflate"
export type PnmExportFormat = "ppm" | "pgm" | "pbm"

export interface RasterExportEditEntry {
  /** Stable identifier for this edit entry, e.g. a history step id. */
  id?: string
  /** Short human-readable label describing what happened. */
  label: string
  /** ISO 8601 timestamp for when the edit was committed. */
  at?: string
  /** Optional tool/action name (e.g. "brush", "filter:gaussian-blur"). */
  tool?: string
  /** Optional redacted parameters; values that look user-identifying are stripped. */
  parameters?: Record<string, unknown>
}

export interface RasterExportProvenance {
  /** Display name of the creator (user-configurable). Optional. */
  creator?: string
  /** Producing software identifier. Defaults to "Photoshop Web". */
  software?: string
  /** Software version string (e.g. package.json version). */
  softwareVersion?: string
  /** ISO 8601 timestamp at export time. Defaults to creationDate or now. */
  createdAt?: string
  /** Redacted edit list (most-recent first or chronological); usually last N history actions. */
  editList?: RasterExportEditEntry[]
  /** Optional document-level claim title. */
  title?: string
  /** Optional descriptive claim text. */
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
  /** GPS coordinates in decimal degrees; written into EXIF GPSInfo when supported. */
  gps?: {
    latitude?: number
    longitude?: number
    altitude?: number
    /** ISO 8601 timestamp captured with the coordinates. Optional. */
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
    /** Linear gamma value, e.g. 2.2 — stored as a TGA Extension rational. */
    gamma?: number
  }
  netpbm?: {
    comments?: string[]
    sourceMaxValue?: number
  }
  xmp?: string
}

export interface TiffEncodeOptions {
  compression?: TiffCompression
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

export interface TgaEncodeOptions {
  rle?: boolean
  metadata?: RasterExportMetadata
}

export interface PnmEncodeOptions {
  metadata?: RasterExportMetadata
  sourceMaxValue?: number
}

export interface PngEncodeOptions {
  interlaced?: boolean
  metadata?: RasterExportMetadata
}

export interface JpegEncodeOptions {
  quality?: number
  progressive?: boolean
  metadata?: RasterExportMetadata
}

export interface HeifEncodeOptions {
  quality?: number
  lossless?: boolean
  speed?: number
  bitDepth?: number
  chromaSubsampling?: string
  tileRowsLog2?: number
  tileColsLog2?: number
  metadata?: RasterExportMetadata
  encodeAvif?: (imageData: ImageData, options: {
    quality: number
    lossless?: boolean
    speed?: number
    bitDepth?: number
    chromaSubsampling?: string
    tileRowsLog2?: number
    tileColsLog2?: number
  }) => Promise<ArrayBuffer | Uint8Array>
}

export interface HeicEncodeOptions extends Omit<HeifEncodeOptions, "encodeAvif"> {
  encodeHevc?: (imageData: ImageData, options: {
    quality: number
    lossless?: boolean
    speed?: number
    bitDepth?: number
    chromaSubsampling?: string
  }) => Promise<Uint8Array | ArrayBuffer | {
    bitstream: Uint8Array | ArrayBuffer
    decoderConfig?: Uint8Array | ArrayBuffer
  }>
}

export interface Jpeg2000EncodeCodec {
  J2KEncoder: new () => {
    getDecodedBuffer: (frameInfo: { bitsPerSample: number; componentCount: number; width: number; height: number; isSigned: boolean }) => Uint8Array
    getEncodedBuffer: () => Uint8Array
    encode: () => void
    setDecompositions: (value: number) => void
    setQuality: (reversible: boolean, quality: number) => void
    delete?: () => void
  }
}

export interface Jpeg2000EncodeOptions {
  quality?: number
  reversible?: boolean
  decompositions?: number
  container?: "codestream" | "jp2" | "jpx" | "jpm"
  includeAlpha?: boolean
  layers?: Array<{ label: string; opacity?: number }>
  color?: {
    enumColorSpace?: number
    iccProfileName?: string
    iccProfile?: Uint8Array
    profileControls?: Record<string, string | number | boolean>
  }
  openJpegCodec?: Jpeg2000EncodeCodec | Promise<Jpeg2000EncodeCodec>
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

export interface ExrInspection {
  magic: boolean
  version?: number
  pixelDecoded: boolean
  warnings: string[]
  channels?: string[]
  bitDepth?: number
}
