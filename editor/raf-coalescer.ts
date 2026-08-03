export interface RafCoalescer<T> {
  push(value: T): void
  cancel(): void
}

export function createRafCoalescer<T>(
  emit: (value: T) => void,
  requestFrame: (callback: FrameRequestCallback) => number = (callback) => requestAnimationFrame(callback),
  cancelFrame: (id: number) => void = (id) => {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id)
  },
): RafCoalescer<T> {
  let frameId: number | null = null
  let latest: T | undefined
  let hasLatest = false

  const flush: FrameRequestCallback = () => {
    frameId = null
    if (!hasLatest) return
    const value = latest as T
    latest = undefined
    hasLatest = false
    emit(value)
  }

  return {
    push(value) {
      latest = value
      hasLatest = true
      if (frameId === null) frameId = requestFrame(flush)
    },
    cancel() {
      if (frameId !== null) cancelFrame(frameId)
      frameId = null
      latest = undefined
      hasLatest = false
    },
  }
}

export type RafPriority = "high" | "medium" | "low"

export interface RafScheduleOptions {
  priority?: RafPriority
  /** Replaces any pending work with the same key; used for dragging sliders. */
  key?: string
}

export interface RafSchedulerStats {
  scheduled: number
  emitted: number
  skippedLowPriority: number
  lastFrameDurationMs: number
}

export interface RafScheduler<T> {
  schedule(value: T, options?: RafScheduleOptions): void
  cancel(): void
  stats(): RafSchedulerStats
}

export interface RafSchedulerOptions<T> {
  emit: (value: T) => void
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (id: number) => void
  now?: () => number
  frameBudgetMs?: number
}

const PRIORITIES: readonly RafPriority[] = ["high", "medium", "low"]

export function createRafScheduler<T>(options: RafSchedulerOptions<T>): RafScheduler<T> {
  const requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback))
  const cancelFrame =
    options.cancelFrame ??
    ((id) => {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id)
    })
  const now = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()))
  const frameBudgetMs = Math.max(1, options.frameBudgetMs ?? 12)
  const queues: Record<RafPriority, Map<string | symbol, T>> = {
    high: new Map(),
    medium: new Map(),
    low: new Map(),
  }
  let frameId: number | null = null
  let serial = 0
  const stats: RafSchedulerStats = {
    scheduled: 0,
    emitted: 0,
    skippedLowPriority: 0,
    lastFrameDurationMs: 0,
  }

  const hasPending = () => PRIORITIES.some((priority) => queues[priority].size > 0)

  const flush: FrameRequestCallback = () => {
    frameId = null
    const startedAt = now()
    for (const priority of PRIORITIES) {
      const entries = [...queues[priority].entries()]
      queues[priority].clear()
      for (const [, value] of entries) {
        if (priority === "low" && now() - startedAt >= frameBudgetMs) {
          stats.skippedLowPriority += 1
          continue
        }
        options.emit(value)
        stats.emitted += 1
      }
    }
    stats.lastFrameDurationMs = now() - startedAt
    if (hasPending()) frameId = requestFrame(flush)
  }

  return {
    schedule(value, scheduleOptions = {}) {
      const priority = scheduleOptions.priority ?? "medium"
      const key = scheduleOptions.key ?? Symbol(`raf-${serial++}`)
      queues[priority].set(key, value)
      stats.scheduled += 1
      if (frameId === null) frameId = requestFrame(flush)
    },
    cancel() {
      if (frameId !== null) cancelFrame(frameId)
      frameId = null
      for (const priority of PRIORITIES) queues[priority].clear()
    },
    stats() {
      return { ...stats }
    },
  }
}
