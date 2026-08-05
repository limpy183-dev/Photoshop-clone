"use client"

/**
 * Video tab — frame capture from a video file, keyframes, audio tracks and timeline rendering.
 *
 * One tab of the Advanced Subsystems dialog. The dialog itself
 * (`subsystems-dialog.tsx`) only owns the tab list and the switch that picks
 * a workspace; each workspace holds its own state and talks to the editor
 * directly, so opening the dialog does not mount the other ten.
 */

import {
  canvasToDataUrl,
  createLayerFromCanvas,
  fileToDataUrl,
} from "@/components/photoshop/advanced/subsystems-dialog-helpers"
import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  CapabilityNotice,
  EmptyState,
  FileButton,
  NumberField,
  Panel,
  SelectField,
} from "@/components/photoshop/advanced/subsystems-dialog-controls"
import { useEditor } from "@/components/photoshop/editor/context"
import { downloadBlob, renderDocumentComposite } from "@/editor/document/io"
import { uid } from "@/editor/uid"
import { createSubsystemCanvas } from "@/editor/advanced/subsystems"
import {
  VIDEO_EXPORT_PRESETS,
  applyVideoTransition,
  buildAudioMixPlan,
  convertVideoTimelineToFrameAnimation,
  createVideoGroup,
  getVideoPresetDiagnostics,
  renderAudioMixToWavBlob,
  resolveVideoExportPreset,
  splitVideoLayer,
  trimVideoClip,
} from "@/editor/three-d-video-engine"
import type { AudioTrack, PsDocument, VideoKeyframe, VideoLayerProps } from "@/editor/types"
async function captureVideoFrame(file: File, timeMs: number, width: number, height: number) {
  const url = URL.createObjectURL(file)
  try {
    const video = document.createElement("video")
    video.src = url
    video.muted = true
    video.preload = "auto"
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error("Could not read video metadata"))
    })
    video.currentTime = Math.min(video.duration || 0, timeMs / 1000)
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve()
    })
    const canvas = createSubsystemCanvas(width, height)
    canvas.getContext("2d")!.drawImage(video, 0, 0, width, height)
    return { canvas, durationMs: Math.round((video.duration || 0) * 1000) }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function VideoWorkspace() {
  const { activeDoc, activeLayer, selectedLayers, dispatch, commit, requestRender } = useEditor()
  const [timeMs, setTimeMs] = React.useState(0)
  const [rendering, setRendering] = React.useState(false)
  const [audioRendering, setAudioRendering] = React.useState(false)
  const [progress, setProgress] = React.useState("")
  const [presetId, setPresetId] = React.useState("social-1080p")
  const [frameConversion, setFrameConversion] = React.useState("")
  const presetDiagnostics = React.useMemo(() => getVideoPresetDiagnostics(), [])
  const currentDiagnostic = presetDiagnostics.find((entry) => entry.preset.id === presetId) ?? presetDiagnostics[0]
  if (!activeDoc) return <EmptyState text="Open a document before importing video layers." />

  const frames = activeDoc.timelineFrames ?? []
  const activeVideoLayer = activeLayer?.kind === "video" && activeLayer.video ? activeLayer : null
  const selectedVideoLayers = selectedLayers.filter((layer) => layer.kind === "video" && layer.video)
  const audioTracks = [
    ...frames.flatMap((frame) => frame.audioTracks ?? []),
    ...activeDoc.layers.flatMap((layer) => layer.video?.audioTracks ?? []),
  ]
  const audioMix = buildAudioMixPlan(audioTracks, timeMs, { masterVolume: 1 })

  const importVideo = async (file: File) => {
    try {
      const sourceDataUrl = await fileToDataUrl(file)
      const capture = await captureVideoFrame(file, timeMs, activeDoc.width, activeDoc.height)
      const video: VideoLayerProps = {
        sourceName: file.name,
        sourceDataUrl,
        durationMs: capture.durationMs,
        currentTimeMs: timeMs,
        playbackRate: 1,
        inPointMs: 0,
        outPointMs: capture.durationMs,
        keyframes: [],
        posterDataUrl: canvasToDataUrl(capture.canvas),
      }
      const layer = createLayerFromCanvas(activeDoc, `Video - ${file.name}`, capture.canvas, { kind: "video", video })
      dispatch({ type: "add-layer", layer })
      window.setTimeout(() => commit("Import Video Layer", "all"), 0)
      toast.success("Video layer imported")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import video")
    }
  }

  const captureTimelineFrame = () => {
    const frame = {
      id: uid("frame"),
      name: `Frame ${frames.length + 1}`,
      durationMs: 500,
      layerVisibility: Object.fromEntries(activeDoc.layers.map((layer) => [layer.id, layer.visible])),
      layerOpacity: Object.fromEntries(activeDoc.layers.map((layer) => [layer.id, layer.opacity])),
      transition: "hold" as const,
      keyframes: [] as VideoKeyframe[],
      audioTracks: [] as AudioTrack[],
    }
    dispatch({ type: "set-timeline-frames", frames: [...frames, frame] })
    window.setTimeout(() => commit("Capture Video Timeline Frame", "all"), 0)
  }

  const addOpacityKeyframe = () => {
    if (!activeLayer) return
    const frame = frames[0] ?? {
      id: uid("frame"),
      name: "Video Frame 1",
      durationMs: 500,
      layerVisibility: Object.fromEntries(activeDoc.layers.map((layer) => [layer.id, layer.visible])),
      layerOpacity: Object.fromEntries(activeDoc.layers.map((layer) => [layer.id, layer.opacity])),
      transition: "hold" as const,
    }
    const keyframe: VideoKeyframe = { id: uid("key"), timeMs, layerId: activeLayer.id, property: "opacity", value: activeLayer.opacity, easing: "linear" }
    const nextFrames = frames.length ? frames.map((item, index) => (index === 0 ? { ...item, keyframes: [...(item.keyframes ?? []), keyframe] } : item)) : [{ ...frame, keyframes: [keyframe] }]
    dispatch({ type: "set-timeline-frames", frames: nextFrames })
  }

  const addAudioTrack = async (file: File) => {
    const dataUrl = await fileToDataUrl(file)
    const audio = document.createElement("audio")
    audio.src = dataUrl
    await new Promise<void>((resolve) => {
      audio.onloadedmetadata = () => resolve()
      audio.onerror = () => resolve()
    })
    const track: AudioTrack = { id: uid("audio"), name: file.name, startMs: timeMs, durationMs: Math.round((audio.duration || 0) * 1000), volume: 1, dataUrl }
    const frame = frames[0] ?? {
      id: uid("frame"),
      name: "Video Frame 1",
      durationMs: 500,
      layerVisibility: Object.fromEntries(activeDoc.layers.map((layer) => [layer.id, layer.visible])),
      layerOpacity: Object.fromEntries(activeDoc.layers.map((layer) => [layer.id, layer.opacity])),
      transition: "hold" as const,
    }
    const nextFrames = frames.length ? frames.map((item, index) => (index === 0 ? { ...item, audioTracks: [...(item.audioTracks ?? []), track] } : item)) : [{ ...frame, audioTracks: [track] }]
    dispatch({ type: "set-timeline-frames", frames: nextFrames })
  }

  const trimActiveClip = () => {
    if (!activeVideoLayer?.video) return
    const next = trimVideoClip(activeVideoLayer.video, timeMs, activeVideoLayer.video.outPointMs)
    dispatch({ type: "set-layer-video", id: activeVideoLayer.id, video: next })
    window.setTimeout(() => commit("Trim Video Clip", [activeVideoLayer.id]), 0)
  }

  const splitActiveClip = () => {
    if (!activeVideoLayer?.video) return
    const [left, right] = splitVideoLayer(activeVideoLayer, timeMs)
    dispatch({ type: "set-layer-video", id: activeVideoLayer.id, video: left.video })
    dispatch({ type: "add-layer", layer: right })
    window.setTimeout(() => commit("Split Video Clip", [activeVideoLayer.id, right.id]), 0)
  }

  const addTransition = () => {
    if (!activeVideoLayer?.video) return
    const next = applyVideoTransition(activeVideoLayer.video, { kind: "cross-dissolve", durationMs: 800, easing: "ease-in-out" })
    dispatch({ type: "set-layer-video", id: activeVideoLayer.id, video: next })
    window.setTimeout(() => commit("Add Video Transition", [activeVideoLayer.id]), 0)
  }

  const makeVideoGroup = () => {
    const layers = selectedVideoLayers.length ? selectedVideoLayers : activeVideoLayer ? [activeVideoLayer] : []
    if (!layers.length) return
    const result = createVideoGroup(layers, { name: `Video Group ${(activeDoc.layers.filter((layer) => layer.videoGroup).length ?? 0) + 1}`, transition: "cross-dissolve" })
    dispatch({ type: "add-layer", layer: result.group })
    for (const layer of result.layers) {
      if (layer.video) dispatch({ type: "set-layer-video", id: layer.id, video: layer.video })
    }
    window.setTimeout(() => commit("Create Video Group", [result.group.id, ...layers.map((layer) => layer.id)]), 0)
  }

  const convertFrames = () => {
    const animation = convertVideoTimelineToFrameAnimation(frames, { fps: resolveVideoExportPreset(presetId).fps, includeTransitions: true })
    setFrameConversion(`${animation.frames.length} animation frame${animation.frames.length === 1 ? "" : "s"} at ${animation.fps}fps, ${animation.durationMs}ms total.`)
    toast.success("Timeline converted to frame animation metadata")
  }

  const exportAudioMix = async () => {
    if (!audioTracks.length) {
      toast.error("No audio tracks to mix")
      return
    }
    setAudioRendering(true)
    try {
      const timelineDuration = frames.reduce((sum, frame) => sum + Math.max(0, frame.durationMs), 0)
      const audioDuration = audioTracks.reduce((max, track) => Math.max(max, track.startMs + track.durationMs), 0)
      const blob = await renderAudioMixToWavBlob(audioTracks, {
        durationMs: Math.max(timelineDuration, audioDuration, 1),
        sampleRate: 48_000,
        masterVolume: 1,
      })
      downloadBlob(blob, `${activeDoc.name}-audio-mix.wav`)
      toast.success("Exported WAV audio mix")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export audio mix")
    } finally {
      setAudioRendering(false)
    }
  }

  const renderVideo = async () => {
    const preset = resolveVideoExportPreset(presetId)
    const timeline = frames.length ? frames : [{
      id: uid("frame"),
      name: "Current",
      durationMs: 1000,
      layerVisibility: Object.fromEntries(activeDoc.layers.map((layer) => [layer.id, layer.visible])),
      layerOpacity: Object.fromEntries(activeDoc.layers.map((layer) => [layer.id, layer.opacity])),
      transition: "hold" as const,
    }]
    const wantsMp4 = preset.codec === "h264" && MediaRecorder.isTypeSupported("video/mp4;codecs=avc1.42E01E")
    const mime = wantsMp4
      ? "video/mp4;codecs=avc1.42E01E"
      : preset.codec === "vp9" && MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm"
    setRendering(true)
    setProgress("Starting encoder")
    try {
      const canvas = createSubsystemCanvas(preset.width, preset.height)
      const stream = canvas.captureStream(preset.fps)
      const chunks: Blob[] = []
      const recorder = new MediaRecorder(stream, { mimeType: mime })
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      const done = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mime }))
      })
      recorder.start()
      for (let i = 0; i < timeline.length; i++) {
        const frame = timeline[i]
        setProgress(`Rendering ${i + 1}/${timeline.length}`)
        const variant: PsDocument = {
          ...activeDoc,
          layers: activeDoc.layers.map((layer) => ({
            ...layer,
            visible: frame.layerVisibility[layer.id] ?? layer.visible,
            opacity: frame.layerOpacity?.[layer.id] ?? layer.opacity,
          })),
        }
        const flat = renderDocumentComposite(variant, { transparent: false })
        canvas.getContext("2d")!.drawImage(flat, 0, 0, preset.width, preset.height)
        await new Promise((resolve) => window.setTimeout(resolve, Math.max(80, frame.durationMs)))
      }
      recorder.stop()
      const blob = await done
      const ext = mime.includes("mp4") ? "mp4" : "webm"
      downloadBlob(blob, `${activeDoc.name}-${preset.id}.${ext}`)
      toast.success(ext === "mp4" ? `Rendered ${preset.label}` : `Rendered WebM fallback for ${preset.label}`)
    } finally {
      setRendering(false)
      setProgress("")
      requestRender()
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Panel title="Video Layers & Timeline">
        <CapabilityNotice>
          Video support stores poster frames, trim ranges, split clips, transitions, video groups, frame-animation conversion, and audio mix metadata. Browser MediaRecorder support still controls the final encoded container.
        </CapabilityNotice>
        <div className="grid grid-cols-3 gap-2">
          <FileButton accept="video/*" label="Import Video" onFile={importVideo} />
          <FileButton accept="audio/*" label="Add Audio" onFile={addAudioTrack} />
          <Button size="sm" onClick={captureTimelineFrame}>Capture Frame</Button>
        </div>
        <NumberField label="Time ms" value={timeMs} min={0} max={600000} step={100} onChange={setTimeMs} />
        <Button size="sm" variant="secondary" disabled={!activeLayer} onClick={addOpacityKeyframe}>Add Opacity Keyframe</Button>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="secondary" disabled={!activeVideoLayer} onClick={trimActiveClip}>Trim In Here</Button>
          <Button size="sm" variant="secondary" disabled={!activeVideoLayer} onClick={splitActiveClip}>Split Clip</Button>
          <Button size="sm" variant="secondary" disabled={!activeVideoLayer} onClick={addTransition}>Add Dissolve</Button>
          <Button size="sm" variant="secondary" disabled={!activeVideoLayer && !selectedVideoLayers.length} onClick={makeVideoGroup}>Video Group</Button>
        </div>
        <div className="mt-3 max-h-72 overflow-y-auto rounded-sm border border-[var(--ps-divider)]">
          {frames.length ? frames.map((frame, index) => (
            <div key={frame.id} className="grid grid-cols-[40px_1fr_auto] gap-2 border-b border-[var(--ps-divider)] p-2 text-[11px]">
              <span className="text-[var(--ps-text-dim)]">#{index + 1}</span>
              <span>{frame.name}</span>
              <span>{frame.durationMs}ms</span>
            </div>
          )) : <EmptyState text="Capture frames or keyframes to build the video timeline." />}
        </div>
      </Panel>
      <Panel title="Render">
        <SelectField label="Preset" value={presetId} onChange={setPresetId} options={VIDEO_EXPORT_PRESETS.map((preset) => preset.id)} />
        {currentDiagnostic ? (
          <p
            className={`mt-1 text-[11px] ${currentDiagnostic.fallbackToPackage && currentDiagnostic.deliveryMode === "muxed-media" ? "text-amber-500" : "text-[var(--ps-text-dim)]"}`}
            title={currentDiagnostic.candidateMimeTypes.join(", ")}
          >
            {currentDiagnostic.reason}
          </p>
        ) : null}
        <Button disabled={rendering} onClick={renderVideo}>{rendering ? "Rendering..." : "Render Video"}</Button>
        <Button className="mt-2" size="sm" variant="secondary" disabled={!frames.length} onClick={convertFrames}>Convert to Frame Animation</Button>
        <Button className="mt-2" size="sm" variant="secondary" disabled={!audioTracks.length || audioRendering} onClick={exportAudioMix}>
          {audioRendering ? "Mixing Audio..." : "Export WAV Mix"}
        </Button>
        <p className="mt-2 text-[11px] text-[var(--ps-text-dim)]">{progress || "Uses H.264 MP4 when the browser exposes it, otherwise WebM."}</p>
        {frameConversion ? <p className="mt-2 text-[11px] text-[var(--ps-text-dim)]">{frameConversion}</p> : null}
        <details className="mt-3 text-[11px] text-[var(--ps-text-dim)]">
          <summary className="cursor-pointer">Browser codec support</summary>
          <ul className="mt-1 space-y-0.5">
            {presetDiagnostics.map((entry) => {
              const status = entry.deliveryMode === "muxed-media"
                ? entry.willMuxNatively ? "native" : "fallback"
                : entry.deliveryMode === "animated-image" ? "gif" : "zip"
              const statusColor = status === "native" ? "text-emerald-500"
                : status === "fallback" ? "text-amber-500"
                : "text-[var(--ps-text-dim)]"
              return (
                <li key={entry.preset.id} className="flex justify-between gap-2">
                  <span>{entry.preset.label}</span>
                  <span className={statusColor}>{status === "native" ? entry.resolvedMimeType : status}</span>
                </li>
              )
            })}
          </ul>
        </details>
        <p className="mt-4 text-[11px]">Video layers: {activeDoc.layers.filter((layer) => layer.kind === "video").length}</p>
        <p className="text-[11px]">Audio tracks: {audioTracks.length}; active mix L {Math.round(audioMix.leftGain * 100)}% / R {Math.round(audioMix.rightGain * 100)}%</p>
      </Panel>
    </div>
  )
}
