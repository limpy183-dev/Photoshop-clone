import type * as React from "react"
import { CLIENT_STORAGE_KEYS, readClientStorageJson, removeClientStorageItem, writeClientStorageJson } from "./client-storage"
import { dispatchPhotoshopEvent } from "./events"

export interface Shortcut {
  id: string
  keys: string
  action: string
  category: string
}

export const SHORTCUT_STORAGE_KEY = CLIENT_STORAGE_KEYS.customShortcuts.key

export const DEFAULT_SHORTCUTS: Shortcut[] = [
  // File
  { id: "file-new", keys: "Ctrl+N", action: "New Document", category: "File" },
  { id: "file-open", keys: "Ctrl+O", action: "Open", category: "File" },
  { id: "file-save", keys: "Ctrl+S", action: "Save As PNG", category: "File" },
  { id: "file-saveas", keys: "Ctrl+Shift+S", action: "Save As PNG", category: "File" },
  { id: "file-close", keys: "Ctrl+W", action: "Close Document", category: "File" },
  { id: "file-print", keys: "Ctrl+P", action: "Print", category: "File" },
  // Edit
  { id: "edit-undo", keys: "Ctrl+Z", action: "Undo", category: "Edit" },
  { id: "edit-redo", keys: "Ctrl+Y / Ctrl+Shift+Z", action: "Redo", category: "Edit" },
  { id: "edit-stepback", keys: "Ctrl+Alt+Z", action: "Step Backward", category: "Edit" },
  { id: "edit-cut", keys: "Ctrl+X", action: "Cut", category: "Edit" },
  { id: "edit-copy", keys: "Ctrl+C", action: "Copy", category: "Edit" },
  { id: "edit-copymerged", keys: "Ctrl+Shift+C", action: "Copy Merged", category: "Edit" },
  { id: "edit-paste", keys: "Ctrl+V", action: "Paste", category: "Edit" },
  { id: "edit-fill", keys: "Shift+F5", action: "Fill", category: "Edit" },
  { id: "edit-transform", keys: "Ctrl+T", action: "Free Transform", category: "Edit" },
  { id: "command-palette", keys: "Ctrl+K", action: "Command Palette", category: "Edit" },
  // Image
  { id: "img-levels", keys: "Ctrl+L", action: "Levels", category: "Image" },
  { id: "img-curves", keys: "Ctrl+M", action: "Curves", category: "Image" },
  { id: "img-huesat", keys: "Ctrl+U", action: "Hue/Saturation", category: "Image" },
  { id: "img-colorbal", keys: "Ctrl+B", action: "Color Balance", category: "Image" },
  { id: "img-invert", keys: "Ctrl+I", action: "Invert", category: "Image" },
  { id: "img-imgsize", keys: "Ctrl+Alt+I", action: "Image Size", category: "Image" },
  { id: "img-canvassize", keys: "Ctrl+Alt+C", action: "Canvas Size", category: "Image" },
  // Layer
  { id: "layer-new", keys: "Ctrl+Shift+N", action: "New Layer", category: "Layer" },
  { id: "layer-dup", keys: "Ctrl+J", action: "Duplicate Layer", category: "Layer" },
  { id: "layer-group", keys: "Ctrl+G", action: "Group from Layers", category: "Layer" },
  { id: "layer-merge", keys: "Ctrl+E", action: "Merge Down", category: "Layer" },
  { id: "layer-stamp", keys: "Ctrl+Shift+Alt+E", action: "Stamp Visible", category: "Layer" },
  { id: "layer-clip", keys: "Ctrl+Alt+G", action: "Create Clipping Mask", category: "Layer" },
  // Select
  { id: "sel-all", keys: "Ctrl+A", action: "Select All", category: "Select" },
  { id: "sel-deselect", keys: "Ctrl+D", action: "Deselect", category: "Select" },
  { id: "sel-reselect", keys: "Ctrl+Shift+D", action: "Reselect", category: "Select" },
  { id: "sel-inverse", keys: "Ctrl+Shift+I", action: "Inverse Selection", category: "Select" },
  { id: "sel-feather", keys: "Shift+F6", action: "Feather Selection", category: "Select" },
  { id: "sel-alllayers", keys: "Ctrl+Alt+A", action: "All Layers", category: "Select" },
  // Filter
  { id: "filter-last", keys: "Ctrl+F", action: "Last Filter", category: "Filter" },
  { id: "filter-liquify", keys: "Ctrl+Shift+X", action: "Liquify", category: "Filter" },
  // Timeline / Video
  { id: "timeline-split-frame", keys: "Ctrl+Shift+K", action: "Split Timeline Frame at Playhead", category: "Timeline" },
  // View
  { id: "view-zoomin", keys: "Ctrl++", action: "Zoom In", category: "View" },
  { id: "view-zoomout", keys: "Ctrl+-", action: "Zoom Out", category: "View" },
  { id: "view-100", keys: "Ctrl+1", action: "Zoom 100%", category: "View" },
  { id: "view-fit", keys: "Ctrl+0", action: "Fit on Screen", category: "View" },
  { id: "view-grid", keys: "Ctrl+'", action: "Toggle Grid", category: "View" },
  { id: "view-quickmask", keys: "Q", action: "Quick Mask", category: "View" },
  // Tools
  { id: "tool-brush", keys: "B", action: "Brush Tool / Pencil Tool / Mixer Brush Tool", category: "Tools" },
  { id: "tool-eraser", keys: "E", action: "Eraser / Background Eraser / Magic Eraser", category: "Tools" },
  { id: "tool-gradient", keys: "G", action: "Gradient / Paint Bucket", category: "Tools" },
  { id: "tool-move", keys: "V", action: "Move / Artboard", category: "Tools" },
  { id: "tool-marquee", keys: "M", action: "Marquee Tools", category: "Tools" },
  { id: "tool-lasso", keys: "L", action: "Lasso Tools", category: "Tools" },
  { id: "tool-wand", keys: "W", action: "Selection / Quick Selection Tools", category: "Tools" },
  { id: "tool-crop", keys: "C", action: "Crop / Perspective Crop / Slice / Slice Select / Frame", category: "Tools" },
  { id: "tool-eyedropper", keys: "I", action: "Eyedropper / Measure / Note / Count", category: "Tools" },
  { id: "tool-text", keys: "T", action: "Horizontal / Vertical Type Tools", category: "Tools" },
  { id: "tool-shape", keys: "U", action: "Shape / Polygon Tools", category: "Tools" },
  { id: "tool-stamp", keys: "S", action: "Clone / Pattern Stamp", category: "Tools" },
  { id: "tool-heal", keys: "J", action: "Healing Tools", category: "Tools" },
  { id: "tool-dodge", keys: "O", action: "Dodge / Burn / Sponge", category: "Tools" },
  { id: "tool-blur", keys: "None", action: "Blur / Sharpen / Smudge", category: "Tools" },
  { id: "tool-pen", keys: "P", action: "Pen Tools", category: "Tools" },
  { id: "tool-hand", keys: "H", action: "Hand Tool", category: "Tools" },
  { id: "tool-rotate-view", keys: "R", action: "Rotate View Tool", category: "Tools" },
  { id: "tool-zoom", keys: "Z", action: "Zoom Tool", category: "Tools" },
  { id: "tool-transform", keys: "None", action: "Transform Tool", category: "Tools" },
  { id: "tool-pencil", keys: "None", action: "Pencil Tool", category: "Tools" },
  { id: "tool-slice", keys: "None", action: "Slice Tool", category: "Tools" },
  { id: "tool-slice-select", keys: "None", action: "Slice Select Tool", category: "Tools" },
  // Color
  { id: "color-default", keys: "D", action: "Default Colors (B/W)", category: "Color" },
  { id: "color-swap", keys: "X", action: "Swap Foreground/Background", category: "Color" },
  { id: "brush-smaller", keys: "[", action: "Decrease Brush Size", category: "Brush" },
  { id: "brush-larger", keys: "]", action: "Increase Brush Size", category: "Brush" },
  { id: "brush-softer", keys: "Shift+[", action: "Decrease Brush Hardness", category: "Brush" },
  { id: "brush-harder", keys: "Shift+]", action: "Increase Brush Hardness", category: "Brush" },
  { id: "brush-opacity", keys: "1-9, 0", action: "Set Brush Opacity (10%-100%)", category: "Brush" },
]

const DEFAULT_SHORTCUT_BY_ID = new Map(DEFAULT_SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]))

export function validShortcutOverrides(value: unknown): Record<string, string> {
  const source =
    value && typeof value === "object" && "overrides" in value
      ? (value as { overrides?: unknown }).overrides
      : value
  if (!source || typeof source !== "object" || Array.isArray(source)) return {}
  const ids = new Set(DEFAULT_SHORTCUTS.map((shortcut) => shortcut.id))
  const valid: Record<string, string> = {}
  for (const [id, keys] of Object.entries(source as Record<string, unknown>)) {
    if (!ids.has(id) || typeof keys !== "string") continue
    const trimmed = keys.trim()
    if (trimmed && trimmed.length <= 40) valid[id] = trimmed
  }
  return valid
}

export function loadCustomShortcuts(): Record<string, string> {
  if (typeof window === "undefined") return {}
  return validShortcutOverrides(readClientStorageJson(CLIENT_STORAGE_KEYS.customShortcuts))
}

export function saveCustomShortcuts(overrides: Record<string, string>) {
  try {
    if (Object.keys(overrides).length === 0) {
      removeClientStorageItem(CLIENT_STORAGE_KEYS.customShortcuts)
    } else {
      writeClientStorageJson(CLIENT_STORAGE_KEYS.customShortcuts, overrides)
    }
    dispatchPhotoshopEvent("ps-shortcuts-changed", overrides)
  } catch {}
}

export function effectiveShortcut(id: string, overrides: Record<string, string>) {
  return overrides[id] ?? DEFAULT_SHORTCUT_BY_ID.get(id)?.keys ?? ""
}

export function isShortcutAssigned(keys: string) {
  const normalized = keys.trim().toLowerCase()
  return normalized !== "" && normalized !== "none" && normalized !== "unassigned"
}

function titleCaseShortcutPart(part: string) {
  const normalized = part.trim().toLowerCase()
  if (normalized === "ctrl" || normalized === "control" || normalized === "cmd" || normalized === "command" || normalized === "meta") return "Ctrl"
  if (normalized === "alt" || normalized === "option") return "Alt"
  if (normalized === "shift") return "Shift"
  if (normalized === "esc" || normalized === "escape") return "Esc"
  if (normalized === "del" || normalized === "delete") return "Del"
  if (normalized === "space") return "Space"
  if (normalized === "up" || normalized === "arrowup") return "Up"
  if (normalized === "down" || normalized === "arrowdown") return "Down"
  if (normalized === "left" || normalized === "arrowleft") return "Left"
  if (normalized === "right" || normalized === "arrowright") return "Right"
  if (/^f\d{1,2}$/.test(normalized)) return normalized.toUpperCase()
  return part.length === 1 ? part.toUpperCase() : part.trim()
}

export function normalizeShortcutKeys(keys: string) {
  if (!isShortcutAssigned(keys)) return "None"
  return keys
    .split(/\s*(\/|,)\s*/)
    .map((part) => {
      if (part === "/" || part === ",") return part === "/" ? " / " : ", "
      return part
        .split("+")
        .map(titleCaseShortcutPart)
        .filter(Boolean)
        .join("+")
    })
    .join("")
    .trim()
}

/** Convert a KeyboardEvent into a readable shortcut string like "Ctrl+Shift+A". */
export function eventToShortcut(e: KeyboardEvent | React.KeyboardEvent): string | null {
  const key = e.key
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return null

  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl")
  if (e.altKey) parts.push("Alt")
  if (e.shiftKey) parts.push("Shift")

  let keyName = key
  if (key === " ") keyName = "Space"
  else if (key === "ArrowUp") keyName = "Up"
  else if (key === "ArrowDown") keyName = "Down"
  else if (key === "ArrowLeft") keyName = "Left"
  else if (key === "ArrowRight") keyName = "Right"
  else if (key === "Escape") keyName = "Esc"
  else if (key === "Delete") keyName = "Del"
  else if (key === "Backspace") keyName = "Backspace"
  else if (key.length === 1) keyName = key.toUpperCase()
  else if (key.startsWith("F") && !Number.isNaN(Number(key.slice(1)))) keyName = key

  parts.push(keyName)
  return parts.join("+")
}

function shortcutAlternates(keys: string) {
  return keys
    .split(/\s*(?:\/|,)\s*/)
    .map((part) => part.trim())
    .filter(isShortcutAssigned)
}

function shortcutCanonical(alternate: string) {
  const parts = alternate.split("+").map((part) => keyAlias(part.trim())).filter(Boolean)
  if (!parts.length) return ""
  const key = parts[parts.length - 1]
  const modifiers = new Set(parts.slice(0, -1))
  const ordered = [
    modifiers.has("ctrl") || modifiers.has("control") || modifiers.has("cmd") || modifiers.has("command") || modifiers.has("meta") ? "ctrl" : "",
    modifiers.has("alt") || modifiers.has("option") ? "alt" : "",
    modifiers.has("shift") ? "shift" : "",
  ].filter(Boolean)
  return [...ordered, key].join("+")
}

function shortcutCanonicalSet(keys: string) {
  return new Set(shortcutAlternates(keys).map(shortcutCanonical).filter(Boolean))
}

export interface ShortcutConflict {
  keys: string
  canonicalKeys: string[]
  shortcutIds: string[]
  actions: string[]
}

export function shortcutConflictMap(shortcuts: readonly Shortcut[]): ShortcutConflict[] {
  const byKey = new Map<string, { display: string; shortcuts: Shortcut[] }>()
  for (const shortcut of shortcuts) {
    for (const alternate of shortcutAlternates(shortcut.keys)) {
      const canonical = shortcutCanonical(alternate)
      if (!canonical) continue
      const current = byKey.get(canonical) ?? { display: normalizeShortcutKeys(alternate), shortcuts: [] }
      current.shortcuts.push(shortcut)
      byKey.set(canonical, current)
    }
  }
  return [...byKey.entries()]
    .filter(([, entry]) => entry.shortcuts.length > 1)
    .map(([canonical, entry]) => ({
      keys: entry.display,
      canonicalKeys: [canonical],
      shortcutIds: entry.shortcuts.map((shortcut) => shortcut.id),
      actions: entry.shortcuts.map((shortcut) => shortcut.action),
    }))
}

export function buildShortcutOverrideUpdate(
  shortcuts: readonly Shortcut[],
  overrides: Record<string, string>,
  id: string,
  keys: string,
  options: { clearConflicts?: boolean } = {},
) {
  const normalized = normalizeShortcutKeys(keys)
  const next = { ...overrides, [id]: normalized }
  if (!options.clearConflicts || !isShortcutAssigned(normalized)) return next

  const desired = shortcutCanonicalSet(normalized)
  for (const shortcut of shortcuts) {
    if (shortcut.id === id) continue
    const hasConflict = [...shortcutCanonicalSet(shortcut.keys)].some((key) => desired.has(key))
    if (hasConflict) next[shortcut.id] = "None"
  }
  return next
}

function keyAlias(key: string) {
  const normalized = key.toLowerCase()
  if (normalized === "esc") return "escape"
  if (normalized === "del") return "delete"
  if (normalized === "up") return "arrowup"
  if (normalized === "down") return "arrowdown"
  if (normalized === "left") return "arrowleft"
  if (normalized === "right") return "arrowright"
  if (normalized === "space") return " "
  if (normalized === "plus") return "+"
  return normalized
}

function eventKeyAliases(event: KeyboardEvent) {
  const key = event.key.toLowerCase()
  const aliases = new Set([key])
  if (key === "=") aliases.add("+")
  if (key === "+") aliases.add("=")
  return aliases
}

export function shortcutMatchesEvent(keys: string, event: KeyboardEvent) {
  if (!isShortcutAssigned(keys)) return false
  const eventKeys = eventKeyAliases(event)
  for (const alternate of shortcutAlternates(keys)) {
    const parts = alternate.split("+").map((part) => part.trim()).filter(Boolean)
    if (!parts.length) continue
    const key = keyAlias(parts[parts.length - 1])
    const mods = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()))
    const wantsCtrl = mods.has("ctrl") || mods.has("cmd") || mods.has("command") || mods.has("meta")
    const wantsAlt = mods.has("alt") || mods.has("option")
    const wantsShift = mods.has("shift")
    if (wantsCtrl !== (event.ctrlKey || event.metaKey)) continue
    if (wantsAlt !== event.altKey) continue
    if (wantsShift !== event.shiftKey) continue
    if (!eventKeys.has(key)) continue
    return true
  }
  return false
}

export function shortcutPrimaryKey(keys: string) {
  for (const alternate of shortcutAlternates(keys)) {
    const parts = alternate.split("+").map((part) => part.trim()).filter(Boolean)
    if (!parts.length) continue
    const modifiers = parts.slice(0, -1).map((part) => part.toLowerCase())
    if (modifiers.some((part) => !["shift"].includes(part))) continue
    return keyAlias(parts[parts.length - 1])
  }
  return null
}
