import type { FilterDef } from "../contracts"
import {
  numberParam,
  parseBool,
  adaptiveWideAngle,
  distortPinch,
  distortPolar,
  distortRipple,
  distortSpherize,
  distortTwirl,
  distortWave,
  distortZigZag,
  parseAdaptiveConstraints,
  vanishingPoint,
  glassDistort,
  LENS_DEFAULT_VIGNETTE_MIDPOINT,
  lensCorrection,
} from "../registry-helpers"

export const distortionFilters: Record<string, FilterDef> = {

  /* ======================== DISTORT FILTERS ======================== */

  "adaptive-wide-angle": {
    id: "adaptive-wide-angle",
    name: "Adaptive Wide Angle",
    category: "Distort",
    params: [
      { type: "slider", key: "correction", label: "Correction", min: -100, max: 100, step: 1, default: 42 },
      { type: "slider", key: "fisheye", label: "Fisheye", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "rotate", label: "Rotate", min: -45, max: 45, step: 0.5, default: 0, suffix: "deg" },
      { type: "slider", key: "scale", label: "Scale", min: 60, max: 160, step: 1, default: 108, suffix: "%" },
      { type: "slider", key: "focalLength", label: "Focal Length", min: 0, max: 300, step: 1, default: 0, suffix: "mm" },
      { type: "slider", key: "cropFactor", label: "Crop Factor", min: 0, max: 6, step: 0.1, default: 0, suffix: "x" },
      { type: "text", key: "constraints", label: "Constraints (JSON)", default: "", multiline: true, placeholder: '[{"type":"vertical","x1":0.3,"y1":0.1,"x2":0.3,"y2":0.9}]' },
    ],
    apply: (src, p) => adaptiveWideAngle(
      src,
      Number(p.correction),
      Number(p.fisheye),
      Number(p.rotate),
      Number(p.scale),
      {
        focalLength: Number(p.focalLength ?? 0),
        cropFactor: Number(p.cropFactor ?? 0),
        constraints: parseAdaptiveConstraints(String(p.constraints ?? "")),
      },
    ),
  },

  "vanishing-point": {
    id: "vanishing-point",
    name: "Vanishing Point",
    category: "Distort",
    params: [
      { type: "slider", key: "horizon", label: "Horizon", min: 5, max: 95, step: 1, default: 42, suffix: "%" },
      { type: "slider", key: "left", label: "Left Plane", min: -100, max: 100, step: 1, default: -32 },
      { type: "slider", key: "right", label: "Right Plane", min: -100, max: 100, step: 1, default: 26 },
      { type: "slider", key: "depth", label: "Depth", min: -100, max: 100, step: 1, default: 45 },
      { type: "checkbox", key: "grid", label: "Show Plane Grid", default: true },
      { type: "slider", key: "topLeftX", label: "Top Left X", min: -100, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "topLeftY", label: "Top Left Y", min: -100, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "topRightX", label: "Top Right X", min: -100, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "topRightY", label: "Top Right Y", min: -100, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "bottomRightX", label: "Bottom Right X", min: -100, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "bottomRightY", label: "Bottom Right Y", min: -100, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "bottomLeftX", label: "Bottom Left X", min: -100, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "bottomLeftY", label: "Bottom Left Y", min: -100, max: 100, step: 1, default: 0, suffix: "%" },
    ],
    apply: (src, p) => vanishingPoint(
      src,
      Number(p.horizon),
      Number(p.left),
      Number(p.right),
      Number(p.depth),
      parseBool(p.grid, true),
      {
        topLeftX: Number(p.topLeftX ?? 0),
        topLeftY: Number(p.topLeftY ?? 0),
        topRightX: Number(p.topRightX ?? 0),
        topRightY: Number(p.topRightY ?? 0),
        bottomRightX: Number(p.bottomRightX ?? 0),
        bottomRightY: Number(p.bottomRightY ?? 0),
        bottomLeftX: Number(p.bottomLeftX ?? 0),
        bottomLeftY: Number(p.bottomLeftY ?? 0),
      },
    ),
  },

  "twirl": {
    id: "twirl",
    name: "Twirl",
    category: "Distort",
    params: [
      { type: "slider", key: "angle", label: "Angle", min: -999, max: 999, step: 1, default: 50, suffix: "Â°" },
    ],
    apply: (src, p) => distortTwirl(src, Number(p.angle)),
  },

  "pinch": {
    id: "pinch",
    name: "Pinch",
    category: "Distort",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: -100, max: 100, step: 1, default: 50, suffix: "%" },
    ],
    apply: (src, p) => distortPinch(src, Number(p.amount)),
  },

  "spherize": {
    id: "spherize",
    name: "Spherize",
    category: "Distort",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: -100, max: 100, step: 1, default: 100, suffix: "%" },
      { type: "select", key: "mode", label: "Mode", options: [
        { value: "normal", label: "Normal" },
        { value: "horizontal", label: "Horizontal Only" },
        { value: "vertical", label: "Vertical Only" },
      ], default: "normal" },
    ],
    apply: (src, p) => distortSpherize(src, Number(p.amount), String(p.mode)),
  },

  "wave": {
    id: "wave",
    name: "Wave",
    category: "Distort",
    params: [
      { type: "slider", key: "wavelength", label: "Wavelength", min: 1, max: 999, step: 1, default: 120 },
      { type: "slider", key: "amplitude", label: "Amplitude", min: 1, max: 999, step: 1, default: 35 },
      { type: "select", key: "type", label: "Type", options: [
        { value: "sine", label: "Sine" },
        { value: "triangle", label: "Triangle" },
        { value: "square", label: "Square" },
      ], default: "sine" },
      { type: "slider", key: "scale", label: "Scale", min: 1, max: 100, step: 1, default: 100, suffix: "%" },
    ],
    apply: (src, p) => distortWave(src, Number(p.wavelength), Number(p.amplitude), String(p.type), Number(p.scale)),
  },

  "ripple": {
    id: "ripple",
    name: "Ripple",
    category: "Distort",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: -999, max: 999, step: 1, default: 100, suffix: "%" },
      { type: "select", key: "size", label: "Size", options: [
        { value: "small", label: "Small" },
        { value: "medium", label: "Medium" },
        { value: "large", label: "Large" },
      ], default: "medium" },
    ],
    apply: (src, p) => distortRipple(src, Number(p.amount), String(p.size)),
  },

  "zigzag": {
    id: "zigzag",
    name: "ZigZag",
    category: "Distort",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: -100, max: 100, step: 1, default: 20 },
      { type: "slider", key: "ridges", label: "Ridges", min: 1, max: 20, step: 1, default: 5 },
      { type: "select", key: "style", label: "Style", options: [
        { value: "pond", label: "Pond Ripples" },
        { value: "from-center", label: "Out From Center" },
        { value: "around-center", label: "Around Center" },
      ], default: "pond" },
    ],
    apply: (src, p) => distortZigZag(src, Number(p.amount), Number(p.ridges), String(p.style)),
  },

  "polar-coordinates": {
    id: "polar-coordinates",
    name: "Polar Coordinates",
    category: "Distort",
    params: [
      { type: "select", key: "mode", label: "Mode", options: [
        { value: "rect-to-polar", label: "Rectangular to Polar" },
        { value: "polar-to-rect", label: "Polar to Rectangular" },
      ], default: "rect-to-polar" },
    ],
    apply: (src, p) => distortPolar(src, String(p.mode)),
  },


  "glass": {
    id: "glass",
    name: "Glass",
    category: "Distort",
    params: [
      { type: "slider", key: "distortion", label: "Distortion", min: 0, max: 100, step: 1, default: 24 },
      { type: "slider", key: "smoothness", label: "Smoothness", min: 0, max: 8, step: 1, default: 2 },
      { type: "select", key: "texture", label: "Texture", options: [
        { value: "canvas", label: "Canvas" },
        { value: "frosted", label: "Frosted" },
        { value: "blocks", label: "Blocks" },
      ], default: "canvas" },
      { type: "slider", key: "scale", label: "Scale", min: 10, max: 400, step: 1, default: 100, suffix: "%" },
    ],
    apply: (src, p) => glassDistort(src, Number(p.distortion), Number(p.smoothness), String(p.texture), Number(p.scale)),
  },


  "lens-correction": {
    id: "lens-correction",
    name: "Lens Correction",
    category: "Distort",
    params: [
      { type: "select", key: "profile", label: "Lens Profile", default: "custom", options: [
        { value: "custom", label: "Custom (Manual)" },
        { value: "smartphone", label: "Smartphone Wide" },
        { value: "compact-wide", label: "Compact Wide" },
        { value: "wide-angle", label: "Wide Angle 24mm" },
        { value: "fisheye", label: "Fisheye 8-15mm" },
        { value: "standard-50", label: "Standard 50mm" },
        { value: "telephoto", label: "Telephoto 85-200mm" },
        { value: "macro-100", label: "Macro 100mm" },
        { value: "super-tele", label: "Super Telephoto 300mm+" },
        { value: "drone-fpv", label: "Drone / Action Cam" },
        { value: "architecture-shift", label: "Architecture Shift" },
      ] },
      { type: "slider", key: "profileStrength", label: "Profile Strength", min: 0, max: 150, step: 1, default: 100, suffix: "%" },
      { type: "slider", key: "distortion", label: "Geometric Distortion (k1)", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "k2", label: "Higher-Order Distortion (k2)", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "k3", label: "Extreme Distortion (k3)", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "tangentialX", label: "Tangential X (p1)", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "tangentialY", label: "Tangential Y (p2)", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "vignette", label: "Vignette Amount", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "vignetteMidpoint", label: "Vignette Midpoint", min: 0, max: 100, step: 1, default: LENS_DEFAULT_VIGNETTE_MIDPOINT },
      { type: "slider", key: "chromatic", label: "Chromatic Aberration", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "fringeR", label: "Red Fringe", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "fringeG", label: "Green Fringe", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "fringeB", label: "Blue Fringe", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "defringe", label: "Defringe", min: 0, max: 100, step: 1, default: 0 },
      { type: "slider", key: "perspectiveV", label: "Vertical Perspective", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "perspectiveH", label: "Horizontal Perspective", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "scalePct", label: "Scale", min: 50, max: 200, step: 1, default: 100, suffix: "%" },
      { type: "checkbox", key: "autoScale", label: "Auto-Scale to Fit", default: false },
      { type: "select", key: "edgeMode", label: "Edge Handling", default: "clamp", options: [
        { value: "clamp", label: "Clamp Edges" },
        { value: "transparent", label: "Transparent" },
        { value: "black", label: "Black" },
        { value: "white", label: "White" },
      ] },
    ],
    apply: (src, p) => lensCorrection(
      src,
      numberParam(p.distortion, 0),
      numberParam(p.vignette, 0),
      numberParam(p.chromatic, 0),
      numberParam(p.k2, 0),
      numberParam(p.k3, 0),
      numberParam(p.tangentialX, 0),
      numberParam(p.tangentialY, 0),
      String(p.profile ?? "custom"),
      Boolean(p.autoScale),
      String(p.edgeMode ?? "clamp"),
      numberParam(p.profileStrength, 100),
      numberParam(p.defringe, 0),
      {
        fringeR: numberParam(p.fringeR, 0),
        fringeG: numberParam(p.fringeG, 0),
        fringeB: numberParam(p.fringeB, 0),
        perspectiveV: numberParam(p.perspectiveV, 0),
        perspectiveH: numberParam(p.perspectiveH, 0),
        vignetteMidpoint: numberParam(p.vignetteMidpoint, LENS_DEFAULT_VIGNETTE_MIDPOINT),
        scalePct: numberParam(p.scalePct, 100),
      },
    ),
  },
}
