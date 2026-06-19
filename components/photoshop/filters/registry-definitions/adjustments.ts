import type { FilterDef } from "../contracts"
import {
  brightnessContrast,
  hslToRgb,
  parseBool,
  parseCurvePoints,
  channelMixer,
  desaturate,
  equalize,
  exposure,
  grayscale,
  hdrToning,
  hueSaturation,
  invert,
  levels,
  parseReplaceColorSamples,
  photoFilter,
  posterize,
  replaceColor,
  selectiveColor,
  sepia,
  shadowsHighlights,
  threshold,
  blackWhiteAdvanced,
  colorBalanceAdvanced,
  colorLookup,
  curvesAdvanced,
  gradientMapAdvanced,
  matchColorAdvanced,
  vibranceAdvanced,
  skyReplacement,
  applyImageFilter,
  calculationsFilter,
  type HueRange,
  type ApplyChannel,
} from "../registry-helpers"

export const adjustmentFilters: Record<string, FilterDef> = {

  /* Adjustments */
  "brightness-contrast": {
    id: "brightness-contrast",
    name: "Brightness/Contrast",
    category: "Adjustments",
    params: [
      { type: "slider", key: "brightness", label: "Brightness", min: -150, max: 150, step: 1, default: 0 },
      { type: "slider", key: "contrast", label: "Contrast", min: -100, max: 100, step: 1, default: 0 },
      { type: "checkbox", key: "useLegacy", label: "Use Legacy", default: false },
    ],
    apply: (src, p) => brightnessContrast(src, Number(p.brightness), Number(p.contrast), parseBool(p.useLegacy)),
  },

  "hue-saturation": {
    id: "hue-saturation",
    name: "Hue/Saturation",
    category: "Adjustments",
    params: [
      { type: "select", key: "range", label: "Range", options: [
        { value: "master", label: "Master" },
        { value: "reds", label: "Reds" },
        { value: "yellows", label: "Yellows" },
        { value: "greens", label: "Greens" },
        { value: "cyans", label: "Cyans" },
        { value: "blues", label: "Blues" },
        { value: "magentas", label: "Magentas" },
      ], default: "master" },
      { type: "slider", key: "hue", label: "Hue", min: -180, max: 180, step: 1, default: 0, suffix: "Â°" },
      { type: "slider", key: "saturation", label: "Saturation", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "lightness", label: "Lightness", min: -100, max: 100, step: 1, default: 0 },
      { type: "checkbox", key: "colorize", label: "Colorize", default: false },
    ],
    apply: (src, p) =>
      hueSaturation(
        src,
        Number(p.hue),
        Number(p.saturation),
        Number(p.lightness),
        String(p.range ?? "master") as HueRange,
        parseBool(p.colorize),
      ),
  },

  levels: {
    id: "levels",
    name: "Levels",
    category: "Adjustments",
    params: [
      { type: "select", key: "channel", label: "Channel", options: [
        { value: "rgb", label: "RGB" },
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
        { value: "blue", label: "Blue" },
      ], default: "rgb" },
      { type: "slider", key: "inputBlack", label: "Input Black", min: 0, max: 254, step: 1, default: 0 },
      { type: "slider", key: "inputWhite", label: "Input White", min: 1, max: 255, step: 1, default: 255 },
      { type: "slider", key: "gamma", label: "Gamma", min: 0.1, max: 9.99, step: 0.01, default: 1 },
      { type: "slider", key: "outputBlack", label: "Output Black", min: 0, max: 255, step: 1, default: 0 },
      { type: "slider", key: "outputWhite", label: "Output White", min: 0, max: 255, step: 1, default: 255 },
    ],
    apply: (src, p) =>
      levels(
        src,
        Number(p.inputBlack),
        Number(p.inputWhite),
        Number(p.gamma),
        Number(p.outputBlack),
        Number(p.outputWhite),
        String(p.channel ?? "rgb"),
      ),
  },

  threshold: {
    id: "threshold",
    name: "Threshold",
    category: "Adjustments",
    params: [
      { type: "slider", key: "level", label: "Threshold Level", min: 0, max: 255, step: 1, default: 128 },
      { type: "select", key: "channel", label: "Channel", options: [
        { value: "rgb", label: "Composite" },
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
        { value: "blue", label: "Blue" },
        { value: "alpha", label: "Alpha" },
      ], default: "rgb" },
      { type: "checkbox", key: "invert", label: "Invert", default: false },
    ],
    apply: (src, p) => threshold(src, Number(p.level), String(p.channel ?? "rgb"), parseBool(p.invert)),
  },

  posterize: {
    id: "posterize",
    name: "Posterize",
    category: "Adjustments",
    params: [
      { type: "slider", key: "levels", label: "Levels", min: 2, max: 32, step: 1, default: 4 },
      { type: "checkbox", key: "dither", label: "Dither", default: false },
    ],
    apply: (src, p) => posterize(src, Number(p.levels), parseBool(p.dither)),
  },

  vibrance: {
    id: "vibrance",
    name: "Vibrance",
    category: "Adjustments",
    params: [
      { type: "slider", key: "amount", label: "Vibrance", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "saturation", label: "Saturation", min: -100, max: 100, step: 1, default: 0 },
    ],
    apply: (src, p) => vibranceAdvanced(src, Number(p.amount), Number(p.saturation ?? 0)),
  },

  invert: {
    id: "invert",
    name: "Invert",
    category: "Adjustments",
    params: [],
    apply: (src) => invert(src),
  },

  grayscale: {
    id: "grayscale",
    name: "Black & White",
    category: "Adjustments",
    params: [],
    apply: (src) => grayscale(src),
  },

  "black-white": {
    id: "black-white",
    name: "Black & White...",
    category: "Adjustments",
    params: [
      { type: "slider", key: "reds", label: "Reds", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "yellows", label: "Yellows", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "greens", label: "Greens", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "cyans", label: "Cyans", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "blues", label: "Blues", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "magentas", label: "Magentas", min: -100, max: 100, step: 1, default: 0 },
      { type: "checkbox", key: "tint", label: "Tint", default: false },
      { type: "slider", key: "tintHue", label: "Tint Hue", min: 0, max: 360, step: 1, default: 38, suffix: "Â°" },
      { type: "slider", key: "tintSaturation", label: "Tint Saturation", min: 0, max: 100, step: 1, default: 18 },
    ],
    apply: (src, p) => blackWhiteAdvanced(
      src,
      Number(p.reds),
      Number(p.yellows),
      Number(p.greens),
      Number(p.cyans),
      Number(p.blues),
      Number(p.magentas),
      parseBool(p.tint),
      Number(p.tintHue ?? 38),
      Number(p.tintSaturation ?? 18),
    ),
  },

  sepia: {
    id: "sepia",
    name: "Sepia",
    category: "Color",
    params: [
      { type: "slider", key: "amount", label: "Amount", min: 0, max: 100, step: 1, default: 80, suffix: "%" },
    ],
    apply: (src, p) => sepia(src, Number(p.amount)),
  },

  curves: {
    id: "curves",
    name: "Curves",
    category: "Adjustments",
    params: [
      { type: "select", key: "channel", label: "Channel", options: [
        { value: "rgb", label: "RGB" },
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
        { value: "blue", label: "Blue" },
      ], default: "rgb" },
      { type: "slider", key: "shadow", label: "Shadow", min: 0, max: 255, step: 1, default: 0 },
      { type: "slider", key: "midtone", label: "Midtone", min: 0, max: 255, step: 1, default: 128 },
      { type: "slider", key: "highlight", label: "Highlight", min: 0, max: 255, step: 1, default: 255 },
    ],
    apply: (src, p) => curvesAdvanced(src, p),
  },

  "color-balance": {
    id: "color-balance",
    name: "Color Balance",
    category: "Adjustments",
    params: [
      { type: "select", key: "tone", label: "Tone", options: [
        { value: "shadows", label: "Shadows" },
        { value: "midtones", label: "Midtones" },
        { value: "highlights", label: "Highlights" },
      ], default: "midtones" },
      { type: "slider", key: "cyanRed", label: "Cyan / Red", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "magentaGreen", label: "Magenta / Green", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "yellowBlue", label: "Yellow / Blue", min: -100, max: 100, step: 1, default: 0 },
      { type: "checkbox", key: "preserveLuminosity", label: "Preserve Luminosity", default: true },
    ],
    apply: (src, p) =>
      colorBalanceAdvanced(
        src,
        Number(p.cyanRed),
        Number(p.magentaGreen),
        Number(p.yellowBlue),
        String(p.tone ?? "midtones") as "shadows" | "midtones" | "highlights",
        parseBool(p.preserveLuminosity, true),
      ),
  },

  "photo-filter": {
    id: "photo-filter",
    name: "Photo Filter",
    category: "Adjustments",
    params: [
      {
        type: "select",
        key: "color",
        label: "Color",
        options: [
          { value: "warm", label: "Warming" },
          { value: "blue", label: "Cooling" },
          { value: "green", label: "Green" },
          { value: "magenta", label: "Magenta" },
          { value: "cyan", label: "Cyan" },
          { value: "yellow", label: "Yellow" },
        ],
        default: "warm",
      },
      { type: "slider", key: "density", label: "Density", min: 0, max: 100, step: 1, default: 25, suffix: "%" },
    ],
    apply: (src, p) => photoFilter(src, String(p.color), Number(p.density)),
  },

  "channel-mixer": {
    id: "channel-mixer",
    name: "Channel Mixer",
    category: "Adjustments",
    params: [
      { type: "checkbox", key: "monochrome", label: "Monochrome", default: false },
      { type: "checkbox", key: "preserveLuminosity", label: "Preserve Luminosity", default: false },
      { type: "slider", key: "rR", label: "Red â† Red", min: -200, max: 200, step: 1, default: 100 },
      { type: "slider", key: "rG", label: "Red â† Green", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "rB", label: "Red â† Blue", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "gR", label: "Green â† Red", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "gG", label: "Green â† Green", min: -200, max: 200, step: 1, default: 100 },
      { type: "slider", key: "gB", label: "Green â† Blue", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "bR", label: "Blue â† Red", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "bG", label: "Blue â† Green", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "bB", label: "Blue â† Blue", min: -200, max: 200, step: 1, default: 100 },
      { type: "slider", key: "constantR", label: "Red Constant", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "constantG", label: "Green Constant", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "constantB", label: "Blue Constant", min: -200, max: 200, step: 1, default: 0 },
      { type: "slider", key: "grayR", label: "Gray <- Red", min: -200, max: 200, step: 1, default: 40 },
      { type: "slider", key: "grayG", label: "Gray <- Green", min: -200, max: 200, step: 1, default: 40 },
      { type: "slider", key: "grayB", label: "Gray <- Blue", min: -200, max: 200, step: 1, default: 20 },
      { type: "slider", key: "constantGray", label: "Gray Constant", min: -200, max: 200, step: 1, default: 0 },
    ],
    apply: (src, p) =>
      channelMixer(
        src,
        Number(p.rR),
        Number(p.rG),
        Number(p.rB),
        Number(p.gR),
        Number(p.gG),
        Number(p.gB),
        Number(p.bR),
        Number(p.bG),
        Number(p.bB),
        {
          constantR: Number(p.constantR ?? 0),
          constantG: Number(p.constantG ?? 0),
          constantB: Number(p.constantB ?? 0),
          monochrome: parseBool(p.monochrome),
          grayR: Number(p.grayR ?? 40),
          grayG: Number(p.grayG ?? 40),
          grayB: Number(p.grayB ?? 20),
          constantGray: Number(p.constantGray ?? 0),
          preserveLuminosity: parseBool(p.preserveLuminosity),
        },
      ),
  },

  "exposure": {
    id: "exposure",
    name: "Exposure",
    category: "Adjustments",
    params: [
      { type: "slider", key: "ev", label: "EV", min: -5, max: 5, step: 0.1, default: 0 },
    ],
    apply: (src, p) => exposure(src, Number(p.ev)),
  },

  "desaturate": {
    id: "desaturate",
    name: "Desaturate",
    category: "Adjustments",
    params: [],
    apply: (src) => desaturate(src),
  },

  "equalize": {
    id: "equalize",
    name: "Equalize",
    category: "Adjustments",
    params: [
      { type: "select", key: "mode", label: "Mode", options: [
        { value: "image", label: "Equalize entire image" },
        { value: "selection-only", label: "Equalize selected area only" },
        { value: "selection-source", label: "Equalize entire image based on selected area" },
      ], default: "image" },
    ],
    apply: (src, p, context) => {
      const rawMode = String(p.mode ?? "image")
      const mode = (rawMode === "selection-only" || rawMode === "selection-source" ? rawMode : "image") as "image" | "selection-only" | "selection-source"
      return equalize(src, mode, context?.selectionMask ?? null)
    },
  },

  "replace-color": {
    id: "replace-color",
    name: "Replace Color",
    category: "Adjustments",
    params: [
      // Sample lists are stored as ";"-separated "r,g,b" so they round-trip through
      // the adjustments panel and the destructive filter dialog without bespoke types.
      { type: "text", key: "includeSamples", label: "Include samples (r,g,b;...)", default: "", placeholder: "255,0,0;0,128,255" },
      { type: "text", key: "excludeSamples", label: "Exclude samples (r,g,b;...)", default: "", placeholder: "" },
      { type: "slider", key: "sourceHue", label: "Legacy Source Hue", min: 0, max: 360, step: 1, default: 0, suffix: "deg" },
      { type: "slider", key: "fuzziness", label: "Fuzziness", min: 0, max: 200, step: 1, default: 40 },
      { type: "checkbox", key: "localizedClusters", label: "Localized Color Clusters", default: false },
      { type: "slider", key: "replacementHue", label: "Replacement Hue", min: 0, max: 360, step: 1, default: 0, suffix: "deg" },
      { type: "slider", key: "replacementSaturation", label: "Replacement Saturation", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "replacementLightness", label: "Replacement Lightness", min: -100, max: 100, step: 1, default: 0 },
      { type: "text", key: "resultColor", label: "Result color (r,g,b)", default: "", placeholder: "leave blank to use HSL shift" },
    ],
    apply: (src, p) => {
      // Build include list. Prefer explicit samples list; fall back to the
      // legacy single sourceHue param for back-compat with old documents.
      const include = parseReplaceColorSamples(String(p.includeSamples ?? ""))
      if (include.length === 0) {
        const hueDeg = Number(p.sourceHue ?? p.hue ?? -1)
        if (Number.isFinite(hueDeg) && hueDeg >= 0) {
          const { r, g, b } = hslToRgb(((hueDeg % 360) + 360) % 360 / 360, 1, 0.5)
          include.push({ r, g, b })
        }
      }
      const exclude = parseReplaceColorSamples(String(p.excludeSamples ?? ""))
      const resultParsed = parseReplaceColorSamples(String(p.resultColor ?? ""))
      const result = resultParsed.length > 0 ? resultParsed[0] : null
      return replaceColor(
        src,
        include,
        exclude,
        Number(p.fuzziness ?? p.tolerance ?? 40),
        parseBool(p.localizedClusters),
        Number(p.replacementHue ?? p.hue ?? 0),
        Number(p.replacementSaturation ?? 0),
        Number(p.replacementLightness ?? p.lightness ?? 0),
        result,
      )
    },
  },

  "match-color": {
    id: "match-color",
    name: "Match Color",
    category: "Adjustments",
    params: [
      // Source identifier — read by the dialog/menu to resolve the source
      // ImageData and pass it via FilterContext.matchColorSource at apply time.
      // Format: "doc:<docId>" or "layer:<docId>:<layerId>". Empty = no source
      // (the source becomes the active document itself, so Match Color
      // degenerates into a Neutralize/Fade pass).
      { type: "text", key: "matchSource", label: "Source (doc:id or layer:docId:layerId)", default: "", placeholder: "layer:<docId>:<layerId> or doc:<docId>" },
      { type: "slider", key: "luminance", label: "Luminance", min: 0, max: 200, step: 1, default: 100 },
      { type: "slider", key: "colorIntensity", label: "Color Intensity", min: 0, max: 200, step: 1, default: 100 },
      { type: "slider", key: "fade", label: "Fade", min: 0, max: 100, step: 1, default: 0 },
      { type: "checkbox", key: "neutralize", label: "Neutralize", default: false },
    ],
    apply: (src, p, context) =>
      matchColorAdvanced(
        src,
        context?.matchColorSource,
        Number(p.luminance ?? 100),
        Number(p.colorIntensity ?? 100),
        Number(p.fade ?? 0),
        parseBool(p.neutralize),
      ),
  },

  "apply-image": {
    id: "apply-image",
    name: "Apply Image",
    category: "Adjustments",
    params: [
      { type: "text", key: "applySource", label: "Source (doc:layer)", default: "", placeholder: "layer:<docId>:<layerId> or doc:<docId>" },
      { type: "select", key: "channel", label: "Channel", options: [
        { value: "rgb", label: "RGB" },
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
        { value: "blue", label: "Blue" },
        { value: "luminance", label: "Luminance" },
        { value: "alpha", label: "Alpha" },
      ], default: "rgb" },
      { type: "select", key: "blend", label: "Blending", options: [
        { value: "normal", label: "Normal" },
        { value: "multiply", label: "Multiply" },
        { value: "screen", label: "Screen" },
        { value: "overlay", label: "Overlay" },
        { value: "soft-light", label: "Soft Light" },
        { value: "hard-light", label: "Hard Light" },
        { value: "darken", label: "Darken" },
        { value: "lighten", label: "Lighten" },
        { value: "color-burn", label: "Color Burn" },
        { value: "color-dodge", label: "Color Dodge" },
        { value: "linear-burn", label: "Linear Burn" },
        { value: "linear-dodge", label: "Linear Dodge (Add)" },
        { value: "vivid-light", label: "Vivid Light" },
        { value: "linear-light", label: "Linear Light" },
        { value: "pin-light", label: "Pin Light" },
        { value: "hard-mix", label: "Hard Mix" },
        { value: "difference", label: "Difference" },
        { value: "exclusion", label: "Exclusion" },
        { value: "subtract", label: "Subtract" },
        { value: "divide", label: "Divide" },
        { value: "add", label: "Add" },
      ], default: "multiply" },
      { type: "slider", key: "opacity", label: "Opacity", min: 0, max: 100, step: 1, default: 100, suffix: "%" },
      { type: "checkbox", key: "invert", label: "Invert", default: false },
      { type: "checkbox", key: "preserveTransparency", label: "Preserve Transparency", default: true },
    ],
    apply: (src, p, context) =>
      applyImageFilter(
        src,
        context?.applyImageSource ?? null,
        String(p.channel ?? "rgb") as ApplyChannel,
        String(p.blend ?? "multiply"),
        Number(p.opacity ?? 100) / 100,
        parseBool(p.invert),
        parseBool(p.preserveTransparency, true),
      ),
  },

  "calculations": {
    id: "calculations",
    name: "Calculations",
    category: "Adjustments",
    params: [
      { type: "text", key: "sourceA", label: "Source 1 (doc:layer)", default: "", placeholder: "layer:<docId>:<layerId>" },
      { type: "select", key: "channelA", label: "Channel 1", options: [
        { value: "rgb", label: "RGB" },
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
        { value: "blue", label: "Blue" },
        { value: "luminance", label: "Gray" },
        { value: "alpha", label: "Alpha" },
      ], default: "luminance" },
      { type: "checkbox", key: "invertA", label: "Invert Source 1", default: false },
      { type: "text", key: "sourceB", label: "Source 2 (doc:layer)", default: "", placeholder: "layer:<docId>:<layerId>" },
      { type: "select", key: "channelB", label: "Channel 2", options: [
        { value: "rgb", label: "RGB" },
        { value: "red", label: "Red" },
        { value: "green", label: "Green" },
        { value: "blue", label: "Blue" },
        { value: "luminance", label: "Gray" },
        { value: "alpha", label: "Alpha" },
      ], default: "luminance" },
      { type: "checkbox", key: "invertB", label: "Invert Source 2", default: false },
      { type: "select", key: "blend", label: "Blending", options: [
        { value: "multiply", label: "Multiply" },
        { value: "screen", label: "Screen" },
        { value: "overlay", label: "Overlay" },
        { value: "soft-light", label: "Soft Light" },
        { value: "hard-light", label: "Hard Light" },
        { value: "difference", label: "Difference" },
        { value: "subtract", label: "Subtract" },
        { value: "add", label: "Add" },
        { value: "divide", label: "Divide" },
      ], default: "multiply" },
      { type: "slider", key: "opacity", label: "Opacity", min: 0, max: 100, step: 1, default: 100, suffix: "%" },
      { type: "select", key: "result", label: "Result", options: [
        { value: "gray", label: "New Grayscale (replace RGB)" },
        { value: "red", label: "Write to Red" },
        { value: "green", label: "Write to Green" },
        { value: "blue", label: "Write to Blue" },
        { value: "alpha", label: "Write to Alpha" },
      ], default: "gray" },
    ],
    apply: (src, p, context) =>
      calculationsFilter(
        src,
        context?.calcSourceA ?? null,
        context?.calcSourceB ?? null,
        String(p.channelA ?? "luminance") as ApplyChannel,
        String(p.channelB ?? "luminance") as ApplyChannel,
        String(p.blend ?? "multiply"),
        Number(p.opacity ?? 100) / 100,
        parseBool(p.invertA),
        parseBool(p.invertB),
        String(p.result ?? "gray") as "gray" | "red" | "green" | "blue" | "alpha",
      ),
  },

  "selective-color": {
    id: "selective-color",
    name: "Selective Color",
    category: "Adjustments",
    params: [
      { type: "select", key: "range", label: "Colors", options: [
        { value: "reds", label: "Reds" },
        { value: "yellows", label: "Yellows" },
        { value: "greens", label: "Greens" },
        { value: "cyans", label: "Cyans" },
        { value: "blues", label: "Blues" },
        { value: "magentas", label: "Magentas" },
        { value: "whites", label: "Whites" },
        { value: "neutrals", label: "Neutrals" },
        { value: "blacks", label: "Blacks" },
      ], default: "reds" },
      { type: "slider", key: "cyan", label: "Cyan", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "magenta", label: "Magenta", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "yellow", label: "Yellow", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "black", label: "Black", min: -100, max: 100, step: 1, default: 0 },
      { type: "select", key: "method", label: "Method", options: [
        { value: "relative", label: "Relative" },
        { value: "absolute", label: "Absolute" },
      ], default: "relative" },
    ],
    apply: (src, p) => selectiveColor(
      src,
      String(p.range ?? "reds"),
      Number(p.cyan ?? p.cyans ?? 0),
      Number(p.magenta ?? p.magentas ?? 0),
      Number(p.yellow ?? p.yellows ?? 0),
      Number(p.black ?? p.blacks ?? 0),
      String(p.method ?? "relative"),
    ),
  },

  "shadows-highlights": {
    id: "shadows-highlights",
    name: "Shadows/Highlights",
    category: "Adjustments",
    params: [
      // Shadows group.
      { type: "slider", key: "shadowsAmount", label: "Shadows: Amount", min: 0, max: 100, step: 1, default: 35, suffix: "%" },
      { type: "slider", key: "shadowsTonalWidth", label: "Shadows: Tonal Width", min: 1, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "shadowsRadius", label: "Shadows: Radius", min: 0, max: 250, step: 1, default: 30, suffix: "px" },
      // Highlights group.
      { type: "slider", key: "highlightsAmount", label: "Highlights: Amount", min: 0, max: 100, step: 1, default: 0, suffix: "%" },
      { type: "slider", key: "highlightsTonalWidth", label: "Highlights: Tonal Width", min: 1, max: 100, step: 1, default: 50, suffix: "%" },
      { type: "slider", key: "highlightsRadius", label: "Highlights: Radius", min: 0, max: 250, step: 1, default: 30, suffix: "px" },
      // Adjustments group.
      { type: "slider", key: "colorCorrection", label: "Color Correction", min: -100, max: 100, step: 1, default: 20 },
      { type: "slider", key: "midtoneContrast", label: "Midtone Contrast", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "blackClip", label: "Black Clip", min: 0, max: 50, step: 0.01, default: 0.01, suffix: "%" },
      { type: "slider", key: "whiteClip", label: "White Clip", min: 0, max: 50, step: 0.01, default: 0.01, suffix: "%" },
    ],
    apply: (src, p) => shadowsHighlights(
      src,
      // Legacy "shadows"/"highlights"/"tonalWidth"/"radius" keys are accepted as
      // fallbacks so existing documents do not lose their settings.
      Number(p.shadowsAmount ?? p.shadows ?? 0),
      Number(p.shadowsTonalWidth ?? p.tonalWidth ?? 50),
      Number(p.shadowsRadius ?? p.radius ?? 30),
      Number(p.highlightsAmount ?? p.highlights ?? 0),
      Number(p.highlightsTonalWidth ?? p.tonalWidth ?? 50),
      Number(p.highlightsRadius ?? p.radius ?? 30),
      Number(p.colorCorrection ?? 0),
      Number(p.midtoneContrast ?? 0),
      Number(p.blackClip ?? 0.01),
      Number(p.whiteClip ?? 0.01),
    ),
  },

  "hdr-toning": {
    id: "hdr-toning",
    name: "HDR Toning",
    category: "Adjustments",
    params: [
      { type: "select", key: "method", label: "Method", options: [
        { value: "local-adaptation", label: "Local Adaptation" },
        { value: "exposure-gamma", label: "Exposure and Gamma" },
        { value: "highlight-compression", label: "Highlight Compression" },
        { value: "equalize-histogram", label: "Equalize Histogram" },
      ], default: "local-adaptation" },
      // "Edge Glow" group
      { type: "slider", key: "radius", label: "Radius", min: 1, max: 250, step: 1, default: 60, suffix: "px" },
      { type: "slider", key: "strength", label: "Strength", min: 0, max: 200, step: 1, default: 100, suffix: "%" },
      { type: "slider", key: "edgeGlow", label: "Edge Glow", min: 0, max: 100, step: 1, default: 30 },
      // "Tone and Detail" group
      { type: "slider", key: "gamma", label: "Gamma", min: 0.3, max: 3, step: 0.01, default: 1 },
      { type: "slider", key: "exposureEv", label: "Exposure", min: -4, max: 4, step: 0.01, default: 0, suffix: "EV" },
      { type: "slider", key: "detail", label: "Detail", min: -100, max: 100, step: 1, default: 0 },
      // "Advanced" group
      { type: "slider", key: "shadow", label: "Shadow", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "highlight", label: "Highlight", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "vibrance", label: "Vibrance", min: -100, max: 100, step: 1, default: 0 },
      { type: "slider", key: "saturation", label: "Saturation", min: -100, max: 100, step: 1, default: 0 },
      // "Toning Curve" group — stored as "x,y;x,y;..."
      { type: "text", key: "toningCurve", label: "Toning Curve points", default: "0,0;255,255", placeholder: "0,0;128,128;255,255" },
    ],
    apply: (src, p) => hdrToning(
      src,
      String(p.method ?? "local-adaptation"),
      Number(p.radius ?? 60),
      Number(p.strength ?? 100),
      Number(p.edgeGlow ?? 30),
      Number(p.gamma ?? 1),
      Number(p.exposureEv ?? 0),
      Number(p.detail ?? 0),
      Number(p.shadow ?? 0),
      Number(p.highlight ?? 0),
      Number(p.vibrance ?? 0),
      Number(p.saturation ?? 0),
      parseCurvePoints(p.toningCurve ?? "0,0;255,255"),
    ),
  },

  "color-lookup": {
    id: "color-lookup",
    name: "Color Lookup (LUT approximation)",
    category: "Adjustments",
    params: [
      { type: "select", key: "preset", label: "Preset", options: [
        { value: "filmic", label: "Filmic Contrast" },
        { value: "warm", label: "Warm" },
        { value: "cool", label: "Cool" },
        { value: "bleach", label: "Bleach Bypass" },
        { value: "cross-process", label: "Cross Process" },
      ], default: "filmic" },
      { type: "slider", key: "strength", label: "Strength", min: -100, max: 100, step: 1, default: 0 },
      { type: "text", key: "lutData", label: "Imported LUT (.cube)", default: "", multiline: true, accept: ".cube,.CUBE", placeholder: "Paste or import CUBE LUT data" },
    ],
    apply: (src, p) => colorLookup(src, Number(p.strength), String(p.lutData ?? ""), String(p.preset ?? "filmic")),
  },

  "gradient-map": {
    id: "gradient-map",
    name: "Gradient Map",
    category: "Adjustments",
    params: [
      { type: "text", key: "gradient", label: "Gradient Stops", default: "0,#000000;1,#ffffff", placeholder: "0,#000000;0.5,#ff0000;1,#ffffff" },
      { type: "select", key: "interpolation", label: "Interpolation", options: [
        { value: "rgb", label: "RGB" },
        { value: "hsl", label: "HSL" },
      ], default: "rgb" },
      { type: "checkbox", key: "reverse", label: "Reverse", default: false },
      { type: "checkbox", key: "dither", label: "Dither", default: true },
    ],
    apply: (src, p) =>
      gradientMapAdvanced(
        src,
        String(p.gradient ?? "0,#000000;1,#ffffff"),
        parseBool(p.reverse),
        parseBool(p.dither, true),
        String(p.interpolation ?? "rgb"),
      ),
  },

  "sky-replacement": {
    id: "sky-replacement",
    name: "Sky Replacement",
    category: "Adjustments",
    params: [
      { type: "slider", key: "horizon", label: "Horizon", min: 5, max: 95, step: 1, default: 45, suffix: "%" },
      { type: "slider", key: "tolerance", label: "Sky Detection", min: 0, max: 100, step: 1, default: 54, suffix: "%" },
      { type: "slider", key: "blend", label: "Blend", min: 0, max: 100, step: 1, default: 82, suffix: "%" },
      { type: "slider", key: "warmth", label: "Warmth", min: -100, max: 100, step: 1, default: 12 },
      { type: "slider", key: "seed", label: "Cloud Seed", min: 0, max: 999, step: 1, default: 4 },
    ],
    apply: (src, p) => skyReplacement(src, Number(p.horizon), Number(p.tolerance), Number(p.blend), Number(p.warmth), Number(p.seed)),
  },
}
