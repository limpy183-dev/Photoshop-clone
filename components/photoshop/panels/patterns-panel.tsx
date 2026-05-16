"use client"

import * as React from "react"
import { Download, Plus, RotateCcw, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { downloadText } from "../document-io"
import { useEditor } from "../editor-context"

interface PatternEntry {
  id: string
  name: string
  dataURL: string
  width: number
  height: number
}

const STORAGE_KEY = "ps-patterns"
const MAX_PATTERNS = 128
const MAX_PATTERN_FILE_BYTES = 4 * 1024 * 1024
const MAX_PATTERN_DIMENSION = 4096
const MAX_PATTERN_DATA_URL_LENGTH = 4_000_000

function scopedStorageKey(docId: string | undefined) {
  return docId ? `${STORAGE_KEY}:${docId}` : STORAGE_KEY
}

function isSafePatternDataURL(value: string) {
  return (
    value.length <= MAX_PATTERN_DATA_URL_LENGTH &&
    /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value)
  )
}

function normalizePatterns(value: unknown): PatternEntry[] {
  const source =
    value && typeof value === "object" && !Array.isArray(value) && "patterns" in value
      ? (value as { patterns?: unknown }).patterns
      : value
  if (!Array.isArray(source)) return []

  const next: PatternEntry[] = []
  const seen = new Set<string>()
  for (const item of source) {
    if (!item || typeof item !== "object") continue
    const candidate = item as Partial<PatternEntry>
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.name !== "string" ||
      typeof candidate.dataURL !== "string" ||
      typeof candidate.width !== "number" ||
      typeof candidate.height !== "number" ||
      !Number.isFinite(candidate.width) ||
      !Number.isFinite(candidate.height) ||
      !isSafePatternDataURL(candidate.dataURL)
    ) {
      continue
    }

    const id = candidate.id.trim().slice(0, 80)
    if (!id || seen.has(id)) continue
    seen.add(id)

    next.push({
      id,
      name: candidate.name.trim().slice(0, 80) || "Pattern",
      dataURL: candidate.dataURL,
      width: Math.max(1, Math.min(MAX_PATTERN_DIMENSION, Math.round(candidate.width))),
      height: Math.max(1, Math.min(MAX_PATTERN_DIMENSION, Math.round(candidate.height))),
    })

    if (next.length >= MAX_PATTERNS) break
  }

  return next
}

function loadPatterns(docId?: string): PatternEntry[] {
  if (typeof window === "undefined") return []
  try {
    const scoped = docId ? localStorage.getItem(scopedStorageKey(docId)) : null
    const saved = scoped ?? localStorage.getItem(STORAGE_KEY)
    return saved ? normalizePatterns(JSON.parse(saved)) : []
  } catch {
    return []
  }
}

function persistPatterns(patterns: PatternEntry[], docId?: string) {
  try {
    localStorage.setItem(scopedStorageKey(docId), JSON.stringify(patterns))
  } catch {
    toast.error("Pattern library is too large to save locally.")
  }
}

export function PatternsPanel() {
  const { activeDoc, activeLayer, commit, requestRender } = useEditor()
  const [patterns, setPatterns] = React.useState<PatternEntry[]>(() => loadPatterns(activeDoc?.id))
  const importRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    setPatterns(loadPatterns(activeDoc?.id))
  }, [activeDoc?.id])

  const save = React.useCallback((value: PatternEntry[]) => {
    const next = normalizePatterns(value)
    setPatterns(next)
    persistPatterns(next, activeDoc?.id)
  }, [activeDoc?.id])

  const definePattern = () => {
    if (!activeDoc || !activeLayer) return
    const cv = activeLayer.canvas
    if (typeof cv.toDataURL !== "function") return

    const sel = activeDoc.selection.bounds
    let dataURL: string
    let width: number
    let height: number

    if (sel) {
      const tmp = document.createElement("canvas")
      tmp.width = sel.w
      tmp.height = sel.h
      const ctx = tmp.getContext("2d")
      if (!ctx) return
      ctx.drawImage(cv, sel.x, sel.y, sel.w, sel.h, 0, 0, sel.w, sel.h)
      dataURL = tmp.toDataURL()
      width = sel.w
      height = sel.h
    } else {
      dataURL = cv.toDataURL()
      width = cv.width
      height = cv.height
    }

    if (!isSafePatternDataURL(dataURL)) {
      toast.error("Pattern is too large to save.")
      return
    }

    const entry: PatternEntry = {
      id: `pat-${Date.now()}`,
      name: `Pattern ${patterns.length + 1}`,
      dataURL,
      width,
      height,
    }
    save([...patterns, entry])
    toast.success("Pattern defined")
  }

  const deletePattern = (id: string) => {
    save(patterns.filter((pattern) => pattern.id !== id))
  }

  const fillWithPattern = (patternEntry: PatternEntry) => {
    if (!activeDoc || !activeLayer) return
    const cv = activeLayer.canvas
    const ctx = cv.getContext("2d")
    if (!ctx) return
    const img = new Image()
    img.onload = () => {
      const pattern = ctx.createPattern(img, "repeat")
      if (!pattern) return
      ctx.save()
      ctx.fillStyle = pattern
      ctx.fillRect(0, 0, cv.width, cv.height)
      ctx.restore()
      requestRender()
      commit("Pattern Fill", [activeLayer.id])
    }
    img.src = patternEntry.dataURL
  }

  const exportPatterns = () => {
    downloadText(
      JSON.stringify(
        {
          app: "Photoshop Web",
          format: "ps-patterns",
          version: 1,
          patterns,
        },
        null,
        2,
      ),
      "photoshop-patterns.pspatterns.json",
    )
  }

  const importPatterns = async (file: File) => {
    try {
      if (file.size > MAX_PATTERN_FILE_BYTES) throw new Error("Pattern files are limited to 4 MB.")
      const next = normalizePatterns(JSON.parse(await file.text()))
      if (!next.length) throw new Error("Pattern file does not contain valid patterns.")
      save(next)
      toast.success(`Imported ${next.length} pattern${next.length === 1 ? "" : "s"}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import patterns")
    } finally {
      if (importRef.current) importRef.current.value = ""
    }
  }

  return (
    <div className="p-2 text-[11px] text-[var(--ps-text)] space-y-2">
      <input
        ref={importRef}
        type="file"
        accept=".json,.pspatterns,.pspatterns.json,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file) void importPatterns(file)
        }}
      />
      {patterns.length === 0 && (
        <div className="text-center text-[var(--ps-text-dim)] py-4">
          No patterns defined yet.
          <br />
          <span className="text-[10px]">Use Define Pattern to capture.</span>
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {patterns.map((pattern) => (
          <button
            key={pattern.id}
            className="w-10 h-10 border border-[var(--ps-divider)] hover:border-white rounded-sm overflow-hidden transition-colors"
            title={`${pattern.name} (${pattern.width}x${pattern.height}) - Click to fill`}
            aria-label={`Fill with pattern ${pattern.name}`}
            onClick={() => fillWithPattern(pattern)}
          >
            <img
              src={pattern.dataURL}
              alt={pattern.name}
              className="w-full h-full object-cover"
              style={{ imageRendering: "pixelated" }}
            />
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 border-t border-[var(--ps-divider)] pt-1.5">
        <span className="text-[10px] text-[var(--ps-text-dim)]" title={activeDoc ? `Document patterns for ${activeDoc.name}` : "Global patterns"}>
          {activeDoc ? "Document" : "Global"}
        </span>
        <button
          className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm disabled:opacity-50"
          title="Define Pattern from active layer"
          aria-label="Define pattern from active layer"
          disabled={!activeDoc || !activeLayer}
          onClick={definePattern}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm disabled:opacity-50"
          title="Delete last pattern"
          aria-label="Delete last pattern"
          disabled={!patterns.length}
          onClick={() => patterns.length > 0 && deletePattern(patterns[patterns.length - 1].id)}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <div className="flex-1" />
        <button
          className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm disabled:opacity-50"
          title="Export patterns"
          aria-label="Export patterns"
          disabled={!patterns.length}
          onClick={exportPatterns}
        >
          <Download className="w-3.5 h-3.5" />
        </button>
        <button
          className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm"
          title="Import patterns"
          aria-label="Import patterns"
          onClick={() => importRef.current?.click()}
        >
          <Upload className="w-3.5 h-3.5" />
        </button>
        <button
          className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm"
          title="Reset patterns"
          aria-label="Reset patterns"
          onClick={() => save([])}
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
