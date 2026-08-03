import { defineConfig, devices } from "@playwright/test"
import { resolve } from "node:path"

/**
 * Shared skeleton for the Playwright lanes. Each lane is a genuinely different
 * run (different port, different server, different spec set), so the configs
 * stay separate — only the boilerplate they all repeated lives here.
 *
 * Both paths below are resolved against this file rather than the process cwd:
 * Playwright resolves `testDir` relative to the config, and defaults
 * `webServer.cwd` to the config's own directory. Since these configs live in
 * playwright/, every `node scripts/...` command needs the repo root pinned
 * explicitly or it would look for scripts/ inside playwright/.
 *
 * `__dirname`, not `import.meta.url`: Playwright transpiles config files to CJS
 * (the package is not `"type": "module"`), so `import.meta` is a syntax error at
 * config-load time even though tsc accepts it.
 */
export const repoRoot = resolve(__dirname, "..")
export const testDir = resolve(__dirname, "../tests")

export const desktop = devices["Desktop Chrome"]
export const mobile = devices["Pixel 5"]

type WebServer = NonNullable<Parameters<typeof defineConfig>[0]["webServer"]>

/** The production-shaped Next server the browser lanes run against. */
export function nextSmokeServer(port: number, options: { reuseExistingServer?: boolean; env?: Record<string, string> } = {}): WebServer {
  return {
    command: `node scripts/serve-next-smoke.mjs --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    cwd: repoRoot,
    reuseExistingServer: options.reuseExistingServer ?? !process.env.CI,
    timeout: 120_000,
    ...(options.env ? { env: options.env } : {}),
  }
}

/** Base config every lane extends: same test root, same timeouts. */
export function lane(overrides: Parameters<typeof defineConfig>[0]) {
  return defineConfig({
    testDir,
    timeout: 30_000,
    expect: { timeout: 8_000 },
    ...overrides,
  })
}
