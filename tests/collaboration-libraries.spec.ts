import { expect, test, type Page } from "@playwright/test"

async function openCommand(page: Page, query: string) {
  await page.locator("body").click({ position: { x: 20, y: 20 } })
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await expect(page.getByPlaceholder("Search tools, filters, panels, and commands")).toBeVisible()
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill(query)
  await page.keyboard.press("Enter")
}

test("comments panel supports threaded open and resolved review states", async ({ page }) => {
  await page.goto("/editor")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)

  await openCommand(page, "Comments Panel")
  await expect(page.getByText("Open threads")).toBeVisible()

  await page.getByLabel("Comment text").fill("Needs crop before export")
  await page.getByRole("button", { name: "Add comment" }).click()
  await expect(page.getByText("Needs crop before export")).toBeVisible()
  await expect(page.getByText("Open 1")).toBeVisible()

  await page.getByLabel("Reply to Needs crop before export", { exact: true }).fill("Crop fixed in the comp.")
  await page.getByRole("button", { name: "Add reply to Needs crop before export" }).click()
  await expect(page.getByText("Crop fixed in the comp.")).toBeVisible()

  await page.getByRole("button", { name: "Resolve Needs crop before export" }).click()
  await expect(page.getByText("Resolved 1")).toBeVisible()
  await expect(page.getByText("Open 0")).toBeVisible()
})

test("libraries panel provides searchable local bundles", async ({ page }) => {
  await page.goto("/editor")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)

  await openCommand(page, "Libraries Panel")
  await page.getByRole("button", { name: "Add Local Library Samples" }).click()
  await expect(page.getByText("Project Brand Kit")).toBeVisible()

  await page.getByPlaceholder("Search local libraries").fill("Brand")
  await expect(page.getByText("Project Brand Kit")).toBeVisible()
  await expect(page.getByText("Editorial Sans")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Export Library Bundle" })).toBeEnabled()
})
