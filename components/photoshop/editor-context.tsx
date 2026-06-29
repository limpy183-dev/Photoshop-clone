"use client"

import * as React from "react"
import type {
  AlphaChannel,
  AdvancedBlending,
  AdjustmentProps,
  BlendMode,
  BrushPreset,
  BrushSettings,
  ColorManagementSettings,
  CloneSourceSettings,
  CountMarker,
  ColorSampler,
  AssetLibraryItem,
  DocumentModeSettings,
  DocumentReport,
  DocumentMetadata,
  EraserSettings,
  GradientSettings,
  Guide,
  HistoryEntry,
  HistorySnapshot,
  Layer,
  LayerComp,
  LayerKind,
  LayerMetadata,
  LayerNote,
  LayerSnapshot,
  LayerStyle,
  MacroAction,
  MacroStep,
  Note,
  PaintBucketSettings,
  PathProps,
  PrintSettings,
  PluginDescriptor,
  PsDocument,
  Selection,
  SelectionOptions,
  ShapeProps,
  Slice,
  SmartFilter,
  SmartObjectSource,
  SymmetrySettings,
  TextProps,
  ThreeDScene,
  TimelineFrame,
  TimelineSettings,
  ToolId,
  TransformState,
  VariableDataSet,
  VideoLayerProps,
} from "./types"
import { selectActiveDocument, selectActiveLayer, selectSelectedLayers } from "./editor-selectors"
import { createSmartObjectSource, markSmartObjectLinked, replaceSmartObjectContents } from "./smart-objects"
import {
  deleteEmptyLayersFromDocument,
  duplicateSlice,
  fillMaskCanvas,
  flattenLayerMasks,
  invertMaskCanvas,
  normalizeAdvancedBlending,
  normalizeGuide,
  normalizeSlice,
  reorderSmartFilterStack,
  updateSmartFilterStack,
} from "./layer-workflows"
import { applyLayerStyle } from "./layer-styles"
import { compositeLayer, getNativeComposite } from "./blend-modes"
import { recordHistoryLogEntryFromStorage } from "./preferences-engine"
import { createHistoryJumpScheduler, type HistoryJumpScheduler } from "./history-jump-scheduler"
import { RenderBus, type MergedRenderChange, type RenderChange } from "./render-bus"
import { addPhotoshopEventListener, dispatchPhotoshopEvent } from "./events"
import { createEditorSelectorStore, EditorSelectorContext, type EditorSelectorStore } from "./editor-selector-store"
import { EditorCloseDialog } from "./editor-close-dialog"
import {
  borderSelectionMask,
  contractSelectionMask,
  expandSelectionMask,
  featherMask,
  maskBounds,
  rasterizeShape,
  rasterizeText,
  selectionFromMask,
  selectionToMaskCanvas,
  smoothSelectionMask,
  transformSelectionMask,
} from "./tool-helpers"
import { assertCanvasSize as _assertCanvasSize } from "./canvas-limits"
import { makeCanvas } from "./canvas-utils"
import { flattenTransparencyCanvas, type FlattenTransparencyAlphaMode } from "./flatten-transparency"
import { uid } from "./uid"
import {
  planPurgeTargets,
  type PurgeResult,
  type PurgeTarget,
} from "./purge-commands"
import { purgePsbTileViewCaches } from "./psb-tile-view"
import {
  loadActionEnvelopes,
  playAction as playActionWithConditions,
  readPlaybackSpeedDelayMs,
} from "./action-conditionals"
import {
  filterPersistedEditorSettingsForHydration,
  loadPersistedEditorSettings,
  savePersistedEditorSettings,
} from "./editor-persisted-settings"
import {
  currentHistoryIndex,
  currentHistoryIndexFromHistories,
  dirtyDocIdsForAction,
  documentLifecycleFor,
  documentLifecycleForSlices,
  isDocumentDirtyInState,
  makeDocumentLifecycle,
  withDocumentLifecyclePatch,
} from "./editor-document-lifecycle"
import {
  applyGlobalLightToStyle,
  normalizeGlobalLight,
  type EditorGlobalLight,
} from "./editor-global-light"
import {
  alphaBounds,
  cloneCanvas,
  cloneLayerIntoDocument,
  cloneSmartFilters,
  deepClonePlain,
  duplicateDocumentDeep,
} from "./editor-document-cloning"
import {
  COMPRESS_AFTER_N,
  estimateClipboardPurgeBytes,
  estimateHistoriesPurgeBytes,
  estimateUndoPurgeBytes,
  estimateVideoCachePurgeBytes,
  isCompressedCanvas,
  prepareEntryForRestore,
  purgeFilterPreviewCache,
  releaseEntriesBlobs,
  scheduleHistoryCompression,
  stripVideoCacheFromDoc,
  stripVideoCacheFromEntry,
  stripVideoCacheFromHistory,
  stripVideoCacheFromSnapshots,
} from "./editor-history-storage"
import {
  adjacentRestoreRect,
  alignLayersInDocument,
  canPatchSnapshot,
  canReuseCanvasSnapshot,
  cloneCanvasPatch,
  commitAffectsComposite,
  combineSelectionWithChannel,
  distributeLayersInDocument,
  drawSnapshotFull,
  drawSnapshotRegion,
  getUndoLimit,
  isLayerChangeHints,
  normalizeDirtyRect,
  renderChangeForChangedLayerIds,
  snapshotPixelsEqual,
  type ChangedLayerIds,
  type LayerAlignMode,
  type LayerDistributeAxis,
  type SelectionChannelLoadMode,
} from "./editor-history-geometry"

/* ----------------------------- helpers --------------------------------- */

export type DocumentStorageKind = "new" | "download" | "file-system-access" | "opened-file" | "snapshot"
export type DocumentFileKind = "project" | "psd" | "image"

export interface FileSystemWritableFileStreamLike {
  write(data: Blob | string): Promise<void>
  close(): Promise<void>
}

export interface FileSystemFileHandleLike {
  name: string
  createWritable(): Promise<FileSystemWritableFileStreamLike>
  getFile?: () => Promise<File>
  queryPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>
  requestPermission?: (descriptor?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>
}

export interface DocumentLifecycleState {
  dirty: boolean
  savedHistoryIndex: number
  savedAt?: number
  fileName?: string
  fileKind?: DocumentFileKind
  storage?: DocumentStorageKind
  fileHandle?: FileSystemFileHandleLike
  lastSaveNote?: string
}

type DocumentIds = {
  doc: string
  backgroundLayer: string
  layer: string
}

export function makeDocument(
  name: string,
  w: number,
  h: number,
  bg = "#ffffff",
  ids?: DocumentIds,
): PsDocument {
  const bgLayer: Layer = {
    id: ids?.backgroundLayer ?? uid("layer"),
    name: "Background",
    kind: "raster",
    visible: true,
    locked: true,
    opacity: 1,
    blendMode: "normal",
    canvas: makeCanvas(w, h, bg),
  }
  const layer1: Layer = {
    id: ids?.layer ?? uid("layer"),
    name: "Layer 1",
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: makeCanvas(w, h),
  }
  return {
    id: ids?.doc ?? uid("doc"),
    name,
    width: w,
    height: h,
    zoom: 1,
    layers: [bgLayer, layer1],
    activeLayerId: layer1.id,
    selectedLayerIds: [layer1.id],
    background: bg,
    colorMode: "RGB",
    bitDepth: 8,
    selection: { bounds: null, shape: "rect" },
    rotation: 0,
    guides: [],
    showGrid: false,
    showSmartGuides: true,
    gridSize: 50,
    snap: true,
    snapToGrid: false,
    snapToGuides: true,
    quickMask: false,
    quickMaskCanvas: null,
    quickMaskPaintMode: "auto",
    rulerUnits: "px",
    rulerOrigin: { x: 0, y: 0 },
    gridColor: "#78b4ff",
    gridSubdivisions: 1,
    gridOpacity: 0.42,
    showPixelGrid: false,
    slices: [],
    colorSamplers: [],
    globalLight: { angle: 120, altitude: 30 },
    metadata: {
      title: name,
      author: "",
      description: "",
      copyright: "",
      keywords: [],
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    },
    colorManagement: {
      assignedProfile: "sRGB IEC61966-2.1",
      workingSpace: "sRGB IEC61966-2.1",
      renderingIntent: "relative-colorimetric",
      blackPointCompensation: true,
      proofProfile: "None",
      proofColors: false,
      gamutWarning: false,
    },
    printSettings: {
      paperSize: "Letter",
      orientation: "portrait",
      scale: 100,
      bleedMm: 0,
      cropMarks: false,
      registrationMarks: false,
      colorHandling: "app",
      proofPrint: false,
      printerProfile: "Working CMYK",
      paperColor: "#ffffff",
      marksOffsetMm: 4,
      pagePosition: "center",
    },
    modeSettings: { mode: "RGB" },
    plugins: [],
    pluginStorage: {},
    variableDataSets: [],
  }
}

export function blendToComposite(b: BlendMode): GlobalCompositeOperation {
  const map: Record<BlendMode, GlobalCompositeOperation> = {
    normal: "source-over",
    dissolve: "source-over",
    behind: "destination-over",
    clear: "destination-out",
    darken: "darken",
    multiply: "multiply",
    "color-burn": "color-burn",
    "linear-burn": "color-burn",
    "darker-color": "darken",
    lighten: "lighten",
    screen: "screen",
    "color-dodge": "color-dodge",
    "linear-dodge": "color-dodge",
    "lighter-color": "lighten",
    overlay: "overlay",
    "soft-light": "soft-light",
    "hard-light": "hard-light",
    "vivid-light": "overlay",
    "linear-light": "lighten",
    "pin-light": "hard-light",
    "hard-mix": "hard-light",
    difference: "difference",
    exclusion: "exclusion",
    subtract: "destination-out",
    divide: "destination-out",
    hue: "hue",
    saturation: "saturation",
    color: "color",
    luminosity: "luminosity",
  }
  return map[b]
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function isLayerLocked(layer: Layer | undefined | null) {
  return !!layer && (layer.locked || layer.lockAll)
}

function blocksLayerMove(layer: Layer | undefined | null) {
  return isLayerLocked(layer) || !!layer?.lockMove
}

function layerCommandTargetIds(doc: PsDocument, ids: string[] | undefined, all = false) {
  if (all) return new Set(doc.layers.map((layer) => layer.id))
  const source = ids?.length ? ids : doc.selectedLayerIds.length ? doc.selectedLayerIds : [doc.activeLayerId]
  return new Set(source.filter(Boolean))
}

function flattenLayerStylePixels(layer: Layer): Layer {
  if (!layer.style) return layer
  const advanced = normalizeAdvancedBlending(layer.advancedBlending)
  const canvas = applyLayerStyle(layer, layer.fillOpacity ?? 1, {
    transparencyShapesLayer: advanced.transparencyShapesLayer,
  })
  return {
    ...layer,
    canvas,
    style: undefined,
    fillOpacity: 1,
  }
}

type RasterizeLayerOption =
  | "layer"
  | "type"
  | "shape"
  | "smart-object"
  | "layer-style"
  | "video"
  | "3d"
  | "all"

function rasterizeLayerForOption(layer: Layer, option: RasterizeLayerOption, doc: PsDocument): Layer {
  if (layer.kind === "group") return layer
  let next = layer
  if (option === "layer-style" || option === "all") next = flattenLayerStylePixels(next)
  if (option === "all") next = flattenLayerMasks(next, doc.width, doc.height)
  if (option === "type" && next.kind !== "text") return next
  if (option === "shape" && next.kind !== "shape" && !next.path) return next
  if (option === "smart-object" && !next.smartObject && next.kind !== "smart-object") return next
  if (option === "video" && next.kind !== "video" && !next.video) return next
  if (option === "3d" && next.kind !== "3d" && !next.threeD) return next
  if (option === "layer-style") return next

  return {
    ...next,
    kind: "raster",
    smartObject: undefined,
    smartSource: undefined,
    smartFilters: option === "smart-object" || option === "all" ? undefined : next.smartFilters,
    text: option === "type" || option === "layer" || option === "all" ? undefined : next.text,
    shape: option === "shape" || option === "layer" || option === "all" ? undefined : next.shape,
    path: option === "shape" || option === "layer" || option === "all" ? undefined : next.path,
    adjustment: option === "layer" || option === "all" ? undefined : next.adjustment,
    frame: option === "layer" || option === "all" ? undefined : next.frame,
    artboard: option === "layer" || option === "all" ? undefined : next.artboard,
    threeD: option === "3d" || option === "layer" || option === "all" ? undefined : next.threeD,
    video: option === "video" || option === "layer" || option === "all" ? undefined : next.video,
  }
}

type GlobalLight = EditorGlobalLight

/* ---------------------------- state shape ------------------------------ */

interface DocHistory {
  entries: HistoryEntry[]
  index: number
}

interface ClosedDocumentRecord {
  id: string
  doc: PsDocument
  history: DocHistory | undefined
  snapshots: HistorySnapshot[]
  lifecycle: DocumentLifecycleState | undefined
  closedAt: number
}

export interface ActiveSmartFilterMaskTarget {
  layerId: string
  filterId: string
}

interface EditorState {
  documents: PsDocument[]
  activeDocId: string | null
  tool: ToolId
  foreground: string
  background: string
  brush: BrushSettings
  gradient: GradientSettings
  paintBucket: PaintBucketSettings
  eraser: EraserSettings
  cloneSource: CloneSourceSettings
  symmetry: SymmetrySettings
  selectionOptions: SelectionOptions
  transform: TransformState | null
  brushPresets: BrushPreset[]
  /** per-document undo history */
  histories: Record<string, DocHistory>
  /** named per-document history snapshots */
  snapshots: Record<string, HistorySnapshot[]>
  /** recorded macro actions */
  actions: MacroAction[]
  recordingActionId: string | null
  isPlayingAction: boolean
  /** in-memory clipboard (pixels copied from a layer/selection) */
  clipboard: { width: number; height: number; canvas: HTMLCanvasElement } | null
  /** in-memory clipboard for Layer FX settings */
  styleClipboard: LayerStyle | null
  /** in-memory closed document stack for Reopen Closed Document. */
  closedDocuments: ClosedDocumentRecord[]
  /** per-document dirty/saved identity and browser storage state */
  documentLifecycle: Record<string, DocumentLifecycleState>
  /** Canvas painting target when editing a smart-filter mask in place. */
  activeSmartFilterMaskTarget: ActiveSmartFilterMaskTarget | null
}

function changedLayerIdsForHistoryLog(changedLayerIds: ChangedLayerIds | undefined): string[] | undefined {
  if (!changedLayerIds) return undefined
  if (changedLayerIds === "all") return ["all"]
  if (Array.isArray(changedLayerIds)) return [...(changedLayerIds as readonly string[])]
  return "ids" in changedLayerIds && changedLayerIds.ids?.length ? [...changedLayerIds.ids] : undefined
}

function toolSettingsForHistoryLog(state: EditorState): Record<string, unknown> | undefined {
  if (["brush", "pencil", "mixer-brush", "history-brush", "art-history-brush"].includes(state.tool)) {
    return {
      size: state.brush.size,
      hardness: state.brush.hardness,
      opacity: state.brush.opacity,
      flow: state.brush.flow,
      smoothing: state.brush.smoothing,
    }
  }
  if (state.tool === "gradient") return { ...state.gradient }
  if (state.tool === "paint-bucket") return { ...state.paintBucket }
  if (state.tool === "eraser" || state.tool === "magic-eraser" || state.tool === "background-eraser") return { ...state.eraser }
  if (state.tool === "clone-stamp" || state.tool === "pattern-stamp") {
    return {
      aligned: state.cloneSource.aligned,
      sample: state.cloneSource.sample,
      scale: state.cloneSource.scale,
      rotation: state.cloneSource.rotation,
      showOverlay: state.cloneSource.showOverlay,
    }
  }
  if (["marquee-rect", "marquee-ellipse", "lasso", "lasso-polygon", "lasso-magnetic", "magic-wand", "quick-selection", "object-select"].includes(state.tool)) {
    return { ...state.selectionOptions }
  }
  return undefined
}

export type Action =
  | { type: "hydrate-settings"; settings: Partial<Pick<EditorState, "tool" | "foreground" | "background" | "brush" | "gradient" | "symmetry">> }
  | { type: "set-tool"; tool: ToolId }
  | { type: "set-foreground"; color: string }
  | { type: "set-background"; color: string }
  | { type: "swap-colors" }
  | { type: "reset-colors" }
  | { type: "set-brush"; brush: Partial<BrushSettings> }
  | { type: "set-gradient"; gradient: Partial<GradientSettings> }
  | { type: "set-paint-bucket"; paintBucket: Partial<PaintBucketSettings> }
  | { type: "set-eraser"; eraser: Partial<EraserSettings> }
  | { type: "set-clone-source"; cloneSource: Partial<CloneSourceSettings> }
  | { type: "set-selection-options"; selectionOptions: Partial<SelectionOptions> }
  | { type: "set-symmetry"; symmetry: Partial<SymmetrySettings> }
  | { type: "set-transform"; transform: TransformState }
  | { type: "clear-transform" }
  | { type: "set-active-smart-filter-mask"; target: ActiveSmartFilterMaskTarget | null }
  | { type: "apply-brush-preset"; preset: BrushPreset }
  | { type: "add-brush-preset"; preset: BrushPreset }
  | { type: "remove-brush-preset"; id: string }
  | { type: "set-brush-presets"; presets: BrushPreset[] }
  | { type: "new-document"; doc: PsDocument; entry: HistoryEntry; lifecycle?: Partial<DocumentLifecycleState> }
  | { type: "replace-startup-document"; doc: PsDocument; entry: HistoryEntry; lifecycle?: Partial<DocumentLifecycleState> }
  | { type: "close-document"; id: string }
  | { type: "close-other-documents"; keepId: string }
  | { type: "reopen-closed-document"; id?: string }
  | { type: "move-layers-to-document"; sourceDocId: string; targetDocId: string; layerIds: string[]; copy?: boolean }
  | { type: "activate-document"; id: string }
  | { type: "set-zoom"; zoom: number }
  | { type: "set-rotation"; rotation: 0 | 90 | 180 | 270 }
  | { type: "toggle-grid" }
  | { type: "set-grid-size"; size: number }
  | { type: "set-ruler-units"; units: PsDocument["rulerUnits"] }
  | { type: "set-grid-color"; color: string }
  | { type: "set-grid-subdivisions"; subdivisions: number }
  | { type: "set-grid-opacity"; opacity: number }
  | { type: "toggle-pixel-grid" }
  | { type: "toggle-snap" }
  | { type: "toggle-snap-grid" }
  | { type: "toggle-snap-guides" }
  | { type: "set-show-smart-guides"; show: boolean }
  | { type: "add-guide"; guide: Guide }
  | { type: "update-guide"; id: string; patch: Partial<Guide> }
  | { type: "update-guide-state"; id: string; patch: Partial<Guide> }
  | { type: "move-guide"; id: string; position: number }
  | { type: "remove-guide"; id: string }
  | { type: "clear-guides" }
  | { type: "set-quick-mask"; on: boolean; canvas?: HTMLCanvasElement | null }
  | { type: "set-quick-mask-paint-mode"; mode: NonNullable<PsDocument["quickMaskPaintMode"]> }
  | { type: "set-selection"; selection: Selection }
  | { type: "add-layer"; layer: Layer }
  | { type: "remove-layer"; id: string }
  | { type: "duplicate-layer"; id: string }
  | { type: "set-active-layer"; id: string }
  | { type: "set-selected-layers"; ids: string[]; activeId: string }
  | { type: "toggle-layer-visibility"; id: string }
  | { type: "set-layer-visibility"; id: string; visible: boolean }
  | { type: "toggle-layer-lock"; id: string }
  | { type: "toggle-layer-clipped"; id: string }
  | { type: "set-layer-opacity"; id: string; opacity: number }
  | { type: "set-layer-fill-opacity"; id: string; fillOpacity: number }
  | { type: "set-layer-blend"; id: string; blendMode: BlendMode }
  | { type: "set-layer-advanced-blending"; id: string; advancedBlending: AdvancedBlending | undefined }
  | { type: "set-layer-style"; id: string; style: LayerStyle | undefined }
  | { type: "set-layer-mask"; id: string; mask: HTMLCanvasElement | null }
  | { type: "set-layer-mask-enabled"; id: string; enabled: boolean }
  | { type: "fill-layer-mask"; id: string; value: "black" | "white" | "transparent" }
  | { type: "invert-layer-mask"; id: string }
  | { type: "set-layer-text"; id: string; text: TextProps | undefined }
  | { type: "set-layer-shape"; id: string; shape: ShapeProps }
  | { type: "set-layer-path"; id: string; path: PathProps | undefined }
  | { type: "set-layer-kind"; id: string; kind: LayerKind }
  | { type: "set-layer-3d"; id: string; scene: ThreeDScene | undefined }
  | { type: "set-layer-video"; id: string; video: VideoLayerProps | undefined }
  | { type: "set-layer-smart"; id: string; smart: boolean }
  | { type: "set-layer-smart-link"; id: string; source: Partial<SmartObjectSource> }
  | { type: "set-layer-smart-link-status"; id: string; status: NonNullable<SmartObjectSource["status"]> }
  | { type: "apply-linked-smart-object-sync"; docId: string; id: string; source: Partial<SmartObjectSource> }
  | { type: "replace-smart-object-contents"; id: string; canvas: HTMLCanvasElement; source?: Partial<SmartObjectSource> }
  | { type: "update-smart-object-parent"; parentDocId: string; layerId: string; canvas: HTMLCanvasElement }
  | { type: "set-smart-object-edit-package"; id: string; editPackage: NonNullable<SmartObjectSource["editPackage"]> | undefined }
  | { type: "rename-layer"; id: string; name: string }
  | { type: "move-layer"; id: string; direction: "up" | "down" }
  | { type: "merge-down"; id: string }
  | { type: "merge-selected" }
  | { type: "flatten" }
  | { type: "flatten-all-layer-effects"; ids?: string[] }
  | { type: "flatten-all-masks"; ids?: string[] }
  | { type: "delete-empty-layers" }
  | { type: "rasterize-layers"; ids?: string[]; option: "layer" | "type" | "shape" | "smart-object" | "layer-style" | "video" | "3d" | "all" }
  | {
      type: "flatten-transparency"
      matte: string
      alphaMode?: FlattenTransparencyAlphaMode
      layerIds?: string[]
      scope?: "document" | "selected" | "visible"
    }
  | { type: "link-selected" }
  | { type: "unlink-selected" }
  | { type: "group-selected"; groupId: string }
  | { type: "ungroup"; groupId: string }
  | { type: "toggle-group-expanded"; id: string }
  | { type: "push-history"; entry: HistoryEntry }
  | { type: "reset-history"; docId: string; entry: HistoryEntry }
  | { type: "purge-undo"; docId: string; entry: HistoryEntry }
  | {
      type: "purge-histories"
      entriesByDocId: Record<string, HistoryEntry>
      closedEntriesByRecordId: Record<string, HistoryEntry>
    }
  | {
      type: "restore-history"
      index: number
      entry: HistoryEntry
      restoredLayers: Layer[]
      activeLayerId: string
      selectedLayerIds: string[]
    }
  | { type: "restore-history-entry"; entry: HistoryEntry }
  | { type: "add-history-snapshot"; docId: string; snapshot: HistorySnapshot }
  | { type: "delete-history-snapshot"; docId: string; snapshotId: string }
  | { type: "add-action"; action: MacroAction }
  | { type: "set-actions"; actions: MacroAction[] }
  | { type: "delete-action"; id: string }
  | { type: "start-recording-action"; id: string }
  | { type: "stop-recording-action" }
  | { type: "append-action-step"; actionId: string; step: MacroStep }
  | { type: "clear-action-steps"; id: string }
  | { type: "set-playing-action"; playing: boolean }
  | { type: "resize-document"; width: number; height: number; layerCanvases?: Array<{ id: string; canvas?: HTMLCanvasElement; mask?: HTMLCanvasElement | null }> }
  | { type: "resize-canvas"; width: number; height: number; offsetX: number; offsetY: number; fill: string; layerCanvases?: Array<{ id: string; canvas?: HTMLCanvasElement; mask?: HTMLCanvasElement | null }>; selectionMask?: HTMLCanvasElement | null; quickMaskCanvas?: HTMLCanvasElement | null; channelCanvases?: Record<string, HTMLCanvasElement | null> }
  | { type: "set-clipboard"; canvas: HTMLCanvasElement }
  | { type: "clear-clipboard" }
  | { type: "set-style-clipboard"; style: LayerStyle | null }
  | { type: "purge-clipboard" }
  | { type: "purge-video-cache" }
  | { type: "set-layer-vector-mask"; id: string; mask: PathProps | null }
  | { type: "set-layer-adjustment"; id: string; adjustment: AdjustmentProps }
  | { type: "set-layer-smart-filters"; id: string; smartFilters: SmartFilter[] }
  | { type: "update-smart-filter"; layerId: string; filterId: string; patch: Partial<SmartFilter> }
  | { type: "reorder-smart-filter"; layerId: string; filterId: string; offset: number }
  | { type: "set-smart-filter-mask"; layerId: string; filterId: string; mask: HTMLCanvasElement | null; enabled?: boolean }
  | { type: "set-style-presets"; presets: NonNullable<PsDocument["stylePresets"]> }
  | { type: "set-asset-library"; assets: AssetLibraryItem[] }
  | { type: "set-timeline-frames"; frames: TimelineFrame[] }
  | { type: "set-timeline-settings"; settings: TimelineSettings | undefined }
  | { type: "set-global-light"; globalLight: GlobalLight }
  | { type: "set-document-metadata"; metadata: DocumentMetadata }
  | { type: "set-color-management"; settings: ColorManagementSettings }
  | { type: "set-print-settings"; settings: PrintSettings }
  | { type: "set-document-mode-settings"; colorMode: PsDocument["colorMode"]; settings?: DocumentModeSettings; dpi?: number }
  | { type: "set-plugins"; plugins: PluginDescriptor[] }
  | { type: "set-plugin-storage"; pluginStorage: NonNullable<PsDocument["pluginStorage"]> }
  | { type: "set-variable-data-sets"; dataSets: VariableDataSet[] }
  | { type: "add-document-report"; report: DocumentReport }
  | { type: "clear-document-reports" }
  | { type: "set-layer-color-label"; id: string; label: Layer["colorLabel"] }
  | { type: "set-layer-metadata"; id: string; metadata: LayerMetadata | undefined }
  | { type: "add-layer-note"; id: string; note: LayerNote }
  | { type: "update-layer-note"; id: string; noteId: string; patch: Partial<LayerNote> }
  | { type: "remove-layer-note"; id: string; noteId: string }
  | { type: "align-layers"; align: LayerAlignMode; ids?: string[] }
  | { type: "distribute-layers"; axis: LayerDistributeAxis; ids?: string[] }
  | { type: "reorder-layer"; id: string; targetId: string; position: "above" | "below" | "into" }
  | { type: "reorder-layers"; ids: string[]; targetId: string; position: "above" | "below" | "into" }
  | { type: "add-note"; note: Note }
  | { type: "update-note"; id: string; patch: Partial<Note> }
  | { type: "remove-note"; id: string }
  | { type: "add-slice"; slice: Slice }
  | { type: "update-slice"; id: string; patch: Partial<Slice> }
  | { type: "duplicate-slice"; id: string }
  | { type: "set-active-slice"; id: string | null }
  | { type: "remove-slice"; id: string }
  | { type: "clear-slices" }
  | { type: "add-count"; count: CountMarker }
  | { type: "remove-count"; id: string }
  | { type: "clear-counts" }
  | { type: "set-count-group"; group: string }
  | { type: "add-color-sampler"; sampler: ColorSampler }
  | { type: "update-color-sampler"; id: string; patch: Partial<ColorSampler> }
  | { type: "remove-color-sampler"; id: string }
  | { type: "clear-color-samplers" }
  | { type: "save-comp"; comp: LayerComp }
  | { type: "apply-comp"; id: string }
  | { type: "remove-comp"; id: string }
  | { type: "set-measurement"; m: PsDocument["measurement"] }
  | { type: "set-gradient-stops"; stops: GradientSettings["stops"] }
  | { type: "grow-selection"; amount: number }
  | { type: "contract-selection"; amount: number }
  | { type: "grow-similar-selection"; tolerance: number; iterations?: number }
  | { type: "similar-selection"; tolerance: number }
  | { type: "transform-selection"; scale: number; rotationDeg: number; smoothing?: boolean; scaleX?: number; scaleY?: number; translateX?: number; translateY?: number }
  | { type: "stamp-visible" }
  | { type: "toggle-layer-lock-transparency"; id: string }
  | { type: "toggle-layer-lock-draw"; id: string }
  | { type: "toggle-layer-lock-move"; id: string }
  | { type: "toggle-layer-lock-all"; id: string }
  | { type: "feather-selection"; radius: number }
  | { type: "border-selection"; width: number }
  | { type: "smooth-selection"; radius: number }
  | { type: "save-selection"; channel: AlphaChannel; targetDocId?: string }
  | { type: "load-selection"; channelId: string; mode?: SelectionChannelLoadMode; invert?: boolean; sourceDocId?: string }
  | { type: "update-channel"; channelId: string; patch: Partial<AlphaChannel>; targetDocId?: string }
  | { type: "delete-channel"; channelId: string }
  | { type: "mark-document-dirty"; id: string }
  | { type: "mark-document-saved"; id: string; lifecycle?: Partial<DocumentLifecycleState> }
  | { type: "set-document-lifecycle"; id: string; lifecycle: Partial<DocumentLifecycleState> }

const DEFAULT_BRUSH_PRESETS: BrushPreset[] = [
  { id: "soft-30", name: "Soft Round 30", size: 30, hardness: 0, spacing: 25, settings: { tipShape: "round", smoothing: 18 } },
  { id: "soft-60", name: "Soft Round 60", size: 60, hardness: 0, spacing: 25, settings: { tipShape: "round", smoothing: 22 } },
  { id: "hard-15", name: "Hard Round 15", size: 15, hardness: 100, spacing: 18, settings: { tipShape: "round", smoothing: 4 } },
  { id: "hard-50", name: "Hard Round 50", size: 50, hardness: 100, spacing: 18, settings: { tipShape: "round", smoothing: 6 } },
  {
    id: "calligraphy",
    name: "Calligraphy 25",
    size: 25,
    hardness: 92,
    spacing: 8,
    settings: { tipShape: "round", angleJitter: 4, roundnessJitter: 55, angleControl: "tilt" },
  },
  {
    id: "airbrush",
    name: "Airbrush 80",
    size: 80,
    hardness: 0,
    spacing: 5,
    settings: { tipShape: "round", flow: 28, opacityJitter: 12, flowControl: "pressure", buildUp: true },
  },
  { id: "fine", name: "Fine Detail 4", size: 4, hardness: 100, spacing: 5, settings: { tipShape: "round", smoothing: 35 } },
  {
    id: "marker",
    name: "Marker 40",
    size: 40,
    hardness: 70,
    spacing: 10,
    settings: { tipShape: "square", opacity: 88, flow: 72, wetEdges: true },
  },
  {
    id: "bristle-dry",
    name: "Dry Bristle 42",
    size: 42,
    hardness: 65,
    spacing: 12,
    settings: {
      tipShape: "bristle",
      bristleTip: { length: 72, density: 74, thickness: 34, stiffness: 38, splay: 52, wetness: 18 },
      texture: { enabled: true, pattern: "canvas", mode: "multiply", depth: 55, depthJitter: 20, minDepth: 12, scale: 90 },
      purity: -8,
    },
  },
  {
    id: "erodible-chalk",
    name: "Erodible Chalk 36",
    size: 36,
    hardness: 78,
    spacing: 16,
    settings: {
      tipShape: "erodible",
      erodibleTip: { sharpness: 76, flatness: 48, erosionRate: 64, softness: 18, aspectRatio: 72, rotation: -8 },
      noise: true,
      texture: { enabled: true, pattern: "paper", mode: "subtract", depth: 46, depthJitter: 28, minDepth: 8, scale: 120 },
    },
  },
]

// Actions whose React render can be deferred via startTransition without
// hurting interactivity. Currently only "push-history" qualifies — paint
// strokes generate them rapidly and the cascade of context-consumer
// re-renders that follows is the dominant source of "lag/freeze after
// stroke" perception. The reducer itself still runs synchronously (see the
// dispatch wrapper) so undo/redo correctness is unaffected.
const BRUSH_PRESET_VISUAL_RESET: Partial<BrushSettings> = {
  sizeControl: "off",
  angleControl: "off",
  roundnessControl: "off",
  opacityControl: "off",
  flowControl: "off",
  sizeJitter: 0,
  angleJitter: 0,
  roundnessJitter: 0,
  flipX: false,
  flipY: false,
  minDiameter: 0,
  scatter: 0,
  scatterCount: 1,
  scatterCountJitter: 0,
  fgBgJitter: 0,
  hueJitter: 0,
  satJitter: 0,
  brightJitter: 0,
  purity: 0,
  opacityJitter: 0,
  flowJitter: 0,
  texture: undefined,
  dualBrush: undefined,
  pose: undefined,
  wetEdges: false,
  buildUp: false,
  noise: false,
  protectTexture: false,
}

function applyBrushPreset(current: BrushSettings, preset: BrushPreset): BrushSettings {
  return {
    ...current,
    ...BRUSH_PRESET_VISUAL_RESET,
    size: preset.size,
    hardness: preset.hardness,
    spacing: preset.spacing,
    ...(preset.settings ?? {}),
  }
}

const HIGH_FREQUENCY_ACTION_TYPES = new Set<Action["type"]>([
  "push-history",
])

const HISTORY_CONTEXT_INVALIDATING_ACTION_TYPES = new Set<Action["type"]>([
  "push-history",
  "reset-history",
  "purge-undo",
  "purge-histories",
  "restore-history-entry",
  "new-document",
  "close-document",
  "close-other-documents",
  "reopen-closed-document",
  "move-layers-to-document",
  "activate-document",
  "update-smart-object-parent",
])

export function reducer(state: EditorState, action: Action): EditorState {
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
              id: uid("closed"),
              doc: closing,
              history: state.histories[action.id],
              snapshots: state.snapshots[action.id] ?? [],
              lifecycle: closingLifecycle,
              closedAt: Date.now(),
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
          id: uid("closed"),
          doc,
          history: state.histories[doc.id],
          snapshots: state.snapshots[doc.id] ?? [],
          lifecycle: state.documentLifecycle[doc.id],
          closedAt: Date.now(),
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
          id: uid("layer"),
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
              updatedAt: Date.now(),
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
                  updatedAt: Date.now(),
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
          id: uid("layer"),
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
          uid("link")
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
        releaseEntriesBlobs(cur.entries.slice(cur.index + 1))
      }
      const limit = getUndoLimit()
      const combined = [...trimmed, action.entry]
      // 2. Honor the undo-limit by dropping the oldest entries — also
      //    free their blobs (this is the long-session leak path).
      const next = combined.length > limit
        ? (releaseEntriesBlobs(combined.slice(0, combined.length - limit)), combined.slice(-limit))
        : combined
      // Schedule background compression of older entries to free canvas memory
      if (next.length > COMPRESS_AFTER_N) {
        scheduleHistoryCompression(next, next.length - 1)
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
      if (prior?.length) releaseEntriesBlobs(prior)
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
      if (prior?.length) releaseEntriesBlobs(prior)
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
        if (prior?.length) releaseEntriesBlobs(prior)
        const priorSnapshots = snapshots[docId] ?? []
        if (priorSnapshots.length) releaseEntriesBlobs(priorSnapshots.map((snapshot) => snapshot.entry))
        histories[docId] = { entries: [entry], index: 0 }
        snapshots[docId] = []
      }
      const closedDocuments = state.closedDocuments.map((record) => {
        const entry = action.closedEntriesByRecordId[record.id]
        if (!entry) return record
        if (record.history?.entries.length) releaseEntriesBlobs(record.history.entries)
        if (record.snapshots?.length) releaseEntriesBlobs(record.snapshots.map((snapshot) => snapshot.entry))
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
          recorded.id === action.id ? { ...recorded, steps: [], updatedAt: Date.now() } : recorded,
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
                    ? { ...note, ...deepClonePlain(action.patch), updatedAt: Date.now() }
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
        const newId = uid("layer")
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
        savedAt: Date.now(),
        savedHistoryIndex: currentHistoryIndex(state, action.id),
        ...action.lifecycle,
      })
    case "set-document-lifecycle":
      return withDocumentLifecyclePatch(state, action.id, action.lifecycle)
    default:
      return state
  }
}

function mutateActiveDoc(state: EditorState, fn: (d: PsDocument) => PsDocument): EditorState {
  if (!state.activeDocId) return state
  return {
    ...state,
    documents: state.documents.map((d) => (d.id === state.activeDocId ? fn(d) : d)),
  }
}

/* --------------------------- render bus -------------------------------- */

// Frozen empty fallbacks used when there is no active document. Reusing the
// same object identity prevents EditorContext consumers from re-rendering
// every tick.
const EMPTY_HISTORY = Object.freeze({ entries: [] as HistoryEntry[], index: -1 }) as { entries: HistoryEntry[]; index: number }
const EMPTY_SNAPSHOTS: HistorySnapshot[] = Object.freeze([]) as unknown as HistorySnapshot[]

/* --------------------------- snapshot api ------------------------------ */

function snapshotLayers(
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

function makeHistoryEntry(
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

function restoreFromEntry(
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

function renderSmartObjectDocument(doc: PsDocument) {
  const canvas = makeCanvas(doc.width, doc.height)
  const ctx = canvas.getContext("2d")!
  for (const layer of doc.layers) {
    if (!layer.visible || layer.kind === "group" || layer.kind === "adjustment") continue
    compositeLayer(ctx, layer.canvas, layer.blendMode, layer.opacity, layer.fillOpacity ?? 1)
  }
  return canvas
}

/* ---------------------------- context ---------------------------------- */

interface EditorContextValue {
  documents: PsDocument[]
  activeDocId: string | null
  tool: ToolId
  foreground: string
  background: string
  brush: BrushSettings
  gradient: GradientSettings
  paintBucket: PaintBucketSettings
  eraser: EraserSettings
  cloneSource: CloneSourceSettings
  symmetry: SymmetrySettings
  selectionOptions: SelectionOptions
  transform: TransformState | null
  brushPresets: BrushPreset[]
  history: HistoryEntry[]
  historyIndex: number
  snapshots: HistorySnapshot[]
  closedDocuments: Array<{ id: string; name: string; width: number; height: number; closedAt: number }>
  documentStatuses: Record<string, DocumentLifecycleState>
  documentHistoryVersions: Record<string, number>
  actions: MacroAction[]
  recordingActionId: string | null
  isPlayingAction: boolean
  activeSmartFilterMaskTarget: ActiveSmartFilterMaskTarget | null
  activeDoc: PsDocument | null
  activeLayer: Layer | null
  selectedLayers: Layer[]
  clipboard: EditorState["clipboard"]
  styleClipboard: LayerStyle | null
  dispatch: React.Dispatch<Action>
  commit: (label: string, changedLayerIds?: ChangedLayerIds) => void
  requestRender: (change?: RenderChange) => void
  subscribeRender: (cb: (change: MergedRenderChange) => void) => () => void
  newLayer: (kind?: LayerKind) => void
  newGroup: () => void
  jumpHistory: (index: number) => void
  /**
   * Step the active document's history by a relative delta (e.g. -1 for
   * undo, +1 for redo). Returns true if the step was issued, false if
   * already at the bound. Reads bounds from the latest reducer state via
   * stateRef so it stays correct even when push-history renders are
   * deferred via React.startTransition.
   */
  stepHistoryBy: (delta: number) => boolean
  createHistorySnapshot: (name?: string) => void
  restoreHistorySnapshot: (snapshotId: string) => void
  deleteHistorySnapshot: (snapshotId: string) => void
  createAction: (name?: string) => void
  startRecordingAction: (id: string) => void
  stopRecordingAction: () => void
  playAction: (id: string) => void
  deleteAction: (id: string) => void
  clearAction: (id: string) => void
  createDocument: (doc: PsDocument, label?: string, lifecycle?: Partial<DocumentLifecycleState>) => void
  duplicateDocument: (id?: string) => void
  requestCloseDocument: (id?: string) => void
  closeOtherDocuments: (id?: string) => void
  reopenClosedDocument: (id?: string) => void
  markDocumentSaved: (id: string, lifecycle?: Partial<DocumentLifecycleState>) => void
  setDocumentLifecycle: (id: string, lifecycle: Partial<DocumentLifecycleState>) => void
  moveLayersToDocument: (sourceDocId: string, targetDocId: string, layerIds: string[], copy?: boolean) => void
  copySelection: (cut?: boolean) => void
  pasteAsLayer: () => void
  purgeCaches: (target: PurgeTarget) => PurgeResult
  resizeDocument: (w: number, h: number, resample?: "nearest" | "bilinear" | "bicubic" | "bicubic-smoother" | "bicubic-sharper") => void
  resizeCanvas: (w: number, h: number, anchorX: number, anchorY: number, fill: string) => void
  toggleQuickMask: () => void
  addLayerMask: () => void
  editSmartObject: (layer?: Layer | null) => void
  updateSmartObjectParent: () => void
  beginTransform: (layer: Layer) => void
  commitTransform: () => void
  flipLayer: (axis: "horizontal" | "vertical") => void
  rotateLayer: (deg: number) => void
  filterPreviews: Record<string, HTMLCanvasElement>
  setFilterPreview: (layerId: string, canvas: HTMLCanvasElement | null) => void
}

interface EditorRenderContextValue {
  requestRender: (change?: RenderChange) => void
  subscribeRender: (cb: (change: MergedRenderChange) => void) => () => void
}

const EditorContext = React.createContext<EditorContextValue | null>(null)
const EditorRenderContext = React.createContext<EditorRenderContextValue | null>(null)

const initialDoc = makeDocument("Untitled-1", 1200, 800, "#ffffff", {
  doc: "doc_initial",
  backgroundLayer: "layer_background",
  layer: "layer_initial",
})

const initialState: EditorState = {
  documents: [initialDoc],
  activeDocId: initialDoc.id,
  tool: "brush",
  foreground: "#000000",
  background: "#ffffff",
  brush: {
    size: 30,
    hardness: 80,
    opacity: 100,
    flow: 100,
    smoothing: 10,
    spacing: 25,
    tipShape: "round",
    sizeControl: "off",
    angleControl: "off",
    roundnessControl: "off",
    opacityControl: "off",
    flowControl: "off",
    erodibleTip: { sharpness: 70, flatness: 35, erosionRate: 50, softness: 20, aspectRatio: 80, rotation: 0 },
    bristleTip: { length: 65, density: 55, thickness: 35, stiffness: 55, splay: 35, wetness: 25 },
    mixer: { wet: 55, load: 60, mix: 50, flow: 100, sampleAllLayers: false, cleanAfterStroke: false },
    colorReplacement: { sampling: "continuous", limits: "contiguous", mode: "color", tolerance: 32, antiAlias: true },
    artHistory: { style: "tight-medium", area: 24, fidelity: 60 },
  },
  gradient: { type: "linear", reverse: false },
  paintBucket: { tolerance: 32, contiguous: true },
  eraser: {
    sampling: "continuous",
    limits: "find-edges",
    tolerance: 42,
    antiAlias: true,
    protectForeground: false,
  },
  cloneSource: {
    activePresetId: null,
    presets: [],
    aligned: true,
    sample: "current-layer",
    scale: 100,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    showOverlay: false,
  },
  symmetry: { enabled: false, axis: "vertical" },
  brushPresets: DEFAULT_BRUSH_PRESETS,
  clipboard: null,
  styleClipboard: null,
  closedDocuments: [],
  documentLifecycle: {
    [initialDoc.id]: makeDocumentLifecycle(initialDoc, 0),
  },
  activeSmartFilterMaskTarget: null,
  transform: null,
  /** Current selection options for selection tools */
  selectionOptions: {
    mode: "new",
    feather: 0,
    antiAlias: true,
    tolerance: 32,
    contiguous: true,
    sampleAllLayers: false,
    sampleSize: "point",
    autoEnhance: false,
    quickGrowAmount: 3,
    magneticWidth: 12,
    magneticContrast: 24,
    magneticHysteresis: 45,
    magneticSmoothing: 35,
    magneticFrequency: 57,
    magneticPenPressure: false,
  },
  histories: {
    [initialDoc.id]: {
      entries: [
        {
          id: "history_initial",
          label: "New Document",
          layers: snapshotLayers(initialDoc),
          activeLayerId: initialDoc.activeLayerId,
          selectedLayerIds: [...initialDoc.selectedLayerIds],
        },
      ],
      index: 0,
    },
  },
  snapshots: {
    [initialDoc.id]: [],
  },
  actions: [],
  recordingActionId: null,
  isPlayingAction: false,
}

/* ---- localStorage persistence for user settings ---- */
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
  // React's useReducer gets an identity "commit" reducer rather than the real
  // one: `dispatch` below runs the real reducer exactly once and commits the
  // precomputed state here verbatim. The real reducer is impure (it generates
  // layer/history IDs and schedules async snapshot compression), so letting
  // useReducer re-run it would execute every action twice — diverging React
  // state from stateRef and double-scheduling side effects.
  const [state, rawDispatch] = React.useReducer(
    (_prev: EditorState, committed: EditorState) => committed,
    initialState,
  )
  const stateRef = React.useRef(state)
  stateRef.current = state
  const historyJumpSchedulerRef = React.useRef<HistoryJumpScheduler | null>(null)
  const performHistoryJumpRef = React.useRef<(index: number) => void>(() => {})
  // Tracks whether the current dispatch should be flushed urgently (sync
  // render) or deferred via React.startTransition (non-blocking render).
  // High-frequency dispatches like "push-history" set this to true so the
  // pointer-up handler can return immediately while the render happens
  // off the critical path. The reducer state itself is computed
  // synchronously and stored in stateRef regardless, so any subsequent
  // dispatch that reads stateRef sees the latest value.
  const dispatch = React.useCallback((action: Action) => {
    const before = stateRef.current
    // Run the reducer once, here, so stateRef is always current immediately
    // after dispatch returns. This is critical for correctness of code that
    // reads `stateRef.current` between renders (e.g. the next commit() in a
    // rapid stroke sequence, or keyboard handlers that consult history
    // bounds via the context's stepHistoryBy callback). Without this, a
    // deferred React render would leave stateRef stale and re-introduce the
    // race where Ctrl+Z jumps further than expected.
    let next = reducer(before, action)
    const dirtyDocs = dirtyDocIdsForAction(action, before, next)
    for (const docId of dirtyDocs) {
      next = reducer(next, { type: "mark-document-dirty", id: docId })
    }
    stateRef.current = next
    if (HISTORY_CONTEXT_INVALIDATING_ACTION_TYPES.has(action.type)) {
      // A new branch, floor, snapshot restore, or active timeline invalidates
      // any pending undo/redo target left by an earlier step.
      historyJumpSchedulerRef.current?.cancel()
    }

    // Schedule the React render. For high-frequency, non-urgent updates
    // (history pushes during painting), use startTransition so React doesn't
    // block the pointer-up handler with the cascading re-render of the 60+
    // context consumers. Urgent UI changes (tool selection, dialog open
    // etc.) still render synchronously.
    const isHighFrequency = HIGH_FREQUENCY_ACTION_TYPES.has(action.type)
    const flush = () => {
      rawDispatch(next)
    }
    if (isHighFrequency) {
      React.startTransition(flush)
    } else {
      flush()
    }
  }, [])

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
  // push-history dispatch was deferred via startTransition (so the React
  // re-render hasn't committed yet and `useEditor().historyIndex` still
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

  const selectorStoreRef = React.useRef<EditorSelectorStore<EditorContextValue> | null>(null)
  if (!selectorStoreRef.current) selectorStoreRef.current = createEditorSelectorStore(value)
  React.useLayoutEffect(() => {
    selectorStoreRef.current?.setSnapshot(value)
  }, [value])
  const selectorStore = selectorStoreRef.current

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
    <EditorRenderContext.Provider value={renderContextValue}>
    <EditorSelectorContext.Provider value={selectorStore}>
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
    </EditorSelectorContext.Provider>
    </EditorRenderContext.Provider>
  )
}

export function useEditor() {
  const ctx = React.useContext(EditorContext)
  if (!ctx) throw new Error("useEditor must be used within EditorProvider")
  return ctx
}

export function useEditorSelector<T>(selector: (value: EditorContextValue) => T): T {
  const store = React.useContext(EditorSelectorContext) as EditorSelectorStore<EditorContextValue> | null
  if (!store) throw new Error("useEditorSelector must be used within EditorProvider")
  return React.useSyncExternalStore(
    store.subscribe,
    () => selector(store.getSnapshot()),
    () => selector(store.getSnapshot()),
  )
}

export function useActiveDocument() {
  return useEditorSelector((editor) => editor.activeDoc)
}

export function useActiveLayer() {
  return useEditorSelector((editor) => editor.activeLayer)
}

export function useToolState() {
  const activeSmartFilterMaskTarget = useEditorSelector((editor) => editor.activeSmartFilterMaskTarget)
  const background = useEditorSelector((editor) => editor.background)
  const brush = useEditorSelector((editor) => editor.brush)
  const cloneSource = useEditorSelector((editor) => editor.cloneSource)
  const eraser = useEditorSelector((editor) => editor.eraser)
  const foreground = useEditorSelector((editor) => editor.foreground)
  const gradient = useEditorSelector((editor) => editor.gradient)
  const paintBucket = useEditorSelector((editor) => editor.paintBucket)
  const selectionOptions = useEditorSelector((editor) => editor.selectionOptions)
  const symmetry = useEditorSelector((editor) => editor.symmetry)
  const tool = useEditorSelector((editor) => editor.tool)
  const transform = useEditorSelector((editor) => editor.transform)
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

export { makeCanvas, cloneCanvas, makeHistoryEntry, prepareEntryForRestore }
