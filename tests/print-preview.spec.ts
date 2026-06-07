import { expect, test } from "@playwright/test"

/**
 * Regression guards for the print-preview popup.
 *
 * Audit L-1 (security_audit_2026-05-21.txt) flagged a contradictory
 * features string — `window.open("", "_blank", "noopener=no,noreferrer")` —
 * which the HTML spec coerces to `noopener=true,noreferrer=true`. On
 * Chromium 121+ that returns `null` and the print preview silently fails;
 * on browsers that honour the literal `noopener=no` token the manual
 * `win.opener = null` was the only opener-isolation defense.
 *
 * The fix in menu-bar.tsx and advanced-subsystems-dialog.tsx is to drop
 * the feature string entirely and explicitly null the opener once the
 * popup is open. These tests pin both behaviours so a regression that
 * reintroduces the contradictory feature string would be caught.
 */

async function installWindowOpenShim(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const recorded: Array<{ url: string; target: string; features: string }> = []
    const lastWindowRef: { current: null | { opener: unknown } } = { current: null }
    const original = window.open.bind(window)
    Object.defineProperty(window, "__printPreviewCalls", {
      configurable: true,
      get() { return recorded },
    })
    Object.defineProperty(window, "__printPreviewLastWindow", {
      configurable: true,
      get() { return lastWindowRef.current },
    })
    window.open = function shim(url?: string | URL, target?: string, features?: string) {
      recorded.push({
        url: typeof url === "string" ? url : String(url ?? ""),
        target: target ?? "",
        features: features ?? "",
      })
      // Hand back a stub that doesn't actually create a popup so the test
      // does not race the browser's print dialog. The stub is just enough
      // to let the caller's `try { (win as ...).opener = null } catch {}`
      // succeed and the document/body assignments not throw.
      const stubDoc = {
        body: {
          style: {} as Record<string, unknown>,
          appendChild: () => undefined,
        },
        createElement: () => ({
          style: {} as Record<string, unknown>,
          set onload(_handler: () => void) {},
          set src(_value: string) {},
        }),
        set title(_value: string) {},
        get title() { return "" },
      }
      const stub = {
        document: stubDoc,
        opener: window as Window | null,
        print: () => undefined,
        close: () => undefined,
      }
      lastWindowRef.current = stub
      void original // keep a reference so JIT doesn't elide
      return stub as unknown as Window
    } as typeof window.open
  })
}

test("File > Print uses window.open without the contradictory noopener feature string", async ({ page }) => {
  // The File menu is long enough on Desktop Chrome's default 720-px height
  // viewport that Print sits below the fold. Give the page room before
  // navigation so the dropdown content lays out fully inside the viewport.
  await page.setViewportSize({ width: 1280, height: 1200 })
  await installWindowOpenShim(page)
  await page.goto("/editor")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)

  const fileTrigger = page
    .locator('[data-slot="dropdown-menu-trigger"], [data-slot="menubar-trigger"]')
    .filter({ hasText: /^File$/ })
    .first()
  await fileTrigger.click()
  // The File menu has two items starting with "Print" — "Print Setup / Proof..."
  // routes to the advanced dialog, while "Print…" is the popup-based action
  // L-1 protects. Match the literal label including the ⌘P shortcut so we
  // only target the popup path.
  const printItem = page.getByRole("menuitem", { name: /^Print…\s*⌘P$/ }).first()
  await expect(printItem).toBeVisible()
  await printItem.click({ force: true })

  const calls = await page.evaluate(
    () => (window as unknown as { __printPreviewCalls: Array<{ url: string; target: string; features: string }> })
      .__printPreviewCalls,
  )
  expect(calls.length).toBeGreaterThanOrEqual(1)
  const last = calls[calls.length - 1]
  // The audit fix dropped the noopener=no,noreferrer string entirely.
  expect(last.features).toBe("")
  // The URL must be about:blank (not the contradictory "" + literal token).
  expect(last.url).toBe("about:blank")
  expect(last.target).toBe("_blank")

  // The caller must explicitly null the opener as defense-in-depth.
  const openerAfter = await page.evaluate(
    () => (window as unknown as { __printPreviewLastWindow: { opener: unknown } | null })
      .__printPreviewLastWindow?.opener,
  )
  expect(openerAfter).toBeNull()
})
