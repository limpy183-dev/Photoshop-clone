import { makeCanvas } from "./canvas-utils"
import {
type EditorGlobalLight
} from "./editor-global-light"
import {
type ChangedLayerIds,
type LayerAlignMode,
type LayerDistributeAxis,
type SelectionChannelLoadMode
} from "./editor-history-geometry"
import { type FlattenTransparencyAlphaMode } from "./flatten-transparency"
import type {
AdjustmentProps,
AdvancedBlending,
AlphaChannel,
AssetLibraryItem,
BlendMode,
BrushPreset,
BrushSettings,
CloneSourceSettings,
ColorManagementSettings,
ColorSampler,
CountMarker,
DocumentMetadata,
DocumentModeSettings,
DocumentReport,
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
LayerStyle,
MacroAction,
MacroStep,
Note,
PaintBucketSettings,
PathProps,
PluginDescriptor,
PrintSettings,
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
VideoLayerProps
} from "./types"
import { uid } from "./uid"

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

export type DocumentIds = {
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

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export function isLayerLocked(layer: Layer | undefined | null) {
  return !!layer && (layer.locked || layer.lockAll)
}

export function blocksLayerMove(layer: Layer | undefined | null) {
  return isLayerLocked(layer) || !!layer?.lockMove
}

export function layerCommandTargetIds(doc: PsDocument, ids: string[] | undefined, all = false) {
  if (all) return new Set(doc.layers.map((layer) => layer.id))
  const source = ids?.length ? ids : doc.selectedLayerIds.length ? doc.selectedLayerIds : [doc.activeLayerId]
  return new Set(source.filter(Boolean))
}

export type GlobalLight = EditorGlobalLight

/* ---------------------------- state shape ------------------------------ */

export interface DocHistory {
  entries: HistoryEntry[]
  index: number
}

export interface ClosedDocumentRecord {
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

export interface EditorState {
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

export function changedLayerIdsForHistoryLog(changedLayerIds: ChangedLayerIds | undefined): string[] | undefined {
  if (!changedLayerIds) return undefined
  if (changedLayerIds === "all") return ["all"]
  if (Array.isArray(changedLayerIds)) return [...(changedLayerIds as readonly string[])]
  return "ids" in changedLayerIds && changedLayerIds.ids?.length ? [...changedLayerIds.ids] : undefined
}

export function toolSettingsForHistoryLog(state: EditorState): Record<string, unknown> | undefined {
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

export const DEFAULT_BRUSH_PRESETS: BrushPreset[] = [
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
export const BRUSH_PRESET_VISUAL_RESET: Partial<BrushSettings> = {
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

export function applyBrushPreset(current: BrushSettings, preset: BrushPreset): BrushSettings {
  return {
    ...current,
    ...BRUSH_PRESET_VISUAL_RESET,
    size: preset.size,
    hardness: preset.hardness,
    spacing: preset.spacing,
    ...(preset.settings ?? {}),
  }
}

export const HIGH_FREQUENCY_ACTION_TYPES = new Set<Action["type"]>([
  "push-history",
])

export const HISTORY_CONTEXT_INVALIDATING_ACTION_TYPES = new Set<Action["type"]>([
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

export type EditorTransitionEffect =
  | { type: "release-history-entries"; entries: HistoryEntry[] }
  | { type: "schedule-history-compression"; entries: HistoryEntry[]; currentIndex: number }

export interface EditorTransitionEffectServices {
  releaseEntries?: (entries: HistoryEntry[]) => void
  scheduleCompression?: (entries: HistoryEntry[], currentIndex: number) => void
}

export interface EditorTransitionServices {
  makeId?: (prefix: string) => string
  now?: () => number
}

export function releaseHistoryEntriesEffect(effects: EditorTransitionEffect[], entries: HistoryEntry[] | undefined) {
  if (entries?.length) effects.push({ type: "release-history-entries", entries })
}

export function mutateActiveDoc(state: EditorState, fn: (d: PsDocument) => PsDocument): EditorState {
  if (!state.activeDocId) return state
  return {
    ...state,
    documents: state.documents.map((d) => (d.id === state.activeDocId ? fn(d) : d)),
  }
}


