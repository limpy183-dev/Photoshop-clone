import { makeCanvas } from "./canvas-utils"
import { uid } from "./uid"
import type { Layer, PathProps, PsDocument } from "./types"

/** Fast deep clone for plain objects/arrays. */
export function deepClonePlain<T>(obj: T): T {
  if (typeof structuredClone === "function") return structuredClone(obj)
  return JSON.parse(JSON.stringify(obj))
}

export function cloneCanvas(src: HTMLCanvasElement | null | undefined): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null
  if (!src || typeof src.getContext !== "function") return null
  const c = document.createElement("canvas")
  c.width = src.width
  c.height = src.height
  const ctx = c.getContext("2d")!
  const isNativeCanvas = typeof HTMLCanvasElement !== "undefined" && src instanceof HTMLCanvasElement
  if (isNativeCanvas || src.width <= 0 || src.height <= 0) {
    ctx.drawImage(src, 0, 0)
  } else {
    const srcCtx = src.getContext("2d")
    if (!srcCtx) return null
    ctx.putImageData(srcCtx.getImageData(0, 0, src.width, src.height), 0, 0)
  }
  return c
}

const alphaBoundsCache = new WeakMap<HTMLCanvasElement, { x: number; y: number; w: number; h: number } | null>()

export function alphaBounds(canvas: HTMLCanvasElement) {
  const cached = alphaBoundsCache.get(canvas)
  if (cached !== undefined) return cached
  const ctx = canvas.getContext?.("2d")
  if (!ctx) return null
  const w = canvas.width
  const h = canvas.height
  const img = ctx.getImageData(0, 0, w, h)
  let minX = w
  let minY = h
  let maxX = 0
  let maxY = 0
  let any = false
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (img.data[(y * w + x) * 4 + 3] > 8) {
        any = true
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  const result = any ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null
  alphaBoundsCache.set(canvas, result)
  return result
}

function translatePath(path: PathProps | null | undefined, dx: number, dy: number): PathProps | null | undefined {
  if (!path) return path
  return {
    ...path,
    points: path.points.map((point) => ({
      ...point,
      x: point.x + dx,
      y: point.y + dy,
      cp1: point.cp1 ? { x: point.cp1.x + dx, y: point.cp1.y + dy } : undefined,
      cp2: point.cp2 ? { x: point.cp2.x + dx, y: point.cp2.y + dy } : undefined,
    })),
  }
}

function cloneLayerExtras(layer: Layer) {
  return {
    threeD: layer.threeD ? deepClonePlain(layer.threeD) : undefined,
    video: layer.video ? deepClonePlain(layer.video) : undefined,
    smartFilters: cloneSmartFilters(layer.smartFilters),
    smartSource: cloneSmartSource(layer.smartSource),
    notes: layer.notes ? deepClonePlain(layer.notes) : undefined,
    metadata: layer.metadata ? deepClonePlain(layer.metadata) : undefined,
  }
}

export function cloneSmartFilters(filters: Layer["smartFilters"]): Layer["smartFilters"] {
  return filters?.map((filter) => ({
    ...filter,
    params: deepClonePlain(filter.params),
    mask: filter.mask ? cloneCanvas(filter.mask) : filter.mask,
  }))
}

function cloneTranslatedSmartFilters(
  filters: Layer["smartFilters"],
  targetWidth: number,
  targetHeight: number,
  dx: number,
  dy: number,
): Layer["smartFilters"] {
  return filters?.map((filter) => {
    const mask = filter.mask ? makeCanvas(targetWidth, targetHeight) : filter.mask
    if (mask && filter.mask) {
      const offsetX = filter.maskLinked === false ? 0 : dx
      const offsetY = filter.maskLinked === false ? 0 : dy
      mask.getContext("2d")!.drawImage(filter.mask, offsetX, offsetY)
    }
    return {
      ...filter,
      params: deepClonePlain(filter.params),
      mask,
    }
  })
}

function cloneSmartSource(source: Layer["smartSource"]): Layer["smartSource"] {
  if (!source) return undefined
  return {
    ...source,
    editPackage: source.editPackage ? deepClonePlain(source.editPackage) : undefined,
    canvas: source.canvas ? cloneCanvas(source.canvas) : source.canvas,
  }
}

export function cloneLayerIntoDocument(
  layer: Layer,
  targetWidth: number,
  targetHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): Layer {
  const bounds = layer.kind === "group" ? null : alphaBounds(layer.canvas)
  const shouldCenter = sourceWidth !== targetWidth || sourceHeight !== targetHeight
  const dx = shouldCenter && bounds ? Math.round(targetWidth / 2 - (bounds.x + bounds.w / 2)) : 0
  const dy = shouldCenter && bounds ? Math.round(targetHeight / 2 - (bounds.y + bounds.h / 2)) : 0
  const canvas = makeCanvas(targetWidth, targetHeight)
  canvas.getContext("2d")!.drawImage(layer.canvas, dx, dy)
  const mask = layer.mask ? makeCanvas(targetWidth, targetHeight) : null
  if (mask && layer.mask) mask.getContext("2d")!.drawImage(layer.mask, dx, dy)
  const frameImage = layer.frame?.imageCanvas ? makeCanvas(targetWidth, targetHeight) : null
  if (frameImage && layer.frame?.imageCanvas) frameImage.getContext("2d")!.drawImage(layer.frame.imageCanvas, dx, dy)

  return {
    ...layer,
    id: uid("layer"),
    name: `${layer.name} copy`,
    locked: false,
    lockAll: false,
    canvas,
    mask,
    maskEnabled: layer.maskEnabled,
    vectorMask: translatePath(layer.vectorMask, dx, dy) ?? null,
    parentId: undefined,
    childIds: undefined,
    linkGroupId: undefined,
    text: layer.text ? { ...deepClonePlain(layer.text), x: layer.text.x + dx, y: layer.text.y + dy } : undefined,
    shape: layer.shape ? { ...layer.shape, x: layer.shape.x + dx, y: layer.shape.y + dy } : undefined,
    path: translatePath(layer.path, dx, dy) ?? undefined,
    frame: layer.frame ? { ...layer.frame, x: layer.frame.x + dx, y: layer.frame.y + dy, imageCanvas: frameImage } : undefined,
    artboard: layer.artboard ? { ...layer.artboard, x: layer.artboard.x + dx, y: layer.artboard.y + dy } : undefined,
    ...cloneLayerExtras(layer),
    smartFilters: cloneTranslatedSmartFilters(layer.smartFilters, targetWidth, targetHeight, dx, dy),
  }
}

function cloneLayerExact(layer: Layer, idMap: Map<string, string>): Layer {
  const nextId = idMap.get(layer.id) ?? uid("layer")
  idMap.set(layer.id, nextId)
  return {
    ...layer,
    id: nextId,
    canvas: cloneCanvas(layer.canvas) ?? makeCanvas(layer.canvas.width, layer.canvas.height),
    mask: layer.mask ? cloneCanvas(layer.mask) : layer.mask,
    maskEnabled: layer.maskEnabled,
    vectorMask: layer.vectorMask ? deepClonePlain(layer.vectorMask) : null,
    childIds: layer.childIds?.map((id) => idMap.get(id) ?? id),
    parentId: layer.parentId ? idMap.get(layer.parentId) : undefined,
    text: layer.text ? deepClonePlain(layer.text) : undefined,
    shape: layer.shape ? { ...layer.shape } : undefined,
    path: layer.path ? deepClonePlain(layer.path) : undefined,
    adjustment: layer.adjustment ? deepClonePlain(layer.adjustment) : undefined,
    frame: layer.frame
      ? { ...layer.frame, imageCanvas: layer.frame.imageCanvas ? cloneCanvas(layer.frame.imageCanvas) : null }
      : undefined,
    artboard: layer.artboard ? { ...layer.artboard } : undefined,
    ...cloneLayerExtras(layer),
  }
}

export function duplicateDocumentDeep(doc: PsDocument): PsDocument {
  const idMap = new Map<string, string>()
  doc.layers.forEach((layer) => idMap.set(layer.id, uid("layer")))
  const layers = doc.layers.map((layer) => cloneLayerExact(layer, idMap))
  const duplicated: PsDocument = {
    ...doc,
    id: uid("doc"),
    name: `${doc.name.replace(/\s+copy(?:\s+\d+)?$/i, "")} copy`,
    layers,
    activeLayerId: idMap.get(doc.activeLayerId) ?? layers[layers.length - 1]?.id ?? "",
    selectedLayerIds: doc.selectedLayerIds.map((id) => idMap.get(id)).filter(Boolean) as string[],
    selection: {
      ...doc.selection,
      mask: doc.selection.mask ? cloneCanvas(doc.selection.mask) : null,
    },
    guides: doc.guides ? deepClonePlain(doc.guides) : undefined,
    notes: doc.notes ? deepClonePlain(doc.notes) : undefined,
    slices: doc.slices ? deepClonePlain(doc.slices) : undefined,
    counts: doc.counts ? deepClonePlain(doc.counts) : undefined,
    colorSamplers: doc.colorSamplers ? deepClonePlain(doc.colorSamplers) : undefined,
    comps: doc.comps ? deepClonePlain(doc.comps) : undefined,
    channels: doc.channels ? doc.channels.map((channel) => ({ ...channel, id: uid("alpha"), canvas: cloneCanvas(channel.canvas) ?? makeCanvas(doc.width, doc.height) })) : undefined,
    quickMaskCanvas: doc.quickMaskCanvas ? cloneCanvas(doc.quickMaskCanvas) : null,
    quickMaskPaintMode: doc.quickMaskPaintMode ?? "auto",
    stylePresets: doc.stylePresets ? deepClonePlain(doc.stylePresets) : undefined,
    gradientPresets: doc.gradientPresets ? deepClonePlain(doc.gradientPresets) : undefined,
    characterStyles: doc.characterStyles ? deepClonePlain(doc.characterStyles) : undefined,
    paragraphStyles: doc.paragraphStyles ? deepClonePlain(doc.paragraphStyles) : undefined,
    assetLibrary: doc.assetLibrary ? deepClonePlain(doc.assetLibrary) : undefined,
    timelineFrames: doc.timelineFrames ? deepClonePlain(doc.timelineFrames) : undefined,
    timelineSettings: doc.timelineSettings ? deepClonePlain(doc.timelineSettings) : undefined,
    plugins: doc.plugins ? deepClonePlain(doc.plugins) : undefined,
    pluginStorage: doc.pluginStorage ? deepClonePlain(doc.pluginStorage) : undefined,
    variableDataSets: doc.variableDataSets ? deepClonePlain(doc.variableDataSets) : undefined,
    modeSettings: doc.modeSettings ? deepClonePlain(doc.modeSettings) : undefined,
    reports: doc.reports ? deepClonePlain(doc.reports) : undefined,
    metadata: doc.metadata ? { ...deepClonePlain(doc.metadata), title: `${doc.metadata.title ?? doc.name} copy`, modifiedAt: new Date().toISOString() } : undefined,
    colorManagement: doc.colorManagement ? deepClonePlain(doc.colorManagement) : undefined,
    printSettings: doc.printSettings ? deepClonePlain(doc.printSettings) : undefined,
    smartObjectParent: undefined,
  }
  if (!duplicated.selectedLayerIds.length && duplicated.activeLayerId) duplicated.selectedLayerIds = [duplicated.activeLayerId]
  return duplicated
}
