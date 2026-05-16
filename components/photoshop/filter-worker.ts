/**
 * Async filter execution helpers.
 *
 * Lightweight per-pixel filters run in a Blob worker with transferable pixel
 * buffers. Filters that depend on the larger registry still use a scheduled
 * main-thread fallback so the call path stays asynchronous without overstating
 * worker coverage.
 */

import { getFilter } from "./filters"
import { planTileGrid } from "./performance-engine"

interface FilterWorkerRequest {
  id: number
  filterId: string
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
}

let _worker: Worker | null = null
let _workerFailed = false
let _nextId = 0
const _pending = new Map<number, {
  resolve: (data: ImageData) => void
  reject: (err: Error) => void
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
    default:
      throw new Error("Worker filter not supported: " + filterId);
  }
}

self.onmessage = (event) => {
  const request = event.data;
  try {
    const data = new Uint8ClampedArray(request.buffer);
    applyFilter(request.filterId, data, request.params || {}, request.width, request.height);
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

export interface TiledFilterOptions {
  tileSize?: number
  overlap?: number
  useWorker?: boolean
  signal?: AbortSignal
  yieldEveryTiles?: number
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
