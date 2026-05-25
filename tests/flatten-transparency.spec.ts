import { expect, test } from "@playwright/test"

import { reducer } from "../components/photoshop/editor-context"
import type { Layer, PsDocument } from "../components/photoshop/types"
import { installFixtureDom } from "./photoshop-fixtures"

function rgbaCanvas(width: number, height: number, pixels: number[]) {
  installFixtureDom()
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0)
  return canvas
}

function pixels(canvas: HTMLCanvasElement) {
  return Array.from(canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data)
}

function stateWithLayer(layer: Layer) {
  const doc: PsDocument = {
    id: "doc_flatten_transparency",
    name: "Flatten Transparency",
    width: layer.canvas.width,
    height: layer.canvas.height,
    zoom: 1,
    layers: [layer],
    activeLayerId: layer.id,
    selectedLayerIds: [layer.id],
    background: "#ffffff",
    colorMode: "RGB",
    bitDepth: 8,
    selection: { bounds: null, shape: "rect" },
  }
  return {
    documents: [doc],
    activeDocId: doc.id,
    tool: "move",
    foreground: "#000000",
    background: "#ffffff",
    histories: {},
    snapshots: {},
    closedDocuments: [],
    documentLifecycle: {},
    clipboard: null,
    styleClipboard: null,
    brush: {},
    gradient: {},
    paintBucket: {},
    eraser: {},
    cloneSource: {},
    symmetry: {},
    selectionOptions: {},
    transform: null,
    brushPresets: [],
    actions: [],
    recordingActionId: null,
    isPlayingAction: false,
    activeSmartFilterMaskTarget: null,
  }
}

function rasterLayer(canvas: HTMLCanvasElement): Layer {
  return {
    id: "layer_alpha",
    name: "Alpha Edge",
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    fillOpacity: 1,
    blendMode: "normal",
    canvas,
  }
}

test("flatten-transparency clears selected layer alpha against the command matte", () => {
  const source = rgbaCanvas(2, 1, [
    200, 100, 0, 128,
    20, 40, 80, 0,
  ])

  const next = reducer(stateWithLayer(rasterLayer(source)) as never, {
    type: "flatten-transparency",
    matte: "#0000ff",
    alphaMode: "clear",
  } as never) as unknown as ReturnType<typeof stateWithLayer>

  expect(pixels(next.documents[0].layers[0].canvas)).toEqual([
    100, 50, 127, 255,
    0, 0, 255, 255,
  ])
})

test("flatten-transparency can matte colors while preserving original layer alpha", () => {
  const source = rgbaCanvas(1, 1, [10, 20, 30, 64])

  const next = reducer(stateWithLayer(rasterLayer(source)) as never, {
    type: "flatten-transparency",
    matte: "#ffffff",
    alphaMode: "preserve",
  } as never) as unknown as ReturnType<typeof stateWithLayer>

  expect(pixels(next.documents[0].layers[0].canvas)).toEqual([194, 196, 199, 64])
})
