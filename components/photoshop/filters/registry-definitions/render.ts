import type { FilterDef } from "../contracts"
import {
  renderClouds,
  renderFibers,
  renderLensFlare,
  lightingEffects,
  type MaterialConfig,
} from "../registry-helpers"

export const renderFilters: Record<string, FilterDef> = {

  /* ======================== RENDER FILTERS ======================== */

  "clouds": {
    id: "clouds",
    name: "Clouds",
    category: "Render",
    params: [
      { type: "slider", key: "scale", label: "Scale", min: 1, max: 200, step: 1, default: 50 },
      { type: "slider", key: "seed", label: "Seed", min: 0, max: 999, step: 1, default: 0 },
    ],
    apply: (src, p) => renderClouds(src, Number(p.scale), Number(p.seed), false),
  },

  "difference-clouds": {
    id: "difference-clouds",
    name: "Difference Clouds",
    category: "Render",
    params: [
      { type: "slider", key: "scale", label: "Scale", min: 1, max: 200, step: 1, default: 50 },
      { type: "slider", key: "seed", label: "Seed", min: 0, max: 999, step: 1, default: 0 },
    ],
    apply: (src, p) => renderClouds(src, Number(p.scale), Number(p.seed), true),
  },

  "fibers": {
    id: "fibers",
    name: "Fibers",
    category: "Render",
    params: [
      { type: "slider", key: "variance", label: "Variance", min: 1, max: 64, step: 1, default: 16 },
      { type: "slider", key: "strength", label: "Strength", min: 1, max: 64, step: 1, default: 4 },
      { type: "slider", key: "seed", label: "Seed", min: 0, max: 999, step: 1, default: 0 },
    ],
    apply: (src, p) => renderFibers(src, Number(p.variance), Number(p.strength), Number(p.seed)),
  },

  "lens-flare": {
    id: "lens-flare",
    name: "Lens Flare",
    category: "Render",
    params: [
      { type: "slider", key: "brightness", label: "Brightness", min: 10, max: 300, step: 1, default: 100, suffix: "%" },
      { type: "slider", key: "cx", label: "Center X", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "cy", label: "Center Y", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "select", key: "lens", label: "Lens Type", options: [
        { value: "50-300", label: "50-300mm Zoom" },
        { value: "35", label: "35mm Prime" },
        { value: "105", label: "105mm Prime" },
        { value: "movie", label: "Movie Prime" },
      ], default: "50-300" },
    ],
    apply: (src, p) => renderLensFlare(src, Number(p.brightness), Number(p.cx), Number(p.cy), String(p.lens)),
  },


  "lighting-effects": {
    id: "lighting-effects",
    name: "Lighting Effects",
    category: "Render",
    params: [
      { type: "select", key: "style", label: "Light Style", options: [
        { value: "spot", label: "Spot" },
        { value: "omni", label: "Omni" },
        { value: "directional", label: "Directional" },
        { value: "three-point", label: "Three-Point" },
        { value: "rgb-trio", label: "RGB Trio" },
      ], default: "spot" },
      { type: "slider", key: "intensity", label: "Intensity", min: 0, max: 250, step: 1, default: 120, suffix: "%" },
      { type: "slider", key: "ambient", label: "Ambience", min: 0, max: 150, step: 1, default: 45, suffix: "%" },
      { type: "slider", key: "height", label: "Texture Height", min: 0, max: 100, step: 1, default: 35, suffix: "%" },
      { type: "slider", key: "gloss", label: "Gloss", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "shine", label: "Shine", min: 0, max: 100, step: 1, default: 60, suffix: "%" },
      { type: "slider", key: "exposure", label: "Exposure", min: -200, max: 200, step: 1, default: 0, suffix: "/100 EV" },
      { type: "text", key: "bumpSource", label: "Bump Source (doc:layer)", default: "", placeholder: "layer:<docId>:<layerId> or doc:<docId>" },
      { type: "select", key: "bumpChannel", label: "Bump Source Channel", options: [
        { value: "luminance", label: "Luminance (default)" },
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
        { value: "blue", label: "Blue" },
        { value: "alpha", label: "Alpha" },
      ], default: "luminance" },
      { type: "text", key: "lights", label: "Lights JSON", default: "", multiline: true, placeholder: '[{"type":"spot","x":0.5,"y":0.4,"z":0.6,"intensity":1,"color":[255,240,210],"radius":0.6,"focus":0.4}]' },
    ],
    apply: (src, p, ctx) => {
      const material: MaterialConfig = {
        gloss: Number(p.gloss ?? 50) / 100,
        shine: Number(p.shine ?? 60) / 100,
        exposure: Number(p.exposure ?? 0) / 100,
      }
      const bumpChannel = String(p.bumpChannel ?? "luminance") as
        "luminance" | "red" | "green" | "blue" | "alpha"
      return lightingEffects(
        src,
        String(p.style ?? "spot"),
        Number(p.intensity),
        Number(p.ambient),
        Number(p.height),
        p.lights ? String(p.lights) : undefined,
        material,
        ctx?.lightingBumpSource ?? null,
        bumpChannel,
      )
    },
  },
}
