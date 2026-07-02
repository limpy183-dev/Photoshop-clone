#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const coveragePath = resolve(root, process.argv[2] ?? "coverage/coverage-final.json")
if (!existsSync(coveragePath)) {
  console.error(`Coverage file not found: ${relative(root, coveragePath)}`)
  process.exit(1)
}

const baseRef = process.env.COVERAGE_BASE_REF?.trim()
const comparison = baseRef ? `${baseRef}...HEAD` : "HEAD"
const diff = execFileSync("git", ["diff", "--unified=0", comparison, "--", "components/**/*.ts", "components/**/*.tsx"], {
  cwd: root,
  encoding: "utf8",
})
const changed = new Map()
let current = null
for (const line of diff.split(/\r?\n/)) {
  if (line.startsWith("+++ b/")) {
    current = line.slice(6).replace(/\\/g, "/")
    if (!changed.has(current)) changed.set(current, new Set())
    continue
  }
  const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
  if (!hunk || !current) continue
  const start = Number(hunk[1])
  const count = Number(hunk[2] ?? 1)
  for (let offset = 0; offset < count; offset++) changed.get(current).add(start + offset)
}

const coverage = JSON.parse(readFileSync(coveragePath, "utf8"))
const failures = []
const criticalPureModule = /(?:filters?\/|reducer|serializer|sanitizer|algorithms)/
for (const [absoluteFile, fileCoverage] of Object.entries(coverage)) {
  const file = relative(root, absoluteFile).replace(/\\/g, "/")
  if (!criticalPureModule.test(file)) continue
  const lines = changed.get(file)
  if (!lines?.size) continue

  for (const [id, location] of Object.entries(fileCoverage.statementMap ?? {})) {
    const touchesChange = [...lines].some(
      (line) => line >= location.start.line && line <= location.end.line,
    )
    if (touchesChange && Number(fileCoverage.s?.[id] ?? 0) === 0) {
      failures.push(`${file}:${location.start.line} changed statement is uncovered`)
    }
  }
  for (const [id, location] of Object.entries(fileCoverage.branchMap ?? {})) {
    if (!lines.has(location.loc?.start?.line)) continue
    if ((fileCoverage.b?.[id] ?? []).some((count) => Number(count) === 0)) {
      failures.push(`${file}:${location.loc.start.line} changed branch is not fully covered`)
    }
  }
}

if (failures.length) {
  console.error(failures.join("\n"))
  process.exit(1)
}
console.log("Changed-line coverage check passed for covered pure modules.")
