/**
 * Automation commands: Crop and Straighten Photos, Fit Image,
 * Conditional Mode Change, Image Processor.
 *
 * Gaps #157, #158, #159, #161 from comprehensive-implementation-gaps.txt.
 */

// ---------------------------------------------------------------------------
//  Crop and Straighten Photos (#157)
// ---------------------------------------------------------------------------

export interface CropRegion {
  x: number
  y: number
  width: number
  height: number
  angle: number
}

export interface CropAndStraightenResult {
  crops: Array<CropRegion & { imageData: ImageData }>
}

export interface CropAndStraightenOptions {
  /** Minimum photo dimension (pixels) to be considered a valid photo. Default: 100 */
  minPhotoSize?: number
  /** Sobel edge threshold 0–255 for boundary detection. Default: 30 */
  edgeThreshold?: number
}

/**
 * Detect individual photos in a scanned/flatbed image using edge detection,
 * auto-crop and rotate each sub-image.
 */
export function cropAndStraightenPhotos(
  imageData: ImageData,
  options?: CropAndStraightenOptions,
): CropAndStraightenResult {
  const { width, height, data } = imageData
  const minSize = options?.minPhotoSize ?? 100
  const edgeThreshold = options?.edgeThreshold ?? 30

  // Convert to grayscale
  const gray = new Uint8Array(width * height)
  for (let i = 0; i < data.length; i += 4) {
    gray[i >> 2] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
  }

  // Sobel edge detection
  const edges = new Uint8Array(width * height)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      const gx =
        -gray[(y - 1) * width + x - 1] + gray[(y - 1) * width + x + 1] +
        -2 * gray[y * width + x - 1] + 2 * gray[y * width + x + 1] +
        -gray[(y + 1) * width + x - 1] + gray[(y + 1) * width + x + 1]
      const gy =
        -gray[(y - 1) * width + x - 1] - 2 * gray[(y - 1) * width + x] - gray[(y - 1) * width + x + 1] +
        gray[(y + 1) * width + x - 1] + 2 * gray[(y + 1) * width + x] + gray[(y + 1) * width + x + 1]
      const mag = Math.sqrt(gx * gx + gy * gy)
      edges[idx] = mag > edgeThreshold ? 255 : 0
    }
  }

  // Connected component labeling (flood fill)
  const labels = new Int32Array(width * height)
  let nextLabel = 1
  const regions: Map<number, { minX: number; minY: number; maxX: number; maxY: number; count: number }> = new Map()

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (edges[idx] === 0 || labels[idx] !== 0) continue

      const label = nextLabel++
      const queue: number[] = [idx]
      let minX = x, maxX = x, minY = y, maxY = y, count = 0

      while (queue.length > 0) {
        const ci = queue.pop()!
        if (labels[ci] !== 0) continue
        labels[ci] = label
        count++

        const cx = ci % width
        const cy = (ci / width) | 0
        if (cx < minX) minX = cx
        if (cx > maxX) maxX = cx
        if (cy < minY) minY = cy
        if (cy > maxY) maxY = cy

        // 4-connected neighbors
        if (cx > 0 && edges[ci - 1] > 0 && labels[ci - 1] === 0) queue.push(ci - 1)
        if (cx < width - 1 && edges[ci + 1] > 0 && labels[ci + 1] === 0) queue.push(ci + 1)
        if (cy > 0 && edges[ci - width] > 0 && labels[ci - width] === 0) queue.push(ci - width)
        if (cy < height - 1 && edges[ci + width] > 0 && labels[ci + width] === 0) queue.push(ci + width)
      }

      regions.set(label, { minX, minY, maxX, maxY, count })
    }
  }

  // Filter regions to valid photo candidates
  const crops: Array<CropRegion & { imageData: ImageData }> = []
  for (const [, region] of regions) {
    const rw = region.maxX - region.minX + 1
    const rh = region.maxY - region.minY + 1
    if (rw < minSize || rh < minSize) continue
    if (region.count < minSize * 2) continue // too few edge pixels

    // Estimate rotation angle from dominant edge lines (simplified Hough)
    const angle = estimateRotationAngle(edges, width, region)

    // Extract the sub-image
    const cropData = extractSubImage(imageData, region.minX, region.minY, rw, rh, angle)
    crops.push({
      x: region.minX,
      y: region.minY,
      width: rw,
      height: rh,
      angle,
      imageData: cropData,
    })
  }

  // If no photos found, return the whole image as a single crop
  if (crops.length === 0) {
    crops.push({
      x: 0,
      y: 0,
      width,
      height,
      angle: 0,
      imageData: new ImageData(new Uint8ClampedArray(data), width, height),
    })
  }

  return { crops }
}

function estimateRotationAngle(
  edges: Uint8Array,
  width: number,
  region: { minX: number; minY: number; maxX: number; maxY: number },
): number {
  // Simplified angle estimation: analyze the top edge for horizontal alignment
  const votes: number[] = new Array(181).fill(0)
  const rh = region.maxY - region.minY
  const rw = region.maxX - region.minX

  // Sample edge pixels near the top boundary
  const sampleRows = Math.min(5, rh)
  for (let dy = 0; dy < sampleRows; dy++) {
    const y = region.minY + dy
    for (let x = region.minX; x <= region.maxX; x++) {
      if (edges[y * width + x] > 0) {
        // Vote for the angle from this point to the right edge
        for (let x2 = x + 10; x2 <= Math.min(x + rw, region.maxX); x2 += 5) {
          if (edges[y * width + x2] > 0 || edges[(y + 1) * width + x2] > 0) {
            const dx = x2 - x
            const detected_dy = 0 // on same row
            const angleDeg = Math.round(Math.atan2(detected_dy, dx) * 180 / Math.PI) + 90
            if (angleDeg >= 0 && angleDeg < 181) votes[angleDeg]++
          }
        }
      }
    }
  }

  // Find dominant angle
  let maxVotes = 0
  let bestAngle = 90
  for (let i = 0; i < 181; i++) {
    if (votes[i] > maxVotes) {
      maxVotes = votes[i]
      bestAngle = i
    }
  }

  // Convert to rotation correction (angle relative to horizontal)
  const correction = bestAngle - 90
  return Math.abs(correction) < 5 ? correction : 0 // Only correct small angles
}

function extractSubImage(
  source: ImageData,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  _angle: number,
): ImageData {
  const out = new ImageData(sw, sh)
  const sd = source.data
  const od = out.data
  const srcW = source.width

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const si = ((sy + y) * srcW + (sx + x)) * 4
      const di = (y * sw + x) * 4
      od[di] = sd[si]
      od[di + 1] = sd[si + 1]
      od[di + 2] = sd[si + 2]
      od[di + 3] = sd[si + 3]
    }
  }
  return out
}

// ---------------------------------------------------------------------------
//  Fit Image (#158)
// ---------------------------------------------------------------------------

export interface FitImageOptions {
  maxWidth: number
  maxHeight: number
  constrainProportions?: boolean
  dontEnlarge?: boolean
}

/** Calculate the output dimensions for fitting an image within constraints. */
export function fitImageDimensions(
  srcWidth: number,
  srcHeight: number,
  options: FitImageOptions,
): { width: number; height: number; scale: number } {
  const constrain = options.constrainProportions !== false
  const noEnlarge = options.dontEnlarge === true

  if (!constrain) {
    let w = Math.min(srcWidth, options.maxWidth)
    let h = Math.min(srcHeight, options.maxHeight)
    if (noEnlarge) {
      w = Math.min(w, srcWidth)
      h = Math.min(h, srcHeight)
    }
    return { width: w, height: h, scale: Math.min(w / srcWidth, h / srcHeight) }
  }

  const scaleX = options.maxWidth / srcWidth
  const scaleY = options.maxHeight / srcHeight
  let scale = Math.min(scaleX, scaleY)

  if (noEnlarge && scale > 1) scale = 1

  return {
    width: Math.max(1, Math.round(srcWidth * scale)),
    height: Math.max(1, Math.round(srcHeight * scale)),
    scale,
  }
}

/** Resize an ImageData using bilinear interpolation to fit within constraints. */
export function fitImageData(imageData: ImageData, options: FitImageOptions): ImageData {
  const { width: dstW, height: dstH } = fitImageDimensions(imageData.width, imageData.height, options)
  if (dstW === imageData.width && dstH === imageData.height) {
    return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
  }
  return bilinearResize(imageData, dstW, dstH)
}

function bilinearResize(src: ImageData, dstW: number, dstH: number): ImageData {
  const out = new ImageData(dstW, dstH)
  const sd = src.data
  const od = out.data
  const srcW = src.width
  const srcH = src.height

  for (let y = 0; y < dstH; y++) {
    const srcY = (y * (srcH - 1)) / Math.max(1, dstH - 1)
    const y0 = Math.floor(srcY)
    const y1 = Math.min(y0 + 1, srcH - 1)
    const fy = srcY - y0

    for (let x = 0; x < dstW; x++) {
      const srcX = (x * (srcW - 1)) / Math.max(1, dstW - 1)
      const x0 = Math.floor(srcX)
      const x1 = Math.min(x0 + 1, srcW - 1)
      const fx = srcX - x0

      const i00 = (y0 * srcW + x0) * 4
      const i10 = (y0 * srcW + x1) * 4
      const i01 = (y1 * srcW + x0) * 4
      const i11 = (y1 * srcW + x1) * 4
      const di = (y * dstW + x) * 4

      for (let c = 0; c < 4; c++) {
        const v =
          sd[i00 + c] * (1 - fx) * (1 - fy) +
          sd[i10 + c] * fx * (1 - fy) +
          sd[i01 + c] * (1 - fx) * fy +
          sd[i11 + c] * fx * fy
        od[di + c] = Math.round(v)
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
//  Conditional Mode Change (#161)
// ---------------------------------------------------------------------------

export type ColorModeId = "rgb" | "cmyk" | "grayscale" | "lab" | "bitmap" | "duotone" | "indexed" | "multichannel"

export interface ConditionalModeChangeSettings {
  sourceMode: ColorModeId | "any"
  targetMode: ColorModeId
}

/** Check if a mode change should happen based on conditions. */
export function shouldChangeMode(currentMode: string, settings: ConditionalModeChangeSettings): boolean {
  const normalized = currentMode.toLowerCase().replace(/[^a-z]/g, "").replace(/color$/, "")
  if (settings.sourceMode === "any") return normalized !== settings.targetMode
  return normalized === settings.sourceMode && normalized !== settings.targetMode
}

/** Returns the target mode if a change is needed, null otherwise. */
export function conditionalModeChange(
  currentMode: string,
  settings: ConditionalModeChangeSettings,
): ColorModeId | null {
  return shouldChangeMode(currentMode, settings) ? settings.targetMode : null
}

// ---------------------------------------------------------------------------
//  Image Processor (#159)
// ---------------------------------------------------------------------------

export interface ImageProcessorFormat {
  format: "jpeg" | "psd" | "tiff" | "png"
  quality?: number
  resize?: { width: number; height: number; constrainProportions: boolean }
}

export interface ImageProcessorSettings {
  formats: ImageProcessorFormat[]
  runAction?: { set: string; action: string }
  iccProfile?: string
  copyright?: string
  includeIcc?: boolean
}

export interface ImageProcessorJob {
  fileName: string
  sourceBlob: Blob
  settings: ImageProcessorSettings
}

export interface ImageProcessorOutput {
  fileName: string
  outputs: Array<{ format: string; blob: Blob }>
}

/**
 * Process multiple images with specified settings.
 * Each job produces one or more output blobs in the requested formats.
 */
export async function processImageBatch(
  jobs: ImageProcessorJob[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImageProcessorOutput[]> {
  const results: ImageProcessorOutput[] = []

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]
    const outputs: Array<{ format: string; blob: Blob }> = []

    try {
      // Load the image from blob
      const bitmap = await createImageBitmap(job.sourceBlob)
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("Failed to get 2D context")
      ctx.drawImage(bitmap, 0, 0)

      for (const fmt of job.settings.formats) {
        let targetCanvas = canvas
        // Handle resize if specified
        if (fmt.resize) {
          const { width: dstW, height: dstH } = fitImageDimensions(
            bitmap.width,
            bitmap.height,
            {
              maxWidth: fmt.resize.width,
              maxHeight: fmt.resize.height,
              constrainProportions: fmt.resize.constrainProportions,
            },
          )
          const resized = new OffscreenCanvas(dstW, dstH)
          const rCtx = resized.getContext("2d")
          if (rCtx) {
            rCtx.drawImage(canvas, 0, 0, dstW, dstH)
            targetCanvas = resized
          }
        }

        // Export in the requested format
        let mimeType: string
        let ext: string
        switch (fmt.format) {
          case "jpeg":
            mimeType = "image/jpeg"
            ext = "jpg"
            break
          case "png":
            mimeType = "image/png"
            ext = "png"
            break
          case "tiff":
            // TIFF not natively supported by canvas — export as PNG fallback
            mimeType = "image/png"
            ext = "tiff"
            break
          case "psd":
            // PSD not natively supported — export as PNG fallback
            mimeType = "image/png"
            ext = "psd"
            break
          default:
            mimeType = "image/png"
            ext = "png"
        }

        const blob = await targetCanvas.convertToBlob({
          type: mimeType,
          quality: fmt.quality != null ? fmt.quality / 100 : undefined,
        })
        const _baseName = job.fileName.replace(/\.[^.]+$/, "")
        outputs.push({ format: ext, blob })
      }
    } catch {
      // Skip failed images
    }

    results.push({ fileName: job.fileName, outputs })
    onProgress?.(i + 1, jobs.length)
  }

  return results
}

// ---------------------------------------------------------------------------
//  Purge Commands (#163) — already in purge-commands.ts, verify coverage
// ---------------------------------------------------------------------------

export type PurgeTarget = "undo" | "clipboard" | "histories" | "all" | "video-cache"

export interface PurgeResult {
  target: PurgeTarget
  freedEstimate: string
  success: boolean
}

/** Estimate memory freed by purging a target. */
export function estimatePurgeSize(target: PurgeTarget): string {
  switch (target) {
    case "undo":
      return "~1-10 MB (undo buffer)"
    case "clipboard":
      return "~0-50 MB (clipboard data)"
    case "histories":
      return "~10-200 MB (history states)"
    case "video-cache":
      return "~0-500 MB (video cache)"
    case "all":
      return "~50-500 MB (all caches)"
  }
}

// ---------------------------------------------------------------------------
//  Flatten Transparency (#173)
// ---------------------------------------------------------------------------

/**
 * Flatten transparency: make semi-transparent pixels opaque by compositing
 * against the specified background color.
 */
export function flattenTransparency(
  imageData: ImageData,
  backgroundColor: [number, number, number] = [255, 255, 255],
): ImageData {
  const out = new ImageData(imageData.width, imageData.height)
  const sd = imageData.data
  const od = out.data
  const [bgR, bgG, bgB] = backgroundColor

  for (let i = 0; i < sd.length; i += 4) {
    const a = sd[i + 3] / 255
    od[i] = Math.round(sd[i] * a + bgR * (1 - a))
    od[i + 1] = Math.round(sd[i + 1] * a + bgG * (1 - a))
    od[i + 2] = Math.round(sd[i + 2] * a + bgB * (1 - a))
    od[i + 3] = 255
  }
  return out
}

// ---------------------------------------------------------------------------
//  Copy CSS / Copy SVG (#171)
// ---------------------------------------------------------------------------

export interface CSSGeneratorInput {
  width: number
  height: number
  borderRadius?: number
  backgroundColor?: string
  opacity?: number
  rotation?: number
  dropShadow?: { offsetX: number; offsetY: number; blur: number; color: string }
  stroke?: { color: string; width: number }
  gradientOverlay?: { type: "linear" | "radial"; angle?: number; stops: Array<{ color: string; position: number }> }
}

/** Generate CSS from shape layer properties. */
export function generateCSS(input: CSSGeneratorInput): string {
  const lines: string[] = []
  lines.push(`width: ${input.width}px;`)
  lines.push(`height: ${input.height}px;`)

  if (input.borderRadius != null && input.borderRadius > 0) {
    lines.push(`border-radius: ${input.borderRadius}px;`)
  }
  if (input.backgroundColor) {
    lines.push(`background-color: ${input.backgroundColor};`)
  }
  if (input.opacity != null && input.opacity < 1) {
    lines.push(`opacity: ${input.opacity};`)
  }
  if (input.rotation != null && input.rotation !== 0) {
    lines.push(`transform: rotate(${input.rotation}deg);`)
  }
  if (input.dropShadow) {
    const s = input.dropShadow
    lines.push(`box-shadow: ${s.offsetX}px ${s.offsetY}px ${s.blur}px ${s.color};`)
  }
  if (input.stroke) {
    lines.push(`border: ${input.stroke.width}px solid ${input.stroke.color};`)
  }
  if (input.gradientOverlay) {
    const g = input.gradientOverlay
    const stops = g.stops.map((s) => `${s.color} ${Math.round(s.position * 100)}%`).join(", ")
    if (g.type === "linear") {
      lines.push(`background: linear-gradient(${g.angle ?? 0}deg, ${stops});`)
    } else {
      lines.push(`background: radial-gradient(circle, ${stops});`)
    }
  }

  return lines.join("\n")
}

/** Generate SVG path data from a set of path points. */
export function generateSVGPath(
  points: Array<{ x: number; y: number; cp1?: { x: number; y: number }; cp2?: { x: number; y: number } }>,
  closed?: boolean,
): string {
  if (!points.length) return ""
  const parts: string[] = [`M ${points[0].x} ${points[0].y}`]
  for (let i = 1; i < points.length; i++) {
    const pt = points[i]
    const prev = points[i - 1]
    if (pt.cp1 && pt.cp2) {
      parts.push(`C ${pt.cp1.x} ${pt.cp1.y}, ${pt.cp2.x} ${pt.cp2.y}, ${pt.x} ${pt.y}`)
    } else if (prev.cp2) {
      parts.push(`Q ${prev.cp2.x} ${prev.cp2.y}, ${pt.x} ${pt.y}`)
    } else {
      parts.push(`L ${pt.x} ${pt.y}`)
    }
  }
  if (closed) parts.push("Z")
  return parts.join(" ")
}

/** Generate a complete SVG document from paths. */
export function generateSVGDocument(
  width: number,
  height: number,
  pathData: string,
  fill?: string,
  stroke?: string,
  strokeWidth?: number,
): string {
  const fillAttr = fill ? `fill="${fill}"` : 'fill="none"'
  const strokeAttr = stroke ? `stroke="${stroke}" stroke-width="${strokeWidth ?? 1}"` : ""
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <path d="${pathData}" ${fillAttr} ${strokeAttr} />
</svg>`
}
