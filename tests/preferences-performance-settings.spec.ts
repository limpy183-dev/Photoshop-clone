import { expect, test } from "@playwright/test"

import { getCapability, listCapabilities } from "../components/photoshop/capabilities"
import {
  DEFAULT_PREFERENCES,
  PREFERENCE_IMPORT_SECTIONS,
  TECHNOLOGY_PREVIEW_FLAGS,
  appendHistoryLog,
  applyPreferencesToDocumentSettings,
  calculatePrintSizeZoom,
  calculateScreenDpiFromCalibration,
  createHistoryLogEntry,
  deriveFileHandlingPolicy,
  exportPreferencesSet,
  formatHistoryLog,
  importPreferenceSections,
  normalizePreferences,
  parsePreferencesSet,
  resetPreferencesSet,
  serializePreferences,
  summarizeTechnologyPreviewFlags,
  summarizePerformancePolicy,
} from "../components/photoshop/preferences-engine"
import { buildRulerTickMarks } from "../components/photoshop/ruler-calibration"
import { resolveCanvasCursorState } from "../components/photoshop/cursor-overlay"
import { defaultTechPreviewFlags, getTechPreviewFlagDefinition } from "../components/photoshop/tech-previews"

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

  expect(prefs.schemaVersion).toBe(4)
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
  expect(prefs.toolBehavior.showBrushSizeCrosshair).toBe(true)
  expect(prefs.rulerGrid.screenDpi).toBe(96)
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

test("calibrates screen DPI and derives print-size zoom from document resolution", () => {
  const cssPixels = (100 / 25.4) * 96
  const screenDpi = calculateScreenDpiFromCalibration({ cssPixelLength: cssPixels, measuredMm: 92 })
  const zoom = calculatePrintSizeZoom({ screenDpi, documentDpi: 300 })

  expect(screenDpi).toBeCloseTo(104.35, 2)
  expect(zoom).toBeCloseTo(0.3478, 3)

  expect(() => calculateScreenDpiFromCalibration({ cssPixelLength: cssPixels, measuredMm: 0 })).toThrow(/measured length/i)
  expect(() => calculatePrintSizeZoom({ screenDpi: 96, documentDpi: 0 })).toThrow(/document dpi/i)
})

test("builds ruler tick marks in document print units", () => {
  const inchTicks = buildRulerTickMarks({ lengthPx: 300, zoom: 1, unit: "in", documentDpi: 300 })
  const oneInchTick = inchTicks.find((tick) => tick.label === "1")

  expect(inchTicks[0]).toMatchObject({ value: 0, label: "0", positionPx: 0, major: true })
  expect(oneInchTick).toMatchObject({ value: 1, positionPx: 300, major: true })

  const mmTicks = buildRulerTickMarks({ lengthPx: 300, zoom: 1, unit: "mm", documentDpi: 300 })
  expect(mmTicks.some((tick) => tick.label === "10")).toBe(true)
})

test("resolves canvas cursor overlays from cursor preferences and active tool", () => {
  const brushCursor = resolveCanvasCursorState({
    standardCssCursor: "crosshair",
    cursorStyle: "brush-size",
    tool: "brush",
    isBrushTool: true,
    brushSize: 32,
    zoom: 1.5,
    showBrushPreview: true,
    showBrushSizeCrosshair: true,
  })

  expect(brushCursor.cssCursor).toBe("none")
  expect(brushCursor.overlay).toMatchObject({
    kind: "brush",
    diameterPx: 48,
    showCrosshair: true,
    toolLabel: "B",
  })

  const standardMove = resolveCanvasCursorState({
    standardCssCursor: "move",
    cursorStyle: "standard",
    tool: "move",
    isBrushTool: false,
    brushSize: 20,
    zoom: 1,
    showBrushPreview: true,
    showBrushSizeCrosshair: true,
  })
  expect(standardMove).toEqual({ cssCursor: "move", overlay: null })

  const preciseEyedropper = resolveCanvasCursorState({
    standardCssCursor: "crosshair",
    cursorStyle: "precise",
    tool: "eyedropper",
    isBrushTool: false,
    brushSize: 20,
    zoom: 1,
    showBrushPreview: true,
    showBrushSizeCrosshair: false,
  })
  expect(preciseEyedropper.overlay).toMatchObject({ kind: "precise", toolLabel: "I" })
})

test("exports, imports, and resets preference sets by section", () => {
  const prefs = normalizePreferences({
    gpu: { ...DEFAULT_PREFERENCES.gpu, enabled: false },
    rulerGrid: { ...DEFAULT_PREFERENCES.rulerGrid, gridColor: "#123456" },
    technologyPreviews: {
      ...DEFAULT_PREFERENCES.technologyPreviews,
      webgpuAcceleration: true,
      localGenerativeFill: true,
    },
  })

  const exported = exportPreferencesSet(prefs)
  const parsed = parsePreferencesSet(exported.json)
  const fromSerialized = parsePreferencesSet(serializePreferences(prefs))
  const resetGrid = resetPreferencesSet("rulerGrid", prefs)
  const resetPreviews = resetPreferencesSet("technologyPreviews", prefs)
  const resetAll = resetPreferencesSet()

  expect(exported.fileName).toMatch(/^photoshop-preferences-\d{4}-\d{2}-\d{2}\.json$/)
  expect(exported.mime).toBe("application/json")
  expect(parsed.gpu.enabled).toBe(false)
  expect(parsed.technologyPreviews.webgpuAcceleration).toBe(true)
  expect(parsed.technologyPreviews.localGenerativeFill).toBe(true)
  expect(fromSerialized.rulerGrid.gridColor).toBe("#123456")
  expect(resetGrid.gpu.enabled).toBe(false)
  expect(resetGrid.technologyPreviews.webgpuAcceleration).toBe(true)
  expect(resetGrid.rulerGrid).toEqual(DEFAULT_PREFERENCES.rulerGrid)
  expect(resetPreviews.technologyPreviews).toEqual(DEFAULT_PREFERENCES.technologyPreviews)
  expect(resetAll).toEqual(DEFAULT_PREFERENCES)
})

test("validates preference imports with specific schema errors", () => {
  expect(() => parsePreferencesSet("{not json")).toThrow(/not valid JSON/i)
  expect(() => parsePreferencesSet({ preferences: "bad" })).toThrow(/preferences must be an object/i)
  expect(() => parsePreferencesSet({ rulerGrid: "bad" })).toThrow(/rulerGrid must be an object/i)
  expect(() => parsePreferencesSet({ rulerGrid: { printResolution: "300" } })).toThrow(/rulerGrid\.printResolution must be a number/i)
  expect(() => parsePreferencesSet({ toolBehavior: { cursorStyle: "giant" } })).toThrow(/toolBehavior\.cursorStyle must be one of/i)
  expect(() => parsePreferencesSet({ technologyPreviews: { webgpuAcceleration: "yes" } })).toThrow(/technologyPreviews\.webgpuAcceleration must be a boolean/i)
})

test("normalizes technology preview feature flags with per-toggle help and risk text", () => {
  const prefs = normalizePreferences({
    technologyPreviews: {
      hdrCanvasCompositor: true,
      webgpuAcceleration: true,
      localGenerativeFill: "yes",
    },
  })

  const previewFlags = summarizeTechnologyPreviewFlags(prefs)

  expect(prefs.schemaVersion).toBe(4)
  expect(TECHNOLOGY_PREVIEW_FLAGS.map((flag) => flag.id)).toEqual([
    "hdrCanvasCompositor",
    "webgpuAcceleration",
    "localGenerativeFill",
    "cameraRawSidecars",
  ])
  expect(prefs.technologyPreviews.hdrCanvasCompositor).toBe(true)
  expect(prefs.technologyPreviews.webgpuAcceleration).toBe(true)
  expect(prefs.technologyPreviews.localGenerativeFill).toBe(false)
  expect(previewFlags.find((flag) => flag.id === "webgpuAcceleration")).toMatchObject({
    enabled: true,
    helpText: expect.stringContaining("WebGPU"),
    riskText: expect.stringContaining("driver"),
  })
})

test("WebGPU 3D path tracing is exposed only as an experimental CPU-fallback tech preview", () => {
  const flag = getTechPreviewFlagDefinition("webgpuPathTracing3D")
  const defaults = defaultTechPreviewFlags()

  expect(flag).toMatchObject({
    id: "webgpuPathTracing3D",
    riskLevel: "experimental",
    defaultEnabled: false,
  })
  expect(defaults.webgpuPathTracing3D).toBe(false)
  expect(flag?.helpText).toContain("CPU raytrace remains the production renderer")
  expect(flag?.helpText).toContain("not a production replacement")
})

test("imports only selected preference sections while preserving the rest", () => {
  const current = normalizePreferences({
    gpu: { ...DEFAULT_PREFERENCES.gpu, enabled: false },
    rulerGrid: { ...DEFAULT_PREFERENCES.rulerGrid, rulerUnits: "px", gridColor: "#111111" },
    toolBehavior: { ...DEFAULT_PREFERENCES.toolBehavior, cursorStyle: "standard" },
    technologyPreviews: { ...DEFAULT_PREFERENCES.technologyPreviews, hdrCanvasCompositor: false },
  })
  const imported = normalizePreferences({
    gpu: { ...DEFAULT_PREFERENCES.gpu, enabled: true },
    rulerGrid: { ...DEFAULT_PREFERENCES.rulerGrid, rulerUnits: "mm", gridColor: "#abcdef", screenDpi: 112 },
    toolBehavior: { ...DEFAULT_PREFERENCES.toolBehavior, cursorStyle: "precise" },
    technologyPreviews: { ...DEFAULT_PREFERENCES.technologyPreviews, hdrCanvasCompositor: true },
  })

  const partial = importPreferenceSections(current, imported, ["rulerGrid"])
  const previewOnly = importPreferenceSections(current, imported, ["technologyPreviews"])

  expect(PREFERENCE_IMPORT_SECTIONS).toContain("rulerGrid")
  expect(PREFERENCE_IMPORT_SECTIONS).toContain("technologyPreviews")
  expect(partial.rulerGrid.rulerUnits).toBe("mm")
  expect(partial.rulerGrid.gridColor).toBe("#abcdef")
  expect(partial.rulerGrid.screenDpi).toBe(112)
  expect(partial.gpu.enabled).toBe(false)
  expect(partial.toolBehavior.cursorStyle).toBe("standard")
  expect(partial.technologyPreviews.hdrCanvasCompositor).toBe(false)
  expect(previewOnly.technologyPreviews.hdrCanvasCompositor).toBe(true)
  expect(previewOnly.rulerGrid.gridColor).toBe("#111111")
})

test("capability registry exposes preferences and performance settings coverage", () => {
  expect(getCapability("preferences.performance-settings").status).toBe("usable")
  expect(getCapability("preferences.file-handling-history").status).toBe("usable")
  expect(getCapability("preferences.import-export-reset").status).toBe("usable")
  expect(getCapability("preferences.technology-previews").status).toBe("usable")

  const ids = listCapabilities({ kind: "preferences" }).map((capability) => capability.id)
  expect(ids).toEqual(
    expect.arrayContaining([
      "preferences.performance-settings",
      "preferences.cursor-tool-units",
      "preferences.import-export-reset",
      "preferences.technology-previews",
    ]),
  )
})
