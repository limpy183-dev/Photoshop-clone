import { expect, test } from "@playwright/test"

import { POST as postFeedback } from "../app/api/feedback/route"
import { POST as postSubscribe } from "../app/api/subscribe/route"
import {
  MAX_CANVAS_DIMENSION,
  MAX_CANVAS_PIXELS,
  MAX_PROJECT_CHANNELS,
  MAX_PROJECT_LAYERS,
  MAX_PROJECT_SMART_FILTERS_PER_LAYER,
  assertCanvasSize,
  assertFileSize,
  clampCanvasSize,
} from "../components/photoshop/canvas-limits"
import {
  clearClientStorageByPrivacy,
  getClientStorageRegistry,
  readClientStorageJson,
  readClientStorageString,
  registerClientStorageKey,
  writeClientStorageJson,
  writeClientStorageString,
  type ClientStorageKey,
} from "../components/photoshop/client-storage"
import { canvasFromDataUrl, deserializeProject } from "../components/photoshop/document-io"
import { filterPersistedSettingsForHydration } from "../components/photoshop/editor-context"
import { readRecentDocuments } from "../components/photoshop/recent-documents"
import { installFixtureDom } from "./photoshop-fixtures"

function jsonRequest(payload: unknown): Request {
  return new Request("http://127.0.0.1/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  })
}

function serializedLayer(id: string) {
  return {
    id,
    name: id,
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
  }
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
      return data.get(key) ?? null
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

test("API JSON schemas reject malformed and over-budget payloads", async () => {
  const malformedFeedback = await postFeedback(jsonRequest("{"))
  expect(malformedFeedback.status).toBe(400)
  await expect(malformedFeedback.json()).resolves.toMatchObject({
    ok: false,
    error: "Body must be valid JSON.",
  })

  const longFeedback = await postFeedback(jsonRequest({ message: "x".repeat(2001) }))
  expect(longFeedback.status).toBe(400)
  await expect(longFeedback.json()).resolves.toMatchObject({
    ok: false,
    error: "Keep it under 2000 characters.",
  })

  const longSubscribeSource = await postSubscribe(jsonRequest({
    email: "artist@example.com",
    source: "x".repeat(65),
  }))
  expect(longSubscribeSource.status).toBe(400)
  await expect(longSubscribeSource.json()).resolves.toMatchObject({ ok: false })
})

test("shared import limit helpers reject oversized canvases and files", () => {
  expect(() => assertCanvasSize(MAX_CANVAS_DIMENSION + 1, 1, "Project canvas")).toThrow(
    /Project canvas is too large/,
  )

  const clamped = clampCanvasSize(100_000, 100_000)
  expect(clamped.width).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
  expect(clamped.height).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
  expect(clamped.width * clamped.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)

  const file = { size: 2 * 1024 * 1024 } as File
  expect(() => assertFileSize(file, 1024 * 1024, "Project file")).toThrow(
    "Project file is too large. Maximum file size is 1 MB.",
  )
})

test("project JSON import enforces layer, channel, and canvas payload limits", async () => {
  installFixtureDom()

  const tooManyLayers = JSON.stringify({
    width: 16,
    height: 16,
    layers: Array.from({ length: MAX_PROJECT_LAYERS + 1 }, (_, index) => serializedLayer(`layer_${index}`)),
  })
  await expect(deserializeProject(`wrapped-prefix ${tooManyLayers} wrapped-suffix`)).rejects.toThrow(
    `Project contains too many layers. Maximum supported layers: ${MAX_PROJECT_LAYERS}.`,
  )

  const tooManyChannels = JSON.stringify({
    width: 16,
    height: 16,
    layers: [serializedLayer("layer_1")],
    channels: Array.from({ length: MAX_PROJECT_CHANNELS + 1 }, (_, index) => ({
      id: `channel_${index}`,
      name: `Channel ${index}`,
    })),
  })
  await expect(deserializeProject(tooManyChannels)).rejects.toThrow(
    `Project contains too many alpha channels. Maximum supported channels: ${MAX_PROJECT_CHANNELS}.`,
  )

  const tooManySmartFilters = JSON.stringify({
    width: 16,
    height: 16,
    layers: [{
      ...serializedLayer("layer_1"),
      smartFilters: Array.from({ length: MAX_PROJECT_SMART_FILTERS_PER_LAYER + 1 }, (_, index) => ({
        id: `filter_${index}`,
      })),
    }],
  })
  await expect(deserializeProject(tooManySmartFilters)).rejects.toThrow(
    `Project layer contains too many smart filters. Maximum supported: ${MAX_PROJECT_SMART_FILTERS_PER_LAYER}.`,
  )

  await expect(canvasFromDataUrl("https://example.com/tracker.png", 1, 1)).rejects.toThrow(
    "Project contains unsupported or oversized canvas image data",
  )
})

test("recent documents strip bidi controls from display and file names", () => {
  const store = new Map<string, string>()
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  }
  const originalWindow = globalThis.window
  const originalLocalStorage = globalThis.localStorage

  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: storage },
    })
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    })
    storage.setItem("ps-recent-documents-v1", JSON.stringify([{
      id: "recent-1",
      kind: "project",
      name: "report\u202Egnp.exe-frames",
      fileName: "report\u202Egnp.exe-frames.psprojson",
      serialized: "{}",
      updatedAt: Date.now(),
    }]))

    expect(readRecentDocuments()[0]).toMatchObject({
      fileName: "reportgnp.exe-frames.psprojson",
      name: "reportgnp.exe-frames",
    })
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    })
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    })
  }
})

test("client storage adapter applies schema fallback and reports quota failures", () => {
  const descriptor: ClientStorageKey<{ saved: boolean }> = {
    key: "ps-test-storage",
    version: 1,
    privacy: "preference",
    description: "Test storage descriptor",
    fallback: { saved: false },
  }
  const storage = memoryStorage({ [descriptor.key]: "{not-json" })
  expect(readClientStorageJson(descriptor, { storage })).toEqual({ saved: false })

  expect(writeClientStorageJson(descriptor, { saved: true }, { storage })).toEqual({ ok: true })
  expect(readClientStorageJson(descriptor, { storage })).toEqual({ saved: true })

  const quotaStorage = {
    ...memoryStorage(),
    setItem() {
      throw new DOMException("Quota exceeded", "QuotaExceededError")
    },
  } as Storage
  expect(writeClientStorageJson(descriptor, { saved: true }, { storage: quotaStorage })).toMatchObject({
    ok: false,
    reason: "quota",
  })
})

test("client storage string helper preserves legacy raw string values", () => {
  const descriptor: ClientStorageKey<string | null> = {
    key: "ps-test-string-storage",
    version: 1,
    privacy: "preference",
    description: "Test string storage descriptor",
    fallback: null,
    parse(value: unknown) {
      return typeof value === "string" ? value : null
    },
  }
  const storage = memoryStorage({ [descriptor.key]: "false" })

  expect(readClientStorageString(descriptor, { storage })).toBe("false")
  expect(writeClientStorageString(descriptor, "true", { storage })).toEqual({ ok: true })
  expect(storage.getItem(descriptor.key)).toBe("true")
})

test("client storage registry validates payload schemas and clears by privacy class", () => {
  const descriptor = registerClientStorageKey({
    key: "ps-test-registered-storage",
    version: 1,
    privacy: "diagnostic",
    description: "Registered storage descriptor",
    fallback: { enabled: false },
    parse(value: unknown) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null
      const enabled = (value as { enabled?: unknown }).enabled
      return typeof enabled === "boolean" ? { enabled } : null
    },
  })

  const storage = memoryStorage({
    [descriptor.key]: JSON.stringify({ enabled: true }),
    "ps-test-registered-storage-invalid": JSON.stringify({ enabled: "yes" }),
  })
  expect(getClientStorageRegistry().some((entry) => entry.key === descriptor.key)).toBe(true)
  expect(readClientStorageJson(descriptor, { storage })).toEqual({ enabled: true })
  expect(readClientStorageJson({
    ...descriptor,
    key: "ps-test-registered-storage-invalid",
  }, { storage })).toEqual({ enabled: false })

  expect(clearClientStorageByPrivacy("diagnostic", { storage })).toEqual({ ok: true })
  expect(storage.getItem(descriptor.key)).toBeNull()
})

test("client storage registry covers editor preference, preset, automation, and project key families", () => {
  const registry = getClientStorageRegistry()
  const byKey = new Map(registry.map((entry) => [entry.key, entry]))

  for (const key of [
    "ps-preferences",
    "ps-custom-shortcuts",
    "ps-command-palette-recent",
    "ps-command-palette-usage-v1",
    "ps-panel-dock-state-v2",
    "ps-current-workspace-preset",
    "ps-status-bar-visible",
    "ps-panel-split",
    "ps-contextual-task-bar-position",
    "ps-editor-settings",
    "ps.shadowsHighlights.defaults",
    "ps.auto.options",
    "ps-notes-author",
    "ps-measurement-log-prefs",
    "ps-workspaces-v2",
    "ps-menu-customization",
    "ps-menu-presets",
    "ps-pinned-documents-v1",
    "ps-swatches",
    "ps-recent-swatches",
    "ps-gradients",
    "ps-patterns",
    "ps-shape-presets",
    "ps-filter-gallery-stack-presets-v1",
    "ps-glyphs-recent",
    "ps.cameraRaw.userPresets.v1",
    "ps.cameraRaw.snapshots.v1",
    "ps-contact-sheet-presets-v1",
    "ps-action-envelopes",
    "ps-action-playback-speed",
    "ps-command-macros-v1",
    "ps-automation-workflows-v1",
    "ps-command-macros",
    "ps-droplets",
  ]) {
    expect(byKey.get(key), key).toBeTruthy()
  }

  expect(new Set(registry.map((entry) => entry.privacy))).toEqual(
    new Set(["preference", "project-data", "autosave", "preset-library", "automation-plugin", "diagnostic"]),
  )
})

test("persisted editor settings drop keys outside the saved settings schema", () => {
  const filtered = filterPersistedSettingsForHydration({
    background: "url(https://attacker.example/pixel.gif)",
    foreground: "#102030",
    brush: {
      size: 42,
      injectedField: "leak",
      constructor: { prototype: { polluted: true } },
    },
    gradient: {
      reverse: true,
      type: "radial",
      injectedField: "leak",
    },
    symmetry: {
      axis: "horizontal",
      enabled: true,
      injectedField: "leak",
    },
  })

  expect(filtered.background).toBeUndefined()
  expect(filtered.foreground).toBe("#102030")
  expect(filtered.brush).toMatchObject({ size: 42 })
  expect(filtered.brush).not.toHaveProperty("injectedField")
  expect(filtered.gradient).toEqual({ type: "radial", reverse: true })
  expect(filtered.symmetry).toEqual({ enabled: true, axis: "horizontal" })
})
