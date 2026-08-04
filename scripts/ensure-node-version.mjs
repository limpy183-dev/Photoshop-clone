#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))

function readVersionFile(name) {
  return readFileSync(join(root, name), "utf8").trim()
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

// .nvmrc is the single source of truth; every other pin is checked against it.
const expectedMajor = readVersionFile(".nvmrc")
const nodeVersion = readVersionFile(".node-version")
const currentMajor = process.versions.node.split(".")[0]

if (!/^\d+$/.test(expectedMajor)) {
  fail(`.nvmrc must hold a bare major version; found ${expectedMajor}`)
}

const expectedEngines = `>=${expectedMajor} <${Number(expectedMajor) + 1}`

if (nodeVersion !== expectedMajor) {
  fail(`Node version pins must both be ${expectedMajor}: .nvmrc=${expectedMajor}, .node-version=${nodeVersion}`)
}

if (pkg.engines?.node !== expectedEngines) {
  fail(`package.json engines.node must be "${expectedEngines}"; found ${pkg.engines?.node ?? "missing"}`)
}

if (currentMajor !== expectedMajor) {
  fail(`Use Node ${expectedMajor} for local parity with CI. Current Node is ${process.versions.node}.`)
}
