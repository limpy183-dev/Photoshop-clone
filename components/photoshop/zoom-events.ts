import { dispatchPhotoshopEvent } from "./events"

export type CanvasZoomRequest = { zoom?: number; factor?: number }

export function requestCanvasZoom(detail: CanvasZoomRequest) {
  dispatchPhotoshopEvent("ps-request-zoom", detail)
}

export function requestPrintSizeView() {
  dispatchPhotoshopEvent("ps-request-print-size-view")
}
