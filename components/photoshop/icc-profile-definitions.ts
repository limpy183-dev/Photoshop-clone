import type { ColorManagementSettings } from "./types"

export type IccProfileName =
  | ColorManagementSettings["assignedProfile"]
  | ColorManagementSettings["workingSpace"]
  | Exclude<ColorManagementSettings["proofProfile"], "None">

export type TransferCurve =
  | { kind: "srgb" }
  | { kind: "gamma"; gamma: number }
  | { kind: "table"; values: number[] }

export type RgbTransferCurve =
  | TransferCurve
  | { kind: "rgb"; r: TransferCurve; g: TransferCurve; b: TransferCurve }

export type DeviceKind = "rgb" | "gray" | "cmyk"
export type Vec3 = [number, number, number]
export type Mat3 = [Vec3, Vec3, Vec3]

export interface RgbProfileDefinition {
  kind: "rgb"
  name: IccProfileName | string
  primaries: {
    r: [number, number]
    g: [number, number]
    b: [number, number]
  }
  white: [number, number]
  transfer: RgbTransferCurve
}

export interface GrayProfileDefinition {
  kind: "gray"
  name: IccProfileName | string
  gamma: number
  dotGain?: number
}

export interface CmykProfileDefinition {
  kind: "cmyk"
  name: IccProfileName | string
  totalInkLimit: number
  blackGeneration: number
  dotGain: number
  grayComponentReplacement: number
}

export type ProfileDefinition = RgbProfileDefinition | GrayProfileDefinition | CmykProfileDefinition

export const D50: Vec3 = [0.96422, 1, 0.82521]
export const D65_XY: [number, number] = [0.3127, 0.3290]
export const D50_XY: [number, number] = [0.34567, 0.35850]

export const BRADFORD: Mat3 = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
]

export const BRADFORD_INV: Mat3 = [
  [0.9869929, -0.1470543, 0.1599627],
  [0.4323053, 0.5183603, 0.0492912],
  [-0.0085287, 0.0400428, 0.9684867],
]

export const PROFILE_DEFINITIONS: Record<IccProfileName, ProfileDefinition> = {
  "sRGB IEC61966-2.1": {
    kind: "rgb",
    name: "sRGB IEC61966-2.1",
    primaries: { r: [0.64, 0.33], g: [0.30, 0.60], b: [0.15, 0.06] },
    white: D65_XY,
    transfer: { kind: "srgb" },
  },
  "Display P3": {
    kind: "rgb",
    name: "Display P3",
    primaries: { r: [0.68, 0.32], g: [0.265, 0.690], b: [0.15, 0.06] },
    white: D65_XY,
    transfer: { kind: "srgb" },
  },
  "Adobe RGB (1998)": {
    kind: "rgb",
    name: "Adobe RGB (1998)",
    primaries: { r: [0.64, 0.33], g: [0.21, 0.71], b: [0.15, 0.06] },
    white: D65_XY,
    transfer: { kind: "gamma", gamma: 2.19921875 },
  },
  "ProPhoto RGB": {
    kind: "rgb",
    name: "ProPhoto RGB",
    primaries: { r: [0.7347, 0.2653], g: [0.1596, 0.8404], b: [0.0366, 0.0001] },
    white: D50_XY,
    transfer: { kind: "gamma", gamma: 1.8 },
  },
  "Working CMYK": {
    kind: "cmyk",
    name: "Working CMYK",
    totalInkLimit: 3.2,
    blackGeneration: 0.88,
    dotGain: 0.08,
    grayComponentReplacement: 0.76,
  },
  "U.S. Web Coated SWOP v2": {
    kind: "cmyk",
    name: "U.S. Web Coated SWOP v2",
    totalInkLimit: 3.0,
    blackGeneration: 0.95,
    dotGain: 0.13,
    grayComponentReplacement: 0.82,
  },
  "Japan Color 2001 Coated": {
    kind: "cmyk",
    name: "Japan Color 2001 Coated",
    totalInkLimit: 3.1,
    blackGeneration: 0.9,
    dotGain: 0.1,
    grayComponentReplacement: 0.78,
  },
  "Dot Gain 20%": {
    kind: "gray",
    name: "Dot Gain 20%",
    gamma: 1.82,
    dotGain: 0.2,
  },
  "Gray Gamma 2.2": {
    kind: "gray",
    name: "Gray Gamma 2.2",
    gamma: 2.2,
  },
}
