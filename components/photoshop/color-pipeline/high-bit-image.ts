import {
  clamp,
  clamp8,
  type HighBitImage,
  type HighBitImageOptions,
} from "../color-pipeline-conversions"

import { highBitBool, highBitMax, highBitParam, readHighBitUnit, writeHighBitUnit } from "./internal"

export interface HighBitAdjustment {
  type:
    | "brightness-contrast"
    | "levels"
    | "curves"
    | "exposure"
    | "invert"
    | "channel-mixer"
    | "grayscale"
    | "desaturate"
    | "posterize"
    | "threshold"
  params?: Record<string, number | string | boolean>
}

export interface HighBitToneMapOptions {
  exposure?: number
  gamma?: number
}

export interface HighBitPixelReadout {
  r: number
  g: number
  b: number
  a: number
  normalized: {
    r: number
    g: number
    b: number
    a: number
  }
}

export interface HighBitPreviewComparison {
  source: HighBitPixelReadout
  preview: {
    r: number
    g: number
    b: number
    a: number
  }
  previewEquivalent: {
    r: number
    g: number
    b: number
    a: number
  }
  delta: {
    r: number
    g: number
    b: number
    a: number
  }
}

export function createHighBitImageFromImageData(source: ImageData, options: HighBitImageOptions = {}): HighBitImage {
  const bitDepth = options.bitDepth ?? 8
  const colorMode = options.colorMode ?? "RGB"
  const warnings = [
    "High-bit data is stored in a local typed-array pipeline; browser canvas display remains 8-bit RGBA.",
  ]

  if (bitDepth === 16) {
    const data = new Uint16Array(source.data.length)
    for (let i = 0; i < source.data.length; i++) data[i] = source.data[i] * 257
    return {
      width: source.width,
      height: source.height,
      channels: 4,
      bitDepth,
      colorMode,
      profile: options.profile,
      storage: "uint16",
      data,
      warnings,
    }
  }

  if (bitDepth === 32) {
    const data = new Float32Array(source.data.length)
    for (let i = 0; i < source.data.length; i++) data[i] = source.data[i] / 255
    return {
      width: source.width,
      height: source.height,
      channels: 4,
      bitDepth,
      colorMode,
      profile: options.profile,
      storage: "float32",
      data,
      warnings,
    }
  }

  return {
    width: source.width,
    height: source.height,
    channels: 4,
    bitDepth,
    colorMode,
    profile: options.profile,
    storage: "uint8",
    data: new Uint8ClampedArray(source.data),
    warnings,
  }
}

export function toneMapHighBitImageToImageData(source: HighBitImage, options: HighBitToneMapOptions = {}): ImageData {
  const out = new Uint8ClampedArray(source.width * source.height * 4)
  const exposureFactor = 2 ** (Number.isFinite(options.exposure) ? options.exposure ?? 0 : 0)
  const gamma = Math.max(0.01, Number.isFinite(options.gamma) ? options.gamma ?? 1 : 1)
  const mapRgb = (value: number) => clamp8(Math.pow(clamp(value * exposureFactor), 1 / gamma) * 255)
  if (source.storage === "uint16") {
    const data = source.data as Uint16Array
    for (let i = 0; i < out.length; i += 4) {
      out[i] = mapRgb(data[i] / 65535)
      out[i + 1] = mapRgb(data[i + 1] / 65535)
      out[i + 2] = mapRgb(data[i + 2] / 65535)
      out[i + 3] = clamp8((data[i + 3] / 65535) * 255)
    }
  } else if (source.storage === "float32") {
    const data = source.data as Float32Array
    for (let i = 0; i < out.length; i += 4) {
      out[i] = mapRgb(data[i])
      out[i + 1] = mapRgb(data[i + 1])
      out[i + 2] = mapRgb(data[i + 2])
      out[i + 3] = clamp8(clamp(data[i + 3]) * 255)
    }
  } else {
    const data = source.data as Uint8ClampedArray
    if ((options.exposure ?? 0) === 0 && (options.gamma ?? 1) === 1) {
      out.set(data)
    } else {
      for (let i = 0; i < out.length; i += 4) {
        out[i] = mapRgb(data[i] / 255)
        out[i + 1] = mapRgb(data[i + 1] / 255)
        out[i + 2] = mapRgb(data[i + 2] / 255)
        out[i + 3] = data[i + 3]
      }
    }
  }
  return new ImageData(out, source.width, source.height)
}

function cloneHighBitWithData(source: HighBitImage, data: HighBitImage["data"]): HighBitImage {
  return {
    ...source,
    data,
    warnings: [...source.warnings],
  }
}

function highBitChannelMixer(
  r: number,
  g: number,
  b: number,
  params: Record<string, number | string | boolean>,
) {
  if (highBitBool(params, "monochrome")) {
    const gray =
      r * (highBitParam(params, "grayR", 40) / 100) +
      g * (highBitParam(params, "grayG", 40) / 100) +
      b * (highBitParam(params, "grayB", 20) / 100) +
      highBitParam(params, "constantGray", 0) / 100
    return { r: gray, g: gray, b: gray }
  }
  return {
    r:
      r * (highBitParam(params, "rR", 100) / 100) +
      g * (highBitParam(params, "rG", 0) / 100) +
      b * (highBitParam(params, "rB", 0) / 100) +
      highBitParam(params, "constantR", 0) / 100,
    g:
      r * (highBitParam(params, "gR", 0) / 100) +
      g * (highBitParam(params, "gG", 100) / 100) +
      b * (highBitParam(params, "gB", 0) / 100) +
      highBitParam(params, "constantG", 0) / 100,
    b:
      r * (highBitParam(params, "bR", 0) / 100) +
      g * (highBitParam(params, "bG", 0) / 100) +
      b * (highBitParam(params, "bB", 100) / 100) +
      highBitParam(params, "constantB", 0) / 100,
  }
}

function highBitCurvePoints(params: Record<string, number | string | boolean>) {
  if (typeof params.points === "string") {
    const points = params.points
      .split(";")
      .map((pair) => {
        const [x, y] = pair.split(",").map((n) => Number(n))
        return Number.isFinite(x) && Number.isFinite(y)
          ? [clamp(x / 255), clamp(y / 255)] as [number, number]
          : null
      })
      .filter((point): point is [number, number] => !!point)
      .sort((a, b) => a[0] - b[0])
    if (!points.some((point) => point[0] === 0)) points.unshift([0, 0])
    if (!points.some((point) => point[0] === 1)) points.push([1, 1])
    if (points.length >= 2) return points
  }

  if ("shadows" in params || "midtones" in params || "highlights" in params) {
    const shadows = highBitParam(params, "shadows", 0)
    const midtones = highBitParam(params, "midtones", 0)
    const highlights = highBitParam(params, "highlights", 0)
    return [
      [0, 0],
      [64 / 255, clamp8(64 + shadows) / 255],
      [128 / 255, clamp8(128 + midtones) / 255],
      [192 / 255, clamp8(192 + highlights) / 255],
      [1, 1],
    ] as [number, number][]
  }

  const shadow = clamp(highBitParam(params, "shadow", 0) / 255)
  const midtone = clamp(highBitParam(params, "midtone", 128) / 255)
  const highlight = clamp(highBitParam(params, "highlight", 255) / 255)
  return [[0, shadow], [128 / 255, midtone], [1, highlight]] as [number, number][]
}

function highBitCurveValue(value: number, points: [number, number][]) {
  const pts = points
    .map(([x, y]) => [clamp(x), clamp(y)] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .filter((point, index, list) => index === 0 || point[0] !== list[index - 1][0])
  const n = pts.length
  if (n < 2) return value
  const d = new Array(Math.max(0, n - 1)).fill(0)
  const m = new Array(n).fill(0)
  for (let i = 0; i < n - 1; i++) d[i] = (pts[i + 1][1] - pts[i][1]) / Math.max(0.000001, pts[i + 1][0] - pts[i][0])
  m[0] = d[0] ?? 0
  m[n - 1] = d[n - 2] ?? 0
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
    } else {
      const a = m[i] / d[i]
      const b = m[i + 1] / d[i]
      const s = a * a + b * b
      if (s > 9) {
        const t = 3 / Math.sqrt(s)
        m[i] = t * a * d[i]
        m[i + 1] = t * b * d[i]
      }
    }
  }
  const x = clamp(value)
  let segment = 0
  while (segment < n - 2 && x > pts[segment + 1][0]) segment++
  const x0 = pts[segment][0]
  const y0 = pts[segment][1]
  const x1 = pts[segment + 1][0]
  const y1 = pts[segment + 1][1]
  const span = Math.max(0.000001, x1 - x0)
  const t = clamp((x - x0) / span)
  const t2 = t * t
  const t3 = t2 * t
  return clamp(
    (2 * t3 - 3 * t2 + 1) * y0 +
    (t3 - 2 * t2 + t) * span * m[segment] +
    (-2 * t3 + 3 * t2) * y1 +
    (t3 - t2) * span * m[segment + 1],
  )
}

export function applyHighBitAdjustment(source: HighBitImage, adjustment: HighBitAdjustment): HighBitImage {
  const storage = source.storage
  const Ctor = storage === "uint16" ? Uint16Array : storage === "float32" ? Float32Array : Uint8ClampedArray
  const out = new Ctor(source.data.length) as HighBitImage["data"]
  const params = adjustment.params ?? {}
  const curvePoints = adjustment.type === "curves" ? highBitCurvePoints(params) : null
  const curveChannel = String(params.channel ?? "rgb")
  for (let i = 0; i < source.data.length; i += 4) {
    let r = readHighBitUnit(source.data, storage, i)
    let g = readHighBitUnit(source.data, storage, i + 1)
    let b = readHighBitUnit(source.data, storage, i + 2)

    if (adjustment.type === "brightness-contrast") {
      const brightness = highBitParam(params, "brightness", 0) / 150
      const contrast = highBitParam(params, "contrast", 0) / 100
      const pivot = 0.5 + brightness * 0.12
      const adjust = (v: number) => {
        let next = brightness >= 0 ? v + (1 - v) * brightness : v * (1 + brightness)
        if (contrast !== 0) {
          const slope = contrast >= 0 ? 1 + contrast * 2.2 : 1 + contrast * 0.85
          next = (next - pivot) * slope + pivot
        }
        return next
      }
      r = adjust(r)
      g = adjust(g)
      b = adjust(b)
    } else if (adjustment.type === "levels") {
      const inputBlack = clamp(highBitParam(params, "inputBlack", 0) / 255)
      const inputWhite = clamp(highBitParam(params, "inputWhite", 255) / 255)
      const outputBlack = clamp(highBitParam(params, "outputBlack", 0) / 255)
      const outputWhite = clamp(highBitParam(params, "outputWhite", 255) / 255)
      const gamma = Math.max(0.01, highBitParam(params, "gamma", 1))
      const range = Math.max(0.000001, inputWhite - inputBlack)
      const apply = (v: number) => {
        const normalized = clamp((v - inputBlack) / range)
        return Math.pow(normalized, 1 / gamma) * (outputWhite - outputBlack) + outputBlack
      }
      const channel = String(params.channel ?? "rgb")
      if (channel === "red" || channel === "rgb") r = apply(r)
      if (channel === "green" || channel === "rgb") g = apply(g)
      if (channel === "blue" || channel === "rgb") b = apply(b)
    } else if (adjustment.type === "curves" && curvePoints) {
      if (curveChannel === "red" || curveChannel === "rgb") r = highBitCurveValue(r, curvePoints)
      if (curveChannel === "green" || curveChannel === "rgb") g = highBitCurveValue(g, curvePoints)
      if (curveChannel === "blue" || curveChannel === "rgb") b = highBitCurveValue(b, curvePoints)
    } else if (adjustment.type === "exposure") {
      const factor = 2 ** highBitParam(params, "ev", 0)
      r *= factor
      g *= factor
      b *= factor
    } else if (adjustment.type === "invert") {
      r = 1 - r
      g = 1 - g
      b = 1 - b
    } else if (adjustment.type === "channel-mixer") {
      const mixed = highBitChannelMixer(r, g, b, params)
      r = mixed.r
      g = mixed.g
      b = mixed.b
    } else if (adjustment.type === "grayscale" || adjustment.type === "desaturate") {
      r = g = b = 0.299 * r + 0.587 * g + 0.114 * b
    } else if (adjustment.type === "posterize") {
      const levels = Math.max(2, Math.round(highBitParam(params, "levels", 4)))
      const posterize = (v: number) => Math.round(v * (levels - 1)) / (levels - 1)
      r = posterize(r)
      g = posterize(g)
      b = posterize(b)
    } else if (adjustment.type === "threshold") {
      const threshold = clamp(highBitParam(params, "level", 128) / 255)
      const value = 0.299 * r + 0.587 * g + 0.114 * b >= threshold ? 1 : 0
      r = g = b = value
    }

    writeHighBitUnit(out, storage, i, r)
    writeHighBitUnit(out, storage, i + 1, g)
    writeHighBitUnit(out, storage, i + 2, b)
    writeHighBitUnit(out, storage, i + 3, readHighBitUnit(source.data, storage, i + 3))
  }
  return cloneHighBitWithData(source, out)
}

export function readHighBitPixel(source: HighBitImage, x: number, y: number): HighBitPixelReadout | null {
  const px = Math.floor(x)
  const py = Math.floor(y)
  if (px < 0 || py < 0 || px >= source.width || py >= source.height) return null
  const i = (py * source.width + px) * 4
  const max = highBitMax(source.storage)
  const r = Number(source.data[i])
  const g = Number(source.data[i + 1])
  const b = Number(source.data[i + 2])
  const a = Number(source.data[i + 3])
  return {
    r,
    g,
    b,
    a,
    normalized: {
      r: max ? r / max : 0,
      g: max ? g / max : 0,
      b: max ? b / max : 0,
      a: max ? a / max : 0,
    },
  }
}

export function compareHighBitPixelToPreview(
  source: HighBitImage,
  preview: ImageData,
  x: number,
  y: number,
): HighBitPreviewComparison | null {
  const high = readHighBitPixel(source, x, y)
  const px = Math.floor(x)
  const py = Math.floor(y)
  if (!high || px < 0 || py < 0 || px >= preview.width || py >= preview.height) return null
  const i = (py * preview.width + px) * 4
  const max = highBitMax(source.storage)
  const previewPixel = {
    r: preview.data[i],
    g: preview.data[i + 1],
    b: preview.data[i + 2],
    a: preview.data[i + 3],
  }
  const previewEquivalent = {
    r: source.storage === "float32" ? previewPixel.r / 255 : Math.round((previewPixel.r / 255) * max),
    g: source.storage === "float32" ? previewPixel.g / 255 : Math.round((previewPixel.g / 255) * max),
    b: source.storage === "float32" ? previewPixel.b / 255 : Math.round((previewPixel.b / 255) * max),
    a: source.storage === "float32" ? previewPixel.a / 255 : Math.round((previewPixel.a / 255) * max),
  }
  return {
    source: high,
    preview: previewPixel,
    previewEquivalent,
    delta: {
      r: high.r - previewEquivalent.r,
      g: high.g - previewEquivalent.g,
      b: high.b - previewEquivalent.b,
      a: high.a - previewEquivalent.a,
    },
  }
}
