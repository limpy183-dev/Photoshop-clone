import type { BrushSettings, GradientSettings, SymmetrySettings } from "./types"
import { CLIENT_STORAGE_KEYS, browserLocalStorage, readClientStorageJson, writeClientStorageJson } from "./client-storage"

export const EDITOR_SETTINGS_KEY = CLIENT_STORAGE_KEYS.editorSettings.key

export interface PersistedEditorState {
  foreground: string
  background: string
  brush: BrushSettings
  gradient: GradientSettings
  symmetry: SymmetrySettings
}

export type PersistedEditorDefaults = Pick<PersistedEditorState, "brush" | "gradient" | "symmetry">

// localStorage is untrusted relative to the editor's runtime: anything with
// same-origin scripting (a malicious extension, an earlier XSS, or another
// tab on the same origin) can mutate ps-editor-settings before we read it
// back. We strip prototype-pollution keys and reject any key that does not
// look like a sensible identifier before letting the value land in editor
// state.
const PERSISTED_RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"])
const PERSISTED_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const PERSISTED_MAX_DEPTH = 6
const PERSISTED_MAX_STRING = 1024
const PERSISTED_MAX_ARRAY = 256
const PERSISTED_MAX_KEYS = 128

function storageOrGlobal(storage?: Storage): Storage | undefined {
  if (storage) return storage
  return browserLocalStorage() ?? undefined
}

function sanitizePersistedSetting(value: unknown, depth = 0): unknown {
  if (value === null) return null
  const type = typeof value
  if (type === "string") return (value as string).slice(0, PERSISTED_MAX_STRING)
  if (type === "boolean") return value
  if (type === "number") return Number.isFinite(value as number) ? value : undefined
  if (type === "function" || type === "symbol" || type === "bigint" || type === "undefined") return undefined
  if (depth >= PERSISTED_MAX_DEPTH) return undefined
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (const item of value.slice(0, PERSISTED_MAX_ARRAY)) {
      const next = sanitizePersistedSetting(item, depth + 1)
      if (next !== undefined) out.push(next)
    }
    return out
  }
  if (type === "object") {
    const out: Record<string, unknown> = {}
    let copied = 0
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (copied >= PERSISTED_MAX_KEYS) break
      if (PERSISTED_RESERVED_KEYS.has(key)) continue
      if (!PERSISTED_KEY_PATTERN.test(key)) continue
      const next = sanitizePersistedSetting(nested, depth + 1)
      if (next === undefined) continue
      out[key] = next
      copied += 1
    }
    return out
  }
  return undefined
}

function sanitizeColorString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const v = value.trim()
  // Match the conservative SVG-color allow-list used by document-io.ts so
  // the persisted foreground/background cannot smuggle a CSS url() into a
  // style sink.
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v
  if (/^(rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/]+\)$/i.test(v)) return v
  if (/^[a-zA-Z]{3,32}$/.test(v)) return v
  return undefined
}

const PERSISTED_BRUSH_KEYS = [
  "size",
  "hardness",
  "opacity",
  "flow",
  "smoothing",
  "spacing",
  "tipShape",
  "erodibleTip",
  "bristleTip",
  "mixer",
  "colorReplacement",
  "artHistory",
] as const satisfies readonly (keyof BrushSettings)[]
const PERSISTED_GRADIENT_KEYS = ["type", "reverse"] as const satisfies readonly (keyof GradientSettings)[]
const PERSISTED_SYMMETRY_KEYS = ["enabled", "axis"] as const satisfies readonly (keyof SymmetrySettings)[]

function pickPersistedFields<T extends object, K extends readonly (keyof T)[]>(
  value: unknown,
  keys: K,
): Partial<Pick<T, K[number]>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const filtered: Partial<Pick<T, K[number]>> = {}
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      filtered[key] = source[String(key)] as T[K[number]]
    }
  }
  return filtered
}

export function filterPersistedEditorSettingsForHydration(
  value: unknown,
  defaults: PersistedEditorDefaults,
): Partial<PersistedEditorState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const s = sanitizePersistedSetting(value) as Record<string, unknown> | undefined
  if (!s) return {}
  const out: Partial<PersistedEditorState> = {}

  const foreground = sanitizeColorString(s.foreground)
  if (foreground) out.foreground = foreground
  const background = sanitizeColorString(s.background)
  if (background) out.background = background

  const brush = pickPersistedFields<BrushSettings, typeof PERSISTED_BRUSH_KEYS>(
    s.brush,
    PERSISTED_BRUSH_KEYS,
  )
  if (brush) out.brush = { ...defaults.brush, ...brush }

  const gradient = pickPersistedFields<GradientSettings, typeof PERSISTED_GRADIENT_KEYS>(
    s.gradient,
    PERSISTED_GRADIENT_KEYS,
  )
  if (gradient) out.gradient = { ...defaults.gradient, ...gradient }

  const symmetry = pickPersistedFields<SymmetrySettings, typeof PERSISTED_SYMMETRY_KEYS>(
    s.symmetry,
    PERSISTED_SYMMETRY_KEYS,
  )
  if (symmetry) out.symmetry = { ...defaults.symmetry, ...symmetry }

  return out
}

export function serializePersistedEditorSettings(state: PersistedEditorState) {
  return {
    foreground: state.foreground,
    background: state.background,
    brush: {
      size: state.brush.size,
      hardness: state.brush.hardness,
      opacity: state.brush.opacity,
      flow: state.brush.flow,
      smoothing: state.brush.smoothing,
      spacing: state.brush.spacing,
      tipShape: state.brush.tipShape,
      erodibleTip: state.brush.erodibleTip,
      bristleTip: state.brush.bristleTip,
      mixer: state.brush.mixer,
      colorReplacement: state.brush.colorReplacement,
      artHistory: state.brush.artHistory,
    },
    gradient: state.gradient,
    symmetry: state.symmetry,
  }
}

export function loadPersistedEditorSettings(
  defaults: PersistedEditorDefaults,
  storage?: Storage,
): Partial<PersistedEditorState> {
  const targetStorage = storageOrGlobal(storage)
  if (!targetStorage) return {}
  const parsed = readClientStorageJson(CLIENT_STORAGE_KEYS.editorSettings, { storage: targetStorage })
  return filterPersistedEditorSettingsForHydration(parsed, defaults)
}

export function savePersistedEditorSettings(state: PersistedEditorState, storage?: Storage) {
  const targetStorage = storageOrGlobal(storage)
  if (!targetStorage) return
  writeClientStorageJson(CLIENT_STORAGE_KEYS.editorSettings, serializePersistedEditorSettings(state), {
    storage: targetStorage,
  })
}
