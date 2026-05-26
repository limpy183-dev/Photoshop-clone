import { expect, type Page, test } from "@playwright/test"

function topMenu(page: Page, name: string) {
  return page
    .locator('[data-slot="dropdown-menu-trigger"], [data-slot="menubar-trigger"]')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .first()
}

async function openAdjustmentDialog(page: Page, menuItem: string, dialogName: string | RegExp) {
  await topMenu(page, "Image").click()
  await page.getByRole("menuitem", { name: "Adjustments" }).hover()
  await page.getByRole("menuitem", { name: new RegExp(menuItem) }).click()
  const dialog = page.getByRole("dialog", { name: dialogName })
  await expect(dialog).toBeVisible()
  return dialog
}

test("custom adjustment dialogs expose editable numeric slider values", async ({ page }) => {
  await page.goto("/editor")
  await expect(topMenu(page, "Image")).toBeVisible()

  let dialog = await openAdjustmentDialog(page, "Shadows/Highlights", "Shadows/Highlights")
  await expect(dialog.getByRole("spinbutton", { name: "Amount value" }).first()).toHaveValue("35")
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()

  dialog = await openAdjustmentDialog(page, "HDR Toning", "HDR Toning")
  await expect(dialog.getByRole("spinbutton", { name: "Radius value" })).toHaveValue("60")
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()

  dialog = await openAdjustmentDialog(page, "Match Color", "Match Color")
  await expect(dialog.getByRole("spinbutton", { name: "Luminance value" })).toHaveValue("100")
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()

  dialog = await openAdjustmentDialog(page, "Replace Color", "Replace Color")
  await expect(dialog.getByRole("spinbutton", { name: "Fuzziness value" })).toHaveValue("40")
})
