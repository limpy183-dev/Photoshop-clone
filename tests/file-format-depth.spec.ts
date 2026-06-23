import { expect, test } from "@playwright/test"

import {
  capabilityForAdvancedFormat,
  decodeDicomPreview,
  decodeEpsPreview,
  decodePdfPages,
  encodeDicomCompressedImageData,
  encodeDicomImageData,
  encodeEpsCanvas,
  encodePdfCanvas,
  encodePdfCanvases,
  encodePdfDocument,
  encodeRadianceHdrImageData,
  decodeRadianceHdrPreview,
  extractEmbeddedJpegDataUrl,
  extractEpsEditableVectors,
  extractPdfEditableObjects,
  extractMetadataFromFile,
  inspectDicomMetadata,
  inspectAdvancedFormatFile,
} from "../components/photoshop/advanced-subsystems"
import { serializePsd } from "../components/photoshop/document-io"
import { getCapability } from "../components/photoshop/capabilities"
import {
  decodeAdvancedRasterBuffer,
  decodeAdvancedRasterBufferAsync,
  decodePnmBuffer,
  decodeTgaBuffer,
  decodeTiffBuffer,
  encodeBigTiffImageData,
  encodeDngImageData,
  encodeHeifImageData,
  encodeHeicImageData,
  encodeJpegImageData,
  encodeJpeg2000ImageData,
  encodeOpenExrArbitraryChannels,
  encodeOpenExrHighBitImage,
  encodeOpenExrImageData,
  encodeOpenExrMultipart,
  encodePngImageData,
  encodePnmImageData,
  encodePnmHighBitImage,
  encodeTgaImageData,
  encodeTiffHighBitImageData,
  encodeTiffImageData,
  encodeTiffImageDataAsync,
  injectAvifIccProfile,
  injectAvifXmpMetadata,
  injectWebpIccProfile,
  injectWebpXmpMetadata,
  inspectExrHeader,
  planPsbLargeDocumentOpen,
  xmpPacketFromRasterMetadata,
} from "../components/photoshop/raster-codecs"
import type { HighBitImage } from "../components/photoshop/color-pipeline"
import { installFixtureDom } from "./photoshop-fixtures"

type AdvancedFormatCapabilityWithExport = ReturnType<typeof capabilityForAdvancedFormat> & { exportPath?: string }

function le16(value: number) {
  return [value & 255, (value >> 8) & 255]
}

function le32(value: number) {
  return [value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255]
}

function tiffEntry(tag: number, type: number, count: number, valueOrOffset: number) {
  return [
    ...le16(tag),
    ...le16(type),
    ...le32(count),
    ...le32(valueOrOffset),
  ]
}

function readTiffTagValue(bytes: Uint8Array, tag: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ifdOffset = view.getUint32(4, true)
  const tagCount = view.getUint16(ifdOffset, true)
  for (let i = 0; i < tagCount; i++) {
    const entryOffset = ifdOffset + 2 + i * 12
    if (view.getUint16(entryOffset, true) === tag) return view.getUint32(entryOffset + 8, true)
  }
  throw new Error(`TIFF tag ${tag} not found`)
}

function makeBaselineRgbTiff() {
  const tagCount = 10
  const ifdOffset = 8
  const bitsOffset = ifdOffset + 2 + tagCount * 12 + 4
  const pixelOffset = bitsOffset + 6
  return new Uint8Array([
    0x49, 0x49, 42, 0,
    ...le32(ifdOffset),
    ...le16(tagCount),
    ...tiffEntry(256, 4, 1, 2),
    ...tiffEntry(257, 4, 1, 1),
    ...tiffEntry(258, 3, 3, bitsOffset),
    ...tiffEntry(259, 3, 1, 1),
    ...tiffEntry(262, 3, 1, 2),
    ...tiffEntry(273, 4, 1, pixelOffset),
    ...tiffEntry(277, 3, 1, 3),
    ...tiffEntry(278, 4, 1, 1),
    ...tiffEntry(279, 4, 1, 6),
    ...tiffEntry(284, 3, 1, 1),
    ...le32(0),
    ...le16(8), ...le16(8), ...le16(8),
    10, 20, 30,
    40, 50, 60,
  ]).buffer
}

function ascii(value: string) {
  return Array.from(value, (ch) => ch.charCodeAt(0))
}

function be16(value: number) {
  return [(value >> 8) & 255, value & 255]
}

function be32(value: number) {
  return [(value >> 24) & 255, (value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function photoshopHeader(version: 1 | 2, width: number, height: number, depth = 16) {
  return new Uint8Array([
    ...ascii("8BPS"),
    ...be16(version),
    0, 0, 0, 0, 0, 0,
    ...be16(4),
    ...be32(height),
    ...be32(width),
    ...be16(depth),
    ...be16(3),
  ])
}

function pngChunks(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  const chunks: Array<{ type: string; data: Uint8Array; offset: number }> = []
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    chunks.push({ type, data: bytes.subarray(offset + 8, offset + 8 + length), offset })
    offset += 12 + length
    if (type === "IEND") break
  }
  return chunks
}

function jpegHasMarker(buffer: ArrayBuffer, marker: number) {
  const bytes = new Uint8Array(buffer)
  let offset = 2
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++
      continue
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset++
    const found = bytes[offset++]
    if (found === marker) return true
    if (found === 0xda || found === 0xd9) return false
    if (found === 0x01 || (found >= 0xd0 && found <= 0xd7)) continue
    if (offset + 2 > bytes.length) return false
    const length = (bytes[offset] << 8) | bytes[offset + 1]
    offset += length
  }
  return false
}

function jpegMarkerPayloads(buffer: ArrayBuffer, marker: number) {
  const bytes = new Uint8Array(buffer)
  const payloads: Uint8Array[] = []
  let offset = 2
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++
      continue
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset++
    const found = bytes[offset++]
    if (found === 0xda || found === 0xd9) break
    if (found === 0x01 || (found >= 0xd0 && found <= 0xd7)) continue
    if (offset + 2 > bytes.length) break
    const length = (bytes[offset] << 8) | bytes[offset + 1]
    const payloadStart = offset + 2
    const payloadEnd = offset + length
    if (found === marker && payloadEnd <= bytes.length) payloads.push(bytes.subarray(payloadStart, payloadEnd))
    offset = payloadEnd
  }
  return payloads
}

function tiffCompression(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  const little = String.fromCharCode(view.getUint8(0), view.getUint8(1)) === "II"
  const ifdOffset = view.getUint32(4, little)
  const tagCount = view.getUint16(ifdOffset, little)
  for (let i = 0; i < tagCount; i++) {
    const entry = ifdOffset + 2 + i * 12
    if (view.getUint16(entry, little) === 259) return view.getUint16(entry + 8, little)
  }
  return 0
}

function tiffTags(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  const little = String.fromCharCode(view.getUint8(0), view.getUint8(1)) === "II"
  const ifdOffset = view.getUint32(4, little)
  const tagCount = view.getUint16(ifdOffset, little)
  const tags = new Map<number, { type: number; count: number; valueOrOffset: number }>()
  for (let i = 0; i < tagCount; i++) {
    const entry = ifdOffset + 2 + i * 12
    tags.set(view.getUint16(entry, little), {
      type: view.getUint16(entry + 2, little),
      count: view.getUint32(entry + 4, little),
      valueOrOffset: view.getUint32(entry + 8, little),
    })
  }
  return tags
}

function bytesContainAscii(buffer: ArrayBuffer, value: string) {
  return new TextDecoder("latin1").decode(buffer).includes(value)
}

function tiffTagBytes(buffer: ArrayBuffer, tag: number) {
  const view = new DataView(buffer)
  const little = String.fromCharCode(view.getUint8(0), view.getUint8(1)) === "II"
  const ifdOffset = view.getUint32(4, little)
  const tagCount = view.getUint16(ifdOffset, little)
  for (let i = 0; i < tagCount; i++) {
    const entry = ifdOffset + 2 + i * 12
    if (view.getUint16(entry, little) !== tag) continue
    const type = view.getUint16(entry + 2, little)
    const count = view.getUint32(entry + 4, little)
    const unit = type === 3 ? 2 : type === 4 ? 4 : 1
    const byteCount = unit * count
    const offset = byteCount <= 4 ? entry + 8 : view.getUint32(entry + 8, little)
    return new Uint8Array(buffer, offset, byteCount)
  }
  return null
}

function tiffTagBytesFromAllIfds(buffer: ArrayBuffer, tag: number) {
  const view = new DataView(buffer)
  const little = String.fromCharCode(view.getUint8(0), view.getUint8(1)) === "II"
  let ifdOffset = view.getUint32(4, little)
  const seen = new Set<number>()
  while (ifdOffset > 0 && ifdOffset + 2 <= buffer.byteLength && !seen.has(ifdOffset)) {
    seen.add(ifdOffset)
    const tagCount = view.getUint16(ifdOffset, little)
    for (let i = 0; i < tagCount; i++) {
      const entry = ifdOffset + 2 + i * 12
      if (entry + 12 > buffer.byteLength) return null
      if (view.getUint16(entry, little) !== tag) continue
      const type = view.getUint16(entry + 2, little)
      const count = view.getUint32(entry + 4, little)
      const unit = type === 3 ? 2 : type === 4 ? 4 : 1
      const byteCount = unit * count
      const offset = byteCount <= 4 ? entry + 8 : view.getUint32(entry + 8, little)
      return new Uint8Array(buffer, offset, byteCount)
    }
    const nextOffset = ifdOffset + 2 + tagCount * 12
    if (nextOffset + 4 > buffer.byteLength) return null
    ifdOffset = view.getUint32(nextOffset, little)
  }
  return null
}

function tiffNestedTags(buffer: ArrayBuffer, pointerTag: number) {
  const view = new DataView(buffer)
  const little = String.fromCharCode(view.getUint8(0), view.getUint8(1)) === "II"
  const pointer = readTiffTagValue(new Uint8Array(buffer), pointerTag)
  const count = view.getUint16(pointer, little)
  const tags = new Set<number>()
  for (let i = 0; i < count; i++) {
    tags.add(view.getUint16(pointer + 2 + i * 12, little))
  }
  return tags
}

function fakeWebpBytes() {
  const vp8x = new Uint8Array(10)
  vp8x[4] = 1
  vp8x[7] = 1
  const vp8 = new Uint8Array([1, 2, 3, 4])
  const body = new Uint8Array([
    ...ascii("WEBP"),
    ...ascii("VP8X"),
    ...le32(10),
    ...vp8x,
    ...ascii("VP8 "),
    ...le32(vp8.length),
    ...vp8,
  ])
  return new Uint8Array([...ascii("RIFF"), ...le32(body.length), ...body])
}

function riffChunkPayloads(buffer: ArrayBuffer | Uint8Array, type: string) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const payloads: Uint8Array[] = []
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const chunkType = String.fromCharCode(...bytes.subarray(offset, offset + 4))
    const size = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true)
    const payloadStart = offset + 8
    const payloadEnd = payloadStart + size
    if (payloadEnd > bytes.length) break
    if (chunkType === type) payloads.push(bytes.subarray(payloadStart, payloadEnd))
    offset = payloadEnd + (size % 2)
  }
  return payloads
}

function mp4Box(type: string, data: Uint8Array) {
  return new Uint8Array([...be32(data.length + 8), ...ascii(type), ...data])
}

function fakeAvifBytes() {
  return new Uint8Array([
    ...mp4Box("ftyp", new Uint8Array([...ascii("avif"), 0, 0, 0, 0, ...ascii("avif"), ...ascii("mif1")])),
    ...mp4Box("mdat", new Uint8Array([1, 2, 3, 4])),
  ])
}

function mp4Boxes(buffer: ArrayBuffer | Uint8Array) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const boxes: Array<{ type: string; offset: number; size: number; payload: Uint8Array }> = []
  let offset = 0
  while (offset + 8 <= bytes.length) {
    const size = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (size < 8 || offset + size > bytes.length) break
    boxes.push({ type, offset, size, payload: bytes.subarray(offset + 8, offset + size) })
    offset += size
  }
  return boxes
}

function dicomElement(group: number, element: number, vr: string, data: number[]) {
  if (["OB", "OW", "SQ", "UN", "UT"].includes(vr)) {
    return [
      ...le16(group),
      ...le16(element),
      ...ascii(vr),
      0, 0,
      ...le32(data.length),
      ...data,
    ]
  }
  return [
    ...le16(group),
    ...le16(element),
    ...ascii(vr),
    ...le16(data.length),
    ...data,
  ]
}

function dicomPreviewFixture(rows: number, cols: number) {
  return new Uint8Array([
    ...new Uint8Array(128),
    ...ascii("DICM"),
    ...dicomElement(0x0028, 0x0010, "US", le16(rows)),
    ...dicomElement(0x0028, 0x0011, "US", le16(cols)),
    ...dicomElement(0x0028, 0x0100, "US", le16(8)),
    ...dicomElement(0x7fe0, 0x0010, "OB", [0]),
  ]).buffer
}

test("TGA decoder imports RLE true-color pixels with alpha and top-left origin", () => {
  const buffer = new Uint8Array([
    0, 0, 10,
    0, 0, 0, 0, 0,
    0, 0, 0, 0,
    ...le16(3), ...le16(1),
    32, 0x20,
    0x82, 30, 20, 10, 255,
  ]).buffer

  const decoded = decodeTgaBuffer(buffer)

  expect(decoded.width).toBe(3)
  expect(decoded.height).toBe(1)
  expect(decoded.format).toBe("TGA")
  expect(decoded.bitDepth).toBe(8)
  expect(Array.from(decoded.imageData.data)).toEqual([
    10, 20, 30, 255,
    10, 20, 30, 255,
    10, 20, 30, 255,
  ])
  expect(decoded.warnings).toEqual([])
})

test("TGA decoder maps 16-bit ARGB1555 alpha through the descriptor attribute bits", () => {
  const header = (descriptor: number) => [
    0, 0, 2,
    0, 0, 0, 0, 0,
    0, 0, 0, 0,
    ...le16(2), ...le16(1),
    16, descriptor,
  ]
  const pixels = [...le16(0xfc00), ...le16(0x03e0)]

  const withAttribute = decodeTgaBuffer(new Uint8Array([...header(0x21), ...pixels]).buffer)
  const withoutAttribute = decodeTgaBuffer(new Uint8Array([...header(0x20), ...pixels]).buffer)

  expect(Array.from(withAttribute.imageData.data)).toEqual([
    255, 0, 0, 255,
    0, 255, 0, 0,
  ])
  expect(Array.from(withoutAttribute.imageData.data)).toEqual([
    255, 0, 0, 255,
    0, 255, 0, 255,
  ])
})

test("PNM decoder tone maps 16-bit PPM samples into an 8-bit preview while reporting source depth", () => {
  const buffer = new Uint8Array([
    ...ascii("P6\n2 1\n65535\n"),
    0x00, 0x00, 0x80, 0x00, 0xff, 0xff,
    0xff, 0xff, 0x00, 0x00, 0x40, 0x00,
  ]).buffer

  const decoded = decodePnmBuffer(buffer)

  expect(decoded.width).toBe(2)
  expect(decoded.height).toBe(1)
  expect(decoded.bitDepth).toBe(16)
  expect(Array.from(decoded.imageData.data)).toEqual([
    0, 128, 255, 255,
    255, 0, 64, 255,
  ])
})

test("TIFF decoder reads baseline uncompressed RGB strips without browser image support", () => {
  const decoded = decodeTiffBuffer(makeBaselineRgbTiff())

  expect(decoded.format).toBe("TIFF")
  expect(decoded.width).toBe(2)
  expect(decoded.height).toBe(1)
  expect(decoded.channels).toBe(3)
  expect(decoded.compression).toBe("none")
  expect(Array.from(decoded.imageData.data)).toEqual([
    10, 20, 30, 255,
    40, 50, 60, 255,
  ])
})

test("advanced raster dispatcher covers sync local non-browser formats", () => {
  const tiff = decodeAdvancedRasterBuffer(makeBaselineRgbTiff(), "fixture.tif")
  expect(tiff?.format).toBe("TIFF")
})

test("OpenEXR encoder and async decoder round-trip scene-linear pixels into an editable preview", async () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    255, 0, 0, 255,
    0, 128, 255, 128,
  ]), 2, 1)

  const exr = encodeOpenExrImageData(source)
  const info = inspectExrHeader(exr)
  const decoded = await decodeAdvancedRasterBufferAsync(exr, "fixture.exr")

  expect(info.magic).toBe(true)
  expect(info.pixelDecoded).toBe(true)
  expect(decoded?.format).toBe("OpenEXR")
  expect(decoded?.width).toBe(2)
  expect(decoded?.height).toBe(1)
  expect(decoded?.bitDepth).toBe(32)
  expect(decoded?.imageData.data[0]).toBeGreaterThan(240)
  expect(decoded?.imageData.data[6]).toBeGreaterThan(240)
})

test("TIFF encoder writes a TIFF that the async decoder imports as editable RGBA pixels", async () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    12, 34, 56, 255,
    200, 180, 160, 100,
  ]), 2, 1)

  const tiff = encodeTiffImageData(source)
  const decoded = await decodeAdvancedRasterBufferAsync(tiff, "roundtrip.tiff")

  expect(decoded?.format).toBe("TIFF")
  expect(decoded?.width).toBe(2)
  expect(decoded?.height).toBe(1)
  expect(Array.from(decoded!.imageData.data.slice(0, 8))).toEqual([
    12, 34, 56, 255,
    200, 180, 160, 100,
  ])
})

test("TIFF encoder writes LZW and Deflate compressed strips that decode back to pixels", async () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    12, 34, 56, 255,
    12, 34, 56, 255,
    200, 180, 160, 100,
    200, 180, 160, 100,
  ]), 4, 1)

  const lzw = encodeTiffImageData(source, { compression: "lzw" })
  const deflate = await encodeTiffImageDataAsync(source, { compression: "deflate" })
  const lzwDecoded = await decodeAdvancedRasterBufferAsync(lzw, "compressed-lzw.tif")
  const deflateDecoded = await decodeAdvancedRasterBufferAsync(deflate, "compressed-deflate.tif")

  expect(tiffCompression(lzw)).toBe(5)
  expect(tiffCompression(deflate)).toBe(8)
  expect(Array.from(lzwDecoded!.imageData.data)).toEqual(Array.from(source.data))
  expect(Array.from(deflateDecoded!.imageData.data)).toEqual(Array.from(source.data))
})

test("TGA encoder writes raw and RLE BGR(A) streams", () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    10, 20, 30, 255,
    10, 20, 30, 255,
    200, 150, 100, 128,
    200, 150, 100, 128,
  ]), 4, 1)

  const raw = encodeTgaImageData(source, { rle: false })
  const rle = encodeTgaImageData(source, { rle: true })
  const rawDecoded = decodeTgaBuffer(raw)
  const rleDecoded = decodeTgaBuffer(rle)

  expect(new Uint8Array(raw)[2]).toBe(2)
  expect(new Uint8Array(rle)[2]).toBe(10)
  expect(rle.byteLength).toBeLessThan(raw.byteLength)
  expect(Array.from(rawDecoded.imageData.data)).toEqual(Array.from(source.data))
  expect(Array.from(rleDecoded.imageData.data)).toEqual(Array.from(source.data))
})

test("PNM encoder writes PPM, PGM, and PBM binary variants", () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 0, 255,
    255, 255, 255, 255,
  ]), 2, 2)

  const ppm = decodePnmBuffer(encodePnmImageData(source, "ppm"))
  const pgm = decodePnmBuffer(encodePnmImageData(source, "pgm"))
  const pbm = decodePnmBuffer(encodePnmImageData(source, "pbm"))

  expect(Array.from(ppm.imageData.data)).toEqual(Array.from(source.data))
  expect(Array.from(pgm.imageData.data.slice(0, 8))).toEqual([76, 76, 76, 255, 150, 150, 150, 255])
  expect(Array.from(pbm.imageData.data)).toEqual([
    0, 0, 0, 255,
    255, 255, 255, 255,
    0, 0, 0, 255,
    255, 255, 255, 255,
  ])
})

test("high-bit PNM, TIFF, and EXR encoders preserve 16-bit typed-array samples", () => {
  const source: HighBitImage = {
    width: 2,
    height: 1,
    channels: 4,
    bitDepth: 16,
    colorMode: "RGB",
    storage: "uint16",
    data: new Uint16Array([
      0x1234, 0x8000, 0xffff, 0xffff,
      0x0001, 0x0002, 0x0003, 0x4000,
    ]),
    warnings: [],
  }

  const ppm = new Uint8Array(encodePnmHighBitImage(source, "ppm"))
  const headerEnd = new TextDecoder().decode(ppm).indexOf("\n65535\n") + "\n65535\n".length
  expect(Array.from(ppm.slice(headerEnd, headerEnd + 6))).toEqual([0x12, 0x34, 0x80, 0x00, 0xff, 0xff])

  const tiff = new Uint8Array(encodeTiffHighBitImageData(source))
  const view = new DataView(tiff.buffer)
  expect(view.getUint16(2, true)).toBe(42)
  expect(view.getUint16(8, true)).toBeGreaterThanOrEqual(11)
  const bitsOffset = readTiffTagValue(tiff, 258)
  const pixelOffset = readTiffTagValue(tiff, 273)
  expect(view.getUint16(bitsOffset, true)).toBe(16)
  expect(view.getUint16(bitsOffset + 6, true)).toBe(16)
  expect(tiff.slice(pixelOffset, pixelOffset + 2)).toEqual(new Uint8Array([0x34, 0x12]))

  const exrBuffer = encodeOpenExrHighBitImage(source, { channels: "rgba", pixelType: "float" })
  const exr = new Uint8Array(exrBuffer)
  const exrInfo = inspectExrHeader(exrBuffer)
  const exrView = new DataView(exr.buffer)
  const exrChunkOffset = exr.byteLength - (8 + source.width * 4 * 4)
  expect(exrInfo.bitDepth).toBe(32)
  expect(exrView.getFloat32(exrChunkOffset + 8, true)).toBeCloseTo(0x1234 / 65535, 5)
})

test("PNG encoder writes Adam7 interlace and text metadata chunks", async () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    10, 20, 30, 255,
    40, 50, 60, 255,
    70, 80, 90, 255,
    100, 110, 120, 255,
  ]), 2, 2)

  const png = await encodePngImageData(source, {
    interlaced: true,
    metadata: {
      author: "Ada",
      copyright: "CC0",
      description: "Interlaced export",
      creationDate: "2026-05-24T12:00:00.000Z",
      xmp: "<x:xmpmeta>fixture</x:xmpmeta>",
    },
  })
  const chunks = pngChunks(png)
  const ihdr = chunks.find((chunk) => chunk.type === "IHDR")!.data

  expect(ihdr[12]).toBe(1)
  expect(chunks.some((chunk) => chunk.type === "tEXt" && new TextDecoder("latin1").decode(chunk.data).startsWith("Author\0Ada"))).toBe(true)
  expect(chunks.some((chunk) => chunk.type === "iTXt" && new TextDecoder().decode(chunk.data).includes("<x:xmpmeta>fixture</x:xmpmeta>"))).toBe(true)
})

test("JPEG encoder writes progressive SOF2 and XMP APP1 metadata", async () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 255, 255,
  ]), 2, 2)

  const jpeg = await encodeJpegImageData(source, {
    quality: 82,
    progressive: true,
    metadata: {
      author: "Ada",
      description: "Progressive export",
      xmp: "<x:xmpmeta>fixture</x:xmpmeta>",
    },
  })

  expect(jpegHasMarker(jpeg, 0xc2)).toBe(true)
  expect(new TextDecoder("latin1").decode(jpeg.slice(0, 512))).toContain("http://ns.adobe.com/xap/1.0/")
})

test("HEIF and JPEG 2000 exporters produce browser-compatible advanced raster payloads", async () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray(64 * 64 * 4), 64, 64)
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const offset = (y * 64 + x) * 4
      source.data[offset] = x * 4
      source.data[offset + 1] = y * 4
      source.data[offset + 2] = 128
      source.data[offset + 3] = 255
    }
  }

  const heif = await encodeHeifImageData(source, {
    quality: 0.82,
    encodeAvif: async () => new Uint8Array([
      0, 0, 0, 24,
      ...ascii("ftyp"),
      ...ascii("avif"),
      0, 0, 0, 0,
      ...ascii("avif"),
      ...ascii("mif1"),
    ]).buffer,
  })
  const jp2 = await encodeJpeg2000ImageData(source, { quality: 1, reversible: true, decompositions: 0 })
  const jp2Decoded = await decodeAdvancedRasterBufferAsync(jp2, "roundtrip.j2k")

  expect(new TextDecoder("latin1").decode(heif.slice(4, 16))).toContain("ftypavif")
  expect(Array.from(new Uint8Array(jp2).slice(0, 2))).toEqual([0xff, 0x4f])
  expect(jp2Decoded?.format).toBe("JPEG 2000")
  expect(jp2Decoded?.width).toBe(64)
  expect(jp2Decoded?.height).toBe(64)
})

test("HEIC export uses a HEVC-backed HEIC container instead of the AVIF fallback path", async () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    255, 0, 0, 255,
    0, 255, 0, 128,
  ]), 2, 1)

  const heic = await encodeHeicImageData(source, {
    quality: 0.9,
    metadata: {
      author: "Ada",
      iccProfileName: "Display P3",
      iccProfile: new Uint8Array([1, 2, 3, 4]),
    },
    encodeHevc: async (image, options) => {
      expect(image.width).toBe(2)
      expect(options.quality).toBe(0.9)
      return {
        bitstream: new Uint8Array([0, 0, 1, 0x26, 1, 2, 3, 4]),
        decoderConfig: new Uint8Array([1, 1, 96, 0, 0, 0]),
      }
    },
  })
  const text = new TextDecoder("latin1").decode(heic)

  expect(text).toContain("ftypheic")
  expect(text).toContain("hvc1")
  expect(text).toContain("hvcC")
  expect(text).toContain("Photoshop Web ICC")
  expect(text).not.toContain("ftypavif")
})

test("JPEG 2000 authoring writes JPX/JPM containers with alpha, ICC color boxes, and profile metadata", async () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    255, 0, 0, 255,
    0, 255, 0, 128,
    0, 0, 255, 64,
    255, 255, 255, 0,
  ]), 2, 2)

  const jpx = await encodeJpeg2000ImageData(source, {
    container: "jpx",
    includeAlpha: true,
    quality: 1,
    reversible: true,
    color: {
      enumColorSpace: 16,
      iccProfileName: "Fixture RGB",
      iccProfile: new Uint8Array([9, 8, 7, 6]),
      profileControls: { progressionOrder: "LRCP", resolutionLevels: 3 },
    },
  })
  const jpm = await encodeJpeg2000ImageData(source, {
    container: "jpm",
    includeAlpha: true,
    layers: [{ label: "Transparency mask", opacity: 0.5 }],
  })
  const jpxText = new TextDecoder("latin1").decode(jpx)
  const jpmText = new TextDecoder("latin1").decode(jpm)

  expect(Array.from(new Uint8Array(jpx).slice(4, 8))).toEqual(ascii("jP  "))
  expect(jpxText).toContain("ftypjpx ")
  expect(jpxText).toContain("cdef")
  expect(jpxText).toContain("colr")
  expect(jpxText).toContain("Fixture RGB")
  expect(jpxText).toContain("pswp")
  expect(jpmText).toContain("ftypjpm ")
  expect(jpmText).toContain("Transparency mask")
})

test("JPEG 2000 export retries a transient first OpenJPEG encode failure", async () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 255, 255,
  ]), 2, 2)
  let attempts = 0
  const codestream = new Uint8Array(40)
  codestream[0] = 0xff
  codestream[1] = 0x4f
  codestream[2] = 0xff
  codestream[3] = 0x51
  class FlakyJpeg2000Encoder {
    getDecodedBuffer(frameInfo: { width: number; height: number; componentCount: number }) {
      return new Uint8Array(frameInfo.width * frameInfo.height * frameInfo.componentCount)
    }

    getEncodedBuffer() {
      return codestream
    }

    encode() {
      attempts += 1
      if (attempts === 1) throw new Error("transient opj_start_compress failure")
    }

    setDecompositions() {}
    setQuality() {}
    delete() {}
  }

  const jpx = await encodeJpeg2000ImageData(source, {
    container: "jpx",
    includeAlpha: true,
    openJpegCodec: { J2KEncoder: FlakyJpeg2000Encoder },
  } as Parameters<typeof encodeJpeg2000ImageData>[1] & { openJpegCodec: unknown })
  const text = new TextDecoder("latin1").decode(jpx)

  expect(attempts).toBe(2)
  expect(text).toContain("ftypjpx ")
  expect(text).toContain("jp2c")
})

test("TIFF encoder authors document metadata, XMP, and EXIF-style directory tags", async () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    12, 34, 56, 255,
    200, 180, 160, 100,
  ]), 2, 1)

  const tiff = encodeTiffImageData(source, {
    metadata: {
      author: "Ada",
      copyright: "CC0",
      description: "TIFF metadata fixture",
      creationDate: "2026-05-24T12:34:56.000Z",
      xmp: "<x:xmpmeta>fixture</x:xmpmeta>",
    },
  })
  const tags = tiffTags(tiff)

  expect(tags.has(270)).toBe(true)
  expect(tags.has(305)).toBe(true)
  expect(tags.has(306)).toBe(true)
  expect(tags.has(315)).toBe(true)
  expect(tags.has(700)).toBe(true)
  expect(tags.has(33432)).toBe(true)
  expect(tags.has(34665)).toBe(true)
  expect(bytesContainAscii(tiff, "TIFF metadata fixture")).toBe(true)
  expect(bytesContainAscii(tiff, "2026:05:24 12:34:56")).toBe(true)
  expect(bytesContainAscii(tiff, "<x:xmpmeta>fixture</x:xmpmeta>")).toBe(true)
})

test("TIFF encoder authors IPTC, populated EXIF IFD, XMP content credentials, and ICC profile bytes", () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    12, 34, 56, 255,
    200, 180, 160, 255,
  ]), 2, 1)

  const tiff = encodeTiffImageData(source, {
    metadata: {
      title: "Raster metadata fixture",
      author: "Ada",
      copyright: "CC0",
      description: "Rich TIFF metadata",
      creationDate: "2026-05-24T12:34:56.000Z",
      keywords: ["export", "metadata"],
      credit: "Research Lab",
      source: "Browser raster export",
      contentCredentials: [{
        id: "cred_fixture",
        action: "local-edit",
        actor: "Ada",
        software: "Photoshop Web",
        createdAt: "2026-05-24T12:34:56.000Z",
        documentName: "fixture.psproj",
        documentHash: "abc123",
        layerCount: 1,
        dimensions: { width: 2, height: 1 },
        ingredients: [{ id: "layer_1", name: "Pixels", kind: "raster", visible: true, hash: "def456" }],
        assertion: "Edited locally",
      }],
      iccProfileName: "sRGB IEC61966-2.1",
      iccProfile: new Uint8Array([0, 1, 2, 3, 4, 5]),
    },
  })
  const tags = tiffTags(tiff)
  const exifTags = tiffNestedTags(tiff, 34665)
  const iptc = new TextDecoder("latin1").decode(tiffTagBytes(tiff, 33723) ?? new Uint8Array())
  const xmp = new TextDecoder().decode(tiffTagBytes(tiff, 700) ?? new Uint8Array())
  const icc = tiffTagBytes(tiff, 34675)

  expect(tags.has(33723)).toBe(true)
  expect(tags.has(34665)).toBe(true)
  expect(tags.has(34675)).toBe(true)
  expect(exifTags.has(36867)).toBe(true)
  expect(exifTags.has(37510)).toBe(true)
  expect(iptc).toContain("Raster metadata fixture")
  expect(iptc).toContain("Research Lab")
  expect(xmp).toContain("psweb:ContentCredentials")
  expect(xmp).toContain("cred_fixture")
  expect(icc).toEqual(new Uint8Array([0, 1, 2, 3, 4, 5]))
})

test("TIFF encoder writes GPS EXIF directory metadata", async () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    12, 34, 56, 255,
  ]), 1, 1)

  const tiff = await encodeTiffImageDataAsync(source, {
    metadata: {
      description: "GPS fixture",
      creationDate: "2026-05-24T12:34:56.000Z",
      gps: {
        latitude: 51.5074,
        longitude: -0.1278,
        altitude: 42.5,
        capturedAt: "2026-05-24T12:34:56.000Z",
      },
    },
  })
  const gpsTags = tiffNestedTags(tiff, 34853)

  for (const tag of [0, 1, 2, 3, 4, 5, 6, 7, 29]) {
    expect(gpsTags.has(tag)).toBe(true)
  }
})

test("BigTIFF and DNG export author 64-bit directories, subdirectories, RAW sidecars, and DNG metadata", () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    12, 34, 56, 255,
    200, 180, 160, 100,
  ]), 2, 1)
  const sidecar = "<x:xmpmeta><psweb:CameraRawRecipe>{}</psweb:CameraRawRecipe></x:xmpmeta>"

  const big = encodeBigTiffImageData(source, {
    metadata: {
      title: "BigTIFF fixture",
      author: "Ada",
      xmp: "<x:xmpmeta>big fixture</x:xmpmeta>",
    },
    directories: [{
      name: "Reduced preview",
      width: 1,
      height: 1,
      fields: [{ tag: 65000, type: 2, data: new TextEncoder().encode("custom-directory\0") }],
    }],
    customFields: [{ tag: 65001, type: 2, data: new TextEncoder().encode("custom-root\0") }],
  })
  const dng = encodeDngImageData(source, {
    metadata: { author: "Ada", xmp: sidecar },
    cameraModel: "Fixture Camera",
    uniqueCameraModel: "Fixture Camera DNG",
    sidecar,
  })
  const bigView = new DataView(big)
  const bigText = new TextDecoder("latin1").decode(big)
  const dngText = new TextDecoder("latin1").decode(dng)
  const dngTags = tiffTags(dng)

  expect(bigView.getUint16(2, true)).toBe(43)
  expect(bigView.getUint16(4, true)).toBe(8)
  expect(bigText).toContain("BigTIFF fixture")
  expect(bigText).toContain("custom-directory")
  expect(bigText).toContain("custom-root")
  expect(dngTags.has(50706)).toBe(true)
  expect(dngTags.has(50708)).toBe(true)
  expect(dngText).toContain("Fixture Camera DNG")
  expect(dngText).toContain("psweb:CameraRawRecipe")
})

test("WebP and AVIF metadata helpers embed XMP content credentials, encoder settings, and ICC payloads", () => {
  const metadata = {
    author: "Ada",
    description: "Advanced browser metadata",
    creationDate: "2026-05-24T12:34:56.000Z",
    contentCredentials: [{
      id: "cred_web",
      action: "local-edit",
      actor: "Ada",
      software: "Photoshop Web",
      createdAt: "2026-05-24T12:34:56.000Z",
      documentName: "web.psproj",
      documentHash: "abc123",
      layerCount: 1,
      dimensions: { width: 2, height: 1 },
      ingredients: [],
      assertion: "Edited locally",
    }],
    webp: { lossless: true, nearLossless: 80, method: 6, exactAlpha: true },
    avif: { lossless: true, speed: 4, chromaSubsampling: "4:4:4", tileRowsLog2: 1, tileColsLog2: 1 },
    iccProfileName: "Display P3",
    iccProfile: new Uint8Array([9, 8, 7, 6]),
  }

  const xmp = xmpPacketFromRasterMetadata(metadata)
  const webp = injectWebpIccProfile(injectWebpXmpMetadata(fakeWebpBytes(), metadata), metadata.iccProfile, metadata.iccProfileName)
  const avif = injectAvifIccProfile(injectAvifXmpMetadata(fakeAvifBytes(), metadata), metadata.iccProfile, metadata.iccProfileName)
  const webpText = new TextDecoder("latin1").decode(webp)
  const avifText = new TextDecoder("latin1").decode(avif)

  expect(xmp).toContain("psweb:ContentCredentials")
  expect(xmp).toContain("cred_web")
  expect(xmp).toContain("psweb:WebPEncoder")
  expect(xmp).toContain("psweb:AVIFEncoder")
  expect(webpText).toContain("XMP ")
  expect(webpText).toContain("ICCP")
  expect(webp[20] & 0x24).toBe(0x24)
  expect(avifText).toContain("uuid")
  expect(avifText).toContain("Photoshop Web ICC")
  expect(avifText).toContain("Display P3")
})

test("raster content credentials are embedded in format-native C2PA provenance carriers", async () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    12, 34, 56, 255,
    200, 180, 160, 255,
  ]), 2, 1)
  const metadata = {
    title: "Provenance fixture",
    author: "Ada",
    description: "C2PA provenance payload",
    creationDate: "2026-05-24T12:34:56.000Z",
    contentCredentials: [{
      id: "cred_native",
      action: "local-edit",
      actor: "Ada",
      software: "Photoshop Web",
      createdAt: "2026-05-24T12:34:56.000Z",
      documentName: "provenance.psproj",
      documentHash: "abc123",
      layerCount: 1,
      dimensions: { width: 2, height: 1 },
      ingredients: [{ id: "layer_1", name: "Pixels", kind: "raster" as const, visible: true, hash: "def456" }],
      assertion: "Edited locally",
    }],
  }

  const png = await encodePngImageData(source, { metadata })
  const jpeg = await encodeJpegImageData(source, { metadata })
  const tiff = encodeTiffImageData(source, { metadata })
  const webp = injectWebpXmpMetadata(fakeWebpBytes(), metadata)
  const avif = injectAvifXmpMetadata(fakeAvifBytes(), metadata)
  const pngChunksList = pngChunks(png)
  const pngCabx = pngChunksList.find((chunk) => chunk.type === "caBX")
  const jpegApp11 = jpegMarkerPayloads(jpeg, 0xeb)
  const tiffC2pa = tiffTagBytesFromAllIfds(tiff, 52545)
  const webpC2pa = riffChunkPayloads(webp, "C2PA")
  const avifBoxes = mp4Boxes(avif)
  const avifC2pa = avifBoxes.find((box) => box.type === "uuid" && new TextDecoder("latin1").decode(box.payload).includes("c2pa"))
  const avifMdat = avifBoxes.find((box) => box.type === "mdat")

  expect(pngCabx, "PNG should contain a caBX C2PA manifest chunk").toBeTruthy()
  expect(pngChunksList.findIndex((chunk) => chunk.type === "caBX")).toBeLessThan(pngChunksList.findIndex((chunk) => chunk.type === "IDAT"))
  expect(new TextDecoder("latin1").decode(pngCabx!.data)).toContain("cred_native")
  expect(jpegApp11.length, "JPEG should contain C2PA APP11 payloads").toBeGreaterThan(0)
  expect(new TextDecoder("latin1").decode(jpegApp11[0])).toContain("cred_native")
  expect(new TextDecoder("latin1").decode(tiffC2pa ?? new Uint8Array())).toContain("cred_native")
  expect(new TextDecoder("latin1").decode(webpC2pa[0] ?? new Uint8Array())).toContain("cred_native")
  expect(avifC2pa, "AVIF should contain a C2PA UUID box").toBeTruthy()
  expect(avifMdat?.offset).toBeGreaterThan(avifC2pa!.offset)
  expect(new TextDecoder("latin1").decode(avifC2pa!.payload)).toContain("cred_native")
})

test("TGA extension and developer metadata round-trip document fields", () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    10, 20, 30, 255,
    10, 20, 30, 255,
    200, 150, 100, 128,
    200, 150, 100, 128,
  ]), 4, 1)

  const tga = encodeTgaImageData(source, {
    rle: true,
    metadata: {
      title: "TGA fixture",
      author: "Ada",
      copyright: "CC0",
      description: "TGA extension metadata",
      creationDate: "2026-05-24T12:34:56.000Z",
      source: "Browser raster export",
      keywords: ["export", "tga"],
      contentCredentials: [{
        id: "cred_tga",
        action: "local-edit",
        actor: "Ada",
        software: "Photoshop Web",
        createdAt: "2026-05-24T12:34:56.000Z",
        documentName: "tga.psproj",
        documentHash: "abc123",
        layerCount: 1,
        dimensions: { width: 4, height: 1 },
        ingredients: [],
        assertion: "Edited locally",
      }],
    },
  })
  const decoded = decodeTgaBuffer(tga)
  const text = new TextDecoder("latin1").decode(tga)

  expect(Array.from(decoded.imageData.data)).toEqual(Array.from(source.data))
  expect(decoded.metadata?.author).toBe("Ada")
  expect(decoded.metadata?.description).toBe("TGA extension metadata")
  expect(decoded.metadata?.title).toBe("TGA fixture")
  expect(decoded.metadata?.source).toBe("Browser raster export")
  expect(decoded.metadata?.copyright).toBe("CC0")
  expect(decoded.metadata?.keywords).toEqual(["export", "tga"])
  expect(decoded.metadata?.contentCredentials).toEqual(expect.arrayContaining([expect.objectContaining({ id: "cred_tga" })]))
  expect(text).toContain("TRUEVISION-XFILE")
  expect(text).toContain("PSWEBMETA")
})

test("TGA export writes advanced extension controls from metadata", () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    10, 20, 30, 255,
    40, 50, 60, 255,
  ]), 2, 1)

  const tga = encodeTgaImageData(source, {
    rle: false,
    metadata: {
      author: "Ada",
      description: "TGA controls",
      tga: {
        jobName: "Plate proof job",
        softwareId: "PS Web Encoder",
        aspectRatioNumerator: 16,
        aspectRatioDenominator: 9,
        gamma: 2.2,
      },
    },
  })
  const bytes = new Uint8Array(tga)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const footerOffset = bytes.byteLength - 26
  const extensionOffset = view.getUint32(footerOffset, true)
  const text = new TextDecoder("latin1").decode(bytes)

  expect(text).toContain("Plate proof job")
  expect(text).toContain("PS Web Encoder")
  expect(view.getUint16(extensionOffset + 474, true)).toBe(16)
  expect(view.getUint16(extensionOffset + 476, true)).toBe(9)
  expect(view.getUint16(extensionOffset + 478, true)).toBe(2200)
  expect(view.getUint16(extensionOffset + 480, true)).toBe(1000)
})

test("Netpbm comments and source max value round-trip through PPM and high-bit PGM exports", () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    255, 0, 0, 255,
    0, 255, 0, 255,
  ]), 2, 1)
  const metadata = {
    title: "Netpbm fixture",
    author: "Ada",
    description: "Netpbm metadata",
    copyright: "CC0",
    source: "Browser raster export",
    netpbm: {
      comments: ["Source camera max value: 1023"],
      sourceMaxValue: 1023,
    },
  }

  const ppm = encodePnmImageData(source, "ppm", { metadata })
  const decoded = decodePnmBuffer(ppm)
  const headerText = new TextDecoder("latin1").decode(new Uint8Array(ppm).slice(0, 260))

  expect(decoded.metadata?.maxValue).toBe(1023)
  expect(decoded.metadata?.sourceMaxValue).toBe(1023)
  expect(decoded.metadata?.title).toBe("Netpbm fixture")
  expect(decoded.metadata?.author).toBe("Ada")
  expect(decoded.metadata?.description).toBe("Netpbm metadata")
  expect(decoded.metadata?.copyright).toBe("CC0")
  expect(decoded.metadata?.source).toBe("Browser raster export")
  expect(decoded.metadata?.comments).toContain("Author: Ada")
  expect(decoded.metadata?.comments).toContain("Source camera max value: 1023")
  expect(headerText).toContain("# Source-MaxValue: 1023")

  const highBit: HighBitImage = {
    width: 1,
    height: 1,
    channels: 4,
    bitDepth: 16,
    colorMode: "RGB",
    storage: "uint16",
    data: new Uint16Array([0x8000, 0x4000, 0x2000, 0xffff]),
    warnings: [],
  }
  const pgm = encodePnmHighBitImage(highBit, "pgm", { metadata })
  const decodedPgm = decodePnmBuffer(pgm)

  expect(decodedPgm.metadata?.maxValue).toBe(1023)
  expect(decodedPgm.metadata?.comments).toContain("Netpbm metadata")
})

test("PSB large document planner offers clear reject, 50 percent downscale, and tile view paths", () => {
  const plan = planPsbLargeDocumentOpen({ width: 12000, height: 6000, fileName: "mural.psb" })

  expect(plan.fitsBrowserCanvas).toBe(false)
  expect(plan.defaultError).toContain("mural.psb is 12000 x 6000 px")
  expect(plan.defaultError).toContain("open at 50% scale or use tile view")
  expect(plan.downscale50.fits).toBe(true)
  expect(plan.tileView.tileCount).toBeGreaterThan(1)
  expect(plan.tileView.overviewScale).toBeLessThan(1)
})

test("Radiance HDR export and RLE import produce tone-mapped editable previews", async () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    255, 128, 0, 255,
    10, 20, 30, 255,
  ]), 2, 1)
  const exported = encodeRadianceHdrImageData(source)
  const exportedCanvas = await decodeRadianceHdrPreview(new File([exported], "roundtrip.hdr"))

  expect(exportedCanvas?.width).toBe(2)
  expect(exportedCanvas?.height).toBe(1)

  const rle = new Uint8Array([
    ...ascii("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 8\n"),
    2, 2, 0, 8,
    136, 64,
    136, 128,
    136, 255,
    136, 136,
  ]).buffer
  const rleCanvas = await decodeRadianceHdrPreview(new File([rle], "rle.hdr"))
  const pixel = rleCanvas!.getContext("2d")!.getImageData(0, 0, 1, 1).data

  expect(rleCanvas?.width).toBe(8)
  expect(pixel[2]).toBeGreaterThan(pixel[0])
})

test("DICOM export writes a secondary-capture file that the preview decoder can import", async () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    20, 40, 60, 255,
    200, 220, 240, 255,
  ]), 2, 1)

  const dicom = encodeDicomImageData(source, "fixture")
  const bytes = new Uint8Array(dicom)
  const canvas = await decodeDicomPreview(new File([dicom], "roundtrip.dcm"))

  expect(String.fromCharCode(...bytes.slice(128, 132))).toBe("DICM")
  expect(canvas?.width).toBe(2)
  expect(canvas?.height).toBe(1)
})

test("DICOM workflow records compressed transfer syntaxes, overlays, richer metadata, and non-clinical validation labels", async () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    20, 40, 60, 255,
    200, 220, 240, 255,
  ]), 2, 1)
  const overlay = new Uint8Array([0b10000000])

  const dicom = encodeDicomCompressedImageData(source, {
    patientName: "Research^Fixture",
    studyDescription: "Non clinical review",
    seriesDescription: "Browser export",
    transferSyntax: "1.2.840.10008.1.2.4.90",
    compressedPixelData: new Uint8Array([0xff, 0x4f, 0xff, 0x51]),
    overlays: [{ group: 0x6000, rows: 1, columns: 2, data: overlay, description: "Selection overlay" }],
    validationLabel: "NON_CLINICAL_RESEARCH_ONLY",
  })
  const metadata = await inspectDicomMetadata(new File([dicom], "compressed.dcm"))
  const text = new TextDecoder("latin1").decode(dicom)

  expect(metadata.transferSyntax).toBe("1.2.840.10008.1.2.4.90")
  expect(metadata.compressed).toBe(true)
  expect(metadata.overlays).toHaveLength(1)
  expect(metadata.overlays[0]).toMatchObject({ group: 0x6000, rows: 1, columns: 2, description: "Selection overlay" })
  expect(metadata.patientName).toBe("Research^Fixture")
  expect(metadata.validationLabel).toBe("NON_CLINICAL_RESEARCH_ONLY")
  expect(text).toContain("Selection overlay")
  expect(text).toContain("NON_CLINICAL_RESEARCH_ONLY")
})

test("PDF and EPS exporters produce importable flattened/vector-subset handoff files", async () => {
  installFixtureDom()
  const canvas = document.createElement("canvas")
  canvas.width = 2
  canvas.height = 1
  canvas.getContext("2d")!.fillRect(0, 0, 2, 1)

  const pdf = await encodePdfCanvas(canvas, "fixture")
  const multiPdf = await encodePdfCanvases([canvas, canvas], "multipage fixture")
  const eps = encodeEpsCanvas(canvas, "fixture")
  const epsPreview = await decodeEpsPreview(new File([eps], "fixture.eps"))
  const { PDFDocument } = await import("pdf-lib")
  const loaded = await PDFDocument.load(multiPdf)

  expect(new TextDecoder("ascii").decode(pdf.slice(0, 8))).toContain("%PDF-")
  expect(loaded.getPageCount()).toBe(2)
  expect(new TextDecoder("ascii").decode(eps.slice(0, 64))).toContain("%!PS-Adobe")
  expect(epsPreview?.width).toBe(2)
  expect(epsPreview?.height).toBe(1)
})

test("PDF page importer exposes each page as a flattened canvas", async () => {
  installFixtureDom()
  const canvas = document.createElement("canvas")
  canvas.width = 2
  canvas.height = 1
  canvas.getContext("2d")!.fillRect(0, 0, 2, 1)
  const pdf = await encodePdfCanvases([canvas, canvas], "two pages")

  const pages = await decodePdfPages(new File([pdf], "two-pages.pdf"), { maxWidth: 64, maxPages: 4 })

  expect(pages).toHaveLength(2)
  expect(pages[0].pageNumber).toBe(1)
  expect(pages[1].pageNumber).toBe(2)
})

test("PDF authoring preserves multi-page UI intent, editable text/vector records, transparency groups, and annotations", async () => {
  installFixtureDom()
  const canvas = document.createElement("canvas")
  canvas.width = 32
  canvas.height = 24
  canvas.getContext("2d")!.fillRect(0, 0, 32, 24)

  const pdf = await encodePdfDocument({
    title: "Editable PDF fixture",
    pages: [{
      canvas,
      textRuns: [{ text: "Live heading", x: 4, y: 18, size: 10, color: [1, 0, 0] }],
      vectors: [{ id: "rect-1", kind: "rect", x: 2, y: 3, width: 12, height: 8, stroke: [0, 0, 1], fill: [0, 1, 0], opacity: 0.45 }],
      transparencyGroups: [{ id: "group-1", blendMode: "Multiply", isolated: true, knockout: false }],
      annotations: [{ id: "note-1", type: "text", contents: "Review vector edge", x: 6, y: 6, width: 14, height: 10 }],
    }, {
      textRuns: [{ text: "Second page", x: 4, y: 12, size: 8 }],
    }],
  })
  const extracted = await extractPdfEditableObjects(new File([pdf], "editable.pdf"))
  const text = new TextDecoder("latin1").decode(pdf)

  expect(extracted.pageCount).toBe(2)
  expect(extracted.textRuns.map((run) => run.text)).toContain("Live heading")
  expect(extracted.textRuns.map((run) => run.text)).toContain("Second page")
  expect(extracted.vectors.some((vector) => vector.id === "rect-1")).toBe(true)
  expect(extracted.transparencyGroups[0]).toMatchObject({ id: "group-1", blendMode: "Multiply", isolated: true })
  expect(extracted.annotations[0]).toMatchObject({ id: "note-1", contents: "Review vector edge" })
  expect(text).toContain("/Annots")
  expect(text).toContain("/Group")
  expect(text).toContain("PSWEBPDF")
})

test("EPS subset renderer handles curves, CMYK color, line width, and closed paths without executing PostScript", async () => {
  installFixtureDom()
  const eps = new TextEncoder().encode(`%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 32 24
0 0.7 0.4 0 setcmykcolor
2 setlinewidth
newpath
4 4 moveto
20 4 lineto
24 12 24 18 12 20 curveto
closepath
fill
showpage
%%EOF`)

  const canvas = await decodeEpsPreview(new File([eps], "curve.eps"))

  expect(canvas?.width).toBe(32)
  expect(canvas?.height).toBe(24)
})

test("EPS subset parser reconstructs editable vectors across transforms, dash, text, and fill rules", async () => {
  installFixtureDom()
  const eps = new TextEncoder().encode(`%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 64 48
gsave
8 6 translate
2 2 scale
0.1 0.2 0.3 setrgbcolor
[4 2] 0 setdash
newpath
0 0 moveto
16 0 lineto
16 12 lineto
closepath
eofill
grestore
/Helvetica findfont 10 scalefont setfont
4 40 moveto
(Editable EPS) show
showpage
%%EOF`)
  const canvas = await decodeEpsPreview(new File([eps], "editable.eps"))
  const vectors = extractEpsEditableVectors(new TextDecoder().decode(eps))

  expect(canvas?.width).toBe(64)
  expect(vectors.paths).toHaveLength(1)
  expect(vectors.paths[0].paint).toBe("eofill")
  expect(vectors.paths[0].dash).toEqual([4, 2])
  expect(vectors.paths[0].commands[0]).toMatchObject({ op: "move", x: 8, y: 42 })
  expect(vectors.text[0]).toMatchObject({ text: "Editable EPS", x: 4, y: 8 })
})

test("OpenEXR export supports JS-decodable channel and depth variants with explicit reports", async () => {
  installFixtureDom()
  const source = new ImageData(new Uint8ClampedArray([
    255, 0, 0, 255,
    0, 128, 255, 128,
  ]), 2, 1)

  const grayHalf = encodeOpenExrImageData(source, { channels: "gray", pixelType: "half" })
  const rgbFloat = encodeOpenExrImageData(source, { channels: "rgb", pixelType: "float" })
  const grayDecoded = await decodeAdvancedRasterBufferAsync(grayHalf, "gray.exr")
  const rgbDecoded = await decodeAdvancedRasterBufferAsync(rgbFloat, "rgb.exr")

  expect(grayDecoded?.format).toBe("OpenEXR")
  expect(grayDecoded?.bitDepth).toBe(16)
  expect(grayDecoded?.channels).toBe(1)
  expect(grayDecoded?.metadata?.sourceChannels).toBe("Y")
  expect(rgbDecoded?.channels).toBe(3)
  expect(rgbDecoded?.metadata?.sourceChannels).toBe("R,G,B")
})

test("OpenEXR workflow authors arbitrary channels, tiled/deep metadata, and multipart manifests", () => {
  const width = 2
  const height = 2
  const arbitrary = encodeOpenExrArbitraryChannels({
    width,
    height,
    channels: [
      { name: "beauty.R", data: new Float32Array([1, 0.5, 0.25, 0]) },
      { name: "beauty.G", data: new Float32Array([0, 1, 0.5, 0.25]) },
      { name: "Z", data: new Float32Array([0.1, 0.2, 0.3, 0.4]) },
      { name: "crypto.asset", data: new Float32Array([11, 12, 13, 14]) },
    ],
    tiled: { tileWidth: 1, tileHeight: 1, levelMode: "one-level" },
    deep: { sampleCounts: new Uint32Array([1, 2, 1, 3]) },
    partName: "beauty",
  })
  const multipart = encodeOpenExrMultipart([
    { name: "beauty", buffer: arbitrary },
    { name: "matte", buffer: encodeOpenExrArbitraryChannels({ width: 1, height: 1, channels: [{ name: "A", data: new Float32Array([1]) }] }) },
  ])
  const info = inspectExrHeader(arbitrary)
  const arbitraryText = new TextDecoder("latin1").decode(arbitrary)
  const multipartText = new TextDecoder("latin1").decode(multipart)

  expect(info.channels).toEqual(["beauty.R", "beauty.G", "Z", "crypto.asset"])
  expect(arbitraryText).toContain("tiledimage")
  expect(arbitraryText).toContain("deep-sample-counts")
  expect(arbitraryText).toContain("beauty")
  expect(multipartText).toContain("PSWEB-EXR-MULTIPART")
  expect(multipartText).toContain("beauty")
  expect(multipartText).toContain("matte")
})

test("PSB serialization writes Large Document Format while PSD remains version 1", async () => {
  installFixtureDom()
  const canvas = document.createElement("canvas")
  canvas.width = 2
  canvas.height = 1
  const doc = {
    id: "doc_psb",
    name: "PSB Fixture",
    width: 2,
    height: 1,
    zoom: 1,
    layers: [{
      id: "layer_1",
      name: "Pixels",
      kind: "raster",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      canvas,
    }],
    activeLayerId: "layer_1",
    selectedLayerIds: ["layer_1"],
    background: "#ffffff",
    colorMode: "RGB",
    bitDepth: 8,
    selection: { bounds: null, shape: "rect" },
  } as never

  const psd = new DataView(await (await serializePsd(doc)).arrayBuffer())
  const psb = new DataView(await (await serializePsd(doc, { psb: true })).arrayBuffer())

  expect(psd.getUint16(4, false)).toBe(1)
  expect(psb.getUint16(4, false)).toBe(2)
})

test("PSB strategy reports Photoshop header version, large-document limits, and native-backed import path", async () => {
  const file = new File([photoshopHeader(2, 120000, 90000)], "wall-wrap.psb", {
    type: "image/vnd.adobe.photoshop",
  })

  const report = await inspectAdvancedFormatFile(file)

  expect(report.capability.id).toBe("psb")
  expect(report.capability.support).toBe("native")
  expect(report.capability.supportLabel).toMatch(/Browser-limited/)
  expect(report.technical.join("\n")).toContain("PSB Large Document Format header: version 2")
  expect(report.technical.join("\n")).toContain("120000x90000")
  expect(report.technical.join("\n")).toContain("ag-psd Large Document mode")
})

test("advanced subsystem file readers reject oversized files before loading bytes", async () => {
  const file = {
    name: "oversized.psb",
    type: "image/vnd.adobe.photoshop",
    size: Number.MAX_SAFE_INTEGER,
    arrayBuffer: async () => {
      throw new Error("arrayBuffer should not be called")
    },
  } as unknown as File

  await expect(inspectAdvancedFormatFile(file)).rejects.toThrow(/too large/i)
  await expect(extractMetadataFromFile(file)).rejects.toThrow(/too large/i)
  await expect(extractEmbeddedJpegDataUrl(file)).rejects.toThrow(/too large/i)
  await expect(decodeDicomPreview(file)).rejects.toThrow(/too large/i)
  await expect(decodeRadianceHdrPreview(file)).rejects.toThrow(/too large/i)
})

test("DICOM and HDR previews reject oversized canvas dimensions before allocation", async () => {
  installFixtureDom()
  const dicom = new File([dicomPreviewFixture(1, 8193)], "wide.dcm")
  const hdr = new File([new TextEncoder().encode("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 8193\n")], "wide.hdr")

  await expect(decodeDicomPreview(dicom)).rejects.toThrow(/DICOM preview is too large/i)
  await expect(decodeRadianceHdrPreview(hdr)).rejects.toThrow(/Radiance HDR preview is too large/i)
})

test("advanced capability matrix models TIFF, PDF, EPS, HEIF, and JPEG 2000 without claiming native parity", () => {
  const tiff = capabilityForAdvancedFormat("scan.tiff", "image/tiff") as AdvancedFormatCapabilityWithExport
  const pdf = capabilityForAdvancedFormat("layout.pdf", "application/pdf") as AdvancedFormatCapabilityWithExport
  const eps = capabilityForAdvancedFormat("plate.eps", "application/postscript") as AdvancedFormatCapabilityWithExport
  const heif = capabilityForAdvancedFormat("phone.heic", "image/heic") as AdvancedFormatCapabilityWithExport
  const jp2 = capabilityForAdvancedFormat("archive.jp2", "image/jp2") as AdvancedFormatCapabilityWithExport

  expect(tiff.id).toBe("baseline-tiff")
  expect(tiff.exportPath).toContain("local encoder")
  expect(tiff.exportPath).toContain("BigTIFF")

  expect(pdf.id).toBe("pdf")
  expect(pdf.support).toBe("preview")
  expect(pdf.exportPath).toContain("multi-page PDF")
  expect(pdf.exportPath).toContain("editable text/vector")
  expect(pdf.layerResult).toContain("page")

  expect(eps.id).toBe("eps")
  expect(eps.support).toBe("preview")
  expect(eps.limitations).toContain("PostScript")

  expect(heif.id).toBe("heif")
  expect(heif.support).toBe("preview")
  expect(heif.decodePath).toContain("HEIF/HEIC decoder")
  expect(heif.exportPath).toContain("HEVC-backed HEIC")

  expect(jp2.id).toBe("jpeg2000")
  expect(jp2.support).toBe("preview")
  expect(jp2.decodePath).toContain("JPEG 2000 decoder")
  expect(jp2.exportPath).toContain("JPX")
  expect(jp2.exportPath).toContain("JPM")

  expect(getCapability("format.pdf").status).toBe("approximation")
  expect(getCapability("format.eps").status).toBe("approximation")
  expect(getCapability("format.heif").status).toBe("approximation")
  expect(getCapability("format.jpeg2000").status).toBe("approximation")
})

test("advanced import inspection reports partial advanced decodes with signature evidence", async () => {
  const corruptJp2 = new File([
    new Uint8Array([
      0, 0, 0, 12,
      0x6a, 0x50, 0x20, 0x20,
      0x0d, 0x0a, 0x87, 0x0a,
      0, 0, 0, 8,
      ...ascii("ftyp"),
    ]),
  ], "partial.jp2", { type: "image/jp2" })

  const report = await inspectAdvancedFormatFile(corruptJp2)

  expect(report.capability.id).toBe("jpeg2000")
  expect(report.technical.join("\n")).toContain("JPEG 2000 JP2 signature box detected")
  expect(report.technical.join("\n")).toContain("Partial JPEG 2000 import report")
})

test("advanced raster async decoders fail closed for malformed HEIF and JP2 payloads", async () => {
  const corruptHeif = new Uint8Array([
    ...mp4Box("ftyp", new Uint8Array([...ascii("heic"), 0, 0, 0, 0, ...ascii("heic"), ...ascii("mif1")])),
    ...mp4Box("mdat", new Uint8Array([1, 2, 3, 4, 5, 6])),
  ])
  const corruptJp2 = new Uint8Array([
    0, 0, 0, 12,
    0x6a, 0x50, 0x20, 0x20,
    0x0d, 0x0a, 0x87, 0x0a,
    0, 0, 0, 8,
    ...ascii("ftyp"),
  ])

  await expect(decodeAdvancedRasterBufferAsync(corruptHeif.buffer, "corrupt.heic", "image/heic")).resolves.toBeNull()
  await expect(decodeAdvancedRasterBufferAsync(corruptJp2.buffer, "corrupt.jp2", "image/jp2")).resolves.toBeNull()
})
