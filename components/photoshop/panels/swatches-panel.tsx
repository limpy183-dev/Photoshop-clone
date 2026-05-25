"use client"

import * as React from "react"
import { useEditor } from "../editor-context"
import { BookOpen, Plus, Trash2, Download, Upload, RotateCcw, X } from "lucide-react"
import { downloadText } from "../document-io"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import {
  DEFAULT_SWATCHES,
  DEFAULT_SWATCH_GROUP,
  MAX_SWATCH_NAME_LENGTH,
  SWATCHES_UPDATED_EVENT,
  describeSwatch,
  loadSwatches,
  normalizeSwatches,
  saveSwatches,
  type SwatchEntry,
} from "../swatches-store"

const RECENT_SWATCHES_KEY = "ps-recent-swatches"
const MAX_RECENT_SWATCHES = 12

export interface LocalColorBook {
  id: string
  name: string
  swatches: SwatchEntry[]
}

export const LOCAL_COLOR_BOOKS: LocalColorBook[] = [
  {
    id: "process-coated",
    name: "Process Coated",
    swatches: [
      { color: "#0057b8", name: "Process Blue", group: "Process Coated" },
      { color: "#00a3e0", name: "Cyan Lake", group: "Process Coated" },
      { color: "#009b77", name: "Green C", group: "Process Coated" },
      { color: "#f2a900", name: "Golden Yellow", group: "Process Coated" },
      { color: "#ff8200", name: "Orange C", group: "Process Coated" },
      { color: "#e4002b", name: "Red C", group: "Process Coated" },
      { color: "#a51890", name: "Purple C", group: "Process Coated" },
      { color: "#2d2926", name: "Black C", group: "Process Coated" },
    ],
  },
  {
    id: "web-safe",
    name: "Web Safe",
    swatches: [
      { color: "#000000", name: "Black", group: "Web Safe" },
      { color: "#333333", name: "Graphite", group: "Web Safe" },
      { color: "#666666", name: "Gray", group: "Web Safe" },
      { color: "#ffffff", name: "White", group: "Web Safe" },
      { color: "#ff0000", name: "Red", group: "Web Safe" },
      { color: "#00ff00", name: "Green", group: "Web Safe" },
      { color: "#0000ff", name: "Blue", group: "Web Safe" },
      { color: "#ffff00", name: "Yellow", group: "Web Safe" },
    ],
  },
]

export function mergeRecentSwatch(recent: readonly SwatchEntry[], swatch: SwatchEntry): SwatchEntry[] {
  const key = `${swatch.color.toLowerCase()}|${swatch.name ?? ""}|${swatch.group ?? DEFAULT_SWATCH_GROUP}`
  const next = [
    { ...swatch, group: swatch.group ?? DEFAULT_SWATCH_GROUP },
    ...recent.filter((entry) => `${entry.color.toLowerCase()}|${entry.name ?? ""}|${entry.group ?? DEFAULT_SWATCH_GROUP}` !== key),
  ]
  return next.slice(0, MAX_RECENT_SWATCHES)
}

function loadRecentSwatches(): SwatchEntry[] {
  if (typeof window === "undefined") return []
  try {
    return normalizeSwatches(JSON.parse(localStorage.getItem(RECENT_SWATCHES_KEY) ?? "[]")).slice(0, MAX_RECENT_SWATCHES)
  } catch {
    return []
  }
}

function saveRecentSwatches(swatches: SwatchEntry[]) {
  try {
    localStorage.setItem(RECENT_SWATCHES_KEY, JSON.stringify(swatches.slice(0, MAX_RECENT_SWATCHES)))
  } catch {}
}

export function SwatchesPanel() {
  const { activeDoc, foreground, dispatch } = useEditor()
  const [swatches, setSwatches] = React.useState<SwatchEntry[]>(() => loadSwatches(activeDoc?.id))
  const [query, setQuery] = React.useState("")
  const [activeGroup, setActiveGroup] = React.useState<string>("All")
  const [sort, setSort] = React.useState<"group" | "name" | "color">("group")
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null)
  const [draftName, setDraftName] = React.useState("")
  const [recentSwatches, setRecentSwatches] = React.useState<SwatchEntry[]>(loadRecentSwatches)
  const [colorBookId, setColorBookId] = React.useState(LOCAL_COLOR_BOOKS[0]?.id ?? "")
  const importRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    setSwatches(loadSwatches(activeDoc?.id))
    setEditingIndex(null)
    setActiveGroup("All")
  }, [activeDoc?.id])

  React.useEffect(() => {
    const reload = () => setSwatches(loadSwatches(activeDoc?.id))
    window.addEventListener(SWATCHES_UPDATED_EVENT, reload)
    return () => window.removeEventListener(SWATCHES_UPDATED_EVENT, reload)
  }, [activeDoc?.id])

  const save = React.useCallback((s: SwatchEntry[]) => {
    const next = saveSwatches(s, activeDoc?.id)
    setSwatches(next)
  }, [activeDoc?.id])

  const groups = React.useMemo(() => {
    const set = new Set<string>()
    for (const swatch of swatches) set.add(swatch.group ?? DEFAULT_SWATCH_GROUP)
    return Array.from(set)
  }, [swatches])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return swatches
      .map((swatch, index) => ({ swatch, index }))
      .filter(({ swatch }) => {
        if (activeGroup !== "All" && (swatch.group ?? DEFAULT_SWATCH_GROUP) !== activeGroup) return false
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
        return (a.swatch.group ?? DEFAULT_SWATCH_GROUP).localeCompare(b.swatch.group ?? DEFAULT_SWATCH_GROUP) || describeSwatch(a.swatch).localeCompare(describeSwatch(b.swatch))
      })
  }, [swatches, query, activeGroup, sort])

  const addSwatch = () => {
    const newEntry: SwatchEntry = {
      color: foreground,
      group: activeGroup !== "All" ? activeGroup : DEFAULT_SWATCH_GROUP,
    }
    save([...swatches, newEntry])
  }

  const remember = (swatch: SwatchEntry) => {
    const next = mergeRecentSwatch(recentSwatches, swatch)
    setRecentSwatches(next)
    saveRecentSwatches(next)
  }

  const applySwatch = (swatch: SwatchEntry, target: "foreground" | "background") => {
    dispatch({ type: target === "foreground" ? "set-foreground" : "set-background", color: swatch.color })
    remember(swatch)
  }

  const addColorBook = () => {
    const book = LOCAL_COLOR_BOOKS.find((candidate) => candidate.id === colorBookId)
    if (!book) return
    save([...swatches, ...book.swatches])
    toast.success(`Added ${book.name} color book.`)
  }

  const removeSwatch = (idx: number) => save(swatches.filter((_, i) => i !== idx))

  const renameSwatch = (idx: number, name: string) => {
    const trimmed = name.trim().slice(0, MAX_SWATCH_NAME_LENGTH)
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
      <div className="grid grid-cols-[1fr_auto] gap-1">
        <select
          value={colorBookId}
          onChange={(event) => setColorBookId(event.target.value)}
          className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          aria-label="Local color book"
        >
          {LOCAL_COLOR_BOOKS.map((book) => <option key={book.id} value={book.id}>{book.name}</option>)}
        </select>
        <button className="h-7 rounded-sm border border-[var(--ps-divider)] px-2 hover:bg-[var(--ps-tool-hover)]" onClick={addColorBook} aria-label="Add local color book">
          <BookOpen className="h-3.5 w-3.5" />
        </button>
      </div>
      {recentSwatches.length ? (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">Recently Used</div>
          <div className="flex flex-wrap gap-[2px]">
            {recentSwatches.map((swatch, index) => (
              <button
                key={`${swatch.color}-${index}`}
                className="h-[16px] w-[16px] rounded-[1px] border border-[var(--ps-divider)] transition-colors hover:border-white"
                style={{ backgroundColor: swatch.color }}
                title={describeSwatch(swatch)}
                aria-label={`Set foreground to recent ${describeSwatch(swatch)}`}
                onClick={() => applySwatch(swatch, "foreground")}
                onContextMenu={(event) => {
                  event.preventDefault()
                  applySwatch(swatch, "background")
                }}
              />
            ))}
          </div>
        </div>
      ) : null}
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
                onClick={() => applySwatch(swatch, "foreground")}
                onContextMenu={(event) => {
                  event.preventDefault()
                  applySwatch(swatch, "background")
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
