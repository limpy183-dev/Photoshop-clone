"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface ResizeHandleProps {
  /** "horizontal" = drag changes width (left/right), "vertical" = drag changes height (up/down) */
  direction: "horizontal" | "vertical"
  /** Callback with px delta: positive = grows right/down, negative = shrinks */
  onResize: (delta: number) => void
  onResizeEnd?: () => void
  /** Optional reset to the default size (Enter/Space or double-click) */
  onReset?: () => void
  className?: string
  ariaLabel?: string
  ariaValueNow?: number
  ariaValueMin?: number
  ariaValueMax?: number
  /** px per arrow key press */
  step?: number
  /** px per arrow key press while Shift is held */
  fineStep?: number
  /** px per PageUp/PageDown press */
  largeStep?: number
}

export function ResizeHandle({
  direction,
  onResize,
  onResizeEnd,
  onReset,
  className,
  ariaLabel,
  ariaValueNow = 50,
  ariaValueMin = 0,
  ariaValueMax = 100,
  step = 16,
  fineStep = 1,
  largeStep = 64,
}: ResizeHandleProps) {
  const handleRef = React.useRef<HTMLDivElement>(null)
  const dragging = React.useRef(false)
  const lastPos = React.useRef(0)
  const previousCursor = React.useRef("")
  const previousUserSelect = React.useRef("")
  const onResizeRef = React.useRef(onResize)
  const onResizeEndRef = React.useRef(onResizeEnd)
  const onResetRef = React.useRef(onReset)
  const isH = direction === "horizontal"

  React.useEffect(() => {
    onResizeRef.current = onResize
  }, [onResize])

  React.useEffect(() => {
    onResizeEndRef.current = onResizeEnd
  }, [onResizeEnd])

  React.useEffect(() => {
    onResetRef.current = onReset
  }, [onReset])

  const finishDrag = React.useCallback(
    (pointerId?: number) => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = previousCursor.current
      document.body.style.userSelect = previousUserSelect.current
      const el = handleRef.current
      if (el && pointerId !== undefined && el.hasPointerCapture?.(pointerId)) {
        el.releasePointerCapture(pointerId)
      }
      onResizeEndRef.current?.()
    },
    [],
  )

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragging.current = true
      lastPos.current = direction === "horizontal" ? e.clientX : e.clientY
      previousCursor.current = document.body.style.cursor
      previousUserSelect.current = document.body.style.userSelect
      document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize"
      document.body.style.userSelect = "none"
      const el = handleRef.current
      if (el) el.setPointerCapture(e.pointerId)
    },
    [direction],
  )

  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return
      const pos = direction === "horizontal" ? e.clientX : e.clientY
      const delta = pos - lastPos.current
      if (delta !== 0) {
        onResizeRef.current(delta)
        lastPos.current = pos
      }
    },
    [direction],
  )

  const handlePointerUp = React.useCallback(
    (e: React.PointerEvent) => {
      finishDrag(e.pointerId)
    },
    [finishDrag],
  )

  // Interrupted input (touch cancel, lost capture, tab switch) must not leave
  // the handle in a dragging state with the body cursor/selection overridden.
  const handlePointerCancel = React.useCallback(
    (e: React.PointerEvent) => {
      finishDrag(e.pointerId)
    },
    [finishDrag],
  )

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!dragging.current) return
        e.preventDefault()
        finishDrag()
        return
      }

      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        if (!onResetRef.current) return
        e.preventDefault()
        onResetRef.current()
        return
      }

      const nudge = e.shiftKey ? fineStep : step
      let delta = 0

      if (isH) {
        if (e.key === "ArrowLeft") delta = -nudge
        else if (e.key === "ArrowRight") delta = nudge
      } else {
        if (e.key === "ArrowUp") delta = -nudge
        else if (e.key === "ArrowDown") delta = nudge
      }

      if (e.key === "PageUp") delta = -largeStep
      else if (e.key === "PageDown") delta = largeStep
      else if (e.key === "Home") delta = ariaValueMin - ariaValueNow
      else if (e.key === "End") delta = ariaValueMax - ariaValueNow

      if (!delta) return
      e.preventDefault()
      onResizeRef.current(delta)
      // Each step is a complete resize so persisted sizes stay in sync
      onResizeEndRef.current?.()
    },
    [ariaValueMax, ariaValueMin, ariaValueNow, fineStep, finishDrag, isH, largeStep, step],
  )

  React.useEffect(() => {
    const move = (event: PointerEvent) => handlePointerMove(event as unknown as React.PointerEvent)
    const up = (event: PointerEvent) => finishDrag(event.pointerId)
    const cancel = (event: PointerEvent) => finishDrag(event.pointerId)
    const blur = () => finishDrag()
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", cancel)
    window.addEventListener("blur", blur)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      window.removeEventListener("blur", blur)
      finishDrag()
    }
  }, [finishDrag, handlePointerMove])

  return (
    <div
      ref={handleRef}
      role="separator"
      tabIndex={0}
      aria-label={ariaLabel ?? (isH ? "Resize horizontally" : "Resize vertically")}
      aria-orientation={isH ? "vertical" : "horizontal"}
      aria-valuenow={Math.round(ariaValueNow)}
      aria-valuemin={Math.round(ariaValueMin)}
      aria-valuemax={Math.round(ariaValueMax)}
      aria-keyshortcuts={onReset ? "ArrowLeft ArrowRight ArrowUp ArrowDown PageUp PageDown Home End Enter" : "ArrowLeft ArrowRight ArrowUp ArrowDown PageUp PageDown Home End"}
      className={cn(
        "group relative flex-shrink-0 bg-transparent transition-colors z-30 focus-visible:outline-none",
        isH
          ? "w-3 cursor-col-resize before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-[var(--ps-divider)] before:transition-colors hover:before:w-1 hover:before:bg-[var(--ps-accent)] active:before:w-1 active:before:bg-[var(--ps-accent)] focus-visible:before:w-1 focus-visible:before:bg-[var(--ps-accent)]"
          : "h-2 cursor-row-resize before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-[var(--ps-divider)] before:transition-colors hover:before:h-1 hover:before:bg-[var(--ps-accent)] active:before:h-1 active:before:bg-[var(--ps-accent)] focus-visible:before:h-1 focus-visible:before:bg-[var(--ps-accent)]",
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      onDoubleClick={onReset ? (event) => { event.preventDefault(); onResetRef.current?.() } : undefined}
      onKeyDown={handleKeyDown}
      style={{ touchAction: "none" }}
    />
  )
}
