import { createPrimitiveThreeDScene, exportSceneToDae, exportSceneToObj as _exportSceneToObj, parseDaeToScene } from "./advanced-subsystems"
import type {
  AudioTrack,
  Layer,
  ThreeDCrossSection,
  ThreeDMaterial,
  ThreeDMaterialMaps,
  ThreeDObject,
  ThreeDPrintReport,
  ThreeDScene,
  ThreeDTextureMap,
  ThreeDTexturePixel,
  ThreeDTextureRef,
  ThreeDVertexAnimationFrame,
  TimelineFrame,
  Vec3,
  ThreeDAnimationKeyframe,
  ThreeDAnimationStack,
  ThreeDAnimationTrack,
  VideoExportPreset,
  VideoGroupProps,
  VideoLayerProps,
  ThreeDPrintPlan,
  ThreeDPrintSlice,
  VideoTransition,
} from "./types"
import { hexToRgb } from "./color-utils"
import { uid } from "./uid"

export type AdvancedThreeDFormat = "3ds" | "kmz" | "u3d"

export interface AdvancedThreeDImportResult {
  format: AdvancedThreeDFormat
  scene: ThreeDScene
  warnings: string[]
}

export interface AdvancedThreeDExportResult {
  format: AdvancedThreeDFormat
  fileName: string
  mime: string
  data: string | Uint8Array
  warnings: string[]
}

export interface RayTraceOptions {
  samples?: number
  background?: string
  shadows?: boolean
  viewport?: { x: number; y: number; w: number; h: number }
  documentWidth?: number
  documentHeight?: number
}

export interface AudioMixPlan {
  timeMs: number
  masterVolume: number
  activeTracks: Array<AudioTrack & { gain: number; leftGain: number; rightGain: number; localTimeMs: number }>
  leftGain: number
  rightGain: number
  peakGain: number
}

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

export interface OfflineAudioMixSchedule {
  sampleRate: number
  durationMs: number
  masterVolume: number
  tracks: Array<AudioTrack & {
    startSeconds: number
    durationSeconds: number
    fadeInSeconds: number
    fadeOutSeconds: number
    gain: number
    leftGain: number
    rightGain: number
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

export interface MuxedAudioStreamSchedule {
  sampleRate: number
  durationMs: number
  masterVolume: number
  tracks: Array<AudioTrack & {
    startSeconds: number
    durationSeconds: number
    fadeInSeconds: number
    fadeOutSeconds: number
    gain: number
    leftGain: number
    rightGain: number
    pan: number
    gainAutomation: Array<{ timeSeconds: number; value: number }>
  }>
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
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

function vec(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z }
}

function add(a: Vec3, b: Vec3): Vec3 {
  return vec(a.x + b.x, a.y + b.y, a.z + b.z)
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return vec(a.x - b.x, a.y - b.y, a.z - b.z)
}

function mul(a: Vec3, s: number): Vec3 {
  return vec(a.x * s, a.y * s, a.z * s)
}

function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
}

function length(a: Vec3) {
  return Math.hypot(a.x, a.y, a.z)
}

function normalize(a: Vec3): Vec3 {
  const len = length(a) || 1
  return vec(a.x / len, a.y / len, a.z / len)
}

function rotate(v: Vec3, rotation: Vec3): Vec3 {
  const rx = (rotation.x * Math.PI) / 180
  const ry = (rotation.y * Math.PI) / 180
  const rz = (rotation.z * Math.PI) / 180
  let out = { ...v }
  out = vec(out.x, out.y * Math.cos(rx) - out.z * Math.sin(rx), out.y * Math.sin(rx) + out.z * Math.cos(rx))
  out = vec(out.x * Math.cos(ry) + out.z * Math.sin(ry), out.y, -out.x * Math.sin(ry) + out.z * Math.cos(ry))
  out = vec(out.x * Math.cos(rz) - out.y * Math.sin(rz), out.x * Math.sin(rz) + out.y * Math.cos(rz), out.z)
  return out
}

function transformVertex(vertex: Vec3, object: ThreeDObject): Vec3 {
  const scaled = vec(vertex.x * object.scale.x, vertex.y * object.scale.y, vertex.z * object.scale.z)
  return add(rotate(scaled, object.rotation), object.position)
}

function _rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")).join("")}`
}

function createMaterial(color = "#5ec8ff", name = "Material"): ThreeDMaterial {
  return { id: uid("mat"), name, color, metallic: 0, roughness: 0.45, opacity: 1 }
}

function createObject(name: string, vertices: Vec3[], faces: number[][], materialId: string): ThreeDObject {
  return {
    id: uid("obj"),
    name,
    vertices,
    faces: faces.map((indices) => ({ indices, materialId })),
    materialId,
    position: vec(),
    rotation: vec(18, -28, 0),
    scale: vec(1, 1, 1),
    visible: true,
  }
}

function normalizeMesh(vertices: Vec3[]) {
  if (!vertices.length) return vertices
  const min = vertices.reduce((acc, p) => vec(Math.min(acc.x, p.x), Math.min(acc.y, p.y), Math.min(acc.z, p.z)), vec(Infinity, Infinity, Infinity))
  const max = vertices.reduce((acc, p) => vec(Math.max(acc.x, p.x), Math.max(acc.y, p.y), Math.max(acc.z, p.z)), vec(-Infinity, -Infinity, -Infinity))
  const center = mul(add(min, max), 0.5)
  const scale = 2 / Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 0.01)
  return vertices.map((point) => mul(sub(point, center), scale))
}

function hexFromRgb(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")).join("")}`
}

function bytesFromText(text: string) {
  return new TextEncoder().encode(text)
}

function concatBytes(parts: Uint8Array[]) {
  const size = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function le16(value: number) {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff])
}

function le32(value: number) {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff])
}

function f32le(value: number) {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setFloat32(0, Number.isFinite(value) ? value : 0, true)
  return out
}

function cString(text: string) {
  const safe = text.replace(/\0/g, "").slice(0, 63)
  return concatBytes([bytesFromText(safe), new Uint8Array([0])])
}

function chunk3ds(id: number, ...bodies: Uint8Array[]) {
  const body = concatBytes(bodies)
  return concatBytes([le16(id), le32(body.length + 6), body])
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function zipStoreEntry(fileName: string, data: Uint8Array) {
  const name = bytesFromText(fileName)
  const crc = crc32(data)
  const localHeader = concatBytes([
    le32(0x04034b50),
    le16(20),
    le16(0),
    le16(0),
    le16(0),
    le16(0),
    le32(crc),
    le32(data.length),
    le32(data.length),
    le16(name.length),
    le16(0),
    name,
  ])
  const localOffset = 0
  const centralHeader = concatBytes([
    le32(0x02014b50),
    le16(20),
    le16(20),
    le16(0),
    le16(0),
    le16(0),
    le16(0),
    le32(crc),
    le32(data.length),
    le32(data.length),
    le16(name.length),
    le16(0),
    le16(0),
    le16(0),
    le16(0),
    le32(0),
    le32(localOffset),
    name,
  ])
  const centralOffset = localHeader.length + data.length
  const end = concatBytes([
    le32(0x06054b50),
    le16(0),
    le16(0),
    le16(1),
    le16(1),
    le32(centralHeader.length),
    le32(centralOffset),
    le16(0),
  ])
  return concatBytes([localHeader, data, centralHeader, end])
}

function extractZipStoreEntries(buffer: ArrayBuffer): Array<{ name: string; data: Uint8Array; method: number }> {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const entries: Array<{ name: string; data: Uint8Array; method: number }> = []
  let offset = 0
  while (offset + 30 <= bytes.length) {
    const signature = view.getUint32(offset, true)
    if (signature !== 0x04034b50) break
    const method = view.getUint16(offset + 8, true)
    const compressedSize = view.getUint32(offset + 18, true)
    const fileNameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const nameStart = offset + 30
    const dataStart = nameStart + fileNameLength + extraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > bytes.length) break
    const name = new TextDecoder().decode(bytes.slice(nameStart, nameStart + fileNameLength))
    entries.push({ name, method, data: bytes.slice(dataStart, dataEnd) })
    offset = dataEnd
  }
  return entries
}

function sceneLights() {
  return [
    { id: uid("light"), name: "Ambient", kind: "ambient" as const, color: "#ffffff", intensity: 0.35 },
    { id: uid("light"), name: "Key", kind: "directional" as const, color: "#ffffff", intensity: 0.9, direction: vec(-0.4, -0.65, -0.55) },
  ]
}

function sceneFromMesh(name: string, vertices: Vec3[], faces: number[][], format: AdvancedThreeDFormat, warnings: string[] = []): AdvancedThreeDImportResult {
  const material = createMaterial(format === "3ds" ? "#f4b15f" : format === "kmz" ? "#5ec8ff" : "#9bd87d", `${format.toUpperCase()} Material`)
  const object = createObject(name, normalizeMesh(vertices), faces, material.id)
  return {
    format,
    scene: {
      objects: [object],
      materials: [material],
      lights: sceneLights(),
      camera: { position: vec(0, 0.2, 5), target: vec(0, 0, 0), fov: 42, focalLength: 50 },
      renderMode: "solid-wire",
      background: "transparent",
      selectedObjectId: object.id,
    },
    warnings,
  }
}

function parse3ds(buffer: ArrayBuffer): AdvancedThreeDImportResult {
  const view = new DataView(buffer)
  const warnings: string[] = []
  const materialByName = new Map<string, ThreeDMaterial>()
  const objectRecords: Array<{
    name: string
    vertices: Vec3[]
    faces: number[][]
    uvs: Array<{ u: number; v: number }>
    faceMaterials: string[]
    smoothingGroups: number[]
  }> = []
  // Keyframer (0xB000) animation records collected for round-trip into our
  // ThreeDAnimationStack. 3DS stores POS/ROT/SCL tracks under OBJECT_NODE_TAG.
  const keyTracks: Array<{
    objectName: string
    property: "position" | "rotation" | "scale"
    keyframes: Array<{ frame: number; value: Vec3 }>
  }> = []
  let keyframeFps = 30
  let keyframeStart = 0
  let keyframeEnd = 0
  // Cameras (0x4700) discovered alongside meshes so we can pick a sensible
  // default camera for the imported scene.
  const cameraRecords: Array<{ name: string; position: Vec3; target: Vec3; fov: number }> = []

  const readCString = (offset: number, end: number, fallback: string) => {
    const bytes: number[] = []
    let cursor = offset
    while (cursor < end) {
      const value = view.getUint8(cursor++)
      if (value === 0) break
      bytes.push(value)
    }
    return { text: new TextDecoder().decode(new Uint8Array(bytes)) || fallback, next: cursor }
  }

  const readColor = (start: number, end: number) => {
    let offset = start
    while (offset + 6 <= end) {
      const id = view.getUint16(offset, true)
      const size = view.getUint32(offset + 2, true)
      const body = offset + 6
      const next = offset + size
      if (size < 6 || next > view.byteLength || next > end) break
      if (id === 0x0011 && body + 3 <= next) {
        return hexFromRgb(view.getUint8(body), view.getUint8(body + 1), view.getUint8(body + 2))
      }
      if (id === 0x0010 && body + 12 <= next) {
        return hexFromRgb(view.getFloat32(body, true) * 255, view.getFloat32(body + 4, true) * 255, view.getFloat32(body + 8, true) * 255)
      }
      offset = next
    }
    return "#f4b15f"
  }

  // 3DS percentage chunk: 0x0030 INT_PERCENTAGE (i16) or 0x0031 FLOAT_PERCENTAGE (f32)
  const readPercent = (start: number, end: number): number | undefined => {
    let offset = start
    while (offset + 6 <= end) {
      const id = view.getUint16(offset, true)
      const size = view.getUint32(offset + 2, true)
      const body = offset + 6
      const next = offset + size
      if (size < 6 || next > view.byteLength || next > end) break
      if (id === 0x0030 && body + 2 <= next) return clamp(view.getInt16(body, true) / 100, 0, 1)
      if (id === 0x0031 && body + 4 <= next) return clamp(view.getFloat32(body, true), 0, 1)
      offset = next
    }
    return undefined
  }

  // 3DS material map sub-chunk parser. Captures file name (0xA300), optional
  // strength percentage, and tiling mode flags (0xA351) when present.
  const parseMaterialMap = (start: number, end: number): ThreeDTextureRef => {
    const ref: ThreeDTextureRef = {}
    const strength = readPercent(start, end)
    if (strength !== undefined) ref.strength = strength
    let offset = start
    while (offset + 6 <= end) {
      const id = view.getUint16(offset, true)
      const size = view.getUint32(offset + 2, true)
      const body = offset + 6
      const next = offset + size
      if (size < 6 || next > view.byteLength || next > end) break
      if (id === 0xa300) {
        ref.fileName = readCString(body, next, "").text || undefined
      } else if (id === 0xa351 && body + 2 <= next) {
        const flags = view.getUint16(body, true)
        ref.wrap = (flags & 0x10) ? "mirror" : (flags & 0x01) ? "clamp" : "repeat"
      }
      offset = next
    }
    return ref
  }

  const parseMaterial = (start: number, end: number) => {
    let name = `3DS Material ${materialByName.size + 1}`
    let color = "#f4b15f"
    let specularColor: string | undefined
    let shininess: number | undefined
    let opacity: number | undefined
    let emissive: number | undefined
    const maps: ThreeDMaterialMaps = {}
    let offset = start
    while (offset + 6 <= end) {
      const id = view.getUint16(offset, true)
      const size = view.getUint32(offset + 2, true)
      const body = offset + 6
      const next = offset + size
      if (size < 6 || next > view.byteLength || next > end) break
      if (id === 0xa000) {
        name = readCString(body, next, name).text
      } else if (id === 0xa020) {
        color = readColor(body, next)
      } else if (id === 0xa030) {
        specularColor = readColor(body, next)
      } else if (id === 0xa040) {
        // SHININESS percentage (sharpness of specular)
        shininess = readPercent(body, next)
      } else if (id === 0xa050) {
        // TRANSPARENCY percentage -> opacity = 1 - transparency
        const t = readPercent(body, next)
        if (t !== undefined) opacity = clamp(1 - t, 0, 1)
      } else if (id === 0xa084) {
        // SELF_ILPCT (self-illumination percentage)
        emissive = readPercent(body, next)
      } else if (id === 0xa200) {
        maps.diffuse = parseMaterialMap(body, next)
      } else if (id === 0xa204) {
        maps.specular = parseMaterialMap(body, next)
      } else if (id === 0xa210) {
        maps.opacity = parseMaterialMap(body, next)
      } else if (id === 0xa230) {
        maps.bump = parseMaterialMap(body, next)
      } else if (id === 0xa33a || id === 0xa33c) {
        maps.emissive = parseMaterialMap(body, next)
      } else if (id === 0xa033) {
        // REFL_BLUR percentage -> piggyback into normal/reflectance strength
        maps.normal = maps.normal ?? { strength: readPercent(body, next) }
      }
      offset = next
    }
    const material: ThreeDMaterial = {
      id: uid("mat"),
      name,
      color,
      metallic: 0,
      roughness: clamp(1 - (shininess ?? 0.55), 0, 1),
      opacity: opacity ?? 1,
    }
    if (Object.keys(maps).length) material.maps = maps
    if (specularColor) material.specularColor = specularColor
    if (shininess !== undefined) material.shininess = shininess
    if (emissive !== undefined && emissive > 0) material.emissiveStrength = emissive
    materialByName.set(name, material)
  }

  const parseFaceMaterialGroups = (record: { faces: number[][]; faceMaterials: string[]; smoothingGroups: number[] }, start: number, end: number) => {
    let offset = start
    while (offset + 6 <= end) {
      const id = view.getUint16(offset, true)
      const size = view.getUint32(offset + 2, true)
      const body = offset + 6
      const next = offset + size
      if (size < 6 || next > view.byteLength || next > end) break
      if (id === 0x4130) {
        const named = readCString(body, next, "3DS Material")
        const count = named.next + 2 <= next ? view.getUint16(named.next, true) : 0
        let cursor = named.next + 2
        for (let i = 0; i < count && cursor + 2 <= next; i++) {
          const faceIndex = view.getUint16(cursor, true)
          if (faceIndex >= 0 && faceIndex < record.faces.length) record.faceMaterials[faceIndex] = named.text
          cursor += 2
        }
      } else if (id === 0x4150) {
        // SMOOTHING_GROUP_LIST: one u32 bitmask per face.
        const groups: number[] = []
        let cursor = body
        for (let i = 0; i < record.faces.length && cursor + 4 <= next; i++) {
          groups.push(view.getUint32(cursor, true))
          cursor += 4
        }
        record.smoothingGroups = groups
      }
      offset = next
    }
  }

  const parseCamera = (start: number, end: number, name: string) => {
    if (start + 32 > end) return
    const position = vec(view.getFloat32(start, true), view.getFloat32(start + 4, true), view.getFloat32(start + 8, true))
    const target = vec(view.getFloat32(start + 12, true), view.getFloat32(start + 16, true), view.getFloat32(start + 20, true))
    // skip bank angle at +24, focal length at +28 (in mm). FOV approx 2 * atan(18/focal)
    const focal = view.getFloat32(start + 28, true)
    const fov = focal > 0 ? clamp((2 * Math.atan(18 / focal) * 180) / Math.PI, 5, 170) : 42
    cameraRecords.push({ name, position, target, fov })
  }

  const parseObject = (start: number, end: number) => {
    const named = readCString(start, end, `3DS Mesh ${objectRecords.length + 1}`)
    const record = {
      name: named.text,
      vertices: [] as Vec3[],
      faces: [] as number[][],
      uvs: [] as Array<{ u: number; v: number }>,
      faceMaterials: [] as string[],
      smoothingGroups: [] as number[],
    }
    const walkRecord = (chunkStart: number, chunkEnd: number) => {
      let offset = chunkStart
      while (offset + 6 <= chunkEnd) {
        const id = view.getUint16(offset, true)
        const size = view.getUint32(offset + 2, true)
        const body = offset + 6
        const next = offset + size
        if (size < 6 || next > view.byteLength || next > chunkEnd) break
        if (id === 0x4110) {
          const count = view.getUint16(body, true)
          const parsed: Vec3[] = []
          let cursor = body + 2
          for (let i = 0; i < count && cursor + 12 <= next; i++) {
            parsed.push(vec(view.getFloat32(cursor, true), view.getFloat32(cursor + 4, true), view.getFloat32(cursor + 8, true)))
            cursor += 12
          }
          record.vertices = parsed
        } else if (id === 0x4120) {
          const count = view.getUint16(body, true)
          const parsed: number[][] = []
          let cursor = body + 2
          for (let i = 0; i < count && cursor + 8 <= next; i++) {
            parsed.push([view.getUint16(cursor, true), view.getUint16(cursor + 2, true), view.getUint16(cursor + 4, true)])
            cursor += 8
          }
          record.faces = parsed
          record.faceMaterials = Array.from({ length: parsed.length }, () => "")
          parseFaceMaterialGroups(record, cursor, next)
        } else if (id === 0x4140) {
          const count = view.getUint16(body, true)
          const parsed: Array<{ u: number; v: number }> = []
          let cursor = body + 2
          for (let i = 0; i < count && cursor + 8 <= next; i++) {
            parsed.push({ u: view.getFloat32(cursor, true), v: view.getFloat32(cursor + 4, true) })
            cursor += 8
          }
          record.uvs = parsed
        } else if (id === 0x4700) {
          parseCamera(body, next, record.name)
        } else {
          walkRecord(body, next)
        }
        offset = next
      }
    }
    walkRecord(named.next, end)
    if (record.vertices.length && record.faces.length) objectRecords.push(record)
  }

  // Keyframer (0xB000) chunk parser. Captures POS_TRACK_TAG (0xB020),
  // ROT_TRACK_TAG (0xB021), SCL_TRACK_TAG (0xB022) for each OBJECT_NODE_TAG.
  const parseTrack = (start: number, end: number, property: "position" | "rotation" | "scale", objectName: string) => {
    // Track header layout: flags (2), unknown (8), keyCount (4). Then per-key:
    // frame (4), accel flags (2), [tension+continuity+bias+ease-in+ease-out if flagged], x/y/z (12).
    if (start + 14 > end) return
    let cursor = start + 10
    const keyCount = view.getUint32(cursor, true)
    cursor += 4
    const keys: Array<{ frame: number; value: Vec3 }> = []
    for (let i = 0; i < keyCount && cursor + 6 <= end; i++) {
      const frame = view.getInt32(cursor, true)
      const accel = view.getUint16(cursor + 4, true)
      cursor += 6
      // accel bits: 0x01 tension, 0x02 continuity, 0x04 bias, 0x08 ease-in, 0x10 ease-out
      const splineBits = (accel & 0x01 ? 1 : 0) + (accel & 0x02 ? 1 : 0) + (accel & 0x04 ? 1 : 0) + (accel & 0x08 ? 1 : 0) + (accel & 0x10 ? 1 : 0)
      cursor += splineBits * 4
      if (cursor + 12 > end) break
      const value = vec(view.getFloat32(cursor, true), view.getFloat32(cursor + 4, true), view.getFloat32(cursor + 8, true))
      cursor += 12
      keys.push({ frame, value })
    }
    if (keys.length) keyTracks.push({ objectName, property, keyframes: keys })
  }

  const parseObjectNode = (start: number, end: number) => {
    let name = ""
    let offset = start
    while (offset + 6 <= end) {
      const id = view.getUint16(offset, true)
      const size = view.getUint32(offset + 2, true)
      const body = offset + 6
      const next = offset + size
      if (size < 6 || next > view.byteLength || next > end) break
      if (id === 0xb010) {
        // Name (cstring) + 6 bytes of hierarchy info
        const named = readCString(body, next, "")
        name = named.text
      } else if (id === 0xb020) {
        parseTrack(body, next, "position", name)
      } else if (id === 0xb021) {
        parseTrack(body, next, "rotation", name)
      } else if (id === 0xb022) {
        parseTrack(body, next, "scale", name)
      }
      offset = next
    }
  }

  const parseKeyframer = (start: number, end: number) => {
    let offset = start
    while (offset + 6 <= end) {
      const id = view.getUint16(offset, true)
      const size = view.getUint32(offset + 2, true)
      const body = offset + 6
      const next = offset + size
      if (size < 6 || next > view.byteLength || next > end) break
      if (id === 0xb009 && body + 8 <= next) {
        keyframeStart = view.getInt32(body, true)
        keyframeEnd = view.getInt32(body + 4, true)
      } else if (id === 0xb00a && body + 14 <= next) {
        // KFHDR: revision (2), filename (cstring), animation length (4).
        // We approximate fps by examining filename slot — most exports use 30.
        keyframeFps = 30
      } else if (id === 0xb002) {
        parseObjectNode(body, next)
      }
      offset = next
    }
  }

  const parseObjectChunks = (start: number, end: number): typeof objectRecords[number] | null => {
    const before = objectRecords.length
    let offset = start
    while (offset + 6 <= end) {
      const id = view.getUint16(offset, true)
      const size = view.getUint32(offset + 2, true)
      const body = offset + 6
      const next = offset + size
      if (size < 6 || next > view.byteLength || next > end) {
        offset += 1
        continue
      }
      if (id === 0x4000) parseObject(body, next)
      else if (id === 0xafff) parseMaterial(body, next)
      else if (id === 0xb000) parseKeyframer(body, next)
      else parseObjectChunks(body, next)
      offset = next
    }
    return objectRecords.length > before ? objectRecords[objectRecords.length - 1] : null
  }

  parseObjectChunks(0, view.byteLength)
  if (!objectRecords.length) {
    warnings.push("3DS geometry chunks were not found; imported a cube placeholder.")
    return { format: "3ds", scene: createPrimitiveThreeDScene("cube"), warnings }
  }

  const materials = materialByName.size ? [...materialByName.values()] : [createMaterial("#f4b15f", "3DS Material")]
  const materialIdByName = new Map(materials.map((material) => [material.name, material.id]))
  const objects = objectRecords.map((record, recordIndex) => {
    for (const name of record.faceMaterials.filter(Boolean)) {
      if (!materialIdByName.has(name)) {
        const material = createMaterial("#f4b15f", name)
        materials.push(material)
        materialIdByName.set(name, material.id)
      }
    }
    const fallbackMaterialId = materialIdByName.get(record.faceMaterials.find(Boolean) ?? "") ?? materials[recordIndex % materials.length]?.id ?? materials[0].id
    const object = createObject(record.name, normalizeMesh(record.vertices), record.faces, fallbackMaterialId)
    const built: ThreeDObject = {
      ...object,
      uvs: record.uvs.length === record.vertices.length ? record.uvs : object.uvs,
      faces: object.faces.map((face, faceIndex) => ({
        ...face,
        materialId: materialIdByName.get(record.faceMaterials[faceIndex] ?? "") ?? fallbackMaterialId,
        uvIndices: record.uvs.length === record.vertices.length ? [...face.indices] : face.uvIndices,
      })),
    }
    if (record.smoothingGroups.length) built.smoothingGroups = record.smoothingGroups
    return built
  })

  // Build optional animation stack from collected keyframer tracks.
  const objectIdByName = new Map(objects.map((object) => [object.name, object.id]))
  const tracks: ThreeDAnimationTrack[] = []
  for (const t of keyTracks) {
    const objectId = objectIdByName.get(t.objectName)
    if (!objectId) continue
    tracks.push({
      id: uid("track"),
      target: "object",
      targetId: objectId,
      property: t.property,
      keyframes: t.keyframes.map((key) => ({
        id: uid("key"),
        timeMs: Math.round((key.frame / keyframeFps) * 1000),
        value: key.value,
        easing: "linear",
      })),
    })
  }
  const animations = tracks.length
    ? [{
        id: uid("anim"),
        name: "3DS Keyframer",
        durationMs: Math.max(1, Math.round(((keyframeEnd - keyframeStart) / keyframeFps) * 1000)),
        loop: false,
        tracks,
      }]
    : undefined

  if (tracks.length) warnings.push(`3DS keyframer recovered ${tracks.length} object track(s).`)
  if (cameraRecords.length) warnings.push(`3DS imported ${cameraRecords.length} camera record(s); first one became the default view.`)

  const defaultCamera = cameraRecords[0]
    ? { position: cameraRecords[0].position, target: cameraRecords[0].target, fov: cameraRecords[0].fov, focalLength: 50 }
    : { position: vec(0, 0.2, 5), target: vec(0, 0, 0), fov: 42, focalLength: 50 }

  return {
    format: "3ds",
    scene: {
      objects,
      materials,
      lights: sceneLights(),
      camera: defaultCamera,
      renderMode: "solid-wire",
      background: "transparent",
      selectedObjectId: objects[0]?.id,
      animations,
      activeAnimationId: animations?.[0]?.id,
    },
    warnings,
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked encoder avoids "Maximum call stack" on large payloads.
  const chunk = 0x8000
  let binary = ""
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + chunk)))
  }
  return typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64")
}

function mimeForFileName(name: string): string | undefined {
  const lower = name.toLowerCase()
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".gif")) return "image/gif"
  if (lower.endsWith(".bmp")) return "image/bmp"
  if (lower.endsWith(".tga")) return "image/x-tga"
  if (lower.endsWith(".webp")) return "image/webp"
  return undefined
}

function decodeDaeImageRefs(daeText: string): Map<string, string> {
  // Returns a Map<imageId, init_from path> from <library_images>.
  const map = new Map<string, string>()
  const lib = daeText.match(/<library_images[\s\S]*?<\/library_images>/i)
  if (!lib) return map
  const re = /<image\b([^>]*)>([\s\S]*?)<\/image>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(lib[0]))) {
    const attrs = match[1]
    const body = match[2]
    const idMatch = attrs.match(/\bid\s*=\s*"([^"]+)"/i)
    const initFrom = body.match(/<init_from>([\s\S]*?)<\/init_from>/i)
    if (idMatch && initFrom) {
      const path = initFrom[1].trim().replace(/^file:\/\//, "")
      map.set(idMatch[1], path)
    }
  }
  return map
}

function attachKmzTexturesToScene(scene: ThreeDScene, daeText: string, entries: Array<{ name: string; data: Uint8Array; method: number }>): { scene: ThreeDScene; attached: number } {
  const imageRefs = decodeDaeImageRefs(daeText)
  if (!imageRefs.size || !scene.materials.length) return { scene, attached: 0 }
  // Map of normalized basename -> entry data for fast lookup.
  const entryByName = new Map<string, { name: string; data: Uint8Array; method: number }>()
  for (const entry of entries) {
    const basename = entry.name.split("/").pop() ?? entry.name
    entryByName.set(basename.toLowerCase(), entry)
  }
  // Map material name (which usually matches surface/effect id) to first
  // imageRef. COLLADA round-trip in this app is light, so we simply attach the
  // first discovered image to each material that lacks a diffuse map.
  const refsArray = [...imageRefs.values()]
  let attached = 0
  const materials = scene.materials.map((material, index) => {
    const path = refsArray[index] ?? refsArray[0]
    if (!path) return material
    const basename = path.split("/").pop()?.toLowerCase()
    if (!basename) return material
    const entry = entryByName.get(basename)
    if (!entry || entry.method !== 0) return material
    attached += 1
    const ref: ThreeDTextureRef = {
      fileName: entry.name,
      mime: mimeForFileName(entry.name),
      dataBase64: bytesToBase64(entry.data),
      wrap: "repeat",
    }
    const maps: ThreeDMaterialMaps = { ...(material.maps ?? {}), diffuse: material.maps?.diffuse ?? ref }
    return { ...material, maps }
  })
  return { scene: { ...scene, materials }, attached }
}

function parseKmz(buffer: ArrayBuffer): AdvancedThreeDImportResult {
  const header = new Uint8Array(buffer.slice(0, 4))
  if (header[0] === 0x50 && header[1] === 0x4b) {
    const entries = extractZipStoreEntries(buffer)
    if (entries.length) {
      const dae = entries.find((entry) => /\.dae$/i.test(entry.name))
      if (dae && dae.method === 0) {
        const daeText = new TextDecoder().decode(dae.data)
        const baseScene = parseDaeToScene(daeText)
        const { scene, attached } = attachKmzTexturesToScene(baseScene, daeText, entries)
        const notes = [`KMZ ZIP package parsed from ${dae.name}; compression method store is preserved for browser-local round-trip.`]
        if (attached) notes.push(`Attached ${attached} embedded texture(s) discovered in KMZ entries.`)
        return { format: "kmz", scene, warnings: notes }
      }
      if (dae) {
        return { format: "kmz", scene: createPrimitiveThreeDScene("cube"), warnings: [`KMZ entry ${dae.name} uses unsupported compression method ${dae.method}; imported a cube placeholder.`] }
      }
      return { format: "kmz", scene: createPrimitiveThreeDScene("cube"), warnings: ["KMZ ZIP package did not contain a COLLADA .dae payload; imported a cube placeholder."] }
    }
  }
  const text = new TextDecoder().decode(buffer)
  const daeStart = text.search(/<COLLADA/i)
  if (daeStart >= 0) {
    const scene = parseDaeToScene(text.slice(daeStart))
    return { format: "kmz", scene, warnings: ["KMZ was parsed through embedded COLLADA payload text. ZIP compression metadata is not round-tripped."] }
  }
  return { format: "kmz", scene: createPrimitiveThreeDScene("cube"), warnings: ["No embedded COLLADA payload found; imported a cube placeholder."] }
}

function rehydrateThreeDScene(raw: ThreeDScene): ThreeDScene {
  // Re-establish Uint8ClampedArray fields lost through JSON.parse and ensure
  // every object/material has the expected shape.
  return {
    ...raw,
    materials: raw.materials.map((material) => {
      let texture = material.texture
      if (texture && Array.isArray((texture as unknown as { bakedBytes?: number[] }).bakedBytes)) {
        const arr = (texture as unknown as { bakedBytes: number[] }).bakedBytes
        texture = { ...texture, bakedBytes: new Uint8ClampedArray(arr) }
      } else if (texture && texture.bakedBytes && !(texture.bakedBytes instanceof Uint8ClampedArray)) {
        texture = { ...texture, bakedBytes: new Uint8ClampedArray(texture.bakedBytes as ArrayLike<number>) }
      }
      return { ...material, texture }
    }),
  }
}

function parseU3d(buffer: ArrayBuffer): AdvancedThreeDImportResult {
  const text = new TextDecoder().decode(buffer)
  if (/^U3D-BROWSER-SUBSET\b/.test(text.trimStart())) {
    const jsonStart = text.indexOf("{")
    if (jsonStart >= 0) {
      try {
        const payload = JSON.parse(text.slice(jsonStart)) as { scene?: ThreeDScene }
        if (payload.scene?.objects?.length && payload.scene.materials?.length) {
          const rehydrated = rehydrateThreeDScene(payload.scene)
          return {
            format: "u3d",
            scene: {
              ...rehydrated,
              lights: rehydrated.lights?.length ? rehydrated.lights : sceneLights(),
              camera: rehydrated.camera ?? { position: vec(0, 0.2, 5), target: vec(0, 0, 0), fov: 42, focalLength: 50 },
              renderMode: rehydrated.renderMode ?? "solid-wire",
            },
            warnings: ["U3D browser-local metadata subset parsed with mesh, material, UV, map, smoothing, vertex-animation, and animation records."],
          }
        }
      } catch {
        return { format: "u3d", scene: createPrimitiveThreeDScene("cube"), warnings: ["U3D browser-local metadata JSON could not be parsed; imported a cube placeholder."] }
      }
    }
  }
  const vertices: Vec3[] = []
  const faces: number[][] = []
  let name = "U3D Mesh"
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith("mesh ")) {
      name = trimmed.slice(5).trim() || name
    } else if (trimmed.startsWith("vertices ")) {
      const values = trimmed.slice(9).trim().split(/\s+/).map(Number).filter(Number.isFinite)
      for (let i = 0; i + 2 < values.length; i += 3) vertices.push(vec(values[i], values[i + 1], values[i + 2]))
    } else if (trimmed.startsWith("faces ")) {
      const values = trimmed.slice(6).trim().split(/\s+/).map(Number).filter(Number.isFinite)
      for (let i = 0; i + 2 < values.length; i += 3) faces.push([values[i], values[i + 1], values[i + 2]])
    }
  }
  if (!vertices.length || !faces.length) {
    return { format: "u3d", scene: createPrimitiveThreeDScene("cube"), warnings: ["U3D binary payload is represented as metadata only; imported a cube placeholder."] }
  }
  return sceneFromMesh(name, vertices, faces, "u3d", ["U3D import uses the app's browser-readable U3D metadata subset."])
}

export function importAdvancedThreeDScene(buffer: ArrayBuffer, fileName: string): AdvancedThreeDImportResult {
  const ext = fileName.split(".").pop()?.toLowerCase()
  if (ext === "3ds") return parse3ds(buffer)
  if (ext === "kmz") return parseKmz(buffer)
  if (ext === "u3d") return parseU3d(buffer)
  return { format: "u3d", scene: createPrimitiveThreeDScene("cube"), warnings: [`Unsupported advanced 3D extension "${ext ?? "unknown"}"; imported a cube placeholder.`] }
}

function intPercentChunk(value: number) {
  // 0x0030 INT_PERCENTAGE wrapped as a sub-chunk body.
  const buf = new Uint8Array(2)
  new DataView(buf.buffer).setInt16(0, clamp(Math.round(value * 100), -32768, 32767), true)
  return chunk3ds(0x0030, buf)
}

function materialMapChunk(id: number, ref: ThreeDTextureRef) {
  // 3DS material map sub-chunks need a percentage (strength) and at minimum
  // the texture filename (0xA300). Other wrap flags are optional.
  const strength = clamp(ref.strength ?? 1, 0, 1)
  const parts: Uint8Array[] = [intPercentChunk(strength)]
  if (ref.fileName) parts.push(chunk3ds(0xa300, cString(ref.fileName)))
  if (ref.wrap) {
    const flags = ref.wrap === "mirror" ? 0x10 : ref.wrap === "clamp" ? 0x01 : 0x00
    parts.push(chunk3ds(0xa351, le16(flags)))
  }
  return chunk3ds(id, ...parts)
}

function encode3dsScene(scene: ThreeDScene) {
  const materialById = new Map(scene.materials.map((material) => [material.id, material]))
  const materialChunks = scene.materials.map((material) => {
    const rgb = hexToRgb(material.color)
    const parts: Uint8Array[] = [
      chunk3ds(0xa000, cString(material.name)),
      chunk3ds(0xa020, chunk3ds(0x0011, new Uint8Array([rgb.r, rgb.g, rgb.b]))),
    ]
    if (material.specularColor) {
      const spec = hexToRgb(material.specularColor)
      parts.push(chunk3ds(0xa030, chunk3ds(0x0011, new Uint8Array([spec.r, spec.g, spec.b]))))
    }
    if (material.shininess !== undefined) {
      parts.push(chunk3ds(0xa040, intPercentChunk(material.shininess)))
    }
    if (material.opacity < 1) {
      parts.push(chunk3ds(0xa050, intPercentChunk(1 - material.opacity)))
    }
    if (material.emissiveStrength) {
      parts.push(chunk3ds(0xa084, intPercentChunk(material.emissiveStrength)))
    }
    if (material.maps?.diffuse) parts.push(materialMapChunk(0xa200, material.maps.diffuse))
    if (material.maps?.specular) parts.push(materialMapChunk(0xa204, material.maps.specular))
    if (material.maps?.opacity) parts.push(materialMapChunk(0xa210, material.maps.opacity))
    if (material.maps?.bump) parts.push(materialMapChunk(0xa230, material.maps.bump))
    if (material.maps?.emissive) parts.push(materialMapChunk(0xa33a, material.maps.emissive))
    return chunk3ds(0xafff, ...parts)
  })

  const objectChunks = scene.objects
    .filter((object) => object.vertices.length && object.faces.length)
    .map((object) => {
      const vertices = object.vertices.slice(0, 65_535).map((vertex) => transformVertex(vertex, object))
      const triangleRecords: Array<{ indices: number[]; materialId: string; smoothing: number }> = []
      for (let faceIndex = 0; faceIndex < object.faces.length; faceIndex++) {
        const face = object.faces[faceIndex]
        const indices = face.indices.filter((index) => index >= 0 && index < vertices.length)
        const smoothing = object.smoothingGroups?.[faceIndex] ?? 0
        for (let i = 1; i + 1 < indices.length && triangleRecords.length < 65_535; i++) {
          triangleRecords.push({ indices: [indices[0], indices[i], indices[i + 1]], materialId: face.materialId ?? object.materialId, smoothing })
        }
      }
      const vertexBytes = concatBytes([
        le16(vertices.length),
        ...vertices.flatMap((vertex) => [f32le(vertex.x), f32le(vertex.y), f32le(vertex.z)]),
      ])
      const materialGroups = new Map<string, number[]>()
      triangleRecords.forEach((record, index) => {
        const materialName = materialById.get(record.materialId)?.name ?? materialById.get(object.materialId)?.name ?? scene.materials[0]?.name ?? "Material"
        materialGroups.set(materialName, [...(materialGroups.get(materialName) ?? []), index])
      })
      const faceMaterialChunks = [...materialGroups.entries()].map(([name, indices]) => chunk3ds(
        0x4130,
        cString(name),
        le16(indices.length),
        ...indices.map(le16),
      ))
      const smoothingChunk = object.smoothingGroups?.length
        ? chunk3ds(0x4150, ...triangleRecords.map((record) => le32(record.smoothing >>> 0)))
        : new Uint8Array(0)
      const faceBytes = concatBytes([
        le16(triangleRecords.length),
        ...triangleRecords.flatMap((record) => [le16(record.indices[0]), le16(record.indices[1]), le16(record.indices[2]), le16(0)]),
        ...faceMaterialChunks,
        smoothingChunk,
      ])
      const uvs = object.uvs?.length === object.vertices.length ? object.uvs : vertices.map(() => ({ u: 0, v: 0 }))
      const uvBytes = concatBytes([
        le16(Math.min(uvs.length, vertices.length)),
        ...uvs.slice(0, vertices.length).flatMap((uv) => [f32le(uv.u), f32le(uv.v)]),
      ])
      return chunk3ds(
        0x4000,
        cString(object.name),
        chunk3ds(0x4100, chunk3ds(0x4110, vertexBytes), chunk3ds(0x4120, faceBytes), chunk3ds(0x4140, uvBytes)),
      )
    })

  return chunk3ds(0x4d4d, chunk3ds(0x0002, le32(3)), chunk3ds(0x3d3d, ...materialChunks, ...objectChunks))
}

function cloneTextureRef(ref: ThreeDTextureRef): ThreeDTextureRef {
  return { ...ref }
}

function cloneMaterialMaps(maps: ThreeDMaterialMaps): ThreeDMaterialMaps {
  const out: ThreeDMaterialMaps = {}
  if (maps.diffuse) out.diffuse = cloneTextureRef(maps.diffuse)
  if (maps.specular) out.specular = cloneTextureRef(maps.specular)
  if (maps.normal) out.normal = cloneTextureRef(maps.normal)
  if (maps.opacity) out.opacity = cloneTextureRef(maps.opacity)
  if (maps.bump) out.bump = cloneTextureRef(maps.bump)
  if (maps.emissive) out.emissive = cloneTextureRef(maps.emissive)
  return out
}

function cloneTextureMap(texture: ThreeDTextureMap): ThreeDTextureMap {
  return {
    ...texture,
    pixels: texture.pixels.map((pixel) => ({ ...pixel })),
    // Preserve the baked atlas bytes by allocating a new Uint8ClampedArray;
    // dataUrl is a primitive and copies by value already.
    bakedBytes: texture.bakedBytes ? new Uint8ClampedArray(texture.bakedBytes) : undefined,
  }
}

function cloneVertexAnimation(frames: ThreeDVertexAnimationFrame[]): ThreeDVertexAnimationFrame[] {
  return frames.map((frame) => ({ timeMs: frame.timeMs, positions: frame.positions.map((p) => ({ ...p })) }))
}

function serializableThreeDScene(scene: ThreeDScene): ThreeDScene {
  return {
    ...scene,
    objects: scene.objects.map((object) => ({
      ...object,
      vertices: object.vertices.map((vertex) => ({ ...vertex })),
      faces: object.faces.map((face) => ({ ...face, indices: [...face.indices], uvIndices: face.uvIndices ? [...face.uvIndices] : undefined })),
      uvs: object.uvs?.map((uv) => ({ ...uv })),
      smoothingGroups: object.smoothingGroups ? [...object.smoothingGroups] : undefined,
      vertexAnimation: object.vertexAnimation ? cloneVertexAnimation(object.vertexAnimation) : undefined,
    })),
    materials: scene.materials.map((material) => ({
      ...material,
      texture: material.texture ? cloneTextureMap(material.texture) : undefined,
      maps: material.maps ? cloneMaterialMaps(material.maps) : undefined,
    })),
    lights: scene.lights.map((light) => ({ ...light, position: light.position ? { ...light.position } : undefined, direction: light.direction ? { ...light.direction } : undefined })),
    camera: { ...scene.camera, position: { ...scene.camera.position }, target: { ...scene.camera.target } },
    animations: scene.animations?.map((animation) => ({ ...animation, tracks: animation.tracks.map((track) => ({ ...track, keyframes: track.keyframes.map((keyframe) => ({ ...keyframe, value: typeof keyframe.value === "object" ? { ...keyframe.value } : keyframe.value })) })) })),
  }
}

export function exportAdvancedThreeDScene(scene: ThreeDScene, format: AdvancedThreeDFormat, baseName = "scene"): AdvancedThreeDExportResult {
  if (format === "3ds") {
    return {
      format,
      fileName: `${baseName}.3ds`,
      mime: "model/3ds",
      data: encode3dsScene(scene),
      warnings: ["Browser export writes a binary 3DS mesh/material/UV subset; vendor animation, plug-in, and controller chunks remain out of scope."],
    }
  }
  if (format === "kmz") {
    const dae = exportSceneToDae(scene)
    return {
      format,
      fileName: `${baseName}.kmz`,
      mime: "application/vnd.google-earth.kmz",
      data: zipStoreEntry("model.dae", bytesFromText(dae)),
      warnings: ["KMZ export writes a standards-shaped ZIP package with model.dae using store compression for deterministic browser-local round-trip."],
    }
  }
  return {
    format,
    fileName: `${baseName}.u3d`,
    mime: "model/u3d",
    data: `U3D-BROWSER-SUBSET 1\n${JSON.stringify({ app: "Photoshop Web", version: 1, scene: serializableThreeDScene(scene) }, null, 2)}`,
    warnings: ["U3D export writes the app's inspectable browser-local metadata subset, not proprietary U3D binary blocks."],
  }
}

function objectBounds(object: ThreeDObject) {
  const vertices = object.vertices.map((vertex) => transformVertex(vertex, object))
  const min = vertices.reduce((acc, p) => vec(Math.min(acc.x, p.x), Math.min(acc.y, p.y), Math.min(acc.z, p.z)), vec(Infinity, Infinity, Infinity))
  const max = vertices.reduce((acc, p) => vec(Math.max(acc.x, p.x), Math.max(acc.y, p.y), Math.max(acc.z, p.z)), vec(-Infinity, -Infinity, -Infinity))
  return { min, max, size: vec(max.x - min.x, max.y - min.y, max.z - min.z) }
}

export function assignPlanarUvs(scene: ThreeDScene, objectId?: string): ThreeDScene {
  const target = scene.objects.find((object) => object.id === objectId) ?? scene.objects[0]
  if (!target) return scene
  const bounds = objectBounds(target)
  return {
    ...scene,
    objects: scene.objects.map((object) => {
      if (object.id !== target.id) return object
      const uvs = object.vertices.map((vertex) => {
        const world = transformVertex(vertex, object)
        return {
          u: bounds.size.x ? clamp((world.x - bounds.min.x) / bounds.size.x, 0, 1) : 0.5,
          v: bounds.size.y ? clamp((world.y - bounds.min.y) / bounds.size.y, 0, 1) : 0.5,
        }
      })
      return { ...object, uvs, faces: object.faces.map((face) => ({ ...face, uvIndices: [...face.indices] })) }
    }),
  }
}

export function updateThreeDMaterial(scene: ThreeDScene, materialId: string, patch: Partial<ThreeDMaterial>): ThreeDScene {
  return {
    ...scene,
    materials: scene.materials.map((material) => (material.id === materialId ? { ...material, ...patch } : material)),
  }
}

export function upsertThreeDAnimationStack(scene: ThreeDScene, stack: ThreeDAnimationStack): ThreeDScene {
  const animations = scene.animations ?? []
  const existing = animations.findIndex((item) => item.id === stack.id)
  const next = existing >= 0
    ? animations.map((item, index) => (index === existing ? stack : item))
    : [...animations, stack]
  return { ...scene, animations: next, activeAnimationId: scene.activeAnimationId ?? stack.id }
}

function cloneThreeDScene(scene: ThreeDScene): ThreeDScene {
  return serializableThreeDScene(scene)
}

function easeProgress(progress: number, easing: ThreeDAnimationKeyframe["easing"] = "linear") {
  const t = clamp(progress, 0, 1)
  if (easing === "hold") return 0
  if (easing === "ease-in") return t * t
  if (easing === "ease-out") return 1 - (1 - t) * (1 - t)
  if (easing === "ease-in-out") return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
  return t
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function isVec3Value(value: ThreeDAnimationKeyframe["value"]): value is Vec3 {
  return typeof value === "object" && value !== null && "x" in value && "y" in value && "z" in value
}

function lerpColor(a: string, b: string, t: number) {
  const left = hexToRgb(a)
  const right = hexToRgb(b)
  return hexFromRgb(lerp(left.r, right.r, t), lerp(left.g, right.g, t), lerp(left.b, right.b, t))
}

function interpolateKeyframes(keyframes: ThreeDAnimationKeyframe[], timeMs: number): ThreeDAnimationKeyframe["value"] | undefined {
  const sorted = [...keyframes].sort((a, b) => a.timeMs - b.timeMs)
  if (!sorted.length) return undefined
  if (timeMs <= sorted[0].timeMs) return sorted[0].value
  if (timeMs >= sorted[sorted.length - 1].timeMs) return sorted[sorted.length - 1].value
  const nextIndex = sorted.findIndex((keyframe) => keyframe.timeMs >= timeMs)
  const prev = sorted[Math.max(0, nextIndex - 1)]
  const next = sorted[nextIndex]
  if (!prev || !next) return sorted[0].value
  const progress = easeProgress((timeMs - prev.timeMs) / Math.max(1, next.timeMs - prev.timeMs), prev.easing ?? next.easing)
  if (typeof prev.value === "number" && typeof next.value === "number") return lerp(prev.value, next.value, progress)
  if (typeof prev.value === "string" && typeof next.value === "string") return lerpColor(prev.value, next.value, progress)
  if (isVec3Value(prev.value) && isVec3Value(next.value)) {
    return {
      x: lerp(prev.value.x, next.value.x, progress),
      y: lerp(prev.value.y, next.value.y, progress),
      z: lerp(prev.value.z, next.value.z, progress),
    }
  }
  return progress < 1 ? prev.value : next.value
}

function applyVertexAnimation(object: ThreeDObject, timeMs: number): ThreeDObject {
  const frames = object.vertexAnimation
  if (!frames?.length) return object
  const sorted = [...frames].sort((a, b) => a.timeMs - b.timeMs)
  if (timeMs <= sorted[0].timeMs) return { ...object, vertices: sorted[0].positions.map((p) => ({ ...p })) }
  if (timeMs >= sorted[sorted.length - 1].timeMs) return { ...object, vertices: sorted[sorted.length - 1].positions.map((p) => ({ ...p })) }
  const nextIndex = sorted.findIndex((frame) => frame.timeMs >= timeMs)
  const prev = sorted[Math.max(0, nextIndex - 1)]
  const next = sorted[nextIndex]
  if (!prev || !next) return object
  const span = Math.max(1, next.timeMs - prev.timeMs)
  const progress = clamp((timeMs - prev.timeMs) / span, 0, 1)
  // Linear interpolation between corresponding vertices. Frames are expected
  // to share the same vertex count; if not, we fall back to the earlier frame
  // to avoid producing invalid geometry.
  if (prev.positions.length !== next.positions.length) {
    return { ...object, vertices: prev.positions.map((p) => ({ ...p })) }
  }
  const vertices = prev.positions.map((p, index) => ({
    x: lerp(p.x, next.positions[index].x, progress),
    y: lerp(p.y, next.positions[index].y, progress),
    z: lerp(p.z, next.positions[index].z, progress),
  }))
  return { ...object, vertices }
}

export function evaluateThreeDAnimation(scene: ThreeDScene, animationId: string | undefined = scene.activeAnimationId, timeMs = scene.currentTimeMs ?? 0): ThreeDScene {
  const stack = scene.animations?.find((animation) => animation.id === animationId) ?? scene.animations?.[0]
  if (!stack) {
    // Even without an animation stack, apply per-object vertex animations.
    const hasVertexAnim = scene.objects.some((object) => object.vertexAnimation?.length)
    const baseTime = Math.max(0, Math.round(timeMs))
    if (!hasVertexAnim) return { ...scene, currentTimeMs: baseTime }
    return {
      ...scene,
      currentTimeMs: baseTime,
      objects: scene.objects.map((object) => applyVertexAnimation(object, baseTime)),
    }
  }
  const duration = Math.max(1, Math.round(stack.durationMs))
  const localTime = stack.loop ? ((Math.round(timeMs) % duration) + duration) % duration : clamp(Math.round(timeMs), 0, duration)
  const out = cloneThreeDScene(scene)
  // Apply mesh morph targets first so animated transforms compose on top.
  out.objects = out.objects.map((object) => applyVertexAnimation(object, localTime))
  for (const track of stack.tracks) {
    const value = interpolateKeyframes(track.keyframes, localTime)
    if (value === undefined) continue
    if (track.target === "object") {
      out.objects = out.objects.map((object) => {
        if (object.id !== track.targetId) return object
        if ((track.property === "position" || track.property === "rotation" || track.property === "scale") && isVec3Value(value)) {
          return { ...object, [track.property]: value }
        }
        return object
      })
    } else if (track.target === "camera") {
      if ((track.property === "position" || track.property === "target") && isVec3Value(value)) {
        out.camera = { ...out.camera, [track.property]: value }
      } else if ((track.property === "fov" || track.property === "focalLength") && typeof value === "number") {
        out.camera = { ...out.camera, [track.property]: value }
      }
    } else if (track.target === "material") {
      out.materials = out.materials.map((material) => {
        if (material.id !== track.targetId) return material
        if (track.property === "color" && typeof value === "string") return { ...material, color: value }
        if ((track.property === "opacity" || track.property === "metallic" || track.property === "roughness") && typeof value === "number") {
          return { ...material, [track.property]: clamp(value, 0, track.property === "opacity" ? 1 : 1) }
        }
        return material
      })
    }
  }
  return { ...out, activeAnimationId: stack.id, currentTimeMs: localTime }
}

/**
 * Default texture atlas size when none is set. 512x512 is a reasonable balance
 * between memory and visible detail for browser-local painting; users can
 * pre-allocate a different size by populating `material.texture` first.
 */
const DEFAULT_TEXTURE_ATLAS_SIZE = 512

function ensureBakedBytes(texture: ThreeDTextureMap): Uint8ClampedArray {
  const width = Math.max(1, Math.round(texture.width || DEFAULT_TEXTURE_ATLAS_SIZE))
  const height = Math.max(1, Math.round(texture.height || DEFAULT_TEXTURE_ATLAS_SIZE))
  const expected = width * height * 4
  if (texture.bakedBytes && texture.bakedBytes.length === expected) return new Uint8ClampedArray(texture.bakedBytes)
  return new Uint8ClampedArray(expected)
}

function blendPixel(
  dest: Uint8ClampedArray,
  index: number,
  src: { r: number; g: number; b: number },
  alpha: number,
  blendMode: ThreeDTexturePixel["blendMode"] = "normal",
) {
  const dr = dest[index]
  const dg = dest[index + 1]
  const db = dest[index + 2]
  const da = dest[index + 3]
  let mr = src.r
  let mg = src.g
  let mb = src.b
  if (blendMode === "multiply") {
    mr = (dr * src.r) / 255
    mg = (dg * src.g) / 255
    mb = (db * src.b) / 255
  } else if (blendMode === "screen") {
    mr = 255 - ((255 - dr) * (255 - src.r)) / 255
    mg = 255 - ((255 - dg) * (255 - src.g)) / 255
    mb = 255 - ((255 - db) * (255 - src.b)) / 255
  } else if (blendMode === "overlay") {
    mr = dr < 128 ? (2 * dr * src.r) / 255 : 255 - (2 * (255 - dr) * (255 - src.r)) / 255
    mg = dg < 128 ? (2 * dg * src.g) / 255 : 255 - (2 * (255 - dg) * (255 - src.g)) / 255
    mb = db < 128 ? (2 * db * src.b) / 255 : 255 - (2 * (255 - db) * (255 - src.b)) / 255
  }
  // Source-over compositing for the alpha layer keeps the dataUrl preview
  // readable when the surface starts fully transparent.
  const outA = clamp(da + alpha * 255 * (1 - da / 255), 0, 255)
  dest[index] = clamp(mr * alpha + dr * (1 - alpha), 0, 255)
  dest[index + 1] = clamp(mg * alpha + dg * (1 - alpha), 0, 255)
  dest[index + 2] = clamp(mb * alpha + db * (1 - alpha), 0, 255)
  dest[index + 3] = outA
}

function stampPixelOnAtlas(bytes: Uint8ClampedArray, width: number, height: number, pixel: ThreeDTexturePixel) {
  const cx = clamp(pixel.u, 0, 1) * width
  const cy = clamp(pixel.v, 0, 1) * height
  const radiusPixels = Math.max(0.5, pixel.radius * Math.max(width, height))
  const minX = Math.max(0, Math.floor(cx - radiusPixels))
  const maxX = Math.min(width - 1, Math.ceil(cx + radiusPixels))
  const minY = Math.max(0, Math.floor(cy - radiusPixels))
  const maxY = Math.min(height - 1, Math.ceil(cy + radiusPixels))
  const rgb = hexToRgb(pixel.color)
  const opacity = clamp(pixel.opacity, 0, 1)
  const r2 = radiusPixels * radiusPixels
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx
      const dy = y - cy
      const dist2 = dx * dx + dy * dy
      if (dist2 > r2) continue
      // Soft-edge falloff: 1 at center, 0 at radius edge.
      const falloff = 1 - Math.sqrt(dist2) / radiusPixels
      const alpha = clamp(opacity * Math.max(0, falloff), 0, 1)
      if (alpha <= 0) continue
      const idx = (y * width + x) * 4
      blendPixel(bytes, idx, rgb, alpha, pixel.blendMode)
    }
  }
}

function dataUrlFromAtlas(bytes: Uint8ClampedArray, width: number, height: number): string | undefined {
  if (typeof document === "undefined" || typeof document.createElement !== "function") return undefined
  try {
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) return undefined
    const image = new ImageData(new Uint8ClampedArray(bytes), width, height)
    ctx.putImageData(image, 0, 0)
    return canvas.toDataURL("image/png")
  } catch {
    return undefined
  }
}

/**
 * Returns the baked texture atlas for a material as an editable ImageData
 * snapshot. Returns null when the material has no baked bytes yet (callers
 * should treat this as "atlas not yet started").
 */
export function getBakedTextureImageData(scene: ThreeDScene, materialId: string): ImageData | null {
  const material = scene.materials.find((item) => item.id === materialId)
  if (!material?.texture?.bakedBytes) return null
  const { width, height, bakedBytes } = material.texture
  if (!bakedBytes.length || bakedBytes.length !== width * height * 4) return null
  return new ImageData(new Uint8ClampedArray(bakedBytes), width, height)
}

/**
 * Returns the baked texture atlas as an HTMLCanvasElement suitable for
 * dropping into a layer.canvas slot. Caller must verify the document object
 * exists (browser-only).
 */
export function getBakedTextureCanvas(scene: ThreeDScene, materialId: string): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null
  const data = getBakedTextureImageData(scene, materialId)
  if (!data) return null
  const canvas = document.createElement("canvas")
  canvas.width = data.width
  canvas.height = data.height
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.putImageData(data, 0, 0)
  return canvas
}

/**
 * Replaces the baked atlas for a material wholesale. Useful for round-tripping
 * an externally edited texture back into the scene (e.g. a Photoshop layer the
 * user finished painting on).
 */
export function replaceBakedTexture(scene: ThreeDScene, materialId: string, image: ImageData): ThreeDScene {
  return {
    ...scene,
    materials: scene.materials.map((material) => {
      if (material.id !== materialId) return material
      const bakedBytes = new Uint8ClampedArray(image.data)
      const texture: ThreeDTextureMap = {
        ...(material.texture ?? { pixels: [] as ThreeDTexturePixel[] }),
        width: image.width,
        height: image.height,
        bakedBytes,
        dataUrl: dataUrlFromAtlas(bakedBytes, image.width, image.height),
        // Clear the pixel list since the atlas is now authoritative.
        pixels: [],
      }
      return { ...material, texture }
    }),
  }
}

export function paintThreeDSurface(
  scene: ThreeDScene,
  objectId: string,
  paint: Omit<ThreeDTexturePixel, "radius" | "opacity"> & { radius?: number; opacity?: number },
): ThreeDScene {
  const object = scene.objects.find((item) => item.id === objectId) ?? scene.objects[0]
  if (!object) return scene
  const sample: ThreeDTexturePixel = {
    u: clamp(paint.u, 0, 1),
    v: clamp(paint.v, 0, 1),
    radius: clamp(paint.radius ?? 0.05, 0.001, 1),
    color: paint.color,
    opacity: clamp(paint.opacity ?? 1, 0, 1),
    blendMode: paint.blendMode ?? "normal",
  }
  return {
    ...scene,
    materials: scene.materials.map((material) => {
      if (material.id !== object.materialId) return material
      const base: ThreeDTextureMap = material.texture ?? { width: DEFAULT_TEXTURE_ATLAS_SIZE, height: DEFAULT_TEXTURE_ATLAS_SIZE, pixels: [] }
      const width = Math.max(1, Math.round(base.width || DEFAULT_TEXTURE_ATLAS_SIZE))
      const height = Math.max(1, Math.round(base.height || DEFAULT_TEXTURE_ATLAS_SIZE))
      // Bake into a real atlas so the result round-trips as an editable image
      // and can be lifted into a layer canvas via getBakedTextureCanvas.
      const bakedBytes = ensureBakedBytes({ ...base, width, height })
      stampPixelOnAtlas(bakedBytes, width, height, sample)
      const dataUrl = dataUrlFromAtlas(bakedBytes, width, height)
      return {
        ...material,
        texture: {
          ...base,
          width,
          height,
          // Keep the pixel record for legacy callers and U3D round-trip; the
          // atlas is now the authoritative cached render.
          pixels: [...base.pixels, sample],
          bakedBytes,
          dataUrl: dataUrl ?? base.dataUrl,
        },
      }
    }),
  }
}

export interface ThreeDMaterialDropOptions {
  u?: number
  v?: number
  radius?: number
  opacity?: number
  blendMode?: ThreeDTexturePixel["blendMode"]
}

export function applyThreeDMaterialDrop(
  scene: ThreeDScene,
  objectId: string | undefined,
  color: string,
  options: ThreeDMaterialDropOptions = {},
): ThreeDScene {
  const target = scene.objects.find((item) => item.id === objectId) ?? scene.objects[0]
  if (!target) return scene
  const hasUsableUvs = target.uvs?.length === target.vertices.length
    && target.faces.every((face) => !face.indices.length || face.uvIndices?.length === face.indices.length)
  const uvScene = hasUsableUvs ? scene : assignPlanarUvs(scene, target.id)
  return paintThreeDSurface(uvScene, target.id, {
    u: options.u ?? 0.5,
    v: options.v ?? 0.5,
    radius: options.radius ?? 0.08,
    color,
    opacity: options.opacity ?? 1,
    blendMode: options.blendMode ?? "normal",
  })
}

type TraceTriangle = {
  a: Vec3
  b: Vec3
  c: Vec3
  normal: Vec3
  material: ThreeDMaterial
  // Per-vertex UVs in the triangle's order (a/b/c). Undefined when the object
  // has no UV data; ray-tracer falls back to material.color in that case.
  uvA?: { u: number; v: number }
  uvB?: { u: number; v: number }
  uvC?: { u: number; v: number }
}

function trianglesForScene(scene: ThreeDScene): TraceTriangle[] {
  const materialById = new Map(scene.materials.map((material) => [material.id, material]))
  const triangles: TraceTriangle[] = []
  for (const object of scene.objects) {
    if (object.visible === false) continue
    const world = object.vertices.map((vertex) => transformVertex(vertex, object))
    const uvs = object.uvs ?? []
    for (const face of object.faces) {
      if (face.indices.length < 3) continue
      const fan = face.indices
      const uvFan = face.uvIndices && face.uvIndices.length === fan.length ? face.uvIndices : fan
      for (let i = 1; i + 1 < fan.length; i++) {
        const a = world[fan[0]]
        const b = world[fan[i]]
        const c = world[fan[i + 1]]
        const normal = normalize(cross(sub(b, a), sub(c, a)))
        const material = materialById.get(face.materialId ?? object.materialId) ?? scene.materials[0] ?? createMaterial()
        const uvA = uvs[uvFan[0]]
        const uvB = uvs[uvFan[i]]
        const uvC = uvs[uvFan[i + 1]]
        triangles.push({ a, b, c, normal, material, uvA, uvB, uvC })
      }
    }
  }
  return triangles
}

function intersectTriangle(origin: Vec3, direction: Vec3, a: Vec3, b: Vec3, c: Vec3) {
  const edge1 = sub(b, a)
  const edge2 = sub(c, a)
  const p = cross(direction, edge2)
  const det = dot(edge1, p)
  if (Math.abs(det) < 1e-7) return null
  const inv = 1 / det
  const t = sub(origin, a)
  const u = dot(t, p) * inv
  if (u < 0 || u > 1) return null
  const q = cross(t, edge1)
  const v = dot(direction, q) * inv
  if (v < 0 || u + v > 1) return null
  const distance = dot(edge2, q) * inv
  return distance > 1e-4 ? distance : null
}

// Variant that also returns barycentric weights so the renderer can resolve
// UVs at the hit position. Returns null when no hit.
function intersectTriangleBary(origin: Vec3, direction: Vec3, a: Vec3, b: Vec3, c: Vec3) {
  const edge1 = sub(b, a)
  const edge2 = sub(c, a)
  const p = cross(direction, edge2)
  const det = dot(edge1, p)
  if (Math.abs(det) < 1e-7) return null
  const inv = 1 / det
  const t = sub(origin, a)
  const u = dot(t, p) * inv
  if (u < 0 || u > 1) return null
  const q = cross(t, edge1)
  const v = dot(direction, q) * inv
  if (v < 0 || u + v > 1) return null
  const distance = dot(edge2, q) * inv
  if (distance <= 1e-4) return null
  return { distance, u, v }
}

function sampleBakedAtlas(material: ThreeDMaterial, u: number, v: number): { r: number; g: number; b: number; a: number } | null {
  const texture = material.texture
  if (!texture?.bakedBytes?.length) return null
  const width = Math.max(1, Math.round(texture.width || DEFAULT_TEXTURE_ATLAS_SIZE))
  const height = Math.max(1, Math.round(texture.height || DEFAULT_TEXTURE_ATLAS_SIZE))
  if (texture.bakedBytes.length !== width * height * 4) return null
  const wrap = (value: number) => {
    if (!Number.isFinite(value)) return 0
    const wrapped = value - Math.floor(value)
    return wrapped < 0 ? wrapped + 1 : wrapped
  }
  const px = Math.min(width - 1, Math.max(0, Math.floor(wrap(u) * width)))
  const py = Math.min(height - 1, Math.max(0, Math.floor(wrap(v) * height)))
  const i = (py * width + px) * 4
  return { r: texture.bakedBytes[i], g: texture.bakedBytes[i + 1], b: texture.bakedBytes[i + 2], a: texture.bakedBytes[i + 3] }
}

export function rayTraceScene(scene: ThreeDScene, width: number, height: number, options: RayTraceOptions = {}): ImageData {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const data = new Uint8ClampedArray(w * h * 4)
  const background = hexToRgb(options.background ?? "#101010")
  const triangles = trianglesForScene(scene)
  const camera = scene.camera
  const forward = normalize(sub(camera.target, camera.position))
  const right = normalize(cross(forward, vec(0, 1, 0)))
  const up = normalize(cross(right, forward))
  const documentWidth = Math.max(1, Math.round(options.documentWidth ?? w))
  const documentHeight = Math.max(1, Math.round(options.documentHeight ?? h))
  const viewport = options.viewport ?? { x: 0, y: 0, w, h }
  const aspect = documentWidth / documentHeight
  const fov = Math.tan(((camera.fov || 42) * Math.PI) / 360)
  const sampleCount = clamp(Math.round(options.samples ?? 1), 1, 16)
  const sampleGrid = Math.ceil(Math.sqrt(sampleCount))
  const sampleOffsets = Array.from({ length: sampleCount }, (_, index) => ({
    x: ((index % sampleGrid) + 0.5) / sampleGrid,
    y: (Math.floor(index / sampleGrid) + 0.5) / sampleGrid,
  }))
  const lights = scene.lights ?? []

  const isOccluded = (point: Vec3, normal: Vec3, lightDirection: Vec3, maxDistance: number) => {
    const origin = add(point, mul(normal, 0.002))
    for (const triangle of triangles) {
      const distance = intersectTriangle(origin, lightDirection, triangle.a, triangle.b, triangle.c)
      if (distance !== null && distance < maxDistance - 0.004) return true
    }
    return false
  }

  const shadeHit = (point: Vec3, direction: Vec3, normal: Vec3, material: ThreeDMaterial, uv?: { u: number; v: number }) => {
    const materialRgb = hexToRgb(material.color)
    // When a baked atlas exists and the hit triangle had UVs, modulate the
    // material color with the sampled texel. Falls back to the flat color.
    const sample = uv ? sampleBakedAtlas(material, uv.u, uv.v) : null
    const base = sample && sample.a > 0
      ? {
          r: (materialRgb.r * (255 - sample.a) + sample.r * sample.a) / 255,
          g: (materialRgb.g * (255 - sample.a) + sample.g * sample.a) / 255,
          b: (materialRgb.b * (255 - sample.a) + sample.b * sample.a) / 255,
        }
      : materialRgb
    const roughness = clamp(material.roughness ?? 0.45, 0, 1)
    const metallic = clamp(material.metallic ?? 0, 0, 1)
    const opacity = clamp(material.opacity ?? 1, 0, 1)
    const emissive = clamp(material.emissiveStrength ?? 0, 0, 1)
    const surfaceNormal = dot(normal, direction) > 0 ? mul(normal, -1) : normal
    const viewDirection = normalize(mul(direction, -1))
    let r = base.r * emissive
    let g = base.g * emissive
    let b = base.b * emissive
    if (!lights.length) {
      r += base.r * 0.04
      g += base.g * 0.04
      b += base.b * 0.04
    }
    for (const light of lights) {
      const lightColor = hexToRgb(light.color)
      if (light.kind === "ambient") {
        const amount = Math.max(0, light.intensity)
        r += base.r * (lightColor.r / 255) * amount
        g += base.g * (lightColor.g / 255) * amount
        b += base.b * (lightColor.b / 255) * amount
        continue
      }
      const toLight = light.kind === "point"
        ? sub(light.position ?? vec(0, 3, 4), point)
        : normalize(mul(light.direction ?? vec(-0.35, -0.7, -0.5), -1))
      const lightDistance = light.kind === "point" ? length(toLight) : Infinity
      const lightDirection = normalize(toLight)
      const attenuation = light.kind === "point" ? 1 / (1 + 0.06 * lightDistance * lightDistance) : 1
      const shadow = options.shadows && isOccluded(point, surfaceNormal, lightDirection, lightDistance) ? 0.22 : 1
      const diffuse = Math.max(0, dot(surfaceNormal, lightDirection))
      const halfVector = normalize(add(lightDirection, viewDirection))
      const specularPower = 4 + (1 - roughness) * 80
      const specular = Math.pow(Math.max(0, dot(surfaceNormal, halfVector)), specularPower) * (0.12 + metallic * 0.65)
      const intensity = Math.max(0, light.intensity) * attenuation * shadow
      r += (base.r * diffuse * (1 - metallic * 0.2) + lightColor.r * specular) * intensity * (lightColor.r / 255)
      g += (base.g * diffuse * (1 - metallic * 0.2) + lightColor.g * specular) * intensity * (lightColor.g / 255)
      b += (base.b * diffuse * (1 - metallic * 0.2) + lightColor.b * specular) * intensity * (lightColor.b / 255)
    }
    return {
      r: r * opacity + background.r * (1 - opacity),
      g: g * opacity + background.g * (1 - opacity),
      b: b * opacity + background.b * (1 - opacity),
      a: 255,
    }
  }

  const traceSample = (sampleX: number, sampleY: number) => {
    const px = (sampleX / documentWidth - 0.5) * 2 * aspect * fov
    const py = (0.5 - sampleY / documentHeight) * 2 * fov
    const direction = normalize(add(add(forward, mul(right, px)), mul(up, py)))
    let best = Infinity
    let hit: { point: Vec3; normal: Vec3; material: ThreeDMaterial; uv?: { u: number; v: number } } | null = null
    for (const triangle of triangles) {
      const intersection = intersectTriangleBary(camera.position, direction, triangle.a, triangle.b, triangle.c)
      if (intersection !== null && intersection.distance < best) {
        best = intersection.distance
        // Interpolate UVs barycentrically when the triangle carries them.
        let uv: { u: number; v: number } | undefined
        if (triangle.uvA && triangle.uvB && triangle.uvC) {
          const w0 = 1 - intersection.u - intersection.v
          uv = {
            u: triangle.uvA.u * w0 + triangle.uvB.u * intersection.u + triangle.uvC.u * intersection.v,
            v: triangle.uvA.v * w0 + triangle.uvB.v * intersection.u + triangle.uvC.v * intersection.v,
          }
        }
        hit = { point: add(camera.position, mul(direction, intersection.distance)), normal: triangle.normal, material: triangle.material, uv }
      }
    }
    return hit ? shadeHit(hit.point, direction, hit.normal, hit.material, hit.uv) : { r: background.r, g: background.g, b: background.b, a: 255 }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (const offset of sampleOffsets) {
        const sample = traceSample(viewport.x + x + offset.x, viewport.y + y + offset.y)
        r += sample.r
        g += sample.g
        b += sample.b
        a += sample.a
      }
      data[i] = clamp(r / sampleOffsets.length, 0, 255)
      data[i + 1] = clamp(g / sampleOffsets.length, 0, 255)
      data[i + 2] = clamp(b / sampleOffsets.length, 0, 255)
      data[i + 3] = clamp(a / sampleOffsets.length, 0, 255)
    }
  }
  return new ImageData(data, w, h)
}

export interface ThreeDTilePlan {
  /** Tile edge length in document-space pixels. */
  tileSize: number
  /** Total tile count for the destination canvas. */
  tileCount: number
  tileColumns: number
  tileRows: number
  /** Tile rectangles in document space, ordered row-major. */
  tiles: Array<{ key: string; col: number; row: number; rect: { x: number; y: number; w: number; h: number } }>
}

export interface RayTraceSceneTiledOptions extends RayTraceOptions {
  tileSize?: number
  /**
   * Invoked after each tile finishes with the per-tile ImageData and tile
   * descriptor, allowing callers to stream rendered tiles into a backing
   * store, layer canvas, or progress UI.
   */
  onTile?: (tile: { key: string; col: number; row: number; rect: { x: number; y: number; w: number; h: number } }, image: ImageData) => void
  /** Soft cap for how many tiles to render this call. Useful for chunked yield. */
  maxTiles?: number
}

/**
 * Builds a row-major tile plan for a destination ray-trace canvas. The pattern
 * mirrors `filter-worker.ts` so the same scheduling primitives can drive both
 * filter and 3D rendering passes.
 */
export function planRayTraceTiles(width: number, height: number, tileSize = 256): ThreeDTilePlan {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const size = Math.max(16, Math.round(tileSize))
  const tileColumns = Math.max(1, Math.ceil(w / size))
  const tileRows = Math.max(1, Math.ceil(h / size))
  const tiles: ThreeDTilePlan["tiles"] = []
  for (let row = 0; row < tileRows; row++) {
    for (let col = 0; col < tileColumns; col++) {
      const x = col * size
      const y = row * size
      const tileW = Math.min(size, w - x)
      const tileH = Math.min(size, h - y)
      if (tileW <= 0 || tileH <= 0) continue
      tiles.push({ key: `${col}:${row}`, col, row, rect: { x, y, w: tileW, h: tileH } })
    }
  }
  return { tileSize: size, tileCount: tiles.length, tileColumns, tileRows, tiles }
}

/**
 * Tiled ray-trace: iterates the destination canvas in row-major tiles so the
 * main thread can yield between tiles or hand a tile off to a worker. Each
 * tile is rendered by calling `rayTraceScene` with a sub-viewport. The first
 * call to `onTile` lets callers stream results before the full image is done.
 * Returns the fully assembled ImageData when complete.
 *
 * NOTE: WebGL/WebGPU GPU path tracing is not implemented in this app — see the
 * 3D in-scope-implementation-gaps notes. The CPU ray-tracer reused here is the
 * browser-local equivalent and tiling matches the worker-friendly pattern used
 * by `filter-worker.ts`.
 */
export function rayTraceSceneTiled(scene: ThreeDScene, width: number, height: number, options: RayTraceSceneTiledOptions = {}): ImageData {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const plan = planRayTraceTiles(w, h, options.tileSize ?? 256)
  const documentWidth = Math.max(1, Math.round(options.documentWidth ?? w))
  const documentHeight = Math.max(1, Math.round(options.documentHeight ?? h))
  const baseViewport = options.viewport ?? { x: 0, y: 0, w, h }
  const data = new Uint8ClampedArray(w * h * 4)
  const maxTiles = options.maxTiles && options.maxTiles > 0 ? Math.min(options.maxTiles, plan.tiles.length) : plan.tiles.length
  for (let i = 0; i < maxTiles; i++) {
    const tile = plan.tiles[i]
    const tileViewport = {
      x: baseViewport.x + tile.rect.x,
      y: baseViewport.y + tile.rect.y,
      w: tile.rect.w,
      h: tile.rect.h,
    }
    const image = rayTraceScene(scene, tile.rect.w, tile.rect.h, {
      ...options,
      viewport: tileViewport,
      documentWidth,
      documentHeight,
    })
    // Blit tile pixels into the assembly buffer.
    for (let row = 0; row < tile.rect.h; row++) {
      const srcOffset = row * tile.rect.w * 4
      const dstOffset = ((tile.rect.y + row) * w + tile.rect.x) * 4
      data.set(image.data.subarray(srcOffset, srcOffset + tile.rect.w * 4), dstOffset)
    }
    options.onTile?.(tile, image)
  }
  return new ImageData(data, w, h)
}

/**
 * Lightweight deterministic hash of a 3D scene used to detect changes that
 * should trigger a smart-object re-render. Captures geometry, materials,
 * camera, and animation timing.
 */
export function hashThreeDScene(scene: ThreeDScene): string {
  let hash = 0x811c9dc5
  const mix = (value: number) => {
    hash = (hash ^ Math.imul(value | 0, 16777619)) >>> 0
  }
  for (const object of scene.objects) {
    mix(object.vertices.length)
    mix(object.faces.length)
    for (const vertex of object.vertices) mix(Math.round((vertex.x + vertex.y + vertex.z) * 1000))
    mix(Math.round(object.position.x * 1000) + Math.round(object.position.y * 1000) + Math.round(object.position.z * 1000))
    mix(Math.round(object.rotation.x * 1000) + Math.round(object.rotation.y * 1000) + Math.round(object.rotation.z * 1000))
    mix(Math.round(object.scale.x * 1000) + Math.round(object.scale.y * 1000) + Math.round(object.scale.z * 1000))
  }
  for (const material of scene.materials) {
    mix(hexToRgb(material.color).r * 65536 + hexToRgb(material.color).g * 256 + hexToRgb(material.color).b)
    mix(Math.round((material.opacity ?? 1) * 1000))
    mix(Math.round((material.roughness ?? 0) * 1000))
    mix(Math.round((material.metallic ?? 0) * 1000))
    if (material.texture) {
      mix(Math.round((material.texture.width ?? 0) * 1000))
      mix(Math.round((material.texture.height ?? 0) * 1000))
      for (const pixel of material.texture.pixels ?? []) {
        const rgb = hexToRgb(pixel.color)
        mix(Math.round(pixel.u * 10000) ^ Math.round(pixel.v * 10000))
        mix(Math.round(pixel.radius * 10000) ^ Math.round(pixel.opacity * 10000))
        mix(rgb.r * 65536 + rgb.g * 256 + rgb.b)
      }
      if (material.texture.bakedBytes?.length) {
        const bytes = material.texture.bakedBytes
        mix(bytes.length)
        for (let index = 0; index < bytes.length; index += 4) {
          mix(
            (bytes[index] ?? 0)
            | ((bytes[index + 1] ?? 0) << 8)
            | ((bytes[index + 2] ?? 0) << 16)
            | ((bytes[index + 3] ?? 0) << 24),
          )
        }
      }
    }
  }
  mix(Math.round(scene.camera.position.x * 1000) + Math.round(scene.camera.position.y * 1000) + Math.round(scene.camera.position.z * 1000))
  mix(Math.round(scene.camera.target.x * 1000) + Math.round(scene.camera.target.y * 1000) + Math.round(scene.camera.target.z * 1000))
  mix(Math.round(scene.camera.fov * 100))
  mix(scene.currentTimeMs ?? 0)
  return hash.toString(16).padStart(8, "0")
}

export interface ThreeDSmartObjectRender {
  /** Hashed digest of the source scene; written into SmartObjectSource.sourceHash. */
  sourceHash: string
  /** Composed canvas suitable for SmartObjectSource.canvas / layer.canvas. */
  canvas: HTMLCanvasElement | null
  /** True when the renderer was unable to allocate a canvas (e.g. SSR). */
  fallback: boolean
  /** Plan used; helpful for tests and the progress UI. */
  plan: ThreeDTilePlan
}

/**
 * Renders a 3D scene through `rayTraceSceneTiled` and packages the result for
 * insertion into a SmartObjectSource. Callers wire the returned canvas and
 * sourceHash into the layer's smartSource so editing the underlying 3D scene
 * marks the smart object as out-of-date and re-renders deterministically on
 * the next commit.
 *
 * The renderer is intentionally synchronous so it can run inside the editor's
 * reducer flow; if you need to keep the main thread responsive for very large
 * scenes, drive `rayTraceSceneTiled` directly with `maxTiles` and yield
 * between tiles via `requestIdleCallback`.
 */
export function renderThreeDSceneToSmartObjectCanvas(
  scene: ThreeDScene,
  width: number,
  height: number,
  options: RayTraceSceneTiledOptions = {},
): ThreeDSmartObjectRender {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const plan = planRayTraceTiles(w, h, options.tileSize ?? 256)
  const sourceHash = hashThreeDScene(scene)
  if (typeof document === "undefined") {
    return { sourceHash, canvas: null, fallback: true, plan }
  }
  const image = rayTraceSceneTiled(scene, w, h, options)
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) return { sourceHash, canvas: null, fallback: true, plan }
  ctx.putImageData(image, 0, 0)
  return { sourceHash, canvas, fallback: false, plan }
}

function axisValue(point: Vec3, axis: ThreeDCrossSection["axis"]) {
  return axis === "x" ? point.x : axis === "y" ? point.y : point.z
}

export function createThreeDCrossSection(scene: ThreeDScene, section: ThreeDCrossSection & { capColor?: string }): ThreeDScene {
  const capMaterial: ThreeDMaterial = createMaterial(section.capColor ?? "#ff55cc", "Cross Section Cap")
  const materials = [...scene.materials, capMaterial]
  return {
    ...scene,
    materials,
    objects: scene.objects.map((object) => {
      const world = object.vertices.map((vertex) => transformVertex(vertex, object))
      const faces = object.faces.filter((face) => face.indices.some((index) => axisValue(world[index], section.axis) >= section.position))
      const capFace = object.vertices.length >= 3 ? [{ indices: [0, 1, 2], materialId: capMaterial.id }] : []
      return { ...object, faces: [...faces, ...capFace], crossSection: { axis: section.axis, position: section.position, capMaterialId: capMaterial.id } }
    }),
  }
}

function edgeKey(a: number, b: number) {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

export function analyzeThreeDPrintReadiness(
  scene: ThreeDScene,
  options: { minWallThickness?: number; maxBuildSize?: Vec3 } = {},
): ThreeDPrintReport {
  const issues: ThreeDPrintReport["issues"] = []
  const allVertices: Vec3[] = []
  let volumeEstimate = 0
  for (const object of scene.objects) {
    if (!object.vertices.length || !object.faces.length) {
      issues.push({ kind: "empty", severity: "error", detail: `${object.name} has no printable mesh geometry.` })
      continue
    }
    const bounds = objectBounds(object)
    allVertices.push(bounds.min, bounds.max)
    volumeEstimate += Math.max(0, bounds.size.x * bounds.size.y * bounds.size.z)
    const edges = new Map<string, number>()
    for (const face of object.faces) {
      for (let i = 0; i < face.indices.length; i++) {
        const key = edgeKey(face.indices[i], face.indices[(i + 1) % face.indices.length])
        edges.set(key, (edges.get(key) ?? 0) + 1)
      }
    }
    const openEdges = [...edges.values()].filter((count) => count !== 2).length
    if (openEdges) issues.push({ kind: "non-manifold", severity: "error", detail: `${object.name} has ${openEdges} open or shared-edge problem${openEdges === 1 ? "" : "s"}.` })
    const minWall = Math.min(bounds.size.x || Infinity, bounds.size.y || Infinity, bounds.size.z || Infinity)
    if (Number.isFinite(minWall) && minWall < (options.minWallThickness ?? 0.05)) {
      issues.push({ kind: "thin-wall", severity: "warning", detail: `${object.name} has a minimum dimension of ${minWall.toFixed(2)} scene units.` })
    }
  }
  const min = allVertices.reduce((acc, p) => vec(Math.min(acc.x, p.x), Math.min(acc.y, p.y), Math.min(acc.z, p.z)), vec(Infinity, Infinity, Infinity))
  const max = allVertices.reduce((acc, p) => vec(Math.max(acc.x, p.x), Math.max(acc.y, p.y), Math.max(acc.z, p.z)), vec(-Infinity, -Infinity, -Infinity))
  const bounds = allVertices.length ? vec(max.x - min.x, max.y - min.y, max.z - min.z) : vec()
  const maxBuild = options.maxBuildSize
  if (maxBuild && (bounds.x > maxBuild.x || bounds.y > maxBuild.y || bounds.z > maxBuild.z)) {
    issues.push({ kind: "oversized", severity: "error", detail: `Scene bounds ${bounds.x.toFixed(2)} x ${bounds.y.toFixed(2)} x ${bounds.z.toFixed(2)} exceed the selected build volume.` })
  }
  return {
    ready: !issues.some((issue) => issue.severity === "error"),
    bounds,
    volumeEstimate,
    issues,
  }
}

function sceneWorldBounds(scene: ThreeDScene) {
  const vertices = scene.objects.flatMap((object) => object.vertices.map((vertex) => transformVertex(vertex, object)))
  if (!vertices.length) return { min: vec(), max: vec(), size: vec() }
  const min = vertices.reduce((acc, p) => vec(Math.min(acc.x, p.x), Math.min(acc.y, p.y), Math.min(acc.z, p.z)), vec(Infinity, Infinity, Infinity))
  const max = vertices.reduce((acc, p) => vec(Math.max(acc.x, p.x), Math.max(acc.y, p.y), Math.max(acc.z, p.z)), vec(-Infinity, -Infinity, -Infinity))
  return { min, max, size: vec(max.x - min.x, max.y - min.y, max.z - min.z) }
}

function edgeSlicePoint(a: Vec3, b: Vec3, z: number): { x: number; y: number } | null {
  const da = a.z - z
  const db = b.z - z
  if ((da < 0 && db < 0) || (da > 0 && db > 0)) return null
  if (Math.abs(a.z - b.z) < 1e-8) return null
  const t = clamp((z - a.z) / (b.z - a.z), 0, 1)
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }
}

function dedupeSlicePoints(points: Array<{ x: number; y: number }>) {
  const out: Array<{ x: number; y: number }> = []
  for (const point of points) {
    if (!out.some((existing) => Math.abs(existing.x - point.x) < 1e-5 && Math.abs(existing.y - point.y) < 1e-5)) out.push(point)
  }
  return out
}

function segmentLength(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return 0
  return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
}

export function buildThreeDPrintPlan(
  scene: ThreeDScene,
  options: {
    layerHeight?: number
    nozzleDiameter?: number
    filamentDiameter?: number
    maxBuildSize?: Vec3
    minWallThickness?: number
    baseName?: string
  } = {},
): ThreeDPrintPlan {
  const layerHeight = clamp(options.layerHeight ?? 0.2, 0.02, 5)
  const nozzleDiameter = clamp(options.nozzleDiameter ?? 0.4, 0.05, 5)
  const filamentDiameter = clamp(options.filamentDiameter ?? 1.75, 0.1, 10)
  const readiness = analyzeThreeDPrintReadiness(scene, {
    minWallThickness: options.minWallThickness ?? nozzleDiameter * 0.5,
    maxBuildSize: options.maxBuildSize,
  })
  const bounds = sceneWorldBounds(scene)
  const triangles = trianglesForScene(scene)
  const sliceCount = bounds.size.z > 0 ? Math.max(1, Math.ceil(bounds.size.z / layerHeight)) : 1
  const slices: ThreeDPrintSlice[] = []
  let totalPathLength = 0

  for (let index = 0; index <= sliceCount; index++) {
    const z = bounds.min.z + Math.min(bounds.size.z, index * layerHeight)
    const contours: ThreeDPrintSlice["contours"] = []
    for (const triangle of triangles) {
      const points = dedupeSlicePoints([
        edgeSlicePoint(triangle.a, triangle.b, z),
        edgeSlicePoint(triangle.b, triangle.c, z),
        edgeSlicePoint(triangle.c, triangle.a, z),
      ].filter((point): point is { x: number; y: number } => !!point))
      if (points.length === 2) contours.push({ points, closed: false })
    }
    const pathLength = contours.reduce((sum, contour) => sum + segmentLength(contour.points), 0)
    totalPathLength += pathLength
    slices.push({
      index,
      z,
      contours,
      segmentCount: contours.length,
      areaEstimate: pathLength * nozzleDiameter,
    })
  }

  const estimatedMaterialVolume = totalPathLength * nozzleDiameter * layerHeight
  const filamentArea = Math.PI * Math.pow(filamentDiameter / 2, 2)
  const estimatedFilamentLength = estimatedMaterialVolume / Math.max(0.0001, filamentArea)
  const estimatedPrintTimeMinutes = Math.max(1, Math.round((totalPathLength / 40 / 60) * 10) / 10)
  const baseName = (options.baseName ?? "3d-print").replace(/[^\w.-]+/g, "-")
  const gcodeLines = [
    "; Browser-local 3D print handoff",
    `; slices=${slices.length}`,
    `; layerHeight=${layerHeight.toFixed(3)}`,
    `; nozzle=${nozzleDiameter.toFixed(3)}`,
    `; estimatedMaterialVolume=${estimatedMaterialVolume.toFixed(4)}`,
    `; estimatedFilamentLength=${estimatedFilamentLength.toFixed(4)}`,
    "G21 ; millimeters",
    "G90 ; absolute positioning",
    ...slices.slice(0, 24).flatMap((slice) => [
      `; layer ${slice.index} z=${slice.z.toFixed(4)} segments=${slice.segmentCount}`,
      `G1 Z${slice.z.toFixed(4)} F600`,
      ...slice.contours.slice(0, 12).flatMap((contour) => contour.points.length >= 2 ? [
        `G0 X${contour.points[0].x.toFixed(4)} Y${contour.points[0].y.toFixed(4)}`,
        `G1 X${contour.points[1].x.toFixed(4)} Y${contour.points[1].y.toFixed(4)} E${(segmentLength(contour.points) * nozzleDiameter * layerHeight / Math.max(0.0001, filamentArea)).toFixed(5)}`,
      ] : []),
    ]),
  ]
  return {
    readiness,
    layerHeight,
    nozzleDiameter,
    filamentDiameter,
    slices,
    estimatedMaterialVolume,
    estimatedPrintTimeMinutes,
    browserHandoff: {
      kind: "download-gcode",
      driverIntegration: false,
      fileName: `${baseName}.gcode`,
      mime: "text/x-gcode",
      detail: "Browser-local handoff creates downloadable G-code-style preview metadata; the OS slicer/printer driver remains external.",
    },
    gcodePreview: `${gcodeLines.join("\n")}\n`,
    warnings: [
      "This is a browser-local slicer approximation for review and handoff metadata, not a printer-driver integration.",
      ...readiness.issues.map((issue) => issue.detail),
    ],
  }
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

function fadeEnvelope(track: AudioTrack, localTimeMs: number) {
  let gain = track.volume
  if (track.fadeInMs && track.fadeInMs > 0) gain *= clamp(localTimeMs / track.fadeInMs, 0, 1)
  if (track.fadeOutMs && track.fadeOutMs > 0) gain *= clamp((track.durationMs - localTimeMs) / track.fadeOutMs, 0, 1)
  return gain
}

/**
 * When any track is marked `solo`, only solo tracks should play; all others
 * are silenced for the duration of the mix. This mirrors the standard DAW
 * solo bus behaviour used by every audio mixer UI.
 */
export function audibleAudioTracks(tracks: AudioTrack[]): AudioTrack[] {
  const anySolo = tracks.some((track) => track.solo && !track.muted)
  return tracks.filter((track) => !track.muted && (!anySolo || track.solo === true))
}

export function buildAudioMixPlan(tracks: AudioTrack[], timeMs: number, options: { masterVolume?: number } = {}): AudioMixPlan {
  const masterVolume = clamp(options.masterVolume ?? 1, 0, 1)
  const audible = audibleAudioTracks(tracks)
  const activeTracks = audible
    .filter((track) => timeMs >= track.startMs && timeMs <= track.startMs + track.durationMs)
    .map((track) => {
      const localTimeMs = timeMs - track.startMs
      const gain = clamp(fadeEnvelope(track, localTimeMs) * masterVolume, 0, 1)
      const pan = clamp(track.pan ?? 0, -1, 1)
      const leftGain = gain * (pan <= 0 ? 1 : 1 - pan)
      const rightGain = gain * (pan >= 0 ? 1 : 1 + pan)
      return { ...track, gain, leftGain, rightGain, localTimeMs }
    })
  const leftGain = clamp(activeTracks.reduce((sum, track) => sum + track.leftGain, 0), 0, 1)
  const rightGain = clamp(activeTracks.reduce((sum, track) => sum + track.rightGain, 0), 0, 1)
  return { timeMs, masterVolume, activeTracks, leftGain, rightGain, peakGain: Math.max(leftGain, rightGain) }
}

export function buildOfflineAudioMixSchedule(
  tracks: AudioTrack[],
  options: { masterVolume?: number; sampleRate?: number; durationMs?: number } = {},
): OfflineAudioMixSchedule {
  const masterVolume = clamp(options.masterVolume ?? 1, 0, 1)
  const sampleRate = Math.max(8000, Math.round(options.sampleRate ?? 48_000))
  const audible = audibleAudioTracks(tracks)
  const scheduled = audible
    .filter((track) => !!track.dataUrl && track.durationMs > 0)
    .map((track) => {
      const gain = clamp((track.volume ?? 1) * masterVolume, 0, 1)
      const pan = clamp(track.pan ?? 0, -1, 1)
      const leftGain = gain * (pan <= 0 ? 1 : 1 - pan)
      const rightGain = gain * (pan >= 0 ? 1 : 1 + pan)
      return {
        ...track,
        gain,
        leftGain,
        rightGain,
        startSeconds: Math.max(0, track.startMs) / 1000,
        durationSeconds: Math.max(0, track.durationMs) / 1000,
        fadeInSeconds: Math.max(0, track.fadeInMs ?? 0) / 1000,
        fadeOutSeconds: Math.max(0, track.fadeOutMs ?? 0) / 1000,
      }
    })
  const inferredDuration = scheduled.reduce((max, track) => Math.max(max, track.startMs + track.durationMs), 0)
  return {
    sampleRate,
    durationMs: Math.max(1, Math.round(options.durationMs ?? inferredDuration)),
    masterVolume,
    tracks: scheduled,
  }
}

function roundSeconds(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000
}

export function buildMuxedAudioStreamSchedule(
  tracks: AudioTrack[],
  options: { masterVolume?: number; sampleRate?: number; durationMs?: number } = {},
): MuxedAudioStreamSchedule {
  const schedule = buildOfflineAudioMixSchedule(tracks, options)
  return {
    ...schedule,
    tracks: schedule.tracks.map((track) => {
      const start = roundSeconds(track.startSeconds)
      const end = roundSeconds(track.startSeconds + track.durationSeconds)
      const fadeInEnd = roundSeconds(Math.min(end, track.startSeconds + track.fadeInSeconds))
      const fadeOutStart = roundSeconds(Math.max(start, end - track.fadeOutSeconds))
      const automation: Array<{ timeSeconds: number; value: number }> = []
      if (track.fadeInSeconds > 0) {
        automation.push({ timeSeconds: start, value: 0 })
        automation.push({ timeSeconds: fadeInEnd, value: track.gain })
      } else {
        automation.push({ timeSeconds: start, value: track.gain })
      }
      if (track.fadeOutSeconds > 0) {
        if (fadeOutStart > automation[automation.length - 1].timeSeconds) {
          automation.push({ timeSeconds: fadeOutStart, value: track.gain })
        }
        automation.push({ timeSeconds: end, value: 0 })
      } else if (end > automation[automation.length - 1].timeSeconds) {
        automation.push({ timeSeconds: end, value: track.gain })
      }
      return {
        ...track,
        pan: clamp(track.pan ?? 0, -1, 1),
        gainAutomation: automation,
      }
    }),
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
  const encoded = new TextEncoder().encode(decodeURIComponent(payload))
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
}

function offlineAudioContextCtor(): typeof OfflineAudioContext {
  const candidate = globalThis.OfflineAudioContext
    ?? (globalThis as typeof globalThis & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
  if (!candidate) throw new Error("OfflineAudioContext is not available in this browser")
  return candidate
}

export async function renderAudioMixToAudioBuffer(
  tracks: AudioTrack[],
  options: { masterVolume?: number; sampleRate?: number; durationMs?: number } = {},
): Promise<AudioBuffer> {
  const schedule = buildOfflineAudioMixSchedule(tracks, options)
  const OfflineCtx = offlineAudioContextCtor()
  const length = Math.max(1, Math.ceil((schedule.durationMs / 1000) * schedule.sampleRate))
  const context = new OfflineCtx(2, length, schedule.sampleRate)

  for (const track of schedule.tracks) {
    if (!track.dataUrl) continue
    const source = context.createBufferSource()
    const data = dataUrlToArrayBuffer(track.dataUrl)
    source.buffer = await context.decodeAudioData(data.slice(0))
    source.playbackRate.value = Math.max(0.01, track.playbackRate ?? 1)

    const gain = context.createGain()
    const start = track.startSeconds
    const end = Math.min(schedule.durationMs / 1000, start + track.durationSeconds)
    const fadeInEnd = Math.min(end, start + track.fadeInSeconds)
    const fadeOutStart = Math.max(start, end - track.fadeOutSeconds)
    gain.gain.setValueAtTime(track.fadeInSeconds > 0 ? 0 : track.gain, start)
    if (track.fadeInSeconds > 0) gain.gain.linearRampToValueAtTime(track.gain, fadeInEnd)
    gain.gain.setValueAtTime(track.gain, fadeOutStart)
    if (track.fadeOutSeconds > 0) gain.gain.linearRampToValueAtTime(0, end)

    const maybeStereo = typeof context.createStereoPanner === "function" ? context.createStereoPanner() : null
    if (maybeStereo) {
      maybeStereo.pan.value = clamp(track.pan ?? 0, -1, 1)
      source.connect(gain)
      gain.connect(maybeStereo)
      maybeStereo.connect(context.destination)
    } else {
      source.connect(gain)
      gain.connect(context.destination)
    }
    source.start(start, 0, Math.max(0.001, end - start))
  }

  return context.startRendering()
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i) & 0xff)
}

export function encodeWavFromAudioBuffer(buffer: AudioBuffer): Uint8Array {
  const channels = Math.max(1, Math.min(2, buffer.numberOfChannels || 1))
  const sampleRate = Math.max(1, Math.round(buffer.sampleRate || 44_100))
  const bitsPerSample = 16
  const blockAlign = channels * (bitsPerSample / 8)
  const byteRate = sampleRate * blockAlign
  const dataSize = buffer.length * blockAlign
  const out = new Uint8Array(44 + dataSize)
  const view = new DataView(out.buffer)
  writeAscii(view, 0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, "WAVE")
  writeAscii(view, 12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeAscii(view, 36, "data")
  view.setUint32(40, dataSize, true)

  const channelData = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1)))
  let offset = 44
  for (let i = 0; i < buffer.length; i++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = clamp(channelData[channel][i] ?? 0, -1, 1)
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }
  return out
}

export async function renderAudioMixToWavBlob(
  tracks: AudioTrack[],
  options: { masterVolume?: number; sampleRate?: number; durationMs?: number } = {},
): Promise<Blob> {
  const buffer = await renderAudioMixToAudioBuffer(tracks, options)
  return new Blob([encodeWavFromAudioBuffer(buffer)], { type: "audio/wav" })
}

/**
 * Decode an audio data URL into an AudioBuffer using an OfflineAudioContext.
 *
 * Each call creates a short-lived 1-channel/1-sample OfflineAudioContext purely
 * to access `decodeAudioData`; the returned buffer can be sampled freely by the
 * UI without touching the live AudioContext used for playback.
 */
export async function decodeAudioBufferFromDataUrl(dataUrl: string, sampleRate = 48_000): Promise<AudioBuffer> {
  const OfflineCtx = offlineAudioContextCtor()
  const context = new OfflineCtx(1, 1, Math.max(8000, Math.round(sampleRate)))
  const data = dataUrlToArrayBuffer(dataUrl)
  return context.decodeAudioData(data.slice(0))
}

export interface WaveformPeaks {
  /** Min sample per peak bucket, range [-1, 1]. */
  min: Float32Array
  /** Max sample per peak bucket, range [-1, 1]. */
  max: Float32Array
  /** Sample rate the peaks were derived from. */
  sampleRate: number
  /** Source channel count. Peaks are flattened to mono by averaging. */
  channels: number
  /** Duration covered by the peaks in seconds. */
  durationSeconds: number
}

/**
 * Compute min/max peak pairs from an AudioBuffer suitable for drawing a
 * waveform thumbnail. Channels are averaged to mono before bucketing.
 */
export function computeWaveformPeaks(buffer: AudioBuffer, buckets: number): WaveformPeaks {
  const targetBuckets = Math.max(1, Math.floor(buckets))
  const channelCount = Math.max(1, buffer.numberOfChannels)
  const length = buffer.length
  const min = new Float32Array(targetBuckets)
  const max = new Float32Array(targetBuckets)
  if (length === 0) {
    return { min, max, sampleRate: buffer.sampleRate, channels: channelCount, durationSeconds: 0 }
  }
  const channels: Float32Array[] = []
  for (let c = 0; c < channelCount; c++) channels.push(buffer.getChannelData(c))
  const samplesPerBucket = Math.max(1, Math.floor(length / targetBuckets))
  for (let bucket = 0; bucket < targetBuckets; bucket++) {
    const start = bucket * samplesPerBucket
    const end = bucket === targetBuckets - 1 ? length : Math.min(length, start + samplesPerBucket)
    let lo = Infinity
    let hi = -Infinity
    for (let i = start; i < end; i++) {
      let sum = 0
      for (let c = 0; c < channelCount; c++) sum += channels[c][i]
      const sample = sum / channelCount
      if (sample < lo) lo = sample
      if (sample > hi) hi = sample
    }
    if (!Number.isFinite(lo)) lo = 0
    if (!Number.isFinite(hi)) hi = 0
    min[bucket] = clamp(lo, -1, 1)
    max[bucket] = clamp(hi, -1, 1)
  }
  return {
    min,
    max,
    sampleRate: buffer.sampleRate,
    channels: channelCount,
    durationSeconds: length / buffer.sampleRate,
  }
}

/**
 * Draw a min/max waveform onto a target 2D canvas. The canvas is sized to
 * match its CSS box so the caller can use simple `width`/`height` props.
 */
export function drawWaveformPeaks(
  canvas: HTMLCanvasElement,
  peaks: WaveformPeaks,
  options: { color?: string; background?: string; centerLine?: boolean } = {},
): void {
  const ctx = canvas.getContext("2d")
  if (!ctx) return
  const width = canvas.width
  const height = canvas.height
  ctx.clearRect(0, 0, width, height)
  if (options.background) {
    ctx.fillStyle = options.background
    ctx.fillRect(0, 0, width, height)
  }
  ctx.fillStyle = options.color ?? "#7dd3fc"
  const midY = height / 2
  const bucketCount = peaks.min.length
  if (bucketCount === 0) return
  const xStep = width / bucketCount
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const x = bucket * xStep
    const top = midY - peaks.max[bucket] * midY
    const bottom = midY - peaks.min[bucket] * midY
    ctx.fillRect(x, Math.min(top, bottom), Math.max(0.5, xStep - 0.5), Math.max(1, Math.abs(bottom - top)))
  }
  if (options.centerLine !== false) {
    ctx.fillStyle = "rgba(255,255,255,0.18)"
    ctx.fillRect(0, midY - 0.5, width, 1)
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
