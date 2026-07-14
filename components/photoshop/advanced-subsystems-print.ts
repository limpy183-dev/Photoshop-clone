import type { PrintSettings, PsDocument } from "./types"
import { createSubsystemCanvas } from "./advanced-subsystems-shared"

function pageSizePx(settings: PrintSettings) {
  const landscape = settings.orientation === "landscape"
  const sizes: Record<PrintSettings["paperSize"], { w: number; h: number }> = {
    Letter: { w: 816, h: 1056 },
    A4: { w: 794, h: 1123 },
    A3: { w: 1123, h: 1587 },
    Tabloid: { w: 1056, h: 1632 },
    Custom: { w: 960, h: 1200 },
  }
  const size = sizes[settings.paperSize]
  return landscape ? { w: size.h, h: size.w } : size
}

function mmToPx(mm: number) {
  return (mm / 25.4) * 96
}

export interface PrintPreviewMark {
  kind: "crop" | "registration" | "center" | "center-crop" | "color-bars" | "description" | "labels" | "bleed" | "label"
  enabled: boolean
  label: string
  description: string
  geometry?: { x: number; y: number; width: number; height: number }
}

export interface PrintPreviewRisk {
  id: string
  severity: "info" | "warn" | "error"
  category: "scope" | "marks" | "bleed" | "placement" | "proof" | "profile" | "raster"
  detail: string
}

export interface PrintPreviewReport {
  documentName: string
  certifiedPrepressOutput: false
  page: { width: number; height: number; paperSize: PrintSettings["paperSize"]; orientation: PrintSettings["orientation"] }
  pagePosition: NonNullable<PrintSettings["pagePosition"]>
  scalePercent: number
  contentRect: { x: number; y: number; width: number; height: number }
  trimRect: { x: number; y: number; width: number; height: number }
  bleed: { requestedMm: number; pixels: number; trimInsetPx: number }
  marks: PrintPreviewMark[]
  proof: {
    enabled: boolean
    colorHandling: PrintSettings["colorHandling"]
    printerProfile: PrintSettings["printerProfile"] | "Unspecified"
    documentProfile?: string
  }
  limitations: string[]
  risks: PrintPreviewRisk[]
}

export function buildPrintPreviewReport(
  flat: HTMLCanvasElement,
  settings: PrintSettings,
  docName: string,
  doc?: PsDocument,
): PrintPreviewReport {
  const page = pageSizePx(settings)
  const bleedPx = mmToPx(settings.bleedMm)
  const marksOffset = mmToPx(settings.marksOffsetMm ?? 4)
  const anyMarksForPad = settings.cropMarks || settings.registrationMarks || settings.centerCropMarks || settings.colorBars || settings.description || settings.labels || settings.bleedMm > 0
  const pad = anyMarksForPad ? 64 + marksOffset : 24
  const pageX = pad
  const pageY = pad
  const printableW = Math.max(1, page.w - bleedPx * 2)
  const printableH = Math.max(1, page.h - bleedPx * 2)
  const drawW = Math.min(printableW, flat.width * (settings.scale / 100))
  const drawH = Math.min(printableH, flat.height * (settings.scale / 100))
  const pagePosition = settings.pagePosition ?? "center"
  const contentX = pagePosition === "top-left" ? pageX + bleedPx : pageX + (page.w - drawW) / 2
  const contentY = pagePosition === "top-left" ? pageY + bleedPx : pageY + (page.h - drawH) / 2
  const label = `${docName} - ${settings.paperSize} - ${settings.colorHandling === "app" ? "app color managed" : "printer color managed"}`
  const documentProfile = doc?.colorManagement?.assignedProfile
  const proofProfile = settings.printerProfile ?? doc?.colorManagement?.proofProfile ?? "Unspecified"
  const risks: PrintPreviewRisk[] = [
    {
      id: "browser-print-not-certified",
      severity: "info",
      category: "scope",
      detail: "Browser print preview is a composited canvas aid, not certified prepress, PDF/X, or contract-proof output.",
    },
  ]

  if (settings.bleedMm <= 0) {
    risks.push({ id: "bleed-missing", severity: "warn", category: "bleed", detail: "No bleed is requested; many printers require 3mm or more." })
  } else if (settings.bleedMm < 3) {
    risks.push({ id: "bleed-below-3mm", severity: "warn", category: "bleed", detail: `${settings.bleedMm}mm bleed is below the common 3mm print requirement.` })
  }
  if (!settings.cropMarks && !settings.registrationMarks) {
    risks.push({ id: "marks-missing", severity: "warn", category: "marks", detail: "Crop and registration marks are disabled." })
  }
  if (pagePosition === "top-left") {
    risks.push({ id: "top-left-placement", severity: "warn", category: "placement", detail: "Top-left placement can hide centering or imposition problems." })
  }
  if (flat.width * (settings.scale / 100) > printableW || flat.height * (settings.scale / 100) > printableH) {
    risks.push({ id: "scaled-content-clipped", severity: "warn", category: "placement", detail: "Scaled artwork exceeds the trim-safe image area and is being constrained in preview." })
  }
  if (settings.proofPrint && (!proofProfile || proofProfile === "None")) {
    risks.push({ id: "proof-profile-missing", severity: "warn", category: "proof", detail: "Proof print is enabled without a printer/proof profile." })
  }
  if (settings.proofPrint || documentProfile || proofProfile !== "Unspecified") {
    risks.push({
      id: "icc-profile-limitation",
      severity: "warn",
      category: "profile",
      detail: "Profile and proof settings are represented as report metadata; the browser canvas path does not run certified ICC conversion or embed ICC output here.",
    })
  }
  if ((doc?.bitDepth ?? 8) > 8 || doc?.colorMode === "CMYK" || doc?.colorMode === "Multichannel" || (doc?.channels?.length ?? 0) > 0) {
    risks.push({
      id: "raster-flattening",
      severity: "warn",
      category: "raster",
      detail: "High-bit, CMYK/multichannel, alpha, and spot-channel intent is flattened into an 8-bit RGBA preview for browser printing.",
    })
  }

  return {
    documentName: docName,
    certifiedPrepressOutput: false,
    page: { width: page.w, height: page.h, paperSize: settings.paperSize, orientation: settings.orientation },
    pagePosition,
    scalePercent: settings.scale,
    contentRect: { x: contentX, y: contentY, width: drawW, height: drawH },
    trimRect: { x: pageX, y: pageY, width: page.w, height: page.h },
    bleed: { requestedMm: settings.bleedMm, pixels: bleedPx, trimInsetPx: bleedPx },
    marks: [
      {
        kind: "crop",
        enabled: settings.cropMarks,
        label: "Crop marks",
        description: "Corner trim indicators drawn outside the page edge.",
        geometry: { x: pageX - marksOffset - 36, y: pageY - marksOffset - 36, width: page.w + marksOffset * 2 + 72, height: page.h + marksOffset * 2 + 72 },
      },
      {
        kind: "center-crop",
        enabled: !!settings.centerCropMarks,
        label: "Center-crop marks",
        description: "Tick marks at the midpoint of each page edge for trim alignment.",
        geometry: { x: pageX, y: pageY, width: page.w, height: page.h },
      },
      {
        kind: "registration",
        enabled: settings.registrationMarks,
        label: "Registration marks",
        description: "Crosshair targets for visual plate alignment checks in the preview.",
        geometry: { x: pageX - 50, y: pageY - 50, width: page.w + 100, height: page.h + 100 },
      },
      {
        kind: "color-bars",
        enabled: !!settings.colorBars,
        label: "Color bars",
        description: "Process and tint patches drawn alongside the page for press calibration reference.",
        geometry: { x: pageX, y: pageY - marksOffset - 12, width: page.w, height: 12 },
      },
      {
        kind: "description",
        enabled: !!settings.description,
        label: "Description",
        description: "Page description string drawn below the trim edge.",
        geometry: { x: pageX, y: pageY + page.h + marksOffset, width: page.w, height: 18 },
      },
      {
        kind: "labels",
        enabled: !!settings.labels,
        label: "Labels",
        description: "File-name label drawn above the trim edge.",
        geometry: { x: pageX, y: pageY - marksOffset - 22, width: page.w, height: 18 },
      },
      {
        kind: "bleed",
        enabled: settings.bleedMm > 0,
        label: "Bleed guide",
        description: "Dashed red guide shows the bleed inset used by the browser preview.",
        geometry: { x: pageX + bleedPx, y: pageY + bleedPx, width: page.w - bleedPx * 2, height: page.h - bleedPx * 2 },
      },
      {
        kind: "label",
        enabled: true,
        label,
        description: "Human-readable preview label only; not production slug metadata.",
      },
    ],
    proof: {
      enabled: settings.proofPrint,
      colorHandling: settings.colorHandling,
      printerProfile: proofProfile,
      documentProfile,
    },
    limitations: [
      "Browser print is not certified prepress output.",
      "ICC transforms, embedded profiles, PDF/X metadata, trapping, spot plates, and separations are not emitted by this canvas preview.",
      "Use the generated data as a risk report and verify final production files in a dedicated prepress workflow.",
    ],
    risks,
  }
}

export function buildPrintPreviewCanvas(flat: HTMLCanvasElement, settings: PrintSettings, docName: string) {
  const report = buildPrintPreviewReport(flat, settings, docName)
  const page = pageSizePx(settings)
  const bleed = mmToPx(settings.bleedMm)
  const marksOffset = mmToPx(settings.marksOffsetMm ?? 4)
  const anyMarks = settings.cropMarks || settings.registrationMarks ||
    settings.centerCropMarks || settings.colorBars || settings.description ||
    settings.labels || settings.bleedMm > 0
  const pad = anyMarks ? 80 + marksOffset : 24
  const canvas = createSubsystemCanvas(page.w + pad * 2, page.h + pad * 2, settings.paperColor ?? "#ffffff")
  const ctx = canvas.getContext("2d")!
  const pageX = pad
  const pageY = pad
  ctx.fillStyle = settings.paperColor ?? "#ffffff"
  ctx.fillRect(pageX, pageY, page.w, page.h)
  ctx.strokeStyle = "#d4d4d4"
  ctx.strokeRect(pageX, pageY, page.w, page.h)
  const drawW = Math.min(page.w - bleed * 2, flat.width * (settings.scale / 100))
  const drawH = Math.min(page.h - bleed * 2, flat.height * (settings.scale / 100))
  const x = settings.pagePosition === "top-left" ? pageX + bleed : pageX + (page.w - drawW) / 2
  const y = settings.pagePosition === "top-left" ? pageY + bleed : pageY + (page.h - drawH) / 2
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(flat, x, y, drawW, drawH)
  if (settings.bleedMm > 0) {
    ctx.setLineDash([6, 4])
    ctx.strokeStyle = "#ef4444"
    ctx.strokeRect(pageX + bleed, pageY + bleed, page.w - bleed * 2, page.h - bleed * 2)
    ctx.setLineDash([])
  }
  if (settings.cropMarks) drawCropMarks(ctx, pageX, pageY, page.w, page.h, marksOffset)
  if (settings.centerCropMarks) drawCenterCropMarks(ctx, pageX, pageY, page.w, page.h, marksOffset)
  if (settings.registrationMarks) drawRegistrationMarks(ctx, pageX, pageY, page.w, page.h)
  if (settings.colorBars) drawColorBars(ctx, pageX, pageY, page.w, page.h, marksOffset)
  if (settings.description) drawPrintDescription(ctx, pageX, pageY, page.w, page.h, settings, flat, marksOffset)
  if (settings.labels) drawPrintLabels(ctx, pageX, pageY, page.w, page.h, docName, marksOffset)
  ctx.fillStyle = "#111827"
  ctx.font = "12px sans-serif"
  ctx.fillText(`${docName} - ${settings.paperSize} - ${settings.colorHandling === "app" ? "app color managed" : "printer color managed"}`, pageX, canvas.height - 18)
  ;(canvas as HTMLCanvasElement & { __printPreviewReport?: PrintPreviewReport }).__printPreviewReport = report
  return canvas
}

function drawCropMarks(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, offset: number) {
  ctx.strokeStyle = "#111827"
  ctx.lineWidth = 1
  const len = 36
  const marks = [
    [x - offset - len, y, x - offset, y], [x, y - offset - len, x, y - offset],
    [x + w + offset, y, x + w + offset + len, y], [x + w, y - offset - len, x + w, y - offset],
    [x - offset - len, y + h, x - offset, y + h], [x, y + h + offset, x, y + h + offset + len],
    [x + w + offset, y + h, x + w + offset + len, y + h], [x + w, y + h + offset, x + w, y + h + offset + len],
  ]
  for (const [x1, y1, x2, y2] of marks) {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
}

function drawRegistrationMarks(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const points = [[x + w / 2, y - 34], [x + w / 2, y + h + 34], [x - 34, y + h / 2], [x + w + 34, y + h / 2]]
  ctx.strokeStyle = "#111827"
  for (const [cx, cy] of points) {
    ctx.beginPath()
    ctx.arc(cx, cy, 10, 0, Math.PI * 2)
    ctx.moveTo(cx - 16, cy)
    ctx.lineTo(cx + 16, cy)
    ctx.moveTo(cx, cy - 16)
    ctx.lineTo(cx, cy + 16)
    ctx.stroke()
  }
}

function drawCenterCropMarks(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, offset: number) {
  ctx.strokeStyle = "#111827"
  ctx.lineWidth = 1
  const len = 24
  const cx = x + w / 2
  const cy = y + h / 2
  const segments = [
    [cx, y - offset - len, cx, y - offset],
    [cx, y + h + offset, cx, y + h + offset + len],
    [x - offset - len, cy, x - offset, cy],
    [x + w + offset, cy, x + w + offset + len, cy],
  ]
  for (const [x1, y1, x2, y2] of segments) {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
}

function drawColorBars(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, offset: number) {
  const swatches = [
    "#000000", "#404040", "#808080", "#c0c0c0", "#ffffff",
    "#00ffff", "#ff00ff", "#ffff00",
    "#ff0000", "#00ff00", "#0000ff",
  ]
  const swatchW = Math.max(10, Math.min(28, w / (swatches.length + 1)))
  const swatchH = 12
  const totalW = swatchW * swatches.length
  const startX = x + (w - totalW) / 2
  const barY = y + h + offset + 16
  for (let i = 0; i < swatches.length; i++) {
    ctx.fillStyle = swatches[i]
    ctx.fillRect(startX + i * swatchW, barY, swatchW, swatchH)
  }
  ctx.strokeStyle = "#111827"
  ctx.lineWidth = 1
  ctx.strokeRect(startX, barY, totalW, swatchH)
}

function drawPrintDescription(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  settings: PrintSettings,
  flat: HTMLCanvasElement,
  offset: number,
) {
  const lines = [
    `Paper: ${settings.paperSize} (${settings.orientation})`,
    `Scale: ${settings.scale}%   Bleed: ${settings.bleedMm}mm`,
    `Source: ${flat.width} x ${flat.height} px`,
    `Color: ${settings.colorHandling === "app" ? "App-managed" : "Printer-managed"}${settings.proofPrint ? " - proof" : ""}`,
  ]
  ctx.fillStyle = "#111827"
  ctx.font = "10px sans-serif"
  ctx.textBaseline = "top"
  const textX = x
  let textY = y + h + offset + 34
  for (const line of lines) {
    ctx.fillText(line, textX, textY)
    textY += 12
  }
  ctx.textBaseline = "alphabetic"
}

function drawPrintLabels(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  _h: number,
  docName: string,
  offset: number,
) {
  ctx.fillStyle = "#111827"
  ctx.font = "bold 11px sans-serif"
  ctx.textBaseline = "alphabetic"
  const labelY = y - offset - 18
  ctx.fillText(docName, x, labelY)
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ")
  const stampMetrics = ctx.measureText(stamp)
  ctx.font = "10px sans-serif"
  ctx.fillText(stamp, x + w - stampMetrics.width - 4, labelY)
}
