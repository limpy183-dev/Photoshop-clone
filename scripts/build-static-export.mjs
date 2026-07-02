#!/usr/bin/env node
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, relative, resolve, sep } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const output = resolve(root, "out")
const temp = mkdtempSync(join(tmpdir(), "photoshop-static-export-"))
const excludedTopLevel = new Set([
  ".git",
  ".next",
  ".data",
  "artifacts",
  "node_modules",
  "out",
  "output",
  "test-results",
])

function assertInside(parent, child) {
  const rel = relative(parent, child)
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || resolve(parent, rel) !== child) {
    throw new Error(`Refusing filesystem operation outside ${parent}: ${child}`)
  }
}

function copyFilter(source) {
  const rel = relative(root, source)
  if (!rel) return true
  const first = rel.split(/[\\/]/, 1)[0]
  if (excludedTopLevel.has(first)) return false
  return !/\.(?:log|tsbuildinfo)$/.test(basename(source))
}

assertInside(tmpdir(), temp)
assertInside(root, output)

try {
  cpSync(root, temp, { recursive: true, filter: copyFilter })
  symlinkSync(
    join(root, "node_modules"),
    join(temp, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  )

  const apiDir = resolve(temp, "app", "api")
  assertInside(temp, apiDir)
  if (existsSync(apiDir)) rmSync(apiDir, { recursive: true, force: true })

  const npmCli = process.env.npm_execpath
  if (!npmCli || !existsSync(npmCli)) {
    throw new Error("npm_execpath is unavailable; run static export through npm run build:static.")
  }
  const build = spawnSync(process.execPath, [npmCli, "run", "build"], {
    cwd: temp,
    env: { ...process.env, GITHUB_PAGES: "true" },
    stdio: "inherit",
    shell: false,
  })
  if (build.error) throw build.error
  if (build.status !== 0) process.exitCode = build.status ?? 1
  else {
    const builtOutput = resolve(temp, "out")
    if (!existsSync(builtOutput)) throw new Error("Static build completed without producing out/.")
    if (existsSync(output)) rmSync(output, { recursive: true, force: true })
    cpSync(builtOutput, output, { recursive: true })
  }
} finally {
  rmSync(temp, { recursive: true, force: true })
}
