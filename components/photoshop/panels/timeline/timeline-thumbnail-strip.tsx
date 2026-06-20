import * as React from "react"

import { renderTimelineFrameComposite } from "../../timeline-engine"
import type { PsDocument, TimelineFrame } from "../../types"

/* ---------------------- Timeline thumbnail strip -------------------------- */

export function TimelineThumbnailStrip({
  doc,
  frames,
  playheadMs,
  playheadFrameIndex,
  cache,
  onSeekFrame,
}: {
  doc: PsDocument
  frames: TimelineFrame[]
  playheadMs: number
  playheadFrameIndex: number
  cache: Map<string, ImageBitmap>
  onSeekFrame: (index: number) => void
}) {
  const totalMs = frames.reduce((sum, f) => sum + Math.max(0, f.durationMs), 0) || 1
  const trackWidth = 100
  return (
    <div
      className="relative flex h-12 w-full items-stretch gap-px overflow-x-auto rounded-sm border border-[var(--ps-divider)] bg-black/30"
      role="group"
      aria-label="Timeline frame thumbnails"
    >
      {frames.map((frame, idx) => {
        const widthPct = (Math.max(0, frame.durationMs) / totalMs) * trackWidth
        return (
          <TimelineThumbnailCell
            key={frame.id}
            doc={doc}
            frame={frame}
            cache={cache}
            isActive={idx === playheadFrameIndex}
            widthPct={Math.max(2, widthPct)}
            onClick={() => onSeekFrame(idx)}
            label={`Frame ${idx + 1}: ${frame.name}`}
          />
        )
      })}
      {/* Playhead indicator overlay */}
      <div
        className="pointer-events-none absolute top-0 h-full w-0.5 bg-[var(--ps-accent)]"
        style={{
          left: `${Math.min(100, (playheadMs / totalMs) * 100)}%`,
        }}
        aria-hidden="true"
      />
    </div>
  )
}

function TimelineThumbnailCell({
  doc,
  frame,
  cache,
  isActive,
  widthPct,
  onClick,
  label,
}: {
  doc: PsDocument
  frame: TimelineFrame
  cache: Map<string, ImageBitmap>
  isActive: boolean
  widthPct: number
  onClick: () => void
  label: string
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const cacheKey = `${doc.id}:${frame.id}:${doc.layers.length}`
    const cached = cache.get(cacheKey)
    const targetW = 72
    const aspect = Math.max(1, doc.width) / Math.max(1, doc.height)
    const targetH = Math.max(20, Math.round(targetW / aspect))
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, targetW, targetH)
    if (cached) {
      try {
        ctx.drawImage(cached, 0, 0, targetW, targetH)
        return
      } catch {
        // fall through to re-render
      }
    }
    let cancelled = false
    try {
      const rendered = renderTimelineFrameComposite(doc, frame, { transparent: true })
      ctx.drawImage(rendered, 0, 0, targetW, targetH)
      // Cache the rendered ImageBitmap asynchronously for future scrubbing.
      if (typeof createImageBitmap === "function") {
        createImageBitmap(rendered)
          .then((bm) => {
            if (cancelled) return
            cache.set(cacheKey, bm)
          })
          .catch(() => undefined)
      }
    } catch {
      // ignore canvas errors (small docs etc.)
    }
    return () => {
      cancelled = true
    }
  }, [doc, frame, cache])
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`group relative h-full shrink-0 border-r border-[var(--ps-divider)] ${
        isActive ? "ring-1 ring-inset ring-[var(--ps-accent)]" : ""
      }`}
      style={{ width: `${widthPct}%`, minWidth: 8 }}
    >
      <canvas ref={canvasRef} className="h-full w-full object-cover" />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/60 px-0.5 text-[8px] text-white">
        {Math.round(frame.durationMs)}ms
      </span>
    </button>
  )
}
