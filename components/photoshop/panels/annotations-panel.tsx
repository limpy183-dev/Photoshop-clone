"use client"

import * as React from "react"
import { useEditor } from "../editor-context"
import { downloadBlob, downloadText } from "../document-io"
import { appendThreadReply, createReviewReport, createReviewThread, describeAnnotationGeometry, normalizeAnnotationGeometry, setThreadResolved } from "../collaboration"
import type { AnnotationGeometry, CountMarker, Note, PsDocument } from "../types"
import { uid } from "../uid"

type AnnotationStatusFilter = "open" | "resolved" | "all"

interface AnnotationFilter {
  status: AnnotationStatusFilter
  author: string
}

function clampPoint(value: number, max: number) {
  return Math.max(0, Math.min(max, Math.round(value)))
}

export function extractMentionNames(text: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const match of text.matchAll(/(^|[\s(])@([A-Za-z][A-Za-z0-9_.-]{1,31})/g)) {
    const name = match[2].replace(/[.,;:!?)]$/g, "")
    const key = name.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      names.push(name)
    }
  }
  return names
}

function isReviewNote(note: Note) {
  return note.kind === "comment" || note.kind === "annotation" || !!note.status || !!note.geometry || !!note.replies?.length
}

export function filterAnnotationNotes(notes: readonly Note[], filter: AnnotationFilter): Note[] {
  return notes.filter((note) => {
    if (!isReviewNote(note)) return false
    const status = note.status ?? "open"
    if (filter.status !== "all" && status !== filter.status) return false
    if (filter.author !== "all" && note.author !== filter.author) return false
    return true
  })
}

function offsetGeometry(geometry: AnnotationGeometry | undefined, dx: number, dy: number, bounds: { width: number; height: number }): AnnotationGeometry | undefined {
  if (!geometry) return geometry
  if (geometry.kind === "pin") return { ...geometry, x: clampPoint(geometry.x + dx, bounds.width), y: clampPoint(geometry.y + dy, bounds.height) }
  if (geometry.kind === "rect" || geometry.kind === "ellipse") {
    return {
      ...geometry,
      x: clampPoint(geometry.x + dx, Math.max(0, bounds.width - geometry.w)),
      y: clampPoint(geometry.y + dy, Math.max(0, bounds.height - geometry.h)),
    }
  }
  if (geometry.kind === "arrow") {
    return {
      ...geometry,
      x1: clampPoint(geometry.x1 + dx, bounds.width),
      y1: clampPoint(geometry.y1 + dy, bounds.height),
      x2: clampPoint(geometry.x2 + dx, bounds.width),
      y2: clampPoint(geometry.y2 + dy, bounds.height),
    }
  }
  return {
    ...geometry,
    points: geometry.points.map((point) => ({ x: clampPoint(point.x + dx, bounds.width), y: clampPoint(point.y + dy, bounds.height) })),
  }
}

export function moveAnnotationNote(note: Note, point: { x: number; y: number }, bounds: { width: number; height: number }): Note {
  const x = clampPoint(point.x, bounds.width)
  const y = clampPoint(point.y, bounds.height)
  return {
    ...note,
    x,
    y,
    geometry: offsetGeometry(note.geometry, x - note.x, y - note.y, bounds),
    updatedAt: Date.now(),
  }
}

async function buildAnnotationsPdf(doc: Pick<PsDocument, "name" | "width" | "height" | "notes">) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib")
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${doc.name} annotations`)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pageW = Math.max(320, Math.min(900, doc.width))
  const pageH = Math.max(320, Math.min(900, doc.height))
  const page = pdf.addPage([pageW, pageH])
  page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: rgb(0.97, 0.97, 0.95) })
  const sx = pageW / Math.max(1, doc.width)
  const sy = pageH / Math.max(1, doc.height)
  const notes = filterAnnotationNotes(doc.notes ?? [], { status: "all", author: "all" })
  notes.forEach((note, index) => {
    const x = note.x * sx
    const y = pageH - note.y * sy
    page.drawCircle({ x, y, size: 5, color: rgb(0.95, 0.72, 0.15) })
    page.drawText(String(index + 1), { x: x + 8, y: y + 2, size: 9, font, color: rgb(0.1, 0.1, 0.1) })
  })
  let y = pageH - 24
  for (const [index, note] of notes.entries()) {
    const status = note.status ?? "open"
    const line = `${index + 1}. ${status.toUpperCase()} ${note.author}: ${note.text}`.slice(0, 160)
    page.drawText(line, { x: 24, y, size: 9, font, color: rgb(0.08, 0.08, 0.08) })
    y -= 13
    if (y < 24) break
  }
  const bytes = await pdf.save()
  return new Blob([bytes], { type: "application/pdf" })
}

export function AnnotationsPanel() {
  const { activeDoc, dispatch, commit } = useEditor()
  const [author, setAuthor] = React.useState("Reviewer")
  const [noteText, setNoteText] = React.useState("Review note")
  const [noteColor, setNoteColor] = React.useState("#facc15")
  const [geometryKind, setGeometryKind] = React.useState<AnnotationGeometry["kind"]>("pin")
  const [geometryW, setGeometryW] = React.useState(160)
  const [geometryH, setGeometryH] = React.useState(96)
  const [statusFilter, setStatusFilter] = React.useState<AnnotationStatusFilter>("all")
  const [authorFilter, setAuthorFilter] = React.useState("all")
  const [replyDrafts, setReplyDrafts] = React.useState<Record<string, string>>({})
  const [dragNoteId, setDragNoteId] = React.useState<string | null>(null)

  if (!activeDoc) return <PanelEmpty text="No document open" />

  const notes = activeDoc.notes ?? []
  const authors = Array.from(new Set(notes.map((note) => note.author).filter(Boolean))).sort()
  const visibleNotes = filterAnnotationNotes(notes, { status: statusFilter, author: authorFilter })
  const counts = activeDoc.counts ?? []
  const group = activeDoc.countGroup ?? "A"
  const measurement = activeDoc.measurement
  const groupTotals = counts.reduce<Record<string, number>>((totals, count) => {
    totals[count.group] = (totals[count.group] ?? 0) + 1
    return totals
  }, {})

  const annotationGeometry = (): AnnotationGeometry => {
    const x = Math.round(activeDoc.width / 2)
    const y = Math.round(activeDoc.height / 2)
    const w = Math.min(Math.max(1, geometryW), activeDoc.width)
    const h = Math.min(Math.max(1, geometryH), activeDoc.height)
    const raw =
      geometryKind === "rect" || geometryKind === "ellipse"
        ? { kind: geometryKind, x: x - Math.round(w / 2), y: y - Math.round(h / 2), w, h }
        : geometryKind === "arrow"
          ? { kind: "arrow", x1: x - Math.round(w / 2), y1: y - Math.round(h / 2), x2: x + Math.round(w / 2), y2: y + Math.round(h / 2) }
          : geometryKind === "freehand"
            ? { kind: "freehand", points: [{ x: x - w / 2, y }, { x, y: y - h / 2 }, { x: x + w / 2, y }, { x, y: y + h / 2 }], closed: true }
            : { kind: "pin", x, y }
    return normalizeAnnotationGeometry(raw, { width: activeDoc.width, height: activeDoc.height, anchor: { x, y } })
  }

  const addNote = () => {
    const geometry = annotationGeometry()
    const note: Note = {
      ...createReviewThread({
        id: uid("note"),
        x: Math.round(activeDoc.width / 2),
        y: Math.round(activeDoc.height / 2),
        author,
        text: noteText.trim() || "Review note",
        color: noteColor,
        kind: "annotation",
        geometry,
        now: Date.now(),
      }),
    }
    dispatch({ type: "add-note", note })
    window.setTimeout(() => commit("Add Note", []), 0)
  }

  const updateNote = (id: string, patch: Partial<Note>) => {
    dispatch({ type: "update-note", id, patch })
  }

  const resolveNote = (note: Note, resolved: boolean) => {
    const next = setThreadResolved(note, resolved, { by: author, now: Date.now() })
    updateNote(note.id, { status: next.status, resolvedAt: next.resolvedAt, resolvedBy: next.resolvedBy, updatedAt: next.updatedAt })
    window.setTimeout(() => commit(resolved ? "Resolve Comment" : "Reopen Comment", []), 0)
  }

  const replyToNote = (note: Note) => {
    const text = (replyDrafts[note.id] ?? "").trim()
    if (!text) return
    const next = appendThreadReply(note, { id: uid("reply"), author, text, now: Date.now() })
    updateNote(note.id, { replies: next.replies, kind: next.kind, updatedAt: next.updatedAt })
    setReplyDrafts((drafts) => ({ ...drafts, [note.id]: "" }))
    window.setTimeout(() => commit("Reply to Comment", []), 0)
  }

  const exportPdf = async () => {
    const blob = await buildAnnotationsPdf(activeDoc)
    downloadBlob(blob, `${activeDoc.name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-")}-annotations.pdf`)
  }

  const dropOnPad = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const id = dragNoteId ?? event.dataTransfer.getData("text/plain")
    const note = notes.find((candidate) => candidate.id === id)
    if (!note) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * activeDoc.width
    const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * activeDoc.height
    updateNote(note.id, moveAnnotationNote(note, { x, y }, { width: activeDoc.width, height: activeDoc.height }))
    setDragNoteId(null)
    window.setTimeout(() => commit("Move Comment Pin", []), 0)
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
              value={author}
              onChange={(event) => setAuthor(event.target.value || "Reviewer")}
              list="annotation-authors"
              aria-label="Annotation author"
              className="h-7 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 outline-none"
            />
            <input
              type="color"
              value={noteColor}
              onChange={(event) => setNoteColor(event.target.value)}
              className="h-7 w-9 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-0.5"
            />
            <SmallButton label="PDF" onClick={() => void exportPdf()} />
          </div>
          <datalist id="annotation-authors">
            {authors.map((name) => <option key={name} value={name} />)}
          </datalist>
          <div className="grid grid-cols-[1fr_36px_auto] gap-1">
            <input
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              list="annotation-authors"
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
          <div className="grid grid-cols-[1fr_64px_64px_auto] gap-1">
            <select
              value={geometryKind}
              onChange={(event) => setGeometryKind(event.target.value as AnnotationGeometry["kind"])}
              className="h-7 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 outline-none"
            >
              <option value="pin">Pin</option>
              <option value="rect">Rectangle</option>
              <option value="ellipse">Ellipse</option>
              <option value="arrow">Arrow</option>
              <option value="freehand">Freehand</option>
            </select>
            <input
              type="number"
              value={geometryW}
              onChange={(event) => setGeometryW(Number(event.target.value) || 1)}
              className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px] outline-none"
              aria-label="Annotation width"
            />
            <input
              type="number"
              value={geometryH}
              onChange={(event) => setGeometryH(Number(event.target.value) || 1)}
              className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px] outline-none"
              aria-label="Annotation height"
            />
            <SmallButton
              label="Report"
              onClick={() => downloadText(createReviewReport(activeDoc), `${activeDoc.name}-review-report.md`, "text/markdown")}
            />
          </div>
          <div className="grid grid-cols-2 gap-1">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as AnnotationStatusFilter)}
              aria-label="Filter comments by status"
              className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 outline-none"
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
            </select>
            <select
              value={authorFilter}
              onChange={(event) => setAuthorFilter(event.target.value)}
              aria-label="Filter comments by author"
              className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 outline-none"
            >
              <option value="all">All authors</option>
              {authors.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div
            className="relative h-20 rounded-sm border border-dashed border-[var(--ps-divider)] bg-[var(--ps-panel-2)]"
            onDragOver={(event) => event.preventDefault()}
            onDrop={dropOnPad}
            title="Drag a comment row here to reposition its pin."
          >
            <div className="absolute inset-0 grid place-items-center text-[10px] text-[var(--ps-text-dim)]">Drop comment pin to reposition</div>
          </div>
          <div className="divide-y divide-[var(--ps-divider)] rounded-sm border border-[var(--ps-divider)]">
            {visibleNotes.length === 0 ? (
              <div className="px-2 py-3 text-center text-[var(--ps-text-dim)]">No notes</div>
            ) : (
              visibleNotes.map((note) => (
                <div
                  key={note.id}
                  className="space-y-1.5 px-2 py-2"
                  draggable
                  onDragStart={(event) => {
                    setDragNoteId(note.id)
                    event.dataTransfer.setData("text/plain", note.id)
                  }}
                  onDragEnd={() => setDragNoteId(null)}
                >
                  <div className="grid grid-cols-[20px_1fr_auto] items-center gap-1">
                    <span className="h-4 w-4 rounded-sm border border-[var(--ps-divider)]" style={{ backgroundColor: note.color }} />
                    <span className="truncate text-[var(--ps-text-dim)]">
                      {note.author} - {note.status ?? "open"} - {Math.round(note.x)}, {Math.round(note.y)}
                      {note.geometry ? ` - ${describeAnnotationGeometry(note.geometry)}` : ""}
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
                  <div className="flex flex-wrap gap-1">
                    {extractMentionNames(note.text).map((name) => (
                      <span key={name} className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)] px-1.5 py-0.5 text-[10px] text-[var(--ps-text-dim)]">@{name}</span>
                    ))}
                  </div>
                  <div className="grid grid-cols-[1fr_auto_auto] gap-1">
                    <input
                      value={replyDrafts[note.id] ?? ""}
                      onChange={(event) => setReplyDrafts((drafts) => ({ ...drafts, [note.id]: event.target.value }))}
                      list="annotation-authors"
                      placeholder="Reply or @mention"
                      className="h-7 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 outline-none"
                    />
                    <SmallButton label="Reply" onClick={() => replyToNote(note)} />
                    <SmallButton label={(note.status ?? "open") === "resolved" ? "Reopen" : "Resolve"} onClick={() => resolveNote(note, (note.status ?? "open") !== "resolved")} />
                  </div>
                  {note.replies?.length ? (
                    <div className="space-y-0.5 rounded-sm bg-[var(--ps-panel)] px-2 py-1 text-[10px]">
                      {note.replies.map((reply) => <div key={reply.id}><span className="text-[var(--ps-text-dim)]">{reply.author}:</span> {reply.text}</div>)}
                    </div>
                  ) : null}
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
