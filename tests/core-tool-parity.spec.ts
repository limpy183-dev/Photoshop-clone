import { expect, type Page, test } from "@playwright/test"

async function runToolCommand(page: Page, query: string) {
  await page.locator("body").click({ position: { x: 20, y: 20 } })
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  const search = page.getByPlaceholder("Search tools, filters, panels, and commands")
  await expect(search).toBeVisible()
  await search.fill(query)
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog", { name: "Command Palette" })).toBeHidden()
}

test("missing Photoshop toolbar tools are first-class command palette tools", async ({ page }) => {
  await page.goto("/editor")
  await expect(page.locator("[data-canvas-stage]")).toBeVisible()

  const tools = [
    "Quick Selection Tool",
    "Slice Select Tool",
    "Freeform Pen Tool",
    "Add Anchor Point Tool",
    "Delete Anchor Point Tool",
    "Convert Point Tool",
    "Vertical Type Tool",
    "Rounded Rectangle Tool",
    "Polygon Tool",
    "Triangle Tool",
  ]

  for (const toolName of tools) {
    await runToolCommand(page, toolName)
    await expect(page.getByRole("button", { name: new RegExp(`^${toolName}\\b`) })).toBeVisible()
  }
})
