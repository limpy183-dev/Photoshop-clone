import { compositeLayer } from "./blend-modes"
import { makeCanvas } from "./canvas-utils"
import {
cloneCanvas,
deepClonePlain
} from "./editor-document-cloning"
import {
currentHistoryIndex,
documentLifecycleFor,
withDocumentLifecyclePatch
} from "./editor-document-lifecycle"
import {
applyGlobalLightToStyle,
normalizeGlobalLight
} from "./editor-global-light"
import {
alignLayersInDocument,
combineSelectionWithChannel,
distributeLayersInDocument,
getUndoLimit
} from "./editor-history-geometry"
import {
COMPRESS_AFTER_N,
stripVideoCacheFromDoc,
stripVideoCacheFromEntry,
stripVideoCacheFromHistory,
stripVideoCacheFromSnapshots
} from "./editor-history-storage"
import {
flattenLayerStylePixels,
rasterizeLayerForOption,
} from "./editor-layer-rasterize"
import { flattenTransparencyCanvas } from "./flatten-transparency"
import {
deleteEmptyLayersFromDocument,
duplicateSlice,
flattenLayerMasks,
normalizeAdvancedBlending,
normalizeSlice,
reorderSmartFilterStack,
updateSmartFilterStack
} from "./layer-workflows"
import {
borderSelectionMask,
contractSelectionMask,
expandSelectionMask,
featherMask,
selectionFromMask,
selectionToMaskCanvas,
smoothSelectionMask,
transformSelectionMask
} from "./tool-helpers"
import type {
HistorySnapshot,
Layer
} from "./types"

import { restoreFromEntry } from "./editor-history-state"
import { Action,blocksLayerMove,isLayerLocked,layerCommandTargetIds,mutateActiveDoc,releaseHistoryEntriesEffect,type DocHistory,type EditorState,type EditorTransitionEffect,type EditorTransitionServices } from "./editor-reducer-model"

export function reduceEditorStateLate(
  state: EditorState,
  action: Action,
  effects: EditorTransitionEffect[],
  services: EditorTransitionServices,
  makeId: (prefix: string) => string,
  now: () => number,
): EditorState {
  switch (action.type) {
    case "flatten-all-layer-effects":
      return mutateActiveDoc(state, (d) => {
        const targets = layerCommandTargetIds(d, action.ids, !action.ids?.length)
        return {
          ...d,
          layers: d.layers.map((layer) =>
            targets.has(layer.id) && !isLayerLocked(layer) ? flattenLayerStylePixels(layer) : layer,
          ),
        }
      })
    case "flatten-all-masks":
      return mutateActiveDoc(state, (d) => {
        const targets = layerCommandTargetIds(d, action.ids, !action.ids?.length)
        return {
          ...d,
          layers: d.layers.map((layer) =>
            targets.has(layer.id) && !isLayerLocked(layer) ? flattenLayerMasks(layer, d.width, d.height) : layer,
          ),
        }
      })
    case "delete-empty-layers":
      return mutateActiveDoc(state, (d) => deleteEmptyLayersFromDocument(d))
    case "rasterize-layers":
      return mutateActiveDoc(state, (d) => {
        const targets = layerCommandTargetIds(d, action.ids, action.option === "all")
        return {
          ...d,
          layers: d.layers.map((layer) =>
            targets.has(layer.id) && !isLayerLocked(layer)
              ? rasterizeLayerForOption(layer, action.option, d)
              : layer,
          ),
        }
      })
    case "flatten-transparency":
      return mutateActiveDoc(state, (d) => {
        // Resolve the target layer set based on scope, with explicit layerIds
        // taking precedence (used by tests and programmatic callers).
        let targetIds: Set<string>
        if (action.layerIds?.length) {
          targetIds = new Set(action.layerIds)
        } else if (action.scope === "document") {
          targetIds = new Set(d.layers.map((l) => l.id))
        } else if (action.scope === "visible") {
          targetIds = new Set(d.layers.filter((l) => l.visible).map((l) => l.id))
        } else {
          targetIds = new Set(
            d.selectedLayerIds.length
              ? d.selectedLayerIds
              : d.activeLayerId
                ? [d.activeLayerId]
                : [],
          )
        }
        if (!targetIds.size) return d

        let changed = false
        const layers = d.layers.map((layer) => {
          if (!targetIds.has(layer.id) || layer.kind === "group" || isLayerLocked(layer)) return layer
          const canvas = cloneCanvas(layer.canvas)
          if (!canvas) return layer
          const stats = flattenTransparencyCanvas(canvas, {
            matte: action.matte,
            alphaMode: action.alphaMode ?? "clear",
          })
          if (stats.changedPixels === 0) return layer
          changed = true
          return { ...layer, canvas }
        })
        return changed ? { ...d, layers } : d
      })
    case "link-selected":
      return mutateActiveDoc(state, (d) => {
        if (d.selectedLayerIds.length < 2) return d
        const existing =
          d.layers.find((l) => d.selectedLayerIds.includes(l.id) && l.linkGroupId)?.linkGroupId ??
          makeId("link")
        return {
          ...d,
          layers: d.layers.map((l) =>
            d.selectedLayerIds.includes(l.id) ? { ...l, linkGroupId: existing } : l,
          ),
        }
      })
    case "unlink-selected":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          d.selectedLayerIds.includes(l.id) ? { ...l, linkGroupId: undefined } : l,
        ),
      }))
    case "group-selected":
      return mutateActiveDoc(state, (d) => {
        const ids = d.selectedLayerIds.length
          ? d.selectedLayerIds
          : d.activeLayerId
            ? [d.activeLayerId]
            : []
        // If no layer is selected at all, create an empty group on top.
        if (ids.length < 1) {
          const group: Layer = {
            id: action.groupId,
            name: "Group",
            kind: "group",
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: "normal",
            canvas: makeCanvas(d.width, d.height),
            childIds: [],
            expanded: true,
          }
          return {
            ...d,
            layers: [...d.layers, group],
            activeLayerId: group.id,
            selectedLayerIds: [group.id],
          }
        }
        // Insert a group layer just above the highest selected
        const indices = ids
          .map((id) => d.layers.findIndex((l) => l.id === id))
          .filter((i) => i >= 0)
        const topIdx = Math.max(...indices)
        const group: Layer = {
          id: action.groupId,
          name: "Group",
          kind: "group",
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: "normal",
          canvas: makeCanvas(d.width, d.height),
          childIds: ids,
          expanded: true,
        }
        const layers = [...d.layers]
        layers.splice(topIdx + 1, 0, group)
        // Tag children with parentId
        const tagged = layers.map((l) => (ids.includes(l.id) ? { ...l, parentId: group.id } : l))
        return {
          ...d,
          layers: tagged,
          activeLayerId: group.id,
          selectedLayerIds: [group.id],
        }
      })
    case "ungroup":
      return mutateActiveDoc(state, (d) => {
        const layers = d.layers.filter((l) => l.id !== action.groupId)
        const cleaned = layers.map((l) =>
          l.parentId === action.groupId ? { ...l, parentId: undefined } : l,
        )
        const newActive = cleaned[cleaned.length - 1]?.id ?? ""
        return {
          ...d,
          layers: cleaned,
          activeLayerId: newActive,
          selectedLayerIds: newActive ? [newActive] : [],
        }
      })
    case "toggle-group-expanded":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && l.kind === "group" ? { ...l, expanded: !l.expanded } : l,
        ),
      }))
    case "push-history": {
      if (!state.activeDocId) return state
      const cur = state.histories[state.activeDocId]
      // 1. Discard any redo tail beyond the current index — those
      //    entries become unreachable when we push a new branch.
      const trimmed = cur ? cur.entries.slice(0, cur.index + 1) : []
      if (cur && cur.index + 1 < cur.entries.length) {
        releaseHistoryEntriesEffect(effects, cur.entries.slice(cur.index + 1))
      }
      const limit = getUndoLimit()
      const combined = [...trimmed, action.entry]
      // 2. Honor the undo-limit by dropping the oldest entries — also
      //    free their blobs (this is the long-session leak path).
      let next = combined
      if (combined.length > limit) {
        releaseHistoryEntriesEffect(effects, combined.slice(0, combined.length - limit))
        next = combined.slice(-limit)
      }
      // Schedule background compression of older entries to free canvas memory
      if (next.length > COMPRESS_AFTER_N) {
        effects.push({ type: "schedule-history-compression", entries: next, currentIndex: next.length - 1 })
      }
      return {
        ...state,
        histories: {
          ...state.histories,
          [state.activeDocId]: { entries: next, index: next.length - 1 },
        },
        documentLifecycle: {
          ...state.documentLifecycle,
          [state.activeDocId]: {
            ...documentLifecycleFor(state, state.documents.find((doc) => doc.id === state.activeDocId)!),
            dirty: true,
          },
        },
      }
    }
    case "reset-history": {
      // Replace the document's entire history with a single floor entry. This
      // is used after canvas initialization to ensure undo can never reach a
      // pre-init state with stale (e.g. SSR placeholder) canvas references.
      // The floor entry represents the canvas state at the moment the
      // document was joined/opened — undoing past it is meaningless and was
      // previously visually destructive (it could clear the default
      // background paint).
      const prior = state.histories[action.docId]?.entries
      releaseHistoryEntriesEffect(effects, prior)
      return {
        ...state,
        histories: {
          ...state.histories,
          [action.docId]: { entries: [action.entry], index: 0 },
        },
      }
    }
    case "purge-undo": {
      const prior = state.histories[action.docId]?.entries
      releaseHistoryEntriesEffect(effects, prior)
      return {
        ...state,
        histories: {
          ...state.histories,
          [action.docId]: { entries: [action.entry], index: 0 },
        },
      }
    }
    case "purge-histories": {
      const histories = { ...state.histories }
      const snapshots = { ...state.snapshots }
      for (const [docId, entry] of Object.entries(action.entriesByDocId)) {
        const prior = histories[docId]?.entries
        releaseHistoryEntriesEffect(effects, prior)
        const priorSnapshots = snapshots[docId] ?? []
        releaseHistoryEntriesEffect(effects, priorSnapshots.map((snapshot) => snapshot.entry))
        histories[docId] = { entries: [entry], index: 0 }
        snapshots[docId] = []
      }
      const closedDocuments = state.closedDocuments.map((record) => {
        const entry = action.closedEntriesByRecordId[record.id]
        if (!entry) return record
        releaseHistoryEntriesEffect(effects, record.history?.entries)
        releaseHistoryEntriesEffect(effects, record.snapshots?.map((snapshot) => snapshot.entry))
        return {
          ...record,
          history: { entries: [entry], index: 0 },
          snapshots: [],
        }
      })
      return { ...state, histories, snapshots, closedDocuments }
    }
    case "restore-history": {
      if (!state.activeDocId) return state
      const docId = state.activeDocId
      const docs = state.documents.map((d) => {
        if (d.id !== docId) return d
        return {
          ...d,
          layers: action.restoredLayers,
          activeLayerId: action.activeLayerId,
          selectedLayerIds: action.selectedLayerIds,
          width: action.entry.width ?? d.width,
          height: action.entry.height ?? d.height,
          selection: action.entry.selection ? { ...action.entry.selection, mask: action.entry.selection.mask ? cloneCanvas(action.entry.selection.mask) : null } : d.selection,
          guides: action.entry.guides ? deepClonePlain(action.entry.guides) : d.guides,
          comps: action.entry.comps ? deepClonePlain(action.entry.comps) : d.comps,
          channels: action.entry.channels ? action.entry.channels.map(c => ({ ...c, canvas: cloneCanvas(c.canvas)! })) : d.channels,
          notes: action.entry.notes ? deepClonePlain(action.entry.notes) : d.notes,
          slices: action.entry.slices ? deepClonePlain(action.entry.slices) : d.slices,
          counts: action.entry.counts ? deepClonePlain(action.entry.counts) : d.counts,
          colorSamplers: action.entry.colorSamplers ? deepClonePlain(action.entry.colorSamplers) : d.colorSamplers,
          quickMask: action.entry.quickMask ?? d.quickMask,
          quickMaskCanvas: action.entry.quickMaskCanvas ? cloneCanvas(action.entry.quickMaskCanvas) : d.quickMaskCanvas,
          quickMaskPaintMode: action.entry.quickMaskPaintMode ?? d.quickMaskPaintMode,
          colorMode: action.entry.colorMode ?? d.colorMode,
          modeSettings: action.entry.modeSettings ? deepClonePlain(action.entry.modeSettings) : d.modeSettings,
          variableDataSets: action.entry.variableDataSets ? deepClonePlain(action.entry.variableDataSets) : d.variableDataSets,
          assetLibrary: action.entry.assetLibrary ? deepClonePlain(action.entry.assetLibrary) : d.assetLibrary,
        }
      })
      return {
        ...state,
        documents: docs,
        histories: {
          ...state.histories,
          [docId]: { ...state.histories[docId], index: action.index },
        },
      }
    }
    case "restore-history-entry": {
      if (!state.activeDocId) return state
      const docId = state.activeDocId
      const docs = state.documents.map((d) => {
        if (d.id !== docId) return d
        return {
          ...d,
          layers: restoreFromEntry(d, action.entry),
          activeLayerId: action.entry.activeLayerId,
          selectedLayerIds: action.entry.selectedLayerIds,
          width: action.entry.width ?? d.width,
          height: action.entry.height ?? d.height,
          selection: action.entry.selection ? { ...action.entry.selection, mask: action.entry.selection.mask ? cloneCanvas(action.entry.selection.mask) : null } : d.selection,
          guides: action.entry.guides ? deepClonePlain(action.entry.guides) : d.guides,
          comps: action.entry.comps ? deepClonePlain(action.entry.comps) : d.comps,
          channels: action.entry.channels ? action.entry.channels.map(c => ({ ...c, canvas: cloneCanvas(c.canvas)! })) : d.channels,
          notes: action.entry.notes ? deepClonePlain(action.entry.notes) : d.notes,
          slices: action.entry.slices ? deepClonePlain(action.entry.slices) : d.slices,
          counts: action.entry.counts ? deepClonePlain(action.entry.counts) : d.counts,
          colorSamplers: action.entry.colorSamplers ? deepClonePlain(action.entry.colorSamplers) : d.colorSamplers,
          quickMask: action.entry.quickMask ?? d.quickMask,
          quickMaskCanvas: action.entry.quickMaskCanvas ? cloneCanvas(action.entry.quickMaskCanvas) : d.quickMaskCanvas,
          quickMaskPaintMode: action.entry.quickMaskPaintMode ?? d.quickMaskPaintMode,
          colorMode: action.entry.colorMode ?? d.colorMode,
          modeSettings: action.entry.modeSettings ? deepClonePlain(action.entry.modeSettings) : d.modeSettings,
          variableDataSets: action.entry.variableDataSets ? deepClonePlain(action.entry.variableDataSets) : d.variableDataSets,
          assetLibrary: action.entry.assetLibrary ? deepClonePlain(action.entry.assetLibrary) : d.assetLibrary,
        }
      })
      return { ...state, documents: docs }
    }
    case "add-history-snapshot":
      return {
        ...state,
        snapshots: {
          ...state.snapshots,
          [action.docId]: [...(state.snapshots[action.docId] ?? []), action.snapshot],
        },
      }
    case "delete-history-snapshot":
      return {
        ...state,
        snapshots: {
          ...state.snapshots,
          [action.docId]: (state.snapshots[action.docId] ?? []).filter((s) => s.id !== action.snapshotId),
        },
      }
    case "add-action":
      return { ...state, actions: [...state.actions, action.action], recordingActionId: action.action.id }
    case "set-actions":
      return { ...state, actions: action.actions, recordingActionId: null }
    case "delete-action":
      return {
        ...state,
        actions: state.actions.filter((a) => a.id !== action.id),
        recordingActionId: state.recordingActionId === action.id ? null : state.recordingActionId,
      }
    case "start-recording-action":
      return { ...state, recordingActionId: action.id }
    case "stop-recording-action":
      return { ...state, recordingActionId: null }
    case "append-action-step":
      return {
        ...state,
        actions: state.actions.map((recorded) =>
          recorded.id === action.actionId
            ? { ...recorded, steps: [...recorded.steps, action.step], updatedAt: action.step.createdAt }
            : recorded,
        ),
      }
    case "clear-action-steps":
      return {
        ...state,
        actions: state.actions.map((recorded) =>
          recorded.id === action.id ? { ...recorded, steps: [], updatedAt: now() } : recorded,
        ),
      }
    case "set-playing-action":
      return { ...state, isPlayingAction: action.playing }
    case "resize-document":
      return mutateActiveDoc(state, (d) => {
        // Build a lookup so we can swap canvases immutably without
        // mutating the source layer objects (which may still be
        // referenced by history snapshots).
        const swap = action.layerCanvases ? new Map(action.layerCanvases.map((entry) => [entry.id, entry])) : null
        return {
          ...d,
          width: action.width,
          height: action.height,
          layers: swap
            ? d.layers.map((l) => {
                const next = swap.get(l.id)
                if (!next) return l
                return {
                  ...l,
                  canvas: next.canvas ?? l.canvas,
                  mask: next.mask !== undefined ? next.mask : l.mask,
                }
              })
            : d.layers,
        }
      })
    case "resize-canvas":
      return mutateActiveDoc(state, (d) => {
        const swap = action.layerCanvases ? new Map(action.layerCanvases.map((entry) => [entry.id, entry])) : null
        const channelSwap = action.channelCanvases ?? null
        return {
          ...d,
          width: action.width,
          height: action.height,
          selection: {
            ...d.selection,
            bounds: d.selection.bounds ? { ...d.selection.bounds, x: d.selection.bounds.x + action.offsetX, y: d.selection.bounds.y + action.offsetY } : null,
            mask: action.selectionMask !== undefined ? action.selectionMask : d.selection.mask,
          },
          quickMaskCanvas: action.quickMaskCanvas !== undefined ? action.quickMaskCanvas : d.quickMaskCanvas,
          guides: d.guides ? d.guides.map(g => ({ ...g, position: g.position + (g.orientation === "horizontal" ? action.offsetY : action.offsetX) })) : undefined,
          slices: d.slices ? d.slices.map(s => ({ ...s, x: s.x + action.offsetX, y: s.y + action.offsetY })) : undefined,
          notes: d.notes ? d.notes.map(n => ({ ...n, x: n.x + action.offsetX, y: n.y + action.offsetY })) : undefined,
          counts: d.counts ? d.counts.map(c => ({ ...c, x: c.x + action.offsetX, y: c.y + action.offsetY })) : undefined,
          colorSamplers: d.colorSamplers ? d.colorSamplers.map(s => ({ ...s, x: s.x + action.offsetX, y: s.y + action.offsetY })) : undefined,
          channels: d.channels?.map((ch) => {
            if (!channelSwap) return ch
            const replacement = channelSwap[ch.id]
            // AlphaChannel.canvas cannot be null. If a caller wants to
            // delete a channel they should dispatch a separate action.
            return replacement ? { ...ch, canvas: replacement } : ch
          }),
          layers: d.layers.map(l => {
            const updated = { ...l }
            if (swap) {
              const repl = swap.get(l.id)
              if (repl) {
                if (repl.canvas) updated.canvas = repl.canvas
                if (repl.mask !== undefined) updated.mask = repl.mask
              }
            }
            if (updated.shape) updated.shape = { ...updated.shape, x: updated.shape.x + action.offsetX, y: updated.shape.y + action.offsetY }
            if (updated.text) updated.text = { ...updated.text, x: updated.text.x + action.offsetX, y: updated.text.y + action.offsetY }
            if (updated.frame) updated.frame = { ...updated.frame, x: updated.frame.x + action.offsetX, y: updated.frame.y + action.offsetY }
            if (updated.path) updated.path = { ...updated.path, points: updated.path.points.map(p => ({ x: p.x + action.offsetX, y: p.y + action.offsetY, cp1: p.cp1 ? { x: p.cp1.x + action.offsetX, y: p.cp1.y + action.offsetY } : undefined, cp2: p.cp2 ? { x: p.cp2.x + action.offsetX, y: p.cp2.y + action.offsetY } : undefined })) }
            if (updated.vectorMask) updated.vectorMask = { ...updated.vectorMask, points: updated.vectorMask.points.map(p => ({ x: p.x + action.offsetX, y: p.y + action.offsetY, cp1: p.cp1 ? { x: p.cp1.x + action.offsetX, y: p.cp1.y + action.offsetY } : undefined, cp2: p.cp2 ? { x: p.cp2.x + action.offsetX, y: p.cp2.y + action.offsetY } : undefined })) }
            return updated
          })
        }
      })
    case "set-clipboard":
      return {
        ...state,
        clipboard: {
          width: action.canvas.width,
          height: action.canvas.height,
          canvas: action.canvas,
        },
      }
    case "clear-clipboard":
      return { ...state, clipboard: null }
    case "set-style-clipboard":
      return { ...state, styleClipboard: action.style ? deepClonePlain(action.style) : null }
    case "purge-clipboard":
      return { ...state, clipboard: null, styleClipboard: null }
    case "purge-video-cache": {
      const histories: Record<string, DocHistory> = {}
      for (const [docId, history] of Object.entries(state.histories)) {
        histories[docId] = stripVideoCacheFromHistory(history) ?? history
      }
      const snapshots: Record<string, HistorySnapshot[]> = {}
      for (const [docId, docSnapshots] of Object.entries(state.snapshots)) {
        snapshots[docId] = stripVideoCacheFromSnapshots(docSnapshots)
      }
      const closedDocuments = state.closedDocuments.map((record) => ({
        ...record,
        doc: stripVideoCacheFromDoc(record.doc),
        history: stripVideoCacheFromHistory(record.history),
        snapshots: stripVideoCacheFromSnapshots(record.snapshots),
      }))
      return {
        ...state,
        documents: state.documents.map(stripVideoCacheFromDoc),
        histories,
        snapshots,
        closedDocuments,
        actions: state.actions.map((actionItem) => ({
          ...actionItem,
          steps: actionItem.steps.map((step) => {
            const entry = stripVideoCacheFromEntry(step.entry)
            return entry === step.entry ? step : { ...step, entry }
          }),
        })),
      }
    }
    case "set-layer-vector-mask":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, vectorMask: action.mask } : l)),
      }))
    case "set-layer-adjustment":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, adjustment: action.adjustment } : l)),
      }))
    case "set-layer-smart-filters": {
      const next = mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, smartFilters: action.smartFilters } : l)),
      }))
      const target = state.activeSmartFilterMaskTarget
      return {
        ...next,
        activeSmartFilterMaskTarget:
          target?.layerId === action.id && action.smartFilters.some((filter) => filter.id === target.filterId)
            ? target
            : target?.layerId === action.id
              ? null
              : target,
      }
    }
    case "update-smart-filter":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.layerId && !isLayerLocked(l)
            ? { ...l, smartFilters: updateSmartFilterStack(l.smartFilters, action.filterId, action.patch) }
            : l,
        ),
      }))
    case "reorder-smart-filter":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.layerId && !isLayerLocked(l)
            ? { ...l, smartFilters: reorderSmartFilterStack(l.smartFilters ?? [], action.filterId, action.offset) }
            : l,
        ),
      }))
    case "set-smart-filter-mask":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.layerId && !isLayerLocked(l)
            ? {
                ...l,
                smartFilters: (l.smartFilters ?? []).map((filter) =>
                  filter.id === action.filterId
                    ? {
                        ...filter,
                        mask: action.mask,
                        maskEnabled: action.enabled ?? filter.maskEnabled ?? true,
                      }
                    : filter,
                ),
              }
            : l,
        ),
      }))
    case "set-style-presets":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        stylePresets: action.presets,
      }))
    case "set-asset-library":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        assetLibrary: action.assets,
      }))
    case "set-timeline-frames":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        timelineFrames: action.frames,
      }))
    case "set-timeline-settings":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        timelineSettings: action.settings,
      }))
    case "set-global-light":
      return mutateActiveDoc(state, (d) => {
        const globalLight = normalizeGlobalLight(action.globalLight)
        return {
          ...d,
          globalLight,
          layers: d.layers.map((layer) =>
            layer.style ? { ...layer, style: applyGlobalLightToStyle(layer.style, globalLight) } : layer,
          ),
        }
      })
    case "set-document-metadata":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        metadata: {
          ...(d.metadata ?? {}),
          ...action.metadata,
          modifiedAt: new Date().toISOString(),
        },
      }))
    case "set-color-management":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        colorManagement: action.settings,
      }))
    case "set-print-settings":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        printSettings: action.settings,
      }))
    case "set-document-mode-settings":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        colorMode: action.colorMode,
        modeSettings: action.settings ?? { mode: action.colorMode },
        dpi: typeof action.dpi === "number" && Number.isFinite(action.dpi)
          ? Math.max(1, Math.min(2400, Math.round(action.dpi)))
          : d.dpi,
      }))
    case "set-plugins":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        plugins: action.plugins,
      }))
    case "set-plugin-storage":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        pluginStorage: action.pluginStorage,
      }))
    case "set-variable-data-sets":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        variableDataSets: action.dataSets,
      }))
    case "add-document-report":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        reports: [action.report, ...(d.reports ?? [])].slice(0, 12),
      }))
    case "clear-document-reports":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        reports: [],
      }))
    case "set-layer-color-label":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id ? { ...l, colorLabel: action.label } : l)),
      }))
    case "set-layer-metadata":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && !isLayerLocked(l)
            ? { ...l, metadata: action.metadata ? deepClonePlain(action.metadata) : undefined }
            : l,
        ),
      }))
    case "add-layer-note":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && !isLayerLocked(l)
            ? { ...l, notes: [...(l.notes ?? []), deepClonePlain(action.note)] }
            : l,
        ),
      }))
    case "update-layer-note":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && !isLayerLocked(l)
            ? {
                ...l,
                notes: (l.notes ?? []).map((note) =>
                  note.id === action.noteId
                    ? { ...note, ...deepClonePlain(action.patch), updatedAt: now() }
                    : note,
                ),
              }
            : l,
        ),
      }))
    case "remove-layer-note":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && !isLayerLocked(l)
            ? { ...l, notes: (l.notes ?? []).filter((note) => note.id !== action.noteId) }
            : l,
        ),
      }))
    case "align-layers":
      return mutateActiveDoc(state, (d) => alignLayersInDocument(d, action.align, action.ids))
    case "distribute-layers":
      return mutateActiveDoc(state, (d) => distributeLayersInDocument(d, action.axis, action.ids))
    case "reorder-layer": {
      return mutateActiveDoc(state, (d) => {
        const fromIdx = d.layers.findIndex((l) => l.id === action.id)
        const toIdx = d.layers.findIndex((l) => l.id === action.targetId)
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return d
        if (blocksLayerMove(d.layers[fromIdx])) return d
        const layers = [...d.layers]
        const [moved] = layers.splice(fromIdx, 1)
        let insertAt = layers.findIndex((l) => l.id === action.targetId)
        if (insertAt < 0) insertAt = layers.length
        if (action.position === "above") insertAt += 1
        const target = d.layers.find((l) => l.id === action.targetId)
        let parentId: string | undefined = moved.parentId
        if (action.position === "into" && target?.kind === "group") {
          parentId = target.id
        } else if (target?.parentId) {
          parentId = target.parentId
        } else if (action.position !== "into") {
          parentId = undefined
        }
        const updated = { ...moved, parentId }
        layers.splice(insertAt, 0, updated)
        return { ...d, layers }
      })
    }
    case "reorder-layers": {
      return mutateActiveDoc(state, (d) => {
        const ids = action.ids.filter((id, index, arr) => arr.indexOf(id) === index)
        if (!ids.length || ids.includes(action.targetId)) return d
        const idSet = new Set(ids)
        const moving = d.layers.filter((layer) => idSet.has(layer.id))
        if (moving.length !== ids.length || moving.some(blocksLayerMove)) return d
        const target = d.layers.find((layer) => layer.id === action.targetId)
        if (!target) return d
        const remaining = d.layers.filter((layer) => !idSet.has(layer.id))
        let insertAt = remaining.findIndex((layer) => layer.id === action.targetId)
        if (insertAt < 0) insertAt = remaining.length
        if (action.position === "above") insertAt += 1
        const parentId =
          action.position === "into" && target.kind === "group"
            ? target.id
            : target.parentId && action.position !== "into"
              ? target.parentId
              : undefined
        const updated = moving.map((layer) => ({ ...layer, parentId }))
        const layers = [...remaining]
        layers.splice(insertAt, 0, ...updated)
        return { ...d, layers }
      })
    }
    case "add-note":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        notes: [...(d.notes ?? []), action.note],
      }))
    case "update-note":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        notes: (d.notes ?? []).map((n) => (n.id === action.id ? { ...n, ...action.patch } : n)),
      }))
    case "remove-note":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        notes: (d.notes ?? []).filter((n) => n.id !== action.id),
      }))
    case "add-slice":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        slices: [...(d.slices ?? []), normalizeSlice(action.slice, d.width, d.height)],
        selectedSliceId: action.slice.id,
      }))
    case "update-slice":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        slices: (d.slices ?? []).map((s) =>
          s.id === action.id && (!s.locked || action.patch.locked !== undefined || action.patch.visible !== undefined)
            ? normalizeSlice({ ...s, ...action.patch }, d.width, d.height)
            : s,
        ),
      }))
    case "duplicate-slice":
      return mutateActiveDoc(state, (d) => {
        const source = (d.slices ?? []).find((slice) => slice.id === action.id)
        if (!source) return d
        const copy = duplicateSlice(source, (d.slices ?? []).map((slice) => slice.name), d.width, d.height)
        return {
          ...d,
          slices: [...(d.slices ?? []), copy],
          selectedSliceId: copy.id,
        }
      })
    case "set-active-slice":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        selectedSliceId: action.id && (d.slices ?? []).some((slice) => slice.id === action.id) ? action.id : undefined,
      }))
    case "remove-slice":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        slices: (d.slices ?? []).filter((s) => s.id !== action.id || s.locked),
        selectedSliceId: d.selectedSliceId === action.id && !(d.slices ?? []).some((s) => s.id === action.id && s.locked) ? undefined : d.selectedSliceId,
      }))
    case "clear-slices":
      return mutateActiveDoc(state, (d) => ({ ...d, slices: [], selectedSliceId: undefined }))
    case "add-count":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        counts: [...(d.counts ?? []), action.count],
      }))
    case "remove-count":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        counts: (d.counts ?? []).filter((c) => c.id !== action.id),
      }))
    case "clear-counts":
      return mutateActiveDoc(state, (d) => ({ ...d, counts: [] }))
    case "set-count-group":
      return mutateActiveDoc(state, (d) => ({ ...d, countGroup: action.group }))
    case "add-color-sampler":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        colorSamplers: [action.sampler, ...(d.colorSamplers ?? []).filter((sampler) => sampler.id !== action.sampler.id)].slice(0, 4),
      }))
    case "update-color-sampler":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        colorSamplers: (d.colorSamplers ?? []).map((sampler) => sampler.id === action.id ? { ...sampler, ...action.patch } : sampler),
      }))
    case "remove-color-sampler":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        colorSamplers: (d.colorSamplers ?? []).filter((sampler) => sampler.id !== action.id),
      }))
    case "clear-color-samplers":
      return mutateActiveDoc(state, (d) => ({ ...d, colorSamplers: [] }))
    case "save-comp":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        comps: [...(d.comps ?? []).filter((c) => c.id !== action.comp.id), action.comp],
      }))
    case "apply-comp":
      return mutateActiveDoc(state, (d) => {
        const comp = (d.comps ?? []).find((c) => c.id === action.id)
        if (!comp) return d
        return {
          ...d,
          layers: d.layers.map((l) => {
            const s = comp.state[l.id]
            if (!s) return l
            if (isLayerLocked(l)) return l
            return {
              ...l,
              visible: s.visible,
              opacity: s.opacity,
              fillOpacity: s.fillOpacity,
              advancedBlending: s.advancedBlending ? normalizeAdvancedBlending(s.advancedBlending) : l.advancedBlending,
              blendMode: s.blendMode,
              clipped: s.clipped,
              maskEnabled: s.maskEnabled,
              vectorMask: s.vectorMask ? deepClonePlain(s.vectorMask) : s.vectorMask,
              style: s.style ? deepClonePlain(s.style) : s.style,
              text: s.text ? deepClonePlain(s.text) : s.text,
              shape: s.shape ? { ...s.shape } : s.shape,
              path: s.path ? deepClonePlain(s.path) : s.path,
              adjustment: s.adjustment ? deepClonePlain(s.adjustment) : s.adjustment,
              smartFilters: s.smartFilters
                ? s.smartFilters.map((filter) => {
                    const existingFilter = l.smartFilters?.find((candidate) => candidate.id === filter.id)
                    return {
                      ...filter,
                      params: deepClonePlain(filter.params),
                      mask: existingFilter?.mask ? cloneCanvas(existingFilter.mask) : existingFilter?.mask ?? filter.mask,
                    }
                  })
                : s.smartFilters,
              colorLabel: s.colorLabel,
              notes: s.notes ? deepClonePlain(s.notes) : undefined,
              metadata: s.metadata ? deepClonePlain(s.metadata) : undefined,
            }
          }),
          activeLayerId: comp.activeLayerId && d.layers.some((l) => l.id === comp.activeLayerId) ? comp.activeLayerId : d.activeLayerId,
          selectedLayerIds: comp.selectedLayerIds?.filter((id) => d.layers.some((l) => l.id === id)).length
            ? comp.selectedLayerIds.filter((id) => d.layers.some((l) => l.id === id))
            : d.selectedLayerIds,
        }
      })
    case "remove-comp":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        comps: (d.comps ?? []).filter((c) => c.id !== action.id),
      }))
    case "set-measurement":
      return mutateActiveDoc(state, (d) => ({ ...d, measurement: action.m }))
    case "set-gradient-stops":
      return { ...state, gradient: { ...state.gradient, stops: action.stops } }
    case "grow-selection":
      return mutateActiveDoc(state, (d) => {
        if (!d.selection.bounds) return d
        const base = selectionToMaskCanvas(d.width, d.height, d.selection)
        if (!base) return d
        const amount = Math.round(action.amount)
        const mask = amount >= 0 ? expandSelectionMask(base, amount) : contractSelectionMask(base, -amount)
        return { ...d, selection: selectionFromMask(mask, "freehand", d.selection.feather) }
      })
    case "contract-selection":
      return mutateActiveDoc(state, (d) => {
        if (!d.selection.bounds) return d
        const base = selectionToMaskCanvas(d.width, d.height, d.selection)
        if (!base) return d
        const amount = Math.round(action.amount)
        const mask = amount >= 0 ? contractSelectionMask(base, amount) : expandSelectionMask(base, -amount)
        return { ...d, selection: selectionFromMask(mask, "freehand", d.selection.feather) }
      })
    case "grow-similar-selection":
      return mutateActiveDoc(state, (d) => {
        if (!d.selection.bounds) return d
        const activeLayer = d.layers.find((l) => l.id === d.activeLayerId)
        if (!activeLayer || typeof activeLayer.canvas.getContext !== "function") return d
        const baseMask = selectionToMaskCanvas(d.width, d.height, d.selection)
        if (!baseMask) return d
        const maskImg = baseMask.getContext("2d")!.getImageData(0, 0, d.width, d.height)
        const src = activeLayer.canvas.getContext("2d")!.getImageData(0, 0, d.width, d.height)
        const selected = new Uint8Array(d.width * d.height)
        let rSum = 0, gSum = 0, bSum = 0, count = 0
        for (let i = 0; i < selected.length; i++) {
          const p = i * 4
          if (maskImg.data[p + 3] > 8 && src.data[p + 3] > 0) {
            selected[i] = 1
            rSum += src.data[p]
            gSum += src.data[p + 1]
            bSum += src.data[p + 2]
            count++
          }
        }
        if (!count) return d
        const target = { r: rSum / count, g: gSum / count, b: bSum / count }
        const tol = Math.max(0, Math.min(255, action.tolerance))
        const passes = Math.max(1, Math.min(256, Math.round(action.iterations ?? Math.max(4, tol / 8))))
        const withinTolerance = (index: number) => {
          const p = index * 4
          if (src.data[p + 3] === 0) return false
          return (
            Math.abs(src.data[p] - target.r) <= tol &&
            Math.abs(src.data[p + 1] - target.g) <= tol &&
            Math.abs(src.data[p + 2] - target.b) <= tol
          )
        }
        for (let pass = 0; pass < passes; pass++) {
          const additions: number[] = []
          for (let y = 0; y < d.height; y++) {
            for (let x = 0; x < d.width; x++) {
              const idx = y * d.width + x
              if (selected[idx] || !withinTolerance(idx)) continue
              const touches =
                (x > 0 && selected[idx - 1]) ||
                (x < d.width - 1 && selected[idx + 1]) ||
                (y > 0 && selected[idx - d.width]) ||
                (y < d.height - 1 && selected[idx + d.width])
              if (touches) additions.push(idx)
            }
          }
          if (!additions.length) break
          for (const idx of additions) selected[idx] = 1
        }
        const out = makeCanvas(d.width, d.height)
        const ctx = out.getContext("2d")!
        const img = ctx.createImageData(d.width, d.height)
        for (let i = 0; i < selected.length; i++) {
          const p = i * 4
          img.data[p] = 255
          img.data[p + 1] = 255
          img.data[p + 2] = 255
          img.data[p + 3] = selected[i] ? 255 : 0
        }
        ctx.putImageData(img, 0, 0)
        return { ...d, selection: selectionFromMask(out, "wand", d.selection.feather) }
      })
    case "similar-selection":
      return mutateActiveDoc(state, (d) => {
        if (!d.selection.bounds) return d
        const activeLayer = d.layers.find((l) => l.id === d.activeLayerId)
        if (!activeLayer || typeof activeLayer.canvas.getContext !== "function") return d
        const tol = action.tolerance
        const maskCanvas = selectionToMaskCanvas(d.width, d.height, d.selection)
        if (!maskCanvas) return d
        const selectionMask = maskCanvas.getContext("2d")!.getImageData(0, 0, d.width, d.height)
        const src = activeLayer.canvas.getContext("2d")!.getImageData(0, 0, d.width, d.height)
        const out = new Uint8ClampedArray(src.data.length)
        let rSum = 0, gSum = 0, bSum = 0, count = 0
        for (let i = 0; i < src.data.length; i += 4) {
          if (selectionMask.data[i + 3] > 0 && src.data[i + 3] > 0) {
            rSum += src.data[i]
            gSum += src.data[i + 1]
            bSum += src.data[i + 2]
            count++
          }
        }
        if (count === 0) return d
        const rAvg = Math.round(rSum / count)
        const gAvg = Math.round(gSum / count)
        const bAvg = Math.round(bSum / count)
        // Build new mask: pixel is selected if its color is within tolerance of the average.
        for (let i = 0; i < src.data.length; i += 4) {
          const r = src.data[i]
          const g = src.data[i + 1]
          const b = src.data[i + 2]
          const a = src.data[i + 3]
          if (a === 0) {
            out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0
            continue
          }
          const dr = Math.abs(r - rAvg)
          const dg = Math.abs(g - gAvg)
          const db = Math.abs(b - bAvg)
          if (dr <= tol && dg <= tol && db <= tol) {
            out[i] = 255
            out[i + 1] = 255
            out[i + 2] = 255
            out[i + 3] = 255
          } else {
            out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0
          }
        }
        const newMask = makeCanvas(d.width, d.height)
        newMask.getContext("2d")!.putImageData(new ImageData(out, d.width, d.height), 0, 0)
        return { ...d, selection: selectionFromMask(newMask, "wand") }
      })
    case "transform-selection":
      return mutateActiveDoc(state, (d) => {
        if (!d.selection.bounds) return d
        const base = selectionToMaskCanvas(d.width, d.height, d.selection)
        if (!base) return d
        const clampedScale = Math.max(0.01, Math.min(20, action.scale))
        const next = transformSelectionMask(
          base,
          d.selection.bounds,
          clampedScale,
          Math.max(-360, Math.min(360, action.rotationDeg)),
          action.smoothing ?? true,
          {
            scaleX: action.scaleX !== undefined ? Math.max(0.01, Math.min(20, action.scaleX)) : undefined,
            scaleY: action.scaleY !== undefined ? Math.max(0.01, Math.min(20, action.scaleY)) : undefined,
            translateX: action.translateX,
            translateY: action.translateY,
          },
        )
        return { ...d, selection: selectionFromMask(next, "freehand", d.selection.feather) }
      })
    case "stamp-visible":
      return mutateActiveDoc(state, (d) => {
        const stamp = makeCanvas(d.width, d.height)
        const sctx = stamp.getContext("2d")!
        for (const l of d.layers) {
          if (!l.visible) continue
          if (typeof l.canvas.getContext !== "function") continue
          compositeLayer(sctx, l.canvas, l.blendMode, l.opacity, l.fillOpacity ?? 1)
        }
        const newId = makeId("layer")
        const newLayer: Layer = {
          id: newId,
          name: "Stamp Visible",
          kind: "raster",
          visible: true,
          locked: false,
          opacity: 1,
          fillOpacity: 1,
          blendMode: "normal",
          canvas: stamp,
        }
        return {
          ...d,
          layers: [...d.layers, newLayer],
          activeLayerId: newId,
          selectedLayerIds: [newId],
        }
      })
    case "toggle-layer-lock-transparency":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id ? { ...l, lockTransparency: !l.lockTransparency } : l,
        ),
      }))
    case "toggle-layer-lock-draw":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id ? { ...l, lockDraw: !l.lockDraw } : l,
        ),
      }))
    case "toggle-layer-lock-move":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id ? { ...l, lockMove: !l.lockMove } : l,
        ),
      }))
    case "toggle-layer-lock-all":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id ? { ...l, lockAll: !l.lockAll, locked: !l.lockAll } : l,
        ),
      }))
    case "feather-selection":
      return mutateActiveDoc(state, (d) => {
        const base = selectionToMaskCanvas(d.width, d.height, d.selection)
        if (!base) return d
        const r = Math.max(0, action.radius)
        const next = featherMask(base, r)
        return { ...d, selection: selectionFromMask(next, "freehand", r) }
      })
    case "border-selection":
      return mutateActiveDoc(state, (d) => {
        const base = selectionToMaskCanvas(d.width, d.height, d.selection)
        if (!base) return d
        const next = borderSelectionMask(base, Math.max(1, action.width))
        return { ...d, selection: selectionFromMask(next, "freehand") }
      })
    case "smooth-selection":
      return mutateActiveDoc(state, (d) => {
        const base = selectionToMaskCanvas(d.width, d.height, d.selection)
        if (!base) return d
        const next = smoothSelectionMask(base, Math.max(1, action.radius))
        return { ...d, selection: selectionFromMask(next, "freehand", d.selection.feather) }
      })
    case "save-selection": {
      // Optionally route the saved channel into another open document (used by
      // the Save Selection dialog's Document destination dropdown).
      const targetId = action.targetDocId ?? state.activeDocId
      if (!targetId) return state
      return {
        ...state,
        documents: state.documents.map((d) =>
          d.id === targetId ? { ...d, channels: [...(d.channels ?? []), action.channel] } : d,
        ),
      }
    }
    case "load-selection": {
      // Optionally read the source channel from another open document so the
      // active document can pull in a saved selection from anywhere.
      const sourceDoc = action.sourceDocId
        ? state.documents.find((d) => d.id === action.sourceDocId)
        : null
      return mutateActiveDoc(state, (d) => {
        const channelOwner = sourceDoc ?? d
        const ch = (channelOwner.channels ?? []).find((c) => c.id === action.channelId)
        if (!ch) return d
        // When pulling from another doc, only accept channels whose canvas
        // matches our document dimensions; otherwise the selection mask would
        // be garbage.
        if (sourceDoc && (ch.canvas.width !== d.width || ch.canvas.height !== d.height)) return d
        return { ...d, selection: selectionFromMask(combineSelectionWithChannel(d, ch, action.mode, action.invert), "freehand") }
      })
    }
    case "update-channel": {
      const targetId = action.targetDocId ?? state.activeDocId
      if (!targetId) return state
      return {
        ...state,
        documents: state.documents.map((d) =>
          d.id === targetId
            ? {
                ...d,
                channels: (d.channels ?? []).map((channel) =>
                  channel.id === action.channelId ? { ...channel, ...action.patch } : channel,
                ),
              }
            : d,
        ),
      }
    }
    case "delete-channel":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        channels: (d.channels ?? []).filter((c) => c.id !== action.channelId),
      }))
    case "mark-document-dirty":
      return withDocumentLifecyclePatch(state, action.id, { dirty: true })
    case "mark-document-saved":
      return withDocumentLifecyclePatch(state, action.id, {
        dirty: false,
        savedAt: now(),
        savedHistoryIndex: currentHistoryIndex(state, action.id),
        ...action.lifecycle,
      })
    case "set-document-lifecycle":
      return withDocumentLifecyclePatch(state, action.id, action.lifecycle)
    default:
      return state
  }
}
