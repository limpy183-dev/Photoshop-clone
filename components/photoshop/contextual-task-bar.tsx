"use client"

import * as React from "react"
import { Brush, GripVertical, ImageDown, Layers, MousePointer2, SlidersHorizontal, Sparkles, Type } from "lucide-react"
import { useEditor } from "./editor-context"
import { dispatchPhotoshopEvent } from "./events"

const POSITION_KEY = "ps-contextual-task-bar-position"
const DEFAULT_POSITION = { x: 28, y: 36 }

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function ContextualTaskBar() {
  const { activeDoc, activeLayer, tool, dispatch, commit } = useEditor()
  const barRef = React.useRef<HTMLDivElement>(null)
  const dragOffsetRef = React.useRef({ x: 0, y: 0 })
  const [position, setPosition] = React.useState(DEFAULT_POSITION)
  const [dragging, setDragging] = React.useState(false)

  React.useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null")
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        setPosition({ x: saved.x, y: saved.y })
      }
    } catch {}
  }, [])

  const savePosition = React.useCallback((next: { x: number; y: number }) => {
    try {
      localStorage.setItem(POSITION_KEY, JSON.stringify(next))
    } catch {}
  }, [])

  const moveToPointer = React.useCallback((clientX: number, clientY: number) => {
    const bar = barRef.current
    const root = bar?.closest("[data-canvas-root]") as HTMLElement | null
    if (!bar || !root) return
    const rootRect = root.getBoundingClientRect()
    const barRect = bar.getBoundingClientRect()
    const next = {
      x: clamp(clientX - rootRect.left - dragOffsetRef.current.x, 8, Math.max(8, rootRect.width - barRect.width - 8)),
      y: clamp(clientY - rootRect.top - dragOffsetRef.current.y, 28, Math.max(28, rootRect.height - barRect.height - 8)),
    }
    setPosition(next)
    return next
  }, [])

  const startDrag = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const bar = barRef.current
    if (!bar) return
    const rect = bar.getBoundingClientRect()
    dragOffsetRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }, [])

  const drag = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return
    moveToPointer(event.clientX, event.clientY)
  }, [dragging, moveToPointer])

  const stopDrag = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return
    const next = moveToPointer(event.clientX, event.clientY)
    if (next) savePosition(next)
    setDragging(false)
  }, [dragging, moveToPointer, savePosition])

  if (!activeDoc) return null

  const items = [
    tool === "brush" || tool === "mixer-brush" || tool === "pattern-stamp"
      ? { label: "Brush", icon: Brush, run: () => dispatchPhotoshopEvent("ps-open-panel", "brush") }
      : null,
    activeLayer?.kind === "text"
      ? { label: "Type", icon: Type, run: () => dispatchPhotoshopEvent("ps-open-panel", "character") }
      : null,
    activeLayer
      ? { label: "Properties", icon: SlidersHorizontal, run: () => dispatchPhotoshopEvent("ps-open-panel", "properties") }
      : null,
    activeLayer
      ? { label: "Layer FX", icon: Sparkles, run: () => dispatchPhotoshopEvent("ps-open-panel", "styles") }
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
    { label: "Export", icon: ImageDown, run: () => dispatchPhotoshopEvent("ps-open-export-as") },
    { label: "Move", icon: MousePointer2, run: () => dispatch({ type: "set-tool", tool: "move" }) },
  ].filter(Boolean) as { label: string; icon: React.ComponentType<{ className?: string }>; run: () => void }[]

  return (
    <div
      ref={barRef}
      className="pointer-events-none absolute z-40"
      style={{ left: position.x, top: position.y }}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel)]/95 px-1.5 py-1 shadow-lg backdrop-blur">
        <button
          type="button"
          title="Move contextual toolbar"
          aria-label="Move contextual toolbar"
          onPointerDown={startDrag}
          onPointerMove={drag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          className="flex h-7 w-5 cursor-grab items-center justify-center rounded-sm text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)] active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
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
