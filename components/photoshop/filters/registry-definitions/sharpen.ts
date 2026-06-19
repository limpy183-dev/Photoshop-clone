import type { FilterDef } from "../contracts"
import {
  sharpen,
  unsharpMask,
  parseBool,
  smartSharpen,
  type SmartSharpenExtras,
} from "../registry-helpers"

export const sharpenFilters: Record<string, FilterDef> = {
  sharpen: {
    id: "sharpen",
    name: "Sharpen",
    category: "Sharpen",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 0, max: 200, step: 1, default: 50, suffix: "%" },
    ],
    apply: (src, p) => sharpen(src, Number(p.amount)),
  },

  "unsharp-mask": {
    id: "unsharp-mask",
    name: "Unsharp Mask",
    category: "Sharpen",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 0, max: 500, step: 1, default: 100, suffix: "%" },
      { type: "slider", key: "radius", label: "Radius", min: 0.1, max: 100, step: 0.1, default: 1, suffix: "px" },
    ],
    apply: (src, p) => unsharpMask(src, Number(p.amount), Number(p.radius)),
  },


  /* ---------- ADVANCED FILTERS ---------- */

  "smart-sharpen": {
    id: "smart-sharpen",
    name: "Smart Sharpen",
    category: "Sharpen",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 1, max: 500, step: 1, default: 100, suffix: "%" },
      { type: "slider", key: "radius", label: "Radius", min: 0.1, max: 64, step: 0.1, default: 1.0, suffix: "px" },
      { type: "slider", key: "threshold", label: "Threshold", min: 0, max: 255, step: 1, default: 0 },
      { type: "select", key: "remove", label: "Remove", options: [
        { value: "gaussian", label: "Gaussian Blur" },
        { value: "lens", label: "Lens Blur" },
        { value: "motion", label: "Motion Blur" },
      ], default: "gaussian" },
      { type: "slider", key: "motionAngle", label: "Motion Angle", min: -180, max: 180, step: 1, default: 0, suffix: "deg" },
      { type: "checkbox", key: "moreAccurate", label: "More Accurate", default: false },
      { type: "slider", key: "shadowAmount", label: "Shadow Fade", min: 0, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "shadowTonalWidth", label: "Shadow Tonal Width", min: 1, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "shadowRadius", label: "Shadow Radius", min: 0, max: 250, step: 1, default: 1, suffix: "px" },
      { type: "slider", key: "highlightAmount", label: "Highlight Fade", min: 0, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "highlightTonalWidth", label: "Highlight Tonal Width", min: 1, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "highlightRadius", label: "Highlight Radius", min: 0, max: 250, step: 1, default: 1, suffix: "px" },
    ],
    apply: (src, p) => smartSharpen(
      src,
      Number(p.amount),
      Number(p.radius),
      Number(p.threshold),
      Number(p.shadowAmount),
      Number(p.highlightAmount),
      {
        remove: String(p.remove ?? "gaussian") as SmartSharpenExtras["remove"],
        motionAngle: Number(p.motionAngle ?? 0),
        moreAccurate: parseBool(p.moreAccurate),
        shadowTonalWidth: Number(p.shadowTonalWidth ?? 50),
        shadowRadius: Number(p.shadowRadius ?? 1),
        highlightTonalWidth: Number(p.highlightTonalWidth ?? 50),
        highlightRadius: Number(p.highlightRadius ?? 1),
      },
    ),
  },
}
