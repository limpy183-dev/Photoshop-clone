import type { AdvancedBlending, BlendIfRange } from "../types"
import type { WebGLCompositeResult, WebGLLayerInput } from "./types"
import { BLEND_MODE_CODE, clamp01, positiveInt } from "./shared"
import { isWebGLBlendModeCompatible } from "./planning"

export function detectWebGL(canvas: HTMLCanvasElement): WebGLRenderingContext | WebGL2RenderingContext | null {
  try {
    const context =
      canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true }) ??
      canvas.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: true })
    return context && typeof (context as WebGLRenderingContext).createShader === "function"
      ? context
      : null
  } catch {
    return null
  }
}

export function compileShader(gl: WebGLRenderingContext | WebGL2RenderingContext, type: number, source: string) {
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
  uniform sampler2D u_backdrop;
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
  uniform int u_knockoutMode;
  uniform int u_hasBackdrop;
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

    if (u_knockoutMode > 0) {
      if (u_hasBackdrop == 1) {
        // Shallow/deep knockout with an explicit backdrop: where the source covers,
        // the layer is composited over the supplied backdrop (group base for
        // shallow, transparent / document background for deep) instead of the
        // running composite.
        vec4 backdrop = texture2D(u_backdrop, v_texcoord);
        base = mix(base, backdrop, sa);
        ba = base.a;
      } else {
        ba *= 1.0 - sa;
        base = vec4(base.rgb, ba);
      }
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

export function textureDimensions(source: TexImageSource): { width: number; height: number } {
  const sized = source as { width?: number; height?: number; videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number }
  return {
    width: positiveInt(sized.width ?? sized.videoWidth ?? sized.naturalWidth, 1),
    height: positiveInt(sized.height ?? sized.videoHeight ?? sized.naturalHeight, 1),
  }
}

export function isCanvasLike(source: TexImageSource): source is HTMLCanvasElement {
  return typeof (source as HTMLCanvasElement).getContext === "function"
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
    gl.uniform1i(locations.backdrop, 5)
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
      const backdropTexture = layer.knockoutBackdropSource ? track(createTextureFromSource(gl, layer.knockoutBackdropSource)) : transparentTexture
      if (!sourceTexture || !maskTexture || !vectorMaskTexture || !clipMaskTexture || !backdropTexture) {
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
      this.bindTexture(5, backdropTexture)

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
      const knockoutCode = advanced?.knockout === "deep" ? 2 : advanced?.knockout === "shallow" ? 1 : 0
      gl.uniform1i(locations.knockoutMode, knockoutCode)
      gl.uniform1i(locations.hasBackdrop, layer.knockoutBackdropSource ? 1 : 0)
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
    this.bindTexture(5, transparentTexture)
    gl.uniform1i(locations.hasMask, 0)
    gl.uniform1i(locations.hasVectorMask, 0)
    gl.uniform1i(locations.hasClipMask, 0)
    gl.uniform1i(locations.blendMode, 0)
    gl.uniform1f(locations.opacity, 1)
    gl.uniform1f(locations.fillOpacity, 1)
    gl.uniform3f(locations.channelMask, 1, 1, 1)
    gl.uniform1i(locations.hasBlendIf, 0)
    gl.uniform1i(locations.knockoutMode, 0)
    gl.uniform1i(locations.hasBackdrop, 0)
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
      knockoutMode: gl.getUniformLocation(program, "u_knockoutMode"),
      backdrop: gl.getUniformLocation(program, "u_backdrop"),
      hasBackdrop: gl.getUniformLocation(program, "u_hasBackdrop"),
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

