import { expect, test, type Page } from "@playwright/test"

const commandShortcut = process.platform === "darwin" ? "Meta+K" : "Control+K"
const commandSearchPlaceholder = "Search tools, filters, panels, and commands"

async function openEditor(page: Page) {
  await page.goto("/editor", { waitUntil: "load" })
  await expect(page.locator("[data-canvas-stage]")).toBeVisible({ timeout: 30000 })
}

async function openCommand(page: Page, query: string) {
  await expect(page.locator("[data-canvas-stage]")).toBeVisible({ timeout: 30000 })
  const search = page.getByPlaceholder(commandSearchPlaceholder)
  await page.locator("body").click({ position: { x: 20, y: 20 } })

  for (let attempt = 0; attempt < 2 && !(await search.isVisible().catch(() => false)); attempt++) {
    await page.keyboard.press(commandShortcut)
    if (attempt === 0) {
      try {
        await expect(search).toBeVisible({ timeout: 5000 })
      } catch {
        continue
      }
    } else {
      await expect(search).toBeVisible({ timeout: 10000 })
    }
  }

  await search.fill(query)
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog", { name: "Command Palette" })).toBeHidden()
}

test("closing a dirty document prompts before discarding changes", async ({ page }) => {
  await openEditor(page)

  await openCommand(page, "New Layer")
  await expect(page.getByText(/Untitled-1.*\*/)).toBeVisible()

  await page.getByLabel("Close document").first().click()
  await expect(page.getByRole("dialog", { name: /Save changes to Untitled-1/i })).toBeVisible()

  await page.getByRole("button", { name: "Cancel" }).click()
  await expect(page.getByText(/Untitled-1.*\*/)).toBeVisible()
})

test("autosave writes separate recovery entries for open documents", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("ps-autosave-document-v1")
    localStorage.removeItem("ps-autosave-documents-v2")
    localStorage.setItem("ps-preferences", JSON.stringify({ autoSave: true }))
  })

  await openEditor(page)
  await openCommand(page, "Duplicate Document")

  await page.waitForFunction(() => {
    const raw = localStorage.getItem("ps-autosave-documents-v2")
    if (!raw) return false
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) && parsed.length >= 2
    } catch {
      return false
    }
  })

  const names = await page.evaluate(() => {
    const parsed = JSON.parse(localStorage.getItem("ps-autosave-documents-v2") ?? "[]")
    return parsed.map((entry: { name: string; documentId: string }) => `${entry.documentId}:${entry.name}`).sort()
  })
  expect(names.some((name: string) => name.includes("Untitled-1"))).toBe(true)
  expect(names.some((name: string) => name.includes("Untitled-1 copy"))).toBe(true)
})

test("export dialog guards browser-only export limitations", async ({ page }) => {
  await openEditor(page)

  await openCommand(page, "Export As")
  await expect(page.getByRole("dialog", { name: "Export As" })).toBeVisible({ timeout: 30000 })
  await expect(page.getByText(/PNG export limitations/i)).toBeVisible()
  await expect(page.getByText(/Layer structure:/i)).toBeVisible()

  await page.getByRole("button", { name: "SVG", exact: true }).click()
  await expect(page.getByText(/SVG export limitations/i)).toBeVisible()
  // Scope to the limitations block: the same label also appears in the fuller
  // compatibility manifest section below it.
  await expect(page.getByTestId("export-limitations").getByText(/Editable vector structure:/i)).toBeVisible()

  await page.getByRole("button", { name: "WebP", exact: true }).click()
  await expect(page.getByLabel("WebP near-lossless")).toBeVisible()
  await expect(page.getByLabel("WebP method")).toBeVisible()
  await expect(page.getByLabel("Exact alpha")).toBeVisible()

  await page.getByRole("button", { name: "AVIF", exact: true }).click()
  await expect(page.getByLabel("AVIF lossless")).toBeVisible()
  await expect(page.getByLabel("AVIF speed")).toBeVisible()
  await expect(page.getByLabel("AVIF bit depth")).toBeVisible()
  await expect(page.getByLabel("AVIF chroma")).toBeVisible()
  await expect(page.getByLabel("AVIF tile rows")).toBeVisible()
  await expect(page.getByLabel("AVIF tile cols")).toBeVisible()
})

test("export dialog offers task-based decision cards with preservation guidance", async ({ page }) => {
  await openEditor(page)

  await openCommand(page, "Export As")
  await expect(page.getByRole("dialog", { name: "Export As" })).toBeVisible({ timeout: 30000 })

  await expect(page.getByTestId("export-decision-wizard")).toBeVisible()
  await expect(page.getByRole("button", { name: /Best for web/i })).toBeVisible()
  await expect(page.getByRole("button", { name: /Best for this app/i })).toBeVisible()
  await expect(page.getByRole("button", { name: /Photoshop handoff/i })).toBeVisible()
  await expect(page.getByRole("button", { name: /Print preview/i })).toBeVisible()

  await page.getByRole("button", { name: /Photoshop handoff/i }).click()
  await expect(page.getByTestId("export-preserved-list")).toContainText(/metadata|layers/i)
  await expect(page.getByTestId("export-flattened-list")).toContainText(/raster|browser/i)
  await expect(page.getByRole("button", { name: /Run Preflight/i })).toBeVisible()
})

test("file info shows browser-local source location state", async ({ page }) => {
  await openEditor(page)

  await openCommand(page, "File Info")
  await expect(page.getByRole("dialog", { name: "File Info" })).toBeVisible()
  await expect(page.getByText("Document Source")).toBeVisible()
  await expect(page.getByText("Browser Handle")).toBeVisible()
  await expect(page.getByText("No browser file handle")).toBeVisible()
})
