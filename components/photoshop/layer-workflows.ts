import type {
  BlendMode,
  Guide,
  Layer,
  LayerComp,
  LayerMetadata,
  LayerNote,
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
      if (normalizedText(layer.kind ?? "raster") !== value) return false
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
    } else if (key === "blend") {
      if (normalizedText(layer.blendMode) !== value) return false
    } else if (!blob.includes(value)) {
      return false
    }
  }

  return true
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
