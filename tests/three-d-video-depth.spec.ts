import { expect, test } from "@playwright/test"

import { createPrimitiveThreeDScene, parseDaeToScene, parseObjToScene } from "../components/photoshop/advanced-subsystems"
import {
  VIDEO_EXPORT_PRESETS,
  analyzeThreeDPrintReadiness,
  applyVideoTransition,
  assignPlanarUvs,
  buildOfflineAudioMixSchedule,
  buildVideoThumbnailPlan,
  buildAudioMixPlan,
  calculateTransitionWeights,
  convertVideoTimelineToFrameAnimation,
  createThreeDCrossSection,
  createVideoGroup,
  encodeWavFromAudioBuffer,
  exportAdvancedThreeDScene,
  importAdvancedThreeDScene,
  paintThreeDSurface,
  rayTraceScene,
  renderVideoTransitionPreview,
  resolveVideoExportPreset,
  splitVideoLayerAtPlayhead,
  splitVideoLayer,
  trimVideoClipToFrame,
  trimVideoClip,
  updateThreeDMaterial,
} from "../components/photoshop/three-d-video-engine"
import type { AudioTrack, Layer, TimelineFrame, VideoLayerProps } from "../components/photoshop/types"
import { installFixtureDom } from "./photoshop-fixtures"

class TestImageData {
  data: Uint8ClampedArray
  width: number
  height: number

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth
      this.height = widthOrHeight
      this.data = new Uint8ClampedArray(this.width * this.height * 4)
    } else {
      this.data = dataOrWidth
      this.width = widthOrHeight
      this.height = height ?? Math.floor(dataOrWidth.length / 4 / widthOrHeight)
    }
  }
}

globalThis.ImageData = TestImageData as unknown as typeof ImageData

function u16(value: number) {
  return [value & 255, (value >> 8) & 255]
}

function u32(value: number) {
  return [value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255]
}

function f32(value: number) {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setFloat32(0, value, true)
  return [...bytes]
}

function chunk(id: number, body: number[]) {
  return [...u16(id), ...u32(body.length + 6), ...body]
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function objectChunk(name: string) {
  const nameBytes = [...new TextEncoder().encode(name), 0]
  const vertices = chunk(0x4110, [...u16(3), ...f32(0), ...f32(0), ...f32(0), ...f32(1), ...f32(0), ...f32(0), ...f32(0), ...f32(1), ...f32(0)])
  const faces = chunk(0x4120, [...u16(1), ...u16(0), ...u16(1), ...u16(2), ...u16(0)])
  return chunk(0x4000, [...nameBytes, ...chunk(0x4100, [...vertices, ...faces])])
}

function threeDsFixture() {
  return toArrayBuffer(new Uint8Array(chunk(0x4d4d, [0x01, 0, 0, 0, ...chunk(0x3d3d, objectChunk("TriMesh"))])))
}

function kmzFixture() {
  const dae = `<?xml version="1.0"?><COLLADA><library_geometries><geometry><mesh><source><float_array>0 0 0 1 0 0 0 1 0</float_array></source><triangles><p>0 1 2</p></triangles></mesh></geometry></library_geometries></COLLADA>`
  return toArrayBuffer(new TextEncoder().encode(`PK local-file model.dae\n${dae}`))
}

function u3dFixture() {
  return toArrayBuffer(new TextEncoder().encode("U3D\nmesh Demo\nvertices 0 0 0 1 0 0 0 1 0\nfaces 0 1 2\n"))
}

function videoProps(patch: Partial<VideoLayerProps> = {}): VideoLayerProps {
  return {
    sourceName: "clip.mp4",
    durationMs: 10_000,
    currentTimeMs: 0,
    playbackRate: 1,
    inPointMs: 0,
    outPointMs: 10_000,
    keyframes: [],
    ...patch,
  }
}

function videoLayer(id: string, video = videoProps()): Layer {
  installFixtureDom()
  const canvas = document.createElement("canvas")
  canvas.width = 320
  canvas.height = 180
  return {
    id,
    name: id,
    kind: "video",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas,
    video,
  }
}

test("advanced 3D import/export handles 3DS, KMZ, and U3D scene metadata", () => {
  const threeDs = importAdvancedThreeDScene(threeDsFixture(), "mesh.3ds")
  const kmz = importAdvancedThreeDScene(kmzFixture(), "model.kmz")
  const u3d = importAdvancedThreeDScene(u3dFixture(), "asset.u3d")
  const exportedU3d = exportAdvancedThreeDScene(threeDs.scene, "u3d")
  const exportedKmz = exportAdvancedThreeDScene(threeDs.scene, "kmz")

  expect(threeDs.format).toBe("3ds")
  expect(threeDs.scene.objects[0].name).toBe("TriMesh")
  expect(kmz.format).toBe("kmz")
  expect(kmz.scene.objects[0].faces).toHaveLength(1)
  expect(u3d.format).toBe("u3d")
  expect(u3d.scene.objects[0].vertices).toHaveLength(3)
  expect(exportedU3d.mime).toContain("u3d")
  expect(exportedKmz.fileName).toMatch(/\.kmz$/)
})

test("OBJ and DAE parsers reject excessive scene complexity before materializing render data", () => {
  const oversizedObj = `${Array.from({ length: 50_001 }, (_, index) => `v ${index} 0 0`).join("\n")}\nf 1 2 3`
  const oversizedDaePositions = Array.from({ length: 150_003 }, (_, index) => String(index % 3)).join(" ")

  expect(() => parseObjToScene(oversizedObj)).toThrow(/OBJ model is too complex.*vertices/i)
  expect(() => parseDaeToScene(`<float_array>${oversizedDaePositions}</float_array><p>0 1 2</p>`)).toThrow(/DAE model is too complex.*vertices/i)
})

test("OBJ and DAE parsers cap numeric token floods before array conversion", () => {
  const floodedObjFace = Array.from({ length: 500_001 }, (_, index) => String((index % 3) + 1)).join(" ")
  const floodedDaeIndices = Array.from({ length: 500_001 }, (_, index) => String(index % 3)).join(" ")

  expect(() => parseObjToScene(`v 0 0 0\nv 1 0 0\nv 0 1 0\nf ${floodedObjFace}`)).toThrow(/OBJ model is too complex.*numeric tokens/i)
  expect(() => parseDaeToScene("<float_array>0 0 0 1 0 0 0 1 0</float_array><p>" + floodedDaeIndices + "</p>")).toThrow(/DAE model is too complex.*numeric tokens/i)
})

test("UV/material editing and direct 3D surface painting update editable scene metadata", () => {
  const scene = assignPlanarUvs(createPrimitiveThreeDScene("cube"), "obj")
  const objectId = scene.objects[0].id
  const materialId = scene.objects[0].materialId
  const edited = updateThreeDMaterial(scene, materialId, {
    color: "#ff6600",
    roughness: 0.2,
    uvScale: { u: 2, v: 1 },
  })
  const painted = paintThreeDSurface(edited, objectId, { u: 0.5, v: 0.5, radius: 0.2, color: "#00aaee", opacity: 1 })
  const material = painted.materials.find((item) => item.id === materialId)!

  expect(painted.objects[0].uvs?.length).toBe(painted.objects[0].vertices.length)
  expect(material.color).toBe("#ff6600")
  expect(material.texture?.width).toBeGreaterThan(0)
  expect(material.texture?.pixels.some((pixel) => pixel.color === "#00aaee")).toBe(true)
})

test("ray tracing, cross sections, and 3D print checks operate on scene geometry", () => {
  const scene = createPrimitiveThreeDScene("cube")
  const traced = rayTraceScene(scene, 16, 12, { samples: 1, background: "#000000" })
  const section = createThreeDCrossSection(scene, { axis: "z", position: 0, capColor: "#ff00ff" })
  const cubeCheck = analyzeThreeDPrintReadiness(scene, { minWallThickness: 0.1, maxBuildSize: { x: 10, y: 10, z: 10 } })
  const planeCheck = analyzeThreeDPrintReadiness(createPrimitiveThreeDScene("plane"))

  expect(traced.width).toBe(16)
  expect(Array.from(traced.data).some((value) => value > 0)).toBe(true)
  expect(section.materials.some((material) => material.name.includes("Cross Section"))).toBe(true)
  expect(section.objects[0].faces.length).toBeLessThanOrEqual(scene.objects[0].faces.length + 1)
  expect(cubeCheck.ready).toBe(true)
  expect(planeCheck.issues.some((issue) => issue.kind === "non-manifold")).toBe(true)
})

test("video trimming, splitting, transitions, and video groups preserve timing metadata", () => {
  const clip = videoLayer("clip", videoProps({ keyframes: [{ id: "k1", timeMs: 4000, layerId: "clip", property: "opacity", value: 0.5 }] }))
  const trimmed = trimVideoClip(clip.video!, 1200, 7600)
  const [left, right] = splitVideoLayer({ ...clip, video: trimmed }, 4200)
  const transitioned = applyVideoTransition(left.video!, { kind: "cross-dissolve", durationMs: 800, easing: "ease-in-out", targetLayerId: right.id })
  const group = createVideoGroup([left, right], { name: "Scene 01", transition: "cross-dissolve" })

  expect(trimmed.inPointMs).toBe(1200)
  expect(trimmed.outPointMs).toBe(7600)
  expect(left.video?.outPointMs).toBe(4200)
  expect(right.video?.inPointMs).toBe(4200)
  expect(transitioned.transitions?.[0].kind).toBe("cross-dissolve")
  expect(group.layers.map((layer) => layer.id)).toEqual([left.id, right.id])
  expect(group.group.videoGroup?.durationMs).toBe(6400)
})

test("frame-accurate video edit helpers snap trim handles, split at playhead, and plan thumbnails", () => {
  const clip = videoLayer("clip", videoProps({ currentTimeMs: 4567 }))
  const trimmed = trimVideoClipToFrame(clip.video!, 1234, 8765, 10)
  const [left, right] = splitVideoLayerAtPlayhead({ ...clip, video: trimmed }, 4567, 10)
  const thumbnails = buildVideoThumbnailPlan(trimmed, { count: 5, fps: 10 })

  expect(trimmed.inPointMs).toBe(1200)
  expect(trimmed.outPointMs).toBe(8800)
  expect(trimmed.trimHandles).toEqual({ inMs: 1200, outMs: 8800 })
  expect(trimmed.currentTimeMs).toBe(4600)
  expect(left.video?.outPointMs).toBe(4600)
  expect(right.video?.inPointMs).toBe(4600)
  expect(thumbnails.map((item) => item.timeMs)).toEqual([1200, 3100, 5000, 6900, 8800])
  expect(thumbnails.every((item) => item.timeMs % 100 === 0)).toBe(true)
})

test("video transition preview computes cross-dissolve and fade frame weights", () => {
  const from = videoLayer("from").canvas
  const to = videoLayer("to").canvas
  const dissolve = calculateTransitionWeights({ kind: "cross-dissolve", durationMs: 1000 }, 250)
  const fadeIn = calculateTransitionWeights({ kind: "fade-black", durationMs: 1000 }, 250, "in")
  const fadeOut = calculateTransitionWeights({ kind: "fade-white", durationMs: 1000 }, 250, "out")
  const preview = renderVideoTransitionPreview(from, to, { kind: "cross-dissolve", durationMs: 1000 }, 250, { width: 64, height: 36 })

  expect(dissolve.fromOpacity).toBeCloseTo(0.75)
  expect(dissolve.toOpacity).toBeCloseTo(0.25)
  expect(fadeIn.matteOpacity).toBeCloseTo(0.75)
  expect(fadeOut.fromOpacity).toBeCloseTo(0.75)
  expect(fadeOut.matteColor).toBe("#ffffff")
  expect(preview.width).toBe(64)
  expect(preview.height).toBe(36)
})

test("audio mixing plan computes playback state, fades, pan, and master gain", () => {
  const tracks: AudioTrack[] = [
    { id: "a", name: "Music", startMs: 0, durationMs: 5000, volume: 0.8, fadeInMs: 1000, fadeOutMs: 1000, pan: -0.5 },
    { id: "b", name: "Muted", startMs: 0, durationMs: 5000, volume: 1, muted: true },
    { id: "c", name: "Voice", startMs: 2500, durationMs: 2000, volume: 0.6, pan: 0.25 },
  ]
  const mix = buildAudioMixPlan(tracks, 3000, { masterVolume: 0.75 })

  expect(mix.activeTracks.map((track) => track.id)).toEqual(["a", "c"])
  expect(mix.leftGain).toBeGreaterThan(mix.rightGain)
  expect(mix.masterVolume).toBe(0.75)
  expect(mix.peakGain).toBeLessThanOrEqual(1)
})

test("offline audio export plans source gain, fade, pan and writes a WAV container", () => {
  const tracks: AudioTrack[] = [
    { id: "a", name: "Music", startMs: 100, durationMs: 1200, volume: 0.8, fadeInMs: 200, fadeOutMs: 300, pan: -0.5, dataUrl: "data:audio/wav;base64,AAAA" },
    { id: "b", name: "Muted", startMs: 0, durationMs: 1000, volume: 1, muted: true, dataUrl: "data:audio/wav;base64,AAAA" },
  ]
  const schedule = buildOfflineAudioMixSchedule(tracks, { masterVolume: 0.5, sampleRate: 48_000 })
  const buffer = {
    numberOfChannels: 2,
    sampleRate: 48_000,
    length: 4,
    getChannelData: (channel: number) => new Float32Array(channel === 0 ? [0, 0.5, -0.5, 0.25] : [0, -0.25, 0.25, 0.5]),
  } as AudioBuffer
  const wav = encodeWavFromAudioBuffer(buffer)
  const wavText = Array.from(wav.slice(0, 12), (byte) => String.fromCharCode(byte)).join("")

  expect(schedule.durationMs).toBe(1300)
  expect(schedule.tracks).toHaveLength(1)
  expect(schedule.tracks[0].gain).toBeCloseTo(0.4)
  expect(schedule.tracks[0].leftGain).toBeCloseTo(0.4)
  expect(schedule.tracks[0].rightGain).toBeCloseTo(0.2)
  expect(schedule.tracks[0].fadeInSeconds).toBeCloseTo(0.2)
  expect(schedule.tracks[0].fadeOutSeconds).toBeCloseTo(0.3)
  expect(wavText).toBe("RIFF4\u0000\u0000\u0000WAVE")
  expect(wav.length).toBe(44 + 4 * 2 * 2)
})

test("video export presets and frame animation conversion support timeline workflows", () => {
  const frames: TimelineFrame[] = [
    { id: "f1", name: "Start", durationMs: 500, layerVisibility: { clip: true }, transition: "hold" },
    { id: "f2", name: "End", durationMs: 700, layerVisibility: { clip: false }, transition: "dissolve" },
  ]
  const preset = resolveVideoExportPreset("social-1080p", { codec: "h264", fps: 24 })
  const animation = convertVideoTimelineToFrameAnimation(frames, { fps: 10, includeTransitions: true })

  expect(VIDEO_EXPORT_PRESETS.some((item) => item.id === "social-1080p")).toBe(true)
  expect(preset.width).toBe(1920)
  expect(preset.codec).toBe("h264")
  expect(animation.frames).toHaveLength(12)
  expect(animation.frames.some((frame) => frame.transitionProgress > 0)).toBe(true)
})
