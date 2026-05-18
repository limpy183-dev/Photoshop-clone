import { createRafCoalescer } from "./raf-coalescer"

/**
 * Schedules history jumps. Two modes:
 *
 *  - `request(absoluteIndex)` is coalesced through requestAnimationFrame.
 *    Use it for "scrub the history slider" / "drag a thumb" style input
 *    where many target indices arrive in a tight burst and only the
 *    final value matters.
 *
 *  - `requestStep(currentIndex, delta, ...)` applies each step
 *    *immediately* and synchronously. Each call represents one discrete
 *    user intent (a single Ctrl+Z keypress, an Edit ▸ Undo menu click,
 *    a tap of the history-panel previous-step button). Pressing Ctrl+Z
 *    three times in quick succession must undo three separate things,
 *    not coalesce into one larger jump that rolls back three changes
 *    in a single visible frame.
 *
 *  - `cancel()` cancels any pending coalesced jump and forgets the
 *    current pending target.
 */
export interface HistoryJumpScheduler {
  request(index: number): void
  requestStep(currentIndex: number, delta: number, minIndex: number, maxIndex: number): void
  cancel(): void
}

export function createHistoryJumpScheduler(
  jump: (index: number) => void,
  requestFrame?: (callback: FrameRequestCallback) => number,
  cancelFrame?: (id: number) => void,
): HistoryJumpScheduler {
  let pendingIndex: number | null = null
  const clampIndex = (index: number, minIndex: number, maxIndex: number) =>
    Math.max(minIndex, Math.min(maxIndex, index))
  const coalescer = createRafCoalescer(
    (index: number) => {
      pendingIndex = index
      jump(index)
    },
    requestFrame,
    cancelFrame,
  )
  return {
    request(index) {
      pendingIndex = index
      coalescer.push(index)
    },
    requestStep(currentIndex, delta, minIndex, maxIndex) {
      // A pending coalesced `request(...)` is conceptually superseded by
      // a discrete step: the user just told us "go one back/forward",
      // which trumps any in-flight scrubbing target. Cancel it so the
      // rAF flush won't later overwrite the state we're about to apply.
      coalescer.cancel()
      const base = pendingIndex ?? currentIndex
      const next = clampIndex(base + delta, minIndex, maxIndex)
      // No-op when already at the edge (e.g. Ctrl+Z at index 0).
      if (next === base) return
      pendingIndex = next
      // Apply synchronously so each Ctrl+Z press produces exactly one
      // undo. Coalescing here would let three rapid keypresses arrive
      // within a single ~16 ms animation frame and collapse into a
      // single -3 jump, surprising the user with multi-step undo.
      jump(next)
    },
    cancel() {
      pendingIndex = null
      coalescer.cancel()
    },
  }
}
