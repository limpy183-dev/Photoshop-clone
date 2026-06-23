#!/usr/bin/env node
/**
 * Lightweight bundle visibility gate for the webpack Next build.
 *
 * It reads `.next/static/chunks` after `npm run build`, records the largest
 * client chunks, and fails when the configured budget is exceeded. The report
 * is intentionally JSON so CI artifacts and local diffs can track drift.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..")
const chunkRoot = resolve(root, ".next/static/chunks")
const reportPath = resolve(root, "artifacts/bundle-report.json")
const maxChunkBytes = Number(process.env.BUNDLE_MAX_CHUNK_BYTES ?? 1_500_000)
const maxInitialJsBytes = Number(process.env.BUNDLE_MAX_INITIAL_JS_BYTES ?? 5_000_000)

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(abs))
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(abs)
  }
  return out
}

function readBuildManifest() {
  const manifestPath = resolve(root, ".next/build-manifest.json")
  if (!existsSync(manifestPath)) return []
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    const files = new Set()
    for (const value of manifest.rootMainFiles ?? []) {
      if (typeof value === "string" && value.endsWith(".js")) files.add(value)
    }
    for (const value of manifest.polyfillFiles ?? []) {
      if (typeof value === "string" && value.endsWith(".js")) files.add(value)
    }
    for (const values of Object.values(manifest.pages ?? {})) {
      if (!Array.isArray(values)) continue
      for (const value of values) {
        if (typeof value === "string" && value.endsWith(".js")) files.add(value)
      }
    }
    return [...files]
  } catch {
    return []
  }
}

function toPosix(path) {
  return path.split("\\").join("/")
}

function readClientReferenceManifests() {
  const appServerRoot = resolve(root, ".next/server/app")
  if (!existsSync(appServerRoot)) return new Map()
  const ownership = new Map()
  const manifests = walk(appServerRoot).filter((file) => file.endsWith("_client-reference-manifest.js"))
  for (const manifestPath of manifests) {
    const text = readFileSync(manifestPath, "utf8")
    const match = text.match(/__RSC_MANIFEST\["([^"]+)"\]=(.+);?\s*$/s)
    if (!match) continue
    const route = match[1]
    try {
      const manifest = JSON.parse(match[2].replace(/;\s*$/, ""))
      for (const [modulePath, entry] of Object.entries(manifest.clientModules ?? {})) {
        if (!entry || typeof entry !== "object" || !Array.isArray(entry.chunks)) continue
        for (const chunk of entry.chunks) {
          if (typeof chunk !== "string" || !chunk.endsWith(".js")) continue
          const normalizedChunk = toPosix(chunk)
          const owner = ownership.get(normalizedChunk) ?? {
            chunk: normalizedChunk,
            routes: new Set(),
            modules: new Set(),
          }
          owner.routes.add(route)
          owner.modules.add(toPosix(modulePath).replace(`${toPosix(root)}/`, ""))
          ownership.set(normalizedChunk, owner)
        }
      }
    } catch {
      // Next changes manifest internals across versions; keep bundle analysis best-effort.
    }
  }
  return ownership
}

function classifyChunk(file) {
  if (/raster|raw|heic|j2k|openjpeg|exr|tiff|decoder/i.test(file)) return "decoder"
  if (/app\/editor|editor/i.test(file)) return "editor-route"
  if (/app\/marketing|marketing/i.test(file)) return "marketing-route"
  if (/app\/page|start-workspace/i.test(file)) return "home-route"
  if (/framework|main-app|webpack|polyfills/i.test(file)) return "framework"
  return "shared-or-dynamic"
}

function normalizeSourcemapSource(source) {
  return toPosix(source)
    .replace(/^webpack:\/\/_N_E\/(?:\(\.\.\/)?/, "")
    .replace(/^webpack:\/\/[^/]+\//, "")
    .replace(/^\.\//, "")
    .replace(`${toPosix(root)}/`, "")
}

function readChunkSourceMapOwnership(chunks) {
  const ownership = new Map()
  for (const chunk of chunks) {
    const mapPath = resolve(root, `${chunk.file}.map`)
    if (!existsSync(mapPath)) continue
    try {
      const map = JSON.parse(readFileSync(mapPath, "utf8"))
      const sources = Array.isArray(map.sources) ? map.sources : []
      const modules = new Set()
      for (const source of sources) {
        if (typeof source !== "string") continue
        const normalized = normalizeSourcemapSource(source)
        if (
          normalized.startsWith("components/") ||
          normalized.startsWith("app/") ||
          normalized.startsWith("lib/") ||
          normalized.startsWith("node_modules/")
        ) {
          modules.add(normalized)
        }
      }
      ownership.set(chunk.file, {
        file: chunk.file,
        sourceMap: relative(root, mapPath).split("\\").join("/"),
        modules,
      })
    } catch {
      // Sourcemaps are optional and may be hidden in production builds.
    }
  }
  return ownership
}

if (!existsSync(chunkRoot)) {
  console.error("Bundle analysis requires a completed Next build: .next/static/chunks was not found.")
  process.exit(2)
}

const chunks = walk(chunkRoot)
  .map((abs) => ({
    file: relative(root, abs).split("\\").join("/"),
    bytes: statSync(abs).size,
  }))
  .sort((a, b) => b.bytes - a.bytes)

const initialFiles = readBuildManifest()
const initialBytes = initialFiles.reduce((sum, file) => {
  const abs = resolve(root, ".next", file)
  return existsSync(abs) ? sum + statSync(abs).size : sum
}, 0)
const largest = chunks.slice(0, 20)
const overBudget = chunks.filter((chunk) => chunk.bytes > maxChunkBytes)
const decoderChunks = chunks.filter((chunk) => /decoder|raster|raw|heic|j2k|openjpeg|exr|tiff|wasm/i.test(chunk.file))
const clientReferenceOwnership = readClientReferenceManifests()
const sourcemapOwnership = readChunkSourceMapOwnership(largest)
const chunkOwnership = largest.map((chunk) => {
  const manifestPath = chunk.file.replace(/^\.next\//, "")
  const owner = clientReferenceOwnership.get(manifestPath)
  const sourcemapOwner = sourcemapOwnership.get(chunk.file)
  return {
    file: chunk.file,
    bytes: chunk.bytes,
    classification: classifyChunk(chunk.file),
    routes: owner ? [...owner.routes].sort() : [],
    moduleSamples: owner ? [...owner.modules].sort().slice(0, 12) : [],
    moduleSampleCount: owner?.modules.size ?? 0,
    sourcemapModuleSamples: sourcemapOwner ? [...sourcemapOwner.modules].sort().slice(0, 12) : [],
    sourcemapModuleSampleCount: sourcemapOwner?.modules.size ?? 0,
    ownershipSources: [
      ...(owner ? ["client-reference-manifest"] : []),
      ...(sourcemapOwner ? ["sourcemap"] : []),
    ],
  }
})

const report = {
  generatedAt: new Date().toISOString(),
  budgets: {
    maxChunkBytes,
    maxInitialJsBytes,
  },
  totals: {
    chunkCount: chunks.length,
    initialFiles: initialFiles.length,
    initialJsBytes: initialBytes,
  },
  largest,
  decoderChunks,
  chunkOwnership,
  ownershipLimitations: [
    "Next client-reference manifests expose route and client-module ownership for route chunks.",
    "Shared async chunks without manifest entries require sourcemaps or webpack stats for exact module attribution.",
  ],
  violations: [
    ...overBudget.map((chunk) => ({
      rule: "max-client-chunk",
      file: chunk.file,
      bytes: chunk.bytes,
      budget: maxChunkBytes,
    })),
    ...(initialBytes > maxInitialJsBytes
      ? [{ rule: "max-initial-js", bytes: initialBytes, budget: maxInitialJsBytes }]
      : []),
  ],
}

mkdirSync(dirname(reportPath), { recursive: true })
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n")

console.log(`Bundle analysis: ${chunks.length} client chunks, ${(initialBytes / 1024).toFixed(1)} KiB initial JS`)
for (const chunk of largest.slice(0, 10)) {
  console.log(`  ${(chunk.bytes / 1024).toFixed(1).padStart(8)} KiB  ${chunk.file}`)
}
console.log(`Report: ${relative(root, reportPath).split("\\").join("/")}`)

if (report.violations.length) {
  console.error(`Bundle budget failed with ${report.violations.length} violation(s).`)
  process.exit(1)
}
