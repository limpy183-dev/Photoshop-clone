import { expect, test } from "@playwright/test"

const basePath = "/Photoshop-clone"

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "static-chromium", "Static export smoke runs under playwright.static.config.ts")
})

test("static export serves the start workspace with basePath assets", async ({ page }) => {
  await page.goto(`${basePath}/`)

  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Open editor" })).toHaveAttribute("href", /\/Photoshop-clone\/editor\/?$/)
  await expect(page.locator('img[alt="Photoshop web logo"]')).toBeVisible()
})

test("static export marketing page disables backend-dependent forms", async ({ page }) => {
  await page.goto(`${basePath}/marketing/`)

  const staticLabel = page.getByText(/static export/i).first()
  await staticLabel.scrollIntoViewIfNeeded()
  await expect(staticLabel).toBeVisible()
  await expect(page.getByText(/without a subscribe or feedback backend/i)).toBeVisible()
})
