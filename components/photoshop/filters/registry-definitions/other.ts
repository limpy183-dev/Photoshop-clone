import type { FilterDef } from "../contracts"
import {
  hexToRgbFilter,
  filterHighPass,
  filterOffset,
  filterMaxMin,
  customConvolution,
} from "../registry-helpers"

export const otherFilters: Record<string, FilterDef> = {

  /* ======================== OTHER FILTERS ======================== */

  "high-pass": {
    id: "high-pass",
    name: "High Pass",
    category: "Other",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 0.1, max: 250, step: 0.1, default: 10, suffix: "px" },
    ],
    apply: (src, p) => filterHighPass(src, Number(p.radius)),
  },

  "offset": {
    id: "offset",
    name: "Offset",
    category: "Other",
    params: [
      { type: "slider", key: "horizontal", label: "Horizontal", min: -2000, max: 2000, step: 1, default: 0, suffix: "px" },
      { type: "slider", key: "vertical", label: "Vertical", min: -2000, max: 2000, step: 1, default: 0, suffix: "px" },
      { type: "select", key: "wrap", label: "Undefined Areas", options: [
        { value: "wrap", label: "Wrap Around" },
        { value: "repeat", label: "Repeat Edge Pixels" },
        { value: "transparent", label: "Set to Transparent" },
        { value: "background", label: "Set to Background Color" },
      ], default: "wrap" },
      { type: "text", key: "fill", label: "Background Color (hex)", default: "#ffffff", placeholder: "#ffffff" },
    ],
    apply: (src, p) => {
      const hex = String(p.fill ?? "#ffffff")
      const rgb = hexToRgbFilter(hex) ?? { r: 255, g: 255, b: 255 }
      return filterOffset(src, Number(p.horizontal), Number(p.vertical), String(p.wrap), rgb.r, rgb.g, rgb.b)
    },
  },

  "maximum": {
    id: "maximum",
    name: "Maximum",
    category: "Other",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 1, max: 100, step: 1, default: 1, suffix: "px" },
    ],
    apply: (src, p) => filterMaxMin(src, Number(p.radius), true),
  },

  "minimum": {
    id: "minimum",
    name: "Minimum",
    category: "Other",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 1, max: 100, step: 1, default: 1, suffix: "px" },
    ],
    apply: (src, p) => filterMaxMin(src, Number(p.radius), false),
  },


  "custom-convolution": {
    id: "custom-convolution",
    name: "Custom Convolution",
    category: "Other",
    params: [
      { type: "select", key: "preset", label: "Kernel", options: [
        { value: "sharpen-more", label: "Sharpen More" },
        { value: "edge-enhance", label: "Edge Enhance" },
        { value: "outline", label: "Outline" },
        { value: "laplacian", label: "Laplacian" },
        { value: "sobel-x", label: "Sobel X" },
        { value: "sobel-y", label: "Sobel Y" },
      ], default: "sharpen-more" },
      { type: "slider", key: "strength", label: "Strength", min: 0, max: 200, step: 1, default: 100, suffix: "%" },
      { type: "slider", key: "bias", label: "Bias", min: -255, max: 255, step: 1, default: 0 },
      { type: "slider", key: "divisor", label: "Scale/Divisor", min: -64, max: 64, step: 1, default: 0 },
      { type: "text", key: "matrix", label: "Matrix", default: "", multiline: true, placeholder: "0 0 0\n0 1 0\n0 0 0" },
    ],
    apply: (src, p) => customConvolution(src, String(p.preset), Number(p.strength), Number(p.bias), String(p.matrix ?? ""), Number(p.divisor ?? 0)),
  },

  "custom-filter": {
    id: "custom-filter",
    name: "Custom Filter",
    category: "Other",
    params: [
      { type: "select", key: "preset", label: "Kernel", options: [
        { value: "sharpen-more", label: "Sharpen More" },
        { value: "edge-enhance", label: "Edge Enhance" },
        { value: "outline", label: "Outline" },
        { value: "laplacian", label: "Laplacian" },
        { value: "sobel-x", label: "Sobel X" },
        { value: "sobel-y", label: "Sobel Y" },
      ], default: "sharpen-more" },
      { type: "slider", key: "strength", label: "Strength", min: 0, max: 200, step: 1, default: 100, suffix: "%" },
      { type: "slider", key: "bias", label: "Bias", min: -255, max: 255, step: 1, default: 0 },
      { type: "slider", key: "divisor", label: "Scale/Divisor", min: -64, max: 64, step: 1, default: 0 },
      { type: "text", key: "matrix", label: "Matrix", default: "", multiline: true, placeholder: "0 0 0\n0 1 0\n0 0 0" },
    ],
    apply: (src, p) => customConvolution(src, String(p.preset), Number(p.strength), Number(p.bias), String(p.matrix ?? ""), Number(p.divisor ?? 0)),
  },
}
