import type { FilterDef } from "../contracts"
import {
  noise,
  reduceNoise,
  dustAndScratches,
} from "../registry-helpers"

export const noiseFilters: Record<string, FilterDef> = {
  noise: {
    id: "noise",
    name: "Add Noise",
    category: "Noise",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 0, max: 100, step: 1, default: 25 },
      { type: "select", key: "distribution", label: "Distribution", options: [
        { value: "uniform", label: "Uniform" },
        { value: "gaussian", label: "Gaussian" },
      ], default: "uniform" },
      { type: "checkbox", key: "mono", label: "Monochromatic", default: false },
    ],
    apply: (src, p) => noise(src, Number(p.amount), Boolean(p.mono), String(p.distribution) === "gaussian"),
  },


  "reduce-noise": {
    id: "reduce-noise",
    name: "Reduce Noise",
    category: "Noise",
    params: [
      { type: "slider", key: "strength", label: "Strength", min: 0, max: 10, step: 1, default: 6 },
      { type: "slider", key: "colorNoise", label: "Reduce Color Noise", min: 0, max: 100, step: 1, default: 25, suffix: "%" },
      { type: "slider", key: "detail", label: "Preserve Details", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "sharpen", label: "Sharpen Details", min: 0, max: 100, step: 1, default: 25, suffix: "%" },
    ],
    apply: (src, p) => reduceNoise(src, Number(p.strength), Number(p.colorNoise), Number(p.detail), Number(p.sharpen)),
  },


  "dust-scratches": {
    id: "dust-scratches",
    name: "Dust & Scratches",
    category: "Noise",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 1, max: 16, step: 1, default: 1, suffix: "px" },
      { type: "slider", key: "threshold", label: "Threshold", min: 0, max: 255, step: 1, default: 0 },
    ],
    apply: (src, p) => dustAndScratches(src, Number(p.radius), Number(p.threshold)),
  },
}
