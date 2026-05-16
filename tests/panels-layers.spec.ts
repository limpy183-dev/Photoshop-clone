import { expect, test } from "@playwright/test"

async function openLowerPanel(page: import("@playwright/test").Page, id: string) {
  await page.getByLabel("Lower panel picker").selectOption(id)
}

async function openUpperPanel(page: import("@playwright/test").Page, id: string) {
  await page.getByLabel("Upper panel picker").selectOption(id)
}

test("locked active layer disables destructive layer panel controls", async ({ page }) => {
  await page.goto("/")
  await openLowerPanel(page, "layers")

  await page.getByRole("button", { name: "Lock all" }).click()

  await expect(page.getByRole("button", { name: "Delete layer" })).toBeDisabled()
  await expect(page.getByRole("button", { name: "Move up" })).toBeDisabled()
  await expect(page.locator('input[value="Layer 1"]').first()).toBeDisabled()
})

test("history footer can step backward and forward", async ({ page }) => {
  await page.goto("/")
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
  await page.goto("/")
  await openLowerPanel(page, "layers")

  await page.getByLabel("Layer search").fill("Layer")

  await expect(page.getByText(/visible in list/)).toBeVisible()
  await expect(page.getByText(/Â·/)).toHaveCount(0)
})

test("layer lock controls do not render mojibake glyphs", async ({ page }) => {
  await page.goto("/")
  await openLowerPanel(page, "layers")

  for (const name of ["Lock transparent pixels", "Lock image pixels", "Lock position"]) {
    await expect(page.getByRole("button", { name })).not.toContainText(/[\u00c2\u00c3\u00e2\u00f0]/)
  }
})

test("properties panel layer blend changes are undoable", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("panel-dock").getByRole("button", { name: "Properties", exact: true }).click()

  await page.getByText("Blend", { exact: true }).locator("xpath=..").locator("select").selectOption("multiply")

  await openLowerPanel(page, "history")
  await expect(page.getByText(/2 states/)).toBeVisible()
})
