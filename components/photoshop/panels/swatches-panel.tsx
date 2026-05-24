"use client"

import * as React from "react"
import { useEditor } from "../editor-context"
import { Plus, Trash2, Download, Upload, RotateCcw, X } from "lucide-react"
import { downloadText } from "../document-io"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"

interface SwatchEntry {
  color: string
  name?: string
  group?: string
}

const DEFAULT_GROUP = "Default"

const DEFAULT_SWATCH_HEXES = [
  "#000000","#1a1a1a","#333333","#4d4d4d","#666666","#808080","#999999","#b3b3b3","#cccccc","#e6e6e6","#ffffff",
  "#ff0000","#ff3300","#ff6600","#ff9900","#ffcc00","#ffff00","#ccff00","#99ff00","#66ff00","#33ff00","#00ff00",
  "#00ff33","#00ff66","#00ff99","#00ffcc","#00ffff","#00ccff","#0099ff","#0066ff","#0033ff","#0000ff",
  "#3300ff","#6600ff","#9900ff","#cc00ff","#ff00ff","#ff00cc","#ff0099","#ff0066","#ff0033",
  "#800000","#804000","#808000","#408000","#008000","#008040","#008080","#004080","#000080","#400080","#800080",
  "#ffcccc","#ffe0cc","#ffffcc","#e0ffcc","#ccffcc","#ccffe0","#ccffff","#cce0ff","#ccccff","#e0ccff","#ffccff",
]

const DEFAULT_SWATCHES: SwatchEntry[] = DEFAULT_SWATCH_HEXES.map((color) => ({ color, group: DEFAULT_GROUP }))

const STORAGE_KEY = "ps-swatches"
const HEX_COLOR = /^#[0-9a-f]{6}$/i
const MAX_SWATCHES = 256
const MAX_NAME_LENGTH = 40
const MAX_GROUP_LENGTH = 40

function scopedStorageKey(docId: string | undefined) {
  return docId ? `${STORAGE_KEY}:${docId}` : STORAGE_KEY
}

function normalizeSwatches(value: unknown): SwatchEntry[] {
  const source =
    value && typeof value === "object" && !Array.isArray(value) && "swatches" in value
      ? (value as { swatches?: unknown }).swatches
      : value
  if (!Array.isArray(source)) return DEFAULT_SWATCHES
  const seen = new Set<string>()
  const out: SwatchEntry[] = []
  for (const item of source) {
    let color: string | null = null
    let name: string | undefined
    let group: string | undefined
    if (typeof item === "string") {
      if (HEX_COLOR.test(item)) color = item.toLowerCase()
    } else if (item && typeof item === "object") {
      const candidate = item as Partial<SwatchEntry>
      if (typeof candidate.color === "string" && HEX_COLOR.test(candidate.color)) {
        color = candidate.color.toLowerCase()
      }
      if (typeof candidate.name === "string") name = candidate.name.trim().slice(0, MAX_NAME_LENGTH) || undefined
      if (typeof candidate.group === "string") group = candidate.group.trim().slice(0, MAX_GROUP_LENGTH) || undefined
    }
    if (!color) continue
    const key = `${color}|${name ?? ""}|${group ?? DEFAULT_GROUP}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ color, name, group: group ?? DEFAULT_GROUP })
    if (out.length >= MAX_SWATCHES) break
  }
  return out.length ? out : DEFAULT_SWATCHES
}

function loadSwatches(docId?: string): SwatchEntry[] {
  if (typeof window === "undefined") return DEFAULT_SWATCHES
  try {
    const scoped = docId ? localStorage.getItem(scopedStorageKey(docId)) : null
    const saved = scoped ?? localStorage.getItem(STORAGE_KEY)
    return saved ? normalizeSwatches(JSON.parse(saved)) : DEFAULT_SWATCHES
  } catch { return DEFAULT_SWATCHES }
}

function describeSwatch(entry: SwatchEntry): string {
  return entry.name ? `${entry.name} (${entry.color})` : entry.color
}

export function SwatchesPanel() {
  const { activeDoc, foreground, dispatch } = useEditor()
  const storageKey = scopedStorageKey(activeDoc?.id)
  const [swatches, setSwatches] = React.useState<SwatchEntry[]>(() => loadSwatches(activeDoc?.id))
  const [query, setQuery] = React.useState("")
  const [activeGroup, setActiveGroup] = React.useState<string>("All")
  const [sort, setSort] = React.useState<"group" | "name" | "color">("group")
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null)
  const [draftName, setDraftName] = React.useState("")
  const importRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    setSwatches(loadSwatches(activeDoc?.id))
    setEditingIndex(null)
    setActiveGroup("All")
  }, [activeDoc?.id])

  const save = React.useCallback((s: SwatchEntry[]) => {
    const next = normalizeSwatches(s)
    setSwatches(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* ignore quota */ }
  }, [storageKey])

  const groups = React.useMemo(() => {
    const set = new Set<string>()
    for (const swatch of swatches) set.add(swatch.group ?? DEFAULT_GROUP)
    return Array.from(set)
  }, [swatches])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return swatches
      .map((swatch, index) => ({ swatch, index }))
      .filter(({ swatch }) => {
        if (activeGroup !== "All" && (swatch.group ?? DEFAULT_GROUP) !== activeGroup) return false
        if (!q) return true
        return (
          swatch.color.toLowerCase().includes(q) ||
          (swatch.name?.toLowerCase().includes(q) ?? false) ||
          (swatch.group?.toLowerCase().includes(q) ?? false)
        )
      })
      .sort((a, b) => {
        if (sort === "name") return describeSwatch(a.swatch).localeCompare(describeSwatch(b.swatch))
        if (sort === "color") return a.swatch.color.localeCompare(b.swatch.color)
        return (a.swatch.group ?? DEFAULT_GROUP).localeCompare(b.swatch.group ?? DEFAULT_GROUP) || describeSwatch(a.swatch).localeCompare(describeSwatch(b.swatch))
      })
  }, [swatches, query, activeGroup, sort])

  const addSwatch = () => {
    const newEntry: SwatchEntry = {
      color: foreground,
      group: activeGroup !== "All" ? activeGroup : DEFAULT_GROUP,
    }
    save([...swatches, newEntry])
  }

  const removeSwatch = (idx: number) => save(swatches.filter((_, i) => i !== idx))

  const renameSwatch = (idx: number, name: string) => {
    const trimmed = name.trim().slice(0, MAX_NAME_LENGTH)
    const next = swatches.map((swatch, i) => (i === idx ? { ...swatch, name: trimmed || undefined } : swatch))
    save(next)
  }

  const exportSwatches = () => {
    downloadText(
      JSON.stringify(
        {
          app: "Photoshop Web",
          format: "ps-swatches",
          version: 2,
          swatches,
        },
        null,
        2,
      ),
      "photoshop-swatches.psswatches.json",
    )
  }

  const importSwatches = async (file: File) => {
    try {
      if (file.size > 256 * 1024) throw new Error("Swatch files are limited to 256 KB.")
      const next = normalizeSwatches(JSON.parse(await file.text()))
      save([...swatches, ...next])
      toast.success(`Imported ${next.length} swatch${next.length === 1 ? "" : "es"}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import swatches")
    } finally {
      if (importRef.current) importRef.current.value = ""
    }
  }

  const commitRename = () => {
    if (editingIndex === null) return
    renameSwatch(editingIndex, draftName)
    setEditingIndex(null)
  }

  return (
    <div className="p-2 text-[11px] text-[var(--ps-text)] space-y-2">
      <input
        ref={importRef}
        type="file"
        accept=".json,.psswatches,.psswatches.json,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file) void importSwatches(file)
        }}
      />
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by hex, name, or group"
        className="h-7 text-[11px]"
        aria-label="Search swatches"
      />
      {groups.length > 1 && (
        <div className="flex flex-wrap gap-0.5 text-[10px]">
          <button
            className={`px-1.5 py-0.5 rounded-sm border ${activeGroup === "All" ? "border-[var(--ps-accent)] bg-[var(--ps-tool-active)]" : "border-[var(--ps-divider)] hover:border-white"}`}
            onClick={() => setActiveGroup("All")}
          >
            All
          </button>
          {groups.map((group) => (
            <button
              key={group}
              className={`px-1.5 py-0.5 rounded-sm border ${activeGroup === group ? "border-[var(--ps-accent)] bg-[var(--ps-tool-active)]" : "border-[var(--ps-divider)] hover:border-white"}`}
              onClick={() => setActiveGroup(group)}
            >
              {group}
            </button>
          ))}
        </div>
      )}
      <select
        value={sort}
        onChange={(event) => setSort(event.target.value as typeof sort)}
        className="h-7 w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
        aria-label="Swatch sort"
      >
        <option value="group">Group</option>
        <option value="name">Name</option>
        <option value="color">Color</option>
      </select>
      <div className="flex flex-wrap gap-[2px]">
        {filtered.map(({ swatch, index }) => {
          const editing = editingIndex === index
          return (
            <div key={`${swatch.color}-${index}`} className="relative group">
              <button
                className="w-[16px] h-[16px] border border-[var(--ps-divider)] hover:border-white transition-colors rounded-[1px]"
                style={{ backgroundColor: swatch.color }}
                title={describeSwatch(swatch)}
                aria-label={`Set foreground to ${describeSwatch(swatch)}`}
                onClick={() => dispatch({ type: "set-foreground", color: swatch.color })}
                onContextMenu={(event) => {
                  event.preventDefault()
                  dispatch({ type: "set-background", color: swatch.color })
                }}
                onDoubleClick={(event) => {
                  event.preventDefault()
                  setEditingIndex(index)
                  setDraftName(swatch.name ?? "")
                }}
              />
              <button
                type="button"
                className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center w-3 h-3 rounded-full bg-[var(--ps-panel)] border border-[var(--ps-divider)] text-[var(--ps-text-dim)] hover:text-red-400"
                title={`Delete ${describeSwatch(swatch)}`}
                aria-label={`Delete ${describeSwatch(swatch)}`}
                onClick={(event) => {
                  event.stopPropagation()
                  removeSwatch(index)
                }}
              >
                <X className="w-2 h-2" />
              </button>
              {editing && (
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
                      setEditingIndex(null)
                    }
                  }}
                  placeholder="Name"
                  className="absolute left-[18px] top-0 z-10 w-32 bg-[var(--ps-panel)] text-[10px] px-1 py-0.5 outline-none border border-[var(--ps-accent)]"
                  aria-label={`Rename swatch ${swatch.color}`}
                />
              )}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div className="text-[10px] text-[var(--ps-text-dim)] py-1">No swatches match.</div>
        )}
      </div>
      <div className="flex items-center gap-1 border-t border-[var(--ps-divider)] pt-1.5">
        <span className="text-[10px] text-[var(--ps-text-dim)]" title={activeDoc ? `Document swatches for ${activeDoc.name}` : "Global swatches"}>
          {activeDoc ? "Document" : "Global"} - {swatches.length}
        </span>
        <button className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm" title="Add current foreground color" aria-label="Add current foreground color" onClick={addSwatch}>
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm"
          title="Remove last swatch"
          aria-label="Remove last swatch"
          onClick={() => swatches.length > 0 && removeSwatch(swatches.length - 1)}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <div className="flex-1" />
        <button className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm" title="Export swatches" aria-label="Export swatches" onClick={exportSwatches}>
          <Download className="w-3.5 h-3.5" />
        </button>
        <button className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm" title="Import swatches" aria-label="Import swatches" onClick={() => importRef.current?.click()}>
          <Upload className="w-3.5 h-3.5" />
        </button>
        <button className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm" title="Reset to defaults" aria-label="Reset swatches to defaults" onClick={() => save(DEFAULT_SWATCHES)}>
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
