import { expect, test } from "@playwright/test"
import {
  addPhotoshopEventListener,
  dispatchPhotoshopEvent,
  type PhotoshopEventMap,
} from "../components/photoshop/events"

test("typed photoshop event helpers dispatch detail and return an unsubscribe", () => {
  const received: PhotoshopEventMap["ps-request-zoom"][] = []
  const unsubscribe = addPhotoshopEventListener("ps-request-zoom", (detail) => {
    received.push(detail)
  })

  dispatchPhotoshopEvent("ps-request-zoom", { factor: 1.25 })
  unsubscribe()
  dispatchPhotoshopEvent("ps-request-zoom", { zoom: 2 })

  expect(received).toEqual([{ factor: 1.25 }])
})

test("typed photoshop events cover preference and local editor storage notifications", () => {
  const received: Array<keyof PhotoshopEventMap> = []
  const removePreferences = addPhotoshopEventListener("ps-preferences-changed", (detail) => {
    expect(detail).toMatchObject({ rulerGrid: expect.any(Object) })
    received.push("ps-preferences-changed")
  })
  const removeHistory = addPhotoshopEventListener("ps-preferences-history-log-changed", () => {
    received.push("ps-preferences-history-log-changed")
  })
  const removeShortcuts = addPhotoshopEventListener("ps-shortcuts-changed", (detail) => {
    expect(detail).toEqual({ "file-open": "Ctrl+Alt+O" })
    received.push("ps-shortcuts-changed")
  })
  const removeRecentColors = addPhotoshopEventListener("ps-recent-colors-updated", (detail) => {
    expect(detail).toEqual(["#102030"])
    received.push("ps-recent-colors-updated")
  })

  dispatchPhotoshopEvent("ps-preferences-changed", { rulerGrid: {} })
  dispatchPhotoshopEvent("ps-preferences-history-log-changed", { entries: [] })
  dispatchPhotoshopEvent("ps-shortcuts-changed", { "file-open": "Ctrl+Alt+O" })
  dispatchPhotoshopEvent("ps-recent-colors-updated", ["#102030"])

  removePreferences()
  removeHistory()
  removeShortcuts()
  removeRecentColors()

  expect(received).toEqual([
    "ps-preferences-changed",
    "ps-preferences-history-log-changed",
    "ps-shortcuts-changed",
    "ps-recent-colors-updated",
  ])
})

test("typed photoshop events cover command palette routing events", () => {
  const received: string[] = []
  const removePlugin = addPhotoshopEventListener("ps-run-plugin-command", (detail) => {
    expect(detail).toEqual({ pluginId: "plugin_a", commandId: "command_b" })
    received.push("plugin")
  })
  const removeLayerSearch = addPhotoshopEventListener("ps-focus-layer-search", () => {
    received.push("layer-search")
  })
  const removeWorkspaceManager = addPhotoshopEventListener("ps-open-workspace-manager", () => {
    received.push("workspace-manager")
  })

  dispatchPhotoshopEvent("ps-run-plugin-command", { pluginId: "plugin_a", commandId: "command_b" })
  dispatchPhotoshopEvent("ps-focus-layer-search")
  dispatchPhotoshopEvent("ps-open-workspace-manager")

  removePlugin()
  removeLayerSearch()
  removeWorkspaceManager()

  expect(received).toEqual(["plugin", "layer-search", "workspace-manager"])
})

test("typed photoshop events cover options bar and workspace routing events", () => {
  const received: string[] = []
  const removeWorkspacePreset = addPhotoshopEventListener("ps-workspace-preset-changed", (detail) => {
    expect(detail).toEqual({ preset: "photography" })
    received.push("workspace-preset")
  })
  const removeClearSlices = addPhotoshopEventListener("ps-clear-slices", () => {
    received.push("clear-slices")
  })
  const removeClearRuler = addPhotoshopEventListener("ps-clear-ruler", () => {
    received.push("clear-ruler")
  })

  dispatchPhotoshopEvent("ps-workspace-preset-changed", { preset: "photography" })
  dispatchPhotoshopEvent("ps-clear-slices")
  dispatchPhotoshopEvent("ps-clear-ruler")

  removeWorkspacePreset()
  removeClearSlices()
  removeClearRuler()

  expect(received).toEqual(["workspace-preset", "clear-slices", "clear-ruler"])
})

test("typed photoshop events cover image asset generator routing events", () => {
  const received: string[] = []
  const directoryHandle = { name: "exports" }
  const removeRun = addPhotoshopEventListener("ps-image-assets-generator-run", (detail) => {
    expect(detail).toEqual({ docId: "doc_1" })
    received.push("run")
  })
  const removeDirectory = addPhotoshopEventListener("ps-image-assets-generator-directory", (detail) => {
    expect(detail).toEqual({ docId: "doc_1", directoryHandle })
    received.push("directory")
  })

  dispatchPhotoshopEvent("ps-image-assets-generator-run", { docId: "doc_1" })
  dispatchPhotoshopEvent("ps-image-assets-generator-directory", { docId: "doc_1", directoryHandle })

  removeRun()
  removeDirectory()

  expect(received).toEqual(["run", "directory"])
})
