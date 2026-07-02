#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

const manifest = process.argv[2]
if (!manifest) {
  console.error("Usage: node scripts/run-selected-tests.mjs <manifest.json>")
  process.exit(2)
}

const invocations = JSON.parse(readFileSync(manifest, "utf8"))
if (!Array.isArray(invocations)) {
  console.error("Selected-test manifest must contain an array.")
  process.exit(2)
}

for (const invocation of invocations) {
  if (
    !invocation ||
    invocation.executable !== "npx" ||
    !Array.isArray(invocation.args) ||
    invocation.args.some((arg) => typeof arg !== "string")
  ) {
    console.error("Selected-test manifest contains an invalid invocation.")
    process.exit(2)
  }
  const executable = process.platform === "win32" ? "npx.cmd" : "npx"
  const result = spawnSync(executable, invocation.args, {
    stdio: "inherit",
    shell: false,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
