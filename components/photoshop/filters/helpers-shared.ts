import {
  clamp01,
  clamp8,
  luma,
} from "./pixel-helpers"

export function mixBlurredByWeight(src: ImageData, blurred: ImageData, weightForPixel: (x: number, y: number) => number) {
  const out = new Uint8ClampedArray(src.data)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const weight = clamp01(weightForPixel(x, y))
      if (weight <= 0) continue
      out[i] = clamp8(src.data[i] * (1 - weight) + blurred.data[i] * weight)
      out[i + 1] = clamp8(src.data[i + 1] * (1 - weight) + blurred.data[i + 1] * weight)
      out[i + 2] = clamp8(src.data[i + 2] * (1 - weight) + blurred.data[i + 2] * weight)
      out[i + 3] = src.data[i + 3]
    }
  }
  return new ImageData(out, src.width, src.height)
}

export type ApplyChannel = "rgb" | "red" | "green" | "blue" | "luminance" | "alpha" | "gray"

export function selectChannelValue(data: Uint8ClampedArray, i: number, channel: ApplyChannel): [number, number, number] {
  switch (channel) {
    case "red":   return [data[i], data[i], data[i]]
    case "green": return [data[i + 1], data[i + 1], data[i + 1]]
    case "blue":  return [data[i + 2], data[i + 2], data[i + 2]]
    case "alpha": return [data[i + 3], data[i + 3], data[i + 3]]
    case "gray":
    case "luminance": {
      const v = luma(data[i], data[i + 1], data[i + 2])
      return [v, v, v]
    }
    default:
      return [data[i], data[i + 1], data[i + 2]]
  }
}

export function resampleImageData(src: ImageData, targetW: number, targetH: number): ImageData {
  if (src.width === targetW && src.height === targetH) return src
  const out = new ImageData(targetW, targetH)
  const sxScale = src.width / targetW
  const syScale = src.height / targetH
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x * sxScale))
      const sy = Math.min(src.height - 1, Math.floor(y * syScale))
      const si = (sy * src.width + sx) * 4
      const di = (y * targetW + x) * 4
      out.data[di] = src.data[si]
      out.data[di + 1] = src.data[si + 1]
      out.data[di + 2] = src.data[si + 2]
      out.data[di + 3] = src.data[si + 3]
    }
  }
  return out
}

export function pixelBlend(
  dr: number, dg: number, db: number,
  sr: number, sg: number, sb: number,
  mode: string,
): [number, number, number] {
  const b = [dr / 255, dg / 255, db / 255]
  const s = [sr / 255, sg / 255, sb / 255]
  const apply = (fn: (a: number, c: number) => number) =>
    [fn(b[0], s[0]), fn(b[1], s[1]), fn(b[2], s[2])] as [number, number, number]
  let out: [number, number, number]
  switch (mode) {
    case "multiply":     out = apply((a, c) => a * c); break
    case "screen":       out = apply((a, c) => 1 - (1 - a) * (1 - c)); break
    case "overlay":      out = apply((a, c) => a < 0.5 ? 2 * a * c : 1 - 2 * (1 - a) * (1 - c)); break
    case "soft-light":   out = apply((a, c) => c <= 0.5 ? a - (1 - 2 * c) * a * (1 - a) : a + (2 * c - 1) * ((a <= 0.25 ? ((16 * a - 12) * a + 4) * a : Math.sqrt(a)) - a)); break
    case "hard-light":   out = apply((a, c) => c < 0.5 ? 2 * a * c : 1 - 2 * (1 - a) * (1 - c)); break
    case "darken":       out = apply((a, c) => Math.min(a, c)); break
    case "lighten":      out = apply((a, c) => Math.max(a, c)); break
    case "difference":   out = apply((a, c) => Math.abs(a - c)); break
    case "exclusion":    out = apply((a, c) => a + c - 2 * a * c); break
    case "color-burn":   out = apply((a, c) => c === 0 ? 0 : Math.max(0, 1 - (1 - a) / c)); break
    case "linear-burn":  out = apply((a, c) => Math.max(0, a + c - 1)); break
    case "color-dodge":  out = apply((a, c) => c >= 1 ? 1 : Math.min(1, a / (1 - c))); break
    case "linear-dodge": out = apply((a, c) => Math.min(1, a + c)); break
    case "vivid-light":  out = apply((a, c) => c <= 0.5 ? (c === 0 ? 0 : Math.max(0, 1 - (1 - a) / (2 * c))) : (2 * (c - 0.5) >= 1 ? 1 : Math.min(1, a / (1 - 2 * (c - 0.5))))); break
    case "linear-light": out = apply((a, c) => Math.max(0, Math.min(1, a + 2 * c - 1))); break
    case "pin-light":    out = apply((a, c) => c <= 0.5 ? Math.min(a, 2 * c) : Math.max(a, 2 * c - 1)); break
    case "hard-mix":     out = apply((a, c) => a + c >= 1 ? 1 : 0); break
    case "subtract":     out = apply((a, c) => Math.max(0, a - c)); break
    case "divide":       out = apply((a, c) => c === 0 ? 1 : Math.min(1, a / c)); break
    case "add":          out = apply((a, c) => Math.min(1, a + c)); break
    default:             out = [s[0], s[1], s[2]] // normal
  }
  return [clamp8(out[0] * 255), clamp8(out[1] * 255), clamp8(out[2] * 255)]
}

export function blendImageData(src: ImageData, work: ImageData, amount: number): ImageData {
  const mix = clamp01(amount)
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = clamp8(src.data[i] * (1 - mix) + work.data[i] * mix)
    out[i + 1] = clamp8(src.data[i + 1] * (1 - mix) + work.data[i + 1] * mix)
    out[i + 2] = clamp8(src.data[i + 2] * (1 - mix) + work.data[i + 2] * mix)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

export function copySample(src: ImageData, out: Uint8ClampedArray, x: number, y: number, sx: number, sy: number) {
  const ix = Math.max(0, Math.min(src.width - 1, Math.round(sx)))
  const iy = Math.max(0, Math.min(src.height - 1, Math.round(sy)))
  const s = (iy * src.width + ix) * 4
  const d = (y * src.width + x) * 4
  out[d] = src.data[s]
  out[d + 1] = src.data[s + 1]
  out[d + 2] = src.data[s + 2]
  out[d + 3] = src.data[s + 3]
}

export function copySampleWithEdge(src: ImageData, out: Uint8ClampedArray, x: number, y: number, sx: number, sy: number, edgeMode: string) {
  let ix = Math.round(sx)
  let iy = Math.round(sy)
  const d = (y * src.width + x) * 4
  if (edgeMode === "wrap") {
    ix = ((ix % src.width) + src.width) % src.width
    iy = ((iy % src.height) + src.height) % src.height
  } else if (edgeMode === "transparent") {
    if (ix < 0 || iy < 0 || ix >= src.width || iy >= src.height) {
      out[d] = 0
      out[d + 1] = 0
      out[d + 2] = 0
      out[d + 3] = 0
      return
    }
  } else {
    ix = Math.max(0, Math.min(src.width - 1, ix))
    iy = Math.max(0, Math.min(src.height - 1, iy))
  }
  const s = (iy * src.width + ix) * 4
  out[d] = src.data[s]
  out[d + 1] = src.data[s + 1]
  out[d + 2] = src.data[s + 2]
  out[d + 3] = src.data[s + 3]
}

export function parseHexColor(color: string) {
  const clean = /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1) : "111827"
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  }
}

export function hashNoise(x: number, y: number, salt: number) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453
  return n - Math.floor(n)
}

