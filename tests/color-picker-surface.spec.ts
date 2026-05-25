import { expect, test } from "@playwright/test"

import {
  buildColorHarmony,
  describePickerColor,
  hsbToRgb,
  normalizeWebColor,
  rgbToHsb,
} from "../components/photoshop/color-picker-model"
import {
  captureSwatchEntry,
  normalizeSwatches,
} from "../components/photoshop/swatches-store"

test("color picker model exposes HSB, RGB, Lab, CMYK, and Web values from one color", () => {
  const described = describePickerColor("#336699")

  expect(described.web).toBe("#336699")
  expect(described.rgb).toEqual({ r: 51, g: 102, b: 153 })
  expect(described.hsb.h).toBeGreaterThan(209)
  expect(described.hsb.h).toBeLessThan(211)
  expect(described.hsb.s).toBe(67)
  expect(described.hsb.b).toBe(60)
  expect(described.lab.l).toBeGreaterThan(40)
  expect(described.cmyk.k).toBe(40)
  expect(normalizeWebColor("369")).toBe("#336699")
  expect(normalizeWebColor("336699")).toBe("#336699")

  const roundTrip = hsbToRgb(rgbToHsb({ r: 51, g: 102, b: 153 }))
  expect(roundTrip.g).toBe(102)
  expect(roundTrip.b).toBe(153)
  expect(Math.abs(roundTrip.r - 51)).toBeLessThanOrEqual(1)
})

test("color picker model builds named harmony swatches around the active color", () => {
  const harmony = buildColorHarmony("#336699", "triadic")

  expect(harmony).toHaveLength(3)
  expect(harmony[0]).toMatchObject({ role: "Base", color: "#336699" })
  expect(harmony.map((swatch) => swatch.role)).toEqual(["Base", "Triad +120", "Triad -120"])
  expect(new Set(harmony.map((swatch) => swatch.color)).size).toBe(3)
})

test("swatch capture normalizes, names, and deduplicates picker swatches", () => {
  const existing = normalizeSwatches(["#336699"])
  const captured = captureSwatchEntry(existing, {
    color: "#336699",
    name: "Steel Blue",
    group: "Harmony",
  })

  expect(captured).toHaveLength(2)
  expect(captured[1]).toEqual({
    color: "#336699",
    name: "Steel Blue",
    group: "Harmony",
  })
  expect(captureSwatchEntry(captured, { color: "#336699", name: "Steel Blue", group: "Harmony" })).toHaveLength(2)
})

test("foreground swatch opens full color picker and captures a swatch", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto("/editor")

  await page.getByRole("button", { name: "Foreground color" }).first().click()
  const dialog = page.getByRole("dialog", { name: "Color Picker" })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("group", { name: "HSB" })).toBeVisible()
  await expect(dialog.getByRole("group", { name: "RGB" })).toBeVisible()
  await expect(dialog.getByRole("group", { name: "Lab" })).toBeVisible()
  await expect(dialog.getByRole("group", { name: "CMYK" })).toBeVisible()

  await dialog.getByLabel("Web color").fill("#336699")
  await dialog.getByRole("button", { name: "Capture swatch" }).click()
  await dialog.getByLabel("Swatch name").fill("Steel Blue")
  await dialog.getByLabel("Swatch group").fill("Harmony")
  await dialog.getByRole("button", { name: "Save swatch" }).click()
  await expect(dialog.getByText("Captured Steel Blue")).toBeVisible()

  const stored = await page.evaluate(() => {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index) ?? ""
      const value = localStorage.getItem(key) ?? ""
      if (key.startsWith("ps-swatches") && value.includes("Steel Blue")) return value
    }
    return ""
  })
  expect(stored).toContain("Steel Blue")
  expect(stored).toContain("Harmony")

  await dialog.getByRole("button", { name: "OK" }).click()
  await expect(page.getByRole("button", { name: "Foreground color" }).first()).toHaveCSS("background-color", "rgb(51, 102, 153)")
})

test("canvas context menu opens an on-canvas HUD color picker", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.goto("/editor")

  await page.locator("[data-canvas-root]").click({ button: "right", position: { x: 340, y: 240 } })
  await page.getByRole("menuitem", { name: "HUD Color Picker" }).click()

  const hud = page.getByRole("dialog", { name: "HUD Color Picker" })
  await expect(hud).toBeVisible()
  await expect(hud.getByLabel("HUD saturation and brightness")).toBeVisible()
  await expect(hud.getByRole("button", { name: "Open full color picker" })).toBeVisible()
  await expect(hud.getByText("Harmony")).toBeVisible()
})
