"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useEditor } from "./editor-context"
import { defaultStyle } from "./layer-styles"
import {
  defaultAdvancedBlending,
  normalizeAdvancedBlending,
  setBlendIfRangeHandle,
} from "./layer-workflows"
import type { AdvancedBlending, BlendIfRange, BlendMode, GradientStop, LayerStyle, MultiGradient } from "./types"

type StyleKey =
  | "blending"
  | "dropShadow"
  | "outerGlow"
  | "innerGlow"
  | "innerShadow"
  | "bevel"
  | "satin"
  | "colorOverlay"
  | "gradientOverlay"
  | "stroke"
  | "patternOverlay"

type EffectKey = Exclude<StyleKey, "blending">

const EFFECTS: { key: StyleKey; label: string }[] = [
  { key: "blending", label: "Blending Options" },
  { key: "bevel", label: "Bevel & Emboss" },
  { key: "stroke", label: "Stroke" },
  { key: "innerShadow", label: "Inner Shadow" },
  { key: "innerGlow", label: "Inner Glow" },
  { key: "satin", label: "Satin" },
  { key: "colorOverlay", label: "Color Overlay" },
  { key: "gradientOverlay", label: "Gradient Overlay" },
  { key: "patternOverlay", label: "Pattern Overlay" },
  { key: "outerGlow", label: "Outer Glow" },
  { key: "dropShadow", label: "Drop Shadow" },
]

const BLEND_OPTIONS: BlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "soft-light",
  "hard-light",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
]

const GRADIENT_TYPES: MultiGradient["type"][] = ["linear", "radial", "angular", "reflected", "diamond"]
const CONTOURS = ["linear", "soft", "sharp", "ring", "cone"] as const

export function LayerStyleDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeDoc, activeLayer, foreground, dispatch, commit } = useEditor()
  const [style, setStyle] = React.useState<LayerStyle>(() => defaultStyle(foreground))
  const [advanced, setAdvanced] = React.useState<AdvancedBlending>(() => defaultAdvancedBlending())
  const [tab, setTab] = React.useState<StyleKey>("blending")
  const [presetName, setPresetName] = React.useState("Custom Style")
  const [selectedPreset, setSelectedPreset] = React.useState("builtin:neon")
  const [scalePct, setScalePct] = React.useState(100)
  const builtInPresets = React.useMemo(() => builtInStylePresets(foreground), [foreground])
  const customPresets = activeDoc?.stylePresets ?? []

  React.useEffect(() => {
    if (open && activeLayer) {
      setStyle(mergeStyle(defaultStyle(foreground), activeLayer.style))
      const nextAdvanced = normalizeAdvancedBlending(activeLayer.advancedBlending)
      setAdvanced({ ...nextAdvanced, fillOpacity: activeLayer.fillOpacity ?? nextAdvanced.fillOpacity })
      setTab("blending")
    }
  }, [open, activeLayer, foreground])

  const update = <K extends EffectKey>(key: K, patch: Partial<NonNullable<LayerStyle[K]>>) => {
    setStyle((s) => {
      const defaults = defaultStyle(foreground)
      const base = s[key] ?? defaults[key]!
      return { ...s, [key]: mergeEffect(base, patch) as LayerStyle[K] }
    })
  }

  const submit = () => {
    if (!activeLayer) {
      onOpenChange(false)
      return
    }
    dispatch({ type: "set-layer-style", id: activeLayer.id, style })
    dispatch({ type: "set-layer-advanced-blending", id: activeLayer.id, advancedBlending: advanced })
    dispatch({ type: "set-layer-fill-opacity", id: activeLayer.id, fillOpacity: advanced.fillOpacity })
    setTimeout(() => commit("Layer Style", [activeLayer.id]), 0)
    onOpenChange(false)
  }

  const reset = () => {
    if (!activeLayer) return
    dispatch({ type: "set-layer-style", id: activeLayer.id, style: undefined })
    dispatch({ type: "set-layer-advanced-blending", id: activeLayer.id, advancedBlending: undefined })
    setTimeout(() => commit("Clear Layer Style", [activeLayer.id]), 0)
    onOpenChange(false)
  }

  const applyPreset = (id: string) => {
    const preset =
      builtInPresets.find((p) => `builtin:${p.id}` === id) ??
      customPresets.find((p) => `custom:${p.id}` === id)
    if (!preset) return
    setStyle(cloneStyle(preset.style))
    setPresetName(preset.name)
    setSelectedPreset(id)
  }

  const savePreset = () => {
    if (!activeDoc) return
    const name = presetName.trim()
    if (!name) return
    const existing = customPresets.find((preset) => preset.name.toLowerCase() === name.toLowerCase())
    const preset = {
      id: existing?.id ?? `style_${Math.random().toString(36).slice(2, 9)}`,
      name,
      style: cloneStyle(style),
    }
    dispatch({
      type: "set-style-presets",
      presets: [...customPresets.filter((item) => item.id !== preset.id), preset].sort((a, b) => a.name.localeCompare(b.name)),
    })
    setSelectedPreset(`custom:${preset.id}`)
  }

  const deletePreset = () => {
    if (!activeDoc || !selectedPreset.startsWith("custom:")) return
    const id = selectedPreset.replace("custom:", "")
    dispatch({ type: "set-style-presets", presets: customPresets.filter((preset) => preset.id !== id) })
    setSelectedPreset("builtin:neon")
  }

  const scaleEffects = () => {
    const factor = Math.max(1, scalePct) / 100
    setStyle((current) => scaleLayerStyle(current, factor))
  }

  const renderEffectFields = () => {
    switch (tab) {
      case "blending":
        return (
          <FieldGrid>
            <SliderRow
              label="Fill Opacity"
              suffix="%"
              min={0}
              max={100}
              value={Math.round(advanced.fillOpacity * 100)}
              onChange={(v) => setAdvanced((current) => ({ ...current, fillOpacity: v / 100 }))}
            />
            <SelectRow
              label="Knockout"
              value={advanced.knockout}
              options={[
                ["none", "None"],
                ["shallow", "Shallow"],
                ["deep", "Deep"],
              ]}
              onChange={(v) => setAdvanced((current) => ({ ...current, knockout: v as AdvancedBlending["knockout"] }))}
            />
            <div className="grid grid-cols-3 gap-2">
              <CheckboxRow label="R" checked={advanced.channels.r} onChange={(v) => setAdvanced((current) => ({ ...current, channels: { ...current.channels, r: v } }))} />
              <CheckboxRow label="G" checked={advanced.channels.g} onChange={(v) => setAdvanced((current) => ({ ...current, channels: { ...current.channels, g: v } }))} />
              <CheckboxRow label="B" checked={advanced.channels.b} onChange={(v) => setAdvanced((current) => ({ ...current, channels: { ...current.channels, b: v } }))} />
            </div>
            <CheckboxRow
              label="Transparency Shapes Layer"
              checked={advanced.transparencyShapesLayer !== false}
              onChange={(v) => setAdvanced((current) => ({ ...current, transparencyShapesLayer: v }))}
            />
            <CheckboxRow
              label="Layer Mask Hides Effects"
              checked={advanced.layerMaskHidesEffects === true}
              onChange={(v) => setAdvanced((current) => ({ ...current, layerMaskHidesEffects: v }))}
            />
            <CheckboxRow
              label="Vector Mask Hides Effects"
              checked={advanced.vectorMaskHidesEffects === true}
              onChange={(v) => setAdvanced((current) => ({ ...current, vectorMaskHidesEffects: v }))}
            />
            <BlendIfControls
              label="Blend If: This Layer"
              range={advanced.blendIfThis}
              onChange={(range) => setAdvanced((current) => ({ ...current, blendIfThis: range }))}
            />
            <BlendIfControls
              label="Blend If: Underlying Layer"
              range={advanced.blendIfUnderlying}
              onChange={(range) => setAdvanced((current) => ({ ...current, blendIfUnderlying: range }))}
            />
          </FieldGrid>
        )
      case "dropShadow": {
        const s = style.dropShadow ?? defaultStyle(foreground).dropShadow!
        return (
          <FieldGrid>
            <BlendModeRow value={s.blendMode ?? "multiply"} onChange={(v) => update("dropShadow", { blendMode: v })} />
            <ColorRow label="Color" value={s.color} onChange={(v) => update("dropShadow", { color: v })} />
            <SliderRow label="Opacity" suffix="%" min={0} max={100} value={Math.round(s.opacity * 100)} onChange={(v) => update("dropShadow", { opacity: v / 100 })} />
            <CheckboxRow label="Use Global Light" checked={s.useGlobalLight ?? true} onChange={(v) => update("dropShadow", { useGlobalLight: v })} />
            <SliderRow label="Angle" suffix=" deg" min={-180} max={180} value={s.angle ?? 120} onChange={(v) => update("dropShadow", { angle: v })} />
            <SliderRow label="Distance" suffix="px" min={0} max={250} value={s.distance ?? Math.round(Math.hypot(s.offsetX, s.offsetY))} onChange={(v) => update("dropShadow", { distance: v })} />
            <SliderRow label="Spread" suffix="%" min={0} max={100} value={s.spread ?? 0} onChange={(v) => update("dropShadow", { spread: v })} />
            <SliderRow label="Size" suffix="px" min={0} max={250} value={s.size} onChange={(v) => update("dropShadow", { size: v })} />
            <SliderRow label="Noise" suffix="%" min={0} max={100} value={s.noise ?? 0} onChange={(v) => update("dropShadow", { noise: v })} />
            <ContourRow value={s.contour ?? "linear"} onChange={(v) => update("dropShadow", { contour: v })} />
          </FieldGrid>
        )
      }
      case "innerShadow": {
        const s = style.innerShadow ?? defaultStyle(foreground).innerShadow!
        return (
          <FieldGrid>
            <BlendModeRow value={s.blendMode ?? "multiply"} onChange={(v) => update("innerShadow", { blendMode: v })} />
            <ColorRow label="Color" value={s.color} onChange={(v) => update("innerShadow", { color: v })} />
            <SliderRow label="Opacity" suffix="%" min={0} max={100} value={Math.round(s.opacity * 100)} onChange={(v) => update("innerShadow", { opacity: v / 100 })} />
            <CheckboxRow label="Use Global Light" checked={s.useGlobalLight ?? true} onChange={(v) => update("innerShadow", { useGlobalLight: v })} />
            <SliderRow label="Angle" suffix=" deg" min={-180} max={180} value={s.angle ?? 120} onChange={(v) => update("innerShadow", { angle: v })} />
            <SliderRow label="Distance" suffix="px" min={0} max={250} value={s.distance ?? Math.round(Math.hypot(s.offsetX, s.offsetY))} onChange={(v) => update("innerShadow", { distance: v })} />
            <SliderRow label="Choke" suffix="%" min={0} max={100} value={s.choke ?? 0} onChange={(v) => update("innerShadow", { choke: v })} />
            <SliderRow label="Size" suffix="px" min={0} max={250} value={s.size} onChange={(v) => update("innerShadow", { size: v })} />
          </FieldGrid>
        )
      }
      case "outerGlow": {
        const s = style.outerGlow ?? defaultStyle(foreground).outerGlow!
        return (
          <FieldGrid>
            <BlendModeRow value={s.blendMode ?? "screen"} onChange={(v) => update("outerGlow", { blendMode: v })} />
            <ColorRow label="Color" value={s.color} onChange={(v) => update("outerGlow", { color: v })} />
            <SliderRow label="Opacity" suffix="%" min={0} max={100} value={Math.round(s.opacity * 100)} onChange={(v) => update("outerGlow", { opacity: v / 100 })} />
            <SliderRow label="Spread" suffix="%" min={0} max={100} value={s.spread ?? 0} onChange={(v) => update("outerGlow", { spread: v })} />
            <SliderRow label="Size" suffix="px" min={1} max={250} value={s.size} onChange={(v) => update("outerGlow", { size: v })} />
            <SliderRow label="Range" suffix="%" min={1} max={100} value={s.range ?? 50} onChange={(v) => update("outerGlow", { range: v })} />
            <SliderRow label="Noise" suffix="%" min={0} max={100} value={s.noise ?? 0} onChange={(v) => update("outerGlow", { noise: v })} />
            <ContourRow value={s.contour ?? "linear"} onChange={(v) => update("outerGlow", { contour: v })} />
          </FieldGrid>
        )
      }
      case "innerGlow": {
        const s = style.innerGlow ?? defaultStyle(foreground).innerGlow!
        return (
          <FieldGrid>
            <BlendModeRow value={s.blendMode ?? "screen"} onChange={(v) => update("innerGlow", { blendMode: v })} />
            <ColorRow label="Color" value={s.color} onChange={(v) => update("innerGlow", { color: v })} />
            <SliderRow label="Opacity" suffix="%" min={0} max={100} value={Math.round(s.opacity * 100)} onChange={(v) => update("innerGlow", { opacity: v / 100 })} />
            <SelectRow
              label="Source"
              value={s.source ?? "edge"}
              options={[
                ["edge", "Edge"],
                ["center", "Center"],
              ]}
              onChange={(v) => update("innerGlow", { source: v as "edge" | "center" })}
            />
            <SliderRow label="Choke" suffix="%" min={0} max={100} value={s.choke ?? 0} onChange={(v) => update("innerGlow", { choke: v })} />
            <SliderRow label="Size" suffix="px" min={1} max={250} value={s.size} onChange={(v) => update("innerGlow", { size: v })} />
            <SliderRow label="Range" suffix="%" min={1} max={100} value={s.range ?? 50} onChange={(v) => update("innerGlow", { range: v })} />
            <SliderRow label="Noise" suffix="%" min={0} max={100} value={s.noise ?? 0} onChange={(v) => update("innerGlow", { noise: v })} />
            <ContourRow value={s.contour ?? "linear"} onChange={(v) => update("innerGlow", { contour: v })} />
          </FieldGrid>
        )
      }
      case "bevel": {
        const s = style.bevel ?? defaultStyle(foreground).bevel!
        return (
          <FieldGrid>
            <SelectRow
              label="Style"
              value={s.style}
              options={[
                ["inner", "Inner Bevel"],
                ["outer", "Outer Bevel"],
                ["emboss", "Emboss"],
                ["pillow", "Pillow Emboss"],
              ]}
              onChange={(v) => update("bevel", { style: v as typeof s.style })}
            />
            <SelectRow
              label="Direction"
              value={s.direction ?? "up"}
              options={[
                ["up", "Up"],
                ["down", "Down"],
              ]}
              onChange={(v) => update("bevel", { direction: v as "up" | "down" })}
            />
            <SliderRow label="Depth" suffix="%" min={0} max={1000} value={s.depth} onChange={(v) => update("bevel", { depth: v })} />
            <SliderRow label="Size" suffix="px" min={0} max={250} value={s.size} onChange={(v) => update("bevel", { size: v })} />
            <SliderRow label="Soften" suffix="px" min={0} max={50} value={s.soften} onChange={(v) => update("bevel", { soften: v })} />
            <CheckboxRow label="Use Global Light" checked={s.useGlobalLight ?? true} onChange={(v) => update("bevel", { useGlobalLight: v })} />
            <SliderRow label="Angle" suffix=" deg" min={-180} max={180} value={s.angle} onChange={(v) => update("bevel", { angle: v })} />
            <SliderRow label="Altitude" suffix=" deg" min={0} max={90} value={s.altitude} onChange={(v) => update("bevel", { altitude: v })} />
            <BlendModeRow label="Highlight Mode" value={s.highlightBlendMode ?? "screen"} onChange={(v) => update("bevel", { highlightBlendMode: v })} />
            <ColorRow label="Highlight Color" value={s.highlight} onChange={(v) => update("bevel", { highlight: v })} />
            <SliderRow label="Highlight Opacity" suffix="%" min={0} max={100} value={Math.round((s.highlightOpacity ?? s.opacity) * 100)} onChange={(v) => update("bevel", { highlightOpacity: v / 100 })} />
            <BlendModeRow label="Shadow Mode" value={s.shadowBlendMode ?? "multiply"} onChange={(v) => update("bevel", { shadowBlendMode: v })} />
            <ColorRow label="Shadow Color" value={s.shadow} onChange={(v) => update("bevel", { shadow: v })} />
            <SliderRow label="Shadow Opacity" suffix="%" min={0} max={100} value={Math.round((s.shadowOpacity ?? s.opacity) * 100)} onChange={(v) => update("bevel", { shadowOpacity: v / 100 })} />
            <ContourRow value={s.contour ?? "linear"} onChange={(v) => update("bevel", { contour: v })} />
          </FieldGrid>
        )
      }
      case "satin": {
        const s = style.satin ?? defaultStyle(foreground).satin!
        return (
          <FieldGrid>
            <ColorRow label="Color" value={s.color} onChange={(v) => update("satin", { color: v })} />
            <SliderRow label="Angle" suffix=" deg" min={-180} max={180} value={s.angle} onChange={(v) => update("satin", { angle: v })} />
            <SliderRow label="Distance" suffix="px" min={1} max={250} value={s.distance} onChange={(v) => update("satin", { distance: v })} />
            <SliderRow label="Size" suffix="px" min={0} max={250} value={s.size} onChange={(v) => update("satin", { size: v })} />
            <SliderRow label="Opacity" suffix="%" min={0} max={100} value={Math.round(s.opacity * 100)} onChange={(v) => update("satin", { opacity: v / 100 })} />
          </FieldGrid>
        )
      }
      case "colorOverlay": {
        const s = style.colorOverlay ?? defaultStyle(foreground).colorOverlay!
        return (
          <FieldGrid>
            <BlendModeRow value={s.blendMode ?? "normal"} onChange={(v) => update("colorOverlay", { blendMode: v })} />
            <ColorRow label="Color" value={s.color} onChange={(v) => update("colorOverlay", { color: v })} />
            <SliderRow label="Opacity" suffix="%" min={0} max={100} value={Math.round(s.opacity * 100)} onChange={(v) => update("colorOverlay", { opacity: v / 100 })} />
          </FieldGrid>
        )
      }
      case "gradientOverlay": {
        const s = style.gradientOverlay ?? defaultStyle(foreground).gradientOverlay!
        return (
          <FieldGrid>
            <BlendModeRow value={s.blendMode ?? "normal"} onChange={(v) => update("gradientOverlay", { blendMode: v })} />
            <SliderRow label="Opacity" suffix="%" min={0} max={100} value={Math.round(s.opacity * 100)} onChange={(v) => update("gradientOverlay", { opacity: v / 100 })} />
            <GradientControls gradient={s.gradient} onChange={(gradient) => update("gradientOverlay", { gradient })} />
          </FieldGrid>
        )
      }
      case "stroke": {
        const s = style.stroke ?? defaultStyle(foreground).stroke!
        return (
          <FieldGrid>
            <SelectRow
              label="Position"
              value={s.position}
              options={[
                ["inside", "Inside"],
                ["center", "Center"],
                ["outside", "Outside"],
              ]}
              onChange={(v) => update("stroke", { position: v as typeof s.position })}
            />
            <BlendModeRow value={s.blendMode ?? "normal"} onChange={(v) => update("stroke", { blendMode: v })} />
            <SliderRow label="Size" suffix="px" min={1} max={250} value={s.size} onChange={(v) => update("stroke", { size: v })} />
            <SliderRow label="Opacity" suffix="%" min={0} max={100} value={Math.round((s.opacity ?? 1) * 100)} onChange={(v) => update("stroke", { opacity: v / 100 })} />
            <SelectRow
              label="Fill Type"
              value={s.fillType ?? "color"}
              options={[
                ["color", "Color"],
                ["gradient", "Gradient"],
              ]}
              onChange={(v) => update("stroke", { fillType: v as "color" | "gradient" })}
            />
            {(s.fillType ?? "color") === "gradient" ? (
              <GradientControls gradient={s.gradient ?? defaultStyle(foreground).stroke!.gradient!} onChange={(gradient) => update("stroke", { gradient })} />
            ) : (
              <ColorRow label="Color" value={s.color} onChange={(v) => update("stroke", { color: v })} />
            )}
          </FieldGrid>
        )
      }
      case "patternOverlay": {
        const s = style.patternOverlay ?? defaultStyle(foreground).patternOverlay!
        return (
          <FieldGrid>
            <ColorRow label="Color" value={s.color ?? "#888888"} onChange={(v) => update("patternOverlay", { color: v })} />
            <SelectRow
              label="Pattern"
              value={s.pattern}
              options={[
                ["checker", "Checker"],
                ["dots", "Dots"],
                ["lines", "Lines"],
                ["noise", "Noise"],
              ]}
              onChange={(v) => update("patternOverlay", { pattern: v as typeof s.pattern })}
            />
            <SliderRow label="Scale" suffix="px" min={2} max={128} value={s.scale} onChange={(v) => update("patternOverlay", { scale: v })} />
            <SliderRow label="Opacity" suffix="%" min={0} max={100} value={Math.round(s.opacity * 100)} onChange={(v) => update("patternOverlay", { opacity: v / 100 })} />
          </FieldGrid>
        )
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Layer Style</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_150px_84px_84px] gap-2">
          <Select value={selectedPreset} onValueChange={applyPreset}>
            <SelectTrigger className="h-8 text-[11px]">
              <SelectValue placeholder="Choose preset" />
            </SelectTrigger>
            <SelectContent>
              {builtInPresets.map((preset) => (
                <SelectItem key={preset.id} value={`builtin:${preset.id}`}>{preset.name}</SelectItem>
              ))}
              {customPresets.map((preset) => (
                <SelectItem key={preset.id} value={`custom:${preset.id}`}>{preset.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            className="h-8 text-[11px]"
            placeholder="Preset name"
          />
          <Button type="button" variant="outline" onClick={savePreset} disabled={!activeDoc}>
            Save
          </Button>
          <Button type="button" variant="outline" onClick={deletePreset} disabled={!selectedPreset.startsWith("custom:")}>
            Delete
          </Button>
        </div>
        <div className="grid grid-cols-[140px_84px_96px_1fr] items-center gap-2">
          <Label className="text-[11px]">Scale Effects</Label>
          <Input
            type="number"
            min={1}
            max={400}
            value={scalePct}
            onChange={(e) => setScalePct(Math.max(1, Math.min(400, Number(e.target.value) || 100)))}
            className="h-8 text-[11px]"
          />
          <Button type="button" variant="outline" onClick={scaleEffects}>Apply Scale</Button>
          <div className="text-[10px] text-[var(--ps-text-dim)]">Scales distances, sizes, softness, stroke widths, and pattern scale.</div>
        </div>
        <div className="grid grid-cols-[210px_1fr] gap-4">
          <div className="border border-[var(--ps-divider)] rounded-sm bg-[var(--ps-panel-2)] p-1 max-h-[520px] overflow-y-auto">
            {EFFECTS.map((e) => {
              const isBlending = e.key === "blending"
              const enabled = !isBlending && !!style[e.key as EffectKey]?.enabled
              const active = tab === e.key
              return (
                <div
                  key={e.key}
                  className={
                    "flex items-center gap-2 px-2 py-1 text-[11px] rounded-sm cursor-pointer " +
                    (active ? "bg-[var(--ps-accent)] text-white" : "hover:bg-[var(--ps-tool-hover)]")
                  }
                  onClick={() => setTab(e.key)}
                >
                  {isBlending ? (
                    <span className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Checkbox
                      checked={enabled}
                      onCheckedChange={(v) =>
                        update(e.key as EffectKey, { enabled: v === true } as Partial<NonNullable<LayerStyle[EffectKey]>>)
                      }
                      onClick={(ev) => ev.stopPropagation()}
                      className="h-3.5 w-3.5"
                    />
                  )}
                  <span>{e.label}</span>
                </div>
              )
            })}
          </div>
          <div className="border border-[var(--ps-divider)] rounded-sm bg-[var(--ps-panel-2)] p-3 max-h-[520px] overflow-y-auto">
            {renderEffectFields()}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={reset} className="mr-auto">
            Clear All
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!activeLayer}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function mergeStyle(base: LayerStyle, incoming: LayerStyle | undefined) {
  if (!incoming) return base
  const next: Partial<import("./types").LayerStyle> = { ...base }
  for (const { key } of EFFECTS) {
    if (key === "blending") continue
    const current = (incoming as Record<string, unknown>)[key]
    if (!current) continue
    next[key] = mergeEffect((base as Record<string, unknown>)[key] as Record<string, unknown>, current as Record<string, unknown>) as any
  }
  return next as LayerStyle
}

function mergeEffect(base: Record<string, unknown>, patch: Record<string, unknown>) {
  const next: Record<string, unknown> = { ...(base ?? {}), ...(patch ?? {}) }
  if (base?.gradient || patch?.gradient) {
    const bg = base?.gradient as Record<string, unknown> | undefined
    const pg = patch?.gradient as Record<string, unknown> | undefined
    next.gradient = { ...(bg ?? {}), ...(pg ?? {}) }
    if (bg?.stops || pg?.stops) {
      (next.gradient as Record<string, unknown>).stops = pg?.stops ?? bg?.stops
    }
  }
  return next
}

function cloneStyle(style: LayerStyle): LayerStyle {
  if (typeof structuredClone === "function") return structuredClone(style)
  return JSON.parse(JSON.stringify(style))
}

function builtInStylePresets(color: string): { id: string; name: string; style: LayerStyle }[] {
  const base = () => defaultStyle(color)
  const make = (id: string, name: string, patch: Partial<LayerStyle>) => ({
    id,
    name,
    style: mergeStyle(base(), patch as LayerStyle),
  })
  return [
    make("neon", "Neon Glow", {
      outerGlow: { enabled: true, color: "#00e5ff", size: 28, opacity: 0.9, blendMode: "screen", spread: 8, range: 70, noise: 0 },
      innerGlow: { enabled: true, color: "#ffffff", size: 8, opacity: 0.65, blendMode: "screen", source: "edge", choke: 0, range: 60, noise: 0 },
    }),
    make("gold", "Polished Gold", {
      bevel: { enabled: true, style: "inner", direction: "up", depth: 260, size: 8, soften: 1, angle: 120, altitude: 35, highlight: "#fff4b0", shadow: "#5f3400", opacity: 0.8, highlightOpacity: 0.95, shadowOpacity: 0.75, highlightBlendMode: "screen", shadowBlendMode: "multiply", useGlobalLight: true },
      gradientOverlay: { enabled: true, opacity: 1, blendMode: "normal", gradient: { type: "linear", angle: 90, stops: [{ offset: 0, color: "#7a3f00", opacity: 1 }, { offset: 0.5, color: "#ffd86b", opacity: 1 }, { offset: 1, color: "#9f6500", opacity: 1 }] } },
    }),
    make("chrome", "Chrome", {
      bevel: { enabled: true, style: "inner", direction: "up", depth: 360, size: 7, soften: 0, angle: 120, altitude: 45, highlight: "#ffffff", shadow: "#111827", opacity: 0.9, highlightOpacity: 1, shadowOpacity: 0.8, highlightBlendMode: "screen", shadowBlendMode: "multiply", useGlobalLight: true },
      gradientOverlay: { enabled: true, opacity: 1, blendMode: "normal", gradient: { type: "linear", angle: 90, stops: [{ offset: 0, color: "#f8fafc", opacity: 1 }, { offset: 0.25, color: "#64748b", opacity: 1 }, { offset: 0.5, color: "#ffffff", opacity: 1 }, { offset: 0.75, color: "#334155", opacity: 1 }, { offset: 1, color: "#f8fafc", opacity: 1 }] } },
    }),
    make("glass", "Clear Glass", {
      innerGlow: { enabled: true, color: "#ffffff", size: 16, opacity: 0.45, blendMode: "screen", source: "edge", choke: 8, range: 80, noise: 0 },
      stroke: { enabled: true, color: "#dbeafe", size: 2, position: "inside", opacity: 0.7, blendMode: "screen", fillType: "color" },
    }),
    make("plastic", "Soft Plastic", {
      bevel: { enabled: true, style: "inner", direction: "up", depth: 120, size: 10, soften: 4, angle: 120, altitude: 30, highlight: "#ffffff", shadow: "#1f2937", opacity: 0.65, highlightOpacity: 0.8, shadowOpacity: 0.45, highlightBlendMode: "screen", shadowBlendMode: "multiply", useGlobalLight: true },
      innerShadow: { enabled: true, color: "#000000", size: 12, offsetX: 2, offsetY: 2, opacity: 0.22, blendMode: "multiply", angle: 120, distance: 2, choke: 0, useGlobalLight: true },
    }),
    make("emboss", "Paper Emboss", {
      bevel: { enabled: true, style: "emboss", direction: "up", depth: 90, size: 5, soften: 2, angle: 120, altitude: 25, highlight: "#ffffff", shadow: "#94a3b8", opacity: 0.7, highlightOpacity: 0.65, shadowOpacity: 0.45, highlightBlendMode: "screen", shadowBlendMode: "multiply", useGlobalLight: true },
    }),
    make("sticker", "Sticker Edge", {
      stroke: { enabled: true, color: "#ffffff", size: 10, position: "outside", opacity: 1, blendMode: "normal", fillType: "color" },
      dropShadow: { enabled: true, color: "#000000", size: 16, offsetX: 0, offsetY: 8, opacity: 0.35, blendMode: "multiply", angle: 90, distance: 8, spread: 0, noise: 0, useGlobalLight: false },
    }),
    make("shadow-card", "Soft Shadow", {
      dropShadow: { enabled: true, color: "#000000", size: 24, offsetX: 0, offsetY: 12, opacity: 0.28, blendMode: "multiply", angle: 90, distance: 12, spread: 0, noise: 0, useGlobalLight: false },
    }),
    make("red-glow", "Red Alert Glow", {
      outerGlow: { enabled: true, color: "#ef4444", size: 30, opacity: 0.85, blendMode: "screen", spread: 12, range: 65, noise: 0 },
      colorOverlay: { enabled: true, color: "#fee2e2", opacity: 0.18, blendMode: "screen" },
    }),
    make("blueprint", "Blueprint Line", {
      stroke: { enabled: true, color: "#38bdf8", size: 3, position: "center", opacity: 1, blendMode: "screen", fillType: "color" },
      outerGlow: { enabled: true, color: "#0ea5e9", size: 10, opacity: 0.45, blendMode: "screen", spread: 0, range: 50, noise: 0 },
    }),
  ]
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3">{children}</div>
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-[11px]">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-12 rounded-sm border border-[var(--ps-divider)] bg-transparent"
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-[11px] h-8" />
      </div>
    </div>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  suffix?: string
  onChange: (v: number) => void
}) {
  const rounded = Math.round(value)
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-[11px]">{label}</Label>
        <span className="text-[11px] tabular-nums text-[var(--ps-text-dim)]">
          {rounded}
          {suffix ?? ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={rounded}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  )
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: [string, string][]
  onChange: (v: string) => void
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-[11px]">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([id, label]) => (
            <SelectItem key={id} value={id}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-[11px]">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} className="h-3.5 w-3.5" />
      {label}
    </label>
  )
}

function BlendIfControls({
  label,
  range,
  onChange,
}: {
  label: string
  range: BlendIfRange
  onChange: (range: BlendIfRange) => void
}) {
  return (
    <div className="grid gap-2 rounded-sm border border-[var(--ps-divider)] p-2">
      <div className="text-[11px] font-medium">{label}</div>
      <SliderRow
        label="Black"
        min={0}
        max={255}
        value={range.black}
        onChange={(v) => onChange(setBlendIfRangeHandle(range, "black", v, { split: false }))}
      />
      <SliderRow
        label="Black Split"
        min={0}
        max={255}
        value={range.blackFeather}
        onChange={(v) => onChange(setBlendIfRangeHandle(range, "blackFeather", v))}
      />
      <SliderRow
        label="White Split"
        min={0}
        max={255}
        value={range.whiteFeather}
        onChange={(v) => onChange(setBlendIfRangeHandle(range, "whiteFeather", v))}
      />
      <SliderRow
        label="White"
        min={0}
        max={255}
        value={range.white}
        onChange={(v) => onChange(setBlendIfRangeHandle(range, "white", v, { split: false }))}
      />
    </div>
  )
}

function BlendModeRow({
  label = "Blend Mode",
  value,
  onChange,
}: {
  label?: string
  value: BlendMode
  onChange: (v: BlendMode) => void
}) {
  return (
    <SelectRow
      label={label}
      value={value}
      options={BLEND_OPTIONS.map((b) => [b, titleCaseBlend(b)])}
      onChange={(v) => onChange(v as BlendMode)}
    />
  )
}

function ContourRow({
  value,
  onChange,
}: {
  value: (typeof CONTOURS)[number]
  onChange: (v: (typeof CONTOURS)[number]) => void
}) {
  return (
    <SelectRow
      label="Contour"
      value={value}
      options={CONTOURS.map((contour) => [contour, titleCaseBlend(contour)])}
      onChange={(v) => onChange(v as (typeof CONTOURS)[number])}
    />
  )
}

function scaleLayerStyle(style: LayerStyle, factor: number): LayerStyle {
  const scaleNumber = (value: number | undefined) => (value === undefined ? value : Math.max(0, Math.round(value * factor)))
  const next = cloneStyle(style)
  if (next.dropShadow) {
    next.dropShadow.size = scaleNumber(next.dropShadow.size) ?? next.dropShadow.size
    next.dropShadow.distance = scaleNumber(next.dropShadow.distance)
    next.dropShadow.offsetX = scaleNumber(next.dropShadow.offsetX) ?? next.dropShadow.offsetX
    next.dropShadow.offsetY = scaleNumber(next.dropShadow.offsetY) ?? next.dropShadow.offsetY
  }
  if (next.innerShadow) {
    next.innerShadow.size = scaleNumber(next.innerShadow.size) ?? next.innerShadow.size
    next.innerShadow.distance = scaleNumber(next.innerShadow.distance)
    next.innerShadow.offsetX = scaleNumber(next.innerShadow.offsetX) ?? next.innerShadow.offsetX
    next.innerShadow.offsetY = scaleNumber(next.innerShadow.offsetY) ?? next.innerShadow.offsetY
  }
  if (next.outerGlow) next.outerGlow.size = scaleNumber(next.outerGlow.size) ?? next.outerGlow.size
  if (next.innerGlow) next.innerGlow.size = scaleNumber(next.innerGlow.size) ?? next.innerGlow.size
  if (next.bevel) {
    next.bevel.size = scaleNumber(next.bevel.size) ?? next.bevel.size
    next.bevel.soften = scaleNumber(next.bevel.soften) ?? next.bevel.soften
  }
  if (next.satin) {
    next.satin.distance = scaleNumber(next.satin.distance) ?? next.satin.distance
    next.satin.size = scaleNumber(next.satin.size) ?? next.satin.size
  }
  if (next.stroke) next.stroke.size = scaleNumber(next.stroke.size) ?? next.stroke.size
  if (next.patternOverlay) next.patternOverlay.scale = scaleNumber(next.patternOverlay.scale) ?? next.patternOverlay.scale
  return next
}

function GradientControls({
  gradient,
  onChange,
}: {
  gradient: MultiGradient
  onChange: (gradient: MultiGradient) => void
}) {
  return (
    <>
      <SelectRow
        label="Gradient Type"
        value={gradient.type}
        options={GRADIENT_TYPES.map((t) => [t, titleCaseBlend(t)])}
        onChange={(v) => onChange({ ...gradient, type: v as MultiGradient["type"] })}
      />
      <SliderRow label="Angle" suffix=" deg" min={-180} max={180} value={gradient.angle} onChange={(v) => onChange({ ...gradient, angle: v })} />
      <GradientStopsRow stops={gradient.stops} onChange={(stops) => onChange({ ...gradient, stops })} />
    </>
  )
}

function GradientStopsRow({
  stops,
  onChange,
}: {
  stops: GradientStop[]
  onChange: (stops: GradientStop[]) => void
}) {
  const safeStops = stops.length >= 2 ? stops : [
    { offset: 0, color: "#000000", opacity: 1 },
    { offset: 1, color: "#ffffff", opacity: 1 },
  ]
  const addStop = () => {
    const last = safeStops[safeStops.length - 1]
    const second = safeStops[safeStops.length - 2] ?? safeStops[0]
    const offset = (last.offset + second.offset) / 2
    const next = [...safeStops, { offset, color: last.color, opacity: 1 }].sort((a, b) => a.offset - b.offset)
    onChange(next)
  }
  const removeStop = (idx: number) => {
    if (safeStops.length <= 2) return
    onChange(safeStops.filter((_, i) => i !== idx))
  }
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-[11px]">Color Stops</Label>
        <button
          type="button"
          onClick={addStop}
          className="text-[10px] px-2 py-0.5 border border-[var(--ps-divider)] rounded-sm hover:bg-[var(--ps-tool-hover)]"
        >
          Add Stop
        </button>
      </div>
      <div className="relative h-6 rounded-sm border border-[var(--ps-divider)] overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(90deg, ${safeStops
              .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
              .join(", ")})`,
          }}
        />
      </div>
      <div className="grid gap-1">
        {safeStops.map((s, i) => (
          <div key={i} className="grid grid-cols-[32px_1fr_42px_18px] items-center gap-2 text-[11px]">
            <input
              type="color"
              value={s.color}
              onChange={(e) => {
                const next = safeStops.slice()
                next[i] = { ...s, color: e.target.value }
                onChange(next)
              }}
              className="h-6 w-8 rounded-sm border border-[var(--ps-divider)] bg-transparent"
            />
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(s.offset * 100)}
              onChange={(e) => {
                const next = safeStops.slice()
                next[i] = { ...s, offset: Number(e.target.value) / 100 }
                onChange(next.sort((a, b) => a.offset - b.offset))
              }}
              className="w-full"
            />
            <span className="tabular-nums text-right">{Math.round(s.offset * 100)}%</span>
            <button
              type="button"
              onClick={() => removeStop(i)}
              className="text-[var(--ps-text-dim)] hover:text-[var(--ps-text)] disabled:opacity-30"
              disabled={safeStops.length <= 2}
              aria-label="Remove stop"
            >
              x
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function titleCaseBlend(value: string) {
  return value
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ")
}
