import type { SelectionDiagnostics, SelectionDiagnosticReason } from "./types"

type BoundsLike = {
  x: number
  y: number
  w: number
  h: number
}

const DIAGNOSTIC_REASON_CODE: Record<SelectionDiagnosticReason, number> = {
  accepted: 1,
  color: 2,
  edge: 3,
  alpha: 4,
  limit: 5,
  bounds: 6,
}

export function createSelectionDiagnostics(width: number, height: number): SelectionDiagnostics {
  return {
    acceptedPixels: 0,
    rejectedPixels: 0,
    coverageRatio: 0,
    boundsTouchesCanvas: false,
    maxPixelsReached: false,
    queueExhausted: false,
    summary: "Selection diagnostics are available.",
    reasonCounts: {
      accepted: 0,
      color: 0,
      edge: 0,
      alpha: 0,
      limit: 0,
      bounds: 0,
    },
    reasonMap: new Uint8ClampedArray(width * height),
  }
}

export function markSelectionDiagnostic(
  diagnostics: SelectionDiagnostics,
  pixel: number,
  reason: SelectionDiagnosticReason,
  primary = true,
) {
  diagnostics.reasonCounts[reason]++
  if (reason === "accepted") {
    diagnostics.reasonMap[pixel] = DIAGNOSTIC_REASON_CODE.accepted
  } else if (primary && diagnostics.reasonMap[pixel] === 0) {
    diagnostics.reasonMap[pixel] = DIAGNOSTIC_REASON_CODE[reason]
  }
}

export function finalizeSelectionDiagnostics(
  diagnostics: SelectionDiagnostics,
  width: number,
  height: number,
  bounds: BoundsLike | null,
  maxPixelsReached: boolean,
  queueExhausted: boolean,
) {
  diagnostics.acceptedPixels = diagnostics.reasonCounts.accepted
  diagnostics.rejectedPixels = diagnostics.reasonMap.reduce((sum, reason) => sum + (reason >= 2 ? 1 : 0), 0)
  diagnostics.coverageRatio = diagnostics.acceptedPixels / Math.max(1, width * height)
  diagnostics.maxPixelsReached = maxPixelsReached
  diagnostics.queueExhausted = queueExhausted
  diagnostics.boundsTouchesCanvas = !!bounds && (
    bounds.x <= 0 ||
    bounds.y <= 0 ||
    bounds.x + bounds.w >= width ||
    bounds.y + bounds.h >= height
  )
  if (maxPixelsReached) {
    diagnostics.summary = "Selection stopped at the maximum pixel budget."
  } else if (diagnostics.boundsTouchesCanvas) {
    diagnostics.summary = "Selection reached the canvas bounds; inspect for possible leakage."
  } else if (diagnostics.reasonCounts.edge > 0) {
    diagnostics.summary = "Selection stopped at edge contrast and rejected nearby pixels."
  } else if (diagnostics.reasonCounts.color > 0) {
    diagnostics.summary = "Selection stopped at color-distance differences."
  } else if (diagnostics.acceptedPixels === 0) {
    diagnostics.summary = "Selection found no eligible pixels at the seed."
  } else {
    diagnostics.summary = "Selection completed without obvious edge leakage."
  }
  return diagnostics
}

export function selectionDiagnosticsOverlayData(
  diagnostics: SelectionDiagnostics,
  width: number,
  height: number,
) {
  const out = new ImageData(width, height)
  const colors: Record<number, [number, number, number, number]> = {
    1: [52, 211, 153, 96],
    2: [59, 130, 246, 140],
    3: [248, 113, 113, 170],
    4: [168, 85, 247, 130],
    5: [250, 204, 21, 170],
    6: [251, 146, 60, 160],
  }
  const count = Math.min(width * height, diagnostics.reasonMap.length)
  for (let p = 0; p < count; p++) {
    const color = colors[diagnostics.reasonMap[p]]
    if (!color) continue
    const i = p * 4
    out.data[i] = color[0]
    out.data[i + 1] = color[1]
    out.data[i + 2] = color[2]
    out.data[i + 3] = color[3]
  }
  return out
}
