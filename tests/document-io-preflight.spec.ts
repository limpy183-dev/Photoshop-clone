import { expect, test } from "@playwright/test"

import {
  canvasFromDataUrl,
  deserializeProject,
  deserializePsdFile,
  inspectImportFileDimensions,
  loadImageFromFile,
  loadRasterCanvasFromFile,
} from "../components/photoshop/document-io"
import { MAX_CANVAS_DIMENSION, MAX_CANVAS_PIXELS } from "../components/photoshop/canvas-limits"
import { installFixtureDom } from "./photoshop-fixtures"

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

function dataUrlFromBytes(bytes: Uint8Array, mime = "image/png") {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`
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

test("raster import can open oversized images at reduced scale without a full-size canvas", async () => {
  installFixtureDom()
  const file = new File([pngHeader(9000, 9000)], "oversized.png", { type: "image/png" })
  let objectUrlCreated = false
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL
  const originalImage = globalThis.Image

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => {
      objectUrlCreated = true
      return "blob:oversized"
    },
  })
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: () => undefined,
  })
  globalThis.Image = class {
    naturalWidth = 9000
    naturalHeight = 9000
    onload: (() => void) | null = null
    onerror: (() => void) | null = null

    set src(_value: string) {
      queueMicrotask(() => this.onload?.())
    }
  } as unknown as typeof Image

  try {
    const result = await loadRasterCanvasFromFile(file, { mode: "reduced-scale" })
    expect(result.mode).toBe("reduced-scale")
    expect(result.originalWidth).toBe(9000)
    expect(result.originalHeight).toBe(9000)
    expect(result.canvas.width).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
    expect(result.canvas.height).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
    expect(result.canvas.width * result.canvas.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
    expect(result.scale).toBeLessThan(1)
    expect(objectUrlCreated).toBe(true)
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

test("import dimension inspection reads PSD, PSB, and raster headers without full decode", async () => {
  const psd = new File([psdHeader(6400, 4200)], "poster.psd", { type: "image/vnd.adobe.photoshop" })
  const psb = new File([new Uint8Array([...ascii("8BPS"), ...be16(2), 0, 0, 0, 0, 0, 0, ...be16(4), ...be32(12000), ...be32(16000), ...be16(8), ...be16(3)])], "wrap.psb", { type: "image/vnd.adobe.photoshop" })
  const png = new File([pngHeader(3200, 1800)], "flat.png", { type: "image/png" })

  await expect(inspectImportFileDimensions(psd)).resolves.toMatchObject({ width: 6400, height: 4200, format: "PSD", kind: "psd" })
  await expect(inspectImportFileDimensions(psb)).resolves.toMatchObject({ width: 16000, height: 12000, format: "PSB", kind: "psb" })
  await expect(inspectImportFileDimensions(png)).resolves.toMatchObject({ width: 3200, height: 1800, format: "PNG", kind: "raster" })
})

test("project embedded image data URLs reject oversized headers before browser decode", async () => {
  installFixtureDom()
  const originalImage = globalThis.Image
  let imageConstructed = false

  globalThis.Image = class {
    constructor() {
      imageConstructed = true
      throw new Error("Browser decode should not start")
    }
  } as unknown as typeof Image

  try {
    await expect(canvasFromDataUrl(dataUrlFromBytes(pngHeader(9000, 9000)), 1, 1)).rejects.toThrow("Project image is too large")
    expect(imageConstructed).toBe(false)
  } finally {
    globalThis.Image = originalImage
  }
})

test("project import reports sanitizer truncation for rich plugin storage", async () => {
  installFixtureDom()
  const warnings: string[] = []
  const originalWarn = console.warn
  console.warn = (message?: unknown) => {
    warnings.push(String(message))
  }
  const records = Array.from({ length: 10_001 }, (_, index) => index)
  const project = JSON.stringify({
    document: {
      name: "Truncated Plugin State",
      width: 1,
      height: 1,
      background: "#ffffff",
      colorMode: "RGB",
      bitDepth: 8,
      activeLayerId: "layer_1",
      selectedLayerIds: ["layer_1"],
      selection: { bounds: null, shape: "rect" },
      layers: [{
        id: "layer_1",
        name: "Layer 1",
        kind: "raster",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
      }],
      pluginStorage: {
        plugin_1: { records },
      },
    },
  })

  let restored: Awaited<ReturnType<typeof deserializeProject>>
  try {
    restored = await deserializeProject(project)
  } finally {
    console.warn = originalWarn
  }

  expect((restored.pluginStorage?.plugin_1 as { records?: unknown[] } | undefined)?.records).toHaveLength(10_000)
  expect(restored.reports?.some((report) =>
    report.source === "Project Import" &&
    report.items.some((item) => item.label === "Sanitizer warning" && item.detail.includes("pluginStorage")),
  )).toBe(true)
  expect(warnings).toEqual([
    'Project field "pluginStorage" exceeded sanitiser limits and was truncated on load.',
  ])
})
