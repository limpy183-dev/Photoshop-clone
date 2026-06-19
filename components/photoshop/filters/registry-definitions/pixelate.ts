import type { FilterDef } from "../contracts"
import {
  colorHalftone,
  mezzotint,
} from "../registry-helpers"

export const pixelateFilters: Record<string, FilterDef> = {

  "color-halftone": {
    id: "color-halftone",
    name: "Color Halftone",
    category: "Pixelate",
    params: [
      { type: "slider", key: "radius", label: "Max Radius", min: 2, max: 32, step: 1, default: 8, suffix: "px" },
      { type: "slider", key: "angle", label: "Screen Angle", min: 0, max: 180, step: 1, default: 45, suffix: "deg" },
    ],
    apply: (src, p) => colorHalftone(src, Number(p.radius), Number(p.angle)),
  },


  "mezzotint": {
    id: "mezzotint",
    name: "Mezzotint",
    category: "Pixelate",
    params: [
      { type: "select", key: "type", label: "Type", options: [
        { value: "fine-dots", label: "Fine Dots" },
        { value: "short-strokes", label: "Short Strokes" },
        { value: "long-strokes", label: "Long Strokes" },
      ], default: "fine-dots" },
      { type: "slider", key: "density", label: "Density", min: 0, max: 100, step: 1, default: 70, suffix: "%" },
    ],
    apply: (src, p) => mezzotint(src, String(p.type), Number(p.density)),
  },
}
