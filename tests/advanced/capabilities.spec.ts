import { expect, test, type Page } from "@playwright/test"

async function openCommand(page: Page, query: string) {
  await page.locator("body").click({ position: { x: 20, y: 20 } })
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await expect(page.getByPlaceholder("Search tools, filters, panels, and commands")).toBeVisible()
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill(query)
  await page.keyboard.press("Enter")
}

test("advanced capabilities label local browser-native limits instead of native Adobe integrations", async ({ page }) => {
  await page.goto("/editor")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)

  await openCommand(page, "RAW, DNG, DICOM, EXR, HDR, PSB, and Metadata")
  await expect(page.getByRole("dialog", { name: "Advanced Photoshop Subsystems" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Format Capability Matrix" })).toBeVisible()
  await expect(page.getByTestId("format-openexr")).toContainText(/Decoder-backed/)
  await expect(page.getByTestId("format-psb")).toContainText(/Browser-limited/)
  await page.keyboard.press("Escape")

  await openCommand(page, "Plugin Manager")
  await expect(page.getByRole("dialog", { name: "Advanced Photoshop Subsystems" })).toBeVisible()
  await expect(page.getByText(/Browser-safe UXP and CEP adapters are available/)).toBeVisible()
  await expect(page.getByText(/Native 8BF binaries import as metadata/)).toBeVisible()
  await page.keyboard.press("Escape")

  await openCommand(page, "Creative Cloud Libraries, Stock, and Fonts")
  await expect(page.getByRole("dialog", { name: "Advanced Photoshop Subsystems" })).toBeVisible()
  await expect(page.getByText(/Project-local library records only/)).toBeVisible()
  await page.keyboard.press("Escape")

  await openCommand(page, "Content Credentials")
  await expect(page.getByRole("dialog", { name: "Advanced Photoshop Subsystems" })).toBeVisible()
  await expect(page.getByText(/Embed Metadata exports write unsigned C2PA carrier payloads/)).toBeVisible()
})

test("plugin manager installs marketplace plugins through a permission review flow", async ({ page }) => {
  await page.goto("/editor")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)

  await openCommand(page, "Plugin Manager")
  await expect(page.getByRole("dialog", { name: "Advanced Photoshop Subsystems" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Local Plugin Registry" })).toBeVisible()

  await page.getByRole("button", { name: "Review install for UXP-style Document Helper" }).click()
  await expect(page.getByText("Permission review")).toBeVisible()
  await expect(page.getByText("Document read")).toBeVisible()
  await expect(page.getByText("Host UI")).toBeVisible()

  await page.getByRole("button", { name: "Install reviewed plugin" }).click()
  const installedPlugin = page.getByRole("button", { name: /UXP-style Document Helper/ })
  await expect(installedPlugin).toBeVisible()
  await expect(installedPlugin).toContainText("enabled")

  await page.getByRole("button", { name: "Disable" }).click()
  await expect(installedPlugin).toContainText("disabled")
  await page.getByRole("button", { name: "Enable" }).click()
  await expect(installedPlugin).toContainText("enabled")
})

test("camera raw and preflight expose visible non-native limitations", async ({ page }) => {
  await page.goto("/editor")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)

  await openCommand(page, "Camera Raw Filter")
  await expect(page.getByRole("dialog", { name: "Camera Raw Filter (8-bit RGB)" })).toBeVisible()
  await expect(page.getByText(/Rendered layer pixels only/)).toBeVisible()
  await expect(page.getByText(/RAW demosaic and native camera profiles still require a dedicated RAW engine/)).toBeVisible()
  await page.keyboard.press("Escape")

  await openCommand(page, "Preflight Check")
  await expect(page.getByRole("dialog", { name: "Preflight Check" })).toBeVisible()
  await expect(page.getByText("Browser document audit only. Not a certified prepress or print-provider handoff check.")).toBeVisible()
})

test("mobile matrix smoke opens the editor @matrix-smoke", async ({ page }) => {
  await page.goto("/editor")
  await expect(page.getByText("File")).toBeVisible()
  await expect(page.locator("canvas").first()).toBeVisible()
})
