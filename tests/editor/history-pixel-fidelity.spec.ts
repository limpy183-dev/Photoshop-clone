import { expect, test } from "@playwright/test"

test("deep-history raw RGBA round trip preserves every deterministic channel", async ({ page }) => {
  await page.goto("/")
  const result = await page.evaluate(async () => {
    const width = 128
    const height = 128
    const histories = Array.from({ length: 14 }, (_, historyIndex) => {
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext("2d")!
      const image = context.createImageData(width, height)
      let seed = 0x9e3779b9 ^ historyIndex
      for (let index = 0; index < image.data.length; index += 4) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        image.data[index] = seed & 0xff
        image.data[index + 1] = (seed >>> 8) & 0xff
        image.data[index + 2] = (seed >>> 16) & 0xff
        image.data[index + 3] = index % 20 === 0 ? (seed >>> 24) & 0xff : 255
      }
      context.putImageData(image, 0, 0)
      return { canvas }
    })

    // Entry zero is older than the twelve-entry hot-history window.
    const oldest = histories[0]
    const source = oldest.canvas.getContext("2d")!.getImageData(0, 0, width, height).data
    const compressed = new Blob([source]).stream().pipeThrough(new CompressionStream("deflate"))
    const blob = new Blob(
      [await new Response(compressed).arrayBuffer()],
      { type: "application/x-photoshop-history-rgba+deflate" },
    )
    const decompressed = blob.stream().pipeThrough(new DecompressionStream("deflate"))
    const restoredBytes = new Uint8ClampedArray(await new Response(decompressed).arrayBuffer())
    const restored = document.createElement("canvas")
    restored.width = width
    restored.height = height
    restored.getContext("2d")!.putImageData(new ImageData(restoredBytes, width, height), 0, 0)
    const actual = restored.getContext("2d")!.getImageData(0, 0, width, height).data
    let differences = 0
    let maxDelta = 0
    for (let index = 0; index < actual.length; index += 1) {
      const delta = Math.abs(actual[index] - source[index])
      if (delta) differences += 1
      maxDelta = Math.max(maxDelta, delta)
    }
    return { blobType: blob.type, differences, maxDelta }
  })

  expect(result).toEqual({
    blobType: "application/x-photoshop-history-rgba+deflate",
    differences: 0,
    maxDelta: 0,
  })
})
