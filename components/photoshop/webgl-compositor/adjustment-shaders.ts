import { readBooleanParam, readNumberParam, readStringParam } from "./shared"

function photoFilterColor(value: string): [number, number, number] {
  switch (value) {
    case "blue":
      return [0.65, 0.78, 1]
    case "green":
      return [0.68, 1, 0.72]
    case "magenta":
      return [1, 0.72, 0.95]
    case "cyan":
      return [0.65, 1, 1]
    case "yellow":
      return [1, 0.92, 0.52]
    case "warm":
    default:
      return [1, 0.78, 0.48]
  }
}

function lookupPresetCode(value: string): number {
  switch (value) {
    case "warm":
      return 1
    case "cool":
      return 2
    case "bleach":
      return 3
    case "cross-process":
      return 4
    case "filmic":
    default:
      return 0
  }
}

export interface GpuAdjustmentShader {
  fragmentSource: string
  uniforms: Record<string, number | number[] | Float32Array>
  textureUniforms?: Record<string, TexImageSource | null | undefined>
  curveTexture?: { values: Float32Array; size: number }
  /**
   * Optional RGB lookup table bound to texture unit 2 as `u_gradientLut`. The
   * values array is laid out as [r,g,b, r,g,b, …] in 0..1 space; `size` is the
   * number of LUT entries (width of the resulting 1D texture).
   */
  gradientLut?: { values: Float32Array; size: number }
}

export const ADJUSTMENT_FRAGMENT_PREFIX = `
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
  "grayscale": `
    void main() {
      vec4 c = texture2D(u_source, v_texcoord);
      float gray = luminance(c.rgb);
      gl_FragColor = vec4(vec3(gray), c.a);
    }
  `,
  "color-balance": `
    uniform vec3 u_balance;
    uniform float u_tone;
    uniform float u_preserveLuminosity;
    void main() {
      vec4 c = texture2D(u_source, v_texcoord);
      float l = luminance(c.rgb);
      float rangeWeight;
      if (u_tone < 0.5) rangeWeight = 1.0 - smoothstep(0.0, 0.72, l);
      else if (u_tone > 1.5) rangeWeight = smoothstep(0.28, 1.0, l);
      else rangeWeight = 1.0 - clamp(abs(l - 0.5) * 2.0, 0.0, 1.0);
      vec3 rgb = clamp(c.rgb + u_balance * rangeWeight, 0.0, 1.0);
      if (u_preserveLuminosity > 0.5) {
        rgb = clamp(rgb + vec3(l - luminance(rgb)), 0.0, 1.0);
      }
      gl_FragColor = vec4(rgb, c.a);
    }
  `,
  "photo-filter": `
    uniform vec3 u_filterColor;
    uniform float u_density;
    void main() {
      vec4 c = texture2D(u_source, v_texcoord);
      float l = luminance(c.rgb);
      vec3 filtered = c.rgb * mix(vec3(1.0), u_filterColor * 1.2, clamp(u_density, 0.0, 1.0));
      filtered = clamp(filtered + vec3(l - luminance(filtered)) * 0.55, 0.0, 1.0);
      gl_FragColor = vec4(mix(c.rgb, filtered, clamp(u_density, 0.0, 1.0)), c.a);
    }
  `,
  "color-lookup": `
    uniform float u_strength;
    uniform float u_preset;
    vec3 filmic(vec3 rgb) {
      return clamp((rgb * (2.51 * rgb + 0.03)) / (rgb * (2.43 * rgb + 0.59) + 0.14), 0.0, 1.0);
    }
    void main() {
      vec4 c = texture2D(u_source, v_texcoord);
      vec3 mapped = filmic(c.rgb);
      if (u_preset > 0.5 && u_preset < 1.5) mapped = clamp(c.rgb * vec3(1.08, 0.98, 0.86), 0.0, 1.0);
      else if (u_preset > 1.5 && u_preset < 2.5) mapped = clamp(c.rgb * vec3(0.88, 0.98, 1.12), 0.0, 1.0);
      else if (u_preset > 2.5 && u_preset < 3.5) {
        float gray = luminance(c.rgb);
        mapped = mix(vec3(gray), c.rgb, 0.42) + vec3(0.08);
      } else if (u_preset > 3.5) {
        mapped = vec3(c.r * 0.92 + c.g * 0.08, c.g * 0.88 + c.b * 0.16, c.b * 0.9 + c.r * 0.12);
      }
      float amount = clamp((u_strength + 100.0) / 200.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(mix(c.rgb, mapped, amount), 0.0, 1.0), c.a);
    }
  `,
  "selective-color": `
    uniform vec4 u_cmykAdjust;
    void main() {
      vec4 c = texture2D(u_source, v_texcoord);
      vec3 rgb = c.rgb;
      vec3 cmy = vec3(1.0) - rgb;
      cmy += u_cmykAdjust.rgb;
      cmy += vec3(u_cmykAdjust.a);
      gl_FragColor = vec4(clamp(vec3(1.0) - cmy, 0.0, 1.0), c.a);
    }
  `,
  "shadows-highlights": `
    uniform float u_shadows;
    uniform float u_highlights;
    uniform float u_colorCorrection;
    void main() {
      vec4 c = texture2D(u_source, v_texcoord);
      float l = luminance(c.rgb);
      float shadowMask = 1.0 - smoothstep(0.0, 0.65, l);
      float highlightMask = smoothstep(0.35, 1.0, l);
      vec3 rgb = c.rgb;
      rgb += shadowMask * u_shadows * (1.0 - rgb);
      rgb -= highlightMask * u_highlights * rgb;
      float gray = luminance(rgb);
      rgb = mix(vec3(gray), rgb, clamp(1.0 + u_colorCorrection, 0.0, 2.0));
      gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
    }
  `,
  "hdr-toning": `
    uniform float u_strength;
    void main() {
      vec4 c = texture2D(u_source, v_texcoord);
      vec3 rgb = clamp((c.rgb - vec3(0.5)) * (1.0 + u_strength * 1.4) + vec3(0.5), 0.0, 1.0);
      rgb = mix(rgb, rgb / (rgb + vec3(0.35)), u_strength * 0.35);
      gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
    }
  `,
  "replace-color": `
    uniform float u_sourceHue;
    uniform float u_fuzziness;
    uniform float u_replacementHue;
    uniform float u_replacementSaturation;
    uniform float u_replacementLightness;
    float hueDistance(float a, float b) {
      float d = abs(a - b);
      return min(d, 1.0 - d);
    }
    void main() {
      vec4 c = texture2D(u_source, v_texcoord);
      vec3 hsl = rgb2hsl(c.rgb);
      float mask = 1.0 - smoothstep(0.0, max(u_fuzziness, 0.001), hueDistance(hsl.x, u_sourceHue));
      vec3 repl = hsl;
      repl.x = u_replacementHue;
      repl.y = clamp(repl.y + u_replacementSaturation, 0.0, 1.0);
      repl.z = clamp(repl.z + u_replacementLightness, 0.0, 1.0);
      gl_FragColor = vec4(mix(c.rgb, hsl2rgb(repl), mask), c.a);
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
          u_exposure: readNumberParam(params, "exposure", readNumberParam(params, "ev", 0)),
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
          u_vibrance: readNumberParam(params, "vibrance", readNumberParam(params, "amount", 0)),
          u_saturationParam: readNumberParam(params, "saturation", 0),
        },
      }
    case "posterize":
      return { fragmentSource, uniforms: { u_levels: readNumberParam(params, "levels", 4) } }
    case "threshold":
      return { fragmentSource, uniforms: { u_threshold: readNumberParam(params, "threshold", readNumberParam(params, "level", 128)) / 255 } }
    case "levels":
      return {
        fragmentSource,
        uniforms: {
          u_blackInput: readNumberParam(params, "blackInput", readNumberParam(params, "inputBlack", 0)),
          u_whiteInput: readNumberParam(params, "whiteInput", readNumberParam(params, "inputWhite", 255)),
          u_gamma: readNumberParam(params, "gamma", 1),
          u_blackOutput: readNumberParam(params, "blackOutput", readNumberParam(params, "outputBlack", 0)),
          u_whiteOutput: readNumberParam(params, "whiteOutput", readNumberParam(params, "outputWhite", 255)),
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
      const redToRed = readNumberParam(params, "redToRed", readNumberParam(params, "rR", 100)) / 100
      const greenToRed = readNumberParam(params, "greenToRed", readNumberParam(params, "rG", 0)) / 100
      const blueToRed = readNumberParam(params, "blueToRed", readNumberParam(params, "rB", 0)) / 100
      const redToGreen = readNumberParam(params, "redToGreen", readNumberParam(params, "gR", 0)) / 100
      const greenToGreen = readNumberParam(params, "greenToGreen", readNumberParam(params, "gG", 100)) / 100
      const blueToGreen = readNumberParam(params, "blueToGreen", readNumberParam(params, "gB", 0)) / 100
      const redToBlue = readNumberParam(params, "redToBlue", readNumberParam(params, "bR", 0)) / 100
      const greenToBlue = readNumberParam(params, "greenToBlue", readNumberParam(params, "bG", 0)) / 100
      const blueToBlue = readNumberParam(params, "blueToBlue", readNumberParam(params, "bB", 100)) / 100
      const constR = readNumberParam(params, "constantRed", readNumberParam(params, "constantR", 0)) / 100
      const constG = readNumberParam(params, "constantGreen", readNumberParam(params, "constantG", 0)) / 100
      const constB = readNumberParam(params, "constantBlue", readNumberParam(params, "constantB", 0)) / 100
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
    case "grayscale":
      return { fragmentSource, uniforms: {} }
    case "color-balance": {
      const tone = readStringParam(params, "tone", "midtones")
      return {
        fragmentSource,
        uniforms: {
          u_balance: [
            readNumberParam(params, "cyanRed", 0) / 255,
            readNumberParam(params, "magentaGreen", 0) / 255,
            readNumberParam(params, "yellowBlue", 0) / 255,
          ],
          u_tone: tone === "shadows" ? 0 : tone === "highlights" ? 2 : 1,
          u_preserveLuminosity: readBooleanParam(params, "preserveLuminosity", true) ? 1 : 0,
        },
      }
    }
    case "photo-filter":
      return {
        fragmentSource,
        uniforms: {
          u_filterColor: photoFilterColor(readStringParam(params, "color", "warm")),
          u_density: readNumberParam(params, "density", 25) / 100,
        },
      }
    case "color-lookup":
      return {
        fragmentSource,
        uniforms: {
          u_strength: readNumberParam(params, "strength", 0),
          u_preset: lookupPresetCode(readStringParam(params, "preset", "filmic")),
        },
      }
    case "selective-color":
      return {
        fragmentSource,
        uniforms: {
          u_cmykAdjust: [
            readNumberParam(params, "cyan", 0) / 100,
            readNumberParam(params, "magenta", 0) / 100,
            readNumberParam(params, "yellow", 0) / 100,
            readNumberParam(params, "black", 0) / 100,
          ],
        },
      }
    case "shadows-highlights":
      return {
        fragmentSource,
        uniforms: {
          u_shadows: readNumberParam(params, "shadows", 0) / 100,
          u_highlights: readNumberParam(params, "highlights", 0) / 100,
          u_colorCorrection: readNumberParam(params, "colorCorrection", 0) / 100,
        },
      }
    case "hdr-toning":
      return { fragmentSource, uniforms: { u_strength: readNumberParam(params, "strength", 50) / 100 } }
    case "replace-color":
      return {
        fragmentSource,
        uniforms: {
          u_sourceHue: readNumberParam(params, "sourceHue", 0) / 360,
          u_fuzziness: readNumberParam(params, "fuzziness", 30) / 360,
          u_replacementHue: readNumberParam(params, "replacementHue", 0) / 360,
          u_replacementSaturation: readNumberParam(params, "replacementSaturation", 0) / 100,
          u_replacementLightness: readNumberParam(params, "replacementLightness", 0) / 100,
        },
      }
    default:
      return null
  }
}

