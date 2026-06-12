"use client"

import * as React from "react"
import { buildRulerTickMarks } from "./ruler-calibration"
import type { RulerUnitPreference } from "./preferences-engine"

type DragGuide = { orient: "horizontal" | "vertical"; pos: number }

export function rulerGuideFromPointer(
  orient: "horizontal" | "vertical",
  pointer: { clientX: number; clientY: number },
  stageRect: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
): DragGuide {
  if (orient === "horizontal") {
    const canvasY = ((pointer.clientY - stageRect.top) / stageRect.height) * height
    return { orient: "horizontal", pos: Math.max(0, Math.min(height, canvasY)) }
  }
  const canvasX = ((pointer.clientX - stageRect.left) / stageRect.width) * width
  return { orient: "vertical", pos: Math.max(0, Math.min(width, canvasX)) }
}

export function rulerGuidePreviewStyle(
  dragGuide: DragGuide,
  width: number,
  height: number,
  zoom: number,
): React.CSSProperties {
  return dragGuide.orient === "horizontal"
    ? {
      top: `calc(50% + ${dragGuide.pos * zoom - (height * zoom) / 2 + 18}px)`,
      left: 18,
      right: 0,
      height: 1,
      background: "#06b6d4",
      boxShadow: "0 0 0 1px rgba(6,182,212,0.28)",
    }
    : {
      left: `calc(50% + ${dragGuide.pos * zoom - (width * zoom) / 2 + 18}px)`,
      top: 18,
      bottom: 0,
      width: 1,
      background: "#06b6d4",
      boxShadow: "0 0 0 1px rgba(6,182,212,0.28)",
    }
}

export function rulerTickPositionStyle(
  positionPx: number,
  length: number,
  zoom: number,
  orientation: "horizontal" | "vertical",
): React.CSSProperties {
  return orientation === "horizontal"
    ? { left: `calc(50% + ${positionPx - (length * zoom) / 2}px)` }
    : { top: `calc(50% + ${positionPx - (length * zoom) / 2}px)` }
}

export function Rulers({
  width,
  height,
  zoom,
  unit,
  documentDpi,
  onCreateGuide,
}: {
  width: number
  height: number
  zoom: number
  unit: RulerUnitPreference
  documentDpi: number
  onCreateGuide?: (orient: "horizontal" | "vertical", pos: number) => void
}) {
  const [dragGuide, setDragGuide] = React.useState<DragGuide | null>(null)
  const dragGuideRef = React.useRef<DragGuide | null>(null)

  const handleRulerDrag = (orient: "horizontal" | "vertical", e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const containerEl = e.currentTarget.closest("[data-canvas-root]") as HTMLElement | null
    if (!containerEl) return
    const stageEl = containerEl.querySelector("[data-canvas-stage]") as HTMLElement | null
    if (!stageEl) return

    const move = (ev: PointerEvent) => {
      const next = rulerGuideFromPointer(
        orient,
        ev,
        stageEl.getBoundingClientRect(),
        width,
        height,
      )
      dragGuideRef.current = next
      setDragGuide(next)
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      const finalGuide = dragGuideRef.current
      if (finalGuide && onCreateGuide) {
        onCreateGuide(finalGuide.orient, finalGuide.pos)
      }
      dragGuideRef.current = null
      setDragGuide(null)
    }
    const cancel = () => {
      // Interrupted drag: discard the guide preview without creating a guide.
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      dragGuideRef.current = null
      setDragGuide(null)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", cancel)
    // Trigger initial position
    move(e.nativeEvent)
  }

  return (
    <>
      <div
        className="absolute top-0 left-[18px] right-0 h-[18px] bg-[var(--ps-panel)] border-b border-[var(--ps-divider)] overflow-hidden z-10 cursor-s-resize"
        onPointerDown={(e) => handleRulerDrag("horizontal", e)}
      >
        <RulerTicks length={width} zoom={zoom} orientation="horizontal" unit={unit} documentDpi={documentDpi} />
      </div>
      <div
        className="absolute top-[18px] left-0 bottom-0 w-[18px] bg-[var(--ps-panel)] border-r border-[var(--ps-divider)] overflow-hidden z-10 cursor-e-resize"
        onPointerDown={(e) => handleRulerDrag("vertical", e)}
      >
        <RulerTicks length={height} zoom={zoom} orientation="vertical" unit={unit} documentDpi={documentDpi} />
      </div>
      <div className="absolute top-0 left-0 w-[18px] h-[18px] bg-[var(--ps-panel)] border-r border-b border-[var(--ps-divider)] z-10" />
      {dragGuide ? (
        <div
          className="pointer-events-none absolute z-30"
          style={rulerGuidePreviewStyle(dragGuide, width, height, zoom)}
        />
      ) : null}
    </>
  )
}

export const RulerTicks = React.memo(function RulerTicks({
  length,
  zoom,
  orientation,
  unit,
  documentDpi,
}: {
  length: number
  zoom: number
  orientation: "horizontal" | "vertical"
  unit: RulerUnitPreference
  documentDpi: number
}) {
  const tickMarks = buildRulerTickMarks({ lengthPx: length, zoom, unit, documentDpi })
  const ticks: React.ReactNode[] = []
  for (const tick of tickMarks) {
    const key = `${tick.value}-${tick.major ? "major" : "minor"}`
    if (orientation === "horizontal") {
      ticks.push(
        <div
          key={key}
          className="absolute top-0 text-[9px] text-[var(--ps-text-dim)]"
          style={rulerTickPositionStyle(tick.positionPx, length, zoom, orientation)}
        >
          <div
            className="bg-[var(--ps-text-dim)]"
            style={{ width: 1, height: tick.major ? 8 : 4, marginLeft: -0.5 }}
          />
          {tick.major ? <span className="ml-1">{tick.label}</span> : null}
        </div>,
      )
    } else {
      ticks.push(
        <div
          key={key}
          className="absolute left-0 text-[9px] text-[var(--ps-text-dim)] flex flex-col items-start"
          style={rulerTickPositionStyle(tick.positionPx, length, zoom, orientation)}
        >
          <div
            className="bg-[var(--ps-text-dim)]"
            style={{ height: 1, width: tick.major ? 8 : 4, marginTop: -0.5 }}
          />
          {tick.major ? (
            <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>{tick.label}</span>
          ) : null}
        </div>,
      )
    }
  }
  return <div className="relative w-full h-full">{ticks}</div>
})
