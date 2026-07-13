import { exportSceneToObj as _exportSceneToObj } from "./three-d-scene-formats"
import type {
  ThreeDAnimationKeyframe,
  ThreeDAnimationStack,
  ThreeDCrossSection,
  ThreeDMaterial,
  ThreeDObject,
  ThreeDPrintPlan,
  ThreeDPrintReport,
  ThreeDPrintSlice,
  ThreeDScene,
  ThreeDTextureMap,
  ThreeDTexturePixel,
  Vec3,
} from "./types"
import { hexToRgb } from "./color-utils"
import { clamp } from "./three-d-video/math"
import {
  add,
  createMaterial,
  cross,
  DEFAULT_TEXTURE_ATLAS_SIZE,
  dot,
  hexFromRgb,
  length,
  lerp,
  mul,
  normalize,
  objectBounds,
  serializableThreeDScene,
  sub,
  transformVertex,
  vec,
} from "./three-d-video-engine-shared"

export { exportAdvancedThreeDScene, importAdvancedThreeDScene } from "./three-d-video-engine-formats"
export type { AdvancedThreeDExportResult, AdvancedThreeDFormat, AdvancedThreeDImportResult } from "./three-d-video-engine-formats"

export * from "./three-d-video/audio"
export * from "./three-d-video/video"




export interface RayTraceOptions {
  samples?: number
  background?: string
  shadows?: boolean
  viewport?: { x: number; y: number; w: number; h: number }
  documentWidth?: number
  documentHeight?: number
}










function _rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")).join("")}`
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
