import { expect, test } from "@playwright/test"

import { reducer } from "../components/photoshop/editor-context"
import { exportSmartObjectContents, smartObjectStatus } from "../components/photoshop/smart-objects"
import { fixtureCanvas, richFixtureDocument } from "./photoshop-fixtures"

type FixtureState = ReturnType<typeof stateWithFixtureDoc>

function stateWithFixtureDoc() {
  const doc = richFixtureDocument()
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
  }
}

test("editor reducer updates linked smart object lifecycle state", () => {
  let state: FixtureState = stateWithFixtureDoc()
  state = reducer(state as never, {
    type: "set-layer-smart-link",
    id: "layer_smart",
    source: {
      fileName: "updated.psb",
      relativePath: "links/updated.psb",
      status: "modified",
    },
  } as never) as unknown as FixtureState

  let layer = state.documents[0].layers.find((item) => item.id === "layer_smart")!
  expect(layer.smartSource).toMatchObject({
    linkType: "linked",
    fileName: "updated.psb",
    relativePath: "links/updated.psb",
    status: "modified",
  })
  expect(smartObjectStatus(layer)).toBe("modified")

  state = reducer(state as never, { type: "set-layer-smart-link-status", id: "layer_smart", status: "missing" } as never) as unknown as FixtureState
  layer = state.documents[0].layers.find((item) => item.id === "layer_smart")!
  expect(smartObjectStatus(layer)).toBe("missing")
})

test("editor reducer replaces smart object contents while preserving layer footprint", () => {
  const state = reducer(stateWithFixtureDoc() as never, {
    type: "replace-smart-object-contents",
    id: "layer_smart",
    canvas: fixtureCanvas(18, 14, "#00aa88"),
    source: {
      fileName: "replacement.png",
      relativePath: "links/replacement.png",
      linkType: "linked",
    },
  } as never) as unknown as FixtureState

  const layer = state.documents[0].layers.find((item) => item.id === "layer_smart")!
  expect(layer.canvas.width).toBe(64)
  expect(layer.canvas.height).toBe(48)
  expect(layer.smartSource).toMatchObject({
    width: 18,
    height: 14,
    fileName: "replacement.png",
    relativePath: "links/replacement.png",
    status: "current",
  })
  expect(exportSmartObjectContents(layer)?.filename).toBe("replacement.png")
})
