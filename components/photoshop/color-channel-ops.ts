import type { AlphaChannel, BlendMode, ColorManagementSettings } from "./types"
import {
  checkRgbOutOfGamut,
  rgbToCmyk,
  rgbToLab,
  softProofImageData,
  type HighBitImage,
  type PipelineBitDepth,
  type RgbColor,
} from "./color-pipeline"
import { hexToRgb } from "./color-utils"

export type PixelChannel = "rgb" | "red" | "green" | "blue" | "alpha" | "gray"
export type ApplyImageTargetChannel = "rgb" | "red" | "green" | "blue" | "alpha"

export interface ChannelMixerParams {
  rR?: number
  rG?: number
  rB?: number
  gR?: number
  gG?: number
  gB?: number
  bR?: number
  bG?: number
  bB?: number
  constantR?: number
  constantG?: number
  constantB?: number
  monochrome?: boolean
  grayR?: number
  grayG?: number
  grayB?: number
  constantGray?: number
  preserveLuminosity?: boolean
}

export interface ApplyImageOptions {
  sourceChannel?: PixelChannel
  targetChannel?: ApplyImageTargetChannel
  blendMode?: BlendMode
  opacity?: number
  invertSource?: boolean
}

export interface CalculationsOptions {
  sourceChannelA?: PixelChannel
  sourceChannelB?: PixelChannel
  blendMode?: BlendMode
  opacity?: number
  invertA?: boolean
  invertB?: boolean
}

export interface AlphaChannelMetadata {
  baseName: string
  kind: "alpha" | "spot"
  spotColor?: string
  spotOpacity?: number
}

export interface SpotPreviewOptions {
  spotColor: string
  spotOpacity?: number
}

export type SeparationProcess = "RGB" | "CMYK" | "Lab" | "Grayscale" | "Multichannel"
export type SeparationPlateKind = "process" | "spot" | "alpha"
export type SeparationPlateData = Uint8ClampedArray | Uint16Array | Float32Array

export interface SeparationPlate {
  id: string
  name: string
  kind: SeparationPlateKind
  color?: string
  opacity: number
  data: SeparationPlateData
  range: [number, number]
}

export interface SpotSeparationChannel {
  id: string
  name: string
  color: string
  opacity?: number
  mask: ImageData
}

export interface BuildColorSeparationOptions {
  mode?: SeparationProcess
  processProfile?: string
  spotChannels?: SpotSeparationChannel[]
  savedAlphaChannels?: SpotSeparationChannel[]
  multichannel?: {
    red?: boolean
    green?: boolean
    blue?: boolean
  }
}

export interface SeparationCoverageStats {
  pixels: number
  totalInkMax: number
  totalInkAverage: number
}

export interface ColorSeparationModel {
  width: number
  height: number
  bitDepth: PipelineBitDepth
  process: SeparationProcess
  processProfile?: string
  plates: SeparationPlate[]
  coverage: SeparationCoverageStats
}

const SPOT_NAME_PATTERN = /^\[spot:(#[0-9a-fA-F]{3,8})(?::([0-9]{1,3}(?:\.[0-9]+)?))?\](.*)$/

function clamp(value: number, min = 0, max = 255) {
  return Math.max(min, Math.min(max, value))
}

function clamp8(value: number) {
  return clamp(Math.round(value))
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function percent(value: number | undefined, fallback: number) {
  return (Number.isFinite(value) ? value! : fallback) / 100
}

function luma(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function readChannel(data: Uint8ClampedArray, index: number, channel: PixelChannel) {
  if (channel === "red") return data[index]
  if (channel === "green") return data[index + 1]
  if (channel === "blue") return data[index + 2]
  if (channel === "alpha") return data[index + 3]
  return luma(data[index], data[index + 1], data[index + 2])
}

function blendScalar(dest: number, src: number, mode: BlendMode) {
  switch (mode) {
    case "multiply":
      return (dest * src) / 255
    case "screen":
      return 255 - ((255 - dest) * (255 - src)) / 255
    case "overlay":
      return dest < 128
        ? (2 * dest * src) / 255
        : 255 - (2 * (255 - dest) * (255 - src)) / 255
    case "soft-light": {
      const s = src / 255
      const d = dest / 255
      return (s < 0.5 ? d - (1 - 2 * s) * d * (1 - d) : d + (2 * s - 1) * (Math.sqrt(d) - d)) * 255
    }
    case "difference":
      return Math.abs(dest - src)
    case "darken":
      return Math.min(dest, src)
    case "lighten":
      return Math.max(dest, src)
    case "linear-dodge":
      return dest + src
    case "subtract":
      return dest - src
    default:
      return src
  }
}

function mixWithOpacity(dest: number, src: number, mode: BlendMode, opacity: number) {
  return clamp8(dest + (blendScalar(dest, src, mode) - dest) * opacity)
}

export function applyChannelMixerToImageData(src: ImageData, params: ChannelMixerParams): ImageData {
  const out = new Uint8ClampedArray(src.data)
  for (let i = 0; i < out.length; i += 4) {
    const r = src.data[i]
    const g = src.data[i + 1]
    const b = src.data[i + 2]
    const beforeLum = luma(r, g, b)
    let nr: number
    let ng: number
    let nb: number
    if (params.monochrome) {
      const gray =
        r * percent(params.grayR, 40) +
        g * percent(params.grayG, 40) +
        b * percent(params.grayB, 20) +
        255 * percent(params.constantGray, 0)
      nr = ng = nb = gray
    } else {
      nr = r * percent(params.rR, 100) + g * percent(params.rG, 0) + b * percent(params.rB, 0) + 255 * percent(params.constantR, 0)
      ng = r * percent(params.gR, 0) + g * percent(params.gG, 100) + b * percent(params.gB, 0) + 255 * percent(params.constantG, 0)
      nb = r * percent(params.bR, 0) + g * percent(params.bG, 0) + b * percent(params.bB, 100) + 255 * percent(params.constantB, 0)
    }
    if (params.preserveLuminosity) {
      const afterLum = Math.max(1, luma(nr, ng, nb))
      const ratio = beforeLum / afterLum
      nr *= ratio
      ng *= ratio
      nb *= ratio
    }
    out[i] = clamp8(nr)
    out[i + 1] = clamp8(ng)
    out[i + 2] = clamp8(nb)
  }
  return new ImageData(out, src.width, src.height)
}

export function applyImageData(target: ImageData, source: ImageData, options: ApplyImageOptions = {}): ImageData {
  const width = Math.min(target.width, source.width)
  const height = Math.min(target.height, source.height)
  const out = new Uint8ClampedArray(target.data)
  const sourceChannel = options.sourceChannel ?? "rgb"
  const targetChannel = options.targetChannel ?? "rgb"
  const opacity = clamp01(options.opacity ?? 1)
  const blendMode = options.blendMode ?? "normal"

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ti = (y * target.width + x) * 4
      const si = (y * source.width + x) * 4
      const singleSource =
        sourceChannel === "rgb"
          ? null
          : options.invertSource
            ? 255 - readChannel(source.data, si, sourceChannel)
            : readChannel(source.data, si, sourceChannel)

      const sourceValue = (channelOffset: number) => {
        if (singleSource !== null) return singleSource
        const value = source.data[si + channelOffset]
        return options.invertSource ? 255 - value : value
      }

      if (targetChannel === "rgb") {
        out[ti] = mixWithOpacity(target.data[ti], sourceValue(0), blendMode, opacity)
        out[ti + 1] = mixWithOpacity(target.data[ti + 1], sourceValue(1), blendMode, opacity)
        out[ti + 2] = mixWithOpacity(target.data[ti + 2], sourceValue(2), blendMode, opacity)
      } else {
        const offset = targetChannel === "red" ? 0 : targetChannel === "green" ? 1 : targetChannel === "blue" ? 2 : 3
        out[ti + offset] = mixWithOpacity(target.data[ti + offset], singleSource ?? sourceValue(offset), blendMode, opacity)
      }
    }
  }
  return new ImageData(out, target.width, target.height)
}

export function calculateChannelImageData(sourceA: ImageData, sourceB: ImageData, options: CalculationsOptions = {}): ImageData {
  const width = Math.min(sourceA.width, sourceB.width)
  const height = Math.min(sourceA.height, sourceB.height)
  const out = new Uint8ClampedArray(width * height * 4)
  const channelA = options.sourceChannelA ?? "gray"
  const channelB = options.sourceChannelB ?? "gray"
  const blendMode = options.blendMode ?? "multiply"
  const opacity = clamp01(options.opacity ?? 1)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ai = (y * sourceA.width + x) * 4
      const bi = (y * sourceB.width + x) * 4
      const oi = (y * width + x) * 4
      const a = options.invertA ? 255 - readChannel(sourceA.data, ai, channelA) : readChannel(sourceA.data, ai, channelA)
      const b = options.invertB ? 255 - readChannel(sourceB.data, bi, channelB) : readChannel(sourceB.data, bi, channelB)
      const value = clamp8(a + (blendScalar(a, b, blendMode) - a) * opacity)
      out[oi] = value
      out[oi + 1] = value
      out[oi + 2] = value
      out[oi + 3] = 255
    }
  }
  return new ImageData(out, width, height)
}

export function parseAlphaChannelMetadata(channel: Pick<AlphaChannel, "name" | "kind" | "spotColor" | "spotOpacity">): AlphaChannelMetadata {
  const encoded = SPOT_NAME_PATTERN.exec(channel.name ?? "")
  const explicitSpot = channel.kind === "spot" || !!channel.spotColor
  if (explicitSpot) {
    return {
      baseName: encoded?.[3]?.trim() || channel.name || "Spot",
      kind: "spot",
      spotColor: (channel.spotColor ?? encoded?.[1] ?? "#ff00ff").toLowerCase(),
      spotOpacity: clamp(Number(channel.spotOpacity ?? encoded?.[2] ?? 100), 0, 100),
    }
  }
  if (encoded) {
    return {
      baseName: encoded[3].trim() || "Spot",
      kind: "spot",
      spotColor: encoded[1].toLowerCase(),
      spotOpacity: clamp(Number(encoded[2] ?? 100), 0, 100),
    }
  }
  return { baseName: channel.name ?? "Alpha", kind: "alpha" }
}

export function simulateSpotChannelPreview(base: ImageData, mask: ImageData, options: SpotPreviewOptions): ImageData {
  const width = Math.min(base.width, mask.width)
  const height = Math.min(base.height, mask.height)
  const out = new Uint8ClampedArray(base.data)
  const ink = hexToRgb(options.spotColor)
  const opacity = clamp01((options.spotOpacity ?? 100) / 100)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const bi = (y * base.width + x) * 4
      const mi = (y * mask.width + x) * 4
      const coverage = clamp01((luma(mask.data[mi], mask.data[mi + 1], mask.data[mi + 2]) / 255) * (mask.data[mi + 3] / 255) * opacity)
      if (coverage <= 0) continue
      out[bi] = clamp8(base.data[bi] * (1 - coverage) + ink.r * coverage)
      out[bi + 1] = clamp8(base.data[bi + 1] * (1 - coverage) + ink.g * coverage)
      out[bi + 2] = clamp8(base.data[bi + 2] * (1 - coverage) + ink.b * coverage)
      out[bi + 3] = base.data[bi + 3]
    }
  }
  return new ImageData(out, base.width, base.height)
}

function isHighBitImage(source: ImageData | HighBitImage): source is HighBitImage {
  return "storage" in source && "bitDepth" in source && "channels" in source
}

function sourceBitDepth(source: ImageData | HighBitImage): PipelineBitDepth {
  return isHighBitImage(source) ? source.bitDepth : 8
}

function sourceMax(source: HighBitImage) {
  return source.storage === "uint16" ? 65535 : source.storage === "uint8" ? 255 : 1
}

function readSourceRgb(source: ImageData | HighBitImage, pixel: number): RgbColor {
  const i = pixel * 4
  if (!isHighBitImage(source)) {
    return { r: source.data[i], g: source.data[i + 1], b: source.data[i + 2] }
  }
  const max = sourceMax(source)
  return {
    r: clamp8((Number(source.data[i]) / max) * 255),
    g: clamp8((Number(source.data[i + 1]) / max) * 255),
    b: clamp8((Number(source.data[i + 2]) / max) * 255),
  }
}

function allocPlate(bitDepth: PipelineBitDepth, length: number, float = false): SeparationPlateData {
  if (float || bitDepth === 32) return new Float32Array(length)
  if (bitDepth === 16) return new Uint16Array(length)
  return new Uint8ClampedArray(length)
}

function writePlateUnit(data: SeparationPlateData, index: number, value: number, bitDepth: PipelineBitDepth) {
  const v = clamp01(value)
  if (data instanceof Float32Array) data[index] = v
  else if (bitDepth === 16 && data instanceof Uint16Array) data[index] = Math.round(v * 65535)
  else data[index] = clamp8(v * 255)
}

function readPlateUnit(plate: SeparationPlate, index: number, bitDepth: PipelineBitDepth) {
  if (plate.data instanceof Float32Array) {
    const [min, max] = plate.range
    const value = plate.data[index]
    if (min === 0 && max === 1) return clamp01(value)
    return clamp01((value - min) / Math.max(0.000001, max - min))
  }
  if (bitDepth === 16 && plate.data instanceof Uint16Array) return plate.data[index] / 65535
  return plate.data[index] / 255
}

function plateFromMask(channel: SpotSeparationChannel, width: number, height: number, bitDepth: PipelineBitDepth, kind: SeparationPlateKind): SeparationPlate {
  const data = allocPlate(bitDepth, width * height)
  const w = Math.min(width, channel.mask.width)
  const h = Math.min(height, channel.mask.height)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const mi = (y * channel.mask.width + x) * 4
      const coverage = (luma(channel.mask.data[mi], channel.mask.data[mi + 1], channel.mask.data[mi + 2]) / 255) *
        (channel.mask.data[mi + 3] / 255)
      writePlateUnit(data, y * width + x, coverage, bitDepth)
    }
  }
  return {
    id: channel.id,
    name: channel.name,
    kind,
    color: channel.color,
    opacity: clamp01((channel.opacity ?? 100) / 100),
    data,
    range: [0, 1],
  }
}

function emptyCoverage(): SeparationCoverageStats {
  return { pixels: 0, totalInkMax: 0, totalInkAverage: 0 }
}

export function buildColorSeparationModel(
  source: ImageData | HighBitImage,
  options: BuildColorSeparationOptions = {},
): ColorSeparationModel {
  const width = source.width
  const height = source.height
  const pixels = width * height
  const bitDepth = sourceBitDepth(source)
  const process = options.mode ?? (isHighBitImage(source) && source.colorMode !== "RGB" ? source.colorMode as SeparationProcess : "RGB")
  const plates: SeparationPlate[] = []
  let totalInkSum = 0
  let totalInkMax = 0

  const addUnitPlate = (id: string, name: string, color: string | undefined = undefined) => {
    const plate: SeparationPlate = {
      id,
      name,
      kind: "process",
      color,
      opacity: 1,
      data: allocPlate(bitDepth, pixels),
      range: [0, 1],
    }
    plates.push(plate)
    return plate
  }

  if (process === "CMYK") {
    const cyan = addUnitPlate("process_c", "Cyan", "#00aeef")
    const magenta = addUnitPlate("process_m", "Magenta", "#ec008c")
    const yellow = addUnitPlate("process_y", "Yellow", "#fff200")
    const black = addUnitPlate("process_k", "Black", "#111111")
    for (let p = 0; p < pixels; p++) {
      const cmyk = rgbToCmyk(readSourceRgb(source, p), { blackGeneration: "medium", totalInkLimit: 320 })
      writePlateUnit(cyan.data, p, cmyk.c, bitDepth)
      writePlateUnit(magenta.data, p, cmyk.m, bitDepth)
      writePlateUnit(yellow.data, p, cmyk.y, bitDepth)
      writePlateUnit(black.data, p, cmyk.k, bitDepth)
      const total = (cmyk.c + cmyk.m + cmyk.y + cmyk.k) * 100
      totalInkSum += total
      totalInkMax = Math.max(totalInkMax, total)
    }
  } else if (process === "Lab") {
    const lightness: SeparationPlate = { id: "lab_l", name: "Lightness", kind: "process", opacity: 1, data: new Float32Array(pixels), range: [0, 100] }
    const a: SeparationPlate = { id: "lab_a", name: "a", kind: "process", opacity: 1, data: new Float32Array(pixels), range: [-128, 127] }
    const b: SeparationPlate = { id: "lab_b", name: "b", kind: "process", opacity: 1, data: new Float32Array(pixels), range: [-128, 127] }
    plates.push(lightness, a, b)
    for (let p = 0; p < pixels; p++) {
      const lab = rgbToLab(readSourceRgb(source, p))
      lightness.data[p] = lab.l
      a.data[p] = lab.a
      b.data[p] = lab.b
    }
  } else if (process === "Grayscale") {
    const gray = addUnitPlate("process_gray", "Gray", "#808080")
    for (let p = 0; p < pixels; p++) {
      const rgb = readSourceRgb(source, p)
      writePlateUnit(gray.data, p, luma(rgb.r, rgb.g, rgb.b) / 255, bitDepth)
    }
  } else if (process === "Multichannel") {
    const channels = options.multichannel ?? { red: true, green: true, blue: true }
    const channelDefs = [
      ["red", "Red", "#ff0000", 0, channels.red !== false],
      ["green", "Green", "#00ff00", 1, channels.green !== false],
      ["blue", "Blue", "#0000ff", 2, channels.blue !== false],
    ] as const
    for (const [id, name, color, offset, enabled] of channelDefs) {
      if (!enabled) continue
      const plate = addUnitPlate(id, name, color)
      for (let p = 0; p < pixels; p++) {
        const rgb = readSourceRgb(source, p)
        const value = offset === 0 ? rgb.r : offset === 1 ? rgb.g : rgb.b
        writePlateUnit(plate.data, p, value / 255, bitDepth)
      }
    }
  } else {
    const red = addUnitPlate("process_r", "Red", "#ff0000")
    const green = addUnitPlate("process_g", "Green", "#00ff00")
    const blue = addUnitPlate("process_b", "Blue", "#0000ff")
    for (let p = 0; p < pixels; p++) {
      const rgb = readSourceRgb(source, p)
      writePlateUnit(red.data, p, rgb.r / 255, bitDepth)
      writePlateUnit(green.data, p, rgb.g / 255, bitDepth)
      writePlateUnit(blue.data, p, rgb.b / 255, bitDepth)
    }
  }

  for (const spot of options.spotChannels ?? []) plates.push(plateFromMask(spot, width, height, bitDepth, "spot"))
  for (const alpha of options.savedAlphaChannels ?? []) plates.push(plateFromMask(alpha, width, height, bitDepth, "alpha"))

  return {
    width,
    height,
    bitDepth,
    process,
    processProfile: options.processProfile,
    plates,
    coverage: process === "CMYK"
      ? { pixels, totalInkMax, totalInkAverage: totalInkSum / Math.max(1, pixels) }
      : emptyCoverage(),
  }
}

function paperColor(value: string | undefined) {
  return hexToRgb(value ?? "#ffffff")
}

export function composeSeparationPreview(model: ColorSeparationModel, options: { paper?: string } = {}): ImageData {
  const out = new Uint8ClampedArray(model.width * model.height * 4)
  const paper = paperColor(options.paper)
  const plate = (name: string) => model.plates.find((item) => item.name === name)
  const cyan = plate("Cyan")
  const magenta = plate("Magenta")
  const yellow = plate("Yellow")
  const black = plate("Black")
  for (let p = 0; p < model.width * model.height; p++) {
    const i = p * 4
    if (model.process === "CMYK" && cyan && magenta && yellow && black) {
      const c = readPlateUnit(cyan, p, model.bitDepth)
      const m = readPlateUnit(magenta, p, model.bitDepth)
      const y = readPlateUnit(yellow, p, model.bitDepth)
      const k = readPlateUnit(black, p, model.bitDepth)
      out[i] = clamp8(paper.r * (1 - c) * (1 - k))
      out[i + 1] = clamp8(paper.g * (1 - m) * (1 - k))
      out[i + 2] = clamp8(paper.b * (1 - y) * (1 - k))
    } else {
      out[i] = paper.r
      out[i + 1] = paper.g
      out[i + 2] = paper.b
    }
    out[i + 3] = 255
  }

  for (const spot of model.plates.filter((item) => item.kind === "spot")) {
    const ink = hexToRgb(spot.color ?? "#ff00ff")
    for (let p = 0; p < model.width * model.height; p++) {
      const i = p * 4
      const coverage = readPlateUnit(spot, p, model.bitDepth) * spot.opacity
      if (coverage <= 0) continue
      out[i] = clamp8(out[i] * (1 - coverage) + ink.r * coverage)
      out[i + 1] = clamp8(out[i + 1] * (1 - coverage) + ink.g * coverage)
      out[i + 2] = clamp8(out[i + 2] * (1 - coverage) + ink.b * coverage)
    }
  }

  return new ImageData(out, model.width, model.height)
}

export function isApproximatelyOutOfGamut(rgb: RgbColor, settings?: ColorManagementSettings) {
  return checkRgbOutOfGamut(rgb, settings).outOfGamut
}

export function softProofImageDataApprox(source: ImageData, settings?: ColorManagementSettings): ImageData {
  return softProofImageData(source, settings)
}
