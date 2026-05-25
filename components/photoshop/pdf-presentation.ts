/**
 * PDF Presentation + folder batch processing.
 *
 * Builds a multipage PDF where each input image becomes a page sized to the
 * presentation page format, with optional aspect-preserving fit, page
 * background, and per-page captions. Uses pdf-lib (already a dependency for
 * the contact sheet).
 *
 * The folder batch helper iterates over a list of File objects (typically
 * sourced from `<input type="file" webkitdirectory>` or the File System
 * Access API) and yields each image as an HTMLCanvasElement so the caller
 * can chain Image Processor / PDF Presentation pipelines.
 */

export type PresentationPageSize =
  | "letter"
  | "letter-landscape"
  | "a4"
  | "a4-landscape"
  | "tabloid"
  | "tabloid-landscape"
  | "fit-source"

export type PresentationFit = "fit" | "fill" | "stretch"

export interface PresentationOptions {
  title?: string
  author?: string
  pageSize: PresentationPageSize
  fit: PresentationFit
  background: string // hex color
  marginPt: number
  showCaptions: boolean
  /** Optional caption per source. If omitted, file name (without extension). */
  captions?: string[]
  /** Optional caption font size. */
  captionFontSize?: number
}

const PAGE_SIZES: Record<PresentationPageSize, { w: number; h: number } | null> = {
  letter: { w: 612, h: 792 },
  "letter-landscape": { w: 792, h: 612 },
  a4: { w: 595, h: 842 },
  "a4-landscape": { w: 842, h: 595 },
  tabloid: { w: 792, h: 1224 },
  "tabloid-landscape": { w: 1224, h: 792 },
  "fit-source": null,
}

export interface PresentationSource {
  canvas: HTMLCanvasElement
  caption?: string
  name?: string
}

export interface PresentationResult {
  blob: Blob
  pageCount: number
}

/**
 * Build a PDF from the given image sources.
 */
export async function buildPresentationPdf(sources: PresentationSource[], options: PresentationOptions): Promise<PresentationResult> {
  if (!sources.length) throw new Error("PDF presentation requires at least one source.")
  const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib")
  const pdf = await PDFDocument.create()
  if (options.title) pdf.setTitle(options.title.slice(0, 200))
  if (options.author) pdf.setAuthor(options.author.slice(0, 200))
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bg = parseHexColor(options.background)
  const fontSize = clamp(options.captionFontSize ?? 10, 6, 32)
  const margin = clamp(options.marginPt, 0, 144)

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]
    const pageDef = PAGE_SIZES[options.pageSize]
    const pageWidth = pageDef ? pageDef.w : Math.max(72, source.canvas.width)
    const pageHeight = pageDef ? pageDef.h : Math.max(72, source.canvas.height)
    const page = pdf.addPage([pageWidth, pageHeight])
    page.drawRectangle({
      x: 0, y: 0, width: pageWidth, height: pageHeight,
      color: rgb(bg.r, bg.g, bg.b),
    })

    let image
    try {
      const dataUrl = source.canvas.toDataURL("image/png")
      image = await pdf.embedPng(dataUrlToBytes(dataUrl))
    } catch {
      page.drawText("Image embed failed", { x: margin, y: pageHeight - margin - fontSize, size: fontSize, font })
      continue
    }

    const captionHeight = options.showCaptions ? Math.max(0, fontSize + 8) : 0
    const innerX = margin
    const innerY = margin + captionHeight
    const innerW = Math.max(1, pageWidth - margin * 2)
    const innerH = Math.max(1, pageHeight - margin * 2 - captionHeight)
    const fitted = fitRect(image.width, image.height, innerW, innerH, options.fit)
    const dx = innerX + (innerW - fitted.w) / 2
    const dy = innerY + (innerH - fitted.h) / 2
    page.drawImage(image, { x: dx, y: dy, width: fitted.w, height: fitted.h })

    if (options.showCaptions) {
      const cap = options.captions?.[i] ?? source.caption ?? source.name ?? `Page ${i + 1}`
      const safeCaption = cap.slice(0, 160)
      page.drawText(safeCaption, {
        x: margin,
        y: margin,
        size: fontSize,
        font,
        color: rgb(0.1, 0.1, 0.1),
      })
    }
  }
  const bytes = await pdf.save()
  return { blob: new Blob([bytes], { type: "application/pdf" }), pageCount: sources.length }
}

function fitRect(srcW: number, srcH: number, dstW: number, dstH: number, fit: PresentationFit): { w: number; h: number } {
  if (!srcW || !srcH) return { w: dstW, h: dstH }
  if (fit === "stretch") return { w: dstW, h: dstH }
  const scale = fit === "fill" ? Math.max(dstW / srcW, dstH / srcH) : Math.min(dstW / srcW, dstH / srcH)
  return { w: srcW * scale, h: srcH * scale }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  let s = hex.replace("#", "").trim()
  if (s.length === 3) s = s.split("").map((c) => c + c).join("")
  if (s.length !== 6) return { r: 1, g: 1, b: 1 }
  const r = parseInt(s.slice(0, 2), 16)
  const g = parseInt(s.slice(2, 4), 16)
  const b = parseInt(s.slice(4, 6), 16)
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return { r: 1, g: 1, b: 1 }
  return { r: r / 255, g: g / 255, b: b / 255 }
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const [, base64] = dataUrl.split(",")
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/* --------------------------- Folder batch ------------------------------- */

export const ALLOWED_FOLDER_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/avif"]
export const ALLOWED_FOLDER_IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"]

export function isImageFile(file: File): boolean {
  if (ALLOWED_FOLDER_IMAGE_TYPES.includes(file.type)) return true
  const name = file.name.toLowerCase()
  return ALLOWED_FOLDER_IMAGE_EXTS.some((ext) => name.endsWith(ext))
}

export interface FolderImage {
  file: File
  canvas: HTMLCanvasElement
  width: number
  height: number
  relativePath: string
}

/**
 * Load each image in the file list into an HTMLCanvasElement (in order).
 *
 * - Skips non-image files.
 * - Respects `webkitRelativePath` so relative folder structure can be
 *   preserved on export.
 * - Stops if `signal` is aborted.
 */
export async function loadFolderImages(files: FileList | File[], signal?: AbortSignal, maxFiles = 500): Promise<FolderImage[]> {
  const list = Array.from(files).filter(isImageFile).slice(0, maxFiles)
  const out: FolderImage[] = []
  for (const file of list) {
    if (signal?.aborted) break
    try {
      const canvas = await fileToCanvas(file)
      out.push({
        file,
        canvas,
        width: canvas.width,
        height: canvas.height,
        relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
      })
    } catch {
      // Skip files that fail to decode.
    }
  }
  return out
}

async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  return new Promise<HTMLCanvasElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas")
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          URL.revokeObjectURL(url)
          return reject(new Error("Failed to acquire 2D context"))
        }
        ctx.drawImage(img, 0, 0)
        URL.revokeObjectURL(url)
        resolve(canvas)
      } catch (err) {
        URL.revokeObjectURL(url)
        reject(err)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`Failed to decode ${file.name}`))
    }
    img.src = url
  })
}

/**
 * Open the File System Access API directory picker if available, otherwise
 * fall back to a hidden `<input type="file" webkitdirectory>`. Returns the
 * raw File list.
 */
export async function pickImageFolder(): Promise<File[]> {
  // Prefer File System Access API when available.
  const w = window as typeof window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }
  if (typeof w.showDirectoryPicker === "function") {
    try {
      const handle = await w.showDirectoryPicker()
      return await collectFilesFromHandle(handle)
    } catch {
      // user cancelled or permission denied; fall through to legacy picker
    }
  }
  return await legacyDirectoryPick()
}

async function collectFilesFromHandle(handle: FileSystemDirectoryHandle, prefix = "", out: File[] = [], maxFiles = 1000): Promise<File[]> {
  // FileSystemDirectoryHandle is async iterable in supported browsers.
  const it = (handle as unknown as { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()
  for await (const [name, child] of it) {
    if (out.length >= maxFiles) break
    if ((child as FileSystemHandle).kind === "file") {
      const file = await (child as FileSystemFileHandle).getFile()
      // Patch relative path so downstream code can use it.
      Object.defineProperty(file, "webkitRelativePath", { value: prefix + name })
      out.push(file)
    } else if ((child as FileSystemHandle).kind === "directory") {
      await collectFilesFromHandle(child as FileSystemDirectoryHandle, `${prefix}${name}/`, out, maxFiles)
    }
  }
  return out
}

function legacyDirectoryPick(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    input.multiple = true
    ;(input as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true
    input.addEventListener("change", () => {
      resolve(input.files ? Array.from(input.files) : [])
    })
    input.click()
  })
}
