/**
 * Screen mode management: Standard, Full Screen with Menu Bar, Full Screen.
 *
 * Gap #167 from comprehensive-implementation-gaps.txt.
 */

export type ScreenMode = "standard" | "full-screen-with-menu" | "full-screen"

export interface ScreenModeState {
  mode: ScreenMode
  isFullscreenApiActive: boolean
  hideMenuBar: boolean
  hidePanels: boolean
  hideStatusBar: boolean
  hideToolPalette: boolean
  backgroundColor: string
}

export const SCREEN_MODE_CYCLE: ScreenMode[] = [
  "standard",
  "full-screen-with-menu",
  "full-screen",
]

/** Resolve the UI visibility state for a given screen mode. */
export function resolveScreenModeState(mode: ScreenMode): ScreenModeState {
  switch (mode) {
    case "standard":
      return {
        mode,
        isFullscreenApiActive: false,
        hideMenuBar: false,
        hidePanels: false,
        hideStatusBar: false,
        hideToolPalette: false,
        backgroundColor: "var(--ps-canvas-bg, #535353)",
      }
    case "full-screen-with-menu":
      return {
        mode,
        isFullscreenApiActive: true,
        hideMenuBar: false,
        hidePanels: true,
        hideStatusBar: true,
        hideToolPalette: false,
        backgroundColor: "#333333",
      }
    case "full-screen":
      return {
        mode,
        isFullscreenApiActive: true,
        hideMenuBar: true,
        hidePanels: true,
        hideStatusBar: true,
        hideToolPalette: true,
        backgroundColor: "#000000",
      }
  }
}

/** Cycle to the next screen mode in the standard order. */
export function cycleScreenMode(current: ScreenMode): ScreenMode {
  const idx = SCREEN_MODE_CYCLE.indexOf(current)
  return SCREEN_MODE_CYCLE[(idx + 1) % SCREEN_MODE_CYCLE.length]
}

/** Check if the browser Fullscreen API is available. */
export function isFullscreenApiAvailable(): boolean {
  if (typeof document === "undefined") return false
  return !!(
    document.documentElement.requestFullscreen ||
    (document.documentElement as unknown as Record<string, unknown>).webkitRequestFullscreen ||
    (document.documentElement as unknown as Record<string, unknown>).msRequestFullscreen
  )
}

/** Check if the document is currently in fullscreen mode. */
export function isCurrentlyFullscreen(): boolean {
  if (typeof document === "undefined") return false
  return !!(
    document.fullscreenElement ||
    (document as unknown as Record<string, unknown>).webkitFullscreenElement ||
    (document as unknown as Record<string, unknown>).msFullscreenElement
  )
}

/** Enter browser fullscreen using the Fullscreen API. */
export async function enterBrowserFullscreen(): Promise<boolean> {
  if (typeof document === "undefined") return false
  try {
    const el = document.documentElement
    if (el.requestFullscreen) {
      await el.requestFullscreen()
      return true
    }
    const webkit = (el as unknown as Record<string, unknown>).webkitRequestFullscreen
    if (typeof webkit === "function") {
      await (webkit as () => Promise<void>).call(el)
      return true
    }
    const ms = (el as unknown as Record<string, unknown>).msRequestFullscreen
    if (typeof ms === "function") {
      await (ms as () => Promise<void>).call(el)
      return true
    }
  } catch {
    // Fullscreen request denied
  }
  return false
}

/** Exit browser fullscreen. */
export async function exitBrowserFullscreen(): Promise<boolean> {
  if (typeof document === "undefined") return false
  if (!isCurrentlyFullscreen()) return true
  try {
    if (document.exitFullscreen) {
      await document.exitFullscreen()
      return true
    }
    const webkit = (document as unknown as Record<string, unknown>).webkitExitFullscreen
    if (typeof webkit === "function") {
      await (webkit as () => Promise<void>).call(document)
      return true
    }
    const ms = (document as unknown as Record<string, unknown>).msExitFullscreen
    if (typeof ms === "function") {
      await (ms as () => Promise<void>).call(document)
      return true
    }
  } catch {
    // Exit fullscreen failed
  }
  return false
}

/**
 * Apply the given screen mode, entering or exiting browser fullscreen as
 * appropriate. Returns the resolved state.
 */
export async function applyScreenMode(mode: ScreenMode): Promise<ScreenModeState> {
  const state = resolveScreenModeState(mode)
  if (state.isFullscreenApiActive && !isCurrentlyFullscreen()) {
    await enterBrowserFullscreen()
  } else if (!state.isFullscreenApiActive && isCurrentlyFullscreen()) {
    await exitBrowserFullscreen()
  }
  return { ...state, isFullscreenApiActive: isCurrentlyFullscreen() }
}

/** Keyboard shortcut for screen mode cycling. */
export function getScreenModeKeyboardShortcut(): string {
  return "F"
}

/** Human-readable label for each screen mode. */
export function screenModeLabel(mode: ScreenMode): string {
  switch (mode) {
    case "standard":
      return "Standard Screen Mode"
    case "full-screen-with-menu":
      return "Full Screen Mode with Menu Bar"
    case "full-screen":
      return "Full Screen Mode"
  }
}
