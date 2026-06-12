import { expect, test } from "@playwright/test"

import {
  EDITOR_SETTINGS_KEY,
  filterPersistedEditorSettingsForHydration,
  loadPersistedEditorSettings,
  savePersistedEditorSettings,
  serializePersistedEditorSettings,
  type PersistedEditorDefaults,
  type PersistedEditorState,
} from "../components/photoshop/editor-persisted-settings"

const defaults: PersistedEditorDefaults = {
  brush: {
    size: 30,
    hardness: 80,
    opacity: 100,
    flow: 100,
    smoothing: 10,
    spacing: 25,
    tipShape: "round",
    erodibleTip: { sharpness: 70, flatness: 35, erosionRate: 50, softness: 20, aspectRatio: 80, rotation: 0 },
    bristleTip: { length: 65, density: 55, thickness: 35, stiffness: 55, splay: 35, wetness: 25 },
    mixer: { wet: 55, load: 60, mix: 50, flow: 100, sampleAllLayers: false, cleanAfterStroke: false },
    colorReplacement: { sampling: "continuous", limits: "contiguous", mode: "color", tolerance: 32, antiAlias: true },
    artHistory: { style: "tight-medium", area: 24, fidelity: 60 },
  },
  gradient: { type: "linear", reverse: false },
  symmetry: { enabled: false, axis: "vertical" },
}

function memoryStorage(initial?: Record<string, string>): Storage {
  const data = new Map(Object.entries(initial ?? {}))
  return {
    get length() {
      return data.size
    },
    clear() {
      data.clear()
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null
    },
    key(index: number) {
      return [...data.keys()][index] ?? null
    },
    removeItem(key: string) {
      data.delete(key)
    },
    setItem(key: string, value: string) {
      data.set(key, value)
    },
  }
}

test("filters persisted editor settings to the saved schema", () => {
  const filtered = filterPersistedEditorSettingsForHydration(
    {
      foreground: "#102030",
      background: "url(https://attacker.example/pixel.gif)",
      brush: {
        size: 42,
        smoothing: 15,
        injectedField: "leak",
        constructor: { prototype: { polluted: true } },
      },
      gradient: {
        type: "radial",
        reverse: true,
        injectedField: "leak",
      },
      symmetry: {
        enabled: true,
        axis: "horizontal",
        injectedField: "leak",
      },
      ignoredTopLevel: true,
    },
    defaults,
  )

  expect(filtered.foreground).toBe("#102030")
  expect(filtered.background).toBeUndefined()
  expect(filtered.brush).toMatchObject({ ...defaults.brush, size: 42, smoothing: 15 })
  expect(Object.prototype.hasOwnProperty.call(filtered.brush, "injectedField")).toBe(false)
  expect(Object.prototype.hasOwnProperty.call(filtered.brush, "constructor")).toBe(false)
  expect(filtered.gradient).toEqual({ type: "radial", reverse: true })
  expect(filtered.symmetry).toEqual({ enabled: true, axis: "horizontal" })
  expect(filtered).not.toHaveProperty("ignoredTopLevel")
})

test("sanitizes nested persisted values before allow-listing fields", () => {
  const oversized = "x".repeat(1100)
  const filtered = filterPersistedEditorSettingsForHydration(
    JSON.parse(JSON.stringify({
      brush: {
        mixer: {
          reservoirColor: oversized,
          sampleAllLayers: true,
          "__proto__": { polluted: true },
          "bad key": "dropped",
        },
        artHistory: {
          style: "tight-medium",
          values: Array.from({ length: 300 }, (_, index) => index),
        },
      },
    })),
    defaults,
  )

  expect(filtered.brush?.mixer?.sampleAllLayers).toBe(true)
  expect(filtered.brush?.mixer?.reservoirColor).toHaveLength(1024)
  expect(Object.prototype.hasOwnProperty.call(filtered.brush?.mixer, "__proto__")).toBe(false)
  expect(Object.prototype.hasOwnProperty.call(filtered.brush?.mixer, "bad key")).toBe(false)
  expect((filtered.brush?.artHistory as { values?: unknown[] } | undefined)?.values).toHaveLength(256)
})

test("serializes only the persisted subset of editor state", () => {
  const state: PersistedEditorState = {
    foreground: "#111111",
    background: "#eeeeee",
    brush: {
      ...defaults.brush,
      size: 64,
      sizeJitter: 90,
      texture: { enabled: true, pattern: "noise", mode: "multiply", depth: 50, depthJitter: 5, minDepth: 10, scale: 100 },
    },
    gradient: { type: "radial", reverse: true, dither: true },
    symmetry: { enabled: true, axis: "horizontal", segments: 4 },
  }

  expect(serializePersistedEditorSettings(state)).toEqual({
    foreground: "#111111",
    background: "#eeeeee",
    brush: {
      size: 64,
      hardness: 80,
      opacity: 100,
      flow: 100,
      smoothing: 10,
      spacing: 25,
      tipShape: "round",
      erodibleTip: defaults.brush.erodibleTip,
      bristleTip: defaults.brush.bristleTip,
      mixer: defaults.brush.mixer,
      colorReplacement: defaults.brush.colorReplacement,
      artHistory: defaults.brush.artHistory,
    },
    gradient: state.gradient,
    symmetry: state.symmetry,
  })
})

test("loads and saves persisted settings through guarded storage access", () => {
  const storage = memoryStorage()
  const state: PersistedEditorState = {
    foreground: "#123456",
    background: "#abcdef",
    brush: { ...defaults.brush, size: 22 },
    gradient: { type: "linear", reverse: true },
    symmetry: { enabled: true, axis: "vertical" },
  }

  savePersistedEditorSettings(state, storage)

  expect(JSON.parse(storage.getItem(EDITOR_SETTINGS_KEY)!)).toMatchObject({
    foreground: "#123456",
    brush: { size: 22 },
  })
  expect(loadPersistedEditorSettings(defaults, storage)).toMatchObject({
    foreground: "#123456",
    background: "#abcdef",
    brush: { ...defaults.brush, size: 22 },
    gradient: { type: "linear", reverse: true },
    symmetry: { enabled: true, axis: "vertical" },
  })
  expect(loadPersistedEditorSettings(defaults, memoryStorage({ [EDITOR_SETTINGS_KEY]: "not json" }))).toEqual({})
})
