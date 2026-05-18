"use client"

import * as React from "react"
import { Camera, RotateCcw, RotateCw, Trash2 } from "lucide-react"
import { useEditor } from "../editor-context"
import { cn } from "@/lib/utils"

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

  const createSnapshot = () => {
    createHistorySnapshot(snapshotName.trim() || `Snapshot ${snapshots.length + 1}`)
    setSnapshotName("")
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--ps-divider)] px-2 py-1.5 text-[10px]">
        <div className="h-7 w-7 border border-[var(--ps-divider)] ps-checker" />
        <span className="font-medium">{activeDoc?.name ?? "-"}</span>
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
        {snapshots.length ? (
          <div className="border-b border-[var(--ps-divider)]">
            <div className="px-2 py-1 text-[10px] uppercase text-[var(--ps-text-dim)]">Snapshots</div>
            {snapshots.map((snapshot) => (
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

        {history.map((entry, index) => (
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
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
          </button>
        ))}
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
        <span className="ml-auto pr-1 text-[10px] text-[var(--ps-text-dim)]">
          {history.length} state{history.length === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  )
}
