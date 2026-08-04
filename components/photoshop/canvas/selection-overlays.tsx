"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { extractMarchingAntsPaths } from "@/editor/tool/helpers"
import type { TextEditState } from "@/editor/canvas/text-edit-controller"
import type { Layer, PsDocument } from "@/editor/types"

export type { TextEditState }

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

/**
 * The editor box lives inside the canvas stage, which is laid out at
 * `doc.width * zoom` CSS pixels with no additional scale transform, so document
 * coordinates convert to CSS pixels by multiplying with the live view zoom.
 * `contentWidth` is the measured width of the longest line (CSS px) and is only
 * used when the text has no fixed paragraph box.
 */
export function textEditOverlayStyle(
  text: NonNullable<Layer["text"]>,
  zoom: number,
  contentWidth = 0,
): React.CSSProperties {
  const lineHeight = (text.leading ?? text.size * 1.2) * zoom
  const boxWidth = text.boxWidth ? text.boxWidth * zoom : Math.max(64, contentWidth + text.size * zoom * 0.6)
  const boxHeight = text.boxHeight ? text.boxHeight * zoom : undefined
  return {
    left: text.x * zoom,
    top: text.y * zoom,
    width: boxWidth,
    height: boxHeight,
    minHeight: lineHeight,
    // Point text (no paragraph box) must not wrap: it grows to fit and breaks
    // only where the typist presses Enter, matching how rasterizeText lays it
    // out. Leaving it wrappable meant any shortfall in the width measurement —
    // canvas metrics vs. the DOM's, a webfont still loading — pushed the last
    // character onto its own line. Paragraph boxes keep wrapping.
    whiteSpace: text.boxWidth ? "pre-wrap" : "pre",
    fontFamily: text.font,
    fontSize: text.size * zoom,
    fontWeight: text.weight,
    fontStyle: text.italic ? "italic" : "normal",
    color: text.color,
    textAlign: text.align,
    lineHeight: `${lineHeight}px`,
    writingMode: text.vertical ? "vertical-rl" : undefined,
  }
}

function measureTextWidth(lines: string[], style: React.CSSProperties): number {
  if (typeof document === "undefined") return 0
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  if (!ctx) return 0
  ctx.font = `${style.fontStyle === "italic" ? "italic " : ""}${style.fontWeight ?? "normal"} ${Number(style.fontSize) || 16}px ${style.fontFamily ?? "sans-serif"}`
  let width = 0
  for (const line of lines) width = Math.max(width, ctx.measureText(line).width)
  return width
}

export function TextEditOverlay({
  doc,
  zoom,
  state,
  setState,
  commit,
  cancel,
}: {
  doc: PsDocument
  zoom: number
  state: TextEditState
  setState: React.Dispatch<React.SetStateAction<TextEditState | null>>
  commit: () => void
  cancel: () => void
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const layer = resolveTextEditLayer(doc, state.layerId)
  const text = layer?.text

  // Focus and select-all on mount so an empty box takes keystrokes immediately
  // and re-editing an existing layer behaves like Photoshop's type tool.
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [state.layerId])

  if (!layer || !text) return null

  const baseStyle = textEditOverlayStyle(text, zoom)
  const style = text.boxWidth
    ? baseStyle
    : textEditOverlayStyle(text, zoom, measureTextWidth(state.value.split("\n"), baseStyle))

  return (
    <textarea
      ref={ref}
      data-testid="text-edit-overlay"
      spellCheck={false}
      value={state.value}
      placeholder="Type here…"
      onChange={(e) => setState({ ...state, value: e.target.value })}
      onBlur={commit}
      // The editor sits inside the canvas stage, which routes pointer events to
      // the drawing tools. Without this the first click into the box would be
      // read as another canvas gesture (and, with the type tool, would place a
      // second text layer).
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          cancel()
          return
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          e.stopPropagation()
          commit()
          return
        }
        e.stopPropagation()
      }}
      className={cn(
        // `whiteSpace` comes from the style object — point text must not wrap.
        "absolute z-30 m-0 resize-none overflow-hidden bg-transparent p-0",
        "outline outline-1 outline-dashed outline-cyan-400 focus:outline-cyan-300",
        "caret-cyan-400 placeholder:text-current placeholder:opacity-40",
      )}
      style={style}
    />
  )
}
