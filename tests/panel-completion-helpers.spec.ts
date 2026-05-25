import { expect, test } from "@playwright/test"

import type { AssetLibraryItem, HistoryEntry, LayerComp, MacroAction, PsDocument } from "../components/photoshop/types"
import {
  extractMentionNames,
  filterAnnotationNotes,
  moveAnnotationNote,
} from "../components/photoshop/panels/annotations-panel"
import {
  layerCompExportFilename,
  layerCompNeedsUpdate,
} from "../components/photoshop/panels/layer-comps-panel"
import {
  actionFolderGroups,
  buildInsertPathStep,
  playbackSpeedToDelayMs,
} from "../components/photoshop/panels/actions-panel"
import {
  filterToolPresetAssets,
  reorderToolPresetAssets,
} from "../components/photoshop/panels/tool-presets-panel"
import {
  LOCAL_COLOR_BOOKS,
  mergeRecentSwatch,
} from "../components/photoshop/panels/swatches-panel"
import {
  createNoiseGradientPreset,
  insertGradientStopFromPointer,
  updateGradientStopFromDrag,
} from "../components/photoshop/panels/gradients-panel"

test("annotation helpers filter threads, extract @mentions, and clamp drag repositioning", () => {
  const notes = [
    { id: "open", x: 10, y: 12, author: "Ada", text: "Please ask @Noah and @Mira.", color: "#facc15", kind: "annotation" as const, status: "open" as const },
    { id: "resolved", x: 20, y: 22, author: "Noah", text: "Done for @Ada", color: "#38bdf8", kind: "comment" as const, status: "resolved" as const },
  ]

  expect(extractMentionNames(notes[0].text)).toEqual(["Noah", "Mira"])
  expect(filterAnnotationNotes(notes, { status: "open", author: "all" }).map((note) => note.id)).toEqual(["open"])
  expect(filterAnnotationNotes(notes, { status: "all", author: "Noah" }).map((note) => note.id)).toEqual(["resolved"])
  expect(moveAnnotationNote(notes[0], { x: -30, y: 250 }, { width: 100, height: 120 })).toMatchObject({ x: 0, y: 120 })
})

test("layer comp helpers detect drift and build safe export names", () => {
  const comp: LayerComp = {
    id: "comp-a",
    name: "Hero / Mobile",
    state: {
      "layer-a": { visible: true, opacity: 1, blendMode: "normal" },
    },
  }
  const doc = {
    name: "Campaign.psd",
    layers: [{ id: "layer-a", visible: false, opacity: 1, blendMode: "normal" }],
  } as PsDocument

  expect(layerCompNeedsUpdate(comp, doc)).toBe(true)
  expect(layerCompExportFilename("Campaign.psd", "Hero / Mobile", "png")).toBe("Campaign-Hero-Mobile.png")
})

test("action helpers group action sets, create path steps, and map playback speeds", () => {
  const actions: MacroAction[] = [
    { id: "a", name: "Resize", folder: "Production", createdAt: 1, updatedAt: 1, steps: [] },
    { id: "b", name: "Sharpen", folder: "Finishing", createdAt: 2, updatedAt: 2, steps: [] },
    { id: "c", name: "Loose", createdAt: 3, updatedAt: 3, steps: [] },
  ]
  const entry = {
    id: "entry",
    label: "Current",
    layers: [],
    activeLayerId: "layer-a",
    selectedLayerIds: ["layer-a"],
  } as HistoryEntry

  expect(actionFolderGroups(actions).map((group) => [group.name, group.actions.map((action) => action.id)])).toEqual([
    ["Finishing", ["b"]],
    ["Production", ["a"]],
    ["Ungrouped", ["c"]],
  ])
  expect(buildInsertPathStep(entry, 123).label).toBe("Insert Path")
  expect(playbackSpeedToDelayMs("instant")).toBe(0)
  expect(playbackSpeedToDelayMs("slow")).toBeGreaterThan(playbackSpeedToDelayMs("fast"))
})

test("tool preset helpers filter current tool and reorder within the asset library", () => {
  const assets: AssetLibraryItem[] = [
    { id: "brush", name: "Brush setup", kind: "tool-preset", group: "Paint", createdAt: 3, payload: { tool: "brush" } },
    { id: "lasso", name: "Lasso setup", kind: "tool-preset", group: "Select", createdAt: 2, payload: { tool: "lasso-magnetic" } },
    { id: "stock", name: "Stock", kind: "stock", group: "Assets", createdAt: 1, payload: {} },
  ]

  expect(filterToolPresetAssets(assets, { query: "setup", group: "All", currentToolOnly: true, tool: "brush", sort: "recent" }).map((asset) => asset.id)).toEqual(["brush"])
  expect(reorderToolPresetAssets(assets, "lasso", "brush").map((asset) => asset.id)).toEqual(["lasso", "brush", "stock"])
})

test("swatch and gradient helpers provide local books, recents, freeform stops, and noise presets", () => {
  const recent = mergeRecentSwatch([{ color: "#111111", name: "Ink", group: "Recent" }], { color: "#336699", name: "Steel", group: "Brand" })
  expect(recent.map((swatch) => swatch.color)).toEqual(["#336699", "#111111"])
  expect(LOCAL_COLOR_BOOKS.some((book) => book.swatches.length >= 8)).toBe(true)

  const inserted = insertGradientStopFromPointer(
    [{ pos: 0, color: "#000000" }, { pos: 1, color: "#ffffff" }],
    40,
    { left: 0, width: 100 },
    "#336699",
  )
  expect(inserted.map((stop) => stop.pos)).toEqual([0, 0.4, 1])
  expect(updateGradientStopFromDrag(inserted, 1, 95, { left: 0, width: 100 })[1].pos).toBe(0.95)
  expect(createNoiseGradientPreset("Noise", 8, 7).stops).toHaveLength(8)
})
