"use client"

import * as React from "react"
import { toast } from "sonner"
import { useEditor } from "../editor-context"
import { downloadDataUrl, downloadText, renderDocumentComposite } from "../document-io"
import { Copy, Download, Eye, Play, Plus, Trash2 } from "lucide-react"
import type { PsDocument, TimelineFrame } from "../types"

function docWithFrame(doc: PsDocument, frame: TimelineFrame): PsDocument {
  return {
    ...doc,
    layers: doc.layers.map((layer) => ({
      ...layer,
      visible: frame.layerVisibility[layer.id] ?? layer.visible,
      opacity: frame.layerOpacity?.[layer.id] ?? layer.opacity,
    })),
  }
}

export function TimelinePanel() {
  const { activeDoc, dispatch, commit, requestRender } = useEditor()
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [playing, setPlaying] = React.useState(false)

  const frames = activeDoc?.timelineFrames ?? []
  const selected = frames.find((frame) => frame.id === selectedId) ?? frames[0] ?? null

  React.useEffect(() => {
    if (!playing || !activeDoc || frames.length === 0) return
    let cancelled = false
    let index = Math.max(0, frames.findIndex((frame) => frame.id === selected?.id))
    const tick = () => {
      if (cancelled) return
      const frame = frames[index % frames.length]
      applyFrame(frame, false)
      setSelectedId(frame.id)
      index++
      window.setTimeout(tick, Math.max(50, frame.durationMs))
    }
    tick()
    return () => {
      cancelled = true
    }
  }, [playing, activeDoc, frames, selected?.id])

  if (!activeDoc) return <PanelEmpty text="No document open" />
  const doc = activeDoc

  const setFrames = (next: TimelineFrame[]) => dispatch({ type: "set-timeline-frames", frames: next })

  const captureFrame = () => {
    const frame: TimelineFrame = {
      id: `frame_${Math.random().toString(36).slice(2, 9)}`,
      name: `Frame ${frames.length + 1}`,
      durationMs: 500,
      layerVisibility: Object.fromEntries(doc.layers.map((layer) => [layer.id, layer.visible])),
      layerOpacity: Object.fromEntries(doc.layers.map((layer) => [layer.id, layer.opacity])),
      transition: "hold",
    }
    setFrames([...frames, frame])
    setSelectedId(frame.id)
    window.setTimeout(() => commit("Capture Timeline Frame", "all"), 0)
  }

  function applyFrame(frame: TimelineFrame, record = true) {
    for (const layer of doc.layers) {
      const next = frame.layerVisibility[layer.id]
      if (typeof next === "boolean" && next !== layer.visible) {
        dispatch({ type: "set-layer-visibility", id: layer.id, visible: next })
      }
      const opacity = frame.layerOpacity?.[layer.id]
      if (typeof opacity === "number" && opacity !== layer.opacity) {
        dispatch({ type: "set-layer-opacity", id: layer.id, opacity })
      }
    }
    requestRender()
    if (record) window.setTimeout(() => commit("Apply Timeline Frame", "all"), 0)
  }

  const updateFrame = (id: string, patch: Partial<TimelineFrame>) => {
    setFrames(frames.map((frame) => (frame.id === id ? { ...frame, ...patch } : frame)))
  }

  const exportFrames = () => {
    if (!frames.length) return
    frames.forEach((frame, idx) => {
      const canvas = renderDocumentComposite(docWithFrame(doc, frame), { transparent: true })
      downloadDataUrl(canvas.toDataURL("image/png"), `${doc.name}-frame-${String(idx + 1).padStart(2, "0")}.png`)
    })
    toast.success(`Exported ${frames.length} frame${frames.length === 1 ? "" : "s"}`)
  }

  const exportManifest = () => {
    if (!frames.length) return
    downloadText(
      JSON.stringify(
        {
          document: doc.name,
          width: doc.width,
          height: doc.height,
          exportedAt: new Date().toISOString(),
          frames: frames.map((frame, index) => ({
            index,
            name: frame.name,
            durationMs: frame.durationMs,
            transition: frame.transition ?? "hold",
            audioLabel: frame.audioLabel ?? "",
            layerVisibility: frame.layerVisibility,
            layerOpacity: frame.layerOpacity ?? {},
          })),
        },
        null,
        2,
      ),
      `${doc.name}-timeline.json`,
      "application/json",
    )
  }

  const exportContactSheet = () => {
    if (!frames.length) return
    const cols = Math.ceil(Math.sqrt(frames.length))
    const thumbW = 220
    const thumbH = Math.max(1, Math.round((thumbW / doc.width) * doc.height))
    const labelH = 22
    const gap = 18
    const pad = 24
    const rows = Math.ceil(frames.length / cols)
    const canvas = document.createElement("canvas")
    canvas.width = pad * 2 + cols * thumbW + (cols - 1) * gap
    canvas.height = pad * 2 + rows * (thumbH + labelH) + (rows - 1) * gap
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = "#171717"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.font = "12px sans-serif"
    frames.forEach((frame, index) => {
      const col = index % cols
      const row = Math.floor(index / cols)
      const x = pad + col * (thumbW + gap)
      const y = pad + row * (thumbH + labelH + gap)
      const frameCanvas = renderDocumentComposite(docWithFrame(doc, frame), { transparent: true })
      ctx.fillStyle = "#fff"
      ctx.fillRect(x, y, thumbW, thumbH)
      ctx.drawImage(frameCanvas, x, y, thumbW, thumbH)
      ctx.fillStyle = "#d4d4d4"
      ctx.fillText(`${index + 1}. ${frame.name} (${frame.durationMs}ms)`, x, y + thumbH + 15)
    })
    downloadDataUrl(canvas.toDataURL("image/png"), `${doc.name}-timeline-contact-sheet.png`)
  }

  const tweenToNext = () => {
    if (!selected || frames.length < 2) return
    const index = frames.findIndex((frame) => frame.id === selected.id)
    const next = frames[index + 1]
    if (!next) return
    const tweens: TimelineFrame[] = []
    const steps = 3
    for (let step = 1; step <= steps; step++) {
      const t = step / (steps + 1)
      const layerOpacity = Object.fromEntries(
        doc.layers.map((layer) => {
          const from = selected.layerOpacity?.[layer.id] ?? (selected.layerVisibility[layer.id] ? 1 : 0)
          const to = next.layerOpacity?.[layer.id] ?? (next.layerVisibility[layer.id] ? 1 : 0)
          return [layer.id, from + (to - from) * t]
        }),
      )
      const layerVisibility = Object.fromEntries(
        doc.layers.map((layer) => [layer.id, (layerOpacity[layer.id] as number) > 0.01]),
      )
      tweens.push({
        id: `frame_${Math.random().toString(36).slice(2, 9)}`,
        name: `${selected.name} tween ${step}`,
        durationMs: Math.round((selected.durationMs + next.durationMs) / 2),
        layerVisibility,
        layerOpacity: layerOpacity as Record<string, number>,
        transition: "dissolve",
      })
    }
    setFrames([...frames.slice(0, index + 1), ...tweens, ...frames.slice(index + 1)])
    toast.success("Inserted 3 tween frames")
  }

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="flex items-center gap-1 border-b border-[var(--ps-divider)] p-2">
        <ToolButton title="Capture frame" onClick={captureFrame}><Plus className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton title={playing ? "Stop playback" : "Play timeline"} disabled={!frames.length} onClick={() => setPlaying((v) => !v)}>
          <Play className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="Export frame sequence" disabled={!frames.length} onClick={exportFrames}><Download className="h-3.5 w-3.5" /></ToolButton>
        <button
          type="button"
          disabled={!selected || frames.findIndex((frame) => frame.id === selected.id) === frames.length - 1}
          onClick={tweenToNext}
          className="h-7 rounded-sm px-2 text-[10px] hover:bg-[var(--ps-tool-hover)] disabled:cursor-default disabled:opacity-40"
        >
          Tween
        </button>
        <button
          type="button"
          disabled={!frames.length}
          onClick={exportContactSheet}
          className="h-7 rounded-sm px-2 text-[10px] hover:bg-[var(--ps-tool-hover)] disabled:cursor-default disabled:opacity-40"
        >
          Sheet
        </button>
        <button
          type="button"
          disabled={!frames.length}
          onClick={exportManifest}
          className="h-7 rounded-sm px-2 text-[10px] hover:bg-[var(--ps-tool-hover)] disabled:cursor-default disabled:opacity-40"
        >
          JSON
        </button>
        <span className="ml-auto text-[10px] text-[var(--ps-text-dim)]">{frames.length} frame{frames.length === 1 ? "" : "s"}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {frames.length === 0 ? (
          <PanelEmpty text="Capture layer visibility states as animation frames." />
        ) : (
          frames.map((frame, idx) => (
            <div
              key={frame.id}
              className={`grid grid-cols-[34px_1fr_auto] gap-2 border-b border-[var(--ps-divider)] p-2 ${frame.id === selected?.id ? "bg-[var(--ps-tool-active)]" : ""}`}
              onClick={() => setSelectedId(frame.id)}
            >
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] hover:bg-[var(--ps-tool-hover)]"
                onClick={(e) => {
                  e.stopPropagation()
                  applyFrame(frame)
                }}
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
              <div className="min-w-0 space-y-1">
                <input
                  value={frame.name}
                  onChange={(e) => updateFrame(frame.id, { name: e.target.value })}
                  className="h-5 w-full bg-transparent text-[11px] outline-none focus:bg-[var(--ps-panel-2)]"
                />
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[var(--ps-text-dim)]">#{idx + 1}</span>
                  <input
                    type="number"
                    min={50}
                    max={10000}
                    step={50}
                    value={frame.durationMs}
                    onChange={(e) => updateFrame(frame.id, { durationMs: Math.max(50, Number(e.target.value) || 500) })}
                    className="h-5 w-20 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
                  />
                  <span className="text-[10px] text-[var(--ps-text-dim)]">ms</span>
                  <select
                    aria-label={`Transition for ${frame.name}`}
                    value={frame.transition ?? "hold"}
                    onChange={(e) => updateFrame(frame.id, { transition: e.target.value as TimelineFrame["transition"] })}
                    className="h-5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
                  >
                    <option value="hold">Hold</option>
                    <option value="dissolve">Dissolve</option>
                  </select>
                </div>
                <input
                  aria-label={`Audio cue for ${frame.name}`}
                  value={frame.audioLabel ?? ""}
                  onChange={(e) => updateFrame(frame.id, { audioLabel: e.target.value })}
                  placeholder="Audio cue / note"
                  className="h-5 w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px] outline-none"
                />
              </div>
              <div className="flex items-center gap-1">
                <ToolButton
                  title="Duplicate frame"
                  onClick={(e) => {
                    e?.stopPropagation()
                    const copy = { ...frame, id: `frame_${Math.random().toString(36).slice(2, 9)}`, name: `${frame.name} copy` }
                    setFrames([...frames.slice(0, idx + 1), copy, ...frames.slice(idx + 1)])
                    setSelectedId(copy.id)
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </ToolButton>
                <ToolButton
                  title="Delete frame"
                  onClick={(e) => {
                    e?.stopPropagation()
                    setFrames(frames.filter((item) => item.id !== frame.id))
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </ToolButton>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function ToolButton({
  children,
  title,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  title: string
  disabled?: boolean
  onClick: (event?: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-sm hover:bg-[var(--ps-tool-hover)] disabled:cursor-default disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function PanelEmpty({ text }: { text: string }) {
  return <div className="px-4 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">{text}</div>
}
