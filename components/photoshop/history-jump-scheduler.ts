import { createRafCoalescer } from "./raf-coalescer"

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
      const base = pendingIndex ?? currentIndex
      const next = clampIndex(base + delta, minIndex, maxIndex)
      pendingIndex = next
      coalescer.push(next)
    },
    cancel() {
      pendingIndex = null
      coalescer.cancel()
    },
  }
}
