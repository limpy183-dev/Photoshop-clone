/**
 * Lightweight filter metadata (id, name, category).
 *
 * Imported by menu-bar.tsx and similar discovery surfaces that need to render
 * filter labels without paying the bundle cost of the full kernel registry
 * in filters.ts (~170KB). The heavy `apply` implementations live in filters.ts
 * and are dynamically imported on invocation.
 */

export interface FilterMeta {
  id: string
  name: string
  category: string
}

export const FILTER_META: Record<string, FilterMeta> = {
  // Blur
  "gaussian-blur": { id: "gaussian-blur", name: "Gaussian Blur", category: "Blur" },
  "box-blur": { id: "box-blur", name: "Box Blur", category: "Blur" },
  "motion-blur": { id: "motion-blur", name: "Motion Blur", category: "Blur" },
  "lens-blur": { id: "lens-blur", name: "Lens Blur", category: "Blur" },
  "surface-blur": { id: "surface-blur", name: "Surface Blur", category: "Blur" },
  "radial-blur": { id: "radial-blur", name: "Radial Blur", category: "Blur" },
  "smart-blur": { id: "smart-blur", name: "Smart Blur", category: "Blur" },
  "shape-blur": { id: "shape-blur", name: "Shape Blur", category: "Blur" },
  "average-blur": { id: "average-blur", name: "Average", category: "Blur" },
  "blur-more": { id: "blur-more", name: "Blur More", category: "Blur" },

  // Blur Gallery
  "field-blur": { id: "field-blur", name: "Field Blur", category: "Blur Gallery" },
  "iris-blur": { id: "iris-blur", name: "Iris Blur", category: "Blur Gallery" },
  "tilt-shift": { id: "tilt-shift", name: "Tilt-Shift", category: "Blur Gallery" },
  "path-blur": { id: "path-blur", name: "Path Blur", category: "Blur Gallery" },
  "spin-blur": { id: "spin-blur", name: "Spin Blur", category: "Blur Gallery" },

  // Sharpen
  sharpen: { id: "sharpen", name: "Sharpen", category: "Sharpen" },
  "unsharp-mask": { id: "unsharp-mask", name: "Unsharp Mask", category: "Sharpen" },
  "smart-sharpen": { id: "smart-sharpen", name: "Smart Sharpen", category: "Sharpen" },

  // Stylize
  "find-edges": { id: "find-edges", name: "Find Edges", category: "Stylize" },
  emboss: { id: "emboss", name: "Emboss", category: "Stylize" },
  solarize: { id: "solarize", name: "Solarize", category: "Stylize" },
  pixelate: { id: "pixelate", name: "Pixelate (Mosaic)", category: "Stylize" },
  "glowing-edges": { id: "glowing-edges", name: "Glowing Edges", category: "Stylize" },
  wind: { id: "wind", name: "Wind", category: "Stylize" },
  extrude: { id: "extrude", name: "Extrude", category: "Stylize" },
  "oil-paint": { id: "oil-paint", name: "Oil Paint", category: "Stylize" },

  // Noise
  noise: { id: "noise", name: "Add Noise", category: "Noise" },
  "reduce-noise": { id: "reduce-noise", name: "Reduce Noise", category: "Noise" },
  "dust-scratches": { id: "dust-scratches", name: "Dust & Scratches", category: "Noise" },
  despeckle: { id: "despeckle", name: "Despeckle", category: "Noise" },

  // Adjustments
  "brightness-contrast": { id: "brightness-contrast", name: "Brightness/Contrast", category: "Adjustments" },
  "hue-saturation": { id: "hue-saturation", name: "Hue/Saturation", category: "Adjustments" },
  levels: { id: "levels", name: "Levels", category: "Adjustments" },
  threshold: { id: "threshold", name: "Threshold", category: "Adjustments" },
  posterize: { id: "posterize", name: "Posterize", category: "Adjustments" },
  vibrance: { id: "vibrance", name: "Vibrance", category: "Adjustments" },
  invert: { id: "invert", name: "Invert", category: "Adjustments" },
  grayscale: { id: "grayscale", name: "Black & White", category: "Adjustments" },
  "black-white": { id: "black-white", name: "Black & White...", category: "Adjustments" },
  curves: { id: "curves", name: "Curves", category: "Adjustments" },
  "color-balance": { id: "color-balance", name: "Color Balance", category: "Adjustments" },
  "photo-filter": { id: "photo-filter", name: "Photo Filter", category: "Adjustments" },
  "channel-mixer": { id: "channel-mixer", name: "Channel Mixer", category: "Adjustments" },
  exposure: { id: "exposure", name: "Exposure", category: "Adjustments" },
  desaturate: { id: "desaturate", name: "Desaturate", category: "Adjustments" },
  equalize: { id: "equalize", name: "Equalize", category: "Adjustments" },
  "replace-color": { id: "replace-color", name: "Replace Color", category: "Adjustments" },
  "match-color": { id: "match-color", name: "Match Color (average match)", category: "Adjustments" },
  "selective-color": { id: "selective-color", name: "Selective Color", category: "Adjustments" },
  "shadows-highlights": { id: "shadows-highlights", name: "Shadows/Highlights", category: "Adjustments" },
  "hdr-toning": { id: "hdr-toning", name: "HDR Toning (local contrast)", category: "Adjustments" },
  "color-lookup": { id: "color-lookup", name: "Color Lookup (LUT approximation)", category: "Adjustments" },
  "gradient-map": { id: "gradient-map", name: "Gradient Map", category: "Adjustments" },
  "sky-replacement": { id: "sky-replacement", name: "Sky Replacement", category: "Adjustments" },
  "apply-image": { id: "apply-image", name: "Apply Image", category: "Adjustments" },
  "calculations": { id: "calculations", name: "Calculations", category: "Adjustments" },

  // Color
  sepia: { id: "sepia", name: "Sepia", category: "Color" },

  // Distort
  displace: { id: "displace", name: "Displace", category: "Distort" },
  "diffuse-glow": { id: "diffuse-glow", name: "Diffuse Glow", category: "Distort" },
  "ocean-ripple": { id: "ocean-ripple", name: "Ocean Ripple", category: "Distort" },
  "adaptive-wide-angle": { id: "adaptive-wide-angle", name: "Adaptive Wide Angle", category: "Distort" },
  "vanishing-point": { id: "vanishing-point", name: "Vanishing Point", category: "Distort" },
  twirl: { id: "twirl", name: "Twirl", category: "Distort" },
  pinch: { id: "pinch", name: "Pinch", category: "Distort" },
  spherize: { id: "spherize", name: "Spherize", category: "Distort" },
  wave: { id: "wave", name: "Wave", category: "Distort" },
  ripple: { id: "ripple", name: "Ripple", category: "Distort" },
  zigzag: { id: "zigzag", name: "ZigZag", category: "Distort" },
  "polar-coordinates": { id: "polar-coordinates", name: "Polar Coordinates", category: "Distort" },
  glass: { id: "glass", name: "Glass", category: "Distort" },
  "lens-correction": { id: "lens-correction", name: "Lens Correction", category: "Distort" },

  // Render
  flame: { id: "flame", name: "Flame", category: "Render" },
  "picture-frame": { id: "picture-frame", name: "Picture Frame", category: "Render" },
  tree: { id: "tree", name: "Tree", category: "Render" },
  clouds: { id: "clouds", name: "Clouds", category: "Render" },
  "difference-clouds": { id: "difference-clouds", name: "Difference Clouds", category: "Render" },
  fibers: { id: "fibers", name: "Fibers", category: "Render" },
  "lens-flare": { id: "lens-flare", name: "Lens Flare", category: "Render" },
  "lighting-effects": { id: "lighting-effects", name: "Lighting Effects", category: "Render" },

  // Other
  "high-pass": { id: "high-pass", name: "High Pass", category: "Other" },
  offset: { id: "offset", name: "Offset", category: "Other" },
  maximum: { id: "maximum", name: "Maximum", category: "Other" },
  minimum: { id: "minimum", name: "Minimum", category: "Other" },
  "custom-convolution": { id: "custom-convolution", name: "Custom Convolution", category: "Other" },

  // Pixelate
  "color-halftone": { id: "color-halftone", name: "Color Halftone", category: "Pixelate" },
  mezzotint: { id: "mezzotint", name: "Mezzotint", category: "Pixelate" },

  // Video
  "de-interlace": { id: "de-interlace", name: "De-Interlace", category: "Video" },
  "ntsc-colors": { id: "ntsc-colors", name: "NTSC Colors", category: "Video" },

  // Artistic (legacy gallery + promoted)
  "colored-pencil": { id: "colored-pencil", name: "Colored Pencil", category: "Artistic" },
  cutout: { id: "cutout", name: "Cutout", category: "Artistic" },
  "dry-brush": { id: "dry-brush", name: "Dry Brush", category: "Artistic" },
  "film-grain": { id: "film-grain", name: "Film Grain", category: "Artistic" },
  fresco: { id: "fresco", name: "Fresco", category: "Artistic" },
  "neon-glow": { id: "neon-glow", name: "Neon Glow", category: "Artistic" },
  "paint-daubs": { id: "paint-daubs", name: "Paint Daubs", category: "Artistic" },
  "palette-knife": { id: "palette-knife", name: "Palette Knife", category: "Artistic" },
  "plastic-wrap": { id: "plastic-wrap", name: "Plastic Wrap", category: "Artistic" },
  "poster-edges": { id: "poster-edges", name: "Poster Edges", category: "Artistic" },
  "rough-pastels": { id: "rough-pastels", name: "Rough Pastels", category: "Artistic" },
  "smudge-stick": { id: "smudge-stick", name: "Smudge Stick", category: "Artistic" },
  "sponge-filter": { id: "sponge-filter", name: "Sponge", category: "Artistic" },
  underpainting: { id: "underpainting", name: "Underpainting", category: "Artistic" },
  watercolor: { id: "watercolor", name: "Watercolor", category: "Artistic" },

  // Brush Strokes
  "accented-edges": { id: "accented-edges", name: "Accented Edges", category: "Brush Strokes" },
  "angled-strokes": { id: "angled-strokes", name: "Angled Strokes", category: "Brush Strokes" },
  crosshatch: { id: "crosshatch", name: "Crosshatch", category: "Brush Strokes" },
  "dark-strokes": { id: "dark-strokes", name: "Dark Strokes", category: "Brush Strokes" },
  "ink-outlines": { id: "ink-outlines", name: "Ink Outlines", category: "Brush Strokes" },
  spatter: { id: "spatter", name: "Spatter", category: "Brush Strokes" },
  "sprayed-strokes": { id: "sprayed-strokes", name: "Sprayed Strokes", category: "Brush Strokes" },
  "sumi-e": { id: "sumi-e", name: "Sumi-e", category: "Brush Strokes" },

  // Sketch
  "bas-relief": { id: "bas-relief", name: "Bas Relief", category: "Sketch" },
  "chalk-charcoal": { id: "chalk-charcoal", name: "Chalk & Charcoal", category: "Sketch" },
  charcoal: { id: "charcoal", name: "Charcoal", category: "Sketch" },
  chrome: { id: "chrome", name: "Chrome", category: "Sketch" },
  "conte-crayon": { id: "conte-crayon", name: "Conte Crayon", category: "Sketch" },
  "graphic-pen": { id: "graphic-pen", name: "Graphic Pen", category: "Sketch" },
  "halftone-pattern": { id: "halftone-pattern", name: "Halftone Pattern", category: "Sketch" },
  "note-paper": { id: "note-paper", name: "Note Paper", category: "Sketch" },
  photocopy: { id: "photocopy", name: "Photocopy", category: "Sketch" },
  plaster: { id: "plaster", name: "Plaster", category: "Sketch" },
  reticulation: { id: "reticulation", name: "Reticulation", category: "Sketch" },
  "stamp-filter": { id: "stamp-filter", name: "Stamp", category: "Sketch" },
  "torn-edges": { id: "torn-edges", name: "Torn Edges", category: "Sketch" },
  "water-paper": { id: "water-paper", name: "Water Paper", category: "Sketch" },

  // Texture
  craquelure: { id: "craquelure", name: "Craquelure", category: "Texture" },
  grain: { id: "grain", name: "Grain", category: "Texture" },
  "mosaic-tiles": { id: "mosaic-tiles", name: "Mosaic Tiles", category: "Texture" },
  patchwork: { id: "patchwork", name: "Patchwork", category: "Texture" },
  "stained-glass": { id: "stained-glass", name: "Stained Glass", category: "Texture" },
  texturizer: { id: "texturizer", name: "Texturizer", category: "Texture" },
}

export function getFilterMeta(id: string): FilterMeta | undefined {
  return FILTER_META[id]
}

export function getFilterName(id: string): string {
  return FILTER_META[id]?.name ?? id
}
