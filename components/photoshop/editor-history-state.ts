import { compositeLayer,getNativeComposite } from "./blend-modes"
import { makeCanvas } from "./canvas-utils"
import {
cloneCanvas,
cloneSmartFilters,
deepClonePlain
} from "./editor-document-cloning"
import {
adjacentRestoreRect,
canPatchSnapshot,
canReuseCanvasSnapshot,
cloneCanvasPatch,
drawSnapshotFull,
drawSnapshotRegion,
isLayerChangeHints,
normalizeDirtyRect,
snapshotPixelsEqual,
type ChangedLayerIds
} from "./editor-history-geometry"
import {
isCompressedCanvas
} from "./editor-history-storage"
import type {
HistoryEntry,
HistorySnapshot,
Layer,
LayerSnapshot,
PsDocument
} from "./types"
import { uid } from "./uid"

/* ----------------------------- helpers --------------------------------- */


export const EMPTY_HISTORY = Object.freeze({ entries: [] as HistoryEntry[], index: -1 }) as { entries: HistoryEntry[]; index: number }
export const EMPTY_SNAPSHOTS: HistorySnapshot[] = Object.freeze([]) as unknown as HistorySnapshot[]

/* --------------------------- snapshot api ------------------------------ */

export function snapshotLayers(
  doc: PsDocument,
  previousEntry?: HistoryEntry,
  changedLayerIds?: ChangedLayerIds,
): LayerSnapshot[] {
  const previousById = new Map(previousEntry?.layers.map((l) => [l.id, l]) ?? [])
  const changeHints = isLayerChangeHints(changedLayerIds) ? changedLayerIds : undefined
  const inferredChangedLayerIds =
    changedLayerIds === undefined
      ? new Set([doc.activeLayerId, ...doc.selectedLayerIds].filter(Boolean))
      : null
  const hintedChangedLayerIds = changeHints
    ? new Set(changeHints.ids ?? Object.keys(changeHints.bounds ?? {}))
    : null
  const changedSet =
    changedLayerIds === "all"
      ? null
      : Array.isArray(changedLayerIds)
        ? new Set(changedLayerIds)
        : hintedChangedLayerIds ?? inferredChangedLayerIds

  return doc.layers.map((l) => {
    const previous = previousById.get(l.id)
    const layerIsChanged =
      changedLayerIds === "all" || !previous || (changedSet ? changedSet.has(l.id) : true)
    const sourceCanvas = l.canvas
    const sourceMask = l.mask
    const sourceFrameImage = l.frame?.imageCanvas ?? null
    const sourceSmartSource = l.smartSource?.canvas ?? null
    const dirtyRect = normalizeDirtyRect(changeHints?.bounds?.[l.id], sourceCanvas.width, sourceCanvas.height)
    const patch =
      layerIsChanged && canPatchSnapshot(previous, sourceCanvas, dirtyRect)
        ? cloneCanvasPatch(sourceCanvas, dirtyRect!)
        : null
    const reuseCanvas =
      !!patch || (!layerIsChanged && canReuseCanvasSnapshot(previous?.canvas, sourceCanvas))
    const reuseMask =
      !layerIsChanged &&
      sourceMask &&
      previous?.mask &&
      canReuseCanvasSnapshot(previous.mask, sourceMask)
    const reuseFrameImage =
      !layerIsChanged &&
      sourceFrameImage &&
      previous?.frame?.imageCanvas &&
      canReuseCanvasSnapshot(previous.frame.imageCanvas, sourceFrameImage)
    const reuseSmartSource =
      !layerIsChanged &&
      sourceSmartSource &&
      previous?.smartSource?.canvas &&
      canReuseCanvasSnapshot(previous.smartSource.canvas, sourceSmartSource)

    const canvasPatches = patch
      ? [...(previous?.canvasPatches ?? []), patch]
      : reuseCanvas
        ? previous?.canvasPatches
        : undefined

    return {
      id: l.id,
      name: l.name,
      kind: l.kind,
      visible: l.visible,
      locked: l.locked,
      lockTransparency: l.lockTransparency,
      lockDraw: l.lockDraw,
      lockMove: l.lockMove,
      lockAll: l.lockAll,
      smartObject: l.smartObject,
      opacity: l.opacity,
      fillOpacity: l.fillOpacity,
      advancedBlending: l.advancedBlending ? deepClonePlain(l.advancedBlending) : undefined,
      blendMode: l.blendMode,
      linkGroupId: l.linkGroupId,
      canvas: reuseCanvas
        ? previous!.canvas
        : cloneCanvas(l.canvas),
      canvasPatches,
      mask: sourceMask
        ? reuseMask
          ? previous!.mask
          : cloneCanvas(sourceMask)
        : null,
      maskEnabled: l.maskEnabled,
      vectorMask: l.vectorMask ? deepClonePlain(l.vectorMask) : null,
      clipped: l.clipped,
      style: l.style ? deepClonePlain(l.style) : undefined,
      childIds: l.childIds ? [...l.childIds] : undefined,
      parentId: l.parentId,
      expanded: l.expanded,
      text: l.text ? deepClonePlain(l.text) : undefined,
      shape: l.shape ? { ...l.shape } : undefined,
      path: l.path ? deepClonePlain(l.path) : undefined,
      adjustment: l.adjustment ? deepClonePlain(l.adjustment) : undefined,
      frame: l.frame
        ? {
            ...l.frame,
            imageCanvas: sourceFrameImage
              ? reuseFrameImage
                ? previous!.frame!.imageCanvas
                : cloneCanvas(sourceFrameImage)
              : null,
          }
        : undefined,
      artboard: l.artboard ? { ...l.artboard } : undefined,
      threeD: l.threeD ? deepClonePlain(l.threeD) : undefined,
      video: l.video ? deepClonePlain(l.video) : undefined,
      colorLabel: l.colorLabel,
      smartFilters: cloneSmartFilters(l.smartFilters),
      smartSource: l.smartSource
        ? {
            ...l.smartSource,
            editPackage: l.smartSource.editPackage ? deepClonePlain(l.smartSource.editPackage) : undefined,
            width: l.smartSource.width,
            height: l.smartSource.height,
            canvas: sourceSmartSource
              ? reuseSmartSource
                ? previous!.smartSource!.canvas
                : cloneCanvas(sourceSmartSource)
              : null,
          }
        : undefined,
      notes: l.notes ? deepClonePlain(l.notes) : undefined,
      metadata: l.metadata ? deepClonePlain(l.metadata) : undefined,
    }
  })
}

function buildHistoryThumb(doc: PsDocument): string {
  if (typeof document === "undefined") return ""
  const t = document.createElement("canvas")
  const max = 32
  const ratio = Math.min(max / doc.width, max / doc.height)
  t.width = Math.max(1, Math.floor(doc.width * ratio))
  t.height = Math.max(1, Math.floor(doc.height * ratio))
  const ctx = t.getContext("2d")
  if (!ctx) return ""
  ctx.fillStyle = doc.background
  ctx.fillRect(0, 0, t.width, t.height)
  for (const l of doc.layers) {
    if (!l.visible) continue
    if (typeof l.canvas.getContext !== "function") continue
    ctx.save()
    ctx.globalAlpha = l.opacity * (l.fillOpacity ?? 1)
    ctx.globalCompositeOperation = getNativeComposite(l.blendMode) ?? "source-over"
    ctx.drawImage(l.canvas, 0, 0, t.width, t.height)
    ctx.restore()
  }
  try {
    return t.toDataURL("image/png")
  } catch {
    return ""
  }
}

const SKIP_HISTORY_THUMB_LABELS = new Set([
  "Brush Stroke",
  "Pencil",
  "Eraser",
  "Blur",
  "Sharpen",
  "Smudge",
  "Dodge",
  "Burn",
  "Sponge",
  "Clone Stamp",
  "History Brush",
  "Spot Healing",
  "Healing Brush",
  "Remove Tool",
])

export function makeHistoryEntry(
  doc: PsDocument,
  label: string,
  previousEntry?: HistoryEntry,
  changedLayerIds?: ChangedLayerIds,
): HistoryEntry {
  // Reuse previous auxiliary canvas clones if they haven't changed
  const reuseSelectionMask = previousEntry?.selection?.mask != null
    && doc.selection.mask === previousEntry.selection.mask
  const reuseQuickMask = previousEntry?.quickMaskCanvas != null
    && doc.quickMaskCanvas === previousEntry.quickMaskCanvas
  const reuseChannels = previousEntry?.channels != null
    && doc.channels === previousEntry.channels

  return {
    id: uid("h"),
    label,
    layers: snapshotLayers(doc, previousEntry, changedLayerIds),
    activeLayerId: doc.activeLayerId,
    selectedLayerIds: [...doc.selectedLayerIds],
    thumb: SKIP_HISTORY_THUMB_LABELS.has(label) ? previousEntry?.thumb : buildHistoryThumb(doc),
    width: doc.width,
    height: doc.height,
    selection: {
      ...doc.selection,
      mask: reuseSelectionMask
        ? previousEntry!.selection!.mask
        : doc.selection.mask ? cloneCanvas(doc.selection.mask) : null,
    },
    guides: doc.guides ? deepClonePlain(doc.guides) : undefined,
    comps: doc.comps ? deepClonePlain(doc.comps) : undefined,
    channels: reuseChannels
      ? previousEntry!.channels
      : doc.channels ? doc.channels.map(c => ({ ...c, canvas: cloneCanvas(c.canvas)! })) : undefined,
    notes: doc.notes ? deepClonePlain(doc.notes) : undefined,
    slices: doc.slices ? deepClonePlain(doc.slices) : undefined,
    counts: doc.counts ? deepClonePlain(doc.counts) : undefined,
    colorSamplers: doc.colorSamplers ? deepClonePlain(doc.colorSamplers) : undefined,
    quickMask: doc.quickMask,
    quickMaskCanvas: reuseQuickMask
      ? previousEntry!.quickMaskCanvas
      : doc.quickMaskCanvas ? cloneCanvas(doc.quickMaskCanvas) : null,
    quickMaskPaintMode: doc.quickMaskPaintMode ?? "auto",
    colorMode: doc.colorMode,
    modeSettings: doc.modeSettings ? deepClonePlain(doc.modeSettings) : undefined,
    variableDataSets: doc.variableDataSets ? deepClonePlain(doc.variableDataSets) : undefined,
    assetLibrary: doc.assetLibrary ? deepClonePlain(doc.assetLibrary) : undefined,
  }
}

export function restoreFromEntry(
  doc: PsDocument,
  entry: HistoryEntry,
  options?: { currentEntry?: HistoryEntry; direction?: "undo" | "redo" | null },
): Layer[] {
  const currentById = new Map(options?.currentEntry?.layers.map((l) => [l.id, l]) ?? [])
  return entry.layers.map((snap) => {
    const existing = doc.layers.find((l) => l.id === snap.id)
    const currentSnap = currentById.get(snap.id)
    const canvas =
      existing && existing.canvas.width === doc.width && existing.canvas.height === doc.height
        ? existing.canvas
        : makeCanvas(doc.width, doc.height)
    const ctx = canvas.getContext?.("2d")
    // If the snapshot's canvas is still a compressed placeholder (i.e. the
    // caller failed to decompress or the blob was evicted), DON'T draw it
    // onto the layer — that would replace the live pixels with a 1×1
    // garbage canvas. Skipping the draw preserves whatever the layer
    // currently shows, which is the safest behaviour when history pixel
    // data is unrecoverable. The rest of the snapshot's metadata
    // (visibility, blend mode, transform, etc.) is still applied below.
    const snapPixelsAvailable = !!snap.canvas && !isCompressedCanvas(snap.canvas)
    if (ctx && snapPixelsAvailable) {
      // When there is no existing layer (e.g. redo after creating a new layer),
      // always draw the full snapshot to ensure the layer's pixels are restored.
      if (!existing) {
        drawSnapshotFull(ctx, snap, doc.width, doc.height)
      } else if (!snapshotPixelsEqual(snap, currentSnap)) {
        const partialRect = adjacentRestoreRect(snap, currentSnap, options?.direction ?? null)
        if (partialRect) {
          drawSnapshotRegion(ctx, snap, partialRect)
        } else {
          drawSnapshotFull(ctx, snap, doc.width, doc.height)
        }
      }
    }
    let mask: HTMLCanvasElement | null | undefined = undefined
    if (snap.mask) {
      if (existing?.mask && currentSnap?.mask === snap.mask && canReuseCanvasSnapshot(existing.mask, snap.mask)) {
        mask = existing.mask
      } else {
        const m = makeCanvas(doc.width, doc.height)
        m.getContext("2d")!.drawImage(snap.mask, 0, 0)
        mask = m
      }
    } else if (snap.mask === null) {
      mask = null
    }
    return {
      id: snap.id,
      name: snap.name,
      kind: snap.kind ?? "raster",
      visible: snap.visible,
      locked: snap.locked,
      lockTransparency: snap.lockTransparency,
      lockDraw: snap.lockDraw,
      lockMove: snap.lockMove,
      lockAll: snap.lockAll,
      smartObject: snap.smartObject,
      opacity: snap.opacity,
      fillOpacity: snap.fillOpacity,
      advancedBlending: snap.advancedBlending,
      blendMode: snap.blendMode,
      linkGroupId: snap.linkGroupId,
      canvas,
      mask: mask === undefined ? existing?.mask : mask,
      maskEnabled: snap.maskEnabled,
      vectorMask: snap.vectorMask ?? null,
      clipped: snap.clipped,
      style: snap.style,
      childIds: snap.childIds,
      parentId: snap.parentId,
      expanded: snap.expanded,
      text: snap.text,
      shape: snap.shape,
      path: snap.path,
      adjustment: snap.adjustment,
      frame: snap.frame,
      artboard: snap.artboard,
      threeD: snap.threeD,
      video: snap.video,
      colorLabel: snap.colorLabel,
      smartFilters: cloneSmartFilters(snap.smartFilters),
      smartSource: snap.smartSource
        ? {
            ...snap.smartSource,
            editPackage: snap.smartSource.editPackage ? deepClonePlain(snap.smartSource.editPackage) : undefined,
            width: snap.smartSource.width,
            height: snap.smartSource.height,
            canvas:
              currentSnap?.smartSource?.canvas === snap.smartSource.canvas && existing?.smartSource?.canvas
                ? existing.smartSource.canvas
                : cloneCanvas(snap.smartSource.canvas),
          }
        : undefined,
      notes: snap.notes ? deepClonePlain(snap.notes) : undefined,
      metadata: snap.metadata ? deepClonePlain(snap.metadata) : undefined,
    }
  })
}

export function renderSmartObjectDocument(doc: PsDocument) {
  const canvas = makeCanvas(doc.width, doc.height)
  const ctx = canvas.getContext("2d")!
  for (const layer of doc.layers) {
    if (!layer.visible || layer.kind === "group" || layer.kind === "adjustment") continue
    compositeLayer(ctx, layer.canvas, layer.blendMode, layer.opacity, layer.fillOpacity ?? 1)
  }
  return canvas
}

/* ---------------------------- context ---------------------------------- */
