export {
  applyIccTransformToImageData,
  buildGamutWarningMaskImageData,
  checkRgbOutOfGamut,
  convertImageDataForExport,
  describeIccProfile,
  iccProfileDeviceKind,
  normalizeIccProfileName,
  parseIccProfile,
  softProofImageData,
  softProofRgbColor,
  supportedIccProfileNames,
  transformRgbColor,
  type GamutWarningResult,
  type IccProfileName,
  type ParsedIccProfile,
  type IccTransformOptions,
  type IccTransformResult,
} from "@/editor/icc-transform"

export {
  cmykToRgb,
  convertColorToRgb,
  convertRgbToColorMode,
  describeColorPipeline,
  describeDocumentColorHonesty,
  grayscaleToRgb,
  labToRgb,
  rgbToCmyk,
  rgbToGrayscale,
  rgbToLab,
} from "@/editor/color/pipeline-conversions"

export type {
  CmykColor,
  CmykConversionOptions,
  ColorHonestySeverity,
  ColorPipelineDescription,
  DocumentColorHonestyInput,
  DocumentColorHonestyItem,
  DocumentColorHonestyReport,
  GrayscaleColor,
  HighBitImage,
  HighBitImageOptions,
  LabColor,
  PipelineBitDepth,
  PipelineColorMode,
  RgbColor,
  RgbConvertedColor,
  RgbConvertibleMode,
} from "@/editor/color/pipeline-conversions"

export {
  applyHighBitAdjustment,
  compareHighBitPixelToPreview,
  createHighBitImageFromImageData,
  readHighBitPixel,
  toneMapHighBitImageToImageData,
  type HighBitAdjustment,
  type HighBitPixelReadout,
  type HighBitPreviewComparison,
  type HighBitToneMapOptions,
} from "@/editor/color/pipeline/high-bit-image"

export {
  computeCanvasHistogram,
  computeHighBitHistogram,
  type HighBitHistogramOptions,
  type HistogramChannels,
  type HistogramResult,
  type HistogramStats,
} from "@/editor/color/pipeline/histograms"

export {
  applyFloatBufferFilter,
  createFloatBufferFromImageData,
  toneMapFloatBufferToImageData,
  type FloatFilterKind,
  type FloatPixelBuffer,
} from "@/editor/color/pipeline/float-buffer"

export {
  diagnoseIccClutCoverage,
  parseIccClutTag,
  parseIccDeviceLinkProfile,
  type IccClutCoverageDiagnostic,
  type IccClutTag,
  type IccDeviceLinkProfile,
} from "@/editor/color/pipeline/icc-device-link"

export {
  generateInkCoverageReport,
  generatePlateView,
  renderGamutWarningOverlay,
  softProofWithChannelToggles,
  type GamutViewOptions,
  type PerChannelProofOptions,
} from "@/editor/color/pipeline/proofing"

export {
  applyFilterToHighBitImage,
  convert8BitToHighBit,
  convertHighBitImageTo8Bit,
  isHighBitFilterNativelySupported,
  type HighBitFilterContext,
} from "@/editor/color/pipeline/high-bit-filters"

export {
  planProfileAssignment,
  planProfileConversion,
  validateProfileForDocument,
  type ProfileAssignment,
  type ProfileAssignmentPlan,
} from "@/editor/color/pipeline/profile-management"
