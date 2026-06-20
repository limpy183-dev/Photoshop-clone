import { expect, test } from "@playwright/test"

const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFeAJ5kYmN3wAAAABJRU5ErkJggg=="

test("root route renders a Photoshop-style start workspace with presets and learning links", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "New document" })).toBeVisible()
  await expect(page.getByRole("img", { name: "Photoshop web logo" })).toBeVisible()
  await expect(page.getByRole("link", { name: /Create Photo 6 x 4 in/i })).toBeVisible()
  await expect(page.getByRole("link", { name: /Create A4/i })).toBeVisible()
  await expect(page.locator("header").getByRole("link", { name: /Open editor/i })).toHaveAttribute("href", "/editor")
  await expect(page.getByRole("link", { name: /Export Review Report/i })).toBeVisible()
})

test("book navigation opens the standalone documentation guide", async ({ page }) => {
  await page.goto("/")

  const documentationLink = page.getByRole("link", { name: "Documentation" })
  await expect(documentationLink).toHaveAttribute("href", "/documentation")
  await expect(page.getByRole("region", { name: "Documentation" })).toHaveCount(0)

  await documentationLink.click()

  await expect(page).toHaveURL(/\/documentation\/start-workspace$/)
  await expect(page.getByRole("heading", { name: "Start workspace", exact: true })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "Documentation sections" }).getByRole("link", { name: "Editor workspace" })).toHaveAttribute(
    "href",
    "/documentation/editor-workspace",
  )
  const firstFigure = page.getByTestId("documentation-figure").first()
  await expect(firstFigure.getByText("This screenshot shows")).toBeVisible()
  await expect(firstFigure.getByText("How to use it")).toBeVisible()
})

test("documentation exposes every major section as its own page", async ({ page }) => {
  const sections = [
    ["Start workspace", "/documentation/start-workspace"],
    ["Documents and files", "/documentation/documents-files"],
    ["Editor workspace", "/documentation/editor-workspace"],
    ["Tools and panels", "/documentation/tools-panels"],
    ["Selection and masking", "/documentation/selection-masking"],
    ["Adjustments and filters", "/documentation/adjustments-filters"],
    ["Export and reports", "/documentation/export-reports"],
    ["Browser limits", "/documentation/browser-limits"],
    ["Troubleshooting", "/documentation/troubleshooting"],
  ] as const

  await page.goto("/documentation/start-workspace")

  const nav = page.getByRole("navigation", { name: "Documentation sections" })
  for (const [label, href] of sections) {
    await expect(nav.getByRole("link", { name: label })).toHaveAttribute("href", href)
  }

  for (const [label, href] of sections) {
    await page.goto(href)
    await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible()
    await expect(page.getByTestId("documentation-figure").first()).toBeVisible()
  }
})

test("documentation screenshots are explained and visually constrained", async ({ page }) => {
  await page.goto("/documentation/tools-panels")

  const figures = page.getByTestId("documentation-figure")
  await expect(figures).toHaveCount(7)
  await expect(figures.first().getByText("This screenshot shows")).toBeVisible()
  await expect(figures.first().getByText("How to use it")).toBeVisible()
  await expect(figures.first().getByText("Details to check")).toBeVisible()

  const imageHeights = await page.getByTestId("documentation-figure-image").evaluateAll((images) =>
    images.map((image) => image.getBoundingClientRect().height),
  )
  expect(imageHeights.length).toBeGreaterThan(0)
  expect(Math.max(...imageHeights)).toBeLessThanOrEqual(430)
})

test("left rail image button opens a picked image in the editor", async ({ page }) => {
  await page.goto("/")

  const fileChooserPromise = page.waitForEvent("filechooser")
  await page.getByRole("button", { name: "Open image" }).click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles({
    name: "home-import.png",
    mimeType: "image/png",
    buffer: Buffer.from(tinyPng.split(",")[1], "base64"),
  })

  await expect(page).toHaveURL(/\/editor\?startupImport=/)
  await expect(page.getByText("File")).toBeVisible()
  await expect(page.getByText("home-import.png")).toBeVisible()
})

test("preset tiles launch the editor with the selected first-run document", async ({ page }) => {
  await page.goto("/")

  await page.getByRole("link", { name: /Create Photo 6 x 4 in/i }).click()

  await expect(page).toHaveURL(/\/editor\?preset=Photo\+6\+x\+4\+in/)
  await expect(page.getByText("File")).toBeVisible()
  await expect(page.getByText("Photo 6 x 4 in")).toBeVisible()
})

test("start workspace shows pinned files ahead of the recent thumbnail grid", async ({ page }) => {
  await page.addInitScript((thumbnail) => {
    localStorage.setItem(
      "ps-recent-documents-v1",
      JSON.stringify([
        {
          id: "recent_campaign",
          name: "Campaign Hero.psproj",
          kind: "project",
          updatedAt: 1_800_000_000_000,
          serialized: "{}",
          fileName: "Campaign Hero.psproj",
          storage: "snapshot",
          thumbnail,
        },
        {
          id: "recent_retouch",
          name: "Portrait Retouch.psd",
          kind: "psd",
          updatedAt: 1_700_000_000_000,
          serialized: "{}",
          fileName: "Portrait Retouch.psd",
          storage: "snapshot",
          thumbnail,
        },
      ]),
    )
    localStorage.setItem("ps-pinned-documents-v1", JSON.stringify(["recent_campaign"]))
  }, tinyPng)

  await page.goto("/")

  const pinned = page.getByTestId("start-pinned-files")
  await expect(pinned.getByRole("button", { name: /Open Campaign Hero.psproj/i })).toBeVisible()
  await expect(pinned.locator("img[alt='Campaign Hero.psproj thumbnail']")).toBeVisible()

  const recentGrid = page.getByTestId("start-recent-grid")
  await expect(recentGrid.getByRole("button", { name: /Open Campaign Hero.psproj/i })).toBeVisible()
  await expect(recentGrid.getByRole("button", { name: /Open Portrait Retouch.psd/i })).toBeVisible()

  await pinned.getByRole("button", { name: /Unpin Campaign Hero.psproj/i }).click()
  await expect(page.getByTestId("start-pinned-empty")).toBeVisible()
  await expect(page.evaluate(() => localStorage.getItem("ps-pinned-documents-v1"))).resolves.toBe("[]")
})
