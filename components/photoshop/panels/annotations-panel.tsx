"use client"

import * as React from "react"
import { useEditor } from "../editor-context"
import type { CountMarker, Note } from "../types"

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

function clampPoint(value: number, max: number) {
  return Math.max(0, Math.min(max, Math.round(value)))
}

export function AnnotationsPanel() {
  const { activeDoc, dispatch, commit } = useEditor()
  const [noteText, setNoteText] = React.useState("Review note")
  const [noteColor, setNoteColor] = React.useState("#facc15")

  if (!activeDoc) return <PanelEmpty text="No document open" />

  const notes = activeDoc.notes ?? []
  const counts = activeDoc.counts ?? []
  const group = activeDoc.countGroup ?? "A"
  const measurement = activeDoc.measurement
  const groupTotals = counts.reduce<Record<string, number>>((totals, count) => {
    totals[count.group] = (totals[count.group] ?? 0) + 1
    return totals
  }, {})

  const addNote = () => {
    const note: Note = {
      id: uid("note"),
      x: Math.round(activeDoc.width / 2),
      y: Math.round(activeDoc.height / 2),
      author: "Reviewer",
      text: noteText.trim() || "Review note",
      color: noteColor,
    }
    dispatch({ type: "add-note", note })
    window.setTimeout(() => commit("Add Note", []), 0)
  }

  const updateNote = (id: string, patch: Partial<Note>) => {
    dispatch({ type: "update-note", id, patch })
  }

  const addCount = () => {
    const number = counts.filter((count) => count.group === group).length + 1
    const count: CountMarker = {
      id: uid("count"),
      x: Math.round(activeDoc.width / 2),
      y: Math.round(activeDoc.height / 2),
      group,
      number,
    }
    dispatch({ type: "add-count", count })
    window.setTimeout(() => commit("Add Count", []), 0)
  }

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="border-b border-[var(--ps-divider)] p-2">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">Annotations</div>
        <div className="grid grid-cols-3 gap-1 text-[10px] tabular-nums text-[var(--ps-text-dim)]">
          <Metric label="Notes" value={notes.length} />
          <Metric label="Counts" value={counts.length} />
          <Metric label="Groups" value={Object.keys(groupTotals).length} />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
        <Section title="Notes">
          <div className="grid grid-cols-[1fr_36px_auto] gap-1">
            <input
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              className="h-7 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 outline-none"
            />
            <input
              type="color"
              value={noteColor}
              onChange={(event) => setNoteColor(event.target.value)}
              className="h-7 w-9 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-0.5"
            />
            <SmallButton label="Add" onClick={addNote} />
          </div>
          <div className="divide-y divide-[var(--ps-divider)] rounded-sm border border-[var(--ps-divider)]">
            {notes.length === 0 ? (
              <div className="px-2 py-3 text-center text-[var(--ps-text-dim)]">No notes</div>
            ) : (
              notes.map((note) => (
                <div key={note.id} className="space-y-1.5 px-2 py-2">
                  <div className="grid grid-cols-[20px_1fr_auto] items-center gap-1">
                    <span className="h-4 w-4 rounded-sm border border-[var(--ps-divider)]" style={{ backgroundColor: note.color }} />
                    <span className="truncate text-[var(--ps-text-dim)]">
                      {Math.round(note.x)}, {Math.round(note.y)}
                    </span>
                    <SmallButton label="Delete" onClick={() => dispatch({ type: "remove-note", id: note.id })} />
                  </div>
                  <textarea
                    value={note.text}
                    rows={2}
                    onChange={(event) => updateNote(note.id, { text: event.target.value })}
                    onBlur={() => commit("Edit Note", [])}
                    className="w-full resize-none rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-[11px] outline-none"
                  />
                  <div className="grid grid-cols-3 gap-1">
                    <NumberField label="X" value={note.x} onChange={(value) => updateNote(note.id, { x: clampPoint(value, activeDoc.width) })} />
                    <NumberField label="Y" value={note.y} onChange={(value) => updateNote(note.id, { y: clampPoint(value, activeDoc.height) })} />
                    <input
                      type="color"
                      value={note.color}
                      onChange={(event) => updateNote(note.id, { color: event.target.value })}
                      className="h-7 w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-0.5"
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </Section>

        <Section title="Counts">
          <div className="grid grid-cols-[72px_1fr_auto] items-center gap-1">
            <span className="text-[var(--ps-text-dim)]">Group</span>
            <input
              value={group}
              onChange={(event) => dispatch({ type: "set-count-group", group: event.target.value || "A" })}
              className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 outline-none"
            />
            <SmallButton label="Add" onClick={addCount} />
          </div>
          <div className="flex flex-wrap gap-1">
            {Object.entries(groupTotals).map(([name, total]) => (
              <span key={name} className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-[10px]">
                {name}: {total}
              </span>
            ))}
          </div>
          <div className="divide-y divide-[var(--ps-divider)] rounded-sm border border-[var(--ps-divider)]">
            {counts.length === 0 ? (
              <div className="px-2 py-3 text-center text-[var(--ps-text-dim)]">No count markers</div>
            ) : (
              counts.map((count) => (
                <div key={count.id} className="grid grid-cols-[1fr_auto] items-center gap-1 px-2 py-1.5">
                  <span className="truncate">
                    {count.group} #{count.number} at {Math.round(count.x)}, {Math.round(count.y)}
                  </span>
                  <SmallButton label="Delete" onClick={() => dispatch({ type: "remove-count", id: count.id })} />
                </div>
              ))
            )}
          </div>
          <SmallButton label="Clear Counts" disabled={!counts.length} onClick={() => dispatch({ type: "clear-counts" })} />
        </Section>

        <Section title="Measurement">
          {measurement ? (
            <div className="space-y-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
              <div className="grid grid-cols-2 gap-1 tabular-nums">
                <span>Dx {Math.round(measurement.x2 - measurement.x1)} px</span>
                <span>Dy {Math.round(measurement.y2 - measurement.y1)} px</span>
                <span>Len {Math.round(Math.hypot(measurement.x2 - measurement.x1, measurement.y2 - measurement.y1))} px</span>
                <span>Angle {Math.round((Math.atan2(measurement.y2 - measurement.y1, measurement.x2 - measurement.x1) * 180) / Math.PI)} deg</span>
              </div>
              <SmallButton label="Clear Measurement" onClick={() => dispatch({ type: "set-measurement", m: null })} />
            </div>
          ) : (
            <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-3 text-center text-[var(--ps-text-dim)]">
              No active measurement
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1.5 py-1">
      <span className="text-[var(--ps-text-dim)]">{label}</span> {value}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">{title}</div>
      {children}
    </div>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-1 text-[10px] text-[var(--ps-text-dim)]">
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? Math.round(value) : 0}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px] text-[var(--ps-text)] outline-none"
      />
    </label>
  )
}

function SmallButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[10px] hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
    >
      {label}
    </button>
  )
}

function PanelEmpty({ text }: { text: string }) {
  return <div className="px-4 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">{text}</div>
}
