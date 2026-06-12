import { expect, test } from "@playwright/test"

import {
  AUTO_DEFAULTS as facadeAutoDefaults,
  FILTERS as facadeFilters,
  HDR_TONING_PRESETS as facadeHdrToningPresets,
  applyAutoAdjustment as facadeApplyAutoAdjustment,
  compositeFilterImageData as facadeComposite,
  formatReplaceColorSamples as facadeFormatReplaceColorSamples,
  getFilter as facadeGetFilter,
  parseReplaceColorSamples as facadeParseReplaceColorSamples,
} from "../components/photoshop/filters"
import {
  FILTERS as registryFilters,
  getFilter as registryGetFilter,
} from "../components/photoshop/filters/registry"
import {
  compositeFilterImageData as moduleComposite,
} from "../components/photoshop/filters/composite"
import {
  boxBlur,
  brightnessContrast,
  emboss,
  findEdges,
  gaussianBlur,
  motionBlur,
  noise,
  pixelate,
  sharpen,
  solarize,
  unsharpMask,
} from "../components/photoshop/filters/basic-algorithms"
import {
  clamp01,
  clamp8,
  cloneImageData,
  hslToRgb,
  luma,
  numberParam,
  parseBool,
  parseNumber,
  rgbToHsl,
} from "../components/photoshop/filters/pixel-helpers"
import {
  monotoneCurveLut,
  parseCurvePoints,
  pseudoDither,
} from "../components/photoshop/filters/curve-helpers"
import {
  AUTO_DEFAULTS as moduleAutoDefaults,
  HDR_TONING_PRESETS as moduleHdrToningPresets,
  applyAutoAdjustment as moduleApplyAutoAdjustment,
  equalize,
  formatReplaceColorSamples as moduleFormatReplaceColorSamples,
  hdrToning,
  hueSaturation,
  levels,
  parseReplaceColorSamples as moduleParseReplaceColorSamples,
  posterize,
  selectiveColor,
  shadowsHighlights,
} from "../components/photoshop/filters/adjustment-algorithms"

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

function fixture3x3() {
  return new ImageData(new Uint8ClampedArray([
    10, 20, 30, 255, 70, 80, 90, 255, 130, 120, 100, 255,
    35, 55, 85, 255, 125, 135, 145, 255, 220, 210, 180, 255,
    20, 90, 60, 255, 155, 80, 45, 255, 245, 245, 230, 255,
  ]), 3, 3)
}

function expectSamePixels(actual: ImageData, expected: ImageData) {
  expect(actual.width).toBe(expected.width)
  expect(actual.height).toBe(expected.height)
  expect(Array.from(actual.data)).toEqual(Array.from(expected.data))
}

test("filter facade and registry expose the same objects", () => {
  expect(facadeFilters).toBe(registryFilters)
  expect(facadeGetFilter).toBe(registryGetFilter)
  expect(Object.keys(facadeFilters)).toEqual(Object.keys(registryFilters))
})

test("filter facade and composite module share the canonical implementation", () => {
  expect(facadeComposite).toBe(moduleComposite)

  const before = new ImageData(new Uint8ClampedArray([100, 120, 140, 255]), 1, 1)
  const after = new ImageData(new Uint8ClampedArray([200, 40, 80, 255]), 1, 1)
  const result = moduleComposite(before, after, {
    opacity: 0.5,
    blendMode: "normal",
  })

  expect(Array.from(result.data)).toEqual([150, 80, 110, 255])
})

test("basic algorithm module matches registry filter output", () => {
  const src = fixture3x3()
  const cases: Array<{
    id: string
    params: Record<string, number | string | boolean>
    direct: () => ImageData
  }> = [
    { id: "gaussian-blur", params: { radius: 3 }, direct: () => gaussianBlur(src, 3) },
    { id: "box-blur", params: { radius: 2 }, direct: () => boxBlur(src, 2) },
    { id: "motion-blur", params: { distance: 2, angle: 30 }, direct: () => motionBlur(src, 2, 30) },
    { id: "sharpen", params: { amount: 75 }, direct: () => sharpen(src, 75) },
    { id: "unsharp-mask", params: { amount: 80, radius: 2 }, direct: () => unsharpMask(src, 80, 2) },
    { id: "find-edges", params: {}, direct: () => findEdges(src) },
    { id: "emboss", params: { amount: 60 }, direct: () => emboss(src, 60) },
    { id: "solarize", params: { threshold: 120 }, direct: () => solarize(src, 120) },
    { id: "pixelate", params: { size: 2 }, direct: () => pixelate(src, 2) },
    { id: "noise", params: { amount: 0, mono: true, distribution: "uniform" }, direct: () => noise(src, 0, true, false) },
    {
      id: "brightness-contrast",
      params: { brightness: 20, contrast: -15, useLegacy: false },
      direct: () => brightnessContrast(src, 20, -15, false),
    },
  ]

  for (const item of cases) {
    const filter = facadeGetFilter(item.id)
    expect(filter, item.id).toBeTruthy()
    expectSamePixels(item.direct(), filter!.apply(src, item.params))
  }
})

test("pixel helpers preserve the registry's numeric behavior", () => {
  expect(clamp8(-1)).toBe(0)
  expect(clamp8(12.5)).toBe(12.5)
  expect(clamp8(300)).toBe(255)
  expect(clamp01(-0.1)).toBe(0)
  expect(clamp01(0.25)).toBe(0.25)
  expect(clamp01(1.1)).toBe(1)
  expect(luma(100, 150, 200)).toBeCloseTo(140.75, 10)
  expect(numberParam("12.5", 3)).toBe(12.5)
  expect(numberParam("not-a-number", 3)).toBe(3)
  expect(parseBool(true, false)).toBe(true)
  expect(parseBool("true", false)).toBe(false)
  expect(parseNumber("9.5", 2)).toBe(9.5)
  expect(parseNumber("bad", 2)).toBe(2)
})

test("pixel helpers clone image data and preserve RGB/HSL conversion", () => {
  const src = fixture3x3()
  const copy = cloneImageData(src)
  expect(copy).not.toBe(src)
  expect(copy.data).not.toBe(src.data)
  expectSamePixels(copy, src)

  const hsl = rgbToHsl(64, 128, 192)
  expect(hsl.h).toBeCloseTo(0.5833333333333334, 12)
  expect(hsl.s).toBeCloseTo(0.5039370078740157, 12)
  expect(hsl.l).toBeCloseTo(0.5019607843137255, 12)
  const rgb = hslToRgb(hsl.h, hsl.s, hsl.l)
  expect(rgb.r).toBeCloseTo(64, 10)
  expect(rgb.g).toBeCloseTo(128, 10)
  expect(rgb.b).toBeCloseTo(192, 10)
})

test("curve helpers preserve parsing, interpolation, and dithering", () => {
  expect(parseCurvePoints("255,240;bad;128,160;-4,8")).toEqual([
    [0, 8],
    [128, 160],
    [255, 240],
  ])
  expect(parseCurvePoints(42, [[0, 5], [255, 250]])).toEqual([[0, 5], [255, 250]])

  const identity = monotoneCurveLut([[0, 0], [255, 255]])
  expect(Array.from(identity)).toEqual(Array.from({ length: 256 }, (_, value) => value))

  expect(pseudoDither(0)).toBeCloseTo(0.9216903898159217, 14)
  expect(pseudoDither(1)).toBeCloseTo(0.05721816934965318, 14)
  expect(pseudoDither(17)).toBeCloseTo(0.6441862510764622, 14)
})

test("adjustment facade exports retain canonical module identity", () => {
  expect(facadeHdrToningPresets).toBe(moduleHdrToningPresets)
  expect(facadeAutoDefaults).toBe(moduleAutoDefaults)
  expect(facadeApplyAutoAdjustment).toBe(moduleApplyAutoAdjustment)
  expect(facadeParseReplaceColorSamples).toBe(moduleParseReplaceColorSamples)
  expect(facadeFormatReplaceColorSamples).toBe(moduleFormatReplaceColorSamples)
})

test("adjustment algorithm module matches registry filter output", () => {
  const src = fixture3x3()
  const cases: Array<{
    id: string
    params: Record<string, number | string | boolean>
    direct: () => ImageData
  }> = [
    {
      id: "hue-saturation",
      params: { hue: 30, saturation: 25, lightness: -10, range: "reds", colorize: false },
      direct: () => hueSaturation(src, 30, 25, -10, "reds", false),
    },
    {
      id: "levels",
      params: { inputBlack: 12, inputWhite: 235, gamma: 1.2, outputBlack: 5, outputWhite: 245, channel: "green" },
      direct: () => levels(src, 12, 235, 1.2, 5, 245, "green"),
    },
    {
      id: "posterize",
      params: { levels: 5, dither: true },
      direct: () => posterize(src, 5, true),
    },
    {
      id: "selective-color",
      params: { range: "reds", cyan: 15, magenta: -10, yellow: 20, black: 5, method: "relative" },
      direct: () => selectiveColor(src, "reds", 15, -10, 20, 5, "relative"),
    },
    {
      id: "shadows-highlights",
      params: {
        shadowsAmount: 35,
        shadowsTonalWidth: 45,
        shadowsRadius: 2,
        highlightsAmount: 15,
        highlightsTonalWidth: 55,
        highlightsRadius: 3,
        colorCorrection: 20,
        midtoneContrast: 10,
        blackClip: 0.01,
        whiteClip: 0.01,
      },
      direct: () => shadowsHighlights(src, 35, 45, 2, 15, 55, 3, 20, 10, 0.01, 0.01),
    },
    {
      id: "hdr-toning",
      params: {
        method: "local-adaptation",
        radius: 2,
        strength: 90,
        edgeGlow: 20,
        gamma: 1.1,
        exposureEv: 0.2,
        detail: 10,
        shadow: 5,
        highlight: -5,
        vibrance: 15,
        saturation: 5,
        toningCurve: "0,0;128,140;255,250",
      },
      direct: () => hdrToning(src, "local-adaptation", 2, 90, 20, 1.1, 0.2, 10, 5, -5, 15, 5, [
        [0, 0],
        [128, 140],
        [255, 250],
      ]),
    },
  ]

  for (const item of cases) {
    const filter = facadeGetFilter(item.id)
    expect(filter, item.id).toBeTruthy()
    expectSamePixels(item.direct(), filter!.apply(src, item.params))
  }
})

test("selection-aware equalize remains identical across the module boundary", () => {
  const src = fixture3x3()
  const selectionMask = new Uint8Array([255, 255, 0, 255, 0, 0, 0, 255, 255])
  const filter = facadeGetFilter("equalize")

  expect(filter).toBeTruthy()
  expectSamePixels(
    equalize(src, "selection-only", selectionMask),
    filter!.apply(src, { mode: "selection-only" }, { selectionMask }),
  )
})
