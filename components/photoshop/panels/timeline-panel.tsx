"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  Camera,
  Download,
  FilmIcon,
  Play,
  Plus,
  RefreshCcw,
  Scissors,
  Square,
  X,
} from "lucide-react"
import { useEditor } from "../editor-context"
import { addPhotoshopEventListener, dispatchPhotoshopEvent } from "../events"
import { downloadBlob, downloadDataUrl, downloadText } from "../document-io"
import {
  DEFAULT_TIMELINE_SETTINGS,
  IDENTITY_TRANSFORM,
  applyFrameToLayers,
  captureFrameFromDocument,
  distributeDurations,
  generateTweenFrames,
  makeFramesFromVideoCanvases,
  makeFramesFromLayers,
  moveFrame,
  renderOnionSkinOverlay,
  renderTimelineFrameComposite,
  renderTimelineFrameWithTransition,
  reverseFrames,
  setDurationsFromFps,
  splitTimelineFrameAtPlayhead,
  transitionDurationForFrame,
  transitionProgressAtFrameTime,
  timelineDurationMs,
  timelineFrameIndexAtTime,
} from "../timeline-engine"
import {
  bytesToDataUrl,
  collectAnimationFramesAtFps,
  encodeAnimatedGifProgress,
  encodeAnimatedWebP,
  encodeApngFromFrames,
  exportTimelineFrameAsPngBlob,
  packagePngSequenceZip,
  resolveTimelineSettings,
} from "../animation-encoding"
import {
  audibleAudioTracks,
  buildFinalVideoExportPlan,
  buildMuxedAudioStreamSchedule,
  buildVideoClipTrackState,
  buildVideoThumbnailPlan,
  extractVideoThumbnailStrip,
  renderAudioMixToWavBlob,
  renderVideoTransitionPreview,
  resolveVideoExportPreset,
  splitVideoLayerAtPlayhead,
  trimVideoClipToFrame,
  type FinalVideoExportPlan,
  updateVideoTransitionDuration,
} from "../three-d-video-engine"
import type {
  AudioTrack,
  FrameEasing,
  FrameLayerTransform,
  Layer,
  OnionSkinSettings,
  TimelineFrame,
  TimelineSettings,
  VideoLayerProps,
} from "../types"
import { uid } from "../uid"
import { AudioMixerSection } from "./timeline/timeline-audio-mixer"
import {
  blobToDataUrl,
  buildTimelineVideoPackage,
  dataUrlToArrayBuffer,
  delay,
  safeFilePart,
} from "./timeline/timeline-export-utils"
import { PanelEmpty, TextBtn, TINTS, ToolButton } from "./timeline/timeline-shared"
import {
  TimelineBulkEditBar,
  TimelineFrameList,
  TimelinePlayheadSection,
} from "./timeline/timeline-panel-sections"
import { TransformPanel } from "./timeline/timeline-transform-panel"
import { TweenDialog } from "./timeline/timeline-tween-dialog"
import { VideoTrimTrack } from "./timeline/timeline-video-trim-track"

type AnimationFormat = "gif" | "apng" | "animated-webp"
type VideoThumbnail = { index: number; timeMs: number; label: string; dataUrl: string }

export function TimelinePanel() {
  const { activeDoc, activeLayer, dispatch, commit, requestRender } = useEditor()
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [selection, setSelection] = React.useState<Set<string>>(new Set())
  const [playing, setPlaying] = React.useState(false)
  const [tweenOpen, setTweenOpen] = React.useState(false)
  const [exportBusy, setExportBusy] = React.useState<AnimationFormat | null>(null)
  const [exportSequenceBusy, setExportSequenceBusy] = React.useState(false)
  const [muxBusy, setMuxBusy] = React.useState(false)
  const [showTransform, setShowTransform] = React.useState(false)
  const [timelinePlayheadMs, setTimelinePlayheadMs] = React.useState(0)
  const [videoPlayheadMs, setVideoPlayheadMs] = React.useState(0)
  const [videoThumbnails, setVideoThumbnails] = React.useState<VideoThumbnail[]>([])
  const [videoFrameCount, setVideoFrameCount] = React.useState(12)
  const [videoExtractBusy, setVideoExtractBusy] = React.useState(false)
  const [audioBusy, setAudioBusy] = React.useState(false)
  const [exportTransparent, setExportTransparent] = React.useState(true)
  const [exportScale, setExportScale] = React.useState(1)
  const [exportMatte, setExportMatte] = React.useState("#ffffff")
  const [webpQuality, setWebpQuality] = React.useState(0.9)
  const [exportProgress, setExportProgress] = React.useState<{ done: number; total: number; phase: string } | null>(null)
  const [renderVideoFps, setRenderVideoFps] = React.useState<number | null>(null)
  const [audioVuLevels, setAudioVuLevels] = React.useState<Record<string, number>>({})
  const [showAudioMixer, setShowAudioMixer] = React.useState(false)
  const transitionPreviewRef = React.useRef<HTMLCanvasElement | null>(null)
  const exportAbortRef = React.useRef<AbortController | null>(null)
  const muxAbortRef = React.useRef<AbortController | null>(null)
  const playbackOverlayCacheRef = React.useRef<Map<string, ImageBitmap>>(new Map())

  const frames = React.useMemo(() => activeDoc?.timelineFrames ?? [], [activeDoc?.timelineFrames])
  const settings = React.useMemo<TimelineSettings>(
    () => activeDoc?.timelineSettings ?? DEFAULT_TIMELINE_SETTINGS,
    [activeDoc?.timelineSettings],
  )
  const timelineFps = Math.max(1, Math.round(settings.fps || DEFAULT_TIMELINE_SETTINGS.fps))
  const videoLayers = React.useMemo(
    () => activeDoc?.layers.filter((layer) => layer.kind === "video" && layer.video) ?? [],
    [activeDoc?.layers],
  )
  const activeVideoLayer = React.useMemo(
    () => (activeLayer?.kind === "video" && activeLayer.video ? activeLayer : videoLayers[0] ?? null),
    [activeLayer, videoLayers],
  )
  const activeVideo = activeVideoLayer?.video ?? null
  const activeTransition = activeVideo?.transitions?.[0] ?? null
  const activeVideoTrackState = React.useMemo(
    () => (activeVideo ? buildVideoClipTrackState(activeVideo, videoPlayheadMs, { fps: timelineFps }) : null),
    [activeVideo, timelineFps, videoPlayheadMs],
  )
  const targetTransitionLayer = React.useMemo(() => {
    if (!activeDoc || !activeVideoLayer) return null
    if (activeTransition?.targetLayerId) {
      return activeDoc.layers.find((layer) => layer.id === activeTransition.targetLayerId && layer.canvas) ?? null
    }
    const start = activeDoc.layers.findIndex((layer) => layer.id === activeVideoLayer.id)
    return activeDoc.layers.slice(start + 1).find((layer) => layer.kind === "video" && layer.canvas) ?? null
  }, [activeDoc, activeTransition?.targetLayerId, activeVideoLayer])
  const audioTracks = React.useMemo<AudioTrack[]>(
    () => [
      ...frames.flatMap((frame) => frame.audioTracks ?? []),
      ...(activeDoc?.layers.flatMap((layer) => layer.video?.audioTracks ?? []) ?? []),
    ],
    [activeDoc?.layers, frames],
  )
  const audibleTracks = React.useMemo(() => audibleAudioTracks(audioTracks), [audioTracks])
  const anyTrackSolo = React.useMemo(
    () => audioTracks.some((track) => track.solo === true && !track.muted),
    [audioTracks],
  )

  const selectedIndex = React.useMemo(() => {
    if (!selectedId) return -1
    return frames.findIndex((frame) => frame.id === selectedId)
  }, [frames, selectedId])
  const selected = selectedIndex >= 0 ? frames[selectedIndex] : frames[0] ?? null
  const effectiveIndex = selected ? Math.max(0, frames.findIndex((frame) => frame.id === selected.id)) : -1
  const totalTimelineDurationMs = React.useMemo(() => timelineDurationMs(frames), [frames])
  const timelinePlayheadFrameIndex = React.useMemo(
    () => timelineFrameIndexAtTime(frames, timelinePlayheadMs),
    [frames, timelinePlayheadMs],
  )
  const finalVideoPreset = React.useMemo(
    () => resolveVideoExportPreset("social-1080p", { fps: timelineFps }),
    [timelineFps],
  )
  const finalVideoPlan = React.useMemo(
    () => buildFinalVideoExportPlan(finalVideoPreset, frames, audioTracks),
    [audioTracks, finalVideoPreset, frames],
  )

  React.useEffect(() => {
    setTimelinePlayheadMs((current) => Math.max(0, Math.min(current, totalTimelineDurationMs)))
  }, [totalTimelineDurationMs])

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
    let rafId = 0
    let startTs = 0
    let timeoutId = 0
    const docId = activeDoc.id
    const dispatchOverlay = (canvas: HTMLCanvasElement | null) => {
      dispatchPhotoshopEvent("ps-timeline-transition-overlay", { canvas, docId })
    }
    const stepFrame = () => {
      if (cancelled) return
      const frame = frames[index % frames.length]
      const next = frames[(index + 1) % frames.length] ?? null
      applyFrame(frame, false)
      setSelectedId(frame.id)
      const duration = Math.max(50, frame.durationMs)
      const transitionDuration = transitionDurationForFrame(frame)
      // Animate the transition between frame and next while the frame is on screen.
      startTs = performance.now()
      const hasTransition = transitionDuration > 0 && next
      const animateOverlay = () => {
        if (cancelled) return
        const elapsed = performance.now() - startTs
        if (!hasTransition) {
          dispatchOverlay(null)
          return
        }
        const progress = transitionProgressAtFrameTime(frame, elapsed)
        try {
          const composite = renderTimelineFrameWithTransition(activeDoc, frame, next, progress, {
            transparent: true,
          })
          dispatchOverlay(composite)
        } catch {
          // ignore drawing failures (canvas size mismatch, etc.)
        }
        if (elapsed < duration) {
          rafId = window.requestAnimationFrame(animateOverlay)
        }
      }
      if (hasTransition) {
        rafId = window.requestAnimationFrame(animateOverlay)
      } else {
        dispatchOverlay(null)
      }
      index++
      timeoutId = window.setTimeout(stepFrame, duration)
    }
    stepFrame()
    return () => {
      cancelled = true
      if (rafId) window.cancelAnimationFrame(rafId)
      if (timeoutId) window.clearTimeout(timeoutId)
      // Clear the overlay when playback stops.
      dispatchPhotoshopEvent("ps-timeline-transition-overlay", { canvas: null, docId })
    }
  }, [playing, activeDoc, frames, effectiveIndex, applyFrame])

  React.useEffect(() => {
    if (!activeVideo) {
      setVideoPlayheadMs(0)
      setVideoThumbnails([])
      return
    }
    setVideoPlayheadMs(activeVideo.currentTimeMs)
  }, [activeVideo, activeVideoLayer?.id])

  const setActiveVideo = React.useCallback(
    (video: VideoLayerProps, label?: string) => {
      if (!activeVideoLayer) return
      dispatch({ type: "set-layer-video", id: activeVideoLayer.id, video })
      requestRender()
      if (label) window.setTimeout(() => commit(label, [activeVideoLayer.id]), 0)
    },
    [activeVideoLayer, commit, dispatch, requestRender],
  )

  const setVideoPlayhead = React.useCallback(
    (timeMs: number, record = false) => {
      if (!activeVideo) return
      const snapped = Math.max(activeVideo.inPointMs, Math.min(activeVideo.outPointMs, Math.round(timeMs)))
      setVideoPlayheadMs(snapped)
      setActiveVideo({ ...activeVideo, currentTimeMs: snapped }, record ? "Set Video Playhead" : undefined)
    },
    [activeVideo, setActiveVideo],
  )

  const trimActiveVideo = React.useCallback(
    (inPointMs: number, outPointMs: number, label?: string) => {
      if (!activeVideo) return
      setActiveVideo(trimVideoClipToFrame(activeVideo, inPointMs, outPointMs, timelineFps), label)
    },
    [activeVideo, setActiveVideo, timelineFps],
  )

  const setVideoInPoint = React.useCallback(() => {
    if (!activeVideo) return
    trimActiveVideo(videoPlayheadMs, activeVideo.outPointMs, "Set Video In Point")
  }, [activeVideo, trimActiveVideo, videoPlayheadMs])

  const setVideoOutPoint = React.useCallback(() => {
    if (!activeVideo) return
    trimActiveVideo(activeVideo.inPointMs, videoPlayheadMs, "Set Video Out Point")
  }, [activeVideo, trimActiveVideo, videoPlayheadMs])

  const splitActiveVideo = React.useCallback(() => {
    if (!activeVideoLayer?.video) return
    const [left, right] = splitVideoLayerAtPlayhead(activeVideoLayer, videoPlayheadMs, timelineFps)
    dispatch({ type: "set-layer-video", id: activeVideoLayer.id, video: left.video })
    dispatch({ type: "add-layer", layer: right })
    window.setTimeout(() => commit("Split Video Clip", [activeVideoLayer.id, right.id]), 0)
    toast.success(`Split "${activeVideoLayer.name}" at ${(right.video?.inPointMs ?? videoPlayheadMs) / 1000}s`)
  }, [activeVideoLayer, commit, dispatch, timelineFps, videoPlayheadMs])

  const updateAudioTrack = React.useCallback(
    (trackId: string, patch: Partial<AudioTrack>) => {
      if (!activeDoc) return
      let mutated = false
      const nextFrames = frames.map((frame) => {
        if (!frame.audioTracks?.some((t) => t.id === trackId)) return frame
        mutated = true
        return {
          ...frame,
          audioTracks: frame.audioTracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)),
        }
      })
      if (mutated) {
        dispatch({ type: "set-timeline-frames", frames: nextFrames })
        window.setTimeout(() => commit("Update Audio Track", "all"), 0)
        return
      }
      for (const layer of activeDoc.layers) {
        const video = layer.video
        if (!video?.audioTracks?.some((t) => t.id === trackId)) continue
        const nextVideo: VideoLayerProps = {
          ...video,
          audioTracks: video.audioTracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)),
        }
        dispatch({ type: "set-layer-video", id: layer.id, video: nextVideo })
        window.setTimeout(() => commit("Update Audio Track", [layer.id]), 0)
        return
      }
    },
    [activeDoc, commit, dispatch, frames],
  )

  const changeTransitionDuration = React.useCallback(
    (durationMs: number) => {
      if (!activeVideo) return
      setActiveVideo(updateVideoTransitionDuration(activeVideo, activeTransition?.id, durationMs), "Set Video Transition Duration")
    },
    [activeTransition?.id, activeVideo, setActiveVideo],
  )

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!activeVideo) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (target?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      const key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && key === "k") {
        event.preventDefault()
        splitActiveVideo()
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (key === "i") {
        event.preventDefault()
        setVideoInPoint()
      } else if (key === "o") {
        event.preventDefault()
        setVideoOutPoint()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [activeVideo, setVideoInPoint, setVideoOutPoint, splitActiveVideo])

  // Global event listener bound to Ctrl+Shift+K through use-shortcuts.ts.
  React.useEffect(() => {
    const handler = () => {
      if (activeVideo) {
        splitActiveVideo()
      } else {
        splitSelectedTimelineFrame()
      }
    }
    return addPhotoshopEventListener("ps-timeline-split-at-playhead", handler)
    // splitSelectedTimelineFrame is defined later in this component; we rebind on each render
    // intentionally so the latest splitSelectedTimelineFrame closure is invoked.
  })

  React.useEffect(() => {
    let cancelled = false
    if (!activeVideo || !activeVideoLayer) {
      setVideoThumbnails([])
      return
    }
    const width = 96
    const height = Math.max(1, Math.round((width / Math.max(1, activeDoc?.width ?? width)) * Math.max(1, activeDoc?.height ?? 54)))
    const fallbackPlan = buildVideoThumbnailPlan(activeVideo, { count: 8, fps: timelineFps })
    const fallbackDataUrl = (() => {
      try {
        return activeVideo.posterDataUrl ?? activeVideoLayer.canvas.toDataURL("image/jpeg", 0.72)
      } catch {
        return activeVideo.posterDataUrl ?? ""
      }
    })()
    setVideoThumbnails(fallbackPlan.map((item) => ({ ...item, dataUrl: fallbackDataUrl })))
    if (!activeVideo.sourceDataUrl) return
    extractVideoThumbnailStrip(activeVideo.sourceDataUrl, activeVideo, { count: 8, fps: timelineFps, width, height })
      .then((items) => {
        if (!cancelled) setVideoThumbnails(items.map(({ canvas: _canvas, ...item }) => item))
      })
      .catch(() => {
        if (!cancelled) toast.error("Could not extract video thumbnails from the source media")
      })
    return () => {
      cancelled = true
    }
  }, [
    activeDoc?.height,
    activeDoc?.width,
    activeVideo?.durationMs,
    activeVideo?.inPointMs,
    activeVideo?.outPointMs,
    activeVideo?.posterDataUrl,
    activeVideo?.sourceDataUrl,
    activeVideo?.trimHandles?.inMs,
    activeVideo?.trimHandles?.outMs,
    activeVideo,
    activeVideoLayer,
    timelineFps,
  ])

  React.useEffect(() => {
    const canvas = transitionPreviewRef.current
    if (!canvas || !activeVideoLayer?.canvas) return
    const transition = activeTransition ?? { kind: "cross-dissolve" as const, durationMs: Math.min(1000, Math.max(1, (activeVideo?.outPointMs ?? 1000) - (activeVideo?.inPointMs ?? 0))) }
    const preview = renderVideoTransitionPreview(
      activeVideoLayer.canvas,
      targetTransitionLayer?.canvas,
      transition,
      Math.min(transition.durationMs, Math.max(0, videoPlayheadMs - (activeVideo?.inPointMs ?? 0))),
      { width: 160, height: 90 },
    )
    canvas.width = preview.width
    canvas.height = preview.height
    canvas.getContext("2d")?.drawImage(preview, 0, 0)
  }, [activeTransition, activeVideo, activeVideoLayer, targetTransitionLayer, videoPlayheadMs])

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

  const exportFrameSequence = async () => {
    if (!frames.length) return
    setExportSequenceBusy(true)
    try {
      const stem = safeFilePart(doc.name)
      const entries: Array<{ name: string; bytes: Blob | Uint8Array | string }> = []
      for (let idx = 0; idx < frames.length; idx++) {
        const frame = frames[idx]
        entries.push({
          name: `frames/${stem}-frame-${String(idx + 1).padStart(4, "0")}.png`,
          bytes: await exportTimelineFrameAsPngBlob(frame, doc),
        })
      }
      entries.push({
        name: "manifest.json",
        bytes: JSON.stringify(
          {
            document: doc.name,
            width: doc.width,
            height: doc.height,
            exportedAt: new Date().toISOString(),
            settings,
            frames: frames.map((frame, index) => ({
              index,
              file: `frames/${stem}-frame-${String(index + 1).padStart(4, "0")}.png`,
              name: frame.name,
              durationMs: frame.durationMs,
              transition: frame.transition ?? "hold",
              easing: frame.easing ?? "linear",
            })),
          },
          null,
          2,
        ),
      })
      const zip = await packagePngSequenceZip(entries)
      downloadBlob(new Blob([zip], { type: "application/zip" }), `${stem}-png-sequence.zip`)
      toast.success(`Packaged ${frames.length} PNG frame${frames.length === 1 ? "" : "s"}`)
    } catch (err) {
      toast.error(`PNG sequence export failed: ${(err as Error).message}`)
    } finally {
      setExportSequenceBusy(false)
    }
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
    if (exportAbortRef.current) {
      exportAbortRef.current.abort()
    }
    const controller = new AbortController()
    exportAbortRef.current = controller
    setExportBusy(format)
    setExportProgress({ done: 0, total: 0, phase: format })
    try {
      const animFrames = collectAnimationFramesAtFps(doc, {
        transparent: exportTransparent,
        fps: settings.fps,
        scale: exportScale,
        matte: exportMatte,
      })
      const loopCount = resolveTimelineSettings(doc).loopCount
      const total = animFrames.length
      setExportProgress({ done: 0, total, phase: format })
      const onProgress = (done: number, totalCount: number, phase: string) => {
        setExportProgress({ done, total: totalCount, phase })
      }
      let bytes: Uint8Array
      let mime: string
      let ext: string
      if (format === "gif") {
        bytes = await encodeAnimatedGifProgress(animFrames, {
          transparent: exportTransparent,
          loopCount,
          signal: controller.signal,
          onProgress,
        })
        mime = "image/gif"
        ext = "gif"
      } else if (format === "apng") {
        bytes = await encodeApngFromFrames(animFrames, {
          loopCount,
          signal: controller.signal,
          onProgress,
        })
        mime = "image/apng"
        ext = "png"
      } else {
        bytes = await encodeAnimatedWebP(animFrames, {
          transparent: exportTransparent,
          loopCount,
          quality: webpQuality,
          signal: controller.signal,
          onProgress,
        })
        mime = "image/webp"
        ext = "webp"
      }
      downloadDataUrl(bytesToDataUrl(bytes, mime), `${doc.name}.${ext}`)
      toast.success(`${format.toUpperCase()} exported (${animFrames.length} sampled frames at ${settings.fps}fps)`)
    } catch (err) {
      const error = err as Error
      if (error?.name === "AbortError") {
        toast.message(`${format.toUpperCase()} export cancelled`)
      } else {
        toast.error(`${format} export failed: ${error.message}`)
      }
    } finally {
      if (exportAbortRef.current === controller) exportAbortRef.current = null
      setExportBusy(null)
      setExportProgress(null)
    }
  }

  const cancelAnimationExport = React.useCallback(() => {
    exportAbortRef.current?.abort()
  }, [])

  const exportAudioMix = async () => {
    if (!audioTracks.length) {
      toast.error("No audio tracks to mix")
      return
    }
    setAudioBusy(true)
    try {
      const timelineDuration = frames.reduce((sum, frame) => sum + Math.max(0, frame.durationMs), 0)
      const audioDuration = audioTracks.reduce((max, track) => Math.max(max, track.startMs + track.durationMs), 0)
      const blob = await renderAudioMixToWavBlob(audioTracks, {
        sampleRate: 48_000,
        durationMs: Math.max(timelineDuration, audioDuration, 1),
        masterVolume: 1,
      })
      downloadBlob(blob, `${doc.name}-mix.wav`)
      toast.success("Exported WAV audio mix")
    } catch (err) {
      toast.error(`Audio mix export failed: ${(err as Error).message}`)
    } finally {
      setAudioBusy(false)
    }
  }

  const seekTimelinePlayhead = (timeMs: number) => {
    const next = Math.max(0, Math.min(totalTimelineDurationMs, Math.round(timeMs)))
    setTimelinePlayheadMs(next)
    const idx = timelineFrameIndexAtTime(frames, next)
    if (idx >= 0 && frames[idx]) setSelectedId(frames[idx].id)
  }

  const splitSelectedTimelineFrame = () => {
    if (!frames.length) return
    const result = splitTimelineFrameAtPlayhead(frames, timelinePlayheadMs)
    if (!result.didSplit) {
      toast.error("Move the timeline playhead inside a frame before splitting")
      return
    }
    setFrames(result.frames, "Split Timeline Frame")
    setSelectedId(result.splitFrameIds[0] ?? null)
    toast.success("Timeline frame split at playhead")
  }

  const extractActiveVideoFrames = async () => {
    if (!activeVideoLayer?.video) return
    const video = activeVideoLayer.video
    if (!video.sourceDataUrl) {
      toast.error("This video layer has no browser-readable source media")
      return
    }
    setVideoExtractBusy(true)
    try {
      const samples = await extractVideoThumbnailStrip(video.sourceDataUrl, video, {
        count: videoFrameCount,
        fps: timelineFps,
        width: doc.width,
        height: doc.height,
      })
      const extracted = makeFramesFromVideoCanvases(doc, activeVideoLayer.id, samples, {
        durationMs: Math.max(20, Math.round(1000 / timelineFps)),
        namePrefix: activeVideoLayer.name,
      })
      for (const layer of extracted.layers) {
        dispatch({ type: "add-layer", layer })
      }
      setFrames([...frames, ...extracted.frames], "Extract Video Frames")
      setSelectedId(extracted.frames[0]?.id ?? selectedId)
      toast.success(`Extracted ${extracted.frames.length} source video frame${extracted.frames.length === 1 ? "" : "s"}`)
    } catch (err) {
      toast.error(`Video frame extraction failed: ${(err as Error).message}`)
    } finally {
      setVideoExtractBusy(false)
    }
  }

  const exportMuxedWebm = async () => {
    if (!frames.length) {
      toast.error("Capture at least one frame first")
      return
    }
    if (muxAbortRef.current) muxAbortRef.current.abort()
    const muxController = new AbortController()
    muxAbortRef.current = muxController
    setMuxBusy(true)
    let audioContext: AudioContext | null = null
    try {
      const effectiveFps = Math.max(1, Math.round(renderVideoFps ?? finalVideoPreset.fps))
      const muxPreset = resolveVideoExportPreset(finalVideoPreset.id, { fps: effectiveFps })
      const plan = buildFinalVideoExportPlan(muxPreset, frames, audioTracks)
      const animFrames = collectAnimationFramesAtFps(doc, {
        transparent: false,
        fps: plan.fps,
        scale: exportScale,
        matte: exportMatte,
      })
      // Cancellation is handled inside the recording loop via muxController.signal.
      if (plan.mode === "timeline-package" || typeof MediaRecorder === "undefined") {
        const zip = await buildTimelineVideoPackage(doc, plan, animFrames, audioTracks)
        downloadBlob(new Blob([zip], { type: "application/zip" }), `${safeFilePart(doc.name)}-timeline-package.zip`)
        toast.success("Exported timeline frame/audio package")
        return
      }

      const captureCanvas = document.createElement("canvas")
      if (typeof captureCanvas.captureStream !== "function") {
        const fallbackPlan: FinalVideoExportPlan = {
          ...plan,
          mode: "timeline-package",
          container: "zip",
          extension: "zip",
          mimeType: "application/zip",
          warnings: [...plan.warnings, "Canvas captureStream is not available in this browser."],
        }
        const zip = await buildTimelineVideoPackage(doc, fallbackPlan, animFrames, audioTracks)
        downloadBlob(new Blob([zip], { type: "application/zip" }), `${safeFilePart(doc.name)}-timeline-package.zip`)
        toast.success("Exported timeline frame/audio package")
        return
      }

      const first = animFrames[0]?.canvas
      if (!first) throw new Error("No frames to record")
      captureCanvas.width = first.width
      captureCanvas.height = first.height
      const ctx = captureCanvas.getContext("2d")
      if (!ctx) throw new Error("2D context unavailable")

      const videoStream = captureCanvas.captureStream(timelineFps)
      const outputStream = new MediaStream([...videoStream.getVideoTracks()])
      const scheduledStarts: Array<(baseTime: number) => void> = []
      const AudioCtor = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      const audioSchedule = buildMuxedAudioStreamSchedule(audioTracks, {
        sampleRate: 48_000,
        durationMs: plan.durationMs,
        masterVolume: 1,
      })
      if (audioSchedule.tracks.length && AudioCtor) {
        audioContext = new AudioCtor()
        const destination = audioContext.createMediaStreamDestination()
        for (const track of audioSchedule.tracks) {
          if (!track.dataUrl) continue
          const source = audioContext.createBufferSource()
          source.buffer = await audioContext.decodeAudioData(dataUrlToArrayBuffer(track.dataUrl).slice(0))
          source.playbackRate.value = Math.max(0.01, track.playbackRate ?? 1)
          const gain = audioContext.createGain()
          gain.gain.value = 0
          const panner = typeof audioContext.createStereoPanner === "function" ? audioContext.createStereoPanner() : null
          source.connect(gain)
          if (panner) {
            panner.pan.value = track.pan
            gain.connect(panner)
            panner.connect(destination)
          } else {
            gain.connect(destination)
          }
          scheduledStarts.push((baseTime) => {
            track.gainAutomation.forEach((point, index) => {
              const time = baseTime + point.timeSeconds
              if (index === 0) gain.gain.setValueAtTime(point.value, time)
              else gain.gain.linearRampToValueAtTime(point.value, time)
            })
            source.start(baseTime + track.startSeconds, 0, Math.max(0.001, track.durationSeconds))
          })
        }
        for (const track of destination.stream.getAudioTracks()) outputStream.addTrack(track)
      }

      const chunks: Blob[] = []
      const recorder = new MediaRecorder(outputStream, plan.mimeType ? { mimeType: plan.mimeType } : undefined)
      const done = new Promise<Blob>((resolve, reject) => {
        recorder.onerror = () => reject(new Error("MediaRecorder failed"))
        recorder.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data)
        }
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || plan.mimeType }))
      })
      recorder.start()
      if (audioContext) {
        if (audioContext.state === "suspended") await audioContext.resume()
        const baseTime = audioContext.currentTime + 0.05
        scheduledStarts.forEach((start) => start(baseTime))
      }
      let cancelled = false
      const abortHandler = () => {
        cancelled = true
        try {
          recorder.stop()
        } catch {
          // ignore
        }
      }
      muxController.signal.addEventListener("abort", abortHandler)
      for (const frame of animFrames) {
        if (cancelled || muxController.signal.aborted) break
        ctx.clearRect(0, 0, captureCanvas.width, captureCanvas.height)
        ctx.drawImage(frame.canvas, 0, 0, captureCanvas.width, captureCanvas.height)
        await delay(Math.max(1, frame.durationMs))
      }
      muxController.signal.removeEventListener("abort", abortHandler)
      if (cancelled || muxController.signal.aborted) {
        try {
          recorder.stop()
        } catch {
          // ignore
        }
        await done.catch(() => undefined)
        toast.message("Video export cancelled")
        return
      }
      recorder.stop()
      const blob = await done
      downloadBlob(blob, `${safeFilePart(doc.name)}-timeline.${plan.extension}`)
      toast.success(audioSchedule.tracks.length ? `Exported muxed ${plan.extension.toUpperCase()} with audio` : `Exported ${plan.extension.toUpperCase()} timeline video`)
    } catch (err) {
      const error = err as Error
      if (error?.name === "AbortError" || muxController.signal.aborted) {
        toast.message("Video export cancelled")
      } else {
        toast.error(`Video export failed: ${error.message}`)
      }
    } finally {
      if (muxAbortRef.current === muxController) muxAbortRef.current = null
      await audioContext?.close().catch(() => undefined)
      setMuxBusy(false)
    }
  }

  const cancelMuxExport = React.useCallback(() => {
    muxAbortRef.current?.abort()
  }, [])

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
        <ToolButton title="Export PNG sequence ZIP" disabled={!frames.length || exportSequenceBusy} onClick={exportFrameSequence}>
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
        <TextBtn disabled={!frames.length || exportSequenceBusy} onClick={exportFrameSequence}>
          {exportSequenceBusy ? "ZIP…" : "PNG ZIP"}
        </TextBtn>
        <TextBtn
          disabled={!frames.length || muxBusy}
          onClick={exportMuxedWebm}
          title={
            finalVideoPlan.mode === "muxed-media"
              ? `Export ${finalVideoPlan.extension.toUpperCase()} via MediaRecorder (${finalVideoPlan.mimeType || "default codec"})`
              : `MediaRecorder muxed video is unavailable in this browser, so the timeline will be packaged as a deterministic ZIP of PNG frames + WAV audio + manifest. ${finalVideoPlan.warnings.join(" ")}`
          }
        >
          {muxBusy ? "Video…" : finalVideoPlan.mode === "muxed-media" ? finalVideoPlan.extension.toUpperCase() : "Package"}
        </TextBtn>
        {muxBusy ? (
          <button
            type="button"
            onClick={cancelMuxExport}
            className="flex h-5 items-center gap-1 rounded-sm border border-[var(--ps-divider)] px-1.5 text-[10px] hover:bg-[var(--ps-tool-hover)]"
            aria-label="Cancel video export"
          >
            <X className="h-3 w-3" /> Stop
          </button>
        ) : null}
        <TextBtn disabled={!audioTracks.length || audioBusy} onClick={exportAudioMix}>
          {audioBusy ? "WAV…" : "WAV"}
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
        <label className="ml-1 flex items-center gap-1 text-[10px] text-[var(--ps-text-dim)]">
          <input type="checkbox" checked={exportTransparent} onChange={(e) => setExportTransparent(e.target.checked)} />
          Alpha
        </label>
        <span className="text-[10px] text-[var(--ps-text-dim)]">Scale</span>
        <input
          type="number"
          min={0.1}
          max={4}
          step={0.1}
          value={exportScale}
          onChange={(e) => setExportScale(Math.max(0.1, Math.min(4, Number(e.target.value) || 1)))}
          className="h-5 w-12 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          aria-label="Animation export scale"
        />
        <input
          type="color"
          value={exportMatte}
          onChange={(e) => setExportMatte(e.target.value)}
          className="h-5 w-7 rounded-sm border border-[var(--ps-divider)] bg-transparent p-0"
          aria-label="Animation matte color"
          title="Animation matte color"
        />
        <span className="text-[10px] text-[var(--ps-text-dim)]">Q</span>
        <input
          type="number"
          min={0.1}
          max={1}
          step={0.05}
          value={webpQuality}
          onChange={(e) => setWebpQuality(Math.max(0.1, Math.min(1, Number(e.target.value) || 0.9)))}
          className="h-5 w-12 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          aria-label="Animated WebP quality"
        />
        <span className="mx-2 text-[10px] text-[var(--ps-text-dim)]">Video FPS</span>
        <input
          type="number"
          min={1}
          max={60}
          value={renderVideoFps ?? settings.fps}
          onChange={(e) =>
            setRenderVideoFps(Math.max(1, Math.min(60, Number(e.target.value) || settings.fps)))
          }
          className="h-5 w-12 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
          aria-label="Render video output FPS"
          title="Override frame rate used by the muxed WebM/MP4/timeline package exporter"
        />
        <TextBtn onClick={() => setRenderVideoFps(null)} disabled={renderVideoFps === null}>Reset</TextBtn>
      </div>

      {/* Muxed video unavailable: surface alternatives */}
      {frames.length > 0 && finalVideoPlan.mode !== "muxed-media" ? (
        <div
          className="flex flex-wrap items-center gap-1 border-b border-amber-400/30 bg-amber-400/10 px-2 py-1.5 text-[10px] text-amber-100"
          data-testid="timeline-muxed-unavailable-row"
        >
          <span className="font-medium">MediaRecorder unavailable in this browser.</span>
          <span className="text-amber-200/80">
            {finalVideoPlan.warnings[0] ?? "Muxed MP4/WebM cannot be produced here. The Video button will write a ZIP timeline package instead."}
          </span>
          <span className="ml-2 text-[9px] uppercase tracking-wide text-amber-200/70">Try instead:</span>
          <button
            type="button"
            title="Animated PNG preserves 24-bit color and full alpha across frames (no codec runtime required)."
            onClick={() => exportAnimation("apng")}
            disabled={!frames.length || exportBusy !== null}
            className="rounded-sm border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-100 hover:border-amber-400/70 hover:bg-amber-400/20 disabled:opacity-40"
          >
            Use APNG
          </button>
          <button
            type="button"
            title="Animated WebP supports lossy/lossless frames with alpha and is decoded natively by the browser."
            onClick={() => exportAnimation("animated-webp")}
            disabled={!frames.length || exportBusy !== null}
            className="rounded-sm border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-100 hover:border-amber-400/70 hover:bg-amber-400/20 disabled:opacity-40"
          >
            Use Anim WebP
          </button>
          <button
            type="button"
            title="GIF is universally supported but limited to a 256-color palette and 1-bit transparency."
            onClick={() => exportAnimation("gif")}
            disabled={!frames.length || exportBusy !== null}
            className="rounded-sm border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-100 hover:border-amber-400/70 hover:bg-amber-400/20 disabled:opacity-40"
          >
            Use GIF
          </button>
          <button
            type="button"
            title="Deterministic ZIP of full-resolution PNG frames plus a manifest.json (no codec required)."
            onClick={exportFrameSequence}
            disabled={!frames.length || exportSequenceBusy}
            className="rounded-sm border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-100 hover:border-amber-400/70 hover:bg-amber-400/20 disabled:opacity-40"
          >
            Use PNG ZIP
          </button>
        </div>
      ) : null}

      {/* Encoder progress bar (GIF/APNG/WebP) */}
      {exportBusy && exportProgress ? (
        <div className="flex items-center gap-2 border-b border-[var(--ps-divider)] px-2 py-1.5">
          <span className="text-[10px] text-[var(--ps-text-dim)]">
            Encoding {exportProgress.phase.toUpperCase()} {exportProgress.done}/{Math.max(1, exportProgress.total)}
          </span>
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--ps-panel-2)]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={Math.max(1, exportProgress.total)}
            aria-valuenow={exportProgress.done}
          >
            <div
              className="h-full bg-[var(--ps-accent)] transition-[width]"
              style={{
                width: `${exportProgress.total ? Math.min(100, (exportProgress.done / exportProgress.total) * 100) : 0}%`,
              }}
            />
          </div>
          <button
            type="button"
            onClick={cancelAnimationExport}
            className="flex h-5 items-center gap-1 rounded-sm border border-[var(--ps-divider)] px-1.5 text-[10px] hover:bg-[var(--ps-tool-hover)]"
            aria-label="Cancel animation export"
          >
            <X className="h-3 w-3" /> Cancel
          </button>
        </div>
      ) : null}

      {/* Audio mixer */}
      <div className="flex items-center gap-2 border-b border-[var(--ps-divider)] px-2 py-1.5">
        <span className="text-[10px] text-[var(--ps-text-dim)]">Audio mixer</span>
        <span className="text-[10px] text-[var(--ps-text-dim)]">
          {audibleTracks.length}/{audioTracks.length} audible
        </span>
        {anyTrackSolo ? (
          <span className="rounded-sm bg-[var(--ps-accent)]/30 px-1 text-[10px] text-[var(--ps-text)]">SOLO</span>
        ) : null}
        <TextBtn disabled={!audioTracks.length} onClick={() => setShowAudioMixer((v) => !v)}>
          {showAudioMixer ? "Hide" : "Show"} mixer
        </TextBtn>
        <TextBtn disabled={!audioTracks.length || audioBusy} onClick={exportAudioMix}>
          {audioBusy ? "Mixing WAV…" : "Export WAV"}
        </TextBtn>
      </div>
      {showAudioMixer && audioTracks.length ? (
        <AudioMixerSection
          tracks={audioTracks}
          playing={playing}
          playheadMs={timelinePlayheadMs}
          vuLevels={audioVuLevels}
          onVuLevels={setAudioVuLevels}
          onUpdate={updateAudioTrack}
        />
      ) : null}

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

      {frames.length ? (
        <TimelinePlayheadSection
          doc={doc}
          frames={frames}
          playheadMs={timelinePlayheadMs}
          playheadFrameIndex={timelinePlayheadFrameIndex}
          totalDurationMs={totalTimelineDurationMs}
          fps={timelineFps}
          cache={playbackOverlayCacheRef.current}
          onSeek={seekTimelinePlayhead}
          onSplit={splitSelectedTimelineFrame}
        />
      ) : null}

      {activeVideoLayer && activeVideo ? (
        <div className="border-b border-[var(--ps-divider)] px-2 py-2">
          <div className="mb-1 flex flex-wrap items-center gap-1">
            <span className="mr-1 max-w-[11rem] truncate text-[10px] text-[var(--ps-text-dim)]" title={activeVideoLayer.name}>
              Video: {activeVideoLayer.name}
            </span>
            <ToolButton title="Split at playhead (Ctrl+K)" disabled={!activeVideoTrackState?.canSplit} onClick={splitActiveVideo}>
              <Scissors className="h-3.5 w-3.5" />
            </ToolButton>
            <TextBtn onClick={setVideoInPoint}>I</TextBtn>
            <TextBtn onClick={setVideoOutPoint}>O</TextBtn>
            <span className="text-[10px] text-[var(--ps-text-dim)]">
              {(activeVideo.inPointMs / 1000).toFixed(2)}s - {(activeVideo.outPointMs / 1000).toFixed(2)}s
            </span>
            <span className="ml-auto text-[10px] text-[var(--ps-text-dim)]">
              playhead {(videoPlayheadMs / 1000).toFixed(2)}s
            </span>
          </div>
          <div className="grid gap-1">
            {activeVideoTrackState ? (
              <VideoTrimTrack
                state={activeVideoTrackState}
                onSeek={setVideoPlayhead}
                onTrimIn={(timeMs, label) => trimActiveVideo(timeMs, activeVideo.outPointMs, label)}
                onTrimOut={(timeMs, label) => trimActiveVideo(activeVideo.inPointMs, timeMs, label)}
                onSplit={splitActiveVideo}
              />
            ) : null}
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] text-[var(--ps-text-dim)]">Source frames</span>
              <input
                type="number"
                min={1}
                max={48}
                value={videoFrameCount}
                onChange={(e) => setVideoFrameCount(Math.max(1, Math.min(48, Number(e.target.value) || 12)))}
                className="h-5 w-12 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)] px-1 text-[10px]"
                aria-label="Number of source video frames to extract"
              />
              <TextBtn disabled={!activeVideo.sourceDataUrl || videoExtractBusy} onClick={extractActiveVideoFrames}>
                {videoExtractBusy ? "Extracting…" : "Extract to frames"}
              </TextBtn>
            </div>
          </div>
          <div className="mt-2 flex min-h-[42px] gap-1 overflow-x-auto">
            {videoThumbnails.map((thumb) => (
              <button
                key={`${thumb.index}-${thumb.timeMs}`}
                type="button"
                title={thumb.label}
                onClick={() => setVideoPlayhead(thumb.timeMs, true)}
                className={`relative h-10 w-16 shrink-0 overflow-hidden rounded-sm border bg-black ${
                  Math.abs(videoPlayheadMs - thumb.timeMs) <= Math.max(1, 1000 / timelineFps)
                    ? "border-[var(--ps-accent)]"
                    : "border-[var(--ps-divider)]"
                }`}
              >
                {thumb.dataUrl ? <img src={thumb.dataUrl} alt="" className="h-full w-full object-cover" /> : null}
                <span className="absolute bottom-0 right-0 bg-black/70 px-0.5 text-[8px] text-white">{(thumb.timeMs / 1000).toFixed(1)}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_168px]">
            <div className="grid gap-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--ps-text-dim)]">Transition</span>
                <input
                  type="range"
                  min={0}
                  max={5000}
                  step={Math.max(1, Math.round(1000 / timelineFps))}
                  value={activeTransition?.durationMs ?? 0}
                  onChange={(e) => changeTransitionDuration(Number(e.target.value))}
                  className="h-4 flex-1"
                  aria-label="Video transition duration"
                />
                <span className="w-12 text-right text-[10px] text-[var(--ps-text-dim)]">{activeTransition?.durationMs ?? 0}ms</span>
              </div>
              <TextBtn disabled={!audioTracks.length || audioBusy} onClick={exportAudioMix}>
                {audioBusy ? "Mixing WAV..." : "Export WAV mix"}
              </TextBtn>
            </div>
            <canvas
              ref={transitionPreviewRef}
              className="h-[90px] w-[160px] rounded-sm border border-[var(--ps-divider)] bg-black"
              aria-label="Video transition preview"
            />
          </div>
        </div>
      ) : null}

      <TimelineBulkEditBar
        selectedCount={selection.size}
        onSetDuration={bulkSetDuration}
        onDistributeDurations={() => {
          const totalMs = Math.max(100, selection.size * 200)
          setFrames(
            distributeDurations(frames.filter((frame) => selection.has(frame.id)), totalMs)
              .concat(frames.filter((frame) => !selection.has(frame.id))),
            "Distribute Durations",
          )
        }}
        onDeleteSelected={() => removeFrames(Array.from(selection))}
        onClearSelection={() => setSelection(new Set())}
      />

      <TimelineFrameList
        doc={doc}
        frames={frames}
        selectedFrameId={selected?.id ?? null}
        selection={selection}
        onSelectFrame={(frameId, multi) => {
          if (multi) {
            setSelection((prev) => {
              const next = new Set(prev)
              if (next.has(frameId)) next.delete(frameId)
              else next.add(frameId)
              return next
            })
          } else {
            setSelectedId(frameId)
          }
        }}
        onApplyFrame={applyFrame}
        onChangeFrame={updateFrame}
        onDuplicateFrame={duplicateFrame}
        onDeleteFrame={(frameId) => removeFrames([frameId])}
        onMoveFrame={reorder}
      />

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
