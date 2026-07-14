import type { PathPoint, PathProps, TextProps } from "../types"
import { shapeToEditablePath } from "../vector-path-operations"
import { convertGlyphContourToPath, embeddedFontForText, glyphMetric, parseSimpleGlyph } from "./font-parser"
import { glyphAdvance } from "./glyph-advance"

function pushGlyphOutline(points: PathPoint[], x: number, y: number, w: number, h: number, bevel: number) {
  const r = Math.min(bevel, w / 3, h / 3)
  points.push(
    { x: x + r, y, cp1: { x, y }, cp2: { x, y: y + r } },
    { x: x + w - r, y },
    { x: x + w, y: y + r, cp1: { x: x + w, y }, cp2: { x: x + w, y: y + r } },
    { x: x + w, y: y + h - r },
    { x: x + w - r, y: y + h, cp1: { x: x + w, y: y + h }, cp2: { x: x + w - r, y: y + h } },
    { x: x + r, y: y + h },
    { x, y: y + h - r, cp1: { x, y: y + h }, cp2: { x, y: y + h - r } },
    { x, y: y + r },
  )
}

function convertTextToFontOutlinePath(text: TextProps): PathProps | null {
  const font = embeddedFontForText(text)
  if (!font) return null
  const points: PathPoint[] = []
  const subpaths: PathProps[] = []
  const scale = Math.max(1, text.size) / font.unitsPerEm
  const trackingPx = ((text.tracking ?? 0) / 1000) * text.size
  const lineHeight = text.leading ?? text.size * 1.2
  const content = text.allCaps ? text.content.toUpperCase() : text.content
  let cursorX = 0
  let lineY = 0

  if (text.textShape) {
    const shapePath = shapeToEditablePath(text.textShape)
    shapePath.source = "shape"
    points.push(...shapePath.points)
    subpaths.push(shapePath)
  }

  for (const char of content) {
    if (char === "\n") {
      cursorX = 0
      lineY += lineHeight
      continue
    }
    const glyphId = font.cmap.get(char.codePointAt(0) ?? 0) ?? 0
    const metric = glyphMetric(font, glyphId)
    if (char.trim() && glyphId > 0) {
      const contours = parseSimpleGlyph(font, glyphId)
      for (const contour of contours) {
        const path = convertGlyphContourToPath(contour, (point) => ({
          x: text.x + cursorX + point.x * scale,
          y: text.y + lineY + (font.ascent - point.y) * scale + (text.baselineShift ?? 0),
        }))
        if (!path) continue
        points.push(...path.points)
        subpaths.push(path)
      }
    }
    cursorX += metric.advanceWidth * scale + trackingPx
  }

  return subpaths.some((path) => path.source === "font-outline")
    ? { points, closed: true, source: "font-outline", subpaths }
    : null
}

export function convertTextToEditablePath(text: TextProps): PathProps {
  const exactFontPath = convertTextToFontOutlinePath(text)
  if (exactFontPath) return exactFontPath

  const points: PathPoint[] = []
  const subpaths: PathProps[] = []
  if (text.textShape) {
    const shapePath = shapeToEditablePath(text.textShape)
    shapePath.source = "shape"
    points.push(...shapePath.points)
    subpaths.push(shapePath)
  }
  const lineHeight = text.leading ?? text.size * 1.2
  let x = text.x
  let y = text.y
  const startX = text.x

  for (const char of text.allCaps ? text.content.toUpperCase() : text.content) {
    if (char === "\n") {
      x = startX
      y += lineHeight
      continue
    }
    const advance = glyphAdvance(text, char)
    if (char.trim()) {
      const glyphPoints: PathPoint[] = []
      pushGlyphOutline(glyphPoints, x, y, Math.max(2, advance * 0.86), text.size, Math.max(1, text.size * 0.08))
      points.push(...glyphPoints)
      subpaths.push({ points: glyphPoints, closed: true, source: "approximated-glyph" })
    }
    x += advance
  }

  if (!points.length) {
    const glyphPoints: PathPoint[] = []
    pushGlyphOutline(glyphPoints, text.x, text.y, Math.max(4, text.size * 0.4), Math.max(4, text.size), 1)
    points.push(...glyphPoints)
    subpaths.push({ points: glyphPoints, closed: true, source: "approximated-glyph" })
  }

  return { points, closed: true, source: "approximated-glyph", subpaths }
}
