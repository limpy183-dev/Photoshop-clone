/**
 * On-canvas controls for the Blur Gallery and Lighting Effects filters.
 *
 * Both filters put draggable widgets (blur pins, light handles) on the overlay
 * canvas while their dialog is open. The dialog owns the parameters and talks
 * to this controller over `ps-*-overlay-state` / `ps-*-overlay-change` events,
 * so the canvas never imports the dialogs and vice versa.
 *
 * Blur Gallery takes precedence: while it is showing, the lighting overlay
 * neither draws nor clears the shared overlay canvas.
 */
import * as React from "react"
import { addPhotoshopEventListener, dispatchPhotoshopEvent } from "@/editor/events"
import {
  applyBlurGalleryKeyboardCommand,
  beginBlurGalleryInteraction,
  finishBlurGalleryInteraction,
  getBlurGalleryControlState,
  isBlurGalleryFilterId,
  normalizeBlurGalleryParams,
  updateBlurGalleryInteraction,
  type BlurGalleryDrag,
  type BlurGalleryFilterId,
  type BlurGalleryParams,
} from "@/editor/blur-gallery-controls"
import {
  beginLightingEffectsInteraction,
  finishLightingEffectsInteraction,
  normalizeLightingEffectsParams,
  updateLightingEffectsInteraction,
  type LightingEffectsDrag,
  type LightingEffectsParams,
} from "@/editor/lighting-effects-controls"
import {
  drawBlurGalleryOverlayCanvas,
  drawLightingEffectsOverlayCanvas,
} from "@/editor/canvas/filter-overlays"
import type { PsDocument } from "@/editor/types"

interface BlurGalleryOverlayState {
  filterId: BlurGalleryFilterId
  params: BlurGalleryParams
  docId?: string
}

interface LightingEffectsOverlayState {
  params: LightingEffectsParams
  docId?: string
}

export interface FilterOverlayControllerOptions {
  activeDoc: PsDocument | null | undefined
  overlayRef: React.RefObject<HTMLCanvasElement | null>
  visualZoomRef: React.RefObject<number>
}

export interface FilterOverlayController {
  handleBlurGalleryPointerDown: (pt: { x: number; y: number }, event: React.PointerEvent<HTMLDivElement>) => boolean
  handleBlurGalleryPointerMove: (pt: { x: number; y: number }) => boolean
  handleBlurGalleryPointerUp: () => boolean
  handleBlurGalleryKeyDown: (e: KeyboardEvent) => boolean
  handleLightingEffectsPointerDown: (pt: { x: number; y: number }, event: React.PointerEvent<HTMLDivElement>) => boolean
  handleLightingEffectsPointerMove: (pt: { x: number; y: number }) => boolean
  handleLightingEffectsPointerUp: () => boolean
}

export function useFilterOverlayController({
  activeDoc,
  overlayRef,
  visualZoomRef,
}: FilterOverlayControllerOptions): FilterOverlayController {
  const [blurGalleryOverlay, setBlurGalleryOverlay] = React.useState<BlurGalleryOverlayState | null>(null)
  const blurGalleryDragRef = React.useRef<BlurGalleryDrag | null>(null)
  const drawBlurGalleryOverlayRef = React.useRef<(state?: BlurGalleryOverlayState | null) => void>(() => {})
  const [lightingEffectsOverlay, setLightingEffectsOverlay] = React.useState<LightingEffectsOverlayState | null>(null)
  const lightingEffectsDragRef = React.useRef<LightingEffectsDrag | null>(null)
  const drawLightingEffectsOverlayRef = React.useRef<(state?: LightingEffectsOverlayState | null) => void>(() => {})

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        filterId?: string
        params?: BlurGalleryParams
        docId?: string
      } | null>).detail
      if (!detail?.filterId || !isBlurGalleryFilterId(detail.filterId) || !detail.params) {
        blurGalleryDragRef.current = null
        setBlurGalleryOverlay(null)
        const ov = overlayRef.current
        if (ov) ov.getContext("2d")?.clearRect(0, 0, ov.width, ov.height)
        return
      }
      setBlurGalleryOverlay({
        filterId: detail.filterId,
        params: normalizeBlurGalleryParams(detail.filterId, detail.params),
        docId: detail.docId,
      })
    }
    return addPhotoshopEventListener("ps-blur-gallery-overlay-state", (_detail, event) => handler(event))
  }, [overlayRef])

  React.useEffect(() => {
    drawBlurGalleryOverlayRef.current(blurGalleryOverlay)
  }, [blurGalleryOverlay, activeDoc?.id, activeDoc?.width, activeDoc?.height])

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{
        params?: LightingEffectsParams
        docId?: string
      } | null>).detail
      if (!detail?.params) {
        lightingEffectsDragRef.current = null
        setLightingEffectsOverlay(null)
        const ov = overlayRef.current
        if (ov && !blurGalleryOverlay) ov.getContext("2d")?.clearRect(0, 0, ov.width, ov.height)
        return
      }
      setLightingEffectsOverlay({
        params: normalizeLightingEffectsParams(detail.params),
        docId: detail.docId,
      })
    }
    return addPhotoshopEventListener("ps-lighting-effects-overlay-state", (_detail, event) => handler(event))
  }, [blurGalleryOverlay, overlayRef])

  React.useEffect(() => {
    if (!blurGalleryOverlay) drawLightingEffectsOverlayRef.current(lightingEffectsOverlay)
  }, [lightingEffectsOverlay, blurGalleryOverlay, activeDoc?.id, activeDoc?.width, activeDoc?.height])

  const emitBlurGalleryParams = React.useCallback((filterId: BlurGalleryFilterId, params: BlurGalleryParams) => {
    dispatchPhotoshopEvent("ps-blur-gallery-overlay-change", { filterId, params })
  }, [])

  const setBlurGalleryParams = React.useCallback((filterId: BlurGalleryFilterId, params: BlurGalleryParams) => {
    const next = {
      filterId,
      params: normalizeBlurGalleryParams(filterId, params),
      docId: activeDoc?.id,
    }
    setBlurGalleryOverlay(next)
    emitBlurGalleryParams(filterId, next.params)
  }, [activeDoc?.id, emitBlurGalleryParams])

  const emitLightingEffectsParams = React.useCallback((params: LightingEffectsParams) => {
    dispatchPhotoshopEvent("ps-lighting-effects-overlay-change", { params })
  }, [])

  const setLightingEffectsParams = React.useCallback((params: LightingEffectsParams) => {
    const next = {
      params: normalizeLightingEffectsParams(params),
      docId: activeDoc?.id,
    }
    setLightingEffectsOverlay(next)
    emitLightingEffectsParams(next.params)
  }, [activeDoc?.id, emitLightingEffectsParams])

  function filterOverlayDocument() {
    return activeDoc
      ? { id: activeDoc.id, width: activeDoc.width, height: activeDoc.height }
      : null
  }

  function drawBlurGalleryOverlay(state = blurGalleryOverlay) {
    drawBlurGalleryOverlayCanvas(overlayRef.current, filterOverlayDocument(), visualZoomRef.current, state)
  }

  function drawLightingEffectsOverlay(state = lightingEffectsOverlay) {
    drawLightingEffectsOverlayCanvas(overlayRef.current, filterOverlayDocument(), visualZoomRef.current, state)
  }

  drawBlurGalleryOverlayRef.current = drawBlurGalleryOverlay
  drawLightingEffectsOverlayRef.current = drawLightingEffectsOverlay

  function handleBlurGalleryPointerDown(pt: { x: number; y: number }, event: React.PointerEvent<HTMLDivElement>) {
    if (!activeDoc || !blurGalleryOverlay) return false
    const result = beginBlurGalleryInteraction(
      blurGalleryOverlay.filterId,
      blurGalleryOverlay.params,
      pt,
      activeDoc.width,
      activeDoc.height,
      Math.max(8, 10 / Math.max(0.25, visualZoomRef.current)),
      { multiSelect: event.shiftKey || event.metaKey || event.ctrlKey },
    )
    if (!result.drag) return false
    blurGalleryDragRef.current = result.drag
    setBlurGalleryParams(blurGalleryOverlay.filterId, result.params)
    return true
  }

  function handleBlurGalleryPointerMove(pt: { x: number; y: number }) {
    const drag = blurGalleryDragRef.current
    if (!activeDoc || !blurGalleryOverlay || !drag) return false
    const next = updateBlurGalleryInteraction(
      blurGalleryOverlay.filterId,
      blurGalleryOverlay.params,
      drag,
      pt,
      activeDoc.width,
      activeDoc.height,
    )
    setBlurGalleryParams(blurGalleryOverlay.filterId, next)
    return true
  }

  function handleBlurGalleryPointerUp() {
    if (!blurGalleryDragRef.current) return false
    const overlay = blurGalleryOverlay
    blurGalleryDragRef.current = null
    if (overlay) {
      setBlurGalleryParams(overlay.filterId, finishBlurGalleryInteraction(overlay.filterId, overlay.params))
    } else {
      drawBlurGalleryOverlay(overlay)
    }
    return true
  }

  function handleLightingEffectsPointerDown(pt: { x: number; y: number }, event: React.PointerEvent<HTMLDivElement>) {
    if (!activeDoc || !lightingEffectsOverlay || lightingEffectsOverlay.docId !== activeDoc.id) return false
    const result = beginLightingEffectsInteraction(
      lightingEffectsOverlay.params,
      pt,
      activeDoc.width,
      activeDoc.height,
      Math.max(8, 10 / Math.max(0.25, visualZoomRef.current)),
    )
    if (!result.drag) return false
    lightingEffectsDragRef.current = result.drag
    setLightingEffectsParams(result.params)
    event.preventDefault()
    return true
  }

  function handleLightingEffectsPointerMove(pt: { x: number; y: number }) {
    const drag = lightingEffectsDragRef.current
    if (!activeDoc || !lightingEffectsOverlay || lightingEffectsOverlay.docId !== activeDoc.id || !drag) return false
    const next = updateLightingEffectsInteraction(
      lightingEffectsOverlay.params,
      drag,
      pt,
      activeDoc.width,
      activeDoc.height,
    )
    setLightingEffectsParams(next)
    return true
  }

  function handleLightingEffectsPointerUp() {
    if (!lightingEffectsDragRef.current) return false
    const overlay = lightingEffectsOverlay
    lightingEffectsDragRef.current = null
    if (overlay) setLightingEffectsParams(finishLightingEffectsInteraction(overlay.params))
    return true
  }

  const handleBlurGalleryKeyDown = React.useCallback((e: KeyboardEvent) => {
    if (!activeDoc || !blurGalleryOverlay || blurGalleryOverlay.docId !== activeDoc.id) return false
    const state = getBlurGalleryControlState(blurGalleryOverlay.params)
    const hasSelection = state.selectedFieldPinIndexes.length > 0 || state.selectedPathPointIndexes.length > 0 || !!state.activeControl
    const key = e.key
    let nextParams: BlurGalleryParams | null = null

    if (key === "Delete" || key === "Backspace") {
      nextParams = applyBlurGalleryKeyboardCommand(blurGalleryOverlay.filterId, blurGalleryOverlay.params, { kind: "delete" })
    } else if (((e.metaKey || e.ctrlKey) && key.toLowerCase() === "j") || (e.altKey && key.toLowerCase() === "j")) {
      nextParams = applyBlurGalleryKeyboardCommand(blurGalleryOverlay.filterId, blurGalleryOverlay.params, { kind: "duplicate" })
    } else if (key === "Escape" && hasSelection) {
      nextParams = applyBlurGalleryKeyboardCommand(blurGalleryOverlay.filterId, blurGalleryOverlay.params, { kind: "clear-selection" })
    } else if (key === "Tab") {
      nextParams = applyBlurGalleryKeyboardCommand(blurGalleryOverlay.filterId, blurGalleryOverlay.params, {
        kind: "select-next",
        direction: e.shiftKey ? -1 : 1,
      })
    } else if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown") {
      const stepPx = e.shiftKey ? 10 : e.altKey ? 0.25 : 1
      const dxPx = key === "ArrowLeft" ? -stepPx : key === "ArrowRight" ? stepPx : 0
      const dyPx = key === "ArrowUp" ? -stepPx : key === "ArrowDown" ? stepPx : 0
      nextParams = applyBlurGalleryKeyboardCommand(blurGalleryOverlay.filterId, blurGalleryOverlay.params, {
        kind: "nudge",
        dx: (dxPx / Math.max(1, activeDoc.width)) * 100,
        dy: (dyPx / Math.max(1, activeDoc.height)) * 100,
      })
    }

    if (!nextParams) return false
    e.preventDefault()
    setBlurGalleryParams(blurGalleryOverlay.filterId, nextParams)
    return true
  }, [activeDoc, blurGalleryOverlay, setBlurGalleryParams])

  return {
    handleBlurGalleryPointerDown,
    handleBlurGalleryPointerMove,
    handleBlurGalleryPointerUp,
    handleBlurGalleryKeyDown,
    handleLightingEffectsPointerDown,
    handleLightingEffectsPointerMove,
    handleLightingEffectsPointerUp,
  }
}
