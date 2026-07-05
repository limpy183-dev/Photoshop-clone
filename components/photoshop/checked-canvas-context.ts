export function requireCanvas2DContext(
  canvas: HTMLCanvasElement,
  owner = "canvas operation",
  options?: CanvasRenderingContext2DSettings,
): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", options)
  if (!context) {
    throw new Error(`Canvas 2D context unavailable for ${owner}.`)
  }
  return context
}
