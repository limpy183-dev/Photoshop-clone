/**
 * Progressive preview rendering.
 *
 * Plans and runs a sequence of redraws at increasing resolutions so the
 * user sees something on screen quickly, then watches the image refine
 * toward full quality. Useful for first paint on large documents, zoom
 * transitions, and expensive filter previews.
 *
 * Each stage is cancellable; if the caller starts a new render mid-way
 * through (e.g. the cursor moves again), the in-flight stages stop and
 * the new schedule starts at the lowest resolution.
 */

const FULL_QUALITY = 1
const DEFAULT_LARGE_DOC_PIXELS = 6_000_000
const DEFAULT_HUGE_DOC_PIXELS = 24_000_000

export interface ProgressivePreviewStage {
  scale: number
  /** ms to wait before this stage starts; later stages get more time so
   *  the user sees the rough draft first. */
  delayMs: number
  /** When true, this stage represents the final, full-quality render. */
  final: boolean
  reason: "low-res-preview" | "mid-res-preview" | "high-res-preview" | "full-quality"
}

export interface ProgressivePreviewPlanInput {
  width: number
  height: number
  zoom?: number
  motionInProgress?: boolean
  /** Bytes/pixel for the data being rendered (default 4 for RGBA). */
  bytesPerPixel?: number
  /** Threshold above which an extra coarse stage is added. */
  hugeDocumentPixels?: number
  /** Threshold above which a coarse stage is added. */
  largeDocumentPixels?: number
}

export interface ProgressivePreviewPlan {
  stages: ProgressivePreviewStage[]
  pixelCount: number
  shouldStage: boolean
  reason: "small-document" | "interaction-coarse" | "large-document" | "huge-document"
}

function positiveInt(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || value === undefined) return fallback
  return Math.max(1, Math.round(value))
}

export function planProgressivePreview(input: ProgressivePreviewPlanInput): ProgressivePreviewPlan {
  const width = positiveInt(input.width, 1)
  const height = positiveInt(input.height, 1)
  const pixelCount = width * height
  const huge = positiveInt(input.hugeDocumentPixels, DEFAULT_HUGE_DOC_PIXELS)
  const large = positiveInt(input.largeDocumentPixels, DEFAULT_LARGE_DOC_PIXELS)
  const motion = !!input.motionInProgress

  if (motion) {
    return {
      pixelCount,
      shouldStage: true,
      reason: "interaction-coarse",
      stages: [
        { scale: 0.25, delayMs: 0, final: false, reason: "low-res-preview" },
        { scale: FULL_QUALITY, delayMs: 120, final: true, reason: "full-quality" },
      ],
    }
  }

  if (pixelCount >= huge) {
    return {
      pixelCount,
      shouldStage: true,
      reason: "huge-document",
      stages: [
        { scale: 1 / 8, delayMs: 0, final: false, reason: "low-res-preview" },
        { scale: 1 / 4, delayMs: 30, final: false, reason: "mid-res-preview" },
        { scale: 1 / 2, delayMs: 90, final: false, reason: "high-res-preview" },
        { scale: FULL_QUALITY, delayMs: 220, final: true, reason: "full-quality" },
      ],
    }
  }

  if (pixelCount >= large) {
    return {
      pixelCount,
      shouldStage: true,
      reason: "large-document",
      stages: [
        { scale: 1 / 4, delayMs: 0, final: false, reason: "low-res-preview" },
        { scale: 1 / 2, delayMs: 60, final: false, reason: "mid-res-preview" },
        { scale: FULL_QUALITY, delayMs: 160, final: true, reason: "full-quality" },
      ],
    }
  }

  return {
    pixelCount,
    shouldStage: false,
    reason: "small-document",
    stages: [{ scale: FULL_QUALITY, delayMs: 0, final: true, reason: "full-quality" }],
  }
}

export interface ProgressivePreviewRunner {
  start(): Promise<void>
  cancel(): void
  readonly isRunning: boolean
}

export interface ProgressivePreviewRunOptions extends ProgressivePreviewPlanInput {
  render: (stage: ProgressivePreviewStage, signal: AbortSignal) => Promise<void> | void
  onStageComplete?: (stage: ProgressivePreviewStage) => void
  /** Override for the plan; tests can pre-compute a plan and pass it in. */
  plan?: ProgressivePreviewPlan
  /** Inject a custom scheduler (used by tests). */
  schedule?: (callback: () => void, delayMs: number) => () => void
}

function defaultSchedule(callback: () => void, delayMs: number) {
  if (delayMs <= 0) {
    const handle = typeof queueMicrotask === "function"
      ? (queueMicrotask(callback), 0)
      : typeof setTimeout === "function"
        ? setTimeout(callback, 0)
        : (callback(), 0)
    return () => {
      if (typeof clearTimeout === "function" && typeof handle === "number") clearTimeout(handle)
    }
  }
  const timer = setTimeout(callback, delayMs)
  return () => clearTimeout(timer)
}

export function createProgressivePreviewRunner(options: ProgressivePreviewRunOptions): ProgressivePreviewRunner {
  const plan = options.plan ?? planProgressivePreview(options)
  const schedule = options.schedule ?? defaultSchedule
  let abortController: AbortController | null = null
  let running = false

  const runner: ProgressivePreviewRunner = {
    get isRunning() {
      return running
    },
    cancel() {
      if (abortController) abortController.abort()
      abortController = null
      running = false
    },
    async start() {
      if (running) runner.cancel()
      abortController = new AbortController()
      const signal = abortController.signal
      running = true
      try {
        for (const stage of plan.stages) {
          if (signal.aborted) return
          await new Promise<void>((resolve) => {
            const cancelTimer = schedule(resolve, stage.delayMs)
            const onAbort = () => {
              cancelTimer()
              resolve()
            }
            if (signal.aborted) {
              onAbort()
              return
            }
            signal.addEventListener("abort", onAbort, { once: true })
          })
          if (signal.aborted) return
          await options.render(stage, signal)
          if (signal.aborted) return
          options.onStageComplete?.(stage)
        }
      } finally {
        running = false
        abortController = null
      }
    },
  }

  return runner
}

/**
 * Downsample an ImageData using nearest-neighbor sampling. Cheap enough
 * to run on the main thread for preview stages — quality is acceptable
 * for the low-res draft because the higher-quality stage replaces it
 * within a few hundred ms.
 */
export type PreviewResamplingQuality = "nearest" | "bilinear" | "bicubic"

function sampleNearest(src: ImageData, x: number, y: number, channel: number) {
  const sx = Math.max(0, Math.min(src.width - 1, Math.round(x)))
  const sy = Math.max(0, Math.min(src.height - 1, Math.round(y)))
  return src.data[(sy * src.width + sx) * 4 + channel]
}

function sampleBilinear(src: ImageData, x: number, y: number, channel: number) {
  const x0 = Math.max(0, Math.min(src.width - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(src.height - 1, Math.floor(y)))
  const x1 = Math.max(0, Math.min(src.width - 1, x0 + 1))
  const y1 = Math.max(0, Math.min(src.height - 1, y0 + 1))
  const tx = x - x0
  const ty = y - y0
  const i00 = (y0 * src.width + x0) * 4 + channel
  const i10 = (y0 * src.width + x1) * 4 + channel
  const i01 = (y1 * src.width + x0) * 4 + channel
  const i11 = (y1 * src.width + x1) * 4 + channel
  const top = src.data[i00] * (1 - tx) + src.data[i10] * tx
  const bottom = src.data[i01] * (1 - tx) + src.data[i11] * tx
  return top * (1 - ty) + bottom * ty
}

function cubicWeight(t: number) {
  const a = -0.5
  const x = Math.abs(t)
  if (x <= 1) return (a + 2) * x * x * x - (a + 3) * x * x + 1
  if (x < 2) return a * x * x * x - 5 * a * x * x + 8 * a * x - 4 * a
  return 0
}

function sampleBicubic(src: ImageData, x: number, y: number, channel: number) {
  const baseX = Math.floor(x)
  const baseY = Math.floor(y)
  let value = 0
  let totalWeight = 0
  for (let yy = -1; yy <= 2; yy++) {
    const sy = Math.max(0, Math.min(src.height - 1, baseY + yy))
    const wy = cubicWeight(y - (baseY + yy))
    for (let xx = -1; xx <= 2; xx++) {
      const sx = Math.max(0, Math.min(src.width - 1, baseX + xx))
      const wx = cubicWeight(x - (baseX + xx))
      const weight = wx * wy
      value += src.data[(sy * src.width + sx) * 4 + channel] * weight
      totalWeight += weight
    }
  }
  return totalWeight ? value / totalWeight : sampleBilinear(src, x, y, channel)
}

export function downsampleImageData(
  src: ImageData,
  scale: number,
  quality: PreviewResamplingQuality = "bilinear",
): ImageData {
  if (scale >= 1) return src
  const safeScale = Math.max(0.01, scale)
  const dstW = Math.max(1, Math.round(src.width * safeScale))
  const dstH = Math.max(1, Math.round(src.height * safeScale))
  const out = new ImageData(dstW, dstH)
  const xRatio = src.width / dstW
  const yRatio = src.height / dstH
  const sampler = quality === "nearest" ? sampleNearest : quality === "bicubic" ? sampleBicubic : sampleBilinear
  for (let y = 0; y < dstH; y++) {
    const srcY = Math.max(0, Math.min(src.height - 1, (y + 0.5) * yRatio - 0.5))
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.max(0, Math.min(src.width - 1, (x + 0.5) * xRatio - 0.5))
      const di = (y * dstW + x) * 4
      out.data[di] = Math.round(sampler(src, srcX, srcY, 0))
      out.data[di + 1] = Math.round(sampler(src, srcX, srcY, 1))
      out.data[di + 2] = Math.round(sampler(src, srcX, srcY, 2))
      out.data[di + 3] = Math.round(sampler(src, srcX, srcY, 3))
    }
  }
  return out
}
