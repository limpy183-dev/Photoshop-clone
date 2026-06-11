export type FilterParam =
  | { type: "slider"; key: string; label: string; min: number; max: number; step?: number; default: number; suffix?: string }
  | { type: "select"; key: string; label: string; options: { value: string; label: string }[]; default: string }
  | { type: "checkbox"; key: string; label: string; default: boolean }
  | { type: "text"; key: string; label: string; default: string; multiline?: boolean; placeholder?: string; accept?: string }

export interface FilterDef {
  id: string
  name: string
  category: string
  params: FilterParam[]
  apply: (src: ImageData, params: Record<string, number | string | boolean>, context?: FilterContext) => ImageData
}

export interface FilterContext {
  matchColorSource?: ImageData | null
  displacementMap?: ImageData | null
  applyImageSource?: ImageData | null
  calcSourceA?: ImageData | null
  calcSourceB?: ImageData | null
  selectionMask?: Uint8Array | null
  selectionMode?: "image" | "selection-only" | "selection-source"
  lensBlurDepthSource?: ImageData | null
  lightingBumpSource?: ImageData | null
}
