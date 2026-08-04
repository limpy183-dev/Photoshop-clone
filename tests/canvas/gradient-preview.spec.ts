import { expect, test } from "@playwright/test"

import { drawGradientPreview } from "@/editor/canvas/overlay-previews"
import { getGradientStops, sampleGradient } from "@/editor/canvas/view-helpers"
import type { GradientSettings, PsDocument } from "@/editor/types"

const FOREGROUND = "#102040"
const BACKGROUND = "#f0c080"

/**
 * The diamond ramp is the one gradient type with no CanvasGradient equivalent,
 * so it is painted per pixel through a lookup table. These tests pin that table
 * to what `sampleGradient` — the reference the other ramps share — would have
 * produced pixel by pixel.
 */
function fakeOverlay(width: number, height: number) {
  let painted: Uint8ClampedArray | null = null
  const context = {
    canvas: { width, height },
    save: () => {},
    restore: () => {},
    clearRect: () => {},
    createImageData: (w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    }),
    putImageData: (image: { data: Uint8ClampedArray }) => {
      painted = image.data
    },
  } as unknown as CanvasRenderingContext2D
  const overlay = {
    width,
    height,
    getContext: () => context,
  } as unknown as HTMLCanvasElement
  return { overlay, pixel: (x: number, y: number) => {
    if (!painted) throw new Error("putImageData was never called")
    const i = (y * width + x) * 4
    return [painted[i], painted[i + 1], painted[i + 2], painted[i + 3]]
  } }
}

const unselectedDocument = { selection: { bounds: null } } as unknown as PsDocument

function reference(gradient: GradientSettings, t: number) {
  const stops = getGradientStops(gradient, FOREGROUND, BACKGROUND)
  const c = sampleGradient(gradient, stops, t)
  return [c.r, c.g, c.b, c.a]
}

/** One lookup-table step, so index rounding cannot fail the comparison. */
function expectColorNear(actual: number[], expected: number[]) {
  for (let i = 0; i < 4; i++) expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(2)
}

test("diamond gradient previews follow the |u|+|v| metric from the drag origin", () => {
  const gradient: GradientSettings = { type: "diamond", reverse: false }
  const { overlay, pixel } = fakeOverlay(64, 48)
  // Axis-aligned drag of length 16 from the middle of the overlay.
  drawGradientPreview(overlay, unselectedDocument, gradient, FOREGROUND, BACKGROUND, { x: 32, y: 24 }, { x: 48, y: 24 })

  expectColorNear(pixel(32, 24), reference(gradient, 0))
  // Equal Manhattan distance -> equal colour, whichever axis it came from.
  expectColorNear(pixel(40, 24), reference(gradient, 0.5))
  expectColorNear(pixel(32, 32), reference(gradient, 0.5))
  expectColorNear(pixel(36, 28), reference(gradient, 0.5))
  // Past the drag length the ramp clamps to its last stop.
  expectColorNear(pixel(0, 0), reference(gradient, 1))
})

test("diamond gradient previews honour reverse and cycle", () => {
  const reversed: GradientSettings = { type: "diamond", reverse: true }
  const first = fakeOverlay(40, 40)
  drawGradientPreview(first.overlay, unselectedDocument, reversed, FOREGROUND, BACKGROUND, { x: 20, y: 20 }, { x: 30, y: 20 })
  expectColorNear(first.pixel(20, 20), reference(reversed, 0))
  expectColorNear(first.pixel(25, 20), reference(reversed, 0.5))

  const cycled: GradientSettings = { type: "diamond", reverse: false, cycle: true }
  const second = fakeOverlay(40, 40)
  drawGradientPreview(second.overlay, unselectedDocument, cycled, FOREGROUND, BACKGROUND, { x: 20, y: 20 }, { x: 30, y: 20 })
  // 15px out is 1.5 ramps: cycling wraps it back to the middle of the ramp
  // instead of clamping to the end.
  expectColorNear(second.pixel(35, 20), reference(cycled, 0.5))
})
