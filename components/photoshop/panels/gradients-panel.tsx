"use client"

import * as React from "react"
import { Copy, Download, Plus, RotateCcw, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { downloadText } from "../document-io"
import { useEditor } from "../editor-context"
import { Input } from "@/components/ui/input"
import { gradientStopsToEditorStops, mergeById, normalizeGradientPresets } from "../asset-libraries"

interface GradientStopPreset {
  pos: number
  color: string
}

interface GradientPreset {
  id: string
  name: string
  stops: GradientStopPreset[]
  category?: string
  createdAt?: number
}

const STORAGE_KEY = "ps-gradients"
const MAX_USER_GRADIENTS = 64
const MAX_STOPS = 16
const MAX_GRADIENT_FILE_BYTES = 256 * 1024
const HEX_OR_RGBA = /^(#[0-9a-f]{3,8}|rgba?\([^()]{1,80}\))$/i

function presetStops(preset: GradientPreset) {
  return gradientStopsToEditorStops(preset.stops)
}

const DEFAULT_GRADIENTS: GradientPreset[] = [
  { id: "fg-bg", name: "Foreground to Background", category: "Basics", stops: [{ pos: 0, color: "#000000" }, { pos: 1, color: "#ffffff" }] },
  { id: "fg-trans", name: "Foreground to Transparent", category: "Basics", stops: [{ pos: 0, color: "#000000" }, { pos: 1, color: "rgba(0,0,0,0)" }] },
  { id: "black-white", name: "Black & White", category: "Basics", stops: [{ pos: 0, color: "#000000" }, { pos: 1, color: "#ffffff" }] },
  { id: "red-orange", name: "Red to Orange", category: "Basics", stops: [{ pos: 0, color: "#ff0000" }, { pos: 1, color: "#ff9900" }] },
  { id: "sunset", name: "Sunset", category: "Atmospheric", stops: [{ pos: 0, color: "#ff4500" }, { pos: 0.5, color: "#ff8c00" }, { pos: 1, color: "#ffd700" }] },
  { id: "ocean", name: "Ocean", category: "Atmospheric", stops: [{ pos: 0, color: "#001f3f" }, { pos: 0.5, color: "#0074D9" }, { pos: 1, color: "#7FDBFF" }] },
  { id: "forest", name: "Forest", category: "Atmospheric", stops: [{ pos: 0, color: "#0d260d" }, { pos: 0.5, color: "#2ECC40" }, { pos: 1, color: "#a8e6cf" }] },
  { id: "fire", name: "Fire", category: "Atmospheric", stops: [{ pos: 0, color: "#1a0000" }, { pos: 0.3, color: "#cc0000" }, { pos: 0.6, color: "#ff6600" }, { pos: 1, color: "#ffff00" }] },
  { id: "cool", name: "Cool", category: "Basics", stops: [{ pos: 0, color: "#6600cc" }, { pos: 0.5, color: "#0066ff" }, { pos: 1, color: "#00ccff" }] },
  { id: "warm", name: "Warm", category: "Basics", stops: [{ pos: 0, color: "#cc3300" }, { pos: 0.5, color: "#ff6633" }, { pos: 1, color: "#ffcc66" }] },
  { id: "rainbow", name: "Rainbow", category: "Basics", stops: [
    { pos: 0, color: "#ff0000" }, { pos: 0.17, color: "#ff9900" }, { pos: 0.33, color: "#ffff00" },
    { pos: 0.5, color: "#00ff00" }, { pos: 0.67, color: "#0099ff" }, { pos: 0.83, color: "#6600cc" }, { pos: 1, color: "#cc00ff" },
  ]},
  { id: "chrome", name: "Chrome", category: "Metallic", stops: [
    { pos: 0, color: "#333333" }, { pos: 0.25, color: "#cccccc" }, { pos: 0.5, color: "#666666" },
    { pos: 0.75, color: "#eeeeee" }, { pos: 1, color: "#444444" },
  ]},
  { id: "pastel", name: "Pastel", category: "Basics", stops: [
    { pos: 0, color: "#ffcccc" }, { pos: 0.25, color: "#ffffcc" }, { pos: 0.5, color: "#ccffcc" },
    { pos: 0.75, color: "#ccccff" }, { pos: 1, color: "#ffccff" },
  ]},
  { id: "night-sky", name: "Night Sky", category: "Atmospheric", stops: [{ pos: 0, color: "#0a0a2e" }, { pos: 0.5, color: "#1a1a4e" }, { pos: 1, color: "#2d1b69" }] },
  { id: "copper", name: "Copper", category: "Metallic", stops: [{ pos: 0, color: "#2e1503" }, { pos: 0.5, color: "#b87333" }, { pos: 1, color: "#da9a5b" }] },
  { id: "gold", name: "Gold", category: "Metallic", stops: [
    { pos: 0, color: "#3d2b00" }, { pos: 0.3, color: "#ffd700" }, { pos: 0.6, color: "#fff7a0" }, { pos: 1, color: "#996f00" },
  ]},
  { id: "silver", name: "Silver", category: "Metallic", stops: [
    { pos: 0, color: "#535353" }, { pos: 0.4, color: "#e6e6e6" }, { pos: 0.7, color: "#a8a8a8" }, { pos: 1, color: "#525252" },
  ]},
]

function isValidStop(stop: unknown): stop is GradientStopPreset {
  if (!stop || typeof stop !== "object") return false
  const value = stop as Partial<GradientStopPreset>
  return (
    typeof value.pos === "number" &&
    Number.isFinite(value.pos) &&
    value.pos >= 0 &&
    value.pos <= 1 &&
    typeof value.color === "string" &&
    HEX_OR_RGBA.test(value.color)
  )
}

function normalizeUserGradients(value: unknown): GradientPreset[] {
  const source =
    value && typeof value === "object" && !Array.isArray(value) && "gradients" in value
      ? (value as { gradients?: unknown }).gradients
      : value
  if (!Array.isArray(source)) return []
  const prepared = source.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item
    const record = item as Record<string, unknown>
    return { ...record, group: record.group ?? record.category ?? "Custom" }
  })
  return normalizeGradientPresets({ gradients: prepared }).slice(0, MAX_USER_GRADIENTS).map((preset) => ({
    id: preset.id,
    name: preset.name,
    stops: preset.stops.filter(isValidStop).slice(0, MAX_STOPS),
    category: preset.group || "Custom",
    createdAt: preset.createdAt,
  }))
}

function loadUserGradients(): GradientPreset[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? normalizeUserGradients(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

function persistUserGradients(gradients: GradientPreset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gradients))
    window.dispatchEvent(new CustomEvent("ps-gradients-changed", { detail: { gradients } }))
  } catch {
    toast.error("Gradient library is too large to save locally.")
  }
}

function drawGradientPreview(canvas: HTMLCanvasElement, stops: GradientStopPreset[]) {
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  // Checkerboard backdrop so transparent stops are visible
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const size = 4
  for (let y = 0; y < canvas.height; y += size) {
    for (let x = 0; x < canvas.width; x += size) {
      ctx.fillStyle = ((x / size + y / size) | 0) % 2 === 0 ? "#cccccc" : "#ffffff"
      ctx.fillRect(x, y, size, size)
    }
  }
  const grad = ctx.createLinearGradient(0, 0, canvas.width, 0)
  for (const s of stops) {
    try { grad.addColorStop(s.pos, s.color) } catch { /* ignore invalid stops */ }
  }
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, canvas.width, canvas.height)
}

export function GradientsPanel() {
  const { dispatch, gradient, foreground, background } = useEditor()
  const [selected, setSelected] = React.useState<string>("fg-bg")
  const [userGradients, setUserGradients] = React.useState<GradientPreset[]>(() => loadUserGradients())
  const [query, setQuery] = React.useState("")
  const [activeCategory, setActiveCategory] = React.useState("All")
  const [sort, setSort] = React.useState<"category" | "name" | "recent">("category")
  const importRef = React.useRef<HTMLInputElement>(null)

  const saveUserGradients = React.useCallback((next: GradientPreset[]) => {
    const normalized = normalizeUserGradients(next)
    setUserGradients(normalized)
    persistUserGradients(normalized)
  }, [])

  React.useEffect(() => {
    const syncGradients = (event: Event) => {
      const detail = (event as CustomEvent<{ gradients?: unknown }>).detail
      setUserGradients(normalizeUserGradients(detail?.gradients ?? loadUserGradients()))
    }
    window.addEventListener("ps-gradients-changed", syncGradients)
    return () => window.removeEventListener("ps-gradients-changed", syncGradients)
  }, [])

  const allGradients = React.useMemo(() => [...DEFAULT_GRADIENTS, ...userGradients], [userGradients])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return allGradients
      .filter((preset) => activeCategory === "All" || (preset.category ?? "Custom") === activeCategory)
      .filter((preset) => !q || preset.name.toLowerCase().includes(q) || (preset.category ?? "").toLowerCase().includes(q))
      .slice()
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name)
        if (sort === "recent") return (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.name.localeCompare(b.name)
        return (a.category ?? "Custom").localeCompare(b.category ?? "Custom") || a.name.localeCompare(b.name)
      })
  }, [allGradients, query, activeCategory, sort])

  const categories = React.useMemo(
    () => ["All", ...Array.from(new Set(allGradients.map((preset) => preset.category ?? "Custom"))).sort()],
    [allGradients],
  )

  const groups = React.useMemo(() => {
    const map = new Map<string, GradientPreset[]>()
    for (const preset of filtered) {
      const key = preset.category ?? "Custom"
      const arr = map.get(key) ?? []
      arr.push(preset)
      map.set(key, arr)
    }
    return Array.from(map.entries())
  }, [filtered])

  const captureFromCurrentStops = () => {
    if (!gradient || !gradient.stops || gradient.stops.length < 2) {
      // Fall back to FG → BG
      const stops: GradientStopPreset[] = [
        { pos: 0, color: foreground },
        { pos: 1, color: background },
      ]
      const preset: GradientPreset = {
        id: `grad-${Date.now()}`,
        name: `Custom ${userGradients.length + 1}`,
        stops,
        category: "Custom",
        createdAt: Date.now(),
      }
      saveUserGradients([...userGradients, preset])
      toast.success("Saved current FG to BG as gradient preset")
      return
    }
    const stops = gradient.stops
      .filter((stop) => Boolean(stop.color))
      .map((stop) => ({ pos: stop.offset, color: stop.color }))
      .filter(isValidStop)
    if (stops.length < 2) {
      toast.error("Current gradient needs at least 2 valid stops.")
      return
    }
    const preset: GradientPreset = {
      id: `grad-${Date.now()}`,
      name: `Custom ${userGradients.length + 1}`,
      stops: stops.slice(0, MAX_STOPS),
      category: "Custom",
      createdAt: Date.now(),
    }
    saveUserGradients([...userGradients, preset])
    toast.success("Gradient preset saved")
  }

  const deleteUserGradient = (id: string) => {
    saveUserGradients(userGradients.filter((preset) => preset.id !== id))
  }

  const renameUserGradient = (id: string, name: string) => {
    saveUserGradients(userGradients.map((preset) => (preset.id === id ? { ...preset, name } : preset)))
  }

  const duplicateUserGradient = (preset: GradientPreset) => {
    saveUserGradients([
      ...userGradients,
      {
        ...preset,
        id: `grad-${Date.now()}`,
        name: `${preset.name} copy`,
        createdAt: Date.now(),
      },
    ])
  }

  const exportGradients = () => {
    downloadText(
      JSON.stringify(
        {
          app: "Photoshop Web",
          format: "ps-gradients",
          version: 1,
          exportedAt: new Date().toISOString(),
          gradients: userGradients.map((preset) => ({ ...preset, group: preset.category ?? "Custom" })),
        },
        null,
        2,
      ),
      "photoshop-gradients.psgradients.json",
    )
  }

  const importGradients = async (file: File) => {
    try {
      if (file.size > MAX_GRADIENT_FILE_BYTES) throw new Error("Gradient files are limited to 256 KB.")
      const next = normalizeUserGradients(JSON.parse(await file.text()))
      if (!next.length) throw new Error("Gradient file does not contain valid gradients.")
      saveUserGradients(mergeById(userGradients, next))
      toast.success(`Imported ${next.length} gradient${next.length === 1 ? "" : "s"}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import gradients")
    } finally {
      if (importRef.current) importRef.current.value = ""
    }
  }

  return (
    <div className="p-2 text-[11px] text-[var(--ps-text)] space-y-2">
      <input
        ref={importRef}
        type="file"
        accept=".json,.psgradients,.psgradients.json,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file) void importGradients(file)
        }}
      />
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search gradients"
        className="h-7 text-[11px]"
        aria-label="Search gradients"
      />
      <div className="grid grid-cols-2 gap-1">
        <select
          value={activeCategory}
          onChange={(event) => setActiveCategory(event.target.value)}
          className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          aria-label="Gradient category"
        >
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as typeof sort)}
          className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          aria-label="Gradient sort"
        >
          <option value="category">Category</option>
          <option value="name">Name</option>
          <option value="recent">Recent</option>
        </select>
      </div>
      {groups.length === 0 && (
        <div className="text-center text-[var(--ps-text-dim)] py-2 text-[10px]">No gradients match.</div>
      )}
      {groups.map(([category, presets]) => (
        <div key={category} className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">{category}</div>
          <div className="grid grid-cols-3 gap-1">
            {presets.map((preset) => (
              <GradientThumb
                key={preset.id}
                preset={preset}
                isActive={selected === preset.id}
                isCustom={preset.category === "Custom"}
                onSelect={() => {
                  setSelected(preset.id)
                  dispatch({ type: "set-gradient-stops", stops: presetStops(preset) })
                }}
                onDelete={preset.category === "Custom" ? () => deleteUserGradient(preset.id) : undefined}
                onRename={preset.category === "Custom" ? (name) => renameUserGradient(preset.id, name) : undefined}
                onDuplicate={preset.category === "Custom" ? () => duplicateUserGradient(preset) : undefined}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="text-[10px] text-[var(--ps-text-dim)] border-t border-[var(--ps-divider)] pt-1">
        {allGradients.find((g) => g.id === selected)?.name ?? ""}
      </div>
      <div className="flex items-center gap-1 border-t border-[var(--ps-divider)] pt-1.5">
        <span className="text-[10px] text-[var(--ps-text-dim)]" title="User gradients are saved in this browser">
          {userGradients.length} custom
        </span>
        <button
          className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm"
          title="Save current gradient as preset"
          aria-label="Save current gradient as preset"
          onClick={captureFromCurrentStops}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <div className="flex-1" />
        <button
          className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm disabled:opacity-50"
          title="Export user gradients"
          aria-label="Export user gradients"
          disabled={!userGradients.length}
          onClick={exportGradients}
        >
          <Download className="w-3.5 h-3.5" />
        </button>
        <button
          className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm"
          title="Import gradients"
          aria-label="Import gradients"
          onClick={() => importRef.current?.click()}
        >
          <Upload className="w-3.5 h-3.5" />
        </button>
        <button
          className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm disabled:opacity-50"
          title="Reset user gradients"
          aria-label="Reset user gradients"
          disabled={!userGradients.length}
          onClick={() => saveUserGradients([])}
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

function GradientThumb({
  preset,
  isActive,
  isCustom,
  onSelect,
  onDelete,
  onDuplicate,
  onRename,
}: {
  preset: GradientPreset
  isActive: boolean
  isCustom: boolean
  onSelect: () => void
  onDelete?: () => void
  onDuplicate?: () => void
  onRename?: (name: string) => void
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(preset.name)

  React.useEffect(() => {
    if (canvasRef.current) drawGradientPreview(canvasRef.current, preset.stops)
  }, [preset])

  React.useEffect(() => {
    if (!editing) setDraft(preset.name)
  }, [preset.name, editing])

  return (
    <div className="relative group">
      <button
        className={`block w-full rounded-sm overflow-hidden border transition-colors ${
          isActive ? "border-[var(--ps-accent)] ring-1 ring-[var(--ps-accent)]" : "border-[var(--ps-divider)] hover:border-white"
        }`}
        title={preset.name}
        onClick={onSelect}
        onDoubleClick={() => {
          if (onRename) setEditing(true)
        }}
      >
        <canvas ref={canvasRef} width={80} height={16} className="w-full h-4 block" />
      </button>
      {isCustom && onDelete && (
        <button
          type="button"
          className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[var(--ps-panel)] border border-[var(--ps-divider)] text-[var(--ps-text-dim)] hover:text-red-400"
          title={`Delete ${preset.name}`}
          aria-label={`Delete ${preset.name}`}
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
      {isCustom && onDuplicate && (
        <button
          type="button"
          className="absolute -bottom-1 -right-1 hidden group-hover:flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[var(--ps-panel)] border border-[var(--ps-divider)] text-[var(--ps-text-dim)] hover:text-[var(--ps-text)]"
          title={`Duplicate ${preset.name}`}
          aria-label={`Duplicate ${preset.name}`}
          onClick={(event) => {
            event.stopPropagation()
            onDuplicate()
          }}
        >
          <Copy className="w-2.5 h-2.5" />
        </button>
      )}
      {editing && onRename && (
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            setEditing(false)
            const trimmed = draft.trim().slice(0, 80)
            if (trimmed && trimmed !== preset.name) onRename(trimmed)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              ;(event.currentTarget as HTMLInputElement).blur()
            } else if (event.key === "Escape") {
              event.preventDefault()
              setEditing(false)
              setDraft(preset.name)
            }
          }}
          className="absolute inset-0 w-full h-full bg-[var(--ps-panel)] text-[10px] px-1 outline-none border border-[var(--ps-accent)]"
          aria-label={`Rename ${preset.name}`}
        />
      )}
    </div>
  )
}
