import { expect, type Page, test } from "@playwright/test"

async function openCommand(page: Page, query: string) {
  await page.locator("body").click({ position: { x: 20, y: 20 } })
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await expect(page.getByPlaceholder("Search tools, filters, panels, and commands")).toBeVisible()
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill(query)
  await page.keyboard.press("Enter")
  await expect(page.getByText("Command Palette")).toBeHidden()
}

async function selectToolFromGroup(page: Page, groupName: string | RegExp, toolName: string) {
  const groupButton = page.getByRole("button", { name: groupName }).first()
  await groupButton.scrollIntoViewIfNeeded()
  const box = await groupButton.boundingBox()
  if (!box) throw new Error(`Toolbar group ${String(groupName)} is not measurable`)
  await page.mouse.click(box.x + box.width - 4, box.y + box.height - 4)
  await page.getByRole("button", { name: new RegExp(`^${toolName}\\b`) }).click()
  await expect(groupButton).toHaveAccessibleName(new RegExp(`^${toolName}\\b`))
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
}

async function canvasScreenPoint(page: Page, x: number, y: number) {
  const stage = page.locator("[data-canvas-stage]")
  await expect(stage).toBeVisible()
  const box = await stage.boundingBox()
  if (!box) throw new Error("Canvas stage is not measurable")
  return { x: box.x + x, y: box.y + y }
}

async function dragOnCanvas(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const start = await canvasScreenPoint(page, from.x, from.y)
  const end = await canvasScreenPoint(page, to.x, to.y)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await page.mouse.up()
}

async function clickCanvas(page: Page, point: { x: number; y: number }) {
  const screenPoint = await canvasScreenPoint(page, point.x, point.y)
  await page.mouse.click(screenPoint.x, screenPoint.y)
}

test("canvas creation tools commit useful document state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await expect(page.locator("[data-canvas-stage]")).toBeVisible()

  await selectToolFromGroup(page, /Rectangle Tool|Custom Shape Tool/, "Custom Shape Tool")
  await dragOnCanvas(page, { x: 120, y: 120 }, { x: 230, y: 220 })
  await expect(page.locator('input[value="Custom Shape"]')).toBeVisible()

  await selectToolFromGroup(page, /Crop Tool|Frame Tool|Slice Tool/, "Frame Tool")
  await dragOnCanvas(page, { x: 260, y: 120 }, { x: 380, y: 230 })
  await expect(page.locator('input[value="Frame"]')).toBeVisible()

  await selectToolFromGroup(page, /Move Tool|Artboard Tool/, "Artboard Tool")
  await dragOnCanvas(page, { x: 420, y: 120 }, { x: 560, y: 250 })
  await expect(page.locator('input[value="Artboard"]')).toBeVisible()

  await selectToolFromGroup(page, /Eyedropper|Note Tool|Count Tool/, "Note Tool")
  await clickCanvas(page, { x: 320, y: 320 })
  await openCommand(page, "Notes Panel")
  await expect(page.getByText("Canvas note")).toBeVisible()

})

test("new first-class tools commit local editable state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await expect(page.locator("[data-canvas-stage]")).toBeVisible()

  await openCommand(page, "Vertical Type Tool")
  await clickCanvas(page, { x: 150, y: 150 })
  await expect(page.locator('input[value="Vertical Text"]')).toBeVisible()

  await openCommand(page, "Rounded Rectangle Tool")
  await dragOnCanvas(page, { x: 180, y: 180 }, { x: 300, y: 260 })
  await expect(page.locator('input[value="Rounded Rectangle"]')).toBeVisible()

  await openCommand(page, "Polygon Tool")
  await dragOnCanvas(page, { x: 330, y: 180 }, { x: 450, y: 260 })
  await expect(page.locator('input[value="Polygon"]')).toBeVisible()

  await openCommand(page, "Triangle Tool")
  await dragOnCanvas(page, { x: 480, y: 180 }, { x: 600, y: 260 })
  await expect(page.locator('input[value="Triangle"]')).toBeVisible()

  await openCommand(page, "Freeform Pen Tool")
  await dragOnCanvas(page, { x: 180, y: 330 }, { x: 300, y: 390 })
  await expect(page.locator('input[value="Freeform Path"]')).toBeVisible()

  await openCommand(page, "Quick Selection Tool")
  await clickCanvas(page, { x: 240, y: 360 })
  await openCommand(page, "Selection Studio Panel")
  await expect(page.getByText("No active selection")).toBeHidden()

  await openCommand(page, "Slice Tool")
  await dragOnCanvas(page, { x: 620, y: 180 }, { x: 760, y: 260 })
  await openCommand(page, "Slice Select Tool")
  await clickCanvas(page, { x: 650, y: 210 })
  await openCommand(page, "Slice Manager Panel")
  await expect(page.getByText("Selected slice: Slice 1")).toBeVisible()
})

test("advanced tool options expose polygon, magnetic, quick selection, and slice export controls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await expect(page.locator("[data-canvas-stage]")).toBeVisible()

  await openCommand(page, "Polygon Tool")
  await expect(page.getByText("Star")).toBeVisible()
  await expect(page.getByText("Smooth corners")).toBeVisible()

  await openCommand(page, "Quick Selection Tool")
  await expect(page.getByText("Sample:")).toBeVisible()
  await expect(page.getByTitle("Grow selection")).toBeVisible()
  await expect(page.getByTitle("Shrink selection")).toBeVisible()

  await selectToolFromGroup(page, /Lasso Tool|Polygonal Lasso|Magnetic Lasso/, "Magnetic Lasso")
  await expect(page.getByText("Width:")).toBeVisible()
  await expect(page.getByText("Contrast:")).toBeVisible()

  await openCommand(page, "Slice Tool")
  await dragOnCanvas(page, { x: 620, y: 180 }, { x: 760, y: 260 })
  await openCommand(page, "Slice Manager Panel")
  await expect(page.getByText("Filename")).toBeVisible()
  await expect(page.getByText("Quality")).toBeVisible()
  await expect(page.getByText("Compression")).toBeVisible()

  await openCommand(page, "Mixer Brush Tool")
  await expect(page.getByText("Wet:")).toBeVisible()
  await expect(page.getByText("Load:")).toBeVisible()
  await expect(page.getByText("Mix:")).toBeVisible()
  await expect(page.getByText("All Layers")).toBeVisible()

  await openCommand(page, "Color Replacement Tool")
  await expect(page.getByText("Sampling:")).toBeVisible()
  await expect(page.getByText("Limits:")).toBeVisible()
  await expect(page.getByText("Mode:")).toBeVisible()
  await expect(page.getByText("Tol:")).toBeVisible()

  await openCommand(page, "Art History Brush Tool")
  await expect(page.getByText("Style:")).toBeVisible()
  await expect(page.getByText("Area:")).toBeVisible()
  await expect(page.getByText("Fidelity:")).toBeVisible()
})

test("lock image pixels blocks gradient strokes on the active layer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await expect(page.locator("[data-canvas-stage]")).toBeVisible()

  await page.getByLabel("Lower panel picker").selectOption("layers")
  await page.getByRole("button", { name: "Lock image pixels" }).click()
  await openCommand(page, "Gradient Tool")

  const overlayPixelBefore = await page.locator("[data-canvas-stage] canvas").nth(1).evaluate((canvas: HTMLCanvasElement) =>
    Array.from(canvas.getContext("2d")!.getImageData(120, 120, 1, 1).data),
  )
  await dragOnCanvas(page, { x: 80, y: 80 }, { x: 180, y: 180 })
  const overlayPixelAfter = await page.locator("[data-canvas-stage] canvas").nth(1).evaluate((canvas: HTMLCanvasElement) =>
    Array.from(canvas.getContext("2d")!.getImageData(120, 120, 1, 1).data),
  )

  expect(overlayPixelAfter).toEqual(overlayPixelBefore)
})

test("brush strokes repaint the visible composite canvas", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await expect(page.locator("[data-canvas-stage]")).toBeVisible()

  await openCommand(page, "Brush Tool")
  await dragOnCanvas(page, { x: 120, y: 120 }, { x: 280, y: 190 })
  await page.waitForTimeout(150)

  const paintedPixels = await page.locator("[data-canvas-stage] canvas").first().evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext("2d")!.getImageData(80, 80, 260, 160).data
    let dark = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0 && data[i] < 90 && data[i + 1] < 90 && data[i + 2] < 90) dark++
    }
    return dark
  })

  expect(paintedPixels).toBeGreaterThan(20)
})
