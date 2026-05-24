import { expect, test } from "@playwright/test"

import {
  borderMaskData,
  contractMaskData,
  expandMaskData,
  extractMaskContourPaths,
  featherMaskData,
  selectionMaskToPathCandidates,
  smoothMaskData,
} from "../components/photoshop/selection-algorithms"

function mask(width: number, height: number, selected: Array<[number, number]>) {
  const data = new Uint8ClampedArray(width * height)
  for (const [x, y] of selected) data[y * width + x] = 255
  return data
}

function alphaRows(data: Uint8ClampedArray, width: number) {
  const rows: number[][] = []
  for (let i = 0; i < data.length; i += width) rows.push(Array.from(data.slice(i, i + width)))
  return rows
}

test("expand and contract use Euclidean distance around pixel masks", () => {
  const src = mask(5, 5, [[2, 2]])

  expect(alphaRows(expandMaskData(src, 5, 5, 1), 5)).toEqual([
    [0, 0, 0, 0, 0],
    [0, 0, 255, 0, 0],
    [0, 255, 255, 255, 0],
    [0, 0, 255, 0, 0],
    [0, 0, 0, 0, 0],
  ])

  const block = mask(5, 5, [
    [1, 1], [2, 1], [3, 1],
    [1, 2], [2, 2], [3, 2],
    [1, 3], [2, 3], [3, 3],
  ])
  expect(alphaRows(contractMaskData(block, 5, 5, 1), 5)).toEqual([
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 255, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ])
})

test("border creates a centered ring around the original edge", () => {
  const block = mask(5, 5, [
    [1, 1], [2, 1], [3, 1],
    [1, 2], [2, 2], [3, 2],
    [1, 3], [2, 3], [3, 3],
  ])

  expect(alphaRows(borderMaskData(block, 5, 5, 1), 5)).toEqual([
    [0, 0, 0, 0, 0],
    [0, 255, 255, 255, 0],
    [0, 255, 0, 255, 0],
    [0, 255, 255, 255, 0],
    [0, 0, 0, 0, 0],
  ])
})

test("feather produces a signed-distance soft edge without using canvas filters", () => {
  const src = mask(5, 1, [[2, 0]])
  const feathered = Array.from(featherMaskData(src, 5, 1, 2))

  expect(feathered[2]).toBeGreaterThan(feathered[1])
  expect(feathered[1]).toBeGreaterThan(feathered[0])
  expect(feathered).toEqual(feathered.slice().reverse())
})

test("smooth removes isolated stair-step noise while keeping the main body", () => {
  const noisy = mask(5, 5, [
    [1, 1], [2, 1], [3, 1],
    [1, 2], [2, 2], [3, 2],
    [1, 3], [2, 3], [3, 3],
    [4, 0],
  ])

  const smoothed = smoothMaskData(noisy, 5, 5, 1)

  expect(smoothed[0 * 5 + 4]).toBe(0)
  expect(smoothed[2 * 5 + 2]).toBe(255)
})

test("marching ants extraction returns closed contour paths on pixel edges", () => {
  const src = mask(5, 4, [
    [1, 1], [2, 1], [3, 1],
    [1, 2], [2, 2], [3, 2],
  ])

  const paths = extractMaskContourPaths(src, 5, 4, { simplifyTolerance: 0 })

  expect(paths).toHaveLength(1)
  expect(paths[0].closed).toBe(true)
  expect(paths[0].points).toEqual([
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 4, y: 1 },
    { x: 4, y: 2 },
    { x: 4, y: 3 },
    { x: 3, y: 3 },
    { x: 2, y: 3 },
    { x: 1, y: 3 },
    { x: 1, y: 2 },
    { x: 1, y: 1 },
  ])
})

test("selection-to-path approximation simplifies contour candidates", () => {
  const src = mask(6, 6, [
    [1, 1], [2, 1], [3, 1], [4, 1],
    [1, 2], [4, 2],
    [1, 3], [4, 3],
    [1, 4], [2, 4], [3, 4], [4, 4],
  ])

  const candidates = selectionMaskToPathCandidates(src, 6, 6, { simplifyTolerance: 0.75 })

  expect(candidates).toHaveLength(2)
  expect(candidates[0].closed).toBe(true)
  expect(candidates[0].points.length).toBeLessThan(12)
  expect(candidates[0].points[0]).toEqual(candidates[0].points[candidates[0].points.length - 1])
})
