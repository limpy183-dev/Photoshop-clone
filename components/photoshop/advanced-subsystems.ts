import type {
  ColorManagementSettings,
  DocumentMetadata,
  DocumentModeSettings,
  Layer,
  PluginDescriptor,
  PrintSettings,
  PsDocument,
  ThreeDMaterial,
  ThreeDObject,
  ThreeDScene,
  Vec3,
  VariableBinding,
} from "./types"
import { cmykToRgb, rgbToCmyk } from "./color-pipeline"
import { decodeAdvancedRasterBuffer, inspectExrHeader } from "./raster-codecs"
import { assertCanvasSize, assertFileSize, MAX_RASTER_FILE_BYTES } from "./canvas-limits"

const MB = 1024 * 1024

export const ADVANCED_FILE_LIMITS = {
  rasterBytes: MAX_RASTER_FILE_BYTES,
  modelTextBytes: 16 * MB,
  modelBinaryBytes: 32 * MB,
  jsonBytes: 2 * MB,
  csvBytes: 5 * MB,
  fontBytes: 20 * MB,
} as const

export const ADVANCED_3D_IMPORT_LIMITS = {
  textBytes: ADVANCED_FILE_LIMITS.modelTextBytes,
  vertices: 50_000,
  faces: 100_000,
  numericTokens: 500_000,
} as const

export function assertAdvancedFileSize(file: File, maxBytes = ADVANCED_FILE_LIMITS.rasterBytes, label = "Advanced file") {
  assertFileSize(file, maxBytes, label)
}

function clamp(value: number, min = 0, max = 255) {
  return Math.max(min, Math.min(max, value))
}

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

export type AdvancedFormatSupport = "native" | "preview" | "metadata" | "unsupported"

export interface AdvancedFormatCapability {
  id: string
  label: string
  extensions: string[]
  support: AdvancedFormatSupport
  supportLabel: string
  decodePath: string
  metadataPath: string
  exportPath: string
  limitations: string
  layerResult: string
}

export const ADVANCED_FORMAT_CAPABILITIES: AdvancedFormatCapability[] = [
  {
    id: "browser-raster",
    label: "PNG/JPEG/WebP/AVIF/GIF",
    extensions: ["png", "jpg", "jpeg", "webp", "avif", "gif"],
    support: "native",
    supportLabel: "Browser native",
    decodePath: "Decoded by the browser image engine when the current browser supports the MIME type.",
    metadataPath: "JPEG EXIF/XMP/IPTC is scanned; other raster metadata is not embedded into layers.",
    exportPath: "Exports flattened browser canvas pixels through canvas encoders for supported MIME types.",
    limitations: "Animated GIF imports as the browser-selected poster/first decoded frame. ICC profiles are not converted.",
    layerResult: "Creates an 8-bit RGBA canvas layer.",
  },
  {
    id: "camera-raw",
    label: "RAW/DNG",
    extensions: ["raw", "dng", "cr2", "nef", "arw"],
    support: "preview",
    supportLabel: "Preview only",
    decodePath: "Searches for an embedded JPEG preview and imports that preview when present.",
    metadataPath: "Basic file metadata and embedded JPEG metadata are reported when available.",
    exportPath: "Unsupported as native RAW/DNG export; use browser raster export or project format.",
    limitations: "No demosaic, camera profile, lens profile, high-bit pipeline, or non-destructive RAW settings.",
    layerResult: "Creates a layer only when an embedded JPEG preview is found.",
  },
  {
    id: "baseline-tiff",
    label: "TIFF",
    extensions: ["tif", "tiff"],
    support: "preview",
    supportLabel: "Baseline local decode",
    decodePath: "Decodes baseline uncompressed TIFF strips for grayscale/RGB/RGBA 8-bit and 16-bit previews.",
    metadataPath: "Reports dimensions, strips, byte order, source channel count, and bit depth from TIFF headers.",
    exportPath: "Models TIFF export as a flattened RGB/RGBA preview only; no native TIFF encoder is available in this browser subsystem.",
    limitations: "No LZW/ZIP/JPEG compression, tiled TIFF, planar data, CMYK separations, BigTIFF, or embedded ICC conversion.",
    layerResult: "Creates an 8-bit RGBA preview layer while preserving source depth in the import report.",
  },
  {
    id: "tga",
    label: "TGA",
    extensions: ["tga", "vda", "icb", "vst"],
    support: "preview",
    supportLabel: "Local decode",
    decodePath: "Decodes uncompressed and RLE TGA true-color, grayscale, and indexed pixels.",
    metadataPath: "Reports dimensions, RLE state, channel count, origin, and bit depth.",
    exportPath: "Unsupported as native TGA export; use browser raster export or project format.",
    limitations: "Imports to an 8-bit RGBA canvas; TGA-specific metadata is not embedded on export.",
    layerResult: "Creates an 8-bit RGBA layer from supported TGA files.",
  },
  {
    id: "portable-anymap",
    label: "PBM/PGM/PPM/PNM",
    extensions: ["pbm", "pgm", "ppm", "pnm"],
    support: "preview",
    supportLabel: "Local decode",
    decodePath: "Decodes ASCII and binary portable anymap grayscale/RGB pixels, including 16-bit PGM/PPM tone-mapped previews.",
    metadataPath: "Reports dimensions, max value, channel count, and source bit depth.",
    exportPath: "Unsupported as native PNM export; use browser raster export or project format.",
    limitations: "Creates an 8-bit preview; comments and original max-value/channel depth are not re-embedded on export.",
    layerResult: "Creates an 8-bit RGBA layer from supported portable anymap files.",
  },
  {
    id: "dicom",
    label: "DICOM",
    extensions: ["dcm", "dicom"],
    support: "preview",
    supportLabel: "Limited preview",
    decodePath: "Reads simple uncompressed monochrome pixel data with a DICM preamble.",
    metadataPath: "Reports file name, size, and DICOM preamble detection.",
    exportPath: "Unsupported as DICOM export; medical metadata and transfer syntaxes are not authored.",
    limitations: "Compressed transfer syntaxes, windowing presets, color modalities, overlays, and patient metadata workflows are not implemented.",
    layerResult: "Creates an 8-bit grayscale preview layer for supported uncompressed pixel data.",
  },
  {
    id: "radiance-hdr",
    label: "Radiance HDR",
    extensions: ["hdr", "rgbe"],
    support: "preview",
    supportLabel: "Tone-mapped preview",
    decodePath: "Reads common RGBE scanline data and tone maps into the browser canvas range.",
    metadataPath: "Reports header and dimensions when present.",
    exportPath: "Unsupported as native HDR/RGBE export; use project format or browser raster export.",
    limitations: "No scene-linear editing, OpenColorIO transform, exposure stack, or high dynamic range canvas output.",
    layerResult: "Creates an 8-bit preview layer for supported RGBE files.",
  },
  {
    id: "openexr",
    label: "EXR",
    extensions: ["exr"],
    support: "metadata",
    supportLabel: "Metadata only",
    decodePath: "OpenEXR pixel decoding is not available in the browser-native subsystem.",
    metadataPath: "Detects the EXR magic header and records file metadata.",
    exportPath: "Unsupported as OpenEXR export; no half-float channel writer is present.",
    limitations: "Requires a dedicated EXR codec to decode channels, compression, half floats, and multipart data.",
    layerResult: "Does not create a pixel layer.",
  },
  {
    id: "pdf",
    label: "PDF",
    extensions: ["pdf"],
    support: "metadata",
    supportLabel: "Metadata only",
    decodePath: "Detects PDF header and records document-format intent; no PDF page renderer is bundled.",
    metadataPath: "Reports file metadata and header markers when present.",
    exportPath: "Models PDF export as a composite preview/handoff limitation report; native multipage/vector PDF authoring is not implemented.",
    limitations: "No editable PDF vectors, fonts, transparency groups, annotations, or multipage placement are decoded or exported.",
    layerResult: "Does not create editable PDF vectors or text; a dedicated PDF renderer would be required for page previews.",
  },
  {
    id: "eps",
    label: "EPS / PostScript",
    extensions: ["eps", "ps"],
    support: "metadata",
    supportLabel: "Metadata only",
    decodePath: "Detects PostScript/EPS headers and BoundingBox comments only.",
    metadataPath: "Reports EPS/PostScript markers and optional BoundingBox values.",
    exportPath: "Unsupported as native EPS/PostScript export; use SVG/browser raster/project export instead.",
    limitations: "No PostScript interpreter, font resolution, overprint handling, separations, or editable vector import.",
    layerResult: "Does not create a pixel layer or editable vector layer.",
  },
  {
    id: "heif",
    label: "HEIF / HEIC",
    extensions: ["heif", "heic", "hif"],
    support: "metadata",
    supportLabel: "Metadata only",
    decodePath: "No HEIF/HEIC decoder is bundled; browser image MIME hints are not treated as Photoshop-compatible import support.",
    metadataPath: "Detects ISO BMFF ftyp brands such as heic/heif/mif1 when available.",
    exportPath: "Unsupported as native HEIF/HEIC export; browser AVIF/WebP/JPEG export remains separate.",
    limitations: "No HEVC image decode, depth/auxiliary images, live photo pairing, ICC conversion, or metadata embedding.",
    layerResult: "Does not create a pixel layer.",
  },
  {
    id: "jpeg2000",
    label: "JPEG 2000",
    extensions: ["jp2", "j2k", "jpf", "jpx", "jpm"],
    support: "metadata",
    supportLabel: "Metadata only",
    decodePath: "No JPEG 2000 decoder is bundled; JP2 boxes/codestream signatures are only identified.",
    metadataPath: "Detects JP2 signature boxes or raw codestream markers when present.",
    exportPath: "Unsupported as native JPEG 2000 export; no codestream writer is present.",
    limitations: "No wavelet codestream decode, alpha/channel boxes, color boxes, or lossless JPEG 2000 export.",
    layerResult: "Does not create a pixel layer.",
  },
  {
    id: "psb",
    label: "PSB",
    extensions: ["psb"],
    support: "metadata",
    supportLabel: "Metadata only",
    decodePath: "Large Document Format is detected from the 8BPS version-2 header; no layer/resource payload is decoded.",
    metadataPath: "Records signature, version, dimensions, channel count, bit depth, color mode, and extension/header mismatches.",
    exportPath: "Unsupported as native PSB export; the browser app has no tiled large-document writer.",
    limitations: "Use PSD import for supported PSD files. PSB layer/resources, large canvases, and 16/32-bit data need a dedicated PSB parser and tiled memory model.",
    layerResult: "Does not create a pixel layer.",
  },
]

function extensionForName(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? ""
}

export function capabilityForAdvancedFormat(name: string, mime = ""): AdvancedFormatCapability {
  const ext = extensionForName(name)
  const advanced = ADVANCED_FORMAT_CAPABILITIES.find((capability) => capability.extensions.includes(ext))
  if (advanced) return advanced
  if (mime.startsWith("image/")) return ADVANCED_FORMAT_CAPABILITIES[0]
  if (mime === "application/pdf") return ADVANCED_FORMAT_CAPABILITIES.find((capability) => capability.id === "pdf")!
  if (mime === "application/postscript") return ADVANCED_FORMAT_CAPABILITIES.find((capability) => capability.id === "eps")!
  return advanced
    ?? {
      id: "unknown",
      label: ext ? ext.toUpperCase() : "Unknown",
      extensions: ext ? [ext] : [],
      support: "unsupported",
      supportLabel: "Unsupported",
      decodePath: "No browser-native decoder is registered for this file type.",
      metadataPath: "Only file name, size, and MIME type can be reported.",
      exportPath: "Unsupported until a dedicated import/export strategy is registered.",
      limitations: "Add a dedicated decoder before presenting this as an importable Photoshop format.",
      layerResult: "Does not create a pixel layer.",
    }
}

function inspectPhotoshopFamilyHeader(buffer: ArrayBuffer, fileName: string) {
  if (buffer.byteLength < 26 || readAscii(buffer, 0, 4) !== "8BPS") return []
  const view = new DataView(buffer)
  const version = view.getUint16(4, false)
  const channels = view.getUint16(12, false)
  const height = view.getUint32(14, false)
  const width = view.getUint32(18, false)
  const depth = view.getUint16(22, false)
  const colorMode = view.getUint16(24, false)
  const kind = version === 2 ? "PSB Large Document Format" : version === 1 ? "PSD Photoshop Document" : "Unknown Photoshop-family"
  const ext = extensionForName(fileName)
  const notes = [
    `${kind} header: version ${version}, ${width}x${height}, ${channels} channel(s), ${depth}-bit, color mode ${colorMode}`,
  ]
  if (version === 2) {
    notes.push("PSB layer/resource payload is not decoded; import remains metadata-only until a tiled PSB parser is available")
  } else if (version === 1) {
    notes.push("PSD header detected; full PSD import is handled by the PSD importer rather than the advanced-format preview path")
  }
  if (ext === "psb" && version !== 2) notes.push(`Extension/header mismatch: .psb file advertises Photoshop version ${version}`)
  if (ext === "psd" && version === 2) notes.push("Extension/header mismatch: .psd file contains a PSB version-2 header")
  return notes
}

export async function inspectAdvancedFormatFile(file: File) {
  assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.rasterBytes, "Advanced format file")
  const capability = capabilityForAdvancedFormat(file.name, file.type)
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const technical: string[] = [
    `Capability: ${capability.supportLabel}`,
    `Decode path: ${capability.decodePath}`,
    `Export path: ${capability.exportPath}`,
    `Layer result: ${capability.layerResult}`,
    `Limits: ${capability.limitations}`,
  ]
  if (bytes.length >= 4 && bytes[0] === 0x76 && bytes[1] === 0x2f && bytes[2] === 0x31 && bytes[3] === 0x01) {
    technical.push(...inspectExrHeader(buffer).warnings)
  } else if (bytes.length >= 4 && readAscii(buffer, 0, 4) === "8BPS") {
    technical.push(...inspectPhotoshopFamilyHeader(buffer, file.name))
  } else if (bytes.length >= 132 && readAscii(buffer, 128, 4) === "DICM") {
    technical.push("DICOM DICM preamble detected")
  } else if (bytes.length >= 10) {
    const head = new TextDecoder("ascii").decode(buffer.slice(0, Math.min(buffer.byteLength, 64)))
    if (head.startsWith("#?RADIANCE") || head.startsWith("#?RGBE")) technical.push("Radiance HDR header detected")
    if (head.startsWith("%PDF-")) technical.push("PDF header detected; page rendering is not available in this subsystem")
    if (head.startsWith("%!PS-Adobe")) technical.push("PostScript/EPS header detected; no PostScript interpreter is available")
  }
  if (bytes.length >= 12) {
    const brand = readAscii(buffer, 8, 4)
    if (["heic", "heif", "mif1", "msf1", "heim", "heis"].includes(brand)) {
      technical.push(`HEIF/HEIC ISO BMFF brand detected: ${brand}`)
    }
    if (bytes[0] === 0xff && bytes[1] === 0x4f) {
      technical.push("JPEG 2000 codestream marker detected")
    } else if (bytes[4] === 0x6a && bytes[5] === 0x50 && bytes[6] === 0x20 && bytes[7] === 0x20) {
      technical.push("JPEG 2000 JP2 signature box detected")
    }
  }
  const decoded = decodeAdvancedRasterBuffer(buffer, file.name)
  if (decoded) {
    technical.push(`${decoded.format} local decoder: ${decoded.width}x${decoded.height}, ${decoded.channels} channel(s), source ${decoded.bitDepth}-bit, ${decoded.compression} compression`)
    technical.push(...decoded.warnings)
  }
  return { capability, technical }
}

export function createSubsystemCanvas(width: number, height: number, fill?: string) {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  if (fill) {
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  return canvas
}

function hexToRgb(hex: string) {
  const value = hex.replace("#", "").trim()
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value.padEnd(6, "0").slice(0, 6)
  const n = Number.parseInt(full, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((v) => clamp(Math.round(v)).toString(16).padStart(2, "0")).join("")}`
}

function mixColor(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, t: number) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  }
}

function luminance(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return { h, s, l }
}

function hslToRgb(h: number, s: number, l: number) {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  if (s === 0) {
    const v = l * 255
    return { r: v, g: v, b: v }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255,
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

function normalizeMesh(vertices: Vec3[]) {
  if (!vertices.length) return vertices
  const min = vertices.reduce((acc, p) => vec(Math.min(acc.x, p.x), Math.min(acc.y, p.y), Math.min(acc.z, p.z)), vec(Infinity, Infinity, Infinity))
  const max = vertices.reduce((acc, p) => vec(Math.max(acc.x, p.x), Math.max(acc.y, p.y), Math.max(acc.z, p.z)), vec(-Infinity, -Infinity, -Infinity))
  const center = mul(add(min, max), 0.5)
  const scale = 2 / Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 0.01)
  return vertices.map((p) => mul(sub(p, center), scale))
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
  for (let i = 0; i < text.length; i++) {
    if (!startsNumericToken(text, i)) continue
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
  for (let i = 0; i <= text.length; i++) {
    const code = i < text.length ? text.charCodeAt(i) : 10
    if (i < text.length && code !== 10 && code !== 13) continue
    callback(text.slice(start, i))
    if (code === 13 && text.charCodeAt(i + 1) === 10) i += 1
    start = i + 1
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
    for (const vertex of object.vertices.map((v) => transformVertex(v, object))) {
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
  for (let i = 0; i + 2 < floats.length; i += 3) vertices.push(vec(floats[i], floats[i + 1], floats[i + 2]))
  const rawIndices = pText.trim() ? pText.trim().split(/\s+/).map(Number).filter(Number.isFinite) : []
  const stride = rawIndices.length >= 6 && vertices.length ? Math.max(1, Math.floor(rawIndices.length / Math.max(1, Math.floor(rawIndices.length / 3)))) : 1
  const indices = rawIndices.filter((_, index) => index % stride === 0).map((value) => value % Math.max(1, vertices.length))
  const faces: number[][] = []
  for (let i = 0; i + 2 < indices.length; i += 3) {
    assertModelCount("DAE", "faces", faces.length + 1, ADVANCED_3D_IMPORT_LIMITS.faces)
    faces.push([indices[i], indices[i + 1], indices[i + 2]])
  }
  if (!vertices.length || !faces.length) return createPrimitiveThreeDScene("cube")
  const scene = createPrimitiveThreeDScene("cube")
  const material = scene.materials[0]
  scene.objects = [createObject("DAE Mesh", normalizeMesh(vertices), faces, material.id)]
  scene.selectedObjectId = scene.objects[0].id
  return scene
}

export function exportSceneToDae(scene: ThreeDScene) {
  const vertices = scene.objects.flatMap((object) => object.vertices.map((v) => transformVertex(v, object)))
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
    <source id="mesh-positions"><float_array id="mesh-positions-array" count="${vertices.length * 3}">${vertices.map((v) => `${v.x.toFixed(5)} ${v.y.toFixed(5)} ${v.z.toFixed(5)}`).join(" ")}</float_array><technique_common><accessor source="#mesh-positions-array" count="${vertices.length}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
    <vertices id="mesh-vertices"><input semantic="POSITION" source="#mesh-positions"/></vertices>
    <triangles count="${Math.floor(faces.length / 3)}"><input semantic="VERTEX" source="#mesh-vertices" offset="0"/><p>${faces.join(" ")}</p></triangles>
  </mesh></geometry></library_geometries>
</COLLADA>`
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

function simulateCmyk(r: number, g: number, b: number, dotGain = 0.08) {
  const cmyk = rgbToCmyk({ r, g, b }, { blackGeneration: dotGain > 0.1 ? "heavy" : "medium", totalInkLimit: dotGain > 0.1 ? 300 : 320 })
  return cmykToRgb({ ...cmyk, k: clamp(cmyk.k * (1 + dotGain), 0, 1) })
}

function applyWorkingProfile(r: number, g: number, b: number, profile?: string) {
  const hsl = rgbToHsl(r, g, b)
  if (profile === "Display P3") hsl.s = clamp(hsl.s * 1.08, 0, 1)
  if (profile === "Adobe RGB (1998)") hsl.s = clamp(hsl.s * 1.04, 0, 1)
  if (profile === "ProPhoto RGB") hsl.s = clamp(hsl.s * 1.12, 0, 1)
  return hslToRgb(hsl.h, hsl.s, hsl.l)
}

function isOutOfProofGamut(r: number, g: number, b: number, settings?: ColorManagementSettings) {
  if (!settings?.gamutWarning) return false
  const hsl = rgbToHsl(r, g, b)
  if ((settings.proofProfile ?? "").includes("CMYK") || settings.proofProfile.includes("SWOP")) {
    return hsl.s > 0.68 && (Math.max(r, g, b) > 220 || Math.min(r, g, b) < 35)
  }
  if (settings.proofProfile === "Dot Gain 20%") return hsl.s > 0.08
  return false
}

export function applyModeAndColorManagement(source: HTMLCanvasElement, doc: Pick<PsDocument, "colorMode" | "modeSettings" | "colorManagement">) {
  const modeSettings = doc.modeSettings ?? { mode: doc.colorMode }
  const color = doc.colorManagement
  const active =
    doc.colorMode !== "RGB" ||
    modeSettings.mode !== "RGB" ||
    color?.proofColors ||
    color?.gamutWarning ||
    color?.assignedProfile !== color?.workingSpace
  if (!active) return source

  const canvas = createSubsystemCanvas(source.width, source.height)
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(source, 0, 0)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const ink1 = hexToRgb(modeSettings.duotone?.ink1 ?? "#111111")
  const ink2 = hexToRgb(modeSettings.duotone?.ink2 ?? "#1f80ff")
  const indexedLevels = Math.max(2, Math.round(Math.cbrt(modeSettings.indexed?.colors ?? 64)))
  const trap = modeSettings.trap?.enabled ? { width: modeSettings.trap.widthPx, strength: modeSettings.trap.strength } : null
  const original = new Uint8ClampedArray(image.data)

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4
      if (image.data[i + 3] === 0) continue
      let r = image.data[i]
      let g = image.data[i + 1]
      let b = image.data[i + 2]
      const lum = luminance(r, g, b)
      const mode = modeSettings.mode
      if (mode === "Grayscale") {
        r = g = b = lum
      } else if (mode === "Duotone") {
        const t = Math.pow(lum / 255, modeSettings.duotone?.curve ?? 1)
        const mixed = mixColor(ink1, ink2, t)
        r = mixed.r
        g = mixed.g
        b = mixed.b
      } else if (mode === "Indexed") {
        const step = 255 / (indexedLevels - 1)
        r = Math.round(r / step) * step
        g = Math.round(g / step) * step
        b = Math.round(b / step) * step
        if (modeSettings.indexed?.dither) {
          const n = ((x * 13 + y * 17) % 9 - 4) * 2
          r += n
          g += n
          b += n
        }
      } else if (mode === "Bitmap") {
        const threshold = modeSettings.bitmap?.threshold ?? 128
        if (modeSettings.bitmap?.method === "halftone") {
          const frequency = Math.max(4, modeSettings.bitmap.frequency)
          const angle = ((modeSettings.bitmap.angle ?? 45) * Math.PI) / 180
          const u = x * Math.cos(angle) + y * Math.sin(angle)
          const v = -x * Math.sin(angle) + y * Math.cos(angle)
          const wave = (Math.sin(u / frequency) + Math.sin(v / frequency)) * 32 + threshold
          r = g = b = lum > wave ? 255 : 0
        } else {
          r = g = b = lum >= threshold ? 255 : 0
        }
      } else if (mode === "Multichannel") {
        const channels = modeSettings.multichannel?.channels
        r = channels?.r === false ? 0 : r
        g = channels?.g === false ? 0 : g
        b = channels?.b === false ? 0 : b
      } else if (mode === "CMYK") {
        const cmyk = simulateCmyk(r, g, b, color?.simulateBlackInk ? 0.12 : 0.04)
        r = cmyk.r
        g = cmyk.g
        b = cmyk.b
      }

      const profiled = applyWorkingProfile(r, g, b, color?.assignedProfile)
      r = profiled.r
      g = profiled.g
      b = profiled.b

      if (color?.proofColors && color.proofProfile !== "None") {
        if (color.proofProfile.includes("CMYK") || color.proofProfile.includes("SWOP") || color.proofProfile.includes("Japan")) {
          const proof = simulateCmyk(r, g, b, color.proofProfile.includes("SWOP") ? 0.13 : 0.08)
          r = proof.r
          g = proof.g
          b = proof.b
        } else if (color.proofProfile === "Dot Gain 20%") {
          const gray = Math.pow(luminance(r, g, b) / 255, 1.16) * 255
          r = g = b = gray
        }
      }

      if (isOutOfProofGamut(original[i], original[i + 1], original[i + 2], color)) {
        r = r * 0.35 + 128 * 0.65
        g = g * 0.2 + 128 * 0.25
        b = b * 0.35 + 255 * 0.65
      }
      image.data[i] = clamp(r)
      image.data[i + 1] = clamp(g)
      image.data[i + 2] = clamp(b)
    }
  }
  if (trap) applyTrapToImageData(image, Math.round(trap.width), trap.strength)
  ctx.putImageData(image, 0, 0)
  return canvas
}

function applyTrapToImageData(image: ImageData, width: number, strength: number) {
  if (width <= 0 || strength <= 0) return
  const source = new Uint8ClampedArray(image.data)
  for (let pass = 0; pass < Math.min(4, width); pass++) {
    for (let y = 1; y < image.height - 1; y++) {
      for (let x = 1; x < image.width - 1; x++) {
        const i = (y * image.width + x) * 4
        const lum = luminance(source[i], source[i + 1], source[i + 2])
        const right = i + 4
        const down = i + image.width * 4
        const edge = Math.max(Math.abs(lum - luminance(source[right], source[right + 1], source[right + 2])), Math.abs(lum - luminance(source[down], source[down + 1], source[down + 2])))
        if (edge < 35) continue
        for (let k = 0; k < 3; k++) image.data[i + k] = clamp(image.data[i + k] * (1 - strength) + Math.min(source[right + k], source[down + k], source[i + k]) * strength)
      }
    }
  }
}

export function convertCanvasToDocumentMode(source: HTMLCanvasElement, settings: DocumentModeSettings) {
  return applyModeAndColorManagement(source, { colorMode: settings.mode, modeSettings: settings, colorManagement: undefined })
}

function pageSizePx(settings: PrintSettings) {
  const landscape = settings.orientation === "landscape"
  const sizes: Record<PrintSettings["paperSize"], { w: number; h: number }> = {
    Letter: { w: 816, h: 1056 },
    A4: { w: 794, h: 1123 },
    A3: { w: 1123, h: 1587 },
    Tabloid: { w: 1056, h: 1632 },
    Custom: { w: 960, h: 1200 },
  }
  const size = sizes[settings.paperSize]
  return landscape ? { w: size.h, h: size.w } : size
}

function mmToPx(mm: number) {
  return (mm / 25.4) * 96
}

export interface PrintPreviewMark {
  kind: "crop" | "registration" | "center" | "bleed" | "label"
  enabled: boolean
  label: string
  description: string
  geometry?: { x: number; y: number; width: number; height: number }
}

export interface PrintPreviewRisk {
  id: string
  severity: "info" | "warn" | "error"
  category: "scope" | "marks" | "bleed" | "placement" | "proof" | "profile" | "raster"
  detail: string
}

export interface PrintPreviewReport {
  documentName: string
  certifiedPrepressOutput: false
  page: { width: number; height: number; paperSize: PrintSettings["paperSize"]; orientation: PrintSettings["orientation"] }
  pagePosition: NonNullable<PrintSettings["pagePosition"]>
  scalePercent: number
  contentRect: { x: number; y: number; width: number; height: number }
  trimRect: { x: number; y: number; width: number; height: number }
  bleed: { requestedMm: number; pixels: number; trimInsetPx: number }
  marks: PrintPreviewMark[]
  proof: {
    enabled: boolean
    colorHandling: PrintSettings["colorHandling"]
    printerProfile: PrintSettings["printerProfile"] | "Unspecified"
    documentProfile?: string
  }
  limitations: string[]
  risks: PrintPreviewRisk[]
}

export function buildPrintPreviewReport(
  flat: HTMLCanvasElement,
  settings: PrintSettings,
  docName: string,
  doc?: PsDocument,
): PrintPreviewReport {
  const page = pageSizePx(settings)
  const bleedPx = mmToPx(settings.bleedMm)
  const marksOffset = mmToPx(settings.marksOffsetMm ?? 4)
  const pad = settings.cropMarks || settings.registrationMarks || settings.bleedMm > 0 ? 64 + marksOffset : 24
  const pageX = pad
  const pageY = pad
  const printableW = Math.max(1, page.w - bleedPx * 2)
  const printableH = Math.max(1, page.h - bleedPx * 2)
  const drawW = Math.min(printableW, flat.width * (settings.scale / 100))
  const drawH = Math.min(printableH, flat.height * (settings.scale / 100))
  const pagePosition = settings.pagePosition ?? "center"
  const contentX = pagePosition === "top-left" ? pageX + bleedPx : pageX + (page.w - drawW) / 2
  const contentY = pagePosition === "top-left" ? pageY + bleedPx : pageY + (page.h - drawH) / 2
  const label = `${docName} - ${settings.paperSize} - ${settings.colorHandling === "app" ? "app color managed" : "printer color managed"}`
  const documentProfile = doc?.colorManagement?.assignedProfile
  const proofProfile = settings.printerProfile ?? doc?.colorManagement?.proofProfile ?? "Unspecified"
  const risks: PrintPreviewRisk[] = [
    {
      id: "browser-print-not-certified",
      severity: "info",
      category: "scope",
      detail: "Browser print preview is a composited canvas aid, not certified prepress, PDF/X, or contract-proof output.",
    },
  ]

  if (settings.bleedMm <= 0) {
    risks.push({ id: "bleed-missing", severity: "warn", category: "bleed", detail: "No bleed is requested; many printers require 3mm or more." })
  } else if (settings.bleedMm < 3) {
    risks.push({ id: "bleed-below-3mm", severity: "warn", category: "bleed", detail: `${settings.bleedMm}mm bleed is below the common 3mm print requirement.` })
  }
  if (!settings.cropMarks && !settings.registrationMarks) {
    risks.push({ id: "marks-missing", severity: "warn", category: "marks", detail: "Crop and registration marks are disabled." })
  }
  if (pagePosition === "top-left") {
    risks.push({ id: "top-left-placement", severity: "warn", category: "placement", detail: "Top-left placement can hide centering or imposition problems." })
  }
  if (flat.width * (settings.scale / 100) > printableW || flat.height * (settings.scale / 100) > printableH) {
    risks.push({ id: "scaled-content-clipped", severity: "warn", category: "placement", detail: "Scaled artwork exceeds the trim-safe image area and is being constrained in preview." })
  }
  if (settings.proofPrint && (!proofProfile || proofProfile === "None")) {
    risks.push({ id: "proof-profile-missing", severity: "warn", category: "proof", detail: "Proof print is enabled without a printer/proof profile." })
  }
  if (settings.proofPrint || documentProfile || proofProfile !== "Unspecified") {
    risks.push({
      id: "icc-profile-limitation",
      severity: "warn",
      category: "profile",
      detail: "Profile and proof settings are represented as report metadata; the browser canvas path does not run certified ICC conversion or embed ICC output here.",
    })
  }
  if ((doc?.bitDepth ?? 8) > 8 || doc?.colorMode === "CMYK" || doc?.colorMode === "Multichannel" || (doc?.channels?.length ?? 0) > 0) {
    risks.push({
      id: "raster-flattening",
      severity: "warn",
      category: "raster",
      detail: "High-bit, CMYK/multichannel, alpha, and spot-channel intent is flattened into an 8-bit RGBA preview for browser printing.",
    })
  }

  return {
    documentName: docName,
    certifiedPrepressOutput: false,
    page: { width: page.w, height: page.h, paperSize: settings.paperSize, orientation: settings.orientation },
    pagePosition,
    scalePercent: settings.scale,
    contentRect: { x: contentX, y: contentY, width: drawW, height: drawH },
    trimRect: { x: pageX, y: pageY, width: page.w, height: page.h },
    bleed: { requestedMm: settings.bleedMm, pixels: bleedPx, trimInsetPx: bleedPx },
    marks: [
      {
        kind: "crop",
        enabled: settings.cropMarks,
        label: "Crop marks",
        description: "Corner trim indicators drawn outside the page edge.",
        geometry: { x: pageX - marksOffset - 36, y: pageY - marksOffset - 36, width: page.w + marksOffset * 2 + 72, height: page.h + marksOffset * 2 + 72 },
      },
      {
        kind: "registration",
        enabled: settings.registrationMarks,
        label: "Registration marks",
        description: "Crosshair targets for visual plate alignment checks in the preview.",
        geometry: { x: pageX - 50, y: pageY - 50, width: page.w + 100, height: page.h + 100 },
      },
      {
        kind: "center",
        enabled: settings.registrationMarks,
        label: "Center marks",
        description: "Page-center marks are represented by the midpoint registration targets.",
        geometry: { x: pageX + page.w / 2 - 16, y: pageY + page.h / 2 - 16, width: 32, height: 32 },
      },
      {
        kind: "bleed",
        enabled: settings.bleedMm > 0,
        label: "Bleed guide",
        description: "Dashed red guide shows the bleed inset used by the browser preview.",
        geometry: { x: pageX + bleedPx, y: pageY + bleedPx, width: page.w - bleedPx * 2, height: page.h - bleedPx * 2 },
      },
      {
        kind: "label",
        enabled: true,
        label,
        description: "Human-readable preview label only; not production slug metadata.",
      },
    ],
    proof: {
      enabled: settings.proofPrint,
      colorHandling: settings.colorHandling,
      printerProfile: proofProfile,
      documentProfile,
    },
    limitations: [
      "Browser print is not certified prepress output.",
      "ICC transforms, embedded profiles, PDF/X metadata, trapping, spot plates, and separations are not emitted by this canvas preview.",
      "Use the generated data as a risk report and verify final production files in a dedicated prepress workflow.",
    ],
    risks,
  }
}

export function buildPrintPreviewCanvas(flat: HTMLCanvasElement, settings: PrintSettings, docName: string) {
  const report = buildPrintPreviewReport(flat, settings, docName)
  const page = pageSizePx(settings)
  const bleed = mmToPx(settings.bleedMm)
  const marksOffset = mmToPx(settings.marksOffsetMm ?? 4)
  const pad = settings.cropMarks || settings.registrationMarks || settings.bleedMm > 0 ? 64 + marksOffset : 24
  const canvas = createSubsystemCanvas(page.w + pad * 2, page.h + pad * 2, settings.paperColor ?? "#ffffff")
  const ctx = canvas.getContext("2d")!
  const pageX = pad
  const pageY = pad
  ctx.fillStyle = settings.paperColor ?? "#ffffff"
  ctx.fillRect(pageX, pageY, page.w, page.h)
  ctx.strokeStyle = "#d4d4d4"
  ctx.strokeRect(pageX, pageY, page.w, page.h)
  const drawW = Math.min(page.w - bleed * 2, flat.width * (settings.scale / 100))
  const drawH = Math.min(page.h - bleed * 2, flat.height * (settings.scale / 100))
  const x = settings.pagePosition === "top-left" ? pageX + bleed : pageX + (page.w - drawW) / 2
  const y = settings.pagePosition === "top-left" ? pageY + bleed : pageY + (page.h - drawH) / 2
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(flat, x, y, drawW, drawH)
  if (settings.bleedMm > 0) {
    ctx.setLineDash([6, 4])
    ctx.strokeStyle = "#ef4444"
    ctx.strokeRect(pageX + bleed, pageY + bleed, page.w - bleed * 2, page.h - bleed * 2)
    ctx.setLineDash([])
  }
  if (settings.cropMarks) drawCropMarks(ctx, pageX, pageY, page.w, page.h, marksOffset)
  if (settings.registrationMarks) drawRegistrationMarks(ctx, pageX, pageY, page.w, page.h)
  ctx.fillStyle = "#111827"
  ctx.font = "12px sans-serif"
  ctx.fillText(`${docName} - ${settings.paperSize} - ${settings.colorHandling === "app" ? "app color managed" : "printer color managed"}`, pageX, canvas.height - 18)
  ;(canvas as HTMLCanvasElement & { __printPreviewReport?: PrintPreviewReport }).__printPreviewReport = report
  return canvas
}

function drawCropMarks(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, offset: number) {
  ctx.strokeStyle = "#111827"
  ctx.lineWidth = 1
  const len = 36
  const marks = [
    [x - offset - len, y, x - offset, y], [x, y - offset - len, x, y - offset],
    [x + w + offset, y, x + w + offset + len, y], [x + w, y - offset - len, x + w, y - offset],
    [x - offset - len, y + h, x - offset, y + h], [x, y + h + offset, x, y + h + offset + len],
    [x + w + offset, y + h, x + w + offset + len, y + h], [x + w, y + h + offset, x + w, y + h + offset + len],
  ]
  for (const [x1, y1, x2, y2] of marks) {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
}

function drawRegistrationMarks(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const points = [[x + w / 2, y - 34], [x + w / 2, y + h + 34], [x - 34, y + h / 2], [x + w + 34, y + h / 2]]
  ctx.strokeStyle = "#111827"
  for (const [cx, cy] of points) {
    ctx.beginPath()
    ctx.arc(cx, cy, 10, 0, Math.PI * 2)
    ctx.moveTo(cx - 16, cy)
    ctx.lineTo(cx + 16, cy)
    ctx.moveTo(cx, cy - 16)
    ctx.lineTo(cx, cy + 16)
    ctx.stroke()
  }
}

export function applyPluginFilterToCanvas(canvas: HTMLCanvasElement, plugin: PluginDescriptor) {
  if (plugin.kind !== "8bf-filter" || !Array.isArray(plugin.filterKernel) || plugin.filterKernel.length !== 9) return canvas
  const out = createSubsystemCanvas(canvas.width, canvas.height)
  const ctx = out.getContext("2d")!
  ctx.drawImage(canvas, 0, 0)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const source = new Uint8ClampedArray(image.data)
  const divisor = plugin.filterDivisor || plugin.filterKernel.reduce((sum, n) => sum + n, 0) || 1
  const bias = plugin.filterBias ?? 0
  for (let y = 1; y < image.height - 1; y++) {
    for (let x = 1; x < image.width - 1; x++) {
      const i = (y * image.width + x) * 4
      for (let c = 0; c < 3; c++) {
        let sum = 0
        let k = 0
        for (let yy = -1; yy <= 1; yy++) {
          for (let xx = -1; xx <= 1; xx++) {
            sum += source[((y + yy) * image.width + (x + xx)) * 4 + c] * plugin.filterKernel[k++]
          }
        }
        image.data[i + c] = clamp(sum / divisor + bias)
      }
    }
  }
  ctx.putImageData(image, 0, 0)
  return out
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"' && text[i + 1] === '"') {
      cell += '"'
      i++
    } else if (ch === '"') {
      quoted = !quoted
    } else if (ch === "," && !quoted) {
      row.push(cell)
      cell = ""
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(cell)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      cell = ""
    } else {
      cell += ch
    }
  }
  row.push(cell)
  if (row.some((value) => value.trim())) rows.push(row)
  const headers = rows.shift()?.map((value) => value.trim()) ?? []
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])))
}

function drawTextLayer(canvas: HTMLCanvasElement, text: NonNullable<Layer["text"]>) {
  const ctx = canvas.getContext("2d")!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const size = text.size
  ctx.font = `${text.italic ? "italic " : ""}${text.weight} ${size}px ${text.font}`
  ctx.fillStyle = text.color
  ctx.textAlign = text.align
  ctx.textBaseline = "alphabetic"
  const content = text.allCaps ? text.content.toUpperCase() : text.content
  const words = content.split(/\s+/)
  const lines: string[] = []
  const maxWidth = text.boxWidth ?? canvas.width - text.x
  let line = ""
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (text.boxWidth && ctx.measureText(next).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  lines.push(line)
  const leading = text.leading ?? size * 1.2
  lines.forEach((lineText, index) => ctx.fillText(lineText, text.x, text.y + index * leading + (text.baselineShift ?? 0)))
}

export function createVariableDocumentVariant(doc: PsDocument, row: Record<string, string>, bindings: VariableBinding[]) {
  return {
    ...doc,
    layers: doc.layers.map((layer) => {
      let next: Layer = { ...layer }
      for (const binding of bindings.filter((item) => item.layerId === layer.id)) {
        const value = row[binding.column]
        if (value === undefined) continue
        if (binding.property === "text" && next.text) {
          const canvas = createSubsystemCanvas(layer.canvas.width, layer.canvas.height)
          const text = { ...next.text, content: value }
          next = { ...next, canvas, text }
          drawTextLayer(canvas, text)
        } else if (binding.property === "visibility") {
          next = { ...next, visible: !/^(false|0|no|off)$/i.test(value.trim()) }
        } else if (binding.property === "opacity") {
          next = { ...next, opacity: clamp(Number(value), 0, 100) / 100 }
        }
      }
      return next
    }),
  }
}

function readAscii(buffer: ArrayBuffer, start: number, length: number) {
  return new TextDecoder("ascii").decode(buffer.slice(start, start + length))
}

function parseExifTags(buffer: ArrayBuffer, offset: number): Partial<DocumentMetadata> {
  const view = new DataView(buffer, offset)
  const little = readAscii(buffer, offset, 2) === "II"
  const get16 = (pos: number) => view.getUint16(pos, little)
  const get32 = (pos: number) => view.getUint32(pos, little)
  const ifd = get32(4)
  const count = get16(ifd)
  const out: Partial<DocumentMetadata> = {}
  const readValue = (type: number, count: number, valueOffset: number) => {
    if (type === 2) {
      const absolute = count <= 4 ? offset + valueOffset : offset + valueOffset
      return new TextDecoder().decode(buffer.slice(absolute, absolute + count)).replace(/\0/g, "").trim()
    }
    return ""
  }
  for (let i = 0; i < count; i++) {
    const pos = ifd + 2 + i * 12
    const tag = get16(pos)
    const type = get16(pos + 2)
    const len = get32(pos + 4)
    const val = get32(pos + 8)
    const text = readValue(type, len, val)
    if (!text) continue
    if (tag === 0x010e) out.description = text
    if (tag === 0x013b) out.author = text
    if (tag === 0x8298) out.copyright = text
    if (tag === 0x0131) out.source = text
    if (tag === 0x0132) out.modifiedAt = text
  }
  return out
}

export async function extractMetadataFromFile(file: File) {
  assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.rasterBytes, "Metadata file")
  const buffer = await file.arrayBuffer()
  const view = new DataView(buffer)
  const metadata: Partial<DocumentMetadata> = { title: file.name, source: file.type || file.name.split(".").pop()?.toUpperCase() }
  const technical: string[] = [`${file.name} (${Math.round(file.size / 1024)} KB)`]
  if (buffer.byteLength < 2) return { metadata, technical: [...technical, "File is too small for format metadata parsing"] }
  if (view.getUint16(0) === 0xffd8) {
    let offset = 2
    while (offset + 4 < buffer.byteLength) {
      if (view.getUint8(offset) !== 0xff) break
      const marker = view.getUint8(offset + 1)
      const length = view.getUint16(offset + 2)
      if (marker === 0xe1) {
        const header = readAscii(buffer, offset + 4, 6)
        if (header.startsWith("Exif")) Object.assign(metadata, parseExifTags(buffer, offset + 10))
        const text = new TextDecoder().decode(buffer.slice(offset + 4, offset + 2 + length))
        const title = text.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>(.*?)<\/rdf:li>/i)?.[1]
        if (title) metadata.title = title
      }
      if (marker === 0xed) {
        const text = new TextDecoder("latin1").decode(buffer.slice(offset + 4, offset + 2 + length))
        const match = text.match(/\x1c\x02x([^\x1c]+)/)
        if (match) metadata.description = match[1].trim()
      }
      offset += 2 + length
    }
    technical.push("JPEG EXIF/XMP/IPTC segments scanned")
  }
  return { metadata, technical }
}

export async function extractEmbeddedJpegDataUrl(file: File) {
  assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.rasterBytes, "RAW/DNG file")
  const bytes = new Uint8Array(await file.arrayBuffer())
  let start = -1
  let end = -1
  for (let i = 0; i < bytes.length - 1; i++) {
    if (start < 0 && bytes[i] === 0xff && bytes[i + 1] === 0xd8) start = i
    if (start >= 0 && bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
      end = i + 2
      break
    }
  }
  if (start < 0 || end < 0) return null
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(new Blob([bytes.slice(start, end)], { type: "image/jpeg" }))
  })
}

export async function decodeDicomPreview(file: File) {
  assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.rasterBytes, "DICOM file")
  const buffer = await file.arrayBuffer()
  if (buffer.byteLength < 132 || readAscii(buffer, 128, 4) !== "DICM") return null
  const view = new DataView(buffer)
  let offset = 132
  let rows = 0
  let cols = 0
  let bits = 8
  let pixelOffset = -1
  let pixelLength = 0
  while (offset + 12 < buffer.byteLength) {
    const group = view.getUint16(offset, true)
    const element = view.getUint16(offset + 2, true)
    const vr = readAscii(buffer, offset + 4, 2)
    let length = view.getUint16(offset + 6, true)
    let dataOffset = offset + 8
    if (["OB", "OW", "SQ", "UN", "UT"].includes(vr)) {
      length = view.getUint32(offset + 8, true)
      dataOffset = offset + 12
    }
    if (group === 0x0028 && element === 0x0010) rows = view.getUint16(dataOffset, true)
    if (group === 0x0028 && element === 0x0011) cols = view.getUint16(dataOffset, true)
    if (group === 0x0028 && element === 0x0100) bits = view.getUint16(dataOffset, true)
    if (group === 0x7fe0 && element === 0x0010) {
      pixelOffset = dataOffset
      pixelLength = length
      break
    }
    offset = dataOffset + length
  }
  if (!rows || !cols || pixelOffset < 0) return null
  const size = assertCanvasSize(cols, rows, "DICOM preview")
  const canvas = createSubsystemCanvas(size.width, size.height, "#000000")
  const ctx = canvas.getContext("2d")!
  const image = ctx.getImageData(0, 0, size.width, size.height)
  const count = Math.min(size.width * size.height, pixelLength / (bits > 8 ? 2 : 1))
  for (let i = 0; i < count; i++) {
    const value = bits > 8 ? view.getUint16(pixelOffset + i * 2, true) / 257 : view.getUint8(pixelOffset + i)
    image.data[i * 4] = value
    image.data[i * 4 + 1] = value
    image.data[i * 4 + 2] = value
    image.data[i * 4 + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

export async function decodeRadianceHdrPreview(file: File) {
  assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.rasterBytes, "Radiance HDR file")
  const buffer = await file.arrayBuffer()
  const textHead = new TextDecoder("ascii").decode(buffer.slice(0, Math.min(buffer.byteLength, 4096)))
  if (!textHead.startsWith("#?RADIANCE") && !textHead.startsWith("#?RGBE")) return null
  const dimMatch = textHead.match(/-Y\s+(\d+)\s+\+X\s+(\d+)/)
  if (!dimMatch) return null
  const height = Number(dimMatch[1])
  const width = Number(dimMatch[2])
  const size = assertCanvasSize(width, height, "Radiance HDR preview")
  const headerLength = textHead.indexOf(dimMatch[0]) + dimMatch[0].length + 1
  const bytes = new Uint8Array(buffer, headerLength)
  const canvas = createSubsystemCanvas(size.width, size.height)
  const ctx = canvas.getContext("2d")!
  const image = ctx.getImageData(0, 0, size.width, size.height)
  let p = 0
  for (let i = 0; i < size.width * size.height && p + 3 < bytes.length; i++, p += 4) {
    const e = bytes[p + 3]
    const scale = e ? Math.pow(2, e - 136) : 0
    image.data[i * 4] = clamp(bytes[p] * scale)
    image.data[i * 4 + 1] = clamp(bytes[p + 1] * scale)
    image.data[i * 4 + 2] = clamp(bytes[p + 2] * scale)
    image.data[i * 4 + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

export function makeXmpMetadata(metadata: DocumentMetadata) {
  const keywords = (metadata.keywords ?? []).map((keyword) => `<rdf:li>${escapeXml(keyword)}</rdf:li>`).join("")
  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(metadata.title ?? "")}</rdf:li></rdf:Alt></dc:title>
<dc:creator><rdf:Seq><rdf:li>${escapeXml(metadata.author ?? "")}</rdf:li></rdf:Seq></dc:creator>
<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(metadata.description ?? "")}</rdf:li></rdf:Alt></dc:description>
<dc:subject><rdf:Bag>${keywords}</rdf:Bag></dc:subject>
<xmpRights:Marked>${metadata.copyright ? "True" : "False"}</xmpRights:Marked>
<xmpRights:UsageTerms><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(metadata.copyright ?? "")}</rdf:li></rdf:Alt></xmpRights:UsageTerms>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`
}

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch] ?? ch)
}
