import { expect, test } from "@playwright/test"

import {
  MaskSelectionOverlay,
  SelectionOverlay,
  TextEditOverlay,
  resolveTextEditLayer,
  selectionOverlayStyle,
  textEditOverlayStyle,
} from "../components/photoshop/canvas-selection-overlays"
import type { Layer, PsDocument } from "../components/photoshop/types"

function textLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: "text-layer",
    name: "Text",
    kind: "text",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: {} as HTMLCanvasElement,
    text: {
      content: "Editable",
      x: 20,
      y: 30,
      font: "Inter",
      size: 24,
      weight: 700,
      italic: true,
      color: "#123456",
      align: "center",
    },
    ...overrides,
  } as Layer
}

function documentWithLayers(layers: Layer[]): PsDocument {
  return {
    id: "doc",
    name: "Overlay",
    width: 200,
    height: 100,
    zoom: 1.5,
    pan: { x: 0, y: 0 },
    layers,
    activeLayerId: layers[0]?.id ?? "",
    selection: { bounds: null, shape: "rect" },
  } as unknown as PsDocument
}

test("overlay components remain exported from the focused module", () => {
  expect(typeof MaskSelectionOverlay).toBe("function")
  expect(typeof SelectionOverlay).toBe("function")
  expect(typeof TextEditOverlay).toBe("function")
})

test("selection overlay layout retains percentage conversion", () => {
  expect(selectionOverlayStyle(
    { x: 10, y: 20, w: 30, h: 40 },
    100,
    200,
  )).toEqual({
    left: "10%",
    top: "10%",
    width: "30%",
    height: "20%",
  })
})

test("text edit overlay resolves layers and retains scaled typography styles", () => {
  const layer = textLayer()
  const doc = documentWithLayers([layer])

  expect(resolveTextEditLayer(doc, "text-layer")).toBe(layer)
  expect(resolveTextEditLayer(doc, "missing")).toBeNull()
  expect(resolveTextEditLayer(documentWithLayers([textLayer({ text: undefined })]), "text-layer")).toBeNull()

  expect(textEditOverlayStyle(doc, layer.text!)).toEqual({
    left: "10%",
    top: "30%",
    minWidth: 100,
    minHeight: 50.4,
    fontFamily: "Inter",
    fontSize: 36,
    fontWeight: 700,
    fontStyle: "italic",
    color: "#123456",
    textAlign: "center",
    lineHeight: 1.2,
  })
})
