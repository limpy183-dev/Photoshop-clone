import { expect, test } from "@playwright/test"

import {
  adjustmentParamsWithDefaults,
  createAdjustmentLayer,
  defaultAdjustmentParams,
  isAdjustmentNoop,
  isAdjustmentType,
  nextAdjustmentLayerName,
} from "../components/photoshop/adjustment-layers"
import {
  cleanImportText,
  normalizeCredentialImportPayload,
  normalizeDropletImportPayload,
} from "../components/photoshop/advanced-subsystems-import-normalizers"
import { parseDslSource, runDsl, validateDsl, type DslHostApi } from "../components/photoshop/command-dsl"
import { computeContextualHelp, contextualHelpForTool, listToolsWithHelp } from "../components/photoshop/contextual-help"
import { FILTERS } from "../components/photoshop/filters"
import {
  assertValidScratchKey,
  isValidScratchKey,
  planScratchStorage,
} from "../components/photoshop/opfs-scratch"
import {
  mergeToolPresetAssets,
  normalizeToolPresetAssets,
  serializeToolPresetAssets,
} from "../components/photoshop/tool-preset-library"
import { hexToRgb, hexToRgba, rgbToHex } from "../components/photoshop/color-utils"
import type { AssetLibraryItem, Layer, PsDocument } from "../components/photoshop/types"
import { fixtureCanvas } from "./photoshop-fixtures"

test("shared color helpers normalize hex, rgba alpha, and channel bounds", () => {
  expect(hexToRgb("#abc")).toEqual({ r: 170, g: 187, b: 204 })
  expect(hexToRgb("12")).toEqual({ r: 18, g: 0, b: 0 })
  expect(hexToRgba("#ff0000", 2)).toBe("rgba(255,0,0,1)")
  expect(hexToRgba("#00ff00", -1)).toBe("rgba(0,255,0,0)")
  expect(rgbToHex(-12, 16.4, 300)).toBe("#0010ff")
})

test("adjustment layer helpers validate types, clamp params, and allocate named layers", () => {
  expect(isAdjustmentType("brightness-contrast")).toBe(true)
  expect(isAdjustmentType("not-an-adjustment")).toBe(false)
  expect(defaultAdjustmentParams("brightness-contrast")).toMatchObject({ brightness: 0, contrast: 0 })
  expect(adjustmentParamsWithDefaults("brightness-contrast", { brightness: 999, contrast: "bad" })).toEqual({
    brightness: 150,
    contrast: 0,
    useLegacy: false,
  })

  const existing = [
    { kind: "adjustment", name: "Brightness/Contrast" },
    { kind: "adjustment", name: "Brightness/Contrast 2" },
  ] as unknown as Layer[]
  expect(nextAdjustmentLayerName("brightness-contrast", existing)).toBe("Brightness/Contrast 3")

  const layer = createAdjustmentLayer({
    filterId: "brightness-contrast",
    width: 12,
    height: 8,
    layers: existing,
    makeCanvas: fixtureCanvas,
    clipped: true,
  })

  expect(layer).toMatchObject({
    kind: "adjustment",
    name: "Brightness/Contrast 3",
    clipped: true,
    adjustment: { type: "brightness-contrast", params: { brightness: 0, contrast: 0, useLegacy: false } },
  })
  expect(layer.canvas.width).toBe(12)
  expect(layer.mask?.height).toBe(8)
  expect(isAdjustmentNoop(layer.adjustment)).toBe(true)
  expect(isAdjustmentNoop({ type: "invert", params: {} })).toBe(false)
})

test("advanced subsystem import normalizers strip unsafe data and preserve valid credentials", () => {
  expect(cleanImportText(" \u0000Safe\u202E   Name ", "Fallback")).toBe("Safe Name")

  const credentials = normalizeCredentialImportPayload({
    credentials: [
      {
        id: "cred_1",
        action: "Edited",
        actor: "Tester",
        software: "Photoshop Web",
        createdAt: "2026-06-24T00:00:00Z",
        documentName: "Doc",
        documentHash: "AABBCCDDEEFF0011",
        layerCount: 3,
        dimensions: { width: 4000, height: 3000 },
        ingredients: [
          { id: "ingredient_1", name: "Layer", kind: "layer", visible: false, hash: "ABCDEF12" },
          { id: "bad", hash: "not hex" },
        ],
        assertion: "Provenance",
      },
    ],
  })

  expect(credentials).toHaveLength(1)
  expect(credentials[0]).toMatchObject({
    id: "cred_1",
    documentHash: "aabbccddeeff0011",
    ingredients: [{ id: "ingredient_1", visible: false, hash: "abcdef12" }],
  })

  const asset = normalizeDropletImportPayload({
    asset: {
      id: "__proto__",
      name: " Imported   Droplet ",
      kind: "tool-preset",
      group: "Tools",
      createdAt: 42,
      payload: {
        ok: true,
        "__proto__": { polluted: true },
        "bad key": "dropped",
        nested: { value: "x" },
      },
    },
  })

  expect(asset.id).toMatch(/^asset_/)
  expect(asset.name).toBe("Imported Droplet")
  expect(asset.payload).toEqual({ ok: true, nested: { value: "x" } })
  expect(Object.prototype).not.toHaveProperty("polluted")
  expect(() => normalizeCredentialImportPayload({ credentials: [{ documentHash: "bad" }] })).toThrow(/valid manifests/)
  expect(() => normalizeDropletImportPayload({ kind: "unknown" })).toThrow(/recognisable asset/)
})

test("command DSL parses safe calls, rejects unsafe source, and runs through the allow-listed host API", async () => {
  expect(parseDslSource('// comment\napi.setTool("brush");\napi.commit("Done")')).toEqual([
    { method: "setTool", args: ["brush"], lineNumber: 2 },
    { method: "commit", args: ["Done"], lineNumber: 3 },
  ])
  expect(validateDsl("window.alert(1)")).toMatchObject({ ok: false, error: expect.stringContaining("api.method") })

  const calls: Record<string, unknown> = {}
  const layer = { id: "layer_1", name: "Original" } as Layer
  const doc = {
    id: "doc_1",
    name: "Script Doc",
    width: 64,
    height: 48,
    layers: [layer],
  } as PsDocument
  const api: DslHostApi = {
    log: (message) => {
      calls.log = [...((calls.log as string[] | undefined) ?? []), message]
    },
    doc: () => doc,
    activeLayer: () => layer,
    setTool: (tool) => { calls.tool = tool },
    setForeground: (color) => { calls.foreground = color },
    setBackground: (color) => { calls.background = color },
    setBrush: (patch) => { calls.brush = patch },
    renameLayer: (id, name) => { calls.rename = { id, name } },
    newLayer: () => "layer_new",
    duplicateLayer: () => null,
    deleteLayer: () => {},
    setLayerVisibility: () => {},
    setLayerOpacity: (id, opacity) => { calls.opacity = { id, opacity } },
    setLayerBlendMode: () => {},
    selectAll: () => {},
    deselect: () => {},
    invertSelection: () => {},
    flattenImage: () => {},
    createAdjustmentLayer: () => "adjustment_1",
    applyFilterToLayer: (id, filter, params) => { calls.filter = { id, filter: filter.id, params } },
    applyAdjustmentToLayer: () => {},
    resolveFilter: (id) => FILTERS[id] ?? null,
    isAdjustmentType: (id): id is never => id === "brightness-contrast",
    requestRender: () => { calls.rendered = true },
    commit: (label, layerIds) => { calls.commit = { label, layerIds } },
    wait: async () => {},
  }

  const result = await runDsl(
    [
      'api.setTool("brush")',
      'api.setForeground("#abcdef")',
      'api.setBrush({"size":999,"opacity":-10})',
      'api.renameLayer("active","  Retouched  ")',
      'api.setLayerOpacity("active", 2)',
      'api.applyFilter("gaussian-blur", {"radius":999})',
      'api.commit("  Finish  ", ["layer_1"])',
    ].join("\n"),
    api,
  )

  expect(result.commandsRun).toBe(7)
  expect(calls).toMatchObject({
    tool: "brush",
    foreground: "#abcdef",
    brush: { size: 500, opacity: 0 },
    rename: { id: "layer_1", name: "Retouched" },
    opacity: { id: "layer_1", opacity: 1 },
    filter: { id: "layer_1", filter: "gaussian-blur", params: { radius: 100 } },
    commit: { label: "Finish", layerIds: ["layer_1"] },
    rendered: true,
  })
  await expect(runDsl('api.setForeground("red")', api)).rejects.toThrow(/#RRGGBB/)
})

test("contextual help covers known tools and reflects document and selection state", () => {
  expect(listToolsWithHelp()).toContain("brush")
  expect(contextualHelpForTool("brush").some((tip) => tip.relatedPanel === "brush")).toBe(true)

  const help = computeContextualHelp({
    toolId: "unknown-tool" as never,
    selection: { bounds: { x: 0, y: 0, w: 8, h: 8 }, shape: "rect", feather: 3, mask: null },
    doc: {
      id: "doc_1",
      name: "Deep Doc",
      width: 10,
      height: 10,
      colorMode: "CMYK",
      bitDepth: 16,
      layers: Array.from({ length: 51 }, (_, index) => ({ id: `layer_${index}` })),
      notes: [{ id: "note_1", x: 1, y: 1, text: "Check" }],
    } as unknown as PsDocument,
  })

  expect(help.toolTips[0]).toMatchObject({ id: "tool-unknown-tool-generic", relatedPanel: "properties" })
  expect(help.selectionTips.map((tip) => tip.id)).toEqual(["selection-small", "selection-feather"])
  expect(help.documentTips.map((tip) => tip.id)).toEqual([
    "doc-color-mode",
    "doc-bit-depth",
    "doc-many-layers",
    "doc-notes",
  ])
  expect(help.fallback).not.toHaveLength(0)
})

test("OPFS scratch planner enforces reserve, quota, budget, and key rules", () => {
  expect(planScratchStorage({ pendingWriteBytes: 10, currentUsageBytes: 5, quotaBytes: 100 })).toMatchObject({
    strategy: "persist",
    reason: "ok",
    projectedUsageBytes: 15,
    effectiveLimitBytes: 90,
  })
  expect(planScratchStorage({ pendingWriteBytes: 10, currentUsageBytes: 0, quotaBytes: 0 })).toMatchObject({
    strategy: "in-memory-fallback",
    reason: "no-quota-data",
  })
  expect(planScratchStorage({ pendingWriteBytes: 95, currentUsageBytes: 0, quotaBytes: 100 })).toMatchObject({
    strategy: "in-memory-fallback",
    reason: "exceeds-scratch-budget",
  })
  expect(planScratchStorage({ pendingWriteBytes: 101, currentUsageBytes: 0, quotaBytes: 100 })).toMatchObject({
    strategy: "reject",
    reason: "quota-exhausted",
  })
  expect(isValidScratchKey("tiles.doc_1.0-0")).toBe(true)
  expect(isValidScratchKey("../escape")).toBe(false)
  expect(() => assertValidScratchKey("bad key")).toThrow(/scratch key/)
})

test("tool preset import/export normalizes IDs, payloads, and merge ordering", () => {
  const existing: AssetLibraryItem[] = [
    { id: "brush_a", name: "Old Brush", kind: "tool-preset", group: "B", createdAt: 1, payload: { size: 8 } },
  ]
  const incoming = normalizeToolPresetAssets({
    presets: [
      { id: "brush_a", name: "New Brush", kind: "tool-preset", group: "A", createdAt: 2, payload: { size: 20 } },
      { id: "__proto__", name: "Unsafe", payload: { size: 4 } },
      { id: "skip", name: "Not a preset" },
    ],
  })

  expect(incoming).toHaveLength(2)
  expect(incoming[0]).toMatchObject({ id: "brush_a", name: "New Brush", group: "A", payload: { size: 20 } })
  expect(incoming[1].id).toMatch(/^tool_preset_/)
  expect(incoming[1]).toMatchObject({ name: "Unsafe", kind: "tool-preset", group: "Tools" })

  const merged = mergeToolPresetAssets(existing, incoming)
  expect(merged.map((preset) => preset.name)).toEqual(["New Brush", "Unsafe"])
  expect(JSON.parse(serializeToolPresetAssets(merged))).toMatchObject({
    app: "Photoshop Web",
    format: "ps-tool-presets",
    version: 1,
    presets: merged,
  })
})
