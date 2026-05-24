"use client"

import * as React from "react"
import { Circle, Copy, Download, Play, Plus, Square, Trash2, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { useEditor } from "../editor-context"
import { canvasFromDataUrl, downloadText } from "../document-io"
import { MAX_CANVAS_DIMENSION, MAX_PROJECT_LAYERS } from "../canvas-limits"
import { cn } from "@/lib/utils"
import type { CanvasPatch, HistoryEntry, LayerSnapshot, MacroAction, SmartFilter } from "../types"
import { uid } from "../uid"

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

const MAX_ACTION_IMPORT_BYTES = 12 * 1024 * 1024
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
const ACTION_KEYS = new Set(["id", "name", "createdAt", "updatedAt", "steps"])
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
const SMART_FILTER_KEYS = new Set(["id", "filterId", "name", "enabled", "opacity", "blendMode", "params", "maskDataUrl", "maskEnabled"])
const FRAME_KEYS = new Set(["shape", "x", "y", "w", "h", "imageDataUrl", "imageCanvas"])
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function cleanName(value: unknown, fallback: string) {
  return (typeof value === "string" ? value.trim().slice(0, 80) : "") || fallback
}

function isSafeImageDataUrl(value: string) {
  return (
    value.length <= MAX_ACTION_DATA_URL_LENGTH &&
    /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value)
  )
}

function assertKnownKeys(record: Record<string, unknown>, allowed: Set<string>, context: string) {
  const unknown = Object.keys(record).find((key) => !allowed.has(key))
  if (unknown) throw new Error(`${context} contains unknown field "${unknown}".`)
}

function assertImageDataUrl(value: unknown, context: string) {
  if (value === undefined || value === null || value === "") return
  if (typeof value !== "string" || !isSafeImageDataUrl(value)) {
    throw new Error(`Action file contains an unsafe or oversized image payload at ${context}.`)
  }
}

function assertBoundedArray(value: unknown, max: number, context: string) {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array.`)
  if (value.length > max) throw new Error(`${context} is limited to ${max} items.`)
  return value
}

function optionalBoundedArray(value: unknown, max: number, context: string) {
  if (value === undefined) return undefined
  return assertBoundedArray(value, max, context)
}

function assertFiniteNumber(value: unknown, context: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${context} must be a finite number.`)
  return value
}

function assertCanvasDimension(value: unknown, context: string) {
  const dimension = assertFiniteNumber(value, context)
  if (dimension < 1 || dimension > MAX_CANVAS_DIMENSION) {
    throw new Error(`${context} is limited to ${MAX_CANVAS_DIMENSION}px.`)
  }
  return dimension
}

function assertStringArray(value: unknown, max: number, context: string) {
  const items = optionalBoundedArray(value, max, context)
  if (!items) return
  items.forEach((item, index) => {
    if (typeof item !== "string" || item.length > MAX_ACTION_STRING_LENGTH) {
      throw new Error(`${context}[${index}] must be a bounded string.`)
    }
  })
}

function assertBoundedJsonValue(value: unknown, context: string, depth = 0) {
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

function validateCanvasPatch(value: unknown, context: string): SerializedCanvasPatch {
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

function validateSmartFilter(value: unknown, context: string): SerializedSmartFilter {
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

function validateFrame(value: unknown, context: string): SerializedLayerSnapshot["frame"] {
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

function validateSmartSource(value: unknown, context: string): SerializedLayerSnapshot["smartSource"] {
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

function validateLayer(value: unknown, context: string): SerializedLayerSnapshot {
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

function validateEntry(value: unknown, context: string): SerializedHistoryEntry {
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

function omitFrameImageDataUrl(frame: NonNullable<SerializedLayerSnapshot["frame"]>) {
  const { imageDataUrl, imageCanvas, ...frameProps } = frame
  void imageDataUrl
  void imageCanvas
  return frameProps
}

function canvasDataUrl(canvas?: HTMLCanvasElement | null) {
  if (!canvas || typeof canvas.toDataURL !== "function") return null
  return canvas.toDataURL("image/png")
}

function serializeSmartFilter(filter: SmartFilter): SerializedSmartFilter {
  const { mask, ...rest } = filter
  return { ...rest, maskDataUrl: canvasDataUrl(mask) }
}

function serializeSnapshot(snapshot: LayerSnapshot): SerializedLayerSnapshot {
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

function serializeEntry(entry: HistoryEntry): SerializedHistoryEntry {
  return { ...entry, layers: entry.layers.map(serializeSnapshot) }
}

function serializeAction(action: MacroAction): SerializedMacroAction {
  return {
    ...action,
    steps: action.steps.map((step) => ({ ...step, entry: serializeEntry(step.entry) })),
  }
}

async function deserializeSmartFilter(filter: SerializedSmartFilter, width: number, height: number): Promise<SmartFilter> {
  const { maskDataUrl, ...rest } = filter
  return {
    ...rest,
    mask: maskDataUrl ? await canvasFromDataUrl(maskDataUrl, width, height) : undefined,
  }
}

async function deserializeSnapshot(snapshot: SerializedLayerSnapshot, width: number, height: number): Promise<LayerSnapshot> {
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

async function deserializeEntry(entry: SerializedHistoryEntry, width: number, height: number): Promise<HistoryEntry> {
  return { ...entry, layers: await Promise.all(entry.layers.map((layer) => deserializeSnapshot(layer, width, height))) }
}

async function deserializeAction(action: SerializedMacroAction, width: number, height: number): Promise<MacroAction> {
  return {
    ...action,
    steps: await Promise.all(
      action.steps.map(async (step) => ({ ...step, entry: await deserializeEntry(step.entry, width, height) })),
    ),
  }
}

export function ActionsPanel() {
  const {
    actions,
    recordingActionId,
    isPlayingAction,
    activeDoc,
    dispatch,
    startRecordingAction,
    stopRecordingAction,
    playAction,
    deleteAction,
    clearAction,
  } = useEditor()
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [newActionName, setNewActionName] = React.useState("")
  const importRef = React.useRef<HTMLInputElement>(null)
  const selected = actions.find((action) => action.id === selectedId) ?? actions[0] ?? null

  React.useEffect(() => {
    if (!selectedId && actions[0]) setSelectedId(actions[0].id)
    if (selectedId && !actions.some((action) => action.id === selectedId)) {
      setSelectedId(actions[0]?.id ?? null)
    }
  }, [actions, selectedId])

  const addAction = () => {
    const createdAt = Date.now()
    const id = uid("action")
    const name = newActionName.trim() || `Action ${actions.length + 1}`
    dispatch({
      type: "add-action",
      action: {
        id,
        name,
        createdAt,
        updatedAt: createdAt,
        steps: [],
      },
    })
    setSelectedId(id)
    setNewActionName("")
  }

  const exportActions = (scope: "selected" | "all") => {
    const chosen = scope === "selected" && selected ? [selected] : actions
    if (!chosen.length) return
    downloadText(
      JSON.stringify(
        {
          app: "Photoshop Web",
          format: "psactions",
          version: 1,
          exportedAt: new Date().toISOString(),
          actions: chosen.map(serializeAction),
        },
        null,
        2,
      ),
      scope === "selected" && selected ? `${selected.name}.psactions.json` : "photoshop-actions.psactions.json",
    )
  }

  const importActions = async (file: File) => {
    if (!activeDoc) return
    try {
      if (file.size > MAX_ACTION_IMPORT_BYTES) throw new Error("Action files are limited to 12 MB.")
      const parsed = JSON.parse(await file.text())
      const serialized = parseActionImportPayload(parsed)
      const imported = await Promise.all(
        serialized.map((action) => deserializeAction(action, activeDoc.width, activeDoc.height)),
      )
      dispatch({ type: "set-actions", actions: [...actions, ...imported] })
      setSelectedId(imported[0]?.id ?? selectedId)
      toast.success(`${imported.length} action${imported.length === 1 ? "" : "s"} imported`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import actions")
    } finally {
      if (importRef.current) importRef.current.value = ""
    }
  }

  const duplicateSelectedAction = async () => {
    if (!selected || !activeDoc) return
    try {
      const serialized = serializeAction(selected)
      const duplicated = await deserializeAction(
        {
          ...serialized,
          id: uid("action"),
          name: `${selected.name} Copy`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          steps: serialized.steps.map((step, index) => ({
            ...step,
            id: uid("step"),
            label: step.label || `Step ${index + 1}`,
          })),
        },
        activeDoc.width,
        activeDoc.height,
      )
      dispatch({ type: "set-actions", actions: [duplicated, ...actions] })
      setSelectedId(duplicated.id)
      toast.success("Action duplicated")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not duplicate action")
    }
  }

  return (
    <div className="flex h-full flex-col text-[11px]">
      <input
        ref={importRef}
        type="file"
        aria-label="Import actions file"
        accept=".json,.psactions,.psactions.json,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file) void importActions(file)
        }}
      />
      <div className="grid grid-cols-[1fr_auto] gap-1 border-b border-[var(--ps-divider)] px-2 py-1">
        <input
          aria-label="New action name"
          value={newActionName}
          onChange={(event) => setNewActionName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") addAction()
          }}
          placeholder={`Action ${actions.length + 1}`}
          className="h-6 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] outline-none focus:border-[var(--ps-accent)]"
        />
        <button
          className="flex h-6 w-6 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)]"
          title="New action"
          onClick={addAction}
          aria-label="Create action"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-1 border-b border-[var(--ps-divider)] px-2 py-1">
        <button
          className="flex h-6 w-6 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
          title={recordingActionId ? "Stop recording" : "Record"}
          aria-label={recordingActionId ? "Stop recording action" : "Record action"}
          disabled={!selected}
          onClick={() =>
            recordingActionId ? stopRecordingAction() : selected && startRecordingAction(selected.id)
          }
        >
          {recordingActionId ? <Square className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5 fill-red-500 text-red-500" />}
        </button>
        <button
          className="flex h-6 w-6 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
          title="Play action"
          aria-label="Play action"
          disabled={!selected || !selected.steps.length || isPlayingAction}
          onClick={() => selected && playAction(selected.id)}
        >
          <Play className="h-3.5 w-3.5" />
        </button>
        <button
          className="flex h-6 w-6 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
          title="Duplicate action"
          aria-label="Duplicate action"
          disabled={!selected || !activeDoc}
          onClick={() => void duplicateSelectedAction()}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button
          className="flex h-6 w-6 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
          title="Import actions"
          aria-label="Import actions"
          onClick={() => importRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" />
        </button>
        <button
          className="flex h-6 w-6 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
          title="Export selected action"
          aria-label="Export selected action"
          disabled={!selected}
          onClick={() => exportActions("selected")}
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        <button
          className="flex h-6 px-1.5 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40 text-[10px]"
          title="Export all actions"
          aria-label="Export all actions"
          disabled={!actions.length}
          onClick={() => exportActions("all")}
        >
          All
        </button>
        <button
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
          title="Clear steps"
          aria-label="Clear action steps"
          disabled={!selected || !selected.steps.length}
          onClick={() => selected && clearAction(selected.id)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <button
          className="flex h-6 w-6 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
          title="Delete action"
          aria-label="Delete action"
          disabled={!selected}
          onClick={() => selected && deleteAction(selected.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-[90px] border-b border-[var(--ps-divider)]">
        {actions.length ? (
          actions.map((action) => {
            const selectedAction = action.id === selected?.id
            const recording = action.id === recordingActionId
            return (
              <button
                key={action.id}
                className={cn(
                  "flex w-full items-center gap-2 border-b border-[var(--ps-divider)]/40 px-2 py-1 text-left hover:bg-[var(--ps-tool-hover)]",
                  selectedAction && "bg-[var(--ps-tool-active)]",
                )}
                onClick={() => setSelectedId(action.id)}
              >
                <span className={cn("h-2 w-2 rounded-full", recording ? "bg-red-500" : "bg-[var(--ps-text-dim)]")} />
                <span className="min-w-0 flex-1 truncate">{action.name}</span>
                <span className="text-[10px] text-[var(--ps-text-dim)]">{action.steps.length}</span>
              </button>
            )
          })
        ) : (
          <div className="px-2 py-3 text-[var(--ps-text-dim)]">No recorded actions.</div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {selected ? (
          selected.steps.length ? (
            selected.steps.map((step, index) => (
              <div
                key={step.id}
                className="flex items-center gap-2 border-b border-[var(--ps-divider)]/40 px-2 py-1"
              >
                <span className="w-5 text-right text-[10px] text-[var(--ps-text-dim)]">{index + 1}</span>
                {step.entry.thumb ? (
                  <img src={step.entry.thumb} alt="" className="h-5 w-5 border border-[var(--ps-divider)] object-cover" />
                ) : (
                  <span className="h-5 w-5 border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]" />
                )}
                <span className="min-w-0 flex-1 truncate">{step.label}</span>
              </div>
            ))
          ) : (
            <div className="px-2 py-3 text-[var(--ps-text-dim)]">Press record and use the editor to capture steps.</div>
          )
        ) : null}
      </div>
    </div>
  )
}
