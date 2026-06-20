import type { Layer, PsDocument } from "../components/photoshop/types"

class FixtureCanvas {
  width = 1
  height = 1
  fill = "#000000"
  imageData: ImageData | null = null

  getContext() {
    const context = {
      fillStyle: "#000000",
      strokeStyle: "#000000",
      lineWidth: 1,
      lineJoin: "miter",
      lineCap: "butt",
      font: "10px sans-serif",
      textAlign: "start",
      textBaseline: "alphabetic",
      globalCompositeOperation: "source-over",
      fillRect: (_x: number, _y: number, _w: number, _h: number) => {
        this.fill = String(context.fillStyle ?? this.fill)
      },
      strokeRect: () => {},
      clearRect: () => {},
      drawImage: (source: FixtureCanvas) => {
        if (source?.fill) this.fill = source.fill
      },
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      bezierCurveTo: () => {},
      quadraticCurveTo: () => {},
      arc: () => {},
      arcTo: () => {},
      closePath: () => {},
      rect: () => {},
      clip: () => {},
      fill: () => {},
      stroke: () => {},
      translate: () => {},
      scale: () => {},
      rotate: () => {},
      transform: () => {},
      setTransform: () => {},
      resetTransform: () => {},
      setLineDash: () => {},
      getLineDash: () => [],
      measureText: (text: string) => ({ width: text.length * 6 }),
      fillText: () => {},
      strokeText: () => {},
      createImageData: (width: number, height: number) => new FixtureImageData(width, height),
      getImageData: () => this.imageData ?? ({ data: new Uint8ClampedArray(this.width * this.height * 4), width: this.width, height: this.height }),
      putImageData: (image: ImageData) => {
        this.imageData = image
      },
    }
    return context
  }

  toDataURL() {
    const payload = btoa(JSON.stringify({ width: this.width, height: this.height, fill: this.fill }))
    return `data:image/png;base64,${payload}`
  }
}

class FixtureImage {
  naturalWidth = 1
  naturalHeight = 1
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  set src(value: string) {
    try {
      const payload = value.split(",")[1] ?? ""
      const parsed = JSON.parse(atob(payload))
      this.naturalWidth = Number(parsed.width) || 1
      this.naturalHeight = Number(parsed.height) || 1
      setTimeout(() => this.onload?.(), 0)
    } catch {
      setTimeout(() => this.onerror?.(), 0)
    }
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

const FIXTURE_DOCUMENT_PATCHED = Symbol.for("photoshop.fixture.document-patched")
const FIXTURE_DOCUMENT_ORIGINAL_CREATE_ELEMENT = Symbol.for("photoshop.fixture.original-create-element")
const FIXTURE_DOCUMENT_PATCHED_CREATE_ELEMENT = Symbol.for("photoshop.fixture.patched-create-element")

function fixtureStyleElement() {
  return {
    setAttribute: () => {},
    appendChild: () => {},
    style: {},
  } as unknown as HTMLElement
}

function canvasContextHasFixtureApis(canvas: HTMLCanvasElement) {
  try {
    const ctx = canvas.getContext("2d")
    return !!ctx &&
      typeof ctx.createImageData === "function" &&
      typeof ctx.getImageData === "function" &&
      typeof ctx.putImageData === "function"
  } catch {
    return false
  }
}

function installFixtureDocumentCreateElement(fixtureDocument: Document) {
  const patchedDocument = fixtureDocument as Document & {
    [FIXTURE_DOCUMENT_PATCHED]?: boolean
    [FIXTURE_DOCUMENT_ORIGINAL_CREATE_ELEMENT]?: Document["createElement"]
    [FIXTURE_DOCUMENT_PATCHED_CREATE_ELEMENT]?: Document["createElement"]
  }
  const installedCreateElement = patchedDocument[FIXTURE_DOCUMENT_PATCHED_CREATE_ELEMENT]
  if (patchedDocument[FIXTURE_DOCUMENT_PATCHED] && patchedDocument.createElement === installedCreateElement) {
    try {
      if (canvasContextHasFixtureApis(patchedDocument.createElement("canvas"))) return
    } catch {}
  }
  if (patchedDocument.createElement !== installedCreateElement) {
    patchedDocument[FIXTURE_DOCUMENT_ORIGINAL_CREATE_ELEMENT] =
      typeof patchedDocument.createElement === "function" ? patchedDocument.createElement.bind(patchedDocument) : undefined
  }
  const fixtureCreateElement = ((tagName: string, options?: ElementCreationOptions) => {
    const tag = tagName.toLowerCase()
    const original = patchedDocument[FIXTURE_DOCUMENT_ORIGINAL_CREATE_ELEMENT]
    if (tag === "canvas") {
      try {
        const canvas = original?.(tagName, options) as HTMLCanvasElement | undefined
        if (canvas && canvasContextHasFixtureApis(canvas)) return canvas
      } catch {}
      return new FixtureCanvas() as unknown as HTMLCanvasElement
    }
    if (tag === "style") {
      try {
        return original?.(tagName, options) ?? fixtureStyleElement()
      } catch {
        return fixtureStyleElement()
      }
    }
    if (original) return original(tagName, options)
    throw new Error(`Unsupported fixture element: ${tagName}`)
  }) as Document["createElement"]
  patchedDocument.createElement = fixtureCreateElement
  patchedDocument[FIXTURE_DOCUMENT_PATCHED_CREATE_ELEMENT] = fixtureCreateElement
  patchedDocument[FIXTURE_DOCUMENT_PATCHED] = true
}

export function installFixtureDom() {
  const head = {
    appendChild: () => {},
    insertBefore: () => {},
  } as unknown as HTMLHeadElement

  if (typeof globalThis.document === "undefined") {
    ;(globalThis as typeof globalThis & { document: Document }).document = {
      createElement: (tag: string) => {
        if (tag === "style") return fixtureStyleElement()
        if (tag !== "canvas") throw new Error(`Unsupported fixture element: ${tag}`)
        return new FixtureCanvas() as unknown as HTMLCanvasElement
      },
      createTextNode: () => ({}) as Text,
      getElementsByTagName: (tag: string) => (tag === "head" ? [head] : []) as unknown as HTMLCollectionOf<Element>,
      head,
    } as unknown as Document
  } else {
    const fixtureDocument = globalThis.document as Document & {
      createTextNode?: (data: string) => Text
      getElementsByTagName?: (tag: string) => HTMLCollectionOf<Element>
      head?: HTMLHeadElement
    }
    if (typeof fixtureDocument.createTextNode !== "function") {
      fixtureDocument.createTextNode = () => ({}) as Text
    }
    if (typeof fixtureDocument.getElementsByTagName !== "function") {
      fixtureDocument.getElementsByTagName = (tag: string) =>
        (tag === "head" ? [head] : []) as unknown as HTMLCollectionOf<Element>
    }
    if (!fixtureDocument.head) fixtureDocument.head = head
  }
  installFixtureDocumentCreateElement(globalThis.document)
  if (typeof globalThis.Image === "undefined") {
    ;(globalThis as typeof globalThis & { Image: typeof Image }).Image = FixtureImage as unknown as typeof Image
  }
  if (typeof globalThis.ImageData === "undefined") {
    ;(globalThis as typeof globalThis & { ImageData: typeof ImageData }).ImageData = FixtureImageData as unknown as typeof ImageData
  }
}

export function fixtureCanvas(width = 32, height = 24, fill = "#3366cc") {
  installFixtureDom()
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = "rgba(255,255,255,0.7)"
  ctx.fillRect(4, 4, Math.max(1, width - 8), Math.max(1, height - 8))
  return canvas
}

export function fixtureMask(width = 64, height = 48) {
  installFixtureDom()
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#000"
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = "#fff"
  ctx.fillRect(8, 8, width - 16, height - 16)
  return canvas
}

export function richFixtureDocument(): PsDocument {
  const raster: Layer = {
    id: "layer_raster",
    name: "Masked Raster",
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 0.9,
    fillOpacity: 0.8,
    blendMode: "multiply",
    canvas: fixtureCanvas(64, 48, "#2255aa"),
    mask: fixtureMask(64, 48),
    maskEnabled: true,
    style: {
      dropShadow: { enabled: true, color: "#000000", size: 8, offsetX: 3, offsetY: 4, opacity: 0.4 },
    },
    smartFilters: [
      {
        id: "sf_blur",
        filterId: "box-blur",
        name: "Box Blur",
        enabled: true,
        opacity: 0.75,
        blendMode: "normal",
        params: { radius: 2 },
        mask: fixtureMask(64, 48),
        maskEnabled: true,
      },
    ],
  }

  const text: Layer = {
    id: "layer_text",
    name: "Editable Text",
    kind: "text",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: fixtureCanvas(64, 48, "#ffffff"),
    text: {
      content: "Fixture",
      font: "Arial",
      size: 18,
      weight: "bold",
      italic: false,
      color: "#112233",
      align: "center",
      x: 10,
      y: 20,
      vertical: true,
      tracking: 20,
      ligatures: true,
    },
  }

  const shape: Layer = {
    id: "layer_shape",
    name: "Rounded Polygon",
    kind: "shape",
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    canvas: fixtureCanvas(64, 48, "#44aa66"),
    shape: {
      type: "polygon",
      x: 6,
      y: 6,
      w: 34,
      h: 30,
      fill: "#44aa66",
      stroke: { color: "#111111", width: 2 },
      sides: 6,
    },
  }

  const smart: Layer = {
    id: "layer_smart",
    name: "Product Smart Object",
    kind: "smart-object",
    visible: true,
    locked: false,
    smartObject: true,
    opacity: 1,
    blendMode: "normal",
    canvas: fixtureCanvas(64, 48, "#cc6633"),
    smartSource: {
      width: 32,
      height: 24,
      canvas: fixtureCanvas(32, 24, "#cc6633"),
      id: "smart_source_product",
      name: "product-source.png",
      linkType: "linked",
      fileName: "product-source.png",
      relativePath: "assets/product-source.png",
      status: "current",
      embedded: true,
      updatedAt: 1_800_000_000_000,
    },
  }

  return {
    id: "doc_fixture",
    name: "Fixture Document",
    width: 64,
    height: 48,
    zoom: 1,
    layers: [raster, text, shape, smart],
    activeLayerId: smart.id,
    selectedLayerIds: [smart.id],
    background: "#ffffff",
    colorMode: "CMYK",
    bitDepth: 16,
    selection: { bounds: { x: 8, y: 8, w: 24, h: 18 }, shape: "rect", mask: fixtureMask(64, 48), feather: 2 },
    guides: [{ id: "guide_v", orientation: "vertical", position: 20, color: "#ff0000" }],
    slices: [{ id: "slice_1", name: "Hero", x: 0, y: 0, w: 32, h: 24 }],
    selectedSliceId: "slice_1",
    comps: [
      {
        id: "comp_1",
        name: "Hero Comp",
        state: {
          [raster.id]: { visible: true, opacity: raster.opacity, fillOpacity: raster.fillOpacity, blendMode: raster.blendMode, smartFilters: raster.smartFilters },
          [text.id]: { visible: true, opacity: text.opacity, blendMode: text.blendMode, text: text.text },
        },
        activeLayerId: smart.id,
        selectedLayerIds: [smart.id],
        createdAt: 1_800_000_000_000,
      },
    ],
    channels: [{ id: "alpha_1", name: "Alpha Fixture", canvas: fixtureMask(64, 48) }],
    assetLibrary: [{ id: "asset_export", name: "PNG Export", kind: "export", payload: { format: "png" }, createdAt: 1_800_000_000_000 }],
    metadata: { title: "Fixture", author: "Test" },
    colorManagement: {
      assignedProfile: "Adobe RGB (1998)",
      workingSpace: "Adobe RGB (1998)",
      renderingIntent: "relative-colorimetric",
      blackPointCompensation: true,
      proofProfile: "Working CMYK",
      proofColors: true,
      gamutWarning: true,
    },
    printSettings: {
      paperSize: "A4",
      orientation: "portrait",
      scale: 100,
      bleedMm: 3,
      cropMarks: true,
      registrationMarks: true,
      colorHandling: "app",
      proofPrint: true,
    },
  }
}
