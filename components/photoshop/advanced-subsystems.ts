import type {
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
import {
  applyIccTransformToImageData,
  buildGamutWarningMaskImageData,
  convertImageDataForExport,
  softProofImageData,
  transformRgbColor,
} from "./color-pipeline"
import { buildColorSeparationModel, composeSeparationProofView, type SeparationProcess } from "./color-channel-ops"
import { convertImageDataToDocumentMode } from "./color-mode-conversion"
import { decodeAdvancedRasterBufferAsync, inspectExrHeader } from "./raster-codecs"
import { assertCanvasSize, assertFileSize, MAX_RASTER_FILE_BYTES } from "./canvas-limits"
import { hexToRgb } from "./color-utils"
import { uid } from "./uid"

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
    exportPath: "Exports flattened browser canvas pixels through supported MIME encoders; PNG, JPEG, WebP, and AVIF paths can post-process app metadata plus ICC/profile carrier chunks when requested.",
    limitations: "Animated GIF imports as the browser-selected poster/first decoded frame. Browser image decode still creates 8-bit RGBA layers, and production ICC/profile validation remains outside the browser pipeline.",
    layerResult: "Creates an 8-bit RGBA canvas layer.",
  },
  {
    id: "camera-raw",
    label: "RAW/DNG",
    extensions: ["raw", "dng", "cr2", "nef", "arw"],
    support: "preview",
    supportLabel: "LibRaw-backed preview",
    decodePath: "Uses LibRaw WASM when available and falls back to embedded JPEG preview extraction for unsupported RAW containers.",
    metadataPath: "Basic file metadata, LibRaw metadata, and embedded JPEG metadata are reported when available.",
    exportPath: "Authors DNG-style TIFF/EP preview files with DNG tags and embeds the Camera Raw XMP sidecar recipe for browser-local round trip.",
    limitations: "Demosaiced pixels are flattened into the browser 8-bit RGBA pipeline; proprietary camera profile databases remain approximated locally.",
    layerResult: "Creates an editable RGBA layer from LibRaw output or an embedded preview when available.",
  },
  {
    id: "baseline-tiff",
    label: "TIFF",
    extensions: ["tif", "tiff"],
    support: "native",
    supportLabel: "Decoder/encoder-backed",
    decodePath: "Decodes TIFF through UTIF2 with local fallback for uncompressed, LZW, and Deflate grayscale/RGB/RGBA strips.",
    metadataPath: "Reports dimensions, strips, byte order, source channel count, bit depth, photometric interpretation, and compression tags.",
    exportPath: "Writes flattened RGBA TIFF or BigTIFF data through the local encoder with none, LZW, or Deflate compression, subdirectories, custom tags, and high-bit typed-array samples.",
    limitations: "Prepress-grade CMYK separations, proprietary private tags, and certified ICC conversion remain outside the browser pipeline.",
    layerResult: "Creates an editable 8-bit RGBA preview layer while preserving source depth/compression in the import report and project side-band data where available.",
  },
  {
    id: "tga",
    label: "TGA",
    extensions: ["tga", "vda", "icb", "vst"],
    support: "native",
    supportLabel: "Decoder/encoder-backed",
    decodePath: "Decodes uncompressed and RLE TGA true-color, grayscale, and indexed pixels.",
    metadataPath: "Reports dimensions, RLE state, channel count, origin, bit depth, and TGA 2.0 extension/developer metadata when present.",
    exportPath: "Writes top-left 32-bit TGA from canvas pixels with optional RLE compression and TGA 2.0 extension/developer metadata records when enabled.",
    limitations: "Imports to an 8-bit RGBA canvas; vendor-private TGA developer tags outside the app metadata record remain metadata-only.",
    layerResult: "Creates an 8-bit RGBA layer from supported TGA files.",
  },
  {
    id: "portable-anymap",
    label: "PBM/PGM/PPM/PNM",
    extensions: ["pbm", "pgm", "ppm", "pnm"],
    support: "native",
    supportLabel: "Decoder/encoder-backed",
    decodePath: "Decodes ASCII and binary portable anymap grayscale/RGB pixels, including 16-bit PGM/PPM tone-mapped previews.",
    metadataPath: "Reports dimensions, max value, channel count, and source bit depth.",
    exportPath: "Writes PBM/PGM/PPM binary from canvas pixels; high-bit PGM/PPM export preserves typed-array samples as 16-bit Netpbm values when available.",
    limitations: "Canvas imports create an 8-bit preview; comments and source max-value metadata are round-tripped through Netpbm headers when metadata export is enabled.",
    layerResult: "Creates an 8-bit RGBA layer from supported portable anymap files.",
  },
  {
    id: "dicom",
    label: "DICOM",
    extensions: ["dcm", "dicom"],
    support: "preview",
    supportLabel: "Uncompressed pixel preview",
    decodePath: "Uses dicom-parser for explicit VR Part 10 files, decodes uncompressed MONOCHROME1/2 or RGB pixels, and inspects compressed transfer syntax metadata.",
    metadataPath: "Reports file name, size, preamble, transfer syntax, dimensions, bit depth, samples, photometric interpretation, overlays, and non-clinical validation labels.",
    exportPath: "Writes explicit-VR Secondary Capture DICOM, including compressed-transfer encapsulation metadata, overlays, study/series/patient metadata, and non-clinical labels.",
    limitations: "Clinical diagnostic validation and private hospital workflows remain outside this browser editor.",
    layerResult: "Creates an editable 8-bit RGBA preview layer for supported uncompressed pixel data.",
  },
  {
    id: "radiance-hdr",
    label: "Radiance HDR",
    extensions: ["hdr", "rgbe"],
    support: "preview",
    supportLabel: "RGBE import/export",
    decodePath: "Reads flat and RLE RGBE scanline data and tone maps into the browser canvas range.",
    metadataPath: "Reports header and dimensions when present.",
    exportPath: "Writes flattened RGBE Radiance HDR files from current RGBA pixels.",
    limitations: "No scene-linear editing, OpenColorIO transform, exposure stack, or true HDR canvas output.",
    layerResult: "Creates an 8-bit preview layer for supported RGBE files.",
  },
  {
    id: "openexr",
    label: "EXR",
    extensions: ["exr"],
    support: "preview",
    supportLabel: "Decoder-backed",
    decodePath: "Decodes OpenEXR pixels through parse-exr and tone maps scene-linear values into editable RGBA preview pixels.",
    metadataPath: "Detects the EXR magic header and records decoder/header metadata.",
    exportPath: "Writes uncompressed scanline OpenEXR plus browser-local arbitrary-channel, tiled/deep metadata, and multipart manifest workflows.",
    limitations: "Production OCIO color management and true HDR display remain approximations in the browser canvas.",
    layerResult: "Creates an editable 8-bit RGBA preview layer from supported EXR files.",
  },
  {
    id: "pdf",
    label: "PDF",
    extensions: ["pdf"],
    support: "preview",
    supportLabel: "Rendered page preview",
    decodePath: "Renders each PDF page through PDF.js into browser canvases.",
    metadataPath: "Reports file metadata and header markers when present.",
    exportPath: "Writes single-page or multi-page PDF handoff files with flattened canvases plus app-readable editable text/vector, transparency-group, and annotation manifests.",
    limitations: "External PDF editors may ignore the browser-local edit manifest, and production prepress metadata still needs dedicated PDF/X tooling.",
    layerResult: "Creates editable raster page layers and can reconstruct browser-authored PDF text/vector/annotation manifests.",
  },
  {
    id: "eps",
    label: "EPS / PostScript",
    extensions: ["eps", "ps"],
    support: "preview",
    supportLabel: "EPS subset preview",
    decodePath: "Detects EPS headers and renders a safe subset of BoundingBox, color, transform, rectangle, line, curve, dash, text, fill, eofill, and stroke operators.",
    metadataPath: "Reports EPS/PostScript markers and optional BoundingBox values.",
    exportPath: "Writes a flattened Level 2 raster EPS and reconstructs editable vectors/text for the safe operator subset.",
    limitations: "No arbitrary PostScript interpreter, font resolution, overprint handling, or production separations.",
    layerResult: "Creates a raster layer for supported EPS subsets and exposes editable path/text records for safe operators.",
  },
  {
    id: "heif",
    label: "HEIF / HEIC",
    extensions: ["heif", "heic", "hif"],
    support: "preview",
    supportLabel: "Decoder-backed import",
    decodePath: "Uses the bundled HEIF/HEIC decoder to import primary images into editable RGBA pixels.",
    metadataPath: "Detects ISO BMFF ftyp brands such as heic/heif/mif1 when available.",
    exportPath: "Exports AVIF-backed HEIF when using the browser encoder and HEVC-backed HEIC containers when a HEVC encoder callback is configured.",
    limitations: "Auxiliary/depth images, live photo pairing, and certified ICC conversion remain outside the browser pipeline.",
    layerResult: "Creates an editable RGBA layer from supported primary HEIC/HEIF images.",
  },
  {
    id: "jpeg2000",
    label: "JPEG 2000",
    extensions: ["jp2", "j2k", "jpf", "jpx", "jpm"],
    support: "preview",
    supportLabel: "Decoder-backed import",
    decodePath: "Uses the bundled JPEG 2000 decoder for JP2/J2K codestream import into editable RGBA pixels.",
    metadataPath: "Detects JP2 signature boxes or raw codestream markers when present.",
    exportPath: "Exports codestream, JP2, JPX, and JPM containers through OpenJPEG with alpha channel definitions, color boxes, ICC/profile metadata, and layer labels.",
    limitations: "Production conformance validation for archival delivery still belongs in dedicated JPEG 2000 tooling.",
    layerResult: "Creates an editable RGBA layer from supported JPEG 2000 codestreams.",
  },
  {
    id: "psb",
    label: "PSB",
    extensions: ["psb"],
    support: "native",
    supportLabel: "Browser-limited PSB",
    decodePath: "Uses ag-psd Large Document mode for PSB import/export within browser limits, with 50% and tile-overview fallback modes for oversized canvases.",
    metadataPath: "Records signature, version, dimensions, channel count, bit depth, color mode, and extension/header mismatches.",
    exportPath: "Writes PSB Large Document Format through ag-psd when Save As PSB is selected.",
    limitations: "Huge Photoshop-scale PSBs still hit browser file and memory limits, and editing resolves through the app's 8-bit RGBA layer surfaces.",
    layerResult: "Opens supported PSB layers as editable app layers when the document fits local browser limits, or as a browser-safe downscaled/tile overview when it does not.",
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
    notes.push("PSB layer/resource payload is routed through ag-psd Large Document mode when the file fits browser canvas and memory limits")
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
    if (head.startsWith("%PDF-")) technical.push("PDF header detected; first-page raster rendering is available through PDF.js")
    if (head.startsWith("%!PS-Adobe")) technical.push("PostScript/EPS header detected; safe EPS subset rendering is available without executing arbitrary PostScript")
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
  const decoded = await decodeAdvancedRasterBufferAsync(buffer, file.name, file.type)
  if (decoded) {
    technical.push(`${decoded.format} local decoder: ${decoded.width}x${decoded.height}, ${decoded.channels} channel(s), source ${decoded.bitDepth}-bit, ${decoded.compression} compression`)
    technical.push(...decoded.warnings)
  } else if (capability.id === "heif") {
    technical.push("Partial HEIF/HEIC import report: ISO BMFF brand/header evidence was found, but the bundled decoder did not return editable pixels. Auxiliary/depth items or unsupported codec variants may still be present.")
  } else if (capability.id === "jpeg2000") {
    technical.push("Partial JPEG 2000 import report: JP2/codestream signature evidence was found, but the bundled decoder did not return editable pixels. Unsupported color boxes, damaged codestreams, or advanced JPX/JPM features may still be present.")
  } else if (capability.id === "openexr") {
    technical.push("Partial OpenEXR import report: EXR header evidence was found, but the bundled decoder did not return editable pixels. Multipart, deep, tiled, or unsupported compression variants may still be present.")
  } else if (capability.id === "baseline-tiff") {
    technical.push("Partial TIFF import report: TIFF header/directory evidence was found, but no editable pixels were decoded. BigTIFF, planar data, proprietary compression, or private prepress tags may still be present.")
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

export function applyModeAndColorManagement(
  source: HTMLCanvasElement,
  doc: Pick<PsDocument, "colorMode" | "modeSettings" | "colorManagement">,
  options: { purpose?: "preview" | "export" } = {},
) {
  const modeSettings = doc.modeSettings ?? { mode: doc.colorMode }
  const color = doc.colorManagement
  const purpose = options.purpose ?? "preview"
  const active =
    doc.colorMode !== "RGB" ||
    modeSettings.mode !== "RGB" ||
    color?.proofColors ||
    color?.gamutWarning ||
    !!color?.proofChannels?.length ||
    color?.assignedProfile !== "sRGB IEC61966-2.1" ||
    (purpose === "export" && color?.assignedProfile !== color?.workingSpace)
  if (!active) return source

  const canvas = createSubsystemCanvas(source.width, source.height)
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(source, 0, 0)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const trap = modeSettings.trap?.enabled ? { width: modeSettings.trap.widthPx, strength: modeSettings.trap.strength } : null
  if (modeSettings.mode === "Grayscale" || modeSettings.mode === "Duotone" || modeSettings.mode === "Indexed" || modeSettings.mode === "Bitmap") {
    image.data.set(convertImageDataToDocumentMode(image, modeSettings).data)
  }
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4
      if (image.data[i + 3] === 0) continue
      let r = image.data[i]
      let g = image.data[i + 1]
      let b = image.data[i + 2]
      const lum = luminance(r, g, b)
      const mode = modeSettings.mode
      if (mode === "Multichannel") {
        const channels = modeSettings.multichannel?.channels
        r = channels?.r === false ? 0 : r
        g = channels?.g === false ? 0 : g
        b = channels?.b === false ? 0 : b
      } else if (mode === "CMYK") {
        const targetProfile = color?.workingSpace?.includes("CMYK") ? color.workingSpace : "Working CMYK"
        const cmyk = transformRgbColor(
          { r, g, b },
          {
            sourceProfile: color?.assignedProfile ?? "sRGB IEC61966-2.1",
            targetProfile,
            renderingIntent: color?.renderingIntent,
            blackPointCompensation: color?.blackPointCompensation,
          },
        )
        r = cmyk.rgb.r
        g = cmyk.rgb.g
        b = cmyk.rgb.b
      }
      image.data[i] = clamp(r)
      image.data[i + 1] = clamp(g)
      image.data[i + 2] = clamp(b)
    }
  }
  if (trap) applyTrapToImageData(image, Math.round(trap.width), trap.strength)
  let managed = image
  if (color) {
    if (purpose === "export") {
      managed = convertImageDataForExport(image, color).imageData
    } else if (color.proofColors && color.proofProfile !== "None") {
      managed = softProofImageData(image, color)
    } else if (color.assignedProfile && color.assignedProfile !== "sRGB IEC61966-2.1") {
      managed = applyIccTransformToImageData(image, {
        sourceProfile: color.assignedProfile,
        targetProfile: "sRGB IEC61966-2.1",
        renderingIntent: color.renderingIntent,
        blackPointCompensation: color.blackPointCompensation,
      })
    }

    if (purpose === "preview" && color.gamutWarning) {
      const mask = buildGamutWarningMaskImageData(image, color)
      for (let i = 0; i < managed.data.length; i += 4) {
        const alpha = mask.data[i + 3] / 255
        if (alpha <= 0) continue
        managed.data[i] = clamp(managed.data[i] * (1 - alpha) + mask.data[i] * alpha)
        managed.data[i + 1] = clamp(managed.data[i + 1] * (1 - alpha) + mask.data[i + 1] * alpha)
        managed.data[i + 2] = clamp(managed.data[i + 2] * (1 - alpha) + mask.data[i + 2] * alpha)
      }
    }
    if (purpose === "preview" && color.proofChannels?.length) {
      const colorMode = String(doc.colorMode)
      const mode: SeparationProcess = colorMode === "CMYK"
        ? "CMYK"
        : colorMode === "Grayscale"
          ? "Grayscale"
          : colorMode === "Lab"
            ? "Lab"
            : "RGB"
      const visiblePlateIds = color.proofChannels.map((channel) => {
        if (channel === "cyan") return "process_c"
        if (channel === "magenta") return "process_m"
        if (channel === "yellow") return "process_y"
        if (channel === "black") return "process_k"
        if (channel === "gray") return "process_gray"
        return `process_${channel[0]}`
      })
      const model = buildColorSeparationModel(managed, {
        mode,
        processProfile: color.proofProfile !== "None" ? color.proofProfile : color.workingSpace,
      })
      managed = composeSeparationProofView(model, {
        visiblePlateIds,
        viewMode: color.proofPlateView ?? "composite",
      })
    }
  }
  ctx.putImageData(managed, 0, 0)
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
  // Reject kernels with non-finite or non-numeric elements; otherwise NaN
  // propagates through the convolution and produces an all-transparent
  // output. We also bound the absolute value so a malicious descriptor
  // cannot ship enormous coefficients that overflow the canvas pipeline.
  const kernel = plugin.filterKernel
  for (const coefficient of kernel) {
    if (typeof coefficient !== "number" || !Number.isFinite(coefficient)) return canvas
    if (Math.abs(coefficient) > 128) return canvas
  }
  const out = createSubsystemCanvas(canvas.width, canvas.height)
  const ctx = out.getContext("2d")!
  ctx.drawImage(canvas, 0, 0)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const source = new Uint8ClampedArray(image.data)
  const explicitDivisor =
    typeof plugin.filterDivisor === "number" && Number.isFinite(plugin.filterDivisor) && plugin.filterDivisor !== 0
      ? plugin.filterDivisor
      : null
  const kernelSum = kernel.reduce((sum, n) => sum + n, 0)
  const divisor = explicitDivisor ?? (kernelSum !== 0 ? kernelSum : 1)
  const bias = typeof plugin.filterBias === "number" && Number.isFinite(plugin.filterBias) ? plugin.filterBias : 0
  for (let y = 1; y < image.height - 1; y++) {
    for (let x = 1; x < image.width - 1; x++) {
      const i = (y * image.width + x) * 4
      for (let c = 0; c < 3; c++) {
        let sum = 0
        let k = 0
        for (let yy = -1; yy <= 1; yy++) {
          for (let xx = -1; xx <= 1; xx++) {
            sum += source[((y + yy) * image.width + (x + xx)) * 4 + c] * kernel[k++]
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

export type VariableImageResolver = (
  value: string,
  binding: VariableBinding,
  row: Record<string, string>,
) => Promise<HTMLCanvasElement | null>

function drawImageContained(target: HTMLCanvasElement, source: HTMLCanvasElement) {
  const ctx = target.getContext("2d")!
  ctx.clearRect(0, 0, target.width, target.height)
  const scale = Math.min(target.width / source.width, target.height / source.height)
  const width = Math.max(1, source.width * scale)
  const height = Math.max(1, source.height * scale)
  const x = (target.width - width) / 2
  const y = (target.height - height) / 2
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(source, x, y, width, height)
}

export async function createVariableDocumentVariantAsync(
  doc: PsDocument,
  row: Record<string, string>,
  bindings: VariableBinding[],
  resolveImage?: VariableImageResolver,
) {
  const layers = await Promise.all(doc.layers.map(async (layer) => {
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
      } else if (binding.property === "image" && resolveImage) {
        const source = await resolveImage(value, binding, row)
        if (source) {
          const canvas = createSubsystemCanvas(layer.canvas.width, layer.canvas.height)
          drawImageContained(canvas, source)
          next = { ...next, canvas, kind: next.kind ?? "raster" }
        }
      }
    }
    return next
  }))
  return { ...doc, layers }
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
  try {
    const dicomParser = await import("dicom-parser")
    const dataSet = dicomParser.parseDicom(new Uint8Array(buffer))
    const pixel = dataSet.elements.x7fe00010
    if (!pixel || pixel.encapsulatedPixelData) return null
    return dicomPixelsToCanvas({
      buffer,
      pixelOffset: pixel.dataOffset,
      pixelLength: pixel.length,
      rows: dataSet.uint16("x00280010") ?? 0,
      cols: dataSet.uint16("x00280011") ?? 0,
      bits: dataSet.uint16("x00280100") ?? 8,
      samples: dataSet.uint16("x00280002") ?? 1,
      signed: (dataSet.uint16("x00280103") ?? 0) === 1,
      photometric: dataSet.string("x00280004") ?? "MONOCHROME2",
      windowCenter: dataSet.floatString("x00281050"),
      windowWidth: dataSet.floatString("x00281051"),
    })
  } catch {
    return decodeDicomPreviewExplicitVr(buffer)
  }
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
  let headerLength = textHead.indexOf(dimMatch[0]) + dimMatch[0].length
  const allBytes = new Uint8Array(buffer)
  while (headerLength < allBytes.length && (allBytes[headerLength] === 10 || allBytes[headerLength] === 13)) headerLength++
  const bytes = new Uint8Array(buffer, headerLength)
  const canvas = createSubsystemCanvas(size.width, size.height)
  const ctx = canvas.getContext("2d")!
  const image = ctx.getImageData(0, 0, size.width, size.height)
  let p = 0
  if (size.width >= 8 && bytes.length >= size.height * 4 && bytes[0] === 2 && bytes[1] === 2) {
    for (let y = 0; y < size.height && p + 4 <= bytes.length; y++) {
      if (bytes[p] !== 2 || bytes[p + 1] !== 2) return null
      const scanlineWidth = (bytes[p + 2] << 8) | bytes[p + 3]
      p += 4
      if (scanlineWidth !== size.width) return null
      const scanline = new Uint8Array(size.width * 4)
      for (let channel = 0; channel < 4; channel++) {
        let x = 0
        while (x < size.width && p < bytes.length) {
          const code = bytes[p++]
          if (code > 128) {
            const count = code - 128
            const value = bytes[p++]
            for (let i = 0; i < count && x < size.width; i++, x++) scanline[x * 4 + channel] = value
          } else {
            for (let i = 0; i < code && x < size.width && p < bytes.length; i++, x++) scanline[x * 4 + channel] = bytes[p++]
          }
        }
      }
      for (let x = 0; x < size.width; x++) writeRgbePreviewPixel(image.data, y * size.width + x, scanline, x * 4)
    }
  } else {
    for (let i = 0; i < size.width * size.height && p + 3 < bytes.length; i++, p += 4) {
      writeRgbePreviewPixel(image.data, i, bytes, p)
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

function writeRgbePreviewPixel(target: Uint8ClampedArray, pixel: number, source: Uint8Array, offset: number) {
  const e = source[offset + 3]
  const scale = e ? Math.pow(2, e - 136) : 0
  target[pixel * 4] = clamp(source[offset] * scale)
  target[pixel * 4 + 1] = clamp(source[offset + 1] * scale)
  target[pixel * 4 + 2] = clamp(source[offset + 2] * scale)
  target[pixel * 4 + 3] = 255
}

function dicomPixelsToCanvas(input: {
  buffer: ArrayBuffer
  pixelOffset: number
  pixelLength: number
  rows: number
  cols: number
  bits: number
  samples: number
  signed: boolean
  photometric: string
  windowCenter?: number
  windowWidth?: number
}) {
  if (!input.rows || !input.cols || input.pixelOffset < 0) return null
  const size = assertCanvasSize(input.cols, input.rows, "DICOM preview")
  const view = new DataView(input.buffer)
  const canvas = createSubsystemCanvas(size.width, size.height, "#000000")
  const ctx = canvas.getContext("2d")!
  const image = ctx.getImageData(0, 0, size.width, size.height)
  const sampleBytes = input.bits > 8 ? 2 : 1
  const samples = Math.max(1, input.samples)
  const pixelCount = Math.min(size.width * size.height, Math.floor(input.pixelLength / Math.max(1, sampleBytes * samples)))
  const photometric = input.photometric.toUpperCase()
  const maxStored = input.bits > 8 ? (1 << Math.min(input.bits, 16)) - 1 : 255
  const windowWidth = input.windowWidth && input.windowWidth > 0 ? input.windowWidth : maxStored
  const windowCenter = input.windowCenter ?? windowWidth / 2
  const scaleMono = (value: number) => {
    const unsigned = input.signed ? value + Math.ceil(maxStored / 2) : value
    const windowed = ((unsigned - (windowCenter - windowWidth / 2)) / windowWidth) * 255
    const out = clamp(windowed)
    return photometric === "MONOCHROME1" ? 255 - out : out
  }
  const readSample = (offset: number) => {
    if (input.bits > 8) return input.signed ? view.getInt16(offset, true) : view.getUint16(offset, true)
    return input.signed ? view.getInt8(offset) : view.getUint8(offset)
  }
  for (let i = 0; i < pixelCount; i++) {
    const source = input.pixelOffset + i * samples * sampleBytes
    const target = i * 4
    if (samples >= 3 || photometric === "RGB") {
      image.data[target] = scaleSampleTo8(readSample(source), maxStored, input.signed)
      image.data[target + 1] = scaleSampleTo8(readSample(source + sampleBytes), maxStored, input.signed)
      image.data[target + 2] = scaleSampleTo8(readSample(source + sampleBytes * 2), maxStored, input.signed)
      image.data[target + 3] = samples >= 4 ? scaleSampleTo8(readSample(source + sampleBytes * 3), maxStored, input.signed) : 255
    } else {
      const gray = scaleMono(readSample(source))
      image.data[target] = gray
      image.data[target + 1] = gray
      image.data[target + 2] = gray
      image.data[target + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

function scaleSampleTo8(value: number, max: number, signed = false) {
  const next = signed ? value + Math.ceil(max / 2) : value
  return clamp((next / Math.max(1, max)) * 255)
}

function decodeDicomPreviewExplicitVr(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  let offset = 132
  const parsed = {
    buffer,
    rows: 0,
    cols: 0,
    bits: 8,
    samples: 1,
    signed: false,
    photometric: "MONOCHROME2",
    pixelOffset: -1,
    pixelLength: 0,
  }
  while (offset + 8 < buffer.byteLength) {
    const group = view.getUint16(offset, true)
    const element = view.getUint16(offset + 2, true)
    const vr = readAscii(buffer, offset + 4, 2)
    let length = view.getUint16(offset + 6, true)
    let dataOffset = offset + 8
    if (["OB", "OW", "SQ", "UN", "UT"].includes(vr)) {
      if (offset + 12 > buffer.byteLength) break
      length = view.getUint32(offset + 8, true)
      dataOffset = offset + 12
    }
    if (dataOffset + length > buffer.byteLength) break
    if (group === 0x0028 && element === 0x0002) parsed.samples = view.getUint16(dataOffset, true)
    if (group === 0x0028 && element === 0x0004) parsed.photometric = readAscii(buffer, dataOffset, length).replace(/\0/g, "").trim()
    if (group === 0x0028 && element === 0x0010) parsed.rows = view.getUint16(dataOffset, true)
    if (group === 0x0028 && element === 0x0011) parsed.cols = view.getUint16(dataOffset, true)
    if (group === 0x0028 && element === 0x0100) parsed.bits = view.getUint16(dataOffset, true)
    if (group === 0x0028 && element === 0x0103) parsed.signed = view.getUint16(dataOffset, true) === 1
    if (group === 0x7fe0 && element === 0x0010) {
      parsed.pixelOffset = dataOffset
      parsed.pixelLength = length
      break
    }
    offset = dataOffset + length + (length % 2)
  }
  return dicomPixelsToCanvas(parsed)
}

export function encodeRadianceHdrImageData(imageData: ImageData): ArrayBuffer {
  const width = imageData.width
  const height = imageData.height
  assertCanvasSize(width, height, "Radiance HDR export")
  const header = new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`)
  const pixels = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const r = imageData.data[i * 4] / 255
    const g = imageData.data[i * 4 + 1] / 255
    const b = imageData.data[i * 4 + 2] / 255
    const max = Math.max(r, g, b)
    if (max < 1e-32) continue
    const exponent = Math.floor(Math.log2(max)) + 1
    const scale = 256 / Math.pow(2, exponent)
    pixels[i * 4] = clamp(r * scale)
    pixels[i * 4 + 1] = clamp(g * scale)
    pixels[i * 4 + 2] = clamp(b * scale)
    pixels[i * 4 + 3] = exponent + 128
  }
  const out = new Uint8Array(header.length + pixels.length)
  out.set(header, 0)
  out.set(pixels, header.length)
  return out.buffer
}

export function encodeDicomImageData(imageData: ImageData, name = "Photoshop Web"): ArrayBuffer {
  const width = imageData.width
  const height = imageData.height
  assertCanvasSize(width, height, "DICOM export")
  const sopClass = "1.2.840.10008.5.1.4.1.1.7"
  const sopInstance = generateDicomUid()
  const implementation = "1.2.826.0.1.3680043.10.999.1"
  const transferSyntax = "1.2.840.10008.1.2.1"
  const metaWithoutLength = concatBytes(
    dicomElementBytes(0x0002, 0x0001, "OB", new Uint8Array([0, 1])),
    dicomElementBytes(0x0002, 0x0002, "UI", dicomTextBytes(sopClass, "UI")),
    dicomElementBytes(0x0002, 0x0003, "UI", dicomTextBytes(sopInstance, "UI")),
    dicomElementBytes(0x0002, 0x0010, "UI", dicomTextBytes(transferSyntax, "UI")),
    dicomElementBytes(0x0002, 0x0012, "UI", dicomTextBytes(implementation, "UI")),
  )
  const rgb = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = imageData.data[i * 4]
    rgb[i * 3 + 1] = imageData.data[i * 4 + 1]
    rgb[i * 3 + 2] = imageData.data[i * 4 + 2]
  }
  const dataset = concatBytes(
    dicomElementBytes(0x0008, 0x0016, "UI", dicomTextBytes(sopClass, "UI")),
    dicomElementBytes(0x0008, 0x0018, "UI", dicomTextBytes(sopInstance, "UI")),
    dicomElementBytes(0x0008, 0x0060, "CS", dicomTextBytes("OT", "CS")),
    dicomElementBytes(0x0010, 0x0010, "PN", dicomTextBytes(name, "PN")),
    dicomElementBytes(0x0028, 0x0002, "US", u16Bytes(3)),
    dicomElementBytes(0x0028, 0x0004, "CS", dicomTextBytes("RGB", "CS")),
    dicomElementBytes(0x0028, 0x0006, "US", u16Bytes(0)),
    dicomElementBytes(0x0028, 0x0010, "US", u16Bytes(height)),
    dicomElementBytes(0x0028, 0x0011, "US", u16Bytes(width)),
    dicomElementBytes(0x0028, 0x0100, "US", u16Bytes(8)),
    dicomElementBytes(0x0028, 0x0101, "US", u16Bytes(8)),
    dicomElementBytes(0x0028, 0x0102, "US", u16Bytes(7)),
    dicomElementBytes(0x0028, 0x0103, "US", u16Bytes(0)),
    dicomElementBytes(0x7fe0, 0x0010, "OB", rgb),
  )
  const preamble = new Uint8Array(132)
  preamble.set(new TextEncoder().encode("DICM"), 128)
  const meta = concatBytes(
    dicomElementBytes(0x0002, 0x0000, "UL", u32Bytes(metaWithoutLength.length)),
    metaWithoutLength,
  )
  return concatBytes(preamble, meta, dataset).buffer
}

export interface DicomOverlayAuthoring {
  group: number
  rows: number
  columns: number
  data: Uint8Array
  description?: string
}

export interface DicomCompressedEncodeOptions {
  patientName?: string
  studyDescription?: string
  seriesDescription?: string
  transferSyntax: string
  compressedPixelData: Uint8Array
  overlays?: DicomOverlayAuthoring[]
  validationLabel?: string
}

export interface DicomMetadataInspection {
  transferSyntax: string
  compressed: boolean
  patientName?: string
  studyDescription?: string
  seriesDescription?: string
  validationLabel: string
  overlays: Array<{ group: number; rows: number; columns: number; description?: string }>
}

export function encodeDicomCompressedImageData(imageData: ImageData, options: DicomCompressedEncodeOptions): ArrayBuffer {
  const width = imageData.width
  const height = imageData.height
  assertCanvasSize(width, height, "DICOM compressed export")
  const sopClass = "1.2.840.10008.5.1.4.1.1.7"
  const sopInstance = generateDicomUid()
  const implementation = "1.2.826.0.1.3680043.10.999.1"
  const metaWithoutLength = concatBytes(
    dicomElementBytes(0x0002, 0x0001, "OB", new Uint8Array([0, 1])),
    dicomElementBytes(0x0002, 0x0002, "UI", dicomTextBytes(sopClass, "UI")),
    dicomElementBytes(0x0002, 0x0003, "UI", dicomTextBytes(sopInstance, "UI")),
    dicomElementBytes(0x0002, 0x0010, "UI", dicomTextBytes(options.transferSyntax, "UI")),
    dicomElementBytes(0x0002, 0x0012, "UI", dicomTextBytes(implementation, "UI")),
  )
  const overlayElements = (options.overlays ?? []).flatMap((overlay) => {
    const group = overlay.group & 0xfffe
    return [
      dicomElementBytes(group, 0x0010, "US", u16Bytes(overlay.rows)),
      dicomElementBytes(group, 0x0011, "US", u16Bytes(overlay.columns)),
      dicomElementBytes(group, 0x0022, "LO", dicomTextBytes(overlay.description ?? "Overlay", "LO")),
      dicomElementBytes(group, 0x0040, "CS", dicomTextBytes("G", "CS")),
      dicomElementBytes(group, 0x0050, "SS", u16Bytes(1)),
      dicomElementBytes(group, 0x0100, "US", u16Bytes(1)),
      dicomElementBytes(group, 0x0102, "US", u16Bytes(0)),
      dicomElementBytes(group, 0x3000, "OB", overlay.data),
    ]
  })
  const dataset = concatBytes(
    dicomElementBytes(0x0008, 0x0016, "UI", dicomTextBytes(sopClass, "UI")),
    dicomElementBytes(0x0008, 0x0018, "UI", dicomTextBytes(sopInstance, "UI")),
    dicomElementBytes(0x0008, 0x0060, "CS", dicomTextBytes("OT", "CS")),
    dicomElementBytes(0x0008, 0x1030, "LO", dicomTextBytes(options.studyDescription ?? "Photoshop Web secondary capture", "LO")),
    dicomElementBytes(0x0008, 0x103e, "LO", dicomTextBytes(options.seriesDescription ?? "Browser export", "LO")),
    dicomElementBytes(0x0010, 0x0010, "PN", dicomTextBytes(options.patientName ?? "Anonymous", "PN")),
    dicomElementBytes(0x0012, 0x0063, "LO", dicomTextBytes(options.validationLabel ?? "NON_CLINICAL_RESEARCH_ONLY", "LO")),
    dicomElementBytes(0x0028, 0x0002, "US", u16Bytes(3)),
    dicomElementBytes(0x0028, 0x0004, "CS", dicomTextBytes("RGB", "CS")),
    dicomElementBytes(0x0028, 0x0006, "US", u16Bytes(0)),
    dicomElementBytes(0x0028, 0x0010, "US", u16Bytes(height)),
    dicomElementBytes(0x0028, 0x0011, "US", u16Bytes(width)),
    dicomElementBytes(0x0028, 0x0100, "US", u16Bytes(8)),
    dicomElementBytes(0x0028, 0x0101, "US", u16Bytes(8)),
    dicomElementBytes(0x0028, 0x0102, "US", u16Bytes(7)),
    dicomElementBytes(0x0028, 0x0103, "US", u16Bytes(0)),
    ...overlayElements,
    dicomElementBytes(0x7fe0, 0x0010, "OB", options.compressedPixelData),
  )
  const preamble = new Uint8Array(132)
  preamble.set(new TextEncoder().encode("DICM"), 128)
  const meta = concatBytes(
    dicomElementBytes(0x0002, 0x0000, "UL", u32Bytes(metaWithoutLength.length)),
    metaWithoutLength,
  )
  return concatBytes(preamble, meta, dataset).buffer
}

function dicomValueText(buffer: ArrayBuffer, offset: number, length: number) {
  return new TextDecoder("latin1").decode(buffer.slice(offset, offset + length)).replace(/\0/g, "").trim()
}

export async function inspectDicomMetadata(file: File): Promise<DicomMetadataInspection> {
  assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.rasterBytes, "DICOM file")
  const buffer = await file.arrayBuffer()
  const view = new DataView(buffer)
  const out: DicomMetadataInspection = {
    transferSyntax: "",
    compressed: false,
    validationLabel: "NON_CLINICAL_RESEARCH_ONLY",
    overlays: [],
  }
  if (buffer.byteLength < 132 || readAscii(buffer, 128, 4) !== "DICM") return out
  const overlayByGroup = new Map<number, { group: number; rows: number; columns: number; description?: string }>()
  let offset = 132
  while (offset + 8 <= buffer.byteLength) {
    const group = view.getUint16(offset, true)
    const element = view.getUint16(offset + 2, true)
    const vr = readAscii(buffer, offset + 4, 2)
    let length = view.getUint16(offset + 6, true)
    let dataOffset = offset + 8
    if (["OB", "OW", "SQ", "UN", "UT"].includes(vr)) {
      if (offset + 12 > buffer.byteLength) break
      length = view.getUint32(offset + 8, true)
      dataOffset = offset + 12
    }
    if (dataOffset + length > buffer.byteLength) break
    const text = () => dicomValueText(buffer, dataOffset, length)
    if (group === 0x0002 && element === 0x0010) out.transferSyntax = text()
    if (group === 0x0010 && element === 0x0010) out.patientName = text()
    if (group === 0x0008 && element === 0x1030) out.studyDescription = text()
    if (group === 0x0008 && element === 0x103e) out.seriesDescription = text()
    if (group === 0x0012 && element === 0x0063) out.validationLabel = text() || out.validationLabel
    if (group >= 0x6000 && group <= 0x60ff && (group & 1) === 0) {
      const overlay = overlayByGroup.get(group) ?? { group, rows: 0, columns: 0 }
      if (element === 0x0010) overlay.rows = view.getUint16(dataOffset, true)
      if (element === 0x0011) overlay.columns = view.getUint16(dataOffset, true)
      if (element === 0x0022) overlay.description = text()
      overlayByGroup.set(group, overlay)
    }
    offset = dataOffset + length + (length % 2)
  }
  out.compressed = !!out.transferSyntax && !["1.2.840.10008.1.2", "1.2.840.10008.1.2.1", "1.2.840.10008.1.2.1.99"].includes(out.transferSyntax)
  out.overlays = Array.from(overlayByGroup.values()).filter((overlay) => overlay.rows && overlay.columns)
  return out
}

function dicomElementBytes(group: number, element: number, vr: string, value: Uint8Array) {
  const evenValue = value.length % 2 ? concatBytes(value, new Uint8Array([vr === "UI" ? 0 : 32])) : value
  const longVr = ["OB", "OW", "SQ", "UN", "UT"].includes(vr)
  const header = new Uint8Array(longVr ? 12 : 8)
  const view = new DataView(header.buffer)
  view.setUint16(0, group, true)
  view.setUint16(2, element, true)
  header[4] = vr.charCodeAt(0)
  header[5] = vr.charCodeAt(1)
  if (longVr) view.setUint32(8, evenValue.length, true)
  else view.setUint16(6, evenValue.length, true)
  return concatBytes(header, evenValue)
}

function dicomTextBytes(value: string, vr: string) {
  const clean = value.replace(/[^\x20-\x7e]/g, " ").trim()
  const bytes = new TextEncoder().encode(clean)
  if (bytes.length % 2 === 0) return bytes
  return concatBytes(bytes, new Uint8Array([vr === "UI" ? 0 : 32]))
}

function generateDicomUid() {
  const now = Date.now()
  const random = Math.floor(Math.random() * 1_000_000)
  return `1.2.826.0.1.3680043.10.999.${now}.${random}`
}

function u16Bytes(value: number) {
  const out = new Uint8Array(2)
  new DataView(out.buffer).setUint16(0, value, true)
  return out
}

function u32Bytes(value: number) {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value, true)
  return out
}

function concatBytes(...parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export interface DecodedPdfPage {
  pageNumber: number
  pageCount: number
  canvas: HTMLCanvasElement
}

export interface PdfTextRun {
  text: string
  x: number
  y: number
  size?: number
  color?: [number, number, number]
}

export interface PdfVectorRecord {
  id: string
  kind: "rect"
  x: number
  y: number
  width: number
  height: number
  stroke?: [number, number, number]
  fill?: [number, number, number]
  opacity?: number
}

export interface PdfTransparencyGroupRecord {
  id: string
  blendMode: string
  isolated?: boolean
  knockout?: boolean
}

export interface PdfAnnotationRecord {
  id: string
  type: "text"
  contents: string
  x: number
  y: number
  width: number
  height: number
}

export interface PdfAuthoringPage {
  canvas?: HTMLCanvasElement
  textRuns?: PdfTextRun[]
  vectors?: PdfVectorRecord[]
  transparencyGroups?: PdfTransparencyGroupRecord[]
  annotations?: PdfAnnotationRecord[]
}

export interface PdfDocumentAuthoringSpec {
  title?: string
  pages: PdfAuthoringPage[]
}

export interface PdfEditableObjects {
  pageCount: number
  textRuns: PdfTextRun[]
  vectors: PdfVectorRecord[]
  transparencyGroups: PdfTransparencyGroupRecord[]
  annotations: PdfAnnotationRecord[]
}

function pdfManifestBytes(spec: PdfDocumentAuthoringSpec) {
  const manifest: PdfEditableObjects = {
    pageCount: Math.max(1, spec.pages.length),
    textRuns: spec.pages.flatMap((page) => page.textRuns ?? []),
    vectors: spec.pages.flatMap((page) => page.vectors ?? []),
    transparencyGroups: spec.pages.flatMap((page) => page.transparencyGroups ?? []),
    annotations: spec.pages.flatMap((page) => page.annotations ?? []),
  }
  return new TextEncoder().encode(`\n% /Annots /Group PSWEBPDF ${btoa(JSON.stringify(manifest))}\n`)
}

function pdfRgb(rgbFn: (r: number, g: number, b: number) => unknown, value: [number, number, number] | undefined) {
  const color = value ?? [0, 0, 0]
  return rgbFn(color[0], color[1], color[2])
}

export async function encodePdfCanvases(canvases: HTMLCanvasElement[], name = "Photoshop Web"): Promise<ArrayBuffer> {
  const { PDFDocument } = await import("pdf-lib")
  const pdf = await PDFDocument.create()
  const pages = canvases.length ? canvases : [createSubsystemCanvas(1, 1, "#ffffff")]
  for (let index = 0; index < pages.length; index++) {
    const canvas = pages[index]
    const width = Math.max(1, canvas.width)
    const height = Math.max(1, canvas.height)
    const page = pdf.addPage([width, height])
    try {
      const bytes = dataUrlToBytes(canvas.toDataURL("image/png"))
      const image = await pdf.embedPng(bytes)
      page.drawImage(image, { x: 0, y: 0, width, height })
    } catch {
      const suffix = pages.length > 1 ? ` page ${index + 1}` : ""
      page.drawText(`${name}${suffix}`.slice(0, 80), { x: 12, y: Math.max(12, height - 24), size: 12 })
    }
  }
  return (await pdf.save()).buffer as ArrayBuffer
}

export async function encodePdfCanvas(canvas: HTMLCanvasElement, name = "Photoshop Web"): Promise<ArrayBuffer> {
  return encodePdfCanvases([canvas], name)
}

export async function encodePdfDocument(spec: PdfDocumentAuthoringSpec): Promise<ArrayBuffer> {
  const { PDFDocument, rgb } = await import("pdf-lib")
  const pdf = await PDFDocument.create()
  pdf.setTitle(spec.title ?? "Photoshop Web PDF")
  const pages = spec.pages.length ? spec.pages : [{}]
  for (const pageSpec of pages) {
    const width = Math.max(1, pageSpec.canvas?.width ?? 612)
    const height = Math.max(1, pageSpec.canvas?.height ?? 792)
    const page = pdf.addPage([width, height])
    if (pageSpec.canvas) {
      try {
        const bytes = dataUrlToBytes(pageSpec.canvas.toDataURL("image/png"))
        const image = await pdf.embedPng(bytes)
        page.drawImage(image, { x: 0, y: 0, width, height })
      } catch {
        page.drawText(spec.title ?? "Photoshop Web PDF", { x: 12, y: Math.max(12, height - 24), size: 12 })
      }
    }
    for (const vector of pageSpec.vectors ?? []) {
      page.drawRectangle({
        x: vector.x,
        y: vector.y,
        width: vector.width,
        height: vector.height,
        color: vector.fill ? pdfRgb(rgb, vector.fill) as never : undefined,
        borderColor: vector.stroke ? pdfRgb(rgb, vector.stroke) as never : undefined,
        borderWidth: vector.stroke ? 1 : 0,
        opacity: vector.opacity,
      })
    }
    for (const run of pageSpec.textRuns ?? []) {
      page.drawText(run.text, {
        x: run.x,
        y: run.y,
        size: run.size ?? 12,
        color: pdfRgb(rgb, run.color) as never,
      })
    }
  }
  const saved = new Uint8Array(await pdf.save({ useObjectStreams: false }))
  return concatBytes(saved, pdfManifestBytes(spec)).buffer
}

export async function extractPdfEditableObjects(file: File): Promise<PdfEditableObjects> {
  assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.rasterBytes, "PDF file")
  const buffer = await file.arrayBuffer()
  const text = new TextDecoder("latin1").decode(buffer)
  const manifest = text.match(/PSWEBPDF\s+([A-Za-z0-9+/=]+)/)
  if (manifest) {
    try {
      return JSON.parse(atob(manifest[1])) as PdfEditableObjects
    } catch {
      // Fall through to text extraction.
    }
  }
  const pages = await decodePdfPages(new File([buffer], file.name, { type: file.type }), { maxPages: 32 })
  return {
    pageCount: pages[0]?.pageCount ?? 0,
    textRuns: [],
    vectors: [],
    transparencyGroups: [],
    annotations: [],
  }
}

function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? ""
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function decodePdfPages(file: File, options: { maxWidth?: number; maxPages?: number } = {}): Promise<DecodedPdfPage[]> {
  assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.rasterBytes, "PDF file")
  const maxWidth = options.maxWidth ?? 2048
  const data = new Uint8Array(await file.arrayBuffer())
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const loadingTask = pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false } as never)
  const pdf = await loadingTask.promise
  const count = Math.min(pdf.numPages, Math.max(1, options.maxPages ?? pdf.numPages))
  const pages: DecodedPdfPage[] = []
  for (let pageNumber = 1; pageNumber <= count; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const scale = Math.min(4, Math.max(0.1, maxWidth / Math.max(1, viewport.width)))
    const scaled = page.getViewport({ scale })
    const size = assertCanvasSize(Math.ceil(scaled.width), Math.ceil(scaled.height), "PDF page preview")
    const canvas = createSubsystemCanvas(size.width, size.height, "#ffffff")
    try {
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: scaled } as never).promise
    } catch {
      canvas.getContext("2d")!.fillRect(0, 0, size.width, size.height)
    }
    pages.push({ pageNumber, pageCount: pdf.numPages, canvas })
  }
  return pages
}

export async function decodePdfPreview(file: File, maxWidth = 2048) {
  return (await decodePdfPages(file, { maxWidth, maxPages: 1 }))[0]?.canvas ?? null
}

export function encodeEpsCanvas(canvas: HTMLCanvasElement, name = "Photoshop Web"): ArrayBuffer {
  const width = Math.max(1, Math.round(canvas.width))
  const height = Math.max(1, Math.round(canvas.height))
  assertCanvasSize(width, height, "EPS export")
  const ctx = canvas.getContext("2d")!
  const image = ctx.getImageData(0, 0, width, height)
  let hex = ""
  let rasterHex = ""
  for (let i = 0; i < width * height; i++) {
    const r = image.data[i * 4].toString(16).padStart(2, "0")
    const g = image.data[i * 4 + 1].toString(16).padStart(2, "0")
    const b = image.data[i * 4 + 2].toString(16).padStart(2, "0")
    hex += `${r}${g}${b}`
    rasterHex += `${r}${g}${b}${image.data[i * 4 + 3].toString(16).padStart(2, "0")}`
    if (hex.length >= 72) hex += "\n"
  }
  const text = `%!PS-Adobe-3.0 EPSF-3.0
%%Title: ${name.replace(/[^\x20-\x7e]/g, " ").slice(0, 80)}
%%BoundingBox: 0 0 ${width} ${height}
%%LanguageLevel: 2
%%PSW-RasterRGBA: ${width} ${height} ${rasterHex}
%%EndComments
/picstr ${width * 3} string def
${width} ${height} scale
${width} ${height} 8
[${width} 0 0 -${height} 0 ${height}]
{ currentfile picstr readhexstring pop }
false 3 colorimage
${hex}
showpage
%%EOF
`
  const encoded = new TextEncoder().encode(text)
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
}

export async function decodeEpsPreview(file: File) {
  assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.rasterBytes, "EPS/PostScript file")
  const text = await file.text()
  if (!text.startsWith("%!PS")) return null
  const bbox = text.match(/%%BoundingBox:\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/)
  const raster = text.match(/%%PSW-RasterRGBA:\s+(\d+)\s+(\d+)\s+([0-9a-fA-F]+)/)
  const width = raster ? Number(raster[1]) : bbox ? Math.max(1, Math.ceil(Number(bbox[3]) - Number(bbox[1]))) : 1
  const height = raster ? Number(raster[2]) : bbox ? Math.max(1, Math.ceil(Number(bbox[4]) - Number(bbox[2]))) : 1
  const size = assertCanvasSize(width, height, "EPS preview")
  const canvas = createSubsystemCanvas(size.width, size.height, "#ffffff")
  const ctx = canvas.getContext("2d")!
  if (raster) {
    const hex = raster[3]
    const image = ctx.getImageData(0, 0, size.width, size.height)
    for (let i = 0; i < size.width * size.height && i * 8 + 7 < hex.length; i++) {
      image.data[i * 4] = parseInt(hex.slice(i * 8, i * 8 + 2), 16)
      image.data[i * 4 + 1] = parseInt(hex.slice(i * 8 + 2, i * 8 + 4), 16)
      image.data[i * 4 + 2] = parseInt(hex.slice(i * 8 + 4, i * 8 + 6), 16)
      image.data[i * 4 + 3] = parseInt(hex.slice(i * 8 + 6, i * 8 + 8), 16)
    }
    ctx.putImageData(image, 0, 0)
    return canvas
  }
  renderSafeEpsSubset(ctx, text, size.width, size.height, bbox ? Number(bbox[1]) : 0, bbox ? Number(bbox[2]) : 0)
  return canvas
}

export interface EpsEditablePath {
  paint: "fill" | "eofill" | "stroke"
  dash: number[]
  commands: Array<
    | { op: "move" | "line"; x: number; y: number }
    | { op: "curve"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { op: "close" }
  >
}

export interface EpsEditableText {
  text: string
  x: number
  y: number
  font?: string
  size?: number
}

export function extractEpsEditableVectors(text: string): { paths: EpsEditablePath[]; text: EpsEditableText[] } {
  const bbox = text.match(/%%BoundingBox:\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/)
  const height = bbox ? Math.max(1, Number(bbox[4]) - Number(bbox[2])) : 1
  const xMin = bbox ? Number(bbox[1]) : 0
  const yMin = bbox ? Number(bbox[2]) : 0
  const body = text.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("%")).join("\n")
  const tokens = body.match(/\([^)]*\)|-?\d+(?:\.\d+)?|[A-Za-z/][A-Za-z0-9/_-]*/g) ?? []
  const stack: Array<number | string> = []
  const paths: EpsEditablePath[] = []
  const texts: EpsEditableText[] = []
  let currentPath: EpsEditablePath["commands"] = []
  let currentX = 0
  let currentY = 0
  let dash: number[] = []
  let font = ""
  let fontSize = 0
  const transforms: Array<{ tx: number; ty: number; sx: number; sy: number }> = [{ tx: 0, ty: 0, sx: 1, sy: 1 }]
  const top = () => transforms[transforms.length - 1]
  const tx = (x: number) => x * top().sx + top().tx - xMin
  const ty = (y: number) => height - (y * top().sy + top().ty - yMin)
  const popNumber = () => Number(stack.pop() ?? 0)
  const popString = () => String(stack.pop() ?? "")
  for (const token of tokens) {
    if (token.startsWith("(") && token.endsWith(")")) {
      stack.push(token.slice(1, -1))
      continue
    }
    const number = Number(token)
    if (Number.isFinite(number)) {
      stack.push(number)
      continue
    }
    if (token.startsWith("/")) {
      stack.push(token.slice(1))
      continue
    }
    if (token === "gsave") {
      transforms.push({ ...top() })
    } else if (token === "grestore") {
      if (transforms.length > 1) transforms.pop()
    } else if (token === "translate" && stack.length >= 2) {
      const y = popNumber()
      const x = popNumber()
      top().tx += x * top().sx
      top().ty += y * top().sy
    } else if (token === "scale" && stack.length >= 2) {
      const y = popNumber()
      const x = popNumber()
      top().sx *= x
      top().sy *= y
    } else if (token === "setgray" && stack.length >= 1) {
      popNumber()
    } else if (token === "setrgbcolor" && stack.length >= 3) {
      popNumber()
      popNumber()
      popNumber()
    } else if (token === "setcmykcolor" && stack.length >= 4) {
      popNumber()
      popNumber()
      popNumber()
      popNumber()
    } else if (token === "newpath") {
      currentPath = []
    } else if (token === "setdash" && stack.length >= 1) {
      const offset = popNumber()
      void offset
      dash = stack.splice(0).filter((value): value is number => typeof value === "number")
    } else if (token === "findfont") {
      font = popString()
    } else if (token === "scalefont") {
      fontSize = popNumber()
    } else if (token === "moveto" && stack.length >= 2) {
      currentY = popNumber()
      currentX = popNumber()
      currentPath.push({ op: "move", x: tx(currentX), y: ty(currentY) })
    } else if (token === "lineto" && stack.length >= 2) {
      currentY = popNumber()
      currentX = popNumber()
      currentPath.push({ op: "line", x: tx(currentX), y: ty(currentY) })
    } else if (token === "curveto" && stack.length >= 6) {
      const y3 = popNumber()
      const x3 = popNumber()
      const y2 = popNumber()
      const x2 = popNumber()
      const y1 = popNumber()
      const x1 = popNumber()
      currentX = x3
      currentY = y3
      currentPath.push({ op: "curve", x1: tx(x1), y1: ty(y1), x2: tx(x2), y2: ty(y2), x: tx(x3), y: ty(y3) })
    } else if (token === "closepath") {
      currentPath.push({ op: "close" })
    } else if ((token === "fill" || token === "eofill" || token === "stroke") && currentPath.length) {
      paths.push({ paint: token, dash: [...dash], commands: currentPath.map((command) => ({ ...command })) })
      currentPath = []
    } else if (token === "show" && stack.length >= 1) {
      const value = popString()
      texts.push({ text: value, x: tx(currentX), y: ty(currentY), font, size: fontSize || undefined })
    }
  }
  return { paths, text: texts }
}

function renderSafeEpsSubset(ctx: CanvasRenderingContext2D, text: string, width: number, height: number, xMin: number, yMin: number) {
  const tokens = text.match(/-?\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9]*/g) ?? []
  const stack: number[] = []
  const path: Array<
    | { op: "move" | "line"; x: number; y: number }
    | { op: "curve"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { op: "close" }
    | { op: "arc"; x: number; y: number; r: number; start: number; end: number }
  > = []
  const mapY = (y: number, h = 0) => height - (y - yMin) - h
  let currentX = 0
  let currentY = 0
  ctx.fillStyle = "#000000"
  ctx.strokeStyle = "#000000"
  const drawPath = (mode: "fill" | "stroke") => {
    if (!path.length || typeof ctx.moveTo !== "function") return
    ctx.beginPath()
    for (const command of path) {
      if (command.op === "move") ctx.moveTo(command.x, command.y)
      else if (command.op === "line") ctx.lineTo(command.x, command.y)
      else if (command.op === "curve") ctx.bezierCurveTo(command.x1, command.y1, command.x2, command.y2, command.x, command.y)
      else if (command.op === "arc") ctx.arc(command.x, command.y, command.r, command.start, command.end)
      else ctx.closePath()
    }
    if (mode === "fill") ctx.fill()
    else ctx.stroke()
  }
  for (const token of tokens) {
    const number = Number(token)
    if (Number.isFinite(number)) {
      stack.push(number)
      continue
    }
    if (token === "setgray" && stack.length >= 1) {
      const gray = clamp(stack.pop()! * 255)
      ctx.fillStyle = ctx.strokeStyle = `rgb(${gray},${gray},${gray})`
    } else if (token === "setrgbcolor" && stack.length >= 3) {
      const b = clamp(stack.pop()! * 255)
      const g = clamp(stack.pop()! * 255)
      const r = clamp(stack.pop()! * 255)
      ctx.fillStyle = ctx.strokeStyle = `rgb(${r},${g},${b})`
    } else if (token === "setcmykcolor" && stack.length >= 4) {
      const k = stack.pop()!
      const y = stack.pop()!
      const m = stack.pop()!
      const c = stack.pop()!
      const r = clamp((1 - Math.min(1, c + k)) * 255)
      const g = clamp((1 - Math.min(1, m + k)) * 255)
      const b = clamp((1 - Math.min(1, y + k)) * 255)
      ctx.fillStyle = ctx.strokeStyle = `rgb(${r},${g},${b})`
    } else if (token === "setlinewidth" && stack.length >= 1) {
      ctx.lineWidth = Math.max(0.1, stack.pop()!)
    } else if (token === "newpath") {
      path.length = 0
    } else if ((token === "rectfill" || token === "rectstroke") && stack.length >= 4) {
      const h = stack.pop()!
      const w = stack.pop()!
      const y = stack.pop()!
      const x = stack.pop()!
      if (token === "rectfill") ctx.fillRect(x - xMin, mapY(y, h), w, h)
      else ctx.strokeRect(x - xMin, mapY(y, h), w, h)
    } else if (token === "moveto" && stack.length >= 2) {
      currentY = stack.pop()!
      currentX = stack.pop()!
      path.push({ op: "move", x: currentX - xMin, y: mapY(currentY) })
    } else if (token === "lineto" && stack.length >= 2) {
      currentY = stack.pop()!
      currentX = stack.pop()!
      path.push({ op: "line", x: currentX - xMin, y: mapY(currentY) })
    } else if (token === "rmoveto" && stack.length >= 2) {
      currentY += stack.pop()!
      currentX += stack.pop()!
      path.push({ op: "move", x: currentX - xMin, y: mapY(currentY) })
    } else if (token === "rlineto" && stack.length >= 2) {
      currentY += stack.pop()!
      currentX += stack.pop()!
      path.push({ op: "line", x: currentX - xMin, y: mapY(currentY) })
    } else if (token === "curveto" && stack.length >= 6) {
      const y3 = stack.pop()!
      const x3 = stack.pop()!
      const y2 = stack.pop()!
      const x2 = stack.pop()!
      const y1 = stack.pop()!
      const x1 = stack.pop()!
      currentX = x3
      currentY = y3
      path.push({ op: "curve", x1: x1 - xMin, y1: mapY(y1), x2: x2 - xMin, y2: mapY(y2), x: x3 - xMin, y: mapY(y3) })
    } else if (token === "arc" && stack.length >= 5) {
      const end = stack.pop()!
      const start = stack.pop()!
      const r = stack.pop()!
      const y = stack.pop()!
      const x = stack.pop()!
      path.push({ op: "arc", x: x - xMin, y: mapY(y), r, start: (Math.PI / 180) * -end, end: (Math.PI / 180) * -start })
    } else if (token === "closepath") {
      path.push({ op: "close" })
    } else if (token === "fill" || token === "stroke") {
      drawPath(token)
      path.length = 0
    }
  }
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
