"use client"

/**
 * The Blend If section — per-channel selector, the two ranges, and the split
 * slider whose handles can be dragged apart to feather the blend.
 *
 * Split out of `layer-style-dialog.tsx`: the split-slider drag maths alone is
 * over a hundred lines and has nothing to do with the rest of the dialog.
 */

import { SelectRow } from "@/components/photoshop/layer-style-controls"
import * as React from "react"
import { defaultBlendIfRange, setBlendIfRangeHandle } from "@/editor/layer-workflows"
import type { BlendIfChannel, BlendIfRange } from "@/editor/types"
export function BlendIfChannelSelector({
  value,
  onChange,
}: {
  value: BlendIfChannel
  onChange: (channel: BlendIfChannel) => void
}) {
  return (
    <SelectRow
      label="Blend If Channel"
      value={value}
      options={[
        ["gray", "Gray"],
        ["r", "Red"],
        ["g", "Green"],
        ["b", "Blue"],
      ]}
      onChange={(v) => onChange(v as BlendIfChannel)}
    />
  )
}

export function BlendIfControls({
  label,
  range,
  channel,
  onChange,
}: {
  label: string
  range: BlendIfRange
  channel: BlendIfChannel
  onChange: (range: BlendIfRange) => void
}) {
  const trackBackground = React.useMemo(() => {
    if (channel === "r") return "linear-gradient(to right, #000, #f44)"
    if (channel === "g") return "linear-gradient(to right, #000, #4d4)"
    if (channel === "b") return "linear-gradient(to right, #000, #5ab)"
    return "linear-gradient(to right, #000, #fff)"
  }, [channel])
  const reset = () => onChange(defaultBlendIfRange())
  return (
    <div className="grid gap-2 rounded-sm border border-[var(--ps-divider)] p-2">
      <div className="flex items-center justify-between text-[11px] font-medium">
        <span>{label}</span>
        <button
          type="button"
          onClick={reset}
          className="rounded-sm px-1.5 py-0.5 text-[10px] text-[var(--ps-text-dim)] hover:bg-[var(--ps-tool-hover)] hover:text-[var(--ps-text)]"
        >
          Reset
        </button>
      </div>
      <BlendIfSplitSlider range={range} trackBackground={trackBackground} onChange={onChange} />
      <div className="grid grid-cols-4 gap-1 text-[9.5px] text-[var(--ps-text-dim)]">
        <span>Black: {range.black}</span>
        <span>Split: {range.blackFeather}</span>
        <span>Split: {range.whiteFeather}</span>
        <span className="text-right">White: {range.white}</span>
      </div>
    </div>
  )
}

export type BlendIfHandle = "black" | "blackFeather" | "whiteFeather" | "white"

export function BlendIfSplitSlider({
  range,
  trackBackground,
  onChange,
}: {
  range: BlendIfRange
  trackBackground: string
  onChange: (range: BlendIfRange) => void
}) {
  const trackRef = React.useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = React.useState<BlendIfHandle | null>(null)

  // Photoshop hides the feather track visually until the user Alt-drags; render
  // both feather and end handles, with the active fill spanning the inner pair.
  const handlePositions: Array<{ handle: BlendIfHandle; value: number; label: string }> = [
    { handle: "black", value: range.black, label: "Black handle" },
    { handle: "blackFeather", value: range.blackFeather, label: "Black feather" },
    { handle: "whiteFeather", value: range.whiteFeather, label: "White feather" },
    { handle: "white", value: range.white, label: "White handle" },
  ]

  const updateForPointer = React.useCallback(
    (handle: BlendIfHandle, clientX: number, altKey: boolean) => {
      const el = trackRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0
      const value = Math.round(ratio * 255)
      // Alt-drag on a black/white endpoint splits the feather; otherwise the
      // feather snaps to the endpoint (default Photoshop behaviour).
      const split = altKey || handle === "blackFeather" || handle === "whiteFeather"
      onChange(setBlendIfRangeHandle(range, handle, value, { split }))
    },
    [onChange, range],
  )

  React.useEffect(() => {
    if (!dragging) return
    const onMove = (event: PointerEvent) => updateForPointer(dragging, event.clientX, event.altKey)
    const onUp = () => setDragging(null)
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp, { once: true })
    window.addEventListener("pointercancel", onUp, { once: true })
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }, [dragging, updateForPointer])

  const onHandlePointerDown = (event: React.PointerEvent, handle: BlendIfHandle) => {
    event.preventDefault()
    setDragging(handle)
    updateForPointer(handle, event.clientX, event.altKey)
  }

  const onHandleKeyDown = (event: React.KeyboardEvent, handle: BlendIfHandle, value: number) => {
    const step = event.shiftKey ? 10 : 1
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault()
      onChange(setBlendIfRangeHandle(range, handle, value - step, { split: event.altKey || handle === "blackFeather" || handle === "whiteFeather" }))
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault()
      onChange(setBlendIfRangeHandle(range, handle, value + step, { split: event.altKey || handle === "blackFeather" || handle === "whiteFeather" }))
    } else if (event.key === "Home") {
      event.preventDefault()
      onChange(setBlendIfRangeHandle(range, handle, 0, { split: event.altKey }))
    } else if (event.key === "End") {
      event.preventDefault()
      onChange(setBlendIfRangeHandle(range, handle, 255, { split: event.altKey }))
    }
  }

  const blackPct = (range.black / 255) * 100
  const blackFeatherPct = (range.blackFeather / 255) * 100
  const whiteFeatherPct = (range.whiteFeather / 255) * 100
  const whitePct = (range.white / 255) * 100

  return (
    <div className="select-none" title="Alt-drag a black or white handle to split it into a soft feather">
      <div
        ref={trackRef}
        className="relative h-5 rounded-sm border border-[var(--ps-divider)]"
        style={{ background: trackBackground }}
      >
        {/* visible "pass" band between feather pair */}
        <div
          className="absolute top-0 h-full bg-white/15"
          style={{ left: `${blackFeatherPct}%`, width: `${Math.max(0, whiteFeatherPct - blackFeatherPct)}%` }}
        />
        {/* outer cutoff bands (clamped to zero coverage) */}
        <div
          className="absolute top-0 h-full bg-black/40"
          style={{ left: 0, width: `${blackPct}%` }}
        />
        <div
          className="absolute top-0 h-full bg-black/40"
          style={{ left: `${whitePct}%`, width: `${100 - whitePct}%` }}
        />
        {handlePositions.map(({ handle, value, label }) => {
          const isEndpoint = handle === "black" || handle === "white"
          const pct = (value / 255) * 100
          return (
            <button
              key={handle}
              type="button"
              role="slider"
              aria-label={label}
              aria-valuemin={0}
              aria-valuemax={255}
              aria-valuenow={value}
              onPointerDown={(event) => onHandlePointerDown(event, handle)}
              onKeyDown={(event) => onHandleKeyDown(event, handle, value)}
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-4 w-3 cursor-ew-resize rounded-sm border ${
                dragging === handle
                  ? "border-[var(--ps-accent)] bg-[var(--ps-accent)]"
                  : "border-[var(--ps-divider)] bg-[var(--ps-panel-2)]"
              } ${isEndpoint ? "" : "opacity-80"}`}
              style={{ left: `${pct}%` }}
            />
          )
        })}
      </div>
      <div className="mt-1 text-[9.5px] text-[var(--ps-text-dim)]">
        Drag to move endpoints. Alt-drag a black/white handle to split it for soft transitions.
      </div>
    </div>
  )
}
