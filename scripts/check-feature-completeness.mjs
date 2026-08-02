#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { resolve, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const manifest = JSON.parse(readFileSync(join(root, "scripts", "feature-completeness-manifest.json"), "utf8"))
const allowed = new Set(["complete", "usable", "approximation", "stub", "unsupported"])
const errors = []
const seen = new Set()
for (const feature of manifest.features ?? []) {
  if (!feature.id || seen.has(feature.id)) errors.push(`duplicate or missing feature id: ${feature.id ?? "<missing>"}`)
  seen.add(feature.id)
  if (!allowed.has(feature.status)) errors.push(`${feature.id}: invalid status ${feature.status}`)
  if (!feature.depth) errors.push(`${feature.id}: missing depth assessment`)
  if (!feature.evidence) errors.push(`${feature.id}: missing evidence`)
}
const counts = Object.fromEntries([...allowed].map((status) => [status, manifest.features.filter((item) => item.status === status).length]))
console.log(`Feature completeness: ${manifest.features.length} tracked features`)
console.log(Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(" "))
for (const feature of manifest.features) {
  if (feature.status === "stub" || feature.status === "unsupported") console.log(`  ${feature.status}: ${feature.label} (${feature.depth})`)
}
if (errors.length) {
  for (const error of errors) console.error(`ERROR ${error}`)
  process.exit(1)
}
