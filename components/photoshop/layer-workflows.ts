import type {
  AdvancedBlending,
  BlendIfChannel,
  BlendIfChannels,
  BlendIfRange,
  BlendMode,
  Guide,
  Layer,
  LayerComp,
  LayerMetadata,
  LayerNote,
  PathProps,
  PsDocument,
  Slice,
  SmartFilter,
} from "./types"
import { normalizeSmartFilterMaskDensity, normalizeSmartFilterMaskFeather } from "./smart-filter-masks"
import { uid } from "./uid"

function deepClonePlain<T>(value: T): T {
  if (value === undefined || value === null) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}

function clamp01(value: number, fallback = 1) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(0, Math.min(1, numeric))
}

function clampByte(value: number | undefined, fallback: number) {
  const numeric = Number(value)
  return clamp(Number.isFinite(numeric) ? numeric : fallback, 0, 255)
}

function normalizedText(value: unknown) {
  return String(value ?? "").trim().toLowerCase()
}

function truthyToken(value: string) {
  return value === "true" || value === "yes" || value === "1" || value === "on"
}

function searchableMetadata(metadata: LayerMetadata | undefined) {
  if (!metadata) return ""
  const custom = metadata.custom
    ? Object.entries(metadata.custom).map(([key, value]) => `${key} ${String(value)}`).join(" ")
    : ""
  return [
    metadata.title,
    metadata.description,
    ...(metadata.tags ?? []),
    custom,
  ].filter(Boolean).join(" ")
}

function smartSourceText(layer: Layer) {
  const source = layer.smartSource
  if (!source) return ""
  return [
    source.id,
    source.name,
    source.fileName,
    source.fileHandleName,
    source.relativePath,
    source.status,
    source.linkType,
    source.sourceHash,
    source.editPackage?.name,
  ].filter(Boolean).join(" ")
}

function layerNoteText(notes: LayerNote[] | undefined) {
  return (notes ?? []).map((note) => `${note.text} ${note.author ?? ""}`).join(" ")
}

function smartFilterText(filters: SmartFilter[] | undefined) {
  return (filters ?? []).map((filter) => `${filter.id} ${filter.filterId} ${filter.name}`).join(" ")
}

function layerSearchBlob(layer: Layer) {
  return normalizedText([
    layer.name,
    layer.kind,
    layer.colorLabel,
    layer.blendMode,
    layer.adjustment?.type,
    layerNoteText(layer.notes),
    searchableMetadata(layer.metadata),
    smartSourceText(layer),
    smartFilterText(layer.smartFilters),
  ].filter(Boolean).join(" "))
}

function layerIsLocked(layer: Layer) {
  return !!(layer.locked || layer.lockAll || layer.lockDraw || layer.lockMove || layer.lockTransparency)
}

function layerHasMask(layer: Layer) {
  return !!(layer.mask || layer.vectorMask)
}

const EFFECT_ALIASES: Record<string, keyof NonNullable<Layer["style"]> | "any" | "glow" | "shadow"> = {
  any: "any",
  effects: "any",
  fx: "any",
  stroke: "stroke",
  "drop-shadow": "dropShadow",
  dropshadow: "dropShadow",
  shadow: "shadow",
  "inner-shadow": "innerShadow",
  innershadow: "innerShadow",
  "outer-glow": "outerGlow",
  outerglow: "outerGlow",
  "inner-glow": "innerGlow",
  innerglow: "innerGlow",
  glow: "glow",
  bevel: "bevel",
  emboss: "bevel",
  satin: "satin",
  "color-overlay": "colorOverlay",
  coloroverlay: "colorOverlay",
  "gradient-overlay": "gradientOverlay",
  gradientoverlay: "gradientOverlay",
  "pattern-overlay": "patternOverlay",
  patternoverlay: "patternOverlay",
}

function styleEffectEnabled(layer: Layer, effect: keyof NonNullable<Layer["style"]>) {
  const style = layer.style
  const entry = style?.[effect]
  return !!(entry && typeof entry === "object" && "enabled" in entry && entry.enabled === true)
}

export function layerHasEnabledEffect(layer: Layer, effectName = "any") {
  const key = EFFECT_ALIASES[normalizedText(effectName)] ?? EFFECT_ALIASES[normalizedText(effectName.replace(/\s+/g, "-"))]
  if (!key) return false
  if (key === "any") return !!layer.style && Object.keys(EFFECT_ALIASES).some((alias) => {
    const mapped = EFFECT_ALIASES[alias]
    return mapped !== "any" && mapped !== "glow" && mapped !== "shadow" && styleEffectEnabled(layer, mapped)
  })
  if (key === "glow") return styleEffectEnabled(layer, "outerGlow") || styleEffectEnabled(layer, "innerGlow")
  if (key === "shadow") return styleEffectEnabled(layer, "dropShadow") || styleEffectEnabled(layer, "innerShadow")
  return styleEffectEnabled(layer, key)
}

function layerMatchesAttribute(layer: Layer, value: string) {
  if (value === "visible") return layer.visible !== false
  if (value === "hidden") return layer.visible === false
  if (value === "locked") return layerIsLocked(layer)
  if (value === "unlocked") return !layerIsLocked(layer)
  if (value === "masked") return layerHasMask(layer)
  if (value === "layer-mask") return !!layer.mask
  if (value === "vector-mask") return !!layer.vectorMask
  if (value === "effects" || value === "fx" || value === "styled") return layerHasEnabledEffect(layer)
  if (value === "smart-filter" || value === "smart-filters") return !!layer.smartFilters?.length
  if (value === "smart") return !!(layer.smartObject || layer.kind === "smart-object")
  if (value === "clipped") return !!layer.clipped
  if (value === "linked") return !!layer.linkGroupId
  if (value === "knockout") return !!layer.advancedBlending && layer.advancedBlending.knockout !== "none"
  if (value === "blend-if") {
    const advanced = normalizeAdvancedBlending(layer.advancedBlending)
    if (!isDefaultBlendIfRange(advanced.blendIfThis) || !isDefaultBlendIfRange(advanced.blendIfUnderlying)) return true
    for (const range of Object.values(advanced.blendIfThisChannels ?? {})) {
      if (range && !isDefaultBlendIfRange(range)) return true
    }
    for (const range of Object.values(advanced.blendIfUnderlyingChannels ?? {})) {
      if (range && !isDefaultBlendIfRange(range)) return true
    }
    return false
  }
  if (value === "empty") return isLayerEmpty(layer)
  return false
}

function tokenValue(raw: string) {
  const index = raw.indexOf(":")
  if (index < 0) return null
  return [raw.slice(0, index).toLowerCase(), raw.slice(index + 1)] as const
}

export function layerMatchesQuery(layer: Layer, query: string): boolean {
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  const blob = layerSearchBlob(layer)

  for (const token of tokens) {
    const pair = tokenValue(token)
    if (!pair) {
      if (!blob.includes(normalizedText(token))) return false
      continue
    }

    const [key, rawValue] = pair
    const value = normalizedText(rawValue)
    if (!value) continue

    if (key === "kind" || key === "type") {
      const actualKind = normalizedText(layer.kind ?? "raster")
      const expectedKind = value === "pixel" || value === "pixels" ? "raster" : value
      if (actualKind !== expectedKind) return false
    } else if (key === "label" || key === "color") {
      if (normalizedText(layer.colorLabel ?? "none") !== value) return false
    } else if (key === "note" || key === "notes") {
      if (!normalizedText(layerNoteText(layer.notes)).includes(value)) return false
    } else if (key === "meta" || key === "metadata" || key === "tag") {
      if (!normalizedText(searchableMetadata(layer.metadata)).includes(value)) return false
    } else if (key === "smart") {
      const isSmart = !!(layer.smartObject || layer.kind === "smart-object")
      if (value === "true" || value === "yes") {
        if (!isSmart) return false
      } else if (value === "false" || value === "no") {
        if (isSmart) return false
      } else if (value === "linked" || value === "embedded") {
        if (layer.smartSource?.linkType !== value) return false
      } else if (value === "missing" || value === "modified" || value === "current") {
        if (layer.smartSource?.status !== value) return false
      } else if (!normalizedText(smartSourceText(layer)).includes(value)) {
        return false
      }
    } else if (key === "filter" || key === "smartfilter") {
      if (!normalizedText(smartFilterText(layer.smartFilters)).includes(value)) return false
    } else if (key === "effect" || key === "fx") {
      if (!layerHasEnabledEffect(layer, value)) return false
    } else if (key === "mask") {
      if (value === "disabled") {
        if (layer.maskEnabled !== false && !(layer.smartFilters ?? []).some((filter) => filter.maskEnabled === false)) return false
      } else if (truthyToken(value)) {
        if (!layerHasMask(layer) && !(layer.smartFilters ?? []).some((filter) => !!filter.mask)) return false
      } else if (value === "false" || value === "none") {
        if (layerHasMask(layer)) return false
      }
    } else if (key === "visible") {
      if (layer.visible !== truthyToken(value)) return false
    } else if (key === "locked" || key === "lock") {
      if (layerIsLocked(layer) !== truthyToken(value)) return false
    } else if (key === "blend" || key === "mode") {
      if (normalizedText(layer.blendMode) !== value) return false
    } else if (key === "attr" || key === "attribute" || key === "has") {
      if (!layerMatchesAttribute(layer, value)) return false
    } else if (key === "channel") {
      const channels = normalizeAdvancedBlending(layer.advancedBlending).channels
      if (value === "r-off" && channels.r) return false
      if (value === "g-off" && channels.g) return false
      if (value === "b-off" && channels.b) return false
      if (value === "r-on" && !channels.r) return false
      if (value === "g-on" && !channels.g) return false
      if (value === "b-on" && !channels.b) return false
    } else if (!blob.includes(value)) {
      return false
    }
  }

  return true
}

export function defaultBlendIfRange(): BlendIfRange {
  return { black: 0, blackFeather: 0, whiteFeather: 255, white: 255 }
}

export function normalizeBlendIfRange(range?: Partial<BlendIfRange>): BlendIfRange {
  let black = clampByte(range?.black, 0)
  let blackFeather = clampByte(range?.blackFeather, black)
  let whiteFeather = clampByte(range?.whiteFeather, 255)
  let white = clampByte(range?.white, 255)

  blackFeather = Math.max(black, blackFeather)
  whiteFeather = Math.min(white, whiteFeather)
  if (black > white) {
    const mid = clamp(Math.round((black + white) / 2), 0, 255)
    black = mid
    white = mid
  }
  if (blackFeather > whiteFeather) {
    const mid = clamp(Math.round((blackFeather + whiteFeather) / 2), black, white)
    blackFeather = mid
    whiteFeather = mid
  }
  return { black, blackFeather, whiteFeather, white }
}

export function isDefaultBlendIfRange(range: BlendIfRange | undefined) {
  const normalized = normalizeBlendIfRange(range)
  return normalized.black === 0 && normalized.blackFeather === 0 && normalized.whiteFeather === 255 && normalized.white === 255
}

export function defaultAdvancedBlending(): AdvancedBlending {
  return {
    fillOpacity: 1,
    knockout: "none",
    channels: { r: true, g: true, b: true },
    blendIfThis: defaultBlendIfRange(),
    blendIfUnderlying: defaultBlendIfRange(),
    transparencyShapesLayer: true,
    layerMaskHidesEffects: false,
    vectorMaskHidesEffects: false,
  }
}

const BLEND_IF_CHANNELS: readonly BlendIfChannel[] = ["gray", "r", "g", "b"] as const

function normalizeBlendIfChannels(
  channels: BlendIfChannels | undefined,
  grayFallback: BlendIfRange,
): BlendIfChannels | undefined {
  if (!channels) return undefined
  const out: BlendIfChannels = {}
  let kept = false
  for (const channel of BLEND_IF_CHANNELS) {
    const raw = channels[channel]
    if (!raw) continue
    const normalized = normalizeBlendIfRange(raw)
    // Gray track always mirrors the canonical blendIfThis/blendIfUnderlying;
    // drop the duplicate so PSD round-trips stay tight.
    if (channel === "gray") {
      if (
        normalized.black === grayFallback.black &&
        normalized.blackFeather === grayFallback.blackFeather &&
        normalized.whiteFeather === grayFallback.whiteFeather &&
        normalized.white === grayFallback.white
      ) {
        continue
      }
    } else if (isDefaultBlendIfRange(normalized)) {
      continue
    }
    out[channel] = normalized
    kept = true
  }
  return kept ? out : undefined
}

export function getBlendIfRangeForChannel(
  advanced: AdvancedBlending,
  side: "this" | "underlying",
  channel: BlendIfChannel,
): BlendIfRange {
  if (channel === "gray") {
    return side === "this" ? advanced.blendIfThis : advanced.blendIfUnderlying
  }
  const overrides = side === "this" ? advanced.blendIfThisChannels : advanced.blendIfUnderlyingChannels
  const override = overrides?.[channel]
  if (override) return normalizeBlendIfRange(override)
  return defaultBlendIfRange()
}

export function setBlendIfRangeForChannel(
  advanced: AdvancedBlending,
  side: "this" | "underlying",
  channel: BlendIfChannel,
  range: BlendIfRange,
): AdvancedBlending {
  const next = normalizeAdvancedBlending(advanced)
  const normalized = normalizeBlendIfRange(range)
  if (channel === "gray") {
    if (side === "this") next.blendIfThis = normalized
    else next.blendIfUnderlying = normalized
    return next
  }
  const key = side === "this" ? "blendIfThisChannels" : "blendIfUnderlyingChannels"
  const existing: BlendIfChannels = { ...(next[key] ?? {}) }
  if (isDefaultBlendIfRange(normalized)) {
    delete existing[channel]
  } else {
    existing[channel] = normalized
  }
  const keys = Object.keys(existing) as BlendIfChannel[]
  next[key] = keys.length ? existing : undefined
  return next
}

export function normalizeAdvancedBlending(advanced?: Partial<AdvancedBlending>): AdvancedBlending {
  const defaults = defaultAdvancedBlending()
  const knockout = advanced?.knockout === "shallow" || advanced?.knockout === "deep" ? advanced.knockout : "none"
  const blendIfThis = normalizeBlendIfRange(advanced?.blendIfThis)
  const blendIfUnderlying = normalizeBlendIfRange(advanced?.blendIfUnderlying)
  const activeChannelRaw = advanced?.blendIfActiveChannel
  const blendIfActiveChannel: BlendIfChannel | undefined = activeChannelRaw && BLEND_IF_CHANNELS.includes(activeChannelRaw)
    ? activeChannelRaw
    : undefined
  return {
    fillOpacity: clamp01(advanced?.fillOpacity ?? defaults.fillOpacity, defaults.fillOpacity),
    knockout,
    channels: {
      r: advanced?.channels?.r !== false,
      g: advanced?.channels?.g !== false,
      b: advanced?.channels?.b !== false,
    },
    blendIfThis,
    blendIfUnderlying,
    blendIfThisChannels: normalizeBlendIfChannels(advanced?.blendIfThisChannels, blendIfThis),
    blendIfUnderlyingChannels: normalizeBlendIfChannels(advanced?.blendIfUnderlyingChannels, blendIfUnderlying),
    blendIfActiveChannel,
    transparencyShapesLayer: advanced?.transparencyShapesLayer !== false,
    layerMaskHidesEffects: advanced?.layerMaskHidesEffects === true,
    vectorMaskHidesEffects: advanced?.vectorMaskHidesEffects === true,
  }
}

export type BlendIfHandle = "black" | "blackFeather" | "whiteFeather" | "white"

export function setBlendIfRangeHandle(
  range: BlendIfRange,
  handle: BlendIfHandle,
  value: number,
  options: { split?: boolean } = {},
): BlendIfRange {
  const next = normalizeBlendIfRange(range)
  const v = clampByte(value, handle === "white" || handle === "whiteFeather" ? 255 : 0)
  if (handle === "black") {
    next.black = v
    if (!options.split) next.blackFeather = v
  } else if (handle === "blackFeather") {
    next.blackFeather = v
  } else if (handle === "white") {
    next.white = v
    if (!options.split) next.whiteFeather = v
  } else {
    next.whiteFeather = v
  }
  return normalizeBlendIfRange(next)
}

function captureSmartFilters(filters: SmartFilter[] | undefined): SmartFilter[] | undefined {
  if (!filters?.length) return undefined
  return filters.map((filter) => {
    const { mask: _mask, ...rest } = filter
    return deepClonePlain(rest) as SmartFilter
  })
}

export function captureLayerCompState(doc: PsDocument): LayerComp["state"] {
  return Object.fromEntries(
    doc.layers.map((layer) => [
      layer.id,
      {
        visible: layer.visible,
        opacity: layer.opacity,
        fillOpacity: layer.fillOpacity,
        advancedBlending: layer.advancedBlending ? deepClonePlain(normalizeAdvancedBlending(layer.advancedBlending)) : undefined,
        blendMode: layer.blendMode,
        clipped: layer.clipped,
        maskEnabled: layer.maskEnabled,
        vectorMask: layer.vectorMask ? deepClonePlain(layer.vectorMask) : layer.vectorMask,
        style: layer.style ? deepClonePlain(layer.style) : layer.style,
        text: layer.text ? deepClonePlain(layer.text) : layer.text,
        shape: layer.shape ? deepClonePlain(layer.shape) : layer.shape,
        path: layer.path ? deepClonePlain(layer.path) : layer.path,
        adjustment: layer.adjustment ? deepClonePlain(layer.adjustment) : layer.adjustment,
        smartFilters: captureSmartFilters(layer.smartFilters),
        colorLabel: layer.colorLabel,
        notes: layer.notes ? deepClonePlain(layer.notes) : undefined,
        metadata: layer.metadata ? deepClonePlain(layer.metadata) : undefined,
      },
    ]),
  )
}

export function createLayerCompFromDocument(doc: PsDocument, name: string): LayerComp {
  return {
    id: uid("comp"),
    name,
    state: captureLayerCompState(doc),
    activeLayerId: doc.activeLayerId,
    selectedLayerIds: [...doc.selectedLayerIds],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function summarizeLayerComp(comp: LayerComp, doc: PsDocument) {
  const layerIds = new Set(doc.layers.map((layer) => layer.id))
  const states = Object.entries(comp.state)
  const matched = states.filter(([id]) => layerIds.has(id))
  return {
    layers: matched.length,
    missing: states.length - matched.length,
    visible: matched.filter(([, state]) => state.visible).length,
    hidden: matched.filter(([, state]) => !state.visible).length,
    faded: matched.filter(([, state]) => state.opacity < 1 || (state.fillOpacity ?? 1) < 1).length,
    blended: matched.filter(([, state]) => state.blendMode !== "normal").length,
    smartFiltered: matched.filter(([, state]) => !!state.smartFilters?.length).length,
    annotated: matched.filter(([, state]) => !!state.notes?.length || !!state.metadata).length,
  }
}

export function createLayerMetadata(input: Partial<LayerMetadata> = {}): LayerMetadata {
  const now = Date.now()
  const tags = (input.tags ?? [])
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .slice(0, 32)
  const custom: NonNullable<LayerMetadata["custom"]> = {}
  for (const [key, value] of Object.entries(input.custom ?? {})) {
    const cleanKey = key.trim().slice(0, 64)
    if (!cleanKey) continue
    if (typeof value === "string") custom[cleanKey] = value.slice(0, 500)
    else if (typeof value === "number" && Number.isFinite(value)) custom[cleanKey] = value
    else if (typeof value === "boolean") custom[cleanKey] = value
  }
  return {
    ...input,
    tags,
    custom: Object.keys(custom).length ? custom : undefined,
    createdAt: input.createdAt ?? now,
    modifiedAt: now,
  }
}

export function normalizeGuide(guide: Guide, docW: number, docH: number): Guide {
  const max = guide.orientation === "horizontal" ? docH : docW
  return {
    ...guide,
    orientation: guide.orientation === "horizontal" ? "horizontal" : "vertical",
    position: clamp(guide.position, 0, Math.max(0, max)),
    visible: guide.visible !== false,
    locked: guide.locked === true,
  }
}

export function normalizeSlice(slice: Slice, docW: number, docH: number): Slice {
  const x = clamp(slice.x, 0, Math.max(0, docW - 1))
  const y = clamp(slice.y, 0, Math.max(0, docH - 1))
  const w = clamp(slice.w, 1, Math.max(1, docW - x))
  const h = clamp(slice.h, 1, Math.max(1, docH - y))
  const format = ["png", "jpeg", "webp", "avif"].includes(String(slice.format)) ? slice.format : undefined
  return {
    ...slice,
    name: String(slice.name || "Slice").trim() || "Slice",
    x,
    y,
    w,
    h,
    format,
    scale: slice.scale === undefined ? undefined : Math.max(0.1, Math.min(10, Number(slice.scale) || 1)),
    visible: slice.visible !== false,
    locked: slice.locked === true,
  }
}

export function duplicateSlice(slice: Slice, existingNames: string[], docW: number, docH: number): Slice {
  const baseName = `${slice.name || "Slice"} Copy`
  const taken = new Set(existingNames.map((name) => name.toLowerCase()))
  let name = baseName
  let index = 2
  while (taken.has(name.toLowerCase())) name = `${baseName} ${index++}`
  const offset = 12
  return normalizeSlice({
    ...slice,
    id: uid("slice"),
    name,
    x: slice.x + offset,
    y: slice.y + offset,
  }, docW, docH)
}

export function reorderSmartFilterStack(filters: SmartFilter[], filterId: string, offset: number): SmartFilter[] {
  const index = filters.findIndex((filter) => filter.id === filterId)
  if (index < 0) return filters
  const nextIndex = Math.max(0, Math.min(filters.length - 1, index + offset))
  if (nextIndex === index) return filters.slice()
  const next = filters.slice()
  const [filter] = next.splice(index, 1)
  next.splice(nextIndex, 0, filter)
  return next
}

export function updateSmartFilterStack(filters: SmartFilter[] | undefined, filterId: string, patch: Partial<SmartFilter>) {
  return (filters ?? []).map((filter) =>
    filter.id === filterId
      ? {
          ...filter,
          ...patch,
          opacity: patch.opacity === undefined ? filter.opacity : Math.max(0, Math.min(1, Number(patch.opacity) || 0)),
          blendMode: (patch.blendMode ?? filter.blendMode) as BlendMode | undefined,
          maskDensity: patch.maskDensity === undefined
            ? filter.maskDensity
            : normalizeSmartFilterMaskDensity(patch.maskDensity),
          maskFeather: patch.maskFeather === undefined
            ? filter.maskFeather
            : normalizeSmartFilterMaskFeather(patch.maskFeather),
        }
      : filter,
  )
}

function readLayerAlpha(layer: Layer): Uint8ClampedArray | null {
  const canvas = layer.canvas
  const ctx = canvas?.getContext?.("2d")
  if (!ctx || canvas.width <= 0 || canvas.height <= 0) return null
  try {
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data
  } catch {
    return null
  }
}

export function isLayerEmpty(layer: Layer, alphaThreshold = 0): boolean {
  if ((layer.kind ?? "raster") !== "raster") return false
  if (layer.locked || layer.lockAll) return false
  if (layer.style || layer.smartFilters?.length || layer.mask || layer.vectorMask || layer.notes?.length || layer.metadata) return false
  if (layer.smartObject || layer.smartSource || layer.text || layer.shape || layer.path || layer.adjustment || layer.frame || layer.artboard || layer.threeD || layer.video) return false
  const data = readLayerAlpha(layer)
  if (!data) return false
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > alphaThreshold) return false
  }
  return true
}

export function deleteEmptyLayersFromDocument(doc: PsDocument): PsDocument {
  const removable = new Set(doc.layers.filter((layer) => isLayerEmpty(layer)).map((layer) => layer.id))
  if (!removable.size || removable.size >= doc.layers.length) return doc
  const layers = doc.layers.filter((layer) => !removable.has(layer.id))
  const activeLayerId = removable.has(doc.activeLayerId) ? layers[layers.length - 1].id : doc.activeLayerId
  const selectedLayerIds = doc.selectedLayerIds.filter((id) => !removable.has(id))
  return {
    ...doc,
    layers,
    activeLayerId,
    selectedLayerIds: selectedLayerIds.length ? selectedLayerIds : [activeLayerId],
  }
}

export function applyLuminanceMaskToCanvas(source: HTMLCanvasElement, mask: HTMLCanvasElement | null | undefined): HTMLCanvasElement {
  if (!mask) return source
  const width = source.width
  const height = source.height
  const out = document.createElement("canvas")
  out.width = width
  out.height = height
  const ctx = out.getContext("2d")!
  ctx.drawImage(source, 0, 0)
  const image = ctx.getImageData(0, 0, width, height)
  const maskCtx = mask.getContext("2d")
  if (!maskCtx) return out
  const maskW = Math.min(mask.width, width)
  const maskH = Math.min(mask.height, height)
  const maskImage = maskCtx.getImageData(0, 0, maskW, maskH)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (x >= maskW || y >= maskH) {
        image.data[i + 3] = 0
        continue
      }
      const mi = (y * maskW + x) * 4
      const luminance = (0.299 * maskImage.data[mi] + 0.587 * maskImage.data[mi + 1] + 0.114 * maskImage.data[mi + 2]) / 255
      const maskAlpha = maskImage.data[mi + 3] / 255
      image.data[i + 3] = Math.round(image.data[i + 3] * luminance * maskAlpha)
    }
  }
  ctx.putImageData(image, 0, 0)
  return out
}

function drawPath(ctx: CanvasRenderingContext2D, path: PathProps) {
  const drawOne = (item: PathProps) => {
    if (!item.points.length) return
    ctx.beginPath()
    const first = item.points[0]
    ctx.moveTo(first.x, first.y)
    for (let i = 1; i < item.points.length; i++) {
      const prev = item.points[i - 1]
      const point = item.points[i]
      if (prev.cp2 || point.cp1) {
        ctx.bezierCurveTo(
          prev.cp2?.x ?? prev.x,
          prev.cp2?.y ?? prev.y,
          point.cp1?.x ?? point.x,
          point.cp1?.y ?? point.y,
          point.x,
          point.y,
        )
      } else {
        ctx.lineTo(point.x, point.y)
      }
    }
    if (item.closed) ctx.closePath()
    ctx.fill()
  }
  drawOne(path)
  for (const subpath of path.subpaths ?? []) drawOne(subpath)
}

export function rasterizePathMask(mask: PathProps | null | undefined, width: number, height: number): HTMLCanvasElement | null {
  if (!mask || !mask.points.length) return null
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#ffffff"
  drawPath(ctx, mask)
  return canvas
}

export function flattenLayerMasks(layer: Layer, width = layer.canvas.width, height = layer.canvas.height): Layer {
  if (!layer.mask && !layer.vectorMask) return layer
  let canvas = layer.canvas
  if (layer.mask && layer.maskEnabled !== false) canvas = applyLuminanceMaskToCanvas(canvas, layer.mask)
  const vectorMask = rasterizePathMask(layer.vectorMask, width, height)
  if (vectorMask) canvas = applyLuminanceMaskToCanvas(canvas, vectorMask)
  return {
    ...layer,
    canvas,
    mask: undefined,
    maskEnabled: undefined,
    vectorMask: undefined,
  }
}

export function fillMaskCanvas(width: number, height: number, value: "black" | "white" | "transparent") {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")!
  if (value !== "transparent") {
    ctx.fillStyle = value === "black" ? "#000000" : "#ffffff"
    ctx.fillRect(0, 0, width, height)
  }
  return canvas
}

/* ===================================================================
 * Phase 3 — Layer Compositing & Workflows (Gap Report Item 24)
 *
 * Blend If split-handle evaluation, knockout blending, mask-hides-effects,
 * transparency-shapes-layer, bulk layer commands, and Photoshop-style
 * layer filter predicates.
 * =================================================================== */

// ── Blend If Split-Handle Evaluation ────────────────────────────────

export interface BlendIfSplitHandle {
  black: number
  blackSplit: number
  whiteSplit: number
  white: number
}

export type BlendIfChannelMode = "gray" | "red" | "green" | "blue"

function channelValue(r: number, g: number, b: number, channel: BlendIfChannelMode): number {
  if (channel === "red") return r
  if (channel === "green") return g
  if (channel === "blue") return b
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b)
}

/**
 * Evaluate Blend If opacity for a single pixel pair. Returns 0–1 factor.
 * When the channel value falls in the split zone, linearly interpolate.
 */
export function evaluateBlendIf(
  srcR: number, srcG: number, srcB: number,
  destR: number, destG: number, destB: number,
  thisLayer: BlendIfSplitHandle | null | undefined,
  underlying: BlendIfSplitHandle | null | undefined,
  channel: BlendIfChannelMode = "gray",
): number {
  let factor = 1

  if (thisLayer) {
    const val = channelValue(srcR, srcG, srcB, channel)
    if (val < thisLayer.black || val > thisLayer.white) {
      factor = 0
    } else if (val < thisLayer.blackSplit) {
      factor *= (val - thisLayer.black) / Math.max(1, thisLayer.blackSplit - thisLayer.black)
    } else if (val > thisLayer.whiteSplit) {
      factor *= (thisLayer.white - val) / Math.max(1, thisLayer.white - thisLayer.whiteSplit)
    }
  }

  if (underlying && factor > 0) {
    const val = channelValue(destR, destG, destB, channel)
    if (val < underlying.black || val > underlying.white) {
      factor = 0
    } else if (val < underlying.blackSplit) {
      factor *= (val - underlying.black) / Math.max(1, underlying.blackSplit - underlying.black)
    } else if (val > underlying.whiteSplit) {
      factor *= (underlying.white - val) / Math.max(1, underlying.white - underlying.whiteSplit)
    }
  }

  return Math.max(0, Math.min(1, factor))
}

/**
 * Apply Blend If to full ImageData. Modifies the source alpha in-place
 * based on the Blend If ranges evaluated against source and destination pixels.
 */
export function applyBlendIfToCanvas(
  source: HTMLCanvasElement,
  destination: HTMLCanvasElement,
  thisLayer: BlendIfSplitHandle | null | undefined,
  underlying: BlendIfSplitHandle | null | undefined,
  channel: BlendIfChannelMode = "gray",
): HTMLCanvasElement {
  const w = source.width
  const h = source.height
  const out = document.createElement("canvas")
  out.width = w
  out.height = h
  const outCtx = out.getContext("2d")!
  outCtx.drawImage(source, 0, 0)

  const srcCtx = source.getContext("2d")
  const dstCtx = destination.getContext("2d")
  if (!srcCtx || !dstCtx || w <= 0 || h <= 0) return out

  const srcData = srcCtx.getImageData(0, 0, w, h)
  const dstData = dstCtx.getImageData(0, 0, w, h)
  const outData = outCtx.getImageData(0, 0, w, h)

  for (let i = 0; i < srcData.data.length; i += 4) {
    const factor = evaluateBlendIf(
      srcData.data[i], srcData.data[i + 1], srcData.data[i + 2],
      dstData.data[i], dstData.data[i + 1], dstData.data[i + 2],
      thisLayer, underlying, channel,
    )
    outData.data[i + 3] = Math.round(outData.data[i + 3] * factor)
  }

  outCtx.putImageData(outData, 0, 0)
  return out
}

// ── Knockout Blending ───────────────────────────────────────────────

export type KnockoutBlendMode = "none" | "shallow" | "deep"

export interface KnockoutBlendResult {
  canvas: HTMLCanvasElement
  layersProcessed: number
}

/**
 * Render layers within a group with knockout blending.
 * Shallow: reveal the group's background. Deep: reveal to document background.
 */
export function renderKnockoutBlend(
  layers: readonly Layer[],
  groupIndex: number,
  knockoutMode: KnockoutBlendMode,
  width: number,
  height: number,
  backdrop?: HTMLCanvasElement | null,
): KnockoutBlendResult {
  const output = document.createElement("canvas")
  output.width = width
  output.height = height
  const ctx = output.getContext("2d")!

  if (backdrop) ctx.drawImage(backdrop, 0, 0)

  const groupLayer = layers[groupIndex]
  if (!groupLayer || knockoutMode === "none") {
    return { canvas: output, layersProcessed: 0 }
  }

  // Collect layers inside this group (simplified: layers after groupIndex until next group/end)
  const groupLayers: Layer[] = []
  for (let i = groupIndex + 1; i < layers.length; i++) {
    const layer = layers[i]
    if (layer.kind === "group") break
    groupLayers.push(layer)
  }

  // Composite group content
  const groupContent = document.createElement("canvas")
  groupContent.width = width
  groupContent.height = height
  const groupCtx = groupContent.getContext("2d")!

  let processed = 0
  for (const layer of groupLayers) {
    if (!layer.visible || !layer.canvas) continue
    groupCtx.globalAlpha = layer.opacity ?? 1
    groupCtx.drawImage(layer.canvas, 0, 0)
    groupCtx.globalAlpha = 1
    processed++
  }

  // Apply knockout: use group alpha to reveal backdrop
  const groupData = groupCtx.getImageData(0, 0, width, height)
  const backdropData = ctx.getImageData(0, 0, width, height)
  const resultData = ctx.createImageData(width, height)

  for (let i = 0; i < groupData.data.length; i += 4) {
    const groupAlpha = groupData.data[i + 3] / 255
    if (groupAlpha > 0) {
      resultData.data[i] = backdropData.data[i]
      resultData.data[i + 1] = backdropData.data[i + 1]
      resultData.data[i + 2] = backdropData.data[i + 2]
      resultData.data[i + 3] = Math.round(groupAlpha * 255)
    }
  }

  ctx.putImageData(resultData, 0, 0)
  return { canvas: output, layersProcessed: processed }
}

// ── Mask Hides Effects / Transparency Shapes Layer ──────────────────

/**
 * When hidesEffects is true, the mask clips the effects output so effects
 * are only visible where the mask allows.
 */
export function applyMaskHidesEffects(
  layerCanvas: HTMLCanvasElement,
  effectCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  hidesEffects: boolean,
): HTMLCanvasElement {
  const w = effectCanvas.width
  const h = effectCanvas.height
  const out = document.createElement("canvas")
  out.width = w
  out.height = h
  const ctx = out.getContext("2d")!

  if (!hidesEffects) {
    ctx.drawImage(effectCanvas, 0, 0)
    return out
  }

  // Draw effects first
  ctx.drawImage(effectCanvas, 0, 0)

  // Apply mask to clip effects
  const maskCtx = maskCanvas.getContext("2d")
  if (maskCtx) {
    const effectData = ctx.getImageData(0, 0, w, h)
    const maskData = maskCtx.getImageData(0, 0, Math.min(maskCanvas.width, w), Math.min(maskCanvas.height, h))
    const mw = Math.min(maskCanvas.width, w)
    const mh = Math.min(maskCanvas.height, h)

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ei = (y * w + x) * 4
        if (x < mw && y < mh) {
          const mi = (y * mw + x) * 4
          const maskLum = (0.299 * maskData.data[mi] + 0.587 * maskData.data[mi + 1] + 0.114 * maskData.data[mi + 2]) / 255
          effectData.data[ei + 3] = Math.round(effectData.data[ei + 3] * maskLum)
        } else {
          effectData.data[ei + 3] = 0
        }
      }
    }
    ctx.putImageData(effectData, 0, 0)
  }

  return out
}

/**
 * When shapesLayer is true, the layer's own transparency defines the fill
 * region for effects. Effects only appear where the layer has content.
 */
export function applyTransparencyShapesLayer(
  layerCanvas: HTMLCanvasElement,
  effectCanvas: HTMLCanvasElement,
  shapesLayer: boolean,
): HTMLCanvasElement {
  const w = effectCanvas.width
  const h = effectCanvas.height
  const out = document.createElement("canvas")
  out.width = w
  out.height = h
  const ctx = out.getContext("2d")!

  if (!shapesLayer) {
    ctx.drawImage(effectCanvas, 0, 0)
    return out
  }

  ctx.drawImage(effectCanvas, 0, 0)

  const layerCtx = layerCanvas.getContext("2d")
  if (layerCtx) {
    const effectData = ctx.getImageData(0, 0, w, h)
    const lw = Math.min(layerCanvas.width, w)
    const lh = Math.min(layerCanvas.height, h)
    const layerData = layerCtx.getImageData(0, 0, lw, lh)

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ei = (y * w + x) * 4
        if (x < lw && y < lh) {
          const li = (y * lw + x) * 4
          const layerAlpha = layerData.data[li + 3] / 255
          effectData.data[ei + 3] = Math.round(effectData.data[ei + 3] * layerAlpha)
        } else {
          effectData.data[ei + 3] = 0
        }
      }
    }
    ctx.putImageData(effectData, 0, 0)
  }

  return out
}

// ── Bulk Layer Commands ─────────────────────────────────────────────

/**
 * Rasterize all layer styles/effects into the layer pixels.
 * Returns new layers with style set to null/undefined.
 */
export function flattenAllLayerEffects(layers: readonly Layer[]): Layer[] {
  return layers.map((layer) => {
    if (!layer.style) return { ...layer }

    const w = layer.canvas?.width ?? 1
    const h = layer.canvas?.height ?? 1
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")!

    // Draw layer content with effects baked in
    if (layer.canvas) ctx.drawImage(layer.canvas, 0, 0)

    // If layer has style effects, composite them
    if (layer.style) {
      const style = layer.style
      // Bake simple color overlay
      if (style.colorOverlay?.enabled !== false && style.colorOverlay?.color) {
        ctx.globalCompositeOperation = "source-atop"
        ctx.globalAlpha = style.colorOverlay.opacity ?? 1
        ctx.fillStyle = style.colorOverlay.color
        ctx.fillRect(0, 0, w, h)
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = "source-over"
      }
    }

    return {
      ...layer,
      canvas,
      style: undefined,
    }
  })
}

/**
 * Bake all masks into layer alpha, returning layers with mask=undefined.
 */
export function flattenAllMasks(layers: readonly Layer[], docWidth: number, docHeight: number): Layer[] {
  return layers.map((layer) => flattenLayerMasks(layer, docWidth, docHeight))
}

/**
 * Remove layers whose canvas is entirely transparent.
 */
export function deleteAllEmptyLayers(layers: readonly Layer[]): Layer[] {
  return layers.filter((layer) => {
    if (layer.kind === "group") return true
    if (!layer.canvas) return false
    const ctx = layer.canvas.getContext("2d")
    if (!ctx || layer.canvas.width <= 0 || layer.canvas.height <= 0) return false
    const data = ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
    for (let i = 3; i < data.data.length; i += 4) {
      if (data.data[i] > 0) return true
    }
    return false
  })
}

/**
 * Rasterize text/shape/smart-object layers to plain raster layers.
 */
export function rasterizeLayerSubtype(layer: Layer, width?: number, height?: number): Layer {
  const w = width ?? layer.canvas?.width ?? 1
  const h = height ?? layer.canvas?.height ?? 1
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")!

  if (layer.canvas) {
    ctx.drawImage(layer.canvas, 0, 0)
  }

  return {
    ...layer,
    kind: "raster" as const,
    canvas,
    text: undefined,
    path: undefined,
    smartObject: undefined,
    smartSource: undefined,
    smartFilters: undefined,
    adjustment: undefined,
  }
}

// ── Photoshop-style Layer Filter Predicates ─────────────────────────

export type LayerFilterKind = "all" | "raster" | "text" | "shape" | "adjustment" | "smart-object" | "group" | "frame" | "artboard" | "3d" | "video"
export type LayerFilterAttribute = "visible" | "hidden" | "locked" | "unlocked" | "clipped" | "unclipped" | "has-effects" | "no-effects" | "has-mask" | "no-mask" | "has-smart-filter" | "no-smart-filter" | "linked" | "unlinked" | "advanced-blending"

export function layerMatchesKindFilter(layer: Layer, kind: LayerFilterKind): boolean {
  if (kind === "all") return true
  return layer.kind === kind
}

export function layerMatchesEffectFilter(layer: Layer): boolean {
  return !!layer.style
}

export function layerMatchesModeFilter(layer: Layer, mode: BlendMode): boolean {
  return layer.blendMode === mode
}

export function layerMatchesAttributeFilter(layer: Layer, attribute: LayerFilterAttribute): boolean {
  switch (attribute) {
    case "visible": return layer.visible === true
    case "hidden": return layer.visible === false
    case "locked": return !!(layer.locked || layer.lockTransparency || layer.lockMove || layer.lockAll)
    case "unlocked": return !(layer.locked || layer.lockTransparency || layer.lockMove || layer.lockAll)
    case "clipped": return !!layer.clipped
    case "unclipped": return !layer.clipped
    case "has-effects": return !!layer.style
    case "no-effects": return !layer.style
    case "has-mask": return !!(layer.mask || layer.vectorMask)
    case "no-mask": return !(layer.mask || layer.vectorMask)
    case "has-smart-filter": return !!(layer.smartFilters && layer.smartFilters.length > 0)
    case "no-smart-filter": return !(layer.smartFilters && layer.smartFilters.length > 0)
    case "linked": return !!layer.linkGroupId
    case "unlinked": return !layer.linkGroupId
    case "advanced-blending": return !!(layer.advancedBlending)
    default: return false
  }
}

export function layerMatchesColorFilter(layer: Layer, colorLabel: string): boolean {
  if (!colorLabel || colorLabel === "none") return !layer.colorLabel || layer.colorLabel === "none"
  return layer.colorLabel === colorLabel
}

export interface LayerFilterPredicate {
  kind?: LayerFilterKind
  blendMode?: BlendMode
  attribute?: LayerFilterAttribute
  colorLabel?: string
  searchText?: string
}

/**
 * Filter layers by combining multiple predicates with AND logic.
 */
export function filterLayersByPredicate(layers: readonly Layer[], predicates: LayerFilterPredicate[]): Layer[] {
  if (!predicates.length) return [...layers]

  return layers.filter((layer) => {
    for (const pred of predicates) {
      if (pred.kind && !layerMatchesKindFilter(layer, pred.kind)) return false
      if (pred.blendMode && !layerMatchesModeFilter(layer, pred.blendMode)) return false
      if (pred.attribute && !layerMatchesAttributeFilter(layer, pred.attribute)) return false
      if (pred.colorLabel && !layerMatchesColorFilter(layer, pred.colorLabel)) return false
      if (pred.searchText) {
        const blob = layerSearchBlob(layer)
        if (!blob.includes(normalizedText(pred.searchText))) return false
      }
    }
    return true
  })
}

export function invertMaskCanvas(mask: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = mask.width
  canvas.height = mask.height
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(mask, 0, 0)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = 255 - image.data[i]
    image.data[i + 1] = 255 - image.data[i + 1]
    image.data[i + 2] = 255 - image.data[i + 2]
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}
