import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  testMatch: "photoshop-smoke.spec.ts",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "node scripts/serve-next-smoke.mjs --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop-smoke",
      grep: /@shared|@desktop/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-smoke",
      grep: /@shared|@mobile/,
      use: { ...devices["Pixel 5"] },
    },
  ],
})
