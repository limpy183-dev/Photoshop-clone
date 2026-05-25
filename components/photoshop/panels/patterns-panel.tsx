"use client"

import * as React from "react"
import { Download, Plus, RotateCcw, Trash2, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { downloadText } from "../document-io"
import { useEditor } from "../editor-context"
import { Input } from "@/components/ui/input"

interface PatternEntry {
  id: string
  name: string
  group?: string
  dataURL: string
  width: number
  height: number
  createdAt?: number
}

const STORAGE_KEY = "ps-patterns"
const DEFAULT_GROUP = "User"
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
      group: typeof candidate.group === "string" ? candidate.group.trim().slice(0, 48) || DEFAULT_GROUP : DEFAULT_GROUP,
      dataURL: candidate.dataURL,
      width: Math.max(1, Math.min(MAX_PATTERN_DIMENSION, Math.round(candidate.width))),
      height: Math.max(1, Math.min(MAX_PATTERN_DIMENSION, Math.round(candidate.height))),
      createdAt: Number.isFinite(Number(candidate.createdAt)) ? Number(candidate.createdAt) : Date.now(),
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
    window.dispatchEvent(new CustomEvent("ps-patterns-changed", { detail: { docId, patterns } }))
  } catch {
    toast.error("Pattern library is too large to save locally.")
  }
}

function mergePatterns(existing: readonly PatternEntry[], incoming: readonly PatternEntry[]) {
  const byId = new Map<string, PatternEntry>()
  for (const pattern of existing) byId.set(pattern.id, pattern)
  for (const pattern of incoming) byId.set(pattern.id, pattern)
  return [...byId.values()]
}

export function PatternsPanel() {
  const { activeDoc, activeLayer, commit, requestRender } = useEditor()
  const [patterns, setPatterns] = React.useState<PatternEntry[]>(() => loadPatterns(activeDoc?.id))
  const [query, setQuery] = React.useState("")
  const [group, setGroup] = React.useState(DEFAULT_GROUP)
  const [groupFilter, setGroupFilter] = React.useState("All")
  const [sort, setSort] = React.useState<"recent" | "name" | "size">("recent")
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [draftName, setDraftName] = React.useState("")
  const importRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    setPatterns(loadPatterns(activeDoc?.id))
    setEditingId(null)
    setGroupFilter("All")
  }, [activeDoc?.id])

  React.useEffect(() => {
    const syncPatterns = (event: Event) => {
      const detail = (event as CustomEvent<{ docId?: string; patterns?: unknown }>).detail
      if (detail?.docId && detail.docId !== activeDoc?.id) return
      setPatterns(normalizePatterns(detail?.patterns ?? loadPatterns(activeDoc?.id)))
    }
    window.addEventListener("ps-patterns-changed", syncPatterns)
    return () => window.removeEventListener("ps-patterns-changed", syncPatterns)
  }, [activeDoc?.id])

  const save = React.useCallback((value: PatternEntry[]) => {
    const next = normalizePatterns(value)
    setPatterns(next)
    persistPatterns(next, activeDoc?.id)
  }, [activeDoc?.id])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return patterns
      .filter((pattern) => groupFilter === "All" || (pattern.group ?? DEFAULT_GROUP) === groupFilter)
      .filter((pattern) => !q || `${pattern.name} ${pattern.group ?? ""}`.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name)
        if (sort === "size") return (a.width * a.height) - (b.width * b.height) || a.name.localeCompare(b.name)
        return (b.createdAt ?? 0) - (a.createdAt ?? 0)
      })
  }, [patterns, query, groupFilter, sort])

  const groups = React.useMemo(
    () => ["All", ...Array.from(new Set(patterns.map((pattern) => pattern.group ?? DEFAULT_GROUP))).sort()],
    [patterns],
  )

  const renamePattern = (id: string, name: string) => {
    const trimmed = name.trim().slice(0, 80)
    if (!trimmed) return
    save(patterns.map((pattern) => (pattern.id === id ? { ...pattern, name: trimmed } : pattern)))
  }

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
      group: group.trim() || DEFAULT_GROUP,
      dataURL,
      width,
      height,
      createdAt: Date.now(),
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
          exportedAt: new Date().toISOString(),
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
      save(mergePatterns(patterns, next))
      toast.success(`Imported ${next.length} pattern${next.length === 1 ? "" : "s"}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import patterns")
    } finally {
      if (importRef.current) importRef.current.value = ""
    }
  }

  const commitRename = () => {
    if (!editingId) return
    renamePattern(editingId, draftName)
    setEditingId(null)
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
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search patterns"
        className="h-7 text-[11px]"
        aria-label="Search patterns"
        disabled={!patterns.length}
      />
      <div className="grid grid-cols-2 gap-1">
        <select
          value={groupFilter}
          onChange={(event) => setGroupFilter(event.target.value)}
          className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          aria-label="Pattern group"
          disabled={!patterns.length}
        >
          {groups.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as typeof sort)}
          className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          aria-label="Pattern sort"
          disabled={!patterns.length}
        >
          <option value="recent">Recent</option>
          <option value="name">Name</option>
          <option value="size">Size</option>
        </select>
      </div>
      <Input
        value={group}
        onChange={(event) => setGroup(event.target.value)}
        placeholder="New pattern group"
        className="h-7 text-[11px]"
        aria-label="New pattern group"
      />
      {patterns.length === 0 && (
        <div className="text-center text-[var(--ps-text-dim)] py-4">
          No patterns defined yet.
          <br />
          <span className="text-[10px]">Use Define Pattern to capture.</span>
        </div>
      )}
      {patterns.length > 0 && filtered.length === 0 && (
        <div className="text-center text-[var(--ps-text-dim)] py-2 text-[10px]">No patterns match &ldquo;{query}&rdquo;.</div>
      )}
      <div className="grid grid-cols-4 gap-1">
        {filtered.map((pattern) => {
          const editing = editingId === pattern.id
          return (
            <div key={pattern.id} className="relative group">
              <button
                className="w-full aspect-square border border-[var(--ps-divider)] hover:border-white rounded-sm overflow-hidden transition-colors"
                title={`${pattern.name} (${pattern.width} x ${pattern.height}) - click to fill, double-click to rename`}
                aria-label={`Fill with pattern ${pattern.name}`}
                onClick={() => fillWithPattern(pattern)}
                onDoubleClick={(event) => {
                  event.preventDefault()
                  setEditingId(pattern.id)
                  setDraftName(pattern.name)
                }}
              >
                <img
                  src={pattern.dataURL}
                  alt={pattern.name}
                  className="w-full h-full object-cover"
                  style={{ imageRendering: "pixelated" }}
                />
              </button>
              <button
                type="button"
                className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full bg-[var(--ps-panel)] border border-[var(--ps-divider)] text-[var(--ps-text-dim)] hover:text-red-400"
                title={`Delete ${pattern.name}`}
                aria-label={`Delete ${pattern.name}`}
                onClick={(event) => {
                  event.stopPropagation()
                  deletePattern(pattern.id)
                }}
              >
                <X className="w-3 h-3" />
              </button>
              {editing ? (
                <input
                  autoFocus
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      ;(event.currentTarget as HTMLInputElement).blur()
                    } else if (event.key === "Escape") {
                      event.preventDefault()
                      setEditingId(null)
                    }
                  }}
                  className="absolute inset-x-0 bottom-0 w-full bg-[var(--ps-panel)]/90 text-[10px] px-1 outline-none border-t border-[var(--ps-accent)]"
                  aria-label={`Rename ${pattern.name}`}
                />
              ) : (
                <div className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-[9px] leading-tight text-white truncate bg-black/40 pointer-events-none">
                  {pattern.name}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-1 border-t border-[var(--ps-divider)] pt-1.5">
        <span className="text-[10px] text-[var(--ps-text-dim)]" title={activeDoc ? `Document patterns for ${activeDoc.name}` : "Global patterns"}>
          {activeDoc ? "Document" : "Global"} - {patterns.length}
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
