import type { FilterDef } from "../contracts"
import {
  emboss,
  findEdges,
  pixelate,
  solarize,
  oilPaint,
} from "../registry-helpers"

export const stylizeFilters: Record<string, FilterDef> = {
  "find-edges": {
    id: "find-edges",
    name: "Find Edges",
    category: "Stylize",
    params: [],
    apply: (src) => findEdges(src),
  },

  emboss: {
    id: "emboss",
    name: "Emboss",
    category: "Stylize",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 0, max: 500, step: 1, default: 100, suffix: "%" },
    ],
    apply: (src, p) => emboss(src, Number(p.amount)),
  },

  solarize: {
    id: "solarize",
    name: "Solarize",
    category: "Stylize",
    params: [
      { type: "slider", key: "threshold", label: "Threshold", min: 0, max: 255, step: 1, default: 128 },
    ],
    apply: (src, p) => solarize(src, Number(p.threshold)),
  },

  pixelate: {
    id: "pixelate",
    name: "Pixelate (Mosaic)",
    category: "Stylize",
    params: [
      { type: "slider", key: "size", label: "Cell size", min: 2, max: 64, step: 1, default: 8, suffix: "px" },
    ],
    apply: (src, p) => pixelate(src, Number(p.size)),
  },


  "oil-paint": {
    id: "oil-paint",
    name: "Oil Paint",
    category: "Stylize",
    params: [
      { type: "slider", key: "radius", label: "Stylization Radius", min: 1, max: 8, step: 1, default: 4, suffix: "px" },
      { type: "slider", key: "levels", label: "Cleanliness", min: 4, max: 32, step: 1, default: 16 },
      { type: "slider", key: "shine", label: "Lighting Shine", min: 0, max: 100, step: 1, default: 18, suffix: "%" },
    ],
    apply: (src, p) => oilPaint(src, Number(p.radius), Number(p.levels), Number(p.shine)),
  },
}
