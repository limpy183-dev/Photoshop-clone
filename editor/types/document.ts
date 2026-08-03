/** Document model: colour management, metadata, print, comps, assets. */

import type { ColorSampler, CountMarker, Guide, LayerMetadata, LayerNote, Note, Slice } from "@/editor/types/annotations"
import type { BlendMode } from "@/editor/types/core"
import type { AdjustmentProps, AdvancedBlending, Layer, LayerKind, LayerStyle, SmartFilter } from "@/editor/types/layers"
import type { PluginDescriptor, VariableDataSet } from "@/editor/types/rendering"
import type { AlphaChannel, QuickMaskPaintMode, Selection } from "@/editor/types/selection"
import type { TimelineFrame, TimelineSettings } from "@/editor/types/timeline"
import type { MultiGradient, PathProps, ShapeProps, TextProps } from "@/editor/types/typography"


export interface DocumentModeSettings {
  mode: "RGB" | "CMYK" | "Grayscale" | "Duotone" | "Indexed" | "Multichannel" | "Bitmap"
  duotone?: {
    /** Number of inks: 1=mono, 2=duo, 3=tri, 4=quad. Defaults to 2 for back-compat. */
    inkCount?: 1 | 2 | 3 | 4
    ink1: string
    ink2: string
    ink3?: string
    ink4?: string
    /** Legacy single curve exponent (kept for back-compat). */
    curve: number
    ink1Name?: string
    ink2Name?: string
    ink3Name?: string
    ink4Name?: string
    /** Simulated paper/base color used by browser-local duotone previews and conversions. */
    paper?: string
    /** Ink compositing approximation: normal replaces toward ink; multiply simulates overprint buildup. */
    overprint?: "normal" | "multiply"
    opacity1?: number
    opacity2?: number
    opacity3?: number
    opacity4?: number
    balance?: number
    /** Per-ink response curve (13 control points 0..255 mapping input coverage). */
    curves?: { ink1?: number[]; ink2?: number[]; ink3?: number[]; ink4?: number[] }
    /** Optional preset key the dialog last applied. */
    preset?: string
  }
  indexed?: {
    colors: number
    dither: boolean
    palette?: "adaptive" | "perceptual" | "web" | "uniform" | "grayscale" | "custom" | "selective" | "exact" | "system"
    ditherMethod?: "none" | "ordered" | "diffusion" | "noise"
    /** Dither amount 0..100. Defaults to 75. */
    ditherAmount?: number
    colorTable?: string[]
    transparency?: boolean
    matte?: string
    forced?: "none" | "black-white" | "primaries" | "web"
    /** When true, palette-exact pixels skip dithering and pass through unchanged. */
    preserveExact?: boolean
  }
  multichannel?: { channels: { r: boolean; g: boolean; b: boolean; c?: boolean; m?: boolean; y?: boolean; k?: boolean } }
  bitmap?: {
    method: "threshold" | "halftone" | "pattern-dither" | "diffusion-dither"
    threshold: number
    frequency: number
    angle: number
    shape?: "round" | "line" | "diamond" | "ellipse" | "square" | "cross"
    /** Source resolution used when matching Photoshop's Bitmap input/output controls. */
    inputResolution?: number
    outputResolution?: number
  }
  trap?: { enabled: boolean; widthPx: number; strength: number }
}

export interface LayerComp {
  id: string
  name: string
  /** Snapshot of visibility, appearance metadata, masks, and editable layer props per layer. */
  state: Record<
    string,
    {
      visible: boolean
      opacity: number
      fillOpacity?: number
      advancedBlending?: AdvancedBlending
      blendMode: BlendMode
      clipped?: boolean
      maskEnabled?: boolean
      vectorMask?: PathProps | null
      style?: LayerStyle
      text?: TextProps
      shape?: ShapeProps
      path?: PathProps
      adjustment?: AdjustmentProps
      smartFilters?: SmartFilter[]
      colorLabel?: Layer["colorLabel"]
      notes?: LayerNote[]
      metadata?: LayerMetadata
    }
  >
  activeLayerId?: string
  selectedLayerIds?: string[]
  createdAt?: number
  updatedAt?: number
}

export interface AssetLibraryItem {
  id: string
  name: string
  kind:
    | "brush"
    | "gradient"
    | "pattern"
    | "style"
    | "swatch"
    | "shape"
    | "export"
    | "tool-preset"
    | "plugin"
    | "cloud-library"
    | "stock"
    | "font"
    | "icc-profile"
    | "variable-data"
    | "prepress"
  group?: string
  tags?: string[]
  description?: string
  payload: unknown
  createdAt: number
  updatedAt?: number
}

export interface DocumentReport {
  id: string
  title: string
  createdAt: number
  source: "PSD Import" | "PSD Export" | "Project Import" | "Project Export" | "Batch Export" | "Image Assets Generator"
  items: { label: string; status: "preserved" | "approximated" | "flattened" | "unsupported" | "info"; detail: string }[]
}

export interface ImageAssetGeneratorSettings {
  enabled?: boolean
  autoExportOnSave?: boolean
  autoExportOnChange?: boolean
  outputFolderName?: string
  lastRunAt?: number
  lastTrigger?: "manual" | "save" | "change"
  lastSummary?: string
}

export interface DocumentMetadata {
  title?: string
  author?: string
  description?: string
  copyright?: string
  keywords?: string[]
  credit?: string
  source?: string
  createdAt?: string
  modifiedAt?: string
  /** Local, browser-generated provenance manifests inspired by Content Credentials. */
  contentCredentials?: ContentCredential[]
  /** Browser-safe overview plus full-resolution tile access for oversized PSB files. */
  largeDocumentTileView?: LargeDocumentTileViewMetadata
  /** Read-only parsed-file fallback when pixels cannot be opened safely. */
  largeDocumentInspection?: LargeDocumentInspectionMetadata
  /** Full-resolution tile document opened from a tile-only parent. */
  largeDocumentTileEdit?: LargeDocumentTileEditMetadata
  /** Focused import repair actions for PSD layer/resource structures represented locally. */
  psdRepairPlan?: PsdRepairPlanMetadata
  /** Exact original PSD/PSB bytes retained for native-source replay when the file is small enough. */
  psdNativeSource?: PsdNativeSourceSnapshotMetadata
  /** Photoshop Generator-style layer-name asset export settings. */
  imageAssetGenerator?: ImageAssetGeneratorSettings
}

export interface PsdNativeSourceSnapshotMetadata {
  kind: "psd-native-source"
  version: 1
  sourceName: string
  format: "psd" | "psb"
  byteLength: number
  width?: number
  height?: number
  colorMode?: string
  bitDepth?: number
  checksum: string
  encoding: "base64"
  data: string
}

export interface PsdParsedStructureMetadata {
  layerCount?: number
  colorMode?: string
  bitDepth?: number
  resources?: string[]
  repairableItems?: string[]
}

export interface PsdRepairPlanMetadata {
  summary: string
  actions: {
    label: string
    status: "represented" | "repairable" | "inspect-only"
    localRepresentation: string
    detail: string
  }[]
}

export interface LargeDocumentTileViewMetadata {
  mode: "psb-tile-view"
  sourceName: string
  originalWidth: number
  originalHeight: number
  overviewScale: number
  tileSize: number
  tileColumns: number
  tileRows: number
  tileCount: number
  selectedTile?: { col: number; row: number }
}

export interface LargeDocumentInspectionMetadata {
  mode: "inspection"
  sourceName: string
  kind: "raster" | "psd" | "psb" | "project" | "advanced"
  originalWidth: number
  originalHeight: number
  previewWidth: number
  previewHeight: number
  editable: false
  reason: string
  warnings: string[]
  parsedStructure?: PsdParsedStructureMetadata
}

export interface LargeDocumentTileEditMetadata {
  mode: "tile-edit"
  parentDocId: string
  sourceName: string
  originalWidth: number
  originalHeight: number
  tileSize: number
  tile: {
    col: number
    row: number
    x: number
    y: number
    width: number
    height: number
  }
  editable: true
}

export interface ContentCredential {
  id: string
  action: string
  actor: string
  software: string
  createdAt: string
  documentName: string
  documentHash: string
  layerCount: number
  dimensions: { width: number; height: number }
  ingredients: { id: string; name: string; kind?: LayerKind; visible: boolean; hash: string }[]
  assertion: string
}

export type ColorProfileName =
  | "sRGB IEC61966-2.1"
  | "Display P3"
  | "Adobe RGB (1998)"
  | "ProPhoto RGB"
  | "Working CMYK"
  | "U.S. Web Coated SWOP v2"
  | "Japan Color 2001 Coated"
  | "Dot Gain 20%"
  | "Gray Gamma 2.2"

export interface ColorManagementSettings {
  assignedProfile: ColorProfileName
  workingSpace: ColorProfileName
  renderingIntent: "perceptual" | "relative-colorimetric" | "saturation" | "absolute-colorimetric"
  blackPointCompensation: boolean
  proofProfile: "None" | ColorProfileName
  proofColors: boolean
  gamutWarning: boolean
  simulateBlackInk?: boolean
  preserveNumbers?: boolean
  proofChannels?: Array<"red" | "green" | "blue" | "cyan" | "magenta" | "yellow" | "black" | "gray">
  proofPlateView?: "composite" | "ink" | "mask"
}

export interface PrintSettings {
  paperSize: "Letter" | "A4" | "A3" | "Tabloid" | "Custom"
  orientation: "portrait" | "landscape"
  scale: number
  bleedMm: number
  cropMarks: boolean
  registrationMarks: boolean
  centerCropMarks?: boolean
  colorBars?: boolean
  description?: boolean
  labels?: boolean
  colorHandling: "app" | "printer"
  proofPrint: boolean
  printerProfile?: ColorManagementSettings["proofProfile"]
  paperColor?: string
  marksOffsetMm?: number
  pagePosition?: "center" | "top-left"
}

export interface PsDocument {
  id: string
  name: string
  width: number
  height: number
  zoom: number
  layers: Layer[]
  activeLayerId: string
  selectedLayerIds: string[]
  background: string
  colorMode: DocumentModeSettings["mode"]
  bitDepth: 8 | 16 | 32
  selection: Selection
  rotation?: 0 | 90 | 180 | 270
  guides?: Guide[]
  showGrid?: boolean
  showSmartGuides?: boolean
  gridSize?: number
  snap?: boolean
  snapToGrid?: boolean
  snapToGuides?: boolean
  quickMask?: boolean
  quickMaskCanvas?: HTMLCanvasElement | null
  quickMaskPaintMode?: QuickMaskPaintMode
  /** Collaborative notes attached to the doc. */
  notes?: Note[]
  /** Web export slices. */
  slices?: Slice[]
  /** Active slice selected by the Slice Select tool/panel. */
  selectedSliceId?: string
  /** Count tool markers (per-group). */
  counts?: CountMarker[]
  countGroup?: string
  /** Persistent color sampler readouts from the Color Sampler tool. */
  colorSamplers?: ColorSampler[]
  /** Saved layer comps. */
  comps?: LayerComp[]
  /** Active ruler measurement (HUD info). */
  measurement?: {
    x1: number
    y1: number
    x2: number
    y2: number
  } | null
  /** Saved alpha channels for selection save/load. */
  channels?: AlphaChannel[]
  rulerUnits?: "px" | "in" | "cm" | "mm" | "pt" | "pc"
  rulerOrigin?: { x: number; y: number }
  gridColor?: string
  gridSubdivisions?: number
  gridOpacity?: number
  showPixelGrid?: boolean
  globalLight?: { angle: number; altitude: number }
  patternLibrary?: { id: string; name: string; type: "checker" | "dots" | "lines" | "noise"; color: string; scale: number }[]
  stylePresets?: { id: string; name: string; style: LayerStyle }[]
  gradientPresets?: { id: string; name: string; gradient: MultiGradient }[]
  characterStyles?: Record<string, Partial<TextProps>>
  paragraphStyles?: Record<string, Record<string, number | string | boolean>>
  assetLibrary?: AssetLibraryItem[]
  timelineFrames?: TimelineFrame[]
  timelineSettings?: TimelineSettings
  plugins?: PluginDescriptor[]
  pluginStorage?: Record<string, Record<string, unknown>>
  variableDataSets?: VariableDataSet[]
  modeSettings?: DocumentModeSettings
  reports?: DocumentReport[]
  metadata?: DocumentMetadata
  colorManagement?: ColorManagementSettings
  printSettings?: PrintSettings
  smartObjectParent?: { docId: string; layerId: string }
  /** Dots per inch resolution metadata. */
  dpi?: number
}
