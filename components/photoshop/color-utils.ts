/* ------------------------------------------------------------------ */
/*  Color helpers                                                       */
/*                                                                      */
/*  Consolidated home for hex/rgb conversions used across the editor.   */
/*  Prior to consolidation, hexToRgb was reimplemented 8+ times with    */
/*  subtly different alpha/short-form behavior — kept here as the       */
/*  single source of truth so a future bugfix lands everywhere at once. */
/* ------------------------------------------------------------------ */

export type Rgb = { r: number; g: number; b: number }

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export function hexToRgb(hex: string): Rgb {
  const raw = (hex || "#000000").trim().replace(/^#/, "")
  const normalized =
    raw.length === 3
      ? raw.split("").map((c) => c + c).join("")
      : raw.padEnd(6, "0").slice(0, 6)
  const parsed = Number.parseInt(normalized, 16)
  const v = Number.isFinite(parsed) ? parsed : 0
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 }
}

export function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r},${g},${b},${clamp01(alpha)})`
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp255 = (v: number) => {
    const n = Math.round(v)
    return (n < 0 ? 0 : n > 255 ? 255 : n).toString(16).padStart(2, "0")
  }
  return `#${clamp255(r)}${clamp255(g)}${clamp255(b)}`
}
