import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  // One retry so trace/screenshot capture on flaky failures actually fires;
  // without retries, "on-first-retry" never triggers.
  retries: process.env.CI ? 2 : 1,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev -- --webpack --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000",
    // Reusing an existing server locally is convenient, but on CI it must be
    // a fresh server so unrelated processes can't poison the run.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      grepInvert: /@matrix-smoke/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium-smoke",
      grep: /@matrix-smoke/,
      use: { ...devices["Pixel 5"] },
    },
  ],
})
