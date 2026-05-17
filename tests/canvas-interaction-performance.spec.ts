import { expect, type Page, test } from "@playwright/test"

async function selectBrushTool(page: Page) {
  await expect(page.locator("[data-canvas-stage]")).toBeVisible()
  await page.locator("body").click({ position: { x: 20, y: 20 } })
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await expect(page.getByPlaceholder("Search tools, filters, panels, and commands")).toBeVisible()
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Brush Tool")
  await page.keyboard.press("Enter")
  await expect(page.getByText("Command Palette")).toBeHidden()
  await expect(page.getByRole("button", { name: /^Brush Tool\b/ }).first()).toBeVisible()
}

async function canvasScreenPoint(page: Page, x: number, y: number) {
  const stage = page.locator("[data-canvas-stage]")
  await expect(stage).toBeVisible()
  const box = await stage.boundingBox()
  if (!box) throw new Error("Canvas stage is not measurable")
  return { x: box.x + x, y: box.y + y }
}

async function canvasPixel(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x: px, y: py }) => {
      const canvas = document.querySelector<HTMLCanvasElement>("[data-canvas-stage] canvas")
      if (!canvas) throw new Error("Composite canvas not found")
      return Array.from(canvas.getContext("2d")!.getImageData(px, py, 1, 1).data)
    },
    { x, y },
  )
}

async function darkPixelCount(page: Page, x: number, y: number, w = 80, h = 60) {
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

test("rapid wheel zoom previews with transform scaling instead of resizing the canvas layout every frame", async ({ page }) => {
  await page.goto("/")
  const stage = page.locator("[data-canvas-stage]")
  await expect(stage).toBeVisible()

  const before = await stage.evaluate((element) => ({
    width: (element as HTMLElement).style.width,
    transform: (element as HTMLElement).style.transform,
  }))

  const zoomPoint = await canvasScreenPoint(page, 240, 180)
  await page.mouse.move(zoomPoint.x, zoomPoint.y)
  await page.keyboard.down("Control")
  await page.mouse.wheel(0, -240)
  await page.keyboard.up("Control")
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

  const during = await stage.evaluate((element) => ({
    width: (element as HTMLElement).style.width,
    transform: (element as HTMLElement).style.transform,
  }))

  expect(during.width).toBe(before.width)
  expect(during.transform).toContain("scale(")
  expect(during.transform).not.toBe(before.transform)
})

test("coalesced zoom changes do not redraw unchanged layer pixels", async ({ page }) => {
  await page.goto("/")
  const stage = page.locator("[data-canvas-stage]")
  await expect(stage).toBeVisible()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect.poll(async () => (await canvasPixel(page, 10, 10))[3]).toBe(255)
  await page.waitForTimeout(300)

  await page.evaluate(() => {
    const win = window as typeof window & {
      __psDrawImageCount?: number
      __psRestoreDrawImage?: () => void
    }
    win.__psRestoreDrawImage?.()
    win.__psDrawImageCount = 0
    const proto = CanvasRenderingContext2D.prototype
    const original = proto.drawImage
    proto.drawImage = function (this: CanvasRenderingContext2D, ...args: Parameters<CanvasRenderingContext2D["drawImage"]>) {
      win.__psDrawImageCount = (win.__psDrawImageCount ?? 0) + 1
      return original.apply(this, args)
    } as CanvasRenderingContext2D["drawImage"]
    win.__psRestoreDrawImage = () => {
      proto.drawImage = original
    }
  })

  const zoomPoint = await canvasScreenPoint(page, 240, 180)
  await page.mouse.move(zoomPoint.x, zoomPoint.y)
  await page.keyboard.down("Control")
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -80)
  await page.keyboard.up("Control")
  await page.waitForTimeout(520)
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

  const drawImageCount = await page.evaluate(() => {
    const win = window as typeof window & {
      __psDrawImageCount?: number
      __psRestoreDrawImage?: () => void
    }
    const count = win.__psDrawImageCount ?? 0
    win.__psRestoreDrawImage?.()
    return count
  })
  expect(drawImageCount).toBe(0)
})

test("rapid zoom bursts keep canvas layout stable until the user pauses", async ({ page }) => {
  await page.goto("/")
  const stage = page.locator("[data-canvas-stage]")
  await expect(stage).toBeVisible()
  const beforeWidth = await stage.evaluate((element) => (element as HTMLElement).style.width)

  const zoomPoint = await canvasScreenPoint(page, 240, 180)
  await page.mouse.move(zoomPoint.x, zoomPoint.y)
  await page.keyboard.down("Control")
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -120)
  await page.keyboard.up("Control")
  await page.waitForTimeout(150)

  await expect(stage).toHaveCSS("width", beforeWidth)
  const previewTransform = await stage.evaluate((element) => (element as HTMLElement).style.transform)
  expect(previewTransform).toContain("scale(")
})

test("right clicking the canvas with a paint tool opens the custom menu without painting", async ({ page }) => {
  await page.goto("/")
  await selectBrushTool(page)

  const target = { x: 180, y: 130 }
  const before = await canvasPixel(page, target.x, target.y)
  const root = page.locator("[data-canvas-root]")
  const rootBox = await root.boundingBox()
  const stageBox = await page.locator("[data-canvas-stage]").boundingBox()
  if (!rootBox || !stageBox) throw new Error("Canvas root or stage is not measurable")

  await root.click({
    button: "right",
    position: {
      x: stageBox.x - rootBox.x + target.x,
      y: stageBox.y - rootBox.y + target.y,
    },
  })

  await expect(page.getByRole("menu", { name: "Canvas context menu" })).toBeVisible()
  await expect(canvasPixel(page, target.x, target.y)).resolves.toEqual(before)
})

test("rapid keyboard undo and redo step through multiple queued paint history entries", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await expect(page.locator("[data-canvas-stage]")).toBeVisible()
  await expect.poll(async () => (await canvasPixel(page, 600, 400))[3]).toBeGreaterThan(0)
  await selectBrushTool(page)

  const strokes = [
    { from: { x: 120, y: 120 }, to: { x: 280, y: 190 }, region: { x: 80, y: 80, w: 260, h: 160 } },
    { from: { x: 140, y: 280 }, to: { x: 300, y: 350 }, region: { x: 100, y: 240, w: 260, h: 160 } },
    { from: { x: 420, y: 180 }, to: { x: 580, y: 250 }, region: { x: 380, y: 140, w: 260, h: 160 } },
  ]
  for (const stroke of strokes) {
    const start = await canvasScreenPoint(page, stroke.from.x, stroke.from.y)
    const end = await canvasScreenPoint(page, stroke.to.x, stroke.to.y)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(700)
    await expect.poll(async () => darkPixelCount(page, stroke.region.x, stroke.region.y, stroke.region.w, stroke.region.h)).toBeGreaterThan(20)
  }

  await page.keyboard.down("Control")
  await page.keyboard.press("z")
  await page.keyboard.press("z")
  await page.keyboard.press("z")
  await page.keyboard.up("Control")
  await page.waitForTimeout(1000)
  for (const stroke of strokes) {
    expect(await darkPixelCount(page, stroke.region.x, stroke.region.y, stroke.region.w, stroke.region.h)).toBe(0)
  }

  await page.keyboard.down("Control")
  await page.keyboard.press("y")
  await page.keyboard.press("y")
  await page.keyboard.press("y")
  await page.keyboard.up("Control")
  await page.waitForTimeout(1000)
  for (const stroke of strokes) {
    await expect.poll(async () => darkPixelCount(page, stroke.region.x, stroke.region.y, stroke.region.w, stroke.region.h)).toBeGreaterThan(20)
  }
})
