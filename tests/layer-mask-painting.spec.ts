import { expect, type Page, test } from "@playwright/test"

const commandShortcut = process.platform === "darwin" ? "Meta+K" : "Control+K"
const commandSearchPlaceholder = "Search tools, filters, panels, and commands"

async function openEditor(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/editor", { waitUntil: "load" })
  await expect(page.locator("[data-canvas-stage]")).toBeVisible({ timeout: 30000 })
  await page.getByLabel("Lower panel picker").selectOption("layers")
}

async function selectBrushTool(page: Page) {
  const search = page.getByPlaceholder(commandSearchPlaceholder)
  await page.locator("body").click({ position: { x: 20, y: 20 } })
  for (let attempt = 0; attempt < 2 && !(await search.isVisible().catch(() => false)); attempt++) {
    await page.keyboard.press(commandShortcut)
    try {
      await expect(search).toBeVisible({ timeout: 5000 })
    } catch {
      continue
    }
  }
  await search.fill("Brush Tool")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog", { name: "Command Palette" })).toBeHidden()
}

async function stroke(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const box = await page.locator("[data-canvas-stage]").boundingBox()
  if (!box) throw new Error("Canvas stage is not measurable")
  await page.mouse.move(box.x + from.x, box.y + from.y)
  await page.mouse.down()
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 })
  await page.mouse.up()
}

async function darkPixels(page: Page, x: number, y: number, w: number, h: number) {
  return page.evaluate(
    ({ x: px, y: py, w: pw, h: ph }) => {
      const canvas = document.querySelector<HTMLCanvasElement>("[data-canvas-stage] canvas")
      if (!canvas) throw new Error("Composite canvas not found")
      const data = canvas.getContext("2d")!.getImageData(px, py, pw, ph).data
      let dark = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0 && data[i] < 90 && data[i + 1] < 90 && data[i + 2] < 90) dark++
      }
      return dark
    },
    { x, y, w, h },
  )
}

// Adding a layer mask used to be inert on a pixel layer: nothing in the panel
// showed it and every paint tool kept writing the layer's own pixels, so there
// was no way to reach the mask at all. The mask thumbnail is the paint target.
test("painting the selected layer mask hides the pixels underneath", async ({ page }) => {
  const region = { x: 100, y: 100, w: 260, h: 160 }
  await openEditor(page)
  await selectBrushTool(page)

  await stroke(page, { x: 140, y: 140 }, { x: 300, y: 210 })
  await expect.poll(() => darkPixels(page, region.x, region.y, region.w, region.h)).toBeGreaterThan(20)

  await page.getByRole("button", { name: "Add layer mask" }).click()
  const maskThumb = page.getByTestId("layer-mask-thumb-Layer 1")
  await expect(maskThumb).toHaveAttribute("data-layer-mask-editing", "true")

  // Black on the mask hides; the white Background layer shows through instead.
  await stroke(page, { x: 140, y: 140 }, { x: 300, y: 210 })
  await expect.poll(() => darkPixels(page, region.x, region.y, region.w, region.h)).toBe(0)

  // Clicking the thumbnail again hands the brush back to the layer's pixels.
  await maskThumb.click()
  await expect(maskThumb).toHaveAttribute("data-layer-mask-editing", "false")
})
