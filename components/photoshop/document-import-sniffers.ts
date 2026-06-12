export interface ImageHeaderDimensions {
  width: number
  height: number
  format: string
}

export type PsdHeaderDimensions = ImageHeaderDimensions & { version: 1 | 2 }

const PSD_HEADER_BYTES = 26

function hasAscii(bytes: Uint8Array, offset: number, text: string) {
  if (offset + text.length > bytes.length) return false
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false
  }
  return true
}

function readUint16BE(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, false)
}

function readUint16LE(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true)
}

function readUint24LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16)
}

function readUint32BE(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false)
}

function readUint32LE(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)
}

function readInt32LE(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset, true)
}

export function readPsdHeaderDimensions(buffer: ArrayBuffer): PsdHeaderDimensions | null {
  if (buffer.byteLength < PSD_HEADER_BYTES) return null
  const bytes = new Uint8Array(buffer, 0, PSD_HEADER_BYTES)
  if (!hasAscii(bytes, 0, "8BPS")) return null
  const version = readUint16BE(bytes, 4)
  if (version !== 1 && version !== 2) return null
  const height = readUint32BE(bytes, 14)
  const width = readUint32BE(bytes, 18)
  return { width, height, format: version === 2 ? "PSB" : "PSD", version }
}

function sniffPngDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    !hasAscii(bytes, 1, "PNG\r\n\u001a\n") ||
    !hasAscii(bytes, 12, "IHDR")
  ) {
    return null
  }
  return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20), format: "PNG" }
}

function sniffGifDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  if (bytes.length < 10 || (!hasAscii(bytes, 0, "GIF87a") && !hasAscii(bytes, 0, "GIF89a"))) return null
  return { width: readUint16LE(bytes, 6), height: readUint16LE(bytes, 8), format: "GIF" }
}

function isJpegStartOfFrame(marker: number) {
  return (
    marker === 0xc0 ||
    marker === 0xc1 ||
    marker === 0xc2 ||
    marker === 0xc3 ||
    marker === 0xc5 ||
    marker === 0xc6 ||
    marker === 0xc7 ||
    marker === 0xc9 ||
    marker === 0xca ||
    marker === 0xcb ||
    marker === 0xcd ||
    marker === 0xce ||
    marker === 0xcf
  )
}

function sniffJpegDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++
      continue
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue
    if (offset + 2 > bytes.length) return null
    const length = readUint16BE(bytes, offset)
    if (length < 2 || offset + length > bytes.length) return null
    if (isJpegStartOfFrame(marker) && length >= 7) {
      return { width: readUint16BE(bytes, offset + 5), height: readUint16BE(bytes, offset + 3), format: "JPEG" }
    }
    if (marker === 0xda) return null
    offset += length
  }
  return null
}

function sniffWebpDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  if (bytes.length < 30 || !hasAscii(bytes, 0, "RIFF") || !hasAscii(bytes, 8, "WEBP")) return null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const chunkTypeOffset = offset
    const chunkSize = readUint32LE(bytes, offset + 4)
    const payload = offset + 8
    if (payload + chunkSize > bytes.length) return null
    if (hasAscii(bytes, chunkTypeOffset, "VP8X") && chunkSize >= 10) {
      return {
        width: readUint24LE(bytes, payload + 4) + 1,
        height: readUint24LE(bytes, payload + 7) + 1,
        format: "WEBP",
      }
    }
    if (hasAscii(bytes, chunkTypeOffset, "VP8 ") && chunkSize >= 10 && hasAscii(bytes, payload + 3, "\u009d\u0001*")) {
      return {
        width: readUint16LE(bytes, payload + 6) & 0x3fff,
        height: readUint16LE(bytes, payload + 8) & 0x3fff,
        format: "WEBP",
      }
    }
    if (hasAscii(bytes, chunkTypeOffset, "VP8L") && chunkSize >= 5 && bytes[payload] === 0x2f) {
      const bits =
        bytes[payload + 1] |
        (bytes[payload + 2] << 8) |
        (bytes[payload + 3] << 16) |
        (bytes[payload + 4] << 24)
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
        format: "WEBP",
      }
    }
    offset = payload + chunkSize + (chunkSize % 2)
  }
  return null
}

function sniffBmpDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  if (bytes.length < 26 || !hasAscii(bytes, 0, "BM")) return null
  const dibSize = readUint32LE(bytes, 14)
  if (dibSize === 12) {
    return { width: readUint16LE(bytes, 18), height: readUint16LE(bytes, 20), format: "BMP" }
  }
  if (dibSize >= 40 && bytes.length >= 26) {
    return {
      width: Math.abs(readInt32LE(bytes, 18)),
      height: Math.abs(readInt32LE(bytes, 22)),
      format: "BMP",
    }
  }
  return null
}

function isIsoBaseMediaFile(bytes: Uint8Array) {
  if (bytes.length < 16 || !hasAscii(bytes, 4, "ftyp")) return false
  const majorBrand = String.fromCharCode(...bytes.slice(8, 12))
  if (/^(avif|avis|heic|heix|hevc|hevx|mif1|msf1)$/.test(majorBrand)) return true
  const brandsEnd = Math.min(bytes.length, readUint32BE(bytes, 0))
  for (let offset = 16; offset + 4 <= brandsEnd; offset += 4) {
    const brand = String.fromCharCode(...bytes.slice(offset, offset + 4))
    if (/^(avif|avis|heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) return true
  }
  return false
}

function sniffIsoImageDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  if (!isIsoBaseMediaFile(bytes)) return null
  for (let offset = 4; offset + 16 <= bytes.length; offset++) {
    if (!hasAscii(bytes, offset, "ispe")) continue
    const boxStart = offset - 4
    const boxSize = readUint32BE(bytes, boxStart)
    if (boxSize >= 20 && offset + 16 <= bytes.length) {
      return { width: readUint32BE(bytes, offset + 8), height: readUint32BE(bytes, offset + 12), format: "ISO-BMFF" }
    }
  }
  return null
}

export function sniffRasterDimensions(bytes: Uint8Array): ImageHeaderDimensions | null {
  return (
    sniffPngDimensions(bytes) ??
    sniffGifDimensions(bytes) ??
    sniffJpegDimensions(bytes) ??
    sniffWebpDimensions(bytes) ??
    sniffBmpDimensions(bytes) ??
    sniffIsoImageDimensions(bytes)
  )
}
