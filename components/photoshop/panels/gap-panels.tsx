"use client"

import * as React from "react"
import { useEditor } from "../editor-context"
import { downloadText } from "../document-io"
import { FILTERS } from "../filters"
import { addPhotoshopEventListener } from "../events"
import { rasterizeText } from "../tool-helpers"
import type { AssetLibraryItem, LayerStyle, Note } from "../types"
import { uid } from "../uid"
import { createAssetLibraryBundle, filterAssetLibrary } from "../asset-library-bundles"
import { exportCustomShapeLibrary, normalizeCustomShapeLibrary, shapeAssetToPreset, shapePresetToAsset } from "../custom-shape-library"
import { appendThreadReply, createReviewReport, createReviewThread, setThreadResolved } from "../collaboration"
import { buildLearningIndex, runLearningIndexItem, searchLearningIndex, type LearningPanelSource } from "../learning-index"
import { normalizeImportedAssetLibrary } from "./assets-panel"
import { TimelinePanel } from "./timeline-panel"
import { readShapePresets, type ShapePresetEntry } from "../shape-preset-library"

const glyphs = "©®™•…—–°±×÷µΩπ∞≤≥≈≠∑√ƒ∂∆∫∏αβγδλ✓✕★☆"
const learningPanels: LearningPanelSource[] = [
  { id: "assets", label: "Assets", category: "Color and Assets", complexity: "standard", keywords: ["library", "tags", "export"] },
  { id: "libraries", label: "Libraries", category: "Color and Assets", complexity: "advanced", keywords: ["bundle", "stock", "font"] },
  { id: "comments", label: "Comments", category: "Collaboration and Learning", complexity: "specialized", keywords: ["review", "thread", "resolved"] },
  { id: "annotations", label: "Annotations", category: "Collaboration and Learning", complexity: "specialized", keywords: ["geometry", "markup", "report"] },
  { id: "selection-studio", label: "Selection", category: "Selection", complexity: "standard", keywords: ["mask", "subject", "edge"] },
  { id: "layers", label: "Layers", category: "Core", complexity: "core", keywords: ["stack", "visibility", "metadata"] },
  { id: "brush", label: "Brush", category: "Core", complexity: "core", keywords: ["painting", "dynamics", "preset"] },
  { id: "timeline", label: "Timeline", category: "Motion and Automation", complexity: "advanced", keywords: ["animation", "video", "frames"] },
  { id: "slices", label: "Slices", category: "Motion and Automation", complexity: "advanced", keywords: ["web", "export", "regions"] },
  { id: "measurement-log", label: "Measurement Log", category: "Inspection and Guides", complexity: "specialized", keywords: ["measure", "count", "analysis"] },
]

const learningIndex = buildLearningIndex({
  panels: learningPanels,
  filters: Object.values(FILTERS),
})

const LEARNING_QUERY_KEY = "ps-learning-index-query"

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
  return <TimelinePanel />
}

export function LibrariesPanel() {
  const { activeDoc, dispatch, commit } = useEditor()
  const [query, setQuery] = React.useState("")
  if (!activeDoc) return <PanelEmpty text="No document open" />
  const assets = activeDoc.assetLibrary ?? []
  const addLibrarySamples = () => {
    const samples: AssetLibraryItem[] = [
      { id: uid("asset"), name: "Project Brand Kit", kind: "cloud-library", group: "Libraries", tags: ["brand", "colors"], payload: { colors: ["#111827", "#3b82f6", "#f97316"], source: "local" }, createdAt: Date.now() },
      { id: uid("asset"), name: "Editorial Sans", kind: "font", group: "Fonts", tags: ["type", "editorial"], payload: { family: "Geist", source: "local-font" }, createdAt: Date.now() },
      { id: uid("asset"), name: "Stock Light Sweep", kind: "stock", group: "Stock", tags: ["light", "overlay"], payload: { license: "placeholder", tags: ["light", "overlay"] }, createdAt: Date.now() },
    ]
    dispatch({ type: "set-asset-library", assets: [...samples, ...assets] })
    window.setTimeout(() => commit("Add Library Assets", []), 0)
  }
  const libraryAssets = assets.filter((asset) => ["cloud-library", "font", "stock"].includes(asset.kind))
  const visible = filterAssetLibrary(libraryAssets, { query })
  const importBundle = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".json,.pslibrary,application/json"
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const imported = normalizeImportedAssetLibrary(JSON.parse(await file.text()), { fileSizeBytes: file.size })
          .filter((asset) => ["cloud-library", "font", "stock"].includes(asset.kind))
        dispatch({ type: "set-asset-library", assets: [...imported, ...assets] })
        window.setTimeout(() => commit("Import Library Bundle", []), 0)
      } catch {
        window.alert("Could not import that library bundle.")
      }
    }
    input.click()
  }
  return (
    <PanelShell title="Libraries">
      <div className="grid grid-cols-3 gap-1">
        <SmallButton label="Add Local Library Samples" onClick={addLibrarySamples} />
        <SmallButton label="Import Library Bundle" onClick={importBundle} />
        <SmallButton
          label="Export Library Bundle"
          disabled={!libraryAssets.length}
          onClick={() => downloadText(
            JSON.stringify(createAssetLibraryBundle(libraryAssets, { name: `${activeDoc.name} Libraries`, documentName: activeDoc.name }), null, 2),
            `${activeDoc.name}-libraries.pslibrary.json`,
          )}
        />
      </div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search local libraries" className={inputClass} />
      <AssetList assets={visible} empty="No library, stock, or font assets saved." />
    </PanelShell>
  )
}

export function LearnPanel() {
  const lessons = React.useMemo(
    () => learningIndex.filter((item) => item.type === "workflow" || item.type === "doc" || item.type === "command").slice(0, 14),
    [],
  )
  return (
    <PanelShell title="Learn">
      {lessons.map((lesson) => (
        <SmallButton key={lesson.id} label={`${lesson.title} - ${lesson.category}`} onClick={() => runLearningIndexItem(lesson)} />
      ))}
    </PanelShell>
  )
}

export function CommentsPanel() {
  const { activeDoc, dispatch, commit } = useEditor()
  const [text, setText] = React.useState("Comment")
  const [replyText, setReplyText] = React.useState<Record<string, string>>({})
  const [status, setStatus] = React.useState<"open" | "resolved" | "all">("open")
  if (!activeDoc) return <PanelEmpty text="No document open" />
  const add = () => {
    const note = createReviewThread({
      id: uid("comment"),
      x: activeDoc.width / 2,
      y: activeDoc.height / 2,
      author: "Reviewer",
      text,
      color: "#38bdf8",
      now: Date.now(),
    })
    dispatch({ type: "add-note", note })
    window.setTimeout(() => commit("Add Comment", []), 0)
  }
  const allThreads = (activeDoc.notes ?? []).filter((note) => note.kind === "comment" || note.status || note.replies?.length)
  const openCount = allThreads.filter((note) => (note.status ?? "open") !== "resolved").length
  const resolvedCount = allThreads.filter((note) => (note.status ?? "open") === "resolved").length
  const threads = (activeDoc.notes ?? []).filter((note) => {
    const isThread = note.kind === "comment" || note.status || note.replies?.length
    if (!isThread) return false
    if (status === "all") return true
    return (note.status ?? "open") === status
  })
  const patchThread = (note: Note, patch: Partial<Note>, label: string) => {
    dispatch({ type: "update-note", id: note.id, patch })
    window.setTimeout(() => commit(label, []), 0)
  }
  const addReply = (note: Note) => {
    const reply = replyText[note.id]?.trim()
    if (!reply) return
    const next = appendThreadReply(note, { id: uid("reply"), author: "Reviewer", text: reply, now: Date.now() })
    patchThread(note, { replies: next.replies, updatedAt: next.updatedAt, kind: next.kind }, "Reply to Comment")
    setReplyText((current) => ({ ...current, [note.id]: "" }))
  }
  return (
    <PanelShell title="Comments">
      <div className="grid grid-cols-3 gap-1 text-[10px]">
        <Metric label="Open" value={openCount} />
        <Metric label="Resolved" value={resolvedCount} />
        <Metric label="Replies" value={allThreads.reduce((sum, note) => sum + (note.replies?.length ?? 0), 0)} />
      </div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">Open threads</div>
      <div className="grid grid-cols-[1fr_auto] gap-1">
        <input aria-label="Comment text" value={text} onChange={(event) => setText(event.target.value)} className={inputClass} />
        <SmallButton label="Add comment" onClick={add} />
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-1">
        <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className={inputClass}>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="all">All</option>
        </select>
        <SmallButton
          label="Export"
          onClick={() => downloadText(createReviewReport(activeDoc), `${activeDoc.name}-review-report.md`, "text/markdown")}
        />
      </div>
      {threads.length ? threads.map((note) => (
        <div key={note.id} className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
          <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--ps-text-dim)]">
            <span>{note.author} - {Math.round(note.x)}, {Math.round(note.y)} - {note.status ?? "open"}</span>
            <SmallButton
              label={(note.status ?? "open") === "resolved" ? "Reopen" : "Resolve"}
              ariaLabel={`${(note.status ?? "open") === "resolved" ? "Reopen" : "Resolve"} ${note.text}`}
              onClick={() => {
                const next = setThreadResolved(note, (note.status ?? "open") !== "resolved", { by: "Reviewer", now: Date.now() })
                patchThread(note, { status: next.status, resolvedAt: next.resolvedAt, resolvedBy: next.resolvedBy, updatedAt: next.updatedAt }, "Update Comment")
              }}
            />
          </div>
          <div>{note.text}</div>
          {note.tags?.length ? <div className="text-[10px] text-[var(--ps-text-dim)]">#{note.tags.join(" #")}</div> : null}
          {note.replies?.length ? (
            <div className="space-y-1 border-l border-[var(--ps-divider)] pl-2 text-[10px]">
              {note.replies.map((reply) => (
                <div key={reply.id}><span className="text-[var(--ps-text-dim)]">{reply.author}:</span> {reply.text}</div>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-[1fr_auto] gap-1">
            <input
              value={replyText[note.id] ?? ""}
              onChange={(event) => setReplyText((current) => ({ ...current, [note.id]: event.target.value }))}
              className={inputClass}
              aria-label={`Reply to ${note.text}`}
              placeholder="Reply"
            />
            <SmallButton label="Reply" ariaLabel={`Add reply to ${note.text}`} onClick={() => addReply(note)} />
          </div>
        </div>
      )) : <PanelHint text="No comments in this view." />}
    </PanelShell>
  )
}

export function DiscoverPanel() {
  const [query, setQuery] = React.useState(readLearningQuery)
  React.useEffect(() => {
    return addPhotoshopEventListener("ps-set-learning-query", (nextQuery) => {
      setQuery(nextQuery)
      writeLearningQuery(nextQuery)
    })
  }, [])
  const visible = React.useMemo(() => searchLearningIndex(learningIndex, query, { limit: 80 }), [query])
  return (
    <PanelShell title="Discover">
      <input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          writeLearningQuery(event.target.value)
        }}
        placeholder="Search tools, commands, docs, panels, workflows"
        className={inputClass}
      />
      {visible.map((item) => <SmallButton key={item.id} label={`${item.title} - ${item.type} - ${item.category}`} onClick={() => runLearningIndexItem(item)} />)}
    </PanelShell>
  )
}

function readLearningQuery() {
  if (typeof window === "undefined") return ""
  try {
    return sessionStorage.getItem(LEARNING_QUERY_KEY) ?? ""
  } catch {
    return ""
  }
}

function writeLearningQuery(query: string) {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(LEARNING_QUERY_KEY, query)
  } catch {}
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
  const { activeDoc, activeLayer, dispatch, commit, foreground } = useEditor()
  const [query, setQuery] = React.useState("")
  const [shapePresets, setShapePresets] = React.useState<ShapePresetEntry[]>(readShapePresets)
  React.useEffect(() => {
    const syncShapes = (event: Event) => {
      const detail = (event as CustomEvent<ShapePresetEntry[]>).detail
      setShapePresets(Array.isArray(detail) ? detail : readShapePresets())
    }
    window.addEventListener("ps-shape-presets-changed", syncShapes)
    return () => window.removeEventListener("ps-shape-presets-changed", syncShapes)
  }, [])
  if (!activeDoc) return <PanelEmpty text="No document open" />
  const shapeAssets = (activeDoc.assetLibrary ?? []).filter((asset) => asset.kind === "shape")
  const visibleAssets = filterAssetLibrary(shapeAssets, { query })
  const setAssets = (assets: AssetLibraryItem[], label: string) => {
    dispatch({ type: "set-asset-library", assets })
    window.setTimeout(() => commit(label, []), 0)
  }
  const saveActiveShape = () => {
    if (!activeLayer?.shape) return
    const asset = shapePresetToAsset(activeLayer.shape, { name: `${activeLayer.name} shape`, group: "Custom Shapes", tags: ["shape", "vector"] })
    setAssets([asset, ...(activeDoc.assetLibrary ?? [])], "Save Custom Shape")
  }
  const importShapes = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".json,.psshapes,.pslibrary,application/json"
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const imported = normalizeCustomShapeLibrary(JSON.parse(await file.text()))
        setAssets([...imported, ...(activeDoc.assetLibrary ?? [])], "Import Custom Shapes")
      } catch {
        window.alert("Could not import that custom shape library.")
      }
    }
    input.click()
  }
  const selectAssetShape = (asset: AssetLibraryItem) => {
    window.__psCustomShapePreset = shapeAssetToPreset(asset, { x: 0, y: 0, w: 100, h: 100, fill: foreground })
    window.__psCustomShape = undefined
    dispatch({ type: "set-tool", tool: "custom-shape" })
  }
  return (
    <PanelShell title="Shapes">
      <div className="grid grid-cols-3 gap-1">
        <SmallButton label="Save Active Shape" disabled={!activeLayer?.shape} onClick={saveActiveShape} />
        <SmallButton label="Import Shapes" onClick={importShapes} />
        <SmallButton
          label="Export Shapes"
          disabled={!shapeAssets.length}
          onClick={() => downloadText(
            JSON.stringify(exportCustomShapeLibrary(shapeAssets, { name: `${activeDoc.name} Shapes` }), null, 2),
            `${activeDoc.name}-custom-shapes.psshapes.json`,
          )}
        />
      </div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search custom shapes" className={inputClass} />
      {visibleAssets.length ? (
        <div className="grid grid-cols-2 gap-1">
          {visibleAssets.map((asset) => (
            <SmallButton key={asset.id} label={`${asset.name} - ${asset.group ?? "Custom"}`} onClick={() => selectAssetShape(asset)} />
          ))}
        </div>
      ) : null}
      <div className="text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">Bundled</div>
      <div className="grid grid-cols-2 gap-1">
        {shapePresets.map((shape) => (
          <SmallButton
            key={shape.id}
            label={shape.name}
            onClick={() => {
              window.__psCustomShapePreset = undefined
              ;window.__psCustomShape = shape.customId
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
          {asset.tags?.length ? <div className="truncate text-[10px] text-[var(--ps-text-dim)]">#{asset.tags.join(" #")}</div> : null}
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1.5 py-1">
      <span className="text-[var(--ps-text-dim)]">{label}</span> {value}
    </div>
  )
}

function SmallButton({ label, ariaLabel, disabled, onClick }: { label: string; ariaLabel?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label={ariaLabel} disabled={disabled} onClick={onClick} className="min-h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-left text-[10px] hover:bg-[var(--ps-tool-hover)] disabled:opacity-40">
      {label}
    </button>
  )
}

const inputClass = "h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] outline-none"
