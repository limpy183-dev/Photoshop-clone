import { expect, test } from "@playwright/test"

import {
  xmpPacketFromRasterMetadata,
  decodeTiffBuffer,
  encodeTiffImageDataAsync,
  injectAvifXmpMetadata,
  injectWebpXmpMetadata,
} from "../components/photoshop/raster-codecs"
import { buildRasterExportMetadata, createExportLimitationReport, diagnoseBrowserRasterEncoderSupport, type ExportFormat } from "../components/photoshop/document-io"
import { alternativesForLimitation } from "../components/photoshop/export-alternatives"
import { createEmbeddedFontFromBuffer } from "../components/photoshop/typography-engine"
import { createStoredZipBlob, encodeStoredZip } from "../components/photoshop/zip-packaging"
import { runBatchExportItems } from "../components/photoshop/batch-export-engine"
import {
  deleteExportPresetAsset,
  duplicateExportPresetAsset,
  parseExportPresetLibrary,
  serializeExportPresetLibrary,
  upsertExportPresetAsset,
} from "../components/photoshop/export-presets"
import { installFixtureDom, richFixtureDocument } from "./photoshop-fixtures"

function ascii(value: string) {
  return new Uint8Array(Array.from(value, (ch) => ch.charCodeAt(0)))
}

function concat(parts: readonly Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function be32(value: number) {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value, false)
  return out
}

function le32(value: number) {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value, true)
  return out
}

function riffChunk(type: string, data: Uint8Array) {
  return concat([ascii(type), le32(data.length), data, data.length % 2 ? new Uint8Array([0]) : new Uint8Array()])
}

function fakeWebpBytes() {
  const vp8x = new Uint8Array(10)
  vp8x[4] = 1
  vp8x[7] = 1
  const body = concat([ascii("WEBP"), riffChunk("VP8X", vp8x), riffChunk("VP8 ", new Uint8Array([1, 2, 3, 4]))])
  return concat([ascii("RIFF"), le32(body.length), body])
}

function mp4Box(type: string, data: Uint8Array) {
  return concat([be32(data.length + 8), ascii(type), data])
}

function fakeAvifBytes() {
  return concat([
    mp4Box("ftyp", concat([ascii("avif"), new Uint8Array([0, 0, 0, 0]), ascii("avif"), ascii("mif1")])),
    mp4Box("mdat", new Uint8Array([1, 2, 3, 4])),
  ])
}

function tiffTagData(buffer: ArrayBuffer, tag: number) {
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

test("TIFF export embeds baseline text tags and XMP metadata while remaining decodable", async () => {
  installFixtureDom()
  const image = new ImageData(new Uint8ClampedArray([
    12, 34, 56, 255,
    90, 80, 70, 128,
  ]), 2, 1)

  const tiff = await encodeTiffImageDataAsync(image, {
    compression: "none",
    metadata: {
      author: "Ada",
      copyright: "CC0",
      description: "TIFF metadata fixture",
      creationDate: "2026-05-25T10:00:00.000Z",
    },
  })
  const decoded = decodeTiffBuffer(tiff)
  const description = new TextDecoder("ascii").decode(tiffTagData(tiff, 270) ?? new Uint8Array())
  const artist = new TextDecoder("ascii").decode(tiffTagData(tiff, 315) ?? new Uint8Array())
  const xmp = new TextDecoder().decode(tiffTagData(tiff, 700) ?? new Uint8Array())

  expect(decoded.width).toBe(2)
  expect(Array.from(decoded.imageData.data.slice(0, 8))).toEqual(Array.from(image.data))
  expect(description).toContain("TIFF metadata fixture")
  expect(artist).toContain("Ada")
  expect(xmp).toContain("<x:xmpmeta")
  expect(xmp).toContain("TIFF metadata fixture")
})

test("WebP and AVIF metadata injectors add XMP payloads to valid browser encoder outputs", () => {
  const metadata = {
    author: "Ada",
    copyright: "CC0",
    description: "RIFF and ISOBMFF metadata",
    creationDate: "2026-05-25T10:00:00.000Z",
  }

  const webp = injectWebpXmpMetadata(fakeWebpBytes(), metadata)
  const avif = injectAvifXmpMetadata(fakeAvifBytes(), metadata)
  const webpText = new TextDecoder("latin1").decode(webp)
  const avifText = new TextDecoder("latin1").decode(avif)

  expect(new DataView(webp.buffer, webp.byteOffset + 4, 4).getUint32(0, true)).toBe(webp.byteLength - 8)
  expect(webpText).toContain("XMP ")
  expect(webpText).toContain("RIFF and ISOBMFF metadata")
  expect(webp[20] & 0x04).toBe(0x04)
  expect(avifText).toContain("uuid")
  expect(avifText).toContain("<x:xmpmeta")
  expect(avifText).toContain("Ada")
})

test("raster export metadata carries embedded local fonts into XMP payloads", () => {
  const doc = richFixtureDocument()
  const font = createEmbeddedFontFromBuffer(
    "Fixture Sans",
    "fixture-sans.ttf",
    new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0]).buffer,
    "font/ttf",
  )
  doc.layers[1].text = { ...doc.layers[1].text!, font: "Fixture Sans", embeddedFont: font }
  doc.assetLibrary = [
    ...(doc.assetLibrary ?? []),
    { id: "asset_font_fixture", name: "Fixture Sans", kind: "font", group: "Local Fonts", payload: font, createdAt: 1_800_000_000_002 },
  ]

  const metadata = buildRasterExportMetadata(doc, {
    format: "png",
    scale: 1,
    quality: 0.92,
    transparent: true,
    matte: "#ffffff",
    includeMetadata: true,
  })
  const xmp = xmpPacketFromRasterMetadata(metadata)

  expect(metadata?.fonts?.map((entry) => entry.family)).toEqual(["Fixture Sans"])
  expect(xmp).toContain("psweb:EmbeddedFonts")
  expect(xmp).toContain(font.dataBase64)
})

test("raster export metadata carries advanced encoder control surfaces", () => {
  const doc = richFixtureDocument()

  const webpMetadata = buildRasterExportMetadata(doc, {
    format: "webp",
    scale: 1,
    quality: 0.72,
    transparent: true,
    matte: "#ffffff",
    includeMetadata: true,
    webpLossless: false,
    webpNearLossless: 82,
    webpMethod: 6,
    webpExactAlpha: false,
    webpAlphaQuality: 73,
    webpAlphaFilter: "best",
  })
  const webpXmp = xmpPacketFromRasterMetadata(webpMetadata)

  expect(webpMetadata?.webp).toMatchObject({
    quality: 0.72,
    nearLossless: 82,
    method: 6,
    exactAlpha: false,
    alphaQuality: 73,
    alphaFilter: "best",
  })
  expect(webpXmp).toContain("alphaQuality")
  expect(webpXmp).toContain("best")

  const pnmMetadata = buildRasterExportMetadata(doc, {
    format: "ppm",
    scale: 1,
    quality: 1,
    transparent: true,
    matte: "#ffffff",
    includeMetadata: true,
    netpbmComments: ["Scanner source max retained"],
    netpbmSourceMaxValue: 1023,
  })

  expect(pnmMetadata?.netpbm).toEqual({
    comments: ["Scanner source max retained"],
    sourceMaxValue: 1023,
  })
})

test("raster export reports metadata, content credentials, and ICC embedding as authored for supported formats", () => {
  const base = richFixtureDocument()
  const doc = {
    ...base,
    metadata: {
      ...base.metadata,
      contentCredentials: [{
        id: "cred_report",
        action: "local-edit",
        actor: "Ada",
        software: "Photoshop Web",
        createdAt: "2026-05-25T10:00:00.000Z",
        documentName: "report.psproj",
        documentHash: "abc123",
        layerCount: 1,
        dimensions: { width: 64, height: 48 },
        ingredients: [],
        assertion: "Edited locally",
      }],
    },
  }

  for (const format of ["tiff", "webp", "avif", "tga", "ppm"] as const) {
    const report = createExportLimitationReport(doc, { format, includeMetadata: true, quality: 92 })
    const unsupportedMetadata = report.items.filter((item) =>
      (item.label.includes("Metadata") || item.label.includes("ICC") || item.label.includes("Content Credentials")) &&
      item.status === "unsupported"
    )

    expect(unsupportedMetadata, `${format} should not report metadata/ICC as unsupported`).toEqual([])
    const credentials = report.items.find((item) => item.label === "Content Credentials")
    expect(credentials?.status).toBe("preserved")
    expect(credentials?.detail).toContain("C2PA")
  }
})

test("every problematic export limitation has at least one one-click alternative", () => {
  const doc = richFixtureDocument()
  const formats: ExportFormat[] = [
    "png",
    "tiff",
    "jpeg",
    "webp",
    "gif",
    "avif",
    "svg",
    "tga",
    "ppm",
    "pgm",
    "pbm",
    "apng",
    "animated-webp",
  ]
  const problematic = new Set(["flattened", "approximated", "unsupported"])
  const missing: string[] = []

  for (const format of formats) {
    const report = createExportLimitationReport(doc, {
      format,
      includeMetadata: true,
      interlaced: true,
      progressive: true,
      transparent: true,
      quality: 55,
    })
    for (const item of report.items) {
      if (!problematic.has(item.status)) continue
      const alternatives = alternativesForLimitation(format, item)
      if (!alternatives.length) missing.push(`${format}:${item.status}:${item.label}`)
    }
  }

  expect(missing).toEqual([])
})

test("browser encoder diagnostics detect WebP support and AVIF MIME fallback", async () => {
  const makeCanvas = (returnedType: string | null) => ({
    width: 1,
    height: 1,
    toBlob: (callback: BlobCallback, type?: string) => {
      callback(returnedType === null ? null : new Blob([new Uint8Array([1])], { type: returnedType || type }))
    },
  }) as HTMLCanvasElement

  const webp = await diagnoseBrowserRasterEncoderSupport("webp", {
    createCanvas: () => makeCanvas("image/webp"),
  })
  const avif = await diagnoseBrowserRasterEncoderSupport("avif", {
    createCanvas: () => makeCanvas("image/png"),
  })
  const nullBlob = await diagnoseBrowserRasterEncoderSupport("avif", {
    createCanvas: () => makeCanvas(null),
  })

  expect(webp.supported).toBe(true)
  expect(webp.returnedMime).toBe("image/webp")
  expect(avif.supported).toBe(false)
  expect(avif.message).toContain("returned image/png")
  expect(nullBlob.supported).toBe(false)
  expect(nullBlob.message).toContain("returned no blob")
})

test("stored ZIP packaging is shared and produces central directory records", async () => {
  const entries = [
    { name: "frames/frame-01.txt", data: ascii("alpha") },
    { name: "frames/frame-02.txt", data: ascii("beta") },
  ]
  const zip = encodeStoredZip(entries)
  const blob = createStoredZipBlob(entries)
  const text = new TextDecoder("latin1").decode(zip)

  expect(zip[0]).toBe(0x50)
  expect(zip[1]).toBe(0x4b)
  expect(text).toContain("frames/frame-01.txt")
  expect(text).toContain("frames/frame-02.txt")
  expect(text).toContain("PK\u0005\u0006")
  expect(blob.type).toBe("application/zip")
  await expect(blob.arrayBuffer()).resolves.toHaveProperty("byteLength", zip.byteLength)
})

test("batch export runner reports progress, recovers per-item failures, and cancels cleanly", async () => {
  const progress: string[] = []
  const recovered = await runBatchExportItems(
    [{ name: "a.png" }, { name: "b.png" }, { name: "c.png" }],
    {
      continueOnError: true,
      encode: async (item) => {
        if (item.name === "b.png") throw new Error("encoder failed")
        return new Blob([ascii(item.name)], { type: "image/png" })
      },
      onProgress: (event) => progress.push(`${event.completed}/${event.total}:${event.currentName ?? ""}`),
    },
  )

  const controller = new AbortController()
  const canceled = await runBatchExportItems(
    [{ name: "one.png" }, { name: "two.png" }, { name: "three.png" }],
    {
      signal: controller.signal,
      continueOnError: true,
      encode: async (item) => new Blob([ascii(item.name)], { type: "image/png" }),
      onProgress: (event) => {
        if (event.completed === 1) controller.abort()
      },
    },
  )

  expect(recovered.completed).toBe(2)
  expect(recovered.failed).toHaveLength(1)
  expect(recovered.failed[0]).toMatchObject({ name: "b.png", error: "encoder failed" })
  expect(recovered.entries.map((entry) => entry.name)).toEqual(["a.png", "c.png"])
  expect(progress.some((entry) => entry.startsWith("2/3"))).toBe(true)
  expect(canceled.canceled).toBe(true)
  expect(canceled.completed).toBe(1)
  expect(canceled.entries.map((entry) => entry.name)).toEqual(["one.png"])
})

test("export preset helpers update, duplicate, serialize, import, and delete presets", () => {
  const first = upsertExportPresetAsset([], {
    name: "PNG retina",
    payload: { dialog: "export-as", format: "png", scale: 200, quality: 92 },
  }, { idFactory: () => "preset-a", now: () => 1 })

  const updated = upsertExportPresetAsset(first, {
    id: "preset-a",
    name: "PNG retina tuned",
    payload: { dialog: "export-as", format: "png", scale: 200, quality: 80 },
  }, { idFactory: () => "unused", now: () => 2 })
  const duplicated = duplicateExportPresetAsset(updated, "preset-a", { idFactory: () => "preset-copy", now: () => 3 })
  const serialized = serializeExportPresetLibrary(duplicated)
  const parsed = parseExportPresetLibrary(serialized, { idFactory: () => "imported", now: () => 4 })
  const deleted = deleteExportPresetAsset(parsed, "preset-a")

  expect(updated).toHaveLength(1)
  expect(updated[0]).toMatchObject({ id: "preset-a", name: "PNG retina tuned" })
  expect(duplicated.map((asset) => asset.name)).toEqual(["PNG retina tuned Copy", "PNG retina tuned"])
  expect(parsed).toHaveLength(2)
  expect(parsed.every((asset) => asset.kind === "export")).toBe(true)
  expect(deleted.map((asset) => asset.id)).toEqual(["preset-copy"])
})
