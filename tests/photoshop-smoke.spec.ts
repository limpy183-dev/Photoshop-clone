import { expect, test } from "@playwright/test"

test("main editor surface renders and command palette can run a tool command", async ({ page }) => {
  await page.goto("/editor")

  await expect(page.getByText("File")).toBeVisible()
  await expect(page.getByRole("button", { name: "Layers", exact: true })).toBeVisible()

  const documentCanvas = page.locator('canvas[role="img"][aria-label^="Document canvas:"]').first()
  await expect(documentCanvas).toBeVisible()
  await expect.poll(async () => {
    return documentCanvas.evaluate((node) => {
      const canvas = node as HTMLCanvasElement
      return canvas.width >= 1000 && canvas.height >= 700
    })
  }).toBe(true)

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await expect(page.getByText("Command Palette")).toBeVisible()
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Brush Tool")
  await page.keyboard.press("Enter")
  await expect(page.getByText("Command Palette")).toBeHidden()
})
