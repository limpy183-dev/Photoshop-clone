import { expect, test } from "@playwright/test"

import { getCapability, listCapabilities } from "../components/photoshop/capabilities"
import {
  DEFAULT_PREFERENCES,
  appendHistoryLog,
  applyPreferencesToDocumentSettings,
  createHistoryLogEntry,
  deriveFileHandlingPolicy,
  exportPreferencesSet,
  formatHistoryLog,
  normalizePreferences,
  parsePreferencesSet,
  resetPreferencesSet,
  serializePreferences,
  summarizePerformancePolicy,
} from "../components/photoshop/preferences-engine"

test("normalizes legacy preference sets into the full schema", () => {
  const prefs = normalizePreferences({
    undoLimit: 999,
    gridSize: 2,
    cursorStyle: "brush-size",
    units: "inches",
    defaultBackground: "#abc123",
    showTooltips: false,
    autoSave: true,
    smoothing: 123,
  })

  expect(prefs.schemaVersion).toBe(2)
  expect(prefs.undoLimit).toBe(500)
  expect(prefs.memory.historyStates).toBe(500)
  expect(prefs.gridSize).toBe(4)
  expect(prefs.rulerGrid.gridSize).toBe(4)
  expect(prefs.rulerGrid.rulerUnits).toBe("in")
  expect(prefs.defaultBackground).toBe("#abc123")
  expect(prefs.fileHandling.autoSave).toBe(true)
  expect(prefs.autoSave).toBe(true)
  expect(prefs.toolBehavior.cursorStyle).toBe("brush-size")
  expect(prefs.cursorStyle).toBe("brush-size")
  expect(prefs.toolBehavior.showTooltips).toBe(false)
  expect(prefs.showTooltips).toBe(false)
  expect(prefs.toolBehavior.brushSmoothing).toBe(100)
  expect(prefs.smoothing).toBe(100)
})

test("summarizes RAM, cache, scratch disk, and GPU policies with browser fallbacks", () => {
  const prefs = normalizePreferences({
    memory: {
      ramPercent: 95,
      maxCacheMB: 999999,
      cacheLevels: 0,
      tileSize: 300,
      historyStates: 400,
      historyCompression: false,
    },
    scratchDisks: [
      { id: "opfs", label: "Browser scratch", enabled: true, priority: 3, quotaMB: 64, kind: "opfs" },
      { id: "downloads", label: "Downloads", enabled: false, priority: 2, quotaMB: 2048, kind: "download-folder" },
    ],
    gpu: {
      enabled: true,
      mode: "advanced",
      useWebGL: true,
      useWorkers: true,
      compositing: "gpu-preferred",
      rayTracingPreview: true,
    },
  })

  const policy = summarizePerformancePolicy(prefs, {
    deviceMemoryGB: 16,
    webglAvailable: false,
    workerAvailable: true,
  })

  expect(prefs.memory.ramPercent).toBe(90)
  expect(prefs.memory.cacheLevels).toBe(1)
  expect(prefs.memory.tileSize).toBe(256)
  expect(policy.ramBudgetMB).toBe(14746)
  expect(policy.cacheBudgetMB).toBe(14746)
  expect(policy.scratchBudgetMB).toBe(128)
  expect(policy.gpuPath).toBe("cpu-fallback")
  expect(policy.workerFilters).toBe(true)
  expect(policy.historyCompression).toBe(false)
  expect(policy.warnings.some((warning) => warning.includes("WebGL"))).toBe(true)
})

test("derives file handling behavior for autosave, missing fonts, large files, and recents", () => {
  const prefs = normalizePreferences({
    fileHandling: {
      autoSave: true,
      askBeforeClosing: false,
      preferProjectFormat: true,
      appendCompatibilityWarnings: true,
      recentFilesLimit: 150,
      autosaveIntervalSec: 4,
      preserveMetadata: false,
      missingFontPolicy: "rasterize",
      largeFilePolicy: "downsample-preview",
    },
  })

  const policy = deriveFileHandlingPolicy(prefs, {
    name: "campaign.psd",
    sizeMB: 750,
    hasMissingFonts: true,
    format: "psd",
  })

  expect(prefs.fileHandling.autosaveIntervalSec).toBe(15)
  expect(prefs.fileHandling.recentFilesLimit).toBe(100)
  expect(policy.autoSave).toBe(true)
  expect(policy.recentFilesLimit).toBe(100)
  expect(policy.largeFileAction).toBe("downsample-preview")
  expect(policy.missingFontAction).toBe("rasterize")
  expect(policy.warnings).toEqual(
    expect.arrayContaining([
      expect.stringContaining("large file"),
      expect.stringContaining("Missing fonts"),
      expect.stringContaining("Compatibility warnings"),
    ]),
  )
})

test("records bounded history log entries with optional timestamps and tool settings", () => {
  const prefs = normalizePreferences({
    historyLog: {
      enabled: true,
      destination: "both",
      includeTimestamps: true,
      includeToolSettings: true,
      maxEntries: 2,
      entries: [],
    },
  })

  const stroke = createHistoryLogEntry("Brush Stroke", prefs, {
    createdAt: "2026-05-15T10:00:00.000Z",
    documentName: "Poster",
    tool: "brush",
    changedLayerIds: ["layer_a"],
    toolSettings: { size: 24, opacity: 0.5 },
  })
  const blurred = createHistoryLogEntry("Gaussian Blur", prefs, {
    createdAt: "2026-05-15T10:01:00.000Z",
    documentName: "Poster",
    tool: "filter",
  })
  const exported = createHistoryLogEntry("Export PNG", prefs, {
    createdAt: "2026-05-15T10:02:00.000Z",
    documentName: "Poster",
    tool: "export",
  })

  const withLog = appendHistoryLog(appendHistoryLog(appendHistoryLog(prefs, stroke), blurred), exported)

  expect(withLog.historyLog.entries).toHaveLength(2)
  expect(withLog.historyLog.entries.map((entry) => entry.label)).toEqual(["Gaussian Blur", "Export PNG"])
  expect(stroke.toolSettings).toEqual({ size: 24, opacity: 0.5 })
  expect(formatHistoryLog(withLog)).toContain("2026-05-15T10:02:00.000Z | Poster | export | Export PNG")
})

test("applies deep ruler, unit, grid, pixel grid, and snapping settings to documents", () => {
  const prefs = normalizePreferences({
    rulerGrid: {
      rulerUnits: "mm",
      typeUnits: "pt",
      printResolution: 300,
      gridSize: 32,
      gridSubdivisions: 8,
      gridColor: "#00ffcc",
      gridOpacity: 0.4,
      showGrid: true,
      showPixelGrid: true,
      snapToGrid: true,
      snapToGuides: false,
      smartGuides: false,
      rulerOrigin: { x: 12, y: 20 },
      guidesColor: "#ff00aa",
    },
  })

  expect(applyPreferencesToDocumentSettings(prefs)).toEqual({
    rulerUnits: "mm",
    gridSize: 32,
    gridSubdivisions: 8,
    gridColor: "#00ffcc",
    gridOpacity: 0.4,
    showGrid: true,
    showPixelGrid: true,
    snapToGrid: true,
    snapToGuides: false,
    showSmartGuides: false,
    rulerOrigin: { x: 12, y: 20 },
  })
})

test("exports, imports, and resets preference sets by section", () => {
  const prefs = normalizePreferences({
    gpu: { ...DEFAULT_PREFERENCES.gpu, enabled: false },
    rulerGrid: { ...DEFAULT_PREFERENCES.rulerGrid, gridColor: "#123456" },
  })

  const exported = exportPreferencesSet(prefs)
  const parsed = parsePreferencesSet(exported.json)
  const fromSerialized = parsePreferencesSet(serializePreferences(prefs))
  const resetGrid = resetPreferencesSet("rulerGrid", prefs)
  const resetAll = resetPreferencesSet()

  expect(exported.fileName).toMatch(/^photoshop-preferences-\d{4}-\d{2}-\d{2}\.json$/)
  expect(exported.mime).toBe("application/json")
  expect(parsed.gpu.enabled).toBe(false)
  expect(fromSerialized.rulerGrid.gridColor).toBe("#123456")
  expect(resetGrid.gpu.enabled).toBe(false)
  expect(resetGrid.rulerGrid).toEqual(DEFAULT_PREFERENCES.rulerGrid)
  expect(resetAll).toEqual(DEFAULT_PREFERENCES)
})

test("capability registry exposes preferences and performance settings coverage", () => {
  expect(getCapability("preferences.performance-settings").status).toBe("usable")
  expect(getCapability("preferences.file-handling-history").status).toBe("usable")
  expect(getCapability("preferences.import-export-reset").status).toBe("usable")

  const ids = listCapabilities({ kind: "preferences" }).map((capability) => capability.id)
  expect(ids).toEqual(
    expect.arrayContaining([
      "preferences.performance-settings",
      "preferences.cursor-tool-units",
      "preferences.import-export-reset",
    ]),
  )
})
