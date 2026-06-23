import type { HighBitAdjustment } from "./color-pipeline"

export const DIRECT_HIGH_BIT_ADJUSTMENTS = new Set<HighBitAdjustment["type"]>([
  "brightness-contrast",
  "levels",
  "curves",
  "exposure",
  "invert",
  "channel-mixer",
  "grayscale",
  "desaturate",
  "posterize",
  "threshold",
])

export const HIGH_BIT_BLUR_FILTERS = new Set([
  "blur",
  "blur-more",
  "average",
  "average-blur",
  "box-blur",
  "gaussian-blur",
  "motion-blur",
  "smart-blur",
  "surface-blur",
  "shape-blur",
  "lens-blur",
  "field-blur",
  "iris-blur",
  "tilt-shift",
])

export const HIGH_BIT_SHARPEN_FILTERS = new Set([
  "sharpen",
  "sharpen-more",
  "unsharp-mask",
  "smart-sharpen",
])
