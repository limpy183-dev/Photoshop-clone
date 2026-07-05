import type * as React from "react"
import type { ChangedLayerIds } from "./editor-history-geometry"
import type { Action,ActiveSmartFilterMaskTarget,DocumentLifecycleState,EditorState } from "./editor-reducer"
import type { PurgeResult,PurgeTarget } from "./purge-commands"
import type { MergedRenderChange,RenderChange } from "./render-bus"
import type { BrushPreset,BrushSettings,CloneSourceSettings,EraserSettings,GradientSettings,HistoryEntry,HistorySnapshot,Layer,LayerKind,LayerStyle,MacroAction,PaintBucketSettings,PsDocument,SelectionOptions,SymmetrySettings,ToolId,TransformState } from "./types"

export interface EditorContextValue {
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
   * frame-coalesced for nonessential UI projection updates.
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

export interface EditorRenderContextValue {
  requestRender: (change?: RenderChange) => void
  subscribeRender: (cb: (change: MergedRenderChange) => void) => () => void
}

export interface EditorCommands {
  dispatch: React.Dispatch<Action>
  commit: (label: string, changedLayerIds?: ChangedLayerIds) => void
  requestRender: (change?: RenderChange) => void
  subscribeRender: (cb: (change: MergedRenderChange) => void) => () => void
}
