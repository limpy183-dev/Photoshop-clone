"use client"

import * as React from "react"
import { Camera, Play, Square, Trash2 } from "lucide-react"
import { useActiveDocument, useEditorCommands } from "../editor-context"
import { captureFrameFromDocument } from "../timeline-engine"
import { uid } from "../uid"
import type { Note, TimelineFrame } from "../types"
import { downloadBlob, downloadText } from "../document-io"
import { appendThreadReply, createReviewPacketEntries, createReviewReport, createReviewThread, setThreadResolved } from "../collaboration"
import { createStoredZipBlob } from "../zip-packaging"
import { TimelinePanel } from "./timeline-panel"

/** The video timeline remains separate; Animation is a frame-animation surface. */
export function AnimationPanel() {
  const activeDoc = useActiveDocument()
  const { dispatch, commit, requestRender } = useEditorCommands()
  const [playing, setPlaying] = React.useState(false)
  if (!activeDoc) return <PanelEmpty text="No document open" />
  const frames = activeDoc.timelineFrames ?? []
  const capture = () => {
    const frame = captureFrameFromDocument(activeDoc)
    dispatch({ type: "set-timeline-frames", frames: [...frames, frame] })
    window.setTimeout(() => commit("Capture Animation Frame", "all"), 0)
  }
  const duplicate = (frame: TimelineFrame) => {
    const copy = { ...frame, id: uid("frame"), name: `${frame.name} copy` }
    dispatch({ type: "set-timeline-frames", frames: [...frames, copy] })
    window.setTimeout(() => commit("Duplicate Animation Frame", "all"), 0)
  }
  const remove = (id: string) => {
    dispatch({ type: "set-timeline-frames", frames: frames.filter((frame) => frame.id !== id) })
    window.setTimeout(() => commit("Delete Animation Frame", "all"), 0)
  }
  return <div className="flex h-full flex-col gap-2 overflow-y-auto p-2 text-[11px] text-[var(--ps-text)]">
    <div className="flex items-center justify-between border-b border-[var(--ps-divider)] pb-2"><span className="font-medium">Frame Animation</span><span className="text-[10px] text-[var(--ps-text-dim)]">{frames.length} frames</span></div>
    <div className="flex gap-1"><button type="button" className="flex min-h-7 items-center gap-1 rounded-sm border border-[var(--ps-divider)] px-2" onClick={capture}><Camera className="h-3 w-3" />Capture</button><button type="button" className="flex min-h-7 items-center gap-1 rounded-sm border border-[var(--ps-divider)] px-2" onClick={() => { setPlaying((value) => !value); requestRender() }}>{playing ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}{playing ? "Stop" : "Preview"}</button></div>
    {frames.length ? frames.map((frame, index) => <div key={frame.id} className="flex items-center gap-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-1.5"><span className="w-5 text-center text-[10px] text-[var(--ps-text-dim)]">{index + 1}</span><span className="min-w-0 flex-1 truncate">{frame.name}</span><span className="text-[10px] text-[var(--ps-text-dim)]">{frame.durationMs}ms</span><button type="button" aria-label={`Duplicate ${frame.name}`} onClick={() => duplicate(frame)} className="p-1"><Camera className="h-3 w-3" /></button><button type="button" aria-label={`Delete ${frame.name}`} onClick={() => remove(frame.id)} className="p-1"><Trash2 className="h-3 w-3" /></button></div>) : <PanelHint text="Capture frames from the current document to build a frame animation." />}
  </div>
}

export function CommentsPanel() {
  const activeDoc = useActiveDocument()
  const { dispatch, commit } = useEditorCommands()
  const [text, setText] = React.useState("Comment")
  const [replyText, setReplyText] = React.useState<Record<string, string>>({})
  const [status, setStatus] = React.useState<"open" | "resolved" | "all">("open")
  if (!activeDoc) return <PanelEmpty text="No document open" />
  const author = activeDoc.metadata?.author?.trim() || "Reviewer"
  const add = () => { const note = createReviewThread({ id: uid("comment"), x: activeDoc.width / 2, y: activeDoc.height / 2, author, text, color: "#38bdf8", now: Date.now() }); dispatch({ type: "add-note", note }); window.setTimeout(() => commit("Add Comment", []), 0) }
  const allThreads = (activeDoc.notes ?? []).filter((note) => note.kind === "comment" || note.status || note.replies?.length)
  const threads = allThreads.filter((note) => status === "all" || (note.status ?? "open") === status)
  const patchThread = (note: Note, patch: Partial<Note>, label: string) => { dispatch({ type: "update-note", id: note.id, patch }); window.setTimeout(() => commit(label, []), 0) }
  const addReply = (note: Note) => { const reply = replyText[note.id]?.trim(); if (!reply) return; const next = appendThreadReply(note, { id: uid("reply"), author, text: reply, now: Date.now() }); patchThread(note, { replies: next.replies, updatedAt: next.updatedAt, kind: next.kind }, "Reply to Comment"); setReplyText((current) => ({ ...current, [note.id]: "" })) }
  return <PanelShell title="Comments"><div className="grid grid-cols-[1fr_auto] gap-1"><input aria-label="Comment text" value={text} onChange={(event) => setText(event.target.value)} className={inputClass} /><SmallButton label={`Add as ${author}`} onClick={add} /></div><div className="grid grid-cols-[1fr_auto] gap-1"><select aria-label="Comment status filter" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className={inputClass}><option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All</option></select><div className="flex gap-1"><SmallButton label="Export" onClick={() => downloadText(createReviewReport(activeDoc), `${activeDoc.name}-review-report.md`, "text/markdown")} /><SmallButton label="Packet" onClick={() => downloadBlob(createStoredZipBlob(createReviewPacketEntries(activeDoc)), `${activeDoc.name}-review-packet.zip`)} /></div></div>{threads.length ? threads.map((note) => <div key={note.id} className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2"><div className="flex items-center justify-between gap-2 text-[10px] text-[var(--ps-text-dim)]"><span>{note.author} - {note.status ?? "open"}</span><SmallButton label={(note.status ?? "open") === "resolved" ? "Reopen" : "Resolve"} onClick={() => { const next = setThreadResolved(note, (note.status ?? "open") !== "resolved", { by: author, now: Date.now() }); patchThread(note, { status: next.status, resolvedAt: next.resolvedAt, resolvedBy: next.resolvedBy, updatedAt: next.updatedAt }, "Update Comment") }} /></div><div>{note.text}</div>{note.replies?.map((reply) => <div key={reply.id} className="border-l border-[var(--ps-divider)] pl-2 text-[10px]">{reply.author}: {reply.text}</div>)}<div className="grid grid-cols-[1fr_auto] gap-1"><input value={replyText[note.id] ?? ""} onChange={(event) => setReplyText((current) => ({ ...current, [note.id]: event.target.value }))} className={inputClass} aria-label={`Reply to ${note.text}`} placeholder={`Reply as ${author}`} /><SmallButton label="Reply" onClick={() => addReply(note)} /></div></div>) : <PanelHint text="No comments in this view." />}</PanelShell>
}

export function TimelineAliasPanel() { return <TimelinePanel /> }
function PanelShell({ title, children }: { title: string; children: React.ReactNode }) { return <div className="flex h-full flex-col gap-2 overflow-y-auto p-2 text-[11px] text-[var(--ps-text)]"><div className="text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">{title}</div>{children}</div> }
function PanelHint({ text }: { text: string }) { return <div className="rounded-sm border border-dashed border-[var(--ps-divider)] p-3 text-center text-[var(--ps-text-dim)]">{text}</div> }
function PanelEmpty({ text }: { text: string }) { return <div className="px-4 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">{text}</div> }
function SmallButton({ label, onClick }: { label: string; onClick: () => void }) { return <button type="button" onClick={onClick} className="min-h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 py-1 text-left text-[10px]">{label}</button> }
const inputClass = "h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] outline-none"
