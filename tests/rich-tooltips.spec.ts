import { expect, test } from "@playwright/test"

test("tool palette shows rich animated tooltips with learning links", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ps-preferences", JSON.stringify({ showTooltips: true }))
  })
  await page.goto("/")

  const brushTool = page.getByRole("button", { name: "Brush Tool" })
  await brushTool.hover()
  await brushTool.focus()

  const tooltip = page.locator('[data-slot="tooltip-content"]')
  await expect(tooltip).toContainText("Brush Tool")
  await expect(tooltip).toContainText("Paint soft-edged strokes with the active foreground color")
  await expect(tooltip.getByTestId("tool-preview-brush")).toBeVisible()
  await expect(tooltip.getByText("Hold Shift to cycle related paint tools.")).toBeVisible()

  await tooltip.getByRole("button", { name: "Learn Brush Tool in Discover" }).click()

  await expect(page.getByPlaceholder("Search tools, commands, docs, panels, workflows")).toBeVisible()
  await expect(page.getByPlaceholder("Search tools, commands, docs, panels, workflows")).toHaveValue("brush dynamics")
  await expect(page.getByRole("button", { name: /Brush Tool - tool - Core/ })).toBeVisible()
})
