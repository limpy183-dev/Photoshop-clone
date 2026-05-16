"use client"

import * as React from "react"

/**
 * Interactive Curves Editor — a canvas-based LUT graph with draggable control
 * points and cubic spline interpolation, matching Photoshop's Curves dialog.
 *
 * Props:
 * - channel: which channel to edit ("rgb" | "red" | "green" | "blue")
 * - points: array of {x,y} control points in 0..255 space
 * - onPointsChange: callback when points are modified
 * - histogram: optional Uint32Array[256] for background histogram bars
 * - width/height: canvas pixel dimensions (default 256x256)
 */

interface Point {
  x: number
  y: number
}

type Channel = "rgb" | "red" | "green" | "blue"

const CHANNEL_COLORS: Record<Channel, string> = {
  rgb: "#cccccc",
  red: "#ff4444",
  green: "#44ff44",
  blue: "#4488ff",
}

interface CurvesEditorProps {
  channel?: Channel
  points: Point[]
  onPointsChange: (pts: Point[]) => void
  histogram?: Uint32Array | number[]
  width?: number
  height?: number
}

/** Monotone cubic spline interpolation (Fritsch-Carlson) */
function buildSplineLUT(points: Point[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256)
  if (points.length < 2) {
    for (let i = 0; i < 256; i++) lut[i] = i
    return lut
  }

  const sorted = [...points].sort((a, b) => a.x - b.x)
  const n = sorted.length

  // Compute tangents using finite differences
  const dx: number[] = []
  const dy: number[] = []
  const m: number[] = new Array(n).fill(0)
  for (let i = 0; i < n - 1; i++) {
    dx.push(sorted[i + 1].x - sorted[i].x)
    dy.push(sorted[i + 1].y - sorted[i].y)
  }
  const slopes: number[] = dx.map((d, i) => (d === 0 ? 0 : dy[i] / d))

  // Initialize tangents
  if (n === 2) {
    m[0] = slopes[0]
    m[1] = slopes[0]
  } else {
    m[0] = slopes[0]
    m[n - 1] = slopes[n - 2]
    for (let i = 1; i < n - 1; i++) {
      m[i] = (slopes[i - 1] + slopes[i]) / 2
    }
    // Ensure monotonicity
    for (let i = 0; i < n - 1; i++) {
      if (slopes[i] === 0) {
        m[i] = 0
        m[i + 1] = 0
      } else {
        const alpha = m[i] / slopes[i]
        const beta = m[i + 1] / slopes[i]
        const h = Math.hypot(alpha, beta)
        if (h > 3) {
          const tau = 3 / h
          m[i] = tau * alpha * slopes[i]
          m[i + 1] = tau * beta * slopes[i]
        }
      }
    }
  }

  // Interpolate
  for (let xVal = 0; xVal < 256; xVal++) {
    if (xVal <= sorted[0].x) {
      lut[xVal] = Math.round(Math.max(0, Math.min(255, sorted[0].y)))
      continue
    }
    if (xVal >= sorted[n - 1].x) {
      lut[xVal] = Math.round(Math.max(0, Math.min(255, sorted[n - 1].y)))
      continue
    }
    // Find segment
    let seg = 0
    for (let i = 0; i < n - 1; i++) {
      if (xVal >= sorted[i].x && xVal <= sorted[i + 1].x) {
        seg = i
        break
      }
    }
    const h = dx[seg] || 1
    const t = (xVal - sorted[seg].x) / h
    const t2 = t * t
    const t3 = t2 * t
    const h00 = 2 * t3 - 3 * t2 + 1
    const h10 = t3 - 2 * t2 + t
    const h01 = -2 * t3 + 3 * t2
    const h11 = t3 - t2
    const yVal = h00 * sorted[seg].y + h10 * h * m[seg] + h01 * sorted[seg + 1].y + h11 * h * m[seg + 1]
    lut[xVal] = Math.round(Math.max(0, Math.min(255, yVal)))
  }

  return lut
}

export function CurvesEditor({
  channel = "rgb",
  points,
  onPointsChange,
  histogram,
  width = 256,
  height = 256,
}: CurvesEditorProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [dragIdx, setDragIdx] = React.useState(-1)
  const pad = 8

  const toCanvasX = (v: number) => pad + (v / 255) * (width - 2 * pad)
  const toCanvasY = (v: number) => height - pad - (v / 255) * (height - 2 * pad)
  const fromCanvasX = (cx: number) => Math.round(Math.max(0, Math.min(255, ((cx - pad) / (width - 2 * pad)) * 255)))
  const fromCanvasY = (cy: number) => Math.round(Math.max(0, Math.min(255, ((height - pad - cy) / (height - 2 * pad)) * 255)))

  // Draw the editor
  React.useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext("2d")!
    ctx.clearRect(0, 0, width, height)

    // Background
    ctx.fillStyle = "#1a1a1a"
    ctx.fillRect(0, 0, width, height)

    // Histogram
    if (histogram && histogram.length === 256) {
      let maxH = 0
      for (let i = 0; i < 256; i++) if (histogram[i] > maxH) maxH = histogram[i]
      if (maxH > 0) {
        ctx.fillStyle = "rgba(80,80,80,0.4)"
        for (let i = 0; i < 256; i++) {
          const bh = (histogram[i] / maxH) * (height - 2 * pad)
          const bx = toCanvasX(i)
          ctx.fillRect(bx, height - pad - bh, Math.max(1, (width - 2 * pad) / 256), bh)
        }
      }
    }

    // Grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.08)"
    ctx.lineWidth = 1
    for (let i = 1; i < 4; i++) {
      const gx = toCanvasX((i / 4) * 255)
      const gy = toCanvasY((i / 4) * 255)
      ctx.beginPath(); ctx.moveTo(gx, pad); ctx.lineTo(gx, height - pad); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(width - pad, gy); ctx.stroke()
    }

    // Diagonal baseline
    ctx.strokeStyle = "rgba(255,255,255,0.15)"
    ctx.beginPath()
    ctx.moveTo(toCanvasX(0), toCanvasY(0))
    ctx.lineTo(toCanvasX(255), toCanvasY(255))
    ctx.stroke()

    // Curve from LUT
    const lut = buildSplineLUT(points)
    const color = CHANNEL_COLORS[channel]
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i < 256; i++) {
      const cx = toCanvasX(i)
      const cy = toCanvasY(lut[i])
      if (i === 0) ctx.moveTo(cx, cy)
      else ctx.lineTo(cx, cy)
    }
    ctx.stroke()

    // Control points
    for (let i = 0; i < points.length; i++) {
      const px = toCanvasX(points[i].x)
      const py = toCanvasY(points[i].y)
      ctx.fillStyle = dragIdx === i ? "#ffffff" : color
      ctx.strokeStyle = "#ffffff"
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(px, py, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }, [points, channel, histogram, width, height, dragIdx, pad])

  const getPointAt = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const cx = ((e.clientX - rect.left) / rect.width) * width
    const cy = ((e.clientY - rect.top) / rect.height) * height
    return { cx, cy }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    const { cx, cy } = getPointAt(e)
    // Check if clicking near an existing point
    for (let i = 0; i < points.length; i++) {
      const px = toCanvasX(points[i].x)
      const py = toCanvasY(points[i].y)
      if (Math.hypot(cx - px, cy - py) < 10) {
        // Delete on right-click or ctrl+click (but not endpoints)
        if ((e.button === 2 || e.ctrlKey) && i > 0 && i < points.length - 1) {
          const newPts = points.filter((_, j) => j !== i)
          onPointsChange(newPts)
          return
        }
        setDragIdx(i)
        return
      }
    }
    // Add new point
    const nx = fromCanvasX(cx)
    const ny = fromCanvasY(cy)
    const newPts = [...points, { x: nx, y: ny }].sort((a, b) => a.x - b.x)
    onPointsChange(newPts)
    // Find the new point index
    const idx = newPts.findIndex((p) => p.x === nx && p.y === ny)
    setDragIdx(idx)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragIdx < 0) return
    const { cx, cy } = getPointAt(e)
    const nx = fromCanvasX(cx)
    const ny = fromCanvasY(cy)
    const newPts = [...points]
    newPts[dragIdx] = { x: nx, y: ny }
    onPointsChange(newPts)
  }

  const handleMouseUp = () => {
    setDragIdx(-1)
  }

  return (
    <div className="relative inline-block">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="cursor-crosshair rounded border border-[var(--ps-divider)]"
        style={{ width: width, height: height }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="flex justify-between text-[9px] text-[var(--ps-text-dim)] mt-1 px-1">
        <span>Input: {dragIdx >= 0 ? points[dragIdx]?.x ?? "—" : "—"}</span>
        <span>Output: {dragIdx >= 0 ? points[dragIdx]?.y ?? "—" : "—"}</span>
      </div>
    </div>
  )
}

/** Export the LUT builder so filter-dialog can use it to convert curve points → filter params */
export { buildSplineLUT }
