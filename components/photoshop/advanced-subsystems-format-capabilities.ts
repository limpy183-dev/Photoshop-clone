import { decodeAdvancedRasterBufferAsync, inspectExrHeader } from "./raster-codecs"
import {
  ADVANCED_FILE_LIMITS,
  assertAdvancedFileSize,
  readAscii,
} from "./advanced-subsystems-shared"

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
