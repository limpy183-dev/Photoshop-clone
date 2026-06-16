import { expect, test } from "@playwright/test"

import {
  alphaBounds,
  cloneCanvas,
  cloneLayerIntoDocument,
  duplicateDocumentDeep,
} from "../components/photoshop/editor-document-cloning"
import type { AlphaChannel, Layer, PsDocument } from "../components/photoshop/types"
import { fixtureMask, installFixtureDom } from "./photoshop-fixtures"

function rgbaCanvas(width: number, height: number, pixels: number[]) {
  installFixtureDom()
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0)
  return canvas
}

function transparentCanvas(width: number, height: number, opaquePoints: Array<{ x: number; y: number }> = []) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (const point of opaquePoints) {
    const i = (point.y * width + point.x) * 4
    pixels[i] = 12
    pixels[i + 1] = 34
    pixels[i + 2] = 56
    pixels[i + 3] = 255
  }
  return rgbaCanvas(width, height, Array.from(pixels))
}

function pixels(canvas: HTMLCanvasElement) {
  return Array.from(canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data)
}

function rasterLayer(id: string, canvas: HTMLCanvasElement): Layer {
  return {
    id,
    name: id,
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    fillOpacity: 1,
    blendMode: "normal",
    canvas,
  }
}

function documentWithLayers(layers: Layer[], channels: AlphaChannel[] = []): PsDocument {
  return {
    id: "doc_original",
    name: "Original copy 2",
    width: 10,
    height: 8,
    zoom: 1,
    layers,
    activeLayerId: layers.at(-1)?.id ?? "",
    selectedLayerIds: layers.map((layer) => layer.id),
    background: "#ffffff",
    colorMode: "RGB",
    bitDepth: 8,
    selection: {
      bounds: { x: 1, y: 1, w: 2, h: 2 },
      shape: "rect",
      mask: fixtureMask(10, 8),
    },
    channels,
    metadata: { title: "Original", createdAt: "2026-06-16T00:00:00.000Z" },
    smartObjectParent: { docId: "parent_doc", layerId: "parent_layer" },
  }
}

test.beforeEach(() => {
  installFixtureDom()
})

test.afterEach(() => {
  Reflect.deleteProperty(globalThis, "document")
})

test("cloneCanvas copies pixels into a distinct canvas", () => {
  const source = rgbaCanvas(2, 1, [
    240, 10, 20, 255,
    30, 40, 50, 128,
  ])

  const cloned = cloneCanvas(source)

  expect(cloned).toBeTruthy()
  expect(cloned).not.toBe(source)
  expect(pixels(cloned!)).toEqual(pixels(source))

  cloned!.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray([
    1, 2, 3, 4,
    5, 6, 7, 8,
  ]), 2, 1), 0, 0)
  expect(pixels(source)).toEqual([
    240, 10, 20, 255,
    30, 40, 50, 128,
  ])
})

test("alphaBounds reports only non-transparent pixels", () => {
  expect(alphaBounds(transparentCanvas(4, 3))).toBeNull()
  expect(alphaBounds(transparentCanvas(4, 3, [{ x: 1, y: 1 }, { x: 3, y: 2 }]))).toEqual({
    x: 1,
    y: 1,
    w: 3,
    h: 2,
  })
})

test("cloneLayerIntoDocument recenters copied layer content and clears document-local identity", () => {
  const source = rasterLayer("layer_source", transparentCanvas(10, 8, [{ x: 1, y: 2 }]))
  source.locked = true
  source.lockAll = true
  source.parentId = "group_old"
  source.childIds = ["child_old"]
  source.linkGroupId = "link_old"
  source.mask = fixtureMask(10, 8)
  source.text = {
    content: "Copy",
    font: "Arial",
    size: 16,
    weight: "normal",
    italic: false,
    color: "#111111",
    align: "left",
    x: 4,
    y: 5,
  }
  source.path = { points: [{ x: 2, y: 3 }], closed: false }
  source.vectorMask = { points: [{ x: 6, y: 7 }], closed: true }
  source.smartFilters = [{
    id: "sf",
    filterId: "box-blur",
    name: "Box Blur",
    enabled: true,
    params: { radius: 4 },
    mask: fixtureMask(10, 8),
  }]

  const cloned = cloneLayerIntoDocument(source, 20, 18, 10, 8)

  expect(cloned.id).not.toBe(source.id)
  expect(cloned.name).toBe("layer_source copy")
  expect(cloned.locked).toBe(false)
  expect(cloned.lockAll).toBe(false)
  expect(cloned.parentId).toBeUndefined()
  expect(cloned.childIds).toBeUndefined()
  expect(cloned.linkGroupId).toBeUndefined()
  expect(cloned.canvas).not.toBe(source.canvas)
  expect(cloned.canvas).toMatchObject({ width: 20, height: 18 })
  expect(cloned.mask).toMatchObject({ width: 20, height: 18 })
  expect(cloned.text).toMatchObject({ x: 13, y: 12 })
  expect(cloned.path?.points[0]).toMatchObject({ x: 11, y: 10 })
  expect(cloned.vectorMask?.points[0]).toMatchObject({ x: 15, y: 14 })
  expect(cloned.smartFilters?.[0].mask).toMatchObject({ width: 20, height: 18 })
  expect(cloned.smartFilters?.[0].params).toEqual({ radius: 4 })
  expect(cloned.smartFilters?.[0].params).not.toBe(source.smartFilters?.[0].params)
})

test("duplicateDocumentDeep rekeys document-owned identifiers and deep clones editable metadata", () => {
  const parent = rasterLayer("parent", transparentCanvas(10, 8, [{ x: 0, y: 0 }]))
  const child = rasterLayer("child", transparentCanvas(10, 8, [{ x: 2, y: 2 }]))
  parent.childIds = [child.id]
  child.parentId = parent.id
  const channel: AlphaChannel = {
    id: "alpha_original",
    name: "Saved Selection",
    kind: "spot",
    spotColor: "#ff0000",
    spotOpacity: 50,
    canvas: fixtureMask(10, 8),
  }
  const doc = documentWithLayers([parent, child], [channel])

  const duplicated = duplicateDocumentDeep(doc)

  expect(duplicated.id).not.toBe(doc.id)
  expect(duplicated.name).toBe("Original copy")
  expect(duplicated.smartObjectParent).toBeUndefined()
  expect(duplicated.layers).toHaveLength(2)
  expect(duplicated.layers.map((layer) => layer.id)).not.toContain(parent.id)
  expect(duplicated.layers.map((layer) => layer.id)).not.toContain(child.id)
  expect(duplicated.activeLayerId).toBe(duplicated.layers[1].id)
  expect(duplicated.selectedLayerIds).toEqual(duplicated.layers.map((layer) => layer.id))
  expect(duplicated.layers[0].childIds).toEqual([duplicated.layers[1].id])
  expect(duplicated.layers[1].parentId).toBe(duplicated.layers[0].id)
  expect(duplicated.channels?.[0].id).not.toBe(channel.id)
  expect(duplicated.channels?.[0].canvas).not.toBe(channel.canvas)
  expect(duplicated.selection.mask).not.toBe(doc.selection.mask)
  expect(duplicated.metadata).toMatchObject({ title: "Original copy" })

  duplicated.metadata!.title = "Changed"
  expect(doc.metadata?.title).toBe("Original")
})
