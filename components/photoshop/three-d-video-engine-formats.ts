import {
  createPrimitiveThreeDScene,
  exportSceneToDae,
  parseDaeToScene,
} from "./three-d-scene-formats"
import type {
  ThreeDMaterial,
  ThreeDMaterialMaps,
  ThreeDObject,
  ThreeDScene,
  ThreeDTextureRef,
  Vec3,
  ThreeDAnimationTrack,
} from "./types"
import { hexToRgb } from "./color-utils"
import { clamp } from "./three-d-video/math"
import { uid } from "./uid"
import {
  bytesFromText,
  chunk3ds,
  concatBytes,
  cString,
  createMaterial,
  createObject,
  extractZipStoreEntries,
  f32le,
  hexFromRgb,
  le16,
  le32,
  normalizeMesh,
  serializableThreeDScene,
  transformVertex,
  vec,
  zipStoreEntry,
} from "./three-d-video-engine-shared"

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
