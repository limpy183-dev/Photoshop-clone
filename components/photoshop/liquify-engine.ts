export interface LiquifyMeshPoint {
  x: number
  y: number
  dx: number
  dy: number
}

export interface LiquifyMesh {
  width: number
  height: number
  columns: number
  rows: number
  points: LiquifyMeshPoint[]
}

export function createLiquifyMesh(width: number, height: number, columns = 7, rows = 7): LiquifyMesh {
  const safeColumns = Math.max(2, Math.round(columns))
  const safeRows = Math.max(2, Math.round(rows))
  const points: LiquifyMeshPoint[] = []
  for (let row = 0; row < safeRows; row++) {
    const y = safeRows === 1 ? 0 : (height * row) / (safeRows - 1)
    for (let col = 0; col < safeColumns; col++) {
      const x = safeColumns === 1 ? 0 : (width * col) / (safeColumns - 1)
      points.push({ x, y, dx: 0, dy: 0 })
    }
  }
  return { width, height, columns: safeColumns, rows: safeRows, points }
}

export function moveLiquifyMeshPoint(mesh: LiquifyMesh, column: number, row: number, dx: number, dy: number): LiquifyMesh {
  const safeColumn = Math.max(0, Math.min(mesh.columns - 1, Math.round(column)))
  const safeRow = Math.max(0, Math.min(mesh.rows - 1, Math.round(row)))
  const index = safeRow * mesh.columns + safeColumn
  return {
    ...mesh,
    points: mesh.points.map((point, i) => (i === index ? { ...point, dx, dy } : { ...point })),
  }
}

export function nearestLiquifyMeshPoint(mesh: LiquifyMesh, x: number, y: number, maxDistance = Infinity) {
  let bestIndex = -1
  let bestDistance = maxDistance
  for (let i = 0; i < mesh.points.length; i++) {
    const point = mesh.points[i]
    const distance = Math.hypot(point.x + point.dx - x, point.y + point.dy - y)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = i
    }
  }
  return bestIndex
}

export function moveLiquifyMeshPointByIndex(mesh: LiquifyMesh, index: number, dx: number, dy: number): LiquifyMesh {
  if (index < 0 || index >= mesh.points.length) return mesh
  return {
    ...mesh,
    points: mesh.points.map((point, i) => (i === index ? { ...point, dx, dy } : { ...point })),
  }
}

export function meshDisplacementAt(mesh: LiquifyMesh, x: number, y: number) {
  const cellW = mesh.width / Math.max(1, mesh.columns - 1)
  const cellH = mesh.height / Math.max(1, mesh.rows - 1)
  const gx = cellW <= 0 ? 0 : x / cellW
  const gy = cellH <= 0 ? 0 : y / cellH
  const col = Math.max(0, Math.min(mesh.columns - 2, Math.floor(gx)))
  const row = Math.max(0, Math.min(mesh.rows - 2, Math.floor(gy)))
  const tx = Math.max(0, Math.min(1, gx - col))
  const ty = Math.max(0, Math.min(1, gy - row))
  const p00 = mesh.points[row * mesh.columns + col]
  const p10 = mesh.points[row * mesh.columns + col + 1]
  const p01 = mesh.points[(row + 1) * mesh.columns + col]
  const p11 = mesh.points[(row + 1) * mesh.columns + col + 1]
  const topDx = p00.dx + (p10.dx - p00.dx) * tx
  const bottomDx = p01.dx + (p11.dx - p01.dx) * tx
  const topDy = p00.dy + (p10.dy - p00.dy) * tx
  const bottomDy = p01.dy + (p11.dy - p01.dy) * tx
  return {
    dx: topDx + (bottomDx - topDx) * ty,
    dy: topDy + (bottomDy - topDy) * ty,
  }
}

function bilinearSample(src: ImageData, x: number, y: number): [number, number, number, number] {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = x0 + 1
  const y1 = y0 + 1
  const tx = x - x0
  const ty = y - y0
  const sx0 = Math.max(0, Math.min(src.width - 1, x0))
  const sx1 = Math.max(0, Math.min(src.width - 1, x1))
  const sy0 = Math.max(0, Math.min(src.height - 1, y0))
  const sy1 = Math.max(0, Math.min(src.height - 1, y1))
  const p00 = (sy0 * src.width + sx0) * 4
  const p10 = (sy0 * src.width + sx1) * 4
  const p01 = (sy1 * src.width + sx0) * 4
  const p11 = (sy1 * src.width + sx1) * 4
  const w00 = (1 - tx) * (1 - ty)
  const w10 = tx * (1 - ty)
  const w01 = (1 - tx) * ty
  const w11 = tx * ty
  return [
    src.data[p00] * w00 + src.data[p10] * w10 + src.data[p01] * w01 + src.data[p11] * w11,
    src.data[p00 + 1] * w00 + src.data[p10 + 1] * w10 + src.data[p01 + 1] * w01 + src.data[p11 + 1] * w11,
    src.data[p00 + 2] * w00 + src.data[p10 + 2] * w10 + src.data[p01 + 2] * w01 + src.data[p11 + 2] * w11,
    src.data[p00 + 3] * w00 + src.data[p10 + 3] * w10 + src.data[p01 + 3] * w01 + src.data[p11 + 3] * w11,
  ]
}

export function warpImageDataWithLiquifyMesh(src: ImageData, mesh: LiquifyMesh): ImageData {
  const out = new ImageData(src.width, src.height)
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const displacement = meshDisplacementAt(mesh, x, y)
      const sample = bilinearSample(src, x - displacement.dx, y - displacement.dy)
      const i = (y * src.width + x) * 4
      out.data[i] = sample[0]
      out.data[i + 1] = sample[1]
      out.data[i + 2] = sample[2]
      out.data[i + 3] = sample[3]
    }
  }
  return out
}
