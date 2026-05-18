"use client"

import * as React from "react"
import { useEditor, useRenderSubscription, makeCanvas } from "../editor-context"
import { PenTool, Trash2, MousePointer2, CircleDot } from "lucide-react"
import { rasterizeShape } from "../tool-helpers"

export function PathsPanel() {
  const { activeDoc, activeLayer, dispatch, commit, foreground, brush } = useEditor()
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
      if (s.type === "ellipse") {
        ctx.beginPath()
        ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2, 0, 0, Math.PI * 2)
        ctx.stroke()
      } else {
        ctx.strokeRect(s.x, s.y, s.w, s.h)
      }
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
        activeLayer.path.points.forEach((p: { x: number; y: number }, i: number) => {
          if (i === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        })
        if (activeLayer.path.closed) ctx.closePath()
        ctx.stroke()
      }
      ctx.restore()
    }
  }, [activeDoc, activeLayer])

  React.useEffect(() => { drawThumb() }, [drawThumb])
  useRenderSubscription(drawThumb)

  const makeSelectionFromPath = (pathLayer: typeof paths[0]) => {
    if (!activeDoc) return
    const shape = pathLayer.shape
    if (!shape) return
    if (shape.type === "ellipse") {
      dispatch({
        type: "set-selection",
        selection: {
          bounds: { x: shape.x, y: shape.y, w: shape.w, h: shape.h },
          shape: "ellipse",
        },
      })
    } else {
      dispatch({
        type: "set-selection",
        selection: {
          bounds: { x: shape.x, y: shape.y, w: shape.w, h: shape.h },
          shape: "rect",
        },
      })
    }
  }

  const deletePath = (layerId: string) => {
    dispatch({ type: "set-layer-path", id: layerId, path: undefined as unknown as import("../types").PathProps })
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
    const result = makeCanvas(activeDoc.width, activeDoc.height)
    const ctx = result.getContext("2d")!
    const baseCanvas = makeCanvas(activeDoc.width, activeDoc.height)
    rasterizeShape(baseCanvas, base.shape)
    const activeCanvas = makeCanvas(activeDoc.width, activeDoc.height)
    rasterizeShape(activeCanvas, activeLayer.shape)
    ctx.drawImage(baseCanvas, 0, 0)
    ctx.globalCompositeOperation =
      operation === "subtract"
        ? "destination-out"
        : operation === "intersect"
          ? "source-in"
          : operation === "exclude"
            ? "xor"
            : "source-over"
    ctx.drawImage(activeCanvas, 0, 0)
    dispatch({
      type: "set-layer-shape",
      id: base.id,
      shape: {
        ...base.shape,
        booleanOperation: operation,
      },
    })
    const baseCtx = base.canvas.getContext("2d")
    if (baseCtx) {
      baseCtx.clearRect(0, 0, base.canvas.width, base.canvas.height)
      baseCtx.drawImage(result, 0, 0)
    }
    dispatch({ type: "remove-layer", id: activeLayer.id })
    setTimeout(() => commit(`Path ${operation}`, [base.id]), 0)
  }

  const fillPath = () => {
    if (!activeDoc || !activeLayer) return
    const ctx = activeLayer.canvas.getContext("2d")!
    const _pathData = activeLayer.path ?? (activeLayer.kind === "shape" && activeLayer.shape ? null : null)
    if (activeLayer.kind === "shape" && activeLayer.shape) {
      const s = activeLayer.shape
      ctx.fillStyle = foreground
      ctx.beginPath()
      if (s.type === "ellipse") ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2, 0, 0, Math.PI * 2)
      else ctx.rect(s.x, s.y, s.w, s.h)
      ctx.fill()
    } else if (activeLayer.path?.points?.length) {
      ctx.fillStyle = foreground
      ctx.beginPath()
      activeLayer.path.points.forEach((p: { x: number; y: number }, i: number) => {
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      })
      if (activeLayer.path.closed) ctx.closePath()
      ctx.fill()
    }
    setTimeout(() => commit("Fill Path", [activeLayer.id]), 0)
  }

  const strokePath = () => {
    if (!activeDoc || !activeLayer) return
    const ctx = activeLayer.canvas.getContext("2d")!
    ctx.strokeStyle = foreground
    ctx.lineWidth = brush.size
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    if (activeLayer.kind === "shape" && activeLayer.shape) {
      const s = activeLayer.shape
      ctx.beginPath()
      if (s.type === "ellipse") ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2, 0, 0, Math.PI * 2)
      else ctx.rect(s.x, s.y, s.w, s.h)
      ctx.stroke()
    } else if (activeLayer.path?.points?.length) {
      ctx.beginPath()
      activeLayer.path.points.forEach((p: { x: number; y: number }, i: number) => {
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      })
      if (activeLayer.path.closed) ctx.closePath()
      ctx.stroke()
    }
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
          disabled={!activeLayer || !(activeLayer.kind === "shape" && activeLayer.shape)}
          onClick={() => {
            const p = paths.find((p) => p.id === activeLayer?.id)
            if (p) makeSelectionFromPath(p)
          }}
        >
          <MousePointer2 className="w-3.5 h-3.5" />
        </button>
        <button
          className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm disabled:opacity-30"
          title="Fill Path with Foreground Color"
          disabled={!activeLayer || !(activeLayer.path || (activeLayer.kind === "shape" && activeLayer.shape))}
          onClick={fillPath}
        >
          <CircleDot className="w-3.5 h-3.5" />
        </button>
        <button
          className="p-1 hover:bg-[var(--ps-tool-hover)] rounded-sm disabled:opacity-30"
          title="Stroke Path with Brush"
          disabled={!activeLayer || !(activeLayer.path || (activeLayer.kind === "shape" && activeLayer.shape))}
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
