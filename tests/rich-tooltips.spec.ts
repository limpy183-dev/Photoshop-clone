import { expect, test } from "@playwright/test"

test("tool palette shows rich animated tooltips with learning links", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ps-preferences", JSON.stringify({ showTooltips: true }))
  })
  await page.goto("/editor")

  const brushTool = page.getByRole("button", { name: "Brush Tool" })
  await brushTool.hover()
  await brushTool.focus()

  const tooltip = page.locator('[data-slot="tooltip-content"]').filter({ hasText: "Brush Tool" }).first()
  await expect(tooltip).toContainText("Brush Tool")
  await expect(tooltip).toContainText("Paint soft-edged strokes with the active foreground color")
  await expect(tooltip.getByTestId("tool-preview-brush").first()).toBeVisible()
  await expect(tooltip.getByText("Hold Shift to cycle related paint tools.").first()).toBeVisible()

  await tooltip.getByRole("button", { name: "Learn Brush Tool in Discover" }).first().click()

  const discoverSearch = page.getByPlaceholder("Search commands, panels, filters, docs, workflows")
  await expect(discoverSearch).toBeVisible()
  await expect(discoverSearch).toHaveValue("brush dynamics")
  await expect(page.getByRole("button", { name: /Brush Tool.*Core/ })).toBeVisible()
})
