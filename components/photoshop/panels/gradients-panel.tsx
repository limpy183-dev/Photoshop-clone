"use client"

import * as React from "react"
import { Copy, Download, Plus, RotateCcw, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { CLIENT_STORAGE_KEYS, readClientStorageJson, writeClientStorageJson } from "../client-storage"
import { downloadText } from "../document-io"
import { useEditorCommands, useEditorStateSelector } from "../editor-context"
import { addPhotoshopEventListener, dispatchPhotoshopEvent } from "../events"
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

interface GradientTrackBox {
  left: number
  width: number
}

const MAX_USER_GRADIENTS = 64
const MAX_STOPS = 16
const MAX_GRADIENT_FILE_BYTES = 256 * 1024
const HEX_OR_RGBA = /^(#[0-9a-f]{3,8}|rgba?\([^()]{1,80}\))$/i

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function pointerOffset(clientX: number, box: GradientTrackBox) {
  return clamp01((clientX - box.left) / Math.max(1, box.width))
}

export function insertGradientStopFromPointer(stops: readonly GradientStopPreset[], clientX: number, box: GradientTrackBox, color: string): GradientStopPreset[] {
  const pos = Math.round(pointerOffset(clientX, box) * 1000) / 1000
  return [...stops, { pos, color }].sort((a, b) => a.pos - b.pos).slice(0, MAX_STOPS)
}

export function updateGradientStopFromDrag(stops: readonly GradientStopPreset[], index: number, clientX: number, box: GradientTrackBox): GradientStopPreset[] {
  if (!stops[index]) return [...stops]
  return stops
    .map((stop, stopIndex) => stopIndex === index ? { ...stop, pos: Math.round(pointerOffset(clientX, box) * 1000) / 1000 } : stop)
    .sort((a, b) => a.pos - b.pos)
}

function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 0xffffffff
  }
}

export function createNoiseGradientPreset(name = "Noise Gradient", stopCount = 10, seed = Date.now()): GradientPreset {
  const random = seededRandom(seed)
  const count = Math.max(2, Math.min(MAX_STOPS, Math.round(stopCount)))
  const stops = Array.from({ length: count }, (_, index) => {
    const c = Math.round(random() * 255).toString(16).padStart(2, "0")
    const m = Math.round(random() * 255).toString(16).padStart(2, "0")
    const y = Math.round(random() * 255).toString(16).padStart(2, "0")
    return { pos: count === 1 ? 0 : index / (count - 1), color: `#${c}${m}${y}` }
  })
  return { id: `noise-${seed}`, name, category: "Noise", stops, createdAt: seed }
}

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
  try {
    return normalizeUserGradients(readClientStorageJson(CLIENT_STORAGE_KEYS.gradients))
  } catch {
    return []
  }
}

function persistUserGradients(gradients: GradientPreset[]) {
  try {
    writeClientStorageJson(CLIENT_STORAGE_KEYS.gradients, gradients)
    dispatchPhotoshopEvent("ps-gradients-changed", { gradients })
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
  const gradient = useEditorStateSelector((state) => state.gradient)
  const foreground = useEditorStateSelector((state) => state.foreground)
  const background = useEditorStateSelector((state) => state.background)
  const { dispatch } = useEditorCommands()
  const [selected, setSelected] = React.useState<string>("fg-bg")
  const [userGradients, setUserGradients] = React.useState<GradientPreset[]>(() => loadUserGradients())
  const [query, setQuery] = React.useState("")
  const [activeCategory, setActiveCategory] = React.useState("All")
  const [sort, setSort] = React.useState<"category" | "name" | "recent">("category")
  const [editorStops, setEditorStops] = React.useState<GradientStopPreset[]>(() => [
    { pos: 0, color: foreground },
    { pos: 1, color: background },
  ])
  const [selectedStopIndex, setSelectedStopIndex] = React.useState(0)
  const importRef = React.useRef<HTMLInputElement>(null)

  const saveUserGradients = React.useCallback((next: GradientPreset[]) => {
    const normalized = normalizeUserGradients(next)
    setUserGradients(normalized)
    persistUserGradients(normalized)
  }, [])

  React.useEffect(() => {
    const syncGradients = (detail: { gradients?: unknown }) => {
      setUserGradients(normalizeUserGradients(detail?.gradients ?? loadUserGradients()))
    }
    return addPhotoshopEventListener("ps-gradients-changed", syncGradients)
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

  const applyEditorStops = (stops: GradientStopPreset[]) => {
    const normalized = stops.filter(isValidStop).sort((a, b) => a.pos - b.pos).slice(0, MAX_STOPS)
    if (normalized.length < 2) return
    setEditorStops(normalized)
    setSelectedStopIndex((index) => Math.min(index, normalized.length - 1))
    dispatch({ type: "set-gradient-stops", stops: presetStops({ id: "editor", name: "Editor", stops: normalized }) })
  }

  const saveNoiseGradient = () => {
    const preset = createNoiseGradientPreset(`Noise ${userGradients.length + 1}`, 10, Date.now())
    saveUserGradients([...userGradients, preset])
    applyEditorStops(preset.stops)
    setSelected(preset.id)
    toast.success("Noise gradient generated")
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
                  setEditorStops(preset.stops)
                  setSelectedStopIndex(0)
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
      <FreeformGradientEditor
        stops={editorStops}
        selectedIndex={selectedStopIndex}
        dither={gradient.dither ?? false}
        onSelect={setSelectedStopIndex}
        onChange={applyEditorStops}
        onDither={(dither) => dispatch({ type: "set-gradient", gradient: { dither } })}
        addColor={foreground}
      />
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
        <button
          className="rounded-sm border border-[var(--ps-divider)] px-1.5 py-1 text-[10px] hover:bg-[var(--ps-tool-hover)]"
          title="Generate noise gradient"
          aria-label="Generate noise gradient"
          onClick={saveNoiseGradient}
        >
          Noise
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

function FreeformGradientEditor({
  stops,
  selectedIndex,
  dither,
  addColor,
  onSelect,
  onChange,
  onDither,
}: {
  stops: GradientStopPreset[]
  selectedIndex: number
  dither: boolean
  addColor: string
  onSelect: (index: number) => void
  onChange: (stops: GradientStopPreset[]) => void
  onDither: (dither: boolean) => void
}) {
  const barRef = React.useRef<HTMLDivElement>(null)
  const [dragIndex, setDragIndex] = React.useState<number | null>(null)
  const selected = stops[selectedIndex] ?? stops[0]
  const css = `linear-gradient(90deg, ${stops.map((stop) => `${stop.color} ${Math.round(stop.pos * 100)}%`).join(", ")})`

  const trackBox = React.useCallback((): GradientTrackBox | null => {
    const rect = barRef.current?.getBoundingClientRect()
    return rect ? { left: rect.left, width: rect.width } : null
  }, [])

  React.useEffect(() => {
    if (dragIndex === null) return
    const move = (event: PointerEvent) => {
      const box = trackBox()
      if (!box) return
      const next = updateGradientStopFromDrag(stops, dragIndex, event.clientX, box)
      const moved = next.findIndex((stop) => stop === stops[dragIndex] || (stop.color === stops[dragIndex]?.color && Math.abs(stop.pos - pointerOffset(event.clientX, box)) < 0.002))
      onChange(next)
      onSelect(Math.max(0, moved))
    }
    const up = () => setDragIndex(null)
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up, { once: true })
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
  }, [dragIndex, onChange, onSelect, stops, trackBox])

  return (
    <div className="space-y-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
      <div
        ref={barRef}
        className="relative h-8 rounded-sm border border-[var(--ps-divider)]"
        style={{ background: css }}
        onPointerDown={(event) => {
          const box = trackBox()
          if (!box) return
          const pos = pointerOffset(event.clientX, box)
          const hit = stops.findIndex((stop) => Math.abs(stop.pos - pos) <= 0.035)
          if (hit >= 0) {
            onSelect(hit)
            setDragIndex(hit)
          } else {
            const next = insertGradientStopFromPointer(stops, event.clientX, box, addColor)
            const nextIndex = next.findIndex((stop) => Math.abs(stop.pos - pos) < 0.002 && stop.color === addColor)
            onChange(next)
            onSelect(Math.max(0, nextIndex))
            setDragIndex(Math.max(0, nextIndex))
          }
        }}
      >
        {stops.map((stop, index) => (
          <button
            key={`${stop.color}-${index}`}
            type="button"
            aria-label={`Gradient stop ${index + 1}`}
            className={`absolute top-1/2 h-4 w-3 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border ${selectedIndex === index ? "border-white" : "border-black/70"}`}
            style={{ left: `${stop.pos * 100}%`, backgroundColor: stop.color }}
            onPointerDown={(event) => {
              event.stopPropagation()
              onSelect(index)
              setDragIndex(index)
            }}
          />
        ))}
      </div>
      <div className="grid grid-cols-[1fr_72px_auto] items-end gap-1">
        <label className="grid gap-1 text-[10px] text-[var(--ps-text-dim)]">
          Stop color
          <input
            type="color"
            value={selected?.color && selected.color.startsWith("#") ? selected.color.slice(0, 7) : "#000000"}
            onChange={(event) => {
              if (!selected) return
              onChange(stops.map((stop, index) => index === selectedIndex ? { ...stop, color: event.target.value } : stop))
            }}
            className="h-7 w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-0.5"
          />
        </label>
        <label className="grid gap-1 text-[10px] text-[var(--ps-text-dim)]">
          Pos %
          <input
            type="number"
            min={0}
            max={100}
            value={Math.round((selected?.pos ?? 0) * 100)}
            onChange={(event) => {
              if (!selected) return
              const pos = clamp01((Number(event.target.value) || 0) / 100)
              onChange(stops.map((stop, index) => index === selectedIndex ? { ...stop, pos } : stop).sort((a, b) => a.pos - b.pos))
            }}
            className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-1 text-[10px]"
          />
        </label>
        <label className="mb-1 flex items-center gap-1 text-[10px] text-[var(--ps-text-dim)]">
          <input type="checkbox" checked={dither} onChange={(event) => onDither(event.target.checked)} />
          Dither
        </label>
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
