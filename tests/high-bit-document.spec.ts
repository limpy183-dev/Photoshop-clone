import { expect, test } from "@playwright/test"

import { createHighBitImageFromImageData, readHighBitPixel } from "../components/photoshop/color-pipeline"
import {
  getLayerHighBitImage,
  renderDocumentHighBitComposite,
  serializeHighBitImagePayload,
} from "../components/photoshop/high-bit-document"
import { deserializeProject, exportRasterBlob, serializeProject } from "../components/photoshop/document-io"
import type { Layer, PsDocument } from "../components/photoshop/types"
import { installFixtureDom } from "./photoshop-fixtures"

function imageData(width: number, height: number, pixels: number[]) {
  return new ImageData(new Uint8ClampedArray(pixels), width, height)
}

function canvasFromImageData(data: ImageData) {
  installFixtureDom()
  const canvas = document.createElement("canvas")
  canvas.width = data.width
  canvas.height = data.height
  canvas.getContext("2d")!.putImageData(data, 0, 0)
  return canvas
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

function highBitLayer(): Layer {
  const canvas = canvasFromImageData(imageData(2, 1, [
    128, 128, 47, 255,
    128, 128, 47, 255,
  ]))
  const layer: Layer = {
    id: "layer_high",
    name: "High Source",
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas,
  }
  ;(layer as Layer & { __highBitImageData?: ReturnType<typeof createHighBitImageFromImageData> }).__highBitImageData = {
    width: 2,
    height: 1,
    channels: 4,
    bitDepth: 16,
    colorMode: "RGB",
    storage: "uint16",
    data: new Uint16Array([
      32768, 32769, 12000, 65535,
      32769, 32770, 12001, 65535,
    ]),
    warnings: [],
  }
  return layer
}

function highBitDoc(layers: Layer[]): PsDocument {
  return {
    id: "doc_high",
    name: "High Bit",
    width: 2,
    height: 1,
    zoom: 1,
    layers,
    activeLayerId: layers[0].id,
    selectedLayerIds: [layers[0].id],
    background: "#000000",
    colorMode: "RGB",
    bitDepth: 16,
    selection: { bounds: null, shape: "rect" },
  }
}

test("adjustment layers operate on high-bit composites before tone mapping", () => {
  installFixtureDom()
  const layer = highBitLayer()
  const adjustment: Layer = {
    id: "adj",
    name: "Exposure",
    kind: "adjustment",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: canvasFromImageData(imageData(2, 1, [0, 0, 0, 0, 0, 0, 0, 0])),
    adjustment: { type: "exposure", params: { ev: 0.25 } },
  }

  const composite = renderDocumentHighBitComposite(highBitDoc([layer, adjustment]))

  expect(composite).not.toBeNull()
  expect(composite!.image.storage).toBe("uint16")
  expect(composite!.image.data[0]).toBeGreaterThan(32768)
  expect(composite!.image.data[1] - composite!.image.data[0]).toBeGreaterThanOrEqual(1)
  expect(composite!.toneMapped.data[0]).toBeGreaterThan(128)
})

test("project serialization round-trips high-bit layer payloads as editable source data", async () => {
  installFixtureDom()
  const doc = highBitDoc([highBitLayer()])
  const serialized = serializeProject(doc)

  expect(serialized).toContain("highBitImageData")
  expect(serialized).toContain("uint16")

  const restored = await deserializeProject(serialized)
  const restoredSource = getLayerHighBitImage(restored.layers[0], restored)

  expect(restoredSource?.storage).toBe("uint16")
  expect(readHighBitPixel(restoredSource!, 0, 0)?.r).toBe(32768)
})

test("high-bit raster export uses typed-array precision for TIFF when available", async () => {
  installFixtureDom()
  const blob = await exportRasterBlob(highBitDoc([highBitLayer()]), {
    format: "tiff",
    scale: 1,
    quality: 0.92,
    transparent: true,
    matte: "#000000",
    tiffCompression: "none",
  })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer)
  const bitsOffset = readTiffTagValue(bytes, 258)

  expect(blob.type).toBe("image/tiff")
  expect(view.getUint16(bitsOffset, true)).toBe(16)
  expect(bytes.includes(0x80)).toBe(true)
})

test("high-bit payload serializer emits compact binary metadata", () => {
  installFixtureDom()
  const payload = serializeHighBitImagePayload(createHighBitImageFromImageData(
    imageData(1, 1, [10, 20, 30, 255]),
    { bitDepth: 16, colorMode: "RGB" },
  ))

  expect(payload?.encoding).toBe("base64")
  expect(payload?.storage).toBe("uint16")
  expect(payload?.data.length).toBeGreaterThan(8)
})
