"use client"

import * as React from "react"
import { Camera, Download, RotateCcw, RotateCw, Search, Trash2 } from "lucide-react"
import { useEditor } from "../editor-context"
import { downloadText } from "../document-io"
import { cn } from "@/lib/utils"
import type { HistoryEntry } from "../types"

export function HistoryPanel() {
  const {
    history,
    historyIndex,
    snapshots,
    jumpHistory,
    stepHistoryBy,
    activeDoc,
    createHistorySnapshot,
    restoreHistorySnapshot,
    deleteHistorySnapshot,
  } = useEditor()
  const [snapshotName, setSnapshotName] = React.useState("")
  const [query, setQuery] = React.useState("")
  const [view, setView] = React.useState<"all" | "past" | "current" | "future">("all")

  const createSnapshot = () => {
    createHistorySnapshot(snapshotName.trim() || `Snapshot ${snapshots.length + 1}`)
    setSnapshotName("")
  }

  const q = query.trim().toLowerCase()
  const currentEntry = history[historyIndex]
  const visibleSnapshots = snapshots.filter((snapshot) => !q || snapshot.name.toLowerCase().includes(q))
  const visibleHistory = history
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => {
      if (view === "past" && index >= historyIndex) return false
      if (view === "current" && index !== historyIndex) return false
      if (view === "future" && index <= historyIndex) return false
      return !q || entry.label.toLowerCase().includes(q)
    })

  const exportHistory = () => {
    if (!activeDoc) return
    downloadText(
      JSON.stringify(
        {
          app: "Photoshop Web",
          format: "ps-history-report",
          version: 1,
          document: activeDoc.name,
          exportedAt: new Date().toISOString(),
          currentIndex: historyIndex,
          history: history.map(describeHistoryEntry),
          snapshots: snapshots.map((snapshot) => ({
            id: snapshot.id,
            name: snapshot.name,
            createdAt: snapshot.createdAt,
            entry: describeHistoryEntry(snapshot.entry, -1),
          })),
        },
        null,
        2,
      ),
      `${activeDoc.name}-history.json`,
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--ps-divider)] px-2 py-1.5 text-[10px]">
        <div className="h-7 w-7 border border-[var(--ps-divider)] ps-checker" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{activeDoc?.name ?? "-"}</div>
          <div className="text-[var(--ps-text-dim)]">
            {historyIndex + 1}/{history.length} state{history.length === 1 ? "" : "s"}
            {currentEntry ? ` - ${currentEntry.layers.length} layer${currentEntry.layers.length === 1 ? "" : "s"}` : ""}
          </div>
        </div>
      </div>
      <div className="space-y-1 border-b border-[var(--ps-divider)] px-2 py-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-1.5 top-1.5 h-3 w-3 text-[var(--ps-text-dim)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search history"
            className="h-6 w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] pl-6 pr-2 text-[10px] outline-none focus:border-[var(--ps-accent)]"
            aria-label="Search history"
          />
        </div>
        <select
          value={view}
          onChange={(event) => setView(event.target.value as typeof view)}
          className="h-6 w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          aria-label="History view"
        >
          <option value="all">All states</option>
          <option value="past">Undo states</option>
          <option value="current">Current state</option>
          <option value="future">Redo states</option>
        </select>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-1 border-b border-[var(--ps-divider)] px-2 py-1">
        <input
          aria-label="Snapshot name"
          value={snapshotName}
          onChange={(event) => setSnapshotName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && activeDoc) createSnapshot()
          }}
          placeholder={`Snapshot ${snapshots.length + 1}`}
          className="h-6 min-w-0 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[11px] outline-none focus:border-[var(--ps-accent)]"
        />
        <button
          title="Create snapshot"
          aria-label="Create snapshot"
          onClick={createSnapshot}
          className="flex h-6 w-6 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
          disabled={!activeDoc}
        >
          <Camera className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {visibleSnapshots.length ? (
          <div className="border-b border-[var(--ps-divider)]">
            <div className="flex items-center justify-between px-2 py-1 text-[10px] uppercase text-[var(--ps-text-dim)]">
              <span>Snapshots</span>
              <span>{visibleSnapshots.length}</span>
            </div>
            {visibleSnapshots.map((snapshot) => (
              <div
                key={snapshot.id}
                className="group flex items-center gap-2 border-t border-[var(--ps-divider)]/40 px-2 py-1"
              >
                {snapshot.entry.thumb ? (
                  <img
                    src={snapshot.entry.thumb}
                    alt=""
                    className="h-6 w-6 border border-[var(--ps-divider)] object-cover"
                  />
                ) : (
                  <div className="h-6 w-6 border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]" />
                )}
                <button
                  className="min-w-0 flex-1 truncate text-left hover:text-[var(--ps-text)]"
                  title={new Date(snapshot.createdAt).toLocaleString()}
                  onClick={() => restoreHistorySnapshot(snapshot.id)}
                >
                  {snapshot.name}
                </button>
                <button
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm opacity-0 hover:bg-[var(--ps-tool-hover)] group-hover:opacity-100"
                  title="Delete snapshot"
                  onClick={() => deleteHistorySnapshot(snapshot.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {visibleHistory.map(({ entry, index }) => (
          <button
            key={entry.id}
            onClick={() => jumpHistory(index)}
            className={cn(
              "flex w-full items-center gap-2 border-b border-[var(--ps-divider)]/40 px-2 py-1 text-left text-[11px]",
              index === historyIndex
                ? "bg-[var(--ps-tool-active)] text-[var(--ps-text)]"
                : index > historyIndex
                  ? "opacity-50 hover:bg-[var(--ps-tool-hover)]"
                  : "hover:bg-[var(--ps-tool-hover)]",
            )}
          >
            <span className="inline-block w-3">
              {index === historyIndex ? <span className="text-[var(--ps-accent)]">&gt;</span> : null}
            </span>
            {entry.thumb ? (
              <img
                src={entry.thumb}
                alt=""
                className="h-6 w-6 border border-[var(--ps-divider)] object-cover"
              />
            ) : (
              <div className="h-6 w-6 border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{entry.label}</span>
              <span className="block truncate text-[9px] text-[var(--ps-text-dim)]">
                {entry.layers.length} layer{entry.layers.length === 1 ? "" : "s"}
                {entry.selection?.bounds ? " - selection" : ""}
                {index > historyIndex ? " - redo" : index < historyIndex ? " - undo" : " - current"}
              </span>
            </span>
          </button>
        ))}
        {visibleHistory.length === 0 && visibleSnapshots.length === 0 ? (
          <div className="px-3 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">No history states match.</div>
        ) : null}
      </div>
      <div className="flex items-center gap-1 border-t border-[var(--ps-divider)] px-1 py-1 text-[var(--ps-text)]">
        <button
          title="Step backward"
          aria-label="Step backward"
          // Calling stepHistoryBy(-1) reads the latest history index from
          // the editor's internal stateRef instead of the closure value
          // captured at render time. This matters when the user clicks
          // the button rapidly: each click advances exactly one step
          // even if the React re-render with the new historyIndex
          // hasn't committed yet.
          onClick={() => stepHistoryBy(-1)}
          className="flex h-7 w-7 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
          disabled={historyIndex <= 0}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          title="Step forward"
          aria-label="Step forward"
          onClick={() => stepHistoryBy(1)}
          className="flex h-7 w-7 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
          disabled={historyIndex >= history.length - 1}
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
        <button
          title="Export history report"
          aria-label="Export history report"
          onClick={exportHistory}
          className="flex h-7 w-7 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:opacity-40"
          disabled={!activeDoc || history.length === 0}
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        <span className="ml-auto pr-1 text-[10px] text-[var(--ps-text-dim)]">
          {Math.max(0, historyIndex)} undo / {Math.max(0, history.length - historyIndex - 1)} redo
        </span>
      </div>
    </div>
  )
}

function describeHistoryEntry(entry: HistoryEntry, index: number) {
  return {
    id: entry.id,
    index,
    label: entry.label,
    width: entry.width,
    height: entry.height,
    layerCount: entry.layers.length,
    selectedLayerCount: entry.selectedLayerIds.length,
    activeLayerId: entry.activeLayerId,
    hasThumbnail: !!entry.thumb,
    hasSelection: !!entry.selection?.bounds,
    guideCount: entry.guides?.length ?? 0,
    noteCount: entry.notes?.length ?? 0,
    sliceCount: entry.slices?.length ?? 0,
    channelCount: entry.channels?.length ?? 0,
    compCount: entry.comps?.length ?? 0,
  }
}
