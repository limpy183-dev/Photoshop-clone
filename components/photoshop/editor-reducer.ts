import { compositeLayer } from "./blend-modes"
import { makeCanvas } from "./canvas-utils"
import {
cloneCanvas,
cloneLayerIntoDocument,
deepClonePlain
} from "./editor-document-cloning"
import {
makeDocumentLifecycle
} from "./editor-document-lifecycle"
import {
releaseEntriesBlobs,
scheduleHistoryCompression
} from "./editor-history-storage"
import {
fillMaskCanvas,
invertMaskCanvas,
normalizeAdvancedBlending,
normalizeGuide
} from "./layer-workflows"
import { createSmartObjectSource,markSmartObjectLinked,replaceSmartObjectContents } from "./smart-objects"
import {
rasterizeShape,
rasterizeText
} from "./tool-helpers"
import type {
BlendMode,
HistorySnapshot,
Layer
} from "./types"
import { uid } from "./uid"

import { reduceEditorStateLate } from "./editor-reducer-late"
import { Action,applyBrushPreset,blocksLayerMove,clamp,isLayerLocked,mutateActiveDoc,type DocHistory,type DocumentLifecycleState,type EditorState,type EditorTransitionEffect,type EditorTransitionEffectServices,type EditorTransitionServices } from "./editor-reducer-model"

export * from "./editor-reducer-model"

function reduceEditorState(
  state: EditorState,
  action: Action,
  effects: EditorTransitionEffect[],
  services: EditorTransitionServices = {},
): EditorState {
  const makeId = services.makeId ?? uid
  const now = services.now ?? Date.now
  switch (action.type) {
    case "hydrate-settings":
      return { ...state, ...action.settings }
    case "set-tool":
      return { ...state, tool: action.tool }
    case "set-active-smart-filter-mask":
      return { ...state, activeSmartFilterMaskTarget: action.target }
    case "set-foreground":
      return { ...state, foreground: action.color }
    case "set-background":
      return { ...state, background: action.color }
    case "swap-colors":
      return { ...state, foreground: state.background, background: state.foreground }
    case "reset-colors":
      return { ...state, foreground: "#000000", background: "#ffffff" }
    case "set-brush":
      return { ...state, brush: { ...state.brush, ...action.brush } }
    case "set-gradient":
      return { ...state, gradient: { ...state.gradient, ...action.gradient } }
    case "set-paint-bucket":
      return { ...state, paintBucket: { ...state.paintBucket, ...action.paintBucket } }
    case "set-eraser":
      return { ...state, eraser: { ...state.eraser, ...action.eraser } }
    case "set-clone-source":
      return { ...state, cloneSource: { ...state.cloneSource, ...action.cloneSource } }
    case "set-selection-options":
      return { ...state, selectionOptions: { ...state.selectionOptions, ...action.selectionOptions } }
    case "set-symmetry":
      return { ...state, symmetry: { ...state.symmetry, ...action.symmetry } }
    case "set-transform":
      return { ...state, transform: action.transform }
    case "clear-transform":
      return { ...state, transform: null }
    case "apply-brush-preset":
      return {
        ...state,
        brush: applyBrushPreset(state.brush, action.preset),
      }
    case "add-brush-preset":
      return { ...state, brushPresets: [...state.brushPresets, action.preset] }
    case "remove-brush-preset":
      return { ...state, brushPresets: state.brushPresets.filter((p) => p.id !== action.id) }
    case "set-brush-presets":
      return { ...state, brushPresets: action.presets }
    case "new-document":
      return {
        ...state,
        documents: [...state.documents, action.doc],
        activeDocId: action.doc.id,
        histories: {
          ...state.histories,
          [action.doc.id]: { entries: [action.entry], index: 0 },
        },
        snapshots: {
          ...state.snapshots,
          [action.doc.id]: [],
        },
        documentLifecycle: {
          ...state.documentLifecycle,
          [action.doc.id]: makeDocumentLifecycle(action.doc, 0, action.lifecycle),
        },
        closedDocuments: state.closedDocuments.filter((record) => record.doc.id !== action.doc.id),
      }
    case "replace-startup-document":
      return {
        ...state,
        documents: [action.doc],
        activeDocId: action.doc.id,
        histories: {
          [action.doc.id]: { entries: [action.entry], index: 0 },
        },
        snapshots: {
          [action.doc.id]: [],
        },
        documentLifecycle: {
          [action.doc.id]: makeDocumentLifecycle(action.doc, 0, action.lifecycle),
        },
        closedDocuments: [],
      }
    case "close-document": {
      const closing = state.documents.find((d) => d.id === action.id)
      const docs = state.documents.filter((d) => d.id !== action.id)
      const activeDocId =
        state.activeDocId === action.id ? docs[docs.length - 1]?.id ?? null : state.activeDocId
      const histories = { ...state.histories }
      delete histories[action.id]
      const snapshots = { ...state.snapshots }
      delete snapshots[action.id]
      const documentLifecycle = { ...state.documentLifecycle }
      const closingLifecycle = documentLifecycle[action.id]
      delete documentLifecycle[action.id]
      const closedDocuments = closing
        ? [
            {
              id: makeId("closed"),
              doc: closing,
              history: state.histories[action.id],
              snapshots: state.snapshots[action.id] ?? [],
              lifecycle: closingLifecycle,
              closedAt: now(),
            },
            ...state.closedDocuments.filter((record) => record.doc.id !== closing.id),
          ].slice(0, 12)
        : state.closedDocuments
      return { ...state, documents: docs, activeDocId, histories, snapshots, documentLifecycle, closedDocuments }
    }
    case "close-other-documents": {
      const keep = state.documents.find((d) => d.id === action.keepId)
      if (!keep) return state
      const closing = state.documents.filter((d) => d.id !== action.keepId)
      const histories: Record<string, DocHistory> = state.histories[keep.id]
        ? { [keep.id]: state.histories[keep.id] }
        : {}
      const snapshots: Record<string, HistorySnapshot[]> = { [keep.id]: state.snapshots[keep.id] ?? [] }
      const documentLifecycle: Record<string, DocumentLifecycleState> = state.documentLifecycle[keep.id]
        ? { [keep.id]: state.documentLifecycle[keep.id] }
        : {}
      const closedDocuments = [
        ...closing.map((doc) => ({
          id: makeId("closed"),
          doc,
          history: state.histories[doc.id],
          snapshots: state.snapshots[doc.id] ?? [],
          lifecycle: state.documentLifecycle[doc.id],
          closedAt: now(),
        })),
        ...state.closedDocuments,
      ].slice(0, 12)
      return { ...state, documents: [keep], activeDocId: keep.id, histories, snapshots, documentLifecycle, closedDocuments }
    }
    case "reopen-closed-document": {
      const index = action.id
        ? state.closedDocuments.findIndex((record) => record.id === action.id)
        : 0
      const record = state.closedDocuments[index]
      if (!record) return state
      const closedDocuments = state.closedDocuments.filter((_, i) => i !== index)
      return {
        ...state,
        documents: [...state.documents.filter((doc) => doc.id !== record.doc.id), record.doc],
        activeDocId: record.doc.id,
        histories: record.history
          ? { ...state.histories, [record.doc.id]: record.history }
          : state.histories,
        snapshots: { ...state.snapshots, [record.doc.id]: record.snapshots },
        documentLifecycle: {
          ...state.documentLifecycle,
          [record.doc.id]: record.lifecycle ?? makeDocumentLifecycle(record.doc, record.history?.index ?? 0),
        },
        closedDocuments,
      }
    }
    case "move-layers-to-document": {
      if (action.sourceDocId === action.targetDocId || !action.layerIds.length) return state
      const source = state.documents.find((doc) => doc.id === action.sourceDocId)
      const target = state.documents.find((doc) => doc.id === action.targetDocId)
      if (!source || !target) return state
      const ids = new Set(action.layerIds)
      const layersToMove = source.layers.filter((layer) => ids.has(layer.id) && layer.kind !== "group")
      if (!layersToMove.length) return state
      const copied = layersToMove.map((layer) => cloneLayerIntoDocument(layer, target.width, target.height, source.width, source.height))
      const documents = state.documents.map((doc) => {
        if (doc.id === target.id) {
          const selectedLayerIds = copied.map((layer) => layer.id)
          return {
            ...doc,
            layers: [...doc.layers, ...copied],
            activeLayerId: selectedLayerIds[selectedLayerIds.length - 1] ?? doc.activeLayerId,
            selectedLayerIds,
          }
        }
        if (!action.copy && doc.id === source.id && source.layers.length > layersToMove.length) {
          const remaining = doc.layers.filter((layer) => !ids.has(layer.id))
          const activeLayerId = remaining.some((layer) => layer.id === doc.activeLayerId)
            ? doc.activeLayerId
            : remaining[remaining.length - 1].id
          return {
            ...doc,
            layers: remaining,
            activeLayerId,
            selectedLayerIds: [activeLayerId],
          }
        }
        return doc
      })
      return { ...state, documents, activeDocId: target.id }
    }
    case "activate-document":
      return { ...state, activeDocId: action.id }
    case "set-zoom":
      return mutateActiveDoc(state, (d) => ({ ...d, zoom: clamp(action.zoom, 0.05, 32) }))
    case "set-rotation":
      return mutateActiveDoc(state, (d) => ({ ...d, rotation: action.rotation }))
    case "toggle-grid":
      return mutateActiveDoc(state, (d) => ({ ...d, showGrid: !d.showGrid }))
    case "set-grid-size":
      return mutateActiveDoc(state, (d) => ({ ...d, gridSize: Math.max(2, action.size) }))
    case "set-ruler-units":
      return mutateActiveDoc(state, (d) => ({ ...d, rulerUnits: action.units }))
    case "set-grid-color":
      return mutateActiveDoc(state, (d) => ({ ...d, gridColor: action.color }))
    case "set-grid-subdivisions":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        gridSubdivisions: clamp(Math.round(action.subdivisions), 1, 16),
      }))
    case "set-grid-opacity":
      return mutateActiveDoc(state, (d) => ({ ...d, gridOpacity: clamp(action.opacity, 0.05, 1) }))
    case "toggle-pixel-grid":
      return mutateActiveDoc(state, (d) => ({ ...d, showPixelGrid: !d.showPixelGrid }))
    case "toggle-snap":
      return mutateActiveDoc(state, (d) => ({ ...d, snap: !d.snap }))
    case "toggle-snap-grid":
      return mutateActiveDoc(state, (d) => ({ ...d, snapToGrid: !d.snapToGrid }))
    case "toggle-snap-guides":
      return mutateActiveDoc(state, (d) => ({ ...d, snapToGuides: !d.snapToGuides }))
    case "set-show-smart-guides":
      return mutateActiveDoc(state, (d) => ({ ...d, showSmartGuides: action.show }))
    case "add-guide":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        guides: [...(d.guides ?? []), normalizeGuide(action.guide, d.width, d.height)],
      }))
    case "update-guide":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        guides: (d.guides ?? []).map((g) =>
          g.id === action.id ? normalizeGuide({ ...g, ...action.patch }, d.width, d.height) : g,
        ),
      }))
    case "update-guide-state":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        guides: (d.guides ?? []).map((g) =>
          g.id === action.id ? normalizeGuide({ ...g, ...action.patch }, d.width, d.height) : g,
        ),
      }))
    case "move-guide":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        guides: (d.guides ?? []).map((g) =>
          g.id === action.id && !g.locked
            ? normalizeGuide({ ...g, position: action.position }, d.width, d.height)
            : g,
        ),
      }))
    case "remove-guide":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        guides: (d.guides ?? []).filter((g) => g.id !== action.id || g.locked),
      }))
    case "clear-guides":
      return mutateActiveDoc(state, (d) => ({ ...d, guides: [] }))
    case "set-quick-mask":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        quickMask: action.on,
        quickMaskCanvas: action.canvas !== undefined ? action.canvas : d.quickMaskCanvas,
      }))
    case "set-quick-mask-paint-mode":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        quickMaskPaintMode: action.mode,
      }))
    case "set-selection":
      return mutateActiveDoc(state, (d) => ({ ...d, selection: action.selection }))
    case "add-layer":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: [...d.layers, action.layer],
        activeLayerId: action.layer.id,
        selectedLayerIds: [action.layer.id],
      }))
    case "remove-layer":
      return mutateActiveDoc(state, (d) => {
        if (d.layers.length <= 1) return d
        const target = d.layers.find((l) => l.id === action.id)
        if (isLayerLocked(target)) return d
        const layers = d.layers.filter((l) => l.id !== action.id)
        const activeLayerId =
          d.activeLayerId === action.id ? layers[layers.length - 1].id : d.activeLayerId
        return {
          ...d,
          layers,
          activeLayerId,
          selectedLayerIds: d.selectedLayerIds.filter((id) => id !== action.id).concat(
            d.selectedLayerIds.includes(action.id) ? [activeLayerId] : [],
          ),
        }
      })
    case "duplicate-layer":
      return mutateActiveDoc(state, (d) => {
        const idx = d.layers.findIndex((l) => l.id === action.id)
        if (idx < 0) return d
        const src = d.layers[idx]
        const newCanvas = makeCanvas(d.width, d.height)
        newCanvas.getContext?.("2d")?.drawImage(src.canvas, 0, 0)
        const copy: Layer = {
          ...src,
          id: makeId("layer"),
          name: `${src.name} copy`,
          locked: false,
          canvas: newCanvas,
          mask: src.mask ? cloneCanvas(src.mask) ?? undefined : undefined,
          maskEnabled: src.maskEnabled,
          threeD: src.threeD ? deepClonePlain(src.threeD) : undefined,
          video: src.video ? deepClonePlain(src.video) : undefined,
          linkGroupId: undefined,
        }
        const layers = [...d.layers.slice(0, idx + 1), copy, ...d.layers.slice(idx + 1)]
        return {
          ...d,
          layers,
          activeLayerId: copy.id,
          selectedLayerIds: [copy.id],
        }
      })
    case "set-active-layer": {
      const next = mutateActiveDoc(state, (d) => ({
        ...d,
        activeLayerId: action.id,
        selectedLayerIds: [action.id],
      }))
      return {
        ...next,
        activeSmartFilterMaskTarget:
          state.activeSmartFilterMaskTarget?.layerId === action.id ? state.activeSmartFilterMaskTarget : null,
      }
    }
    case "set-selected-layers": {
      const next = mutateActiveDoc(state, (d) => ({
        ...d,
        activeLayerId: action.activeId,
        selectedLayerIds: action.ids.length ? action.ids : [action.activeId],
      }))
      return {
        ...next,
        activeSmartFilterMaskTarget:
          state.activeSmartFilterMaskTarget?.layerId === action.activeId ? state.activeSmartFilterMaskTarget : null,
      }
    }
    case "toggle-layer-visibility":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, visible: !l.visible } : l)),
      }))
    case "set-layer-visibility":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, visible: action.visible } : l)),
      }))
    case "toggle-layer-lock":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id ? { ...l, locked: !l.locked } : l)),
      }))
    case "toggle-layer-clipped":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, clipped: !l.clipped } : l)),
      }))
    case "set-layer-opacity":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && !isLayerLocked(l) ? { ...l, opacity: clamp(action.opacity, 0, 1) } : l,
        ),
      }))
    case "set-layer-fill-opacity":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && !isLayerLocked(l) ? { ...l, fillOpacity: clamp(action.fillOpacity, 0, 1) } : l,
        ),
      }))
    case "set-layer-blend":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, blendMode: action.blendMode } : l)),
      }))
    case "set-layer-advanced-blending":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && !isLayerLocked(l)
            ? { ...l, advancedBlending: action.advancedBlending ? normalizeAdvancedBlending(action.advancedBlending) : undefined }
            : l,
        ),
      }))
    case "set-layer-style":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, style: action.style } : l)),
      }))
    case "set-layer-mask":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, mask: action.mask, maskEnabled: action.mask ? l.maskEnabled ?? true : undefined } : l)),
      }))
    case "set-layer-mask-enabled":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, maskEnabled: action.enabled } : l)),
      }))
    case "fill-layer-mask":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && !isLayerLocked(l)
            ? {
                ...l,
                mask: fillMaskCanvas(d.width, d.height, action.value),
                maskEnabled: true,
              }
            : l,
        ),
      }))
    case "invert-layer-mask":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && l.mask && !isLayerLocked(l)
            ? { ...l, mask: invertMaskCanvas(l.mask), maskEnabled: true }
            : l,
        ),
      }))
    case "set-layer-text":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => {
          if (l.id !== action.id) return l
          if (isLayerLocked(l) || l.lockDraw) return l
          if (typeof l.canvas.getContext !== "function") {
            return { ...l, text: action.text }
          }
          // Allocate a fresh canvas for the rasterized text so any
          // history snapshots that reference the previous l.canvas
          // remain pixel-stable. Mutating l.canvas in place would
          // silently corrupt those snapshots.
          const next = makeCanvas(l.canvas.width, l.canvas.height)
          if (action.text) rasterizeText(next, action.text)
          return { ...l, canvas: next, text: action.text }
        }),
      }))
    case "set-layer-shape":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => {
          if (l.id !== action.id) return l
          if (isLayerLocked(l) || l.lockDraw) return l
          if (typeof l.canvas.getContext !== "function") {
            return { ...l, shape: action.shape }
          }
          // Same rationale as set-layer-text: rasterize onto a new
          // canvas to avoid mutating canvases referenced by history.
          const next = makeCanvas(l.canvas.width, l.canvas.height)
          rasterizeShape(next, action.shape)
          return { ...l, canvas: next, shape: action.shape }
        }),
      }))
    case "set-layer-path":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, path: action.path } : l)),
      }))
    case "set-layer-kind":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, kind: action.kind } : l)),
      }))
    case "set-layer-3d":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id ? { ...l, kind: action.scene ? "3d" : l.kind, threeD: action.scene } : l,
        ),
      }))
    case "set-layer-video":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id ? { ...l, kind: action.video ? "video" : l.kind, video: action.video } : l,
        ),
      }))
    case "set-layer-smart":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && !isLayerLocked(l)
            ? {
                ...l,
                kind: action.smart ? "smart-object" : l.kind === "smart-object" ? "raster" : l.kind,
                smartObject: action.smart,
                smartSource: action.smart
                  ? createSmartObjectSource(l.canvas, {
                      name: l.name,
                      linkType: "embedded",
                      status: "embedded",
                      embedded: true,
                    })
                  : undefined,
              }
            : l,
        ),
      }))
    case "set-layer-smart-link":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && !isLayerLocked(l)
            ? markSmartObjectLinked(l, action.source)
            : l,
        ),
      }))
    case "set-layer-smart-link-status":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && (l.smartObject || l.kind === "smart-object") && !isLayerLocked(l)
            ? {
                ...l,
                smartSource: l.smartSource
                  ? { ...l.smartSource, status: action.status }
                  : createSmartObjectSource(l.canvas, { name: l.name, status: action.status }),
              }
            : l,
        ),
      }))
    case "apply-linked-smart-object-sync":
      return {
        ...state,
        documents: state.documents.map((d) =>
          d.id === action.docId
            ? {
                ...d,
                layers: d.layers.map((l) =>
                  l.id === action.id && (l.smartObject || l.kind === "smart-object")
                    ? markSmartObjectLinked(l, action.source)
                    : l,
                ),
              }
            : d,
        ),
      }
    case "replace-smart-object-contents":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && !isLayerLocked(l)
            ? replaceSmartObjectContents(l, action.canvas, action.source)
            : l,
        ),
      }))
    case "update-smart-object-parent": {
      const source = cloneCanvas(action.canvas)
      const documents = state.documents.map((doc) => {
        if (doc.id !== action.parentDocId) return doc
        return {
          ...doc,
          layers: doc.layers.map((layer) => {
            if (layer.id !== action.layerId) return layer
            const canvas = makeCanvas(doc.width, doc.height)
            const ctx = canvas.getContext("2d")!
            ctx.drawImage(action.canvas, 0, 0)
            const smartSource: NonNullable<Layer["smartSource"]> = {
              ...(layer.smartSource ?? {}),
              width: action.canvas.width,
              height: action.canvas.height,
              canvas: source,
              status: layer.smartSource?.linkType === "linked" ? "modified" : "current",
              updatedAt: now(),
            }
            return {
              ...layer,
              kind: "smart-object" as const,
              smartObject: true,
              canvas,
              smartSource,
            }
          }),
        }
      })
      return { ...state, documents, activeDocId: action.parentDocId }
    }
    case "set-smart-object-edit-package":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) =>
          l.id === action.id && (l.smartObject || l.kind === "smart-object") && !isLayerLocked(l)
            ? {
                ...l,
                kind: "smart-object",
                smartObject: true,
                smartSource: {
                  ...(l.smartSource ?? createSmartObjectSource(l.canvas, { name: l.name })),
                  editPackage: action.editPackage ? deepClonePlain(action.editPackage) : undefined,
                  updatedAt: now(),
                },
              }
            : l,
        ),
      }))
    case "rename-layer":
      return mutateActiveDoc(state, (d) => ({
        ...d,
        layers: d.layers.map((l) => (l.id === action.id && !isLayerLocked(l) ? { ...l, name: action.name } : l)),
      }))
    case "move-layer":
      return mutateActiveDoc(state, (d) => {
        const idx = d.layers.findIndex((l) => l.id === action.id)
        if (idx < 0) return d
        if (blocksLayerMove(d.layers[idx])) return d
        const swap = action.direction === "up" ? idx + 1 : idx - 1
        if (swap < 0 || swap >= d.layers.length) return d
        const layers = [...d.layers]
        ;[layers[idx], layers[swap]] = [layers[swap], layers[idx]]
        return { ...d, layers }
      })
    case "merge-down":
      return mutateActiveDoc(state, (d) => {
        const idx = d.layers.findIndex((l) => l.id === action.id)
        if (idx <= 0) return d
        const top = d.layers[idx]
        const below = d.layers[idx - 1]
        if (isLayerLocked(top) || isLayerLocked(below)) return d
        // Composite onto a fresh clone of `below.canvas` so any history
        // snapshot still pointing at the old `below.canvas` reference
        // keeps its original pixels. Writing to `below.canvas` in place
        // would silently corrupt those snapshots and the next undo to
        // a snapshot taken before the merge would show the merged
        // result instead of the original layers.
        const mergedCanvas = cloneCanvas(below.canvas) ?? makeCanvas(d.width, d.height)
        const ctx = mergedCanvas.getContext?.("2d")
        if (ctx) {
          compositeLayer(ctx, top.canvas, top.blendMode, top.opacity, top.fillOpacity ?? 1)
        }
        const layers = d.layers
          .filter((_, i) => i !== idx)
          .map((l) => (l.id === below.id ? { ...l, canvas: mergedCanvas } : l))
        return { ...d, layers, activeLayerId: below.id, selectedLayerIds: [below.id] }
      })
    case "merge-selected":
      return mutateActiveDoc(state, (d) => {
        if (d.selectedLayerIds.length < 2) return d
        if (d.layers.some((layer) => d.selectedLayerIds.includes(layer.id) && isLayerLocked(layer))) return d
        const indices = d.selectedLayerIds
          .map((id) => d.layers.findIndex((l) => l.id === id))
          .filter((i) => i >= 0)
          .sort((a, b) => a - b)
        if (indices.length < 2) return d
        const baseIdx = indices[0]
        const baseLayer = d.layers[baseIdx]
        const merged = makeCanvas(d.width, d.height)
        const mctx = merged.getContext?.("2d")
        if (mctx) {
          for (const i of indices) {
            const l = d.layers[i]
            compositeLayer(mctx, l.canvas, l.blendMode, l.opacity, l.fillOpacity ?? 1)
          }
        }
        const layers = d.layers
          .filter((_, i) => !indices.includes(i) || i === baseIdx)
          .map((l) =>
            l.id === baseLayer.id
              ? { ...l, canvas: merged, blendMode: "normal" as BlendMode, opacity: 1 }
              : l,
          )
        return {
          ...d,
          layers,
          activeLayerId: baseLayer.id,
          selectedLayerIds: [baseLayer.id],
        }
      })
    case "flatten":
      return mutateActiveDoc(state, (d) => {
        const flat = makeCanvas(d.width, d.height, d.background)
        const ctx = flat.getContext?.("2d")
        if (ctx) {
          for (const l of d.layers) {
            if (!l.visible) continue
            compositeLayer(ctx, l.canvas, l.blendMode, l.opacity, l.fillOpacity ?? 1)
          }
        }
        const layer: Layer = {
          id: makeId("layer"),
          name: "Background",
          kind: "raster",
          visible: true,
          locked: true,
          opacity: 1,
          blendMode: "normal",
          canvas: flat,
        }
        return { ...d, layers: [layer], activeLayerId: layer.id, selectedLayerIds: [layer.id] }
      })
    default:
      return reduceEditorStateLate(state, action, effects, services, makeId, now)
  }
}

export function transitionEditorState(
  state: EditorState,
  action: Action,
  services: EditorTransitionServices = {},
): {
  state: EditorState
  effects: EditorTransitionEffect[]
} {
  const effects: EditorTransitionEffect[] = []
  return {
    state: reduceEditorState(state, action, effects, services),
    effects,
  }
}

export function runEditorTransitionEffects(
  effects: readonly EditorTransitionEffect[],
  services: EditorTransitionEffectServices = {},
) {
  const releaseEntries = services.releaseEntries ?? releaseEntriesBlobs
  const scheduleCompression = services.scheduleCompression ?? scheduleHistoryCompression
  for (const effect of effects) {
    if (effect.type === "release-history-entries") {
      releaseEntries(effect.entries)
    } else if (effect.type === "schedule-history-compression") {
      scheduleCompression(effect.entries, effect.currentIndex)
    }
  }
}

export function reducer(state: EditorState, action: Action): EditorState {
  return transitionEditorState(state, action).state
}
