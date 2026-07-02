import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"
import { installRuntimeGuard, assertRuntimeHealthy, waitForEditorReady } from "./support/runtime-guard"

async function expectNoSeriousViolations(
  page: Page,
  options: { forcedColors?: boolean } = {},
) {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"])
  // Axe evaluates author colors, while forced-colors mode replaces those
  // colors with the user's system palette. Keep every structural rule active
  // and omit only the contrast rule that cannot observe the effective palette.
  if (options.forcedColors) builder = builder.disableRules(["color-contrast"])
  const result = await builder.analyze()
  const violations = result.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  )
  expect(
    violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => ({
        target: node.target,
        html: node.html,
        failureSummary: node.failureSummary,
      })),
    })),
  ).toEqual([])
}

for (const route of ["/", "/editor", "/marketing", "/documentation"]) {
  test(`${route} has no serious or critical rendered Axe violations`, async ({ page }) => {
    installRuntimeGuard(page)
    await page.goto(route, { waitUntil: "load" })
    await expect(page.locator("body")).not.toBeEmpty()
    await expectNoSeriousViolations(page)
    assertRuntimeHealthy(page)
  })
}

test("editor dialogs and menus retain keyboard focus and pass Axe", async ({ page }) => {
  installRuntimeGuard(page)
  await page.goto("/editor", { waitUntil: "load" })
  await expect(page.locator("[data-canvas-stage]")).toBeVisible({ timeout: 30_000 })

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  const palette = page.getByRole("dialog", { name: "Command Palette" })
  await expect(palette).toBeVisible()
  await expect(palette.getByPlaceholder(/Search tools/)).toBeFocused()
  await expectNoSeriousViolations(page)
  await page.keyboard.press("Escape")
  await expect(palette).toBeHidden()

  await page.locator("[data-canvas-root]").click({ button: "right", position: { x: 320, y: 220 } })
  const menu = page.getByRole("menu", { name: "Canvas context menu" })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole("menuitem").first()).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(menu.getByRole("menuitem").nth(1)).toBeFocused()
  await expectNoSeriousViolations(page)
  assertRuntimeHealthy(page)
})

test("primary editor workflows are keyboard reachable and restore focus", async ({ page }) => {
  installRuntimeGuard(page)
  await page.goto("/editor", { waitUntil: "load" })
  await waitForEditorReady(page)

  const fileMenu = page.getByRole("menuitem", { name: "File" })
  await fileMenu.focus()
  await page.keyboard.press(process.platform === "darwin" ? "Meta+N" : "Control+N")
  const newDocument = page.getByRole("dialog", { name: "New Document" })
  await expect(newDocument).toBeVisible()
  await expectNoSeriousViolations(page)
  await page.keyboard.press("Escape")
  await expect(newDocument).toBeHidden()
  await expect(fileMenu).toBeFocused()

  await fileMenu.press("Enter")
  await expect(page.getByRole("menu")).toBeVisible()
  await page.keyboard.press("ArrowDown")
  await expectNoSeriousViolations(page)
  await page.keyboard.press("Escape")

  const panelsButton = page.getByRole("button", { name: "Panels", exact: true })
  await panelsButton.focus()
  await panelsButton.press("Enter")
  const panelSearch = page.getByPlaceholder("Search all panels")
  await expect(panelSearch).toBeFocused()
  await expectNoSeriousViolations(page)
  await page.keyboard.press("Tab")
  const closePanelBrowser = page.getByRole("button", { name: "Close all panels browser" })
  await expect(closePanelBrowser).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(panelSearch).toBeHidden()

  await page.locator("[data-canvas-root]").click({ button: "right", position: { x: 320, y: 220 } })
  await page.getByRole("menuitem", { name: "Export As..." }).click()
  const exportDialog = page.getByRole("dialog", { name: "Export As" })
  await expect(exportDialog).toBeVisible()
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  )
  await expectNoSeriousViolations(page)
  await page.keyboard.press("Escape")
  await expect(exportDialog).toBeHidden()
  assertRuntimeHealthy(page)
})

test("editor remains accessible at 200 percent zoom with user media preferences", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" })
  await page.goto("/editor", { waitUntil: "load" })
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2"
  })
  await expect(page.locator("main")).toBeVisible()
  await expectNoSeriousViolations(page, { forcedColors: true })
})

test.describe("mobile touch accessibility", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("primary controls meet the WCAG minimum touch target", async ({ page }) => {
    await page.goto("/editor", { waitUntil: "load" })
    const controls = [
      page.getByRole("menuitem", { name: "File" }),
      page.getByRole("button", { name: "Move Tool" }),
      page.getByRole("button", { name: "Brush Tool" }),
    ]
    for (const control of controls) {
      await expect(control).toBeVisible()
      const box = await control.boundingBox()
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(24)
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(24)
    }
    await expectNoSeriousViolations(page)
  })
})
