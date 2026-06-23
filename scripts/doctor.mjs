#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const checks = []
const args = new Set(process.argv.slice(2))
const json = args.has("--json")

function add(id, ok, detail) {
  checks.push({ id, ok, detail })
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  } catch {
    return null
  }
}

function firstCommandOutput(candidates) {
  for (const candidate of candidates) {
    const output = commandOutput(candidate.command, candidate.args)
    if (output) return { ...candidate, output }
  }
  return null
}

function npmCandidates() {
  const candidates = []
  if (process.env.npm_execpath) {
    candidates.push({
      label: "npm_execpath",
      command: process.execPath,
      args: [process.env.npm_execpath, "--version"],
    })
  }
  if (process.platform === "win32") {
    candidates.push({
      label: "cmd npm.cmd",
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd --version"],
    })
  }
  candidates.push({
    label: process.platform === "win32" ? "npm.cmd" : "npm",
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["--version"],
  })
  candidates.push({
    label: "npx npm",
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["npm", "--version"],
  })
  return candidates
}

function playwrightBrowserCacheCandidates() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH === "0") return []
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return [resolve(process.env.PLAYWRIGHT_BROWSERS_PATH)]
  const paths = [join(root, "node_modules", ".cache", "ms-playwright")]
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    paths.push(join(process.env.LOCALAPPDATA, "ms-playwright"))
  }
  paths.push(join(homedir(), ".cache", "ms-playwright"))
  return [...new Set(paths)]
}

function hasPlaywrightBrowserCache(path) {
  return existsSync(path)
}

const nodeMajor = Number(process.versions.node.split(".")[0])
add("node-version", nodeMajor === 22, `current=${process.versions.node}; expected=${pkg.engines?.node ?? ">=22 <23"}`)

const npmVersion = firstCommandOutput(npmCandidates())
add(
  "npm-version",
  !!npmVersion,
  npmVersion
    ? `current=${npmVersion.output}; source=${npmVersion.label}; packageManager=${pkg.packageManager}`
    : "npm is unavailable through npm_execpath, npm command, and npx npm",
)

const expectedPackageManager = typeof pkg.packageManager === "string" ? pkg.packageManager : null
const packageManagerMatch = expectedPackageManager?.match(/^npm@(.+)$/)
if (packageManagerMatch) {
  const expectedNpmVersion = packageManagerMatch[1]
  add(
    "package-manager-version",
    npmVersion?.output === expectedNpmVersion,
    npmVersion
      ? `current=npm@${npmVersion.output}; expected=${expectedPackageManager}; source=${npmVersion.label}`
      : `npm unavailable; expected=${expectedPackageManager}`,
  )
} else {
  add(
    "package-manager-version",
    false,
    expectedPackageManager
      ? `unsupported packageManager=${expectedPackageManager}; expected npm@<version>`
      : "packageManager is missing from package.json",
  )
}

add("node-modules", existsSync(join(root, "node_modules")), "run npm ci if dependencies are missing")

const playwrightVersion = commandOutput(process.execPath, [join(root, "node_modules", "@playwright", "test", "cli.js"), "--version"])
add("playwright-cli", !!playwrightVersion, playwrightVersion ?? "Playwright CLI unavailable; run npm ci")

const browserCachePaths = playwrightBrowserCacheCandidates()
const browserCacheFound = process.env.PLAYWRIGHT_BROWSERS_PATH === "0" || browserCachePaths.some(hasPlaywrightBrowserCache)
add(
  "playwright-browsers",
  browserCacheFound,
  process.env.PLAYWRIGHT_BROWSERS_PATH === "0"
    ? "Playwright browsers are installed in node_modules because PLAYWRIGHT_BROWSERS_PATH=0"
    : `checked ${browserCachePaths.join(", ")}; run npx playwright install chromium if browser launch fails`,
)

if (json) {
  process.stdout.write(`${JSON.stringify({ checks }, null, 2)}\n`)
} else {
  for (const check of checks) {
    console.log(`${check.ok ? "ok" : "fail"} ${check.id}: ${check.detail}`)
  }
}

process.exit(checks.every((check) => check.ok) ? 0 : 1)
