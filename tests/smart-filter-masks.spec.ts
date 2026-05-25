import { expect, test } from "@playwright/test"

import { reducer } from "../components/photoshop/editor-context"
import {
  normalizeSmartFilterMaskDensity,
  normalizeSmartFilterMaskFeather,
  resolveSmartFilterMaskAmount,
} from "../components/photoshop/smart-filter-masks"
import {
  createSmartFilterStackPreset,
  hydrateSmartFilterStackPresetEntries,
} from "../components/photoshop/smart-filter-presets"
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

test("smart filter mask link state is editable and stack presets preserve combined authoring metadata", () => {
  let state: FixtureState = stateWithFixtureDoc()
  state = reducer(state as never, {
    type: "update-smart-filter",
    layerId: "layer_raster",
    filterId: "sf_blur",
    patch: { maskLinked: false },
  } as never) as unknown as FixtureState

  const raster = state.documents[0].layers.find((layer) => layer.id === "layer_raster")!
  expect(raster.smartFilters?.[0]).toMatchObject({ maskLinked: false })

  const preset = createSmartFilterStackPreset(
    "  Soft product stack  ",
    [
      {
        id: "sf_blur",
        filterId: "box-blur",
        filterName: "Box Blur",
        params: { radius: 2 },
        visible: true,
        opacity: 0.75,
        blendMode: "normal",
        mask: raster.smartFilters?.[0].mask ?? null,
        maskEnabled: true,
        maskDensity: 0.4,
        maskFeather: 18,
        maskLinked: false,
      },
      {
        id: "sf_sharpen",
        filterId: "sharpen",
        filterName: "Sharpen",
        params: { amount: 22 },
        visible: false,
        opacity: 0.5,
        blendMode: "luminosity",
        maskLinked: true,
      },
    ],
    { id: "preset_soft", now: 1_800_000_000_000 },
  )

  expect(preset).toMatchObject({
    id: "preset_soft",
    name: "Soft product stack",
    entries: [
      { filterId: "box-blur", visible: true, opacity: 0.75, maskDensity: 0.4, maskFeather: 18, maskLinked: false },
      { filterId: "sharpen", visible: false, opacity: 0.5, blendMode: "luminosity", maskLinked: true },
    ],
  })
  expect("mask" in preset.entries[0]).toBe(false)

  const hydrated = hydrateSmartFilterStackPresetEntries(preset, {
    idFactory: (filterId, index) => `${filterId}_${index}`,
    defaultParams: (filterId): Record<string, number | string | boolean> =>
      filterId === "box-blur" ? { radius: 1, quality: "draft" } : {},
  })

  expect(hydrated.map((entry) => [entry.id, entry.filterId, entry.filterName, entry.params])).toEqual([
    ["box-blur_0", "box-blur", "Box Blur", { radius: 2, quality: "draft" }],
    ["sharpen_1", "sharpen", "Sharpen", { amount: 22 }],
  ])
  expect(hydrated[0]).toMatchObject({ mask: null, maskLinked: false })
})
