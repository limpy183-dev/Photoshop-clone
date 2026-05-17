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
