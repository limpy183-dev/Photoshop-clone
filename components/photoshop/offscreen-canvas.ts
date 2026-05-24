/**
 * OffscreenCanvas helpers.
 *
 * Provides a small wrapper around OffscreenCanvas so callers can write
 * one path that targets either an `OffscreenCanvas` (when supported,
 * preferred for worker- and compositor-friendly rendering) or a regular
 * `HTMLCanvasElement` fallback. Also exposes pure planner functions so
 * tests can verify capability-detection without a browser.
 */

import { makeCanvas } from "./canvas-utils"
import { assertCanvasSize } from "./canvas-limits"

export interface OffscreenCanvas2DLike {
  readonly width: number
  readonly height: number
  getContext(type: "2d"): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
}

export interface OffscreenCanvasCapabilities {
  offscreenCanvasSupported: boolean
  transferToImageBitmapSupported: boolean
  workerOffscreenSupported: boolean
  webglOffscreenSupported: boolean
}

export interface OffscreenDetectionInput {
  OffscreenCanvasCtor?: unknown
}

export interface CanvasSurfacePlanInput {
  width: number
  height: number
  purpose: "layer" | "scratch" | "export" | "preview"
  offscreenSupported?: boolean
  workerContext?: boolean
}

export interface CanvasSurfacePlan {
  kind: "offscreen" | "html"
  reason:
    | "worker-export"
    | "worker-scratch"
    | "large-preview"
    | "dom-layer-compatibility"
    | "offscreen-unavailable"
  width: number
  height: number
  pixelCount: number
}

export function canUseOffscreenCanvas(input: OffscreenDetectionInput = {}): boolean {
  if ("OffscreenCanvasCtor" in input) return typeof input.OffscreenCanvasCtor === "function"
  return typeof OffscreenCanvas === "function" && typeof OffscreenCanvas.prototype?.getContext === "function"
}

export function planCanvasSurface(input: CanvasSurfacePlanInput): CanvasSurfacePlan {
  const size = assertCanvasSize(input.width, input.height)
  const pixelCount = size.width * size.height
  const offscreenSupported = input.offscreenSupported ?? canUseOffscreenCanvas()
  if (input.purpose === "layer") {
    return {
      kind: "html",
      reason: "dom-layer-compatibility",
      width: size.width,
      height: size.height,
      pixelCount,
    }
  }
  if (!offscreenSupported) {
    return {
      kind: "html",
      reason: "offscreen-unavailable",
      width: size.width,
      height: size.height,
      pixelCount,
    }
  }
  if (input.workerContext && input.purpose === "export") {
    return { kind: "offscreen", reason: "worker-export", width: size.width, height: size.height, pixelCount }
  }
  if (input.workerContext && input.purpose === "scratch") {
    return { kind: "offscreen", reason: "worker-scratch", width: size.width, height: size.height, pixelCount }
  }
  if (input.purpose === "preview" && pixelCount >= 4_000_000) {
    return { kind: "offscreen", reason: "large-preview", width: size.width, height: size.height, pixelCount }
  }
  return { kind: "html", reason: "dom-layer-compatibility", width: size.width, height: size.height, pixelCount }
}

export interface OffscreenCanvasPlanInput {
  width: number
  height: number
  preferOffscreen?: boolean
  needsWorkerTransfer?: boolean
  capabilities?: Partial<OffscreenCanvasCapabilities>
}

export interface OffscreenCanvasPlan {
  surface: "offscreen-canvas" | "html-canvas"
  reason:
    | "offscreen-ready"
    | "offscreen-unavailable"
    | "ssr-fallback"
    | "worker-transfer-required-but-unavailable"
    | "explicit-fallback"
  width: number
  height: number
}

export function detectOffscreenCanvasCapabilities(): OffscreenCanvasCapabilities {
  const offscreenCanvasSupported =
    typeof OffscreenCanvas === "function" &&
    typeof OffscreenCanvas.prototype?.getContext === "function"
  const transferToImageBitmapSupported =
    offscreenCanvasSupported && typeof OffscreenCanvas.prototype?.transferToImageBitmap === "function"
  const workerOffscreenSupported =
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype?.transferControlToOffscreen === "function"
  let webglOffscreenSupported = false
  if (offscreenCanvasSupported) {
    try {
      const probe = new OffscreenCanvas(1, 1)
      const ctx = probe.getContext("webgl") ?? probe.getContext("webgl2")
      webglOffscreenSupported = !!ctx
    } catch {
      webglOffscreenSupported = false
    }
  }
  return {
    offscreenCanvasSupported,
    transferToImageBitmapSupported,
    workerOffscreenSupported,
    webglOffscreenSupported,
  }
}

export function planOffscreenCanvasUsage(input: OffscreenCanvasPlanInput): OffscreenCanvasPlan {
  const size = assertCanvasSize(input.width, input.height)
  const detected = detectOffscreenCanvasCapabilities()
  const capabilities: OffscreenCanvasCapabilities = {
    offscreenCanvasSupported: input.capabilities?.offscreenCanvasSupported ?? detected.offscreenCanvasSupported,
    transferToImageBitmapSupported:
      input.capabilities?.transferToImageBitmapSupported ?? detected.transferToImageBitmapSupported,
    workerOffscreenSupported: input.capabilities?.workerOffscreenSupported ?? detected.workerOffscreenSupported,
    webglOffscreenSupported: input.capabilities?.webglOffscreenSupported ?? detected.webglOffscreenSupported,
  }
  const preferOffscreen = input.preferOffscreen !== false

  if (typeof document === "undefined" && !capabilities.offscreenCanvasSupported) {
    return { surface: "html-canvas", reason: "ssr-fallback", width: size.width, height: size.height }
  }

  if (input.needsWorkerTransfer && !capabilities.workerOffscreenSupported) {
    return {
      surface: "html-canvas",
      reason: "worker-transfer-required-but-unavailable",
      width: size.width,
      height: size.height,
    }
  }

  if (!preferOffscreen) {
    return { surface: "html-canvas", reason: "explicit-fallback", width: size.width, height: size.height }
  }

  if (!capabilities.offscreenCanvasSupported) {
    return { surface: "html-canvas", reason: "offscreen-unavailable", width: size.width, height: size.height }
  }

  return { surface: "offscreen-canvas", reason: "offscreen-ready", width: size.width, height: size.height }
}

export interface CanvasSurface {
  readonly width: number
  readonly height: number
  /** Underlying surface; either an OffscreenCanvas or HTMLCanvasElement. */
  readonly raw: OffscreenCanvas | HTMLCanvasElement
  /** True when the surface is an OffscreenCanvas. */
  readonly isOffscreen: boolean
  getContext2D(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
}

class OffscreenSurface implements CanvasSurface {
  readonly isOffscreen = true
  constructor(readonly raw: OffscreenCanvas) {}
  get width() {
    return this.raw.width
  }
  get height() {
    return this.raw.height
  }
  getContext2D() {
    return this.raw.getContext("2d")
  }
}

class HTMLSurface implements CanvasSurface {
  readonly isOffscreen = false
  constructor(readonly raw: HTMLCanvasElement) {}
  get width() {
    return this.raw.width
  }
  get height() {
    return this.raw.height
  }
  getContext2D() {
    return this.raw.getContext("2d")
  }
}

export function createCanvasSurface(
  width: number,
  height: number,
  options: { preferOffscreen?: boolean; needsWorkerTransfer?: boolean; fill?: string } = {},
): CanvasSurface {
  const plan = planOffscreenCanvasUsage({
    width,
    height,
    preferOffscreen: options.preferOffscreen,
    needsWorkerTransfer: options.needsWorkerTransfer,
  })
  if (plan.surface === "offscreen-canvas" && typeof OffscreenCanvas === "function") {
    try {
      const surface = new OffscreenCanvas(plan.width, plan.height)
      if (options.fill) {
        const ctx = surface.getContext("2d")
        if (ctx) {
          ctx.fillStyle = options.fill
          ctx.fillRect(0, 0, plan.width, plan.height)
        }
      }
      return new OffscreenSurface(surface)
    } catch {
      // fall through to HTMLCanvas
    }
  }
  return new HTMLSurface(makeCanvas(plan.width, plan.height, options.fill))
}

/**
 * Snapshot the surface to an ImageBitmap. Cheap on OffscreenCanvas
 * (zero-copy transfer); on HTML canvases, we fall back to
 * `createImageBitmap`.
 */
export async function surfaceToImageBitmap(surface: CanvasSurface): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null
  if (surface.isOffscreen) {
    const offscreen = surface.raw as OffscreenCanvas
    if (typeof offscreen.transferToImageBitmap === "function") {
      return offscreen.transferToImageBitmap()
    }
    return createImageBitmap(offscreen)
  }
  return createImageBitmap(surface.raw as HTMLCanvasElement)
}

/**
 * Best-effort copy from a surface to a target ImageData. Returns null
 * when the surface has no 2D context (SSR / context-lost).
 */
export function readSurfaceImageData(
  surface: CanvasSurface,
  rect: { x: number; y: number; w: number; h: number },
): ImageData | null {
  const ctx = surface.getContext2D()
  if (!ctx) return null
  const x = Math.max(0, Math.floor(rect.x))
  const y = Math.max(0, Math.floor(rect.y))
  const w = Math.max(0, Math.min(surface.width - x, Math.ceil(rect.w)))
  const h = Math.max(0, Math.min(surface.height - y, Math.ceil(rect.h)))
  if (w <= 0 || h <= 0) return null
  return ctx.getImageData(x, y, w, h)
}
