import type { FilterDef } from "../contracts"
import {
  boxBlur,
  gaussianBlur,
  motionBlur,
  lensBlur,
  surfaceBlur,
  radialBlur,
  fieldBlur,
  irisBlur,
  tiltShiftBlur,
  pathBlur,
  spinBlur,
  type LensBlurExtras,
} from "../registry-helpers"

export const blurFilters: Record<string, FilterDef> = {
  "gaussian-blur": {
    id: "gaussian-blur",
    name: "Gaussian Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 0, max: 100, step: 0.1, default: 4, suffix: "px" },
    ],
    apply: (src, p) => gaussianBlur(src, Number(p.radius)),
  },

  "box-blur": {
    id: "box-blur",
    name: "Box Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 0, max: 100, step: 1, default: 4, suffix: "px" },
    ],
    apply: (src, p) => boxBlur(src, Number(p.radius)),
  },

  "motion-blur": {
    id: "motion-blur",
    name: "Motion Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "angle", label: "Angle", min: -180, max: 180, step: 1, default: 0, suffix: "°" },
      { type: "slider", key: "distance", label: "Distance", min: 1, max: 100, step: 1, default: 12, suffix: "px" },
    ],
    apply: (src, p) => motionBlur(src, Number(p.distance), Number(p.angle)),
  },

  "field-blur": {
    id: "field-blur",
    name: "Field Blur",
    category: "Blur Gallery",
    params: [
      { type: "slider", key: "blur", label: "Blur", min: 0, max: 80, step: 1, default: 12, suffix: "px" },
      { type: "slider", key: "centerX", label: "Center X", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "centerY", label: "Center Y", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "falloff", label: "Falloff", min: 0, max: 100, step: 1, default: 45, suffix: "%" },
      { type: "text", key: "pins", label: "Pins", default: "", placeholder: "x%,y%,blur; x%,y%,blur" },
    ],
    apply: (src, p) => fieldBlur(src, Number(p.blur), Number(p.centerX), Number(p.centerY), Number(p.falloff), String(p.pins ?? "")),
  },

  "iris-blur": {
    id: "iris-blur",
    name: "Iris Blur",
    category: "Blur Gallery",
    params: [
      { type: "slider", key: "blur", label: "Blur", min: 0, max: 80, step: 1, default: 14, suffix: "px" },
      { type: "slider", key: "centerX", label: "Center X", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "centerY", label: "Center Y", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "radius", label: "Iris Radius", min: 5, max: 100, step: 1, default: 42, suffix: "%" },
      { type: "slider", key: "ellipseWidth", label: "Ellipse Width", min: 5, max: 100, step: 1, default: 42, suffix: "%" },
      { type: "slider", key: "ellipseHeight", label: "Ellipse Height", min: 5, max: 100, step: 1, default: 42, suffix: "%" },
      { type: "slider", key: "rotation", label: "Ellipse Rotation", min: -180, max: 180, step: 1, default: 0, suffix: "deg" },
      { type: "slider", key: "feather", label: "Feather", min: 1, max: 100, step: 1, default: 30, suffix: "%" },
    ],
    apply: (src, p) => irisBlur(
      src,
      Number(p.blur),
      Number(p.centerX),
      Number(p.centerY),
      Number(p.radius),
      Number(p.feather),
      Number(p.ellipseWidth ?? p.radius),
      Number(p.ellipseHeight ?? p.radius),
      Number(p.rotation ?? 0),
    ),
  },

  "tilt-shift": {
    id: "tilt-shift",
    name: "Tilt-Shift",
    category: "Blur Gallery",
    params: [
      { type: "slider", key: "blur", label: "Blur", min: 0, max: 80, step: 1, default: 16, suffix: "px" },
      { type: "slider", key: "centerX", label: "Center X", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "centerY", label: "Center Y", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "angle", label: "Angle", min: -180, max: 180, step: 1, default: 0, suffix: "deg" },
      { type: "slider", key: "radius", label: "Sharp Band", min: 1, max: 100, step: 1, default: 30, suffix: "%" },
      { type: "slider", key: "feather", label: "Feather", min: 1, max: 100, step: 1, default: 30, suffix: "%" },
    ],
    apply: (src, p) => tiltShiftBlur(src, Number(p.blur), Number(p.angle), Number(p.radius), Number(p.feather), Number(p.centerX ?? 50), Number(p.centerY ?? 50)),
  },

  "path-blur": {
    id: "path-blur",
    name: "Path Blur",
    category: "Blur Gallery",
    params: [
      { type: "slider", key: "distance", label: "Speed", min: 1, max: 160, step: 1, default: 24, suffix: "px" },
      { type: "slider", key: "angle", label: "Direction", min: -180, max: 180, step: 1, default: 0, suffix: "deg" },
      { type: "slider", key: "taper", label: "Taper", min: 0, max: 100, step: 1, default: 18, suffix: "%" },
      { type: "text", key: "path", label: "Path Points", default: "25,50;75,50", placeholder: "x%,y%; x%,y%" },
    ],
    apply: (src, p) => pathBlur(src, Number(p.distance), Number(p.angle), Number(p.taper), String(p.path ?? "")),
  },

  "spin-blur": {
    id: "spin-blur",
    name: "Spin Blur",
    category: "Blur Gallery",
    params: [
      { type: "slider", key: "amount", label: "Angle", min: 1, max: 100, step: 1, default: 28 },
      { type: "slider", key: "centerX", label: "Center X", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "centerY", label: "Center Y", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "radius", label: "Radius", min: 1, max: 100, step: 1, default: 55, suffix: "%" },
    ],
    apply: (src, p) => spinBlur(src, Number(p.amount), Number(p.centerX), Number(p.centerY), Number(p.radius ?? 55)),
  },


  "lens-blur": {
    id: "lens-blur",
    name: "Lens Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 0, max: 40, step: 1, default: 10, suffix: "px" },
      { type: "select", key: "shape", label: "Iris Shape", options: [
        { value: "hexagon", label: "Hexagon" },
        { value: "pentagon", label: "Pentagon" },
        { value: "octagon", label: "Octagon" },
        { value: "triangle", label: "Triangle" },
        { value: "square", label: "Square" },
        { value: "circle", label: "Circle" },
      ], default: "hexagon" },
      { type: "slider", key: "bladeCount", label: "Blade Curvature", min: 3, max: 8, step: 1, default: 6 },
      { type: "slider", key: "rotation", label: "Rotation", min: 0, max: 360, step: 1, default: 0, suffix: "deg" },
      { type: "slider", key: "brightness", label: "Specular Brightness", min: 0, max: 100, step: 1, default: 0 },
      { type: "slider", key: "threshold", label: "Specular Threshold", min: 0, max: 255, step: 1, default: 255 },
      { type: "slider", key: "noiseAmount", label: "Noise Amount", min: 0, max: 25, step: 1, default: 0 },
      { type: "checkbox", key: "noiseMono", label: "Monochromatic Noise", default: true },
      { type: "text", key: "depthSource", label: "Depth Source (doc:layer)", default: "", placeholder: "layer:<docId>:<layerId> or doc:<docId>" },
      { type: "select", key: "depthChannel", label: "Depth Source Channel", options: [
        { value: "luminance", label: "Luminance" },
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
        { value: "blue", label: "Blue" },
        { value: "alpha", label: "Alpha" },
      ], default: "luminance" },
      { type: "slider", key: "depthFocus", label: "Depth Focus", min: 0, max: 255, step: 1, default: 128 },
      { type: "slider", key: "depthBlurScale", label: "Depth Blur Strength", min: 0, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "checkbox", key: "depthInvert", label: "Invert Depth", default: false },
    ],
    apply: (src, p, ctx) => lensBlur(
      src,
      Number(p.radius),
      Number(p.bladeCount),
      Number(p.rotation),
      Number(p.brightness),
      Number(p.threshold),
      Number(p.noiseAmount),
      Boolean(p.noiseMono),
      {
        shape: String(p.shape ?? "hexagon") as LensBlurExtras["shape"],
        depthSource: ctx?.lensBlurDepthSource ?? null,
        depthChannel: String(p.depthChannel ?? "luminance") as LensBlurExtras["depthChannel"],
        depthFocus: Number(p.depthFocus ?? 128),
        depthBlurScale: Number(p.depthBlurScale ?? 0),
        depthInvert: Boolean(p.depthInvert),
      },
    ),
  },


  "surface-blur": {
    id: "surface-blur",
    name: "Surface Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "radius", label: "Radius", min: 1, max: 18, step: 1, default: 5, suffix: "px" },
      { type: "slider", key: "threshold", label: "Threshold", min: 0, max: 255, step: 1, default: 24 },
    ],
    apply: (src, p) => surfaceBlur(src, Number(p.radius), Number(p.threshold)),
  },


  "radial-blur": {
    id: "radial-blur",
    name: "Radial Blur",
    category: "Blur",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 1, max: 100, step: 1, default: 25 },
      { type: "select", key: "method", label: "Method", options: [
        { value: "spin", label: "Spin" },
        { value: "zoom", label: "Zoom" },
      ], default: "spin" },
      { type: "select", key: "quality", label: "Quality", options: [
        { value: "draft", label: "Draft" },
        { value: "good", label: "Good" },
        { value: "best", label: "Best" },
      ], default: "good" },
      { type: "slider", key: "centerX", label: "Center X", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "centerY", label: "Center Y", min: 0, max: 100, step: 1, default: 50, suffix: "%" },
    ],
    apply: (src, p) => radialBlur(src, Number(p.amount), String(p.method), String(p.quality), Number(p.centerX ?? 50), Number(p.centerY ?? 50)),
  },
}
