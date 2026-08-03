/** Selections, quick mask, saved alpha channels. */

export interface Selection {
  bounds: { x: number; y: number; w: number; h: number } | null
  shape: "rect" | "ellipse" | "polygon" | "freehand" | "wand" | "color"
  mask?: HTMLCanvasElement | null
  feather?: number
  diagnostics?: SelectionDiagnostics
}

export type SelectionDiagnosticReason = "accepted" | "color" | "edge" | "alpha" | "limit" | "bounds"

export interface SelectionDiagnostics {
  acceptedPixels: number
  rejectedPixels: number
  coverageRatio: number
  boundsTouchesCanvas: boolean
  maxPixelsReached: boolean
  queueExhausted: boolean
  summary: string
  reasonCounts: Record<SelectionDiagnosticReason, number>
  /**
   * Per-document-pixel reason map used to render visual diagnostics.
   * 0 = unvisited, 1 = accepted, 2 = color rejected, 3 = edge rejected,
   * 4 = alpha rejected, 5 = max-pixel limit, 6 = canvas bounds.
   */
  reasonMap: Uint8ClampedArray
}

export type QuickMaskPaintMode = "add" | "subtract" | "auto"

/** Saved alpha channel for selection save/load */
export interface AlphaChannel {
  id: string
  name: string
  canvas: HTMLCanvasElement
  /** Alpha channels store selections; spot channels additionally carry ink preview metadata. */
  kind?: "alpha" | "spot"
  /** Spot ink preview color. PSD export also preserves this through the encoded channel name convention. */
  spotColor?: string
  /** Spot ink preview opacity, 0..100. */
  spotOpacity?: number
}
