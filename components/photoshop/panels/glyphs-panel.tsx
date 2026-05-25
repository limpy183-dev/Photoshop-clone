"use client"

import * as React from "react"
import { Search, Type, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useEditor } from "../editor-context"
import { rasterizeText } from "../tool-helpers"
import type { TextProps } from "../types"

interface UnicodeBlock {
  id: string
  label: string
  start: number
  end: number
}

/**
 * A curated subset of Unicode blocks. We intentionally keep this list
 * compact so the panel never tries to render tens of thousands of code
 * points in one go — large blocks (CJK, etc.) are intentionally excluded
 * because they'd dominate the grid and stall the browser.
 */
const UNICODE_BLOCKS: UnicodeBlock[] = [
  { id: "basic-latin", label: "Basic Latin", start: 0x0020, end: 0x007e },
  { id: "latin1-supplement", label: "Latin-1 Supplement", start: 0x00a0, end: 0x00ff },
  { id: "latin-extended-a", label: "Latin Extended-A", start: 0x0100, end: 0x017f },
  { id: "latin-extended-b", label: "Latin Extended-B", start: 0x0180, end: 0x024f },
  { id: "ipa", label: "IPA Extensions", start: 0x0250, end: 0x02af },
  { id: "spacing-modifiers", label: "Spacing Modifiers", start: 0x02b0, end: 0x02ff },
  { id: "greek", label: "Greek and Coptic", start: 0x0370, end: 0x03ff },
  { id: "cyrillic", label: "Cyrillic", start: 0x0400, end: 0x04ff },
  { id: "hebrew", label: "Hebrew", start: 0x0590, end: 0x05ff },
  { id: "arabic", label: "Arabic", start: 0x0600, end: 0x06ff },
  { id: "general-punctuation", label: "General Punctuation", start: 0x2000, end: 0x206f },
  { id: "superscripts-subscripts", label: "Superscripts & Subscripts", start: 0x2070, end: 0x209f },
  { id: "currency-symbols", label: "Currency Symbols", start: 0x20a0, end: 0x20cf },
  { id: "letterlike-symbols", label: "Letterlike Symbols", start: 0x2100, end: 0x214f },
  { id: "number-forms", label: "Number Forms", start: 0x2150, end: 0x218f },
  { id: "arrows", label: "Arrows", start: 0x2190, end: 0x21ff },
  { id: "mathematical-operators", label: "Mathematical Operators", start: 0x2200, end: 0x22ff },
  { id: "miscellaneous-technical", label: "Miscellaneous Technical", start: 0x2300, end: 0x23ff },
  { id: "box-drawing", label: "Box Drawing", start: 0x2500, end: 0x257f },
  { id: "block-elements", label: "Block Elements", start: 0x2580, end: 0x259f },
  { id: "geometric-shapes", label: "Geometric Shapes", start: 0x25a0, end: 0x25ff },
  { id: "miscellaneous-symbols", label: "Miscellaneous Symbols", start: 0x2600, end: 0x26ff },
  { id: "dingbats", label: "Dingbats", start: 0x2700, end: 0x27bf },
]

const RECENT_GLYPHS_KEY = "ps-glyphs-recent"
const MAX_RECENT = 32
const EMBEDDED_FONT_BLOCK_ID = "__embedded-font"
const MAX_PARSED_FONT_GLYPHS = 4096
const MAX_RENDERED_GLYPHS = 1024

const UNICODE_NAMES: Record<string, string> = {
  "©": "copyright",
  "®": "registered",
  "™": "trademark",
  "°": "degree",
  "±": "plus minus",
  "×": "multiplication",
  "÷": "division",
  "•": "bullet",
  "…": "ellipsis",
  "—": "em dash",
  "–": "en dash",
  "‘": "left single quote",
  "’": "right single quote",
  "“": "left double quote",
  "”": "right double quote",
  "€": "euro",
  "£": "pound",
  "¥": "yen",
  "¢": "cent",
  "§": "section",
  "¶": "paragraph",
  "†": "dagger",
  "‡": "double dagger",
  "←": "left arrow",
  "→": "right arrow",
  "↑": "up arrow",
  "↓": "down arrow",
  "∞": "infinity",
  "≈": "almost equal",
  "≠": "not equal",
  "≤": "less or equal",
  "≥": "greater or equal",
  "Ω": "omega",
  "π": "pi",
  "Σ": "summation",
  "√": "square root",
  "★": "star",
  "☆": "star outline",
  "♥": "heart",
  "♦": "diamond",
  "♠": "spade",
  "♣": "club",
}

function readRecentGlyphs(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(RECENT_GLYPHS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0).slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

function writeRecentGlyphs(list: string[]) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(RECENT_GLYPHS_KEY, JSON.stringify(list.slice(0, MAX_RECENT)))
  } catch {}
}

/**
 * Returns true if the active font (via measureText) has a non-trivial
 * advance for the codepoint. This is the canvas-measureText fallback
 * for environments where the FontFace `unicodeRange` cannot be read or
 * the glyph is not present in the selected font.
 */
function fontSupportsCodepoint(ctx: CanvasRenderingContext2D, fallbackCtx: CanvasRenderingContext2D, codepoint: number): boolean {
  const char = String.fromCodePoint(codepoint)
  const main = ctx.measureText(char).width
  const fallback = fallbackCtx.measureText(char).width
  if (main <= 0.5) return false
  // A missing glyph is typically rendered with a tiny zero-width advance or
  // an identical "missing glyph" box. If the active font's advance differs
  // from a known monospace-fallback reference for an obviously missing CJK
  // sample (sampled below by the caller), we treat it as present. Here we
  // just keep glyphs whose advance is reasonable — anything <= 0.5px is
  // almost certainly a tofu fallback.
  void fallback
  return true
}

interface GlyphCell {
  codepoint: number
  char: string
  hex: string
  label: string
  searchText: string
}

function glyphCellsFromCodepoints(codepoints: readonly number[]): GlyphCell[] {
  const seen = new Set<number>()
  const cells: GlyphCell[] = []
  for (const codepoint of codepoints) {
    if (seen.has(codepoint) || !isRenderableCodepoint(codepoint)) continue
    seen.add(codepoint)
    const cell = glyphCellFromCodepoint(codepoint)
    if (cell) cells.push(cell)
  }
  return cells.sort((a, b) => a.codepoint - b.codepoint)
}

function glyphCellFromCodepoint(codepoint: number): GlyphCell | null {
  try {
    const char = String.fromCodePoint(codepoint)
    const hex = codepointHex(codepoint)
    const friendly = UNICODE_NAMES[char]
    const label = friendly ? `U+${hex} ${friendly}` : `U+${hex}`
    return {
      codepoint,
      char,
      hex,
      label,
      searchText: `${hex} ${char} ${friendly ?? ""}`.toLowerCase(),
    }
  } catch {
    return null
  }
}

function codepointsForBlock(block: UnicodeBlock): number[] {
  const codepoints: number[] = []
  for (let cp = block.start; cp <= block.end; cp++) {
    if (isRenderableCodepoint(cp)) codepoints.push(cp)
  }
  return codepoints
}

function codepointHex(codepoint: number) {
  return codepoint.toString(16).toUpperCase().padStart(codepoint > 0xffff ? 6 : 4, "0")
}

function isRenderableCodepoint(codepoint: number) {
  if (!Number.isInteger(codepoint) || codepoint < 0 || codepoint > 0x10ffff) return false
  if (codepoint >= 0xd800 && codepoint <= 0xdfff) return false
  if (codepoint >= 0x0000 && codepoint <= 0x001f) return false
  if (codepoint >= 0x007f && codepoint <= 0x009f) return false
  return true
}

function bytesFromBase64(dataBase64: string): Uint8Array {
  const binary = globalThis.atob(dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function parseOpenTypeCmap(input: Uint8Array | ArrayBuffer, maxCodepoints = MAX_PARSED_FONT_GLYPHS): number[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.byteLength < 4) return []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Set<number>()
  const rawCmapCount = readU16(view, 2)

  if (readU16(view, 0) === 0 && rawCmapCount !== null && rawCmapCount > 0 && rawCmapCount < 256) {
    parseCmapTable(view, 0, bytes.byteLength, out, maxCodepoints)
    return sortedCodepoints(out)
  }

  const numTables = readU16(view, 4)
  if (numTables === null || bytes.byteLength < 12 + numTables * 16) return []

  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16
    if (readTag(bytes, record) !== "cmap") continue
    const offset = readU32(view, record + 8)
    const length = readU32(view, record + 12)
    if (offset === null || length === null || offset < 0 || length <= 0 || offset + length > bytes.byteLength) return []
    parseCmapTable(view, offset, offset + length, out, maxCodepoints)
    return sortedCodepoints(out)
  }

  return []
}

function parseCmapTable(view: DataView, cmapOffset: number, cmapEnd: number, out: Set<number>, maxCodepoints: number) {
  const numTables = readU16(view, cmapOffset + 2)
  if (numTables === null || numTables <= 0) return
  const records: { platform: number; encoding: number; offset: number }[] = []
  for (let i = 0; i < numTables; i++) {
    const record = cmapOffset + 4 + i * 8
    const platform = readU16(view, record)
    const encoding = readU16(view, record + 2)
    const relOffset = readU32(view, record + 4)
    if (platform === null || encoding === null || relOffset === null) continue
    const offset = cmapOffset + relOffset
    if (offset >= cmapOffset && offset + 2 <= cmapEnd) records.push({ platform, encoding, offset })
  }

  records.sort((a, b) => cmapRecordPriority(a) - cmapRecordPriority(b))
  for (const record of records) {
    parseCmapSubtable(view, record.offset, cmapEnd, out, maxCodepoints)
    if (out.size >= maxCodepoints) return
  }
}

function cmapRecordPriority(record: { platform: number; encoding: number }) {
  if (record.platform === 3 && record.encoding === 10) return 0
  if (record.platform === 0) return 1
  if (record.platform === 3 && record.encoding === 1) return 2
  return 3
}

function parseCmapSubtable(view: DataView, offset: number, cmapEnd: number, out: Set<number>, maxCodepoints: number) {
  const format = readU16(view, offset)
  if (format === 0) return parseCmapFormat0(view, offset, cmapEnd, out, maxCodepoints)
  if (format === 4) return parseCmapFormat4(view, offset, cmapEnd, out, maxCodepoints)
  if (format === 6) return parseCmapFormat6(view, offset, cmapEnd, out, maxCodepoints)
  if (format === 12 || format === 13) return parseCmapFormat12Or13(view, offset, cmapEnd, out, maxCodepoints)
}

function parseCmapFormat0(view: DataView, offset: number, cmapEnd: number, out: Set<number>, maxCodepoints: number) {
  const length = readU16(view, offset + 2)
  if (length === null) return
  const end = Math.min(cmapEnd, offset + length)
  const glyphs = offset + 6
  for (let cp = 0; cp < 256 && glyphs + cp < end && out.size < maxCodepoints; cp++) {
    if (view.getUint8(glyphs + cp)) out.add(cp)
  }
}

function parseCmapFormat4(view: DataView, offset: number, cmapEnd: number, out: Set<number>, maxCodepoints: number) {
  const length = readU16(view, offset + 2)
  const segCountX2 = readU16(view, offset + 6)
  if (length === null || segCountX2 === null || segCountX2 % 2 !== 0) return
  const subEnd = Math.min(cmapEnd, offset + length)
  const segCount = segCountX2 / 2
  const endCodeOffset = offset + 14
  const startCodeOffset = endCodeOffset + segCount * 2 + 2
  const idDeltaOffset = startCodeOffset + segCount * 2
  const idRangeOffsetOffset = idDeltaOffset + segCount * 2
  if (idRangeOffsetOffset + segCount * 2 > subEnd) return

  for (let i = 0; i < segCount && out.size < maxCodepoints; i++) {
    const end = readU16(view, endCodeOffset + i * 2)
    const start = readU16(view, startCodeOffset + i * 2)
    const delta = readI16(view, idDeltaOffset + i * 2)
    const rangeOffset = readU16(view, idRangeOffsetOffset + i * 2)
    if (start === null || end === null || delta === null || rangeOffset === null || start > end) continue
    if (start === 0xffff && end === 0xffff) continue

    for (let cp = start; cp <= end && out.size < maxCodepoints; cp++) {
      let glyphId = 0
      if (rangeOffset === 0) {
        glyphId = (cp + delta) & 0xffff
      } else {
        const glyphOffset = idRangeOffsetOffset + i * 2 + rangeOffset + (cp - start) * 2
        const rawGlyph = readU16(view, glyphOffset)
        if (rawGlyph === null || glyphOffset + 2 > subEnd) continue
        glyphId = rawGlyph === 0 ? 0 : (rawGlyph + delta) & 0xffff
      }
      if (glyphId !== 0 && isRenderableCodepoint(cp)) out.add(cp)
    }
  }
}

function parseCmapFormat6(view: DataView, offset: number, cmapEnd: number, out: Set<number>, maxCodepoints: number) {
  const length = readU16(view, offset + 2)
  const firstCode = readU16(view, offset + 6)
  const entryCount = readU16(view, offset + 8)
  if (length === null || firstCode === null || entryCount === null) return
  const subEnd = Math.min(cmapEnd, offset + length)
  const glyphs = offset + 10
  for (let i = 0; i < entryCount && glyphs + i * 2 + 2 <= subEnd && out.size < maxCodepoints; i++) {
    const glyphId = readU16(view, glyphs + i * 2)
    const cp = firstCode + i
    if (glyphId && isRenderableCodepoint(cp)) out.add(cp)
  }
}

function parseCmapFormat12Or13(view: DataView, offset: number, cmapEnd: number, out: Set<number>, maxCodepoints: number) {
  const length = readU32(view, offset + 4)
  const groupCount = readU32(view, offset + 12)
  if (length === null || groupCount === null) return
  const subEnd = Math.min(cmapEnd, offset + length)
  let cursor = offset + 16
  for (let i = 0; i < groupCount && cursor + 12 <= subEnd && out.size < maxCodepoints; i++, cursor += 12) {
    const start = readU32(view, cursor)
    const end = readU32(view, cursor + 4)
    const startGlyph = readU32(view, cursor + 8)
    if (start === null || end === null || startGlyph === null || start > end || startGlyph === 0) continue
    for (let cp = start; cp <= end && cp <= 0x10ffff && out.size < maxCodepoints; cp++) {
      if (isRenderableCodepoint(cp)) out.add(cp)
    }
  }
}

function readTag(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 4 > bytes.byteLength) return ""
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
}

function readU16(view: DataView, offset: number) {
  return offset >= 0 && offset + 2 <= view.byteLength ? view.getUint16(offset) : null
}

function readI16(view: DataView, offset: number) {
  return offset >= 0 && offset + 2 <= view.byteLength ? view.getInt16(offset) : null
}

function readU32(view: DataView, offset: number) {
  return offset >= 0 && offset + 4 <= view.byteLength ? view.getUint32(offset) : null
}

function sortedCodepoints(values: Set<number>) {
  return [...values].filter(isRenderableCodepoint).sort((a, b) => a - b)
}

export function GlyphsPanel() {
  const { activeLayer, activeDoc, dispatch, commit } = useEditor()
  const [blockId, setBlockId] = React.useState<string>(UNICODE_BLOCKS[0].id)
  const [query, setQuery] = React.useState("")
  const [recent, setRecent] = React.useState<string[]>(() => readRecentGlyphs())
  const [fontFilter, setFontFilter] = React.useState(false)

  const fontFamily = activeLayer?.kind === "text" && activeLayer.text ? activeLayer.text.font : "system-ui, sans-serif"
  const fontSize = activeLayer?.kind === "text" && activeLayer.text ? Math.max(18, Math.min(36, activeLayer.text.size)) : 22
  const embeddedFontData = activeLayer?.kind === "text" ? activeLayer.text?.embeddedFont?.dataBase64 : undefined
  const embeddedFontName = activeLayer?.kind === "text" ? activeLayer.text?.embeddedFont?.family : undefined
  const embeddedFontCodepoints = React.useMemo(() => {
    if (!embeddedFontData) return []
    try {
      return parseOpenTypeCmap(bytesFromBase64(embeddedFontData))
    } catch {
      return []
    }
  }, [embeddedFontData])
  const activeBlockId = blockId === EMBEDDED_FONT_BLOCK_ID && !embeddedFontCodepoints.length ? UNICODE_BLOCKS[0].id : blockId
  const block = React.useMemo(() => UNICODE_BLOCKS.find((b) => b.id === activeBlockId) ?? UNICODE_BLOCKS[0], [activeBlockId])

  React.useEffect(() => {
    if (blockId === EMBEDDED_FONT_BLOCK_ID && !embeddedFontCodepoints.length) setBlockId(UNICODE_BLOCKS[0].id)
  }, [blockId, embeddedFontCodepoints.length])

  const supportTester = React.useMemo(() => {
    if (typeof document === "undefined") return null
    const canvas = document.createElement("canvas")
    const fallbackCanvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    const fb = fallbackCanvas.getContext("2d")
    if (!ctx || !fb) return null
    ctx.font = `24px ${fontFamily}`
    fb.font = "24px monospace"
    return { ctx, fallback: fb }
  }, [fontFamily])

  const cells = React.useMemo<GlyphCell[]>(() => {
    if (activeBlockId === EMBEDDED_FONT_BLOCK_ID) return glyphCellsFromCodepoints(embeddedFontCodepoints)
    return glyphCellsFromCodepoints(codepointsForBlock(block))
  }, [activeBlockId, block, embeddedFontCodepoints])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = cells
    if (q) {
      // Allow searching by codepoint hex (e.g. "20ac"), decimal, or name.
      const dec = /^\d+$/.test(q) ? parseInt(q, 10) : NaN
      list = list.filter((cell) => {
        if (!Number.isNaN(dec) && cell.codepoint === dec) return true
        return cell.searchText.includes(q)
      })
    }
    if (fontFilter && supportTester) {
      list = list.filter((cell) => fontSupportsCodepoint(supportTester.ctx, supportTester.fallback, cell.codepoint))
    }
    return list.slice(0, MAX_RENDERED_GLYPHS)
  }, [cells, query, fontFilter, supportTester])

  const targetIsText = activeLayer?.kind === "text" && activeLayer.text != null

  const insertGlyph = React.useCallback((glyph: string) => {
    if (!targetIsText || !activeLayer || activeLayer.kind !== "text" || !activeLayer.text) return
    const next: TextProps = { ...activeLayer.text, content: `${activeLayer.text.content}${glyph}` }
    dispatch({ type: "set-layer-text", id: activeLayer.id, text: next })
    rasterizeText(activeLayer.canvas, next)
    const updated = [glyph, ...recent.filter((g) => g !== glyph)].slice(0, MAX_RECENT)
    setRecent(updated)
    writeRecentGlyphs(updated)
    window.setTimeout(() => commit("Insert Glyph", [activeLayer.id]), 0)
  }, [activeLayer, commit, dispatch, recent, targetIsText])

  const clearRecent = () => {
    setRecent([])
    writeRecentGlyphs([])
  }
  const sourceLabel = activeBlockId === EMBEDDED_FONT_BLOCK_ID
    ? `embedded font ${embeddedFontName ?? fontFamily}`
    : block.label

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="space-y-2 border-b border-[var(--ps-divider)] p-2">
        <div className="flex items-center gap-1 text-[10px] text-[var(--ps-text-dim)]">
          <Type className="h-3.5 w-3.5" />
          <span className="truncate">
            {activeDoc
              ? `Font: ${fontFamily}${embeddedFontCodepoints.length ? ` - ${embeddedFontCodepoints.length} embedded glyphs` : ""}`
              : "No document open"}
          </span>
        </div>
        <select
          value={activeBlockId}
          onChange={(event) => setBlockId(event.target.value)}
          className="h-7 w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] outline-none"
          aria-label="Unicode block"
        >
          {embeddedFontCodepoints.length ? (
            <option value={EMBEDDED_FONT_BLOCK_ID}>Active embedded font cmap</option>
          ) : null}
          {UNICODE_BLOCKS.map((block) => (
            <option key={block.id} value={block.id}>{block.label}</option>
          ))}
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ps-text-dim)]" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, hex (20ac), or character"
            className="h-7 bg-[var(--ps-panel-2)] pl-7 text-[11px]"
          />
        </div>
        <label className="flex items-center gap-2 text-[10px] text-[var(--ps-text-dim)]">
          <input
            type="checkbox"
            checked={fontFilter}
            onChange={(event) => setFontFilter(event.target.checked)}
          />
          Only glyphs the active font appears to render
        </label>
        <div className="text-[10px] text-[var(--ps-text-dim)]">
          {targetIsText
            ? "Click a glyph to append it to the active text layer."
            : "Select a text layer to enable glyph insertion."}
        </div>
      </div>

      {recent.length ? (
        <div className="space-y-1 border-b border-[var(--ps-divider)] p-2">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
            <span>Recent</span>
            <button
              type="button"
              onClick={clearRecent}
              className="inline-flex items-center gap-1 text-[10px] text-[var(--ps-text-dim)] hover:text-[var(--ps-text)]"
              aria-label="Clear recent glyphs"
            >
              <Trash2 className="h-3 w-3" /> Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {recent.map((glyph, index) => (
              <button
                key={`${glyph}-${index}`}
                type="button"
                disabled={!targetIsText}
                onClick={() => insertGlyph(glyph)}
                title={`Insert "${glyph}"`}
                className="h-8 min-w-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[15px] hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
                style={{ fontFamily }}
              >
                {glyph}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {filtered.length ? (
          <div className="grid grid-cols-6 gap-1">
            {filtered.map((cell) => (
              <button
                key={cell.codepoint}
                type="button"
                disabled={!targetIsText}
                title={cell.label}
                onClick={() => insertGlyph(cell.char)}
                className="flex h-10 flex-col items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[15px] hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
                style={{ fontFamily, fontSize }}
              >
                <span>{cell.char}</span>
                <span className="text-[8px] text-[var(--ps-text-dim)]">{cell.hex}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-sm border border-dashed border-[var(--ps-divider)] p-4 text-center text-[var(--ps-text-dim)]">
            No glyphs match the current filter.
          </div>
        )}
      </div>

      <div className="border-t border-[var(--ps-divider)] p-2 text-[10px] text-[var(--ps-text-dim)]">
        Showing {filtered.length} of {cells.length} in {sourceLabel}.
      </div>
    </div>
  )
}

export const __glyphsPanelInternals = {
  UNICODE_BLOCKS,
  glyphCellsFromCodepoints,
  fontSupportsCodepoint,
  parseOpenTypeCmap,
  readRecentGlyphs,
  writeRecentGlyphs,
}
