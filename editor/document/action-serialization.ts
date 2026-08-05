/**
 * Serialization and import validation for recorded actions.
 *
 * An exported action carries whole history entries — layer snapshots, canvas
 * patches, smart filters — so importing one is untrusted input that inflates
 * into canvases. Everything here exists to bound that: size caps, key
 * allow-lists, and data-URL checks applied before a single pixel is decoded.
 *
 * This is pure validation and (de)serialization with no React in it; the panel
 * that calls it lives in `components/photoshop/panels/actions-panel.tsx`.
 */


import { canvasFromDataUrl } from "@/editor/document/io"
import { MAX_CANVAS_DIMENSION, MAX_PROJECT_LAYERS } from "@/editor/canvas/limits"
import { CLIENT_STORAGE_KEYS, readClientStorageString } from "@/editor/client-storage"
import type {
  CanvasPatch,
  HistoryEntry,
  LayerSnapshot,
  MacroAction,
  MacroStep,
  SmartFilter,
} from "@/editor/types"
import { uid } from "@/editor/uid"
import {
  normalizePlaybackSpeed,
  playbackSpeedToDelayMs,
  type ActionPlaybackSpeed,
  type StepEnvelope,
} from "@/editor/action-conditionals"
export { playbackSpeedToDelayMs }

type SerializedCanvasPatch = Omit<CanvasPatch, "canvas"> & { canvasDataUrl: string | null }
type SerializedSmartFilter = Omit<SmartFilter, "mask"> & { maskDataUrl?: string | null }
type SerializedLayerSnapshot = Omit<LayerSnapshot, "canvas" | "mask" | "canvasPatches" | "frame" | "smartFilters" | "smartSource"> & {
  canvasDataUrl?: string | null
  maskDataUrl?: string | null
  canvasPatches?: SerializedCanvasPatch[]
  frame?: LayerSnapshot["frame"] & { imageDataUrl?: string | null; imageCanvas?: undefined }
  smartFilters?: SerializedSmartFilter[]
  smartSource?: LayerSnapshot["smartSource"] & { canvasDataUrl?: string | null; canvas?: undefined }
}
type SerializedHistoryEntry = Omit<HistoryEntry, "layers"> & { layers: SerializedLayerSnapshot[] }
type SerializedMacroAction = Omit<MacroAction, "steps"> & {
  steps: (Omit<MacroAction["steps"][number], "entry"> & { entry: SerializedHistoryEntry })[]
}

export const MAX_ACTION_IMPORT_BYTES = 12 * 1024 * 1024
const MAX_IMPORTED_ACTIONS = 50
const MAX_ACTION_STEPS = 200
const MAX_ACTION_DATA_URL_LENGTH = 4_000_000
const MAX_ACTION_CANVAS_PATCHES = 200
const MAX_ACTION_SMART_FILTERS = 50
const MAX_ACTION_ID_REFERENCES = MAX_PROJECT_LAYERS
const MAX_ACTION_FILTER_PARAMS = 100
const MAX_ACTION_GENERIC_ARRAY_ITEMS = 1000
const MAX_ACTION_GENERIC_OBJECT_KEYS = 200
const MAX_ACTION_GENERIC_DEPTH = 12
const MAX_ACTION_STRING_LENGTH = 100_000

const ACTION_IMPORT_KEYS = new Set(["app", "format", "version", "exportedAt", "actions"])
const ACTION_KEYS = new Set(["id", "name", "folder", "createdAt", "updatedAt", "steps"])
const STEP_KEYS = new Set(["id", "label", "createdAt", "entry"])
const HISTORY_ENTRY_KEYS = new Set([
  "id",
  "label",
  "layers",
  "activeLayerId",
  "selectedLayerIds",
  "thumb",
  "width",
  "height",
  "selection",
  "guides",
  "notes",
  "slices",
  "counts",
  "colorSamplers",
  "comps",
  "channels",
  "quickMask",
  "quickMaskCanvas",
  "colorMode",
  "modeSettings",
  "variableDataSets",
  "assetLibrary",
])
const LAYER_KEYS = new Set([
  "id",
  "name",
  "kind",
  "visible",
  "locked",
  "lockTransparency",
  "lockDraw",
  "lockMove",
  "lockAll",
  "smartObject",
  "opacity",
  "fillOpacity",
  "advancedBlending",
  "blendMode",
  "linkGroupId",
  "canvasDataUrl",
  "maskDataUrl",
  "canvasPatches",
  "maskEnabled",
  "vectorMask",
  "clipped",
  "style",
  "childIds",
  "parentId",
  "expanded",
  "text",
  "shape",
  "path",
  "adjustment",
  "frame",
  "artboard",
  "threeD",
  "video",
  "colorLabel",
  "smartFilters",
  "smartSource",
  "notes",
  "metadata",
])
const CANVAS_PATCH_KEYS = new Set(["x", "y", "w", "h", "canvasDataUrl"])
const SMART_FILTER_KEYS = new Set(["id", "filterId", "name", "enabled", "opacity", "blendMode", "params", "maskDataUrl", "maskEnabled", "maskDensity", "maskFeather", "maskLinked"])
const FRAME_KEYS = new Set(["shape", "x", "y", "w", "h", "imageDataUrl", "imageCanvas"])

export function cleanFolderName(value: unknown) {
  const text = typeof value === "string" ? value.trim().slice(0, 80) : ""
  return text || "Ungrouped"
}

export function actionFolderGroups(actions: readonly MacroAction[]) {
  const byFolder = new Map<string, MacroAction[]>()
  for (const action of actions) {
    const folder = cleanFolderName(action.folder)
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), action])
  }
  return Array.from(byFolder.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, groupedActions]) => ({
      name,
      actions: groupedActions.slice().sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name)),
    }))
}

export function buildInsertPathStep(entry: HistoryEntry, now = Date.now()): MacroStep {
  return {
    id: uid("step"),
    label: "Insert Path",
    createdAt: now,
    entry: {
      ...entry,
      id: uid("entry"),
      label: "Insert Path",
    },
  }
}

export function readPlaybackSpeed(): ActionPlaybackSpeed {
  return normalizePlaybackSpeed(readClientStorageString(CLIENT_STORAGE_KEYS.actionPlaybackSpeed))
}

export function actionHasPath(entry: HistoryEntry) {
  return entry.layers.some((layer) => layer.path || layer.vectorMask || layer.shape)
}

export function isEmptyEnvelope(env: StepEnvelope) {
  return !env.condition && !env.breakpoint && !env.pauseMs && !env.onError && !env.retryLimit && !env.retryDelayMs && !env.note
}
const SMART_SOURCE_KEYS = new Set([
  "width",
  "height",
  "canvasDataUrl",
  "canvas",
  "id",
  "name",
  "linkType",
  "fileName",
  "relativePath",
  "status",
  "embedded",
  "updatedAt",
  "fileHandleName",
  "handlePermission",
  "lastKnownModified",
  "sourceHash",
  "editPackage",
  "exportedAt",
  "relinkedAt",
])

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function cleanName(value: unknown, fallback: string) {
  return (typeof value === "string" ? value.trim().slice(0, 80) : "") || fallback
}

export function isSafeImageDataUrl(value: string) {
  return (
    value.length <= MAX_ACTION_DATA_URL_LENGTH &&
    /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value)
  )
}

export function assertKnownKeys(record: Record<string, unknown>, allowed: Set<string>, context: string) {
  const unknown = Object.keys(record).find((key) => !allowed.has(key))
  if (unknown) throw new Error(`${context} contains unknown field "${unknown}".`)
}

export function assertImageDataUrl(value: unknown, context: string) {
  if (value === undefined || value === null || value === "") return
  if (typeof value !== "string" || !isSafeImageDataUrl(value)) {
    throw new Error(`Action file contains an unsafe or oversized image payload at ${context}.`)
  }
}

export function assertBoundedArray(value: unknown, max: number, context: string) {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array.`)
  if (value.length > max) throw new Error(`${context} is limited to ${max} items.`)
  return value
}

export function optionalBoundedArray(value: unknown, max: number, context: string) {
  if (value === undefined) return undefined
  return assertBoundedArray(value, max, context)
}

export function assertFiniteNumber(value: unknown, context: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${context} must be a finite number.`)
  return value
}

export function assertCanvasDimension(value: unknown, context: string) {
  const dimension = assertFiniteNumber(value, context)
  if (dimension < 1 || dimension > MAX_CANVAS_DIMENSION) {
    throw new Error(`${context} is limited to ${MAX_CANVAS_DIMENSION}px.`)
  }
  return dimension
}

export function assertStringArray(value: unknown, max: number, context: string) {
  const items = optionalBoundedArray(value, max, context)
  if (!items) return
  items.forEach((item, index) => {
    if (typeof item !== "string" || item.length > MAX_ACTION_STRING_LENGTH) {
      throw new Error(`${context}[${index}] must be a bounded string.`)
    }
  })
}

export function assertBoundedJsonValue(value: unknown, context: string, depth = 0) {
  if (depth > MAX_ACTION_GENERIC_DEPTH) throw new Error(`${context} is nested too deeply.`)
  if (value === null || value === undefined) return
  if (typeof value === "boolean") return
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${context} must contain finite numbers.`)
    return
  }
  if (typeof value === "string") {
    const lowerContext = context.toLowerCase()
    if (lowerContext.includes("dataurl") || lowerContext.endsWith(".thumb") || lowerContext.endsWith(".posterdataurl")) {
      assertImageDataUrl(value, context)
      return
    }
    if (value.length > MAX_ACTION_STRING_LENGTH) throw new Error(`${context} string is too large.`)
    return
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ACTION_GENERIC_ARRAY_ITEMS) {
      throw new Error(`${context} is limited to ${MAX_ACTION_GENERIC_ARRAY_ITEMS} nested items.`)
    }
    value.forEach((item, index) => assertBoundedJsonValue(item, `${context}[${index}]`, depth + 1))
    return
  }
  if (!isRecord(value)) throw new Error(`${context} contains an unsupported payload.`)
  const entries = Object.entries(value)
  if (entries.length > MAX_ACTION_GENERIC_OBJECT_KEYS) {
    throw new Error(`${context} is limited to ${MAX_ACTION_GENERIC_OBJECT_KEYS} fields.`)
  }
  entries.forEach(([key, child]) => assertBoundedJsonValue(child, `${context}.${key}`, depth + 1))
}

export function validateCanvasPatch(value: unknown, context: string): SerializedCanvasPatch {
  if (!isRecord(value)) throw new Error(`${context} must be an object.`)
  assertKnownKeys(value, CANVAS_PATCH_KEYS, context)
  assertImageDataUrl(value.canvasDataUrl, `${context}.canvasDataUrl`)
  return {
    x: assertFiniteNumber(value.x, `${context}.x`),
    y: assertFiniteNumber(value.y, `${context}.y`),
    w: assertCanvasDimension(value.w, `${context}.w`),
    h: assertCanvasDimension(value.h, `${context}.h`),
    canvasDataUrl: (value.canvasDataUrl as string | null | undefined) ?? null,
  }
}

export function validateSmartFilter(value: unknown, context: string): SerializedSmartFilter {
  if (!isRecord(value)) throw new Error(`${context} must be an object.`)
  assertKnownKeys(value, SMART_FILTER_KEYS, context)
  assertImageDataUrl(value.maskDataUrl, `${context}.maskDataUrl`)
  if (value.params !== undefined) {
    if (!isRecord(value.params)) throw new Error(`${context}.params must be an object.`)
    const params = Object.entries(value.params)
    if (params.length > MAX_ACTION_FILTER_PARAMS) throw new Error(`${context}.params is limited to ${MAX_ACTION_FILTER_PARAMS} fields.`)
    params.forEach(([key, child]) => assertBoundedJsonValue(child, `${context}.params.${key}`, 1))
  }
  return value as SerializedSmartFilter
}

export function validateFrame(value: unknown, context: string): SerializedLayerSnapshot["frame"] {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`${context} must be an object.`)
  assertKnownKeys(value, FRAME_KEYS, context)
  if (value.imageCanvas !== undefined && value.imageCanvas !== null) throw new Error(`${context}.imageCanvas is not importable.`)
  assertImageDataUrl(value.imageDataUrl, `${context}.imageDataUrl`)
  Object.entries(value).forEach(([key, child]) => {
    if (key !== "imageDataUrl" && key !== "imageCanvas") assertBoundedJsonValue(child, `${context}.${key}`, 1)
  })
  return value as unknown as SerializedLayerSnapshot["frame"]
}

export function validateSmartSource(value: unknown, context: string): SerializedLayerSnapshot["smartSource"] {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`${context} must be an object.`)
  assertKnownKeys(value, SMART_SOURCE_KEYS, context)
  if (value.canvas !== undefined && value.canvas !== null) throw new Error(`${context}.canvas is not importable.`)
  assertImageDataUrl(value.canvasDataUrl, `${context}.canvasDataUrl`)
  return {
    ...value,
    width: assertCanvasDimension(value.width, `${context}.width`),
    height: assertCanvasDimension(value.height, `${context}.height`),
  } as SerializedLayerSnapshot["smartSource"]
}

export function validateLayer(value: unknown, context: string): SerializedLayerSnapshot {
  if (!isRecord(value)) throw new Error(`${context} must be an object.`)
  assertKnownKeys(value, LAYER_KEYS, context)
  assertImageDataUrl(value.canvasDataUrl, `${context}.canvasDataUrl`)
  assertImageDataUrl(value.maskDataUrl, `${context}.maskDataUrl`)
  assertStringArray(value.childIds, MAX_ACTION_ID_REFERENCES, `${context}.childIds`)

  const canvasPatches = optionalBoundedArray(value.canvasPatches, MAX_ACTION_CANVAS_PATCHES, `${context}.canvas patches`)
    ?.map((patch, index) => validateCanvasPatch(patch, `${context}.canvasPatches[${index}]`))
  const smartFilters = optionalBoundedArray(value.smartFilters, MAX_ACTION_SMART_FILTERS, `${context}.smart filters`)
    ?.map((filter, index) => validateSmartFilter(filter, `${context}.smartFilters[${index}]`))
  const frame = validateFrame(value.frame, `${context}.frame`)
  const smartSource = validateSmartSource(value.smartSource, `${context}.smartSource`)

  ;([
    "advancedBlending",
    "vectorMask",
    "style",
    "text",
    "shape",
    "path",
    "adjustment",
    "artboard",
    "threeD",
    "video",
    "notes",
    "metadata",
  ] as const).forEach((key) => {
    if (value[key] !== undefined) assertBoundedJsonValue(value[key], `${context}.${key}`)
  })

  return {
    ...value,
    ...(canvasPatches ? { canvasPatches } : {}),
    ...(smartFilters ? { smartFilters } : {}),
    ...(frame ? { frame } : {}),
    ...(smartSource ? { smartSource } : {}),
  } as SerializedLayerSnapshot
}

export function validateEntry(value: unknown, context: string): SerializedHistoryEntry {
  if (!isRecord(value)) throw new Error(`${context} must be an object.`)
  assertKnownKeys(value, HISTORY_ENTRY_KEYS, context)
  assertImageDataUrl(value.thumb, `${context}.thumb`)
  assertStringArray(value.selectedLayerIds, MAX_ACTION_ID_REFERENCES, `${context}.selectedLayerIds`)
  const layers = assertBoundedArray(value.layers, MAX_PROJECT_LAYERS, `${context}.layers`)
    .map((layer, index) => validateLayer(layer, `${context}.layers[${index}]`))

  Object.entries(value).forEach(([key, child]) => {
    if (!["layers", "thumb", "selectedLayerIds"].includes(key)) assertBoundedJsonValue(child, `${context}.${key}`)
  })

  return {
    ...value,
    layers,
  } as SerializedHistoryEntry
}

export function parseActionImportPayload(parsed: unknown): SerializedMacroAction[] {
  if (isRecord(parsed)) assertKnownKeys(parsed, ACTION_IMPORT_KEYS, "Action import payload")
  const serialized = Array.isArray(parsed) ? parsed : isRecord(parsed) ? parsed.actions : null
  if (!Array.isArray(serialized)) throw new Error("Action file does not contain an actions array.")
  if (serialized.length > MAX_IMPORTED_ACTIONS) throw new Error(`Action files are limited to ${MAX_IMPORTED_ACTIONS} actions.`)

  return serialized.map((action, actionIndex) => {
    if (!isRecord(action)) throw new Error(`Action ${actionIndex + 1} is not valid.`)
    assertKnownKeys(action, ACTION_KEYS, `Action ${actionIndex + 1}`)
    const rawSteps = Array.isArray(action.steps) ? action.steps : []
    if (rawSteps.length > MAX_ACTION_STEPS) throw new Error(`Actions are limited to ${MAX_ACTION_STEPS} steps.`)
    const steps = rawSteps.map((step, stepIndex) => {
      if (!isRecord(step) || !isRecord(step.entry) || !Array.isArray(step.entry.layers)) {
        throw new Error(`Step ${stepIndex + 1} in action ${actionIndex + 1} is not valid.`)
      }
      assertKnownKeys(step, STEP_KEYS, `Step ${stepIndex + 1} in action ${actionIndex + 1}`)
      return {
        ...step,
        id: uid("step"),
        label: cleanName(step.label, `Step ${stepIndex + 1}`),
        createdAt: typeof step.createdAt === "number" && Number.isFinite(step.createdAt) ? step.createdAt : Date.now(),
        entry: validateEntry(step.entry, `Step ${stepIndex + 1} entry`),
      }
    })

    const createdAt = typeof action.createdAt === "number" && Number.isFinite(action.createdAt) ? action.createdAt : Date.now()
    return {
      ...action,
      id: uid("action"),
      name: `${cleanName(action.name, "Imported Action")} (Imported)`,
      createdAt,
      updatedAt: Date.now(),
      steps,
    } as SerializedMacroAction
  })
}

export function omitFrameImageDataUrl(frame: NonNullable<SerializedLayerSnapshot["frame"]>) {
  const { imageDataUrl, imageCanvas, ...frameProps } = frame
  void imageDataUrl
  void imageCanvas
  return frameProps
}

export function canvasDataUrl(canvas?: HTMLCanvasElement | null) {
  if (!canvas || typeof canvas.toDataURL !== "function") return null
  return canvas.toDataURL("image/png")
}

export function serializeSmartFilter(filter: SmartFilter): SerializedSmartFilter {
  const { mask, ...rest } = filter
  return { ...rest, maskDataUrl: canvasDataUrl(mask) }
}

export function serializeSnapshot(snapshot: LayerSnapshot): SerializedLayerSnapshot {
  const { canvas, mask, canvasPatches, frame, smartFilters, smartSource, ...rest } = snapshot
  const serializedSmartSource = smartSource
    ? (() => {
        const { canvas: sourceCanvas, fileHandle: _fileHandle, ...sourceRest } = smartSource
        return {
          ...sourceRest,
          canvasDataUrl: canvasDataUrl(sourceCanvas),
          canvas: undefined,
        }
      })()
    : undefined
  return {
    ...rest,
    canvasDataUrl: canvasDataUrl(canvas),
    maskDataUrl: canvasDataUrl(mask),
    canvasPatches: canvasPatches?.map((patch) => ({
      ...patch,
      canvasDataUrl: canvasDataUrl(patch.canvas),
    })),
    frame: frame
      ? {
          ...frame,
          imageDataUrl: canvasDataUrl(frame.imageCanvas),
          imageCanvas: undefined,
        }
      : undefined,
    smartFilters: smartFilters?.map(serializeSmartFilter),
    smartSource: serializedSmartSource,
  }
}

export function serializeEntry(entry: HistoryEntry): SerializedHistoryEntry {
  return { ...entry, layers: entry.layers.map(serializeSnapshot) }
}

export function serializeAction(action: MacroAction): SerializedMacroAction {
  return {
    ...action,
    steps: action.steps.map((step) => ({ ...step, entry: serializeEntry(step.entry) })),
  }
}

export async function deserializeSmartFilter(filter: SerializedSmartFilter, width: number, height: number): Promise<SmartFilter> {
  const { maskDataUrl, ...rest } = filter
  return {
    ...rest,
    mask: maskDataUrl ? await canvasFromDataUrl(maskDataUrl, width, height) : undefined,
  }
}

export async function deserializeSnapshot(snapshot: SerializedLayerSnapshot, width: number, height: number): Promise<LayerSnapshot> {
  const { canvasDataUrl, maskDataUrl, canvasPatches, frame, smartFilters, smartSource, ...rest } = snapshot
  const smartSourceForSnapshot: LayerSnapshot["smartSource"] = smartSource
    ? (() => {
        const { canvasDataUrl: smartSourceDataUrl, ...sourceFields } = smartSource
        return {
          ...sourceFields,
          width: smartSource.width,
          height: smartSource.height,
          canvas: smartSourceDataUrl
            ? undefined
            : null,
        }
      })()
    : undefined
  if (smartSource && smartSourceForSnapshot) {
    const { canvasDataUrl: smartSourceDataUrl } = smartSource
    smartSourceForSnapshot.canvas = smartSourceDataUrl
      ? await canvasFromDataUrl(smartSourceDataUrl, smartSource.width, smartSource.height)
      : null
  }
  return {
    ...rest,
    canvas: canvasDataUrl ? await canvasFromDataUrl(canvasDataUrl, width, height) : null,
    mask: maskDataUrl ? await canvasFromDataUrl(maskDataUrl, width, height) : null,
    canvasPatches: canvasPatches
      ? await Promise.all(
          canvasPatches.map(async ({ canvasDataUrl: patchDataUrl, ...patch }) => ({
            ...patch,
            canvas: await canvasFromDataUrl(patchDataUrl, patch.w, patch.h),
          })),
        )
      : undefined,
    frame: frame
      ? {
          ...omitFrameImageDataUrl(frame),
          imageCanvas: frame.imageDataUrl ? await canvasFromDataUrl(frame.imageDataUrl, width, height) : null,
        }
      : undefined,
    smartFilters: smartFilters
      ? await Promise.all(smartFilters.map((filter) => deserializeSmartFilter(filter, width, height)))
      : undefined,
    smartSource: smartSourceForSnapshot,
  }
}

export async function deserializeEntry(entry: SerializedHistoryEntry, width: number, height: number): Promise<HistoryEntry> {
  return { ...entry, layers: await Promise.all(entry.layers.map((layer) => deserializeSnapshot(layer, width, height))) }
}

export async function deserializeAction(action: SerializedMacroAction, width: number, height: number): Promise<MacroAction> {
  return {
    ...action,
    steps: await Promise.all(
      action.steps.map(async (step) => ({ ...step, entry: await deserializeEntry(step.entry, width, height) })),
    ),
  }
}
