import {
  convolve,
  findEdges,
  gaussianBlur,
} from "./basic-algorithms"
import {
  type FilterDef,
} from "./contracts"
import {
  clamp01,
  clamp8,
  cloneImageData as clone,
  luma,
} from "./pixel-helpers"
import {
  fbmNoise,
} from "./render-algorithms"
import {
  surfaceBlur,
} from "./blur-algorithms"
import {
  blendImageData,
  hashNoise,
  parseHexColor,
} from "./helpers-shared"
import {
  addProceduralGrain,
} from "./noise-video-algorithms"

export function oilPaint(src: ImageData, radius: number, levels: number, shine: number): ImageData {
  const w = src.width, h = src.height, out = new Uint8ClampedArray(src.data.length)
  const r = Math.max(1, Math.min(8, Math.round(radius)))
  const buckets = Math.max(4, Math.min(32, Math.round(levels)))
  const gloss = Math.max(0, Math.min(100, shine)) / 100
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const count = new Array<number>(buckets).fill(0)
      const rs = new Array<number>(buckets).fill(0)
      const gs = new Array<number>(buckets).fill(0)
      const bs = new Array<number>(buckets).fill(0)
      const as = new Array<number>(buckets).fill(0)
      for (let oy = -r; oy <= r; oy++) {
        const sy = Math.max(0, Math.min(h - 1, y + oy))
        for (let ox = -r; ox <= r; ox++) {
          if (ox * ox + oy * oy > r * r) continue
          const sx = Math.max(0, Math.min(w - 1, x + ox))
          const p = (sy * w + sx) * 4
          const b = Math.min(buckets - 1, Math.floor((luma(src.data[p], src.data[p + 1], src.data[p + 2]) / 256) * buckets))
          count[b]++
          rs[b] += src.data[p]; gs[b] += src.data[p + 1]; bs[b] += src.data[p + 2]; as[b] += src.data[p + 3]
        }
      }
      let best = 0
      for (let b = 1; b < buckets; b++) if (count[b] > count[best]) best = b
      const n = Math.max(1, count[best])
      const i = (y * w + x) * 4
      const below = (Math.min(h - 1, y + 1) * w + x) * 4
      const above = (Math.max(0, y - 1) * w + x) * 4
      const edge = Math.abs(luma(src.data[below], src.data[below + 1], src.data[below + 2]) - luma(src.data[above], src.data[above + 1], src.data[above + 2]))
      out[i] = clamp8(rs[best] / n + edge * gloss)
      out[i + 1] = clamp8(gs[best] / n + edge * gloss)
      out[i + 2] = clamp8(bs[best] / n + edge * gloss)
      out[i + 3] = as[best] / n
    }
  }
  return new ImageData(out, w, h)
}

export function glowingEdges(src: ImageData, width: number, brightness: number, smooth: number): ImageData {
  const edge = gaussianBlur(findEdges(src), smooth)
  const out = new Uint8ClampedArray(src.data.length)
  const gain = brightness / 80
  for (let i = 0; i < out.length; i += 4) {
    const e = Math.pow(edge.data[i] / 255, Math.max(0.4, width / 5))
    out[i] = clamp8(20 + e * 50)
    out[i + 1] = clamp8(80 + e * 220 * gain)
    out[i + 2] = clamp8(120 + e * 255 * gain)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

export function wind(src: ImageData, strength: number, direction: string): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const right = direction !== "left"
  const steps = Math.max(1, Math.round(strength))
  for (let y = 0; y < src.height; y++) {
    let carry = [0, 0, 0, 0]
    const start = right ? 0 : src.width - 1
    const end = right ? src.width : -1
    const step = right ? 1 : -1
    for (let x = start; x !== end; x += step) {
      const i = (y * src.width + x) * 4
      const bright = luma(src.data[i], src.data[i + 1], src.data[i + 2]) / 255
      const mix = Math.min(0.92, bright * steps * 0.06)
      out[i] = clamp8(src.data[i] * (1 - mix) + carry[0] * mix)
      out[i + 1] = clamp8(src.data[i + 1] * (1 - mix) + carry[1] * mix)
      out[i + 2] = clamp8(src.data[i + 2] * (1 - mix) + carry[2] * mix)
      out[i + 3] = src.data[i + 3]
      carry = [out[i], out[i + 1], out[i + 2], out[i + 3]]
    }
  }
  return new ImageData(out, src.width, src.height)
}

export function extrude(src: ImageData, depth: number, mode: string): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const dx = Math.round(depth * 0.6)
  const dy = Math.round(depth * 0.45)
  for (let y = src.height - 1; y >= 0; y--) {
    for (let x = src.width - 1; x >= 0; x--) {
      const si = (y * src.width + x) * 4
      if (src.data[si + 3] < 8) continue
      for (let d = 1; d <= depth; d++) {
        const tx = x + Math.round((dx * d) / depth)
        const ty = y + Math.round((dy * d) / depth)
        if (tx < 0 || ty < 0 || tx >= src.width || ty >= src.height) continue
        const ti = (ty * src.width + tx) * 4
        const shade = mode === "pyramid" ? 1 - d / (depth * 1.4) : 0.72
        out[ti] = clamp8(src.data[si] * shade)
        out[ti + 1] = clamp8(src.data[si + 1] * shade)
        out[ti + 2] = clamp8(src.data[si + 2] * shade)
        out[ti + 3] = Math.max(out[ti + 3], src.data[si + 3])
      }
    }
  }
  return new ImageData(out, src.width, src.height)
}

export function renderFlame(src: ImageData, heightPct: number, turbulence: number): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const base = src.height - 1
  const maxH = Math.max(8, src.height * (heightPct / 100))
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const rise = (base - y) / maxH
      const n = fbmNoise(x / 80, y / 80, 41, 5)
      const flame = Math.max(0, Math.min(1, rise + (n - 0.5) * (turbulence / 50)))
      if (flame <= 0) continue
      out[i] = clamp8(out[i] * (1 - flame) + 255 * flame)
      out[i + 1] = clamp8(out[i + 1] * (1 - flame) + (80 + flame * 150) * flame)
      out[i + 2] = clamp8(out[i + 2] * (1 - flame) + 20 * flame)
      out[i + 3] = Math.max(out[i + 3], flame * 220)
    }
  }
  return new ImageData(out, src.width, src.height)
}

export function pictureFrame(src: ImageData, size: number, color: string): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const c = parseHexColor(color)
  const inset = Math.max(1, Math.round(size))
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const border = Math.min(x, y, src.width - 1 - x, src.height - 1 - y)
      if (border > inset) continue
      const i = (y * src.width + x) * 4
      const shade = border < inset * 0.45 ? 0.7 : 1.18
      out[i] = clamp8(c.r * shade)
      out[i + 1] = clamp8(c.g * shade)
      out[i + 2] = clamp8(c.b * shade)
      out[i + 3] = 255
    }
  }
  return new ImageData(out, src.width, src.height)
}

export function renderTree(src: ImageData, branches: number, leaves: boolean): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const drawPixel = (x: number, y: number, r: number, g: number, b: number, a = 255) => {
    if (x < 0 || y < 0 || x >= src.width || y >= src.height) return
    const i = (Math.floor(y) * src.width + Math.floor(x)) * 4
    out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = Math.max(out[i + 3], a)
  }
  const branch = (x: number, y: number, len: number, angle: number, depth: number) => {
    const x2 = x + Math.cos(angle) * len
    const y2 = y + Math.sin(angle) * len
    const steps = Math.max(1, Math.round(len))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      drawPixel(x + (x2 - x) * t, y + (y2 - y) * t, 92, 58, 33)
    }
    if (depth <= 0) {
      if (leaves) {
        for (let i = 0; i < 18; i++) drawPixel(x2 + (hashNoise(i, x2, 2) - 0.5) * 30, y2 + (hashNoise(i, y2, 3) - 0.5) * 18, 42, 132 + hashNoise(i, x2, 4) * 90, 58)
      }
      return
    }
    for (let i = 0; i < branches; i++) {
      const spread = (i - (branches - 1) / 2) * 0.34
      branch(x2, y2, len * (0.62 + hashNoise(depth, i, 5) * 0.12), angle - 0.45 + spread, depth - 1)
    }
  }
  branch(src.width / 2, src.height - 8, src.height * 0.22, -Math.PI / 2, 6)
  return new ImageData(out, src.width, src.height)
}

export function galleryStylize(src: ImageData, style: string, intensity: number): ImageData {
  let work = clone(src)
  const amount = intensity / 100
  if (style.includes("edge") || style.includes("outline") || style.includes("pen") || style.includes("photocopy")) {
    work = findEdges(src)
  } else if (style.includes("blur") || style.includes("pastel") || style.includes("water") || style.includes("daub") || style.includes("sumi")) {
    work = gaussianBlur(src, 1 + amount * 5)
  } else if (style.includes("grain") || style.includes("reticulation") || style.includes("sponge") || style.includes("spatter")) {
    work = addProceduralGrain(src, amount * 70, style)
  } else if (style.includes("cutout") || style.includes("stamp") || style.includes("poster") || style.includes("palette")) {
    work = posterizeImage(src, Math.max(2, Math.round(8 - amount * 5)))
  } else if (style.includes("chrome") || style.includes("plastic") || style.includes("bas relief") || style.includes("plaster")) {
    work = embossLike(src, amount)
  } else {
    work = convolve(src, [0, -1, 0, -1, 5, -1, 0, -1, 0], 1)
  }
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    const paper = style.includes("paper") || style.includes("texture") || style.includes("craquelure") || style.includes("tiles") || style.includes("glass")
      ? (hashNoise(i, intensity, 31) - 0.5) * 42 * amount
      : 0
    out[i] = clamp8(src.data[i] * (1 - amount) + work.data[i] * amount + paper)
    out[i + 1] = clamp8(src.data[i + 1] * (1 - amount) + work.data[i + 1] * amount + paper)
    out[i + 2] = clamp8(src.data[i + 2] * (1 - amount) + work.data[i + 2] * amount + paper)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

export function posterizeImage(src: ImageData, levels: number): ImageData {
  const out = new Uint8ClampedArray(src.data)
  const step = 255 / Math.max(1, levels - 1)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = Math.round(out[i] / step) * step
    out[i + 1] = Math.round(out[i + 1] / step) * step
    out[i + 2] = Math.round(out[i + 2] / step) * step
  }
  return new ImageData(out, src.width, src.height)
}

export function embossLike(src: ImageData, amount: number): ImageData {
  const edge = convolve(src, [-2, -1, 0, -1, 1, 1, 0, 1, 2], 1)
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    const v = 128 + (luma(edge.data[i], edge.data[i + 1], edge.data[i + 2]) - 128) * (1 + amount * 2)
    out[i] = clamp8(src.data[i] * (1 - amount) + v * amount)
    out[i + 1] = clamp8(src.data[i + 1] * (1 - amount) + v * amount)
    out[i + 2] = clamp8(src.data[i + 2] * (1 - amount) + v * amount)
    out[i + 3] = src.data[i + 3]
  }
  return new ImageData(out, src.width, src.height)
}

export function coloredPencilFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const edges = findEdges(src)
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const lum = luma(src.data[i], src.data[i + 1], src.data[i + 2])
      const hatch = ((x + y * 2) % 5 === 0 ? -28 : (hashNoise(x, y, 17) - 0.5) * 18) * amount
      const edgeDark = (255 - edges.data[i]) * 0.45 * amount
      const paper = 238 + hatch - edgeDark
      out[i] = clamp8(paper * 0.56 + src.data[i] * 0.44 * (lum / 255 + 0.45))
      out[i + 1] = clamp8(paper * 0.56 + src.data[i + 1] * 0.44 * (lum / 255 + 0.45))
      out[i + 2] = clamp8(paper * 0.56 + src.data[i + 2] * 0.44 * (lum / 255 + 0.45))
      out[i + 3] = src.data[i + 3]
    }
  }
  return blendImageData(src, new ImageData(out, src.width, src.height), amount)
}

export function dryBrushFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const smoothed = surfaceBlur(src, 1 + amount * 3, 42 + amount * 72)
  const blocked = posterizeImage(smoothed, Math.max(4, Math.round(9 - amount * 4)))
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const left = (y * src.width + Math.max(0, x - 1)) * 4
      const streak = (blocked.data[left] - blocked.data[i]) * 0.18 * amount
      out[i] = clamp8(blocked.data[i] + streak)
      out[i + 1] = clamp8(blocked.data[i + 1] + streak)
      out[i + 2] = clamp8(blocked.data[i + 2] + streak)
      out[i + 3] = src.data[i + 3]
    }
  }
  return blendImageData(src, new ImageData(out, src.width, src.height), amount)
}

export function watercolorFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const wash = surfaceBlur(src, 2 + amount * 4, 95)
  const edges = findEdges(src)
  const out = new Uint8ClampedArray(src.data.length)
  for (let i = 0; i < out.length; i += 4) {
    const pigment = 0.82 + (hashNoise(i, intensity, 43) - 0.5) * 0.12 * amount
    const edgeDark = (255 - edges.data[i]) * 0.22 * amount
    out[i] = clamp8(wash.data[i] * pigment - edgeDark)
    out[i + 1] = clamp8(wash.data[i + 1] * pigment - edgeDark)
    out[i + 2] = clamp8(wash.data[i + 2] * (pigment + 0.03) - edgeDark)
    out[i + 3] = src.data[i + 3]
  }
  return blendImageData(src, new ImageData(out, src.width, src.height), amount)
}

export function crosshatchFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const lum = luma(src.data[i], src.data[i + 1], src.data[i + 2])
      let ink = 255 - lum
      if ((x + y) % 4 === 0) ink += 58 * amount
      if ((x - y + 16) % 5 === 0 && lum < 180) ink += 78 * amount
      if ((x + y * 3) % 7 === 0 && lum < 110) ink += 92 * amount
      const v = clamp8(255 - ink)
      out[i] = v
      out[i + 1] = v
      out[i + 2] = v
      out[i + 3] = src.data[i + 3]
    }
  }
  return blendImageData(src, new ImageData(out, src.width, src.height), amount)
}

export function graphicPenFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const lum = luma(src.data[i], src.data[i + 1], src.data[i + 2])
      const line = ((x * 2 + y) % 6) / 6
      const threshold = 218 - amount * 96 + line * 86
      const v = lum > threshold ? 245 : 18
      out[i] = v
      out[i + 1] = v
      out[i + 2] = v
      out[i + 3] = src.data[i + 3]
    }
  }
  return blendImageData(src, new ImageData(out, src.width, src.height), amount)
}

export function craquelureFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      const n1 = fbmNoise(x / 4, y / 4, 71, 3)
      const n2 = fbmNoise((x + 3) / 3, (y - 5) / 3, 109, 2)
      const crack = Math.abs(n1 - n2) < 0.085 + amount * 0.035 ? 1 : 0
      const relief = (n1 - 0.5) * 46 * amount
      const dark = crack * (95 + 75 * amount)
      out[i] = clamp8(src.data[i] + relief - dark)
      out[i + 1] = clamp8(src.data[i + 1] + relief - dark)
      out[i + 2] = clamp8(src.data[i + 2] + relief - dark)
      out[i + 3] = src.data[i + 3]
    }
  }
  return new ImageData(out, src.width, src.height)
}

export function mosaicTilesFilter(src: ImageData, intensity: number): ImageData {
  const amount = clamp01(intensity / 100)
  const tile = Math.max(2, Math.round(5 - amount * 2))
  const grout = Math.max(28, Math.round(70 * amount))
  const out = new Uint8ClampedArray(src.data.length)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const tx = Math.floor(x / tile) * tile
      const ty = Math.floor(y / tile) * tile
      let rs = 0, gs = 0, bs = 0, n = 0
      for (let yy = ty; yy < Math.min(src.height, ty + tile); yy++) {
        for (let xx = tx; xx < Math.min(src.width, tx + tile); xx++) {
          const p = (yy * src.width + xx) * 4
          rs += src.data[p]; gs += src.data[p + 1]; bs += src.data[p + 2]; n++
        }
      }
      const i = (y * src.width + x) * 4
      const seam = x % tile === 0 || y % tile === 0
      out[i] = seam ? grout : clamp8(rs / n)
      out[i + 1] = seam ? grout : clamp8(gs / n)
      out[i + 2] = seam ? grout : clamp8(bs / n)
      out[i + 3] = src.data[i + 3]
    }
  }
  return blendImageData(src, new ImageData(out, src.width, src.height), amount)
}

export function legacyGalleryDefs(items: { id: string; name: string; category: string; intensity?: number }[]) {
  return Object.fromEntries(items.map((item) => [
    item.id,
    {
      id: item.id,
      name: `${item.name} (approx.)`,
      category: item.category,
      params: [
        { type: "slider" as const, key: "intensity", label: "Intensity", min: 0, max: 100, step: 1, default: item.intensity ?? 68, suffix: "%" },
      ],
      apply: (src: ImageData, p: Record<string, number | string | boolean>) => galleryStylize(src, item.id.replace(/-/g, " "), Number(p.intensity)),
    } satisfies FilterDef,
  ]))
}

export function promotedGalleryDef(
  id: string,
  name: string,
  category: string,
  apply: (src: ImageData, intensity: number) => ImageData,
  intensity = 68,
): FilterDef {
  return {
    id,
    name,
    category,
    params: [
      { type: "slider", key: "intensity", label: "Intensity", min: 0, max: 100, step: 1, default: intensity, suffix: "%" },
    ],
    apply: (src, p) => apply(src, Number(p.intensity)),
  }
}

export const PROMOTED_GALLERY_FILTERS: Record<string, FilterDef> = {
  "colored-pencil": promotedGalleryDef("colored-pencil", "Colored Pencil", "Artistic", coloredPencilFilter),
  "dry-brush": promotedGalleryDef("dry-brush", "Dry Brush", "Artistic", dryBrushFilter),
  watercolor: promotedGalleryDef("watercolor", "Watercolor", "Artistic", watercolorFilter),
  crosshatch: promotedGalleryDef("crosshatch", "Crosshatch", "Brush Strokes", crosshatchFilter),
  "graphic-pen": promotedGalleryDef("graphic-pen", "Graphic Pen", "Sketch", graphicPenFilter),
  craquelure: promotedGalleryDef("craquelure", "Craquelure", "Texture", craquelureFilter),
  "mosaic-tiles": promotedGalleryDef("mosaic-tiles", "Mosaic Tiles", "Texture", mosaicTilesFilter),
}

/* ----------- new stylize / pixelate / distort filters ----------- */

