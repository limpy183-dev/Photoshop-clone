import { desktop, lane, repoRoot } from "./base"

/** Static export served from out/, under the GitHub Pages base path. */
export default lane({
  testMatch: "**/static-export-smoke.spec.ts",
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: "http://127.0.0.1:3001", trace: "on-first-retry" },
  webServer: {
    command: "node scripts/serve-static.mjs out 3001",
    url: "http://127.0.0.1:3001/Photoshop-clone/",
    cwd: repoRoot,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [{ name: "static-chromium", use: { ...desktop } }],
})
