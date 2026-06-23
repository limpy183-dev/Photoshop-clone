import fs from "node:fs"
import path from "node:path"

import { expect, test } from "@playwright/test"

import {
  COMMAND_REGISTRY,
  commandsForSideEffect,
} from "../components/photoshop/command-registry"
import {
  PURGE_COMMANDS,
  formatPurgeStatus,
  planPurgeTargets,
  estimateCanvasBytes,
} from "../components/photoshop/purge-commands"

test("purge command metadata exposes the Photoshop purge targets", () => {
  expect(PURGE_COMMANDS.map((command) => command.target)).toEqual([
    "undo",
    "clipboard",
    "histories",
    "all",
    "video-cache",
  ])
  expect(PURGE_COMMANDS.map((command) => command.label)).toEqual([
    "Purge Undo",
    "Purge Clipboard",
    "Purge Histories",
    "Purge All",
    "Purge Video Cache",
  ])
  expect(planPurgeTargets("all")).toEqual(["undo", "clipboard", "histories", "video-cache"])
})

test("purge commands are backed by typed registry metadata", () => {
  const purgeRegistryEntries = commandsForSideEffect("purge-cache")

  expect(purgeRegistryEntries.map((command) => command.id)).toEqual(PURGE_COMMANDS.map((command) => command.id))
  expect(purgeRegistryEntries.every((command) => command.group === "Edit")).toBe(true)
  expect(purgeRegistryEntries.map((command) => command.telemetry.action)).toEqual([
    "undo",
    "clipboard",
    "histories",
    "all",
    "video-cache",
  ])
  expect(purgeRegistryEntries.map((command) => command.testMetadata.surfaces)).toEqual(
    PURGE_COMMANDS.map(() => ["menu", "palette"]),
  )
  expect(COMMAND_REGISTRY.some((command) => command.id === "edit-purge-all")).toBe(true)
})

test("purge status reports freed memory with stable units", () => {
  expect(estimateCanvasBytes({ width: 128, height: 64 })).toBe(32_768)
  expect(formatPurgeStatus("clipboard", 32_768)).toBe("Purged Clipboard - freed about 32.0 KB.")
  expect(formatPurgeStatus("undo", 0)).toBe("Purged Undo - no cached memory was available to release.")
})

test("Edit menu and command palette wire purge commands to notifications", () => {
  const menuSource = fs.readFileSync(path.join(process.cwd(), "components/photoshop/menu-bar.tsx"), "utf8")
  const paletteSource = fs.readFileSync(path.join(process.cwd(), "components/photoshop/command-palette.tsx"), "utf8")

  expect(menuSource).toContain("DropdownMenuSubTrigger>Purge")
  expect(menuSource).toContain("PURGE_COMMANDS.map")
  expect(menuSource).toContain("runPurge(command.target)")
  expect(menuSource).toContain("toast.info(formatPurgeStatus(target, result.freedBytes))")

  expect(paletteSource).toContain("PURGE_COMMANDS.map")
  expect(paletteSource).toContain("title: command.label")
  expect(paletteSource).toContain("purgeCaches(target)")
  expect(paletteSource).toContain("toast.info(formatPurgeStatus(target, result.freedBytes))")
})

test("purge implementation integrates histories, tile caches, preview caches, and video cache", () => {
  const contextSource = fs.readFileSync(path.join(process.cwd(), "components/photoshop/editor-context.tsx"), "utf8")
  const psbTileSource = fs.readFileSync(path.join(process.cwd(), "components/photoshop/psb-tile-view.ts"), "utf8")
  const tiledStoreSource = fs.readFileSync(path.join(process.cwd(), "components/photoshop/tiled-backing-store.ts"), "utf8")

  expect(contextSource).toContain('case "purge-undo"')
  expect(contextSource).toContain('case "purge-histories"')
  expect(contextSource).toContain("releaseEntriesBlobs")
  expect(contextSource).toContain("purgeFilterPreviewCache(filterPreviewsRef.current)")
  expect(contextSource).toContain("purgePsbTileViewCaches()")
  expect(contextSource).toContain('case "purge-video-cache"')

  expect(psbTileSource).toContain("purgePsbTileViewCaches")
  expect(tiledStoreSource).toContain("estimateCacheBytes")
  expect(tiledStoreSource).toContain("purgeCache")
})
