import type { BlendMode } from "./types"

export interface SmartFilterPreviewEntryLike {
  id: string
  filterId: string
  params: Record<string, number | string | boolean>
  visible?: boolean
  enabled?: boolean
  opacity?: number
  blendMode?: BlendMode
  mask?: HTMLCanvasElement | null
  maskEnabled?: boolean
  maskDensity?: number
  maskFeather?: number
}

function stableParamKey(params: Record<string, number | string | boolean>) {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}:${String(params[key])}`)
    .join(",")
}

function canvasKey(canvas: HTMLCanvasElement | null | undefined) {
  if (!canvas) return ""
  return `${canvas.width}x${canvas.height}`
}

export function smartFilterPreviewEntryKey(entry: SmartFilterPreviewEntryLike): string {
  const enabled = entry.visible ?? entry.enabled ?? true
  return [
    entry.id,
    entry.filterId,
    enabled ? "1" : "0",
    Math.max(0, Math.min(1, Number(entry.opacity ?? 1) || 0)).toFixed(4),
    entry.blendMode ?? "normal",
    entry.maskEnabled === false ? "0" : "1",
    Math.max(0, Math.min(1, Number(entry.maskDensity ?? 1) || 0)).toFixed(4),
    Math.max(0, Number(entry.maskFeather ?? 0) || 0).toFixed(2),
    canvasKey(entry.mask),
    stableParamKey(entry.params),
  ].join("|")
}

export function smartFilterPreviewStackKeys(entries: SmartFilterPreviewEntryLike[]): string[] {
  return entries.map(smartFilterPreviewEntryKey)
}

export function firstDirtySmartFilterPreviewIndex(previousKeys: string[], nextKeys: string[]) {
  const max = Math.max(previousKeys.length, nextKeys.length)
  for (let i = 0; i < max; i++) {
    if (previousKeys[i] !== nextKeys[i]) return i
  }
  return -1
}
