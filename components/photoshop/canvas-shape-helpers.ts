import {
  getCustomShapeRuntimeId,
  getCustomShapeRuntimePreset,
  getShapeRuntimeOptions,
} from "./canvas-view-runtime"
import {
  resizeShapeWithCornerRadii,
  type RoundedRectCorner,
} from "./vector-path-operations"
import type { ShapeProps } from "./types"

export type DirectShapeHandleId = "nw" | "ne" | "se" | "sw" | "center" | `radius-${RoundedRectCorner}`

export function labelForTool(tool: string): string {
  const map: Record<string, string> = {
    brush: "Brush Stroke",
    pencil: "Pencil",
    "mixer-brush": "Mixer Brush",
    "pattern-stamp": "Pattern Stamp",
    eraser: "Eraser",
    blur: "Blur",
    sharpen: "Sharpen",
    smudge: "Smudge",
    dodge: "Dodge",
    burn: "Burn",
    sponge: "Sponge",
    "clone-stamp": "Clone Stamp",
    "history-brush": "History Brush",
    "art-history-brush": "Art History Brush",
    "red-eye": "Red Eye Correction",
    "spot-healing": "Spot Healing",
    "healing-brush": "Healing Brush",
    "patch-tool": "Patch Tool",
    "select-subject": "Select Subject",
    "select-sky": "Select Sky",
    "quick-selection": "Quick Selection",
    "object-select": "Object Selection",
    "refine-edge-brush": "Refine Edge Brush",
    "remove-tool": "Remove Tool",
    "content-aware-move": "Content-Aware Move",
  }
  return map[tool] ?? "Edit"
}

export function cursorForTool(tool: string, brushy: boolean) {
  if (tool === "hand") return "grab"
  if (tool === "rotate-view") return "grab"
  if (tool === "zoom") return "zoom-in"
  if (tool === "eyedropper" || tool === "color-sampler" || tool === "material-eyedropper" || tool === "material-drop") return "crosshair"
  if (tool === "type" || tool === "type-vertical" || tool === "type-mask-horizontal" || tool === "type-mask-vertical") return "text"
  if (tool === "move" || tool === "content-aware-move") return "move"
  if (tool === "pen" || tool === "freeform-pen" || tool === "curvature-pen" || tool === "add-anchor-point" || tool === "delete-anchor-point" || tool === "convert-point") return "crosshair"
  if (tool === "path-select") return "default"
  if (tool === "shape-rect" || tool === "shape-rounded-rect" || tool === "shape-ellipse" || tool === "shape-polygon" || tool === "shape-star" || tool === "shape-triangle" || tool === "shape-line") return "crosshair"
  if (tool === "marquee-rect" || tool === "marquee-ellipse" || tool === "marquee-row" || tool === "marquee-col" || tool === "lasso" || tool === "lasso-polygon" || tool === "lasso-magnetic" || tool === "magic-wand" || tool === "quick-selection" || tool === "object-select" || tool === "select-subject" || tool === "select-sky" || tool === "select-background" || tool === "patch-tool" || tool === "red-eye" || tool === "crop" || tool === "perspective-crop" || tool === "slice-select") return "crosshair"
  if (tool === "paint-bucket" || tool === "gradient") return "crosshair"
  if (brushy) return "none"
  return "default"
}

export function shapePropsForTool(
  tool: string,
  x: number,
  y: number,
  w: number,
  h: number,
  _start: { x: number; y: number },
  _end: { x: number; y: number },
  foreground: string,
  background: string,
): ShapeProps {
  const options = getShapeRuntimeOptions()
  const stroke = options.strokeWidth > 0 ? { color: background, width: options.strokeWidth } : null
  if (tool === "shape-ellipse") {
    return { type: "ellipse", x, y, w, h, fill: foreground, stroke, rotation: options.rotation }
  }
  if (tool === "shape-polygon") {
    if (options.polygonStarMode) {
      return {
        type: "star",
        x, y, w, h,
        fill: foreground,
        stroke,
        starPoints: options.sides,
        innerRadiusRatio: options.innerRadiusRatio,
        vertexRoundness: options.vertexRoundness,
        smoothCorners: options.smoothCorners,
        smoothIndent: options.smoothIndent,
        rotation: options.rotation,
      }
    }
    return {
      type: "polygon",
      x, y, w, h,
      fill: foreground,
      stroke,
      sides: options.sides,
      vertexRoundness: options.vertexRoundness,
      smoothCorners: options.smoothCorners,
      rotation: options.rotation,
    }
  }
  if (tool === "shape-triangle") {
    return {
      type: "polygon",
      x, y, w, h,
      fill: foreground,
      stroke,
      sides: 3,
      vertexRoundness: options.vertexRoundness,
      smoothCorners: options.smoothCorners,
      rotation: options.rotation,
    }
  }
  if (tool === "shape-star") {
    return {
      type: "star",
      x, y, w, h,
      fill: foreground,
      stroke,
      starPoints: options.sides,
      innerRadiusRatio: options.innerRadiusRatio,
      vertexRoundness: options.vertexRoundness,
      smoothCorners: options.smoothCorners,
      smoothIndent: options.smoothIndent,
      rotation: options.rotation,
    }
  }
  if (tool === "custom-shape") {
    const preset = getCustomShapeRuntimePreset()
    if (preset) {
      const fitted = resizeShapeWithCornerRadii(preset, { x, y, w, h })
      return {
        ...fitted,
        fill: foreground,
        stroke,
        rotation: options.rotation || fitted.rotation,
      }
    }
    return { type: "custom", x, y, w, h, fill: foreground, stroke, customId: getCustomShapeRuntimeId(), rotation: options.rotation }
  }
  const cornerRadii: [number, number, number, number] | undefined =
    options.cornerRadiusTL !== undefined ||
    options.cornerRadiusTR !== undefined ||
    options.cornerRadiusBR !== undefined ||
    options.cornerRadiusBL !== undefined
      ? [
          Math.max(0, options.cornerRadiusTL ?? options.radius ?? 0),
          Math.max(0, options.cornerRadiusTR ?? options.radius ?? 0),
          Math.max(0, options.cornerRadiusBR ?? options.radius ?? 0),
          Math.max(0, options.cornerRadiusBL ?? options.radius ?? 0),
        ]
      : undefined
  return {
    type: "rect",
    x, y, w, h,
    fill: foreground,
    stroke,
    radius: tool === "shape-rounded-rect" ? Math.max(4, options.radius || 18) : options.radius,
    cornerRadii,
    rotation: options.rotation,
  }
}

export function normalizeViewRotation(value: number) {
  return ((value % 360) + 360) % 360
}

export function shapeRect(shape: ShapeProps) {
  return { x: shape.x, y: shape.y, w: shape.w, h: shape.h }
}

export function shapeHandles(bounds: { x: number; y: number; w: number; h: number }) {
  return [
    { id: "nw" as DirectShapeHandleId, x: bounds.x, y: bounds.y },
    { id: "ne" as DirectShapeHandleId, x: bounds.x + bounds.w, y: bounds.y },
    { id: "se" as DirectShapeHandleId, x: bounds.x + bounds.w, y: bounds.y + bounds.h },
    { id: "sw" as DirectShapeHandleId, x: bounds.x, y: bounds.y + bounds.h },
    { id: "center" as DirectShapeHandleId, x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 },
  ]
}

export function resizePlainRect(
  rect: { x: number; y: number; w: number; h: number },
  handle: Exclude<DirectShapeHandleId, `radius-${RoundedRectCorner}`>,
  pt: { x: number; y: number },
  dx: number,
  dy: number,
) {
  if (handle === "center") return { ...rect, x: rect.x + dx, y: rect.y + dy }
  const x2 = rect.x + rect.w
  const y2 = rect.y + rect.h
  const next = {
    x: handle === "nw" || handle === "sw" ? pt.x : rect.x,
    y: handle === "nw" || handle === "ne" ? pt.y : rect.y,
    w: handle === "ne" || handle === "se" ? pt.x - rect.x : x2 - pt.x,
    h: handle === "sw" || handle === "se" ? pt.y - rect.y : y2 - pt.y,
  }
  if (next.w < 0) {
    next.x += next.w
    next.w = Math.abs(next.w)
  }
  if (next.h < 0) {
    next.y += next.h
    next.h = Math.abs(next.h)
  }
  return { x: next.x, y: next.y, w: Math.max(1, next.w), h: Math.max(1, next.h) }
}

export function resizeShapeRect(
  shape: ShapeProps,
  handle: Exclude<DirectShapeHandleId, `radius-${RoundedRectCorner}`>,
  pt: { x: number; y: number },
  dx: number,
  dy: number,
): ShapeProps {
  return resizeShapeWithCornerRadii(shape, resizePlainRect(shapeRect(shape), handle, pt, dx, dy))
}
