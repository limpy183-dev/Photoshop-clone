/**
 * Public filter registry facade.
 *
 * Filter definitions are split by family under ./registry-definitions; shared
 * helper implementations live in ./registry-helpers.
 */

import type { FilterDef } from "@/editor/filters/contracts"
import { adjustmentFilters } from "@/editor/filters/registry-definitions/adjustments"
import { blurFilters } from "@/editor/filters/registry-definitions/blur"
import { distortionFilters } from "@/editor/filters/registry-definitions/distortion"
import { legacyFilters } from "@/editor/filters/registry-definitions/legacy"
import { noiseFilters } from "@/editor/filters/registry-definitions/noise"
import { otherFilters } from "@/editor/filters/registry-definitions/other"
import { pixelateFilters } from "@/editor/filters/registry-definitions/pixelate"
import { renderFilters } from "@/editor/filters/registry-definitions/render"
import { sharpenFilters } from "@/editor/filters/registry-definitions/sharpen"
import { stylizeFilters } from "@/editor/filters/registry-definitions/stylize"

export type {
  FilterContext,
  FilterDef,
  FilterParam,
} from "@/editor/filters/contracts"
export {
  compositeFilterImageData,
  type FilterCompositeOptions,
} from "@/editor/filters/composite"
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
} from "@/editor/filters/adjustment-algorithms"

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
