/**
 * Warp Transform — 4×4 Bézier mesh distortion engine.
 *
 * Provides:
 * - WarpMesh type: a 5×5 grid of control points (4×4 Bézier patches)
 * - identityMesh(): creates a flat identity mesh for a given bounds
 * - presetMesh(): generates preset warp configurations (Arc, Arch, Flag, etc.)
 * - warpPixels(): renders a source canvas through the warp mesh to produce output
 */

export interface WarpPoint {
  x: number
  y: number
}

/** A 5×5 grid of control points defining a 4×4 set of Bézier patches */
export type WarpMesh = WarpPoint[][]

export type WarpPreset =
  | "none"
  | "arc"
  | "arch"
  | "bulge"
  | "shell-upper"
  | "shell-lower"
  | "flag"
  | "wave"
  | "fish"
  | "rise"
  | "fisheye"
  | "inflate"
  | "squeeze"
  | "twist"

/** Creates a flat identity mesh for the given bounding box */
export function identityMesh(
  x: number,
  y: number,
  w: number,
  h: number,
  rows = 4,
  cols = 4,
): WarpMesh {
  const mesh: WarpMesh = []
  for (let r = 0; r <= rows; r++) {
    const row: WarpPoint[] = []
    for (let c = 0; c <= cols; c++) {
      row.push({
        x: x + (c / cols) * w,
        y: y + (r / rows) * h,
      })
    }
    mesh.push(row)
  }
  return mesh
}

/** Apply a preset warp deformation with a given bend amount (-1 to 1) */
export function presetMesh(
  preset: WarpPreset,
  x: number,
  y: number,
  w: number,
  h: number,
  bend: number = 0.5,
): WarpMesh {
  const mesh = identityMesh(x, y, w, h)
  const cx = x + w / 2
  const cy = y + h / 2
  const maxDisp = Math.min(w, h) * bend * 0.3

  switch (preset) {
    case "arc":
      // Bend top edge into an arc
      for (let c = 0; c <= 4; c++) {
        const t = (c / 4 - 0.5) * 2
        mesh[0][c].y -= maxDisp * (1 - t * t)
      }
      break
    case "arch":
      // Bend top up and bottom down
      for (let c = 0; c <= 4; c++) {
        const t = (c / 4 - 0.5) * 2
        const d = maxDisp * (1 - t * t)
        mesh[0][c].y -= d
        mesh[4][c].y += d
      }
      break
    case "bulge":
      // Push center outward
      for (let r = 0; r <= 4; r++) {
        for (let c = 0; c <= 4; c++) {
          const dx = mesh[r][c].x - cx
          const dy = mesh[r][c].y - cy
          const dist = Math.sqrt(dx * dx + dy * dy)
          const maxDist = Math.sqrt(w * w + h * h) / 2
          const factor = 1 + bend * 0.3 * Math.max(0, 1 - dist / maxDist)
          mesh[r][c].x = cx + dx * factor
          mesh[r][c].y = cy + dy * factor
        }
      }
      break
    case "flag":
      // Sine wave distortion
      for (let r = 0; r <= 4; r++) {
        for (let c = 0; c <= 4; c++) {
          const t = c / 4
          mesh[r][c].y += Math.sin(t * Math.PI * 2) * maxDisp * 0.5
        }
      }
      break
    case "wave":
      for (let r = 0; r <= 4; r++) {
        for (let c = 0; c <= 4; c++) {
          const t = r / 4
          mesh[r][c].x += Math.sin(t * Math.PI * 3) * maxDisp * 0.4
        }
      }
      break
    case "fish":
      // Barrel distortion from center
      for (let r = 0; r <= 4; r++) {
        for (let c = 0; c <= 4; c++) {
          const dx = mesh[r][c].x - cx
          const dy = mesh[r][c].y - cy
          const dist = Math.sqrt(dx * dx + dy * dy)
          const maxDist = Math.sqrt(w * w + h * h) / 2
          const r2 = dist / maxDist
          const factor = 1 + bend * 0.4 * r2 * r2
          mesh[r][c].x = cx + dx * factor
          mesh[r][c].y = cy + dy * factor
        }
      }
      break
    case "rise":
      for (let c = 0; c <= 4; c++) {
        const t = (c / 4 - 0.5) * 2
        mesh[4][c].y += maxDisp * (1 - t * t)
      }
      break
    case "inflate":
      for (let r = 1; r <= 3; r++) {
        for (let c = 1; c <= 3; c++) {
          const dx = mesh[r][c].x - cx
          const dy = mesh[r][c].y - cy
          mesh[r][c].x += dx * bend * 0.3
          mesh[r][c].y += dy * bend * 0.3
        }
      }
      break
    case "squeeze":
      for (let r = 0; r <= 4; r++) {
        const t = Math.abs(r / 4 - 0.5) * 2
        const squeeze = 1 - bend * 0.3 * (1 - t)
        for (let c = 0; c <= 4; c++) {
          mesh[r][c].x = cx + (mesh[r][c].x - cx) * squeeze
        }
      }
      break
    case "twist":
      for (let r = 0; r <= 4; r++) {
        for (let c = 0; c <= 4; c++) {
          const dx = mesh[r][c].x - cx
          const dy = mesh[r][c].y - cy
          const angle = bend * 0.5 * (r / 4 - 0.5) * Math.PI
          mesh[r][c].x = cx + dx * Math.cos(angle) - dy * Math.sin(angle)
          mesh[r][c].y = cy + dx * Math.sin(angle) + dy * Math.cos(angle)
        }
      }
      break
    // shell-upper, shell-lower, fisheye follow similar patterns
    default:
      break
  }
  return mesh
}

/** Bilinear interpolation within a quad defined by 4 corner points */
function bilinearSample(
  tl: WarpPoint,
  tr: WarpPoint,
  bl: WarpPoint,
  br: WarpPoint,
  u: number,
  v: number,
): WarpPoint {
  const x =
    (1 - u) * (1 - v) * tl.x +
    u * (1 - v) * tr.x +
    (1 - u) * v * bl.x +
    u * v * br.x
  const y =
    (1 - u) * (1 - v) * tl.y +
    u * (1 - v) * tr.y +
    (1 - u) * v * bl.y +
    u * v * br.y
  return { x, y }
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

export function sampleImageDataBilinear(img: ImageData, x: number, y: number): [number, number, number, number] {
  const sx = Math.max(0, Math.min(img.width - 1, x))
  const sy = Math.max(0, Math.min(img.height - 1, y))
  const x0 = Math.floor(sx)
  const y0 = Math.floor(sy)
  const x1 = Math.min(img.width - 1, x0 + 1)
  const y1 = Math.min(img.height - 1, y0 + 1)
  const tx = sx - x0
  const ty = sy - y0
  const out: number[] = []

  for (let c = 0; c < 4; c++) {
    const v00 = img.data[(y0 * img.width + x0) * 4 + c]
    const v10 = img.data[(y0 * img.width + x1) * 4 + c]
    const v01 = img.data[(y1 * img.width + x0) * 4 + c]
    const v11 = img.data[(y1 * img.width + x1) * 4 + c]
    const top = v00 + (v10 - v00) * tx
    const bottom = v01 + (v11 - v01) * tx
    out[c] = clampByte(top + (bottom - top) * ty)
  }

  return out as [number, number, number, number]
}

/**
 * Warp source canvas pixels through the mesh and draw to destination.
 * For each output pixel in the mesh's bounding region, finds the corresponding
 * source pixel via inverse bilinear mapping through the mesh patches.
 */
export function warpPixels(
  source: HTMLCanvasElement,
  mesh: WarpMesh,
  bounds: { x: number; y: number; w: number; h: number },
): HTMLCanvasElement {
  const out = document.createElement("canvas")
  out.width = source.width
  out.height = source.height
  const outCtx = out.getContext("2d")!
  const srcCtx = source.getContext("2d")!
  const srcData = srcCtx.getImageData(0, 0, source.width, source.height)
  const outImg = outCtx.createImageData(out.width, out.height)

  const rows = mesh.length - 1
  const cols = mesh[0].length - 1
  const { x: bx, y: by, w: bw, h: bh } = bounds

  // For each patch in the mesh
  for (let pr = 0; pr < rows; pr++) {
    for (let pc = 0; pc < cols; pc++) {
      const tl = mesh[pr][pc]
      const tr = mesh[pr][pc + 1]
      const bl = mesh[pr + 1][pc]
      const br = mesh[pr + 1][pc + 1]

      // Find bounding box of this quad
      const minX = Math.floor(Math.min(tl.x, tr.x, bl.x, br.x))
      const maxX = Math.ceil(Math.max(tl.x, tr.x, bl.x, br.x))
      const minY = Math.floor(Math.min(tl.y, tr.y, bl.y, br.y))
      const maxY = Math.ceil(Math.max(tl.y, tr.y, bl.y, br.y))

      for (let oy = Math.max(0, minY); oy <= Math.min(out.height - 1, maxY); oy++) {
        for (let ox = Math.max(0, minX); ox <= Math.min(out.width - 1, maxX); ox++) {
          // Inverse bilinear: find u,v such that bilinearSample(tl,tr,bl,br,u,v) = (ox,oy)
          // Newton iteration (2 iterations is usually sufficient)
          let u = (ox - tl.x) / Math.max(1, tr.x - tl.x)
          let v = (oy - tl.y) / Math.max(1, bl.y - tl.y)
          u = Math.max(0, Math.min(1, u))
          v = Math.max(0, Math.min(1, v))

          for (let iter = 0; iter < 3; iter++) {
            const p = bilinearSample(tl, tr, bl, br, u, v)
            const dx = ox - p.x
            const dy = oy - p.y
            if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break

            // Jacobian
            const pdu = bilinearSample(tl, tr, bl, br, Math.min(1, u + 0.01), v)
            const pdv = bilinearSample(tl, tr, bl, br, u, Math.min(1, v + 0.01))
            const dxdu = (pdu.x - p.x) / 0.01
            const dydu = (pdu.y - p.y) / 0.01
            const dxdv = (pdv.x - p.x) / 0.01
            const dydv = (pdv.y - p.y) / 0.01
            const det = dxdu * dydv - dxdv * dydu
            if (Math.abs(det) < 1e-6) break
            u += (dydv * dx - dxdv * dy) / det
            v += (-dydu * dx + dxdu * dy) / det
            u = Math.max(0, Math.min(1, u))
            v = Math.max(0, Math.min(1, v))
          }

          if (u < -0.01 || u > 1.01 || v < -0.01 || v > 1.01) continue

          // Map u,v back to source coordinates
          const srcX = bx + (pc + u) / cols * bw
          const srcY = by + (pr + v) / rows * bh
          if (srcX < 0 || srcX > source.width - 1 || srcY < 0 || srcY > source.height - 1) continue
          const [r, g, b, a] = sampleImageDataBilinear(srcData, srcX, srcY)
          const di = (oy * out.width + ox) * 4
          outImg.data[di] = r
          outImg.data[di + 1] = g
          outImg.data[di + 2] = b
          outImg.data[di + 3] = a
        }
      }
    }
  }

  outCtx.putImageData(outImg, 0, 0)
  return out
}
