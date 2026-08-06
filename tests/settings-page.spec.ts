import { expect, test } from "@playwright/test"

const PREFERENCES_KEY = "ps-preferences"

test("settings page hides an interface element and persists it", async ({ page }) => {
  await page.goto("/settings")

  await page.getByRole("button", { name: "Interface & Layout" }).click()
  await expect(page.getByRole("listbox", { name: "Interface elements" })).toBeVisible()

  await page.getByRole("button", { name: "Hide Status Bar" }).click()
  await page.getByRole("button", { name: "Save", exact: true }).click()

  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), PREFERENCES_KEY)
  expect(stored.interface.elements.statusBar.visible).toBe(false)
  expect(stored.interface.elements.menuBar.visible).toBe(true)
})

test("editor honors stored interface visibility and sizes", async ({ page }) => {
  await page.addInitScript(
    ([key, prefs]) => localStorage.setItem(key as string, prefs as string),
    [
      PREFERENCES_KEY,
      JSON.stringify({
        interface: {
          theme: "darkest",
          elements: {
            statusBar: { visible: false, size: 24 },
            menuBar: { visible: true, size: 40 },
          },
        },
      }),
    ],
  )

  await page.goto("/editor")
  await expect(page.getByRole("menubar")).toBeVisible()

  await expect(page.getByTestId("status-bar")).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--ps-menu-bar-height")))
    .toBe("40px")
  // The menubar fills the bar's content box: 40px minus the 1px bottom divider.
  expect((await page.getByRole("menubar").boundingBox())?.height).toBeCloseTo(39, 0)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--ps-chrome")))
    .toBe("oklch(0.11 0 0)")
})
