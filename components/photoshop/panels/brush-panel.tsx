"use client"
import {
  MAX_BRUSH_IMPORT_BYTES,
  downloadJson,
  formatImportBytes,
  makeBrushThumbnail,
  normalizeImportedBrushPayload,
  parseAbrPresets,
} from "@/editor/document/brush-import"
import { CheckRow, Section, SelectRow, SliderRow } from "@/components/photoshop/panels/brush-panel-controls"
import * as React from "react"
import { toast } from "sonner"
import { Copy, Search, Trash2 } from "lucide-react"
import { useEditorCommands, useEditorStateSelector } from "@/components/photoshop/editor/context"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { BrushPreset, BrushSettings, SymmetryAxis } from "@/editor/types"
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
  const brush = useEditorStateSelector((state) => state.brush)
  const brushPresets = useEditorStateSelector((state) => state.brushPresets)
  const foreground = useEditorStateSelector((state) => state.foreground)
  const background = useEditorStateSelector((state) => state.background)
  const symmetry = useEditorStateSelector((state) => state.symmetry)
  const { dispatch } = useEditorCommands()
  const [presetName, setPresetName] = React.useState("Custom Brush")
  const [folder, setFolder] = React.useState("User")
  const [folderFilter, setFolderFilter] = React.useState("All")
  const [presetSearch, setPresetSearch] = React.useState("")
  const [presetSort, setPresetSort] = React.useState<"folder" | "name" | "size">("folder")

  const set = (patch: Record<string, unknown>) =>
    dispatch({ type: "set-brush", brush: patch as Partial<import("@/editor/types").BrushSettings> })

  const setSym = (patch: Record<string, unknown>) =>
    dispatch({ type: "set-symmetry", symmetry: patch as Partial<import("@/editor/types").SymmetrySettings> })

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

  const setErodibleTip = (patch: Partial<NonNullable<BrushSettings["erodibleTip"]>>) =>
    set({
      erodibleTip: {
        sharpness: 70,
        flatness: 35,
        erosionRate: 50,
        softness: 20,
        aspectRatio: 80,
        rotation: 0,
        ...(brush.erodibleTip ?? {}),
        ...patch,
      },
    })

  const setBristleTip = (patch: Partial<NonNullable<BrushSettings["bristleTip"]>>) =>
    set({
      bristleTip: {
        length: 65,
        density: 55,
        thickness: 35,
        stiffness: 55,
        splay: 35,
        wetness: 25,
        ...(brush.bristleTip ?? {}),
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

  const visibleBrushPresets = React.useMemo(() => {
    const q = presetSearch.trim().toLowerCase()
    return brushPresets
      .filter((preset) => folderFilter === "All" || (preset.folder ?? "General") === folderFilter)
      .filter((preset) => !q || `${preset.name} ${preset.folder ?? ""} ${preset.settings?.tipShape ?? ""}`.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => {
        if (presetSort === "name") return a.name.localeCompare(b.name)
        if (presetSort === "size") return a.size - b.size || a.name.localeCompare(b.name)
        return (a.folder ?? "General").localeCompare(b.folder ?? "General") || a.name.localeCompare(b.name)
      })
  }, [brushPresets, folderFilter, presetSearch, presetSort])

  const duplicatePreset = (preset: BrushPreset) => {
    dispatch({
      type: "add-brush-preset",
      preset: {
        ...preset,
        id: `brush_${Math.random().toString(36).slice(2, 9)}`,
        name: `${preset.name} copy`,
      },
    })
  }

  const setMixer = (patch: Partial<NonNullable<BrushSettings["mixer"]>>) =>
    set({
      mixer: {
        wet: 55,
        load: 60,
        mix: 50,
        flow: brush.flow,
        sampleAllLayers: false,
        cleanAfterStroke: false,
        ...(brush.mixer ?? {}),
        ...patch,
      },
    })

  const setColorReplacement = (patch: Partial<NonNullable<BrushSettings["colorReplacement"]>>) =>
    set({
      colorReplacement: {
        sampling: "continuous",
        limits: "contiguous",
        mode: "color",
        tolerance: 32,
        antiAlias: true,
        ...(brush.colorReplacement ?? {}),
        ...patch,
      },
    })

  const setArtHistory = (patch: Partial<NonNullable<BrushSettings["artHistory"]>>) =>
    set({
      artHistory: {
        style: "tight-medium",
        area: 24,
        fidelity: 60,
        ...(brush.artHistory ?? {}),
        ...patch,
      },
    })

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
      if (file.size > MAX_BRUSH_IMPORT_BYTES) {
        toast.error(`Brush imports are limited to ${formatImportBytes(MAX_BRUSH_IMPORT_BYTES)}.`)
        return
      }
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
          const imported = normalizeImportedBrushPayload(parsed, {
            fileSizeBytes: file.size,
            makeThumbnail: (settings) => makeBrushThumbnail(settings, foreground, background),
          })
          if (imported.kind === "library") {
            dispatch({ type: "set-brush-presets", presets: [...brushPresets, ...imported.presets] })
          } else {
            dispatch({ type: "set-brush", brush: imported.brush })
            dispatch({ type: "add-brush-preset", preset: imported.preset })
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
        <div className="grid grid-cols-[1fr_86px] gap-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-1.5 top-1.5 h-3 w-3 text-[var(--ps-text-dim)]" />
            <input
              value={presetSearch}
              onChange={(e) => setPresetSearch(e.target.value)}
              className="h-6 w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] pl-6 pr-2 text-[10px] outline-none"
              placeholder="Search brushes"
            />
          </div>
          <select
            value={presetSort}
            onChange={(e) => setPresetSort(e.target.value as typeof presetSort)}
            className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          >
            <option value="folder">Folder</option>
            <option value="name">Name</option>
            <option value="size">Size</option>
          </select>
        </div>
        <div className="grid grid-cols-1 gap-1">
          {visibleBrushPresets.map((preset) => (
            <div
              key={preset.id}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]"
            >
              <button
                onClick={() => dispatch({ type: "apply-brush-preset", preset })}
                className="h-12 min-w-0 flex items-center gap-2 px-2 hover:bg-[var(--ps-tool-hover)] text-left"
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
                    {(preset.folder ?? "General")} - {preset.size}px / {preset.hardness}%
                  </span>
                </span>
              </button>
              <button
                className="flex h-7 w-7 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)]"
                title="Duplicate brush preset"
                onClick={() => duplicatePreset(preset)}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                className="flex h-7 w-7 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)]"
                title="Delete brush preset"
                onClick={() => dispatch({ type: "remove-brush-preset", id: preset.id })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
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

      <Section title="Erodible Tip Physics">
        <SliderRow label="Sharpness" value={brush.erodibleTip?.sharpness ?? 70} onChange={(v) => setErodibleTip({ sharpness: v })} />
        <SliderRow label="Flatness" value={brush.erodibleTip?.flatness ?? 35} onChange={(v) => setErodibleTip({ flatness: v })} />
        <SliderRow label="Erosion" value={brush.erodibleTip?.erosionRate ?? 50} onChange={(v) => setErodibleTip({ erosionRate: v })} />
        <SliderRow label="Softness" value={brush.erodibleTip?.softness ?? 20} onChange={(v) => setErodibleTip({ softness: v })} />
        <SliderRow label="Aspect" value={brush.erodibleTip?.aspectRatio ?? 80} onChange={(v) => setErodibleTip({ aspectRatio: v })} min={15} max={100} />
        <SliderRow label="Rotation" value={brush.erodibleTip?.rotation ?? 0} onChange={(v) => setErodibleTip({ rotation: v })} min={-180} max={180} unit="deg" />
      </Section>

      <Section title="Bristle Tip Physics">
        <SliderRow label="Length" value={brush.bristleTip?.length ?? 65} onChange={(v) => setBristleTip({ length: v })} />
        <SliderRow label="Density" value={brush.bristleTip?.density ?? 55} onChange={(v) => setBristleTip({ density: v })} />
        <SliderRow label="Thickness" value={brush.bristleTip?.thickness ?? 35} onChange={(v) => setBristleTip({ thickness: v })} />
        <SliderRow label="Stiffness" value={brush.bristleTip?.stiffness ?? 55} onChange={(v) => setBristleTip({ stiffness: v })} />
        <SliderRow label="Splay" value={brush.bristleTip?.splay ?? 35} onChange={(v) => setBristleTip({ splay: v })} />
        <SliderRow label="Wetness" value={brush.bristleTip?.wetness ?? 25} onChange={(v) => setBristleTip({ wetness: v })} />
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

      <Section title="Mixer Reservoir">
        <SliderRow label="Wet" value={brush.mixer?.wet ?? 55} onChange={(v) => setMixer({ wet: v })} />
        <SliderRow label="Load" value={brush.mixer?.load ?? 60} onChange={(v) => setMixer({ load: v })} />
        <SliderRow label="Mix" value={brush.mixer?.mix ?? 50} onChange={(v) => setMixer({ mix: v })} />
        <SliderRow label="Flow" value={brush.mixer?.flow ?? brush.flow} onChange={(v) => setMixer({ flow: v })} />
        <CheckRow label="Sample All Layers" checked={brush.mixer?.sampleAllLayers ?? false} onChange={(v) => setMixer({ sampleAllLayers: v })} />
        <CheckRow label="Clean After Stroke" checked={brush.mixer?.cleanAfterStroke ?? false} onChange={(v) => setMixer({ cleanAfterStroke: v })} />
      </Section>

      <Section title="Color Replacement">
        <SelectRow
          label="Sampling"
          value={brush.colorReplacement?.sampling ?? "continuous"}
          onChange={(v) => setColorReplacement({ sampling: v })}
          options={[
            { value: "continuous", label: "Continuous" },
            { value: "once", label: "Once" },
            { value: "background-swatch", label: "Background" },
          ]}
        />
        <SelectRow
          label="Limits"
          value={brush.colorReplacement?.limits ?? "contiguous"}
          onChange={(v) => setColorReplacement({ limits: v })}
          options={[
            { value: "contiguous", label: "Contiguous" },
            { value: "discontiguous", label: "Discontiguous" },
            { value: "find-edges", label: "Find Edges" },
          ]}
        />
        <SelectRow
          label="Mode"
          value={brush.colorReplacement?.mode ?? "color"}
          onChange={(v) => setColorReplacement({ mode: v })}
          options={[
            { value: "color", label: "Color" },
            { value: "hue", label: "Hue" },
            { value: "saturation", label: "Saturation" },
            { value: "luminosity", label: "Luminosity" },
          ]}
        />
        <SliderRow label="Tolerance" value={brush.colorReplacement?.tolerance ?? 32} onChange={(v) => setColorReplacement({ tolerance: v })} min={0} max={255} unit="" />
        <CheckRow label="Anti-alias Edges" checked={brush.colorReplacement?.antiAlias ?? true} onChange={(v) => setColorReplacement({ antiAlias: v })} />
      </Section>

      <Section title="Art History">
        <SelectRow
          label="Style"
          value={brush.artHistory?.style ?? "tight-medium"}
          onChange={(v) => setArtHistory({ style: v })}
          options={[
            { value: "tight-short", label: "Tight Short" },
            { value: "tight-medium", label: "Tight Medium" },
            { value: "loose-long", label: "Loose Long" },
            { value: "dab", label: "Dab" },
            { value: "curl", label: "Curl" },
          ]}
        />
        <SliderRow label="Area" value={brush.artHistory?.area ?? 24} onChange={(v) => setArtHistory({ area: v })} min={4} max={200} unit="px" />
        <SliderRow label="Fidelity" value={brush.artHistory?.fidelity ?? 60} onChange={(v) => setArtHistory({ fidelity: v })} />
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
