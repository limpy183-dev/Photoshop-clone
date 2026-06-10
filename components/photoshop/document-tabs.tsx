"use client"

import * as React from "react"
import { useEditor } from "./editor-context"
import { Copy, RotateCcw, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function DocumentTabs() {
  const {
    documents,
    activeDocId,
    closedDocuments,
    documentStatuses,
    dispatch,
    duplicateDocument,
    requestCloseDocument,
    closeOtherDocuments,
    reopenClosedDocument,
    moveLayersToDocument,
  } = useEditor()
  if (!documents.length) {
    return closedDocuments.length ? (
      <div className="h-7 bg-[var(--ps-chrome)] border-b border-[var(--ps-divider)] flex items-center gap-2 px-2 text-[11px] text-[var(--ps-text-dim)]">
        <span>No open documents</span>
        <button
          type="button"
          className="inline-flex h-5 items-center gap-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-2 text-[var(--ps-text)] hover:bg-[var(--ps-tool-hover)]"
          onClick={() => reopenClosedDocument()}
        >
          <RotateCcw className="h-3 w-3" />
          Reopen {closedDocuments[0].name}
        </button>
      </div>
    ) : null
  }

  const onTabDrop = (event: React.DragEvent<HTMLDivElement>, targetDocId: string) => {
    const sourceDocId = event.dataTransfer.getData("application/x-ps-source-doc")
    const rawIds = event.dataTransfer.getData("application/x-ps-layer-ids")
    if (!sourceDocId || !rawIds || sourceDocId === targetDocId) return
    event.preventDefault()
    try {
      const parsed: unknown = JSON.parse(rawIds)
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every((id) => typeof id === "string" && id.length > 0)
      ) {
        moveLayersToDocument(sourceDocId, targetDocId, parsed as string[], !event.shiftKey)
      }
    } catch {}
  }

  return (
    <div role="tablist" aria-label="Open documents" className="h-7 bg-[var(--ps-chrome)] border-b border-[var(--ps-divider)] flex items-end gap-px overflow-x-auto">
      {documents.map((d) => {
        const isActive = d.id === activeDocId
        return (
          <div
            key={d.id}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={cn(
              "h-full flex items-center gap-2 px-3 text-[11px] cursor-pointer border-r border-[var(--ps-divider)] min-w-[120px] group",
              isActive
                ? "bg-[var(--ps-canvas-bg)] text-[var(--ps-text)]"
                : "bg-[var(--ps-panel)] text-[var(--ps-text-dim)] hover:text-[var(--ps-text)]",
            )}
            onClick={() => dispatch({ type: "activate-document", id: d.id })}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                if (event.key === " ") event.preventDefault()
                dispatch({ type: "activate-document", id: d.id })
                return
              }
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault()
                const index = documents.findIndex((doc) => doc.id === d.id)
                const nextIndex = event.key === "ArrowLeft" ? index - 1 : index + 1
                const next = documents[nextIndex]
                if (!next) return
                dispatch({ type: "activate-document", id: next.id })
                const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')
                tabs?.[nextIndex]?.focus()
              }
            }}
            onDragOver={(event) => {
              const hasLayer = event.dataTransfer.types.includes("application/x-ps-layer-ids")
              if (hasLayer && d.id !== activeDocId) {
                event.preventDefault()
                event.dataTransfer.dropEffect = event.shiftKey ? "move" : "copy"
              }
            }}
            onDrop={(event) => onTabDrop(event, d.id)}
          >
            <span className="truncate">
              {d.name}{documentStatuses[d.id]?.dirty ? "*" : ""} <span className="opacity-60">@ {Math.round(d.zoom * 100)}%</span>{" "}
              <span className="opacity-50">({d.colorMode}/{d.bitDepth})</span>
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-[var(--ps-tool-hover)] rounded-sm w-4 h-4 flex items-center justify-center"
                  aria-label={`Document options for ${d.name}`}
                >
                  <Copy className="w-3 h-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem onSelect={() => duplicateDocument(d.id)}>
                  Duplicate Document
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => closeOtherDocuments(d.id)} disabled={documents.length < 2}>
                  Close Other Documents
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => requestCloseDocument(d.id)}>
                  Close
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() =>
                    window.dispatchEvent(
                      new CustomEvent("ps-reveal-source", { detail: { docId: d.id } }),
                    )
                  }
                >
                  Reveal Source…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => reopenClosedDocument()} disabled={!closedDocuments.length}>
                  Reopen Closed Document
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                requestCloseDocument(d.id)
              }}
              className="ml-auto opacity-50 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-[var(--ps-tool-hover)] rounded-sm w-4 h-4 flex items-center justify-center"
              aria-label="Close document"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )
      })}
      {closedDocuments.length ? (
        <button
          type="button"
          className="h-full inline-flex items-center gap-1 px-2 text-[11px] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
          onClick={() => reopenClosedDocument()}
          title={`${closedDocuments[0].width}x${closedDocuments[0].height}`}
        >
          <RotateCcw className="h-3 w-3" />
          Reopen
        </button>
      ) : null}
    </div>
  )
}
