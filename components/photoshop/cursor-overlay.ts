import type { CursorStylePreference } from "./preferences-engine"
import type { ToolId } from "./types"

export type CanvasCursorOverlay =
  | {
      kind: "brush"
      diameterPx: number
      canvasSizePx: number
      showCrosshair: boolean
      toolLabel: string
    }
  | {
      kind: "precise" | "tool"
      canvasSizePx: number
      showCrosshair: boolean
      toolLabel: string
    }

export interface CanvasCursorState {
  cssCursor: string
  overlay: CanvasCursorOverlay | null
}

export interface CanvasCursorInput {
  standardCssCursor: string
  cursorStyle: CursorStylePreference
  tool: ToolId | string
  isBrushTool: boolean
  brushSize: number
  zoom: number
  showBrushPreview: boolean
  showBrushSizeCrosshair: boolean
}

export function resolveCanvasCursorState(input: CanvasCursorInput): CanvasCursorState {
  const label = toolCursorLabel(input.tool)
  const brushDiameter = Math.max(2, Math.round(input.brushSize * Math.max(0.01, input.zoom)))

  if (input.isBrushTool && input.showBrushPreview && input.cursorStyle !== "standard") {
    return {
      cssCursor: "none",
      overlay: {
        kind: "brush",
        diameterPx: brushDiameter,
        canvasSizePx: cursorCanvasSize(brushDiameter),
        showCrosshair: input.showBrushSizeCrosshair || input.cursorStyle === "precise",
        toolLabel: label,
      },
    }
  }

  if (input.cursorStyle === "precise") {
    return {
      cssCursor: "none",
      overlay: {
        kind: "precise",
        canvasSizePx: 48,
        showCrosshair: true,
        toolLabel: label,
      },
    }
  }

  if (input.cursorStyle === "brush-size" && input.isBrushTool && input.showBrushPreview) {
    return {
      cssCursor: "none",
      overlay: {
        kind: "brush",
        diameterPx: brushDiameter,
        canvasSizePx: cursorCanvasSize(brushDiameter),
        showCrosshair: input.showBrushSizeCrosshair,
        toolLabel: label,
      },
    }
  }

  if (input.cursorStyle === "brush-size" && input.standardCssCursor === "crosshair") {
    return {
      cssCursor: "none",
      overlay: {
        kind: "tool",
        canvasSizePx: 48,
        showCrosshair: true,
        toolLabel: label,
      },
    }
  }

  return { cssCursor: input.standardCssCursor, overlay: null }
}

export function paintCanvasCursorOverlay(canvas: HTMLCanvasElement, overlay: CanvasCursorOverlay, devicePixelRatio = 1) {
  const dpr = Math.max(1, devicePixelRatio)
  const cssSize = overlay.canvasSizePx
  const pixelSize = Math.round(cssSize * dpr)
  if (canvas.width !== pixelSize) canvas.width = pixelSize
  if (canvas.height !== pixelSize) canvas.height = pixelSize
  canvas.style.width = `${cssSize}px`
  canvas.style.height = `${cssSize}px`

  const ctx = canvas.getContext("2d")
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssSize, cssSize)

  const cx = cssSize / 2
  const cy = cssSize / 2
  ctx.save()
  ctx.lineWidth = 1
  ctx.lineCap = "square"
  ctx.strokeStyle = "rgba(255,255,255,0.95)"
  ctx.shadowColor = "rgba(0,0,0,0.85)"
  ctx.shadowBlur = 1
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 1

  if (overlay.kind === "brush") {
    const radius = Math.max(1, overlay.diameterPx / 2)
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.shadowColor = "transparent"
    ctx.strokeStyle = "rgba(0,0,0,0.9)"
    ctx.beginPath()
    ctx.arc(cx, cy, radius + 1, 0, Math.PI * 2)
    ctx.stroke()
  }

  if (overlay.showCrosshair) {
    const gap = overlay.kind === "brush" ? Math.max(4, Math.min(10, overlay.diameterPx / 5)) : 4
    const reach = overlay.kind === "brush" ? Math.max(12, overlay.diameterPx / 2 + 8) : 18
    ctx.shadowColor = "rgba(0,0,0,0.85)"
    ctx.strokeStyle = "rgba(255,255,255,0.96)"
    drawCrosshair(ctx, cx, cy, gap, reach)
    ctx.shadowColor = "transparent"
    ctx.strokeStyle = "rgba(0,0,0,0.9)"
    drawCrosshair(ctx, cx + 0.5, cy + 0.5, gap, reach)
  }

  drawToolBadge(ctx, cssSize, overlay.toolLabel)
  ctx.restore()
}

function drawCrosshair(ctx: CanvasRenderingContext2D, cx: number, cy: number, gap: number, reach: number) {
  ctx.beginPath()
  ctx.moveTo(cx - reach, cy)
  ctx.lineTo(cx - gap, cy)
  ctx.moveTo(cx + gap, cy)
  ctx.lineTo(cx + reach, cy)
  ctx.moveTo(cx, cy - reach)
  ctx.lineTo(cx, cy - gap)
  ctx.moveTo(cx, cy + gap)
  ctx.lineTo(cx, cy + reach)
  ctx.stroke()
}

function drawToolBadge(ctx: CanvasRenderingContext2D, canvasSize: number, label: string) {
  const x = Math.min(canvasSize - 16, canvasSize / 2 + 7)
  const y = Math.min(canvasSize - 16, canvasSize / 2 + 7)
  ctx.shadowColor = "transparent"
  ctx.fillStyle = "rgba(20,24,30,0.86)"
  ctx.strokeStyle = "rgba(255,255,255,0.76)"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(x, y, 14, 14, 3)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = "rgba(255,255,255,0.95)"
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(label.slice(0, 2), x + 7, y + 7.5)
}

function cursorCanvasSize(diameter: number) {
  return Math.max(48, Math.min(640, Math.ceil(diameter + 28)))
}

function toolCursorLabel(tool: ToolId | string) {
  const labels: Record<string, string> = {
    move: "V",
    brush: "B",
    pencil: "P",
    eraser: "E",
    "mixer-brush": "M",
    "clone-stamp": "S",
    "pattern-stamp": "S",
    "history-brush": "Y",
    "art-history-brush": "Y",
    blur: "R",
    sharpen: "R",
    smudge: "R",
    dodge: "O",
    burn: "O",
    sponge: "O",
    eyedropper: "I",
    "color-sampler": "I",
    "material-eyedropper": "I",
    "material-drop": "G",
    "paint-bucket": "G",
    gradient: "G",
    zoom: "Z",
    hand: "H",
    "rotate-view": "R",
    type: "T",
    "type-vertical": "T",
    "type-mask-horizontal": "T",
    "type-mask-vertical": "T",
    pen: "P",
    "freeform-pen": "P",
    "curvature-pen": "P",
    "add-anchor-point": "P+",
    "delete-anchor-point": "P-",
    "convert-point": "P",
    "path-select": "A",
    "direct-select": "A",
    crop: "C",
    "perspective-crop": "C",
    slice: "K",
    "slice-select": "K",
    frame: "K",
    ruler: "I",
    note: "N",
    count: "I",
    "marquee-rect": "M",
    "marquee-ellipse": "M",
    "marquee-row": "M",
    "marquee-col": "M",
    lasso: "L",
    "lasso-polygon": "L",
    "lasso-magnetic": "L",
    "magic-wand": "W",
    "quick-selection": "W",
    "object-select": "W",
    "refine-edge-brush": "R",
    "select-subject": "W",
    "select-sky": "W",
    "select-background": "W",
    "spot-healing": "J",
    "healing-brush": "J",
    "patch-tool": "J",
    "content-aware-move": "J",
    "red-eye": "J",
    "remove-tool": "J",
    "color-replace": "B",
    "magic-eraser": "E",
    "background-eraser": "E",
    "shape-rect": "U",
    "shape-rounded-rect": "U",
    "shape-ellipse": "U",
    "shape-polygon": "U",
    "shape-star": "U",
    "shape-triangle": "U",
    "shape-line": "U",
    "custom-shape": "U",
    artboard: "V",
    transform: "T",
  }
  return labels[tool] ?? "?"
}
