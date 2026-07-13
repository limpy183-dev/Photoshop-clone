// Shape rasterization, custom-shape geometry library, and pen-path stroking.
// Extracted from tool-helpers.ts.
import type { CustomShapeId, PathProps, ShapeProps } from "./types"
import { appendPathToCanvas, createDefaultShapeAppearance, drawSmoothPolygon, drawStar, shapeToEditablePath } from "./vector-path-operations"
import { clamp } from "./tool-helpers-shared"

export function appendShapePath(ctx: CanvasRenderingContext2D, s: ShapeProps) {
  ctx.beginPath()
  if (s.components?.length || s.computedPath) {
    appendPathToCanvas(ctx, shapeToEditablePath(s))
  } else if (s.type === "custom") {
    customShapePath(ctx, (s.customId ?? "star5") as CustomShapeId, s.x, s.y, s.w, s.h)
  } else if (s.type === "polygon") {
    drawSmoothPolygon(ctx, s)
  } else if (s.type === "star") {
    drawStar(ctx, s)
  } else {
    appendPathToCanvas(ctx, shapeToEditablePath(s))
  }
}

export function rasterizeShape(canvas: HTMLCanvasElement, s: ShapeProps) {
  const ctx = canvas.getContext("2d")!
  if ((s.booleanOperation ?? "new") === "new" || s.components?.length) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  if (s.components?.length) {
    drawShapeAppearance(ctx, s, s)
    return
  }

  const components = s.components?.length
    ? s.components
    : [{
        id: "component-single",
        operation: (s.booleanOperation && s.booleanOperation !== "new" ? s.booleanOperation : "unite") as "unite" | "subtract" | "intersect" | "exclude",
        shape: s,
      }]

  for (const component of components) {
    ctx.save()
    ctx.globalCompositeOperation = compositeForShapeOperation(component.operation)
    drawShapeAppearance(ctx, component.shape, s)
    ctx.restore()
  }
}

function compositeForShapeOperation(operation: "unite" | "subtract" | "intersect" | "exclude"): GlobalCompositeOperation {
  switch (operation) {
    case "subtract":
      return "destination-out"
    case "intersect":
      return "destination-in"
    case "exclude":
      return "xor"
    case "unite":
    default:
      return "source-over"
  }
}

function drawShapeAppearance(ctx: CanvasRenderingContext2D, geometry: ShapeProps, appearanceSource: ShapeProps) {
  // Apply rotation around the shape center if requested.
  const rotation = geometry.rotation ?? 0
  if (rotation) {
    const rcx = geometry.x + geometry.w / 2
    const rcy = geometry.y + geometry.h / 2
    ctx.translate(rcx, rcy)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.translate(-rcx, -rcy)
  }

  const appearance = createDefaultShapeAppearance(appearanceSource)
  for (const fill of appearance.fills) {
    if (!fill.enabled || fill.opacity <= 0) continue
    ctx.save()
    appendShapePath(ctx, geometry)
    ctx.globalAlpha *= clamp(fill.opacity, 0, 1)
    ctx.fillStyle = fill.color
    ctx.fill("evenodd")
    ctx.restore()
  }
  for (const stroke of appearance.strokes) {
    if (!stroke.enabled || stroke.opacity <= 0 || stroke.width <= 0) continue
    ctx.save()
    appendShapePath(ctx, geometry)
    ctx.globalAlpha *= clamp(stroke.opacity, 0, 1)
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.alignment === "inside" || stroke.alignment === "outside" ? stroke.width * 2 : stroke.width
    ctx.lineCap = stroke.lineCap ?? "butt"
    ctx.lineJoin = stroke.lineJoin ?? "miter"
    if (stroke.dash?.length) ctx.setLineDash(stroke.dash)
    if (stroke.alignment === "inside") {
      ctx.clip("evenodd")
      appendShapePath(ctx, geometry)
    }
    ctx.stroke()
    ctx.restore()
  }
}

/** Custom-shape geometry library. Each shape is normalized to (x, y, w, h). */
export function customShapePath(
  ctx: CanvasRenderingContext2D,
  id: CustomShapeId,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const cx = x + w / 2
  const cy = y + h / 2
  switch (id) {
    case "star5":
    case "star6": {
      const points = id === "star5" ? 5 : 6
      const outer = Math.min(w, h) / 2
      const inner = outer * 0.45
      for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? outer : inner
        const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2
        const px = cx + Math.cos(a) * r * (w / Math.min(w, h))
        const py = cy + Math.sin(a) * r * (h / Math.min(w, h))
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      break
    }
    case "heart": {
      const top = y + h * 0.25
      ctx.moveTo(cx, y + h)
      ctx.bezierCurveTo(x - w * 0.1, top + h * 0.4, x + w * 0.1, y, cx, top)
      ctx.bezierCurveTo(x + w * 0.9, y, x + w * 1.1, top + h * 0.4, cx, y + h)
      ctx.closePath()
      break
    }
    case "arrow-right": {
      ctx.moveTo(x, y + h * 0.33)
      ctx.lineTo(x + w * 0.66, y + h * 0.33)
      ctx.lineTo(x + w * 0.66, y)
      ctx.lineTo(x + w, cy)
      ctx.lineTo(x + w * 0.66, y + h)
      ctx.lineTo(x + w * 0.66, y + h * 0.66)
      ctx.lineTo(x, y + h * 0.66)
      ctx.closePath()
      break
    }
    case "arrow-left": {
      ctx.moveTo(x + w, y + h * 0.33)
      ctx.lineTo(x + w * 0.34, y + h * 0.33)
      ctx.lineTo(x + w * 0.34, y)
      ctx.lineTo(x, cy)
      ctx.lineTo(x + w * 0.34, y + h)
      ctx.lineTo(x + w * 0.34, y + h * 0.66)
      ctx.lineTo(x + w, y + h * 0.66)
      ctx.closePath()
      break
    }
    case "arrow-up": {
      ctx.moveTo(x + w * 0.33, y + h)
      ctx.lineTo(x + w * 0.33, y + h * 0.34)
      ctx.lineTo(x, y + h * 0.34)
      ctx.lineTo(cx, y)
      ctx.lineTo(x + w, y + h * 0.34)
      ctx.lineTo(x + w * 0.66, y + h * 0.34)
      ctx.lineTo(x + w * 0.66, y + h)
      ctx.closePath()
      break
    }
    case "arrow-down": {
      ctx.moveTo(x + w * 0.33, y)
      ctx.lineTo(x + w * 0.33, y + h * 0.66)
      ctx.lineTo(x, y + h * 0.66)
      ctx.lineTo(cx, y + h)
      ctx.lineTo(x + w, y + h * 0.66)
      ctx.lineTo(x + w * 0.66, y + h * 0.66)
      ctx.lineTo(x + w * 0.66, y)
      ctx.closePath()
      break
    }
    case "speech": {
      const r = Math.min(w, h) / 8
      ctx.moveTo(x + r, y)
      ctx.lineTo(x + w - r, y)
      ctx.quadraticCurveTo(x + w, y, x + w, y + r)
      ctx.lineTo(x + w, y + h * 0.7 - r)
      ctx.quadraticCurveTo(x + w, y + h * 0.7, x + w - r, y + h * 0.7)
      ctx.lineTo(x + w * 0.3, y + h * 0.7)
      ctx.lineTo(x + w * 0.18, y + h)
      ctx.lineTo(x + w * 0.22, y + h * 0.7)
      ctx.lineTo(x + r, y + h * 0.7)
      ctx.quadraticCurveTo(x, y + h * 0.7, x, y + h * 0.7 - r)
      ctx.lineTo(x, y + r)
      ctx.quadraticCurveTo(x, y, x + r, y)
      ctx.closePath()
      break
    }
    case "check": {
      ctx.moveTo(x, y + h * 0.55)
      ctx.lineTo(x + w * 0.18, y + h * 0.4)
      ctx.lineTo(x + w * 0.4, y + h * 0.7)
      ctx.lineTo(x + w * 0.85, y + h * 0.1)
      ctx.lineTo(x + w, y + h * 0.25)
      ctx.lineTo(x + w * 0.4, y + h * 0.95)
      ctx.closePath()
      break
    }
    case "cross": {
      ctx.moveTo(x + w * 0.05, y + h * 0.2)
      ctx.lineTo(x + w * 0.2, y + h * 0.05)
      ctx.lineTo(cx, cy - h * 0.15)
      ctx.lineTo(x + w * 0.8, y + h * 0.05)
      ctx.lineTo(x + w * 0.95, y + h * 0.2)
      ctx.lineTo(cx + w * 0.15, cy)
      ctx.lineTo(x + w * 0.95, y + h * 0.8)
      ctx.lineTo(x + w * 0.8, y + h * 0.95)
      ctx.lineTo(cx, cy + h * 0.15)
      ctx.lineTo(x + w * 0.2, y + h * 0.95)
      ctx.lineTo(x + w * 0.05, y + h * 0.8)
      ctx.lineTo(cx - w * 0.15, cy)
      ctx.closePath()
      break
    }
    case "lightning": {
      ctx.moveTo(x + w * 0.45, y)
      ctx.lineTo(x + w * 0.05, y + h * 0.55)
      ctx.lineTo(x + w * 0.4, y + h * 0.55)
      ctx.lineTo(x + w * 0.25, y + h)
      ctx.lineTo(x + w * 0.95, y + h * 0.45)
      ctx.lineTo(x + w * 0.55, y + h * 0.45)
      ctx.lineTo(x + w * 0.85, y)
      ctx.closePath()
      break
    }
    case "polygon-hex": {
      const sides = 6
      const r = Math.min(w, h) / 2
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2 - Math.PI / 2
        const px = cx + Math.cos(a) * r * (w / Math.min(w, h))
        const py = cy + Math.sin(a) * r * (h / Math.min(w, h))
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      break
    }
    case "polygon-tri": {
      ctx.moveTo(cx, y)
      ctx.lineTo(x + w, y + h)
      ctx.lineTo(x, y + h)
      ctx.closePath()
      break
    }
    case "diamond": {
      ctx.moveTo(cx, y)
      ctx.lineTo(x + w, cy)
      ctx.lineTo(cx, y + h)
      ctx.lineTo(x, cy)
      ctx.closePath()
      break
    }
  }
}

/* ---------------------------------------------------------------- */
/*  PEN PATHS                                                         */
/* ---------------------------------------------------------------- */

export function tracePath(ctx: CanvasRenderingContext2D, path: PathProps) {
  if (path.points.length < 2) return false
  ctx.beginPath()
  appendPathToCanvas(ctx, path)
  return true
}

export function strokePath(
  ctx: CanvasRenderingContext2D,
  path: PathProps,
  color: string,
  width: number,
  fill: boolean,
  fillColor: string,
) {
  if (path.points.length < 2) return
  ctx.save()
  tracePath(ctx, path)
  if (fill) {
    ctx.fillStyle = fillColor
    ctx.fill("evenodd")
  }
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineJoin = "round"
  ctx.lineCap = "round"
  ctx.stroke()
  ctx.restore()
}
