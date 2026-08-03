import { expect, test } from "@playwright/test"

test("ruler pointer-up creates a guide and pointer-cancel discards the preview", async ({ page }) => {
  await page.goto("/editor")

  const stage = page.locator("[data-canvas-stage]")
  const horizontalRuler = page.locator('[class~="cursor-s-resize"]').first()
  const guides = page.locator('[title="Guide"]')
  await expect(stage).toBeVisible()
  await expect(horizontalRuler).toBeVisible()
  await expect(guides).toHaveCount(0)

  const rulerBox = await horizontalRuler.boundingBox()
  const stageBox = await stage.boundingBox()
  if (!rulerBox || !stageBox) throw new Error("Canvas ruler geometry is unavailable")

  await page.mouse.move(rulerBox.x + 80, rulerBox.y + 9)
  await page.mouse.down()
  await page.mouse.move(stageBox.x + 80, stageBox.y + 40)
  await page.mouse.up()
  await expect(guides).toHaveCount(1)

  await page.mouse.move(rulerBox.x + 120, rulerBox.y + 9)
  await page.mouse.down()
  await page.mouse.move(stageBox.x + 120, stageBox.y + 70)
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }))
  })
  await page.mouse.up()
  await expect(guides).toHaveCount(1)
})
