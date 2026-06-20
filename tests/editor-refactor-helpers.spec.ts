import { expect, test } from "@playwright/test"

import { documentCommandAvailability, layerCommandAvailability } from "../components/photoshop/command-services"
import { createDocumentRenderGraph } from "../components/photoshop/render-graph"
import { selectActiveDocument, selectActiveLayer, selectSelectedLayers, selectVisibleLayers } from "../components/photoshop/editor-selectors"
import type { Layer, PsDocument } from "../components/photoshop/types"

function layer(id: string, patch: Partial<Layer> = {}): Layer {
  return {
    id,
    name: id,
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: {} as HTMLCanvasElement,
    ...patch,
  }
}

function doc(): PsDocument {
  const layers = [
    layer("base"),
    layer("smart", { smartObject: true, smartFilters: [{ id: "blur", filterId: "gaussian-blur", name: "Blur", enabled: true, params: {} }] }),
    layer("adj", { kind: "adjustment", adjustment: { type: "brightness-contrast", params: { brightness: 5 } } }),
  ]
  return {
    id: "doc",
    name: "Doc",
    width: 100,
    height: 80,
    zoom: 1,
    layers,
    activeLayerId: "smart",
    selectedLayerIds: ["smart", "adj"],
    background: "#fff",
    colorMode: "RGB",
    bitDepth: 8,
    selection: { bounds: null, shape: "rect" },
    notes: [{ id: "note", x: 1, y: 2, author: "A", text: "Review", color: "#fff", status: "open" }],
  }
}

test("editor selectors expose active selected and visible layer state outside editor-context", () => {
  const document = doc()
  const state = { documents: [document], activeDocId: "doc" }

  expect(selectActiveDocument(state)).toBe(document)
  expect(selectActiveLayer(document)?.id).toBe("smart")
  expect(selectSelectedLayers(document).map((item) => item.id)).toEqual(["smart", "adj"])
  expect(selectVisibleLayers(document)).toHaveLength(3)
})

test("command services summarize document and layer availability", () => {
  const document = doc()

  expect(documentCommandAvailability(document)).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: "review.export-packet", enabled: true })]),
  )
  expect(documentCommandAvailability(null)).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: "file.save-project", enabled: false })]),
  )
  expect(layerCommandAvailability(selectActiveLayer(document))).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: "layer.edit-smart-object", enabled: true })]),
  )
})

test("canonical render graph describes layer masks filters adjustments and output", () => {
  const graph = createDocumentRenderGraph(doc())

  expect(graph.outputNodeId).toBe("output:doc")
  expect(graph.nodes.map((node) => node.kind)).toEqual([
    "document",
    "layer",
    "layer",
    "smart-filter",
    "layer",
    "adjustment",
    "output",
  ])
  expect(graph.nodes.find((node) => node.id === "smart-filter:smart:blur")).toMatchObject({
    label: "Blur",
    inputs: ["layer:smart"],
  })
})
