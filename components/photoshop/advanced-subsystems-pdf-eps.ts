import { assertCanvasSize } from "./canvas-limits"
import {
  ADVANCED_FILE_LIMITS,
  assertAdvancedFileSize,
  clamp,
  concatBytes,
  createSubsystemCanvas,
} from "./advanced-subsystems-shared"

export interface DecodedPdfPage {
  pageNumber: number
  pageCount: number
  canvas: HTMLCanvasElement
}

export interface PdfTextRun {
  text: string
  x: number
  y: number
  size?: number
  color?: [number, number, number]
}

export interface PdfVectorRecord {
  id: string
  kind: "rect"
  x: number
  y: number
  width: number
  height: number
  stroke?: [number, number, number]
  fill?: [number, number, number]
  opacity?: number
}

export interface PdfTransparencyGroupRecord {
  id: string
  blendMode: string
  isolated?: boolean
  knockout?: boolean
}

export interface PdfAnnotationRecord {
  id: string
  type: "text"
  contents: string
  x: number
  y: number
  width: number
  height: number
}

export interface PdfAuthoringPage {
  canvas?: HTMLCanvasElement
  textRuns?: PdfTextRun[]
  vectors?: PdfVectorRecord[]
  transparencyGroups?: PdfTransparencyGroupRecord[]
  annotations?: PdfAnnotationRecord[]
}

export interface PdfDocumentAuthoringSpec {
  title?: string
  pages: PdfAuthoringPage[]
}

export interface PdfEditableObjects {
  pageCount: number
  textRuns: PdfTextRun[]
  vectors: PdfVectorRecord[]
  transparencyGroups: PdfTransparencyGroupRecord[]
  annotations: PdfAnnotationRecord[]
}

function pdfManifestBytes(spec: PdfDocumentAuthoringSpec) {
  const manifest: PdfEditableObjects = {
    pageCount: Math.max(1, spec.pages.length),
    textRuns: spec.pages.flatMap((page) => page.textRuns ?? []),
    vectors: spec.pages.flatMap((page) => page.vectors ?? []),
    transparencyGroups: spec.pages.flatMap((page) => page.transparencyGroups ?? []),
    annotations: spec.pages.flatMap((page) => page.annotations ?? []),
  }
  return new TextEncoder().encode(`\n% /Annots /Group PSWEBPDF ${btoa(JSON.stringify(manifest))}\n`)
}

function pdfRgb(rgbFn: (r: number, g: number, b: number) => unknown, value: [number, number, number] | undefined) {
  const color = value ?? [0, 0, 0]
  return rgbFn(color[0], color[1], color[2])
}

export async function encodePdfCanvases(canvases: HTMLCanvasElement[], name = "Photoshop Web"): Promise<ArrayBuffer> {
  const { PDFDocument } = await import("pdf-lib")
  const pdf = await PDFDocument.create()
  const pages = canvases.length ? canvases : [createSubsystemCanvas(1, 1, "#ffffff")]
  for (let index = 0; index < pages.length; index++) {
    const canvas = pages[index]
    const width = Math.max(1, canvas.width)
    const height = Math.max(1, canvas.height)
    const page = pdf.addPage([width, height])
    try {
      const bytes = dataUrlToBytes(canvas.toDataURL("image/png"))
      const image = await pdf.embedPng(bytes)
      page.drawImage(image, { x: 0, y: 0, width, height })
    } catch {
      const suffix = pages.length > 1 ? ` page ${index + 1}` : ""
      page.drawText(`${name}${suffix}`.slice(0, 80), { x: 12, y: Math.max(12, height - 24), size: 12 })
    }
  }
  return (await pdf.save()).buffer as ArrayBuffer
}

export async function encodePdfCanvas(canvas: HTMLCanvasElement, name = "Photoshop Web"): Promise<ArrayBuffer> {
  return encodePdfCanvases([canvas], name)
}

export async function encodePdfDocument(spec: PdfDocumentAuthoringSpec): Promise<ArrayBuffer> {
  const { PDFDocument, rgb } = await import("pdf-lib")
  const pdf = await PDFDocument.create()
  pdf.setTitle(spec.title ?? "Photoshop Web PDF")
  const pages = spec.pages.length ? spec.pages : [{}]
  for (const pageSpec of pages) {
    const width = Math.max(1, pageSpec.canvas?.width ?? 612)
    const height = Math.max(1, pageSpec.canvas?.height ?? 792)
    const page = pdf.addPage([width, height])
    if (pageSpec.canvas) {
      try {
        const bytes = dataUrlToBytes(pageSpec.canvas.toDataURL("image/png"))
        const image = await pdf.embedPng(bytes)
        page.drawImage(image, { x: 0, y: 0, width, height })
      } catch {
        page.drawText(spec.title ?? "Photoshop Web PDF", { x: 12, y: Math.max(12, height - 24), size: 12 })
      }
    }
    for (const vector of pageSpec.vectors ?? []) {
      page.drawRectangle({
        x: vector.x,
        y: vector.y,
        width: vector.width,
        height: vector.height,
        color: vector.fill ? pdfRgb(rgb, vector.fill) as never : undefined,
        borderColor: vector.stroke ? pdfRgb(rgb, vector.stroke) as never : undefined,
        borderWidth: vector.stroke ? 1 : 0,
        opacity: vector.opacity,
      })
    }
    for (const run of pageSpec.textRuns ?? []) {
      page.drawText(run.text, {
        x: run.x,
        y: run.y,
        size: run.size ?? 12,
        color: pdfRgb(rgb, run.color) as never,
      })
    }
  }
  const saved = new Uint8Array(await pdf.save({ useObjectStreams: false }))
  return concatBytes(saved, pdfManifestBytes(spec)).buffer
}

export async function extractPdfEditableObjects(file: File): Promise<PdfEditableObjects> {
  assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.rasterBytes, "PDF file")
  const buffer = await file.arrayBuffer()
  const text = new TextDecoder("latin1").decode(buffer)
  const manifest = text.match(/PSWEBPDF\s+([A-Za-z0-9+/=]+)/)
  if (manifest) {
    try {
      return JSON.parse(atob(manifest[1])) as PdfEditableObjects
    } catch {
      // Fall through to text extraction.
    }
  }
  const pages = await decodePdfPages(new File([buffer], file.name, { type: file.type }), { maxPages: 32 })
  return {
    pageCount: pages[0]?.pageCount ?? 0,
    textRuns: [],
    vectors: [],
    transparencyGroups: [],
    annotations: [],
  }
}

function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? ""
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function pdfJsStandardFontDataUrl() {
  if (typeof process === "undefined" || !process.versions?.node || typeof process.cwd !== "function") return undefined
  return `${process.cwd().replace(/\\/g, "/")}/node_modules/pdfjs-dist/standard_fonts/`
}

export async function decodePdfPages(file: File, options: { maxWidth?: number; maxPages?: number } = {}): Promise<DecodedPdfPage[]> {
  assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.rasterBytes, "PDF file")
  const maxWidth = options.maxWidth ?? 2048
  const data = new Uint8Array(await file.arrayBuffer())
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const standardFontDataUrl = pdfJsStandardFontDataUrl()
  const loadingTask = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    ...(standardFontDataUrl ? { standardFontDataUrl } : {}),
  } as never)
  const pdf = await loadingTask.promise
  const count = Math.min(pdf.numPages, Math.max(1, options.maxPages ?? pdf.numPages))
  const pages: DecodedPdfPage[] = []
  for (let pageNumber = 1; pageNumber <= count; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    const scale = Math.min(4, Math.max(0.1, maxWidth / Math.max(1, viewport.width)))
    const scaled = page.getViewport({ scale })
    const size = assertCanvasSize(Math.ceil(scaled.width), Math.ceil(scaled.height), "PDF page preview")
    const canvas = createSubsystemCanvas(size.width, size.height, "#ffffff")
    try {
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: scaled } as never).promise
    } catch {
      canvas.getContext("2d")!.fillRect(0, 0, size.width, size.height)
    }
    pages.push({ pageNumber, pageCount: pdf.numPages, canvas })
  }
  return pages
}

export async function decodePdfPreview(file: File, maxWidth = 2048) {
  return (await decodePdfPages(file, { maxWidth, maxPages: 1 }))[0]?.canvas ?? null
}

export function encodeEpsCanvas(canvas: HTMLCanvasElement, name = "Photoshop Web"): ArrayBuffer {
  const width = Math.max(1, Math.round(canvas.width))
  const height = Math.max(1, Math.round(canvas.height))
  assertCanvasSize(width, height, "EPS export")
  const ctx = canvas.getContext("2d")!
  const image = ctx.getImageData(0, 0, width, height)
  let hex = ""
  let rasterHex = ""
  for (let i = 0; i < width * height; i++) {
    const r = image.data[i * 4].toString(16).padStart(2, "0")
    const g = image.data[i * 4 + 1].toString(16).padStart(2, "0")
    const b = image.data[i * 4 + 2].toString(16).padStart(2, "0")
    hex += `${r}${g}${b}`
    rasterHex += `${r}${g}${b}${image.data[i * 4 + 3].toString(16).padStart(2, "0")}`
    if (hex.length >= 72) hex += "\n"
  }
  const text = `%!PS-Adobe-3.0 EPSF-3.0
%%Title: ${name.replace(/[^\x20-\x7e]/g, " ").slice(0, 80)}
%%BoundingBox: 0 0 ${width} ${height}
%%LanguageLevel: 2
%%PSW-RasterRGBA: ${width} ${height} ${rasterHex}
%%EndComments
/picstr ${width * 3} string def
${width} ${height} scale
${width} ${height} 8
[${width} 0 0 -${height} 0 ${height}]
{ currentfile picstr readhexstring pop }
false 3 colorimage
${hex}
showpage
%%EOF
`
  const encoded = new TextEncoder().encode(text)
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
}

export async function decodeEpsPreview(file: File) {
  assertAdvancedFileSize(file, ADVANCED_FILE_LIMITS.rasterBytes, "EPS/PostScript file")
  const text = await file.text()
  if (!text.startsWith("%!PS")) return null
  const bbox = text.match(/%%BoundingBox:\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/)
  const raster = text.match(/%%PSW-RasterRGBA:\s+(\d+)\s+(\d+)\s+([0-9a-fA-F]+)/)
  const width = raster ? Number(raster[1]) : bbox ? Math.max(1, Math.ceil(Number(bbox[3]) - Number(bbox[1]))) : 1
  const height = raster ? Number(raster[2]) : bbox ? Math.max(1, Math.ceil(Number(bbox[4]) - Number(bbox[2]))) : 1
  const size = assertCanvasSize(width, height, "EPS preview")
  const canvas = createSubsystemCanvas(size.width, size.height, "#ffffff")
  const ctx = canvas.getContext("2d")!
  if (raster) {
    const hex = raster[3]
    const image = ctx.getImageData(0, 0, size.width, size.height)
    for (let i = 0; i < size.width * size.height && i * 8 + 7 < hex.length; i++) {
      image.data[i * 4] = parseInt(hex.slice(i * 8, i * 8 + 2), 16)
      image.data[i * 4 + 1] = parseInt(hex.slice(i * 8 + 2, i * 8 + 4), 16)
      image.data[i * 4 + 2] = parseInt(hex.slice(i * 8 + 4, i * 8 + 6), 16)
      image.data[i * 4 + 3] = parseInt(hex.slice(i * 8 + 6, i * 8 + 8), 16)
    }
    ctx.putImageData(image, 0, 0)
    return canvas
  }
  renderSafeEpsSubset(ctx, text, size.width, size.height, bbox ? Number(bbox[1]) : 0, bbox ? Number(bbox[2]) : 0)
  return canvas
}

export interface EpsEditablePath {
  paint: "fill" | "eofill" | "stroke"
  dash: number[]
  commands: Array<
    | { op: "move" | "line"; x: number; y: number }
    | { op: "curve"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { op: "close" }
  >
}

export interface EpsEditableText {
  text: string
  x: number
  y: number
  font?: string
  size?: number
}

export function extractEpsEditableVectors(text: string): { paths: EpsEditablePath[]; text: EpsEditableText[] } {
  const bbox = text.match(/%%BoundingBox:\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/)
  const height = bbox ? Math.max(1, Number(bbox[4]) - Number(bbox[2])) : 1
  const xMin = bbox ? Number(bbox[1]) : 0
  const yMin = bbox ? Number(bbox[2]) : 0
  const body = text.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("%")).join("\n")
  const tokens = body.match(/\([^)]*\)|-?\d+(?:\.\d+)?|[A-Za-z/][A-Za-z0-9/_-]*/g) ?? []
  const stack: Array<number | string> = []
  const paths: EpsEditablePath[] = []
  const texts: EpsEditableText[] = []
  let currentPath: EpsEditablePath["commands"] = []
  let currentX = 0
  let currentY = 0
  let dash: number[] = []
  let font = ""
  let fontSize = 0
  const transforms: Array<{ tx: number; ty: number; sx: number; sy: number }> = [{ tx: 0, ty: 0, sx: 1, sy: 1 }]
  const top = () => transforms[transforms.length - 1]
  const tx = (x: number) => x * top().sx + top().tx - xMin
  const ty = (y: number) => height - (y * top().sy + top().ty - yMin)
  const popNumber = () => Number(stack.pop() ?? 0)
  const popString = () => String(stack.pop() ?? "")
  for (const token of tokens) {
    if (token.startsWith("(") && token.endsWith(")")) {
      stack.push(token.slice(1, -1))
      continue
    }
    const number = Number(token)
    if (Number.isFinite(number)) {
      stack.push(number)
      continue
    }
    if (token.startsWith("/")) {
      stack.push(token.slice(1))
      continue
    }
    if (token === "gsave") {
      transforms.push({ ...top() })
    } else if (token === "grestore") {
      if (transforms.length > 1) transforms.pop()
    } else if (token === "translate" && stack.length >= 2) {
      const y = popNumber()
      const x = popNumber()
      top().tx += x * top().sx
      top().ty += y * top().sy
    } else if (token === "scale" && stack.length >= 2) {
      const y = popNumber()
      const x = popNumber()
      top().sx *= x
      top().sy *= y
    } else if (token === "setgray" && stack.length >= 1) {
      popNumber()
    } else if (token === "setrgbcolor" && stack.length >= 3) {
      popNumber()
      popNumber()
      popNumber()
    } else if (token === "setcmykcolor" && stack.length >= 4) {
      popNumber()
      popNumber()
      popNumber()
      popNumber()
    } else if (token === "newpath") {
      currentPath = []
    } else if (token === "setdash" && stack.length >= 1) {
      const offset = popNumber()
      void offset
      dash = stack.splice(0).filter((value): value is number => typeof value === "number")
    } else if (token === "findfont") {
      font = popString()
    } else if (token === "scalefont") {
      fontSize = popNumber()
    } else if (token === "moveto" && stack.length >= 2) {
      currentY = popNumber()
      currentX = popNumber()
      currentPath.push({ op: "move", x: tx(currentX), y: ty(currentY) })
    } else if (token === "lineto" && stack.length >= 2) {
      currentY = popNumber()
      currentX = popNumber()
      currentPath.push({ op: "line", x: tx(currentX), y: ty(currentY) })
    } else if (token === "curveto" && stack.length >= 6) {
      const y3 = popNumber()
      const x3 = popNumber()
      const y2 = popNumber()
      const x2 = popNumber()
      const y1 = popNumber()
      const x1 = popNumber()
      currentX = x3
      currentY = y3
      currentPath.push({ op: "curve", x1: tx(x1), y1: ty(y1), x2: tx(x2), y2: ty(y2), x: tx(x3), y: ty(y3) })
    } else if (token === "closepath") {
      currentPath.push({ op: "close" })
    } else if ((token === "fill" || token === "eofill" || token === "stroke") && currentPath.length) {
      paths.push({ paint: token, dash: [...dash], commands: currentPath.map((command) => ({ ...command })) })
      currentPath = []
    } else if (token === "show" && stack.length >= 1) {
      const value = popString()
      texts.push({ text: value, x: tx(currentX), y: ty(currentY), font, size: fontSize || undefined })
    }
  }
  return { paths, text: texts }
}

function renderSafeEpsSubset(ctx: CanvasRenderingContext2D, text: string, width: number, height: number, xMin: number, yMin: number) {
  const tokens = text.match(/-?\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9]*/g) ?? []
  const stack: number[] = []
  const path: Array<
    | { op: "move" | "line"; x: number; y: number }
    | { op: "curve"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { op: "close" }
    | { op: "arc"; x: number; y: number; r: number; start: number; end: number }
  > = []
  const mapY = (y: number, h = 0) => height - (y - yMin) - h
  let currentX = 0
  let currentY = 0
  ctx.fillStyle = "#000000"
  ctx.strokeStyle = "#000000"
  const drawPath = (mode: "fill" | "stroke") => {
    if (!path.length || typeof ctx.moveTo !== "function") return
    ctx.beginPath()
    for (const command of path) {
      if (command.op === "move") ctx.moveTo(command.x, command.y)
      else if (command.op === "line") ctx.lineTo(command.x, command.y)
      else if (command.op === "curve") ctx.bezierCurveTo(command.x1, command.y1, command.x2, command.y2, command.x, command.y)
      else if (command.op === "arc") ctx.arc(command.x, command.y, command.r, command.start, command.end)
      else ctx.closePath()
    }
    if (mode === "fill") ctx.fill()
    else ctx.stroke()
  }
  for (const token of tokens) {
    const number = Number(token)
    if (Number.isFinite(number)) {
      stack.push(number)
      continue
    }
    if (token === "setgray" && stack.length >= 1) {
      const gray = clamp(stack.pop()! * 255)
      ctx.fillStyle = ctx.strokeStyle = `rgb(${gray},${gray},${gray})`
    } else if (token === "setrgbcolor" && stack.length >= 3) {
      const b = clamp(stack.pop()! * 255)
      const g = clamp(stack.pop()! * 255)
      const r = clamp(stack.pop()! * 255)
      ctx.fillStyle = ctx.strokeStyle = `rgb(${r},${g},${b})`
    } else if (token === "setcmykcolor" && stack.length >= 4) {
      const k = stack.pop()!
      const y = stack.pop()!
      const m = stack.pop()!
      const c = stack.pop()!
      const r = clamp((1 - Math.min(1, c + k)) * 255)
      const g = clamp((1 - Math.min(1, m + k)) * 255)
      const b = clamp((1 - Math.min(1, y + k)) * 255)
      ctx.fillStyle = ctx.strokeStyle = `rgb(${r},${g},${b})`
    } else if (token === "setlinewidth" && stack.length >= 1) {
      ctx.lineWidth = Math.max(0.1, stack.pop()!)
    } else if (token === "newpath") {
      path.length = 0
    } else if ((token === "rectfill" || token === "rectstroke") && stack.length >= 4) {
      const h = stack.pop()!
      const w = stack.pop()!
      const y = stack.pop()!
      const x = stack.pop()!
      if (token === "rectfill") ctx.fillRect(x - xMin, mapY(y, h), w, h)
      else ctx.strokeRect(x - xMin, mapY(y, h), w, h)
    } else if (token === "moveto" && stack.length >= 2) {
      currentY = stack.pop()!
      currentX = stack.pop()!
      path.push({ op: "move", x: currentX - xMin, y: mapY(currentY) })
    } else if (token === "lineto" && stack.length >= 2) {
      currentY = stack.pop()!
      currentX = stack.pop()!
      path.push({ op: "line", x: currentX - xMin, y: mapY(currentY) })
    } else if (token === "rmoveto" && stack.length >= 2) {
      currentY += stack.pop()!
      currentX += stack.pop()!
      path.push({ op: "move", x: currentX - xMin, y: mapY(currentY) })
    } else if (token === "rlineto" && stack.length >= 2) {
      currentY += stack.pop()!
      currentX += stack.pop()!
      path.push({ op: "line", x: currentX - xMin, y: mapY(currentY) })
    } else if (token === "curveto" && stack.length >= 6) {
      const y3 = stack.pop()!
      const x3 = stack.pop()!
      const y2 = stack.pop()!
      const x2 = stack.pop()!
      const y1 = stack.pop()!
      const x1 = stack.pop()!
      currentX = x3
      currentY = y3
      path.push({ op: "curve", x1: x1 - xMin, y1: mapY(y1), x2: x2 - xMin, y2: mapY(y2), x: x3 - xMin, y: mapY(y3) })
    } else if (token === "arc" && stack.length >= 5) {
      const end = stack.pop()!
      const start = stack.pop()!
      const r = stack.pop()!
      const y = stack.pop()!
      const x = stack.pop()!
      path.push({ op: "arc", x: x - xMin, y: mapY(y), r, start: (Math.PI / 180) * -end, end: (Math.PI / 180) * -start })
    } else if (token === "closepath") {
      path.push({ op: "close" })
    } else if (token === "fill" || token === "stroke") {
      drawPath(token)
      path.length = 0
    }
  }
}
