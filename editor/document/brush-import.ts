/**
 * Brush preset import: validation of .json bundles and best-effort name
 * extraction from Photoshop .abr files, plus the thumbnail renderer.
 *
 * An imported bundle is untrusted input that becomes brush settings and data
 * URLs, so everything here is bounded — size caps, allow-listed enum values,
 * reserved-key rejection, and a scan limit on the binary .abr walk. No React:
 * the panel that calls it is `components/photoshop/panels/brush-panel.tsx`.
 */


import type { BrushPreset, BrushSettings } from "@/editor/types"
export const MAX_BRUSH_IMPORT_BYTES = 8 * 1024 * 1024
export const MAX_BRUSH_PRESET_IMPORT_COUNT = 64
export const ABR_SCAN_LIMIT_BYTES = 1 * 1024 * 1024
const MAX_BRUSH_THUMBNAIL_LENGTH = 160_000
const BRUSH_THUMBNAIL_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i
const BRUSH_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/
const RESERVED_IMPORT_KEYS = new Set(["__proto__", "constructor", "prototype"])
const TIP_SHAPES = new Set(["round", "square", "bristle", "erodible"])
const CONTROL_VALUES = new Set(["off", "pressure", "tilt", "velocity", "fade", "random"])
const TEXTURE_PATTERNS = new Set(["noise", "canvas", "paper", "linen"])
const TEXTURE_MODES = new Set(["multiply", "subtract", "burn"])
const DUAL_BRUSH_MODES = new Set(["multiply", "screen", "subtract"])
const COLOR_REPLACEMENT_SAMPLING = new Set(["continuous", "once", "background-swatch"])
const COLOR_REPLACEMENT_LIMITS = new Set(["contiguous", "discontiguous", "find-edges"])
const COLOR_REPLACEMENT_MODES = new Set(["color", "hue", "saturation", "luminosity"])
const ART_HISTORY_STYLES = new Set(["tight-short", "tight-medium", "loose-long", "dab", "curl"])

type BrushImportOptions = {
  fileSizeBytes?: number
  now?: number
  makeId?: (prefix: string, index: number) => string
  makeThumbnail?: (settings: Partial<BrushSettings>) => string | undefined
}

type AbrParseOptions = BrushImportOptions & {
  maxScanBytes?: number
}

export type NormalizedBrushImport =
  | { kind: "library"; presets: BrushPreset[] }
  | { kind: "single"; brush: Partial<BrushSettings>; preset: BrushPreset }

export function normalizeImportedBrushPayload(parsed: unknown, options: BrushImportOptions = {}): NormalizedBrushImport {
  if (typeof options.fileSizeBytes === "number" && options.fileSizeBytes > MAX_BRUSH_IMPORT_BYTES) {
    throw new Error(`Brush imports are limited to ${formatImportBytes(MAX_BRUSH_IMPORT_BYTES)}.`)
  }

  if (Array.isArray(parsed)) {
    if (parsed.length > MAX_BRUSH_PRESET_IMPORT_COUNT) {
      throw new Error(`Brush preset imports are limited to ${MAX_BRUSH_PRESET_IMPORT_COUNT} items.`)
    }
    return {
      kind: "library",
      presets: parsed.map((raw, index) => normalizeBrushPreset(raw, index, options)),
    }
  }

  const record = requireImportRecord(parsed, "Brush file")
  const rawSettings = isImportRecord(record.settings) ? record.settings : record
  const settings = normalizeImportedBrushSettings(rawSettings, true)
  const thumbnail = normalizeImportedThumbnail(record.thumbnail, settings, options)
  const preset: BrushPreset = {
    id: cleanBrushImportId(record.id, "brush", 0, options.makeId),
    name: cleanImportText(record.name, "Imported Brush", 80),
    size: settings.size ?? 30,
    hardness: settings.hardness ?? 80,
    spacing: settings.spacing ?? 25,
    settings,
    ...(thumbnail ? { thumbnail } : {}),
  }
  return { kind: "single", brush: settings, preset }
}

export function normalizeBrushPreset(raw: unknown, index: number, options: BrushImportOptions): BrushPreset {
  const record = requireImportRecord(raw, `Brush preset ${index + 1}`)
  const rawSettings = isImportRecord(record.settings) ? record.settings : record
  const settings = normalizeImportedBrushSettings(rawSettings, true)
  const thumbnail = normalizeImportedThumbnail(record.thumbnail, settings, options)
  return {
    id: cleanBrushImportId(record.id, "brush", index, options.makeId),
    name: cleanImportText(record.name, `Imported Brush ${index + 1}`, 80),
    ...(cleanOptionalImportText(record.folder, 80) ? { folder: cleanOptionalImportText(record.folder, 80) } : {}),
    size: settings.size ?? 30,
    hardness: settings.hardness ?? 80,
    spacing: settings.spacing ?? 25,
    settings,
    ...(thumbnail ? { thumbnail } : {}),
  }
}

export function normalizeImportedBrushSettings(raw: Record<string, unknown>, requireCore: boolean): Partial<BrushSettings> {
  if (requireCore && (!isFiniteImportNumber(raw.size) || !isFiniteImportNumber(raw.hardness))) {
    throw new Error("Brush settings must include numeric size and hardness.")
  }

  const out: Record<string, unknown> = {
    size: cleanImportNumber(raw.size, 1, 500, 30, true),
    hardness: cleanImportNumber(raw.hardness, 0, 100, 80, true),
    opacity: cleanImportNumber(raw.opacity, 0, 100, 100, true),
    flow: cleanImportNumber(raw.flow, 0, 100, 100, true),
    smoothing: cleanImportNumber(raw.smoothing, 0, 100, 10, true),
  }

  copyImportNumber(raw, out, "spacing", 1, 200, 25)
  copyImportNumber(raw, out, "sizeJitter", 0, 100, 0)
  copyImportNumber(raw, out, "angleJitter", 0, 360, 0)
  copyImportNumber(raw, out, "roundnessJitter", 0, 100, 0)
  copyImportNumber(raw, out, "minDiameter", 0, 100, 0)
  copyImportNumber(raw, out, "scatter", 0, 1000, 0)
  copyImportNumber(raw, out, "scatterCount", 1, 16, 1)
  copyImportNumber(raw, out, "scatterCountJitter", 0, 100, 0)
  copyImportNumber(raw, out, "fgBgJitter", 0, 100, 0)
  copyImportNumber(raw, out, "hueJitter", 0, 100, 0)
  copyImportNumber(raw, out, "satJitter", 0, 100, 0)
  copyImportNumber(raw, out, "brightJitter", 0, 100, 0)
  copyImportNumber(raw, out, "purity", -100, 100, 0)
  copyImportNumber(raw, out, "opacityJitter", 0, 100, 0)
  copyImportNumber(raw, out, "flowJitter", 0, 100, 0)
  copyImportEnum(raw, out, "tipShape", TIP_SHAPES)
  copyImportEnum(raw, out, "sizeControl", CONTROL_VALUES)
  copyImportEnum(raw, out, "angleControl", CONTROL_VALUES)
  copyImportEnum(raw, out, "roundnessControl", CONTROL_VALUES)
  copyImportEnum(raw, out, "opacityControl", CONTROL_VALUES)
  copyImportEnum(raw, out, "flowControl", CONTROL_VALUES)
  copyImportBoolean(raw, out, "flipX")
  copyImportBoolean(raw, out, "flipY")
  copyImportBoolean(raw, out, "wetEdges")
  copyImportBoolean(raw, out, "buildUp")
  copyImportBoolean(raw, out, "noise")
  copyImportBoolean(raw, out, "protectTexture")

  if ("texture" in raw) {
    if (!isImportRecord(raw.texture)) throw new Error("Brush texture settings must be an object.")
    out.texture = {
      enabled: raw.texture.enabled === true,
      pattern: cleanImportEnum(raw.texture.pattern, TEXTURE_PATTERNS, "canvas"),
      mode: cleanImportEnum(raw.texture.mode, TEXTURE_MODES, "multiply"),
      depth: cleanImportNumber(raw.texture.depth, 0, 100, 45, true),
      depthJitter: cleanImportNumber(raw.texture.depthJitter, 0, 100, 0, true),
      minDepth: cleanImportNumber(raw.texture.minDepth, 0, 100, 0, true),
      scale: cleanImportNumber(raw.texture.scale, 20, 400, 100, true),
    } satisfies NonNullable<BrushSettings["texture"]>
  }
  if ("dualBrush" in raw) {
    if (!isImportRecord(raw.dualBrush)) throw new Error("Dual brush settings must be an object.")
    out.dualBrush = {
      enabled: raw.dualBrush.enabled === true,
      size: cleanImportNumber(raw.dualBrush.size, 1, 300, 18, true),
      spacing: cleanImportNumber(raw.dualBrush.spacing, 1, 200, 25, true),
      scatter: cleanImportNumber(raw.dualBrush.scatter, 0, 500, 0, true),
      count: cleanImportNumber(raw.dualBrush.count, 1, 8, 1, true),
      mode: cleanImportEnum(raw.dualBrush.mode, DUAL_BRUSH_MODES, "multiply"),
    } satisfies NonNullable<BrushSettings["dualBrush"]>
  }
  if ("erodibleTip" in raw) {
    if (!isImportRecord(raw.erodibleTip)) throw new Error("Erodible tip settings must be an object.")
    out.erodibleTip = {
      sharpness: cleanImportNumber(raw.erodibleTip.sharpness, 0, 100, 70, true),
      flatness: cleanImportNumber(raw.erodibleTip.flatness, 0, 100, 35, true),
      erosionRate: cleanImportNumber(raw.erodibleTip.erosionRate, 0, 100, 50, true),
      softness: cleanImportNumber(raw.erodibleTip.softness, 0, 100, 20, true),
      aspectRatio: cleanImportNumber(raw.erodibleTip.aspectRatio, 15, 100, 80, true),
      rotation: cleanImportNumber(raw.erodibleTip.rotation, -180, 180, 0, true),
    } satisfies NonNullable<BrushSettings["erodibleTip"]>
  }
  if ("bristleTip" in raw) {
    if (!isImportRecord(raw.bristleTip)) throw new Error("Bristle tip settings must be an object.")
    out.bristleTip = {
      length: cleanImportNumber(raw.bristleTip.length, 0, 100, 65, true),
      density: cleanImportNumber(raw.bristleTip.density, 0, 100, 55, true),
      thickness: cleanImportNumber(raw.bristleTip.thickness, 0, 100, 35, true),
      stiffness: cleanImportNumber(raw.bristleTip.stiffness, 0, 100, 55, true),
      splay: cleanImportNumber(raw.bristleTip.splay, 0, 100, 35, true),
      wetness: cleanImportNumber(raw.bristleTip.wetness, 0, 100, 25, true),
    } satisfies NonNullable<BrushSettings["bristleTip"]>
  }
  if ("pose" in raw) {
    if (!isImportRecord(raw.pose)) throw new Error("Brush pose settings must be an object.")
    out.pose = {
      tiltX: cleanImportNumber(raw.pose.tiltX, -90, 90, 0, true),
      tiltY: cleanImportNumber(raw.pose.tiltY, -90, 90, 0, true),
      rotation: cleanImportNumber(raw.pose.rotation, -180, 180, 0, true),
      pressure: cleanImportNumber(raw.pose.pressure, 0, 100, 50, true),
      stylusAngle: cleanImportNumber(raw.pose.stylusAngle, -180, 180, 0, true),
    } satisfies NonNullable<BrushSettings["pose"]>
  }
  if ("mixer" in raw) {
    if (!isImportRecord(raw.mixer)) throw new Error("Mixer brush settings must be an object.")
    out.mixer = {
      wet: cleanImportNumber(raw.mixer.wet, 0, 100, 55, true),
      load: cleanImportNumber(raw.mixer.load, 0, 100, 60, true),
      mix: cleanImportNumber(raw.mixer.mix, 0, 100, 50, true),
      flow: cleanImportNumber(raw.mixer.flow, 0, 100, 100, true),
      sampleAllLayers: raw.mixer.sampleAllLayers === true,
      cleanAfterStroke: raw.mixer.cleanAfterStroke === true,
      ...(cleanOptionalImportText(raw.mixer.reservoirColor, 32) ? { reservoirColor: cleanOptionalImportText(raw.mixer.reservoirColor, 32) } : {}),
    } satisfies NonNullable<BrushSettings["mixer"]>
  }
  if ("colorReplacement" in raw) {
    if (!isImportRecord(raw.colorReplacement)) throw new Error("Color replacement settings must be an object.")
    out.colorReplacement = {
      sampling: cleanImportEnum(raw.colorReplacement.sampling, COLOR_REPLACEMENT_SAMPLING, "continuous"),
      limits: cleanImportEnum(raw.colorReplacement.limits, COLOR_REPLACEMENT_LIMITS, "contiguous"),
      mode: cleanImportEnum(raw.colorReplacement.mode, COLOR_REPLACEMENT_MODES, "color"),
      tolerance: cleanImportNumber(raw.colorReplacement.tolerance, 0, 255, 32, true),
      antiAlias: raw.colorReplacement.antiAlias !== false,
    } satisfies NonNullable<BrushSettings["colorReplacement"]>
  }
  if ("artHistory" in raw) {
    if (!isImportRecord(raw.artHistory)) throw new Error("Art history settings must be an object.")
    out.artHistory = {
      style: cleanImportEnum(raw.artHistory.style, ART_HISTORY_STYLES, "tight-medium"),
      area: cleanImportNumber(raw.artHistory.area, 4, 200, 24, true),
      fidelity: cleanImportNumber(raw.artHistory.fidelity, 0, 100, 60, true),
    } satisfies NonNullable<BrushSettings["artHistory"]>
  }

  return out as Partial<BrushSettings>
}

export function normalizeImportedThumbnail(raw: unknown, settings: Partial<BrushSettings>, options: BrushImportOptions) {
  if (raw == null || raw === "") return safeGeneratedThumbnail(options.makeThumbnail?.(settings))
  if (typeof raw !== "string") throw new Error("Brush thumbnail must be an image data URL.")
  const trimmed = raw.trim()
  if (trimmed.length > MAX_BRUSH_THUMBNAIL_LENGTH || !BRUSH_THUMBNAIL_DATA_URL.test(trimmed)) {
    throw new Error("Brush thumbnail must be a png, jpeg, webp, or gif data URL under the import limit.")
  }
  return trimmed
}

export function safeGeneratedThumbnail(thumbnail: string | undefined) {
  if (!thumbnail) return undefined
  return thumbnail.length <= MAX_BRUSH_THUMBNAIL_LENGTH && BRUSH_THUMBNAIL_DATA_URL.test(thumbnail) ? thumbnail : undefined
}

export function parseAbrPresets(
  buffer: ArrayBuffer | string | null,
  filename: string,
  foreground: string,
  background: string,
  options: AbrParseOptions = {},
): BrushPreset[] {
  if (!(buffer instanceof ArrayBuffer)) return []
  const bytes = new Uint8Array(buffer)
  if (bytes.byteLength > MAX_BRUSH_IMPORT_BYTES) {
    throw new Error(`Brush imports are limited to ${formatImportBytes(MAX_BRUSH_IMPORT_BYTES)}.`)
  }
  const scanLimit = Math.max(0, Math.min(bytes.length, options.maxScanBytes ?? ABR_SCAN_LIMIT_BYTES, ABR_SCAN_LIMIT_BYTES))
  const names = new Set<string>()
  collectAbrResourceNames(bytes, scanLimit, names)
  collectAbrTextNames(bytes, 0, scanLimit, names)
  if (!names.size) {
    const base = filename.replace(/\.[^.]+$/, "")
    names.add(base || "Imported ABR Brush")
  }
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now()
  return [...names].slice(0, MAX_BRUSH_PRESET_IMPORT_COUNT).map((name, index) => {
    const size = 12 + ((bytes[(index * 97) % Math.max(1, bytes.length)] ?? index * 17) % 96)
    const hardness = 35 + ((bytes[(index * 131 + 7) % Math.max(1, bytes.length)] ?? 64) % 66)
    const settings: Partial<BrushSettings> = {
      size,
      hardness,
      spacing: 18 + (index % 6) * 4,
      tipShape: index % 5 === 0 ? "bristle" : index % 7 === 0 ? "erodible" : "round",
      bristleTip: index % 5 === 0
        ? { length: 62 + (index % 4) * 6, density: 48 + (index % 5) * 8, thickness: 28 + (index % 3) * 8, stiffness: 45, splay: 42, wetness: 18 }
        : undefined,
      erodibleTip: index % 7 === 0
        ? { sharpness: 72, flatness: 38 + (index % 4) * 8, erosionRate: 58, softness: 18, aspectRatio: 76, rotation: (index % 6) * 8 - 20 }
        : undefined,
      texture: index % 3 === 0
        ? { enabled: true, pattern: "paper", mode: "multiply", depth: 24 + (index % 5) * 8, depthJitter: 10, minDepth: 4, scale: 80 + index * 3 }
        : undefined,
      sizeJitter: index % 4 === 0 ? 18 : 0,
      angleJitter: index % 5 === 0 ? 28 : 0,
    }
    const thumbnail = safeGeneratedThumbnail(options.makeThumbnail?.(settings)) ?? makeBrushThumbnail(settings, foreground, background)
    return {
      id: `abr_${now}_${index}`,
      name,
      folder: filename.replace(/\.[^.]+$/, "") || "Imported ABR",
      size,
      hardness,
      spacing: settings.spacing ?? 25,
      settings,
      ...(thumbnail ? { thumbnail } : {}),
    }
  })
}

export function isUsefulAbrName(name: string) {
  if (name.length < 4) return false
  if (/^8B(IM|64)/i.test(name)) return false
  if (/^(8BIM|8B64|samp|desc|VlLs|Objc|UntF|TEXT|long|tdta|brush)$/i.test(name)) return false
  if (/(.)\1{7,}/.test(name)) return false
  if (/^[\d .,-]+$/.test(name)) return false
  if ((name.match(/[A-Za-z]/g) ?? []).length < 3) return false
  return true
}

export function collectAbrResourceNames(bytes: Uint8Array, scanLimit: number, names: Set<string>) {
  for (let offset = 0; offset + 12 <= scanLimit && names.size < MAX_BRUSH_PRESET_IMPORT_COUNT; offset++) {
    if (!hasAbrSignature(bytes, offset)) continue
    let cursor = offset + 4
    cursor += 2
    if (cursor >= scanLimit) continue
    const pascalLength = bytes[cursor] ?? 0
    cursor += 1
    if (cursor + pascalLength > scanLimit) continue
    const pascalName = decodeAbrText(bytes, cursor, cursor + pascalLength).trim()
    addAbrNameCandidate(pascalName, names)
    cursor += pascalLength
    if ((1 + pascalLength) % 2 !== 0) cursor += 1
    if (cursor + 4 > scanLimit) continue
    const dataLength = readAbrUint32(bytes, cursor)
    cursor += 4
    if (dataLength < 0 || cursor + dataLength > bytes.length) continue
    const dataEnd = Math.min(cursor + dataLength, scanLimit)
    collectAbrTextNames(bytes, cursor, dataEnd, names)
    offset = Math.max(offset, dataEnd - 1)
  }
}

export function collectAbrTextNames(bytes: Uint8Array, start: number, end: number, names: Set<string>) {
  if (end <= start || names.size >= MAX_BRUSH_PRESET_IMPORT_COUNT) return
  const text = decodeAbrText(bytes, start, end)
  const asciiPattern = /[A-Za-z0-9][A-Za-z0-9 _.,()#+-]{3,63}/g
  for (const match of text.matchAll(asciiPattern)) {
    addAbrNameCandidate(match[0].trim(), names)
    if (names.size >= MAX_BRUSH_PRESET_IMPORT_COUNT) break
  }
}

export function addAbrNameCandidate(name: string, names: Set<string>) {
  const clean = cleanImportText(name, "", 64)
  if (!clean || !isUsefulAbrName(clean)) return
  names.add(clean)
}

export function hasAbrSignature(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] === 0x38 &&
    bytes[offset + 1] === 0x42 &&
    (bytes[offset + 2] === 0x49 || bytes[offset + 2] === 0x36) &&
    (bytes[offset + 3] === 0x4d || bytes[offset + 3] === 0x34)
  )
}

export function readAbrUint32(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] ?? 0) * 0x1000000) + ((bytes[offset + 1] ?? 0) << 16) + ((bytes[offset + 2] ?? 0) << 8) + (bytes[offset + 3] ?? 0)
}

export function decodeAbrText(bytes: Uint8Array, start: number, end: number) {
  return new TextDecoder("latin1", { fatal: false }).decode(bytes.slice(start, end))
}

export function requireImportRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isImportRecord(value)) throw new Error(`${label} must be an object.`)
  return value
}

export function isImportRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function cleanBrushImportId(value: unknown, prefix: string, index: number, makeId?: (prefix: string, index: number) => string) {
  const candidate = typeof value === "string" ? value.trim() : ""
  if (BRUSH_ID_PATTERN.test(candidate) && !RESERVED_IMPORT_KEYS.has(candidate)) return candidate
  return makeId ? makeId(prefix, index) : `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

export function cleanImportText(value: unknown, fallback: string, maxLength: number) {
  const trimmed = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
  return trimmed ? trimmed.slice(0, maxLength) : fallback
}

export function cleanOptionalImportText(value: unknown, maxLength: number) {
  const trimmed = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
  return trimmed ? trimmed.slice(0, maxLength) : undefined
}

export function isFiniteImportNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

export function cleanImportNumber(value: unknown, min: number, max: number, fallback: number, round = true) {
  const next = isFiniteImportNumber(value) ? value : fallback
  const clamped = Math.max(min, Math.min(max, next))
  return round ? Math.round(clamped) : clamped
}

export function cleanImportEnum<T extends string>(value: unknown, allowed: Set<string>, fallback: T) {
  return typeof value === "string" && allowed.has(value) ? (value as T) : fallback
}

export function copyImportNumber(record: Record<string, unknown>, out: Record<string, unknown>, key: keyof BrushSettings, min: number, max: number, fallback: number) {
  if (key in record) out[key] = cleanImportNumber(record[key], min, max, fallback, true)
}

export function copyImportBoolean(record: Record<string, unknown>, out: Record<string, unknown>, key: keyof BrushSettings) {
  if (typeof record[key] === "boolean") out[key] = record[key]
}

export function copyImportEnum(record: Record<string, unknown>, out: Record<string, unknown>, key: keyof BrushSettings, allowed: Set<string>) {
  if (typeof record[key] === "string" && allowed.has(record[key])) out[key] = record[key]
}

export function formatImportBytes(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)} MB`
}

export function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export function makeBrushThumbnail(brush: Partial<BrushSettings>, foreground: string, background: string) {
  if (typeof document === "undefined") return undefined
  const c = document.createElement("canvas")
  c.width = 56
  c.height = 56
  const ctx = c.getContext("2d")!
  ctx.fillStyle = "#2d2d2d"
  ctx.fillRect(0, 0, 56, 56)
  ctx.strokeStyle = "#444"
  for (let i = 0; i < 56; i += 8) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(0, i)
    ctx.stroke()
  }
  ctx.fillStyle = foreground || "#000"
  ctx.strokeStyle = background || "#fff"
  const shape = brush.tipShape ?? "round"
  const radius = Math.max(4, Math.min(22, (brush.size ?? 30) / 3))
  if (shape === "square") {
    ctx.save()
    ctx.translate(28, 28)
    ctx.rotate(((brush.pose?.rotation ?? 0) * Math.PI) / 180)
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2)
    ctx.restore()
  } else if (shape === "bristle") {
    ctx.lineWidth = 2
    for (let i = -5; i <= 5; i++) {
      ctx.globalAlpha = 0.4 + ((i + 5) % 4) * 0.12
      ctx.beginPath()
      ctx.moveTo(14, 28 + i * 2)
      ctx.quadraticCurveTo(28, 18 + i, 42, 28 + i * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  } else if (shape === "erodible") {
    ctx.beginPath()
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2
      const rr = radius * (0.72 + 0.28 * Math.sin(i * 2.7))
      const x = 28 + Math.cos(a) * rr
      const y = 28 + Math.sin(a) * rr
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.arc(28, 28, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  return c.toDataURL("image/png")
}
