import {
  cmykToRgb as pipelineCmykToRgb,
  labToRgb as pipelineLabToRgb,
  rgbToCmyk as pipelineRgbToCmyk,
  rgbToLab as pipelineRgbToLab,
  type CmykColor as PipelineCmykColor,
  type LabColor as PipelineLabColor,
} from "./color-pipeline"
import { hexToRgb, rgbToHex, type Rgb } from "./color-utils"

export type HsbColor = { h: number; s: number; b: number }
export type LabFieldColor = { l: number; a: number; b: number }
export type CmykFieldColor = { c: number; m: number; y: number; k: number }

export type ColorHarmonyRule =
  | "complementary"
  | "analogous"
  | "triadic"
  | "split-complementary"
  | "tetradic"
  | "monochrome"

export interface PickerColorDescription {
  web: string
  rgb: Rgb
  hsb: HsbColor
  lab: LabFieldColor
  cmyk: CmykFieldColor
}

export interface HarmonySwatch {
  role: string
  color: string
}

const HEX_RE = /^[0-9a-f]{6}$/i
const HEX_SHORT_RE = /^[0-9a-f]{3}$/i

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function clampByte(value: number) {
  return Math.round(clamp(value, 0, 255))
}

function normalizeHue(value: number) {
  if (!Number.isFinite(value)) return 0
  const wrapped = value % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}

function roundPercent(value: number) {
  return Math.round(clamp(value, 0, 100))
}

export function normalizeWebColor(value: string, fallback = "#000000"): string {
  const raw = value.trim().replace(/^#/, "")
  if (HEX_SHORT_RE.test(raw)) {
    return `#${raw.split("").map((char) => char + char).join("")}`.toLowerCase()
  }
  if (HEX_RE.test(raw)) return `#${raw}`.toLowerCase()
  return fallback
}

export function rgbToHsb(rgb: Rgb): HsbColor {
  const r = clamp(rgb.r, 0, 255) / 255
  const g = clamp(rgb.g, 0, 255) / 255
  const b = clamp(rgb.b, 0, 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = 0

  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6)
    else if (max === g) h = 60 * ((b - r) / delta + 2)
    else h = 60 * ((r - g) / delta + 4)
  }

  return {
    h: Math.round(normalizeHue(h)),
    s: max === 0 ? 0 : roundPercent((delta / max) * 100),
    b: roundPercent(max * 100),
  }
}

export function hsbToRgb(hsb: HsbColor): Rgb {
  const h = normalizeHue(hsb.h)
  const s = clamp(hsb.s, 0, 100) / 100
  const v = clamp(hsb.b, 0, 100) / 100
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0

  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]

  return {
    r: clampByte((r + m) * 255),
    g: clampByte((g + m) * 255),
    b: clampByte((b + m) * 255),
  }
}

export function labFieldsToRgb(lab: LabFieldColor): Rgb {
  return pipelineLabToRgb({
    l: clamp(lab.l, 0, 100),
    a: clamp(lab.a, -128, 127),
    b: clamp(lab.b, -128, 127),
  } satisfies PipelineLabColor)
}

export function cmykFieldsToRgb(cmyk: CmykFieldColor): Rgb {
  return pipelineCmykToRgb({
    c: clamp(cmyk.c, 0, 100) / 100,
    m: clamp(cmyk.m, 0, 100) / 100,
    y: clamp(cmyk.y, 0, 100) / 100,
    k: clamp(cmyk.k, 0, 100) / 100,
  } satisfies PipelineCmykColor)
}

export function describePickerColor(value: string | Rgb): PickerColorDescription {
  const rgb = typeof value === "string" ? hexToRgb(normalizeWebColor(value)) : {
    r: clampByte(value.r),
    g: clampByte(value.g),
    b: clampByte(value.b),
  }
  const lab = pipelineRgbToLab(rgb)
  const cmyk = pipelineRgbToCmyk(rgb, { blackGeneration: "heavy", totalInkLimit: 320 })

  return {
    web: rgbToHex(rgb.r, rgb.g, rgb.b),
    rgb,
    hsb: rgbToHsb(rgb),
    lab: {
      l: Math.round(lab.l),
      a: Math.round(lab.a),
      b: Math.round(lab.b),
    },
    cmyk: {
      c: Math.round(cmyk.c * 100),
      m: Math.round(cmyk.m * 100),
      y: Math.round(cmyk.y * 100),
      k: Math.round(cmyk.k * 100),
    },
  }
}

function harmonyFromHue(base: HsbColor, offsets: Array<[string, number, Partial<HsbColor>?]>): HarmonySwatch[] {
  return offsets.map(([role, offset, patch]) => {
    const hsb = {
      h: normalizeHue(base.h + offset),
      s: patch?.s ?? base.s,
      b: patch?.b ?? base.b,
    }
    const rgb = hsbToRgb(hsb)
    return { role, color: rgbToHex(rgb.r, rgb.g, rgb.b) }
  })
}

export function buildColorHarmony(color: string, rule: ColorHarmonyRule): HarmonySwatch[] {
  const baseDescription = describePickerColor(color)
  const base = baseDescription.hsb
  const baseSwatch = { role: "Base", color: baseDescription.web }

  if (rule === "complementary") {
    return [baseSwatch, ...harmonyFromHue(base, [["Complement", 180]])]
  }
  if (rule === "analogous") {
    return [baseSwatch, ...harmonyFromHue(base, [["Analog -30", -30], ["Analog +30", 30]])]
  }
  if (rule === "triadic") {
    return [baseSwatch, ...harmonyFromHue(base, [["Triad +120", 120], ["Triad -120", -120]])]
  }
  if (rule === "split-complementary") {
    return [baseSwatch, ...harmonyFromHue(base, [["Split +150", 150], ["Split -150", -150]])]
  }
  if (rule === "tetradic") {
    return [baseSwatch, ...harmonyFromHue(base, [["Tetrad +60", 60], ["Tetrad +180", 180], ["Tetrad +240", 240]])]
  }
  return [
    baseSwatch,
    ...harmonyFromHue(base, [
      ["Tint", 0, { s: Math.max(0, base.s - 28), b: Math.min(100, base.b + 18) }],
      ["Shade", 0, { s: Math.min(100, base.s + 10), b: Math.max(0, base.b - 28) }],
      ["Muted", 0, { s: Math.max(0, base.s - 45), b: base.b }],
    ]),
  ]
}

