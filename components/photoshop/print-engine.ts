/**
 * Print engine: layout computation, print marks, preview rendering, and
 * browser print integration.
 *
 * Gaps #149, #150 from comprehensive-implementation-gaps.txt.
 */

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type PrintMarkType = "registration" | "corner-crop" | "center-crop" | "description" | "labels" | "color-bars"

export interface PrintMarksSettings {
  registration: boolean
  cornerCrop: boolean
  centerCrop: boolean
  description: boolean
  labels: boolean
  colorBars: boolean
}

export interface PrintPosition {
  x: number  // mm from top-left
  y: number
  centered: boolean
}

export interface PrintSettings {
  paperWidth: number
  paperHeight: number
  orientation: "portrait" | "landscape"
  position: PrintPosition
  scaleToFit: boolean
  scalePct: number
  printResolution: number
  printSelectedArea: boolean
  marks: PrintMarksSettings
  bleed: number
  backgroundColor: string | null
  borderWidth: number
  borderColor: string
  colorHandling: "printer" | "photoshop"
  renderingIntent: "perceptual" | "relative-colorimetric" | "saturation" | "absolute-colorimetric"
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paperWidth: 210,
  paperHeight: 297,
  orientation: "portrait",
  position: { x: 0, y: 0, centered: true },
  scaleToFit: true,
  scalePct: 100,
  printResolution: 300,
  printSelectedArea: false,
  marks: {
    registration: false,
    cornerCrop: false,
    centerCrop: false,
    description: false,
    labels: false,
    colorBars: false,
  },
  bleed: 0,
  backgroundColor: null,
  borderWidth: 0,
  borderColor: "#000000",
  colorHandling: "printer",
  renderingIntent: "relative-colorimetric",
}

export const PAPER_SIZES: Array<{ id: string; label: string; width: number; height: number }> = [
  { id: "letter", label: "US Letter", width: 215.9, height: 279.4 },
  { id: "legal", label: "US Legal", width: 215.9, height: 355.6 },
  { id: "tabloid", label: "Tabloid (11×17)", width: 279.4, height: 431.8 },
  { id: "a3", label: "A3", width: 297, height: 420 },
  { id: "a4", label: "A4", width: 210, height: 297 },
  { id: "a5", label: "A5", width: 148, height: 210 },
  { id: "b5", label: "B5 (JIS)", width: 182, height: 257 },
  { id: "4x6", label: "4 × 6 in", width: 101.6, height: 152.4 },
  { id: "5x7", label: "5 × 7 in", width: 127, height: 177.8 },
  { id: "8x10", label: "8 × 10 in", width: 203.2, height: 254 },
  { id: "a2", label: "A2", width: 420, height: 594 },
  { id: "a6", label: "A6", width: 105, height: 148 },
]

// ---------------------------------------------------------------------------
//  Layout computation
// ---------------------------------------------------------------------------

export interface PrintLayout {
  pageRect: { x: number; y: number; width: number; height: number }
  imageRect: { x: number; y: number; width: number; height: number }
  bleedRect: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  fitsOnPage: boolean
}

const MM_PER_INCH = 25.4

/** Compute the print layout for a document on the configured paper. */
export function computePrintLayout(
  docWidth: number,
  docHeight: number,
  docDpi: number,
  settings: PrintSettings,
): PrintLayout {
  const pw = settings.orientation === "landscape" ? settings.paperHeight : settings.paperWidth
  const ph = settings.orientation === "landscape" ? settings.paperWidth : settings.paperHeight

  // Image physical size in mm at document DPI
  const imgWidthMm = (docWidth / docDpi) * MM_PER_INCH
  const imgHeightMm = (docHeight / docDpi) * MM_PER_INCH

  let scale = settings.scalePct / 100
  if (settings.scaleToFit) {
    const fitScale = Math.min(pw / imgWidthMm, ph / imgHeightMm)
    scale = Math.min(fitScale, scale)
  }

  const scaledW = imgWidthMm * scale
  const scaledH = imgHeightMm * scale

  let ix: number, iy: number
  if (settings.position.centered) {
    ix = (pw - scaledW) / 2
    iy = (ph - scaledH) / 2
  } else {
    ix = settings.position.x
    iy = settings.position.y
  }

  const bleed = settings.bleed
  return {
    pageRect: { x: 0, y: 0, width: pw, height: ph },
    imageRect: { x: ix, y: iy, width: scaledW, height: scaledH },
    bleedRect: { x: ix - bleed, y: iy - bleed, width: scaledW + bleed * 2, height: scaledH + bleed * 2 },
    scaleFactor: scale,
    fitsOnPage: scaledW <= pw && scaledH <= ph,
  }
}

// ---------------------------------------------------------------------------
//  Print marks rendering
// ---------------------------------------------------------------------------

/** Convert mm to pixels for on-screen preview at a given scale. */
function mmToPreviewPx(mm: number, previewScale: number): number {
  return mm * previewScale
}

/** Render print marks (registration, crop, color bars, etc.) */
export function renderPrintMarks(
  ctx: CanvasRenderingContext2D,
  layout: PrintLayout,
  settings: PrintSettings,
  docTitle: string,
  previewScale: number = 3, // px per mm for preview
): void {
  const s = previewScale
  const marks = settings.marks
  const img = layout.imageRect

  ctx.save()
  ctx.strokeStyle = "#000"
  ctx.lineWidth = 0.5

  // Corner crop marks
  if (marks.cornerCrop) {
    const markLen = mmToPreviewPx(8, s)
    const offset = mmToPreviewPx(2, s)
    const corners = [
      { x: img.x * s, y: img.y * s },
      { x: (img.x + img.width) * s, y: img.y * s },
      { x: img.x * s, y: (img.y + img.height) * s },
      { x: (img.x + img.width) * s, y: (img.y + img.height) * s },
    ]
    for (const corner of corners) {
      const isLeft = corner.x <= (img.x + img.width / 2) * s
      const isTop = corner.y <= (img.y + img.height / 2) * s
      const hDir = isLeft ? -1 : 1
      const vDir = isTop ? -1 : 1

      ctx.beginPath()
      ctx.moveTo(corner.x + hDir * offset, corner.y)
      ctx.lineTo(corner.x + hDir * (offset + markLen), corner.y)
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(corner.x, corner.y + vDir * offset)
      ctx.lineTo(corner.x, corner.y + vDir * (offset + markLen))
      ctx.stroke()
    }
  }

  // Center crop marks
  if (marks.centerCrop) {
    const markLen = mmToPreviewPx(6, s)
    const cx = (img.x + img.width / 2) * s
    const cy = (img.y + img.height / 2) * s
    const offset = mmToPreviewPx(2, s)

    // Top center
    ctx.beginPath()
    ctx.moveTo(cx, img.y * s - offset)
    ctx.lineTo(cx, img.y * s - offset - markLen)
    ctx.stroke()
    // Bottom center
    ctx.beginPath()
    ctx.moveTo(cx, (img.y + img.height) * s + offset)
    ctx.lineTo(cx, (img.y + img.height) * s + offset + markLen)
    ctx.stroke()
    // Left center
    ctx.beginPath()
    ctx.moveTo(img.x * s - offset, cy)
    ctx.lineTo(img.x * s - offset - markLen, cy)
    ctx.stroke()
    // Right center
    ctx.beginPath()
    ctx.moveTo((img.x + img.width) * s + offset, cy)
    ctx.lineTo((img.x + img.width) * s + offset + markLen, cy)
    ctx.stroke()
  }

  // Registration marks (target/crosshair at corners)
  if (marks.registration) {
    const regSize = mmToPreviewPx(4, s)
    const offset = mmToPreviewPx(12, s)
    const positions = [
      { x: img.x * s - offset, y: img.y * s - offset },
      { x: (img.x + img.width) * s + offset, y: img.y * s - offset },
      { x: img.x * s - offset, y: (img.y + img.height) * s + offset },
      { x: (img.x + img.width) * s + offset, y: (img.y + img.height) * s + offset },
    ]
    for (const pos of positions) {
      // Crosshair
      ctx.beginPath()
      ctx.moveTo(pos.x - regSize, pos.y)
      ctx.lineTo(pos.x + regSize, pos.y)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(pos.x, pos.y - regSize)
      ctx.lineTo(pos.x, pos.y + regSize)
      ctx.stroke()
      // Circle
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, regSize * 0.6, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  // Color bars
  if (marks.colorBars) {
    const barH = mmToPreviewPx(4, s)
    const barW = mmToPreviewPx(3, s)
    const startX = img.x * s
    const startY = (img.y + img.height) * s + mmToPreviewPx(8, s)
    const colors = ["#00ffff", "#ff00ff", "#ffff00", "#000000", "#ff0000", "#00ff00", "#0000ff", "#ffffff"]
    for (let i = 0; i < colors.length; i++) {
      ctx.fillStyle = colors[i]
      ctx.fillRect(startX + i * barW, startY, barW, barH)
      ctx.strokeRect(startX + i * barW, startY, barW, barH)
    }
  }

  // Labels (filename + date)
  if (marks.labels) {
    ctx.fillStyle = "#000"
    ctx.font = `${mmToPreviewPx(2.5, s)}px sans-serif`
    ctx.textAlign = "left"
    ctx.fillText(docTitle, img.x * s, (img.y + img.height) * s + mmToPreviewPx(16, s))
  }

  // Description
  if (marks.description) {
    ctx.fillStyle = "#666"
    ctx.font = `${mmToPreviewPx(2, s)}px sans-serif`
    ctx.textAlign = "left"
    const desc = `${Math.round(img.width)}×${Math.round(img.height)}mm @ ${settings.printResolution}dpi`
    ctx.fillText(desc, img.x * s, (img.y + img.height) * s + mmToPreviewPx(20, s))
  }

  ctx.restore()
}

// ---------------------------------------------------------------------------
//  Print preview
// ---------------------------------------------------------------------------

/** Render a full print preview on a canvas element. */
export function renderPrintPreview(
  canvas: HTMLCanvasElement,
  sourceCanvas: HTMLCanvasElement,
  docDpi: number,
  settings: PrintSettings,
  docTitle: string,
): void {
  const layout = computePrintLayout(sourceCanvas.width, sourceCanvas.height, docDpi, settings)
  const previewScale = 3 // 3 pixels per mm

  const pw = layout.pageRect.width * previewScale
  const ph = layout.pageRect.height * previewScale
  canvas.width = Math.ceil(pw + 80)
  canvas.height = Math.ceil(ph + 80)
  const ctx = canvas.getContext("2d")
  if (!ctx) return

  // Margin for marks
  const margin = 40

  // Background (workspace)
  ctx.fillStyle = "#888"
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Paper shadow
  ctx.fillStyle = "rgba(0,0,0,0.3)"
  ctx.fillRect(margin + 4, margin + 4, pw, ph)

  // Paper
  ctx.fillStyle = settings.backgroundColor ?? "#fff"
  ctx.fillRect(margin, margin, pw, ph)

  ctx.save()
  ctx.translate(margin, margin)

  // Bleed area (if any)
  if (settings.bleed > 0) {
    ctx.strokeStyle = "#00bcd4"
    ctx.lineWidth = 0.5
    ctx.setLineDash([4, 4])
    ctx.strokeRect(
      layout.bleedRect.x * previewScale,
      layout.bleedRect.y * previewScale,
      layout.bleedRect.width * previewScale,
      layout.bleedRect.height * previewScale,
    )
    ctx.setLineDash([])
  }

  // Image
  ctx.drawImage(
    sourceCanvas,
    layout.imageRect.x * previewScale,
    layout.imageRect.y * previewScale,
    layout.imageRect.width * previewScale,
    layout.imageRect.height * previewScale,
  )

  // Border
  if (settings.borderWidth > 0) {
    ctx.strokeStyle = settings.borderColor
    ctx.lineWidth = settings.borderWidth * previewScale
    ctx.strokeRect(
      layout.imageRect.x * previewScale,
      layout.imageRect.y * previewScale,
      layout.imageRect.width * previewScale,
      layout.imageRect.height * previewScale,
    )
  }

  // Print marks
  renderPrintMarks(ctx, layout, settings, docTitle, previewScale)

  ctx.restore()
}

// ---------------------------------------------------------------------------
//  Print Size Preview
// ---------------------------------------------------------------------------

/** Compute the zoom level needed to show the document at actual print size. */
export function computePrintSizeZoom(
  docWidth: number,
  docHeight: number,
  docDpi: number,
  screenDpi: number,
): number {
  // At print size, 1 document pixel = 1/docDpi inches on paper
  // On screen, 1 CSS pixel ≈ 1/screenDpi inches
  // So zoom = screenDpi / docDpi
  return screenDpi / docDpi
}

// ---------------------------------------------------------------------------
//  Browser print trigger
// ---------------------------------------------------------------------------

/** Create an iframe with the image and trigger browser print. */
export function triggerBrowserPrint(canvas: HTMLCanvasElement, settings: PrintSettings): void {
  if (typeof window === "undefined" || typeof document === "undefined") return

  const dataUrl = canvas.toDataURL("image/png")
  const iframe = document.createElement("iframe")
  iframe.style.position = "fixed"
  iframe.style.left = "-10000px"
  iframe.style.top = "-10000px"
  iframe.style.width = "1px"
  iframe.style.height = "1px"
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document
  if (!doc) {
    document.body.removeChild(iframe)
    return
  }

  const imgWidthIn = canvas.width / settings.printResolution
  const imgHeightIn = canvas.height / settings.printResolution

  doc.open()
  doc.write(`<!DOCTYPE html>
<html>
<head>
  <style>
    @page { size: ${settings.orientation === "landscape" ? "landscape" : "portrait"}; margin: 0; }
    body { margin: 0; display: flex; justify-content: center; align-items: center; height: 100vh; }
    img { width: ${imgWidthIn}in; height: ${imgHeightIn}in; }
  </style>
</head>
<body>
  <img src="${dataUrl}" />
</body>
</html>`)
  doc.close()

  iframe.contentWindow?.focus()
  iframe.contentWindow?.print()

  // Clean up after a delay
  window.setTimeout(() => {
    document.body.removeChild(iframe)
  }, 5000)
}
