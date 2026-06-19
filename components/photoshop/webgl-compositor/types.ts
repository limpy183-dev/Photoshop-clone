import type { AdvancedBlending, BlendMode, Layer } from "../types"
import type { PipelineBitDepth } from "../color-pipeline"

export type WebGLCompositorPath = "canvas-2d" | "webgl" | "tiled-webgl"

export interface WebGLCompositorPlanInput {
  width: number
  height: number
  layerCount: number
  preferWebGL?: boolean
  webglAvailable?: boolean
  maxTextureSize?: number
  largeDocumentPixels?: number
}

export interface WebGLCompositorPlan {
  path: WebGLCompositorPath
  reason:
    | "webgl-disabled"
    | "webgl-unavailable"
    | "webgl-preferred"
    | "small-document"
    | "large-compatible-document"
    | "exceeds-max-texture-size"
  tileSize?: number
  pixelCount: number
  maxTextureSize: number
}

export interface GpuFilterChainPlan {
  mode: "webgl" | "mixed" | "cpu"
  compatibleFilters: string[]
  cpuFilters: string[]
}

export type HalfFloatGpuPipelinePath = "half-float-webgl2" | "rgba8-webgl" | "float32-cpu" | "canvas-2d"

export interface HalfFloatGpuPipelineInput {
  width: number
  height: number
  bitDepth: PipelineBitDepth
  preferGpu?: boolean
  webgl2Available?: boolean
  extensions?: readonly string[]
  workingSpace?: string
  displaySpace?: string
  view?: string
}

export interface HalfFloatGpuPipelinePlan {
  path: HalfFloatGpuPipelinePath
  reason:
    | "half-float-render-target"
    | "webgl-disabled"
    | "webgl2-unavailable"
    | "float-render-target-unavailable"
    | "eight-bit-document"
  framebufferFormat: "RGBA16F" | "RGBA8" | "Float32Array"
  pixelCount: number
  textureType: "HALF_FLOAT" | "UNSIGNED_BYTE" | "CPU_FLOAT32"
  ocioStages: string[]
  workingSpace: string
  displaySpace: string
  view: string
}

export interface OcioViewPipelineOptions {
  inputSpace?: string
  workingSpace?: string
  displaySpace?: string
  view?: "Standard" | "Filmic" | "ACES"
  exposure?: number
  gamma?: number
}

export interface OcioViewPipeline {
  inputSpace: string
  workingSpace: string
  displaySpace: string
  view: "Standard" | "Filmic" | "ACES"
  exposure: number
  gamma: number
  stages: string[]
}

export interface WebGLRect {
  x: number
  y: number
  w: number
  h: number
}

export interface WebGLLayerInput {
  source: TexImageSource
  opacity?: number
  fillOpacity?: number
  blendMode?: BlendMode
  visible?: boolean
  maskSource?: TexImageSource | null
  vectorMaskSource?: TexImageSource | null
  clipMaskSource?: TexImageSource | null
  advancedBlending?: AdvancedBlending
  layerId?: string
  /**
   * Optional backdrop texture used when the layer's advanced knockout is
   * "shallow" (the underlying layers up to the parent group) or "deep" (the
   * full document background / transparent). When supplied, knockout in the
   * compositor reads this backdrop where the layer's alpha covers; otherwise
   * the legacy behavior (knock the running base alpha) is used.
   */
  knockoutBackdropSource?: TexImageSource | null
}

export type WebGLEffectFallback =
  | "layer-effects"
  | "smart-filters"
  | "filter-preview"
  | "adjustment-layer"
  | "advanced-blending"

export type WebGLLayerUnsupportedReason =
  | "hidden"
  | "group-layer"
  | "source-unavailable"
  | "unsupported-blend-mode"
  | "cpu-layer-fallback-unavailable"
  | "cpu-adjustment-fallback-unavailable"
  | "advanced-knockout"

export interface WebGLLayerCapability {
  layerId: string
  layerKind: Layer["kind"] | "raster"
  supported: boolean
  gpuLayer: boolean
  gpuBlend: boolean
  gpuMasks: boolean
  gpuVectorMasks: boolean
  gpuClipping: boolean
  requiresCpuCheckpoint: boolean
  effectFallbacks: WebGLEffectFallback[]
  unsupportedReasons: WebGLLayerUnsupportedReason[]
}

export interface WebGLLayerStackPlanInput extends WebGLCompositorPlanInput {
  layers: readonly Layer[]
  cpuLayerFallbackAvailable?: boolean
  cpuAdjustmentFallbackAvailable?: boolean
}

export interface WebGLLayerStackPlan {
  compatible: boolean
  path: WebGLCompositorPath
  reason: WebGLCompositorPlan["reason"]
  tileSize?: number
  pixelCount: number
  maxTextureSize: number
  layerCapabilities: WebGLLayerCapability[]
  gpuLayerCount: number
  cpuCheckpointLayerIds: string[]
  effectFallbacks: Array<{ layerId: string; effects: WebGLEffectFallback[] }>
  unsupportedLayers: Array<{ layerId: string; reasons: WebGLLayerUnsupportedReason[] }>
}

export interface WebGLCompositeFallback {
  layerId: string
  reason: WebGLEffectFallback | WebGLLayerUnsupportedReason | "tile-render"
}

export interface WebGLCompositeResult {
  completed: boolean
  reason?: "webgl-unavailable" | "unsupported-layer" | "unsupported-blend-mode" | "context-lost"
  layersDrawn: number
  path?: WebGLCompositorPath
  tilesDrawn?: number
  fallbacks?: WebGLCompositeFallback[]
}

export interface WebGLCompositeLayerContext {
  width: number
  height: number
  tileRect?: WebGLRect
  clipMask: HTMLCanvasElement | null
  filterPreviewCanvas?: HTMLCanvasElement
  /**
   * Backdrop texture source used to resolve advanced knockout. For shallow
   * knockout, this should be the immediate group base; for deep knockout, the
   * full document base layer (or a transparent canvas if neither is available).
   * When omitted, knockout falls back to the legacy alpha-reduction path.
   */
  knockoutBackdrop?: HTMLCanvasElement | null
}

export interface WebGLCompositeDocumentOptions {
  width?: number
  height?: number
  tileRect?: WebGLRect
  preferWebGL?: boolean
  webglAvailable?: boolean
  maxTextureSize?: number
  tileSize?: number
  disableTiling?: boolean
  filterPreviews?: Record<string, HTMLCanvasElement>
  prepareLayer?: (layer: Layer, context: WebGLCompositeLayerContext) => WebGLLayerInput | null
  drawCpuLayer?: (ctx: CanvasRenderingContext2D, layer: Layer, context: WebGLCompositeLayerContext) => void
  applyCpuAdjustment?: (ctx: CanvasRenderingContext2D, layer: Layer, context: WebGLCompositeLayerContext) => void
}

