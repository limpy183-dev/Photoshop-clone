/**
 * Generates CSS and inline SVG snippets for vector / shape layers.
 *
 * Mirrors Photoshop's "Copy CSS" output for shape layers (width/height,
 * background, border-radius, optional border / box-shadow) and produces a
 * standalone inline `<svg>` document for "Copy SVG" that captures geometry,
 * fill, stroke, and basic effects.
 */

import type { Layer, LayerStyle, PathProps, ShapeProps } from "./types"
import { exportPathToSvgPath, shapeToEditablePath } from "./vector-path-operations"

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function uniformCornerRadius(shape: ShapeProps): number | null {
  if (shape.type !== "rect") return null
  const radii = shape.cornerRadii ?? [shape.radius ?? 0, shape.radius ?? 0, shape.radius ?? 0, shape.radius ?? 0]
  if (radii.every((value) => value === radii[0])) return radii[0]
  return null
}

function cssCornerRadius(shape: ShapeProps): string | null {
  if (shape.type === "ellipse") {
    return "50% / 50%"
  }
  if (shape.type !== "rect") return null
  const radii = shape.cornerRadii ?? [shape.radius ?? 0, shape.radius ?? 0, shape.radius ?? 0, shape.radius ?? 0]
  if (radii.every((value) => !value)) return null
  if (radii.every((value) => value === radii[0])) return `${round(radii[0])}px`
  return `${round(radii[0])}px ${round(radii[1])}px ${round(radii[2])}px ${round(radii[3])}px`
}

function cssBorder(shape: ShapeProps): string | null {
  const stroke = shape.stroke
  if (!stroke || !stroke.width) return null
  return `${round(stroke.width)}px solid ${stroke.color}`
}

function cssBoxShadow(style?: LayerStyle): string | null {
  if (!style) return null
  const layers: string[] = []
  const drop = style.dropShadow
  if (drop?.enabled) {
    const inset = ""
    const blur = round(drop.size)
    const spread = round(drop.spread ?? 0)
    const rgba = colorToRgba(drop.color, drop.opacity)
    layers.push(`${inset}${round(drop.offsetX)}px ${round(drop.offsetY)}px ${blur}px ${spread}px ${rgba}`)
  }
  const inner = style.innerShadow
  if (inner?.enabled) {
    const blur = round(inner.size)
    const spread = round(inner.choke ?? 0)
    const rgba = colorToRgba(inner.color, inner.opacity)
    layers.push(`inset ${round(inner.offsetX)}px ${round(inner.offsetY)}px ${blur}px ${spread}px ${rgba}`)
  }
  return layers.length ? layers.join(", ") : null
}

function colorToRgba(color: string, opacity = 1): string {
  const clean = (color || "").trim()
  const alpha = Math.max(0, Math.min(1, opacity))
  const hex = clean.startsWith("#") ? clean.slice(1) : clean
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${round(alpha, 3)})`
  }
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const r = parseInt(hex[0] + hex[0], 16)
    const g = parseInt(hex[1] + hex[1], 16)
    const b = parseInt(hex[2] + hex[2], 16)
    return `rgba(${r}, ${g}, ${b}, ${round(alpha, 3)})`
  }
  return clean
}

/**
 * Produce a Photoshop-style "Copy CSS" snippet for a shape/vector layer.
 *
 * The output mirrors Photoshop's clipboard format:
 *   .layer-name {
 *     width: …px;
 *     height: …px;
 *     border-radius: …px;        // when present
 *     background: …;             // solid fill or gradient
 *     border: …px solid …;       // when stroke present
 *     box-shadow: …;             // from drop / inner shadow effects
 *     opacity: …;                // when not 1
 *   }
 *
 * Returns null when the layer has no geometry that maps cleanly to CSS.
 */
export function buildLayerCss(layer: Layer): string | null {
  const shape = layer.shape
  if (!shape) return null
  const declarations: Array<[string, string]> = []
  declarations.push(["width", `${round(Math.max(0, shape.w))}px`])
  declarations.push(["height", `${round(Math.max(0, shape.h))}px`])

  const radius = cssCornerRadius(shape)
  if (radius) declarations.push(["border-radius", radius])

  const fill = (() => {
    const overlay = layer.style?.gradientOverlay
    if (overlay?.enabled && overlay.gradient?.stops?.length) {
      const stops = overlay.gradient.stops.map((stop) => `${colorToRgba(stop.color, stop.opacity ?? 1)} ${round((stop.offset ?? 0) * 100)}%`).join(", ")
      const angle = round((overlay.gradient.angle ?? 0) + 90)
      return `linear-gradient(${angle}deg, ${stops})`
    }
    return shape.fill || "transparent"
  })()
  declarations.push(["background", fill])

  const border = cssBorder(shape)
  if (border) declarations.push(["border", border])

  const shadow = cssBoxShadow(layer.style)
  if (shadow) declarations.push(["box-shadow", shadow])

  if (layer.opacity !== undefined && layer.opacity !== 1) declarations.push(["opacity", `${round(layer.opacity, 3)}`])

  const className = sanitizeClassName(layer.name)
  const body = declarations.map(([prop, value]) => `  ${prop}: ${value};`).join("\n")
  return `.${className} {\n${body}\n}`
}

function sanitizeClassName(name: string) {
  const trimmed = (name || "shape").trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "")
  return trimmed || "shape"
}

interface SvgEffect {
  filter?: string
  defs: string
  filterId?: string
}

function svgFromEffects(style?: LayerStyle): SvgEffect {
  if (!style) return { defs: "" }
  const filterParts: string[] = []
  let filterId: string | undefined

  const drop = style.dropShadow
  if (drop?.enabled) {
    filterParts.push(
      `<feGaussianBlur in="SourceAlpha" stdDeviation="${round(Math.max(0.01, drop.size / 2))}"/>` +
      `<feOffset dx="${round(drop.offsetX)}" dy="${round(drop.offsetY)}" result="offsetblur"/>` +
      `<feFlood flood-color="${drop.color}" flood-opacity="${round(drop.opacity, 3)}"/>` +
      `<feComposite in2="offsetblur" operator="in"/>` +
      `<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>`,
    )
  }
  const outer = style.outerGlow
  if (outer?.enabled) {
    filterParts.push(
      `<feGaussianBlur in="SourceAlpha" stdDeviation="${round(Math.max(0.01, outer.size / 2))}"/>` +
      `<feFlood flood-color="${outer.color}" flood-opacity="${round(outer.opacity, 3)}"/>` +
      `<feComposite in2="SourceAlpha" operator="in" result="glow"/>` +
      `<feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>`,
    )
  }
  if (!filterParts.length) return { defs: "" }
  filterId = `ps-effect-${Math.random().toString(36).slice(2, 8)}`
  const defs = `<filter id="${filterId}" x="-25%" y="-25%" width="150%" height="150%">${filterParts.join("")}</filter>`
  return { filter: `url(#${filterId})`, defs: `<defs>${defs}</defs>`, filterId }
}

/**
 * Resolve a layer's geometry to an editable path. Returns null when the layer
 * has neither a shape nor a path / vector mask.
 */
function geometryFor(layer: Layer): { path: PathProps; bounds: { x: number; y: number; w: number; h: number } } | null {
  if (layer.shape) {
    const path = shapeToEditablePath(layer.shape)
    const bounds = { x: layer.shape.x, y: layer.shape.y, w: layer.shape.w, h: layer.shape.h }
    return { path, bounds }
  }
  const fallback = layer.path ?? layer.vectorMask
  if (!fallback?.points?.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const walk = (single: PathProps) => {
    for (const point of single.points) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
    for (const sub of single.subpaths ?? []) walk(sub)
  }
  walk(fallback)
  if (!Number.isFinite(minX)) return null
  return { path: fallback, bounds: { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) } }
}

export interface CopySvgOptions {
  /** Whether the output is a standalone document (default) or just the `<svg>` fragment. */
  standalone?: boolean
  /** Apply a transform that moves the geometry into a 0,0-based viewport. Defaults true. */
  normalize?: boolean
}

/**
 * Build inline SVG output for a vector or shape layer. The default output is a
 * standalone document with the geometry translated so its bounding box origin
 * is (0, 0). Effects are emitted as SVG `<filter>` defs when supported (drop
 * shadow, outer glow). Strokes use Photoshop's alignment semantics: only
 * "center" maps cleanly to SVG stroke; "inside" and "outside" fall back to
 * center with a note in the comment.
 */
export function buildLayerSvg(layer: Layer, options: CopySvgOptions = {}): string | null {
  const geometry = geometryFor(layer)
  if (!geometry) return null
  const { path, bounds } = geometry
  const normalize = options.normalize !== false
  const offsetX = normalize ? -bounds.x : 0
  const offsetY = normalize ? -bounds.y : 0
  const width = round(Math.max(1, bounds.w))
  const height = round(Math.max(1, bounds.h))

  const stroke = layer.shape?.stroke
  const fill = layer.shape?.fill ?? "#000000"
  const effects = svgFromEffects(layer.style)
  const filterAttr = effects.filter ? ` filter="${effects.filter}"` : ""
  const opacityAttr = layer.opacity !== undefined && layer.opacity < 1 ? ` opacity="${round(layer.opacity, 3)}"` : ""

  const d = exportPathToSvgPath(path)
  const transform = offsetX || offsetY ? ` transform="translate(${round(offsetX)} ${round(offsetY)})"` : ""
  const strokeAttrs = stroke && stroke.width > 0
    ? ` stroke="${stroke.color}" stroke-width="${round(stroke.width)}"`
    : ""

  const labelComment = layer.shape?.stroke && layer.shape.stroke.width > 0
    ? `<!-- Note: SVG stroke is centered on the path; Photoshop "inside" / "outside" alignment is approximated as center. -->\n`
    : ""

  const inner = `${effects.defs}${labelComment}<path d="${d}"${transform} fill="${fill}"${strokeAttrs}${filterAttr}${opacityAttr}/>`

  const standalone = options.standalone !== false
  if (!standalone) return inner
  const titleSafe = escapeXml(layer.name || "Shape")
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><title>${titleSafe}</title>${inner}</svg>`
}

/**
 * Attempt to write a snippet to the navigator clipboard. Falls back to a
 * synchronous textarea-based copy when the async clipboard API is unavailable
 * (e.g. insecure contexts). Returns true on success.
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.top = "-1000px"
    textarea.style.left = "0"
    textarea.style.opacity = "0"
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand?.("copy") ?? false
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

// Internal helpers exported for tests.
export const __test = { round, colorToRgba, cssCornerRadius, sanitizeClassName }

/** True when the layer has shape / path / vector-mask geometry that Copy CSS or Copy SVG can serialize. */
export function canCopyVectorClipboard(layer: Layer | null | undefined): boolean {
  if (!layer) return false
  if (layer.shape) return true
  if (layer.path?.points?.length) return true
  if (layer.vectorMask?.points?.length) return true
  return false
}
