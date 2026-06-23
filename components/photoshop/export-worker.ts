import type { RasterExportOptions } from "./document-io-types"

type RasterWorkerFormat = RasterExportOptions["format"]

export interface RasterExportExecutionInput {
  width: number
  height: number
  format: RasterWorkerFormat
  scale: number
  workerSupported?: boolean
  offscreenSupported?: boolean
}

export interface RasterExportExecutionPlan {
  mode: "worker-offscreen" | "main-thread"
  reason: "large-supported-export" | "small-export" | "unsupported-runtime" | "gif-main-thread"
  outputWidth: number
  outputHeight: number
  pixelCount: number
}

interface RasterExportWorkerRequest {
  id: number
  width: number
  height: number
  outputWidth: number
  outputHeight: number
  buffer: ArrayBuffer
  format: RasterWorkerFormat
  quality: number
  dither: boolean
}

interface RasterExportWorkerResponse {
  id: number
  blob?: Blob
  error?: string
}

let _worker: Worker | null = null
let _workerFailed = false
let _nextId = 0
const _pending = new Map<number, { resolve: (blob: Blob) => void; reject: (err: Error) => void }>()

function hasOffscreenCanvas() {
  return typeof OffscreenCanvas === "function" && typeof OffscreenCanvas.prototype?.convertToBlob === "function"
}

function hasWorkerRuntime() {
  return typeof Worker === "function" && typeof Blob === "function" && typeof URL === "function"
}

function rasterMimeForWorker(format: RasterWorkerFormat) {
  if (format === "jpeg") return "image/jpeg"
  if (format === "webp") return "image/webp"
  if (format === "avif") return "image/avif"
  if (format === "gif") return "image/gif"
  return "image/png"
}

function abortError(message: string) {
  return new DOMException(message, "AbortError")
}

function timeoutError(message: string) {
  return new DOMException(message, "TimeoutError")
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

export function planRasterExportExecution(input: RasterExportExecutionInput): RasterExportExecutionPlan {
  const outputWidth = Math.max(1, Math.round(input.width * input.scale))
  const outputHeight = Math.max(1, Math.round(input.height * input.scale))
  const pixelCount = outputWidth * outputHeight
  if (input.format === "gif") {
    return { mode: "main-thread", reason: "gif-main-thread", outputWidth, outputHeight, pixelCount }
  }
  if (pixelCount < 4_000_000) {
    return { mode: "main-thread", reason: "small-export", outputWidth, outputHeight, pixelCount }
  }
  if (input.workerSupported === false || input.offscreenSupported === false) {
    return { mode: "main-thread", reason: "unsupported-runtime", outputWidth, outputHeight, pixelCount }
  }
  return { mode: "worker-offscreen", reason: "large-supported-export", outputWidth, outputHeight, pixelCount }
}

function workerSource() {
  return `
const mimeFor = (format) => format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : format === "avif" ? "image/avif" : "image/png";
function applyDither(data) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const n = (Math.random() - 0.5) * 1.6;
    data[i] = Math.max(0, Math.min(255, data[i] + n));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
  }
}
self.onmessage = async (event) => {
  const request = event.data;
  try {
    if (typeof OffscreenCanvas !== "function") throw new Error("OffscreenCanvas unavailable");
    const src = new OffscreenCanvas(request.width, request.height);
    const srcCtx = src.getContext("2d");
    const img = new ImageData(new Uint8ClampedArray(request.buffer), request.width, request.height);
    if (request.dither) applyDither(img.data);
    srcCtx.putImageData(img, 0, 0);
    const out = new OffscreenCanvas(request.outputWidth, request.outputHeight);
    const outCtx = out.getContext("2d");
    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = "high";
    outCtx.drawImage(src, 0, 0, request.outputWidth, request.outputHeight);
    const blob = await out.convertToBlob({ type: mimeFor(request.format), quality: request.quality });
    self.postMessage({ id: request.id, blob });
  } catch (err) {
    self.postMessage({ id: request.id, error: err instanceof Error ? err.message : String(err) });
  }
};
`
}

function getWorker() {
  if (_worker) return _worker
  if (_workerFailed || !hasWorkerRuntime() || !hasOffscreenCanvas()) return null
  try {
    const blob = new Blob([workerSource()], { type: "text/javascript" })
    const url = URL.createObjectURL(blob)
    _worker = new Worker(url, { type: "module" })
    URL.revokeObjectURL(url)
    _worker.onmessage = (event: MessageEvent<RasterExportWorkerResponse>) => {
      const response = event.data
      const pending = _pending.get(response.id)
      if (!pending) return
      _pending.delete(response.id)
      if (response.error || !response.blob) {
        pending.reject(new Error(response.error ?? "Raster export worker returned no blob"))
        return
      }
      pending.resolve(response.blob)
    }
    _worker.onerror = (event) => {
      _workerFailed = true
      const message = event.message || "Raster export worker failed"
      for (const [id, pending] of _pending) {
        pending.reject(new Error(message))
        _pending.delete(id)
      }
    }
    return _worker
  } catch {
    _workerFailed = true
    return null
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: RasterWorkerFormat,
  quality: number,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
) {
  return new Promise<Blob>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError("Raster export cancelled"))
      return
    }
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = () => {
      if (timer !== null) clearTimeout(timer)
      options.signal?.removeEventListener("abort", onAbort)
    }
    const finishResolve = (blob: Blob) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(blob)
    }
    const finishReject = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onAbort = () => finishReject(abortError("Raster export cancelled"))
    options.signal?.addEventListener("abort", onAbort, { once: true })
    if (typeof options.timeoutMs === "number") {
      const timeoutMs = Math.max(1, Math.round(options.timeoutMs))
      timer = setTimeout(() => finishReject(timeoutError(`Raster export timed out after ${timeoutMs}ms`)), timeoutMs)
    }
    canvas.toBlob((blob) => {
      if (blob) finishResolve(blob)
      else finishReject(new Error("Canvas export returned no blob"))
    }, rasterMimeForWorker(format), quality)
  })
}

export async function exportRasterImageDataToBlob(
  image: ImageData,
  options: RasterExportOptions,
): Promise<Blob> {
  if (options.signal?.aborted) throw abortError("Raster export cancelled")
  const plan = planRasterExportExecution({
    width: image.width,
    height: image.height,
    format: options.format,
    scale: options.scale,
    workerSupported: hasWorkerRuntime() && !_workerFailed,
    offscreenSupported: hasOffscreenCanvas(),
  })
  const quality = options.quality
  if (plan.mode === "worker-offscreen") {
    const worker = getWorker()
    if (worker) {
      const id = _nextId++
      const buffer = new ArrayBuffer(image.data.byteLength)
      new Uint8ClampedArray(buffer).set(image.data)
      const request: RasterExportWorkerRequest = {
        id,
        width: image.width,
        height: image.height,
        outputWidth: plan.outputWidth,
        outputHeight: plan.outputHeight,
        buffer,
        format: options.format,
        quality,
        dither: !!options.dither,
      }
      try {
        return await new Promise<Blob>((resolve, reject) => {
          let settled = false
          let timer: ReturnType<typeof setTimeout> | null = null
          const cleanup = () => {
            if (timer !== null) clearTimeout(timer)
            options.signal?.removeEventListener("abort", onAbort)
          }
          const settleReject = (error: Error) => {
            if (settled) return
            settled = true
            _pending.delete(id)
            cleanup()
            reject(error)
          }
          const settleResolve = (blob: Blob) => {
            if (settled) return
            settled = true
            _pending.delete(id)
            cleanup()
            resolve(blob)
          }
          const onAbort = () => settleReject(abortError("Raster export cancelled"))
          _pending.set(id, { resolve: settleResolve, reject: settleReject })
          if (options.signal) {
            if (options.signal.aborted) {
              settleReject(abortError("Raster export cancelled"))
              return
            }
            options.signal.addEventListener("abort", onAbort, { once: true })
          }
          if (typeof options.timeoutMs === "number") {
            const timeoutMs = Math.max(1, Math.round(options.timeoutMs))
            timer = setTimeout(() => settleReject(timeoutError(`Raster export worker timed out after ${timeoutMs}ms`)), timeoutMs)
          }
          worker.postMessage(request, [buffer])
        })
      } catch (error) {
        if (isAbortError(error)) throw error
        _workerFailed = true
      }
    }
  }

  const canvas = document.createElement("canvas")
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext("2d")!
  const copy = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height)
  if (options.dither) {
    for (let i = 0; i < copy.data.length; i += 4) {
      if (copy.data[i + 3] === 0) continue
      const n = (Math.random() - 0.5) * 1.6
      copy.data[i] = Math.max(0, Math.min(255, copy.data[i] + n))
      copy.data[i + 1] = Math.max(0, Math.min(255, copy.data[i + 1] + n))
      copy.data[i + 2] = Math.max(0, Math.min(255, copy.data[i + 2] + n))
    }
  }
  ctx.putImageData(copy, 0, 0)
  const out = document.createElement("canvas")
  out.width = plan.outputWidth
  out.height = plan.outputHeight
  const outCtx = out.getContext("2d")!
  outCtx.imageSmoothingEnabled = true
  outCtx.imageSmoothingQuality = "high"
  outCtx.drawImage(canvas, 0, 0, out.width, out.height)
  return canvasToBlob(out, options.format, quality, {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  })
}

export function _resetRasterExportWorkerForTests() {
  _worker?.terminate()
  _worker = null
  _workerFailed = false
  _pending.clear()
}
