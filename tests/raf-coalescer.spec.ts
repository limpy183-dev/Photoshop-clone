import { expect, test } from "@playwright/test"

import { createRafCoalescer } from "../components/photoshop/raf-coalescer"

test("raf coalescer emits only the latest value once per frame", () => {
  const emitted: number[] = []
  const scheduled: FrameRequestCallback[] = []
  const coalescer = createRafCoalescer<number>(
    (value) => emitted.push(value),
    (callback) => {
      scheduled.push(callback)
      return scheduled.length
    },
  )

  coalescer.push(1)
  coalescer.push(2)
  coalescer.push(3)

  expect(emitted).toEqual([])
  expect(scheduled).toHaveLength(1)

  scheduled[0](16)

  expect(emitted).toEqual([3])
})

test("raf coalescer can cancel a pending frame without emitting stale data", () => {
  const emitted: string[] = []
  const cancelled: number[] = []
  const scheduled: FrameRequestCallback[] = []
  const coalescer = createRafCoalescer<string>(
    (value) => emitted.push(value),
    (callback) => {
      scheduled.push(callback)
      return scheduled.length
    },
    (id) => cancelled.push(id),
  )

  coalescer.push("first")
  coalescer.cancel()
  scheduled[0](16)

  expect(cancelled).toEqual([1])
  expect(emitted).toEqual([])
})
