import { expect, test } from "@playwright/test"

test.describe("@visual editor visual regression snapshots", () => {
  test.describe.configure({ timeout: 60_000 })

  test("home page hero remains stable", async ({ page }) => {
    await page.goto("/")
    await page.addStyleTag({
      content: "*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;scroll-behavior:auto!important}",
    })
    await expect(page).toHaveScreenshot("home-page.png", {
      fullPage: true,
      animations: "disabled",
      maxDiffPixelRatio: 0.02,
    })
  })

  test("editor shell remains stable", async ({ page }) => {
    await page.goto("/editor")
    await page.addStyleTag({
      content: "*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;scroll-behavior:auto!important}",
    })
    await expect(page.getByText("File").first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText("Panels").first()).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(300)
    await expect(page).toHaveScreenshot("editor-shell.png", {
      fullPage: true,
      animations: "disabled",
      maxDiffPixelRatio: 0.02,
    })
  })
})
