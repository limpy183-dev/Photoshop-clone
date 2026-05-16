"use client"

import * as React from "react"
import { useEditor } from "../editor-context"

interface GradientPreset {
  id: string
  name: string
  stops: { pos: number; color: string }[]
}

function presetStops(preset: GradientPreset) {
  return preset.stops.map((stop) => ({
    offset: stop.pos,
    color: stop.color,
    opacity: stop.color.includes("rgba") && stop.color.endsWith(",0)") ? 0 : 1,
  }))
}

const DEFAULT_GRADIENTS: GradientPreset[] = [
  { id: "fg-bg", name: "Foreground to Background", stops: [{ pos: 0, color: "#000000" }, { pos: 1, color: "#ffffff" }] },
  { id: "fg-trans", name: "Foreground to Transparent", stops: [{ pos: 0, color: "#000000" }, { pos: 1, color: "rgba(0,0,0,0)" }] },
  { id: "black-white", name: "Black & White", stops: [{ pos: 0, color: "#000000" }, { pos: 1, color: "#ffffff" }] },
  { id: "red-orange", name: "Red to Orange", stops: [{ pos: 0, color: "#ff0000" }, { pos: 1, color: "#ff9900" }] },
  { id: "sunset", name: "Sunset", stops: [{ pos: 0, color: "#ff4500" }, { pos: 0.5, color: "#ff8c00" }, { pos: 1, color: "#ffd700" }] },
  { id: "ocean", name: "Ocean", stops: [{ pos: 0, color: "#001f3f" }, { pos: 0.5, color: "#0074D9" }, { pos: 1, color: "#7FDBFF" }] },
  { id: "forest", name: "Forest", stops: [{ pos: 0, color: "#0d260d" }, { pos: 0.5, color: "#2ECC40" }, { pos: 1, color: "#a8e6cf" }] },
  { id: "fire", name: "Fire", stops: [{ pos: 0, color: "#1a0000" }, { pos: 0.3, color: "#cc0000" }, { pos: 0.6, color: "#ff6600" }, { pos: 1, color: "#ffff00" }] },
  { id: "cool", name: "Cool", stops: [{ pos: 0, color: "#6600cc" }, { pos: 0.5, color: "#0066ff" }, { pos: 1, color: "#00ccff" }] },
  { id: "warm", name: "Warm", stops: [{ pos: 0, color: "#cc3300" }, { pos: 0.5, color: "#ff6633" }, { pos: 1, color: "#ffcc66" }] },
  { id: "rainbow", name: "Rainbow", stops: [
    { pos: 0, color: "#ff0000" }, { pos: 0.17, color: "#ff9900" }, { pos: 0.33, color: "#ffff00" },
    { pos: 0.5, color: "#00ff00" }, { pos: 0.67, color: "#0099ff" }, { pos: 0.83, color: "#6600cc" }, { pos: 1, color: "#cc00ff" },
  ]},
  { id: "chrome", name: "Chrome", stops: [
    { pos: 0, color: "#333333" }, { pos: 0.25, color: "#cccccc" }, { pos: 0.5, color: "#666666" },
    { pos: 0.75, color: "#eeeeee" }, { pos: 1, color: "#444444" },
  ]},
  { id: "pastel", name: "Pastel", stops: [
    { pos: 0, color: "#ffcccc" }, { pos: 0.25, color: "#ffffcc" }, { pos: 0.5, color: "#ccffcc" },
    { pos: 0.75, color: "#ccccff" }, { pos: 1, color: "#ffccff" },
  ]},
  { id: "night-sky", name: "Night Sky", stops: [{ pos: 0, color: "#0a0a2e" }, { pos: 0.5, color: "#1a1a4e" }, { pos: 1, color: "#2d1b69" }] },
  { id: "copper", name: "Copper", stops: [{ pos: 0, color: "#2e1503" }, { pos: 0.5, color: "#b87333" }, { pos: 1, color: "#da9a5b" }] },
]

function drawGradientPreview(canvas: HTMLCanvasElement, stops: { pos: number; color: string }[]) {
  const ctx = canvas.getContext("2d")!
  const grad = ctx.createLinearGradient(0, 0, canvas.width, 0)
  for (const s of stops) {
    try { grad.addColorStop(s.pos, s.color) } catch {}
  }
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, canvas.width, canvas.height)
}

export function GradientsPanel() {
  const { dispatch } = useEditor()
  const [selected, setSelected] = React.useState<string>("fg-bg")

  return (
    <div className="p-2 text-[11px] text-[var(--ps-text)] space-y-2">
      <div className="grid grid-cols-3 gap-1">
        {DEFAULT_GRADIENTS.map((g) => (
          <GradientThumb
            key={g.id}
            preset={g}
            isActive={selected === g.id}
            onSelect={() => {
              setSelected(g.id)
              dispatch({ type: "set-gradient-stops", stops: presetStops(g) })
            }}
          />
        ))}
      </div>
      <div className="text-[10px] text-[var(--ps-text-dim)] border-t border-[var(--ps-divider)] pt-1">
        {DEFAULT_GRADIENTS.find((g) => g.id === selected)?.name ?? ""}
      </div>
    </div>
  )
}

function GradientThumb({ preset, isActive, onSelect }: { preset: GradientPreset; isActive: boolean; onSelect: () => void }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  React.useEffect(() => {
    if (canvasRef.current) drawGradientPreview(canvasRef.current, preset.stops)
  }, [preset])

  return (
    <button
      className={`block w-full rounded-sm overflow-hidden border transition-colors ${
        isActive ? "border-[var(--ps-accent)] ring-1 ring-[var(--ps-accent)]" : "border-[var(--ps-divider)] hover:border-white"
      }`}
      title={preset.name}
      onClick={onSelect}
    >
      <canvas ref={canvasRef} width={80} height={16} className="w-full h-4 block" />
    </button>
  )
}
