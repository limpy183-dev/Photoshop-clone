import { expect, type Page, test } from "@playwright/test"

function topMenu(page: Page, name: string) {
  return page
    .locator('[data-slot="dropdown-menu-trigger"], [data-slot="menubar-trigger"]')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .first()
}

async function clickTopMenuItem(page: Page, menu: string, item: string | RegExp) {
  const itemLocator = page.getByRole("menuitem", { name: item }).first()
  for (let attempt = 0; attempt < 4; attempt++) {
    await topMenu(page, menu).click()
    try {
      await itemLocator.click({ timeout: 2500 })
      return
    } catch (error) {
      await page.keyboard.press("Escape").catch(() => {})
      if (attempt === 3) throw error
    }
  }
}

async function ensurePanelDockExpanded(page: Page) {
  const lowerPicker = page.getByLabel("Lower panel picker")
  if (await lowerPicker.count()) return
  const expand = page.getByLabel("Expand panel dock")
  if (await expand.count()) {
    await expand.click()
    await expect(lowerPicker).toBeAttached()
    return
  }
  const show = page.getByLabel("Show panel dock")
  if (await show.count()) {
    await show.click()
    await expect(lowerPicker).toBeAttached()
  }
}

async function openLowerPanel(page: Page, id: string) {
  await ensurePanelDockExpanded(page)
  await page.getByLabel("Lower panel picker").selectOption(id)
}

async function openUpperPanel(page: Page, id: string) {
  await ensurePanelDockExpanded(page)
  const upperPicker = page.getByLabel("Upper panel picker")
  if (!(await upperPicker.count()) || !(await upperPicker.isVisible().catch(() => false))) {
    const showUpper = page.getByLabel("Show pinned panels section")
    if (await showUpper.count()) await showUpper.click()
  }
  await expect(upperPicker).toBeVisible()
  await upperPicker.selectOption(id)
  await expect(upperPicker).toHaveValue(id)
}

async function prepareSmartFilteredLayer(page: Page) {
  await page.goto("/editor", { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("img", { name: /Document canvas:/ })).toBeVisible()

  await clickTopMenuItem(page, "Layer", "Convert to Smart Object")

  await clickTopMenuItem(page, "Filter", /Filter Gallery/)
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

test("smart filters can be reordered by dragging layer panel sub-items", async ({ page }) => {
  await prepareSmartFilteredLayer(page)
  await openLowerPanel(page, "layers")

  const filterRows = page.locator('[data-testid^="layer-smart-filter-row-Layer 1-"]')
  await expect(filterRows.nth(0)).toContainText("Gaussian Blur")
  await expect(filterRows.nth(1)).toContainText("Box Blur")

  await page.getByTestId("layer-smart-filter-row-Layer 1-Box Blur").dragTo(
    page.getByTestId("layer-smart-filter-row-Layer 1-Gaussian Blur"),
  )

  await expect(filterRows.nth(0)).toContainText("Box Blur")
  await expect(filterRows.nth(1)).toContainText("Gaussian Blur")
})

test("right-click smart filter mask edit routes brush strokes to an undoable filter mask", async ({ page }) => {
  await prepareSmartFilteredLayer(page)
  await openLowerPanel(page, "layers")

  await page.getByTestId("layer-smart-filter-row-Layer 1-Gaussian Blur").click({ button: "right" })
  await page.getByRole("menuitem", { name: "Edit Smart Filter Mask" }).click()
  await expect(page.getByTestId("layer-smart-filter-row-Layer 1-Gaussian Blur")).toHaveAttribute("data-smart-filter-mask-editing", "true")
  await expect(page.getByTestId("layer-smart-filter-mask-thumb-Layer 1-Gaussian Blur")).toHaveAttribute("data-smart-filter-mask-state", "revealed")
  await expect(page.getByTestId("smart-filter-mask-edit-banner")).toBeVisible()

  const canvasSurface = page.getByRole("img", { name: /Document canvas:/ })
  const box = await canvasSurface.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + 24, box!.y + box!.height / 2 + 12)
  await page.mouse.up()

  await openLowerPanel(page, "history")
  await expect(page.getByText("Smart Filter Mask", { exact: true })).toBeVisible()
})

test("smart filter mask edit mode is visible on the main canvas", async ({ page }) => {
  await prepareSmartFilteredLayer(page)
  await openLowerPanel(page, "layers")

  await page.getByTestId("layer-smart-filter-row-Layer 1-Gaussian Blur").click({ button: "right" })
  await page.getByRole("menuitem", { name: "Edit Smart Filter Mask" }).click()

  const banner = page.getByTestId("smart-filter-mask-edit-banner")
  await expect(banner).toBeVisible()
  await expect(banner).toContainText("Gaussian Blur")
  await expect(banner).toContainText("Layer 1")
  await expect(banner).toContainText("Density 100%")
  await expect(banner).toContainText("Feather 0 px")

  await page.getByRole("button", { name: "Exit smart filter mask edit mode" }).click()
  await expect(page.getByTestId("layer-smart-filter-row-Layer 1-Gaussian Blur")).toHaveAttribute("data-smart-filter-mask-editing", "false")
})

test("smart filter eye and mask link controls are visible across panels and gallery", async ({ page }) => {
  await prepareSmartFilteredLayer(page)
  await openLowerPanel(page, "layers")

  await page.getByTestId("layer-smart-filter-row-Layer 1-Gaussian Blur").click({ button: "right" })
  await page.getByRole("menuitem", { name: "Edit Smart Filter Mask" }).click()

  const layerRow = page.getByTestId("layer-smart-filter-row-Layer 1-Gaussian Blur")
  const layerMaskThumb = page.getByTestId("layer-smart-filter-mask-thumb-Layer 1-Gaussian Blur")
  await expect(layerRow.getByRole("button", { name: "Disable Gaussian Blur smart filter" })).toBeVisible()
  await expect(layerRow.getByRole("button", { name: "Unlink Gaussian Blur smart filter mask" })).toBeVisible()
  await expect(layerMaskThumb).toHaveAttribute("data-smart-filter-mask-state", "revealed")
  await expect(layerMaskThumb).toHaveAttribute("data-smart-filter-mask-linked", "true")

  await layerRow.getByRole("button", { name: "Unlink Gaussian Blur smart filter mask" }).click()
  await expect(layerMaskThumb).toHaveAttribute("data-smart-filter-mask-linked", "false")

  await openUpperPanel(page, "properties")
  const propertiesRow = page.getByTestId("properties-smart-filter-row-Gaussian Blur")
  await expect(propertiesRow.getByRole("button", { name: "Disable Gaussian Blur smart filter" })).toBeVisible()
  await expect(propertiesRow.getByRole("button", { name: "Link Gaussian Blur smart filter mask" })).toBeVisible()
  await propertiesRow.getByRole("button", { name: "Link Gaussian Blur smart filter mask" }).click()

  await clickTopMenuItem(page, "Filter", /Filter Gallery/)
  const dialog = page.getByRole("dialog", { name: "Filter Gallery" })
  await expect(dialog).toBeVisible()
  const galleryRow = dialog.getByTestId("filter-gallery-stack-row-Gaussian Blur")
  await expect(galleryRow.getByRole("button", { name: "Disable Gaussian Blur smart filter" })).toBeVisible()
  await expect(galleryRow.getByRole("button", { name: "Unlink Gaussian Blur smart filter mask" })).toBeVisible()
})

test("filter gallery presets save load and append combined multi-filter stacks", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.removeItem("ps-filter-gallery-stack-presets-v1"))
  await page.goto("/editor", { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("img", { name: /Document canvas:/ })).toBeVisible()

  await clickTopMenuItem(page, "Layer", "Convert to Smart Object")
  await clickTopMenuItem(page, "Filter", /Filter Gallery/)
  const dialog = page.getByRole("dialog", { name: "Filter Gallery" })
  await expect(dialog).toBeVisible()

  await dialog.getByRole("button", { name: "Box Blur" }).click()
  await dialog.getByRole("button", { name: "Gaussian Blur" }).click()
  await expect(dialog.locator('[data-testid^="filter-gallery-stack-row-"]')).toHaveCount(2)

  await dialog.getByLabel("Filter Gallery preset name").fill("Two blur stack")
  await dialog.getByRole("button", { name: "Save filter stack preset" }).click()
  await dialog.getByRole("button", { name: "Clear filter stack" }).click()
  await expect(dialog.locator('[data-testid^="filter-gallery-stack-row-"]')).toHaveCount(0)

  await dialog.getByLabel("Filter Gallery preset", { exact: true }).selectOption({ label: "Two blur stack" })
  await dialog.getByRole("button", { name: "Load filter stack preset" }).click()
  await expect(dialog.locator('[data-testid^="filter-gallery-stack-row-"]')).toHaveCount(2)

  await dialog.getByLabel("Filter Gallery preset load mode").selectOption("append")
  await dialog.getByRole("button", { name: "Load filter stack preset" }).click()
  await expect(dialog.locator('[data-testid^="filter-gallery-stack-row-"]')).toHaveCount(4)
})
