import { desktop, lane, mobile, nextSmokeServer } from "./base"

/** Full desktop suite + the mobile smoke slice, against a production build. */
export default lane({
  testIgnore: ["**/unit/**"],
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://127.0.0.1:3000", trace: "on-first-retry" },
  webServer: nextSmokeServer(3000, {
    env: {
      ALLOW_LOCAL_MARKETING_STORE: "true",
      ALLOW_LOCAL_SERVER_RATE_LIMIT: "true",
      MARKETING_TRUSTED_PROXY: "true",
    },
  }),
  projects: [
    { name: "chromium", grepInvert: /@matrix-smoke/, use: { ...desktop } },
    { name: "mobile-chromium-smoke", grep: /@matrix-smoke/, use: { ...mobile } },
  ],
})
