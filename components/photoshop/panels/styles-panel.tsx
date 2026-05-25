"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  ChevronDown,
  ChevronRight,
  Download,
  FolderPlus,
  Pencil,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEditor } from "../editor-context"
import { downloadText } from "../document-io"
import { uid } from "../uid"
import type { LayerStyle, PsDocument } from "../types"

type StylePreset = NonNullable<PsDocument["stylePresets"]>[number] & {
  group?: string
  createdAt?: number
}

const STYLE_BUNDLE_FORMAT = "ps-style-bundle"
const STYLE_BUNDLE_VERSION = 1

interface StyleBundle {
  app: "Photoshop Web"
  format: typeof STYLE_BUNDLE_FORMAT
  version: number
  name: string
  exportedAt: string
  styleCount: number
  groups: string[]
  styles: StylePreset[]
}

function describeStyle(style: LayerStyle): string {
  const parts: string[] = []
  if (style.stroke?.enabled) parts.push(`stroke ${style.stroke.size}px`)
  if (style.dropShadow?.enabled) parts.push("drop shadow")
  if (style.innerShadow?.enabled) parts.push("inner shadow")
  if (style.outerGlow?.enabled) parts.push("outer glow")
  if (style.innerGlow?.enabled) parts.push("inner glow")
  if (style.bevel?.enabled) parts.push(`bevel ${style.bevel.style}`)
  if (style.satin?.enabled) parts.push("satin")
  if (style.colorOverlay?.enabled) parts.push("color overlay")
  if (style.gradientOverlay?.enabled) parts.push("gradient overlay")
  if (style.patternOverlay?.enabled) parts.push("pattern overlay")
  if (!parts.length) return "No effects"
  return parts.join(" · ")
}

function stylePreview(style: LayerStyle): React.CSSProperties {
  const css: React.CSSProperties = {
    backgroundImage: "linear-gradient(135deg, var(--ps-panel) 0%, var(--ps-panel-2) 100%)",
  }
  const shadows: string[] = []
  if (style.dropShadow?.enabled) {
    const s = style.dropShadow
    shadows.push(`${s.offsetX}px ${s.offsetY}px ${Math.max(2, s.size)}px ${withAlpha(s.color, s.opacity)}`)
  }
  if (style.innerShadow?.enabled) {
    const s = style.innerShadow
    shadows.push(`inset ${s.offsetX}px ${s.offsetY}px ${Math.max(2, s.size)}px ${withAlpha(s.color, s.opacity)}`)
  }
  if (style.outerGlow?.enabled) {
    shadows.push(`0 0 ${Math.max(4, style.outerGlow.size)}px ${withAlpha(style.outerGlow.color, style.outerGlow.opacity)}`)
  }
  if (style.innerGlow?.enabled) {
    shadows.push(`inset 0 0 ${Math.max(4, style.innerGlow.size)}px ${withAlpha(style.innerGlow.color, style.innerGlow.opacity)}`)
  }
  if (shadows.length) css.boxShadow = shadows.join(", ")
  if (style.colorOverlay?.enabled) {
    css.backgroundColor = withAlpha(style.colorOverlay.color, style.colorOverlay.opacity)
  }
  if (style.stroke?.enabled) {
    css.outline = `${Math.max(1, style.stroke.size)}px solid ${withAlpha(style.stroke.color, style.stroke.opacity ?? 1)}`
    css.outlineOffset = "-1px"
  }
  return css
}

function withAlpha(hex: string, opacity: number) {
  if (!opacity && opacity !== 0) return hex
  const clamped = Math.max(0, Math.min(1, opacity > 1 ? opacity / 100 : opacity))
  const alpha = Math.round(clamped * 255).toString(16).padStart(2, "0")
  if (hex.length === 7) return `${hex}${alpha}`
  if (hex.length === 4) {
    const expanded = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    return `${expanded}${alpha}`
  }
  return hex
}

function asStylePresets(value: unknown): StylePreset[] {
  if (!value) return []
  const list = Array.isArray(value) ? value : Array.isArray((value as { styles?: unknown[] }).styles) ? (value as { styles: unknown[] }).styles : []
  const out: StylePreset[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue
    const record = raw as Partial<StylePreset> & { style?: unknown }
    if (!record.style || typeof record.style !== "object") continue
    out.push({
      id: typeof record.id === "string" && record.id ? record.id : uid("style"),
      name: typeof record.name === "string" && record.name.trim() ? record.name.trim().slice(0, 80) : "Style",
      style: record.style as LayerStyle,
      group: typeof record.group === "string" && record.group.trim() ? record.group.trim().slice(0, 80) : "Custom",
      createdAt: typeof record.createdAt === "number" && Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
    })
  }
  return out
}

export function StylesPanel() {
  const { activeDoc, activeLayer, dispatch, commit } = useEditor()
  const [query, setQuery] = React.useState("")
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})
  const [renamingId, setRenamingId] = React.useState<string | null>(null)
  const [renameDraft, setRenameDraft] = React.useState("")
  const [dragId, setDragId] = React.useState<string | null>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  if (!activeDoc) {
    return <div className="px-4 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">No document open.</div>
  }

  const presets = React.useMemo(
    () => (activeDoc.stylePresets ?? []) as StylePreset[],
    [activeDoc.stylePresets],
  )
  const groups = React.useMemo(() => {
    const set = new Set<string>()
    for (const preset of presets) set.add(preset.group ?? "Custom")
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [presets])

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return presets
    return presets.filter((preset) => `${preset.name} ${preset.group ?? ""} ${describeStyle(preset.style)}`.toLowerCase().includes(q))
  }, [presets, query])

  const grouped = React.useMemo(() => {
    const buckets = new Map<string, StylePreset[]>()
    for (const preset of visible) {
      const group = preset.group ?? "Custom"
      const bucket = buckets.get(group) ?? []
      bucket.push(preset)
      buckets.set(group, bucket)
    }
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [visible])

  const setPresets = (next: StylePreset[], label: string) => {
    dispatch({ type: "set-style-presets", presets: next as NonNullable<PsDocument["stylePresets"]> })
    window.setTimeout(() => commit(label, []), 0)
  }

  const saveActiveStyle = () => {
    if (!activeLayer?.style) {
      toast.error("Select a layer with an active style.")
      return
    }
    const next: StylePreset = {
      id: uid("style"),
      name: `${activeLayer.name} FX`,
      group: "Custom",
      style: activeLayer.style,
      createdAt: Date.now(),
    }
    setPresets([next, ...presets], "Save Style Preset")
    toast.success(`Saved “${next.name}”.`)
  }

  const applyStyle = (preset: StylePreset) => {
    if (!activeLayer) {
      toast.error("Select a layer to apply this style.")
      return
    }
    dispatch({ type: "set-layer-style", id: activeLayer.id, style: preset.style })
    window.setTimeout(() => commit("Apply Style Preset", [activeLayer.id]), 0)
  }

  const renameStyle = (preset: StylePreset, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setPresets(presets.map((entry) => entry.id === preset.id ? { ...entry, name: trimmed.slice(0, 80) } : entry), "Rename Style Preset")
  }

  const moveToGroup = (preset: StylePreset, group: string) => {
    const trimmed = group.trim().slice(0, 80) || "Custom"
    setPresets(presets.map((entry) => entry.id === preset.id ? { ...entry, group: trimmed } : entry), "Move Style Preset")
  }

  const removeStyle = (preset: StylePreset) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete style “${preset.name}”?`)) return
    setPresets(presets.filter((entry) => entry.id !== preset.id), "Delete Style Preset")
  }

  const reorderInto = (sourceId: string, targetId: string | null, group: string) => {
    if (!sourceId) return
    const fromIndex = presets.findIndex((entry) => entry.id === sourceId)
    if (fromIndex < 0) return
    const source = { ...presets[fromIndex], group }
    const remaining = presets.filter((entry) => entry.id !== sourceId)
    let insertAt = remaining.length
    if (targetId) {
      const targetIndex = remaining.findIndex((entry) => entry.id === targetId)
      if (targetIndex >= 0) insertAt = targetIndex
    }
    const next = [...remaining.slice(0, insertAt), source, ...remaining.slice(insertAt)]
    setPresets(next, "Reorder Style Preset")
  }

  const newGroup = () => {
    if (typeof window === "undefined") return
    const name = window.prompt("New style folder name")
    if (!name?.trim()) return
    const trimmed = name.trim().slice(0, 80)
    if (groups.includes(trimmed)) {
      toast.error("Folder already exists.")
      return
    }
    setCollapsed((current) => ({ ...current, [trimmed]: false }))
    if (!activeLayer?.style) {
      toast.success(`Folder “${trimmed}” ready. Save a layer's style into it.`)
      return
    }
    const next: StylePreset = {
      id: uid("style"),
      name: `${trimmed} Style`,
      group: trimmed,
      style: activeLayer.style,
      createdAt: Date.now(),
    }
    setPresets([next, ...presets], "Add Style Group")
  }

  const exportBundle = () => {
    if (!presets.length) {
      toast.error("No style presets to export.")
      return
    }
    const bundle: StyleBundle = {
      app: "Photoshop Web",
      format: STYLE_BUNDLE_FORMAT,
      version: STYLE_BUNDLE_VERSION,
      name: `${activeDoc.name} Styles`,
      exportedAt: new Date().toISOString(),
      styleCount: presets.length,
      groups: [...new Set(presets.map((preset) => preset.group ?? "Custom"))].sort((a, b) => a.localeCompare(b)),
      styles: presets,
    }
    downloadText(JSON.stringify(bundle, null, 2), `${activeDoc.name}-styles.psstyles.json`)
  }

  const importBundle = async (file: File) => {
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const incoming = asStylePresets(parsed)
      if (!incoming.length) {
        toast.error("No styles found in that bundle.")
        return
      }
      setPresets([...incoming, ...presets], "Import Styles")
      toast.success(`Imported ${incoming.length} style${incoming.length === 1 ? "" : "s"}.`)
    } catch (err) {
      toast.error(`Could not import: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="space-y-2 border-b border-[var(--ps-divider)] p-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
          <Sparkles className="h-3 w-3" /> Styles ({presets.length})
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ps-text-dim)]" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search styles"
            className="h-7 bg-[var(--ps-panel-2)] pl-7 text-[11px]"
          />
        </div>
        <div className="grid grid-cols-2 gap-1">
          <Button size="sm" variant="ghost" disabled={!activeLayer?.style} onClick={saveActiveStyle} className="h-7 justify-start gap-1 text-[11px]">
            <Save className="h-3 w-3" /> Save Active
          </Button>
          <Button size="sm" variant="ghost" onClick={newGroup} className="h-7 justify-start gap-1 text-[11px]">
            <FolderPlus className="h-3 w-3" /> New Folder
          </Button>
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} className="h-7 justify-start gap-1 text-[11px]">
            <Upload className="h-3 w-3" /> Import
          </Button>
          <Button size="sm" variant="ghost" disabled={!presets.length} onClick={exportBundle} className="h-7 justify-start gap-1 text-[11px]">
            <Download className="h-3 w-3" /> Export
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.psstyles,.psstyles.json,application/json"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            if (file) await importBundle(file)
            event.target.value = ""
          }}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {grouped.length ? grouped.map(([group, items]) => {
          const isCollapsed = collapsed[group]
          return (
            <section
              key={group}
              className="mb-2"
              onDragOver={(event) => {
                if (dragId) event.preventDefault()
              }}
              onDrop={(event) => {
                if (!dragId) return
                event.preventDefault()
                reorderInto(dragId, null, group)
                setDragId(null)
              }}
            >
              <button
                type="button"
                onClick={() => setCollapsed((current) => ({ ...current, [group]: !current[group] }))}
                className="mb-1 flex w-full items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)] hover:text-[var(--ps-text)]"
              >
                {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {group} ({items.length})
              </button>
              {!isCollapsed ? (
                <div className="grid grid-cols-2 gap-1">
                  {items.map((preset) => (
                    <div
                      key={preset.id}
                      draggable
                      onDragStart={(event) => {
                        setDragId(preset.id)
                        event.dataTransfer.effectAllowed = "move"
                        event.dataTransfer.setData("text/plain", preset.id)
                      }}
                      onDragEnd={() => setDragId(null)}
                      onDragOver={(event) => { if (dragId && dragId !== preset.id) event.preventDefault() }}
                      onDrop={(event) => {
                        if (!dragId || dragId === preset.id) return
                        event.preventDefault()
                        reorderInto(dragId, preset.id, preset.group ?? group)
                        setDragId(null)
                      }}
                      className="group rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-1"
                    >
                      <button
                        type="button"
                        onClick={() => applyStyle(preset)}
                        onDoubleClick={() => applyStyle(preset)}
                        className="block w-full"
                        title={describeStyle(preset.style)}
                      >
                        <div
                          className="h-12 w-full rounded-sm border border-[var(--ps-divider)]"
                          style={stylePreview(preset.style)}
                        />
                      </button>
                      {renamingId === preset.id ? (
                        <Input
                          autoFocus
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onBlur={() => {
                            renameStyle(preset, renameDraft)
                            setRenamingId(null)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              renameStyle(preset, renameDraft)
                              setRenamingId(null)
                            } else if (event.key === "Escape") {
                              setRenamingId(null)
                            }
                          }}
                          className="mt-1 h-6 bg-[var(--ps-panel)] text-[10px]"
                          aria-label="Rename style"
                        />
                      ) : (
                        <div className="mt-1 truncate text-[10px]" title={preset.name}>{preset.name}</div>
                      )}
                      <div className="mt-0.5 flex items-center justify-between gap-1 text-[10px] text-[var(--ps-text-dim)]">
                        <select
                          value={preset.group ?? "Custom"}
                          onChange={(event) => moveToGroup(preset, event.target.value)}
                          aria-label="Style folder"
                          className="h-5 w-full min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-1 text-[10px] outline-none"
                        >
                          {groups.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                          {!groups.includes(preset.group ?? "Custom") ? <option value={preset.group ?? "Custom"}>{preset.group ?? "Custom"}</option> : null}
                        </select>
                      </div>
                      <div className="mt-1 flex items-center justify-end gap-0.5 text-[10px] text-[var(--ps-text-dim)] opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1 text-[10px]"
                          aria-label={`Rename ${preset.name}`}
                          onClick={() => {
                            setRenamingId(preset.id)
                            setRenameDraft(preset.name)
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1 text-[10px] text-red-300"
                          aria-label={`Delete ${preset.name}`}
                          onClick={() => removeStyle(preset)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          )
        }) : (
          <div className="rounded-sm border border-dashed border-[var(--ps-divider)] p-4 text-center text-[var(--ps-text-dim)]">
            {presets.length === 0
              ? "No styles yet. Apply a Layer Style to a layer, then click Save Active."
              : "No styles match the current search."}
          </div>
        )}
      </div>
      <div className="border-t border-[var(--ps-divider)] p-2 text-[10px] text-[var(--ps-text-dim)]">
        {activeLayer?.style ? (
          <span className="inline-flex items-center gap-1">
            <Plus className="h-3 w-3" /> Active layer has effects: {describeStyle(activeLayer.style)}
          </span>
        ) : (
          <span>Select a layer to preview or save its style.</span>
        )}
      </div>
    </div>
  )
}
