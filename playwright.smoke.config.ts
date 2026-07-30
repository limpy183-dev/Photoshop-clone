import { defineConfig, devices } from "@playwright/test"

// The project's central claim is that it is browser-native, yet every CI job
// has historically been Chromium-only. Setting PLAYWRIGHT_CROSS_BROWSER=true
// adds Firefox and WebKit desktop smoke projects.
//
// It is opt-in rather than default because the two engines diverge on exactly
// the surfaces this editor leans on (OPFS, MediaRecorder codecs, canvas colour
// behaviour, WebGL limits), and those failures are findings to triage rather
// than a reason to block every merge. CI runs this matrix in a non-blocking
// job; promote it to a required check once all three engines are green.
const crossBrowser = process.env.PLAYWRIGHT_CROSS_BROWSER === "true"

const crossBrowserProjects = [
  {
    name: "firefox-smoke",
    grep: /@shared|@desktop/,
    use: { ...devices["Desktop Firefox"] },
  },
  {
    name: "webkit-smoke",
    grep: /@shared|@desktop/,
    use: { ...devices["Desktop Safari"] },
  },
  {
    name: "mobile-webkit-smoke",
    grep: /@shared|@mobile/,
    use: { ...devices["iPhone 14"] },
  },
]

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
    ...(crossBrowser ? crossBrowserProjects : []),
  ],
})
