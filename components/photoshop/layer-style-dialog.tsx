"use client"

import * as React from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useEditorSelector } from "@/components/photoshop/editor/context"
import { defaultStyle } from "@/editor/layer-styles"
import {
  defaultAdvancedBlending,
  getBlendIfRangeForChannel,
  normalizeAdvancedBlending,
  setBlendIfRangeForChannel,
} from "@/editor/layer-workflows"
import {
  builtInStylePresets,
  cloneStyle,
  EFFECTS,
  mergeEffect,
  mergeStyle,
  scaleLayerStyle,
  type EffectKey,
  type StyleKey,
} from "@/editor/document/layer-style-helpers"
import {
  CheckboxRow,
  ColorRow,
  ContourRow,
  FieldGrid,
  SelectRow,
  SliderRow,
  BlendModeRow,
} from "@/components/photoshop/layer-style-controls"
import { BlendIfChannelSelector, BlendIfControls } from "@/components/photoshop/layer-style-blend-if"
import { GradientControls } from "@/components/photoshop/layer-style-gradient"
import type { AdvancedBlending, LayerStyle } from "@/editor/types"

export function LayerStyleDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const activeDoc = useEditorSelector((editor) => editor.activeDoc)
  const activeLayer = useEditorSelector((editor) => editor.activeLayer)
  const foreground = useEditorSelector((editor) => editor.foreground)
  const dispatch = useEditorSelector((editor) => editor.dispatch)
  const commit = useEditorSelector((editor) => editor.commit)
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
            <BlendIfChannelSelector
              value={advanced.blendIfActiveChannel ?? "gray"}
              onChange={(channel) => setAdvanced((current) => ({ ...current, blendIfActiveChannel: channel }))}
            />
            <BlendIfControls
              label="Blend If: This Layer"
              channel={advanced.blendIfActiveChannel ?? "gray"}
              range={getBlendIfRangeForChannel(advanced, "this", advanced.blendIfActiveChannel ?? "gray")}
              onChange={(range) =>
                setAdvanced((current) =>
                  setBlendIfRangeForChannel(current, "this", current.blendIfActiveChannel ?? "gray", range),
                )
              }
            />
            <BlendIfControls
              label="Blend If: Underlying Layer"
              channel={advanced.blendIfActiveChannel ?? "gray"}
              range={getBlendIfRangeForChannel(advanced, "underlying", advanced.blendIfActiveChannel ?? "gray")}
              onChange={(range) =>
                setAdvanced((current) =>
                  setBlendIfRangeForChannel(current, "underlying", current.blendIfActiveChannel ?? "gray", range),
                )
              }
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
