import { expect, test } from "@playwright/test"

import { createHistoryJumpScheduler } from "../components/photoshop/history-jump-scheduler"

test("history jump scheduler coalesces rapid undo redo requests to the latest target", () => {
  const jumps: number[] = []
  const scheduled: FrameRequestCallback[] = []
  const scheduler = createHistoryJumpScheduler(
    (index) => jumps.push(index),
    (callback) => {
      scheduled.push(callback)
      return scheduled.length
    },
  )

  scheduler.request(4)
  scheduler.request(3)
  scheduler.request(2)

  expect(jumps).toEqual([])
  expect(scheduled).toHaveLength(1)

  scheduled[0](16)

  expect(jumps).toEqual([2])
})

test("history jump scheduler accumulates repeated adjacent steps before the frame flushes", () => {
  const jumps: number[] = []
  const scheduled: FrameRequestCallback[] = []
  const scheduler = createHistoryJumpScheduler(
    (index) => jumps.push(index),
    (callback) => {
      scheduled.push(callback)
      return scheduled.length
    },
  )

  scheduler.requestStep(10, -1, 0, 20)
  scheduler.requestStep(10, -1, 0, 20)
  scheduler.requestStep(10, -1, 0, 20)

  expect(jumps).toEqual([])
  expect(scheduled).toHaveLength(1)

  scheduled[0](16)

  expect(jumps).toEqual([7])
})

test("history jump scheduler keeps accumulating against the flushed target until state catches up", () => {
  const jumps: number[] = []
  const scheduled: FrameRequestCallback[] = []
  const scheduler = createHistoryJumpScheduler(
    (index) => jumps.push(index),
    (callback) => {
      scheduled.push(callback)
      return scheduled.length
    },
  )

  scheduler.requestStep(10, -1, 0, 20)
  scheduled[0](16)
  scheduler.requestStep(10, -1, 0, 20)
  scheduled[1](32)

  expect(jumps).toEqual([9, 8])
})
