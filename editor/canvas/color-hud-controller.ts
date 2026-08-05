/**
 * The floating colour-picker HUD (Alt+Shift+right-click on the canvas).
 *
 * While it is open the whole window is the picker: pointer-move re-picks,
 * pointer-up commits to the foreground swatch, Escape cancels. That is why the
 * listeners live on `window` rather than on the canvas — the gesture routinely
 * leaves the element it started on.
 */

import * as React from "react"

import { addPhotoshopEventListener } from "@/editor/events"
import { hexToHsv, hsvToHex, pickFromHud, type ColorPickerHudHsv } from "@/components/photoshop/color/picker-hud"
import type { Action } from "@/editor/reducer"

export interface ColorHudState {
  screenX: number
  screenY: number
  hsv: ColorPickerHudHsv
  /** -1 when opened programmatically, so no pointer capture is expected. */
  pointerId: number
}

export function useColorPickerHud(foreground: string, dispatch: React.Dispatch<Action>) {
  const [colorHud, setColorHud] = React.useState<ColorHudState | null>(null)
  const colorHudRef = React.useRef<ColorHudState | null>(null)
  React.useEffect(() => {
    colorHudRef.current = colorHud
  }, [colorHud])

  // External activation: a CustomEvent path so touch UI, the command palette,
  // or scripts can open the HUD at an arbitrary screen position. Pointer
  // capture is skipped — the HUD then commits on the next pointer up anywhere.
  React.useEffect(() => {
    function open(e: Event) {
      const detail = (e as CustomEvent<{ screenX?: number; screenY?: number }>).detail ?? {}
      const cx = typeof detail.screenX === "number"
        ? detail.screenX
        : Math.round(window.innerWidth / 2)
      const cy = typeof detail.screenY === "number"
        ? detail.screenY
        : Math.round(window.innerHeight / 2)
      setColorHud({
        screenX: cx,
        screenY: cy,
        hsv: hexToHsv(foreground),
        pointerId: -1,
      })
    }
    return addPhotoshopEventListener("ps-open-color-picker-hud", (_detail, event) => open(event))
  }, [foreground])

  React.useEffect(() => {
    if (!colorHud) return
    function move(e: PointerEvent) {
      const hud = colorHudRef.current
      if (!hud) return
      // pointerId -1 means the HUD was opened programmatically (no pointer
      // capture). Any pointer movement updates it; a click commits.
      if (hud.pointerId !== -1 && e.pointerId !== hud.pointerId) return
      const result = pickFromHud(hud, e.clientX, e.clientY)
      if (result.changed) {
        setColorHud((prev) => (prev ? { ...prev, hsv: result.hsv } : prev))
      }
    }
    function commitColor(e: PointerEvent) {
      const hud = colorHudRef.current
      if (!hud) return
      if (hud.pointerId !== -1 && e.pointerId !== hud.pointerId) return
      const hex = hsvToHex(hud.hsv.h, hud.hsv.s, hud.hsv.v)
      dispatch({ type: "set-foreground", color: hex })
      setColorHud(null)
    }
    function cancelOnEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setColorHud(null)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", commitColor)
    window.addEventListener("pointercancel", commitColor)
    window.addEventListener("keydown", cancelOnEsc)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", commitColor)
      window.removeEventListener("pointercancel", commitColor)
      window.removeEventListener("keydown", cancelOnEsc)
    }
  }, [colorHud, dispatch])

  return { colorHud, setColorHud }
}
