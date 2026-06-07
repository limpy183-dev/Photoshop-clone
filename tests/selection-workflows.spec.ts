import { expect, type Page, test } from "@playwright/test"

async function openCommand(page: Page, query: string) {
  await page.locator("body").click({ position: { x: 20, y: 20 } })
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await expect(page.getByPlaceholder("Search tools, filters, panels, and commands")).toBeVisible()
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill(query)
  await page.keyboard.press("Enter")
  await expect(page.getByText("Command Palette")).toBeHidden()
}

async function selectToolFromGroup(page: Page, groupName: string | RegExp, toolName: string) {
  const groupButton = page.getByRole("button", { name: groupName }).first()
  await groupButton.scrollIntoViewIfNeeded()
  const box = await groupButton.boundingBox()
  if (!box) throw new Error(`Toolbar group ${String(groupName)} is not measurable`)
  await page.mouse.click(box.x + box.width - 4, box.y + box.height - 4)
  await page.getByRole("button", { name: new RegExp(`^${toolName}\\b`) }).evaluate((element: HTMLElement) => element.click())
  await expect(groupButton).toHaveAccessibleName(new RegExp(`^${toolName}\\b`))
}

function topMenu(page: Page, name: string) {
  return page
    .locator('[data-slot="dropdown-menu-trigger"], [data-slot="menubar-trigger"]')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .first()
}

async function openTopMenu(page: Page, name: string) {
  await topMenu(page, name).click()
}

async function openEditor(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/editor", { waitUntil: "domcontentloaded" })
  await page.waitForSelector("[data-canvas-stage]", { timeout: 30000 })
  await expect(page.locator("[data-canvas-stage]")).toBeVisible()
}

async function selectAll(page: Page) {
  await openTopMenu(page, "Select")
  await page.getByRole("menuitem", { name: /All/ }).first().click()
}

test("quick selection and magnetic lasso expose full workflow options", async ({ page }) => {
  await openEditor(page)

  await selectToolFromGroup(page, /Object Selection Tool|Quick Selection Tool|Magic Wand Tool/, "Quick Selection Tool")
  await expect(page.getByLabel("Quick selection tolerance")).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Quick selection sample size" })).toBeVisible()
  await expect(page.getByLabel("Contiguous quick selection")).toBeVisible()
  await expect(page.getByLabel("Sample all layers for quick selection")).toBeVisible()
  await expect(page.getByLabel("Quick selection grow and shrink amount")).toBeVisible()
  await expect(page.getByTitle("Grow selection by configured amount")).toBeVisible()
  await expect(page.getByTitle("Shrink selection by configured amount")).toBeVisible()

  await selectToolFromGroup(page, /Lasso Tool|Polygonal Lasso|Magnetic Lasso/, "Magnetic Lasso")
  await expect(page.getByLabel("Magnetic lasso width")).toBeVisible()
  await expect(page.getByLabel("Magnetic lasso contrast")).toBeVisible()
  await expect(page.getByLabel("Magnetic lasso auto-anchor frequency")).toBeVisible()
  await expect(page.getByTestId("magnetic-lasso-indicator")).toContainText("Width")
  await expect(page.getByTestId("magnetic-lasso-indicator")).toContainText("Frequency")
})

test("save and load selection use named channel dialogs", async ({ page }) => {
  await openEditor(page)

  await selectAll(page)

  await openTopMenu(page, "Select")
  await page.getByRole("menuitem", { name: /Save Selection/ }).click()
  await expect(page.getByRole("dialog", { name: "Save Selection" })).toBeVisible()
  await page.getByLabel("Channel name").fill("Foreground Mask")
  await expect(page.getByLabel("Destination channel")).toBeVisible()
  await expect(page.getByLabel("Channel kind")).toBeVisible()
  await page.getByRole("button", { name: "Save" }).click()

  await openCommand(page, "Selection Studio Panel")
  await expect(page.getByText("Foreground Mask")).toBeVisible()

  await openTopMenu(page, "Select")
  await page.getByRole("menuitem", { name: "Load Selection..." }).click({ force: true })
  await expect(page.getByRole("dialog", { name: "Load Selection" })).toBeVisible()
  await expect(page.getByLabel("Source channel")).toContainText("Foreground Mask")
  await expect(page.getByLabel("Load operation")).toBeVisible()
  await expect(page.getByLabel("Invert channel before loading")).toBeVisible()
  await expect(page.getByLabel("Rename selected channel")).toBeVisible()
})

test("grow similar and transform selection are first-class Select menu workflows", async ({ page }) => {
  await openEditor(page)

  await selectAll(page)

  await openTopMenu(page, "Select")
  await expect(page.getByRole("menuitem", { name: "Grow..." })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Transform Selection..." })).toBeVisible()
  await page.getByRole("menuitem", { name: "Transform Selection..." }).click()

  await expect(page.getByTestId("selection-transform-overlay")).toBeVisible()
  await expect(page.getByTestId("selection-transform-mini-options")).toBeVisible()
  await expect(page.getByLabel("Transform X")).toBeVisible()
  await expect(page.getByLabel("Transform Y")).toBeVisible()
  await expect(page.getByLabel("Transform width percent")).toBeVisible()
  await expect(page.getByLabel("Transform height percent")).toBeVisible()
  await expect(page.getByLabel("Transform rotation degrees")).toBeVisible()
  await expect(page.getByLabel("Transform interpolation")).toBeVisible()
  await expect(page.getByTestId("selection-transform-rotation-readout")).toContainText("0")
  await expect(page.getByTestId("selection-transform-snap-feedback")).toContainText(/document|selection|guide|edge/i)

  await page.keyboard.press("ArrowRight")
  await expect(page.getByLabel("Transform X")).toHaveValue("1")
})

test("color range dialog supports targeted range and preview controls", async ({ page }) => {
  await openEditor(page)

  await openTopMenu(page, "Select")
  await page.getByRole("menuitem", { name: /Color Range/ }).click()

  await expect(page.getByRole("dialog", { name: "Color Range" })).toBeVisible()
  await expect(page.getByLabel("Range preset")).toBeVisible()
  await expect(page.getByLabel("Selection preview mode")).toBeVisible()
  await expect(page.getByLabel("Localized Color Clusters")).toBeVisible()
  await expect(page.getByLabel("Invert selection")).toBeVisible()
  await expect(page.getByRole("button", { name: "Add sample" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Subtract sample" })).toBeVisible()
})
