import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  testMatch: "brush-stroke-undo.spec.ts",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: 0,
  repeatEach: Number(process.env.PLAYWRIGHT_REPEAT_EACH ?? 20),
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3002",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "node scripts/serve-next-smoke.mjs --hostname 127.0.0.1 --port 3002",
    url: "http://127.0.0.1:3002",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "critical-repeat" }],
})
