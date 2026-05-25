import { expect, test } from "@playwright/test"

const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFeAJ5kYmN3wAAAABJRU5ErkJggg=="

test("root route renders a Photoshop-style start workspace with presets and learning links", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "New document" })).toBeVisible()
  await expect(page.getByRole("link", { name: /Create Photo 6 x 4 in/i })).toBeVisible()
  await expect(page.getByRole("link", { name: /Create A4/i })).toBeVisible()
  await expect(page.getByRole("link", { name: /Open editor/i })).toHaveAttribute("href", "/editor")
  await expect(page.getByRole("link", { name: /Export Review Report/i })).toBeVisible()
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

  await page.getByRole("button", { name: /Unpin Campaign Hero.psproj/i }).click()
  await expect(page.getByTestId("start-pinned-empty")).toBeVisible()
  await expect(page.evaluate(() => localStorage.getItem("ps-pinned-documents-v1"))).resolves.toBe("[]")
})
