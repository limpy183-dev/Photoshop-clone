import { assertCanvasSize, canvasLimitLabel, canvasSizeError, clampCanvasSize } from "./canvas-limits"
import { sniffRasterDimensions } from "./document-import-sniffers"
import { planTiledBackingStore } from "./tile-store"
import type { HighBitImage } from "./color-pipeline"
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

type LibRawDecodeSettings = Record<string, unknown>

interface LibRawDecoderInstance {
  open(data: Uint8Array, settings?: LibRawDecodeSettings): unknown
  metadata(full?: boolean): Record<string, unknown>
  imageData(): Record<string, unknown>
  delete?: () => void
}

interface LibRawRuntimeModule {
  LibRaw: new () => LibRawDecoderInstance
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

const textDecoder = new TextDecoder("ascii")
const clamp8 = (value: number) => Math.max(0, Math.min(255, Math.round(value)))
const EXR_FLOAT_TYPE = 1015 as const
const TIFF_EXTENSIONS = new Set(["tif", "tiff"])
const TIFF_COMPATIBLE_EXTENSIONS = new Set(["tif", "tiff", "dng"])
const PNM_EXTENSIONS = new Set(["ppm", "pgm", "pbm", "pnm"])
const TGA_EXTENSIONS = new Set(["tga", "vda", "icb", "vst"])
const HEIF_EXTENSIONS = new Set(["heif", "heic", "hif"])
const HEIF_BRANDS = new Set(["heic", "heif", "heix", "hevc", "hevx", "mif1", "msf1"])
const JPEG2000_EXTENSIONS = new Set(["jp2", "j2k", "jpf", "jpx", "jpm"])
const RAW_EXTENSIONS = new Set(["raw", "dng", "cr2", "nef", "arw"])

interface AdvancedRasterSignature {
  isTiff: boolean
  isTiffCompatible: boolean
  isPnm: boolean
  isTga: boolean
  isExr: boolean
  isHeif: boolean
  isJpeg2000: boolean
  isRaw: boolean
}

function concatUint8(arrays: Uint8Array[]): Uint8Array {
  let total = 0
  for (const array of arrays) total += array.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const array of arrays) {
    out.set(array, offset)
    offset += array.length
  }
  return out
}

function asciiBytes(value: string): Uint8Array {
  const out = new Uint8Array(value.length)
  for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff
  return out
}

function latin1Bytes(value: string): Uint8Array {
  const out = new Uint8Array(value.length)
  for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff
  return out
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function u32BE(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255])
}

function u64BE(value: number): Uint8Array {
  const high = Math.floor(value / 0x100000000)
  const low = value >>> 0
  return new Uint8Array([
    (high >>> 24) & 255,
    (high >>> 16) & 255,
    (high >>> 8) & 255,
    high & 255,
    (low >>> 24) & 255,
    (low >>> 16) & 255,
    (low >>> 8) & 255,
    low & 255,
  ])
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = asciiBytes(type)
  const crcInput = concatUint8([typeBytes, data])
  return concatUint8([u32BE(data.length), typeBytes, data, u32BE(crc32(crcInput))])
}

function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  const mod = 65521
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % mod
    b = (b + a) % mod
  }
  return ((b << 16) | a) >>> 0
}

function deflateRawStore(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = []
  const maxBlock = 0xffff
  let offset = 0
  do {
    const end = Math.min(offset + maxBlock, data.length)
    const len = end - offset
    const nlen = 0xffff - len
    const block = new Uint8Array(5 + len)
    block[0] = end === data.length ? 1 : 0
    block[1] = len & 255
    block[2] = (len >>> 8) & 255
    block[3] = nlen & 255
    block[4] = (nlen >>> 8) & 255
    block.set(data.subarray(offset, end), 5)
    blocks.push(block)
    offset = end
  } while (offset < data.length)
  return concatUint8(blocks)
}

function zlibStore(data: Uint8Array): Uint8Array {
  const checksum = adler32(data)
  return concatUint8([
    new Uint8Array([0x78, 0x01]),
    deflateRawStore(data),
    new Uint8Array([(checksum >>> 24) & 255, (checksum >>> 16) & 255, (checksum >>> 8) & 255, checksum & 255]),
  ])
}

async function compressWithStream(data: Uint8Array, format: CompressionFormat): Promise<Uint8Array | null> {
  if (typeof CompressionStream !== "function") return null
  try {
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream(format))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  return (await compressWithStream(data, "deflate-raw")) ?? deflateRawStore(data)
}

async function deflateZlib(data: Uint8Array): Promise<Uint8Array> {
  return (await compressWithStream(data, "deflate")) ?? zlibStore(data)
}

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

function bufferHead(buffer: ArrayBuffer, length: number) {
  return new Uint8Array(buffer, 0, Math.min(length, buffer.byteLength))
}

function hasTiffHeader(head: Uint8Array) {
  return (
    (head[0] === 0x49 && head[1] === 0x49 && head[2] === 42 && head[3] === 0) ||
    (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0 && head[3] === 42)
  )
}

function hasPnmHeader(head: Uint8Array) {
  return head[0] === 0x50 && head[1] >= 0x31 && head[1] <= 0x36
}

function hasExrHeader(head: Uint8Array) {
  return head[0] === 0x76 && head[1] === 0x2f && head[2] === 0x31 && head[3] === 0x01
}

function hasHeifBrand(buffer: ArrayBuffer, head: Uint8Array) {
  return head.length >= 12 && readAscii(buffer, 4, 4) === "ftyp" && HEIF_BRANDS.has(readAscii(buffer, 8, 4))
}

function hasJpeg2000Signature(head: Uint8Array) {
  return (
    (head[0] === 0xff && head[1] === 0x4f) ||
    (head.length >= 12 && head[4] === 0x6a && head[5] === 0x50 && head[6] === 0x20 && head[7] === 0x20)
  )
}

function sniffAdvancedRaster(buffer: ArrayBuffer, name = "", mime = ""): AdvancedRasterSignature {
  const ext = extensionForName(name)
  const head = bufferHead(buffer, 32)
  const isTiff = hasTiffHeader(head) || TIFF_EXTENSIONS.has(ext)
  const isPnm = PNM_EXTENSIONS.has(ext) || hasPnmHeader(head)
  const isHeif = mime === "image/heic" || mime === "image/heif" || HEIF_EXTENSIONS.has(ext) || hasHeifBrand(buffer, head)
  return {
    isTiff,
    isTiffCompatible: isTiff || TIFF_COMPATIBLE_EXTENSIONS.has(ext),
    isPnm,
    isTga: TGA_EXTENSIONS.has(ext),
    isExr: ext === "exr" || hasExrHeader(head),
    isHeif,
    isJpeg2000: JPEG2000_EXTENSIONS.has(ext) || hasJpeg2000Signature(head),
    isRaw: RAW_EXTENSIONS.has(ext),
  }
}

function scaleSample(value: number, maxValue: number) {
  if (maxValue <= 0) return 0
  return clamp8((value / maxValue) * 255)
}

function decodeSyncAdvancedRaster(buffer: ArrayBuffer, signature: AdvancedRasterSignature): DecodedRaster | null {
  if (signature.isTiff) return decodeTiffBuffer(buffer)
  if (signature.isPnm) return decodePnmBuffer(buffer)
  if (signature.isTga) return decodeTgaBuffer(buffer)
  return null
}

export function decodeAdvancedRasterBuffer(buffer: ArrayBuffer, name = ""): DecodedRaster | null {
  return decodeSyncAdvancedRaster(buffer, sniffAdvancedRaster(buffer, name))
}

export function inspectExrHeader(buffer: ArrayBuffer): ExrInspection {
  const bytes = new Uint8Array(buffer)
  const magic = bytes.length >= 4 && bytes[0] === 0x76 && bytes[1] === 0x2f && bytes[2] === 0x31 && bytes[3] === 0x01
  const channelInfo = magic ? readExrChannelInfo(buffer) : null
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
    channels: channelInfo?.names,
    bitDepth: channelInfo?.bitDepth,
    warnings: magic
      ? [pixelDecoded
          ? `OpenEXR magic header detected${channelInfo?.names.length ? ` (${channelInfo.names.join(", ")} ${channelInfo.bitDepth}-bit channel${channelInfo.names.length === 1 ? "" : "s"})` : ""}; pixel import is routed through the bundled EXR decoder and tone-mapped into editable RGBA preview pixels.`
          : "OpenEXR magic header detected; unsupported EXR variants may still fail when they use codecs, multipart/deep data, or channels outside the bundled decoder path."]
      : ["OpenEXR magic header was not found."],
  }
}

function readCString(bytes: Uint8Array, offset: number) {
  let end = offset
  while (end < bytes.length && bytes[end] !== 0) end++
  return { value: new TextDecoder("ascii").decode(bytes.subarray(offset, end)), next: Math.min(bytes.length, end + 1) }
}

function readExrChannelInfo(buffer: ArrayBuffer): { names: string[]; pixelTypes: number[]; bitDepth: number } | null {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 12) return null
  const view = new DataView(buffer)
  let offset = 8
  while (offset < bytes.length) {
    const name = readCString(bytes, offset)
    offset = name.next
    if (!name.value) break
    const type = readCString(bytes, offset)
    offset = type.next
    if (offset + 4 > bytes.length) return null
    const size = view.getUint32(offset, true)
    offset += 4
    if (offset + size > bytes.length) return null
    if (name.value === "channels" && type.value === "chlist") {
      const names: string[] = []
      const pixelTypes: number[] = []
      let cursor = offset
      const end = offset + size
      while (cursor < end && bytes[cursor] !== 0) {
        const channel = readCString(bytes, cursor)
        cursor = channel.next
        if (!channel.value || cursor + 16 > end) break
        names.push(channel.value)
        pixelTypes.push(view.getUint32(cursor, true))
        cursor += 16
      }
      const bitDepth = pixelTypes.every((value) => value === 1) ? 16 : 32
      return { names, pixelTypes, bitDepth }
    }
    offset += size
  }
  return null
}

function readExrDataWindow(buffer: ArrayBuffer): { width: number; height: number } | null {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 12) return null
  const view = new DataView(buffer)
  let offset = 8
  while (offset < bytes.length) {
    const name = readCString(bytes, offset)
    offset = name.next
    if (!name.value) break
    const type = readCString(bytes, offset)
    offset = type.next
    if (offset + 4 > bytes.length) return null
    const size = view.getUint32(offset, true)
    offset += 4
    if (offset + size > bytes.length) return null
    if (name.value === "dataWindow" && type.value === "box2i" && size >= 16) {
      const xMin = view.getInt32(offset, true)
      const yMin = view.getInt32(offset + 4, true)
      const xMax = view.getInt32(offset + 8, true)
      const yMax = view.getInt32(offset + 12, true)
      return { width: xMax - xMin + 1, height: yMax - yMin + 1 }
    }
    offset += size
  }
  return null
}

export async function decodeAdvancedRasterBufferAsync(buffer: ArrayBuffer, name = "", mime = ""): Promise<DecodedRaster | null> {
  const signature = sniffAdvancedRaster(buffer, name, mime)

  if (signature.isExr) return decodeExrBuffer(buffer)
  if (signature.isHeif) return decodeHeifBuffer(buffer)
  if (signature.isJpeg2000) return decodeJpeg2000Buffer(buffer)
  if (signature.isRaw) {
    const raw = await decodeRawBuffer(buffer)
    if (raw) return raw
  }
  if (signature.isTiffCompatible) {
    const tiff = await decodeTiffWithUtif(buffer)
    if (tiff) return tiff
    const fallback = await decodeTiffBufferAsyncFallback(buffer).catch(() => null)
    if (fallback) return fallback
  }
  return decodeSyncAdvancedRaster(buffer, signature)
}

let libRawRuntimeReady: Promise<LibRawRuntimeModule> | null = null
const LIBRAW_RUNTIME_URL = "/vendor/libraw-wasm/libraw.js"

type LibRawRuntimeFactory = (options?: Record<string, unknown>) => Promise<LibRawRuntimeModule>

async function loadLibRawRuntime(): Promise<LibRawRuntimeModule> {
  libRawRuntimeReady ??= import(/* webpackIgnore: true */ LIBRAW_RUNTIME_URL).then(async (module) => {
    const createLibRawRuntime = (module as { default: LibRawRuntimeFactory }).default
    return createLibRawRuntime({
      print: () => undefined,
      printErr: () => undefined,
    })
  })
  return libRawRuntimeReady
}

function normalizeLibRawMetadata(metadata: Record<string, unknown>) {
  if (Object.prototype.hasOwnProperty.call(metadata, "thumb_format")) {
    const formats = ["unknown", "jpeg", "bitmap", "bitmap16", "layer", "rollei", "h265"]
    metadata.thumb_format = formats[Number(metadata.thumb_format)] ?? "unknown"
  }
  if (Object.prototype.hasOwnProperty.call(metadata, "desc")) metadata.desc = String(metadata.desc).trim()
  if (Object.prototype.hasOwnProperty.call(metadata, "timestamp")) metadata.timestamp = new Date(Number(metadata.timestamp))
  return metadata
}

async function decodeTiffWithUtif(buffer: ArrayBuffer): Promise<DecodedRaster | null> {
  try {
    const UTIF = await import("utif2")
    const ifds = UTIF.decode(buffer)
    const ifd = ifds.find((item) => Number(item.width || 0) > 0 && Number(item.height || 0) > 0) ?? ifds[0]
    if (!ifd) return null
    // Preflight the IFD dimension tags so a tiny file declaring huge
    // dimensions cannot trigger a multi-gigabyte decode allocation.
    const tagWidth = Number(ifd.width || (Array.isArray(ifd.t256) ? ifd.t256[0] : ifd.t256) || 0)
    const tagHeight = Number(ifd.height || (Array.isArray(ifd.t257) ? ifd.t257[0] : ifd.t257) || 0)
    if (tagWidth > 0 && tagHeight > 0) assertCanvasSize(tagWidth, tagHeight, "TIFF image")
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
    const channelInfo = readExrChannelInfo(buffer)
    // Preflight the header dataWindow so parseExr cannot allocate
    // multi-gigabyte float buffers from a tiny crafted file.
    const dataWindow = readExrDataWindow(buffer)
    if (dataWindow && dataWindow.width > 0 && dataWindow.height > 0) assertCanvasSize(dataWindow.width, dataWindow.height, "OpenEXR image")
    const exr = parseExr(buffer, EXR_FLOAT_TYPE)
    assertCanvasSize(exr.width, exr.height, "OpenEXR image")
    const rgba = new Uint8ClampedArray(exr.width * exr.height * 4)
    const data = exr.data as Float32Array | Uint16Array
    const decodedStride = Math.max(1, Math.round(data.length / Math.max(1, exr.width * exr.height)))
    const sourceChannelCount = channelInfo?.names.length && ["Y", "R,G,B", "R,G,B,A"].includes(channelInfo.names.join(","))
      ? channelInfo.names.length
      : exr.format === 1023
        ? (channelInfo?.names.includes("A") ? 4 : Math.min(decodedStride, 3))
        : 1
    for (let i = 0; i < exr.width * exr.height; i++) {
      const source = i * decodedStride
      const target = i * 4
      if (sourceChannelCount === 1) {
        const gray = linearPreviewSample(Number(data[source] ?? 0))
        rgba[target] = gray
        rgba[target + 1] = gray
        rgba[target + 2] = gray
        rgba[target + 3] = 255
      } else {
        rgba[target] = linearPreviewSample(Number(data[source] ?? 0))
        rgba[target + 1] = linearPreviewSample(Number(data[source + 1] ?? 0))
        rgba[target + 2] = linearPreviewSample(Number(data[source + 2] ?? 0))
        rgba[target + 3] = sourceChannelCount >= 4 ? clamp8(Number(data[source + 3] ?? 1) * 255) : 255
      }
    }
    const bitDepth = channelInfo?.bitDepth ?? 32
    const sourceChannels = channelInfo?.names.join(",") ?? (sourceChannelCount === 1 ? "Y" : sourceChannelCount === 3 ? "R,G,B" : "R,G,B,A")
    return {
      format: "OpenEXR",
      width: exr.width,
      height: exr.height,
      bitDepth,
      channels: sourceChannelCount,
      colorModel: sourceChannelCount === 1 ? "Grayscale" : sourceChannelCount >= 4 ? "RGBA" : "RGB",
      compression: String((exr.header as Record<string, unknown>).compression ?? "exr"),
      imageData: imageDataFromRgba(exr.width, exr.height, rgba),
      warnings: [`OpenEXR ${sourceChannels} ${bitDepth}-bit scene-linear values were tone-mapped into the browser 8-bit RGBA editing pipeline.`],
      metadata: {
        decoder: "parse-exr",
        colorSpace: exr.colorSpace,
        sourceChannels,
      },
    }
  } catch {
    return null
  }
}

async function decodeHeifBuffer(buffer: ArrayBuffer): Promise<DecodedRaster | null> {
  try {
    const headerBytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1024 * 1024))
    const dimensions = sniffRasterDimensions(headerBytes)
    if (dimensions?.format === "ISO-BMFF") {
      assertCanvasSize(dimensions.width, dimensions.height, "HEIF/HEIC image")
    }
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

type Jpeg2000FrameInfo = {
  bitsPerSample: number
  componentCount: number
  height: number
  width: number
  isSigned: boolean
}

function jpeg2000RasterFromDecoded(
  frameInfo: Jpeg2000FrameInfo,
  decodedBuffer: ArrayBufferLike | ArrayBufferView,
  isReversible: boolean | undefined,
  colorSpace: unknown,
  decoder: string,
): DecodedRaster {
  const { bitsPerSample, componentCount, height, width, isSigned } = frameInfo
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(bitsPerSample) ||
    !Number.isFinite(componentCount) ||
    width <= 0 ||
    height <= 0 ||
    bitsPerSample <= 0 ||
    componentCount <= 0
  ) {
    throw new Error("JPEG 2000 decoder did not return a complete image frame.")
  }
  assertCanvasSize(width, height, "JPEG 2000 image")
  const rgba = new Uint8ClampedArray(width * height * 4)
  const sourceBytes = bitsPerSample > 8
    ? new Uint16Array(decodedBuffer as ArrayBufferLike)
    : new Uint8Array(decodedBuffer as ArrayBufferLike)
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
    compression: isReversible ? "jpeg2000-lossless" : "jpeg2000",
    imageData: imageDataFromRgba(width, height, rgba),
    warnings: ["JPEG 2000 codestream was decoded into editable RGBA pixels; export writes flattened RGB codestreams."],
    metadata: {
      decoder,
      colorSpace: String(colorSpace ?? ""),
    },
  }
}

// Cheap header scan so the WASM decoders can reject oversized dimensions
// before allocating output buffers; returns null when nothing plausible
// parses instead of throwing.
function readJpeg2000Dimensions(buffer: ArrayBuffer): { width: number; height: number } | null {
  try {
    const bytes = new Uint8Array(buffer)
    const view = new DataView(buffer)
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0x4f) {
      // Raw codestream: the SIZ segment (0xff51) follows the SOC marker.
      for (let i = 2; i + 22 <= bytes.length && i < 64; i++) {
        if (bytes[i] !== 0xff || bytes[i + 1] !== 0x51) continue
        return {
          width: view.getUint32(i + 6, false) - view.getUint32(i + 14, false),
          height: view.getUint32(i + 10, false) - view.getUint32(i + 18, false),
        }
      }
      return null
    }
    // JP2-family container: walk top-level boxes to jp2h, then ihdr inside it.
    let offset = 0
    while (offset + 8 <= bytes.length) {
      const size = view.getUint32(offset, false)
      if (readAscii(buffer, offset + 4, 4) === "jp2h") {
        const end = size === 0 ? bytes.length : Math.min(bytes.length, offset + size)
        let inner = offset + 8
        while (inner + 8 <= end) {
          const innerSize = view.getUint32(inner, false)
          if (readAscii(buffer, inner + 4, 4) === "ihdr" && inner + 16 <= end) {
            return { width: view.getUint32(inner + 12, false), height: view.getUint32(inner + 8, false) }
          }
          if (innerSize < 8) break
          inner += innerSize
        }
        return null
      }
      if (size < 8) break
      offset += size
    }
    return null
  } catch {
    return null
  }
}

async function decodeJpeg2000WithOpenJpeg(buffer: ArrayBuffer): Promise<DecodedRaster | null> {
  try {
    const headerDims = readJpeg2000Dimensions(buffer)
    if (headerDims && headerDims.width > 0 && headerDims.height > 0) assertCanvasSize(headerDims.width, headerDims.height, "JPEG 2000 image")
    const { J2KDecoder } = await loadOpenJpegCodec()
    const decoder = new J2KDecoder()
    const bytes = new Uint8Array(buffer)
    const encoded = decoder.getEncodedBuffer(bytes.byteLength)
    encoded.set(bytes)
    decoder.decode()
    return jpeg2000RasterFromDecoded(
      decoder.getFrameInfo(),
      decoder.getDecodedBuffer(),
      decoder.getIsReversible(),
      decoder.getColorSpace(),
      "@cornerstonejs/codec-openjpeg",
    )
  } catch {
    return null
  }
}

async function decodeJpeg2000Buffer(buffer: ArrayBuffer): Promise<DecodedRaster | null> {
  try {
    const headerDims = readJpeg2000Dimensions(buffer)
    if (headerDims && headerDims.width > 0 && headerDims.height > 0) assertCanvasSize(headerDims.width, headerDims.height, "JPEG 2000 image")
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
    return jpeg2000RasterFromDecoded(
      decoded.frameInfo,
      decoded.decodedBuffer as ArrayBufferLike | ArrayBufferView,
      decoded.isReversible,
      decoded.colorSpace,
      "@abasb75/jpeg2000-decoder",
    )
  } catch {
    return decodeJpeg2000WithOpenJpeg(buffer)
  }
}

async function decodeRawBuffer(buffer: ArrayBuffer): Promise<DecodedRaster | null> {
  if (typeof Worker === "undefined") return null
  let raw: LibRawDecoderInstance | null = null
  try {
    const runtime = await loadLibRawRuntime()
    raw = new runtime.LibRaw()
    await raw.open(new Uint8Array(buffer), {
      outputBps: 8,
      outputColor: 1,
      useCameraWb: true,
      userQual: 3,
    })
    const metadata = normalizeLibRawMetadata(await raw.metadata(false))
    // Preflight metadata dimensions before imageData() materialises the
    // full demosaiced pixel buffer.
    const metaWidth = Number(metadata.width ?? metadata.iwidth ?? (metadata.sizes as Record<string, unknown> | undefined)?.width ?? 0)
    const metaHeight = Number(metadata.height ?? metadata.iheight ?? (metadata.sizes as Record<string, unknown> | undefined)?.height ?? 0)
    if (metaWidth > 0 && metaHeight > 0) assertCanvasSize(metaWidth, metaHeight, "RAW/DNG image")
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
  } finally {
    raw?.delete?.()
  }
}

function linearPreviewSample(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0
  const normalized = value > 1 ? value / (1 + value) : value
  return clamp8(Math.pow(Math.max(0, Math.min(1, normalized)), 1 / 2.2) * 255)
}

function decodeTgaColor(bytes: Uint8Array, offset: number, depth: number, alphaBits = 0) {
  if (depth === 32) return { r: bytes[offset + 2], g: bytes[offset + 1], b: bytes[offset], a: bytes[offset + 3], size: 4 }
  if (depth === 24) return { r: bytes[offset + 2], g: bytes[offset + 1], b: bytes[offset], a: 255, size: 3 }
  if (depth === 16 || depth === 15) {
    const value = bytes[offset] | (bytes[offset + 1] << 8)
    return {
      r: Math.round(((value >> 10) & 31) * 255 / 31),
      g: Math.round(((value >> 5) & 31) * 255 / 31),
      b: Math.round((value & 31) * 255 / 31),
      // ARGB1555: the high bit is alpha, but only when the image descriptor
      // declares an attribute bit — many opaque files leave bit 15 zeroed.
      a: depth === 16 && alphaBits > 0 ? ((value & 0x8000) !== 0 ? 255 : 0) : 255,
      size: 2,
    }
  }
  throw new Error(`Unsupported TGA pixel depth: ${depth}`)
}

function readTgaFixed(bytes: Uint8Array, offset: number, length: number) {
  let end = offset
  const max = Math.min(bytes.length, offset + length)
  while (end < max && bytes[end] !== 0) end++
  return new TextDecoder("latin1").decode(bytes.subarray(offset, end)).trim()
}

function readTgaMetadata(bytes: Uint8Array, idLength: number): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {}
  if (idLength > 0) {
    const id = readTgaFixed(bytes, 18, idLength)
    if (id) metadata.title = id
  }
  if (bytes.byteLength < 26) return Object.keys(metadata).length ? metadata : undefined
  const footerOffset = bytes.byteLength - 26
  if (readTgaFixed(bytes, footerOffset + 8, 18) !== TGA_SIGNATURE.replace(/\0$/, "")) {
    return Object.keys(metadata).length ? metadata : undefined
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const extensionOffset = view.getUint32(footerOffset, true)
  const developerOffset = view.getUint32(footerOffset + 4, true)
  if (extensionOffset > 0 && extensionOffset + 495 <= bytes.byteLength) {
    const author = readTgaFixed(bytes, extensionOffset + 2, 41)
    const comments = [0, 1, 2, 3]
      .map((line) => readTgaFixed(bytes, extensionOffset + 43 + line * 81, 81))
      .filter(Boolean)
    const title = readTgaFixed(bytes, extensionOffset + 379, 41)
    const software = readTgaFixed(bytes, extensionOffset + 426, 41)
    const month = view.getUint16(extensionOffset + 367, true)
    const day = view.getUint16(extensionOffset + 369, true)
    const year = view.getUint16(extensionOffset + 371, true)
    const hour = view.getUint16(extensionOffset + 373, true)
    const minute = view.getUint16(extensionOffset + 375, true)
    const second = view.getUint16(extensionOffset + 377, true)
    if (author) metadata.author = author
    if (comments.length) {
      metadata.comments = comments
      metadata.description = comments.join(" ").trim()
    }
    if (title) metadata.title = title
    if (software) metadata.software = software
    if (year && month && day) metadata.creationDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString()
  }
  if (developerOffset > 0 && developerOffset + 2 <= bytes.byteLength) {
    const count = view.getUint16(developerOffset, true)
    for (let i = 0; i < count; i++) {
      const entry = developerOffset + 2 + i * 10
      if (entry + 10 > bytes.byteLength) break
      const tag = view.getUint16(entry, true)
      const offset = view.getUint32(entry + 2, true)
      const size = view.getUint32(entry + 6, true)
      if (tag !== TGA_DEVELOPER_TAG_METADATA || offset + size > bytes.byteLength) continue
      const text = new TextDecoder().decode(bytes.subarray(offset, offset + size))
      if (!text.startsWith(TGA_DEVELOPER_PREFIX)) continue
      try {
        const parsed = JSON.parse(text.slice(TGA_DEVELOPER_PREFIX.length)) as Record<string, unknown>
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "string" && value) metadata[key] = value
          else if (typeof value === "number" || typeof value === "boolean") metadata[key] = value
          else if (Array.isArray(value) && value.every((item) => typeof item === "string")) metadata[key] = value
          else if (key === "tga" && value && typeof value === "object" && !Array.isArray(value)) metadata[key] = value
          else if (key === "contentCredentials" && Array.isArray(value) && value.every((item) => item && typeof item === "object" && !Array.isArray(item))) metadata[key] = value
        }
      } catch {
        metadata.developerMetadata = text.slice(0, 120)
      }
    }
  }
  return Object.keys(metadata).length ? metadata : undefined
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
  const attributeBits = descriptor & 0x0f
  const warnings: string[] = []
  const metadata = readTgaMetadata(bytes, idLength)

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
    return decodeTgaColor(bytes, offset, pixelDepth, attributeBits)
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
    metadata,
  }
}

interface PnmToken {
  value: string
  next: number
}

function nextPnmToken(bytes: Uint8Array, start: number, comments?: string[]): PnmToken {
  let i = start
  while (i < bytes.length) {
    const c = bytes[i]
    if (c === 35) {
      const commentStart = i + 1
      while (i < bytes.length && bytes[i] !== 10 && bytes[i] !== 13) i++
      const comment = new TextDecoder("latin1").decode(bytes.subarray(commentStart, i)).trim()
      if (comment) comments?.push(comment)
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

function pnmStructuredMetadata(comments: readonly string[]) {
  const metadata: Record<string, unknown> = {}
  let description: string | undefined
  for (const comment of comments) {
    const match = /^([A-Za-z][A-Za-z -]*):\s*(.*)$/.exec(comment)
    const key = match?.[1]?.toLowerCase().replace(/\s+/g, "-")
    const value = match?.[2]?.trim()
    if (key === "title" && value) metadata.title = value
    else if (key === "author" && value) metadata.author = value
    else if (key === "copyright" && value) metadata.copyright = value
    else if (key === "source" && value) metadata.source = value
    else if (key === "source-maxvalue" && value) metadata.sourceMaxValue = Number(value)
    else if (!match && !description) description = comment
  }
  if (description) metadata.description = description
  return metadata
}

export function decodePnmBuffer(buffer: ArrayBuffer): DecodedRaster {
  const bytes = new Uint8Array(buffer)
  const comments: string[] = []
  const magic = nextPnmToken(bytes, 0, comments)
  if (!/^P[1-6]$/.test(magic.value)) throw new Error("Unsupported PNM magic header")
  const widthToken = nextPnmToken(bytes, magic.next, comments)
  const heightToken = nextPnmToken(bytes, widthToken.next, comments)
  const width = Number(widthToken.value)
  const height = Number(heightToken.value)
  if (!width || !height) throw new Error("PNM dimensions are missing")
  assertCanvasSize(width, height, "PNM image")
  const bitmap = magic.value === "P1" || magic.value === "P4"
  const maxToken = bitmap ? { value: "1", next: heightToken.next } : nextPnmToken(bytes, heightToken.next, comments)
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

  const structuredMetadata = pnmStructuredMetadata(comments)
  const parsedSourceMax = typeof structuredMetadata.sourceMaxValue === "number" && Number.isFinite(structuredMetadata.sourceMaxValue)
    ? structuredMetadata.sourceMaxValue
    : Number(comments.find((comment) => /^Source-MaxValue:/i.test(comment))?.split(":").slice(1).join(":").trim()) || maxValue

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
    metadata: {
      maxValue,
      sourceMaxValue: parsedSourceMax,
      ...structuredMetadata,
      ...(comments.length ? { comments } : {}),
    },
  }
}

const tiffTypeSizes: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  7: 1,
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

function decodeTiffLzw(data: Uint8Array, expectedLength: number): Uint8Array {
  const out = new Uint8Array(expectedLength)
  let outOffset = 0
  let bitOffset = 0
  let codeSize = 9
  let nextCode = 258
  let previous: number[] | null = null
  const dict: number[][] = []

  const reset = () => {
    dict.length = 0
    for (let i = 0; i < 256; i++) dict[i] = [i]
    codeSize = 9
    nextCode = 258
    previous = null
  }
  const readCode = () => {
    if (bitOffset + codeSize > data.length * 8) return null
    const byte = bitOffset >>> 3
    const bit = bitOffset & 7
    const window = ((data[byte] ?? 0) << 16) | ((data[byte + 1] ?? 0) << 8) | (data[byte + 2] ?? 0)
    const code = (window >>> (24 - bit - codeSize)) & ((1 << codeSize) - 1)
    bitOffset += codeSize
    return code
  }
  const add = (entry: number[]) => {
    if (nextCode > 4095) return
    dict[nextCode++] = entry
    if (nextCode + 1 === 1 << codeSize && codeSize < 12) codeSize++
  }
  const write = (entry: number[]) => {
    for (const value of entry) {
      if (outOffset >= out.length) return
      out[outOffset++] = value
    }
  }

  reset()
  while (outOffset < out.length) {
    const code = readCode()
    if (code === null || code === 257) break
    if (code === 256) {
      reset()
      continue
    }
    const entry: number[] | null = dict[code] ?? (code === nextCode && previous ? [...previous, previous[0]] : null)
    if (!entry) break
    write(entry)
    if (previous) add([...previous, entry[0]])
    previous = entry
  }
  return out
}

export function decodeTiffBuffer(buffer: ArrayBuffer): DecodedRaster {
  const bytes = new Uint8Array(buffer)
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
  if (compression !== 1 && compression !== 5) throw new Error(`Unsupported TIFF compression: ${compression}`)
  if (planar !== 1) throw new Error("Planar TIFF data is not supported")
  if (![0, 1, 2].includes(photometric)) throw new Error(`Unsupported TIFF photometric interpretation: ${photometric}`)

  const rgba = new Uint8ClampedArray(width * height * 4)
  const maxBitDepth = Math.max(...bits)
  const sampleBytes = maxBitDepth > 8 ? 2 : 1
  const warnings: string[] = []
  let row = 0
  for (let stripIndex = 0; stripIndex < stripOffsets.length && row < height; stripIndex++) {
    const rows = Math.min(rowsPerStrip, height - row)
    const stripOffset = stripOffsets[stripIndex]
    const stripByteCount = stripByteCounts[stripIndex] ?? Math.max(0, bytes.length - stripOffset)
    const expectedStripBytes = rows * width * samplesPerPixel * sampleBytes
    const stripData = compression === 5
      ? decodeTiffLzw(bytes.subarray(stripOffset, stripOffset + stripByteCount), expectedStripBytes)
      : bytes.subarray(stripOffset, stripOffset + stripByteCount)
    const stripView = new DataView(stripData.buffer, stripData.byteOffset, stripData.byteLength)
    let p = 0
    for (let sy = 0; sy < rows && p < stripData.byteLength; sy++, row++) {
      for (let x = 0; x < width; x++) {
        const samples: number[] = []
        for (let s = 0; s < samplesPerPixel; s++) {
          const sample = sampleBytes === 2 ? stripView.getUint16(p, little) : stripView.getUint8(p)
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

async function inflateRawAsync(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") throw new Error("Deflate TIFF decoding requires DecompressionStream support")
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function decodeTiffBufferAsyncFallback(buffer: ArrayBuffer): Promise<DecodedRaster> {
  const bytes = new Uint8Array(buffer)
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
  if (compression !== 8 && compression !== 32946) return decodeTiffBuffer(buffer)
  if (planar !== 1) throw new Error("Planar TIFF data is not supported")
  if (![0, 1, 2].includes(photometric)) throw new Error(`Unsupported TIFF photometric interpretation: ${photometric}`)

  const rgba = new Uint8ClampedArray(width * height * 4)
  const maxBitDepth = Math.max(...bits)
  const sampleBytes = maxBitDepth > 8 ? 2 : 1
  const warnings: string[] = []
  let row = 0
  for (let stripIndex = 0; stripIndex < stripOffsets.length && row < height; stripIndex++) {
    const rows = Math.min(rowsPerStrip, height - row)
    const stripOffset = stripOffsets[stripIndex]
    const stripByteCount = stripByteCounts[stripIndex] ?? Math.max(0, bytes.length - stripOffset)
    const stripData = await inflateRawAsync(bytes.subarray(stripOffset, stripOffset + stripByteCount))
    const stripView = new DataView(stripData.buffer, stripData.byteOffset, stripData.byteLength)
    let p = 0
    for (let sy = 0; sy < rows && p < stripData.byteLength; sy++, row++) {
      for (let x = 0; x < width; x++) {
        const samples: number[] = []
        for (let s = 0; s < samplesPerPixel; s++) {
          const sample = sampleBytes === 2 ? stripView.getUint16(p, little) : stripView.getUint8(p)
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
    compression: "deflate",
    imageData: imageDataFromRgba(width, height, rgba),
    warnings,
    metadata: {
      strips: stripOffsets.length,
      rowsPerStrip,
      byteOrder,
    },
  }
}

function rgbaPixelBytes(imageData: ImageData): Uint8Array {
  return new Uint8Array(imageData.data)
}

function encodeTiffLzw(data: Uint8Array): Uint8Array {
  const clear = 256
  const eoi = 257
  const maxCode = 4095
  let codeSize = 9
  let nextCode = 258
  const dict = new Map<string, number>()
  const out: number[] = []
  let bitBuffer = 0
  let bitCount = 0

  const reset = () => {
    dict.clear()
    for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i)
    codeSize = 9
    nextCode = 258
  }
  const emit = (code: number) => {
    bitBuffer = (bitBuffer << codeSize) | code
    bitCount += codeSize
    while (bitCount >= 8) {
      out.push((bitBuffer >>> (bitCount - 8)) & 255)
      bitCount -= 8
      bitBuffer &= (1 << bitCount) - 1
    }
  }
  const add = (key: string) => {
    if (nextCode > maxCode) {
      emit(clear)
      reset()
      return
    }
    dict.set(key, nextCode++)
    if (nextCode + 1 === 1 << codeSize && codeSize < 12) codeSize++
  }

  reset()
  emit(clear)
  if (data.length) {
    let w = String.fromCharCode(data[0])
    for (let i = 1; i < data.length; i++) {
      const k = String.fromCharCode(data[i])
      const wk = w + k
      if (dict.has(wk)) {
        w = wk
      } else {
        emit(dict.get(w) ?? data[i - 1])
        add(wk)
        w = k
      }
    }
    emit(dict.get(w) ?? 0)
  }
  emit(eoi)
  if (bitCount > 0) out.push((bitBuffer << (8 - bitCount)) & 255)
  return new Uint8Array(out)
}

function tiffAsciiBytes(value: string): Uint8Array {
  const clean = value.replace(/\0/g, " ").slice(0, 2048)
  return concatUint8([asciiBytes(clean), new Uint8Array([0])])
}

function tiffDateTime(value: string | undefined) {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getUTCFullYear()}:${pad(date.getUTCMonth() + 1)}:${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

function cleanMetadataText(value: string | undefined, maxLength = 2048) {
  return value?.replace(/\0/g, " ").replace(/[\r\n]+/g, " ").trim().slice(0, maxLength) || ""
}

function tiffU16LE(value: number) {
  return new Uint8Array([value & 255, (value >>> 8) & 255])
}

function tiffU32LE(value: number) {
  return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255])
}

function tiffWriteField(
  bytes: Uint8Array,
  view: DataView,
  entry: number,
  field: { tag: number; type: number; count: number; value?: number; data?: Uint8Array },
  valueOffset: number,
  copyOffset = valueOffset,
  little = true,
) {
  view.setUint16(entry, field.tag, little)
  view.setUint16(entry + 2, field.type, little)
  view.setUint32(entry + 4, field.count, little)
  if (field.data) {
    if (field.data.byteLength <= 4) {
      bytes.set(field.data, entry + 8)
    } else {
      view.setUint32(entry + 8, valueOffset, little)
      bytes.set(field.data, copyOffset)
    }
  } else if (field.type === 3 && field.count === 1) {
    view.setUint16(entry + 8, field.value ?? 0, little)
  } else {
    view.setUint32(entry + 8, field.value ?? 0, little)
  }
}

function rationalBytes64(numerator: number, denominator: number): Uint8Array {
  const num = Math.max(0, Math.round(numerator))
  const den = Math.max(1, Math.round(denominator))
  return concatUint8([tiffU32LE(num), tiffU32LE(den)])
}

function decimalDegreesToRational(decimal: number): Uint8Array {
  // Convert to deg/min/sec rationals.
  const abs = Math.abs(decimal)
  const degrees = Math.floor(abs)
  const minutesFloat = (abs - degrees) * 60
  const minutes = Math.floor(minutesFloat)
  const seconds = (minutesFloat - minutes) * 60
  // Encode seconds at millisecond precision (×1000).
  return concatUint8([
    rationalBytes64(degrees, 1),
    rationalBytes64(minutes, 1),
    rationalBytes64(Math.round(seconds * 1000), 1000),
  ])
}

function buildGpsIfdBytes(metadata: RasterExportMetadata, baseOffset: number): Uint8Array | null {
  const gps = metadata.gps
  if (!gps || (gps.latitude === undefined && gps.longitude === undefined)) return null
  const fields: TiffField[] = []
  // GPS Version ID (tag 0): 2.2.0.0
  fields.push({ tag: 0, type: 1, count: 4, data: new Uint8Array([2, 2, 0, 0]) })
  if (typeof gps.latitude === "number" && Number.isFinite(gps.latitude)) {
    fields.push({ tag: 1, type: 2, count: 2, data: tiffAsciiBytes(gps.latitude >= 0 ? "N" : "S") })
    fields.push({ tag: 2, type: 5, count: 3, data: decimalDegreesToRational(gps.latitude) })
  }
  if (typeof gps.longitude === "number" && Number.isFinite(gps.longitude)) {
    fields.push({ tag: 3, type: 2, count: 2, data: tiffAsciiBytes(gps.longitude >= 0 ? "E" : "W") })
    fields.push({ tag: 4, type: 5, count: 3, data: decimalDegreesToRational(gps.longitude) })
  }
  if (typeof gps.altitude === "number" && Number.isFinite(gps.altitude)) {
    fields.push({ tag: 5, type: 1, count: 1, data: new Uint8Array([gps.altitude < 0 ? 1 : 0]) })
    fields.push({ tag: 6, type: 5, count: 1, data: rationalBytes64(Math.round(Math.abs(gps.altitude) * 100), 100) })
  }
  if (gps.capturedAt) {
    const date = new Date(gps.capturedAt)
    if (!Number.isNaN(date.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0")
      const dateStamp = tiffAsciiBytes(`${date.getUTCFullYear()}:${pad(date.getUTCMonth() + 1)}:${pad(date.getUTCDate())}`)
      const timeStamp = concatUint8([
        rationalBytes64(date.getUTCHours(), 1),
        rationalBytes64(date.getUTCMinutes(), 1),
        rationalBytes64(date.getUTCSeconds(), 1),
      ])
      fields.push({ tag: 29, type: 2, count: dateStamp.byteLength, data: dateStamp })
      fields.push({ tag: 7, type: 5, count: 3, data: timeStamp })
    }
  }
  if (fields.length <= 1) return null
  fields.sort((a, b) => a.tag - b.tag)
  return packTiffSubIfd(fields, baseOffset)
}

function packTiffSubIfd(fields: TiffField[], baseOffset: number): Uint8Array {
  const tagCount = fields.length
  const ifdSize = 2 + tagCount * 12 + 4
  let extraLength = 0
  for (const field of fields) if (field.data && field.data.byteLength > 4) extraLength += field.data.byteLength
  const bytes = new Uint8Array(ifdSize + extraLength)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, tagCount, true)
  let entry = 2
  let extraOffset = ifdSize
  for (const field of fields) {
    const dataOffset = field.data && field.data.byteLength > 4 ? baseOffset + extraOffset : 0
    tiffWriteField(bytes, view, entry, field, dataOffset, extraOffset)
    if (field.data && field.data.byteLength > 4) extraOffset += field.data.byteLength
    entry += 12
  }
  view.setUint32(entry, 0, true)
  return bytes
}

function buildExifIfdBytes(metadata: RasterExportMetadata, baseOffset: number): Uint8Array {
  const fields: TiffField[] = []
  const dateTime = tiffDateTime(metadata.creationDate)
  if (dateTime) {
    const data = tiffAsciiBytes(dateTime)
    fields.push({ tag: 36867, type: 2, count: data.byteLength, data })
    fields.push({ tag: 36868, type: 2, count: data.byteLength, data })
  }
  if (metadata.creationDate) {
    const offsetMatch = /([+-]\d{2}:\d{2}|Z)$/.exec(metadata.creationDate)
    if (offsetMatch) {
      const value = offsetMatch[0] === "Z" ? "+00:00" : offsetMatch[0]
      const data = tiffAsciiBytes(value)
      // OffsetTimeOriginal (36881) and OffsetTimeDigitized (36882) — Exif 2.31
      fields.push({ tag: 36881, type: 2, count: data.byteLength, data })
      fields.push({ tag: 36882, type: 2, count: data.byteLength, data })
    }
  }
  const comment = cleanMetadataText(metadata.description, 512)
  if (comment) {
    const data = concatUint8([asciiBytes("ASCII"), new Uint8Array([0, 0, 0]), asciiBytes(comment)])
    fields.push({ tag: 37510, type: 7, count: data.byteLength, data })
  }
  fields.push({ tag: 40961, type: 3, count: 1, value: metadata.iccProfileName && !/srgb/i.test(metadata.iccProfileName) ? 0xffff : 1 })
  if (!fields.length) return new Uint8Array([0, 0, 0, 0, 0, 0])
  fields.sort((a, b) => a.tag - b.tag)
  return packTiffSubIfd(fields, baseOffset)
}

function iptcDataset(record: number, dataset: number, value: string): Uint8Array {
  const data = new TextEncoder().encode(cleanMetadataText(value, 32767))
  if (!data.byteLength) return new Uint8Array(0)
  return concatUint8([new Uint8Array([0x1c, record & 255, dataset & 255, (data.byteLength >>> 8) & 255, data.byteLength & 255]), data])
}

function buildIptcIimBytes(metadata: RasterExportMetadata): Uint8Array {
  const parts: Uint8Array[] = []
  if (metadata.title) parts.push(iptcDataset(2, 5, metadata.title))
  for (const keyword of metadata.keywords ?? []) parts.push(iptcDataset(2, 25, keyword))
  if (metadata.author) parts.push(iptcDataset(2, 80, metadata.author))
  if (metadata.credit) parts.push(iptcDataset(2, 110, metadata.credit))
  if (metadata.source) parts.push(iptcDataset(2, 115, metadata.source))
  if (metadata.copyright) parts.push(iptcDataset(2, 116, metadata.copyright))
  if (metadata.description) parts.push(iptcDataset(2, 120, metadata.description))
  return concatUint8(parts.filter((part) => part.byteLength > 0))
}

function normalizeTiffCustomFields(customFields: TiffCustomField[] | undefined): TiffField[] {
  return (customFields ?? [])
    .filter((field) => Number.isFinite(field.tag) && Number.isFinite(field.type))
    .map((field) => ({
      tag: Math.max(0, Math.min(65535, Math.round(field.tag))),
      type: Math.max(1, Math.round(field.type)),
      count: field.count ?? (field.data ? field.data.byteLength : 1),
      value: field.value,
      data: field.data,
    }))
}

function tiffMetadataFields(metadata: RasterExportMetadata | undefined, customFields?: TiffCustomField[]): TiffField[] {
  const custom = normalizeTiffCustomFields(customFields)
  if (!metadata) return custom
  const fields: TiffField[] = []
  const software = tiffAsciiBytes("Photoshop Web")
  fields.push({ tag: 305, type: 2, count: software.byteLength, data: software })
  if (metadata.description) {
    const data = tiffAsciiBytes(metadata.description)
    fields.push({ tag: 270, type: 2, count: data.byteLength, data })
  }
  const dateTime = tiffDateTime(metadata.creationDate)
  if (dateTime) {
    const data = tiffAsciiBytes(dateTime)
    fields.push({ tag: 306, type: 2, count: data.byteLength, data })
  }
  if (metadata.author) {
    const data = tiffAsciiBytes(metadata.author)
    fields.push({ tag: 315, type: 2, count: data.byteLength, data })
  }
  if (metadata.copyright) {
    const data = tiffAsciiBytes(metadata.copyright)
    fields.push({ tag: 33432, type: 2, count: data.byteLength, data })
  }
  const iptc = buildIptcIimBytes(metadata)
  if (iptc.byteLength) fields.push({ tag: 33723, type: 7, count: iptc.byteLength, data: iptc })
  if (metadata.iccProfile?.byteLength) {
    fields.push({ tag: 34675, type: 7, count: metadata.iccProfile.byteLength, data: metadata.iccProfile })
  }
  const c2pa = c2paManifestStoreFromRasterMetadata(metadata)
  if (c2pa?.byteLength) fields.push({ tag: 52545, type: 7, count: c2pa.byteLength, data: c2pa })
  const xmp = xmpPacketFromRasterMetadata(metadata)
  if (xmp) {
    const data = new TextEncoder().encode(xmp)
    fields.push({ tag: 700, type: 1, count: data.length, data })
  }
  if (dateTime || metadata.description || metadata.iccProfileName) {
    fields.push({ tag: 34665, type: 4, count: 1, dataFactory: (offset) => buildExifIfdBytes(metadata, offset) })
  }
  if (buildGpsIfdBytes(metadata, 0)?.byteLength) {
    fields.push({ tag: 34853, type: 4, count: 1, dataFactory: (offset) => buildGpsIfdBytes(metadata, offset) ?? new Uint8Array(0) })
  }
  return [...fields, ...custom]
}

interface TiffField {
  tag: number
  type: number
  count: number
  value?: number
  data?: Uint8Array
  dataFactory?: (offset: number) => Uint8Array
  dataOffset?: number
}

function buildTiffImageData(
  imageData: ImageData,
  compressionTag: number,
  pixelBytes: Uint8Array,
  metadata?: RasterExportMetadata,
  customFields?: TiffCustomField[],
): ArrayBuffer {
  const width = imageData.width
  const height = imageData.height
  assertCanvasSize(width, height, "TIFF export")
  const fields: TiffField[] = [
    { tag: 256, type: 4, count: 1, value: width },
    { tag: 257, type: 4, count: 1, value: height },
    { tag: 258, type: 3, count: 4, data: new Uint8Array([8, 0, 8, 0, 8, 0, 8, 0]) },
    { tag: 259, type: 3, count: 1, value: compressionTag },
    { tag: 262, type: 3, count: 1, value: 2 },
    { tag: 273, type: 4, count: 1, value: 0 },
    { tag: 277, type: 3, count: 1, value: 4 },
    { tag: 278, type: 4, count: 1, value: height },
    { tag: 279, type: 4, count: 1, value: pixelBytes.byteLength },
    { tag: 284, type: 3, count: 1, value: 1 },
    { tag: 338, type: 3, count: 1, value: 2 },
    ...tiffMetadataFields(metadata, customFields),
  ].sort((a, b) => a.tag - b.tag)
  const tagCount = fields.length
  const ifdOffset = 8
  const dataOffset = ifdOffset + 2 + tagCount * 12 + 4
  let extraLength = 0
  for (const field of fields) {
    const data = field.data ?? field.dataFactory?.(0)
    if (data && data.byteLength > 4) extraLength += data.byteLength
  }
  const pixelOffset = dataOffset + extraLength
  for (const field of fields) {
    if (field.tag === 273) field.value = pixelOffset
  }
  let plannedExtraOffset = dataOffset
  for (const field of fields) {
    const data = field.data ?? field.dataFactory?.(plannedExtraOffset)
    if (!data) continue
    field.data = data
    if (data.byteLength > 4) {
      field.dataOffset = plannedExtraOffset
      plannedExtraOffset += data.byteLength
    }
  }
  const bytes = new Uint8Array(pixelOffset + pixelBytes.byteLength)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x49
  bytes[1] = 0x49
  view.setUint16(2, 42, true)
  view.setUint32(4, ifdOffset, true)
  view.setUint16(ifdOffset, tagCount, true)
  let entry = ifdOffset + 2
  let extraOffset = dataOffset
  const writeField = (field: TiffField) => {
    view.setUint16(entry, field.tag, true)
    view.setUint16(entry + 2, field.type, true)
    view.setUint32(entry + 4, field.count, true)
    if (field.data) {
      if (field.data.byteLength <= 4) {
        bytes.set(field.data, entry + 8)
      } else {
        const offset = field.dataOffset ?? extraOffset
        view.setUint32(entry + 8, offset, true)
        bytes.set(field.data, offset)
        extraOffset = offset + field.data.byteLength
      }
    } else if (field.type === 3 && field.count === 1) {
      view.setUint16(entry + 8, field.value ?? 0, true)
    } else {
      view.setUint32(entry + 8, field.value ?? 0, true)
    }
    entry += 12
  }
  for (const field of fields) writeField(field)
  view.setUint32(entry, 0, true)
  bytes.set(pixelBytes, pixelOffset)
  return bytes.buffer
}

function highBitSampleUnit(image: HighBitImage, index: number) {
  if (image.storage === "uint16") return (image.data as Uint16Array)[index] / 65535
  if (image.storage === "float32") return Math.max(0, Math.min(1, (image.data as Float32Array)[index]))
  return (image.data as Uint8ClampedArray)[index] / 255
}

function highBitRgbaPixelBytes(image: HighBitImage) {
  const bytesPerSample = image.storage === "float32" ? 4 : image.bitDepth === 16 || image.storage === "uint16" ? 2 : 1
  const bytes = new Uint8Array(image.width * image.height * 4 * bytesPerSample)
  const view = new DataView(bytes.buffer)
  let out = 0
  for (let i = 0; i < image.width * image.height * 4; i++) {
    if (bytesPerSample === 4) {
      const value = image.storage === "float32"
        ? Number((image.data as Float32Array)[i])
        : highBitSampleUnit(image, i)
      view.setFloat32(out, Number.isFinite(value) ? value : 0, true)
      out += 4
    } else if (bytesPerSample === 2) {
      const value = image.storage === "uint16"
        ? (image.data as Uint16Array)[i]
        : Math.round(highBitSampleUnit(image, i) * 65535)
      view.setUint16(out, Math.max(0, Math.min(65535, value)), true)
      out += 2
    } else {
      bytes[out++] = Math.max(0, Math.min(255, Math.round(highBitSampleUnit(image, i) * 255)))
    }
  }
  return bytes
}

function buildTiffHighBitImageData(image: HighBitImage, compressionTag: number, pixelBytes: Uint8Array, metadata?: RasterExportMetadata, customFields?: TiffCustomField[]): ArrayBuffer {
  const width = image.width
  const height = image.height
  assertCanvasSize(width, height, "TIFF export")
  const bits = image.storage === "float32" ? 32 : image.bitDepth === 16 || image.storage === "uint16" ? 16 : 8
  const includeSampleFormat = bits === 32
  const fields: TiffField[] = [
    { tag: 256, type: 4, count: 1, value: width },
    { tag: 257, type: 4, count: 1, value: height },
    { tag: 258, type: 3, count: 4, data: concatUint8([tiffU16LE(bits), tiffU16LE(bits), tiffU16LE(bits), tiffU16LE(bits)]) },
    { tag: 259, type: 3, count: 1, value: compressionTag },
    { tag: 262, type: 3, count: 1, value: 2 },
    { tag: 273, type: 4, count: 1, value: 0 },
    { tag: 277, type: 3, count: 1, value: 4 },
    { tag: 278, type: 4, count: 1, value: height },
    { tag: 279, type: 4, count: 1, value: pixelBytes.byteLength },
    { tag: 284, type: 3, count: 1, value: 1 },
    { tag: 338, type: 3, count: 1, value: 2 },
    ...(includeSampleFormat
      ? [{ tag: 339, type: 3, count: 4, data: concatUint8([tiffU16LE(3), tiffU16LE(3), tiffU16LE(3), tiffU16LE(3)]) } as TiffField]
      : []),
    ...tiffMetadataFields(metadata, customFields),
  ].sort((a, b) => a.tag - b.tag)
  const tagCount = fields.length
  const ifdOffset = 8
  const dataOffset = ifdOffset + 2 + tagCount * 12 + 4
  let extraLength = 0
  for (const field of fields) {
    const data = field.data ?? field.dataFactory?.(0)
    if (data && data.byteLength > 4) extraLength += data.byteLength
  }
  const pixelOffset = dataOffset + extraLength
  for (const field of fields) {
    if (field.tag === 273) field.value = pixelOffset
  }
  let plannedExtraOffset = dataOffset
  for (const field of fields) {
    const data = field.data ?? field.dataFactory?.(plannedExtraOffset)
    if (!data) continue
    field.data = data
    if (data.byteLength > 4) {
      field.dataOffset = plannedExtraOffset
      plannedExtraOffset += data.byteLength
    }
  }
  const bytes = new Uint8Array(pixelOffset + pixelBytes.byteLength)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x49
  bytes[1] = 0x49
  view.setUint16(2, 42, true)
  view.setUint32(4, ifdOffset, true)
  view.setUint16(ifdOffset, tagCount, true)
  let entry = ifdOffset + 2
  let extraOffset = dataOffset
  for (const field of fields) {
    if (field.data && field.data.byteLength > 4) {
      const offset = field.dataOffset ?? extraOffset
      tiffWriteField(bytes, view, entry, field, offset)
      extraOffset = offset + field.data.byteLength
    } else {
      tiffWriteField(bytes, view, entry, field, extraOffset)
    }
    entry += 12
  }
  view.setUint32(entry, 0, true)
  bytes.set(pixelBytes, pixelOffset)
  return bytes.buffer
}

export function encodeTiffHighBitImageData(image: HighBitImage, options: TiffEncodeOptions = {}): ArrayBuffer {
  const compression = options.compression ?? "none"
  if (compression === "deflate") throw new Error("Deflate TIFF export is asynchronous. Use encodeTiffHighBitImageDataAsync().")
  const pixels = highBitRgbaPixelBytes(image)
  if (compression === "lzw") return buildTiffHighBitImageData(image, 5, encodeTiffLzw(pixels), options.metadata, options.customFields)
  return buildTiffHighBitImageData(image, 1, pixels, options.metadata, options.customFields)
}

export async function encodeTiffHighBitImageDataAsync(image: HighBitImage, options: TiffEncodeOptions = {}): Promise<ArrayBuffer> {
  const compression = options.compression ?? "none"
  if (compression === "deflate") return buildTiffHighBitImageData(image, 8, await deflateRaw(highBitRgbaPixelBytes(image)), options.metadata, options.customFields)
  return encodeTiffHighBitImageData(image, options)
}

export function encodeTiffImageData(imageData: ImageData, options: TiffEncodeOptions = {}): ArrayBuffer {
  const compression = options.compression ?? "none"
  if (compression === "deflate") {
    throw new Error("Deflate TIFF export is asynchronous. Use encodeTiffImageDataAsync().")
  }
  const pixels = rgbaPixelBytes(imageData)
  if (compression === "lzw") return buildTiffImageData(imageData, 5, encodeTiffLzw(pixels), options.metadata, options.customFields)
  return buildTiffImageData(imageData, 1, pixels, options.metadata, options.customFields)
}

export async function encodeTiffImageDataAsync(imageData: ImageData, options: TiffEncodeOptions = {}): Promise<ArrayBuffer> {
  const compression = options.compression ?? "none"
  if (compression === "deflate") return buildTiffImageData(imageData, 8, await deflateRaw(rgbaPixelBytes(imageData)), options.metadata, options.customFields)
  return encodeTiffImageData(imageData, options)
}

function bigTiffTypeBytes(type: number) {
  if ([3, 8].includes(type)) return 2
  if ([4, 9, 11].includes(type)) return 4
  if ([5, 10, 12, 16, 17, 18].includes(type)) return 8
  return 1
}

function resolveBigTiffFieldData(field: TiffField, plannedOffset: number) {
  if (field.dataFactory) return field.dataFactory(plannedOffset)
  return field.data
}

function writeBigTiffIfd(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  fields: TiffField[],
  nextIfdOffset: number,
) {
  view.setBigUint64(offset, BigInt(fields.length), true)
  let entry = offset + 8
  for (const field of fields) {
    view.setUint16(entry, field.tag, true)
    view.setUint16(entry + 2, field.type, true)
    view.setBigUint64(entry + 4, BigInt(field.count), true)
    if (field.data) {
      if (field.data.byteLength <= 8) {
        bytes.set(field.data, entry + 12)
      } else {
        view.setBigUint64(entry + 12, BigInt(field.dataOffset ?? 0), true)
        bytes.set(field.data, field.dataOffset ?? 0)
      }
    } else if (field.type === 3 && field.count === 1) {
      view.setUint16(entry + 12, field.value ?? 0, true)
    } else {
      view.setBigUint64(entry + 12, BigInt(field.value ?? 0), true)
    }
    entry += 20
  }
  view.setBigUint64(entry, BigInt(nextIfdOffset), true)
}

function planBigTiffFields(fields: TiffField[], dataOffset: number) {
  let extraOffset = dataOffset
  for (const field of fields) {
    const data = resolveBigTiffFieldData(field, extraOffset)
    if (!data) continue
    field.data = data
    field.count = field.count || Math.max(1, Math.floor(data.byteLength / bigTiffTypeBytes(field.type)))
    if (data.byteLength > 8) {
      field.dataOffset = extraOffset
      extraOffset += data.byteLength
    }
  }
  return extraOffset
}

function bigTiffDirectoryFields(directory: BigTiffDirectorySpec): TiffField[] {
  const fields: TiffField[] = [
    ...(directory.width ? [{ tag: 256, type: 4, count: 1, value: directory.width } as TiffField] : []),
    ...(directory.height ? [{ tag: 257, type: 4, count: 1, value: directory.height } as TiffField] : []),
    ...(directory.name ? [{ tag: 270, type: 2, count: directory.name.length + 1, data: tiffAsciiBytes(directory.name) } as TiffField] : []),
    ...normalizeTiffCustomFields(directory.fields),
  ]
  return fields.sort((a, b) => a.tag - b.tag)
}

export function encodeBigTiffImageData(imageData: ImageData, options: BigTiffEncodeOptions = {}): ArrayBuffer {
  assertCanvasSize(imageData.width, imageData.height, "BigTIFF export")
  const pixelBytes = rgbaPixelBytes(imageData)
  const directorySpecs = options.directories ?? []
  const firstIfdOffset = 16
  const baseRootFields: TiffField[] = [
    { tag: 256, type: 4, count: 1, value: imageData.width },
    { tag: 257, type: 4, count: 1, value: imageData.height },
    { tag: 258, type: 3, count: 4, data: new Uint8Array([8, 0, 8, 0, 8, 0, 8, 0]) },
    { tag: 259, type: 3, count: 1, value: 1 },
    { tag: 262, type: 3, count: 1, value: 2 },
    { tag: 273, type: 16, count: 1, value: 0 },
    { tag: 277, type: 3, count: 1, value: 4 },
    { tag: 278, type: 4, count: 1, value: imageData.height },
    { tag: 279, type: 16, count: 1, value: pixelBytes.byteLength },
    { tag: 284, type: 3, count: 1, value: 1 },
    { tag: 338, type: 3, count: 1, value: 2 },
    ...tiffMetadataFields(options.metadata, options.customFields),
  ]
  if (directorySpecs.length) baseRootFields.push({ tag: 330, type: 16, count: 1, value: 0 })
  const rootFields = baseRootFields.sort((a, b) => a.tag - b.tag)
  const rootIfdSize = 8 + rootFields.length * 20 + 8
  let extraOffset = firstIfdOffset + rootIfdSize
  extraOffset = planBigTiffFields(rootFields, extraOffset)
  const pixelOffset = extraOffset
  for (const field of rootFields) {
    if (field.tag === 273) field.value = pixelOffset
  }
  let nextIfdOffset = pixelOffset + pixelBytes.byteLength
  const extraDirectories = directorySpecs.map(bigTiffDirectoryFields)
  if (!extraDirectories.length) nextIfdOffset = 0
  else {
    for (const field of rootFields) if (field.tag === 330) field.value = nextIfdOffset
  }
  let totalLength = pixelOffset + pixelBytes.byteLength
  for (const fields of extraDirectories) {
    const ifdOffset = totalLength
    const ifdSize = 8 + fields.length * 20 + 8
    totalLength += ifdSize
    totalLength = planBigTiffFields(fields, totalLength)
    for (const field of fields) if (field.tag === 273) field.value = totalLength
    void ifdOffset
  }
  const bytes = new Uint8Array(totalLength)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x49
  bytes[1] = 0x49
  view.setUint16(2, 43, true)
  view.setUint16(4, 8, true)
  view.setUint16(6, 0, true)
  view.setBigUint64(8, BigInt(firstIfdOffset), true)
  writeBigTiffIfd(bytes, view, firstIfdOffset, rootFields, extraDirectories.length ? nextIfdOffset : 0)
  bytes.set(pixelBytes, pixelOffset)
  let ifdOffset = pixelOffset + pixelBytes.byteLength
  for (let i = 0; i < extraDirectories.length; i++) {
    const fields = extraDirectories[i]
    const next = i + 1 < extraDirectories.length ? ifdOffset + 8 + fields.length * 20 + 8 : 0
    writeBigTiffIfd(bytes, view, ifdOffset, fields, next)
    ifdOffset = next || ifdOffset
  }
  return bytes.buffer
}

export interface DngEncodeOptions extends TiffEncodeOptions {
  cameraModel?: string
  uniqueCameraModel?: string
  sidecar?: string
}

export function encodeDngImageData(imageData: ImageData, options: DngEncodeOptions = {}): ArrayBuffer {
  const uniqueModel = options.uniqueCameraModel || options.cameraModel || "Photoshop Web DNG"
  const dngFields: TiffCustomField[] = [
    { tag: 50706, type: 1, count: 4, data: new Uint8Array([1, 4, 0, 0]) },
    { tag: 50707, type: 1, count: 4, data: new Uint8Array([1, 1, 0, 0]) },
    { tag: 50708, type: 2, count: uniqueModel.length + 1, data: tiffAsciiBytes(uniqueModel) },
    { tag: 50717, type: 3, count: 1, value: 2 },
    { tag: 50721, type: 5, count: 9, data: concatUint8([
      tiffU32LE(1), tiffU32LE(1), tiffU32LE(0), tiffU32LE(1), tiffU32LE(0), tiffU32LE(1),
      tiffU32LE(0), tiffU32LE(1), tiffU32LE(1), tiffU32LE(1), tiffU32LE(0), tiffU32LE(1),
      tiffU32LE(0), tiffU32LE(1), tiffU32LE(0), tiffU32LE(1), tiffU32LE(1), tiffU32LE(1),
    ]) },
  ]
  const metadata = {
    ...options.metadata,
    source: options.metadata?.source ?? "DNG",
    xmp: options.sidecar ?? options.metadata?.xmp,
  }
  return encodeTiffImageData(imageData, {
    ...options,
    metadata,
    customFields: [...dngFields, ...(options.customFields ?? [])],
  })
}

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

const TGA_DEVELOPER_TAG_METADATA = 65000
const TGA_DEVELOPER_PREFIX = "PSWEBMETA\0"
const TGA_SIGNATURE = "TRUEVISION-XFILE.\0"

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

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function jsonXml(value: unknown) {
  return xmlEscape(JSON.stringify(value))
}

function compactJsonObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")) as Partial<T>
}

const C2PA_MANIFEST_STORE_UUID = new Uint8Array([
  0x63, 0x32, 0x70, 0x61,
  0x00, 0x11,
  0x00, 0x10,
  0x80, 0x00,
  0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
])

const C2PA_BMFF_UUID = new Uint8Array([
  0xd8, 0xfe, 0xc3, 0xd6,
  0x1b, 0x0e,
  0x48, 0x3c,
  0x92, 0x97,
  0x58, 0x28, 0x87, 0x7e, 0xc4, 0x81,
])

function metadataBox(type: string, data: Uint8Array): Uint8Array {
  return concatUint8([u32BE(data.byteLength + 8), asciiBytes(type), data])
}

const C2PA_REDACTION_KEYS = new Set([
  "email",
  "phone",
  "address",
  "ip",
  "ipv4",
  "ipv6",
  "userid",
  "username",
  "password",
  "secret",
  "token",
  "filepath",
  "path",
  "filename",
  "creator",
  "creatorname",
  "creatorid",
  "user",
])

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[redacted-depth]"
  if (value === null || value === undefined) return value
  if (typeof value === "string") {
    if (value.length > 240) return `${value.slice(0, 240)}…`
    return value
  }
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) {
    return value.slice(0, 16).map((entry) => redactValue(entry, depth + 1))
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {}
    let kept = 0
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (kept >= 24) {
        out["…"] = "[redacted-overflow]"
        break
      }
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "")
      if (C2PA_REDACTION_KEYS.has(normalized)) {
        out[key] = "[redacted]"
      } else {
        out[key] = redactValue(entry, depth + 1)
      }
      kept += 1
    }
    return out
  }
  return String(value)
}

function redactEditList(entries: RasterExportEditEntry[] | undefined, limit: number): RasterExportEditEntry[] {
  if (!entries?.length) return []
  const tail = entries.slice(-Math.max(0, limit))
  return tail.map((entry) => ({
    id: entry.id,
    label: typeof entry.label === "string" ? entry.label.slice(0, 240) : "edit",
    at: entry.at,
    tool: entry.tool,
    parameters: entry.parameters ? (redactValue(entry.parameters) as Record<string, unknown>) : undefined,
  }))
}

/**
 * Stable, deterministic FNV-1a-style 64-bit hash of a string.
 *
 * The C2PA spec recommends SHA-256, but `crypto.subtle.digest` is async and the
 * encoder paths here are synchronous. This hash is sufficient for an unsigned
 * local provenance label that callers can verify against the payload bytes; it
 * is NOT a cryptographic hash and we mark the algorithm as `fnv1a-64`.
 */
function fnv1aHash64(value: string): string {
  let hi = 0xcbf29ce4
  let lo = 0x84222325
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i) & 0xffff
    let nlo = (lo ^ ch) >>> 0
    let nhi = hi >>> 0
    const aLo = nlo
    const aHi = nhi
    // multiply by 0x100000001b3 = 1099511628211 -> hi=0x100, lo=0x000001b3
    const mLo = 0x000001b3
    const mHi = 0x100
    const productLo = (aLo * mLo) >>> 0
    const carry = Math.floor(((aLo >>> 0) * mLo) / 0x100000000)
    const productHi = ((aHi * mLo + aLo * mHi + carry) >>> 0)
    nlo = productLo
    nhi = productHi
    hi = nhi >>> 0
    lo = nlo >>> 0
  }
  return `${hi.toString(16).padStart(8, "0")}${lo.toString(16).padStart(8, "0")}`
}

export interface C2paProvenancePayload {
  "@context": Record<string, string>
  "@type": "c2pa:Manifest"
  label: "c2pa"
  signatureStatus: "unsigned-local"
  manifestStoreUuid: string
  software: { name: string; version: string }
  creator?: string
  createdAt: string
  title?: string
  description?: string
  author?: string
  copyright?: string
  assertion?: string
  editList: RasterExportEditEntry[]
  credentials: ContentCredential[]
  hash: { algorithm: "fnv1a-64"; value: string; scope: "payload" }
}

/**
 * Build the canonical C2PA-style provenance JSON-LD payload from raster export
 * metadata. Returns `undefined` when there is nothing to embed.
 */
export function buildC2paProvenancePayload(metadata: RasterExportMetadata | undefined): C2paProvenancePayload | undefined {
  if (!metadata) return undefined
  const credentials = metadata.contentCredentials?.filter((credential) => credential && credential.id) ?? []
  const provenance = metadata.provenance
  const editList = redactEditList(provenance?.editList, 12)
  if (!credentials.length && !editList.length && !provenance?.creator && !provenance?.title && !provenance?.assertion) {
    return undefined
  }
  const createdAt = provenance?.createdAt ?? metadata.creationDate ?? credentials[0]?.createdAt ?? new Date().toISOString()
  const payload: C2paProvenancePayload = {
    "@context": {
      "@vocab": "https://c2pa.org/specifications/specifications/1.4/specs/_attachments/C2PA_Specification.html#",
      psweb: "https://photoshop-web.local/c2pa/1.0/",
    },
    "@type": "c2pa:Manifest",
    label: "c2pa",
    signatureStatus: "unsigned-local",
    manifestStoreUuid: "63327061-0011-0010-8000-00aa00389b71",
    software: {
      name: provenance?.software ?? "Photoshop Web",
      version: provenance?.softwareVersion ?? "0.1.0",
    },
    creator: provenance?.creator,
    createdAt,
    title: provenance?.title ?? metadata.title,
    description: metadata.description,
    author: metadata.author,
    copyright: metadata.copyright,
    assertion: provenance?.assertion,
    editList,
    credentials,
    // Placeholder; rewritten after stringify with stable hash.
    hash: { algorithm: "fnv1a-64", value: "0000000000000000", scope: "payload" },
  }
  // Compute hash over the canonicalized payload (excluding the hash field itself).
  const { hash: _hash, ...hashable } = payload
  void _hash
  const hashable_json = JSON.stringify(hashable)
  payload.hash = { algorithm: "fnv1a-64", value: fnv1aHash64(hashable_json), scope: "payload" }
  return payload
}

function serializeC2paPayload(payload: C2paProvenancePayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload))
}

export function c2paManifestStoreFromRasterMetadata(metadata: RasterExportMetadata | undefined): Uint8Array | undefined {
  const payload = buildC2paProvenancePayload(metadata)
  if (!payload) return undefined
  const manifestJson = serializeC2paPayload(payload)
  const description = metadataBox("jumd", concatUint8([
    C2PA_MANIFEST_STORE_UUID,
    new Uint8Array([0]),
    asciiBytes("c2pa\0"),
  ]))
  const manifest = metadataBox("json", manifestJson)
  return metadataBox("jumb", concatUint8([description, manifest]))
}

/**
 * Build the textual JSON-LD bytes for the C2PA payload, suitable for an
 * iTXt chunk or other text-based carrier (separate from the JUMBF box).
 */
export function c2paJsonLdBytesFromRasterMetadata(metadata: RasterExportMetadata | undefined): Uint8Array | undefined {
  const payload = buildC2paProvenancePayload(metadata)
  if (!payload) return undefined
  return serializeC2paPayload(payload)
}

function buildXmpPacket(metadata: RasterExportMetadata | undefined): string {
  if (!metadata) return ""
  const title = metadata.title ? `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(metadata.title)}</rdf:li></rdf:Alt></dc:title>` : ""
  const author = metadata.author ? `<dc:creator><rdf:Seq><rdf:li>${xmlEscape(metadata.author)}</rdf:li></rdf:Seq></dc:creator>` : ""
  const description = metadata.description ? `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(metadata.description)}</rdf:li></rdf:Alt></dc:description>` : ""
  const rights = metadata.copyright ? `<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(metadata.copyright)}</rdf:li></rdf:Alt></dc:rights>` : ""
  const keywords = metadata.keywords?.length
    ? `<dc:subject><rdf:Bag>${metadata.keywords.map((keyword) => `<rdf:li>${xmlEscape(keyword)}</rdf:li>`).join("")}</rdf:Bag></dc:subject>`
    : ""
  const created = metadata.creationDate ? ` xmp:CreateDate="${xmlEscape(metadata.creationDate)}"` : ""
  const credit = metadata.credit ? `<photoshop:Credit>${xmlEscape(metadata.credit)}</photoshop:Credit>` : ""
  const source = metadata.source ? `<photoshop:Source>${xmlEscape(metadata.source)}</photoshop:Source>` : ""
  const icc = metadata.iccProfileName ? `<psweb:ICCProfile>${xmlEscape(metadata.iccProfileName)}</psweb:ICCProfile>` : ""
  const credentials = metadata.contentCredentials?.length
    ? `<psweb:ContentCredentials>${jsonXml(metadata.contentCredentials)}</psweb:ContentCredentials>`
    : ""
  const fonts = metadata.fonts?.length
    ? `<psweb:EmbeddedFonts>${jsonXml(metadata.fonts)}</psweb:EmbeddedFonts>`
    : ""
  const webp = metadata.webp && Object.keys(compactJsonObject(metadata.webp)).length
    ? `<psweb:WebPEncoder>${jsonXml(compactJsonObject(metadata.webp))}</psweb:WebPEncoder>`
    : ""
  const avif = metadata.avif && Object.keys(compactJsonObject(metadata.avif)).length
    ? `<psweb:AVIFEncoder>${jsonXml(compactJsonObject(metadata.avif))}</psweb:AVIFEncoder>`
    : ""
  const body = `${title}${author}${description}${rights}${keywords}${credit}${source}${icc}${credentials}${fonts}${webp}${avif}`
  if (!body && !created) return ""
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:psweb="https://example.local/photoshop-web/1.0/"${created}>${body}</rdf:Description></rdf:RDF></x:xmpmeta>`
}

export function xmpPacketFromRasterMetadata(metadata: RasterExportMetadata | undefined) {
  return metadata?.xmp ?? buildXmpPacket(metadata)
}

function bytesFromInput(input: Uint8Array | ArrayBuffer): Uint8Array {
  const source = input instanceof Uint8Array ? input : new Uint8Array(input)
  const copy = new Uint8Array(source.byteLength)
  copy.set(source)
  return copy
}

function riffChunk(type: string, data: Uint8Array): Uint8Array {
  const size = new Uint8Array(4)
  new DataView(size.buffer).setUint32(0, data.byteLength, true)
  return concatUint8([
    asciiBytes(type),
    size,
    data,
    data.byteLength % 2 ? new Uint8Array([0]) : new Uint8Array(0),
  ])
}

function isWebpContainer(bytes: Uint8Array) {
  return bytes.byteLength >= 12 && readAscii(bytes.buffer, bytes.byteOffset, 4) === "RIFF" && readAscii(bytes.buffer, bytes.byteOffset + 8, 4) === "WEBP"
}

export function injectWebpXmpMetadata(input: Uint8Array | ArrayBuffer, metadata: RasterExportMetadata | undefined): Uint8Array {
  const bytes = bytesFromInput(input)
  const xmp = xmpPacketFromRasterMetadata(metadata)
  const c2pa = c2paManifestStoreFromRasterMetadata(metadata)
  if ((!xmp && !c2pa) || !isWebpContainer(bytes)) return bytes
  const chunks: Uint8Array[] = []
  if (xmp) chunks.push(riffChunk("XMP ", new TextEncoder().encode(xmp)))
  if (c2pa) chunks.push(riffChunk("C2PA", c2pa))
  const out = concatUint8([bytes, ...chunks])
  new DataView(out.buffer, out.byteOffset + 4, 4).setUint32(0, out.byteLength - 8, true)

  let offset = 12
  while (offset + 8 <= out.byteLength) {
    const type = readAscii(out.buffer, out.byteOffset + offset, 4)
    const size = new DataView(out.buffer, out.byteOffset + offset + 4, 4).getUint32(0, true)
    if (type === "VP8X" && size >= 1 && offset + 8 + size <= out.byteLength) {
      if (xmp) out[offset + 8] |= 0x04
      break
    }
    offset += 8 + size + (size % 2)
  }
  return out
}

export function injectWebpIccProfile(input: Uint8Array | ArrayBuffer, profile: Uint8Array | undefined, _profileName?: string): Uint8Array {
  const bytes = bytesFromInput(input)
  if (!profile?.byteLength || !isWebpContainer(bytes)) return bytes
  const iccChunk = riffChunk("ICCP", profile)
  const out = concatUint8([bytes, iccChunk])
  new DataView(out.buffer, out.byteOffset + 4, 4).setUint32(0, out.byteLength - 8, true)

  let offset = 12
  while (offset + 8 <= out.byteLength) {
    const type = readAscii(out.buffer, out.byteOffset + offset, 4)
    const size = new DataView(out.buffer, out.byteOffset + offset + 4, 4).getUint32(0, true)
    if (type === "VP8X" && size >= 1 && offset + 8 + size <= out.byteLength) {
      out[offset + 8] |= 0x20
      break
    }
    offset += 8 + size + (size % 2)
  }
  return out
}

function mp4Box(type: string, data: Uint8Array): Uint8Array {
  const size = new Uint8Array(4)
  new DataView(size.buffer).setUint32(0, data.byteLength + 8, false)
  return concatUint8([size, asciiBytes(type), data])
}

function isAvifContainer(bytes: Uint8Array) {
  if (bytes.byteLength < 16 || readAscii(bytes.buffer, bytes.byteOffset + 4, 4) !== "ftyp") return false
  const major = readAscii(bytes.buffer, bytes.byteOffset + 8, 4)
  if (major === "avif" || major === "avis") return true
  for (let offset = 16; offset + 4 <= bytes.byteLength; offset += 4) {
    const brand = readAscii(bytes.buffer, bytes.byteOffset + offset, 4)
    if (brand === "avif" || brand === "avis") return true
  }
  return false
}

const XMP_UUID = new Uint8Array([
  0xbe, 0x7a, 0xcf, 0xcb,
  0x97, 0xa9,
  0x42, 0xe8,
  0x9c, 0x71,
  0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac,
])

function topLevelBoxEnd(bytes: Uint8Array, type: string) {
  let offset = 0
  while (offset + 8 <= bytes.byteLength) {
    const size = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false)
    const boxType = readAscii(bytes.buffer, bytes.byteOffset + offset + 4, 4)
    if (size < 8 || offset + size > bytes.byteLength) break
    if (boxType === type) return offset + size
    offset += size
  }
  return -1
}

function contentProvenanceBmffBox(manifest: Uint8Array, boxStartOffset: number) {
  const purpose = asciiBytes("manifest\0")
  const beforeManifest = C2PA_BMFF_UUID.byteLength + 4 + purpose.byteLength + 8
  const manifestOffset = boxStartOffset + 8 + beforeManifest
  return mp4Box("uuid", concatUint8([
    C2PA_BMFF_UUID,
    new Uint8Array([0, 0, 0, 0]),
    purpose,
    u64BE(manifestOffset),
    manifest,
  ]))
}

function injectAvifC2paManifest(input: Uint8Array, manifest: Uint8Array) {
  const insertOffset = topLevelBoxEnd(input, "ftyp")
  const offset = insertOffset >= 0 ? insertOffset : input.byteLength
  const box = contentProvenanceBmffBox(manifest, offset)
  return concatUint8([input.subarray(0, offset), box, input.subarray(offset)])
}

export function injectAvifXmpMetadata(input: Uint8Array | ArrayBuffer, metadata: RasterExportMetadata | undefined): Uint8Array {
  const bytes = bytesFromInput(input)
  const xmp = xmpPacketFromRasterMetadata(metadata)
  const c2pa = c2paManifestStoreFromRasterMetadata(metadata)
  if ((!xmp && !c2pa) || !isAvifContainer(bytes)) return bytes
  let out = c2pa ? injectAvifC2paManifest(bytes, c2pa) : bytes
  if (xmp) {
    const payload = concatUint8([XMP_UUID, new TextEncoder().encode(xmp)])
    out = concatUint8([out, mp4Box("uuid", payload)])
  }
  return out
}

const ICC_UUID = new Uint8Array([
  0x70, 0x73, 0x77, 0x65,
  0x62, 0x69,
  0x63, 0x63,
  0x9a, 0x42,
  0x31, 0x9c, 0x5f, 0x2d, 0x61, 0x10,
])

export function injectAvifIccProfile(input: Uint8Array | ArrayBuffer, profile: Uint8Array | undefined, profileName = "ICC profile"): Uint8Array {
  const bytes = bytesFromInput(input)
  if (!profile?.byteLength || !isAvifContainer(bytes)) return bytes
  const header = new TextEncoder().encode(`Photoshop Web ICC\0${profileName}\0`)
  return concatUint8([bytes, mp4Box("uuid", concatUint8([ICC_UUID, header, profile]))])
}

function insertJpegXmp(bytes: Uint8Array, metadata: RasterExportMetadata | undefined): Uint8Array {
  const xmp = metadata?.xmp ?? buildXmpPacket(metadata)
  if (!xmp || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes
  const payload = concatUint8([asciiBytes("http://ns.adobe.com/xap/1.0/"), new Uint8Array([0]), new TextEncoder().encode(xmp)])
  const length = payload.length + 2
  if (length > 0xffff) return bytes
  const segment = new Uint8Array(4 + payload.length)
  segment[0] = 0xff
  segment[1] = 0xe1
  segment[2] = (length >>> 8) & 255
  segment[3] = length & 255
  segment.set(payload, 4)
  return concatUint8([bytes.subarray(0, 2), segment, bytes.subarray(2)])
}

function insertJpegC2paManifest(bytes: Uint8Array, metadata: RasterExportMetadata | undefined): Uint8Array {
  const manifest = c2paManifestStoreFromRasterMetadata(metadata)
  if (!manifest || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes
  // ISO/IEC 19566-5 JUMBF in JPEG-1 uses APP11 markers with a fixed prefix:
  //   APP11 marker (FFEB), 2-byte length, CI "JP" (2 bytes), En (2 BE), Z (4 BE),
  //   then the next slice of the JUMBF payload. The first segment also carries
  //   the LBox/TBox header bytes from the JUMBF box itself.
  const segments: Uint8Array[] = []
  // Maximum payload bytes per APP11 segment = 0xffff (length field max) minus
  // segment length field (2) - CI (2) - En (2) - Z (4) = 0xffff - 10 = 65525.
  const prefixSize = 2 /* length */ + 2 /* CI */ + 2 /* En */ + 4 /* Z */
  const maxPayloadPerSegment = 0xffff - prefixSize
  const totalPayloadBytes = manifest.byteLength
  let sequenceNumber = 1
  for (let offset = 0; offset < totalPayloadBytes; offset += maxPayloadPerSegment) {
    const chunk = manifest.subarray(offset, Math.min(totalPayloadBytes, offset + maxPayloadPerSegment))
    const length = prefixSize + chunk.byteLength // length field counts itself
    const segment = new Uint8Array(2 /* marker */ + length)
    let cursor = 0
    segment[cursor++] = 0xff
    segment[cursor++] = 0xeb
    // length field
    segment[cursor++] = (length >>> 8) & 255
    segment[cursor++] = length & 255
    // CI "JP"
    segment[cursor++] = 0x4a // 'J'
    segment[cursor++] = 0x50 // 'P'
    // En (box instance, 1)
    segment[cursor++] = 0x00
    segment[cursor++] = 0x01
    // Z (sequence number, 1-based, BE)
    segment[cursor++] = (sequenceNumber >>> 24) & 255
    segment[cursor++] = (sequenceNumber >>> 16) & 255
    segment[cursor++] = (sequenceNumber >>> 8) & 255
    segment[cursor++] = sequenceNumber & 255
    segment.set(chunk, cursor)
    segments.push(segment)
    sequenceNumber += 1
  }
  return concatUint8([bytes.subarray(0, 2), ...segments, bytes.subarray(2)])
}

let nodeMozJpegEncoderReady: Promise<{
  default: (data: ImageData, options?: Record<string, unknown>) => Promise<ArrayBuffer>
}> | null = null

async function loadMozJpegEncoder() {
  if (typeof window !== "undefined") {
    const mod = await import("@jsquash/jpeg/encode.js")
    return { default: mod.default as (data: ImageData, options?: Record<string, unknown>) => Promise<ArrayBuffer> }
  }
  if (!nodeMozJpegEncoderReady) {
    nodeMozJpegEncoderReady = (async () => {
      const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>
      const mod = await dynamicImport("@jsquash/jpeg/encode.js") as {
        default: (data: ImageData, options?: Record<string, unknown>) => Promise<ArrayBuffer>
        init: (module?: WebAssembly.Module) => Promise<void>
      }
      const fs = await dynamicImport("node:fs/promises") as { readFile: (path: string) => Promise<Buffer> }
      const path = await dynamicImport("node:path") as { join: (...parts: string[]) => string }
      const wasmPath = path.join(process.cwd(), "node_modules", "@jsquash", "jpeg", "codec", "enc", "mozjpeg_enc.wasm")
      const wasm = await WebAssembly.compile(await fs.readFile(wasmPath))
      await mod.init(wasm)
      return { default: mod.default }
    })()
  }
  return nodeMozJpegEncoderReady
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

type OpenJpegCodec = Jpeg2000EncodeCodec & {
  J2KDecoder: new () => {
    getEncodedBuffer: (encodedBitStreamLength: number) => Uint8Array
    getDecodedBuffer: () => Uint8Array
    decode: () => void
    getFrameInfo: () => Jpeg2000FrameInfo
    getIsReversible: () => boolean
    getColorSpace: () => number
  }
}

let openJpegCodecReady: Promise<unknown> | null = null
let openJpegCodecWarmupError: unknown = null

function isValidJpeg2000Codestream(encoded: Uint8Array) {
  return encoded.length >= 32 && encoded[0] === 0xff && encoded[1] === 0x4f
}

function runJpeg2000WarmupEncode(codec: Jpeg2000EncodeCodec) {
  const warm = new codec.J2KEncoder()
  try {
    warm.setDecompositions(1)
    warm.setQuality(true, 1)
    warm.getDecodedBuffer({ bitsPerSample: 8, componentCount: 3, width: 16, height: 16, isSigned: false }).fill(0)
    warm.encode()
    const encoded = bytesFromInput(warm.getEncodedBuffer())
    if (!isValidJpeg2000Codestream(encoded)) throw new Error("JPEG 2000 warm-up produced an invalid codestream")
  } finally {
    warm.delete?.()
  }
}

function warmOpenJpegCodec(codec: Jpeg2000EncodeCodec) {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      runJpeg2000WarmupEncode(codec)
      openJpegCodecWarmupError = null
      return
    } catch (error) {
      lastError = error
    }
  }
  openJpegCodecWarmupError = lastError
}

async function loadOpenJpegCodec(): Promise<OpenJpegCodec> {
  if (!openJpegCodecReady) {
    openJpegCodecReady = (async () => {
      const mod = await import("@cornerstonejs/codec-openjpeg")
      const factory = (mod.default ?? mod) as unknown as (options?: Record<string, unknown>) => Promise<unknown>
      const codec = (await factory({ print: () => undefined, printErr: () => undefined })) as OpenJpegCodec
      // This emscripten build fails its very first opj_start_compress for
      // some frame configurations (and crashes inside its own error-callback
      // binding while reporting it). Prime the module and remember repeated
      // warm-up failures so a later encode error can include that context.
      warmOpenJpegCodec(codec)
      return codec
    })()
  }
  return openJpegCodecReady as Promise<OpenJpegCodec>
}

async function jpeg2000EncodeCodec(options: Jpeg2000EncodeOptions): Promise<Jpeg2000EncodeCodec> {
  return options.openJpegCodec ? await options.openJpegCodec : loadOpenJpegCodec()
}

function encodeJpeg2000CodestreamAttempt(
  J2KEncoder: Jpeg2000EncodeCodec["J2KEncoder"],
  imageData: ImageData,
  options: Jpeg2000EncodeOptions,
): Uint8Array {
  const encoder = new J2KEncoder()
  const componentCount = options.includeAlpha ? 4 : 3
  const frameInfo = {
    bitsPerSample: 8,
    componentCount,
    width: imageData.width,
    height: imageData.height,
    isSigned: false,
  }
  try {
    encoder.setDecompositions(Math.max(0, Math.min(8, Math.round(options.decompositions ?? 0))))
    encoder.setQuality(!!options.reversible, Math.max(1, Math.min(100, Math.round((options.quality ?? 1) <= 1 ? (options.quality ?? 1) * 100 : options.quality ?? 100))))
    const decoded = encoder.getDecodedBuffer(frameInfo)
    for (let p = 0, source = 0, target = 0; p < imageData.width * imageData.height; p++, source += 4, target += componentCount) {
      decoded[target] = imageData.data[source]
      decoded[target + 1] = imageData.data[source + 1]
      decoded[target + 2] = imageData.data[source + 2]
      if (componentCount === 4) decoded[target + 3] = imageData.data[source + 3]
    }
    encoder.encode()
    const encoded = bytesFromInput(encoder.getEncodedBuffer())
    // The WASM encoder can fail without throwing, leaving a stale or empty
    // buffer behind. A real codestream always opens with the SOC marker.
    if (!isValidJpeg2000Codestream(encoded)) {
      throw new Error("JPEG 2000 encoder produced an invalid codestream")
    }
    return encoded
  } finally {
    encoder.delete?.()
  }
}

function jpeg2000EncodeFailureMessage(lastError: unknown) {
  const detail = lastError instanceof Error ? `: ${lastError.message}` : ""
  const warmupDetail = openJpegCodecWarmupError instanceof Error
    ? ` Warm-up also failed: ${openJpegCodecWarmupError.message}`
    : ""
  return `JPEG 2000 encoder failed after 2 attempts${detail}${warmupDetail}`
}

async function encodeJpeg2000Codestream(imageData: ImageData, options: Jpeg2000EncodeOptions = {}): Promise<Uint8Array> {
  assertCanvasSize(imageData.width, imageData.height, "JPEG 2000 export")
  const { J2KEncoder } = await jpeg2000EncodeCodec(options)
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return encodeJpeg2000CodestreamAttempt(J2KEncoder, imageData, options)
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(jpeg2000EncodeFailureMessage(lastError))
}

function jpeg2000Box(type: string, data: Uint8Array): Uint8Array {
  return mp4Box(type, data)
}

function jpeg2000Container(imageData: ImageData, codestream: Uint8Array, options: Jpeg2000EncodeOptions): Uint8Array {
  const container = options.container === "jpm" ? "jpm " : options.container === "jpx" ? "jpx " : "jp2 "
  const signature = jpeg2000Box("jP  ", new Uint8Array([0x0d, 0x0a, 0x87, 0x0a]))
  const ftyp = jpeg2000Box("ftyp", concatUint8([
    asciiBytes(container),
    new Uint8Array([0, 0, 0, 0]),
    asciiBytes(container),
    asciiBytes("jp2 "),
  ]))
  const components = options.includeAlpha ? 4 : 3
  const ihdr = jpeg2000Box("ihdr", concatUint8([
    u32BE(imageData.height),
    u32BE(imageData.width),
    new Uint8Array([0, components, 7, 7, 0, 0, 0, 0]),
  ]))
  const color = options.color
  const colr = color?.iccProfile?.byteLength
    ? jpeg2000Box("colr", concatUint8([new Uint8Array([2, 0, 0]), color.iccProfile]))
    : jpeg2000Box("colr", concatUint8([new Uint8Array([1, 0, 0]), u32BE(color?.enumColorSpace ?? 16)]))
  const cdef = options.includeAlpha
    ? jpeg2000Box("cdef", new Uint8Array([0, 2, 0, 0, 0, 0, 0, 0, 0, 3, 0, 1, 0, 0]))
    : new Uint8Array(0)
  const profilePayload = new TextEncoder().encode(JSON.stringify({
    profileName: color?.iccProfileName,
    profileControls: color?.profileControls,
    layers: options.layers ?? [],
    alpha: !!options.includeAlpha,
  }))
  const jp2h = jpeg2000Box("jp2h", concatUint8([ihdr, colr, cdef]))
  const pswp = jpeg2000Box("pswp", profilePayload)
  const layerBoxes = (options.layers ?? []).map((layer) => jpeg2000Box("lbl ", new TextEncoder().encode(`${layer.label}\0${layer.opacity ?? 1}`)))
  const jp2c = jpeg2000Box("jp2c", codestream)
  return concatUint8([signature, ftyp, jp2h, pswp, ...layerBoxes, jp2c])
}

export async function encodeJpeg2000ImageData(imageData: ImageData, options: Jpeg2000EncodeOptions = {}): Promise<ArrayBuffer> {
  const container = options.container ?? "codestream"
  const codestream = await encodeJpeg2000Codestream(imageData, options)
  if (container === "codestream") return exactArrayBuffer(codestream)
  return exactArrayBuffer(jpeg2000Container(imageData, codestream, options))
}

export function planPsbLargeDocumentOpen(input: {
  width: number
  height: number
  fileName?: string
  tileSize?: number
  layerCount?: number
  memoryBudgetMB?: number
}): PsbLargeDocumentOpenPlan {
  const width = Math.max(1, Math.round(Number(input.width) || 1))
  const height = Math.max(1, Math.round(Number(input.height) || 1))
  const fileName = input.fileName || "PSB document"
  const tileSize = Math.max(128, Math.round(Number(input.tileSize) || 512))
  const fitsBrowserCanvas = !canvasSizeError(width, height, "PSB canvas")
  const halfWidth = Math.max(1, Math.round(width * 0.5))
  const halfHeight = Math.max(1, Math.round(height * 0.5))
  const halfError = canvasSizeError(halfWidth, halfHeight, "50% PSB canvas")
  const overview = clampCanvasSize(width, height)
  const overviewScale = Math.min(1, overview.width / width, overview.height / height)
  const tilePlan = planTiledBackingStore({
    width,
    height,
    tileSize,
    layerCount: input.layerCount,
    memoryBudgetMB: input.memoryBudgetMB,
  })
  const defaultError = fitsBrowserCanvas
    ? null
    : `${fileName} is ${width} x ${height} px, which exceeds this browser canvas limit (${canvasLimitLabel()}). open at 50% scale or use tile view, or downscale the PSB before opening for full-document editing.`
  return {
    width,
    height,
    fileName,
    fitsBrowserCanvas,
    defaultError,
    downscale50: {
      scale: 0.5,
      width: halfWidth,
      height: halfHeight,
      fits: !halfError,
      error: halfError,
    },
    tileView: {
      tileSize: tilePlan.tileSize,
      tileColumns: tilePlan.tileColumns,
      tileRows: tilePlan.tileRows,
      tileCount: tilePlan.tileCount,
      overviewScale,
      overviewWidth: overview.width,
      overviewHeight: overview.height,
      recommendation: tilePlan.recommendation,
    },
  }
}

function float32ToFloat16Bits(value: number) {
  if (!Number.isFinite(value)) return value < 0 ? 0xfc00 : 0x7c00
  const floatView = new Float32Array(1)
  const intView = new Uint32Array(floatView.buffer)
  floatView[0] = value
  const bits = intView[0]
  const sign = (bits >>> 16) & 0x8000
  const exponent = ((bits >>> 23) & 0xff) - 127 + 15
  const mantissa = bits & 0x7fffff
  if (exponent <= 0) {
    if (exponent < -10) return sign
    return sign | ((mantissa | 0x800000) >>> (1 - exponent + 13))
  }
  if (exponent >= 31) return sign | 0x7c00
  return sign | (exponent << 10) | (mantissa >>> 13)
}

function encodeOpenExrRaster(
  width: number,
  height: number,
  options: OpenExrEncodeOptions,
  sampleAt: (channelName: string, x: number, y: number, channelIndex: number) => number,
): ArrayBuffer {
  assertCanvasSize(width, height, "OpenEXR export")
  const channelNames = options.channels === "gray"
    ? ["Y"]
    : options.channels === "rgb"
      ? ["R", "G", "B"]
      : ["R", "G", "B", "A"]
  const pixelType = options.pixelType === "half" ? 1 : 2
  const sampleBytes = pixelType === 1 ? 2 : 4
  const header: number[] = []
  const pushU8 = (value: number) => header.push(value & 255)
  const pushU32 = (value: number) => {
    header.push(value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255)
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
  for (const channel of channelNames) {
    channelCString(channel)
    channelList.push(...u32Bytes(pixelType), 0, 0, 0, 0, ...u32Bytes(1), ...u32Bytes(1))
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

  const scanlineBytes = width * channelNames.length * sampleBytes
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
    for (let channel = 0; channel < channelNames.length; channel++) {
      for (let x = 0; x < width; x++) {
        const sample = Math.max(0, Math.min(1, sampleAt(channelNames[channel], x, y, channel)))
        if (pixelType === 1) {
          view.setUint16(cursor, float32ToFloat16Bits(sample), true)
          cursor += 2
        } else {
          view.setFloat32(cursor, sample, true)
          cursor += 4
        }
      }
    }
  }
  return out.buffer
}

export function encodeOpenExrImageData(imageData: ImageData, options: OpenExrEncodeOptions = {}): ArrayBuffer {
  return encodeOpenExrRaster(imageData.width, imageData.height, options, (channelName, x, y, channelIndex) => {
    const source = (y * imageData.width + x) * 4
    if (channelName === "Y") {
      return (0.299 * imageData.data[source] + 0.587 * imageData.data[source + 1] + 0.114 * imageData.data[source + 2]) / 255
    }
    return imageData.data[source + (channelName === "A" ? 3 : channelIndex)] / 255
  })
}

export function encodeOpenExrHighBitImage(image: HighBitImage, options: OpenExrEncodeOptions = {}): ArrayBuffer {
  return encodeOpenExrRaster(image.width, image.height, options, (channelName, x, y, channelIndex) => {
    const source = (y * image.width + x) * 4
    if (channelName === "Y") {
      return (
        0.299 * highBitSampleUnit(image, source) +
        0.587 * highBitSampleUnit(image, source + 1) +
        0.114 * highBitSampleUnit(image, source + 2)
      )
    }
    return highBitSampleUnit(image, source + (channelName === "A" ? 3 : channelIndex))
  })
}

function exrStringBytes(value: string): number[] {
  return Array.from(new TextEncoder().encode(value))
}

export function encodeOpenExrArbitraryChannels(options: OpenExrArbitraryEncodeOptions): ArrayBuffer {
  const width = Math.max(1, Math.round(options.width))
  const height = Math.max(1, Math.round(options.height))
  assertCanvasSize(width, height, "OpenEXR arbitrary-channel export")
  const channels = options.channels.length ? options.channels : [{ name: "Y", data: new Float32Array(width * height), pixelType: "float" as const }]
  const header: number[] = []
  const pushU8 = (value: number) => header.push(value & 255)
  const pushU32 = (value: number) => header.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255)
  const pushCString = (value: string) => {
    for (let i = 0; i < value.length; i++) pushU8(value.charCodeAt(i))
    pushU8(0)
  }
  const bytesFor = (write: (push: (value: number) => void) => void) => {
    const out: number[] = []
    write((value) => out.push(value & 255))
    return out
  }
  const u32Bytes = (value: number) => bytesFor((push) => {
    push(value)
    push(value >>> 8)
    push(value >>> 16)
    push(value >>> 24)
  })
  const f32Bytes = (value: number) => {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setFloat32(0, value, true)
    return Array.from(bytes)
  }
  const pushAttr = (name: string, type: string, data: number[]) => {
    pushCString(name)
    pushCString(type)
    pushU32(data.length)
    header.push(...data)
  }
  const channelList: number[] = []
  const channelPush = (value: number) => channelList.push(value & 255)
  const channelCString = (value: string) => {
    for (let i = 0; i < value.length; i++) channelPush(value.charCodeAt(i))
    channelPush(0)
  }
  for (const channel of channels) {
    channelCString(channel.name)
    const type = channel.pixelType === "half" ? 1 : channel.pixelType === "uint" ? 0 : 2
    channelList.push(...u32Bytes(type), 0, 0, 0, 0, ...u32Bytes(1), ...u32Bytes(1))
  }
  channelList.push(0)
  pushU32(0x01312f76)
  pushU32(options.tiled ? 0x00000202 : 2)
  pushAttr("channels", "chlist", channelList)
  pushAttr("compression", "compression", [0])
  pushAttr("dataWindow", "box2i", [...u32Bytes(0), ...u32Bytes(0), ...u32Bytes(width - 1), ...u32Bytes(height - 1)])
  pushAttr("displayWindow", "box2i", [...u32Bytes(0), ...u32Bytes(0), ...u32Bytes(width - 1), ...u32Bytes(height - 1)])
  pushAttr("lineOrder", "lineOrder", [0])
  pushAttr("pixelAspectRatio", "float", f32Bytes(1))
  pushAttr("screenWindowCenter", "v2f", [...f32Bytes(0), ...f32Bytes(0)])
  pushAttr("screenWindowWidth", "float", f32Bytes(1))
  if (options.partName) pushAttr("name", "string", exrStringBytes(options.partName))
  if (options.tiled) {
    pushAttr("type", "string", exrStringBytes("tiledimage"))
    pushAttr("tiles", "tiledesc", [
      ...u32Bytes(Math.max(1, Math.round(options.tiled.tileWidth))),
      ...u32Bytes(Math.max(1, Math.round(options.tiled.tileHeight))),
      options.tiled.levelMode === "mipmap" ? 1 : options.tiled.levelMode === "ripmap" ? 2 : 0,
      0,
    ])
  }
  if (options.deep) {
    pushAttr("deep-sample-counts", "string", exrStringBytes(Array.from(options.deep.sampleCounts).join(",")))
  }
  pushU8(0)

  const sampleBytes = channels.length * width * 4
  const chunkBytes = 8 + sampleBytes
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
    view.setUint32(cursor + 4, sampleBytes, true)
    cursor += 8
    for (const channel of channels) {
      for (let x = 0; x < width; x++) {
        const value = Number(channel.data[y * width + x] ?? 0)
        view.setFloat32(cursor, Number.isFinite(value) ? value : 0, true)
        cursor += 4
      }
    }
  }
  return out.buffer
}

export function encodeOpenExrMultipart(parts: Array<{ name: string; buffer: ArrayBuffer }>): ArrayBuffer {
  const manifest = new TextEncoder().encode(`PSWEB-EXR-MULTIPART\n${JSON.stringify(parts.map((part) => ({ name: part.name, bytes: part.buffer.byteLength })))}\n`)
  return exactArrayBuffer(concatUint8([manifest, ...parts.map((part) => new Uint8Array(part.buffer))]))
}

export function decodedRasterToCanvas(decoded: DecodedRaster): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = decoded.width
  canvas.height = decoded.height
  canvas.getContext("2d")!.putImageData(decoded.imageData, 0, 0)
  return canvas
}
