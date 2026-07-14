import type { DocumentMetadata } from "./types"
import {
  ADVANCED_FILE_LIMITS,
  assertAdvancedFileSize,
  readAscii,
} from "./advanced-subsystems-shared"

function parseExifTags(buffer: ArrayBuffer, offset: number): Partial<DocumentMetadata> {
  const view = new DataView(buffer, offset)
  const little = readAscii(buffer, offset, 2) === "II"
  const get16 = (pos: number) => view.getUint16(pos, little)
  const get32 = (pos: number) => view.getUint32(pos, little)
  const ifd = get32(4)
  const count = get16(ifd)
  const out: Partial<DocumentMetadata> = {}
  const readValue = (type: number, count: number, valueOffset: number) => {
    if (type === 2) {
      const absolute = count <= 4 ? offset + valueOffset : offset + valueOffset
      return new TextDecoder().decode(buffer.slice(absolute, absolute + count)).replace(/\0/g, "").trim()
    }
    return ""
  }
  for (let i = 0; i < count; i++) {
    const pos = ifd + 2 + i * 12
    const tag = get16(pos)
    const type = get16(pos + 2)
    const len = get32(pos + 4)
    const val = get32(pos + 8)
    const text = readValue(type, len, val)
    if (!text) continue
    if (tag === 0x010e) out.description = text
    if (tag === 0x013b) out.author = text
    if (tag === 0x8298) out.copyright = text
    if (tag === 0x0131) out.source = text
    if (tag === 0x0132) out.modifiedAt = text
  }
  return out
}

export async function extractMetadataFromFile(file: File) {
  assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.rasterBytes, "Metadata file")
  const buffer = await file.arrayBuffer()
  const view = new DataView(buffer)
  const metadata: Partial<DocumentMetadata> = { title: file.name, source: file.type || file.name.split(".").pop()?.toUpperCase() }
  const technical: string[] = [`${file.name} (${Math.round(file.size / 1024)} KB)`]
  if (buffer.byteLength < 2) return { metadata, technical: [...technical, "File is too small for format metadata parsing"] }
  if (view.getUint16(0) === 0xffd8) {
    let offset = 2
    while (offset + 4 < buffer.byteLength) {
      if (view.getUint8(offset) !== 0xff) break
      const marker = view.getUint8(offset + 1)
      const length = view.getUint16(offset + 2)
      if (marker === 0xe1) {
        const header = readAscii(buffer, offset + 4, 6)
        if (header.startsWith("Exif")) Object.assign(metadata, parseExifTags(buffer, offset + 10))
        const text = new TextDecoder().decode(buffer.slice(offset + 4, offset + 2 + length))
        const title = text.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>(.*?)<\/rdf:li>/i)?.[1]
        if (title) metadata.title = title
      }
      if (marker === 0xed) {
        const text = new TextDecoder("latin1").decode(buffer.slice(offset + 4, offset + 2 + length))
        const match = text.match(/\x1c\x02x([^\x1c]+)/)
        if (match) metadata.description = match[1].trim()
      }
      offset += 2 + length
    }
    technical.push("JPEG EXIF/XMP/IPTC segments scanned")
  }
  return { metadata, technical }
}

export async function extractEmbeddedJpegDataUrl(file: File) {
  assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.rasterBytes, "RAW/DNG file")
  const bytes = new Uint8Array(await file.arrayBuffer())
  let start = -1
  let end = -1
  for (let i = 0; i < bytes.length - 1; i++) {
    if (start < 0 && bytes[i] === 0xff && bytes[i + 1] === 0xd8) start = i
    if (start >= 0 && bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
      end = i + 2
      break
    }
  }
  if (start < 0 || end < 0) return null
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(new Blob([bytes.slice(start, end)], { type: "image/jpeg" }))
  })
}

export function makeXmpMetadata(metadata: DocumentMetadata) {
  const keywords = (metadata.keywords ?? []).map((keyword) => `<rdf:li>${escapeXml(keyword)}</rdf:li>`).join("")
  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(metadata.title ?? "")}</rdf:li></rdf:Alt></dc:title>
<dc:creator><rdf:Seq><rdf:li>${escapeXml(metadata.author ?? "")}</rdf:li></rdf:Seq></dc:creator>
<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(metadata.description ?? "")}</rdf:li></rdf:Alt></dc:description>
<dc:subject><rdf:Bag>${keywords}</rdf:Bag></dc:subject>
<xmpRights:Marked>${metadata.copyright ? "True" : "False"}</xmpRights:Marked>
<xmpRights:UsageTerms><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(metadata.copyright ?? "")}</rdf:li></rdf:Alt></xmpRights:UsageTerms>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`
}

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch] ?? ch)
}
