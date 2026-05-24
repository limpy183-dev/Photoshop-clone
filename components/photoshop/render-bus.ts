import {
  addDirtyRect,
  emptyDirtyRect,
  isEmptyDirtyRect,
  unionDirtyRects,
  type DirtyRect,
} from "./dirty-rect"

export type RenderLayerIds = readonly string[] | "all"

export interface RenderChange {
  layerIds?: RenderLayerIds
  reason?: string
  reasons?: readonly string[]
  /** Optional dirty bounds for the change. When omitted, callers signal a
   *  full-frame invalidation. When provided, the bus merges bounds across
   *  same-frame changes so listeners can scissor their redraws. */
  dirtyRects?: readonly DirtyRect[]
  /** Per-layer dirty rects in document space. */
  dirtyByLayer?: Readonly<Record<string, readonly DirtyRect[]>>
}

export interface MergedRenderChange {
  layerIds: "all" | string[]
  reasons: string[]
  dirtyRects: DirtyRect[]
  dirtyByLayer: Record<string, DirtyRect[]>
  fullFrame: boolean
}

type RequestFrame = (callback: FrameRequestCallback) => number
type CancelFrame = (id: number) => void

function normalizeReasons(change?: RenderChange | MergedRenderChange) {
  const reasons: string[] = []
  if (!change) return reasons
  if ("reason" in change && change.reason) reasons.push(change.reason)
  if (change.reasons) {
    for (const reason of change.reasons) {
      if (reason && !reasons.includes(reason)) reasons.push(reason)
    }
  }
  return reasons
}

function isFullRender(change?: RenderChange | MergedRenderChange) {
  return !!change && (!change.layerIds || change.layerIds === "all")
}

function readRects(change?: RenderChange | MergedRenderChange): DirtyRect[] {
  if (!change) return []
  const rects = (change as RenderChange | MergedRenderChange).dirtyRects
  return rects ? [...rects] : []
}

function readPerLayer(change?: RenderChange | MergedRenderChange): Record<string, DirtyRect[]> {
  if (!change) return {}
  const source =
    (change as MergedRenderChange).dirtyByLayer ?? (change as RenderChange).dirtyByLayer ?? {}
  const result: Record<string, DirtyRect[]> = {}
  for (const [id, rects] of Object.entries(source)) {
    result[id] = rects ? [...rects] : []
  }
  return result
}

export function mergeRenderChanges(
  first?: RenderChange | MergedRenderChange | null,
  second?: RenderChange | MergedRenderChange | null,
): MergedRenderChange {
  const reasons = [...normalizeReasons(first ?? undefined)]
  for (const reason of normalizeReasons(second ?? undefined)) {
    if (!reasons.includes(reason)) reasons.push(reason)
  }

  const hasFirst = !!first
  const hasSecond = !!second

  const fullFrame =
    (!hasFirst && !hasSecond) ||
    isFullRender(first ?? undefined) ||
    isFullRender(second ?? undefined)

  // Merge dirty rects (global)
  const mergedRects: DirtyRect[] = []
  for (const rect of readRects(first ?? undefined)) addDirtyRect(mergedRects, rect)
  for (const rect of readRects(second ?? undefined)) addDirtyRect(mergedRects, rect)

  // Merge per-layer rects
  const perLayer: Record<string, DirtyRect[]> = {}
  for (const [id, rects] of Object.entries(readPerLayer(first ?? undefined))) {
    perLayer[id] = []
    for (const rect of rects) addDirtyRect(perLayer[id], rect)
  }
  for (const [id, rects] of Object.entries(readPerLayer(second ?? undefined))) {
    if (!perLayer[id]) perLayer[id] = []
    for (const rect of rects) addDirtyRect(perLayer[id], rect)
  }

  if (fullFrame) {
    return {
      layerIds: "all",
      reasons,
      dirtyRects: mergedRects,
      dirtyByLayer: perLayer,
      fullFrame: true,
    }
  }

  const ids = new Set<string>()
  if (hasFirst) {
    for (const id of first!.layerIds as readonly string[]) ids.add(id)
  }
  if (hasSecond) {
    for (const id of second!.layerIds as readonly string[]) ids.add(id)
  }
  return {
    layerIds: [...ids],
    reasons,
    dirtyRects: mergedRects,
    dirtyByLayer: perLayer,
    fullFrame: false,
  }
}

export function getMergedUnion(change: MergedRenderChange): DirtyRect {
  if (change.dirtyRects.length) return unionDirtyRects(change.dirtyRects)
  const collected: DirtyRect[] = []
  for (const rects of Object.values(change.dirtyByLayer)) {
    for (const rect of rects) addDirtyRect(collected, rect)
  }
  return collected.length ? unionDirtyRects(collected) : emptyDirtyRect()
}

export function hasPartialBounds(change: MergedRenderChange): boolean {
  if (change.fullFrame) return false
  if (change.dirtyRects.length) return change.dirtyRects.some((rect) => !isEmptyDirtyRect(rect))
  for (const rects of Object.values(change.dirtyByLayer)) {
    if (rects.some((rect) => !isEmptyDirtyRect(rect))) return true
  }
  return false
}

export class RenderBus {
  private readonly listeners = new Set<(change: MergedRenderChange) => void>()
  private rafId: number | null = null
  private pending: MergedRenderChange | null = null

  constructor(
    private readonly requestFrame: RequestFrame = (callback) => requestAnimationFrame(callback),
    private readonly cancelFrame: CancelFrame = (id) => cancelAnimationFrame(id),
  ) {}

  subscribe(cb: (change: MergedRenderChange) => void) {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  requestRender(change?: RenderChange) {
    this.pending = this.pending
      ? mergeRenderChanges(this.pending, change ?? { layerIds: "all" })
      : mergeRenderChanges(change ?? { layerIds: "all" }, null)
    if (this.rafId !== null) return
    this.rafId = this.requestFrame(() => {
      this.rafId = null
      const pending = this.pending ?? {
        layerIds: "all" as const,
        reasons: [],
        dirtyRects: [],
        dirtyByLayer: {},
        fullFrame: true,
      }
      this.pending = null
      this.listeners.forEach((cb) => cb(pending))
    })
  }

  cancel() {
    if (this.rafId !== null) {
      this.cancelFrame(this.rafId)
      this.rafId = null
    }
    this.pending = null
  }
}

export function createRenderBus(requestFrame?: RequestFrame, cancelFrame?: CancelFrame) {
  return new RenderBus(requestFrame, cancelFrame)
}
