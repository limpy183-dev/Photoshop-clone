import { expect, test } from "@playwright/test"

import {
  capabilityForAdvancedFormat,
  decodeDicomPreview,
  decodeEpsPreview,
  encodeDicomImageData,
  encodeEpsCanvas,
  encodePdfCanvas,
  encodeRadianceHdrImageData,
  decodeRadianceHdrPreview,
  extractEmbeddedJpegDataUrl,
  extractMetadataFromFile,
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
  encodeOpenExrImageData,
  encodeTiffImageData,
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

test("PDF and EPS exporters produce importable flattened/vector-subset handoff files", async () => {
  installFixtureDom()
  const canvas = document.createElement("canvas")
  canvas.width = 2
  canvas.height = 1
  canvas.getContext("2d")!.fillRect(0, 0, 2, 1)

  const pdf = await encodePdfCanvas(canvas, "fixture")
  const eps = encodeEpsCanvas(canvas, "fixture")
  const epsPreview = await decodeEpsPreview(new File([eps], "fixture.eps"))

  expect(new TextDecoder("ascii").decode(pdf.slice(0, 8))).toContain("%PDF-")
  expect(new TextDecoder("ascii").decode(eps.slice(0, 64))).toContain("%!PS-Adobe")
  expect(epsPreview?.width).toBe(2)
  expect(epsPreview?.height).toBe(1)
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
  expect(tiff.exportPath).toContain("TIFF encoder")
  expect(tiff.limitations).toContain("BigTIFF")

  expect(pdf.id).toBe("pdf")
  expect(pdf.support).toBe("preview")
  expect(pdf.exportPath).toContain("single-page flattened PDF")
  expect(pdf.layerResult).toContain("first page")

  expect(eps.id).toBe("eps")
  expect(eps.support).toBe("preview")
  expect(eps.limitations).toContain("PostScript")

  expect(heif.id).toBe("heif")
  expect(heif.support).toBe("preview")
  expect(heif.decodePath).toContain("HEIF/HEIC decoder")
  expect(heif.exportPath).toContain("No browser-safe HEIF writer")

  expect(jp2.id).toBe("jpeg2000")
  expect(jp2.support).toBe("preview")
  expect(jp2.decodePath).toContain("JPEG 2000 decoder")
  expect(jp2.exportPath).toContain("No JPEG 2000 writer")

  expect(getCapability("format.pdf").status).toBe("approximation")
  expect(getCapability("format.eps").status).toBe("approximation")
  expect(getCapability("format.heif").status).toBe("approximation")
  expect(getCapability("format.jpeg2000").status).toBe("approximation")
})
