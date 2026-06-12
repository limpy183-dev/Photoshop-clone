"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { extractMarchingAntsPaths } from "./tool-helpers"
import type { Layer, PsDocument } from "./types"

export function MaskSelectionOverlay({
  mask,
  docW,
  docH,
}: {
  mask: HTMLCanvasElement
  docW: number
  docH: number
}) {
  const ref = React.useRef<HTMLCanvasElement>(null)

  React.useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    canvas.width = docW
    canvas.height = docH
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const paths = extractMarchingAntsPaths(mask, { simplifyTolerance: 0.25 })
    const trace = () => {
      for (const path of paths) {
        const first = path.points[0]
        if (!first) continue
        ctx.beginPath()
        ctx.moveTo(first.x, first.y)
        for (let i = 1; i < path.points.length; i++) ctx.lineTo(path.points[i].x, path.points[i].y)
        if (path.closed) ctx.closePath()
        ctx.stroke()
      }
    }

    let phase = 0
    let stopped = false
    let timer = 0
    const draw = () => {
      if (stopped) return
      ctx.clearRect(0, 0, docW, docH)
      ctx.save()
      ctx.lineWidth = 1
      ctx.lineJoin = "miter"
      ctx.lineCap = "butt"
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = "rgba(0,0,0,0.95)"
      ctx.lineDashOffset = -phase
      trace()
      ctx.strokeStyle = "rgba(255,255,255,0.95)"
      ctx.lineDashOffset = 4 - phase
      trace()
      ctx.restore()
      phase = (phase + 1) % 8
      timer = window.setTimeout(draw, 90)
    }
    draw()
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [mask, docW, docH])

  return <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none" />
}

export function selectionOverlayStyle(
  bounds: { x: number; y: number; w: number; h: number },
  docW: number,
  docH: number,
): React.CSSProperties {
  const left = (bounds.x / docW) * 100
  const top = (bounds.y / docH) * 100
  const width = (bounds.w / docW) * 100
  const height = (bounds.h / docH) * 100
  return { left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }
}

export function SelectionOverlay({
  bounds,
  shape,
  docW,
  docH,
}: {
  bounds: { x: number; y: number; w: number; h: number }
  shape: "rect" | "ellipse"
  docW: number
  docH: number
}) {
  return (
    <div
      className="absolute pointer-events-none"
      style={selectionOverlayStyle(bounds, docW, docH)}
    >
      <div
        className={cn(
          "absolute inset-0 ps-marching-ants",
          shape === "ellipse" ? "rounded-[100%]" : "",
        )}
      />
    </div>
  )
}

export function resolveTextEditLayer(doc: PsDocument, layerId: string): Layer | null {
  const layer = doc.layers.find((candidate: Layer) => candidate.id === layerId)
  return layer?.text ? layer : null
}

export function textEditOverlayStyle(
  doc: PsDocument,
  text: NonNullable<Layer["text"]>,
): React.CSSProperties {
  return {
    left: `${(text.x / doc.width) * 100}%`,
    top: `${(text.y / doc.height) * 100}%`,
    minWidth: 100,
    minHeight: text.size * doc.zoom * 1.4,
    fontFamily: text.font,
    fontSize: text.size * doc.zoom,
    fontWeight: text.weight,
    fontStyle: text.italic ? "italic" : "normal",
    color: text.color,
    textAlign: text.align,
    lineHeight: 1.2,
  }
}

export function TextEditOverlay({
  doc,
  state,
  setState,
  commit,
}: {
  doc: PsDocument
  state: { layerId: string; value: string }
  setState: React.Dispatch<React.SetStateAction<{ layerId: string; value: string } | null>>
  commit: () => void
}) {
  const layer = resolveTextEditLayer(doc, state.layerId)
  if (!layer || !layer.text) return null
  const t = layer.text
  return (
    <textarea
      autoFocus
      value={state.value}
      onChange={(e) => setState({ ...state, value: e.target.value })}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setState(null)
          e.stopPropagation()
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          commit()
          e.preventDefault()
        }
        e.stopPropagation()
      }}
      className="absolute outline outline-2 outline-cyan-500 bg-transparent resize-none p-0 m-0 z-30"
      style={textEditOverlayStyle(doc, t)}
    />
  )
}
