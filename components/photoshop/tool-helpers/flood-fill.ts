import { hexToRgb } from "../color-utils"

function colorMatch(
  data: Uint8ClampedArray,
  i: number,
  r: number,
  g: number,
  b: number,
  a: number,
  tolerance: number,
) {
  const dr = data[i] - r
  const dg = data[i + 1] - g
  const db = data[i + 2] - b
  const da = data[i + 3] - a
  return Math.sqrt(dr * dr + dg * dg + db * db + da * da) <= tolerance
}

/** Flood-fill from (sx,sy) on `src` ImageData. Returns a new mask ImageData
 *  where filled pixels are alpha=255 and others alpha=0. */
export function floodFillMask(
  src: ImageData,
  sx: number,
  sy: number,
  tolerance: number,
  contiguous: boolean,
): ImageData {
  const w = src.width
  const h = src.height
  const out = new ImageData(w, h)
  const data = src.data
  const x = Math.max(0, Math.min(w - 1, Math.floor(sx)))
  const y = Math.max(0, Math.min(h - 1, Math.floor(sy)))
  const startIdx = (y * w + x) * 4
  const tr = data[startIdx]
  const tg = data[startIdx + 1]
  const tb = data[startIdx + 2]
  const ta = data[startIdx + 3]

  if (!contiguous) {
    for (let i = 0; i < data.length; i += 4) {
      if (colorMatch(data, i, tr, tg, tb, ta, tolerance)) {
        out.data[i + 3] = 255
      }
    }
    return out
  }

  // Scanline flood fill
  const visited = new Uint8Array(w * h)
  const stack: number[] = [x, y]
  while (stack.length) {
    const py = stack.pop()!
    const px = stack.pop()!
    if (py < 0 || py >= h) continue
    // walk left
    let lx = px
    while (lx >= 0) {
      const i = (py * w + lx) * 4
      if (visited[py * w + lx] || !colorMatch(data, i, tr, tg, tb, ta, tolerance)) break
      lx--
    }
    lx++
    // walk right
    let rx = px
    while (rx < w) {
      const i = (py * w + rx) * 4
      if (visited[py * w + rx] || !colorMatch(data, i, tr, tg, tb, ta, tolerance)) break
      rx++
    }
    rx--
    for (let i = lx; i <= rx; i++) {
      visited[py * w + i] = 1
      out.data[(py * w + i) * 4 + 3] = 255
    }
    // push spans above & below
    for (let nx = lx; nx <= rx; nx++) {
      if (py > 0 && !visited[(py - 1) * w + nx]) {
        const ni = ((py - 1) * w + nx) * 4
        if (colorMatch(data, ni, tr, tg, tb, ta, tolerance)) {
          stack.push(nx, py - 1)
        }
      }
      if (py < h - 1 && !visited[(py + 1) * w + nx]) {
        const ni = ((py + 1) * w + nx) * 4
        if (colorMatch(data, ni, tr, tg, tb, ta, tolerance)) {
          stack.push(nx, py + 1)
        }
      }
    }
  }
  return out
}

/** Flood-fill colored region on a layer canvas. */
export function paintBucketFill(
  canvas: HTMLCanvasElement,
  sx: number,
  sy: number,
  hex: string,
  tolerance: number,
  contiguous: boolean,
  withinSelection?: HTMLCanvasElement | null,
) {
  const ctx = canvas.getContext("2d")!
  const src = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const mask = floodFillMask(src, sx, sy, tolerance, contiguous)
  const fillColor = hexToRgb(hex)
  let selData: Uint8ClampedArray | null = null
  if (withinSelection) {
    const sctx = withinSelection.getContext("2d")!
    selData = sctx.getImageData(0, 0, canvas.width, canvas.height).data
  }
  for (let i = 0; i < mask.data.length; i += 4) {
    if (mask.data[i + 3] === 0) continue
    if (selData && selData[i + 3] === 0) continue
    src.data[i] = fillColor.r
    src.data[i + 1] = fillColor.g
    src.data[i + 2] = fillColor.b
    src.data[i + 3] = 255
  }
  ctx.putImageData(src, 0, 0)
}
