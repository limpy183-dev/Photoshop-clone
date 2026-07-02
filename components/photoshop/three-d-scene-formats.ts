import type { ThreeDMaterial, ThreeDObject, ThreeDScene, Vec3 } from "./types"
import { uid } from "./uid"

const MB = 1024 * 1024

export const ADVANCED_3D_IMPORT_LIMITS = {
  textBytes: 16 * MB,
  vertices: 50_000,
  faces: 100_000,
  numericTokens: 500_000,
} as const

function vec(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z }
}

function add(a: Vec3, b: Vec3): Vec3 {
  return vec(a.x + b.x, a.y + b.y, a.z + b.z)
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return vec(a.x - b.x, a.y - b.y, a.z - b.z)
}

function mul(a: Vec3, scalar: number): Vec3 {
  return vec(a.x * scalar, a.y * scalar, a.z * scalar)
}

function rotate(value: Vec3, rotation: Vec3): Vec3 {
  const rx = (rotation.x * Math.PI) / 180
  const ry = (rotation.y * Math.PI) / 180
  const rz = (rotation.z * Math.PI) / 180
  let out = { ...value }
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

function createObject(name: string, vertices: Vec3[], faces: number[][], materialId: string): ThreeDObject {
  return {
    id: uid("obj"),
    name,
    vertices,
    faces: faces.map((indices) => ({ indices, materialId })),
    materialId,
    position: vec(0, 0, 0),
    rotation: vec(18, -28, 0),
    scale: vec(1, 1, 1),
    visible: true,
  }
}

export function createPrimitiveThreeDScene(kind: "cube" | "plane" | "pyramid" | "sphere" = "cube"): ThreeDScene {
  const material = defaultMaterial(kind === "sphere" ? "#89e38f" : kind === "pyramid" ? "#f7c46c" : "#5ec8ff")
  let object: ThreeDObject
  if (kind === "plane") {
    object = createObject("Plane", [vec(-1.5, 0, -1), vec(1.5, 0, -1), vec(1.5, 0, 1), vec(-1.5, 0, 1)], [[0, 1, 2, 3]], material.id)
  } else if (kind === "pyramid") {
    object = createObject(
      "Pyramid",
      [vec(0, 1.3, 0), vec(-1, -0.8, -1), vec(1, -0.8, -1), vec(1, -0.8, 1), vec(-1, -0.8, 1)],
      [[1, 2, 3, 4], [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1]],
      material.id,
    )
  } else if (kind === "sphere") {
    const vertices: Vec3[] = []
    const faces: number[][] = []
    const rows = 10
    const cols = 18
    for (let y = 0; y <= rows; y++) {
      const v = y / rows
      const phi = v * Math.PI
      for (let x = 0; x < cols; x++) {
        const u = x / cols
        const theta = u * Math.PI * 2
        vertices.push(vec(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)))
      }
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const a = y * cols + x
        const b = y * cols + ((x + 1) % cols)
        const c = (y + 1) * cols + ((x + 1) % cols)
        const d = (y + 1) * cols + x
        faces.push([a, b, c, d])
      }
    }
    object = createObject("Sphere", vertices, faces, material.id)
  } else {
    object = createObject(
      "Cube",
      [vec(-1, -1, -1), vec(1, -1, -1), vec(1, 1, -1), vec(-1, 1, -1), vec(-1, -1, 1), vec(1, -1, 1), vec(1, 1, 1), vec(-1, 1, 1)],
      [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]],
      material.id,
    )
  }
  return {
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
  }
}

function normalizeMesh(vertices: Vec3[]) {
  if (!vertices.length) return vertices
  const min = vertices.reduce((acc, point) => vec(Math.min(acc.x, point.x), Math.min(acc.y, point.y), Math.min(acc.z, point.z)), vec(Infinity, Infinity, Infinity))
  const max = vertices.reduce((acc, point) => vec(Math.max(acc.x, point.x), Math.max(acc.y, point.y), Math.max(acc.z, point.z)), vec(-Infinity, -Infinity, -Infinity))
  const center = mul(add(min, max), 0.5)
  const scale = 2 / Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 0.01)
  return vertices.map((point) => mul(sub(point, center), scale))
}

function advancedLimitLabel(bytes: number) {
  return `${(bytes / MB).toFixed(0)} MB`
}

function assertAdvancedTextSize(text: string, maxBytes: number, label: string) {
  if (text.length > maxBytes) {
    throw new Error(`${label} is too large. Maximum file size is ${advancedLimitLabel(maxBytes)}.`)
  }
}

function isDigitCode(code: number) {
  return code >= 48 && code <= 57
}

function isNumericBoundary(code: number) {
  return code <= 32 || code === 44 || code === 47 || code === 60 || code === 62
}

function startsNumericToken(text: string, index: number) {
  const code = text.charCodeAt(index)
  const previousIsBoundary = index === 0 || isNumericBoundary(text.charCodeAt(index - 1))
  if (!previousIsBoundary) return false
  if (isDigitCode(code)) return true
  if (code !== 43 && code !== 45 && code !== 46) return false
  return index + 1 < text.length && isDigitCode(text.charCodeAt(index + 1))
}

function countNumericTokens(text: string, format: "OBJ" | "DAE", max = ADVANCED_3D_IMPORT_LIMITS.numericTokens) {
  let count = 0
  for (let index = 0; index < text.length; index++) {
    if (!startsNumericToken(text, index)) continue
    count += 1
    if (count > max) throw new Error(`${format} model is too complex: numeric tokens exceed ${max.toLocaleString()}.`)
  }
  return count
}

function assertModelCount(format: "OBJ" | "DAE", kind: "vertices" | "faces", count: number, max: number) {
  if (count > max) throw new Error(`${format} model is too complex: ${kind} exceed ${max.toLocaleString()}.`)
}

function assertModelTextComplexity(text: string, format: "OBJ" | "DAE") {
  assertAdvancedTextSize(text, ADVANCED_3D_IMPORT_LIMITS.textBytes, `${format} model`)
  countNumericTokens(text, format)
}

function forEachLine(text: string, callback: (line: string) => void) {
  let start = 0
  for (let index = 0; index <= text.length; index++) {
    const code = index < text.length ? text.charCodeAt(index) : 10
    if (index < text.length && code !== 10 && code !== 13) continue
    callback(text.slice(start, index))
    if (code === 13 && text.charCodeAt(index + 1) === 10) index += 1
    start = index + 1
  }
}

export function parseObjToScene(text: string): ThreeDScene {
  assertModelTextComplexity(text, "OBJ")
  const vertices: Vec3[] = []
  const faces: number[][] = []
  forEachLine(text, (line) => {
    const trimmed = line.trim()
    if (trimmed.startsWith("v ")) {
      const [, x, y, z] = trimmed.split(/\s+/)
      assertModelCount("OBJ", "vertices", vertices.length + 1, ADVANCED_3D_IMPORT_LIMITS.vertices)
      vertices.push(vec(Number(x) || 0, Number(y) || 0, Number(z) || 0))
    } else if (trimmed.startsWith("f ")) {
      const indices = trimmed.slice(2).trim().split(/\s+/).map((part) => {
        const raw = Number(part.split("/")[0])
        return raw < 0 ? vertices.length + raw : raw - 1
      }).filter((index) => index >= 0 && index < vertices.length)
      if (indices.length >= 3) {
        assertModelCount("OBJ", "faces", faces.length + 1, ADVANCED_3D_IMPORT_LIMITS.faces)
        faces.push(indices)
      }
    }
  })
  if (!vertices.length || !faces.length) return createPrimitiveThreeDScene("cube")
  const scene = createPrimitiveThreeDScene("cube")
  const material = scene.materials[0]
  scene.objects = [createObject("OBJ Mesh", normalizeMesh(vertices), faces, material.id)]
  scene.selectedObjectId = scene.objects[0].id
  return scene
}

export function exportSceneToObj(scene: ThreeDScene) {
  const lines = ["# Exported from Photoshop Web browser-native 3D subsystem"]
  let offset = 1
  for (const object of scene.objects) {
    lines.push(`o ${object.name.replace(/\s+/g, "_")}`)
    for (const vertex of object.vertices.map((value) => transformVertex(value, object))) {
      lines.push(`v ${vertex.x.toFixed(5)} ${vertex.y.toFixed(5)} ${vertex.z.toFixed(5)}`)
    }
    for (const face of object.faces) {
      lines.push(`f ${face.indices.map((index) => index + offset).join(" ")}`)
    }
    offset += object.vertices.length
  }
  return `${lines.join("\n")}\n`
}

export function parseDaeToScene(text: string): ThreeDScene {
  assertModelTextComplexity(text, "DAE")
  const floatMatch = text.match(/<float_array[^>]*>([\s\S]*?)<\/float_array>/i)
  const pMatch = text.match(/<p>([\s\S]*?)<\/p>/i)
  const floatText = floatMatch?.[1] ?? ""
  const pText = pMatch?.[1] ?? ""
  assertModelCount("DAE", "vertices", Math.floor(countNumericTokens(floatText, "DAE") / 3), ADVANCED_3D_IMPORT_LIMITS.vertices)
  const floats = floatText.trim() ? floatText.trim().split(/\s+/).map(Number).filter(Number.isFinite) : []
  const vertices: Vec3[] = []
  for (let index = 0; index + 2 < floats.length; index += 3) vertices.push(vec(floats[index], floats[index + 1], floats[index + 2]))
  const rawIndices = pText.trim() ? pText.trim().split(/\s+/).map(Number).filter(Number.isFinite) : []
  const stride = rawIndices.length >= 6 && vertices.length ? Math.max(1, Math.floor(rawIndices.length / Math.max(1, Math.floor(rawIndices.length / 3)))) : 1
  const indices = rawIndices.filter((_, index) => index % stride === 0).map((value) => value % Math.max(1, vertices.length))
  const faces: number[][] = []
  for (let index = 0; index + 2 < indices.length; index += 3) {
    assertModelCount("DAE", "faces", faces.length + 1, ADVANCED_3D_IMPORT_LIMITS.faces)
    faces.push([indices[index], indices[index + 1], indices[index + 2]])
  }
  if (!vertices.length || !faces.length) return createPrimitiveThreeDScene("cube")
  const scene = createPrimitiveThreeDScene("cube")
  const material = scene.materials[0]
  scene.objects = [createObject("DAE Mesh", normalizeMesh(vertices), faces, material.id)]
  scene.selectedObjectId = scene.objects[0].id
  return scene
}

export function exportSceneToDae(scene: ThreeDScene) {
  const vertices = scene.objects.flatMap((object) => object.vertices.map((value) => transformVertex(value, object)))
  const faces: number[] = []
  let offset = 0
  for (const object of scene.objects) {
    for (const face of object.faces) {
      const indices = face.indices.length === 3 ? face.indices : [face.indices[0], face.indices[1], face.indices[2]]
      faces.push(...indices.map((index) => index + offset))
    }
    offset += object.vertices.length
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA version="1.4.1" xmlns="http://www.collada.org/2005/11/COLLADASchema">
  <asset><contributor><authoring_tool>Photoshop Web</authoring_tool></contributor><unit name="meter" meter="1"/><up_axis>Y_UP</up_axis></asset>
  <library_geometries><geometry id="mesh" name="SceneMesh"><mesh>
    <source id="mesh-positions"><float_array id="mesh-positions-array" count="${vertices.length * 3}">${vertices.map((vertex) => `${vertex.x.toFixed(5)} ${vertex.y.toFixed(5)} ${vertex.z.toFixed(5)}`).join(" ")}</float_array><technique_common><accessor source="#mesh-positions-array" count="${vertices.length}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
    <vertices id="mesh-vertices"><input semantic="POSITION" source="#mesh-positions"/></vertices>
    <triangles count="${Math.floor(faces.length / 3)}"><input semantic="VERTEX" source="#mesh-vertices" offset="0"/><p>${faces.join(" ")}</p></triangles>
  </mesh></geometry></library_geometries>
</COLLADA>`
}
