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
import { measureRouteBundles } from "./measure-route-bundles.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..")
const chunkRoot = resolve(root, ".next/static/chunks")
const reportPath = resolve(root, "artifacts/bundle-report.json")
const maxChunkBytes = Number(process.env.BUNDLE_MAX_CHUNK_BYTES ?? 1_500_000)
const maxInitialJsBytes = Number(process.env.BUNDLE_MAX_INITIAL_JS_BYTES ?? 5_000_000)
const routeBudgets = {
  "/": {
    maxDecodedBytes: Number(process.env.BUNDLE_HOME_MAX_DECODED_BYTES ?? 1_500_000),
    maxEncodedBytes: Number(process.env.BUNDLE_HOME_MAX_ENCODED_BYTES ?? 600_000),
    maxRequests: Number(process.env.BUNDLE_HOME_MAX_REQUESTS ?? 18),
  },
  "/editor": {
    maxDecodedBytes: Number(process.env.BUNDLE_EDITOR_MAX_DECODED_BYTES ?? 3_000_000),
    maxEncodedBytes: Number(process.env.BUNDLE_EDITOR_MAX_ENCODED_BYTES ?? 900_000),
    maxRequests: Number(process.env.BUNDLE_EDITOR_MAX_REQUESTS ?? 24),
  },
  "/marketing": {
    maxDecodedBytes: Number(process.env.BUNDLE_MARKETING_MAX_DECODED_BYTES ?? 1_500_000),
    maxEncodedBytes: Number(process.env.BUNDLE_MARKETING_MAX_ENCODED_BYTES ?? 600_000),
    maxRequests: Number(process.env.BUNDLE_MARKETING_MAX_REQUESTS ?? 18),
  },
  "/documentation": {
    maxDecodedBytes: Number(process.env.BUNDLE_DOCUMENTATION_MAX_DECODED_BYTES ?? 2_000_000),
    maxEncodedBytes: Number(process.env.BUNDLE_DOCUMENTATION_MAX_ENCODED_BYTES ?? 700_000),
    maxRequests: Number(process.env.BUNDLE_DOCUMENTATION_MAX_REQUESTS ?? 20),
  },
}

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

function normalizeStatsChunkFile(file) {
  const normalized = toPosix(String(file)).replace(/^\/+/, "")
  if (normalized.startsWith(".next/")) return normalized
  if (normalized.startsWith("static/")) return `.next/${normalized}`
  if (normalized.startsWith("chunks/")) return `.next/static/${normalized}`
  return normalized
}

function normalizeWebpackStatsModuleName(value) {
  const normalized = normalizeSourcemapSource(String(value).replace(/^.*!/, ""))
  return normalized.replace(/^\.\//, "")
}

function collectWebpackStatsModules(modules, out) {
  if (!Array.isArray(modules)) return
  for (const item of modules) {
    if (!item || typeof item !== "object") continue
    const rawName = item.nameForCondition ?? item.name ?? item.identifier
    if (typeof rawName === "string") {
      const normalized = normalizeWebpackStatsModuleName(rawName)
      if (
        normalized.startsWith("components/") ||
        normalized.startsWith("app/") ||
        normalized.startsWith("lib/") ||
        normalized.startsWith("node_modules/")
      ) {
        out.add(normalized)
      }
    }
    collectWebpackStatsModules(item.modules, out)
  }
}

function readWebpackStatsOwnership(chunks) {
  const candidates = [
    process.env.BUNDLE_WEBPACK_STATS_PATH,
    resolve(root, "artifacts/webpack-stats.json"),
    resolve(root, ".next/webpack-stats.json"),
    resolve(root, ".next/stats-client.json"),
  ].filter(Boolean)
  const wantedFiles = new Set(chunks.map((chunk) => chunk.file))

  for (const statsPath of candidates) {
    if (!existsSync(statsPath)) continue
    try {
      const stats = JSON.parse(readFileSync(statsPath, "utf8"))
      const modulesByChunk = new Map()
      for (const module of stats.modules ?? []) {
        for (const chunkId of module.chunks ?? []) {
          const key = String(chunkId)
          const modules = modulesByChunk.get(key) ?? []
          modules.push(module)
          modulesByChunk.set(key, modules)
        }
      }

      const ownership = new Map()
      for (const chunk of stats.chunks ?? []) {
        if (!chunk || typeof chunk !== "object") continue
        const files = (chunk.files ?? []).map(normalizeStatsChunkFile).filter((file) => wantedFiles.has(file))
        if (!files.length) continue
        const modules = new Set()
        collectWebpackStatsModules(chunk.modules, modules)
        for (const key of [chunk.id, chunk.name, ...(chunk.names ?? [])]) {
          collectWebpackStatsModules(modulesByChunk.get(String(key)), modules)
        }
        for (const file of files) {
          ownership.set(file, {
            file,
            statsPath: relative(root, statsPath).split("\\").join("/"),
            modules,
          })
        }
      }
      return ownership
    } catch {
      // Webpack stats are optional and may be produced by different tooling.
    }
  }
  return new Map()
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
const webpackStatsOwnership = readWebpackStatsOwnership(largest)
const chunkOwnership = largest.map((chunk) => {
  const manifestPath = chunk.file.replace(/^\.next\//, "")
  const owner = clientReferenceOwnership.get(manifestPath)
  const sourcemapOwner = sourcemapOwnership.get(chunk.file)
  const webpackStatsOwner = webpackStatsOwnership.get(chunk.file)
  return {
    file: chunk.file,
    bytes: chunk.bytes,
    classification: classifyChunk(chunk.file),
    routes: owner ? [...owner.routes].sort() : [],
    moduleSamples: owner ? [...owner.modules].sort().slice(0, 12) : [],
    moduleSampleCount: owner?.modules.size ?? 0,
    sourcemapModuleSamples: sourcemapOwner ? [...sourcemapOwner.modules].sort().slice(0, 12) : [],
    sourcemapModuleSampleCount: sourcemapOwner?.modules.size ?? 0,
    webpackStatsModuleSamples: webpackStatsOwner ? [...webpackStatsOwner.modules].sort().slice(0, 12) : [],
    webpackStatsModuleSampleCount: webpackStatsOwner?.modules.size ?? 0,
    webpackStatsPath: webpackStatsOwner?.statsPath,
    ownershipSources: [
      ...(owner ? ["client-reference-manifest"] : []),
      ...(sourcemapOwner ? ["sourcemap"] : []),
      ...(webpackStatsOwner ? ["webpack-stats"] : []),
    ],
  }
})
const routeMetrics = await measureRouteBundles({ root })
const routeViolations = []
for (const [route, metrics] of Object.entries(routeMetrics)) {
  const budget = routeBudgets[route]
  if (!budget) continue
  for (const [metric, value, limit] of [
    ["decoded-startup-js", metrics.decodedBodyBytes, budget.maxDecodedBytes],
    ["encoded-startup-js", metrics.encodedBodyBytes, budget.maxEncodedBytes],
    ["startup-js-requests", metrics.requestCount, budget.maxRequests],
  ]) {
    if (value <= limit) continue
    const largestPath = metrics.largestStartupChunk
      ? new URL(metrics.largestStartupChunk.url).pathname.replace(/^\/_next\//, ".next/")
      : undefined
    const owner = largestPath
      ? chunkOwnership.find((entry) => entry.file === largestPath)
      : undefined
    routeViolations.push({
      rule: metric,
      route,
      value,
      budget: limit,
      largestStartupChunk: metrics.largestStartupChunk,
      owner,
    })
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  budgets: {
    maxChunkBytes,
    maxInitialJsBytes,
    routes: routeBudgets,
  },
  totals: {
    chunkCount: chunks.length,
    initialFiles: initialFiles.length,
    initialJsBytes: initialBytes,
  },
  largest,
  decoderChunks,
  chunkOwnership,
  routeMetrics,
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
    ...routeViolations,
  ],
}

mkdirSync(dirname(reportPath), { recursive: true })
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n")

console.log(`Bundle analysis: ${chunks.length} client chunks, ${(initialBytes / 1024).toFixed(1)} KiB initial JS`)
for (const [route, metrics] of Object.entries(routeMetrics)) {
  console.log(
    `  ${route.padEnd(14)} ${(metrics.encodedBodyBytes / 1024).toFixed(1)} KiB encoded, ` +
    `${(metrics.decodedBodyBytes / 1024).toFixed(1)} KiB decoded, ${metrics.requestCount} requests`,
  )
}
for (const chunk of largest.slice(0, 10)) {
  console.log(`  ${(chunk.bytes / 1024).toFixed(1).padStart(8)} KiB  ${chunk.file}`)
}
console.log(`Report: ${relative(root, reportPath).split("\\").join("/")}`)

if (report.violations.length) {
  console.error(`Bundle budget failed with ${report.violations.length} violation(s).`)
  process.exit(1)
}
