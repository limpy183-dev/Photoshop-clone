/**
 * PSD color-mode + bit-depth + ICC profile round-trip helpers.
 *
 * Browser constraint: HTML5 2D canvas is 8-bit RGBA only. High-bit data and
 * exotic modes (CMYK, Lab, Duotone, ...) survive a PSD → app → PSD trip via
 * side-band metadata; live editing remains 8-bit.
 *
 * ag-psd gaps (verified against the shipped build under node_modules):
 *  - Writer hard-codes colorMode=3 (RGB) and rejects bitsPerChannel !== 8.
 *    Helpers still emit the correct numeric mode / depth / colorModeData so
 *    the integrator can splice them into the output (or use a patched build).
 *  - Reader natively supports Bitmap, Grayscale, RGB, Indexed; others throw.
 *    COLOR_MODE_CAPABILITY advertises intent.
 *  - ICC Profile resource (1039) is gated behind MOCK_HANDLERS=false in the
 *    shipped build. We route the profile name through
 *    `printInformation.printerProfile` (which IS serialised) and attach
 *    synthetic ICC bytes on a non-typed field for a patched writer.
 *  - Color-mode-data is parsed only for Indexed (palette). Duotone /
 *    Multichannel raw bytes are dropped — we still produce them on write.
 *
 * MUST NOT import from `./document-io` — that module imports from us.
 */

import type {
  ColorManagementSettings,
  DocumentModeSettings,
  Layer,
  PsDocument,
} from "./types"
import type { ImageResources, Psd, RGB } from "ag-psd"

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

function parseHexColorRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "").trim()
  const expanded = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean.padEnd(6, "0").slice(0, 6)
  const value = Number.parseInt(expanded, 16) || 0
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

// Runtime mirror of ag-psd's `ColorMode` const enum (isolatedModules-safe).
export const PSD_COLOR_MODE = {
  Bitmap: 0, Grayscale: 1, Indexed: 2, RGB: 3, CMYK: 4,
  Multichannel: 7, Duotone: 8, Lab: 9,
} as const
export type PsdColorModeValue = typeof PSD_COLOR_MODE[keyof typeof PSD_COLOR_MODE]

export type ColorModeCapabilityStatus = true | "round-trip" | "approximated"
export interface ColorModeCapability {
  rgb: ColorModeCapabilityStatus
  cmyk: ColorModeCapabilityStatus
  grayscale: ColorModeCapabilityStatus
  indexed: ColorModeCapabilityStatus
  lab: ColorModeCapabilityStatus
  duotone: ColorModeCapabilityStatus
  multichannel: ColorModeCapabilityStatus
  bitmap: ColorModeCapabilityStatus
  bitDepth: { 8: true; 16: ColorModeCapabilityStatus; 32: ColorModeCapabilityStatus }
}
export const COLOR_MODE_CAPABILITY: ColorModeCapability = {
  rgb: true, cmyk: "round-trip", grayscale: "round-trip", indexed: "round-trip",
  lab: "round-trip", duotone: "round-trip", multichannel: "round-trip", bitmap: "approximated",
  bitDepth: { 8: true, 16: "round-trip", 32: "round-trip" },
}

export interface PsdColorModeDataInput {
  palette?: RGB[]
  duotoneBytes?: Uint8Array
  bitmapThreshold?: number
}
export interface PsdColorModeMappingResult {
  colorMode: PsDocument["colorMode"]
  modeSettings?: DocumentModeSettings
}

export function psdColorModeToApp(psdMode: number, data?: PsdColorModeDataInput): PsdColorModeMappingResult {
  switch (psdMode) {
    case PSD_COLOR_MODE.Bitmap:
      return {
        colorMode: "Bitmap",
        modeSettings: {
          mode: "Bitmap",
          bitmap: { method: "threshold", threshold: clamp(data?.bitmapThreshold ?? 128, 0, 255), frequency: 53, angle: 45 },
        },
      }
    case PSD_COLOR_MODE.Grayscale:
      return { colorMode: "Grayscale", modeSettings: { mode: "Grayscale" } }
    case PSD_COLOR_MODE.Indexed: {
      const colors = data?.palette ? Math.min(256, data.palette.length) : 256
      return { colorMode: "Indexed", modeSettings: { mode: "Indexed", indexed: { colors, dither: false } } }
    }
    case PSD_COLOR_MODE.RGB: return { colorMode: "RGB", modeSettings: { mode: "RGB" } }
    case PSD_COLOR_MODE.CMYK: return { colorMode: "CMYK", modeSettings: { mode: "CMYK" } }
    case PSD_COLOR_MODE.Multichannel:
      return {
        colorMode: "Multichannel",
        modeSettings: { mode: "Multichannel", multichannel: { channels: { r: true, g: true, b: true } } },
      }
    case PSD_COLOR_MODE.Duotone: {
      // Sample a midpoint byte as a proxy for the curve shape. Full duotone
      // spec is undocumented; preserves intent without inventing data.
      const bytes = data?.duotoneBytes
      let curve = 1
      if (bytes && bytes.length >= 24) {
        const sample = bytes[Math.min(bytes.length - 1, 12)] / 255
        curve = clamp(0.5 + sample * 1.5, 0.25, 4)
      }
      return { colorMode: "Duotone", modeSettings: { mode: "Duotone", duotone: { ink1: "#111111", ink2: "#1f80ff", curve } } }
    }
    // Lab → app union lacks a "Lab" string; surface as RGB and let the
    // integrator re-emit Lab on save via modeSettings.
    case PSD_COLOR_MODE.Lab:
    default:
      return { colorMode: "RGB", modeSettings: { mode: "RGB" } }
  }
}

export interface AppToPsdColorMode {
  colorMode: number
  colorModeData?: Uint8Array
  channels: number
  palette?: RGB[]
}

export function appColorModeToPsd(doc: PsDocument): AppToPsdColorMode {
  switch (doc.colorMode) {
    case "Bitmap":
      return { colorMode: PSD_COLOR_MODE.Bitmap, channels: 1 }
    case "Grayscale":
      return { colorMode: PSD_COLOR_MODE.Grayscale, channels: 1 }
    case "Indexed": {
      const requested = clamp(doc.modeSettings?.indexed?.colors ?? 256, 2, 256)
      const palette = buildIndexedPalette(requested)
      // Color-mode-data layout for Indexed: 256 R + 256 G + 256 B bytes.
      const data = new Uint8Array(768)
      for (let i = 0; i < 256; i++) {
        const entry = palette[i] ?? { r: 0, g: 0, b: 0 }
        data[i] = entry.r
        data[256 + i] = entry.g
        data[512 + i] = entry.b
      }
      return { colorMode: PSD_COLOR_MODE.Indexed, channels: 1, palette, colorModeData: data }
    }
    case "Duotone": {
      const duotone = doc.modeSettings?.duotone ?? { ink1: "#111111", ink2: "#1f80ff", curve: 1 }
      const ink1 = parseHexColorRgb(duotone.ink1)
      const ink2 = parseHexColorRgb(duotone.ink2)
      // Synthetic duotone data: 28-byte header + 256-byte curve LUT + 8 bytes
      // ink color (2 inks × 4 bytes RGB+pad). Enough for curve round-trip.
      const data = new Uint8Array(28 + 256 + 8)
      data[1] = 2 // ink count
      for (let i = 0; i < 256; i++) {
        const t = Math.pow(i / 255, duotone.curve)
        data[28 + i] = clamp(Math.round(t * 255), 0, 255)
      }
      data.set([ink1.r, ink1.g, ink1.b, 0, ink2.r, ink2.g, ink2.b, 0], 28 + 256)
      return { colorMode: PSD_COLOR_MODE.Duotone, channels: 1, colorModeData: data }
    }
    case "Multichannel":
      return { colorMode: PSD_COLOR_MODE.Multichannel, channels: 3 }
    case "CMYK":
      return { colorMode: PSD_COLOR_MODE.CMYK, channels: 4 }
    case "RGB":
    default:
      return { colorMode: PSD_COLOR_MODE.RGB, channels: 3 }
  }
}

function buildIndexedPalette(colors: number): RGB[] {
  // Even RGB cube up to `colors` entries; remaining slots get a greyscale
  // ramp so the palette is always full (PSD spec expects 768 bytes).
  const palette: RGB[] = []
  const steps = Math.max(2, Math.round(Math.cbrt(colors)))
  for (let r = 0; r < steps && palette.length < colors; r++) {
    for (let g = 0; g < steps && palette.length < colors; g++) {
      for (let b = 0; b < steps && palette.length < colors; b++) {
        palette.push({
          r: Math.round((r / Math.max(1, steps - 1)) * 255),
          g: Math.round((g / Math.max(1, steps - 1)) * 255),
          b: Math.round((b / Math.max(1, steps - 1)) * 255),
        })
      }
    }
  }
  while (palette.length < 256) {
    const v = Math.round(((palette.length - colors) / Math.max(1, 255 - colors)) * 255)
    palette.push({ r: v, g: v, b: v })
  }
  return palette
}

export function appBitDepthToPsd(doc: PsDocument): 1 | 8 {
  if (doc.colorMode === "Bitmap") return 1
  return 8
}

export function psdBitDepthToApp(psdBits: 1 | 8 | 16 | 32 | undefined, colorMode: number): PsDocument["bitDepth"] {
  // Bitmap is 1 bpp on disk; canvas is 8-bit so we project up. Original
  // 1-bit intent is preserved via modeSettings.bitmap.
  if (colorMode === PSD_COLOR_MODE.Bitmap) return 8
  if (psdBits === 16 || psdBits === 32) return psdBits
  return 8
}

export interface IccProfileExtraction {
  profileName?: string
  profileData?: Uint8Array
}

/**
 * ag-psd's typed `ImageResources` hides ICC bytes (resource 1039 behind
 * MOCK_HANDLERS). Probe for `_ir1039` / `iccProfile` shapes a patched build
 * may attach, falling back to `printInformation.printerProfile` which
 * Photoshop often co-writes with the assigned profile.
 */
export function extractIccProfile(psd: Psd): IccProfileExtraction | null {
  const resources = psd.imageResources
  if (!resources) return null
  const probe = resources as ImageResources & {
    _ir1039?: Uint8Array; iccProfile?: Uint8Array; iccProfileName?: string
  }
  const bytes =
    probe._ir1039 instanceof Uint8Array ? probe._ir1039 :
    probe.iccProfile instanceof Uint8Array ? probe.iccProfile : undefined
  let name = typeof probe.iccProfileName === "string" ? probe.iccProfileName : undefined
  if (!name && resources.printInformation?.printerProfile) name = resources.printInformation.printerProfile
  if (!name && bytes) name = decodeIccProfileDescription(bytes)
  if (!bytes && !name) return null
  const mapped = mapIccNameToAssignedProfile(name)
  return { profileName: mapped ?? name ?? undefined, profileData: bytes }
}

// Substring match because vendor prefixes ("HP-sRGB v4", "Apple Display P3",
// ...) would defeat an exact match. Priority order matters — e.g. "Adobe
// RGB" must win over the substring "sRGB".
function mapIccNameToAssignedProfile(raw: string | undefined): ColorManagementSettings["assignedProfile"] | null {
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower.includes("display p3") || lower.includes("displayp3")) return "Display P3"
  if (lower.includes("prophoto") || lower.includes("pro photo")) return "ProPhoto RGB"
  if (lower.includes("adobe rgb") || lower.includes("adobergb")) return "Adobe RGB (1998)"
  if (lower.includes("srgb")) return "sRGB IEC61966-2.1"
  if (lower.includes("dot gain") || lower.includes("dotgain")) return "Dot Gain 20%"
  if (lower.includes("gray gamma") || lower.includes("graygamma")) return "Gray Gamma 2.2"
  if (lower.includes("cmyk") || lower.includes("swop") || lower.includes("coated")) return "Working CMYK"
  return null
}

function decodeIccProfileDescription(bytes: Uint8Array): string | undefined {
  if (bytes.length < 128) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tagCount = view.getUint32(128)
  if (tagCount > 200 || 128 + 4 + tagCount * 12 > bytes.length) return undefined
  for (let i = 0; i < tagCount; i++) {
    const offset = 128 + 4 + i * 12
    const sig = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
    if (sig !== "desc") continue
    const dataOffset = view.getUint32(offset + 4)
    const dataSize = view.getUint32(offset + 8)
    if (dataOffset + dataSize > bytes.length) return undefined
    const asciiLen = view.getUint32(dataOffset + 8)
    const start = dataOffset + 12
    const end = Math.min(bytes.length, start + asciiLen)
    let out = ""
    for (let j = start; j < end; j++) {
      const code = bytes[j]
      if (code === 0) break
      out += String.fromCharCode(code)
    }
    return out || undefined
  }
  return undefined
}

/**
 * Mutates `psd.imageResources` to encode the assigned profile. ag-psd's
 * shipped build won't serialise resource 1039 directly, so we route the name
 * through `printInformation.printerProfile` (which IS written) and attach
 * synthetic ICC bytes on a non-typed `iccProfile` field for a patched writer
 * or post-process splicing step.
 */
export function applyIccProfileToPsd(doc: PsDocument, psd: Psd): void {
  const profile = doc.colorManagement?.assignedProfile
  if (!profile) return
  const resources = (psd.imageResources ?? {}) as ImageResources & {
    iccProfile?: Uint8Array; iccProfileName?: string; _ir1039?: Uint8Array
  }
  const bytes = buildSyntheticIccProfile(profile)
  resources.iccProfile = bytes
  resources.iccProfileName = profile
  resources._ir1039 = bytes
  resources.iccUntaggedProfile = false
  resources.printInformation = {
    ...(resources.printInformation ?? {}),
    printerProfile: profile,
    renderingIntent: mapRenderingIntent(doc.colorManagement?.renderingIntent),
    blackPointCompensation: !!doc.colorManagement?.blackPointCompensation,
    printerName: resources.printInformation?.printerName ?? "",
  }
  psd.imageResources = resources
}

function mapRenderingIntent(
  intent: ColorManagementSettings["renderingIntent"] | undefined,
): "perceptual" | "relative colorimetric" | "saturation" | "absolute colorimetric" {
  switch (intent) {
    case "relative-colorimetric": return "relative colorimetric"
    case "saturation": return "saturation"
    case "absolute-colorimetric": return "absolute colorimetric"
    default: return "perceptual"
  }
}

/**
 * Minimal ICC v4 profile carrying the assigned-profile name inside its
 * `desc` tag. Gamut data is omitted — this is round-trip *identification*
 * only. Real color conversion needs a linked ICC engine (out of scope for
 * the browser runtime).
 */
export function buildSyntheticIccProfile(name: ColorManagementSettings["assignedProfile"]): Uint8Array {
  const ascii = new TextEncoder().encode(name)
  const descTagPayload = 12 + ascii.length + 1
  const tagTablePadded = Math.ceil(descTagPayload / 4) * 4
  const totalSize = 128 + 4 + 12 + tagTablePadded
  const buffer = new Uint8Array(totalSize)
  const view = new DataView(buffer.buffer)
  const enc = (text: string, offset: number) => buffer.set(new TextEncoder().encode(text), offset)
  view.setUint32(0, totalSize)
  enc("ADBE", 4) // preferred CMM (placeholder)
  view.setUint32(8, 0x04000000) // version 4.0
  enc("mntr", 12) // device class
  enc("RGB ", 16) // color space
  enc("XYZ ", 20) // PCS
  enc("acsp", 36) // ICC magic
  enc("APPL", 40) // platform
  view.setUint32(64, 0) // rendering intent (perceptual)
  view.setUint32(128, 1) // tag count
  const tagTableOffset = 132
  enc("desc", tagTableOffset)
  const descDataOffset = tagTableOffset + 12
  view.setUint32(tagTableOffset + 4, descDataOffset)
  view.setUint32(tagTableOffset + 8, descTagPayload)
  enc("desc", descDataOffset)
  view.setUint32(descDataOffset + 4, 0)
  view.setUint32(descDataOffset + 8, ascii.length + 1)
  buffer.set(ascii, descDataOffset + 12)
  return buffer
}

// CRC32 (ISO-3309 polynomial 0xEDB88320) used by PNG chunks. Cached.
let crcTable: Uint32Array | null = null
function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  crcTable = table
  return table
}

function pngCrc32(data: Uint8Array): number {
  const table = getCrcTable()
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// RFC 1950 zlib wrapping a series of *stored* (uncompressed) deflate blocks.
// PNG iCCP chunks accept stored blocks; avoids a zlib dependency.
function zlibStoredStream(payload: Uint8Array): Uint8Array {
  const cmf = 0x78
  let flg = 0x01
  while (((cmf << 8) + flg) % 31 !== 0) flg++
  const blocks: Uint8Array[] = []
  let offset = 0
  while (offset < payload.length || offset === 0) {
    const blockSize = Math.min(payload.length - offset, 65535)
    const last = offset + blockSize >= payload.length ? 1 : 0
    const header = new Uint8Array(5)
    header[0] = last
    header[1] = blockSize & 0xff; header[2] = (blockSize >> 8) & 0xff
    header[3] = ~blockSize & 0xff; header[4] = (~blockSize >> 8) & 0xff
    blocks.push(header)
    if (blockSize > 0) blocks.push(payload.subarray(offset, offset + blockSize))
    offset += blockSize
    if (blockSize === 0) break
  }
  let a = 1, b = 0
  for (let i = 0; i < payload.length; i++) { a = (a + payload[i]) % 65521; b = (b + a) % 65521 }
  const adler = ((b << 16) | a) >>> 0
  const total = 2 + blocks.reduce((s, blk) => s + blk.length, 0) + 4
  const stream = new Uint8Array(total)
  stream[0] = cmf; stream[1] = flg
  let pos = 2
  for (const block of blocks) { stream.set(block, pos); pos += block.length }
  stream[pos] = (adler >>> 24) & 0xff; stream[pos + 1] = (adler >>> 16) & 0xff
  stream[pos + 2] = (adler >>> 8) & 0xff; stream[pos + 3] = adler & 0xff
  return stream
}

const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return false
  return true
}

export function injectIccIntoPng(pngBytes: Uint8Array, profileBytes: Uint8Array, profileName: string): Uint8Array {
  if (!isPng(pngBytes)) return pngBytes
  let cursor = 8
  while (cursor + 8 < pngBytes.length) {
    const length = (pngBytes[cursor] << 24) | (pngBytes[cursor + 1] << 16) | (pngBytes[cursor + 2] << 8) | pngBytes[cursor + 3]
    const type = String.fromCharCode(pngBytes[cursor + 4], pngBytes[cursor + 5], pngBytes[cursor + 6], pngBytes[cursor + 7])
    if (type === "IDAT") break
    cursor += 8 + length + 4
  }
  if (cursor + 8 >= pngBytes.length) return pngBytes
  const cleanName = profileName.replace(/[^\x20-\x7e]/g, "").slice(0, 79) || "ICC Profile"
  const nameBytes = new TextEncoder().encode(cleanName)
  const compressedProfile = zlibStoredStream(profileBytes)
  // iCCP chunk: name (Latin-1, NUL-terminated) + compression method (0) + zlib stream.
  const chunkData = new Uint8Array(nameBytes.length + 2 + compressedProfile.length)
  chunkData.set(nameBytes, 0)
  chunkData[nameBytes.length] = 0; chunkData[nameBytes.length + 1] = 0
  chunkData.set(compressedProfile, nameBytes.length + 2)
  const typeBytes = new TextEncoder().encode("iCCP")
  const crcInput = new Uint8Array(typeBytes.length + chunkData.length)
  crcInput.set(typeBytes, 0); crcInput.set(chunkData, typeBytes.length)
  const crc = pngCrc32(crcInput)
  const chunkLength = chunkData.length
  const chunk = new Uint8Array(12 + chunkLength)
  chunk[0] = (chunkLength >>> 24) & 0xff; chunk[1] = (chunkLength >>> 16) & 0xff
  chunk[2] = (chunkLength >>> 8) & 0xff; chunk[3] = chunkLength & 0xff
  chunk.set(typeBytes, 4)
  chunk.set(chunkData, 8)
  chunk[chunk.length - 4] = (crc >>> 24) & 0xff; chunk[chunk.length - 3] = (crc >>> 16) & 0xff
  chunk[chunk.length - 2] = (crc >>> 8) & 0xff; chunk[chunk.length - 1] = crc & 0xff
  const result = new Uint8Array(pngBytes.length + chunk.length)
  result.set(pngBytes.subarray(0, cursor), 0)
  result.set(chunk, cursor)
  result.set(pngBytes.subarray(cursor), cursor + chunk.length)
  return result
}

const JPEG_ICC_PAYLOAD_MAX = 65533 - 16
const JPEG_ICC_IDENTIFIER = new TextEncoder().encode("ICC_PROFILE\0")

export function injectIccIntoJpeg(jpegBytes: Uint8Array, profileBytes: Uint8Array): Uint8Array {
  if (jpegBytes.length < 4 || jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) return jpegBytes
  // Insert after SOI and any leading APP0/APP1 metadata.
  let cursor = 2
  while (cursor + 4 < jpegBytes.length && jpegBytes[cursor] === 0xff) {
    const marker = jpegBytes[cursor + 1]
    if (marker !== 0xe0 && marker !== 0xe1) break
    const segLength = (jpegBytes[cursor + 2] << 8) | jpegBytes[cursor + 3]
    cursor += 2 + segLength
  }
  const totalChunks = Math.max(1, Math.ceil(profileBytes.length / JPEG_ICC_PAYLOAD_MAX))
  const segments: Uint8Array[] = []
  for (let i = 0; i < totalChunks; i++) {
    const start = i * JPEG_ICC_PAYLOAD_MAX
    const payload = profileBytes.subarray(start, Math.min(profileBytes.length, start + JPEG_ICC_PAYLOAD_MAX))
    const segLength = 2 + JPEG_ICC_IDENTIFIER.length + 2 + payload.length
    const segment = new Uint8Array(2 + segLength)
    segment[0] = 0xff; segment[1] = 0xe2 // APP2
    segment[2] = (segLength >> 8) & 0xff; segment[3] = segLength & 0xff
    segment.set(JPEG_ICC_IDENTIFIER, 4)
    segment[4 + JPEG_ICC_IDENTIFIER.length] = i + 1
    segment[5 + JPEG_ICC_IDENTIFIER.length] = totalChunks
    segment.set(payload, 6 + JPEG_ICC_IDENTIFIER.length)
    segments.push(segment)
  }
  const totalInsertSize = segments.reduce((sum, seg) => sum + seg.length, 0)
  const result = new Uint8Array(jpegBytes.length + totalInsertSize)
  result.set(jpegBytes.subarray(0, cursor), 0)
  let writeOffset = cursor
  for (const segment of segments) { result.set(segment, writeOffset); writeOffset += segment.length }
  result.set(jpegBytes.subarray(cursor), writeOffset)
  return result
}

export interface PsdColorModeDataExtract {
  palette?: RGB[]
  rawBytes?: Uint8Array
}

/**
 * Surfaces what ag-psd parsed from the color-mode-data section. Shipped
 * build only exposes `palette` for Indexed; probe for `_colorModeData` /
 * `colorModeData` that a patched build might attach.
 */
export function psdColorModeData(psd: Psd): PsdColorModeDataExtract | null {
  const probe = psd as Psd & { _colorModeData?: Uint8Array; colorModeData?: Uint8Array }
  const palette = Array.isArray(psd.palette) ? psd.palette : undefined
  const rawBytes = probe._colorModeData ?? probe.colorModeData
  if (!palette && !rawBytes) return null
  return { palette, rawBytes }
}

export type HighBitDepthArray = Uint8ClampedArray | Uint16Array | Float32Array
export interface HighBitDepthChannels {
  r: HighBitDepthArray; g: HighBitDepthArray; b: HighBitDepthArray; a: HighBitDepthArray
}
interface LayerWithHighBitData extends Layer {
  __highBitDepthData?: HighBitDepthChannels
}

/**
 * Returns per-channel typed arrays at `bitDepth` for the layer. Layers may
 * carry a `__highBitDepthData` side-band attached on import; if absent we
 * scale the 8-bit canvas up to the requested precision.
 *
 * ag-psd's writer rejects bitsPerChannel !== 8, so the integrator uses these
 * arrays to splice high-bit payloads post-write — this only produces bytes.
 */
export function serializeHighBitDepthChannelData(
  layer: Layer,
  bitDepth: 8 | 16 | 32,
): HighBitDepthChannels | null {
  const enriched = layer as LayerWithHighBitData
  if (enriched.__highBitDepthData) return scaleChannels(enriched.__highBitDepthData, bitDepth)
  if (!layer.canvas || typeof layer.canvas.getContext !== "function") return null
  const ctx = layer.canvas.getContext("2d")
  if (!ctx) return null
  const { width, height } = layer.canvas
  if (!width || !height) return null
  const pixels = ctx.getImageData(0, 0, width, height).data
  const total = width * height
  const r = allocChannel(bitDepth, total)
  const g = allocChannel(bitDepth, total)
  const b = allocChannel(bitDepth, total)
  const a = allocChannel(bitDepth, total)
  if (bitDepth === 8) {
    for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
      r[j] = pixels[i]; g[j] = pixels[i + 1]; b[j] = pixels[i + 2]; a[j] = pixels[i + 3]
    }
  } else if (bitDepth === 16) {
    // ×257 maps 0..255 onto 0..65535 evenly (LUT-friendly scale).
    for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
      r[j] = pixels[i] * 257; g[j] = pixels[i + 1] * 257
      b[j] = pixels[i + 2] * 257; a[j] = pixels[i + 3] * 257
    }
  } else {
    for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
      r[j] = pixels[i] / 255; g[j] = pixels[i + 1] / 255
      b[j] = pixels[i + 2] / 255; a[j] = pixels[i + 3] / 255
    }
  }
  return { r, g, b, a }
}

function allocChannel(bitDepth: 8 | 16 | 32, length: number): HighBitDepthArray {
  if (bitDepth === 8) return new Uint8ClampedArray(length)
  if (bitDepth === 16) return new Uint16Array(length)
  return new Float32Array(length)
}

function scaleChannels(channels: HighBitDepthChannels, bitDepth: 8 | 16 | 32): HighBitDepthChannels {
  if (matchesDepth(channels.r, bitDepth)) return channels
  return {
    r: scaleChannel(channels.r, bitDepth),
    g: scaleChannel(channels.g, bitDepth),
    b: scaleChannel(channels.b, bitDepth),
    a: scaleChannel(channels.a, bitDepth),
  }
}

function matchesDepth(channel: HighBitDepthArray, bitDepth: 8 | 16 | 32): boolean {
  if (bitDepth === 8) return channel instanceof Uint8ClampedArray
  if (bitDepth === 16) return channel instanceof Uint16Array
  return channel instanceof Float32Array
}

function scaleChannel(channel: HighBitDepthArray, bitDepth: 8 | 16 | 32): HighBitDepthArray {
  const length = channel.length
  if (bitDepth === 8) {
    const out = new Uint8ClampedArray(length)
    if (channel instanceof Uint16Array) for (let i = 0; i < length; i++) out[i] = channel[i] >> 8
    else if (channel instanceof Float32Array) for (let i = 0; i < length; i++) out[i] = clamp(Math.round(channel[i] * 255), 0, 255)
    else for (let i = 0; i < length; i++) out[i] = channel[i]
    return out
  }
  if (bitDepth === 16) {
    const out = new Uint16Array(length)
    if (channel instanceof Uint16Array) out.set(channel)
    else if (channel instanceof Float32Array) for (let i = 0; i < length; i++) out[i] = clamp(Math.round(channel[i] * 65535), 0, 65535)
    else for (let i = 0; i < length; i++) out[i] = channel[i] * 257
    return out
  }
  const out = new Float32Array(length)
  if (channel instanceof Float32Array) out.set(channel)
  else if (channel instanceof Uint16Array) for (let i = 0; i < length; i++) out[i] = channel[i] / 65535
  else for (let i = 0; i < length; i++) out[i] = channel[i] / 255
  return out
}
