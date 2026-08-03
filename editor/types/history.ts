/** Undo history entries, layer snapshots and macros. */

import type { ColorSampler, CountMarker, Guide, LayerMetadata, LayerNote, Note, Slice } from "@/editor/types/annotations"
import type { BlendMode } from "@/editor/types/core"
import type { AssetLibraryItem, DocumentModeSettings, LayerComp, PsDocument } from "@/editor/types/document"
import type { AdjustmentProps, AdvancedBlending, ArtboardProps, FrameProps, Layer, LayerKind, LayerStyle, SmartFilter } from "@/editor/types/layers"
import type { ThreeDScene, VariableDataSet, VideoLayerProps } from "@/editor/types/rendering"
import type { AlphaChannel, QuickMaskPaintMode, Selection } from "@/editor/types/selection"
import type { PathProps, ShapeProps, TextProps } from "@/editor/types/typography"


export interface CanvasPatch {
  x: number
  y: number
  w: number
  h: number
  canvas: HTMLCanvasElement
}

/** A snapshot of one layer's pixels + metadata, used by history. */
export interface LayerSnapshot {
  id: string
  name: string
  kind?: LayerKind
  visible: boolean
  locked: boolean
  lockTransparency?: boolean
  lockDraw?: boolean
  lockMove?: boolean
  lockAll?: boolean
  smartObject?: boolean
  opacity: number
  fillOpacity?: number
  advancedBlending?: AdvancedBlending
  blendMode: BlendMode
  linkGroupId?: string
  canvas: HTMLCanvasElement | null
  canvasPatches?: CanvasPatch[]
  mask?: HTMLCanvasElement | null
  maskEnabled?: boolean
  vectorMask?: PathProps | null
  clipped?: boolean
  style?: LayerStyle
  childIds?: string[]
  parentId?: string
  expanded?: boolean
  text?: TextProps
  shape?: ShapeProps
  path?: PathProps
  adjustment?: AdjustmentProps
  frame?: FrameProps
  artboard?: ArtboardProps
  threeD?: ThreeDScene
  video?: VideoLayerProps
  colorLabel?: Layer["colorLabel"]
  smartFilters?: SmartFilter[]
  smartSource?: Layer["smartSource"]
  notes?: LayerNote[]
  metadata?: LayerMetadata
}

export interface HistoryEntry {
  id: string
  label: string
  layers: LayerSnapshot[]
  activeLayerId: string
  selectedLayerIds: string[]
  thumb?: string
  width?: number
  height?: number
  selection?: Selection
  guides?: Guide[]
  notes?: Note[]
  slices?: Slice[]
  counts?: CountMarker[]
  colorSamplers?: ColorSampler[]
  comps?: LayerComp[]
  channels?: AlphaChannel[]
  quickMask?: boolean
  quickMaskCanvas?: HTMLCanvasElement | null
  quickMaskPaintMode?: QuickMaskPaintMode
  colorMode?: PsDocument["colorMode"]
  modeSettings?: DocumentModeSettings
  variableDataSets?: VariableDataSet[]
  assetLibrary?: AssetLibraryItem[]
}

export interface HistorySnapshot {
  id: string
  name: string
  createdAt: number
  entry: HistoryEntry
}

export interface MacroStep {
  id: string
  label: string
  createdAt: number
  entry: HistoryEntry
}

export interface MacroAction {
  id: string
  name: string
  folder?: string
  createdAt: number
  updatedAt: number
  steps: MacroStep[]
}
