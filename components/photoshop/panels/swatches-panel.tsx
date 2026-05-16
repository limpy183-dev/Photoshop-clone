"use client"

import * as React from "react"
import { useEditor } from "../editor-context"
import { Plus, Trash2, Download, Upload, RotateCcw } from "lucide-react"
import { downloadText } from "../document-io"
import { toast } from "sonner"

const DEFAULT_SWATCHES = [
  "#000000","#1a1a1a","#333333","#4d4d4d","#666666","#808080","#999999","#b3b3b3","#cccccc","#e6e6e6","#ffffff",
  "#ff0000","#ff3300","#ff6600","#ff9900","#ffcc00","#ffff00","#ccff00","#99ff00","#66ff00","#33ff00","#00ff00",
  "#00ff33","#00ff66","#00ff99","#00ffcc","#00ffff","#00ccff","#0099ff","#0066ff","#0033ff","#0000ff",
  "#3300ff","#6600ff","#9900ff","#cc00ff","#ff00ff","#ff00cc","#ff0099","#ff0066","#ff0033",
  "#800000","#804000","#808000","#408000","#008000","#008040","#008080","#004080","#000080","#400080","#800080",
  "#ffcccc","#ffe0cc","#ffffcc","#e0ffcc","#ccffcc","#ccffe0","#ccffff","#cce0ff","#ccccff","#e0ccff","#ffccff",
]

const STORAGE_KEY = "ps-swatches"
const HEX_COLOR = /^#[0-9a-f]{6}$/i
const MAX_SWATCHES = 256

function scopedStorageKey(docId: string | undefined) {
  return docId ? `${STORAGE_KEY}:${docId}` : STORAGE_KEY
}

function normalizeSwatches(value: unknown): string[] {
  const source =
    value && typeof value === "object" && !Array.isArray(value) && "swatches" in value
      ? (value as { swatches?: unknown }).swatches
      : value
  if (!Array.isArray(source)) return DEFAULT_SWATCHES
  const unique: string[] = []
  for (const item of source) {
    if (typeof item !== "string" || !HEX_COLOR.test(item)) continue
    const color = item.toLowerCase()
    if (!unique.includes(color)) unique.push(color)
    if (unique.length >= MAX_SWATCHES) break
  }
  return unique.length ? unique : DEFAULT_SWATCHES
}

function loadSwatches(docId?: string): string[] {
  if (typeof window === "undefined") return DEFAULT_SWATCHES
  try {
    const scoped = docId ? localStorage.getItem(scopedStorageKey(docId)) : null
    const saved = scoped ?? localStorage.getItem(STORAGE_KEY)
    return saved ? normalizeSwatches(JSON.parse(saved)) : DEFAULT_SWATCHES
  } catch { return DEFAULT_SWATCHES }
}

export function SwatchesPanel() {
  const { activeDoc, foreground, dispatch } = useEditor()
  const storageKey = scopedStorageKey(activeDoc?.id)
  const [swatches, setSwatches] = React.useState<string[]>(() => loadSwatches(activeDoc?.id))
  const importRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    setSwatches(loadSwatches(activeDoc?.id))
  }, [activeDoc?.id])

  const save = (s: string[]) => {
    const next = normalizeSwatches(s)
    setSwatches(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch {}
  }

  const addSwatch = () => save([...swatches, foreground])
  const removeSwatch = (idx: number) => save(swatches.filter((_, i) => i !== idx))
  const exportSwatches = () => {
    downloadText(
      JSON.stringify(
        {
          app: "Photoshop Web",
          format: "ps-swatches",
          version: 1,
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
      save(next)
      toast.success(`Imported ${next.length} swatch${next.length === 1 ? "" : "es"}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import swatches")
    } finally {
      if (importRef.current) importRef.current.value = ""
    }
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
      <div className="flex flex-wrap gap-[2px]">
        {swatches.map((c, i) => (
          <button
            key={i}
            className="w-[14px] h-[14px] border border-[var(--ps-divider)] hover:border-white transition-colors rounded-[1px]"
            style={{ backgroundColor: c }}
            title={c}
            aria-label={`Set foreground to ${c}`}
            onClick={() => dispatch({ type: "set-foreground", color: c })}
            onContextMenu={(e) => { e.preventDefault(); dispatch({ type: "set-background", color: c }) }}
          />
        ))}
      </div>
      <div className="flex items-center gap-1 border-t border-[var(--ps-divider)] pt-1.5">
        <span className="text-[10px] text-[var(--ps-text-dim)]" title={activeDoc ? `Document swatches for ${activeDoc.name}` : "Global swatches"}>
          {activeDoc ? "Document" : "Global"}
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
