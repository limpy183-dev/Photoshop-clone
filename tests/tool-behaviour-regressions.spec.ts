import { expect, test, type Page } from "@playwright/test"

/**
 * End-to-end guards for tool behaviour that only breaks once the real canvas,
 * the real compositor and the real options bar are all in play. Each test names
 * the defect it locks out.
 */

async function openEditor(page: Page) {
  await page.goto("/editor")
  await expect(page.getByRole("menuitem", { name: "File", exact: true })).toBeVisible()
  await expect(page.locator('canvas[role="img"][aria-label^="Document canvas:"]').first()).toBeVisible()
  // Fit on screen so document coordinates map onto visible client coordinates.
  await page.keyboard.press("Control+0")
  await page.waitForTimeout(400)
}

async function activeToolLabel(page: Page) {
  return page.evaluate(() => {
    const active = Array.from(document.querySelectorAll("button[aria-label]"))
      .find((button) => button.className.includes("ps-tool-active"))
    return active?.getAttribute("aria-label") ?? "?"
  })
}

async function pickTool(page: Page, shortcut: string, expected: string) {
  await page.keyboard.press(shortcut)
  await expect.poll(() => activeToolLabel(page), { message: `tool ${expected}` }).toContain(expected)
}

async function toClient(page: Page, x: number, y: number) {
  return page.evaluate(([px, py]) => {
    const canvas = document.querySelector('canvas[role="img"][aria-label^="Document canvas:"]') as HTMLCanvasElement
    const rect = canvas.getBoundingClientRect()
    return [rect.left + (px / canvas.width) * rect.width, rect.top + (py / canvas.height) * rect.height]
  }, [x, y])
}

async function drag(page: Page, from: [number, number], to: [number, number], steps = 24) {
  const a = await toClient(page, from[0], from[1])
  const b = await toClient(page, to[0], to[1])
  await page.mouse.move(a[0], a[1])
  await page.mouse.down()
  for (let index = 1; index <= steps; index++) {
    await page.mouse.move(a[0] + ((b[0] - a[0]) * index) / steps, a[1] + ((b[1] - a[1]) * index) / steps)
  }
  await page.mouse.up()
  await page.waitForTimeout(350)
}

/** Bounding box of everything on the composite that is not the white page. */
async function inkBounds(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas[role="img"][aria-label^="Document canvas:"]') as HTMLCanvasElement
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data
    let minX = Infinity
    let minY = Infinity
    let maxX = -1
    let maxY = -1
    let count = 0
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4
        if ((data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) || data[i + 3] === 0) continue
        count++
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
    return count ? { minX, minY, maxX, maxY, count } : null
  })
}

test("a rectangular marquee clips the brush at its edge", async ({ page }) => {
  // stamp() used to point-test the dab *centre*, so half of every dab painted
  // over the boundary and dabs centred just outside painted nothing at all.
  await openEditor(page)
  await pickTool(page, "m", "Rectangular Marquee")
  await drag(page, [300, 300], [500, 400])

  await pickTool(page, "b", "Brush")
  await page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Brush size"]') as HTMLInputElement | null
    if (!input) return
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!
    setter.call(input, "80")
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  // A wide brush swept along the selection's top edge: unclipped, it spills up.
  await drag(page, [320, 305], [480, 305])

  const ink = await inkBounds(page)
  expect(ink).not.toBeNull()
  expect(ink!.minY, "no paint above the selection").toBeGreaterThanOrEqual(299)
  expect(ink!.minX, "no paint left of the selection").toBeGreaterThanOrEqual(299)
  expect(ink!.maxX, "no paint right of the selection").toBeLessThanOrEqual(501)
})

test("adding a layer does not flip the composite upside down", async ({ page }) => {
  // Every WebGL layer pass renders into a framebuffer texture, which is stored
  // bottom-row-first. Nothing compensated, so the composite came out mirrored
  // on an odd layer count and each layer blended against a mirrored backdrop on
  // an even one — drawing a shape appeared to turn the whole canvas over.
  //
  // A headless run often falls back to the Canvas 2D compositor and never takes
  // that path, so this is the coarse end-to-end guard; the pass-by-pass one is
  // tests/webgl-compositor-orientation.spec.ts, which needs no GPU.
  await openEditor(page)
  await pickTool(page, "b", "Brush")
  await drag(page, [300, 120], [700, 120])
  const beforeShape = await inkBounds(page)
  expect(beforeShape!.maxY, "the stroke is near the top").toBeLessThan(300)

  await pickTool(page, "u", "Rectangle")
  await drag(page, [300, 500], [600, 700])
  const afterShape = await inkBounds(page)

  // The stroke must still be near the top and the shape near the bottom.
  expect(afterShape!.minY, "the stroke stayed at the top").toBeLessThan(200)
  expect(afterShape!.maxY, "the shape stayed at the bottom").toBeGreaterThan(600)
})

test("moving a lasso selection takes the pixels with it", async ({ page }) => {
  // Reported as "the move copies it too". The lift/punch itself measures clean
  // both before and after this round of fixes, so the duplicate was almost
  // certainly the mirrored composite above rendering the stroke somewhere other
  // than where it was selected. Locked in either way.
  await openEditor(page)
  await pickTool(page, "b", "Brush")
  await drag(page, [300, 300], [700, 300])

  await pickTool(page, "l", "Lasso")
  const loop: [number, number][] = [[250, 240], [520, 240], [520, 360], [250, 360], [250, 240]]
  const start = await toClient(page, loop[0][0], loop[0][1])
  await page.mouse.move(start[0], start[1])
  await page.mouse.down()
  for (const [cx, cy] of loop.slice(1)) {
    const point = await toClient(page, cx, cy)
    for (let index = 0; index < 6; index++) await page.mouse.move(point[0], point[1])
  }
  await page.mouse.up()
  await page.waitForTimeout(400)

  await pickTool(page, "v", "Move")
  await drag(page, [400, 300], [400, 600])

  const bands = await page.evaluate(() => {
    const canvas = document.querySelector('canvas[role="img"][aria-label^="Document canvas:"]') as HTMLCanvasElement
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data
    const rowInk = (y: number, x0: number, x1: number) => {
      let count = 0
      for (let x = x0; x <= x1; x++) {
        const i = (y * canvas.width + x) * 4
        if (!(data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240)) count++
      }
      return count
    }
    return {
      origin: rowInk(300, 260, 510),
      untouched: rowInk(300, 540, 690),
      moved: rowInk(600, 260, 510),
    }
  })
  expect(bands.moved, "the lifted pixels arrived at the drop point").toBeGreaterThan(0)
  expect(bands.origin, "and left nothing behind — a move, not a copy").toBe(0)
  expect(bands.untouched, "the unselected part of the stroke stayed put").toBeGreaterThan(0)
})

test("the A shortcut reaches Path Selection, which drags a shape", async ({ page }) => {
  // The tool palette advertised "A" but the shortcut table had no entry for the
  // group, so the key did nothing and the tool looked broken.
  await openEditor(page)
  await pickTool(page, "u", "Rectangle")
  await drag(page, [300, 200], [600, 400])
  const before = await inkBounds(page)

  await pickTool(page, "a", "Path Selection")
  await drag(page, [450, 300], [450, 550])
  const after = await inkBounds(page)

  expect(after!.minY - before!.minY, "the shape travelled with the drag").toBeGreaterThan(200)
})

test("the transform tool can grab a handle and scale", async ({ page }) => {
  // Pointer-down restarted the transform session on every press, resetting it
  // to identity and consuming the event before the handle hit-test could run.
  await openEditor(page)
  await pickTool(page, "u", "Rectangle")
  await drag(page, [300, 200], [600, 400])
  const before = await inkBounds(page)

  await page.locator('button[aria-label="Transform Tool"]').first().click()
  await expect.poll(() => activeToolLabel(page)).toContain("Transform")
  const centre = await toClient(page, 450, 300)
  await page.mouse.click(centre[0], centre[1])
  await page.waitForTimeout(250)
  await drag(page, [600, 400], [750, 500])

  const after = await inkBounds(page)
  expect(after!.maxX, "the corner handle scaled the layer out").toBeGreaterThan(before!.maxX + 40)
})

test("an empty type box fits its placeholder on a single line", async ({ page }) => {
  // The box was measured against the empty string, collapsing it to a 64px
  // floor that cut the placeholder off, and a textarea's default two rows left
  // the single line sitting in the top half of the outline.
  await openEditor(page)
  await pickTool(page, "t", "Horizontal Type")
  const point = await toClient(page, 300, 300)
  await page.mouse.click(point[0], point[1])

  const box = page.getByTestId("text-edit-overlay")
  await expect(box).toBeVisible()
  const metrics = await box.evaluate((element) => {
    const style = getComputedStyle(element)
    const probe = document.createElement("canvas").getContext("2d")!
    probe.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    return {
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
      lineHeight: parseFloat(style.lineHeight),
      placeholderWidth: probe.measureText((element as HTMLTextAreaElement).placeholder).width,
      rows: (element as HTMLTextAreaElement).rows,
    }
  })

  expect(metrics.width, "wide enough for the placeholder").toBeGreaterThanOrEqual(metrics.placeholderWidth)
  expect(metrics.rows).toBe(1)
  expect(Math.abs(metrics.height - metrics.lineHeight), "exactly one line tall").toBeLessThan(4)
})

test("the gradient stop editor survives editing a stop", async ({ page }) => {
  // GradientOptions was declared inside OptionsBar, so every dispatch gave it a
  // fresh function identity and React remounted it — closing the popover and
  // resetting the selected stop the instant any control was touched.
  await openEditor(page)
  await pickTool(page, "g", "Gradient")
  await page.locator('button[title="Edit gradient stops"]').click()

  const popover = page.locator("[data-radix-popper-content-wrapper]")
  await expect(popover).toBeVisible()
  const ramp = popover.locator("div.cursor-crosshair").first()
  await expect(ramp).toBeVisible()
  const stops = () => popover.locator('button[aria-label^="Stop "]')

  const before = await stops().count()
  const rampBox = (await ramp.boundingBox())!
  await page.mouse.click(rampBox.x + rampBox.width * 0.5, rampBox.y + rampBox.height / 2)
  await expect(stops(), "a click on the ramp adds a stop").toHaveCount(before + 1)
  await expect(ramp, "the editor stays open").toBeVisible()

  await stops().first().click()
  await expect(stops(), "selecting a stop does not add another").toHaveCount(before + 1)
  await expect(ramp, "the editor stays open").toBeVisible()

  await popover.locator('span[role="slider"]').first().focus()
  await page.keyboard.press("ArrowLeft")
  await expect(ramp, "the editor survives a slider change").toBeVisible()
})

test("dodge has a hardness control and lightens shadows", async ({ page }) => {
  // Protect Tones scaled channels by a luminance ratio, which can never lift a
  // black pixel, and the dab had no hardness so it landed as a hard disc.
  await openEditor(page)
  await pickTool(page, "b", "Brush")
  await drag(page, [300, 300], [700, 300])

  await pickTool(page, "o", "Dodge")
  await expect(page.getByLabel("Hardness", { exact: true })).toBeVisible()

  const sample = () => page.evaluate(() => {
    const canvas = document.querySelector('canvas[role="img"][aria-label^="Document canvas:"]') as HTMLCanvasElement
    return canvas.getContext("2d")!.getImageData(500, 300, 1, 1).data[0]
  })
  const before = await sample()

  await page.getByRole("combobox").filter({ hasText: /Midtones|Shadows|Highlights/ }).first().click()
  await page.getByRole("option", { name: "Shadows" }).click()
  for (let pass = 0; pass < 6; pass++) await drag(page, [420, 300], [600, 300], 12)

  expect(await sample(), "dodging shadows lightens a dark stroke").toBeGreaterThan(before)
})
