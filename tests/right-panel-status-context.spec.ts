import { expect, test } from "@playwright/test"

test("Panels header opens the all-panels browser instead of relying on the stack dots", async ({ page }) => {
  await page.goto("/editor")

  await page.getByRole("button", { name: "Panels", exact: true }).click()
  await expect(page.getByPlaceholder("Search all panels")).toBeVisible()
  await page.getByPlaceholder("Search all panels").fill("Scripting")
  await expect(page.getByRole("button", { name: "Open Scripting panel" })).toBeVisible()
})

test("lower panel splitter snaps to maximum and minimum layer heights", async ({ page }) => {
  await page.goto("/editor")

  const splitter = page.getByLabel("Resize panel stack")
  const dock = page.getByTestId("panel-dock")
  const box = await splitter.boundingBox()
  const dockBox = await dock.boundingBox()
  expect(box).not.toBeNull()
  expect(dockBox).not.toBeNull()

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(dockBox!.x + 160, dockBox!.y + 54, { steps: 8 })
  await page.mouse.up()
  await expect(dock).toHaveAttribute("data-split", "layers-max")
  await expect(page.getByText("Layers max")).toBeVisible()

  const nextBox = await splitter.boundingBox()
  expect(nextBox).not.toBeNull()
  await page.mouse.move(nextBox!.x + nextBox!.width / 2, nextBox!.y + nextBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(dockBox!.x + 160, dockBox!.y + dockBox!.height - 54, { steps: 12 })
  await page.mouse.up()
  await expect(dock).toHaveAttribute("data-split", "layers-min")
  await expect(page.getByText("Layers min")).toBeVisible()
})

test("status info bar can be hidden and restored from View menu", async ({ page }) => {
  await page.goto("/editor")

  await expect(page.getByTestId("status-bar")).toBeVisible()
  await page.getByRole("button", { name: "Hide info bar" }).click()
  await expect(page.getByTestId("status-bar")).toHaveCount(0)

  await page.getByRole("menuitem", { name: "View", exact: true }).click()
  await page.getByRole("menuitem", { name: /Show Info Bar/ }).click()
  await expect(page.getByTestId("status-bar")).toBeVisible()
})

test("browser canvas GPU and memory diagnostics live in the lower diagnostics panel", async ({ page }) => {
  await page.goto("/editor")

  await expect(page.getByTestId("status-bar").getByTestId("browser-diagnostics")).toHaveCount(0)
  await page.getByLabel("Lower panel picker").selectOption({ label: "Browser Diagnostics" })
  const diagnostics = page.getByTestId("browser-diagnostics-panel")
  await expect(diagnostics).toBeVisible()
  await expect(diagnostics).toContainText(/Canvas/i)
  await expect(diagnostics).toContainText(/GPU|WebGL/i)
  await expect(diagnostics).toContainText(/Memory|Heap/i)
})

test("upper panels can be hidden so layers take the full dock", async ({ page }) => {
  await page.goto("/editor")

  await page.getByRole("button", { name: "Hide pinned panels section" }).click()
  await expect(page.getByTestId("panel-dock")).toHaveAttribute("data-upper-hidden", "true")
  await expect(page.getByRole("button", { name: "Show pinned panels section" })).toBeVisible()
  await expect(page.getByLabel("Upper panel picker")).toHaveCount(0)
})

test("canvas toolbar is removed and app right click shows a custom context menu", async ({ page }) => {
  await page.goto("/editor")

  await expect(page.getByRole("button", { name: "Move contextual toolbar" })).toHaveCount(0)
  await page.locator("[data-canvas-root]").click({ button: "right", position: { x: 360, y: 260 } })
  await expect(page.getByRole("menu", { name: "Canvas context menu" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Fit on Screen" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Open Layers Panel" })).toBeVisible()
})
