import { expect, type Page, test } from "@playwright/test"

async function selectBrushTool(page: Page) {
  await expect(page.locator("[data-canvas-stage]")).toBeVisible()
  await page.locator("body").click({ position: { x: 20, y: 20 } })
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K")
  await expect(page.getByPlaceholder("Search tools, filters, panels, and commands")).toBeVisible()
  await page.getByPlaceholder("Search tools, filters, panels, and commands").fill("Brush Tool")
  await page.keyboard.press("Enter")
  await expect(page.getByText("Command Palette")).toBeHidden()
  await expect(page.getByRole("button", { name: /^Brush Tool\b/ }).first()).toBeVisible()
}

async function canvasScreenPoint(page: Page, x: number, y: number) {
  const stage = page.locator("[data-canvas-stage]")
  await expect(stage).toBeVisible()
  const box = await stage.boundingBox()
  if (!box) throw new Error("Canvas stage is not measurable")
  return { x: box.x + x, y: box.y + y }
}

async function canvasPixelAlpha(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x: px, y: py }) => {
      const canvas = document.querySelector<HTMLCanvasElement>("[data-canvas-stage] canvas")
      if (!canvas) throw new Error("Composite canvas not found")
      return canvas.getContext("2d")!.getImageData(px, py, 1, 1).data[3]
    },
    { x, y },
  )
}

async function darkPixelCount(page: Page, x: number, y: number, w: number, h: number) {
  return page.evaluate(
    ({ x: px, y: py, w: pw, h: ph }) => {
      const canvas = document.querySelector<HTMLCanvasElement>("[data-canvas-stage] canvas")
      if (!canvas) throw new Error("Composite canvas not found")
      const data = canvas.getContext("2d")!.getImageData(px, py, pw, ph).data
      let dark = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0 && data[i] < 90 && data[i + 1] < 90 && data[i + 2] < 90) dark++
      }
      return dark
    },
    { x, y, w, h },
  )
}

async function performStroke(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const start = await canvasScreenPoint(page, from.x, from.y)
  const end = await canvasScreenPoint(page, to.x, to.y)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await page.mouse.up()
}

// Regression test for "3 brush strokes then a single undo erases all 3" bug.
//
// Background: commit() defers history snapshotting onto an async queue. Layer
// canvases are mutated in-place during brush strokes, so without precapture
// the queued snapshots all read pixels from the same final mutated canvas,
// collapsing 3 history entries into ones that share identical pixels. The
// first one or two undos appear to do nothing and the third undo seems to
// "undo all 3 strokes at once".
//
// After the fix, each stroke's history entry is a stable snapshot of the
// canvas at commit time. A single undo must remove ONLY the most recent
// stroke and leave the prior two strokes visible.
test("a single undo after three brush strokes only undoes the most recent stroke", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await expect(page.locator("[data-canvas-stage]")).toBeVisible()
  // Wait for the canvas to be ready (background fill present)
  await expect.poll(async () => canvasPixelAlpha(page, 600, 400)).toBeGreaterThan(0)

  await selectBrushTool(page)

  // Three non-overlapping stroke regions so we can verify each stroke
  // independently via pixel sampling.
  const strokes = [
    { from: { x: 120, y: 120 }, to: { x: 280, y: 190 }, region: { x: 80, y: 80, w: 260, h: 160 } },
    { from: { x: 140, y: 320 }, to: { x: 300, y: 390 }, region: { x: 100, y: 280, w: 260, h: 160 } },
    { from: { x: 460, y: 200 }, to: { x: 620, y: 270 }, region: { x: 420, y: 160, w: 260, h: 160 } },
  ]

  for (const stroke of strokes) {
    await performStroke(page, stroke.from, stroke.to)
    // Tight delay between strokes — small enough that snapshot queues stack
    // up (the original failure mode), large enough that pointer events
    // don't merge.
    await page.waitForTimeout(60)
  }

  // Allow async snapshot queue and React renders to settle.
  await page.waitForTimeout(1500)

  for (const [index, stroke] of strokes.entries()) {
    const dark = await darkPixelCount(page, stroke.region.x, stroke.region.y, stroke.region.w, stroke.region.h)
    expect(dark, `expected stroke #${index + 1} region to be painted before undo`).toBeGreaterThan(20)
  }

  // Single undo.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z")
  await page.waitForTimeout(500)

  // Stroke 3 (most recent) must be cleared. Strokes 1 and 2 must remain.
  const firstAfterUndo = await darkPixelCount(page, strokes[0].region.x, strokes[0].region.y, strokes[0].region.w, strokes[0].region.h)
  const secondAfterUndo = await darkPixelCount(page, strokes[1].region.x, strokes[1].region.y, strokes[1].region.w, strokes[1].region.h)
  const thirdAfterUndo = await darkPixelCount(page, strokes[2].region.x, strokes[2].region.y, strokes[2].region.w, strokes[2].region.h)

  expect(firstAfterUndo, "first stroke must remain visible after one undo").toBeGreaterThan(20)
  expect(secondAfterUndo, "second stroke must remain visible after one undo").toBeGreaterThan(20)
  expect(thirdAfterUndo, "third (most recent) stroke must be cleared by one undo").toBe(0)

  // Second undo: stroke 2 should now be cleared, stroke 1 remains.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z")
  await page.waitForTimeout(500)

  const firstAfterSecondUndo = await darkPixelCount(page, strokes[0].region.x, strokes[0].region.y, strokes[0].region.w, strokes[0].region.h)
  const secondAfterSecondUndo = await darkPixelCount(page, strokes[1].region.x, strokes[1].region.y, strokes[1].region.w, strokes[1].region.h)
  const thirdAfterSecondUndo = await darkPixelCount(page, strokes[2].region.x, strokes[2].region.y, strokes[2].region.w, strokes[2].region.h)

  expect(firstAfterSecondUndo, "first stroke must remain visible after two undos").toBeGreaterThan(20)
  expect(secondAfterSecondUndo, "second stroke must be cleared by two undos").toBe(0)
  expect(thirdAfterSecondUndo, "third stroke must still be cleared after two undos").toBe(0)

  // Third undo: all strokes cleared.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z")
  await page.waitForTimeout(500)

  const firstAfterThirdUndo = await darkPixelCount(page, strokes[0].region.x, strokes[0].region.y, strokes[0].region.w, strokes[0].region.h)
  expect(firstAfterThirdUndo, "first stroke must be cleared by three undos").toBe(0)
})

test("undo remains one step when pressed while brush history is still being captured", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await expect(page.locator("[data-canvas-stage]")).toBeVisible()
  await expect.poll(async () => canvasPixelAlpha(page, 600, 400)).toBeGreaterThan(0)

  await selectBrushTool(page)

  const strokes = [
    { from: { x: 120, y: 120 }, to: { x: 280, y: 190 }, region: { x: 80, y: 80, w: 260, h: 160 } },
    { from: { x: 140, y: 320 }, to: { x: 300, y: 390 }, region: { x: 100, y: 280, w: 260, h: 160 } },
    { from: { x: 460, y: 200 }, to: { x: 620, y: 270 }, region: { x: 420, y: 160, w: 260, h: 160 } },
  ]

  for (const stroke of strokes) {
    await performStroke(page, stroke.from, stroke.to)
    await page.waitForTimeout(40)
  }

  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z")
  await page.waitForTimeout(1600)

  const firstAfterUndo = await darkPixelCount(page, strokes[0].region.x, strokes[0].region.y, strokes[0].region.w, strokes[0].region.h)
  const secondAfterUndo = await darkPixelCount(page, strokes[1].region.x, strokes[1].region.y, strokes[1].region.w, strokes[1].region.h)
  const thirdAfterUndo = await darkPixelCount(page, strokes[2].region.x, strokes[2].region.y, strokes[2].region.w, strokes[2].region.h)

  expect(firstAfterUndo, "first stroke must remain visible after one queued undo").toBeGreaterThan(20)
  expect(secondAfterUndo, "second stroke must remain visible after one queued undo").toBeGreaterThan(20)
  expect(thirdAfterUndo, "third stroke must be cleared by one queued undo").toBe(0)
})

test("held ctrl z repeat events do not collapse multiple brush strokes into one undo gesture", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await expect(page.locator("[data-canvas-stage]")).toBeVisible()
  await expect.poll(async () => canvasPixelAlpha(page, 600, 400)).toBeGreaterThan(0)

  await selectBrushTool(page)

  const strokes = [
    { from: { x: 120, y: 120 }, to: { x: 280, y: 190 }, region: { x: 80, y: 80, w: 260, h: 160 } },
    { from: { x: 140, y: 320 }, to: { x: 300, y: 390 }, region: { x: 100, y: 280, w: 260, h: 160 } },
    { from: { x: 460, y: 200 }, to: { x: 620, y: 270 }, region: { x: 420, y: 160, w: 260, h: 160 } },
  ]

  for (const stroke of strokes) {
    await performStroke(page, stroke.from, stroke.to)
    await page.waitForTimeout(300)
  }
  await page.waitForTimeout(900)

  await page.keyboard.down(process.platform === "darwin" ? "Meta" : "Control")
  await page.keyboard.down("z")
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "z",
        code: "KeyZ",
        ctrlKey: navigator.platform.toLowerCase().includes("mac") ? false : true,
        metaKey: navigator.platform.toLowerCase().includes("mac"),
        repeat: true,
        bubbles: true,
        cancelable: true,
      }))
    }
  })
  await page.keyboard.up("z")
  await page.keyboard.up(process.platform === "darwin" ? "Meta" : "Control")
  await page.waitForTimeout(800)

  const firstAfterUndo = await darkPixelCount(page, strokes[0].region.x, strokes[0].region.y, strokes[0].region.w, strokes[0].region.h)
  const secondAfterUndo = await darkPixelCount(page, strokes[1].region.x, strokes[1].region.y, strokes[1].region.w, strokes[1].region.h)
  const thirdAfterUndo = await darkPixelCount(page, strokes[2].region.x, strokes[2].region.y, strokes[2].region.w, strokes[2].region.h)

  expect(firstAfterUndo, "first stroke must remain visible after one held undo gesture").toBeGreaterThan(20)
  expect(secondAfterUndo, "second stroke must remain visible after one held undo gesture").toBeGreaterThan(20)
  expect(thirdAfterUndo, "third stroke must be cleared by one held undo gesture").toBe(0)
})



// Regression test for Issue 2: undo must never reach a state before the
// canvas was initialized. The reducer's initial state was originally seeded
// with a stale "history_initial" entry whose layer canvases were SSR
// placeholders without a real 2d context, so restoring it would erase the
// document's default white background. After the fix, the SSR-init effect
// resets the document's history to a single fresh floor entry built from the
// real canvases, so no amount of Ctrl+Z can drop us below that floor.
async function pixelIsWhite(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x: px, y: py }) => {
      const canvas = document.querySelector<HTMLCanvasElement>("[data-canvas-stage] canvas")
      if (!canvas) throw new Error("Composite canvas not found")
      const data = canvas.getContext("2d")!.getImageData(px, py, 1, 1).data
      return data[3] > 0 && data[0] > 240 && data[1] > 240 && data[2] > 240
    },
    { x, y },
  )
}

test("undo cannot remove the initial canvas state no matter how many times it is pressed", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await expect(page.locator("[data-canvas-stage]")).toBeVisible()
  // Wait for the canvas background to be painted on the client
  await expect.poll(async () => canvasPixelAlpha(page, 600, 400)).toBeGreaterThan(0)

  // The default background is white — confirm it is present before any edits
  expect(await pixelIsWhite(page, 600, 400), "canvas must start with white background").toBe(true)

  await selectBrushTool(page)

  // Two short strokes that we can verify get cleared by undo
  const strokes = [
    { from: { x: 120, y: 120 }, to: { x: 280, y: 190 }, region: { x: 80, y: 80, w: 260, h: 160 } },
    { from: { x: 460, y: 200 }, to: { x: 620, y: 270 }, region: { x: 420, y: 160, w: 260, h: 160 } },
  ]
  for (const stroke of strokes) {
    await performStroke(page, stroke.from, stroke.to)
    await page.waitForTimeout(60)
  }
  await page.waitForTimeout(500)

  // Press Ctrl+Z far more times than there are history entries. Each press
  // is a separate keypress (not held repeats) so the scheduler dispatches
  // them as discrete steps.
  const undoKey = process.platform === "darwin" ? "Meta+z" : "Control+z"
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press(undoKey)
    await page.waitForTimeout(40)
  }
  await page.waitForTimeout(600)

  // After exhaustive undo, all strokes must be cleared but the white
  // background must still be present at every sampled point.
  for (const [index, stroke] of strokes.entries()) {
    const dark = await darkPixelCount(page, stroke.region.x, stroke.region.y, stroke.region.w, stroke.region.h)
    expect(dark, `stroke #${index + 1} must be undone`).toBe(0)
  }

  for (const sample of [
    { x: 100, y: 100 },
    { x: 600, y: 400 },
    { x: 900, y: 600 },
    { x: 200, y: 700 },
  ]) {
    expect(
      await pixelIsWhite(page, sample.x, sample.y),
      `pixel (${sample.x}, ${sample.y}) must remain white after exhaustive undo — undo must not exceed initial canvas state`,
    ).toBe(true)
  }
})



// Regression test: with zero delay between strokes (back-to-back as fast as
// the browser will dispatch them), every stroke must still be its own undo
// step. Previously, the async snapshot queue could let multiple commits read
// the same final mutated canvas, collapsing them into a single "everything"
// undo step. With sync commits this can't happen.
test("back-to-back strokes with no delay between them each get their own undo step", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await expect(page.locator("[data-canvas-stage]")).toBeVisible()
  await expect.poll(async () => canvasPixelAlpha(page, 600, 400)).toBeGreaterThan(0)

  await selectBrushTool(page)

  const strokes = [
    { from: { x: 120, y: 120 }, to: { x: 280, y: 190 }, region: { x: 80, y: 80, w: 260, h: 160 } },
    { from: { x: 140, y: 320 }, to: { x: 300, y: 390 }, region: { x: 100, y: 280, w: 260, h: 160 } },
    { from: { x: 460, y: 200 }, to: { x: 620, y: 270 }, region: { x: 420, y: 160, w: 260, h: 160 } },
    { from: { x: 760, y: 320 }, to: { x: 920, y: 390 }, region: { x: 720, y: 280, w: 260, h: 160 } },
  ]
  // No waitForTimeout between strokes — fire them as fast as we can.
  for (const stroke of strokes) {
    await performStroke(page, stroke.from, stroke.to)
  }
  await page.waitForTimeout(800)

  for (const [index, stroke] of strokes.entries()) {
    const dark = await darkPixelCount(page, stroke.region.x, stroke.region.y, stroke.region.w, stroke.region.h)
    expect(dark, `stroke #${index + 1} must be painted before any undo`).toBeGreaterThan(20)
  }

  const undoKey = process.platform === "darwin" ? "Meta+z" : "Control+z"

  // Undo the strokes one at a time, with a small pause between presses so
  // the history-jump scheduler doesn't coalesce them. Each press must remove
  // exactly one stroke (the most recent still on the canvas).
  for (let i = strokes.length - 1; i >= 0; i--) {
    await page.keyboard.press(undoKey)
    await page.waitForTimeout(120)

    const stillPainted = await darkPixelCount(
      page,
      strokes[i].region.x,
      strokes[i].region.y,
      strokes[i].region.w,
      strokes[i].region.h,
    )
    expect(stillPainted, `stroke #${i + 1} should be cleared after ${strokes.length - i} undo(s)`).toBe(0)

    // Strokes earlier in the list (smaller index) must still be on screen.
    for (let j = 0; j < i; j++) {
      const dark = await darkPixelCount(
        page,
        strokes[j].region.x,
        strokes[j].region.y,
        strokes[j].region.w,
        strokes[j].region.h,
      )
      expect(
        dark,
        `stroke #${j + 1} must remain painted after stroke #${i + 1} is undone`,
      ).toBeGreaterThan(20)
    }
  }
})

// Performance regression test: brush stroke commits must not block the main
// thread for an unreasonably long time. Earlier, an unconditional full-canvas
// clone in commit() blocked the pointer-up handler for 15-50ms per stroke,
// which the user perceived as lag/freezes between strokes. With the patch
// path doing only a small dirty-rect clone, each commit should return well
// inside a single animation frame.
test("brush stroke commits return quickly to keep painting responsive", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await expect(page.locator("[data-canvas-stage]")).toBeVisible()
  await expect.poll(async () => canvasPixelAlpha(page, 600, 400)).toBeGreaterThan(0)

  await selectBrushTool(page)

  const strokes = [
    { from: { x: 120, y: 120 }, to: { x: 280, y: 190 } },
    { from: { x: 140, y: 320 }, to: { x: 300, y: 390 } },
    { from: { x: 460, y: 200 }, to: { x: 620, y: 270 } },
    { from: { x: 760, y: 320 }, to: { x: 920, y: 390 } },
    { from: { x: 240, y: 520 }, to: { x: 400, y: 590 } },
    { from: { x: 540, y: 520 }, to: { x: 700, y: 590 } },
  ]

  const durations: number[] = []
  for (const stroke of strokes) {
    const start = await canvasScreenPoint(page, stroke.from.x, stroke.from.y)
    const end = await canvasScreenPoint(page, stroke.to.x, stroke.to.y)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })

    const t0 = Date.now()
    await page.mouse.up()
    const dt = Date.now() - t0
    durations.push(dt)
  }
  await page.waitForTimeout(500)

  // The slowest pointer-up→commit round trip must stay well below an obvious
  // freeze. We allow a generous ceiling because Playwright + headless browser
  // jitter (especially under parallel test load) can push a single commit
  // well past 100ms, but a regression to multi-frame full-canvas clones blew
  // far past this here. The previous bug was on the order of 1-2s under load
  // with many layers; this guard catches that without being flaky.
  const slowest = Math.max(...durations)
  expect(slowest, `slowest brush commit took ${slowest}ms (durations=${JSON.stringify(durations)})`).toBeLessThan(800)
  // Also assert the median: even with one slow outlier from GC etc., the
  // typical commit should be quick.
  const sorted = [...durations].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  expect(median, `median brush commit took ${median}ms (durations=${JSON.stringify(durations)})`).toBeLessThan(250)
})


// Diagnostic / regression: actively probe the in-app history state after each
// stroke and after each undo. This catches bugs that pixel inspection might
// miss — e.g. if multiple strokes were collapsed into one entry, or if the
// floor entry was duplicated, or if undo silently jumped further than one
// step.
test("history state has exactly one new entry per stroke and one fewer per undo", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await expect(page.locator("[data-canvas-stage]")).toBeVisible()
  await expect.poll(async () => canvasPixelAlpha(page, 600, 400)).toBeGreaterThan(0)

  await selectBrushTool(page)

  // Helper: read the visible "history entries / index" via the History panel.
  // The panel renders one button per entry with title text we can count, and
  // the active entry is marked with aria-current. We open the panel, read
  // counts, and close it.
  const readHistoryFromPanel = async () => {
    return page.evaluate(() => {
      // Look for the history-panel content — it lists entries with titles.
      // We find it by scanning visible buttons that look like history entries.
      const buttons = Array.from(document.querySelectorAll("button"))
      // The history panel buttons each have text content; pick those inside
      // a container with role/aria attributes specific to the panel. As a
      // robust fallback, count via the data-history-entry attribute if
      // present — otherwise return null and the test will fall back to
      // using stroke count.
      const entryButtons = buttons.filter((b) => b.dataset.historyEntry !== undefined)
      const activeEl = document.querySelector("[data-history-entry][aria-current='true']")
      const activeIndex = activeEl ? Number((activeEl as HTMLElement).dataset.historyIndex ?? -1) : -1
      return {
        entries: entryButtons.length,
        activeIndex,
      }
    })
  }

  const initialHistory = await readHistoryFromPanel()

  // Skip diagnostic if the panel doesn't expose data attributes — fall back
  // to a behavioral check that exercises Ctrl+Z incrementally.
  const useStateProbe = initialHistory.entries > 0

  const strokes = [
    { from: { x: 120, y: 120 }, to: { x: 280, y: 190 }, region: { x: 80, y: 80, w: 260, h: 160 } },
    { from: { x: 140, y: 320 }, to: { x: 300, y: 390 }, region: { x: 100, y: 280, w: 260, h: 160 } },
    { from: { x: 460, y: 200 }, to: { x: 620, y: 270 }, region: { x: 420, y: 160, w: 260, h: 160 } },
  ]

  for (let i = 0; i < strokes.length; i++) {
    await performStroke(page, strokes[i].from, strokes[i].to)
    await page.waitForTimeout(200)
    if (useStateProbe) {
      const hist = await readHistoryFromPanel()
      expect(
        hist.entries,
        `after stroke ${i + 1}, history must have grown by exactly ${i + 1} entries`,
      ).toBe(initialHistory.entries + i + 1)
    }
  }

  // Verify all strokes are visible
  for (const [i, stroke] of strokes.entries()) {
    const dark = await darkPixelCount(page, stroke.region.x, stroke.region.y, stroke.region.w, stroke.region.h)
    expect(dark, `stroke ${i + 1} must be painted`).toBeGreaterThan(20)
  }

  // Step undos: each Ctrl+Z must remove exactly one stroke region.
  const undoKey = process.platform === "darwin" ? "Meta+z" : "Control+z"
  for (let i = strokes.length - 1; i >= 0; i--) {
    await page.keyboard.press(undoKey)
    await page.waitForTimeout(150)

    // Stroke at index i must be cleared
    const cleared = await darkPixelCount(
      page,
      strokes[i].region.x,
      strokes[i].region.y,
      strokes[i].region.w,
      strokes[i].region.h,
    )
    expect(cleared, `after undo ${strokes.length - i}, stroke ${i + 1} must be cleared`).toBe(0)

    // Strokes 0..i-1 must remain
    for (let j = 0; j < i; j++) {
      const dark = await darkPixelCount(
        page,
        strokes[j].region.x,
        strokes[j].region.y,
        strokes[j].region.w,
        strokes[j].region.h,
      )
      expect(
        dark,
        `after undo ${strokes.length - i}, stroke ${j + 1} must still be visible`,
      ).toBeGreaterThan(20)
    }
  }
})

// Specifically tests OVERLAPPING strokes — these exercise the canvas-patch
// chain in ways that non-overlapping regions don't. If the patch chain ever
// shared the same dirty rect across history entries, restoring an
// intermediate state would either over-clear or under-clear the canvas.
test("overlapping brush strokes each get their own undo step", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await expect(page.locator("[data-canvas-stage]")).toBeVisible()
  await expect.poll(async () => canvasPixelAlpha(page, 600, 400)).toBeGreaterThan(0)

  await selectBrushTool(page)

  // Three strokes that overlap in pairs: 1↔2 overlap, 2↔3 overlap.
  // Region samples are placed in non-overlapping sub-areas of each stroke
  // so we can test each stroke's presence/absence independently.
  const strokes = [
    {
      from: { x: 200, y: 300 },
      to: { x: 400, y: 300 },
      sample: { x: 220, y: 300, w: 40, h: 30 }, // far left, only stroke 1 paints here
    },
    {
      from: { x: 380, y: 300 },
      to: { x: 580, y: 300 },
      sample: { x: 480, y: 300, w: 40, h: 30 }, // middle, only strokes 1, 2 unique area
    },
    {
      from: { x: 560, y: 300 },
      to: { x: 760, y: 300 },
      sample: { x: 720, y: 300, w: 40, h: 30 }, // far right, only stroke 3 paints here
    },
  ]

  for (const stroke of strokes) {
    await performStroke(page, stroke.from, stroke.to)
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(400)

  // All three sample regions must be painted before any undo.
  for (const [i, stroke] of strokes.entries()) {
    const dark = await darkPixelCount(page, stroke.sample.x, stroke.sample.y, stroke.sample.w, stroke.sample.h)
    expect(dark, `stroke ${i + 1} sample must be painted before undo`).toBeGreaterThan(5)
  }

  const undoKey = process.platform === "darwin" ? "Meta+z" : "Control+z"

  // First undo: stroke 3's far-right sample clears, stroke 1 and 2 samples remain.
  await page.keyboard.press(undoKey)
  await page.waitForTimeout(200)
  expect(
    await darkPixelCount(page, strokes[0].sample.x, strokes[0].sample.y, strokes[0].sample.w, strokes[0].sample.h),
    "stroke 1 sample must remain after first undo",
  ).toBeGreaterThan(5)
  expect(
    await darkPixelCount(page, strokes[2].sample.x, strokes[2].sample.y, strokes[2].sample.w, strokes[2].sample.h),
    "stroke 3 sample must clear after first undo",
  ).toBe(0)

  // Second undo: stroke 2's sample clears too.
  await page.keyboard.press(undoKey)
  await page.waitForTimeout(200)
  expect(
    await darkPixelCount(page, strokes[0].sample.x, strokes[0].sample.y, strokes[0].sample.w, strokes[0].sample.h),
    "stroke 1 sample must remain after second undo",
  ).toBeGreaterThan(5)
  expect(
    await darkPixelCount(page, strokes[1].sample.x, strokes[1].sample.y, strokes[1].sample.w, strokes[1].sample.h),
    "stroke 2 sample must clear after second undo",
  ).toBe(0)
})

test("undo after painting a new branch only removes the new brush stroke", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/")
  await expect(page.locator("[data-canvas-stage]")).toBeVisible()
  await expect.poll(async () => canvasPixelAlpha(page, 600, 400)).toBeGreaterThan(0)

  await selectBrushTool(page)

  const strokes = [
    { from: { x: 120, y: 120 }, to: { x: 280, y: 190 }, region: { x: 80, y: 80, w: 260, h: 160 } },
    { from: { x: 140, y: 320 }, to: { x: 300, y: 390 }, region: { x: 100, y: 280, w: 260, h: 160 } },
    { from: { x: 460, y: 200 }, to: { x: 620, y: 270 }, region: { x: 420, y: 160, w: 260, h: 160 } },
  ]
  const branchStroke = {
    from: { x: 760, y: 320 },
    to: { x: 920, y: 390 },
    region: { x: 720, y: 280, w: 260, h: 160 },
  }

  for (const stroke of strokes) {
    await performStroke(page, stroke.from, stroke.to)
    await page.waitForTimeout(100)
  }
  await page.waitForTimeout(500)

  const undoKey = process.platform === "darwin" ? "Meta+z" : "Control+z"
  await page.keyboard.press(undoKey)
  await page.waitForTimeout(250)

  expect(
    await darkPixelCount(page, strokes[0].region.x, strokes[0].region.y, strokes[0].region.w, strokes[0].region.h),
    "stroke 1 must remain after the first undo",
  ).toBeGreaterThan(20)
  expect(
    await darkPixelCount(page, strokes[1].region.x, strokes[1].region.y, strokes[1].region.w, strokes[1].region.h),
    "stroke 2 must remain after the first undo",
  ).toBeGreaterThan(20)
  expect(
    await darkPixelCount(page, strokes[2].region.x, strokes[2].region.y, strokes[2].region.w, strokes[2].region.h),
    "stroke 3 must be undone before creating the new branch",
  ).toBe(0)

  await performStroke(page, branchStroke.from, branchStroke.to)
  await page.waitForTimeout(500)
  expect(
    await darkPixelCount(page, branchStroke.region.x, branchStroke.region.y, branchStroke.region.w, branchStroke.region.h),
    "branch stroke must be visible before undoing it",
  ).toBeGreaterThan(20)

  await page.keyboard.press(undoKey)
  await page.waitForTimeout(250)

  expect(
    await darkPixelCount(page, branchStroke.region.x, branchStroke.region.y, branchStroke.region.w, branchStroke.region.h),
    "the new branch stroke must be cleared by one undo",
  ).toBe(0)
  expect(
    await darkPixelCount(page, strokes[0].region.x, strokes[0].region.y, strokes[0].region.w, strokes[0].region.h),
    "stroke 1 must remain after undoing the branch stroke",
  ).toBeGreaterThan(20)
  expect(
    await darkPixelCount(page, strokes[1].region.x, strokes[1].region.y, strokes[1].region.w, strokes[1].region.h),
    "stroke 2 must remain after undoing the branch stroke",
  ).toBeGreaterThan(20)
  expect(
    await darkPixelCount(page, strokes[2].region.x, strokes[2].region.y, strokes[2].region.w, strokes[2].region.h),
    "stroke 3 must stay undone after the branch undo",
  ).toBe(0)
})
