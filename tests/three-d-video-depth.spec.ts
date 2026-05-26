import { expect, test } from "@playwright/test"

import { createPrimitiveThreeDScene, parseDaeToScene, parseObjToScene } from "../components/photoshop/advanced-subsystems"
import {
  VIDEO_EXPORT_PRESETS,
  analyzeThreeDPrintReadiness,
  applyVideoTransition,
  assignPlanarUvs,
  buildFinalVideoExportPlan,
  buildThreeDPrintPlan,
  buildOfflineAudioMixSchedule,
  buildMuxedAudioStreamSchedule,
  buildVideoClipTrackState,
  buildVideoTrimHandleModel,
  buildVideoThumbnailPlan,
  buildAudioMixPlan,
  calculateTransitionWeights,
  convertVideoTimelineToFrameAnimation,
  createThreeDCrossSection,
  createVideoGroup,
  encodeWavFromAudioBuffer,
  evaluateThreeDAnimation,
  exportAdvancedThreeDScene,
  applyThreeDMaterialDrop,
  getBakedTextureImageData,
  getBrowserMuxCapability,
  hashThreeDScene,
  importAdvancedThreeDScene,
  paintThreeDSurface,
  rayTraceScene,
  replaceBakedTexture,
  renderVideoTransitionPreview,
  seekVideoElement,
  resolveVideoExportPreset,
  splitVideoLayerAtPlayhead,
  splitVideoLayer,
  trimVideoClipToFrame,
  trimVideoClip,
  updateThreeDMaterial,
  upsertThreeDAnimationStack,
  waitForVideoMetadata,
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

test("browser-local 3D completion round-trips binary 3DS, KMZ ZIP, and U3D multi-mesh metadata", () => {
  const scene = assignPlanarUvs(createPrimitiveThreeDScene("cube"))
  const secondObject = {
    ...scene.objects[0],
    id: "second-object",
    name: "Second Mesh",
    materialId: "mat-blue",
    position: { x: 1.5, y: 0, z: 0 },
  }
  const richScene = {
    ...scene,
    objects: [
      { ...scene.objects[0], name: "First Mesh" },
      secondObject,
    ],
    materials: [
      { ...scene.materials[0], id: scene.objects[0].materialId, name: "Warm Matte", color: "#f06543", roughness: 0.35, metallic: 0.1, opacity: 0.9 },
      { id: "mat-blue", name: "Cool Gloss", color: "#2477ff", roughness: 0.12, metallic: 0.6, opacity: 1 },
    ],
  }

  const threeDsExport = exportAdvancedThreeDScene(richScene, "3ds", "browser-local")
  const kmzExport = exportAdvancedThreeDScene(richScene, "kmz", "browser-local")
  const u3dExport = exportAdvancedThreeDScene(richScene, "u3d", "browser-local")

  expect(threeDsExport.fileName).toBe("browser-local.3ds")
  expect(threeDsExport.data).toBeInstanceOf(Uint8Array)
  expect((threeDsExport.data as Uint8Array)[0]).toBe(0x4d)
  expect((threeDsExport.data as Uint8Array)[1]).toBe(0x4d)
  expect(kmzExport.data).toBeInstanceOf(Uint8Array)
  expect(Array.from((kmzExport.data as Uint8Array).slice(0, 2), (byte) => String.fromCharCode(byte)).join("")).toBe("PK")

  const imported3ds = importAdvancedThreeDScene(toArrayBuffer(threeDsExport.data as Uint8Array), threeDsExport.fileName)
  const importedKmz = importAdvancedThreeDScene(toArrayBuffer(kmzExport.data as Uint8Array), kmzExport.fileName)
  const importedU3d = importAdvancedThreeDScene(toArrayBuffer(new TextEncoder().encode(u3dExport.data as string)), u3dExport.fileName)

  expect(imported3ds.scene.objects).toHaveLength(2)
  expect(imported3ds.scene.objects[0].uvs?.length).toBeGreaterThan(0)
  expect(imported3ds.scene.materials.some((material) => material.name === "Warm Matte")).toBe(true)
  expect(importedKmz.scene.objects[0].faces.length).toBeGreaterThan(0)
  expect(importedKmz.warnings.join(" ")).toMatch(/KMZ ZIP/i)
  expect(importedU3d.scene.objects.map((object) => object.name)).toEqual(["First Mesh", "Second Mesh"])
  expect(importedU3d.scene.materials.map((material) => material.name)).toContain("Cool Gloss")
})

test("browser-local 3D completion evaluates animation stacks without mutating the source scene", () => {
  const baseScene = createPrimitiveThreeDScene("cube")
  const objectId = baseScene.objects[0].id
  const scene = upsertThreeDAnimationStack(baseScene, {
    id: "orbit",
    name: "Orbit",
    durationMs: 1000,
    loop: true,
    tracks: [
      {
        id: "move-x",
        target: "object",
        targetId: objectId,
        property: "position",
        keyframes: [
          { timeMs: 0, value: { x: 0, y: 0, z: 0 }, easing: "linear" },
          { timeMs: 1000, value: { x: 2, y: 0, z: 0 }, easing: "linear" },
        ],
      },
      {
        id: "rotate-y",
        target: "object",
        targetId: objectId,
        property: "rotation",
        keyframes: [
          { timeMs: 0, value: { x: 0, y: 0, z: 0 }, easing: "linear" },
          { timeMs: 1000, value: { x: 0, y: 180, z: 0 }, easing: "linear" },
        ],
      },
    ],
  })

  const halfway = evaluateThreeDAnimation(scene, "orbit", 500)
  const looped = evaluateThreeDAnimation(scene, "orbit", 1250)

  expect(scene.objects[0].position.x).toBe(0)
  expect(halfway.objects[0].position.x).toBeCloseTo(1)
  expect(halfway.objects[0].rotation.y).toBeCloseTo(90)
  expect(looped.objects[0].position.x).toBeCloseTo(0.5)
  expect(looped.currentTimeMs).toBe(250)
  expect(looped.activeAnimationId).toBe("orbit")
})

test("browser-local 3D completion uses scene lights, supersampling, and shadow-capable CPU preview", () => {
  const scene = createPrimitiveThreeDScene("cube")
  const unlit = { ...scene, lights: [], materials: [{ ...scene.materials[0], color: "#80c8ff", roughness: 0.2, metallic: 0.4 }] }
  const lit = {
    ...unlit,
    lights: [
      { id: "ambient", name: "Dim Ambient", kind: "ambient" as const, color: "#ffffff", intensity: 0.08 },
      { id: "key", name: "Key", kind: "point" as const, color: "#ffffff", intensity: 1.4, position: { x: -2, y: 3, z: 4 } },
    ],
  }

  const averageBrightness = (image: ImageData) => {
    let sum = 0
    let count = 0
    for (let index = 0; index < image.data.length; index += 4) {
      if (image.data[index + 3] === 0) continue
      sum += image.data[index] + image.data[index + 1] + image.data[index + 2]
      count += 3
    }
    return sum / Math.max(1, count)
  }
  const uniqueColors = (image: ImageData) => new Set(Array.from({ length: image.width * image.height }, (_, pixel) => {
    const index = pixel * 4
    return `${image.data[index]},${image.data[index + 1]},${image.data[index + 2]}`
  })).size

  const darkPreview = rayTraceScene(unlit, 20, 16, { samples: 1, background: "#000000" })
  const litPreview = rayTraceScene(lit, 20, 16, { samples: 4, shadows: true, background: "#000000" })

  expect(averageBrightness(litPreview)).toBeGreaterThan(averageBrightness(darkPreview) + 8)
  expect(uniqueColors(litPreview)).toBeGreaterThan(uniqueColors(darkPreview))
})

test("browser-local 3D completion builds slicer-style print plan and browser handoff metadata", () => {
  const scene = createPrimitiveThreeDScene("cube")
  const plan = buildThreeDPrintPlan(scene, {
    layerHeight: 0.4,
    nozzleDiameter: 0.4,
    filamentDiameter: 1.75,
    maxBuildSize: { x: 10, y: 10, z: 10 },
    baseName: "cube-print",
  })

  expect(plan.readiness.ready).toBe(true)
  expect(plan.slices.length).toBeGreaterThan(2)
  expect(plan.slices.some((slice) => slice.segmentCount > 0)).toBe(true)
  expect(plan.estimatedMaterialVolume).toBeGreaterThan(0)
  expect(plan.browserHandoff.driverIntegration).toBe(false)
  expect(plan.browserHandoff.fileName).toBe("cube-print.gcode")
  expect(plan.gcodePreview).toContain("; Browser-local 3D print handoff")
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

test("3D surface painting bakes editable atlas pixels and invalidates scene hashes by pixel content", () => {
  const scene = assignPlanarUvs(createPrimitiveThreeDScene("cube"))
  const objectId = scene.objects[0].id
  const materialId = scene.objects[0].materialId

  const redPaint = paintThreeDSurface(scene, objectId, { u: 0.5, v: 0.5, radius: 0.12, color: "#ff0000", opacity: 1 })
  const bluePaint = paintThreeDSurface(scene, objectId, { u: 0.5, v: 0.5, radius: 0.12, color: "#0000ff", opacity: 1 })
  const atlas = getBakedTextureImageData(redPaint, materialId)

  expect(atlas).not.toBeNull()
  expect(atlas!.width).toBe(512)
  expect(atlas!.height).toBe(512)
  expect(Array.from(atlas!.data).some((value, index) => index % 4 === 0 && value > 0)).toBe(true)
  expect(hashThreeDScene(redPaint)).not.toBe(hashThreeDScene(bluePaint))
})

test("3D material drop and external atlas replacement use baked editable texture atlases", () => {
  const scene = assignPlanarUvs(createPrimitiveThreeDScene("cube"))
  const objectId = scene.objects[0].id
  const materialId = scene.objects[0].materialId
  const originalColor = scene.materials[0].color

  const dropped = applyThreeDMaterialDrop(scene, objectId, "#14b8a6", { u: 0.25, v: 0.75, radius: 0.08 })
  const droppedMaterial = dropped.materials.find((item) => item.id === materialId)!
  const droppedAtlas = getBakedTextureImageData(dropped, materialId)

  expect(droppedMaterial.color).toBe(originalColor)
  expect(droppedMaterial.texture?.pixels.at(-1)).toMatchObject({ u: 0.25, v: 0.75, color: "#14b8a6" })
  expect(droppedAtlas).not.toBeNull()
  expect(Array.from(droppedAtlas!.data).some((value, index) => index % 4 === 1 && value > 0)).toBe(true)

  const replacementBytes = new Uint8ClampedArray(4 * 4 * 4)
  for (let index = 0; index < replacementBytes.length; index += 4) {
    replacementBytes[index] = 255
    replacementBytes[index + 1] = 128
    replacementBytes[index + 2] = 64
    replacementBytes[index + 3] = 255
  }
  const replaced = replaceBakedTexture(dropped, materialId, new ImageData(replacementBytes, 4, 4))
  const replacedAtlas = getBakedTextureImageData(replaced, materialId)

  expect(replacedAtlas?.width).toBe(4)
  expect(replacedAtlas?.height).toBe(4)
  expect(Array.from(replacedAtlas!.data.slice(0, 4))).toEqual([255, 128, 64, 255])
  expect(replaced.materials.find((item) => item.id === materialId)?.texture?.pixels).toEqual([])
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

test("video clip track state exposes visual trim handles and split availability", () => {
  const clip = videoProps({
    durationMs: 10_000,
    inPointMs: 1_200,
    outPointMs: 8_800,
    currentTimeMs: 4_567,
    trimHandles: { inMs: 1_200, outMs: 8_800 },
  })

  const state = buildVideoClipTrackState(clip, 4_567, { fps: 10 })

  expect(state.durationMs).toBe(10_000)
  expect(state.inPointMs).toBe(1_200)
  expect(state.outPointMs).toBe(8_800)
  expect(state.playheadMs).toBe(4_600)
  expect(state.inPercent).toBeCloseTo(12)
  expect(state.outPercent).toBeCloseTo(88)
  expect(state.clipWidthPercent).toBeCloseTo(76)
  expect(state.playheadPercent).toBeCloseTo(46)
  expect(state.canSplit).toBe(true)
  expect(state.labels).toEqual({ in: "1.20s", out: "8.80s", playhead: "4.60s" })

  expect(buildVideoClipTrackState(clip, 1_200, { fps: 10 }).canSplit).toBe(false)
  expect(buildVideoClipTrackState(clip, 8_800, { fps: 10 }).canSplit).toBe(false)
})

test("video trim handle model provides frame ticks, thumbnail positions, and keyboard nudge metadata", () => {
  const clip = videoProps({
    durationMs: 10_000,
    inPointMs: 1_200,
    outPointMs: 8_800,
    currentTimeMs: 4_567,
    trimHandles: { inMs: 1_200, outMs: 8_800 },
  })
  const thumbnails = buildVideoThumbnailPlan(clip, { count: 5, fps: 10 })

  const model = buildVideoTrimHandleModel(clip, 4_567, { fps: 10, thumbnails, maxTickCount: 6 })

  expect(model.state.frameStepMs).toBe(100)
  expect(model.keyboardNudgeMs).toBe(100)
  expect(model.handles.in.frameIndex).toBe(12)
  expect(model.handles.out.frameIndex).toBe(88)
  expect(model.handles.playhead.frameIndex).toBe(46)
  expect(model.thumbnails.map((item) => Math.round(item.leftPercent))).toEqual([12, 31, 50, 69, 88])
  expect(model.ticks.map((item) => item.timeMs)).toEqual([0, 2000, 4000, 6000, 8000, 10000])
})

test("browser mux capability reports supported MIME type or an explicit unavailable reason", () => {
  const original = globalThis.MediaRecorder
  const mutableGlobal = globalThis as unknown as { MediaRecorder: typeof MediaRecorder | undefined }
  try {
    mutableGlobal.MediaRecorder = undefined
    const unavailable = getBrowserMuxCapability()
    expect(unavailable.supported).toBe(false)
    expect(unavailable.reason).toContain("MediaRecorder")

    mutableGlobal.MediaRecorder = {
      isTypeSupported: (mime: string) => mime === "video/webm;codecs=vp9,opus",
    } as unknown as typeof MediaRecorder
    const supported = getBrowserMuxCapability()
    expect(supported.supported).toBe(true)
    expect(supported.mimeType).toBe("video/webm;codecs=vp9,opus")
  } finally {
    mutableGlobal.MediaRecorder = original
  }
})

test("final video export plan resolves real MP4/H.264 muxing when the browser exposes it", () => {
  const original = globalThis.MediaRecorder
  const mutableGlobal = globalThis as unknown as { MediaRecorder: typeof MediaRecorder | undefined }
  try {
    mutableGlobal.MediaRecorder = {
      isTypeSupported: (mime: string) => mime === "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    } as unknown as typeof MediaRecorder
    const frames: TimelineFrame[] = [
      { id: "f1", name: "Start", durationMs: 500, layerVisibility: { clip: true }, transition: "hold" },
      { id: "f2", name: "End", durationMs: 500, layerVisibility: { clip: true }, transition: "dissolve" },
    ]
    const audioTracks: AudioTrack[] = [
      { id: "music", name: "Music", startMs: 0, durationMs: 1000, volume: 0.8, dataUrl: "data:audio/wav;base64,AAAA" },
    ]

    const preset = resolveVideoExportPreset("social-1080p")
    const capability = getBrowserMuxCapability({ container: preset.container, codec: preset.codec, audio: true })
    const plan = buildFinalVideoExportPlan(preset, frames, audioTracks, { muxCapability: capability })

    expect(capability.supported).toBe(true)
    expect(capability.mimeType).toBe("video/mp4;codecs=avc1.42E01E,mp4a.40.2")
    expect(plan.mode).toBe("muxed-media")
    expect(plan.container).toBe("mp4")
    expect(plan.extension).toBe("mp4")
    expect(plan.mimeType).toBe("video/mp4;codecs=avc1.42E01E,mp4a.40.2")
    expect(plan.audioTrackCount).toBe(1)
    expect(plan.durationMs).toBe(1000)
    expect(plan.warnings.join("\n")).not.toContain("package")
  } finally {
    mutableGlobal.MediaRecorder = original
  }
})

test("final video export plan falls back to a deterministic frame and audio package without MediaRecorder", () => {
  const original = globalThis.MediaRecorder
  const mutableGlobal = globalThis as unknown as { MediaRecorder: typeof MediaRecorder | undefined }
  try {
    mutableGlobal.MediaRecorder = undefined
    const frames: TimelineFrame[] = [
      { id: "f1", name: "Start", durationMs: 250, layerVisibility: { clip: true }, transition: "hold" },
      { id: "f2", name: "End", durationMs: 750, layerVisibility: { clip: true }, transition: "hold" },
    ]
    const preset = resolveVideoExportPreset("social-1080p")
    const plan = buildFinalVideoExportPlan(preset, frames, [], {
      muxCapability: getBrowserMuxCapability({ container: preset.container, codec: preset.codec }),
    })

    expect(plan.mode).toBe("timeline-package")
    expect(plan.container).toBe("zip")
    expect(plan.extension).toBe("zip")
    expect(plan.mimeType).toBe("application/zip")
    expect(plan.durationMs).toBe(1000)
    expect(plan.warnings.join("\n")).toContain("MediaRecorder")
    expect(plan.warnings.join("\n")).toContain("frame/audio package")
  } finally {
    mutableGlobal.MediaRecorder = original
  }
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

test("muxed audio stream schedule exposes fade and pan automation for final audiovisual export", () => {
  const tracks: AudioTrack[] = [
    {
      id: "music",
      name: "Music",
      startMs: 100,
      durationMs: 1200,
      volume: 0.8,
      fadeInMs: 200,
      fadeOutMs: 300,
      pan: -0.5,
      dataUrl: "data:audio/wav;base64,AAAA",
    },
    { id: "muted", name: "Muted", startMs: 0, durationMs: 1000, volume: 1, muted: true, dataUrl: "data:audio/wav;base64,AAAA" },
  ]

  const schedule = buildMuxedAudioStreamSchedule(tracks, { masterVolume: 0.5, durationMs: 1500, sampleRate: 48_000 })

  expect(schedule.durationMs).toBe(1500)
  expect(schedule.tracks).toHaveLength(1)
  expect(schedule.tracks[0].gain).toBeCloseTo(0.4)
  expect(schedule.tracks[0].pan).toBe(-0.5)
  expect(schedule.tracks[0].gainAutomation).toEqual([
    { timeSeconds: 0.1, value: 0 },
    { timeSeconds: 0.3, value: 0.4 },
    { timeSeconds: 1, value: 0.4 },
    { timeSeconds: 1.3, value: 0 },
  ])
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

test("source video metadata and seek helpers time out instead of hanging on unreadable media", async () => {
  const video = {
    duration: Number.NaN,
    readyState: 0,
    currentTime: 0,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as HTMLVideoElement

  await expect(waitForVideoMetadata(video, { timeoutMs: 5 })).rejects.toThrow(/timed out/i)
  await expect(seekVideoElement(video, 500, { timeoutMs: 5 })).rejects.toThrow(/timed out/i)
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

test("frame animation conversion respects per-frame transition durations", () => {
  const frames: Array<TimelineFrame & { transitionDurationMs?: number }> = [
    {
      id: "f1",
      name: "Hold then wipe",
      durationMs: 1000,
      layerVisibility: { clip: true },
      transition: "wipe-right",
      transitionDurationMs: 250,
      easing: "linear",
    },
    { id: "f2", name: "Next", durationMs: 250, layerVisibility: { clip: false }, transition: "hold" },
  ]

  const animation = convertVideoTimelineToFrameAnimation(frames, { fps: 4, includeTransitions: true })

  expect(animation.frames.slice(0, 4).map((frame) => frame.transitionProgress)).toEqual([0, 0, 0, 1])
})
