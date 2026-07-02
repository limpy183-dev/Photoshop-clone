#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const root = process.cwd()
const scanRoots = ["app", "components", "hooks", "lib", "scripts", "tests"]
const extensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"])
const mojibakePattern = /[\u00c2\u00c3\ufffd]|\u00e2(?:[\u0080-\u00bf]|.)?/gu

function shouldSkipDirectory(name) {
  return name === "node_modules" || name === ".next" || name === ".git"
}

function extensionOf(file) {
  const index = file.lastIndexOf(".")
  return index >= 0 ? file.slice(index) : ""
}

function walk(dir) {
  const entries = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(entry.name)) entries.push(...walk(join(dir, entry.name)))
      continue
    }
    if (entry.isFile() && extensions.has(extensionOf(entry.name))) {
      entries.push(join(dir, entry.name))
    }
  }
  return entries
}

function locationForIndex(text, index) {
  let line = 1
  let column = 1
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }
  return { line, column }
}

const findings = []

for (const scanRoot of scanRoots) {
  const absRoot = resolve(root, scanRoot)
  if (!existsSync(absRoot)) continue
  for (const file of walk(absRoot)) {
    const text = readFileSync(file, "utf8")
    for (const match of text.matchAll(mojibakePattern)) {
      const { line, column } = locationForIndex(text, match.index ?? 0)
      const lineText = text.split(/\r?\n/)[line - 1]?.trim() ?? ""
      findings.push({
        file: relative(root, file).split("\\").join("/"),
        line,
        column,
        text: lineText.slice(0, 160),
      })
    }
  }
}

if (findings.length) {
  console.error(`Source hygiene failed: ${findings.length} possible mojibake sequence(s).`)
  for (const finding of findings.slice(0, 50)) {
    console.error(`${finding.file}:${finding.line}:${finding.column} ${finding.text}`)
  }
  if (findings.length > 50) {
    console.error(`...and ${findings.length - 50} more.`)
  }
  process.exit(1)
}

console.log("Source hygiene passed: no common mojibake sequences found.")
