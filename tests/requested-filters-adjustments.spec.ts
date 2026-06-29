import { expect, test } from "@playwright/test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { getFilter } from "../components/photoshop/filters"
import {
  isFilterWorkerSupported,
  planExpensiveFilterTiling,
} from "../components/photoshop/filter-worker"

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

function imageData(width: number, height: number, pixels: number[]) {
  return new ImageData(new Uint8ClampedArray(pixels), width, height)
}

function filter(id: string) {
  const def = getFilter(id)
  expect(def, id).toBeTruthy()
  return def!
}

function dataOf(image: ImageData) {
  return Array.from(image.data)
}

test("requested local filters are worker-backed or tiled where safe", () => {
  expect(isFilterWorkerSupported("surface-blur")).toBe(true)
  expect(isFilterWorkerSupported("lens-blur")).toBe(true)
  expect(isFilterWorkerSupported("high-pass")).toBe(true)
  expect(isFilterWorkerSupported("offset")).toBe(true)
  expect(isFilterWorkerSupported("custom-convolution")).toBe(true)
  expect(isFilterWorkerSupported("lighting-effects")).toBe(true)

  expect(planExpensiveFilterTiling("surface-blur", 5000, 4000, { radius: 8 }).strategy).toBe("tiled-worker-preferred")
  expect(planExpensiveFilterTiling("lens-blur", 5000, 4000, { radius: 8 }).strategy).toBe("tiled-worker-preferred")
  expect(planExpensiveFilterTiling("high-pass", 5000, 4000, { radius: 12 }).strategy).toBe("tiled-worker-preferred")
  expect(planExpensiveFilterTiling("custom-convolution", 5000, 4000, {}).strategy).toBe("tiled-worker-preferred")
})

test("remaining requested Photoshop filters are registered and reachable from menus", () => {
  const requested = [
    "displace",
    "shear",
    "polar-coordinates",
    "zigzag",
    "diffuse",
    "tiles",
    "extrude",
    "wind",
    "pointillize",
    "color-halftone",
    "mezzotint",
    "fragment",
    "facet",
    "fibers",
    "flame",
    "picture-frame",
    "tree",
    "lens-flare",
    "reduce-noise",
    "dust-scratches",
    "despeckle",
    "de-interlace",
    "ntsc-colors",
    "custom-filter",
    "lighting-effects",
    "lens-correction",
    "adaptive-wide-angle",
  ]
  const menuBarSource = readFileSync(join(process.cwd(), "components/photoshop/menu-bar.tsx"), "utf8")
  const filterMenuSource = readFileSync(join(process.cwd(), "components/photoshop/menus/filter-menu.tsx"), "utf8")
  const mediaWorkspaceMenuSource = readFileSync(join(process.cwd(), "components/photoshop/menus/media-workspace-menus.tsx"), "utf8")
  const mountedMenuSources = [filterMenuSource, mediaWorkspaceMenuSource].join("\n")

  expect(menuBarSource, "menu bar should mount the extracted filter menu").toContain("<FilterMenu")
  expect(menuBarSource, "menu bar should mount media workspace menus").toContain("<MediaWorkspaceMenus")

  for (const id of requested) {
    expect(getFilter(id), id).toBeTruthy()
    expect(mountedMenuSources, `mounted menus should open ${id}`).toContain(`"${id}"`)
  }
})

test("advanced filter dialogs expose full source and control sets", () => {
  const lensBlurParamKeys = filter("lens-blur").params.map((param) => param.key)
  expect(lensBlurParamKeys).toEqual(expect.arrayContaining([
    "depthSource",
    "depthChannel",
    "depthFocus",
    "depthBlurScale",
    "depthInvert",
  ]))

  const lightingParamKeys = filter("lighting-effects").params.map((param) => param.key)
  expect(lightingParamKeys).toEqual(expect.arrayContaining([
    "lights",
    "bumpSource",
    "bumpChannel",
    "gloss",
    "shine",
    "exposure",
  ]))

  const smartSharpenParamKeys = filter("smart-sharpen").params.map((param) => param.key)
  expect(smartSharpenParamKeys).toEqual(expect.arrayContaining([
    "remove",
    "motionAngle",
    "moreAccurate",
    "shadowAmount",
    "shadowTonalWidth",
    "shadowRadius",
    "highlightAmount",
    "highlightTonalWidth",
    "highlightRadius",
  ]))
})

test("smart sharpen removal model and tonal controls affect the rendered pixels", () => {
  const src = imageData(3, 3, [
    10, 20, 30, 255, 80, 90, 100, 255, 180, 185, 190, 255,
    20, 30, 40, 255, 140, 145, 150, 255, 210, 212, 214, 255,
    30, 40, 50, 255, 170, 175, 180, 255, 245, 246, 247, 255,
  ])

  const gaussian = filter("smart-sharpen").apply(src, {
    amount: 180,
    radius: 1.4,
    threshold: 0,
    remove: "gaussian",
    shadowAmount: 0,
    highlightAmount: 0,
  })
  const motion = filter("smart-sharpen").apply(src, {
    amount: 180,
    radius: 1.4,
    threshold: 0,
    remove: "motion",
    motionAngle: 0,
    moreAccurate: true,
    shadowAmount: 0,
    highlightAmount: 0,
  })
  const protectedTones = filter("smart-sharpen").apply(src, {
    amount: 180,
    radius: 1.4,
    threshold: 0,
    remove: "gaussian",
    shadowAmount: 90,
    shadowTonalWidth: 90,
    shadowRadius: 4,
    highlightAmount: 90,
    highlightTonalWidth: 90,
    highlightRadius: 4,
  })

  expect(dataOf(motion)).not.toEqual(dataOf(gaussian))
  expect(dataOf(protectedTones)).not.toEqual(dataOf(gaussian))
})

test("color lookup imports CUBE LUT data and blends it by strength", () => {
  const src = imageData(2, 1, [
    255, 0, 0, 255,
    0, 0, 255, 255,
  ])
  const cube = [
    "TITLE \"swap red blue\"",
    "LUT_3D_SIZE 2",
    "0 0 0",
    "0 0 1",
    "0 1 0",
    "0 1 1",
    "1 0 0",
    "1 0 1",
    "1 1 0",
    "1 1 1",
  ].join("\n")

  const result = filter("color-lookup").apply(src, { strength: 100, lutData: cube })

  expect(dataOf(result)).toEqual([
    0, 0, 255, 255,
    255, 0, 0, 255,
  ])
})

test("gradient map exposes editable stops and maps luminance through them", () => {
  const gradient = filter("gradient-map")
  expect(gradient.params.some((param) => param.key === "gradient")).toBe(true)

  const src = imageData(3, 1, [
    0, 0, 0, 255,
    128, 128, 128, 255,
    255, 255, 255, 255,
  ])
  const result = gradient.apply(src, {
    gradient: "0,#000000;0.5,#ff0000;1,#ffffff",
    reverse: false,
    dither: false,
    interpolation: "rgb",
  })

  expect(dataOf(result)).toEqual([
    0, 0, 0, 255,
    255, 1, 1, 255,
    255, 255, 255, 255,
  ])
})

test("selective color uses Photoshop-like range and CMYK controls", () => {
  const src = imageData(3, 1, [
    220, 40, 40, 255,
    40, 220, 40, 255,
    240, 240, 240, 255,
  ])

  const result = filter("selective-color").apply(src, {
    range: "reds",
    cyan: 100,
    magenta: 0,
    yellow: 0,
    black: 0,
    method: "relative",
  })

  expect(Array.from(result.data.slice(0, 4))[0]).toBeLessThan(180)
  expect(Array.from(result.data.slice(4, 8))).toEqual([40, 220, 40, 255])
  expect(Array.from(result.data.slice(8, 12))).toEqual([240, 240, 240, 255])
})

test("replace color targets a sampled hue and applies replacement hue saturation and lightness", () => {
  const src = imageData(2, 1, [
    220, 20, 20, 255,
    20, 220, 20, 255,
  ])

  const result = filter("replace-color").apply(src, {
    sourceHue: 0,
    fuzziness: 20,
    replacementHue: 240,
    replacementSaturation: 20,
    replacementLightness: 0,
  })

  const replaced = Array.from(result.data.slice(0, 4))
  expect(replaced[2]).toBeGreaterThan(replaced[0])
  expect(Array.from(result.data.slice(4, 8))).toEqual([20, 220, 20, 255])
})

test("shadows highlights brightens shadows and recovers highlights", () => {
  const src = imageData(3, 1, [
    32, 32, 32, 255,
    128, 128, 128, 255,
    230, 230, 230, 255,
  ])

  const result = filter("shadows-highlights").apply(src, {
    shadows: 60,
    highlights: 60,
    tonalWidth: 50,
    radius: 4,
    colorCorrection: 0,
  })

  expect(result.data[0]).toBeGreaterThan(32)
  expect(result.data[4]).toBeGreaterThan(90)
  expect(result.data[8]).toBeLessThan(230)
})

test("threshold and posterize refinements support channels, inversion, and dithering", () => {
  const src = imageData(4, 1, [
    10, 200, 10, 255,
    80, 80, 80, 255,
    150, 150, 150, 255,
    240, 240, 240, 255,
  ])

  const threshold = filter("threshold").apply(src, {
    level: 128,
    channel: "green",
    invert: true,
  })
  expect(dataOf(threshold)).toEqual([
    0, 0, 0, 255,
    255, 255, 255, 255,
    0, 0, 0, 255,
    0, 0, 0, 255,
  ])

  const posterizedPlain = filter("posterize").apply(src, { levels: 3, dither: false })
  const posterizedDithered = filter("posterize").apply(src, { levels: 3, dither: true })
  expect(dataOf(posterizedDithered)).not.toEqual(dataOf(posterizedPlain))
})

test("custom convolution accepts an imported kernel matrix", () => {
  const src = imageData(3, 1, [
    10, 20, 30, 255,
    100, 110, 120, 255,
    200, 210, 220, 255,
  ])

  const result = filter("custom-convolution").apply(src, {
    matrix: "0 0 0\n0 1 0\n0 0 0",
    strength: 100,
    bias: 0,
    divisor: 1,
  })

  expect(dataOf(result)).toEqual(dataOf(src))
})

test("radial blur supports off-center spin and zoom approximations", () => {
  const src = imageData(3, 3, [
    255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 255,
    0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 0, 255,
  ])

  const centered = filter("radial-blur").apply(src, { amount: 80, method: "spin", quality: "best", centerX: 50, centerY: 50 })
  const offCenter = filter("radial-blur").apply(src, { amount: 80, method: "spin", quality: "best", centerX: 20, centerY: 80 })

  expect(dataOf(offCenter)).not.toEqual(dataOf(centered))
})

test("displace exposes independent scales and edge modes", () => {
  const src = imageData(3, 1, [
    10, 0, 0, 255,
    100, 0, 0, 255,
    200, 0, 0, 255,
  ])

  const shifted = filter("displace").apply(src, {
    scaleX: 100,
    scaleY: 0,
    map: "horizontal-gradient",
    edgeMode: "wrap",
  })
  const transparent = filter("displace").apply(src, {
    scaleX: 100,
    scaleY: 0,
    map: "horizontal-gradient",
    edgeMode: "transparent",
  })

  expect(dataOf(shifted)).not.toEqual(dataOf(src))
  expect(Array.from(transparent.data.slice(0, 4))[3]).toBe(0)
})

test("vanishing point accepts perspective-plane corner offsets", () => {
  const vp = filter("vanishing-point")
  expect(vp.params.some((param) => param.key === "topLeftX")).toBe(true)
  expect(vp.params.some((param) => param.key === "bottomRightY")).toBe(true)

  const src = imageData(2, 2, [
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 0, 255,
  ])
  const warped = vp.apply(src, {
    horizon: 50,
    left: 0,
    right: 0,
    depth: 0,
    grid: false,
    topLeftX: 20,
    topLeftY: 0,
    topRightX: 0,
    topRightY: 20,
    bottomRightX: -20,
    bottomRightY: 0,
    bottomLeftX: 0,
    bottomLeftY: -20,
  })

  expect(dataOf(warped)).not.toEqual(dataOf(src))
})
