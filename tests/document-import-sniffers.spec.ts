import { expect, test } from "@playwright/test"

import {
  readPsdHeaderDimensions,
  sniffRasterDimensions,
} from "../components/photoshop/document-import-sniffers"

function ascii(value: string) {
  return Array.from(value, (ch) => ch.charCodeAt(0))
}

function be16(value: number) {
  return [(value >> 8) & 255, value & 255]
}

function be32(value: number) {
  return [(value >> 24) & 255, (value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function le16(value: number) {
  return [value & 255, (value >> 8) & 255]
}

function le24(value: number) {
  return [value & 255, (value >> 8) & 255, (value >> 16) & 255]
}

function le32(value: number) {
  return [value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255]
}

function psdHeader(version: 1 | 2, width: number, height: number) {
  return new Uint8Array([
    ...ascii("8BPS"),
    ...be16(version),
    0, 0, 0, 0, 0, 0,
    ...be16(4),
    ...be32(height),
    ...be32(width),
    ...be16(8),
    ...be16(3),
  ])
}

function pngHeader(width: number, height: number) {
  return new Uint8Array([
    0x89, ...ascii("PNG\r\n\u001a\n"),
    0, 0, 0, 13,
    ...ascii("IHDR"),
    ...be32(width),
    ...be32(height),
    8, 6, 0, 0, 0,
    0, 0, 0, 0,
  ])
}

function gifHeader(width: number, height: number) {
  return new Uint8Array([
    ...ascii("GIF89a"),
    ...le16(width),
    ...le16(height),
    0, 0, 0,
  ])
}

function jpegHeader(width: number, height: number) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0,
    0, 4,
    0x11, 0x22,
    0xff, 0xc0,
    0, 8,
    8,
    ...be16(height),
    ...be16(width),
    3,
  ])
}

function webpVp8xHeader(width: number, height: number) {
  return new Uint8Array([
    ...ascii("RIFF"),
    ...le32(30),
    ...ascii("WEBP"),
    ...ascii("VP8X"),
    ...le32(10),
    0, 0, 0, 0,
    ...le24(width - 1),
    ...le24(height - 1),
  ])
}

function bmpHeader(width: number, height: number) {
  return new Uint8Array([
    ...ascii("BM"),
    0, 0, 0, 0,
    0, 0,
    0, 0,
    0, 0, 0, 0,
    ...le32(40),
    ...le32(width),
    ...le32(height >>> 0),
  ])
}

function isoBmffHeader(width: number, height: number) {
  return new Uint8Array([
    ...be32(16),
    ...ascii("ftyp"),
    ...ascii("avif"),
    0, 0, 0, 0,
    ...be32(20),
    ...ascii("ispe"),
    0, 0, 0, 0,
    ...be32(width),
    ...be32(height),
  ])
}

test("reads PSD and PSB header dimensions", () => {
  expect(readPsdHeaderDimensions(psdHeader(1, 6400, 4200).buffer)).toEqual({
    width: 6400,
    height: 4200,
    format: "PSD",
    version: 1,
  })
  expect(readPsdHeaderDimensions(psdHeader(2, 16000, 12000).buffer)).toEqual({
    width: 16000,
    height: 12000,
    format: "PSB",
    version: 2,
  })
})

test("rejects invalid PSD headers", () => {
  expect(readPsdHeaderDimensions(new Uint8Array([0x38, 0x42]).buffer)).toBeNull()
  const invalidVersion = psdHeader(1, 100, 100)
  invalidVersion[5] = 3
  expect(readPsdHeaderDimensions(invalidVersion.buffer)).toBeNull()
})

for (const fixture of [
  { format: "PNG", width: 3200, height: 1800, bytes: pngHeader(3200, 1800) },
  { format: "GIF", width: 640, height: 480, bytes: gifHeader(640, 480) },
  { format: "JPEG", width: 2048, height: 1536, bytes: jpegHeader(2048, 1536) },
  { format: "WEBP", width: 4096, height: 2160, bytes: webpVp8xHeader(4096, 2160) },
  { format: "BMP", width: 1024, height: 768, bytes: bmpHeader(1024, -768) },
  { format: "ISO-BMFF", width: 3840, height: 2160, bytes: isoBmffHeader(3840, 2160) },
]) {
  test(`sniffs ${fixture.format} raster dimensions`, () => {
    expect(sniffRasterDimensions(fixture.bytes)).toMatchObject({
      width: fixture.width,
      height: fixture.height,
      format: fixture.format,
    })
  })
}

test("returns null for unknown or truncated raster headers", () => {
  expect(sniffRasterDimensions(new Uint8Array([1, 2, 3, 4]))).toBeNull()
  expect(sniffRasterDimensions(pngHeader(400, 300).slice(0, 12))).toBeNull()
})
