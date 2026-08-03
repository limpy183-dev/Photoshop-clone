export {
  DEFAULT_VARIABLE_AXIS_DEFINITIONS,
  listStylisticSetKeys,
} from "@/editor/typography-engine-types"

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
} from "@/editor/typography-engine-types"

export {
  collectEmbeddedTypographyFonts,
  createEmbeddedFontFromBuffer,
  embeddedFontToArrayBuffer,
  findEmbeddedFontForFamily,
  isTypographyEmbeddedFont,
} from "@/editor/typography-engine/embedded-fonts"

export {
  applyVariableFontNamedInstance,
  normalizeVariableAxes,
  serializeVariableAxes,
} from "@/editor/typography-engine/variable-axes"

export {
  buildOpenTypeFeatureSettings,
  detectOpenTypeFeatureSupport,
  listOpenTypeFeatureToggles,
} from "@/editor/typography-engine/opentype-features"

export {
  buildCanvasFont,
  buildTypographyRenderPlan,
} from "@/editor/typography-engine/render-plan"

export {
  buildFontPreview,
  buildFontSpecimens,
  buildFontSubstitutionComparison,
} from "@/editor/typography-engine/font-previews"

export {
  buildVariableFontAxisControlModel,
  inspectVariableFont,
  parseOpenTypeFontMetadata,
  parseVariableFontMetadata,
} from "@/editor/typography-engine/font-metadata"

export {
  diagnoseDocumentFonts,
  matchFontForLayer,
  matchFontFromImageData,
  resolveFontSubstitutions,
} from "@/editor/typography-engine/font-matching"

export {
  buildFindReplaceHighlights,
  findReplaceTextLayers,
} from "@/editor/typography-engine/find-replace"

export {
  applyTextInsideShape,
  buildTextPathHandleModel,
  deleteTextPathPoint,
  insertTextPathPoint,
  layoutTextOnPath,
  reverseTextPath,
  updateTextPathPoint,
} from "@/editor/typography-engine/text-on-path"

export { convertTextToEditablePath } from "@/editor/typography-engine/text-to-path"

export { createTextExtrusionScene } from "@/editor/typography-engine/text-extrusion"
