#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, extname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const args = new Set(process.argv.slice(2))
const json = args.has("--json")
const updateRatchet = args.has("--update-ratchet")
const budgets = JSON.parse(readFileSync(join(root, "scripts", "architecture-budgets.json"), "utf8"))
const ratchetPath = join(root, "scripts", "architecture-budgets.lock.json")

const sourceExtensions = new Set([".ts", ".tsx"])
const ignoredDirs = new Set([
  ".git",
  ".next",
  ".superpowers",
  ".tocodex",
  "artifacts",
  "gsap-public",
  "gsap-skills-main",
  "node_modules",
  "out",
  "public/vendor",
  "test-results",
])

function toPosix(path) {
  return path.replace(/\\/g, "/")
}

function relativePath(path) {
  return toPosix(relative(root, path))
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const rel = relativePath(full)
    if (entry.isDirectory()) {
      if (ignoredDirs.has(rel) || ignoredDirs.has(entry.name)) continue
      walk(full, files)
      continue
    }
    files.push(full)
  }
  return files
}

function readText(file) {
  return readFileSync(file, "utf8")
}

function lineCount(text) {
  if (!text) return 0
  return text.split(/\r?\n/).length
}

function resolveLocalImport(fromFile, specifier, knownFiles) {
  if (!specifier.startsWith(".")) return null
  const base = resolve(dirname(fromFile), specifier)
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]
  for (const candidate of candidates) {
    const normalized = resolve(candidate)
    if (knownFiles.has(normalized)) return normalized
  }
  return null
}

function localImports(file, knownFiles) {
  const text = readText(file)
  const imports = new Set()
  const importFrom = /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g
  const dynamicImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  for (const regex of [importFrom, dynamicImport]) {
    for (const match of text.matchAll(regex)) {
      const target = resolveLocalImport(file, match[1], knownFiles)
      if (target) imports.add(target)
    }
  }
  return [...imports]
}

function stronglyConnectedComponents(graph) {
  let index = 0
  const stack = []
  const indices = new Map()
  const lowlinks = new Map()
  const onStack = new Set()
  const components = []

  function visit(node) {
    indices.set(node, index)
    lowlinks.set(node, index)
    index += 1
    stack.push(node)
    onStack.add(node)

    for (const target of graph.get(node) ?? []) {
      if (!indices.has(target)) {
        visit(target)
        lowlinks.set(node, Math.min(lowlinks.get(node), lowlinks.get(target)))
      } else if (onStack.has(target)) {
        lowlinks.set(node, Math.min(lowlinks.get(node), indices.get(target)))
      }
    }

    if (lowlinks.get(node) === indices.get(node)) {
      const component = []
      while (stack.length) {
        const item = stack.pop()
        onStack.delete(item)
        component.push(item)
        if (item === node) break
      }
      components.push(component)
    }
  }

  for (const node of graph.keys()) {
    if (!indices.has(node)) visit(node)
  }
  return components
}

// ---------------------------------------------------------------------------
// Budget ratchet
//
// Budgets exist to stop debt growing, but a budget that can be raised in the
// same PR that breaches it is just a permission slip. Every numeric budget is
// therefore locked in architecture-budgets.lock.json and may only ever move
// downwards. Raising one requires deleting the lock entry by hand, which shows
// up in review as exactly what it is.
//
// To tighten budgets after a refactor:
//   node scripts/check-architecture.mjs --update-ratchet
// ---------------------------------------------------------------------------

// Keys that configure how much we measure rather than how much debt is allowed.
// Raising these makes the check stricter, not looser, so they are not ratcheted.
const nonBudgetKeys = new Set(["count"])

function flattenBudgets(value, prefix = "", out = new Map()) {
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (entry && typeof entry === "object") {
      flattenBudgets(entry, path, out)
    } else if (typeof entry === "number" && !nonBudgetKeys.has(key)) {
      out.set(path, entry)
    }
  }
  return out
}

const currentBudgets = flattenBudgets(budgets)

let ratchetMissing = false
let lockedBudgets = new Map()
try {
  const lock = JSON.parse(readFileSync(ratchetPath, "utf8"))
  lockedBudgets = new Map(Object.entries(lock.budgets ?? {}))
} catch {
  ratchetMissing = true
}

const ratchetViolations = []
for (const [path, limit] of currentBudgets) {
  const locked = lockedBudgets.get(path)
  if (typeof locked !== "number") continue
  if (limit > locked) ratchetViolations.push({ budget: path, limit, locked })
}
const unlockedBudgets = [...currentBudgets.keys()].filter((path) => !lockedBudgets.has(path))

if (updateRatchet) {
  if (ratchetViolations.length) {
    console.error("refusing to update the ratchet: budgets may only ever decrease")
    for (const entry of ratchetViolations) {
      console.error(`  ${entry.budget}: ${entry.limit} exceeds locked ${entry.locked}`)
    }
    process.exit(1)
  }
  const next = {
    $comment:
      "Locked architecture budgets. Generated by scripts/check-architecture.mjs --update-ratchet. " +
      "Values may only ever decrease; check:architecture fails if architecture-budgets.json is looser than this file.",
    updatedAt: new Date().toISOString().slice(0, 10),
    budgets: Object.fromEntries(currentBudgets),
  }
  writeFileSync(ratchetPath, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`ratchet updated: ${currentBudgets.size} budgets locked`)
  process.exit(0)
}

const allFiles = walk(root)
const photoshopSource = allFiles.filter((file) => {
  const rel = relativePath(file)
  return rel.startsWith("components/photoshop/") && sourceExtensions.has(extname(file))
})
const knownPhotoshopSource = new Set(photoshopSource.map((file) => resolve(file)))
const graph = new Map()
for (const file of photoshopSource) {
  graph.set(resolve(file), localImports(file, knownPhotoshopSource))
}

const importCycles = stronglyConnectedComponents(graph)
  .filter((component) => component.length > 1)
  .map((component) => component.map(relativePath).sort())
  .sort((a, b) => a[0].localeCompare(b[0]))

const oversizeFiles = photoshopSource
  .map((file) => {
    const text = readText(file)
    return { file: relativePath(file), lines: lineCount(text) }
  })
  .filter((entry) => entry.lines > budgets.oversizeFiles.maxLines)
  .sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file))

const topLargestFileCount = Math.max(1, Math.round(budgets.topLargestFiles?.count ?? 10))
const topLargestFiles = photoshopSource
  .map((file) => {
    const text = readText(file)
    return { file: relativePath(file), lines: lineCount(text) }
  })
  .sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file))
  .slice(0, topLargestFileCount)
const topLargestFilesTotalLines = topLargestFiles.reduce((sum, entry) => sum + entry.lines, 0)

const searchedForEvents = allFiles.filter((file) => {
  const rel = relativePath(file)
  if (rel === "components/photoshop/events.ts") return false
  if (rel.startsWith("components/") || rel.startsWith("app/") || rel.startsWith("tests/")) {
    return sourceExtensions.has(extname(file))
  }
  return false
})

const rawPhotoshopEvents = []
const rawEventRegex = /new\s+CustomEvent\s*\(\s*["'`]ps-/g
for (const file of searchedForEvents) {
  const text = readText(file)
  const matches = text.match(rawEventRegex)
  if (matches?.length) rawPhotoshopEvents.push({ file: relativePath(file), count: matches.length })
}

const rawPhotoshopListeners = []
const rawListenerRegex = /\bwindow\s*\.\s*addEventListener\s*\(\s*["'`]ps-/g
for (const file of searchedForEvents) {
  const text = readText(file)
  const matches = text.match(rawListenerRegex)
  if (matches?.length) rawPhotoshopListeners.push({ file: relativePath(file), count: matches.length })
}

const directClientStorageAllowedFiles = new Set([
  "components/photoshop/client-storage.ts",
  "components/photoshop/storage-registry.ts",
  "components/photoshop/panels/browser-diagnostics-panel.tsx",
])
const directClientStorageRegex =
  /\b(?:window|globalThis)\s*\.\s*(?:localStorage|sessionStorage)\b|\b(?:localStorage|sessionStorage)\s*\.\s*(?:getItem|setItem|removeItem|clear|key)\s*\(|\btypeof\s+(?:localStorage|sessionStorage|indexedDB)\b|\bindexedDB\s*\.\s*open\s*\(|\bstorageManager\s*\.\s*getDirectory\s*\(/g
const directClientStorage = photoshopSource
  .map((file) => {
    const rel = relativePath(file)
    const matches = readText(file).match(directClientStorageRegex)
    return { file: rel, count: matches?.length ?? 0 }
  })
  .filter((entry) => entry.count > 0 && !directClientStorageAllowedFiles.has(entry.file))
  .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))

const sourceHygieneFiles = allFiles.filter((file) => {
  const rel = relativePath(file)
  return sourceExtensions.has(extname(file)) && !rel.startsWith("tests/")
})
const hookDependencySuppressionRegex = /eslint-disable-next-line\s+react-hooks\/exhaustive-deps/g
const hookDependencySuppressions = sourceHygieneFiles
  .map((file) => {
    const matches = readText(file).match(hookDependencySuppressionRegex)
    return { file: relativePath(file), count: matches?.length ?? 0 }
  })
  .filter((entry) => entry.count > 0)
  .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))

const useEditorImports = photoshopSource
  .filter((file) => {
    const text = readText(file)
    return /from\s+["'][.\/]+editor-context["']/.test(text) && /\buseEditor\b/.test(text)
  })
  .map(relativePath)
  .sort()

const coordinationFiles = Object.entries(budgets.coordinationFiles ?? {}).map(([file, limit]) => {
  const absolute = resolve(root, file)
  const imports = graph.get(absolute)?.length ?? 0
  const fanIn = [...graph.values()].filter((targets) => targets.includes(absolute)).length
  return {
    file,
    imports,
    maxImports: limit.maxImports,
    fanIn,
    maxFanIn: limit.maxFanIn,
    ok: imports <= limit.maxImports && fanIn <= limit.maxFanIn,
  }
})

const rawPhotoshopEventCount = rawPhotoshopEvents.reduce((sum, entry) => sum + entry.count, 0)
const rawPhotoshopListenerCount = rawPhotoshopListeners.reduce((sum, entry) => sum + entry.count, 0)
const hookDependencySuppressionCount = hookDependencySuppressions.reduce((sum, entry) => sum + entry.count, 0)
const report = {
  checks: [
    { id: "no-import-cycles", ok: importCycles.length === 0 },
    {
      id: "raw-photoshop-event-budget",
      ok: rawPhotoshopEventCount <= budgets.rawPhotoshopEvents.max,
    },
    {
      id: "raw-photoshop-listener-budget",
      ok: rawPhotoshopListenerCount <= budgets.rawPhotoshopListeners.max,
    },
    {
      id: "oversize-file-budget",
      ok: oversizeFiles.length <= budgets.oversizeFiles.max,
    },
    {
      id: "use-editor-import-budget",
      ok: useEditorImports.length <= budgets.useEditorImports.max,
    },
    {
      id: "top-largest-files-budget",
      ok: topLargestFilesTotalLines <= budgets.topLargestFiles.maxTotalLines,
    },
    {
      id: "direct-client-storage-budget",
      ok: directClientStorage.length <= budgets.directClientStorage.max,
    },
    {
      id: "hook-dependency-suppression-budget",
      ok: hookDependencySuppressionCount <= budgets.hookDependencySuppressions.max,
    },
    {
      id: "coordination-file-budget",
      ok: coordinationFiles.every((entry) => entry.ok),
    },
    {
      id: "budget-ratchet",
      ok: !ratchetMissing && ratchetViolations.length === 0,
    },
  ],
  importCycles,
  oversizeFiles,
  topLargestFiles,
  rawPhotoshopEvents,
  rawPhotoshopListeners,
  directClientStorage,
  hookDependencySuppressions,
  useEditorImports,
  coordinationFiles,
  ratchet: {
    lockfile: relativePath(ratchetPath),
    missing: ratchetMissing,
    violations: ratchetViolations,
    unlocked: unlockedBudgets,
  },
  budgets: {
    rawPhotoshopEvents: {
      count: rawPhotoshopEventCount,
      max: budgets.rawPhotoshopEvents.max,
    },
    rawPhotoshopListeners: {
      count: rawPhotoshopListenerCount,
      max: budgets.rawPhotoshopListeners.max,
    },
    oversizeFiles: {
      count: oversizeFiles.length,
      max: budgets.oversizeFiles.max,
      maxLines: budgets.oversizeFiles.maxLines,
    },
    useEditorImports: {
      count: useEditorImports.length,
      max: budgets.useEditorImports.max,
    },
    topLargestFiles: {
      count: topLargestFiles.length,
      totalLines: topLargestFilesTotalLines,
      maxTotalLines: budgets.topLargestFiles.maxTotalLines,
    },
    directClientStorage: {
      count: directClientStorage.length,
      max: budgets.directClientStorage.max,
    },
    hookDependencySuppressions: {
      count: hookDependencySuppressionCount,
      max: budgets.hookDependencySuppressions.max,
    },
  },
}

// Headroom is the number that actually matters: a budget with slack is debt
// that has been pre-authorised. Print it so drift is visible in every run.
function headroom(used, allowed) {
  const slack = allowed - used
  return slack > 0 ? ` (${slack} of headroom — tighten it)` : ""
}

const ok = report.checks.every((check) => check.ok)
if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  for (const check of report.checks) {
    console.log(`${check.ok ? "ok" : "fail"} ${check.id}`)
  }
  console.log(`import cycles: ${report.importCycles.length}`)
  console.log(
    `raw Photoshop events: ${report.budgets.rawPhotoshopEvents.count}/${report.budgets.rawPhotoshopEvents.max}`,
  )
  console.log(
    `raw Photoshop listeners: ${report.budgets.rawPhotoshopListeners.count}/${report.budgets.rawPhotoshopListeners.max}`,
  )
  console.log(
    `oversize files: ${report.budgets.oversizeFiles.count}/${report.budgets.oversizeFiles.max}` +
      headroom(report.budgets.oversizeFiles.count, report.budgets.oversizeFiles.max),
  )
  console.log(
    `useEditor imports: ${report.budgets.useEditorImports.count}/${report.budgets.useEditorImports.max}` +
      headroom(report.budgets.useEditorImports.count, report.budgets.useEditorImports.max),
  )
  console.log(
    `top ${report.budgets.topLargestFiles.count} largest files: ` +
      `${report.budgets.topLargestFiles.totalLines}/${report.budgets.topLargestFiles.maxTotalLines} lines` +
      headroom(report.budgets.topLargestFiles.totalLines, report.budgets.topLargestFiles.maxTotalLines),
  )
  console.log(
    `direct client storage files: ${report.budgets.directClientStorage.count}/${report.budgets.directClientStorage.max}`,
  )
  console.log(
    `hook dependency suppressions: ` +
      `${report.budgets.hookDependencySuppressions.count}/${report.budgets.hookDependencySuppressions.max}` +
      headroom(
        report.budgets.hookDependencySuppressions.count,
        report.budgets.hookDependencySuppressions.max,
      ),
  )
  for (const entry of report.coordinationFiles) {
    console.log(
      `${entry.file}: imports ${entry.imports}/${entry.maxImports}, fan-in ${entry.fanIn}/${entry.maxFanIn}`,
    )
  }
  if (ratchetMissing) {
    console.log(
      `ratchet: MISSING ${report.ratchet.lockfile} — run "node scripts/check-architecture.mjs --update-ratchet"`,
    )
  } else {
    console.log(`ratchet: ${lockedBudgets.size} budgets locked, ${ratchetViolations.length} loosened`)
    for (const entry of ratchetViolations) {
      console.log(`  loosened ${entry.budget}: ${entry.limit} exceeds locked ${entry.locked}`)
    }
    for (const path of unlockedBudgets) {
      console.log(`  unlocked ${path} — run --update-ratchet to lock it`)
    }
  }
}

process.exit(ok ? 0 : 1)
