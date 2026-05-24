import { expect, test } from "@playwright/test"

import { richFixtureDocument } from "./photoshop-fixtures"
import {
  buildShortcutOverrideUpdate,
  shortcutConflictMap,
  type Shortcut,
} from "../components/photoshop/shortcuts"
import {
  rankCommandPaletteItems,
  recordCommandPaletteUsage,
  type CommandUsageMap,
} from "../components/photoshop/command-ranking"
import {
  mergeWorkspaceLibraries,
  normalizeWorkspaceLibrary,
} from "../components/photoshop/workspace-layouts"
import {
  normalizeGradientPresets,
  normalizePatternEntries,
  normalizeSwatchEntries,
} from "../components/photoshop/asset-libraries"
import { createExportCompatibilityManifest } from "../components/photoshop/document-io"

const shortcutFixtures: Shortcut[] = [
  { id: "alpha", keys: "Ctrl+K", action: "Open Alpha", category: "File" },
  { id: "beta", keys: "ctrl+k", action: "Open Beta", category: "File" },
  { id: "gamma", keys: "None", action: "Open Gamma", category: "Edit" },
  { id: "delta", keys: "Ctrl+Shift+K / Ctrl+Alt+K", action: "Open Delta", category: "Edit" },
]

test("shortcut helpers identify alternates and resolve collisions", () => {
  const conflicts = shortcutConflictMap(shortcutFixtures)

  expect(conflicts).toHaveLength(1)
  expect(conflicts[0]).toMatchObject({
    keys: "Ctrl+K",
    shortcutIds: ["alpha", "beta"],
    actions: ["Open Alpha", "Open Beta"],
  })

  const resolved = buildShortcutOverrideUpdate(shortcutFixtures, { alpha: "Ctrl+K" }, "beta", "Ctrl+K", {
    clearConflicts: true,
  })

  expect(resolved).toEqual({ alpha: "None", beta: "Ctrl+K" })
})

test("command ranking prioritizes exact, enabled, and recently used commands", () => {
  const commands = [
    { id: "filter-brush", group: "Filters", title: "Dry Brush", hint: "Artistic" },
    { id: "tool-brush", group: "Tools", title: "Brush Tool", hint: "B" },
    { id: "panel-brush", group: "Panels", title: "Brush Panel", hint: "core" },
    { id: "disabled-brush", group: "Tools", title: "Brush Preset Cleanup", disabled: true },
  ]

  expect(rankCommandPaletteItems(commands, "brush").map((command) => command.id).slice(0, 3)).toEqual([
    "tool-brush",
    "panel-brush",
    "filter-brush",
  ])

  const usage: CommandUsageMap = recordCommandPaletteUsage({}, "panel-brush", 1000)
  const emptyRanked = rankCommandPaletteItems(commands, "", usage, { now: 1000 })
  expect(emptyRanked[0].id).toBe("panel-brush")
  expect(rankCommandPaletteItems(commands, "brush").at(-1)?.id).toBe("disabled-brush")
})

test("workspace imports normalize, dedupe, and merge by name", () => {
  const imported = normalizeWorkspaceLibrary({
    format: "ps-workspaces",
    workspaces: [
      {
        name: "Paint",
        topHeight: 420,
        dockWidth: 390,
        topTab: "brush",
        bottomTab: "layers",
        upperPinned: ["brush", "brush", "color", "__proto__"],
        lowerPinned: ["layers", "history"],
        dockMode: "expanded",
      },
      { name: "", topTab: "missing" },
    ],
  })

  expect(imported).toHaveLength(1)
  expect(imported[0]).toMatchObject({
    name: "Paint",
    topTab: "brush",
    upperPinned: ["brush", "color"],
    lowerPinned: ["layers", "history"],
  })

  const merged = mergeWorkspaceLibraries(
    [{ ...imported[0], name: "paint", dockWidth: 300 }],
    imported,
  )
  expect(merged).toHaveLength(1)
  expect(merged[0].dockWidth).toBe(390)
})

test("asset library imports normalize swatches, gradients, and pattern safety", () => {
  const swatches = normalizeSwatchEntries({
    swatches: ["#ff0000", "#FF0000", { name: "Ink", color: "#111111", group: "Brand" }, "bad"],
  })
  expect(swatches.map((swatch) => swatch.color)).toEqual(["#ff0000", "#111111"])
  expect(swatches[1]).toMatchObject({ name: "Ink", group: "Brand" })

  const gradients = normalizeGradientPresets({
    gradients: [
      {
        name: "Signal",
        stops: [
          { pos: -1, color: "#000000" },
          { pos: 2, color: "#ffffff" },
        ],
      },
    ],
  })
  expect(gradients[0].stops).toEqual([
    { pos: 0, color: "#000000" },
    { pos: 1, color: "#ffffff" },
  ])

  const patterns = normalizePatternEntries({
    patterns: [
      { id: "ok", name: "Tile", dataURL: "data:image/png;base64,AAAA", width: 12, height: 16, group: "Tiles" },
      { id: "bad", name: "Script", dataURL: "javascript:alert(1)", width: 12, height: 16 },
    ],
  })
  expect(patterns).toHaveLength(1)
  expect(patterns[0]).toMatchObject({ id: "ok", name: "Tile", group: "Tiles", width: 12, height: 16 })
})

test("export compatibility manifest summarizes format-specific risk", () => {
  const doc = richFixtureDocument()
  const manifest = createExportCompatibilityManifest(doc, {
    format: "jpeg",
    transparent: true,
    includeMetadata: true,
    quality: 55,
  })

  expect(manifest.document.name).toBe(doc.name)
  expect(manifest.target).toBe("browser-raster")
  expect(manifest.riskLevel).toBe("high")
  expect(manifest.warnings.some((warning) => warning.includes("transparency"))).toBe(true)
  expect(manifest.totals.flattened).toBeGreaterThan(0)
})
