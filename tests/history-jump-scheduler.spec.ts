import { expect, test } from "@playwright/test"

import {
  createHistoryJumpScheduler,
  heldRepeatShouldStep,
  heldStepMagnitude,
  HELD_REPEAT_DELAY_MS,
  HELD_REPEAT_INTERVAL_MS,
} from "@/editor/history-jump-scheduler"

test("held undo/redo starts at one step and accelerates to a capped rate", () => {
  expect(heldStepMagnitude(0)).toBe(1)
  expect(heldStepMagnitude(7)).toBe(1)
  expect(heldStepMagnitude(8)).toBe(2)
  expect(heldStepMagnitude(24)).toBe(4)
  expect(heldStepMagnitude(1000)).toBe(8)
  // Monotonic — a longer hold never undoes fewer entries per tick.
  let previous = 0
  for (let repeats = 0; repeats < 200; repeats++) {
    const steps = heldStepMagnitude(repeats)
    expect(steps).toBeGreaterThanOrEqual(previous)
    previous = steps
  }
})

test("held undo/redo repeats are gated on elapsed time, not on event count", () => {
  // A burst of repeat events inside one tick — synthetic events, a stuck key,
  // an event storm — must not each undo something.
  expect(heldRepeatShouldStep(0, 0)).toBe(false)
  expect(heldRepeatShouldStep(5, 5)).toBe(false)
  expect(heldRepeatShouldStep(HELD_REPEAT_DELAY_MS - 1, 999)).toBe(false)

  // Real auto-repeat clears both gates: the OS delay before the first tick is
  // far longer than ours, and ~30Hz ticks are slower than the interval floor.
  expect(heldRepeatShouldStep(500, 33)).toBe(true)
  expect(heldRepeatShouldStep(HELD_REPEAT_DELAY_MS, HELD_REPEAT_INTERVAL_MS)).toBe(true)

  // Past the initial delay, ticks still cannot arrive faster than the floor.
  expect(heldRepeatShouldStep(1000, HELD_REPEAT_INTERVAL_MS - 1)).toBe(false)

  // Both gates must clear the FASTEST setting real hardware offers, not just
  // the default, or a user with key repeat turned up loses their first ticks:
  // macOS bottoms out at ~225ms delay-until-repeat, Windows at ~250ms, and
  // sustained repeat tops out around 30Hz (~33ms per tick).
  expect(HELD_REPEAT_DELAY_MS).toBeLessThan(225)
  expect(HELD_REPEAT_INTERVAL_MS).toBeLessThan(33)
  // ...while still being far longer than a same-tick synthetic burst (2-6ms measured).
  expect(HELD_REPEAT_DELAY_MS).toBeGreaterThan(60)
})

test("history jump scheduler coalesces rapid absolute-index requests to the latest target", () => {
  // `request(absoluteIndex)` is the scrubbing path — when the user drags
  // a history slider, only the final position matters, so requests
  // arriving inside one animation frame must collapse into a single
  // jump to the most recent target.
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

test("history jump scheduler applies each step immediately so rapid Ctrl+Z presses each undo one change", () => {
  // `requestStep(currentIndex, delta, ...)` is the keyboard / menu /
  // history-panel-step path. Each call models one discrete user
  // intent (one keypress, one click) and must produce exactly one
  // jump. Three rapid undo presses must undo three things, not be
  // collapsed into a single -3 jump that skips the intermediate
  // states.
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

  // Each step fired synchronously — no rAF was scheduled.
  expect(jumps).toEqual([9, 8, 7])
  expect(scheduled).toHaveLength(0)
})

test("history jump scheduler steps from the latest applied target across frames", () => {
  // After a step has been applied, the next requestStep call must base
  // its delta off the pending (last-applied) target so consecutive
  // presses keep walking the timeline rather than jumping back to
  // `currentIndex` each time.
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

  expect(jumps).toEqual([9, 8])
})

test("history jump scheduler clamps step requests at the boundary and emits no jump there", () => {
  // Pressing Ctrl+Z when already at the floor (index 0) must do nothing
  // — no spurious jump event, no double-emit when the next step still
  // tries to go below zero.
  const jumps: number[] = []
  const scheduler = createHistoryJumpScheduler((index) => jumps.push(index))

  scheduler.requestStep(0, -1, 0, 10)
  scheduler.requestStep(0, -1, 0, 10)

  expect(jumps).toEqual([])
})

test("history jump scheduler discards a pending scrub target when a discrete step arrives", () => {
  // If the user is mid-scrub (a coalesced absolute request is queued)
  // and then taps Ctrl+Z, the discrete step represents the latest
  // intent. The pending scrub must be cancelled — otherwise the rAF
  // flush would later overwrite the step we just applied.
  const jumps: number[] = []
  const scheduled: FrameRequestCallback[] = []
  const cancelled: number[] = []
  const scheduler = createHistoryJumpScheduler(
    (index) => jumps.push(index),
    (callback) => {
      scheduled.push(callback)
      return scheduled.length
    },
    (id) => {
      cancelled.push(id)
    },
  )

  scheduler.request(7)
  scheduler.requestStep(5, -1, 0, 20)

  // The step fired immediately and the queued scrub frame was cancelled.
  expect(jumps).toEqual([6])
  expect(cancelled).toEqual([1])
})
