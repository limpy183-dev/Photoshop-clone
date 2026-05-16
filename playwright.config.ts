import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
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
