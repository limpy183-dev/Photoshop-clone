"use client"

import * as React from "react"
import { Grid3X3, Plus, Trash2 } from "lucide-react"
import { useEditor } from "../editor-context"
import type { Guide } from "../types"

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

export function GuidesPanel() {
  const { activeDoc, dispatch, commit } = useEditor()
  const [orientation, setOrientation] = React.useState<Guide["orientation"]>("vertical")
  const [position, setPosition] = React.useState(100)
  const [color, setColor] = React.useState("#06b6d4")

  if (!activeDoc) return <PanelEmpty text="No document open" />

  const guides = activeDoc.guides ?? []

  const addGuide = (guide: Omit<Guide, "id">) => {
    dispatch({ type: "add-guide", guide: { ...guide, id: uid("guide") } })
  }

  const addCurrent = () => {
    const max = orientation === "horizontal" ? activeDoc.height : activeDoc.width
    addGuide({ orientation, position: clamp(position, 0, max), color })
    window.setTimeout(() => commit("Add Guide", []), 0)
  }

  const addCenter = () => {
    addGuide({ orientation: "vertical", position: activeDoc.width / 2, color })
    addGuide({ orientation: "horizontal", position: activeDoc.height / 2, color })
    window.setTimeout(() => commit("Center Guides", []), 0)
  }

  const addThirds = () => {
    for (const pct of [1 / 3, 2 / 3]) {
      addGuide({ orientation: "vertical", position: activeDoc.width * pct, color })
      addGuide({ orientation: "horizontal", position: activeDoc.height * pct, color })
    }
    window.setTimeout(() => commit("Thirds Guides", []), 0)
  }

  const addSafeArea = () => {
    const mx = Math.round(activeDoc.width * 0.1)
    const my = Math.round(activeDoc.height * 0.1)
    addGuide({ orientation: "vertical", position: mx, color })
    addGuide({ orientation: "vertical", position: activeDoc.width - mx, color })
    addGuide({ orientation: "horizontal", position: my, color })
    addGuide({ orientation: "horizontal", position: activeDoc.height - my, color })
    window.setTimeout(() => commit("Safe Area Guides", []), 0)
  }

  const updateGuide = (guide: Guide, patch: Partial<Guide>) => {
    const nextOrientation = patch.orientation ?? guide.orientation
    const max = nextOrientation === "horizontal" ? activeDoc.height : activeDoc.width
    const next: Partial<Guide> = { ...patch }
    if (patch.position !== undefined) next.position = clamp(patch.position, 0, max)
    dispatch({ type: "update-guide", id: guide.id, patch: next })
  }

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="flex items-center gap-1 border-b border-[var(--ps-divider)] p-2">
        <button
          type="button"
          title="Add guide"
          onClick={addCurrent}
          className="flex h-7 w-7 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)]"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Clear guides"
          disabled={!guides.length}
          onClick={() => {
            dispatch({ type: "clear-guides" })
            window.setTimeout(() => commit("Clear Guides", []), 0)
          }}
          className="flex h-7 w-7 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <span className="ml-auto text-[10px] text-[var(--ps-text-dim)]">{guides.length} guide{guides.length === 1 ? "" : "s"}</span>
      </div>

      <div className="space-y-2 border-b border-[var(--ps-divider)] p-2">
        <div className="grid grid-cols-[1fr_78px_36px] gap-1">
          <select
            value={orientation}
            onChange={(event) => setOrientation(event.target.value as Guide["orientation"])}
            className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2"
          >
            <option value="vertical">Vertical</option>
            <option value="horizontal">Horizontal</option>
          </select>
          <input
            type="number"
            value={position}
            onChange={(event) => setPosition(Number(event.target.value) || 0)}
            className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2"
          />
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="h-7 w-9 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-0.5"
          />
        </div>
        <div className="grid grid-cols-3 gap-1">
          <SmallButton label="Center" onClick={addCenter} />
          <SmallButton label="Thirds" onClick={addThirds} />
          <SmallButton label="Safe Area" onClick={addSafeArea} />
        </div>
        <div className="grid grid-cols-2 gap-1">
          <ToggleButton label="Grid" active={!!activeDoc.showGrid} onClick={() => dispatch({ type: "toggle-grid" })} />
          <ToggleButton label="Pixel Grid" active={!!activeDoc.showPixelGrid} onClick={() => dispatch({ type: "toggle-pixel-grid" })} />
          <ToggleButton label="Snap" active={!!activeDoc.snap} onClick={() => dispatch({ type: "toggle-snap" })} />
          <ToggleButton label="Snap Guides" active={!!activeDoc.snapToGuides} onClick={() => dispatch({ type: "toggle-snap-guides" })} />
          <ToggleButton label="Snap Grid" active={!!activeDoc.snapToGrid} onClick={() => dispatch({ type: "toggle-snap-grid" })} />
          <ToggleButton label="Smart Guides" active={activeDoc.showSmartGuides !== false} onClick={() => dispatch({ type: "set-show-smart-guides", show: activeDoc.showSmartGuides === false })} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {guides.length === 0 ? (
          <PanelEmpty text="Add guides or layout presets for alignment." />
        ) : (
          guides.map((guide) => {
            const max = guide.orientation === "horizontal" ? activeDoc.height : activeDoc.width
            return (
              <div key={guide.id} className="grid grid-cols-[1fr_78px_36px_auto] items-end gap-1 border-b border-[var(--ps-divider)] p-2">
                <label className="grid gap-1 text-[10px] text-[var(--ps-text-dim)]">
                  Type
                  <select
                    value={guide.orientation}
                    onChange={(event) => updateGuide(guide, { orientation: event.target.value as Guide["orientation"] })}
                    className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] text-[var(--ps-text)]"
                  >
                    <option value="vertical">Vertical</option>
                    <option value="horizontal">Horizontal</option>
                  </select>
                </label>
                <label className="grid gap-1 text-[10px] text-[var(--ps-text-dim)]">
                  Pos
                  <input
                    type="number"
                    value={Math.round(guide.position)}
                    onChange={(event) => updateGuide(guide, { position: clamp(Number(event.target.value) || 0, 0, max) })}
                    className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] text-[var(--ps-text)]"
                  />
                </label>
                <input
                  type="color"
                  value={guide.color ?? "#06b6d4"}
                  onChange={(event) => updateGuide(guide, { color: event.target.value })}
                  className="h-7 w-9 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-0.5"
                />
                <button
                  type="button"
                  title="Delete guide"
                  onClick={() => {
                    dispatch({ type: "remove-guide", id: guide.id })
                    window.setTimeout(() => commit("Remove Guide", []), 0)
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-[var(--ps-divider)] px-2 py-1 text-[10px] text-[var(--ps-text-dim)]">
        <Grid3X3 className="h-3.5 w-3.5" />
        {activeDoc.width} x {activeDoc.height}px
      </div>
    </div>
  )
}

function SmallButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[10px] hover:bg-[var(--ps-tool-hover)]"
    >
      {label}
    </button>
  )
}

function ToggleButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 rounded-sm border px-2 text-left text-[10px] ${
        active
          ? "border-[var(--ps-accent)] bg-[var(--ps-tool-active)] text-[var(--ps-text)]"
          : "border-[var(--ps-divider)] bg-[var(--ps-panel-2)] hover:bg-[var(--ps-tool-hover)]"
      }`}
    >
      {label}
    </button>
  )
}

function PanelEmpty({ text }: { text: string }) {
  return <div className="px-4 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">{text}</div>
}
