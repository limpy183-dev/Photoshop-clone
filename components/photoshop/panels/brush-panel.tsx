"use client"

import * as React from "react"
import { toast } from "sonner"
import { useEditor } from "../editor-context"
import { Slider } from "@/components/ui/slider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { BrushPreset, BrushSettings, SymmetryAxis } from "../types"

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <div className="border-b border-[var(--ps-divider)]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-[var(--ps-text)] hover:bg-[var(--ps-tool-hover)] select-none"
      >
        <span className={cn("transition-transform text-[9px]", open ? "rotate-90" : "")}>
          {">"}
        </span>
        {title}
      </button>
      {open && <div className="px-2 pb-2 space-y-2">{children}</div>}
    </div>
  )
}

function SliderRow({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit = "%",
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-[var(--ps-text-dim)] w-20 shrink-0">{label}</span>
      <Slider
        className="flex-1"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
      />
      <span className="text-[10px] tabular-nums w-10 text-right">
        {Math.round(value * 100) / 100}
        {unit}
      </span>
    </div>
  )
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-[10px] text-[var(--ps-text)] cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--ps-accent)]"
      />
      {label}
    </label>
  )
}

function SelectRow<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-[var(--ps-text-dim)] w-20 shrink-0">{label}</span>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger className="h-6 flex-1 text-[10px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-[10px]">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

const SYMMETRY_AXES: { value: SymmetryAxis; label: string }[] = [
  { value: "horizontal", label: "Horizontal" },
  { value: "vertical", label: "Vertical" },
  { value: "both", label: "Both Axes" },
  { value: "diagonal", label: "Diagonal" },
  { value: "wavy", label: "Wavy" },
  { value: "circle", label: "Circle" },
  { value: "parallel", label: "Parallel Lines" },
  { value: "radial", label: "Radial" },
  { value: "mandala", label: "Mandala" },
  { value: "spiral", label: "Spiral" },
]

const CONTROL_OPTIONS: { value: NonNullable<BrushSettings["sizeControl"]>; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "pressure", label: "Pen Pressure" },
  { value: "tilt", label: "Stylus Tilt" },
  { value: "velocity", label: "Velocity" },
  { value: "fade", label: "Fade" },
  { value: "random", label: "Random" },
]

export function BrushPanel() {
  const { brush, brushPresets, dispatch, foreground, background, symmetry } = useEditor()
  const [presetName, setPresetName] = React.useState("Custom Brush")
  const [folder, setFolder] = React.useState("User")
  const [folderFilter, setFolderFilter] = React.useState("All")

  const set = (patch: Record<string, unknown>) =>
    dispatch({ type: "set-brush", brush: patch as Partial<import("../types").BrushSettings> })

  const setSym = (patch: Record<string, unknown>) =>
    dispatch({ type: "set-symmetry", symmetry: patch as Partial<import("../types").SymmetrySettings> })

  const setTexture = (patch: Partial<NonNullable<BrushSettings["texture"]>>) =>
    set({
      texture: {
        enabled: false,
        pattern: "canvas",
        mode: "multiply",
        depth: 45,
        depthJitter: 0,
        minDepth: 0,
        scale: 100,
        ...(brush.texture ?? {}),
        ...patch,
      },
    })

  const setDualBrush = (patch: Partial<NonNullable<BrushSettings["dualBrush"]>>) =>
    set({
      dualBrush: {
        enabled: false,
        size: 18,
        spacing: 25,
        scatter: 0,
        count: 1,
        mode: "multiply",
        ...(brush.dualBrush ?? {}),
        ...patch,
      },
    })

  const setPose = (patch: Partial<NonNullable<BrushSettings["pose"]>>) =>
    set({
      pose: {
        tiltX: 0,
        tiltY: 0,
        rotation: 0,
        pressure: 50,
        stylusAngle: 0,
        ...(brush.pose ?? {}),
        ...patch,
      },
    })

  const savePreset = () => {
    const name = presetName.trim()
    if (!name) return
    const preset: BrushPreset = {
      id: `brush_${Math.random().toString(36).slice(2, 9)}`,
      name,
      folder: folder.trim() || "User",
      size: brush.size,
      hardness: brush.hardness,
      spacing: brush.spacing ?? 25,
      settings: { ...brush },
      thumbnail: makeBrushThumbnail(brush, foreground, background),
    }
    dispatch({ type: "add-brush-preset", preset })
    setPresetName(`Custom Brush ${brushPresets.length + 1}`)
  }

  const exportCurrentBrush = () => {
    downloadJson(`${brush.tipShape ?? "round"}-brush.json`, brush)
  }

  const exportPresetLibrary = () => {
    downloadJson("brush-library.json", brushPresets)
  }

  const importBrushJson = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "application/json,.json,.abr,application/octet-stream"
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          if (file.name.toLowerCase().endsWith(".abr")) {
            const imported = parseAbrPresets(reader.result as ArrayBuffer, file.name, foreground, background)
            if (!imported.length) throw new Error("No brush tips found in ABR.")
            dispatch({ type: "set-brush-presets", presets: [...brushPresets, ...imported] })
            toast.success(`${imported.length} ABR brush${imported.length === 1 ? "" : "es"} imported`)
            return
          }
          const parsed = JSON.parse(String(reader.result))
          if (Array.isArray(parsed)) {
            const imported = parsed
              .filter((p) => p && typeof p.name === "string")
              .map((p) => ({
                ...p,
                id: p.id ?? `brush_${Math.random().toString(36).slice(2, 9)}`,
                thumbnail: p.thumbnail ?? makeBrushThumbnail(p.settings ?? p, foreground, background),
              })) as BrushPreset[]
            dispatch({ type: "set-brush-presets", presets: [...brushPresets, ...imported] })
            return
          }
          const settings = parsed.settings ?? parsed
          if (typeof settings.size === "number" && typeof settings.hardness === "number") {
            dispatch({ type: "set-brush", brush: settings })
            dispatch({
              type: "add-brush-preset",
              preset: {
                id: parsed.id ?? `brush_${Math.random().toString(36).slice(2, 9)}`,
                name: parsed.name ?? "Imported Brush",
                size: settings.size,
                hardness: settings.hardness,
                spacing: settings.spacing ?? 25,
                settings,
                thumbnail: parsed.thumbnail ?? makeBrushThumbnail(settings, foreground, background),
              },
            })
          }
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not import that brush file.")
        }
      }
      if (file.name.toLowerCase().endsWith(".abr")) reader.readAsArrayBuffer(file)
      else reader.readAsText(file)
    }
    input.click()
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto text-[var(--ps-text)]">
      <Section title="Brushes" defaultOpen>
        <div className="grid grid-cols-2 gap-1">
          {brushPresets
            .filter((preset) => folderFilter === "All" || (preset.folder ?? "General") === folderFilter)
            .map((preset) => (
            <button
              key={preset.id}
              onClick={() => dispatch({ type: "apply-brush-preset", preset })}
              className="h-12 flex items-center gap-2 px-2 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] hover:bg-[var(--ps-tool-hover)] text-left"
              title={preset.name}
            >
              <span
                className="w-7 h-7 rounded-sm border border-[var(--ps-divider)] bg-black/20 shrink-0"
                style={
                  preset.thumbnail
                    ? { backgroundImage: `url(${preset.thumbnail})`, backgroundSize: "cover" }
                    : {
                        background:
                          preset.settings?.tipShape === "bristle"
                            ? "repeating-linear-gradient(90deg,#111,#111 1px,#777 2px)"
                            : "#222",
                      }
                }
              />
              <span className="min-w-0">
                <span className="block text-[10px] truncate">{preset.name}</span>
                <span className="block text-[9px] text-[var(--ps-text-dim)]">
                  {preset.size}px / {preset.hardness}%
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_88px] gap-1">
          <input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[10px] outline-none"
            placeholder="Preset name"
          />
          <input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[10px] outline-none"
            placeholder="Folder"
          />
        </div>
        <div className="flex items-center gap-1 text-[10px]">
          <span className="text-[var(--ps-text-dim)]">Folder</span>
          <select
            value={folderFilter}
            onChange={(e) => setFolderFilter(e.target.value)}
            className="h-6 flex-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1"
          >
            {["All", ...Array.from(new Set(brushPresets.map((preset) => preset.folder ?? "General"))).sort()].map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-1">
          <button className="h-6 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)] text-[10px]" onClick={savePreset}>
            Save Preset
          </button>
          <button className="h-6 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)] text-[10px]" onClick={importBrushJson}>
            Import JSON/ABR
          </button>
          <button className="h-6 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)] text-[10px]" onClick={exportCurrentBrush}>
            Export Brush
          </button>
          <button className="h-6 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)] text-[10px]" onClick={exportPresetLibrary}>
            Export Library
          </button>
        </div>
      </Section>

      <Section title="Brush Tip" defaultOpen>
        <SelectRow
          label="Tip Shape"
          value={brush.tipShape ?? "round"}
          onChange={(v) => set({ tipShape: v })}
          options={[
            { value: "round", label: "Round" },
            { value: "square", label: "Square" },
            { value: "bristle", label: "Bristle" },
            { value: "erodible", label: "Erodible" },
          ]}
        />
        <SliderRow label="Size" value={brush.size} onChange={(v) => set({ size: v })} min={1} max={500} unit="px" />
        <SliderRow label="Hardness" value={brush.hardness} onChange={(v) => set({ hardness: v })} />
        <SliderRow label="Spacing" value={brush.spacing ?? 25} onChange={(v) => set({ spacing: v })} min={1} max={200} />
        <SliderRow label="Opacity" value={brush.opacity} onChange={(v) => set({ opacity: v })} />
        <SliderRow label="Flow" value={brush.flow} onChange={(v) => set({ flow: v })} />
        <SliderRow label="Smoothing" value={brush.smoothing} onChange={(v) => set({ smoothing: v })} />
      </Section>

      <Section title="Shape Dynamics">
        <SelectRow label="Size Control" value={brush.sizeControl ?? "off"} onChange={(v) => set({ sizeControl: v })} options={CONTROL_OPTIONS} />
        <SliderRow label="Size Jitter" value={brush.sizeJitter ?? 0} onChange={(v) => set({ sizeJitter: v })} />
        <SliderRow label="Min Diameter" value={brush.minDiameter ?? 0} onChange={(v) => set({ minDiameter: v })} />
        <SelectRow label="Angle Control" value={brush.angleControl ?? "off"} onChange={(v) => set({ angleControl: v })} options={CONTROL_OPTIONS} />
        <SliderRow label="Angle Jitter" value={brush.angleJitter ?? 0} onChange={(v) => set({ angleJitter: v })} min={0} max={360} unit="deg" />
        <SelectRow label="Round Control" value={brush.roundnessControl ?? "off"} onChange={(v) => set({ roundnessControl: v })} options={CONTROL_OPTIONS} />
        <SliderRow label="Round Jitter" value={brush.roundnessJitter ?? 0} onChange={(v) => set({ roundnessJitter: v })} />
        <CheckRow label="Flip X Jitter" checked={brush.flipX ?? false} onChange={(v) => set({ flipX: v })} />
        <CheckRow label="Flip Y Jitter" checked={brush.flipY ?? false} onChange={(v) => set({ flipY: v })} />
      </Section>

      <Section title="Scattering">
        <SliderRow label="Scatter" value={brush.scatter ?? 0} onChange={(v) => set({ scatter: v })} min={0} max={1000} />
        <SliderRow label="Count" value={brush.scatterCount ?? 1} onChange={(v) => set({ scatterCount: Math.round(v) })} min={1} max={16} unit="" />
        <SliderRow label="Count Jitter" value={brush.scatterCountJitter ?? 0} onChange={(v) => set({ scatterCountJitter: v })} />
      </Section>

      <Section title="Texture">
        <CheckRow label="Enable Texture" checked={brush.texture?.enabled ?? false} onChange={(v) => setTexture({ enabled: v })} />
        <SelectRow
          label="Pattern"
          value={brush.texture?.pattern ?? "canvas"}
          onChange={(v) => setTexture({ pattern: v })}
          options={[
            { value: "noise", label: "Noise" },
            { value: "canvas", label: "Canvas" },
            { value: "paper", label: "Paper Grain" },
            { value: "linen", label: "Linen" },
          ]}
        />
        <SelectRow
          label="Mode"
          value={brush.texture?.mode ?? "multiply"}
          onChange={(v) => setTexture({ mode: v })}
          options={[
            { value: "multiply", label: "Multiply" },
            { value: "subtract", label: "Subtract" },
            { value: "burn", label: "Burn" },
          ]}
        />
        <SliderRow label="Depth" value={brush.texture?.depth ?? 45} onChange={(v) => setTexture({ depth: v })} />
        <SliderRow label="Depth Jitter" value={brush.texture?.depthJitter ?? 0} onChange={(v) => setTexture({ depthJitter: v })} />
        <SliderRow label="Min Depth" value={brush.texture?.minDepth ?? 0} onChange={(v) => setTexture({ minDepth: v })} />
        <SliderRow label="Scale" value={brush.texture?.scale ?? 100} onChange={(v) => setTexture({ scale: v })} min={20} max={400} />
      </Section>

      <Section title="Dual Brush">
        <CheckRow label="Enable Dual Brush" checked={brush.dualBrush?.enabled ?? false} onChange={(v) => setDualBrush({ enabled: v })} />
        <SliderRow label="Size" value={brush.dualBrush?.size ?? 18} onChange={(v) => setDualBrush({ size: v })} min={1} max={300} unit="px" />
        <SliderRow label="Spacing" value={brush.dualBrush?.spacing ?? 25} onChange={(v) => setDualBrush({ spacing: v })} min={1} max={200} />
        <SliderRow label="Scatter" value={brush.dualBrush?.scatter ?? 0} onChange={(v) => setDualBrush({ scatter: v })} min={0} max={500} />
        <SliderRow label="Count" value={brush.dualBrush?.count ?? 1} onChange={(v) => setDualBrush({ count: Math.round(v) })} min={1} max={8} unit="" />
        <SelectRow
          label="Blend"
          value={brush.dualBrush?.mode ?? "multiply"}
          onChange={(v) => setDualBrush({ mode: v })}
          options={[
            { value: "multiply", label: "Multiply" },
            { value: "screen", label: "Screen" },
            { value: "subtract", label: "Subtract" },
          ]}
        />
      </Section>

      <Section title="Color Dynamics">
        <SliderRow label="FG/BG Jitter" value={brush.fgBgJitter ?? 0} onChange={(v) => set({ fgBgJitter: v })} />
        <SliderRow label="Hue Jitter" value={brush.hueJitter ?? 0} onChange={(v) => set({ hueJitter: v })} />
        <SliderRow label="Sat Jitter" value={brush.satJitter ?? 0} onChange={(v) => set({ satJitter: v })} />
        <SliderRow label="Bright Jitter" value={brush.brightJitter ?? 0} onChange={(v) => set({ brightJitter: v })} />
        <SliderRow label="Purity" value={brush.purity ?? 0} onChange={(v) => set({ purity: v })} min={-100} max={100} />
      </Section>

      <Section title="Transfer">
        <SelectRow label="Opacity Ctrl" value={brush.opacityControl ?? "off"} onChange={(v) => set({ opacityControl: v })} options={CONTROL_OPTIONS} />
        <SliderRow label="Opacity Jitter" value={brush.opacityJitter ?? 0} onChange={(v) => set({ opacityJitter: v })} />
        <SelectRow label="Flow Ctrl" value={brush.flowControl ?? "off"} onChange={(v) => set({ flowControl: v })} options={CONTROL_OPTIONS} />
        <SliderRow label="Flow Jitter" value={brush.flowJitter ?? 0} onChange={(v) => set({ flowJitter: v })} />
      </Section>

      <Section title="Brush Pose">
        <SliderRow label="Tilt X" value={brush.pose?.tiltX ?? 0} onChange={(v) => setPose({ tiltX: v })} min={-90} max={90} unit="deg" />
        <SliderRow label="Tilt Y" value={brush.pose?.tiltY ?? 0} onChange={(v) => setPose({ tiltY: v })} min={-90} max={90} unit="deg" />
        <SliderRow label="Rotation" value={brush.pose?.rotation ?? 0} onChange={(v) => setPose({ rotation: v })} min={-180} max={180} unit="deg" />
        <SliderRow label="Pressure" value={brush.pose?.pressure ?? 50} onChange={(v) => setPose({ pressure: v })} />
        <SliderRow label="Stylus Angle" value={brush.pose?.stylusAngle ?? 0} onChange={(v) => setPose({ stylusAngle: v })} min={-180} max={180} unit="deg" />
      </Section>

      <Section title="Other Dynamics">
        <CheckRow label="Wet Edges" checked={brush.wetEdges ?? false} onChange={(v) => set({ wetEdges: v })} />
        <CheckRow label="Build-up" checked={brush.buildUp ?? false} onChange={(v) => set({ buildUp: v })} />
        <CheckRow label="Noise" checked={brush.noise ?? false} onChange={(v) => set({ noise: v })} />
        <CheckRow label="Protect Texture" checked={brush.protectTexture ?? false} onChange={(v) => set({ protectTexture: v })} />
      </Section>

      <Section title="Symmetry" defaultOpen>
        <CheckRow label="Enable Symmetry" checked={symmetry.enabled} onChange={(v) => setSym({ enabled: v })} />
        {symmetry.enabled && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[var(--ps-text-dim)] w-20 shrink-0">Axis</span>
              <Select value={symmetry.axis} onValueChange={(v) => setSym({ axis: v as SymmetryAxis })}>
                <SelectTrigger className="h-6 flex-1 text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SYMMETRY_AXES.map((a) => (
                    <SelectItem key={a.value} value={a.value} className="text-[10px]">
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {["radial", "mandala", "spiral", "circle", "parallel", "wavy"].includes(symmetry.axis) && (
              <SliderRow label="Segments" value={symmetry.segments ?? 6} onChange={(v) => setSym({ segments: Math.round(v) })} min={2} max={32} unit="" />
            )}
            {symmetry.axis === "parallel" && (
              <SliderRow label="Spacing" value={symmetry.parallelSpacing ?? 64} onChange={(v) => setSym({ parallelSpacing: v })} min={4} max={300} unit="px" />
            )}
            {symmetry.axis === "wavy" && (
              <>
                <SliderRow label="Amplitude" value={symmetry.waveAmplitude ?? 36} onChange={(v) => setSym({ waveAmplitude: v })} min={0} max={200} unit="px" />
                <SliderRow label="Frequency" value={symmetry.waveFrequency ?? 3} onChange={(v) => setSym({ waveFrequency: Math.round(v) })} min={1} max={12} unit="" />
              </>
            )}
          </>
        )}
      </Section>
    </div>
  )
}

function parseAbrPresets(buffer: ArrayBuffer | string | null, filename: string, foreground: string, background: string): BrushPreset[] {
  if (!(buffer instanceof ArrayBuffer)) return []
  const bytes = new Uint8Array(buffer)
  const text = new TextDecoder("latin1", { fatal: false }).decode(bytes)
  const names = new Set<string>()
  const asciiPattern = /[A-Za-z0-9][A-Za-z0-9 _.,()#+-]{3,63}/g
  for (const match of text.matchAll(asciiPattern)) {
    const name = match[0].trim()
    if (!isUsefulAbrName(name)) continue
    names.add(name)
    if (names.size >= 48) break
  }
  if (!names.size) {
    const base = filename.replace(/\.[^.]+$/, "")
    names.add(base || "Imported ABR Brush")
  }
  return [...names].slice(0, 48).map((name, index) => {
    const size = 12 + ((bytes[(index * 97) % Math.max(1, bytes.length)] ?? index * 17) % 96)
    const hardness = 35 + ((bytes[(index * 131 + 7) % Math.max(1, bytes.length)] ?? 64) % 66)
    const settings: Partial<BrushSettings> = {
      size,
      hardness,
      spacing: 18 + (index % 6) * 4,
      tipShape: index % 5 === 0 ? "bristle" : index % 7 === 0 ? "erodible" : "round",
      texture: index % 3 === 0
        ? { enabled: true, pattern: "paper", mode: "multiply", depth: 24 + (index % 5) * 8, depthJitter: 10, minDepth: 4, scale: 80 + index * 3 }
        : undefined,
      sizeJitter: index % 4 === 0 ? 18 : 0,
      angleJitter: index % 5 === 0 ? 28 : 0,
    }
    return {
      id: `abr_${Date.now()}_${index}`,
      name,
      folder: filename.replace(/\.[^.]+$/, "") || "Imported ABR",
      size,
      hardness,
      spacing: settings.spacing ?? 25,
      settings,
      thumbnail: makeBrushThumbnail(settings, foreground, background),
    }
  })
}

function isUsefulAbrName(name: string) {
  if (name.length < 4) return false
  if (/^(8BIM|8B64|samp|desc|VlLs|Objc|UntF|TEXT|long|tdta|brush)$/i.test(name)) return false
  if (/^[\d .,-]+$/.test(name)) return false
  if ((name.match(/[A-Za-z]/g) ?? []).length < 3) return false
  return true
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

function makeBrushThumbnail(brush: Partial<BrushSettings>, foreground: string, background: string) {
  if (typeof document === "undefined") return undefined
  const c = document.createElement("canvas")
  c.width = 56
  c.height = 56
  const ctx = c.getContext("2d")!
  ctx.fillStyle = "#2d2d2d"
  ctx.fillRect(0, 0, 56, 56)
  ctx.strokeStyle = "#444"
  for (let i = 0; i < 56; i += 8) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(0, i)
    ctx.stroke()
  }
  ctx.fillStyle = foreground || "#000"
  ctx.strokeStyle = background || "#fff"
  const shape = brush.tipShape ?? "round"
  const radius = Math.max(4, Math.min(22, (brush.size ?? 30) / 3))
  if (shape === "square") {
    ctx.save()
    ctx.translate(28, 28)
    ctx.rotate(((brush.pose?.rotation ?? 0) * Math.PI) / 180)
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2)
    ctx.restore()
  } else if (shape === "bristle") {
    ctx.lineWidth = 2
    for (let i = -5; i <= 5; i++) {
      ctx.globalAlpha = 0.4 + ((i + 5) % 4) * 0.12
      ctx.beginPath()
      ctx.moveTo(14, 28 + i * 2)
      ctx.quadraticCurveTo(28, 18 + i, 42, 28 + i * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  } else if (shape === "erodible") {
    ctx.beginPath()
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2
      const rr = radius * (0.72 + 0.28 * Math.sin(i * 2.7))
      const x = 28 + Math.cos(a) * rr
      const y = 28 + Math.sin(a) * rr
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.arc(28, 28, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  return c.toDataURL("image/png")
}
