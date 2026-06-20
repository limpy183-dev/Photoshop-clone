"use client"

import * as React from "react"
import { useEditor } from "../editor-context"
import { downloadBlob, downloadText } from "../document-io"
import type { Note } from "../types"
import { uid } from "../uid"
import { appendThreadReply, createReviewPacketEntries, createReviewReport, createReviewThread, setThreadResolved } from "../collaboration"
import { createStoredZipBlob } from "../zip-packaging"
import { TimelinePanel } from "./timeline-panel"

/**
 * `gap-panels.tsx` used to host every panel that lacked a dedicated module.
 * The Glyphs, Libraries, Learn, Discover, Notes, Measurement Log, Styles,
 * and Shapes panels now have their own files under `components/photoshop/panels/`.
 *
 * Only the small Animation alias (re-export of TimelinePanel) and the
 * feature-complete Comments review panel remain here.
 */

export function AnimationPanel() {
  return <TimelinePanel />
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
        <div className="flex gap-1">
          <SmallButton
            label="Export"
            onClick={() => downloadText(createReviewReport(activeDoc), `${activeDoc.name}-review-report.md`, "text/markdown")}
          />
          <SmallButton
            label="Packet"
            ariaLabel="Export review packet ZIP"
            onClick={() => downloadBlob(createStoredZipBlob(createReviewPacketEntries(activeDoc)), `${activeDoc.name}-review-packet.zip`)}
          />
        </div>
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
