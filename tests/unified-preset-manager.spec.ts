import { expect, test } from "@playwright/test"

import {
  collectPresetFamilies,
  collectPresetSets,
  createPresetBundle,
  deletePresetItem,
  filterPresetItems,
  mergePresetItems,
  movePresetToSet,
  parsePresetBundle,
  renamePresetItem,
  reorderPresetItem,
  type UnifiedPresetItem,
} from "../components/photoshop/preset-manager"
import { DEFAULT_SHAPE_PRESETS, normalizeShapePresets } from "../components/photoshop/shape-preset-library"

function preset(
  family: UnifiedPresetItem["family"],
  id: string,
  name: string,
  set: string,
  payload: unknown = {},
): UnifiedPresetItem {
  return {
    key: `${family}:${id}`,
    family,
    id,
    name,
    set,
    payload,
    createdAt: 1_800_000_000_000,
  }
}

test("unified preset browser filters across all preset families and sets", () => {
  const items: UnifiedPresetItem[] = [
    preset("brush", "brush-1", "Dry Ink Brand Brush", "Brand"),
    preset("swatch", "swatch-1", "Hero Blue", "Brand"),
    preset("gradient", "grad-1", "Sunset", "Atmospheric"),
    preset("pattern", "pat-1", "Canvas Grain", "Textures"),
    preset("style", "style-1", "Chrome Title", "Type"),
    preset("shape", "shape-1", "Arrow Right", "Arrows"),
    preset("tool-preset", "tool-1", "Retouch Brush Setup", "Retouching"),
    preset("asset", "asset-1", "Campaign Library", "Libraries"),
  ]

  expect(collectPresetFamilies(items).map((entry) => [entry.family, entry.count])).toEqual([
    ["all", 8],
    ["brush", 1],
    ["swatch", 1],
    ["gradient", 1],
    ["pattern", 1],
    ["style", 1],
    ["shape", 1],
    ["tool-preset", 1],
    ["asset", 1],
  ])
  expect(collectPresetSets(items, "all").map((entry) => entry.set)).toEqual([
    "All",
    "Arrows",
    "Atmospheric",
    "Brand",
    "Libraries",
    "Retouching",
    "Textures",
    "Type",
  ])
  expect(filterPresetItems(items, { family: "all", set: "all", query: "brand" }).map((item) => item.id)).toEqual([
    "brush-1",
    "swatch-1",
  ])
  expect(filterPresetItems(items, { family: "gradient", set: "all", query: "" }).map((item) => item.id)).toEqual(["grad-1"])
  expect(filterPresetItems(items, { family: "all", set: "Textures", query: "grain" }).map((item) => item.id)).toEqual(["pat-1"])
})

test("unified preset operations rename delete reorder and move between sets", () => {
  const items: UnifiedPresetItem[] = [
    preset("brush", "brush-1", "Dry Ink", "User"),
    preset("brush", "brush-2", "Wet Ink", "User"),
    preset("swatch", "swatch-1", "Hero Blue", "Brand"),
  ]

  const renamed = renamePresetItem(items, "brush:brush-1", "  Dry Ink Detail  ")
  expect(renamed[0]).toMatchObject({ name: "Dry Ink Detail" })

  const moved = movePresetToSet(renamed, "brush:brush-1", "Imported Brushes")
  expect(moved[0]).toMatchObject({ set: "Imported Brushes" })

  const reordered = reorderPresetItem(moved, "brush:brush-2", -1)
  expect(reordered.map((item) => item.id)).toEqual(["brush-2", "brush-1", "swatch-1"])

  const deleted = deletePresetItem(reordered, "brush:brush-1")
  expect(deleted.map((item) => item.key)).toEqual(["brush:brush-2", "swatch:swatch-1"])
})

test("unified preset imports handle duplicate ids and names with explicit conflict policies", () => {
  const existing: UnifiedPresetItem[] = [
    preset("brush", "brush-1", "Dry Ink", "User", { size: 24 }),
    preset("gradient", "grad-1", "Sunset", "Atmospheric", { stops: 2 }),
  ]
  const incoming: UnifiedPresetItem[] = [
    preset("brush", "brush-1", "Dry Ink", "User", { size: 36 }),
    preset("brush", "brush-3", "Dry Ink", "User", { size: 48 }),
  ]

  const kept = mergePresetItems(existing, incoming, {
    conflictPolicy: "keep-both",
    idFactory: (family, id, attempt) => `${family}-${id}-import-${attempt}`,
  })
  expect(kept.items).toHaveLength(4)
  expect(kept.added).toBe(2)
  expect(kept.renamed).toBe(2)
  expect(kept.conflicts.map((conflict) => conflict.reason)).toEqual(["duplicate-id", "duplicate-name"])
  expect(kept.items.slice(2).map((item) => [item.id, item.name])).toEqual([
    ["brush-brush-1-import-1", "Dry Ink copy"],
    ["brush-3", "Dry Ink copy 2"],
  ])

  const replaced = mergePresetItems(existing, incoming.slice(0, 1), { conflictPolicy: "replace" })
  expect(replaced.items).toHaveLength(2)
  expect(replaced.replaced).toBe(1)
  expect(replaced.items[0].payload).toEqual({ size: 36 })

  const skipped = mergePresetItems(existing, incoming, { conflictPolicy: "skip" })
  expect(skipped.items).toEqual(existing)
  expect(skipped.skipped).toBe(2)
})

test("unified preset bundles round trip portable cross-family libraries", () => {
  const items: UnifiedPresetItem[] = [
    preset("brush", "brush-1", "Dry Ink", "User", { size: 24 }),
    preset("shape", "arrow-right", "Arrow Right", "Arrows", { customId: "arrow-right" }),
    preset("tool-preset", "tool-1", "Retouch Brush Setup", "Retouching", { tool: "brush" }),
  ]

  const bundle = createPresetBundle(items, {
    exportedAt: "2026-05-25T12:00:00.000Z",
    sourceDocumentName: "Campaign.psdoc",
  })
  const parsed = parsePresetBundle(bundle, {
    now: 1_800_000_010_000,
  })

  expect(bundle).toMatchObject({
    app: "Photoshop Web",
    format: "ps-unified-presets",
    version: 1,
    sourceDocumentName: "Campaign.psdoc",
  })
  expect(parsed.map((item) => [item.family, item.id, item.name, item.set])).toEqual([
    ["brush", "brush-1", "Dry Ink", "User"],
    ["shape", "arrow-right", "Arrow Right", "Arrows"],
    ["tool-preset", "tool-1", "Retouch Brush Setup", "Retouching"],
  ])
})

test("shape preset library normalizes the shared bundled shape list", () => {
  const imported = normalizeShapePresets({
    shapes: [
      { id: "arrow-right", name: "Arrow Right", group: "Arrows", customId: "arrow-right", createdAt: 1_800_000_000_000 },
      { id: "", name: "", group: "", customId: "heart" },
    ],
  })

  expect(DEFAULT_SHAPE_PRESETS.some((shape) => shape.customId === "heart")).toBe(true)
  expect(imported).toEqual([
    { id: "arrow-right", name: "Arrow Right", group: "Arrows", customId: "arrow-right", createdAt: 1_800_000_000_000 },
    { id: "shape-2", name: "Shape 2", group: "Shapes", customId: "heart", createdAt: undefined },
  ])
})
