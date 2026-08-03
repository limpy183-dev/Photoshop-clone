import { desktop, lane, nextSmokeServer } from "./base"

/** Flake hunt: one critical interaction, repeated, no retries to mask it. */
export default lane({
  testMatch: "**/brush-stroke-undo.spec.ts",
  retries: 0,
  repeatEach: Number(process.env.PLAYWRIGHT_REPEAT_EACH ?? 20),
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3002", trace: "retain-on-failure", ...desktop },
  webServer: nextSmokeServer(3002, { reuseExistingServer: false }),
  projects: [{ name: "critical-repeat" }],
})
