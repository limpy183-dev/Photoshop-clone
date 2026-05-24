import { makeCanvas } from "./canvas-utils"

export type ContactSheetExportFormat = "png" | "jpeg"
export type ContactSheetFitMode = "contain" | "cover"

export interface ContactSheetSource {
  name: string
  width: number
  height: number
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
  labelRect: Rect | null
}

export interface ContactSheetLayout<T extends ContactSheetSource = ContactSheetSource> {
  kind: "contact-sheet" | "picture-package"
  width: number
  height: number
  columns: number
  rows: number
  labelHeight: number
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

const DEFAULT_LABEL_FONT_FAMILY = "Arial, sans-serif"

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

function imageLabel(source: ContactSheetSource) {
  return source.name.trim() || "Untitled"
}

function fitRect(source: ContactSheetSource, box: Rect, mode: ContactSheetFitMode): Rect {
  const sourceW = Math.max(1, finiteNumber(source.width, 1))
  const sourceH = Math.max(1, finiteNumber(source.height, 1))
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
  fitMode: ContactSheetFitMode,
): ContactSheetPlacement<T> {
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
    label: imageLabel(source),
    slot,
    imageBox,
    imageRect: fitRect(source, imageBox, fitMode),
    labelRect,
  }
}

export function buildContactSheetLayout<T extends ContactSheetSource>(
  sources: readonly T[],
  options: ContactSheetGridOptions,
): ContactSheetLayout<T> {
  const width = clampDimension(options.pageWidth, 1600)
  const height = clampDimension(options.pageHeight, 1200)
  const margin = Math.min(clampSpace(options.margin, 32), Math.max(0, Math.min(width, height) / 2 - 1))
  const spacing = clampSpace(options.spacing, 16)
  const columns = clampInt(options.columns, 1, 24)
  const requestedRows = clampInt(options.rows, 1, 24)
  const rows = Math.max(requestedRows, Math.ceil(sources.length / columns) || requestedRows)
  const labelH = labelHeight(options)
  const availableW = Math.max(1, width - margin * 2 - spacing * Math.max(0, columns - 1))
  const availableH = Math.max(1, height - margin * 2 - spacing * Math.max(0, rows - 1))
  const cellW = availableW / columns
  const cellH = availableH / rows
  const fitMode = options.fitMode ?? "contain"

  const placements = sources.map((source, index) => {
    const col = index % columns
    const row = Math.floor(index / columns)
    return placementForSlot(
      source,
      index,
      {
        x: margin + col * (cellW + spacing),
        y: margin + row * (cellH + spacing),
        width: cellW,
        height: cellH,
      },
      labelH,
      fitMode,
    )
  })

  return {
    kind: "contact-sheet",
    width,
    height,
    columns,
    rows,
    labelHeight: labelH,
    placements,
  }
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
  const fitMode = options.fitMode ?? "contain"
  const placements = sources.length
    ? slots.map((slot, index) => placementForSlot(sources[index % sources.length], index, slot, labelH, fitMode))
    : []

  return {
    kind: "picture-package",
    width,
    height,
    columns: template.layout === "grid" ? template.columns : 1,
    rows: template.layout === "grid" ? template.rows : slots.length,
    labelHeight: labelH,
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
  return format === "jpeg" ? "image/jpeg" : "image/png"
}

export function exportContactSheetBlob(
  canvas: HTMLCanvasElement,
  format: ContactSheetExportFormat,
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
