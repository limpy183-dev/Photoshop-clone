import { desktop, lane, mobile, nextSmokeServer } from "./base"

/** Fast desktop/mobile smoke matrix. */
export default lane({
  testMatch: "**/photoshop-smoke.spec.ts",
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: "http://127.0.0.1:3000", trace: "on-first-retry" },
  webServer: nextSmokeServer(3000),
  projects: [
    { name: "desktop-smoke", grep: /@shared|@desktop/, use: { ...desktop } },
    { name: "mobile-smoke", grep: /@shared|@mobile/, use: { ...mobile } },
  ],
})
