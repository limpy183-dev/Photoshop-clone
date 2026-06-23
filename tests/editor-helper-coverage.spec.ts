import { expect, test } from "@playwright/test"

import { FILTER_META, getFilterMeta, getFilterName } from "../components/photoshop/filters-meta"
import { FILTERS } from "../components/photoshop/filters"
import {
  DEFAULT_MENU_CUSTOMIZATION,
  MENU_CUSTOMIZATION_STORAGE_KEY,
  addMenuPreset,
  isMenuItemVisible,
  loadMenuCustomization,
  moveMenuItem,
  normaliseMenuCustomization,
  orderMenuItems,
  removeMenuPreset,
  saveMenuCustomization,
  setMenuItemVisible,
  setMenuOrder,
} from "../components/photoshop/menu-customization"
import {
  NEW_DOCUMENT_PRESET_GROUPS,
  NEW_DOCUMENT_PRESETS,
  estimateDocumentMemoryMb,
  findNewDocumentPreset,
  modeSettings,
  pixelsToUnit,
  unitToPixels,
} from "../components/photoshop/new-document-presets"
import {
  MAX_RECENT_COLORS,
  RECENT_COLORS_STORAGE_KEY,
  RECENT_COLORS_UPDATED_EVENT,
  clearRecentColors,
  loadRecentColors,
  normalizeRecentColors,
  pushRecentColor,
  saveRecentColors,
} from "../components/photoshop/recent-colors"
import {
  GRADIENT_STORAGE_KEY,
  PATTERN_STORAGE_KEY,
  isAssetKind,
  loadManagedGradients,
  loadManagedPatterns,
  normalizeGradientStops,
  normalizeGradients,
  normalizePatterns,
  saveManagedGradients,
  saveManagedPatterns,
  scopedStorageKey,
} from "../components/photoshop/preset-stores"
import { addPhotoshopEventListener } from "../components/photoshop/events"
import { createDocumentFromPreset } from "../components/photoshop/startup-documents"
import {
  GENERIC_TOOLTIP_CONTENT,
  TOOL_TOOLTIP_CONTENT,
  getToolTooltipEntry,
} from "../components/photoshop/tool-tooltip-content"
import { installFixtureDom } from "./photoshop-fixtures"

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value))
  }
}

function installBrowserStorage() {
  const storage = new MemoryStorage()
  const target = new EventTarget()
  const windowStub = Object.assign(target, { localStorage: storage })
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowStub })
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage })
  return { storage, windowStub }
}

test.beforeEach(() => {
  installFixtureDom()
  installBrowserStorage()
})

test.afterEach(() => {
  Reflect.deleteProperty(globalThis, "window")
  Reflect.deleteProperty(globalThis, "localStorage")
  Reflect.deleteProperty(globalThis, "document")
})

test("new document presets cover every advertised group and resolve by exact name", () => {
  const actualGroups = new Set(NEW_DOCUMENT_PRESETS.map((preset) => preset.group))

  expect(actualGroups).toEqual(new Set(NEW_DOCUMENT_PRESET_GROUPS))
  expect(findNewDocumentPreset("US Letter")).toMatchObject({
    group: "Print",
    w: 2550,
    h: 3300,
    dpi: 300,
    mode: "CMYK",
  })
  expect(findNewDocumentPreset("us letter")).toBeNull()
  expect(findNewDocumentPreset(null)).toBeNull()
})

test("document units round-trip at print resolution and memory estimates honor bit depth", () => {
  for (const unit of ["px", "in", "cm", "mm"] as const) {
    const pixels = unitToPixels(12.5, unit, 300)
    expect(pixelsToUnit(pixels, unit, 300)).toBeCloseTo(12.5, 8)
  }

  expect(unitToPixels(2.54, "cm", 300)).toBeCloseTo(300)
  expect(unitToPixels(25.4, "mm", 300)).toBeCloseTo(300)
  expect(estimateDocumentMemoryMb(1024, 1024, 8)).toBe(4)
  expect(estimateDocumentMemoryMb(1024, 1024, 16)).toBe(8)
  expect(estimateDocumentMemoryMb(1024, 1024, 32)).toBe(16)
})

test("mode settings provide complete defaults for special document modes", () => {
  expect(modeSettings("Indexed")).toEqual({ mode: "Indexed", indexed: { colors: 256, dither: true } })
  expect(modeSettings("Bitmap")).toMatchObject({
    mode: "Bitmap",
    bitmap: { method: "halftone", threshold: 128, frequency: 45, outputResolution: 300 },
  })
  expect(modeSettings("Multichannel").multichannel?.channels).toEqual({
    r: true,
    g: true,
    b: true,
    c: true,
    m: true,
    y: true,
    k: true,
  })
  expect(modeSettings("Duotone")).toMatchObject({
    mode: "Duotone",
    duotone: { inkCount: 2, opacity1: 100, opacity2: 70, overprint: "normal" },
  })
  expect(modeSettings("RGB")).toEqual({ mode: "RGB" })
})

test("creating a high-bit preset document applies metadata and retains a typed source", () => {
  const doc = createDocumentFromPreset({
    name: "Tiny 16-bit",
    group: "Recent",
    w: 2,
    h: 1,
    dpi: 240,
    mode: "RGB",
    bitDepth: 16,
  })
  const highBit = (doc as typeof doc & {
    __highBitImageData?: { bitDepth: number; width: number; height: number; data: Uint16Array }
  }).__highBitImageData

  expect(doc).toMatchObject({
    name: "Tiny 16-bit",
    width: 2,
    height: 1,
    dpi: 240,
    colorMode: "RGB",
    bitDepth: 16,
    modeSettings: { mode: "RGB" },
  })
  expect(highBit).toMatchObject({ bitDepth: 16, width: 2, height: 1 })
  expect(highBit?.data).toBeInstanceOf(Uint16Array)
})

test("recent colors normalize, deduplicate, cap, persist, and emit updates", () => {
  const observed: string[][] = []
  window.addEventListener(RECENT_COLORS_UPDATED_EVENT, (event) => {
    observed.push((event as CustomEvent<string[]>).detail)
  })
  const input = [
    " #AABBCC ",
    "#aabbcc",
    "not-a-color",
    ...Array.from({ length: 30 }, (_, index) => `#${index.toString(16).padStart(6, "0")}`),
  ]

  const normalized = normalizeRecentColors(input)
  expect(normalized).toHaveLength(MAX_RECENT_COLORS)
  expect(normalized[0]).toBe("#aabbcc")

  saveRecentColors(["#112233", "#445566"])
  expect(JSON.parse(localStorage.getItem(RECENT_COLORS_STORAGE_KEY) ?? "[]")).toEqual(["#112233", "#445566"])
  expect(loadRecentColors()).toEqual(["#112233", "#445566"])
  expect(pushRecentColor("#445566", ["#112233", "#445566"])).toEqual(["#445566", "#112233"])
  expect(pushRecentColor("invalid", ["#112233"])).toEqual(["#112233"])
  expect(clearRecentColors()).toEqual([])
  expect(observed.at(-1)).toEqual([])
})

test("recent color loading tolerates malformed or blocked storage", () => {
  localStorage.setItem(RECENT_COLORS_STORAGE_KEY, "{bad json")
  expect(loadRecentColors()).toEqual([])

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => { throw new Error("blocked") } },
  })
  expect(loadRecentColors()).toEqual([])
})

test("menu customization sanitizes persisted data and preserves unknown menu items", () => {
  const normalized = normaliseMenuCustomization({
    hidden: ["File/Open", "File/Open", "<script>"],
    ordered: {
      File: ["File/Save", "File/Open", "File/Save", "<bad>"],
      "<bad>": ["File/Open"],
    },
    presetName: "x".repeat(100),
    updatedAt: 42,
  })

  expect(normalized).toEqual({
    hidden: ["File/Open"],
    ordered: { File: ["File/Save", "File/Open"] },
    presetName: "x".repeat(80),
    updatedAt: 42,
  })
  expect(orderMenuItems("File", ["File/Open", "File/Close", "File/Save"], normalized)).toEqual([
    "File/Save",
    "File/Open",
    "File/Close",
  ])
  expect(isMenuItemVisible("File/Open", normalized)).toBe(false)
  expect(isMenuItemVisible("File/Close", normalized)).toBe(true)
})

test("menu visibility and ordering helpers are immutable and bounded at list edges", () => {
  const hidden = setMenuItemVisible(DEFAULT_MENU_CUSTOMIZATION, "Edit/Undo", false)
  const shown = setMenuItemVisible(hidden, "Edit/Undo", true)
  const ordered = setMenuOrder(shown, "Edit", ["Edit/Undo", "Edit/Redo"])
  const moved = moveMenuItem(ordered, "Edit", "Edit/Redo", -1, [])

  expect(DEFAULT_MENU_CUSTOMIZATION.hidden).toEqual([])
  expect(hidden.hidden).toEqual(["Edit/Undo"])
  expect(shown.hidden).toEqual([])
  expect(moved.ordered.Edit).toEqual(["Edit/Redo", "Edit/Undo"])
  expect(moveMenuItem(moved, "Edit", "Edit/Redo", -1, [])).toBe(moved)
  expect(setMenuItemVisible(moved, "<invalid>", false)).toBe(moved)
})

test("menu customization persistence emits changes and preset helpers add and remove entries", () => {
  let changes = 0
  const removeChanges = addPhotoshopEventListener("ps-menu-customization-changed", () => changes++)
  saveMenuCustomization({ hidden: ["View/Grid"], ordered: {} })

  expect(changes).toBe(1)
  removeChanges()
  expect(loadMenuCustomization()).toMatchObject({ hidden: ["View/Grid"], ordered: {} })
  expect(localStorage.getItem(MENU_CUSTOMIZATION_STORAGE_KEY)).toContain("updatedAt")

  const presets = addMenuPreset([], "Workspace", { hidden: ["View/Grid"], ordered: {} })
  expect(presets[0]).toMatchObject({ name: "Workspace", customization: { hidden: ["View/Grid"] } })
  expect(removeMenuPreset(presets, presets[0].id)).toEqual([])
})

test("gradient normalization sorts and clamps valid stops while rejecting malformed entries", () => {
  expect(normalizeGradientStops([
    { offset: 1.5, color: "#ffffff" },
    { pos: -0.5, color: "rgba(0, 0, 0, 0.5)" },
    { pos: 0.4, color: "javascript:bad" },
  ])).toEqual([
    { pos: 0, color: "rgba(0, 0, 0, 0.5)" },
    { pos: 1, color: "#ffffff" },
  ])
  expect(normalizeGradientStops([{ pos: 0, color: "#000" }])).toEqual([
    { pos: 0, color: "#000000" },
    { pos: 1, color: "#ffffff" },
  ])

  const gradients = normalizeGradients({
    gradients: [{
      name: "  Sunset  ",
      group: "  Warm  ",
      stops: [{ pos: 1, color: "#fff" }, { pos: 0, color: "#000" }],
      createdAt: Infinity,
    }],
  })
  expect(gradients).toEqual([{
    id: "grad-1",
    name: "Sunset",
    category: "Warm",
    stops: [{ pos: 0, color: "#000" }, { pos: 1, color: "#fff" }],
    createdAt: undefined,
  }])
})

test("pattern normalization validates data URLs, dimensions, storage scope, and events", () => {
  const validData = "data:image/png;base64,AAAA"
  expect(normalizePatterns([
    { name: " Tile ", group: "", dataURL: validData, width: -20, height: 9000, createdAt: 12 },
    { name: "Unsafe", dataURL: "data:text/html;base64,AAAA", width: 1, height: 1 },
  ])).toEqual([{
    id: "pattern-1",
    name: "Tile",
    group: "User",
    dataURL: validData,
    width: 1,
    height: 4096,
    createdAt: 12,
  }])
  expect(scopedStorageKey(PATTERN_STORAGE_KEY, "doc-1")).toBe(`${PATTERN_STORAGE_KEY}:doc-1`)

  const events: unknown[] = []
  const removePatterns = addPhotoshopEventListener("ps-patterns-changed", (detail) => events.push(detail))
  saveManagedPatterns("doc-1", normalizePatterns([{ dataURL: validData, width: 4, height: 5 }]))
  expect(loadManagedPatterns("doc-1")).toMatchObject([{ width: 4, height: 5 }])
  expect(events).toHaveLength(1)
  removePatterns()
})

test("managed gradient storage and asset-kind validation cover accepted families", () => {
  const gradients = normalizeGradients([{
    id: "g",
    name: "Black White",
    stops: [{ pos: 0, color: "#000" }, { pos: 1, color: "#fff" }],
  }])
  saveManagedGradients(gradients)

  expect(localStorage.getItem(GRADIENT_STORAGE_KEY)).toBeTruthy()
  expect(loadManagedGradients()).toEqual(gradients)
  for (const kind of ["brush", "gradient", "pattern", "plugin", "font", "prepress"]) {
    expect(isAssetKind(kind)).toBe(true)
  }
  expect(isAssetKind("executable")).toBe(false)
})

test("filter metadata stays aligned with the executable filter registry", () => {
  for (const [id, filter] of Object.entries(FILTERS)) {
    expect(FILTER_META[id], `missing metadata for ${id}`).toMatchObject({ id, category: filter.category })
    expect(FILTER_META[id].name.trim(), `${id} display name`).not.toBe("")
  }
  for (const [id, meta] of Object.entries(FILTER_META)) {
    expect(meta.id).toBe(id)
  }
  expect(getFilterMeta("gaussian-blur")).toMatchObject({ name: "Gaussian Blur", category: "Blur" })
  expect(getFilterName("unknown-filter")).toBe("unknown-filter")
})

test("tool tooltip content provides useful copy for every registered tool", () => {
  const entries = Object.entries(TOOL_TOOLTIP_CONTENT)
  expect(entries.length).toBeGreaterThan(70)
  for (const [id, entry] of entries) {
    expect(entry.title.trim(), `${id} title`).not.toBe("")
    expect(entry.description.length, `${id} description`).toBeGreaterThan(20)
    expect(entry.previewKind.trim(), `${id} preview`).not.toBe("")
    expect(getToolTooltipEntry(id as keyof typeof TOOL_TOOLTIP_CONTENT)).toBe(entry)
  }
  expect(GENERIC_TOOLTIP_CONTENT["quick-mask"]).toMatchObject({
    previewKind: "quick-mask",
    learnTopic: "quick-mask",
  })
})
