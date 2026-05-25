import { expect, type Page, test } from "@playwright/test"

import {
  buildPhotomergeEngineOptions,
  buildPhotomergePreviewLayout,
  findTransparentFillRegion,
  removePhotomergeVignette,
  type PhotomergeWorkspaceSettings,
} from "../components/photoshop/photomerge-workspace"

class TestImageData {
  data: Uint8ClampedArray
  width: number
  height: number

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth
      this.height = widthOrHeight
      this.data = new Uint8ClampedArray(this.width * this.height * 4)
    } else {
      this.data = dataOrWidth
      this.width = widthOrHeight
      this.height = height ?? Math.floor(dataOrWidth.length / 4 / widthOrHeight)
    }
  }
}

globalThis.ImageData = TestImageData as unknown as typeof ImageData

function topMenu(page: Page, name: string) {
  return page
    .locator('[data-slot="dropdown-menu-trigger"], [data-slot="menubar-trigger"]')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .first()
}

function imageData(width: number, height: number, pixels: number[]) {
  return new ImageData(new Uint8ClampedArray(pixels), width, height)
}

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
)

test("photomerge workspace helpers normalize engine options and transparent fill masks", () => {
  const settings: PhotomergeWorkspaceSettings = {
    alignmentModel: "homography",
    projection: "spherical",
    blendImages: true,
    blendMode: "multiband",
    vignetteRemoval: true,
    geometricCorrection: true,
    lensModel: "phone",
    focalLengthPx: 420,
    contentAwareFillTransparent: true,
  }

  const options = buildPhotomergeEngineOptions(settings, 96)
  expect(options.alignmentModel).toBe("homography")
  expect(options.projection).toBe("spherical")
  expect(options.blendMode).toBe("multiband")
  expect(options.searchRadius).toBe(96)
  expect(options.cameraModel?.focalLengthPx).toBe(420)
  expect(options.cameraModel?.lens?.k1).toBeLessThan(0)

  const transparent = imageData(3, 2, [
    10, 20, 30, 255, 0, 0, 0, 0, 40, 50, 60, 255,
    70, 80, 90, 255, 0, 0, 0, 0, 100, 110, 120, 255,
  ])
  const fill = findTransparentFillRegion(transparent)
  expect(fill?.bounds).toEqual({ x: 1, y: 0, w: 1, h: 2 })
  expect(fill?.mask.data[7]).toBe(255)
  expect(fill?.mask.data[(1 * 3 + 1) * 4 + 3]).toBe(255)

  const vignetted = imageData(3, 3, [
    20, 20, 20, 255, 80, 80, 80, 255, 20, 20, 20, 255,
    80, 80, 80, 255, 90, 90, 90, 255, 80, 80, 80, 255,
    20, 20, 20, 255, 80, 80, 80, 255, 20, 20, 20, 255,
  ])
  const corrected = removePhotomergeVignette(vignetted)
  expect(corrected.data[0]).toBeGreaterThan(vignetted.data[0])
  expect(corrected.data[(1 * 3 + 1) * 4]).toBe(vignetted.data[(1 * 3 + 1) * 4])

  const layout = buildPhotomergePreviewLayout([
    { id: "a", name: "a.png", width: 400, height: 240 },
    { id: "b", name: "b.png", width: 360, height: 240 },
    { id: "c", name: "c.png", width: 320, height: 240 },
  ], { width: 600, height: 260, projection: "cylindrical" })
  expect(layout.items).toHaveLength(3)
  expect(layout.items[1].x).toBeLessThan(layout.items[0].x + layout.items[0].width)
  expect(layout.projectionPath).toContain("C")
})

test("photomerge opens as a dedicated source browser with preview and correction controls", async ({ page }) => {
  await page.goto(process.env.PHOTOMERGE_BASE_URL ? `${process.env.PHOTOMERGE_BASE_URL}/editor` : "/editor")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)

  await topMenu(page, "File").click()
  await page.getByText("Automate").hover()
  await page.getByText("Photomerge...").click()

  const dialog = page.getByTestId("photomerge-dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText("Source Files")).toBeVisible()
  await expect(dialog.getByText("Layout Preview")).toBeVisible()

  await page.getByTestId("photomerge-file-input").setInputFiles([
    { name: "left.png", mimeType: "image/png", buffer: png1x1 },
    { name: "right.png", mimeType: "image/png", buffer: png1x1 },
  ])

  await expect(dialog.getByText("2 source files")).toBeVisible()
  await expect(dialog.getByText("left.png")).toBeVisible()
  await expect(dialog.getByText("right.png")).toBeVisible()
  await expect(dialog.locator('canvas[aria-label="Photomerge layout preview"]')).toBeVisible()

  await dialog.getByLabel("Projection").selectOption("spherical")
  await dialog.getByLabel("Layout model").selectOption("homography")
  await dialog.getByLabel("Blend mode").selectOption("feather")
  await dialog.getByLabel("Vignette removal").check()
  await dialog.getByLabel("Geometric distortion correction").check()
  await dialog.getByLabel("Content-aware fill transparent areas").check()

  await expect(dialog.getByRole("button", { name: "Create Panorama" })).toBeEnabled()
})
