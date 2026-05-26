"use client"

import * as React from "react"
import { useEditor } from "../editor-context"
import { rasterizeText } from "../tool-helpers"
import type { TextAntiAliasMode } from "../types"
import {
  applyVariableFontNamedInstance,
  buildVariableFontAxisControlModel,
  DEFAULT_VARIABLE_AXIS_DEFINITIONS,
  detectOpenTypeFeatureSupport,
  findEmbeddedFontForFamily,
  inspectVariableFont,
  listOpenTypeFeatureToggles,
  type OpenTypeFeatureSupport,
  type VariableFontInspection,
} from "../typography-engine"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Superscript,
  Subscript,
  CaseLower,
  CaseUpper,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
} from "lucide-react"

const PARAGRAPH_ALIGNMENT_CONTROLS = [
  { id: "left", label: "Align left" },
  { id: "center", label: "Align center" },
  { id: "right", label: "Align right" },
  { id: "justify-left", label: "Justify left" },
  { id: "justify-center", label: "Justify center" },
  { id: "justify-right", label: "Justify right" },
  { id: "justify-all", label: "Justify all" },
] as const

export function CharacterPanel() {
  const { activeDoc, activeLayer, dispatch, requestRender, commit } = useEditor()
  const text = activeLayer?.kind === "text" ? activeLayer.text : null
  const textFont = text?.font
  const embeddedFont = text ? text.embeddedFont ?? findEmbeddedFontForFamily(activeDoc?.assetLibrary, text.font) : undefined
  const [fontInspection, setFontInspection] = React.useState<VariableFontInspection | null>(null)
  const [featureSupport, setFeatureSupport] = React.useState<OpenTypeFeatureSupport | null>(null)
  const [customAxisTag, setCustomAxisTag] = React.useState("")

  const update = (patch: Partial<NonNullable<typeof text>>) => {
    if (!activeLayer || !text) return
    const next = { ...text, ...patch }
    dispatch({ type: "set-layer-text", id: activeLayer.id, text: next })
    rasterizeText(activeLayer.canvas, next)
    requestRender()
  }

  const commitChange = (label: string) => {
    if (activeLayer) commit(label, [activeLayer.id])
  }
  const updateAxis = (tag: string, value: number) => {
    update({ variableAxes: { ...(text?.variableAxes ?? {}), [tag]: value } })
  }
  const resetAxis = (tag: string, value: number) => {
    updateAxis(tag, value)
    commitChange(`Reset Variable ${tag}`)
  }
  const addCustomAxis = () => {
    if (!text) return
    const tag = customAxisTag.trim().slice(0, 4)
    if (!/^[A-Za-z0-9]{4}$/.test(tag)) return
    update({
      variableAxes: { ...(text.variableAxes ?? {}), [tag]: text.variableAxes?.[tag] ?? 0 },
      variableAxisDefinitions: [
        ...(text.variableAxisDefinitions ?? []),
        { tag, name: tag.toUpperCase(), min: -1000, max: 1000, defaultValue: 0 },
      ].filter((axis, index, all) => all.findIndex((candidate) => candidate.tag === axis.tag) === index),
    })
    setCustomAxisTag("")
    commitChange(`Add Variable Axis ${tag}`)
  }
  const applyNamedInstance = (name: string) => {
    if (!text || !name) {
      update({ variableNamedInstance: undefined })
      return
    }
    const instance = fontInspection?.namedInstances.find((item) => item.name === name)
    if (!instance) return
    update(applyVariableFontNamedInstance(text, instance, fontInspection?.axes.length ? fontInspection.axes : text.variableAxisDefinitions))
    commitChange(`Variable Font ${instance.name}`)
  }
  const inspectActiveFont = async (allowLocalFontAccess = false) => {
    if (!text) return
    const inspection = await inspectVariableFont(text.font, { allowLocalFontAccess, embeddedFont })
    setFontInspection(inspection)
    if (inspection.axes.length && allowLocalFontAccess) {
      update({ variableAxisDefinitions: inspection.axes })
      commitChange("Inspect Variable Font")
    }
  }

  React.useEffect(() => {
    if (!textFont) {
      setFontInspection(null)
      setFeatureSupport(null)
      return
    }
    setFeatureSupport(detectOpenTypeFeatureSupport(textFont, { embeddedFont }))
    let cancelled = false
    inspectVariableFont(textFont, { embeddedFont }).then((inspection) => {
      if (!cancelled) setFontInspection(inspection)
    })
    return () => {
      cancelled = true
    }
  }, [textFont, embeddedFont])

  const axisModel = React.useMemo(
    () => text ? buildVariableFontAxisControlModel(text, fontInspection) : null,
    [text, fontInspection],
  )

  if (!text) {
    return (
      <div className="p-3 text-[11px] text-[var(--ps-text-dim)] text-center">
        Select a text layer to edit character properties.
      </div>
    )
  }

  const axisDefinitions = axisModel?.axes.length ? axisModel.axes : DEFAULT_VARIABLE_AXIS_DEFINITIONS.map((axis) => ({ ...axis, value: text.variableAxes?.[axis.tag] ?? axis.defaultValue, source: "default" as const }))
  const supportedTags = featureSupport?.supportedTags
  const openTypeToggles = listOpenTypeFeatureToggles(supportedTags?.size ? { supportedTags } : {})

  return (
    <div data-testid="typography-character-panel" className="overflow-y-auto text-[11px]">
      {/* Font and Size row */}
      <div className="px-3 py-2 border-b border-[var(--ps-divider)] space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-[var(--ps-text-dim)]">Font</label>
            <select
              value={text.font}
              onChange={(e) => { update({ font: e.target.value }); commitChange("Font") }}
              className="w-full h-6 bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] rounded-sm px-1 text-[11px]"
            >
              {["Arial", "Helvetica", "Times New Roman", "Georgia", "Verdana", "Courier New", "Impact", "Comic Sans MS", "Trebuchet MS", "Palatino"].map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[var(--ps-text-dim)]">Size</label>
            <input
              type="number"
              value={text.size}
              min={1}
              max={1296}
              onChange={(e) => update({ size: Math.max(1, Number(e.target.value) || 12) })}
              onBlur={() => commitChange("Font Size")}
              className="w-full h-6 bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] rounded-sm px-1 text-[11px] tabular-nums"
            />
          </div>
        </div>

        {/* Style buttons row */}
        <div className="flex items-center gap-1">
          <StyleBtn title="Bold" active={text.weight === "bold"} onClick={() => { update({ weight: text.weight === "bold" ? "normal" : "bold" }); commitChange("Bold") }}>
            <Bold className="w-3 h-3" />
          </StyleBtn>
          <StyleBtn title="Italic" active={text.italic} onClick={() => { update({ italic: !text.italic }); commitChange("Italic") }}>
            <Italic className="w-3 h-3" />
          </StyleBtn>
          <StyleBtn title="Underline" active={text.underline === true} onClick={() => { update({ underline: !text.underline }); commitChange("Underline") }}>
            <Underline className="w-3 h-3" />
          </StyleBtn>
          <StyleBtn title="Strikethrough" active={text.strikethrough === true} onClick={() => { update({ strikethrough: !text.strikethrough }); commitChange("Strikethrough") }}>
            <Strikethrough className="w-3 h-3" />
          </StyleBtn>
          <div className="w-px h-4 bg-[var(--ps-divider)] mx-0.5" />
          <StyleBtn title="All Caps" active={text.allCaps === true} onClick={() => { update({ allCaps: !text.allCaps, smallCaps: false }); commitChange("All Caps") }}>
            <CaseUpper className="w-3 h-3" />
          </StyleBtn>
          <StyleBtn title="Small Caps" active={text.smallCaps === true} onClick={() => { update({ smallCaps: !text.smallCaps, allCaps: false }); commitChange("Small Caps") }}>
            <CaseLower className="w-3 h-3" />
          </StyleBtn>
          <div className="w-px h-4 bg-[var(--ps-divider)] mx-0.5" />
          <StyleBtn title="Superscript" active={text.superscript === true} onClick={() => { update({ superscript: !text.superscript, subscript: false }); commitChange("Superscript") }}>
            <Superscript className="w-3 h-3" />
          </StyleBtn>
          <StyleBtn title="Subscript" active={text.subscript === true} onClick={() => { update({ subscript: !text.subscript, superscript: false }); commitChange("Subscript") }}>
            <Subscript className="w-3 h-3" />
          </StyleBtn>
        </div>

        {/* Color */}
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-[var(--ps-text-dim)] w-10">Color</label>
          <input
            type="color"
            value={text.color}
            onChange={(e) => update({ color: e.target.value })}
            onBlur={() => commitChange("Text Color")}
            className="w-6 h-6 cursor-pointer border border-[var(--ps-divider)] rounded-sm"
          />
          <span className="text-[10px] tabular-nums">{text.color}</span>
        </div>
      </div>

      {/* Tracking */}
      <div className="px-3 py-2 border-b border-[var(--ps-divider)] space-y-2">
        <CharSlider
          label="Tracking"
          value={text.tracking ?? 0}
          min={-200}
          max={500}
          suffix="/1000 em"
          onChange={(v) => update({ tracking: v })}
          onCommit={() => commitChange("Tracking")}
        />
        {/* Leading */}
        <CharSlider
          label="Leading"
          value={text.leading ?? Math.round(text.size * 1.2)}
          min={1}
          max={500}
          suffix="px"
          onChange={(v) => update({ leading: v })}
          onCommit={() => commitChange("Leading")}
        />
        {/* Kerning */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[var(--ps-text-dim)]">Kerning</span>
            <select
              value={typeof text.kerning === "number" ? "manual" : text.kerning ?? "metrics"}
              onChange={(e) => {
                const v = e.target.value
                if (v === "manual") update({ kerning: 0 })
                else update({ kerning: v as "metrics" | "optical" })
                commitChange("Kerning")
              }}
              className="h-5 bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] rounded-sm px-1 text-[10px]"
            >
              <option value="metrics">Metrics</option>
              <option value="optical">Optical</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          {typeof text.kerning === "number" && (
            <Slider
              min={-200}
              max={500}
              step={5}
              value={[text.kerning]}
              onValueChange={(v) => update({ kerning: v[0] })}
              onValueCommit={() => commitChange("Kerning")}
            />
          )}
        </div>
        {/* Baseline Shift */}
        <CharSlider
          label="Baseline Shift"
          value={text.baselineShift ?? 0}
          min={-72}
          max={72}
          suffix="px"
          onChange={(v) => update({ baselineShift: v })}
          onCommit={() => commitChange("Baseline Shift")}
        />
      </div>

      <section
        data-testid="type-variable-font-surface"
        data-density="compact-polished"
        aria-label="Variable font controls"
        className="border-b border-[var(--ps-divider)] px-2 py-2"
      >
        <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="flex items-start justify-between gap-2 border-b border-[var(--ps-divider)] bg-[rgba(255,255,255,0.025)] px-2 py-1.5">
            <div className="min-w-0">
              <label className="block text-[10px] font-medium text-[var(--ps-text)]">Variable Font Axes</label>
              {axisModel ? (
                <p className="mt-0.5 truncate text-[9px] leading-snug text-[var(--ps-text-dim)]">{axisModel.status}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (!text) return
                  update({
                    variableAxes: Object.fromEntries(axisDefinitions.map((axis) => [axis.tag, axis.defaultValue])),
                    variableNamedInstance: undefined,
                  })
                  commitChange("Reset Variable Axes")
                }}
                className="h-5 rounded-sm border border-[var(--ps-divider)] px-1.5 text-[9px] hover:bg-[var(--ps-tool-hover)]"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => void inspectActiveFont(true)}
                className="h-5 rounded-sm border border-[var(--ps-divider)] px-1.5 text-[9px] hover:bg-[var(--ps-tool-hover)]"
                title="Inspect the local font file for real variation axes and named instances"
              >
                Inspect
              </button>
            </div>
          </div>
          <div className="space-y-2 p-2">
            {axisModel?.namedInstances.length ? (
              <label className="grid gap-1 text-[10px] text-[var(--ps-text-dim)]">
                Instance
                <select
                  value={text.variableNamedInstance ?? ""}
                  onChange={(e) => applyNamedInstance(e.target.value)}
                  className="h-6 bg-[var(--ps-panel)] border border-[var(--ps-divider)] rounded-sm px-1 text-[10px]"
                >
                  <option value="">Custom</option>
                  {axisModel.namedInstances.map((instance) => (
                    <option key={instance.name} value={instance.name}>{instance.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {axisDefinitions.map((axis) => (
              <div key={axis.tag} className="space-y-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-1.5">
                <CharSlider
                  label={`${axis.name} (${axis.tag})`}
                  value={axis.value}
                  min={axis.min}
                  max={axis.max}
                  step={Math.abs(axis.max - axis.min) <= 4 ? 0.01 : 1}
                  onChange={(v) => updateAxis(axis.tag, v)}
                  onCommit={() => commitChange(`Variable ${axis.name}`)}
                />
                <div className="flex items-center justify-between gap-2 text-[9px] text-[var(--ps-text-dim)]">
                  <span className="truncate">{axis.source} · {axis.min} / {axis.defaultValue} / {axis.max}</span>
                  <button
                    type="button"
                    onClick={() => resetAxis(axis.tag, axis.defaultValue)}
                    className="shrink-0 rounded-sm border border-[var(--ps-divider)] px-1 hover:bg-[var(--ps-tool-hover)]"
                  >
                    Default
                  </button>
                </div>
              </div>
            ))}
            <div className="grid grid-cols-[1fr_52px] gap-1">
              <input
                value={customAxisTag}
                maxLength={4}
                onChange={(e) => setCustomAxisTag(e.target.value)}
                placeholder="Axis tag"
                className="h-6 min-w-0 bg-[var(--ps-panel)] border border-[var(--ps-divider)] rounded-sm px-1 text-[10px]"
              />
              <button
                type="button"
                onClick={addCustomAxis}
                className="h-6 rounded-sm border border-[var(--ps-divider)] text-[10px] hover:bg-[var(--ps-tool-hover)]"
              >
                Add
              </button>
            </div>
            {fontInspection?.error ? (
              <p className="text-[9px] leading-snug text-amber-300">{fontInspection.error}</p>
            ) : !axisModel?.axes.length ? (
              <p className="text-[9px] leading-snug text-[var(--ps-text-dim)]">
                No variable axes are known for this font yet.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section
        data-testid="type-opentype-surface"
        data-density="compact-polished"
        aria-label="OpenType feature controls"
        className="border-b border-[var(--ps-divider)] px-2 py-2"
      >
        <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--ps-divider)] bg-[rgba(255,255,255,0.025)] px-2 py-1.5">
            <label className="text-[10px] font-medium text-[var(--ps-text)]">OpenType</label>
            <span className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-1.5 py-0.5 text-[9px] text-[var(--ps-text-dim)]">
              {openTypeToggles.length} features
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1 p-2">
            {openTypeToggles.map((toggle) => {
              const checked = text.openType?.[toggle.key] ?? (text as unknown as Record<string, boolean | undefined>)[toggle.key] ?? toggle.defaultEnabled
              return (
                <CheckRow
                  key={toggle.tag}
                  label={toggle.label}
                  checked={!!checked}
                  onChange={(v) => {
                    update({ openType: { ...(text.openType ?? {}), [toggle.key]: v } })
                    commitChange(toggle.label)
                  }}
                />
              )
            })}
          </div>
        </div>
      </section>

      <section
        data-testid="type-vertical-surface"
        data-density="compact-polished"
        aria-label="Vertical type controls"
        className="border-b border-[var(--ps-divider)] px-2 py-2"
      >
        <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="border-b border-[var(--ps-divider)] bg-[rgba(255,255,255,0.025)] px-2 py-1.5">
            <label className="text-[10px] font-medium text-[var(--ps-text)]">Vertical Type</label>
          </div>
          <div className="space-y-2 p-2">
            <div className="grid grid-cols-2 gap-2">
              <select
                value={text.vertical ? (text.verticalWritingMode === "lr" ? "vertical-lr" : "vertical-rl") : "horizontal"}
                onChange={(e) => {
                  const value = e.target.value
                  update({
                    vertical: value !== "horizontal",
                    verticalWritingMode: value === "vertical-lr" ? "lr" : "rl",
                  })
                  commitChange("Writing Mode")
                }}
                className="h-6 min-w-0 bg-[var(--ps-panel)] border border-[var(--ps-divider)] rounded-sm px-1 text-[10px]"
              >
                <option value="horizontal">Horizontal</option>
                <option value="vertical-rl">Vertical RL</option>
                <option value="vertical-lr">Vertical LR</option>
              </select>
              <select
                value={text.mojikumi ?? "default"}
                onChange={(e) => {
                  update({ mojikumi: e.target.value as NonNullable<typeof text>["mojikumi"] })
                  commitChange("Mojikumi")
                }}
                className="h-6 min-w-0 bg-[var(--ps-panel)] border border-[var(--ps-divider)] rounded-sm px-1 text-[10px]"
              >
                <option value="default">Default</option>
                <option value="compact">Compact</option>
                <option value="loose">Loose</option>
                <option value="none">None</option>
              </select>
              <select
                value={text.textOrientation ?? (text.tateChuYoko ? "mixed" : "upright")}
                onChange={(e) => {
                  update({ textOrientation: e.target.value as NonNullable<typeof text>["textOrientation"] })
                  commitChange("Text Orientation")
                }}
                className="h-6 min-w-0 bg-[var(--ps-panel)] border border-[var(--ps-divider)] rounded-sm px-1 text-[10px]"
              >
                <option value="mixed">Mixed</option>
                <option value="upright">Upright</option>
                <option value="sideways">Sideways</option>
              </select>
              <select
                value={text.verticalAlign ?? "top"}
                onChange={(e) => {
                  update({ verticalAlign: e.target.value as NonNullable<typeof text>["verticalAlign"] })
                  commitChange("Vertical Align")
                }}
                className="h-6 min-w-0 bg-[var(--ps-panel)] border border-[var(--ps-divider)] rounded-sm px-1 text-[10px]"
              >
                <option value="top">Top</option>
                <option value="middle">Middle</option>
                <option value="bottom">Bottom</option>
              </select>
            </div>
            <CheckRow label="Tate Chu Yoko" checked={text.tateChuYoko === true} onChange={(v) => { update({ tateChuYoko: v }); commitChange("Tate Chu Yoko") }} />
            <CharSlider
              label="Column Gap"
              value={text.verticalColumnGap ?? Math.round(text.leading ?? text.size * 1.2)}
              min={0}
              max={300}
              suffix="px"
              onChange={(v) => update({ verticalColumnGap: v })}
              onCommit={() => commitChange("Vertical Column Gap")}
            />
            <CharSlider
              label="Glyph Spacing"
              value={text.verticalGlyphSpacing ?? 0}
              min={-40}
              max={120}
              suffix="px"
              onChange={(v) => update({ verticalGlyphSpacing: v })}
              onCommit={() => commitChange("Vertical Glyph Spacing")}
            />
            <CharSlider
              label="Glyph Scale"
              value={Math.round((text.verticalGlyphScale ?? 1) * 100)}
              min={25}
              max={200}
              suffix="%"
              onChange={(v) => update({ verticalGlyphScale: v / 100 })}
              onCommit={() => commitChange("Vertical Glyph Scale")}
            />
            <CheckRow label="Proportional vertical metrics" checked={text.verticalUseProportionalMetrics === true} onChange={(v) => { update({ verticalUseProportionalMetrics: v }); commitChange("Vertical Metrics") }} />
          </div>
        </div>
      </section>

      <div className="px-3 py-2">
        <label className="text-[10px] text-[var(--ps-text-dim)]">Anti-Alias</label>
        <select
          value={text.antiAlias === false ? "none" : text.antiAliasMode ?? "smooth"}
          onChange={(e) => {
            const mode = e.target.value as TextAntiAliasMode
            update({ antiAliasMode: mode, antiAlias: mode !== "none" })
            commitChange("Anti-Alias")
          }}
          className="mt-1 w-full h-6 bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] rounded-sm px-1 text-[11px]"
        >
          <option value="none">None</option>
          <option value="sharp">Sharp</option>
          <option value="crisp">Crisp</option>
          <option value="strong">Strong</option>
          <option value="smooth">Smooth</option>
        </select>
      </div>
    </div>
  )
}

export function ParagraphPanel() {
  const { activeLayer, dispatch, requestRender, commit } = useEditor()
  const text = activeLayer?.kind === "text" ? activeLayer.text : null

  const update = (patch: Partial<NonNullable<typeof text>>) => {
    if (!activeLayer || !text) return
    const next = { ...text, ...patch }
    dispatch({ type: "set-layer-text", id: activeLayer.id, text: next })
    rasterizeText(activeLayer.canvas, next)
    requestRender()
  }

  const commitChange = (label: string) => {
    if (activeLayer) commit(label, [activeLayer.id])
  }

  if (!text) {
    return (
      <div className="p-3 text-[11px] text-[var(--ps-text-dim)] text-center">
        Select a text layer to edit paragraph properties.
      </div>
    )
  }

  const justify = text.justify ?? text.align ?? "left"

  return (
    <div data-testid="typography-paragraph-panel" className="overflow-y-auto text-[11px]">
      {/* Justification buttons */}
      <div className="px-3 py-2 border-b border-[var(--ps-divider)]">
        <label className="text-[10px] text-[var(--ps-text-dim)] mb-1.5 block">Alignment / Justification</label>
        <div data-testid="paragraph-alignment-controls" className="grid grid-cols-7 gap-0.5">
          {PARAGRAPH_ALIGNMENT_CONTROLS.map((j) => (
            <button
              key={j.id}
              type="button"
              aria-label={j.label}
              aria-pressed={justify === j.id}
              title={j.label}
              onClick={() => {
                const align = j.id.startsWith("justify") ? "left" : j.id as "left" | "center" | "right"
                update({ justify: j.id, align })
                commitChange("Justification")
              }}
              className={`h-6 rounded-sm flex items-center justify-center ${
                justify === j.id
                  ? "bg-[var(--ps-tool-active)] text-white"
                  : "bg-[var(--ps-panel-2)] hover:bg-[var(--ps-tool-hover)] text-[var(--ps-text-dim)]"
              }`}
            >
              <ParagraphAlignmentIcon id={j.id} />
            </button>
          ))}
        </div>
      </div>

      {/* Indentation */}
      <div className="px-3 py-2 border-b border-[var(--ps-divider)] space-y-2">
        <label className="text-[10px] text-[var(--ps-text-dim)]">Indentation</label>
        <CharSlider
          label="Left Indent"
          value={text.indentLeft ?? 0}
          min={0}
          max={200}
          suffix="px"
          onChange={(v) => update({ indentLeft: v })}
          onCommit={() => commitChange("Left Indent")}
        />
        <CharSlider
          label="Right Indent"
          value={text.indentRight ?? 0}
          min={0}
          max={200}
          suffix="px"
          onChange={(v) => update({ indentRight: v })}
          onCommit={() => commitChange("Right Indent")}
        />
        <CharSlider
          label="First Line Indent"
          value={text.indentFirst ?? 0}
          min={-100}
          max={200}
          suffix="px"
          onChange={(v) => update({ indentFirst: v })}
          onCommit={() => commitChange("First Line Indent")}
        />
      </div>

      {/* Spacing */}
      <div className="px-3 py-2 border-b border-[var(--ps-divider)] space-y-2">
        <label className="text-[10px] text-[var(--ps-text-dim)]">Spacing</label>
        <CharSlider
          label="Space Before"
          value={text.spaceBefore ?? 0}
          min={0}
          max={100}
          suffix="px"
          onChange={(v) => update({ spaceBefore: v })}
          onCommit={() => commitChange("Space Before")}
        />
        <CharSlider
          label="Space After"
          value={text.spaceAfter ?? 0}
          min={0}
          max={100}
          suffix="px"
          onChange={(v) => update({ spaceAfter: v })}
          onCommit={() => commitChange("Space After")}
        />
      </div>

      {/* Hyphenation */}
      <div className="px-3 py-2">
        <label className="flex items-center gap-2 text-[11px]">
          <Checkbox
            checked={text.hyphenation === true}
            onCheckedChange={(v) => { update({ hyphenation: v === true }); commitChange("Hyphenation") }}
            className="border-[var(--ps-divider)]"
          />
          Hyphenation
        </label>
      </div>
    </div>
  )
}

/* ---- Reusable sub-components ---- */

type ParagraphAlignmentId = (typeof PARAGRAPH_ALIGNMENT_CONTROLS)[number]["id"]

function ParagraphAlignmentIcon({ id }: { id: ParagraphAlignmentId }) {
  if (id === "left") return <AlignLeft className="h-3.5 w-3.5" />
  if (id === "center") return <AlignCenter className="h-3.5 w-3.5" />
  if (id === "right") return <AlignRight className="h-3.5 w-3.5" />
  if (id === "justify-all") return <AlignJustify className="h-3.5 w-3.5" />

  const marker =
    id === "justify-left"
      ? "left-0"
      : id === "justify-right"
        ? "right-0"
        : "left-1/2 -translate-x-1/2"

  return (
    <span className="relative flex h-4 w-4 items-center justify-center">
      <AlignJustify className="h-3.5 w-3.5" />
      <span className={`absolute bottom-0 h-0.5 w-1.5 rounded-full bg-current ${marker}`} />
    </span>
  )
}

function StyleBtn({ title, active, onClick, children }: { title: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={title}
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={`w-6 h-6 rounded-sm flex items-center justify-center ${
        active
          ? "bg-[var(--ps-tool-active)] text-white"
          : "bg-[var(--ps-panel-2)] hover:bg-[var(--ps-tool-hover)] text-[var(--ps-text-dim)]"
      }`}
    >
      {children}
    </button>
  )
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[10px]">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        className="border-[var(--ps-divider)]"
      />
      {label}
    </label>
  )
}

function CharSlider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (v: number) => void
  onCommit?: () => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[var(--ps-text-dim)]">{label}</span>
        <span className="text-[10px] tabular-nums">{value}{suffix ? ` ${suffix}` : ""}</span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step ?? 1}
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        onValueCommit={onCommit}
      />
    </div>
  )
}
