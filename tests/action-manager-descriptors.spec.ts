import { expect, test } from "@playwright/test"

import {
  ACTION_DESCRIPTOR_OPS,
  descBoolean,
  descInteger,
  descLayerKey,
  descNumber,
  descRecord,
  descString,
  descTargetsDocument,
  descTargetsLayer,
  descriptorToEdit,
  editToDescriptor,
  isKnownDescriptor,
  normalizeFilterParams,
  replayDescriptors,
  resolveLayer,
  roundTripDescriptor,
  type DescriptorHost,
  type RecordableEdit,
} from "../components/photoshop/action-manager-descriptors"
import type { Layer, PluginActionDescriptor } from "../components/photoshop/types"
import { fixtureCanvas, richFixtureDocument } from "./photoshop-fixtures"

test.afterEach(() => {
  Reflect.deleteProperty(globalThis, "document")
})

test("descriptor coercion helpers bound untrusted scalar and record values", () => {
  expect(descNumber("12.5", 0, 0, 10)).toBe(10)
  expect(descNumber("bad", 7)).toBe(7)
  expect(descInteger(4.6, 0)).toBe(5)
  expect(descString("abcdef", "", 3)).toBe("abc")
  expect(descString(42, "fallback")).toBe("fallback")
  expect(descBoolean("true", false)).toBe(true)
  expect(descBoolean(0, true)).toBe(false)
  expect(descBoolean("yes", true)).toBe(true)
  expect(descRecord({ ok: true })).toEqual({ ok: true })
  expect(descRecord(["not", "a", "record"])).toEqual({})
})

test("descriptor targets distinguish documents, active layers, ids, names, and indexes", () => {
  const docTarget = { _obj: "get", _target: [{ _ref: "document" }] }
  const layerTarget = { _obj: "get", _target: [{ _ref: "layer", _id: "layer_raster" }] }

  expect(descTargetsDocument(docTarget)).toBe(true)
  expect(descTargetsLayer(docTarget)).toBe(false)
  expect(descTargetsLayer(layerTarget)).toBe(true)
  expect(descTargetsLayer({ _obj: "hide" })).toBe(true)
  expect(descLayerKey(layerTarget)).toBe("layer_raster")
  expect(descLayerKey({ _obj: "get", _target: [{ _ref: "layer", name: "Text" }] })).toBe("Text")
  expect(descLayerKey({ _obj: "get", _target: [{ _ref: "layer", _index: 1 }] })).toBe("__index:1")
})

test("layer resolution supports active, id, name, index, and missing targets", () => {
  const doc = richFixtureDocument()
  const active = doc.layers[0]

  expect(resolveLayer(doc, active, "active")).toBe(active)
  expect(resolveLayer(doc, active, doc.layers[1].id)).toBe(doc.layers[1])
  expect(resolveLayer(doc, active, doc.layers[1].name)).toBe(doc.layers[1])
  expect(resolveLayer(doc, active, "__index:1")).toBe(doc.layers[1])
  expect(resolveLayer(doc, active, "__index:999")).toBeNull()
  expect(resolveLayer(doc, active, "missing")).toBeNull()
})

test("filter descriptor parameters clamp, quantize, validate options, and ignore unknown keys", () => {
  expect(normalizeFilterParams("gaussian-blur", { radius: 150.04, ignored: 1 })).toEqual({ radius: 100 })
  expect(normalizeFilterParams("motion-blur", { angle: -999, distance: "14.7" })).toEqual({
    angle: -180,
    distance: 15,
  })
  expect(normalizeFilterParams("custom-filter", {
    preset: "not-a-preset",
    strength: 33.6,
    matrix: "x".repeat(5000),
  })).toEqual({
    preset: "sharpen-more",
    strength: 34,
    bias: 0,
    divisor: 0,
    matrix: "x".repeat(4000),
  })
  expect(normalizeFilterParams("unknown-filter", { radius: 5 })).toEqual({})
})

test("every recordable edit round-trips to a stable JSON descriptor", () => {
  const edits: RecordableEdit[] = [
    { kind: "doc.open", name: "Example", width: 640, height: 480 },
    { kind: "doc.save", format: "psd" },
    { kind: "doc.close", force: true },
    { kind: "doc.duplicate", name: "Copy" },
    { kind: "doc.resize", width: 800, height: 600 },
    { kind: "doc.crop", x: 10, y: 20, width: 300, height: 200 },
    { kind: "doc.rotate", angle: 270 },
    { kind: "doc.flatten" },
    { kind: "layer.new", layerKey: "active", name: "New", layerKind: "shape" },
    { kind: "layer.delete", layerKey: "a" },
    { kind: "layer.duplicate", layerKey: "a", newName: "A copy" },
    { kind: "layer.group", layerKeys: ["a", "b"], groupName: "Group" },
    { kind: "layer.ungroup", groupKey: "g" },
    { kind: "layer.mergeDown", layerKey: "a" },
    { kind: "layer.mergeVisible" },
    { kind: "layer.rasterize", layerKey: "a", option: "smart-object" },
    { kind: "layer.transform", layerKey: "a", mode: "scale", values: { x: 1.5, y: 0.5 } },
    { kind: "layer.blend", layerKey: "a", blendMode: "multiply" },
    { kind: "layer.mask", layerKey: "a", option: "from-selection" },
    { kind: "layer.rename", layerKey: "a", name: "Renamed" },
    { kind: "layer.opacity", layerKey: "a", opacity: 0.4 },
    { kind: "layer.visibility", layerKey: "a", visible: false },
    { kind: "filter.apply", layerKey: "a", filterId: "gaussian-blur", params: { radius: 4.2 } },
  ]

  for (const edit of edits) {
    const { descriptor, restored } = roundTripDescriptor(edit)
    expect(restored, `${edit.kind} should restore`).not.toBeNull()
    expect(editToDescriptor(restored!), `${edit.kind} descriptor stability`).toEqual(descriptor)
  }
})

test("incoming descriptors clamp document and layer edits to supported values", () => {
  expect(descriptorToEdit({ _obj: "resize-document", width: -20, height: 999999 })).toEqual({
    kind: "doc.resize",
    width: 1,
    height: 30000,
  })
  expect(descriptorToEdit({ _obj: "rotate-document", angle: -100 })).toEqual({
    kind: "doc.rotate",
    angle: 270,
  })
  expect(descriptorToEdit({
    _obj: "set",
    _target: [{ _ref: "layer", _id: "layer-a" }],
    to: { opacity: 4 },
  })).toEqual({
    kind: "layer.opacity",
    layerKey: "layer-a",
    opacity: 1,
  })
  expect(descriptorToEdit({ _obj: "set", to: { unsupported: true } })).toBeNull()
})

test("known descriptor allow-list accepts documented operations and rejects arbitrary names", () => {
  expect(new Set(ACTION_DESCRIPTOR_OPS).size).toBe(ACTION_DESCRIPTOR_OPS.length)
  for (const op of ACTION_DESCRIPTOR_OPS) {
    expect(isKnownDescriptor({ _obj: op })).toBe(true)
  }
  expect(isKnownDescriptor({ _obj: "__proto__" })).toBe(false)
  expect(isKnownDescriptor({ _obj: "eval" })).toBe(false)
})

function createHost() {
  const doc = richFixtureDocument()
  const active = doc.layers[0]
  const dispatched: Array<{ type: string; [key: string]: unknown }> = []
  const filters: Array<{ layerId: string; filterId: string; params: Record<string, number | string | boolean> }> = []
  const commits: Array<{ label: string; layerIds?: string[] }> = []
  let renders = 0
  const created: Layer[] = []

  const host: DescriptorHost = {
    getDocument: () => doc,
    getActiveLayer: () => active,
    dispatch: (action) => dispatched.push(action),
    requestRender: () => { renders++ },
    commit: (label, layerIds) => commits.push({ label, layerIds }),
    applyFilter: (layer, filterId, params) => filters.push({ layerId: layer.id, filterId, params }),
    createBlankLayer: (name, kind) => {
      const layer: Layer = {
        id: `created-${created.length + 1}`,
        name,
        kind,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        canvas: fixtureCanvas(8, 8),
      }
      created.push(layer)
      return layer
    },
  }
  return { doc, active, host, dispatched, filters, commits, created, get renders() { return renders } }
}

test("descriptor replay handles document and layer queries plus active-layer selection without history commits", () => {
  const fixture = createHost()
  const selected = fixture.doc.layers[1]
  const result = replayDescriptors([
    { _obj: "get", _target: [{ _ref: "document" }] },
    { _obj: "get", _target: [{ _ref: "layer", _id: selected.id }] },
    { _obj: "select", _target: [{ _ref: "layer", _id: selected.id }] },
  ], fixture.host)

  expect(result.results[0]).toMatchObject({
    id: fixture.doc.id,
    width: fixture.doc.width,
    layerCount: fixture.doc.layers.length,
  })
  expect(result.results[1]).toMatchObject({ id: selected.id, name: selected.name })
  expect(result.results[2]).toEqual({ ok: true, activeLayerId: selected.id })
  expect(fixture.dispatched).toEqual([{ type: "set-active-layer", id: selected.id }])
  expect(fixture.commits).toEqual([])
  expect(fixture.renders).toBe(0)
})

test("mutating descriptor replay dispatches edits, applies filters, and commits touched layers once", () => {
  const fixture = createHost()
  const layer = fixture.active
  const descriptors: PluginActionDescriptor[] = [
    { _obj: "set", _target: [{ _ref: "layer", _id: layer.id }], to: { name: "Renamed" } },
    { _obj: "hide", _target: [{ _ref: "layer", _id: layer.id }] },
    { _obj: "filter", _target: [{ _ref: "layer", _id: layer.id }], filter: "gaussian-blur", params: { radius: 8.24 } },
    { _obj: "new-layer", name: "Plugin Layer", layerKind: "raster" },
  ]

  const result = replayDescriptors(descriptors, fixture.host)

  expect(fixture.dispatched).toEqual([
    { type: "rename-layer", id: layer.id, name: "Renamed" },
    { type: "set-layer-visibility", id: layer.id, visible: false },
  ])
  expect(fixture.filters).toHaveLength(1)
  expect(fixture.filters[0]).toMatchObject({ layerId: layer.id, filterId: "gaussian-blur" })
  expect(fixture.filters[0].params.radius).toBeCloseTo(8.2)
  expect(fixture.created).toMatchObject([{ id: "created-1", name: "Plugin Layer", kind: "raster" }])
  expect(result.touchedLayers).toEqual([layer.id, "created-1"])
  expect(fixture.renders).toBe(1)
  expect(fixture.commits).toEqual([{ label: "Action Manager", layerIds: [layer.id, "created-1"] }])
})

test("descriptor replay reports unsupported, missing-layer, and missing-document failures without throwing", () => {
  const fixture = createHost()
  const result = replayDescriptors([
    { _obj: "execute-arbitrary-code" },
    { _obj: "delete-layer", _target: [{ _ref: "layer", _id: "missing" }] },
  ], fixture.host)

  expect(result.unsupported).toEqual(["execute-arbitrary-code"])
  expect(result.results).toEqual([
    { ok: false, unsupported: "execute-arbitrary-code" },
    { ok: false, reason: "No layer to delete" },
  ])

  const noDocHost = { ...fixture.host, getDocument: () => null }
  expect(replayDescriptors([{ _obj: "get" }], noDocHost).results).toEqual([
    { ok: false, reason: "no document" },
  ])
})
