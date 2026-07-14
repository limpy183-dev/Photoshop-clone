import { clamp8, type HighBitImage, type PipelineBitDepth } from "../color-pipeline-conversions"

export interface HistogramChannels {
  red: Uint32Array
  green: Uint32Array
  blue: Uint32Array
  luminosity: Uint32Array
}

export interface HistogramStats {
  mean: number
  std: number
  median: number
  pixels: number
  minValue: number
  maxValue: number
}

export interface HistogramResult {
  bins: number
  bitDepth: PipelineBitDepth
  source: "canvas" | "uint8" | "uint16" | "float32"
  channels: HistogramChannels
  stats: HistogramStats
}

export interface HighBitHistogramOptions {
  floatBins?: number
  floatMin?: number
  floatMax?: number
}

function emptyHistogramChannels(bins: number): HistogramChannels {
  return {
    red: new Uint32Array(bins),
    green: new Uint32Array(bins),
    blue: new Uint32Array(bins),
    luminosity: new Uint32Array(bins),
  }
}

function summarizeHistogram(hist: Uint32Array, bins: number, pixels: number, valueAtBin: (bin: number) => number): HistogramStats {
  if (!pixels) return { mean: 0, std: 0, median: 0, pixels: 0, minValue: 0, maxValue: 0 }
  let sum = 0
  let sumSq = 0
  let running = 0
  let median: number | null = null
  let minValue = 0
  let maxValue = 0
  let saw = false
  for (let bin = 0; bin < bins; bin++) {
    const count = hist[bin]
    if (!count) continue
    const value = valueAtBin(bin)
    if (!saw) {
      minValue = value
      saw = true
    }
    maxValue = value
    sum += value * count
    sumSq += value * value * count
    running += count
    if (median === null && running >= pixels / 2) median = value
  }
  const mean = sum / pixels
  return {
    mean,
    std: Math.sqrt(Math.max(0, sumSq / pixels - mean * mean)),
    median: median ?? 0,
    pixels,
    minValue,
    maxValue,
  }
}

export function computeCanvasHistogram(source: ImageData): HistogramResult {
  const bins = 256
  const channels = emptyHistogramChannels(bins)
  let pixels = 0
  for (let i = 0; i < source.data.length; i += 4) {
    if (source.data[i + 3] === 0) continue
    const r = source.data[i]
    const g = source.data[i + 1]
    const b = source.data[i + 2]
    const lum = clamp8(0.299 * r + 0.587 * g + 0.114 * b)
    channels.red[r]++
    channels.green[g]++
    channels.blue[b]++
    channels.luminosity[lum]++
    pixels++
  }
  return {
    bins,
    bitDepth: 8,
    source: "canvas",
    channels,
    stats: summarizeHistogram(channels.luminosity, bins, pixels, (bin) => bin),
  }
}

export function computeHighBitHistogram(source: HighBitImage, options: HighBitHistogramOptions = {}): HistogramResult {
  const bins = source.storage === "uint16"
    ? 65536
    : source.storage === "float32"
      ? Math.max(16, Math.min(65536, Math.round(options.floatBins ?? 4096)))
      : 256
  const channels = emptyHistogramChannels(bins)
  let pixels = 0
  const data = source.data
  const floatMin = source.storage === "float32" ? options.floatMin ?? 0 : 0
  let floatMax = source.storage === "float32" ? options.floatMax : undefined
  if (source.storage === "float32" && !Number.isFinite(floatMax)) {
    floatMax = 1
    for (let i = 0; i < data.length; i += 4) {
      floatMax = Math.max(floatMax!, Number(data[i]), Number(data[i + 1]), Number(data[i + 2]))
    }
  }
  const safeFloatMax = Math.max(floatMin + 0.000001, floatMax ?? 1)
  const unitToBin = (value: number) => {
    if (source.storage === "uint16") return Math.max(0, Math.min(65535, Math.round(value)))
    if (source.storage === "uint8") return Math.max(0, Math.min(255, Math.round(value)))
    return Math.max(0, Math.min(bins - 1, Math.round(((value - floatMin) / (safeFloatMax - floatMin)) * (bins - 1))))
  }
  const binToValue = (bin: number) => {
    if (source.storage === "float32") return floatMin + (bin / Math.max(1, bins - 1)) * (safeFloatMax - floatMin)
    return bin
  }
  for (let i = 0; i < data.length; i += 4) {
    const alpha = Number(data[i + 3])
    if (alpha <= 0) continue
    const r = Number(data[i])
    const g = Number(data[i + 1])
    const b = Number(data[i + 2])
    const lumValue = 0.299 * r + 0.587 * g + 0.114 * b
    channels.red[unitToBin(r)]++
    channels.green[unitToBin(g)]++
    channels.blue[unitToBin(b)]++
    channels.luminosity[unitToBin(source.storage === "float32" ? lumValue : Math.round(lumValue))]++
    pixels++
  }
  const stats = summarizeHistogram(channels.luminosity, bins, pixels, binToValue)
  if (source.storage === "float32") {
    stats.minValue = floatMin
    stats.maxValue = safeFloatMax
  }
  return {
    bins,
    bitDepth: source.bitDepth,
    source: source.storage,
    channels,
    stats,
  }
}
