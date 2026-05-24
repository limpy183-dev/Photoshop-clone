/**
 * Async filter execution helpers.
 *
 * Lightweight per-pixel filters run in a Blob worker with transferable pixel
 * buffers. Filters that depend on the larger registry still use a scheduled
 * main-thread fallback so the call path stays asynchronous without overstating
 * worker coverage.
 */

import { FILTERS, getFilter } from "./filters"
import { planTileGrid } from "./performance-engine"

export interface FilterBatchOperation {
  filterId: string
  params: Record<string, number | string | boolean>
}

export interface FilterProgressEvent {
  completed: number
  total: number
  filterId: string
}

interface FilterWorkerRequest {
  id: number
  filterId?: string
  operations?: FilterBatchOperation[]
  width: number
  height: number
  buffer: ArrayBuffer
  params: Record<string, number | string | boolean>
}

interface FilterWorkerResponse {
  id: number
  width: number
  height: number
  buffer?: ArrayBuffer
  error?: string
  progress?: FilterProgressEvent
}

let _worker: Worker | null = null
let _workerFailed = false
let _nextId = 0
const _pending = new Map<number, {
  resolve: (data: ImageData) => void
  reject: (err: Error) => void
  progress?: (event: FilterProgressEvent) => void
}>()

const WORKER_SUPPORTED_FILTERS = [
  "invert",
  "grayscale",
  "desaturate",
  "sepia",
  "threshold",
  "posterize",
  "exposure",
  "brightness-contrast",
  "gaussian-blur",
  "box-blur",
  "motion-blur",
  "sharpen",
  "unsharp-mask",
  "noise",
  "ripple",
  "clouds",
  "difference-clouds",
  "fibers",
  "radial-blur",
  "surface-blur",
  "lens-blur",
  "oil-paint",
  "high-pass",
  "offset",
  "custom-convolution",
  "lighting-effects",
  "field-blur",
  "iris-blur",
  "tilt-shift",
  "path-blur",
  "spin-blur",
] as const

type WorkerSupportedFilter = typeof WORKER_SUPPORTED_FILTERS[number]

const WORKER_FILTER_SET = new Set<string>(WORKER_SUPPORTED_FILTERS)

export function isFilterWorkerSupported(filterId: string): filterId is WorkerSupportedFilter {
  return WORKER_FILTER_SET.has(filterId)
}

export function getFilterWorkerSupport() {
  return {
    strategy: "worker-for-supported-filters-with-async-main-thread-fallback",
    supportedFilters: [...WORKER_SUPPORTED_FILTERS],
  }
}

export type FilterWorkerAuditStrategy = "worker" | "main-thread-typed-array" | "main-thread-context"

export interface FilterWorkerAuditEntry {
  filterId: string
  name: string
  category: string
  strategy: FilterWorkerAuditStrategy
  transferableImageData: boolean
  reason: string
}

const CONTEXT_REQUIRED_FILTERS = new Set([
  "match-color",
  "displace",
  "apply-image",
  "calculations",
])

export function getFilterWorkerAudit() {
  const entries: FilterWorkerAuditEntry[] = Object.values(FILTERS)
    .map((filter) => {
      if (isFilterWorkerSupported(filter.id)) {
        return {
          filterId: filter.id,
          name: filter.name,
          category: filter.category,
          strategy: "worker" as const,
          transferableImageData: true,
          reason: "Dedicated typed-array worker implementation accepts transferable ImageData buffers.",
        }
      }
      if (CONTEXT_REQUIRED_FILTERS.has(filter.id)) {
        return {
          filterId: filter.id,
          name: filter.name,
          category: filter.category,
          strategy: "main-thread-context" as const,
          transferableImageData: false,
          reason: "Requires additional document/layer context that is not represented by a single transferable ImageData buffer.",
        }
      }
      return {
        filterId: filter.id,
        name: filter.name,
        category: filter.category,
        strategy: "main-thread-typed-array" as const,
        transferableImageData: true,
        reason: "Pure ImageData algorithm is audited for typed-array I/O and uses async main-thread fallback until a parity worker implementation is added.",
      }
    })
    .sort((a, b) => a.filterId.localeCompare(b.filterId))

  return {
    totalFilters: entries.length,
    workerSupportedCount: entries.filter((entry) => entry.strategy === "worker").length,
    typedArrayFallbackCount: entries.filter((entry) => entry.strategy === "main-thread-typed-array").length,
    contextRequiredCount: entries.filter((entry) => entry.strategy === "main-thread-context").length,
    entries,
  }
}

export interface WorkerFallbackInput {
  filterId: string
  workerAvailable?: boolean
  workerSupported?: boolean
  workerFailed?: boolean
}

export interface WorkerFallbackPlan {
  strategy: "worker" | "main-thread-fallback"
  reason: "worker-ready" | "unsupported-filter" | "worker-unavailable" | "worker-failed"
  retryWorker: boolean
}

export function planWorkerFallback(input: WorkerFallbackInput): WorkerFallbackPlan {
  const workerSupported = input.workerSupported ?? isFilterWorkerSupported(input.filterId)
  if (!workerSupported) {
    return { strategy: "main-thread-fallback", reason: "unsupported-filter", retryWorker: false }
  }
  if (input.workerFailed) {
    return { strategy: "main-thread-fallback", reason: "worker-failed", retryWorker: false }
  }
  if (input.workerAvailable === false) {
    return { strategy: "main-thread-fallback", reason: "worker-unavailable", retryWorker: false }
  }
  return { strategy: "worker", reason: "worker-ready", retryWorker: true }
}

export interface ExpensiveFilterTilingOptions {
  tileSize?: number
  memoryBudgetMB?: number
}

export interface ExpensiveFilterTilingPlan {
  filterId: string
  strategy: "single-frame" | "tiled-main-thread" | "tiled-worker-preferred"
  tileSize: number
  tileColumns: number
  tileRows: number
  tileCount: number
  overlap: number
  yieldEveryTiles: number
  estimatedTilePixels: number
  warnings: string[]
}

function numParam(params: Record<string, number | string | boolean>, key: string, fallback: number) {
  const value = Number(params[key])
  return Number.isFinite(value) ? value : fallback
}

function suggestedFilterOverlap(filterId: string, params: Record<string, number | string | boolean>) {
  switch (filterId) {
    case "gaussian-blur":
    case "box-blur":
      return Math.max(0, Math.ceil(numParam(params, "radius", 4)))
    case "motion-blur":
      return Math.max(0, Math.ceil(numParam(params, "distance", 12)))
    case "unsharp-mask":
      return Math.max(1, Math.ceil(numParam(params, "radius", 1)))
    case "sharpen":
      return 1
    case "ripple":
      return params.size === "large" ? 40 : params.size === "small" ? 5 : 15
    case "lens-blur":
      return Math.max(1, Math.ceil(numParam(params, "radius", 10)))
    case "surface-blur":
      return Math.max(1, Math.ceil(numParam(params, "radius", 5)))
    case "oil-paint":
      return Math.max(1, Math.ceil(numParam(params, "cleanliness", 4)))
    case "high-pass":
      return Math.max(1, Math.ceil(numParam(params, "radius", 10)))
    case "custom-convolution":
    case "lighting-effects":
      return 1
    default:
      return 0
  }
}

function isExpensiveFilter(filterId: string) {
  return [
    "gaussian-blur",
    "box-blur",
    "motion-blur",
    "unsharp-mask",
    "sharpen",
    "ripple",
    "clouds",
    "difference-clouds",
    "fibers",
    "lens-blur",
    "surface-blur",
    "oil-paint",
    "high-pass",
    "custom-convolution",
    "lighting-effects",
  ].includes(filterId)
}

export function planExpensiveFilterTiling(
  filterId: string,
  width: number,
  height: number,
  params: Record<string, number | string | boolean> = {},
  options: ExpensiveFilterTilingOptions = {},
): ExpensiveFilterTilingPlan {
  const tileSize = Math.max(1, Math.round(options.tileSize ?? 512))
  const grid = planTileGrid(width, height, tileSize)
  const expensive = isExpensiveFilter(filterId)
  const shouldTile = grid.tileCount > 1 && (expensive || width * height >= 16_000_000)
  const warnings: string[] = []

  if (shouldTile && suggestedFilterOverlap(filterId, params) > 0) {
    warnings.push("Neighborhood filter needs overlap to avoid tile edge artifacts.")
  }

  return {
    filterId,
    strategy: shouldTile
      ? isFilterWorkerSupported(filterId)
        ? "tiled-worker-preferred"
        : "tiled-main-thread"
      : "single-frame",
    tileSize,
    tileColumns: grid.tileColumns,
    tileRows: grid.tileRows,
    tileCount: grid.tileCount,
    overlap: suggestedFilterOverlap(filterId, params),
    yieldEveryTiles: grid.tileCount > 16 ? 4 : 8,
    estimatedTilePixels: tileSize * tileSize,
    warnings,
  }
}

function workerSource() {
  return `
const clamp8 = (value) => Math.max(0, Math.min(255, Math.round(value)));
const clampValue = (value) => Math.max(0, Math.min(255, value));
const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (value, fallback = false) => typeof value === "boolean" ? value : fallback;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const round2 = (value) => Math.round(value * 100) / 100;
function pseudoDither(i) {
  const x = Math.sin((i + 1) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function parsePercentPoints(value) {
  return String(value || "")
    .split(";")
    .map((entry) => entry.split(",").map((part) => Number(String(part).trim())))
    .filter((parts) => parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]))
    .map(([x, y]) => ({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) }));
}

function parseFieldPins(value) {
  return String(value || "")
    .split(";")
    .map((entry) => entry.split(",").map((part) => Number(String(part).trim())))
    .filter((parts) => parts.length >= 3 && parts.every(Number.isFinite))
    .map(([x, y, blur]) => ({
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y)),
      blur: Math.max(0, Math.min(80, Math.round(blur))),
    }));
}

function brightnessContrast(data, params) {
  const brightness = num(params.brightness, 0);
  const contrast = num(params.contrast, 0);
  if (bool(params.useLegacy, false)) {
    const c = (contrast + 100) / 100;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp8((data[i] - 128) * c + 128 + brightness);
      data[i + 1] = clamp8((data[i + 1] - 128) * c + 128 + brightness);
      data[i + 2] = clamp8((data[i + 2] - 128) * c + 128 + brightness);
    }
    return;
  }
  const b = brightness / 150;
  const c = contrast / 100;
  const pivot = 0.5 + b * 0.12;
  for (let i = 0; i < data.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      let v = data[i + k] / 255;
      v = b >= 0 ? v + (1 - v) * b : v * (1 + b);
      if (c !== 0) {
        const slope = c >= 0 ? 1 + c * 2.2 : 1 + c * 0.85;
        v = (v - pivot) * slope + pivot;
      }
      data[i + k] = clamp8(v * 255);
    }
  }
}

function boxBlur(data, width, height, params) {
  const radius = num(params.radius, 4);
  if (radius <= 0) return;
  const r = Math.floor(radius);
  const a = new Uint8ClampedArray(data);
  const b = new Uint8ClampedArray(a.length);
  const span = 2 * r + 1;

  for (let y = 0; y < height; y++) {
    let rs = 0;
    let gs = 0;
    let bs = 0;
    let as_ = 0;
    for (let i = -r; i <= r; i++) {
      const x = Math.max(0, Math.min(width - 1, i));
      const p = (y * width + x) * 4;
      rs += a[p];
      gs += a[p + 1];
      bs += a[p + 2];
      as_ += a[p + 3];
    }
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      b[p] = rs / span;
      b[p + 1] = gs / span;
      b[p + 2] = bs / span;
      b[p + 3] = as_ / span;
      const xOut = Math.max(0, Math.min(width - 1, x - r));
      const xIn = Math.max(0, Math.min(width - 1, x + r + 1));
      const pOut = (y * width + xOut) * 4;
      const pIn = (y * width + xIn) * 4;
      rs += a[pIn] - a[pOut];
      gs += a[pIn + 1] - a[pOut + 1];
      bs += a[pIn + 2] - a[pOut + 2];
      as_ += a[pIn + 3] - a[pOut + 3];
    }
  }

  for (let x = 0; x < width; x++) {
    let rs = 0;
    let gs = 0;
    let bs = 0;
    let as_ = 0;
    for (let i = -r; i <= r; i++) {
      const y = Math.max(0, Math.min(height - 1, i));
      const p = (y * width + x) * 4;
      rs += b[p];
      gs += b[p + 1];
      bs += b[p + 2];
      as_ += b[p + 3];
    }
    for (let y = 0; y < height; y++) {
      const p = (y * width + x) * 4;
      a[p] = rs / span;
      a[p + 1] = gs / span;
      a[p + 2] = bs / span;
      a[p + 3] = as_ / span;
      const yOut = Math.max(0, Math.min(height - 1, y - r));
      const yIn = Math.max(0, Math.min(height - 1, y + r + 1));
      const pOut = (yOut * width + x) * 4;
      const pIn = (yIn * width + x) * 4;
      rs += b[pIn] - b[pOut];
      gs += b[pIn + 1] - b[pOut + 1];
      bs += b[pIn + 2] - b[pOut + 2];
      as_ += b[pIn + 3] - b[pOut + 3];
    }
  }

  data.set(a);
}

function gaussianBlur(data, width, height, params) {
  const radius = num(params.radius, 4);
  if (radius <= 0) return;
  const r = Math.max(1, Math.round(radius / 3));
  boxBlur(data, width, height, { radius: r });
  boxBlur(data, width, height, { radius: r });
  boxBlur(data, width, height, { radius: r });
}

function motionBlur(data, width, height, params) {
  const distance = num(params.distance, 12);
  const angleDeg = num(params.angle, 0);
  const out = new Uint8ClampedArray(data.length);
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const steps = Math.max(1, Math.round(distance));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let i = -steps; i <= steps; i++) {
        const sx = Math.round(x + dx * i);
        const sy = Math.round(y + dy * i);
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
        const p = (sy * width + sx) * 4;
        r += data[p];
        g += data[p + 1];
        b += data[p + 2];
        a += data[p + 3];
        n++;
      }
      const o = (y * width + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  data.set(out);
}

function convolve3(data, width, height, kernel, divisor = 1) {
  const src = new Uint8ClampedArray(data);
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let cy = 0; cy < 3; cy++) {
        for (let cx = 0; cx < 3; cx++) {
          const sy = Math.max(0, Math.min(height - 1, y + cy - 1));
          const sx = Math.max(0, Math.min(width - 1, x + cx - 1));
          const p = (sy * width + sx) * 4;
          const k = kernel[cy * 3 + cx];
          r += src[p] * k;
          g += src[p + 1] * k;
          b += src[p + 2] * k;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = clampValue(r / divisor);
      out[o + 1] = clampValue(g / divisor);
      out[o + 2] = clampValue(b / divisor);
      out[o + 3] = src[o + 3];
    }
  }
  data.set(out);
}

function sharpen(data, width, height, params) {
  const a = num(params.amount, 50) / 100;
  convolve3(data, width, height, [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0], 1);
}

function unsharpMask(data, width, height, params) {
  const original = new Uint8ClampedArray(data);
  const blurred = new Uint8ClampedArray(original);
  gaussianBlur(blurred, width, height, { radius: num(params.radius, 1) });
  const k = num(params.amount, 100) / 100;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp8(original[i] + (original[i] - blurred[i]) * k);
    data[i + 1] = clamp8(original[i + 1] + (original[i + 1] - blurred[i + 1]) * k);
    data[i + 2] = clamp8(original[i + 2] + (original[i + 2] - blurred[i + 2]) * k);
    data[i + 3] = original[i + 3];
  }
}

function addNoise(data, params) {
  const amount = num(params.amount, 25);
  if (amount <= 0) return;
  const mono = bool(params.mono, false);
  const gaussian = params.distribution === "gaussian";
  const randFn = gaussian
    ? () => {
        let u = 0;
        let v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * 0.33;
      }
    : () => Math.random() - 0.5;

  for (let i = 0; i < data.length; i += 4) {
    if (mono) {
      const n = randFn() * 2 * amount;
      data[i] = clampValue(data[i] + n);
      data[i + 1] = clampValue(data[i + 1] + n);
      data[i + 2] = clampValue(data[i + 2] + n);
    } else {
      data[i] = clampValue(data[i] + randFn() * 2 * amount);
      data[i + 1] = clampValue(data[i + 1] + randFn() * 2 * amount);
      data[i + 2] = clampValue(data[i + 2] + randFn() * 2 * amount);
    }
  }
}

function bilinearSample(data, width, height, fx, fy) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const dx = fx - x0;
  const dy = fy - y0;
  const sx0 = Math.max(0, Math.min(width - 1, x0));
  const sx1 = Math.max(0, Math.min(width - 1, x1));
  const sy0 = Math.max(0, Math.min(height - 1, y0));
  const sy1 = Math.max(0, Math.min(height - 1, y1));
  const p00 = (sy0 * width + sx0) * 4;
  const p10 = (sy0 * width + sx1) * 4;
  const p01 = (sy1 * width + sx0) * 4;
  const p11 = (sy1 * width + sx1) * 4;
  const w00 = (1 - dx) * (1 - dy);
  const w10 = dx * (1 - dy);
  const w01 = (1 - dx) * dy;
  const w11 = dx * dy;
  return [
    data[p00] * w00 + data[p10] * w10 + data[p01] * w01 + data[p11] * w11,
    data[p00 + 1] * w00 + data[p10 + 1] * w10 + data[p01 + 1] * w01 + data[p11 + 1] * w11,
    data[p00 + 2] * w00 + data[p10 + 2] * w10 + data[p01 + 2] * w01 + data[p11 + 2] * w11,
    data[p00 + 3] * w00 + data[p10 + 3] * w10 + data[p01 + 3] * w01 + data[p11 + 3] * w11,
  ];
}

function ripple(data, width, height, params) {
  const amount = num(params.amount, 50);
  const size = String(params.size || "medium");
  const out = new Uint8ClampedArray(data.length);
  const freq = size === "small" ? 0.4 : size === "large" ? 0.05 : 0.15;
  const amp = (amount / 100) * (size === "small" ? 5 : size === "large" ? 40 : 15);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = x + Math.sin(y * freq * Math.PI) * amp;
      const sy = y + Math.sin(x * freq * Math.PI) * amp;
      const i = (y * width + x) * 4;
      if (sx >= 0 && sx < width - 1 && sy >= 0 && sy < height - 1) {
        const p = bilinearSample(data, width, height, sx, sy);
        out[i] = p[0];
        out[i + 1] = p[1];
        out[i + 2] = p[2];
        out[i + 3] = p[3];
      }
    }
  }
  data.set(out);
}

function perlinFade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function perlinLerp(a, b, t) { return a + t * (b - a); }

function perlinNoise2D(x, y, seed) {
  const hash = (ix, iy) => {
    let h = ix * 374761393 + iy * 668265263 + seed * 1274126177;
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return h;
  };
  const grad = (h, dx, dy) => {
    const g = h & 3;
    return g === 0 ? dx + dy : g === 1 ? -dx + dy : g === 2 ? dx - dy : -dx - dy;
  };
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = perlinFade(fx), v = perlinFade(fy);
  const n00 = grad(hash(ix, iy), fx, fy);
  const n10 = grad(hash(ix + 1, iy), fx - 1, fy);
  const n01 = grad(hash(ix, iy + 1), fx, fy - 1);
  const n11 = grad(hash(ix + 1, iy + 1), fx - 1, fy - 1);
  return perlinLerp(perlinLerp(n00, n10, u), perlinLerp(n01, n11, u), v);
}

function fbmNoise(x, y, seed, octaves = 6) {
  let value = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    value += amp * perlinNoise2D(x * freq, y * freq, seed + i * 37);
    amp *= 0.5;
    freq *= 2;
  }
  return value * 0.5 + 0.5;
}

function renderClouds(data, width, height, params, difference) {
  const scale = num(params.scale, 50);
  const seed = num(params.seed, 0);
  const sc = Math.max(1, scale) / 50;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const n = fbmNoise(x / width / sc, y / height / sc, seed);
      const v = clamp8(n * 255);
      const i = (y * width + x) * 4;
      if (difference) {
        data[i] = Math.abs(data[i] - v);
        data[i + 1] = Math.abs(data[i + 1] - v);
        data[i + 2] = Math.abs(data[i + 2] - v);
      } else {
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
  }
}

function renderFibers(data, width, height, params) {
  const variance = num(params.variance, 16);
  const strength = num(params.strength, 4);
  const seed = num(params.seed, 0);
  const out = new Uint8ClampedArray(data.length);
  const sc = variance / 16;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const n1 = fbmNoise(x / width * sc * 0.3, y / height * sc * 4, seed);
      const n2 = fbmNoise(x / width * sc * 0.5 + 10, y / height * sc * 6 + 10, seed + 99);
      const v = clamp8(((n1 * 0.6 + n2 * 0.4) * strength / 4) * 255);
      const i = (y * width + x) * 4;
      out[i] = v;
      out[i + 1] = v;
      out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  data.set(out);
}

function radialBlur(data, width, height, params) {
  const amount = num(params.amount, 25);
  const method = String(params.method || "spin");
  const quality = String(params.quality || "good");
  const out = new Uint8ClampedArray(data.length);
  const cx = Math.max(0, Math.min(1, num(params.centerX, 50) / 100)) * (width - 1);
  const cy = Math.max(0, Math.min(1, num(params.centerY, 50) / 100)) * (height - 1);
  const strength = Math.max(0, Math.min(100, amount)) / 100;
  if (strength <= 0) return;
  const steps = quality === "best" ? 48 : quality === "good" ? 24 : 12;
  const diag = Math.hypot(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rs = 0, gs = 0, bs = 0, as_ = 0, wSum = 0;
      const dx = x - cx, dy = y - cy;
      const dist = Math.hypot(dx, dy);
      for (let s = 0; s < steps; s++) {
        const stepWeight = 1 - Math.abs((s / Math.max(1, steps - 1)) - 0.5) * 2;
        const jitter = quality === "best" ? (pseudoDither(y * width + x + s * 17) - 0.5) / steps : 0;
        const t = (s / Math.max(1, steps - 1) - 0.5 + jitter) * strength;
        let sx = x, sy = y;
        if (method === "zoom") {
          const scale = 1 + t * 1.3;
          sx = cx + dx * scale;
          sy = cy + dy * scale;
        } else {
          const arc = t * (diag * 0.5) / Math.max(8, dist);
          const cos = Math.cos(arc), sin = Math.sin(arc);
          sx = cx + dx * cos - dy * sin;
          sy = cy + dx * sin + dy * cos;
        }
        const sample = bilinearSample(data, width, height, sx, sy);
        rs += sample[0] * stepWeight; gs += sample[1] * stepWeight; bs += sample[2] * stepWeight; as_ += sample[3] * stepWeight;
        wSum += stepWeight;
      }
      const i = (y * width + x) * 4;
      out[i] = rs / wSum;
      out[i + 1] = gs / wSum;
      out[i + 2] = bs / wSum;
      out[i + 3] = as_ / wSum;
    }
  }
  data.set(out);
}

function mixBlurredByWeight(original, blurred, width, height, weightForPixel) {
  const out = new Uint8ClampedArray(original);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const weight = clamp01(weightForPixel(x, y));
      if (weight <= 0) continue;
      out[i] = clamp8(original[i] * (1 - weight) + blurred[i] * weight);
      out[i + 1] = clamp8(original[i + 1] * (1 - weight) + blurred[i + 1] * weight);
      out[i + 2] = clamp8(original[i + 2] * (1 - weight) + blurred[i + 2] * weight);
      out[i + 3] = original[i + 3];
    }
  }
  return out;
}

function fieldBlurGallery(data, width, height, params) {
  const blur = num(params.blur, 12);
  const pins = parseFieldPins(params.pins);
  if (pins.length > 0) {
    const maxBlur = Math.max(0, blur, ...pins.map((pin) => pin.blur));
    if (maxBlur <= 0) return;
    const blurred = new Uint8ClampedArray(data);
    boxBlur(blurred, width, height, { radius: Math.max(1, maxBlur) });
    const out = mixBlurredByWeight(data, blurred, width, height, (x, y) => {
      const px = (x / Math.max(1, width - 1)) * 100;
      const py = (y / Math.max(1, height - 1)) * 100;
      let weightedBlur = 0;
      let totalWeight = 0;
      for (const pin of pins) {
        const dx = ((px - pin.x) / 100) * width;
        const dy = ((py - pin.y) / 100) * height;
        const d2 = dx * dx + dy * dy;
        if (d2 < 0.25) return pin.blur / maxBlur;
        const weight = 1 / Math.max(1, d2);
        weightedBlur += pin.blur * weight;
        totalWeight += weight;
      }
      return totalWeight > 0 ? weightedBlur / totalWeight / maxBlur : 0;
    });
    data.set(out);
    return;
  }

  const blurred = new Uint8ClampedArray(data);
  boxBlur(blurred, width, height, { radius: Math.max(1, blur) });
  const cx = (num(params.centerX, 50) / 100) * Math.max(1, width - 1);
  const cy = (num(params.centerY, 50) / 100) * Math.max(1, height - 1);
  const maxDistance = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy)) || 1;
  const keepRadius = maxDistance * clamp01((100 - num(params.falloff, 45)) / 140);
  data.set(mixBlurredByWeight(data, blurred, width, height, (x, y) => {
    const d = Math.max(0, Math.hypot(x - cx, y - cy) - keepRadius);
    return d / Math.max(1, maxDistance - keepRadius);
  }));
}

function irisBlurGallery(data, width, height, params) {
  const blurred = new Uint8ClampedArray(data);
  boxBlur(blurred, width, height, { radius: Math.max(1, num(params.blur, 14)) });
  const cx = (num(params.centerX, 50) / 100) * Math.max(1, width - 1);
  const cy = (num(params.centerY, 50) / 100) * Math.max(1, height - 1);
  const rx = Math.max(1, width * (num(params.radius, 42) / 100) * 0.5);
  const ry = Math.max(1, height * (num(params.radius, 42) / 100) * 0.5);
  const featherWidth = Math.max(0.01, num(params.feather, 30) / 100);
  data.set(mixBlurredByWeight(data, blurred, width, height, (x, y) => {
    const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
    return (d - 1) / featherWidth;
  }));
}

function tiltShiftGallery(data, width, height, params) {
  const blurred = new Uint8ClampedArray(data);
  boxBlur(blurred, width, height, { radius: Math.max(1, num(params.blur, 16)) });
  const radians = (num(params.angle, 0) * Math.PI) / 180;
  const nx = -Math.sin(radians);
  const ny = Math.cos(radians);
  const cx = (num(params.centerX, 50) / 100) * Math.max(1, width - 1);
  const cy = (num(params.centerY, 50) / 100) * Math.max(1, height - 1);
  const clearBand = Math.max(1, Math.min(width, height) * (num(params.radius, 30) / 100) * 0.5);
  const featherBand = Math.max(1, Math.min(width, height) * (num(params.feather, 30) / 100));
  data.set(mixBlurredByWeight(data, blurred, width, height, (x, y) => {
    const d = Math.abs((x - cx) * nx + (y - cy) * ny);
    return (d - clearBand) / featherBand;
  }));
}

function pathAngleFromPoints(points, width, height) {
  const first = points[0];
  const last = points[points.length - 1];
  const dx = ((last.x - first.x) / 100) * width;
  const dy = ((last.y - first.y) / 100) * height;
  return Math.atan2(dy, dx) * 180 / Math.PI;
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0.0001) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = clamp01(((point.x - a.x) * dx + (point.y - a.y) * dy) / len2);
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function distanceToPolyline(point, points) {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length - 1; i++) best = Math.min(best, distanceToSegment(point, points[i], points[i + 1]));
  return best;
}

function pathBlurGallery(data, width, height, params) {
  const hasPath = String(params.path || "").trim().length > 0;
  const points = hasPath ? parsePercentPoints(params.path) : [];
  const angle = hasPath && points.length >= 2 ? pathAngleFromPoints(points, width, height) : num(params.angle, 0);
  const blurred = new Uint8ClampedArray(data);
  motionBlur(blurred, width, height, { distance: Math.max(1, num(params.distance, 24)), angle });
  const taperAmount = clamp01(num(params.taper, 18) / 100);
  if (hasPath && points.length >= 2) {
    const canvasPoints = points.map((point) => ({
      x: (point.x / 100) * Math.max(1, width - 1),
      y: (point.y / 100) * Math.max(1, height - 1),
    }));
    const influenceBand = Math.max(8, Math.min(width, height) * 0.18);
    data.set(mixBlurredByWeight(data, blurred, width, height, (x, y) => {
      const nearest = distanceToPolyline({ x, y }, canvasPoints);
      const pathWeight = 1 - clamp01(nearest / influenceBand);
      if (taperAmount <= 0) return pathWeight;
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
      const edgeWeight = 1 - clamp01(edge / Math.max(1, Math.min(width, height) * 0.5) * taperAmount);
      return Math.max(pathWeight, edgeWeight * 0.35);
    }));
    return;
  }
  if (taperAmount <= 0) {
    data.set(blurred);
    return;
  }
  data.set(mixBlurredByWeight(data, blurred, width, height, (x, y) => {
    const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
    return 1 - clamp01(edge / (Math.min(width, height) * 0.5) * taperAmount);
  }));
}

function spinBlurGallery(data, width, height, params) {
  const shifted = new Uint8ClampedArray(data);
  radialBlur(shifted, width, height, {
    amount: Math.max(1, num(params.amount, 28)),
    method: "spin",
    quality: "best",
    centerX: num(params.centerX, 50),
    centerY: num(params.centerY, 50),
  });
  const cx = (num(params.centerX, 50) / 100) * Math.max(1, width - 1);
  const cy = (num(params.centerY, 50) / 100) * Math.max(1, height - 1);
  const radiusPx = Math.max(1, Math.min(width, height) * clamp01(num(params.radius, 55) / 100) * 0.5);
  const featherPx = Math.max(2, radiusPx * 0.2);
  data.set(mixBlurredByWeight(data, shifted, width, height, (x, y) => 1 - clamp01((Math.hypot(x - cx, y - cy) - radiusPx) / featherPx)));
}

function lumaByte(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function highPass(data, width, height, params) {
  const original = new Uint8ClampedArray(data);
  const blurred = new Uint8ClampedArray(data);
  gaussianBlur(blurred, width, height, { radius: num(params.radius, 10) });
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp8(original[i] - blurred[i] + 128);
    data[i + 1] = clamp8(original[i + 1] - blurred[i + 1] + 128);
    data[i + 2] = clamp8(original[i + 2] - blurred[i + 2] + 128);
    data[i + 3] = original[i + 3];
  }
}

function offsetFilter(data, width, height, params) {
  const original = new Uint8ClampedArray(data);
  const out = new Uint8ClampedArray(data.length);
  const dx = Math.round(num(params.horizontal, 0));
  const dy = Math.round(num(params.vertical, 0));
  const mode = String(params.wrap || "wrap");
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sx = x - dx, sy = y - dy;
      const o = (y * width + x) * 4;
      if (mode === "wrap") {
        sx = ((sx % width) + width) % width;
        sy = ((sy % height) + height) % height;
      } else if (mode === "transparent") {
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
          out[o + 3] = 0;
          continue;
        }
      } else {
        sx = Math.max(0, Math.min(width - 1, sx));
        sy = Math.max(0, Math.min(height - 1, sy));
      }
      const s = (sy * width + sx) * 4;
      out[o] = original[s];
      out[o + 1] = original[s + 1];
      out[o + 2] = original[s + 2];
      out[o + 3] = original[s + 3];
    }
  }
  data.set(out);
}

function parseKernelMatrixWorker(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const numbers = value.trim().split(/[\\s,;]+/).map(Number).filter(Number.isFinite);
  if (numbers.length !== 9) return null;
  return numbers;
}

function customConvolution(data, width, height, params) {
  const kernels = {
    "sharpen-more": [0, -1, 0, -1, 5, -1, 0, -1, 0],
    "edge-enhance": [0, 0, 0, -1, 1, 0, 0, 0, 0],
    outline: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
    laplacian: [0, 1, 0, 1, -4, 1, 0, 1, 0],
    "sobel-x": [-1, 0, 1, -2, 0, 2, -1, 0, 1],
    "sobel-y": [-1, -2, -1, 0, 0, 0, 1, 2, 1],
  };
  const kernel = parseKernelMatrixWorker(params.matrix) || kernels[String(params.preset || "sharpen-more")] || kernels["sharpen-more"];
  const sum = kernel.reduce((acc, value) => acc + value, 0);
  const divisor = num(params.divisor, 0) || (sum > 0 ? sum : 1);
  const original = new Uint8ClampedArray(data);
  convolve3(data, width, height, kernel, divisor);
  const raw = new Uint8ClampedArray(data);
  const mix = Math.max(0, Math.min(200, num(params.strength, 100))) / 100;
  const bias = Math.max(-255, Math.min(255, num(params.bias, 0)));
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp8(original[i] * (1 - mix) + (raw[i] + bias) * mix);
    data[i + 1] = clamp8(original[i + 1] * (1 - mix) + (raw[i + 1] + bias) * mix);
    data[i + 2] = clamp8(original[i + 2] * (1 - mix) + (raw[i + 2] + bias) * mix);
    data[i + 3] = original[i + 3];
  }
}

function surfaceBlur(data, width, height, params) {
  const radius = num(params.radius, 5);
  const threshold = num(params.threshold, 24);
  if (radius <= 0 || threshold <= 0) return;
  const src = new Uint8ClampedArray(data);
  const out = new Uint8ClampedArray(data.length);
  const r = Math.max(1, Math.min(18, Math.round(radius)));
  const t = Math.max(0, Math.min(255, threshold));
  const sigmaS = Math.max(0.75, r * 0.65);
  const sigmaR = Math.max(1, t * 0.7);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const br = src[i], bg = src[i + 1], bb = src[i + 2];
      const baseLum = lumaByte(br, bg, bb);
      let rs = 0, gs = 0, bs = 0, as_ = 0, weightSum = 0;
      for (let oy = -r; oy <= r; oy++) {
        const sy = Math.max(0, Math.min(height - 1, y + oy));
        for (let ox = -r; ox <= r; ox++) {
          if (ox * ox + oy * oy > r * r) continue;
          const sx = Math.max(0, Math.min(width - 1, x + ox));
          const p = (sy * width + sx) * 4;
          const diff = Math.abs(lumaByte(src[p], src[p + 1], src[p + 2]) - baseLum);
          const colorDiff = Math.hypot(src[p] - br, src[p + 1] - bg, src[p + 2] - bb) / Math.sqrt(3);
          if (Math.max(diff, colorDiff) > t) continue;
          const spatial = Math.exp(-(ox * ox + oy * oy) / (2 * sigmaS * sigmaS));
          const range = Math.exp(-Math.pow(diff * 0.55 + colorDiff * 0.45, 2) / (2 * sigmaR * sigmaR));
          const weight = spatial * range;
          rs += src[p] * weight;
          gs += src[p + 1] * weight;
          bs += src[p + 2] * weight;
          as_ += src[p + 3] * weight;
          weightSum += weight;
        }
      }
      out[i] = weightSum ? rs / weightSum : src[i];
      out[i + 1] = weightSum ? gs / weightSum : src[i + 1];
      out[i + 2] = weightSum ? bs / weightSum : src[i + 2];
      out[i + 3] = weightSum ? as_ / weightSum : src[i + 3];
    }
  }
  data.set(out);
}

function lensBlur(data, width, height, params) {
  const radius = num(params.radius, 10);
  if (radius < 1) return;
  const src = new Uint8ClampedArray(data);
  const out = new Uint8ClampedArray(data.length);
  const r = Math.max(1, Math.min(40, Math.round(radius)));
  const blades = Math.max(3, Math.min(8, Math.round(num(params.bladeCount, 6))));
  const rot = num(params.rotation, 0) * Math.PI / 180;
  const kernel = [];
  for (let ky = -r; ky <= r; ky++) {
    for (let kx = -r; kx <= r; kx++) {
      const dist = Math.hypot(kx, ky);
      if (dist > r) continue;
      const angle = Math.atan2(ky, kx) - rot;
      const segment = (2 * Math.PI) / blades;
      const local = ((angle % segment) + segment) % segment;
      const polyRadius = r / Math.max(0.2, Math.cos(Math.PI / blades - local));
      if (dist <= Math.abs(polyRadius)) kernel.push([kx, ky]);
    }
  }
  const specK = num(params.brightness, 0) / 100;
  const specThreshold = num(params.threshold, 255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rs = 0, gs = 0, bs = 0, as_ = 0, ws = 0;
      for (const [kx, ky] of kernel) {
        const sx = Math.max(0, Math.min(width - 1, x + kx));
        const sy = Math.max(0, Math.min(height - 1, y + ky));
        const p = (sy * width + sx) * 4;
        let weight = 1;
        const lum = Math.max(src[p], src[p + 1], src[p + 2]);
        if (specK > 0 && lum > specThreshold) weight = 1 + ((lum - specThreshold) / 255) * specK * 4;
        rs += src[p] * weight;
        gs += src[p + 1] * weight;
        bs += src[p + 2] * weight;
        as_ += src[p + 3] * weight;
        ws += weight;
      }
      const i = (y * width + x) * 4;
      out[i] = rs / ws;
      out[i + 1] = gs / ws;
      out[i + 2] = bs / ws;
      out[i + 3] = as_ / ws;
    }
  }
  data.set(out);
}

function oilPaint(data, width, height, params) {
  const radius = Math.max(1, Math.min(8, Math.round(num(params.cleanliness, 4))));
  const stylization = Math.max(1, Math.min(10, num(params.stylization, 6)));
  const src = new Uint8ClampedArray(data);
  const out = new Uint8ClampedArray(data.length);
  const bins = 32;
  const hist = new Uint16Array(bins);
  const rs = new Uint32Array(bins);
  const gs = new Uint32Array(bins);
  const bs = new Uint32Array(bins);
  const strength = stylization / 10;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      hist.fill(0); rs.fill(0); gs.fill(0); bs.fill(0);
      for (let oy = -radius; oy <= radius; oy++) {
        const sy = Math.max(0, Math.min(height - 1, y + oy));
        for (let ox = -radius; ox <= radius; ox++) {
          if (ox * ox + oy * oy > radius * radius) continue;
          const sx = Math.max(0, Math.min(width - 1, x + ox));
          const p = (sy * width + sx) * 4;
          const lum = lumaByte(src[p], src[p + 1], src[p + 2]);
          const bin = Math.max(0, Math.min(bins - 1, Math.floor((lum / 256) * bins)));
          hist[bin]++;
          rs[bin] += src[p];
          gs[bin] += src[p + 1];
          bs[bin] += src[p + 2];
        }
      }
      let best = 0;
      for (let i = 1; i < bins; i++) if (hist[i] > hist[best]) best = i;
      const o = (y * width + x) * 4;
      const count = Math.max(1, hist[best]);
      out[o] = clamp8(src[o] * (1 - strength) + (rs[best] / count) * strength);
      out[o + 1] = clamp8(src[o + 1] * (1 - strength) + (gs[best] / count) * strength);
      out[o + 2] = clamp8(src[o + 2] * (1 - strength) + (bs[best] / count) * strength);
      out[o + 3] = src[o + 3];
    }
  }
  data.set(out);
}

function lightingEffects(data, width, height, params) {
  const src = new Uint8ClampedArray(data);
  const out = new Uint8ClampedArray(data.length);
  const style = String(params.style || "spot");
  const light = Math.max(0, num(params.intensity, 120)) / 100;
  const amb = Math.max(0, num(params.ambient, 45)) / 100;
  const heightScale = Math.max(0, Math.min(100, num(params.height, 35))) / 100;
  const lx = style === "directional" ? -0.5 : 0.35;
  const ly = style === "directional" ? -0.7 : -0.45;
  const lz = style === "omni" ? 0.95 : 0.7;
  const len = Math.hypot(lx, ly, lz);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const xl = Math.max(0, x - 1), xr = Math.min(width - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(height - 1, y + 1);
      const right = (y * width + xr) * 4, left = (y * width + xl) * 4, down = (yd * width + x) * 4, up = (yu * width + x) * 4;
      const lumX = lumaByte(src[right], src[right + 1], src[right + 2]) - lumaByte(src[left], src[left + 1], src[left + 2]);
      const lumY = lumaByte(src[down], src[down + 1], src[down + 2]) - lumaByte(src[up], src[up + 1], src[up + 2]);
      const nx = -lumX / 255 * heightScale, ny = -lumY / 255 * heightScale, nz = 1;
      const nLen = Math.hypot(nx, ny, nz);
      let spot = 1;
      if (style === "spot") {
        const dx = (x - width * 0.45) / width, dy = (y - height * 0.35) / height;
        spot = Math.max(0, 1 - Math.hypot(dx, dy) * 2.2);
      } else if (style === "omni") {
        const dx = (x - width * 0.5) / width, dy = (y - height * 0.5) / height;
        spot = Math.max(0, 1 - Math.hypot(dx, dy) * 1.8);
      }
      const diffuse = Math.max(0, (nx * lx + ny * ly + nz * lz) / (nLen * len));
      const highlight = Math.pow(diffuse, 18) * light * (0.35 + heightScale);
      const falloff = style === "directional" ? 1 : spot;
      const amount = amb + diffuse * light * falloff;
      out[i] = clamp8(src[i] * amount + (12 + 70 * highlight) * falloff);
      out[i + 1] = clamp8(src[i + 1] * amount + (16 + 62 * highlight) * falloff);
      out[i + 2] = clamp8(src[i + 2] * amount + (24 + 48 * highlight) * falloff);
      out[i + 3] = src[i + 3];
    }
  }
  data.set(out);
}

function applyFilter(filterId, data, params, width, height) {
  switch (filterId) {
    case "invert":
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255 - data[i];
        data[i + 1] = 255 - data[i + 1];
        data[i + 2] = 255 - data[i + 2];
      }
      return;
    case "grayscale":
      for (let i = 0; i < data.length; i += 4) {
        const v = clamp8(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
      }
      return;
    case "desaturate":
      for (let i = 0; i < data.length; i += 4) {
        const v = (Math.max(data[i], data[i + 1], data[i + 2]) + Math.min(data[i], data[i + 1], data[i + 2])) / 2;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
      }
      return;
    case "sepia": {
      const a = num(params.amount, 80) / 100;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const tr = 0.393 * r + 0.769 * g + 0.189 * b;
        const tg = 0.349 * r + 0.686 * g + 0.168 * b;
        const tb = 0.272 * r + 0.534 * g + 0.131 * b;
        data[i] = clamp8(r + (tr - r) * a);
        data[i + 1] = clamp8(g + (tg - g) * a);
        data[i + 2] = clamp8(b + (tb - b) * a);
      }
      return;
    }
    case "threshold": {
      const level = num(params.level, 128);
      for (let i = 0; i < data.length; i += 4) {
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const v = lum >= level ? 255 : 0;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
      }
      return;
    }
    case "posterize": {
      const levels = Math.max(2, Math.round(num(params.levels, 4)));
      const step = 255 / Math.max(1, levels - 1);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.round(data[i] / step) * step;
        data[i + 1] = Math.round(data[i + 1] / step) * step;
        data[i + 2] = Math.round(data[i + 2] / step) * step;
      }
      return;
    }
    case "exposure": {
      const factor = Math.pow(2, num(params.ev, 0));
      for (let i = 0; i < data.length; i += 4) {
        data[i] = clamp8(data[i] * factor);
        data[i + 1] = clamp8(data[i + 1] * factor);
        data[i + 2] = clamp8(data[i + 2] * factor);
      }
      return;
    }
    case "brightness-contrast":
      brightnessContrast(data, params);
      return;
    case "gaussian-blur":
      gaussianBlur(data, width, height, params);
      return;
    case "box-blur":
      boxBlur(data, width, height, params);
      return;
    case "motion-blur":
      motionBlur(data, width, height, params);
      return;
    case "sharpen":
      sharpen(data, width, height, params);
      return;
    case "unsharp-mask":
      unsharpMask(data, width, height, params);
      return;
    case "noise":
      addNoise(data, params);
      return;
    case "ripple":
      ripple(data, width, height, params);
      return;
    case "clouds":
      renderClouds(data, width, height, params, false);
      return;
    case "difference-clouds":
      renderClouds(data, width, height, params, true);
      return;
    case "fibers":
      renderFibers(data, width, height, params);
      return;
    case "radial-blur":
      radialBlur(data, width, height, params);
      return;
    case "field-blur":
      fieldBlurGallery(data, width, height, params);
      return;
    case "iris-blur":
      irisBlurGallery(data, width, height, params);
      return;
    case "tilt-shift":
      tiltShiftGallery(data, width, height, params);
      return;
    case "path-blur":
      pathBlurGallery(data, width, height, params);
      return;
    case "spin-blur":
      spinBlurGallery(data, width, height, params);
      return;
    case "surface-blur":
      surfaceBlur(data, width, height, params);
      return;
    case "lens-blur":
      lensBlur(data, width, height, params);
      return;
    case "oil-paint":
      oilPaint(data, width, height, params);
      return;
    case "high-pass":
      highPass(data, width, height, params);
      return;
    case "offset":
      offsetFilter(data, width, height, params);
      return;
    case "custom-convolution":
      customConvolution(data, width, height, params);
      return;
    case "lighting-effects":
      lightingEffects(data, width, height, params);
      return;
    default:
      throw new Error("Worker filter not supported: " + filterId);
  }
}

self.onmessage = (event) => {
  const request = event.data;
  try {
    const data = new Uint8ClampedArray(request.buffer);
    if (Array.isArray(request.operations)) {
      const total = request.operations.length;
      for (let i = 0; i < request.operations.length; i++) {
        const operation = request.operations[i];
        applyFilter(operation.filterId, data, operation.params || {}, request.width, request.height);
        self.postMessage({
          id: request.id,
          width: request.width,
          height: request.height,
          progress: { completed: i + 1, total, filterId: operation.filterId },
        });
      }
    } else {
      applyFilter(request.filterId, data, request.params || {}, request.width, request.height);
    }
    self.postMessage({ id: request.id, width: request.width, height: request.height, buffer: data.buffer }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id: request.id, width: request.width, height: request.height, error: err instanceof Error ? err.message : String(err) });
  }
};
`
}

function getWorker(): Worker | null {
  if (_worker) return _worker
  if (_workerFailed || typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") return null

  try {
    const blob = new Blob([workerSource()], { type: "text/javascript" })
    const url = URL.createObjectURL(blob)
    _worker = new Worker(url, { type: "module" })
    URL.revokeObjectURL(url)
    _worker.onmessage = (event: MessageEvent<FilterWorkerResponse>) => {
      const response = event.data
      const pending = _pending.get(response.id)
      if (!pending) return
      if (response.progress) {
        pending.progress?.(response.progress)
        return
      }
      _pending.delete(response.id)
      if (response.error || !response.buffer) {
        pending.reject(new Error(response.error ?? "Filter worker returned no image data"))
        return
      }
      pending.resolve(new ImageData(new Uint8ClampedArray(response.buffer), response.width, response.height))
    }
    _worker.onerror = (event) => {
      _workerFailed = true
      const message = event.message || "Filter worker failed"
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

function runFilterOnMainThread(
  filterId: string,
  src: ImageData,
  params: Record<string, number | string | boolean>,
): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const schedule = typeof requestIdleCallback === "function"
      ? (cb: () => void) => requestIdleCallback(cb, { timeout: 50 })
      : (cb: () => void) => setTimeout(cb, 0)

    schedule(() => {
      try {
        const filter = getFilter(filterId)
        if (!filter) {
          reject(new Error(`Filter not found: ${filterId}`))
          return
        }
        const result = filter.apply(src, params)
        resolve(result)
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  })
}

export interface FilterAsyncOptions {
  fallbackOnWorkerError?: boolean
  workerExecutor?: (
    filterId: string,
    src: ImageData,
    params: Record<string, number | string | boolean>,
  ) => Promise<ImageData>
}

/**
 * Apply a filter asynchronously. Supported per-pixel filters run off-main-thread
 * in a Blob worker; all other filters use a scheduled fallback.
 */
export function applyFilterAsync(
  filterId: string,
  src: ImageData,
  params: Record<string, number | string | boolean>,
  options: FilterAsyncOptions = {},
): Promise<ImageData> {
  if (isFilterWorkerSupported(filterId)) {
    if (options.workerExecutor) {
      return options.workerExecutor(filterId, src, params).catch((err) => {
        _workerFailed = true
        if (options.fallbackOnWorkerError === false) {
          throw err instanceof Error ? err : new Error(String(err))
        }
        return runFilterOnMainThread(filterId, src, params)
      })
    }

    const worker = getWorker()
    if (worker) {
      const id = _nextId++
      const buffer = new ArrayBuffer(src.data.byteLength)
      new Uint8ClampedArray(buffer).set(src.data)
      const request: FilterWorkerRequest = {
        id,
        filterId,
        width: src.width,
        height: src.height,
        buffer,
        params,
      }
      return new Promise<ImageData>((resolve, reject) => {
        _pending.set(id, { resolve, reject })
        worker.postMessage(request, [buffer])
      }).catch((err) => {
        _workerFailed = true
        if (options.fallbackOnWorkerError === false) {
          throw err instanceof Error ? err : new Error(String(err))
        }
        return runFilterOnMainThread(filterId, src, params)
      })
    }
  }

  return runFilterOnMainThread(filterId, src, params)
}

export interface FilterBatchOptions {
  onProgress?: (event: FilterProgressEvent) => void
  fallbackOnWorkerError?: boolean
}

export async function applyFilterBatch(
  src: ImageData,
  operations: FilterBatchOperation[],
  options: FilterBatchOptions = {},
): Promise<ImageData> {
  if (operations.length === 0) {
    return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
  }

  const canUseWorker = operations.every((operation) => isFilterWorkerSupported(operation.filterId))
  const worker = canUseWorker ? getWorker() : null
  if (worker) {
    const id = _nextId++
    const buffer = new ArrayBuffer(src.data.byteLength)
    new Uint8ClampedArray(buffer).set(src.data)
    const request: FilterWorkerRequest = {
      id,
      operations,
      width: src.width,
      height: src.height,
      buffer,
      params: {},
    }
    return new Promise<ImageData>((resolve, reject) => {
      _pending.set(id, { resolve, reject, progress: options.onProgress })
      worker.postMessage(request, [buffer])
    }).catch((err) => {
      _workerFailed = true
      if (options.fallbackOnWorkerError === false) {
        throw err instanceof Error ? err : new Error(String(err))
      }
      return runFilterBatchOnMainThread(src, operations, options.onProgress)
    })
  }

  return runFilterBatchOnMainThread(src, operations, options.onProgress)
}

async function runFilterBatchOnMainThread(
  src: ImageData,
  operations: FilterBatchOperation[],
  onProgress?: (event: FilterProgressEvent) => void,
) {
  let current = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i]
    current = await runFilterOnMainThread(operation.filterId, current, operation.params)
    onProgress?.({ completed: i + 1, total: operations.length, filterId: operation.filterId })
  }
  return current
}

export interface TiledFilterOptions {
  tileSize?: number
  overlap?: number
  useWorker?: boolean
  signal?: AbortSignal
  yieldEveryTiles?: number
  onProgress?: (event: FilterProgressEvent) => void
}

/**
 * Apply a filter in bounded tiles. The caller can choose overlap large enough
 * for neighborhood-based filters and opt into worker-backed tiles when the
 * filter has a worker implementation.
 */
export async function applyFilterTiled(
  filterId: string,
  src: ImageData,
  params: Record<string, number | string | boolean>,
  options: TiledFilterOptions = {},
): Promise<ImageData> {
  const filter = getFilter(filterId)
  if (!filter) throw new Error(`Filter not found: ${filterId}`)
  const plan = planExpensiveFilterTiling(filterId, src.width, src.height, params, { tileSize: options.tileSize })
  const tileSize = Math.max(1, Math.round(options.tileSize ?? plan.tileSize))
  const overlap = Math.max(0, Math.round(options.overlap ?? plan.overlap))
  const yieldEveryTiles = Math.max(1, Math.round(options.yieldEveryTiles ?? plan.yieldEveryTiles))
  const out = new ImageData(src.width, src.height)
  let processedTiles = 0

  for (let tileY = 0; tileY < src.height; tileY += tileSize) {
    if (options.signal?.aborted) throw new DOMException("Filter processing cancelled", "AbortError")
    await Promise.resolve()
    for (let tileX = 0; tileX < src.width; tileX += tileSize) {
      if (options.signal?.aborted) throw new DOMException("Filter processing cancelled", "AbortError")
      const x0 = Math.max(0, tileX - overlap)
      const y0 = Math.max(0, tileY - overlap)
      const x1 = Math.min(src.width, tileX + tileSize + overlap)
      const y1 = Math.min(src.height, tileY + tileSize + overlap)
      const tileW = x1 - x0
      const tileH = y1 - y0
      const tile = new ImageData(tileW, tileH)
      for (let y = 0; y < tileH; y++) {
        const srcStart = ((y0 + y) * src.width + x0) * 4
        const dstStart = y * tileW * 4
        tile.data.set(src.data.slice(srcStart, srcStart + tileW * 4), dstStart)
      }
      const filtered =
        options.useWorker && isFilterWorkerSupported(filterId)
          ? await applyFilterAsync(filterId, tile, params)
          : filter.apply(tile, params)
      const writeW = Math.min(tileSize, src.width - tileX)
      const writeH = Math.min(tileSize, src.height - tileY)
      const readOffsetX = tileX - x0
      const readOffsetY = tileY - y0
      for (let y = 0; y < writeH; y++) {
        const srcStart = ((readOffsetY + y) * tileW + readOffsetX) * 4
        const dstStart = ((tileY + y) * src.width + tileX) * 4
        out.data.set(filtered.data.slice(srcStart, srcStart + writeW * 4), dstStart)
      }
      processedTiles++
      options.onProgress?.({ completed: processedTiles, total: plan.tileCount, filterId })
      if (processedTiles % yieldEveryTiles === 0) await Promise.resolve()
    }
  }

  return out
}

/**
 * Apply a filter on a downsampled version of the image for fast preview,
 * then upscale the result back to original size.
 *
 * @param scaleFactor - downsample factor (e.g. 0.25 for 4x reduction)
 */
export function applyFilterPreview(
  filterId: string,
  src: ImageData,
  params: Record<string, number | string | boolean>,
  scaleFactor = 0.25,
): ImageData {
  const filter = getFilter(filterId)
  if (!filter) return src

  const srcW = src.width
  const srcH = src.height
  const previewW = Math.max(1, Math.round(srcW * scaleFactor))
  const previewH = Math.max(1, Math.round(srcH * scaleFactor))

  const small = new ImageData(previewW, previewH)
  const xRatio = srcW / previewW
  const yRatio = srcH / previewH
  for (let y = 0; y < previewH; y++) {
    const srcY = Math.floor(y * yRatio)
    for (let x = 0; x < previewW; x++) {
      const srcX = Math.floor(x * xRatio)
      const si = (srcY * srcW + srcX) * 4
      const di = (y * previewW + x) * 4
      small.data[di] = src.data[si]
      small.data[di + 1] = src.data[si + 1]
      small.data[di + 2] = src.data[si + 2]
      small.data[di + 3] = src.data[si + 3]
    }
  }

  const filtered = filter.apply(small, params)

  const result = new ImageData(srcW, srcH)
  const fxRatio = previewW / srcW
  const fyRatio = previewH / srcH
  for (let y = 0; y < srcH; y++) {
    const fy = y * fyRatio
    const fy0 = Math.floor(fy)
    const fy1 = Math.min(previewH - 1, fy0 + 1)
    const ty = fy - fy0
    for (let x = 0; x < srcW; x++) {
      const fx = x * fxRatio
      const fx0 = Math.floor(fx)
      const fx1 = Math.min(previewW - 1, fx0 + 1)
      const tx = fx - fx0
      const di = (y * srcW + x) * 4
      for (let c = 0; c < 4; c++) {
        const v00 = filtered.data[(fy0 * previewW + fx0) * 4 + c]
        const v10 = filtered.data[(fy0 * previewW + fx1) * 4 + c]
        const v01 = filtered.data[(fy1 * previewW + fx0) * 4 + c]
        const v11 = filtered.data[(fy1 * previewW + fx1) * 4 + c]
        const top = v00 + (v10 - v00) * tx
        const bot = v01 + (v11 - v01) * tx
        result.data[di + c] = Math.round(top + (bot - top) * ty)
      }
    }
  }

  return result
}

/**
 * Batch pixel reader - reads a region once and provides fast lookups.
 * Avoids repeated single-pixel getImageData calls during brush strokes.
 */
export class PixelBatchReader {
  private data: Uint8ClampedArray | null = null
  private x0 = 0
  private y0 = 0
  private w = 0
  private h = 0
  private canvasW = 0
  private canvasH = 0
  private ctx: CanvasRenderingContext2D | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvasW = canvas.width
    this.canvasH = canvas.height
    this.ctx = canvas.getContext("2d")
  }

  readRegion(x: number, y: number, w: number, h: number) {
    if (!this.ctx) return
    this.x0 = Math.max(0, Math.floor(x))
    this.y0 = Math.max(0, Math.floor(y))
    this.w = Math.min(this.canvasW - this.x0, Math.ceil(w))
    this.h = Math.min(this.canvasH - this.y0, Math.ceil(h))
    if (this.w <= 0 || this.h <= 0) {
      this.data = null
      return
    }
    this.data = this.ctx.getImageData(this.x0, this.y0, this.w, this.h).data
  }

  contains(x: number, y: number): boolean {
    if (!this.data) return false
    const px = Math.floor(x) - this.x0
    const py = Math.floor(y) - this.y0
    return px >= 0 && px < this.w && py >= 0 && py < this.h
  }

  getPixel(x: number, y: number): { r: number; g: number; b: number; a: number } | null {
    if (!this.data) return null
    const px = Math.floor(x) - this.x0
    const py = Math.floor(y) - this.y0
    if (px < 0 || px >= this.w || py < 0 || py >= this.h) return null
    const i = (py * this.w + px) * 4
    return {
      r: this.data[i],
      g: this.data[i + 1],
      b: this.data[i + 2],
      a: this.data[i + 3],
    }
  }

  ensureContains(x: number, y: number, padding: number) {
    if (this.contains(x, y)) return
    const newX = Math.floor(x) - padding
    const newY = Math.floor(y) - padding
    const newW = padding * 2 + 1
    const newH = padding * 2 + 1
    this.readRegion(newX, newY, newW, newH)
  }
}
