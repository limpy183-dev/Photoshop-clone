/**
 * Memory budget enforcement.
 *
 * Tracks named allocations (history snapshots, composite caches, tile
 * cache, scratch buffers) against soft and hard caps. When the soft cap
 * is breached, subscribers receive a `pressure` event so they can drop
 * caches. When the hard cap is breached, `allocate` returns `false` so
 * callers can refuse new allocations and spill to OPFS or downscale.
 *
 * The planner functions are pure so they can be unit tested without a
 * browser. The tracker itself avoids `performance.memory` (Chrome-only,
 * unreliable) and instead requires callers to declare allocation sizes.
 */

const DEFAULT_BUDGET_MB = 1024
const DEFAULT_SOFT_RATIO = 0.75
const DEFAULT_HARD_RATIO = 0.95
const MIB = 1024 * 1024

export type MemoryCategory =
  | "history"
  | "composite-cache"
  | "tile-cache"
  | "filter-buffer"
  | "scratch"
  | "thumbnail"
  | "selection"
  | "other"

export interface MemoryAllocation {
  id: string
  category: MemoryCategory
  bytes: number
  priority?: number
  createdAt: number
}

export interface MemoryBudgetSnapshot {
  totalBytes: number
  softLimitBytes: number
  hardLimitBytes: number
  usedBytes: number
  byCategory: Record<MemoryCategory, number>
  underSoft: boolean
  underHard: boolean
  availableBytes: number
}

export interface MemoryBudgetOptions {
  budgetMB?: number
  softRatio?: number
  hardRatio?: number
}

export interface AllocationRequest {
  id: string
  category: MemoryCategory
  bytes: number
  priority?: number
}

export interface AllocationDecision {
  granted: boolean
  reason: "ok" | "soft-pressure" | "hard-limit"
  evictionRequested: boolean
  recommendedEvictBytes: number
}

export interface MemoryBudgetPlanInput {
  budgetMB: number
  currentBytes: number
  pendingBytes: number
  softRatio?: number
  hardRatio?: number
}

export type MemoryBudgetAction =
  | "disable-composite-cache"
  | "use-tiled-backing-store"
  | "compress-history"
  | "spill-scratch-to-opfs"
  | "reject-allocation"

export interface DocumentMemoryBudgetInput {
  width: number
  height: number
  layerCount?: number
  historyStates?: number
  memoryBudgetMB?: number
  bytesPerPixel?: number
}

export interface DocumentMemoryBudgetPlan {
  status: "within-budget" | "over-budget"
  estimatedWorkingSetBytes: number
  memoryBudgetBytes: number
  actions: MemoryBudgetAction[]
  warnings: string[]
}

export interface MemoryBudgetPlan {
  decision: "grant" | "request-eviction" | "deny"
  reason: "within-soft" | "soft-pressure" | "hard-limit-exceeded"
  budgetBytes: number
  softLimitBytes: number
  hardLimitBytes: number
  projectedBytes: number
  recommendedEvictBytes: number
}

function positiveInt(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || value === undefined) return fallback
  return Math.max(0, Math.round(value))
}

function clampRatio(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || value === undefined) return fallback
  return Math.max(0.05, Math.min(0.99, value))
}

export function planMemoryBudget(input: MemoryBudgetPlanInput): MemoryBudgetPlan
export function planMemoryBudget(input: DocumentMemoryBudgetInput): DocumentMemoryBudgetPlan
export function planMemoryBudget(input: MemoryBudgetPlanInput | DocumentMemoryBudgetInput): MemoryBudgetPlan | DocumentMemoryBudgetPlan {
  if ("width" in input) {
    const width = positiveInt(input.width, 1)
    const height = positiveInt(input.height, 1)
    const layerCount = positiveInt(input.layerCount, 1)
    const historyStates = positiveInt(input.historyStates, 1)
    const bytesPerPixel = positiveInt(input.bytesPerPixel, 4)
    const memoryBudgetBytes = positiveInt(input.memoryBudgetMB, DEFAULT_BUDGET_MB) * MIB
    const layerBytes = width * height * bytesPerPixel * layerCount
    const historyBytes = width * height * bytesPerPixel * Math.min(historyStates, 24) * 0.28
    const filterAndTileBytes = width * height * bytesPerPixel * (width * height >= 16_000_000 ? 2 : 0.5)
    const estimatedWorkingSetBytes = Math.round(layerBytes + historyBytes + filterAndTileBytes)
    const actions: MemoryBudgetAction[] = []
    const warnings: string[] = []

    if (estimatedWorkingSetBytes > memoryBudgetBytes * DEFAULT_SOFT_RATIO) {
      actions.push("disable-composite-cache")
      warnings.push("Estimated working set exceeds the soft memory budget.")
    }
    if (width * height >= 16_000_000 || layerBytes > memoryBudgetBytes * 0.5) {
      actions.push("use-tiled-backing-store")
    }
    if (historyStates > 12 || historyBytes > memoryBudgetBytes * 0.25) {
      actions.push("compress-history")
    }
    if (estimatedWorkingSetBytes > memoryBudgetBytes || width * height >= 24_000_000) {
      actions.push("spill-scratch-to-opfs")
    }
    if (estimatedWorkingSetBytes > memoryBudgetBytes * 2.5) {
      warnings.push("Large allocations should be rejected unless the operation can run tile-by-tile.")
    }

    return {
      status: actions.length ? "over-budget" : "within-budget",
      estimatedWorkingSetBytes,
      memoryBudgetBytes,
      actions,
      warnings,
    }
  }

  const budgetMB = positiveInt(input.budgetMB, DEFAULT_BUDGET_MB)
  const budgetBytes = budgetMB * MIB
  const softRatio = clampRatio(input.softRatio, DEFAULT_SOFT_RATIO)
  const hardRatio = clampRatio(input.hardRatio, DEFAULT_HARD_RATIO)
  const softLimitBytes = Math.floor(budgetBytes * softRatio)
  const hardLimitBytes = Math.floor(budgetBytes * Math.max(softRatio, hardRatio))
  const projectedBytes = positiveInt(input.currentBytes, 0) + positiveInt(input.pendingBytes, 0)

  if (projectedBytes > hardLimitBytes) {
    return {
      decision: "deny",
      reason: "hard-limit-exceeded",
      budgetBytes,
      softLimitBytes,
      hardLimitBytes,
      projectedBytes,
      recommendedEvictBytes: projectedBytes - softLimitBytes,
    }
  }

  if (projectedBytes > softLimitBytes) {
    return {
      decision: "request-eviction",
      reason: "soft-pressure",
      budgetBytes,
      softLimitBytes,
      hardLimitBytes,
      projectedBytes,
      recommendedEvictBytes: projectedBytes - softLimitBytes,
    }
  }

  return {
    decision: "grant",
    reason: "within-soft",
    budgetBytes,
    softLimitBytes,
    hardLimitBytes,
    projectedBytes,
    recommendedEvictBytes: 0,
  }
}

const CATEGORY_KEYS: readonly MemoryCategory[] = [
  "history",
  "composite-cache",
  "tile-cache",
  "filter-buffer",
  "scratch",
  "thumbnail",
  "selection",
  "other",
]

function emptyByCategory(): Record<MemoryCategory, number> {
  const result = {} as Record<MemoryCategory, number>
  for (const key of CATEGORY_KEYS) result[key] = 0
  return result
}

export type MemoryPressureLevel = "ok" | "soft" | "hard"

export interface MemoryPressureEvent {
  level: MemoryPressureLevel
  snapshot: MemoryBudgetSnapshot
  evictBytes: number
}

export type MemoryPressureListener = (event: MemoryPressureEvent) => void

export class MemoryBudgetTracker {
  private allocations = new Map<string, MemoryAllocation>()
  private byCategory = emptyByCategory()
  private listeners = new Set<MemoryPressureListener>()
  private lastPressure: MemoryPressureLevel = "ok"
  private budgetMB: number
  private softRatio: number
  private hardRatio: number

  constructor(options: MemoryBudgetOptions = {}) {
    this.budgetMB = positiveInt(options.budgetMB, DEFAULT_BUDGET_MB)
    this.softRatio = clampRatio(options.softRatio, DEFAULT_SOFT_RATIO)
    this.hardRatio = clampRatio(options.hardRatio, DEFAULT_HARD_RATIO)
  }

  setBudget(options: MemoryBudgetOptions) {
    if (options.budgetMB !== undefined) this.budgetMB = positiveInt(options.budgetMB, this.budgetMB)
    if (options.softRatio !== undefined) this.softRatio = clampRatio(options.softRatio, this.softRatio)
    if (options.hardRatio !== undefined) this.hardRatio = clampRatio(options.hardRatio, this.hardRatio)
    this.notifyIfChanged()
  }

  get usedBytes(): number {
    let total = 0
    for (const allocation of this.allocations.values()) total += allocation.bytes
    return total
  }

  get totalBytes(): number {
    return this.budgetMB * MIB
  }

  snapshot(): MemoryBudgetSnapshot {
    const totalBytes = this.budgetMB * MIB
    const softLimitBytes = Math.floor(totalBytes * this.softRatio)
    const hardLimitBytes = Math.floor(totalBytes * Math.max(this.softRatio, this.hardRatio))
    const usedBytes = this.usedBytes
    return {
      totalBytes,
      softLimitBytes,
      hardLimitBytes,
      usedBytes,
      byCategory: { ...this.byCategory },
      underSoft: usedBytes <= softLimitBytes,
      underHard: usedBytes <= hardLimitBytes,
      availableBytes: Math.max(0, softLimitBytes - usedBytes),
    }
  }

  /**
   * Ask the tracker whether the requested allocation fits the budget.
   * Does not actually allocate; callers should call {@link commit} on success.
   */
  request(request: AllocationRequest): AllocationDecision {
    const plan = planMemoryBudget({
      budgetMB: this.budgetMB,
      currentBytes: this.usedBytes,
      pendingBytes: positiveInt(request.bytes, 0),
      softRatio: this.softRatio,
      hardRatio: this.hardRatio,
    })

    if (plan.decision === "deny") {
      return {
        granted: false,
        reason: "hard-limit",
        evictionRequested: true,
        recommendedEvictBytes: plan.recommendedEvictBytes,
      }
    }

    if (plan.decision === "request-eviction") {
      return {
        granted: true,
        reason: "soft-pressure",
        evictionRequested: true,
        recommendedEvictBytes: plan.recommendedEvictBytes,
      }
    }

    return { granted: true, reason: "ok", evictionRequested: false, recommendedEvictBytes: 0 }
  }

  /**
   * Record an allocation. If `id` already exists, its size is replaced.
   * Returns whether the allocation kept the tracker under the hard cap;
   * callers can still choose to commit on `false` (e.g. scratch flushes).
   */
  commit(allocation: AllocationRequest): boolean {
    const existing = this.allocations.get(allocation.id)
    if (existing) {
      this.byCategory[existing.category] -= existing.bytes
    }
    const next: MemoryAllocation = {
      id: allocation.id,
      category: allocation.category,
      bytes: positiveInt(allocation.bytes, 0),
      priority: allocation.priority,
      createdAt: Date.now(),
    }
    this.allocations.set(next.id, next)
    this.byCategory[next.category] = (this.byCategory[next.category] ?? 0) + next.bytes
    this.notifyIfChanged()
    const snapshot = this.snapshot()
    return snapshot.underHard
  }

  release(id: string): boolean {
    const existing = this.allocations.get(id)
    if (!existing) return false
    this.byCategory[existing.category] -= existing.bytes
    this.allocations.delete(id)
    this.notifyIfChanged()
    return true
  }

  /**
   * Pick least-recently-created, lowest-priority allocations to evict
   * until `targetBytes` have been freed. Returns the IDs in eviction
   * order; callers must call {@link release} once they've actually freed
   * the underlying memory.
   */
  pickForEviction(targetBytes: number, options: { categories?: MemoryCategory[] } = {}): MemoryAllocation[] {
    const target = positiveInt(targetBytes, 0)
    if (target <= 0) return []
    const filter = options.categories ? new Set(options.categories) : null
    const candidates = [...this.allocations.values()]
      .filter((alloc) => !filter || filter.has(alloc.category))
      .sort((a, b) => {
        const priorityDiff = (a.priority ?? 0) - (b.priority ?? 0)
        if (priorityDiff !== 0) return priorityDiff
        return a.createdAt - b.createdAt
      })

    let freed = 0
    const picked: MemoryAllocation[] = []
    for (const candidate of candidates) {
      if (freed >= target) break
      picked.push(candidate)
      freed += candidate.bytes
    }
    return picked
  }

  subscribe(listener: MemoryPressureListener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  pressureLevel(): MemoryPressureLevel {
    const snapshot = this.snapshot()
    if (!snapshot.underHard) return "hard"
    if (!snapshot.underSoft) return "soft"
    return "ok"
  }

  private notifyIfChanged() {
    const level = this.pressureLevel()
    if (level === this.lastPressure) return
    this.lastPressure = level
    const snapshot = this.snapshot()
    const evictBytes = level === "ok" ? 0 : Math.max(0, snapshot.usedBytes - snapshot.softLimitBytes)
    const event: MemoryPressureEvent = { level, snapshot, evictBytes }
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // listeners may throw; do not kill the tracker
      }
    }
  }
}

let _globalTracker: MemoryBudgetTracker | null = null

export function getGlobalMemoryBudget(): MemoryBudgetTracker {
  if (!_globalTracker) _globalTracker = new MemoryBudgetTracker()
  return _globalTracker
}

export function _resetGlobalMemoryBudgetForTests(options?: MemoryBudgetOptions) {
  _globalTracker = new MemoryBudgetTracker(options)
}

/**
 * Estimate bytes for an RGBA pixel buffer. Centralized so callers don't
 * scatter `width * height * 4` everywhere — keeps the budget math
 * consistent if we ever support 16-bit or 32-bit pixels per channel.
 */
export function estimateImageBytes(width: number, height: number, bytesPerPixel = 4) {
  const w = positiveInt(width, 0)
  const h = positiveInt(height, 0)
  const bpp = positiveInt(bytesPerPixel, 4)
  return w * h * bpp
}
