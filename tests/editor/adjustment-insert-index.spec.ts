import { expect, test } from "@playwright/test"

import { adjustmentInsertIndex } from "@/editor/adjustment-layers"
import type { Layer } from "@/editor/types"

const layer = (id: string, kind: Layer["kind"], parentId?: string) =>
  ({ id, kind, parentId, name: id, visible: true, locked: false, opacity: 1, blendMode: "normal" }) as Layer

test("adjustment lands above the active layer, not on top of the document", () => {
  const layers = [layer("a", "raster"), layer("b", "raster")]
  expect(adjustmentInsertIndex(layers, "a")).toEqual({ index: 1, parentId: undefined })
})

test("adjustment stacks above the adjustments already on the active layer", () => {
  const layers = [layer("a", "raster"), layer("adj1", "adjustment"), layer("adj2", "adjustment"), layer("b", "raster")]
  expect(adjustmentInsertIndex(layers, "a")).toEqual({ index: 3, parentId: undefined })
})

test("adjustment stays inside the active layer's group", () => {
  const layers = [layer("a", "raster", "g"), layer("adj", "adjustment", "g"), layer("g", "group"), layer("top", "raster")]
  expect(adjustmentInsertIndex(layers, "a")).toEqual({ index: 2, parentId: "g" })
})

test("a selected group takes the adjustment at the top of its children", () => {
  const layers = [layer("a", "raster", "g"), layer("g", "group"), layer("top", "raster")]
  expect(adjustmentInsertIndex(layers, "g")).toEqual({ index: 1, parentId: "g" })
})

test("no active layer appends", () => {
  const layers = [layer("a", "raster")]
  expect(adjustmentInsertIndex(layers, undefined)).toEqual({ index: 1, parentId: undefined })
})
