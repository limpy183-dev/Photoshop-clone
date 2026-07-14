import type {
  PsDocument,
  TypographyEmbeddedFont,
} from "../types"

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function bufferBytes(buffer: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (ArrayBuffer.isView(buffer)) {
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  }
  return new Uint8Array(buffer)
}

function base64FromBytes(bytes: Uint8Array) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64")
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)))
  }
  return btoa(binary)
}

function bytesFromBase64(value: string) {
  try {
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64"))
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return new Uint8Array()
  }
}

function fontFormatFromName(fileName: string, mimeType = ""): TypographyEmbeddedFont["format"] {
  const lower = `${fileName} ${mimeType}`.toLowerCase()
  if (lower.includes("woff2")) return "woff2"
  if (lower.includes("woff")) return "woff"
  if (lower.includes(".otf") || lower.includes("opentype")) return "otf"
  if (lower.includes(".ttf") || lower.includes("truetype") || lower.includes("font/ttf")) return "ttf"
  return "unknown"
}

function fontHash(bytes: Uint8Array) {
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

export function createEmbeddedFontFromBuffer(
  family: string,
  fileName: string,
  buffer: ArrayBuffer | ArrayBufferView,
  mimeType = "font/ttf",
): TypographyEmbeddedFont {
  const bytes = bufferBytes(buffer)
  return {
    family,
    fileName,
    mimeType,
    dataBase64: base64FromBytes(bytes),
    byteLength: bytes.byteLength,
    format: fontFormatFromName(fileName, mimeType),
    hash: fontHash(bytes),
  }
}

export function embeddedFontToArrayBuffer(font: TypographyEmbeddedFont): ArrayBuffer {
  return exactArrayBuffer(bytesFromBase64(font.dataBase64))
}

export function isTypographyEmbeddedFont(value: unknown): value is TypographyEmbeddedFont {
  const font = value as Partial<TypographyEmbeddedFont> | undefined
  return !!font &&
    typeof font.family === "string" &&
    typeof font.fileName === "string" &&
    typeof font.dataBase64 === "string" &&
    typeof font.byteLength === "number"
}

export function findEmbeddedFontForFamily(
  assets: PsDocument["assetLibrary"] | undefined,
  family: string,
): TypographyEmbeddedFont | undefined {
  const lower = family.trim().toLowerCase()
  for (const asset of assets ?? []) {
    if (asset.kind !== "font") continue
    const payload = asset.payload
    if (!isTypographyEmbeddedFont(payload)) continue
    if (payload.family.toLowerCase() === lower || asset.name.toLowerCase() === lower) return payload
  }
  return undefined
}

export function collectEmbeddedTypographyFonts(doc: PsDocument): TypographyEmbeddedFont[] {
  const usedFamilies = new Set(doc.layers.map((layer) => layer.text?.font).filter((font): font is string => !!font).map((font) => font.toLowerCase()))
  const byHash = new Map<string, TypographyEmbeddedFont>()
  for (const layer of doc.layers) {
    if (layer.text?.embeddedFont && usedFamilies.has(layer.text.font.toLowerCase())) {
      byHash.set(layer.text.embeddedFont.hash, layer.text.embeddedFont)
    }
  }
  for (const asset of doc.assetLibrary ?? []) {
    if (asset.kind !== "font" || !isTypographyEmbeddedFont(asset.payload)) continue
    if (!usedFamilies.has(asset.payload.family.toLowerCase()) && !usedFamilies.has(asset.name.toLowerCase())) continue
    byHash.set(asset.payload.hash, asset.payload)
  }
  return [...byHash.values()].sort((a, b) => a.family.localeCompare(b.family) || a.fileName.localeCompare(b.fileName))
}
