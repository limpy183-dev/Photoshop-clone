"use client"

import * as React from "react"
import {
  ArrowDownAZ,
  Filter,
  MessageSquarePlus,
  Pencil,
  Reply,
  Save,
  StickyNote,
  Target,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useEditor } from "../editor-context"
import { uid } from "../uid"
import { appendThreadReply } from "../collaboration"
import type { Note } from "../types"

const DEFAULT_AUTHOR = "You"
const AUTHOR_STORAGE_KEY = "ps-notes-author"

type SortMode = "newest" | "oldest" | "author"
type DateBucket = "all" | "today" | "week" | "month"

interface NoteListFilter {
  authorFilter: string
  dateBucket: DateBucket
  sortMode: SortMode
  now?: number
}

function readAuthor() {
  if (typeof window === "undefined") return DEFAULT_AUTHOR
  try {
    return localStorage.getItem(AUTHOR_STORAGE_KEY) ?? DEFAULT_AUTHOR
  } catch {
    return DEFAULT_AUTHOR
  }
}

function writeAuthor(name: string) {
  if (typeof window === "undefined") return
  try { localStorage.setItem(AUTHOR_STORAGE_KEY, name) } catch {}
}

function formatTime(value: number | undefined) {
  if (!value || !Number.isFinite(value)) return ""
  try {
    const date = new Date(value)
    return date.toLocaleString()
  } catch {
    return ""
  }
}

function withinDateBucket(timestamp: number | undefined, bucket: DateBucket, now = Date.now()): boolean {
  if (bucket === "all") return true
  if (!timestamp) return false
  switch (bucket) {
    case "today": return now - timestamp < 24 * 60 * 60 * 1000
    case "week": return now - timestamp < 7 * 24 * 60 * 60 * 1000
    case "month": return now - timestamp < 30 * 24 * 60 * 60 * 1000
    default: return true
  }
}

/**
 * A Note belongs to a thread if it has the "note" kind, no kind (legacy),
 * or any of the reply structures. The Comments panel covers "comment" /
 * "annotation" threads — Notes panel intentionally focuses on the simpler
 * sticky-note workflow.
 */
function isStickyNote(note: Note): boolean {
  if (!note) return false
  if (!note.kind || note.kind === "note") return true
  return false
}

function filterAndSortNotes(notes: readonly Note[], filter: NoteListFilter): Note[] {
  const visible = notes.filter((note) => {
    if (!isStickyNote(note)) return false
    if (filter.authorFilter !== "all" && note.author !== filter.authorFilter) return false
    if (!withinDateBucket(note.createdAt ?? note.updatedAt, filter.dateBucket, filter.now)) return false
    return true
  })
  visible.sort((a, b) => {
    if (filter.sortMode === "author") return (a.author ?? "").localeCompare(b.author ?? "")
    const aTime = a.createdAt ?? a.updatedAt ?? 0
    const bTime = b.createdAt ?? b.updatedAt ?? 0
    return filter.sortMode === "newest" ? bTime - aTime : aTime - bTime
  })
  return visible
}

export function NotesPanel() {
  const { activeDoc, dispatch, commit } = useEditor()
  const [author, setAuthor] = React.useState<string>(readAuthor)
  const [draft, setDraft] = React.useState("")
  const [authorFilter, setAuthorFilter] = React.useState<string>("all")
  const [dateBucket, setDateBucket] = React.useState<DateBucket>("all")
  const [sortMode, setSortMode] = React.useState<SortMode>("newest")
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editingText, setEditingText] = React.useState("")
  const [replyDrafts, setReplyDrafts] = React.useState<Record<string, string>>({})

  const allNotes = React.useMemo(() => activeDoc?.notes ?? [], [activeDoc?.notes])
  const noteList = React.useMemo(() => allNotes.filter(isStickyNote), [allNotes])

  const authors = React.useMemo(() => {
    const set = new Set<string>()
    for (const note of noteList) if (note.author) set.add(note.author)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [noteList])

  const visible = React.useMemo(() => {
    return filterAndSortNotes(allNotes, { authorFilter, dateBucket, sortMode })
  }, [allNotes, authorFilter, dateBucket, sortMode])

  if (!activeDoc) {
    return <div className="px-4 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">No document open.</div>
  }

  const addNote = () => {
    const text = draft.trim()
    if (!text) return
    const now = Date.now()
    const note: Note = {
      id: uid("note"),
      x: Math.round(activeDoc.width / 2),
      y: Math.round(activeDoc.height / 2),
      author,
      text,
      color: "#facc15",
      kind: "note",
      replies: [],
      createdAt: now,
      updatedAt: now,
    }
    dispatch({ type: "add-note", note })
    setDraft("")
    window.setTimeout(() => commit("Add Note", []), 0)
  }

  const focusNote = (note: Note) => {
    if (typeof window === "undefined") return
    window.dispatchEvent(new CustomEvent("ps-navigator-pan", { detail: { x: note.x, y: note.y } }))
  }

  const startEdit = (note: Note) => {
    setEditingId(note.id)
    setEditingText(note.text)
  }

  const saveEdit = (note: Note) => {
    const trimmed = editingText.trim()
    if (!trimmed) return
    dispatch({ type: "update-note", id: note.id, patch: { text: trimmed, updatedAt: Date.now() } })
    window.setTimeout(() => commit("Edit Note", []), 0)
    setEditingId(null)
    setEditingText("")
  }

  const removeNote = (note: Note) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete note from ${note.author ?? "Unknown"}?`)) return
    dispatch({ type: "remove-note", id: note.id })
    window.setTimeout(() => commit("Delete Note", []), 0)
  }

  const submitReply = (note: Note) => {
    const text = replyDrafts[note.id]?.trim()
    if (!text) return
    const updated = appendThreadReply(note, { id: uid("reply"), author, text, now: Date.now() })
    dispatch({
      type: "update-note",
      id: note.id,
      patch: {
        replies: updated.replies,
        updatedAt: updated.updatedAt,
        kind: updated.kind ?? "note",
      },
    })
    setReplyDrafts((current) => ({ ...current, [note.id]: "" }))
    window.setTimeout(() => commit("Reply to Note", []), 0)
  }

  const totalReplies = noteList.reduce((sum, note) => sum + (note.replies?.length ?? 0), 0)

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="space-y-2 border-b border-[var(--ps-divider)] p-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
          <StickyNote className="h-3 w-3" /> Notes ({noteList.length}) - {totalReplies} replies
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-1">
          <Input
            value={author}
            onChange={(event) => {
              setAuthor(event.target.value)
              writeAuthor(event.target.value)
            }}
            placeholder="Your name"
            className="h-7 bg-[var(--ps-panel-2)] text-[11px]"
            aria-label="Note author"
          />
          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={addNote} disabled={!draft.trim()}>
            <MessageSquarePlus className="h-3 w-3" /> Add
          </Button>
        </div>
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Write a sticky note for this document"
          rows={2}
          className="min-h-12 resize-none bg-[var(--ps-panel-2)] text-[11px]"
          aria-label="Note draft"
        />
        <div className="grid grid-cols-3 gap-1">
          <select
            value={authorFilter}
            onChange={(event) => setAuthorFilter(event.target.value)}
            className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] outline-none"
            aria-label="Filter by author"
          >
            <option value="all">All authors</option>
            {authors.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select
            value={dateBucket}
            onChange={(event) => setDateBucket(event.target.value as DateBucket)}
            className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] outline-none"
            aria-label="Filter by date"
          >
            <option value="all">Any date</option>
            <option value="today">Past day</option>
            <option value="week">Past week</option>
            <option value="month">Past month</option>
          </select>
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as SortMode)}
            className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] outline-none"
            aria-label="Sort"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="author">By author</option>
          </select>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2 space-y-2">
        {visible.length ? visible.map((note) => (
          <article
            key={note.id}
            className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2"
          >
            <header className="flex items-start justify-between gap-2 text-[10px] text-[var(--ps-text-dim)]">
              <div className="flex flex-col">
                <span className="text-[11px] text-[var(--ps-text)]">{note.author || "Unknown"}</span>
                <span>{formatTime(note.createdAt)}</span>
                {note.updatedAt && note.createdAt && note.updatedAt !== note.createdAt ? (
                  <span>Edited {formatTime(note.updatedAt)}</span>
                ) : null}
                <span>{Math.round(note.x)}, {Math.round(note.y)}</span>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[10px]" onClick={() => focusNote(note)}>
                  <Target className="h-3 w-3" /> Go to
                </Button>
                {editingId === note.id ? (
                  <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[10px]" onClick={() => saveEdit(note)}>
                    <Save className="h-3 w-3" /> Save
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[10px]" onClick={() => startEdit(note)}>
                    <Pencil className="h-3 w-3" /> Edit
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[10px] text-red-300" onClick={() => removeNote(note)}>
                  <Trash2 className="h-3 w-3" /> Delete
                </Button>
              </div>
            </header>
            {editingId === note.id ? (
              <div className="mt-2 space-y-1">
                <Textarea
                  value={editingText}
                  onChange={(event) => setEditingText(event.target.value)}
                  rows={3}
                  className="min-h-14 resize-none bg-[var(--ps-panel)] text-[11px]"
                  aria-label="Edit note text"
                />
                <div className="flex justify-end">
                  <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[10px]" onClick={() => setEditingId(null)}>
                    <X className="h-3 w-3" /> Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="mt-2 whitespace-pre-wrap text-[11px] text-[var(--ps-text)]">{note.text}</p>
            )}
            {note.replies?.length ? (
              <div className="mt-2 space-y-1 border-l border-[var(--ps-divider)] pl-2">
                {note.replies.map((reply) => (
                  <div key={reply.id} className="text-[11px]">
                    <span className="text-[var(--ps-text-dim)]">{reply.author}:</span>{" "}
                    <span>{reply.text}</span>
                    <span className="ml-2 text-[10px] text-[var(--ps-text-dim)]">{formatTime(reply.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-1">
              <Input
                value={replyDrafts[note.id] ?? ""}
                onChange={(event) => setReplyDrafts((current) => ({ ...current, [note.id]: event.target.value }))}
                placeholder="Reply"
                className="h-7 bg-[var(--ps-panel)] text-[11px]"
                aria-label={`Reply to note from ${note.author}`}
              />
              <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" onClick={() => submitReply(note)} disabled={!replyDrafts[note.id]?.trim()}>
                <Reply className="h-3 w-3" /> Reply
              </Button>
            </div>
          </article>
        )) : (
          <div className="rounded-sm border border-dashed border-[var(--ps-divider)] p-4 text-center text-[var(--ps-text-dim)]">
            {noteList.length === 0
              ? "No notes yet. Pick the Note tool from the toolbar or add one above."
              : "No notes match the current filter."}
          </div>
        )}
      </div>
      <div className="border-t border-[var(--ps-divider)] p-2 text-[10px] text-[var(--ps-text-dim)]">
        <div className="flex items-center gap-2">
          <Filter className="h-3 w-3" />
          <span>{visible.length} of {noteList.length} shown</span>
          <ArrowDownAZ className="ml-auto h-3 w-3" />
          <span>{sortMode}</span>
        </div>
      </div>
    </div>
  )
}

export const __notesPanelInternals = {
  filterAndSortNotes,
  isStickyNote,
  withinDateBucket,
}
