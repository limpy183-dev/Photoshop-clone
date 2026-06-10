"use client"

import * as React from "react"
import { makeCanvas, useEditor } from "./editor-context"
import type { AdjustmentType, ToolId } from "./types"
import {
  effectiveShortcut,
  loadCustomShortcuts,
  shortcutMatchesEvent,
  shortcutPrimaryKey,
} from "./shortcuts"
import { requestCanvasZoom } from "./zoom-events"
import {
  createAdjustmentLayer as createAdjustmentLayerModel,
  invertAdjustmentMask,
  isAdjustmentNoop,
} from "./adjustment-layers"
import { FILTERS } from "./filters"

type ToolShortcutGroup = {
  shortcutId: string
  tools: ToolId[]
}

const TOOL_SHORTCUT_GROUPS: ToolShortcutGroup[] = [
  { shortcutId: "tool-move", tools: ["move", "artboard"] },
  { shortcutId: "tool-marquee", tools: ["marquee-rect", "marquee-ellipse", "marquee-row", "marquee-col"] },
  { shortcutId: "tool-lasso", tools: ["lasso", "lasso-polygon", "lasso-magnetic"] },
  {
    shortcutId: "tool-wand",
    tools: ["object-select", "quick-selection", "magic-wand", "refine-edge-brush", "select-subject", "select-sky", "select-background"],
  },
  { shortcutId: "tool-crop", tools: ["crop", "perspective-crop", "slice", "slice-select", "frame"] },
  {
    shortcutId: "tool-eyedropper",
    tools: ["eyedropper", "color-sampler", "ruler", "note", "count", "material-eyedropper", "material-drop"],
  },
  {
    shortcutId: "tool-heal",
    tools: ["spot-healing", "red-eye", "healing-brush", "patch-tool", "content-aware-move", "remove-tool"],
  },
  { shortcutId: "tool-brush", tools: ["brush", "pencil", "mixer-brush", "color-replace"] },
  { shortcutId: "tool-stamp", tools: ["clone-stamp", "pattern-stamp"] },
  { shortcutId: "tool-eraser", tools: ["eraser", "background-eraser", "magic-eraser"] },
  { shortcutId: "tool-gradient", tools: ["gradient", "paint-bucket"] },
  { shortcutId: "tool-blur", tools: ["blur", "sharpen", "smudge"] },
  { shortcutId: "tool-dodge", tools: ["dodge", "burn", "sponge"] },
  { shortcutId: "tool-pen", tools: ["pen", "freeform-pen", "curvature-pen", "add-anchor-point", "delete-anchor-point", "convert-point"] },
  { shortcutId: "tool-text", tools: ["type", "type-vertical", "type-mask-horizontal", "type-mask-vertical"] },
  { shortcutId: "tool-shape", tools: ["shape-rect", "shape-rounded-rect", "shape-ellipse", "shape-polygon", "shape-triangle", "shape-line", "custom-shape"] },
  { shortcutId: "tool-hand", tools: ["hand"] },
  { shortcutId: "tool-rotate-view", tools: ["rotate-view"] },
  { shortcutId: "tool-zoom", tools: ["zoom"] },
  { shortcutId: "tool-transform", tools: ["transform"] },
]

const CUSTOM_TOOL_SHORTCUT_MAP: Record<string, ToolId> = {
  "tool-mixer-brush": "mixer-brush",
  "tool-pattern-stamp": "pattern-stamp",
  "tool-art-history": "art-history-brush",
  "tool-pencil": "pencil",
  "tool-slice": "slice",
}

function toolKeyMatches(event: KeyboardEvent, keys: string) {
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  const key = shortcutPrimaryKey(keys)
  if (!key) return false
  const eventKey = event.key.toLowerCase()
  return eventKey === key || (eventKey === "=" && key === "+") || (eventKey === "+" && key === "=")
}

export function useShortcuts(onOpenNew: () => void, onOpenCommandPalette?: () => void) {
  const {
    dispatch,
    activeDoc,
    activeLayer,
    brush,
    tool,
    newLayer,
    newGroup,
    toggleQuickMask,
    commit,
    foreground,
    background,
    jumpHistory,
    stepHistoryBy,
    copySelection,
    pasteAsLayer,
    requestCloseDocument,
    requestRender,
  } = useEditor()

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Pressing and releasing Alt on its own makes Chrome focus its menu
      // (the hamburger / 3-dots) and Firefox focus its menu bar. Suppress
      // that browser default so Alt only ever acts as an editor modifier.
      // This does not affect `altKey` on other key/pointer events, nor the
      // Alt keyup, so temporary-modifier behavior keeps working.
      if (e.key === "Alt") {
        e.preventDefault()
        return
      }

      const target = e.target as HTMLElement
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        // Allow command shortcuts in inputs, but preserve normal text entry.
        if (!(e.metaKey || e.ctrlKey)) return
      }

      const overrides = loadCustomShortcuts()
      const isShortcut = (id: string) => shortcutMatchesEvent(effectiveShortcut(id, overrides), e)
      const meta = e.metaKey || e.ctrlKey
      const addAdjustmentLayer = (filterId: AdjustmentType) => {
        if (!activeDoc) return
        const filter = FILTERS[filterId]
        if (!filter) return
        const layer = createAdjustmentLayerModel({
          filterId,
          width: activeDoc.width,
          height: activeDoc.height,
          layers: activeDoc.layers,
          makeCanvas,
        })
        dispatch({ type: "add-layer", layer })
        if (!isAdjustmentNoop(layer.adjustment)) requestRender()
        window.setTimeout(() => commit(`New ${filter.name} Adjustment`, [layer.id]), 0)
      }

      const invertActiveAdjustmentMask = () => {
        if (!activeDoc || !activeLayer || activeLayer.kind !== "adjustment") return false
        const mask = invertAdjustmentMask({
          layer: activeLayer,
          width: activeDoc.width,
          height: activeDoc.height,
          makeCanvas,
        })
        dispatch({ type: "set-layer-mask", id: activeLayer.id, mask })
        requestRender()
        window.setTimeout(() => commit("Invert Adjustment Mask", [activeLayer.id]), 0)
        return true
      }

      if (isShortcut("command-palette")) {
        e.preventDefault()
        onOpenCommandPalette?.()
        return
      }

      if (isShortcut("timeline-split-frame")) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent("ps-timeline-split-at-playhead"))
        return
      }

      if (isShortcut("file-new")) {
        e.preventDefault()
        onOpenNew()
        return
      }
      if (isShortcut("file-save")) {
        e.preventDefault()
        if (activeDoc) window.dispatchEvent(new CustomEvent("ps-save-document", { detail: { mode: "save" } }))
        return
      }
      if (isShortcut("file-saveas")) {
        e.preventDefault()
        if (activeDoc) window.dispatchEvent(new CustomEvent("ps-save-document", { detail: { mode: "save-as" } }))
        return
      }
      if (isShortcut("file-close")) {
        e.preventDefault()
        if (activeDoc) requestCloseDocument(activeDoc.id)
        return
      }
      if (isShortcut("file-print")) {
        e.preventDefault()
        if (activeDoc) window.print()
        return
      }

      if (isShortcut("edit-redo")) {
        e.preventDefault()
        // stepHistoryBy reads bounds from stateRef so it stays correct even
        // when the most recent push-history's React render is still queued
        // (deferred via startTransition). Using `historyIndex` from the
        // hook closure here would risk a stale read where the user just
        // painted a stroke that's already in the reducer state but not yet
        // visible in the rendered context value.
        if (!e.repeat) stepHistoryBy(1)
        return
      }

      if (isShortcut("edit-undo") || isShortcut("edit-stepback")) {
        e.preventDefault()
        if (!e.repeat) stepHistoryBy(-1)
        return
      }

      if (isShortcut("edit-copy")) {
        e.preventDefault()
        copySelection(false)
        return
      }
      if (isShortcut("edit-cut")) {
        e.preventDefault()
        copySelection(true)
        return
      }
      if (isShortcut("edit-paste")) {
        e.preventDefault()
        pasteAsLayer()
        return
      }
      if (isShortcut("edit-transform")) {
        e.preventDefault()
        if (activeLayer) window.dispatchEvent(new CustomEvent("ps-free-transform"))
        return
      }

      if (isShortcut("img-levels")) {
        e.preventDefault()
        addAdjustmentLayer("levels")
        return
      }
      if (isShortcut("img-curves")) {
        e.preventDefault()
        addAdjustmentLayer("curves")
        return
      }
      if (isShortcut("img-huesat")) {
        e.preventDefault()
        addAdjustmentLayer("hue-saturation")
        return
      }
      if (isShortcut("img-colorbal")) {
        e.preventDefault()
        addAdjustmentLayer("color-balance")
        return
      }
      if (isShortcut("img-invert")) {
        e.preventDefault()
        if (!invertActiveAdjustmentMask()) addAdjustmentLayer("invert")
        return
      }
      if (isShortcut("img-imgsize")) {
        e.preventDefault()
        if (activeDoc) window.dispatchEvent(new CustomEvent("ps-open-image-size"))
        return
      }
      if (isShortcut("img-canvassize")) {
        e.preventDefault()
        if (activeDoc) window.dispatchEvent(new CustomEvent("ps-open-canvas-size"))
        return
      }

      if (isShortcut("sel-all")) {
        if (!activeDoc) return
        e.preventDefault()
        dispatch({
          type: "set-selection",
          selection: {
            bounds: { x: 0, y: 0, w: activeDoc.width, h: activeDoc.height },
            shape: "rect",
          },
        })
        return
      }
      if (isShortcut("sel-deselect")) {
        e.preventDefault()
        dispatch({ type: "set-selection", selection: { bounds: null, shape: "rect" } })
        return
      }
      if (isShortcut("sel-reselect")) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent("ps-reselect"))
        return
      }

      if (isShortcut("layer-dup")) {
        e.preventDefault()
        if (activeLayer) dispatch({ type: "duplicate-layer", id: activeLayer.id })
        return
      }
      if (isShortcut("layer-merge")) {
        e.preventDefault()
        if (activeLayer) dispatch({ type: "merge-down", id: activeLayer.id })
        return
      }
      if (isShortcut("layer-new")) {
        e.preventDefault()
        newLayer()
        return
      }
      if (isShortcut("layer-group")) {
        e.preventDefault()
        newGroup()
        return
      }
      if (isShortcut("sel-inverse")) {
        if (!activeDoc?.selection.bounds) return
        e.preventDefault()
        const sel = activeDoc.selection
        const c = document.createElement("canvas")
        c.width = activeDoc.width
        c.height = activeDoc.height
        const ictx = c.getContext("2d")!
        ictx.fillStyle = "#fff"
        ictx.fillRect(0, 0, activeDoc.width, activeDoc.height)
        ictx.globalCompositeOperation = "destination-out"
        if (sel.mask) {
          ictx.drawImage(sel.mask, 0, 0)
        } else if (sel.bounds) {
          if (sel.shape === "ellipse") {
            ictx.beginPath()
            ictx.ellipse(
              sel.bounds.x + sel.bounds.w / 2,
              sel.bounds.y + sel.bounds.h / 2,
              sel.bounds.w / 2,
              sel.bounds.h / 2,
              0,
              0,
              Math.PI * 2,
            )
            ictx.fill()
          } else {
            ictx.fillRect(sel.bounds.x, sel.bounds.y, sel.bounds.w, sel.bounds.h)
          }
        }
        dispatch({
          type: "set-selection",
          selection: {
            bounds: { x: 0, y: 0, w: activeDoc.width, h: activeDoc.height },
            shape: "freehand",
            mask: c,
          },
        })
        return
      }

      if (isShortcut("view-quickmask")) {
        e.preventDefault()
        toggleQuickMask()
        return
      }

      if (isShortcut("view-zoomin")) {
        e.preventDefault()
        if (activeDoc) requestCanvasZoom({ factor: 1.25 })
        return
      }
      if (isShortcut("view-zoomout")) {
        e.preventDefault()
        if (activeDoc) requestCanvasZoom({ factor: 1 / 1.25 })
        return
      }
      if (isShortcut("view-fit") || isShortcut("view-100")) {
        e.preventDefault()
        requestCanvasZoom({ zoom: 1 })
        return
      }
      if (isShortcut("view-grid")) {
        e.preventDefault()
        if (activeDoc) dispatch({ type: "toggle-grid" })
        return
      }

      if (isShortcut("brush-smaller")) {
        e.preventDefault()
        dispatch({ type: "set-brush", brush: { size: Math.max(1, brush.size - 5) } })
        return
      }
      if (isShortcut("brush-larger")) {
        e.preventDefault()
        dispatch({ type: "set-brush", brush: { size: Math.min(500, brush.size + 5) } })
        return
      }
      if (isShortcut("brush-softer")) {
        e.preventDefault()
        dispatch({ type: "set-brush", brush: { hardness: Math.max(0, brush.hardness - 5) } })
        return
      }
      if (isShortcut("brush-harder")) {
        e.preventDefault()
        dispatch({ type: "set-brush", brush: { hardness: Math.min(100, brush.hardness + 5) } })
        return
      }

      if (isShortcut("color-swap")) {
        e.preventDefault()
        dispatch({ type: "swap-colors" })
        return
      }
      if (isShortcut("color-default")) {
        e.preventDefault()
        dispatch({ type: "reset-colors" })
        return
      }

      if (!meta && !e.altKey && !e.shiftKey && /^[0-9]$/.test(e.key)) {
        e.preventDefault()
        const opacity = e.key === "0" ? 100 : Number(e.key) * 10
        dispatch({ type: "set-brush", brush: { opacity } })
        return
      }

      if (e.key === "Backspace" && !meta) {
        e.preventDefault()
        if (activeDoc && activeLayer && !activeLayer.locked) {
          const ctx = activeLayer.canvas.getContext("2d")!
          if (e.altKey) {
            ctx.fillStyle = foreground
            ctx.fillRect(0, 0, activeDoc.width, activeDoc.height)
            commit("Fill with Foreground", [activeLayer.id])
          } else if (e.shiftKey) {
            ctx.fillStyle = background
            ctx.fillRect(0, 0, activeDoc.width, activeDoc.height)
            commit("Fill with Background", [activeLayer.id])
          } else {
            ctx.clearRect(0, 0, activeDoc.width, activeDoc.height)
            commit("Clear", [activeLayer.id])
          }
        }
        return
      }

      if (!meta && !e.altKey) {
        for (const [shortcutId, toolId] of Object.entries(CUSTOM_TOOL_SHORTCUT_MAP)) {
          const customKeys = overrides[shortcutId]
          if (!customKeys || !shortcutMatchesEvent(customKeys, e)) continue
          e.preventDefault()
          dispatch({ type: "set-tool", tool: toolId })
          return
        }

        for (const group of TOOL_SHORTCUT_GROUPS) {
          const keys = effectiveShortcut(group.shortcutId, overrides)
          if (!toolKeyMatches(e, keys)) continue
          e.preventDefault()
          const currentIndex = group.tools.indexOf(tool)
          const nextTool =
            e.shiftKey && group.tools.length > 1
              ? group.tools[(currentIndex >= 0 ? currentIndex + 1 : 1) % group.tools.length]
              : group.tools[0]
          dispatch({ type: "set-tool", tool: nextTool })
          return
        }
      }
    }

    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [
    dispatch,
    activeDoc,
    activeLayer,
    brush,
    tool,
    newLayer,
    newGroup,
    toggleQuickMask,
    commit,
    onOpenNew,
    onOpenCommandPalette,
    foreground,
    background,
    jumpHistory,
    stepHistoryBy,
    copySelection,
    pasteAsLayer,
    requestCloseDocument,
    requestRender,
  ])
  // Note: `history` and `historyIndex` are intentionally NOT in this
  // dependency array. The Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z handlers call
  // `stepHistoryBy`, which reads bounds from a stable internal ref. If
  // we depended on `history`/`historyIndex` here the listener would be
  // torn down and re-registered on every undo/redo, dropping rapid
  // keystrokes during repeated undo bursts.
}
