import { expect, test } from "@playwright/test"

import {
  FILTERS as facadeFilters,
  compositeFilterImageData as facadeComposite,
  getFilter as facadeGetFilter,
} from "../components/photoshop/filters"
import {
  FILTERS as registryFilters,
  getFilter as registryGetFilter,
} from "../components/photoshop/filters/registry"
import {
  compositeFilterImageData as moduleComposite,
} from "../components/photoshop/filters/composite"

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
