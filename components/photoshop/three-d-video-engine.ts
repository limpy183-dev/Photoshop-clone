import { createPrimitiveThreeDScene, exportSceneToDae, exportSceneToObj, parseDaeToScene } from "./advanced-subsystems"
import type {
  AudioTrack,
  Layer,
  ThreeDCrossSection,
  ThreeDMaterial,
  ThreeDObject,
  ThreeDPrintReport,
  ThreeDScene,
  ThreeDTexturePixel,
  TimelineFrame,
  Vec3,
  VideoExportPreset,
  VideoGroupProps,
  VideoLayerProps,
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

export const VIDEO_EXPORT_PRESETS: VideoExportPreset[] = [
  { id: "draft-webm", label: "Draft WebM 720p", width: 1280, height: 720, fps: 24, codec: "webm", bitrateKbps: 2800, audioKbps: 128, container: "webm" },
  { id: "social-1080p", label: "Social H.264 1080p", width: 1920, height: 1080, fps: 30, codec: "h264", bitrateKbps: 8000, audioKbps: 192, container: "mp4" },
  { id: "archive-4k", label: "Archive VP9 4K", width: 3840, height: 2160, fps: 30, codec: "vp9", bitrateKbps: 28000, audioKbps: 320, container: "webm" },
  { id: "frame-gif", label: "Frame Animation GIF", width: 1080, height: 1080, fps: 12, codec: "gif", bitrateKbps: 0, audioKbps: 0, container: "gif" },
  { id: "png-sequence", label: "PNG Sequence", width: 1920, height: 1080, fps: 24, codec: "png-sequence", bitrateKbps: 0, audioKbps: 0, container: "zip" },
]

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
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

function sceneFromMesh(name: string, vertices: Vec3[], faces: number[][], format: AdvancedThreeDFormat, warnings: string[] = []): AdvancedThreeDImportResult {
  const material = createMaterial(format === "3ds" ? "#f4b15f" : format === "kmz" ? "#5ec8ff" : "#9bd87d", `${format.toUpperCase()} Material`)
  const object = createObject(name, normalizeMesh(vertices), faces, material.id)
  return {
    format,
    scene: {
      objects: [object],
      materials: [material],
      lights: [
        { id: uid("light"), name: "Ambient", kind: "ambient", color: "#ffffff", intensity: 0.35 },
        { id: uid("light"), name: "Key", kind: "directional", color: "#ffffff", intensity: 0.9, direction: vec(-0.4, -0.65, -0.55) },
      ],
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
  let objectName = "3DS Mesh"
  let vertices: Vec3[] = []
  let faces: number[][] = []

  const readCString = (offset: number, end: number) => {
    const bytes: number[] = []
    let cursor = offset
    while (cursor < end) {
      const value = view.getUint8(cursor++)
      if (value === 0) break
      bytes.push(value)
    }
    return { text: new TextDecoder().decode(new Uint8Array(bytes)) || objectName, next: cursor }
  }

  const walk = (start: number, end: number) => {
    let offset = start
    while (offset + 6 <= end && offset + 6 <= view.byteLength) {
      const id = view.getUint16(offset, true)
      const size = view.getUint32(offset + 2, true)
      const body = offset + 6
      if (size < 6 || offset + size > view.byteLength) {
        offset += 1
        continue
      }
      const next = size > 0 ? Math.min(offset + size, view.byteLength) : end
      if (next <= offset) break
      if (id === 0x4000) {
        const named = readCString(body, next)
        objectName = named.text
        walk(named.next, next)
      } else if (id === 0x4110) {
        const count = view.getUint16(body, true)
        const parsed: Vec3[] = []
        let cursor = body + 2
        for (let i = 0; i < count && cursor + 12 <= next; i++) {
          parsed.push(vec(view.getFloat32(cursor, true), view.getFloat32(cursor + 4, true), view.getFloat32(cursor + 8, true)))
          cursor += 12
        }
        vertices = parsed
      } else if (id === 0x4120) {
        const count = view.getUint16(body, true)
        const parsed: number[][] = []
        let cursor = body + 2
        for (let i = 0; i < count && cursor + 8 <= next; i++) {
          parsed.push([view.getUint16(cursor, true), view.getUint16(cursor + 2, true), view.getUint16(cursor + 4, true)])
          cursor += 8
        }
        faces = parsed
      } else {
        walk(body, next)
      }
      offset = next
    }
  }

  walk(0, view.byteLength)
  if (!vertices.length || !faces.length) {
    warnings.push("3DS geometry chunks were not found; imported a cube placeholder.")
    const fallback = createPrimitiveThreeDScene("cube")
    return { format: "3ds", scene: fallback, warnings }
  }
  return sceneFromMesh(objectName, vertices, faces, "3ds", warnings)
}

function parseKmz(buffer: ArrayBuffer): AdvancedThreeDImportResult {
  const text = new TextDecoder().decode(buffer)
  const daeStart = text.search(/<COLLADA/i)
  if (daeStart >= 0) {
    const scene = parseDaeToScene(text.slice(daeStart))
    return { format: "kmz", scene, warnings: ["KMZ was parsed through embedded COLLADA payload text. ZIP compression metadata is not round-tripped."] }
  }
  return { format: "kmz", scene: createPrimitiveThreeDScene("cube"), warnings: ["No embedded COLLADA payload found; imported a cube placeholder."] }
}

function parseU3d(buffer: ArrayBuffer): AdvancedThreeDImportResult {
  const text = new TextDecoder().decode(buffer)
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

export function exportAdvancedThreeDScene(scene: ThreeDScene, format: AdvancedThreeDFormat, baseName = "scene"): AdvancedThreeDExportResult {
  if (format === "3ds") {
    const obj = exportSceneToObj(scene)
    return {
      format,
      fileName: `${baseName}.3ds.txt`,
      mime: "text/plain+3ds",
      data: `3DS-BROWSER-SUBSET\n${obj}`,
      warnings: ["Browser export writes a documented 3DS interchange subset, not a binary Autodesk 3DS file."],
    }
  }
  if (format === "kmz") {
    const dae = exportSceneToDae(scene)
    return {
      format,
      fileName: `${baseName}.kmz`,
      mime: "application/vnd.google-earth.kmz",
      data: `PK local-file model.dae\n${dae}`,
      warnings: ["KMZ export stores an embedded COLLADA payload in the app's lightweight browser package representation."],
    }
  }
  return {
    format,
    fileName: `${baseName}.u3d`,
    mime: "model/u3d",
    data: [
      "U3D",
      ...scene.objects.map((object) => [
        `mesh ${object.name}`,
        `vertices ${object.vertices.map((vertex) => `${vertex.x} ${vertex.y} ${vertex.z}`).join(" ")}`,
        `faces ${object.faces.map((face) => face.indices.join(" ")).join(" ")}`,
      ].join("\n")),
    ].join("\n"),
    warnings: ["U3D export writes the app's inspectable mesh subset for local project interchange."],
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
      const texture = material.texture ?? { width: 512, height: 512, pixels: [] }
      return { ...material, texture: { ...texture, pixels: [...texture.pixels, sample] } }
    }),
  }
}

function trianglesForScene(scene: ThreeDScene) {
  const materialById = new Map(scene.materials.map((material) => [material.id, material]))
  const triangles: Array<{ a: Vec3; b: Vec3; c: Vec3; normal: Vec3; material: ThreeDMaterial }> = []
  for (const object of scene.objects) {
    if (object.visible === false) continue
    const world = object.vertices.map((vertex) => transformVertex(vertex, object))
    for (const face of object.faces) {
      if (face.indices.length < 3) continue
      const fan = face.indices
      for (let i = 1; i + 1 < fan.length; i++) {
        const a = world[fan[0]]
        const b = world[fan[i]]
        const c = world[fan[i + 1]]
        const normal = normalize(cross(sub(b, a), sub(c, a)))
        triangles.push({ a, b, c, normal, material: materialById.get(face.materialId ?? object.materialId) ?? scene.materials[0] ?? createMaterial() })
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
  const aspect = w / h
  const fov = Math.tan(((camera.fov || 42) * Math.PI) / 360)
  const light = normalize(vec(-0.35, -0.7, -0.5))

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const px = ((x + 0.5) / w - 0.5) * 2 * aspect * fov
      const py = (0.5 - (y + 0.5) / h) * 2 * fov
      const direction = normalize(add(add(forward, mul(right, px)), mul(up, py)))
      let best = Infinity
      let hit: { normal: Vec3; material: ThreeDMaterial } | null = null
      for (const triangle of triangles) {
        const distance = intersectTriangle(camera.position, direction, triangle.a, triangle.b, triangle.c)
        if (distance !== null && distance < best) {
          best = distance
          hit = { normal: triangle.normal, material: triangle.material }
        }
      }
      if (hit) {
        const base = hexToRgb(hit.material.color)
        const shade = clamp(0.2 + Math.max(0, dot(hit.normal, mul(light, -1))) * 0.95 + hit.material.metallic * 0.12, 0, 1.35)
        data[i] = clamp(base.r * shade, 0, 255)
        data[i + 1] = clamp(base.g * shade, 0, 255)
        data[i + 2] = clamp(base.b * shade, 0, 255)
        data[i + 3] = 255
      } else {
        data[i] = background.r
        data[i + 1] = background.g
        data[i + 2] = background.b
        data[i + 3] = 255
      }
    }
  }
  return new ImageData(data, w, h)
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

export function waitForVideoMetadata(video: HTMLVideoElement): Promise<void> {
  if (Number.isFinite(video.duration) && video.readyState >= 1) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
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
    video.addEventListener("loadedmetadata", onLoaded, { once: true })
    video.addEventListener("error", onError, { once: true })
  })
}

export async function seekVideoElement(video: HTMLVideoElement, timeMs: number): Promise<void> {
  await waitForVideoMetadata(video)
  const target = clamp(timeMs / 1000, 0, Math.max(0, video.duration || 0))
  if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) return
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
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
    video.addEventListener("seeked", onSeeked, { once: true })
    video.addEventListener("error", onError, { once: true })
    video.currentTime = target
  })
}

export async function extractVideoFrameToCanvas(
  video: HTMLVideoElement,
  timeMs: number,
  options: { width: number; height: number },
): Promise<HTMLCanvasElement> {
  await seekVideoElement(video, timeMs)
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
  options: { count?: number; fps?: number; width: number; height: number },
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

export function buildAudioMixPlan(tracks: AudioTrack[], timeMs: number, options: { masterVolume?: number } = {}): AudioMixPlan {
  const masterVolume = clamp(options.masterVolume ?? 1, 0, 1)
  const activeTracks = tracks
    .filter((track) => !track.muted && timeMs >= track.startMs && timeMs <= track.startMs + track.durationMs)
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
  const scheduled = tracks
    .filter((track) => !track.muted && !!track.dataUrl && track.durationMs > 0)
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
      const progress = options.includeTransitions && frame.transition && frame.transition !== "hold"
        ? count <= 1 ? 1 : i / (count - 1)
        : 0
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
