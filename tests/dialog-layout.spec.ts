import { expect, type Page, test } from "@playwright/test"

/**
 * Two layout invariants that used to break silently across every dialog.
 *
 * Width: `DialogContent` once carried `sm:max-w-lg`. tailwind-merge keeps a
 * caller's unprefixed `max-w-[820px]` *and* that `sm:` class (different variant
 * scopes), and the `sm:` rule is emitted later, so it won. Every dialog wider
 * than 512px was clamped to 512 on desktop and its contents spilled out. If the
 * base ever regains a breakpoint-prefixed max-width, the width checks here fail.
 *
 * Overflow: `scrollWidth === clientWidth` is the honest "nothing escaped
 * sideways" test. Vertical scrolling is expected and deliberately not asserted.
 */

const CASES = [
  { menu: "File", path: ["Round-Trip Inspector..."], width: 820 },
  { menu: "File", path: ["Contact Sheet II…"], width: 900 },
  { menu: "Select", path: ["Color Range…"], width: 680 },
  { menu: "Filter", path: ["Camera Raw Filter..."], width: 920 },
]

function topMenu(page: Page, name: string) {
  return page
    .locator('[data-slot="dropdown-menu-trigger"], [data-slot="menubar-trigger"]')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .first()
}

const surfaces = (page: Page) => page.locator('[data-slot="menubar-content"], [data-slot="menubar-sub-content"]')

async function openEditor(page: Page) {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto("/editor")
  await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0)
}

for (const { menu, path, width } of CASES) {
  test(`${path.at(-1)} opens at its declared width without horizontal overflow`, async ({ page }) => {
    await openEditor(page)
    await topMenu(page, menu).click()
    for (const step of path.slice(0, -1)) {
      await surfaces(page).last().locator('[data-slot="menubar-sub-trigger"]').filter({ hasText: step }).first().hover()
    }
    await surfaces(page).last().locator('[data-slot="menubar-item"]').filter({ hasText: path.at(-1)! }).first().click()

    const dialog = page.locator('[data-slot="dialog-content"]').last()
    await expect(dialog).toBeVisible()

    // offsetWidth, not getBoundingClientRect: the `zoom-in-95` open animation
    // scales the element, so a rect read mid-flight reports ~95% of the real
    // width. Layout widths ignore transforms and are stable immediately.
    const box = await dialog.evaluate((el: HTMLElement) => ({
      width: el.offsetWidth,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }))

    expect(box.width).toBe(width)
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth)
  })
}

test("a long menu stays inside the viewport and scrolls instead of clipping", async ({ page }) => {
  await openEditor(page)
  await topMenu(page, "File").click()
  const content = page.locator('[data-slot="menubar-content"]').first()
  await expect(content).toBeVisible()

  const m = await content.evaluate((el: HTMLElement) => ({
    bottom: el.offsetTop + el.offsetHeight,
    overflowY: getComputedStyle(el).overflowY,
    scrollable: el.scrollHeight > el.clientHeight,
    viewport: window.innerHeight,
  }))

  expect(m.bottom).toBeLessThanOrEqual(m.viewport)
  // The File menu is taller than the viewport, so it must scroll to stay reachable.
  expect(m.scrollable).toBe(true)
  expect(m.overflowY).toBe("auto")
})
