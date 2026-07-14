import { makeCanvas } from "./canvas-utils"
import { hexToRgb } from "./color-utils"

export { makeCanvas, hexToRgb }
export { floodFillMask, paintBucketFill } from "./tool-helpers/flood-fill"
export { liquifyWarp, perspectiveUnwarp } from "./tool-helpers/perspective-liquify"
export { magneticLassoSnap, magneticLassoTrace } from "./tool-helpers/magnetic-lasso"
export type { MagneticLassoSnapOptions } from "./tool-helpers/magnetic-lasso"

export { rasterizeText } from "./tool-helpers-text"
export { customShapePath, rasterizeShape, strokePath } from "./tool-helpers-shape"
export { snapValue } from "./tool-helpers-shared"

export {
  cloneStamp,
  transformedCloneStamp,
  blurStamp,
  sharpenStamp,
  SmudgeBuffer,
  dodgeBurnStamp,
  spongeStamp,
  healStamp,
} from "./tool-helpers/retouch-stamps"

export {
  buildContentAwareFillPlan,
  contentAwareFill,
  patchSelectionFromSource,
} from "./tool-helpers/content-aware-fill"
export type {
  ContentAwareFillPlan,
  ContentAwareFillPlanOptions,
} from "./tool-helpers/content-aware-fill"

export {
  polygonToMask,
  polygonBounds,
  maskBounds,
  selectionToMaskCanvas,
  selectionFromMask,
  expandSelectionMask,
  contractSelectionMask,
  borderSelectionMask,
  smoothSelectionMask,
  transformSelectionMask,
  colorRangeMask,
  featherMask,
  extractMarchingAntsPaths,
  selectionToPathCandidatesFromMask,
  selectionToPath,
  pathToMask,
  pathToSelectionMask,
} from "./tool-helpers/selection-masks"

export {
  buildSelectionHeuristicMaskData,
  selectSubjectMask,
  selectSkyMask,
  selectBackgroundMask,
  focusAreaMask,
  objectSelectionMask,
  refineEdgeBrushMask,
} from "./tool-helpers/subject-detection"
export type {
  SelectionHeuristicMaskOptions,
  SelectionHeuristicMaskResult,
} from "./tool-helpers/subject-detection"
