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

async function openLowerPanel(page: Page, id: string) {
  await page.getByLabel("Lower panel picker").selectOption(id)
}

async function prepareSmartFilteredLayer(page: Page) {
  await page.goto("/")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)

  await openTopMenu(page, "Layer")
  await page.getByRole("menuitem", { name: "Convert to Smart Object" }).click()

  await openTopMenu(page, "Filter")
  await page.getByRole("menuitem", { name: /Filter Gallery/ }).click()
  await expect(page.getByRole("dialog", { name: "Filter Gallery" })).toBeVisible()

  await page.getByRole("button", { name: "Box Blur" }).click()
  await page.getByRole("button", { name: "Gaussian Blur" }).click()

  const boxBlur = page.getByTestId("filter-gallery-stack-row-Box Blur")
  const gaussianBlur = page.getByTestId("filter-gallery-stack-row-Gaussian Blur")
  await gaussianBlur.dragTo(boxBlur)
  await expect(page.locator('[data-testid^="filter-gallery-stack-row-"]').first()).toContainText("Gaussian Blur")

  await page.getByRole("button", { name: "Save Smart Filters" }).click()
}

test("smart filters can be reordered by drag and managed from layer sub-items", async ({ page }) => {
  await prepareSmartFilteredLayer(page)
  await openLowerPanel(page, "layers")

  await expect(page.getByTestId("smart-filter-count-Layer 1")).toHaveText("2")

  const filterRows = page.locator('[data-testid^="layer-smart-filter-row-Layer 1-"]')
  await expect(filterRows).toHaveCount(2)
  await expect(filterRows.nth(0)).toContainText("Gaussian Blur")
  await expect(filterRows.nth(1)).toContainText("Box Blur")

  await page.getByRole("button", { name: "Disable Gaussian Blur smart filter" }).click()
  await expect(page.getByTestId("layer-smart-filter-row-Layer 1-Gaussian Blur")).toHaveAttribute("data-smart-filter-enabled", "false")
})

test("right-click smart filter mask edit routes brush strokes to an undoable filter mask", async ({ page }) => {
  await prepareSmartFilteredLayer(page)
  await openLowerPanel(page, "layers")

  await page.getByTestId("layer-smart-filter-row-Layer 1-Gaussian Blur").click({ button: "right" })
  await page.getByRole("menuitem", { name: "Edit Smart Filter Mask" }).click()
  await expect(page.getByTestId("layer-smart-filter-row-Layer 1-Gaussian Blur")).toHaveAttribute("data-smart-filter-mask-editing", "true")

  const canvas = page.locator("canvas").first()
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + 24, box!.y + box!.height / 2 + 12)
  await page.mouse.up()

  await openLowerPanel(page, "history")
  await expect(page.getByText("Smart Filter Mask", { exact: true })).toBeVisible()
})
