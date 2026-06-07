import { expect, test, type Page } from "@playwright/test"

async function openCommand(page: Page, query: string) {
  await page.locator("body").click({ position: { x: 20, y: 20 } })
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await expect(page.getByPlaceholder("Search tools, filters, panels, and commands")).toBeVisible()
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill(query)
  await page.keyboard.press("Enter")
  await expect(page.getByText("Command Palette")).toBeHidden()
}

test("canvas shows an active tool status strip with live brush feedback", async ({ page }) => {
  await page.goto("/editor", { waitUntil: "domcontentloaded" })
  await page.waitForSelector("[data-canvas-stage]", { timeout: 30000 })

  await openCommand(page, "Brush Tool")
  const status = page.getByTestId("active-tool-status-strip")
  await expect(status).toBeVisible()
  await expect(status).toContainText(/Brush/i)
  await expect(status).toContainText(/Size/i)
  await expect(status).toContainText(/Opacity/i)
  await expect(status).toContainText(/Flow/i)
  await expect(page.getByTestId("tool-preview-overlay")).toBeVisible()
  await expect(page.getByTestId("brush-edge-preview")).toHaveAttribute("data-hardness")
})

test("marketing page presents real workflow demos instead of only feature breadth", async ({ page }) => {
  await page.goto("/marketing", { waitUntil: "domcontentloaded" })

  const workflows = page.getByTestId("marketing-workflow-demos")
  await expect(workflows).toBeVisible()
  for (const label of [
    "Remove background",
    "Retouch portrait",
    "Export social image",
    "Prepare print preview",
    "Batch resize with watermark",
    "Open PSD and inspect compatibility",
  ]) {
    await expect(workflows).toContainText(label)
  }
  await expect(workflows).toContainText(/before/i)
  await expect(workflows).toContainText(/after/i)
})
