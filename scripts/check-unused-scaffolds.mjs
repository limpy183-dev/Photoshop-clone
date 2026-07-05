#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { extname, join } from "node:path"

const forbiddenScaffolds = [
  "components/ui/use-toast.ts",
  "components/ui/use-mobile.tsx",
  "styles/globals.css",
]

const present = forbiddenScaffolds.filter((file) => existsSync(file))
if (present.length) {
  console.error(`Unused scaffold files must be removed:\n${present.map((file) => `  - ${file}`).join("\n")}`)
  process.exit(1)
}

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) walk(path, files)
    else if ([".ts", ".tsx"].includes(extname(path))) files.push(path)
  }
  return files
}

const productionSources = walk("components")
  .filter((file) => !file.endsWith("storage-registry.ts"))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n")
const requiredGovernanceCallers = [
  "migrateRegisteredPayload",
  "writeWithRegisteredQuotaRecovery",
  "runRegisteredAtomicTransaction",
]
const unusedGovernance = requiredGovernanceCallers.filter(
  (helper) => !productionSources.includes(helper),
)
if (unusedGovernance.length) {
  console.error(
    `Storage governance helpers require production callers:\n${unusedGovernance.map((helper) => `  - ${helper}`).join("\n")}`,
  )
  process.exit(1)
}

console.log(
  `Unused scaffold check passed (${forbiddenScaffolds.length} retired paths absent; storage governance enforced).`,
)
