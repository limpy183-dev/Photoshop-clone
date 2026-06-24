import { expect, type Page, test } from "@playwright/test"

function topMenu(page: Page, name: string) {
  return page
    .locator('[data-slot="dropdown-menu-trigger"], [data-slot="menubar-trigger"]')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .first()
}

async function openEditor(page: Page) {
  await page.goto("/editor", { waitUntil: "load" })
  await expect(page.locator("[data-canvas-stage]")).toBeVisible({ timeout: 30000 })
}

async function openTopMenu(page: Page, name: string) {
  const trigger = topMenu(page, name)
  await expect(trigger).toBeVisible()
  await trigger.click()
}

async function hoverMenuItem(page: Page, name: string | RegExp, options?: { exact?: boolean }) {
  const item = page.getByRole("menuitem", { name, exact: options?.exact }).first()
  await expect(item).toBeVisible()
  await item.hover()
}

async function expectCommandEnabled(page: Page, name: string | RegExp) {
  const item = page.getByRole("menuitem", { name }).first()
  await expect(item).toBeVisible()
  await expect(item).not.toHaveAttribute("data-disabled", /.*/)
}

async function openLowerPanel(page: Page, id: string) {
  await page.getByLabel("Lower panel picker").selectOption(id)
}

test("top menu bar switches menus on hover after a menu is open", async ({ page }) => {
  await openEditor(page)

  await openTopMenu(page, "File")
  await expect(page.getByRole("menuitem", { name: /New/ }).first()).toBeVisible()

  await topMenu(page, "Edit").hover()
  await expect(page.getByRole("menuitem", { name: /Content-Aware Fill/ })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: /New/ }).first()).toHaveCount(0)
})

test("arrow submenu commands expand into a usable flyout", async ({ page }) => {
  await openEditor(page)

  await openTopMenu(page, "Edit")
  const parentMenu = page.locator('[data-slot="menubar-content"]').first()
  await expect(parentMenu).toBeVisible()

  await hoverMenuItem(page, "Transform", { exact: true })
  const submenu = page.locator('[data-slot="menubar-sub-content"]').filter({ hasText: "Flip Horizontal" }).first()
  await expect(submenu).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Flip Horizontal" })).toBeVisible()

  const parentBox = await parentMenu.boundingBox()
  const submenuBox = await submenu.boundingBox()
  expect(parentBox).not.toBeNull()
  expect(submenuBox).not.toBeNull()
  expect(submenuBox!.x).toBeGreaterThan(parentBox!.x + parentBox!.width * 0.8)
})

test("selection commands stay reachable and load selection expands even without saved channels", async ({ page }) => {
  await openEditor(page)

  await openTopMenu(page, "Select")
  for (const command of [/Expand/, /Contract/, /Similar/, /Save Selection/]) {
    await expectCommandEnabled(page, command)
  }

  await hoverMenuItem(page, "Modify")
  for (const command of [/Feather/, /Border/, /Smooth/]) {
    await expectCommandEnabled(page, command)
  }

  await page.keyboard.press("Escape")
  await openTopMenu(page, "Select")
  await hoverMenuItem(page, "Load Selection")
  await expect(page.getByRole("menuitem", { name: "No saved channels" })).toBeVisible()
})

test("profile and proof controls are reachable from Image and View menus", async ({ page }) => {
  await openEditor(page)

  await openTopMenu(page, "Image")
  await hoverMenuItem(page, "Mode")
  await expectCommandEnabled(page, "Assign Profile...")
  await expectCommandEnabled(page, "Convert to Profile...")
  await expectCommandEnabled(page, "Color Settings / Proof Setup...")

  await page.getByRole("menuitem", { name: "Assign Profile..." }).click()
  await expect(page.getByRole("dialog", { name: "Advanced Photoshop Subsystems" })).toBeVisible()
  await expect(page.getByRole("button", { name: /^assign$/i })).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("Escape")

  await openTopMenu(page, "Image")
  await hoverMenuItem(page, "Mode")
  await page.getByRole("menuitem", { name: "Convert to Profile..." }).click()
  await expect(page.getByRole("dialog", { name: "Advanced Photoshop Subsystems" })).toBeVisible()
  await expect(page.getByRole("button", { name: /^convert$/i })).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("Escape")

  await page.keyboard.press("Escape")
  await openTopMenu(page, "View")
  await hoverMenuItem(page, "Proof Setup")
  await expectCommandEnabled(page, /Proof Colors/)
  await expectCommandEnabled(page, /Gamut Warning/)
  await expectCommandEnabled(page, "Proof Profile")
  await expectCommandEnabled(page, "Plate Channels")

  await page.keyboard.press("Escape")
  await openTopMenu(page, "Image")
  await hoverMenuItem(page, "Mode")
  await page.getByRole("menuitem", { name: "Color Settings / Proof Setup..." }).click()
  await expect(page.getByRole("dialog", { name: "Advanced Photoshop Subsystems" })).toBeVisible()
  await expect(page.getByRole("button", { name: /^proof$/i })).toHaveAttribute("aria-pressed", "true")
})

test("stateful layer and type commands are clickable instead of greyed out", async ({ page }) => {
  await openEditor(page)

  await openTopMenu(page, "Edit")
  await expectCommandEnabled(page, /Content-Aware Fill/)

  await topMenu(page, "Layer").hover()
  await hoverMenuItem(page, "Layer Style")
  for (const command of ["Copy Layer Style", "Paste Layer Style", "Clear Layer Style"]) {
    await expectCommandEnabled(page, command)
  }

  await page.keyboard.press("Escape")
  await openTopMenu(page, "Layer")
  await hoverMenuItem(page, "Layer Mask")
  for (const command of [/Disable Mask|Enable Mask/, /Refine Mask/, /Apply Mask/, /Delete Mask/]) {
    await expectCommandEnabled(page, command)
  }

  await page.keyboard.press("Escape")
  await openTopMenu(page, "Layer")
  for (const command of ["Edit Smart Object Contents", "Update Parent Smart Object"]) {
    await expectCommandEnabled(page, command)
  }
  await hoverMenuItem(page, "Flatten Transparency", { exact: true })
  await expectCommandEnabled(page, "Background Color")
  await expectCommandEnabled(page, "Preserve Alpha")

  await topMenu(page, "Type").hover()
  for (const command of ["Text Inside Shape", "3D Text Extrusion"]) {
    await expectCommandEnabled(page, command)
  }
})

test("file menu close/reopen commands are clickable from the menu bar", async ({ page }) => {
  await openEditor(page)

  await openTopMenu(page, "File")
  await expectCommandEnabled(page, "Close Others")
  await expectCommandEnabled(page, "Reopen Closed Document")

  await page.getByRole("menuitem", { name: /Duplicate Document/ }).click()
  await expect(page.getByText("Untitled-1 copy")).toBeVisible()

  await openTopMenu(page, "File")
  await page.getByRole("menuitem", { name: "Close Others" }).click()
  await expect(page.getByText("Reopen")).toBeVisible()

  await openTopMenu(page, "File")
  await page.getByRole("menuitem", { name: "Reopen Closed Document" }).click()
  await expect(page.getByText(/Untitled-1 @ 100%/)).toBeVisible()
  await expect(page.getByText(/Untitled-1 copy @ 100%/)).toBeVisible()
})

test("content-aware fill runs from the Edit menu once a selection exists", async ({ page }) => {
  await openEditor(page)

  await openTopMenu(page, "Select")
  await page.getByRole("menuitem", { name: "All \u2318A" }).click()

  await openTopMenu(page, "Edit")
  await page.getByRole("menuitem", { name: /Content-Aware Fill/ }).click()

  await openLowerPanel(page, "history")
  await expect(page.getByText("Content-Aware Fill")).toBeVisible()
})
