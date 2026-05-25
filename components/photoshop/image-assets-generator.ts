"use client"

import { canvasSizeError } from "./canvas-limits"
import { canvasToGifDataUrl, renderDocumentComposite, rasterMime } from "./document-io"
import type { BrowserRasterExportFormat } from "./document-io"
import type { DocumentReport, ImageAssetGeneratorSettings, Layer, PsDocument } from "./types"
import { blobToZipEntry, createStoredZipBlob, type StoredZipEntry } from "./zip-packaging"

export type ImageAssetGeneratorFormat = BrowserRasterExportFormat | "svg"
export type ImageAssetGeneratorSubFormat = "png-8" | "png-24" | "png-32"
export type ImageAssetGeneratorTrigger = "manual" | "save" | "change"
export type ImageAssetGeneratorIssueKind = "invalid" | "conflict" | "export-error" | "skipped"

export interface ParsedImageAssetName {
  sourceText: string
  filename: string
  scale: number
  format: ImageAssetGeneratorFormat
  extension: string
  /** Optional explicit pixel dimensions from "300px x 200px filename.png". */
  width?: number
  height?: number
  /** Optional JPEG quality 0-1 derived from "jpg6"/"jpg10"/"jpg12" prefixes. */
  quality?: number
  /** Optional PNG subformat ("png-8" indexed, "png-24" RGB, "png-32" RGBA). */
  subFormat?: ImageAssetGeneratorSubFormat
}

export interface ImageAssetGeneratorIssue {
  kind: ImageAssetGeneratorIssueKind
  layerId?: string
  layerName?: string
  filename?: string
  sourceText?: string
  message: string
}

export interface ImageAssetGeneratorParseResult {
  assets: ParsedImageAssetName[]
  issues: ImageAssetGeneratorIssue[]
}

export interface ImageAssetGeneratorAsset extends ParsedImageAssetName {
  id: string
  layerId: string
  layerName: string
}

export interface ImageAssetGeneratorPlan {
  documentId: string
  documentName: string
  assets: ImageAssetGeneratorAsset[]
  issues: ImageAssetGeneratorIssue[]
  totalLayerNameSpecs: number
  hasGeneratorLayerNames: boolean
}

export interface WrittenImageAsset {
  id: string
  layerId: string
  layerName: string
  filename: string
  format: ImageAssetGeneratorFormat
  scale: number
  outputWidth: number
  outputHeight: number
  byteLength: number
}

export interface ImageAssetGeneratorResult {
  trigger: ImageAssetGeneratorTrigger
  plan: ImageAssetGeneratorPlan
  written: WrittenImageAsset[]
  entries: StoredZipEntry[]
  issues: ImageAssetGeneratorIssue[]
  zipBlob: Blob
}

export interface ImageAssetGeneratorRunOptions {
  trigger?: ImageAssetGeneratorTrigger
  quality?: number
  matte?: string
}

export interface ImageAssetGeneratorAutorunInput {
  trigger: Exclude<ImageAssetGeneratorTrigger, "manual">
  plan: ImageAssetGeneratorPlan
  settings?: ImageAssetGeneratorSettings
  previousSignature?: string
  currentSignature?: string
}

interface FileSystemWritableFileStreamLike {
  write(data: Blob): Promise<void>
  close(): Promise<void>
}

interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableFileStreamLike>
}

export interface FileSystemDirectoryHandleLike {
  name?: string
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandleLike>
  getDirectoryHandle?(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandleLike>
}

const SUPPORTED_FORMATS: Record<string, ImageAssetGeneratorFormat> = {
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  webp: "webp",
  gif: "gif",
  avif: "avif",
  svg: "svg",
}

/** Default JPEG qualities for Photoshop Generator-style "jpgN" prefixes (0-12 mapped to 0-1). */
function jpgQualityFromLevel(level: number) {
  if (!Number.isFinite(level)) return null
  const clamped = Math.max(0, Math.min(12, Math.round(level)))
  return clamped / 12
}

const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const INVALID_PATH_CHARS = /[<>:"\\|?*\u0000-\u001f]/
const DEFAULT_SETTINGS: Required<Pick<ImageAssetGeneratorSettings, "enabled" | "autoExportOnSave" | "autoExportOnChange">> = {
  enabled: true,
  autoExportOnSave: true,
  autoExportOnChange: false,
}

function extensionForFilename(filename: string) {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(filename.trim())
  return match?.[1]?.toLowerCase() ?? null
}

function normalizeScale(value: string, unit: "%" | "x") {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  const scale = unit === "%" ? numeric / 100 : numeric
  if (scale < 0.05 || scale > 10) return null
  return scale
}

function issue(input: Omit<ImageAssetGeneratorIssue, "kind"> & { kind?: ImageAssetGeneratorIssueKind }): ImageAssetGeneratorIssue {
  return { kind: input.kind ?? "invalid", ...input }
}

function validateAssetPath(filename: string) {
  const normalized = filename.trim().replace(/\\/g, "/")
  if (!normalized) return "Filename is empty."
  if (normalized.length > 240) return "Filename is too long."
  if (filename.includes("\\")) return "Backslashes are not allowed in generated asset paths."
  if (normalized.startsWith("/") || normalized.startsWith("~")) return "Generated asset paths must be relative."
  const parts = normalized.split("/")
  for (const part of parts) {
    if (!part || part === "." || part === "..") return "Generated asset paths cannot contain empty, current, or parent directory segments."
    if (INVALID_PATH_CHARS.test(part)) return `Generated asset path segment "${part}" contains characters that are invalid on common file systems.`
    if (part.endsWith(".") || part.endsWith(" ")) return `Generated asset path segment "${part}" cannot end with a dot or space.`
    const stem = part.replace(/\.[^.]+$/, "")
    if (RESERVED_WINDOWS_NAMES.test(stem)) return `Generated asset path segment "${part}" uses a reserved device name.`
  }
  return null
}

function parseAssetSegment(sourceText: string): ParsedImageAssetName | ImageAssetGeneratorIssue | null {
  const source = sourceText.trim()
  if (!source) return null

  let filename = source
  let scale = 1
  let width: number | undefined
  let height: number | undefined

  const pixelMatch = /^([0-9]+)\s*px\s*[x×]\s*([0-9]+)\s*px\s+(.+)$/i.exec(source)
  if (pixelMatch) {
    const w = Number(pixelMatch[1])
    const h = Number(pixelMatch[2])
    filename = pixelMatch[3].trim()
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1 || w > 16384 || h > 16384) {
      return issue({ sourceText: source, filename, message: `Pixel dimensions "${pixelMatch[1]}px x ${pixelMatch[2]}px" must each be between 1 and 16384.` })
    }
    width = Math.round(w)
    height = Math.round(h)
  } else {
    const scaleMatch = /^([0-9]+(?:\.[0-9]+)?)(%|x)\s+(.+)$/i.exec(source)
    if (scaleMatch) {
      const nextScale = normalizeScale(scaleMatch[1], scaleMatch[2].toLowerCase() as "%" | "x")
      filename = scaleMatch[3].trim()
      if (nextScale == null) {
        return issue({ sourceText: source, filename, message: `Scale "${scaleMatch[1]}${scaleMatch[2]}" must be between 5% and 1000%.` })
      }
      scale = nextScale
    } else {
      const invalidScaleMatch = /^(\S*[x%])\s+(.+\.[A-Za-z0-9]{1,8})$/i.exec(source)
      if (invalidScaleMatch) {
        filename = invalidScaleMatch[2].trim()
        return issue({ sourceText: source, filename, message: `Scale "${invalidScaleMatch[1]}" is not a valid numeric scale prefix.` })
      }
    }
  }

  // Photoshop Generator format-quality prefixes embedded in the filename portion
  // such as "icon.png24", "icon.jpg6", or "logo.jpg-80" are normalized off the filename
  // and applied as a format override.
  let subFormat: ImageAssetGeneratorSubFormat | undefined
  let quality: number | undefined
  const formatQualityMatch = /^(.+?\.)(png|jpg|jpeg)([-]?[0-9]{1,3})$/i.exec(filename)
  if (formatQualityMatch) {
    const baseFilename = formatQualityMatch[1] + formatQualityMatch[2]
    const ext = formatQualityMatch[2].toLowerCase()
    const numericPart = formatQualityMatch[3].replace(/^-/, "")
    const numeric = Number(numericPart)
    if (ext === "png") {
      if (numericPart === "8" || numericPart === "24" || numericPart === "32") {
        subFormat = `png-${numericPart}` as ImageAssetGeneratorSubFormat
        filename = baseFilename
      }
    } else if (ext === "jpg" || ext === "jpeg") {
      if (numericPart.length >= 1 && numericPart.length <= 3 && Number.isFinite(numeric)) {
        if (numericPart.length <= 2 && numeric >= 0 && numeric <= 12) {
          // Photoshop "jpg6" / "jpg10" / "jpg12" style
          const q = jpgQualityFromLevel(numeric)
          if (q != null) quality = q
          filename = baseFilename
        } else if (numeric >= 0 && numeric <= 100) {
          // Numeric percentage like "jpg-80" / "jpg85"
          quality = numeric / 100
          filename = baseFilename
        }
      }
    }
  }

  const extension = extensionForFilename(filename)
  if (!extension) return null
  const format = SUPPORTED_FORMATS[extension]
  if (!format) {
    return issue({ sourceText: source, filename, message: `Unsupported generated asset format ".${extension}".` })
  }

  if (subFormat && format !== "png") {
    subFormat = undefined
  }
  if (quality != null && format !== "jpeg") {
    quality = undefined
  }

  const pathError = validateAssetPath(filename)
  if (pathError) return issue({ sourceText: source, filename, message: pathError })

  const parsed: ParsedImageAssetName = {
    sourceText: source,
    filename: filename.replace(/\\/g, "/"),
    scale,
    format,
    extension,
  }
  if (width != null) parsed.width = width
  if (height != null) parsed.height = height
  if (quality != null) parsed.quality = quality
  if (subFormat) parsed.subFormat = subFormat
  return parsed
}

export function parseImageAssetLayerName(name: string): ImageAssetGeneratorParseResult {
  const assets: ParsedImageAssetName[] = []
  const issues: ImageAssetGeneratorIssue[] = []
  for (const raw of name.split(",")) {
    const parsed = parseAssetSegment(raw)
    if (!parsed) continue
    if ("kind" in parsed) issues.push(parsed)
    else assets.push(parsed)
  }
  return { assets, issues }
}

function assetId(layerId: string, filename: string) {
  return `${layerId}:${filename.toLowerCase()}`
}

export function collectImageAssetGeneratorPlan(doc: PsDocument): ImageAssetGeneratorPlan {
  const parsedAssets: ImageAssetGeneratorAsset[] = []
  const parseIssues: ImageAssetGeneratorIssue[] = []
  let totalLayerNameSpecs = 0

  for (const layer of doc.layers) {
    const parsed = parseImageAssetLayerName(layer.name)
    totalLayerNameSpecs += parsed.assets.length
    for (const parsedIssue of parsed.issues) {
      parseIssues.push({
        ...parsedIssue,
        layerId: layer.id,
        layerName: layer.name,
      })
    }
    for (const asset of parsed.assets) {
      parsedAssets.push({
        ...asset,
        id: assetId(layer.id, asset.filename),
        layerId: layer.id,
        layerName: layer.name,
      })
    }
  }

  const byFilename = new Map<string, ImageAssetGeneratorAsset[]>()
  for (const asset of parsedAssets) {
    const key = asset.filename.toLowerCase()
    byFilename.set(key, [...(byFilename.get(key) ?? []), asset])
  }

  const conflictIssues: ImageAssetGeneratorIssue[] = []
  const conflictedKeys = new Set<string>()
  for (const [key, assets] of byFilename) {
    if (assets.length < 2) continue
    conflictedKeys.add(key)
    for (const asset of assets) {
      conflictIssues.push({
        kind: "conflict",
        layerId: asset.layerId,
        layerName: asset.layerName,
        filename: asset.filename,
        sourceText: asset.sourceText,
        message: `Generated asset "${asset.filename}" is requested by ${assets.length} layers. The first layer wins; rename one of the layer specs to export both.`,
      })
    }
  }

  const firstByFilename = new Set<string>()
  const assets = parsedAssets.filter((asset) => {
    const key = asset.filename.toLowerCase()
    if (!conflictedKeys.has(key)) return true
    if (firstByFilename.has(key)) return false
    firstByFilename.add(key)
    return true
  })

  return {
    documentId: doc.id,
    documentName: doc.name,
    assets,
    issues: [...conflictIssues, ...parseIssues],
    totalLayerNameSpecs,
    hasGeneratorLayerNames: totalLayerNameSpecs > 0 || parseIssues.length > 0,
  }
}

function makeCanvas(width: number, height: number, matte?: string) {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  if (matte) {
    const ctx = canvas.getContext("2d")
    if (ctx) {
      ctx.fillStyle = matte
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
  }
  return canvas
}

function alphaBounds(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let minX = canvas.width
  let minY = canvas.height
  let maxX = 0
  let maxY = 0
  let any = false
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (img.data[(y * canvas.width + x) * 4 + 3] > 8) {
        any = true
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }
  return any ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null
}

function cropTransparentBounds(canvas: HTMLCanvasElement) {
  const bounds = alphaBounds(canvas) ?? { x: 0, y: 0, w: canvas.width, h: canvas.height }
  const out = makeCanvas(bounds.w, bounds.h)
  out.getContext("2d")?.drawImage(canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h)
  return out
}

export function renderImageAssetLayerCanvas(doc: PsDocument, asset: ImageAssetGeneratorAsset) {
  const layer = doc.layers.find((candidate) => candidate.id === asset.layerId)
  if (!layer) throw new Error(`Layer "${asset.layerName}" no longer exists.`)
  const forcedLayer: Layer = {
    ...layer,
    visible: true,
    clipped: false,
    parentId: undefined,
  }
  const source = renderDocumentComposite({
    ...doc,
    layers: [forcedLayer],
    background: "transparent",
  }, { transparent: true, colorPurpose: "export" })
  if (!alphaBounds(source) && layer.canvas && (layer.canvas.width !== doc.width || layer.canvas.height !== doc.height)) {
    return cropTransparentBounds(layer.canvas)
  }
  return cropTransparentBounds(source)
}

function scaleCanvas(
  source: HTMLCanvasElement,
  scale: number,
  matte?: string,
  explicit?: { width?: number; height?: number },
) {
  const targetWidth = explicit?.width ?? Math.max(1, Math.round(source.width * scale))
  const targetHeight = explicit?.height ?? Math.max(1, Math.round(source.height * scale))
  if (targetWidth === source.width && targetHeight === source.height && !matte) return source
  const out = makeCanvas(targetWidth, targetHeight, matte)
  const ctx = out.getContext("2d")
  if (ctx) {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(source, 0, 0, out.width, out.height)
  }
  return out
}

/** Best-effort 8-bit indexed PNG approximation by reducing to a 256-color palette via uniform quantization. */
function quantizeCanvasToIndexed(source: HTMLCanvasElement) {
  const ctx = source.getContext("2d")
  if (!ctx) return source
  const img = ctx.getImageData(0, 0, source.width, source.height)
  const data = img.data
  // 6 levels per channel (216 palette) + transparent passthrough — keeps to <= 256 colors.
  const step = 51
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) {
      data[i] = 0
      data[i + 1] = 0
      data[i + 2] = 0
      data[i + 3] = 0
      continue
    }
    data[i] = Math.round(data[i] / step) * step
    data[i + 1] = Math.round(data[i + 1] / step) * step
    data[i + 2] = Math.round(data[i + 2] / step) * step
    data[i + 3] = data[i + 3] > 127 ? 255 : 0
  }
  const out = makeCanvas(source.width, source.height)
  const outCtx = out.getContext("2d")
  if (outCtx) outCtx.putImageData(img, 0, 0)
  return out
}

/** Wrap a raster canvas in an SVG document that embeds the bitmap as a base64 PNG. */
function canvasToSvgBlob(canvas: HTMLCanvasElement) {
  const pngDataUrl = typeof canvas.toDataURL === "function" ? canvas.toDataURL("image/png") : ""
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><image width="${canvas.width}" height="${canvas.height}" xlink:href="${pngDataUrl}" preserveAspectRatio="none"/></svg>`
  return new Blob([svg], { type: "image/svg+xml" })
}

function dataUrlToBlob(dataUrl: string) {
  const [header, body = ""] = dataUrl.split(",", 2)
  const mime = /^data:([^;]+)/i.exec(header)?.[1] ?? "application/octet-stream"
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

async function canvasToBlob(canvas: HTMLCanvasElement, asset: ImageAssetGeneratorAsset, quality: number) {
  if (asset.format === "svg") return canvasToSvgBlob(canvas)
  if (asset.format === "gif") return dataUrlToBlob(canvasToGifDataUrl(canvas, true))

  let source = canvas
  if (asset.format === "png" && asset.subFormat === "png-8") {
    source = quantizeCanvasToIndexed(canvas)
  }

  const mime = rasterMime(asset.format)
  if (typeof source.toBlob === "function") {
    const blob = await new Promise<Blob | null>((resolve) => source.toBlob(resolve, mime, quality))
    if (!blob) throw new Error("Canvas encoder returned no blob.")
    if ((asset.format === "webp" || asset.format === "avif") && blob.type && blob.type.toLowerCase() !== mime) {
      throw new Error(`${asset.format.toUpperCase()} encoder returned ${blob.type}; this browser does not support ${mime} export.`)
    }
    return blob
  }
  if (typeof source.toDataURL === "function") {
    return dataUrlToBlob(source.toDataURL(mime, quality))
  }
  throw new Error("Canvas export is unavailable in this browser context.")
}

async function renderAndEncodeAsset(
  doc: PsDocument,
  asset: ImageAssetGeneratorAsset,
  options: Required<Pick<ImageAssetGeneratorRunOptions, "quality" | "matte">>,
) {
  const rendered = renderImageAssetLayerCanvas(doc, asset)
  const explicit = asset.width != null || asset.height != null
    ? { width: asset.width, height: asset.height }
    : undefined
  const scaled = scaleCanvas(
    rendered,
    asset.scale,
    asset.format === "jpeg" ? options.matte : undefined,
    explicit,
  )
  const sizeError = canvasSizeError(scaled.width, scaled.height, "Generated asset")
  if (sizeError) throw new Error(sizeError)
  const quality = asset.quality != null ? asset.quality : options.quality
  const blob = await canvasToBlob(scaled, asset, quality)
  return { blob, width: scaled.width, height: scaled.height }
}

export async function exportImageAssetsToZip(
  doc: PsDocument,
  options: ImageAssetGeneratorRunOptions = {},
): Promise<ImageAssetGeneratorResult> {
  const trigger = options.trigger ?? "manual"
  const quality = options.quality ?? 0.92
  const matte = options.matte ?? "#ffffff"
  const plan = collectImageAssetGeneratorPlan(doc)
  const written: WrittenImageAsset[] = []
  const entries: StoredZipEntry[] = []
  const issues = [...plan.issues]

  for (const asset of plan.assets) {
    try {
      const encoded = await renderAndEncodeAsset(doc, asset, { quality, matte })
      entries.push(await blobToZipEntry(asset.filename, encoded.blob))
      written.push({
        id: asset.id,
        layerId: asset.layerId,
        layerName: asset.layerName,
        filename: asset.filename,
        format: asset.format,
        scale: asset.scale,
        outputWidth: encoded.width,
        outputHeight: encoded.height,
        byteLength: encoded.blob.size,
      })
    } catch (error) {
      issues.push({
        kind: "export-error",
        layerId: asset.layerId,
        layerName: asset.layerName,
        filename: asset.filename,
        sourceText: asset.sourceText,
        message: error instanceof Error ? error.message : "Could not export generated asset.",
      })
    }
  }

  return {
    trigger,
    plan,
    written,
    entries,
    issues,
    zipBlob: createStoredZipBlob(entries),
  }
}

async function directoryForPath(root: FileSystemDirectoryHandleLike, parts: string[]) {
  let dir = root
  for (const part of parts) {
    if (!dir.getDirectoryHandle) throw new Error("Nested generated asset folders are not supported by this browser handle.")
    dir = await dir.getDirectoryHandle(part, { create: true })
  }
  return dir
}

export async function writeImageAssetsToDirectory(
  doc: PsDocument,
  directory: FileSystemDirectoryHandleLike,
  options: ImageAssetGeneratorRunOptions = {},
): Promise<ImageAssetGeneratorResult> {
  const result = await exportImageAssetsToZip(doc, options)
  for (let index = 0; index < result.entries.length; index++) {
    const entry = result.entries[index]
    const parts = entry.name.split("/")
    const fileName = parts.pop() ?? entry.name
    const dir = parts.length ? await directoryForPath(directory, parts) : directory
    const handle = await dir.getFileHandle(fileName, { create: true })
    const writable = await handle.createWritable()
    const writtenFormat = result.written[index]?.format ?? "png"
    const mime = writtenFormat === "svg" ? "image/svg+xml" : rasterMime(writtenFormat)
    await writable.write(new Blob([entry.data], { type: mime }))
    await writable.close()
  }
  return result
}

export function createImageAssetGeneratorReport(doc: PsDocument, resultOrPlan: ImageAssetGeneratorResult | ImageAssetGeneratorPlan): DocumentReport {
  const plan = "plan" in resultOrPlan ? resultOrPlan.plan : resultOrPlan
  const written = "written" in resultOrPlan ? resultOrPlan.written.length : 0
  const issues = "issues" in resultOrPlan ? resultOrPlan.issues : plan.issues
  const items: DocumentReport["items"] = []
  const assetCount = "written" in resultOrPlan ? written : plan.assets.length

  if (assetCount > 0) {
    items.push({
      label: "Generated assets",
      status: "preserved",
      detail: `${assetCount} asset${assetCount === 1 ? "" : "s"} generated from layer-name export specs.`,
    })
  } else {
    items.push({
      label: "Generated assets",
      status: "info",
      detail: "No valid layer-name export specs were found.",
    })
  }

  const conflicts = issues.filter((entry) => entry.kind === "conflict")
  const invalid = issues.filter((entry) => entry.kind === "invalid")
  const exportErrors = issues.filter((entry) => entry.kind === "export-error")
  if (conflicts.length) {
    items.push({
      label: "Filename conflicts",
      status: "unsupported",
      detail: `${conflicts.length} conflicting generated asset target${conflicts.length === 1 ? "" : "s"} detected: ${conflicts.slice(0, 4).map((entry) => entry.filename).join(", ")}${conflicts.length > 4 ? ", ..." : ""}.`,
    })
  }
  if (invalid.length) {
    items.push({
      label: "Invalid layer names",
      status: "unsupported",
      detail: `${invalid.length} layer-name export spec${invalid.length === 1 ? "" : "s"} could not be used: ${invalid.slice(0, 4).map((entry) => entry.filename ?? entry.sourceText ?? entry.layerName).join(", ")}${invalid.length > 4 ? ", ..." : ""}.`,
    })
  }
  if (exportErrors.length) {
    items.push({
      label: "Export failures",
      status: "unsupported",
      detail: `${exportErrors.length} generated asset${exportErrors.length === 1 ? "" : "s"} failed during browser encoding.`,
    })
  }
  items.push({
    label: "Layer-name convention",
    status: "info",
    detail: "Recognized specs use comma-separated filenames with optional scale prefixes such as icon.png, 200% icon@2x.png, and 0.5x preview.webp.",
  })

  return {
    id: `report_generator_${Math.random().toString(36).slice(2, 9)}`,
    title: `Image Assets Generator: ${doc.name}`,
    createdAt: Date.now(),
    source: "Image Assets Generator",
    items,
  }
}

export function createImageAssetGeneratorSignature(doc: PsDocument) {
  const generatorLayers = doc.layers.flatMap((layer) => {
    const parsed = parseImageAssetLayerName(layer.name)
    if (!parsed.assets.length && !parsed.issues.length) return []
    let pixelSignature = ""
    try {
      pixelSignature = typeof layer.canvas?.toDataURL === "function" ? layer.canvas.toDataURL("image/png") : ""
    } catch {
      pixelSignature = `${layer.canvas?.width ?? 0}x${layer.canvas?.height ?? 0}`
    }
    return [{
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      fillOpacity: layer.fillOpacity,
      blendMode: layer.blendMode,
      width: layer.canvas?.width ?? 0,
      height: layer.canvas?.height ?? 0,
      pixelSignature,
    }]
  })
  return JSON.stringify({
    width: doc.width,
    height: doc.height,
    layers: generatorLayers,
  })
}

export function imageAssetGeneratorSettings(settings?: ImageAssetGeneratorSettings) {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings ?? {}),
  }
}

export function shouldRunImageAssetGenerator(input: ImageAssetGeneratorAutorunInput) {
  const settings = imageAssetGeneratorSettings(input.settings)
  if (!settings.enabled || input.plan.assets.length === 0) return false
  if (input.trigger === "save") return settings.autoExportOnSave !== false
  if (settings.autoExportOnChange !== true) return false
  if (input.previousSignature && input.currentSignature && input.previousSignature === input.currentSignature) return false
  return true
}

export function safeImageAssetArchiveName(docName: string) {
  const base = docName.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").replace(/^-+|-+$/g, "")
  return `${base || "document"}-assets.zip`
}
