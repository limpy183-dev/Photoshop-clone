import * as React from "react"

import { addPhotoshopEventListener } from "./events"
import { calculatePrintSizeZoom } from "./preferences-engine"
import { clampZoom, type CanvasRuntimePreferences } from "./canvas-view-runtime"
import type { PsDocument } from "./types"

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
  activeDoc: Pick<PsDocument, "zoom" | "rotation" | "dpi"> | null | undefined
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
  applyViewZoom: (zoom: number) => void
  onWheel: (event: React.WheelEvent<HTMLDivElement>) => void
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

  const applyViewZoom = React.useCallback(
    (zoom: number) => {
      const next = clampZoom(zoom)
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
    [applyZoomStyles, onCommitZoom],
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

  const onWheel = React.useCallback((event: React.WheelEvent<HTMLDivElement>) => {
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
      applyViewZoom(change.zoom)
    } else {
      panRef.current = change.pan
      applyStageTransform()
    }
  }, [activeDoc, applyStageTransform, applyViewZoom])

  return {
    panRef,
    viewZoom,
    visualZoomRef,
    applyStageTransform,
    applyViewZoom,
    onWheel,
  }
}
