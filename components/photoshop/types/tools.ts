import type { CustomShapeId, GradientStop } from "./typography"

export interface BrushSettings {
  size: number
  hardness: number
  opacity: number
  flow: number
  smoothing: number
  spacing?: number
  tipShape?: "round" | "square" | "bristle" | "erodible"
  erodibleTip?: {
    sharpness: number
    flatness: number
    erosionRate: number
    softness: number
    aspectRatio: number
    rotation: number
    /**
     * Accumulated wear across strokes (0-100). Increments while painting,
     * driving the heightfield simulation; reset by "Sharpen Tip".
     */
    wear?: number
    /** Tip silhouette shape — controls the unworn profile. */
    shape?: "round" | "flat" | "chisel" | "calligraphic"
  }
  bristleTip?: {
    length: number
    density: number
    thickness: number
    stiffness: number
    splay: number
    wetness: number
    /** Number of bristles modelled. When omitted, derived from density. */
    bristles?: number
    /** Bristle bundle rotation in degrees relative to the stroke direction. */
    angle?: number
    /** Stroke spacing override for bristle dabs as % of tip size. */
    spacing?: number
  }
  sizeControl?: "off" | "pressure" | "tilt" | "velocity" | "fade" | "random"
  angleControl?: "off" | "pressure" | "tilt" | "velocity" | "fade" | "random"
  roundnessControl?: "off" | "pressure" | "tilt" | "velocity" | "fade" | "random"
  /** Shape Dynamics */
  sizeJitter?: number          // 0–100 % random size variation
  angleJitter?: number         // 0–360 degrees random rotation
  roundnessJitter?: number     // 0–100 % random ellipse squash
  flipX?: boolean
  flipY?: boolean
  minDiameter?: number         // 0–100 % of size as floor
  /** Scattering */
  scatter?: number             // 0–1000 % distance scatter perpendicular to stroke
  scatterCount?: number        // 1–16 stamps per spacing interval
  scatterCountJitter?: number  // 0–100 % random count variation
  /** Color Dynamics */
  fgBgJitter?: number          // 0–100 % chance of using background color
  hueJitter?: number           // 0–100 % hue shift range
  satJitter?: number           // 0–100 % saturation shift range
  brightJitter?: number        // 0–100 % brightness shift range
  purity?: number
  /** Transfer */
  opacityJitter?: number       // 0–100 % random opacity variation
  flowJitter?: number          // 0–100 % random flow variation
  opacityControl?: "off" | "pressure" | "tilt" | "velocity" | "fade" | "random"
  flowControl?: "off" | "pressure" | "tilt" | "velocity" | "fade" | "random"
  texture?: {
    enabled: boolean
    pattern: "noise" | "canvas" | "paper" | "linen"
    mode: "multiply" | "subtract" | "burn"
    depth: number
    depthJitter: number
    minDepth: number
    scale: number
  }
  dualBrush?: {
    enabled: boolean
    size: number
    spacing: number
    scatter: number
    count: number
    mode: "multiply" | "screen" | "subtract"
  }
  pose?: {
    tiltX: number
    tiltY: number
    rotation: number
    pressure: number
    stylusAngle: number
  }
  mixer?: {
    wet: number
    load: number
    mix: number
    flow: number
    sampleAllLayers: boolean
    cleanAfterStroke: boolean
    reservoirColor?: string
    /** Reservoir alpha (0-1). Drops as paint deposits and is replenished on load. */
    reservoirAlpha?: number
    /** Replenish amount applied at the start of each stroke (0-100). */
    loadPerStroke?: number
    /** When true the reservoir reloads at the start of every stroke. */
    autoLoad?: boolean
    /** When true the reservoir is cleaned at the start of every stroke. */
    autoClean?: boolean
  }
  colorReplacement?: {
    sampling: "continuous" | "once" | "background-swatch"
    limits: "contiguous" | "discontiguous" | "find-edges"
    mode: "color" | "hue" | "saturation" | "luminosity"
    tolerance: number
    antiAlias: boolean
  }
  artHistory?: {
    style:
      | "tight-short"
      | "tight-medium"
      | "tight-long"
      | "loose-medium"
      | "loose-long"
      | "dab"
      | "tight-curl"
      | "loose-curl"
      | "tight-curl-long"
      | "loose-curl-long"
      /** @deprecated retained for compatibility with previously saved presets. */
      | "curl"
    area: number
    fidelity: number
    /** Tonal distance between source and dab area; lower = paint only flat regions. */
    tolerance?: number
  }
  /** Other */
  wetEdges?: boolean
  buildUp?: boolean
  noise?: boolean
  protectTexture?: boolean
}

export interface GradientSettings {
  type: "linear" | "radial" | "angular" | "reflected" | "diamond"
  reverse: boolean
  dither?: boolean
  cycle?: boolean
  /** Multi-stop gradient (when set, used over fg/bg). */
  stops?: GradientStop[]
}

export type SymmetryAxis =
  | "horizontal"
  | "vertical"
  | "both"
  | "diagonal"
  | "wavy"
  | "circle"
  | "parallel"
  | "radial"
  | "mandala"
  | "spiral"

export interface SymmetrySettings {
  enabled: boolean
  axis: SymmetryAxis
  /** Number of segments for radial / mandala modes (2–32) */
  segments?: number
  /** Parallel symmetry spacing in canvas pixels. */
  parallelSpacing?: number
  /** Wavy symmetry amplitude in canvas pixels. */
  waveAmplitude?: number
  /** Number of sine periods across the document for wavy symmetry. */
  waveFrequency?: number
}

export interface BrushPreset {
  id: string
  name: string
  folder?: string
  size: number
  hardness: number
  spacing: number
  settings?: Partial<BrushSettings>
  thumbnail?: string
}

export interface PaintBucketSettings {
  tolerance: number
  contiguous: boolean
}

export interface MagicWandSettings {
  tolerance: number
  contiguous: boolean
}

export interface CloneStampState {
  layerId: string
  ax: number
  ay: number
}

export interface EraserSettings {
  sampling: "continuous" | "once" | "background-swatch"
  limits: "contiguous" | "discontiguous" | "find-edges"
  tolerance: number
  antiAlias: boolean
  protectForeground: boolean
}

export interface CloneSourcePreset {
  id: string
  name: string
  layerId: string
  sourceX: number
  sourceY: number
  scale: number
  rotation: number
  offsetX: number
  offsetY: number
}

export interface CloneSourceSettings {
  activePresetId: string | null
  presets: CloneSourcePreset[]
  aligned: boolean
  sample: "current-layer" | "current-below" | "all-layers"
  scale: number
  rotation: number
  offsetX: number
  offsetY: number
  showOverlay: boolean
}

export interface CustomShapeSettings {
  shape: CustomShapeId
}

export interface NoteSettings {
  author: string
  color: string
}
