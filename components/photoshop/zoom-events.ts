export type CanvasZoomRequest = { zoom?: number; factor?: number }

export function requestCanvasZoom(detail: CanvasZoomRequest) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent("ps-request-zoom", { detail }))
}
