/**
 * Public filter registry facade.
 *
 * Filter definitions are split by family under ./registry-definitions; shared
 * helper implementations live in ./registry-helpers.
 */

import type { FilterDef } from "./contracts"
import { adjustmentFilters } from "./registry-definitions/adjustments"
import { blurFilters } from "./registry-definitions/blur"
import { distortionFilters } from "./registry-definitions/distortion"
import { legacyFilters } from "./registry-definitions/legacy"
import { noiseFilters } from "./registry-definitions/noise"
import { otherFilters } from "./registry-definitions/other"
import { pixelateFilters } from "./registry-definitions/pixelate"
import { renderFilters } from "./registry-definitions/render"
import { sharpenFilters } from "./registry-definitions/sharpen"
import { stylizeFilters } from "./registry-definitions/stylize"

export type {
  FilterContext,
  FilterDef,
  FilterParam,
} from "./contracts"
export {
  compositeFilterImageData,
  type FilterCompositeOptions,
} from "./composite"
export {
  AUTO_DEFAULTS,
  HDR_TONING_PRESETS,
  applyAutoAdjustment,
  formatReplaceColorSamples,
  parseReplaceColorSamples,
  type AutoAlgorithm,
  type AutoOptions,
  type HdrToningPreset,
  type ReplaceColorSample,
} from "./adjustment-algorithms"

export const FILTERS: Record<string, FilterDef> = {
  ...blurFilters,
  ...sharpenFilters,
  ...stylizeFilters,
  ...noiseFilters,
  ...adjustmentFilters,
  ...distortionFilters,
  ...renderFilters,
  ...otherFilters,
  ...pixelateFilters,
  ...legacyFilters,
}

export function getFilter(id: string): FilterDef | null {
  return FILTERS[id] ?? null
}
