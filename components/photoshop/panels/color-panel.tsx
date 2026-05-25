"use client"

import * as React from "react"
import { useEditor } from "../editor-context"
import { hexToRgb } from "../color-utils"
import { dispatchPhotoshopEvent } from "../events"
function rgbToHex(r: number, g: number, b: number) {
  return (
    "#" +
    [r, g, b]
      .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0"))
      .join("")
  )
}

function rgbToHsv(r: number, g: number, b: number) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  const s = max === 0 ? 0 : d / max
  const v = max
  if (d !== 0) {
    switch (max) {
      case r:
        h = ((g - b) / d) % 6
        break
      case g:
        h = (b - r) / d + 2
        break
      case b:
        h = (r - g) / d + 4
        break
    }
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s, v }
}

function hsvToRgb(h: number, s: number, v: number) {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

/**
 * The Color panel deliberately uses a *local* HSV state for the picker UI
 * and only flushes the global foreground color once per animation frame.
 * Without this, dragging the picker dispatches dozens of state updates per
 * second, and every layer/canvas in the entire editor re-renders for each
 * one — which is what was causing the perceived "lag".
 */
export function ColorPanel() {
  const { foreground, background, dispatch } = useEditor()

  // Local HSV mirror of the global foreground color. Updates immediately
  // as the user drags so the UI stays in sync, while the global dispatch
  // is throttled below.
  const [localHsv, setLocalHsv] = React.useState(() => {
    const { r, g, b } = hexToRgb(foreground)
    return rgbToHsv(r, g, b)
  })
  const draggingRef = React.useRef(false)

  // Sync from outer state when the foreground changes externally
  // (e.g. eyedropper, swatches, swap-colors, etc.).
  React.useEffect(() => {
    if (draggingRef.current) return
    const { r, g, b } = hexToRgb(foreground)
    const hsv = rgbToHsv(r, g, b)
    setLocalHsv((prev) =>
      Math.abs(prev.h - hsv.h) < 0.5 &&
      Math.abs(prev.s - hsv.s) < 0.005 &&
      Math.abs(prev.v - hsv.v) < 0.005
        ? prev
        : hsv,
    )
  }, [foreground])

  // Throttled dispatch — coalesces rapid updates into 1 per animation frame.
  const rafRef = React.useRef<number | null>(null)
  const pendingRef = React.useRef<string | null>(null)
  const flush = React.useCallback(() => {
    if (pendingRef.current) {
      dispatch({ type: "set-foreground", color: pendingRef.current })
      pendingRef.current = null
    }
    rafRef.current = null
  }, [dispatch])
  const queueDispatch = React.useCallback(
    (color: string) => {
      pendingRef.current = color
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(flush)
    },
    [flush],
  )
  React.useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  const setHsv = React.useCallback(
    (h: number, s: number, v: number) => {
      setLocalHsv({ h, s, v })
      const { r, g, b } = hsvToRgb(h, s, v)
      queueDispatch(rgbToHex(r, g, b))
    },
    [queueDispatch],
  )

  /* ---------- Saturation/Value picker (square) ---------- */
  const sbRef = React.useRef<HTMLDivElement>(null)
  const onSbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = sbRef.current
    if (!el) return
    el.setPointerCapture(e.pointerId)
    draggingRef.current = true
    const updateFromEvent = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
      setHsv(localHsv.h, x, 1 - y)
    }
    updateFromEvent(e.clientX, e.clientY)
    const onMove = (ev: PointerEvent) => updateFromEvent(ev.clientX, ev.clientY)
    const onUp = () => {
      draggingRef.current = false
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  /* ---------- Hue strip ---------- */
  const hueRef = React.useRef<HTMLDivElement>(null)
  const onHuePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = hueRef.current
    if (!el) return
    el.setPointerCapture(e.pointerId)
    draggingRef.current = true
    const updateFromEvent = (clientX: number) => {
      const rect = el.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      setHsv(x * 360, localHsv.s, localHsv.v)
    }
    updateFromEvent(e.clientX)
    const onMove = (ev: PointerEvent) => updateFromEvent(ev.clientX)
    const onUp = () => {
      draggingRef.current = false
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  // Compute the *displayed* color from local HSV so the UI never feels stale
  const localRgb = hsvToRgb(localHsv.h, localHsv.s, localHsv.v)
  const localHex = rgbToHex(localRgb.r, localRgb.g, localRgb.b)
  const hueColor = `hsl(${localHsv.h}, 100%, 50%)`
  const openPicker = (kind: "fg" | "bg", surface: "dialog" | "hud" = "dialog") => {
    dispatchPhotoshopEvent("ps-open-color-picker", {
      target: kind === "fg" ? "foreground" : "background",
      surface,
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-2">
      {/* Color swatches + hex row */}
      <div className="flex items-center gap-2">
        <div className="relative">
          <button
            onClick={() => openPicker("bg")}
            className="absolute -bottom-1 -right-1 w-6 h-6 border border-[var(--ps-text)] shadow-sm rounded-sm"
            style={{ background }}
            aria-label="Background color"
            title="Background color"
          />
          <button
            onClick={() => openPicker("fg")}
            className="relative w-8 h-8 border border-[var(--ps-text)] shadow-sm z-10 rounded-sm"
            style={{ background: localHex }}
            aria-label="Foreground color"
            title="Foreground color"
          />
        </div>
        <div className="flex-1 min-w-0">
          <input
            value={localHex}
            onChange={(e) => {
              const val = e.target.value
              if (/^#[0-9a-fA-F]{6}$/.test(val)) {
                const { r, g, b } = hexToRgb(val)
                setLocalHsv(rgbToHsv(r, g, b))
                dispatch({ type: "set-foreground", color: val })
              }
            }}
            className="w-full h-6 px-1.5 bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] rounded-sm font-mono text-[11px] uppercase"
          />
        </div>
        <button
          onClick={() => dispatch({ type: "swap-colors" })}
          className="w-6 h-6 flex items-center justify-center text-[var(--ps-text-dim)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-tool-hover)] rounded-sm"
          title="Swap colors (X)"
          aria-label="Swap foreground and background"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 3l-4 4 4 4" />
            <path d="M3 7h13a4 4 0 0 1 4 4v0" />
            <path d="M17 21l4-4-4-4" />
            <path d="M21 17H8a4 4 0 0 1-4-4v0" />
          </svg>
        </button>
      </div>

      {/* HSV picker — SV field fills available height */}
      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => openPicker("fg", "dialog")}
          className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[10px] text-[var(--ps-text)] hover:bg-[var(--ps-tool-hover)]"
        >
          Full picker
        </button>
        <button
          type="button"
          onClick={() => openPicker("fg", "hud")}
          className="h-7 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] text-[10px] text-[var(--ps-text)] hover:bg-[var(--ps-tool-hover)]"
        >
          HUD picker
        </button>
      </div>

      <div className="flex min-h-[190px] flex-1 flex-col gap-1.5">
        <div
          ref={sbRef}
          onPointerDown={onSbPointerDown}
          className="relative w-full flex-1 min-h-[140px] rounded-sm border border-[var(--ps-divider)] cursor-crosshair touch-none overflow-hidden"
          style={{
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
          }}
          aria-label="Saturation/Brightness"
        >
          <div
            className="absolute w-3.5 h-3.5 rounded-full border-2 border-white pointer-events-none"
            style={{
              left: `calc(${localHsv.s * 100}% - 7px)`,
              top: `calc(${(1 - localHsv.v) * 100}% - 7px)`,
              boxShadow: "0 0 0 1px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(0,0,0,0.5)",
              background: localHex,
            }}
          />
        </div>
        <div
          ref={hueRef}
          onPointerDown={onHuePointerDown}
          className="relative w-full h-4 rounded-sm border border-[var(--ps-divider)] cursor-pointer touch-none"
          style={{
            background:
              "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
          }}
          aria-label="Hue"
        >
          <div
            className="absolute -top-0.5 -bottom-0.5 w-2 bg-white border border-black rounded-sm pointer-events-none"
            style={{ left: `calc(${(localHsv.h / 360) * 100}% - 4px)` }}
          />
        </div>
      </div>

    </div>
  )
}

const _SWATCHES = [
  "#000000", "#404040", "#7f7f7f", "#bfbfbf", "#ffffff",
  "#ff0000", "#ff7f00", "#ffff00", "#7fff00", "#00ff00",
  "#00ff7f", "#00ffff", "#007fff", "#0000ff", "#7f00ff",
  "#ff00ff", "#ff007f", "#7f1f00", "#7f3f00", "#7f7f00",
  "#3f7f00", "#007f00", "#007f3f", "#007f7f", "#003f7f",
  "#00007f", "#3f007f", "#7f007f", "#7f003f", "#000000",
]
