#!/usr/bin/env node
import { existsSync } from "node:fs"

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

console.log(`Unused scaffold check passed (${forbiddenScaffolds.length} retired paths absent).`)
