import type { HighBitImage } from "../color-pipeline"
import type { HalfFloatGpuPipelineInput, HalfFloatGpuPipelinePlan, OcioViewPipeline, OcioViewPipelineOptions } from "./types"
import { compileShader } from "./webgl-runtime"
import { positiveInt } from "./shared"

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
  if (!gl || typeof gl.getExtension !== "function" || typeof gl.createShader !== "function") return null
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

