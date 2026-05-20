"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useEditor } from "./editor-context"
import { makeCanvas } from "./tool-helpers"

type LiquifyMode = "push" | "reconstruct" | "pucker" | "bloat" | "twirl" | "twirl-left" | "face-eyes" | "face-smile" | "face-jaw"

const MODES: { id: LiquifyMode; label: string; desc: string }[] = [
  { id: "push", label: "Forward Warp", desc: "Push pixels in drag direction" },
  { id: "reconstruct", label: "Reconstruct", desc: "Paint pixels back toward the original layer" },
  { id: "pucker", label: "Pucker", desc: "Contract pixels toward center" },
  { id: "bloat", label: "Bloat", desc: "Expand pixels outward from center" },
  { id: "twirl", label: "Twirl Clockwise", desc: "Rotate pixels around center" },
  { id: "twirl-left", label: "Twirl Counter", desc: "Rotate pixels counterclockwise around center" },
  { id: "face-eyes", label: "Face Bounds Eyes", desc: "Eye-region warp estimated from the visible layer bounds" },
  { id: "face-smile", label: "Face Bounds Smile", desc: "Mouth-region warp estimated from the visible layer bounds" },
  { id: "face-jaw", label: "Face Bounds Jaw", desc: "Jaw-region warp estimated from the visible layer bounds" },
]

function bilinearCopy(
  src: ImageData,
  out: Uint8ClampedArray,
  width: number,
  height: number,
  srcX: number,
  srcY: number,
  dstX: number,
  dstY: number,
) {
  const fx = Math.floor(srcX)
  const fy = Math.floor(srcY)
  if (fx < 0 || fy < 0 || fx >= width - 1 || fy >= height - 1) return
  const dx = srcX - fx
  const dy = srcY - fy
  const dIdx = (dstY * width + dstX) * 4
  for (let c = 0; c < 4; c++) {
    const s00 = src.data[(fy * width + fx) * 4 + c]
    const s10 = src.data[(fy * width + fx + 1) * 4 + c]
    const s01 = src.data[((fy + 1) * width + fx) * 4 + c]
    const s11 = src.data[((fy + 1) * width + fx + 1) * 4 + c]
    out[dIdx + c] = Math.round(
      s00 * (1 - dx) * (1 - dy) +
      s10 * dx * (1 - dy) +
      s01 * (1 - dx) * dy +
      s11 * dx * dy,
    )
  }
}

function alphaBounds(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let minX = canvas.width
  let minY = canvas.height
  let maxX = 0
  let maxY = 0
  let any = false
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (img.data[(y * canvas.width + x) * 4 + 3] > 8) {
        any = true
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }
  return any ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null
}

export function LiquifyDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeLayer, commit, requestRender } = useEditor()
  const [brushSize, setBrushSize] = React.useState(80)
  const [pressure, setPressure] = React.useState(50)
  const [density, setDensity] = React.useState(50)
  const [mode, setMode] = React.useState<LiquifyMode>("push")
  const [showMesh, setShowMesh] = React.useState(true)
  const previewRef = React.useRef<HTMLCanvasElement>(null)
  const workingRef = React.useRef<HTMLCanvasElement | null>(null)
  const originalRef = React.useRef<HTMLCanvasElement | null>(null)
  const draggingRef = React.useRef<{ x: number; y: number } | null>(null)

  const drawPreview = React.useCallback(() => {
    const cv = previewRef.current
    const work = workingRef.current
    if (!cv || !work) return
    const max = 480
    const ratio = Math.min(max / work.width, max / work.height, 1)
    cv.width = Math.max(1, Math.floor(work.width * ratio))
    cv.height = Math.max(1, Math.floor(work.height * ratio))
    const ctx = cv.getContext("2d")!
    ctx.fillStyle = "#222"
    ctx.fillRect(0, 0, cv.width, cv.height)
    ctx.drawImage(work, 0, 0, cv.width, cv.height)
    if (showMesh) {
      ctx.save()
      ctx.strokeStyle = "rgba(0, 225, 255, 0.28)"
      ctx.lineWidth = 1
      const step = Math.max(16, Math.round(Math.min(cv.width, cv.height) / 12))
      for (let x = step; x < cv.width; x += step) {
        ctx.beginPath()
        ctx.moveTo(x + 0.5, 0)
        ctx.lineTo(x + 0.5, cv.height)
        ctx.stroke()
      }
      for (let y = step; y < cv.height; y += step) {
        ctx.beginPath()
        ctx.moveTo(0, y + 0.5)
        ctx.lineTo(cv.width, y + 0.5)
        ctx.stroke()
      }
      ctx.restore()
    }
  }, [showMesh])

  React.useEffect(() => {
    if (!open || !activeLayer) return
    if (typeof activeLayer.canvas.getContext !== "function") return
    const w = activeLayer.canvas.width
    const h = activeLayer.canvas.height
    const orig = makeCanvas(w, h)
    orig.getContext("2d")!.drawImage(activeLayer.canvas, 0, 0)
    originalRef.current = orig
    const work = makeCanvas(w, h)
    work.getContext("2d")!.drawImage(activeLayer.canvas, 0, 0)
    workingRef.current = work
    drawPreview()
  }, [open, activeLayer, drawPreview])

  const reset = () => {
    if (!originalRef.current || !workingRef.current) return
    const wctx = workingRef.current.getContext("2d")!
    wctx.clearRect(0, 0, workingRef.current.width, workingRef.current.height)
    wctx.drawImage(originalRef.current, 0, 0)
    drawPreview()
  }

  const applyLiquifyAtPoint = (cx: number, cy: number, dx: number, dy: number) => {
    const work = workingRef.current
    const original = originalRef.current
    if (!work) return
    if (mode.startsWith("face-")) {
      applyFaceAware(mode)
      return
    }
    const w = work.width, h = work.height
    const ctx = work.getContext("2d")!
    const r = brushSize
    const sx = Math.max(0, Math.floor(cx - r - 2))
    const sy = Math.max(0, Math.floor(cy - r - 2))
    const ex = Math.min(w, Math.ceil(cx + r + 2))
    const ey = Math.min(h, Math.ceil(cy + r + 2))
    const rw = ex - sx, rh = ey - sy
    if (rw <= 0 || rh <= 0) return

    const src = ctx.getImageData(sx, sy, rw, rh)
    const out = new Uint8ClampedArray(src.data)
    const pressureK = pressure / 100
    const densityK = density / 100

    for (let py = 0; py < rh; py++) {
      for (let px = 0; px < rw; px++) {
        const ax = px + sx, ay = py + sy
        const dist = Math.hypot(ax - cx, ay - cy)
        if (dist >= r) continue

        const falloff = (1 - dist / r) * pressureK * densityK
        let srcX = ax, srcY = ay

        if (mode === "reconstruct" && original) {
          const oi = ((ay - sy) * rw + (ax - sx)) * 4
          const originalPixel = original.getContext("2d")!.getImageData(ax, ay, 1, 1).data
          out[oi] = Math.round(src.data[oi] * (1 - falloff) + originalPixel[0] * falloff)
          out[oi + 1] = Math.round(src.data[oi + 1] * (1 - falloff) + originalPixel[1] * falloff)
          out[oi + 2] = Math.round(src.data[oi + 2] * (1 - falloff) + originalPixel[2] * falloff)
          out[oi + 3] = Math.round(src.data[oi + 3] * (1 - falloff) + originalPixel[3] * falloff)
          continue
        } else if (mode === "push") {
          srcX = ax - dx * falloff
          srcY = ay - dy * falloff
        } else if (mode === "pucker") {
          srcX = ax + (cx - ax) * falloff * 0.3
          srcY = ay + (cy - ay) * falloff * 0.3
        } else if (mode === "bloat") {
          srcX = ax - (cx - ax) * falloff * 0.3
          srcY = ay - (cy - ay) * falloff * 0.3
        } else if (mode === "twirl" || mode === "twirl-left") {
          const angle = falloff * 0.15 * (mode === "twirl-left" ? -1 : 1)
          const cos = Math.cos(angle), sin = Math.sin(angle)
          const relX = ax - cx, relY = ay - cy
          srcX = cx + relX * cos - relY * sin
          srcY = cy + relX * sin + relY * cos
        }

        // Bilinear sample from source
        const fx = Math.floor(srcX - sx), fy = Math.floor(srcY - sy)
        const dx2 = srcX - sx - fx, dy2 = srcY - sy - fy
        const dIdx = (py * rw + px) * 4

        if (fx >= 0 && fx < rw - 1 && fy >= 0 && fy < rh - 1) {
          for (let c = 0; c < 4; c++) {
            const s00 = src.data[(fy * rw + fx) * 4 + c]
            const s10 = src.data[(fy * rw + fx + 1) * 4 + c]
            const s01 = src.data[((fy + 1) * rw + fx) * 4 + c]
            const s11 = src.data[((fy + 1) * rw + fx + 1) * 4 + c]
            out[dIdx + c] = Math.round(
              s00 * (1 - dx2) * (1 - dy2) +
              s10 * dx2 * (1 - dy2) +
              s01 * (1 - dx2) * dy2 +
              s11 * dx2 * dy2
            )
          }
        }
      }
    }
    ctx.putImageData(new ImageData(out, rw, rh), sx, sy)
  }

  const applyFaceAware = (faceMode: LiquifyMode) => {
    const work = workingRef.current
    if (!work) return
    const bounds = alphaBounds(work) ?? { x: work.width * 0.25, y: work.height * 0.12, w: work.width * 0.5, h: work.height * 0.68 }
    const strength = pressure / 100
    if (faceMode === "face-eyes") {
      warpRegion(bounds.x + bounds.w * 0.34, bounds.y + bounds.h * 0.36, bounds.w * 0.12, 0, 0, "bloat", strength * 0.75)
      warpRegion(bounds.x + bounds.w * 0.66, bounds.y + bounds.h * 0.36, bounds.w * 0.12, 0, 0, "bloat", strength * 0.75)
    } else if (faceMode === "face-smile") {
      warpRegion(bounds.x + bounds.w * 0.32, bounds.y + bounds.h * 0.72, bounds.w * 0.18, -bounds.w * 0.04, -bounds.h * 0.035, "push", strength)
      warpRegion(bounds.x + bounds.w * 0.68, bounds.y + bounds.h * 0.72, bounds.w * 0.18, bounds.w * 0.04, -bounds.h * 0.035, "push", strength)
    } else if (faceMode === "face-jaw") {
      warpRegion(bounds.x + bounds.w * 0.2, bounds.y + bounds.h * 0.76, bounds.w * 0.2, bounds.w * 0.045, 0, "push", strength)
      warpRegion(bounds.x + bounds.w * 0.8, bounds.y + bounds.h * 0.76, bounds.w * 0.2, -bounds.w * 0.045, 0, "push", strength)
    }
  }

  const warpRegion = (cx: number, cy: number, radius: number, dx: number, dy: number, warpMode: "push" | "bloat", strength: number) => {
    const work = workingRef.current
    if (!work) return
    const ctx = work.getContext("2d")!
    const sx = Math.max(0, Math.floor(cx - radius - 2))
    const sy = Math.max(0, Math.floor(cy - radius - 2))
    const ex = Math.min(work.width, Math.ceil(cx + radius + 2))
    const ey = Math.min(work.height, Math.ceil(cy + radius + 2))
    const rw = ex - sx
    const rh = ey - sy
    if (rw <= 1 || rh <= 1) return
    const src = ctx.getImageData(sx, sy, rw, rh)
    const out = new Uint8ClampedArray(src.data)
    for (let py = 0; py < rh; py++) {
      for (let px = 0; px < rw; px++) {
        const ax = sx + px
        const ay = sy + py
        const dist = Math.hypot(ax - cx, ay - cy)
        if (dist >= radius) continue
        const falloff = (1 - dist / radius) * strength
        const srcX = warpMode === "push" ? ax - dx * falloff : ax - (cx - ax) * falloff * 0.28
        const srcY = warpMode === "push" ? ay - dy * falloff : ay - (cy - ay) * falloff * 0.28
        bilinearCopy(src, out, rw, rh, srcX - sx, srcY - sy, px, py)
      }
    }
    ctx.putImageData(new ImageData(out, rw, rh), sx, sy)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = previewRef.current
    const work = workingRef.current
    if (!cv || !work) return
    cv.setPointerCapture(e.pointerId)
    const rect = cv.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * work.width
    const y = ((e.clientY - rect.top) / rect.height) * work.height
    draggingRef.current = { x, y }
    if (mode !== "push") {
      applyLiquifyAtPoint(x, y, 0, 0)
      drawPreview()
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = draggingRef.current
    if (!drag) return
    const cv = previewRef.current
    const work = workingRef.current
    if (!cv || !work) return
    const rect = cv.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * work.width
    const y = ((e.clientY - rect.top) / rect.height) * work.height
    if (mode.startsWith("face-")) return
    applyLiquifyAtPoint(x, y, x - drag.x, y - drag.y)
    draggingRef.current = { x, y }
    drawPreview()
  }

  const onPointerUp = () => { draggingRef.current = null }

  const apply = () => {
    if (!activeLayer || activeLayer.locked || !workingRef.current) {
      onOpenChange(false)
      return
    }
    const ctx = activeLayer.canvas.getContext("2d")!
    ctx.clearRect(0, 0, activeLayer.canvas.width, activeLayer.canvas.height)
    ctx.drawImage(workingRef.current, 0, 0)
    requestRender()
    commit("Liquify", [activeLayer.id])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Liquify</DialogTitle>
        </DialogHeader>
        <div className="flex gap-3">
          {/* Tool sidebar */}
          <div className="w-[140px] shrink-0 space-y-2">
            <Label className="text-[10px] text-[var(--ps-text-dim)]">Tool</Label>
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                title={m.desc}
                className={`w-full h-7 text-[11px] rounded-sm text-left px-2 ${
                  mode === m.id
                    ? "bg-[var(--ps-tool-active)] text-white"
                    : "bg-[var(--ps-panel-2)] hover:bg-[var(--ps-tool-hover)] text-[var(--ps-text)]"
                }`}
              >
                {m.label}
              </button>
            ))}
            <div className="border-t border-[var(--ps-divider)] pt-2 space-y-2">
              <div>
                <Label className="text-[10px] text-[var(--ps-text-dim)]">Brush Size ({brushSize}px)</Label>
                <input type="range" min={10} max={300} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-full" />
              </div>
              <div>
                <Label className="text-[10px] text-[var(--ps-text-dim)]">Pressure ({pressure}%)</Label>
                <input type="range" min={1} max={100} value={pressure} onChange={(e) => setPressure(Number(e.target.value))} className="w-full" />
              </div>
              <div>
                <Label className="text-[10px] text-[var(--ps-text-dim)]">Density ({density}%)</Label>
                <input type="range" min={1} max={100} value={density} onChange={(e) => setDensity(Number(e.target.value))} className="w-full" />
              </div>
              <Button variant="outline" size="sm" onClick={reset} className="w-full h-7 text-[11px]">Reset</Button>
              <label className="flex items-center gap-2 text-[11px]">
                <input type="checkbox" checked={showMesh} onChange={(e) => setShowMesh(e.target.checked)} />
                Mesh overlay
              </label>
            </div>
          </div>
          {/* Preview */}
          <div className="flex-1 flex items-center justify-center bg-black p-1 border border-[var(--ps-divider)]">
            <canvas
              ref={previewRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="cursor-crosshair touch-none"
              style={{ imageRendering: "auto" }}
            />
          </div>
        </div>
        <p className="text-[11px] text-[var(--ps-text-dim)]">
          {MODES.find((m) => m.id === mode)?.desc}. Drag inside the preview to deform pixels.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply} disabled={!activeLayer || activeLayer.locked}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
