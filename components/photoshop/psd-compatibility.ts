import type { Layer as PsdLayer, Psd } from "ag-psd"
import type {
  ArtboardProps,
  Layer,
  LayerMetadata,
  LayerNote,
  PsDocument,
  ShapeProps,
  SmartFilter,
  SmartObjectSource,
  TextProps,
  TypographyEmbeddedFont,
} from "./types"
import { collectEmbeddedTypographyFonts, isTypographyEmbeddedFont } from "./typography-engine"

type PsdPlanStatus = "preserved" | "rasterized" | "approximated" | "project-only" | "unsupported"

export interface PsdExportActionPlanItem {
  id: string
  label: string
  status: PsdPlanStatus
  detail: string
  layerId?: string
  layerName?: string
}

export interface PsdExportActionPlan {
  target: "psd"
  items: PsdExportActionPlanItem[]
  totals: Record<PsdPlanStatus, number>
  summary: string
}

export interface PsdRepairAction {
  id: string
  label: string
  source: "layer" | "resource" | "document"
  status: "represented" | "repairable" | "inspect-only"
  localRepresentation: string
  detail: string
  layerPath?: string
}

export interface PsdRepairPlan {
  actions: PsdRepairAction[]
  summary: string
}

export interface PsdSerializedSmartFilter extends Omit<SmartFilter, "mask"> {
  maskDataUrl?: string
}

export interface PsdLayerPreservationEntry {
  index: number
  id: string
  name: string
  kind?: Layer["kind"]
  notes?: LayerNote[]
  metadata?: LayerMetadata
  smartFilters?: PsdSerializedSmartFilter[]
  smartSource?: Omit<SmartObjectSource, "canvas" | "fileHandle">
  text?: TextProps
  shape?: ShapeProps
  adjustment?: Layer["adjustment"]
  path?: Layer["path"]
  frame?: Omit<NonNullable<Layer["frame"]>, "imageCanvas">
  artboard?: ArtboardProps
  threeD?: Layer["threeD"]
  video?: Layer["video"]
  advancedBlending?: Layer["advancedBlending"]
}

export interface PsdAppPreservationPayload {
  app: "Photoshop Web"
  kind: "psd-app-preservation"
  version: 1
  document: {
    id: string
    name: string
    width: number
    height: number
  }
  fonts?: TypographyEmbeddedFont[]
  layers: PsdLayerPreservationEntry[]
}

export interface PsdNativeSourceSnapshot {
  kind: "psd-native-source"
  version: 1
  sourceName: string
  format: "psd" | "psb"
  byteLength: number
  width?: number
  height?: number
  colorMode?: string
  bitDepth?: number
  checksum: string
  encoding: "base64"
  data: string
}

export const PSD_NATIVE_SOURCE_SNAPSHOT_LIMIT = 16 * 1024 * 1024

const XMP_PAYLOAD_RE = /<psweb:AppPreservation>([A-Za-z0-9+/=]+)<\/psweb:AppPreservation>/
const XMP_PAYLOAD_RE_GLOBAL = /\s*<psweb:AppPreservation>[A-Za-z0-9+/=]+<\/psweb:AppPreservation>/g

const PLAN_STATUSES: PsdPlanStatus[] = ["preserved", "rasterized", "approximated", "project-only", "unsupported"]

const EXTENDED_TEXT_KEYS: Array<keyof TextProps> = [
  "variableAxes",
  "variableAxisDefinitions",
  "variableNamedInstance",
  "embeddedFont",
  "vertical",
  "ligatures",
  "characterStyles",
  "openType",
  "contextualAlternates",
  "stylisticAlternates",
  "swash",
  "ordinals",
  "fractions",
  "slashedZero",
  "oldstyleFigures",
  "tabularFigures",
  "superscript",
  "subscript",
  "allCaps",
  "smallCaps",
  "textShape",
  "textShapeInset",
  "textShapeInsets",
  "textShapeVerticalAlign",
  "verticalWritingMode",
  "tateChuYoko",
  "textOrientation",
  "verticalAlign",
  "mojikumi",
  "missingFontOriginal",
  "fontSubstitution",
  "extrusion",
  "textPath",
  "tracking",
  "boxWidth",
  "boxHeight",
  "warp",
]

const UNSUPPORTED_NATIVE_ADJUSTMENTS = new Set([
  "shadows-highlights",
  "hdr-toning",
  "desaturate",
  "match-color",
  "replace-color",
  "equalize",
])

function encodeBase64Json(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)))
  }
  if (typeof btoa === "function") return btoa(binary)
  return Buffer.from(binary, "binary").toString("base64")
}

function decodeBase64Json<T>(value: string): T | null {
  try {
    const binary = typeof atob === "function" ? atob(value) : Buffer.from(value, "base64").toString("binary")
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } catch {
    return null
  }
}

function encodeBase64Bytes(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)))
  }
  if (typeof btoa === "function") return btoa(binary)
  return Buffer.from(binary, "binary").toString("base64")
}

function decodeBase64Bytes(value: string): Uint8Array | null {
  try {
    const binary = typeof atob === "function" ? atob(value) : Buffer.from(value, "base64").toString("binary")
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

function checksumBytes(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b9
  for (const byte of bytes) {
    h1 ^= byte
    h1 = Math.imul(h1, 0x01000193) >>> 0
    h2 = (h2 + byte + ((h2 << 6) >>> 0) + (h2 >>> 2)) >>> 0
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`
}

export function createPsdNativeSourceSnapshot(
  source: ArrayBuffer | Uint8Array,
  sourceName: string,
  details: {
    format?: "psd" | "psb"
    width?: number
    height?: number
    colorMode?: string
    bitDepth?: number
  } = {},
): PsdNativeSourceSnapshot | undefined {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source)
  if (!bytes.byteLength || bytes.byteLength > PSD_NATIVE_SOURCE_SNAPSHOT_LIMIT) return undefined
  const format = details.format ?? (/\.psb$/i.test(sourceName) ? "psb" : "psd")
  return {
    kind: "psd-native-source",
    version: 1,
    sourceName,
    format,
    byteLength: bytes.byteLength,
    width: details.width,
    height: details.height,
    colorMode: details.colorMode,
    bitDepth: details.bitDepth,
    checksum: checksumBytes(bytes),
    encoding: "base64",
    data: encodeBase64Bytes(bytes),
  }
}

export function restorePsdNativeSourceSnapshot(snapshot: PsdNativeSourceSnapshot | null | undefined): Uint8Array | null {
  if (!snapshot || snapshot.kind !== "psd-native-source" || snapshot.encoding !== "base64") return null
  const bytes = decodeBase64Bytes(snapshot.data)
  if (!bytes || bytes.byteLength !== snapshot.byteLength) return null
  if (checksumBytes(bytes) !== snapshot.checksum) return null
  return bytes
}

function jsonClone<T>(value: T): T | undefined {
  if (value == null) return undefined
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return undefined
  }
}

function canvasToDataUrl(canvas: HTMLCanvasElement | null | undefined): string | undefined {
  if (!canvas) return undefined
  try {
    return canvas.toDataURL("image/png")
  } catch {
    return undefined
  }
}

function dataUrlToCanvas(dataUrl: string): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || typeof Image === "undefined" || !/^data:image\/png;base64,/i.test(dataUrl)) {
      resolve(null)
      return
    }
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, image.naturalWidth || 1)
      canvas.height = Math.max(1, image.naturalHeight || 1)
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        resolve(null)
        return
      }
      ctx.drawImage(image, 0, 0)
      resolve(canvas)
    }
    image.onerror = () => resolve(null)
    image.src = dataUrl
  })
}

function serializeSmartFilter(filter: SmartFilter): PsdSerializedSmartFilter {
  const { mask: _mask, ...rest } = filter
  return {
    ...jsonClone(rest)!,
    maskDataUrl: canvasToDataUrl(filter.mask),
  }
}

async function deserializeSmartFilter(filter: PsdSerializedSmartFilter): Promise<SmartFilter> {
  const { maskDataUrl, ...rest } = filter
  const restored: SmartFilter = {
    id: rest.id,
    filterId: rest.filterId,
    name: rest.name,
    enabled: rest.enabled,
    opacity: rest.opacity,
    blendMode: rest.blendMode,
    params: rest.params ?? {},
    maskEnabled: rest.maskEnabled,
    maskDensity: rest.maskDensity,
    maskFeather: rest.maskFeather,
    maskLinked: rest.maskLinked,
  }
  if (maskDataUrl) restored.mask = await dataUrlToCanvas(maskDataUrl)
  return restored
}

function serializeSmartSource(source: SmartObjectSource): Omit<SmartObjectSource, "canvas" | "fileHandle"> {
  const { canvas: _canvas, fileHandle: _fileHandle, ...rest } = source
  return jsonClone(rest) ?? {
    width: source.width,
    height: source.height,
  }
}

function hasExtendedText(text: TextProps | undefined): boolean {
  if (!text) return false
  return EXTENDED_TEXT_KEYS.some((key) => text[key] != null)
}

export function createPsdAppPreservationPayload(doc: PsDocument): PsdAppPreservationPayload {
  const layers: PsdLayerPreservationEntry[] = []
  doc.layers.forEach((layer, index) => {
    const entry: PsdLayerPreservationEntry = {
      index,
      id: layer.id,
      name: layer.name,
      kind: layer.kind,
    }
    if (layer.notes?.length) entry.notes = jsonClone(layer.notes)
    if (layer.metadata) entry.metadata = jsonClone(layer.metadata)
    if (layer.smartFilters?.length) entry.smartFilters = layer.smartFilters.map(serializeSmartFilter)
    if (layer.smartSource) entry.smartSource = serializeSmartSource(layer.smartSource)
    if (hasExtendedText(layer.text)) entry.text = jsonClone(layer.text)
    if (layer.shape?.components?.length || layer.shape?.appearance) entry.shape = jsonClone(layer.shape)
    if (layer.adjustment && UNSUPPORTED_NATIVE_ADJUSTMENTS.has(layer.adjustment.type)) entry.adjustment = jsonClone(layer.adjustment)
    if (layer.path) entry.path = jsonClone(layer.path)
    if (layer.frame) {
      const { imageCanvas: _imageCanvas, ...frame } = layer.frame
      entry.frame = jsonClone(frame)
    }
    if (layer.artboard) entry.artboard = jsonClone(layer.artboard)
    if (layer.threeD) entry.threeD = jsonClone(layer.threeD)
    if (layer.video) entry.video = jsonClone(layer.video)
    if (layer.advancedBlending) entry.advancedBlending = jsonClone(layer.advancedBlending)
    layers.push(entry)
  })
  return {
    app: "Photoshop Web",
    kind: "psd-app-preservation",
    version: 1,
    document: {
      id: doc.id,
      name: doc.name,
      width: doc.width,
      height: doc.height,
    },
    fonts: collectEmbeddedTypographyFonts(doc),
    layers,
  }
}

function minimalXmp(): string {
  return [
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Photoshop Web XMP 1.0">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:psweb="https://openai.com/photoshop-web/psd-preservation/1.0/">',
    "</rdf:Description>",
    "</rdf:RDF>",
    "</x:xmpmeta>",
    '<?xpacket end="w"?>',
  ].join("\n")
}

function ensurePswebNamespace(xmp: string): string {
  if (xmp.includes("xmlns:psweb=")) return xmp
  return xmp.replace(
    /<rdf:Description\b([^>]*)>/,
    '<rdf:Description$1 xmlns:psweb="https://openai.com/photoshop-web/psd-preservation/1.0/">',
  )
}

export function embedPsdAppPreservationInXmp(
  xmp: string | undefined,
  payload: PsdAppPreservationPayload,
): string {
  const base = ensurePswebNamespace((xmp && xmp.includes("<rdf:Description")) ? xmp : minimalXmp())
    .replace(XMP_PAYLOAD_RE_GLOBAL, "")
  const tag = `<psweb:AppPreservation>${encodeBase64Json(payload)}</psweb:AppPreservation>`
  if (base.includes("</rdf:Description>")) {
    return base.replace("</rdf:Description>", `${tag}\n</rdf:Description>`)
  }
  return `${base}\n${tag}`
}

export function extractPsdAppPreservationFromXmp(
  xmp: string | undefined,
): PsdAppPreservationPayload | null {
  if (!xmp) return null
  const match = xmp.match(XMP_PAYLOAD_RE)
  if (!match) return null
  const decoded = decodeBase64Json<PsdAppPreservationPayload>(match[1])
  if (!decoded || decoded.app !== "Photoshop Web" || decoded.kind !== "psd-app-preservation" || !Array.isArray(decoded.layers)) {
    return null
  }
  return decoded
}

function findLayerForEntry(doc: PsDocument, entry: PsdLayerPreservationEntry): Layer | undefined {
  const byIndex = doc.layers[entry.index]
  if (byIndex) return byIndex
  return doc.layers.find((layer) => layer.name === entry.name && (!entry.kind || layer.kind === entry.kind))
}

export async function applyPsdAppPreservationPayload(
  doc: PsDocument,
  payload: PsdAppPreservationPayload,
): Promise<PsDocument> {
  if (payload.fonts?.length) {
    const existing = doc.assetLibrary ?? []
    const existingHashes = new Set(existing
      .filter((asset) => asset.kind === "font" && isTypographyEmbeddedFont(asset.payload))
      .map((asset) => (asset.payload as TypographyEmbeddedFont).hash))
    const restoredFonts = payload.fonts
      .filter((font) => !existingHashes.has(font.hash))
      .map((font, index) => ({
        id: `psd_font_${font.hash}_${index}`,
        name: font.family,
        kind: "font" as const,
        group: "PSD Embedded Fonts",
        payload: jsonClone(font) ?? font,
        createdAt: Date.now(),
      }))
    if (restoredFonts.length) doc.assetLibrary = [...existing, ...restoredFonts]
  }
  for (const entry of payload.layers) {
    const layer = findLayerForEntry(doc, entry)
    if (!layer) continue
    if (entry.notes) layer.notes = jsonClone(entry.notes)
    if (entry.metadata) layer.metadata = jsonClone(entry.metadata)
    if (entry.smartFilters) layer.smartFilters = await Promise.all(entry.smartFilters.map(deserializeSmartFilter))
    if (entry.smartSource) layer.smartSource = { ...(layer.smartSource ?? {}), ...jsonClone(entry.smartSource) } as SmartObjectSource
    if (entry.text) layer.text = { ...(layer.text ?? entry.text), ...jsonClone(entry.text) }
    if (layer.text && !layer.text.embeddedFont && payload.fonts?.length) {
      const restoredFont = payload.fonts.find((font) => font.family.toLowerCase() === layer.text!.font.toLowerCase())
      if (restoredFont) layer.text.embeddedFont = jsonClone(restoredFont) ?? restoredFont
    }
    if (entry.shape) layer.shape = { ...(layer.shape ?? entry.shape), ...jsonClone(entry.shape) }
    if (entry.adjustment) layer.adjustment = jsonClone(entry.adjustment)
    if (entry.path) layer.path = jsonClone(entry.path)
    if (entry.frame) layer.frame = { ...(layer.frame ?? {}), ...jsonClone(entry.frame) } as Layer["frame"]
    if (entry.artboard) layer.artboard = jsonClone(entry.artboard)
    if (entry.threeD) layer.threeD = jsonClone(entry.threeD)
    if (entry.video) layer.video = jsonClone(entry.video)
    if (entry.advancedBlending) layer.advancedBlending = jsonClone(entry.advancedBlending)
  }
  return doc
}

function addPlanItem(items: PsdExportActionPlanItem[], item: Omit<PsdExportActionPlanItem, "id">) {
  items.push({ id: `psd_plan_${items.length + 1}`, ...item })
}

export function createPsdExportActionPlan(doc: PsDocument): PsdExportActionPlan {
  const items: PsdExportActionPlanItem[] = []
  for (const layer of doc.layers) {
    const layerRef = { layerId: layer.id, layerName: layer.name }
    if (layer.smartFilters?.length) {
      addPlanItem(items, {
        ...layerRef,
        label: "Smart filters",
        status: "rasterized",
        detail: `${layer.smartFilters.length} smart filter${layer.smartFilters.length === 1 ? "" : "s"} are baked into PSD layer pixels; editable settings are also written to the app-preservation XMP payload.`,
      })
    }
    if (layer.kind === "text" && hasExtendedText(layer.text)) {
      addPlanItem(items, {
        ...layerRef,
        label: "Extended text controls",
        status: "approximated",
        detail: "Native PSD text is written where ag-psd supports it; variable fonts, OpenType toggles, path text, and app-only controls are preserved in app XMP.",
      })
    }
    if (layer.kind === "shape" && (layer.shape?.components?.length || layer.shape?.appearance)) {
      addPlanItem(items, {
        ...layerRef,
        label: "Compound shape appearance",
        status: "approximated",
        detail: "Vector mask/fill/stroke are exported; compound components and multi-appearance controls are preserved for this app in XMP.",
      })
    }
    if (layer.kind === "adjustment" && layer.adjustment && UNSUPPORTED_NATIVE_ADJUSTMENTS.has(layer.adjustment.type)) {
      addPlanItem(items, {
        ...layerRef,
        label: "Adjustment layer",
        status: "approximated",
        detail: `${layer.adjustment.type} is represented by current pixels plus app-preserved editable parameters.`,
      })
    }
    if (layer.kind === "3d" || layer.threeD) {
      addPlanItem(items, {
        ...layerRef,
        label: "3D layer",
        status: "rasterized",
        detail: "The rendered 3D preview is exported to PSD pixels; scene mesh/material/camera data remains project-only.",
      })
    }
    if (layer.kind === "video" || layer.video) {
      addPlanItem(items, {
        ...layerRef,
        label: "Video layer",
        status: "rasterized",
        detail: "The current poster frame is exported to PSD pixels; timing, media links, transitions, and audio remain project-only.",
      })
    }
    if (layer.notes?.length || layer.metadata) {
      addPlanItem(items, {
        ...layerRef,
        label: "Layer notes and metadata",
        status: "project-only",
        detail: "Layer notes, tags, and custom fields are not Photoshop-native layer records; this app restores them from the PSD XMP preservation payload.",
      })
    }
    if (layer.smartSource?.fileHandleName || layer.smartSource?.handlePermission || layer.smartSource?.editPackage) {
      addPlanItem(items, {
        ...layerRef,
        label: "Browser smart-object link state",
        status: "project-only",
        detail: "File System Access handles and edit-package metadata are browser-only and are preserved for this app without serializing live handles.",
      })
    }
  }
  if (doc.plugins?.length) {
    addPlanItem(items, {
      label: "Plugin descriptors",
      status: "project-only",
      detail: `${doc.plugins.length} plugin descriptor${doc.plugins.length === 1 ? "" : "s"} remain project-only and are not authored as native PSD resources.`,
    })
  }
  if (doc.variableDataSets?.length) {
    addPlanItem(items, {
      label: "Variable data",
      status: "project-only",
      detail: `${doc.variableDataSets.length} variable data set${doc.variableDataSets.length === 1 ? "" : "s"} remain app metadata.`,
    })
  }
  if (doc.guides?.length) {
    addPlanItem(items, {
      label: "Guides",
      status: "approximated",
      detail: "Guides are written to PSD grid resources and restored locally; Photoshop may discard non-native guide details.",
    })
  }
  if (doc.slices?.length) {
    addPlanItem(items, {
      label: "Slices",
      status: "approximated",
      detail: "Slices are written to PSD slice resources and restored locally; modern Photoshop may not surface all legacy slice fields.",
    })
  }
  if (doc.channels?.length) {
    addPlanItem(items, {
      label: "Alpha and spot channels",
      status: "approximated",
      detail: "Extra channel names are written through PSD resources; pixel data uses the app's hidden marker group recovery path.",
    })
  }

  const totals = Object.fromEntries(PLAN_STATUSES.map((status) => [status, 0])) as Record<PsdPlanStatus, number>
  for (const item of items) totals[item.status] += 1
  const summary = `PSD export action plan: ${totals.rasterized} rasterized, ${totals.approximated} approximated, ${totals["project-only"]} project-only, ${totals.unsupported} unsupported.`
  return { target: "psd", items, totals, summary }
}

function safeLayerName(layer: PsdLayer, fallback: string) {
  return typeof layer.name === "string" && layer.name.trim() ? layer.name.trim() : fallback
}

function walkPsdLayers(
  layers: PsdLayer[] | undefined,
  visit: (layer: PsdLayer, path: string) => void,
  prefix = "",
) {
  for (let i = 0; i < (layers ?? []).length; i++) {
    const layer = layers![i]
    const label = safeLayerName(layer, `Layer ${i + 1}`)
    const path = prefix ? `${prefix} / ${label}` : label
    visit(layer, path)
    if (Array.isArray(layer.children)) walkPsdLayers(layer.children, visit, path)
  }
}

function addRepairAction(actions: PsdRepairAction[], action: Omit<PsdRepairAction, "id">) {
  actions.push({ id: `psd_repair_${actions.length + 1}`, ...action })
}

export function createPsdRepairPlanFromParsedPsd(psd: Psd): PsdRepairPlan {
  const actions: PsdRepairAction[] = []
  walkPsdLayers(psd.children, (layer, path) => {
    const label = safeLayerName(layer, path)
    if (layer.artboard) {
      addRepairAction(actions, {
        label,
        source: "layer",
        status: "represented",
        localRepresentation: "artboard layer",
        layerPath: path,
        detail: "PSD artboard bounds can be represented as a local artboard layer with child layers attached.",
      })
    }
    if (layer.placedLayer && layer.placedLayer.type && layer.placedLayer.type !== "raster") {
      addRepairAction(actions, {
        label,
        source: "layer",
        status: "repairable",
        localRepresentation: "smart object placeholder",
        layerPath: path,
        detail: `${layer.placedLayer.type} placed content can be kept as a local smart-object placeholder with transform and link metadata.`,
      })
    }
    if (layer.pixelSource) {
      addRepairAction(actions, {
        label,
        source: "layer",
        status: "represented",
        localRepresentation: "video layer",
        layerPath: path,
        detail: "PSD video pixel source metadata can be represented as a local video layer with a poster frame.",
      })
    }
    if (layer.vectorMask && !layer.vectorFill && !layer.text) {
      addRepairAction(actions, {
        label,
        source: "layer",
        status: "represented",
        localRepresentation: "editable path layer",
        layerPath: path,
        detail: "Vector mask path data can be surfaced locally as an editable path or hidden shape layer.",
      })
    }
  })

  const resources = psd.imageResources
  if (resources?.gridAndGuidesInformation?.guides?.length) {
    addRepairAction(actions, {
      label: "Guides",
      source: "resource",
      status: "represented",
      localRepresentation: "guides panel entries",
      detail: `${resources.gridAndGuidesInformation.guides.length} PSD guide${resources.gridAndGuidesInformation.guides.length === 1 ? "" : "s"} can be restored locally.`,
    })
  }
  if (resources?.layerComps?.list?.length) {
    addRepairAction(actions, {
      label: "Layer comps",
      source: "resource",
      status: "represented",
      localRepresentation: "layer comp records",
      detail: `${resources.layerComps.list.length} PSD layer comp${resources.layerComps.list.length === 1 ? "" : "s"} can be represented locally, even when comments lack app payloads.`,
    })
  }
  const sliceGroups = Array.isArray(resources?.slices) ? resources?.slices.length ?? 0 : 0
  if (sliceGroups) {
    addRepairAction(actions, {
      label: "Slices",
      source: "resource",
      status: "represented",
      localRepresentation: "slice panel entries",
      detail: `${sliceGroups} PSD slice group${sliceGroups === 1 ? "" : "s"} can be restored as local web-export slices.`,
    })
  }
  if (psd.artboards?.count) {
    addRepairAction(actions, {
      label: "Document artboards",
      source: "document",
      status: "inspect-only",
      localRepresentation: "document artboard summary",
      detail: `${psd.artboards.count} top-level PSD artboard record${psd.artboards.count === 1 ? "" : "s"} can be shown in recovery metadata.`,
    })
  }

  return {
    actions,
    summary: `${actions.length} PSD structure${actions.length === 1 ? "" : "s"} can be represented or inspected locally.`,
  }
}
