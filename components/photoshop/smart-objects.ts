import type { Layer, PsDocument, SmartFilter, SmartObjectSource } from "./types"

function uid(prefix = "smart") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

function cloneCanvas(src: HTMLCanvasElement | null | undefined): HTMLCanvasElement | null {
  if (!src || typeof document === "undefined" || typeof src.getContext !== "function") return null
  const canvas = document.createElement("canvas")
  canvas.width = src.width
  canvas.height = src.height
  canvas.getContext("2d")!.drawImage(src, 0, 0)
  return canvas
}

function canvasDataUrl(canvas: HTMLCanvasElement | null | undefined) {
  if (!canvas || typeof canvas.toDataURL !== "function") return null
  return canvas.toDataURL("image/png")
}

export function smartObjectStatus(layer: Pick<Layer, "smartObject" | "kind" | "smartSource">): NonNullable<SmartObjectSource["status"]> {
  if (!layer.smartObject && layer.kind !== "smart-object") return "missing"
  if (!layer.smartSource) return "missing"
  if (layer.smartSource.status) return layer.smartSource.status
  if (layer.smartSource.linkType === "linked" && !layer.smartSource.canvas) return "missing"
  return layer.smartSource.linkType === "embedded" ? "embedded" : "current"
}

export function createSmartObjectSource(
  canvas: HTMLCanvasElement,
  options: Partial<SmartObjectSource> = {},
): SmartObjectSource {
  return {
    id: options.id ?? uid("smart_source"),
    name: options.name ?? options.fileName ?? "Embedded Smart Object",
    linkType: options.linkType ?? "embedded",
    fileName: options.fileName,
    relativePath: options.relativePath,
    status: options.status ?? (options.linkType === "embedded" ? "embedded" : "current"),
    embedded: options.embedded ?? true,
    updatedAt: options.updatedAt ?? Date.now(),
    width: canvas.width,
    height: canvas.height,
    canvas: cloneCanvas(canvas),
  }
}

export function replaceSmartObjectContents(
  layer: Layer,
  sourceCanvas: HTMLCanvasElement,
  options: Partial<SmartObjectSource> = {},
): Layer {
  const canvas = cloneCanvas(layer.canvas) ?? document.createElement("canvas")
  canvas.width = layer.canvas.width
  canvas.height = layer.canvas.height
  const ctx = canvas.getContext("2d")!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height)

  return {
    ...layer,
    kind: "smart-object",
    smartObject: true,
    canvas,
    smartSource: createSmartObjectSource(sourceCanvas, {
      ...layer.smartSource,
      ...options,
      status: options.status ?? "current",
      embedded: options.embedded ?? true,
    }),
  }
}

export function markSmartObjectLinked(
  layer: Layer,
  options: Partial<SmartObjectSource>,
): Layer {
  if (!layer.smartObject && layer.kind !== "smart-object") return layer
  return {
    ...layer,
    kind: "smart-object",
    smartObject: true,
    smartSource: {
      width: layer.smartSource?.width ?? layer.canvas.width,
      height: layer.smartSource?.height ?? layer.canvas.height,
      canvas: layer.smartSource?.canvas ?? cloneCanvas(layer.canvas),
      ...layer.smartSource,
      ...options,
      id: options.id ?? layer.smartSource?.id ?? uid("smart_source"),
      linkType: "linked",
      status: options.status ?? layer.smartSource?.status ?? "current",
      embedded: options.embedded ?? layer.smartSource?.embedded ?? true,
      updatedAt: options.updatedAt ?? Date.now(),
    },
  }
}

export function exportSmartObjectContents(layer: Layer): { filename: string; dataUrl: string; width: number; height: number } | null {
  if (!layer.smartObject && layer.kind !== "smart-object") return null
  const source = layer.smartSource
  const canvas = source?.canvas ?? layer.canvas
  const dataUrl = canvasDataUrl(canvas)
  if (!dataUrl) return null
  return {
    filename: source?.fileName ?? source?.name ?? `${layer.name || "smart-object"}.png`,
    dataUrl,
    width: source?.width ?? canvas.width,
    height: source?.height ?? canvas.height,
  }
}

function flattenDocumentLayers(doc: PsDocument) {
  const canvas = document.createElement("canvas")
  canvas.width = doc.width
  canvas.height = doc.height
  const ctx = canvas.getContext("2d")!
  for (const layer of doc.layers) {
    if (!layer.visible || layer.kind === "group") continue
    ctx.globalAlpha = layer.opacity ?? 1
    ctx.drawImage(layer.canvas, 0, 0)
  }
  ctx.globalAlpha = 1
  return canvas
}

export function createSmartObjectEditDocument(parent: PsDocument, layer: Layer): PsDocument {
  if (!layer.smartObject && layer.kind !== "smart-object") throw new Error("Layer is not a smart object")
  const sourceCanvas = cloneCanvas(layer.smartSource?.canvas ?? layer.canvas) ?? document.createElement("canvas")
  const editLayer: Layer = {
    id: uid("smart_edit_layer"),
    name: layer.smartSource?.name ?? `${layer.name} Contents`,
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    fillOpacity: 1,
    blendMode: "normal",
    canvas: sourceCanvas,
  }
  return {
    id: uid("smart_edit_doc"),
    name: `${layer.name} Contents`,
    width: sourceCanvas.width,
    height: sourceCanvas.height,
    zoom: 1,
    layers: [editLayer],
    activeLayerId: editLayer.id,
    selectedLayerIds: [editLayer.id],
    background: "#ffffff",
    colorMode: parent.colorMode,
    bitDepth: parent.bitDepth,
    selection: { bounds: null, shape: "rect" },
    colorManagement: parent.colorManagement,
    smartObjectParent: { docId: parent.id, layerId: layer.id },
  }
}

export function saveSmartObjectEditDocumentBack(layer: Layer, editDocument: PsDocument, options: Partial<SmartObjectSource> = {}): Layer {
  const flattened = flattenDocumentLayers(editDocument)
  return replaceSmartObjectContents(layer, flattened, {
    ...layer.smartSource,
    ...options,
    name: options.name ?? layer.smartSource?.name ?? editDocument.name,
    status: options.status ?? (layer.smartSource?.linkType === "linked" ? "modified" : "current"),
    updatedAt: Date.now(),
  })
}

export function convertSmartObjectToLayers(layer: Layer): Layer[] {
  if (!layer.smartObject && layer.kind !== "smart-object") return [layer]
  const sourceCanvas = cloneCanvas(layer.smartSource?.canvas ?? layer.canvas) ?? document.createElement("canvas")
  const base: Layer = {
    ...layer,
    id: uid("layer"),
    name: `${layer.name} Contents`,
    kind: "raster",
    smartObject: false,
    smartSource: undefined,
    smartFilters: undefined,
    canvas: sourceCanvas,
  }
  const filterLayers: Layer[] = (layer.smartFilters ?? []).map((filter) => {
    const canvas = document.createElement("canvas")
    canvas.width = layer.canvas.width
    canvas.height = layer.canvas.height
    if (filter.mask) canvas.getContext("2d")!.drawImage(filter.mask, 0, 0)
    return {
      id: uid("layer"),
      name: `Smart Filter - ${filter.name}`,
      kind: "adjustment",
      visible: filter.enabled,
      locked: false,
      opacity: filter.opacity ?? 1,
      fillOpacity: 1,
      blendMode: filter.blendMode ?? "normal",
      canvas,
      adjustment: { type: "color-lookup", params: { sourceFilterId: filter.filterId, ...filter.params } },
    }
  })
  return [base, ...filterLayers]
}

export function reorderSmartFilters(filters: SmartFilter[], filterId: string, offset: number): SmartFilter[] {
  const index = filters.findIndex((filter) => filter.id === filterId)
  if (index < 0) return filters.slice()
  const nextIndex = Math.max(0, Math.min(filters.length - 1, index + offset))
  if (nextIndex === index) return filters.slice()
  const next = filters.slice()
  const [filter] = next.splice(index, 1)
  next.splice(nextIndex, 0, filter)
  return next
}

export type SmartObjectStackMode = "mean" | "median" | "minimum" | "maximum" | "range"

export function applySmartObjectStackMode(images: ImageData[], mode: SmartObjectStackMode): ImageData {
  if (!images.length) throw new Error("Stack mode requires at least one image")
  const width = images[0].width
  const height = images[0].height
  const count = width * height * 4
  const compatible = images.filter((image) => image.width === width && image.height === height)
  if (!compatible.length) throw new Error("No stack images match the first image dimensions")
  const out = new ImageData(width, height)
  const values: number[] = []
  for (let i = 0; i < count; i += 4) {
    for (let c = 0; c < 4; c++) {
      values.length = 0
      for (const image of compatible) values.push(image.data[i + c])
      values.sort((a, b) => a - b)
      const value = mode === "mean"
        ? values.reduce((sum, item) => sum + item, 0) / values.length
        : mode === "median"
          ? values[Math.floor(values.length / 2)]
          : mode === "minimum"
            ? values[0]
            : mode === "maximum"
              ? values[values.length - 1]
              : values[values.length - 1] - values[0]
      out.data[i + c] = c === 3 ? (mode === "range" ? 255 : Math.max(...values)) : Math.round(value)
    }
  }
  return out
}
