import { expect, test } from "@playwright/test"

test("right dock defaults to pinned essentials and keeps advanced panels in More Panels", async ({ page }) => {
  await page.goto("/editor")

  const dock = page.getByTestId("panel-dock")
  await expect(dock).toHaveAttribute("data-mode", "expanded")
  await expect(dock.getByRole("button", { name: "Layers", exact: true })).toBeVisible()
  await expect(dock.getByRole("button", { name: "Properties", exact: true })).toBeVisible()
  await expect(dock.getByRole("button", { name: "Measurement Log", exact: true })).toHaveCount(0)

  await page.getByRole("button", { name: "More lower panels" }).click()
  await expect(page.getByPlaceholder("Search lower panels")).toBeVisible()
  await page.getByPlaceholder("Search lower panels").fill("Measurement")
  await expect(page.getByRole("button", { name: "Open Measurement Log panel" })).toBeVisible()
})

test("workspace selector applies workspace-specific pinned panel sets", async ({ page }) => {
  await page.goto("/editor")

  await page.getByLabel("Workspace preset").selectOption("painting")

  const dock = page.getByTestId("panel-dock")
  await expect(dock.getByRole("button", { name: "Brush", exact: true })).toBeVisible()
  await expect(dock.getByRole("button", { name: "Tool Setups", exact: true })).toBeVisible()
  await expect(dock.getByRole("button", { name: "Actions", exact: true })).toBeVisible()
  await expect(dock.getByRole("button", { name: "Histogram", exact: true })).toHaveCount(0)

  await page.getByLabel("Workspace preset").selectOption("photography")
  await expect(dock.getByRole("button", { name: "Histogram", exact: true })).toBeVisible()
  await expect(dock.getByRole("button", { name: "Navigator", exact: true })).toBeVisible()
})

test("panel dock supports compact and hidden modes without losing panel access", async ({ page }) => {
  await page.goto("/editor")

  await page.getByRole("button", { name: "Compact panel dock" }).click()
  await expect(page.getByTestId("panel-dock")).toHaveAttribute("data-mode", "compact")
  await expect(page.getByRole("button", { name: "Open Layers panel from rail" })).toBeVisible()

  await page.getByRole("button", { name: "Open Layers panel from rail" }).click()
  await expect(page.getByTestId("panel-dock")).toHaveAttribute("data-mode", "expanded")
  await expect(page.getByRole("button", { name: "Layers", exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Hide panel dock" }).click()
  await expect(page.getByTestId("panel-dock")).toHaveAttribute("data-mode", "hidden")
  await expect(page.getByRole("button", { name: "Show panel dock" })).toBeVisible()

  await page.getByRole("button", { name: "Show panel dock" }).click()
  await expect(page.getByTestId("panel-dock")).toHaveAttribute("data-mode", "expanded")
})

test("users can pin, unpin, and reorder advanced panels", async ({ page }) => {
  await page.goto("/editor")

  await page.getByRole("button", { name: "More lower panels" }).click()
  await page.getByPlaceholder("Search lower panels").fill("Scripting")
  await page.getByRole("button", { name: "Pin Scripting panel" }).click()
  await expect(page.getByRole("button", { name: "Scripting", exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Scripting", exact: true }).click()
  await page.getByRole("button", { name: "Move active lower panel left" }).click()
  await expect(page.getByRole("button", { name: "Scripting", exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Close panel browser" }).click()
  await page.getByRole("button", { name: "Unpin Scripting panel" }).click()
  await expect(page.getByRole("button", { name: "Scripting", exact: true })).toHaveCount(0)
})
