import type { BlendMode, Layer } from "./types"

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

export interface WebGLLayerInput {
  source: TexImageSource
  opacity?: number
  blendMode?: BlendMode
  visible?: boolean
}

export interface WebGLCompositeResult {
  completed: boolean
  reason?: "webgl-unavailable" | "unsupported-layer" | "unsupported-blend-mode" | "context-lost"
  layersDrawn: number
}

const COMPATIBLE_BLEND_MODES = new Set<BlendMode>([
  "normal",
  "screen",
  "multiply",
  "linear-dodge",
  "lighter-color",
])

const GPU_FILTERS = new Set([
  "brightness-contrast",
  "exposure",
  "invert",
  "hue-saturation",
  "vibrance",
  "posterize",
  "threshold",
])

function positiveInt(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || value === undefined) return fallback
  return Math.max(1, Math.round(value))
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
  if (pixelCount < largeDocumentPixels && input.layerCount < 6) {
    return { path: "canvas-2d", reason: "small-document", pixelCount, maxTextureSize }
  }
  return { path: "webgl", reason: "large-compatible-document", pixelCount, maxTextureSize }
}

function detectWebGL(canvas: HTMLCanvasElement): WebGLRenderingContext | WebGL2RenderingContext | null {
  try {
    return canvas.getContext("webgl2", { premultipliedAlpha: true }) ?? canvas.getContext("webgl", { premultipliedAlpha: true })
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

function createProgram(gl: WebGLRenderingContext | WebGL2RenderingContext) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, `
    attribute vec2 a_position;
    attribute vec2 a_texcoord;
    varying vec2 v_texcoord;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texcoord = a_texcoord;
    }
  `)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform sampler2D u_image;
    uniform float u_opacity;
    varying vec2 v_texcoord;
    void main() {
      vec4 color = texture2D(u_image, v_texcoord);
      gl_FragColor = vec4(color.rgb, color.a * u_opacity);
    }
  `)
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

function setBlendMode(gl: WebGLRenderingContext | WebGL2RenderingContext, mode: BlendMode | undefined) {
  gl.enable(gl.BLEND)
  switch (mode) {
    case "multiply":
      gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA)
      break
    case "screen":
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR)
      break
    case "linear-dodge":
    case "lighter-color":
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
      break
    default:
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      break
  }
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

  composite(layers: readonly WebGLLayerInput[]): WebGLCompositeResult {
    const gl = this.gl
    if (!gl || !this.program || !this.positionBuffer || !this.texcoordBuffer) {
      return { completed: false, reason: "webgl-unavailable", layersDrawn: 0 }
    }
    if (gl.isContextLost?.()) return { completed: false, reason: "context-lost", layersDrawn: 0 }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.program)

    const positionLocation = gl.getAttribLocation(this.program, "a_position")
    const texcoordLocation = gl.getAttribLocation(this.program, "a_texcoord")
    const opacityLocation = gl.getUniformLocation(this.program, "u_opacity")
    const imageLocation = gl.getUniformLocation(this.program, "u_image")
    gl.uniform1i(imageLocation, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer)
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer)
    gl.enableVertexAttribArray(texcoordLocation)
    gl.vertexAttribPointer(texcoordLocation, 2, gl.FLOAT, false, 0, 0)

    let layersDrawn = 0
    for (const layer of layers) {
      if (layer.visible === false) continue
      if (!isWebGLBlendModeCompatible(layer.blendMode)) {
        return { completed: false, reason: "unsupported-blend-mode", layersDrawn }
      }
      const texture = gl.createTexture()
      if (!texture) return { completed: false, reason: "context-lost", layersDrawn }
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.source)
      setBlendMode(gl, layer.blendMode)
      gl.uniform1f(opacityLocation, Math.max(0, Math.min(1, layer.opacity ?? 1)))
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      gl.deleteTexture(texture)
      layersDrawn += 1
    }
    return { completed: true, layersDrawn }
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

export function compositeDocumentWithWebGL(target: HTMLCanvasElement, layers: readonly Layer[]): WebGLCompositeResult {
  const compatible: WebGLLayerInput[] = []
  for (const layer of layers) {
    if (!layer.visible || layer.kind === "group") continue
    if (layer.kind === "adjustment" || layer.mask || layer.vectorMask || layer.style || layer.smartFilters?.length) {
      return { completed: false, reason: "unsupported-layer", layersDrawn: 0 }
    }
    if (!isWebGLBlendModeCompatible(layer.blendMode)) {
      return { completed: false, reason: "unsupported-blend-mode", layersDrawn: 0 }
    }
    compatible.push({
      source: layer.canvas,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      visible: layer.visible,
    })
  }
  return new WebGL2DCompositor(target).composite(compatible)
}
