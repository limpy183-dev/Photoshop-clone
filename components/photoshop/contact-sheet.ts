import { makeCanvas } from "./canvas-utils"
import { createStoredZipBlob } from "./zip-packaging"

export { createStoredZipBlob, encodeStoredZip, type StoredZipEntry } from "./zip-packaging"

export type ContactSheetImageFormat = "png" | "jpeg"
export type ContactSheetExportFormat = ContactSheetImageFormat | "pdf" | "zip"
export type ContactSheetFitMode = "contain" | "cover"

export interface ContactSheetCrop {
  x: number
  y: number
  width: number
  height: number
}

export interface ContactSheetSource {
  name: string
  width: number
  height: number
  fitMode?: ContactSheetFitMode
  crop?: ContactSheetCrop
}

export interface ContactSheetRenderable extends ContactSheetSource {
  image: CanvasImageSource
}

export interface ContactSheetBaseOptions {
  pageWidth: number
  pageHeight: number
  margin: number
  spacing: number
  includeLabels: boolean
  labelFontSize: number
  labelFontFamily?: string
  labelColor?: string
  background?: string
  fitMode?: ContactSheetFitMode
  labelTemplate?: string
}

export interface ContactSheetGridOptions extends ContactSheetBaseOptions {
  columns: number
  rows: number
}

export interface PicturePackageOptions extends ContactSheetBaseOptions {
  templateId: string
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ContactSheetPlacement<T extends ContactSheetSource = ContactSheetSource> {
  source: T
  index: number
  label: string
  slot: Rect
  imageBox: Rect
  imageRect: Rect
  sourceRect: Rect
  labelRect: Rect | null
}

export interface ContactSheetLayout<T extends ContactSheetSource = ContactSheetSource> {
  kind: "contact-sheet" | "picture-package"
  width: number
  height: number
  columns: number
  rows: number
  labelHeight: number
  pageIndex: number
  pageCount: number
  sourceStartIndex: number
  sourceEndIndex: number
  placements: ContactSheetPlacement<T>[]
}

type GridTemplate = {
  id: string
  name: string
  description: string
  layout: "grid"
  columns: number
  rows: number
  aspectRatio?: number
}

type SlotTemplate = {
  id: string
  name: string
  description: string
  layout: "slots"
  slots: Rect[]
}

export type ContactSheetTemplate = GridTemplate | SlotTemplate

export interface ContactSheetPagePreset {
  id: string
  name: string
  width: number
  height: number
  description: string
}

interface ContactSheetLabelContext {
  template?: string
  index: number
  pageIndex?: number
  pageCount?: number
  totalCount?: number
}

const DEFAULT_LABEL_FONT_FAMILY = "Arial, sans-serif"

export const CONTACT_SHEET_PAGE_PRESETS: ContactSheetPagePreset[] = [
  {
    id: "screen-4x3",
    name: "Screen 4:3",
    width: 1600,
    height: 1200,
    description: "Default browser preview canvas.",
  },
  {
    id: "letter-portrait-300",
    name: "US Letter Portrait 300 ppi",
    width: 2550,
    height: 3300,
    description: "8.5 x 11 inch portrait sheet.",
  },
  {
    id: "letter-landscape-300",
    name: "US Letter Landscape 300 ppi",
    width: 3300,
    height: 2550,
    description: "11 x 8.5 inch landscape sheet.",
  },
  {
    id: "a4-portrait-300",
    name: "A4 Portrait 300 ppi",
    width: 2480,
    height: 3508,
    description: "ISO A4 portrait sheet.",
  },
  {
    id: "a4-landscape-300",
    name: "A4 Landscape 300 ppi",
    width: 3508,
    height: 2480,
    description: "ISO A4 landscape sheet.",
  },
  {
    id: "photo-4x6-300",
    name: "4 x 6 Photo 300 ppi",
    width: 1800,
    height: 1200,
    description: "Standard 4 x 6 inch landscape print.",
  },
  {
    id: "photo-5x7-300",
    name: "5 x 7 Photo 300 ppi",
    width: 2100,
    height: 1500,
    description: "Standard 5 x 7 inch landscape print.",
  },
  {
    id: "photo-8x10-300",
    name: "8 x 10 Photo 300 ppi",
    width: 3000,
    height: 2400,
    description: "Standard 8 x 10 inch landscape print.",
  },
  {
    id: "square-12x12-300",
    name: "12 x 12 Square 300 ppi",
    width: 3600,
    height: 3600,
    description: "Square proof sheet for albums and social grids.",
  },
]

export const CONTACT_SHEET_TEMPLATES: ContactSheetTemplate[] = [
  {
    id: "package-2x2",
    name: "2 x 2 Package",
    description: "Four equal print slots.",
    layout: "grid",
    columns: 2,
    rows: 2,
  },
  {
    id: "package-4x4",
    name: "4 x 4 Package",
    description: "Sixteen compact thumbnails.",
    layout: "grid",
    columns: 4,
    rows: 4,
  },
  {
    id: "wallet-8",
    name: "Wallet 8-up",
    description: "Eight wallet-size portrait slots.",
    layout: "grid",
    columns: 4,
    rows: 2,
    aspectRatio: 2.5 / 3.5,
  },
  {
    id: "print-4x6-4up",
    name: "4 x 6 4-up",
    description: "Four landscape 4 x 6 prints.",
    layout: "grid",
    columns: 2,
    rows: 2,
    aspectRatio: 6 / 4,
  },
  {
    id: "print-4x6-2up",
    name: "4 x 6 2-up",
    description: "Two landscape 4 x 6 prints.",
    layout: "grid",
    columns: 1,
    rows: 2,
    aspectRatio: 6 / 4,
  },
  {
    id: "print-5x7-2up",
    name: "5 x 7 2-up",
    description: "Two portrait 5 x 7 prints.",
    layout: "grid",
    columns: 1,
    rows: 2,
    aspectRatio: 5 / 7,
  },
  {
    id: "print-8x10",
    name: "8 x 10 Single",
    description: "One large portrait 8 x 10 print.",
    layout: "grid",
    columns: 1,
    rows: 1,
    aspectRatio: 8 / 10,
  },
  {
    id: "passport-photos",
    name: "Passport Photos",
    description: "Twelve compact square portrait slots.",
    layout: "grid",
    columns: 4,
    rows: 3,
    aspectRatio: 1,
  },
  {
    id: "school-portrait-pack",
    name: "School Portrait Pack",
    description: "One portrait, two mid-size prints, and six wallet slots.",
    layout: "slots",
    slots: [
      { x: 0, y: 0, width: 0.48, height: 0.62 },
      { x: 0.52, y: 0, width: 0.48, height: 0.29 },
      { x: 0.52, y: 0.33, width: 0.48, height: 0.29 },
      { x: 0, y: 0.68, width: 0.3, height: 0.32 },
      { x: 0.35, y: 0.68, width: 0.3, height: 0.32 },
      { x: 0.7, y: 0.68, width: 0.3, height: 0.32 },
      { x: 0, y: 0.52, width: 0.22, height: 0.12 },
      { x: 0.26, y: 0.52, width: 0.22, height: 0.12 },
      { x: 0.52, y: 0.52, width: 0.22, height: 0.12 },
    ],
  },
  {
    id: "proof-strip-12",
    name: "Proof Strip 12-up",
    description: "Twelve proofing frames for client review.",
    layout: "grid",
    columns: 3,
    rows: 4,
    aspectRatio: 4 / 5,
  },
  {
    id: "square-social-9",
    name: "Square Social 9-up",
    description: "Nine square crops for social proofing.",
    layout: "grid",
    columns: 3,
    rows: 3,
    aspectRatio: 1,
  },
  {
    id: "one-8x10-two-5x7",
    name: "8 x 10 + Two 5 x 7",
    description: "One large portrait with two 5 x 7 companion prints.",
    layout: "slots",
    slots: [
      { x: 0, y: 0, width: 0.56, height: 1 },
      { x: 0.62, y: 0, width: 0.38, height: 0.48 },
      { x: 0.62, y: 0.52, width: 0.38, height: 0.48 },
    ],
  },
  {
    id: "portrait-mix",
    name: "Portrait + Wallets",
    description: "One large portrait with four smaller copies.",
    layout: "slots",
    slots: [
      { x: 0, y: 0, width: 0.62, height: 1 },
      { x: 0.66, y: 0, width: 0.34, height: 0.235 },
      { x: 0.66, y: 0.255, width: 0.34, height: 0.235 },
      { x: 0.66, y: 0.51, width: 0.34, height: 0.235 },
      { x: 0.66, y: 0.765, width: 0.34, height: 0.235 },
    ],
  },
  {
    id: "one-5x7-two-wallets",
    name: "5 x 7 + Wallets",
    description: "One 5 x 7 portrait with two wallet copies.",
    layout: "slots",
    slots: [
      { x: 0, y: 0, width: 0.62, height: 1 },
      { x: 0.66, y: 0.08, width: 0.34, height: 0.38 },
      { x: 0.66, y: 0.54, width: 0.34, height: 0.38 },
    ],
  },
]

function finiteNumber(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(finiteNumber(value, min))))
}

function clampDimension(value: number, fallback: number) {
  return Math.max(1, Math.round(finiteNumber(value, fallback)))
}

function clampSpace(value: number, fallback: number) {
  return Math.max(0, finiteNumber(value, fallback))
}

function labelHeight(options: ContactSheetBaseOptions) {
  return options.includeLabels ? clampInt(options.labelFontSize, 6, 72) + 14 : 0
}

function clampUnit(value: number, fallback: number) {
  return Math.max(0, Math.min(1, finiteNumber(value, fallback)))
}

function filenameParts(rawName: string) {
  const filename = (rawName.trim() || "Untitled").split(/[\\/]/).pop() || "Untitled"
  const dot = filename.lastIndexOf(".")
  if (dot <= 0 || dot === filename.length - 1) {
    return { filename, name: filename, extension: "" }
  }
  return {
    filename,
    name: filename.slice(0, dot),
    extension: filename.slice(dot + 1),
  }
}

export function formatContactSheetLabel(source: ContactSheetSource, context: ContactSheetLabelContext) {
  const template = context.template?.trim() || "{filename}"
  const parts = filenameParts(source.name)
  const index = Math.max(0, Math.round(finiteNumber(context.index, 0)))
  const pageIndex = Math.max(0, Math.round(finiteNumber(context.pageIndex ?? 0, 0)))
  const pageCount = Math.max(1, Math.round(finiteNumber(context.pageCount ?? 1, 1)))
  const totalCount = Math.max(0, Math.round(finiteNumber(context.totalCount ?? index + 1, index + 1)))
  const tokens: Record<string, string> = {
    filename: parts.filename,
    file: parts.filename,
    name: parts.name,
    extension: parts.extension,
    ext: parts.extension,
    index: String(index + 1),
    page: String(pageIndex + 1),
    pages: String(pageCount),
    count: String(totalCount),
    width: String(clampDimension(source.width, 1)),
    height: String(clampDimension(source.height, 1)),
    dimensions: `${clampDimension(source.width, 1)}x${clampDimension(source.height, 1)}`,
  }
  return template.replace(/\{([a-z]+)\}/gi, (match, token: string) => tokens[token.toLowerCase()] ?? match)
}

function sourceRectFor(source: ContactSheetSource): Rect {
  const width = Math.max(1, finiteNumber(source.width, 1))
  const height = Math.max(1, finiteNumber(source.height, 1))
  const crop = source.crop
  if (!crop) return { x: 0, y: 0, width, height }
  const cropW = Math.max(0.01, Math.min(1, finiteNumber(crop.width, 1)))
  const cropH = Math.max(0.01, Math.min(1, finiteNumber(crop.height, 1)))
  const cropX = Math.min(1 - cropW, clampUnit(crop.x, 0))
  const cropY = Math.min(1 - cropH, clampUnit(crop.y, 0))
  return {
    x: cropX * width,
    y: cropY * height,
    width: cropW * width,
    height: cropH * height,
  }
}

function fitRect(sourceRect: Rect, box: Rect, mode: ContactSheetFitMode): Rect {
  const sourceW = Math.max(1, finiteNumber(sourceRect.width, 1))
  const sourceH = Math.max(1, finiteNumber(sourceRect.height, 1))
  const scale =
    mode === "cover"
      ? Math.max(box.width / sourceW, box.height / sourceH)
      : Math.min(box.width / sourceW, box.height / sourceH)
  const width = Math.max(1, sourceW * scale)
  const height = Math.max(1, sourceH * scale)
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  }
}

function placementForSlot<T extends ContactSheetSource>(
  source: T,
  index: number,
  slot: Rect,
  labelH: number,
  options: ContactSheetBaseOptions,
  context: Omit<ContactSheetLabelContext, "index">,
): ContactSheetPlacement<T> {
  const sourceRect = sourceRectFor(source)
  const fitMode = source.fitMode ?? options.fitMode ?? "contain"
  const imageBox = {
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: Math.max(1, slot.height - labelH),
  }
  const labelRect = labelH > 0
    ? { x: slot.x, y: slot.y + imageBox.height, width: slot.width, height: labelH }
    : null
  return {
    source,
    index,
    label: formatContactSheetLabel(source, { ...context, index, template: options.labelTemplate }),
    slot,
    imageBox,
    imageRect: fitRect(sourceRect, imageBox, fitMode),
    sourceRect,
    labelRect,
  }
}

function buildContactSheetLayoutInternal<T extends ContactSheetSource>(
  sources: readonly T[],
  options: ContactSheetGridOptions,
  page: {
    expandRows: boolean
    sourceOffset: number
    pageIndex: number
    pageCount: number
    totalCount: number
  },
): ContactSheetLayout<T> {
  const width = clampDimension(options.pageWidth, 1600)
  const height = clampDimension(options.pageHeight, 1200)
  const margin = Math.min(clampSpace(options.margin, 32), Math.max(0, Math.min(width, height) / 2 - 1))
  const spacing = clampSpace(options.spacing, 16)
  const columns = clampInt(options.columns, 1, 24)
  const requestedRows = clampInt(options.rows, 1, 24)
  const rows = page.expandRows ? Math.max(requestedRows, Math.ceil(sources.length / columns) || requestedRows) : requestedRows
  const labelH = labelHeight(options)
  const availableW = Math.max(1, width - margin * 2 - spacing * Math.max(0, columns - 1))
  const availableH = Math.max(1, height - margin * 2 - spacing * Math.max(0, rows - 1))
  const cellW = availableW / columns
  const cellH = availableH / rows

  const placements = sources.map((source, index) => {
    const col = index % columns
    const row = Math.floor(index / columns)
    const globalIndex = page.sourceOffset + index
    return placementForSlot(
      source,
      globalIndex,
      {
        x: margin + col * (cellW + spacing),
        y: margin + row * (cellH + spacing),
        width: cellW,
        height: cellH,
      },
      labelH,
      options,
      {
        pageIndex: page.pageIndex,
        pageCount: page.pageCount,
        totalCount: page.totalCount,
      },
    )
  })

  return {
    kind: "contact-sheet",
    width,
    height,
    columns,
    rows,
    labelHeight: labelH,
    pageIndex: page.pageIndex,
    pageCount: page.pageCount,
    sourceStartIndex: placements.length ? page.sourceOffset : -1,
    sourceEndIndex: placements.length ? page.sourceOffset + placements.length - 1 : -1,
    placements,
  }
}

export function buildContactSheetLayout<T extends ContactSheetSource>(
  sources: readonly T[],
  options: ContactSheetGridOptions,
): ContactSheetLayout<T> {
  return buildContactSheetLayoutInternal(sources, options, {
    expandRows: true,
    sourceOffset: 0,
    pageIndex: 0,
    pageCount: 1,
    totalCount: sources.length,
  })
}

export function buildContactSheetPages<T extends ContactSheetSource>(
  sources: readonly T[],
  options: ContactSheetGridOptions,
): ContactSheetLayout<T>[] {
  const columns = clampInt(options.columns, 1, 24)
  const rows = clampInt(options.rows, 1, 24)
  const perPage = Math.max(1, columns * rows)
  const pageCount = Math.max(1, Math.ceil(sources.length / perPage))
  return Array.from({ length: pageCount }, (_, pageIndex) => {
    const start = pageIndex * perPage
    return buildContactSheetLayoutInternal(sources.slice(start, start + perPage), options, {
      expandRows: false,
      sourceOffset: start,
      pageIndex,
      pageCount,
      totalCount: sources.length,
    })
  })
}

function gridTemplateSlots(template: GridTemplate, width: number, height: number, margin: number, spacing: number): Rect[] {
  const contentW = Math.max(1, width - margin * 2)
  const contentH = Math.max(1, height - margin * 2)
  const cellW = Math.max(1, (contentW - spacing * Math.max(0, template.columns - 1)) / template.columns)
  const maxCellH = Math.max(1, (contentH - spacing * Math.max(0, template.rows - 1)) / template.rows)
  const cellH = template.aspectRatio ? Math.min(maxCellH, cellW / template.aspectRatio) : maxCellH
  const totalH = cellH * template.rows + spacing * Math.max(0, template.rows - 1)
  const startY = margin + Math.max(0, (contentH - totalH) / 2)

  return Array.from({ length: template.columns * template.rows }, (_, index) => {
    const col = index % template.columns
    const row = Math.floor(index / template.columns)
    return {
      x: margin + col * (cellW + spacing),
      y: startY + row * (cellH + spacing),
      width: cellW,
      height: cellH,
    }
  })
}

function fixedTemplateSlots(template: SlotTemplate, width: number, height: number, margin: number): Rect[] {
  const contentW = Math.max(1, width - margin * 2)
  const contentH = Math.max(1, height - margin * 2)
  return template.slots.map((slot) => ({
    x: margin + slot.x * contentW,
    y: margin + slot.y * contentH,
    width: slot.width * contentW,
    height: slot.height * contentH,
  }))
}

export function getContactSheetTemplate(templateId: string) {
  return CONTACT_SHEET_TEMPLATES.find((template) => template.id === templateId) ?? CONTACT_SHEET_TEMPLATES[0]
}

export function buildPicturePackageLayout<T extends ContactSheetSource>(
  sources: readonly T[],
  options: PicturePackageOptions,
): ContactSheetLayout<T> {
  const width = clampDimension(options.pageWidth, 1600)
  const height = clampDimension(options.pageHeight, 1200)
  const margin = Math.min(clampSpace(options.margin, 32), Math.max(0, Math.min(width, height) / 2 - 1))
  const spacing = clampSpace(options.spacing, 16)
  const template = getContactSheetTemplate(options.templateId)
  const labelH = labelHeight(options)
  const slots = template.layout === "grid"
    ? gridTemplateSlots(template, width, height, margin, spacing)
    : fixedTemplateSlots(template, width, height, margin)
  const placements = sources.length
    ? slots.map((slot, index) => placementForSlot(sources[index % sources.length], index, slot, labelH, options, {
      pageIndex: 0,
      pageCount: 1,
      totalCount: slots.length,
    }))
    : []

  return {
    kind: "picture-package",
    width,
    height,
    columns: template.layout === "grid" ? template.columns : 1,
    rows: template.layout === "grid" ? template.rows : slots.length,
    labelHeight: labelH,
    pageIndex: 0,
    pageCount: 1,
    sourceStartIndex: placements.length ? 0 : -1,
    sourceEndIndex: placements.length ? Math.max(0, sources.length - 1) : -1,
    placements,
  }
}

function drawFittedImage(ctx: CanvasRenderingContext2D, source: ContactSheetRenderable, placement: ContactSheetPlacement) {
  ctx.save()
  ctx.beginPath()
  ctx.rect(placement.imageBox.x, placement.imageBox.y, placement.imageBox.width, placement.imageBox.height)
  ctx.clip()
  ctx.drawImage(
    source.image,
    placement.sourceRect.x,
    placement.sourceRect.y,
    placement.sourceRect.width,
    placement.sourceRect.height,
    placement.imageRect.x,
    placement.imageRect.y,
    placement.imageRect.width,
    placement.imageRect.height,
  )
  ctx.restore()
}

function ellipsizeText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const candidate = `${text.slice(0, mid)}...`
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return `${text.slice(0, lo)}...`
}

function drawLabel(ctx: CanvasRenderingContext2D, placement: ContactSheetPlacement, options: ContactSheetBaseOptions) {
  if (!placement.labelRect) return
  const fontSize = clampInt(options.labelFontSize, 6, 72)
  ctx.save()
  ctx.fillStyle = options.labelColor ?? "#111111"
  ctx.font = `${fontSize}px ${options.labelFontFamily ?? DEFAULT_LABEL_FONT_FAMILY}`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  const label = ellipsizeText(ctx, placement.label, Math.max(8, placement.labelRect.width - 8))
  ctx.fillText(
    label,
    placement.labelRect.x + placement.labelRect.width / 2,
    placement.labelRect.y + placement.labelRect.height / 2,
  )
  ctx.restore()
}

export function renderContactSheetCanvas<T extends ContactSheetRenderable>(
  sources: readonly T[],
  layout: ContactSheetLayout<T>,
  options: ContactSheetBaseOptions,
): HTMLCanvasElement {
  const canvas = makeCanvas(layout.width, layout.height, options.background ?? "#ffffff")
  const ctx = canvas.getContext("2d")
  if (!ctx) return canvas
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"

  for (const placement of layout.placements) {
    drawFittedImage(ctx, placement.source, placement)
    drawLabel(ctx, placement, options)
  }
  return canvas
}

export function exportMimeForContactSheet(format: ContactSheetExportFormat) {
  if (format === "jpeg") return "image/jpeg"
  if (format === "pdf") return "application/pdf"
  if (format === "zip") return "application/zip"
  return "image/png"
}

export function exportContactSheetBlob(
  canvas: HTMLCanvasElement,
  format: ContactSheetImageFormat,
  quality = 0.92,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not export contact sheet"))
          return
        }
        resolve(blob)
      },
      exportMimeForContactSheet(format),
      quality,
    )
  })
}

function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? ""
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function exportContactSheetPdfBlob(
  canvases: readonly HTMLCanvasElement[],
  title = "Contact Sheet",
): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib")
  const pdf = await PDFDocument.create()
  for (const canvas of canvases) {
    const width = Math.max(1, canvas.width)
    const height = Math.max(1, canvas.height)
    const page = pdf.addPage([width, height])
    try {
      const image = await pdf.embedPng(dataUrlToBytes(canvas.toDataURL("image/png")))
      page.drawImage(image, { x: 0, y: 0, width, height })
    } catch {
      page.drawText(title.slice(0, 80), { x: 12, y: Math.max(12, height - 24), size: 12 })
    }
  }
  const bytes = await pdf.save()
  return new Blob([bytes], { type: "application/pdf" })
}

export async function exportContactSheetZipBlob(
  canvases: readonly HTMLCanvasElement[],
  options: {
    format: ContactSheetImageFormat
    quality?: number
    filenamePrefix?: string
  },
): Promise<Blob> {
  const format = options.format
  const ext = format === "jpeg" ? "jpg" : "png"
  const prefix = (options.filenamePrefix?.trim() || "contact-sheet").replace(/[\\/:*?"<>|]+/g, "-")
  const entries = await Promise.all(canvases.map(async (canvas, index) => {
    const blob = await exportContactSheetBlob(canvas, format, options.quality)
    return {
      name: `${prefix}-page-${index + 1}.${ext}`,
      data: new Uint8Array(await blob.arrayBuffer()),
    }
  }))
  return createStoredZipBlob(entries)
}
