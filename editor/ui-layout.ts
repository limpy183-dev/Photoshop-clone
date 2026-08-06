/**
 * Interface layout preferences: which pieces of editor chrome are visible,
 * how big they are, and the colour theme behind them.
 *
 * Sizes are published as CSS custom properties on the document root rather
 * than threaded through props, so a chrome component only has to read the
 * variable it already owns (`style={{ height: "var(--ps-menu-bar-height, 28px)" }}`)
 * and the settings page can preview a change without the editor mounted.
 */

export type UiElementId =
  | "menuBar"
  | "optionsBar"
  | "documentTabs"
  | "toolPalette"
  | "canvasRulers"
  | "statusBar"
  | "panelDock"

export interface UiElementSpec {
  id: UiElementId
  label: string
  description: string
  /** CSS variable the size feeds. `null` when the element has no size knob. */
  sizeVar: string | null
  axis: "height" | "width"
  defaultSize: number
  minSize: number
  maxSize: number
}

/** Defaults match the hard-coded sizes the chrome shipped with. */
export const UI_ELEMENTS: readonly UiElementSpec[] = [
  {
    id: "menuBar",
    label: "Menu Bar",
    description: "Top row with the app badge and the File…Help menus.",
    sizeVar: "--ps-menu-bar-height",
    axis: "height",
    defaultSize: 28,
    minSize: 22,
    maxSize: 48,
  },
  {
    id: "optionsBar",
    label: "Options Bar",
    description: "Per-tool options under the menu bar.",
    sizeVar: "--ps-options-bar-height",
    axis: "height",
    defaultSize: 36,
    minSize: 28,
    maxSize: 64,
  },
  {
    id: "documentTabs",
    label: "Document Tabs",
    description: "Tab strip listing the open documents.",
    sizeVar: "--ps-document-tabs-height",
    axis: "height",
    defaultSize: 28,
    minSize: 22,
    maxSize: 48,
  },
  {
    id: "toolPalette",
    label: "Tools Rail",
    description: "Vertical tool rail on the left edge.",
    sizeVar: "--ps-tool-palette-width",
    axis: "width",
    defaultSize: 44,
    minSize: 36,
    maxSize: 76,
  },
  {
    id: "canvasRulers",
    label: "Canvas Rulers",
    description: "Horizontal and vertical rulers around the canvas. Drag from a ruler to add a guide.",
    sizeVar: null,
    axis: "width",
    defaultSize: 18,
    minSize: 18,
    maxSize: 18,
  },
  {
    id: "statusBar",
    label: "Status Bar",
    description: "Bottom info bar: zoom, document size, active tool.",
    sizeVar: "--ps-status-bar-height",
    axis: "height",
    defaultSize: 24,
    minSize: 20,
    maxSize: 40,
  },
  {
    id: "panelDock",
    label: "Panel Dock",
    description: "Right-hand dock holding Layers, Properties, and the rest of the panels.",
    sizeVar: null,
    axis: "width",
    defaultSize: 380,
    minSize: 340,
    maxSize: 720,
  },
]

export const UI_ELEMENT_BY_ID = UI_ELEMENTS.reduce((byId, element) => {
  byId[element.id] = element
  return byId
}, {} as Record<UiElementId, UiElementSpec>)

export type InterfaceThemeId = "darkest" | "dark" | "medium"

export interface InterfaceTheme {
  id: InterfaceThemeId
  label: string
  /** Empty for `dark` — the stylesheet already ships those values. */
  vars: Record<string, string>
}

export const INTERFACE_THEMES: readonly InterfaceTheme[] = [
  {
    id: "darkest",
    label: "Darkest",
    vars: {
      "--ps-chrome": "oklch(0.11 0 0)",
      "--ps-panel": "oklch(0.15 0 0)",
      "--ps-panel-2": "oklch(0.19 0 0)",
      "--ps-canvas-bg": "oklch(0.24 0 0)",
      "--ps-divider": "oklch(0.08 0 0)",
      "--ps-tool-active": "oklch(0.23 0 0)",
      "--ps-tool-hover": "oklch(0.21 0 0)",
    },
  },
  { id: "dark", label: "Dark", vars: {} },
  {
    id: "medium",
    label: "Medium",
    vars: {
      "--ps-chrome": "oklch(0.30 0 0)",
      "--ps-panel": "oklch(0.36 0 0)",
      "--ps-panel-2": "oklch(0.41 0 0)",
      "--ps-canvas-bg": "oklch(0.47 0 0)",
      "--ps-divider": "oklch(0.24 0 0)",
      "--ps-tool-active": "oklch(0.45 0 0)",
      "--ps-tool-hover": "oklch(0.43 0 0)",
    },
  },
]

/** sRGB equivalent of the stylesheet's `--ps-accent`, so the colour input has something to show. */
export const DEFAULT_ACCENT_COLOR = "#0054ad"

export interface UiElementPreference {
  visible: boolean
  size: number
}

export interface InterfacePreferences {
  theme: InterfaceThemeId
  accentColor: string
  /** Empty string keeps the theme's canvas surround. */
  canvasBackground: string
  elements: Record<UiElementId, UiElementPreference>
}

export const DEFAULT_INTERFACE_PREFERENCES: InterfacePreferences = {
  theme: "dark",
  accentColor: DEFAULT_ACCENT_COLOR,
  canvasBackground: "",
  elements: UI_ELEMENTS.reduce((elements, element) => {
    elements[element.id] = { visible: true, size: element.defaultSize }
    return elements
  }, {} as Record<UiElementId, UiElementPreference>),
}

const THEME_IDS = INTERFACE_THEMES.map((theme) => theme.id)

function hexColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : fallback
}

export function normalizeInterfacePreferences(input: unknown): InterfacePreferences {
  const raw = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>
  const rawElements = (raw.elements && typeof raw.elements === "object" ? raw.elements : {}) as Record<string, unknown>
  return {
    theme: THEME_IDS.includes(raw.theme as InterfaceThemeId) ? (raw.theme as InterfaceThemeId) : "dark",
    accentColor: hexColor(raw.accentColor, DEFAULT_ACCENT_COLOR),
    canvasBackground: raw.canvasBackground === "" ? "" : hexColor(raw.canvasBackground, ""),
    elements: UI_ELEMENTS.reduce((elements, element) => {
      const stored = (rawElements[element.id] ?? {}) as Record<string, unknown>
      const size = typeof stored.size === "number" && Number.isFinite(stored.size) ? stored.size : element.defaultSize
      elements[element.id] = {
        visible: stored.visible !== false,
        size: Math.round(Math.max(element.minSize, Math.min(element.maxSize, size))),
      }
      return elements
    }, {} as Record<UiElementId, UiElementPreference>),
  }
}

/**
 * The CSS custom properties this preference set implies. Only the ones that
 * differ from the stylesheet are returned, so an untouched install renders
 * exactly as it did before the settings page existed.
 */
export function interfaceCssVariables(input: unknown): Record<string, string> {
  const prefs = normalizeInterfacePreferences(input)
  const vars: Record<string, string> = {
    ...(INTERFACE_THEMES.find((theme) => theme.id === prefs.theme)?.vars ?? {}),
  }

  if (prefs.canvasBackground) vars["--ps-canvas-bg"] = prefs.canvasBackground
  if (prefs.accentColor !== DEFAULT_ACCENT_COLOR) {
    vars["--ps-accent"] = prefs.accentColor
    vars["--ps-accent-2"] = `color-mix(in oklab, ${prefs.accentColor} 62%, white)`
  }

  for (const element of UI_ELEMENTS) {
    if (!element.sizeVar) continue
    const size = prefs.elements[element.id].size
    if (size !== element.defaultSize) vars[element.sizeVar] = `${size}px`
  }

  return vars
}

/** All size/theme variables this module can set, so a re-apply can clear stale ones. */
const MANAGED_CSS_VARIABLES = [
  ...new Set([
    ...INTERFACE_THEMES.flatMap((theme) => Object.keys(theme.vars)),
    "--ps-accent",
    "--ps-accent-2",
    "--ps-canvas-bg",
    ...UI_ELEMENTS.map((element) => element.sizeVar).filter((name): name is string => !!name),
  ]),
]

export function applyInterfaceCssVariables(input: unknown, root?: { style: CSSStyleDeclaration }) {
  const target = root ?? (typeof document === "undefined" ? null : document.documentElement)
  if (!target) return
  const vars = interfaceCssVariables(input)
  for (const name of MANAGED_CSS_VARIABLES) {
    if (name in vars) target.style.setProperty(name, vars[name])
    else target.style.removeProperty(name)
  }
}
