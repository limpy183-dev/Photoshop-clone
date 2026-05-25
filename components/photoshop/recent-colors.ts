// Recent picker colors persisted in localStorage.
//
// We deliberately keep this outside `PhotoshopPreferences` (which has a schema
// version and a heavy normalize/migration surface) — the list is a small,
// disposable convenience: most-recently-used at index 0, capped at MAX_RECENT,
// and identical colors collapse instead of duplicating.

export const RECENT_COLORS_STORAGE_KEY = "ps-recent-colors"
export const RECENT_COLORS_UPDATED_EVENT = "ps-recent-colors-updated"
export const MAX_RECENT_COLORS = 24

const HEX_RE = /^#[0-9a-f]{6}$/i

function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim().toLowerCase()
  if (HEX_RE.test(trimmed)) return trimmed
  return null
}

export function normalizeRecentColors(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of input) {
    const hex = normalizeHex(item)
    if (!hex) continue
    if (seen.has(hex)) continue
    seen.add(hex)
    out.push(hex)
    if (out.length >= MAX_RECENT_COLORS) break
  }
  return out
}

export function loadRecentColors(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(RECENT_COLORS_STORAGE_KEY)
    if (!raw) return []
    return normalizeRecentColors(JSON.parse(raw))
  } catch {
    return []
  }
}

export function saveRecentColors(colors: string[]): string[] {
  const next = normalizeRecentColors(colors)
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(RECENT_COLORS_STORAGE_KEY, JSON.stringify(next))
      window.dispatchEvent(new CustomEvent(RECENT_COLORS_UPDATED_EVENT, { detail: next }))
    } catch {
      // Ignore quota / blocked storage — recents are a convenience only.
    }
  }
  return next
}

export function pushRecentColor(color: string, current?: string[]): string[] {
  const hex = normalizeHex(color)
  if (!hex) return current ?? loadRecentColors()
  const list = current ?? loadRecentColors()
  const filtered = list.filter((entry) => entry !== hex)
  filtered.unshift(hex)
  return saveRecentColors(filtered.slice(0, MAX_RECENT_COLORS))
}

export function clearRecentColors(): string[] {
  return saveRecentColors([])
}
