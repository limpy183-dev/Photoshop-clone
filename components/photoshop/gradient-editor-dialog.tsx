"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { Trash2 } from "lucide-react"
import type { GradientStop, MultiGradient } from "./types"
import { hexToRgba } from "./color-utils"

interface GradientEditorProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  gradient: MultiGradient
  onGradientChange: (g: MultiGradient) => void
}

function gradientToCSS(stops: GradientStop[]): string {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset)
  const parts = sorted.map(
    (s) => `${hexToRgba(s.color, s.opacity)} ${(s.offset * 100).toFixed(1)}%`
  )
  return `linear-gradient(90deg, ${parts.join(", ")})`
}

export function GradientEditorDialog({
  open,
  onOpenChange,
  gradient,
  onGradientChange,
}: GradientEditorProps) {
  const [stops, setStops] = React.useState<GradientStop[]>(
    gradient.stops.length >= 2
      ? gradient.stops
      : [
          { offset: 0, color: "#000000", opacity: 1 },
          { offset: 1, color: "#ffffff", opacity: 1 },
        ]
  )
  const [selectedIdx, setSelectedIdx] = React.useState(0)
  const [gradType, setGradType] = React.useState(gradient.type)
  const [angle, setAngle] = React.useState(gradient.angle)
  const barRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (open) {
      setStops(
        gradient.stops.length >= 2
          ? gradient.stops
          : [
              { offset: 0, color: "#000000", opacity: 1 },
              { offset: 1, color: "#ffffff", opacity: 1 },
            ]
      )
      setGradType(gradient.type)
      setAngle(gradient.angle)
      setSelectedIdx(0)
    }
  }, [open, gradient])

  const updateStop = (idx: number, patch: Partial<GradientStop>) => {
    setStops((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s))
    )
  }

  const addStop = (e: React.MouseEvent) => {
    const bar = barRef.current
    if (!bar) return
    const rect = bar.getBoundingClientRect()
    const offset = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    // Interpolate color from neighbors
    const sorted = [...stops].sort((a, b) => a.offset - b.offset)
    let color = "#888888"
    for (let i = 0; i < sorted.length - 1; i++) {
      if (offset >= sorted[i].offset && offset <= sorted[i + 1].offset) {
        color = sorted[i].color
        break
      }
    }
    const newStop: GradientStop = { offset, color, opacity: 1 }
    const newStops = [...stops, newStop].sort((a, b) => a.offset - b.offset)
    setStops(newStops)
    setSelectedIdx(newStops.indexOf(newStop))
  }

  const removeStop = (idx: number) => {
    if (stops.length <= 2) return
    setStops((prev) => prev.filter((_, i) => i !== idx))
    setSelectedIdx(Math.max(0, idx - 1))
  }

  const apply = () => {
    onGradientChange({
      type: gradType,
      angle,
      stops: [...stops].sort((a, b) => a.offset - b.offset),
    })
    onOpenChange(false)
  }

  const selected = stops[selectedIdx]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] bg-[var(--ps-panel)] border-[var(--ps-divider)] text-[var(--ps-text)]">
        <DialogHeader>
          <DialogTitle className="text-sm">Gradient Editor</DialogTitle>
          <DialogDescription className="sr-only">Edit gradient stops and type.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Gradient type & angle */}
          <div className="flex gap-3 items-center">
            <label className="text-[10px] text-[var(--ps-text-dim)]">
              Type
              <select
                value={gradType}
                onChange={(e) => setGradType(e.target.value as MultiGradient["type"])}
                className="ml-1 h-6 bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] rounded-sm px-1 text-[11px]"
              >
                <option value="linear">Linear</option>
                <option value="radial">Radial</option>
                <option value="angular">Angular</option>
                <option value="reflected">Reflected</option>
                <option value="diamond">Diamond</option>
              </select>
            </label>
            <label className="text-[10px] text-[var(--ps-text-dim)]">
              Angle
              <input
                type="number"
                value={angle}
                onChange={(e) => setAngle(Number(e.target.value) || 0)}
                className="ml-1 w-14 h-6 bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] rounded-sm px-1 text-[11px] text-center"
              />°
            </label>
          </div>

          {/* Gradient bar */}
          <div className="space-y-1">
            <div className="text-[10px] text-[var(--ps-text-dim)]">Gradient Preview</div>
            <div
              ref={barRef}
              className="h-8 rounded border border-[var(--ps-divider)] cursor-crosshair relative"
              style={{ background: gradientToCSS(stops) }}
              onDoubleClick={addStop}
            >
              {/* Stop handles */}
              {stops.map((s, i) => (
                <div
                  key={i}
                  className={`absolute top-full mt-0.5 w-3 h-3 rounded-sm border-2 cursor-pointer transform -translate-x-1/2 ${
                    i === selectedIdx
                      ? "border-white ring-1 ring-[var(--ps-accent)]"
                      : "border-[var(--ps-divider)]"
                  }`}
                  style={{
                    left: `${s.offset * 100}%`,
                    backgroundColor: s.color,
                  }}
                  onClick={() => setSelectedIdx(i)}
                />
              ))}
            </div>
            <div className="text-[9px] text-[var(--ps-text-dim)] mt-3">
              Double-click the bar to add a stop. Select a stop below to edit.
            </div>
          </div>

          {/* Selected stop controls */}
          {selected && (
            <div className="rounded border border-[var(--ps-divider)] p-3 space-y-3">
              <div className="text-[10px] font-medium">
                Stop {selectedIdx + 1} of {stops.length}
              </div>

              <div className="flex items-center gap-3">
                <Label className="text-[10px] text-[var(--ps-text-dim)]">Color</Label>
                <input
                  type="color"
                  value={selected.color}
                  onChange={(e) => updateStop(selectedIdx, { color: e.target.value })}
                  className="w-8 h-6 border border-[var(--ps-divider)] rounded-sm cursor-pointer"
                />
                <input
                  type="text"
                  value={selected.color}
                  onChange={(e) => updateStop(selectedIdx, { color: e.target.value })}
                  className="w-20 h-6 bg-[var(--ps-panel-2)] border border-[var(--ps-divider)] rounded-sm px-1 text-[11px]"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-[var(--ps-text-dim)]">Opacity</span>
                  <span>{Math.round(selected.opacity * 100)}%</span>
                </div>
                <Slider
                  min={0}
                  max={100}
                  value={[Math.round(selected.opacity * 100)]}
                  onValueChange={(v) => updateStop(selectedIdx, { opacity: v[0] / 100 })}
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-[var(--ps-text-dim)]">Location</span>
                  <span>{Math.round(selected.offset * 100)}%</span>
                </div>
                <Slider
                  min={0}
                  max={100}
                  value={[Math.round(selected.offset * 100)]}
                  onValueChange={(v) => updateStop(selectedIdx, { offset: v[0] / 100 })}
                />
              </div>

              <Button
                variant="outline"
                size="sm"
                className="text-[10px] h-6"
                onClick={() => removeStop(selectedIdx)}
                disabled={stops.length <= 2}
              >
                <Trash2 className="w-3 h-3 mr-1" /> Delete Stop
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={apply}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
