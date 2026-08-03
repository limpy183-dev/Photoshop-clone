import { desktop, lane, repoRoot } from "./base"

/** Development-only behavior needs a real `next dev`, not the production server. */
export default lane({
  testMatch: "**/startup-hydration-security.spec.ts",
  retries: 0,
  use: { baseURL: "http://127.0.0.1:3001", trace: "retain-on-failure", ...desktop },
  webServer: {
    command: "node ./node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3001",
    url: "http://127.0.0.1:3001",
    cwd: repoRoot,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "development-hydration" }],
})
