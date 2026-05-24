import { expect, test } from "@playwright/test"

import {
  CHANNELS_MASKS_CAPABILITY,
  appAlphaChannelsToMarkerLayers,
  appAlphaChannelsToPsd,
  appClippingToPsd,
  appLayerMaskToPsd,
  appSpotChannelToPsd,
  appVectorMaskOnLayerToPsd,
  formatSpotChannelName,
  isAlphaChannelMarkerLayer,
  parseSpotChannelName,
  psdAlphaChannelsToApp,
  psdLayerMaskToApp,
  psdVectorMaskOnLayerToApp,
  validateClippingGroup,
} from "../components/photoshop/psd-channels-masks"
import type { AlphaChannel, Layer, PathProps, PsDocument } from "../components/photoshop/types"
import type { Psd, Layer as PsdLayer } from "ag-psd"

/* -------------------------------------------------------------------------- */
/* Pixel-aware canvas mock                                                     */
/*                                                                            */
/* The thin FixtureCanvas in photoshop-fixtures.ts only tracks a single fill  */
/* colour, which is enough for serialization-shape tests but not for the      */
/* pixel-level round-trips required by mask defaultColor + bounds detection.  */
/* This mock keeps a real ImageData buffer and supports the minimal subset    */
/* of CanvasRenderingContext2D used by psd-channels-masks.ts.                 */
/* -------------------------------------------------------------------------- */

class PixelCanvas {
  private _width = 1
  private _height = 1
  private buffer: Uint8ClampedArray = new Uint8ClampedArray(4)
  private currentFill = "#000000"

  constructor(width = 1, height = 1) {
    this.width = width
    this.height = height
  }

  get width() {
    return this._width
  }

  set width(value: number) {
    const w = Math.max(1, Math.floor(value))
    if (w === this._width) return
    this._width = w
    this.buffer = new Uint8ClampedArray(this._width * this._height * 4)
  }

  get height() {
    return this._height
  }

  set height(value: number) {
    const h = Math.max(1, Math.floor(value))
    if (h === this._height) return
    this._height = h
    this.buffer = new Uint8ClampedArray(this._width * this._height * 4)
  }

  setSize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  getContext(kind: string) {
    if (kind !== "2d") return null
    const ctx = {
      _fillStyle: "#000000",
      get fillStyle() {
        return this._fillStyle
      },
      set fillStyle(value: string) {
        this._fillStyle = value
      },
      globalCompositeOperation: "source-over",
      fillRect: (x: number, y: number, w: number, h: number) => {
        const { r, g, b, a } = parseCssColor(ctx._fillStyle)
        const x0 = Math.max(0, Math.floor(x))
        const y0 = Math.max(0, Math.floor(y))
        const x1 = Math.min(this.width, Math.floor(x + w))
        const y1 = Math.min(this.height, Math.floor(y + h))
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = x0; xx < x1; xx++) {
            const i = (yy * this.width + xx) * 4
            this.buffer[i] = r
            this.buffer[i + 1] = g
            this.buffer[i + 2] = b
            this.buffer[i + 3] = a
          }
        }
        this.currentFill = ctx._fillStyle
      },
      clearRect: (x: number, y: number, w: number, h: number) => {
        const x0 = Math.max(0, Math.floor(x))
        const y0 = Math.max(0, Math.floor(y))
        const x1 = Math.min(this.width, Math.floor(x + w))
        const y1 = Math.min(this.height, Math.floor(y + h))
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = x0; xx < x1; xx++) {
            const i = (yy * this.width + xx) * 4
            this.buffer[i] = 0
            this.buffer[i + 1] = 0
            this.buffer[i + 2] = 0
            this.buffer[i + 3] = 0
          }
        }
      },
      drawImage: (
        source: PixelCanvas,
        ...args: number[]
      ) => {
        if (!source || typeof source.getContext !== "function") return
        let sx = 0
        let sy = 0
        let sw = source.width
        let sh = source.height
        let dx = 0
        let dy = 0
        let dw = source.width
        let dh = source.height
        if (args.length === 2) {
          dx = args[0]
          dy = args[1]
        } else if (args.length === 4) {
          dx = args[0]
          dy = args[1]
          dw = args[2]
          dh = args[3]
        } else if (args.length === 8) {
          sx = args[0]
          sy = args[1]
          sw = args[2]
          sh = args[3]
          dx = args[4]
          dy = args[5]
          dw = args[6]
          dh = args[7]
        }
        const srcCtx = source.getContext("2d") as {
          getImageData: (a: number, b: number, c: number, d: number) => ImageData
        } | null
        if (!srcCtx) return
        // No scaling support; tests always pass 1:1 source/destination boxes.
        const srcW = Math.min(sw, dw)
        const srcH = Math.min(sh, dh)
        for (let yy = 0; yy < srcH; yy++) {
          const sourceY = sy + yy
          const destY = dy + yy
          if (destY < 0 || destY >= this.height) continue
          if (sourceY < 0 || sourceY >= source.height) continue
          for (let xx = 0; xx < srcW; xx++) {
            const sourceX = sx + xx
            const destX = dx + xx
            if (destX < 0 || destX >= this.width) continue
            if (sourceX < 0 || sourceX >= source.width) continue
            const si = (sourceY * source.width + sourceX) * 4
            const di = (destY * this.width + destX) * 4
            this.buffer[di] = source.buffer[si]
            this.buffer[di + 1] = source.buffer[si + 1]
            this.buffer[di + 2] = source.buffer[si + 2]
            this.buffer[di + 3] = source.buffer[si + 3]
          }
        }
      },
      getImageData: (x: number, y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4)
        for (let yy = 0; yy < h; yy++) {
          for (let xx = 0; xx < w; xx++) {
            const sx = x + xx
            const sy = y + yy
            const di = (yy * w + xx) * 4
            if (sx < 0 || sx >= this.width || sy < 0 || sy >= this.height) continue
            const si = (sy * this.width + sx) * 4
            data[di] = this.buffer[si]
            data[di + 1] = this.buffer[si + 1]
            data[di + 2] = this.buffer[si + 2]
            data[di + 3] = this.buffer[si + 3]
          }
        }
        return new FixtureImageData(data, w, h) as unknown as ImageData
      },
      putImageData: (image: ImageData, x: number, y: number) => {
        const w = image.width
        const h = image.height
        for (let yy = 0; yy < h; yy++) {
          for (let xx = 0; xx < w; xx++) {
            const dx = x + xx
            const dy = y + yy
            if (dx < 0 || dx >= this.width || dy < 0 || dy >= this.height) continue
            const di = (dy * this.width + dx) * 4
            const si = (yy * w + xx) * 4
            this.buffer[di] = image.data[si]
            this.buffer[di + 1] = image.data[si + 1]
            this.buffer[di + 2] = image.data[si + 2]
            this.buffer[di + 3] = image.data[si + 3]
          }
        }
      },
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      rect: () => {},
      clip: () => {},
      translate: () => {},
      scale: () => {},
      rotate: () => {},
      setTransform: () => {},
    }
    return ctx
  }

  /** Convenience accessor for tests. */
  getPixel(x: number, y: number): { r: number; g: number; b: number; a: number } {
    const i = (y * this.width + x) * 4
    return {
      r: this.buffer[i],
      g: this.buffer[i + 1],
      b: this.buffer[i + 2],
      a: this.buffer[i + 3],
    }
  }

  toDataURL() {
    return `data:image/pixel,${this.currentFill}`
  }
}

class FixtureImageData {
  data: Uint8ClampedArray
  width: number
  height: number
  colorSpace: PredefinedColorSpace = "srgb"

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth
      this.height = widthOrHeight
      this.data = new Uint8ClampedArray(this.width * this.height * 4)
    } else {
      this.data = dataOrWidth
      this.width = widthOrHeight
      this.height = height ?? Math.max(1, Math.floor(dataOrWidth.length / 4 / widthOrHeight))
    }
  }
}

function parseCssColor(style: string): { r: number; g: number; b: number; a: number } {
  if (!style) return { r: 0, g: 0, b: 0, a: 255 }
  if (style.startsWith("#")) {
    const clean = style.slice(1)
    const expanded =
      clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean.padEnd(6, "0").slice(0, 6)
    const num = Number.parseInt(expanded, 16)
    return {
      r: (num >> 16) & 0xff,
      g: (num >> 8) & 0xff,
      b: num & 0xff,
      a: 255,
    }
  }
  const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)$/i.exec(style)
  if (rgbMatch) {
    const [, r, g, b, a] = rgbMatch
    return {
      r: Number.parseInt(r, 10),
      g: Number.parseInt(g, 10),
      b: Number.parseInt(b, 10),
      a: a == null ? 255 : Math.round(Number.parseFloat(a) * 255),
    }
  }
  return { r: 0, g: 0, b: 0, a: 255 }
}

function installPixelDom() {
  const head = { appendChild: () => {}, insertBefore: () => {} } as unknown as HTMLHeadElement
  if (typeof globalThis.document === "undefined") {
    ;(globalThis as typeof globalThis & { document: Document }).document = {
      createElement: (tag: string) => {
        if (tag !== "canvas") throw new Error(`Unsupported pixel-DOM element: ${tag}`)
        return new PixelCanvas() as unknown as HTMLCanvasElement
      },
      createTextNode: () => ({}) as Text,
      getElementsByTagName: (tag: string) => (tag === "head" ? [head] : []) as unknown as HTMLCollectionOf<Element>,
      head,
    } as unknown as Document
  } else {
    const original = (globalThis.document as Document).createElement.bind(globalThis.document) as (
      tag: string,
    ) => unknown
    ;(globalThis.document as Document).createElement = ((tag: string) => {
      if (tag === "canvas") return new PixelCanvas() as unknown as HTMLCanvasElement
      return original(tag)
    }) as Document["createElement"]
  }
  if (typeof globalThis.ImageData === "undefined") {
    ;(globalThis as typeof globalThis & { ImageData: typeof ImageData }).ImageData =
      FixtureImageData as unknown as typeof ImageData
  }
}

function pixelCanvas(width: number, height: number): PixelCanvas {
  const canvas = new PixelCanvas(width, height)
  return canvas
}

function fillSolid(canvas: PixelCanvas, color: string) {
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = color
  ctx.fillRect(0, 0, canvas.width, canvas.height)
}

function fillRect(canvas: PixelCanvas, x: number, y: number, w: number, h: number, color: string) {
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = color
  ctx.fillRect(x, y, w, h)
}

function emptyDoc(overrides: Partial<PsDocument> = {}): PsDocument {
  return {
    id: "doc",
    name: "test",
    width: 32,
    height: 24,
    zoom: 1,
    layers: [],
    activeLayerId: "",
    selectedLayerIds: [],
    background: "#ffffff",
    colorMode: "RGB",
    bitDepth: 8,
    selection: { bounds: null, shape: "rect" },
    ...overrides,
  }
}

function emptyLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: "layer",
    name: "Layer",
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: pixelCanvas(8, 8) as unknown as HTMLCanvasElement,
    ...overrides,
  }
}

installPixelDom()

/* -------------------------------------------------------------------------- */
/* Capability metadata                                                         */
/* -------------------------------------------------------------------------- */

test("CHANNELS_MASKS_CAPABILITY advertises round-trip support for all major sub-features", () => {
  expect(CHANNELS_MASKS_CAPABILITY.rasterMasks).toBe("round-trip")
  expect(CHANNELS_MASKS_CAPABILITY.maskDefaultColor).toBe("round-trip")
  expect(CHANNELS_MASKS_CAPABILITY.maskDisabled).toBe("round-trip")
  expect(CHANNELS_MASKS_CAPABILITY.maskPosition).toBe("round-trip")
  expect(CHANNELS_MASKS_CAPABILITY.alphaChannels).toBe("round-trip")
  expect(CHANNELS_MASKS_CAPABILITY.spotChannels).toBe("round-trip-via-naming")
  expect(CHANNELS_MASKS_CAPABILITY.layerVectorMasks).toBe("round-trip")
  expect(CHANNELS_MASKS_CAPABILITY.clippingMasks).toBe("round-trip")
})

/* -------------------------------------------------------------------------- */
/* Raster layer mask round-trips                                               */
/* -------------------------------------------------------------------------- */

test("layer mask round-trips when the surrounding default color is white and dark content sits inside", () => {
  const mask = pixelCanvas(32, 24)
  // White border, dark inset content
  fillSolid(mask, "#ffffff")
  fillRect(mask, 6, 4, 10, 8, "#101010")

  const layer = emptyLayer({ mask: mask as unknown as HTMLCanvasElement, maskEnabled: true })

  const psdMask = appLayerMaskToPsd(layer, 32, 24)
  expect(psdMask).toBeDefined()
  expect(psdMask?.defaultColor).toBe(255)
  expect(psdMask?.disabled).toBe(false)
  // Bounds should tightly enclose the dark inset rectangle.
  expect(psdMask?.left).toBeGreaterThanOrEqual(5)
  expect(psdMask?.left).toBeLessThanOrEqual(6)
  expect(psdMask?.top).toBeGreaterThanOrEqual(3)
  expect(psdMask?.top).toBeLessThanOrEqual(4)
  expect(psdMask?.right).toBeGreaterThanOrEqual(15)
  expect(psdMask?.right).toBeLessThanOrEqual(17)
  expect(psdMask?.bottom).toBeGreaterThanOrEqual(11)
  expect(psdMask?.bottom).toBeLessThanOrEqual(13)
  expect(psdMask?.canvas).toBeTruthy()

  // Reverse trip
  const restored = psdLayerMaskToApp(psdMask!, 32, 24)
  expect(restored).not.toBeNull()
  expect(restored!.maskEnabled).toBe(true)
  expect(restored!.mask.width).toBe(32)
  expect(restored!.mask.height).toBe(24)

  // Outside the cropped bounds the canvas should hold defaultColor (white).
  const outside = (restored!.mask as unknown as PixelCanvas).getPixel(0, 0)
  expect(outside.r).toBe(255)
  expect(outside.g).toBe(255)
  expect(outside.b).toBe(255)
  // Inside the cropped bounds the content should be visible (dark).
  const inside = (restored!.mask as unknown as PixelCanvas).getPixel(10, 8)
  expect(inside.r).toBeLessThan(60)
})

test("layer mask carries the disabled state through round-trip", () => {
  const mask = pixelCanvas(16, 12)
  fillSolid(mask, "#ffffff")
  fillRect(mask, 4, 4, 4, 4, "#000000")
  const layer = emptyLayer({ mask: mask as unknown as HTMLCanvasElement, maskEnabled: false })

  const psdMask = appLayerMaskToPsd(layer, 16, 12)
  expect(psdMask).toBeDefined()
  expect(psdMask?.disabled).toBe(true)

  const restored = psdLayerMaskToApp(psdMask!, 16, 12)
  expect(restored?.maskEnabled).toBe(false)
})

test("layer mask preserves an off-centre patch position through round-trip", () => {
  const mask = pixelCanvas(40, 28)
  // Black border so defaultColor=0, and a bright off-centre patch.
  fillSolid(mask, "#000000")
  fillRect(mask, 22, 14, 8, 6, "#ffffff")

  const layer = emptyLayer({ mask: mask as unknown as HTMLCanvasElement, maskEnabled: true })

  const psdMask = appLayerMaskToPsd(layer, 40, 28)
  expect(psdMask?.defaultColor).toBe(0)
  expect(psdMask?.left).toBeGreaterThanOrEqual(21)
  expect(psdMask?.top).toBeGreaterThanOrEqual(13)
  expect(psdMask?.right).toBeLessThanOrEqual(31)
  expect(psdMask?.bottom).toBeLessThanOrEqual(21)

  const restored = psdLayerMaskToApp(psdMask!, 40, 28)
  expect(restored).not.toBeNull()
  const outside = (restored!.mask as unknown as PixelCanvas).getPixel(0, 0)
  expect(outside.r).toBe(0)
  const inside = (restored!.mask as unknown as PixelCanvas).getPixel(24, 16)
  expect(inside.r).toBeGreaterThan(200)
})

test("layer mask without a stored canvas returns null", () => {
  const layer = emptyLayer({ mask: undefined, maskEnabled: true })
  expect(appLayerMaskToPsd(layer, 16, 12)).toBeUndefined()
})

/* -------------------------------------------------------------------------- */
/* Saved alpha channels (document level)                                       */
/* -------------------------------------------------------------------------- */

test("two saved alpha channels survive a round-trip via the marker layer group", async () => {
  const channelA = pixelCanvas(20, 16)
  fillSolid(channelA, "#000000")
  fillRect(channelA, 4, 4, 6, 4, "#ffffff")

  const channelB = pixelCanvas(20, 16)
  fillSolid(channelB, "#808080")
  fillRect(channelB, 10, 8, 4, 4, "#202020")

  const doc = emptyDoc({
    width: 20,
    height: 16,
    channels: [
      { id: "alpha_one", name: "Saved Selection A", canvas: channelA as unknown as HTMLCanvasElement },
      { id: "alpha_two", name: "Saved Selection B", canvas: channelB as unknown as HTMLCanvasElement },
    ],
  })

  const exported = appAlphaChannelsToPsd(doc)
  expect(exported.channels).toBeUndefined()
  expect(exported.channelNames).toEqual(["Saved Selection A", "Saved Selection B"])
  expect(exported.displayInfo).toBeDefined()
  expect(exported.displayInfo).toHaveLength(2)
  expect(exported.displayInfo?.[0].kind).toBe("alpha")

  const markerGroup = appAlphaChannelsToMarkerLayers(doc)
  expect(markerGroup).not.toBeNull()
  expect(isAlphaChannelMarkerLayer(markerGroup!)).toBe(true)
  expect(markerGroup!.hidden).toBe(true)
  expect(markerGroup!.children).toHaveLength(2)
  expect(markerGroup!.children?.[0].name).toBe("Saved Selection A")
  expect(markerGroup!.children?.[1].name).toBe("Saved Selection B")

  // Simulate the integrator-produced PSD object.
  const fakePsd = {
    width: 20,
    height: 16,
    imageResources: { alphaChannelNames: exported.channelNames },
    children: [markerGroup!] as PsdLayer[],
  } as Psd

  const round = await psdAlphaChannelsToApp(fakePsd, 20, 16)
  expect(round).toHaveLength(2)
  expect(round[0].name).toBe("Saved Selection A")
  expect(round[1].name).toBe("Saved Selection B")
  expect(round[0].canvas.width).toBe(20)
  expect(round[0].canvas.height).toBe(16)
})

test("psdAlphaChannelsToApp falls back to placeholder canvases when only names survive", async () => {
  const fakePsd = {
    width: 12,
    height: 8,
    imageResources: { alphaChannelNames: ["Ghost"] },
    children: [],
  } as unknown as Psd
  const channels = await psdAlphaChannelsToApp(fakePsd, 12, 8)
  expect(channels).toHaveLength(1)
  expect(channels[0].name).toBe("Ghost")
  expect(channels[0].canvas.width).toBe(12)
  expect(channels[0].canvas.height).toBe(8)
})

/* -------------------------------------------------------------------------- */
/* Spot channels (naming convention)                                           */
/* -------------------------------------------------------------------------- */

test("spot channel naming convention round-trips colour and opacity", () => {
  const encoded = formatSpotChannelName("Magenta Plate", "#ff0099", 80)
  expect(encoded).toBe("[spot:#ff0099:80]Magenta Plate")

  const parsed = parseSpotChannelName(encoded)
  expect(parsed.baseName).toBe("Magenta Plate")
  expect(parsed.spotColor).toBe("#ff0099")
  expect(parsed.spotOpacity).toBe(80)
})

test("parseSpotChannelName treats plain names as alpha channels", () => {
  const parsed = parseSpotChannelName("Just Alpha")
  expect(parsed.spotColor).toBeUndefined()
  expect(parsed.baseName).toBe("Just Alpha")
})

test("spot channel export tags name, colour, opacity, and pixel canvas", () => {
  const canvas = pixelCanvas(12, 12)
  fillSolid(canvas, "#000000")
  fillRect(canvas, 2, 2, 4, 4, "#cccccc")
  const channel: AlphaChannel & { spotColor?: string; spotOpacity?: number } = {
    id: "spot_one",
    name: "PMS 185",
    canvas: canvas as unknown as HTMLCanvasElement,
    spotColor: "#e1001a",
    spotOpacity: 90,
  }

  const spot = appSpotChannelToPsd(channel)
  expect(spot).not.toBeNull()
  expect(spot!.name).toBe("[spot:#e1001a:90]PMS 185")
  expect(spot!.color).toEqual({ r: 0xe1, g: 0x00, b: 0x1a })
  expect(spot!.opacity).toBe(90)
  expect(spot!.canvas).toBe(canvas)
})

test("spot channel export uses encoded-name metadata when explicit fields are missing", () => {
  const canvas = pixelCanvas(8, 8)
  fillSolid(canvas, "#404040")
  const channel: AlphaChannel = {
    id: "spot_two",
    name: "[spot:#00aaff:70]Cyan Highlight",
    canvas: canvas as unknown as HTMLCanvasElement,
  }
  const spot = appSpotChannelToPsd(channel)
  expect(spot).not.toBeNull()
  expect(spot!.name).toBe("[spot:#00aaff:70]Cyan Highlight")
  expect(spot!.color).toEqual({ r: 0x00, g: 0xaa, b: 0xff })
  expect(spot!.opacity).toBe(70)
})

test("appSpotChannelToPsd refuses to upgrade a plain alpha channel without colour information", () => {
  const canvas = pixelCanvas(4, 4)
  fillSolid(canvas, "#000000")
  const channel: AlphaChannel = {
    id: "plain",
    name: "Plain Alpha",
    canvas: canvas as unknown as HTMLCanvasElement,
  }
  expect(appSpotChannelToPsd(channel)).toBeNull()
})

test("appAlphaChannelsToPsd reports spot channels in the displayInfo array using the naming convention", () => {
  const canvas = pixelCanvas(4, 4)
  fillSolid(canvas, "#000000")
  const doc = emptyDoc({
    width: 4,
    height: 4,
    channels: [
      { id: "a", name: "Plain", canvas: canvas as unknown as HTMLCanvasElement },
      {
        id: "s",
        name: "[spot:#ff8800:60]Orange Spot",
        canvas: canvas as unknown as HTMLCanvasElement,
      },
    ],
  })
  const exported = appAlphaChannelsToPsd(doc)
  expect(exported.displayInfo).toBeDefined()
  expect(exported.displayInfo?.[0].kind).toBe("alpha")
  expect(exported.displayInfo?.[1].kind).toBe("spot")
  expect(exported.displayInfo?.[1].name).toBe("Orange Spot")
  expect(exported.displayInfo?.[1].color).toEqual({ r: 0xff, g: 0x88, b: 0x00 })
  expect(exported.displayInfo?.[1].opacity).toBe(60)
})

/* -------------------------------------------------------------------------- */
/* Vector mask on a layer                                                      */
/* -------------------------------------------------------------------------- */

test("layer vector mask round-trips bezier handles and closed flag", () => {
  const path: PathProps = {
    closed: true,
    points: [
      { x: 10, y: 10, cp1: { x: 8, y: 8 }, cp2: { x: 12, y: 12 } },
      { x: 30, y: 10, cp1: { x: 28, y: 8 }, cp2: { x: 32, y: 12 } },
      { x: 30, y: 24, cp1: { x: 32, y: 22 }, cp2: { x: 28, y: 26 } },
      { x: 10, y: 24, cp1: { x: 12, y: 22 }, cp2: { x: 8, y: 26 } },
    ],
  }

  const psdMask = appVectorMaskOnLayerToPsd(path, 64, 48)
  expect(psdMask.paths).toHaveLength(1)
  expect(psdMask.paths[0].open).toBe(false)
  expect(psdMask.paths[0].knots).toHaveLength(4)
  // Check the first knot encodes (cp1, anchor, cp2) in order.
  expect(psdMask.paths[0].knots[0].points).toEqual([8, 8, 10, 10, 12, 12])
  expect(psdMask.disable).toBe(false)
  expect(psdMask.invert).toBe(false)

  const restored = psdVectorMaskOnLayerToApp(psdMask)
  expect(restored.closed).toBe(true)
  expect(restored.points).toHaveLength(4)
  expect(restored.points[0]).toEqual({
    x: 10,
    y: 10,
    cp1: { x: 8, y: 8 },
    cp2: { x: 12, y: 12 },
  })
  expect(restored.points[2]).toEqual({
    x: 30,
    y: 24,
    cp1: { x: 32, y: 22 },
    cp2: { x: 28, y: 26 },
  })
})

test("layer vector mask round-trips open paths and corner knots (no handles)", () => {
  const path: PathProps = {
    closed: false,
    points: [
      { x: 5, y: 5 },
      { x: 25, y: 15 },
      { x: 45, y: 5 },
    ],
  }
  const psdMask = appVectorMaskOnLayerToPsd(path, 50, 50)
  expect(psdMask.paths[0].open).toBe(true)
  // Corner knots should encode cp1 = cp2 = anchor.
  expect(psdMask.paths[0].knots[0].points).toEqual([5, 5, 5, 5, 5, 5])
  const restored = psdVectorMaskOnLayerToApp(psdMask)
  expect(restored.closed).toBe(false)
  expect(restored.points[0].cp1).toBeUndefined()
  expect(restored.points[0].cp2).toBeUndefined()
})

/* -------------------------------------------------------------------------- */
/* Clipping masks                                                              */
/* -------------------------------------------------------------------------- */

test("appClippingToPsd surfaces the layer's clipped flag verbatim", () => {
  expect(appClippingToPsd(emptyLayer({ clipped: true })).clipping).toBe(true)
  expect(appClippingToPsd(emptyLayer({ clipped: false })).clipping).toBe(false)
  expect(appClippingToPsd(emptyLayer({ clipped: undefined })).clipping).toBe(false)
})

test("validateClippingGroup accepts a valid base + two clipped layers", () => {
  const layers: Layer[] = [
    emptyLayer({ id: "base", name: "Base", clipped: false }),
    emptyLayer({ id: "clip1", name: "Clip 1", clipped: true }),
    emptyLayer({ id: "clip2", name: "Clip 2", clipped: true }),
  ]
  const { warnings } = validateClippingGroup(layers)
  expect(warnings).toEqual([])
})

test("validateClippingGroup flags an orphan clipped layer with no base beneath", () => {
  const layers: Layer[] = [
    emptyLayer({ id: "orphan", name: "Orphan Top", clipped: true }),
    emptyLayer({ id: "base", name: "Base Under", clipped: false }),
  ]
  const { warnings } = validateClippingGroup(layers)
  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toContain("Orphan Top")
  expect(warnings[0]).toContain("no base layer")
})

test("validateClippingGroup warns when the base is a group layer (not raster)", () => {
  const layers: Layer[] = [
    emptyLayer({ id: "g", name: "Folder", kind: "group", clipped: false }),
    emptyLayer({ id: "c", name: "Clipped Child", clipped: true }),
  ]
  const { warnings } = validateClippingGroup(layers)
  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toContain("Clipped Child")
  expect(warnings[0]).toContain("Folder")
})

test("validateClippingGroup scopes orphan detection to the parent group", () => {
  // Clipped layer's "base" should be in the same parent group; otherwise it's an orphan.
  const layers: Layer[] = [
    emptyLayer({ id: "outer", name: "Outer Base", clipped: false, parentId: undefined }),
    emptyLayer({ id: "inner-orphan", name: "Inner Orphan", clipped: true, parentId: "g1" }),
  ]
  const { warnings } = validateClippingGroup(layers)
  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toContain("Inner Orphan")
})

test("validateClippingGroup flags every orphan in a group with multiple clipped-but-baseless layers", () => {
  const layers: Layer[] = [
    emptyLayer({ id: "o1", name: "Orphan A", clipped: true, parentId: "g1" }),
    emptyLayer({ id: "o2", name: "Orphan B", clipped: true, parentId: "g1" }),
    emptyLayer({ id: "o3", name: "Orphan C", clipped: true, parentId: "g1" }),
  ]
  const { warnings } = validateClippingGroup(layers)
  expect(warnings).toHaveLength(3)
  expect(warnings.some((w) => w.includes("Orphan A"))).toBe(true)
  expect(warnings.some((w) => w.includes("Orphan B"))).toBe(true)
  expect(warnings.some((w) => w.includes("Orphan C"))).toBe(true)
})

test("validateClippingGroup treats a clip whose nearest sibling lives in another group as an orphan", () => {
  // The "base" exists at the document root, but the clipped layer is in a child group.
  // PSD clipping is sibling-scoped, so this must surface as an orphan.
  const layers: Layer[] = [
    emptyLayer({ id: "rootBase", name: "Root Base", clipped: false, parentId: undefined }),
    emptyLayer({ id: "rootClip", name: "Root Clip", clipped: true, parentId: undefined }),
    emptyLayer({ id: "innerClip", name: "Inner Clip", clipped: true, parentId: "g1" }),
  ]
  const { warnings } = validateClippingGroup(layers)
  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toContain("Inner Clip")
  expect(warnings[0]).toContain("no base layer")
})

test("validateClippingGroup accepts two adjacent clipping groups with distinct bases", () => {
  const layers: Layer[] = [
    emptyLayer({ id: "base1", name: "Base 1", clipped: false }),
    emptyLayer({ id: "clip1a", name: "Clip 1a", clipped: true }),
    emptyLayer({ id: "clip1b", name: "Clip 1b", clipped: true }),
    emptyLayer({ id: "base2", name: "Base 2", clipped: false }),
    emptyLayer({ id: "clip2a", name: "Clip 2a", clipped: true }),
  ]
  const { warnings } = validateClippingGroup(layers)
  expect(warnings).toEqual([])
})

test("validateClippingGroup walks past adjustment-layer bases to find the underlying raster", () => {
  // The current implementation only checks if base is a "group"; raster/text/shape/adjustment
  // are all considered acceptable bases. This fixture documents that.
  const layers: Layer[] = [
    emptyLayer({ id: "raster", name: "Raster Base", clipped: false, kind: "raster" }),
    emptyLayer({ id: "adj", name: "Curves Adj", clipped: true, kind: "adjustment" }),
  ]
  const { warnings } = validateClippingGroup(layers)
  expect(warnings).toEqual([])
})

test("validateClippingGroup chains correctly when stacked clipped layers all share a base", () => {
  // base + 4 clipped above; the first non-clipped sibling walking backward is the base.
  const layers: Layer[] = [
    emptyLayer({ id: "b", name: "Base", clipped: false }),
    emptyLayer({ id: "c1", name: "Clip 1", clipped: true }),
    emptyLayer({ id: "c2", name: "Clip 2", clipped: true }),
    emptyLayer({ id: "c3", name: "Clip 3", clipped: true }),
    emptyLayer({ id: "c4", name: "Clip 4", clipped: true }),
  ]
  const { warnings } = validateClippingGroup(layers)
  expect(warnings).toEqual([])
})

test("validateClippingGroup degrades gracefully on empty input", () => {
  expect(validateClippingGroup([]).warnings).toEqual([])
})

test("validateClippingGroup does not flag a doc with no clipping anywhere", () => {
  const layers: Layer[] = [
    emptyLayer({ id: "a", name: "A", clipped: false }),
    emptyLayer({ id: "b", name: "B", clipped: false }),
    emptyLayer({ id: "g", name: "Group", kind: "group", clipped: false }),
    emptyLayer({ id: "c", name: "C", clipped: false, parentId: "g" }),
  ]
  expect(validateClippingGroup(layers).warnings).toEqual([])
})

test("validateClippingGroup flags both an orphan and a group-base on the same document", () => {
  const layers: Layer[] = [
    emptyLayer({ id: "lonely", name: "Lonely Clip", clipped: true, parentId: undefined }),
    emptyLayer({ id: "g", name: "Folder", kind: "group", clipped: false, parentId: "outer" }),
    emptyLayer({ id: "clipFolder", name: "Clip Onto Folder", clipped: true, parentId: "outer" }),
  ]
  const { warnings } = validateClippingGroup(layers)
  expect(warnings).toHaveLength(2)
  expect(warnings.some((w) => w.includes("Lonely Clip") && w.includes("no base layer"))).toBe(true)
  expect(warnings.some((w) => w.includes("Clip Onto Folder") && w.includes("Folder"))).toBe(true)
})
