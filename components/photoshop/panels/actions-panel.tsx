"use client"
import {
  MAX_ACTION_IMPORT_BYTES,
  actionFolderGroups,
  actionHasPath,
  buildInsertPathStep,
  cleanFolderName,
  deserializeAction,
  isEmptyEnvelope,
  parseActionImportPayload,
  readPlaybackSpeed,
  serializeAction,
} from "@/editor/document/action-serialization"
import * as React from "react"
import {
  Circle,
  Copy,
  Download,
  Folder,
  GitBranch,
  Play,
  Plus,
  Route,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { toast } from "sonner"
import {
  makeHistoryEntry,
  useActiveDocument,
  useEditorCommands,
  useEditorSelector,
  useEditorStateSelector,
} from "@/components/photoshop/editor/context"
import { downloadText } from "@/editor/document/io"
import { cn } from "@/lib/utils"
import { CLIENT_STORAGE_KEYS, writeClientStorageString } from "@/editor/client-storage"
import type { MacroAction, MacroStep } from "@/editor/types"
import { uid } from "@/editor/uid"
import {
  loadActionEnvelopes,
  playbackSpeedToDelayMs,
  saveActionEnvelopes,
  setStepEnvelope,
  type ActionEnvelope,
  type ActionPlaybackSpeed,
  type ConditionAttribute,
  type StepEnvelope,
} from "@/editor/action-conditionals"
export { playbackSpeedToDelayMs }

const CONDITION_ATTRIBUTES: ConditionAttribute[] = [
  "layer.exists",
  "layer.visible",
  "layer.locked",
  "layer.hasMask",
  "layer.kind",
  "layer.opacityGte",
  "layer.opacityLte",
  "selection.empty",
  "selection.hasBounds",
  "selection.widthGte",
  "selection.heightGte",
  "channels.count",
  "document.colorMode",
  "document.bitDepth",
  "document.widthGte",
  "document.widthLte",
  "document.heightGte",
  "document.heightLte",
  "document.layerCountGte",
  "document.layerCountLte",
  "activeLayer.kind",
  "activeLayer.name",
  "activeLayer.visible",
]

export function ActionsPanel() {
  const actions = useEditorStateSelector((state) => state.actions)
  const recordingActionId = useEditorStateSelector((state) => state.recordingActionId)
  const isPlayingAction = useEditorStateSelector((state) => state.isPlayingAction)
  const activeDoc = useActiveDocument()
  const { dispatch } = useEditorCommands()
  const startRecordingAction = useEditorSelector((editor) => editor.startRecordingAction)
  const stopRecordingAction = useEditorSelector((editor) => editor.stopRecordingAction)
  const playAction = useEditorSelector((editor) => editor.playAction)
  const deleteAction = useEditorSelector((editor) => editor.deleteAction)
  const clearAction = useEditorSelector((editor) => editor.clearAction)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [newActionName, setNewActionName] = React.useState("")
  const [newActionFolder, setNewActionFolder] = React.useState("Default")
  const [folderFilter, setFolderFilter] = React.useState("All")
  const [playbackSpeed, setPlaybackSpeed] = React.useState<ActionPlaybackSpeed>(readPlaybackSpeed)
  const [envelopes, setEnvelopes] = React.useState<Record<string, ActionEnvelope>>(() => loadActionEnvelopes())
  const importRef = React.useRef<HTMLInputElement>(null)
  const selected = actions.find((action) => action.id === selectedId) ?? actions[0] ?? null
  const folderGroups = actionFolderGroups(actions)
  const visibleActions = folderFilter === "All"
    ? actions
    : actions.filter((action) => cleanFolderName(action.folder) === folderFilter)

  React.useEffect(() => {
    if (!selectedId && actions[0]) setSelectedId(actions[0].id)
    if (selectedId && !actions.some((action) => action.id === selectedId)) {
      setSelectedId(actions[0]?.id ?? null)
    }
  }, [actions, selectedId])

  React.useEffect(() => {
    writeClientStorageString(CLIENT_STORAGE_KEYS.actionPlaybackSpeed, playbackSpeed)
  }, [playbackSpeed])

  React.useEffect(() => {
    setEnvelopes(loadActionEnvelopes())
  }, [actions.length])

  const addAction = () => {
    const createdAt = Date.now()
    const id = uid("action")
    const name = newActionName.trim() || `Action ${actions.length + 1}`
    dispatch({
      type: "add-action",
      action: {
        id,
        name,
        folder: cleanFolderName(newActionFolder),
        createdAt,
        updatedAt: createdAt,
        steps: [],
      },
    })
    setSelectedId(id)
    setNewActionName("")
  }

  const updateSelectedAction = (patch: Partial<MacroAction>) => {
    if (!selected) return
    dispatch({
      type: "set-actions",
      actions: actions.map((action) => action.id === selected.id ? { ...action, ...patch, updatedAt: Date.now() } : action),
    })
  }

  const insertPathStep = () => {
    if (!selected || !activeDoc) return
    const entry = makeHistoryEntry(activeDoc, "Insert Path", undefined, "all")
    if (!actionHasPath(entry)) {
      toast.error("The current document does not contain an editable path or shape.")
      return
    }
    dispatch({ type: "append-action-step", actionId: selected.id, step: buildInsertPathStep(entry) })
    toast.success("Inserted current path state into the action.")
  }

  const updateEnvelope = (actionId: string, stepId: string, updater: (current: StepEnvelope) => StepEnvelope) => {
    const current = envelopes[actionId]?.steps[stepId] ?? {}
    const nextEnv = updater(current)
    const next = setStepEnvelope(envelopes, actionId, stepId, isEmptyEnvelope(nextEnv) ? null : nextEnv)
    setEnvelopes(next)
    saveActionEnvelopes(next)
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
      <div className="grid grid-cols-[1fr_96px_auto] gap-1 border-b border-[var(--ps-divider)] px-2 py-1">
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
        <input
          aria-label="New action folder"
          value={newActionFolder}
          onChange={(event) => setNewActionFolder(event.target.value)}
          placeholder="Set"
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
      <div className="grid grid-cols-[1fr_1fr] gap-1 border-b border-[var(--ps-divider)] px-2 py-1">
        <label className="grid gap-0.5 text-[10px] text-[var(--ps-text-dim)]">
          Action Set
          <select
            aria-label="Action set folder filter"
            value={folderFilter}
            onChange={(event) => setFolderFilter(event.target.value)}
            className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px] text-[var(--ps-text)]"
          >
            <option value="All">All sets</option>
            {folderGroups.map((group) => <option key={group.name} value={group.name}>{group.name}</option>)}
          </select>
        </label>
        <label className="grid gap-0.5 text-[10px] text-[var(--ps-text-dim)]">
          Playback
          <select
            aria-label="Action playback speed"
            value={playbackSpeed}
            onChange={(event) => setPlaybackSpeed(event.target.value as ActionPlaybackSpeed)}
            className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px] text-[var(--ps-text)]"
          >
            <option value="instant">Instant</option>
            <option value="fast">Fast</option>
            <option value="normal">Normal</option>
            <option value="slow">Slow</option>
          </select>
        </label>
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
          title="Insert current path"
          aria-label="Insert current path in action"
          disabled={!selected || !activeDoc}
          onClick={insertPathStep}
        >
          <Route className="h-3.5 w-3.5" />
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
        {visibleActions.length ? (
          visibleActions.map((action) => {
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
                <span className="hidden max-w-[92px] truncate rounded-sm border border-[var(--ps-divider)] px-1 text-[9px] text-[var(--ps-text-dim)] sm:inline">
                  {cleanFolderName(action.folder)}
                </span>
                <span className="text-[10px] text-[var(--ps-text-dim)]">{action.steps.length}</span>
              </button>
            )
          })
        ) : (
          <div className="px-2 py-3 text-[var(--ps-text-dim)]">No recorded actions in this set.</div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <>
            <div className="grid grid-cols-[1fr_120px] gap-1 border-b border-[var(--ps-divider)] px-2 py-1">
              <input
                aria-label="Selected action name"
                value={selected.name}
                onChange={(event) => updateSelectedAction({ name: event.target.value })}
                className="h-6 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] outline-none focus:border-[var(--ps-accent)]"
              />
              <label className="relative">
                <Folder className="pointer-events-none absolute left-1.5 top-1.5 h-3 w-3 text-[var(--ps-text-dim)]" />
                <input
                  aria-label="Selected action folder"
                  value={cleanFolderName(selected.folder)}
                  onChange={(event) => updateSelectedAction({ folder: event.target.value })}
                  className="h-6 w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] pl-5 pr-1 text-[10px] outline-none focus:border-[var(--ps-accent)]"
                />
              </label>
            </div>
            {selected.steps.length ? (
              selected.steps.map((step, index) => (
                <ActionStepRow
                  key={step.id}
                  actionId={selected.id}
                  step={step}
                  index={index}
                  envelope={envelopes[selected.id]?.steps[step.id]}
                  onEnvelopeChange={updateEnvelope}
                />
              ))
            ) : (
              <div className="px-2 py-3 text-[var(--ps-text-dim)]">Press record and use the editor to capture steps.</div>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}

function ActionStepRow({
  actionId,
  step,
  index,
  envelope,
  onEnvelopeChange,
}: {
  actionId: string
  step: MacroStep
  index: number
  envelope: StepEnvelope | undefined
  onEnvelopeChange: (actionId: string, stepId: string, updater: (current: StepEnvelope) => StepEnvelope) => void
}) {
  const condition = envelope?.condition
  const update = (updater: (current: StepEnvelope) => StepEnvelope) => onEnvelopeChange(actionId, step.id, updater)
  return (
    <div className="border-b border-[var(--ps-divider)]/40 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="w-5 text-right text-[10px] text-[var(--ps-text-dim)]">{index + 1}</span>
        {step.entry.thumb ? (
          <img src={step.entry.thumb} alt="" className="h-5 w-5 border border-[var(--ps-divider)] object-cover" />
        ) : (
          <span className="h-5 w-5 border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]" />
        )}
        <span className="min-w-0 flex-1 truncate">{step.label}</span>
        {condition ? <GitBranch className="h-3.5 w-3.5 text-[var(--ps-accent)]" /> : null}
      </div>
      <div className="mt-1 grid grid-cols-[1fr_72px_72px] gap-1">
        <select
          aria-label={`Condition for ${step.label}`}
          value={condition?.attribute ?? ""}
          onChange={(event) => {
            const attribute = event.target.value as ConditionAttribute | ""
            update((current) => ({
              ...current,
              condition: attribute
                ? { attribute, value: current.condition?.value, layerKey: current.condition?.layerKey, onFail: current.condition?.onFail ?? "skip", jumpToStepId: current.condition?.jumpToStepId }
                : undefined,
            }))
          }}
          className="h-6 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
        >
          <option value="">Always run</option>
          {CONDITION_ATTRIBUTES.map((attribute) => <option key={attribute} value={attribute}>{attribute}</option>)}
        </select>
        <select
          aria-label={`Condition failure action for ${step.label}`}
          disabled={!condition}
          value={condition?.onFail ?? "skip"}
          onChange={(event) => update((current) => ({
            ...current,
            condition: current.condition ? { ...current.condition, onFail: event.target.value as "skip" | "abort" | "continue" | "jump" } : undefined,
          }))}
          className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px] disabled:opacity-45"
        >
          <option value="skip">Skip</option>
          <option value="abort">Abort</option>
          <option value="continue">Else run</option>
          <option value="jump">Jump</option>
        </select>
        <input
          aria-label={`Condition value for ${step.label}`}
          disabled={!condition}
          value={condition?.value === undefined ? "" : String(condition.value)}
          onChange={(event) => update((current) => ({
            ...current,
            condition: current.condition ? { ...current.condition, value: parseConditionValue(event.target.value) } : undefined,
          }))}
          placeholder="Value"
          className="h-6 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px] disabled:opacity-45"
        />
      </div>
      <div className="mt-1 grid grid-cols-[1fr_1fr] gap-1">
        <input
          aria-label={`Condition layer target for ${step.label}`}
          disabled={!condition}
          value={condition?.layerKey ?? ""}
          onChange={(event) => update((current) => ({
            ...current,
            condition: current.condition ? { ...current.condition, layerKey: event.target.value.trim() || undefined } : undefined,
          }))}
          placeholder="Layer/id"
          className="h-6 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px] disabled:opacity-45"
        />
        <input
          aria-label={`Condition jump target for ${step.label}`}
          disabled={!condition || condition.onFail !== "jump"}
          value={condition?.jumpToStepId ?? ""}
          onChange={(event) => update((current) => ({
            ...current,
            condition: current.condition ? { ...current.condition, jumpToStepId: event.target.value.trim() || undefined } : undefined,
          }))}
          placeholder="Jump step"
          className="h-6 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px] disabled:opacity-45"
        />
      </div>
      <div className="mt-1 grid grid-cols-[80px_72px_80px] gap-1">
        <select
          aria-label={`Step error policy for ${step.label}`}
          value={envelope?.onError ?? "skip"}
          onChange={(event) => update((current) => ({ ...current, onError: event.target.value as StepEnvelope["onError"] }))}
          className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
        >
          <option value="skip">Err skip</option>
          <option value="abort">Err abort</option>
          <option value="retry">Retry</option>
        </select>
        <input
          aria-label={`Step retry limit for ${step.label}`}
          type="number"
          min={0}
          max={10}
          value={envelope?.retryLimit ?? 0}
          onChange={(event) => update((current) => ({ ...current, retryLimit: Math.max(0, Math.min(10, Math.round(Number(event.target.value) || 0))) }))}
          className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
        />
        <input
          aria-label={`Step pause for ${step.label}`}
          type="number"
          min={0}
          max={60000}
          value={envelope?.pauseMs ?? 0}
          onChange={(event) => update((current) => ({ ...current, pauseMs: Math.max(0, Math.min(60000, Number(event.target.value) || 0)) }))}
          className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
        />
      </div>
      <div className="mt-1 grid grid-cols-[auto_1fr] items-center gap-1">
        <label className="flex items-center gap-1 text-[10px] text-[var(--ps-text-dim)]">
          <input
            type="checkbox"
            checked={envelope?.breakpoint ?? false}
            onChange={(event) => update((current) => ({ ...current, breakpoint: event.target.checked }))}
          />
          Break
        </label>
        <input
          aria-label={`Step playback note for ${step.label}`}
          value={envelope?.note ?? ""}
          onChange={(event) => update((current) => ({ ...current, note: event.target.value.slice(0, 200) || undefined }))}
          placeholder="If / then / else note"
          className="h-6 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
        />
      </div>
    </div>
  )
}

function parseConditionValue(value: string) {
  const text = value.trim()
  if (!text) return undefined
  if (text === "true") return true
  if (text === "false") return false
  const number = Number(text)
  return Number.isFinite(number) && text !== "" ? number : text
}
