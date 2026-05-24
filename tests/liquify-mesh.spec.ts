import { expect, test } from "@playwright/test"

import {
  createLiquifyMesh,
  moveLiquifyMeshPoint,
  warpImageDataWithLiquifyMesh,
} from "../components/photoshop/liquify-engine"

class TestImageData {
  data: Uint8ClampedArray
  width: number
  height: number

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth
      this.height = widthOrHeight
      this.data = new Uint8ClampedArray(this.width * this.height * 4)
    } else {
      this.data = dataOrWidth
      this.width = widthOrHeight
      this.data = dataOrWidth
      this.height = height ?? Math.floor(dataOrWidth.length / 4 / widthOrHeight)
    }
  }
}

globalThis.ImageData = TestImageData as unknown as typeof ImageData

function imageData(width: number, height: number, pixels: number[]) {
  return new ImageData(new Uint8ClampedArray(pixels), width, height)
}

test("liquify mesh exposes editable control points", () => {
  const mesh = createLiquifyMesh(100, 80, 4, 3)

  expect(mesh.columns).toBe(4)
  expect(mesh.rows).toBe(3)
  expect(mesh.points).toHaveLength(12)
  expect(mesh.points[0]).toEqual({ x: 0, y: 0, dx: 0, dy: 0 })
  expect(mesh.points[11]).toEqual({ x: 100, y: 80, dx: 0, dy: 0 })

  const moved = moveLiquifyMeshPoint(mesh, 1, 1, 12, -8)
  const center = moved.points[1 + 1 * moved.columns]
  expect(center).toEqual({ x: 100 / 3, y: 40, dx: 12, dy: -8 })
  expect(mesh.points[5].dx).toBe(0)
})

test("liquify mesh warp pulls pixels through the displaced mesh", () => {
  const src = imageData(3, 3, [
    10, 0, 0, 255, 40, 0, 0, 255, 70, 0, 0, 255,
    100, 0, 0, 255, 130, 0, 0, 255, 160, 0, 0, 255,
    190, 0, 0, 255, 220, 0, 0, 255, 250, 0, 0, 255,
  ])
  const mesh = moveLiquifyMeshPoint(createLiquifyMesh(3, 3, 3, 3), 1, 1, 1, 0)

  const warped = warpImageDataWithLiquifyMesh(src, mesh)

  expect(Array.from(warped.data.slice(12, 16))).not.toEqual([130, 0, 0, 255])
  expect(warped.width).toBe(3)
  expect(warped.height).toBe(3)
})
