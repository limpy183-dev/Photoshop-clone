"use client"

import * as React from "react"
import { useEditor } from "../editor-context"
import { FILTERS } from "../filters"
import { downloadText } from "../document-io"
import { rasterizeText } from "../tool-helpers"
import type { AssetLibraryItem, CustomShapeId, LayerStyle, Note, TimelineFrame } from "../types"

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

const glyphs = "©®™•…—–°±×÷µΩπ∞≤≥≈≠∑√ƒ∂∆∫∏αβγδλ✓✕★☆"
const shapes: { id: CustomShapeId; name: string }[] = [
  { id: "star5", name: "5 Point Star" },
  { id: "star6", name: "6 Point Star" },
  { id: "heart", name: "Heart" },
  { id: "arrow-right", name: "Arrow Right" },
  { id: "arrow-left", name: "Arrow Left" },
  { id: "arrow-up", name: "Arrow Up" },
  { id: "arrow-down", name: "Arrow Down" },
  { id: "speech", name: "Speech Bubble" },
  { id: "check", name: "Check Mark" },
  { id: "cross", name: "Cross" },
  { id: "lightning", name: "Lightning" },
  { id: "polygon-hex", name: "Hexagon" },
  { id: "polygon-tri", name: "Triangle" },
  { id: "diamond", name: "Diamond" },
]

export function GlyphsPanel() {
  const { activeLayer, dispatch, commit } = useEditor()
  const insert = (glyph: string) => {
    if (!activeLayer || activeLayer.kind !== "text" || !activeLayer.text) return
    const text = { ...activeLayer.text, content: `${activeLayer.text.content}${glyph}` }
    dispatch({ type: "set-layer-text", id: activeLayer.id, text })
    rasterizeText(activeLayer.canvas, text)
    window.setTimeout(() => commit("Insert Glyph", [activeLayer.id]), 0)
  }
  return (
    <PanelShell title="Glyphs">
      <div className="grid grid-cols-7 gap-1">
        {[...glyphs].map((glyph) => (
          <button key={glyph} type="button" onClick={() => insert(glyph)} className="h-8 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[15px] hover:bg-[var(--ps-tool-hover)]">
            {glyph}
          </button>
        ))}
      </div>
      <PanelHint text={activeLayer?.kind === "text" ? "Click a glyph to append it to the active text layer." : "Select a text layer to insert glyphs."} />
    </PanelShell>
  )
}

export function AnimationPanel() {
  const { activeDoc, dispatch, commit } = useEditor()
  const frames = activeDoc?.timelineFrames ?? []
  const addFrame = () => {
    if (!activeDoc) return
    const frame: TimelineFrame = {
      id: uid("frame"),
      name: `Frame ${frames.length + 1}`,
      durationMs: 120,
      layerVisibility: Object.fromEntries(activeDoc.layers.map((layer) => [layer.id, layer.visible])),
      layerOpacity: Object.fromEntries(activeDoc.layers.map((layer) => [layer.id, layer.opacity])),
      transition: "hold",
    }
    dispatch({ type: "set-timeline-frames", frames: [...frames, frame] })
    window.setTimeout(() => commit("Add Animation Frame", []), 0)
  }
  const play = async () => {
    if (!activeDoc || !frames.length) return
    for (const frame of frames) {
      for (const [id, visible] of Object.entries(frame.layerVisibility)) {
        dispatch({ type: "set-layer-visibility", id, visible })
      }
      await new Promise((resolve) => window.setTimeout(resolve, frame.durationMs))
    }
  }
  return (
    <PanelShell title="Animation">
      <div className="grid grid-cols-3 gap-1">
        <SmallButton label="Add Frame" onClick={addFrame} />
        <SmallButton label="Play" disabled={!frames.length} onClick={() => { void play() }} />
        <SmallButton label="Export JSON" disabled={!frames.length || !activeDoc} onClick={() => activeDoc && downloadText(JSON.stringify(frames, null, 2), `${activeDoc.name}-frames.json`)} />
      </div>
      <div className="space-y-1">
        {frames.length ? frames.map((frame, index) => (
          <div key={frame.id} className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
            <div className="text-[12px]">{index + 1}. {frame.name}</div>
            <div className="text-[10px] text-[var(--ps-text-dim)]">{frame.durationMs} ms - {Object.values(frame.layerVisibility).filter(Boolean).length} visible layers</div>
          </div>
        )) : <PanelHint text="Frame animation uses document layer visibility and opacity per frame." />}
      </div>
    </PanelShell>
  )
}

export function LibrariesPanel() {
  const { activeDoc, dispatch, commit } = useEditor()
  if (!activeDoc) return <PanelEmpty text="No document open" />
  const assets = activeDoc.assetLibrary ?? []
  const addLibrarySamples = () => {
    const samples: AssetLibraryItem[] = [
      { id: uid("asset"), name: "Project Brand Kit", kind: "cloud-library", group: "Libraries", payload: { colors: ["#111827", "#3b82f6", "#f97316"], source: "local" }, createdAt: Date.now() },
      { id: uid("asset"), name: "Editorial Sans", kind: "font", group: "Fonts", payload: { family: "Geist", source: "local-font" }, createdAt: Date.now() },
      { id: uid("asset"), name: "Stock Light Sweep", kind: "stock", group: "Stock", payload: { license: "placeholder", tags: ["light", "overlay"] }, createdAt: Date.now() },
    ]
    dispatch({ type: "set-asset-library", assets: [...samples, ...assets] })
    window.setTimeout(() => commit("Add Library Assets", []), 0)
  }
  const visible = assets.filter((asset) => ["cloud-library", "font", "stock"].includes(asset.kind))
  return (
    <PanelShell title="Libraries">
      <SmallButton label="Add Local Library Samples" onClick={addLibrarySamples} />
      <AssetList assets={visible} empty="No library, stock, or font assets saved." />
    </PanelShell>
  )
}

export function LearnPanel() {
  const lessons = [
    { name: "Brush Dynamics", run: () => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "brush" })) },
    { name: "Smart Filters", run: () => window.dispatchEvent(new CustomEvent("ps-open-filter-gallery")) },
    { name: "Selections", run: () => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "selection-studio" })) },
    { name: "Export", run: () => window.dispatchEvent(new CustomEvent("ps-open-export-as")) },
    { name: "3D and Video", run: () => window.dispatchEvent(new CustomEvent("ps-open-3d-workspace")) },
  ]
  return (
    <PanelShell title="Learn">
      {lessons.map((lesson) => <SmallButton key={lesson.name} label={lesson.name} onClick={lesson.run} />)}
    </PanelShell>
  )
}

export function CommentsPanel() {
  const { activeDoc, dispatch, commit } = useEditor()
  const [text, setText] = React.useState("Comment")
  if (!activeDoc) return <PanelEmpty text="No document open" />
  const add = () => {
    const note: Note = { id: uid("comment"), x: activeDoc.width / 2, y: activeDoc.height / 2, author: "Reviewer", text, color: "#38bdf8" }
    dispatch({ type: "add-note", note })
    window.setTimeout(() => commit("Add Comment", []), 0)
  }
  return (
    <PanelShell title="Comments">
      <div className="grid grid-cols-[1fr_auto] gap-1">
        <input value={text} onChange={(event) => setText(event.target.value)} className={inputClass} />
        <SmallButton label="Add" onClick={add} />
      </div>
      {(activeDoc.notes ?? []).map((note) => (
        <div key={note.id} className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
          <div className="text-[10px] text-[var(--ps-text-dim)]">{note.author} - {Math.round(note.x)}, {Math.round(note.y)}</div>
          <div>{note.text}</div>
        </div>
      ))}
    </PanelShell>
  )
}

export function DiscoverPanel() {
  const [query, setQuery] = React.useState("")
  const commands = React.useMemo(() => [
    ...Object.values(FILTERS).map((filter) => ({ label: filter.name, group: filter.category, run: () => window.dispatchEvent(new CustomEvent("ps-open-filter", { detail: filter.id })) })),
    ...["layers", "channels", "paths", "brush", "histogram", "properties", "timeline", "glyphs", "styles", "libraries"].map((id) => ({ label: `${id[0].toUpperCase()}${id.slice(1)} Panel`, group: "Panel", run: () => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: id })) })),
  ], [])
  const visible = commands.filter((command) => `${command.label} ${command.group}`.toLowerCase().includes(query.toLowerCase())).slice(0, 60)
  return (
    <PanelShell title="Discover">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search filters and panels" className={inputClass} />
      {visible.map((command) => <SmallButton key={`${command.group}-${command.label}`} label={`${command.label} - ${command.group}`} onClick={command.run} />)}
    </PanelShell>
  )
}

export function MeasurementLogPanel() {
  const { activeDoc, dispatch, commit } = useEditor()
  if (!activeDoc) return <PanelEmpty text="No document open" />
  const logs = (activeDoc.assetLibrary ?? []).filter((asset) => asset.kind === "prepress" && asset.group === "Measurement Log")
  const record = () => {
    if (!activeDoc.measurement) return
    const m = activeDoc.measurement
    const payload = { ...m, length: Math.hypot(m.x2 - m.x1, m.y2 - m.y1), angle: (Math.atan2(m.y2 - m.y1, m.x2 - m.x1) * 180) / Math.PI }
    const asset: AssetLibraryItem = { id: uid("measure"), name: `Measurement ${logs.length + 1}`, kind: "prepress", group: "Measurement Log", payload, createdAt: Date.now() }
    dispatch({ type: "set-asset-library", assets: [asset, ...(activeDoc.assetLibrary ?? [])] })
    window.setTimeout(() => commit("Record Measurement", []), 0)
  }
  return (
    <PanelShell title="Measurement Log">
      <SmallButton label="Record Current Measurement" disabled={!activeDoc.measurement} onClick={record} />
      <AssetList assets={logs} empty="Use the Ruler tool, then record the measurement here." />
    </PanelShell>
  )
}

export function NotesPanel() {
  const { activeDoc, dispatch } = useEditor()
  if (!activeDoc) return <PanelEmpty text="No document open" />
  return (
    <PanelShell title="Notes">
      {(activeDoc.notes ?? []).length ? (activeDoc.notes ?? []).map((note) => (
        <div key={note.id} className="grid grid-cols-[1fr_auto] gap-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
          <div>
            <div className="text-[10px] text-[var(--ps-text-dim)]">{Math.round(note.x)}, {Math.round(note.y)}</div>
            <div>{note.text}</div>
          </div>
          <SmallButton label="Delete" onClick={() => dispatch({ type: "remove-note", id: note.id })} />
        </div>
      )) : <PanelHint text="No notes on this document." />}
    </PanelShell>
  )
}

export function ShapesPanel() {
  const { dispatch } = useEditor()
  return (
    <PanelShell title="Shapes">
      <div className="grid grid-cols-2 gap-1">
        {shapes.map((shape) => (
          <SmallButton
            key={shape.id}
            label={shape.name}
            onClick={() => {
              ;window.__psCustomShape = shape.id
              dispatch({ type: "set-tool", tool: "custom-shape" })
            }}
          />
        ))}
      </div>
    </PanelShell>
  )
}

export function StylesPanel() {
  const { activeDoc, activeLayer, dispatch, commit } = useEditor()
  if (!activeDoc) return <PanelEmpty text="No document open" />
  const presets = activeDoc.stylePresets ?? []
  const save = () => {
    if (!activeLayer?.style) return
    dispatch({ type: "set-style-presets", presets: [{ id: uid("style"), name: `${activeLayer.name} FX`, style: activeLayer.style }, ...presets] })
    window.setTimeout(() => commit("Save Style Preset", []), 0)
  }
  const apply = (style: LayerStyle) => {
    if (!activeLayer) return
    dispatch({ type: "set-layer-style", id: activeLayer.id, style })
    window.setTimeout(() => commit("Apply Style Preset", [activeLayer.id]), 0)
  }
  return (
    <PanelShell title="Styles">
      <SmallButton label="Save Active Layer Style" disabled={!activeLayer?.style} onClick={save} />
      {presets.length ? presets.map((preset) => <SmallButton key={preset.id} label={preset.name} onClick={() => apply(preset.style)} />) : <PanelHint text="No layer style presets saved." />}
    </PanelShell>
  )
}

function AssetList({ assets, empty }: { assets: AssetLibraryItem[]; empty: string }) {
  if (!assets.length) return <PanelHint text={empty} />
  return (
    <div className="space-y-1">
      {assets.map((asset) => (
        <div key={asset.id} className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
          <div className="truncate text-[12px]">{asset.name}</div>
          <div className="truncate text-[10px] text-[var(--ps-text-dim)]">{asset.kind} - {asset.group ?? "Ungrouped"}</div>
        </div>
      ))}
    </div>
  )
}

function PanelShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2 text-[11px] text-[var(--ps-text)]">
      <div className="text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">{title}</div>
      {children}
    </div>
  )
}

function PanelHint({ text }: { text: string }) {
  return <div className="rounded-sm border border-dashed border-[var(--ps-divider)] p-3 text-center text-[var(--ps-text-dim)]">{text}</div>
}

function PanelEmpty({ text }: { text: string }) {
  return <div className="px-4 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">{text}</div>
}

function SmallButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="min-h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-left text-[10px] hover:bg-[var(--ps-tool-hover)] disabled:opacity-40">
      {label}
    </button>
  )
}

const inputClass = "h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] outline-none"
