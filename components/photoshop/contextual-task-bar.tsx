"use client"

import * as React from "react"
import { Brush, ImageDown, Layers, MousePointer2, SlidersHorizontal, Sparkles, Type } from "lucide-react"
import { useEditor } from "./editor-context"

export function ContextualTaskBar() {
  const { activeDoc, activeLayer, tool, dispatch, commit } = useEditor()
  if (!activeDoc) return null

  const items = [
    tool === "brush" || tool === "mixer-brush" || tool === "pattern-stamp"
      ? { label: "Brush", icon: Brush, run: () => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "brush" })) }
      : null,
    activeLayer?.kind === "text"
      ? { label: "Type", icon: Type, run: () => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "character" })) }
      : null,
    activeLayer
      ? { label: "Properties", icon: SlidersHorizontal, run: () => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "properties" })) }
      : null,
    activeLayer
      ? { label: "Layer FX", icon: Sparkles, run: () => window.dispatchEvent(new CustomEvent("ps-open-panel", { detail: "styles" })) }
      : null,
    activeLayer
      ? {
          label: "Duplicate",
          icon: Layers,
          run: () => {
            dispatch({ type: "duplicate-layer", id: activeLayer.id })
            window.setTimeout(() => commit("Duplicate Layer", [activeLayer.id]), 0)
          },
        }
      : null,
    { label: "Export", icon: ImageDown, run: () => window.dispatchEvent(new CustomEvent("ps-open-export-as")) },
    { label: "Move", icon: MousePointer2, run: () => dispatch({ type: "set-tool", tool: "move" }) },
  ].filter(Boolean) as { label: string; icon: React.ComponentType<{ className?: string }>; run: () => void }[]

  return (
    <div className="pointer-events-none absolute left-1/2 top-7 z-40 -translate-x-1/2">
      <div className="pointer-events-auto flex items-center gap-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)]/95 px-1.5 py-1 shadow-lg backdrop-blur">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            title={item.label}
            aria-label={item.label}
            onClick={item.run}
            className="flex h-7 w-7 items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
          >
            <item.icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    </div>
  )
}
