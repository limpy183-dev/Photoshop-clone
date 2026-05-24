"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Copy,
  Download,
  Eye,
  FilmIcon,
  Play,
  Plus,
  RefreshCcw,
  Square,
  Trash2,
} from "lucide-react"
import { useEditor } from "../editor-context"
import {
  downloadDataUrl,
  downloadText,
  renderDocumentComposite,
} from "../document-io"
import {
  DEFAULT_TIMELINE_SETTINGS,
  IDENTITY_TRANSFORM,
  applyFrameToLayers,
  buildDocumentForFrame,
  captureFrameFromDocument,
  distributeDurations,
  generateTweenFrames,
  makeFramesFromLayers,
  moveFrame,
  renderOnionSkinOverlay,
  renderTimelineFrameComposite,
  reverseFrames,
  setDurationsFromFps,
} from "../timeline-engine"
import {
  bytesToDataUrl,
  collectAnimationFrames,
  encodeAnimatedGif,
  encodeAnimatedWebP,
  encodeApngFromFrames,
  exportTimelineFrameAsPngBlob,
  resolveTimelineSettings,
} from "../animation-encoding"
import type {
  FrameEasing,
  FrameLayerTransform,
  Layer,
  OnionSkinSettings,
  PsDocument,
  TimelineFrame,
  TimelineSettings,
} from "../types"
import { uid } from "../uid"

type AnimationFormat = "gif" | "apng" | "animated-webp"

const EASINGS: FrameEasing[] = ["hold", "linear", "ease-in", "ease-out", "ease-in-out"]
const TINTS: NonNullable<OnionSkinSettings["tint"]>[] = ["none", "red-cyan", "red-blue", "green-red", "mono"]

export function TimelinePanel() {
  const { activeDoc, activeLayer, dispatch, commit, requestRender } = useEditor()
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [selection, setSelection] = React.useState<Set<string>>(new Set())
  const [playing, setPlaying] = React.useState(false)
  const [tweenOpen, setTweenOpen] = React.useState(false)
  const [exportBusy, setExportBusy] = React.useState<AnimationFormat | null>(null)
  const [showTransform, setShowTransform] = React.useState(false)

  const frames = React.useMemo(() => activeDoc?.timelineFrames ?? [], [activeDoc?.timelineFrames])
  const settings = React.useMemo<TimelineSettings>(
    () => activeDoc?.timelineSettings ?? DEFAULT_TIMELINE_SETTINGS,
    [activeDoc?.timelineSettings],
  )

  const selectedIndex = React.useMemo(() => {
    if (!selectedId) return -1
    return frames.findIndex((frame) => frame.id === selectedId)
  }, [frames, selectedId])
  const selected = selectedIndex >= 0 ? frames[selectedIndex] : frames[0] ?? null
  const effectiveIndex = selected ? Math.max(0, frames.findIndex((frame) => frame.id === selected.id)) : -1

  const applyFrame = React.useCallback(
    (frame: TimelineFrame, record = true) => {
      if (!activeDoc) return
      const next = applyFrameToLayers(activeDoc.layers, frame)
      for (let i = 0; i < activeDoc.layers.length; i++) {
        const layer = activeDoc.layers[i]
        const updated = next[i]
        if (updated.visible !== layer.visible) {
          dispatch({ type: "set-layer-visibility", id: layer.id, visible: updated.visible })
        }
        if ((updated.opacity ?? 1) !== layer.opacity) {
          dispatch({ type: "set-layer-opacity", id: layer.id, opacity: updated.opacity })
        }
        if ((updated.fillOpacity ?? 1) !== (layer.fillOpacity ?? 1)) {
          dispatch({ type: "set-layer-fill-opacity", id: layer.id, fillOpacity: updated.fillOpacity ?? 1 })
        }
        if (updated.blendMode !== layer.blendMode) {
          dispatch({ type: "set-layer-blend", id: layer.id, blendMode: updated.blendMode })
        }
        if ((updated.style ?? null) !== (layer.style ?? null)) {
          dispatch({ type: "set-layer-style", id: layer.id, style: updated.style })
        }
      }
      requestRender()
      if (record) window.setTimeout(() => commit("Apply Timeline Frame", "all"), 0)
    },
    [activeDoc, commit, dispatch, requestRender],
  )

  React.useEffect(() => {
    if (!playing || !activeDoc || frames.length === 0) return
    let cancelled = false
    let index = Math.max(0, effectiveIndex)
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
  }, [playing, activeDoc, frames, effectiveIndex, applyFrame])

  if (!activeDoc) return <PanelEmpty text="No document open" />
  const doc = activeDoc

  const updateSettings = (patch: Partial<TimelineSettings>) => {
    dispatch({
      type: "set-timeline-settings",
      settings: {
        ...settings,
        ...patch,
        onionSkin: patch.onionSkin ? { ...settings.onionSkin, ...patch.onionSkin } : settings.onionSkin,
      } as TimelineSettings,
    })
  }

  const setFrames = (next: TimelineFrame[], commitLabel?: string) => {
    dispatch({ type: "set-timeline-frames", frames: next })
    if (commitLabel) window.setTimeout(() => commit(commitLabel, "all"), 0)
  }

  const captureFrame = () => {
    const frame = captureFrameFromDocument(doc)
    setFrames([...frames, frame], "Capture Timeline Frame")
    setSelectedId(frame.id)
  }

  const replaceSelectedWithCapture = () => {
    if (!selected) return
    const captured = captureFrameFromDocument(doc, selected.name)
    setFrames(
      frames.map((f) => (f.id === selected.id ? { ...captured, id: selected.id, durationMs: selected.durationMs } : f)),
      "Update Timeline Frame",
    )
  }

  const updateFrame = (id: string, patch: Partial<TimelineFrame>) => {
    setFrames(frames.map((frame) => (frame.id === id ? { ...frame, ...patch } : frame)))
  }

  const removeFrames = (ids: string[]) => {
    if (!ids.length) return
    const set = new Set(ids)
    setFrames(frames.filter((frame) => !set.has(frame.id)), "Delete Timeline Frames")
    setSelection(new Set())
  }

  const duplicateFrame = (idx: number) => {
    const original = frames[idx]
    if (!original) return
    const copy: TimelineFrame = { ...original, id: uid("frame"), name: `${original.name} copy` }
    setFrames([...frames.slice(0, idx + 1), copy, ...frames.slice(idx + 1)], "Duplicate Frame")
    setSelectedId(copy.id)
  }

  const reorder = (idx: number, delta: number) => {
    const target = idx + delta
    if (target < 0 || target >= frames.length) return
    setFrames(moveFrame(frames, idx, target), "Reorder Frames")
  }

  const bulkSetDuration = (durationMs: number) => {
    const ids = selection.size ? selection : new Set(frames.map((f) => f.id))
    setFrames(
      frames.map((frame) => (ids.has(frame.id) ? { ...frame, durationMs: Math.max(20, Math.round(durationMs)) } : frame)),
      "Set Frame Duration",
    )
  }

  const exportFrameSequence = () => {
    if (!frames.length) return
    frames.forEach((frame, idx) => {
      const canvas = renderTimelineFrameComposite(doc, frame, { transparent: true })
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
          settings,
          frames: frames.map((frame, index) => ({
            index,
            name: frame.name,
            durationMs: frame.durationMs,
            transition: frame.transition ?? "hold",
            easing: frame.easing ?? "linear",
            audioLabel: frame.audioLabel ?? "",
            layerVisibility: frame.layerVisibility,
            layerOpacity: frame.layerOpacity ?? {},
            layerFillOpacity: frame.layerFillOpacity ?? {},
            layerBlend: frame.layerBlend ?? {},
            layerTransform: frame.layerTransform ?? {},
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
      const frameCanvas = renderTimelineFrameComposite(doc, frame, { transparent: true })
      ctx.fillStyle = "#fff"
      ctx.fillRect(x, y, thumbW, thumbH)
      ctx.drawImage(frameCanvas, x, y, thumbW, thumbH)
      ctx.fillStyle = "#d4d4d4"
      ctx.fillText(`${index + 1}. ${frame.name} (${frame.durationMs}ms)`, x, y + thumbH + 15)
    })
    downloadDataUrl(canvas.toDataURL("image/png"), `${doc.name}-timeline-contact-sheet.png`)
  }

  const exportAnimation = async (format: AnimationFormat) => {
    if (!frames.length) {
      toast.error("Capture at least one frame first")
      return
    }
    setExportBusy(format)
    try {
      const animFrames = collectAnimationFrames(doc, { transparent: true })
      const loopCount = resolveTimelineSettings(doc).loopCount
      let bytes: Uint8Array
      let mime: string
      let ext: string
      if (format === "gif") {
        bytes = encodeAnimatedGif(animFrames, { transparent: true, loopCount })
        mime = "image/gif"
        ext = "gif"
      } else if (format === "apng") {
        bytes = await encodeApngFromFrames(animFrames, { loopCount })
        mime = "image/apng"
        ext = "png"
      } else {
        bytes = await encodeAnimatedWebP(animFrames, { transparent: true, loopCount, quality: 0.9 })
        mime = "image/webp"
        ext = "webp"
      }
      downloadDataUrl(bytesToDataUrl(bytes, mime), `${doc.name}.${ext}`)
      toast.success(`${format.toUpperCase()} exported (${frames.length} frames)`)
    } catch (err) {
      toast.error(`${format} export failed: ${(err as Error).message}`)
    } finally {
      setExportBusy(null)
    }
  }

  const insertTween = (toIndex: number, opts: { steps: number; easing: FrameEasing; props: Record<string, boolean> }) => {
    if (toIndex <= 0) return
    const from = frames[toIndex - 1]
    const to = frames[toIndex]
    if (!from || !to) return
    const tweens = generateTweenFrames(from, to, {
      steps: opts.steps,
      easing: opts.easing,
      properties: {
        opacity: opts.props.opacity !== false,
        transform: opts.props.transform !== false,
        style: opts.props.style !== false,
        visibility: opts.props.visibility !== false,
      },
    })
    if (!tweens.length) return
    setFrames([...frames.slice(0, toIndex), ...tweens, ...frames.slice(toIndex)], "Insert Tween Frames")
    toast.success(`Inserted ${tweens.length} tween frame${tweens.length === 1 ? "" : "s"}`)
  }

  const buildFromLayers = () => {
    const next = makeFramesFromLayers(doc)
    if (!next.length) {
      toast.error("Document has no non-group layers to convert")
      return
    }
    setFrames(next, "Make Frames From Layers")
  }

  const setVideoPosterFromFrame = async (frame: TimelineFrame) => {
    const targets = doc.layers.filter((layer) => layer.kind === "video")
    if (!targets.length) {
      toast.error("No video layers in document")
      return
    }
    const layer = (activeLayer && activeLayer.kind === "video" ? activeLayer : targets[0]) as Layer
    if (!layer.video) return
    const blob = await exportTimelineFrameAsPngBlob(frame, doc)
    const dataUrl = await blobToDataUrl(blob)
    dispatch({
      type: "set-layer-video",
      id: layer.id,
      video: { ...layer.video, posterDataUrl: dataUrl },
    })
    window.setTimeout(() => commit("Set Video Poster", [layer.id]), 0)
    toast.success(`Set poster for "${layer.name}"`)
  }

  const onionSkinPreview = () => {
    const overlay = renderOnionSkinOverlay(doc, frames, effectiveIndex, settings.onionSkin ?? DEFAULT_TIMELINE_SETTINGS.onionSkin!)
    if (!overlay) {
      toast.error("Onion skin is disabled or unavailable")
      return
    }
    downloadDataUrl(overlay.toDataURL("image/png"), `${doc.name}-onion-skin.png`)
    toast.success("Saved onion-skin overlay")
  }

  const updateLayerTransform = (layerId: string, patch: Partial<FrameLayerTransform>) => {
    if (!selected) return
    const existing = selected.layerTransform?.[layerId] ?? IDENTITY_TRANSFORM
    const next = { ...existing, ...patch }
    const layerTransform = { ...(selected.layerTransform ?? {}), [layerId]: next }
    updateFrame(selected.id, { layerTransform })
  }

  const onion = settings.onionSkin ?? DEFAULT_TIMELINE_SETTINGS.onionSkin!

  return (
    <div className="flex h-full flex-col text-[11px] text-[var(--ps-text)]">
      <div className="flex items-center gap-1 border-b border-[var(--ps-divider)] p-2">
        <ToolButton title="Capture frame" onClick={captureFrame}><Plus className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton title="Replace selected frame with current state" disabled={!selected} onClick={replaceSelectedWithCapture}>
          <Camera className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title={playing ? "Stop playback" : "Play timeline"} disabled={!frames.length} onClick={() => setPlaying((v) => !v)}>
          {playing ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </ToolButton>
        <ToolButton title="Reverse frame order" disabled={frames.length < 2} onClick={() => setFrames(reverseFrames(frames), "Reverse Frames")}>
          <RefreshCcw className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="Export frame sequence" disabled={!frames.length} onClick={exportFrameSequence}>
          <Download className="h-3.5 w-3.5" />
        </ToolButton>
        <TextBtn disabled={frames.length < 2} onClick={() => setTweenOpen(true)}>Tween…</TextBtn>
        <TextBtn disabled={!frames.length} onClick={exportContactSheet}>Sheet</TextBtn>
        <TextBtn disabled={!frames.length} onClick={exportManifest}>JSON</TextBtn>
        <TextBtn onClick={buildFromLayers}>From Layers</TextBtn>
        <span className="ml-auto text-[10px] text-[var(--ps-text-dim)]">{frames.length} frame{frames.length === 1 ? "" : "s"}</span>
      </div>

      {/* Animation export bar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--ps-divider)] px-2 py-1.5">
        <span className="text-[10px] text-[var(--ps-text-dim)]">Export:</span>
        <TextBtn disabled={!frames.length || exportBusy !== null} onClick={() => exportAnimation("gif")}>
          {exportBusy === "gif" ? "GIF…" : "GIF"}
        </TextBtn>
        <TextBtn disabled={!frames.length || exportBusy !== null} onClick={() => exportAnimation("apng")}>
          {exportBusy === "apng" ? "APNG…" : "APNG"}
        </TextBtn>
        <TextBtn disabled={!frames.length || exportBusy !== null} onClick={() => exportAnimation("animated-webp")}>
          {exportBusy === "animated-webp" ? "WebP…" : "WebP"}
        </TextBtn>
        <span className="mx-2 text-[10px] text-[var(--ps-text-dim)]">FPS</span>
        <input
          type="number"
          min={1}
          max={60}
          value={settings.fps}
          onChange={(e) => updateSettings({ fps: Math.max(1, Math.min(60, Number(e.target.value) || 12)) })}
          className="h-5 w-12 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          aria-label="Timeline FPS"
        />
        <TextBtn disabled={!frames.length} onClick={() => setFrames(setDurationsFromFps(frames, settings.fps), "FPS Durations")}>
          Apply
        </TextBtn>
        <span className="mx-2 text-[10px] text-[var(--ps-text-dim)]">Loop</span>
        <input
          type="number"
          min={0}
          max={9999}
          value={settings.loopCount}
          onChange={(e) => updateSettings({ loopCount: Math.max(0, Math.min(9999, Number(e.target.value) || 0)) })}
          className="h-5 w-14 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          aria-label="Animation loop count (0 = infinite)"
        />
        <span className="text-[10px] text-[var(--ps-text-dim)]">{settings.loopCount === 0 ? "∞" : "×"}</span>
      </div>

      {/* Onion skin & video poster bar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--ps-divider)] px-2 py-1.5">
        <label className="flex items-center gap-1 text-[10px] text-[var(--ps-text-dim)]">
          <input
            type="checkbox"
            checked={onion.enabled}
            onChange={(e) => updateSettings({ onionSkin: { ...onion, enabled: e.target.checked } })}
          />
          Onion skin
        </label>
        <span className="text-[10px] text-[var(--ps-text-dim)]">Before</span>
        <input
          type="number"
          min={0}
          max={10}
          value={onion.before}
          onChange={(e) => updateSettings({ onionSkin: { ...onion, before: Math.max(0, Math.min(10, Number(e.target.value) || 0)) } })}
          className="h-5 w-10 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          aria-label="Onion skin frames before"
        />
        <span className="text-[10px] text-[var(--ps-text-dim)]">After</span>
        <input
          type="number"
          min={0}
          max={10}
          value={onion.after}
          onChange={(e) => updateSettings({ onionSkin: { ...onion, after: Math.max(0, Math.min(10, Number(e.target.value) || 0)) } })}
          className="h-5 w-10 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          aria-label="Onion skin frames after"
        />
        <span className="text-[10px] text-[var(--ps-text-dim)]">Opacity</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round((onion.opacity ?? 0.35) * 100)}
          onChange={(e) => updateSettings({ onionSkin: { ...onion, opacity: Math.max(0, Math.min(1, Number(e.target.value) / 100)) } })}
          className="h-5 w-24"
          aria-label="Onion skin opacity"
        />
        <select
          aria-label="Onion skin tint"
          value={onion.tint ?? "none"}
          onChange={(e) => updateSettings({ onionSkin: { ...onion, tint: e.target.value as OnionSkinSettings["tint"] } })}
          className="h-5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
        >
          {TINTS.map((tint) => (
            <option key={tint} value={tint}>
              {tint}
            </option>
          ))}
        </select>
        <TextBtn disabled={!onion.enabled || !frames.length} onClick={onionSkinPreview}>Save overlay</TextBtn>
        <TextBtn disabled={!selected || doc.layers.every((l) => l.kind !== "video")} onClick={() => selected && setVideoPosterFromFrame(selected)}>
          <FilmIcon className="mr-1 inline h-3 w-3" />Poster
        </TextBtn>
      </div>

      {/* Bulk-edit bar (multi-select) */}
      {selection.size > 0 ? (
        <div className="flex items-center gap-1 border-b border-[var(--ps-divider)] bg-[var(--ps-panel-2)]/40 px-2 py-1.5">
          <span className="text-[10px] text-[var(--ps-text-dim)]">{selection.size} selected</span>
          <span className="mx-1 text-[10px] text-[var(--ps-text-dim)]">Duration</span>
          <input
            type="number"
            min={20}
            max={10000}
            step={20}
            defaultValue={500}
            onBlur={(e) => bulkSetDuration(Number(e.target.value) || 500)}
            className="h-5 w-16 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
            aria-label="Bulk duration in milliseconds"
          />
          <TextBtn onClick={() => {
            const totalMs = Math.max(100, selection.size * 200)
            setFrames(distributeDurations(frames.filter((f) => selection.has(f.id)), totalMs).concat(frames.filter((f) => !selection.has(f.id))), "Distribute Durations")
          }}>Distribute</TextBtn>
          <TextBtn onClick={() => removeFrames(Array.from(selection))}>Delete</TextBtn>
          <TextBtn onClick={() => setSelection(new Set())}>Clear</TextBtn>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {frames.length === 0 ? (
          <PanelEmpty text="Capture layer visibility, opacity, transforms and styles as animation frames." />
        ) : (
          frames.map((frame, idx) => (
            <FrameRow
              key={frame.id}
              doc={doc}
              frame={frame}
              index={idx}
              total={frames.length}
              isSelected={frame.id === selected?.id}
              isMultiSelected={selection.has(frame.id)}
              onSelect={(multi) => {
                if (multi) {
                  setSelection((prev) => {
                    const next = new Set(prev)
                    if (next.has(frame.id)) next.delete(frame.id)
                    else next.add(frame.id)
                    return next
                  })
                } else {
                  setSelectedId(frame.id)
                }
              }}
              onApply={() => applyFrame(frame)}
              onChange={(patch) => updateFrame(frame.id, patch)}
              onDuplicate={() => duplicateFrame(idx)}
              onDelete={() => removeFrames([frame.id])}
              onMoveUp={() => reorder(idx, -1)}
              onMoveDown={() => reorder(idx, +1)}
            />
          ))
        )}
      </div>

      {selected && showTransform ? (
        <TransformPanel
          doc={doc}
          frame={selected}
          onUpdateTransform={updateLayerTransform}
          onClose={() => setShowTransform(false)}
        />
      ) : null}
      {selected ? (
        <div className="border-t border-[var(--ps-divider)] px-2 py-1.5">
          <TextBtn onClick={() => setShowTransform((v) => !v)}>
            {showTransform ? "Hide" : "Show"} transform keyframes
          </TextBtn>
        </div>
      ) : null}

      {tweenOpen ? (
        <TweenDialog
          totalFrames={frames.length}
          defaultToIndex={effectiveIndex > 0 ? effectiveIndex : Math.min(1, frames.length - 1)}
          onClose={() => setTweenOpen(false)}
          onApply={(toIndex, opts) => {
            insertTween(toIndex, opts)
            setTweenOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

function FrameRow({
  doc,
  frame,
  index,
  total,
  isSelected,
  isMultiSelected,
  onSelect,
  onApply,
  onChange,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  doc: PsDocument
  frame: TimelineFrame
  index: number
  total: number
  isSelected: boolean
  isMultiSelected: boolean
  onSelect: (multi: boolean) => void
  onApply: () => void
  onChange: (patch: Partial<TimelineFrame>) => void
  onDuplicate: () => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const thumbRef = React.useRef<HTMLCanvasElement | null>(null)

  React.useEffect(() => {
    const canvas = thumbRef.current
    if (!canvas) return
    const projected = buildDocumentForFrame(doc, frame)
    const rendered = renderDocumentComposite(projected, { transparent: true })
    const target = canvas
    const maxDim = 48
    const scale = Math.min(maxDim / rendered.width, maxDim / rendered.height, 1)
    target.width = Math.max(1, Math.round(rendered.width * scale))
    target.height = Math.max(1, Math.round(rendered.height * scale))
    const ctx = target.getContext("2d")
    if (!ctx) return
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.clearRect(0, 0, target.width, target.height)
    ctx.drawImage(rendered, 0, 0, target.width, target.height)
  }, [doc, frame])

  const highlight = isSelected
    ? "bg-[var(--ps-tool-active)]"
    : isMultiSelected
    ? "bg-[var(--ps-tool-hover)]"
    : ""

  return (
    <div
      className={`grid grid-cols-[18px_56px_1fr_auto] gap-2 border-b border-[var(--ps-divider)] p-2 ${highlight}`}
      onClick={(e) => onSelect(e.metaKey || e.ctrlKey || e.shiftKey)}
    >
      <div className="flex flex-col items-center justify-center gap-0.5 text-[var(--ps-text-dim)]">
        <button
          type="button"
          title="Move up"
          aria-label={`Move ${frame.name} up`}
          disabled={index === 0}
          onClick={(e) => {
            e.stopPropagation()
            onMoveUp()
          }}
          className="opacity-60 hover:opacity-100 disabled:opacity-20"
        >
          <ArrowUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          title="Move down"
          aria-label={`Move ${frame.name} down`}
          disabled={index === total - 1}
          onClick={(e) => {
            e.stopPropagation()
            onMoveDown()
          }}
          className="opacity-60 hover:opacity-100 disabled:opacity-20"
        >
          <ArrowDown className="h-3 w-3" />
        </button>
      </div>

      <button
        type="button"
        className="relative flex h-12 w-14 items-center justify-center rounded-sm border border-[var(--ps-divider)] bg-[#0a0a0a] hover:bg-[var(--ps-tool-hover)]"
        onClick={(e) => {
          e.stopPropagation()
          onApply()
        }}
        title={`Apply ${frame.name} to canvas`}
      >
        <canvas ref={thumbRef} className="max-h-12 max-w-14 object-contain" />
        <Eye className="absolute right-0.5 top-0.5 h-2.5 w-2.5 text-white/60" />
      </button>

      <div className="min-w-0 space-y-1">
        <input
          value={frame.name}
          onChange={(e) => onChange({ name: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          className="h-5 w-full bg-transparent text-[11px] outline-none focus:bg-[var(--ps-panel-2)]"
          aria-label={`Name for frame ${index + 1}`}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-[var(--ps-text-dim)]">#{index + 1}</span>
          <input
            type="number"
            min={20}
            max={10000}
            step={50}
            value={frame.durationMs}
            onChange={(e) => onChange({ durationMs: Math.max(20, Number(e.target.value) || 500) })}
            onClick={(e) => e.stopPropagation()}
            className="h-5 w-16 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
            aria-label={`Duration ms for ${frame.name}`}
          />
          <span className="text-[10px] text-[var(--ps-text-dim)]">ms</span>
          <select
            aria-label={`Transition for ${frame.name}`}
            value={frame.transition ?? "hold"}
            onChange={(e) => onChange({ transition: e.target.value as TimelineFrame["transition"] })}
            onClick={(e) => e.stopPropagation()}
            className="h-5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          >
            <option value="hold">Hold</option>
            <option value="dissolve">Dissolve</option>
            <option value="cross-dissolve">Cross-dissolve</option>
            <option value="fade-black">Fade-black</option>
            <option value="fade-white">Fade-white</option>
            <option value="wipe-left">Wipe-left</option>
            <option value="wipe-right">Wipe-right</option>
          </select>
          <select
            aria-label={`Easing for ${frame.name}`}
            value={frame.easing ?? "linear"}
            onChange={(e) => onChange({ easing: e.target.value as FrameEasing })}
            onClick={(e) => e.stopPropagation()}
            className="h-5 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          >
            {EASINGS.map((easing) => (
              <option key={easing} value={easing}>
                {easing}
              </option>
            ))}
          </select>
        </div>
        <input
          aria-label={`Audio cue for ${frame.name}`}
          value={frame.audioLabel ?? ""}
          onChange={(e) => onChange({ audioLabel: e.target.value })}
          onClick={(e) => e.stopPropagation()}
          placeholder="Audio cue / note"
          className="h-5 w-full rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px] outline-none"
        />
      </div>
      <div className="flex items-center gap-1">
        <ToolButton
          title="Duplicate frame"
          onClick={(e) => {
            e?.stopPropagation()
            onDuplicate()
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          title="Delete frame"
          onClick={(e) => {
            e?.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </ToolButton>
      </div>
    </div>
  )
}

function TransformPanel({
  doc,
  frame,
  onUpdateTransform,
  onClose,
}: {
  doc: PsDocument
  frame: TimelineFrame
  onUpdateTransform: (layerId: string, patch: Partial<FrameLayerTransform>) => void
  onClose: () => void
}) {
  const editable = doc.layers.filter((layer) => layer.kind !== "group")
  return (
    <div className="max-h-48 overflow-y-auto border-t border-[var(--ps-divider)] bg-[var(--ps-panel-2)]/40 p-2 text-[10px]">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] text-[var(--ps-text-dim)]">Transform keyframes — {frame.name}</span>
        <TextBtn onClick={onClose}>Close</TextBtn>
      </div>
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="text-left text-[var(--ps-text-dim)]">
            <th className="w-32 pb-1">Layer</th>
            <th className="pb-1">tx</th>
            <th className="pb-1">ty</th>
            <th className="pb-1">sX</th>
            <th className="pb-1">sY</th>
            <th className="pb-1">rot°</th>
            <th className="pb-1 text-right">Reset</th>
          </tr>
        </thead>
        <tbody>
          {editable.map((layer) => {
            const t = frame.layerTransform?.[layer.id] ?? IDENTITY_TRANSFORM
            return (
              <tr key={layer.id} className="border-t border-[var(--ps-divider)]">
                <td className="truncate pr-2" title={layer.name}>{layer.name}</td>
                <td>
                  <TransformInput value={t.tx} onChange={(v) => onUpdateTransform(layer.id, { tx: v })} />
                </td>
                <td>
                  <TransformInput value={t.ty} onChange={(v) => onUpdateTransform(layer.id, { ty: v })} />
                </td>
                <td>
                  <TransformInput value={t.scaleX} step={0.05} onChange={(v) => onUpdateTransform(layer.id, { scaleX: v })} />
                </td>
                <td>
                  <TransformInput value={t.scaleY} step={0.05} onChange={(v) => onUpdateTransform(layer.id, { scaleY: v })} />
                </td>
                <td>
                  <TransformInput value={t.rotation} onChange={(v) => onUpdateTransform(layer.id, { rotation: v })} />
                </td>
                <td className="text-right">
                  <TextBtn onClick={() => onUpdateTransform(layer.id, { tx: 0, ty: 0, scaleX: 1, scaleY: 1, rotation: 0 })}>—</TextBtn>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TransformInput({ value, onChange, step = 1 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      step={step}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      onClick={(e) => e.stopPropagation()}
      className="h-5 w-16 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
    />
  )
}

function TweenDialog({
  totalFrames,
  defaultToIndex,
  onClose,
  onApply,
}: {
  totalFrames: number
  defaultToIndex: number
  onClose: () => void
  onApply: (toIndex: number, opts: { steps: number; easing: FrameEasing; props: Record<string, boolean> }) => void
}) {
  const [toIndex, setToIndex] = React.useState(Math.max(1, defaultToIndex))
  const [steps, setSteps] = React.useState(3)
  const [easing, setEasing] = React.useState<FrameEasing>("linear")
  const [opacity, setOpacity] = React.useState(true)
  const [transform, setTransform] = React.useState(true)
  const [style, setStyle] = React.useState(true)
  const [visibility, setVisibility] = React.useState(true)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-80 rounded-md border border-[var(--ps-divider)] bg-[var(--ps-panel)] p-3 text-[11px] shadow-2xl">
        <div className="mb-2 text-[12px] font-semibold">Insert Tween Frames</div>
        <div className="space-y-2">
          <Row label="Insert before frame">
            <input
              type="number"
              min={1}
              max={totalFrames - 1}
              value={toIndex}
              onChange={(e) => setToIndex(Math.max(1, Math.min(totalFrames - 1, Number(e.target.value) || 1)))}
              className="h-6 w-20 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1"
              aria-label="Insert-before frame index"
            />
          </Row>
          <Row label="Steps">
            <input
              type="number"
              min={1}
              max={60}
              value={steps}
              onChange={(e) => setSteps(Math.max(1, Math.min(60, Number(e.target.value) || 3)))}
              className="h-6 w-20 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1"
              aria-label="Number of tween steps"
            />
          </Row>
          <Row label="Easing">
            <select
              aria-label="Tween easing"
              value={easing}
              onChange={(e) => setEasing(e.target.value as FrameEasing)}
              className="h-6 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1"
            >
              {EASINGS.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </Row>
          <div className="grid grid-cols-2 gap-1">
            <Toggle checked={opacity} onChange={setOpacity}>Opacity</Toggle>
            <Toggle checked={transform} onChange={setTransform}>Transform</Toggle>
            <Toggle checked={style} onChange={setStyle}>Layer style</Toggle>
            <Toggle checked={visibility} onChange={setVisibility}>Visibility</Toggle>
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <TextBtn onClick={onClose}>Cancel</TextBtn>
          <TextBtn onClick={() => onApply(toIndex, { steps, easing, props: { opacity, transform, style, visibility } })}>
            Insert
          </TextBtn>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-[var(--ps-text-dim)]">{label}</span>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (next: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1 text-[10px]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
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

function TextBtn({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  disabled?: boolean
  onClick: (event?: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-6 rounded-sm px-2 text-[10px] hover:bg-[var(--ps-tool-hover)] disabled:cursor-default disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function PanelEmpty({ text }: { text: string }) {
  return <div className="px-4 py-8 text-center text-[11px] text-[var(--ps-text-dim)]">{text}</div>
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("Read blob failed"))
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "")
    reader.readAsDataURL(blob)
  })
}
