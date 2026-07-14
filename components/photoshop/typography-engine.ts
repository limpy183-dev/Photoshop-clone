export {
  DEFAULT_VARIABLE_AXIS_DEFINITIONS,
  listStylisticSetKeys,
} from "./typography-engine-types"

export type {
  FindReplaceHighlightGroup,
  FindReplaceHighlightSegment,
  FindReplaceOptions,
  FindReplaceResult,
  FontCandidate,
  FontDiagnostics,
  FontGeometryMetrics,
  FontPreviewSpec,
  FontSpecimen,
  FontSubstitutionComparison,
  FontSubstitutionResult,
  MatchFontImageResult,
  MatchFontResult,
  OpenTypeFeatureSupport,
  OpenTypeFeatureToggle,
  OpenTypeFontMetadata,
  TextPathGlyphLayout,
  TextPathHandleModel,
  TypographyGlyphRunItem,
  TypographyRenderPlan,
  TypographyShapingPlan,
  VariableFontAxisControl,
  VariableFontAxisControlModel,
  VariableFontInspection,
  VariableFontMetadata,
} from "./typography-engine-types"

export {
  collectEmbeddedTypographyFonts,
  createEmbeddedFontFromBuffer,
  embeddedFontToArrayBuffer,
  findEmbeddedFontForFamily,
  isTypographyEmbeddedFont,
} from "./typography-engine/embedded-fonts"

export {
  applyVariableFontNamedInstance,
  normalizeVariableAxes,
  serializeVariableAxes,
} from "./typography-engine/variable-axes"

export {
  buildOpenTypeFeatureSettings,
  detectOpenTypeFeatureSupport,
  listOpenTypeFeatureToggles,
} from "./typography-engine/opentype-features"

export {
  buildCanvasFont,
  buildTypographyRenderPlan,
} from "./typography-engine/render-plan"

export {
  buildFontPreview,
  buildFontSpecimens,
  buildFontSubstitutionComparison,
} from "./typography-engine/font-previews"

export {
  buildVariableFontAxisControlModel,
  inspectVariableFont,
  parseOpenTypeFontMetadata,
  parseVariableFontMetadata,
} from "./typography-engine/font-metadata"

export {
  diagnoseDocumentFonts,
  matchFontForLayer,
  matchFontFromImageData,
  resolveFontSubstitutions,
} from "./typography-engine/font-matching"

export {
  buildFindReplaceHighlights,
  findReplaceTextLayers,
} from "./typography-engine/find-replace"

export {
  applyTextInsideShape,
  buildTextPathHandleModel,
  deleteTextPathPoint,
  insertTextPathPoint,
  layoutTextOnPath,
  reverseTextPath,
  updateTextPathPoint,
} from "./typography-engine/text-on-path"

export { convertTextToEditablePath } from "./typography-engine/text-to-path"

export { createTextExtrusionScene } from "./typography-engine/text-extrusion"
