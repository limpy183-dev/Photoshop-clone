import { expect, type Page, test } from "@playwright/test"

const commandShortcut = process.platform === "darwin" ? "Meta+K" : "Control+K"
const commandSearchPlaceholder = "Search tools, filters, panels, and commands"

/**
 * The default 1280x720 viewport leaves a 1200x800 document scrolled under the
 * rulers, so its top-left corner cannot be clicked. Every test here drags across
 * the whole document, so they all need the room.
 */
async function openEditor(page: Page) {
  await page.setViewportSize({ width: 1800, height: 1150 })
  await page.goto("/editor", { waitUntil: "load" })
  await expect(page.locator("[data-canvas-stage]")).toBeVisible({ timeout: 30000 })
  await expect.poll(async () => (await documentPixel(page, 10, 10))[3]).toBe(255)
}

async function selectTool(page: Page, name: string) {
  const search = page.getByPlaceholder(commandSearchPlaceholder)
  await page.locator("body").click({ position: { x: 20, y: 20 } })
  for (let attempt = 0; attempt < 3 && !(await search.isVisible().catch(() => false)); attempt++) {
    await page.keyboard.press(commandShortcut)
    await expect(search).toBeVisible({ timeout: 8000 }).catch(() => {})
  }
  await search.fill(name)
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog", { name: "Command Palette" })).toBeHidden()
}

/** Document pixel -> viewport point, through the composite canvas's own rect. */
async function screenPoint(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x: dx, y: dy }) => {
      const canvas = document.querySelector<HTMLCanvasElement>("[data-canvas-stage] canvas")
      if (!canvas) throw new Error("Composite canvas not found")
      const rect = canvas.getBoundingClientRect()
      return { x: rect.x + (dx / canvas.width) * rect.width, y: rect.y + (dy / canvas.height) * rect.height }
    },
    { x, y },
  )
}

async function dragPath(page: Page, path: [number, number][], steps = 10) {
  const points = []
  for (const [x, y] of path) points.push(await screenPoint(page, x, y))
  await page.mouse.move(points[0].x, points[0].y)
  await page.mouse.down()
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y, { steps })
  await page.mouse.up()
}

async function documentPixel(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x: px, y: py }) => {
      const canvas = document.querySelector<HTMLCanvasElement>("[data-canvas-stage] canvas")
      if (!canvas) throw new Error("Composite canvas not found")
      return Array.from(canvas.getContext("2d")!.getImageData(px, py, 1, 1).data)
    },
    { x, y },
  )
}

/** Dark (painted) pixels in a small box around a document point. */
async function darkAround(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x: cx, y: cy }) => {
      const canvas = document.querySelector<HTMLCanvasElement>("[data-canvas-stage] canvas")
      if (!canvas) throw new Error("Composite canvas not found")
      const data = canvas.getContext("2d")!.getImageData(cx - 6, cy - 6, 13, 13).data
      let dark = 0
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 40 && data[i] < 110) dark++
      return dark
    },
    { x, y },
  )
}

async function optionsBarText(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector(".h-9.bg-\\[var\\(--ps-panel\\)\\]") as HTMLElement | null
    return (bar?.innerText ?? "").replace(/\n/g, " ~ ")
  })
}

test("a second move of a lasso selection carries the same float instead of cutting a new hole", async ({ page }) => {
  await openEditor(page)
  await page.getByRole("button", { name: "New layer" }).click()

  await selectTool(page, "Brush Tool")
  await dragPath(page, [[240, 240], [250, 250]])
  await dragPath(page, [[640, 440], [650, 450]])
  await expect.poll(async () => darkAround(page, 245, 245)).toBeGreaterThan(0)
  await expect.poll(async () => darkAround(page, 645, 445)).toBeGreaterThan(0)

  await selectTool(page, "Lasso Tool")
  await dragPath(page, [[180, 180], [320, 180], [320, 320], [180, 320], [180, 180]], 6)

  await selectTool(page, "Move Tool")
  // First drag parks the lifted blob on top of the second one.
  await dragPath(page, [[245, 245], [645, 445]])
  await expect.poll(async () => darkAround(page, 645, 445)).toBeGreaterThan(0)

  // Second drag takes only the float away. Re-lifting here would punch a hole
  // through the artwork the float had been parked on.
  await dragPath(page, [[645, 445], [900, 620]])
  await expect.poll(async () => darkAround(page, 900, 620)).toBeGreaterThan(0)
  expect(await darkAround(page, 645, 445)).toBeGreaterThan(0)
})

test("the path selection tool has its own options and moves the shape it hits", async ({ page }) => {
  await openEditor(page)
  await selectTool(page, "Rectangle Tool")
  await dragPath(page, [[400, 250], [560, 380]])
  await expect.poll(async () => darkAround(page, 480, 310)).toBeGreaterThan(0)

  await selectTool(page, "Path Selection Tool")
  const bar = await optionsBarText(page)
  expect(bar).toContain("Path Selection")
  expect(bar).not.toContain("No options for this tool")

  await dragPath(page, [[480, 310], [700, 500]])
  await expect.poll(async () => darkAround(page, 700, 500)).toBeGreaterThan(0)
  expect(await darkAround(page, 480, 310)).toBe(0)
})
