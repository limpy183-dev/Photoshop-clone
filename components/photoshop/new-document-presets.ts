import type { DocumentModeSettings } from "./types"

export type NewDocumentUnit = "px" | "in" | "cm" | "mm"

export interface NewDocumentPreset {
  name: string
  group: "Recent" | "Photo" | "Print" | "Web" | "Mobile" | "Icon" | "Social" | "Film"
  w: number
  h: number
  dpi: number
  mode: DocumentModeSettings["mode"]
  bitDepth: 8 | 16 | 32
}

export const NEW_DOCUMENT_PRESET_GROUPS = [
  "Recent",
  "Photo",
  "Print",
  "Web",
  "Mobile",
  "Icon",
  "Social",
  "Film",
] as const satisfies readonly NewDocumentPreset["group"][]

export const NEW_DOCUMENT_PRESETS: NewDocumentPreset[] = [
  { group: "Recent", name: "Default Canvas", w: 1200, h: 800, dpi: 72, mode: "RGB", bitDepth: 8 },
  { group: "Photo", name: "Photo 6 x 4 in", w: 1800, h: 1200, dpi: 300, mode: "RGB", bitDepth: 16 },
  { group: "Photo", name: "Photo 5 x 7 in", w: 1500, h: 2100, dpi: 300, mode: "RGB", bitDepth: 16 },
  { group: "Photo", name: "Photo 8 x 10 in", w: 2400, h: 3000, dpi: 300, mode: "RGB", bitDepth: 16 },
  { group: "Print", name: "US Letter", w: 2550, h: 3300, dpi: 300, mode: "CMYK", bitDepth: 8 },
  { group: "Print", name: "A4", w: 2480, h: 3508, dpi: 300, mode: "CMYK", bitDepth: 8 },
  { group: "Print", name: "Poster 18 x 24 in", w: 5400, h: 7200, dpi: 300, mode: "CMYK", bitDepth: 8 },
  { group: "Web", name: "HD 1920 x 1080", w: 1920, h: 1080, dpi: 72, mode: "RGB", bitDepth: 8 },
  { group: "Web", name: "Desktop 1440 x 900", w: 1440, h: 900, dpi: 72, mode: "RGB", bitDepth: 8 },
  { group: "Mobile", name: "Phone Portrait", w: 1080, h: 1920, dpi: 72, mode: "RGB", bitDepth: 8 },
  { group: "Mobile", name: "Tablet Portrait", w: 1536, h: 2048, dpi: 72, mode: "RGB", bitDepth: 8 },
  { group: "Icon", name: "App Icon 1024", w: 1024, h: 1024, dpi: 72, mode: "RGB", bitDepth: 8 },
  { group: "Icon", name: "Favicon 512", w: 512, h: 512, dpi: 72, mode: "RGB", bitDepth: 8 },
  { group: "Social", name: "Square Social", w: 1080, h: 1080, dpi: 72, mode: "RGB", bitDepth: 8 },
  { group: "Social", name: "Story / Reel", w: 1080, h: 1920, dpi: 72, mode: "RGB", bitDepth: 8 },
  { group: "Film", name: "4K UHD", w: 3840, h: 2160, dpi: 72, mode: "RGB", bitDepth: 16 },
]

export function findNewDocumentPreset(name: string | null | undefined) {
  if (!name) return null
  return NEW_DOCUMENT_PRESETS.find((preset) => preset.name === name) ?? null
}

export function unitToPixels(value: number, unit: NewDocumentUnit, dpi: number) {
  if (unit === "px") return value
  if (unit === "in") return value * dpi
  if (unit === "cm") return (value / 2.54) * dpi
  return (value / 25.4) * dpi
}

export function pixelsToUnit(value: number, unit: NewDocumentUnit, dpi: number) {
  if (unit === "px") return value
  if (unit === "in") return value / dpi
  if (unit === "cm") return (value / dpi) * 2.54
  return (value / dpi) * 25.4
}

export function modeSettings(mode: DocumentModeSettings["mode"]): DocumentModeSettings {
  if (mode === "Indexed") return { mode, indexed: { colors: 256, dither: true } }
  if (mode === "Bitmap") return { mode, bitmap: { method: "halftone", threshold: 128, frequency: 45, angle: 45, shape: "round", inputResolution: 300, outputResolution: 300 } }
  if (mode === "Multichannel") return { mode, multichannel: { channels: { r: true, g: true, b: true, c: true, m: true, y: true, k: true } } }
  if (mode === "Duotone") return { mode, duotone: { inkCount: 2, ink1: "#111111", ink2: "#4d78aa", curve: 1, paper: "#ffffff", overprint: "normal", opacity1: 100, opacity2: 70 } }
  return { mode }
}

export function estimateDocumentMemoryMb(width: number, height: number, bitDepth: 8 | 16 | 32) {
  return (width * height * 4 * (bitDepth === 32 ? 4 : bitDepth === 16 ? 2 : 1)) / 1024 / 1024
}
