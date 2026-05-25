/**
 * Menu customization storage and helpers.
 *
 * Photoshop lets users hide menu items, reorder them within their menu, and
 * save those preferences to a workspace preset. This module provides the
 * storage layer and pure helpers; the actual rendering is handled in
 * `menu-bar.tsx` which calls `isMenuItemVisible` / `orderMenuItems` from
 * here before drawing each menu.
 */

export const MENU_CUSTOMIZATION_STORAGE_KEY = "ps-menu-customization"

/**
 * A canonical id like "File/Open" or "Edit/Preferences/General".
 *
 * Items in the menu bar are identified by their slash-separated path. Top
 * level menus ("File", "Edit", "Image", "Layer", "Type", "Select", "Filter",
 * "View", "Window", "Help") plus the path of the item within them.
 *
 * Hidden ids are stored verbatim; the renderer filters them out. Reordered
 * ids store the user's preferred sequence per menu.
 */
export interface MenuCustomization {
  /** Items to suppress from the menu bar entirely. */
  hidden: string[]
  /** Per top-level menu id, the preferred ordered list of child item ids. */
  ordered: Record<string, string[]>
  /** Optional name when saved as part of a workspace preset. */
  presetName?: string
  updatedAt?: number
}

export const DEFAULT_MENU_CUSTOMIZATION: MenuCustomization = {
  hidden: [],
  ordered: {},
}

/* --------------------------- Persistence -------------------------------- */

export function loadMenuCustomization(): MenuCustomization {
  if (typeof window === "undefined") return { ...DEFAULT_MENU_CUSTOMIZATION }
  try {
    const raw = window.localStorage.getItem(MENU_CUSTOMIZATION_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_MENU_CUSTOMIZATION }
    const parsed = JSON.parse(raw)
    return normaliseMenuCustomization(parsed)
  } catch {
    return { ...DEFAULT_MENU_CUSTOMIZATION }
  }
}

export function saveMenuCustomization(value: MenuCustomization): void {
  if (typeof window === "undefined") return
  try {
    const safe = normaliseMenuCustomization({ ...value, updatedAt: Date.now() })
    window.localStorage.setItem(MENU_CUSTOMIZATION_STORAGE_KEY, JSON.stringify(safe))
    window.dispatchEvent(new CustomEvent("ps-menu-customization-changed"))
  } catch {
    // ignore
  }
}

const ID_PATTERN = /^[A-Za-z0-9 _.\-/]{1,200}$/

export function normaliseMenuCustomization(raw: unknown): MenuCustomization {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_MENU_CUSTOMIZATION }
  const rec = raw as Record<string, unknown>
  const hidden = Array.isArray(rec.hidden)
    ? Array.from(new Set(rec.hidden.filter((id): id is string => typeof id === "string" && ID_PATTERN.test(id)))).slice(0, 512)
    : []
  const ordered: Record<string, string[]> = {}
  if (rec.ordered && typeof rec.ordered === "object") {
    for (const [menu, items] of Object.entries(rec.ordered as Record<string, unknown>)) {
      if (!ID_PATTERN.test(menu)) continue
      if (!Array.isArray(items)) continue
      const filtered = items.filter((id): id is string => typeof id === "string" && ID_PATTERN.test(id)).slice(0, 256)
      if (filtered.length) ordered[menu] = Array.from(new Set(filtered))
    }
  }
  return {
    hidden,
    ordered,
    presetName: typeof rec.presetName === "string" ? rec.presetName.slice(0, 80) : undefined,
    updatedAt: typeof rec.updatedAt === "number" ? rec.updatedAt : undefined,
  }
}

/* --------------------------- Helpers ------------------------------------ */

/** Return true if the given id should be drawn. */
export function isMenuItemVisible(id: string, customization: MenuCustomization): boolean {
  return !customization.hidden.includes(id)
}

export function setMenuItemVisible(customization: MenuCustomization, id: string, visible: boolean): MenuCustomization {
  if (!ID_PATTERN.test(id)) return customization
  const hidden = visible
    ? customization.hidden.filter((h) => h !== id)
    : Array.from(new Set([...customization.hidden, id]))
  return { ...customization, hidden }
}

/**
 * Reorder a list of child ids in `menu` so they follow the user's preferred
 * sequence (with any unknown items appended in their original order).
 */
export function orderMenuItems(menu: string, items: string[], customization: MenuCustomization): string[] {
  const preferred = customization.ordered[menu]
  if (!preferred || !preferred.length) return items
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of preferred) {
    if (items.includes(id) && !seen.has(id)) {
      out.push(id)
      seen.add(id)
    }
  }
  for (const id of items) {
    if (!seen.has(id)) {
      out.push(id)
      seen.add(id)
    }
  }
  return out
}

export function setMenuOrder(customization: MenuCustomization, menu: string, items: string[]): MenuCustomization {
  if (!ID_PATTERN.test(menu)) return customization
  const filtered = items.filter((id) => ID_PATTERN.test(id))
  return { ...customization, ordered: { ...customization.ordered, [menu]: filtered } }
}

export function moveMenuItem(customization: MenuCustomization, menu: string, id: string, direction: -1 | 1, defaultItems: string[]): MenuCustomization {
  const current = customization.ordered[menu] ?? defaultItems
  const next = current.slice()
  const idx = next.indexOf(id)
  if (idx === -1) return customization
  const target = idx + direction
  if (target < 0 || target >= next.length) return customization
  const tmp = next[idx]
  next[idx] = next[target]
  next[target] = tmp
  return setMenuOrder(customization, menu, next)
}

export function resetMenuCustomization(): MenuCustomization {
  return { ...DEFAULT_MENU_CUSTOMIZATION, updatedAt: Date.now() }
}

/* --------------------------- Workspace preset integration --------------- */

export interface MenuPreset {
  id: string
  name: string
  customization: MenuCustomization
}

export const MENU_PRESETS_STORAGE_KEY = "ps-menu-presets"

export function loadMenuPresets(): MenuPreset[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(MENU_PRESETS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: MenuPreset[] = []
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue
      const rec = item as Record<string, unknown>
      if (typeof rec.id !== "string" || typeof rec.name !== "string") continue
      out.push({
        id: rec.id.slice(0, 64),
        name: rec.name.slice(0, 80),
        customization: normaliseMenuCustomization(rec.customization),
      })
    }
    return out.slice(0, 32)
  } catch {
    return []
  }
}

export function saveMenuPresets(presets: MenuPreset[]): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(MENU_PRESETS_STORAGE_KEY, JSON.stringify(presets.slice(0, 32)))
  } catch {
    // ignore
  }
}

export function addMenuPreset(presets: MenuPreset[], name: string, customization: MenuCustomization): MenuPreset[] {
  const preset: MenuPreset = {
    id: `menu-${Date.now().toString(36)}`,
    name: name.slice(0, 80),
    customization,
  }
  return [...presets, preset]
}

export function removeMenuPreset(presets: MenuPreset[], id: string): MenuPreset[] {
  return presets.filter((p) => p.id !== id)
}
