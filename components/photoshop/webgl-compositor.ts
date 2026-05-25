import type { AdvancedBlending, BlendIfRange, BlendMode, Layer } from "./types"
import type { HighBitImage, PipelineBitDepth } from "./color-pipeline"
import { appendPathToCanvas } from "./vector-path-operations"

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

const ALL_BLEND_MODES: readonly BlendMode[] = [
  "normal",
  "dissolve",
  "behind",
  "clear",
  "darken",
  "multiply",
  "color-burn",
  "linear-burn",
  "darker-color",
  "lighten",
  "screen",
  "color-dodge",
  "linear-dodge",
  "lighter-color",
  "overlay",
  "soft-light",
  "hard-light",
  "vivid-light",
  "linear-light",
  "pin-light",
  "hard-mix",
  "difference",
  "exclusion",
  "subtract",
  "divide",
  "hue",
  "saturation",
  "color",
  "luminosity",
]

const COMPATIBLE_BLEND_MODES = new Set<BlendMode>(ALL_BLEND_MODES)
const BLEND_MODE_CODE = new Map<BlendMode, number>(ALL_BLEND_MODES.map((mode, index) => [mode, index]))

const GPU_FILTERS = new Set([
  "brightness-contrast",
  "exposure",
  "invert",
  "hue-saturation",
  "vibrance",
  "posterize",
  "threshold",
])

export const GPU_ADJUSTMENT_TYPES = new Set([
  "brightness-contrast",
  "exposure",
  "invert",
  "hue-saturation",
  "vibrance",
  "posterize",
  "threshold",
  "levels",
  "curves",
  "channel-mixer",
  "black-white",
  "desaturate",
])

function readNumberParam(params: Record<string, number | string | boolean> | undefined, key: string, fallback: number) {
  if (!params) return fallback
  const v = params[key]
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const parsed = Number(v)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

export interface GpuAdjustmentShader {
  fragmentSource: string
  uniforms: Record<string, number | number[] | Float32Array>
  curveTexture?: { values: Float32Array; size: number }
}

const ADJUSTMENT_FRAGMENT_PREFIX = `
  precision mediump float;
  uniform sampler2D u_source;
  uniform sampler2D u_curveLut;
  uniform int u_hasCurveLut;
  varying vec2 v_texcoord;
  vec3 rgb2hsl(vec3 c) {
    float maxc = max(max(c.r, c.g), c.b);
    float minc = min(min(c.r, c.g), c.b);
    float h = 0.0;
    float s = 0.0;
    float l = (maxc + minc) * 0.5;
    if (maxc != minc) {
      float d = maxc - minc;
      s = l > 0.5 ? d / (2.0 - maxc - minc) : d / (maxc + minc);
      if (maxc == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
      else if (maxc == c.g) h = (c.b - c.r) / d + 2.0;
      else h = (c.r - c.g) / d + 4.0;
      h /= 6.0;
    }
    return vec3(h, s, l);
  }
  float hue2rgb(float p, float q, float t) {
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
    if (t < 1.0 / 2.0) return q;
    if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
    return p;
  }
  vec3 hsl2rgb(vec3 hsl) {
    float h = hsl.x;
    float s = hsl.y;
    float l = hsl.z;
    if (s == 0.0) return vec3(l);
    float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
    float p = 2.0 * l - q;
    return vec3(hue2rgb(p, q, h + 1.0 / 3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0 / 3.0));
  }
  float luminance(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
`

const ADJUSTMENT_SHADERS: Record<string, string> = {
  "brightness-contrast": `
    uniform float u_brightness;
    uniform float u_contrast;
    void main() {
      vec4 c = texture2D(u_source, v_texcoord);
      vec3 rgb = clamp(c.rgb + u_brightness / 255.0, 0.0, 1.0);
      float f = (259.0 * (u_contrast + 255.0)) / (255.0 * (259.0 - u_contrast));
      rgb = clamp(f * (rgb - 0.5) + 0.5, 0.0, 1.0);
      gl_FragColor = vec4(rgb, c.a);
    }
  `,
  "exposure": `
    uniform float u_exposure;
    uniform float u_offset;
    uniform float u_gammaCorrection;
    void main() {
      vec4 c = texture2D(u_source, v_texcoord);
      vec3 rgb = c.rgb * pow(2.0, u_exposure) + u_offset;
      rgb = pow(max(rgb, vec3(0.0)), vec3(1.0 / max(u_gammaCorrection, 0.01)));
      gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
    }
  `,
  "invert": `
    void main() {
      vec4 c = texture2D(u_source, v_texcoord);
      gl_FragColor = vec4(vec3(1.0) - c.rgb, c.a);
    }
  `,
  "hue-saturation": `
    uniform float u_hue;
    uniform float u_saturation;
    uniform float u_lightness;
    void main() {
      vec4 c = texture2D(u_source, v_texcoord);
      vec3 hsl = rgb2hsl(c.rgb);
      hsl.x = fract(hsl.x + u_hue / 360.0);
      hsl.y = clamp(hsl.y * (1.0 + u_saturation / 100.0), 0.0, 1.0);
      hsl.z = clamp(hsl.z + u_lightness / 100.0, 0.0, 1.0);
      gl_FragColor = vec4(hsl2rgb(hsl), c.a);
    }
  `,
  "vibrance": `
    uniform float u_vibrance;
    uniform float u_saturationParam;
    void main() {
      vec4 c = texture2D(u_source, v_texcoord);
      float maxC = max(max(c.r, c.g), c.b);
      float avg = (c.r + c.g + c.b) / 3.0;
      float amount = (maxC - avg) * (-3.0 * u_vibrance / 100.0);
      vec3 rgb = mix(vec3(avg), c.rgb, 1.0 + amount + u_saturationParam / 100.0);
      gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
    }
  `,
  "posterize": `
    uniform float u_levels;
    void main() {
      vec4 c = texture2D(u_source, v_texcoord);
      float L = max(u_levels, 2.0);
      vec3 rgb = floor(c.rgb * L) / max(L - 1.0, 1.0);
      gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
    }
  `,
  "threshold": `
    uniform float u_threshold;
    void main() {
      vec4 c = texture2D(u_source, v_texcoord);
      float gray = luminance(c.rgb);
      float v = gray >= u_threshold ? 1.0 : 0.0;
      gl_FragColor = vec4(vec3(v), c.a);
    }
  `,
  "levels": `
    uniform float u_blackInput;
    uniform float u_whiteInput;
    uniform float u_gamma;
    uniform float u_blackOutput;
    uniform float u_whiteOutput;
    void main() {
      vec4 c = texture2D(u_source, v_texcoord);
      vec3 normalized = clamp((c.rgb - vec3(u_blackInput / 255.0)) / max((u_whiteInput - u_blackInput) / 255.0, 1.0/255.0), 0.0, 1.0);
      vec3 mapped = pow(normalized, vec3(1.0 / max(u_gamma, 0.01)));
      vec3 rgb = mix(vec3(u_blackOutput / 255.0), vec3(u_whiteOutput / 255.0), mapped);
      gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
    }
  `,
  "curves": `
    void main() {
      vec4 c = texture2D(u_source, v_texcoord);
      vec3 rgb;
      if (u_hasCurveLut == 1) {
        rgb = vec3(
          texture2D(u_curveLut, vec2(c.r, 0.5)).r,
          texture2D(u_curveLut, vec2(c.g, 0.5)).r,
          texture2D(u_curveLut, vec2(c.b, 0.5)).r
        );
      } else {
        rgb = c.rgb;
      }
      gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
    }
  `,
  "channel-mixer": `
    uniform vec3 u_redMix;
    uniform vec3 u_greenMix;
    uniform vec3 u_blueMix;
    uniform vec3 u_constant;
    void main() {
      vec4 c = texture2D(u_source, v_texcoord);
      vec3 rgb = vec3(
        dot(c.rgb, u_redMix) + u_constant.r,
        dot(c.rgb, u_greenMix) + u_constant.g,
        dot(c.rgb, u_blueMix) + u_constant.b
      );
      gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
    }
  `,
  "black-white": `
    uniform vec3 u_weightsRgb;
    uniform vec3 u_weightsCmy;
    void main() {
      vec4 c = texture2D(u_source, v_texcoord);
      float r = c.r;
      float g = c.g;
      float b = c.b;
      float cv = 1.0 - r;
      float mv = 1.0 - g;
      float yv = 1.0 - b;
      float gray = r * u_weightsRgb.r + g * u_weightsRgb.g + b * u_weightsRgb.b
        + cv * u_weightsCmy.r + mv * u_weightsCmy.g + yv * u_weightsCmy.b;
      gl_FragColor = vec4(vec3(clamp(gray / max(u_weightsRgb.r + u_weightsRgb.g + u_weightsRgb.b + u_weightsCmy.r + u_weightsCmy.g + u_weightsCmy.b, 0.01), 0.0, 1.0)), c.a);
    }
  `,
  "desaturate": `
    void main() {
      vec4 c = texture2D(u_source, v_texcoord);
      float gray = luminance(c.rgb);
      gl_FragColor = vec4(vec3(gray), c.a);
    }
  `,
}

export function buildGpuAdjustmentShader(type: string, params: Record<string, number | string | boolean> | undefined): GpuAdjustmentShader | null {
  const kernel = ADJUSTMENT_SHADERS[type]
  if (!kernel) return null
  const fragmentSource = `${ADJUSTMENT_FRAGMENT_PREFIX}${kernel}`
  switch (type) {
    case "brightness-contrast":
      return {
        fragmentSource,
        uniforms: {
          u_brightness: readNumberParam(params, "brightness", 0),
          u_contrast: readNumberParam(params, "contrast", 0),
        },
      }
    case "exposure":
      return {
        fragmentSource,
        uniforms: {
          u_exposure: readNumberParam(params, "exposure", 0),
          u_offset: readNumberParam(params, "offset", 0),
          u_gammaCorrection: readNumberParam(params, "gamma", 1),
        },
      }
    case "invert":
      return { fragmentSource, uniforms: {} }
    case "hue-saturation":
      return {
        fragmentSource,
        uniforms: {
          u_hue: readNumberParam(params, "hue", 0),
          u_saturation: readNumberParam(params, "saturation", 0),
          u_lightness: readNumberParam(params, "lightness", 0),
        },
      }
    case "vibrance":
      return {
        fragmentSource,
        uniforms: {
          u_vibrance: readNumberParam(params, "vibrance", 0),
          u_saturationParam: readNumberParam(params, "saturation", 0),
        },
      }
    case "posterize":
      return { fragmentSource, uniforms: { u_levels: readNumberParam(params, "levels", 4) } }
    case "threshold":
      return { fragmentSource, uniforms: { u_threshold: readNumberParam(params, "threshold", 128) / 255 } }
    case "levels":
      return {
        fragmentSource,
        uniforms: {
          u_blackInput: readNumberParam(params, "blackInput", 0),
          u_whiteInput: readNumberParam(params, "whiteInput", 255),
          u_gamma: readNumberParam(params, "gamma", 1),
          u_blackOutput: readNumberParam(params, "blackOutput", 0),
          u_whiteOutput: readNumberParam(params, "whiteOutput", 255),
        },
      }
    case "curves": {
      const lutSize = 256
      const values = new Float32Array(lutSize)
      for (let i = 0; i < lutSize; i++) values[i] = i / (lutSize - 1)
      return {
        fragmentSource,
        uniforms: {},
        curveTexture: { values, size: lutSize },
      }
    }
    case "channel-mixer": {
      const redToRed = readNumberParam(params, "redToRed", 100) / 100
      const greenToRed = readNumberParam(params, "greenToRed", 0) / 100
      const blueToRed = readNumberParam(params, "blueToRed", 0) / 100
      const redToGreen = readNumberParam(params, "redToGreen", 0) / 100
      const greenToGreen = readNumberParam(params, "greenToGreen", 100) / 100
      const blueToGreen = readNumberParam(params, "blueToGreen", 0) / 100
      const redToBlue = readNumberParam(params, "redToBlue", 0) / 100
      const greenToBlue = readNumberParam(params, "greenToBlue", 0) / 100
      const blueToBlue = readNumberParam(params, "blueToBlue", 100) / 100
      const constR = readNumberParam(params, "constantRed", 0) / 100
      const constG = readNumberParam(params, "constantGreen", 0) / 100
      const constB = readNumberParam(params, "constantBlue", 0) / 100
      return {
        fragmentSource,
        uniforms: {
          u_redMix: [redToRed, greenToRed, blueToRed],
          u_greenMix: [redToGreen, greenToGreen, blueToGreen],
          u_blueMix: [redToBlue, greenToBlue, blueToBlue],
          u_constant: [constR, constG, constB],
        },
      }
    }
    case "black-white": {
      const reds = readNumberParam(params, "reds", 40) / 100
      const yellows = readNumberParam(params, "yellows", 60) / 100
      const greens = readNumberParam(params, "greens", 40) / 100
      const cyans = readNumberParam(params, "cyans", 60) / 100
      const blues = readNumberParam(params, "blues", 20) / 100
      const magentas = readNumberParam(params, "magentas", 80) / 100
      return {
        fragmentSource,
        uniforms: {
          u_weightsRgb: [reds, greens, blues],
          u_weightsCmy: [cyans, magentas, yellows],
        },
      }
    }
    case "desaturate":
      return { fragmentSource, uniforms: {} }
    default:
      return null
  }
}

function positiveInt(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || value === undefined) return fallback
  return Math.max(1, Math.round(value))
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function hasEnabledSmartFilters(layer: Layer) {
  return (layer.smartFilters ?? []).some((filter) => filter.enabled)
}

function hasLayerEffects(layer: Layer) {
  const style = layer.style
  if (!style) return false
  return Object.values(style).some((effect) => effect && typeof effect === "object" && "enabled" in effect && effect.enabled === true)
}

function hasAdvancedKnockout(layer: Layer) {
  return !!layer.advancedBlending && layer.advancedBlending.knockout !== "none"
}

export function isWebGLBlendModeCompatible(mode: BlendMode | undefined): boolean {
  return COMPATIBLE_BLEND_MODES.has(mode ?? "normal")
}

export function planGpuFilterChain(filters: readonly string[], env: { webglAvailable?: boolean } = {}): GpuFilterChainPlan {
  if (!env.webglAvailable) {
    return { mode: "cpu", compatibleFilters: [], cpuFilters: [...filters] }
  }
  const compatibleFilters = filters.filter((filter) => GPU_FILTERS.has(filter))
  const cpuFilters = filters.filter((filter) => !GPU_FILTERS.has(filter))
  return {
    mode: cpuFilters.length ? (compatibleFilters.length ? "mixed" : "cpu") : "webgl",
    compatibleFilters,
    cpuFilters,
  }
}

export function createOcioViewPipeline(options: OcioViewPipelineOptions = {}): OcioViewPipeline {
  return {
    inputSpace: options.inputSpace ?? "sRGB IEC61966-2.1",
    workingSpace: options.workingSpace ?? "scene-linear",
    displaySpace: options.displaySpace ?? "sRGB IEC61966-2.1",
    view: options.view ?? "Standard",
    exposure: Number.isFinite(options.exposure) ? options.exposure ?? 0 : 0,
    gamma: Math.max(0.01, Number.isFinite(options.gamma) ? options.gamma ?? 1 : 1),
    stages: [
      "input-to-scene-linear",
      "working-space-transform",
      "view-transform",
      "display-transfer",
    ],
  }
}

export function planHalfFloatGpuPipeline(input: HalfFloatGpuPipelineInput): HalfFloatGpuPipelinePlan {
  const pixelCount = positiveInt(input.width, 1) * positiveInt(input.height, 1)
  const stages = createOcioViewPipeline({
    workingSpace: input.workingSpace,
    displaySpace: input.displaySpace,
    view: input.view === "ACES" ? "ACES" : input.view === "Filmic" ? "Filmic" : "Standard",
  }).stages
  const base = {
    pixelCount,
    ocioStages: stages,
    workingSpace: input.workingSpace ?? "scene-linear",
    displaySpace: input.displaySpace ?? "sRGB IEC61966-2.1",
    view: input.view ?? "Standard",
  }
  if (input.preferGpu === false) {
    return { ...base, path: "canvas-2d", reason: "webgl-disabled", framebufferFormat: "Float32Array", textureType: "CPU_FLOAT32" }
  }
  if (input.bitDepth <= 8) {
    return { ...base, path: "rgba8-webgl", reason: "eight-bit-document", framebufferFormat: "RGBA8", textureType: "UNSIGNED_BYTE" }
  }
  if (!input.webgl2Available) {
    return { ...base, path: "float32-cpu", reason: "webgl2-unavailable", framebufferFormat: "Float32Array", textureType: "CPU_FLOAT32" }
  }
  const extensions = new Set((input.extensions ?? []).map((ext) => ext.toLowerCase()))
  const colorBufferFloat = extensions.has("ext_color_buffer_float") || extensions.has("ext_color_buffer_half_float")
  const linearFloat = extensions.has("oes_texture_float_linear") || extensions.has("oes_texture_half_float_linear")
  if (!colorBufferFloat || !linearFloat) {
    return { ...base, path: "float32-cpu", reason: "float-render-target-unavailable", framebufferFormat: "Float32Array", textureType: "CPU_FLOAT32" }
  }
  return { ...base, path: "half-float-webgl2", reason: "half-float-render-target", framebufferFormat: "RGBA16F", textureType: "HALF_FLOAT" }
}

function highBitMax(source: HighBitImage) {
  return source.storage === "uint16" ? 65535 : source.storage === "uint8" ? 255 : 1
}

function readHighBitUnit(source: HighBitImage, index: number) {
  return Number(source.data[index]) / highBitMax(source)
}

function ocioViewValue(value: number, pipeline: OcioViewPipeline) {
  let v = Math.max(0, value * 2 ** pipeline.exposure)
  if (pipeline.view === "Filmic") {
    v = v >= 1 ? 1 : (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14)
  } else if (pipeline.view === "ACES") {
    v = (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14)
  }
  v = Math.max(0, Math.min(1, v))
  return Math.max(0, Math.min(255, Math.round(v ** (1 / pipeline.gamma) * 255)))
}

function makeImageData(data: Uint8ClampedArray, width: number, height: number): ImageData {
  if (typeof ImageData !== "undefined") return new ImageData(data, width, height)
  return { data, width, height } as ImageData
}

const OCIO_FRAGMENT_SHADER_300 = `#version 300 es
  precision highp float;
  uniform sampler2D u_source;
  uniform float u_exposure;
  uniform float u_gamma;
  uniform int u_view;
  in vec2 v_texcoord;
  out vec4 fragColor;

  vec3 filmicTonemap(vec3 v) {
    return (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
  }

  vec3 inputToSceneLinear(vec3 c) {
    return c;
  }

  vec3 workingSpaceTransform(vec3 c) {
    return c;
  }

  vec3 viewTransform(vec3 c) {
    vec3 v = c * pow(2.0, u_exposure);
    v = max(v, vec3(0.0));
    if (u_view == 1) {
      vec3 clamped = vec3(
        v.r >= 1.0 ? 1.0 : v.r,
        v.g >= 1.0 ? 1.0 : v.g,
        v.b >= 1.0 ? 1.0 : v.b
      );
      v = mix(filmicTonemap(v), clamped, step(1.0, v));
    } else if (u_view == 2) {
      v = filmicTonemap(v);
    }
    return clamp(v, 0.0, 1.0);
  }

  vec3 displayTransfer(vec3 c) {
    return pow(c, vec3(1.0 / max(u_gamma, 0.01)));
  }

  void main() {
    vec4 c = texture(u_source, v_texcoord);
    vec3 linear = inputToSceneLinear(c.rgb);
    vec3 working = workingSpaceTransform(linear);
    vec3 viewed = viewTransform(working);
    vec3 display = displayTransfer(viewed);
    fragColor = vec4(clamp(display, 0.0, 1.0), clamp(c.a, 0.0, 1.0));
  }
`

const OCIO_VERTEX_SHADER_300 = `#version 300 es
  in vec2 a_position;
  in vec2 a_texcoord;
  out vec2 v_texcoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texcoord = a_texcoord;
  }
`

function uploadHighBitToHalfFloatTexture(gl: WebGL2RenderingContext, source: HighBitImage): WebGLTexture | null {
  const total = source.width * source.height * 4
  const data = new Float32Array(total)
  for (let i = 0; i < total; i++) data[i] = readHighBitUnit(source, i)

  const texture = gl.createTexture()
  if (!texture) return null
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, source.width, source.height, 0, gl.RGBA, gl.FLOAT, data)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return texture
}

function applyOcioViewTransformOnGpu(source: HighBitImage, pipeline: OcioViewPipeline): ImageData | null {
  if (typeof document === "undefined") return null
  const canvas = document.createElement("canvas")
  canvas.width = source.width
  canvas.height = source.height
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null
  if (!gl) return null
  const ext = gl.getExtension("EXT_color_buffer_half_float") || gl.getExtension("EXT_color_buffer_float")
  if (!ext) return null

  const vertex = compileShader(gl, gl.VERTEX_SHADER, OCIO_VERTEX_SHADER_300)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, OCIO_FRAGMENT_SHADER_300)
  if (!vertex || !fragment) return null
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  gl.useProgram(program)

  const positionBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
  const positionLoc = gl.getAttribLocation(program, "a_position")
  gl.enableVertexAttribArray(positionLoc)
  gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0)

  const texcoordBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]), gl.STATIC_DRAW)
  const texcoordLoc = gl.getAttribLocation(program, "a_texcoord")
  gl.enableVertexAttribArray(texcoordLoc)
  gl.vertexAttribPointer(texcoordLoc, 2, gl.FLOAT, false, 0, 0)

  const tex = uploadHighBitToHalfFloatTexture(gl, source)
  if (!tex) return null
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  const sourceLoc = gl.getUniformLocation(program, "u_source")
  if (sourceLoc) gl.uniform1i(sourceLoc, 0)
  const exposureLoc = gl.getUniformLocation(program, "u_exposure")
  if (exposureLoc) gl.uniform1f(exposureLoc, pipeline.exposure)
  const gammaLoc = gl.getUniformLocation(program, "u_gamma")
  if (gammaLoc) gl.uniform1f(gammaLoc, pipeline.gamma)
  const viewLoc = gl.getUniformLocation(program, "u_view")
  if (viewLoc) gl.uniform1i(viewLoc, pipeline.view === "Filmic" ? 1 : pipeline.view === "ACES" ? 2 : 0)

  gl.viewport(0, 0, source.width, source.height)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLES, 0, 6)

  const pixels = new Uint8Array(source.width * source.height * 4)
  gl.readPixels(0, 0, source.width, source.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  const clamped = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength)
  return makeImageData(clamped, source.width, source.height)
}

export function applyOcioViewTransformToHighBitImage(source: HighBitImage, pipeline: OcioViewPipeline): ImageData {
  const gpu = applyOcioViewTransformOnGpu(source, pipeline)
  if (gpu) return gpu
  const out = new Uint8ClampedArray(source.width * source.height * 4)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = ocioViewValue(readHighBitUnit(source, i), pipeline)
    out[i + 1] = ocioViewValue(readHighBitUnit(source, i + 1), pipeline)
    out[i + 2] = ocioViewValue(readHighBitUnit(source, i + 2), pipeline)
    out[i + 3] = Math.max(0, Math.min(255, Math.round(readHighBitUnit(source, i + 3) * 255)))
  }
  return makeImageData(out, source.width, source.height)
}

export function planWebGLCompositor(input: WebGLCompositorPlanInput): WebGLCompositorPlan {
  const width = positiveInt(input.width, 1)
  const height = positiveInt(input.height, 1)
  const pixelCount = width * height
  const maxTextureSize = positiveInt(input.maxTextureSize, 16_384)
  const largeDocumentPixels = positiveInt(input.largeDocumentPixels, 16_000_000)

  if (input.preferWebGL === false) {
    return { path: "canvas-2d", reason: "webgl-disabled", pixelCount, maxTextureSize }
  }
  if (!input.webglAvailable) {
    return { path: "canvas-2d", reason: "webgl-unavailable", pixelCount, maxTextureSize }
  }
  if (width > maxTextureSize || height > maxTextureSize) {
    return {
      path: "tiled-webgl",
      reason: "exceeds-max-texture-size",
      tileSize: maxTextureSize,
      pixelCount,
      maxTextureSize,
    }
  }
  if (input.preferWebGL === true) {
    return { path: "webgl", reason: "webgl-preferred", pixelCount, maxTextureSize }
  }
  if (pixelCount < largeDocumentPixels && input.layerCount < 6) {
    return { path: "canvas-2d", reason: "small-document", pixelCount, maxTextureSize }
  }
  return { path: "webgl", reason: "large-compatible-document", pixelCount, maxTextureSize }
}

export function getWebGLLayerCapability(
  layer: Layer,
  options: {
    cpuLayerFallbackAvailable?: boolean
    cpuAdjustmentFallbackAvailable?: boolean
    hasFilterPreview?: boolean
  } = {},
): WebGLLayerCapability {
  const kind = layer.kind ?? "raster"
  const unsupportedReasons: WebGLLayerUnsupportedReason[] = []
  const effectFallbacks: WebGLEffectFallback[] = []
  const isHidden = layer.visible === false
  const isGroup = kind === "group"
  const isAdjustment = kind === "adjustment"
  const adjustmentType = isAdjustment ? layer.adjustment?.type : undefined
  const isGpuAdjustment = !!adjustmentType && GPU_ADJUSTMENT_TYPES.has(adjustmentType)

  if (isHidden) unsupportedReasons.push("hidden")
  if (isGroup) unsupportedReasons.push("group-layer")
  if (!isWebGLBlendModeCompatible(layer.blendMode)) unsupportedReasons.push("unsupported-blend-mode")

  if (hasLayerEffects(layer)) effectFallbacks.push("layer-effects")
  if (hasEnabledSmartFilters(layer)) effectFallbacks.push("smart-filters")
  if (options.hasFilterPreview) effectFallbacks.push("filter-preview")
  if (isAdjustment && !isGpuAdjustment) effectFallbacks.push("adjustment-layer")
  if (hasAdvancedKnockout(layer)) effectFallbacks.push("advanced-blending")

  const needsCpuLayerFallback =
    hasLayerEffects(layer) ||
    hasEnabledSmartFilters(layer) ||
    options.hasFilterPreview ||
    hasAdvancedKnockout(layer)

  if (!isAdjustment && needsCpuLayerFallback && !options.cpuLayerFallbackAvailable) {
    unsupportedReasons.push("cpu-layer-fallback-unavailable")
  }
  if (isAdjustment && !isGpuAdjustment && !options.cpuAdjustmentFallbackAvailable) {
    unsupportedReasons.push("cpu-adjustment-fallback-unavailable")
  }
  if (hasAdvancedKnockout(layer) && !options.cpuLayerFallbackAvailable) {
    unsupportedReasons.push("advanced-knockout")
  }

  return {
    layerId: layer.id,
    layerKind: kind,
    supported: unsupportedReasons.length === 0,
    gpuLayer: (!isAdjustment || isGpuAdjustment) && !isHidden && !isGroup,
    gpuBlend: isWebGLBlendModeCompatible(layer.blendMode),
    gpuMasks: !!layer.mask && layer.maskEnabled !== false,
    gpuVectorMasks: !!layer.vectorMask,
    gpuClipping: layer.clipped === true,
    requiresCpuCheckpoint: (isAdjustment && !isGpuAdjustment) || hasAdvancedKnockout(layer),
    effectFallbacks,
    unsupportedReasons,
  }
}

export function planWebGLLayerStack(input: WebGLLayerStackPlanInput): WebGLLayerStackPlan {
  const basePlan = planWebGLCompositor(input)
  const layerCapabilities = input.layers
    .filter((layer) => layer.visible !== false && layer.kind !== "group")
    .map((layer) => getWebGLLayerCapability(layer, {
      cpuLayerFallbackAvailable: input.cpuLayerFallbackAvailable,
      cpuAdjustmentFallbackAvailable: input.cpuAdjustmentFallbackAvailable,
    }))
  const unsupportedLayers = layerCapabilities
    .filter((capability) => capability.unsupportedReasons.length > 0)
    .map((capability) => ({ layerId: capability.layerId, reasons: capability.unsupportedReasons }))
  const effectFallbacks = layerCapabilities
    .map((capability) => ({
      layerId: capability.layerId,
      effects: capability.effectFallbacks.filter((effect) => effect !== "adjustment-layer"),
    }))
    .filter((entry) => entry.effects.length > 0)

  return {
    compatible: unsupportedLayers.length === 0 && basePlan.path !== "canvas-2d",
    path: basePlan.path,
    reason: basePlan.reason,
    tileSize: basePlan.tileSize,
    pixelCount: basePlan.pixelCount,
    maxTextureSize: basePlan.maxTextureSize,
    layerCapabilities,
    gpuLayerCount: layerCapabilities.filter((capability) => capability.supported && capability.gpuLayer).length,
    cpuCheckpointLayerIds: layerCapabilities
      .filter((capability) => capability.supported && capability.requiresCpuCheckpoint)
      .map((capability) => capability.layerId),
    effectFallbacks,
    unsupportedLayers,
  }
}

function detectWebGL(canvas: HTMLCanvasElement): WebGLRenderingContext | WebGL2RenderingContext | null {
  try {
    return canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true }) ??
      canvas.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: true })
  } catch {
    return null
  }
}

function compileShader(gl: WebGLRenderingContext | WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

const VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec2 a_texcoord;
  varying vec2 v_texcoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texcoord = a_texcoord;
  }
`

const FRAGMENT_SHADER = `
  precision mediump float;
  uniform sampler2D u_base;
  uniform sampler2D u_source;
  uniform sampler2D u_mask;
  uniform sampler2D u_vectorMask;
  uniform sampler2D u_clipMask;
  uniform int u_hasMask;
  uniform int u_hasVectorMask;
  uniform int u_hasClipMask;
  uniform int u_blendMode;
  uniform float u_opacity;
  uniform float u_fillOpacity;
  uniform vec2 u_canvasSize;
  uniform vec3 u_channelMask;
  uniform int u_hasBlendIf;
  uniform vec4 u_blendIfThis;
  uniform vec4 u_blendIfUnderlying;
  varying vec2 v_texcoord;

  float luminance(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
  }

  float blendIfFactor(float value, vec4 range) {
    if (value <= range.x || value >= range.w) return 0.0;
    if (value >= range.y && value <= range.z) return 1.0;
    if (value < range.y) return clamp((value - range.x) / max(1.0, range.y - range.x), 0.0, 1.0);
    return clamp((range.w - value) / max(1.0, range.w - range.z), 0.0, 1.0);
  }

  float stableNoise(vec2 coord) {
    return fract(sin(dot(coord + vec2(1.0), vec2(12.9898, 78.233))) * 43758.5453123);
  }

  vec3 rgb2hsl(vec3 c) {
    float maxc = max(max(c.r, c.g), c.b);
    float minc = min(min(c.r, c.g), c.b);
    float h = 0.0;
    float s = 0.0;
    float l = (maxc + minc) * 0.5;
    if (maxc != minc) {
      float d = maxc - minc;
      s = l > 0.5 ? d / (2.0 - maxc - minc) : d / (maxc + minc);
      if (maxc == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
      else if (maxc == c.g) h = (c.b - c.r) / d + 2.0;
      else h = (c.r - c.g) / d + 4.0;
      h /= 6.0;
    }
    return vec3(h, s, l);
  }

  float hue2rgb(float p, float q, float t) {
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
    if (t < 1.0 / 2.0) return q;
    if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
    return p;
  }

  vec3 hsl2rgb(vec3 hsl) {
    float h = hsl.x;
    float s = hsl.y;
    float l = hsl.z;
    if (s == 0.0) return vec3(l);
    float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
    float p = 2.0 * l - q;
    return vec3(hue2rgb(p, q, h + 1.0 / 3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0 / 3.0));
  }

  float channelBlend(float b, float s, int mode) {
    if (mode == 4) return min(b, s);
    if (mode == 5) return b * s;
    if (mode == 6) return s == 0.0 ? 0.0 : clamp(1.0 - (1.0 - b) / s, 0.0, 1.0);
    if (mode == 7) return clamp(b + s - 1.0, 0.0, 1.0);
    if (mode == 9) return max(b, s);
    if (mode == 10) return 1.0 - (1.0 - b) * (1.0 - s);
    if (mode == 11) return s >= 1.0 ? 1.0 : clamp(b / (1.0 - s), 0.0, 1.0);
    if (mode == 12) return clamp(b + s, 0.0, 1.0);
    if (mode == 14) return b < 0.5 ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s);
    if (mode == 15) {
      if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b);
      float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
      return b + (2.0 * s - 1.0) * (d - b);
    }
    if (mode == 16) return s < 0.5 ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s);
    if (mode == 17) {
      if (s <= 0.5) {
        float s2 = 2.0 * s;
        return s2 == 0.0 ? 0.0 : clamp(1.0 - (1.0 - b) / s2, 0.0, 1.0);
      }
      float s2 = 2.0 * (s - 0.5);
      return s2 >= 1.0 ? 1.0 : clamp(b / (1.0 - s2), 0.0, 1.0);
    }
    if (mode == 18) return clamp(b + 2.0 * s - 1.0, 0.0, 1.0);
    if (mode == 19) return s <= 0.5 ? min(b, 2.0 * s) : max(b, 2.0 * s - 1.0);
    if (mode == 20) return b + s >= 1.0 ? 1.0 : 0.0;
    if (mode == 21) return abs(b - s);
    if (mode == 22) return b + s - 2.0 * b * s;
    if (mode == 23) return clamp(b - s, 0.0, 1.0);
    if (mode == 24) return s == 0.0 ? 1.0 : clamp(b / s, 0.0, 1.0);
    return s;
  }

  vec3 blendColor(vec3 b, vec3 s, int mode) {
    if (mode == 8) return luminance(s) < luminance(b) ? s : b;
    if (mode == 13) return luminance(s) > luminance(b) ? s : b;
    if (mode == 25 || mode == 26 || mode == 27 || mode == 28) {
      vec3 bh = rgb2hsl(b);
      vec3 sh = rgb2hsl(s);
      if (mode == 25) return hsl2rgb(vec3(sh.x, bh.y, bh.z));
      if (mode == 26) return hsl2rgb(vec3(bh.x, sh.y, bh.z));
      if (mode == 27) return hsl2rgb(vec3(sh.x, sh.y, bh.z));
      return hsl2rgb(vec3(bh.x, bh.y, sh.z));
    }
    return vec3(
      channelBlend(b.r, s.r, mode),
      channelBlend(b.g, s.g, mode),
      channelBlend(b.b, s.b, mode)
    );
  }

  float maskAmount(sampler2D samplerValue, int enabled) {
    if (enabled == 0) return 1.0;
    vec4 mask = texture2D(samplerValue, v_texcoord);
    return ((mask.r + mask.g + mask.b) / 3.0) * mask.a;
  }

  void main() {
    vec4 base = texture2D(u_base, v_texcoord);
    vec4 src = texture2D(u_source, v_texcoord);
    float coverage = maskAmount(u_mask, u_hasMask) * maskAmount(u_vectorMask, u_hasVectorMask) * maskAmount(u_clipMask, u_hasClipMask);
    float sa = src.a * clamp(u_opacity, 0.0, 1.0) * clamp(u_fillOpacity, 0.0, 1.0) * coverage;
    float ba = base.a;

    if (u_hasBlendIf == 1 && sa > 0.0) {
      sa *= blendIfFactor(luminance(src.rgb) * 255.0, u_blendIfThis);
      sa *= blendIfFactor(luminance(base.rgb) * 255.0, u_blendIfUnderlying);
    }

    if (sa <= 0.0) {
      gl_FragColor = base;
      return;
    }

    if (u_blendMode == 1 && stableNoise(gl_FragCoord.xy) > sa) {
      gl_FragColor = base;
      return;
    }

    if (u_blendMode == 2 && ba > 0.01) {
      gl_FragColor = base;
      return;
    }

    if (u_blendMode == 3) {
      gl_FragColor = vec4(base.rgb, max(0.0, ba - sa));
      return;
    }

    vec3 blended = blendColor(base.rgb, src.rgb, u_blendMode);
    float outA = sa + ba * (1.0 - sa);
    vec3 outRgb = outA > 0.0 ? (blended * sa + base.rgb * ba * (1.0 - sa)) / outA : vec3(0.0);
    outRgb = mix(base.rgb, outRgb, u_channelMask);
    gl_FragColor = vec4(clamp(outRgb, 0.0, 1.0), clamp(outA, 0.0, 1.0));
  }
`

function createProgram(gl: WebGLRenderingContext | WebGL2RenderingContext) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  if (!vertex || !fragment) return null
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  return program
}

function textureDimensions(source: TexImageSource): { width: number; height: number } {
  const sized = source as { width?: number; height?: number; videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number }
  return {
    width: positiveInt(sized.width ?? sized.videoWidth ?? sized.naturalWidth, 1),
    height: positiveInt(sized.height ?? sized.videoHeight ?? sized.naturalHeight, 1),
  }
}

function defaultBlendIfRange(): BlendIfRange {
  return { black: 0, blackFeather: 0, whiteFeather: 255, white: 255 }
}

function isDefaultBlendIfRange(range: BlendIfRange | undefined): boolean {
  if (!range) return true
  return range.black === 0 && range.blackFeather === 0 && range.whiteFeather === 255 && range.white === 255
}

function hasShaderAdvancedBlending(advanced: AdvancedBlending | undefined): boolean {
  if (!advanced) return false
  const channels = advanced.channels
  return !channels.r || !channels.g || !channels.b || !isDefaultBlendIfRange(advanced.blendIfThis) || !isDefaultBlendIfRange(advanced.blendIfUnderlying)
}

function blendIfUniform(range: BlendIfRange | undefined): [number, number, number, number] {
  const r = range ?? defaultBlendIfRange()
  return [r.black, r.blackFeather, r.whiteFeather, r.white]
}

function createTexture(gl: WebGLRenderingContext | WebGL2RenderingContext) {
  const texture = gl.createTexture()
  if (!texture) return null
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  return texture
}

function createTextureFromSource(gl: WebGLRenderingContext | WebGL2RenderingContext, source: TexImageSource) {
  const texture = createTexture(gl)
  if (!texture) return null
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  return texture
}

function createRenderTexture(gl: WebGLRenderingContext | WebGL2RenderingContext, width: number, height: number) {
  const texture = createTexture(gl)
  if (!texture) return null
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  return texture
}

function createSolidTexture(gl: WebGLRenderingContext | WebGL2RenderingContext, rgba: [number, number, number, number]) {
  const texture = createTexture(gl)
  if (!texture) return null
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba))
  return texture
}

function clearRenderTexture(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  framebuffer: WebGLFramebuffer,
  texture: WebGLTexture,
  width: number,
  height: number,
) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  gl.viewport(0, 0, width, height)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
}

export class WebGL2DCompositor {
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null
  private program: WebGLProgram | null
  private positionBuffer: WebGLBuffer | null
  private texcoordBuffer: WebGLBuffer | null

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.gl = detectWebGL(canvas)
    this.program = this.gl ? createProgram(this.gl) : null
    this.positionBuffer = this.gl?.createBuffer() ?? null
    this.texcoordBuffer = this.gl?.createBuffer() ?? null
    this.initializeBuffers()
  }

  composite(layers: readonly WebGLLayerInput[], options: { initialSource?: TexImageSource | null } = {}): WebGLCompositeResult {
    const gl = this.gl
    if (!gl || !this.program || !this.positionBuffer || !this.texcoordBuffer) {
      return { completed: false, reason: "webgl-unavailable", layersDrawn: 0, path: "webgl" }
    }
    if (typeof gl.isContextLost === "function" && gl.isContextLost()) {
      return { completed: false, reason: "context-lost", layersDrawn: 0, path: "webgl" }
    }

    const width = Math.max(1, this.canvas.width)
    const height = Math.max(1, this.canvas.height)
    const framebuffer = gl.createFramebuffer()
    if (!framebuffer) return { completed: false, reason: "context-lost", layersDrawn: 0, path: "webgl" }

    const textures: WebGLTexture[] = []
    const track = (texture: WebGLTexture | null) => {
      if (texture) textures.push(texture)
      return texture
    }

    const initialBaseTexture = track(options.initialSource ? createTextureFromSource(gl, options.initialSource) : createRenderTexture(gl, width, height))
    const initialWriteTexture = track(createRenderTexture(gl, width, height))
    const transparentTexture = track(createSolidTexture(gl, [0, 0, 0, 0]))
    const whiteTexture = track(createSolidTexture(gl, [255, 255, 255, 255]))
    if (!initialBaseTexture || !initialWriteTexture || !transparentTexture || !whiteTexture) {
      gl.deleteFramebuffer(framebuffer)
      for (const texture of textures) gl.deleteTexture(texture)
      return { completed: false, reason: "context-lost", layersDrawn: 0, path: "webgl" }
    }
    let baseTexture: WebGLTexture = initialBaseTexture
    let writeTexture: WebGLTexture = initialWriteTexture
    if (!options.initialSource) clearRenderTexture(gl, framebuffer, baseTexture, width, height)

    gl.useProgram(this.program)
    gl.disable(gl.BLEND)
    this.bindBuffers()
    const locations = this.uniformLocations()
    gl.uniform1i(locations.base, 0)
    gl.uniform1i(locations.source, 1)
    gl.uniform1i(locations.mask, 2)
    gl.uniform1i(locations.vectorMask, 3)
    gl.uniform1i(locations.clipMask, 4)
    gl.uniform2f(locations.canvasSize, width, height)

    let layersDrawn = 0
    for (const layer of layers) {
      if (layer.visible === false) continue
      if (!isWebGLBlendModeCompatible(layer.blendMode)) {
        gl.deleteFramebuffer(framebuffer)
        for (const texture of textures) gl.deleteTexture(texture)
        return { completed: false, reason: "unsupported-blend-mode", layersDrawn, path: "webgl" }
      }

      const sourceTexture = track(createTextureFromSource(gl, layer.source))
      const maskTexture = layer.maskSource ? track(createTextureFromSource(gl, layer.maskSource)) : whiteTexture
      const vectorMaskTexture = layer.vectorMaskSource ? track(createTextureFromSource(gl, layer.vectorMaskSource)) : whiteTexture
      const clipMaskTexture = layer.clipMaskSource ? track(createTextureFromSource(gl, layer.clipMaskSource)) : whiteTexture
      if (!sourceTexture || !maskTexture || !vectorMaskTexture || !clipMaskTexture) {
        gl.deleteFramebuffer(framebuffer)
        for (const texture of textures) gl.deleteTexture(texture)
        return { completed: false, reason: "context-lost", layersDrawn, path: "webgl" }
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, writeTexture, 0)
      gl.viewport(0, 0, width, height)
      this.bindTexture(0, baseTexture)
      this.bindTexture(1, sourceTexture)
      this.bindTexture(2, maskTexture)
      this.bindTexture(3, vectorMaskTexture)
      this.bindTexture(4, clipMaskTexture)

      const advanced = layer.advancedBlending
      const channelMask = advanced?.channels ?? { r: true, g: true, b: true }
      const thisRange = blendIfUniform(advanced?.blendIfThis)
      const underlyingRange = blendIfUniform(advanced?.blendIfUnderlying)
      gl.uniform1i(locations.hasMask, layer.maskSource ? 1 : 0)
      gl.uniform1i(locations.hasVectorMask, layer.vectorMaskSource ? 1 : 0)
      gl.uniform1i(locations.hasClipMask, layer.clipMaskSource ? 1 : 0)
      gl.uniform1i(locations.blendMode, BLEND_MODE_CODE.get(layer.blendMode ?? "normal") ?? 0)
      gl.uniform1f(locations.opacity, clamp01(layer.opacity ?? 1))
      gl.uniform1f(locations.fillOpacity, clamp01(layer.fillOpacity ?? 1))
      gl.uniform3f(locations.channelMask, channelMask.r ? 1 : 0, channelMask.g ? 1 : 0, channelMask.b ? 1 : 0)
      gl.uniform1i(locations.hasBlendIf, hasShaderAdvancedBlending(advanced) ? 1 : 0)
      gl.uniform4f(locations.blendIfThis, thisRange[0], thisRange[1], thisRange[2], thisRange[3])
      gl.uniform4f(locations.blendIfUnderlying, underlyingRange[0], underlyingRange[1], underlyingRange[2], underlyingRange[3])
      gl.drawArrays(gl.TRIANGLES, 0, 6)

      const previousBase: WebGLTexture = baseTexture
      baseTexture = writeTexture
      writeTexture = previousBase
      layersDrawn += 1
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    this.bindTexture(0, transparentTexture)
    this.bindTexture(1, baseTexture)
    this.bindTexture(2, whiteTexture)
    this.bindTexture(3, whiteTexture)
    this.bindTexture(4, whiteTexture)
    gl.uniform1i(locations.hasMask, 0)
    gl.uniform1i(locations.hasVectorMask, 0)
    gl.uniform1i(locations.hasClipMask, 0)
    gl.uniform1i(locations.blendMode, 0)
    gl.uniform1f(locations.opacity, 1)
    gl.uniform1f(locations.fillOpacity, 1)
    gl.uniform3f(locations.channelMask, 1, 1, 1)
    gl.uniform1i(locations.hasBlendIf, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    gl.deleteFramebuffer(framebuffer)
    for (const texture of textures) gl.deleteTexture(texture)
    return { completed: true, layersDrawn, path: "webgl" }
  }

  private bindTexture(unit: number, texture: WebGLTexture) {
    const gl = this.gl
    if (!gl) return
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
  }

  private uniformLocations() {
    const gl = this.gl!
    const program = this.program!
    return {
      base: gl.getUniformLocation(program, "u_base"),
      source: gl.getUniformLocation(program, "u_source"),
      mask: gl.getUniformLocation(program, "u_mask"),
      vectorMask: gl.getUniformLocation(program, "u_vectorMask"),
      clipMask: gl.getUniformLocation(program, "u_clipMask"),
      hasMask: gl.getUniformLocation(program, "u_hasMask"),
      hasVectorMask: gl.getUniformLocation(program, "u_hasVectorMask"),
      hasClipMask: gl.getUniformLocation(program, "u_hasClipMask"),
      blendMode: gl.getUniformLocation(program, "u_blendMode"),
      opacity: gl.getUniformLocation(program, "u_opacity"),
      fillOpacity: gl.getUniformLocation(program, "u_fillOpacity"),
      canvasSize: gl.getUniformLocation(program, "u_canvasSize"),
      channelMask: gl.getUniformLocation(program, "u_channelMask"),
      hasBlendIf: gl.getUniformLocation(program, "u_hasBlendIf"),
      blendIfThis: gl.getUniformLocation(program, "u_blendIfThis"),
      blendIfUnderlying: gl.getUniformLocation(program, "u_blendIfUnderlying"),
    }
  }

  private bindBuffers() {
    const gl = this.gl
    if (!gl || !this.program || !this.positionBuffer || !this.texcoordBuffer) return
    const positionLocation = gl.getAttribLocation(this.program, "a_position")
    const texcoordLocation = gl.getAttribLocation(this.program, "a_texcoord")
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer)
    gl.enableVertexAttribArray(texcoordLocation)
    gl.vertexAttribPointer(texcoordLocation, 2, gl.FLOAT, false, 0, 0)
  }

  private initializeBuffers() {
    const gl = this.gl
    if (!gl || !this.positionBuffer || !this.texcoordBuffer) return
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      -1, 1,
      1, -1,
      1, 1,
    ]), gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 1,
      1, 1,
      0, 0,
      0, 0,
      1, 1,
      1, 0,
    ]), gl.STATIC_DRAW)
  }
}

export function cropWebGLSource(source: TexImageSource, rect: WebGLRect): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(rect.w))
  canvas.height = Math.max(1, Math.round(rect.h))
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(source as CanvasImageSource, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h)
  return canvas
}

export function rasterizeVectorMaskForWebGL(layer: Pick<Layer, "vectorMask">, width: number, height: number, tileRect?: WebGLRect): HTMLCanvasElement | null {
  const vectorMask = layer.vectorMask
  if (!vectorMask || !vectorMask.closed || vectorMask.points.length < 3) return null
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(tileRect?.w ?? width))
  canvas.height = Math.max(1, Math.round(tileRect?.h ?? height))
  const ctx = canvas.getContext("2d")!
  ctx.save()
  if (tileRect) ctx.translate(-tileRect.x, -tileRect.y)
  ctx.fillStyle = "#fff"
  ctx.beginPath()
  appendPathToCanvas(ctx, vectorMask)
  ctx.fill("evenodd")
  ctx.restore()
  return canvas
}

function cropOptionalSource(source: TexImageSource | null | undefined, tileRect: WebGLRect | undefined) {
  if (!source || !tileRect) return source ?? null
  return cropWebGLSource(source, tileRect)
}

const ADJUSTMENT_VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec2 a_texcoord;
  varying vec2 v_texcoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texcoord = a_texcoord;
  }
`

function applyGpuAdjustmentToCanvas(targetCtx: CanvasRenderingContext2D, layer: Layer, width: number, height: number): boolean {
  const adjustment = layer.adjustment
  if (!adjustment) return false
  if (!GPU_ADJUSTMENT_TYPES.has(adjustment.type)) return false
  const shader = buildGpuAdjustmentShader(adjustment.type, adjustment.params)
  if (!shader) return false

  const sourceCanvas = document.createElement("canvas")
  sourceCanvas.width = width
  sourceCanvas.height = height
  const sctx = sourceCanvas.getContext("2d")
  if (!sctx) return false
  sctx.drawImage(targetCtx.canvas, 0, 0)

  const gpuCanvas = document.createElement("canvas")
  gpuCanvas.width = width
  gpuCanvas.height = height
  const gl = detectWebGL(gpuCanvas)
  if (!gl) return false

  const vertex = compileShader(gl, gl.VERTEX_SHADER, ADJUSTMENT_VERTEX_SHADER)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, shader.fragmentSource)
  if (!vertex || !fragment) return false
  const program = gl.createProgram()
  if (!program) return false
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return false
  }
  gl.useProgram(program)

  const positionBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
  const positionLoc = gl.getAttribLocation(program, "a_position")
  gl.enableVertexAttribArray(positionLoc)
  gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0)

  const texcoordBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]), gl.STATIC_DRAW)
  const texcoordLoc = gl.getAttribLocation(program, "a_texcoord")
  gl.enableVertexAttribArray(texcoordLoc)
  gl.vertexAttribPointer(texcoordLoc, 2, gl.FLOAT, false, 0, 0)

  const sourceTexture = gl.createTexture()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const sourceUniform = gl.getUniformLocation(program, "u_source")
  if (sourceUniform) gl.uniform1i(sourceUniform, 0)

  const hasCurveLutUniform = gl.getUniformLocation(program, "u_hasCurveLut")
  const curveLutUniform = gl.getUniformLocation(program, "u_curveLut")
  if (shader.curveTexture && curveLutUniform && hasCurveLutUniform) {
    const lutTexture = gl.createTexture()
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, lutTexture)
    const data = new Uint8Array(shader.curveTexture.size)
    for (let i = 0; i < shader.curveTexture.size; i++) {
      data[i] = Math.max(0, Math.min(255, Math.round(shader.curveTexture.values[i] * 255)))
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, shader.curveTexture.size, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, data)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.uniform1i(curveLutUniform, 1)
    gl.uniform1i(hasCurveLutUniform, 1)
  } else if (hasCurveLutUniform) {
    gl.uniform1i(hasCurveLutUniform, 0)
  }

  for (const [name, value] of Object.entries(shader.uniforms)) {
    const loc = gl.getUniformLocation(program, name)
    if (!loc) continue
    if (typeof value === "number") {
      gl.uniform1f(loc, value)
    } else if (value instanceof Float32Array || Array.isArray(value)) {
      const arr = value instanceof Float32Array ? value : new Float32Array(value)
      if (arr.length === 2) gl.uniform2fv(loc, arr)
      else if (arr.length === 3) gl.uniform3fv(loc, arr)
      else if (arr.length === 4) gl.uniform4fv(loc, arr)
      else gl.uniform1fv(loc, arr)
    }
  }

  gl.viewport(0, 0, width, height)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLES, 0, 6)
  targetCtx.clearRect(0, 0, width, height)
  targetCtx.drawImage(gpuCanvas, 0, 0)
  return true
}

export function prepareLayerInputForWebGL(
  layer: Layer,
  context: WebGLCompositeLayerContext,
  sourceOverride?: { source: TexImageSource; fillOpacity?: number },
): WebGLLayerInput | null {
  if (layer.visible === false || layer.kind === "group" || layer.kind === "adjustment") return null
  const source = sourceOverride?.source ?? layer.canvas
  const dimensions = textureDimensions(source)
  if (dimensions.width < 1 || dimensions.height < 1) return null
  return {
    layerId: layer.id,
    source: cropOptionalSource(source, context.tileRect) ?? source,
    opacity: layer.opacity,
    fillOpacity: sourceOverride?.fillOpacity ?? layer.fillOpacity ?? 1,
    blendMode: layer.blendMode,
    visible: layer.visible,
    maskSource: layer.mask && layer.maskEnabled !== false ? cropOptionalSource(layer.mask, context.tileRect) : null,
    vectorMaskSource: rasterizeVectorMaskForWebGL(layer, context.width, context.height, context.tileRect),
    clipMaskSource: context.clipMask ? cropOptionalSource(context.clipMask, context.tileRect) : null,
    advancedBlending: layer.advancedBlending,
  }
}

function resolveClipMask(layers: readonly Layer[], index: number): HTMLCanvasElement | null {
  if (!layers[index]?.clipped) return null
  for (let j = index - 1; j >= 0; j--) {
    if (!layers[j].clipped) return layers[j].canvas
  }
  return null
}

function appendFallbacks(target: WebGLCompositeFallback[], layer: Layer, effects: readonly WebGLEffectFallback[]) {
  for (const effect of effects) target.push({ layerId: layer.id, reason: effect })
}

export function compositeDocumentWithWebGL(
  target: HTMLCanvasElement,
  layers: readonly Layer[],
  options: WebGLCompositeDocumentOptions = {},
): WebGLCompositeResult {
  const width = positiveInt(options.width ?? target.width, 1)
  const height = positiveInt(options.height ?? target.height, 1)
  if (target.width !== width) target.width = width
  if (target.height !== height) target.height = height

  const webglAvailable = options.webglAvailable ?? (() => {
    const probe = document.createElement("canvas")
    return !!detectWebGL(probe)
  })()
  const stackPlan = planWebGLLayerStack({
    width,
    height,
    layerCount: layers.length,
    layers,
    preferWebGL: options.preferWebGL,
    webglAvailable,
    maxTextureSize: options.maxTextureSize,
    cpuLayerFallbackAvailable: !!options.prepareLayer || !!options.drawCpuLayer,
    cpuAdjustmentFallbackAvailable: !!options.applyCpuAdjustment,
  })

  if (stackPlan.path === "canvas-2d") {
    return { completed: false, reason: "webgl-unavailable", layersDrawn: 0, path: stackPlan.path }
  }
  if (stackPlan.unsupportedLayers.some((entry) => entry.reasons.includes("unsupported-blend-mode"))) {
    return { completed: false, reason: "unsupported-blend-mode", layersDrawn: 0, path: stackPlan.path }
  }
  if (stackPlan.unsupportedLayers.length > 0 && !options.drawCpuLayer) {
    return { completed: false, reason: "unsupported-layer", layersDrawn: 0, path: stackPlan.path }
  }

  if (stackPlan.path === "tiled-webgl" && !options.disableTiling) {
    const tileSize = positiveInt(options.tileSize ?? stackPlan.tileSize, stackPlan.maxTextureSize)
    const ctx = target.getContext("2d")
    if (!ctx) return { completed: false, reason: "unsupported-layer", layersDrawn: 0, path: "tiled-webgl" }
    ctx.clearRect(0, 0, width, height)
    let tilesDrawn = 0
    let layersDrawn = 0
    const fallbacks: WebGLCompositeFallback[] = []
    for (let y = 0; y < height; y += tileSize) {
      for (let x = 0; x < width; x += tileSize) {
        const tileRect = { x, y, w: Math.min(tileSize, width - x), h: Math.min(tileSize, height - y) }
        const tileCanvas = document.createElement("canvas")
        tileCanvas.width = tileRect.w
        tileCanvas.height = tileRect.h
        const result = compositeDocumentWithWebGL(tileCanvas, layers, {
          ...options,
          width: tileRect.w,
          height: tileRect.h,
          tileRect,
          disableTiling: true,
          maxTextureSize: Math.max(tileRect.w, tileRect.h, 1),
        })
        if (!result.completed) return { ...result, path: "tiled-webgl", tilesDrawn }
        ctx.drawImage(tileCanvas, x, y)
        tilesDrawn += 1
        layersDrawn += result.layersDrawn
        fallbacks.push(...(result.fallbacks ?? []))
      }
    }
    return { completed: true, layersDrawn, path: "tiled-webgl", tilesDrawn, fallbacks }
  }

  const ctx = target.getContext("2d")
  if (!ctx) return { completed: false, reason: "unsupported-layer", layersDrawn: 0, path: "webgl" }
  ctx.clearRect(0, 0, width, height)

  let gpuBatch: WebGLLayerInput[] = []
  let layersDrawn = 0
  const fallbacks: WebGLCompositeFallback[] = []

  const flushGpu = (): WebGLCompositeResult | null => {
    if (!gpuBatch.length) return null
    const glCanvas = document.createElement("canvas")
    glCanvas.width = width
    glCanvas.height = height
    const result = new WebGL2DCompositor(glCanvas).composite(gpuBatch, { initialSource: target })
    if (!result.completed) return result
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(glCanvas, 0, 0)
    gpuBatch = []
    return null
  }

  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index]
    if (!layer.visible || layer.kind === "group") continue
    const clipMask = resolveClipMask(layers, index)
    const context: WebGLCompositeLayerContext = {
      width,
      height,
      tileRect: options.tileRect,
      clipMask,
      filterPreviewCanvas: options.filterPreviews?.[layer.id],
    }

    if (layer.kind === "adjustment") {
      const failed = flushGpu()
      if (failed) return failed
      const adjustmentType = layer.adjustment?.type
      const isGpuAdjustment = !!adjustmentType && GPU_ADJUSTMENT_TYPES.has(adjustmentType)
      if (isGpuAdjustment && applyGpuAdjustmentToCanvas(ctx, layer, width, height)) {
        layersDrawn += 1
        continue
      }
      if (!options.applyCpuAdjustment) {
        return { completed: false, reason: "unsupported-layer", layersDrawn, path: "webgl", fallbacks }
      }
      options.applyCpuAdjustment(ctx, layer, context)
      fallbacks.push({ layerId: layer.id, reason: "adjustment-layer" })
      layersDrawn += 1
      continue
    }

    const capability = getWebGLLayerCapability(layer, {
      cpuLayerFallbackAvailable: !!options.prepareLayer || !!options.drawCpuLayer,
      hasFilterPreview: !!context.filterPreviewCanvas,
    })
    appendFallbacks(fallbacks, layer, capability.effectFallbacks)

    const prepared = capability.supported
      ? options.prepareLayer?.(layer, context) ?? prepareLayerInputForWebGL(layer, context)
      : null
    if (!prepared) {
      const failed = flushGpu()
      if (failed) return failed
      if (!options.drawCpuLayer) {
        return { completed: false, reason: "unsupported-layer", layersDrawn, path: "webgl", fallbacks }
      }
      options.drawCpuLayer(ctx, layer, context)
      for (const reason of capability.unsupportedReasons) fallbacks.push({ layerId: layer.id, reason })
      layersDrawn += 1
      continue
    }

    gpuBatch.push(prepared)
    layersDrawn += 1
  }

  const failed = flushGpu()
  if (failed) return failed
  return { completed: true, layersDrawn, path: "webgl", fallbacks }
}
