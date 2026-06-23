"use client"

export type ClientStoragePrivacy =
  | "preference"
  | "project-data"
  | "autosave"
  | "preset-library"
  | "automation-plugin"
  | "diagnostic"

export interface ClientStorageKey<T = unknown> {
  key: string
  version: number
  privacy: ClientStoragePrivacy
  description: string
  fallback: T
  parse?: (value: unknown) => T | null
}

export type ClientStorageWriteResult =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "quota" | "serialization" | "unknown"; error?: unknown }

const clientStorageRegistry = new Map<string, ClientStorageKey>()

function parseStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : null
}

function parseUnknownArray(value: unknown) {
  return Array.isArray(value) ? value : null
}

function parseUnknownArrayOrItems(value: unknown) {
  if (Array.isArray(value)) return value
  if (value && typeof value === "object" && !Array.isArray(value) && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: unknown[] }).items
  }
  return null
}

function parseStringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const next: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") next[key] = entry
  }
  return next
}

function parseUsageRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const next: Record<string, { count: number; lastUsed: number }> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    if (typeof record.count !== "number" || typeof record.lastUsed !== "number") continue
    next[key] = {
      count: Math.max(0, Math.min(999, Math.round(record.count))),
      lastUsed: Number.isFinite(record.lastUsed) ? record.lastUsed : 0,
    }
  }
  return next
}

function parseNullableObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function parseStringOrNull(value: unknown) {
  return typeof value === "string" ? value : null
}

function parseFinitePoint(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const point = value as Record<string, unknown>
  return Number.isFinite(point.x) && Number.isFinite(point.y)
    ? { x: Number(point.x), y: Number(point.y) }
    : null
}

export function registerClientStorageKey<T>(descriptor: ClientStorageKey<T>): ClientStorageKey<T> {
  const existing = clientStorageRegistry.get(descriptor.key)
  if (existing) {
    if (
      existing.version === descriptor.version &&
      existing.privacy === descriptor.privacy &&
      existing.description === descriptor.description
    ) {
      return existing as ClientStorageKey<T>
    }
    throw new Error(`Client storage key already registered with different metadata: ${descriptor.key}`)
  }
  clientStorageRegistry.set(descriptor.key, descriptor)
  return descriptor
}

export function getClientStorageRegistry(): ClientStorageKey[] {
  return [...clientStorageRegistry.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export const CLIENT_STORAGE_KEYS = {
  preferences: registerClientStorageKey<unknown | null>({
    key: "ps-preferences",
    version: 1,
    privacy: "preference",
    description: "Editor preferences and UI defaults.",
    fallback: null,
    parse: (value) => value,
  }),
  editorSettings: registerClientStorageKey<unknown | null>({
    key: "ps-editor-settings",
    version: 1,
    privacy: "preference",
    description: "Persisted foreground, background, brush, gradient, and symmetry settings.",
    fallback: null,
    parse: parseNullableObject,
  }),
  recentDocuments: registerClientStorageKey<unknown[]>({
    key: "ps-recent-documents-v1",
    version: 1,
    privacy: "project-data",
    description: "Recent document metadata and small project recovery records.",
    fallback: [],
    parse: (value) => Array.isArray(value) ? value : null,
  }),
  pinnedDocuments: registerClientStorageKey<string[]>({
    key: "ps-pinned-documents-v1",
    version: 1,
    privacy: "project-data",
    description: "Pinned recent document identifiers shown in the start workspace.",
    fallback: [],
    parse: parseStringArray,
  }),
  workspaces: registerClientStorageKey<unknown[]>({
    key: "ps-workspaces-v2",
    version: 2,
    privacy: "preference",
    description: "Saved panel workspace layouts.",
    fallback: [],
    parse: parseUnknownArray,
  }),
  legacyWorkspaces: registerClientStorageKey<unknown[]>({
    key: "ps-workspaces-v1",
    version: 1,
    privacy: "preference",
    description: "Legacy saved panel workspace layouts retained for migration.",
    fallback: [],
    parse: parseUnknownArray,
  }),
  autosave: registerClientStorageKey<unknown | null>({
    key: "ps-autosave-v1",
    version: 1,
    privacy: "autosave",
    description: "Single-document autosave fallback payload.",
    fallback: null,
    parse: (value) => value,
  }),
  autosaveCollection: registerClientStorageKey<unknown[]>({
    key: "ps-autosave-documents-v1",
    version: 1,
    privacy: "autosave",
    description: "Multi-document autosave fallback payloads.",
    fallback: [],
    parse: (value) => Array.isArray(value) ? value : null,
  }),
  menuCustomization: registerClientStorageKey<unknown | null>({
    key: "ps-menu-customization",
    version: 1,
    privacy: "preference",
    description: "User menu visibility and ordering customizations.",
    fallback: null,
    parse: parseNullableObject,
  }),
  menuPresets: registerClientStorageKey<unknown[]>({
    key: "ps-menu-presets",
    version: 1,
    privacy: "preference",
    description: "Named menu customization presets.",
    fallback: [],
    parse: parseUnknownArray,
  }),
  recentColors: registerClientStorageKey<string[]>({
    key: "ps-recent-colors",
    version: 1,
    privacy: "preference",
    description: "Most recently used picker colors.",
    fallback: [],
    parse: parseStringArray,
  }),
  customShortcuts: registerClientStorageKey<Record<string, string>>({
    key: "ps-custom-shortcuts",
    version: 1,
    privacy: "preference",
    description: "User-defined keyboard shortcut overrides.",
    fallback: {},
    parse: parseStringRecord,
  }),
  techPreviewFlags: registerClientStorageKey<unknown | null>({
    key: "ps-tech-preview-flags",
    version: 1,
    privacy: "preference",
    description: "Technology preview feature flag state.",
    fallback: null,
    parse: parseNullableObject,
  }),
  statusBarVisible: registerClientStorageKey<string | null>({
    key: "ps-status-bar-visible",
    version: 1,
    privacy: "preference",
    description: "Status bar visibility state stored as a legacy string boolean.",
    fallback: null,
    parse: parseStringOrNull,
  }),
  dockWidth: registerClientStorageKey<string | null>({
    key: "ps-dock-width",
    version: 1,
    privacy: "preference",
    description: "Right dock width in CSS pixels.",
    fallback: null,
    parse: (value) => typeof value === "string" ? value : null,
  }),
  panelDockState: registerClientStorageKey<unknown | null>({
    key: "ps-panel-dock-state-v2",
    version: 2,
    privacy: "preference",
    description: "Panel dock open/collapsed state.",
    fallback: null,
    parse: parseNullableObject,
  }),
  currentWorkspacePreset: registerClientStorageKey<string | null>({
    key: "ps-current-workspace-preset",
    version: 1,
    privacy: "preference",
    description: "Currently selected built-in workspace preset.",
    fallback: null,
    parse: parseStringOrNull,
  }),
  panelSplit: registerClientStorageKey<string | null>({
    key: "ps-panel-split",
    version: 1,
    privacy: "preference",
    description: "Panel split height percentage.",
    fallback: null,
    parse: (value) => typeof value === "string" ? value : null,
  }),
  contextualTaskBarPosition: registerClientStorageKey<{ x: number; y: number } | null>({
    key: "ps-contextual-task-bar-position",
    version: 1,
    privacy: "preference",
    description: "Floating contextual task bar position.",
    fallback: null,
    parse: parseFinitePoint,
  }),
  shadowsHighlightsDefaults: registerClientStorageKey<unknown | null>({
    key: "ps.shadowsHighlights.defaults",
    version: 1,
    privacy: "preference",
    description: "Shadows/Highlights dialog default settings.",
    fallback: null,
    parse: parseNullableObject,
  }),
  autoOptionsDefaults: registerClientStorageKey<unknown | null>({
    key: "ps.auto.options",
    version: 1,
    privacy: "preference",
    description: "Auto Options dialog default settings.",
    fallback: null,
    parse: parseNullableObject,
  }),
  notesAuthor: registerClientStorageKey<string | null>({
    key: "ps-notes-author",
    version: 1,
    privacy: "preference",
    description: "Default author name for document notes.",
    fallback: null,
    parse: parseStringOrNull,
  }),
  measurementLogPreferences: registerClientStorageKey<unknown | null>({
    key: "ps-measurement-log-prefs",
    version: 1,
    privacy: "preference",
    description: "Measurement log calibration and label preferences.",
    fallback: null,
    parse: parseNullableObject,
  }),
  swatches: registerClientStorageKey<unknown[]>({
    key: "ps-swatches",
    version: 1,
    privacy: "preset-library",
    description: "Global swatch preset library.",
    fallback: [],
    parse: parseUnknownArray,
  }),
  gradients: registerClientStorageKey<unknown[]>({
    key: "ps-gradients",
    version: 1,
    privacy: "preset-library",
    description: "Global gradient preset library.",
    fallback: [],
    parse: parseUnknownArray,
  }),
  patterns: registerClientStorageKey<unknown[]>({
    key: "ps-patterns",
    version: 1,
    privacy: "preset-library",
    description: "Global pattern preset library.",
    fallback: [],
    parse: parseUnknownArray,
  }),
  shapePresets: registerClientStorageKey<unknown[]>({
    key: "ps-shape-presets",
    version: 1,
    privacy: "preset-library",
    description: "Custom shape preset library.",
    fallback: [],
    parse: parseUnknownArray,
  }),
  recentSwatches: registerClientStorageKey<unknown[]>({
    key: "ps-recent-swatches",
    version: 1,
    privacy: "preset-library",
    description: "Most recently used swatches in the Swatches panel.",
    fallback: [],
    parse: parseUnknownArray,
  }),
  recentGlyphs: registerClientStorageKey<string[]>({
    key: "ps-glyphs-recent",
    version: 1,
    privacy: "preference",
    description: "Recently inserted glyphs.",
    fallback: [],
    parse: parseStringArray,
  }),
  cameraRawUserPresets: registerClientStorageKey<unknown[]>({
    key: "ps.cameraRaw.userPresets.v1",
    version: 1,
    privacy: "preset-library",
    description: "Camera Raw user preset library.",
    fallback: [],
    parse: parseUnknownArray,
  }),
  cameraRawSnapshots: registerClientStorageKey<unknown[]>({
    key: "ps.cameraRaw.snapshots.v1",
    version: 1,
    privacy: "preset-library",
    description: "Camera Raw local snapshots.",
    fallback: [],
    parse: parseUnknownArray,
  }),
  contactSheetPresets: registerClientStorageKey<unknown[]>({
    key: "ps-contact-sheet-presets-v1",
    version: 1,
    privacy: "preset-library",
    description: "Contact Sheet saved layout presets.",
    fallback: [],
    parse: parseUnknownArray,
  }),
  smartFilterStackPresets: registerClientStorageKey<unknown[]>({
    key: "ps-filter-gallery-stack-presets-v1",
    version: 1,
    privacy: "preset-library",
    description: "Saved Smart Filter Gallery stack presets.",
    fallback: [],
    parse: parseUnknownArray,
  }),
  actionEnvelopes: registerClientStorageKey<unknown | null>({
    key: "ps-action-envelopes",
    version: 1,
    privacy: "automation-plugin",
    description: "Conditional action envelopes and playback metadata.",
    fallback: null,
    parse: parseNullableObject,
  }),
  actionPlaybackSpeed: registerClientStorageKey<string | null>({
    key: "ps-action-playback-speed",
    version: 1,
    privacy: "automation-plugin",
    description: "Action playback speed preference.",
    fallback: null,
    parse: parseStringOrNull,
  }),
  commandMacros: registerClientStorageKey<unknown[]>({
    key: "ps-command-macros-v1",
    version: 1,
    privacy: "automation-plugin",
    description: "Command palette macro definitions.",
    fallback: [],
    parse: parseUnknownArrayOrItems,
  }),
  automationWorkflows: registerClientStorageKey<unknown[]>({
    key: "ps-automation-workflows-v1",
    version: 1,
    privacy: "automation-plugin",
    description: "Automation workflow definitions.",
    fallback: [],
    parse: parseUnknownArrayOrItems,
  }),
  legacyCommandMacros: registerClientStorageKey<unknown[]>({
    key: "ps-command-macros",
    version: 1,
    privacy: "automation-plugin",
    description: "Legacy command macro definitions retained for migration.",
    fallback: [],
    parse: parseUnknownArray,
  }),
  droplets: registerClientStorageKey<unknown[]>({
    key: "ps-droplets",
    version: 1,
    privacy: "automation-plugin",
    description: "Saved droplet automation bundles.",
    fallback: [],
    parse: parseUnknownArray,
  }),
  commandUsage: registerClientStorageKey<Record<string, { count: number; lastUsed: number }>>({
    key: "ps-command-usage-v1",
    version: 1,
    privacy: "diagnostic",
    description: "Command usage ranking counters.",
    fallback: {},
    parse: parseUsageRecord,
  }),
  commandPaletteUsage: registerClientStorageKey<Record<string, { count: number; lastUsed: number }>>({
    key: "ps-command-palette-usage-v1",
    version: 1,
    privacy: "diagnostic",
    description: "Command palette usage ranking counters.",
    fallback: {},
    parse: parseUsageRecord,
  }),
  recentCommands: registerClientStorageKey<string[]>({
    key: "ps-command-palette-recent",
    version: 1,
    privacy: "diagnostic",
    description: "Recently executed command identifiers.",
    fallback: [],
    parse: parseStringArray,
  }),
} as const

export function browserLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") return null
    return window.localStorage
  } catch {
    return null
  }
}

export function readClientStorageJson<T>(
  descriptor: ClientStorageKey<T>,
  options: { storage?: Storage | null } = {},
): T {
  const storage = options.storage ?? browserLocalStorage()
  if (!storage) return descriptor.fallback
  try {
    const raw = storage.getItem(descriptor.key)
    if (raw === null) return descriptor.fallback
    const parsed = JSON.parse(raw) as unknown
    if (descriptor.parse) return descriptor.parse(parsed) ?? descriptor.fallback
    return parsed as T
  } catch {
    return descriptor.fallback
  }
}

export function writeClientStorageJson<T>(
  descriptor: ClientStorageKey<T>,
  value: T,
  options: { storage?: Storage | null } = {},
): ClientStorageWriteResult {
  const storage = options.storage ?? browserLocalStorage()
  if (!storage) return { ok: false, reason: "unavailable" }
  try {
    storage.setItem(descriptor.key, JSON.stringify(value))
    return { ok: true }
  } catch (error) {
    if (error instanceof DOMException && error.name === "QuotaExceededError") {
      return { ok: false, reason: "quota", error }
    }
    if (error instanceof TypeError) return { ok: false, reason: "serialization", error }
    return { ok: false, reason: "unknown", error }
  }
}

export function readClientStorageString<T extends string | null>(
  descriptor: ClientStorageKey<T>,
  options: { storage?: Storage | null } = {},
): T {
  const storage = options.storage ?? browserLocalStorage()
  if (!storage) return descriptor.fallback
  try {
    const raw = storage.getItem(descriptor.key)
    if (raw === null) return descriptor.fallback
    if (descriptor.parse) return descriptor.parse(raw) ?? descriptor.fallback
    return raw as T
  } catch {
    return descriptor.fallback
  }
}

export function writeClientStorageString(
  descriptor: Pick<ClientStorageKey, "key">,
  value: string,
  options: { storage?: Storage | null } = {},
): ClientStorageWriteResult {
  const storage = options.storage ?? browserLocalStorage()
  if (!storage) return { ok: false, reason: "unavailable" }
  try {
    storage.setItem(descriptor.key, value)
    return { ok: true }
  } catch (error) {
    if (error instanceof DOMException && error.name === "QuotaExceededError") {
      return { ok: false, reason: "quota", error }
    }
    return { ok: false, reason: "unknown", error }
  }
}

export function removeClientStorageItem(
  descriptor: Pick<ClientStorageKey, "key">,
  options: { storage?: Storage | null } = {},
): ClientStorageWriteResult {
  const storage = options.storage ?? browserLocalStorage()
  if (!storage) return { ok: false, reason: "unavailable" }
  try {
    storage.removeItem(descriptor.key)
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: "unknown", error }
  }
}

export function clearClientStorageByPrivacy(
  privacy: ClientStoragePrivacy,
  options: { storage?: Storage | null } = {},
): ClientStorageWriteResult {
  const storage = options.storage ?? browserLocalStorage()
  if (!storage) return { ok: false, reason: "unavailable" }
  try {
    for (const descriptor of clientStorageRegistry.values()) {
      if (descriptor.privacy === privacy) storage.removeItem(descriptor.key)
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: "unknown", error }
  }
}
