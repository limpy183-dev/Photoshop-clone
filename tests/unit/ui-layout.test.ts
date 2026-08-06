import { describe, expect, it } from "vitest"
import {
  DEFAULT_ACCENT_COLOR,
  UI_ELEMENTS,
  applyInterfaceCssVariables,
  interfaceCssVariables,
  normalizeInterfacePreferences,
} from "@/editor/ui-layout"
import { DEFAULT_PREFERENCES, normalizePreferences, parsePreferencesSet } from "@/editor/preferences-engine"

function styleStub() {
  const values = new Map<string, string>()
  return {
    values,
    style: {
      setProperty: (name: string, value: string) => values.set(name, value),
      removeProperty: (name: string) => values.delete(name),
    } as unknown as CSSStyleDeclaration,
  }
}

describe("interface layout preferences", () => {
  it("fills defaults, clamps sizes, and rejects malformed colours", () => {
    const prefs = normalizeInterfacePreferences({
      theme: "neon",
      accentColor: "red",
      canvasBackground: "#AABBCC",
      elements: { menuBar: { visible: false, size: 9999 }, bogus: { visible: false } },
    })

    expect(prefs.theme).toBe("dark")
    expect(prefs.accentColor).toBe(DEFAULT_ACCENT_COLOR)
    expect(prefs.canvasBackground).toBe("#aabbcc")
    expect(prefs.elements.menuBar).toEqual({ visible: false, size: 48 })
    expect(prefs.elements.statusBar).toEqual({ visible: true, size: 24 })
    expect(Object.keys(prefs.elements)).toEqual(UI_ELEMENTS.map((element) => element.id))
  })

  it("emits CSS variables only for values that differ from the stylesheet", () => {
    expect(interfaceCssVariables(undefined)).toEqual({})

    const vars = interfaceCssVariables({
      theme: "medium",
      accentColor: "#ff0000",
      elements: { toolPalette: { visible: true, size: 60 } },
    })
    expect(vars["--ps-tool-palette-width"]).toBe("60px")
    expect(vars["--ps-accent"]).toBe("#ff0000")
    expect(vars["--ps-accent-2"]).toContain("color-mix")
    expect(vars["--ps-chrome"]).toBe("oklch(0.30 0 0)")
    expect(vars["--ps-menu-bar-height"]).toBeUndefined()
  })

  it("clears variables it previously set when a preference returns to its default", () => {
    const root = styleStub()
    applyInterfaceCssVariables({ theme: "darkest", elements: { menuBar: { visible: true, size: 40 } } }, root)
    expect(root.values.get("--ps-menu-bar-height")).toBe("40px")
    expect(root.values.get("--ps-chrome")).toBe("oklch(0.11 0 0)")

    applyInterfaceCssVariables({}, root)
    expect(root.values.size).toBe(0)
  })

  it("round-trips through the preference set parser", () => {
    const saved = normalizePreferences({
      ...DEFAULT_PREFERENCES,
      interface: { theme: "darkest", elements: { statusBar: { visible: false, size: 30 } } },
    })
    const parsed = parsePreferencesSet(JSON.stringify(saved))

    expect(parsed.interface.theme).toBe("darkest")
    expect(parsed.interface.elements.statusBar).toEqual({ visible: false, size: 30 })
  })

  it("rejects an import whose element entry has the wrong shape", () => {
    expect(() => parsePreferencesSet(JSON.stringify({ interface: { elements: { menuBar: { size: "tall" } } } })))
      .toThrow(/interface.elements.menuBar.size must be a number/)
  })
})
