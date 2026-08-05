/**
 * Coverage probe shared by every mask thumbnail in the UI.
 *
 * Reading a full mask back just to label its thumbnail is wasteful, so this
 * samples five fixed points (corners plus centre) and reports whether the mask
 * reads as fully hidden, fully revealed, or somewhere in between. It is a
 * label, not a measurement — callers use it to pick a badge, never to decide
 * what to composite.
 */

export type MaskCoverage = "disabled" | "none" | "hidden" | "revealed" | "mixed"

export function maskCoverageState(
  mask: HTMLCanvasElement | null | undefined,
  enabled: boolean,
): MaskCoverage {
  if (!enabled) return "disabled"
  if (!mask) return "none"
  const ctx = mask.getContext("2d")
  if (!ctx) return "none"
  const points = [
    [0, 0],
    [Math.max(0, Math.floor(mask.width / 2)), Math.max(0, Math.floor(mask.height / 2))],
    [Math.max(0, mask.width - 1), 0],
    [0, Math.max(0, mask.height - 1)],
    [Math.max(0, mask.width - 1), Math.max(0, mask.height - 1)],
  ]
  let min = 255
  let max = 0
  for (const [x, y] of points) {
    const px = ctx.getImageData(x, y, 1, 1).data
    const lum = (px[0] + px[1] + px[2]) / 3
    min = Math.min(min, lum)
    max = Math.max(max, lum)
  }
  if (max <= 8) return "hidden"
  if (min >= 247) return "revealed"
  return "mixed"
}
