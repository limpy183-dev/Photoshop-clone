import { expect, test } from "@playwright/test"

import {
  alphaBounds,
  applySelectionMaskToCanvas,
  autoPickLayer,
  clipToSelection,
  createRemoveMask,
  selectBackgroundMaskFromImage,
} from "../components/photoshop/canvas-selection-helpers"
import { invalidateMaskAlphaCache } from "../components/photoshop/canvas-compositor-cache"
import type { Layer, PsDocument, Selection } from "../components/photoshop/types"
import { fixtureCanvas, installFixtureDom } from "./photoshop-fixtures"

function documentWithSelection(selection: Selection): PsDocument {
  return {
    id: "doc",
    name: "Document",
    width: 10,
    height: 8,
    zoom: 1,
    pan: { x: 0, y: 0 },
    layers: [],
    activeLayerId: "",
    selection,
  } as unknown as PsDocument
}

function layer(id: string, alpha: number, overrides: Partial<Layer> = {}): Layer {
  return {
    id,
    name: id,
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: {
      width: 10,
      height: 8,
      getContext: () => ({
        getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, alpha]) }),
      }),
    } as unknown as HTMLCanvasElement,
    ...overrides,
  }
}

test.beforeAll(() => {
  installFixtureDom()
})

test("remove masks preserve point clamping, circular coverage, and empty behavior", () => {
  const empty = createRemoveMask([], 4, 5, 5)
  expect([...empty.data].some((value) => value !== 0)).toBe(false)

  const mask = createRemoveMask([{ x: -10, y: 99 }], 2, 5, 5)
  const alpha = (x: number, y: number) => mask.data[(y * mask.width + x) * 4 + 3]
  expect(alpha(0, 4)).toBe(255)
  expect(alpha(1, 4)).toBe(255)
  expect(alpha(0, 3)).toBe(255)
  expect(alpha(1, 3)).toBe(0)
})

test("selection clipping retains mask, ellipse, and rectangle paths", () => {
  const calls: string[] = []
  const context = {
    save: () => calls.push("save"),
    beginPath: () => calls.push("begin"),
    rect: (x: number, y: number, w: number, h: number) => calls.push(`rect:${x},${y},${w},${h}`),
    ellipse: (...values: number[]) => calls.push(`ellipse:${values.join(",")}`),
    clip: () => calls.push("clip"),
  } as unknown as CanvasRenderingContext2D

  clipToSelection(context, documentWithSelection({
    bounds: { x: 1, y: 2, w: 3, h: 4 },
    shape: "rect",
    mask: {} as HTMLCanvasElement,
  }))
  expect(calls).toEqual(["save", "begin", "rect:1,2,3,4", "clip"])

  calls.length = 0
  clipToSelection(context, documentWithSelection({
    bounds: { x: 2, y: 4, w: 6, h: 8 },
    shape: "ellipse",
  }))
  expect(calls).toEqual(["begin", `ellipse:5,8,3,4,0,0,${Math.PI * 2}`, "clip"])

  calls.length = 0
  clipToSelection(context, documentWithSelection({
    bounds: null,
    shape: "rect",
  }))
  expect(calls).toEqual([])
})

test("layer picking retains reverse order, visibility, group, and alpha threshold rules", () => {
  const bottom = layer("bottom", 255)
  const transparentTop = layer("transparent", 8)
  const hidden = layer("hidden", 255, { visible: false })
  const group = layer("group", 255, { kind: "group" })
  const document = {
    layers: [bottom, transparentTop, hidden, group],
  } as PsDocument

  expect(autoPickLayer(document, { x: 2.9, y: 3.8 })).toBe(bottom)
  expect(autoPickLayer({ layers: [layer("opaque", 9), bottom] } as PsDocument, { x: 1, y: 1 })?.id).toBe("bottom")
  expect(autoPickLayer({ layers: [bottom, layer("opaque", 9)] } as PsDocument, { x: 1, y: 1 })?.id).toBe("opaque")
})

test("alpha bounds retain threshold, inclusive bounds, and shared invalidation", () => {
  const data = new Uint8ClampedArray(5 * 4 * 4)
  data[(1 * 5 + 1) * 4 + 3] = 255
  data[(2 * 5 + 3) * 4 + 3] = 255
  let reads = 0
  const canvas = {
    width: 5,
    height: 4,
    getContext: () => ({
      getImageData: () => {
        reads++
        return { data, width: 5, height: 4 }
      },
    }),
  } as unknown as HTMLCanvasElement

  expect(alphaBounds(canvas)).toEqual({ x: 1, y: 1, w: 3, h: 2 })
  expect(alphaBounds(canvas)).toEqual({ x: 1, y: 1, w: 3, h: 2 })
  expect(reads).toBe(1)

  data.fill(0)
  expect(alphaBounds(canvas)).toEqual({ x: 1, y: 1, w: 3, h: 2 })
  invalidateMaskAlphaCache()
  expect(alphaBounds(canvas)).toBeNull()
  expect(reads).toBe(2)
})

test("selection masks apply destination-in and background selection keeps dimensions", () => {
  const calls: string[] = []
  const context = {
    globalCompositeOperation: "source-over",
    save: () => calls.push("save"),
    drawImage: () => calls.push("draw"),
    restore: () => calls.push("restore"),
  }
  const target = {
    getContext: () => context,
  } as unknown as HTMLCanvasElement
  applySelectionMaskToCanvas(target, documentWithSelection({
    bounds: { x: 1, y: 1, w: 3, h: 2 },
    shape: "rect",
  }))
  expect(calls).toEqual(["save", "draw", "restore"])
  expect(context.globalCompositeOperation).toBe("destination-in")

  const source = fixtureCanvas(9, 7)
  const background = selectBackgroundMaskFromImage(source, 12)
  expect({ width: background.width, height: background.height }).toEqual({ width: 9, height: 7 })
})
