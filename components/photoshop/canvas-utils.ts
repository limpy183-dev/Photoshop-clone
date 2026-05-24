/* ------------------------------------------------------------------ */
/*  Canvas helpers                                                      */
/*                                                                      */
/*  SSR-safe canvas factory. During server rendering we return a small  */
/*  stub object so module-level constructions don't crash; on the       */
/*  client we hand back a real HTMLCanvasElement.                       */
/* ------------------------------------------------------------------ */

import { assertCanvasSize } from "./canvas-limits"

/**
 * Create a sized HTMLCanvasElement, optionally filled with `fill`.
 *
 * During SSR (`document` undefined) this returns an object that satisfies
 * the structural HTMLCanvasElement shape — width/height/getContext — but
 * with a null 2D context. Callers that need a real canvas must guard on
 * the runtime themselves.
 */
export function makeCanvas(w: number, h: number, fill?: string): HTMLCanvasElement {
  const size = assertCanvasSize(w, h)
  if (typeof document === "undefined") {
    return {
      width: size.width,
      height: size.height,
      getContext: () => null,
    } as unknown as HTMLCanvasElement
  }
  const c = document.createElement("canvas")
  c.width = size.width
  c.height = size.height
  if (fill) {
    const ctx = c.getContext("2d")
    if (ctx) {
      ctx.fillStyle = fill
      ctx.fillRect(0, 0, size.width, size.height)
    }
  }
  return c
}
