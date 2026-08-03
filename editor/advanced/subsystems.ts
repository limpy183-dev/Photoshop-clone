export {
  applyModeAndColorManagement,
  convertCanvasToDocumentMode,
} from "@/editor/document/color-management"
export {
  ADVANCED_3D_IMPORT_LIMITS,
  createPrimitiveThreeDScene,
  exportSceneToDae,
  exportSceneToObj,
  parseDaeToScene,
  parseObjToScene,
} from "@/editor/three-d-scene-formats"

export {
  ADVANCED_FILE_LIMITS,
  assertAdvancedFileSize,
  createSubsystemCanvas,
} from "@/editor/advanced/subsystems-shared"

export {
  ADVANCED_FORMAT_CAPABILITIES,
  capabilityForAdvancedFormat,
  inspectAdvancedFormatFile,
  type AdvancedFormatCapability,
  type AdvancedFormatSupport,
} from "@/editor/advanced/subsystems-format-capabilities"

export {
  nudgeSceneVertex,
  renderThreeDScene,
} from "@/editor/advanced/subsystems-three-d"

export {
  buildPrintPreviewCanvas,
  buildPrintPreviewReport,
  type PrintPreviewMark,
  type PrintPreviewReport,
  type PrintPreviewRisk,
} from "@/editor/advanced/subsystems-print"

export { applyPluginFilterToCanvas } from "@/editor/advanced/subsystems-plugins"

export {
  createVariableDocumentVariant,
  createVariableDocumentVariantAsync,
  parseCsv,
  type VariableImageResolver,
} from "@/editor/advanced/subsystems-variables"

export {
  extractEmbeddedJpegDataUrl,
  extractMetadataFromFile,
  makeXmpMetadata,
} from "@/editor/advanced/subsystems-metadata"

export {
  decodeDicomPreview,
  decodeRadianceHdrPreview,
  encodeDicomCompressedImageData,
  encodeDicomImageData,
  encodeRadianceHdrImageData,
  inspectDicomMetadata,
  type DicomCompressedEncodeOptions,
  type DicomMetadataInspection,
  type DicomOverlayAuthoring,
} from "@/editor/advanced/subsystems-medical-hdr"

export {
  decodeEpsPreview,
  decodePdfPages,
  decodePdfPreview,
  encodeEpsCanvas,
  encodePdfCanvas,
  encodePdfCanvases,
  encodePdfDocument,
  extractEpsEditableVectors,
  extractPdfEditableObjects,
  type DecodedPdfPage,
  type EpsEditablePath,
  type EpsEditableText,
  type PdfAnnotationRecord,
  type PdfAuthoringPage,
  type PdfDocumentAuthoringSpec,
  type PdfEditableObjects,
  type PdfTextRun,
  type PdfTransparencyGroupRecord,
  type PdfVectorRecord,
} from "@/editor/advanced/subsystems-pdf-eps"
