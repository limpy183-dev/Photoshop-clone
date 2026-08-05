/**
 * Vocabulary for the layer property pickers.
 *
 * `BLEND_MODE_OPTIONS` is the full Photoshop blend menu in menu order, shared by
 * the Layers and Properties panels. It is deliberately not
 * `ALL_BLEND_MODES` from the compositor: that set also carries "behind" and
 * "clear", which are brush modes and never offered as a layer blend. Other
 * pickers (gradient, layer style, filter gallery) intentionally show narrower
 * subsets and keep their own lists.
 */

import type { BlendMode, Layer } from "@/editor/types"

export const BLEND_MODE_OPTIONS: BlendMode[] = [
"normal",
  "dissolve",
  "darken",
  "multiply",
  "color-burn",
  "linear-burn",
  "darker-color",
  "lighten",
  "screen",
  "color-dodge",
  "linear-dodge",
  "lighter-color",
  "overlay",
  "soft-light",
  "hard-light",
  "vivid-light",
  "linear-light",
  "pin-light",
  "hard-mix",
  "difference",
  "exclusion",
  "subtract",
  "divide",
  "hue",
  "saturation",
  "color",
  "luminosity",
]

export const COLOR_LABELS: { id: NonNullable<Layer["colorLabel"]>; bg: string; label: string }[] = [
{ id: "none", bg: "transparent", label: "None" },
  { id: "red", bg: "#d04a4a", label: "Red" },
  { id: "orange", bg: "#e08a3c", label: "Orange" },
  { id: "yellow", bg: "#d8c44a", label: "Yellow" },
  { id: "green", bg: "#5fa55a", label: "Green" },
  { id: "blue", bg: "#4f88c8", label: "Blue" },
  { id: "violet", bg: "#9266c4", label: "Violet" },
  { id: "gray", bg: "#7d7d7d", label: "Gray" },
]
