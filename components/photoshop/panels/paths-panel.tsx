"use client"

import * as React from "react"
import { useEditorSelector, useRenderSubscription, makeCanvas } from "../editor-context"
import { PenTool, Trash2, MousePointer2, CircleDot, Route } from "lucide-react"
import {
  pathToSelectionMask,
  selectionFromMask,
  selectionToPath,
} from "../tool-helpers"
import { appendPathToCanvas, applyShapeBooleanOperation, shapeToEditablePath } from "../vector-path-operations"
import { strokePathWithBrushDynamics } from "../vector-stroke-dynamics"
import type { Layer, PathProps } from "../types"

export function PathsPanel() {
  const activeDoc = useEditorSelector((editor) => editor.activeDoc)
  const activeLayer = useEditorSelector((editor) => editor.activeLayer)
  const dispatch = useEditorSelector((editor) => editor.dispatch)
  const commit = useEditorSelector((editor) => editor.commit)
  const foreground = useEditorSelector((editor) => editor.foreground)
  const brush = useEditorSelector((editor) => editor.brush)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  // Gather paths from all layers
  const paths = React.useMemo(() => {
    if (!activeDoc) return []
    return activeDoc.layers
      .filter((l) => l.path || l.vectorMask || (l.kind === "shape" && l.shape))
      .map((l) => ({
        id: l.id,
        name: l.name,
        kind: l.kind,
        hasPath: !!l.path,
        hasVectorMask: !!l.vectorMask,
        hasShape: !!(l.kind === "shape" && l.shape),
        shape: l.shape,
        path: l.path,
        vectorMask: l.vectorMask,
      }))
  }, [activeDoc])

  // Draw path thumbnail
  const drawThumb = React.useCallback(() => {
    const cv = canvasRef.current
    if (!cv || !activeDoc || !activeLayer) return
    cv.width = 252
    cv.height = 60
    const ctx = cv.getContext("2d")!
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.fillStyle = "#1a1a1a"
    ctx.fillRect(0, 0, cv.width, cv.height)

    // If active layer has a shape, draw its outline
    if (activeLayer.kind === "shape" && activeLayer.shape) {
      const s = activeLayer.shape
      const scaleX = cv.width / activeDoc.width
      const scaleY = cv.height / activeDoc.height
      ctx.save()
      ctx.scale(scaleX, scaleY)
      ctx.strokeStyle = "#aaa"
      ctx.lineWidth = 1 / Math.min(scaleX, scaleY)
      ctx.beginPath()
      appendPathToCanvas(ctx, shapeToEditablePath(s))
      ctx.stroke()
      ctx.restore()
    } else if (activeLayer.path) {
      const scaleX = cv.width / activeDoc.width
      const scaleY = cv.height / activeDoc.height
      ctx.save()
      ctx.scale(scaleX, scaleY)
      ctx.strokeStyle = "#aaa"
      ctx.lineWidth = 1 / Math.min(scaleX, scaleY)
      if (activeLayer.path.points?.length) {
        ctx.beginPath()
        appendPathToCanvas(ctx, activeLayer.path)
        ctx.stroke()
      }
      ctx.restore()
    }
  }, [activeDoc, activeLayer])

  React.useEffect(() => { drawThumb() }, [drawThumb])
  useRenderSubscription(drawThumb)

  const editablePathForLayer = (layer: Pick<Layer, "kind" | "path" | "shape" | "vectorMask">): PathProps | null => {
    if (layer.path) return layer.path
    if (layer.vectorMask) return layer.vectorMask
    if (layer.kind === "shape" && layer.shape) return shapeToEditablePath(layer.shape)
    return null
  }

  const makeSelectionFromPath = (pathLayer: typeof paths[0]) => {
    if (!activeDoc) return
    const path = editablePathForLayer(pathLayer)
    if (!path) return
    const mask = pathToSelectionMask(path, activeDoc.width, activeDoc.height, { strokeWidth: Math.max(1, brush.size) })
    dispatch({ type: "set-selection", selection: selectionFromMask(mask, "freehand") })
    setTimeout(() => commit("Make Selection from Path", []), 0)
  }

  const makePathFromSelection = () => {
    if (!activeDoc || !activeLayer || !activeDoc.selection.bounds) return
    const path = selectionToPath(activeDoc.selection, activeDoc.width, activeDoc.height, 1.1)
    if (!path) return
    dispatch({ type: "set-layer-path", id: activeLayer.id, path })
    setTimeout(() => commit("Make Work Path from Selection", [activeLayer.id]), 0)
  }

  const deletePath = (layerId: string) => {
    dispatch({ type: "set-layer-path", id: layerId, path: undefined })
    setTimeout(() => commit("Delete Path", [layerId]), 0)
  }

  const booleanShape = (operation: "unite" | "subtract" | "intersect" | "exclude") => {
    if (!activeDoc || !activeLayer?.shape) return
    const activeIndex = activeDoc.layers.findIndex((layer) => layer.id === activeLayer.id)
    const base = [...activeDoc.layers]
      .slice(0, activeIndex)
      .reverse()
      .find((layer) => layer.kind === "shape" && layer.shape)
    if (!base?.shape) return
    const shape = applyShapeBooleanOperation(base.shape, activeLayer.shape, operation)
    dispatch({
      type: "set-layer-shape",
      id: base.id,
      shape,
    })
    dispatch({ type: "remove-layer", id: activeLayer.id })
    setTimeout(() => commit(`Path ${operation}`, [base.id]), 0)
  }

  const fillPath = () => {
    if (!activeDoc || !activeLayer) return
    const path = editablePathForLayer(activeLayer)
    if (!path) return
    const ctx = activeLayer.canvas.getContext("2d")!
    const fill = makeCanvas(activeDoc.width, activeDoc.height)
    const fctx = fill.getContext("2d")!
    fctx.fillStyle = foreground
    fctx.fillRect(0, 0, fill.width, fill.height)
    fctx.globalCompositeOperation = "destination-in"
    fctx.drawImage(pathToSelectionMask(path, activeDoc.width, activeDoc.height, { strokeWidth: Math.max(1, brush.size) }), 0, 0)
    ctx.drawImage(fill, 0, 0)
    setTimeout(() => commit("Fill Path", [activeLayer.id]), 0)
  }

  const strokePath = () => {
    if (!activeDoc || !activeLayer) return
    const path = editablePathForLayer(activeLayer)
    if (!path) return
    const ctx = activeLayer.canvas.getContext("2d")!
    strokePathWithBrushDynamics(ctx, path, brush, foreground, { pressureProfile: "taper-both", samplesPerSegment: 24, seed: Date.now() % 10000 })
    setTimeout(() => commit("Stroke Path", [activeLayer.id]), 0)
  }

  return (
    <div className="p-2 text-[11px] text-[var(--ps-text)] space-y-2">
      <canvas ref={canvasRef} className="w-full border border-[var(--ps-divider)] rounded-sm block" style={{ height: 60 }} />
      <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
        {paths.length === 0 && (
          <div className="text-center text-[var(--ps-text-dim)] py-4">No paths in document</div>
        )}
        {paths.map((p) => (
          <div
            key={p.id}
            className={`flex items-center gap-2 px-2 py-1 rounded-sm cursor-pointer hover:bg-[var(--ps-tool-hover)] ${
              activeLayer?.id === p.id ? "bg-[var(--ps-tool-active)]" : ""
            }`}
            onClick={() => dispatch({ type: "set-active-layer", id: p.id })}
          >
            {p.hasShape ? (
              <CircleDot className="w-3 h-3 text-[var(--ps-text-dim)] shrink-0" />
            ) : (
              <PenTool className="w-3 h-3 text-[var(--ps-text-dim)] shrink-0" />
            )}
            <span className="truncate flex-1">{p.name}</span>
            <span className="text-[9px] text-[var(--ps-text-dim)]">
              {p.hasShape ? "Shape" : p.hasPath ? "Path" : "Vector Mask"}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1 border-t border-[var(--ps-divider)] pt-1.5">
        <button
          className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm disabled:opacity-30"
          title="Make Selection from Path"
          disabled={!activeLayer || !editablePathForLayer(activeLayer)}
          onClick={() => {
            const p = paths.find((p) => p.id === activeLayer?.id)
            if (p) makeSelectionFromPath(p)
          }}
        >
          <MousePointer2 className="w-3.5 h-3.5" />
        </button>
        <button
          className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm disabled:opacity-30"
          title="Make Work Path from Selection"
          disabled={!activeLayer || !activeDoc?.selection.bounds}
          onClick={makePathFromSelection}
        >
          <Route className="w-3.5 h-3.5" />
        </button>
        <button
          className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm disabled:opacity-30"
          title="Fill Path with Foreground Color"
          disabled={!activeLayer || !editablePathForLayer(activeLayer)}
          onClick={fillPath}
        >
          <CircleDot className="w-3.5 h-3.5" />
        </button>
        <button
          className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm disabled:opacity-30"
          title="Stroke Path with Brush"
          disabled={!activeLayer || !editablePathForLayer(activeLayer)}
          onClick={strokePath}
        >
          <PenTool className="w-3.5 h-3.5" />
        </button>
        <button
          className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm disabled:opacity-30"
          title="Delete Path"
          disabled={!activeLayer?.path}
          onClick={() => activeLayer && deletePath(activeLayer.id)}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1 border-t border-[var(--ps-divider)] pt-1.5">
        {(["unite", "subtract", "intersect", "exclude"] as const).map((operation) => (
          <button
            key={operation}
            className="h-6 rounded-sm border border-[var(--ps-divider)] px-1 text-[9px] hover:bg-[var(--ps-tool-hover)] disabled:opacity-30"
            disabled={!activeLayer?.shape}
            onClick={() => booleanShape(operation)}
            title={`Boolean ${operation} active shape with the shape below`}
          >
            {operation}
          </button>
        ))}
      </div>
    </div>
  )
}
