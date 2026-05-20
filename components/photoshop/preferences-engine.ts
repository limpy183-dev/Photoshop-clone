import type { PsDocument } from "./types"

export const PREFERENCES_STORAGE_KEY = "ps-preferences"
export const PREFERENCES_SCHEMA_VERSION = 2
export const MAX_PREFERENCES_IMPORT_BYTES = 1024 * 1024
export const MAX_IMPORTED_SCRATCH_DISKS = 32
export const MAX_IMPORTED_HISTORY_ENTRIES = 10000
export const MAX_IMPORTED_HISTORY_LAYER_IDS = 500
export const MAX_IMPORTED_HISTORY_TOOL_SETTINGS_BYTES = 64 * 1024

export type CursorStylePreference = "standard" | "precise" | "brush-size"
export type LegacyUnitPreference = "pixels" | "inches" | "cm" | "mm" | "pt" | "pc"
export type RulerUnitPreference = NonNullable<PsDocument["rulerUnits"]>
export type TypeUnitPreference = "px" | "pt"
export type ScratchDiskKind = "browser-storage" | "download-folder" | "opfs" | "custom"
export type GpuModePreference = "auto" | "basic" | "advanced"
export type GpuCompositingPreference = "cpu" | "worker" | "gpu-preferred"
export type MissingFontPolicy = "warn" | "substitute" | "rasterize"
export type LargeFilePolicy = "ask" | "downsample-preview" | "block"
export type HistoryLogDestination = "metadata" | "text-file" | "both"
export type PreferenceSection =
  | "general"
  | "memory"
  | "scratchDisks"
  | "gpu"
  | "fileHandling"
  | "historyLog"
  | "toolBehavior"
  | "rulerGrid"

export interface MemoryPreferences {
  ramPercent: number
  maxCacheMB: number
  cacheLevels: number
  tileSize: number
  historyStates: number
  historyCompression: boolean
}

export interface ScratchDiskPreference {
  id: string
  label: string
  enabled: boolean
  priority: number
  quotaMB: number
  kind: ScratchDiskKind
  path?: string
}

export interface GpuPreferences {
  enabled: boolean
  mode: GpuModePreference
  useWebGL: boolean
  useWorkers: boolean
  compositing: GpuCompositingPreference
  rayTracingPreview: boolean
}

export interface FileHandlingPreferences {
  autoSave: boolean
  askBeforeClosing: boolean
  preferProjectFormat: boolean
  appendCompatibilityWarnings: boolean
  recentFilesLimit: number
  autosaveIntervalSec: number
  preserveMetadata: boolean
  missingFontPolicy: MissingFontPolicy
  largeFilePolicy: LargeFilePolicy
}

export interface PreferenceHistoryLogEntry {
  id: string
  label: string
  createdAt?: string
  documentName?: string
  tool?: string
  changedLayerIds?: string[]
  toolSettings?: Record<string, unknown>
}

export interface HistoryLogPreferences {
  enabled: boolean
  destination: HistoryLogDestination
  includeTimestamps: boolean
  includeToolSettings: boolean
  maxEntries: number
  entries: PreferenceHistoryLogEntry[]
}

export interface ToolBehaviorPreferences {
  cursorStyle: CursorStylePreference
  showBrushPreview: boolean
  precisePicking: boolean
  shiftCyclesTools: boolean
  showTooltips: boolean
  springLoadedTools: boolean
  autoSelectLayer: boolean
  brushSmoothing: number
  wheelZooms: boolean
  animatedZoom: boolean
}

export interface RulerGridPreferences {
  rulerUnits: RulerUnitPreference
  typeUnits: TypeUnitPreference
  printResolution: number
  gridSize: number
  gridSubdivisions: number
  gridColor: string
  gridOpacity: number
  showGrid: boolean
  showPixelGrid: boolean
  snapToGrid: boolean
  snapToGuides: boolean
  smartGuides: boolean
  rulerOrigin: { x: number; y: number }
  guidesColor: string
}

export interface PhotoshopPreferences {
  schemaVersion: typeof PREFERENCES_SCHEMA_VERSION
  gridSize: number
  undoLimit: number
  cursorStyle: CursorStylePreference
  units: LegacyUnitPreference
  defaultBackground: string
  showTooltips: boolean
  autoSave: boolean
  smoothing: number
  memory: MemoryPreferences
  scratchDisks: ScratchDiskPreference[]
  gpu: GpuPreferences
  fileHandling: FileHandlingPreferences
  historyLog: HistoryLogPreferences
  toolBehavior: ToolBehaviorPreferences
  rulerGrid: RulerGridPreferences
}

export interface PerformanceEnvironment {
  deviceMemoryGB?: number
  webglAvailable?: boolean
  workerAvailable?: boolean
}

export interface PerformancePolicySummary {
  ramBudgetMB: number
  cacheBudgetMB: number
  scratchBudgetMB: number
  cacheLevels: number
  tileSize: number
  estimatedTileCapacity: number
  gpuPath: "disabled" | "cpu-fallback" | "webgl-basic" | "webgl-advanced"
  workerFilters: boolean
  historyStates: number
  historyCompression: boolean
  warnings: string[]
}

export interface FileHandlingInput {
  name: string
  sizeMB?: number
  format?: string
  hasMissingFonts?: boolean
}

export interface FileHandlingPolicySummary {
  autoSave: boolean
  autosaveIntervalSec: number
  askBeforeClosing: boolean
  preferProjectFormat: boolean
  preserveMetadata: boolean
  recentFilesLimit: number
  largeFileAction: "open" | LargeFilePolicy
  missingFontAction: "none" | MissingFontPolicy
  warnings: string[]
}

export const DEFAULT_PREFERENCES: PhotoshopPreferences = {
  schemaVersion: PREFERENCES_SCHEMA_VERSION,
  gridSize: 20,
  undoLimit: 50,
  cursorStyle: "standard",
  units: "pixels",
  defaultBackground: "#ffffff",
  showTooltips: true,
  autoSave: false,
  smoothing: 18,
  memory: {
    ramPercent: 70,
    maxCacheMB: 4096,
    cacheLevels: 4,
    tileSize: 256,
    historyStates: 50,
    historyCompression: true,
  },
  scratchDisks: [
    {
      id: "opfs",
      label: "Browser scratch storage",
      enabled: true,
      priority: 1,
      quotaMB: 2048,
      kind: "opfs",
    },
    {
      id: "downloads",
      label: "Downloads handoff",
      enabled: false,
      priority: 2,
      quotaMB: 1024,
      kind: "download-folder",
    },
  ],
  gpu: {
    enabled: true,
    mode: "auto",
    useWebGL: true,
    useWorkers: true,
    compositing: "gpu-preferred",
    rayTracingPreview: false,
  },
  fileHandling: {
    autoSave: false,
    askBeforeClosing: true,
    preferProjectFormat: true,
    appendCompatibilityWarnings: true,
    recentFilesLimit: 20,
    autosaveIntervalSec: 120,
    preserveMetadata: true,
    missingFontPolicy: "warn",
    largeFilePolicy: "ask",
  },
  historyLog: {
    enabled: false,
    destination: "metadata",
    includeTimestamps: true,
    includeToolSettings: false,
    maxEntries: 1000,
    entries: [],
  },
  toolBehavior: {
    cursorStyle: "standard",
    showBrushPreview: true,
    precisePicking: false,
    shiftCyclesTools: true,
    showTooltips: true,
    springLoadedTools: true,
    autoSelectLayer: false,
    brushSmoothing: 18,
    wheelZooms: true,
    animatedZoom: true,
  },
  rulerGrid: {
    rulerUnits: "px",
    typeUnits: "pt",
    printResolution: 72,
    gridSize: 20,
    gridSubdivisions: 4,
    gridColor: "#5dade2",
    gridOpacity: 0.45,
    showGrid: false,
    showPixelGrid: false,
    snapToGrid: false,
    snapToGuides: true,
    smartGuides: true,
    rulerOrigin: { x: 0, y: 0 },
    guidesColor: "#00aaff",
  },
}

const TILE_SIZES = [64, 128, 256, 512, 1024]

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function nestedRecord(root: Record<string, unknown>, key: string): Record<string, unknown> {
  return asRecord(root[key])
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback
}

function boolValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback
}

function assertBoundedArray(value: unknown, max: number, label: string) {
  if (Array.isArray(value) && value.length > max) {
    throw new Error(`Preference imports are limited to ${max} ${label}.`)
  }
}

function jsonByteLength(value: unknown) {
  try {
    return JSON.stringify(value).length
  } catch {
    return MAX_IMPORTED_HISTORY_TOOL_SETTINGS_BYTES + 1
  }
}

function assertPreferenceImportBounds(value: unknown) {
  const root = isRecord(value) && isRecord(value.preferences) ? value.preferences : value
  if (!isRecord(root)) throw new Error("Preference set must be a JSON object.")

  assertBoundedArray(root.scratchDisks, MAX_IMPORTED_SCRATCH_DISKS, "scratch disks.")

  const historyLog = asRecord(root.historyLog)
  assertBoundedArray(historyLog.entries, MAX_IMPORTED_HISTORY_ENTRIES, "history log entries.")
  if (!Array.isArray(historyLog.entries)) return

  historyLog.entries.forEach((entry, index) => {
    const record = asRecord(entry)
    assertBoundedArray(record.changedLayerIds, MAX_IMPORTED_HISTORY_LAYER_IDS, `changed layer IDs in history entry ${index + 1}.`)
    if (isRecord(record.toolSettings) && jsonByteLength(record.toolSettings) > MAX_IMPORTED_HISTORY_TOOL_SETTINGS_BYTES) {
      throw new Error(`Preference imports are limited to ${MAX_IMPORTED_HISTORY_TOOL_SETTINGS_BYTES} bytes per history tool settings payload.`)
    }
  })
}

function clampNumber(value: unknown, fallback: number, min: number, max: number, round = true) {
  const numeric = numberValue(value, fallback)
  const clamped = Math.max(min, Math.min(max, numeric))
  return round ? Math.round(clamped) : clamped
}

function nearestTileSize(value: unknown, fallback: number) {
  const numeric = numberValue(value, fallback)
  return TILE_SIZES.reduce((best, candidate) =>
    Math.abs(candidate - numeric) < Math.abs(best - numeric) ? candidate : best,
  )
}

function optionValue<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : fallback
}

function colorValue(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback
  const trimmed = value.trim()
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(trimmed)) return trimmed
  if (/^rgba?\(/i.test(trimmed)) return trimmed
  return fallback
}

function unitToRuler(value: unknown, fallback: RulerUnitPreference): RulerUnitPreference {
  if (value === "pixels") return "px"
  if (value === "inches") return "in"
  if (value === "cm") return "cm"
  return optionValue(value, ["px", "in", "cm", "mm", "pt", "pc"] as const, fallback)
}

function rulerToLegacy(unit: RulerUnitPreference): LegacyUnitPreference {
  if (unit === "px") return "pixels"
  if (unit === "in") return "inches"
  return unit
}

function normalizeMemory(input: Record<string, unknown>, legacyUndoLimit: unknown): MemoryPreferences {
  const defaults = DEFAULT_PREFERENCES.memory
  return {
    ramPercent: clampNumber(input.ramPercent, defaults.ramPercent, 10, 90),
    maxCacheMB: clampNumber(input.maxCacheMB, defaults.maxCacheMB, 128, 131072),
    cacheLevels: clampNumber(input.cacheLevels, defaults.cacheLevels, 1, 8),
    tileSize: nearestTileSize(input.tileSize, defaults.tileSize),
    historyStates: clampNumber(input.historyStates ?? legacyUndoLimit, defaults.historyStates, 5, 500),
    historyCompression: boolValue(input.historyCompression, defaults.historyCompression),
  }
}

function normalizeScratchDisks(value: unknown): ScratchDiskPreference[] {
  const source = Array.isArray(value) && value.length ? value : DEFAULT_PREFERENCES.scratchDisks
  const seen = new Set<string>()
  return source.slice(0, MAX_IMPORTED_SCRATCH_DISKS).map((item, index) => {
    const record = asRecord(item)
    const fallback = DEFAULT_PREFERENCES.scratchDisks[index] ?? DEFAULT_PREFERENCES.scratchDisks[0]
    const baseId = stringValue(record.id, fallback.id || `scratch-${index + 1}`).trim() || `scratch-${index + 1}`
    const id = seen.has(baseId) ? `${baseId}-${index + 1}` : baseId
    seen.add(id)
    const path = typeof record.path === "string" && record.path.trim() ? record.path.trim() : undefined
    return {
      id,
      label: stringValue(record.label, fallback.label).trim() || fallback.label,
      enabled: boolValue(record.enabled, fallback.enabled),
      priority: clampNumber(record.priority, fallback.priority, 1, 99),
      quotaMB: clampNumber(record.quotaMB, fallback.quotaMB, 128, 1048576),
      kind: optionValue(record.kind, ["browser-storage", "download-folder", "opfs", "custom"] as const, fallback.kind),
      ...(path ? { path } : {}),
    }
  })
}

function normalizeGpu(input: Record<string, unknown>): GpuPreferences {
  const defaults = DEFAULT_PREFERENCES.gpu
  return {
    enabled: boolValue(input.enabled, defaults.enabled),
    mode: optionValue(input.mode, ["auto", "basic", "advanced"] as const, defaults.mode),
    useWebGL: boolValue(input.useWebGL, defaults.useWebGL),
    useWorkers: boolValue(input.useWorkers, defaults.useWorkers),
    compositing: optionValue(input.compositing, ["cpu", "worker", "gpu-preferred"] as const, defaults.compositing),
    rayTracingPreview: boolValue(input.rayTracingPreview, defaults.rayTracingPreview),
  }
}

function normalizeFileHandling(input: Record<string, unknown>, legacyAutoSave: unknown): FileHandlingPreferences {
  const defaults = DEFAULT_PREFERENCES.fileHandling
  return {
    autoSave: boolValue(input.autoSave ?? legacyAutoSave, defaults.autoSave),
    askBeforeClosing: boolValue(input.askBeforeClosing, defaults.askBeforeClosing),
    preferProjectFormat: boolValue(input.preferProjectFormat, defaults.preferProjectFormat),
    appendCompatibilityWarnings: boolValue(input.appendCompatibilityWarnings, defaults.appendCompatibilityWarnings),
    recentFilesLimit: clampNumber(input.recentFilesLimit, defaults.recentFilesLimit, 0, 100),
    autosaveIntervalSec: clampNumber(input.autosaveIntervalSec, defaults.autosaveIntervalSec, 15, 3600),
    preserveMetadata: boolValue(input.preserveMetadata, defaults.preserveMetadata),
    missingFontPolicy: optionValue(input.missingFontPolicy, ["warn", "substitute", "rasterize"] as const, defaults.missingFontPolicy),
    largeFilePolicy: optionValue(input.largeFilePolicy, ["ask", "downsample-preview", "block"] as const, defaults.largeFilePolicy),
  }
}

function normalizeHistoryEntries(value: unknown): PreferenceHistoryLogEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(-MAX_IMPORTED_HISTORY_ENTRIES)
    .map((item) => {
      const record = asRecord(item)
      const label = stringValue(record.label, "").trim()
      if (!label) return null
      const changedLayerIds = Array.isArray(record.changedLayerIds)
        ? record.changedLayerIds.slice(0, MAX_IMPORTED_HISTORY_LAYER_IDS).filter((id): id is string => typeof id === "string")
        : undefined
      const toolSettings = isRecord(record.toolSettings) ? clone(record.toolSettings) : undefined
      return {
        id: stringValue(record.id, `hist_${Math.random().toString(36).slice(2, 9)}`),
        label,
        ...(typeof record.createdAt === "string" ? { createdAt: record.createdAt } : {}),
        ...(typeof record.documentName === "string" ? { documentName: record.documentName } : {}),
        ...(typeof record.tool === "string" ? { tool: record.tool } : {}),
        ...(changedLayerIds && changedLayerIds.length ? { changedLayerIds } : {}),
        ...(toolSettings ? { toolSettings } : {}),
      }
    })
    .filter((entry): entry is PreferenceHistoryLogEntry => !!entry)
}

function normalizeHistoryLog(input: Record<string, unknown>): HistoryLogPreferences {
  const defaults = DEFAULT_PREFERENCES.historyLog
  const maxEntries = clampNumber(input.maxEntries, defaults.maxEntries, 1, 10000)
  return {
    enabled: boolValue(input.enabled, defaults.enabled),
    destination: optionValue(input.destination, ["metadata", "text-file", "both"] as const, defaults.destination),
    includeTimestamps: boolValue(input.includeTimestamps, defaults.includeTimestamps),
    includeToolSettings: boolValue(input.includeToolSettings, defaults.includeToolSettings),
    maxEntries,
    entries: normalizeHistoryEntries(input.entries).slice(-maxEntries),
  }
}

function normalizeToolBehavior(
  input: Record<string, unknown>,
  legacyCursorStyle: unknown,
  legacyShowTooltips: unknown,
  legacySmoothing: unknown,
): ToolBehaviorPreferences {
  const defaults = DEFAULT_PREFERENCES.toolBehavior
  return {
    cursorStyle: optionValue(input.cursorStyle ?? legacyCursorStyle, ["standard", "precise", "brush-size"] as const, defaults.cursorStyle),
    showBrushPreview: boolValue(input.showBrushPreview, defaults.showBrushPreview),
    precisePicking: boolValue(input.precisePicking, defaults.precisePicking),
    shiftCyclesTools: boolValue(input.shiftCyclesTools, defaults.shiftCyclesTools),
    showTooltips: boolValue(input.showTooltips ?? legacyShowTooltips, defaults.showTooltips),
    springLoadedTools: boolValue(input.springLoadedTools, defaults.springLoadedTools),
    autoSelectLayer: boolValue(input.autoSelectLayer, defaults.autoSelectLayer),
    brushSmoothing: clampNumber(input.brushSmoothing ?? legacySmoothing, defaults.brushSmoothing, 0, 100),
    wheelZooms: boolValue(input.wheelZooms, defaults.wheelZooms),
    animatedZoom: boolValue(input.animatedZoom, defaults.animatedZoom),
  }
}

function normalizeRulerGrid(input: Record<string, unknown>, legacyGridSize: unknown, legacyUnits: unknown): RulerGridPreferences {
  const defaults = DEFAULT_PREFERENCES.rulerGrid
  const origin = asRecord(input.rulerOrigin)
  return {
    rulerUnits: unitToRuler(input.rulerUnits ?? legacyUnits, defaults.rulerUnits),
    typeUnits: optionValue(input.typeUnits, ["px", "pt"] as const, defaults.typeUnits),
    printResolution: clampNumber(input.printResolution, defaults.printResolution, 1, 2400),
    gridSize: clampNumber(input.gridSize ?? legacyGridSize, defaults.gridSize, 4, 1000),
    gridSubdivisions: clampNumber(input.gridSubdivisions, defaults.gridSubdivisions, 1, 16),
    gridColor: colorValue(input.gridColor, defaults.gridColor),
    gridOpacity: clampNumber(input.gridOpacity, defaults.gridOpacity, 0.05, 1, false),
    showGrid: boolValue(input.showGrid, defaults.showGrid),
    showPixelGrid: boolValue(input.showPixelGrid, defaults.showPixelGrid),
    snapToGrid: boolValue(input.snapToGrid, defaults.snapToGrid),
    snapToGuides: boolValue(input.snapToGuides, defaults.snapToGuides),
    smartGuides: boolValue(input.smartGuides, defaults.smartGuides),
    rulerOrigin: {
      x: clampNumber(origin.x, defaults.rulerOrigin.x, -100000, 100000, false),
      y: clampNumber(origin.y, defaults.rulerOrigin.y, -100000, 100000, false),
    },
    guidesColor: colorValue(input.guidesColor, defaults.guidesColor),
  }
}

function syncLegacyFields(prefs: Omit<PhotoshopPreferences, "schemaVersion" | "gridSize" | "undoLimit" | "cursorStyle" | "units" | "showTooltips" | "autoSave" | "smoothing"> & {
  schemaVersion: typeof PREFERENCES_SCHEMA_VERSION
  gridSize?: number
  undoLimit?: number
  cursorStyle?: CursorStylePreference
  units?: LegacyUnitPreference
  showTooltips?: boolean
  autoSave?: boolean
  smoothing?: number
}): PhotoshopPreferences {
  return {
    ...prefs,
    schemaVersion: PREFERENCES_SCHEMA_VERSION,
    gridSize: prefs.rulerGrid.gridSize,
    undoLimit: prefs.memory.historyStates,
    cursorStyle: prefs.toolBehavior.cursorStyle,
    units: rulerToLegacy(prefs.rulerGrid.rulerUnits),
    showTooltips: prefs.toolBehavior.showTooltips,
    autoSave: prefs.fileHandling.autoSave,
    smoothing: prefs.toolBehavior.brushSmoothing,
  }
}

export function normalizePreferences(input?: unknown): PhotoshopPreferences {
  const raw = asRecord(input)
  const defaults = clone(DEFAULT_PREFERENCES)
  const memory = normalizeMemory(nestedRecord(raw, "memory"), raw.undoLimit)
  const fileHandling = normalizeFileHandling(nestedRecord(raw, "fileHandling"), raw.autoSave)
  const toolBehavior = normalizeToolBehavior(nestedRecord(raw, "toolBehavior"), raw.cursorStyle, raw.showTooltips, raw.smoothing)
  const rulerGrid = normalizeRulerGrid(nestedRecord(raw, "rulerGrid"), raw.gridSize, raw.units)

  return syncLegacyFields({
    ...defaults,
    schemaVersion: PREFERENCES_SCHEMA_VERSION,
    defaultBackground: colorValue(raw.defaultBackground, defaults.defaultBackground),
    memory,
    scratchDisks: normalizeScratchDisks(raw.scratchDisks),
    gpu: normalizeGpu(nestedRecord(raw, "gpu")),
    fileHandling,
    historyLog: normalizeHistoryLog(nestedRecord(raw, "historyLog")),
    toolBehavior,
    rulerGrid,
  })
}

export function serializePreferences(prefs: unknown): string {
  return JSON.stringify(normalizePreferences(prefs), null, 2)
}

export function parsePreferencesSet(value: string | unknown): PhotoshopPreferences {
  if (typeof value === "string") {
    if (value.length > MAX_PREFERENCES_IMPORT_BYTES) {
      throw new Error(`Preference imports are limited to ${Math.round(MAX_PREFERENCES_IMPORT_BYTES / 1024)} KB.`)
    }
    const parsed = JSON.parse(value)
    assertPreferenceImportBounds(parsed)
    return normalizePreferences(isRecord(parsed) && isRecord(parsed.preferences) ? parsed.preferences : parsed)
  }
  assertPreferenceImportBounds(value)
  return normalizePreferences(isRecord(value) && isRecord(value.preferences) ? value.preferences : value)
}

export function resetPreferencesSet(section?: PreferenceSection, current?: unknown): PhotoshopPreferences {
  if (!section) return clone(DEFAULT_PREFERENCES)
  const prefs = normalizePreferences(current)
  if (section === "general") {
    prefs.defaultBackground = DEFAULT_PREFERENCES.defaultBackground
  } else if (section === "scratchDisks") {
    prefs.scratchDisks = clone(DEFAULT_PREFERENCES.scratchDisks)
  } else {
    ;(prefs[section] as unknown) = clone(DEFAULT_PREFERENCES[section])
  }
  return syncLegacyFields(prefs)
}

export function exportPreferencesSet(prefs: unknown) {
  const date = new Date().toISOString().slice(0, 10)
  return {
    fileName: `photoshop-preferences-${date}.json`,
    mime: "application/json",
    json: serializePreferences(prefs),
  }
}

function environmentMemoryGB(env?: PerformanceEnvironment) {
  if (typeof env?.deviceMemoryGB === "number" && Number.isFinite(env.deviceMemoryGB)) return env.deviceMemoryGB
  if (typeof navigator !== "undefined") {
    const maybeNavigator = navigator as Navigator & { deviceMemory?: number }
    if (typeof maybeNavigator.deviceMemory === "number" && Number.isFinite(maybeNavigator.deviceMemory)) {
      return maybeNavigator.deviceMemory
    }
  }
  return 8
}

function environmentWebglAvailable(env?: PerformanceEnvironment) {
  if (typeof env?.webglAvailable === "boolean") return env.webglAvailable
  if (typeof document === "undefined") return true
  try {
    const canvas = document.createElement("canvas")
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"))
  } catch {
    return false
  }
}

function environmentWorkerAvailable(env?: PerformanceEnvironment) {
  if (typeof env?.workerAvailable === "boolean") return env.workerAvailable
  return typeof Worker !== "undefined"
}

export function summarizePerformancePolicy(input: unknown, env?: PerformanceEnvironment): PerformancePolicySummary {
  const prefs = normalizePreferences(input)
  const memoryGB = Math.max(1, environmentMemoryGB(env))
  const ramBudgetMB = Math.round(memoryGB * 1024 * (prefs.memory.ramPercent / 100))
  const cacheBudgetMB = Math.min(prefs.memory.maxCacheMB, ramBudgetMB)
  const scratchBudgetMB = prefs.scratchDisks
    .filter((disk) => disk.enabled)
    .reduce((total, disk) => total + disk.quotaMB, 0)
  const webglAvailable = environmentWebglAvailable(env)
  const workerAvailable = environmentWorkerAvailable(env)
  const workerFilters = prefs.gpu.useWorkers && workerAvailable
  const gpuPath: PerformancePolicySummary["gpuPath"] =
    !prefs.gpu.enabled || prefs.gpu.compositing === "cpu"
      ? "disabled"
      : prefs.gpu.useWebGL && webglAvailable
        ? prefs.gpu.mode === "advanced"
          ? "webgl-advanced"
          : "webgl-basic"
        : "cpu-fallback"
  const tileBytes = prefs.memory.tileSize * prefs.memory.tileSize * 4
  const estimatedTileCapacity = Math.max(1, Math.floor((cacheBudgetMB * 1024 * 1024) / tileBytes))
  const warnings: string[] = []
  if (prefs.gpu.enabled && prefs.gpu.useWebGL && !webglAvailable) {
    warnings.push("WebGL is unavailable; preview compositing falls back to CPU rendering.")
  }
  if (prefs.gpu.useWorkers && !workerAvailable) {
    warnings.push("Web Workers are unavailable; filter previews run on the main thread.")
  }
  if (!scratchBudgetMB) warnings.push("No scratch disk is enabled; large temporary data stays in memory.")
  if (prefs.memory.maxCacheMB > ramBudgetMB) warnings.push("Cache budget is limited by the RAM allocation.")

  return {
    ramBudgetMB,
    cacheBudgetMB,
    scratchBudgetMB,
    cacheLevels: prefs.memory.cacheLevels,
    tileSize: prefs.memory.tileSize,
    estimatedTileCapacity,
    gpuPath,
    workerFilters,
    historyStates: prefs.memory.historyStates,
    historyCompression: prefs.memory.historyCompression,
    warnings,
  }
}

export function deriveFileHandlingPolicy(input: unknown, file: FileHandlingInput): FileHandlingPolicySummary {
  const prefs = normalizePreferences(input)
  const warnings: string[] = []
  const isLarge = typeof file.sizeMB === "number" && file.sizeMB >= 512
  const largeFileAction: FileHandlingPolicySummary["largeFileAction"] = isLarge ? prefs.fileHandling.largeFilePolicy : "open"
  const missingFontAction: FileHandlingPolicySummary["missingFontAction"] = file.hasMissingFonts
    ? prefs.fileHandling.missingFontPolicy
    : "none"

  if (isLarge) warnings.push(`large file: ${file.name} is ${Math.round(file.sizeMB ?? 0)} MB; policy is ${largeFileAction}.`)
  if (file.hasMissingFonts) warnings.push(`Missing fonts: policy is ${missingFontAction}.`)
  if (prefs.fileHandling.appendCompatibilityWarnings) warnings.push("Compatibility warnings will be appended to import and export reports.")
  if (prefs.fileHandling.preferProjectFormat && file.format && file.format !== "project") {
    warnings.push("Project format is preferred for preserving editor-specific metadata.")
  }
  if (!prefs.fileHandling.preserveMetadata) warnings.push("Metadata preservation is disabled for supported exports.")

  return {
    autoSave: prefs.fileHandling.autoSave,
    autosaveIntervalSec: prefs.fileHandling.autosaveIntervalSec,
    askBeforeClosing: prefs.fileHandling.askBeforeClosing,
    preferProjectFormat: prefs.fileHandling.preferProjectFormat,
    preserveMetadata: prefs.fileHandling.preserveMetadata,
    recentFilesLimit: prefs.fileHandling.recentFilesLimit,
    largeFileAction,
    missingFontAction,
    warnings,
  }
}

export function createHistoryLogEntry(
  label: string,
  prefsInput: unknown,
  meta: {
    createdAt?: string
    documentName?: string
    tool?: string
    changedLayerIds?: string[]
    toolSettings?: Record<string, unknown>
  } = {},
): PreferenceHistoryLogEntry {
  const prefs = normalizePreferences(prefsInput)
  return {
    id: `log_${Math.random().toString(36).slice(2, 9)}`,
    label,
    ...(prefs.historyLog.includeTimestamps ? { createdAt: meta.createdAt ?? new Date().toISOString() } : {}),
    ...(meta.documentName ? { documentName: meta.documentName } : {}),
    ...(meta.tool ? { tool: meta.tool } : {}),
    ...(meta.changedLayerIds?.length ? { changedLayerIds: [...meta.changedLayerIds] } : {}),
    ...(prefs.historyLog.includeToolSettings && meta.toolSettings ? { toolSettings: clone(meta.toolSettings) } : {}),
  }
}

export function appendHistoryLog(prefsInput: unknown, entry: PreferenceHistoryLogEntry): PhotoshopPreferences {
  const prefs = normalizePreferences(prefsInput)
  if (!prefs.historyLog.enabled) return prefs
  const entries = [...prefs.historyLog.entries, clone(entry)].slice(-prefs.historyLog.maxEntries)
  return normalizePreferences({
    ...prefs,
    historyLog: {
      ...prefs.historyLog,
      entries,
    },
  })
}

export function formatHistoryLog(prefsInput: unknown): string {
  const prefs = normalizePreferences(prefsInput)
  return prefs.historyLog.entries
    .map((entry) => {
      const parts = [
        ...(entry.createdAt ? [entry.createdAt] : []),
        entry.documentName ?? "Untitled",
        entry.tool ?? "unknown",
        entry.label,
      ]
      if (entry.changedLayerIds?.length) parts.push(`layers: ${entry.changedLayerIds.join(",")}`)
      if (entry.toolSettings) parts.push(`settings: ${JSON.stringify(entry.toolSettings)}`)
      return parts.join(" | ")
    })
    .join("\n")
}

export function applyPreferencesToDocumentSettings(input: unknown): Partial<Pick<
  PsDocument,
  | "rulerUnits"
  | "gridSize"
  | "gridSubdivisions"
  | "gridColor"
  | "gridOpacity"
  | "showGrid"
  | "showPixelGrid"
  | "snapToGrid"
  | "snapToGuides"
  | "showSmartGuides"
  | "rulerOrigin"
>> {
  const prefs = normalizePreferences(input)
  return {
    rulerUnits: prefs.rulerGrid.rulerUnits,
    gridSize: prefs.rulerGrid.gridSize,
    gridSubdivisions: prefs.rulerGrid.gridSubdivisions,
    gridColor: prefs.rulerGrid.gridColor,
    gridOpacity: prefs.rulerGrid.gridOpacity,
    showGrid: prefs.rulerGrid.showGrid,
    showPixelGrid: prefs.rulerGrid.showPixelGrid,
    snapToGrid: prefs.rulerGrid.snapToGrid,
    snapToGuides: prefs.rulerGrid.snapToGuides,
    showSmartGuides: prefs.rulerGrid.smartGuides,
    rulerOrigin: { ...prefs.rulerGrid.rulerOrigin },
  }
}

export function loadPreferencesFromStorage(storage?: Pick<Storage, "getItem">): PhotoshopPreferences {
  const target = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined)
  if (!target) return clone(DEFAULT_PREFERENCES)
  try {
    const raw = target.getItem(PREFERENCES_STORAGE_KEY)
    return raw ? parsePreferencesSet(raw) : clone(DEFAULT_PREFERENCES)
  } catch {
    return clone(DEFAULT_PREFERENCES)
  }
}

export function savePreferencesToStorage(prefsInput: unknown, storage?: Pick<Storage, "setItem">): PhotoshopPreferences {
  const prefs = normalizePreferences(prefsInput)
  const target = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined)
  if (target) target.setItem(PREFERENCES_STORAGE_KEY, serializePreferences(prefs))
  return prefs
}

export function recordHistoryLogEntryFromStorage(
  label: string,
  meta: {
    documentName?: string
    tool?: string
    changedLayerIds?: string[]
    toolSettings?: Record<string, unknown>
  } = {},
): PreferenceHistoryLogEntry | null {
  if (typeof window === "undefined") return null
  const prefs = loadPreferencesFromStorage()
  if (!prefs.historyLog.enabled) return null
  const entry = createHistoryLogEntry(label, prefs, meta)
  const next = appendHistoryLog(prefs, entry)
  savePreferencesToStorage(next)
  window.dispatchEvent(new CustomEvent("ps-preferences-history-log-changed", { detail: next.historyLog }))
  return entry
}
