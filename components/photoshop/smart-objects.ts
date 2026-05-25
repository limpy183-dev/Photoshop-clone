import type { Layer, PsDocument, SmartFilter, SmartObjectSource } from "./types"
import { uid } from "./uid"

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

export interface LinkedSmartObjectFileSnapshot {
  name?: string
  size?: number
  lastModified?: number
  sourceHash?: string
}

export interface LinkedSmartObjectSyncPlan {
  changed: boolean
  status: NonNullable<SmartObjectSource["status"]>
  reason: "not-linked" | "missing-handle" | "metadata-changed" | "hash-changed" | "unchanged"
}

export interface LinkedSmartObjectSyncOptions {
  hashContents?: boolean
  readCanvas?: (file: File) => Promise<HTMLCanvasElement>
  requestPermission?: boolean
  now?: () => number
}

export interface LinkedSmartObjectSyncResult {
  layer: Layer
  changed: boolean
  status: NonNullable<SmartObjectSource["status"]>
  file?: File
  sourceHash?: string
}

export type LinkedSmartObjectPermission = PermissionState | "unsupported"

export type ReadableSmartObjectFileHandle = FileSystemFileHandle & {
  queryPermission?: (descriptor?: { mode?: "read" }) => Promise<PermissionState>
  requestPermission?: (descriptor?: { mode?: "read" }) => Promise<PermissionState>
}

export interface RelinkSmartObjectOptions extends LinkedSmartObjectSyncOptions {
  relativePath?: string
  embedded?: boolean
}

export interface RelinkSmartObjectResult extends LinkedSmartObjectSyncResult {
  permission: LinkedSmartObjectPermission
}

export function planLinkedSmartObjectSync(
  layer: Pick<Layer, "smartObject" | "kind" | "smartSource">,
  snapshot: LinkedSmartObjectFileSnapshot | null | undefined,
): LinkedSmartObjectSyncPlan {
  const source = layer.smartSource
  if ((!layer.smartObject && layer.kind !== "smart-object") || source?.linkType !== "linked") {
    return { changed: false, status: smartObjectStatus(layer), reason: "not-linked" }
  }
  if (!snapshot) return { changed: true, status: "missing", reason: "missing-handle" }
  const metadataChanged =
    (typeof snapshot.lastModified === "number" && source.lastKnownModified !== snapshot.lastModified) ||
    (typeof snapshot.size === "number" && source.lastKnownSize !== snapshot.size) ||
    (typeof snapshot.name === "string" && source.fileHandleName && source.fileHandleName !== snapshot.name)
  if (snapshot.sourceHash && source.sourceHash && snapshot.sourceHash !== source.sourceHash) {
    return { changed: true, status: "modified", reason: "hash-changed" }
  }
  if (metadataChanged) return { changed: true, status: "modified", reason: "metadata-changed" }
  return { changed: false, status: "current", reason: "unchanged" }
}

async function hashFileFnv1a32(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let hash = 0x811c9dc5
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`
}

export async function resolveLinkedSmartObjectPermission(
  handle: ReadableSmartObjectFileHandle,
  options: { requestPermission?: boolean } = {},
): Promise<LinkedSmartObjectPermission> {
  const descriptor = { mode: "read" as const }
  let current: PermissionState | undefined
  if (typeof handle.queryPermission === "function") {
    try {
      current = await handle.queryPermission(descriptor)
    } catch {
      return "unsupported"
    }
  }
  if (current === "granted" || current === "denied") return current
  if (options.requestPermission !== false && typeof handle.requestPermission === "function") {
    try {
      return await handle.requestPermission(descriptor)
    } catch {
      return current ?? "unsupported"
    }
  }
  return current ?? "unsupported"
}

function markLinkedSmartObjectUnavailable(
  layer: Layer,
  options: Partial<SmartObjectSource>,
): Layer {
  return markSmartObjectLinked(layer, {
    ...options,
    status: "missing",
    updatedAt: options.updatedAt ?? Date.now(),
  })
}

export async function syncLinkedSmartObjectSource(
  layer: Layer,
  options: LinkedSmartObjectSyncOptions = {},
): Promise<LinkedSmartObjectSyncResult> {
  const source = layer.smartSource
  const handle = source?.fileHandle
  if ((!layer.smartObject && layer.kind !== "smart-object") || source?.linkType !== "linked" || !handle) {
    const next = source
      ? markLinkedSmartObjectUnavailable(layer, {
          fileHandleName: source.fileHandleName,
          handlePermission: source.handlePermission ?? "unsupported",
        })
      : layer
    return { layer: next, changed: !!source, status: "missing" }
  }

  const readableHandle = handle as ReadableSmartObjectFileHandle
  const permission = await resolveLinkedSmartObjectPermission(readableHandle, {
    requestPermission: options.requestPermission,
  })
  if (permission === "denied" || permission === "prompt") {
    const next = markLinkedSmartObjectUnavailable(layer, {
      fileHandle: handle,
      fileHandleName: readableHandle.name ?? source.fileHandleName,
      handlePermission: permission,
    })
    return { layer: next, changed: true, status: "missing" }
  }

  const file = await handle.getFile()
  const sourceHash = options.hashContents ? await hashFileFnv1a32(file) : source.sourceHash
  const plan = planLinkedSmartObjectSync(layer, {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    sourceHash,
  })

  if (plan.changed && options.readCanvas) {
    const sourceCanvas = await options.readCanvas(file)
    const next = replaceSmartObjectContents(layer, sourceCanvas, {
      ...source,
      fileName: file.name,
      fileHandle: handle,
      fileHandleName: handle.name ?? file.name,
      handlePermission: permission,
      lastKnownModified: file.lastModified,
      lastKnownSize: file.size,
      sourceHash,
      status: "current",
      linkType: "linked",
      relinkedAt: options.now?.() ?? Date.now(),
    })
    return { layer: next, changed: true, status: "current", file, sourceHash }
  }

  const status = plan.changed ? "modified" : "current"
  const next = markSmartObjectLinked(layer, {
    fileName: source.fileName ?? file.name,
    fileHandle: handle,
    fileHandleName: handle.name ?? file.name,
    handlePermission: permission,
    lastKnownModified: file.lastModified,
    lastKnownSize: file.size,
    sourceHash,
    status,
  })
  return { layer: next, changed: plan.changed, status, file, sourceHash }
}

export async function relinkSmartObjectToFile(
  layer: Layer,
  handle: ReadableSmartObjectFileHandle,
  options: RelinkSmartObjectOptions,
): Promise<RelinkSmartObjectResult> {
  if (!layer.smartObject && layer.kind !== "smart-object") {
    return { layer, changed: false, status: "missing", permission: "unsupported" }
  }
  const permission = await resolveLinkedSmartObjectPermission(handle, {
    requestPermission: options.requestPermission,
  })
  if (permission === "denied" || permission === "prompt") {
    const next = markLinkedSmartObjectUnavailable(layer, {
      fileHandle: handle,
      fileHandleName: handle.name,
      handlePermission: permission,
    })
    return { layer: next, changed: true, status: "missing", permission }
  }
  const file = await handle.getFile()
  const readCanvas = options.readCanvas
  if (!readCanvas) {
    const next = markSmartObjectLinked(layer, {
      ...(layer.smartSource ?? {}),
      fileName: file.name,
      relativePath: options.relativePath ?? file.name,
      fileHandle: handle,
      fileHandleName: handle.name ?? file.name,
      handlePermission: permission,
      lastKnownModified: file.lastModified,
      lastKnownSize: file.size,
      sourceHash: options.hashContents ? await hashFileFnv1a32(file) : layer.smartSource?.sourceHash,
      status: "current",
    })
    return { layer: next, changed: true, status: "current", file, sourceHash: next.smartSource?.sourceHash, permission }
  }
  const sourceCanvas = await readCanvas(file)
  const sourceHash = options.hashContents ? await hashFileFnv1a32(file) : layer.smartSource?.sourceHash
  const now = options.now?.() ?? Date.now()
  const next = replaceSmartObjectContents(layer, sourceCanvas, {
    ...(layer.smartSource ?? {}),
    fileName: file.name,
    relativePath: options.relativePath ?? file.name,
    linkType: "linked",
    embedded: options.embedded ?? false,
    fileHandle: handle,
    fileHandleName: handle.name ?? file.name,
    handlePermission: permission,
    lastKnownModified: file.lastModified,
    lastKnownSize: file.size,
    sourceHash,
    relinkedAt: now,
    updatedAt: now,
    status: "current",
  })
  return { layer: next, changed: true, status: "current", file, sourceHash, permission }
}

export interface LinkedSmartObjectSyncTarget {
  docId: string
  layer: Layer
}

export interface LinkedSmartObjectSyncEvent extends LinkedSmartObjectSyncResult {
  docId: string
}

export interface LinkedSmartObjectSyncDaemonOptions {
  intervalMs: number
  getTargets: () => LinkedSmartObjectSyncTarget[]
  onSync: (event: LinkedSmartObjectSyncEvent) => void
  syncOptions?: LinkedSmartObjectSyncOptions
  setIntervalFn?: (callback: () => void | Promise<void>, intervalMs: number) => ReturnType<typeof setInterval>
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void
}

export function createLinkedSmartObjectSyncDaemon(options: LinkedSmartObjectSyncDaemonOptions) {
  let timer: ReturnType<typeof setInterval> | null = null
  const setIntervalFn = options.setIntervalFn ?? setInterval
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval

  const syncNow = async () => {
    for (const target of options.getTargets()) {
      const result = await syncLinkedSmartObjectSource(target.layer, options.syncOptions)
      options.onSync({ ...result, docId: target.docId })
    }
  }

  return {
    start() {
      if (timer) return
      timer = setIntervalFn(() => { void syncNow() }, options.intervalMs)
    },
    stop() {
      if (!timer) return
      clearIntervalFn(timer)
      timer = null
    },
    syncNow,
  }
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
    fileHandle: options.fileHandle,
    fileHandleName: options.fileHandleName,
    handlePermission: options.handlePermission,
    lastKnownModified: options.lastKnownModified,
    lastKnownSize: options.lastKnownSize,
    sourceHash: options.sourceHash,
    editPackage: options.editPackage,
    exportedAt: options.exportedAt,
    relinkedAt: options.relinkedAt,
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
      fileHandle: options.fileHandle ?? layer.smartSource?.fileHandle,
      fileHandleName: options.fileHandleName ?? layer.smartSource?.fileHandleName,
      handlePermission: options.handlePermission ?? layer.smartSource?.handlePermission,
      lastKnownModified: options.lastKnownModified ?? layer.smartSource?.lastKnownModified,
      lastKnownSize: options.lastKnownSize ?? layer.smartSource?.lastKnownSize,
      sourceHash: options.sourceHash ?? layer.smartSource?.sourceHash,
      editPackage: options.editPackage ?? layer.smartSource?.editPackage,
      exportedAt: options.exportedAt ?? layer.smartSource?.exportedAt,
      relinkedAt: options.relinkedAt ?? layer.smartSource?.relinkedAt,
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
