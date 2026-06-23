import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  testMatch: "static-export-smoke.spec.ts",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://127.0.0.1:3001",
    trace: "on-first-retry",
  },
  webServer: {
    command: "node scripts/serve-static.mjs out 3001",
    url: "http://127.0.0.1:3001/Photoshop-clone/",
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: "static-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
