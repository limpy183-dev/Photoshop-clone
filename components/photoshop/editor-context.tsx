"use client"

import * as React from "react"
import {
loadActionEnvelopes,
playAction as playActionWithConditions,
readPlaybackSpeedDelayMs,
} from "./action-conditionals"
import { makeCanvas } from "./canvas-utils"
import { EditorCloseDialog } from "./editor-close-dialog"
import {
alphaBounds,
cloneCanvas,
duplicateDocumentDeep
} from "./editor-document-cloning"
import {
currentHistoryIndexFromHistories,
dirtyDocIdsForAction,
documentLifecycleForSlices,
isDocumentDirtyInState
} from "./editor-document-lifecycle"
import {
commitAffectsComposite,
renderChangeForChangedLayerIds,
type ChangedLayerIds
} from "./editor-history-geometry"
import {
estimateClipboardPurgeBytes,
estimateHistoriesPurgeBytes,
estimateUndoPurgeBytes,
estimateVideoCachePurgeBytes,
isCompressedCanvas,
prepareEntryForRestore,
purgeFilterPreviewCache
} from "./editor-history-storage"
import {
filterPersistedEditorSettingsForHydration,
loadPersistedEditorSettings,
savePersistedEditorSettings,
} from "./editor-persisted-settings"
import { projectEditorContextValue } from "./editor-context-projection"
import { selectActiveDocument,selectActiveLayer,selectSelectedLayers } from "./editor-selectors"
import {
  createEditorStore,
  createVersionedSelectionCache,
  selectWithVersionedCache,
  type EditorStore,
} from "./editor-store"
import { addPhotoshopEventListener,dispatchPhotoshopEvent } from "./events"
import { createHistoryJumpScheduler,type HistoryJumpScheduler } from "./history-jump-scheduler"
import { recordHistoryLogEntryFromStorage } from "./preferences-engine"
import { purgePsbTileViewCaches } from "./psb-tile-view"
import {
planPurgeTargets,
type PurgeResult,
type PurgeTarget,
} from "./purge-commands"
import { RenderBus,type MergedRenderChange,type RenderChange } from "./render-bus"
import {
maskBounds,
selectionToMaskCanvas
} from "./tool-helpers"
import type {
HistoryEntry,
Layer,
LayerKind,
PsDocument
} from "./types"
import { uid } from "./uid"

/* ----------------------------- helpers --------------------------------- */

import {
EMPTY_HISTORY,
EMPTY_SNAPSHOTS,
makeHistoryEntry,
renderSmartObjectDocument,
restoreFromEntry
} from "./editor-history-state"
import {
changedLayerIdsForHistoryLog,
clamp,
HIGH_FREQUENCY_ACTION_TYPES,
HISTORY_CONTEXT_INVALIDATING_ACTION_TYPES,
makeDocument,
runEditorTransitionEffects,
toolSettingsForHistoryLog,
transitionEditorState,
type Action,
type DocumentLifecycleState,
type EditorState,
type EditorTransitionEffect
} from "./editor-reducer"

export type { EditorCommands } from "./editor-context-contract"
export * from "./editor-reducer"

import type { EditorCommands,EditorContextValue,EditorRenderContextValue } from "./editor-context-contract"

const EditorContext = React.createContext<EditorContextValue | null>(null)
const EditorRenderContext = React.createContext<EditorRenderContextValue | null>(null)
const EditorCommandContext = React.createContext<EditorCommands | null>(null)
const EditorStateStoreContext = React.createContext<EditorStore<EditorState> | null>(null)
const EditorValueRefContext = React.createContext<{ current: EditorContextValue } | null>(null)

import { initialState } from "./editor-initial-state"

function persistedEditorDefaults() {
  return {
    brush: initialState.brush,
    gradient: initialState.gradient,
    symmetry: initialState.symmetry,
  }
}

export function filterPersistedSettingsForHydration(value: unknown): Partial<EditorState> {
  return filterPersistedEditorSettingsForHydration(value, persistedEditorDefaults()) as Partial<EditorState>
}

function loadPersistedSettings(): Partial<EditorState> {
  return loadPersistedEditorSettings(persistedEditorDefaults()) as Partial<EditorState>
}

function savePersistedSettings(state: EditorState) {
  savePersistedEditorSettings(state)
}

export function EditorProvider({ children }: { children: React.ReactNode }) {
  const stateStoreRef = React.useRef<EditorStore<EditorState> | null>(null)
  if (!stateStoreRef.current) stateStoreRef.current = createEditorStore(initialState)
  const stateStore = stateStoreRef.current
  const state = React.useSyncExternalStore(
    stateStore.subscribe,
    stateStore.getSnapshot,
    stateStore.getSnapshot,
  )
  const stateRef = React.useRef(state)
  stateRef.current = state
  const historyJumpSchedulerRef = React.useRef<HistoryJumpScheduler | null>(null)
  const performHistoryJumpRef = React.useRef<(index: number) => void>(() => {})
  // Reducer snapshots are published synchronously for consistency. Selected
  // UI projections may coalesce their notification to the next animation
  // frame; external-store updates cannot rely on startTransition semantics.
  const dispatch = React.useCallback((action: Action) => {
    const before = stateRef.current
    // Run the reducer once, here, so stateRef is always current immediately
    // after dispatch returns. This is critical for correctness of code that
    // reads `stateRef.current` between renders (e.g. the next commit() in a
    // rapid stroke sequence, or keyboard handlers that consult history
    // bounds via the context's stepHistoryBy callback). Without this, a
    // deferred React render would leave stateRef stale and re-introduce the
    // race where Ctrl+Z jumps further than expected.
    const effects: EditorTransitionEffect[] = []
    let transition = transitionEditorState(before, action)
    let next = transition.state
    effects.push(...transition.effects)
    const dirtyDocs = dirtyDocIdsForAction(action, before, next)
    for (const docId of dirtyDocs) {
      transition = transitionEditorState(next, { type: "mark-document-dirty", id: docId })
      next = transition.state
      effects.push(...transition.effects)
    }
    stateRef.current = next
    stateStore.setSnapshot(next, { notify: false })
    runEditorTransitionEffects(effects)
    if (HISTORY_CONTEXT_INVALIDATING_ACTION_TYPES.has(action.type)) {
      // A new branch, floor, snapshot restore, or active timeline invalidates
      // any pending undo/redo target left by an earlier step.
      historyJumpSchedulerRef.current?.cancel()
    }

    // Coalesce nonessential React projections to one notification per frame.
    // The snapshot itself is already current, so commands and the render bus
    // remain immediately consistent.
    const isHighFrequency = HIGH_FREQUENCY_ACTION_TYPES.has(action.type)
    if (isHighFrequency) {
      stateStore.scheduleNotify()
    } else {
      stateStore.notify()
    }
  }, [stateStore])

  React.useEffect(() => {
    const persisted = loadPersistedSettings()
    if (Object.keys(persisted).length) dispatch({ type: "hydrate-settings", settings: persisted })
  }, [dispatch])

  // Auto-save settings to localStorage (debounced)
  React.useEffect(() => {
    const t = window.setTimeout(() => savePersistedSettings(stateRef.current), 300)
    return () => window.clearTimeout(t)
  }, [state.tool, state.foreground, state.background, state.brush, state.gradient, state.symmetry])

  const renderBusRef = React.useRef<RenderBus | null>(null)
  if (renderBusRef.current === null) renderBusRef.current = new RenderBus()
  const requestRender = React.useCallback((change?: RenderChange) => renderBusRef.current!.requestRender(change), [])
  const subscribeRender = React.useCallback(
    (cb: (change: MergedRenderChange) => void) => renderBusRef.current!.subscribe(cb),
    [],
  )
  const renderContextValue = React.useMemo(
    () => ({ requestRender, subscribeRender }),
    [requestRender, subscribeRender],
  )

  React.useEffect(() => {
    const scheduler = createHistoryJumpScheduler((index) => performHistoryJumpRef.current(index))
    historyJumpSchedulerRef.current = scheduler
    return () => {
      scheduler.cancel()
      if (historyJumpSchedulerRef.current === scheduler) historyJumpSchedulerRef.current = null
    }
  }, [])
  const [closeRequest, setCloseRequest] = React.useState<{ ids: string[]; currentId: string; saving?: boolean } | null>(null)
  const closeRequestRef = React.useRef(closeRequest)
  closeRequestRef.current = closeRequest

  const closeIdsNow = React.useCallback((ids: string[]) => {
    const unique = Array.from(new Set(ids)).filter((id) => stateRef.current.documents.some((doc) => doc.id === id))
    // Use the wrapped `dispatch` (not raw) so each close-document
    // synchronously updates `stateRef.current`. Otherwise callers that
    // immediately read `stateRef.current.documents` after closeIdsNow
    // (e.g. requestCloseDocuments below) see stale state.
    for (const id of unique) dispatch({ type: "close-document", id })
    if (unique.length) requestRender()
  }, [dispatch, requestRender])

  const requestCloseDocuments = React.useCallback((ids: string[]) => {
    const unique = Array.from(new Set(ids)).filter((id) => stateRef.current.documents.some((doc) => doc.id === id))
    if (!unique.length) return
    const dirtyId = unique.find((id) => isDocumentDirtyInState(stateRef.current, id))
    if (!dirtyId) {
      closeIdsNow(unique)
      return
    }
    setCloseRequest({ ids: unique, currentId: dirtyId })
  }, [closeIdsNow])

  const finishPendingClose = React.useCallback((docId: string, closeDocument: boolean) => {
    const request = closeRequestRef.current
    if (!request) return
    if (closeDocument) dispatch({ type: "close-document", id: docId })
    const remaining = request.ids.filter((id) => id !== docId && stateRef.current.documents.some((doc) => doc.id === id))
    const dirtyId = remaining.find((id) => isDocumentDirtyInState(stateRef.current, id))
    if (dirtyId) {
      setCloseRequest({ ids: remaining, currentId: dirtyId })
    } else {
      for (const id of remaining) dispatch({ type: "close-document", id })
      setCloseRequest(null)
    }
    requestRender()
  }, [dispatch, requestRender])

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ docId?: string; success?: boolean }>).detail
      const request = closeRequestRef.current
      if (!request || !detail?.docId || detail.docId !== request.currentId) return
      if (detail.success) {
        finishPendingClose(detail.docId, true)
      } else {
        setCloseRequest((current) => current ? { ...current, saving: false } : current)
      }
    }
    return addPhotoshopEventListener("ps-document-saved", (_detail, event) => handler(event))
  }, [finishPendingClose])

  React.useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!stateRef.current.documents.some((doc) => isDocumentDirtyInState(stateRef.current, doc.id))) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [])

  const activeDoc = React.useMemo(
    () => selectActiveDocument({ documents: state.documents, activeDocId: state.activeDocId }),
    [state.documents, state.activeDocId],
  )
  const activeLayer = React.useMemo(
    () => selectActiveLayer(activeDoc),
    [activeDoc],
  )
  const selectedLayers = React.useMemo(() => selectSelectedLayers(activeDoc), [activeDoc])

  // Stable fallbacks: avoid allocating a fresh empty history/snapshot on
  // every render, which would otherwise invalidate the context value's
  // useMemo identity and force ~100 panels/dialogs to re-render.
  const docHistory = activeDoc
    ? state.histories[activeDoc.id] ?? EMPTY_HISTORY
    : EMPTY_HISTORY
  const docSnapshots = activeDoc
    ? state.snapshots[activeDoc.id] ?? EMPTY_SNAPSHOTS
    : EMPTY_SNAPSHOTS
  const documentStatuses = React.useMemo(() => {
    const result: Record<string, DocumentLifecycleState> = {}
    for (const doc of state.documents) {
      const lifecycle = documentLifecycleForSlices(state.documentLifecycle, state.histories, doc)
      result[doc.id] = {
        ...lifecycle,
        dirty: lifecycle.dirty || lifecycle.savedHistoryIndex !== currentHistoryIndexFromHistories(state.histories, doc.id),
      }
    }
    return result
    // documentStatuses only depends on the document list, per-doc lifecycle
    // state, and per-doc history. Depending on the entire `state` here
    // re-ran this memo on every slider tick — narrow the dep list to the
    // slices that actually affect the output.
  }, [state.documents, state.documentLifecycle, state.histories])
  const documentHistoryVersions = React.useMemo(() => {
    const result: Record<string, number> = {}
    for (const doc of state.documents) result[doc.id] = currentHistoryIndexFromHistories(state.histories, doc.id)
    return result
  }, [state.documents, state.histories])

  // Initialize SSR-safe canvases on the client.
  //
  // The reducer's initialState was constructed at module load — possibly
  // during SSR with placeholder canvases that have no real 2d context. The
  // initial history entry built from that state references those
  // placeholders and, if used to restore, would erase pixels (e.g. the
  // document's default white background) because nothing real can be drawn
  // from a stub canvas.
  //
  // To guarantee that undo can never go past the moment the canvas was
  // joined/opened, we replace any stub canvases on the active document with
  // real ones, then reset the floor history entry IF AND ONLY IF the existing
  // floor entry references stale canvases. This makes the effect idempotent
  // on re-mount (e.g. React Strict Mode in dev, or HMR), so it never clobbers
  // legitimate history that the user has built up.
  React.useEffect(() => {
    let canvasesReplaced = false
    state.documents.forEach((d, di) => {
      d.layers.forEach((l, li) => {
        if (!l.canvas || typeof (l.canvas as HTMLCanvasElement).getContext !== "function") {
          const c = document.createElement("canvas")
          c.width = d.width
          c.height = d.height
          if (di === 0 && li === 0) {
            const ctx = c.getContext("2d")!
            ctx.fillStyle = d.background
            ctx.fillRect(0, 0, d.width, d.height)
          }
          l.canvas = c
          canvasesReplaced = true
        }
      })
    })

    const did = state.activeDocId
    if (did) {
      const doc = state.documents.find((x) => x.id === did)
      const docHistory = state.histories[did]
      const floorEntry = docHistory?.entries[0]
      const floorIsStale =
        !floorEntry ||
        floorEntry.layers.some(
          (snap) =>
            !snap.canvas || typeof (snap.canvas as HTMLCanvasElement).getContext !== "function",
        )
      if (doc && (canvasesReplaced || floorIsStale)) {
        dispatch({
          type: "reset-history",
          docId: did,
          entry: makeHistoryEntry(doc, "New Document"),
        })
      }
    }
    if (canvasesReplaced) requestRender()
    // One-time persisted document hydration; dispatch and requestRender are stable provider callbacks during mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filterPreviewsRef = React.useRef<Record<string, HTMLCanvasElement>>({})
  const setFilterPreview = React.useCallback((layerId: string, canvas: HTMLCanvasElement | null) => {
    if (canvas) {
      filterPreviewsRef.current[layerId] = canvas
    } else {
      delete filterPreviewsRef.current[layerId]
    }
    requestRender({ layerIds: [layerId], reason: "filter-preview" })
  }, [requestRender])

  const commit = React.useCallback(
    (label: string, changedLayerIds?: ChangedLayerIds) => {
      const current = stateRef.current
      const doc = current.documents.find((d) => d.id === current.activeDocId) ?? null
      if (!doc) return
      const docHistory = current.histories[doc.id]
      const previousEntry = docHistory?.entries[docHistory.index]

      // Build the history entry synchronously off the live canvases. For the
      // common brush-stroke case (a small dirty rect on a layer that already
      // shares a canvas reference with the previous entry), snapshotLayers
      // takes the patch path and only clones the small dirty region — full
      // canvas clones happen only when patching is impossible (rare; e.g. the
      // very first commit on a layer or a large/unbounded change).
      //
      // Since this all runs inside the same synchronous turn as the caller
      // (typically the pointer-up handler), the live canvas pixels cannot be
      // mutated between snapshotting them and dispatching, so we don't need
      // the previous async pre-capture indirection.
      const entry = makeHistoryEntry(doc, label, previousEntry, changedLayerIds)

      // Push the entry synchronously so undo correctness is immediate: every
      // stroke results in its own entry before any subsequent input can run.
      // We deliberately do NOT wrap this in React.startTransition — doing so
      // would defer the state update past the next keyboard event, leaving
      // stateRef.current stale and reintroducing the "Ctrl+Z removes multiple
      // strokes" race the sync push is meant to fix.
      dispatch({ type: "push-history", entry })
      const finalState = stateRef.current
      if (finalState.recordingActionId && !finalState.isPlayingAction) {
        dispatch({
          type: "append-action-step",
          actionId: finalState.recordingActionId,
          step: { id: uid("step"), label, createdAt: Date.now(), entry },
        })
      }

      // Defer the localStorage write — it touches synchronous storage I/O and
      // is purely observational (history log panel). Doing it on idle keeps
      // the pointer-up handler snappy.
      const writeLog = () => {
        try {
          recordHistoryLogEntryFromStorage(label, {
            documentName: doc.name,
            tool: current.tool,
            changedLayerIds: changedLayerIdsForHistoryLog(changedLayerIds),
            toolSettings: toolSettingsForHistoryLog(current),
          })
        } catch {}
      }
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(writeLog)
      } else {
        setTimeout(writeLog, 0)
      }

      if (commitAffectsComposite(doc, changedLayerIds)) requestRender(renderChangeForChangedLayerIds(changedLayerIds))
    },
    [dispatch, requestRender],
  )

  const performHistoryJump = React.useCallback(
    (index: number) => {
      const current = stateRef.current
      const doc = current.documents.find((d) => d.id === current.activeDocId)
      if (!doc) return
      const docHist = current.histories[doc.id]
      if (!docHist) return
      const safeIdx = clamp(index, 0, docHist.entries.length - 1)
      const entry = docHist.entries[safeIdx]
      const direction = safeIdx < docHist.index ? "undo" : safeIdx > docHist.index ? "redo" : null
      const docId = doc.id

      const apply = () => {
        // Re-derive from live state: decompression is async, so the user may
        // have switched documents (or history may have moved) in the meantime.
        // Restoring into a stale doc would paint another document's layers.
        const now = stateRef.current
        if (now.activeDocId !== docId) return
        const liveDoc = now.documents.find((d) => d.id === docId)
        const liveHist = now.histories[docId]
        if (!liveDoc || !liveHist || liveHist.entries[safeIdx] !== entry) return
        const restoredLayers = restoreFromEntry(liveDoc, entry, {
          currentEntry: liveHist.entries[liveHist.index],
          direction,
        })
        dispatch({
          type: "restore-history",
          index: safeIdx,
          entry,
          restoredLayers,
          activeLayerId: entry.activeLayerId,
          selectedLayerIds: entry.selectedLayerIds,
        })
        requestRender()
      }

      // If this entry has any compressed-placeholder layer canvases (because
      // it scrolled past `COMPRESS_AFTER_N` while sitting in history),
      // decode them back to real pixels before applying. Without this,
      // restoreFromEntry would either draw a 1×1 garbage canvas onto the
      // layer (silent data loss) or hit the placeholder guard and skip the
      // paint entirely (visual no-op for that step's pixel changes).
      const needsDecompress = entry.layers.some(
        (layerSnap) => layerSnap.canvas && isCompressedCanvas(layerSnap.canvas),
      )
      if (needsDecompress) {
        prepareEntryForRestore(entry).then(apply, apply)
      } else {
        apply()
      }
    },
    [dispatch, requestRender],
  )
  performHistoryJumpRef.current = performHistoryJump

  const jumpHistory = React.useCallback((index: number) => {
    const current = stateRef.current
    const doc = current.documents.find((d) => d.id === current.activeDocId)
    const docHist = doc ? current.histories[doc.id] : null
    if (!docHist) {
      performHistoryJump(index)
      return
    }
    const safeIdx = clamp(index, 0, docHist.entries.length - 1)
    const delta = safeIdx - docHist.index
    const scheduler = historyJumpSchedulerRef.current
    if (!scheduler) {
      performHistoryJump(safeIdx)
      return
    }
    if (Math.abs(delta) === 1) {
      scheduler.requestStep(docHist.index, delta, 0, docHist.entries.length - 1)
    } else {
      scheduler.request(safeIdx)
    }
  }, [performHistoryJump])

  // stepHistoryBy reads the current document's history bounds from stateRef
  // rather than from context-closure values. This guarantees the keyboard
  // handler sees the LATEST history index even when the most recent
  // push-history notification may be frame-coalesced (so the React
  // re-render hasn't committed yet and context historyIndex still
  // shows the older value). Critical for "Ctrl+Z right after a stroke"
  // never-jumps-too-far correctness.
  const stepHistoryBy = React.useCallback((delta: number): boolean => {
    if (!delta) return false
    const current = stateRef.current
    const doc = current.documents.find((d) => d.id === current.activeDocId)
    const docHist = doc ? current.histories[doc.id] : null
    if (!docHist) return false
    const target = docHist.index + delta
    if (target < 0 || target > docHist.entries.length - 1) return false
    jumpHistory(target)
    return true
  }, [jumpHistory])

  const createHistorySnapshot = React.useCallback(
    (name?: string) => {
      const current = stateRef.current
      const doc = current.documents.find((d) => d.id === current.activeDocId)
      if (!doc) return
      const docHistory = current.histories[doc.id]
      const previousEntry = docHistory?.entries[docHistory.index]
      const entry = makeHistoryEntry(doc, name || `Snapshot ${new Date().toLocaleTimeString()}`, previousEntry, "all")
      dispatch({
        type: "add-history-snapshot",
        docId: doc.id,
        snapshot: {
          id: uid("snapshot"),
          name: name || entry.label,
          createdAt: Date.now(),
          entry,
        },
      })
    },
    [dispatch],
  )

  const restoreHistorySnapshot = React.useCallback(
    (snapshotId: string) => {
      const current = stateRef.current
      const doc = current.documents.find((d) => d.id === current.activeDocId)
      if (!doc) return
      const snapshot = (current.snapshots[doc.id] ?? []).find((s) => s.id === snapshotId)
      if (!snapshot) return
      dispatch({ type: "restore-history-entry", entry: snapshot.entry })
      requestRender()
    },
    [dispatch, requestRender],
  )

  const deleteHistorySnapshot = React.useCallback((snapshotId: string) => {
    const current = stateRef.current
    const docId = current.activeDocId
    if (!docId) return
    dispatch({ type: "delete-history-snapshot", docId, snapshotId })
  }, [dispatch])

  const createAction = React.useCallback((name?: string) => {
    const createdAt = Date.now()
    dispatch({
      type: "add-action",
      action: {
        id: uid("action"),
        name: name || `Action ${new Date(createdAt).toLocaleTimeString()}`,
        createdAt,
        updatedAt: createdAt,
        steps: [],
      },
    })
  }, [dispatch])

  const startRecordingAction = React.useCallback((id: string) => {
    dispatch({ type: "start-recording-action", id })
  }, [dispatch])

  const stopRecordingAction = React.useCallback(() => {
    dispatch({ type: "stop-recording-action" })
  }, [dispatch])

  const playAction = React.useCallback(
    async (id: string) => {
      const action = stateRef.current.actions.find((a) => a.id === id)
      if (!action || !action.steps.length) return
      dispatch({ type: "set-playing-action", playing: true })
      try {
        const envelope = loadActionEnvelopes()[id] ?? { steps: {} }
        await playActionWithConditions(
          action,
          envelope,
          {
            getContext: (step) => {
              const current = stateRef.current
              const doc = current.documents.find((d) => d.id === current.activeDocId) ?? current.documents[0]
              const activeLayer = doc?.layers.find((layer) => layer.id === doc.activeLayerId) ?? null
              const docForContext = doc ?? ({
                id: "action-playback-context",
                name: step.entry.label,
                width: step.entry.width ?? 1,
                height: step.entry.height ?? 1,
                zoom: 1,
                layers: [],
                activeLayerId: step.entry.activeLayerId,
                selectedLayerIds: step.entry.selectedLayerIds,
                background: "#ffffff",
                colorMode: step.entry.colorMode ?? "RGB",
                bitDepth: 8,
                selection: step.entry.selection ?? { bounds: null, shape: "rect" },
              } as PsDocument)
              return {
                doc: docForContext,
                activeLayer,
                entry: step.entry,
                selection: docForContext.selection ?? null,
              }
            },
          },
          {
            applyStep: async (step) => {
              dispatch({ type: "restore-history-entry", entry: step.entry })
              requestRender()
              const delay = readPlaybackSpeedDelayMs()
              if (delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay))
            },
          },
        )
        await new Promise((resolve) => window.setTimeout(resolve, 0))
        const current = stateRef.current
        const doc = current.documents.find((d) => d.id === current.activeDocId)
        if (doc) {
          const docHistory = current.histories[doc.id]
          const previousEntry = docHistory?.entries[docHistory.index]
          dispatch({
            type: "push-history",
            entry: makeHistoryEntry(doc, `Play Action: ${action.name}`, previousEntry, "all"),
          })
        }
      } finally {
        dispatch({ type: "set-playing-action", playing: false })
        requestRender()
      }
    },
    [dispatch, requestRender],
  )

  const deleteAction = React.useCallback((id: string) => {
    dispatch({ type: "delete-action", id })
  }, [dispatch])

  const clearAction = React.useCallback((id: string) => {
    dispatch({ type: "clear-action-steps", id })
  }, [dispatch])

  const newLayer = React.useCallback(
    (kind: LayerKind = "raster") => {
      if (!activeDoc) return
      const c = makeCanvas(activeDoc.width, activeDoc.height)
      const layer: Layer = {
        id: uid("layer"),
        name: kind === "raster" ? `Layer ${activeDoc.layers.length}` : `${kind} ${activeDoc.layers.length}`,
        kind,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        canvas: c,
      }
      dispatch({ type: "add-layer", layer })
      setTimeout(() => commit("New Layer", [layer.id]), 0)
    },
    [activeDoc, commit, dispatch],
  )

  const newGroup = React.useCallback(() => {
    if (!activeDoc) return
    const groupId = uid("group")
    dispatch({ type: "group-selected", groupId })
    setTimeout(() => commit("New Group", [groupId, ...activeDoc.selectedLayerIds]), 0)
  }, [activeDoc, commit, dispatch])

  const createDocument = React.useCallback(
    (doc: PsDocument, label = "New Document", lifecycle?: Partial<DocumentLifecycleState>) => {
      const entry = makeHistoryEntry(doc, label)
      dispatch({ type: "new-document", doc, entry, lifecycle })
      requestRender()
    },
    [dispatch, requestRender],
  )

  const duplicateDocument = React.useCallback(
    (id?: string) => {
      const current = stateRef.current
      const source = current.documents.find((doc) => doc.id === (id ?? current.activeDocId))
      if (!source) return
      const duplicated = duplicateDocumentDeep(source)
      const entry = makeHistoryEntry(duplicated, "Duplicate Document")
      dispatch({ type: "new-document", doc: duplicated, entry })
      requestRender()
    },
    [dispatch, requestRender],
  )

  const requestCloseDocument = React.useCallback((id?: string) => {
    const closeId = id ?? stateRef.current.activeDocId
    if (!closeId) return
    requestCloseDocuments([closeId])
  }, [requestCloseDocuments])

  const closeOtherDocuments = React.useCallback((id?: string) => {
    const keepId = id ?? stateRef.current.activeDocId
    if (!keepId) return
    const ids = stateRef.current.documents.filter((doc) => doc.id !== keepId).map((doc) => doc.id)
    const dirtyId = ids.find((docId) => isDocumentDirtyInState(stateRef.current, docId))
    if (dirtyId) {
      requestCloseDocuments(ids)
      return
    }
    dispatch({ type: "close-other-documents", keepId })
    requestRender()
  }, [dispatch, requestCloseDocuments, requestRender])

  const reopenClosedDocument = React.useCallback((id?: string) => {
    dispatch({ type: "reopen-closed-document", id })
    requestRender()
  }, [dispatch, requestRender])

  const markDocumentSaved = React.useCallback((id: string, lifecycle?: Partial<DocumentLifecycleState>) => {
    dispatch({ type: "mark-document-saved", id, lifecycle })
  }, [dispatch])

  const setDocumentLifecycle = React.useCallback((id: string, lifecycle: Partial<DocumentLifecycleState>) => {
    dispatch({ type: "set-document-lifecycle", id, lifecycle })
  }, [dispatch])

  const moveLayersToDocument = React.useCallback(
    (sourceDocId: string, targetDocId: string, layerIds: string[], copy = true) => {
      dispatch({ type: "move-layers-to-document", sourceDocId, targetDocId, layerIds, copy })
      requestRender()
      window.setTimeout(() => {
        const doc = stateRef.current.documents.find((candidate) => candidate.id === targetDocId)
        if (doc) {
          const docHistory = stateRef.current.histories[doc.id]
          dispatch({
            type: "push-history",
            entry: makeHistoryEntry(doc, copy ? "Copy Layers Between Documents" : "Move Layers Between Documents", docHistory?.entries[docHistory.index], doc.selectedLayerIds),
          })
        }
      }, 0)
    },
    [dispatch, requestRender],
  )

  const editSmartObject = React.useCallback(
    (layer?: Layer | null) => {
      const parent = stateRef.current.documents.find((doc) => doc.id === stateRef.current.activeDocId)
      const sourceLayer = layer ?? parent?.layers.find((candidate) => candidate.id === parent.activeLayerId)
      if (!parent || !sourceLayer || (!sourceLayer.smartObject && sourceLayer.kind !== "smart-object")) return
      const source = sourceLayer.smartSource?.canvas ?? sourceLayer.canvas
      const width = sourceLayer.smartSource?.width ?? source.width
      const height = sourceLayer.smartSource?.height ?? source.height
      const editableLayer: Layer = {
        id: uid("layer"),
        name: `${sourceLayer.name} Source`,
        kind: "raster",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        canvas: cloneCanvas(source) ?? makeCanvas(width, height),
      }
      const doc: PsDocument = {
        ...makeDocument(`${sourceLayer.name}.psb`, width, height, parent.background),
        id: uid("smartdoc"),
        layers: [editableLayer],
        activeLayerId: editableLayer.id,
        selectedLayerIds: [editableLayer.id],
        background: "transparent",
        smartObjectParent: { docId: parent.id, layerId: sourceLayer.id },
      }
      const entry = makeHistoryEntry(doc, "Open Smart Object")
      dispatch({ type: "new-document", doc, entry })
      requestRender()
    },
    [dispatch, requestRender],
  )

  const updateSmartObjectParent = React.useCallback(() => {
    const current = stateRef.current
    const doc = current.documents.find((candidate) => candidate.id === current.activeDocId)
    if (!doc?.smartObjectParent) return
    const rendered = renderSmartObjectDocument(doc)
    dispatch({
      type: "update-smart-object-parent",
      parentDocId: doc.smartObjectParent.docId,
      layerId: doc.smartObjectParent.layerId,
      canvas: rendered,
    })
    window.setTimeout(() => commit("Update Smart Object", [doc.smartObjectParent!.layerId]), 0)
    requestRender()
  }, [commit, dispatch, requestRender])

  const copySelection = React.useCallback(
    (cut = false) => {
      if (!activeDoc || !activeLayer) return
      if (typeof activeLayer.canvas.getContext !== "function") return
      const sel = activeDoc.selection.bounds
      const sx = sel ? Math.max(0, Math.floor(sel.x)) : 0
      const sy = sel ? Math.max(0, Math.floor(sel.y)) : 0
      const sw = sel
        ? Math.max(1, Math.min(activeDoc.width - sx, Math.floor(sel.w)))
        : activeDoc.width
      const sh = sel
        ? Math.max(1, Math.min(activeDoc.height - sy, Math.floor(sel.h)))
        : activeDoc.height
      const tmp = makeCanvas(sw, sh)
      tmp.getContext("2d")!.drawImage(activeLayer.canvas, -sx, -sy)
      // If selection has a mask, apply it
      if (sel && activeDoc.selection.mask) {
        const mctx = tmp.getContext("2d")!
        mctx.globalCompositeOperation = "destination-in"
        mctx.drawImage(activeDoc.selection.mask, -sx, -sy)
      }
      dispatch({ type: "set-clipboard", canvas: tmp })
      if (cut && !activeLayer.locked) {
        const ctx = activeLayer.canvas.getContext("2d")!
        if (activeDoc.selection.mask) {
          // Cut where mask is opaque
          ctx.save()
          ctx.globalCompositeOperation = "destination-out"
          ctx.drawImage(activeDoc.selection.mask, 0, 0)
          ctx.restore()
        } else {
          ctx.clearRect(sx, sy, sw, sh)
        }
        commit("Cut", [activeLayer.id])
      }
    },
    [activeDoc, activeLayer, commit, dispatch],
  )

  const pasteAsLayer = React.useCallback(() => {
    const clip = state.clipboard
    if (!activeDoc || !clip) return
    const c = makeCanvas(activeDoc.width, activeDoc.height)
    const sel = activeDoc.selection.bounds
    const dx = sel ? sel.x : Math.max(0, (activeDoc.width - clip.width) / 2)
    const dy = sel ? sel.y : Math.max(0, (activeDoc.height - clip.height) / 2)
    c.getContext("2d")!.drawImage(clip.canvas, dx, dy)
    const layer: Layer = {
      id: uid("layer"),
      name: "Pasted Layer",
      kind: "raster",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      canvas: c,
    }
    dispatch({ type: "add-layer", layer })
    setTimeout(() => commit("Paste", [layer.id]), 0)
  }, [activeDoc, state.clipboard, commit, dispatch])

  const purgeCaches = React.useCallback((target: PurgeTarget): PurgeResult => {
    const current = stateRef.current
    const requestedTargets = planPurgeTargets(target)
    let freedBytes = 0
    const details: string[] = []

    const includes = (candidate: Exclude<PurgeTarget, "all">) =>
      target === "all" || requestedTargets.includes(candidate)

    if (target === "undo") {
      const doc = current.documents.find((candidate) => candidate.id === current.activeDocId)
      if (doc) {
        freedBytes += estimateUndoPurgeBytes(current)
        dispatch({
          type: "purge-undo",
          docId: doc.id,
          entry: makeHistoryEntry(doc, "Current State", undefined, "all"),
        })
        details.push("Undo queue reset to the current document state.")
      }
    } else if (includes("histories")) {
      freedBytes += estimateHistoriesPurgeBytes(current)
      const entriesByDocId: Record<string, HistoryEntry> = {}
      for (const doc of current.documents) entriesByDocId[doc.id] = makeHistoryEntry(doc, "Current State", undefined, "all")
      const closedEntriesByRecordId: Record<string, HistoryEntry> = {}
      for (const record of current.closedDocuments) {
        closedEntriesByRecordId[record.id] = makeHistoryEntry(record.doc, "Current State", undefined, "all")
      }
      dispatch({ type: "purge-histories", entriesByDocId, closedEntriesByRecordId })
      details.push("History states and history snapshots were reset.")
    }

    if (includes("clipboard")) {
      freedBytes += estimateClipboardPurgeBytes(current)
      dispatch({ type: "purge-clipboard" })
      details.push("Pixel and layer-style clipboards were cleared.")
    }

    if (includes("video-cache")) {
      freedBytes += estimateVideoCachePurgeBytes(current)
      dispatch({ type: "purge-video-cache" })
      details.push("Timeline thumbnails and video posters were cleared.")
    }

    if (target === "all") {
      freedBytes += purgeFilterPreviewCache(filterPreviewsRef.current)
      freedBytes += purgePsbTileViewCaches()
      details.push("Filter preview and PSB tile caches were cleared.")
    }

    if (target === "all" || includes("video-cache")) {
      requestRender({ layerIds: "all", reason: target === "all" ? "purge" : "video-cache" })
    }

    return { target, freedBytes, details }
  }, [dispatch, requestRender])

  const resizeDocument = React.useCallback(
    (w: number, h: number, resample: "nearest" | "bilinear" | "bicubic" | "bicubic-smoother" | "bicubic-sharper" = "bicubic") => {
      if (!activeDoc) return
      const newW = Math.max(1, Math.floor(w))
      const newH = Math.max(1, Math.floor(h))
      const smoothing = resample !== "nearest"
      const quality: ImageSmoothingQuality =
        resample === "nearest" ? "low" : resample === "bilinear" ? "medium" : "high"
      // Allocate fresh canvases for each layer instead of mutating
      // `layer.canvas.width`/`.height` in place. In-place mutation
      // would silently corrupt history snapshots that share the same
      // canvas reference (the snapshot's pixel data would now show the
      // resized result, breaking undo back to the pre-resize state).
      const layerCanvases: Array<{ id: string; canvas?: HTMLCanvasElement; mask?: HTMLCanvasElement | null }> = []
      for (const layer of activeDoc.layers) {
        if (typeof layer.canvas.getContext !== "function") continue
        const next = makeCanvas(newW, newH)
        const nctx = next.getContext("2d")!
        nctx.imageSmoothingEnabled = smoothing
        nctx.imageSmoothingQuality = quality
        nctx.drawImage(layer.canvas, 0, 0, newW, newH)
        const entry: { id: string; canvas?: HTMLCanvasElement; mask?: HTMLCanvasElement | null } = {
          id: layer.id,
          canvas: next,
        }
        if (layer.mask) {
          const nextMask = makeCanvas(newW, newH)
          const mctx = nextMask.getContext("2d")!
          mctx.imageSmoothingEnabled = smoothing
          mctx.imageSmoothingQuality = quality
          mctx.drawImage(layer.mask, 0, 0, newW, newH)
          entry.mask = nextMask
        }
        layerCanvases.push(entry)
      }
      dispatch({ type: "resize-document", width: newW, height: newH, layerCanvases })
      setTimeout(() => commit(`Image Size ${newW}x${newH} (${resample})`, "all"), 0)
    },
    [activeDoc, commit, dispatch],
  )

  const resizeCanvas = React.useCallback(
    (w: number, h: number, anchorX: number, anchorY: number, fill: string) => {
      if (!activeDoc) return
      const newW = Math.max(1, Math.floor(w))
      const newH = Math.max(1, Math.floor(h))
      // anchorX/Y: 0=left/top, 0.5=center, 1=right/bottom
      const dx = (newW - activeDoc.width) * anchorX
      const dy = (newH - activeDoc.height) * anchorY
      // Allocate-and-paint helper that produces a brand-new canvas
      // rather than mutating an existing one (see resizeDocument
      // rationale).
      const allocResized = (src: HTMLCanvasElement, fill?: string) => {
        const next = makeCanvas(newW, newH)
        const nctx = next.getContext("2d")!
        if (fill && fill !== "transparent") {
          nctx.fillStyle = fill
          nctx.fillRect(0, 0, newW, newH)
        }
        nctx.drawImage(src, dx, dy)
        return next
      }

      const layerCanvases: Array<{ id: string; canvas?: HTMLCanvasElement; mask?: HTMLCanvasElement | null }> = []
      activeDoc.layers.forEach((layer, idx) => {
        if (!layer.canvas || typeof layer.canvas.getContext !== "function") return
        const entry: { id: string; canvas?: HTMLCanvasElement; mask?: HTMLCanvasElement | null } = {
          id: layer.id,
          canvas: allocResized(layer.canvas, idx === 0 ? fill : undefined),
        }
        if (layer.mask) entry.mask = allocResized(layer.mask)
        layerCanvases.push(entry)
      })

      const selectionMask = activeDoc.selection.mask ? allocResized(activeDoc.selection.mask) : undefined
      const quickMaskCanvas = activeDoc.quickMaskCanvas ? allocResized(activeDoc.quickMaskCanvas) : undefined
      const channelCanvases: Record<string, HTMLCanvasElement | null> = {}
      activeDoc.channels?.forEach((ch) => {
        if (ch.canvas) channelCanvases[ch.id] = allocResized(ch.canvas)
      })

      dispatch({
        type: "resize-canvas",
        width: newW,
        height: newH,
        offsetX: dx,
        offsetY: dy,
        fill,
        layerCanvases,
        selectionMask,
        quickMaskCanvas,
        channelCanvases: Object.keys(channelCanvases).length ? channelCanvases : undefined,
      })
      setTimeout(() => commit(`Canvas Size ${newW}×${newH}`, "all"), 0)
    },
    [activeDoc, commit, dispatch],
  )

  const toggleQuickMask = React.useCallback(() => {
    if (!activeDoc) return
    if (activeDoc.quickMask) {
      const mask = activeDoc.quickMaskCanvas
      if (mask) {
        const bounds = maskBounds(mask)
        const cloned = cloneCanvas(mask)
        if (bounds && cloned) {
          dispatch({
            type: "set-selection",
            selection: { bounds, shape: "freehand", mask: cloned },
          })
        } else {
          dispatch({ type: "set-selection", selection: { bounds: null, shape: "rect" } })
        }
      }
      dispatch({ type: "set-quick-mask", on: false, canvas: null })
    } else {
      const canvas =
        selectionToMaskCanvas(activeDoc.width, activeDoc.height, activeDoc.selection) ??
        makeCanvas(activeDoc.width, activeDoc.height)
      dispatch({ type: "set-quick-mask", on: true, canvas })
    }
  }, [activeDoc, dispatch])

  const addLayerMask = React.useCallback(() => {
    if (!activeDoc || !activeLayer) return
    const mask = makeCanvas(activeDoc.width, activeDoc.height, "#ffffff")
    // If selection exists, only reveal that part
    if (activeDoc.selection.bounds) {
      const ctx = mask.getContext("2d")!
      ctx.fillStyle = "#000"
      ctx.fillRect(0, 0, activeDoc.width, activeDoc.height)
      ctx.fillStyle = "#fff"
      if (activeDoc.selection.mask) {
        ctx.drawImage(activeDoc.selection.mask, 0, 0)
      } else {
        const b = activeDoc.selection.bounds
        if (activeDoc.selection.shape === "ellipse") {
          ctx.beginPath()
          ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.fillRect(b.x, b.y, b.w, b.h)
        }
      }
    }
    dispatch({ type: "set-layer-mask", id: activeLayer.id, mask })
    setTimeout(() => commit("Add Layer Mask", [activeLayer.id]), 0)
  }, [activeDoc, activeLayer, commit, dispatch])

  const value: EditorContextValue = React.useMemo(() => ({
    documents: state.documents,
    activeDocId: state.activeDocId,
    tool: state.tool,
    foreground: state.foreground,
    background: state.background,
    brush: state.brush,
    gradient: state.gradient,
    paintBucket: state.paintBucket,
    eraser: state.eraser,
    cloneSource: state.cloneSource,
    symmetry: state.symmetry,
    selectionOptions: state.selectionOptions,
    transform: state.transform,
    brushPresets: state.brushPresets,
    history: docHistory.entries,
    historyIndex: docHistory.index,
    snapshots: docSnapshots,
    closedDocuments: state.closedDocuments.map((record) => ({
      id: record.id,
      name: record.doc.name,
      width: record.doc.width,
      height: record.doc.height,
      closedAt: record.closedAt,
    })),
    documentStatuses,
    documentHistoryVersions,
    actions: state.actions,
    recordingActionId: state.recordingActionId,
    isPlayingAction: state.isPlayingAction,
    activeSmartFilterMaskTarget: state.activeSmartFilterMaskTarget,
    activeDoc,
    activeLayer,
    selectedLayers,
    clipboard: state.clipboard,
    styleClipboard: state.styleClipboard,
    dispatch,
    commit,
    requestRender,
    subscribeRender,
    newLayer,
    newGroup,
    jumpHistory,
    stepHistoryBy,
    createHistorySnapshot,
    restoreHistorySnapshot,
    deleteHistorySnapshot,
    createAction,
    startRecordingAction,
    stopRecordingAction,
    playAction,
    deleteAction,
    clearAction,
    createDocument,
    duplicateDocument,
    requestCloseDocument,
    closeOtherDocuments,
    reopenClosedDocument,
    markDocumentSaved,
    setDocumentLifecycle,
    moveLayersToDocument,
    copySelection,
    pasteAsLayer,
    purgeCaches,
    resizeDocument,
    resizeCanvas,
    toggleQuickMask,
    addLayerMask,
    editSmartObject,
    updateSmartObjectParent,
    beginTransform: (layer: Layer) => {
      if (!activeDoc) return
      const snapshot = makeCanvas(activeDoc.width, activeDoc.height)
      snapshot.getContext("2d")!.drawImage(layer.canvas, 0, 0)
      const bounds = alphaBounds(layer.canvas) ?? { x: 0, y: 0, w: layer.canvas.width, h: layer.canvas.height }
      dispatch({ type: "set-transform", transform: {
        active: true,
        layerId: layer.id,
        source: snapshot,
        bounds,
        tx: 0,
        ty: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        skewX: 0,
        skewY: 0,
        referencePoint: "mc",
        constrainProportions: true,
        interpolation: "bicubic",
      } })
      dispatch({ type: "set-tool", tool: "transform" })
    },
    commitTransform: () => {
      if (!activeDoc) return
      const t = state.transform
      if (!t) return
      const layer = activeDoc.layers.find((l) => l.id === t.layerId)
      if (!layer) {
        dispatch({ type: "clear-transform" })
        return
      }
      const ctx = layer.canvas.getContext("2d")!
      ctx.clearRect(0, 0, activeDoc.width, activeDoc.height)
      if (t.source) {
        const ref = t.referencePoint ?? "mc"
        const xFactor = ref.endsWith("l") ? 0 : ref.endsWith("r") ? 1 : 0.5
        const yFactor = ref.startsWith("t") ? 0 : ref.startsWith("b") ? 1 : 0.5
        const cx = t.bounds.x + t.bounds.w * xFactor
        const cy = t.bounds.y + t.bounds.h * yFactor
        ctx.save()
        ctx.imageSmoothingEnabled = t.interpolation !== "nearest"
        ctx.imageSmoothingQuality =
          t.interpolation === "bilinear" ? "medium" : t.interpolation === "nearest" ? "low" : "high"
        ctx.translate(cx + t.tx, cy + t.ty)
        ctx.rotate((t.rotation * Math.PI) / 180)
        ctx.transform(
          1,
          Math.tan(((t.skewY ?? 0) * Math.PI) / 180),
          Math.tan(((t.skewX ?? 0) * Math.PI) / 180),
          1,
          0,
          0,
        )
        ctx.scale(t.scaleX, t.scaleY)
        ctx.translate(-cx, -cy)
        ctx.drawImage(t.source, 0, 0)
        ctx.restore()
      }
      dispatch({ type: "clear-transform" })
      requestRender()
      commit("Free Transform", [layer.id])
    },
    flipLayer: (axis: "horizontal" | "vertical") => {
      if (!activeDoc || !activeLayer || activeLayer.locked) return
      if (typeof activeLayer.canvas.getContext !== "function") return
      const tmp = makeCanvas(activeLayer.canvas.width, activeLayer.canvas.height)
      const ctx = tmp.getContext("2d")!
      if (axis === "horizontal") {
        ctx.translate(activeLayer.canvas.width, 0)
        ctx.scale(-1, 1)
      } else {
        ctx.translate(0, activeLayer.canvas.height)
        ctx.scale(1, -1)
      }
      ctx.drawImage(activeLayer.canvas, 0, 0)
      const lc = activeLayer.canvas.getContext("2d")!
      lc.clearRect(0, 0, activeLayer.canvas.width, activeLayer.canvas.height)
      lc.drawImage(tmp, 0, 0)
      requestRender()
      commit(`Flip Layer ${axis}`, [activeLayer.id])
    },
    rotateLayer: (deg: number) => {
      if (!activeDoc || !activeLayer || activeLayer.locked) return
      const w = activeLayer.canvas.width
      const h = activeLayer.canvas.height
      const tmp = makeCanvas(w, h)
      const ctx = tmp.getContext("2d")!
      ctx.translate(w / 2, h / 2)
      ctx.rotate((deg * Math.PI) / 180)
      ctx.drawImage(activeLayer.canvas, -w / 2, -h / 2)
      const lc = activeLayer.canvas.getContext("2d")!
      lc.clearRect(0, 0, w, h)
      lc.drawImage(tmp, 0, 0)
      requestRender()
      commit(`Rotate Layer ${deg}\u00b0`, [activeLayer.id])
    },
    filterPreviews: filterPreviewsRef.current,
    setFilterPreview,
  }), [
    state.documents, state.activeDocId, state.tool, state.foreground, state.background,
    state.brush, state.gradient, state.paintBucket, state.eraser, state.cloneSource, state.symmetry, state.selectionOptions,
    state.transform, state.brushPresets, state.clipboard, state.styleClipboard, state.closedDocuments,
    state.actions, state.recordingActionId, state.isPlayingAction, state.activeSmartFilterMaskTarget, documentStatuses, documentHistoryVersions,
    docHistory.entries, docHistory.index, docSnapshots,
    activeDoc, activeLayer, selectedLayers,
    dispatch, commit, requestRender, subscribeRender,
    newLayer, newGroup, jumpHistory, stepHistoryBy, createHistorySnapshot, restoreHistorySnapshot,
    deleteHistorySnapshot, createAction, startRecordingAction, stopRecordingAction,
    playAction, deleteAction, clearAction, createDocument, duplicateDocument, requestCloseDocument, closeOtherDocuments,
    reopenClosedDocument, markDocumentSaved, setDocumentLifecycle, moveLayersToDocument, copySelection, pasteAsLayer, purgeCaches,
    resizeDocument, resizeCanvas, toggleQuickMask, addLayerMask, editSmartObject, updateSmartObjectParent,
    setFilterPreview,
  ])

  const valueRef = React.useRef(value)
  valueRef.current = value
  const commandContextValue = React.useMemo<EditorCommands>(
    () => ({ dispatch, commit, requestRender, subscribeRender }),
    [dispatch, commit, requestRender, subscribeRender],
  )

  const closeTarget = closeRequest
    ? state.documents.find((doc) => doc.id === closeRequest.currentId) ?? null
    : null
  const savePendingClose = () => {
    if (!closeTarget) return
    setCloseRequest((current) => current ? { ...current, saving: true } : current)
    dispatchPhotoshopEvent("ps-save-document", { docId: closeTarget.id, mode: "save", reason: "close" })
  }
  const discardPendingClose = () => {
    if (!closeTarget) return
    finishPendingClose(closeTarget.id, true)
  }

  return (
    <EditorStateStoreContext.Provider value={stateStore}>
    <EditorCommandContext.Provider value={commandContextValue}>
    <EditorRenderContext.Provider value={renderContextValue}>
    <EditorValueRefContext.Provider value={valueRef}>
    <EditorContext.Provider value={value}>
      {children}
      <EditorCloseDialog
        documentName={closeTarget?.name ?? null}
        saving={closeRequest?.saving}
        onOpenChange={(open) => {
          if (!open && !closeRequest?.saving) setCloseRequest(null)
        }}
        onCancel={() => setCloseRequest(null)}
        onDiscard={discardPendingClose}
        onSave={savePendingClose}
      />
    </EditorContext.Provider>
    </EditorValueRefContext.Provider>
    </EditorRenderContext.Provider>
    </EditorCommandContext.Provider>
    </EditorStateStoreContext.Provider>
  )
}

export function useEditor() {
  const ctx = React.useContext(EditorContext)
  if (!ctx) throw new Error("useEditor must be used within EditorProvider")
  return ctx
}

export function useEditorSelector<T>(
  selector: (value: EditorContextValue) => T,
  equality: (left: T, right: T) => boolean = Object.is,
): T {
  const store = React.useContext(EditorStateStoreContext)
  const valueRef = React.useContext(EditorValueRefContext)
  if (!store || !valueRef) {
    throw new Error("useEditorSelector must be used within EditorProvider")
  }
  const selectorRef = React.useRef(selector)
  const equalityRef = React.useRef(equality)
  selectorRef.current = selector
  equalityRef.current = equality
  const cacheRef = React.useRef(createVersionedSelectionCache<T>())
  const getSelection = React.useCallback(() => {
    return selectWithVersionedCache(
      cacheRef.current,
      store.getVersion(),
      selectorRef.current,
      equalityRef.current,
      projectEditorContextValue(store.getSnapshot(), valueRef.current),
    )
  }, [store, valueRef])
  return React.useSyncExternalStore(store.subscribe, getSelection, getSelection)
}

export function useEditorStateSelector<T>(
  selector: (state: EditorState) => T,
  equality: (left: T, right: T) => boolean = Object.is,
): T {
  const store = React.useContext(EditorStateStoreContext)
  if (!store) throw new Error("useEditorStateSelector must be used within EditorProvider")
  const selectorRef = React.useRef(selector)
  const equalityRef = React.useRef(equality)
  selectorRef.current = selector
  equalityRef.current = equality
  const cacheRef = React.useRef(createVersionedSelectionCache<T>())
  const getSelection = React.useCallback(() => {
    return selectWithVersionedCache(
      cacheRef.current,
      store.getVersion(),
      selectorRef.current,
      equalityRef.current,
      store.getSnapshot(),
    )
  }, [store])
  return React.useSyncExternalStore(store.subscribe, getSelection, getSelection)
}

export function shallowEqualEditorSelection<T extends Record<string, unknown>>(
  left: T,
  right: T,
): boolean {
  if (Object.is(left, right)) return true
  const leftKeys = Object.keys(left)
  if (leftKeys.length !== Object.keys(right).length) return false
  return leftKeys.every((key) => Object.is(left[key], right[key]))
}

export function useEditorCommands() {
  const commands = React.useContext(EditorCommandContext)
  if (!commands) throw new Error("useEditorCommands must be used within EditorProvider")
  return commands
}

export function useEditorStoreApi(): EditorStore<EditorState> {
  const store = React.useContext(EditorStateStoreContext)
  if (!store) throw new Error("useEditorStoreApi must be used within EditorProvider")
  return store
}

export function useActiveDocument() {
  return useEditorStateSelector(selectActiveDocument)
}

export function useActiveLayer() {
  return useEditorStateSelector((state) => selectActiveLayer(selectActiveDocument(state)))
}

export function useToolState() {
  const activeSmartFilterMaskTarget = useEditorStateSelector((state) => state.activeSmartFilterMaskTarget)
  const background = useEditorStateSelector((state) => state.background)
  const brush = useEditorStateSelector((state) => state.brush)
  const cloneSource = useEditorStateSelector((state) => state.cloneSource)
  const eraser = useEditorStateSelector((state) => state.eraser)
  const foreground = useEditorStateSelector((state) => state.foreground)
  const gradient = useEditorStateSelector((state) => state.gradient)
  const paintBucket = useEditorStateSelector((state) => state.paintBucket)
  const selectionOptions = useEditorStateSelector((state) => state.selectionOptions)
  const symmetry = useEditorStateSelector((state) => state.symmetry)
  const tool = useEditorStateSelector((state) => state.tool)
  const transform = useEditorStateSelector((state) => state.transform)
  return React.useMemo(
    () => ({
      activeSmartFilterMaskTarget,
      background,
      brush,
      cloneSource,
      eraser,
      foreground,
      gradient,
      paintBucket,
      selectionOptions,
      symmetry,
      tool,
      transform,
    }),
    [
      activeSmartFilterMaskTarget,
      background,
      brush,
      cloneSource,
      eraser,
      foreground,
      gradient,
      paintBucket,
      selectionOptions,
      symmetry,
      tool,
      transform,
    ],
  )
}

export function useDocumentLifecycle(docId?: string | null) {
  return useEditorSelector((editor) => {
    const id = docId ?? editor.activeDocId
    return id ? editor.documentStatuses[id] : undefined
  })
}

export function useRenderSubscription(cb: (change: MergedRenderChange) => void) {
  const ctx = React.useContext(EditorRenderContext)
  if (!ctx) throw new Error("useRenderSubscription must be used within EditorProvider")
  const { subscribeRender } = ctx
  // Hold the latest callback in a ref so we can subscribe once with a stable
  // wrapper. Without this the subscription tears down and rebuilds every time
  // the caller produces a fresh callback identity (which is the common case
  // for inline arrow functions inside render).
  const cbRef = React.useRef(cb)
  React.useEffect(() => {
    cbRef.current = cb
  }, [cb])
  React.useEffect(
    () => subscribeRender((change) => cbRef.current(change)),
    [subscribeRender],
  )
}

export { cloneCanvas,makeCanvas,makeHistoryEntry,prepareEntryForRestore }
