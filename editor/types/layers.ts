/** Layer model: kinds, styles, blending, smart objects, adjustments. */

import type { LayerMetadata, LayerNote } from "@/editor/types/annotations"
import type { BlendMode } from "@/editor/types/core"
import type { ThreeDScene, VideoGroupProps, VideoLayerProps } from "@/editor/types/rendering"
import type { MultiGradient, PathProps, ShapeProps, TextProps } from "@/editor/types/typography"


export type LayerKind =
  | "raster"
  | "text"
  | "shape"
  | "group"
  | "smart-object"
  | "adjustment"
  | "frame"
  | "artboard"
  | "3d"
  | "video"

export interface LayerStyle {
  stroke?: {
    enabled: boolean
    color: string
    size: number
    position: "inside" | "outside" | "center"
    opacity?: number
    blendMode?: BlendMode
    fillType?: "color" | "gradient"
    gradient?: MultiGradient
  }
  outerGlow?: {
    enabled: boolean
    color: string
    size: number
    opacity: number
    blendMode?: BlendMode
    spread?: number
    range?: number
    noise?: number
    contour?: "linear" | "soft" | "sharp" | "ring" | "cone"
  }
  innerGlow?: {
    enabled: boolean
    color: string
    size: number
    opacity: number
    blendMode?: BlendMode
    source?: "edge" | "center"
    choke?: number
    range?: number
    noise?: number
    contour?: "linear" | "soft" | "sharp" | "ring" | "cone"
  }
  innerShadow?: {
    enabled: boolean
    color: string
    size: number
    offsetX: number
    offsetY: number
    opacity: number
    blendMode?: BlendMode
    angle?: number
    distance?: number
    choke?: number
    useGlobalLight?: boolean
  }
  bevel?: {
    enabled: boolean
    style: "inner" | "outer" | "emboss" | "pillow"
    direction?: "up" | "down"
    depth: number
    size: number
    soften: number
    angle: number
    altitude: number
    highlight: string
    shadow: string
    opacity: number
    highlightOpacity?: number
    shadowOpacity?: number
    highlightBlendMode?: BlendMode
    shadowBlendMode?: BlendMode
    useGlobalLight?: boolean
    contour?: "linear" | "soft" | "sharp" | "ring" | "cone"
  }
  satin?: {
    enabled: boolean
    color: string
    angle: number
    distance: number
    size: number
    opacity: number
    blendMode?: BlendMode
    invert?: boolean
  }
  colorOverlay?: { enabled: boolean; color: string; opacity: number; blendMode?: BlendMode }
  gradientOverlay?: {
    enabled: boolean
    gradient: MultiGradient
    opacity: number
    blendMode?: BlendMode
  }
  patternOverlay?: {
    enabled: boolean
    pattern: "checker" | "dots" | "lines" | "noise" | string
    scale: number
    opacity: number
    color?: string
    blendMode?: BlendMode
    align?: boolean
    phase?: { x: number; y: number }
  }
  dropShadow?: {
    enabled: boolean
    color: string
    size: number
    offsetX: number
    offsetY: number
    opacity: number
    blendMode?: BlendMode
    angle?: number
    distance?: number
    spread?: number
    noise?: number
    useGlobalLight?: boolean
    contour?: "linear" | "soft" | "sharp" | "ring" | "cone"
  }
}

export interface BlendIfRange {
  black: number
  blackFeather: number
  whiteFeather: number
  white: number
}

/** Channel selector for Blend If sliders. "gray" matches Photoshop's luminance default. */
export type BlendIfChannel = "gray" | "r" | "g" | "b"

/** Optional per-channel Blend If ranges. Missing entries default to a full pass-through range. */
export type BlendIfChannels = Partial<Record<BlendIfChannel, BlendIfRange>>

export interface AdvancedBlending {
  fillOpacity: number
  knockout: "none" | "shallow" | "deep"
  channels: { r: boolean; g: boolean; b: boolean }
  blendIfThis: BlendIfRange
  blendIfUnderlying: BlendIfRange
  /** Per-channel Blend If overrides for the source ("This Layer") slider. Gray range mirrors blendIfThis. */
  blendIfThisChannels?: BlendIfChannels
  /** Per-channel Blend If overrides for the underlying-layer slider. Gray range mirrors blendIfUnderlying. */
  blendIfUnderlyingChannels?: BlendIfChannels
  /** UI-only: which channel the Blend If sliders are currently editing. */
  blendIfActiveChannel?: BlendIfChannel
  /** When false, layer effects use a full layer rectangle instead of the layer's transparency. Defaults true. */
  transparencyShapesLayer?: boolean
  /** When true, the raster layer mask also clips layer effects. Defaults false. */
  layerMaskHidesEffects?: boolean
  /** When true, the vector mask also clips layer effects. Defaults false. */
  vectorMaskHidesEffects?: boolean
}

export interface BlurGalleryMeshResource {
  signature: "8BIM"
  resourceKey: "blurGalleryMesh"
  version: 1
  descriptor: {
    filterId: string
    params: Record<string, number | string | boolean>
    controlState: {
      selectedFieldPinIndexes: number[]
      selectedPathPointIndexes: number[]
      activeControl: string | null
      previewQuality: "full" | "interactive"
    }
    mesh:
      | { kind: "field"; pins: { x: number; y: number; blur: number }[]; falloff: number; blur: number }
      | { kind: "iris"; center: { x: number; y: number }; radius: number; ellipseWidth?: number; ellipseHeight?: number; rotation?: number; feather: number; blur: number }
      | { kind: "tilt"; center: { x: number; y: number }; angle: number; radius: number; feather: number; blur: number }
      | { kind: "path"; points: { x: number; y: number }[]; distance: number; taper: number; angle: number }
      | { kind: "spin"; center: { x: number; y: number }; radius: number; amount: number }
  }
  payloadBase64: string
  checksum: string
}

export interface SmartFilter {
  id: string
  filterId: string
  name: string
  enabled: boolean
  opacity?: number
  blendMode?: BlendMode
  params: Record<string, number | string | boolean>
  mask?: HTMLCanvasElement | null
  maskEnabled?: boolean
  /** 0 disables the mask influence; 1 applies mask pixels fully. */
  maskDensity?: number
  /** Feather radius in document pixels for the smart filter mask. */
  maskFeather?: number
  /** False keeps the filter mask independent from layer movement/placement workflows. */
  maskLinked?: boolean
  /** Deterministic browser-side descriptor for Blur Gallery pins/path/mesh state. */
  blurGalleryMesh?: BlurGalleryMeshResource
}

export interface SmartObjectEditPackage {
  id: string
  name: string
  version: number
  createdAt: number
  updatedAt: number
  documentId?: string
  layerCount?: number
  sourceHash?: string
}

export interface SmartObjectSource {
  width: number
  height: number
  canvas?: HTMLCanvasElement | null
  id?: string
  name?: string
  linkType?: "embedded" | "linked"
  fileName?: string
  relativePath?: string
  status?: "current" | "missing" | "modified" | "embedded"
  embedded?: boolean
  updatedAt?: number
  fileHandle?: FileSystemFileHandle
  fileHandleName?: string
  handlePermission?: PermissionState | "unsupported"
  lastKnownModified?: number
  lastKnownSize?: number
  sourceHash?: string
  editPackage?: SmartObjectEditPackage
  exportedAt?: number
  relinkedAt?: number
}

export type AdjustmentType =
  | "brightness-contrast"
  | "levels"
  | "curves"
  | "exposure"
  | "vibrance"
  | "hue-saturation"
  | "color-balance"
  | "black-white"
  | "photo-filter"
  | "channel-mixer"
  | "color-lookup"
  | "invert"
  | "posterize"
  | "threshold"
  | "gradient-map"
  | "selective-color"
  | "shadows-highlights"
  | "hdr-toning"
  | "desaturate"
  | "match-color"
  | "replace-color"
  | "equalize"

export interface AdjustmentProps {
  type: AdjustmentType
  /** Free-form params per adjustment type. */
  params: Record<string, number | string | boolean>
}

export interface FrameProps {
  shape: "rect" | "ellipse"
  x: number
  y: number
  w: number
  h: number
  /** Optional fitted image dataURL or canvas. */
  imageCanvas?: HTMLCanvasElement | null
}

export interface ArtboardProps {
  x: number
  y: number
  w: number
  h: number
  background: string
}

export interface Layer {
  id: string
  name: string
  kind?: LayerKind
  visible: boolean
  locked: boolean
  /** Granular Photoshop-style locks */
  lockTransparency?: boolean
  lockDraw?: boolean
  lockMove?: boolean
  lockAll?: boolean
  smartObject?: boolean
  opacity: number
  /** Fill opacity dims only layer pixels, not layer styles. 0..1 */
  fillOpacity?: number
  advancedBlending?: AdvancedBlending
  blendMode: BlendMode
  linkGroupId?: string
  canvas: HTMLCanvasElement
  /** Optional grayscale mask canvas - white reveals, black hides. */
  mask?: HTMLCanvasElement | null
  /** False keeps the mask stored but temporarily disables it in compositing. */
  maskEnabled?: boolean
  /** Optional vector path mask (rendered as grayscale mask before composite). */
  vectorMask?: PathProps | null
  /** Whether this layer is clipped to the layer beneath it. */
  clipped?: boolean
  style?: LayerStyle
  childIds?: string[]
  parentId?: string
  expanded?: boolean
  text?: TextProps
  shape?: ShapeProps
  path?: PathProps
  /** Adjustment-layer config when kind === "adjustment". */
  adjustment?: AdjustmentProps
  /** Frame-layer config when kind === "frame". */
  frame?: FrameProps
  /** Artboard config when kind === "artboard". */
  artboard?: ArtboardProps
  /** Browser-native 3D scene metadata and rasterized preview when kind === "3d". */
  threeD?: ThreeDScene
  /** Browser-native video layer metadata and current-frame pixels when kind === "video". */
  video?: VideoLayerProps
  videoGroup?: VideoGroupProps
  /** User-controlled color tag for organization. */
  colorLabel?: "none" | "red" | "orange" | "yellow" | "green" | "blue" | "violet" | "gray"
  /** App-only notes attached directly to this layer. */
  notes?: LayerNote[]
  /** App-only searchable metadata attached directly to this layer. */
  metadata?: LayerMetadata
  smartFilters?: SmartFilter[]
  smartSource?: SmartObjectSource
}
