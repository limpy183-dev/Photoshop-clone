import { expect, test } from "@playwright/test"

const commandShortcut = process.platform === "darwin" ? "Meta" : "Control"

test("custom command palette shortcut override controls the runtime handler", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ps-custom-shortcuts", JSON.stringify({ "command-palette": "Ctrl+;" }))
  })

  await page.goto("/editor")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)
  await page.locator("body").click({ position: { x: 20, y: 20 } })

  await page.keyboard.press(`${commandShortcut}+K`)
  await expect(page.getByRole("dialog", { name: "Command Palette" })).toBeHidden()

  await page.keyboard.press(`${commandShortcut}+;`)
  await expect(page.getByRole("dialog", { name: "Command Palette" })).toBeVisible()
})

test("custom combo shortcut override controls image size runtime handler", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ps-custom-shortcuts", JSON.stringify({ "img-imgsize": "Ctrl+Alt+;" }))
  })

  await page.goto("/editor")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)
  await page.locator("body").click({ position: { x: 20, y: 20 } })

  await page.keyboard.press(`${commandShortcut}+Alt+I`)
  await expect(page.getByRole("dialog", { name: "Image Size" })).toBeHidden()

  await page.keyboard.press(`${commandShortcut}+Alt+;`)
  await expect(page.getByRole("dialog", { name: "Image Size" })).toBeVisible()
})

test("edit preferences does not advertise the command palette shortcut", async ({ page }) => {
  await page.goto("/editor")
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click()

  const preferencesItem = page.getByRole("menuitem", { name: /^Preferences/ })
  await expect(preferencesItem).toBeVisible()
  await expect(preferencesItem).not.toContainText("⌘K")
})

test("shift plus a tool shortcut cycles through grouped tools", async ({ page }) => {
  await page.goto("/editor")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)
  await expect(page.getByRole("button", { name: "Brush Tool" })).toBeVisible()

  await page.keyboard.press("Shift+B")
  await expect(page.getByRole("button", { name: "Pencil Tool" })).toBeVisible()

  await page.keyboard.press("Shift+B")
  await expect(page.getByRole("button", { name: "Mixer Brush Tool" })).toBeVisible()
})

test("command palette supports active keyboard navigation, escape, and disabled commands", async ({ page }) => {
  await page.goto("/editor")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)
  await page.locator("body").click({ position: { x: 20, y: 20 } })

  await page.keyboard.press(`${commandShortcut}+K`)
  const search = page.getByPlaceholder("Search tools, filters, panels, and commands")
  await expect(search).toBeVisible()
  await search.fill("Brush Tool")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog", { name: "Command Palette" })).toBeHidden()
  await expect(page.getByRole("button", { name: "Mixer Brush Tool" })).toBeVisible()

  await page.keyboard.press(`${commandShortcut}+K`)
  await expect(search).toBeVisible()
  await search.fill("Reopen Closed Document")
  await expect(page.getByRole("option", { name: /Reopen Closed Document/ })).toBeDisabled()
  await expect(page.getByText("No closed documents")).toBeVisible()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog", { name: "Command Palette" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "Command Palette" })).toBeHidden()
})
