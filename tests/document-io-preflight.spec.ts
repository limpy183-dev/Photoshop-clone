import { expect, test } from "@playwright/test"

import { deserializePsdFile, loadImageFromFile } from "../components/photoshop/document-io"

function ascii(value: string) {
  return Array.from(value, (ch) => ch.charCodeAt(0))
}

function be16(value: number) {
  return [(value >> 8) & 255, value & 255]
}

function be32(value: number) {
  return [(value >> 24) & 255, (value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function le16(value: number) {
  return [value & 255, (value >> 8) & 255]
}

function le24(value: number) {
  return [value & 255, (value >> 8) & 255, (value >> 16) & 255]
}

function le32(value: number) {
  return [value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255]
}

function psdHeader(width: number, height: number) {
  return new Uint8Array([
    ...ascii("8BPS"),
    ...be16(1),
    0, 0, 0, 0, 0, 0,
    ...be16(4),
    ...be32(height),
    ...be32(width),
    ...be16(8),
    ...be16(3),
  ])
}

function pngHeader(width: number, height: number) {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13,
    ...ascii("IHDR"),
    ...be32(width),
    ...be32(height),
    8, 6, 0, 0, 0,
    0, 0, 0, 0,
  ])
}

function gifHeader(width: number, height: number) {
  return new Uint8Array([
    ...ascii("GIF89a"),
    ...le16(width),
    ...le16(height),
    0, 0, 0,
  ])
}

function webpHeader(width: number, height: number) {
  return new Uint8Array([
    ...ascii("RIFF"),
    ...le32(30),
    ...ascii("WEBP"),
    ...ascii("VP8X"),
    ...le32(10),
    0, 0, 0, 0,
    ...le24(width - 1),
    ...le24(height - 1),
  ])
}

test("PSD import rejects oversized header dimensions before full decode", async () => {
  const file = new File([psdHeader(9000, 9000)], "oversized.psd", {
    type: "image/vnd.adobe.photoshop",
  })

  await expect(deserializePsdFile(file)).rejects.toThrow("PSD canvas is too large")
})

for (const fixture of [
  { name: "PNG", bytes: pngHeader(9000, 9000), filename: "oversized.png", type: "image/png" },
  { name: "GIF", bytes: gifHeader(9000, 9000), filename: "oversized.gif", type: "image/gif" },
  { name: "WebP", bytes: webpHeader(9000, 9000), filename: "oversized.webp", type: "image/webp" },
]) {
  test(`raster import rejects oversized ${fixture.name} dimensions before browser decode`, async () => {
    const file = new File([fixture.bytes], fixture.filename, { type: fixture.type })
    let objectUrlCreated = false
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevokeObjectURL = URL.revokeObjectURL
    const originalImage = globalThis.Image

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: () => {
        objectUrlCreated = true
        return "blob:test"
      },
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: () => undefined,
    })
    globalThis.Image = class {
      constructor() {
        throw new Error("Browser decode should not start")
      }
    } as unknown as typeof Image

    try {
      await expect(loadImageFromFile(file)).rejects.toThrow("Image canvas is too large")
      expect(objectUrlCreated).toBe(false)
    } finally {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectURL,
      })
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectURL,
      })
      globalThis.Image = originalImage
    }
  })
}

test("raster import preserves browser decode for acceptable images", async () => {
  const file = new File([pngHeader(2, 1)], "small.png", { type: "image/png" })
  let objectUrlCreated = false
  let revokedUrl = ""
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL
  const originalImage = globalThis.Image

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => {
      objectUrlCreated = true
      return "blob:small"
    },
  })
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: (url: string) => {
      revokedUrl = url
    },
  })
  globalThis.Image = class {
    naturalWidth = 2
    naturalHeight = 1
    onload: (() => void) | null = null
    onerror: (() => void) | null = null

    set src(_value: string) {
      queueMicrotask(() => this.onload?.())
    }
  } as unknown as typeof Image

  try {
    const img = await loadImageFromFile(file)
    expect(img.naturalWidth).toBe(2)
    expect(img.naturalHeight).toBe(1)
    expect(objectUrlCreated).toBe(true)
    expect(revokedUrl).toBe("blob:small")
  } finally {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectURL,
    })
    globalThis.Image = originalImage
  }
})
