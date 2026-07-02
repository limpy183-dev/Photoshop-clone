import { expect, test } from "@playwright/test"

test("startup routes do not report React hydration warnings", async ({ baseURL, browser }) => {
  test.skip(!baseURL, "Requires the default browser Playwright config with a running web server.")

  const hydrationWarning = /hydration|hydrated but|server rendered html|extra attributes from the server|did not match/i
  const hydrationMessages: Array<{ route: string; text: string }> = []

  for (const route of ["/", "/editor"]) {
    const page = await browser.newPage()
    page.on("console", (message) => {
      const text = message.text()
      if (hydrationWarning.test(text)) hydrationMessages.push({ route, text })
    })

    try {
      await page.goto(new URL(route, baseURL).href, { waitUntil: "domcontentloaded" })
      await page.waitForTimeout(1_000)
    } finally {
      await page.close()
    }
  }

  expect(hydrationMessages).toEqual([])
})
