import type { Layer } from "../types"
import type { WebGLCompositeLayerContext, WebGLLayerInput } from "./types"
import { ADJUSTMENT_FRAGMENT_PREFIX, buildGpuAdjustmentShader, type GpuAdjustmentShader } from "./adjustment-shaders"
import { GPU_ADJUSTMENT_TYPES, GPU_FILTERS, clamp01, hasLayerEffects, hasUnsupportedLayerEffects, positiveInt, readBooleanParam, readNumberParam, readStringParam } from "./shared"
import { isWebGLBlendModeCompatible } from "./planning"
import { WebGL2DCompositor, compileShader, detectWebGL, isCanvasLike, textureDimensions } from "./webgl-runtime"
import { cropOptionalSource, rasterizeVectorMaskForWebGL } from "./source-utils"

const ADJUSTMENT_VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec2 a_texcoord;
  varying vec2 v_texcoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texcoord = a_texcoord;
  }
`

export function applyGpuShaderPassToCanvas(
  targetCtx: CanvasRenderingContext2D,
  width: number,
  height: number,
  shader: GpuAdjustmentShader,
): boolean {
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
  if (!sourceTexture) return false
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

  const gradientLutUniform = gl.getUniformLocation(program, "u_gradientLut")
  if (shader.gradientLut && gradientLutUniform) {
    const lutTexture = gl.createTexture()
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, lutTexture)
    const data = new Uint8Array(shader.gradientLut.size * 4)
    for (let i = 0; i < shader.gradientLut.size; i++) {
      data[i * 4] = Math.max(0, Math.min(255, Math.round(shader.gradientLut.values[i * 3] * 255)))
      data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(shader.gradientLut.values[i * 3 + 1] * 255)))
      data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(shader.gradientLut.values[i * 3 + 2] * 255)))
      data[i * 4 + 3] = 255
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, shader.gradientLut.size, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.uniform1i(gradientLutUniform, 2)
  }

  let nextTextureUnit = 3
  const extraTextures: WebGLTexture[] = []
  if (shader.textureUniforms) {
    for (const [name, source] of Object.entries(shader.textureUniforms)) {
      if (!source) continue
      const loc = gl.getUniformLocation(program, name)
      if (!loc) continue
      const texture = gl.createTexture()
      if (!texture) continue
      extraTextures.push(texture)
      gl.activeTexture(gl.TEXTURE0 + nextTextureUnit)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.uniform1i(loc, nextTextureUnit)
      nextTextureUnit += 1
    }
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
  for (const texture of extraTextures) gl.deleteTexture(texture)
  return true
}

export function applyGpuAdjustmentToCanvas(targetCtx: CanvasRenderingContext2D, layer: Layer, width: number, height: number): boolean {
  const adjustment = layer.adjustment
  if (!adjustment) return false
  if (!GPU_ADJUSTMENT_TYPES.has(adjustment.type)) return false
  const shader = buildGpuAdjustmentShader(adjustment.type, adjustment.params)
  if (!shader) return false
  return applyGpuShaderPassToCanvas(targetCtx, width, height, shader)
}

const BLUR_FILTER_SHADER = `${ADJUSTMENT_FRAGMENT_PREFIX}
  uniform vec2 u_texel;
  uniform vec2 u_direction;
  uniform float u_radius;
  uniform float u_gaussian;
  void main() {
    vec4 c = texture2D(u_source, v_texcoord);
    if (u_radius <= 0.01) {
      gl_FragColor = c;
      return;
    }
    vec4 sum = vec4(0.0);
    float total = 0.0;
    float sigma = max(u_radius * 0.5, 0.5);
    for (int i = -32; i <= 32; i++) {
      float fi = float(i);
      if (abs(fi) <= u_radius) {
        float w = u_gaussian > 0.5 ? exp(-0.5 * (fi * fi) / (sigma * sigma)) : 1.0;
        sum += texture2D(u_source, v_texcoord + u_direction * u_texel * fi) * w;
        total += w;
      }
    }
    gl_FragColor = sum / max(total, 0.0001);
  }
`

const MOTION_BLUR_FILTER_SHADER = `${ADJUSTMENT_FRAGMENT_PREFIX}
  uniform vec2 u_texel;
  uniform vec2 u_direction;
  uniform float u_distance;
  void main() {
    vec4 c = texture2D(u_source, v_texcoord);
    if (u_distance <= 0.01) {
      gl_FragColor = c;
      return;
    }
    vec4 sum = vec4(0.0);
    float total = 0.0;
    for (int i = -32; i <= 32; i++) {
      float fi = float(i);
      if (abs(fi) <= u_distance) {
        sum += texture2D(u_source, v_texcoord + u_direction * u_texel * fi);
        total += 1.0;
      }
    }
    gl_FragColor = sum / max(total, 0.0001);
  }
`

const SHARPEN_FILTER_SHADER = `${ADJUSTMENT_FRAGMENT_PREFIX}
  uniform vec2 u_texel;
  uniform float u_amount;
  void main() {
    vec4 c = texture2D(u_source, v_texcoord);
    vec3 n = texture2D(u_source, v_texcoord + vec2(0.0, -u_texel.y)).rgb;
    vec3 s = texture2D(u_source, v_texcoord + vec2(0.0, u_texel.y)).rgb;
    vec3 e = texture2D(u_source, v_texcoord + vec2(u_texel.x, 0.0)).rgb;
    vec3 w = texture2D(u_source, v_texcoord + vec2(-u_texel.x, 0.0)).rgb;
    vec3 blur = (n + s + e + w) * 0.25;
    gl_FragColor = vec4(clamp(c.rgb + (c.rgb - blur) * u_amount, 0.0, 1.0), c.a);
  }
`

const EMBOSS_FILTER_SHADER = `${ADJUSTMENT_FRAGMENT_PREFIX}
  uniform vec2 u_texel;
  uniform float u_amount;
  void main() {
    vec4 c = texture2D(u_source, v_texcoord);
    vec3 nw = texture2D(u_source, v_texcoord + vec2(-u_texel.x, -u_texel.y)).rgb;
    vec3 se = texture2D(u_source, v_texcoord + vec2(u_texel.x, u_texel.y)).rgb;
    float edge = luminance(se - nw);
    vec3 rgb = vec3(0.5 + edge * u_amount);
    gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
  }
`

const FIND_EDGES_FILTER_SHADER = `${ADJUSTMENT_FRAGMENT_PREFIX}
  uniform vec2 u_texel;
  void main() {
    vec3 tl = texture2D(u_source, v_texcoord + vec2(-u_texel.x, -u_texel.y)).rgb;
    vec3 tc = texture2D(u_source, v_texcoord + vec2(0.0, -u_texel.y)).rgb;
    vec3 tr = texture2D(u_source, v_texcoord + vec2(u_texel.x, -u_texel.y)).rgb;
    vec3 ml = texture2D(u_source, v_texcoord + vec2(-u_texel.x, 0.0)).rgb;
    vec3 mr = texture2D(u_source, v_texcoord + vec2(u_texel.x, 0.0)).rgb;
    vec3 bl = texture2D(u_source, v_texcoord + vec2(-u_texel.x, u_texel.y)).rgb;
    vec3 bc = texture2D(u_source, v_texcoord + vec2(0.0, u_texel.y)).rgb;
    vec3 br = texture2D(u_source, v_texcoord + vec2(u_texel.x, u_texel.y)).rgb;
    vec3 gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
    vec3 gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
    float edge = clamp(length(gx) + length(gy), 0.0, 1.0);
    vec4 c = texture2D(u_source, v_texcoord);
    gl_FragColor = vec4(vec3(1.0 - edge), c.a);
  }
`

const SOLARIZE_FILTER_SHADER = `${ADJUSTMENT_FRAGMENT_PREFIX}
  uniform float u_threshold;
  void main() {
    vec4 c = texture2D(u_source, v_texcoord);
    vec3 inverted = vec3(1.0) - c.rgb;
    vec3 rgb = mix(c.rgb, inverted, step(u_threshold, c.rgb));
    gl_FragColor = vec4(rgb, c.a);
  }
`

const PIXELATE_FILTER_SHADER = `${ADJUSTMENT_FRAGMENT_PREFIX}
  uniform vec2 u_canvasSize;
  uniform float u_size;
  void main() {
    vec2 pixel = floor(v_texcoord * u_canvasSize / max(u_size, 1.0)) * max(u_size, 1.0) + max(u_size, 1.0) * 0.5;
    gl_FragColor = texture2D(u_source, clamp(pixel / u_canvasSize, vec2(0.0), vec2(1.0)));
  }
`

const NOISE_FILTER_SHADER = `${ADJUSTMENT_FRAGMENT_PREFIX}
  uniform float u_amount;
  uniform float u_mono;
  float random(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }
  void main() {
    vec4 c = texture2D(u_source, v_texcoord);
    vec3 n = vec3(random(gl_FragCoord.xy), random(gl_FragCoord.yx + 13.0), random(gl_FragCoord.xy + 29.0)) - vec3(0.5);
    if (u_mono > 0.5) n = vec3(n.r);
    gl_FragColor = vec4(clamp(c.rgb + n * u_amount, 0.0, 1.0), c.a);
  }
`

// Unsharp mask is implemented as a single-pass shader that samples a Gaussian
// neighborhood (separable kernel is approximated by sampling a 2D box scaled by
// radius), computes the blurred average, then amplifies (source - blurred) by
// the configured amount. Threshold suppresses sharpening below low-contrast
// edges, matching the Photoshop control.
const UNSHARP_MASK_FILTER_SHADER = `${ADJUSTMENT_FRAGMENT_PREFIX}
  uniform vec2 u_texel;
  uniform float u_amount;
  uniform float u_radius;
  uniform float u_threshold;
  void main() {
    vec4 c = texture2D(u_source, v_texcoord);
    float r = clamp(u_radius, 0.0, 16.0);
    vec3 blurred = c.rgb;
    if (r > 0.01) {
      float sigma = max(r * 0.5, 0.5);
      vec3 acc = vec3(0.0);
      float total = 0.0;
      for (int y = -8; y <= 8; y++) {
        for (int x = -8; x <= 8; x++) {
          vec2 offset = vec2(float(x), float(y));
          float d = length(offset);
          if (d <= 8.0) {
            float w = exp(-0.5 * (d * d) / (sigma * sigma));
            acc += texture2D(u_source, v_texcoord + offset * u_texel * (r / 8.0)).rgb * w;
            total += w;
          }
        }
      }
      blurred = acc / max(total, 0.0001);
    }
    vec3 detail = c.rgb - blurred;
    float strength = step(u_threshold / 255.0, max(max(abs(detail.r), abs(detail.g)), abs(detail.b)));
    vec3 rgb = c.rgb + detail * u_amount * strength;
    gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
  }
`

// Gradient map maps the source luminance through a 1D LUT texture built from the
// configured gradient stops. CPU-side `buildGradientMapLut` parses the stop
// string into a 256-entry RGB LUT, optionally reversed and HSL-interpolated.
const GRADIENT_MAP_FILTER_SHADER = `${ADJUSTMENT_FRAGMENT_PREFIX}
  uniform sampler2D u_gradientLut;
  uniform float u_dither;
  void main() {
    vec4 c = texture2D(u_source, v_texcoord);
    float lum = luminance(c.rgb);
    if (u_dither > 0.5) {
      float n = (fract(sin(dot(gl_FragCoord.xy + vec2(0.5), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * (1.0 / 255.0);
      lum = clamp(lum + n, 0.0, 1.0);
    }
    vec3 mapped = texture2D(u_gradientLut, vec2(clamp(lum, 0.0, 1.0), 0.5)).rgb;
    gl_FragColor = vec4(mapped, c.a);
  }
`

function hexToRgb01(hex: string): [number, number, number] {
  if (!hex || hex[0] !== "#") return [0, 0, 0]
  const body = hex.slice(1)
  const expanded = body.length === 3
    ? body.split("").map((char) => char + char).join("")
    : body
  if (expanded.length !== 6) return [0, 0, 0]
  const parsed = Number.parseInt(expanded, 16)
  if (!Number.isFinite(parsed)) return [0, 0, 0]
  return [((parsed >> 16) & 255) / 255, ((parsed >> 8) & 255) / 255, (parsed & 255) / 255]
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h / 6, s, l]
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)]
}

interface GradientStop { offset: number; r: number; g: number; b: number }

function parseGradientStops(raw: string): GradientStop[] {
  const stops: GradientStop[] = []
  for (const entry of raw.split(";")) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const [offsetStr, colorStr] = trimmed.split(",").map((part) => part.trim())
    const offset = Number(offsetStr)
    if (!Number.isFinite(offset) || !colorStr) continue
    const [r, g, b] = hexToRgb01(colorStr)
    stops.push({ offset: Math.max(0, Math.min(1, offset)), r, g, b })
  }
  if (!stops.length) {
    stops.push({ offset: 0, r: 0, g: 0, b: 0 })
    stops.push({ offset: 1, r: 1, g: 1, b: 1 })
  }
  stops.sort((a, b) => a.offset - b.offset)
  return stops
}

export function buildGradientMapLut(
  raw: string,
  options: { reverse?: boolean; interpolation?: "rgb" | "hsl"; size?: number } = {},
): { values: Float32Array; size: number } {
  const size = Math.max(2, Math.min(1024, options.size ?? 256))
  const stops = parseGradientStops(raw)
  if (options.reverse) {
    for (const stop of stops) stop.offset = 1 - stop.offset
    stops.sort((a, b) => a.offset - b.offset)
  }
  const values = new Float32Array(size * 3)
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1)
    let lo = stops[0]
    let hi = stops[stops.length - 1]
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s].offset && t <= stops[s + 1].offset) {
        lo = stops[s]
        hi = stops[s + 1]
        break
      }
    }
    const range = Math.max(1e-6, hi.offset - lo.offset)
    const f = Math.max(0, Math.min(1, (t - lo.offset) / range))
    let r: number, g: number, b: number
    if (options.interpolation === "hsl") {
      const loH = rgbToHsl(lo.r, lo.g, lo.b)
      const hiH = rgbToHsl(hi.r, hi.g, hi.b)
      // shortest-arc hue interpolation
      let h = loH[0]
      const dh = hiH[0] - loH[0]
      if (dh > 0.5) h = loH[0] + (dh - 1) * f
      else if (dh < -0.5) h = loH[0] + (dh + 1) * f
      else h = loH[0] + dh * f
      h = (h + 1) % 1
      const s = loH[1] + (hiH[1] - loH[1]) * f
      const l = loH[2] + (hiH[2] - loH[2]) * f
      ;[r, g, b] = hslToRgb(h, s, l)
    } else {
      r = lo.r + (hi.r - lo.r) * f
      g = lo.g + (hi.g - lo.g) * f
      b = lo.b + (hi.b - lo.b) * f
    }
    values[i * 3] = Math.max(0, Math.min(1, r))
    values[i * 3 + 1] = Math.max(0, Math.min(1, g))
    values[i * 3 + 2] = Math.max(0, Math.min(1, b))
  }
  return { values, size }
}

function buildGpuFilterPasses(
  filterId: string,
  params: Record<string, number | string | boolean> | undefined,
  width: number,
  height: number,
): GpuAdjustmentShader[] | null {
  const texel = [1 / Math.max(1, width), 1 / Math.max(1, height)]
  const adjustmentId = filterId === "grayscale" ? "grayscale" : filterId
  const adjustmentShader = buildGpuAdjustmentShader(adjustmentId, params)
  if (adjustmentShader) return [adjustmentShader]

  if (filterId === "gaussian-blur" || filterId === "box-blur") {
    const radius = Math.min(32, Math.max(0, readNumberParam(params, "radius", 4)))
    const gaussian = filterId === "gaussian-blur" ? 1 : 0
    return [
      { fragmentSource: BLUR_FILTER_SHADER, uniforms: { u_texel: texel, u_direction: [1, 0], u_radius: radius, u_gaussian: gaussian } },
      { fragmentSource: BLUR_FILTER_SHADER, uniforms: { u_texel: texel, u_direction: [0, 1], u_radius: radius, u_gaussian: gaussian } },
    ]
  }
  if (filterId === "motion-blur") {
    const angle = (readNumberParam(params, "angle", 0) * Math.PI) / 180
    const distance = Math.min(32, Math.max(0, readNumberParam(params, "distance", 12)))
    return [{
      fragmentSource: MOTION_BLUR_FILTER_SHADER,
      uniforms: {
        u_texel: texel,
        u_direction: [Math.cos(angle), Math.sin(angle)],
        u_distance: distance,
      },
    }]
  }
  if (filterId === "sharpen") {
    return [{ fragmentSource: SHARPEN_FILTER_SHADER, uniforms: { u_texel: texel, u_amount: readNumberParam(params, "amount", 50) / 100 } }]
  }
  if (filterId === "unsharp-mask") {
    return [{
      fragmentSource: UNSHARP_MASK_FILTER_SHADER,
      uniforms: {
        u_texel: texel,
        u_amount: readNumberParam(params, "amount", 100) / 100,
        u_radius: Math.min(16, Math.max(0, readNumberParam(params, "radius", 1))),
        u_threshold: readNumberParam(params, "threshold", 0),
      },
    }]
  }
  if (filterId === "gradient-map") {
    const lut = buildGradientMapLut(readStringParam(params, "gradient", "0,#000000;1,#ffffff"), {
      reverse: readBooleanParam(params, "reverse", false),
      interpolation: readStringParam(params, "interpolation", "rgb") === "hsl" ? "hsl" : "rgb",
      size: 256,
    })
    return [{
      fragmentSource: GRADIENT_MAP_FILTER_SHADER,
      uniforms: { u_dither: readBooleanParam(params, "dither", true) ? 1 : 0 },
      gradientLut: lut,
    }]
  }
  if (filterId === "emboss") {
    return [{ fragmentSource: EMBOSS_FILTER_SHADER, uniforms: { u_texel: texel, u_amount: readNumberParam(params, "amount", 100) / 100 } }]
  }
  if (filterId === "find-edges") {
    return [{ fragmentSource: FIND_EDGES_FILTER_SHADER, uniforms: { u_texel: texel } }]
  }
  if (filterId === "solarize") {
    return [{ fragmentSource: SOLARIZE_FILTER_SHADER, uniforms: { u_threshold: readNumberParam(params, "threshold", 128) / 255 } }]
  }
  if (filterId === "pixelate") {
    return [{ fragmentSource: PIXELATE_FILTER_SHADER, uniforms: { u_canvasSize: [width, height], u_size: readNumberParam(params, "size", 8) } }]
  }
  if (filterId === "noise") {
    return [{
      fragmentSource: NOISE_FILTER_SHADER,
      uniforms: {
        u_amount: readNumberParam(params, "amount", 25) / 100,
        u_mono: readBooleanParam(params, "mono", false) ? 1 : 0,
      },
    }]
  }
  return null
}

function applyGpuFilterToCanvas(
  target: HTMLCanvasElement,
  filterId: string,
  params: Record<string, number | string | boolean> | undefined,
): boolean {
  if (!GPU_FILTERS.has(filterId)) return false
  const passes = buildGpuFilterPasses(filterId, params, target.width, target.height)
  if (!passes?.length) return false
  const ctx = target.getContext("2d")
  if (!ctx) return false
  for (const pass of passes) {
    if (!applyGpuShaderPassToCanvas(ctx, target.width, target.height, pass)) return false
  }
  return true
}

function cloneCanvasForWebGL(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = source.width
  canvas.height = source.height
  canvas.getContext("2d")!.drawImage(source, 0, 0)
  return canvas
}

function unitColor(value: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!value || !value.startsWith("#")) return fallback
  const hex = value.slice(1)
  const expanded = hex.length === 3
    ? hex.split("").map((char) => char + char).join("")
    : hex
  if (expanded.length !== 6) return fallback
  const parsed = Number.parseInt(expanded, 16)
  if (!Number.isFinite(parsed)) return fallback
  return [
    ((parsed >> 16) & 255) / 255,
    ((parsed >> 8) & 255) / 255,
    (parsed & 255) / 255,
  ]
}

const LAYER_STYLE_SHADER = `${ADJUSTMENT_FRAGMENT_PREFIX}
  uniform sampler2D u_fillSource;
  uniform float u_hasFillSource;
  uniform vec2 u_texel;
  uniform float u_fillOpacity;
  uniform float u_hasDropShadow;
  uniform vec3 u_dropShadowColor;
  uniform vec2 u_dropShadowOffset;
  uniform float u_dropShadowSize;
  uniform float u_dropShadowOpacity;
  uniform float u_hasOuterGlow;
  uniform vec3 u_outerGlowColor;
  uniform float u_outerGlowSize;
  uniform float u_outerGlowOpacity;
  uniform float u_outerGlowSpread;
  uniform float u_hasInnerGlow;
  uniform vec3 u_innerGlowColor;
  uniform float u_innerGlowSize;
  uniform float u_innerGlowOpacity;
  uniform float u_innerGlowChoke;
  uniform float u_hasInnerShadow;
  uniform vec3 u_innerShadowColor;
  uniform vec2 u_innerShadowOffset;
  uniform float u_innerShadowSize;
  uniform float u_innerShadowOpacity;
  uniform float u_hasBevel;
  uniform vec3 u_bevelHighlightColor;
  uniform vec3 u_bevelShadowColor;
  uniform float u_bevelSize;
  uniform float u_bevelHighlightOpacity;
  uniform float u_bevelShadowOpacity;
  uniform float u_hasColorOverlay;
  uniform vec3 u_colorOverlayColor;
  uniform float u_colorOverlayOpacity;
  uniform float u_hasGradientOverlay;
  uniform vec3 u_gradientStartColor;
  uniform vec3 u_gradientEndColor;
  uniform float u_gradientAngle;
  uniform float u_gradientOpacity;
  uniform float u_hasPatternOverlay;
  uniform vec3 u_patternColor;
  uniform float u_patternScale;
  uniform float u_patternKind;
  uniform float u_patternOpacity;
  uniform float u_hasSatin;
  uniform vec3 u_satinColor;
  uniform vec2 u_satinOffset;
  uniform float u_satinSize;
  uniform float u_satinOpacity;
  uniform float u_satinInvert;
  uniform float u_hasStroke;
  uniform vec3 u_strokeColor;
  uniform float u_strokeSize;
  uniform float u_strokeOpacity;
  uniform float u_strokePosition;
  uniform vec2 u_canvasSize;

  vec4 over(vec4 top, vec4 bottom) {
    float a = top.a + bottom.a * (1.0 - top.a);
    vec3 rgb = a > 0.0 ? (top.rgb * top.a + bottom.rgb * bottom.a * (1.0 - top.a)) / a : vec3(0.0);
    return vec4(clamp(rgb, 0.0, 1.0), clamp(a, 0.0, 1.0));
  }

  float blurredAlpha(vec2 uv, vec2 offsetPx, float radius) {
    float r = clamp(radius, 0.0, 24.0);
    if (r <= 0.01) return texture2D(u_source, uv - offsetPx * u_texel).a;
    float total = 0.0;
    float weight = 0.0;
    for (int y = -6; y <= 6; y++) {
      for (int x = -6; x <= 6; x++) {
        vec2 p = vec2(float(x), float(y));
        float d = length(p);
        if (d <= 6.0) {
          float w = max(0.0, 1.0 - d / 6.0);
          total += texture2D(u_source, uv - offsetPx * u_texel + p * u_texel * (r / 6.0)).a * w;
          weight += w;
        }
      }
    }
    return total / max(weight, 0.0001);
  }

  float edgeInside(float alpha, float radius) {
    if (alpha <= 0.0) return 0.0;
    float n = blurredAlpha(v_texcoord, vec2(0.0), max(radius, 1.0));
    return clamp(alpha - n + 0.5, 0.0, 1.0) * alpha;
  }

  void main() {
    vec4 src = texture2D(u_source, v_texcoord);
    vec4 fillSrc = u_hasFillSource > 0.5 ? texture2D(u_fillSource, v_texcoord) : src;
    float alpha = src.a;
    float fillAlpha = fillSrc.a;
    vec4 result = vec4(0.0);

    if (u_hasDropShadow > 0.5) {
      float a = blurredAlpha(v_texcoord, u_dropShadowOffset, u_dropShadowSize) * u_dropShadowOpacity;
      result = over(vec4(u_dropShadowColor, a), result);
    }

    if (u_hasOuterGlow > 0.5) {
      float a = max(0.0, blurredAlpha(v_texcoord, vec2(0.0), u_outerGlowSize) - alpha) * (1.0 + u_outerGlowSpread) * u_outerGlowOpacity;
      result = over(vec4(u_outerGlowColor, a), result);
    }

    result = over(vec4(fillSrc.rgb, fillAlpha * clamp(u_fillOpacity, 0.0, 1.0)), result);

    if (u_hasInnerShadow > 0.5) {
      float shifted = blurredAlpha(v_texcoord, u_innerShadowOffset, u_innerShadowSize);
      float a = clamp((1.0 - shifted) * alpha, 0.0, 1.0) * u_innerShadowOpacity;
      result = over(vec4(u_innerShadowColor, a), result);
    }

    if (u_hasInnerGlow > 0.5) {
      float a = edgeInside(alpha, u_innerGlowSize) * (1.0 + u_innerGlowChoke) * u_innerGlowOpacity;
      result = over(vec4(u_innerGlowColor, a), result);
    }

    if (u_hasBevel > 0.5 && alpha > 0.0) {
      float left = texture2D(u_source, v_texcoord - vec2(u_texel.x, 0.0) * max(u_bevelSize, 1.0)).a;
      float right = texture2D(u_source, v_texcoord + vec2(u_texel.x, 0.0) * max(u_bevelSize, 1.0)).a;
      float top = texture2D(u_source, v_texcoord - vec2(0.0, u_texel.y) * max(u_bevelSize, 1.0)).a;
      float bottom = texture2D(u_source, v_texcoord + vec2(0.0, u_texel.y) * max(u_bevelSize, 1.0)).a;
      float light = clamp((left - right + top - bottom) * 0.5 + 0.5, 0.0, 1.0);
      float edge = edgeInside(alpha, u_bevelSize);
      result = over(vec4(u_bevelHighlightColor, max(0.0, light - 0.5) * 2.0 * edge * u_bevelHighlightOpacity), result);
      result = over(vec4(u_bevelShadowColor, max(0.0, 0.5 - light) * 2.0 * edge * u_bevelShadowOpacity), result);
    }

    if (u_hasColorOverlay > 0.5) {
      result = over(vec4(u_colorOverlayColor, alpha * u_colorOverlayOpacity), result);
    }

    if (u_hasGradientOverlay > 0.5) {
      vec2 centered = v_texcoord - vec2(0.5);
      float angle = radians(u_gradientAngle);
      float t = dot(centered, vec2(cos(angle), sin(angle))) + 0.5;
      vec3 color = mix(u_gradientStartColor, u_gradientEndColor, clamp(t, 0.0, 1.0));
      result = over(vec4(color, alpha * u_gradientOpacity), result);
    }

    if (u_hasPatternOverlay > 0.5) {
      float scale = max(u_patternScale, 1.0);
      vec2 cell = floor(gl_FragCoord.xy / scale);
      vec2 local = fract(gl_FragCoord.xy / scale);
      float pattern = mod(cell.x + cell.y, 2.0);
      if (u_patternKind > 0.5 && u_patternKind < 1.5) pattern = step(length(local - vec2(0.5)), 0.28);
      else if (u_patternKind > 1.5 && u_patternKind < 2.5) pattern = step(local.y, 0.5);
      else if (u_patternKind > 2.5) pattern = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      result = over(vec4(u_patternColor, alpha * pattern * u_patternOpacity), result);
    }

    if (u_hasSatin > 0.5 && alpha > 0.0) {
      // Satin: sample the layer alpha at +/- offset along a tangent direction,
      // compute the difference (interior "ribbon"), optionally invert.
      float aPos = texture2D(u_source, v_texcoord + u_satinOffset * u_texel).a;
      float aNeg = texture2D(u_source, v_texcoord - u_satinOffset * u_texel).a;
      float blurredPos = blurredAlpha(v_texcoord, u_satinOffset, u_satinSize);
      float blurredNeg = blurredAlpha(v_texcoord, -u_satinOffset, u_satinSize);
      float ribbon = clamp((aPos * aNeg) * (1.0 - abs(blurredPos - blurredNeg)), 0.0, 1.0);
      if (u_satinInvert > 0.5) ribbon = clamp(alpha - ribbon, 0.0, 1.0);
      result = over(vec4(u_satinColor, ribbon * alpha * u_satinOpacity), result);
    }

    if (u_hasStroke > 0.5) {
      // Stroke: outside = dilation(alpha) - alpha; inside = alpha - erosion(alpha);
      // center = (outside + inside)*0.5. Position selects: 0=outside, 1=inside, 2=center.
      float r = max(u_strokeSize, 0.1);
      float maxA = 0.0;
      float minA = 1.0;
      for (int y = -4; y <= 4; y++) {
        for (int x = -4; x <= 4; x++) {
          vec2 p = vec2(float(x), float(y));
          if (length(p) <= 4.0) {
            float sample = texture2D(u_source, v_texcoord + p * u_texel * (r / 4.0)).a;
            maxA = max(maxA, sample);
            minA = min(minA, sample);
          }
        }
      }
      float outside = clamp(maxA - alpha, 0.0, 1.0);
      float inside = clamp(alpha - minA, 0.0, 1.0);
      float strokeAlpha = u_strokePosition < 0.5
        ? outside
        : (u_strokePosition < 1.5 ? inside : clamp((outside + inside) * 0.5, 0.0, 1.0));
      result = over(vec4(u_strokeColor, strokeAlpha * u_strokeOpacity), result);
    }

    gl_FragColor = result;
  }
`

function gradientColorPair(layer: Layer): { start: [number, number, number]; end: [number, number, number]; angle: number } {
  const gradient = layer.style?.gradientOverlay?.gradient
  const stops = gradient?.stops ?? []
  const first = stops[0]
  const last = stops[stops.length - 1]
  return {
    start: unitColor(first?.color, [0, 0, 0]),
    end: unitColor(last?.color, [1, 1, 1]),
    angle: gradient?.angle ?? 0,
  }
}

function layerStyleOffset(
  effect: { offsetX?: number; offsetY?: number; angle?: number; distance?: number } | undefined,
): [number, number] {
  if (!effect) return [0, 0]
  if (Number.isFinite(effect.offsetX) || Number.isFinite(effect.offsetY)) {
    return [effect.offsetX ?? 0, effect.offsetY ?? 0]
  }
  const distance = Number.isFinite(effect.distance) ? effect.distance ?? 0 : 0
  const angle = ((Number.isFinite(effect.angle) ? effect.angle ?? 0 : 0) * Math.PI) / 180
  return [Math.cos(angle) * distance, Math.sin(angle) * distance]
}

function patternKindCode(pattern: string | undefined): number {
  if (pattern === "dots") return 1
  if (pattern === "lines") return 2
  if (pattern === "noise") return 3
  return 0
}

function buildGpuLayerStyleShader(layer: Layer, fillOpacity: number, fillSource?: TexImageSource | null): GpuAdjustmentShader | null {
  if (!layer.style || hasUnsupportedLayerEffects(layer)) return null
  const style = layer.style
  const drop = style.dropShadow
  const outerGlow = style.outerGlow
  const innerGlow = style.innerGlow
  const innerShadow = style.innerShadow
  const bevel = style.bevel
  const colorOverlay = style.colorOverlay
  const gradientOverlay = style.gradientOverlay
  const patternOverlay = style.patternOverlay
  const satin = style.satin
  const stroke = style.stroke
  const gradient = gradientColorPair(layer)
  const satinAngleRad = ((satin?.angle ?? 0) * Math.PI) / 180
  const satinDistance = satin?.distance ?? 0
  const strokePositionCode = stroke?.position === "inside" ? 1 : stroke?.position === "center" ? 2 : 0
  const dropOffset = layerStyleOffset(drop)
  const innerShadowOffset = layerStyleOffset(innerShadow)
  const bevelOpacity = bevel?.opacity ?? 0
  const bevelHighlightColor = bevel?.direction === "down" ? bevel?.shadow : bevel?.highlight
  const bevelShadowColor = bevel?.direction === "down" ? bevel?.highlight : bevel?.shadow
  const bevelHighlightOpacity = bevel?.direction === "down" ? bevel?.shadowOpacity : bevel?.highlightOpacity
  const bevelShadowOpacity = bevel?.direction === "down" ? bevel?.highlightOpacity : bevel?.shadowOpacity
  return {
    fragmentSource: LAYER_STYLE_SHADER,
    uniforms: {
      u_hasFillSource: fillSource ? 1 : 0,
      u_texel: [1 / Math.max(1, layer.canvas.width), 1 / Math.max(1, layer.canvas.height)],
      u_canvasSize: [layer.canvas.width, layer.canvas.height],
      u_fillOpacity: fillOpacity,
      u_hasDropShadow: drop?.enabled ? 1 : 0,
      u_dropShadowColor: unitColor(drop?.color, [0, 0, 0]),
      u_dropShadowOffset: dropOffset,
      u_dropShadowSize: drop?.size ?? 0,
      u_dropShadowOpacity: drop?.opacity ?? 0,
      u_hasOuterGlow: outerGlow?.enabled ? 1 : 0,
      u_outerGlowColor: unitColor(outerGlow?.color, [1, 1, 1]),
      u_outerGlowSize: outerGlow?.size ?? 0,
      u_outerGlowOpacity: outerGlow?.opacity ?? 0,
      u_outerGlowSpread: (outerGlow?.spread ?? 0) / 100,
      u_hasInnerGlow: innerGlow?.enabled ? 1 : 0,
      u_innerGlowColor: unitColor(innerGlow?.color, [1, 1, 1]),
      u_innerGlowSize: innerGlow?.size ?? 0,
      u_innerGlowOpacity: innerGlow?.opacity ?? 0,
      u_innerGlowChoke: (innerGlow?.choke ?? 0) / 100,
      u_hasInnerShadow: innerShadow?.enabled ? 1 : 0,
      u_innerShadowColor: unitColor(innerShadow?.color, [0, 0, 0]),
      u_innerShadowOffset: innerShadowOffset,
      u_innerShadowSize: innerShadow?.size ?? 0,
      u_innerShadowOpacity: innerShadow?.opacity ?? 0,
      u_hasBevel: bevel?.enabled ? 1 : 0,
      u_bevelHighlightColor: unitColor(bevelHighlightColor, [1, 1, 1]),
      u_bevelShadowColor: unitColor(bevelShadowColor, [0, 0, 0]),
      u_bevelSize: bevel?.size ?? 0,
      u_bevelHighlightOpacity: bevelHighlightOpacity ?? bevelOpacity,
      u_bevelShadowOpacity: bevelShadowOpacity ?? bevelOpacity,
      u_hasColorOverlay: colorOverlay?.enabled ? 1 : 0,
      u_colorOverlayColor: unitColor(colorOverlay?.color, [1, 1, 1]),
      u_colorOverlayOpacity: colorOverlay?.opacity ?? 0,
      u_hasGradientOverlay: gradientOverlay?.enabled ? 1 : 0,
      u_gradientStartColor: gradient.start,
      u_gradientEndColor: gradient.end,
      u_gradientAngle: gradient.angle,
      u_gradientOpacity: gradientOverlay?.opacity ?? 0,
      u_hasPatternOverlay: patternOverlay?.enabled ? 1 : 0,
      u_patternColor: unitColor(patternOverlay?.color, [0.5, 0.5, 0.5]),
      u_patternScale: patternOverlay?.scale ?? 16,
      u_patternKind: patternKindCode(patternOverlay?.pattern),
      u_patternOpacity: patternOverlay?.opacity ?? 0,
      u_hasSatin: satin?.enabled ? 1 : 0,
      u_satinColor: unitColor(satin?.color, [0, 0, 0]),
      u_satinOffset: [Math.cos(satinAngleRad) * satinDistance, Math.sin(satinAngleRad) * satinDistance],
      u_satinSize: satin?.size ?? 0,
      u_satinOpacity: satin?.opacity ?? 0,
      u_satinInvert: satin?.invert ? 1 : 0,
      u_hasStroke: stroke?.enabled ? 1 : 0,
      u_strokeColor: unitColor(stroke?.color, [0, 0, 0]),
      u_strokeSize: stroke?.size ?? 0,
      u_strokeOpacity: stroke?.opacity ?? 1,
      u_strokePosition: strokePositionCode,
    },
    textureUniforms: fillSource ? { u_fillSource: fillSource } : undefined,
  }
}

export function applyGpuLayerStyleToCanvas(
  layer: Layer,
  fillOpacity = 1,
  options: { effectSourceCanvas?: HTMLCanvasElement; fillSourceCanvas?: HTMLCanvasElement } = {},
): HTMLCanvasElement | null {
  if (typeof document === "undefined" || !hasLayerEffects(layer)) return null
  const effectSource = options.effectSourceCanvas ?? layer.canvas
  const fillSource = options.fillSourceCanvas && options.fillSourceCanvas !== effectSource
    ? options.fillSourceCanvas
    : null
  const shader = buildGpuLayerStyleShader(layer, fillOpacity, fillSource)
  if (!shader) return null
  const canvas = cloneCanvasForWebGL(effectSource)
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  return applyGpuShaderPassToCanvas(ctx, canvas.width, canvas.height, shader) ? canvas : null
}

const SMART_FILTER_MASK_SHADER = `${ADJUSTMENT_FRAGMENT_PREFIX}
  uniform float u_density;
  void main() {
    vec4 c = texture2D(u_source, v_texcoord);
    float maskAmount = luminance(c.rgb) * c.a;
    float coverage = mix(1.0, maskAmount, clamp(u_density, 0.0, 1.0));
    gl_FragColor = vec4(vec3(coverage), 1.0);
  }
`

function normalizeCanvasForWebGL(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  if (source.width === width && source.height === height) return cloneCanvasForWebGL(source)
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  canvas.getContext("2d")!.drawImage(source, 0, 0, width, height)
  return canvas
}

function prepareSmartFilterMaskForWebGL(
  filter: NonNullable<Layer["smartFilters"]>[number],
  width: number,
  height: number,
): HTMLCanvasElement | null {
  if (filter.maskEnabled === false || !filter.mask) return null
  const feather = Math.max(0, Math.min(32, filter.maskFeather ?? 0))
  const density = clamp01(filter.maskDensity ?? 1)
  const mask = normalizeCanvasForWebGL(filter.mask, width, height)
  const ctx = mask.getContext("2d")
  if (!ctx) return null
  if (feather > 0 && !applyGpuFilterToCanvas(mask, "gaussian-blur", { radius: feather })) return null
  if (density < 1 || feather > 0) {
    const shader: GpuAdjustmentShader = {
      fragmentSource: SMART_FILTER_MASK_SHADER,
      uniforms: { u_density: density },
    }
    if (!applyGpuShaderPassToCanvas(ctx, width, height, shader)) return null
  }
  return mask
}

function isGpuSmartFilterCompositeCompatible(filter: NonNullable<Layer["smartFilters"]>[number]) {
  const feather = filter.maskFeather ?? 0
  const density = filter.maskDensity ?? 1
  return (
    feather >= 0 &&
    feather <= 32 &&
    density >= 0 &&
    density <= 1 &&
    isWebGLBlendModeCompatible(filter.blendMode)
  )
}

function isGpuSmartFilterCompatible(filter: NonNullable<Layer["smartFilters"]>[number]) {
  return filter.enabled !== false && GPU_FILTERS.has(filter.filterId) && isGpuSmartFilterCompositeCompatible(filter)
}

export function applyGpuSmartFiltersToCanvas(
  source: HTMLCanvasElement,
  smartFilters: Layer["smartFilters"],
): HTMLCanvasElement | null {
  const enabled = smartFilters?.filter((filter) => filter.enabled !== false) ?? []
  if (!enabled.length) return source
  if (typeof document === "undefined" || !enabled.every(isGpuSmartFilterCompatible)) return null

  let current = cloneCanvasForWebGL(source)
  for (const smartFilter of enabled) {
    const opacity = clamp01(smartFilter.opacity ?? 1)
    if (opacity <= 0) continue
    const blendMode = smartFilter.blendMode ?? "normal"
    const maskSource = prepareSmartFilterMaskForWebGL(smartFilter, source.width, source.height)
    if (smartFilter.maskEnabled !== false && smartFilter.mask && !maskSource) return null
    const needsComposite = opacity < 1 || blendMode !== "normal" || !!maskSource
    const before = needsComposite ? cloneCanvasForWebGL(current) : null
    if (!applyGpuFilterToCanvas(current, smartFilter.filterId, smartFilter.params)) return null
    if (before) {
      const composited = document.createElement("canvas")
      composited.width = source.width
      composited.height = source.height
      const result = new WebGL2DCompositor(composited).composite([
        {
          layerId: smartFilter.id,
          source: current,
          opacity,
          blendMode,
          maskSource,
        },
      ], { initialSource: before })
      if (!result.completed) return null
      current = composited
    }
  }
  return current
}

export function applyGpuAdjustmentLayerToCanvas(
  targetCtx: CanvasRenderingContext2D,
  layer: Layer,
  context: WebGLCompositeLayerContext,
): boolean {
  if (!layer.adjustment || !GPU_ADJUSTMENT_TYPES.has(layer.adjustment.type)) return false
  const width = positiveInt(context.width, targetCtx.canvas.width)
  const height = positiveInt(context.height, targetCtx.canvas.height)
  const before = cloneCanvasForWebGL(targetCtx.canvas)
  const adjusted = cloneCanvasForWebGL(targetCtx.canvas)
  const adjustedCtx = adjusted.getContext("2d")
  if (!adjustedCtx || !applyGpuAdjustmentToCanvas(adjustedCtx, layer, width, height)) return false

  const opacity = clamp01(layer.opacity ?? 1)
  const maskSource = layer.mask && layer.maskEnabled !== false ? cropOptionalSource(layer.mask, context.tileRect) : null
  const clipMaskSource = context.clipMask ? cropOptionalSource(context.clipMask, context.tileRect) : null
  const blendMode = layer.blendMode ?? "normal"
  const needsComposite = opacity < 1 || blendMode !== "normal" || !!maskSource || !!clipMaskSource
  if (!needsComposite) {
    targetCtx.clearRect(0, 0, width, height)
    targetCtx.drawImage(adjusted, 0, 0)
    return true
  }

  const composited = document.createElement("canvas")
  composited.width = width
  composited.height = height
  const result = new WebGL2DCompositor(composited).composite([
    {
      layerId: layer.id,
      source: adjusted,
      opacity,
      blendMode,
      maskSource,
      clipMaskSource,
    },
  ], { initialSource: before })
  if (!result.completed) return false
  targetCtx.clearRect(0, 0, width, height)
  targetCtx.drawImage(composited, 0, 0)
  return true
}

export function prepareLayerInputForWebGL(
  layer: Layer,
  context: WebGLCompositeLayerContext,
  sourceOverride?: { source: TexImageSource; fillOpacity?: number },
): WebGLLayerInput | null {
  if (layer.visible === false || layer.kind === "group" || layer.kind === "adjustment") return null
  let source = sourceOverride?.source ?? layer.canvas
  let fillOpacity = sourceOverride?.fillOpacity ?? layer.fillOpacity ?? 1
  if (!sourceOverride) {
    const filtered = applyGpuSmartFiltersToCanvas(layer.canvas, layer.smartFilters)
    if (filtered) source = filtered
    if (hasLayerEffects(layer) && isCanvasLike(source)) {
      const styleLayer = { ...layer, canvas: source }
      const styled = applyGpuLayerStyleToCanvas(styleLayer, layer.fillOpacity ?? 1)
      if (styled) {
        source = styled
        fillOpacity = 1
      }
    }
  }
  const dimensions = textureDimensions(source)
  if (dimensions.width < 1 || dimensions.height < 1) return null
  const knockout = layer.advancedBlending?.knockout
  const knockoutBackdropSource =
    knockout && knockout !== "none" && context.knockoutBackdrop
      ? cropOptionalSource(context.knockoutBackdrop, context.tileRect)
      : null
  return {
    layerId: layer.id,
    source: cropOptionalSource(source, context.tileRect) ?? source,
    opacity: layer.opacity,
    fillOpacity,
    blendMode: layer.blendMode,
    visible: layer.visible,
    maskSource: layer.mask && layer.maskEnabled !== false ? cropOptionalSource(layer.mask, context.tileRect) : null,
    vectorMaskSource: rasterizeVectorMaskForWebGL(layer, context.width, context.height, context.tileRect),
    clipMaskSource: context.clipMask ? cropOptionalSource(context.clipMask, context.tileRect) : null,
    advancedBlending: layer.advancedBlending,
    knockoutBackdropSource,
  }
}

