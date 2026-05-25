import { expect, test } from "@playwright/test"

test("unified preset manager opens as one cross-family panel", async ({ page }) => {
  const baseURL = process.env.PRESET_MANAGER_BASE_URL ?? "http://127.0.0.1:3000/"
  await page.goto(new URL("/editor", baseURL).toString())

  await page.getByRole("button", { name: "More upper panels" }).click()
  await page.getByPlaceholder("Search upper panels").fill("Preset Manager")
  await page.getByRole("button", { name: "Open Preset Manager panel" }).click()

  await expect(page.getByLabel("Preset manager search")).toBeVisible()
  await expect(page.getByLabel("Preset family")).toBeVisible()
  await expect(page.getByLabel("Preset set")).toBeVisible()
  await expect(page.getByRole("button", { name: "Import preset library" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Export visible presets" })).toBeVisible()

  await page.getByLabel("Preset family").selectOption("brush")
  await expect(page.getByText("Brushes", { exact: true })).toBeVisible()
  await expect(page.getByText(/preset/i).first()).toBeVisible()
})
