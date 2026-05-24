import { expect, test } from "@playwright/test"

import { reducer } from "../components/photoshop/editor-context"
import {
  normalizeSmartFilterMaskDensity,
  normalizeSmartFilterMaskFeather,
  resolveSmartFilterMaskAmount,
} from "../components/photoshop/smart-filter-masks"
import { richFixtureDocument } from "./photoshop-fixtures"

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
    activeSmartFilterMaskTarget: null,
  }
}

test("smart filter mask density fades mask coverage toward fully revealed", () => {
  expect(normalizeSmartFilterMaskDensity(undefined)).toBe(1)
  expect(normalizeSmartFilterMaskDensity(-0.4)).toBe(0)
  expect(normalizeSmartFilterMaskDensity(1.7)).toBe(1)
  expect(resolveSmartFilterMaskAmount(0, 1)).toBe(0)
  expect(resolveSmartFilterMaskAmount(0, 0.25)).toBeCloseTo(0.75)
  expect(resolveSmartFilterMaskAmount(0.5, 0.5)).toBeCloseTo(0.75)
})

test("smart filter mask feather is normalized and reducer clamps mask controls", () => {
  expect(normalizeSmartFilterMaskFeather(undefined)).toBe(0)
  expect(normalizeSmartFilterMaskFeather(-8)).toBe(0)
  expect(normalizeSmartFilterMaskFeather(999)).toBe(250)

  const state = reducer(stateWithFixtureDoc() as never, {
    type: "update-smart-filter",
    layerId: "layer_raster",
    filterId: "sf_blur",
    patch: { maskDensity: 1.7, maskFeather: -3 },
  } as never) as unknown as FixtureState

  const raster = state.documents[0].layers.find((layer) => layer.id === "layer_raster")!
  expect(raster.smartFilters?.[0]).toMatchObject({ maskDensity: 1, maskFeather: 0 })
})

test("smart filter mask edit target is document scoped and clears when another layer is activated", () => {
  let state: FixtureState = stateWithFixtureDoc()
  state = reducer(state as never, {
    type: "set-active-smart-filter-mask",
    target: { layerId: "layer_raster", filterId: "sf_blur" },
  } as never) as unknown as FixtureState

  expect(state.activeSmartFilterMaskTarget).toEqual({ layerId: "layer_raster", filterId: "sf_blur" })

  state = reducer(state as never, { type: "set-active-layer", id: "layer_text" } as never) as unknown as FixtureState
  expect(state.activeSmartFilterMaskTarget).toBeNull()
})
