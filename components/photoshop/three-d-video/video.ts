import type { AudioTrack, Layer, TimelineFrame, VideoExportPreset, VideoGroupProps, VideoLayerProps, VideoTransition } from "../types"
import { uid } from "../uid"
import { clamp } from "./math"

export interface VideoThumbnailPlanItem {
  index: number
  timeMs: number
  label: string
}

export interface VideoClipTrackState {
  durationMs: number
  inPointMs: number
  outPointMs: number
  playheadMs: number
  inPercent: number
  outPercent: number
  clipWidthPercent: number
  playheadPercent: number
  frameStepMs: number
  canSplit: boolean
  labels: { in: string; out: string; playhead: string }
}

export interface VideoTransitionWeights {
  progress: number
  fromOpacity: number
  toOpacity: number
  matteOpacity: number
  matteColor: string | null
  wipeProgress: number
}

export interface FrameAnimation {
  fps: number
  durationMs: number
  frames: Array<{
    id: string
    sourceFrameId: string
    timeMs: number
    durationMs: number
    layerVisibility: Record<string, boolean>
    layerOpacity?: Record<string, number>
    transition: TimelineFrame["transition"]
    transitionProgress: number
  }>
}

export interface BrowserMuxCapability {
  supported: boolean
  mimeType: string | null
  reason: string
}

export interface BrowserMuxCapabilityOptions {
  container?: VideoExportPreset["container"]
  codec?: VideoExportPreset["codec"]
  audio?: boolean
  candidates?: string[]
}

export interface FinalVideoExportPlan {
  preset: VideoExportPreset
  mode: "muxed-media" | "timeline-package" | "animated-image" | "png-sequence"
  container: VideoExportPreset["container"]
  extension: string
  mimeType: string
  codec: VideoExportPreset["codec"]
  fps: number
  width: number
  height: number
  durationMs: number
  frameCount: number
  audioTrackCount: number
  warnings: string[]
  muxCapability: BrowserMuxCapability
}

export interface VideoTrimHandleModel {
  state: VideoClipTrackState
  keyboardNudgeMs: number
  handles: {
    in: { timeMs: number; percent: number; frameIndex: number; label: string }
    out: { timeMs: number; percent: number; frameIndex: number; label: string }
    playhead: { timeMs: number; percent: number; frameIndex: number; label: string }
  }
  thumbnails: Array<VideoThumbnailPlanItem & { leftPercent: number; active: boolean }>
  ticks: Array<{ timeMs: number; leftPercent: number; label: string; frameIndex: number }>
}

export const VIDEO_EXPORT_PRESETS: VideoExportPreset[] = [
  { id: "draft-webm", label: "Draft WebM 720p", width: 1280, height: 720, fps: 24, codec: "webm", bitrateKbps: 2800, audioKbps: 128, container: "webm" },
  { id: "social-1080p", label: "Social H.264 1080p", width: 1920, height: 1080, fps: 30, codec: "h264", bitrateKbps: 8000, audioKbps: 192, container: "mp4" },
  { id: "archive-4k", label: "Archive VP9 4K", width: 3840, height: 2160, fps: 30, codec: "vp9", bitrateKbps: 28000, audioKbps: 320, container: "webm" },
  { id: "frame-gif", label: "Frame Animation GIF", width: 1080, height: 1080, fps: 12, codec: "gif", bitrateKbps: 0, audioKbps: 0, container: "gif" },
  { id: "png-sequence", label: "PNG Sequence", width: 1920, height: 1080, fps: 24, codec: "png-sequence", bitrateKbps: 0, audioKbps: 0, container: "zip" },
]

function browserMuxCandidates(input: string[] | BrowserMuxCapabilityOptions): string[] {
  if (Array.isArray(input)) return input
  if (input.candidates?.length) return input.candidates
  const audio = input.audio !== false
  const audioSuffix = audio ? ",opus" : ""
  const mp4AudioSuffix = audio ? ",mp4a.40.2" : ""
  const requestedMp4 = input.container === "mp4" || input.codec === "h264"
  const requestedWebm = input.container === "webm" || input.codec === "vp9" || input.codec === "webm"
  const mp4 = [
    `video/mp4;codecs=avc1.42E01E${mp4AudioSuffix}`,
    `video/mp4;codecs=avc1.4d401f${mp4AudioSuffix}`,
    audio ? "video/mp4;codecs=h264,aac" : "video/mp4;codecs=h264",
    "video/mp4",
  ]
  const webm = [
    `video/webm;codecs=vp9${audioSuffix}`,
    `video/webm;codecs=vp8${audioSuffix}`,
    audio ? "video/webm;codecs=h264,opus" : "video/webm;codecs=h264",
    "video/webm",
  ]
  if (requestedMp4 && !requestedWebm) return [...mp4, ...webm]
  if (requestedWebm && !requestedMp4) return [...webm, ...mp4]
  return webm
}

export function getBrowserMuxCapability(input: string[] | BrowserMuxCapabilityOptions = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=h264,opus",
  "video/webm",
]): BrowserMuxCapability {
  const candidates = browserMuxCandidates(input)
  const Recorder = globalThis.MediaRecorder
  if (!Recorder) {
    return {
      supported: false,
      mimeType: null,
      reason: "MediaRecorder is not available in this browser, so browser-side audio/video muxing is unavailable.",
    }
  }
  if (typeof Recorder.isTypeSupported !== "function") {
    return {
      supported: true,
      mimeType: "",
      reason: "MediaRecorder is available; this browser does not expose MIME probing.",
    }
  }
  const mimeType = candidates.find((candidate) => Recorder.isTypeSupported(candidate)) ?? null
  if (!mimeType) {
    return {
      supported: false,
      mimeType: null,
      reason: `MediaRecorder is available, but none of the requested audio/video MIME candidates are supported: ${candidates.join(", ")}.`,
    }
  }
  return {
    supported: true,
    mimeType,
    reason: `MediaRecorder can mux timeline video and audio as ${mimeType}.`,
  }
}

export type VideoPresetDeliveryMode = "muxed-media" | "animated-image" | "png-sequence"

export interface VideoPresetDiagnostic {
  preset: VideoExportPreset
  deliveryMode: VideoPresetDeliveryMode
  willMuxNatively: boolean
  fallbackToPackage: boolean
  candidateMimeTypes: string[]
  resolvedMimeType: string | null
  reason: string
}

function deliveryModeForPreset(preset: VideoExportPreset): VideoPresetDeliveryMode {
  if (preset.codec === "gif" || preset.container === "gif") return "animated-image"
  if (preset.codec === "png-sequence" || preset.container === "zip") return "png-sequence"
  return "muxed-media"
}

export function getVideoPresetDiagnostic(preset: VideoExportPreset): VideoPresetDiagnostic {
  const deliveryMode = deliveryModeForPreset(preset)
  if (deliveryMode === "animated-image") {
    return {
      preset,
      deliveryMode,
      willMuxNatively: false,
      fallbackToPackage: false,
      candidateMimeTypes: ["image/gif"],
      resolvedMimeType: "image/gif",
      reason: "Frame animation is encoded directly via the in-browser GIF encoder; no MediaRecorder required.",
    }
  }
  if (deliveryMode === "png-sequence") {
    return {
      preset,
      deliveryMode,
      willMuxNatively: false,
      fallbackToPackage: true,
      candidateMimeTypes: ["application/zip"],
      resolvedMimeType: "application/zip",
      reason: "PNG sequence is packaged as ZIP (frames + timeline manifest + optional WAV mix); no muxing required.",
    }
  }
  const candidates = browserMuxCandidates({
    container: preset.container,
    codec: preset.codec,
    audio: preset.audioKbps > 0,
  })
  const mux = getBrowserMuxCapability(candidates)
  return {
    preset,
    deliveryMode,
    willMuxNatively: mux.supported && Boolean(mux.mimeType),
    fallbackToPackage: !mux.supported || !mux.mimeType,
    candidateMimeTypes: candidates,
    resolvedMimeType: mux.mimeType,
    reason: mux.supported && mux.mimeType
      ? `Browser muxes this preset natively as ${mux.mimeType}.`
      : `Browser cannot mux this preset; export falls back to PNG sequence ZIP. ${mux.reason}`,
  }
}

export function getVideoPresetDiagnostics(): VideoPresetDiagnostic[] {
  return VIDEO_EXPORT_PRESETS.map((preset) => getVideoPresetDiagnostic(preset))
}

function timelineTransitionProgress(frame: TimelineFrame, sampleIndex: number, sampleCount: number) {
  if (!frame.transition || frame.transition === "hold") return 0
  const frameDuration = Math.max(1, Math.round(frame.durationMs))
  const transitionDuration = clamp(Math.round(frame.transitionDurationMs ?? frameDuration), 1, frameDuration)
  const elapsed = sampleCount <= 1 ? frameDuration : (sampleIndex / Math.max(1, sampleCount - 1)) * frameDuration
  const transitionStart = Math.max(0, frameDuration - transitionDuration)
  const raw = (elapsed - transitionStart) / transitionDuration
  return clamp(raw, 0, 1)
}

export function trimVideoClip(video: VideoLayerProps, inPointMs: number, outPointMs: number): VideoLayerProps {
  const start = clamp(Math.round(inPointMs), 0, Math.max(0, video.durationMs))
  const end = clamp(Math.round(outPointMs), start, Math.max(start, video.durationMs))
  return {
    ...video,
    inPointMs: start,
    outPointMs: end,
    currentTimeMs: clamp(video.currentTimeMs, start, end),
    trimHandles: { inMs: start, outMs: end },
    keyframes: video.keyframes.filter((keyframe) => keyframe.timeMs >= start && keyframe.timeMs <= end),
  }
}

export function snapTimeToFrame(timeMs: number, fps: number): number {
  const safeFps = Math.max(1, Math.round(Number.isFinite(fps) ? fps : 1))
  const frameMs = 1000 / safeFps
  return Math.round(Math.max(0, timeMs) / frameMs) * frameMs
}

export function trimVideoClipToFrame(video: VideoLayerProps, inPointMs: number, outPointMs: number, fps: number): VideoLayerProps {
  const start = snapTimeToFrame(inPointMs, fps)
  const end = snapTimeToFrame(outPointMs, fps)
  const trimmed = trimVideoClip(video, start, Math.max(start, end))
  return {
    ...trimmed,
    currentTimeMs: clamp(Math.round(snapTimeToFrame(trimmed.currentTimeMs, fps)), trimmed.inPointMs, trimmed.outPointMs),
  }
}

export function buildVideoClipTrackState(
  video: VideoLayerProps,
  playheadMs: number = video.currentTimeMs,
  options: { fps?: number } = {},
): VideoClipTrackState {
  const fps = Math.max(1, Math.round(options.fps ?? 24))
  const frameStepMs = Math.max(1, Math.round(1000 / fps))
  const durationMs = Math.max(1, Math.round(video.durationMs))
  const inPointMs = clamp(Math.round(snapTimeToFrame(video.trimHandles?.inMs ?? video.inPointMs, fps)), 0, durationMs)
  const outPointMs = clamp(
    Math.round(snapTimeToFrame(video.trimHandles?.outMs ?? video.outPointMs, fps)),
    inPointMs,
    durationMs,
  )
  const playhead = clamp(Math.round(snapTimeToFrame(playheadMs, fps)), inPointMs, outPointMs)
  const percent = (value: number) => clamp((value / durationMs) * 100, 0, 100)
  const inPercent = percent(inPointMs)
  const outPercent = percent(outPointMs)
  const playheadPercent = percent(playhead)
  return {
    durationMs,
    inPointMs,
    outPointMs,
    playheadMs: playhead,
    inPercent,
    outPercent,
    clipWidthPercent: Math.max(0, outPercent - inPercent),
    playheadPercent,
    frameStepMs,
    canSplit: playhead - inPointMs >= frameStepMs && outPointMs - playhead >= frameStepMs,
    labels: {
      in: `${(inPointMs / 1000).toFixed(2)}s`,
      out: `${(outPointMs / 1000).toFixed(2)}s`,
      playhead: `${(playhead / 1000).toFixed(2)}s`,
    },
  }
}

function labelTime(timeMs: number) {
  return `${(timeMs / 1000).toFixed(2)}s`
}

function frameIndexForTime(timeMs: number, frameStepMs: number) {
  return Math.round(timeMs / Math.max(1, frameStepMs))
}

export function buildVideoTrimHandleModel(
  video: VideoLayerProps,
  playheadMs: number = video.currentTimeMs,
  options: { fps?: number; thumbnails?: VideoThumbnailPlanItem[]; maxTickCount?: number } = {},
): VideoTrimHandleModel {
  const state = buildVideoClipTrackState(video, playheadMs, { fps: options.fps })
  const durationMs = Math.max(1, state.durationMs)
  const percent = (timeMs: number) => clamp((timeMs / durationMs) * 100, 0, 100)
  const handle = (timeMs: number, leftPercent: number, label: string) => ({
    timeMs,
    percent: leftPercent,
    frameIndex: frameIndexForTime(timeMs, state.frameStepMs),
    label,
  })
  const maxTickCount = clamp(Math.round(options.maxTickCount ?? 8), 2, 24)
  const tickStep = durationMs / (maxTickCount - 1)
  const ticks = Array.from({ length: maxTickCount }, (_, index) => {
    const raw = index === maxTickCount - 1 ? durationMs : index * tickStep
    const timeMs = Math.round(snapTimeToFrame(raw, options.fps ?? 24))
    return {
      timeMs,
      leftPercent: percent(timeMs),
      label: labelTime(timeMs),
      frameIndex: frameIndexForTime(timeMs, state.frameStepMs),
    }
  })
  const thumbnails = (options.thumbnails ?? buildVideoThumbnailPlan(video, { count: 8, fps: options.fps })).map((item) => ({
    ...item,
    leftPercent: percent(item.timeMs),
    active: Math.abs(item.timeMs - state.playheadMs) <= state.frameStepMs,
  }))
  return {
    state,
    keyboardNudgeMs: state.frameStepMs,
    handles: {
      in: handle(state.inPointMs, state.inPercent, state.labels.in),
      out: handle(state.outPointMs, state.outPercent, state.labels.out),
      playhead: handle(state.playheadMs, state.playheadPercent, state.labels.playhead),
    },
    thumbnails,
    ticks,
  }
}

function cloneCanvas(canvas: HTMLCanvasElement) {
  const next = document.createElement("canvas")
  next.width = canvas.width
  next.height = canvas.height
  next.getContext("2d")?.drawImage(canvas, 0, 0)
  return next
}

export function splitVideoLayer(layer: Layer, splitTimeMs: number): [Layer, Layer] {
  if (!layer.video) return [layer, { ...layer, id: `${layer.id}_split`, name: `${layer.name} split`, canvas: cloneCanvas(layer.canvas) }]
  const split = clamp(Math.round(splitTimeMs), layer.video.inPointMs, layer.video.outPointMs)
  const leftVideo = trimVideoClip(layer.video, layer.video.inPointMs, split)
  const rightVideo = trimVideoClip(layer.video, split, layer.video.outPointMs)
  const left: Layer = { ...layer, video: leftVideo }
  const right: Layer = {
    ...layer,
    id: `${layer.id}_split_${split}`,
    name: `${layer.name} split`,
    canvas: cloneCanvas(layer.canvas),
    video: rightVideo,
  }
  return [left, right]
}

export function splitVideoLayerAtPlayhead(layer: Layer, playheadMs: number, fps: number): [Layer, Layer] {
  return splitVideoLayer(layer, snapTimeToFrame(playheadMs, fps))
}

export function applyVideoTransition(video: VideoLayerProps, transition: Omit<VideoTransition, "id"> & { id?: string }): VideoLayerProps {
  const next: VideoTransition = { ...transition, id: transition.id ?? uid("transition") }
  return { ...video, transitions: [...(video.transitions ?? []), next] }
}

export function updateVideoTransitionDuration(video: VideoLayerProps, transitionId: string | undefined, durationMs: number): VideoLayerProps {
  const duration = clamp(Math.round(durationMs), 0, Math.max(0, video.durationMs))
  const transitions = video.transitions ?? []
  if (!transitions.length) {
    return applyVideoTransition(video, { kind: "cross-dissolve", durationMs: duration, easing: "linear" })
  }
  return {
    ...video,
    transitions: transitions.map((transition, index) =>
      (transitionId ? transition.id === transitionId : index === 0)
        ? { ...transition, durationMs: duration }
        : transition,
    ),
  }
}

export function buildVideoThumbnailPlan(
  video: VideoLayerProps,
  options: { count?: number; fps?: number } = {},
): VideoThumbnailPlanItem[] {
  const count = clamp(Math.round(options.count ?? 8), 1, 48)
  const fps = Math.max(1, Math.round(options.fps ?? 24))
  const start = video.trimHandles?.inMs ?? video.inPointMs
  const end = video.trimHandles?.outMs ?? video.outPointMs
  const span = Math.max(0, end - start)
  return Array.from({ length: count }, (_, index) => {
    const raw = count === 1 ? start : start + (span * index) / (count - 1)
    const timeMs = clamp(Math.round(snapTimeToFrame(raw, fps)), 0, Math.max(0, video.durationMs))
    return {
      index,
      timeMs,
      label: `${(timeMs / 1000).toFixed(2)}s`,
    }
  })
}

export function createVideoElementForSource(source: string): HTMLVideoElement {
  const video = document.createElement("video")
  video.src = source
  video.muted = true
  video.preload = "auto"
  video.crossOrigin = "anonymous"
  video.playsInline = true
  return video
}

export function waitForVideoMetadata(video: HTMLVideoElement, options: { timeoutMs?: number } = {}): Promise<void> {
  if (Number.isFinite(video.duration) && video.readyState >= 1) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timeoutMs = Math.max(1, Math.round(options.timeoutMs ?? 15_000))
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      video.removeEventListener("loadedmetadata", onLoaded)
      video.removeEventListener("error", onError)
    }
    const onLoaded = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error("Could not read video metadata"))
    }
    const onTimeout = () => {
      cleanup()
      reject(new Error(`Timed out after ${timeoutMs}ms while reading video metadata`))
    }
    video.addEventListener("loadedmetadata", onLoaded, { once: true })
    video.addEventListener("error", onError, { once: true })
    timer = setTimeout(onTimeout, timeoutMs)
  })
}

export async function seekVideoElement(video: HTMLVideoElement, timeMs: number, options: { timeoutMs?: number } = {}): Promise<void> {
  await waitForVideoMetadata(video, options)
  const target = clamp(timeMs / 1000, 0, Math.max(0, video.duration || 0))
  if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) return
  await new Promise<void>((resolve, reject) => {
    const timeoutMs = Math.max(1, Math.round(options.timeoutMs ?? 15_000))
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      video.removeEventListener("seeked", onSeeked)
      video.removeEventListener("error", onError)
    }
    const onSeeked = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error("Could not seek video frame"))
    }
    const onTimeout = () => {
      cleanup()
      reject(new Error(`Timed out after ${timeoutMs}ms while seeking video frame`))
    }
    video.addEventListener("seeked", onSeeked, { once: true })
    video.addEventListener("error", onError, { once: true })
    video.currentTime = target
    timer = setTimeout(onTimeout, timeoutMs)
  })
}

export async function extractVideoFrameToCanvas(
  video: HTMLVideoElement,
  timeMs: number,
  options: { width: number; height: number; timeoutMs?: number },
): Promise<HTMLCanvasElement> {
  await seekVideoElement(video, timeMs, { timeoutMs: options.timeoutMs })
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(options.width))
  canvas.height = Math.max(1, Math.round(options.height))
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("2D context unavailable")
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas
}

export async function extractVideoThumbnailStrip(
  source: string | HTMLVideoElement,
  video: VideoLayerProps,
  options: { count?: number; fps?: number; width: number; height: number; timeoutMs?: number },
): Promise<Array<VideoThumbnailPlanItem & { canvas: HTMLCanvasElement; dataUrl: string }>> {
  const element = typeof source === "string" ? createVideoElementForSource(source) : source
  const plan = buildVideoThumbnailPlan(video, options)
  const out: Array<VideoThumbnailPlanItem & { canvas: HTMLCanvasElement; dataUrl: string }> = []
  for (const item of plan) {
    const canvas = await extractVideoFrameToCanvas(element, item.timeMs, options)
    out.push({ ...item, canvas, dataUrl: canvas.toDataURL("image/jpeg", 0.72) })
  }
  return out
}

function transitionEase(progress: number, easing: VideoTransition["easing"] = "linear") {
  const t = clamp(progress, 0, 1)
  if (easing === "ease-in") return t * t
  if (easing === "ease-out") return 1 - (1 - t) * (1 - t)
  if (easing === "ease-in-out") return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
  return t
}

export function calculateTransitionWeights(
  transition: Pick<VideoTransition, "kind" | "durationMs" | "easing">,
  localTimeMs: number,
  direction: "in" | "out" = "in",
): VideoTransitionWeights {
  const duration = Math.max(1, transition.durationMs)
  const progress = transitionEase(localTimeMs / duration, transition.easing)
  if (transition.kind === "cross-dissolve") {
    return { progress, fromOpacity: 1 - progress, toOpacity: progress, matteOpacity: 0, matteColor: null, wipeProgress: progress }
  }
  if (transition.kind === "fade-black" || transition.kind === "fade-white") {
    const matteColor = transition.kind === "fade-white" ? "#ffffff" : "#000000"
    if (direction === "out") {
      return { progress, fromOpacity: 1 - progress, toOpacity: 0, matteOpacity: progress, matteColor, wipeProgress: progress }
    }
    return { progress, fromOpacity: progress, toOpacity: 0, matteOpacity: 1 - progress, matteColor, wipeProgress: progress }
  }
  if (transition.kind === "wipe-left" || transition.kind === "wipe-right") {
    return { progress, fromOpacity: 1, toOpacity: 1, matteOpacity: 0, matteColor: null, wipeProgress: progress }
  }
  return { progress, fromOpacity: 1, toOpacity: 0, matteOpacity: 0, matteColor: null, wipeProgress: 0 }
}

export function renderVideoTransitionPreview(
  fromCanvas: HTMLCanvasElement,
  toCanvas: HTMLCanvasElement | null | undefined,
  transition: Pick<VideoTransition, "kind" | "durationMs" | "easing">,
  localTimeMs: number,
  options: { width?: number; height?: number; direction?: "in" | "out" } = {},
): HTMLCanvasElement {
  const width = Math.max(1, Math.round(options.width ?? fromCanvas.width ?? toCanvas?.width ?? 1))
  const height = Math.max(1, Math.round(options.height ?? fromCanvas.height ?? toCanvas?.height ?? 1))
  const out = document.createElement("canvas")
  out.width = width
  out.height = height
  const ctx = out.getContext("2d")
  if (!ctx) return out
  const weights = calculateTransitionWeights(transition, localTimeMs, options.direction)
  const target = toCanvas ?? fromCanvas

  ctx.clearRect(0, 0, width, height)
  if (weights.matteColor && weights.matteOpacity > 0) {
    ctx.save()
    ctx.globalAlpha = weights.matteOpacity
    ctx.fillStyle = weights.matteColor
    ctx.fillRect(0, 0, width, height)
    ctx.restore()
  }
  if (transition.kind === "wipe-left" || transition.kind === "wipe-right") {
    ctx.drawImage(fromCanvas, 0, 0, width, height)
    ctx.save()
    const wipeWidth = width * weights.wipeProgress
    const x = transition.kind === "wipe-right" ? 0 : width - wipeWidth
    ctx.beginPath()
    ctx.rect(x, 0, wipeWidth, height)
    ctx.clip()
    ctx.drawImage(target, 0, 0, width, height)
    ctx.restore()
    return out
  }

  if (weights.fromOpacity > 0) {
    ctx.save()
    ctx.globalAlpha = weights.fromOpacity
    ctx.drawImage(fromCanvas, 0, 0, width, height)
    ctx.restore()
  }
  if (weights.toOpacity > 0 && target) {
    ctx.save()
    ctx.globalAlpha = weights.toOpacity
    ctx.drawImage(target, 0, 0, width, height)
    ctx.restore()
  }
  return out
}

export function createVideoGroup(
  layers: Layer[],
  options: { name?: string; transition?: VideoTransition["kind"] } = {},
): { group: Layer; layers: Layer[] } {
  const groupId = uid("video_group")
  const durationMs = layers.reduce((sum, layer) => sum + Math.max(0, (layer.video?.outPointMs ?? 0) - (layer.video?.inPointMs ?? 0)), 0)
  const canvas = layers[0]?.canvas ? cloneCanvas(layers[0].canvas) : document.createElement("canvas")
  const videoGroup: VideoGroupProps = {
    id: groupId,
    name: options.name ?? "Video Group",
    layerIds: layers.map((layer) => layer.id),
    durationMs,
    transition: options.transition,
  }
  return {
    group: {
      id: groupId,
      name: videoGroup.name,
      kind: "group",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      canvas,
      childIds: videoGroup.layerIds,
      expanded: true,
      videoGroup,
    },
    layers: layers.map((layer) => ({ ...layer, parentId: groupId, video: layer.video ? { ...layer.video, trackGroupId: groupId } : layer.video })),
  }
}

function extensionForMime(mimeType: string, fallback: VideoExportPreset["container"]) {
  if (/video\/mp4/i.test(mimeType)) return "mp4"
  if (/video\/webm/i.test(mimeType)) return "webm"
  if (/image\/gif/i.test(mimeType)) return "gif"
  if (fallback === "mp4") return "mp4"
  if (fallback === "webm") return "webm"
  if (fallback === "gif") return "gif"
  return "zip"
}

function containerForMime(mimeType: string, fallback: VideoExportPreset["container"]): VideoExportPreset["container"] {
  const extension = extensionForMime(mimeType, fallback)
  if (extension === "mp4" || extension === "webm" || extension === "gif" || extension === "zip") return extension
  return fallback
}

export function buildFinalVideoExportPlan(
  preset: VideoExportPreset,
  frames: TimelineFrame[],
  audioTracks: AudioTrack[] = [],
  options: { muxCapability?: BrowserMuxCapability } = {},
): FinalVideoExportPlan {
  const timelineDuration = frames.reduce((sum, frame) => sum + Math.max(0, Math.round(frame.durationMs)), 0)
  const playableAudio = audioTracks.filter((track) => !track.muted && !!track.dataUrl && track.durationMs > 0)
  const audioDuration = playableAudio.reduce((max, track) => Math.max(max, Math.max(0, track.startMs) + Math.max(0, track.durationMs)), 0)
  const durationMs = Math.max(1, timelineDuration, audioDuration)

  if (preset.codec === "gif" || preset.container === "gif") {
    return {
      preset,
      mode: "animated-image",
      container: "gif",
      extension: "gif",
      mimeType: "image/gif",
      codec: preset.codec,
      fps: preset.fps,
      width: preset.width,
      height: preset.height,
      durationMs,
      frameCount: frames.length,
      audioTrackCount: 0,
      warnings: playableAudio.length ? ["GIF export does not carry audio; export the WAV mix or package instead."] : [],
      muxCapability: { supported: true, mimeType: "image/gif", reason: "Animated GIF export uses the in-app frame encoder." },
    }
  }

  if (preset.codec === "png-sequence" || preset.container === "zip") {
    return {
      preset,
      mode: "png-sequence",
      container: "zip",
      extension: "zip",
      mimeType: "application/zip",
      codec: preset.codec,
      fps: preset.fps,
      width: preset.width,
      height: preset.height,
      durationMs,
      frameCount: frames.length,
      audioTrackCount: playableAudio.length,
      warnings: [],
      muxCapability: { supported: true, mimeType: "application/zip", reason: "PNG sequence export is browser-local and deterministic." },
    }
  }

  const muxCapability = options.muxCapability ?? getBrowserMuxCapability({
    container: preset.container,
    codec: preset.codec,
    audio: playableAudio.length > 0,
  })
  if (muxCapability.supported) {
    const mimeType = muxCapability.mimeType || (preset.container === "mp4" ? "video/mp4" : "video/webm")
    return {
      preset,
      mode: "muxed-media",
      container: containerForMime(mimeType, preset.container),
      extension: extensionForMime(mimeType, preset.container),
      mimeType,
      codec: preset.codec,
      fps: preset.fps,
      width: preset.width,
      height: preset.height,
      durationMs,
      frameCount: frames.length,
      audioTrackCount: playableAudio.length,
      warnings: [],
      muxCapability,
    }
  }

  return {
    preset,
    mode: "timeline-package",
    container: "zip",
    extension: "zip",
    mimeType: "application/zip",
    codec: preset.codec,
    fps: preset.fps,
    width: preset.width,
    height: preset.height,
    durationMs,
    frameCount: frames.length,
    audioTrackCount: playableAudio.length,
    warnings: [
      muxCapability.reason,
      "Falling back to a deterministic frame/audio package with PNG frames, timeline manifest, and optional WAV audio mix.",
    ],
    muxCapability,
  }
}

export function resolveVideoExportPreset(id: string, overrides: Partial<VideoExportPreset> = {}): VideoExportPreset {
  const base = VIDEO_EXPORT_PRESETS.find((preset) => preset.id === id) ?? VIDEO_EXPORT_PRESETS[0]
  return { ...base, ...overrides }
}

export function convertVideoTimelineToFrameAnimation(
  frames: TimelineFrame[],
  options: { fps?: number; includeTransitions?: boolean } = {},
): FrameAnimation {
  const fps = Math.max(1, Math.round(options.fps ?? 12))
  const frameDuration = 1000 / fps
  const out: FrameAnimation["frames"] = []
  let timeMs = 0
  for (const frame of frames) {
    const count = Math.max(1, Math.round(frame.durationMs / frameDuration))
    for (let i = 0; i < count; i++) {
      const progress = options.includeTransitions ? timelineTransitionProgress(frame, i, count) : 0
      out.push({
        id: `${frame.id}_${i}`,
        sourceFrameId: frame.id,
        timeMs: Math.round(timeMs),
        durationMs: Math.round(frameDuration),
        layerVisibility: { ...frame.layerVisibility },
        layerOpacity: frame.layerOpacity ? { ...frame.layerOpacity } : undefined,
        transition: frame.transition ?? "hold",
        transitionProgress: progress,
      })
      timeMs += frameDuration
    }
  }
  return { fps, durationMs: Math.round(timeMs), frames: out }
}
