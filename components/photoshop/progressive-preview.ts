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
export function downsampleImageData(src: ImageData, scale: number): ImageData {
  if (scale >= 1) return src
  const safeScale = Math.max(0.01, scale)
  const dstW = Math.max(1, Math.round(src.width * safeScale))
  const dstH = Math.max(1, Math.round(src.height * safeScale))
  const out = new ImageData(dstW, dstH)
  const xRatio = src.width / dstW
  const yRatio = src.height / dstH
  for (let y = 0; y < dstH; y++) {
    const srcY = Math.min(src.height - 1, Math.floor(y * yRatio))
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.min(src.width - 1, Math.floor(x * xRatio))
      const si = (srcY * src.width + srcX) * 4
      const di = (y * dstW + x) * 4
      out.data[di] = src.data[si]
      out.data[di + 1] = src.data[si + 1]
      out.data[di + 2] = src.data[si + 2]
      out.data[di + 3] = src.data[si + 3]
    }
  }
  return out
}
