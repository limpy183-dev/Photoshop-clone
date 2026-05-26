import type { Layer, PathProps, ShapeProps } from "./types"
import { exportPathToSvgPath, normalizeCornerRadii, shapeToEditablePath, transformPath } from "./vector-path-operations"

export function copyLayerCss(layer: Pick<Layer, "name" | "opacity" | "shape" | "path" | "vectorMask" | "style">): string {
  const geometry = cssGeometryForLayer(layer)
  if (!geometry) return ""
  const { bounds, path, shape } = geometry
  const lines = [
    `/* ${escapeCssComment(layer.name)} */`,
    "position: absolute;",
    `left: ${round(bounds.x)}px;`,
    `top: ${round(bounds.y)}px;`,
    `width: ${round(Math.abs(bounds.w))}px;`,
    `height: ${round(Math.abs(bounds.h))}px;`,
    `opacity: ${round(layer.opacity ?? 1, 3)};`,
  ]
  if (shape?.fill) lines.push(`background: ${safeCssValue(shape.fill)};`)
  if (!shape) lines.push("background: currentColor;")
  if (shape?.stroke && shape.stroke.width > 0) {
    lines.push(`border: ${round(shape.stroke.width)}px solid ${safeCssValue(shape.stroke.color)};`)
    lines.push("box-sizing: border-box;")
  }
  if (shape?.type === "ellipse") {
    lines.push("border-radius: 50%;")
  } else if (shape?.type === "rect") {
    const radii = normalizeCornerRadii(shape)
    if (radii.some((radius) => radius > 0)) {
      lines.push(`border-radius: ${radii.map((radius) => `${round(radius)}px`).join(" ")};`)
    }
  } else {
    lines.push(`clip-path: path("${escapeAttribute(exportPathToSvgPath(path))}");`)
  }
  const shadow = layer.style?.dropShadow
  if (shadow?.enabled) {
    lines.push(`box-shadow: ${round(shadow.offsetX)}px ${round(shadow.offsetY)}px ${round(shadow.size)}px ${safeCssValue(shadow.color)};`)
  }
  return `${lines.join("\n")}\n`
}

export function copyLayerSvg(
  layer: Pick<Layer, "name" | "opacity" | "shape" | "path" | "vectorMask">,
  viewport: { width: number; height: number },
): string {
  const path = layer.shape ? shapeToEditablePath(layer.shape) : layer.path ?? layer.vectorMask
  if (!path) return ""
  const fill = layer.shape?.fill ?? "none"
  const stroke = layer.shape?.stroke
  const strokeAttrs = stroke && stroke.width > 0
    ? ` stroke="${escapeAttribute(stroke.color)}" stroke-width="${round(stroke.width)}"`
    : layer.shape ? "" : ` stroke="currentColor" stroke-width="1"`
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(viewport.width)}" height="${round(viewport.height)}" viewBox="0 0 ${round(viewport.width)} ${round(viewport.height)}">`,
    `  <path id="${slug(layer.name)}" d="${escapeAttribute(exportPathToSvgPath(path))}" fill="${escapeAttribute(fill)}"${strokeAttrs} opacity="${round(layer.opacity ?? 1, 3)}" fill-rule="evenodd"/>`,
    "</svg>",
  ].join("\n")
}

export function pathToStandaloneSvg(path: PathProps, viewport: { width: number; height: number }, options: { name?: string; fill?: string; stroke?: string } = {}) {
  return copyLayerSvg({
    name: options.name ?? "Vector Path",
    opacity: 1,
    path,
  }, viewport).replace('stroke="currentColor"', `stroke="${escapeAttribute(options.stroke ?? "currentColor")}"`)
}

function cssGeometryForLayer(layer: Pick<Layer, "shape" | "path" | "vectorMask">): { bounds: { x: number; y: number; w: number; h: number }; path: PathProps; shape?: ShapeProps } | null {
  if (layer.shape) {
    const shape = layer.shape
    const bounds = { x: shape.x, y: shape.y, w: Math.abs(shape.w), h: Math.abs(shape.h) }
    const path = transformPath(shapeToEditablePath(shape), {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: -bounds.x,
      f: -bounds.y,
    })
    return { bounds, path, shape }
  }
  const source = layer.path ?? layer.vectorMask
  if (!source?.points.length) return null
  const bounds = pathBounds(source)
  const path = transformPath(source, {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: -bounds.x,
    f: -bounds.y,
  })
  return { bounds, path }
}

function pathBounds(path: PathProps) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const walk = (single: PathProps) => {
    for (const point of single.points) {
      const xs = [point.x, point.cp1?.x, point.cp2?.x].filter((value): value is number => typeof value === "number")
      const ys = [point.y, point.cp1?.y, point.cp2?.y].filter((value): value is number => typeof value === "number")
      minX = Math.min(minX, ...xs)
      minY = Math.min(minY, ...ys)
      maxX = Math.max(maxX, ...xs)
      maxY = Math.max(maxY, ...ys)
    }
    for (const subpath of single.subpaths ?? []) walk(subpath)
  }
  walk(path)
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 1, h: 1 }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
}

function round(value: number, places = 2) {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
}

function safeCssValue(value: string) {
  return /^[#a-zA-Z0-9(),.%\s-]+$/.test(value) ? value : "transparent"
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function escapeCssComment(value: string) {
  return value.replace(/\*\//g, "* /").slice(0, 120)
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "vector-layer"
}
