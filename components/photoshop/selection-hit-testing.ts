import type { Selection } from "./types"

export interface SelectionHitTester {
  contains(point: { x: number; y: number }): boolean
}

function insideCanvas(width: number, height: number, point: { x: number; y: number }) {
  return point.x >= 0 && point.y >= 0 && point.x < width && point.y < height
}

function insideRect(bounds: NonNullable<Selection["bounds"]>, point: { x: number; y: number }) {
  return point.x >= bounds.x && point.x < bounds.x + bounds.w && point.y >= bounds.y && point.y < bounds.y + bounds.h
}

function insideEllipse(bounds: NonNullable<Selection["bounds"]>, point: { x: number; y: number }) {
  const rx = bounds.w / 2
  const ry = bounds.h / 2
  if (rx <= 0 || ry <= 0) return false
  const cx = bounds.x + rx
  const cy = bounds.y + ry
  return ((point.x - cx) ** 2) / (rx ** 2) + ((point.y - cy) ** 2) / (ry ** 2) <= 1
}

export function containsSelectionPoint(
  width: number,
  height: number,
  selection: Selection,
  point: { x: number; y: number },
) {
  if (!selection.bounds) return true
  if (!insideCanvas(width, height, point)) return false

  if (selection.mask) {
    const ctx = selection.mask.getContext("2d")
    if (!ctx) return false
    const x = Math.floor(point.x)
    const y = Math.floor(point.y)
    if (x < 0 || y < 0 || x >= selection.mask.width || y >= selection.mask.height) return false
    return ctx.getImageData(x, y, 1, 1).data[3] > 8
  }

  if (selection.shape === "ellipse") return insideEllipse(selection.bounds, point)
  return insideRect(selection.bounds, point)
}

export function createSelectionHitTester(width: number, height: number, selection: Selection): SelectionHitTester {
  if (!selection.bounds) return { contains: () => true }

  if (selection.mask) {
    const ctx = selection.mask.getContext("2d")
    if (ctx) {
      const maskWidth = Math.min(width, selection.mask.width)
      const maskHeight = Math.min(height, selection.mask.height)
      const mask = ctx.getImageData(0, 0, maskWidth, maskHeight)
      return {
        contains: (point) => {
          if (!insideCanvas(width, height, point)) return false
          const x = Math.floor(point.x)
          const y = Math.floor(point.y)
          if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false
          return mask.data[(y * mask.width + x) * 4 + 3] > 8
        },
      }
    }
  }

  if (selection.shape === "ellipse") {
    return {
      contains: (point) => insideCanvas(width, height, point) && insideEllipse(selection.bounds!, point),
    }
  }

  return {
    contains: (point) => insideCanvas(width, height, point) && insideRect(selection.bounds!, point),
  }
}
