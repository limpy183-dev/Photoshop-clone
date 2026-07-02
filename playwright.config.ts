import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  testIgnore: ["**/unit/**"],
  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "node scripts/serve-next-smoke.mjs --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ALLOW_LOCAL_MARKETING_STORE: "true",
      ALLOW_LOCAL_SERVER_RATE_LIMIT: "true",
      MARKETING_TRUSTED_PROXY: "true",
    },
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
