import { expect, test } from "@playwright/test"

import {
  capabilityForAdvancedFormat,
  decodeDicomPreview,
  decodeRadianceHdrPreview,
  extractEmbeddedJpegDataUrl,
  extractMetadataFromFile,
  inspectAdvancedFormatFile,
} from "../components/photoshop/advanced-subsystems"
import { getCapability } from "../components/photoshop/capabilities"
import {
  decodeAdvancedRasterBuffer,
  decodePnmBuffer,
  decodeTgaBuffer,
  decodeTiffBuffer,
  inspectExrHeader,
} from "../components/photoshop/raster-codecs"
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

test("advanced raster dispatcher covers local non-browser formats and keeps unsupported EXR honest", () => {
  const tiff = decodeAdvancedRasterBuffer(makeBaselineRgbTiff(), "fixture.tif")
  expect(tiff?.format).toBe("TIFF")

  const exr = new Uint8Array([0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0]).buffer
  const info = inspectExrHeader(exr)

  expect(info.magic).toBe(true)
  expect(info.pixelDecoded).toBe(false)
  expect(info.warnings.join(" ")).toContain("dedicated OpenEXR codec")
})

test("PSB strategy reports Photoshop header version, large-document limits, and metadata-only import", async () => {
  const file = new File([photoshopHeader(2, 120000, 90000)], "wall-wrap.psb", {
    type: "image/vnd.adobe.photoshop",
  })

  const report = await inspectAdvancedFormatFile(file)

  expect(report.capability.id).toBe("psb")
  expect(report.capability.support).toBe("metadata")
  expect(report.capability.supportLabel).toMatch(/Metadata only/)
  expect(report.technical.join("\n")).toContain("PSB Large Document Format header: version 2")
  expect(report.technical.join("\n")).toContain("120000x90000")
  expect(report.technical.join("\n")).toContain("layer/resource payload is not decoded")
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
  expect(tiff.exportPath).toContain("flattened RGB/RGBA preview")
  expect(tiff.limitations).toContain("BigTIFF")

  expect(pdf.id).toBe("pdf")
  expect(pdf.support).toBe("metadata")
  expect(pdf.exportPath).toContain("composite preview")
  expect(pdf.layerResult).toContain("Does not create editable PDF vectors")

  expect(eps.id).toBe("eps")
  expect(eps.support).toBe("metadata")
  expect(eps.limitations).toContain("PostScript")

  expect(heif.id).toBe("heif")
  expect(heif.support).toBe("metadata")
  expect(heif.decodePath).toContain("No HEIF/HEIC decoder")
  expect(heif.exportPath).toContain("Unsupported")

  expect(jp2.id).toBe("jpeg2000")
  expect(jp2.support).toBe("metadata")
  expect(jp2.decodePath).toContain("No JPEG 2000 decoder")
  expect(jp2.exportPath).toContain("Unsupported")

  expect(getCapability("format.pdf").status).toBe("approximation")
  expect(getCapability("format.eps").status).toBe("unsupported")
  expect(getCapability("format.heif").status).toBe("unsupported")
  expect(getCapability("format.jpeg2000").status).toBe("unsupported")
})
