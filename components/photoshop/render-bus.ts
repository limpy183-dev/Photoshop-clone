export type RenderLayerIds = readonly string[] | "all"

export interface RenderChange {
  layerIds?: RenderLayerIds
  reason?: string
  reasons?: readonly string[]
}

export interface MergedRenderChange {
  layerIds: "all" | string[]
  reasons: string[]
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

  if (!hasFirst && !hasSecond) {
    return { layerIds: "all", reasons }
  }

  if (isFullRender(first ?? undefined) || isFullRender(second ?? undefined)) {
    return { layerIds: "all", reasons }
  }

  const ids = new Set<string>()
  if (hasFirst) {
    for (const id of first!.layerIds as readonly string[]) ids.add(id)
  }
  if (hasSecond) {
    for (const id of second!.layerIds as readonly string[]) ids.add(id)
  }
  return { layerIds: [...ids], reasons }
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
      const pending = this.pending ?? { layerIds: "all" as const, reasons: [] }
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
