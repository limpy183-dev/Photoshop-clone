import type {
  PathPoint,
  PathProps,
  TextProps,
  TypographyEmbeddedFont,
} from "../types"
import { embeddedFontToArrayBuffer } from "./embedded-fonts"

export function readTag(data: Uint8Array, offset: number) {
  if (offset < 0 || offset + 4 > data.length) return ""
  return String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])
}

export function fixed16(view: DataView, offset: number) {
  return view.getInt32(offset, false) / 65536
}

function decodeNameString(bytes: Uint8Array, platformId: number, offset: number, length: number) {
  if (offset < 0 || length <= 0 || offset + length > bytes.length) return ""
  const slice = bytes.subarray(offset, offset + length)
  if (platformId === 0 || platformId === 3) {
    let value = ""
    for (let i = 0; i + 1 < slice.length; i += 2) {
      const code = (slice[i] << 8) | slice[i + 1]
      if (code) value += String.fromCharCode(code)
    }
    return value.trim()
  }
  return Array.from(slice, (code) => String.fromCharCode(code)).join("").trim()
}

export function parseNameTable(data: Uint8Array, view: DataView, offset: number, length: number) {
  const names = new Map<number, string>()
  const tableEnd = offset + length
  if (offset < 0 || tableEnd > data.length || length < 6) return names
  const count = view.getUint16(offset + 2, false)
  const stringOffset = view.getUint16(offset + 4, false)
  const recordsEnd = offset + 6 + count * 12
  if (recordsEnd > tableEnd) return names
  const scores = new Map<number, number>()
  for (let i = 0; i < count; i++) {
    const record = offset + 6 + i * 12
    const platformId = view.getUint16(record, false)
    const languageId = view.getUint16(record + 4, false)
    const nameId = view.getUint16(record + 6, false)
    const stringLength = view.getUint16(record + 8, false)
    const localOffset = view.getUint16(record + 10, false)
    const absoluteOffset = offset + stringOffset + localOffset
    const value = decodeNameString(data, platformId, absoluteOffset, stringLength)
    if (!value) continue
    const score = platformId === 3 && languageId === 0x0409 ? 0 : platformId === 3 ? 1 : 2
    if (!names.has(nameId) || score < (scores.get(nameId) ?? 99)) {
      names.set(nameId, value)
      scores.set(nameId, score)
    }
  }
  return names
}

export function sfntTables(buffer: ArrayBuffer) {
  const data = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const tables = new Map<string, { offset: number; length: number }>()
  if (data.length < 12) return { data, view, tables }
  const tableCount = view.getUint16(4, false)
  for (let i = 0; i < tableCount; i++) {
    const record = 12 + i * 16
    if (record + 16 > data.length) break
    const tag = readTag(data, record)
    const offset = view.getUint32(record + 8, false)
    const length = view.getUint32(record + 12, false)
    if (offset >= 0 && length >= 0 && offset + length <= data.length) tables.set(tag, { offset, length })
  }
  return { data, view, tables }
}

export function detectSfntFormat(buffer: ArrayBuffer): TypographyEmbeddedFont["format"] {
  const data = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength))
  const tag = data.length === 4 ? String.fromCharCode(data[0], data[1], data[2], data[3]) : ""
  if (tag === "wOFF") return "woff"
  if (tag === "wOF2") return "woff2"
  if (tag === "OTTO") return "otf"
  if (data[0] === 0 && data[1] === 1 && data[2] === 0 && data[3] === 0) return "ttf"
  return "unknown"
}

export function parseLayoutFeatureTags(data: Uint8Array, view: DataView, table: { offset: number; length: number } | undefined) {
  const tags: string[] = []
  if (!table || table.length < 10) return tags
  const tableEnd = table.offset + table.length
  const featureListOffset = view.getUint16(table.offset + 6, false)
  const featureList = table.offset + featureListOffset
  if (featureList < table.offset || featureList + 2 > tableEnd) return tags
  const count = view.getUint16(featureList, false)
  const recordsEnd = featureList + 2 + count * 6
  if (recordsEnd > tableEnd) return tags
  for (let i = 0; i < count; i++) {
    const record = featureList + 2 + i * 6
    const tag = readTag(data, record)
    if (/^[A-Za-z0-9 ]{4}$/.test(tag) && tag.trim()) tags.push(tag)
  }
  return tags
}

export interface ParsedGlyphPoint {
  x: number
  y: number
  onCurve: boolean
}

export interface ParsedOpenTypeFont {
  unitsPerEm: number
  ascent: number
  descent: number
  glyphCount: number
  indexToLocFormat: number
  numLongMetrics: number
  tables: Map<string, { offset: number; length: number }>
  data: Uint8Array
  view: DataView
  cmap: Map<number, number>
  hMetrics: Array<{ advanceWidth: number; leftSideBearing: number }>
}

function parseCmapFormat4(data: Uint8Array, view: DataView, offset: number, length: number) {
  const map = new Map<number, number>()
  const end = offset + length
  if (offset + 16 > data.length || end > data.length) return map
  const segCount = view.getUint16(offset + 6, false) / 2
  if (!Number.isFinite(segCount) || segCount <= 0) return map
  const endCode = offset + 14
  const startCode = endCode + segCount * 2 + 2
  const idDelta = startCode + segCount * 2
  const idRangeOffset = idDelta + segCount * 2
  if (idRangeOffset + segCount * 2 > end) return map
  for (let i = 0; i < segCount; i++) {
    const start = view.getUint16(startCode + i * 2, false)
    const stop = view.getUint16(endCode + i * 2, false)
    if (start === 0xffff && stop === 0xffff) continue
    if (stop < start || stop - start > 4096) continue
    const delta = view.getInt16(idDelta + i * 2, false)
    const rangeOffsetPosition = idRangeOffset + i * 2
    const rangeOffset = view.getUint16(rangeOffsetPosition, false)
    for (let code = start; code <= stop; code++) {
      let glyphId = 0
      if (rangeOffset === 0) {
        glyphId = (code + delta) & 0xffff
      } else {
        const glyphOffset = rangeOffsetPosition + rangeOffset + (code - start) * 2
        if (glyphOffset + 2 > end) continue
        glyphId = view.getUint16(glyphOffset, false)
        if (glyphId) glyphId = (glyphId + delta) & 0xffff
      }
      if (glyphId) map.set(code, glyphId)
    }
  }
  return map
}

function parseFontCmap(data: Uint8Array, view: DataView, table: { offset: number; length: number } | undefined) {
  const empty = new Map<number, number>()
  if (!table || table.length < 4) return empty
  const tableEnd = table.offset + table.length
  const count = view.getUint16(table.offset + 2, false)
  let fallback: Map<number, number> | null = null
  for (let i = 0; i < count; i++) {
    const record = table.offset + 4 + i * 8
    if (record + 8 > tableEnd) break
    const platform = view.getUint16(record, false)
    const encoding = view.getUint16(record + 2, false)
    const subOffset = table.offset + view.getUint32(record + 4, false)
    if (subOffset + 2 > tableEnd) continue
    const format = view.getUint16(subOffset, false)
    const length = format === 4 ? view.getUint16(subOffset + 2, false) : 0
    if (format !== 4 || subOffset + length > tableEnd) continue
    const parsed = parseCmapFormat4(data, view, subOffset, length)
    if ((platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0) return parsed
    fallback = fallback ?? parsed
  }
  return fallback ?? empty
}

export function parseOpenTypeFont(buffer: ArrayBuffer): ParsedOpenTypeFont | null {
  const { data, view, tables } = sfntTables(buffer)
  const head = tables.get("head")
  const hhea = tables.get("hhea")
  const hmtx = tables.get("hmtx")
  const maxp = tables.get("maxp")
  const cmap = tables.get("cmap")
  if (!head || !hhea || !hmtx || !maxp || !cmap) return null
  if (head.length < 54 || hhea.length < 36 || maxp.length < 6) return null
  const glyphCount = view.getUint16(maxp.offset + 4, false)
  const numLongMetrics = view.getUint16(hhea.offset + 34, false)
  const hMetrics: ParsedOpenTypeFont["hMetrics"] = []
  for (let i = 0; i < Math.max(1, numLongMetrics); i++) {
    const offset = hmtx.offset + i * 4
    if (offset + 4 > hmtx.offset + hmtx.length) break
    hMetrics.push({
      advanceWidth: view.getUint16(offset, false),
      leftSideBearing: view.getInt16(offset + 2, false),
    })
  }
  return {
    unitsPerEm: Math.max(1, view.getUint16(head.offset + 18, false)),
    ascent: view.getInt16(hhea.offset + 4, false),
    descent: view.getInt16(hhea.offset + 6, false),
    glyphCount,
    indexToLocFormat: view.getInt16(head.offset + 50, false),
    numLongMetrics,
    tables,
    data,
    view,
    cmap: parseFontCmap(data, view, cmap),
    hMetrics,
  }
}

export function glyphMetric(font: ParsedOpenTypeFont, glyphId: number) {
  if (font.hMetrics[glyphId]) return font.hMetrics[glyphId]
  return font.hMetrics[font.hMetrics.length - 1] ?? { advanceWidth: font.unitsPerEm * 0.6, leftSideBearing: 0 }
}

function glyphOffset(font: ParsedOpenTypeFont, glyphId: number) {
  const loca = font.tables.get("loca")
  const glyf = font.tables.get("glyf")
  if (!loca || !glyf || glyphId < 0 || glyphId > font.glyphCount) return null
  if (font.indexToLocFormat === 0) {
    const position = loca.offset + glyphId * 2
    if (position + 4 > loca.offset + loca.length) return null
    return {
      start: glyf.offset + font.view.getUint16(position, false) * 2,
      end: glyf.offset + font.view.getUint16(position + 2, false) * 2,
    }
  }
  const position = loca.offset + glyphId * 4
  if (position + 8 > loca.offset + loca.length) return null
  return {
    start: glyf.offset + font.view.getUint32(position, false),
    end: glyf.offset + font.view.getUint32(position + 4, false),
  }
}

export function parseSimpleGlyph(font: ParsedOpenTypeFont, glyphId: number): ParsedGlyphPoint[][] {
  const location = glyphOffset(font, glyphId)
  if (!location || location.end <= location.start || location.end > font.data.length) return []
  const view = font.view
  const start = location.start
  const contourCount = view.getInt16(start, false)
  if (contourCount <= 0) return []
  const endPts: number[] = []
  for (let i = 0; i < contourCount; i++) endPts.push(view.getUint16(start + 10 + i * 2, false))
  const pointCount = (endPts[endPts.length - 1] ?? -1) + 1
  if (pointCount <= 0) return []
  let offset = start + 10 + contourCount * 2
  const instructionLength = view.getUint16(offset, false)
  offset += 2 + instructionLength
  const flags: number[] = []
  while (flags.length < pointCount && offset < location.end) {
    const flag = font.data[offset++]
    flags.push(flag)
    if (flag & 0x08) {
      const repeat = font.data[offset++] ?? 0
      for (let i = 0; i < repeat; i++) flags.push(flag)
    }
  }
  const xs: number[] = []
  let x = 0
  for (let i = 0; i < pointCount; i++) {
    const flag = flags[i] ?? 0
    if (flag & 0x02) {
      const dx = font.data[offset++] ?? 0
      x += flag & 0x10 ? dx : -dx
    } else if (!(flag & 0x10)) {
      x += view.getInt16(offset, false)
      offset += 2
    }
    xs.push(x)
  }
  const ys: number[] = []
  let y = 0
  for (let i = 0; i < pointCount; i++) {
    const flag = flags[i] ?? 0
    if (flag & 0x04) {
      const dy = font.data[offset++] ?? 0
      y += flag & 0x20 ? dy : -dy
    } else if (!(flag & 0x20)) {
      y += view.getInt16(offset, false)
      offset += 2
    }
    ys.push(y)
  }
  const contours: ParsedGlyphPoint[][] = []
  let cursor = 0
  for (const endPoint of endPts) {
    const contour: ParsedGlyphPoint[] = []
    for (let i = cursor; i <= endPoint; i++) {
      contour.push({ x: xs[i], y: ys[i], onCurve: !!(flags[i] & 0x01) })
    }
    if (contour.length) contours.push(contour)
    cursor = endPoint + 1
  }
  return contours
}

function samePoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6
}

export function convertGlyphContourToPath(
  contour: ParsedGlyphPoint[],
  transform: (point: { x: number; y: number }) => { x: number; y: number },
): PathProps | null {
  if (!contour.length) return null
  const expanded: ParsedGlyphPoint[] = []
  for (let i = 0; i < contour.length; i++) {
    const current = contour[i]
    const next = contour[(i + 1) % contour.length]
    expanded.push(current)
    if (!current.onCurve && !next.onCurve) {
      expanded.push({ x: (current.x + next.x) / 2, y: (current.y + next.y) / 2, onCurve: true })
    }
  }
  const firstOn = expanded.findIndex((point) => point.onCurve)
  if (firstOn < 0) return null
  const points = [...expanded.slice(firstOn), ...expanded.slice(0, firstOn)]
  const first = transform(points[0])
  const pathPoints: PathPoint[] = [{ x: first.x, y: first.y }]
  for (let i = 1; i < points.length; i++) {
    const point = points[i]
    if (point.onCurve) {
      const target = transform(point)
      if (!samePoint(target, pathPoints[pathPoints.length - 1])) pathPoints.push({ x: target.x, y: target.y })
      continue
    }
    const next = points[(i + 1) % points.length]
    const endSource = next.onCurve ? next : { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2, onCurve: true }
    const startPoint = pathPoints[pathPoints.length - 1]
    const control = transform(point)
    const end = transform(endSource)
    startPoint.cp2 = {
      x: startPoint.x + (control.x - startPoint.x) * 2 / 3,
      y: startPoint.y + (control.y - startPoint.y) * 2 / 3,
    }
    const cubicEnd = {
      x: end.x,
      y: end.y,
      cp1: {
        x: end.x + (control.x - end.x) * 2 / 3,
        y: end.y + (control.y - end.y) * 2 / 3,
      },
    }
    if (samePoint(cubicEnd, pathPoints[0])) {
      pathPoints[0].cp1 = cubicEnd.cp1
    } else {
      pathPoints.push(cubicEnd)
    }
    if (next.onCurve) i += 1
  }
  if (pathPoints.length > 1 && samePoint(pathPoints[0], pathPoints[pathPoints.length - 1])) pathPoints.pop()
  return { points: pathPoints, closed: true, source: "font-outline" }
}

export function embeddedFontForText(text: TextProps): ParsedOpenTypeFont | null {
  if (!text.embeddedFont) return null
  const bytes = embeddedFontToArrayBuffer(text.embeddedFont)
  return parseOpenTypeFont(bytes)
}
