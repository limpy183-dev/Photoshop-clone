import { expect, type ConsoleMessage, type Page } from "@playwright/test"

type RuntimeIssue = {
  kind: "console" | "page"
  message: string
}

const issuesByPage = new WeakMap<Page, RuntimeIssue[]>()

function recordConsoleIssue(issues: RuntimeIssue[], message: ConsoleMessage) {
  if (message.type() !== "error") return
  const text = message.text()
  // Browser resource cancellation during navigation is not an application
  // runtime failure. Everything else at error level is actionable.
  if (/net::ERR_ABORTED/i.test(text)) return
  issues.push({ kind: "console", message: text })
}

export function installRuntimeGuard(page: Page) {
  if (issuesByPage.has(page)) return
  const issues: RuntimeIssue[] = []
  issuesByPage.set(page, issues)
  page.on("pageerror", (error) => issues.push({ kind: "page", message: error.message }))
  page.on("console", (message) => recordConsoleIssue(issues, message))
}

export function assertRuntimeHealthy(page: Page) {
  const issues = issuesByPage.get(page) ?? []
  expect(issues, issues.map((issue) => `${issue.kind}: ${issue.message}`).join("\n")).toEqual([])
}

export async function waitForEditorReady(page: Page) {
  installRuntimeGuard(page)
  await expect(page.locator('[data-canvas-stage][data-editor-ready="true"]')).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => {
    assertRuntimeHealthy(page)
    return page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>("[data-canvas-stage]")
      const canvas = stage?.querySelector<HTMLCanvasElement>("canvas")
      if (!stage || !canvas) return false

      const style = getComputedStyle(stage)
      const box = stage.getBoundingClientRect()
      if (style.position !== "relative") return false
      if (box.width <= 0 || box.height <= 0) return false
      if (box.bottom <= 0 || box.top >= window.innerHeight) return false
      if (box.right <= 0 || box.left >= window.innerWidth) return false
      if (document.querySelector("nextjs-portal, [data-nextjs-dialog-overlay]")) return false

      const context = canvas.getContext("2d", { willReadFrequently: true })
      if (!context || canvas.width <= 0 || canvas.height <= 0) return false
      const sampleX = Math.min(canvas.width - 1, Math.max(0, Math.floor(canvas.width / 2)))
      const sampleY = Math.min(canvas.height - 1, Math.max(0, Math.floor(canvas.height / 2)))
      return context.getImageData(sampleX, sampleY, 1, 1).data[3] > 0
    })
  }, { timeout: 30_000, message: "editor stage must be stable, visible, painted, and overlay-free" }).toBe(true)
  assertRuntimeHealthy(page)
}

export async function assertEditorGeometry(page: Page) {
  assertRuntimeHealthy(page)
  const geometry = await page.locator("[data-canvas-stage]").evaluate((stage) => {
    const style = getComputedStyle(stage)
    const box = stage.getBoundingClientRect()
    return {
      position: style.position,
      withinViewport:
        box.width > 0 &&
        box.height > 0 &&
        box.bottom > 0 &&
        box.top < window.innerHeight &&
        box.right > 0 &&
        box.left < window.innerWidth,
    }
  })
  expect(geometry.position).toBe("relative")
  expect(geometry.withinViewport).toBe(true)
}
