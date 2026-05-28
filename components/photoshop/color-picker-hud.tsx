"use client"

import * as React from "react"
import { hexToRgb, rgbToHex } from "./color-utils"

export interface ColorPickerHudHsv {
  h: number
  s: number
  v: number
}

export function rgbToHsv(r: number, g: number, b: number): ColorPickerHudHsv {
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

export function hsvToRgb(h: number, s: number, v: number) {
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

export function hsvToHex(h: number, s: number, v: number): string {
  const { r, g, b } = hsvToRgb(h, s, v)
  return rgbToHex(r, g, b)
}

export function hexToHsv(hex: string): ColorPickerHudHsv {
  const { r, g, b } = hexToRgb(hex)
  return rgbToHsv(r, g, b)
}

const SQUARE = 132
const HUE_W = 18

export interface ColorPickerHudProps {
  /** Screen coordinates where the HUD appeared (cursor at activation). */
  screenX: number
  screenY: number
  hsv: ColorPickerHudHsv
}

/**
 * Floating mini hue-strip + saturation/brightness square popup.
 *
 * Activated by Alt+Shift+RightClick on the canvas. The host wires pointer
 * events on the canvas itself; this component only paints the chrome and
 * draws the indicator dots — it does not own the pointer.
 */
export function ColorPickerHud({ screenX, screenY, hsv }: ColorPickerHudProps) {
  const sqRef = React.useRef<HTMLCanvasElement>(null)
  const hueRef = React.useRef<HTMLCanvasElement>(null)

  // Paint saturation/brightness square for the current hue.
  React.useEffect(() => {
    const cvs = sqRef.current
    if (!cvs) return
    const ctx = cvs.getContext("2d")
    if (!ctx) return
    cvs.width = SQUARE
    cvs.height = SQUARE
    const img = ctx.createImageData(SQUARE, SQUARE)
    for (let y = 0; y < SQUARE; y++) {
      const v = 1 - y / (SQUARE - 1)
      for (let x = 0; x < SQUARE; x++) {
        const s = x / (SQUARE - 1)
        const { r, g, b } = hsvToRgb(hsv.h, s, v)
        const idx = (y * SQUARE + x) * 4
        img.data[idx] = r
        img.data[idx + 1] = g
        img.data[idx + 2] = b
        img.data[idx + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [hsv.h])

  // Paint vertical hue strip.
  React.useEffect(() => {
    const cvs = hueRef.current
    if (!cvs) return
    const ctx = cvs.getContext("2d")
    if (!ctx) return
    cvs.width = HUE_W
    cvs.height = SQUARE
    for (let y = 0; y < SQUARE; y++) {
      const h = (y / (SQUARE - 1)) * 360
      const { r, g, b } = hsvToRgb(h, 1, 1)
      ctx.fillStyle = `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`
      ctx.fillRect(0, y, HUE_W, 1)
    }
  }, [])

  const totalW = SQUARE + HUE_W + 12
  const totalH = SQUARE + 28
  // Position the HUD so the cursor falls inside the saturation square at the
  // current S/V coordinate of the active color.
  const indicatorX = hsv.s * (SQUARE - 1)
  const indicatorY = (1 - hsv.v) * (SQUARE - 1)
  const left = screenX - indicatorX - 6
  const top = screenY - indicatorY - 6
  const hueY = (hsv.h / 360) * (SQUARE - 1)
  const swatch = hsvToHex(hsv.h, hsv.s, hsv.v)

  return (
    <div
      data-testid="color-picker-hud"
      style={{
        position: "fixed",
        left,
        top,
        width: totalW,
        height: totalH,
        zIndex: 60,
        pointerEvents: "none",
      }}
      className="rounded-sm border border-black/70 bg-[#1d1d1d]/95 p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.6)]"
    >
      <div className="flex gap-1.5">
        <div className="relative" style={{ width: SQUARE, height: SQUARE }}>
          <canvas
            ref={sqRef}
            width={SQUARE}
            height={SQUARE}
            style={{ display: "block", width: SQUARE, height: SQUARE }}
          />
          <div
            style={{
              position: "absolute",
              left: indicatorX - 5,
              top: indicatorY - 5,
              width: 10,
              height: 10,
              borderRadius: "50%",
              border: "2px solid white",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.6)",
              pointerEvents: "none",
            }}
          />
        </div>
        <div className="relative" style={{ width: HUE_W, height: SQUARE }}>
          <canvas
            ref={hueRef}
            width={HUE_W}
            height={SQUARE}
            style={{ display: "block", width: HUE_W, height: SQUARE }}
          />
          <div
            style={{
              position: "absolute",
              left: -2,
              right: -2,
              top: hueY - 1,
              height: 3,
              border: "1px solid white",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.6)",
              pointerEvents: "none",
            }}
          />
        </div>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-white">
        <span
          style={{ background: swatch, width: 16, height: 16, display: "inline-block", border: "1px solid rgba(255,255,255,0.4)" }}
        />
        <span className="font-mono">{swatch.toUpperCase()}</span>
      </div>
    </div>
  )
}

export interface HudHitResult {
  hsv: ColorPickerHudHsv
  changed: boolean
}

/**
 * Map a current screen-space pointer position to an updated HSV based on
 * the original HUD anchor. The HUD layout is:
 *
 *   [ S/V square (132x132) ][ gap 6 ][ hue strip (18x132) ]
 *
 * Returns the new HSV (clamped to the HUD bounds) and whether the value
 * differs from the input HSV.
 */
export function pickFromHud(
  hud: { screenX: number; screenY: number; hsv: ColorPickerHudHsv },
  pointerX: number,
  pointerY: number,
): HudHitResult {
  const indicatorX = hud.hsv.s * (SQUARE - 1)
  const indicatorY = (1 - hud.hsv.v) * (SQUARE - 1)
  const padLeft = hud.screenX - indicatorX - 6 + 6
  const padTop = hud.screenY - indicatorY - 6 + 6
  const localX = pointerX - padLeft
  const localY = pointerY - padTop
  // S/V square area.
  const sqX = Math.max(0, Math.min(SQUARE - 1, localX))
  const sqY = Math.max(0, Math.min(SQUARE - 1, localY))
  // Hue strip starts at SQUARE + 6.
  const hueStart = SQUARE + 6
  const inHueStrip = localX >= hueStart - 4 && localX <= hueStart + HUE_W + 4
  if (inHueStrip) {
    const h = Math.max(0, Math.min(359.999, (sqY / (SQUARE - 1)) * 360))
    return { hsv: { h, s: hud.hsv.s, v: hud.hsv.v }, changed: Math.abs(h - hud.hsv.h) > 0.1 }
  }
  const s = sqX / (SQUARE - 1)
  const v = 1 - sqY / (SQUARE - 1)
  return { hsv: { h: hud.hsv.h, s, v }, changed: Math.abs(s - hud.hsv.s) > 0.001 || Math.abs(v - hud.hsv.v) > 0.001 }
}
