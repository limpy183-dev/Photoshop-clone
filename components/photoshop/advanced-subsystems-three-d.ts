import type { ThreeDMaterial, ThreeDObject, ThreeDScene, Vec3 } from "./types"
import { hexToRgb } from "./color-utils"
import { uid } from "./uid"
import { clamp, createSubsystemCanvas } from "./advanced-subsystems-shared"

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((v) => clamp(Math.round(v)).toString(16).padStart(2, "0")).join("")}`
}

function _mixColor(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, t: number) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  }
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

function normalize(a: Vec3): Vec3 {
  const len = Math.hypot(a.x, a.y, a.z) || 1
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

function defaultMaterial(color = "#5ec8ff"): ThreeDMaterial {
  return { id: uid("mat"), name: "Material", color, metallic: 0, roughness: 0.45, opacity: 1 }
}

function project(point: Vec3, scene: ThreeDScene, width: number, height: number) {
  const camera = scene.camera
  const forward = normalize(sub(camera.target, camera.position))
  const right = normalize(cross(forward, vec(0, 1, 0)))
  const up = normalize(cross(right, forward))
  const rel = sub(point, camera.position)
  const z = dot(rel, forward)
  if (z <= 0.05) return null
  const f = (height / 2) / Math.tan(((camera.fov || 42) * Math.PI) / 360)
  return { x: width / 2 + (dot(rel, right) / z) * f, y: height / 2 - (dot(rel, up) / z) * f, z }
}

function shadedColor(material: ThreeDMaterial, normal: Vec3, center: Vec3, scene: ThreeDScene) {
  const base = hexToRgb(material.color)
  let amount = 0
  for (const light of scene.lights) {
    if (light.kind === "ambient") {
      amount += light.intensity
    } else if (light.kind === "directional") {
      amount += Math.max(0, dot(normal, normalize(mul(light.direction ?? vec(-0.4, -0.6, -0.5), -1)))) * light.intensity
    } else {
      amount += Math.max(0, dot(normal, normalize(sub(light.position ?? vec(2, 2, 2), center)))) * light.intensity
    }
  }
  amount = clamp(amount, 0.08, 1.4)
  const metal = material.metallic * 0.25
  return rgbToHex(base.r * amount + 255 * metal, base.g * amount + 255 * metal, base.b * amount + 255 * metal)
}

export function renderThreeDScene(scene: ThreeDScene, width: number, height: number) {
  const canvas = createSubsystemCanvas(width, height, scene.background && scene.background !== "transparent" ? scene.background : undefined)
  const ctx = canvas.getContext("2d")!
  ctx.lineJoin = "round"
  const materialById = new Map(scene.materials.map((material) => [material.id, material]))
  const drawFaces: {
    depth: number
    points: { x: number; y: number; z: number }[]
    normal: Vec3
    center: Vec3
    material: ThreeDMaterial
  }[] = []

  for (const object of scene.objects) {
    if (object.visible === false) continue
    const world = object.vertices.map((vertex) => transformVertex(vertex, object))
    for (const face of object.faces) {
      if (face.indices.length < 2) continue
      const points = face.indices.map((index) => project(world[index], scene, width, height))
      if (points.some((point) => !point)) continue
      const center = face.indices.reduce((acc, index) => add(acc, world[index]), vec())
      const averaged = mul(center, 1 / face.indices.length)
      const normal = normalize(cross(sub(world[face.indices[1]], world[face.indices[0]]), sub(world[face.indices[2] ?? face.indices[1]], world[face.indices[0]])))
      drawFaces.push({
        depth: points.reduce((sum, point) => sum + (point?.z ?? 0), 0) / points.length,
        points: points as { x: number; y: number; z: number }[],
        normal,
        center: averaged,
        material: materialById.get(face.materialId ?? object.materialId) ?? scene.materials[0] ?? defaultMaterial(),
      })
    }
  }

  drawFaces.sort((a, b) => b.depth - a.depth)
  for (const face of drawFaces) {
    ctx.beginPath()
    face.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.closePath()
    if (scene.renderMode !== "wireframe") {
      ctx.globalAlpha = face.material.opacity
      ctx.fillStyle = shadedColor(face.material, face.normal, face.center, scene)
      ctx.fill()
      ctx.globalAlpha = 1
    }
    if (scene.renderMode !== "solid" || face.material.wireframe) {
      ctx.strokeStyle = "rgba(255,255,255,0.72)"
      ctx.lineWidth = Math.max(1, Math.round(Math.min(width, height) / 420))
      ctx.stroke()
    }
  }
  return canvas
}

export function nudgeSceneVertex(scene: ThreeDScene, objectId: string, vertexIndex: number, delta: Vec3): ThreeDScene {
  return {
    ...scene,
    objects: scene.objects.map((object) => {
      if (object.id !== objectId) return object
      return {
        ...object,
        vertices: object.vertices.map((vertex, index) => (index === vertexIndex ? add(vertex, delta) : vertex)),
      }
    }),
  }
}
