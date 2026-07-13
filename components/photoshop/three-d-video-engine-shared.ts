import type {
  ThreeDMaterial,
  ThreeDMaterialMaps,
  ThreeDObject,
  ThreeDScene,
  ThreeDTextureMap,
  ThreeDTextureRef,
  ThreeDVertexAnimationFrame,
  Vec3,
} from "./types"
import { clamp } from "./three-d-video/math"
import { uid } from "./uid"

export function vec(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z }
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return vec(a.x + b.x, a.y + b.y, a.z + b.z)
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return vec(a.x - b.x, a.y - b.y, a.z - b.z)
}

export function mul(a: Vec3, s: number): Vec3 {
  return vec(a.x * s, a.y * s, a.z * s)
}

export function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
}

export function length(a: Vec3) {
  return Math.hypot(a.x, a.y, a.z)
}

export function normalize(a: Vec3): Vec3 {
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

export function transformVertex(vertex: Vec3, object: ThreeDObject): Vec3 {
  const scaled = vec(vertex.x * object.scale.x, vertex.y * object.scale.y, vertex.z * object.scale.z)
  return add(rotate(scaled, object.rotation), object.position)
}

function _rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")).join("")}`
}

export function createMaterial(color = "#5ec8ff", name = "Material"): ThreeDMaterial {
  return { id: uid("mat"), name, color, metallic: 0, roughness: 0.45, opacity: 1 }
}

export function createObject(name: string, vertices: Vec3[], faces: number[][], materialId: string): ThreeDObject {
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

export function normalizeMesh(vertices: Vec3[]) {
  if (!vertices.length) return vertices
  const min = vertices.reduce((acc, p) => vec(Math.min(acc.x, p.x), Math.min(acc.y, p.y), Math.min(acc.z, p.z)), vec(Infinity, Infinity, Infinity))
  const max = vertices.reduce((acc, p) => vec(Math.max(acc.x, p.x), Math.max(acc.y, p.y), Math.max(acc.z, p.z)), vec(-Infinity, -Infinity, -Infinity))
  const center = mul(add(min, max), 0.5)
  const scale = 2 / Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 0.01)
  return vertices.map((point) => mul(sub(point, center), scale))
}

export function hexFromRgb(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")).join("")}`
}

export function bytesFromText(text: string) {
  return new TextEncoder().encode(text)
}

export function concatBytes(parts: Uint8Array[]) {
  const size = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export function le16(value: number) {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff])
}

export function le32(value: number) {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff])
}

export function f32le(value: number) {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setFloat32(0, Number.isFinite(value) ? value : 0, true)
  return out
}

export function cString(text: string) {
  const safe = text.replace(/\0/g, "").slice(0, 63)
  return concatBytes([bytesFromText(safe), new Uint8Array([0])])
}

export function chunk3ds(id: number, ...bodies: Uint8Array[]) {
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

export function zipStoreEntry(fileName: string, data: Uint8Array) {
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

export function extractZipStoreEntries(buffer: ArrayBuffer): Array<{ name: string; data: Uint8Array; method: number }> {
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

export function serializableThreeDScene(scene: ThreeDScene): ThreeDScene {
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

export function objectBounds(object: ThreeDObject) {
  const vertices = object.vertices.map((vertex) => transformVertex(vertex, object))
  const min = vertices.reduce((acc, p) => vec(Math.min(acc.x, p.x), Math.min(acc.y, p.y), Math.min(acc.z, p.z)), vec(Infinity, Infinity, Infinity))
  const max = vertices.reduce((acc, p) => vec(Math.max(acc.x, p.x), Math.max(acc.y, p.y), Math.max(acc.z, p.z)), vec(-Infinity, -Infinity, -Infinity))
  return { min, max, size: vec(max.x - min.x, max.y - min.y, max.z - min.z) }
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

/**
 * Default texture atlas size when none is set. 512x512 is a reasonable balance
 * between memory and visible detail for browser-local painting; users can
 * pre-allocate a different size by populating `material.texture` first.
 */
export const DEFAULT_TEXTURE_ATLAS_SIZE = 512
