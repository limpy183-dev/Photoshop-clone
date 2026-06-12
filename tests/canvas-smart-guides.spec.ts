import { expect, test } from "@playwright/test"

import {
  alphaBoundsForCanvas,
  alphaBoundsForLayer,
  smartGuideLinesForBounds,
  smartSnapLayerDelta,
} from "../components/photoshop/canvas-smart-guides"
import type { Guide, Layer, PsDocument } from "../components/photoshop/types"

function alphaCanvas(
  width: number,
  height: number,
  points: Array<[number, number]>,
  alpha = 255,
): HTMLCanvasElement {
  const data = new Uint8ClampedArray(width * height * 4)
  for (const [x, y] of points) data[(y * width + x) * 4 + 3] = alpha
  return {
    width,
    height,
    getContext: () => ({
      getImageData: () => ({ data, width, height }),
    }),
  } as unknown as HTMLCanvasElement
}

function opaqueCanvas(width: number, height: number) {
  const points: Array<[number, number]> = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) points.push([x, y])
  }
  return alphaCanvas(width, height, points)
}

function rasterLayer(id: string, canvas: HTMLCanvasElement, overrides: Partial<Layer> = {}): Layer {
  return {
    id,
    name: id,
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas,
    ...overrides,
  } as Layer
}

function snapDocument(overrides: Partial<PsDocument>): PsDocument {
  return {
    id: "doc-1",
    name: "Snap",
    width: 100,
    height: 80,
    zoom: 1,
    pan: { x: 0, y: 0 },
    layers: [],
    activeLayerId: "moving",
    selection: { bounds: null, shape: "rect" },
    snap: true,
    ...overrides,
  } as PsDocument
}

test("alpha bounds retain threshold, inclusive dimensions, and empty behavior", () => {
  const canvas = alphaCanvas(5, 4, [[1, 1], [3, 2]])
  expect(alphaBoundsForCanvas(canvas)).toEqual({ x: 1, y: 1, w: 3, h: 2 })
  expect(alphaBoundsForCanvas(alphaCanvas(5, 4, []))).toBeNull()
  expect(alphaBoundsForCanvas(alphaCanvas(5, 4, [[2, 2]], 8))).toBeNull()
  expect(alphaBoundsForCanvas({ width: 0, height: 4, getContext: () => null } as unknown as HTMLCanvasElement)).toBeNull()
  expect(alphaBoundsForCanvas(null)).toBeNull()

  const layer = rasterLayer("layer", canvas)
  expect(alphaBoundsForLayer(layer)).toEqual({ x: 1, y: 1, w: 3, h: 2 })
})

test("smart snapping retains disabled, guide threshold, and grid scoring behavior", () => {
  const snapshot = opaqueCanvas(10, 10)
  const movingLayer = rasterLayer("moving", snapshot)

  expect(smartSnapLayerDelta(snapDocument({ snap: false }), movingLayer, snapshot, 5, 7)).toEqual({
    dx: 5,
    dy: 7,
  })

  const guides: Guide[] = [
    { id: "v", orientation: "vertical", position: 20 },
    { id: "h", orientation: "horizontal", position: 30 },
  ]
  const guideDoc = snapDocument({
    guides,
    snapToGuides: true,
    snapToGrid: false,
    showSmartGuides: false,
  })
  expect(smartSnapLayerDelta(guideDoc, movingLayer, snapshot, 5, 15)).toEqual({
    dx: 10,
    dy: 20,
  })
  expect(smartSnapLayerDelta(guideDoc, movingLayer, snapshot, 3, 13)).toEqual({
    dx: 3,
    dy: 13,
  })

  const gridDoc = snapDocument({
    snapToGuides: false,
    snapToGrid: true,
    gridSize: 10,
    showSmartGuides: false,
  })
  expect(smartSnapLayerDelta(gridDoc, movingLayer, snapshot, 4, 4)).toEqual({
    dx: 5,
    dy: 5,
  })
})

test("smart guide line collection retains alignment and deduplication behavior", () => {
  const active = rasterLayer("active", opaqueCanvas(10, 10))
  expect(smartGuideLinesForBounds({
    layers: [active],
    activeLayerId: "active",
    docW: 100,
    docH: 80,
    activeBounds: { x: 0, y: 0, w: 10, h: 10 },
  })).toEqual({
    horizontal: [0],
    vertical: [0],
  })

  expect(smartGuideLinesForBounds({
    layers: [active],
    activeLayerId: "active",
    docW: 100,
    docH: 80,
    activeBounds: { x: 20, y: 20, w: 10, h: 10 },
  })).toEqual({
    horizontal: [],
    vertical: [],
  })
})
