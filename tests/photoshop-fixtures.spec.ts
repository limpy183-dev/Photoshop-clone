import { expect, test } from "@playwright/test"

import { installFixtureDom } from "./photoshop-fixtures"

function restoreGlobal<T extends keyof typeof globalThis>(key: T, hadValue: boolean, value: (typeof globalThis)[T]) {
  if (hadValue) {
    ;(globalThis as Record<T, (typeof globalThis)[T]>)[key] = value
  } else {
    Reflect.deleteProperty(globalThis, key)
  }
}

test("installFixtureDom repairs partial canvas contexts left by other tests", () => {
  const hadDocument = "document" in globalThis
  const hadImage = "Image" in globalThis
  const hadImageData = "ImageData" in globalThis
  const originalDocument = globalThis.document
  const originalImage = globalThis.Image
  const originalImageData = globalThis.ImageData

  try {
    ;(globalThis as typeof globalThis & { document: Document }).document = {
      createElement: (tag: string) => {
        if (tag === "canvas") {
          return {
            width: 1,
            height: 1,
            getContext: () => ({
              fillRect: () => {},
              getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
              putImageData: () => {},
            }),
          } as unknown as HTMLCanvasElement
        }
        if (tag === "style") return { appendChild: () => {}, setAttribute: () => {}, style: {} } as unknown as HTMLElement
        throw new Error(`Unsupported partial document element: ${tag}`)
      },
    } as unknown as Document

    installFixtureDom()

    const ctx = document.createElement("canvas").getContext("2d")!
    expect(typeof ctx.createImageData).toBe("function")
    expect(ctx.createImageData(2, 3).data).toHaveLength(24)
  } finally {
    restoreGlobal("document", hadDocument, originalDocument)
    restoreGlobal("Image", hadImage, originalImage)
    restoreGlobal("ImageData", hadImageData, originalImageData)
  }
})

test("installFixtureDom re-patches an already marked document if createElement was overwritten", () => {
  const hadDocument = "document" in globalThis
  const hadImage = "Image" in globalThis
  const hadImageData = "ImageData" in globalThis
  const originalDocument = globalThis.document
  const originalImage = globalThis.Image
  const originalImageData = globalThis.ImageData

  try {
    installFixtureDom()
    const fixtureDocument = globalThis.document as Document & { createElement: Document["createElement"] }
    fixtureDocument.createElement = ((tag: string) => {
      if (tag === "canvas") {
        return {
          width: 1,
          height: 1,
          getContext: () => ({
            fillRect: () => {},
            getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
            putImageData: () => {},
          }),
        } as unknown as HTMLCanvasElement
      }
      if (tag === "style") return { appendChild: () => {}, setAttribute: () => {}, style: {} } as unknown as HTMLElement
      throw new Error(`Unsupported overwritten document element: ${tag}`)
    }) as Document["createElement"]

    installFixtureDom()

    const ctx = document.createElement("canvas").getContext("2d")!
    expect(typeof ctx.createImageData).toBe("function")
    expect(ctx.createImageData(1, 2).data).toHaveLength(8)
  } finally {
    restoreGlobal("document", hadDocument, originalDocument)
    restoreGlobal("Image", hadImage, originalImage)
    restoreGlobal("ImageData", hadImageData, originalImageData)
  }
})
