import type { ContentCredential } from "./types"
import type { RasterExportEditEntry, RasterExportMetadata } from "./raster-codec-types"
import { asciiBytes, concatUint8, readAscii, u32BE, u64BE } from "./raster-codec-utils"

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

export function buildXmpPacket(metadata: RasterExportMetadata | undefined): string {
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

export function bytesFromInput(input: Uint8Array | ArrayBuffer): Uint8Array {
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

export function mp4Box(type: string, data: Uint8Array): Uint8Array {
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

export const XMP_UUID = new Uint8Array([
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

export const ICC_UUID = new Uint8Array([
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

export function insertJpegXmp(bytes: Uint8Array, metadata: RasterExportMetadata | undefined): Uint8Array {
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

export function insertJpegC2paManifest(bytes: Uint8Array, metadata: RasterExportMetadata | undefined): Uint8Array {
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

