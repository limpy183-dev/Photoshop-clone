"use client"

import * as React from "react"
import { useEditor } from "../editor-context"
import { rasterizeText } from "../tool-helpers"
import type { TextAntiAliasMode } from "../types"
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
} from "lucide-react"

export function CharacterPanel() {
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
  const updateAxis = (tag: string, value: number) => {
    update({ variableAxes: { ...(text?.variableAxes ?? {}), [tag]: value } })
  }

  if (!text) {
    return (
      <div className="p-3 text-[11px] text-[var(--ps-text-dim)] text-center">
        Select a text layer to edit character properties.
      </div>
    )
  }

  return (
    <div className="overflow-y-auto text-[11px]">
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
          <StyleBtn active={text.weight === "bold"} onClick={() => { update({ weight: text.weight === "bold" ? "normal" : "bold" }); commitChange("Bold") }}>
            <Bold className="w-3 h-3" />
          </StyleBtn>
          <StyleBtn active={text.italic} onClick={() => { update({ italic: !text.italic }); commitChange("Italic") }}>
            <Italic className="w-3 h-3" />
          </StyleBtn>
          <StyleBtn active={text.underline === true} onClick={() => { update({ underline: !text.underline }); commitChange("Underline") }}>
            <Underline className="w-3 h-3" />
          </StyleBtn>
          <StyleBtn active={text.strikethrough === true} onClick={() => { update({ strikethrough: !text.strikethrough }); commitChange("Strikethrough") }}>
            <Strikethrough className="w-3 h-3" />
          </StyleBtn>
          <div className="w-px h-4 bg-[var(--ps-divider)] mx-0.5" />
          <StyleBtn active={text.allCaps === true} onClick={() => { update({ allCaps: !text.allCaps, smallCaps: false }); commitChange("All Caps") }}>
            <CaseUpper className="w-3 h-3" />
          </StyleBtn>
          <StyleBtn active={text.smallCaps === true} onClick={() => { update({ smallCaps: !text.smallCaps, allCaps: false }); commitChange("Small Caps") }}>
            <CaseLower className="w-3 h-3" />
          </StyleBtn>
          <div className="w-px h-4 bg-[var(--ps-divider)] mx-0.5" />
          <StyleBtn active={text.superscript === true} onClick={() => { update({ superscript: !text.superscript, subscript: false }); commitChange("Superscript") }}>
            <Superscript className="w-3 h-3" />
          </StyleBtn>
          <StyleBtn active={text.subscript === true} onClick={() => { update({ subscript: !text.subscript, superscript: false }); commitChange("Subscript") }}>
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

      <div className="px-3 py-2 border-b border-[var(--ps-divider)] space-y-2">
        <label className="text-[10px] text-[var(--ps-text-dim)]">Variable Font Axes</label>
        <CharSlider label="Weight" value={text.variableAxes?.wght ?? (text.weight === "bold" ? 700 : 400)} min={100} max={900} step={1} onChange={(v) => updateAxis("wght", v)} onCommit={() => commitChange("Variable Weight")} />
        <CharSlider label="Width" value={text.variableAxes?.wdth ?? 100} min={50} max={200} step={1} suffix="%" onChange={(v) => updateAxis("wdth", v)} onCommit={() => commitChange("Variable Width")} />
        <CharSlider label="Slant" value={text.variableAxes?.slnt ?? 0} min={-15} max={0} step={1} onChange={(v) => updateAxis("slnt", v)} onCommit={() => commitChange("Variable Slant")} />
        <CharSlider label="Optical" value={text.variableAxes?.opsz ?? text.size} min={8} max={144} step={1} onChange={(v) => updateAxis("opsz", v)} onCommit={() => commitChange("Variable Optical Size")} />
      </div>

      <div className="px-3 py-2 border-b border-[var(--ps-divider)] space-y-2">
        <label className="text-[10px] text-[var(--ps-text-dim)]">OpenType</label>
        <div className="grid grid-cols-2 gap-1">
          <CheckRow label="Ligatures" checked={text.ligatures !== false} onChange={(v) => { update({ ligatures: v }); commitChange("Ligatures") }} />
          <CheckRow label="Discretionary" checked={text.discretionaryLigatures === true} onChange={(v) => { update({ discretionaryLigatures: v }); commitChange("Discretionary Ligatures") }} />
          <CheckRow label="Contextual" checked={text.contextualAlternates !== false} onChange={(v) => { update({ contextualAlternates: v }); commitChange("Contextual Alternates") }} />
          <CheckRow label="Stylistic" checked={text.stylisticAlternates === true} onChange={(v) => { update({ stylisticAlternates: v }); commitChange("Stylistic Alternates") }} />
          <CheckRow label="Swash" checked={text.swash === true} onChange={(v) => { update({ swash: v }); commitChange("Swash") }} />
          <CheckRow label="Ordinals" checked={text.ordinals === true} onChange={(v) => { update({ ordinals: v }); commitChange("Ordinals") }} />
          <CheckRow label="Fractions" checked={text.fractions === true} onChange={(v) => { update({ fractions: v }); commitChange("Fractions") }} />
          <CheckRow label="Oldstyle" checked={text.oldstyleFigures === true} onChange={(v) => { update({ oldstyleFigures: v }); commitChange("Oldstyle Figures") }} />
          <CheckRow label="Tabular" checked={text.tabularFigures === true} onChange={(v) => { update({ tabularFigures: v }); commitChange("Tabular Figures") }} />
        </div>
      </div>

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
    <div className="overflow-y-auto text-[11px]">
      {/* Justification buttons */}
      <div className="px-3 py-2 border-b border-[var(--ps-divider)]">
        <label className="text-[10px] text-[var(--ps-text-dim)] mb-1.5 block">Alignment / Justification</label>
        <div className="grid grid-cols-7 gap-0.5">
          {(
            [
              { id: "left", label: "Left" },
              { id: "center", label: "Center" },
              { id: "right", label: "Right" },
              { id: "justify-left", label: "Justify Left" },
              { id: "justify-center", label: "Justify Center" },
              { id: "justify-right", label: "Justify Right" },
              { id: "justify-all", label: "Justify All" },
            ] as const
          ).map((j) => (
            <button
              key={j.id}
              title={j.label}
              onClick={() => {
                const align = j.id.startsWith("justify") ? "left" : j.id as "left" | "center" | "right"
                update({ justify: j.id, align })
                commitChange("Justification")
              }}
              className={`h-6 rounded-sm flex items-center justify-center text-[9px] font-medium ${
                justify === j.id
                  ? "bg-[var(--ps-tool-active)] text-white"
                  : "bg-[var(--ps-panel-2)] hover:bg-[var(--ps-tool-hover)] text-[var(--ps-text-dim)]"
              }`}
            >
              {j.id === "left" && "≡←"}
              {j.id === "center" && "≡↔"}
              {j.id === "right" && "≡→"}
              {j.id === "justify-left" && "J←"}
              {j.id === "justify-center" && "J↔"}
              {j.id === "justify-right" && "J→"}
              {j.id === "justify-all" && "J≡"}
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

function StyleBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
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
