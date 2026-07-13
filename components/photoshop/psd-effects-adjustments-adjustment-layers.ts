"use client"

/**
 * Adjustment-layer conversion between the app's `AdjustmentProps` model and
 * ag-psd's `AdjustmentLayer` payloads, plus marker-name / descriptor-preset
 * encoding for adjustment types ag-psd doesn't model natively. Extracted
 * verbatim from psd-effects-adjustments.ts.
 */

import type {
  AdjustmentLayer as PsdAdjustmentLayer,
  BlackAndWhiteAdjustment,
  BrightnessAdjustment,
  ChannelMixerAdjustment,
  ChannelMixerChannel,
  ColorBalanceAdjustment,
  ColorLookupAdjustment,
  Color as PsdColor,
  CurvesAdjustment,
  CurvesAdjustmentChannel,
  ExposureAdjustment,
  GradientMapAdjustment,
  HueSaturationAdjustment,
  HueSaturationAdjustmentChannel,
  InvertAdjustment,
  Layer as PsdLayer,
  LevelsAdjustment,
  LevelsAdjustmentChannel,
  PhotoFilterAdjustment,
  PosterizeAdjustment,
  SelectiveColorAdjustment,
  ThresholdAdjustment,
  VibranceAdjustment,
} from "ag-psd"

import type {
  AdjustmentProps,
  AdjustmentType,
  Layer,
} from "./types"
import { clampByte } from "./psd-effects-adjustments-shared"

/* -------------------------------------------------------------------------- */
/* Marker-name encoding for unsupported adjustment types                       */
/* -------------------------------------------------------------------------- */

const MARKER_PREFIX = "__adj:"
const MARKER_SUFFIX = "__"
const MARKER_RE = /^__adj:([a-z-]+):([A-Za-z0-9+/=]+)__$/
const DESCRIPTOR_PRESET_PREFIX = "__psweb_adj:"
const DESCRIPTOR_PRESET_RE = /^__psweb_adj:([a-z-]+):([A-Za-z0-9+/=]+)$/

/**
 * Round-trip encoding for adjustment types ag-psd doesn't model natively.
 * We use base64-of-encodeURIComponent so the resulting string only contains
 * characters legal in PSD layer names. The payload survives Photoshop too:
 * Photoshop renames are still in the round-trip envelope, so the marker
 * doesn't need to be invisible.
 */
function _encodeAdjustmentMarker(type: AdjustmentType, params: Record<string, unknown>) {
  const safe = JSON.stringify(params ?? {})
  const encoded = btoa(encodeURIComponent(safe))
  return `${MARKER_PREFIX}${type}:${encoded}${MARKER_SUFFIX}`
}

function decodeAdjustmentMarker(name: string | undefined): AdjustmentProps | null {
  if (typeof name !== "string") return null
  const match = name.match(MARKER_RE)
  if (!match) return null
  const type = match[1] as AdjustmentType
  if (!ADJUSTMENT_TYPES_SET.has(type)) return null
  try {
    const decoded = decodeURIComponent(atob(match[2]))
    const params = JSON.parse(decoded) as Record<string, number | string | boolean>
    return { type, params }
  } catch {
    return null
  }
}

function encodeAdjustmentDescriptorPreset(adjustment: AdjustmentProps): string {
  const safe = JSON.stringify(adjustment.params ?? {})
  return `${DESCRIPTOR_PRESET_PREFIX}${adjustment.type}:${btoa(encodeURIComponent(safe))}`
}

function decodeAdjustmentDescriptorPreset(adjustment: PsdAdjustmentLayer | undefined): AdjustmentProps | null {
  const presetFileName = (adjustment as PsdAdjustmentLayer & { presetFileName?: string } | undefined)?.presetFileName
  if (typeof presetFileName !== "string") return null
  const match = presetFileName.match(DESCRIPTOR_PRESET_RE)
  if (!match) return null
  const type = match[1] as AdjustmentType
  if (!ADJUSTMENT_TYPES_SET.has(type)) return null
  try {
    const params = JSON.parse(decodeURIComponent(atob(match[2]))) as Record<string, number | string | boolean>
    return { type, params }
  } catch {
    return null
  }
}

const ADJUSTMENT_TYPES_SET = new Set<AdjustmentType>([
  "brightness-contrast",
  "levels",
  "curves",
  "exposure",
  "vibrance",
  "hue-saturation",
  "color-balance",
  "black-white",
  "photo-filter",
  "channel-mixer",
  "color-lookup",
  "invert",
  "posterize",
  "threshold",
  "gradient-map",
  "selective-color",
  "shadows-highlights",
  "hdr-toning",
  "desaturate",
  "match-color",
  "replace-color",
  "equalize",
])

/* -------------------------------------------------------------------------- */
/* Adjustment converters                                                       */
/* -------------------------------------------------------------------------- */

function levelsChannelFromParams(params: Record<string, number | string | boolean>): LevelsAdjustmentChannel {
  return {
    shadowInput: Math.max(0, Math.min(254, Number(params.inputBlack) || 0)),
    highlightInput: Math.max(1, Math.min(255, Number(params.inputWhite ?? 255))),
    midtoneInput: Math.round(((Number(params.gamma) || 1) * 100)),
    shadowOutput: Math.max(0, Math.min(255, Number(params.outputBlack) || 0)),
    highlightOutput: Math.max(0, Math.min(255, Number(params.outputWhite ?? 255))),
  }
}

function curvesChannelFromParams(params: Record<string, number | string | boolean>): CurvesAdjustmentChannel {
  const shadow = Number(params.shadow) || 0
  const midtone = Number(params.midtone ?? 128)
  const highlight = Number(params.highlight ?? 255)
  return [
    { input: 0, output: clampByte(shadow) },
    { input: 128, output: clampByte(midtone, 128) },
    { input: 255, output: clampByte(highlight, 255) },
  ]
}

function hueSatChannelFromParams(params: Record<string, number | string | boolean>): HueSaturationAdjustmentChannel {
  return {
    a: 0,
    b: 0,
    c: 0,
    d: 0,
    hue: Number(params.hue) || 0,
    saturation: Number(params.saturation) || 0,
    lightness: Number(params.lightness) || 0,
  }
}

function channelMixerRow(
  r: unknown,
  g: unknown,
  b: unknown,
  constant = 0,
): ChannelMixerChannel {
  return {
    red: Number(r) || 0,
    green: Number(g) || 0,
    blue: Number(b) || 0,
    constant,
  }
}

function appOnlyAdjustmentPreset(layer: Layer): string {
  return encodeAdjustmentDescriptorPreset(layer.adjustment!)
}

function appOnlyCurvesAdjustment(
  layer: Layer,
  rgb: CurvesAdjustmentChannel,
): CurvesAdjustment {
  return {
    type: "curves",
    rgb,
    presetKind: 1,
    presetFileName: appOnlyAdjustmentPreset(layer),
  }
}

function appOnlyHueSaturationAdjustment(
  layer: Layer,
  params: Record<string, number | string | boolean>,
): HueSaturationAdjustment {
  return {
    type: "hue/saturation",
    master: hueSatChannelFromParams(params),
    presetKind: 1,
    presetFileName: appOnlyAdjustmentPreset(layer),
  }
}

/**
 * Translate an app `Layer` whose `kind === "adjustment"` into the PSD layer
 * fields needed by ag-psd. Returns native descriptors where available;
 * unsupported private Photoshop commands are preserved through XMP.
 */
export function appAdjustmentToPsdLayer(layer: Layer): Partial<PsdLayer> {
  if (layer.kind !== "adjustment" || !layer.adjustment) return {}
  const { type, params } = layer.adjustment

  switch (type) {
    case "brightness-contrast": {
      const adjustment: BrightnessAdjustment = {
        type: "brightness/contrast",
        brightness: Number(params.brightness) || 0,
        contrast: Number(params.contrast) || 0,
        useLegacy: params.useLegacy === true,
      }
      return { adjustment }
    }
    case "levels": {
      const channel = String(params.channel ?? "rgb")
      const adjustment: LevelsAdjustment = { type: "levels" }
      const data = levelsChannelFromParams(params)
      if (channel === "red") adjustment.red = data
      else if (channel === "green") adjustment.green = data
      else if (channel === "blue") adjustment.blue = data
      else adjustment.rgb = data
      return { adjustment }
    }
    case "curves": {
      const channel = String(params.channel ?? "rgb")
      const adjustment: CurvesAdjustment = { type: "curves" }
      const data = curvesChannelFromParams(params)
      if (channel === "red") adjustment.red = data
      else if (channel === "green") adjustment.green = data
      else if (channel === "blue") adjustment.blue = data
      else adjustment.rgb = data
      return { adjustment }
    }
    case "exposure": {
      const adjustment: ExposureAdjustment = {
        type: "exposure",
        exposure: Number(params.ev) || 0,
        offset: 0,
        gamma: 1,
      }
      return { adjustment }
    }
    case "vibrance": {
      const adjustment: VibranceAdjustment = {
        type: "vibrance",
        vibrance: Number(params.amount) || 0,
        saturation: Number(params.saturation) || 0,
      }
      return { adjustment }
    }
    case "hue-saturation": {
      const channel = String(params.range ?? "master")
      const adjustment: HueSaturationAdjustment = { type: "hue/saturation" }
      const data = hueSatChannelFromParams(params)
      const slot = channel as keyof HueSaturationAdjustment
      // typed assignment via known slot keys (ag-psd uses string indexer-style fields)
      const channelMap: Record<string, keyof HueSaturationAdjustment> = {
        master: "master",
        reds: "reds",
        yellows: "yellows",
        greens: "greens",
        cyans: "cyans",
        blues: "blues",
        magentas: "magentas",
      }
      const slotKey = channelMap[slot] ?? "master"
      ;(adjustment as unknown as Record<string, unknown>)[slotKey] = data
      return { adjustment }
    }
    case "color-balance": {
      const tone = String(params.tone ?? "midtones") as "shadows" | "midtones" | "highlights"
      const adjustment: ColorBalanceAdjustment = {
        type: "color balance",
        preserveLuminosity: params.preserveLuminosity !== false,
      }
      adjustment[tone] = {
        cyanRed: Number(params.cyanRed) || 0,
        magentaGreen: Number(params.magentaGreen) || 0,
        yellowBlue: Number(params.yellowBlue) || 0,
      }
      return { adjustment }
    }
    case "black-white": {
      const adjustment: BlackAndWhiteAdjustment = {
        type: "black & white",
        reds: Number(params.reds) || 0,
        yellows: Number(params.yellows) || 0,
        greens: Number(params.greens) || 0,
        cyans: Number(params.cyans) || 0,
        blues: Number(params.blues) || 0,
        magentas: Number(params.magentas) || 0,
        useTint: params.tint === true,
      }
      if (params.tint === true) {
        // approximate tint hue/saturation by emitting a gray-ish color stub;
        // a richer color round-trip would require the HSB->RGB pipeline.
        const hue = Number(params.tintHue) || 38
        const sat = (Number(params.tintSaturation) || 18) / 100
        adjustment.tintColor = hsvToRgb(hue, sat, 1)
      }
      return { adjustment }
    }
    case "photo-filter": {
      const adjustment: PhotoFilterAdjustment = {
        type: "photo filter",
        density: Number(params.density) || 25,
        preserveLuminosity: true,
        color: photoFilterColor(String(params.color ?? "warm")),
      }
      return { adjustment }
    }
    case "channel-mixer": {
      const adjustment: ChannelMixerAdjustment = {
        type: "channel mixer",
        monochrome: false,
        red: channelMixerRow(params.rR, params.rG, params.rB),
        green: channelMixerRow(params.gR, params.gG, params.gB),
        blue: channelMixerRow(params.bR, params.bG, params.bB),
      }
      return { adjustment }
    }
    case "color-lookup": {
      const adjustment: ColorLookupAdjustment = {
        type: "color lookup",
        lookupType: "3dlut",
        name: `strength:${Number(params.strength) || 0}`,
        dither: false,
      }
      return { adjustment }
    }
    case "invert": {
      const adjustment: InvertAdjustment = { type: "invert" }
      return { adjustment }
    }
    case "posterize": {
      const adjustment: PosterizeAdjustment = {
        type: "posterize",
        levels: Math.max(2, Math.min(255, Math.round(Number(params.levels) || 4))),
      }
      return { adjustment }
    }
    case "threshold": {
      const adjustment: ThresholdAdjustment = {
        type: "threshold",
        level: Math.max(0, Math.min(255, Math.round(Number(params.level) || 128))),
      }
      return { adjustment }
    }
    case "gradient-map": {
      const adjustment: GradientMapAdjustment = {
        type: "gradient map",
        name: "Gradient Map",
        gradientType: "solid",
        dither: params.dither !== false,
        reverse: params.reverse === true,
        method: "linear",
        smoothness: 100,
        colorStops: [
          { color: { r: 0, g: 0, b: 0 }, location: 0, midpoint: 50 },
          { color: { r: 255, g: 255, b: 255 }, location: 4096, midpoint: 50 },
        ],
        opacityStops: [
          { opacity: 1, location: 0, midpoint: 50 },
          { opacity: 1, location: 4096, midpoint: 50 },
        ],
      }
      return { adjustment }
    }
    case "selective-color": {
      const colorBucket = (
        c: number | string | boolean | undefined,
        m: number | string | boolean | undefined,
        y: number | string | boolean | undefined,
        k: number | string | boolean | undefined,
      ) => ({
        c: Number(c) || 0,
        m: Number(m) || 0,
        y: Number(y) || 0,
        k: Number(k) || 0,
      })
      const bucket = colorBucket(params.cyans, params.magentas, params.yellows, 0)
      const adjustment: SelectiveColorAdjustment = {
        type: "selective color",
        mode: "relative",
        whites: colorBucket(0, 0, 0, params.whites),
        neutrals: colorBucket(0, 0, 0, params.neutrals),
        blacks: colorBucket(0, 0, 0, params.blacks),
        cyans: bucket,
        magentas: bucket,
        yellows: bucket,
      }
      return { adjustment }
    }
    case "desaturate": {
      const adjustment: HueSaturationAdjustment = {
        type: "hue/saturation",
        master: {
          a: 0,
          b: 0,
          c: 0,
          d: 0,
          hue: 0,
          saturation: -100,
          lightness: 0,
        },
        presetKind: 1,
        presetFileName: appOnlyAdjustmentPreset(layer),
      }
      return { adjustment }
    }
    case "shadows-highlights": {
      const shadowAmount = Math.max(0, Math.min(100, Number(params.shadowAmount) || 0))
      const highlightAmount = Math.max(0, Math.min(100, Number(params.highlightAmount) || 0))
      const midtoneContrast = Math.max(-100, Math.min(100, Number(params.midtoneContrast) || 0))
      const adjustment = appOnlyCurvesAdjustment(layer, [
        { input: 0, output: clampByte(shadowAmount * 1.2) },
        { input: 128, output: clampByte(128 + midtoneContrast * 0.6, 128) },
        { input: 255, output: clampByte(255 - highlightAmount * 0.9, 255) },
      ])
      return { adjustment }
    }
    case "hdr-toning": {
      const strength = Math.max(0, Math.min(4, Number(params.strength) || 0))
      const adjustment: ExposureAdjustment = {
        type: "exposure",
        exposure: Math.max(-20, Math.min(20, strength)),
        offset: 0,
        gamma: 1,
        presetKind: 1,
        presetFileName: appOnlyAdjustmentPreset(layer),
      }
      return { adjustment }
    }
    case "match-color":
      return {
        adjustment: appOnlyHueSaturationAdjustment(layer, {
          hue: 0,
          saturation: Math.round(((Number(params.colorIntensity) || 1) - 1) * 100),
          lightness: Math.round(((Number(params.luminance) || 1) - 1) * 100),
        }),
      }
    case "replace-color":
      return {
        adjustment: appOnlyHueSaturationAdjustment(layer, {
          hue: 0,
          saturation: Math.max(-100, Math.min(100, Number(params.fuzziness) || 0)),
          lightness: 0,
        }),
      }
    case "equalize":
      return {
        adjustment: appOnlyCurvesAdjustment(layer, [
          { input: 0, output: 0 },
          { input: 64, output: 96 },
          { input: 192, output: 224 },
          { input: 255, output: 255 },
        ]),
      }
    default:
      return {}
  }
}

/**
 * Reverse of `appAdjustmentToPsdLayer` — reads ag-psd's parsed `adjustment`
 * payload or detects a marker-name. Returns `null` if the PSD layer is not
 * an adjustment.
 */
export function psdLayerToAppAdjustment(psdLayer: PsdLayer): AdjustmentProps | null {
  const marker = decodeAdjustmentMarker(psdLayer.name)
  if (marker) return marker
  const adjustment = psdLayer.adjustment as PsdAdjustmentLayer | undefined
  if (!adjustment) return null
  const descriptorPreset = decodeAdjustmentDescriptorPreset(adjustment)
  if (descriptorPreset) return descriptorPreset

  switch (adjustment.type) {
    case "brightness/contrast":
      return {
        type: "brightness-contrast",
        params: {
          brightness: adjustment.brightness ?? 0,
          contrast: adjustment.contrast ?? 0,
          useLegacy: !!adjustment.useLegacy,
        },
      }
    case "levels": {
      const pick = adjustment.red ?? adjustment.green ?? adjustment.blue ?? adjustment.rgb
      const channel = adjustment.red ? "red" : adjustment.green ? "green" : adjustment.blue ? "blue" : "rgb"
      if (!pick) return { type: "levels", params: {} }
      return {
        type: "levels",
        params: {
          channel,
          inputBlack: pick.shadowInput ?? 0,
          inputWhite: pick.highlightInput ?? 255,
          gamma: Math.max(0.01, (pick.midtoneInput ?? 100) / 100),
          outputBlack: pick.shadowOutput ?? 0,
          outputWhite: pick.highlightOutput ?? 255,
        },
      }
    }
    case "curves": {
      const pick = adjustment.red ?? adjustment.green ?? adjustment.blue ?? adjustment.rgb
      const channel = adjustment.red ? "red" : adjustment.green ? "green" : adjustment.blue ? "blue" : "rgb"
      const params: Record<string, number | string | boolean> = { channel }
      if (pick && pick.length) {
        const find = (input: number) => pick.find((p) => p.input === input)?.output
        params.shadow = find(0) ?? 0
        params.midtone = find(128) ?? 128
        params.highlight = find(255) ?? 255
      } else {
        params.shadow = 0
        params.midtone = 128
        params.highlight = 255
      }
      return { type: "curves", params }
    }
    case "exposure":
      return { type: "exposure", params: { ev: adjustment.exposure ?? 0 } }
    case "vibrance":
      return {
        type: "vibrance",
        params: {
          amount: adjustment.vibrance ?? 0,
          saturation: adjustment.saturation ?? 0,
        },
      }
    case "hue/saturation": {
      // Pick the first non-master with values, otherwise master.
      const slots: Array<keyof HueSaturationAdjustment> = ["master", "reds", "yellows", "greens", "cyans", "blues", "magentas"]
      let range: keyof HueSaturationAdjustment = "master"
      for (const slot of slots) {
        if (adjustment[slot]) {
          range = slot
          break
        }
      }
      const data = adjustment[range] as HueSaturationAdjustmentChannel | undefined
      return {
        type: "hue-saturation",
        params: {
          range: String(range),
          hue: data?.hue ?? 0,
          saturation: data?.saturation ?? 0,
          lightness: data?.lightness ?? 0,
          colorize: false,
        },
      }
    }
    case "color balance": {
      const tone: "shadows" | "midtones" | "highlights" = adjustment.shadows
        ? "shadows"
        : adjustment.highlights
          ? "highlights"
          : "midtones"
      const data = adjustment[tone]
      return {
        type: "color-balance",
        params: {
          tone,
          cyanRed: data?.cyanRed ?? 0,
          magentaGreen: data?.magentaGreen ?? 0,
          yellowBlue: data?.yellowBlue ?? 0,
          preserveLuminosity: adjustment.preserveLuminosity !== false,
        },
      }
    }
    case "black & white":
      return {
        type: "black-white",
        params: {
          reds: adjustment.reds ?? 0,
          yellows: adjustment.yellows ?? 0,
          greens: adjustment.greens ?? 0,
          cyans: adjustment.cyans ?? 0,
          blues: adjustment.blues ?? 0,
          magentas: adjustment.magentas ?? 0,
          tint: !!adjustment.useTint,
          tintHue: 38,
          tintSaturation: 18,
        },
      }
    case "photo filter":
      return {
        type: "photo-filter",
        params: {
          color: detectPhotoFilterColor(adjustment.color),
          density: adjustment.density ?? 25,
        },
      }
    case "channel mixer":
      return {
        type: "channel-mixer",
        params: {
          rR: adjustment.red?.red ?? 100,
          rG: adjustment.red?.green ?? 0,
          rB: adjustment.red?.blue ?? 0,
          gR: adjustment.green?.red ?? 0,
          gG: adjustment.green?.green ?? 100,
          gB: adjustment.green?.blue ?? 0,
          bR: adjustment.blue?.red ?? 0,
          bG: adjustment.blue?.green ?? 0,
          bB: adjustment.blue?.blue ?? 100,
        },
      }
    case "color lookup": {
      const strengthMatch = (adjustment.name || "").match(/strength:(-?\d+)/)
      return {
        type: "color-lookup",
        params: { strength: strengthMatch ? Number(strengthMatch[1]) : 0 },
      }
    }
    case "invert":
      return { type: "invert", params: {} }
    case "posterize":
      return { type: "posterize", params: { levels: adjustment.levels ?? 4 } }
    case "threshold":
      return { type: "threshold", params: { level: adjustment.level ?? 128 } }
    case "gradient map":
      return {
        type: "gradient-map",
        params: {
          reverse: !!adjustment.reverse,
          dither: adjustment.dither !== false,
        },
      }
    case "selective color":
      return {
        type: "selective-color",
        params: {
          cyans: adjustment.cyans?.c ?? 0,
          magentas: adjustment.magentas?.m ?? 0,
          yellows: adjustment.yellows?.y ?? 0,
          whites: adjustment.whites?.k ?? 0,
          neutrals: adjustment.neutrals?.k ?? 0,
          blacks: adjustment.blacks?.k ?? 0,
        },
      }
    default:
      return null
  }
}

function hsvToRgb(h: number, s: number, v: number): PsdColor {
  const hh = ((h % 360) + 360) % 360
  const c = v * s
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (hh < 60) [r, g, b] = [c, x, 0]
  else if (hh < 120) [r, g, b] = [x, c, 0]
  else if (hh < 180) [r, g, b] = [0, c, x]
  else if (hh < 240) [r, g, b] = [0, x, c]
  else if (hh < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

function photoFilterColor(key: string): PsdColor {
  const map: Record<string, PsdColor> = {
    warm: { r: 234, g: 159, b: 64 },
    blue: { r: 64, g: 145, b: 234 },
    green: { r: 80, g: 200, b: 120 },
    magenta: { r: 220, g: 64, b: 200 },
    cyan: { r: 64, g: 220, b: 220 },
    yellow: { r: 240, g: 220, b: 60 },
  }
  return map[key] ?? map.warm
}

function detectPhotoFilterColor(color: PsdColor | undefined): string {
  if (!color || typeof color !== "object") return "warm"
  const c = color as { r?: number; g?: number; b?: number }
  const r = c.r ?? 0
  const g = c.g ?? 0
  const b = c.b ?? 0
  if (r > g && r > b) return r > 200 && g > 200 ? "yellow" : "warm"
  if (b > r && b > g) return b > 200 && g > 200 ? "cyan" : "blue"
  if (g > r && g > b) return "green"
  if (r > 150 && b > 150) return "magenta"
  return "warm"
}
