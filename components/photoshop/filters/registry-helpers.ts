/**
 * Pixel-level filter implementations. Each `apply(src, params)` returns a
 * NEW ImageData with the filter applied. Source is not mutated, so callers
 * can use the same ImageData for live previews across many parameter changes.
 *
 * Implementations live in the sibling *-algorithms modules; this file is the
 * stable re-export surface used by the registry definitions.
 */

export {
  blendImageData,
  copySample,
  copySampleWithEdge,
  hashNoise,
  mixBlurredByWeight,
  parseHexColor,
  pixelBlend,
  resampleImageData,
  selectChannelValue,
  type ApplyChannel,
} from "./helpers-shared"

export {
  filterHighPass,
  smartSharpen,
  smartSharpenBlurSource,
  tonalFadeForSmartSharpen,
  type SmartSharpenExtras,
} from "./sharpen-algorithms"

export {
  angleFromPathPoints,
  averageBlur,
  buildIrisOffsets,
  distanceToPolyline,
  extractDepthValue,
  fieldBlur,
  irisBlur,
  lensBlur,
  lensBlurDefault,
  pathBlur,
  radialBlur,
  shapeBlur,
  smartBlur,
  spinBlur,
  surfaceBlur,
  tiltShiftBlur,
  type LensBlurExtras,
} from "./blur-algorithms"

export {
  LENS_CHROMATIC_SHIFT_SCALE,
  LENS_DEFAULT_VIGNETTE_MIDPOINT,
  LENS_MANUAL_DISTORTION_DIVISOR,
  LENS_MANUAL_HIGHER_ORDER_DISTORTION_SCALE,
  LENS_PROFILE_PRESETS,
  defaultLightsForStyle,
  lensCorrection,
  lightingEffects,
  lightingEffectsDefault,
  parseLightsConfig,
  type LensCorrectionExtras,
  type LensProfilePreset,
  type LightConfig,
  type MaterialConfig,
  usesDefaultLightingMaterial,
} from "./lens-lighting-algorithms"

export {
  _deInterlace,
  addProceduralGrain,
  deInterlaceAdvanced,
  despeckle,
  dustAndScratches,
  ntscColors,
  reduceNoise,
} from "./noise-video-algorithms"

export {
  colorHalftone,
  facet,
  fragment,
  mezzotint,
  pointillize,
} from "./pixelate-algorithms"

export {
  diffuse,
  diffuseGlow,
  displace,
  filterMaxMin,
  filterOffset,
  glassDistort,
  oceanRipple,
  shear,
  tilesFilter,
} from "./distort-helper-algorithms"

export {
  PROMOTED_GALLERY_FILTERS,
  coloredPencilFilter,
  craquelureFilter,
  crosshatchFilter,
  dryBrushFilter,
  embossLike,
  extrude,
  galleryStylize,
  glowingEdges,
  graphicPenFilter,
  legacyGalleryDefs,
  mosaicTilesFilter,
  oilPaint,
  pictureFrame,
  posterizeImage,
  promotedGalleryDef,
  renderFlame,
  renderTree,
  watercolorFilter,
  wind,
} from "./stylize-gallery-algorithms"

export {
  applyImageFilter,
  calculationsFilter,
  customConvolution,
  parseKernelMatrix,
} from "./apply-image-algorithms"


// Re-exported building blocks used by registry-definitions modules.
export { hexToRgb as hexToRgbFilter } from "../color-utils"
export { parseFieldBlurPins, parsePathBlurPoints } from "../blur-gallery-controls"
export {
  boxBlur,
  brightnessContrast,
  convolve,
  emboss,
  findEdges,
  gaussianBlur,
  motionBlur,
  noise,
  pixelate,
  sharpen,
  solarize,
  unsharpMask,
} from "./basic-algorithms"
export {
  clamp01,
  clamp8,
  cloneImageData as clone,
  hslToRgb,
  luma,
  numberParam,
  parseBool,
} from "./pixel-helpers"
export { parseCurvePoints, pseudoDither } from "./curve-helpers"
export {
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
} from "./adjustment-algorithms"
export {
  blackWhiteAdvanced,
  colorBalanceAdvanced,
  colorLookup,
  curvesAdvanced,
  gradientMapAdvanced,
  matchColorAdvanced,
  vibranceAdvanced,
} from "./advanced-adjustment-algorithms"
export {
  adaptiveWideAngle,
  bilinearSample,
  distanceToSegment,
  distortPinch,
  distortPolar,
  distortRipple,
  distortSpherize,
  distortTwirl,
  distortWave,
  distortZigZag,
  parseAdaptiveConstraints,
  vanishingPoint,
} from "./distortion-algorithms"
export {
  fbmNoise,
  renderClouds,
  renderFibers,
  renderLensFlare,
  skyReplacement,
} from "./render-algorithms"

export type { FilterDef } from "./contracts"
export type { HueRange } from "./adjustment-algorithms"
