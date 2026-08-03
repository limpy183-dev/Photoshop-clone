export function workerSource() {
  return `
const clamp8 = (value) => Math.max(0, Math.min(255, value));
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
function hashNoise(x, y, salt) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453;
  return n - Math.floor(n);
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
  const sigmaS = Math.max(0.75, r * 0.645);
  const sigmaR = Math.max(1, t * 0.55375);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const baseLum = lumaByte(src[i], src[i + 1], src[i + 2]);
      let rs = 0, gs = 0, bs = 0, as_ = 0, weightSum = 0;
      for (let oy = -r; oy <= r; oy++) {
        const sy = Math.max(0, Math.min(height - 1, y + oy));
        for (let ox = -r; ox <= r; ox++) {
          if (ox * ox + oy * oy > r * r) continue;
          const sx = Math.max(0, Math.min(width - 1, x + ox));
          const p = (sy * width + sx) * 4;
          const diff = Math.abs(lumaByte(src[p], src[p + 1], src[p + 2]) - baseLum);
          if (diff >= t) continue;
          const spatial = Math.exp(-(ox * ox + oy * oy) / (2 * sigmaS * sigmaS));
          const range = Math.exp(-(diff * diff) / (2 * sigmaR * sigmaR));
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
  const noiseAmt = num(params.noiseAmount, 0);
  if (noiseAmt > 0) {
    const amp = noiseAmt * 2.55;
    const noiseMono = bool(params.noiseMono, true);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (noiseMono) {
          const n = (hashNoise(x, y, 211) - 0.5) * amp;
          out[i] = clamp8(out[i] + n);
          out[i + 1] = clamp8(out[i + 1] + n);
          out[i + 2] = clamp8(out[i + 2] + n);
        } else {
          out[i] = clamp8(out[i] + (hashNoise(x, y, 211) - 0.5) * amp);
          out[i + 1] = clamp8(out[i + 1] + (hashNoise(x, y, 307) - 0.5) * amp);
          out[i + 2] = clamp8(out[i + 2] + (hashNoise(x, y, 401) - 0.5) * amp);
        }
      }
    }
  }
  data.set(out);
}

function oilPaint(data, width, height, params) {
  const radius = Math.max(1, Math.min(8, Math.round(num(params.radius, 4))));
  const levels = Math.max(4, Math.min(32, Math.round(num(params.levels, 16))));
  const shine = Math.max(0, Math.min(100, num(params.shine, 18))) / 100;
  const src = new Uint8ClampedArray(data);
  const out = new Uint8ClampedArray(data.length);
  const hist = new Uint16Array(levels);
  const rs = new Uint32Array(levels);
  const gs = new Uint32Array(levels);
  const bs = new Uint32Array(levels);
  const as_ = new Uint32Array(levels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      hist.fill(0); rs.fill(0); gs.fill(0); bs.fill(0); as_.fill(0);
      for (let oy = -radius; oy <= radius; oy++) {
        const sy = Math.max(0, Math.min(height - 1, y + oy));
        for (let ox = -radius; ox <= radius; ox++) {
          if (ox * ox + oy * oy > radius * radius) continue;
          const sx = Math.max(0, Math.min(width - 1, x + ox));
          const p = (sy * width + sx) * 4;
          const lum = lumaByte(src[p], src[p + 1], src[p + 2]);
          const bin = Math.max(0, Math.min(levels - 1, Math.floor((lum / 256) * levels)));
          hist[bin]++;
          rs[bin] += src[p];
          gs[bin] += src[p + 1];
          bs[bin] += src[p + 2];
          as_[bin] += src[p + 3];
        }
      }
      let best = 0;
      for (let i = 1; i < levels; i++) if (hist[i] > hist[best]) best = i;
      const o = (y * width + x) * 4;
      const count = Math.max(1, hist[best]);
      const below = (Math.min(height - 1, y + 1) * width + x) * 4;
      const above = (Math.max(0, y - 1) * width + x) * 4;
      const edge = Math.abs(lumaByte(src[below], src[below + 1], src[below + 2]) - lumaByte(src[above], src[above + 1], src[above + 2]));
      out[o] = clamp8(rs[best] / count + edge * shine);
      out[o + 1] = clamp8(gs[best] / count + edge * shine);
      out[o + 2] = clamp8(bs[best] / count + edge * shine);
      out[o + 3] = clamp8(as_[best] / count);
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
    case "custom-filter":
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
      self.postMessage({
        id: request.id,
        width: request.width,
        height: request.height,
        progress: { completed: 1, total: 1, filterId: request.filterId },
      });
    }
    self.postMessage({ id: request.id, width: request.width, height: request.height, buffer: data.buffer }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id: request.id, width: request.width, height: request.height, error: err instanceof Error ? err.message : String(err) });
  }
};
`
}
