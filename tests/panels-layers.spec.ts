import { expect, test } from "@playwright/test"

async function openLowerPanel(page: import("@playwright/test").Page, id: string) {
  await page.getByLabel("Lower panel picker").selectOption(id)
}

async function _openUpperPanel(page: import("@playwright/test").Page, id: string) {
  await page.getByLabel("Upper panel picker").selectOption(id)
}

test("locked active layer disables destructive layer panel controls", async ({ page }) => {
  await page.goto("/editor")
  await openLowerPanel(page, "layers")

  await page.getByRole("button", { name: "Lock all" }).click()

  await expect(page.getByRole("button", { name: "Delete layer" })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Move up" })).toBeDisabled()
  await expect(page.locator('input[value="Layer 1"]').first()).toBeDisabled()
})

test("history footer can step backward and forward", async ({ page }) => {
  await page.goto("/editor")
  await openLowerPanel(page, "layers")

  await page.getByRole("button", { name: "New layer" }).click()

  await openLowerPanel(page, "history")
  await expect(page.getByText(/2 states/)).toBeVisible()
  await page.getByRole("button", { name: "Step backward" }).click()

  await expect(page.getByRole("button", { name: "Step forward" })).toBeEnabled()
  await page.getByRole("button", { name: "Step forward" }).click()
  await openLowerPanel(page, "layers")
  await expect(page.locator('input[value="Layer 2"]').first()).toBeVisible()
})

test("layer filter summary does not render mojibake separators", async ({ page }) => {
  await page.goto("/editor")
  await openLowerPanel(page, "layers")

  await page.getByLabel("Layer search").fill("Layer")

  await expect(page.getByText(/visible in list/)).toBeVisible()
  await expect(page.getByText(/Â·/)).toHaveCount(0)
})

test("layer lock controls do not render mojibake glyphs", async ({ page }) => {
  await page.goto("/editor")
  await openLowerPanel(page, "layers")

  for (const name of ["Lock transparent pixels", "Lock image pixels", "Lock position"]) {
    await expect(page.getByRole("button", { name })).not.toContainText(/[\u00c2\u00c3\u00e2\u00f0]/)
  }
})

test("properties panel layer blend changes are undoable", async ({ page }) => {
  await page.goto("/editor")
  await page.getByTestId("panel-dock").getByRole("button", { name: "Properties", exact: true }).click()

  await page.getByText("Blend", { exact: true }).locator("xpath=..").locator("select").selectOption("multiply")

  await openLowerPanel(page, "history")
  await expect(page.getByText(/2 states/)).toBeVisible()
})

test("layers panel exposes production presets, batch actions, and health warnings", async ({ page }) => {
  await page.goto("/editor", { waitUntil: "domcontentloaded" })
  await page.waitForSelector("[data-canvas-stage]", { timeout: 30000 })
  await openLowerPanel(page, "layers")

  for (const preset of ["Visible only", "Has mask", "Has effects", "Smart object", "Adjustment", "Locked", "Empty"]) {
    // exact: the "Adjustment" preset would otherwise substring-match the
    // "Adjustments" panel tab and the "Adjustment layer" footer trigger.
    await expect(page.getByRole("button", { name: preset, exact: true })).toBeVisible()
  }

  await expect(page.getByTestId("layer-health-summary")).toBeVisible()
  await expect(page.locator('[data-testid^="layer-health-warning-"]').first()).toBeVisible()

  await page.getByRole("button", { name: "New layer" }).click()
  await page.getByRole("button", { name: "Batch layer operations" }).click()
  await expect(page.getByRole("menuitem", { name: "Rename Selected..." })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Color Label Selected" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Convert Selected to Smart Object" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Export Selected Layers" })).toBeVisible()
  await page.getByRole("menuitem", { name: "Convert Selected to Smart Object" }).click()

  await expect(page.getByTestId("layer-row-Layer 2")).toContainText("Smart")
})
