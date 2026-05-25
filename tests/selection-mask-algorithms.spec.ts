import { expect, test } from "@playwright/test"

import {
  buildOfflineObjectAwareSelectionMaskData,
  borderMaskData,
  contractMaskData,
  expandMaskData,
  extractMaskContourPaths,
  featherMaskData,
  selectionMaskToPathCandidates,
  smoothMaskData,
  traceMagneticLassoEdgePathData,
  transformSelectionMaskData,
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
      this.height = height ?? Math.floor(dataOrWidth.length / 4 / widthOrHeight)
    }
  }
}

globalThis.ImageData = TestImageData as unknown as typeof ImageData

function imageData(width: number, height: number, pixels: number[]) {
  return new ImageData(new Uint8ClampedArray(pixels), width, height)
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

test("offline object-aware selection separates subject, sky, background, and boxed objects", () => {
  const scene = imageData(8, 6, Array.from({ length: 8 * 6 }, (_, index) => {
    const x = index % 8
    const y = Math.floor(index / 8)
    if (y <= 1) return [80, 150, 232, 255]
    const core = x >= 3 && x <= 4 && y >= 2 && y <= 4
    const filament = (x === 2 || x === 5) && y === 3
    const lookalike = x === 0 && y === 5
    if (core) return [218, 48, 34, 255]
    if (filament) return [126, 72, 42, 178]
    if (lookalike) return [214, 52, 36, 255]
    return [45, 128, 58, 255]
  }).flat())

  const subject = buildOfflineObjectAwareSelectionMaskData(scene, { kind: "subject", tolerance: 34 })
  expect(subject.bounds).toEqual({ x: 2, y: 2, w: 4, h: 3 })
  expect(subject.maskData[3 * 8 + 2]).toBeGreaterThan(70)
  expect(subject.maskData[5 * 8 + 0]).toBe(0)
  expect(subject.diagnostics.nativeAiParity).toBe(false)
  expect(subject.diagnostics.method).toBe("offline-object-aware")

  const sky = buildOfflineObjectAwareSelectionMaskData(scene, { kind: "sky" })
  expect(sky.bounds).toEqual({ x: 0, y: 0, w: 8, h: 2 })
  expect(sky.maskData[0]).toBe(255)
  expect(sky.maskData[3 * 8 + 3]).toBe(0)

  const background = buildOfflineObjectAwareSelectionMaskData(scene, { kind: "background", tolerance: 34 })
  expect(background.maskData[0]).toBe(255)
  expect(background.maskData[5 * 8 + 7]).toBe(255)
  expect(background.maskData[3 * 8 + 3]).toBe(0)

  const object = buildOfflineObjectAwareSelectionMaskData(scene, {
    kind: "object",
    objectBounds: { x: 1, y: 1, w: 6, h: 4 },
    tolerance: 34,
  })
  expect(object.bounds).toEqual({ x: 2, y: 2, w: 4, h: 3 })
  expect(object.maskData[0]).toBe(0)
})

test("magnetic lasso traces hysteresis-linked weak edge gaps between anchors", () => {
  const pixels: number[] = []
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      const rightSide = x >= 4
      const weakGap = y === 4
      const v = rightSide ? (weakGap ? 126 : 228) : 24
      pixels.push(v, v, v, 255)
    }
  }

  const traced = traceMagneticLassoEdgePathData(imageData(9, 9, pixels), [
    { x: 3.2, y: 1 },
    { x: 3.3, y: 7 },
  ], {
    searchWidth: 3,
    contrastThreshold: 120,
    hysteresisRatio: 0.35,
  })

  expect(traced.points.length).toBeGreaterThan(6)
  expect(traced.diagnostics.weakLinkedPixels).toBeGreaterThan(0)
  expect(traced.points.some((point) => Math.round(point.y) === 4)).toBe(true)
  expect(Math.max(...traced.points.map((point) => Math.abs(point.x - 3)))).toBeLessThanOrEqual(1)
})

test("magnetic lasso can trace sub-8-bit high-bit source contrast", () => {
  const data = new Uint16Array(9 * 5 * 4)
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 9; x++) {
      const i = (y * 9 + x) * 4
      const value = x < 4 ? 32768 : 32848
      data[i] = value
      data[i + 1] = value
      data[i + 2] = value
      data[i + 3] = 65535
    }
  }

  const traced = traceMagneticLassoEdgePathData({
    width: 9,
    height: 5,
    channels: 4,
    maxValue: 65535,
    data,
  }, [
    { x: 3.2, y: 1 },
    { x: 3.2, y: 3 },
  ], {
    searchWidth: 3,
    contrastThreshold: 0.05,
    hysteresisRatio: 0.25,
  })

  expect(traced.diagnostics.strongEdgePixels).toBeGreaterThan(0)
  expect(traced.points.length).toBeGreaterThan(2)
  expect(Math.max(...traced.points.map((point) => Math.abs(point.x - 3)))).toBeLessThanOrEqual(1)
})

test("magnetic lasso smoothing reduces edge jitter while preserving endpoints", () => {
  const pixels: number[] = []
  for (let y = 0; y < 13; y++) {
    for (let x = 0; x < 10; x++) {
      pixels.push(128, 128, 128, 255)
    }
  }
  const anchors = [
    { x: 4.5, y: 1 },
    { x: 6.5, y: 4 },
    { x: 3.5, y: 8 },
    { x: 5.5, y: 11 },
  ]

  const raw = traceMagneticLassoEdgePathData(imageData(10, 13, pixels), anchors, {
    searchWidth: 3,
    contrastThreshold: 80,
    hysteresisRatio: 0.35,
  })
  const smoothed = traceMagneticLassoEdgePathData(imageData(10, 13, pixels), anchors, {
    searchWidth: 3,
    contrastThreshold: 80,
    hysteresisRatio: 0.35,
    smoothing: 0.8,
  })
  const variation = (points: typeof raw.points) =>
    points.slice(1).reduce((sum, point, index) => sum + Math.abs(point.x - points[index].x), 0)

  expect(variation(smoothed.points)).toBeLessThan(variation(raw.points))
  expect(smoothed.points[0]).toEqual(raw.points[0])
  expect(smoothed.points[smoothed.points.length - 1]).toEqual(raw.points[raw.points.length - 1])
})

test("affine mask transform uses document-pixel sampling independent of preview zoom", () => {
  const src = mask(5, 5, [
    [1, 1], [2, 1], [1, 2],
  ])

  const rotated = transformSelectionMaskData(src, 5, 5, { x: 1, y: 1, w: 2, h: 2 }, {
    scale: 1,
    rotationDeg: 90,
  })

  expect(rotated[1 * 5 + 1]).toBe(255)
  expect(rotated[1 * 5 + 2]).toBe(255)
  expect(rotated[2 * 5 + 2]).toBe(255)
  expect(rotated[2 * 5 + 1]).toBe(0)

  const zoomedPreviewEquivalent = transformSelectionMaskData(src, 5, 5, { x: 1, y: 1, w: 2, h: 2 }, {
    scale: 1,
    rotationDeg: 90,
    previewZoom: 3.5,
  })
  expect(Array.from(zoomedPreviewEquivalent)).toEqual(Array.from(rotated))
})
