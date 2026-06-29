const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const clamp8 = (value: number) => clamp(Math.round(value), 0, 255)

function makeImageData(width: number, height: number, data?: Uint8ClampedArray) {
  return new ImageData(data ?? new Uint8ClampedArray(width * height * 4), width, height)
}

function pixelIndex(img: ImageData, x: number, y: number) {
  return (y * img.width + x) * 4
}

function lumaFromData(data: Uint8ClampedArray, i: number) {
  return data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722
}

function lumaAt(img: ImageData, x: number, y: number) {
  const sx = clamp(Math.round(x), 0, img.width - 1)
  const sy = clamp(Math.round(y), 0, img.height - 1)
  return lumaFromData(img.data, pixelIndex(img, sx, sy))
}
export interface PerspectiveCropResult {
  image: ImageData
  transform: {
    corners: [Point, Point, Point, Point]
    outputWidth: number
    outputHeight: number
  }
}

export interface Point {
  x: number
  y: number
}

function projectiveCoefficients(tl: Point, tr: Point, br: Point, bl: Point) {
  const dx1 = tr.x - br.x
  const dy1 = tr.y - br.y
  const dx2 = bl.x - br.x
  const dy2 = bl.y - br.y
  const dx3 = tl.x - tr.x + br.x - bl.x
  const dy3 = tl.y - tr.y + br.y - bl.y
  const det = dx1 * dy2 - dx2 * dy1
  const g = Math.abs(det) < 1e-9 ? 0 : (dx3 * dy2 - dx2 * dy3) / det
  const h = Math.abs(det) < 1e-9 ? 0 : (dx1 * dy3 - dx3 * dy1) / det
  return {
    a: tr.x - tl.x + g * tr.x,
    b: bl.x - tl.x + h * bl.x,
    c: tl.x,
    d: tr.y - tl.y + g * tr.y,
    e: bl.y - tl.y + h * bl.y,
    f: tl.y,
    g,
    h,
  }
}

export function sampleImageDataBilinear(source: ImageData, x: number, y: number) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = x - x0
  const ty = y - y0
  const sx0 = clamp(x0, 0, source.width - 1)
  const sy0 = clamp(y0, 0, source.height - 1)
  const sx1 = clamp(x0 + 1, 0, source.width - 1)
  const sy1 = clamp(y0 + 1, 0, source.height - 1)
  const i00 = pixelIndex(source, sx0, sy0)
  const i10 = pixelIndex(source, sx1, sy0)
  const i01 = pixelIndex(source, sx0, sy1)
  const i11 = pixelIndex(source, sx1, sy1)
  const out = [0, 0, 0, 0]
  for (let c = 0; c < 4; c++) {
    out[c] =
      source.data[i00 + c] * (1 - tx) * (1 - ty) +
      source.data[i10 + c] * tx * (1 - ty) +
      source.data[i01 + c] * (1 - tx) * ty +
      source.data[i11 + c] * tx * ty
  }
  return out
}

export function perspectiveCropImageData(source: ImageData, corners: [Point, Point, Point, Point] | Point[]): PerspectiveCropResult {
  if (corners.length < 4) throw new Error("Perspective crop requires four corners")
  const ordered = corners.slice(0, 4) as [Point, Point, Point, Point]
  const [tl, tr, br, bl] = ordered
  const topW = Math.hypot(tr.x - tl.x, tr.y - tl.y)
  const bottomW = Math.hypot(br.x - bl.x, br.y - bl.y)
  const leftH = Math.hypot(bl.x - tl.x, bl.y - tl.y)
  const rightH = Math.hypot(br.x - tr.x, br.y - tr.y)
  const outputWidth = Math.max(1, Math.round(Math.max(topW, bottomW)))
  const outputHeight = Math.max(1, Math.round(Math.max(leftH, rightH)))
  const coeff = projectiveCoefficients(tl, tr, br, bl)
  const out = new Uint8ClampedArray(outputWidth * outputHeight * 4)

  for (let y = 0; y < outputHeight; y++) {
    const v = outputHeight === 1 ? 0 : y / (outputHeight - 1)
    for (let x = 0; x < outputWidth; x++) {
      const u = outputWidth === 1 ? 0 : x / (outputWidth - 1)
      const denom = coeff.g * u + coeff.h * v + 1
      const sx = (coeff.a * u + coeff.b * v + coeff.c) / denom
      const sy = (coeff.d * u + coeff.e * v + coeff.f) / denom
      const sample = sampleImageDataBilinear(source, sx, sy)
      const oi = (y * outputWidth + x) * 4
      out[oi] = clamp8(sample[0])
      out[oi + 1] = clamp8(sample[1])
      out[oi + 2] = clamp8(sample[2])
      out[oi + 3] = clamp8(sample[3])
    }
  }

  return {
    image: makeImageData(outputWidth, outputHeight, out),
    transform: {
      corners: ordered.map((point) => ({ x: point.x, y: point.y })) as [Point, Point, Point, Point],
      outputWidth,
      outputHeight,
    },
  }
}

export interface SeamCarveOptions {
  protectMask?: Uint8Array
  removeMask?: Uint8Array
}

export interface SeamCarveResult {
  image: ImageData
  removedVerticalSeams: Int32Array[]
  removedHorizontalSeams: Int32Array[]
}

function seamEnergy(image: ImageData, protectMask?: Uint8Array, removeMask?: Uint8Array) {
  const out = new Float64Array(image.width * image.height)
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const p = y * image.width + x
      const gradient = Math.abs(lumaAt(image, x + 1, y) - lumaAt(image, x - 1, y)) + Math.abs(lumaAt(image, x, y + 1) - lumaAt(image, x, y - 1))
      const alpha = image.data[p * 4 + 3] / 255
      const protect = ((protectMask?.[p] ?? 0) / 255) * 1000000
      const remove = ((removeMask?.[p] ?? 0) / 255) * 1000000
      out[p] = gradient * (0.35 + alpha) + protect - remove
    }
  }
  return out
}

function removeVerticalSeamFromImageData(image: ImageData, protectMask?: Uint8Array, removeMask?: Uint8Array) {
  const width = image.width
  const height = image.height
  const energy = seamEnergy(image, protectMask, removeMask)
  const cost = new Float64Array(width * height)
  const back = new Int8Array(width * height)
  for (let x = 0; x < width; x++) cost[x] = energy[x]
  for (let y = 1; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let bestX = x
      let best = cost[(y - 1) * width + x]
      if (x > 0 && cost[(y - 1) * width + x - 1] < best) {
        best = cost[(y - 1) * width + x - 1]
        bestX = x - 1
      }
      if (x < width - 1 && cost[(y - 1) * width + x + 1] < best) {
        best = cost[(y - 1) * width + x + 1]
        bestX = x + 1
      }
      cost[y * width + x] = energy[y * width + x] + best
      back[y * width + x] = bestX - x
    }
  }
  let seamX = 0
  let best = Number.POSITIVE_INFINITY
  for (let x = 0; x < width; x++) {
    const value = cost[(height - 1) * width + x]
    if (value < best) {
      best = value
      seamX = x
    }
  }
  const seam = new Int32Array(height)
  for (let y = height - 1; y >= 0; y--) {
    seam[y] = seamX
    seamX += back[y * width + seamX]
  }

  const outWidth = Math.max(1, width - 1)
  const out = new Uint8ClampedArray(outWidth * height * 4)
  const nextProtect = protectMask ? new Uint8Array(outWidth * height) : undefined
  const nextRemove = removeMask ? new Uint8Array(outWidth * height) : undefined
  for (let y = 0; y < height; y++) {
    let ox = 0
    for (let x = 0; x < width; x++) {
      if (x === seam[y]) continue
      const sp = y * width + x
      const op = y * outWidth + ox
      const si = sp * 4
      const oi = op * 4
      out[oi] = image.data[si]
      out[oi + 1] = image.data[si + 1]
      out[oi + 2] = image.data[si + 2]
      out[oi + 3] = image.data[si + 3]
      if (nextProtect && protectMask) nextProtect[op] = protectMask[sp]
      if (nextRemove && removeMask) nextRemove[op] = removeMask[sp]
      ox++
    }
  }

  return { image: makeImageData(outWidth, height, out), seam, protectMask: nextProtect, removeMask: nextRemove }
}

function transposeImage(image: ImageData) {
  const out = new Uint8ClampedArray(image.data.length)
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const si = (y * image.width + x) * 4
      const oi = (x * image.height + y) * 4
      out[oi] = image.data[si]
      out[oi + 1] = image.data[si + 1]
      out[oi + 2] = image.data[si + 2]
      out[oi + 3] = image.data[si + 3]
    }
  }
  return makeImageData(image.height, image.width, out)
}

function transposeMask(mask: Uint8Array | undefined, width: number, height: number) {
  if (!mask) return undefined
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[x * height + y] = mask[y * width + x]
  }
  return out
}

function resizeImageData(source: ImageData, targetWidth: number, targetHeight: number) {
  const out = new Uint8ClampedArray(targetWidth * targetHeight * 4)
  for (let y = 0; y < targetHeight; y++) {
    const sy = targetHeight === 1 ? 0 : (y / (targetHeight - 1)) * (source.height - 1)
    for (let x = 0; x < targetWidth; x++) {
      const sx = targetWidth === 1 ? 0 : (x / (targetWidth - 1)) * (source.width - 1)
      const sample = sampleImageDataBilinear(source, sx, sy)
      const oi = (y * targetWidth + x) * 4
      out[oi] = clamp8(sample[0])
      out[oi + 1] = clamp8(sample[1])
      out[oi + 2] = clamp8(sample[2])
      out[oi + 3] = clamp8(sample[3])
    }
  }
  return makeImageData(targetWidth, targetHeight, out)
}

export function seamCarveImageData(source: ImageData, targetWidth: number, targetHeight: number, options: SeamCarveOptions = {}): SeamCarveResult {
  const targetW = Math.max(1, Math.round(targetWidth))
  const targetH = Math.max(1, Math.round(targetHeight))
  let work = makeImageData(source.width, source.height, new Uint8ClampedArray(source.data))
  let protectMask = options.protectMask ? new Uint8Array(options.protectMask) : undefined
  let removeMask = options.removeMask ? new Uint8Array(options.removeMask) : undefined
  const removedVerticalSeams: Int32Array[] = []
  const removedHorizontalSeams: Int32Array[] = []

  while (work.width > targetW) {
    const result = removeVerticalSeamFromImageData(work, protectMask, removeMask)
    work = result.image
    protectMask = result.protectMask
    removeMask = result.removeMask
    removedVerticalSeams.push(result.seam)
  }

  if (work.height > targetH) {
    work = transposeImage(work)
    protectMask = transposeMask(protectMask, source.width - removedVerticalSeams.length, source.height)
    removeMask = transposeMask(removeMask, source.width - removedVerticalSeams.length, source.height)
    while (work.width > targetH) {
      const result = removeVerticalSeamFromImageData(work, protectMask, removeMask)
      work = result.image
      protectMask = result.protectMask
      removeMask = result.removeMask
      removedHorizontalSeams.push(result.seam)
    }
    work = transposeImage(work)
  }

  if (work.width !== targetW || work.height !== targetH) {
    work = resizeImageData(work, targetW, targetH)
  }

  return { image: work, removedVerticalSeams, removedHorizontalSeams }
}
