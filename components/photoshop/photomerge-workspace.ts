import type {
  AutoAlignOptions,
  PanoramaAlignmentModel,
  PanoramaProjection,
} from "./photo-workflow-engine"

export type PhotomergeLensModel = "none" | "wide" | "phone"
export type PhotomergeBlendMode = "feather" | "multiband"

export interface PhotomergeWorkspaceSettings {
  alignmentModel: PanoramaAlignmentModel
  projection: PanoramaProjection
  blendImages: boolean
  blendMode: PhotomergeBlendMode
  vignetteRemoval: boolean
  geometricCorrection: boolean
  lensModel: PhotomergeLensModel
  focalLengthPx: number
  contentAwareFillTransparent: boolean
}

export interface PhotomergePreviewSource {
  id: string
  name: string
  width: number
  height: number
}

export interface PhotomergePreviewLayoutItem extends PhotomergePreviewSource {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

export interface PhotomergePreviewLayout {
  width: number
  height: number
  items: PhotomergePreviewLayoutItem[]
  projectionPath: string
}

export interface TransparentFillRegion {
  bounds: { x: number; y: number; w: number; h: number }
  mask: ImageData
  pixelCount: number
}

const LENS_MODELS: Record<Exclude<PhotomergeLensModel, "none">, NonNullable<NonNullable<AutoAlignOptions["cameraModel"]>["lens"]>> = {
  wide: { k1: -0.018, k2: 0.004, p1: 0, p2: 0 },
  phone: { k1: -0.035, k2: 0.01, p1: 0.001, p2: -0.001 },
}

export function buildPhotomergeEngineOptions(
  settings: PhotomergeWorkspaceSettings,
  searchRadius: number,
): AutoAlignOptions {
  const focalLength = settings.focalLengthPx > 0 ? Math.round(settings.focalLengthPx) : undefined
  const lens = settings.geometricCorrection && settings.lensModel !== "none"
    ? LENS_MODELS[settings.lensModel]
    : undefined
  const cameraModel = settings.geometricCorrection && (lens || focalLength)
    ? { focalLengthPx: focalLength, lens }
    : undefined

  return {
    searchRadius,
    maxFeatures: 120,
    alignmentModel: settings.alignmentModel,
    projection: settings.projection,
    projectionFocalLength: focalLength,
    blendMode: settings.blendImages ? settings.blendMode : "feather",
    exposureCompensation: settings.blendImages,
    cameraModel,
  }
}

export function buildPhotomergePreviewLayout(
  sources: readonly PhotomergePreviewSource[],
  options: { width: number; height: number; projection: PanoramaProjection },
): PhotomergePreviewLayout {
  const width = Math.max(1, Math.round(options.width))
  const height = Math.max(1, Math.round(options.height))
  const pad = 18
  const usableWidth = Math.max(1, width - pad * 2)
  const usableHeight = Math.max(1, height - pad * 2)
  const cleanSources = sources.map((source) => ({
    ...source,
    width: Math.max(1, source.width),
    height: Math.max(1, source.height),
  }))

  if (!cleanSources.length) {
    return {
      width,
      height,
      items: [],
      projectionPath: projectionPath(width, height, options.projection),
    }
  }

  const overlap =
    options.projection === "spherical" ? 0.5 :
    options.projection === "cylindrical" ? 0.42 :
    0.34
  const maxSourceHeight = Math.max(...cleanSources.map((source) => source.height), 1)
  let panoramaWidth = cleanSources[0].width
  for (let i = 1; i < cleanSources.length; i++) {
    const previous = cleanSources[i - 1]
    const current = cleanSources[i]
    panoramaWidth += current.width - Math.min(previous.width, current.width) * overlap
  }
  const scale = Math.min(usableWidth / Math.max(1, panoramaWidth), usableHeight / maxSourceHeight, 1)
  const scaledPanoramaWidth = panoramaWidth * scale
  const baselineY = height / 2
  let cursor = (width - scaledPanoramaWidth) / 2

  const items = cleanSources.map((source, index) => {
    const itemWidth = source.width * scale
    const itemHeight = source.height * scale
    const progress = cleanSources.length <= 1 ? 0.5 : index / (cleanSources.length - 1)
    const arc =
      options.projection === "spherical" ? Math.sin((progress - 0.5) * Math.PI) * 16 :
      options.projection === "cylindrical" ? Math.sin((progress - 0.5) * Math.PI) * 9 :
      0
    const rotation =
      options.projection === "spherical" ? (progress - 0.5) * 4 :
      options.projection === "cylindrical" ? (progress - 0.5) * 2 :
      0
    const item: PhotomergePreviewLayoutItem = {
      ...source,
      x: cursor,
      y: baselineY - itemHeight / 2 + arc,
      width: itemWidth,
      height: itemHeight,
      rotation,
    }
    if (index < cleanSources.length - 1) {
      const next = cleanSources[index + 1]
      cursor += itemWidth - Math.min(source.width, next.width) * scale * overlap
    }
    return item
  })

  return {
    width,
    height,
    items,
    projectionPath: projectionPath(width, height, options.projection),
  }
}

export function findTransparentFillRegion(image: ImageData, alphaThreshold = 8): TransparentFillRegion | null {
  const data = new Uint8ClampedArray(image.width * image.height * 4)
  let minX = image.width
  let minY = image.height
  let maxX = -1
  let maxY = -1
  let pixelCount = 0

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4
      if (image.data[i + 3] > alphaThreshold) continue
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = 255
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      pixelCount++
    }
  }

  if (!pixelCount) return null
  return {
    bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    mask: new ImageData(data, image.width, image.height),
    pixelCount,
  }
}

export function removePhotomergeVignette(image: ImageData, strength = 0.32): ImageData {
  const out = new Uint8ClampedArray(image.data)
  const cx = (image.width - 1) / 2
  const cy = (image.height - 1) / 2
  const maxDistance = Math.max(1, Math.hypot(Math.max(cx, image.width - 1 - cx), Math.max(cy, image.height - 1 - cy)))

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4
      const distance = Math.hypot(x - cx, y - cy) / maxDistance
      const gain = 1 + Math.max(0, strength) * distance * distance
      out[i] = clamp8(out[i] * gain)
      out[i + 1] = clamp8(out[i + 1] * gain)
      out[i + 2] = clamp8(out[i + 2] * gain)
    }
  }

  return new ImageData(out, image.width, image.height)
}

function projectionPath(width: number, height: number, projection: PanoramaProjection) {
  const top = Math.round(height * 0.22)
  const mid = Math.round(height * 0.5)
  const bottom = Math.round(height * 0.78)
  if (projection === "planar") return `M 16 ${mid} L ${width - 16} ${mid}`
  const curve = projection === "spherical" ? Math.round(height * 0.18) : Math.round(height * 0.1)
  return `M 16 ${mid} C ${Math.round(width * 0.28)} ${top - curve}, ${Math.round(width * 0.72)} ${bottom + curve}, ${width - 16} ${mid}`
}

function clamp8(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}
