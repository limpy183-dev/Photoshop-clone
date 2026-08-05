import { createRafCoalescer } from "@/editor/raf-coalescer"

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

/**
 * How many history entries one auto-repeat tick of a held Ctrl+Z / Ctrl+Y
 * should cover. `repeats` counts the auto-repeat events seen so far for the
 * current hold (0 on the initial keypress). Stays at one step for the first
 * ~third of a second of repeats so a short hold still feels discrete, then
 * ramps up so rolling back a long session doesn't take 60 keypresses.
 */
export function heldStepMagnitude(repeats: number): number {
  return Math.min(8, 1 + Math.floor(Math.max(0, repeats) / 8))
}

/**
 * A real keyboard waits out an initial delay before auto-repeat starts, then
 * ticks at a steady rate. Nothing guarantees the events we receive look like
 * that: a synthetic burst, a stuck key, or an event storm can deliver many
 * `repeat: true` keydowns inside a single tick, and counting them one-for-one
 * turns a brief Ctrl+Z into a rollback of everything the user has done.
 *
 * So held undo/redo is rate limited on the wall clock rather than on the event
 * count, and both gates sit below the *fastest* setting real hardware offers —
 * not merely below the typical one — so a genuine hold still accelerates
 * through {@link heldStepMagnitude} exactly as before:
 *
 *  - Delay: macOS's shortest "Delay Until Repeat" is ~225ms and Windows' is
 *    ~250ms, so 180ms never swallows a real first tick. It is still ~30x the
 *    2-6ms in which a same-tick synthetic burst arrives.
 *  - Interval: the fastest sustained repeat rate is ~30Hz (~33ms/tick), so a
 *    20ms floor never drops a real tick either.
 *
 * Both numbers want to stay inside those bounds; widening one is what
 * `tests/history-jump-scheduler.spec.ts` guards.
 */
export const HELD_REPEAT_DELAY_MS = 180
export const HELD_REPEAT_INTERVAL_MS = 20

export function heldRepeatShouldStep(sincePress: number, sinceLastStep: number): boolean {
  return sincePress >= HELD_REPEAT_DELAY_MS && sinceLastStep >= HELD_REPEAT_INTERVAL_MS
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
