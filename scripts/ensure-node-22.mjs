#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const expectedMajor = "22"
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))

function readVersionFile(name) {
  return readFileSync(join(root, name), "utf8").trim()
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

const nvmVersion = readVersionFile(".nvmrc")
const nodeVersion = readVersionFile(".node-version")
const currentMajor = process.versions.node.split(".")[0]

if (nvmVersion !== expectedMajor || nodeVersion !== expectedMajor) {
  fail(`Node version pins must both be ${expectedMajor}: .nvmrc=${nvmVersion}, .node-version=${nodeVersion}`)
}

if (pkg.engines?.node !== ">=22 <23") {
  fail(`package.json engines.node must be ">=22 <23"; found ${pkg.engines?.node ?? "missing"}`)
}

if (currentMajor !== expectedMajor) {
  fail(`Use Node ${expectedMajor} for local parity with CI. Current Node is ${process.versions.node}.`)
}
