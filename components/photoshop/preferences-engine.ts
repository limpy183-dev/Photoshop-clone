import type { PsDocument } from "./types"

export const PREFERENCES_STORAGE_KEY = "ps-preferences"
export const PREFERENCES_SCHEMA_VERSION = 5
export const MAX_PREFERENCES_IMPORT_BYTES = 1024 * 1024
export const MAX_IMPORTED_SCRATCH_DISKS = 32
export const MAX_IMPORTED_HISTORY_ENTRIES = 10000
export const MAX_IMPORTED_HISTORY_LAYER_IDS = 500
export const MAX_IMPORTED_HISTORY_TOOL_SETTINGS_BYTES = 64 * 1024
export const DEFAULT_CALIBRATION_LINE_MM = 100
export const DEFAULT_CALIBRATION_CSS_PIXELS = (DEFAULT_CALIBRATION_LINE_MM / 25.4) * 96

export type CursorStylePreference = "standard" | "precise" | "brush-size"
export type LegacyUnitPreference = "pixels" | "inches" | "cm" | "mm" | "pt" | "pc"
export type RulerUnitPreference = NonNullable<PsDocument["rulerUnits"]>
export type TypeUnitPreference = "px" | "pt"
export type ScratchDiskKind = "browser-storage" | "download-folder" | "opfs" | "custom"
export type GpuModePreference = "auto" | "basic" | "advanced"
export type GpuCompositingPreference = "cpu" | "worker" | "gpu-preferred"
export type PerformanceModePreference = "quality" | "balanced" | "performance"
export type MissingFontPolicy = "warn" | "substitute" | "rasterize"
export type LargeFilePolicy = "ask" | "downsample-preview" | "block"
export type HistoryLogDestination = "metadata" | "text-file" | "both"

export const TECHNOLOGY_PREVIEW_FLAGS = [
  {
    id: "hdrCanvasCompositor",
    label: "HDR canvas compositor",
    helpText: "Routes high-bit and HDR preview layers through the experimental wide-range canvas compositor before tone mapping.",
    riskText: "Tone mapping can differ from the stable compositor, especially in mixed 8-bit and high-bit documents.",
  },
  {
    id: "webgpuAcceleration",
    label: "WebGPU acceleration",
    helpText: "Enables WebGPU-backed acceleration experiments for eligible color, filter, and preview pipelines when the browser exposes WebGPU.",
    riskText: "Browser and driver differences can cause slower fallback, visual mismatches, or disabled acceleration on some devices.",
  },
  {
    id: "localGenerativeFill",
    label: "Local generative fill endpoint",
    helpText: "Shows model-backed generative fill routing controls alongside the deterministic local inpainting fallback.",
    riskText: "Generated results depend on the configured endpoint and may differ from the local deterministic preview path.",
  },
  {
    id: "cameraRawSidecars",
    label: "Camera Raw sidecar workflow",
    helpText: "Enables experimental Camera Raw XMP sidecar import/export controls for RAW-style browser edits.",
    riskText: "Recipe coverage is partial; keep original RAW files and generated sidecars together for review.",
  },
] as const

export type TechnologyPreviewFlagId = (typeof TECHNOLOGY_PREVIEW_FLAGS)[number]["id"]
export type TechnologyPreviewPreferences = Record<TechnologyPreviewFlagId, boolean>
export type TechnologyPreviewFlagState = (typeof TECHNOLOGY_PREVIEW_FLAGS)[number] & { enabled: boolean }

export type PreferenceSection =
  | "general"
  | "memory"
  | "scratchDisks"
  | "gpu"
  | "fileHandling"
  | "historyLog"
  | "toolBehavior"
  | "rulerGrid"
  | "technologyPreviews"

export const PREFERENCE_IMPORT_SECTIONS: PreferenceSection[] = [
  "general",
  "memory",
  "scratchDisks",
  "gpu",
  "fileHandling",
  "historyLog",
  "toolBehavior",
  "rulerGrid",
  "technologyPreviews",
]

export const PREFERENCE_SECTION_LABELS: Record<PreferenceSection, string> = {
  general: "General",
  memory: "Performance",
  scratchDisks: "Scratch Disks",
  gpu: "GPU",
  fileHandling: "File Handling",
  historyLog: "History Log",
  toolBehavior: "Cursors & Tools",
  rulerGrid: "Units & Rulers",
  technologyPreviews: "Technology Previews",
}

export interface MemoryPreferences {
  performanceMode: PerformanceModePreference
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
  showBrushSizeCrosshair: boolean
  showToolStatusHud: boolean
  precisePicking: boolean
  shiftCyclesTools: boolean
  showTooltips: boolean
  springLoadedTools: boolean
  autoSelectLayer: boolean
  brushSmoothing: number
  wheelZooms: boolean
  animatedZoom: boolean
}

export interface ScreenCalibrationPreferences {
  cssPixelLength: number
  measuredMm: number
  calibratedAt?: string
}

export interface RulerGridPreferences {
  rulerUnits: RulerUnitPreference
  typeUnits: TypeUnitPreference
  printResolution: number
  screenDpi: number
  screenCalibration: ScreenCalibrationPreferences | null
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
  technologyPreviews: TechnologyPreviewPreferences
  /**
   * Recent-document IDs the user pinned from the Home/Start workspace.
   * Persisted with preferences so pinned files survive across sessions
   * and stay alongside the rest of the editor's user state.
   */
  pinnedFiles: string[]
}

export const MAX_PINNED_FILES = 32

export interface PerformanceEnvironment {
  deviceMemoryGB?: number
  webglAvailable?: boolean
  workerAvailable?: boolean
}

export interface PerformancePolicySummary {
  performanceMode: PerformanceModePreference
  performanceModeLabel: string
  performanceModeDetail: string
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
    performanceMode: "balanced",
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
    showBrushSizeCrosshair: true,
    showToolStatusHud: false,
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
    screenDpi: 96,
    screenCalibration: null,
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
  technologyPreviews: {
    hdrCanvasCompositor: false,
    webgpuAcceleration: false,
    localGenerativeFill: false,
    cameraRawSidecars: false,
  },
  pinnedFiles: [],
}

const TILE_SIZES = [64, 128, 256, 512, 1024]
const PERFORMANCE_MODES = ["quality", "balanced", "performance"] as const
const CURSOR_STYLES = ["standard", "precise", "brush-size"] as const
const RULER_UNITS = ["px", "in", "cm", "mm", "pt", "pc"] as const
const TYPE_UNITS = ["px", "pt"] as const
const SCRATCH_DISK_KINDS = ["browser-storage", "download-folder", "opfs", "custom"] as const
const GPU_MODES = ["auto", "basic", "advanced"] as const
const GPU_COMPOSITING_MODES = ["cpu", "worker", "gpu-preferred"] as const
const MISSING_FONT_POLICIES = ["warn", "substitute", "rasterize"] as const
const LARGE_FILE_POLICIES = ["ask", "downsample-preview", "block"] as const
const HISTORY_LOG_DESTINATIONS = ["metadata", "text-file", "both"] as const

export interface PerformanceModePreset {
  id: PerformanceModePreference
  label: string
  detail: string
  memory: MemoryPreferences
  gpu: Partial<GpuPreferences>
}

export const PERFORMANCE_MODE_PRESETS: Record<PerformanceModePreference, PerformanceModePreset> = {
  quality: {
    id: "quality",
    label: "Quality",
    detail: "Prioritizes full-resolution previews, larger tiles, deeper cache levels, and longer history when the browser has enough headroom.",
    memory: {
      performanceMode: "quality",
      ramPercent: 80,
      maxCacheMB: 8192,
      cacheLevels: 6,
      tileSize: 512,
      historyStates: 100,
      historyCompression: true,
    },
    gpu: {
      enabled: true,
      mode: "advanced",
      useWebGL: true,
      useWorkers: true,
      compositing: "gpu-preferred",
    },
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    detail: "Keeps cache, tile size, worker usage, and history depth in the default middle path for mixed editing workloads.",
    memory: {
      performanceMode: "balanced",
      ramPercent: 70,
      maxCacheMB: 4096,
      cacheLevels: 4,
      tileSize: 256,
      historyStates: 50,
      historyCompression: true,
    },
    gpu: {
      enabled: true,
      mode: "auto",
      useWebGL: true,
      useWorkers: true,
      compositing: "gpu-preferred",
    },
  },
  performance: {
    id: "performance",
    label: "Performance",
    detail: "Prioritizes responsiveness with smaller tiles, shallower caches, compressed history, and worker-preferred rendering paths.",
    memory: {
      performanceMode: "performance",
      ramPercent: 55,
      maxCacheMB: 2048,
      cacheLevels: 2,
      tileSize: 128,
      historyStates: 25,
      historyCompression: true,
    },
    gpu: {
      enabled: true,
      mode: "basic",
      useWebGL: true,
      useWorkers: true,
      compositing: "worker",
    },
  },
}

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

function importedPreferenceRoot(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Preference file root must be an object.")
  if ("preferences" in value) {
    if (!isRecord(value.preferences)) throw new Error("preferences must be an object.")
    return value.preferences
  }
  return value
}

function validateObjectSection(root: Record<string, unknown>, key: PreferenceSection) {
  if (key in root && !isRecord(root[key])) throw new Error(`${key} must be an object.`)
}

function validateArraySection(root: Record<string, unknown>, key: PreferenceSection) {
  if (key in root && !Array.isArray(root[key])) throw new Error(`${key} must be an array.`)
}

function validateNumberField(record: Record<string, unknown>, path: string, displayPath = path) {
  const value = path.split(".").reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), record)
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`${displayPath} must be a number.`)
  }
}

function validateBooleanField(record: Record<string, unknown>, path: string, displayPath = path) {
  const value = path.split(".").reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), record)
  if (value !== undefined && typeof value !== "boolean") throw new Error(`${displayPath} must be a boolean.`)
}

function validateStringField(record: Record<string, unknown>, path: string, displayPath = path) {
  const value = path.split(".").reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), record)
  if (value !== undefined && typeof value !== "string") throw new Error(`${displayPath} must be a string.`)
}

function validateEnumField<T extends string>(
  record: Record<string, unknown>,
  path: string,
  options: readonly T[],
  displayPath = path,
) {
  const value = path.split(".").reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), record)
  if (value !== undefined && (typeof value !== "string" || !(options as readonly string[]).includes(value))) {
    throw new Error(`${displayPath} must be one of: ${options.join(", ")}.`)
  }
}

function validatePreferenceImportShape(value: unknown) {
  const root = importedPreferenceRoot(value)

  validateNumberField(root, "schemaVersion")
  validateNumberField(root, "gridSize")
  validateNumberField(root, "undoLimit")
  validateStringField(root, "cursorStyle")
  validateStringField(root, "units")
  validateStringField(root, "defaultBackground")
  validateBooleanField(root, "showTooltips")
  validateBooleanField(root, "autoSave")
  validateNumberField(root, "smoothing")

  validateObjectSection(root, "general")
  validateObjectSection(root, "memory")
  validateArraySection(root, "scratchDisks")
  validateObjectSection(root, "gpu")
  validateObjectSection(root, "fileHandling")
  validateObjectSection(root, "historyLog")
  validateObjectSection(root, "toolBehavior")
  validateObjectSection(root, "rulerGrid")
  validateObjectSection(root, "technologyPreviews")

  const memory = asRecord(root.memory)
  ;["ramPercent", "maxCacheMB", "cacheLevels", "tileSize", "historyStates"].forEach((key) =>
    validateNumberField(memory, key, `memory.${key}`),
  )
  validateEnumField(memory, "performanceMode", PERFORMANCE_MODES, "memory.performanceMode")
  validateBooleanField(memory, "historyCompression", "memory.historyCompression")

  if (Array.isArray(root.scratchDisks)) {
    root.scratchDisks.forEach((disk, index) => {
      if (!isRecord(disk)) throw new Error(`scratchDisks[${index}] must be an object.`)
      validateStringField(disk, "id", `scratchDisks[${index}].id`)
      validateStringField(disk, "label", `scratchDisks[${index}].label`)
      validateBooleanField(disk, "enabled", `scratchDisks[${index}].enabled`)
      validateNumberField(disk, "priority", `scratchDisks[${index}].priority`)
      validateNumberField(disk, "quotaMB", `scratchDisks[${index}].quotaMB`)
      validateEnumField(disk, "kind", SCRATCH_DISK_KINDS, `scratchDisks[${index}].kind`)
      validateStringField(disk, "path", `scratchDisks[${index}].path`)
    })
  }

  const gpu = asRecord(root.gpu)
  validateBooleanField(gpu, "enabled", "gpu.enabled")
  validateEnumField(gpu, "mode", GPU_MODES, "gpu.mode")
  validateBooleanField(gpu, "useWebGL", "gpu.useWebGL")
  validateBooleanField(gpu, "useWorkers", "gpu.useWorkers")
  validateEnumField(gpu, "compositing", GPU_COMPOSITING_MODES, "gpu.compositing")
  validateBooleanField(gpu, "rayTracingPreview", "gpu.rayTracingPreview")

  const fileHandling = asRecord(root.fileHandling)
  ;["autoSave", "askBeforeClosing", "preferProjectFormat", "appendCompatibilityWarnings", "preserveMetadata"].forEach((key) =>
    validateBooleanField(fileHandling, key, `fileHandling.${key}`),
  )
  ;["recentFilesLimit", "autosaveIntervalSec"].forEach((key) => validateNumberField(fileHandling, key, `fileHandling.${key}`))
  validateEnumField(fileHandling, "missingFontPolicy", MISSING_FONT_POLICIES, "fileHandling.missingFontPolicy")
  validateEnumField(fileHandling, "largeFilePolicy", LARGE_FILE_POLICIES, "fileHandling.largeFilePolicy")

  const historyLog = asRecord(root.historyLog)
  validateBooleanField(historyLog, "enabled", "historyLog.enabled")
  validateEnumField(historyLog, "destination", HISTORY_LOG_DESTINATIONS, "historyLog.destination")
  validateBooleanField(historyLog, "includeTimestamps", "historyLog.includeTimestamps")
  validateBooleanField(historyLog, "includeToolSettings", "historyLog.includeToolSettings")
  validateNumberField(historyLog, "maxEntries", "historyLog.maxEntries")
  if ("entries" in historyLog && !Array.isArray(historyLog.entries)) throw new Error("historyLog.entries must be an array.")

  const toolBehavior = asRecord(root.toolBehavior)
  validateEnumField(toolBehavior, "cursorStyle", CURSOR_STYLES, "toolBehavior.cursorStyle")
  validateBooleanField(toolBehavior, "showBrushPreview", "toolBehavior.showBrushPreview")
  validateBooleanField(toolBehavior, "showBrushSizeCrosshair", "toolBehavior.showBrushSizeCrosshair")
  validateBooleanField(toolBehavior, "showToolStatusHud", "toolBehavior.showToolStatusHud")
  validateBooleanField(toolBehavior, "precisePicking", "toolBehavior.precisePicking")
  validateBooleanField(toolBehavior, "shiftCyclesTools", "toolBehavior.shiftCyclesTools")
  validateBooleanField(toolBehavior, "showTooltips", "toolBehavior.showTooltips")
  validateBooleanField(toolBehavior, "springLoadedTools", "toolBehavior.springLoadedTools")
  validateBooleanField(toolBehavior, "autoSelectLayer", "toolBehavior.autoSelectLayer")
  validateNumberField(toolBehavior, "brushSmoothing", "toolBehavior.brushSmoothing")
  validateBooleanField(toolBehavior, "wheelZooms", "toolBehavior.wheelZooms")
  validateBooleanField(toolBehavior, "animatedZoom", "toolBehavior.animatedZoom")

  const rulerGrid = asRecord(root.rulerGrid)
  validateEnumField(rulerGrid, "rulerUnits", RULER_UNITS, "rulerGrid.rulerUnits")
  validateEnumField(rulerGrid, "typeUnits", TYPE_UNITS, "rulerGrid.typeUnits")
  ;["printResolution", "screenDpi", "gridSize", "gridSubdivisions", "gridOpacity"].forEach((key) =>
    validateNumberField(rulerGrid, key, `rulerGrid.${key}`),
  )
  validateStringField(rulerGrid, "gridColor", "rulerGrid.gridColor")
  validateStringField(rulerGrid, "guidesColor", "rulerGrid.guidesColor")
  ;["showGrid", "showPixelGrid", "snapToGrid", "snapToGuides", "smartGuides"].forEach((key) =>
    validateBooleanField(rulerGrid, key, `rulerGrid.${key}`),
  )
  if ("rulerOrigin" in rulerGrid && !isRecord(rulerGrid.rulerOrigin)) throw new Error("rulerGrid.rulerOrigin must be an object.")
  if (isRecord(rulerGrid.rulerOrigin)) {
    validateNumberField(rulerGrid.rulerOrigin, "x", "rulerGrid.rulerOrigin.x")
    validateNumberField(rulerGrid.rulerOrigin, "y", "rulerGrid.rulerOrigin.y")
  }
  if ("screenCalibration" in rulerGrid && rulerGrid.screenCalibration !== null && !isRecord(rulerGrid.screenCalibration)) {
    throw new Error("rulerGrid.screenCalibration must be an object or null.")
  }
  if (isRecord(rulerGrid.screenCalibration)) {
    validateNumberField(rulerGrid.screenCalibration, "cssPixelLength", "rulerGrid.screenCalibration.cssPixelLength")
    validateNumberField(rulerGrid.screenCalibration, "measuredMm", "rulerGrid.screenCalibration.measuredMm")
    validateStringField(rulerGrid.screenCalibration, "calibratedAt", "rulerGrid.screenCalibration.calibratedAt")
  }

  const technologyPreviews = asRecord(root.technologyPreviews)
  TECHNOLOGY_PREVIEW_FLAGS.forEach((flag) =>
    validateBooleanField(technologyPreviews, flag.id, `technologyPreviews.${flag.id}`),
  )
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
  const root = importedPreferenceRoot(value)

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
  return optionValue(value, RULER_UNITS, fallback)
}

function rulerToLegacy(unit: RulerUnitPreference): LegacyUnitPreference {
  if (unit === "px") return "pixels"
  if (unit === "in") return "inches"
  return unit
}

function normalizeMemory(input: Record<string, unknown>, legacyUndoLimit: unknown): MemoryPreferences {
  const defaults = DEFAULT_PREFERENCES.memory
  return {
    performanceMode: optionValue(input.performanceMode, PERFORMANCE_MODES, defaults.performanceMode),
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
      kind: optionValue(record.kind, SCRATCH_DISK_KINDS, fallback.kind),
      ...(path ? { path } : {}),
    }
  })
}

function normalizeGpu(input: Record<string, unknown>): GpuPreferences {
  const defaults = DEFAULT_PREFERENCES.gpu
  return {
    enabled: boolValue(input.enabled, defaults.enabled),
    mode: optionValue(input.mode, GPU_MODES, defaults.mode),
    useWebGL: boolValue(input.useWebGL, defaults.useWebGL),
    useWorkers: boolValue(input.useWorkers, defaults.useWorkers),
    compositing: optionValue(input.compositing, GPU_COMPOSITING_MODES, defaults.compositing),
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
    missingFontPolicy: optionValue(input.missingFontPolicy, MISSING_FONT_POLICIES, defaults.missingFontPolicy),
    largeFilePolicy: optionValue(input.largeFilePolicy, LARGE_FILE_POLICIES, defaults.largeFilePolicy),
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
    destination: optionValue(input.destination, HISTORY_LOG_DESTINATIONS, defaults.destination),
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
    cursorStyle: optionValue(input.cursorStyle ?? legacyCursorStyle, CURSOR_STYLES, defaults.cursorStyle),
    showBrushPreview: boolValue(input.showBrushPreview, defaults.showBrushPreview),
    showBrushSizeCrosshair: boolValue(input.showBrushSizeCrosshair, defaults.showBrushSizeCrosshair),
    showToolStatusHud: boolValue(input.showToolStatusHud, defaults.showToolStatusHud),
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

function normalizeScreenCalibration(value: unknown): ScreenCalibrationPreferences | null {
  if (value === null) return null
  const record = asRecord(value)
  if (!Object.keys(record).length) return null
  const cssPixelLength = clampNumber(record.cssPixelLength, DEFAULT_CALIBRATION_CSS_PIXELS, 32, 2000, false)
  const measuredMm = clampNumber(record.measuredMm, DEFAULT_CALIBRATION_LINE_MM, 1, 1000, false)
  return {
    cssPixelLength,
    measuredMm,
    ...(typeof record.calibratedAt === "string" ? { calibratedAt: record.calibratedAt } : {}),
  }
}

function normalizeRulerGrid(input: Record<string, unknown>, legacyGridSize: unknown, legacyUnits: unknown): RulerGridPreferences {
  const defaults = DEFAULT_PREFERENCES.rulerGrid
  const origin = asRecord(input.rulerOrigin)
  return {
    rulerUnits: unitToRuler(input.rulerUnits ?? legacyUnits, defaults.rulerUnits),
    typeUnits: optionValue(input.typeUnits, TYPE_UNITS, defaults.typeUnits),
    printResolution: clampNumber(input.printResolution, defaults.printResolution, 1, 2400),
    screenDpi: clampNumber(input.screenDpi, defaults.screenDpi, 30, 600, false),
    screenCalibration: normalizeScreenCalibration(input.screenCalibration),
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

function normalizePinnedFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const candidate of value) {
    if (typeof candidate !== "string") continue
    const trimmed = candidate.trim().slice(0, 120)
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
    if (result.length >= MAX_PINNED_FILES) break
  }
  return result
}

function normalizeTechnologyPreviews(input: Record<string, unknown>): TechnologyPreviewPreferences {
  const defaults = DEFAULT_PREFERENCES.technologyPreviews
  return TECHNOLOGY_PREVIEW_FLAGS.reduce((flags, flag) => {
    flags[flag.id] = boolValue(input[flag.id], defaults[flag.id])
    return flags
  }, {} as TechnologyPreviewPreferences)
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
    technologyPreviews: normalizeTechnologyPreviews(nestedRecord(raw, "technologyPreviews")),
    pinnedFiles: normalizePinnedFiles(raw.pinnedFiles),
  })
}

export function serializePreferences(prefs: unknown): string {
  return JSON.stringify(normalizePreferences(prefs), null, 2)
}

export function calculateScreenDpiFromCalibration({
  cssPixelLength,
  measuredMm,
}: {
  cssPixelLength: number
  measuredMm: number
}): number {
  if (!Number.isFinite(cssPixelLength) || cssPixelLength <= 0) {
    throw new Error("Calibration line length must be greater than 0 CSS pixels.")
  }
  if (!Number.isFinite(measuredMm) || measuredMm <= 0) {
    throw new Error("Measured length must be greater than 0 mm.")
  }
  return Number((cssPixelLength / (measuredMm / 25.4)).toFixed(4))
}

export function calculatePrintSizeZoom({
  screenDpi,
  documentDpi,
}: {
  screenDpi: number
  documentDpi: number
}): number {
  if (!Number.isFinite(screenDpi) || screenDpi <= 0) throw new Error("Screen DPI must be greater than 0.")
  if (!Number.isFinite(documentDpi) || documentDpi <= 0) throw new Error("Document DPI must be greater than 0.")
  return Math.max(0.05, Math.min(32, screenDpi / documentDpi))
}

export function importPreferenceSections(
  currentInput: unknown,
  importedInput: unknown,
  sections: readonly PreferenceSection[],
): PhotoshopPreferences {
  const current = normalizePreferences(currentInput)
  const imported = normalizePreferences(importedInput)
  const next = clone(current)
  const selected = new Set(sections)

  if (selected.has("general")) {
    next.defaultBackground = imported.defaultBackground
  }
  if (selected.has("memory")) next.memory = clone(imported.memory)
  if (selected.has("scratchDisks")) next.scratchDisks = clone(imported.scratchDisks)
  if (selected.has("gpu")) next.gpu = clone(imported.gpu)
  if (selected.has("fileHandling")) next.fileHandling = clone(imported.fileHandling)
  if (selected.has("historyLog")) next.historyLog = clone(imported.historyLog)
  if (selected.has("toolBehavior")) next.toolBehavior = clone(imported.toolBehavior)
  if (selected.has("rulerGrid")) next.rulerGrid = clone(imported.rulerGrid)
  if (selected.has("technologyPreviews")) next.technologyPreviews = clone(imported.technologyPreviews)

  return syncLegacyFields(next)
}

export function parsePreferencesSet(value: string | unknown): PhotoshopPreferences {
  if (typeof value === "string") {
    if (value.length > MAX_PREFERENCES_IMPORT_BYTES) {
      throw new Error(`Preference imports are limited to ${Math.round(MAX_PREFERENCES_IMPORT_BYTES / 1024)} KB.`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown parse error"
      throw new Error(`Preference file is not valid JSON: ${message}`)
    }
    validatePreferenceImportShape(parsed)
    assertPreferenceImportBounds(parsed)
    return normalizePreferences(isRecord(parsed) && isRecord(parsed.preferences) ? parsed.preferences : parsed)
  }
  validatePreferenceImportShape(value)
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

export function summarizeTechnologyPreviewFlags(input: unknown): TechnologyPreviewFlagState[] {
  const prefs = normalizePreferences(input)
  return TECHNOLOGY_PREVIEW_FLAGS.map((flag) => ({
    ...flag,
    enabled: prefs.technologyPreviews[flag.id],
  }))
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
  const mode = PERFORMANCE_MODE_PRESETS[prefs.memory.performanceMode]
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
    performanceMode: mode.id,
    performanceModeLabel: mode.label,
    performanceModeDetail: mode.detail,
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

export function applyPerformanceModePreference(input: unknown, mode: PerformanceModePreference): PhotoshopPreferences {
  const current = normalizePreferences(input)
  const preset = PERFORMANCE_MODE_PRESETS[mode]
  return normalizePreferences({
    ...current,
    memory: {
      ...current.memory,
      ...preset.memory,
    },
    gpu: {
      ...current.gpu,
      ...preset.gpu,
    },
  })
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

export function readPinnedFiles(storage?: Pick<Storage, "getItem">): string[] {
  return loadPreferencesFromStorage(storage).pinnedFiles
}

/**
 * Toggle a recent-document ID in the persisted pinned-files list. Returns
 * the new list so callers don't need to re-read storage.
 */
export function togglePinnedFile(
  id: string,
  storages: { read?: Pick<Storage, "getItem">; write?: Pick<Storage, "setItem"> } = {},
): string[] {
  const trimmed = id.trim().slice(0, 120)
  if (!trimmed) return readPinnedFiles(storages.read)
  const current = loadPreferencesFromStorage(storages.read)
  const exists = current.pinnedFiles.includes(trimmed)
  const next = exists
    ? current.pinnedFiles.filter((entry) => entry !== trimmed)
    : [trimmed, ...current.pinnedFiles].slice(0, MAX_PINNED_FILES)
  const saved = savePreferencesToStorage({ ...current, pinnedFiles: next }, storages.write)
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("ps-preferences-changed", { detail: saved }))
  }
  return saved.pinnedFiles
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
