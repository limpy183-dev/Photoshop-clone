import { defineConfig, devices } from "@playwright/test"
import Module from "node:module"
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

/**
 * Teach Node's CJS resolver about the "@/" alias.
 *
 * Playwright rewrites tsconfig `paths` when it transpiles a file, but a module
 * reached only through a runtime `import()` is loaded outside that pass, so its
 * own static "@/" imports arrive at Node unmapped and throw
 * "Cannot find module '@/editor/...'". Webpack has no such gap, so this only
 * ever bites Node-side tests that call into a lazily-imported module -
 * e.g. tests/file-format-depth.spec.ts reaching editor/raster/codecs-jpeg2000.ts
 * through the `await import()` in editor/raster/codecs.ts.
 *
 * The alternative was exempting that module's 26-file transitive closure from
 * the "@/"-only import rule, which would rot the moment anyone added an import.
 *
 * ponytail: patches Module._resolveFilename, the same lever tsconfig-paths
 * uses. Replace with `module.registerHooks()` if the CJS internals move.
 */
const RESOLVER = Module as unknown as {
  _resolveFilename?: (request: string, ...rest: unknown[]) => string
  __psAliasPatched?: boolean
}
if (RESOLVER._resolveFilename && !RESOLVER.__psAliasPatched) {
  const original = RESOLVER._resolveFilename
  RESOLVER._resolveFilename = function (request: string, ...rest: unknown[]) {
    return original.call(this, request.startsWith("@/") ? resolve(repoRoot, request.slice(2)) : request, ...rest)
  }
  RESOLVER.__psAliasPatched = true
}

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
