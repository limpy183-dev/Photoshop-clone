import type { AlphaChannel, BlendMode, ColorManagementSettings } from "./types"
import { cmykToRgb, rgbToCmyk, type RgbColor } from "./color-pipeline"
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

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return { h, s, l }
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

function simulateCmykProof(rgb: RgbColor, dotGain = 0.08) {
  const cmyk = rgbToCmyk(rgb, {
    blackGeneration: dotGain > 0.1 ? "heavy" : "medium",
    totalInkLimit: dotGain > 0.1 ? 300 : 320,
  })
  const proof = cmykToRgb({ ...cmyk, k: clamp01(cmyk.k * (1 + dotGain)) })
  const gray = luma(proof.r, proof.g, proof.b)
  return {
    r: clamp8(proof.r * (1 - dotGain) + gray * dotGain),
    g: clamp8(proof.g * (1 - dotGain) + gray * dotGain),
    b: clamp8(proof.b * (1 - dotGain) + gray * dotGain),
  }
}

export function isApproximatelyOutOfGamut(rgb: RgbColor, settings?: ColorManagementSettings) {
  if (!settings?.gamutWarning) return false
  const proofProfile = settings.proofProfile ?? "None"
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b)
  if (proofProfile.includes("CMYK") || proofProfile.includes("SWOP") || proofProfile.includes("Japan")) {
    return hsl.s > 0.68 && (Math.max(rgb.r, rgb.g, rgb.b) > 220 || Math.min(rgb.r, rgb.g, rgb.b) < 35)
  }
  if (proofProfile === "Dot Gain 20%") return hsl.s > 0.08
  return false
}

export function softProofImageDataApprox(source: ImageData, settings?: ColorManagementSettings): ImageData {
  const out = new Uint8ClampedArray(source.data)
  const proofProfile = settings?.proofProfile ?? "None"
  const proofColors = !!settings?.proofColors && proofProfile !== "None"
  for (let i = 0; i < out.length; i += 4) {
    const original = { r: out[i], g: out[i + 1], b: out[i + 2] }
    let next = original
    if (proofColors) {
      if (proofProfile.includes("CMYK") || proofProfile.includes("SWOP") || proofProfile.includes("Japan")) {
        next = simulateCmykProof(original, proofProfile.includes("SWOP") ? 0.13 : 0.08)
      } else if (proofProfile === "Dot Gain 20%") {
        const gray = clamp8((luma(original.r, original.g, original.b) / 255) ** 1.16 * 255)
        next = { r: gray, g: gray, b: gray }
      }
    }
    if (isApproximatelyOutOfGamut(original, settings)) {
      next = {
        r: clamp8(next.r * 0.35 + 128 * 0.65),
        g: clamp8(next.g * 0.2 + 128 * 0.25),
        b: clamp8(next.b * 0.35 + 255 * 0.65),
      }
    }
    out[i] = next.r
    out[i + 1] = next.g
    out[i + 2] = next.b
  }
  return new ImageData(out, source.width, source.height)
}
