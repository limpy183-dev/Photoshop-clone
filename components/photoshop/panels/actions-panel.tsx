"use client"

import * as React from "react"
import { Circle, Copy, Download, Play, Plus, Square, Trash2, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { useEditor } from "../editor-context"
import { canvasFromDataUrl, downloadText } from "../document-io"
import { cn } from "@/lib/utils"
import type { CanvasPatch, HistoryEntry, LayerSnapshot, MacroAction, SmartFilter } from "../types"

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

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

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

function assertSafeActionDataUrls(value: unknown) {
  if (Array.isArray(value)) {
    value.forEach(assertSafeActionDataUrls)
    return
  }
  if (!isRecord(value)) return
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && key.toLowerCase().includes("dataurl") && child && !isSafeImageDataUrl(child)) {
      throw new Error("Action file contains an unsafe or oversized image payload.")
    }
    assertSafeActionDataUrls(child)
  }
}

function parseActionImportPayload(parsed: unknown): SerializedMacroAction[] {
  const serialized = Array.isArray(parsed) ? parsed : isRecord(parsed) ? parsed.actions : null
  if (!Array.isArray(serialized)) throw new Error("Action file does not contain an actions array.")
  if (serialized.length > MAX_IMPORTED_ACTIONS) throw new Error(`Action files are limited to ${MAX_IMPORTED_ACTIONS} actions.`)
  assertSafeActionDataUrls(serialized)

  return serialized.map((action, actionIndex) => {
    if (!isRecord(action)) throw new Error(`Action ${actionIndex + 1} is not valid.`)
    const rawSteps = Array.isArray(action.steps) ? action.steps : []
    if (rawSteps.length > MAX_ACTION_STEPS) throw new Error(`Actions are limited to ${MAX_ACTION_STEPS} steps.`)
    const steps = rawSteps.map((step, stepIndex) => {
      if (!isRecord(step) || !isRecord(step.entry) || !Array.isArray(step.entry.layers)) {
        throw new Error(`Step ${stepIndex + 1} in action ${actionIndex + 1} is not valid.`)
      }
      return {
        ...step,
        id: uid("step"),
        label: cleanName(step.label, `Step ${stepIndex + 1}`),
        createdAt: typeof step.createdAt === "number" && Number.isFinite(step.createdAt) ? step.createdAt : Date.now(),
        entry: step.entry,
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
    smartSource: smartSource
      ? {
          ...smartSource,
          canvasDataUrl: canvasDataUrl(smartSource.canvas),
          canvas: undefined,
        }
      : undefined,
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
    smartSource: smartSource
      ? {
          width: smartSource.width,
          height: smartSource.height,
          canvas: smartSource.canvasDataUrl
            ? await canvasFromDataUrl(smartSource.canvasDataUrl, smartSource.width, smartSource.height)
            : null,
        }
      : undefined,
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
