import type { TextProps, ThreeDMaterial, ThreeDObject, ThreeDScene, Vec3 } from "../types"
import { glyphAdvance } from "./glyph-advance"

function vec(x: number, y: number, z: number): Vec3 {
  return { x, y, z }
}

function material(color: string): ThreeDMaterial {
  return {
    id: "text-material",
    name: "Text Extrusion",
    color,
    metallic: 0,
    roughness: 0.38,
    opacity: 1,
  }
}

function prismObject(id: string, name: string, x: number, y: number, w: number, h: number, depth: number, materialId: string, angle: number): ThreeDObject {
  const x0 = x
  const x1 = x + w
  const y0 = y
  const y1 = y + h
  const z0 = 0
  const z1 = depth
  const vertices = [
    vec(x0, y0, z0),
    vec(x1, y0, z0),
    vec(x1, y1, z0),
    vec(x0, y1, z0),
    vec(x0, y0, z1),
    vec(x1, y0, z1),
    vec(x1, y1, z1),
    vec(x0, y1, z1),
  ]
  return {
    id,
    name,
    vertices,
    faces: [
      { indices: [0, 1, 2, 3], materialId },
      { indices: [4, 7, 6, 5], materialId },
      { indices: [0, 4, 5, 1], materialId },
      { indices: [1, 5, 6, 2], materialId },
      { indices: [2, 6, 7, 3], materialId },
      { indices: [3, 7, 4, 0], materialId },
    ],
    materialId,
    position: vec(0, 0, 0),
    rotation: vec(18, -28, angle * 0.08),
    scale: vec(1, 1, 1),
    visible: true,
  }
}

export function createTextExtrusionScene(text: TextProps): ThreeDScene {
  const extrusion = text.extrusion ?? { enabled: true, depth: 24, bevel: 2, angle: 35, color: text.color }
  const mat = material(extrusion.color ?? text.color)
  const objects: ThreeDObject[] = []
  const glyphs = [...(text.allCaps ? text.content.toUpperCase() : text.content)].filter((char) => char.trim() && char !== "\n")
  const unitsPerPx = 1 / Math.max(1, text.size)
  const depth = Math.max(0.05, extrusion.depth * unitsPerPx)
  let cursor = 0
  const totalWidth = glyphs.reduce((sum, char) => sum + glyphAdvance(text, char) * unitsPerPx, 0)

  for (let i = 0; i < glyphs.length; i++) {
    const char = glyphs[i]
    const advance = glyphAdvance(text, char) * unitsPerPx
    const w = Math.max(0.08, advance * 0.82)
    const h = 1
    const x = cursor - totalWidth / 2
    const y = -0.5
    objects.push(prismObject(`text-glyph-${i}`, `Glyph ${char}`, x, y, w, h, depth, mat.id, extrusion.angle))
    cursor += advance
  }

  if (!objects.length) {
    objects.push(prismObject("text-glyph-0", "Glyph", -0.25, -0.5, 0.5, 1, depth, mat.id, extrusion.angle))
  }

  return {
    objects,
    materials: [mat],
    lights: [
      { id: "text-light-ambient", name: "Ambient", kind: "ambient", color: "#ffffff", intensity: 0.35 },
      { id: "text-light-key", name: "Key", kind: "directional", color: "#ffffff", intensity: 0.95, direction: vec(-0.35, -0.7, -0.5) },
    ],
    camera: { position: vec(0, 0.15, 5), target: vec(0, 0, 0), fov: 42, focalLength: 50 },
    renderMode: "solid-wire",
    background: "transparent",
    selectedObjectId: objects[0].id,
  }
}
