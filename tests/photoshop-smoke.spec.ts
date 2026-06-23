import { expect, test, type Locator, type Page } from "@playwright/test"

async function openEditor(page: Page) {
  await page.goto("/editor")
  await expect(page.getByRole("menuitem", { name: "File", exact: true })).toBeVisible()
  return page.locator('canvas[role="img"][aria-label^="Document canvas:"]').first()
}

async function expectCanvasGeometry(documentCanvas: Locator) {
  await expect(documentCanvas).toBeVisible()
  await expect.poll(async () => {
    return documentCanvas.evaluate((node) => {
      const canvas = node as HTMLCanvasElement
      const rect = canvas.getBoundingClientRect()
      return canvas.width >= 100 && canvas.height >= 100 && rect.width > 50 && rect.height > 50
    })
  }).toBe(true)
}

test("home start workspace renders @shared", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "New document" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Open editor" })).toBeVisible()
  await expect(page.getByTestId("start-recent-grid")).toBeVisible()
})

test("editor route renders with nonzero canvas geometry @shared", async ({ page }) => {
  const documentCanvas = await openEditor(page)
  await expectCanvasGeometry(documentCanvas)
})

test("command palette runs a representative tool command @desktop", async ({ page }) => {
  await openEditor(page)
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await expect(page.getByText("Command Palette")).toBeVisible()
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Brush Tool")
  await page.keyboard.press("Enter")
  await expect(page.getByText("Command Palette")).toBeHidden()
  await expect(page.getByRole("button", { name: "Brush Tool" })).toBeVisible()
})

test("menu opens a representative dialog @desktop", async ({ page }) => {
  await openEditor(page)

  await page.getByRole("menuitem", { name: "File", exact: true }).click()
  await page.getByRole("menuitem", { name: /New/ }).click()
  await expect(page.getByRole("dialog", { name: "New Document" })).toBeVisible()
})

test("panel dock opens a representative panel @desktop", async ({ page }) => {
  await openEditor(page)

  await expect(page.getByTestId("panel-dock")).toBeVisible()
  await page.getByRole("button", { name: "Panels", exact: true }).click()
  await expect(page.getByPlaceholder("Search all panels")).toBeVisible()
  await page.getByPlaceholder("Search all panels").fill("Discover")
  await page.getByRole("button", { name: "Open Discover panel" }).click()
  await expect(page.getByRole("button", { name: "Discover", exact: true })).toBeVisible()
})

test("canvas accepts a pointer interaction and keeps the stage alive @desktop", async ({ page }) => {
  const documentCanvas = await openEditor(page)
  await page.getByRole("button", { name: "Brush Tool" }).click()
  await page.locator("[data-canvas-root]").click({ position: { x: 80, y: 80 } })
  await expectCanvasGeometry(documentCanvas)
})

test("mobile editor keeps a nonzero canvas area @mobile", async ({ page }) => {
  const documentCanvas = await openEditor(page)
  await expectCanvasGeometry(documentCanvas)
})
