"use client"

import * as React from "react"
import { Compass, Filter, Lightbulb, MousePointer2, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEditorSelector } from "../editor-context"
import { addPhotoshopEventListener, dispatchPhotoshopEvent } from "../events"
import { FILTERS } from "../filters"
import { contextualHelpForTool } from "../contextual-help"
import { TOOL_TOOLTIP_CONTENT } from "../tool-tooltip-content"
import { GENERIC_TOOLTIP_CONTENT } from "../tool-tooltip-content"
import type { ToolId } from "../types"
import {
  buildLearningIndex,
  runLearningIndexItem,
  searchLearningIndex,
  type LearningIndexItem,
} from "../learning-index"
import { LEARNING_PANEL_SOURCES } from "../learning-panel-sources"
import {
  readRegisteredSessionString,
  STORAGE_RESOURCES,
  writeRegisteredSessionString,
} from "../storage-registry"


const TYPE_FILTERS = ["all", "command", "tool", "panel", "filter", "workflow", "doc"] as const
type TypeFilter = (typeof TYPE_FILTERS)[number]

function readQuery(): string {
  return readRegisteredSessionString(STORAGE_RESOURCES.learningQuery) ?? ""
}

function writeQuery(value: string) {
  writeRegisteredSessionString(STORAGE_RESOURCES.learningQuery, value)
}

export function DiscoverPanel() {
  const tool = useEditorSelector((editor) => editor.tool)
  const activeDoc = useEditorSelector((editor) => editor.activeDoc)
  const [query, setQuery] = React.useState<string>(readQuery)
  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>("all")
  const [highlightId, setHighlightId] = React.useState<string | null>(null)
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const learningIndex = React.useMemo(
    () =>
      buildLearningIndex({
        panels: LEARNING_PANEL_SOURCES,
        filters: Object.values(FILTERS),
      }),
    [],
  )

  // Sync with command palette + tool palette dispatches.
  React.useEffect(() => {
    return addPhotoshopEventListener("ps-set-learning-query", (nextQuery) => {
      setQuery(nextQuery)
      writeQuery(nextQuery)
    })
  }, [])

  // Tool-palette and other tooltips fire ps-open-learn with a topic. Topics
  // map to a ToolId, a generic tooltip key (e.g. "quick-mask"), or a free-text
  // search query as a fallback.
  React.useEffect(() => {
    return addPhotoshopEventListener("ps-open-learn", (detail) => {
      if (!detail?.topic) return
      const topic = detail.topic
      const toolEntry = (TOOL_TOOLTIP_CONTENT as Record<string, { title: string }>)[topic]
      if (toolEntry) {
        const nextQuery = toolEntry.title
        setTypeFilter("tool")
        setQuery(nextQuery)
        writeQuery(nextQuery)
        setHighlightId(`tool-${topic as ToolId}`)
      } else if ((GENERIC_TOOLTIP_CONTENT as Record<string, { title: string }>)[topic]) {
        const entry = (GENERIC_TOOLTIP_CONTENT as Record<string, { title: string }>)[topic]
        setTypeFilter("all")
        setQuery(entry.title)
        writeQuery(entry.title)
      } else {
        setTypeFilter("all")
        setQuery(topic)
        writeQuery(topic)
      }
      // Make sure the discover panel is actually visible.
      dispatchPhotoshopEvent("ps-open-panel", "discover")
    })
  }, [])

  // Scroll the highlighted item into view after the next paint.
  React.useEffect(() => {
    if (!highlightId) return
    const root = listRef.current
    if (!root) return
    const node = root.querySelector<HTMLElement>(`[data-learning-id="${highlightId}"]`)
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" })
      const timer = window.setTimeout(() => setHighlightId(null), 1800)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [highlightId, query, typeFilter])

  const visible = React.useMemo(() => {
    const result = searchLearningIndex(learningIndex, query, { limit: 120 })
    if (typeFilter === "all") return result
    return result.filter((item) => item.type === typeFilter)
  }, [learningIndex, query, typeFilter])

  const grouped = React.useMemo(() => {
    const buckets = new Map<string, LearningIndexItem[]>()
    for (const item of visible) {
      const bucket = buckets.get(item.type) ?? []
      bucket.push(item)
      buckets.set(item.type, bucket)
    }
    return [...buckets.entries()].sort(([a], [b]) => typeOrder(a) - typeOrder(b))
  }, [visible])

  const contextSuggestions = React.useMemo(() => contextualHelpForTool(tool), [tool])

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="space-y-2 border-b border-[var(--ps-divider)] p-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
          <Compass className="h-3 w-3" /> Discover
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ps-text-dim)]" />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              writeQuery(event.target.value)
            }}
            placeholder="Search commands, panels, filters, docs, workflows"
            className="h-7 bg-[var(--ps-panel-2)] pl-7 pr-7 text-[11px]"
          />
          {query ? (
            <button
              type="button"
              onClick={() => { setQuery(""); writeQuery("") }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ps-text-dim)] hover:text-[var(--ps-text)]"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1 text-[10px]">
          {TYPE_FILTERS.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setTypeFilter(type)}
              className={`rounded-sm border px-1.5 py-0.5 ${typeFilter === type ? "border-[var(--ps-accent,#3b82f6)] bg-[var(--ps-panel-2)]" : "border-[var(--ps-divider)] hover:bg-[var(--ps-tool-hover)]"}`}
            >
              {type}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-[var(--ps-text-dim)]">
          {visible.length} results · context: {tool}{activeDoc ? ` · ${activeDoc.colorMode?.toUpperCase() ?? "RGB"}` : ""}
        </div>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto p-2">
        {contextSuggestions.length && !query ? (
          <section className="mb-3 space-y-1">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
              <MousePointer2 className="h-3 w-3" /> While using {tool}
            </div>
            {contextSuggestions.slice(0, 4).map((tip) => (
              <div key={tip.id} className="rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] p-2">
                <div>{tip.title}</div>
                <div className="text-[10px] text-[var(--ps-text-dim)]">{tip.body}</div>
              </div>
            ))}
          </section>
        ) : null}
        {grouped.length ? grouped.map(([type, items]) => (
          <section key={type} className="mb-3">
            <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--ps-text-dim)]">
              <Filter className="h-3 w-3" /> {type} <span className="text-[var(--ps-text-dim)]">({items.length})</span>
            </div>
            <div className="space-y-1">
              {items.slice(0, 24).map((item) => (
                <Button
                  key={item.id}
                  data-learning-id={item.id}
                  size="sm"
                  variant="ghost"
                  onClick={() => runLearningIndexItem(item)}
                  className={`h-auto w-full justify-start gap-2 px-2 py-1 text-left text-[11px] ${highlightId === item.id ? "ring-1 ring-[var(--ps-accent,#3b82f6)] bg-[var(--ps-panel-2)]" : ""}`}
                >
                  <Lightbulb className="h-3 w-3 shrink-0 text-[var(--ps-text-dim)]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px]">{item.title}</div>
                    <div className="truncate text-[10px] text-[var(--ps-text-dim)]">{item.category} · {item.description}</div>
                  </div>
                </Button>
              ))}
            </div>
          </section>
        )) : (
          <div className="rounded-sm border border-dashed border-[var(--ps-divider)] p-4 text-center text-[var(--ps-text-dim)]">
            No matches for the current filter.
          </div>
        )}
      </div>
    </div>
  )
}

function typeOrder(type: string) {
  switch (type) {
    case "workflow": return 0
    case "command": return 1
    case "tool": return 2
    case "panel": return 3
    case "filter": return 4
    case "doc": return 5
    default: return 6
  }
}
