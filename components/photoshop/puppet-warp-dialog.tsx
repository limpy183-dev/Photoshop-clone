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

interface Pin {
  id: string
  x: number
  y: number
  origX: number
  origY: number
}

export function PuppetWarpDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { activeLayer, commit, requestRender } = useEditor()
  const [pins, setPins] = React.useState<Pin[]>([])
  const [draggingPin, setDraggingPin] = React.useState<string | null>(null)
  const [meshDensity, setMeshDensity] = React.useState<"fewer" | "normal" | "more">("normal")
  const [rigidity, setRigidity] = React.useState<"rigid" | "normal" | "distort">("normal")
  const [showMesh, setShowMesh] = React.useState(true)
  const previewRef = React.useRef<HTMLCanvasElement>(null)
  const workingRef = React.useRef<HTMLCanvasElement | null>(null)
  const originalRef = React.useRef<HTMLCanvasElement | null>(null)

  const applyWarpToCanvasRef = React.useRef(applyWarpToCanvas)
  applyWarpToCanvasRef.current = applyWarpToCanvas

  const drawPreview = React.useCallback((currentPins: Pin[]) => {
    const cv = previewRef.current
    const orig = originalRef.current
    if (!cv || !orig) return
    const max = 480
    const ratio = Math.min(max / orig.width, max / orig.height, 1)
    cv.width = Math.max(1, Math.floor(orig.width * ratio))
    cv.height = Math.max(1, Math.floor(orig.height * ratio))
    const ctx = cv.getContext("2d")!
    ctx.fillStyle = "#222"
    ctx.fillRect(0, 0, cv.width, cv.height)

    // If we have moved pins, apply warp and draw result
    if (currentPins.length > 0) {
      const warped = applyWarpToCanvasRef.current(orig, currentPins)
      ctx.drawImage(warped, 0, 0, cv.width, cv.height)
    } else {
      ctx.drawImage(orig, 0, 0, cv.width, cv.height)
    }

    // Draw mesh
    if (showMesh) {
      const gridStep = meshDensity === "fewer" ? 40 : meshDensity === "more" ? 15 : 25
      ctx.strokeStyle = "rgba(0,200,255,0.3)"
      ctx.lineWidth = 0.5
      for (let x = 0; x < cv.width; x += gridStep * ratio) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cv.height); ctx.stroke()
      }
      for (let y = 0; y < cv.height; y += gridStep * ratio) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cv.width, y); ctx.stroke()
      }
    }

    // Draw pins
    for (const pin of currentPins) {
      const px = (pin.x / orig.width) * cv.width
      const py = (pin.y / orig.height) * cv.height
      const moved = pin.x !== pin.origX || pin.y !== pin.origY

      // Pin circle
      ctx.beginPath()
      ctx.arc(px, py, 6, 0, Math.PI * 2)
      ctx.fillStyle = moved ? "#ffcc00" : "#00ccff"
      ctx.fill()
      ctx.strokeStyle = "#000"
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Center dot
      ctx.beginPath()
      ctx.arc(px, py, 2, 0, Math.PI * 2)
      ctx.fillStyle = "#000"
      ctx.fill()

      // Draw connection line from original to current position
      if (moved) {
        const ox = (pin.origX / orig.width) * cv.width
        const oy = (pin.origY / orig.height) * cv.height
        ctx.beginPath()
        ctx.setLineDash([2, 2])
        ctx.strokeStyle = "rgba(255,204,0,0.5)"
        ctx.moveTo(ox, oy)
        ctx.lineTo(px, py)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
  }, [showMesh, meshDensity])

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
    setPins([])
    drawPreview([])
  }, [open, activeLayer, drawPreview])

  function applyWarpToCanvas(src: HTMLCanvasElement, warpPins: Pin[]): HTMLCanvasElement {
    const w = src.width, h = src.height
    const srcCtx = src.getContext("2d")!
    const srcData = srcCtx.getImageData(0, 0, w, h)
    const dst = makeCanvas(w, h)
    const dstCtx = dst.getContext("2d")!
    const dstData = dstCtx.createImageData(w, h)

    const rigidK = rigidity === "rigid" ? 2.0 : rigidity === "distort" ? 0.5 : 1.0

    // For each output pixel, compute the displacement from all pins using
    // Moving Least Squares (MLS) rigid deformation
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Compute weighted displacement
        let totalWeight = 0
        let dispX = 0, dispY = 0

        for (const pin of warpPins) {
          const dx = pin.origX - x
          const dy = pin.origY - y
          const dist2 = dx * dx + dy * dy
          if (dist2 < 0.01) {
            // Exactly at a pin location
            dispX = pin.origX - pin.x
            dispY = pin.origY - pin.y
            totalWeight = 1
            break
          }
          const weight = 1 / Math.pow(dist2, rigidK)
          dispX += (pin.origX - pin.x) * weight
          dispY += (pin.origY - pin.y) * weight
          totalWeight += weight
        }

        if (totalWeight > 0) {
          dispX /= totalWeight
          dispY /= totalWeight
        }

        // Sample from source at displaced position
        const sx = x + dispX
        const sy = y + dispY
        const fx = Math.floor(sx), fy = Math.floor(sy)
        const dx2 = sx - fx, dy2 = sy - fy
        const idx = (y * w + x) * 4

        if (fx >= 0 && fx < w - 1 && fy >= 0 && fy < h - 1) {
          for (let c = 0; c < 4; c++) {
            const s00 = srcData.data[(fy * w + fx) * 4 + c]
            const s10 = srcData.data[(fy * w + fx + 1) * 4 + c]
            const s01 = srcData.data[((fy + 1) * w + fx) * 4 + c]
            const s11 = srcData.data[((fy + 1) * w + fx + 1) * 4 + c]
            dstData.data[idx + c] = Math.round(
              s00 * (1 - dx2) * (1 - dy2) +
              s10 * dx2 * (1 - dy2) +
              s01 * (1 - dx2) * dy2 +
              s11 * dx2 * dy2
            )
          }
        } else if (fx >= 0 && fx < w && fy >= 0 && fy < h) {
          const si = (fy * w + fx) * 4
          dstData.data[idx] = srcData.data[si]
          dstData.data[idx + 1] = srcData.data[si + 1]
          dstData.data[idx + 2] = srcData.data[si + 2]
          dstData.data[idx + 3] = srcData.data[si + 3]
        }
      }
    }
    dstCtx.putImageData(dstData, 0, 0)
    return dst
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = previewRef.current
    const orig = originalRef.current
    if (!cv || !orig) return
    cv.setPointerCapture(e.pointerId)
    const rect = cv.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * orig.width
    const my = ((e.clientY - rect.top) / rect.height) * orig.height

    // Check if clicking on existing pin
    for (const pin of pins) {
      const dist = Math.hypot(pin.x - mx, pin.y - my)
      if (dist < 12) {
        if (e.altKey) {
          // Alt+click to remove pin
          const newPins = pins.filter((p) => p.id !== pin.id)
          setPins(newPins)
          drawPreview(newPins)
        } else {
          setDraggingPin(pin.id)
        }
        return
      }
    }

    // Add new pin
    const newPin: Pin = {
      id: `pin_${Math.random().toString(36).slice(2, 7)}`,
      x: mx,
      y: my,
      origX: mx,
      origY: my,
    }
    const newPins = [...pins, newPin]
    setPins(newPins)
    setDraggingPin(newPin.id)
    drawPreview(newPins)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingPin) return
    const cv = previewRef.current
    const orig = originalRef.current
    if (!cv || !orig) return
    const rect = cv.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * orig.width
    const my = ((e.clientY - rect.top) / rect.height) * orig.height

    const newPins = pins.map((p) =>
      p.id === draggingPin ? { ...p, x: mx, y: my } : p
    )
    setPins(newPins)
    drawPreview(newPins)
  }

  const onPointerUp = () => {
    setDraggingPin(null)
  }

  const apply = () => {
    if (!activeLayer || activeLayer.locked || !originalRef.current) {
      onOpenChange(false)
      return
    }
    if (pins.length === 0) {
      onOpenChange(false)
      return
    }
    const warped = applyWarpToCanvas(originalRef.current, pins)
    const ctx = activeLayer.canvas.getContext("2d")!
    ctx.clearRect(0, 0, activeLayer.canvas.width, activeLayer.canvas.height)
    ctx.drawImage(warped, 0, 0)
    requestRender()
    commit("Puppet Warp", [activeLayer.id])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle>Puppet Warp (weighted pins)</DialogTitle>
        </DialogHeader>
        <div className="flex gap-3">
          {/* Controls sidebar */}
          <div className="w-[130px] shrink-0 space-y-3 text-[11px]">
            <div>
              <Label className="text-[10px] text-[var(--ps-text-dim)]">Mode</Label>
              <select
                value={rigidity}
                onChange={(e) => setRigidity(e.target.value as typeof rigidity)}
                className="w-full h-6 bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] rounded-sm px-1 text-[11px]"
              >
                <option value="rigid">Rigid</option>
                <option value="normal">Normal</option>
                <option value="distort">Distort</option>
              </select>
            </div>
            <div>
              <Label className="text-[10px] text-[var(--ps-text-dim)]">Density</Label>
              <select
                value={meshDensity}
                onChange={(e) => setMeshDensity(e.target.value as typeof meshDensity)}
                className="w-full h-6 bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] rounded-sm px-1 text-[11px]"
              >
                <option value="fewer">Fewer Points</option>
                <option value="normal">Normal</option>
                <option value="more">More Points</option>
              </select>
            </div>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={showMesh} onChange={(e) => { setShowMesh(e.target.checked); drawPreview(pins) }} />
              Show Mesh
            </label>
            <div className="border-t border-[var(--ps-divider)] pt-2">
              <p className="text-[10px] text-[var(--ps-text-dim)] leading-tight">
                Pins: <span className="text-[var(--ps-text)] font-medium">{pins.length}</span>
              </p>
              <p className="text-[10px] text-[var(--ps-text-dim)] leading-tight mt-1">
                Click to place pins. Drag pins to deform. Alt+click to remove.
              </p>
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
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply} disabled={!activeLayer || activeLayer.locked || pins.length === 0}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
