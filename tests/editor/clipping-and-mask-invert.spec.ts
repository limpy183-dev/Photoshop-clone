import { expect, test } from "@playwright/test"

import { clipBaseCanvas, clipCanvasToAlpha, invertMaskCanvas } from "@/editor/layer-workflows"
import type { Layer } from "@/editor/types"
import { installFixtureDom } from "@/tests/photoshop-fixtures"

/**
 * The shared fixture canvas stores a fill colour, not pixels, so it cannot show
 * whether clipping read the base's alpha or its luminance — which is the whole
 * question here. This is the smallest canvas that composites for real: one RGBA
 * buffer, source-over and destination-in draws, nothing else.
 */
function pixelCanvas(width: number, height: number, rgba?: [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4)
  if (rgba) for (let i = 0; i < data.length; i += 4) data.set(rgba, i)
  const canvas = {
    width,
    height,
    data,
    getContext: () => ({
      globalCompositeOperation: "source-over" as string,
      drawImage(source: { data: Uint8ClampedArray }) {
        for (let i = 0; i < data.length; i += 4) {
          if (this.globalCompositeOperation === "destination-in") {
            data[i + 3] = Math.round((data[i + 3] * source.data[i + 3]) / 255)
          } else {
            data.set(source.data.subarray(i, i + 4), i)
          }
        }
      },
      getImageData: () => ({ data, width, height }),
      putImageData: (image: { data: Uint8ClampedArray }) => data.set(image.data),
    }),
  }
  return canvas as unknown as HTMLCanvasElement & { data: Uint8ClampedArray }
}

test.beforeAll(() => {
  installFixtureDom()
  globalThis.document.createElement = ((tag: string) => {
    if (tag !== "canvas") throw new Error(`Unsupported element: ${tag}`)
    return pixelCanvas(1, 1)
  }) as Document["createElement"]
})

const layer = (id: string, overrides: Partial<Layer> = {}) =>
  ({
    id,
    name: id,
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: pixelCanvas(1, 1),
    ...overrides,
  }) as Layer

/* Clipping base resolution                                                    */

test("a clipping layer takes the nearest unclipped sibling below it", () => {
  const layers = [layer("base"), layer("clip1", { clipped: true }), layer("clip2", { clipped: true })]
  expect(clipBaseCanvas(layers, 1)).toBe(layers[0].canvas)
  expect(clipBaseCanvas(layers, 2)).toBe(layers[0].canvas)
  expect(clipBaseCanvas(layers, 0)).toBeNull()
})

test("clipping does not reach across a group boundary", () => {
  // Children precede their group entry, so "outside" sits below "inside".
  const layers = [layer("outside"), layer("inside", { parentId: "g", clipped: true }), layer("g", { kind: "group" })]
  expect(clipBaseCanvas(layers, 1)).toBeNull()
})

test("a group cannot be a clipping base, so the layer above it renders unclipped", () => {
  const layers = [layer("child", { parentId: "g" }), layer("g", { kind: "group" }), layer("top", { clipped: true })]
  expect(clipBaseCanvas(layers, 2)).toBeNull()
})

/* Clipping is alpha, not luminance                                            */

test("clipping to opaque black artwork keeps the clipped pixels", () => {
  const source = pixelCanvas(1, 1, [200, 100, 50, 255])
  const black = pixelCanvas(1, 1, [0, 0, 0, 255])
  expect([...(clipCanvasToAlpha(source, black) as typeof source).data]).toEqual([200, 100, 50, 255])
})

test("clipping erases what the base does not cover", () => {
  const source = pixelCanvas(1, 1, [200, 100, 50, 255])
  const hole = pixelCanvas(1, 1, [255, 255, 255, 0])
  expect([...(clipCanvasToAlpha(source, hole) as typeof source).data][3]).toBe(0)
})

/* Mask invert                                                                 */

test("inverting a mask swaps coverage whether it is opaque grey or a transparent shape", () => {
  const opaqueWhite = invertMaskCanvas(pixelCanvas(1, 1, [255, 255, 255, 255])) as ReturnType<typeof pixelCanvas>
  expect([...opaqueWhite.data]).toEqual([0, 0, 0, 255])

  // Selections produce white-on-transparent. Inverting RGB alone left alpha at
  // zero, so the "revealed" half stayed hidden and the layer vanished.
  const selectionOutside = invertMaskCanvas(pixelCanvas(1, 1, [255, 255, 255, 0])) as ReturnType<typeof pixelCanvas>
  expect([...selectionOutside.data]).toEqual([255, 255, 255, 255])

  const selectionInside = invertMaskCanvas(pixelCanvas(1, 1, [255, 255, 255, 255])) as ReturnType<typeof pixelCanvas>
  expect([...selectionInside.data]).toEqual([0, 0, 0, 255])
})
