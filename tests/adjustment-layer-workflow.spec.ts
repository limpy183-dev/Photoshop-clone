import { expect, type Locator, type Page, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
})

function topMenu(page: Page, name: string) {
  return page
    .locator('[data-slot="dropdown-menu-trigger"], [data-slot="menubar-trigger"]')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .first()
}

async function openLowerPanel(page: Page, id: string) {
  await page.getByLabel("Lower panel picker").selectOption(id)
}

async function openUpperPanel(page: Page, id: string) {
  await page.getByLabel("Upper panel picker").selectOption(id)
}

async function addBrightnessContrastAdjustmentFromImageMenu(page: Page) {
  await topMenu(page, "Image").click()
  await page.getByRole("menuitem", { name: "Adjustments" }).hover()
  await page.getByRole("menuitem", { name: /Brightness\/Contrast/ }).click()
}

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

function adjustmentRow(page: Page, name = "Brightness/Contrast 1"): Locator {
  return page.getByTestId(`layer-row-${name}`)
}

function adjustmentThumb(page: Page, name = "Brightness/Contrast 1"): Locator {
  return page.getByTestId(`adjustment-thumb-${name}`)
}

test("Image adjustments create editable adjustment layers instead of opening destructive filters", async ({ page }) => {
  await page.goto("/")
  await openLowerPanel(page, "layers")

  await addBrightnessContrastAdjustmentFromImageMenu(page)

  await expect(page.getByRole("dialog", { name: /Brightness\/Contrast/ })).toHaveCount(0)
  await expect(page.locator('input[value="Brightness/Contrast 1"]')).toBeVisible()
  await expect(adjustmentRow(page)).toHaveAttribute("data-layer-kind", "adjustment")
  await expect(adjustmentRow(page)).toHaveAttribute("data-adjustment-clipped", "false")
  await expect(adjustmentRow(page)).toHaveAttribute("data-adjustment-mask", "revealed")
  await expect(page.getByTestId("adjustment-thumb-Brightness/Contrast 1")).toBeVisible()
  await expect(page.getByTestId("adjustment-mask-thumb-Brightness/Contrast 1")).toBeVisible()
})

test("ctrl-click clips an adjustment layer to the layer below and Ctrl+I inverts its mask", async ({ page }) => {
  await page.goto("/")
  await openLowerPanel(page, "layers")
  await addBrightnessContrastAdjustmentFromImageMenu(page)

  await adjustmentThumb(page).click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] })
  await expect(adjustmentRow(page)).toHaveAttribute("data-adjustment-clipped", "true")
  await expect(page.getByTestId("adjustment-clip-icon-Brightness/Contrast 1")).toBeVisible()

  await page.keyboard.press(process.platform === "darwin" ? "Meta+I" : "Control+I")
  await expect(adjustmentRow(page)).toHaveAttribute("data-adjustment-mask", "hidden")
})

test("double-clicking an adjustment layer opens its settings with controls above preview", async ({ page }) => {
  await page.goto("/")
  await openLowerPanel(page, "layers")
  await openUpperPanel(page, "color")
  await addBrightnessContrastAdjustmentFromImageMenu(page)

  await adjustmentThumb(page).dblclick()

  await expect(page.getByRole("button", { name: "Adjustments", exact: true })).toBeVisible()
  await expect(page.getByTestId("adjustment-editor")).toBeVisible()
  const settingsBox = await page.getByTestId("adjustment-settings-column").boundingBox()
  const previewBox = await page.getByTestId("adjustment-preview-column").boundingBox()
  expect(settingsBox).not.toBeNull()
  expect(previewBox).not.toBeNull()
  // Controls appear above the preview in the new prominent editor layout.
  expect(previewBox!.y).toBeGreaterThan(settingsBox!.y)
})

test("adding a default adjustment layer does not run full-frame pixel adjustment work", async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as typeof window & {
      __psFullFrameReads?: number
      __psRestoreGetImageData?: () => void
    }
    const proto = CanvasRenderingContext2D.prototype
    const original = proto.getImageData
    win.__psFullFrameReads = 0
    proto.getImageData = function (
      this: CanvasRenderingContext2D,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      settings?: ImageDataSettings,
    ) {
      if (sx === 0 && sy === 0 && sw === this.canvas.width && sh === this.canvas.height && sw >= 1000 && sh >= 700) {
        win.__psFullFrameReads = (win.__psFullFrameReads ?? 0) + 1
      }
      return original.call(this, sx, sy, sw, sh, settings)
    } as CanvasRenderingContext2D["getImageData"]
    win.__psRestoreGetImageData = () => {
      proto.getImageData = original
    }
  })

  await page.goto("/")
  await openLowerPanel(page, "layers")
  await page.evaluate(() => {
    ;(window as typeof window & { __psFullFrameReads?: number }).__psFullFrameReads = 0
  })

  await addBrightnessContrastAdjustmentFromImageMenu(page)
  await page.waitForTimeout(250)

  const fullFrameReads = await page.evaluate(() => {
    const win = window as typeof window & {
      __psFullFrameReads?: number
      __psRestoreGetImageData?: () => void
    }
    const count = win.__psFullFrameReads ?? 0
    win.__psRestoreGetImageData?.()
    return count
  })
  expect(fullFrameReads).toBe(0)
})

test("rapid adjustment slider edits coalesce full-frame composite work", async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as typeof window & {
      __psFullFrameReads?: number
      __psFullFrameWrites?: number
      __psRestoreImageDataHooks?: () => void
    }
    const proto = CanvasRenderingContext2D.prototype
    const originalGet = proto.getImageData
    const originalPut = proto.putImageData
    win.__psFullFrameReads = 0
    win.__psFullFrameWrites = 0
    proto.getImageData = function (
      this: CanvasRenderingContext2D,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      settings?: ImageDataSettings,
    ) {
      if (sx === 0 && sy === 0 && sw === this.canvas.width && sh === this.canvas.height && sw * sh >= 250_000) {
        win.__psFullFrameReads = (win.__psFullFrameReads ?? 0) + 1
      }
      return originalGet.call(this, sx, sy, sw, sh, settings)
    } as CanvasRenderingContext2D["getImageData"]
    proto.putImageData = function (
      this: CanvasRenderingContext2D,
      imageData: ImageData,
      dx: number,
      dy: number,
      ...dirtyRect: [] | [number, number, number, number]
    ) {
      if (dx === 0 && dy === 0 && imageData.width === this.canvas.width && imageData.height === this.canvas.height && imageData.width * imageData.height >= 250_000) {
        win.__psFullFrameWrites = (win.__psFullFrameWrites ?? 0) + 1
      }
      return dirtyRect.length
        ? Reflect.apply(originalPut, this, [imageData, dx, dy, ...dirtyRect])
        : Reflect.apply(originalPut, this, [imageData, dx, dy])
    } as CanvasRenderingContext2D["putImageData"]
    win.__psRestoreImageDataHooks = () => {
      proto.getImageData = originalGet
      proto.putImageData = originalPut
    }
  })

  await page.goto("/")
  await openLowerPanel(page, "layers")
  await addBrightnessContrastAdjustmentFromImageMenu(page)
  await adjustmentThumb(page).dblclick()
  await expect(page.getByTestId("adjustment-editor")).toBeVisible()

  await page.evaluate(() => {
    ;(window as typeof window & { __psFullFrameReads?: number; __psFullFrameWrites?: number }).__psFullFrameReads = 0
    ;(window as typeof window & { __psFullFrameReads?: number; __psFullFrameWrites?: number }).__psFullFrameWrites = 0
  })

  const brightnessSlider = page.getByTestId("adjustment-settings-column").locator('[role="slider"]').first()
  await brightnessSlider.focus()
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowRight")
  await expect(page.getByTestId("adjustment-settings-column")).toContainText("Brightness40")
  await page.waitForTimeout(450)

  const counts = await page.evaluate(() => {
    const win = window as typeof window & {
      __psFullFrameReads?: number
      __psFullFrameWrites?: number
      __psRestoreImageDataHooks?: () => void
    }
    const result = {
      reads: win.__psFullFrameReads ?? 0,
      writes: win.__psFullFrameWrites ?? 0,
    }
    win.__psRestoreImageDataHooks?.()
    return result
  })
  expect(counts.reads).toBeLessThanOrEqual(6)
  expect(counts.writes).toBeLessThanOrEqual(3)
})

test("brush strokes on an active adjustment layer paint its mask", async ({ page }) => {
  await page.goto("/")
  await openLowerPanel(page, "layers")
  await addBrightnessContrastAdjustmentFromImageMenu(page)
  await selectBrushTool(page)

  const start = await canvasScreenPoint(page, 560, 390)
  const end = await canvasScreenPoint(page, 640, 430)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await page.mouse.up()

  await expect(adjustmentRow(page)).toHaveAttribute("data-adjustment-mask", "mixed")
})

test("alt-hover exposes a layer-link target and alt-click clips the upper layer to the one below", async ({ page }) => {
  await page.goto("/")
  await openLowerPanel(page, "layers")
  await addBrightnessContrastAdjustmentFromImageMenu(page)

  await page.keyboard.down("Alt")
  await adjustmentRow(page).hover()
  const clipTarget = page.getByTestId("alt-clip-link-Brightness/Contrast 1")
  await expect(clipTarget).toBeVisible()
  await clipTarget.click()
  await page.keyboard.up("Alt")

  await expect(adjustmentRow(page)).toHaveAttribute("data-adjustment-clipped", "true")
  await expect(page.getByTestId("adjustment-clip-icon-Brightness/Contrast 1")).toBeVisible()
})
