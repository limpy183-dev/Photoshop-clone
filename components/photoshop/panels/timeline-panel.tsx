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
  Scissors,
  Square,
  Trash2,
} from "lucide-react"
import { useEditor } from "../editor-context"
import {
  downloadBlob,
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
  makeFramesFromVideoCanvases,
  makeFramesFromLayers,
  moveFrame,
  renderOnionSkinOverlay,
  renderTimelineFrameComposite,
  reverseFrames,
  setDurationsFromFps,
  splitTimelineFrameAtPlayhead,
  timelineDurationMs,
  timelineFrameIndexAtTime,
} from "../timeline-engine"
import {
  bytesToDataUrl,
  collectAnimationFramesAtFps,
  encodeAnimatedGif,
  encodeAnimatedWebP,
  encodeApngFromFrames,
  exportTimelineFrameAsPngBlob,
  packagePngSequenceZip,
  resolveTimelineSettings,
  type AnimatedExportFrame,
} from "../animation-encoding"
import {
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
  type VideoClipTrackState,
  updateVideoTransitionDuration,
} from "../three-d-video-engine"
import type {
  AudioTrack,
  FrameEasing,
  FrameLayerTransform,
  Layer,
  OnionSkinSettings,
  PsDocument,
  TimelineFrame,
  TimelineSettings,
  VideoLayerProps,
} from "../types"
import { uid } from "../uid"

type AnimationFormat = "gif" | "apng" | "animated-webp"
type VideoThumbnail = { index: number; timeMs: number; label: string; dataUrl: string }

const EASINGS: FrameEasing[] = ["hold", "linear", "ease-in", "ease-out", "ease-in-out"]
const TINTS: NonNullable<OnionSkinSettings["tint"]>[] = ["none", "red-cyan", "red-blue", "green-red", "mono"]

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
  const transitionPreviewRef = React.useRef<HTMLCanvasElement | null>(null)

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
    setExportBusy(format)
    try {
      const animFrames = collectAnimationFramesAtFps(doc, {
        transparent: exportTransparent,
        fps: settings.fps,
        scale: exportScale,
        matte: exportMatte,
      })
      const loopCount = resolveTimelineSettings(doc).loopCount
      let bytes: Uint8Array
      let mime: string
      let ext: string
      if (format === "gif") {
        bytes = encodeAnimatedGif(animFrames, { transparent: exportTransparent, loopCount })
        mime = "image/gif"
        ext = "gif"
      } else if (format === "apng") {
        bytes = await encodeApngFromFrames(animFrames, { loopCount })
        mime = "image/apng"
        ext = "png"
      } else {
        bytes = await encodeAnimatedWebP(animFrames, { transparent: exportTransparent, loopCount, quality: webpQuality })
        mime = "image/webp"
        ext = "webp"
      }
      downloadDataUrl(bytesToDataUrl(bytes, mime), `${doc.name}.${ext}`)
      toast.success(`${format.toUpperCase()} exported (${animFrames.length} sampled frames at ${settings.fps}fps)`)
    } catch (err) {
      toast.error(`${format} export failed: ${(err as Error).message}`)
    } finally {
      setExportBusy(null)
    }
  }

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
    setMuxBusy(true)
    let audioContext: AudioContext | null = null
    try {
      const plan = buildFinalVideoExportPlan(finalVideoPreset, frames, audioTracks)
      const animFrames = collectAnimationFramesAtFps(doc, {
        transparent: false,
        fps: plan.fps,
        scale: exportScale,
        matte: exportMatte,
      })
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
      for (const frame of animFrames) {
        ctx.clearRect(0, 0, captureCanvas.width, captureCanvas.height)
        ctx.drawImage(frame.canvas, 0, 0, captureCanvas.width, captureCanvas.height)
        await delay(Math.max(1, frame.durationMs))
      }
      recorder.stop()
      const blob = await done
      downloadBlob(blob, `${safeFilePart(doc.name)}-timeline.${plan.extension}`)
      toast.success(audioSchedule.tracks.length ? `Exported muxed ${plan.extension.toUpperCase()} with audio` : `Exported ${plan.extension.toUpperCase()} timeline video`)
    } catch (err) {
      toast.error(`Video export failed: ${(err as Error).message}`)
    } finally {
      await audioContext?.close().catch(() => undefined)
      setMuxBusy(false)
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
        <TextBtn disabled={!frames.length || muxBusy} onClick={exportMuxedWebm}>
          {muxBusy ? "Video…" : finalVideoPlan.mode === "muxed-media" ? finalVideoPlan.extension.toUpperCase() : "Package"}
        </TextBtn>
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

      {frames.length ? (
        <div className="grid gap-1 border-b border-[var(--ps-divider)] px-2 py-1.5">
          <div className="flex items-center gap-2">
            <span className="w-20 text-[10px] text-[var(--ps-text-dim)]">Playhead {(timelinePlayheadMs / 1000).toFixed(2)}s</span>
            <input
              type="range"
              min={0}
              max={Math.max(1, totalTimelineDurationMs)}
              step={Math.max(1, Math.round(1000 / timelineFps))}
              value={timelinePlayheadMs}
              onChange={(e) => seekTimelinePlayhead(Number(e.target.value))}
              className="h-5 flex-1"
              aria-label="Timeline playhead"
            />
            <span className="w-16 text-right text-[10px] text-[var(--ps-text-dim)]">
              {timelinePlayheadFrameIndex >= 0 ? `#${timelinePlayheadFrameIndex + 1}` : "--"}
            </span>
            <TextBtn disabled={frames.length < 1} onClick={splitSelectedTimelineFrame}>Split frame</TextBtn>
          </div>
        </div>
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

function VideoTrimTrack({
  state,
  onSeek,
  onTrimIn,
  onTrimOut,
  onSplit,
}: {
  state: VideoClipTrackState
  onSeek: (timeMs: number, record?: boolean) => void
  onTrimIn: (timeMs: number, label?: string) => void
  onTrimOut: (timeMs: number, label?: string) => void
  onSplit: () => void
}) {
  const trackRef = React.useRef<HTMLDivElement | null>(null)
  const timeFromClientX = React.useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect || rect.width <= 0) return state.playheadMs
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const raw = pct * state.durationMs
      return Math.max(0, Math.min(state.durationMs, Math.round(raw / state.frameStepMs) * state.frameStepMs))
    },
    [state.durationMs, state.frameStepMs, state.playheadMs],
  )

  const beginDrag = (kind: "in" | "out" | "playhead") => (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    let lastTime = timeFromClientX(event.clientX)
    const apply = (timeMs: number, commitLabel?: string) => {
      if (kind === "in") onTrimIn(Math.min(timeMs, state.outPointMs - state.frameStepMs), commitLabel)
      else if (kind === "out") onTrimOut(Math.max(timeMs, state.inPointMs + state.frameStepMs), commitLabel)
      else onSeek(timeMs, !!commitLabel)
    }
    apply(lastTime)
    const onMove = (moveEvent: PointerEvent) => {
      lastTime = timeFromClientX(moveEvent.clientX)
      apply(lastTime)
    }
    const onUp = () => {
      apply(lastTime, kind === "playhead" ? "Set Video Playhead" : "Trim Video Clip")
      window.removeEventListener("pointermove", onMove)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp, { once: true })
  }

  return (
    <div className="grid gap-1">
      <div
        ref={trackRef}
        role="slider"
        aria-label="Video trim and playhead track"
        aria-valuemin={0}
        aria-valuemax={state.durationMs}
        aria-valuenow={state.playheadMs}
        tabIndex={0}
        onPointerDown={(event) => onSeek(timeFromClientX(event.clientX), true)}
        className="relative h-9 rounded-sm border border-[var(--ps-divider)] bg-[var(--ps-panel-2)]"
      >
        <div className="absolute left-1 right-1 top-1/2 h-1 -translate-y-1/2 rounded-full bg-black/40" />
        <div
          className="absolute top-1/2 h-3 -translate-y-1/2 rounded-sm bg-[var(--ps-accent)]/35"
          style={{ left: `${state.inPercent}%`, width: `${state.clipWidthPercent}%` }}
        />
        <button
          type="button"
          title="Drag trim in"
          aria-label="Drag video trim in handle"
          onPointerDown={beginDrag("in")}
          className="absolute top-1/2 h-7 w-2 -translate-x-1/2 -translate-y-1/2 rounded-[2px] bg-[var(--ps-accent)] shadow"
          style={{ left: `${state.inPercent}%` }}
        />
        <button
          type="button"
          title="Drag trim out"
          aria-label="Drag video trim out handle"
          onPointerDown={beginDrag("out")}
          className="absolute top-1/2 h-7 w-2 -translate-x-1/2 -translate-y-1/2 rounded-[2px] bg-[var(--ps-accent)] shadow"
          style={{ left: `${state.outPercent}%` }}
        />
        <button
          type="button"
          title="Drag playhead"
          aria-label="Drag video playhead"
          onPointerDown={beginDrag("playhead")}
          className="absolute top-0 h-full w-2 -translate-x-1/2 rounded-[2px] bg-white/80 shadow"
          style={{ left: `${state.playheadPercent}%` }}
        />
      </div>
      <div className="flex items-center gap-2 text-[9px] text-[var(--ps-text-dim)]">
        <span>In {state.labels.in}</span>
        <span>Out {state.labels.out}</span>
        <span className="ml-auto">Playhead {state.labels.playhead}</span>
        <TextBtn disabled={!state.canSplit} onClick={onSplit}>Split</TextBtn>
      </div>
    </div>
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

async function buildTimelineVideoPackage(
  doc: PsDocument,
  plan: FinalVideoExportPlan,
  frames: AnimatedExportFrame[],
  audioTracks: AudioTrack[],
) {
  const stem = safeFilePart(doc.name)
  const entries: Array<{ name: string; bytes: Blob | Uint8Array | string }> = []
  for (let index = 0; index < frames.length; index++) {
    entries.push({
      name: `frames/${stem}-${String(index + 1).padStart(5, "0")}.png`,
      bytes: await canvasToPngBlob(frames[index].canvas),
    })
  }
  const muxableAudio = audioTracks.filter((track) => !track.muted && !!track.dataUrl && track.durationMs > 0)
  if (muxableAudio.length) {
    entries.push({
      name: "audio/mix.wav",
      bytes: await renderAudioMixToWavBlob(muxableAudio, {
        sampleRate: 48_000,
        durationMs: plan.durationMs,
        masterVolume: 1,
      }),
    })
  }
  entries.push({
    name: "manifest.json",
    bytes: JSON.stringify(
      {
        document: doc.name,
        exportedAt: new Date().toISOString(),
        plan,
        frames: frames.map((frame, index) => ({
          index,
          file: `frames/${stem}-${String(index + 1).padStart(5, "0")}.png`,
          durationMs: frame.durationMs,
          sourceFrameId: frame.sourceFrameId,
          timeMs: frame.timeMs,
        })),
        audio: muxableAudio.length ? { file: "audio/mix.wav", tracks: muxableAudio.map((track) => ({ id: track.id, name: track.name })) } : null,
      },
      null,
      2,
    ),
  })
  return packagePngSequenceZip(entries)
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG frame encode failed"))), "image/png")
  })
}

function safeFilePart(name: string) {
  return (name || "timeline")
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "timeline"
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const comma = dataUrl.indexOf(",")
  const header = comma >= 0 ? dataUrl.slice(0, comma) : ""
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  if (/;base64/i.test(header)) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  }
  const bytes = new TextEncoder().encode(decodeURIComponent(payload))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("Read blob failed"))
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "")
    reader.readAsDataURL(blob)
  })
}
