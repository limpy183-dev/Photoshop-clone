import { expect, type Page, test } from "@playwright/test"

function topMenu(page: Page, name: string) {
  return page
    .locator('[data-slot="dropdown-menu-trigger"], [data-slot="menubar-trigger"]')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .first()
}

async function openTopMenu(page: Page, name: string) {
  await topMenu(page, name).click()
}

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
)

test("contact sheet dialog imports images, previews picture packages, and exports the composite", async ({ page }) => {
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)

  await openTopMenu(page, "File")
  const fileMenu = page.locator('[data-slot="menubar-content"]').filter({ hasText: "Contact Sheet II" }).first()
  await expect(fileMenu).toBeVisible()
  await fileMenu.getByText("Contact Sheet II").click()

  const dialog = page.getByTestId("contact-sheet-dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText("Drop images or choose files")).toBeVisible()

  await page.getByTestId("contact-sheet-file-input").setInputFiles([
    { name: "beta.png", mimeType: "image/png", buffer: png1x1 },
    { name: "alpha.png", mimeType: "image/png", buffer: png1x1 },
  ])

  await expect(dialog.getByText("2 images imported")).toBeVisible()
  await expect(dialog.locator('canvas[aria-label="Contact sheet preview"]')).toBeVisible()

  await dialog.getByRole("tab", { name: /Picture Package/ }).click()
  await expect(dialog.getByRole("button", { name: "Export" })).toBeEnabled()

  const downloadPromise = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Export" }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe("picture-package.png")
})
