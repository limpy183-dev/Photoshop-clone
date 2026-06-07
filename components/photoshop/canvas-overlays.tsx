"use client"

/**
 * Self-contained canvas-view overlays extracted from canvas-view.tsx to keep
 * the main file scoped to pointer routing, render coordination, and the more
 * intricate selection/transform overlays that need access to drawing-state
 * refs. The components here are pure-presentational with no editor context
 * coupling — they take props, render DOM/canvas, and emit callbacks.
 */

import * as React from "react"
import { hexToRgba } from "./color-utils"
import type { RetouchFeedbackModel } from "./retouch-feedback"
import type { Guide } from "./types"

function formatToolName(tool: string) {
  return tool
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function RetouchFeedbackOverlay({
  tool,
  model,
  brushSize,
  opacity,
  flow,
}: {
  tool: string
  model: RetouchFeedbackModel
  brushSize: number
  opacity: number
  flow: number
}) {
  const edgeSize = 22
  const hardnessSize = Math.max(2, edgeSize * Math.max(0, Math.min(1, model.brushEdge.hardnessRadius / Math.max(0.5, model.brushEdge.radius))))

  return (
    <div
      data-testid="tool-preview-overlay"
      className="pointer-events-none absolute left-2 top-2 z-30 flex max-w-[calc(100%-16px)] items-center gap-2"
    >
      <div
        data-testid="active-tool-status-strip"
        className="flex min-w-0 items-center gap-2 rounded-sm border border-white/20 bg-[rgba(8,13,18,0.86)] px-2 py-1 text-[10px] text-white shadow-[0_6px_18px_rgba(0,0,0,0.35)]"
      >
        <span className="font-medium">{formatToolName(tool)}</span>
        <span className="text-white/70">Size {Math.round(brushSize)}px</span>
        <span className="text-white/70">Opacity {Math.round(opacity)}%</span>
        <span className="text-white/70">Flow {Math.round(flow)}%</span>
        <span className="max-w-40 truncate text-cyan-100">{model.primaryStatus}</span>
      </div>
      <div
        data-testid="brush-edge-preview"
        data-hardness={Math.round((model.brushEdge.hardnessRadius / Math.max(0.5, model.brushEdge.radius)) * 100)}
        className="relative grid shrink-0 place-items-center rounded-full border border-white bg-black/45"
        style={{ width: edgeSize, height: edgeSize }}
        title={model.brushEdge.detail}
      >
        <span
          className="block rounded-full border border-cyan-300/80"
          style={{ width: hardnessSize, height: hardnessSize }}
        />
      </div>
    </div>
  )
}

export function MagneticLassoIndicator({ width, frequency }: { width: number; frequency: number }) {
  return (
    <div
      data-testid="magnetic-lasso-indicator"
      className="pointer-events-none absolute left-2 top-2 z-30 rounded-sm border border-cyan-300/50 bg-[rgba(8,13,18,0.82)] px-2 py-1 text-[10px] text-cyan-100 shadow-[0_6px_18px_rgba(0,0,0,0.35)]"
    >
      Width {Math.round(width)} px | Frequency {Math.round(frequency)}
    </div>
  )
}

export function GridOverlay({
  docW,
  docH,
  size,
  color,
  subdivisions,
  opacity,
}: {
  docW: number
  docH: number
  size: number
  color: string
  subdivisions: number
  opacity: number
}) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  React.useEffect(() => {
    const cv = ref.current
    if (!cv) return
    cv.width = docW
    cv.height = docH
    const ctx = cv.getContext("2d")!
    ctx.clearRect(0, 0, docW, docH)
    const sub = Math.max(1, Math.round(subdivisions))
    const subStep = size / sub
    if (sub > 1 && subStep >= 2) {
      ctx.strokeStyle = hexToRgba(color, opacity * 0.38)
      ctx.lineWidth = 1
      for (let x = subStep; x < docW; x += subStep) {
        if (Math.abs(x / size - Math.round(x / size)) < 0.001) continue
        ctx.beginPath()
        ctx.moveTo(x + 0.5, 0)
        ctx.lineTo(x + 0.5, docH)
        ctx.stroke()
      }
      for (let y = subStep; y < docH; y += subStep) {
        if (Math.abs(y / size - Math.round(y / size)) < 0.001) continue
        ctx.beginPath()
        ctx.moveTo(0, y + 0.5)
        ctx.lineTo(docW, y + 0.5)
        ctx.stroke()
      }
    }
    ctx.strokeStyle = hexToRgba(color, opacity)
    ctx.lineWidth = 1
    for (let x = size; x < docW; x += size) {
      ctx.beginPath()
      ctx.moveTo(x + 0.5, 0)
      ctx.lineTo(x + 0.5, docH)
      ctx.stroke()
    }
    for (let y = size; y < docH; y += size) {
      ctx.beginPath()
      ctx.moveTo(0, y + 0.5)
      ctx.lineTo(docW, y + 0.5)
      ctx.stroke()
    }
  }, [docW, docH, size, color, subdivisions, opacity])
  return <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none" />
}

export function PixelGridOverlay({ zoom }: { zoom: number }) {
  const opacity = Math.min(0.45, Math.max(0.16, (zoom - 5) / 18))
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: `linear-gradient(rgba(255,255,255,${opacity}) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,${opacity}) 1px, transparent 1px)`,
        backgroundSize: `${zoom}px ${zoom}px`,
        mixBlendMode: "difference",
      }}
    />
  )
}

export function GuidesOverlay({
  guides,
  docW,
  docH,
  onMove,
  onRemove,
}: {
  guides: Guide[]
  docW: number
  docH: number
  onMove: (id: string, pos: number) => void
  onRemove: (id: string) => void
}) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {guides.filter((guide) => guide.visible !== false).map((g) => (
        <div
          key={g.id}
          className={`absolute pointer-events-auto ${g.locked ? "cursor-default" : "cursor-move"}`}
          title={g.name ?? (g.locked ? "Locked guide" : "Guide")}
          style={
            g.orientation === "horizontal"
              ? {
                left: 0,
                right: 0,
                top: `${(g.position / docH) * 100}%`,
                height: 4,
                marginTop: -2,
                background: "transparent",
                borderTop: `1px solid ${g.color ?? "#06b6d4"}`,
              }
              : {
                top: 0,
                bottom: 0,
                left: `${(g.position / docW) * 100}%`,
                width: 4,
                marginLeft: -2,
                background: "transparent",
                borderLeft: `1px solid ${g.color ?? "#06b6d4"}`,
              }
          }
          onDoubleClick={() => {
            if (!g.locked) onRemove(g.id)
          }}
          onPointerDown={(e) => {
            e.stopPropagation()
            if (g.locked) return
            const target = e.currentTarget
            target.setPointerCapture(e.pointerId)
            const move = (ev: PointerEvent) => {
              const rect = (target.parentElement as HTMLElement).getBoundingClientRect()
              if (g.orientation === "horizontal") {
                const y = ((ev.clientY - rect.top) / rect.height) * docH
                onMove(g.id, Math.max(0, Math.min(docH, y)))
              } else {
                const x = ((ev.clientX - rect.left) / rect.width) * docW
                onMove(g.id, Math.max(0, Math.min(docW, x)))
              }
            }
            const up = () => {
              window.removeEventListener("pointermove", move)
              window.removeEventListener("pointerup", up)
            }
            window.addEventListener("pointermove", move)
            window.addEventListener("pointerup", up)
          }}
        />
      ))}
    </div>
  )
}
