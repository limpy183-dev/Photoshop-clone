import * as React from "react"

import { addPhotoshopEventListener } from "@/editor/events"
import { calculatePrintSizeZoom } from "@/editor/preferences-engine"
import { clampZoom, type CanvasRuntimePreferences } from "@/editor/canvas/view-runtime"
import type { PsDocument } from "@/editor/types"

export const ZOOM_COMMIT_IDLE_MS = 420

export interface ViewportPan {
  x: number
  y: number
}

export interface WheelViewportInput {
  deltaX: number
  deltaY: number
  modifierPressed: boolean
  currentZoom: number
  pan: ViewportPan
}

export type WheelViewportChange =
  | { kind: "zoom"; zoom: number }
  | { kind: "pan"; pan: ViewportPan }

export function composeStageTransform(pan: ViewportPan, rotation = 0, transientScale = 1) {
  const scale = Math.abs(transientScale - 1) > 0.0001 ? ` scale(${transientScale})` : ""
  return `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg)${scale}`
}

export function imageRenderingForZoom(zoom: number): "pixelated" | "auto" {
  return zoom >= 4 ? "pixelated" : "auto"
}

/**
 * Pan offset that keeps the document point `anchor` under the same screen pixel
 * across a zoom change.
 *
 * The stage is transformed as `translate(pan) rotate(r) scale(s)` about its own
 * centre, so a document point lands at `stageCentre + pan + R(r)·(zoom·(p−c))`.
 * The layout size cancels out, leaving the pan correction below — which is why
 * this works identically during the transient scale and after the zoom commits
 * to a new layout size.
 */
export function zoomAnchoredPan(
  pan: ViewportPan,
  anchor: { x: number; y: number },
  center: { x: number; y: number },
  fromZoom: number,
  toZoom: number,
  rotationDeg = 0,
): ViewportPan {
  const dz = fromZoom - toZoom
  const dx = (anchor.x - center.x) * dz
  const dy = (anchor.y - center.y) * dz
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: pan.x + dx * cos - dy * sin, y: pan.y + dx * sin + dy * cos }
}

export function wheelViewportChange(input: WheelViewportInput): WheelViewportChange {
  if (input.modifierPressed) {
    return {
      kind: "zoom",
      zoom: clampZoom(input.currentZoom * Math.exp(-input.deltaY * 0.0015)),
    }
  }
  return {
    kind: "pan",
    pan: {
      x: input.pan.x - input.deltaX,
      y: input.pan.y - input.deltaY,
    },
  }
}

export interface CanvasViewportControllerOptions {
  activeDoc: Pick<PsDocument, "zoom" | "rotation" | "dpi" | "width" | "height"> | null | undefined
  canvasPrefs: Pick<CanvasRuntimePreferences, "screenDpi" | "printResolution">
  compositeRef: React.RefObject<HTMLCanvasElement | null>
  overlayRef: React.RefObject<HTMLCanvasElement | null>
  stageRef: React.RefObject<HTMLDivElement | null>
  onCommitZoom: (zoom: number) => void
}

export interface CanvasViewportController {
  panRef: React.RefObject<ViewportPan>
  viewZoom: number
  visualZoomRef: React.RefObject<number>
  applyStageTransform: (transientScale?: number) => void
  /** `anchor` is a document point to hold still; omitted zooms about the centre. */
  applyViewZoom: (zoom: number, anchor?: { x: number; y: number } | null) => void
  /** Document point under a client coordinate, or null if it misses the canvas. */
  docPointFromClient: (clientX: number, clientY: number) => { x: number; y: number } | null
  onWheel: (event: WheelEvent) => void
}

export function useCanvasViewportController({
  activeDoc,
  canvasPrefs,
  compositeRef,
  overlayRef,
  stageRef,
  onCommitZoom,
}: CanvasViewportControllerOptions): CanvasViewportController {
  const panRef = React.useRef<ViewportPan>({ x: 0, y: 0 })
  const [viewZoom, setViewZoom] = React.useState(activeDoc?.zoom ?? 1)
  const layoutZoomRef = React.useRef(activeDoc?.zoom ?? 1)
  const visualZoomRef = React.useRef(activeDoc?.zoom ?? 1)
  const pendingZoomRef = React.useRef<number | null>(null)
  const zoomFrameRef = React.useRef<number | null>(null)
  const zoomCommitTimerRef = React.useRef<number | null>(null)

  const applyStageTransform = React.useCallback((transientScale = 1) => {
    const stage = stageRef.current
    if (!stage) return
    stage.style.transform = composeStageTransform(panRef.current, activeDoc?.rotation ?? 0, transientScale)
  }, [activeDoc?.rotation, stageRef])

  const applyZoomStyles = React.useCallback(
    (zoom: number, transient = true) => {
      if (!activeDoc) return
      const scale = transient ? zoom / Math.max(0.0001, layoutZoomRef.current) : 1
      applyStageTransform(scale)
      const imageRendering = imageRenderingForZoom(zoom)
      if (compositeRef.current) compositeRef.current.style.imageRendering = imageRendering
      if (overlayRef.current) overlayRef.current.style.imageRendering = imageRendering
    },
    [activeDoc, applyStageTransform, compositeRef, overlayRef],
  )

  /**
   * Anchoring is skipped while the view is rotated: `getBoundingClientRect`
   * reports the axis-aligned box of a rotated element, so the mapping below
   * would place the anchor wrong. Centre-zoom is the safe fallback there.
   */
  const docPointFromClient = React.useCallback(
    (clientX: number, clientY: number) => {
      const cv = compositeRef.current
      if (!cv || !activeDoc || (activeDoc.rotation ?? 0) !== 0) return null
      const rect = cv.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      const u = (clientX - rect.left) / rect.width
      const v = (clientY - rect.top) / rect.height
      if (u < 0 || u > 1 || v < 0 || v > 1) return null
      return { x: u * activeDoc.width, y: v * activeDoc.height }
    },
    [activeDoc, compositeRef],
  )

  const applyViewZoom = React.useCallback(
    (zoom: number, anchor?: { x: number; y: number } | null) => {
      const next = clampZoom(zoom)
      if (anchor && activeDoc) {
        panRef.current = zoomAnchoredPan(
          panRef.current,
          anchor,
          { x: activeDoc.width / 2, y: activeDoc.height / 2 },
          visualZoomRef.current,
          next,
          activeDoc.rotation ?? 0,
        )
      }
      visualZoomRef.current = next
      pendingZoomRef.current = next

      if (zoomFrameRef.current === null) {
        zoomFrameRef.current = window.requestAnimationFrame(() => {
          zoomFrameRef.current = null
          const pending = pendingZoomRef.current
          if (pending !== null) {
            pendingZoomRef.current = null
            applyZoomStyles(pending)
          }
        })
      }

      if (zoomCommitTimerRef.current !== null) {
        window.clearTimeout(zoomCommitTimerRef.current)
      }
      zoomCommitTimerRef.current = window.setTimeout(() => {
        zoomCommitTimerRef.current = null
        const committedZoom = visualZoomRef.current
        setViewZoom(committedZoom)
        onCommitZoom(committedZoom)
      }, ZOOM_COMMIT_IDLE_MS)
    },
    [activeDoc, applyZoomStyles, onCommitZoom],
  )

  React.useEffect(() => {
    return () => {
      if (zoomFrameRef.current !== null) window.cancelAnimationFrame(zoomFrameRef.current)
      if (zoomCommitTimerRef.current !== null) window.clearTimeout(zoomCommitTimerRef.current)
    }
  }, [])

  React.useEffect(() => {
    if (!activeDoc) return
    const next = clampZoom(activeDoc.zoom)
    visualZoomRef.current = next
    pendingZoomRef.current = null
    setViewZoom(next)
    window.requestAnimationFrame(() => applyZoomStyles(next, false))
  }, [activeDoc, applyZoomStyles])

  React.useLayoutEffect(() => {
    layoutZoomRef.current = viewZoom
    applyZoomStyles(viewZoom, false)
  }, [viewZoom, applyZoomStyles])

  React.useEffect(() => {
    return addPhotoshopEventListener("ps-request-zoom", (detail) => {
      if (!detail) return
      if (typeof detail.zoom === "number") {
        applyViewZoom(detail.zoom)
      } else if (typeof detail.factor === "number") {
        applyViewZoom(visualZoomRef.current * detail.factor)
      }
    })
  }, [applyViewZoom])

  React.useEffect(() => {
    return addPhotoshopEventListener("ps-request-print-size-view", () => {
      if (!activeDoc) return
      try {
        applyViewZoom(calculatePrintSizeZoom({
          screenDpi: canvasPrefs.screenDpi,
          documentDpi: activeDoc.dpi ?? canvasPrefs.printResolution,
        }))
      } catch {}
    })
  }, [activeDoc, applyViewZoom, canvasPrefs.printResolution, canvasPrefs.screenDpi])

  const onWheel = React.useCallback((event: WheelEvent) => {
    if (!activeDoc) return
    const change = wheelViewportChange({
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      modifierPressed: event.ctrlKey || event.metaKey || event.altKey,
      currentZoom: visualZoomRef.current,
      pan: panRef.current,
    })
    if (change.kind === "zoom") {
      event.preventDefault()
      // Zoom toward the pointer when it is over the image; off-canvas (or
      // rotated) falls back to zooming about the centre.
      applyViewZoom(change.zoom, docPointFromClient(event.clientX, event.clientY))
    } else {
      panRef.current = change.pan
      applyStageTransform()
    }
  }, [activeDoc, applyStageTransform, applyViewZoom, docPointFromClient])

  return {
    panRef,
    viewZoom,
    visualZoomRef,
    applyStageTransform,
    applyViewZoom,
    docPointFromClient,
    onWheel,
  }
}
